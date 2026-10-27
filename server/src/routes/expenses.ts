import { requirePerm } from '../auth.ts';
import { bad, conflict, notFound, forbidden, FileResponse, V, type Router } from '../http.ts';
import { newId } from '../security.ts';
import { audit } from '../audit.ts';
import { validateGstin } from '../../../shared/tax.ts';
import { calcExpense, STANDARD_EXPENSE_CATEGORIES } from '../../../shared/gst.ts';
import type { ExpenseCategory, GstTreatment, ItcEligibility } from '../../../shared/types.ts';

function formatExpense(r: any) {
  return {
    id: r.id,
    tenantId: r.tenantId ?? r.tenant_id,
    expenseNumber: r.expenseNumber ?? r.expense_number,
    expenseDate: r.expenseDate ?? r.expense_date,
    category: r.category,
    description: r.description ?? null,
    notes: r.notes ?? null,
    supplierId: r.supplierId ?? r.supplier_id ?? null,
    supplierName: r.supplierName ?? r.supplier_name ?? null,
    supplierGstin: r.supplierGstin ?? r.supplier_gstin ?? null,
    supplierInvoiceNumber: r.supplierInvoiceNumber ?? r.supplier_invoice_number ?? null,
    supplierInvoiceDate: r.supplierInvoiceDate ?? r.supplier_invoice_date ?? null,
    taxInclusive: Boolean(r.taxInclusive ?? r.tax_inclusive),
    taxRateBp: Number(r.taxRateBp ?? r.tax_rate_bp ?? 0),
    taxableMinor: Number(r.taxableMinor ?? r.taxable_minor ?? 0),
    cgstMinor: Number(r.cgstMinor ?? r.cgst_minor ?? 0),
    sgstMinor: Number(r.sgstMinor ?? r.sgst_minor ?? 0),
    igstMinor: Number(r.igstMinor ?? r.igst_minor ?? 0),
    totalMinor: Number(r.totalMinor ?? r.total_minor ?? 0),
    paymentMethod: r.paymentMethod ?? r.payment_method ?? 'cash',
    paymentStatus: r.paymentStatus ?? r.payment_status ?? 'paid',
    paidMinor: Number(r.paidMinor ?? r.paid_minor ?? 0),
    balanceMinor: Number(r.balanceMinor ?? r.balance_minor ?? 0),
    gstTreatment: r.gstTreatment ?? r.gst_treatment ?? 'exempt',
    itcEligibility: r.itcEligibility ?? r.itc_eligibility ?? 'ineligible',
    itcMinor: Number(r.itcMinor ?? r.itc_minor ?? 0),
    location: r.location ?? 'MAIN',
    status: r.status ?? 'posted',
    voidReason: r.voidReason ?? r.void_reason ?? null,
    voidedBy: r.voidedBy ?? r.voided_by ?? null,
    voidedAt: r.voidedAt ?? r.voided_at ?? null,
    createdBy: r.createdBy ?? r.created_by ?? null,
    createdAt: r.createdAt ?? r.created_at,
    updatedAt: r.updatedAt ?? r.updated_at,
  };
}

export function registerExpenses(r: Router) {
  // 1. List Standard Expense Categories
  r.get('/api/expenses/categories', requirePerm('expenses'), async () => {
    return { categories: STANDARD_EXPENSE_CATEGORIES };
  });

  // 2. List Expenses with filtering, search, and pagination
  r.get('/api/expenses', requirePerm('expenses'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const { from, to, category, paymentStatus, gstTreatment, itcEligibility, supplierId, q, location } = ctx.query;
    const page = Math.max(1, parseInt(ctx.query.page || '1', 10));
    const limit = Math.min(100, Math.max(10, parseInt(ctx.query.limit || '50', 10)));
    const offset = (page - 1) * limit;

    const where: string[] = ['tenant_id = ?'];
    const params: any[] = [tenantId];

    if (from) {
      where.push('expense_date >= ?');
      params.push(from);
    }
    if (to) {
      where.push('expense_date <= ?');
      params.push(to);
    }
    if (category && category !== 'ALL') {
      where.push('category = ?');
      params.push(category);
    }
    if (paymentStatus && paymentStatus !== 'ALL') {
      where.push('payment_status = ?');
      params.push(paymentStatus);
    }
    if (gstTreatment && gstTreatment !== 'ALL') {
      where.push('gst_treatment = ?');
      params.push(gstTreatment);
    }
    if (itcEligibility && itcEligibility !== 'ALL') {
      where.push('itc_eligibility = ?');
      params.push(itcEligibility);
    }
    if (supplierId) {
      where.push('supplier_id = ?');
      params.push(supplierId);
    }
    if (location && location !== 'ALL') {
      where.push('location = ?');
      params.push(location);
    }
    if (q && q.trim()) {
      where.push('(lower(expense_number) LIKE ? OR lower(category) LIKE ? OR lower(COALESCE(description, \'\')) LIKE ? OR lower(COALESCE(supplier_name, \'\')) LIKE ? OR lower(COALESCE(supplier_invoice_number, \'\')) LIKE ?)');
      const term = `%${q.trim().toLowerCase()}%`;
      params.push(term, term, term, term, term);
    }

    const whereSql = where.join(' AND ');

    // Aggregate summary for the filtered set
    const summary = await ctx.db.one<{
      count: number;
      totalMinor: number;
      taxableMinor: number;
      totalGstMinor: number;
      itcMinor: number;
      paidMinor: number;
      balanceMinor: number;
    }>(
      `SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(total_minor), 0)::bigint AS "totalMinor",
        COALESCE(SUM(taxable_minor), 0)::bigint AS "taxableMinor",
        COALESCE(SUM(cgst_minor + sgst_minor + igst_minor), 0)::bigint AS "totalGstMinor",
        COALESCE(SUM(itc_minor), 0)::bigint AS "itcMinor",
        COALESCE(SUM(paid_minor), 0)::bigint AS "paidMinor",
        COALESCE(SUM(balance_minor), 0)::bigint AS "balanceMinor"
       FROM expenses
       WHERE ${whereSql}`,
      params,
    );

    const rows = await ctx.db.query(
      `SELECT * FROM expenses
       WHERE ${whereSql}
       ORDER BY expense_date DESC, created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );

    return {
      expenses: rows.map(formatExpense),
      totalCount: Number(summary?.count || 0),
      summary: {
        totalMinor: Number(summary?.totalMinor || 0),
        taxableMinor: Number(summary?.taxableMinor || 0),
        totalGstMinor: Number(summary?.totalGstMinor || 0),
        itcMinor: Number(summary?.itcMinor || 0),
        paidMinor: Number(summary?.paidMinor || 0),
        balanceMinor: Number(summary?.balanceMinor || 0),
      },
      page,
      limit,
    };
  });

  // 3. Create Expense Record
  r.post('/api/expenses', requirePerm('expenses.write'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};

    // 1. Idempotency Check
    const idempotencyKey = V.optStr(b.idempotencyKey, 'Idempotency key', 128);
    if (idempotencyKey) {
      const existing = await ctx.db.one('SELECT * FROM expenses WHERE tenant_id = ? AND idempotency_key = ?', [tenantId, idempotencyKey]);
      if (existing) {
        return { idempotent: true, expense: formatExpense(existing) };
      }
    }

    // 2. Validation
    const expenseDate = V.date(b.expenseDate, 'Expense date', true)!;
    const category = V.str(b.category, 'Expense category', { required: true, max: 100 });
    const description = V.optStr(b.description, 'Description', 500);
    const notes = V.optStr(b.notes, 'Notes', 1000);
    const supplierId = V.optStr(b.supplierId, 'Supplier ID');
    let supplierName = V.optStr(b.supplierName, 'Supplier name', 200);
    let supplierGstin = V.optStr(b.supplierGstin, 'Supplier GSTIN', 15);
    const supplierInvoiceNumber = V.optStr(b.supplierInvoiceNumber, 'Supplier invoice/receipt number', 100);
    const supplierInvoiceDate = V.date(b.supplierInvoiceDate, 'Supplier invoice date');

    const taxInclusive = V.bool(b.taxInclusive, false);
    const taxRateBp = V.int(b.taxRateBp, 'Tax rate (bp)', { min: 0, max: 5000 });
    const amountMinor = V.int(b.amountMinor, 'Amount', { min: 1, required: true });

    const paymentMethod = V.oneOf(b.paymentMethod, 'Payment method', ['cash', 'upi', 'card', 'bank', 'cheque', 'credit'], 'cash');
    const paymentStatus = V.oneOf(b.paymentStatus, 'Payment status', ['paid', 'unpaid', 'partial'], 'paid');
    const paidMinorInput = V.int(b.paidMinor, 'Paid amount', { min: 0 });

    const gstTreatment = V.oneOf(
      b.gstTreatment,
      'GST treatment',
      ['regular', 'composition', 'exempt', 'nil_rated', 'non_gst', 'import'],
      'exempt',
    ) as GstTreatment;

    const itcEligibility = V.oneOf(
      b.itcEligibility,
      'ITC eligibility',
      ['eligible', 'ineligible', 'blocked_17_5', 'pending_review'],
      'ineligible',
    ) as ItcEligibility;

    const location = V.optStr(b.location, 'Location') || ctx.user!.assignedLocation || 'MAIN';

    // 3. GSTIN validation if supplied
    if (supplierGstin) {
      supplierGstin = supplierGstin.toUpperCase().trim();
      const gstinVal = validateGstin(supplierGstin);
      if (!gstinVal.ok) {
        throw bad(`Supplier GSTIN is invalid: ${gstinVal.reason}`, 'INVALID_GSTIN', { field: 'supplierGstin' });
      }
    }

    // If supplierId was provided, look up and link party details
    if (supplierId) {
      const party = await ctx.db.one<any>('SELECT * FROM parties WHERE id = ? AND tenant_id = ?', [supplierId, tenantId]);
      if (party) {
        supplierName = supplierName || party.name;
        supplierGstin = supplierGstin || party.gstin;
      }
    }

    // 4. Duplicate Check
    if (supplierInvoiceNumber && (supplierGstin || supplierName)) {
      const existingDuplicate = await ctx.db.one(
        `SELECT id, expense_number FROM expenses
         WHERE tenant_id = ? AND status = 'posted'
           AND supplier_invoice_number = ?
           AND (
             (supplier_gstin IS NOT NULL AND supplier_gstin = ?) OR
             (supplier_name IS NOT NULL AND lower(supplier_name) = lower(?))
           )`,
        [tenantId, supplierInvoiceNumber, supplierGstin || '', supplierName || ''],
      );
      if (existingDuplicate) {
        throw conflict(
          `An expense with invoice/receipt number "${supplierInvoiceNumber}" already exists (${existingDuplicate.expense_number}). Please verify before entering.`,
          'DUPLICATE_EXPENSE',
        );
      }
    }

    // 5. Tenant GSTIN and intra-state check
    const tenant = await ctx.db.one<{ gstin?: string; state_code?: string }>('SELECT gstin, state_code FROM tenants WHERE id = ?', [tenantId]);
    const tenantState = tenant?.state_code || (tenant?.gstin ? tenant.gstin.slice(0, 2) : '33');
    const supplierState = supplierGstin ? supplierGstin.slice(0, 2) : tenantState;
    const intraState = tenantState === supplierState;

    // 6. Tax calculation
    const calc = calcExpense({
      amountMinor,
      taxInclusive,
      taxRateBp,
      intraState,
      gstTreatment,
      itcEligibility,
    });

    const totalMinor = calc.totalMinor;
    let paidMinor = 0;
    let balanceMinor = totalMinor;

    if (paymentStatus === 'paid') {
      paidMinor = totalMinor;
      balanceMinor = 0;
    } else if (paymentStatus === 'unpaid') {
      paidMinor = 0;
      balanceMinor = totalMinor;
    } else {
      paidMinor = Math.min(totalMinor, Math.max(0, paidMinorInput));
      balanceMinor = totalMinor - paidMinor;
    }

    // 7. Database Transaction
    const expenseId = newId('exp');
    let savedExpense: any = null;

    await ctx.db.tx(async (q) => {
      // Generate series number EXP-0001
      await q.exec(
        `INSERT INTO number_series (tenant_id, series, next_no) VALUES (?, 'EXP', 1)
         ON CONFLICT (tenant_id, series) DO NOTHING`,
        [tenantId],
      );
      const seq = await q.one<{ next_no: number }>(
        `UPDATE number_series SET next_no = next_no + 1
         WHERE tenant_id = ? AND series = 'EXP'
         RETURNING next_no - 1 AS next_no`,
        [tenantId],
      );
      const numStr = String(seq?.next_no || 1).padStart(4, '0');
      const expenseNumber = `EXP-${numStr}`;

      savedExpense = await q.one(
        `INSERT INTO expenses (
          id, tenant_id, expense_number, expense_date, category, description, notes,
          supplier_id, supplier_name, supplier_gstin, supplier_invoice_number, supplier_invoice_date,
          tax_inclusive, tax_rate_bp, taxable_minor, cgst_minor, sgst_minor, igst_minor, total_minor,
          payment_method, payment_status, paid_minor, balance_minor, gst_treatment, itc_eligibility,
          itc_minor, location, status, idempotency_key, created_by, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, 'posted', ?, ?, now(), now()
        ) RETURNING *`,
        [
          expenseId, tenantId, expenseNumber, expenseDate, category, description, notes,
          supplierId, supplierName, supplierGstin, supplierInvoiceNumber, supplierInvoiceDate,
          taxInclusive, taxRateBp, calc.taxableMinor, calc.cgstMinor, calc.sgstMinor, calc.igstMinor, totalMinor,
          paymentMethod, paymentStatus, paidMinor, balanceMinor, gstTreatment, itcEligibility,
          calc.itcMinor, location, idempotencyKey, ctx.user!.id,
        ],
      );

      // Create linked ITC review entry if expense has GST
      if (calc.totalGstMinor > 0) {
        const periodStr = expenseDate.slice(0, 7); // YYYY-MM
        const reviewId = newId('itc');
        const initialStatus = itcEligibility === 'eligible' ? 'pending_review' : 'ineligible_reviewed';
        const eligibleMinor = itcEligibility === 'eligible' ? calc.itcMinor : 0;
        const ineligibleMinor = calc.totalGstMinor - eligibleMinor;

        await q.exec(
          `INSERT INTO itc_reviews (
            id, tenant_id, doc_type, doc_id, return_period,
            original_taxable_minor, original_cgst_minor, original_sgst_minor, original_igst_minor, original_gst_minor,
            matching_status, eligibility_status,
            reviewed_eligible_cgst_minor, reviewed_eligible_sgst_minor, reviewed_eligible_igst_minor, reviewed_eligible_itc_minor,
            ineligible_itc_minor, mismatch_minor, review_decision_reason, reviewed_by, reviewed_at, created_at, updated_at
          ) VALUES (
            ?, ?, 'expense', ?, ?,
            ?, ?, ?, ?, ?,
            'pending_review', ?,
            ?, ?, ?, ?,
            ?, 0, ?, ?, now(), now(), now()
          ) ON CONFLICT (tenant_id, doc_type, doc_id) DO UPDATE SET
            original_taxable_minor = EXCLUDED.original_taxable_minor,
            original_gst_minor = EXCLUDED.original_gst_minor,
            updated_at = now()`,
          [
            reviewId, tenantId, expenseId, periodStr,
            calc.taxableMinor, calc.cgstMinor, calc.sgstMinor, calc.igstMinor, calc.totalGstMinor,
            initialStatus,
            itcEligibility === 'eligible' ? calc.cgstMinor : 0,
            itcEligibility === 'eligible' ? calc.sgstMinor : 0,
            itcEligibility === 'eligible' ? calc.igstMinor : 0,
            eligibleMinor,
            ineligibleMinor,
            `Initial creation: ${itcEligibility}`, ctx.user!.id,
          ],
        );
      }

      await audit(q, ctx, {
        action: 'expense.create',
        entity: 'expense',
        entityId: expenseId,
        detail: { expenseNumber, category, totalMinor, itcMinor: calc.itcMinor },
      });
    });

    return { expense: formatExpense(savedExpense) };
  });

  // Export Expense Register to CSV (MUST be registered before /api/expenses/:id)
  r.get('/api/expenses/export', requirePerm('expenses'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const { from, to, category } = ctx.query;

    const where: string[] = ['tenant_id = ?'];
    const params: any[] = [tenantId];

    if (from) {
      where.push('expense_date >= ?');
      params.push(from);
    }
    if (to) {
      where.push('expense_date <= ?');
      params.push(to);
    }
    if (category && category !== 'ALL') {
      where.push('category = ?');
      params.push(category);
    }

    const rows = await ctx.db.query(
      `SELECT * FROM expenses
       WHERE ${where.join(' AND ')}
       ORDER BY expense_date ASC, created_at ASC`,
      params,
    );

    const escapeCsv = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const header = [
      'Expense Number',
      'Date',
      'Category',
      'Description',
      'Supplier / Vendor',
      'Supplier GSTIN',
      'Invoice / Receipt No',
      'Invoice Date',
      'Taxable Value (Rs)',
      'CGST (Rs)',
      'SGST (Rs)',
      'IGST (Rs)',
      'Total GST (Rs)',
      'Total Amount (Rs)',
      'Payment Method',
      'Payment Status',
      'Paid Amount (Rs)',
      'Balance Amount (Rs)',
      'GST Treatment',
      'ITC Eligibility',
      'Eligible ITC (Rs)',
      'Status',
    ].join(',');

    const csvRows = rows.map((r: any) => {
      const taxable = (Number(r.taxableMinor ?? r.taxable_minor ?? 0) / 100).toFixed(2);
      const cgst = (Number(r.cgstMinor ?? r.cgst_minor ?? 0) / 100).toFixed(2);
      const sgst = (Number(r.sgstMinor ?? r.sgst_minor ?? 0) / 100).toFixed(2);
      const igst = (Number(r.igstMinor ?? r.igst_minor ?? 0) / 100).toFixed(2);
      const totalGst = ((Number(r.cgstMinor ?? r.cgst_minor ?? 0) + Number(r.sgstMinor ?? r.sgst_minor ?? 0) + Number(r.igstMinor ?? r.igst_minor ?? 0)) / 100).toFixed(2);
      const total = (Number(r.totalMinor ?? r.total_minor ?? 0) / 100).toFixed(2);
      const paid = (Number(r.paidMinor ?? r.paid_minor ?? 0) / 100).toFixed(2);
      const balance = (Number(r.balanceMinor ?? r.balance_minor ?? 0) / 100).toFixed(2);
      const itc = (Number(r.itcMinor ?? r.itc_minor ?? 0) / 100).toFixed(2);

      return [
        escapeCsv(r.expenseNumber ?? r.expense_number),
        escapeCsv(r.expenseDate ?? r.expense_date),
        escapeCsv(r.category),
        escapeCsv(r.description),
        escapeCsv(r.supplierName ?? r.supplier_name),
        escapeCsv(r.supplierGstin ?? r.supplier_gstin),
        escapeCsv(r.supplierInvoiceNumber ?? r.supplier_invoice_number),
        escapeCsv(r.supplierInvoiceDate ?? r.supplier_invoice_date),
        taxable,
        cgst,
        sgst,
        igst,
        totalGst,
        total,
        escapeCsv(r.paymentMethod ?? r.payment_method),
        escapeCsv(r.paymentStatus ?? r.payment_status),
        paid,
        balance,
        escapeCsv(r.gstTreatment ?? r.gst_treatment),
        escapeCsv(r.itcEligibility ?? r.itc_eligibility),
        itc,
        escapeCsv(r.status),
      ].join(',');
    });

    const csvContent = [header, ...csvRows].join('\r\n');
    const filename = `Expense_Register_${from || 'ALL'}_to_${to || 'ALL'}.csv`;
    return new FileResponse(csvContent, 'text/csv; charset=utf-8', filename);
  });

  // 4. Get Expense Details
  r.get('/api/expenses/:id', requirePerm('expenses'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const expense = await ctx.db.one('SELECT * FROM expenses WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!expense) throw notFound('Expense');
    return { expense: formatExpense(expense) };
  });

  // 5. Update Expense
  r.put('/api/expenses/:id', requirePerm('expenses.write'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};

    const existing = await ctx.db.one('SELECT * FROM expenses WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!existing) throw notFound('Expense');
    if (existing.status === 'voided') throw bad('Cannot update a voided expense.', 'VOIDED');

    const expenseDate = V.date(b.expenseDate, 'Expense date', true)!;
    const category = V.str(b.category, 'Expense category', { required: true, max: 100 });
    const description = V.optStr(b.description, 'Description', 500);
    const notes = V.optStr(b.notes, 'Notes', 1000);
    const supplierId = V.optStr(b.supplierId, 'Supplier ID');
    let supplierName = V.optStr(b.supplierName, 'Supplier name', 200);
    let supplierGstin = V.optStr(b.supplierGstin, 'Supplier GSTIN', 15);
    const supplierInvoiceNumber = V.optStr(b.supplierInvoiceNumber, 'Supplier invoice/receipt number', 100);
    const supplierInvoiceDate = V.date(b.supplierInvoiceDate, 'Supplier invoice date');

    const taxInclusive = V.bool(b.taxInclusive, false);
    const taxRateBp = V.int(b.taxRateBp, 'Tax rate (bp)', { min: 0, max: 5000 });
    const amountMinor = V.int(b.amountMinor, 'Amount', { min: 1, required: true });

    const paymentMethod = V.oneOf(b.paymentMethod, 'Payment method', ['cash', 'upi', 'card', 'bank', 'cheque', 'credit'], 'cash');
    const paymentStatus = V.oneOf(b.paymentStatus, 'Payment status', ['paid', 'unpaid', 'partial'], 'paid');
    const paidMinorInput = V.int(b.paidMinor, 'Paid amount', { min: 0 });

    const gstTreatment = V.oneOf(
      b.gstTreatment,
      'GST treatment',
      ['regular', 'composition', 'exempt', 'nil_rated', 'non_gst', 'import'],
      'exempt',
    ) as GstTreatment;

    const itcEligibility = V.oneOf(
      b.itcEligibility,
      'ITC eligibility',
      ['eligible', 'ineligible', 'blocked_17_5', 'pending_review'],
      'ineligible',
    ) as ItcEligibility;

    if (supplierGstin) {
      supplierGstin = supplierGstin.toUpperCase().trim();
      const gstinVal = validateGstin(supplierGstin);
      if (!gstinVal.ok) {
        throw bad(`Supplier GSTIN is invalid: ${gstinVal.reason}`, 'INVALID_GSTIN');
      }
    }

    const tenant = await ctx.db.one<{ gstin?: string; state_code?: string }>('SELECT gstin, state_code FROM tenants WHERE id = ?', [tenantId]);
    const tenantState = tenant?.state_code || (tenant?.gstin ? tenant.gstin.slice(0, 2) : '33');
    const supplierState = supplierGstin ? supplierGstin.slice(0, 2) : tenantState;
    const intraState = tenantState === supplierState;

    const calc = calcExpense({
      amountMinor,
      taxInclusive,
      taxRateBp,
      intraState,
      gstTreatment,
      itcEligibility,
    });

    const totalMinor = calc.totalMinor;
    let paidMinor = 0;
    let balanceMinor = totalMinor;

    if (paymentStatus === 'paid') {
      paidMinor = totalMinor;
      balanceMinor = 0;
    } else if (paymentStatus === 'unpaid') {
      paidMinor = 0;
      balanceMinor = totalMinor;
    } else {
      paidMinor = Math.min(totalMinor, Math.max(0, paidMinorInput));
      balanceMinor = totalMinor - paidMinor;
    }

    let updated: any = null;
    await ctx.db.tx(async (q) => {
      updated = await q.one(
        `UPDATE expenses SET
          expense_date = ?, category = ?, description = ?, notes = ?,
          supplier_id = ?, supplier_name = ?, supplier_gstin = ?, supplier_invoice_number = ?, supplier_invoice_date = ?,
          tax_inclusive = ?, tax_rate_bp = ?, taxable_minor = ?, cgst_minor = ?, sgst_minor = ?, igst_minor = ?, total_minor = ?,
          payment_method = ?, payment_status = ?, paid_minor = ?, balance_minor = ?, gst_treatment = ?, itc_eligibility = ?,
          itc_minor = ?, updated_at = now()
         WHERE id = ? AND tenant_id = ?
         RETURNING *`,
        [
          expenseDate, category, description, notes,
          supplierId, supplierName, supplierGstin, supplierInvoiceNumber, supplierInvoiceDate,
          taxInclusive, taxRateBp, calc.taxableMinor, calc.cgstMinor, calc.sgstMinor, calc.igstMinor, totalMinor,
          paymentMethod, paymentStatus, paidMinor, balanceMinor, gstTreatment, itcEligibility,
          calc.itcMinor, ctx.params.id, tenantId,
        ],
      );

      // Keep ITC review synchronized
      if (calc.totalGstMinor > 0) {
        const periodStr = expenseDate.slice(0, 7);
        await q.exec(
          `INSERT INTO itc_reviews (
            id, tenant_id, doc_type, doc_id, return_period,
            original_taxable_minor, original_cgst_minor, original_sgst_minor, original_igst_minor, original_gst_minor,
            matching_status, eligibility_status,
            reviewed_eligible_cgst_minor, reviewed_eligible_sgst_minor, reviewed_eligible_igst_minor, reviewed_eligible_itc_minor,
            ineligible_itc_minor, mismatch_minor, review_decision_reason, reviewed_by, reviewed_at, created_at, updated_at
          ) VALUES (
            ?, ?, 'expense', ?, ?,
            ?, ?, ?, ?, ?,
            'pending_review', 'pending_review',
            ?, ?, ?, ?,
            ?, 0, 'Updated expense', ?, now(), now(), now()
          ) ON CONFLICT (tenant_id, doc_type, doc_id) DO UPDATE SET
            return_period = EXCLUDED.return_period,
            original_taxable_minor = EXCLUDED.original_taxable_minor,
            original_cgst_minor = EXCLUDED.original_cgst_minor,
            original_sgst_minor = EXCLUDED.original_sgst_minor,
            original_igst_minor = EXCLUDED.original_igst_minor,
            original_gst_minor = EXCLUDED.original_gst_minor,
            updated_at = now()`,
          [
            newId('itc'), tenantId, ctx.params.id, periodStr,
            calc.taxableMinor, calc.cgstMinor, calc.sgstMinor, calc.igstMinor, calc.totalGstMinor,
            calc.cgstMinor, calc.sgstMinor, calc.igstMinor, calc.itcMinor,
            calc.totalGstMinor - calc.itcMinor, ctx.user!.id,
          ],
        );
      } else {
        // If tax was set to zero, remove any pending review
        await q.exec('DELETE FROM itc_reviews WHERE tenant_id = ? AND doc_type = \'expense\' AND doc_id = ?', [tenantId, ctx.params.id]);
      }

      await audit(q, ctx, {
        action: 'expense.update',
        entity: 'expense',
        entityId: ctx.params.id,
        detail: { totalMinor, category },
      });
    });

    return { expense: formatExpense(updated) };
  });

  // 6. Void Expense
  r.post('/api/expenses/:id/void', requirePerm('expenses.void'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const reason = V.str(ctx.body?.reason, 'Void reason', { required: true, max: 300 });

    const existing = await ctx.db.one('SELECT * FROM expenses WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!existing) throw notFound('Expense');
    if (existing.status === 'voided') throw bad('Expense is already voided.', 'ALREADY_VOIDED');

    let voided: any = null;
    await ctx.db.tx(async (q) => {
      voided = await q.one(
        `UPDATE expenses SET
          status = 'voided', void_reason = ?, voided_by = ?, voided_at = now(), updated_at = now()
         WHERE id = ? AND tenant_id = ?
         RETURNING *`,
        [reason, ctx.user!.id, ctx.params.id, tenantId],
      );

      // Voided expense cannot claim ITC
      await q.exec(
        `UPDATE itc_reviews SET
          eligibility_status = 'ineligible_reviewed',
          reviewed_eligible_cgst_minor = 0,
          reviewed_eligible_sgst_minor = 0,
          reviewed_eligible_igst_minor = 0,
          reviewed_eligible_itc_minor = 0,
          ineligible_itc_minor = original_gst_minor,
          review_decision_reason = 'Expense voided: ' || ?,
          reviewed_by = ?, reviewed_at = now(), updated_at = now()
         WHERE tenant_id = ? AND doc_type = 'expense' AND doc_id = ?`,
        [reason, ctx.user!.id, tenantId, ctx.params.id],
      );

      await audit(q, ctx, {
        action: 'expense.void',
        entity: 'expense',
        entityId: ctx.params.id,
        detail: { reason },
      });
    });

    return { expense: formatExpense(voided) };
  });
}
