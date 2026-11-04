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
} from './InventoryIcons.tsx';
import './DribbbleBentoStockReport.css';

interface ProductMovementAnalysisViewProps {
  categories: string[];
  onNavigateToPurchases?: (supplierId?: string, itemId?: string) => void;
  userRole?: string;
}

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
    link.setAttribute('download', `bento-stock-report-${new Date().toISOString().slice(0, 10)}.csv`);
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

  // Health score (fast moving percentage + 0.5 * slow moving percentage)
  const healthScore = Math.min(100, Math.round(fastPct + slowPct * 0.5));

  const hasActiveFilters = searchQuery !== '' || categoryFilter !== 'ALL' || statusFilter !== 'ALL';

  return (
    <div className="dribbble-bento-canvas">
      {/* ── 1. DRIBBLE BENTO TOP CONTROL BAR ── */}
      <div className="dribbble-bento-header">
        <div className="dribbble-header-left">
          <div className="dribbble-header-icon">
            <WarehouseIcon size={24} />
          </div>
          <div className="dribbble-header-title-box">
            <h1>
              Stock Movement Bento
              <span className="dribbble-pill-chip live">
                <span className="dot"></span> Live Sync
              </span>
            </h1>
            <p>
              Real-time product turnover analytics, sales velocity &amp; capital intelligence
            </p>
          </div>
        </div>

        <div className="dribbble-header-actions">
          {/* Date Range Switcher Pills */}
          <div className="dribbble-range-pills" role="radiogroup">
            <button
              type="button"
              className={`dribbble-range-btn ${selectedRange === '7d' ? 'active' : ''}`}
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
              className={`dribbble-range-btn ${selectedRange === '30d' ? 'active' : ''}`}
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
              className={`dribbble-range-btn ${selectedRange === '90d' ? 'active' : ''}`}
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
              className={`dribbble-range-btn ${selectedRange === 'custom' ? 'active' : ''}`}
              onClick={() => {
                setSelectedRange('custom');
                setShowCustomPicker(!showCustomPicker);
              }}
            >
              <CalendarIcon size={13} /> Custom
            </button>
          </div>

          {rangeDisplayLabel && (
            <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
              {rangeDisplayLabel}
            </span>
          )}

          <button
            type="button"
            className="dribbble-btn-subtle"
            onClick={() => loadAnalysis(true)}
            disabled={isRefreshing || loading}
            title="Refresh Data"
          >
            <RefreshCwIcon size={14} className={isRefreshing ? 'animate-spin' : ''} />
            {isRefreshing ? 'Syncing...' : 'Refresh'}
          </button>

          <button
            type="button"
            className="dribbble-btn-primary"
            onClick={handleExportCsv}
            disabled={!data || data.products.length === 0}
            title="Export CSV"
          >
            <DownloadIcon size={14} /> Export CSV
          </button>
        </div>
      </div>

      {/* Custom Date Range Popover */}
      {showCustomPicker && selectedRange === 'custom' && (
        <form onSubmit={handleApplyCustomRange} className="dribbble-custom-popover">
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b' }}>
            Custom Period:
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <label style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>From:</label>
            <input
              type="date"
              style={{
                padding: '0.4rem 0.65rem',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                fontSize: '0.82rem',
              }}
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              required
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <label style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>To:</label>
            <input
              type="date"
              style={{
                padding: '0.4rem 0.65rem',
                borderRadius: '10px',
                border: '1px solid #cbd5e1',
                fontSize: '0.82rem',
              }}
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="dribbble-btn-primary" style={{ padding: '0.4rem 0.85rem' }}>
            Apply Filter
          </button>
          <button
            type="button"
            className="dribbble-btn-subtle"
            style={{ padding: '0.4rem 0.75rem' }}
            onClick={() => setShowCustomPicker(false)}
          >
            Cancel
          </button>
        </form>
      )}

      {/* Error Card */}
      {error && (
        <div
          className="dribbble-card"
          style={{
            padding: '1.25rem 1.5rem',
            background: '#fef2f2',
            borderColor: '#fca5a5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#991b1b' }}>
            <AlertTriangleIcon size={20} color="#dc2626" />
            <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{error}</span>
          </div>
          <button type="button" className="dribbble-btn-subtle" onClick={() => loadAnalysis()}>
            Retry
          </button>
        </div>
      )}

      {/* ── 2. HERO BENTO DECK (3 ASYMMETRIC CARDS - IMAGES 1, 2 & 3) ── */}
      {summary && (
        <div className="dribbble-hero-grid">
          {/* Card 1: Velocity Pulse (Mint Gradient - Image 1 & 3) */}
          <div className="dribbble-card dribbble-card-mint">
            <div>
              <div className="dribbble-card-top-row">
                <span className="dribbble-card-label mint">
                  <ZapIcon size={14} color="#059669" /> Velocity Pulse
                </span>
                <span className="dribbble-pill-chip" style={{ background: '#dcfce7', color: '#065f46', borderColor: '#a7f3d0' }}>
                  {fastPct}% High Velocity
                </span>
              </div>
              <div className="dribbble-big-metric mint">
                {summary.totalUnitsSold.toLocaleString('en-IN')}{' '}
                <span style={{ fontSize: '1.1rem', fontWeight: 600 }}>units</span>
              </div>
              <div className="dribbble-sub-desc mint">
                Dispatched across <b>{summary.totalSalesBills}</b> completed customer invoices
              </div>
            </div>

            {/* Inset Neumorphic Capsule Bars (Image 1 "Home Energy Overview" & Image 3) */}
            <div className="dribbble-mini-bars-well">
              <div className="dribbble-capsule-col">
                <div className="dribbble-capsule-bar" style={{ height: '45%' }} />
              </div>
              <div className="dribbble-capsule-col">
                <div className="dribbble-capsule-bar" style={{ height: '70%' }} />
              </div>
              <div className="dribbble-capsule-col">
                <div className="dribbble-capsule-bar" style={{ height: '95%' }} />
              </div>
              <div className="dribbble-capsule-col">
                <div className="dribbble-capsule-bar" style={{ height: '60%' }} />
              </div>
              <div className="dribbble-capsule-col">
                <div className="dribbble-capsule-bar" style={{ height: '85%' }} />
              </div>
              <div className="dribbble-capsule-col">
                <div className="dribbble-capsule-bar" style={{ height: '100%' }} />
              </div>
            </div>
          </div>

          {/* Card 2: Dark Contrast Obsidian Card (Image 3 "NAPPAY BACK") */}
          <div className="dribbble-card dribbble-card-dark">
            <div>
              <div className="dribbble-card-top-row">
                <span className="dribbble-card-label dark">
                  <RupeeIcon size={14} color="#38bdf8" /> Portfolio Capital
                </span>
                <span className="dribbble-pill-chip" style={{ background: 'rgba(255,255,255,0.1)', color: '#38bdf8', borderColor: 'rgba(56,189,248,0.3)' }}>
                  Asset Valuation
                </span>
              </div>
              <div className="dribbble-big-metric dark">
                {invStats?.totalStockValueMinor != null
                  ? formatCurrency(invStats.totalStockValueMinor)
                  : data?.insights.nonMovingSummary.tiedCapitalMinor
                  ? formatCurrency(data.insights.nonMovingSummary.tiedCapitalMinor)
                  : '₹0'}
              </div>
              <div className="dribbble-sub-desc dark">
                Total valuation in active PostgreSQL item inventory
              </div>
            </div>

            {/* Inset Neon Well */}
            <div className="dribbble-dark-inset-well">
              <div className="dribbble-dark-stat-item">
                <span className="lbl">Active Items</span>
                <span className="val cyan">{summary.totalTrackedProducts} SKUs</span>
              </div>
              <div style={{ width: '1px', height: '24px', background: 'rgba(255,255,255,0.15)' }} />
              <div className="dribbble-dark-stat-item">
                <span className="lbl">Dormant Capital</span>
                <span className="val fuchsia">
                  {formatCurrency(data?.insights.nonMovingSummary.tiedCapitalMinor || 0)}
                </span>
              </div>
            </div>
          </div>

          {/* Card 3: Radial Speedo / Circulation Meter (Image 1 "Wellness Score 84%" & Image 2) */}
          <div className="dribbble-card dribbble-card-radial">
            <div>
              <div className="dribbble-card-top-row">
                <span className="dribbble-card-label purple">
                  <CheckCircleIcon size={14} color="#7c3aed" /> Circulation Index
                </span>
                <span className="dribbble-pill-chip" style={{ background: '#ede9fe', color: '#6d28d9', borderColor: '#ddd6fe' }}>
                  {healthScore >= 70 ? 'Optimal' : 'Attention'}
                </span>
              </div>
              <div className="dribbble-sub-desc purple" style={{ marginTop: '0' }}>
                Inventory health &amp; turnover velocity distribution
              </div>
            </div>

            {/* Circular Speedo Gauge */}
            <div className="dribbble-radial-widget">
              <div className="dribbble-radial-svg-box">
                <svg width="80" height="80" viewBox="0 0 80 80">
                  <circle
                    cx="40"
                    cy="40"
                    r="32"
                    fill="none"
                    stroke="#e2e8f0"
                    strokeWidth="7"
                  />
                  <circle
                    cx="40"
                    cy="40"
                    r="32"
                    fill="none"
                    stroke="url(#radialGradient)"
                    strokeWidth="7"
                    strokeLinecap="round"
                    strokeDasharray="201.06"
                    strokeDashoffset={201.06 * (1 - healthScore / 100)}
                    transform="rotate(-90 40 40)"
                    style={{ transition: 'stroke-dashoffset 0.6s ease' }}
                  />
                  <defs>
                    <linearGradient id="radialGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#10b981" />
                      <stop offset="100%" stopColor="#6366f1" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="dribbble-radial-text">{healthScore}%</div>
              </div>

              <div className="dribbble-radial-legend">
                <div className="dribbble-legend-line">
                  <span><span className="dribbble-legend-dot green"></span>Fast-Moving:</span>
                  <span style={{ color: '#047857' }}>{fastPct}%</span>
                </div>
                <div className="dribbble-legend-line">
                  <span><span className="dribbble-legend-dot amber"></span>Slow-Moving:</span>
                  <span style={{ color: '#b45309' }}>{slowPct}%</span>
                </div>
                <div className="dribbble-legend-line">
                  <span><span className="dribbble-legend-dot red"></span>Non-Moving:</span>
                  <span style={{ color: '#dc2626' }}>{nonPct}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 3. SECONDARY BENTO KPI TILES (4 MODULAR SQUARES - IMAGE 1) ── */}
      {summary && (
        <div className="dribbble-kpi-quad">
          {/* Card A: Fast-Moving */}
          <div
            className={`dribbble-stat-tile ${statusFilter === 'fast_moving' ? 'active-green' : ''}`}
            onClick={() => {
              setStatusFilter((prev) => (prev === 'fast_moving' ? 'ALL' : 'fast_moving'));
              setPage(1);
            }}
          >
            <div className="dribbble-card-top-row">
              <div className="dribbble-tile-icon-box green">
                <ZapIcon size={16} />
              </div>
              <span className="dribbble-pill-chip" style={{ background: '#ecfdf5', color: '#065f46' }}>
                {fastPct}%
              </span>
            </div>
            <div>
              <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#64748b' }}>FAST-MOVING</div>
              <div className="dribbble-stat-tile-num green">{summary.fastMovingCount}</div>
            </div>
            <div className="dribbble-stat-tile-footer">
              <span>≥ {summary.fastMinUnits} units or ≥ {summary.fastMinTxns} bills</span>
              <ArrowRightIcon size={12} color="#059669" />
            </div>
          </div>

          {/* Card B: Slow-Moving */}
          <div
            className={`dribbble-stat-tile ${statusFilter === 'slow_moving' ? 'active-amber' : ''}`}
            onClick={() => {
              setStatusFilter((prev) => (prev === 'slow_moving' ? 'ALL' : 'slow_moving'));
              setPage(1);
            }}
          >
            <div className="dribbble-card-top-row">
              <div className="dribbble-tile-icon-box amber">
                <HourglassIcon size={16} />
              </div>
              <span className="dribbble-pill-chip" style={{ background: '#fffbeb', color: '#92400e' }}>
                {slowPct}%
              </span>
            </div>
            <div>
              <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#64748b' }}>SLOW-MOVING</div>
              <div className="dribbble-stat-tile-num amber">{summary.slowMovingCount}</div>
            </div>
            <div className="dribbble-stat-tile-footer">
              <span>1–{summary.fastMinUnits - 1} units in period</span>
              <ArrowRightIcon size={12} color="#d97706" />
            </div>
          </div>

          {/* Card C: Dead Stock */}
          <div
            className={`dribbble-stat-tile ${statusFilter === 'non_moving' ? 'active-red' : ''}`}
            onClick={() => {
              setStatusFilter((prev) => (prev === 'non_moving' ? 'ALL' : 'non_moving'));
              setPage(1);
            }}
          >
            <div className="dribbble-card-top-row">
              <div className="dribbble-tile-icon-box red">
                <AlertOctagonIcon size={16} />
              </div>
              <span className="dribbble-pill-chip" style={{ background: '#fef2f2', color: '#991b1b' }}>
                {nonPct}%
              </span>
            </div>
            <div>
              <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#64748b' }}>DEAD STOCK</div>
              <div className="dribbble-stat-tile-num red">{summary.nonMovingCount}</div>
            </div>
            <div className="dribbble-stat-tile-footer">
              <span>0 sales in past {summary.rangeDays} days</span>
              <ArrowRightIcon size={12} color="#dc2626" />
            </div>
          </div>

          {/* Card D: Active SKUs */}
          <div
            className={`dribbble-stat-tile ${statusFilter === 'ALL' && categoryFilter === 'ALL' && !searchQuery ? 'active-purple' : ''}`}
            onClick={() => {
              setStatusFilter('ALL');
              setCategoryFilter('ALL');
              setSearchQuery('');
              setPage(1);
            }}
          >
            <div className="dribbble-card-top-row">
              <div className="dribbble-tile-icon-box purple">
                <PackageIcon size={16} />
              </div>
              <span className="dribbble-pill-chip" style={{ background: '#ede9fe', color: '#6d28d9' }}>
                {categories.length} Cats
              </span>
            </div>
            <div>
              <div style={{ fontSize: '0.76rem', fontWeight: 700, color: '#64748b' }}>ACTIVE CATALOGUE</div>
              <div className="dribbble-stat-tile-num purple">{summary.totalTrackedProducts}</div>
            </div>
            <div className="dribbble-stat-tile-footer">
              <span>Across {summary.totalSalesBills} bills</span>
              <ArrowRightIcon size={12} color="#6366f1" />
            </div>
          </div>
        </div>
      )}

      {/* ── 4. VISUAL INTELLIGENCE BENTO (TOP SELLERS & AI RISK - IMAGE 1 & 2) ── */}
      {data && (
        <div className="dribbble-visual-grid">
          {/* Card 1: Top 10 Best Sellers (Span 7) */}
          <div className="dribbble-card dribbble-sellers-card">
            <div className="dribbble-section-heading">
              <h2>
                <TrophyIcon size={18} color="#d97706" /> Top 10 Best-Selling Products
              </h2>
              <span className="dribbble-pill-chip">By Quantity Sold</span>
            </div>

            {topSellers.length === 0 ? (
              <div style={{ padding: '3rem 1rem', textAlign: 'center', color: '#94a3b8' }}>
                No completed sales recorded during this date window.
              </div>
            ) : (
              <div>
                {topSellers.map((item, idx) => {
                  const pct = Math.max(8, Math.min(100, (item.unitsSold / topSellerMax) * 100));
                  const rankClass =
                    idx === 0 ? 'gold' : idx === 1 ? 'silver' : idx === 2 ? 'bronze' : 'default';

                  return (
                    <div key={item.id || idx} className="dribbble-seller-row">
                      <div className={`dribbble-rank-tag ${rankClass}`}>
                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                      </div>
                      <span className="dribbble-seller-name" title={item.name}>
                        {item.name}
                      </span>
                      <div className="dribbble-progress-capsule">
                        <div className="dribbble-progress-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="dribbble-seller-qty">
                        {item.unitsSold.toLocaleString('en-IN')}{' '}
                        <span style={{ fontSize: '0.72rem', color: '#64748b' }}>{item.unit}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Card 2: Grounded Risk Intelligence (Span 5 - Image 2 Nested Box Aesthetic) */}
          <div className="dribbble-card dribbble-risk-card">
            <div className="dribbble-section-heading">
              <h2>
                <BrainIcon size={18} color="#6366f1" /> Grounded Risk Intelligence
              </h2>
              <span className="dribbble-pill-chip live">
                <span className="dot"></span> Live Sync
              </span>
            </div>

            {/* Box 1: Best Seller Runway */}
            {data.insights.bestSeller ? (
              <div className="dribbble-risk-nested-box gold">
                <div className="dribbble-risk-top">
                  <span className="dribbble-risk-title">
                    <TrophyIcon size={14} color="#b45309" />
                    Top Seller: {data.insights.bestSeller.name}
                  </span>
                  <span className="dribbble-pill-chip" style={{ background: '#fef3c7', color: '#b45309' }}>
                    {data.insights.bestSeller.runwayDays !== null &&
                    data.insights.bestSeller.runwayDays !== undefined
                      ? `~${data.insights.bestSeller.runwayDays}d Runway`
                      : 'Active Seller'}
                  </span>
                </div>
                <p className="dribbble-risk-desc">
                  Generated <b>{data.insights.bestSeller.unitsSold} {data.insights.bestSeller.unit}</b> across{' '}
                  <b>{data.insights.bestSeller.salesTxns}</b> bills.
                  {data.insights.bestSeller.currentStockUnits !== undefined && (
                    <span> Current shelf inventory is {data.insights.bestSeller.currentStockUnits} {data.insights.bestSeller.unit}.</span>
                  )}
                </p>
                {onNavigateToPurchases && (
                  <button
                    type="button"
                    className="dribbble-btn-subtle"
                    style={{ padding: '0.25rem 0.65rem', fontSize: '0.74rem', marginTop: '0.45rem' }}
                    onClick={() => onNavigateToPurchases()}
                  >
                    + Reorder Product
                  </button>
                )}
              </div>
            ) : null}

            {/* Box 2: Slowing Demand */}
            {data.insights.slowingProduct ? (
              <div className="dribbble-risk-nested-box blue">
                <div className="dribbble-risk-top">
                  <span className="dribbble-risk-title">
                    <ZapIcon size={14} color="#2563eb" />
                    Demand Warning: {data.insights.slowingProduct.name}
                  </span>
                  <span className="dribbble-pill-chip" style={{ background: '#dbeafe', color: '#1d4ed8' }}>
                    Slowing
                  </span>
                </div>
                <p className="dribbble-risk-desc">
                  {data.insights.slowingProduct.message}
                </p>
              </div>
            ) : (
              <div className="dribbble-risk-nested-box" style={{ borderLeft: '4px solid #10b981' }}>
                <div className="dribbble-risk-top">
                  <span className="dribbble-risk-title" style={{ color: '#047857' }}>
                    <CheckCircleIcon size={14} color="#10b981" />
                    Smooth Circulation
                  </span>
                  <span className="dribbble-pill-chip" style={{ background: '#d1fae5', color: '#047857' }}>
                    Healthy
                  </span>
                </div>
                <p className="dribbble-risk-desc">
                  No critical velocity drop-offs or bottlenecked products detected.
                </p>
              </div>
            )}

            {/* Box 3: Dormant Capital */}
            <div className="dribbble-risk-nested-box rose">
              <div className="dribbble-risk-top">
                <span className="dribbble-risk-title">
                  <AlertOctagonIcon size={14} color="#dc2626" />
                  Dormant Capital: {data.insights.nonMovingSummary.count} SKUs
                </span>
                <span className="dribbble-pill-chip" style={{ background: '#fee2e2', color: '#dc2626', fontWeight: 800 }}>
                  {formatCurrency(data.insights.nonMovingSummary.tiedCapitalMinor)}
                </span>
              </div>
              <p className="dribbble-risk-desc">
                Zero sales recorded in the past {data.insights.nonMovingSummary.days} days. Review shelf demand before ordering more from suppliers.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── 5. MASTER STOCK LEDGER TABLE (BENTO CONTAINER) ── */}
      <div className="dribbble-card dribbble-table-card">
        {/* Controls Bar */}
        <div className="dribbble-table-controls">
          <div className="dribbble-controls-left">
            {/* Search Pill */}
            <div className="dribbble-search-pill-box">
              <SearchIcon
                size={16}
                style={{
                  position: 'absolute',
                  left: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#94a3b8',
                }}
              />
              <input
                type="text"
                placeholder="Search products by name, SKU or category..."
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
                    right: '12px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                  }}
                >
                  <XIcon size={13} />
                </button>
              )}
            </div>

            {/* Category Dropdown Pill */}
            <select
              className="dribbble-select-pill"
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">All Categories ▾</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            {/* Movement Status Pill */}
            <select
              className="dribbble-select-pill"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">All Movement Status ▾</option>
              <option value="fast_moving">⚡ Fast-Moving</option>
              <option value="slow_moving">⏳ Slow-Moving</option>
              <option value="non_moving">🛑 Non-Moving</option>
            </select>

            {/* Sorting Pill */}
            <select
              className="dribbble-select-pill"
              value={sortField}
              onChange={(e) => {
                setSortField(e.target.value as any);
                setPage(1);
              }}
            >
              <option value="units_desc">Sort: Units Sold (High-Low)</option>
              <option value="units_asc">Sort: Units Sold (Low-High)</option>
              <option value="txns_desc">Sort: Invoices / Bills (High-Low)</option>
              <option value="name_asc">Sort: Product Name (A-Z)</option>
              <option value="stock_desc">Sort: Current Stock (High-Low)</option>
              <option value="stock_asc">Sort: Current Stock (Low-High)</option>
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                className="dribbble-btn-subtle"
                style={{ padding: '0.4rem 0.75rem', borderRadius: '9999px', fontSize: '0.78rem' }}
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
          <table className="dribbble-ledger-table">
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
                  style={{ cursor: 'pointer', color: '#6366f1' }}
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
                  BILLS {sortField === 'txns_desc' ? '▼' : ''}
                </th>
                <th>LAST SOLD</th>
                <th>MOVEMENT STATUS</th>
                <th style={{ textAlign: 'right' }}>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {paginatedProducts.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '3.5rem', color: '#94a3b8' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '0.4rem' }}>🔍</div>
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
                        <div className="dribbble-table-prod-name">{p.name}</div>
                        <div className="dribbble-table-prod-sub">
                          SKU: {p.sku || '—'}
                          {p.barcode ? ` · Barcode: ${p.barcode}` : ''}
                        </div>
                      </td>

                      {/* Category */}
                      <td>
                        <span className="dribbble-pill-chip" style={{ fontSize: '0.72rem' }}>
                          {p.category || 'General'}
                        </span>
                      </td>

                      {/* Current Stock */}
                      <td>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontWeight: 700,
                            color: isNegStock ? '#dc2626' : isLowStock ? '#d97706' : '#1e293b',
                          }}
                        >
                          {p.currentStockUnits.toLocaleString('en-IN')} {p.unit}
                        </span>
                      </td>

                      {/* Units Sold */}
                      <td>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontWeight: 800,
                            color: '#6366f1',
                            fontSize: '0.92rem',
                          }}
                        >
                          {p.unitsSold.toLocaleString('en-IN')} {p.unit}
                        </span>
                      </td>

                      {/* Bills */}
                      <td>
                        <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                          {p.salesTxns}
                        </span>
                      </td>

                      {/* Last Sold Date */}
                      <td style={{ color: '#64748b', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                        {formatLastSold(p.lastSoldAt)}
                      </td>

                      {/* Movement Status Badge */}
                      <td>
                        {p.movementStatus === 'fast_moving' && (
                          <span className="dribbble-badge-pill green">
                            <ZapIcon size={12} color="#047857" /> Fast-Moving
                          </span>
                        )}
                        {p.movementStatus === 'slow_moving' && (
                          <span className="dribbble-badge-pill amber">
                            <HourglassIcon size={12} color="#b45309" /> Slow-Moving
                          </span>
                        )}
                        {p.movementStatus === 'non_moving' && (
                          <span className="dribbble-badge-pill red">
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
                            className="dribbble-btn-subtle"
                            style={{ padding: '0.25rem 0.65rem', fontSize: '0.74rem' }}
                            onClick={() => onNavigateToPurchases(undefined, p.id)}
                            title={`Create Purchase Order for ${p.name}`}
                          >
                            + Restock
                          </button>
                        ) : (
                          <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
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
          <div className="dribbble-table-footer">
            <div>
              Showing {(page - 1) * pageSize + 1} to{' '}
              {Math.min(page * pageSize, totalItems)} of {totalItems} products
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.76rem' }}>
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
                    fontSize: '0.76rem',
                  }}
                >
                  <option value={15}>15</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>

              {totalItems > pageSize && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                  <button
                    type="button"
                    className="dribbble-btn-subtle"
                    style={{ padding: '0.25rem 0.65rem', fontSize: '0.74rem' }}
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </button>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    className="dribbble-btn-subtle"
                    style={{ padding: '0.25rem 0.65rem', fontSize: '0.74rem' }}
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
