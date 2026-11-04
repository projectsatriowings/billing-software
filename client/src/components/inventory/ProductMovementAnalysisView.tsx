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

    // Search query (name, sku, barcode, category)
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
    link.setAttribute('download', `stock-report-${new Date().toISOString().slice(0, 10)}.csv`);
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

  const hasActiveFilters = searchQuery !== '' || categoryFilter !== 'ALL' || statusFilter !== 'ALL';

  return (
    <div className="inventory-module-wrapper">
      {/* ── 1. MODULE TITLE BAR (EXACT INVENTORY HUB HEADER) ── */}
      <div className="inventory-title-bar">
        <div className="title-left">
          <div className="title-row">
            <div className="title-icon-box">
              <WarehouseIcon size={20} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                <h1 className="inventory-heading">Stock Report</h1>
                <span className="badge-live-sync" title="Connected to PostgreSQL stock ledger">
                  <span className="live-indicator-dot"></span>
                  Neon PostgreSQL Live
                </span>
                <span className="inventory-title-subtitle">
                  • Product movement velocity, fast/slow turnover &amp; dead stock analysis
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="title-actions">
          <button
            type="button"
            className="btn-inv-header-outline"
            onClick={() => loadAnalysis(true)}
            disabled={isRefreshing || loading}
            title="Refresh Stock Movement Analytics"
          >
            <RefreshCwIcon size={14} className={isRefreshing ? 'animate-spin' : ''} />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>

          <button
            type="button"
            className="btn-inv-header-primary"
            onClick={handleExportCsv}
            disabled={!data || data.products.length === 0}
            title="Export Stock Report to CSV"
          >
            <DownloadIcon size={14} /> Export CSV
          </button>
        </div>
      </div>

      {/* ── 2. ERROR STATE ── */}
      {error && (
        <div className="service-business-notice-card" style={{ background: '#fef2f2', borderColor: '#fca5a5' }}>
          <AlertTriangleIcon size={20} style={{ color: '#dc2626', flexShrink: 0 }} />
          <div style={{ flex: 1, color: '#991b1b' }}>
            <strong>Analytics Error:</strong> {error}
          </div>
          <button
            type="button"
            className="btn-action-small"
            onClick={() => loadAnalysis()}
          >
            Retry
          </button>
        </div>
      )}

      {/* ── 3. BENTO STYLE LAYOUT (2-TIER BALANCED BENTO GRID) ── */}
      {summary && (
        <div className="inventory-bento-grid">
          {/* BENTO HERO TILE 1: Movement Pulse & Valuation */}
          <div className="bento-card bento-hero-valuation">
            <div className="bento-card-header">
              <div className="bento-header-left">
                <div className="bento-icon-badge indigo">
                  <RupeeIcon size={15} />
                </div>
                <div>
                  <span className="bento-card-title">Movement &amp; Valuation</span>
                  <span className="bento-card-subtitle">Real-time units sold &amp; portfolio</span>
                </div>
              </div>
              <span className="badge-live-sync-pill" title="Live PostgreSQL Data Window">
                <span className="live-indicator-dot-sm"></span>
                Live Sync
              </span>
            </div>

            <div className="bento-hero-val-num">
              {summary.totalUnitsSold.toLocaleString('en-IN')}{' '}
              <span style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                units sold
              </span>
              {invStats?.totalStockValueMinor != null && (
                <span
                  style={{
                    fontSize: '0.95rem',
                    fontWeight: 600,
                    color: 'var(--text-dim)',
                    marginLeft: '0.65rem',
                  }}
                  title="Current Item Master Inventory Valuation"
                >
                  • ₹{((invStats.totalStockValueMinor || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })} value
                </span>
              )}
            </div>

            <div className="bento-health-section">
              <div className="bento-health-bar">
                <div
                  className="health-seg green"
                  style={{ width: `${fastPct}%` }}
                  title={`Fast-Moving: ${summary.fastMovingCount} (${fastPct}%)`}
                />
                <div
                  className="health-seg amber"
                  style={{ width: `${slowPct}%` }}
                  title={`Slow-Moving: ${summary.slowMovingCount} (${slowPct}%)`}
                />
                <div
                  className="health-seg rose"
                  style={{ width: `${nonPct}%` }}
                  title={`Non-Moving: ${summary.nonMovingCount} (${nonPct}%)`}
                />
              </div>
              <div className="bento-health-legend">
                <span className="legend-tag">
                  <span className="legend-dot green"></span>
                  Fast: <strong className="text-green">{fastPct}%</strong> ({summary.fastMovingCount})
                </span>
                <span className="legend-tag">
                  <span className="legend-dot amber"></span>
                  Slow: <strong className="text-amber">{slowPct}%</strong> ({summary.slowMovingCount})
                </span>
                <span className="legend-tag">
                  <span className="legend-dot rose"></span>
                  Non-Moving: <strong className="text-red">{nonPct}%</strong> ({summary.nonMovingCount})
                </span>
              </div>
            </div>
          </div>

          {/* BENTO HERO TILE 2: Restock & Movement Action Center */}
          <div
            className={`bento-card bento-hero-alert ${
              summary.nonMovingCount > 0 ? 'alert-critical' : 'alert-healthy'
            }`}
          >
            <div className="bento-card-header">
              <div className="bento-header-left">
                <div
                  className={`bento-icon-badge ${
                    summary.nonMovingCount > 0 ? 'pulse-red' : 'green'
                  }`}
                >
                  {summary.nonMovingCount > 0 ? (
                    <AlertOctagonIcon size={16} />
                  ) : (
                    <CheckCircleIcon size={16} />
                  )}
                </div>
                <div>
                  <span className="bento-card-title">Turnover &amp; Action Center</span>
                  <span className="bento-card-subtitle">Supply replenishment &amp; dead stock</span>
                </div>
              </div>
              <span
                className={`bento-alert-badge ${
                  summary.nonMovingCount > 0 ? 'red' : 'green'
                }`}
              >
                {summary.nonMovingCount > 0 ? 'Action Needed' : 'Healthy Velocity'}
              </span>
            </div>

            <div className="bento-alert-headline">
              {summary.nonMovingCount > 0 && (
                <span className="text-red">
                  <strong>{summary.nonMovingCount}</strong> Non-Moving
                </span>
              )}
              {summary.nonMovingCount > 0 && summary.slowMovingCount > 0 && (
                <span className="alert-sep">•</span>
              )}
              {summary.slowMovingCount > 0 && (
                <span className="text-amber">
                  <strong>{summary.slowMovingCount}</strong> Slow Buffer
                </span>
              )}
              {summary.fastMovingCount > 0 && <span className="alert-sep">•</span>}
              {summary.fastMovingCount > 0 && (
                <span className="text-green">
                  <strong>{summary.fastMovingCount}</strong> Fast Moving
                </span>
              )}
            </div>

            <div className="bento-alert-actions">
              <button
                type="button"
                className="bento-btn-action red"
                onClick={() => {
                  setStatusFilter(statusFilter === 'non_moving' ? 'ALL' : 'non_moving');
                  setPage(1);
                }}
              >
                Review Non-Moving <ArrowRightIcon size={12} />
              </button>
              <button
                type="button"
                className="bento-btn-action amber"
                onClick={() => {
                  setStatusFilter(statusFilter === 'slow_moving' ? 'ALL' : 'slow_moving');
                  setPage(1);
                }}
              >
                Review Slow-Moving
              </button>
              {onNavigateToPurchases && (
                <button
                  type="button"
                  className="bento-btn-action secondary"
                  onClick={() => onNavigateToPurchases()}
                >
                  Open Purchases
                </button>
              )}
            </div>
          </div>

          {/* BENTO CARD 3: Fast-Moving (Row 2, Span 3) */}
          <div
            className={`bento-card bento-stat-card ${
              statusFilter === 'fast_moving' ? 'bento-filter-active active-green' : ''
            }`}
            onClick={() => {
              setStatusFilter((prev) => (prev === 'fast_moving' ? 'ALL' : 'fast_moving'));
              setPage(1);
            }}
            title={
              statusFilter === 'fast_moving'
                ? 'Click to clear fast-moving filter'
                : 'Click to filter fast-moving items'
            }
          >
            <div className="bento-card-header">
              <div className="bento-header-left">
                <div className="bento-icon-badge green">
                  <ZapIcon size={15} />
                </div>
                <span className="bento-card-title">Fast-Moving</span>
              </div>
              <span className="kpi-sub-badge green">{fastPct}%</span>
            </div>
            <div className="bento-stat-num mono text-green">
              {summary.fastMovingCount}
            </div>
            <div className="bento-card-footer">
              <span>
                {statusFilter === 'fast_moving'
                  ? '✓ Filter active (Click to reset)'
                  : `≥ ${summary.fastMinUnits} units or ≥ ${summary.fastMinTxns} bills`}
              </span>
              <span className="bento-link-arrow">
                <ArrowRightIcon size={12} />
              </span>
            </div>
          </div>

          {/* BENTO CARD 4: Slow-Moving (Row 2, Span 3) */}
          <div
            className={`bento-card bento-stat-card ${
              statusFilter === 'slow_moving' ? 'bento-filter-active active-amber' : ''
            }`}
            onClick={() => {
              setStatusFilter((prev) => (prev === 'slow_moving' ? 'ALL' : 'slow_moving'));
              setPage(1);
            }}
            title={
              statusFilter === 'slow_moving'
                ? 'Click to clear slow-moving filter'
                : 'Click to filter slow-moving items'
            }
          >
            <div className="bento-card-header">
              <div className="bento-header-left">
                <div className="bento-icon-badge amber">
                  <HourglassIcon size={15} />
                </div>
                <span className="bento-card-title">Slow-Moving</span>
              </div>
              <span className="kpi-sub-badge amber">{slowPct}%</span>
            </div>
            <div className="bento-stat-num mono text-amber">
              {summary.slowMovingCount}
            </div>
            <div className="bento-card-footer">
              <span>
                {statusFilter === 'slow_moving'
                  ? '✓ Filter active (Click to reset)'
                  : `1–${summary.fastMinUnits - 1} units sold in period`}
              </span>
              <span className="bento-link-arrow">
                <ArrowRightIcon size={12} />
              </span>
            </div>
          </div>

          {/* BENTO CARD 5: Non-Moving / Dead Stock (Row 2, Span 3) */}
          <div
            className={`bento-card bento-stat-card ${
              statusFilter === 'non_moving' ? 'bento-filter-active active-red' : ''
            }`}
            onClick={() => {
              setStatusFilter((prev) => (prev === 'non_moving' ? 'ALL' : 'non_moving'));
              setPage(1);
            }}
            title={
              statusFilter === 'non_moving'
                ? 'Click to clear non-moving filter'
                : 'Click to filter non-moving items'
            }
          >
            <div className="bento-card-header">
              <div className="bento-header-left">
                <div className="bento-icon-badge red">
                  <AlertOctagonIcon size={15} />
                </div>
                <span className="bento-card-title">Non-Moving</span>
              </div>
              <span className="kpi-sub-badge red">{nonPct}%</span>
            </div>
            <div className="bento-stat-num mono text-red">
              {summary.nonMovingCount}
            </div>
            <div className="bento-card-footer">
              <span>
                {statusFilter === 'non_moving'
                  ? '✓ Filter active (Click to reset)'
                  : `0 sales in past ${summary.rangeDays} days`}
              </span>
              <span className="bento-link-arrow">
                <ArrowRightIcon size={12} />
              </span>
            </div>
          </div>

          {/* BENTO CARD 6: Active Items / Total Tracked (Row 2, Span 3) */}
          <div
            className={`bento-card bento-stat-card ${
              statusFilter === 'ALL' && categoryFilter === 'ALL' && !searchQuery
                ? 'bento-filter-active active-purple'
                : ''
            }`}
            onClick={() => {
              setStatusFilter('ALL');
              setCategoryFilter('ALL');
              setSearchQuery('');
              setPage(1);
            }}
            title="Click to view all active catalog items"
          >
            <div className="bento-card-header">
              <div className="bento-header-left">
                <div className="bento-icon-badge purple">
                  <PackageIcon size={15} />
                </div>
                <span className="bento-card-title">Active Items</span>
              </div>
              <span className="kpi-sub-badge purple" title={`${categories.length} Categories`}>
                {categories.length} Cats
              </span>
            </div>
            <div className="bento-stat-num mono">
              {summary.totalTrackedProducts}
            </div>
            <div className="bento-card-footer">
              <span>
                {statusFilter === 'ALL' && categoryFilter === 'ALL' && !searchQuery
                  ? '✓ Showing all products'
                  : `Across ${summary.totalSalesBills} bills`}
              </span>
              <span className="bento-link-arrow">
                <ArrowRightIcon size={12} />
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── 4. SUB-NAVIGATION BAR (DATE RANGE SWITCHER) ── */}
      <div className="inventory-nav-tabs-bar">
        <button
          type="button"
          className={`inv-tab-btn ${selectedRange === '7d' ? 'active' : ''}`}
          onClick={() => {
            setSelectedRange('7d');
            setShowCustomPicker(false);
            setPage(1);
          }}
        >
          <span>Last 7 Days</span>
        </button>
        <button
          type="button"
          className={`inv-tab-btn ${selectedRange === '30d' ? 'active' : ''}`}
          onClick={() => {
            setSelectedRange('30d');
            setShowCustomPicker(false);
            setPage(1);
          }}
        >
          <span>Last 30 Days</span>
        </button>
        <button
          type="button"
          className={`inv-tab-btn ${selectedRange === '90d' ? 'active' : ''}`}
          onClick={() => {
            setSelectedRange('90d');
            setShowCustomPicker(false);
            setPage(1);
          }}
        >
          <span>Last 90 Days</span>
        </button>
        <button
          type="button"
          className={`inv-tab-btn ${selectedRange === 'custom' ? 'active' : ''}`}
          onClick={() => {
            setSelectedRange('custom');
            setShowCustomPicker(!showCustomPicker);
          }}
        >
          <CalendarIcon size={14} />
          <span>Custom Range</span>
        </button>

        {rangeDisplayLabel && (
          <span
            style={{
              marginLeft: 'auto',
              paddingRight: '0.85rem',
              fontSize: '0.78rem',
              color: 'var(--text-muted)',
              fontWeight: 600,
            }}
          >
            📅 {rangeDisplayLabel}
          </span>
        )}
      </div>

      {/* Custom Date Range Popover */}
      {showCustomPicker && selectedRange === 'custom' && (
        <form
          onSubmit={handleApplyCustomRange}
          className="inv-table-filters-card"
          style={{ gap: '0.75rem', marginTop: '-0.35rem' }}
        >
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-main)' }}>
            Custom Date Range:
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>From:</label>
            <input
              type="date"
              className="inv-search-input"
              style={{ width: '150px', height: '34px', padding: '0 0.5rem' }}
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              required
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>To:</label>
            <input
              type="date"
              className="inv-search-input"
              style={{ width: '150px', height: '34px', padding: '0 0.5rem' }}
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            className="btn-inv-header-primary"
            style={{ padding: '0.35rem 0.85rem' }}
          >
            Apply Range
          </button>
          <button
            type="button"
            className="btn-inv-header-outline"
            style={{ padding: '0.35rem 0.75rem' }}
            onClick={() => setShowCustomPicker(false)}
          >
            Cancel
          </button>
        </form>
      )}

      {/* ── 5. INSIGHTS & RISK INTELLIGENCE CARDS ── */}
      {data && (
        <div className="insights-grid" style={{ marginBottom: '0.85rem' }}>
          {/* Panel 1: Top 10 Best Sellers */}
          <div className="insights-panel-card">
            <div className="insights-panel-header">
              <h3>
                <TrophyIcon size={16} /> Top 10 Best-Selling Products
              </h3>
              <span className="kpi-sub-badge purple">By Quantity Sold</span>
            </div>
            <div className="insights-panel-body" style={{ padding: '0.85rem 1rem' }}>
              {topSellers.length === 0 ? (
                <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.84rem' }}>
                  No completed sales recorded during this date window.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                  {topSellers.map((item, idx) => {
                    const pct = Math.max(6, Math.min(100, (item.unitsSold / topSellerMax) * 100));
                    return (
                      <div
                        key={item.id || idx}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.65rem',
                          fontSize: '0.8rem',
                        }}
                      >
                        <span
                          style={{
                            width: '24px',
                            fontFamily: 'monospace',
                            fontWeight: 700,
                            color: idx === 0 ? '#b45309' : idx === 1 ? '#475569' : idx === 2 ? '#c2410c' : 'var(--text-muted)',
                          }}
                        >
                          #{idx + 1}
                        </span>
                        <span
                          style={{
                            width: '150px',
                            minWidth: '150px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            fontWeight: 600,
                            color: 'var(--text-main)',
                          }}
                          title={item.name}
                        >
                          {item.name}
                        </span>
                        <div
                          style={{
                            flex: 1,
                            height: '8px',
                            background: '#f1f5f9',
                            borderRadius: '999px',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              width: `${pct}%`,
                              height: '100%',
                              background: 'var(--primary)',
                              borderRadius: '999px',
                              transition: 'width 0.3s ease',
                            }}
                          />
                        </div>
                        <span
                          className="mono"
                          style={{
                            minWidth: '65px',
                            textAlign: 'right',
                            fontWeight: 800,
                            color: 'var(--text-main)',
                          }}
                        >
                          {item.unitsSold} {item.unit}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Panel 2: Grounded Movement Risk Intelligence */}
          <div className="insights-panel-card">
            <div className="insights-panel-header">
              <h3>
                <BrainIcon size={16} /> Grounded Stock Risk Intelligence
              </h3>
              <span className="badge-live-sync-pill">
                <span className="live-indicator-dot-sm"></span>PostgreSQL Live
              </span>
            </div>
            <div
              className="insights-panel-body"
              style={{
                padding: '0.85rem 1rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.65rem',
              }}
            >
              {/* Runway insight */}
              {data.insights.bestSeller ? (
                <div
                  style={{
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    borderRadius: '8px',
                    padding: '0.6rem 0.85rem',
                    fontSize: '0.8rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                    <strong style={{ color: '#92400e', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <TrophyIcon size={14} color="#b45309" />
                      Best Seller: {data.insights.bestSeller.name}
                    </strong>
                    <span className="runway-badge high">
                      {data.insights.bestSeller.runwayDays !== null &&
                      data.insights.bestSeller.runwayDays !== undefined
                        ? `~${data.insights.bestSeller.runwayDays}d Runway`
                        : 'Active Seller'}
                    </span>
                  </div>
                  <div style={{ color: '#78350f', fontSize: '0.76rem', lineHeight: 1.4 }}>
                    Dispatched {data.insights.bestSeller.unitsSold} {data.insights.bestSeller.unit} across {data.insights.bestSeller.salesTxns} bills.
                    {data.insights.bestSeller.currentStockUnits !== undefined && (
                      <span> Only {data.insights.bestSeller.currentStockUnits} {data.insights.bestSeller.unit} remaining on shelves.</span>
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                  No top seller data available for this range.
                </div>
              )}

              {/* Slowing item insight */}
              {data.insights.slowingProduct ? (
                <div
                  style={{
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: '8px',
                    padding: '0.6rem 0.85rem',
                    fontSize: '0.8rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                    <strong style={{ color: '#1e40af', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <ZapIcon size={14} color="#1d4ed8" />
                      Demand Warning: {data.insights.slowingProduct.name}
                    </strong>
                    <span className="status-pill amber">Slowing</span>
                  </div>
                  <div style={{ color: '#1e3a8a', fontSize: '0.76rem', lineHeight: 1.4 }}>
                    {data.insights.slowingProduct.message}
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: '8px',
                    padding: '0.6rem 0.85rem',
                    fontSize: '0.8rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    color: '#15803d',
                  }}
                >
                  <CheckCircleIcon size={14} color="#15803d" />
                  <span>No severe slow-moving inventory bottlenecks detected.</span>
                </div>
              )}

              {/* Tied Capital insight */}
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  padding: '0.6rem 0.85rem',
                  fontSize: '0.8rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                  <strong style={{ color: '#991b1b', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <AlertOctagonIcon size={14} color="#dc2626" />
                    Dormant Capital: {data.insights.nonMovingSummary.count} SKUs
                  </strong>
                  <span className="dead-capital-badge">
                    {formatCurrency(data.insights.nonMovingSummary.tiedCapitalMinor)}
                  </span>
                </div>
                <div style={{ color: '#7f1d1d', fontSize: '0.76rem', lineHeight: 1.4 }}>
                  Zero units sold over the last {data.insights.nonMovingSummary.days} days. Review shelf demand before raising future supplier purchase orders.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 6. SUB-VIEW: STOCK MOVEMENT TABLE & FILTERS ── */}
      <div className="inv-subview-content">
        {/* Table Filters Bar */}
        <div className="inv-table-filters-card">
          <div className="inv-search-box">
            <SearchIcon
              size={16}
              style={{
                position: 'absolute',
                left: '0.75rem',
                color: 'var(--text-dim)',
                pointerEvents: 'none',
              }}
            />
            <input
              type="text"
              className="inv-search-input"
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
                className="clear-search-btn"
                onClick={() => {
                  setSearchQuery('');
                  setPage(1);
                }}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                aria-label="Clear Search"
              >
                <XIcon size={12} />
              </button>
            )}
          </div>

          <div className="inv-filter-group">
            {/* Category Filter */}
            <select
              className="inv-select"
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

            {/* Movement Status Filter */}
            <select
              className="inv-select"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">All Movement Statuses</option>
              <option value="fast_moving">⚡ Fast-Moving</option>
              <option value="slow_moving">⏳ Slow-Moving</option>
              <option value="non_moving">🛑 Non-Moving</option>
            </select>

            {/* Sorting */}
            <select
              className="inv-select"
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
                className="btn-action-small"
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
        </div>

        {/* Master Stock Ledger Table */}
        <div className="ledger-table-wrap">
          {loading && !data ? (
            <div className="table-loading-spinner" style={{ padding: '3rem', textAlign: 'center' }}>
              <div className="spinner"></div>
              <p style={{ marginTop: '0.75rem', color: 'var(--text-muted)' }}>
                Loading product movement ledger...
              </p>
            </div>
          ) : paginatedProducts.length === 0 ? (
            <div className="table-empty-state">
              <div className="table-empty-icon-wrap">
                <PackageIcon size={32} />
              </div>
              <h3>No Matching Products Found</h3>
              <p>
                {hasActiveFilters
                  ? 'No inventory items matched your current search or filter criteria.'
                  : 'No product movements recorded in this date range.'}
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  className="reset-filter-btn"
                  onClick={() => {
                    setSearchQuery('');
                    setCategoryFilter('ALL');
                    setStatusFilter('ALL');
                    setPage(1);
                  }}
                >
                  Clear All Filters
                </button>
              )}
            </div>
          ) : (
            <table className="inventory-data-table">
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
                    style={{ cursor: 'pointer', color: 'var(--primary)' }}
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
                  <th style={{ textAlign: 'right' }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {paginatedProducts.map((p) => {
                  const isNegStock = p.currentStockUnits < 0;
                  const isLowStock = p.currentStockUnits >= 0 && p.currentStockUnits <= 5;

                  return (
                    <tr key={p.id}>
                      {/* Product Name & SKU */}
                      <td>
                        <div className="item-cell-title">{p.name}</div>
                        <div className="item-cell-sub">
                          SKU: {p.sku || '—'}
                          {p.barcode ? ` · Barcode: ${p.barcode}` : ''}
                        </div>
                      </td>

                      {/* Category */}
                      <td>
                        <span className="category-pill">{p.category || 'General'}</span>
                      </td>

                      {/* Current Stock */}
                      <td>
                        <span
                          className={`stock-number-pill ${
                            isNegStock ? 'negative' : isLowStock ? 'low' : ''
                          }`}
                        >
                          {p.currentStockUnits.toLocaleString('en-IN')} {p.unit}
                        </span>
                      </td>

                      {/* Units Sold */}
                      <td>
                        <span
                          className="stock-number-pill"
                          style={{ color: 'var(--primary)', fontWeight: 800 }}
                        >
                          {p.unitsSold.toLocaleString('en-IN')} {p.unit}
                        </span>
                      </td>

                      {/* Invoice Bills */}
                      <td>
                        <span className="mono" style={{ fontWeight: 600 }}>
                          {p.salesTxns} bills
                        </span>
                      </td>

                      {/* Last Sold Date */}
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                        {formatLastSold(p.lastSoldAt)}
                      </td>

                      {/* Movement Status Badge */}
                      <td>
                        {p.movementStatus === 'fast_moving' && (
                          <span className="status-pill green">
                            <ZapIcon size={12} color="#065f46" /> Fast-Moving
                          </span>
                        )}
                        {p.movementStatus === 'slow_moving' && (
                          <span className="status-pill amber">
                            <HourglassIcon size={12} color="#92400e" /> Slow-Moving
                          </span>
                        )}
                        {p.movementStatus === 'non_moving' && (
                          <span className="status-pill red">
                            <AlertOctagonIcon size={12} color="#991b1b" /> Non-Moving
                          </span>
                        )}
                      </td>

                      {/* Action */}
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem' }}>
                          {onNavigateToPurchases &&
                          (p.movementStatus === 'fast_moving' || isLowStock) ? (
                            <button
                              type="button"
                              className="btn-action-small primary"
                              onClick={() => onNavigateToPurchases(undefined, p.id)}
                              title={`Create Purchase Order for ${p.name}`}
                            >
                              + Restock
                            </button>
                          ) : (
                            <span style={{ fontSize: '0.74rem', color: 'var(--text-dim)' }}>
                              {p.movementStatus === 'non_moving' ? 'Hold POs' : 'Adequate'}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination Bar */}
        {totalItems > 0 && (
          <div className="pagination-bar">
            <div
              className="pagination-info"
              style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}
            >
              <span>
                Showing {(page - 1) * pageSize + 1} to{' '}
                {Math.min(page * pageSize, totalItems)} of {totalItems} items
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
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
                    padding: '0.15rem 0.35rem',
                    borderRadius: '4px',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-card)',
                    color: 'var(--text-main)',
                    fontSize: '0.74rem',
                    cursor: 'pointer',
                  }}
                >
                  <option value={15}>15</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </span>
            </div>

            {totalItems > pageSize && (
              <div className="pagination-buttons">
                <button
                  type="button"
                  className="page-btn"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <span className="page-current">
                  Page {page} of {totalPages}
                </span>
                <button
                  type="button"
                  className="page-btn"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
