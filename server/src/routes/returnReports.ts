import { requirePerm, requireUser } from '../auth.ts';
import { bad, type Router } from '../http.ts';
import { resolveBranchScope } from '../branchScope.ts';

function getDateRange(filter: string, from?: string, to?: string): { startDate: string; endDate: string } {
  const now = new Date();
  const formatYMD = (d: Date) => d.toISOString().slice(0, 10);

  if (filter === 'yesterday') {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yStr = formatYMD(y);
    return { startDate: yStr, endDate: yStr };
  }
  if (filter === 'this_week') {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
    const monday = new Date(d.setDate(diff));
    return { startDate: formatYMD(monday), endDate: formatYMD(now) };
  }
  if (filter === 'this_month') {
    const d = new Date();
    const firstDay = new Date(d.getFullYear(), d.getMonth(), 1);
    return { startDate: formatYMD(firstDay), endDate: formatYMD(now) };
  }
  if (filter === 'custom' && from && to) {
    return { startDate: from, endDate: to };
  }
  // Default: today
  const todayStr = formatYMD(now);
  return { startDate: todayStr, endDate: todayStr };
}

export function registerReturnReports(r: Router) {
  r.get('/api/reports/returns-module', requirePerm('reports'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const reportType = String(ctx.query.reportType || 'daily_sales').toLowerCase();
    const filter = String(ctx.query.filter || 'today').toLowerCase();
    const { startDate, endDate } = getDateRange(filter, ctx.query.from as string, ctx.query.to as string);

    const scope = await resolveBranchScope(ctx);
    const branchFilterSql = (!scope.isSuperAdminAll && scope.branchId) ? 'AND i.branch_id = ?' : '';
    const branchParams = (!scope.isSuperAdminAll && scope.branchId) ? [scope.branchId] : [];

    // 1. DAILY SALES REPORT
    if (reportType === 'daily_sales') {
      const rows = await ctx.db.query<any>(
        `WITH sales AS (
          SELECT bdate,
                 COUNT(*)::int AS sales_count,
                 COALESCE(SUM(total_minor), 0)::bigint AS gross_sales_minor
          FROM invoices i
          WHERE i.tenant_id = ? AND i.kind = 'sale' AND i.status = 'posted'
            AND i.bdate >= ? AND i.bdate <= ? ${branchFilterSql}
          GROUP BY bdate
        ),
        returns AS (
          SELECT bdate,
                 COUNT(*)::int AS returns_count,
                 COALESCE(SUM(total_minor), 0)::bigint AS returns_minor
          FROM invoices i
          WHERE i.tenant_id = ? AND i.kind = 'credit_note' AND i.status = 'posted'
            AND i.bdate >= ? AND i.bdate <= ? ${branchFilterSql}
          GROUP BY bdate
        ),
        payments_summary AS (
          SELECT (p.created_at)::date::text AS bdate,
                 COALESCE(SUM(CASE WHEN COALESCE(p.method, 'cash') = 'cash' THEN p.amount_minor ELSE 0 END), 0)::bigint AS cash_minor,
                 COALESCE(SUM(CASE WHEN p.method = 'upi' THEN p.amount_minor ELSE 0 END), 0)::bigint AS upi_minor,
                 COALESCE(SUM(CASE WHEN p.method = 'card' THEN p.amount_minor ELSE 0 END), 0)::bigint AS card_minor
          FROM payments p
          LEFT JOIN invoices i ON i.id = p.invoice_id
          WHERE p.tenant_id = ? AND (p.status IS NULL OR p.status = 'posted')
            AND (p.created_at)::date >= ?::date AND (p.created_at)::date <= ?::date
            ${branchFilterSql}
          GROUP BY (p.created_at)::date::text
        )
        SELECT
          COALESCE(s.bdate, r.bdate, p.bdate) AS date,
          COALESCE(s.gross_sales_minor, 0)::bigint AS gross_sales_minor,
          COALESCE(r.returns_minor, 0)::bigint AS returns_minor,
          (COALESCE(s.gross_sales_minor, 0) - COALESCE(r.returns_minor, 0))::bigint AS net_sales_minor,
          COALESCE(s.sales_count, 0)::int AS sales_count,
          COALESCE(r.returns_count, 0)::int AS returns_count,
          COALESCE(p.cash_minor, 0)::bigint AS cash_minor,
          COALESCE(p.upi_minor, 0)::bigint AS upi_minor,
          COALESCE(p.card_minor, 0)::bigint AS card_minor
        FROM sales s
        FULL OUTER JOIN returns r ON r.bdate = s.bdate
        FULL OUTER JOIN payments_summary p ON p.bdate = COALESCE(s.bdate, r.bdate)
        ORDER BY date DESC`,
        [
          tenantId, startDate, endDate, ...branchParams,
          tenantId, startDate, endDate, ...branchParams,
          tenantId, startDate, endDate, ...branchParams,
        ],
      );
      return { reportType, filter, startDate, endDate, rows };
    }

    // 2. SALES RETURN REPORT
    if (reportType === 'sales_returns') {
      const rows = await ctx.db.query<any>(
        `SELECT
          cn.id AS return_id,
          cn.number AS return_number,
          cn.bdate AS return_date,
          cn.created_at AS return_timestamp,
          orig.number AS orig_invoice_number,
          orig.bdate AS orig_sale_date,
          COALESCE(cn.customer_name, 'Retail Customer') AS customer_name,
          cn.customer_phone,
          il.name AS product_name,
          il.qty_milli::bigint AS return_qty_milli,
          il.unit,
          il.total_minor::bigint AS return_amount_minor,
          il.reason AS return_reason,
          COALESCE(il.item_condition, 'resellable') AS item_condition,
          COALESCE(cn.refund_mode, 'credit') AS refund_method,
          u.name AS processed_by
         FROM invoices cn
         JOIN invoice_lines il ON il.invoice_id = cn.id
         LEFT JOIN invoices orig ON orig.id = cn.linked_invoice_id
         LEFT JOIN users u ON u.id = cn.created_by
         WHERE cn.tenant_id = ?
           AND cn.kind = 'credit_note'
           AND cn.status = 'posted'
           AND cn.bdate >= ? AND cn.bdate <= ?
           ${branchFilterSql.replace('i.branch_id', 'cn.branch_id')}
         ORDER BY cn.created_at DESC`,
        [tenantId, startDate, endDate, ...branchParams],
      );
      return { reportType, filter, startDate, endDate, rows };
    }

    // 3. EXCHANGE REPORT
    if (reportType === 'exchanges') {
      const rows = await ctx.db.query<any>(
        `SELECT
          sale.exchange_id,
          sale.bdate AS date,
          sale.created_at AS timestamp,
          sale.number AS new_invoice_number,
          cn.number AS return_credit_note_number,
          COALESCE(cn.total_minor, 0)::bigint AS old_returned_minor,
          COALESCE(sale.total_minor, 0)::bigint AS new_sold_minor,
          COALESCE(sale.exchange_adjusted_minor, 0)::bigint AS exchange_adjusted_minor,
          GREATEST(0, COALESCE(sale.total_minor, 0) - COALESCE(cn.total_minor, 0))::bigint AS customer_difference_paid_minor,
          GREATEST(0, COALESCE(cn.total_minor, 0) - COALESCE(sale.total_minor, 0))::bigint AS remaining_credit_minor,
          COALESCE(sale.customer_name, 'Retail Customer') AS customer_name,
          sale.customer_phone,
          u.name AS processed_by
         FROM invoices sale
         LEFT JOIN invoices cn ON cn.exchange_id = sale.exchange_id AND cn.kind = 'credit_note'
         LEFT JOIN users u ON u.id = sale.created_by
         WHERE sale.tenant_id = ?
           AND sale.is_exchange = TRUE
           AND sale.kind = 'sale'
           AND sale.status = 'posted'
           AND sale.bdate >= ? AND sale.bdate <= ?
           ${branchFilterSql.replace('i.branch_id', 'sale.branch_id')}
         ORDER BY sale.created_at DESC`,
        [tenantId, startDate, endDate, ...branchParams],
      );
      return { reportType, filter, startDate, endDate, rows };
    }

    // 4. REFUND REPORT
    if (reportType === 'refunds') {
      const rows = await ctx.db.query<any>(
        `SELECT
          rfd.id AS refund_id,
          rfd.bdate AS refund_date,
          rfd.created_at AS timestamp,
          rfd.amount_minor::bigint AS refund_amount_minor,
          rfd.method AS refund_method,
          rfd.reference_no,
          cn.number AS credit_note_number,
          orig.number AS orig_invoice_number,
          COALESCE(p.name, cn.customer_name, 'Retail Customer') AS customer_name,
          u.name AS processed_by,
          rfd.notes
         FROM refund_transactions rfd
         LEFT JOIN invoices cn ON cn.id = rfd.credit_note_id
         LEFT JOIN invoices orig ON orig.id = rfd.orig_invoice_id
         LEFT JOIN parties p ON p.id = rfd.party_id
         LEFT JOIN users u ON u.id = rfd.processed_by
         WHERE rfd.tenant_id = ?
           AND rfd.bdate >= ? AND rfd.bdate <= ?
         ORDER BY rfd.created_at DESC`,
        [tenantId, startDate, endDate],
      );
      return { reportType, filter, startDate, endDate, rows };
    }

    // 5. DAILY GROSS PROFIT REPORT
    if (reportType === 'gross_profit') {
      const rows = await ctx.db.query<any>(
        `WITH daily_sales AS (
          SELECT bdate,
                 COALESCE(SUM(total_minor), 0)::bigint AS gross_sales_minor
          FROM invoices i
          WHERE i.tenant_id = ? AND i.kind = 'sale' AND i.status = 'posted'
            AND i.bdate >= ? AND i.bdate <= ? ${branchFilterSql}
          GROUP BY bdate
        ),
        daily_returns AS (
          SELECT bdate,
                 COALESCE(SUM(total_minor), 0)::bigint AS returns_minor
          FROM invoices i
          WHERE i.tenant_id = ? AND i.kind = 'credit_note' AND i.status = 'posted'
            AND i.bdate >= ? AND i.bdate <= ? ${branchFilterSql}
          GROUP BY bdate
        ),
        sales_cogs AS (
          SELECT i.bdate,
                 COALESCE(SUM(il.qty_milli * COALESCE(il.cost_minor, it.cost_minor, 0) / 1000), 0)::bigint AS sold_cogs_minor
          FROM invoice_lines il
          JOIN invoices i ON i.id = il.invoice_id
          LEFT JOIN items it ON it.id = il.item_id
          WHERE i.tenant_id = ? AND i.kind = 'sale' AND i.status = 'posted'
            AND i.bdate >= ? AND i.bdate <= ? ${branchFilterSql}
          GROUP BY i.bdate
        ),
        returned_cogs AS (
          SELECT i.bdate,
                 COALESCE(SUM(il.qty_milli * COALESCE(il.cost_minor, it.cost_minor, 0) / 1000), 0)::bigint AS restock_cogs_minor
          FROM invoice_lines il
          JOIN invoices i ON i.id = il.invoice_id
          LEFT JOIN items it ON it.id = il.item_id
          WHERE i.tenant_id = ? AND i.kind = 'credit_note' AND i.status = 'posted'
            AND (il.item_condition = 'resellable' OR il.restock = TRUE)
            AND i.bdate >= ? AND i.bdate <= ? ${branchFilterSql}
          GROUP BY i.bdate
        ),
        daily_expenses AS (
          SELECT expense_date AS bdate,
                 COALESCE(SUM(total_minor), 0)::bigint AS expenses_minor
          FROM expenses
          WHERE tenant_id = ? AND status = 'posted'
            AND expense_date >= ? AND expense_date <= ?
          GROUP BY expense_date
        )
        SELECT
          ds.bdate AS date,
          COALESCE(ds.gross_sales_minor, 0)::bigint AS gross_sales_minor,
          COALESCE(dr.returns_minor, 0)::bigint AS returns_minor,
          (COALESCE(ds.gross_sales_minor, 0) - COALESCE(dr.returns_minor, 0))::bigint AS net_sales_minor,
          COALESCE(sc.sold_cogs_minor, 0)::bigint AS sold_cogs_minor,
          COALESCE(rc.restock_cogs_minor, 0)::bigint AS restock_cogs_minor,
          (COALESCE(sc.sold_cogs_minor, 0) - COALESCE(rc.restock_cogs_minor, 0))::bigint AS net_cogs_minor,
          ((COALESCE(ds.gross_sales_minor, 0) - COALESCE(dr.returns_minor, 0)) -
           (COALESCE(sc.sold_cogs_minor, 0) - COALESCE(rc.restock_cogs_minor, 0)))::bigint AS gross_profit_minor,
          COALESCE(de.expenses_minor, 0)::bigint AS operating_expenses_minor,
          (((COALESCE(ds.gross_sales_minor, 0) - COALESCE(dr.returns_minor, 0)) -
           (COALESCE(sc.sold_cogs_minor, 0) - COALESCE(rc.restock_cogs_minor, 0))) -
           COALESCE(de.expenses_minor, 0))::bigint AS net_profit_minor
        FROM daily_sales ds
        LEFT JOIN daily_returns dr ON dr.bdate = ds.bdate
        LEFT JOIN sales_cogs sc ON sc.bdate = ds.bdate
        LEFT JOIN returned_cogs rc ON rc.bdate = ds.bdate
        LEFT JOIN daily_expenses de ON de.bdate = ds.bdate
        ORDER BY ds.bdate DESC`,
        [
          tenantId, startDate, endDate, ...branchParams,
          tenantId, startDate, endDate, ...branchParams,
          tenantId, startDate, endDate, ...branchParams,
          tenantId, startDate, endDate, ...branchParams,
          tenantId, startDate, endDate,
        ],
      );
      return { reportType, filter, startDate, endDate, rows };
    }

    // 6. STOCK RETURN REPORT (Resellable vs Damaged vs Defective)
    if (reportType === 'stock_returns') {
      const rows = await ctx.db.query<any>(
        `SELECT
          il.id,
          cn.bdate AS return_date,
          cn.number AS credit_note_number,
          orig.number AS orig_invoice_number,
          COALESCE(il.item_condition, 'resellable') AS item_condition,
          il.name AS product_name,
          COALESCE(it.barcode, it.sku, '—') AS barcode,
          il.qty_milli::bigint AS return_qty_milli,
          il.unit,
          il.price_minor::bigint AS price_minor,
          il.total_minor::bigint AS total_return_amount_minor,
          COALESCE(il.cost_minor, it.cost_minor, 0)::bigint AS unit_cost_minor,
          (il.qty_milli * COALESCE(il.cost_minor, it.cost_minor, 0) / 1000)::bigint AS total_cost_value_minor,
          il.reason,
          cn.customer_name,
          u.name AS processed_by
         FROM invoice_lines il
         JOIN invoices cn ON cn.id = il.invoice_id
         LEFT JOIN invoices orig ON orig.id = cn.linked_invoice_id
         LEFT JOIN items it ON it.id = il.item_id
         LEFT JOIN users u ON u.id = cn.created_by
         WHERE cn.tenant_id = ?
           AND cn.kind = 'credit_note'
           AND cn.status = 'posted'
           AND cn.bdate >= ? AND cn.bdate <= ?
           ${branchFilterSql.replace('i.branch_id', 'cn.branch_id')}
         ORDER BY cn.created_at DESC`,
        [tenantId, startDate, endDate, ...branchParams],
      );

      // Summary counts by condition
      let resellableCount = 0;
      let damagedCount = 0;
      let defectiveCount = 0;
      let resellableValueMinor = 0;
      let damagedValueMinor = 0;
      let defectiveValueMinor = 0;

      for (const r of rows) {
        const c = String(r.item_condition).toLowerCase();
        const amt = Number(r.total_return_amount_minor || 0);
        if (c === 'damaged') {
          damagedCount++;
          damagedValueMinor += amt;
        } else if (c === 'defective') {
          defectiveCount++;
          defectiveValueMinor += amt;
        } else {
          resellableCount++;
          resellableValueMinor += amt;
        }
      }

      return {
        reportType,
        filter,
        startDate,
        endDate,
        summary: {
          resellableCount,
          damagedCount,
          defectiveCount,
          resellableValueMinor,
          damagedValueMinor,
          defectiveValueMinor,
        },
        rows,
      };
    }

    // 7. CUSTOMER STORE CREDIT REPORT
    if (reportType === 'store_credits') {
      const rows = await ctx.db.query<any>(
        `SELECT
          sc.id,
          sc.reference_no,
          sc.amount_minor::bigint AS issued_amount_minor,
          sc.balance_minor::bigint AS remaining_balance_minor,
          sc.status,
          sc.created_at::date AS date_issued,
          sc.updated_at AS last_updated,
          p.name AS customer_name,
          p.phone AS customer_phone,
          p.advance_minor::bigint AS total_current_wallet_advance_minor,
          cn.number AS credit_note_number,
          u.name AS issued_by
         FROM store_credits sc
         JOIN parties p ON p.id = sc.party_id
         LEFT JOIN invoices cn ON cn.id = sc.credit_note_id
         LEFT JOIN users u ON u.id = sc.created_by
         WHERE sc.tenant_id = ?
         ORDER BY sc.created_at DESC`,
        [tenantId],
      );
      return { reportType, filter, rows };
    }

    // 8. CASHIER-WISE SALES AND RETURN REPORT
    if (reportType === 'cashier_performance') {
      const rows = await ctx.db.query<any>(
        `SELECT
          u.id AS cashier_id,
          u.name AS cashier_name,
          u.role AS cashier_role,
          COUNT(CASE WHEN i.kind = 'sale' THEN 1 END)::int AS sales_count,
          COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN i.total_minor ELSE 0 END), 0)::bigint AS gross_sales_minor,
          COUNT(CASE WHEN i.kind = 'credit_note' THEN 1 END)::int AS returns_count,
          COALESCE(SUM(CASE WHEN i.kind = 'credit_note' THEN i.total_minor ELSE 0 END), 0)::bigint AS returns_minor,
          (COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN i.total_minor ELSE 0 END), 0) -
           COALESCE(SUM(CASE WHEN i.kind = 'credit_note' THEN i.total_minor ELSE 0 END), 0))::bigint AS net_sales_minor,
          COUNT(CASE WHEN i.is_exchange = TRUE AND i.kind = 'sale' THEN 1 END)::int AS exchanges_count
         FROM users u
         LEFT JOIN invoices i ON i.created_by = u.id AND i.tenant_id = u.tenant_id AND i.status = 'posted'
           AND i.bdate >= ? AND i.bdate <= ?
         WHERE u.tenant_id = ?
         GROUP BY u.id, u.name, u.role
         ORDER BY gross_sales_minor DESC`,
        [startDate, endDate, tenantId],
      );
      return { reportType, filter, startDate, endDate, rows };
    }

    throw bad(`Unknown reportType: ${reportType}`);
  });
}
