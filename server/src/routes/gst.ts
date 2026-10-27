import { requirePerm } from '../auth.ts';
import { bad, conflict, notFound, forbidden, FileResponse, V, type Router } from '../http.ts';
import { newId } from '../security.ts';
import { audit } from '../audit.ts';
import {
  validateGstr2bJson,
  validateGstr2bCsv,
  compareBookAnd2B,
  normalizeInvoiceNumber,
  type BookRecordForMatch,
  type Gstr2bRecordForMatch,
} from '../../../shared/gst.ts';
import type { ItcMatchingStatus, ItcReviewStatus } from '../../../shared/types.ts';

export function registerGst(r: Router) {
  // --------------------------------------------------------------------------
  // 1. GST Overview Summary Cards
  // --------------------------------------------------------------------------
  r.get('/api/gst/overview', requirePerm('gst.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const period = ctx.query.period || new Date().toISOString().slice(0, 7); // YYYY-MM
    const tenant = await ctx.db.one<{ gstin?: string; name: string }>('SELECT gstin, name FROM tenants WHERE id = ?', [tenantId]);
    const selectedGstin = ctx.query.gstin || tenant?.gstin || '';

    const [year, month] = period.split('-').map(Number);
    const startDate = `${period}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${period}-${String(lastDay).padStart(2, '0')}`;

    // Outward Supplies: Invoices minus Credit Notes in this period
    const salesAgg = await ctx.db.one<{ taxable: number; cgst: number; sgst: number; igst: number }>(
      `SELECT
        COALESCE(SUM(taxable_minor), 0)::bigint AS taxable,
        COALESCE(SUM(cgst_minor), 0)::bigint AS cgst,
        COALESCE(SUM(sgst_minor), 0)::bigint AS sgst,
        COALESCE(SUM(igst_minor), 0)::bigint AS igst
       FROM invoices
       WHERE tenant_id = ? AND bdate >= ? AND bdate <= ? AND status = 'posted' AND kind = 'sale'`,
      [tenantId, startDate, endDate],
    );

    const creditAgg = await ctx.db.one<{ taxable: number; cgst: number; sgst: number; igst: number }>(
      `SELECT
        COALESCE(SUM(taxable_minor), 0)::bigint AS taxable,
        COALESCE(SUM(cgst_minor), 0)::bigint AS cgst,
        COALESCE(SUM(sgst_minor), 0)::bigint AS sgst,
        COALESCE(SUM(igst_minor), 0)::bigint AS igst
       FROM invoices
       WHERE tenant_id = ? AND bdate >= ? AND bdate <= ? AND status = 'posted' AND kind = 'credit_note'`,
      [tenantId, startDate, endDate],
    );

    const salesTaxableMinor = Math.max(0, Number(salesAgg?.taxable || 0) - Number(creditAgg?.taxable || 0));
    const outputCgstMinor = Math.max(0, Number(salesAgg?.cgst || 0) - Number(creditAgg?.cgst || 0));
    const outputSgstMinor = Math.max(0, Number(salesAgg?.sgst || 0) - Number(creditAgg?.sgst || 0));
    const outputIgstMinor = Math.max(0, Number(salesAgg?.igst || 0) - Number(creditAgg?.igst || 0));
    const outputGstMinor = outputCgstMinor + outputSgstMinor + outputIgstMinor;

    // Inward: Purchases in this period
    const purchasesAgg = await ctx.db.one<{ taxable: number; cgst: number; sgst: number; igst: number; itc: number }>(
      `SELECT
        COALESCE(SUM(taxable_minor), 0)::bigint AS taxable,
        COALESCE(SUM(cgst_minor), 0)::bigint AS cgst,
        COALESCE(SUM(sgst_minor), 0)::bigint AS sgst,
        COALESCE(SUM(igst_minor), 0)::bigint AS igst,
        COALESCE(SUM(itc_minor), 0)::bigint AS itc
       FROM purchases
       WHERE tenant_id = ? AND COALESCE(purchase_date, bdate) >= ? AND COALESCE(purchase_date, bdate) <= ? AND status != 'voided'`,
      [tenantId, startDate, endDate],
    );
    const purchaseTaxableMinor = Number(purchasesAgg?.taxable || 0);
    const purchaseGstMinor = Number(purchasesAgg?.cgst || 0) + Number(purchasesAgg?.sgst || 0) + Number(purchasesAgg?.igst || 0);

    // Inward: Expenses in this period
    const expensesAgg = await ctx.db.one<{ taxable: number; totalGst: number; itc: number }>(
      `SELECT
        COALESCE(SUM(taxable_minor), 0)::bigint AS taxable,
        COALESCE(SUM(cgst_minor + sgst_minor + igst_minor), 0)::bigint AS "totalGst",
        COALESCE(SUM(itc_minor), 0)::bigint AS itc
       FROM expenses
       WHERE tenant_id = ? AND expense_date >= ? AND expense_date <= ? AND status != 'voided'`,
      [tenantId, startDate, endDate],
    );
    const expenseTaxableMinor = Number(expensesAgg?.taxable || 0);
    const expenseGstMinor = Number(expensesAgg?.totalGst || 0);

    // Authoritative ITC Reviews for this period
    const itcReviewsAgg = await ctx.db.one<{
      totalOriginalGst: number;
      reviewedEligibleItc: number;
      ineligibleItc: number;
      unresolvedMismatches: number;
      unreviewedCount: number;
    }>(
      `SELECT
        COALESCE(SUM(original_gst_minor), 0)::bigint AS "totalOriginalGst",
        COALESCE(SUM(reviewed_eligible_itc_minor), 0)::bigint AS "reviewedEligibleItc",
        COALESCE(SUM(ineligible_itc_minor), 0)::bigint AS "ineligibleItc",
        COUNT(*) FILTER (WHERE matching_status IN ('taxable_mismatch', 'gst_mismatch', 'missing_from_2b'))::int AS "unresolvedMismatches",
        COUNT(*) FILTER (WHERE eligibility_status = 'pending_review')::int AS "unreviewedCount"
       FROM itc_reviews
       WHERE tenant_id = ? AND return_period = ?`,
      [tenantId, period],
    );

    const potentialItcMinor = purchaseGstMinor + expenseGstMinor;
    const reviewedEligibleItcMinor = Number(itcReviewsAgg?.reviewedEligibleItc || 0);
    const ineligibleItcMinor = Number(itcReviewsAgg?.ineligibleItc || 0);
    const unresolvedMismatchesCount = Number(itcReviewsAgg?.unresolvedMismatches || 0);
    const unreviewedCount = Number(itcReviewsAgg?.unreviewedCount || 0);

    // If no reviews have been recorded yet, reviewedEligibleItc is 0 and potential is pending review
    const expenseGstUnderReviewMinor = unreviewedCount > 0 ? expenseGstMinor : 0;

    // Estimated net GST liability = Max(0, Output GST - Reviewed Eligible ITC)
    const estimatedNetGstLiabilityMinor = Math.max(0, outputGstMinor - reviewedEligibleItcMinor);

    // GSTR-1 & 3B status check
    const filingHistory = await ctx.db.query<{ return_type: string; status: string }>(
      'SELECT return_type, status FROM gst_filing_history WHERE tenant_id = ? AND return_period = ?',
      [tenantId, period],
    );
    const gstr1Record = filingHistory.find((f) => f.return_type === 'GSTR-1');
    const gstr3bRecord = filingHistory.find((f) => f.return_type === 'GSTR-3B');

    const gstr1Status = gstr1Record ? (gstr1Record.status as any) : salesTaxableMinor > 0 ? 'ready' : 'pending';
    const gstr3bStatus = gstr3bRecord
      ? (gstr3bRecord.status as any)
      : unreviewedCount === 0 && (purchaseGstMinor + expenseGstMinor) > 0
        ? 'ready_to_file'
        : 'pending_review';

    return {
      selectedGstin,
      returnPeriod: period,
      salesTaxableMinor,
      outputGstMinor,
      outputBreakup: {
        cgstMinor: outputCgstMinor,
        sgstMinor: outputSgstMinor,
        igstMinor: outputIgstMinor,
      },
      purchaseTaxableMinor,
      purchaseGstMinor,
      expenseTaxableMinor,
      expenseGstUnderReviewMinor,
      potentialItcMinor,
      reviewedEligibleItcMinor,
      ineligibleItcMinor,
      unresolvedMismatchesCount,
      estimatedNetGstLiabilityMinor,
      gstr1Status,
      gstr3bStatus,
    };
  });

  // --------------------------------------------------------------------------
  // 2. Sales Register (Outward Supplies)
  // --------------------------------------------------------------------------
  r.get('/api/gst/sales-register', requirePerm('gst.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const period = ctx.query.period || new Date().toISOString().slice(0, 7);
    const [year, month] = period.split('-').map(Number);
    const startDate = `${period}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${period}-${String(lastDay).padStart(2, '0')}`;

    const invoices = await ctx.db.query(
      `SELECT
        i.id, i.number, i.bdate, i.kind, i.customer_name, i.customer_gstin,
        i.place_state, i.intra, i.taxable_minor, i.cgst_minor, i.sgst_minor, i.igst_minor,
        i.round_off_minor, i.total_minor, i.status
       FROM invoices i
       WHERE i.tenant_id = ? AND i.bdate >= ? AND i.bdate <= ? AND i.status = 'posted'
       ORDER BY i.bdate ASC, i.number ASC`,
      [tenantId, startDate, endDate],
    );

    const b2b = invoices.filter((i: any) => {
      const gstin = i.customerGstin ?? i.customer_gstin;
      return Boolean(gstin && gstin.trim());
    });
    const b2c = invoices.filter((i: any) => {
      const gstin = i.customerGstin ?? i.customer_gstin;
      return !gstin || !gstin.trim();
    });

    return {
      period,
      invoices: invoices.map((i: any) => {
        const taxable = Number(i.taxableMinor ?? i.taxable_minor ?? 0);
        const cgst = Number(i.cgstMinor ?? i.cgst_minor ?? 0);
        const sgst = Number(i.sgstMinor ?? i.sgst_minor ?? 0);
        const igst = Number(i.igstMinor ?? i.igst_minor ?? 0);
        const total = Number(i.totalMinor ?? i.total_minor ?? 0);
        return {
          id: i.id,
          number: i.number,
          invoiceNumber: i.number,
          date: i.bdate,
          invoiceDate: i.bdate,
          type: i.kind === 'sale' ? 'Tax Invoice' : 'Credit Note',
          customerName: i.customerName ?? i.customer_name ?? 'Counter Customer',
          customerGstin: i.customerGstin ?? i.customer_gstin ?? null,
          supplyType: i.intra ? 'Intra-State' : 'Inter-State',
          placeOfSupply: i.placeState ?? i.place_state ?? '33',
          taxableMinor: taxable,
          cgstMinor: cgst,
          sgstMinor: sgst,
          igstMinor: igst,
          totalGstMinor: cgst + sgst + igst,
          totalMinor: total,
        };
      }),
      summary: {
        totalInvoices: invoices.length,
        b2bCount: b2b.length,
        b2cCount: b2c.length,
        totalTaxableMinor: invoices.reduce((sum, i: any) => sum + Number(i.taxableMinor ?? i.taxable_minor ?? 0), 0),
        totalGstMinor: invoices.reduce((sum, i: any) => sum + Number(i.cgstMinor ?? i.cgst_minor ?? 0) + Number(i.sgstMinor ?? i.sgst_minor ?? 0) + Number(i.igstMinor ?? i.igst_minor ?? 0), 0),
        totalAmountMinor: invoices.reduce((sum, i: any) => sum + Number(i.totalMinor ?? i.total_minor ?? 0), 0),
      },
    };
  });

  // --------------------------------------------------------------------------
  // 3. Purchase Register (Inward Supplies: Goods Purchases + Operational Expenses)
  // --------------------------------------------------------------------------
  r.get('/api/gst/purchase-register', requirePerm('gst.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const period = ctx.query.period || new Date().toISOString().slice(0, 7);
    const [year, month] = period.split('-').map(Number);
    const startDate = `${period}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${period}-${String(lastDay).padStart(2, '0')}`;

    // Goods Purchases
    const purchases = await ctx.db.query(
      `SELECT
        p.id, p.purchase_number, COALESCE(p.purchase_date, p.bdate) AS doc_date,
        p.supplier_invoice_number, p.supplier_invoice_date,
        part.name AS supplier_name, part.gstin AS supplier_gstin,
        p.taxable_minor, p.cgst_minor, p.sgst_minor, p.igst_minor, p.total_minor, p.itc_minor
       FROM purchases p
       LEFT JOIN parties part ON part.id = p.supplier_id AND part.tenant_id = p.tenant_id
       WHERE p.tenant_id = ? AND COALESCE(p.purchase_date, p.bdate) >= ? AND COALESCE(p.purchase_date, p.bdate) <= ? AND p.status != 'voided'
       ORDER BY doc_date ASC`,
      [tenantId, startDate, endDate],
    );

    // Operational Expenses
    const expenses = await ctx.db.query(
      `SELECT
        id, expense_number, expense_date AS doc_date,
        supplier_invoice_number, supplier_invoice_date,
        supplier_name, supplier_gstin, category,
        taxable_minor, cgst_minor, sgst_minor, igst_minor, total_minor, itc_minor
       FROM expenses
       WHERE tenant_id = ? AND expense_date >= ? AND expense_date <= ? AND status != 'voided'
       ORDER BY expense_date ASC`,
      [tenantId, startDate, endDate],
    );

    const items = [
      ...purchases.map((p: any) => {
        const taxable = Number(p.taxableMinor ?? p.taxable_minor ?? 0);
        const cgst = Number(p.cgstMinor ?? p.cgst_minor ?? 0);
        const sgst = Number(p.sgstMinor ?? p.sgst_minor ?? 0);
        const igst = Number(p.igstMinor ?? p.igst_minor ?? 0);
        const total = Number(p.totalMinor ?? p.total_minor ?? 0);
        const itc = Number(p.itcMinor ?? p.itc_minor ?? (cgst + sgst + igst));
        return {
          id: p.id,
          docType: 'Purchase (Goods)',
          docNumber: p.purchaseNumber ?? p.purchase_number ?? ('PUR-' + p.id.slice(-4)),
          docDate: p.docDate ?? p.doc_date,
          supplierName: p.supplierName ?? p.supplier_name ?? 'Vendor',
          supplierGstin: p.supplierGstin ?? p.supplier_gstin ?? null,
          invoiceNumber: p.supplierInvoiceNumber ?? p.supplier_invoice_number ?? '-',
          invoiceDate: p.supplierInvoiceDate ?? p.supplier_invoice_date ?? p.docDate ?? p.doc_date,
          taxableMinor: taxable,
          cgstMinor: cgst,
          sgstMinor: sgst,
          igstMinor: igst,
          totalGstMinor: cgst + sgst + igst,
          totalMinor: total,
          itcMinor: itc,
        };
      }),
      ...expenses.map((e: any) => {
        const taxable = Number(e.taxableMinor ?? e.taxable_minor ?? 0);
        const cgst = Number(e.cgstMinor ?? e.cgst_minor ?? 0);
        const sgst = Number(e.sgstMinor ?? e.sgst_minor ?? 0);
        const igst = Number(e.igstMinor ?? e.igst_minor ?? 0);
        const total = Number(e.totalMinor ?? e.total_minor ?? 0);
        const itc = Number(e.itcMinor ?? e.itc_minor ?? 0);
        return {
          id: e.id,
          docType: `Expense (${e.category})`,
          docNumber: e.expenseNumber ?? e.expense_number,
          docDate: e.docDate ?? e.doc_date,
          supplierName: e.supplierName ?? e.supplier_name ?? 'Service Provider',
          supplierGstin: e.supplierGstin ?? e.supplier_gstin ?? null,
          invoiceNumber: e.supplierInvoiceNumber ?? e.supplier_invoice_number ?? '-',
          invoiceDate: e.supplierInvoiceDate ?? e.supplier_invoice_date ?? e.docDate ?? e.doc_date,
          taxableMinor: taxable,
          cgstMinor: cgst,
          sgstMinor: sgst,
          igstMinor: igst,
          totalGstMinor: cgst + sgst + igst,
          totalMinor: total,
          itcMinor: itc,
        };
      }),
    ].sort((a, b) => (a.docDate || '').localeCompare(b.docDate || ''));

    return {
      period,
      items,
      summary: {
        totalRecords: items.length,
        purchasesCount: purchases.length,
        expensesCount: expenses.length,
        totalTaxableMinor: items.reduce((sum, i) => sum + i.taxableMinor, 0),
        totalGstMinor: items.reduce((sum, i) => sum + i.totalGstMinor, 0),
        totalItcMinor: items.reduce((sum, i) => sum + i.itcMinor, 0),
        totalAmountMinor: items.reduce((sum, i) => sum + i.totalMinor, 0),
      },
    };
  });

  // --------------------------------------------------------------------------
  // 4. Combined ITC Register & Reconciliation
  // --------------------------------------------------------------------------
  r.get('/api/gst/itc-register', requirePerm('gst.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const period = ctx.query.period || new Date().toISOString().slice(0, 7);
    const [year, month] = period.split('-').map(Number);
    const startDate = `${period}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${period}-${String(lastDay).padStart(2, '0')}`;

    // 1. Fetch all book records (purchases with GST and expenses with GST)
    const purchases = await ctx.db.query(
      `SELECT
        p.id, p.purchase_number, COALESCE(p.purchase_date, p.bdate) AS doc_date,
        p.supplier_invoice_number, p.supplier_invoice_date,
        part.name AS supplier_name, part.gstin AS supplier_gstin,
        p.taxable_minor, p.cgst_minor, p.sgst_minor, p.igst_minor, p.total_minor, p.itc_minor
       FROM purchases p
       LEFT JOIN parties part ON part.id = p.supplier_id AND part.tenant_id = p.tenant_id
       WHERE p.tenant_id = ? AND COALESCE(p.purchase_date, p.bdate) >= ? AND COALESCE(p.purchase_date, p.bdate) <= ? AND p.status != 'voided'
         AND (p.cgst_minor + p.sgst_minor + p.igst_minor) > 0`,
      [tenantId, startDate, endDate],
    );

    const expenses = await ctx.db.query(
      `SELECT
        id, expense_number, expense_date AS doc_date,
        supplier_invoice_number, supplier_invoice_date,
        supplier_name, supplier_gstin, category,
        taxable_minor, cgst_minor, sgst_minor, igst_minor, total_minor, itc_minor
       FROM expenses
       WHERE tenant_id = ? AND expense_date >= ? AND expense_date <= ? AND status != 'voided'
         AND (cgst_minor + sgst_minor + igst_minor) > 0`,
      [tenantId, startDate, endDate],
    );

    // 2. Fetch existing ITC review records
    const reviews = await ctx.db.query(
      `SELECT * FROM itc_reviews
       WHERE tenant_id = ? AND return_period = ?`,
      [tenantId, period],
    );
    const reviewMap = new Map<string, any>();
    for (const rev of reviews) {
      const docType = rev.docType ?? rev.doc_type;
      const docId = rev.docId ?? rev.doc_id;
      reviewMap.set(`${docType}_${docId}`, rev);
    }

    // 3. Combine book records with review state
    const registerItems = [
      ...purchases.map((p: any) => {
        const rev = reviewMap.get(`purchase_${p.id}`);
        const cgst = Number(p.cgstMinor ?? p.cgst_minor ?? 0);
        const sgst = Number(p.sgstMinor ?? p.sgst_minor ?? 0);
        const igst = Number(p.igstMinor ?? p.igst_minor ?? 0);
        const totalGst = cgst + sgst + igst;
        const revEligible = rev ? (rev.reviewedEligibleItcMinor ?? rev.reviewed_eligible_itc_minor) : null;
        const reviewedEligible = revEligible !== null && revEligible !== undefined ? Number(revEligible) : Number(p.itcMinor ?? p.itc_minor ?? totalGst);
        const revIneligible = rev ? (rev.ineligibleItcMinor ?? rev.ineligible_itc_minor) : null;
        const ineligible = revIneligible !== null && revIneligible !== undefined ? Number(revIneligible) : Math.max(0, totalGst - reviewedEligible);
        const supplierGstin = p.supplierGstin ?? p.supplier_gstin;

        return {
          id: rev?.id || p.id,
          docType: 'purchase' as const,
          docId: p.id,
          docNumber: p.purchaseNumber ?? p.purchase_number ?? ('PUR-' + p.id.slice(-4)),
          docDate: p.docDate ?? p.doc_date,
          supplierName: p.supplierName ?? p.supplier_name ?? 'Vendor',
          supplierGstin: supplierGstin || null,
          supplierInvoiceNumber: p.supplierInvoiceNumber ?? p.supplier_invoice_number ?? p.purchaseNumber ?? p.purchase_number,
          supplierInvoiceDate: p.supplierInvoiceDate ?? p.supplier_invoice_date ?? p.docDate ?? p.doc_date,
          taxableMinor: Number(p.taxableMinor ?? p.taxable_minor ?? 0),
          cgstMinor: cgst,
          sgstMinor: sgst,
          igstMinor: igst,
          totalGstMinor: totalGst,
          totalAmountMinor: Number(p.totalMinor ?? p.total_minor ?? 0),
          gstr2bMatchingStatus: (rev?.matchingStatus ?? rev?.matching_status ?? (supplierGstin ? 'pending_review' : 'missing_from_2b')) as ItcMatchingStatus,
          itcReviewStatus: (rev?.eligibilityStatus ?? rev?.eligibility_status ?? (supplierGstin ? 'pending_review' : 'ineligible_reviewed')) as ItcReviewStatus,
          reviewedEligibleItcMinor: reviewedEligible,
          ineligibleItcMinor: ineligible,
          mismatchMinor: Number(rev?.mismatchMinor ?? rev?.mismatch_minor ?? 0),
          reviewDecisionReason: rev?.reviewDecisionReason ?? rev?.review_decision_reason ?? null,
          reviewedBy: rev?.reviewedBy ?? rev?.reviewed_by ?? null,
          reviewedAt: rev?.reviewedAt ?? rev?.reviewed_at ?? null,
          sourceLink: `/purchases?id=${p.id}`,
        };
      }),
      ...expenses.map((e: any) => {
        const rev = reviewMap.get(`expense_${e.id}`);
        const cgst = Number(e.cgstMinor ?? e.cgst_minor ?? 0);
        const sgst = Number(e.sgstMinor ?? e.sgst_minor ?? 0);
        const igst = Number(e.igstMinor ?? e.igst_minor ?? 0);
        const totalGst = cgst + sgst + igst;
        const revEligible = rev ? (rev.reviewedEligibleItcMinor ?? rev.reviewed_eligible_itc_minor) : null;
        const reviewedEligible = revEligible !== null && revEligible !== undefined ? Number(revEligible) : Number(e.itcMinor ?? e.itc_minor ?? 0);
        const revIneligible = rev ? (rev.ineligibleItcMinor ?? rev.ineligible_itc_minor) : null;
        const ineligible = revIneligible !== null && revIneligible !== undefined ? Number(revIneligible) : Math.max(0, totalGst - reviewedEligible);
        const supplierGstin = e.supplierGstin ?? e.supplier_gstin;

        return {
          id: rev?.id || e.id,
          docType: 'expense' as const,
          docId: e.id,
          docNumber: e.expenseNumber ?? e.expense_number,
          docDate: e.docDate ?? e.doc_date,
          supplierName: e.supplierName ?? e.supplier_name ?? e.category,
          supplierGstin: supplierGstin || null,
          supplierInvoiceNumber: e.supplierInvoiceNumber ?? e.supplier_invoice_number ?? e.expenseNumber ?? e.expense_number,
          supplierInvoiceDate: e.supplierInvoiceDate ?? e.supplier_invoice_date ?? e.docDate ?? e.doc_date,
          taxableMinor: Number(e.taxableMinor ?? e.taxable_minor ?? 0),
          cgstMinor: cgst,
          sgstMinor: sgst,
          igstMinor: igst,
          totalGstMinor: totalGst,
          totalAmountMinor: Number(e.totalMinor ?? e.total_minor ?? 0),
          gstr2bMatchingStatus: (rev?.matchingStatus ?? rev?.matching_status ?? (supplierGstin ? 'pending_review' : 'missing_from_2b')) as ItcMatchingStatus,
          itcReviewStatus: (rev?.eligibilityStatus ?? rev?.eligibility_status ?? (supplierGstin ? 'pending_review' : 'ineligible_reviewed')) as ItcReviewStatus,
          reviewedEligibleItcMinor: reviewedEligible,
          ineligibleItcMinor: ineligible,
          mismatchMinor: Number(rev?.mismatchMinor ?? rev?.mismatch_minor ?? 0),
          reviewDecisionReason: rev?.reviewDecisionReason ?? rev?.review_decision_reason ?? null,
          reviewedBy: rev?.reviewedBy ?? rev?.reviewed_by ?? null,
          reviewedAt: rev?.reviewedAt ?? rev?.reviewed_at ?? null,
          sourceLink: `/expenses?id=${e.id}`,
        };
      }),
    ];

    // Summary calculations
    const totalPotentialItc = registerItems.reduce((sum, item) => sum + item.totalGstMinor, 0);
    const totalReviewedEligibleItc = registerItems.reduce((sum, item) => sum + item.reviewedEligibleItcMinor, 0);
    const totalIneligibleItc = registerItems.reduce((sum, item) => sum + item.ineligibleItcMinor, 0);
    const pendingReviewCount = registerItems.filter((item) => item.itcReviewStatus === 'pending_review').length;
    const matchedCount = registerItems.filter((item) => item.gstr2bMatchingStatus === 'matched').length;
    const mismatchCount = registerItems.filter((item) => ['taxable_mismatch', 'gst_mismatch'].includes(item.gstr2bMatchingStatus)).length;
    const missingIn2BCount = registerItems.filter((item) => item.gstr2bMatchingStatus === 'missing_from_2b').length;

    return {
      period,
      items: registerItems,
      summary: {
        totalRecords: registerItems.length,
        totalPotentialItcMinor: totalPotentialItc,
        totalReviewedEligibleItcMinor: totalReviewedEligibleItc,
        totalIneligibleItcMinor: totalIneligibleItc,
        pendingReviewCount,
        matchedCount,
        mismatchCount,
        missingIn2BCount,
      },
    };
  });

  // --------------------------------------------------------------------------
  // 5. Record/Update ITC Review Decision
  // --------------------------------------------------------------------------
  r.post('/api/gst/itc-review', requirePerm('gst.manage'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};

    const docType = V.oneOf(b.docType, 'Document type', ['purchase', 'expense']);
    const docId = V.str(b.docId, 'Document ID', { required: true });
    const period = V.str(b.returnPeriod, 'Return period (YYYY-MM)', { required: true });
    const eligibilityStatus = V.oneOf(
      b.eligibilityStatus,
      'Eligibility status',
      ['eligible_reviewed', 'partially_eligible_reviewed', 'ineligible_reviewed', 'blocked_17_5', 'requires_correction'],
      'eligible_reviewed',
    ) as ItcReviewStatus;

    const reviewedEligibleItcMinor = V.int(b.reviewedEligibleItcMinor, 'Eligible ITC amount', { min: 0 });
    const reason = V.str(b.reason, 'Review decision reason', { required: true, max: 500 });

    // Verify document exists
    let originalTaxable = 0;
    let originalCgst = 0;
    let originalSgst = 0;
    let originalIgst = 0;
    let originalGst = 0;

    if (docType === 'purchase') {
      const p = await ctx.db.one<any>('SELECT * FROM purchases WHERE id = ? AND tenant_id = ?', [docId, tenantId]);
      if (!p) throw notFound('Purchase document');
      originalTaxable = Number(p.taxable_minor || 0);
      originalCgst = Number(p.cgst_minor || 0);
      originalSgst = Number(p.sgst_minor || 0);
      originalIgst = Number(p.igst_minor || 0);
      originalGst = originalCgst + originalSgst + originalIgst;
    } else {
      const e = await ctx.db.one<any>('SELECT * FROM expenses WHERE id = ? AND tenant_id = ?', [docId, tenantId]);
      if (!e) throw notFound('Expense document');
      originalTaxable = Number(e.taxable_minor || 0);
      originalCgst = Number(e.cgst_minor || 0);
      originalSgst = Number(e.sgst_minor || 0);
      originalIgst = Number(e.igst_minor || 0);
      originalGst = originalCgst + originalSgst + originalIgst;
    }

    if (reviewedEligibleItcMinor > originalGst) {
      throw bad('Reviewed eligible ITC cannot exceed original tax amount.', 'VALIDATION');
    }

    const ineligibleMinor = Math.max(0, originalGst - reviewedEligibleItcMinor);

    let savedReview: any = null;
    await ctx.db.tx(async (q) => {
      savedReview = await q.one(
        `INSERT INTO itc_reviews (
          id, tenant_id, doc_type, doc_id, return_period,
          original_taxable_minor, original_cgst_minor, original_sgst_minor, original_igst_minor, original_gst_minor,
          eligibility_status, reviewed_eligible_itc_minor, ineligible_itc_minor,
          review_decision_reason, reviewed_by, reviewed_at, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, now(), now(), now()
        ) ON CONFLICT (tenant_id, doc_type, doc_id) DO UPDATE SET
          eligibility_status = EXCLUDED.eligibility_status,
          reviewed_eligible_itc_minor = EXCLUDED.reviewed_eligible_itc_minor,
          ineligible_itc_minor = EXCLUDED.ineligible_itc_minor,
          review_decision_reason = EXCLUDED.review_decision_reason,
          reviewed_by = EXCLUDED.reviewed_by,
          reviewed_at = now(),
          updated_at = now()
        RETURNING *`,
        [
          newId('itc'), tenantId, docType, docId, period,
          originalTaxable, originalCgst, originalSgst, originalIgst, originalGst,
          eligibilityStatus, reviewedEligibleItcMinor, ineligibleMinor,
          reason, ctx.user!.id,
        ],
      );

      // Keep source document's itc_minor updated in sync with authoritative review
      if (docType === 'purchase') {
        await q.exec('UPDATE purchases SET itc_minor = ? WHERE id = ? AND tenant_id = ?', [reviewedEligibleItcMinor, docId, tenantId]);
      } else {
        await q.exec('UPDATE expenses SET itc_minor = ? WHERE id = ? AND tenant_id = ?', [reviewedEligibleItcMinor, docId, tenantId]);
      }

      await audit(q, ctx, {
        action: 'itc.review',
        entity: 'itc_review',
        entityId: savedReview.id,
        detail: { docType, docId, eligibilityStatus, reviewedEligibleItcMinor, reason },
      });
    });

    return { ok: true, review: savedReview };
  });

  // --------------------------------------------------------------------------
  // 6. GSTR-2B Import & Auto-Reconciliation
  // --------------------------------------------------------------------------
  r.post('/api/gst/gstr2b/import', requirePerm('gst.manage'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};

    const gstin = V.str(b.gstin, 'GSTIN', { required: true });
    const returnPeriod = V.str(b.returnPeriod, 'Return Period (YYYY-MM)', { required: true });
    const filename = V.str(b.filename, 'File name', { required: true });
    const fileFormat = V.oneOf(b.fileFormat, 'File format', ['json', 'csv']);

    let parseResult: { ok: boolean; error?: string; records: any[] };
    if (fileFormat === 'json') {
      const jsonData = typeof b.fileContent === 'string' ? JSON.parse(b.fileContent) : b.fileContent;
      parseResult = validateGstr2bJson(jsonData);
    } else {
      const csvData = typeof b.fileContent === 'string' ? b.fileContent : '';
      parseResult = validateGstr2bCsv(csvData);
    }

    if (!parseResult.ok) {
      throw bad(parseResult.error || 'Failed to parse GSTR-2B file', 'PARSE_ERROR');
    }

    const records = parseResult.records;
    if (records.length === 0) {
      throw bad('No valid invoice records found in GSTR-2B file', 'EMPTY_FILE');
    }

    // Duplicate detection: check if same file or identical import exists
    const duplicateImport = await ctx.db.one(
      'SELECT id, filename, created_at FROM gstr2b_imports WHERE tenant_id = ? AND gstin = ? AND return_period = ? AND filename = ?',
      [tenantId, gstin, returnPeriod, filename],
    );
    if (duplicateImport && !b.forceOverwrite) {
      throw conflict(
        `File "${filename}" has already been imported for period ${returnPeriod}. Set forceOverwrite: true if you wish to re-import.`,
        'DUPLICATE_IMPORT',
      );
    }

    // Fetch existing book records for this period (both purchases and expenses)
    const [year, month] = returnPeriod.split('-').map(Number);
    const startDate = `${returnPeriod}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${returnPeriod}-${String(lastDay).padStart(2, '0')}`;

    const bookPurchases = await ctx.db.query(
      `SELECT
        p.id, p.purchase_number, COALESCE(p.purchase_date, p.bdate) AS doc_date,
        p.supplier_invoice_number, p.supplier_invoice_date,
        part.gstin AS supplier_gstin, p.taxable_minor, p.cgst_minor, p.sgst_minor, p.igst_minor
       FROM purchases p
       LEFT JOIN parties part ON part.id = p.supplier_id AND part.tenant_id = p.tenant_id
       WHERE p.tenant_id = ? AND COALESCE(p.purchase_date, p.bdate) >= ? AND COALESCE(p.purchase_date, p.bdate) <= ? AND p.status != 'voided'`,
      [tenantId, startDate, endDate],
    );

    const bookExpenses = await ctx.db.query(
      `SELECT
        id, expense_number, expense_date AS doc_date,
        supplier_invoice_number, supplier_invoice_date,
        supplier_gstin, taxable_minor, cgst_minor, sgst_minor, igst_minor
       FROM expenses
       WHERE tenant_id = ? AND expense_date >= ? AND expense_date <= ? AND status != 'voided'`,
      [tenantId, startDate, endDate],
    );

    const allBookRecords: BookRecordForMatch[] = [
      ...bookPurchases.map((p: any) => {
        const cgst = Number(p.cgstMinor ?? p.cgst_minor ?? 0);
        const sgst = Number(p.sgstMinor ?? p.sgst_minor ?? 0);
        const igst = Number(p.igstMinor ?? p.igst_minor ?? 0);
        return {
          docType: 'purchase' as const,
          docId: p.id,
          docNumber: p.purchaseNumber ?? p.purchase_number ?? ('PUR-' + p.id.slice(-4)),
          supplierGstin: p.supplierGstin ?? p.supplier_gstin,
          supplierInvoiceNumber: p.supplierInvoiceNumber ?? p.supplier_invoice_number ?? p.purchaseNumber ?? p.purchase_number,
          supplierInvoiceDate: p.supplierInvoiceDate ?? p.supplier_invoice_date ?? p.docDate ?? p.doc_date,
          taxableMinor: Number(p.taxableMinor ?? p.taxable_minor ?? 0),
          cgstMinor: cgst,
          sgstMinor: sgst,
          igstMinor: igst,
          totalGstMinor: cgst + sgst + igst,
        };
      }),
      ...bookExpenses.map((e: any) => {
        const cgst = Number(e.cgstMinor ?? e.cgst_minor ?? 0);
        const sgst = Number(e.sgstMinor ?? e.sgst_minor ?? 0);
        const igst = Number(e.igstMinor ?? e.igst_minor ?? 0);
        return {
          docType: 'expense' as const,
          docId: e.id,
          docNumber: e.expenseNumber ?? e.expense_number,
          supplierGstin: e.supplierGstin ?? e.supplier_gstin,
          supplierInvoiceNumber: e.supplierInvoiceNumber ?? e.supplier_invoice_number ?? e.expenseNumber ?? e.expense_number,
          supplierInvoiceDate: e.supplierInvoiceDate ?? e.supplier_invoice_date ?? e.docDate ?? e.doc_date,
          taxableMinor: Number(e.taxableMinor ?? e.taxable_minor ?? 0),
          cgstMinor: cgst,
          sgstMinor: sgst,
          igstMinor: igst,
          totalGstMinor: cgst + sgst + igst,
        };
      }),
    ];

    // Build lookup for fast matching
    const bookLookup = new Map<string, BookRecordForMatch>();
    for (const b of allBookRecords) {
      if (b.supplierGstin && b.supplierInvoiceNumber) {
        const key = `${b.supplierGstin.trim().toUpperCase()}__${normalizeInvoiceNumber(b.supplierInvoiceNumber)}`;
        bookLookup.set(key, b);
      }
    }

    const importId = newId('imp');
    let totalTaxableMinor = 0;
    let totalCgstMinor = 0;
    let totalSgstMinor = 0;
    let totalIgstMinor = 0;
    let matchedCount = 0;
    let mismatchedCount = 0;
    let missingInBooksCount = 0;

    const matchedBookKeys = new Set<string>();

    await ctx.db.tx(async (q) => {
      // If overwriting, delete previous records
      if (duplicateImport) {
        await q.exec('DELETE FROM gstr2b_imports WHERE id = ?', [duplicateImport.id]);
      }

      // Save individual 2B records and reconcile
      for (const rec of records) {
        const recordId = newId('g2b');
        const taxable = Number(rec.taxableMinor || 0);
        const cgst = Number(rec.cgstMinor || 0);
        const sgst = Number(rec.sgstMinor || 0);
        const igst = Number(rec.igstMinor || 0);
        const totalGst = Number(rec.totalGstMinor || (cgst + sgst + igst));

        totalTaxableMinor += taxable;
        totalCgstMinor += cgst;
        totalSgstMinor += sgst;
        totalIgstMinor += igst;

        const gstinKey = (rec.supplierGstin || '').trim().toUpperCase();
        const invKey = normalizeInvoiceNumber(rec.invoiceNumber || '');
        const matchKey = `${gstinKey}__${invKey}`;

        const bookRecord = bookLookup.get(matchKey);
        let matchStatus: ItcMatchingStatus = 'missing_in_books';
        let linkedDocType: string | null = null;
        let linkedDocId: string | null = null;

        if (bookRecord) {
          matchedBookKeys.add(matchKey);
          linkedDocType = bookRecord.docType;
          linkedDocId = bookRecord.docId;

          const matchComp = compareBookAnd2B(bookRecord, {
            id: recordId,
            supplierGstin: rec.supplierGstin,
            invoiceNumber: rec.invoiceNumber,
            invoiceDate: rec.invoiceDate,
            taxableMinor: taxable,
            cgstMinor: cgst,
            sgstMinor: sgst,
            igstMinor: igst,
            totalGstMinor: totalGst,
          });
          matchStatus = matchComp.status;

          if (matchStatus === 'matched') {
            matchedCount++;
          } else {
            mismatchedCount++;
          }

          // Update corresponding itc_reviews record with GSTR-2B match status
          await q.exec(
            `INSERT INTO itc_reviews (
              id, tenant_id, doc_type, doc_id, return_period,
              original_taxable_minor, original_cgst_minor, original_sgst_minor, original_igst_minor, original_gst_minor,
              gstr2b_record_id, matching_status, eligibility_status,
              reviewed_eligible_cgst_minor, reviewed_eligible_sgst_minor, reviewed_eligible_igst_minor, reviewed_eligible_itc_minor,
              ineligible_itc_minor, mismatch_minor, review_decision_reason, reviewed_by, reviewed_at, created_at, updated_at
            ) VALUES (
              ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?,
              ?, ?, 'pending_review',
              ?, ?, ?, ?,
              0, ?, 'Auto-matched from GSTR-2B import', ?, now(), now(), now()
            ) ON CONFLICT (tenant_id, doc_type, doc_id) DO UPDATE SET
              gstr2b_record_id = EXCLUDED.gstr2b_record_id,
              matching_status = EXCLUDED.matching_status,
              mismatch_minor = EXCLUDED.mismatch_minor,
              updated_at = now()`,
            [
              newId('itc'), tenantId, bookRecord.docType, bookRecord.docId, returnPeriod,
              bookRecord.taxableMinor, bookRecord.cgstMinor, bookRecord.sgstMinor, bookRecord.igstMinor, bookRecord.totalGstMinor,
              recordId, matchStatus,
              matchStatus === 'matched' ? bookRecord.cgstMinor : 0,
              matchStatus === 'matched' ? bookRecord.sgstMinor : 0,
              matchStatus === 'matched' ? bookRecord.igstMinor : 0,
              matchStatus === 'matched' ? bookRecord.totalGstMinor : 0,
              Math.abs(bookRecord.totalGstMinor - totalGst), ctx.user!.id,
            ],
          );
        } else {
          missingInBooksCount++;
        }

        await q.exec(
          `INSERT INTO gstr2b_records (
            id, tenant_id, import_id, return_period,
            supplier_gstin, supplier_name, invoice_number, invoice_type, invoice_date,
            taxable_minor, cgst_minor, sgst_minor, igst_minor, cess_minor, total_gst_minor,
            itc_availability, reason, matched_status, linked_doc_type, linked_doc_id, created_at
          ) VALUES (
            ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, now()
          )`,
          [
            recordId, tenantId, importId, returnPeriod,
            rec.supplierGstin, rec.supplierName, rec.invoiceNumber, rec.invoiceType || 'regular', rec.invoiceDate,
            taxable, cgst, sgst, igst, rec.cessMinor || 0, totalGst,
            rec.itcAvailability || 'Y', rec.reason || null, matchStatus, linkedDocType, linkedDocId,
          ],
        );
      }

      // Any book record with GST not present in GSTR-2B is flagged as missing_from_2b
      for (const [key, bookRec] of bookLookup.entries()) {
        if (!matchedBookKeys.has(key)) {
          await q.exec(
            `INSERT INTO itc_reviews (
              id, tenant_id, doc_type, doc_id, return_period,
              original_taxable_minor, original_cgst_minor, original_sgst_minor, original_igst_minor, original_gst_minor,
              matching_status, eligibility_status,
              reviewed_eligible_itc_minor, ineligible_itc_minor, mismatch_minor,
              review_decision_reason, reviewed_by, reviewed_at, created_at, updated_at
            ) VALUES (
              ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?,
              'missing_from_2b', 'pending_review',
              0, ?, ?,
              'Missing in GSTR-2B', ?, now(), now(), now()
            ) ON CONFLICT (tenant_id, doc_type, doc_id) DO UPDATE SET
              matching_status = 'missing_from_2b',
              updated_at = now()`,
            [
              newId('itc'), tenantId, bookRec.docType, bookRec.docId, returnPeriod,
              bookRec.taxableMinor, bookRec.cgstMinor, bookRec.sgstMinor, bookRec.igstMinor, bookRec.totalGstMinor,
              bookRec.totalGstMinor, bookRec.totalGstMinor, ctx.user!.id,
            ],
          );
        }
      }

      // Save master import record
      await q.exec(
        `INSERT INTO gstr2b_imports (
          id, tenant_id, gstin, return_period, filename, file_format,
          total_records, total_taxable_minor, total_cgst_minor, total_sgst_minor, total_igst_minor,
          matched_count, mismatched_count, missing_in_books_count, created_by, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, now()
        )`,
        [
          importId, tenantId, gstin, returnPeriod, filename, fileFormat,
          records.length, totalTaxableMinor, totalCgstMinor, totalSgstMinor, totalIgstMinor,
          matchedCount, mismatchedCount, missingInBooksCount, ctx.user!.id,
        ],
      );

      await audit(q, ctx, {
        action: 'gstr2b.import',
        entity: 'gstr2b_import',
        entityId: importId,
        detail: { filename, returnPeriod, totalRecords: records.length, matchedCount, mismatchedCount, missingInBooksCount },
      });
    });

    return {
      ok: true,
      importId,
      filename,
      returnPeriod,
      totalRecords: records.length,
      matchedCount,
      mismatchedCount,
      missingInBooksCount,
    };
  });

  // --------------------------------------------------------------------------
  // 7. GSTR-3B Preparation
  // --------------------------------------------------------------------------
  r.get('/api/gst/gstr3b', requirePerm('gst.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const period = ctx.query.period || new Date().toISOString().slice(0, 7);
    const tenant = await ctx.db.one<{ gstin?: string }>('SELECT gstin FROM tenants WHERE id = ?', [tenantId]);
    const gstin = ctx.query.gstin || tenant?.gstin || '';

    const [year, month] = period.split('-').map(Number);
    const startDate = `${period}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${period}-${String(lastDay).padStart(2, '0')}`;

    // Table 3.1: Outward supplies from posted sales invoices and credit notes
    const sales = await ctx.db.one<{ taxable: number; cgst: number; sgst: number; igst: number }>(
      `SELECT
        COALESCE(SUM(taxable_minor), 0)::bigint AS taxable,
        COALESCE(SUM(cgst_minor), 0)::bigint AS cgst,
        COALESCE(SUM(sgst_minor), 0)::bigint AS sgst,
        COALESCE(SUM(igst_minor), 0)::bigint AS igst
       FROM invoices
       WHERE tenant_id = ? AND bdate >= ? AND bdate <= ? AND status = 'posted' AND kind = 'sale'`,
      [tenantId, startDate, endDate],
    );

    const credits = await ctx.db.one<{ taxable: number; cgst: number; sgst: number; igst: number }>(
      `SELECT
        COALESCE(SUM(taxable_minor), 0)::bigint AS taxable,
        COALESCE(SUM(cgst_minor), 0)::bigint AS cgst,
        COALESCE(SUM(sgst_minor), 0)::bigint AS sgst,
        COALESCE(SUM(igst_minor), 0)::bigint AS igst
       FROM invoices
       WHERE tenant_id = ? AND bdate >= ? AND bdate <= ? AND status = 'posted' AND kind = 'credit_note'`,
      [tenantId, startDate, endDate],
    );

    const outTaxable = Math.max(0, Number(sales?.taxable || 0) - Number(credits?.taxable || 0));
    const outCgst = Math.max(0, Number(sales?.cgst || 0) - Number(credits?.cgst || 0));
    const outSgst = Math.max(0, Number(sales?.sgst || 0) - Number(credits?.sgst || 0));
    const outIgst = Math.max(0, Number(sales?.igst || 0) - Number(credits?.igst || 0));

    // Table 4: Eligible ITC strictly from authoritative reviewed records
    const itcAgg = await ctx.db.one<{
      eligibleCgst: number;
      eligibleSgst: number;
      eligibleIgst: number;
      eligibleTotal: number;
      ineligibleTotal: number;
      unreviewedCount: number;
      mismatchCount: number;
    }>(
      `SELECT
        COALESCE(SUM(reviewed_eligible_cgst_minor), 0)::bigint AS "eligibleCgst",
        COALESCE(SUM(reviewed_eligible_sgst_minor), 0)::bigint AS "eligibleSgst",
        COALESCE(SUM(reviewed_eligible_igst_minor), 0)::bigint AS "eligibleIgst",
        COALESCE(SUM(reviewed_eligible_itc_minor), 0)::bigint AS "eligibleTotal",
        COALESCE(SUM(ineligible_itc_minor), 0)::bigint AS "ineligibleTotal",
        COUNT(*) FILTER (WHERE eligibility_status = 'pending_review')::int AS "unreviewedCount",
        COUNT(*) FILTER (WHERE matching_status IN ('taxable_mismatch', 'gst_mismatch', 'missing_from_2b'))::int AS "mismatchCount"
       FROM itc_reviews
       WHERE tenant_id = ? AND return_period = ?`,
      [tenantId, period],
    );

    const itcCgst = Number(itcAgg?.eligibleCgst || 0);
    const itcSgst = Number(itcAgg?.eligibleSgst || 0);
    const itcIgst = Number(itcAgg?.eligibleIgst || 0);
    const itcTotal = Number(itcAgg?.eligibleTotal || 0);
    const ineligibleTotal = Number(itcAgg?.ineligibleTotal || 0);
    const unreviewedRecordsCount = Number(itcAgg?.unreviewedCount || 0);
    const unresolvedMismatchesCount = Number(itcAgg?.mismatchCount || 0);

    // Net tax payable = Max(0, Output - Eligible ITC)
    const netCgst = Math.max(0, outCgst - itcCgst);
    const netSgst = Math.max(0, outSgst - itcSgst);
    const netIgst = Math.max(0, outIgst - itcIgst);
    const netTotal = netCgst + netSgst + netIgst;

    const status = unreviewedRecordsCount === 0 && unresolvedMismatchesCount === 0 ? 'reviewed' : 'draft';

    return {
      gstin,
      returnPeriod: period,
      status,
      table31Outward: {
        taxableSupplies: { taxableMinor: outTaxable, igstMinor: outIgst, cgstMinor: outCgst, sgstMinor: outSgst },
        zeroRated: { taxableMinor: 0, igstMinor: 0, cgstMinor: 0, sgstMinor: 0 },
        nilRatedExempt: { taxableMinor: 0, igstMinor: 0, cgstMinor: 0, sgstMinor: 0 },
        reverseChargeInward: { taxableMinor: 0, igstMinor: 0, cgstMinor: 0, sgstMinor: 0 },
        nonGst: { taxableMinor: 0, igstMinor: 0, cgstMinor: 0, sgstMinor: 0 },
      },
      table4EligibleItc: {
        allOtherItc: { igstMinor: itcIgst, cgstMinor: itcCgst, sgstMinor: itcSgst, totalMinor: itcTotal },
        reversalRule42_43: { igstMinor: 0, cgstMinor: 0, sgstMinor: 0, totalMinor: 0 },
        netItcAvailable: { igstMinor: itcIgst, cgstMinor: itcCgst, sgstMinor: itcSgst, totalMinor: itcTotal },
        ineligibleSection17_5: { igstMinor: 0, cgstMinor: 0, sgstMinor: 0, totalMinor: ineligibleTotal },
      },
      netTaxPayable: {
        igstMinor: netIgst,
        cgstMinor: netCgst,
        sgstMinor: netSgst,
        totalMinor: netTotal,
      },
      unresolvedMismatchesCount,
      unreviewedRecordsCount,
    };
  });

  // --------------------------------------------------------------------------
  // 8. Save GSTR-3B Return Status (Audit & Filing History)
  // --------------------------------------------------------------------------
  r.post('/api/gst/gstr3b/save', requirePerm('gst.manage'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};

    const gstin = V.str(b.gstin, 'GSTIN', { required: true });
    const returnPeriod = V.str(b.returnPeriod, 'Return period (YYYY-MM)', { required: true });
    const status = V.oneOf(b.status, 'Status', ['draft', 'reviewed', 'filed', 'exported'], 'reviewed');
    const summary = b.summary || {};
    const notes = V.optStr(b.notes, 'Notes', 1000);

    const historyId = newId('fil');
    await ctx.db.tx(async (q) => {
      await q.exec(
        `INSERT INTO gst_filing_history (
          id, tenant_id, return_type, return_period, gstin, status, summary, notes, filed_by, filed_at, created_at
        ) VALUES (
          ?, ?, 'GSTR-3B', ?, ?, ?, ?, ?, ?, now(), now()
        )`,
        [historyId, tenantId, returnPeriod, gstin, status, JSON.stringify(summary), notes, ctx.user!.id],
      );

      await audit(q, ctx, {
        action: 'gstr3b.save',
        entity: 'gst_filing_history',
        entityId: historyId,
        detail: { returnPeriod, status, gstin },
      });
    });

    return { ok: true, id: historyId, status };
  });

  // --------------------------------------------------------------------------
  // 9. Exports
  // --------------------------------------------------------------------------

  // Sales Register CSV Export
  r.get('/api/gst/sales-register/export', requirePerm('gst.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const period = ctx.query.period || new Date().toISOString().slice(0, 7);
    const [year, month] = period.split('-').map(Number);
    const startDate = `${period}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${period}-${String(lastDay).padStart(2, '0')}`;

    const invoices = await ctx.db.query(
      `SELECT
        i.id, i.number, i.bdate, i.kind, i.customer_name, i.customer_gstin,
        i.place_state, i.intra, i.taxable_minor, i.cgst_minor, i.sgst_minor, i.igst_minor,
        i.round_off_minor, i.total_minor, i.status
       FROM invoices i
       WHERE i.tenant_id = ? AND i.bdate >= ? AND i.bdate <= ? AND i.status = 'posted'
       ORDER BY i.bdate ASC, i.number ASC`,
      [tenantId, startDate, endDate],
    );

    const escapeCsv = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = [
      'Invoice Number',
      'Invoice Date',
      'Type',
      'Customer Name',
      'Customer GSTIN',
      'Supply Type',
      'Place of Supply',
      'Taxable Value (Rs)',
      'CGST (Rs)',
      'SGST (Rs)',
      'IGST (Rs)',
      'Total GST (Rs)',
      'Total Amount (Rs)',
    ].join(',');

    const rows = invoices.map((i: any) => {
      const taxable = (Number(i.taxableMinor ?? i.taxable_minor ?? 0) / 100).toFixed(2);
      const cgst = (Number(i.cgstMinor ?? i.cgst_minor ?? 0) / 100).toFixed(2);
      const sgst = (Number(i.sgstMinor ?? i.sgst_minor ?? 0) / 100).toFixed(2);
      const igst = (Number(i.igstMinor ?? i.igst_minor ?? 0) / 100).toFixed(2);
      const totalGst = ((Number(i.cgstMinor ?? i.cgst_minor ?? 0) + Number(i.sgstMinor ?? i.sgst_minor ?? 0) + Number(i.igstMinor ?? i.igst_minor ?? 0)) / 100).toFixed(2);
      const total = (Number(i.totalMinor ?? i.total_minor ?? 0) / 100).toFixed(2);

      return [
        escapeCsv(i.number),
        escapeCsv(i.bdate),
        escapeCsv(i.kind === 'sale' ? 'Tax Invoice' : 'Credit Note'),
        escapeCsv(i.customerName ?? i.customer_name ?? 'Counter Customer'),
        escapeCsv(i.customerGstin ?? i.customer_gstin ?? 'N/A'),
        escapeCsv(i.intra ? 'Intra-State' : 'Inter-State'),
        escapeCsv(i.placeState ?? i.place_state ?? '33'),
        taxable,
        cgst,
        sgst,
        igst,
        totalGst,
        total,
      ].join(',');
    });

    const csvContent = [header, ...rows].join('\r\n');
    const filename = `GST_Sales_Register_${period}.csv`;
    return new FileResponse(csvContent, 'text/csv; charset=utf-8', filename);
  });

  // Purchase Register CSV Export
  r.get('/api/gst/purchase-register/export', requirePerm('gst.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const period = ctx.query.period || new Date().toISOString().slice(0, 7);
    const [year, month] = period.split('-').map(Number);
    const startDate = `${period}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${period}-${String(lastDay).padStart(2, '0')}`;

    const purchases = await ctx.db.query(
      `SELECT
        p.id, p.purchase_number, COALESCE(p.purchase_date, p.bdate) AS doc_date,
        p.supplier_invoice_number, p.supplier_invoice_date,
        part.name AS supplier_name, part.gstin AS supplier_gstin,
        p.taxable_minor, p.cgst_minor, p.sgst_minor, p.igst_minor, p.total_minor, p.itc_minor
       FROM purchases p
       LEFT JOIN parties part ON part.id = p.supplier_id AND part.tenant_id = p.tenant_id
       WHERE p.tenant_id = ? AND COALESCE(p.purchase_date, p.bdate) >= ? AND COALESCE(p.purchase_date, p.bdate) <= ? AND p.status != 'voided'
       ORDER BY doc_date ASC`,
      [tenantId, startDate, endDate],
    );

    const expenses = await ctx.db.query(
      `SELECT
        id, expense_number, expense_date AS doc_date,
        supplier_invoice_number, supplier_invoice_date,
        supplier_name, supplier_gstin, category,
        taxable_minor, cgst_minor, sgst_minor, igst_minor, total_minor, itc_minor
       FROM expenses
       WHERE tenant_id = ? AND expense_date >= ? AND expense_date <= ? AND status != 'voided'
       ORDER BY expense_date ASC`,
      [tenantId, startDate, endDate],
    );

    const escapeCsv = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = [
      'Document Type',
      'Document Number',
      'Document Date',
      'Supplier Name',
      'Supplier GSTIN',
      'Supplier Invoice No',
      'Supplier Invoice Date',
      'Taxable Value (Rs)',
      'CGST (Rs)',
      'SGST (Rs)',
      'IGST (Rs)',
      'Total GST (Rs)',
      'Eligible ITC (Rs)',
      'Total Amount (Rs)',
    ].join(',');

    const pRows = purchases.map((p: any) => {
      const taxable = (Number(p.taxableMinor ?? p.taxable_minor ?? 0) / 100).toFixed(2);
      const cgst = (Number(p.cgstMinor ?? p.cgst_minor ?? 0) / 100).toFixed(2);
      const sgst = (Number(p.sgstMinor ?? p.sgst_minor ?? 0) / 100).toFixed(2);
      const igst = (Number(p.igstMinor ?? p.igst_minor ?? 0) / 100).toFixed(2);
      const totalGst = ((Number(p.cgstMinor ?? p.cgst_minor ?? 0) + Number(p.sgstMinor ?? p.sgst_minor ?? 0) + Number(p.igstMinor ?? p.igst_minor ?? 0)) / 100).toFixed(2);
      const itc = (Number(p.itcMinor ?? p.itc_minor ?? 0) / 100).toFixed(2);
      const total = (Number(p.totalMinor ?? p.total_minor ?? 0) / 100).toFixed(2);

      return [
        escapeCsv('Purchase (Goods)'),
        escapeCsv(p.purchaseNumber ?? p.purchase_number ?? ('PUR-' + p.id.slice(-4))),
        escapeCsv(p.docDate ?? p.doc_date),
        escapeCsv(p.supplierName ?? p.supplier_name ?? 'Vendor'),
        escapeCsv(p.supplierGstin ?? p.supplier_gstin ?? 'N/A'),
        escapeCsv(p.supplierInvoiceNumber ?? p.supplier_invoice_number ?? '-'),
        escapeCsv(p.supplierInvoiceDate ?? p.supplier_invoice_date ?? p.docDate ?? p.doc_date),
        taxable,
        cgst,
        sgst,
        igst,
        totalGst,
        itc,
        total,
      ].join(',');
    });

    const eRows = expenses.map((e: any) => {
      const taxable = (Number(e.taxableMinor ?? e.taxable_minor ?? 0) / 100).toFixed(2);
      const cgst = (Number(e.cgstMinor ?? e.cgst_minor ?? 0) / 100).toFixed(2);
      const sgst = (Number(e.sgstMinor ?? e.sgst_minor ?? 0) / 100).toFixed(2);
      const igst = (Number(e.igstMinor ?? e.igst_minor ?? 0) / 100).toFixed(2);
      const totalGst = ((Number(e.cgstMinor ?? e.cgst_minor ?? 0) + Number(e.sgstMinor ?? e.sgst_minor ?? 0) + Number(e.igstMinor ?? e.igst_minor ?? 0)) / 100).toFixed(2);
      const itc = (Number(e.itcMinor ?? e.itc_minor ?? 0) / 100).toFixed(2);
      const total = (Number(e.totalMinor ?? e.total_minor ?? 0) / 100).toFixed(2);

      return [
        escapeCsv(`Expense (${e.category || 'General'})`),
        escapeCsv(e.expenseNumber ?? e.expense_number ?? ('EXP-' + e.id.slice(-4))),
        escapeCsv(e.docDate ?? e.doc_date),
        escapeCsv(e.supplierName ?? e.supplier_name ?? 'Vendor'),
        escapeCsv(e.supplierGstin ?? e.supplier_gstin ?? 'N/A'),
        escapeCsv(e.supplierInvoiceNumber ?? e.supplier_invoice_number ?? '-'),
        escapeCsv(e.supplierInvoiceDate ?? e.supplier_invoice_date ?? e.docDate ?? e.doc_date),
        taxable,
        cgst,
        sgst,
        igst,
        totalGst,
        itc,
        total,
      ].join(',');
    });

    const csvContent = [header, ...pRows, ...eRows].join('\r\n');
    const filename = `GST_Purchase_Register_${period}.csv`;
    return new FileResponse(csvContent, 'text/csv; charset=utf-8', filename);
  });

  // ITC Reconciliation Report CSV Export
  const exportItcRecon = async (ctx: any) => {
    const tenantId = ctx.user!.tenantId;
    const period = ctx.query.period || new Date().toISOString().slice(0, 7);
    const [year, month] = period.split('-').map(Number);
    const startDate = `${period}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${period}-${String(lastDay).padStart(2, '0')}`;

    // 1. Purchases with GST
    const purchases = await ctx.db.query(
      `SELECT
        p.id, p.purchase_number, COALESCE(p.purchase_date, p.bdate) AS doc_date,
        p.supplier_invoice_number, p.supplier_invoice_date,
        part.name AS supplier_name, part.gstin AS supplier_gstin,
        p.taxable_minor, p.cgst_minor, p.sgst_minor, p.igst_minor, p.total_minor, p.itc_minor
       FROM purchases p
       LEFT JOIN parties part ON part.id = p.supplier_id AND part.tenant_id = p.tenant_id
       WHERE p.tenant_id = ? AND COALESCE(p.purchase_date, p.bdate) >= ? AND COALESCE(p.purchase_date, p.bdate) <= ? AND p.status != 'voided'
         AND (p.cgst_minor + p.sgst_minor + p.igst_minor) > 0`,
      [tenantId, startDate, endDate],
    );

    // 2. Expenses with GST
    const expenses = await ctx.db.query(
      `SELECT
        id, expense_number, expense_date AS doc_date,
        supplier_invoice_number, supplier_invoice_date,
        supplier_name, supplier_gstin, category,
        taxable_minor, cgst_minor, sgst_minor, igst_minor, total_minor, itc_minor
       FROM expenses
       WHERE tenant_id = ? AND expense_date >= ? AND expense_date <= ? AND status != 'voided'
         AND (cgst_minor + sgst_minor + igst_minor) > 0`,
      [tenantId, startDate, endDate],
    );

    // 3. Reviews
    const reviews = await ctx.db.query(
      `SELECT * FROM itc_reviews
       WHERE tenant_id = ? AND return_period = ?`,
      [tenantId, period],
    );
    const reviewMap = new Map<string, any>();
    for (const rev of reviews) {
      const docType = rev.docType ?? rev.doc_type;
      const docId = rev.docId ?? rev.doc_id;
      reviewMap.set(`${docType}_${docId}`, rev);
    }

    const escapeCsv = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = [
      'Document Type',
      'Doc Number',
      'Doc Date',
      'Supplier / Vendor Name',
      'Supplier GSTIN',
      'Supplier Invoice No',
      'Supplier Invoice Date',
      'Taxable Value (Rs)',
      'CGST (Rs)',
      'SGST (Rs)',
      'IGST (Rs)',
      'Total Inward GST (Rs)',
      'GSTR-2B Match Status',
      'ITC Eligibility Status',
      'Reviewed Eligible ITC (Rs)',
      'Ineligible ITC (Rs)',
      'Mismatch Amount (Rs)',
      'Review Decision Reason',
      'Total Document Amount (Rs)',
    ].join(',');

    const pRows = purchases.map((p: any) => {
      const rev = reviewMap.get(`purchase_${p.id}`);
      const taxable = (Number(p.taxableMinor ?? p.taxable_minor ?? 0) / 100).toFixed(2);
      const cgst = (Number(p.cgstMinor ?? p.cgst_minor ?? 0) / 100).toFixed(2);
      const sgst = (Number(p.sgstMinor ?? p.sgst_minor ?? 0) / 100).toFixed(2);
      const igst = (Number(p.igstMinor ?? p.igst_minor ?? 0) / 100).toFixed(2);
      const totalGstMinor = Number(p.cgstMinor ?? p.cgst_minor ?? 0) + Number(p.sgstMinor ?? p.sgst_minor ?? 0) + Number(p.igstMinor ?? p.igst_minor ?? 0);
      const totalGst = (totalGstMinor / 100).toFixed(2);

      const revEligible = rev ? (rev.reviewedEligibleItcMinor ?? rev.reviewed_eligible_itc_minor) : null;
      const eligible = ((revEligible !== null && revEligible !== undefined ? Number(revEligible) : Number(p.itcMinor ?? p.itc_minor ?? totalGstMinor)) / 100).toFixed(2);
      const revIneligible = rev ? (rev.ineligibleItcMinor ?? rev.ineligible_itc_minor) : null;
      const ineligible = ((revIneligible !== null && revIneligible !== undefined ? Number(revIneligible) : Math.max(0, totalGstMinor - Number(eligible) * 100)) / 100).toFixed(2);
      const mismatch = (Number(rev?.mismatchMinor ?? rev?.mismatch_minor ?? 0) / 100).toFixed(2);
      const total = (Number(p.totalMinor ?? p.total_minor ?? 0) / 100).toFixed(2);
      const supplierGstin = p.supplierGstin ?? p.supplier_gstin;

      return [
        escapeCsv('Purchase (Goods)'),
        escapeCsv(p.purchaseNumber ?? p.purchase_number ?? ('PUR-' + p.id.slice(-4))),
        escapeCsv(p.docDate ?? p.doc_date),
        escapeCsv(p.supplierName ?? p.supplier_name ?? 'Vendor'),
        escapeCsv(supplierGstin || 'Unregistered'),
        escapeCsv(p.supplierInvoiceNumber ?? p.supplier_invoice_number ?? '-'),
        escapeCsv(p.supplierInvoiceDate ?? p.supplier_invoice_date ?? p.docDate ?? p.doc_date),
        taxable,
        cgst,
        sgst,
        igst,
        totalGst,
        escapeCsv(rev?.matchingStatus ?? rev?.matching_status ?? (supplierGstin ? 'pending_review' : 'missing_from_2b')),
        escapeCsv(rev?.eligibilityStatus ?? rev?.eligibility_status ?? (supplierGstin ? 'pending_review' : 'ineligible_reviewed')),
        eligible,
        ineligible,
        mismatch,
        escapeCsv(rev?.reviewDecisionReason ?? rev?.review_decision_reason ?? '-'),
        total,
      ].join(',');
    });

    const eRows = expenses.map((e: any) => {
      const rev = reviewMap.get(`expense_${e.id}`);
      const taxable = (Number(e.taxableMinor ?? e.taxable_minor ?? 0) / 100).toFixed(2);
      const cgst = (Number(e.cgstMinor ?? e.cgst_minor ?? 0) / 100).toFixed(2);
      const sgst = (Number(e.sgstMinor ?? e.sgst_minor ?? 0) / 100).toFixed(2);
      const igst = (Number(e.igstMinor ?? e.igst_minor ?? 0) / 100).toFixed(2);
      const totalGstMinor = Number(e.cgstMinor ?? e.cgst_minor ?? 0) + Number(e.sgstMinor ?? e.sgst_minor ?? 0) + Number(e.igstMinor ?? e.igst_minor ?? 0);
      const totalGst = (totalGstMinor / 100).toFixed(2);

      const revEligible = rev ? (rev.reviewedEligibleItcMinor ?? rev.reviewed_eligible_itc_minor) : null;
      const eligible = ((revEligible !== null && revEligible !== undefined ? Number(revEligible) : Number(e.itcMinor ?? e.itc_minor ?? 0)) / 100).toFixed(2);
      const revIneligible = rev ? (rev.ineligibleItcMinor ?? rev.ineligible_itc_minor) : null;
      const ineligible = ((revIneligible !== null && revIneligible !== undefined ? Number(revIneligible) : Math.max(0, totalGstMinor - Number(eligible) * 100)) / 100).toFixed(2);
      const mismatch = (Number(rev?.mismatchMinor ?? rev?.mismatch_minor ?? 0) / 100).toFixed(2);
      const total = (Number(e.totalMinor ?? e.total_minor ?? 0) / 100).toFixed(2);
      const supplierGstin = e.supplierGstin ?? e.supplier_gstin;

      return [
        escapeCsv(`Expense (${e.category || 'General'})`),
        escapeCsv(e.expenseNumber ?? e.expense_number ?? ('EXP-' + e.id.slice(-4))),
        escapeCsv(e.docDate ?? e.doc_date),
        escapeCsv(e.supplierName ?? e.supplier_name ?? 'Vendor'),
        escapeCsv(supplierGstin || 'Unregistered'),
        escapeCsv(e.supplierInvoiceNumber ?? e.supplier_invoice_number ?? '-'),
        escapeCsv(e.supplierInvoiceDate ?? e.supplier_invoice_date ?? e.docDate ?? e.doc_date),
        taxable,
        cgst,
        sgst,
        igst,
        totalGst,
        escapeCsv(rev?.matchingStatus ?? rev?.matching_status ?? (supplierGstin ? 'pending_review' : 'missing_from_2b')),
        escapeCsv(rev?.eligibilityStatus ?? rev?.eligibility_status ?? (supplierGstin ? 'pending_review' : 'ineligible_reviewed')),
        eligible,
        ineligible,
        mismatch,
        escapeCsv(rev?.reviewDecisionReason ?? rev?.review_decision_reason ?? '-'),
        total,
      ].join(',');
    });

    const csvContent = [header, ...pRows, ...eRows].join('\r\n');
    const filename = `ITC_Reconciliation_Report_${period}.csv`;
    return new FileResponse(csvContent, 'text/csv; charset=utf-8', filename);
  };

  r.get('/api/gst/itc-reconciliation/export', requirePerm('gst.view'), exportItcRecon);
  r.get('/api/gst/itc-register/export', requirePerm('gst.view'), exportItcRecon);

  // GSTR-3B Summary CSV Export
  r.get('/api/gst/gstr3b/export', requirePerm('gst.view'), async (ctx) => {
    const period = ctx.query.period || new Date().toISOString().slice(0, 7);

    // Re-use logic
    const g3b: any = await (async () => {
      // simulate call or fetch
      const [year, month] = period.split('-').map(Number);
      const startDate = `${period}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const endDate = `${period}-${String(lastDay).padStart(2, '0')}`;
      const tenantId = ctx.user!.tenantId;

      const sales = await ctx.db.one<any>(
        `SELECT
          COALESCE(SUM(taxable_minor), 0)::bigint AS taxable,
          COALESCE(SUM(cgst_minor), 0)::bigint AS cgst,
          COALESCE(SUM(sgst_minor), 0)::bigint AS sgst,
          COALESCE(SUM(igst_minor), 0)::bigint AS igst
         FROM invoices
         WHERE tenant_id = ? AND bdate >= ? AND bdate <= ? AND status = 'posted' AND kind = 'sale'`,
        [tenantId, startDate, endDate],
      );

      const itc = await ctx.db.one<any>(
        `SELECT
          COALESCE(SUM(reviewed_eligible_cgst_minor), 0)::bigint AS cgst,
          COALESCE(SUM(reviewed_eligible_sgst_minor), 0)::bigint AS sgst,
          COALESCE(SUM(reviewed_eligible_igst_minor), 0)::bigint AS igst,
          COALESCE(SUM(reviewed_eligible_itc_minor), 0)::bigint AS total
         FROM itc_reviews
         WHERE tenant_id = ? AND return_period = ?`,
        [tenantId, period],
      );

      return {
        salesTaxable: Number(sales?.taxable || 0),
        salesCgst: Number(sales?.cgst || 0),
        salesSgst: Number(sales?.sgst || 0),
        salesIgst: Number(sales?.igst || 0),
        itcCgst: Number(itc?.cgst || 0),
        itcSgst: Number(itc?.sgst || 0),
        itcIgst: Number(itc?.igst || 0),
        itcTotal: Number(itc?.total || 0),
      };
    })();

    const escapeCsv = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      `"GSTR-3B Preparation Summary - Period ${period}"`,
      '',
      '"Section","Details","Taxable Value (Rs)","Integrated Tax (Rs)","Central Tax (Rs)","State/UT Tax (Rs)","Total Tax (Rs)"',
      `"Table 3.1(a)","Outward Taxable Supplies (other than zero/nil/exempt)",${(g3b.salesTaxable / 100).toFixed(2)},${(g3b.salesIgst / 100).toFixed(2)},${(g3b.salesCgst / 100).toFixed(2)},${(g3b.salesSgst / 100).toFixed(2)},${((g3b.salesIgst + g3b.salesCgst + g3b.salesSgst) / 100).toFixed(2)}`,
      `"Table 4(A)(5)","All Other ITC (Reviewed & Eligible)",0.00,${(g3b.itcIgst / 100).toFixed(2)},${(g3b.itcCgst / 100).toFixed(2)},${(g3b.itcSgst / 100).toFixed(2)},${(g3b.itcTotal / 100).toFixed(2)}`,
      `"Table 5","Net Tax Payable",0.00,${(Math.max(0, g3b.salesIgst - g3b.itcIgst) / 100).toFixed(2)},${(Math.max(0, g3b.salesCgst - g3b.itcCgst) / 100).toFixed(2)},${(Math.max(0, g3b.salesSgst - g3b.itcSgst) / 100).toFixed(2)},${(Math.max(0, (g3b.salesIgst + g3b.salesCgst + g3b.salesSgst) - g3b.itcTotal) / 100).toFixed(2)}`,
    ];

    const csvContent = lines.join('\r\n');
    const filename = `GSTR3B_Summary_${period}.csv`;
    return new FileResponse(csvContent, 'text/csv; charset=utf-8', filename);
  });

  // --------------------------------------------------------------------------
  // 10. Filing History
  // --------------------------------------------------------------------------
  r.get('/api/gst/history', requirePerm('gst.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const history = await ctx.db.query(
      `SELECT h.*, u.name AS filed_by_name
       FROM gst_filing_history h
       LEFT JOIN users u ON u.id = h.filed_by
       WHERE h.tenant_id = ?
       ORDER BY h.created_at DESC
       LIMIT 50`,
      [tenantId],
    );

    return {
      history: history.map((h: any) => ({
        id: h.id,
        returnType: h.return_type,
        returnPeriod: h.return_period,
        gstin: h.gstin,
        status: h.status,
        summary: typeof h.summary === 'string' ? JSON.parse(h.summary) : h.summary,
        notes: h.notes,
        filedByName: h.filed_by_name || 'System User',
        filedAt: h.filed_at,
        createdAt: h.created_at,
      })),
    };
  });
}
