import { requirePerm, requireUser } from '../auth.ts';
import { type Router } from '../http.ts';

export function registerReports(r: Router) {
  r.get('/api/reports/dashboard', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const todayStr = new Date().toISOString().slice(0, 10);

    // Today's gross sales
    const todaySales = await ctx.db.one<{ count: number; total: number; taxable: number; gst: number }>(
      `SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(total_minor), 0)::bigint AS total,
        COALESCE(SUM(taxable_minor), 0)::bigint AS taxable,
        COALESCE(SUM(cgst_minor + sgst_minor + igst_minor), 0)::bigint AS gst
       FROM invoices
       WHERE tenant_id = ? AND bdate = ? AND status = 'posted' AND kind = 'sale'`,
      [tenantId, todayStr],
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
       WHERE tenant_id = ? AND bdate = ? AND status = 'posted' AND kind = 'credit_note'`,
      [tenantId, todayStr],
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

    // Today's Khata collections (excluding reversed payments)
    const khataStats = await ctx.db.one<{ total: number }>(
      `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS total
       FROM payments
       WHERE tenant_id = ?
         AND customer_id IS NOT NULL
         AND (status IS NULL OR status = 'posted')
         AND (payment_date::date = ?::date OR (payment_date IS NULL AND created_at::date = ?::date))`,
      [tenantId, todayStr, todayStr],
    );

    // Overall / Monthly summary (Gross sales minus Credit notes)
    const overallSales = await ctx.db.one<{ count: number; total: number }>(
      `SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(total_minor), 0)::bigint AS total
       FROM invoices
       WHERE tenant_id = ? AND status = 'posted' AND kind = 'sale'`,
      [tenantId],
    );

    const overallCredits = await ctx.db.one<{ count: number; total: number }>(
      `SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(total_minor), 0)::bigint AS total
       FROM invoices
       WHERE tenant_id = ? AND status = 'posted' AND kind = 'credit_note'`,
      [tenantId],
    );

    const overallGrossTotal = Number(overallSales?.total ?? 0);
    const overallCreditTotal = Number(overallCredits?.total ?? 0);
    const overallNetTotal = Math.max(0, overallGrossTotal - overallCreditTotal);

    // Refunds paid distinctly from collections (Section 10.2)
    const refundsPaid = await ctx.db.query<{ mode: string; total: number }>(
      `SELECT COALESCE(refund_mode, 'cash') AS mode, SUM(refund_amount_minor)::bigint AS total
       FROM invoices
       WHERE tenant_id = ? AND kind = 'credit_note' AND status = 'posted' AND refund_amount_minor > 0
       GROUP BY COALESCE(refund_mode, 'cash')
       ORDER BY total DESC`,
      [tenantId],
    );
    const totalRefundsPaidMinor = refundsPaid.reduce((sum, r) => sum + Number(r.total), 0);

    // Payment methods breakdown (reconciles checkout payments and Khata collections; credit applied to dues is NOT a collection!)
    const paymentBreakdown = await ctx.db.query<{ method: string; total: number }>(
      `SELECT COALESCE(mode, method) AS method, SUM(amount_minor)::bigint AS total
       FROM payments
       WHERE tenant_id = ? AND (status IS NULL OR status = 'posted')
       GROUP BY COALESCE(mode, method)
       ORDER BY total DESC`,
      [tenantId],
    );

    // Top selling items
    const topItems = await ctx.db.query<{ name: string; qty: number; total: number }>(
      `SELECT il.name, SUM(il.qty_milli)::bigint AS qty, SUM(il.total_minor)::bigint AS total
       FROM invoice_lines il
       JOIN invoices i ON i.id = il.invoice_id
       WHERE il.tenant_id = ? AND i.kind = 'sale' AND i.status = 'posted'
       GROUP BY il.name
       ORDER BY total DESC
       LIMIT 5`,
      [tenantId],
    );

    // Low stock alerts
    const lowStock = await ctx.db.query<{ id: string; name: string; sku: string; stock: number; reorder: number }>(
      `SELECT i.id, i.name, i.sku,
              COALESCE(SUM(sm.qty_milli), 0)::bigint AS stock,
              i.reorder_milli AS reorder
       FROM items i
       LEFT JOIN stock_moves sm ON sm.item_id = i.id AND sm.tenant_id = i.tenant_id
       WHERE i.tenant_id = ? AND i.active = true AND i.track_stock = true
       GROUP BY i.id
       HAVING COALESCE(SUM(sm.qty_milli), 0) <= 20000
       LIMIT 5`,
      [tenantId],
    );

    // Customer count & item count
    const totalCustomers = await ctx.db.one<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM parties WHERE tenant_id = ? AND type = 'customer' AND active = true`,
      [tenantId],
    );
    const totalItems = await ctx.db.one<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM items WHERE tenant_id = ? AND active = true`,
      [tenantId],
    );

    // Today's Purchases & Input Tax Credit (ITC)
    const todayPurchases = await ctx.db.one<{ count: number; total: number; taxable: number; itc: number }>(
      `SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(total_minor), 0)::bigint AS total,
        COALESCE(SUM(taxable_minor), 0)::bigint AS taxable,
        COALESCE(SUM(itc_minor), 0)::bigint AS itc
       FROM purchases
       WHERE tenant_id = ? AND status != 'voided' AND COALESCE(purchase_date, bdate) = ?`,
      [tenantId, todayStr],
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
         AND (bdate = ? OR (payment_date IS NOT NULL AND payment_date::date = ?::date))`,
      [tenantId, todayStr, todayStr],
    );

    // Total Supplier Payables
    const totalSupplierPayables = await ctx.db.one<{ total: number }>(
      `SELECT COALESCE(SUM(balance_minor), 0)::bigint AS total
       FROM purchases
       WHERE tenant_id = ? AND status != 'voided' AND balance_minor > 0`,
      [tenantId],
    );

    // Stock valuation at last purchase price
    const stockValuation = await ctx.db.one<{ total: number }>(
      `SELECT COALESCE(SUM(sm.qty_milli * it.cost_minor / 1000), 0)::bigint AS total
       FROM stock_moves sm
       JOIN items it ON it.id = sm.item_id AND it.tenant_id = sm.tenant_id
       WHERE sm.tenant_id = ?`,
      [tenantId],
    );

    return {
      today: {
        billCount: Number(todaySales?.count ?? 0),
        grossTotalMinor,
        totalMinor: netTotalMinor,
        taxableMinor: netTaxableMinor,
        gstMinor: netGstMinor,
        khataCollectionsMinor: Number(khataStats?.total ?? 0),
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
    };
  });
}

