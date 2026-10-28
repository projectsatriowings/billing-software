import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type {
  SalesAnalysisData,
  SalesOverviewPoint,
  DaywiseSalesRow,
} from '../../api.ts';
import { fetchSalesAnalysis } from '../../api.ts';

interface SalesAnalysisViewProps {
  userRole?: string;
  shopName?: string;
  onNavigateToInvoices?: (searchDate?: string) => void;
  showToast?: (msg: string) => void;
}

type MetricToggle = 'sales' | 'bills' | 'profit' | 'avg_bill';
type DatePreset = 'today' | '7d' | '30d' | 'this_month' | '90d' | 'custom';
type ComparePreset = 'previous_period' | 'same_period_last_month' | 'none';
type GroupingPreset = 'day' | 'week' | 'month';

/** Indian number formatter with paise support */
export function formatRupees(minor: number | undefined | null, includeDecimals = false): string {
  if (minor === undefined || minor === null || isNaN(minor)) return '₹0';
  const val = minor / 100;
  if (includeDecimals) {
    return '₹' + val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return '₹' + Math.round(val).toLocaleString('en-IN');
}

/** Formatter for compact rupee numbers in charts & axis (e.g. ₹0, ₹5k, ₹50k, ₹1.2L, ₹1Cr) */
function formatCompactRupees(minor: number): string {
  const r = minor / 100;
  if (r === 0) return '₹0';
  const absR = Math.abs(r);
  if (absR >= 10000000) {
    const cr = r / 10000000;
    return `₹${cr % 1 === 0 ? cr.toFixed(0) : cr.toFixed(1)}Cr`;
  }
  if (absR >= 100000) {
    const l = r / 100000;
    return `₹${l % 1 === 0 ? l.toFixed(0) : l.toFixed(1)}L`;
  }
  if (absR >= 1000) {
    const k = r / 1000;
    return `₹${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `₹${Math.round(r)}`;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDMMM(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const day = parseInt(parts[2], 10);
    const mIdx = parseInt(parts[1], 10) - 1;
    if (mIdx >= 0 && mIdx < 12) {
      return `${day} ${MONTHS_SHORT[mIdx]}`;
    }
  }
  const d = new Date(dateStr + 'T12:00:00Z');
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

function formatDMMMYYYY(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const year = parts[0];
    const mIdx = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const month = MONTHS_SHORT[mIdx] || 'Sep';
    return `${day} ${month} ${year}`;
  }
  const d = new Date(dateStr + 'T12:00:00Z');
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Compute nice tick steps (1, 2, 5 x 10^n) with ~15% headroom starting at 0 */
function getNiceTicks(
  rawMax: number,
  isCount: boolean,
): { maxValue: number; ticks: number[] } {
  if (rawMax <= 0) {
    if (isCount) {
      return { maxValue: 5, ticks: [0, 1, 2, 3, 4, 5] };
    }
    // ₹0 to ₹1k in minor units
    return { maxValue: 100000, ticks: [0, 25000, 50000, 75000, 100000] };
  }

  const targetCeiling = rawMax * 1.15;

  if (isCount) {
    const rawStep = Math.max(1, targetCeiling / 5);
    const exponent = Math.floor(Math.log10(rawStep));
    const power = Math.pow(10, Math.max(0, exponent));
    const fraction = rawStep / power;

    let niceFraction = 1;
    if (fraction <= 1.2) niceFraction = 1;
    else if (fraction <= 2.2) niceFraction = 2;
    else if (fraction <= 3.8) niceFraction = exponent >= 1 ? 2.5 : 2;
    else if (fraction <= 7.5) niceFraction = 5;
    else niceFraction = 10;

    const step = Math.max(1, Math.round(niceFraction * power));
    let maxValue = Math.ceil(targetCeiling / step) * step;
    if (maxValue / step < 4) {
      maxValue = step * 4;
    }

    const ticks: number[] = [];
    for (let t = 0; t <= maxValue + step * 0.001; t += step) {
      ticks.push(Math.round(t));
    }
    return { maxValue: ticks[ticks.length - 1], ticks };
  } else {
    const rawMaxRupees = rawMax / 100;
    const targetCeilingRupees = rawMaxRupees * 1.15;
    const rawStepRupees = Math.max(1, targetCeilingRupees / 5);
    const exponent = Math.floor(Math.log10(rawStepRupees));
    const power = Math.pow(10, Math.max(0, exponent));
    const fraction = rawStepRupees / power;

    let niceFraction = 1;
    if (fraction <= 1.2) niceFraction = 1;
    else if (fraction <= 2.2) niceFraction = 2;
    else if (fraction <= 3.8) niceFraction = 2.5;
    else if (fraction <= 7.5) niceFraction = 5;
    else niceFraction = 10;

    const stepRupees = niceFraction * power;
    let maxRupees = Math.ceil(targetCeilingRupees / stepRupees) * stepRupees;
    if (maxRupees / stepRupees < 4) {
      maxRupees = stepRupees * 4;
    }

    const stepMinor = Math.round(stepRupees * 100);
    const maxMinor = Math.round(maxRupees * 100);
    const ticks: number[] = [];
    for (let t = 0; t <= maxMinor + stepMinor * 0.001; t += stepMinor) {
      ticks.push(Math.round(t));
    }
    return { maxValue: ticks[ticks.length - 1], ticks };
  }
}

/** Fritsch-Carlson monotone cubic spline interpolation path */
function buildMonotoneCubicPath(points: { x: number; y: number }[]): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  if (n === 2) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)} L ${points[1].x.toFixed(1)} ${points[1].y.toFixed(1)}`;
  }

  const dx: number[] = new Array(n - 1);
  const dy: number[] = new Array(n - 1);
  const slopes: number[] = new Array(n - 1);

  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1].x - points[i].x;
    dy[i] = points[i + 1].y - points[i].y;
    slopes[i] = dx[i] === 0 ? 0 : dy[i] / dx[i];
  }

  const m: number[] = new Array(n);
  m[0] = slopes[0];
  m[n - 1] = slopes[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slopes[i - 1] * slopes[i] <= 0) {
      m[i] = 0;
    } else {
      m[i] = (slopes[i - 1] + slopes[i]) / 2;
    }
  }

  for (let i = 0; i < n - 1; i++) {
    if (slopes[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const alpha = m[i] / slopes[i];
      const beta = m[i + 1] / slopes[i];
      if (alpha < 0) m[i] = 0;
      if (beta < 0) m[i + 1] = 0;
      const hypot = Math.hypot(alpha, beta);
      if (hypot > 3) {
        const tau = 3 / hypot;
        m[i] = tau * alpha * slopes[i];
        m[i + 1] = tau * beta * slopes[i];
      }
    }
  }

  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const cp1x = points[i].x + dx[i] / 3;
    const cp1y = points[i].y + (m[i] * dx[i]) / 3;
    const cp2x = points[i + 1].x - dx[i] / 3;
    const cp2y = points[i + 1].y - (m[i + 1] * dx[i]) / 3;
    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${points[i + 1].x.toFixed(1)} ${points[i + 1].y.toFixed(1)}`;
  }

  return path;
}

/** Get today's date in Asia/Kolkata timezone */
function getTodayKolkataYMD(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
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

export const SalesAnalysisView: React.FC<SalesAnalysisViewProps> = ({
  userRole = 'owner',
  shopName = 'Shree Krishna Supermarket & Retail',
  onNavigateToInvoices,
  showToast,
}) => {
  // Preset filters
  const [datePreset, setDatePreset] = useState<DatePreset>('30d');
  const [comparePreset, setComparePreset] = useState<ComparePreset>('previous_period');
  const [selectedCounter, setSelectedCounter] = useState<string>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedCashier, setSelectedCashier] = useState<string>('ALL');

  // Custom date picker range
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [modalFrom, setModalFrom] = useState<string>('');
  const [modalTo, setModalTo] = useState<string>('');
  const [showCustomModal, setShowCustomModal] = useState<boolean>(false);

  // Active chart metric toggle
  const [chartMetric, setChartMetric] = useState<MetricToggle>('sales');
  // Chart tooltip hover state
  const [hoveredPoint, setHoveredPoint] = useState<{
    pt: SalesOverviewPoint & { isWeek?: boolean };
    x: number;
    y: number;
    val: number | null;
  } | null>(null);

  // Daywise table sorting & grouping
  const [sortField, setSortField] = useState<keyof DaywiseSalesRow>('netSalesMinor');
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [grouping, setGrouping] = useState<GroupingPreset>('day');

  // Schedule daily report modal
  const [showScheduleModal, setShowScheduleModal] = useState<boolean>(false);
  const [schedulePhone, setSchedulePhone] = useState<string>('9840123456');
  const [scheduleSent, setScheduleSent] = useState<boolean>(false);

  // Data fetching state
  const [data, setData] = useState<SalesAnalysisData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Calculate from & to dates based on preset
  const { fromYMD, toYMD } = useMemo(() => {
    const today = getTodayKolkataYMD();
    if (datePreset === 'today') {
      return { fromYMD: today, toYMD: today };
    }
    if (datePreset === '7d') {
      return { fromYMD: addDaysYMD(today, -6), toYMD: today };
    }
    if (datePreset === '30d') {
      return { fromYMD: addDaysYMD(today, -29), toYMD: today };
    }
    if (datePreset === 'this_month') {
      const parts = today.split('-');
      const firstDay = `${parts[0]}-${parts[1]}-01`;
      return { fromYMD: firstDay, toYMD: today };
    }
    if (datePreset === '90d') {
      return { fromYMD: addDaysYMD(today, -89), toYMD: today };
    }
    if (datePreset === 'custom') {
      const from = customFrom || addDaysYMD(today, -29);
      const to = customTo || today;
      return { fromYMD: from, toYMD: to };
    }
    return { fromYMD: addDaysYMD(today, -29), toYMD: today };
  }, [datePreset, customFrom, customTo]);

  // Open custom date modal preloaded with current range
  const openCustomDateModal = useCallback(() => {
    const today = getTodayKolkataYMD();
    const curFrom = customFrom || (datePreset === 'custom' ? fromYMD : addDaysYMD(today, -29));
    const curTo = customTo || (datePreset === 'custom' ? toYMD : today);
    setModalFrom(curFrom);
    setModalTo(curTo);
    setShowCustomModal(true);
  }, [customFrom, customTo, datePreset, fromYMD, toYMD]);

  // Apply custom date range
  const handleApplyCustomRange = useCallback(
    (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      const today = getTodayKolkataYMD();
      const from = modalFrom || addDaysYMD(today, -29);
      const to = modalTo || today;
      if (from > to) return;
      setCustomFrom(from);
      setCustomTo(to);
      setDatePreset('custom');
      setShowCustomModal(false);
    },
    [modalFrom, modalTo],
  );

  // Compute selected days count in modal
  const selectedRangeDays = useMemo(() => {
    if (!modalFrom || !modalTo) return 0;
    const t1 = new Date(modalFrom + 'T00:00:00Z').getTime();
    const t2 = new Date(modalTo + 'T00:00:00Z').getTime();
    if (isNaN(t1) || isNaN(t2) || t1 > t2) return 0;
    return Math.round((t2 - t1) / 86400000) + 1;
  }, [modalFrom, modalTo]);

  // Load Sales Analysis data from API
  const loadAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSalesAnalysis({
        from: fromYMD,
        to: toYMD,
        compare: comparePreset,
        counterId: selectedCounter,
        categoryId: selectedCategory,
        userId: selectedCashier,
      });
      setData(res);
    } catch (err: any) {
      console.error('Failed to load sales analysis:', err);
      setError(err?.message || 'Failed to fetch sales analytics');
    } finally {
      setLoading(false);
    }
  }, [fromYMD, toYMD, comparePreset, selectedCounter, selectedCategory, selectedCashier]);

  useEffect(() => {
    loadAnalysis();
  }, [loadAnalysis]);

  // Handle Export Report (Full Report CSV)
  const handleExportFullReport = () => {
    if (!data) return;
    const rows = [
      ['Sales Analysis Report - ' + shopName],
      ['Date Range', `${data.filters.from} to ${data.filters.to}`],
      ['Generated On', new Date().toLocaleString('en-IN')],
      [],
      ['SUMMARY METRICS', 'CURRENT PERIOD', data.comparison ? `PREVIOUS PERIOD (${data.comparison.periodLabel})` : ''],
      ['Net Sales', (data.summary.netSalesMinor / 100).toFixed(2), data.comparison ? (data.comparison.summary.netSalesMinor / 100).toFixed(2) : ''],
      ['Bills Count', data.summary.billsCount, data.comparison ? data.comparison.summary.billsCount : ''],
      ['Average Bill Value', (data.summary.avgBillValueMinor / 100).toFixed(2), data.comparison ? (data.comparison.summary.avgBillValueMinor / 100).toFixed(2) : ''],
      ['Gross Profit', (data.summary.grossProfitMinor / 100).toFixed(2), data.comparison ? (data.comparison.summary.grossProfitMinor / 100).toFixed(2) : ''],
      ['Margin %', `${data.summary.marginPct}%`, data.comparison ? `${data.comparison.summary.marginPct}%` : ''],
      ['Returns (Credit Notes)', (data.summary.returnsMinor / 100).toFixed(2), data.comparison ? (data.comparison.summary.returnsMinor / 100).toFixed(2) : ''],
      ['Returns Count', data.summary.returnsCount, data.comparison ? data.comparison.summary.returnsCount : ''],
      ['GST Collected', (data.summary.totalGstMinor / 100).toFixed(2), data.comparison ? (data.comparison.summary.totalGstMinor / 100).toFixed(2) : ''],
      [],
      ['DAYWISE SALES BREAKDOWN'],
      ['Date', 'Bills', 'Net Sales (₹)', 'Returns (₹)', 'Discount (₹)', 'GST (₹)', 'Gross Profit (₹)', 'Margin %'],
      ...data.daywise.map((d) => [
        d.date,
        d.billsCount,
        (d.netSalesMinor / 100).toFixed(2),
        (d.returnsMinor / 100).toFixed(2),
        (d.discountMinor / 100).toFixed(2),
        (d.gstMinor / 100).toFixed(2),
        (d.grossProfitMinor / 100).toFixed(2),
        `${d.marginPct}%`,
      ]),
    ];

    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((e) => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Sales_Analysis_${data.filters.from}_to_${data.filters.to}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Handle Export Daywise CSV
  const handleExportDaywiseCSV = () => {
    if (!data?.daywise) return;
    const headers = ['Date', 'Bills', 'Gross Sales', 'Returns', 'Net Sales', 'Discount', 'GST', 'Gross Profit', 'Margin %'];
    const rows = data.daywise.map((d) => [
      d.date,
      d.billsCount,
      (d.grossSalesMinor / 100).toFixed(2),
      (d.returnsMinor / 100).toFixed(2),
      (d.netSalesMinor / 100).toFixed(2),
      (d.discountMinor / 100).toFixed(2),
      (d.gstMinor / 100).toFixed(2),
      (d.grossProfitMinor / 100).toFixed(2),
      `${d.marginPct}%`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].map((e) => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Daywise_Sales_${data.filters.from}_${data.filters.to}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Handle Print Action
  const handlePrint = () => {
    window.print();
  };

  // Send WhatsApp Schedule report demonstration
  const handleSendScheduleReport = () => {
    if (!schedulePhone.trim()) return;
    setScheduleSent(true);
    setTimeout(() => {
      setShowScheduleModal(false);
      setScheduleSent(false);
      showToast?.(`Daily sales report scheduled to WhatsApp +91 ${schedulePhone} at 10:00 PM`);
    }, 1200);
  };

  // Sorted daywise rows
  const sortedDaywiseRows = useMemo(() => {
    if (!data?.daywise) return [];
    return [...data.daywise].sort((a, b) => {
      let va: any = a[sortField];
      let vb: any = b[sortField];
      if (sortField === 'date') {
        return sortAsc ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
      }
      va = Number(va ?? 0);
      vb = Number(vb ?? 0);
      return sortAsc ? va - vb : vb - va;
    });
  }, [data?.daywise, sortField, sortAsc]);

  const svgRef = useRef<SVGSVGElement | null>(null);

  // 1. Prepare display series (if range > 45 days, group by week)
  const displaySeries = useMemo((): (SalesOverviewPoint & { label: string; isWeek?: boolean })[] => {
    const raw = data?.series || [];
    if (raw.length === 0) return [];

    if (raw.length <= 45) {
      return raw.map((p) => ({
        ...p,
        label: formatDMMM(p.date),
        isWeek: false,
      }));
    }

    const weeks: (SalesOverviewPoint & { isWeek?: boolean })[] = [];
    const chunkSize = 7;
    for (let i = 0; i < raw.length; i += chunkSize) {
      const chunk = raw.slice(i, i + chunkSize);
      const startPt = chunk[0];
      const totalSales = chunk.reduce((sum, p) => sum + p.salesMinor, 0);
      const totalBills = chunk.reduce((sum, p) => sum + p.billsCount, 0);
      const totalProfit = chunk.reduce((sum, p) => sum + p.grossProfitMinor, 0);
      const avgBill = totalBills > 0 ? Math.round(totalSales / totalBills) : 0;

      weeks.push({
        date: startPt.date,
        label: `Week of ${formatDMMM(startPt.date)}`,
        weekday: '',
        salesMinor: totalSales,
        billsCount: totalBills,
        grossProfitMinor: totalProfit,
        avgBillMinor: avgBill,
        isWeek: true,
      });
    }
    return weeks;
  }, [data?.series]);

  // 2. Check if all data in period is 0 (empty state)
  const isChartEmpty = useMemo(() => {
    if (!data?.series || data.series.length === 0) return true;
    return data.series.every((p) => p.billsCount === 0 && p.salesMinor === 0);
  }, [data?.series]);

  // 3. Metric value extractor (avg_bill on 0 bills returns null for gap)
  const getMetricVal = useCallback(
    (p: SalesOverviewPoint): number | null => {
      if (chartMetric === 'sales') return p.salesMinor;
      if (chartMetric === 'bills') return p.billsCount;
      if (chartMetric === 'profit') return p.grossProfitMinor;
      return p.billsCount > 0 ? p.avgBillMinor : null;
    },
    [chartMetric],
  );

  // 4. Calculate nice Y-axis ticks with ~15% headroom
  const chartTicks = useMemo(() => {
    const isCount = chartMetric === 'bills';
    if (displaySeries.length === 0) {
      return getNiceTicks(0, isCount);
    }
    const nonNullVals = displaySeries
      .map(getMetricVal)
      .filter((v): v is number => v !== null && v > 0);
    const rawMax = nonNullVals.length > 0 ? Math.max(...nonNullVals) : 0;
    return getNiceTicks(rawMax, isCount);
  }, [displaySeries, chartMetric, getMetricVal]);

  // 5. Chart layout dimensions
  const svgWidth = 920;
  const svgHeight = 280;
  const paddingLeft = 65;
  const paddingRight = 24;
  const paddingTop = 24;
  const paddingBottom = 42;
  const plotWidth = svgWidth - paddingLeft - paddingRight;
  const plotHeight = svgHeight - paddingTop - paddingBottom;
  const baselineY = paddingTop + plotHeight;

  // 6. Compute SVG coordinates for each point
  const computedChartPoints = useMemo(() => {
    if (displaySeries.length === 0) return [];
    const count = displaySeries.length;
    const step = count > 1 ? plotWidth / (count - 1) : plotWidth;

    return displaySeries.map((pt, idx) => {
      const val = getMetricVal(pt);
      const x = paddingLeft + (count === 1 ? plotWidth / 2 : idx * step);
      const y =
        val === null
          ? baselineY
          : paddingTop + plotHeight - (Math.max(0, val) / chartTicks.maxValue) * plotHeight;
      return { pt, x, y, val };
    });
  }, [displaySeries, getMetricVal, plotWidth, plotHeight, paddingLeft, paddingTop, baselineY, chartTicks.maxValue]);

  // 7. Compute Monotone Spline Paths & Area Segments (with gaps for null values)
  const lineSegments = useMemo(() => {
    if (computedChartPoints.length === 0) return [];

    const segments: {
      points: { x: number; y: number }[];
      linePath: string;
      areaPath: string;
    }[] = [];

    let currentSeg: { x: number; y: number }[] = [];

    for (const pt of computedChartPoints) {
      if (pt.val !== null) {
        currentSeg.push({ x: pt.x, y: pt.y });
      } else {
        if (currentSeg.length > 0) {
          const lPath = buildMonotoneCubicPath(currentSeg);
          const aPath =
            currentSeg.length > 1
              ? `${lPath} L ${currentSeg[currentSeg.length - 1].x.toFixed(1)} ${baselineY} L ${currentSeg[0].x.toFixed(1)} ${baselineY} Z`
              : '';
          segments.push({ points: currentSeg, linePath: lPath, areaPath: aPath });
          currentSeg = [];
        }
      }
    }

    if (currentSeg.length > 0) {
      const lPath = buildMonotoneCubicPath(currentSeg);
      const aPath =
        currentSeg.length > 1
          ? `${lPath} L ${currentSeg[currentSeg.length - 1].x.toFixed(1)} ${baselineY} L ${currentSeg[0].x.toFixed(1)} ${baselineY} Z`
          : '';
      segments.push({ points: currentSeg, linePath: lPath, areaPath: aPath });
    }

    return segments;
  }, [computedChartPoints, baselineY]);

  // 8. X-axis tick indices (5–7 evenly spaced, always including first and last)
  const xLabelIndices = useMemo(() => {
    const total = displaySeries.length;
    if (total === 0) return new Set<number>();
    if (total <= 7) {
      return new Set(Array.from({ length: total }, (_, i) => i));
    }
    const targetCount = displaySeries[0]?.isWeek ? 5 : 6;
    const step = (total - 1) / (targetCount - 1);
    const indices = new Set<number>();
    for (let i = 0; i < targetCount; i++) {
      indices.add(Math.round(i * step));
    }
    indices.add(0);
    indices.add(total - 1);
    return indices;
  }, [displaySeries]);

  // 9. Chart Header text details
  const headerDetails = useMemo(() => {
    if (!data?.filters) {
      return {
        dateRange: '',
        periodTotal: '',
        changeText: '',
        changeStatus: 'neutral' as 'positive' | 'negative' | 'neutral',
      };
    }

    const dateRange = `${formatDMMMYYYY(data.filters.from)} – ${formatDMMMYYYY(data.filters.to)}`;

    let periodTotal = '';
    if (chartMetric === 'sales') {
      periodTotal = `${formatCompactRupees(data.summary.netSalesMinor)} sales`;
    } else if (chartMetric === 'bills') {
      periodTotal = `${data.summary.billsCount} bills`;
    } else if (chartMetric === 'profit') {
      periodTotal = `${formatCompactRupees(data.summary.grossProfitMinor)} profit`;
    } else {
      periodTotal = `${formatRupees(data.summary.avgBillValueMinor)} avg bill`;
    }

    let changeText = '';
    let changeStatus: 'positive' | 'negative' | 'neutral' = 'neutral';

    if (data.comparison && data.comparison.hasComparison) {
      let periodLabel = data.comparison.periodLabel || 'previous 30 days';
      if (periodLabel.startsWith('prev. ')) {
        periodLabel = periodLabel.replace('prev. ', 'previous ');
      }

      const prevBills = data.comparison.summary?.billsCount ?? 0;
      if (prevBills === 0) {
        changeText = 'No bills in the previous period';
        changeStatus = 'neutral';
      } else {
        let curVal = 0;
        let prevVal = 0;
        if (chartMetric === 'sales') {
          curVal = data.summary.netSalesMinor;
          prevVal = data.comparison.summary.netSalesMinor;
        } else if (chartMetric === 'bills') {
          curVal = data.summary.billsCount;
          prevVal = data.comparison.summary.billsCount;
        } else if (chartMetric === 'profit') {
          curVal = data.summary.grossProfitMinor;
          prevVal = data.comparison.summary.grossProfitMinor;
        } else {
          curVal = data.summary.avgBillValueMinor;
          prevVal = data.comparison.summary.avgBillValueMinor;
        }

        if (prevVal === 0) {
          changeText = 'No bills in the previous period';
          changeStatus = 'neutral';
        } else {
          const pct = ((curVal - prevVal) / prevVal) * 100;
          if (Math.abs(pct) < 0.05) {
            changeText = `No change vs ${periodLabel}`;
            changeStatus = 'neutral';
          } else if (pct > 0) {
            changeStatus = 'positive';
            const displayPct = pct > 999 ? '999%+' : `${pct.toFixed(1)}%`;
            changeText = `▲ ${displayPct} vs ${periodLabel}`;
          } else {
            changeStatus = 'negative';
            const absPct = Math.abs(pct);
            const displayPct = absPct > 999 ? '999%+' : `${absPct.toFixed(1)}%`;
            changeText = `▼ ${displayPct} vs ${periodLabel}`;
          }
        }
      }
    }

    return { dateRange, periodTotal, changeText, changeStatus };
  }, [data, chartMetric]);

  // 10. Pointer interaction handler (mouse & touch)
  const handleChartPointerMove = useCallback(
    (e: React.MouseEvent<SVGRectElement> | React.TouchEvent<SVGRectElement>) => {
      if (!svgRef.current || computedChartPoints.length === 0) return;
      const rect = svgRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const relX = ((clientX - rect.left) / rect.width) * svgWidth;

      let closest = computedChartPoints[0];
      let minDiff = Math.abs(closest.x - relX);
      for (let i = 1; i < computedChartPoints.length; i++) {
        const diff = Math.abs(computedChartPoints[i].x - relX);
        if (diff < minDiff) {
          minDiff = diff;
          closest = computedChartPoints[i];
        }
      }
      setHoveredPoint(closest);
    },
    [computedChartPoints, svgWidth],
  );

  // 11. Tooltip formatted strings and positioning
  const tooltipDateStr = useMemo(() => {
    if (!hoveredPoint) return '';
    if (hoveredPoint.pt.isWeek) {
      return `Week of ${formatDMMMYYYY(hoveredPoint.pt.date)}`;
    }
    const parts = hoveredPoint.pt.date.split('-');
    const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const d = new Date(hoveredPoint.pt.date + 'T12:00:00Z');
    const weekday = WEEKDAYS[d.getUTCDay()] || hoveredPoint.pt.weekday || '';
    if (parts.length === 3) {
      const day = parseInt(parts[2], 10);
      const month = MONTHS_SHORT[parseInt(parts[1], 10) - 1] || '';
      const year = parts[0];
      return `${weekday}, ${day} ${month} ${year}`;
    }
    return hoveredPoint.pt.date;
  }, [hoveredPoint]);

  const tooltipPrimaryVal = useMemo(() => {
    if (!hoveredPoint) return '';
    if (chartMetric === 'bills') return `${hoveredPoint.pt.billsCount} bills`;
    if (chartMetric === 'sales') return formatRupees(hoveredPoint.pt.salesMinor);
    if (chartMetric === 'profit') return formatRupees(hoveredPoint.pt.grossProfitMinor);
    return hoveredPoint.pt.billsCount > 0 ? formatRupees(hoveredPoint.pt.avgBillMinor) : 'No bills';
  }, [hoveredPoint, chartMetric]);

  const tooltipSecondaryVal = useMemo(() => {
    if (!hoveredPoint) return '';
    if (chartMetric === 'bills') {
      return `${formatRupees(hoveredPoint.pt.salesMinor)} sales · ${formatRupees(hoveredPoint.pt.grossProfitMinor)} profit`;
    }
    if (chartMetric === 'sales') {
      return `${hoveredPoint.pt.billsCount} bills · ${formatRupees(hoveredPoint.pt.grossProfitMinor)} profit`;
    }
    if (chartMetric === 'profit') {
      return `${formatRupees(hoveredPoint.pt.salesMinor)} sales · ${hoveredPoint.pt.billsCount} bills`;
    }
    return `${formatRupees(hoveredPoint.pt.salesMinor)} sales · ${hoveredPoint.pt.billsCount} bills`;
  }, [hoveredPoint, chartMetric]);

  const tooltipStyle = useMemo<React.CSSProperties>(() => {
    if (!hoveredPoint) return {};
    const xRatio = hoveredPoint.x / svgWidth;
    const isNearRight = xRatio > 0.68;
    const isNearLeft = xRatio < 0.22;

    let transform = 'translate(-50%, calc(-100% - 14px))';
    if (isNearRight) {
      transform = 'translate(calc(-100% - 14px), -50%)';
    } else if (isNearLeft) {
      transform = 'translate(14px, -50%)';
    }

    const topClamped = Math.max(16, Math.min(hoveredPoint.y, svgHeight - 80));

    return {
      left: `${(hoveredPoint.x / svgWidth) * 100}%`,
      top: `${(topClamped / svgHeight) * 100}%`,
      transform,
    };
  }, [hoveredPoint, svgWidth, svgHeight]);

  return (
    <div className="sales-analysis-container">
      {/* 1. PAGE HEADER CARD */}
      <div className="card sales-header-card">
        <div className="sales-header-top">
          <div className="sales-header-title-row">
            <span className="sales-module-icon">💰</span>
            <h1 className="sales-module-title">Sales Analysis</h1>
            <span className="badge-live-pulse" title="Live transactions synced directly from cashier registers">
              <span className="pulse-dot-green"></span>
              Live from billing
            </span>
          </div>

          <div className="sales-header-actions">
            <button
              type="button"
              className="btn btn-secondary sales-action-btn"
              onClick={handleExportFullReport}
              disabled={loading || !data}
              title="Export complete sales analysis summary and table to CSV"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>Export Report</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary sales-action-btn"
              onClick={handlePrint}
              disabled={loading || !data}
              title="Print clean Sales Analysis document"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9"></polyline>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                <rect x="6" y="14" width="12" height="8"></rect>
              </svg>
              <span>Print</span>
            </button>

            <button
              type="button"
              className="btn btn-primary sales-schedule-btn"
              onClick={() => setShowScheduleModal(true)}
              title="Schedule automated daily sales digest to shop owner's WhatsApp"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
              <span>Schedule Daily Report</span>
            </button>
          </div>
        </div>

        <div className="sales-header-subtitle">
          Sales, profit, payment modes, peak hours, customers and cashiers · completed bills only, returns and cancelled bills handled per your business rules
        </div>
      </div>

      {/* 2. FILTERS BAR */}
      <div className="card sales-filter-bar">
        <div className="sales-filter-left">
          {/* Counter Dropdown */}
          <div className="sales-select-wrap">
            <select
              className="form-select sales-filter-select"
              value={selectedCounter}
              onChange={(e) => setSelectedCounter(e.target.value)}
              aria-label="Filter by register counter"
            >
              {data?.filterOptions.counters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              )) || <option value="ALL">All counters</option>}
            </select>
          </div>

          {/* Category Dropdown */}
          <div className="sales-select-wrap">
            <select
              className="form-select sales-filter-select"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              aria-label="Filter by product category"
            >
              <option value="ALL">All categories</option>
              {data?.filterOptions.categories
                .filter((cat) => cat !== 'All categories')
                .map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
            </select>
          </div>

          {/* Cashier Dropdown */}
          <div className="sales-select-wrap">
            <select
              className="form-select sales-filter-select"
              value={selectedCashier}
              onChange={(e) => setSelectedCashier(e.target.value)}
              aria-label="Filter by billing cashier"
            >
              <option value="ALL">All cashiers</option>
              {data?.filterOptions.cashiers
                .filter((u) => u.id !== 'ALL')
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div className="sales-filter-right">
          {/* Date Range Pills */}
          <div className="sales-pills-group" role="tablist">
            <button
              type="button"
              className={`sales-pill-btn ${datePreset === 'today' ? 'active' : ''}`}
              onClick={() => setDatePreset('today')}
            >
              Today
            </button>
            <button
              type="button"
              className={`sales-pill-btn ${datePreset === '7d' ? 'active' : ''}`}
              onClick={() => setDatePreset('7d')}
            >
              Last 7 Days
            </button>
            <button
              type="button"
              className={`sales-pill-btn ${datePreset === '30d' ? 'active' : ''}`}
              onClick={() => setDatePreset('30d')}
            >
              Last 30 Days
            </button>
            <button
              type="button"
              className={`sales-pill-btn ${datePreset === 'this_month' ? 'active' : ''}`}
              onClick={() => setDatePreset('this_month')}
            >
              This Month
            </button>
            <button
              type="button"
              className={`sales-pill-btn ${datePreset === '90d' ? 'active' : ''}`}
              onClick={() => setDatePreset('90d')}
            >
              Last 90 Days
            </button>
            <button
              type="button"
              className={`sales-pill-btn custom-pill ${datePreset === 'custom' ? 'active' : ''}`}
              onClick={openCustomDateModal}
            >
              <span>📅</span>
              <span>{datePreset === 'custom' && customFrom && customTo ? `${formatDMMM(customFrom)} – ${formatDMMM(customTo)}` : 'Custom'}</span>
            </button>
          </div>

          {/* Compare Period Dropdown */}
          <div className="sales-compare-wrap">
            <select
              className="form-select sales-compare-select"
              value={comparePreset}
              onChange={(e) => setComparePreset(e.target.value as ComparePreset)}
              aria-label="Comparison period"
            >
              <option value="previous_period">Compare: Previous period</option>
              <option value="same_period_last_month">Compare: Same period last month</option>
              <option value="none">Compare: None</option>
            </select>
          </div>
        </div>
      </div>

      {/* ERROR STATE */}
      {error && (
        <div className="card sales-error-card">
          <div className="error-icon">⚠️</div>
          <div className="error-details">
            <strong>Unable to load sales analysis</strong>
            <p>{error}</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={loadAnalysis}>
            Retry
          </button>
        </div>
      )}

      {/* LOADING SKELETON */}
      {loading && !data && (
        <div className="sales-loading-skeleton">
          <div className="kpi-grid-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="sales-kpi-card skeleton-card">
                <div className="skeleton-line" style={{ width: '40%', height: '12px' }}></div>
                <div className="skeleton-line" style={{ width: '70%', height: '24px', margin: '12px 0' }}></div>
                <div className="skeleton-line" style={{ width: '50%', height: '12px' }}></div>
              </div>
            ))}
          </div>
          <div className="card" style={{ height: '320px', marginTop: '1.25rem', opacity: 0.6 }}></div>
        </div>
      )}

      {/* MAIN CONTENT WHEN LOADED */}
      {data && (
        <>
          {/* 3. 6 SUMMARY CARDS */}
          <div className="sales-kpi-grid-6">
            {/* Card 1: NET SALES */}
            <div className="sales-kpi-card border-top-purple">
              <div className="kpi-header-row">
                <span className="kpi-label">NET SALES</span>
              </div>
              <div className="kpi-value-main text-purple mono">
                {formatRupees(data.summary.netSalesMinor)}
              </div>
              <div className="kpi-diff-row">
                {data.comparison?.diff ? (
                  <span className={`diff-tag ${data.comparison.diff.netSalesChangePct >= 0 ? 'positive' : 'negative'}`}>
                    {data.comparison.diff.netSalesChangePct >= 0 ? '▲' : '▼'} {Math.abs(data.comparison.diff.netSalesChangePct)}%
                    <span className="diff-sub">vs {data.comparison.periodLabel}</span>
                  </span>
                ) : (
                  <span className="diff-sub">Bill totals minus returns</span>
                )}
              </div>
            </div>

            {/* Card 2: BILLS */}
            <div className="sales-kpi-card border-top-blue">
              <div className="kpi-header-row">
                <span className="kpi-label">BILLS</span>
              </div>
              <div className="kpi-value-main mono">
                {data.summary.billsCount.toLocaleString('en-IN')}
              </div>
              <div className="kpi-diff-row">
                {data.comparison?.diff ? (
                  <span className={`diff-tag ${data.comparison.diff.billsCountChangePct >= 0 ? 'positive' : 'negative'}`}>
                    {data.comparison.diff.billsCountChangePct >= 0 ? '▲' : '▼'} {Math.abs(data.comparison.diff.billsCountChangePct)}%
                    <span className="diff-sub">• {data.summary.avgBillsPerDay} / day</span>
                  </span>
                ) : (
                  <span className="diff-sub">{data.summary.avgBillsPerDay} bills / day</span>
                )}
              </div>
            </div>

            {/* Card 3: AVG BILL VALUE */}
            <div className="sales-kpi-card border-top-cyan">
              <div className="kpi-header-row">
                <span className="kpi-label">AVG BILL VALUE</span>
              </div>
              <div className="kpi-value-main mono">
                {formatRupees(data.summary.avgBillValueMinor, true)}
              </div>
              <div className="kpi-diff-row">
                {data.comparison?.diff ? (
                  <span className={`diff-tag ${data.comparison.diff.avgBillChangePct >= 0 ? 'positive' : 'negative'}`}>
                    {data.comparison.diff.avgBillChangePct >= 0 ? '▲' : '▼'} {Math.abs(data.comparison.diff.avgBillChangePct)}%
                  </span>
                ) : (
                  <span className="diff-sub">Net sales ÷ bills</span>
                )}
              </div>
            </div>

            {/* Card 4: GROSS PROFIT */}
            <div className="sales-kpi-card border-top-emerald">
              <div className="kpi-header-row">
                <span className="kpi-label">GROSS PROFIT</span>
              </div>
              <div className="kpi-value-main text-emerald mono">
                {formatRupees(data.summary.grossProfitMinor)}
              </div>
              <div className="kpi-diff-row">
                <span className="diff-sub">
                  <strong>{data.summary.marginPct}% margin</strong>
                  {data.comparison?.diff && (
                    <span className={`diff-tag-inline ${data.comparison.diff.marginPointDiff >= 0 ? 'positive' : 'negative'}`}>
                      • {data.comparison.diff.marginPointDiff >= 0 ? '▲' : '▼'} {Math.abs(data.comparison.diff.marginPointDiff)} pt
                    </span>
                  )}
                </span>
              </div>
            </div>

            {/* Card 5: RETURNS */}
            <div className="sales-kpi-card border-top-red">
              <div className="kpi-header-row">
                <span className="kpi-label">RETURNS</span>
              </div>
              <div className="kpi-value-main text-red mono">
                {formatRupees(data.summary.returnsMinor)}
              </div>
              <div className="kpi-diff-row">
                <span className="diff-sub">
                  {data.summary.returnsCount} credit note{data.summary.returnsCount === 1 ? '' : 's'} • {data.summary.returnRatePct}%
                </span>
              </div>
            </div>

            {/* Card 6: GST COLLECTED */}
            <div className="sales-kpi-card border-top-amber">
              <div className="kpi-header-row">
                <span className="kpi-label">GST COLLECTED</span>
              </div>
              <div className="kpi-value-main mono">
                {formatRupees(data.summary.totalGstMinor)}
              </div>
              <div className="kpi-diff-row">
                <span className="diff-sub">
                  CGST {formatRupees(data.summary.cgstMinor)} • SGST {formatRupees(data.summary.sgstMinor)}
                  {data.summary.igstMinor > 0 && ` • IGST ${formatRupees(data.summary.igstMinor)}`}
                </span>
              </div>
            </div>
          </div>

          {/* 4. SALES OVERVIEW CHART (FULL WIDTH) */}
          <div className="card sales-overview-card">
            <div className="sales-chart-header">
              <div className="sales-chart-title-area">
                <h2 className="sales-chart-heading">Sales Overview</h2>
                <div className="sales-chart-sub">
                  <span>{headerDetails.dateRange}</span>
                  <span className="sub-sep">·</span>
                  <span>{headerDetails.periodTotal}</span>
                  {headerDetails.changeText && (
                    <>
                      <span className="sub-sep">·</span>
                      <span className={`chart-change-indicator ${headerDetails.changeStatus}`}>
                        {headerDetails.changeText}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Segmented Metric Toggle */}
              <div className="sales-metric-toggle" role="tablist" aria-label="Sales Overview Metric">
                <button
                  type="button"
                  role="tab"
                  aria-selected={chartMetric === 'bills'}
                  className={`metric-toggle-btn ${chartMetric === 'bills' ? 'active' : ''}`}
                  onClick={() => setChartMetric('bills')}
                >
                  Bills
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={chartMetric === 'sales'}
                  className={`metric-toggle-btn ${chartMetric === 'sales' ? 'active' : ''}`}
                  onClick={() => setChartMetric('sales')}
                >
                  Sales
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={chartMetric === 'profit'}
                  className={`metric-toggle-btn ${chartMetric === 'profit' ? 'active' : ''}`}
                  onClick={() => setChartMetric('profit')}
                >
                  Profit
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={chartMetric === 'avg_bill'}
                  className={`metric-toggle-btn ${chartMetric === 'avg_bill' ? 'active' : ''}`}
                  onClick={() => setChartMetric('avg_bill')}
                >
                  Avg Bill
                </button>
              </div>
            </div>

            {/* SVG Interactive Chart Canvas */}
            <div className="sales-chart-canvas-wrap">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                className="sales-svg-chart"
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient id="purpleAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6d4aff" stopOpacity="0.22" />
                    <stop offset="85%" stopColor="#6d4aff" stopOpacity="0.03" />
                    <stop offset="100%" stopColor="#6d4aff" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Horizontal Grid lines and Y-axis Labels */}
                {chartTicks.ticks.map((val, idx) => {
                  const y = paddingTop + plotHeight - (val / chartTicks.maxValue) * plotHeight;
                  const label = chartMetric === 'bills' ? String(val) : formatCompactRupees(val);
                  const isBaseline = val === 0;

                  return (
                    <g key={idx}>
                      <line
                        x1={paddingLeft}
                        y1={y}
                        x2={svgWidth - paddingRight}
                        y2={y}
                        stroke={isBaseline ? '#e2e8f0' : '#eef0f6'}
                        strokeWidth={isBaseline ? '1.25' : '1'}
                      />
                      <text
                        x={paddingLeft - 10}
                        y={y + 3.5}
                        textAnchor="end"
                        fontSize="11"
                        fill="#94a3b8"
                        fontFamily="inherit"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}

                {/* Gradient area under curves (only if not empty) */}
                {!isChartEmpty &&
                  lineSegments.map(
                    (seg, sIdx) =>
                      seg.areaPath && (
                        <path
                          key={`area-${sIdx}`}
                          d={seg.areaPath}
                          fill="url(#purpleAreaGrad)"
                          className="chart-smooth-area"
                        />
                      ),
                  )}

                {/* Purple Chart Monotone Curves (only if not empty) */}
                {!isChartEmpty &&
                  lineSegments.map(
                    (seg, sIdx) =>
                      seg.linePath && (
                        <path
                          key={`line-${sIdx}`}
                          d={seg.linePath}
                          fill="none"
                          stroke="#6d4aff"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="chart-smooth-path"
                        />
                      ),
                  )}

                {/* Data point dots: small filled dots (3.5px) ONLY on days with value > 0 */}
                {!isChartEmpty &&
                  computedChartPoints.map((p, idx) => {
                    if (p.val === null || p.val <= 0) return null;
                    if (hoveredPoint?.pt.date === p.pt.date) return null;
                    return (
                      <circle
                        key={idx}
                        cx={p.x}
                        cy={p.y}
                        r="3.5"
                        fill="#6d4aff"
                        stroke="#ffffff"
                        strokeWidth="1.5"
                        className="chart-dot"
                      />
                    );
                  })}

                {/* Hover guideline and enlarged hovered dot */}
                {hoveredPoint && (
                  <>
                    <line
                      x1={hoveredPoint.x}
                      y1={paddingTop}
                      x2={hoveredPoint.x}
                      y2={baselineY}
                      stroke="#6d4aff"
                      strokeWidth="1.25"
                      strokeDasharray="3 3"
                      pointerEvents="none"
                    />
                    {hoveredPoint.val !== null && hoveredPoint.val > 0 && (
                      <circle
                        cx={hoveredPoint.x}
                        cy={hoveredPoint.y}
                        r="6"
                        fill="#6d4aff"
                        stroke="#ffffff"
                        strokeWidth="2.5"
                        pointerEvents="none"
                        className="chart-dot-hovered"
                      />
                    )}
                  </>
                )}

                {/* X-axis date labels: 5–7 evenly spaced, always including first and last */}
                {computedChartPoints.map((p, idx) => {
                  if (!xLabelIndices.has(idx)) return null;
                  const isFirst = idx === 0;
                  const isLast = idx === computedChartPoints.length - 1;

                  return (
                    <text
                      key={idx}
                      x={p.x}
                      y={svgHeight - 14}
                      textAnchor={isFirst ? 'start' : isLast ? 'end' : 'middle'}
                      fontSize="11"
                      fill="#94a3b8"
                      fontFamily="inherit"
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      {p.pt.label}
                    </text>
                  );
                })}

                {/* Transparent Interactive Overlay Rect for Mouse & Touch Scrubbing */}
                <rect
                  x={paddingLeft}
                  y={paddingTop}
                  width={plotWidth}
                  height={plotHeight}
                  fill="transparent"
                  style={{ cursor: 'crosshair', touchAction: 'none' }}
                  onMouseMove={handleChartPointerMove}
                  onTouchStart={handleChartPointerMove}
                  onTouchMove={handleChartPointerMove}
                  onMouseLeave={() => setHoveredPoint(null)}
                />
              </svg>

              {/* Centered Empty State when all values in range are 0 */}
              {isChartEmpty && (
                <div className="sales-chart-empty-state">
                  <span className="chart-empty-icon" aria-hidden="true">
                    📊
                  </span>
                  <p className="chart-empty-text">No completed bills in this period</p>
                </div>
              )}

              {/* Dark Rounded Tooltip Card */}
              {hoveredPoint && (
                <div
                  className="chart-dark-tooltip"
                  style={tooltipStyle}
                  role="tooltip"
                >
                  <div className="tooltip-date">{tooltipDateStr}</div>
                  <div className="tooltip-val">{tooltipPrimaryVal}</div>
                  <div className="tooltip-sub">{tooltipSecondaryVal}</div>
                </div>
              )}
            </div>
          </div>

          {/* 5. PANELS BELOW CHART (2-COLUMN GRID) */}
          <div className="sales-panels-grid">
            {/* LEFT COLUMN */}
            <div className="sales-panels-col">
              {/* Panel: Sales by Category */}
              <div className="card sales-panel-card">
                <div className="panel-card-header">
                  <div>
                    <h3 className="panel-title">Sales by Category</h3>
                    <div className="panel-subtitle">Share of net sales</div>
                  </div>
                  <button
                    type="button"
                    className="panel-details-link"
                    onClick={() => {
                      if (data.categories.length > 0) {
                        setSelectedCategory(data.categories[0].category);
                      }
                    }}
                  >
                    Details →
                  </button>
                </div>

                <div className="category-ranked-list">
                  {data.categories.map((cat, idx) => (
                    <div key={idx} className="category-rank-row">
                      <div className="cat-name-col">
                        <span className="cat-color-dot" style={{ backgroundColor: cat.color }}></span>
                        <span className="cat-name-text" title={cat.category}>{cat.category}</span>
                      </div>

                      <div className="cat-bar-col">
                        <div className="cat-progress-track">
                          <div
                            className="cat-progress-fill"
                            style={{
                              width: `${Math.min(100, Math.max(4, cat.sharePct))}%`,
                              backgroundColor: cat.color,
                            }}
                          ></div>
                        </div>
                      </div>

                      <div className="cat-sales-col mono">
                        {formatRupees(cat.netSalesMinor)}
                      </div>

                      <div className="cat-share-col mono">
                        {cat.sharePct}%
                      </div>
                    </div>
                  ))}

                  {data.categories.length === 0 && (
                    <div className="panel-empty-text">No category sales recorded in this period.</div>
                  )}
                </div>
              </div>

              {/* Panel: Busiest Days & Hours Heatmap */}
              <div className="card sales-panel-card">
                <div className="panel-card-header">
                  <div>
                    <h3 className="panel-title">Busiest Days & Hours</h3>
                    <div className="panel-subtitle">Average sales by weekday and hour</div>
                  </div>
                </div>

                <div className="heatmap-container">
                  {/* Hour Headers */}
                  <div className="heatmap-hours-row">
                    <div className="heatmap-weekday-spacer"></div>
                    {['8a', '10a', '12p', '2p', '4p', '6p', '8p'].map((hr, idx) => (
                      <div key={idx} className="heatmap-hour-header">
                        {hr}
                      </div>
                    ))}
                  </div>

                  {/* Weekday Rows (Mon .. Sun) */}
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dayName, rowIdx) => {
                    const rowCells = data.heatmap.matrix.filter((c) => c.weekdayName === dayName);

                    return (
                      <div key={rowIdx} className="heatmap-row">
                        <div className="heatmap-row-label">{dayName}</div>
                        <div className="heatmap-cells-track">
                          {rowCells.map((cell, cIdx) => {
                            const intensity =
                              data.heatmap.maxCellSalesMinor > 0
                                ? Math.min(1, Math.max(0.08, cell.salesMinor / data.heatmap.maxCellSalesMinor))
                                : 0.08;
                            const bgAlpha = cell.salesMinor > 0 ? 0.15 + intensity * 0.8 : 0.08;

                            return (
                              <div
                                key={cIdx}
                                className="heatmap-cell"
                                style={{
                                  backgroundColor: `rgba(109, 74, 255, ${bgAlpha.toFixed(2)})`,
                                }}
                                title={`${cell.weekdayName} ${cell.hourLabel}: ${cell.billsCount} bills, ${formatRupees(cell.salesMinor)}`}
                              ></div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  {/* Heatmap Legend */}
                  <div className="heatmap-footer-legend">
                    <span className="legend-label">Low</span>
                    <div className="heatmap-legend-bar"></div>
                    <span className="legend-label">High</span>
                    <span className="legend-dot">•</span>
                    <span className="legend-peak-text">
                      Peak: <strong>{data.heatmap.peakSlot}</strong>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN */}
            <div className="sales-panels-col">
              {/* Panel: Payment Modes */}
              <div className="card sales-panel-card">
                <div className="panel-card-header">
                  <div>
                    <h3 className="panel-title">Payment Modes</h3>
                    <div className="panel-subtitle">Share of net sales</div>
                  </div>
                </div>

                <div className="payment-modes-panel">
                  {/* Multi-segment stacked horizontal bar */}
                  <div className="payment-stacked-bar">
                    {data.payments.modes
                      .filter((m) => m.sharePct > 0)
                      .map((m, idx) => (
                        <div
                          key={idx}
                          className="payment-bar-segment"
                          style={{
                            width: `${m.sharePct}%`,
                            backgroundColor: m.color,
                          }}
                          title={`${m.label}: ${m.sharePct}% (${formatRupees(m.totalMinor)})`}
                        ></div>
                      ))}
                  </div>

                  {/* Legend row with percentages */}
                  <div className="payment-legend-row">
                    {data.payments.modes.map((m, idx) => (
                      <div key={idx} className="payment-legend-item">
                        <span className="payment-legend-dot" style={{ backgroundColor: m.color }}></span>
                        <span className="payment-legend-name">{m.label}</span>
                        <strong className="mono">{m.sharePct}%</strong>
                      </div>
                    ))}
                  </div>

                  {/* Small ₹ amount tiles below */}
                  <div className="payment-amount-tiles">
                    {data.payments.modes.map((m, idx) => (
                      <div key={idx} className="payment-amount-tile">
                        <div className="tile-label">{m.label}</div>
                        <div className="tile-val mono">{formatRupees(m.totalMinor)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Panel: Top Customers */}
              <div className="card sales-panel-card">
                <div className="panel-card-header">
                  <div>
                    <h3 className="panel-title">Top Customers</h3>
                    <div className="panel-subtitle">Named customers • by sales</div>
                  </div>
                </div>

                <div className="top-customers-list">
                  {data.topCustomers.map((cust, idx) => (
                    <div key={idx} className="top-customer-row">
                      <div className="customer-info-area">
                        <div className="customer-name-row">
                          <span className="customer-name">{cust.name}</span>
                        </div>
                        <div className="customer-meta-row">
                          <span className="customer-bill-count">{cust.billsCount} bills</span>
                          <span className="meta-sep">•</span>
                          {cust.isB2B ? (
                            <span className="badge-cust-b2b">B2B</span>
                          ) : (
                            <span className="badge-cust-retail">Retail</span>
                          )}
                        </div>
                      </div>

                      <div className="customer-sales-val mono">
                        {formatRupees(cust.netSalesMinor)}
                      </div>
                    </div>
                  ))}

                  {data.topCustomers.length === 0 && (
                    <div className="panel-empty-text">No named customer invoices recorded.</div>
                  )}
                </div>
              </div>

              {/* Panel: Data-Driven Insights */}
              <div className="card sales-panel-card">
                <div className="panel-card-header">
                  <div>
                    <h3 className="panel-title">Insights</h3>
                    <div className="panel-subtitle">Updated with the date range</div>
                  </div>
                </div>

                <div className="insights-stack">
                  {data.insights.map((ins) => (
                    <div key={ins.id} className={`insight-card theme-${ins.theme}`}>
                      <div className="insight-icon-area">{ins.icon}</div>
                      <div className="insight-body">
                        <div className="insight-title">{ins.title}</div>
                        <div className="insight-desc">{ins.description}</div>
                      </div>
                    </div>
                  ))}

                  {data.insights.length === 0 && (
                    <div className="panel-empty-text">More billing transactions needed to generate high-confidence insights.</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 6. DAYWISE SALES SUMMARY TABLE */}
          <div className="card sales-daywise-card">
            <div className="daywise-table-header">
              <div className="daywise-title-area">
                <h3 className="daywise-heading">Daywise Sales Summary</h3>
                <div className="daywise-sub">
                  Click a day to see its bills · change vs same weekday last week
                </div>
              </div>

              <div className="daywise-actions-area">
                {/* Group dropdown */}
                <div className="daywise-group-wrap">
                  <select
                    className="form-select daywise-group-select"
                    value={grouping}
                    onChange={(e) => setGrouping(e.target.value as GroupingPreset)}
                  >
                    <option value="day">Group: Day ▾</option>
                    <option value="week">Group: Week ▾</option>
                    <option value="month">Group: Month ▾</option>
                  </select>
                </div>

                {/* Export CSV button */}
                <button
                  type="button"
                  className="btn btn-secondary daywise-btn"
                  onClick={handleExportDaywiseCSV}
                  title="Export Daywise Sales Summary table to CSV"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                  <span>Export CSV</span>
                </button>

                {/* Print button */}
                <button
                  type="button"
                  className="btn btn-secondary daywise-btn"
                  onClick={handlePrint}
                  title="Print Sales Summary"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <polyline points="6 9 6 2 18 2 18 9"></polyline>
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                    <rect x="6" y="14" width="12" height="8"></rect>
                  </svg>
                  <span>Print</span>
                </button>
              </div>
            </div>

            {/* Responsive Table Wrap */}
            <div className="daywise-table-scroll">
              <table className="daywise-table">
                <thead>
                  <tr>
                    <th onClick={() => { setSortField('date'); setSortAsc(!sortAsc); }} className="sortable-th">
                      DATE {sortField === 'date' && (sortAsc ? '▲' : '▼')}
                    </th>
                    <th onClick={() => { setSortField('billsCount'); setSortAsc(!sortAsc); }} className="sortable-th col-num">
                      BILLS {sortField === 'billsCount' && (sortAsc ? '▲' : '▼')}
                    </th>
                    <th onClick={() => { setSortField('netSalesMinor'); setSortAsc(!sortAsc); }} className="sortable-th col-num active-sort">
                      NET SALES {sortField === 'netSalesMinor' && (sortAsc ? '▲' : '▼')}
                    </th>
                    <th onClick={() => { setSortField('returnsMinor'); setSortAsc(!sortAsc); }} className="sortable-th col-num">
                      RETURNS {sortField === 'returnsMinor' && (sortAsc ? '▲' : '▼')}
                    </th>
                    <th onClick={() => { setSortField('discountMinor'); setSortAsc(!sortAsc); }} className="sortable-th col-num">
                      DISCOUNT {sortField === 'discountMinor' && (sortAsc ? '▲' : '▼')}
                    </th>
                    <th onClick={() => { setSortField('gstMinor'); setSortAsc(!sortAsc); }} className="sortable-th col-num">
                      GST {sortField === 'gstMinor' && (sortAsc ? '▲' : '▼')}
                    </th>
                    <th onClick={() => { setSortField('grossProfitMinor'); setSortAsc(!sortAsc); }} className="sortable-th col-num">
                      GROSS PROFIT {sortField === 'grossProfitMinor' && (sortAsc ? '▲' : '▼')}
                    </th>
                    <th onClick={() => { setSortField('marginPct'); setSortAsc(!sortAsc); }} className="sortable-th col-num">
                      MARGIN % {sortField === 'marginPct' && (sortAsc ? '▲' : '▼')}
                    </th>
                    <th className="col-num">CHANGE</th>
                  </tr>
                </thead>

                <tbody>
                  {sortedDaywiseRows.map((row) => (
                    <tr
                      key={row.date}
                      className="daywise-clickable-row"
                      onClick={() => onNavigateToInvoices?.(row.date)}
                      title={`Click to view all bills issued on ${row.formattedDate}`}
                    >
                      <td className="col-date-text">{row.formattedDate}</td>
                      <td className="col-num mono">{row.billsCount}</td>
                      <td className="col-num mono text-purple font-bold">
                        {formatRupees(row.netSalesMinor)}
                      </td>
                      <td className="col-num mono text-red">
                        {row.returnsMinor > 0 ? formatRupees(row.returnsMinor) : '₹0'}
                      </td>
                      <td className="col-num mono text-muted">
                        {row.discountMinor > 0 ? formatRupees(row.discountMinor) : '₹0'}
                      </td>
                      <td className="col-num mono text-muted">
                        {formatRupees(row.gstMinor)}
                      </td>
                      <td className="col-num mono text-emerald font-bold">
                        {formatRupees(row.grossProfitMinor)}
                      </td>
                      <td className="col-num mono">{row.marginPct}%</td>
                      <td className="col-num mono">
                        {row.prevWeekSameDayChangePct !== null ? (
                          <span
                            className={`daywise-change-badge ${row.prevWeekSameDayChangePct >= 0 ? 'pos' : 'neg'}`}
                          >
                            {row.prevWeekSameDayChangePct >= 0 ? '▲' : '▼'}{' '}
                            {Math.abs(row.prevWeekSameDayChangePct)}%
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}

                  {sortedDaywiseRows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="table-empty-row">
                        No completed bills found in this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Table Footer */}
            <div className="daywise-table-footer">
              <div className="footer-left">
                Showing {sortedDaywiseRows.length} of {data.filters.rangeDays} days
              </div>
              <div className="footer-right">
                Net sales = bill totals − returns · excluding cancelled bills
              </div>
            </div>
          </div>

          {/* 7. CASHIER PERFORMANCE (OWNER / MANAGER ONLY) */}
          {(userRole === 'owner' || userRole === 'manager') && data.cashierPerformance && (
            <div className="card sales-cashier-card">
              <div className="cashier-card-header">
                <div>
                  <h3 className="cashier-heading">Cashier Performance</h3>
                  <div className="cashier-sub">By billing user • {data.filters.rangeDays} days</div>
                </div>
              </div>

              <div className="cashier-table-scroll">
                <table className="cashier-table">
                  <thead>
                    <tr>
                      <th>CASHIER</th>
                      <th className="col-num">SALES</th>
                      <th className="col-num">BILLS</th>
                      <th className="col-num">AVG BILL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cashierPerformance.rows.map((cashier) => (
                      <tr key={cashier.userId}>
                        <td>
                          <div className="cashier-name font-bold">{cashier.userName}</div>
                          <div className="cashier-counter text-muted">{cashier.counterName}</div>
                        </td>
                        <td className="col-num mono font-bold text-purple">
                          {formatRupees(cashier.salesMinor)}
                        </td>
                        <td className="col-num mono">{cashier.billsCount.toLocaleString('en-IN')}</td>
                        <td className="col-num mono">
                          {formatRupees(cashier.avgBillMinor)}
                        </td>
                      </tr>
                    ))}

                    {data.cashierPerformance.rows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="table-empty-row">
                          No cashier activity found for the selected filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Cashier Summary Strip */}
              <div className="cashier-summary-strip">
                <div className="strip-item">
                  <span className="strip-icon">📄</span>
                  <span>
                    Voided bills: <strong>{data.cashierPerformance.summaryStrip.voidedBillsCount}</strong> (
                    {formatRupees(data.cashierPerformance.summaryStrip.voidedTotalMinor)})
                  </span>
                </div>
                <span className="strip-divider">•</span>
                <div className="strip-item">
                  <span>Discounts given: <strong>{formatRupees(data.cashierPerformance.summaryStrip.discountsGivenMinor)}</strong></span>
                </div>
                <span className="strip-divider">•</span>
                <div className="strip-item">
                  <span>Bills on credit: <strong>{data.cashierPerformance.summaryStrip.billsOnCreditCount}</strong></span>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* CUSTOM DATE RANGE MODAL */}
      {showCustomModal && (
        <div className="modal-backdrop" onClick={() => setShowCustomModal(false)}>
          <div
            className="sales-custom-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="customDateModalTitle"
          >
            <div className="sales-modal-header">
              <div className="sales-modal-title-wrap">
                <div className="sales-modal-icon-badge">📅</div>
                <div>
                  <h3 id="customDateModalTitle" className="sales-modal-title">Select Custom Date Range</h3>
                  <p className="sales-modal-subtitle">Filter analytics for any custom billing period</p>
                </div>
              </div>
              <button
                type="button"
                className="sales-modal-close-btn"
                onClick={() => setShowCustomModal(false)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleApplyCustomRange}>
              <div className="sales-modal-body">
                {/* Quick Presets Row */}
                <div className="sales-modal-quick-presets">
                  <span className="quick-presets-label">Quick picks:</span>
                  <div className="quick-presets-list">
                    <button
                      type="button"
                      className="quick-chip-btn"
                      onClick={() => {
                        const today = getTodayKolkataYMD();
                        setModalFrom(addDaysYMD(today, -6));
                        setModalTo(today);
                      }}
                    >
                      Last 7D
                    </button>
                    <button
                      type="button"
                      className="quick-chip-btn"
                      onClick={() => {
                        const today = getTodayKolkataYMD();
                        setModalFrom(addDaysYMD(today, -13));
                        setModalTo(today);
                      }}
                    >
                      Last 14D
                    </button>
                    <button
                      type="button"
                      className="quick-chip-btn"
                      onClick={() => {
                        const today = getTodayKolkataYMD();
                        setModalFrom(addDaysYMD(today, -29));
                        setModalTo(today);
                      }}
                    >
                      Last 30D
                    </button>
                    <button
                      type="button"
                      className="quick-chip-btn"
                      onClick={() => {
                        const today = getTodayKolkataYMD();
                        setModalFrom(addDaysYMD(today, -59));
                        setModalTo(today);
                      }}
                    >
                      Last 60D
                    </button>
                    <button
                      type="button"
                      className="quick-chip-btn"
                      onClick={() => {
                        const today = getTodayKolkataYMD();
                        const parts = today.split('-');
                        setModalFrom(`${parts[0]}-${parts[1]}-01`);
                        setModalTo(today);
                      }}
                    >
                      This Month
                    </button>
                    <button
                      type="button"
                      className="quick-chip-btn"
                      onClick={() => {
                        const today = getTodayKolkataYMD();
                        const d = new Date(today + 'T12:00:00Z');
                        d.setUTCMonth(d.getUTCMonth() - 1);
                        const prevY = d.getUTCFullYear();
                        const prevM = String(d.getUTCMonth() + 1).padStart(2, '0');
                        const lastDay = new Date(Date.UTC(prevY, d.getUTCMonth() + 1, 0)).getUTCDate();
                        setModalFrom(`${prevY}-${prevM}-01`);
                        setModalTo(`${prevY}-${prevM}-${String(lastDay).padStart(2, '0')}`);
                      }}
                    >
                      Last Month
                    </button>
                  </div>
                </div>

                {/* Date Fields Grid */}
                <div className="sales-modal-dates-grid">
                  <div className="sales-date-input-wrap">
                    <label className="sales-date-label">
                      <span>From Date (Start)</span>
                    </label>
                    <input
                      type="date"
                      className="sales-date-field"
                      value={modalFrom}
                      onChange={(e) => setModalFrom(e.target.value)}
                      required
                    />
                  </div>

                  <div className="sales-date-input-wrap">
                    <label className="sales-date-label">
                      <span>To Date (End)</span>
                    </label>
                    <input
                      type="date"
                      className="sales-date-field"
                      value={modalTo}
                      onChange={(e) => setModalTo(e.target.value)}
                      required
                    />
                  </div>
                </div>

                {/* Selected Range Summary Box */}
                {modalFrom && modalTo && modalFrom <= modalTo ? (
                  <div className="sales-range-summary-box">
                    <span className="summary-box-icon">🗓️</span>
                    <div className="summary-box-content">
                      <span className="summary-days-count">{selectedRangeDays} days duration</span>
                      <span className="summary-date-sub">
                        {formatDMMMYYYY(modalFrom)} – {formatDMMMYYYY(modalTo)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="sales-range-error-box">
                    <span>⚠️ Invalid range: "From Date" cannot be after "To Date".</span>
                  </div>
                )}
              </div>

              <div className="sales-modal-footer">
                <button
                  type="button"
                  className="sales-modal-btn-cancel"
                  onClick={() => setShowCustomModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="sales-modal-btn-apply"
                  disabled={!modalFrom || !modalTo || modalFrom > modalTo}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  <span>Apply Date Range</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SCHEDULE DAILY REPORT MODAL */}
      {showScheduleModal && (
        <div className="modal-backdrop" onClick={() => setShowScheduleModal(false)}>
          <div
            className="sales-custom-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="scheduleModalTitle"
          >
            <div className="sales-modal-header">
              <div className="sales-modal-title-wrap">
                <div className="sales-modal-icon-badge" style={{ background: '#ecfdf5', color: '#10b981' }}>
                  📱
                </div>
                <div>
                  <h3 id="scheduleModalTitle" className="sales-modal-title">Schedule Daily Sales Report</h3>
                  <p className="sales-modal-subtitle">Automated WhatsApp closing digest at 10:00 PM</p>
                </div>
              </div>
              <button
                type="button"
                className="sales-modal-close-btn"
                onClick={() => setShowScheduleModal(false)}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>
            <div className="sales-modal-body">
              <p style={{ color: '#64748b', fontSize: '0.88rem', margin: '0 0 1.25rem 0', lineHeight: 1.55 }}>
                Receive a daily closing WhatsApp summary every evening at 10:00 PM containing Net Sales, Bills, Cash/UPI breakdown, Gross Profit and Returns.
              </p>
              <div className="sales-date-input-wrap">
                <label className="sales-date-label">
                  <span>WhatsApp Phone Number</span>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="badge badge-emerald" style={{ padding: '0.65rem 0.85rem', fontSize: '0.9rem', borderRadius: '10px' }}>
                    +91
                  </span>
                  <input
                    type="tel"
                    className="sales-date-field"
                    placeholder="98401 23456"
                    value={schedulePhone}
                    onChange={(e) => setSchedulePhone(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="sales-modal-footer">
              <button
                type="button"
                className="sales-modal-btn-cancel"
                onClick={() => setShowScheduleModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="sales-modal-btn-apply"
                onClick={handleSendScheduleReport}
                disabled={scheduleSent || !schedulePhone.trim()}
                style={{ background: '#10b981' }}
              >
                {scheduleSent ? 'Saving Schedule...' : 'Save & Enable WhatsApp Digest'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
