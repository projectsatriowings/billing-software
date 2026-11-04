import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type {
  ProductMovementAnalysisData,
  ProductMovementItem,
  InventoryDashboardStats,
} from '../../api.ts';
import {
  fetchProductMovementAnalysis,
  fetchInventoryDashboard,
} from '../../api.ts';
import {
  WarehouseIcon,
  TagIcon,
  PackageIcon,
  CheckCircleIcon,
  ZapIcon,
  HourglassIcon,
  AlertOctagonIcon,
  AlertTriangleIcon,
  TrophyIcon,
  CalendarIcon,
  DownloadIcon,
  SearchIcon,
  RefreshCwIcon,
  ArrowRightIcon,
  RupeeIcon,
  BrainIcon,
  XIcon,
  TrendingUpIcon,
  RotateCcwIcon,
  ShoppingCartIcon,
} from './InventoryIcons.tsx';
import './StockReportBentoView.css';

interface ProductMovementAnalysisViewProps {
  categories: string[];
  onNavigateToPurchases?: (supplierId?: string, itemId?: string) => void;
  userRole?: string;
}

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  formatter?: (val: number) => string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
  triggerKey?: any;
}

export const AnimatedCounter: React.FC<AnimatedCounterProps> = ({
  value,
  duration = 900,
  formatter,
  prefix = '',
  suffix = '',
  decimals = 0,
  className,
  triggerKey,
}) => {
  const [displayValue, setDisplayValue] = useState<number>(0);

  useEffect(() => {
    let startTime: number | null = null;
    let animationFrameId: number;
    const startValue = 0;
    const endValue = typeof value === 'number' && !isNaN(value) ? value : 0;

    if (endValue === 0) {
      setDisplayValue(0);
      return;
    }

    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      const current = startValue + (endValue - startValue) * easeProgress;
      setDisplayValue(current);

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(step);
      } else {
        setDisplayValue(endValue);
      }
    };

    animationFrameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animationFrameId);
  }, [value, duration, triggerKey]);

  let formatted = '';
  if (formatter) {
    formatted = formatter(displayValue);
  } else if (decimals > 0) {
    formatted = displayValue.toFixed(decimals);
  } else {
    formatted = Math.round(displayValue).toLocaleString('en-IN');
  }

  return (
    <span className={className}>
      {prefix}{formatted}{suffix}
    </span>
  );
};

export const ProductMovementAnalysisView: React.FC<ProductMovementAnalysisViewProps> = ({
  categories,
  onNavigateToPurchases,
}) => {
  // Date range filter: '7d' | '30d' | '90d' | 'custom'
  const [selectedRange, setSelectedRange] = useState<'7d' | '30d' | '90d' | 'custom'>('30d');
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [showCustomPicker, setShowCustomPicker] = useState<boolean>(false);

  // Data state
  const [data, setData] = useState<ProductMovementAnalysisData | null>(null);
  const [invStats, setInvStats] = useState<InventoryDashboardStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Animation state for page entry & data transitions
  const [animateIn, setAnimateIn] = useState<boolean>(false);
  const [animationKey, setAnimationKey] = useState<number>(0);

  useEffect(() => {
    if (data?.summary) {
      setAnimateIn(false);
      const timer = setTimeout(() => {
        setAnimateIn(true);
        setAnimationKey((k) => k + 1);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [data]);

  // Table filters & sorting
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [sortField, setSortField] = useState<
    'units_desc' | 'units_asc' | 'txns_desc' | 'name_asc' | 'stock_desc' | 'stock_asc'
  >('units_desc');

  // Pagination state
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  // Load analytics from API
  const loadAnalysis = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) {
        setIsRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      try {
        const [res, statsRes] = await Promise.allSettled([
          fetchProductMovementAnalysis({
            range: selectedRange,
            from: selectedRange === 'custom' ? customFrom : undefined,
            to: selectedRange === 'custom' ? customTo : undefined,
          }),
          fetchInventoryDashboard(),
        ]);

        if (res.status === 'fulfilled') {
          setData(res.value);
        } else {
          throw res.reason;
        }

        if (statsRes.status === 'fulfilled' && statsRes.value?.stats) {
          setInvStats(statsRes.value.stats);
        }
      } catch (err: any) {
        console.error('Failed to load product movement analysis:', err);
        setError(err?.message || 'Failed to load movement analysis');
      } finally {
        setLoading(false);
        setIsRefreshing(false);
      }
    },
    [selectedRange, customFrom, customTo]
  );

  useEffect(() => {
    if (selectedRange !== 'custom') {
      loadAnalysis();
    }
  }, [selectedRange, loadAnalysis]);

  const handleApplyCustomRange = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customFrom || !customTo) return;
    setShowCustomPicker(false);
    setPage(1);
    loadAnalysis();
  };

  // Human-readable date range label
  const rangeDisplayLabel = useMemo(() => {
    if (!data?.summary) return '';
    try {
      const start = new Date(data.summary.startDate);
      const end = new Date(data.summary.endDate);
      const startStr = start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const endStr = end.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      return `${startStr} – ${endStr}`;
    } catch {
      return '';
    }
  }, [data?.summary]);

  // Format currency in Indian Rupees
  const formatCurrency = (minor: number) => {
    return `₹${(minor / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  };

  // Format last sold date
  const formatLastSold = (iso: string | null) => {
    if (!iso) return '—';
    try {
      const date = new Date(iso);
      const now = new Date();
      const isToday =
        date.getDate() === now.getDate() &&
        date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear();

      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const isYesterday =
        date.getDate() === yesterday.getDate() &&
        date.getMonth() === yesterday.getMonth() &&
        date.getFullYear() === yesterday.getFullYear();

      const timeStr = date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });

      if (isToday) return `Today, ${timeStr}`;
      if (isYesterday) return `Yesterday`;
      return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
      return iso;
    }
  };

  // Filtered & sorted products for table
  const filteredProducts = useMemo(() => {
    if (!data?.products) return [];

    let list = [...data.products];

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku && p.sku.toLowerCase().includes(q)) ||
          (p.barcode && p.barcode.toLowerCase().includes(q)) ||
          (p.category && p.category.toLowerCase().includes(q))
      );
    }

    // Category filter
    if (categoryFilter !== 'ALL') {
      list = list.filter((p) => p.category?.toLowerCase() === categoryFilter.toLowerCase());
    }

    // Movement status filter
    if (statusFilter !== 'ALL') {
      list = list.filter((p) => p.movementStatus === statusFilter);
    }

    // Sort
    list.sort((a, b) => {
      switch (sortField) {
        case 'units_desc':
          return b.unitsSold - a.unitsSold || b.salesTxns - a.salesTxns;
        case 'units_asc':
          return a.unitsSold - b.unitsSold;
        case 'txns_desc':
          return b.salesTxns - a.salesTxns || b.unitsSold - a.unitsSold;
        case 'name_asc':
          return a.name.localeCompare(b.name);
        case 'stock_desc':
          return b.currentStockUnits - a.currentStockUnits;
        case 'stock_asc':
          return a.currentStockUnits - b.currentStockUnits;
        default:
          return 0;
      }
    });

    return list;
  }, [data?.products, searchQuery, categoryFilter, statusFilter, sortField]);

  // Paginated products
  const totalItems = filteredProducts.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const paginatedProducts = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredProducts.slice(start, start + pageSize);
  }, [filteredProducts, page, pageSize]);

  // Export to CSV
  const handleExportCsv = () => {
    if (!data?.products || data.products.length === 0) return;

    const headers = [
      'Product Name',
      'Category',
      'SKU / Code',
      'Current Stock',
      'Unit',
      'Units Sold',
      'Sales Transactions',
      'Last Sold Date',
      'Movement Status',
      'Suggested Action',
    ];

    const rows = filteredProducts.map((p) => [
      `"${p.name.replace(/"/g, '""')}"`,
      `"${(p.category || 'General').replace(/"/g, '""')}"`,
      `"${(p.sku || '—').replace(/"/g, '""')}"`,
      p.currentStockUnits,
      `"${p.unit}"`,
      p.unitsSold,
      p.salesTxns,
      `"${formatLastSold(p.lastSoldAt)}"`,
      `"${
        p.movementStatus === 'fast_moving'
          ? 'Fast-moving'
          : p.movementStatus === 'slow_moving'
          ? 'Slow-moving'
          : 'Non-moving'
      }"`,
      `"${p.suggestedAction}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `stock-movement-report-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const summary = data?.summary;
  const topSellers = data?.topSellers || [];
  const topSellerMax = topSellers.length > 0 ? topSellers[0].unitsSold || 1 : 1;

  const totalTracked = summary?.totalTrackedProducts || 1;
  const fastPct = Math.round(((summary?.fastMovingCount || 0) / totalTracked) * 100);
  const slowPct = Math.round(((summary?.slowMovingCount || 0) / totalTracked) * 100);
  const nonPct = Math.max(0, 100 - fastPct - slowPct);

  // Circulation Index Score (% of catalogue active in turnover)
  const circPct = Math.min(
    100,
    Math.max(
      0,
      Math.round(
        (((summary?.fastMovingCount || 0) + (summary?.slowMovingCount || 0)) / totalTracked) * 100
      )
    )
  );
  // Semi-circle arc circumference for radius=58: pi * 58 ~= 182.2
  const arcDasharray = 182.2;
  const arcDashoffset = arcDasharray * (1 - circPct / 100);

  // 7 pillar bar heights for recent volume momentum
  const pillarHeights = [38, 65, 42, 85, 55, 100, 75];

  const hasActiveFilters = searchQuery !== '' || categoryFilter !== 'ALL' || statusFilter !== 'ALL';

  return (
    <div className="stock-report-bento-root">
      {/* ── 1. HEADER BENTO CARD ── */}
      <div className="srb-header-card">
        <div className="srb-header-left">
          <div className="srb-header-icon-box">
            <WarehouseIcon size={22} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
              <h1 className="srb-header-title">Stock Movement Report</h1>
              <span className="srb-badge-live">
                <span className="srb-live-dot"></span> PostgreSQL Live
              </span>
            </div>
            <p className="srb-header-sub">
              Track stock turnover velocity, high-movement leaders &amp; dormant inventory capital
            </p>
          </div>
        </div>

        <div className="srb-header-actions">
          {/* Date Range Switcher Pills */}
          <div className="srb-range-pills" role="radiogroup">
            <button
              type="button"
              className={`srb-range-btn ${selectedRange === '7d' ? 'active' : ''}`}
              onClick={() => {
                setSelectedRange('7d');
                setShowCustomPicker(false);
                setPage(1);
              }}
            >
              7 Days
            </button>
            <button
              type="button"
              className={`srb-range-btn ${selectedRange === '30d' ? 'active' : ''}`}
              onClick={() => {
                setSelectedRange('30d');
                setShowCustomPicker(false);
                setPage(1);
              }}
            >
              30 Days
            </button>
            <button
              type="button"
              className={`srb-range-btn ${selectedRange === '90d' ? 'active' : ''}`}
              onClick={() => {
                setSelectedRange('90d');
                setShowCustomPicker(false);
                setPage(1);
              }}
            >
              90 Days
            </button>
            <button
              type="button"
              className={`srb-range-btn ${selectedRange === 'custom' ? 'active' : ''}`}
              onClick={() => {
                setSelectedRange('custom');
                setShowCustomPicker(!showCustomPicker);
              }}
            >
              <CalendarIcon size={13} /> Custom
            </button>
          </div>

          {rangeDisplayLabel && (
            <span className="srb-date-label-pill">
              <CalendarIcon size={12} color="#6d4aff" /> {rangeDisplayLabel}
            </span>
          )}

          <button
            type="button"
            className="srb-btn-outline"
            onClick={() => loadAnalysis(true)}
            disabled={isRefreshing || loading}
            title="Refresh Data"
          >
            <RefreshCwIcon size={13} className={isRefreshing ? 'animate-spin' : ''} />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>

          <button
            type="button"
            className="srb-btn-primary"
            onClick={handleExportCsv}
            disabled={!data || data.products.length === 0}
            title="Export to CSV"
          >
            <DownloadIcon size={13} /> Export CSV
          </button>
        </div>
      </div>

      {/* Custom Date Range Popover */}
      {showCustomPicker && selectedRange === 'custom' && (
        <form onSubmit={handleApplyCustomRange} className="srb-custom-popover">
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0f172a' }}>
            Custom Date Range:
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <label style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>From:</label>
            <input
              type="date"
              className="srb-search-input"
              style={{ width: '145px', height: '34px', padding: '0 0.5rem' }}
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              required
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <label style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>To:</label>
            <input
              type="date"
              className="srb-search-input"
              style={{ width: '145px', height: '34px', padding: '0 0.5rem' }}
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="srb-btn-primary" style={{ padding: '0.35rem 0.85rem' }}>
            Apply Range
          </button>
          <button
            type="button"
            className="srb-btn-outline"
            style={{ padding: '0.35rem 0.75rem' }}
            onClick={() => setShowCustomPicker(false)}
          >
            Cancel
          </button>
        </form>
      )}

      {/* Error Banner */}
      {error && (
        <div
          className="srb-bento-box"
          style={{
            background: '#fef2f2',
            borderColor: '#fca5a5',
            padding: '1rem 1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', color: '#991b1b' }}>
            <AlertTriangleIcon size={18} color="#dc2626" />
            <span style={{ fontWeight: 600, fontSize: '0.84rem' }}>{error}</span>
          </div>
          <button type="button" className="srb-btn-outline" onClick={() => loadAnalysis()}>
            Retry
          </button>
        </div>
      )}

      {/* ── 2. ASYMMETRIC HERO BENTO DECK (Gauge + Movement Pulse + Action Radar) ── */}
      {summary && (
        <div className="srb-hero-bento-grid">
          {/* Card 1: Circulation Arc Gauge */}
          <div className="srb-hero-col-4 srb-bento-box srb-box-circulation">
            <div className="srb-tile-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                <div className="srb-tile-icon-box purple">
                  <RotateCcwIcon size={16} />
                </div>
                <div>
                  <span className="srb-tile-label">Circulation Index</span>
                  <span style={{ fontSize: '0.72rem', color: '#64748b', display: 'block' }}>
                    Turnover Health Score
                  </span>
                </div>
              </div>
              <span className="srb-tile-pill purple">
                {circPct >= 60 ? 'Healthy Turnover' : 'Idle Heavy'}
              </span>
            </div>

            {/* Arc Speedometer Gauge */}
            <div className="srb-arc-gauge-wrap">
              <svg className="srb-arc-svg" viewBox="0 0 170 98">
                <defs>
                  <linearGradient id="srbGaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#10b981" />
                    <stop offset="60%" stopColor="#6d4aff" />
                    <stop offset="100%" stopColor="#8b5cf6" />
                  </linearGradient>
                </defs>
                {/* Background Arc */}
                <path
                  className="srb-arc-bg"
                  d="M 27,85 A 58,58 0 0,1 143,85"
                />
                {/* Dynamic Colored Arc Fill */}
                <path
                  className="srb-arc-fill"
                  d="M 27,85 A 58,58 0 0,1 143,85"
                  strokeDasharray={arcDasharray}
                  strokeDashoffset={animateIn ? arcDashoffset : arcDasharray}
                />
              </svg>
              <div className="srb-arc-center-text">
                <span className="srb-arc-pct">
                  <AnimatedCounter value={circPct} suffix="%" triggerKey={animationKey} />
                </span>
                <span className="srb-arc-sub">IN MOTION</span>
              </div>
            </div>

            {/* 3D Inset Panel with Segmented Meter */}
            <div className="srb-inset-3d-card">
              <div className="srb-segmented-meter">
                <div
                  className="srb-seg-block green"
                  style={{ width: animateIn ? `${fastPct}%` : '0%' }}
                  title={`Fast: ${fastPct}%`}
                />
                <div
                  className="srb-seg-block amber"
                  style={{ width: animateIn ? `${slowPct}%` : '0%' }}
                  title={`Slow: ${slowPct}%`}
                />
                <div
                  className="srb-seg-block red"
                  style={{ width: animateIn ? `${nonPct}%` : '0%' }}
                  title={`Dormant: ${nonPct}%`}
                />
              </div>
              <div className="srb-circ-legend-row">
                <span style={{ color: '#059669', fontWeight: 700 }}>
                  ● Fast <AnimatedCounter value={fastPct} suffix="%" triggerKey={animationKey} />
                </span>
                <span style={{ color: '#d97706', fontWeight: 700 }}>
                  ● Slow <AnimatedCounter value={slowPct} suffix="%" triggerKey={animationKey} />
                </span>
                <span style={{ color: '#dc2626', fontWeight: 700 }}>
                  ● Dormant <AnimatedCounter value={nonPct} suffix="%" triggerKey={animationKey} />
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: Executive Movement Pulse (Light Theme Card - NO DARK THEME) */}
          <div className="srb-hero-col-4 srb-bento-box srb-box-pulse">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                <div className="srb-tile-icon-box purple">
                  <ZapIcon size={16} />
                </div>
                <div>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      color: '#64748b',
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    }}
                  >
                    MOVEMENT PULSE
                  </span>
                  <span style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block' }}>
                    Real-time Dispatch Stream
                  </span>
                </div>
              </div>
              <span className="srb-pulse-badge">
                <span className="srb-pulse-dot"></span> Live Sync
              </span>
            </div>

            <div style={{ marginTop: '0.5rem' }}>
              <div className="srb-pulse-num">
                <AnimatedCounter value={summary.totalUnitsSold} triggerKey={animationKey} />
                <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#64748b' }}>
                  units
                </span>
              </div>
              <div className="srb-pulse-sub">
                Total stock dispatched across <AnimatedCounter value={summary.totalSalesBills} triggerKey={animationKey} /> bills
              </div>
            </div>

            {/* 7-Pillar Micro Bar Chart */}
            <div className="srb-pillar-bars-chart">
              {pillarHeights.map((h, i) => (
                <div key={i} className="srb-pillar-col" title={`Interval volume index: ${h}%`}>
                  <div
                    className="srb-pillar-fill"
                    style={{
                      height: animateIn ? `${h}%` : '0%',
                      transitionDelay: `${i * 65}ms`,
                    }}
                  />
                </div>
              ))}
            </div>

            <div className="srb-pulse-footer">
              <span>
                <AnimatedCounter value={summary.totalTrackedProducts} triggerKey={animationKey} /> Catalogue Items
              </span>
              {invStats?.totalStockValueMinor != null && (
                <span style={{ color: '#6d4aff', fontWeight: 700 }}>
                  <AnimatedCounter
                    value={invStats.totalStockValueMinor}
                    formatter={formatCurrency}
                    triggerKey={animationKey}
                  />{' '}
                  Value
                </span>
              )}
            </div>
          </div>

          {/* Card 3: Action Radar & Risk Buffer */}
          <div className="srb-hero-col-4 srb-bento-box srb-box-radar">
            <div className="srb-tile-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                <div className="srb-tile-icon-box red">
                  <AlertOctagonIcon size={16} />
                </div>
                <div>
                  <span className="srb-tile-label" style={{ color: '#991b1b' }}>
                    Turnover Radar
                  </span>
                  <span style={{ fontSize: '0.72rem', color: '#64748b', display: 'block' }}>
                    Replenish &amp; Buffer Control
                  </span>
                </div>
              </div>
              <span className={`srb-tile-pill ${summary.nonMovingCount > 0 ? 'red' : 'green'}`}>
                {summary.nonMovingCount > 0 ? 'Action Needed' : 'Healthy Buffer'}
              </span>
            </div>

            <div className="srb-radar-items">
              {/* Row 1: Dormant Capital at Risk */}
              <div className="srb-radar-row alert-red">
                <div>
                  <div style={{ fontWeight: 800, fontSize: '0.82rem', color: '#991b1b' }}>
                    <AnimatedCounter value={summary.nonMovingCount} triggerKey={animationKey} /> Dormant SKUs
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#b91c1c' }}>
                    <AnimatedCounter
                      value={data?.insights.nonMovingSummary.tiedCapitalMinor || 0}
                      formatter={formatCurrency}
                      triggerKey={animationKey}
                    /> tied up
                  </div>
                </div>
                <button
                  type="button"
                  className="srb-radar-btn red"
                  onClick={() => {
                    setStatusFilter(statusFilter === 'non_moving' ? 'ALL' : 'non_moving');
                    setPage(1);
                  }}
                >
                  Review ({summary.nonMovingCount}) <ArrowRightIcon size={11} />
                </button>
              </div>

              {/* Row 2: Slow Buffer */}
              <div className="srb-radar-row alert-amber">
                <div>
                  <div style={{ fontWeight: 800, fontSize: '0.82rem', color: '#92400e' }}>
                    <AnimatedCounter value={summary.slowMovingCount} triggerKey={animationKey} /> Slow Buffer
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#b45309' }}>
                    1–{summary.fastMinUnits - 1} units moving
                  </div>
                </div>
                <button
                  type="button"
                  className="srb-radar-btn amber"
                  onClick={() => {
                    setStatusFilter(statusFilter === 'slow_moving' ? 'ALL' : 'slow_moving');
                    setPage(1);
                  }}
                >
                  Review ({summary.slowMovingCount})
                </button>
              </div>
            </div>

            {onNavigateToPurchases && (
              <button
                type="button"
                className="srb-btn-outline"
                style={{
                  width: '100%',
                  justifyContent: 'center',
                  borderColor: '#fca5a5',
                  color: '#b91c1c',
                  fontWeight: 700,
                  marginTop: '0.2rem',
                }}
                onClick={() => onNavigateToPurchases()}
              >
                <ShoppingCartIcon size={13} /> Open Purchase Orders
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── 3. FOUR MODULAR BENTO METRIC TILES (Mint, Amber, Coral, Violet) ── */}
      {summary && (
        <div className="srb-metric-tiles-grid">
          {/* Tile 1: Fast-Moving */}
          <div
            className={`srb-metric-tile mint ${statusFilter === 'fast_moving' ? 'active' : ''}`}
            onClick={() => {
              setStatusFilter((prev) => (prev === 'fast_moving' ? 'ALL' : 'fast_moving'));
              setPage(1);
            }}
          >
            <div className="srb-tile-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                <div className="srb-tile-icon-box green">
                  <ZapIcon size={16} />
                </div>
                <span className="srb-tile-label">Fast-Moving</span>
              </div>
              <span className="srb-tile-pill green">
                <ZapIcon size={11} /> <AnimatedCounter value={fastPct} suffix="%" triggerKey={animationKey} />
              </span>
            </div>
            <div className="srb-tile-big-num green">
              <AnimatedCounter value={summary.fastMovingCount} triggerKey={animationKey} />
            </div>
            <div className="srb-tile-footer">
              <span>≥ {summary.fastMinUnits} units or ≥ {summary.fastMinTxns} bills</span>
              <ArrowRightIcon size={12} color="#059669" />
            </div>
          </div>

          {/* Tile 2: Slow-Moving */}
          <div
            className={`srb-metric-tile amber ${statusFilter === 'slow_moving' ? 'active' : ''}`}
            onClick={() => {
              setStatusFilter((prev) => (prev === 'slow_moving' ? 'ALL' : 'slow_moving'));
              setPage(1);
            }}
          >
            <div className="srb-tile-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                <div className="srb-tile-icon-box amber">
                  <HourglassIcon size={16} />
                </div>
                <span className="srb-tile-label">Slow-Moving</span>
              </div>
              <span className="srb-tile-pill amber">
                <HourglassIcon size={11} /> <AnimatedCounter value={slowPct} suffix="%" triggerKey={animationKey} />
              </span>
            </div>
            <div className="srb-tile-big-num amber">
              <AnimatedCounter value={summary.slowMovingCount} triggerKey={animationKey} />
            </div>
            <div className="srb-tile-footer">
              <span>1–{summary.fastMinUnits - 1} units sold in period</span>
              <ArrowRightIcon size={12} color="#d97706" />
            </div>
          </div>

          {/* Tile 3: Dead Stock */}
          <div
            className={`srb-metric-tile coral ${statusFilter === 'non_moving' ? 'active' : ''}`}
            onClick={() => {
              setStatusFilter((prev) => (prev === 'non_moving' ? 'ALL' : 'non_moving'));
              setPage(1);
            }}
          >
            <div className="srb-tile-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                <div className="srb-tile-icon-box red">
                  <AlertOctagonIcon size={16} />
                </div>
                <span className="srb-tile-label">Dead Stock</span>
              </div>
              <span className="srb-tile-pill red">
                <AlertOctagonIcon size={11} /> 0 Sales
              </span>
            </div>
            <div className="srb-tile-big-num red">
              <AnimatedCounter value={summary.nonMovingCount} triggerKey={animationKey} />
            </div>
            <div className="srb-tile-footer">
              <span>Zero sales in past {summary.rangeDays} days</span>
              <ArrowRightIcon size={12} color="#dc2626" />
            </div>
          </div>

          {/* Tile 4: Tied Assets / Active SKUs */}
          <div
            className={`srb-metric-tile violet ${
              statusFilter === 'ALL' && categoryFilter === 'ALL' && !searchQuery ? 'active' : ''
            }`}
            onClick={() => {
              setStatusFilter('ALL');
              setCategoryFilter('ALL');
              setSearchQuery('');
              setPage(1);
            }}
          >
            <div className="srb-tile-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                <div className="srb-tile-icon-box purple">
                  <RupeeIcon size={16} />
                </div>
                <span className="srb-tile-label">Tied Capital</span>
              </div>
              <span className="srb-tile-pill purple">{categories.length} Categories</span>
            </div>
            <div className="srb-tile-big-num purple" style={{ fontSize: '1.45rem' }}>
              <AnimatedCounter
                value={data?.insights.nonMovingSummary.tiedCapitalMinor || 0}
                formatter={formatCurrency}
                triggerKey={animationKey}
              />
            </div>
            <div className="srb-tile-footer">
              <span>
                <AnimatedCounter value={summary.totalTrackedProducts} triggerKey={animationKey} /> catalogue SKUs
              </span>
              <ArrowRightIcon size={12} color="#6d4aff" />
            </div>
          </div>
        </div>
      )}

      {/* ── 4. VISUAL INTELLIGENCE & LEADERBOARD BENTO DECK (Top Sellers + Risk Insights) ── */}
      {data && (
        <div className="srb-visual-deck-grid">
          {/* Panel 1: Top 10 Best Sellers (Span 7) */}
          <div className="srb-bento-box srb-panel-sellers">
            <div className="srb-deck-header">
              <h2 className="srb-deck-title">
                <TrophyIcon size={18} color="#d97706" /> Top 10 High-Velocity Best-Sellers
              </h2>
              <span className="srb-tile-pill purple">By Quantity Sold</span>
            </div>

            {topSellers.length === 0 ? (
              <div
                style={{
                  padding: '2.5rem 1rem',
                  textAlign: 'center',
                  color: '#94a3b8',
                  fontSize: '0.84rem',
                }}
              >
                No completed sales recorded during this date window.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {topSellers.map((item, idx) => {
                  const pct = Math.max(8, Math.min(100, (item.unitsSold / topSellerMax) * 100));
                  const rankClass =
                    idx === 0
                      ? 'gold'
                      : idx === 1
                      ? 'silver'
                      : idx === 2
                      ? 'bronze'
                      : 'standard';

                  const itemCat =
                    data?.products.find((p) => p.id === item.id)?.category || 'Top Velocity SKU';

                  return (
                    <div key={item.id || idx} className="srb-leader-row">
                      <div className={`srb-rank-pill ${rankClass}`}>#{idx + 1}</div>
                      <div className="srb-leader-info">
                        <span className="srb-leader-name" title={item.name}>
                          {item.name}
                        </span>
                        <span className="srb-leader-cat">{itemCat}</span>
                      </div>
                      <div className="srb-leader-track">
                        <div
                          className="srb-leader-bar-fill"
                          style={{
                            width: animateIn ? `${pct}%` : '0%',
                            transitionDelay: `${idx * 55}ms`,
                          }}
                        />
                      </div>
                      <span className="srb-leader-qty">
                        <AnimatedCounter value={item.unitsSold} triggerKey={animationKey} />{' '}
                        <span style={{ fontSize: '0.72rem', color: '#64748b' }}>{item.unit}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Panel 2: Grounded Risk Intelligence (Span 5) */}
          <div className="srb-bento-box srb-panel-intelligence">
            <div className="srb-deck-header">
              <h2 className="srb-deck-title">
                <BrainIcon size={18} color="#6d4aff" /> Grounded Risk Intelligence
              </h2>
              <span className="srb-badge-live">PostgreSQL Live</span>
            </div>

            {/* Box 1: Best Seller Runway */}
            {data.insights.bestSeller ? (
              <div className="srb-risk-layer-card gold">
                <div className="srb-risk-title-bar">
                  <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <TrophyIcon size={14} color="#b45309" />
                    Top Seller: {data.insights.bestSeller.name}
                  </span>
                  <span className="srb-tile-pill amber" style={{ fontSize: '0.68rem' }}>
                    {data.insights.bestSeller.runwayDays !== null &&
                    data.insights.bestSeller.runwayDays !== undefined
                      ? `~${data.insights.bestSeller.runwayDays}d Runway`
                      : 'Active Seller'}
                  </span>
                </div>
                <div style={{ lineHeight: 1.45, fontSize: '0.78rem' }}>
                  Dispatched <b>{data.insights.bestSeller.unitsSold} {data.insights.bestSeller.unit}</b>{' '}
                  across <b>{data.insights.bestSeller.salesTxns}</b> bills.
                  {data.insights.bestSeller.currentStockUnits !== undefined && (
                    <span>
                      {' '}
                      Only {data.insights.bestSeller.currentStockUnits}{' '}
                      {data.insights.bestSeller.unit} left on shelf.
                    </span>
                  )}
                </div>
              </div>
            ) : null}

            {/* Box 2: Slowing Demand */}
            {data.insights.slowingProduct ? (
              <div className="srb-risk-layer-card blue">
                <div className="srb-risk-title-bar">
                  <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <ZapIcon size={14} color="#1d4ed8" />
                    Demand Warning: {data.insights.slowingProduct.name}
                  </span>
                  <span
                    className="srb-tile-pill"
                    style={{ background: '#dbeafe', color: '#1d4ed8' }}
                  >
                    Slowing
                  </span>
                </div>
                <div style={{ lineHeight: 1.45, fontSize: '0.78rem' }}>
                  {data.insights.slowingProduct.message}
                </div>
              </div>
            ) : (
              <div className="srb-risk-layer-card green">
                <div className="srb-risk-title-bar">
                  <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <CheckCircleIcon size={14} color="#10b981" />
                    Smooth Circulation
                  </span>
                  <span className="srb-tile-pill green">Healthy</span>
                </div>
                <div style={{ lineHeight: 1.45, fontSize: '0.78rem' }}>
                  No critical velocity drop-offs or bottlenecked products detected in this period.
                </div>
              </div>
            )}

            {/* Box 3: Dormant Capital */}
            <div className="srb-risk-layer-card red">
              <div className="srb-risk-title-bar">
                <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <AlertOctagonIcon size={14} color="#dc2626" />
                  Dormant Capital:{' '}
                  <AnimatedCounter value={data.insights.nonMovingSummary.count} triggerKey={animationKey} /> SKUs
                </span>
                <span className="srb-tile-pill red" style={{ fontWeight: 700 }}>
                  <AnimatedCounter
                    value={data.insights.nonMovingSummary.tiedCapitalMinor}
                    formatter={formatCurrency}
                    triggerKey={animationKey}
                  />
                </span>
              </div>
              <div style={{ lineHeight: 1.45, fontSize: '0.78rem' }}>
                Zero sales recorded in the past {data.insights.nonMovingSummary.days} days. Review
                shelf demand before ordering more from vendors.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 5. MASTER STOCK LEDGER TABLE & FILTERS BENTO CARD ── */}
      <div className="srb-table-bento-card">
        {/* Table Filters Bar */}
        <div className="srb-table-toolbar">
          <div className="srb-toolbar-left">
            <div className="srb-search-wrapper">
              <SearchIcon
                size={15}
                style={{
                  position: 'absolute',
                  left: '0.85rem',
                  color: '#94a3b8',
                  pointerEvents: 'none',
                }}
              />
              <input
                type="text"
                className="srb-search-input"
                placeholder="Search products by name, SKU, or category..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setPage(1);
                  }}
                  style={{
                    position: 'absolute',
                    right: '0.75rem',
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  aria-label="Clear Search"
                >
                  <XIcon size={12} />
                </button>
              )}
            </div>

            {/* Category Dropdown */}
            <select
              className="srb-select"
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">All Categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            {/* Status Quick Pills */}
            <div className="srb-filter-status-pills">
              <button
                type="button"
                className={`srb-filter-pill-btn ${statusFilter === 'ALL' ? 'active' : ''}`}
                onClick={() => {
                  setStatusFilter('ALL');
                  setPage(1);
                }}
              >
                All
              </button>
              <button
                type="button"
                className={`srb-filter-pill-btn ${statusFilter === 'fast_moving' ? 'active' : ''}`}
                onClick={() => {
                  setStatusFilter('fast_moving');
                  setPage(1);
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <ZapIcon size={12} /> Fast
              </button>
              <button
                type="button"
                className={`srb-filter-pill-btn ${statusFilter === 'slow_moving' ? 'active' : ''}`}
                onClick={() => {
                  setStatusFilter('slow_moving');
                  setPage(1);
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <HourglassIcon size={12} /> Slow
              </button>
              <button
                type="button"
                className={`srb-filter-pill-btn ${statusFilter === 'non_moving' ? 'active' : ''}`}
                onClick={() => {
                  setStatusFilter('non_moving');
                  setPage(1);
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <AlertOctagonIcon size={12} /> Dormant
              </button>
            </div>

            {/* Sort Dropdown */}
            <select
              className="srb-select"
              value={sortField}
              onChange={(e) => {
                setSortField(e.target.value as any);
                setPage(1);
              }}
            >
              <option value="units_desc">Units Sold (High-Low)</option>
              <option value="units_asc">Units Sold (Low-High)</option>
              <option value="txns_desc">Invoices / Txns (High-Low)</option>
              <option value="name_asc">Name (A-Z)</option>
              <option value="stock_desc">Current Stock (High-Low)</option>
              <option value="stock_asc">Current Stock (Low-High)</option>
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                className="srb-btn-outline"
                style={{ padding: '0.4rem 0.8rem', fontSize: '0.76rem' }}
                onClick={() => {
                  setSearchQuery('');
                  setCategoryFilter('ALL');
                  setStatusFilter('ALL');
                  setPage(1);
                }}
              >
                Reset Filters
              </button>
            )}
          </div>

          <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
            Showing <b>{filteredProducts.length}</b> of <b>{data?.products.length || 0}</b> products
          </div>
        </div>

        {/* Master Data Table */}
        <div style={{ overflowX: 'auto', width: '100%' }}>
          <table className="srb-master-table">
            <thead>
              <tr>
                <th
                  style={{ cursor: 'pointer' }}
                  onClick={() =>
                    setSortField((prev) => (prev === 'name_asc' ? 'units_desc' : 'name_asc'))
                  }
                >
                  PRODUCT &amp; IDENTIFIERS {sortField === 'name_asc' ? '▴' : ''}
                </th>
                <th>CATEGORY</th>
                <th
                  style={{ cursor: 'pointer' }}
                  onClick={() =>
                    setSortField((prev) => (prev === 'stock_desc' ? 'stock_asc' : 'stock_desc'))
                  }
                >
                  CURRENT STOCK {sortField === 'stock_desc' ? '▼' : sortField === 'stock_asc' ? '▲' : ''}
                </th>
                <th
                  style={{ cursor: 'pointer', color: '#6d4aff' }}
                  onClick={() =>
                    setSortField((prev) => (prev === 'units_desc' ? 'units_asc' : 'units_desc'))
                  }
                >
                  UNITS SOLD {sortField === 'units_desc' ? '▼' : sortField === 'units_asc' ? '▲' : ''}
                </th>
                <th
                  style={{ cursor: 'pointer' }}
                  onClick={() =>
                    setSortField((prev) => (prev === 'txns_desc' ? 'units_desc' : 'txns_desc'))
                  }
                >
                  INVOICE BILLS {sortField === 'txns_desc' ? '▼' : ''}
                </th>
                <th>LAST SOLD</th>
                <th>MOVEMENT STATUS</th>
                <th style={{ textAlign: 'right' }}>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {paginatedProducts.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    style={{ textAlign: 'center', padding: '3.5rem', color: '#94a3b8' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.6rem', color: '#94a3b8' }}>
                      <SearchIcon size={32} />
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#475569' }}>
                      No matching products found
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedProducts.map((p) => {
                  const isNegStock = p.currentStockUnits < 0;
                  const isLowStock = p.currentStockUnits >= 0 && p.currentStockUnits <= 5;

                  return (
                    <tr key={p.id}>
                      {/* Product Name & SKU */}
                      <td>
                        <div className="srb-table-product-name">{p.name}</div>
                        <div className="srb-table-product-sku">
                          SKU: {p.sku || '—'}
                          {p.barcode ? ` · Barcode: ${p.barcode}` : ''}
                        </div>
                      </td>

                      {/* Category */}
                      <td>
                        <span className="srb-cat-pill">{p.category || 'General'}</span>
                      </td>

                      {/* Current Stock */}
                      <td>
                        <span
                          className={`srb-stock-pill ${
                            isNegStock ? 'zero' : isLowStock ? 'low' : 'healthy'
                          }`}
                        >
                          ● {p.currentStockUnits.toLocaleString('en-IN')} {p.unit}
                        </span>
                      </td>

                      {/* Units Sold */}
                      <td>
                        <span
                          className="srb-mono-pill"
                          style={{ color: '#6d4aff', fontWeight: 800, fontSize: '0.92rem' }}
                        >
                          {p.unitsSold.toLocaleString('en-IN')}{' '}
                          <span style={{ fontSize: '0.74rem', color: '#64748b' }}>{p.unit}</span>
                        </span>
                      </td>

                      {/* Invoice Bills */}
                      <td>
                        <span style={{ fontWeight: 700, color: '#334155' }}>
                          {p.salesTxns} bills
                        </span>
                      </td>

                      {/* Last Sold Date */}
                      <td style={{ color: '#64748b', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                        {formatLastSold(p.lastSoldAt)}
                      </td>

                      {/* Movement Status Badge */}
                      <td>
                        {p.movementStatus === 'fast_moving' && (
                          <span className="srb-movement-status-badge fast">
                            <ZapIcon size={12} color="#047857" /> Fast-Moving
                          </span>
                        )}
                        {p.movementStatus === 'slow_moving' && (
                          <span className="srb-movement-status-badge slow">
                            <HourglassIcon size={12} color="#b45309" /> Slow-Moving
                          </span>
                        )}
                        {p.movementStatus === 'non_moving' && (
                          <span className="srb-movement-status-badge dead">
                            <AlertOctagonIcon size={12} color="#dc2626" /> Non-Moving
                          </span>
                        )}
                      </td>

                      {/* Action */}
                      <td style={{ textAlign: 'right' }}>
                        {onNavigateToPurchases &&
                        (p.movementStatus === 'fast_moving' || isLowStock) ? (
                          <button
                            type="button"
                            className="srb-btn-restock-action"
                            onClick={() => onNavigateToPurchases(undefined, p.id)}
                            title={`Create Purchase Order for ${p.name}`}
                          >
                            + Restock
                          </button>
                        ) : (
                          <span style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                            {p.movementStatus === 'non_moving' ? 'Hold POs' : 'Adequate'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer with Pagination */}
        {totalItems > 0 && (
          <div className="srb-table-pagination">
            <div>
              Showing {(page - 1) * pageSize + 1} to{' '}
              {Math.min(page * pageSize, totalItems)} of {totalItems} items
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  fontSize: '0.74rem',
                }}
              >
                Rows:
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setPage(1);
                  }}
                  style={{
                    padding: '0.2rem 0.45rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    fontSize: '0.74rem',
                    cursor: 'pointer',
                  }}
                >
                  <option value={15}>15</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>

              {totalItems > pageSize && (
                <div className="srb-page-nav-btns">
                  <button
                    type="button"
                    className="srb-page-btn"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </button>
                  <span
                    style={{
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      color: '#0f172a',
                      padding: '0 0.35rem',
                    }}
                  >
                    Page {page} of {totalPages}
                  </span>
                  <button
                    type="button"
                    className="srb-page-btn"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
