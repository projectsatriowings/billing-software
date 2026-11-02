import { requirePerm } from '../auth.ts';
import { bad, type Router } from '../http.ts';
import { resolveBranchScope } from '../branchScope.ts';

export function registerReports(r: Router) {
  r.get('/api/reports/dashboard', requirePerm('reports'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const userRole = ctx.user!.role;
    const todayStr = new Date().toISOString().slice(0, 10);

    const scope = await resolveBranchScope(ctx);
    const branchFilterSql = (!scope.isSuperAdminAll && scope.branchId) ? 'AND branch_id = ?' : '';
    const branchParams = (!scope.isSuperAdminAll && scope.branchId) ? [scope.branchId] : [];

    // Today's gross sales
    const todaySales = await ctx.db.one<{ count: number; total: number; taxable: number; gst: number }>(
      `SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(total_minor), 0)::bigint AS total,
        COALESCE(SUM(taxable_minor), 0)::bigint AS taxable,
        COALESCE(SUM(cgst_minor + sgst_minor + igst_minor), 0)::bigint AS gst
       FROM invoices
       WHERE tenant_id = ? AND bdate = ? AND status = 'posted' AND kind = 'sale' ${branchFilterSql}`,
      [tenantId, todayStr, ...branchParams],
    );

    // Today's credit notes (returns)
    // Section 10.2: Sales and GST are reversed in the credit note's period, not the original bill's period
    const todayCredits = await ctx.db.one<{ count: number; total: number; taxable: number; gst: number }>(
      `SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(total_minor), 0)::bigint AS total,
        COALESCE(SUM(taxable_minor), 0)::bigint AS taxable,
        COALESCE(SUM(cgst_minor + sgst_minor + igst_minor), 0)::bigint AS gst
       FROM invoices
       WHERE tenant_id = ? AND bdate = ? AND status = 'posted' AND kind = 'credit_note' ${branchFilterSql}`,
      [tenantId, todayStr, ...branchParams],
    );

    const grossTotalMinor = Number(todaySales?.total ?? 0);
    const grossTaxableMinor = Number(todaySales?.taxable ?? 0);
    const grossGstMinor = Number(todaySales?.gst ?? 0);

    const creditTotalMinor = Number(todayCredits?.total ?? 0);
    const creditTaxableMinor = Number(todayCredits?.taxable ?? 0);
    const creditGstMinor = Number(todayCredits?.gst ?? 0);

    // Net sales & GST after credit note reversals in this period
    const netTotalMinor = Math.max(0, grossTotalMinor - creditTotalMinor);
    const netTaxableMinor = Math.max(0, grossTaxableMinor - creditTaxableMinor);
    const netGstMinor = Math.max(0, grossGstMinor - creditGstMinor);
    const returnRatePct = grossTotalMinor > 0 ? Number(((creditTotalMinor / grossTotalMinor) * 100).toFixed(2)) : 0;

    // Today's customer collections (excluding reversed payments)
    const collectionStats = await ctx.db.one<{ total: number }>(
      `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS total
       FROM payments
       WHERE tenant_id = ?
         AND (status IS NULL OR status = 'posted')
         AND (bdate = ? OR (payment_date IS NOT NULL AND payment_date::date = ?::date) OR created_at::date = ?::date)
         ${branchFilterSql}`,
      [tenantId, todayStr, todayStr, todayStr, ...branchParams],
    );

    // Overall / Monthly summary (Gross sales minus Credit notes)
    const overallSales = await ctx.db.one<{ count: number; total: number }>(
      `SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(total_minor), 0)::bigint AS total
       FROM invoices
       WHERE tenant_id = ? AND status = 'posted' AND kind = 'sale' ${branchFilterSql}`,
      [tenantId, ...branchParams],
    );

    const overallCredits = await ctx.db.one<{ count: number; total: number }>(
      `SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(total_minor), 0)::bigint AS total
       FROM invoices
       WHERE tenant_id = ? AND status = 'posted' AND kind = 'credit_note' ${branchFilterSql}`,
      [tenantId, ...branchParams],
    );

    const overallGrossTotal = Number(overallSales?.total ?? 0);
    const overallCreditTotal = Number(overallCredits?.total ?? 0);
    const overallNetTotal = Math.max(0, overallGrossTotal - overallCreditTotal);

    // Customer dues outstanding
    const duesStats = await ctx.db.one<{ total: number }>(
      `SELECT COALESCE(SUM(balance_minor), 0)::bigint AS total
       FROM invoices
       WHERE tenant_id = ? AND status = 'posted' AND kind = 'sale' AND balance_minor > 0 ${branchFilterSql}`,
      [tenantId, ...branchParams],
    );
    const outstandingDuesMinor = Number(duesStats?.total ?? 0);

    // Shifts metrics (open shifts, pending review, discrepancies)
    const shiftStats = await ctx.db.one<{ openCount: number; reviewCount: number; discCount: number }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'open')::int AS open_count,
         COUNT(*) FILTER (WHERE status = 'closed' AND reviewed_by IS NULL)::int AS review_count,
         COUNT(*) FILTER (WHERE status = 'closed' AND variance_minor IS NOT NULL AND variance_minor != 0)::int AS disc_count
       FROM shifts
       WHERE tenant_id = ? ${branchFilterSql}`,
      [tenantId, ...branchParams],
    );

    // Branch comparison for Super Admin / Owner
    let branchComparison: any[] = [];
    let totalBranchesCount = 1;
    let activeBranchesCount = 1;
    let totalCountersCount = 1;

    if (userRole === 'owner' || (userRole as string) === 'SUPER_ADMIN') {
      const branches = await ctx.db.query<any>(
        'SELECT id, code, name, active, counters FROM branches WHERE tenant_id = ? ORDER BY code = \'MAIN\' DESC, code ASC',
        [tenantId],
      );
      totalBranchesCount = branches.length || 1;
      activeBranchesCount = branches.filter((b) => b.active).length || 1;
      totalCountersCount = branches.reduce((sum, b) => {
        const c = Array.isArray(b.counters) ? b.counters : (typeof b.counters === 'string' ? JSON.parse(b.counters) : ['COUNTER-1']);
        return sum + (c.length || 1);
      }, 0);

      for (const b of branches) {
        const bSales = await ctx.db.one<{ count: number; total: number }>(
          `SELECT COUNT(*)::int AS count, COALESCE(SUM(total_minor), 0)::bigint AS total
           FROM invoices WHERE tenant_id = ? AND branch_id = ? AND bdate = ? AND status = 'posted' AND kind = 'sale'`,
          [tenantId, b.id, todayStr],
        );
        const bColls = await ctx.db.one<{ total: number }>(
          `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS total
           FROM payments WHERE tenant_id = ? AND branch_id = ? AND (status IS NULL OR status = 'posted')
             AND (bdate = ? OR (payment_date IS NOT NULL AND payment_date::date = ?::date))`,
          [tenantId, b.id, todayStr, todayStr],
        );
        const bShifts = await ctx.db.one<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM shifts WHERE tenant_id = ? AND branch_id = ? AND status = 'open'`,
          [tenantId, b.id],
        );
        const bCounters = Array.isArray(b.counters) ? b.counters : (typeof b.counters === 'string' ? JSON.parse(b.counters) : ['COUNTER-1']);

        branchComparison.push({
          id: b.id,
          code: b.code,
          name: b.name,
          active: Boolean(b.active ?? true),
          countersCount: bCounters.length,
          counters: bCounters,
          todaySalesCount: Number(bSales?.count ?? 0),
          todaySalesTotalMinor: Number(bSales?.total ?? 0),
          todayCollectionsMinor: Number(bColls?.total ?? 0),
          openShiftsCount: Number(bShifts?.count ?? 0),
        });
      }
    }

    // Refunds paid distinctly from collections (Section 10.2)
    const refundsPaid = await ctx.db.query<{ mode: string; total: number }>(
      `SELECT COALESCE(refund_mode, 'cash') AS mode, SUM(refund_amount_minor)::bigint AS total
       FROM invoices
       WHERE tenant_id = ? AND kind = 'credit_note' AND status = 'posted' AND refund_amount_minor > 0 ${branchFilterSql}
       GROUP BY COALESCE(refund_mode, 'cash')
       ORDER BY total DESC`,
      [tenantId, ...branchParams],
    );
    const totalRefundsPaidMinor = refundsPaid.reduce((sum, r) => sum + Number(r.total), 0);

    // Payment methods breakdown (reconciles checkout payments and collections; credit applied to dues is NOT a collection!)
    const paymentBreakdown = await ctx.db.query<{ method: string; total: number }>(
      `SELECT COALESCE(mode, method) AS method, SUM(amount_minor)::bigint AS total
       FROM payments
       WHERE tenant_id = ? AND (status IS NULL OR status = 'posted') ${branchFilterSql}
       GROUP BY COALESCE(mode, method)
       ORDER BY total DESC`,
      [tenantId, ...branchParams],
    );

    // Top selling items
    const topItemsBranchClause = (!scope.isSuperAdminAll && scope.branchId) ? 'AND i.branch_id = ?' : '';
    const topItems = await ctx.db.query<{ name: string; qty: number; total: number }>(
      `SELECT il.name, SUM(il.qty_milli)::bigint AS qty, SUM(il.total_minor)::bigint AS total
       FROM invoice_lines il
       JOIN invoices i ON i.id = il.invoice_id
       WHERE il.tenant_id = ? AND i.kind = 'sale' AND i.status = 'posted' ${topItemsBranchClause}
       GROUP BY il.name
       ORDER BY total DESC
       LIMIT 5`,
      (!scope.isSuperAdminAll && scope.branchId) ? [tenantId, scope.branchId] : [tenantId],
    );

    // Low stock alerts
    const lowStockBranchClause = (!scope.isSuperAdminAll && scope.branchId) ? 'AND i.branch_id = ?' : '';
    const lowStock = await ctx.db.query<{ id: string; name: string; sku: string; stock: number; reorder: number }>(
      `SELECT i.id, i.name, i.sku,
              COALESCE(SUM(sm.qty_milli), 0)::bigint AS stock,
              i.reorder_milli AS reorder
       FROM items i
       LEFT JOIN stock_moves sm ON sm.item_id = i.id AND sm.tenant_id = i.tenant_id AND sm.branch_id = i.branch_id
       WHERE i.tenant_id = ? AND i.active = true AND i.track_stock = true ${lowStockBranchClause}
       GROUP BY i.id
       HAVING COALESCE(SUM(sm.qty_milli), 0) <= 20000
       LIMIT 5`,
      (!scope.isSuperAdminAll && scope.branchId) ? [tenantId, scope.branchId] : [tenantId],
    );

    // Customer count & item count
    const totalCustomers = await ctx.db.one<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM parties WHERE tenant_id = ? AND type = 'customer' AND active = true ${branchFilterSql}`,
      [tenantId, ...branchParams],
    );
    const totalItems = await ctx.db.one<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM items WHERE tenant_id = ? AND active = true ${branchFilterSql}`,
      [tenantId, ...branchParams],
    );

    // Today's Purchases & Input Tax Credit (ITC)
    const todayPurchases = await ctx.db.one<{ count: number; total: number; taxable: number; itc: number }>(
      `SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(total_minor), 0)::bigint AS total,
        COALESCE(SUM(taxable_minor), 0)::bigint AS taxable,
        COALESCE(SUM(itc_minor), 0)::bigint AS itc
       FROM purchases
       WHERE tenant_id = ? AND status != 'voided' AND COALESCE(purchase_date, bdate) = ? ${branchFilterSql}`,
      [tenantId, todayStr, ...branchParams],
    );

    const purchaseTotalMinor = Number(todayPurchases?.total ?? 0);
    const purchaseTaxableMinor = Number(todayPurchases?.taxable ?? 0);
    const purchaseItcMinor = Number(todayPurchases?.itc ?? 0);

    // GST Netting Position: Output GST (sales - credit note reversals) - Input GST (ITC)
    const netGstPayableMinor = Math.max(0, netGstMinor - purchaseItcMinor);

    // Today's Supplier Payments Out
    const todaySupplierPayments = await ctx.db.one<{ total: number }>(
      `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS total
       FROM payments
       WHERE tenant_id = ? AND kind = 'supplier_payment' AND status != 'voided'
         AND (bdate = ? OR (payment_date IS NOT NULL AND payment_date::date = ?::date))
         ${branchFilterSql}`,
      [tenantId, todayStr, todayStr, ...branchParams],
    );

    // Total Supplier Payables
    const totalSupplierPayables = await ctx.db.one<{ total: number }>(
      `SELECT COALESCE(SUM(balance_minor), 0)::bigint AS total
       FROM purchases
       WHERE tenant_id = ? AND status != 'voided' AND balance_minor > 0 ${branchFilterSql}`,
      [tenantId, ...branchParams],
    );

    // Stock valuation at last purchase price
    const stockValuationBranchClause = (!scope.isSuperAdminAll && scope.branchId) ? 'AND sm.branch_id = ?' : '';
    const stockValuation = await ctx.db.one<{ total: number }>(
      `SELECT COALESCE(SUM(sm.qty_milli * it.cost_minor / 1000), 0)::bigint AS total
       FROM stock_moves sm
       JOIN items it ON it.id = sm.item_id AND it.tenant_id = sm.tenant_id AND it.branch_id = sm.branch_id
       WHERE sm.tenant_id = ? ${stockValuationBranchClause}`,
      (!scope.isSuperAdminAll && scope.branchId) ? [tenantId, scope.branchId] : [tenantId],
    );

    return {
      today: {
        billCount: Number(todaySales?.count ?? 0),
        grossTotalMinor,
        totalMinor: netTotalMinor,
        taxableMinor: netTaxableMinor,
        gstMinor: netGstMinor,
        customerCollectionsMinor: Number(collectionStats?.total ?? 0),
        khataCollectionsMinor: Number(collectionStats?.total ?? 0),
        totalCreditNotesMinor: creditTotalMinor,
        creditNotesCount: Number(todayCredits?.count ?? 0),
        returnRatePct,
        purchasesCount: Number(todayPurchases?.count ?? 0),
        purchasesTotalMinor: purchaseTotalMinor,
        purchasesTaxableMinor: purchaseTaxableMinor,
        itcMinor: purchaseItcMinor,
        netGstPayableMinor,
        supplierPaymentsMinor: Number(todaySupplierPayments?.total ?? 0),
      },
      overall: {
        billCount: Number(overallSales?.count ?? 0),
        grossTotalMinor: overallGrossTotal,
        totalMinor: overallNetTotal,
        totalCreditNotesMinor: overallCreditTotal,
        customerCount: Number(totalCustomers?.count ?? 0),
        itemCount: Number(totalItems?.count ?? 0),
        totalSupplierPayablesMinor: Number(totalSupplierPayables?.total ?? 0),
        stockValuationMinor: Number(stockValuation?.total ?? 0),
      },
      gstPosition: {
        outputGstMinor: netGstMinor,
        itcMinor: purchaseItcMinor,
        netGstPayableMinor,
      },
      paymentBreakdown: paymentBreakdown.map((p) => ({ method: p.method, totalMinor: Number(p.total) })),
      refundsPaid: refundsPaid.map((r) => ({ mode: r.mode, totalMinor: Number(r.total) })),
      totalRefundsPaidMinor,
      topItems: topItems.map((i) => ({ name: i.name, qtyMilli: Number(i.qty), totalMinor: Number(i.total) })),
      lowStock: lowStock.map((l) => ({ id: l.id, name: l.name, sku: l.sku, currentStockMilli: Number(l.stock) })),
      branchesOverview: {
        totalBranches: totalBranchesCount,
        activeBranches: activeBranchesCount,
        totalCounters: totalCountersCount,
      },
      branchComparison,
      shiftsSummary: {
        openShiftsCount: Number(shiftStats?.openCount ?? 0),
        pendingReviewShiftsCount: Number(shiftStats?.reviewCount ?? 0),
        discrepanciesCount: Number(shiftStats?.discCount ?? 0),
      },
      outstandingDuesMinor,
    };
  });
}
