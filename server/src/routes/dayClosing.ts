import { requirePerm, requireUser } from '../auth.ts';
import { bad, notFound, HtmlResponse, V, type Router } from '../http.ts';
import { newId } from '../security.ts';
import { j } from '../db/index.ts';
import { audit } from '../audit.ts';
import { fmtMoney } from '../../../shared/money.ts';

export function registerDayClosing(r: Router) {
  // 1. Live preview / aggregation for a business day
  r.get('/api/day-closing/preview', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const todayStr = new Date().toISOString().slice(0, 10);
    const bdate = String(ctx.query.bdate || todayStr).trim();
    const branchId = String(ctx.query.branchId || ctx.user!.assignedLocation || 'MAIN').trim();

    // Check if day is already closed
    const closedRecord = await ctx.db.one<any>(
      `SELECT dc.*, u.name AS closed_by_name, vu.name AS verified_by_name
       FROM day_closings dc
       LEFT JOIN users u ON u.id = dc.closed_by
       LEFT JOIN users vu ON vu.id = dc.verified_by
       WHERE dc.tenant_id = ? AND dc.branch_id = ? AND dc.bdate = ?`,
      [tenantId, branchId, bdate],
    );

    // Sales Summary
    const salesRow = await ctx.db.one<any>(
      `SELECT
        COUNT(*)::int AS invoices_count,
        COALESCE(SUM(total_minor), 0)::bigint AS gross_sales_minor
       FROM invoices
       WHERE tenant_id = ? AND branch_id = ? AND bdate = ? AND status = 'posted' AND kind = 'sale'`,
      [tenantId, branchId, bdate],
    );

    const returnsRow = await ctx.db.one<any>(
      `SELECT
        COUNT(*)::int AS returns_count,
        COALESCE(SUM(total_minor), 0)::bigint AS returns_total_minor
       FROM invoices
       WHERE tenant_id = ? AND branch_id = ? AND bdate = ? AND status = 'posted' AND kind = 'credit_note'`,
      [tenantId, branchId, bdate],
    );

    const grossSalesMinor = Number(salesRow?.grossSalesMinor ?? salesRow?.gross_sales_minor ?? 0);
    const returnsTotalMinor = Number(returnsRow?.returnsTotalMinor ?? returnsRow?.returns_total_minor ?? 0);
    const netSalesMinor = Math.max(0, grossSalesMinor - returnsTotalMinor);
    const invoicesCount = Number(salesRow?.invoicesCount ?? salesRow?.invoices_count ?? 0);
    const returnsCount = Number(returnsRow?.returnsCount ?? returnsRow?.returns_count ?? 0);

    // Return & Refund Summary
    const refundsRow = await ctx.db.one<any>(
      `SELECT
        COUNT(*)::int AS refunds_count,
        COALESCE(SUM(CASE WHEN method = 'cash' THEN amount_minor ELSE 0 END), 0)::bigint AS cash_refunds_minor,
        COALESCE(SUM(CASE WHEN method = 'upi' THEN amount_minor ELSE 0 END), 0)::bigint AS upi_refunds_minor,
        COALESCE(SUM(amount_minor), 0)::bigint AS total_refunds_minor
       FROM refund_transactions
       WHERE tenant_id = ? AND (bdate = ? OR (created_at)::date = ?::date)`,
      [tenantId, bdate, bdate],
    );

    const storeCreditRow = await ctx.db.one<any>(
      `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS store_credits_issued_minor
       FROM store_credits
       WHERE tenant_id = ? AND DATE(created_at) = ?::date`,
      [tenantId, bdate],
    );

    const exchangeAdjustRow = await ctx.db.one<any>(
      `SELECT COALESCE(SUM(exchange_adjusted_minor), 0)::bigint AS exchange_adjusted_minor
       FROM invoices
       WHERE tenant_id = ? AND branch_id = ? AND bdate = ? AND is_exchange = TRUE AND kind = 'sale'`,
      [tenantId, branchId, bdate],
    );

    const cashRefundsPaidMinor = Number(refundsRow?.cashRefundsMinor ?? refundsRow?.cash_refunds_minor ?? 0);
    const upiRefundsPaidMinor = Number(refundsRow?.upiRefundsMinor ?? refundsRow?.upi_refunds_minor ?? 0);
    const totalRefundsMinor = Number(refundsRow?.totalRefundsMinor ?? refundsRow?.total_refunds_minor ?? 0);
    const storeCreditsIssuedMinor = Number(storeCreditRow?.storeCreditsIssuedMinor ?? storeCreditRow?.store_credits_issued_minor ?? 0);
    const exchangeCreditAdjustedMinor = Number(exchangeAdjustRow?.exchangeAdjustedMinor ?? exchangeAdjustRow?.exchange_adjusted_minor ?? 0);

    // Exchange Summary
    const exchangeStatsRow = await ctx.db.one<any>(
      `SELECT
        COUNT(DISTINCT exchange_id)::int AS exchanges_count,
        COALESCE(SUM(CASE WHEN kind = 'sale' THEN total_minor ELSE 0 END), 0)::bigint AS new_sold_minor,
        COALESCE(SUM(CASE WHEN kind = 'credit_note' THEN total_minor ELSE 0 END), 0)::bigint AS old_returned_minor
       FROM invoices
       WHERE tenant_id = ? AND branch_id = ? AND bdate = ? AND is_exchange = TRUE AND status = 'posted'`,
      [tenantId, branchId, bdate],
    );

    const exchangesCount = Number(exchangeStatsRow?.exchangesCount ?? exchangeStatsRow?.exchanges_count ?? 0);
    const newProductsSoldMinor = Number(exchangeStatsRow?.newSoldMinor ?? exchangeStatsRow?.new_sold_minor ?? 0);
    const oldProductsReturnedMinor = Number(exchangeStatsRow?.oldReturnedMinor ?? exchangeStatsRow?.old_returned_minor ?? 0);
    const additionalAmountCollectedMinor = Math.max(0, newProductsSoldMinor - oldProductsReturnedMinor);
    const remainingCustomerCreditMinor = Math.max(0, oldProductsReturnedMinor - newProductsSoldMinor);

    // Payment Collections Summary
    const paymentRows = await ctx.db.query<any>(
      `SELECT
        COALESCE(p.method, 'cash') AS method,
        COUNT(*)::int AS count,
        COALESCE(SUM(p.amount_minor), 0)::bigint AS total_minor
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       WHERE p.tenant_id = ?
         AND (p.status IS NULL OR p.status = 'posted')
         AND (p.bdate = ? OR (p.created_at)::date = ?::date)
         AND (p.invoice_id IS NULL OR i.branch_id IS NULL OR i.branch_id = ?)
       GROUP BY COALESCE(p.method, 'cash')`,
      [tenantId, bdate, bdate, branchId],
    );

    let cashCollectionsMinor = 0;
    let upiCollectionsMinor = 0;
    let cardCollectionsMinor = 0;
    let otherCollectionsMinor = 0;
    const collectionsSummary: Record<string, number> = {};

    for (const pr of paymentRows) {
      const m = String(pr.method).toLowerCase();
      const amt = Number(pr.totalMinor ?? pr.total_minor ?? 0);
      collectionsSummary[m] = amt;
      if (m === 'cash') cashCollectionsMinor += amt;
      else if (m === 'upi') upiCollectionsMinor += amt;
      else if (m === 'card') cardCollectionsMinor += amt;
      else otherCollectionsMinor += amt;
    }

    // Cash Reconciliation
    // Opening Cash from shifts for this date and branch
    const shiftsRow = await ctx.db.one<any>(
      `SELECT COALESCE(SUM(opening_cash_minor), 0)::bigint AS opening_cash_minor
       FROM shifts
       WHERE tenant_id = ? AND (location = ? OR branch_id = ?) AND (DATE(opened_at) = ?::date OR (created_at)::date = ?::date)`,
      [tenantId, branchId, branchId, bdate, bdate],
    );
    const openingCashMinor = Number(shiftsRow?.openingCashMinor ?? shiftsRow?.opening_cash_minor ?? 0);

    // Cash Expenses
    const expensesRow = await ctx.db.one<any>(
      `SELECT
        COALESCE(SUM(total_minor), 0)::bigint AS total_expenses_minor,
        COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total_minor ELSE 0 END), 0)::bigint AS cash_expenses_minor
       FROM expenses
       WHERE tenant_id = ? AND branch_id = ? AND expense_date = ? AND status = 'posted'`,
      [tenantId, branchId, bdate],
    );
    const cashExpensesMinor = Number(expensesRow?.cashExpensesMinor ?? expensesRow?.cash_expenses_minor ?? 0);
    const operatingExpensesMinor = Number(expensesRow?.totalExpensesMinor ?? expensesRow?.total_expenses_minor ?? 0);

    // Cash movements (In/Out)
    const cashMovesRow = await ctx.db.one<any>(
      `SELECT
        COALESCE(SUM(CASE WHEN cm.movement_type = 'cash_in' THEN cm.amount_minor ELSE 0 END), 0)::bigint AS cash_in_minor,
        COALESCE(SUM(CASE WHEN cm.movement_type = 'cash_out' THEN cm.amount_minor ELSE 0 END), 0)::bigint AS cash_out_minor
       FROM cash_movements cm
       JOIN shifts s ON s.id = cm.shift_id
       WHERE cm.tenant_id = ? AND (s.location = ? OR s.branch_id = ?) AND (DATE(cm.created_at) = ?::date)`,
      [tenantId, branchId, branchId, bdate],
    );
    const cashInMinor = Number(cashMovesRow?.cashInMinor ?? cashMovesRow?.cash_in_minor ?? 0);
    const cashOutMinor = Number(cashMovesRow?.cashOutMinor ?? cashMovesRow?.cash_out_minor ?? 0);

    // Authoritative Formula:
    // Expected Closing Cash = Opening Cash + Cash Receipts - Cash Refunds - Cash Expenses - Cash Withdrawals + Cash Deposits
    const expectedClosingCashMinor =
      openingCashMinor + cashCollectionsMinor - cashRefundsPaidMinor - cashExpensesMinor - cashOutMinor + cashInMinor;

    // Profit & COGS Summary
    // COGS for new sales
    const salesCogsRow = await ctx.db.one<any>(
      `SELECT COALESCE(SUM(il.qty_milli * COALESCE(il.cost_minor, it.cost_minor, 0) / 1000), 0)::bigint AS cogs_minor
       FROM invoice_lines il
       JOIN invoices i ON i.id = il.invoice_id
       LEFT JOIN items it ON it.id = il.item_id
       WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.kind = 'sale' AND i.status = 'posted'`,
      [tenantId, branchId, bdate],
    );
    const cogsMinor = Number(salesCogsRow?.cogsMinor ?? salesCogsRow?.cogs_minor ?? 0);

    // Returned COGS for resellable products
    const returnedCogsRow = await ctx.db.one<any>(
      `SELECT COALESCE(SUM(il.qty_milli * COALESCE(il.cost_minor, it.cost_minor, 0) / 1000), 0)::bigint AS returned_cogs_minor
       FROM invoice_lines il
       JOIN invoices i ON i.id = il.invoice_id
       LEFT JOIN items it ON it.id = il.item_id
       WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.kind = 'credit_note' AND i.status = 'posted'
         AND (il.item_condition = 'resellable' OR il.restock = TRUE)`,
      [tenantId, branchId, bdate],
    );
    const returnedCogsMinor = Number(returnedCogsRow?.returnedCogsMinor ?? returnedCogsRow?.returned_cogs_minor ?? 0);

    const netCogsMinor = Math.max(0, cogsMinor - returnedCogsMinor);
    const grossProfitMinor = netSalesMinor - netCogsMinor;
    const netProfitMinor = grossProfitMinor - operatingExpensesMinor;

    return {
      bdate,
      branchId,
      isClosed: Boolean(closedRecord && closedRecord.status === 'closed'),
      closedRecord: closedRecord || null,

      // A. Sales Summary
      salesSummary: {
        grossSalesMinor,
        returnsTotalMinor,
        netSalesMinor,
        invoicesCount,
        returnsCount,
      },

      // B. Return Summary
      returnSummary: {
        totalReturnsCount: returnsCount,
        totalReturnValueMinor: returnsTotalMinor,
        cashRefundsPaidMinor,
        upiRefundsPaidMinor,
        exchangeCreditAdjustedMinor,
        storeCreditsIssuedMinor,
        totalRefundsMinor,
      },

      // C. Exchange Summary
      exchangeSummary: {
        exchangesCount,
        oldProductsReturnedMinor,
        newProductsSoldMinor,
        additionalAmountCollectedMinor,
        remainingCustomerCreditMinor,
      },

      // D. Payment Summary
      paymentSummary: {
        cashCollectionsMinor,
        upiCollectionsMinor,
        cardCollectionsMinor,
        otherCollectionsMinor,
        totalCollectionsMinor: cashCollectionsMinor + upiCollectionsMinor + cardCollectionsMinor + otherCollectionsMinor,
        breakdown: collectionsSummary,
      },

      // E. Cash Reconciliation
      cashReconciliation: {
        openingCashMinor,
        cashSalesReceivedMinor: cashCollectionsMinor,
        cashRefundsPaidMinor,
        cashExpensesMinor,
        cashInMinor,
        cashOutMinor,
        expectedClosingCashMinor,
        actualClosingCashMinor: closedRecord ? Number(closedRecord.actual_cash_minor) : null,
        varianceMinor: closedRecord ? Number(closedRecord.variance_minor) : null,
      },

      // F. Profit Summary
      profitSummary: {
        netSalesMinor,
        cogsMinor,
        returnedCogsMinor,
        netCogsMinor,
        grossProfitMinor,
        operatingExpensesMinor,
        netProfitMinor,
      },
    };
  });

  // 2. Submit Day Closing
  r.post('/api/day-closing/submit', requirePerm('shift'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};

    const todayStr = new Date().toISOString().slice(0, 10);
    const bdate = String(b.bdate || todayStr).trim();
    const branchId = String(b.branchId || ctx.user!.assignedLocation || 'MAIN').trim();
    const actualCashMinor = V.int(b.actualCashMinor, 'Actual closing cash', { min: 0 });
    const remarks = V.optStr(b.remarks, 'Closing remarks', 500);

    let savedRecord: any = null;

    await ctx.db.tx(async (q) => {
      // 1. Prevent duplicate Day Closing
      const existing = await q.one<any>(
        'SELECT * FROM day_closings WHERE tenant_id = ? AND branch_id = ? AND bdate = ? FOR UPDATE',
        [tenantId, branchId, bdate],
      );
      if (existing && existing.status === 'closed') {
        throw bad(`Day ${bdate} is already closed for this branch. Cannot submit duplicate day closing.`, 'ALREADY_CLOSED');
      }

      // Re-aggregate authoritative figures inside transaction
      // Gross sales
      const salesRow = await q.one<any>(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(total_minor), 0)::bigint AS total
         FROM invoices WHERE tenant_id = ? AND branch_id = ? AND bdate = ? AND status = 'posted' AND kind = 'sale'`,
        [tenantId, branchId, bdate],
      );
      // Returns
      const returnsRow = await q.one<any>(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(total_minor), 0)::bigint AS total
         FROM invoices WHERE tenant_id = ? AND branch_id = ? AND bdate = ? AND status = 'posted' AND kind = 'credit_note'`,
        [tenantId, branchId, bdate],
      );

      const grossSalesMinor = Number(salesRow?.total || 0);
      const returnsTotalMinor = Number(returnsRow?.total || 0);
      const netSalesMinor = Math.max(0, grossSalesMinor - returnsTotalMinor);
      const invoicesCount = Number(salesRow?.count || 0);
      const returnsCount = Number(returnsRow?.count || 0);

      // Refunds
      const refundsRow = await q.one<any>(
        `SELECT
          COUNT(*)::int AS count,
          COALESCE(SUM(CASE WHEN method = 'cash' THEN amount_minor ELSE 0 END), 0)::bigint AS cash_refunds,
          COALESCE(SUM(CASE WHEN method = 'upi' THEN amount_minor ELSE 0 END), 0)::bigint AS upi_refunds
         FROM refund_transactions WHERE tenant_id = ? AND (bdate = ? OR (created_at)::date = ?::date)`,
        [tenantId, bdate, bdate],
      );
      const cashRefundsMinor = Number(refundsRow?.cashRefunds ?? refundsRow?.cash_refunds ?? 0);
      const upiRefundsMinor = Number(refundsRow?.upiRefunds ?? refundsRow?.upi_refunds ?? 0);
      const refundsCount = Number(refundsRow?.count || 0);

      // Exchanges
      const exchangeRow = await q.one<any>(
        `SELECT
          COUNT(DISTINCT exchange_id)::int AS count,
          COALESCE(SUM(exchange_adjusted_minor), 0)::bigint AS adjusted,
          COALESCE(SUM(CASE WHEN kind = 'sale' THEN total_minor ELSE 0 END), 0)::bigint AS new_sold,
          COALESCE(SUM(CASE WHEN kind = 'credit_note' THEN total_minor ELSE 0 END), 0)::bigint AS old_returned
         FROM invoices WHERE tenant_id = ? AND branch_id = ? AND bdate = ? AND is_exchange = TRUE AND status = 'posted'`,
        [tenantId, branchId, bdate],
      );
      const exchangesCount = Number(exchangeRow?.count || 0);
      const exchangeAdjustedMinor = Number(exchangeRow?.adjusted || 0);
      const newSoldMinor = Number(exchangeRow?.newSold ?? exchangeRow?.new_sold ?? 0);
      const oldReturnedMinor = Number(exchangeRow?.oldReturned ?? exchangeRow?.old_returned ?? 0);

      // Store credits issued
      const scRow = await q.one<any>(
        `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS total FROM store_credits WHERE tenant_id = ? AND DATE(created_at) = ?::date`,
        [tenantId, bdate],
      );
      const storeCreditsIssuedMinor = Number(scRow?.total || 0);

      // Cash collections
      const paymentsRow = await q.one<any>(
        `SELECT
          COALESCE(SUM(CASE WHEN COALESCE(p.method, 'cash') = 'cash' THEN p.amount_minor ELSE 0 END), 0)::bigint AS cash,
          COALESCE(SUM(CASE WHEN p.method = 'upi' THEN p.amount_minor ELSE 0 END), 0)::bigint AS upi,
          COALESCE(SUM(CASE WHEN p.method = 'card' THEN p.amount_minor ELSE 0 END), 0)::bigint AS card
         FROM payments p
         LEFT JOIN invoices i ON i.id = p.invoice_id
         WHERE p.tenant_id = ? AND (p.status IS NULL OR p.status = 'posted') AND (p.bdate = ? OR (p.created_at)::date = ?::date)
           AND (p.invoice_id IS NULL OR i.branch_id IS NULL OR i.branch_id = ?)`,
        [tenantId, bdate, bdate, branchId],
      );
      const cashSalesMinor = Number(paymentsRow?.cash || 0);
      const upiCollectionsMinor = Number(paymentsRow?.upi || 0);
      const cardCollectionsMinor = Number(paymentsRow?.card || 0);

      // Opening Cash from shifts
      const shiftsRow = await q.one<any>(
        `SELECT COALESCE(SUM(opening_cash_minor), 0)::bigint AS total
         FROM shifts WHERE tenant_id = ? AND (location = ? OR branch_id = ?) AND (DATE(opened_at) = ?::date OR (created_at)::date = ?::date)`,
        [tenantId, branchId, branchId, bdate, bdate],
      );
      const openingCashMinor = Number(shiftsRow?.total || 0);

      // Expenses
      const expRow = await q.one<any>(
        `SELECT
          COALESCE(SUM(total_minor), 0)::bigint AS total,
          COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total_minor ELSE 0 END), 0)::bigint AS cash
         FROM expenses WHERE tenant_id = ? AND branch_id = ? AND expense_date = ? AND status = 'posted'`,
        [tenantId, branchId, bdate],
      );
      const cashExpensesMinor = Number(expRow?.cash || 0);
      const operatingExpensesMinor = Number(expRow?.total || 0);

      // Cash movements
      const cmRow = await q.one<any>(
        `SELECT
          COALESCE(SUM(CASE WHEN cm.movement_type = 'cash_in' THEN cm.amount_minor ELSE 0 END), 0)::bigint AS cin,
          COALESCE(SUM(CASE WHEN cm.movement_type = 'cash_out' THEN cm.amount_minor ELSE 0 END), 0)::bigint AS cout
         FROM cash_movements cm
         JOIN shifts s ON s.id = cm.shift_id
         WHERE cm.tenant_id = ? AND (s.location = ? OR s.branch_id = ?) AND (DATE(cm.created_at) = ?::date)`,
        [tenantId, branchId, branchId, bdate],
      );
      const cashInMinor = Number(cmRow?.cin || 0);
      const cashOutMinor = Number(cmRow?.cout || 0);

      // Formula: Expected Closing Cash = Opening Cash + Cash Receipts - Cash Refunds - Cash Expenses - Cash Withdrawals + Cash Deposits
      const expectedCashMinor =
        openingCashMinor + cashSalesMinor - cashRefundsMinor - cashExpensesMinor - cashOutMinor + cashInMinor;
      const varianceMinor = actualCashMinor - expectedCashMinor;

      // Profit & COGS
      const salesCogsRow = await q.one<any>(
        `SELECT COALESCE(SUM(il.qty_milli * COALESCE(il.cost_minor, it.cost_minor, 0) / 1000), 0)::bigint AS cogs
         FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id LEFT JOIN items it ON it.id = il.item_id
         WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.kind = 'sale' AND i.status = 'posted'`,
        [tenantId, branchId, bdate],
      );
      const cogsMinor = Number(salesCogsRow?.cogs || 0);

      const retCogsRow = await q.one<any>(
        `SELECT COALESCE(SUM(il.qty_milli * COALESCE(il.cost_minor, it.cost_minor, 0) / 1000), 0)::bigint AS cogs
         FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id LEFT JOIN items it ON it.id = il.item_id
         WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.kind = 'credit_note' AND i.status = 'posted'
           AND (il.item_condition = 'resellable' OR il.restock = TRUE)`,
        [tenantId, branchId, bdate],
      );
      const returnedCogsMinor = Number(retCogsRow?.cogs || 0);
      const netCogsMinor = Math.max(0, cogsMinor - returnedCogsMinor);
      const grossProfitMinor = netSalesMinor - netCogsMinor;
      const netProfitMinor = grossProfitMinor - operatingExpensesMinor;

      const closingId = existing?.id || newId('dc');

      if (existing) {
        await q.exec(
          `UPDATE day_closings
           SET status = 'closed',
               opening_cash_minor = ?, cash_sales_minor = ?, cash_refunds_minor = ?, cash_expenses_minor = ?,
               cash_in_minor = ?, cash_out_minor = ?, expected_cash_minor = ?, actual_cash_minor = ?, variance_minor = ?,
               gross_sales_minor = ?, returns_total_minor = ?, net_sales_minor = ?, invoices_count = ?, returns_count = ?,
               exchanges_count = ?, refunds_count = ?, cogs_minor = ?, returned_cogs_minor = ?, net_cogs_minor = ?,
               gross_profit_minor = ?, operating_expenses_minor = ?, net_profit_minor = ?,
               collections_summary = ?, returns_summary = ?, exchanges_summary = ?,
               remarks = ?, closed_by = ?, closed_at = NOW()
           WHERE id = ?`,
          [
            openingCashMinor, cashSalesMinor, cashRefundsMinor, cashExpensesMinor,
            cashInMinor, cashOutMinor, expectedCashMinor, actualCashMinor, varianceMinor,
            grossSalesMinor, returnsTotalMinor, netSalesMinor, invoicesCount, returnsCount,
            exchangesCount, refundsCount, cogsMinor, returnedCogsMinor, netCogsMinor,
            grossProfitMinor, operatingExpensesMinor, netProfitMinor,
            j({ cash: cashSalesMinor, upi: upiCollectionsMinor, card: cardCollectionsMinor }),
            j({ totalValueMinor: returnsTotalMinor, cashRefundsMinor, upiRefundsMinor, exchangeAdjustedMinor, storeCreditsIssuedMinor }),
            j({ count: exchangesCount, oldReturnedMinor, newSoldMinor, diffCollectedMinor: Math.max(0, newSoldMinor - oldReturnedMinor), remainingCreditMinor: Math.max(0, oldReturnedMinor - newSoldMinor) }),
            remarks || null, ctx.user!.id, closingId,
          ],
        );
      } else {
        await q.exec(
          `INSERT INTO day_closings (
            id, tenant_id, branch_id, bdate, status,
            opening_cash_minor, cash_sales_minor, cash_refunds_minor, cash_expenses_minor,
            cash_in_minor, cash_out_minor, expected_cash_minor, actual_cash_minor, variance_minor,
            gross_sales_minor, returns_total_minor, net_sales_minor, invoices_count, returns_count,
            exchanges_count, refunds_count, cogs_minor, returned_cogs_minor, net_cogs_minor,
            gross_profit_minor, operating_expenses_minor, net_profit_minor,
            collections_summary, returns_summary, exchanges_summary,
            remarks, closed_by, closed_at, created_at
          ) VALUES (
            ?, ?, ?, ?, 'closed',
            ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, NOW(), NOW()
          )`,
          [
            closingId, tenantId, branchId, bdate,
            openingCashMinor, cashSalesMinor, cashRefundsMinor, cashExpensesMinor,
            cashInMinor, cashOutMinor, expectedCashMinor, actualCashMinor, varianceMinor,
            grossSalesMinor, returnsTotalMinor, netSalesMinor, invoicesCount, returnsCount,
            exchangesCount, refundsCount, cogsMinor, returnedCogsMinor, netCogsMinor,
            grossProfitMinor, operatingExpensesMinor, netProfitMinor,
            j({ cash: cashSalesMinor, upi: upiCollectionsMinor, card: cardCollectionsMinor }),
            j({ totalValueMinor: returnsTotalMinor, cashRefundsMinor, upiRefundsMinor, exchangeAdjustedMinor, storeCreditsIssuedMinor }),
            j({ count: exchangesCount, oldReturnedMinor, newSoldMinor, diffCollectedMinor: Math.max(0, newSoldMinor - oldReturnedMinor), remainingCreditMinor: Math.max(0, oldReturnedMinor - newSoldMinor) }),
            remarks || null, ctx.user!.id,
          ],
        );
      }

      // Mark invoices as closed for the day
      await q.exec(
        `UPDATE invoices SET is_day_closed = TRUE WHERE tenant_id = ? AND branch_id = ? AND bdate = ?`,
        [tenantId, branchId, bdate],
      );

      // Audit log
      await audit(q, ctx, {
        action: 'day_closing.submit',
        entity: 'day_closing',
        entityId: closingId,
        detail: {
          bdate,
          branchId,
          expectedCashMinor,
          actualCashMinor,
          varianceMinor,
          netSalesMinor,
          grossProfitMinor,
          netProfitMinor,
        },
      });

      savedRecord = {
        id: closingId,
        bdate,
        branchId,
        status: 'closed',
        expectedCashMinor,
        actualCashMinor,
        varianceMinor,
        netSalesMinor,
        grossProfitMinor,
        netProfitMinor,
      };
    });

    return { success: true, dayClosing: savedRecord };
  });

  // 3. Historical Day Closings
  r.get('/api/day-closing/history', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const branchId = ctx.query.branchId as string;
    const limit = Math.min(100, Math.max(1, Number(ctx.query.limit || 30)));

    let sql = `
      SELECT dc.*, u.name AS closed_by_name, vu.name AS verified_by_name, b.name AS branch_name
      FROM day_closings dc
      LEFT JOIN users u ON u.id = dc.closed_by
      LEFT JOIN users vu ON vu.id = dc.verified_by
      LEFT JOIN branches b ON b.id = dc.branch_id OR b.code = dc.branch_id
      WHERE dc.tenant_id = ?
    `;
    const params: any[] = [tenantId];

    if (branchId && branchId !== 'all') {
      sql += ` AND dc.branch_id = ?`;
      params.push(branchId);
    }

    sql += ` ORDER BY dc.bdate DESC LIMIT ?`;
    params.push(limit);

    const history = await ctx.db.query<any>(sql, params);
    return { history };
  });

  // 4. Printable Day Closing Report
  r.get('/api/day-closing/:id/print', async (ctx) => {
    const id = ctx.params.id;
    const tenantId = (ctx.query.tenantId as string) || ctx.user?.tenantId;
    if (!tenantId) throw bad('Missing tenantId');

    const shop = await ctx.db.one<any>('SELECT * FROM tenants WHERE id = ?', [tenantId]);
    if (!shop) throw notFound('Shop');

    const dc = await ctx.db.one<any>(
      `SELECT dc.*, u.name AS closed_by_name, vu.name AS verified_by_name, b.name AS branch_name
       FROM day_closings dc
       LEFT JOIN users u ON u.id = dc.closed_by
       LEFT JOIN users vu ON vu.id = dc.verified_by
       LEFT JOIN branches b ON b.id = dc.branch_id OR b.code = dc.branch_id
       WHERE dc.tenant_id = ? AND dc.id = ?`,
      [tenantId, id],
    );
    if (!dc) throw notFound('Day closing record');

    const variance = Number(dc.variance_minor || 0);
    const varianceColor = variance === 0 ? '#16a34a' : variance > 0 ? '#2563eb' : '#dc2626';
    const varianceLabel = variance === 0 ? 'BALANCED' : variance > 0 ? `EXCESS (+${fmtMoney(variance)})` : `SHORTAGE (${fmtMoney(variance)})`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Day Closing Report - ${dc.bdate}</title>
  <style>
    @media print { @page { margin: 10mm; size: auto; } }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 24px; color: #1e293b; background: #fff; font-size: 0.88rem; }
    .sheet { max-width: 650px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 8px; padding: 28px; }
    .header { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px; }
    .shop-title { font-size: 1.4rem; font-weight: 800; text-transform: uppercase; margin: 0; }
    .report-badge { display: inline-block; background: #0f172a; color: #fff; font-size: 0.78rem; font-weight: 800; padding: 4px 12px; border-radius: 4px; margin-top: 8px; letter-spacing: 0.8px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    .box { border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 14px; background: #f8fafc; }
    .box-title { font-size: 0.75rem; font-weight: 800; text-transform: uppercase; color: #64748b; margin-bottom: 8px; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
    .box table { width: 100%; border-collapse: collapse; }
    .box td { padding: 4px 0; }
    .text-right { text-align: right; }
    .font-bold { font-weight: 700; }
    .font-black { font-weight: 800; }
    .val-highlight { font-size: 1.15rem; font-weight: 800; }
    .footer { margin-top: 28px; display: flex; justify-content: space-between; border-top: 1px dashed #cbd5e1; padding-top: 24px; }
    .sig-line { width: 160px; border-top: 1px solid #0f172a; text-align: center; font-size: 0.75rem; padding-top: 4px; }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <h1 class="shop-title">${shop.name || 'Textile POS'}</h1>
      <div>${shop.address || ''}</div>
      ${shop.gstin ? `<div>GSTIN: <strong>${shop.gstin}</strong></div>` : ''}
      <div class="report-badge">DAILY BUSINESS CLOSING REPORT</div>
    </div>

    <table style="width: 100%; margin-bottom: 16px; font-size: 0.85rem;">
      <tr>
        <td><strong>Closing Date:</strong> ${dc.bdate}</td>
        <td class="text-right"><strong>Branch:</strong> ${dc.branch_name || dc.branch_id}</td>
      </tr>
      <tr>
        <td><strong>Closed By:</strong> ${dc.closed_by_name || 'Cashier'}</td>
        <td class="text-right"><strong>Closed At:</strong> ${new Date(dc.closed_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</td>
      </tr>
    </table>

    <div class="grid">
      <!-- A. Sales Summary -->
      <div class="box">
        <div class="box-title">A. Sales Performance</div>
        <table>
          <tr><td>Gross Sales (${dc.invoices_count} bills):</td><td class="text-right font-bold">${fmtMoney(dc.gross_sales_minor)}</td></tr>
          <tr><td style="color: #dc2626;">Sales Returns (${dc.returns_count} returns):</td><td class="text-right font-bold" style="color: #dc2626;">-${fmtMoney(dc.returns_total_minor)}</td></tr>
          <tr style="border-top: 1px solid #cbd5e1;"><td><strong>Net Daily Sales:</strong></td><td class="text-right val-highlight" style="color: #0f172a;">${fmtMoney(dc.net_sales_minor)}</td></tr>
        </table>
      </div>

      <!-- B. Cash Drawer Reconciliation -->
      <div class="box">
        <div class="box-title">B. Cash Drawer Reconciliation</div>
        <table>
          <tr><td>Opening Drawer Cash:</td><td class="text-right">${fmtMoney(dc.opening_cash_minor)}</td></tr>
          <tr><td>Cash Sales Received:</td><td class="text-right" style="color: #16a34a;">+${fmtMoney(dc.cash_sales_minor)}</td></tr>
          <tr><td>Cash Refunds Paid:</td><td class="text-right" style="color: #dc2626;">-${fmtMoney(dc.cash_refunds_minor)}</td></tr>
          <tr><td>Cash Expenses Paid:</td><td class="text-right" style="color: #dc2626;">-${fmtMoney(dc.cash_expenses_minor)}</td></tr>
          <tr><td>Cash In / Deposits:</td><td class="text-right">+${fmtMoney(dc.cash_in_minor)}</td></tr>
          <tr><td>Cash Out / Withdrawals:</td><td class="text-right">-${fmtMoney(dc.cash_out_minor)}</td></tr>
          <tr style="border-top: 1px solid #cbd5e1;"><td><strong>Expected Cash:</strong></td><td class="text-right font-black">${fmtMoney(dc.expected_cash_minor)}</td></tr>
          <tr><td><strong>Actual Counted Cash:</strong></td><td class="text-right font-black">${fmtMoney(dc.actual_cash_minor)}</td></tr>
          <tr style="border-top: 1px dashed #cbd5e1;">
            <td><strong>Variance / Diff:</strong></td>
            <td class="text-right font-black" style="color: ${varianceColor};">${varianceLabel}</td>
          </tr>
        </table>
      </div>
    </div>

    <div class="grid">
      <!-- C. Returns & Exchanges -->
      <div class="box">
        <div class="box-title">C. Returns, Exchanges & Refunds</div>
        <table>
          <tr><td>Total Returns Value:</td><td class="text-right">${fmtMoney(dc.returns_total_minor)}</td></tr>
          <tr><td>Cash Refunds Disbursed:</td><td class="text-right">${fmtMoney(dc.cash_refunds_minor)}</td></tr>
          <tr><td>Number of Exchanges:</td><td class="text-right">${dc.exchanges_count}</td></tr>
          <tr><td>Number of Refunds:</td><td class="text-right">${dc.refunds_count}</td></tr>
        </table>
      </div>

      <!-- D. Profit & Margin -->
      <div class="box">
        <div class="box-title">D. Gross & Net Profit Summary</div>
        <table>
          <tr><td>Net Sales:</td><td class="text-right">${fmtMoney(dc.net_sales_minor)}</td></tr>
          <tr><td>Net COGS (Product Cost):</td><td class="text-right">-${fmtMoney(dc.net_cogs_minor)}</td></tr>
          <tr style="border-top: 1px solid #cbd5e1;"><td><strong>Gross Profit:</strong></td><td class="text-right font-bold" style="color: #16a34a;">${fmtMoney(dc.gross_profit_minor)}</td></tr>
          <tr><td>Operating Expenses:</td><td class="text-right">-${fmtMoney(dc.operating_expenses_minor)}</td></tr>
          <tr style="border-top: 1px solid #cbd5e1;"><td><strong>Net Profit:</strong></td><td class="text-right val-highlight" style="color: #2563eb;">${fmtMoney(dc.net_profit_minor)}</td></tr>
        </table>
      </div>
    </div>

    ${dc.remarks ? `
      <div style="margin-top: 12px; padding: 8px 12px; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; font-size: 0.8rem;">
        <strong>Closing Remarks:</strong> ${dc.remarks}
      </div>
    ` : ''}

    <div class="footer">
      <div class="sig-line">Cashier Signature</div>
      <div class="sig-line">Store Manager Signature</div>
    </div>
  </div>
  <script>window.onload = function() { window.print(); };</script>
</body>
</html>`;

    return new HtmlResponse(html);
  });
}
