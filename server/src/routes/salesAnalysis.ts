import { requireUser } from '../auth.ts';
import { type Router } from '../http.ts';
import type {
  SalesAnalysisData,
  SalesSummaryMetrics,
  SalesComparisonDiff,
  SalesOverviewPoint,
  CategorySalesItem,
  HeatmapCell,
  PaymentModeBreakdown,
  TopCustomerItem,
  SalesInsight,
  DaywiseSalesRow,
  CashierPerformanceRow,
  CashierSummaryStrip,
} from '../../../shared/types.ts';

// Color palette for categories matching modern dashboard aesthetic
const CATEGORY_COLORS = [
  '#6366f1', // Indigo
  '#8b5cf6', // Purple
  '#3b82f6', // Blue
  '#06b6d4', // Cyan
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#94a3b8', // Gray for Others
];

/** Helper to format YYYY-MM-DD in Asia/Kolkata timezone */
function toKolkataYMD(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value || '2026';
  const m = parts.find((p) => p.type === 'month')?.value || '01';
  const d = parts.find((p) => p.type === 'day')?.value || '01';
  return `${y}-${m}-${d}`;
}

/** Add days to YYYY-MM-DD string */
function addDaysYMD(ymd: string, days: number): string {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Difference in days between two YYYY-MM-DD strings inclusive */
function dayDiffInclusive(from: string, to: string): number {
  const t1 = new Date(from + 'T00:00:00Z').getTime();
  const t2 = new Date(to + 'T00:00:00Z').getTime();
  return Math.max(1, Math.round((t2 - t1) / 86400000) + 1);
}

/** Format currency in Indian rupees for human readable insight copy */
function fmtRupeesText(minor: number): string {
  const r = Math.round(minor / 100);
  if (Math.abs(r) >= 100000) {
    return `₹${(r / 100000).toFixed(1)}L`;
  }
  if (Math.abs(r) >= 1000) {
    return `₹${Math.round(r / 1000)}k`;
  }
  return `₹${r.toLocaleString('en-IN')}`;
}

export function registerSalesAnalysis(r: Router) {
  r.get('/api/sales-analysis', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const userRole = ctx.user!.role;

    // 1. Resolve Date Range Filters (default: Last 30 Days in Asia/Kolkata)
    const now = new Date();
    const todayYMD = toKolkataYMD(now);

    let toYMD = (ctx.query.to as string) || todayYMD;
    let fromYMD = (ctx.query.from as string) || addDaysYMD(todayYMD, -29);

    if (fromYMD > toYMD) {
      const temp = fromYMD;
      fromYMD = toYMD;
      toYMD = temp;
    }

    const rangeDays = dayDiffInclusive(fromYMD, toYMD);
    const compareMode = (ctx.query.compare as string) || 'previous_period';
    const counterFilter = ((ctx.query.counterId as string) || 'ALL').trim();
    const categoryFilter = ((ctx.query.categoryId as string) || 'ALL').trim();
    const userFilter = ((ctx.query.userId as string) || 'ALL').trim();

    // Comparison date range calculation
    let compFromYMD = '';
    let compToYMD = '';
    let compPeriodLabel = '';

    if (compareMode === 'previous_period') {
      compToYMD = addDaysYMD(fromYMD, -1);
      compFromYMD = addDaysYMD(compToYMD, -(rangeDays - 1));
      compPeriodLabel = `prev. ${rangeDays} days`;
    } else if (compareMode === 'same_period_last_month') {
      const dFrom = new Date(fromYMD + 'T12:00:00Z');
      dFrom.setUTCMonth(dFrom.getUTCMonth() - 1);
      const dTo = new Date(toYMD + 'T12:00:00Z');
      dTo.setUTCMonth(dTo.getUTCMonth() - 1);
      compFromYMD = dFrom.toISOString().slice(0, 10);
      compToYMD = dTo.toISOString().slice(0, 10);
      compPeriodLabel = 'same period last month';
    }

    // Helper to build SQL WHERE clauses based on filters
    const buildFilterClauses = (alias: string) => {
      const clauses: string[] = [];
      const params: any[] = [];

      if (userFilter && userFilter !== 'ALL') {
        clauses.push(`${alias}.created_by = ?`);
        params.push(userFilter);
      }

      if (counterFilter && counterFilter !== 'ALL') {
        clauses.push(`(
          EXISTS (
            SELECT 1 FROM payments p
            JOIN shifts s ON s.id = p.shift_id
            WHERE p.invoice_id = ${alias}.id AND s.location = ?
          ) OR ${alias}.device_id = ?
        )`);
        params.push(counterFilter, counterFilter);
      }

      if (categoryFilter && categoryFilter !== 'ALL') {
        clauses.push(`EXISTS (
          SELECT 1 FROM invoice_lines il
          JOIN items it ON it.id = il.item_id AND it.tenant_id = il.tenant_id
          WHERE il.invoice_id = ${alias}.id AND it.category = ?
        )`);
        params.push(categoryFilter);
      }

      return {
        sql: clauses.length > 0 ? ' AND ' + clauses.join(' AND ') : '',
        params,
      };
    };

    const filterObj = buildFilterClauses('i');

    // 2. Query Summary Metrics for a given period
    async function queryPeriodSummary(fDate: string, tDate: string): Promise<SalesSummaryMetrics> {
      // Sales aggregate
      const salesQuery = `
        SELECT
          COUNT(DISTINCT i.id)::int AS count,
          COALESCE(SUM(i.total_minor), 0)::bigint AS total,
          COALESCE(SUM(i.taxable_minor), 0)::bigint AS taxable,
          COALESCE(SUM(i.cgst_minor), 0)::bigint AS cgst,
          COALESCE(SUM(i.sgst_minor), 0)::bigint AS sgst,
          COALESCE(SUM(i.igst_minor), 0)::bigint AS igst,
          COALESCE(SUM(i.discount_minor), 0)::bigint AS discount
        FROM invoices i
        WHERE i.tenant_id = ? AND i.bdate >= ? AND i.bdate <= ?
          AND i.status = 'posted' AND i.kind = 'sale'
          ${filterObj.sql}
      `;
      const salesRes = await ctx.db.one<any>(salesQuery, [tenantId, fDate, tDate, ...filterObj.params]);

      // Returns aggregate (Credit Notes)
      const returnsQuery = `
        SELECT
          COUNT(DISTINCT i.id)::int AS count,
          COALESCE(SUM(i.total_minor), 0)::bigint AS total,
          COALESCE(SUM(i.taxable_minor), 0)::bigint AS taxable,
          COALESCE(SUM(i.cgst_minor), 0)::bigint AS cgst,
          COALESCE(SUM(i.sgst_minor), 0)::bigint AS sgst,
          COALESCE(SUM(i.igst_minor), 0)::bigint AS igst
        FROM invoices i
        WHERE i.tenant_id = ? AND i.bdate >= ? AND i.bdate <= ?
          AND i.status = 'posted' AND i.kind = 'credit_note'
          ${filterObj.sql}
      `;
      const returnsRes = await ctx.db.one<any>(returnsQuery, [tenantId, fDate, tDate, ...filterObj.params]);

      // COGS (Cost of goods sold) from line items & catalog cost
      const cogsQuery = `
        SELECT
          COALESCE(SUM(
            CASE 
              WHEN i.kind = 'sale' THEN (il.qty_milli * COALESCE(it.cost_minor, 0)) / 1000
              WHEN i.kind = 'credit_note' THEN -((il.qty_milli * COALESCE(it.cost_minor, 0)) / 1000)
              ELSE 0
            END
          ), 0)::bigint AS cogs,
          bool_or(it.cost_minor IS NOT NULL) AS has_costs
        FROM invoice_lines il
        JOIN invoices i ON i.id = il.invoice_id
        LEFT JOIN items it ON it.id = il.item_id AND it.tenant_id = il.tenant_id
        WHERE i.tenant_id = ? AND i.bdate >= ? AND i.bdate <= ?
          AND i.status = 'posted' AND i.kind IN ('sale', 'credit_note')
          ${filterObj.sql}
          ${categoryFilter && categoryFilter !== 'ALL' ? 'AND it.category = ?' : ''}
      `;
      const cogsParams = [tenantId, fDate, tDate, ...filterObj.params];
      if (categoryFilter && categoryFilter !== 'ALL') cogsParams.push(categoryFilter);
      const cogsRes = await ctx.db.one<any>(cogsQuery, cogsParams);

      const grossSalesMinor = Number(salesRes?.total ?? 0);
      const returnsMinor = Number(returnsRes?.total ?? 0);
      const netSalesMinor = Math.max(0, grossSalesMinor - returnsMinor);
      const billsCount = Number(salesRes?.count ?? 0);
      const returnsCount = Number(returnsRes?.count ?? 0);

      const cogsMinor = Number(cogsRes?.cogs ?? 0);
      const grossProfitMinor = netSalesMinor - cogsMinor;
      const marginPct = netSalesMinor > 0 ? Number(((grossProfitMinor / netSalesMinor) * 100).toFixed(1)) : 0;
      const avgBillValueMinor = billsCount > 0 ? Math.round(netSalesMinor / billsCount) : 0;
      const returnRatePct = grossSalesMinor > 0 ? Number(((returnsMinor / grossSalesMinor) * 100).toFixed(1)) : 0;

      const cgstMinor = Math.max(0, Number(salesRes?.cgst ?? 0) - Number(returnsRes?.cgst ?? 0));
      const sgstMinor = Math.max(0, Number(salesRes?.sgst ?? 0) - Number(returnsRes?.sgst ?? 0));
      const igstMinor = Math.max(0, Number(salesRes?.igst ?? 0) - Number(returnsRes?.igst ?? 0));
      const totalGstMinor = cgstMinor + sgstMinor + igstMinor;

      const pDays = dayDiffInclusive(fDate, tDate);
      const avgBillsPerDay = pDays > 0 ? Math.round(billsCount / pDays) : billsCount;

      return {
        netSalesMinor,
        grossSalesMinor,
        returnsMinor,
        billsCount,
        avgBillValueMinor,
        grossProfitMinor,
        cogsMinor,
        marginPct,
        returnsCount,
        returnRatePct,
        cgstMinor,
        sgstMinor,
        igstMinor,
        totalGstMinor,
        avgBillsPerDay,
        costEstimated: true,
      };
    }

    const currentSummary = await queryPeriodSummary(fromYMD, toYMD);

    // 3. Comparison Metrics
    let comparisonResult: {
      hasComparison: boolean;
      periodLabel: string;
      summary: SalesSummaryMetrics;
      diff: SalesComparisonDiff;
    } | null = null;

    if (compareMode !== 'none' && compFromYMD && compToYMD) {
      const compSummary = await queryPeriodSummary(compFromYMD, compToYMD);

      const calcPctChange = (cur: number, prev: number): number => {
        if (prev === 0) return cur > 0 ? 100 : 0;
        return Number((((cur - prev) / prev) * 100).toFixed(1));
      };

      const diff: SalesComparisonDiff = {
        netSalesChangePct: calcPctChange(currentSummary.netSalesMinor, compSummary.netSalesMinor),
        billsCountChangePct: calcPctChange(currentSummary.billsCount, compSummary.billsCount),
        avgBillChangePct: calcPctChange(currentSummary.avgBillValueMinor, compSummary.avgBillValueMinor),
        grossProfitChangePct: calcPctChange(currentSummary.grossProfitMinor, compSummary.grossProfitMinor),
        marginPointDiff: Number((currentSummary.marginPct - compSummary.marginPct).toFixed(1)),
      };

      comparisonResult = {
        hasComparison: true,
        periodLabel: compPeriodLabel,
        summary: compSummary,
        diff,
      };
    }

    // 4. Sales Overview Series (Daily or Weekly grouping)
    // If >= 90 days, group by week automatically as per spec
    const isWeekGrouping = rangeDays >= 90;
    const seriesGroupSql = isWeekGrouping
      ? `to_char(date_trunc('week', i.bdate::date), 'YYYY-MM-DD')`
      : `i.bdate`;

    const seriesSalesRows = await ctx.db.query<any>(
      `SELECT
        ${seriesGroupSql} AS period_date,
        COUNT(DISTINCT i.id)::int AS bills,
        COALESCE(SUM(i.total_minor), 0)::bigint AS gross_total,
        COALESCE(SUM(
          (il.qty_milli * COALESCE(it.cost_minor, 0)) / 1000
        ), 0)::bigint AS cogs
       FROM invoices i
       LEFT JOIN invoice_lines il ON il.invoice_id = i.id
       LEFT JOIN items it ON it.id = il.item_id AND it.tenant_id = il.tenant_id
       WHERE i.tenant_id = ? AND i.bdate >= ? AND i.bdate <= ?
         AND i.status = 'posted' AND i.kind = 'sale'
         ${filterObj.sql}
         ${categoryFilter && categoryFilter !== 'ALL' ? 'AND it.category = ?' : ''}
       GROUP BY period_date
       ORDER BY period_date ASC`,
      categoryFilter && categoryFilter !== 'ALL'
        ? [tenantId, fromYMD, toYMD, ...filterObj.params, categoryFilter]
        : [tenantId, fromYMD, toYMD, ...filterObj.params],
    );

    const seriesReturnsRows = await ctx.db.query<any>(
      `SELECT
        ${seriesGroupSql} AS period_date,
        COALESCE(SUM(i.total_minor), 0)::bigint AS return_total,
        COALESCE(SUM(
          (il.qty_milli * COALESCE(it.cost_minor, 0)) / 1000
        ), 0)::bigint AS return_cogs
       FROM invoices i
       LEFT JOIN invoice_lines il ON il.invoice_id = i.id
       LEFT JOIN items it ON it.id = il.item_id AND it.tenant_id = il.tenant_id
       WHERE i.tenant_id = ? AND i.bdate >= ? AND i.bdate <= ?
         AND i.status = 'posted' AND i.kind = 'credit_note'
         ${filterObj.sql}
         ${categoryFilter && categoryFilter !== 'ALL' ? 'AND it.category = ?' : ''}
       GROUP BY period_date`,
      categoryFilter && categoryFilter !== 'ALL'
        ? [tenantId, fromYMD, toYMD, ...filterObj.params, categoryFilter]
        : [tenantId, fromYMD, toYMD, ...filterObj.params],
    );

    const returnMap = new Map<string, { total: number; cogs: number }>();
    for (const r of seriesReturnsRows) {
      const p = r.periodDate || r.period_date;
      returnMap.set(p, {
        total: Number(r.returnTotal ?? r.return_total ?? 0),
        cogs: Number(r.returnCogs ?? r.return_cogs ?? 0),
      });
    }

    const seriesMap = new Map<string, SalesOverviewPoint>();
    for (const r of seriesSalesRows) {
      const p = r.periodDate || r.period_date;
      const gross = Number(r.grossTotal ?? r.gross_total ?? 0);
      const bills = Number(r.bills ?? 0);
      const cogs = Number(r.cogs ?? 0);
      const ret = returnMap.get(p) || { total: 0, cogs: 0 };
      const net = Math.max(0, gross - ret.total);
      const netCogs = Math.max(0, cogs - ret.cogs);
      const profit = net - netCogs;
      const avg = bills > 0 ? Math.round(net / bills) : 0;

      const dateObj = new Date(p + 'T12:00:00Z');
      const label = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const weekday = dateObj.toLocaleDateString('en-US', { weekday: 'short' });

      seriesMap.set(p, {
        date: p,
        label,
        weekday,
        salesMinor: net,
        billsCount: bills,
        grossProfitMinor: profit,
        avgBillMinor: avg,
      });
    }

    // Generate unbroken sequence of dates for accurate chart rendering
    const seriesPoints: SalesOverviewPoint[] = [];
    if (!isWeekGrouping) {
      let cur = fromYMD;
      while (cur <= toYMD) {
        if (seriesMap.has(cur)) {
          seriesPoints.push(seriesMap.get(cur)!);
        } else {
          const dObj = new Date(cur + 'T12:00:00Z');
          seriesPoints.push({
            date: cur,
            label: dObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
            weekday: dObj.toLocaleDateString('en-US', { weekday: 'short' }),
            salesMinor: 0,
            billsCount: 0,
            grossProfitMinor: 0,
            avgBillMinor: 0,
          });
        }
        cur = addDaysYMD(cur, 1);
      }
    } else {
      seriesPoints.push(...Array.from(seriesMap.values()));
    }

    // 5. Sales by Category (Top 7 + Others)
    const categoryRows = await ctx.db.query<any>(
      `SELECT
        COALESCE(NULLIF(TRIM(it.category), ''), 'Grocery') AS cat_name,
        COALESCE(SUM(
          CASE WHEN i.kind = 'sale' THEN il.total_minor ELSE -il.total_minor END
        ), 0)::bigint AS cat_sales,
        COUNT(DISTINCT i.id)::int AS cat_bills
       FROM invoice_lines il
       JOIN invoices i ON i.id = il.invoice_id
       LEFT JOIN items it ON it.id = il.item_id AND it.tenant_id = il.tenant_id
       WHERE i.tenant_id = ? AND i.bdate >= ? AND i.bdate <= ?
         AND i.status = 'posted' AND i.kind IN ('sale', 'credit_note')
         ${filterObj.sql}
       GROUP BY cat_name
       HAVING COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN il.total_minor ELSE -il.total_minor END), 0) > 0
       ORDER BY cat_sales DESC`,
      [tenantId, fromYMD, toYMD, ...filterObj.params],
    );

    const totalCatSales = categoryRows.reduce((acc, r) => acc + Number(r.catSales ?? r.cat_sales ?? 0), 0);
    const top7Categories: CategorySalesItem[] = [];
    let othersSales = 0;
    let othersBills = 0;

    categoryRows.forEach((r, idx) => {
      const catSales = Number(r.catSales ?? r.cat_sales ?? 0);
      const catBills = Number(r.catBills ?? r.cat_bills ?? 0);
      const sharePct = totalCatSales > 0 ? Number(((catSales / totalCatSales) * 100).toFixed(0)) : 0;

      if (idx < 7) {
        top7Categories.push({
          category: r.catName ?? r.cat_name,
          netSalesMinor: catSales,
          sharePct,
          billsCount: catBills,
          color: CATEGORY_COLORS[idx % CATEGORY_COLORS.length],
        });
      } else {
        othersSales += catSales;
        othersBills += catBills;
      }
    });

    if (othersSales > 0 || categoryRows.length > 7) {
      const othersShare = totalCatSales > 0 ? Number(((othersSales / totalCatSales) * 100).toFixed(0)) : 0;
      top7Categories.push({
        category: 'Others',
        netSalesMinor: othersSales,
        sharePct: othersShare,
        billsCount: othersBills,
        color: CATEGORY_COLORS[7],
      });
    }

    // 6. Heatmap of Busiest Days & Hours (Mon-Sun × 8 AM - 9 PM)
    // Using created_at in Asia/Kolkata timezone
    const heatmapRows = await ctx.db.query<any>(
      `SELECT
        EXTRACT(DOW FROM (i.created_at AT TIME ZONE 'Asia/Kolkata'))::int AS dow,
        EXTRACT(HOUR FROM (i.created_at AT TIME ZONE 'Asia/Kolkata'))::int AS hour_val,
        COUNT(DISTINCT i.id)::int AS bills,
        COALESCE(SUM(i.total_minor), 0)::bigint AS sales
       FROM invoices i
       WHERE i.tenant_id = ? AND i.bdate >= ? AND i.bdate <= ?
         AND i.status = 'posted' AND i.kind = 'sale'
         ${filterObj.sql}
       GROUP BY dow, hour_val`,
      [tenantId, fromYMD, toYMD, ...filterObj.params],
    );

    // Weekdays ordered Mon (1) to Sun (0)
    const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const heatmapMatrix: HeatmapCell[] = [];
    let maxCellSales = 0;
    let peakDow = 6; // Default Saturday
    let peakHour = 19; // Default 7 PM

    const heatmapMap = new Map<string, { bills: number; sales: number }>();
    for (const r of heatmapRows) {
      const dow = Number(r.dow);
      const hr = Number(r.hourVal ?? r.hour_val);
      const s = Number(r.sales ?? 0);
      const b = Number(r.bills ?? 0);
      heatmapMap.set(`${dow}_${hr}`, { bills: b, sales: s });
      if (s > maxCellSales) {
        maxCellSales = s;
        peakDow = dow;
        peakHour = hr;
      }
    }

    // Build grid for weekdays [Mon, Tue, Wed, Thu, Fri, Sat, Sun] and hours [8..21]
    const dowOrder = [1, 2, 3, 4, 5, 6, 0];
    for (const dow of dowOrder) {
      for (let h = 8; h <= 21; h++) {
        const item = heatmapMap.get(`${dow}_${h}`) || { bills: 0, sales: 0 };
        const hourLabel = h === 12 ? '12 PM' : h < 12 ? `${h} AM` : `${h - 12} PM`;
        heatmapMatrix.push({
          weekday: dow,
          weekdayName: weekdayNames[dow],
          hour: h,
          hourLabel,
          salesMinor: item.sales,
          billsCount: item.bills,
        });
      }
    }

    const peakNextHour = peakHour + 1;
    const formatHourSlot = (hr: number) => (hr === 12 ? '12 PM' : hr > 12 ? `${hr - 12} PM` : `${hr} AM`);
    const peakSlot = `${weekdayNames[peakDow]} ${formatHourSlot(peakHour).replace(' ', '')}–${formatHourSlot(peakNextHour)}`;

    // 7. Payment Modes Breakdown (UPI / Cash / Card / Credit)
    // Mixed bills are cleanly split by individual payment row amounts in payments table
    const paymentRows = await ctx.db.query<any>(
      `SELECT
        COALESCE(p.mode, p.method, 'cash') AS p_mode,
        COALESCE(SUM(p.amount_minor), 0)::bigint AS mode_total
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       WHERE p.tenant_id = ? AND i.bdate >= ? AND i.bdate <= ?
         AND i.status = 'posted' AND i.kind = 'sale'
         ${filterObj.sql}
       GROUP BY p_mode`,
      [tenantId, fromYMD, toYMD, ...filterObj.params],
    );

    // Also calculate credit / khata sales (unpaid balance on posted sales)
    const creditSalesRes = await ctx.db.one<any>(
      `SELECT COALESCE(SUM(i.balance_minor), 0)::bigint AS credit_total
       FROM invoices i
       WHERE i.tenant_id = ? AND i.bdate >= ? AND i.bdate <= ?
         AND i.status = 'posted' AND i.kind = 'sale' AND i.balance_minor > 0
         ${filterObj.sql}`,
      [tenantId, fromYMD, toYMD, ...filterObj.params],
    );
    const creditTotal = Number(creditSalesRes?.creditTotal ?? creditSalesRes?.credit_total ?? 0);

    const modeTotals: Record<string, number> = {
      upi: 0,
      cash: 0,
      card: 0,
      credit: creditTotal,
    };

    for (const r of paymentRows) {
      const rawMode = (r.pMode || r.p_mode || 'cash').toLowerCase();
      const amt = Number(r.modeTotal ?? r.mode_total ?? 0);
      if (rawMode.includes('upi')) modeTotals.upi += amt;
      else if (rawMode.includes('card')) modeTotals.card += amt;
      else if (rawMode.includes('cash')) modeTotals.cash += amt;
      else if (rawMode.includes('credit') || rawMode.includes('advance')) modeTotals.credit += amt;
      else modeTotals.cash += amt;
    }

    const totalPaid = Object.values(modeTotals).reduce((a, b) => a + b, 0);
    const paymentModes: PaymentModeBreakdown[] = [
      {
        mode: 'upi',
        label: 'UPI',
        totalMinor: modeTotals.upi,
        sharePct: totalPaid > 0 ? Math.round((modeTotals.upi / totalPaid) * 100) : 0,
        color: '#6366f1',
      },
      {
        mode: 'cash',
        label: 'Cash',
        totalMinor: modeTotals.cash,
        sharePct: totalPaid > 0 ? Math.round((modeTotals.cash / totalPaid) * 100) : 0,
        color: '#3b82f6',
      },
      {
        mode: 'card',
        label: 'Card',
        totalMinor: modeTotals.card,
        sharePct: totalPaid > 0 ? Math.round((modeTotals.card / totalPaid) * 100) : 0,
        color: '#06b6d4',
      },
      {
        mode: 'credit',
        label: 'Credit (Khata)',
        totalMinor: modeTotals.credit,
        sharePct: totalPaid > 0 ? Math.round((modeTotals.credit / totalPaid) * 100) : 0,
        color: '#f59e0b',
      },
    ];

    // 8. Top Named Customers (excluding walk-ins)
    const topCustomerRows = await ctx.db.query<any>(
      `SELECT
        COALESCE(p.id, i.party_id, 'cust_' || md5(COALESCE(i.customer_name, ''))) AS cust_id,
        COALESCE(p.name, i.customer_name) AS cust_name,
        COALESCE(p.phone, i.customer_phone) AS cust_phone,
        p.gstin AS cust_gstin,
        p.credit_limit_minor AS cust_credit_limit,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN i.total_minor ELSE -i.total_minor END), 0)::bigint AS net_sales,
        COUNT(DISTINCT CASE WHEN i.kind = 'sale' THEN i.id END)::int AS bill_count,
        COALESCE(SUM(i.balance_minor), 0)::bigint AS pending_dues
       FROM invoices i
       LEFT JOIN parties p ON p.id = i.party_id AND p.tenant_id = i.tenant_id
       WHERE i.tenant_id = ? AND i.bdate >= ? AND i.bdate <= ?
         AND i.status = 'posted' AND i.kind IN ('sale', 'credit_note')
         AND (
           i.party_id IS NOT NULL 
           OR (
             i.customer_name IS NOT NULL 
             AND lower(TRIM(i.customer_name)) NOT IN ('walk-in', 'walk-in customer', 'walk in', 'walkin', 'retail customer', '')
           )
         )
         ${filterObj.sql}
       GROUP BY cust_id, cust_name, cust_phone, cust_gstin, cust_credit_limit
       HAVING COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN i.total_minor ELSE -i.total_minor END), 0) > 0
       ORDER BY net_sales DESC
       LIMIT 5`,
      [tenantId, fromYMD, toYMD, ...filterObj.params],
    );

    const topCustomers: TopCustomerItem[] = topCustomerRows.map((r) => {
      const gstin = r.custGstin || r.cust_gstin;
      const creditLimit = Number(r.custCreditLimit ?? r.cust_credit_limit ?? 0);
      const dues = Number(r.pendingDues ?? r.pending_dues ?? 0);
      const isB2B = Boolean(gstin && gstin.trim().length === 15);
      const isKhata = Boolean(creditLimit > 0 || dues > 0 || !isB2B);

      return {
        id: r.custId || r.cust_id,
        name: r.custName || r.cust_name || 'Customer',
        phone: r.custPhone || r.cust_phone || undefined,
        netSalesMinor: Number(r.netSales ?? r.net_sales ?? 0),
        billsCount: Number(r.billCount ?? r.bill_count ?? 0),
        isB2B,
        isKhata,
        creditDuesMinor: dues > 0 ? dues : undefined,
      };
    });

    // 9. Daywise Sales Summary Table Rows with weekday-over-weekday change
    // Fetch daywise metrics including discount and tax
    const daywiseRowsRaw = await ctx.db.query<any>(
      `SELECT
        i.bdate,
        COUNT(DISTINCT CASE WHEN i.kind = 'sale' THEN i.id END)::int AS bills,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN i.total_minor ELSE 0 END), 0)::bigint AS gross_sales,
        COALESCE(SUM(CASE WHEN i.kind = 'credit_note' THEN i.total_minor ELSE 0 END), 0)::bigint AS returns,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN i.discount_minor ELSE 0 END), 0)::bigint AS discount,
        COALESCE(SUM(
          CASE 
            WHEN i.kind = 'sale' THEN (i.cgst_minor + i.sgst_minor + i.igst_minor)
            WHEN i.kind = 'credit_note' THEN -(i.cgst_minor + i.sgst_minor + i.igst_minor)
            ELSE 0 
          END
        ), 0)::bigint AS gst,
        COALESCE(SUM(
          CASE 
            WHEN i.kind = 'sale' THEN (il.qty_milli * COALESCE(it.cost_minor, 0)) / 1000
            WHEN i.kind = 'credit_note' THEN -((il.qty_milli * COALESCE(it.cost_minor, 0)) / 1000)
            ELSE 0 
          END
        ), 0)::bigint AS cogs
       FROM invoices i
       LEFT JOIN invoice_lines il ON il.invoice_id = i.id
       LEFT JOIN items it ON it.id = il.item_id AND it.tenant_id = il.tenant_id
       WHERE i.tenant_id = ? AND i.bdate >= ? AND i.bdate <= ?
         AND i.status = 'posted' AND i.kind IN ('sale', 'credit_note')
         ${filterObj.sql}
         ${categoryFilter && categoryFilter !== 'ALL' ? 'AND it.category = ?' : ''}
       GROUP BY i.bdate
       ORDER BY i.bdate DESC`,
      categoryFilter && categoryFilter !== 'ALL'
        ? [tenantId, fromYMD, toYMD, ...filterObj.params, categoryFilter]
        : [tenantId, fromYMD, toYMD, ...filterObj.params],
    );

    // Also fetch previous week sales for each date in this range to calculate change vs same weekday
    const prevWeekFrom = addDaysYMD(fromYMD, -7);
    const prevWeekTo = addDaysYMD(toYMD, -7);
    const prevWeekSalesRows = await ctx.db.query<any>(
      `SELECT
        i.bdate,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN i.total_minor ELSE -i.total_minor END), 0)::bigint AS net_sales
       FROM invoices i
       WHERE i.tenant_id = ? AND i.bdate >= ? AND i.bdate <= ?
         AND i.status = 'posted' AND i.kind IN ('sale', 'credit_note')
         ${filterObj.sql}
       GROUP BY i.bdate`,
      [tenantId, prevWeekFrom, prevWeekTo, ...filterObj.params],
    );

    const prevWeekSalesMap = new Map<string, number>();
    for (const r of prevWeekSalesRows) {
      prevWeekSalesMap.set(r.bdate, Number(r.netSales ?? r.net_sales ?? 0));
    }

    const daywiseTableRows: DaywiseSalesRow[] = daywiseRowsRaw.map((r) => {
      const bdate = r.bdate;
      const gross = Number(r.grossSales ?? r.gross_sales ?? 0);
      const ret = Number(r.returns ?? 0);
      const net = Math.max(0, gross - ret);
      const bills = Number(r.bills ?? 0);
      const discount = Number(r.discount ?? 0);
      const gst = Number(r.gst ?? 0);
      const cogs = Number(r.cogs ?? 0);
      const profit = net - cogs;
      const marginPct = net > 0 ? Number(((profit / net) * 100).toFixed(1)) : 0;

      const dateObj = new Date(bdate + 'T12:00:00Z');
      const weekday = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
      const dayNum = dateObj.getDate();
      const monthStr = dateObj.toLocaleDateString('en-US', { month: 'short' });
      const formattedDate = `${weekday}, ${dayNum} ${monthStr}`;

      // Calculate same weekday last week change
      const sameWeekdayLastWeek = addDaysYMD(bdate, -7);
      const prevSales = prevWeekSalesMap.get(sameWeekdayLastWeek);
      let prevWeekSameDayChangePct: number | null = null;
      if (prevSales !== undefined && prevSales > 0) {
        prevWeekSameDayChangePct = Number((((net - prevSales) / prevSales) * 100).toFixed(1));
      }

      return {
        date: bdate,
        formattedDate,
        weekday,
        billsCount: bills,
        grossSalesMinor: gross,
        returnsMinor: ret,
        netSalesMinor: net,
        discountMinor: discount,
        gstMinor: gst,
        grossProfitMinor: profit,
        marginPct,
        prevWeekSameDayChangePct,
      };
    });

    // 10. Cashier Performance (Visible only to owner/manager)
    let cashierPerformanceData: {
      rows: CashierPerformanceRow[];
      summaryStrip: CashierSummaryStrip;
    } | null = null;

    if (userRole === 'owner' || userRole === 'manager') {
      const cashierRows = await ctx.db.query<any>(
        `SELECT
          u.id AS user_id,
          u.name AS user_name,
          COALESCE((
            SELECT s.location FROM payments p
            JOIN shifts s ON s.id = p.shift_id
            WHERE p.created_by = u.id AND s.location IS NOT NULL
            ORDER BY p.created_at DESC LIMIT 1
          ), 'Counter 1') AS counter_name,
          COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN i.total_minor ELSE -i.total_minor END), 0)::bigint AS sales,
          COUNT(DISTINCT CASE WHEN i.kind = 'sale' THEN i.id END)::int AS bills
         FROM users u
         JOIN invoices i ON i.created_by = u.id
         WHERE i.tenant_id = ? AND i.bdate >= ? AND i.bdate <= ?
           AND i.status = 'posted' AND i.kind IN ('sale', 'credit_note')
           ${filterObj.sql}
         GROUP BY u.id, u.name
         ORDER BY sales DESC`,
        [tenantId, fromYMD, toYMD, ...filterObj.params],
      );

      const cashierPerformanceRows: CashierPerformanceRow[] = cashierRows.map((r) => {
        const salesMinor = Number(r.sales ?? 0);
        const billsCount = Number(r.bills ?? 0);
        const avgBillMinor = billsCount > 0 ? Math.round(salesMinor / billsCount) : 0;
        return {
          userId: r.userId || r.user_id,
          userName: r.userName || r.user_name || 'Cashier',
          counterName: r.counterName || r.counter_name || 'Counter 1',
          salesMinor,
          billsCount,
          avgBillMinor,
        };
      });

      // Summary Strip: Voided bills, discounts given, bills on credit
      const voidedRes = await ctx.db.one<any>(
        `SELECT
          COUNT(DISTINCT id)::int AS void_count,
          COALESCE(SUM(total_minor), 0)::bigint AS void_total
         FROM invoices
         WHERE tenant_id = ? AND bdate >= ? AND bdate <= ?
           AND status = 'cancelled'`,
        [tenantId, fromYMD, toYMD],
      );

      const discountsRes = await ctx.db.one<any>(
        `SELECT COALESCE(SUM(discount_minor), 0)::bigint AS total_discount
         FROM invoices
         WHERE tenant_id = ? AND bdate >= ? AND bdate <= ?
           AND status = 'posted' AND kind = 'sale'`,
        [tenantId, fromYMD, toYMD],
      );

      const creditBillsRes = await ctx.db.one<any>(
        `SELECT
          COUNT(DISTINCT id)::int AS credit_count,
          COALESCE(SUM(balance_minor), 0)::bigint AS credit_total
         FROM invoices
         WHERE tenant_id = ? AND bdate >= ? AND bdate <= ?
           AND status = 'posted' AND kind = 'sale' AND balance_minor > 0`,
        [tenantId, fromYMD, toYMD],
      );

      cashierPerformanceData = {
        rows: cashierPerformanceRows,
        summaryStrip: {
          voidedBillsCount: Number(voidedRes?.voidCount ?? voidedRes?.void_count ?? 0),
          voidedTotalMinor: Number(voidedRes?.voidTotal ?? voidedRes?.void_total ?? 0),
          discountsGivenMinor: Number(discountsRes?.totalDiscount ?? discountsRes?.total_discount ?? 0),
          billsOnCreditCount: Number(creditBillsRes?.creditCount ?? creditBillsRes?.credit_count ?? 0),
          billsOnCreditMinor: Number(creditBillsRes?.creditTotal ?? creditBillsRes?.credit_total ?? 0),
        },
      };
    }

    // 11. Generate Genuine Data-Backed Insights
    const insights: SalesInsight[] = [];

    // Insight 1: Sales Growth & Driver
    if (comparisonResult && comparisonResult.diff) {
      const growthPct = comparisonResult.diff.netSalesChangePct;
      const topCat = top7Categories[0];
      const avgBillDiff = currentSummary.avgBillValueMinor - comparisonResult.summary.avgBillValueMinor;
      const avgBillSign = avgBillDiff >= 0 ? '+' : '';

      if (growthPct > 0) {
        insights.push({
          id: 'growth-insight',
          type: 'growth',
          icon: '📈',
          theme: 'emerald',
          title: `Sales up ${growthPct}% on ${comparisonResult.periodLabel}`,
          description: topCat
            ? `Driven by ${topCat.category} (${fmtRupeesText(topCat.netSalesMinor)}) and bigger bills (${avgBillSign}${fmtRupeesText(avgBillDiff)} per bill).`
            : `Average bill value increased by ${avgBillSign}${fmtRupeesText(avgBillDiff)}.`,
        });
      } else if (growthPct < 0) {
        insights.push({
          id: 'growth-insight',
          type: 'growth',
          icon: '📉',
          theme: 'amber',
          title: `Sales down ${Math.abs(growthPct)}% on ${comparisonResult.periodLabel}`,
          description: `Total revenue dropped to ${fmtRupeesText(currentSummary.netSalesMinor)} across ${currentSummary.billsCount} bills.`,
        });
      }
    }

    // Insight 2: Peak Hours
    if (heatmapMatrix.length > 0 && maxCellSales > 0) {
      insights.push({
        id: 'peak-insight',
        type: 'peak',
        icon: '⏰',
        theme: 'amber',
        title: `Weekend & Evening Rush (${peakSlot})`,
        description: `Peak trading occurred around ${peakSlot}. Plan additional counter staffing and keep top selling groceries stocked.`,
      });
    }

    // Insight 3: Returns & Quality Watch
    if (currentSummary.returnsCount > 0) {
      // Find category with highest return rate if possible
      insights.push({
        id: 'returns-insight',
        type: 'returns',
        icon: '🔄',
        theme: 'rose',
        title: `Returns at ${currentSummary.returnRatePct}% of sales`,
        description: `${fmtRupeesText(currentSummary.returnsMinor)} returned across ${currentSummary.returnsCount} credit notes. Audit returned items for expiry and cold storage condition.`,
      });
    }

    // Insight 4: Credit (Khata) & Uncollected Dues
    if (modeTotals.credit > 0) {
      const creditCustCount = topCustomers.filter((c) => c.isKhata && (c.creditDuesMinor || 0) > 0).length;
      insights.push({
        id: 'credit-insight',
        type: 'credit',
        icon: '💳',
        theme: 'purple',
        title: `Credit sales at ${paymentModes.find((p) => p.mode === 'credit')?.sharePct || 0}%`,
        description: `${fmtRupeesText(modeTotals.credit)} outstanding to collect ${creditCustCount > 0 ? `across ${creditCustCount} active Khata accounts` : 'from customer bills'}.`,
      });
    }

    // 12. Dynamic Filter Options
    const countersListRows = await ctx.db.query<any>(
      `SELECT DISTINCT COALESCE(s.location, 'Counter 1') AS loc
       FROM shifts s
       WHERE s.tenant_id = ? AND s.location IS NOT NULL`,
      [tenantId],
    );
    const counters = [
      { id: 'ALL', name: 'All counters' },
      ...countersListRows.map((r) => ({ id: r.loc, name: r.loc === 'MAIN' ? 'Main Billing Counter (MAIN)' : r.loc })),
    ];
    if (counters.length === 1) {
      counters.push({ id: 'Counter 1', name: 'Counter 1' });
    }

    const categoriesListRows = await ctx.db.query<any>(
      `SELECT DISTINCT category FROM items WHERE tenant_id = ? AND category IS NOT NULL AND TRIM(category) <> '' ORDER BY category ASC`,
      [tenantId],
    );
    const categories = ['All categories', ...categoriesListRows.map((r) => r.category)];

    const cashiersListRows = await ctx.db.query<any>(
      `SELECT id, name, role FROM users WHERE tenant_id = ? AND active = true ORDER BY name ASC`,
      [tenantId],
    );
    const cashiers = [
      { id: 'ALL', name: 'All cashiers', role: 'all' },
      ...cashiersListRows.map((r) => ({ id: r.id, name: r.name, role: r.role })),
    ];

    const payload: SalesAnalysisData = {
      filters: {
        from: fromYMD,
        to: toYMD,
        compare: compareMode as any,
        counterId: counterFilter,
        categoryId: categoryFilter,
        userId: userFilter,
        rangeDays,
      },
      filterOptions: {
        counters,
        categories,
        cashiers,
      },
      summary: currentSummary,
      comparison: comparisonResult,
      series: seriesPoints,
      grouping: isWeekGrouping ? 'week' : 'day',
      categories: top7Categories,
      heatmap: {
        matrix: heatmapMatrix,
        peakSlot,
        maxCellSalesMinor: maxCellSales,
      },
      payments: {
        modes: paymentModes,
        totalPaidMinor: totalPaid,
      },
      topCustomers,
      insights,
      daywise: daywiseTableRows,
      cashierPerformance: cashierPerformanceData,
    };

    return payload;
  });
}
