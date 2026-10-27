import { requireUser } from '../auth.ts';
import { type Router } from '../http.ts';
import { computeShiftFinancials } from './shifts.ts';

/** Helper to format YYYY-MM-DD in shop timezone */
function getShopDateYMD(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value || '2026';
  const m = parts.find((p) => p.type === 'month')?.value || '01';
  const d = parts.find((p) => p.type === 'day')?.value || '01';
  return `${y}-${m}-${d}`;
}

/** Get shop time parts (hour, minute, second) */
function getShopTimeParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value || '0', 10);
  const second = parseInt(parts.find((p) => p.type === 'second')?.value || '0', 10);
  return { hour, minute, second };
}

/** Format hour to range string, e.g. 12 -> "12–1 PM" */
function formatHourRange(hour: number): string {
  const startPeriod = hour >= 12 ? 'PM' : 'AM';
  const endHour = (hour + 1) % 24;
  const endPeriod = endHour >= 12 ? 'PM' : 'AM';

  const displayStart = hour % 12 === 0 ? 12 : hour % 12;
  const displayEnd = endHour % 12 === 0 ? 12 : endHour % 12;

  if (startPeriod === endPeriod) {
    return `${displayStart}–${displayEnd} ${startPeriod}`;
  }
  return `${displayStart} ${startPeriod}–${displayEnd} ${endPeriod}`;
}

/** Format single hour label, e.g. 8 -> "8am", 12 -> "12pm" */
function formatHourTick(hour: number): string {
  const period = hour >= 12 ? 'pm' : 'am';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}${period}`;
}

const PAYMENT_MODE_COLORS: Record<string, string> = {
  upi: '#8b5cf6',
  cash: '#10b981',
  card: '#3b82f6',
  credit: '#f59e0b',
  bank: '#06b6d4',
  cheque: '#64748b',
};

export function registerDashboard(r: Router) {
  r.get('/api/dashboard/today', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const userRole = ctx.user!.role;
    const isOwnerOrManager = ['owner', 'manager'].includes(userRole);

    // Fetch tenant timezone
    const tenantRow = await ctx.db.one<any>('SELECT timezone FROM tenants WHERE id = ?', [tenantId]);
    const tz = tenantRow?.timezone || 'Asia/Kolkata';

    const now = new Date();
    const todayYMD = getShopDateYMD(now, tz);
    const { hour: currentHour, minute: currentMinute } = getShopTimeParts(now, tz);

    // Previous calendar day (Yesterday) in shop timezone
    const dYesterday = new Date(todayYMD + 'T12:00:00Z');
    dYesterday.setUTCDate(dYesterday.getUTCDate() - 1);
    const compDateYMD = getShopDateYMD(dYesterday, tz);

    // Cutoff timestamp for comparison metrics: exactly 24 hours ago
    const compCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const weekdayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' });
    const fullDateFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });

    const todayWeekday = weekdayFormatter.format(now);
    const compWeekday = weekdayFormatter.format(dYesterday);
    const compWeekdayShort = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(dYesterday);
    const todayFormattedDate = fullDateFormatter.format(now);
    const nowTimeStr = timeFormatter.format(now);

    const openingHour = 8;
    const closingHour = 21;

    // 1. TODAY'S SALES AND METRICS
    // Query posted sales and credit notes for today in shop timezone
    const todaySalesRes = await ctx.db.one<any>(
      `SELECT
        COUNT(DISTINCT CASE WHEN i.kind = 'sale' THEN i.id END)::int AS bills_count,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN i.total_minor ELSE 0 END), 0)::bigint AS gross_sales,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN i.taxable_minor ELSE 0 END), 0)::bigint AS gross_taxable,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN i.cgst_minor ELSE 0 END), 0)::bigint AS gross_cgst,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN i.sgst_minor ELSE 0 END), 0)::bigint AS gross_sgst,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN i.igst_minor ELSE 0 END), 0)::bigint AS gross_igst,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN i.balance_minor ELSE 0 END), 0)::bigint AS credit_unpaid,
        COUNT(DISTINCT CASE WHEN i.kind = 'credit_note' THEN i.id END)::int AS returns_count,
        COALESCE(SUM(CASE WHEN i.kind = 'credit_note' THEN i.total_minor ELSE 0 END), 0)::bigint AS returns_total,
        COALESCE(SUM(CASE WHEN i.kind = 'credit_note' THEN i.cgst_minor ELSE 0 END), 0)::bigint AS returns_cgst,
        COALESCE(SUM(CASE WHEN i.kind = 'credit_note' THEN i.sgst_minor ELSE 0 END), 0)::bigint AS returns_sgst,
        COALESCE(SUM(CASE WHEN i.kind = 'credit_note' THEN i.igst_minor ELSE 0 END), 0)::bigint AS returns_igst
       FROM invoices i
       WHERE i.tenant_id = ?
         AND (i.bdate = ? OR (i.created_at AT TIME ZONE ?)::date = ?::date)
         AND i.status = 'posted'
         AND i.kind IN ('sale', 'credit_note')`,
      [tenantId, todayYMD, tz, todayYMD],
    );

    // Note: ctx.db.one applies camelKeys, so we read both camelCase and snake_case
    const grossSalesMinor = Number(todaySalesRes?.grossSales ?? todaySalesRes?.gross_sales ?? 0);
    const returnsMinor = Number(todaySalesRes?.returnsTotal ?? todaySalesRes?.returns_total ?? 0);
    const netSalesMinor = Math.max(0, grossSalesMinor - returnsMinor);
    const billsCount = Number(todaySalesRes?.billsCount ?? todaySalesRes?.bills_count ?? 0);
    const returnsCount = Number(todaySalesRes?.returnsCount ?? todaySalesRes?.returns_count ?? 0);
    const returnRatePct = grossSalesMinor > 0 ? Number(((returnsMinor / grossSalesMinor) * 100).toFixed(1)) : 0;
    const avgBillValueMinor = billsCount > 0 ? Math.round(netSalesMinor / billsCount) : 0;

    const netCgstMinor = Math.max(
      0,
      Number(todaySalesRes?.grossCgst ?? todaySalesRes?.gross_cgst ?? 0) -
        Number(todaySalesRes?.returnsCgst ?? todaySalesRes?.returns_cgst ?? 0),
    );
    const netSgstMinor = Math.max(
      0,
      Number(todaySalesRes?.grossSgst ?? todaySalesRes?.gross_sgst ?? 0) -
        Number(todaySalesRes?.returnsSgst ?? todaySalesRes?.returns_sgst ?? 0),
    );
    const netIgstMinor = Math.max(
      0,
      Number(todaySalesRes?.grossIgst ?? todaySalesRes?.gross_igst ?? 0) -
        Number(todaySalesRes?.returnsIgst ?? todaySalesRes?.returns_igst ?? 0),
    );
    const totalGstMinor = netCgstMinor + netSgstMinor + netIgstMinor;

    // 2. COMPARISON METRICS (Previous calendar day, up to the same time of day)
    const compSalesRes = await ctx.db.one<any>(
      `SELECT
        COUNT(DISTINCT CASE WHEN i.kind = 'sale' THEN i.id END)::int AS bills_count,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN i.total_minor ELSE 0 END), 0)::bigint AS gross_sales,
        COALESCE(SUM(CASE WHEN i.kind = 'credit_note' THEN i.total_minor ELSE 0 END), 0)::bigint AS returns_total
       FROM invoices i
       WHERE i.tenant_id = ?
         AND (i.bdate = ? OR (i.created_at AT TIME ZONE ?)::date = ?::date)
         AND i.status = 'posted'
         AND i.kind IN ('sale', 'credit_note')
         AND i.created_at <= ?`,
      [tenantId, compDateYMD, tz, compDateYMD, compCutoff.toISOString()],
    );

    const compGrossSalesMinor = Number(compSalesRes?.grossSales ?? compSalesRes?.gross_sales ?? 0);
    const compReturnsMinor = Number(compSalesRes?.returnsTotal ?? compSalesRes?.returns_total ?? 0);
    const compNetSalesMinor = Math.max(0, compGrossSalesMinor - compReturnsMinor);
    const compBillsCount = Number(compSalesRes?.billsCount ?? compSalesRes?.bills_count ?? 0);
    const compAvgBillValueMinor = compBillsCount > 0 ? Math.round(compNetSalesMinor / compBillsCount) : 0;

    const salesChangePct = compNetSalesMinor > 0
      ? Number((((netSalesMinor - compNetSalesMinor) / compNetSalesMinor) * 100).toFixed(1))
      : null;

    const billsDiffCount = billsCount - compBillsCount;
    const avgBillChangePct = compAvgBillValueMinor > 0
      ? Number((((avgBillValueMinor - compAvgBillValueMinor) / compAvgBillValueMinor) * 100).toFixed(1))
      : null;

    const returnsChangePct = compReturnsMinor > 0
      ? Number((((returnsMinor - compReturnsMinor) / compReturnsMinor) * 100).toFixed(1))
      : null;

    // 3. COGS & GROSS PROFIT (Only computed for owner/manager)
    let cogsMinor = 0;
    let grossProfitMinor = 0;
    let marginPct = 0;
    let isCostEstimated = false;

    if (isOwnerOrManager) {
      const cogsRes = await ctx.db.one<any>(
        `SELECT
          COALESCE(SUM(
            CASE
              WHEN i.kind = 'sale' THEN (il.qty_milli * COALESCE(it.cost_minor, 0)) / 1000
              WHEN i.kind = 'credit_note' THEN -((il.qty_milli * COALESCE(it.cost_minor, 0)) / 1000)
              ELSE 0
            END
          ), 0)::bigint AS cogs,
          COUNT(CASE WHEN it.cost_minor IS NULL OR it.cost_minor = 0 THEN 1 END)::int AS missing_cost_lines
         FROM invoice_lines il
         JOIN invoices i ON i.id = il.invoice_id
         LEFT JOIN items it ON it.id = il.item_id AND it.tenant_id = il.tenant_id
         WHERE i.tenant_id = ?
           AND (i.bdate = ? OR (i.created_at AT TIME ZONE ?)::date = ?::date)
           AND i.status = 'posted'
           AND i.kind IN ('sale', 'credit_note')`,
        [tenantId, todayYMD, tz, todayYMD],
      );
      cogsMinor = Number(cogsRes?.cogs ?? 0);
      grossProfitMinor = Math.max(0, netSalesMinor - cogsMinor);
      marginPct = netSalesMinor > 0 ? Number(((grossProfitMinor / netSalesMinor) * 100).toFixed(1)) : 0;
      const missingLines = Number(cogsRes?.missingCostLines ?? cogsRes?.missing_cost_lines ?? 0);
      isCostEstimated = missingLines > 0;
    }

    // 4. ITEMS SOLD TODAY
    const itemsSoldRes = await ctx.db.one<any>(
      `SELECT
        COALESCE(SUM(
          CASE
            WHEN i.kind = 'sale' THEN il.qty_milli / 1000
            WHEN i.kind = 'credit_note' THEN -(il.qty_milli / 1000)
            ELSE 0
          END
        ), 0)::bigint AS total_units,
        COUNT(DISTINCT il.item_id)::int AS distinct_products
       FROM invoice_lines il
       JOIN invoices i ON i.id = il.invoice_id
       WHERE i.tenant_id = ?
         AND (i.bdate = ? OR (i.created_at AT TIME ZONE ?)::date = ?::date)
         AND i.status = 'posted'
         AND i.kind = 'sale'`,
      [tenantId, todayYMD, tz, todayYMD],
    );
    const totalUnitsSold = Math.max(0, Number(itemsSoldRes?.totalUnits ?? itemsSoldRes?.total_units ?? 0));
    const distinctProductsSold = Number(itemsSoldRes?.distinctProducts ?? itemsSoldRes?.distinct_products ?? 0);

    // 5. HOURLY BREAKDOWN FOR TODAY (up to current time) AND PREVIOUS DAY (all day)
    // Uses CTEs to aggregate invoices and COGS separately, avoiding duplicate row multiplication
    const todayHourlyRows = await ctx.db.query<any>(
      `WITH inv_summary AS (
        SELECT
          i.id,
          EXTRACT(HOUR FROM (i.created_at AT TIME ZONE ?))::int AS hr,
          i.kind,
          i.total_minor
        FROM invoices i
        WHERE i.tenant_id = ?
          AND (i.bdate = ? OR (i.created_at AT TIME ZONE ?)::date = ?::date)
          AND i.status = 'posted'
          AND i.kind IN ('sale', 'credit_note')
      ),
      hourly_invoices AS (
        SELECT
          hr,
          COUNT(DISTINCT CASE WHEN kind = 'sale' THEN id END)::int AS bills,
          COALESCE(SUM(CASE WHEN kind = 'sale' THEN total_minor WHEN kind = 'credit_note' THEN -total_minor ELSE 0 END), 0)::bigint AS net_sales
        FROM inv_summary
        GROUP BY hr
      ),
      hourly_cogs AS (
        SELECT
          EXTRACT(HOUR FROM (i.created_at AT TIME ZONE ?))::int AS hr,
          COALESCE(SUM(
            CASE
              WHEN i.kind = 'sale' THEN (il.qty_milli * COALESCE(it.cost_minor, 0)) / 1000
              WHEN i.kind = 'credit_note' THEN -((il.qty_milli * COALESCE(it.cost_minor, 0)) / 1000)
              ELSE 0
            END
          ), 0)::bigint AS cogs
        FROM invoice_lines il
        JOIN invoices i ON i.id = il.invoice_id
        LEFT JOIN items it ON it.id = il.item_id AND it.tenant_id = il.tenant_id
        WHERE i.tenant_id = ?
          AND (i.bdate = ? OR (i.created_at AT TIME ZONE ?)::date = ?::date)
          AND i.status = 'posted'
          AND i.kind IN ('sale', 'credit_note')
        GROUP BY hr
      )
      SELECT
        hi.hr,
        hi.bills,
        hi.net_sales,
        COALESCE(hc.cogs, 0)::bigint AS cogs
      FROM hourly_invoices hi
      LEFT JOIN hourly_cogs hc ON hc.hr = hi.hr
      ORDER BY hi.hr ASC`,
      [tz, tenantId, todayYMD, tz, todayYMD, tz, tenantId, todayYMD, tz, todayYMD],
    );

    const todayHourMap = new Map<number, { bills: number; netSales: number; profit: number }>();
    for (const r of todayHourlyRows) {
      const hr = Number(r.hr);
      const bills = Number(r.bills ?? 0);
      const netSales = Math.max(0, Number(r.netSales ?? r.net_sales ?? 0));
      const cogs = Number(r.cogs ?? 0);
      const profit = Math.max(0, netSales - cogs);
      todayHourMap.set(hr, { bills, netSales, profit });
    }

    // Previous calendar day hourly across the entire day
    const compHourlyRows = await ctx.db.query<any>(
      `WITH inv_summary AS (
        SELECT
          i.id,
          EXTRACT(HOUR FROM (i.created_at AT TIME ZONE ?))::int AS hr,
          i.kind,
          i.total_minor
        FROM invoices i
        WHERE i.tenant_id = ?
          AND (i.bdate = ? OR (i.created_at AT TIME ZONE ?)::date = ?::date)
          AND i.status = 'posted'
          AND i.kind IN ('sale', 'credit_note')
      ),
      hourly_invoices AS (
        SELECT
          hr,
          COUNT(DISTINCT CASE WHEN kind = 'sale' THEN id END)::int AS bills,
          COALESCE(SUM(CASE WHEN kind = 'sale' THEN total_minor WHEN kind = 'credit_note' THEN -total_minor ELSE 0 END), 0)::bigint AS net_sales
        FROM inv_summary
        GROUP BY hr
      ),
      hourly_cogs AS (
        SELECT
          EXTRACT(HOUR FROM (i.created_at AT TIME ZONE ?))::int AS hr,
          COALESCE(SUM(
            CASE
              WHEN i.kind = 'sale' THEN (il.qty_milli * COALESCE(it.cost_minor, 0)) / 1000
              WHEN i.kind = 'credit_note' THEN -((il.qty_milli * COALESCE(it.cost_minor, 0)) / 1000)
              ELSE 0
            END
          ), 0)::bigint AS cogs
        FROM invoice_lines il
        JOIN invoices i ON i.id = il.invoice_id
        LEFT JOIN items it ON it.id = il.item_id AND it.tenant_id = il.tenant_id
        WHERE i.tenant_id = ?
          AND (i.bdate = ? OR (i.created_at AT TIME ZONE ?)::date = ?::date)
          AND i.status = 'posted'
          AND i.kind IN ('sale', 'credit_note')
        GROUP BY hr
      )
      SELECT
        hi.hr,
        hi.bills,
        hi.net_sales,
        COALESCE(hc.cogs, 0)::bigint AS cogs
      FROM hourly_invoices hi
      LEFT JOIN hourly_cogs hc ON hc.hr = hi.hr
      ORDER BY hi.hr ASC`,
      [tz, tenantId, compDateYMD, tz, compDateYMD, tz, tenantId, compDateYMD, tz, compDateYMD],
    );

    const compHourMap = new Map<number, { bills: number; netSales: number; profit: number }>();
    for (const r of compHourlyRows) {
      const hr = Number(r.hr);
      const bills = Number(r.bills ?? 0);
      const netSales = Math.max(0, Number(r.netSales ?? r.net_sales ?? 0));
      const cogs = Number(r.cogs ?? 0);
      const profit = Math.max(0, netSales - cogs);
      compHourMap.set(hr, { bills, netSales, profit });
    }

    // Build series from openingHour to closingHour
    const hourlySeries: Array<{
      hour: number;
      label: string;
      hourRange: string;
      isPastOrCurrent: boolean;
      todaySalesMinor: number | null;
      todayBillsCount: number | null;
      todayProfitMinor: number | null;
      compSalesMinor: number;
      compBillsCount: number;
      compProfitMinor: number;
      lastWeekSalesMinor: number;
      lastWeekBillsCount: number;
      lastWeekProfitMinor: number;
    }> = [];

    let busiestHourToday: {
      hour: number;
      label: string;
      salesMinor: number;
      billsCount: number;
      profitMinor: number;
      compSalesMinor: number;
      compBillsCount: number;
      compProfitMinor: number;
    } | null = null;

    let busiestHourComp: {
      hour: number;
      label: string;
      salesMinor: number;
      billsCount: number;
      profitMinor: number;
    } | null = null;

    let maxTodaySales = 0;
    let maxCompSales = 0;

    for (let h = openingHour; h <= closingHour; h++) {
      const isPastOrCurrent = h <= currentHour;
      const todayData = todayHourMap.get(h);
      const compData = compHourMap.get(h) || { bills: 0, netSales: 0, profit: 0 };

      const tSales = isPastOrCurrent ? (todayData?.netSales ?? 0) : null;
      const tBills = isPastOrCurrent ? (todayData?.bills ?? 0) : null;
      const tProfit = isPastOrCurrent && isOwnerOrManager ? (todayData?.profit ?? 0) : null;

      const cSales = compData.netSales;
      const cBills = compData.bills;
      const cProfit = isOwnerOrManager ? compData.profit : 0;

      const rangeLabel = formatHourRange(h);

      if (isPastOrCurrent && tSales !== null && tSales > maxTodaySales) {
        maxTodaySales = tSales;
        busiestHourToday = {
          hour: h,
          label: rangeLabel,
          salesMinor: tSales,
          billsCount: tBills ?? 0,
          profitMinor: tProfit ?? 0,
          compSalesMinor: cSales,
          compBillsCount: cBills,
          compProfitMinor: cProfit,
        };
      }

      if (cSales > maxCompSales) {
        maxCompSales = cSales;
        busiestHourComp = {
          hour: h,
          label: rangeLabel,
          salesMinor: cSales,
          billsCount: cBills,
          profitMinor: cProfit,
        };
      }

      hourlySeries.push({
        hour: h,
        label: formatHourTick(h),
        hourRange: rangeLabel,
        isPastOrCurrent,
        todaySalesMinor: tSales,
        todayBillsCount: tBills,
        todayProfitMinor: tProfit,
        compSalesMinor: cSales,
        compBillsCount: cBills,
        compProfitMinor: cProfit,
        lastWeekSalesMinor: cSales,
        lastWeekBillsCount: cBills,
        lastWeekProfitMinor: cProfit,
      });
    }

    const isEveningRushAhead = Boolean(busiestHourComp && busiestHourComp.hour > currentHour && maxCompSales > 0);

    const busiestRangeText = busiestHourToday && maxTodaySales > 0 ? busiestHourToday.label : null;
    const subtitle = busiestRangeText
      ? `${Math.round(netSalesMinor / 100).toLocaleString('en-IN')} so far · busiest hour ${busiestRangeText}${
          isEveningRushAhead ? ' · evening rush still ahead' : ''
        }`
      : `${Math.round(netSalesMinor / 100).toLocaleString('en-IN')} so far${isEveningRushAhead ? ' · evening rush still ahead' : ''}`;

    // 6. PAYMENT MODES BREAKDOWN
    // Actual payments received today: both POS bill checkouts and standalone customer dues collections
    const paymentRows = await ctx.db.query<any>(
      `SELECT
        LOWER(COALESCE(p.mode, p.method, 'cash')) AS mode,
        COALESCE(SUM(p.amount_minor), 0)::bigint AS total_minor
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       WHERE p.tenant_id = ?
         AND (p.status IS NULL OR p.status = 'posted')
         AND COALESCE(p.kind, 'receipt') = 'receipt'
         AND (
           (p.invoice_id IS NOT NULL AND (i.bdate = ? OR (i.created_at AT TIME ZONE ?)::date = ?::date) AND i.status = 'posted' AND i.kind = 'sale')
           OR
           (p.invoice_id IS NULL AND (p.bdate = ? OR (p.created_at AT TIME ZONE ?)::date = ?::date))
         )
       GROUP BY LOWER(COALESCE(p.mode, p.method, 'cash'))`,
      [tenantId, todayYMD, tz, todayYMD, todayYMD, tz, todayYMD],
    );

    const paymentModesMap = new Map<string, number>();
    for (const r of paymentRows) {
      const mode = String(r.mode || 'cash').toLowerCase();
      const amt = Number(r.totalMinor ?? r.total_minor ?? 0);
      if (amt > 0) {
        paymentModesMap.set(mode, (paymentModesMap.get(mode) || 0) + amt);
      }
    }

    // Deduct actual refunds paid today on credit notes by refund mode
    const refundRows = await ctx.db.query<any>(
      `SELECT
        LOWER(COALESCE(refund_mode, 'cash')) AS mode,
        COALESCE(SUM(refund_amount_minor), 0)::bigint AS total_refund_minor
       FROM invoices
       WHERE tenant_id = ?
         AND (bdate = ? OR (created_at AT TIME ZONE ?)::date = ?::date)
         AND kind = 'credit_note'
         AND status = 'posted'
         AND refund_amount_minor > 0
       GROUP BY LOWER(COALESCE(refund_mode, 'cash'))`,
      [tenantId, todayYMD, tz, todayYMD],
    );

    for (const r of refundRows) {
      const mode = String(r.mode || 'cash').toLowerCase();
      const refAmt = Number(r.totalRefundMinor ?? r.total_refund_minor ?? 0);
      if (refAmt > 0 && paymentModesMap.has(mode)) {
        const current = paymentModesMap.get(mode)!;
        const net = Math.max(0, current - refAmt);
        if (net > 0) {
          paymentModesMap.set(mode, net);
        } else {
          paymentModesMap.delete(mode);
        }
      }
    }

    const collectedTotalMinor = Array.from(paymentModesMap.values()).reduce((sum, v) => sum + v, 0);

    const paymentModes = Array.from(paymentModesMap.entries()).map(([modeKey, amt]) => {
      const name =
        modeKey === 'upi' ? 'UPI' :
        modeKey === 'cash' ? 'Cash' :
        modeKey === 'card' ? 'Card' :
        modeKey === 'bank' ? 'Bank Transfer' :
        modeKey === 'cheque' ? 'Cheque' :
        modeKey.toUpperCase();

      const percentage = collectedTotalMinor > 0 ? Math.round((amt / collectedTotalMinor) * 100) : 0;
      const color = PAYMENT_MODE_COLORS[modeKey] || '#6366f1';

      return {
        key: modeKey,
        name,
        amountMinor: amt,
        percentage,
        color,
      };
    }).sort((a, b) => b.amountMinor - a.amountMinor);

    // 7. TOP 5 SELLERS TODAY
    const topSellersRows = await ctx.db.query<any>(
      `SELECT
        COALESCE(it.id, il.item_id) AS item_id,
        COALESCE(it.name, il.name, 'Item') AS name,
        COALESCE(it.unit, il.unit, 'pcs') AS unit,
        COALESCE(SUM(
          CASE
            WHEN i.kind = 'sale' THEN il.qty_milli
            WHEN i.kind = 'credit_note' THEN -il.qty_milli
            ELSE 0
          END
        ), 0)::bigint AS qty_milli,
        COALESCE(SUM(
          CASE
            WHEN i.kind = 'sale' THEN il.total_minor
            WHEN i.kind = 'credit_note' THEN -il.total_minor
            ELSE 0
          END
        ), 0)::bigint AS sales_minor
       FROM invoice_lines il
       JOIN invoices i ON i.id = il.invoice_id
       LEFT JOIN items it ON it.id = il.item_id AND it.tenant_id = il.tenant_id
       WHERE i.tenant_id = ?
         AND (i.bdate = ? OR (i.created_at AT TIME ZONE ?)::date = ?::date)
         AND i.status = 'posted'
         AND i.kind IN ('sale', 'credit_note')
       GROUP BY COALESCE(it.id, il.item_id), COALESCE(it.name, il.name, 'Item'), COALESCE(it.unit, il.unit, 'pcs')
       HAVING SUM(CASE WHEN i.kind = 'sale' THEN il.total_minor WHEN i.kind = 'credit_note' THEN -il.total_minor ELSE 0 END) > 0
       ORDER BY sales_minor DESC
       LIMIT 5`,
      [tenantId, todayYMD, tz, todayYMD],
    );

    const firstSellerSales = topSellersRows.length > 0 ? Number(topSellersRows[0].salesMinor ?? topSellersRows[0].sales_minor ?? 0) : 1;
    const maxSellerSales = Math.max(1, firstSellerSales);

    const topSellers = topSellersRows
      .map((r: any) => {
        const itemId = r.itemId ?? r.item_id ?? '';
        const name = r.name || 'Item';
        const unit = r.unit || 'pcs';
        const rawQtyMilli = Number(r.qtyMilli ?? r.qty_milli ?? 0);
        const quantity = Math.round((rawQtyMilli / 1000) * 100) / 100;
        const salesMinor = Number(r.salesMinor ?? r.sales_minor ?? 0);
        return {
          itemId,
          name,
          unit,
          quantity,
          salesMinor,
          barPct: maxSellerSales > 0 ? Math.min(100, Math.round((salesMinor / maxSellerSales) * 100)) : 0,
        };
      })
      .filter((item) => item.salesMinor > 0 && item.quantity > 0);

    // 8. STOCK NEEDING ATTENTION (Inventory Hub rules - strictly actual thresholds without arbitrary defaults)
    const stockAttentionRows = await ctx.db.query<any>(
      `WITH today_sold AS (
        SELECT
          il.item_id,
          COALESCE(SUM(il.qty_milli), 0)::bigint AS sold_today_milli
        FROM invoice_lines il
        JOIN invoices i ON i.id = il.invoice_id
        WHERE i.tenant_id = ?
          AND (i.bdate = ? OR (i.created_at AT TIME ZONE ?)::date = ?::date)
          AND i.status = 'posted'
          AND i.kind = 'sale'
        GROUP BY il.item_id
      ),
      item_stock AS (
        SELECT
          i.id,
          i.name,
          i.unit,
          i.reorder_milli,
          COALESCE(i.min_stock_milli, 0) AS min_stock_milli,
          COALESCE((
            SELECT SUM(sm.qty_milli)
            FROM stock_moves sm
            WHERE sm.item_id = i.id AND sm.tenant_id = i.tenant_id
          ), 0)::bigint AS stock_milli,
          COALESCE(ts.sold_today_milli, 0)::bigint AS sold_today_milli
        FROM items i
        LEFT JOIN today_sold ts ON ts.item_id = i.id
        WHERE i.tenant_id = ?
          AND i.active = true
          AND i.track_stock = true
      )
      SELECT
        id,
        name,
        unit,
        reorder_milli,
        min_stock_milli,
        stock_milli,
        sold_today_milli
      FROM item_stock
      WHERE stock_milli <= 0
         OR ((reorder_milli > 0 OR min_stock_milli > 0) AND stock_milli <= GREATEST(reorder_milli, min_stock_milli))
         OR sold_today_milli > 0
      ORDER BY
        (CASE
          WHEN stock_milli <= 0 THEN 1
          WHEN (reorder_milli > 0 OR min_stock_milli > 0) AND stock_milli <= GREATEST(reorder_milli, min_stock_milli) THEN 2
          ELSE 3
        END) ASC,
        sold_today_milli DESC,
        stock_milli ASC
      LIMIT 5`,
      [tenantId, todayYMD, tz, todayYMD, tenantId],
    );

    const stockAttention = stockAttentionRows.map((r: any) => {
      const stockMilli = Number(r.stockMilli ?? r.stock_milli ?? 0);
      const reorderMilli = Number(r.reorderMilli ?? r.reorder_milli ?? 0);
      const minStockMilli = Number(r.minStockMilli ?? r.min_stock_milli ?? 0);
      const soldTodayMilli = Number(r.soldTodayMilli ?? r.sold_today_milli ?? 0);

      const stockQty = Math.round((stockMilli / 1000) * 100) / 100;
      const reorderQty = reorderMilli > 0 ? Math.round((reorderMilli / 1000) * 100) / 100 : null;
      const minStockQty = minStockMilli > 0 ? Math.round((minStockMilli / 1000) * 100) / 100 : null;
      const threshold = reorderQty !== null || minStockQty !== null
        ? Math.max(reorderQty ?? 0, minStockQty ?? 0)
        : null;
      const soldToday = Math.round((soldTodayMilli / 1000) * 100) / 100;

      let status: 'out_of_stock' | 'sold_today' | 'below_reorder' | 'not_configured' = 'not_configured';
      let badgeText = '';
      let badgeType: 'danger' | 'warning' | 'neutral' = 'neutral';

      if (stockQty <= 0) {
        status = 'out_of_stock';
        badgeText = 'Out of stock';
        badgeType = 'danger';
      } else if (threshold !== null && threshold > 0 && stockQty <= threshold) {
        status = 'below_reorder';
        badgeText = `Below reorder (${threshold})`;
        badgeType = 'warning';
      } else if (soldToday > 0) {
        status = 'sold_today';
        badgeText = `Sold ${soldToday} today`;
        badgeType = 'warning';
      } else {
        status = 'not_configured';
        badgeText = 'Reorder level not configured';
        badgeType = 'neutral';
      }

      return {
        itemId: r.id,
        name: r.name,
        unit: r.unit || 'pcs',
        stockQty,
        reorderLevel: threshold,
        soldTodayQty: soldToday,
        status,
        badgeText,
        badgeType,
      };
    });

    // 9. CURRENT USER'S SHIFT / CASH DRAWER
    const isManagerOrOwner = ['owner', 'manager', 'accountant'].includes(ctx.user!.role);
    const counterParam = (ctx.query.counter as string || ctx.query.location as string || '').trim();

    let shiftSql = `SELECT s.*, u.name AS user_name, u.role AS user_role
       FROM shifts s
       JOIN users u ON u.id = s.user_id
       WHERE s.tenant_id = ? AND s.user_id = ? AND s.status = 'open'`;
    const shiftParams: any[] = [tenantId, ctx.user!.id];

    if (counterParam) {
      shiftSql += ' AND (s.location = ? OR s.location = ?)';
      shiftParams.push(counterParam, counterParam === 'Counter 1' ? 'MAIN' : counterParam);
    }
    shiftSql += ' ORDER BY s.opened_at DESC LIMIT 1';

    let activeShift = await ctx.db.one<any>(shiftSql, shiftParams);

    if (!activeShift && isManagerOrOwner) {
      let fallbackSql = `SELECT s.*, u.name AS user_name, u.role AS user_role
         FROM shifts s
         JOIN users u ON u.id = s.user_id
         WHERE s.tenant_id = ? AND s.status = 'open'`;
      const fallbackParams: any[] = [tenantId];
      if (counterParam) {
        fallbackSql += ' AND (s.location = ? OR s.location = ?)';
        fallbackParams.push(counterParam, counterParam === 'Counter 1' ? 'MAIN' : counterParam);
      }
      fallbackSql += ' ORDER BY s.opened_at DESC LIMIT 1';

      activeShift = await ctx.db.one<any>(fallbackSql, fallbackParams);
    }

    let shiftDrawer: {
      hasOpenShift: boolean;
      shiftNumber: string | null;
      counterName: string;
      openedAt: string | null;
      openedAtFormatted: string | null;
      cashierName: string;
      openingCashMinor: number;
      cashSalesMinor: number;
      cashPaymentsMinor: number;
      cashRefundsMinor: number;
      cashInMinor: number;
      cashOutMinor: number;
      expectedCashMinor: number;
      activeShift: any | null;
    } = {
      hasOpenShift: false,
      shiftNumber: null,
      counterName: 'Counter 1',
      openedAt: null,
      openedAtFormatted: null,
      cashierName: ctx.user!.name,
      openingCashMinor: 0,
      cashSalesMinor: 0,
      cashPaymentsMinor: 0,
      cashRefundsMinor: 0,
      cashInMinor: 0,
      cashOutMinor: 0,
      expectedCashMinor: 0,
      activeShift: null,
    };

    if (activeShift) {
      const financials = await computeShiftFinancials(ctx.db, activeShift, tenantId, null, todayYMD);
      const summary = financials.summary;
      const rawOpenedAt = activeShift.openedAt ?? activeShift.opened_at ?? null;

      let shiftOpenedAtFormatted: string = 'Opening time unavailable';
      if (rawOpenedAt) {
        const openedAtDate = new Date(rawOpenedAt);
        if (!isNaN(openedAtDate.getTime())) {
          const openedYMD = getShopDateYMD(openedAtDate, tz);
          const timeStr = timeFormatter.format(openedAtDate);
          if (openedYMD === todayYMD) {
            shiftOpenedAtFormatted = timeStr;
          } else if (openedYMD === compDateYMD) {
            shiftOpenedAtFormatted = `Yesterday · ${timeStr}`;
          } else {
            const shortDateFormatter = new Intl.DateTimeFormat('en-US', {
              timeZone: tz,
              month: 'short',
              day: 'numeric',
            });
            shiftOpenedAtFormatted = `${shortDateFormatter.format(openedAtDate)} · ${timeStr}`;
          }
        }
      }

      const shiftCashierName = activeShift.userName ?? activeShift.user_name ?? ctx.user!.name;

      shiftDrawer = {
        hasOpenShift: true,
        shiftNumber: activeShift.shiftNumber ?? activeShift.shift_number ?? '1',
        counterName: activeShift.location === 'MAIN' ? 'Counter 1' : activeShift.location || 'Counter 1',
        openedAt: rawOpenedAt,
        openedAtFormatted: shiftOpenedAtFormatted,
        cashierName: shiftCashierName,
        openingCashMinor: summary.openingCashMinor,
        cashSalesMinor: summary.cashSalesMinor,
        cashPaymentsMinor: summary.cashPaymentsMinor,
        cashRefundsMinor: summary.cashRefundsMinor,
        cashInMinor: summary.cashInMinor,
        cashOutMinor: summary.cashOutMinor,
        expectedCashMinor: summary.expectedCashMinor,
        activeShift: {
          id: activeShift.id,
          shiftNumber: activeShift.shiftNumber ?? activeShift.shift_number,
          userId: activeShift.userId ?? activeShift.user_id,
          userName: shiftCashierName,
          userRole: activeShift.userRole ?? activeShift.user_role ?? ctx.user!.role,
          location: activeShift.location || 'MAIN',
          status: activeShift.status || 'open',
          openedAt: rawOpenedAt,
          openingCashMinor: summary.openingCashMinor,
          summary,
        },
      };
    }

    // 10. COUNTERS TODAY (Collections from open till now per counter)
    const counterPaymentsRows = await ctx.db.query<any>(
      `SELECT 
         p.id,
         p.amount_minor,
         s.location AS shift_location
       FROM payments p
       LEFT JOIN shifts s ON s.id = p.shift_id
       LEFT JOIN invoices i ON i.id = p.invoice_id
       WHERE p.tenant_id = ?
         AND (
           (p.invoice_id IS NOT NULL AND (i.bdate = ? OR (i.created_at AT TIME ZONE ?)::date = ?::date))
           OR
           (p.invoice_id IS NULL AND (p.bdate = ? OR (p.created_at AT TIME ZONE ?)::date = ?::date))
         )
         AND (p.status IS NULL OR p.status = 'posted')
         AND (p.invoice_id IS NULL OR (i.status = 'posted' AND i.kind = 'sale'))
         AND COALESCE(p.kind, 'receipt') = 'receipt'`,
      [tenantId, todayYMD, tz, todayYMD, todayYMD, tz, todayYMD],
    );

    const shiftsTodayRows = await ctx.db.query<any>(
      `SELECT s.id, s.location, s.status, s.opened_at
       FROM shifts s
       WHERE s.tenant_id = ?
         AND (
           s.status = 'open'
           OR (s.opened_at AT TIME ZONE ?)::date = ?::date
           OR (s.closed_at IS NOT NULL AND (s.closed_at AT TIME ZONE ?)::date = ?::date)
         )`,
      [tenantId, tz, todayYMD, tz, todayYMD],
    );

    const counterRefundsRows = await ctx.db.query<any>(
      `SELECT 
         p.amount_minor,
         s.location AS shift_location
       FROM payments p
       LEFT JOIN shifts s ON s.id = p.shift_id
       WHERE p.tenant_id = ?
         AND (p.bdate = ? OR (p.created_at AT TIME ZONE ?)::date = ?::date)
         AND p.kind = 'refund'`,
      [tenantId, todayYMD, tz, todayYMD],
    );

    function normalizeCounterName(rawLocation?: string | null): string {
      if (!rawLocation || rawLocation.trim() === '' || rawLocation.toUpperCase() === 'MAIN') {
        return 'Counter 1';
      }
      const clean = rawLocation.trim();
      const match = clean.match(/^(?:counter[-_\s]*)(\d+)$/i);
      if (match) {
        return `Counter ${match[1]}`;
      }
      return clean;
    }

    const counterMap = new Map<string, number>();
    const defaultCounters = ['Counter 1', 'Counter 2', 'Counter 3'];
    for (const c of defaultCounters) {
      counterMap.set(c, 0);
    }

    for (const s of shiftsTodayRows) {
      const c = normalizeCounterName(s.location);
      if (!counterMap.has(c)) {
        counterMap.set(c, 0);
      }
    }

    for (const p of counterPaymentsRows) {
      const c = normalizeCounterName(p.shiftLocation ?? p.shift_location);
      const amt = Number(p.amountMinor ?? p.amount_minor ?? 0);
      counterMap.set(c, (counterMap.get(c) || 0) + amt);
    }

    for (const r of counterRefundsRows) {
      const c = normalizeCounterName(r.shiftLocation ?? r.shift_location);
      const amt = Number(r.amountMinor ?? r.amount_minor ?? 0);
      const cur = counterMap.get(c) || 0;
      counterMap.set(c, Math.max(0, cur - amt));
    }

    function formatCounterRupees(minor: number): string {
      const val = Math.round(minor / 100);
      return `₹${val.toLocaleString('en-IN')}`;
    }

    const countersList = Array.from(counterMap.entries()).map(([name, amountMinor]) => ({
      id: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      amountMinor,
      formattedAmount: formatCounterRupees(amountMinor),
    }));

    countersList.sort((a, b) => {
      const numA = parseInt(a.name.replace(/\D/g, '') || '999', 10);
      const numB = parseInt(b.name.replace(/\D/g, '') || '999', 10);
      return numA - numB;
    });

    const countersTotalMinor = countersList.reduce((sum, c) => sum + c.amountMinor, 0);

    const countersToday = {
      title: 'Counters Today',
      subtitle: 'Collected from open till now',
      counters: countersList,
      totalMinor: countersTotalMinor,
      formattedTotal: formatCounterRupees(countersTotalMinor),
    };

    return {
      serverTime: now.toISOString(),
      nowKolkata: {
        timeStr: nowTimeStr,
        hour: currentHour,
        minute: currentMinute,
        todayYMD,
        weekday: todayWeekday,
        formattedDate: todayFormattedDate,
        compDateYMD,
        compWeekday,
        compWeekdayShort,
        compLabel: 'yesterday',
        lastWeekYMD: compDateYMD,
        lastWeekday: compWeekday,
      },
      cards: {
        todaySales: {
          netSalesMinor,
          grossSalesMinor,
          compNetSalesMinor,
          changePct: salesChangePct,
          diffMinor: netSalesMinor - compNetSalesMinor,
        },
        bills: {
          billsCount,
          compBillsCount,
          diffCount: billsDiffCount,
          hasCompBills: compBillsCount > 0,
        },
        avgBillValue: {
          avgBillMinor: avgBillValueMinor,
          compAvgBillMinor: compAvgBillValueMinor,
          changePct: avgBillChangePct,
        },
        grossProfit: {
          profitMinor: grossProfitMinor,
          marginPct,
          cogsMinor,
          isEstimated: isCostEstimated,
          visible: isOwnerOrManager,
        },
        itemsSold: {
          totalUnits: totalUnitsSold,
          distinctProductsCount: distinctProductsSold,
        },
        returns: {
          returnsMinor,
          returnsCount,
          returnRatePct,
          compReturnsMinor,
          changePct: returnsChangePct,
        },
      },
      hourly: {
        openingHour,
        closingHour,
        currentHour,
        currentMinute,
        busiestHourToday,
        busiestHourComp,
        isEveningRushAhead,
        subtitle,
        series: hourlySeries,
      },
      payments: {
        collectedTotalMinor,
        modes: paymentModes,
        gst: {
          totalGstMinor,
          cgstMinor: netCgstMinor,
          sgstMinor: netSgstMinor,
          igstMinor: netIgstMinor,
        },
      },
      topSellers,
      stockAttention,
      shiftDrawer,
      countersToday,
    };
  });
}
