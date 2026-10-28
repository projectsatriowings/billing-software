import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  fetchTodayDashboard,
  type TodayDashboardData,
  type User,
  type Shop,
  type Shift,
  type CashMovement,
  type ShiftSummary,
} from '../../api.ts';
import { OpenShiftModal } from '../shifts/OpenShiftModal.tsx';
import { CashMovementModal } from '../shifts/CashMovementModal.tsx';
import { CloseShiftModal } from '../shifts/CloseShiftModal.tsx';

interface TodayDashboardViewProps {
  user: User;
  shop: Shop | null;
  onNavigateToPos: () => void;
  onNavigateToShifts: () => void;
  onNavigateToInventory: () => void;
  onNavigateToSalesAnalysis: () => void;
  onNavigateToPurchases: () => void;
  onOpenAddProductModal: () => void;
  showToast?: (msg: string) => void;
}

type ChartMetric = 'sales' | 'bills' | 'profit';

/** Indian number formatter with paise option */
function formatRupees(minor: number | undefined | null, includeDecimals = false): string {
  if (minor === undefined || minor === null || isNaN(minor)) return '₹0';
  const val = minor / 100;
  if (includeDecimals) {
    return '₹' + val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return '₹' + Math.round(val).toLocaleString('en-IN');
}

/** Compact Indian rupee formatter: ₹0, ₹3k, ₹50k, ₹1.2L, ₹1Cr */
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

/** Compute nice tick steps with ~15% headroom starting at 0 */
function getNiceTicks(
  rawMax: number,
  isCount: boolean,
): { maxValue: number; ticks: number[] } {
  if (rawMax <= 0) {
    if (isCount) {
      return { maxValue: 5, ticks: [0, 1, 2, 3, 4, 5] };
    }
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

/** Fritsch-Carlson monotone cubic spline interpolation path clamped never to dip below baseline */
function buildMonotoneCubicPath(points: { x: number; y: number }[], baselineY: number): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M ${points[0].x.toFixed(1)} ${Math.min(baselineY, points[0].y).toFixed(1)}`;
  if (n === 2) {
    const y0 = Math.min(baselineY, points[0].y).toFixed(1);
    const y1 = Math.min(baselineY, points[1].y).toFixed(1);
    return `M ${points[0].x.toFixed(1)} ${y0} L ${points[1].x.toFixed(1)} ${y1}`;
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

  let path = `M ${points[0].x.toFixed(1)} ${Math.min(baselineY, points[0].y).toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const cp1x = points[i].x + dx[i] / 3;
    const cp1y = Math.min(baselineY, points[i].y + (m[i] * dx[i]) / 3);
    const cp2x = points[i + 1].x - dx[i] / 3;
    const cp2y = Math.min(baselineY, points[i + 1].y - (m[i + 1] * dx[i]) / 3);
    const endY = Math.min(baselineY, points[i + 1].y);
    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${points[i + 1].x.toFixed(1)} ${endY.toFixed(1)}`;
  }

  return path;
}

export const TodayDashboardView: React.FC<TodayDashboardViewProps> = ({
  user,
  shop,
  onNavigateToPos,
  onNavigateToShifts,
  onNavigateToInventory,
  onNavigateToSalesAnalysis,
  onNavigateToPurchases,
  onOpenAddProductModal,
  showToast,
}) => {
  const [data, setData] = useState<TodayDashboardData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [chartMetric, setChartMetric] = useState<ChartMetric>('sales');
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);

  const [selectedBranchCode, setSelectedBranchCode] = useState<string>(
    user.assignedLocation || 'MAIN'
  );
  const selectedBranchCodeRef = useRef<string>(user.assignedLocation || 'MAIN');

  useEffect(() => {
    selectedBranchCodeRef.current = selectedBranchCode;
  }, [selectedBranchCode]);

  // Modals state for cashier shift actions
  const [showOpenShiftModal, setShowOpenShiftModal] = useState<boolean>(false);
  const [showCashMovementModal, setShowCashMovementModal] = useState<boolean>(false);
  const [showCloseShiftModal, setShowCloseShiftModal] = useState<boolean>(false);

  const isOwnerOrManager = ['owner', 'manager'].includes(user.role);
  const firstName = user.name ? user.name.split(' ')[0] : 'User';

  // Greeting by time of day
  const greeting = useMemo(() => {
    const hour = data?.nowKolkata?.hour ?? new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, [data?.nowKolkata?.hour]);

  // Load dashboard data
  const loadDashboard = useCallback(
    async (branchOrInitial?: string | boolean, isInitialParam = false) => {
      let branchToLoad: string = selectedBranchCodeRef.current;
      let isInitial = isInitialParam;

      if (typeof branchOrInitial === 'boolean') {
        isInitial = branchOrInitial;
      } else if (typeof branchOrInitial === 'string' && branchOrInitial.trim() !== '') {
        branchToLoad = branchOrInitial.trim();
      }

      if (isInitial) setLoading(true);
      setError(null);
      try {
        const res = await fetchTodayDashboard(branchToLoad);
        setData(res);
        if (res.selectedBranch?.code) {
          setSelectedBranchCode(res.selectedBranch.code);
          selectedBranchCodeRef.current = res.selectedBranch.code;
        }
      } catch (err: any) {
        console.error('Failed to load today dashboard:', err);
        if (isInitial) {
          setError(err.message || 'Failed to load dashboard data. Please try again.');
        }
      } finally {
        if (isInitial) setLoading(false);
      }
    },
    [],
  );

  const handleBranchChange = (newBranchCode: string) => {
    if (newBranchCode === selectedBranchCode) return;
    setSelectedBranchCode(newBranchCode);
    selectedBranchCodeRef.current = newBranchCode;
    // Prepare clean counter data for the selected branch to prevent cross-branch leakage
    setData((prev) => {
      if (!prev) return null;
      const targetBranch = prev.branches?.find(
        (b) => (b.code || '').toUpperCase() === newBranchCode.toUpperCase()
      );
      const targetCounters = targetBranch?.counters || [];
      const initialCounters = targetCounters.map((c, i) => {
        const m = c.trim().match(/^counter[_\-\s]*(\d+)$/i);
        const name = m ? `Counter ${m[1]}` : c.trim();
        return {
          id: `counter-${i + 1}`,
          code: c,
          name,
          amountMinor: 0,
          formattedAmount: '₹0',
        };
      });

      return {
        ...prev,
        countersToday: {
          title: 'Counters Today',
          subtitle: 'Collected from open till now',
          branchCode: newBranchCode,
          counters: initialCounters,
          totalMinor: 0,
          formattedTotal: '₹0',
        },
      };
    });
    loadDashboard(newBranchCode, true);
  };

  // Initial load
  useEffect(() => {
    loadDashboard(undefined, true);
  }, [loadDashboard]);

  // 60-second background refresh while tab is visible
  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) {
        loadDashboard(selectedBranchCodeRef.current, false);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [loadDashboard]);

  // Immediate refresh on bill completion event
  useEffect(() => {
    const onBillCompleted = () => {
      loadDashboard(selectedBranchCodeRef.current, false);
    };
    window.addEventListener('bill_completed', onBillCompleted);
    window.addEventListener('shift_status_changed', onBillCompleted);
    window.addEventListener('cash_movement_recorded', onBillCompleted);
    return () => {
      window.removeEventListener('bill_completed', onBillCompleted);
      window.removeEventListener('shift_status_changed', onBillCompleted);
      window.removeEventListener('cash_movement_recorded', onBillCompleted);
    };
  }, [loadDashboard]);

  // Chart setup
  const svgWidth = 920;
  const svgHeight = 290;
  const paddingLeft = 60;
  const paddingRight = 30;
  const paddingTop = 26;
  const paddingBottom = 42;
  const plotWidth = svgWidth - paddingLeft - paddingRight;
  const plotHeight = svgHeight - paddingTop - paddingBottom;
  const baselineY = paddingTop + plotHeight;

  const openingHour = data?.hourly.openingHour ?? 8;
  const closingHour = data?.hourly.closingHour ?? 21;
  const totalHoursSpan = closingHour - openingHour;

  const currentHour = data?.hourly.currentHour ?? 12;
  const currentMinute = data?.hourly.currentMinute ?? 0;
  const nowHourFrac = currentHour + currentMinute / 60;

  // Compute NOW marker x position
  const nowX = useMemo(() => {
    if (nowHourFrac <= openingHour) return paddingLeft;
    if (nowHourFrac >= closingHour) return paddingLeft + plotWidth;
    return paddingLeft + ((nowHourFrac - openingHour) / totalHoursSpan) * plotWidth;
  }, [nowHourFrac, openingHour, totalHoursSpan, paddingLeft, plotWidth, closingHour]);

  // Extract metric value for a given hour item
  const getMetricValue = useCallback(
    (
      item: { todaySalesMinor: number | null; todayBillsCount: number | null; todayProfitMinor: number | null },
      isComp = false,
      compItem?: {
        compSalesMinor?: number;
        compBillsCount?: number;
        compProfitMinor?: number;
        lastWeekSalesMinor?: number;
        lastWeekBillsCount?: number;
        lastWeekProfitMinor?: number;
      },
    ) => {
      if (isComp && compItem) {
        if (chartMetric === 'bills') return compItem.compBillsCount ?? compItem.lastWeekBillsCount ?? 0;
        if (chartMetric === 'profit') return compItem.compProfitMinor ?? compItem.lastWeekProfitMinor ?? 0;
        return compItem.compSalesMinor ?? compItem.lastWeekSalesMinor ?? 0;
      }
      if (chartMetric === 'bills') return item.todayBillsCount;
      if (chartMetric === 'profit') return item.todayProfitMinor;
      return item.todaySalesMinor;
    },
    [chartMetric],
  );

  // Y-axis ticks calculation
  const chartTicks = useMemo(() => {
    const isCount = chartMetric === 'bills';
    const series = data?.hourly.series || [];
    let maxVal = 0;

    for (const pt of series) {
      const tv = getMetricValue(pt);
      const cv = getMetricValue(pt, true, pt);
      if (tv !== null && tv > maxVal) maxVal = tv;
      if (cv !== null && cv > maxVal) maxVal = cv;
    }

    return getNiceTicks(maxVal, isCount);
  }, [data?.hourly.series, chartMetric, getMetricValue]);

  // SVG Coordinates for hourly series
  const seriesWithCoords = useMemo(() => {
    const series = data?.hourly.series || [];
    if (series.length === 0) return [];

    return series.map((pt, idx) => {
      const x = paddingLeft + ((pt.hour - openingHour) / totalHoursSpan) * plotWidth;
      const todayVal = getMetricValue(pt);
      const compVal = getMetricValue(pt, true, pt) ?? 0;

      const todayY =
        todayVal === null
          ? baselineY
          : paddingTop + plotHeight - (Math.max(0, todayVal) / chartTicks.maxValue) * plotHeight;

      const compY =
        paddingTop + plotHeight - (Math.max(0, compVal) / chartTicks.maxValue) * plotHeight;

      return {
        ...pt,
        idx,
        x,
        todayVal,
        todayY,
        compVal,
        compY,
        lastWeekVal: compVal,
        lastWeekY: compY,
      };
    });
  }, [data?.hourly.series, openingHour, totalHoursSpan, paddingLeft, plotWidth, paddingTop, plotHeight, baselineY, chartTicks.maxValue, getMetricValue]);

  // Today's curve points (up to current hour, plus extrapolated point to nowX)
  const todayCurvePoints = useMemo(() => {
    const pastOrCurrent = seriesWithCoords.filter((p) => p.isPastOrCurrent && p.todayVal !== null);
    if (pastOrCurrent.length === 0) return [];

    const pts = pastOrCurrent.map((p) => ({ x: p.x, y: p.todayY }));

    // If nowX is strictly past the last hour mark, smoothly continue to nowX
    const lastPt = pastOrCurrent[pastOrCurrent.length - 1];
    if (nowX > lastPt.x && nowHourFrac <= closingHour) {
      pts.push({ x: nowX, y: lastPt.todayY });
    }

    return pts;
  }, [seriesWithCoords, nowX, nowHourFrac, closingHour]);

  // Comparison day curve points (full day)
  const compCurvePoints = useMemo(() => {
    return seriesWithCoords.map((p) => ({ x: p.x, y: p.compY }));
  }, [seriesWithCoords]);

  // Monotone Paths
  const todayLinePath = useMemo(() => {
    return buildMonotoneCubicPath(todayCurvePoints, baselineY);
  }, [todayCurvePoints, baselineY]);

  const todayAreaPath = useMemo(() => {
    if (todayCurvePoints.length < 2 || !todayLinePath) return '';
    const firstX = todayCurvePoints[0].x.toFixed(1);
    const lastX = todayCurvePoints[todayCurvePoints.length - 1].x.toFixed(1);
    return `${todayLinePath} L ${lastX} ${baselineY} L ${firstX} ${baselineY} Z`;
  }, [todayCurvePoints, todayLinePath, baselineY]);

  const compLinePath = useMemo(() => {
    return buildMonotoneCubicPath(compCurvePoints, baselineY);
  }, [compCurvePoints, baselineY]);

  // Comparison peak point for annotation
  const compPeakPoint = useMemo(() => {
    if (seriesWithCoords.length === 0) return null;
    let peak = seriesWithCoords[0];
    for (const pt of seriesWithCoords) {
      if (pt.compVal > peak.compVal) {
        peak = pt;
      }
    }
    return peak;
  }, [seriesWithCoords]);

  const hasCompData = useMemo(() => {
    return seriesWithCoords.some((p) => p.compVal > 0);
  }, [seriesWithCoords]);

  // Busiest hour point for currently active metric
  const busiestCurrentMetricPoint = useMemo(() => {
    const pastOrCurrent = seriesWithCoords.filter(
      (p) => p.isPastOrCurrent && p.todayVal !== null && p.todayVal > 0,
    );
    if (pastOrCurrent.length === 0) return null;
    let maxPt = pastOrCurrent[0];
    for (const pt of pastOrCurrent) {
      if ((pt.todayVal ?? 0) > (maxPt.todayVal ?? 0)) {
        maxPt = pt;
      }
    }
    return maxPt;
  }, [seriesWithCoords]);

  // Dynamic subtitle for chart card based on selected metric
  const chartSubtitle = useMemo(() => {
    if (!data) return '';
    if (data.cards.bills.billsCount === 0) {
      if (chartMetric === 'bills') return 'No bills recorded today';
      if (chartMetric === 'profit') return 'No profit recorded today';
      return 'No sales recorded today';
    }

    const busyText = busiestCurrentMetricPoint ? ` · busiest hour ${busiestCurrentMetricPoint.hourRange}` : '';
    const rushText = data.hourly.isEveningRushAhead ? ' · evening rush still ahead' : '';

    if (chartMetric === 'bills') {
      return `${data.cards.bills.billsCount} ${data.cards.bills.billsCount === 1 ? 'bill' : 'bills'} so far${busyText}${rushText}`;
    }
    if (chartMetric === 'profit') {
      return `${formatRupees(data.cards.grossProfit.profitMinor)} profit so far${busyText}${rushText}`;
    }
    return `${formatRupees(data.cards.todaySales.netSalesMinor)} so far${busyText}${rushText}`;
  }, [data, chartMetric, busiestCurrentMetricPoint]);

  // Dynamic title for chart card
  const chartTitle = useMemo(() => {
    if (chartMetric === 'bills') return "Today's Bills by Hour";
    if (chartMetric === 'profit') return "Today's Gross Profit by Hour";
    return "Today's Sales by Hour";
  }, [chartMetric]);

  // Busiest hour index for default pinned tooltip
  const busiestIndex = useMemo(() => {
    if (!busiestCurrentMetricPoint) return 0;
    const idx = seriesWithCoords.findIndex((p) => p.hour === busiestCurrentMetricPoint.hour);
    return idx >= 0 ? idx : 0;
  }, [seriesWithCoords, busiestCurrentMetricPoint]);

  // Current active tooltip point (only when hovered)
  const activeTooltipPoint = useMemo(() => {
    if (hoveredPointIndex === null || seriesWithCoords.length === 0) return null;
    return seriesWithCoords[hoveredPointIndex] || null;
  }, [seriesWithCoords, hoveredPointIndex]);

  // Format tick labels on Y axis
  const formatYAxisTick = (val: number) => {
    if (chartMetric === 'bills') {
      return val.toString();
    }
    return formatCompactRupees(val);
  };

  // Handle open shift success
  const handleShiftOpened = (shift: Shift) => {
    setShowOpenShiftModal(false);
    showToast?.(`✓ Shift #${shift.shiftNumber || '1'} opened successfully`);
    window.dispatchEvent(new Event('shift_status_changed'));
    loadDashboard(false);
  };

  // Handle close shift success
  const handleShiftClosed = () => {
    setShowCloseShiftModal(false);
    showToast?.('✓ Shift closed and reconciled successfully');
    window.dispatchEvent(new Event('shift_status_changed'));
    loadDashboard(false);
  };

  // Handle cash movement success
  const handleCashMovementSuccess = (movement: CashMovement, updatedSummary?: ShiftSummary) => {
    setShowCashMovementModal(false);
    const mTypeLabel = movement.movementType === 'cash_in' ? 'In (+)' : 'Out (-)';
    const formattedAmt = ((movement.amountMinor || 0) / 100).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    showToast?.(`✓ Cash ${mTypeLabel} ₹${formattedAmt} recorded successfully`);
    if (updatedSummary) {
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          shiftDrawer: {
            ...prev.shiftDrawer,
            cashInMinor: updatedSummary.cashInMinor,
            cashOutMinor: updatedSummary.cashOutMinor,
            expectedCashMinor: updatedSummary.expectedCashMinor,
            activeShift: prev.shiftDrawer.activeShift
              ? {
                  ...prev.shiftDrawer.activeShift,
                  summary: updatedSummary,
                }
              : null,
          },
        };
      });
    }
    window.dispatchEvent(new Event('shift_status_changed'));
    window.dispatchEvent(new Event('cash_movement_recorded'));
    loadDashboard(false);
  };

  if (loading && !data) {
    return (
      <div className="today-dash-root">
        {/* Skeleton Header */}
        <div className="today-dash-header skeleton-loading">
          <div className="skeleton-row" style={{ height: '36px', width: '380px', marginBottom: '8px' }}></div>
          <div className="skeleton-row" style={{ height: '18px', width: '260px' }}></div>
        </div>

        {/* Skeleton KPI Cards */}
        <div className="today-kpi-grid">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="today-kpi-card skeleton-card">
              <div className="skeleton-line" style={{ width: '45%', height: '14px', marginBottom: '16px' }}></div>
              <div className="skeleton-line" style={{ width: '75%', height: '28px', marginBottom: '12px' }}></div>
              <div className="skeleton-line" style={{ width: '55%', height: '14px' }}></div>
            </div>
          ))}
        </div>

        {/* Skeleton Chart & Donut */}
        <div className="today-middle-grid">
          <div className="today-chart-card skeleton-card" style={{ height: '360px' }}></div>
          <div className="today-payment-card skeleton-card" style={{ height: '360px' }}></div>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="today-dash-root">
        <div className="today-error-card">
          <div className="error-icon">⚠️</div>
          <h3>Failed to load Today's Overview</h3>
          <p>{error}</p>
          <button className="btn btn-primary" onClick={() => loadDashboard(true)}>
            🔄 Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { cards, hourly, payments, topSellers, stockAttention, shiftDrawer, countersToday, nowKolkata } = data;
  const isBilledEmpty = cards.bills.billsCount === 0 && cards.todaySales.netSalesMinor === 0;

  return (
    <div className="today-dash-root">
      {/* 1. TOP HEADER (Greeting, Shop GSTIN, Shift Pill, Actions) */}
      <header className="today-dash-header">
        <div className="header-main-row">
          <div className="header-greeting-area">
            <h1 className="header-greeting-title">
              {greeting}, {firstName} 👋
            </h1>
            <div className="header-shop-subtitle">
              <span>{shop?.name || 'Shree Krishna Supermarket & Retail'}</span>
              <span className="dot-sep">·</span>
              <span className="mono">GSTIN {shop?.gstin || '33AAAAA0000A1Z5'}</span>
            </div>
          </div>

          <div className="header-actions-area">
            {/* Inward Purchase Button */}
            <button
              type="button"
              className="btn-dash-action"
              onClick={onNavigateToPurchases}
              title="Record supplier purchase invoice & inward goods"
            >
              <span className="btn-icon">📥</span>
              <span>Purchase Inward</span>
            </button>

            {/* Add Product Button */}
            <button
              type="button"
              className="btn-dash-action"
              onClick={onOpenAddProductModal}
              title="Add new item to catalog"
            >
              <span className="btn-icon">➕</span>
              <span>Add Product</span>
            </button>

            {/* Primary New Bill (F1) Button */}
            <button
              type="button"
              className="btn-dash-primary"
              onClick={onNavigateToPos}
              title="Open POS billing terminal (Hot key: F1)"
            >
              <span className="btn-icon">🧾</span>
              <span>New Bill (F1)</span>
            </button>
          </div>
        </div>

        {/* Subheader: Today pill & Branch Switcher */}
        <div className="header-meta-row">
          <div className="header-today-pill">
            <span className="pill-calendar-icon">📅</span>
            <span>Today · {nowKolkata.formattedDate}</span>
          </div>

          {data?.branches && data.branches.length > 1 && (
            <div className="dashboard-branch-selector">
              <span className="branch-selector-label">Branch:</span>
              <div className="branch-selector-pills">
                {data.branches.map((b) => {
                  const isActive = (selectedBranchCode || '').toUpperCase() === (b.code || '').toUpperCase();
                  return (
                    <button
                      key={b.id || b.code}
                      type="button"
                      className={`dashboard-branch-pill ${isActive ? 'active' : ''}`}
                      onClick={() => handleBranchChange(b.code)}
                      title={`Switch to ${b.name || b.code}`}
                    >
                      <span className="branch-icon">🏢</span>
                      <span>{b.name || b.code}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Empty State Banner if 0 bills today */}
      {isBilledEmpty && (
        <div className="today-empty-alert-banner">
          <div className="empty-alert-content">
            <span className="empty-alert-icon">✨</span>
            <div>
              <strong>No bills yet today</strong> — start billing from POS Counter to see live sales, hourly rush curves, and collections!
            </div>
          </div>
          <button type="button" className="btn-empty-start" onClick={onNavigateToPos}>
            <span>🛒 Go to POS Counter (F1)</span>
          </button>
        </div>
      )}

      {/* 2. SIX SUMMARY KPI CARDS */}
      <section className="today-kpi-grid">
        {/* CARD 1: TODAY'S SALES (Highlighted Purple Card) */}
        <div className="today-kpi-card purple-highlight">
          <div className="kpi-card-header">
            <span className="kpi-label">TODAY'S SALES</span>
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value mono">{formatRupees(cards.todaySales.netSalesMinor)}</span>
          </div>
          <div className="kpi-footer-row">
            {cards.todaySales.changePct !== null ? (
              <span
                className={`kpi-change-pill ${cards.todaySales.changePct >= 0 ? 'pos' : 'neg'}`}
              >
                {cards.todaySales.changePct >= 0 ? '▲' : '▼'}{' '}
                {Math.abs(cards.todaySales.changePct).toFixed(1)}% vs yesterday
              </span>
            ) : (
              <span className="kpi-change-pill neutral">No sales yesterday</span>
            )}
          </div>
        </div>

        {/* CARD 2: BILLS */}
        <div className="today-kpi-card">
          <div className="kpi-card-header">
            <span className="kpi-label">BILLS</span>
            <span className="kpi-icon-badge blue">🧾</span>
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value mono">{cards.bills.billsCount}</span>
          </div>
          <div className="kpi-footer-row">
            {cards.bills.hasCompBills ? (
              <span className={`kpi-change-text ${cards.bills.diffCount !== null && cards.bills.diffCount >= 0 ? 'pos' : 'neg'}`}>
                {cards.bills.diffCount !== null && cards.bills.diffCount > 0
                  ? `▲ ${cards.bills.diffCount} vs yesterday`
                  : cards.bills.diffCount !== null && cards.bills.diffCount < 0
                  ? `▼ ${Math.abs(cards.bills.diffCount)} vs yesterday`
                  : `No change vs yesterday`}
              </span>
            ) : (
              <span className="kpi-change-text neutral">No bills yesterday</span>
            )}
          </div>
        </div>

        {/* CARD 3: AVG BILL VALUE */}
        <div className="today-kpi-card">
          <div className="kpi-card-header">
            <span className="kpi-label">AVG BILL VALUE</span>
            <span className="kpi-icon-badge green">🏷️</span>
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value mono">{formatRupees(cards.avgBillValue.avgBillMinor, true)}</span>
          </div>
          <div className="kpi-footer-row">
            {cards.avgBillValue.changePct !== null ? (
              <span className={`kpi-change-text ${cards.avgBillValue.changePct >= 0 ? 'pos' : 'neg'}`}>
                {cards.avgBillValue.changePct >= 0 ? '▲' : '▼'} {Math.abs(cards.avgBillValue.changePct).toFixed(1)}% vs yesterday
              </span>
            ) : (
              <span className="kpi-change-text neutral">No bills yesterday</span>
            )}
          </div>
        </div>

        {/* CARD 4: GROSS PROFIT (Owner / Manager only) */}
        {cards.grossProfit.visible && (
          <div className="today-kpi-card">
            <div className="kpi-card-header">
              <span className="kpi-label">GROSS PROFIT</span>
              <span className="kpi-icon-badge green">🛡️</span>
            </div>
            <div className="kpi-value-row">
              <span className="kpi-value mono text-success">{formatRupees(cards.grossProfit.profitMinor)}</span>
            </div>
            <div className="kpi-footer-row">
              <span className="kpi-meta-text">
                {cards.grossProfit.marginPct.toFixed(1)}% margin
                {cards.grossProfit.isEstimated && <span className="estimated-tag" title="Based on item catalog cost"> (est.)</span>}
              </span>
            </div>
          </div>
        )}

        {/* CARD 5: ITEMS SOLD */}
        <div className="today-kpi-card">
          <div className="kpi-card-header">
            <span className="kpi-label">ITEMS SOLD</span>
            <span className="kpi-icon-badge brown">📦</span>
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value mono">{cards.itemsSold.totalUnits}</span>
          </div>
          <div className="kpi-footer-row">
            <span className="kpi-meta-text">units across {cards.itemsSold.distinctProductsCount} products</span>
          </div>
        </div>

        {/* CARD 6: RETURNS */}
        <div className="today-kpi-card">
          <div className="kpi-card-header">
            <span className="kpi-label">RETURNS</span>
            <span className="kpi-icon-badge red">↩️</span>
          </div>
          <div className="kpi-value-row">
            <span className="kpi-value mono text-danger">{formatRupees(cards.returns.returnsMinor)}</span>
          </div>
          <div className="kpi-footer-row">
            <span className="kpi-meta-text text-danger">
              {cards.returns.returnsCount} credit notes · {cards.returns.returnRatePct.toFixed(1)}%
            </span>
          </div>
        </div>
      </section>

      {/* 3. MIDDLE SECTION: HOURLY CHART & PAYMENT MODES */}
      <section className="today-middle-grid">
        {/* MAIN CHART CARD */}
        <div className="today-chart-card">
          <div className="chart-card-header">
            <div>
              <h2 className="chart-card-title">{chartTitle}</h2>
              <p className="chart-card-subtitle">{chartSubtitle}</p>
            </div>

            <div className="chart-header-right">
              {/* Segmented Toggle: Bills · Sales · Profit */}
              <div className="segmented-metric-toggle" role="tablist" aria-label="Hourly metric">
                <button
                  id="metric-tab-bills"
                  role="tab"
                  aria-selected={chartMetric === 'bills'}
                  tabIndex={0}
                  type="button"
                  className={`toggle-seg-btn ${chartMetric === 'bills' ? 'active' : ''}`}
                  onClick={() => setChartMetric('bills')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setChartMetric('bills');
                    }
                  }}
                >
                  Bills
                </button>
                <button
                  id="metric-tab-sales"
                  role="tab"
                  aria-selected={chartMetric === 'sales'}
                  tabIndex={0}
                  type="button"
                  className={`toggle-seg-btn ${chartMetric === 'sales' ? 'active' : ''}`}
                  onClick={() => setChartMetric('sales')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setChartMetric('sales');
                    }
                  }}
                >
                  Sales
                </button>
                {isOwnerOrManager && (
                  <button
                    id="metric-tab-profit"
                    role="tab"
                    aria-selected={chartMetric === 'profit'}
                    tabIndex={0}
                    type="button"
                    className={`toggle-seg-btn ${chartMetric === 'profit' ? 'active' : ''}`}
                    onClick={() => setChartMetric('profit')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setChartMetric('profit');
                      }
                    }}
                  >
                    Profit
                  </button>
                )}
              </div>

              {/* Legend */}
              <div className="chart-legend">
                <span className="legend-item">
                  <span className="legend-line today"></span> Today
                </span>
                <span className="legend-item">
                  <span className="legend-line last-week"></span> Yesterday ({nowKolkata.compWeekdayShort || nowKolkata.compWeekday || 'Prev'})
                  {!hasCompData && <span className="legend-empty-hint" style={{ color: '#94a3b8', fontSize: '0.72rem', marginLeft: '4px' }}>(No transactions)</span>}
                </span>
              </div>
            </div>
          </div>

          {/* SVG CHART CONTAINER */}
          <div className="chart-svg-wrapper">
            <svg
              className="today-hourly-svg"
              viewBox={`0 0 ${svgWidth} ${svgHeight}`}
              preserveAspectRatio="xMidYMid meet"
              onMouseLeave={() => setHoveredPointIndex(null)}
            >
              <defs>
                {/* Purple gradient for today's area under curve */}
                <linearGradient id="todayAreaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity="0.01" />
                </linearGradient>

                {/* Shading for rest of day */}
                <pattern id="diagonalHatch" width="10" height="10" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
                  <line x1="0" y1="0" x2="0" y2="10" stroke="#f1f5f9" strokeWidth="2" />
                </pattern>
              </defs>

              {/* 1. Horizontal Gridlines & Y-Axis Labels */}
              {chartTicks.ticks.map((t) => {
                const y = paddingTop + plotHeight - (t / chartTicks.maxValue) * plotHeight;
                return (
                  <g key={t} className="chart-grid-line">
                    <line
                      x1={paddingLeft}
                      y1={y}
                      x2={paddingLeft + plotWidth}
                      y2={y}
                      stroke="#f1f5f9"
                      strokeWidth="1"
                    />
                    <text
                      x={paddingLeft - 10}
                      y={y + 4}
                      textAnchor="end"
                      fill="#94a3b8"
                      fontSize="11"
                      className="mono"
                    >
                      {formatYAxisTick(t)}
                    </text>
                  </g>
                );
              })}

              {/* 2. Shaded area for the rest of today from nowX to end */}
              {nowX < paddingLeft + plotWidth && (
                <rect
                  x={nowX}
                  y={paddingTop}
                  width={paddingLeft + plotWidth - nowX}
                  height={plotHeight}
                  fill="rgba(248, 250, 252, 0.75)"
                />
              )}

              {/* 3. Comparison Day Monotone Curve (Dashed Grey Full Day) */}
              {compLinePath && (
                <path
                  d={compLinePath}
                  fill="none"
                  stroke="#cbd5e1"
                  strokeWidth="2.2"
                  strokeDasharray="5 5"
                />
              )}

              {/* 4. Peak Label on Comparison Line */}
              {compPeakPoint && compPeakPoint.compVal > 0 && (
                <g className="last-week-peak-marker">
                  <text
                    x={compPeakPoint.x}
                    y={Math.max(paddingTop + 14, compPeakPoint.compY - 10)}
                    textAnchor="middle"
                    fill="#64748b"
                    fontSize="11"
                    fontWeight="600"
                  >
                    Yesterday peak {compPeakPoint.hourRange} (
                    {chartMetric === 'bills'
                      ? `${compPeakPoint.compVal} ${compPeakPoint.compVal === 1 ? 'bill' : 'bills'}`
                      : formatCompactRupees(compPeakPoint.compVal)}
                    )
                  </text>
                </g>
              )}

              {/* 5. Today's Area Fill */}
              {todayAreaPath && (
                <path d={todayAreaPath} fill="url(#todayAreaGradient)" />
              )}

              {/* 6. Today's Monotone Solid Purple Line */}
              {todayLinePath && (
                <path
                  d={todayLinePath}
                  fill="none"
                  stroke="#6366f1"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                />
              )}

              {/* 7. Filled Dots for past & current hours */}
              {seriesWithCoords
                .filter((p) => p.isPastOrCurrent && p.todayVal !== null)
                .map((p) => (
                  <circle
                    key={p.hour}
                    cx={p.x}
                    cy={p.todayY}
                    r={hoveredPointIndex === p.idx ? 5.5 : 4}
                    fill={hoveredPointIndex === p.idx ? '#ffffff' : '#6366f1'}
                    stroke="#6366f1"
                    strokeWidth="2.5"
                  />
                ))}

              {/* 8. Vertical NOW marker with dashed line and badge */}
              <g className="now-marker-group">
                <line
                  x1={nowX}
                  y1={paddingTop}
                  x2={nowX}
                  y2={baselineY}
                  stroke="#10b981"
                  strokeWidth="1.8"
                  strokeDasharray="4 4"
                />
                {/* NOW Pill Badge */}
                <rect
                  x={nowX - 34}
                  y={paddingTop - 22}
                  width="68"
                  height="20"
                  rx="10"
                  fill="#10b981"
                />
                <text
                  x={nowX}
                  y={paddingTop - 8}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="10"
                  fontWeight="500"
                  letterSpacing="0.2px"
                >
                   {nowKolkata.timeStr}
                </text>
              </g>

              {/* 9. Interactive Columns for Hover Tooltip */}
              {seriesWithCoords.map((p) => {
                const colWidth = plotWidth / totalHoursSpan;
                return (
                  <rect
                    key={p.hour}
                    x={p.x - colWidth / 2}
                    y={paddingTop}
                    width={colWidth}
                    height={plotHeight}
                    fill="transparent"
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={() => setHoveredPointIndex(p.idx)}
                  />
                );
              })}

              {/* 10. X-Axis Ticks & Labels (Every 2 hours) */}
              {seriesWithCoords.map((p) => {
                // Show labels at even intervals or start/end
                const shouldLabel = p.hour % 2 === 0 || p.hour === closingHour;
                if (!shouldLabel) return null;

                return (
                  <g key={p.hour} className="chart-x-tick">
                    <line
                      x1={p.x}
                      y1={baselineY}
                      x2={p.x}
                      y2={baselineY + 5}
                      stroke="#cbd5e1"
                      strokeWidth="1"
                    />
                    <text
                      x={p.x}
                      y={baselineY + 18}
                      textAnchor="middle"
                      fill="#64748b"
                      fontSize="11"
                    >
                      {p.label}
                    </text>
                  </g>
                );
              })}

              {/* Subtle accent marker on busiest hour peak when not hovered */}
              {hoveredPointIndex === null && busiestIndex >= 0 && seriesWithCoords[busiestIndex] && (
                <circle
                  cx={seriesWithCoords[busiestIndex].x}
                  cy={seriesWithCoords[busiestIndex].todayY}
                  r="5"
                  fill="#ffffff"
                  stroke="#6366f1"
                  strokeWidth="2.5"
                  pointerEvents="none"
                />
              )}

              {/* 11. Tooltip Pin (Rendered only on active hover) */}
              {hoveredPointIndex !== null && activeTooltipPoint && (
                <g className="chart-pinned-tooltip" pointerEvents="none">
                  {/* Target vertical highlight line */}
                  <line
                    x1={activeTooltipPoint.x}
                    y1={paddingTop}
                    x2={activeTooltipPoint.x}
                    y2={baselineY}
                    stroke="#818cf8"
                    strokeWidth="1.2"
                    strokeDasharray="3 3"
                    opacity="0.8"
                  />
                  {/* Outer circle on hovered point */}
                  <circle
                    cx={activeTooltipPoint.x}
                    cy={activeTooltipPoint.todayY}
                    r="6.5"
                    fill="#ffffff"
                    stroke="#6366f1"
                    strokeWidth="2.5"
                  />
                </g>
              )}
            </svg>

            {/* FLOATING DARK TOOLTIP CARD (Rendered only on hover, positioned so it never blocks controls) */}
            {hoveredPointIndex !== null && activeTooltipPoint && (() => {
              const tooltipXPercent = (activeTooltipPoint.x / svgWidth) * 100;
              // If the point is in top 38% of the SVG, position tooltip below the point so it never protrudes into the header controls
              const isNearTop = (activeTooltipPoint.todayY / svgHeight) < 0.38;
              const tooltipYPercent = isNearTop
                ? ((activeTooltipPoint.todayY + 16) / svgHeight) * 100
                : ((activeTooltipPoint.todayY - 14) / svgHeight) * 100;
              
              const xTranslate = tooltipXPercent < 15 ? '0%' : tooltipXPercent > 85 ? '-100%' : '-50%';
              const yTranslate = isNearTop ? '0%' : '-100%';

              return (
                <div
                  className="chart-floating-card"
                  style={{
                    left: `${tooltipXPercent}%`,
                    top: `${tooltipYPercent}%`,
                    transform: `translate(${xTranslate}, ${yTranslate})`,
                    pointerEvents: 'none',
                  }}
                >
                  <div className="card-top-tag">
                    {activeTooltipPoint.hourRange}
                    {activeTooltipPoint.idx === busiestIndex && (
                      <span className="busiest-tag"> · busiest so far</span>
                    )}
                  </div>
                  <div className="card-main-val mono">
                    {!activeTooltipPoint.isPastOrCurrent
                      ? '—'
                      : chartMetric === 'bills'
                      ? `${activeTooltipPoint.todayVal ?? 0} bills`
                      : formatRupees(activeTooltipPoint.todayVal ?? 0)}
                  </div>
                  <div className="card-sub-meta">
                    <span>
                      {!activeTooltipPoint.isPastOrCurrent
                        ? 'upcoming'
                        : chartMetric === 'bills'
                        ? `${activeTooltipPoint.todayVal ?? 0} bills today`
                        : `${activeTooltipPoint.todayBillsCount ?? 0} bills · ${formatRupees(activeTooltipPoint.todayVal ?? 0)}`}
                    </span>
                    <span className="dot">·</span>
                    <span>
                      yesterday{' '}
                      {chartMetric === 'bills'
                        ? `${activeTooltipPoint.compVal} bills`
                        : formatRupees(activeTooltipPoint.compVal)}
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* PAYMENT MODES CARD */}
        <div className="today-payment-card">
          <div className="payment-card-header">
            <h2 className="payment-card-title">Payment Modes</h2>
            <p className="payment-card-subtitle">Today's collections by method</p>
          </div>

          <div className="payment-body-layout">
            {/* SVG DONUT CHART */}
            <div className="donut-chart-container">
              <svg width="180" height="180" viewBox="0 0 180 180" className="donut-svg">
                {(() => {
                  const size = 180;
                  const strokeWidth = 24;
                  const radius = (size - strokeWidth) / 2;
                  const circumference = 2 * Math.PI * radius;
                  let accumulatedOffset = 0;

                  if (payments.modes.length === 0 || payments.collectedTotalMinor === 0) {
                    return (
                      <circle
                        cx="90"
                        cy="90"
                        r={radius}
                        fill="none"
                        stroke="#e2e8f0"
                        strokeWidth={strokeWidth}
                      />
                    );
                  }

                  return payments.modes.map((mode) => {
                    const strokeDasharray = `${(mode.percentage / 100) * circumference} ${circumference}`;
                    const strokeDashoffset = -accumulatedOffset;
                    accumulatedOffset += (mode.percentage / 100) * circumference;

                    return (
                      <circle
                        key={mode.key}
                        cx="90"
                        cy="90"
                        r={radius}
                        fill="none"
                        stroke={mode.color}
                        strokeWidth={strokeWidth}
                        strokeDasharray={strokeDasharray}
                        strokeDashoffset={strokeDashoffset}
                        transform="rotate(-90 90 90)"
                        strokeLinecap="butt"
                      />
                    );
                  });
                })()}

                {/* Center text in Donut */}
                <text x="90" y="85" textAnchor="middle" className="donut-center-total mono">
                  {formatCompactRupees(payments.collectedTotalMinor)}
                </text>
                <text x="90" y="103" textAnchor="middle" className="donut-center-label">
                  collected
                </text>
              </svg>
            </div>

            {/* LEGEND WITH AMOUNTS AND PERCENTAGES */}
            <div className="payment-legend-list">
              {payments.modes.length > 0 ? (
                payments.modes.map((mode) => (
                  <div key={mode.key} className="payment-legend-row">
                    <div className="legend-indicator">
                      <span className="mode-color-dot" style={{ background: mode.color }}></span>
                      <span className="mode-name">{mode.name}</span>
                    </div>
                    <div className="legend-figures">
                      <span className="mode-amount mono">{formatRupees(mode.amountMinor)}</span>
                      <span className="mode-pct mono">{mode.percentage}%</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="payment-empty-legend">No payments recorded yet today</div>
              )}
            </div>
          </div>

          {/* GST COLLECTED FOOTER TILES */}
          <div className="payment-gst-tiles">
            <div className="gst-tile">
              <span className="gst-tile-label">GST COLLECTED TODAY</span>
              <span className="gst-tile-val mono">{formatRupees(payments.gst.totalGstMinor, true)}</span>
            </div>
            <div className="gst-tile">
              <span className="gst-tile-label">CGST · SGST</span>
              <span className="gst-tile-val mono">
                {formatRupees(payments.gst.cgstMinor)} · {formatRupees(payments.gst.sgstMinor)}
                {payments.gst.igstMinor > 0 && ` · ${formatRupees(payments.gst.igstMinor)} IGST`}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* 4. BOTTOM SECTION (THREE CARDS: Top Sellers, Stock Alerts, Cash Drawer) */}
      <section className="today-bottom-grid">
        {/* CARD 1: TOP SELLERS TODAY */}
        <div className="today-section-card">
          <div className="section-card-header">
            <div>
              <h3 className="section-title">Top Sellers Today</h3>
              <span className="section-subtitle">By sales value</span>
            </div>
            <button
              type="button"
              className="section-link-btn"
              onClick={onNavigateToSalesAnalysis}
            >
              Sales Analysis →
            </button>
          </div>

          <div className="sellers-list">
            {topSellers.length > 0 ? (
              topSellers.map((item) => (
                <div key={item.itemId} className="seller-row">
                  <div className="seller-info">
                    <span className="seller-name">{item.name}</span>
                    <span className="seller-qty">
                      {item.quantity} {item.unit}
                    </span>
                  </div>

                  <div className="seller-bar-wrap">
                    <div className="seller-bar" style={{ width: `${item.barPct}%` }}></div>
                  </div>

                  <div className="seller-amount mono">
                    {formatRupees(item.salesMinor)}
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-sub-card">No product sales yet today</div>
            )}
          </div>
        </div>

        {/* CARD 2: STOCK NEEDING ATTENTION */}
        <div className="today-section-card">
          <div className="section-card-header">
            <div>
              <h3 className="section-title">Stock Needing Attention</h3>
              <span className="section-subtitle">Fast sellers running low today</span>
            </div>
            <button
              type="button"
              className="section-link-btn"
              onClick={onNavigateToInventory}
            >
              Inventory Hub →
            </button>
          </div>

          <div className="stock-alerts-list">
            {stockAttention.length > 0 ? (
              stockAttention.map((item) => {
                const stockQty = typeof item.stockQty === 'number' && !isNaN(item.stockQty) ? item.stockQty : 0;
                const badgeText =
                  item.badgeText && !item.badgeText.includes('NaN')
                    ? item.badgeText
                    : stockQty <= 0
                    ? 'Out of stock'
                    : item.reorderLevel && !isNaN(item.reorderLevel) && item.reorderLevel > 0
                    ? `Below reorder (${item.reorderLevel})`
                    : 'Reorder level not configured';

                const badgeType =
                  item.badgeType ||
                  (stockQty <= 0
                    ? 'danger'
                    : item.reorderLevel && !isNaN(item.reorderLevel) && item.reorderLevel > 0
                    ? 'warning'
                    : 'neutral');

                return (
                  <div key={item.itemId} className="stock-alert-row">
                    <div className="stock-info">
                      <span className="stock-name">{item.name}</span>
                      <span className="stock-left-qty">
                        {stockQty} {item.unit || 'pcs'} left
                      </span>
                    </div>

                    <div className="stock-badge-col">
                      <span className={`stock-badge ${badgeType}`}>
                        {badgeText}
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="empty-sub-card">All active inventory levels are healthy ✓</div>
            )}
          </div>
        </div>

        {/* CARD 3: COUNTERS TODAY (Matches Design in Image 2) */}
        <div className="today-section-card counters-today-card">
          <div className="section-card-header">
            <div>
              <h3 className="section-title">Counters Today</h3>
              <span className="section-subtitle">Collected from open till now</span>
            </div>
            <button
              type="button"
              className="counters-today-header-link"
              onClick={onNavigateToShifts}
            >
              Cashier Shifts →
            </button>
          </div>

          <div className="counters-today-body">
            {countersToday?.counters && countersToday.counters.length > 0 ? (
              countersToday.counters.map((c) => (
                <div key={c.id || c.name} className="counter-row-item">
                  <span className="counter-row-name">{c.name}</span>
                  <span className="counter-row-amount mono">{c.formattedAmount}</span>
                </div>
              ))
            ) : (
              <div className="empty-sub-card">No active counters configured for this branch.</div>
            )}

            <div className="counter-total-row">
              <span className="counter-total-label">Total</span>
              <span className="counter-total-amount mono">
                {countersToday?.formattedTotal || '₹0'}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* MODALS */}
      {showOpenShiftModal && (
        <OpenShiftModal
          isOpen={showOpenShiftModal}
          onClose={() => setShowOpenShiftModal(false)}
          onSuccess={handleShiftOpened}
          userName={user.name}
          userRole={user.role}
          defaultLocation={selectedBranchCode}
          defaultCounter="COUNTER-1"
        />
      )}

      {showCashMovementModal && shiftDrawer.activeShift && (
        <CashMovementModal
          isOpen={showCashMovementModal}
          onClose={() => setShowCashMovementModal(false)}
          onSuccess={handleCashMovementSuccess}
          activeShift={shiftDrawer.activeShift}
        />
      )}

      {showCloseShiftModal && shiftDrawer.activeShift && (
        <CloseShiftModal
          isOpen={showCloseShiftModal}
          onClose={() => setShowCloseShiftModal(false)}
          onSuccess={handleShiftClosed}
          activeShift={shiftDrawer.activeShift}
          summary={shiftDrawer.activeShift?.summary || ({
            openingCashMinor: shiftDrawer.openingCashMinor,
            cashSalesMinor: shiftDrawer.cashSalesMinor,
            cashPaymentsMinor: shiftDrawer.cashPaymentsMinor || 0,
            totalCashReceivedMinor: shiftDrawer.cashSalesMinor + (shiftDrawer.cashPaymentsMinor || 0),
            cashInMinor: shiftDrawer.cashInMinor,
            cashOutMinor: shiftDrawer.cashOutMinor,
            cashRefundsMinor: shiftDrawer.cashRefundsMinor,
            expectedCashMinor: shiftDrawer.expectedCashMinor,
            nonCashPaymentsMinor: Math.max(0, payments.collectedTotalMinor - (shiftDrawer.cashSalesMinor + (shiftDrawer.cashPaymentsMinor || 0))),
            totalCollectedMinor: payments.collectedTotalMinor,
            totalSalesBilledMinor: cards.todaySales.grossSalesMinor,
            creditSalesUnpaidMinor: Math.max(0, cards.todaySales.netSalesMinor - payments.collectedTotalMinor),
            paymentMethods: [],
            transactionsCount: cards.bills.billsCount,
            invoicesCount: cards.bills.billsCount,
            returnsCount: cards.returns.returnsCount,
            cashMovesCount: 0,
          } as any)}
        />
      )}
    </div>
  );
};
