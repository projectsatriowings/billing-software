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
  CalendarIcon,
  AlertTriangleIcon,
  ZapIcon,
  HourglassIcon,
  AlertOctagonIcon,
  PackageIcon,
  TrophyIcon,
  TrendingDownIcon,
  CheckIcon,
  SearchIcon,
  DownloadIcon,
  RefreshCwIcon,
  WarehouseIcon,
} from './InventoryIcons.tsx';
import './StockReportBento.css';

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

  // Load analytics from API
  const loadAnalysis = useCallback(async (isRefresh = false) => {
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
  }, [selectedRange, customFrom, customTo]);

  useEffect(() => {
    if (selectedRange !== 'custom') {
      loadAnalysis();
    }
  }, [selectedRange, loadAnalysis]);

  const handleApplyCustomRange = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customFrom || !customTo) return;
    setShowCustomPicker(false);
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

  const hasActiveFilters = searchQuery !== '' || categoryFilter !== 'ALL' || statusFilter !== 'ALL';

  return (
    <div className="stock-bento-container">
      {/* ── 1. TOP BENTO COMMAND & CONTROL BAR ── */}
      <div className="stock-bento-topbar">
        <div className="stock-bento-title-group">
          <div className="stock-bento-icon-3d" title="Stock Intelligence Deck">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
              <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
              <line x1="12" y1="22.08" x2="12" y2="12" />
            </svg>
          </div>
          <div className="stock-bento-title-text">
            <h1>
              Stock Movement &amp; Velocity Report
              <span className="stock-bento-pill-badge">Bento 3D Intelligence</span>
            </h1>
            <p>
              Real-time product turnover analytics, fast/slow velocity classification &amp; dormant stock ledger
            </p>
          </div>
        </div>

        <div className="stock-bento-controls">
          {/* 3D Tactile Date Range Switcher */}
          <div className="stock-bento-range-switcher" role="radiogroup" aria-label="Date Range">
            <button
              type="button"
              className={`bento-range-btn ${selectedRange === '7d' ? 'active' : ''}`}
              onClick={() => {
                setSelectedRange('7d');
                setShowCustomPicker(false);
              }}
            >
              7 Days
            </button>
            <button
              type="button"
              className={`bento-range-btn ${selectedRange === '30d' ? 'active' : ''}`}
              onClick={() => {
                setSelectedRange('30d');
                setShowCustomPicker(false);
              }}
            >
              30 Days
            </button>
            <button
              type="button"
              className={`bento-range-btn ${selectedRange === '90d' ? 'active' : ''}`}
              onClick={() => {
                setSelectedRange('90d');
                setShowCustomPicker(false);
              }}
            >
              90 Days
            </button>
            <button
              type="button"
              className={`bento-range-btn ${selectedRange === 'custom' ? 'active' : ''}`}
              onClick={() => {
                setSelectedRange('custom');
                setShowCustomPicker(!showCustomPicker);
              }}
            >
              <CalendarIcon size={14} /> Custom
            </button>
          </div>

          {rangeDisplayLabel && (
            <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
              {rangeDisplayLabel}
            </span>
          )}

          {/* Refresh Action Button */}
          <button
            type="button"
            className="bento-btn-3d"
            onClick={() => loadAnalysis(true)}
            disabled={isRefreshing || loading}
            title="Refresh Stock Movement Data"
          >
            <RefreshCwIcon size={14} className={isRefreshing ? 'animate-spin' : ''} />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </button>

          {/* Export CSV Action Button */}
          <button
            type="button"
            className="bento-btn-3d primary"
            onClick={handleExportCsv}
            disabled={!data || data.products.length === 0}
            title="Export Stock Report to CSV"
          >
            <DownloadIcon size={14} /> Export CSV
          </button>
        </div>
      </div>

      {/* Custom Date Range Popover */}
      {showCustomPicker && selectedRange === 'custom' && (
        <form onSubmit={handleApplyCustomRange} className="bento-custom-date-popover">
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e293b' }}>
            Select Custom Period:
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <label style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>From:</label>
            <input
              type="date"
              className="bento-search-input"
              style={{ padding: '0.4rem 0.65rem', width: '145px', fontSize: '0.82rem' }}
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              required
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <label style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>To:</label>
            <input
              type="date"
              className="bento-search-input"
              style={{ padding: '0.4rem 0.65rem', width: '145px', fontSize: '0.82rem' }}
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="bento-btn-3d primary" style={{ padding: '0.42rem 0.95rem' }}>
            Apply Filter
          </button>
          <button
            type="button"
            className="bento-btn-3d"
            style={{ padding: '0.42rem 0.75rem' }}
            onClick={() => setShowCustomPicker(false)}
          >
            Cancel
          </button>
        </form>
      )}

      {/* Loading Skeleton */}
      {loading && !data && (
        <div
          className="bento-3d-card"
          style={{ padding: '4rem 2rem', textAlign: 'center', color: '#64748b' }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: '0.85rem' }}>⏳</div>
          <h3 style={{ margin: '0 0 0.4rem 0', color: '#0f172a', fontWeight: 800 }}>
            Synthesizing 3D Stock Movement Model...
          </h3>
          <p style={{ margin: 0, fontSize: '0.85rem' }}>
            Analyzing sales orders, inventory balances, velocity trends, and dead stock capital.
          </p>
        </div>
      )}

      {/* Error Alert Card */}
      {error && (
        <div
          className="bento-3d-card"
          style={{
            padding: '1.25rem 1.5rem',
            background: 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)',
            borderColor: '#fca5a5',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#991b1b' }}>
            <AlertTriangleIcon size={20} color="#dc2626" />
            <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>{error}</span>
          </div>
          <button
            type="button"
            className="bento-btn-3d"
            style={{ background: '#ffffff', borderColor: '#f87171', color: '#991b1b' }}
            onClick={() => loadAnalysis()}
          >
            Retry Analysis
          </button>
        </div>
      )}

      {/* ── 2. ASYMMETRIC BENTO KPI HERO DECK ── */}
      {summary && (
        <div className="stock-bento-kpi-grid">
          {/* Bento Hero Card: Total Movement Pulse (Spans 4 columns) */}
          <div className="bento-3d-card bento-kpi-hero">
            <div className="bento-3d-sheen" />
            <div>
              <div className="bento-card-header-row">
                <span className="bento-kpi-label">
                  <PackageIcon size={14} color="#6366f1" /> Movement Pulse
                </span>
                <span className="bento-mini-tag indigo">High Turnover</span>
              </div>
              <div className="bento-kpi-number indigo">
                {summary.totalUnitsSold.toLocaleString('en-IN')}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#4338ca', fontWeight: 700, marginTop: '2px' }}>
                Total Units Dispatched
              </div>
            </div>
            <div className="bento-kpi-footer-sub">
              Processed across <b>{summary.totalSalesBills.toLocaleString('en-IN')}</b> completed bills ·
              tracking <b>{summary.totalTrackedProducts}</b> catalogue SKUs
            </div>
          </div>

          {/* Bento Card 2: Fast-Moving Products (Emerald 3D) */}
          <div className="bento-3d-card bento-kpi-card emerald">
            <div className="bento-3d-sheen" />
            <div>
              <div className="bento-card-header-row">
                <span className="bento-kpi-label">
                  <ZapIcon size={13} color="#10b981" /> Fast-Moving
                </span>
                <div className="bento-kpi-icon-pill emerald">
                  <ZapIcon size={16} />
                </div>
              </div>
              <div className="bento-kpi-number emerald">{summary.fastMovingCount}</div>
              <span className="bento-mini-tag emerald">⚡ High Velocity</span>
            </div>
            <div className="bento-kpi-footer-sub">
              ≥ {summary.fastMinUnits} units sold or ≥ {summary.fastMinTxns} bills in this period
            </div>
          </div>

          {/* Bento Card 3: Slow-Moving Products (Amber 3D) */}
          <div className="bento-3d-card bento-kpi-card amber">
            <div className="bento-3d-sheen" />
            <div>
              <div className="bento-card-header-row">
                <span className="bento-kpi-label">
                  <HourglassIcon size={13} color="#f59e0b" /> Slow-Moving
                </span>
                <div className="bento-kpi-icon-pill amber">
                  <HourglassIcon size={16} />
                </div>
              </div>
              <div className="bento-kpi-number amber">{summary.slowMovingCount}</div>
              <span className="bento-mini-tag amber">⏳ Moderate Pace</span>
            </div>
            <div className="bento-kpi-footer-sub">
              Sold items below fast-moving threshold (1–{summary.fastMinUnits - 1} units)
            </div>
          </div>

          {/* Bento Card 4: Non-Moving / Dead Stock (Rose 3D) */}
          <div className="bento-3d-card bento-kpi-card rose">
            <div className="bento-3d-sheen" />
            <div>
              <div className="bento-card-header-row">
                <span className="bento-kpi-label">
                  <AlertOctagonIcon size={13} color="#ef4444" /> Dead Stock
                </span>
                <div className="bento-kpi-icon-pill rose">
                  <AlertOctagonIcon size={16} />
                </div>
              </div>
              <div className="bento-kpi-number rose">{summary.nonMovingCount}</div>
              <span className="bento-mini-tag rose">🛑 0 Sales</span>
            </div>
            <div className="bento-kpi-footer-sub">
              Zero units sold in past {summary.rangeDays} days · capital sitting dormant
            </div>
          </div>

          {/* Bento Card 5: Inventory Valuation / Tied Capital (Purple 3D) */}
          <div className="bento-3d-card bento-kpi-card purple">
            <div className="bento-3d-sheen" />
            <div>
              <div className="bento-card-header-row">
                <span className="bento-kpi-label">
                  <WarehouseIcon size={13} color="#8b5cf6" />
                  {invStats?.totalStockValueMinor != null ? 'Catalog Asset' : 'Tied Capital'}
                </span>
                <div className="bento-kpi-icon-pill purple">
                  <WarehouseIcon size={16} />
                </div>
              </div>
              <div className="bento-kpi-number purple" style={{ fontSize: '1.75rem' }}>
                {invStats?.totalStockValueMinor != null
                  ? formatCurrency(invStats.totalStockValueMinor)
                  : data?.insights.nonMovingSummary.tiedCapitalMinor
                  ? formatCurrency(data.insights.nonMovingSummary.tiedCapitalMinor)
                  : '₹0'}
              </div>
              <span className="bento-mini-tag indigo">
                {invStats?.totalStockValueMinor != null ? '💎 Live Valuation' : '⚠️ Dormant Asset'}
              </span>
            </div>
            <div className="bento-kpi-footer-sub">
              {invStats?.totalActiveProducts
                ? `${invStats.totalActiveProducts} active SKUs · ${invStats.lowStockCount || 0} low stock`
                : `${data?.insights.nonMovingSummary.count || 0} idle products tied up on shelves`}
            </div>
          </div>
        </div>
      )}

      {/* ── 3. VISUAL INTELLIGENCE BENTO GRID (CHARTS & INSIGHTS) ── */}
      {data && (
        <div className="stock-bento-visual-grid">
          {/* Bento Card 1: Top 10 Best Sellers (Spans 7 columns) */}
          <div className="bento-3d-card bento-chart-card">
            <div className="bento-3d-sheen" />
            <div className="bento-section-title">
              <TrophyIcon size={18} color="#d97706" /> Top 10 High-Velocity Best-Sellers
            </div>
            <div className="bento-section-sub">
              Ranked by quantity sold during {rangeDisplayLabel || 'the active period'}
            </div>

            {topSellers.length === 0 ? (
              <div style={{ padding: '3rem 1rem', textAlign: 'center', color: '#94a3b8' }}>
                No completed sales recorded during this date window.
              </div>
            ) : (
              <div className="bento-velocity-list">
                {topSellers.map((item, idx) => {
                  const pct = Math.max(8, Math.min(100, (item.unitsSold / topSellerMax) * 100));
                  const rankClass =
                    idx === 0 ? 'gold' : idx === 1 ? 'silver' : idx === 2 ? 'bronze' : 'default';

                  return (
                    <div key={item.id || idx} className="bento-velocity-item">
                      <div className={`bento-rank-badge ${rankClass}`}>
                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                      </div>
                      <span className="bento-velocity-name" title={item.name}>
                        {item.name}
                      </span>
                      <div className="bento-track-3d">
                        <div className="bento-fill-3d" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="bento-velocity-qty">
                        {item.unitsSold.toLocaleString('en-IN')}{' '}
                        <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>
                          {item.unit}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Bento Card 2: Inventory Movement Distribution (Spans 5 columns) */}
          <div className="bento-3d-card bento-health-card">
            <div className="bento-3d-sheen" />
            <div className="bento-section-title">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#4f46e5"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
              </svg>
              Inventory Health &amp; Circulation Ratio
            </div>
            <div className="bento-section-sub">
              Proportional distribution across {totalTracked} tracked products
            </div>

            {/* 3D Segmented Distribution Gauge */}
            <div className="bento-gauge-wrapper">
              <div className="bento-gauge-track-3d">
                <div
                  className="bento-gauge-segment emerald"
                  style={{ width: `${Math.max(2, fastPct)}%` }}
                  title={`Fast-Moving: ${summary?.fastMovingCount} (${fastPct}%)`}
                />
                <div
                  className="bento-gauge-segment amber"
                  style={{ width: `${Math.max(2, slowPct)}%` }}
                  title={`Slow-Moving: ${summary?.slowMovingCount} (${slowPct}%)`}
                />
                <div
                  className="bento-gauge-segment rose"
                  style={{ width: `${Math.max(2, nonPct)}%` }}
                  title={`Non-Moving: ${summary?.nonMovingCount} (${nonPct}%)`}
                />
              </div>
            </div>

            {/* Breakdown List */}
            <div className="bento-breakdown-list">
              <div className="bento-breakdown-row">
                <div className="bento-breakdown-left">
                  <div className="bento-dot-3d emerald" />
                  <span style={{ fontWeight: 700, fontSize: '0.82rem', color: '#065f46' }}>
                    Fast-Moving Products
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '0.9rem', color: '#0f172a' }}>
                    {summary?.fastMovingCount || 0}
                  </span>
                  <span className="bento-mini-tag emerald">{fastPct}%</span>
                </div>
              </div>

              <div className="bento-breakdown-row">
                <div className="bento-breakdown-left">
                  <div className="bento-dot-3d amber" />
                  <span style={{ fontWeight: 700, fontSize: '0.82rem', color: '#92400e' }}>
                    Slow-Moving Products
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '0.9rem', color: '#0f172a' }}>
                    {summary?.slowMovingCount || 0}
                  </span>
                  <span className="bento-mini-tag amber">{slowPct}%</span>
                </div>
              </div>

              <div className="bento-breakdown-row">
                <div className="bento-breakdown-left">
                  <div className="bento-dot-3d rose" />
                  <span style={{ fontWeight: 700, fontSize: '0.82rem', color: '#991b1b' }}>
                    Non-Moving Products
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '0.9rem', color: '#0f172a' }}>
                    {summary?.nonMovingCount || 0}
                  </span>
                  <span className="bento-mini-tag rose">{nonPct}%</span>
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: '1.25rem',
                padding: '0.75rem 1rem',
                background: '#f8fafc',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                fontSize: '0.77rem',
                color: '#64748b',
                lineHeight: 1.45,
              }}
            >
              💡 <b>Circulation Index:</b> {fastPct >= 35 ? '🟢 Healthy Circulation' : '🟡 High proportion of idle inventory'}. Aim to keep non-moving items under 15% of your total product line to maximize working capital.
            </div>
          </div>

          {/* Bento Card 3: Executive Smart Recommendations (Full width 12 columns) */}
          <div className="bento-3d-card bento-insights-card">
            <div className="bento-3d-sheen" />
            <div className="bento-section-title">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#6366f1"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              Smart Movement Insights &amp; Operational Advisories
            </div>
            <div className="bento-section-sub">
              Dynamic algorithm recommendations synchronized with real-time sales transactions
            </div>

            <div className="bento-insights-grid">
              {/* Insight 1: Best Seller Runway */}
              {data.insights.bestSeller ? (
                <div className="bento-insight-box gold">
                  <div style={{ fontWeight: 800, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <TrophyIcon size={16} color="#b45309" />
                    Top Seller: {data.insights.bestSeller.name}
                  </div>
                  <p style={{ margin: '0.35rem 0', fontSize: '0.8rem', lineHeight: 1.45 }}>
                    Generated <b>{data.insights.bestSeller.unitsSold} {data.insights.bestSeller.unit}</b> in sales across{' '}
                    <b>{data.insights.bestSeller.salesTxns}</b> bills.
                    {data.insights.bestSeller.currentStockUnits !== undefined && (
                      <span>
                        {' '}Current shelf stock is <b>{data.insights.bestSeller.currentStockUnits} {data.insights.bestSeller.unit}</b>
                        {data.insights.bestSeller.runwayDays !== null &&
                        data.insights.bestSeller.runwayDays !== undefined
                          ? ` (approx. ${data.insights.bestSeller.runwayDays} days of runway).`
                          : '.'}
                      </span>
                    )}
                  </p>
                  {onNavigateToPurchases && (
                    <button
                      type="button"
                      className="bento-restock-btn"
                      onClick={() => onNavigateToPurchases()}
                      style={{ alignSelf: 'flex-start', marginTop: '0.25rem' }}
                    >
                      Restock Product →
                    </button>
                  )}
                </div>
              ) : (
                <div className="bento-insight-box gold">
                  <div style={{ fontWeight: 800, fontSize: '0.85rem' }}>Top Seller Status</div>
                  <p style={{ margin: '0.35rem 0', fontSize: '0.8rem' }}>
                    No significant best seller recorded in this period.
                  </p>
                </div>
              )}

              {/* Insight 2: Slowing Products */}
              {data.insights.slowingProduct ? (
                <div className="bento-insight-box blue">
                  <div style={{ fontWeight: 800, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <TrendingDownIcon size={16} color="#1d4ed8" />
                    Demand Warning: {data.insights.slowingProduct.name}
                  </div>
                  <p style={{ margin: '0.35rem 0', fontSize: '0.8rem', lineHeight: 1.45 }}>
                    {data.insights.slowingProduct.message}
                  </p>
                  <span style={{ fontSize: '0.74rem', fontWeight: 600, color: '#1e40af' }}>
                    Recommendation: Review unit pricing or promotional bundling.
                  </span>
                </div>
              ) : (
                <div className="bento-insight-box blue">
                  <div style={{ fontWeight: 800, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <CheckIcon size={16} color="#15803d" /> Smooth Movement Velocity
                  </div>
                  <p style={{ margin: '0.35rem 0', fontSize: '0.8rem' }}>
                    No critical velocity drop-offs or bottlenecked items detected.
                  </p>
                </div>
              )}

              {/* Insight 3: Non-moving Tied Capital */}
              <div className="bento-insight-box red">
                <div style={{ fontWeight: 800, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <PackageIcon size={16} color="#b91c1c" />
                  Dormant Inventory: {data.insights.nonMovingSummary.count} SKUs
                </div>
                <p style={{ margin: '0.35rem 0', fontSize: '0.8rem', lineHeight: 1.45 }}>
                  {data.insights.nonMovingSummary.tiedCapitalMinor > 0 ? (
                    <span>
                      <b>{formatCurrency(data.insights.nonMovingSummary.tiedCapitalMinor)}</b> in cost sitting idle with 0 sales over the last {data.insights.nonMovingSummary.days} days.
                    </span>
                  ) : (
                    <span>
                      Zero sales observed for these items in the last {data.insights.nonMovingSummary.days} days. Review shelf space before restocking.
                    </span>
                  )}
                </p>
                <span style={{ fontSize: '0.74rem', fontWeight: 600, color: '#991b1b' }}>
                  Recommendation: Hold future POs until dormant stock is cleared.
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 4. MASTER STOCK REPORT LEDGER (BENTO 3D TABLE) ── */}
      <div className="bento-3d-card bento-table-card">
        <div className="bento-3d-sheen" />

        {/* Tactical Search & Filter Controls Toolbar */}
        <div className="bento-table-toolbar">
          <div className="bento-toolbar-left">
            {/* Search Input */}
            <div className="bento-search-box">
              <span className="bento-search-icon">
                <SearchIcon size={15} />
              </span>
              <input
                type="text"
                placeholder="Search by product name, SKU or category..."
                className="bento-search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Category Filter */}
            <select
              className="bento-select-3d"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="ALL">All Categories ▾</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            {/* Movement Status Filter */}
            <select
              className="bento-select-3d"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All Movement Status ▾</option>
              <option value="fast_moving">⚡ Fast-Moving</option>
              <option value="slow_moving">⏳ Slow-Moving</option>
              <option value="non_moving">🛑 Non-Moving</option>
            </select>

            {/* Sort Filter */}
            <select
              className="bento-select-3d"
              value={sortField}
              onChange={(e) => setSortField(e.target.value as any)}
            >
              <option value="units_desc">Sort: Units Sold (High-Low) ▾</option>
              <option value="units_asc">Sort: Units Sold (Low-High) ▴</option>
              <option value="txns_desc">Sort: Invoices / Txns (High-Low) ▾</option>
              <option value="name_asc">Sort: Product Name (A-Z)</option>
              <option value="stock_desc">Sort: Current Stock (High-Low)</option>
              <option value="stock_asc">Sort: Current Stock (Low-High)</option>
            </select>

            {hasActiveFilters && (
              <button
                type="button"
                className="bento-btn-3d"
                style={{ padding: '0.42rem 0.75rem', fontSize: '0.78rem' }}
                onClick={() => {
                  setSearchQuery('');
                  setCategoryFilter('ALL');
                  setStatusFilter('ALL');
                }}
              >
                Reset Filters
              </button>
            )}
          </div>

          <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600 }}>
            Showing <b>{filteredProducts.length}</b> of <b>{data?.products.length || 0}</b> items
          </div>
        </div>

        {/* Responsive Table Scrollport */}
        <div style={{ overflowX: 'auto', width: '100%' }}>
          <table className="bento-data-table">
            <thead>
              <tr>
                <th
                  className="sortable"
                  onClick={() => setSortField(sortField === 'name_asc' ? 'units_desc' : 'name_asc')}
                >
                  PRODUCT &amp; IDENTIFIERS {sortField === 'name_asc' ? '▴' : ''}
                </th>
                <th>CATEGORY</th>
                <th
                  className="sortable"
                  onClick={() => setSortField(sortField === 'stock_desc' ? 'stock_asc' : 'stock_desc')}
                >
                  CURRENT STOCK {sortField === 'stock_desc' ? '▼' : sortField === 'stock_asc' ? '▲' : ''}
                </th>
                <th
                  className="sortable"
                  onClick={() => setSortField(sortField === 'units_desc' ? 'units_asc' : 'units_desc')}
                  style={{ color: '#4f46e5' }}
                >
                  UNITS SOLD {sortField === 'units_desc' ? '▼' : sortField === 'units_asc' ? '▲' : ''}
                </th>
                <th
                  className="sortable"
                  onClick={() => setSortField(sortField === 'txns_desc' ? 'units_desc' : 'txns_desc')}
                >
                  INVOICE TXNS {sortField === 'txns_desc' ? '▼' : ''}
                </th>
                <th>LAST SOLD</th>
                <th>MOVEMENT STATUS</th>
                <th>SUGGESTED ACTION</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '4rem 1rem', color: '#94a3b8' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔍</div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#475569' }}>
                      No matching products found
                    </div>
                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.82rem' }}>
                      Try adjusting your search query, movement filter, or date range.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredProducts.map((p) => {
                  const isNegStock = p.currentStockUnits < 0;
                  const isLowStock = p.currentStockUnits >= 0 && p.currentStockUnits <= 5;
                  const stockClass = isNegStock ? 'negative' : isLowStock ? 'low' : 'healthy';

                  return (
                    <tr key={p.id}>
                      {/* Product Name & SKU */}
                      <td>
                        <div className="bento-prod-name">
                          <span>{p.name}</span>
                          <span className="bento-sku-cell">
                            SKU: {p.sku || '—'}{p.barcode ? ` · Barcode: ${p.barcode}` : ''}
                          </span>
                        </div>
                      </td>

                      {/* Category */}
                      <td>
                        <span className="bento-cat-tag">{p.category || 'General'}</span>
                      </td>

                      {/* Current Stock */}
                      <td>
                        <span className={`bento-stock-badge ${stockClass}`}>
                          {p.currentStockUnits.toLocaleString('en-IN')} {p.unit}
                        </span>
                      </td>

                      {/* Units Sold */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span
                            style={{
                              fontFamily: 'monospace',
                              fontWeight: 800,
                              fontSize: '0.92rem',
                              color: '#4f46e5',
                            }}
                          >
                            {p.unitsSold.toLocaleString('en-IN')} {p.unit}
                          </span>
                        </div>
                      </td>

                      {/* Sales Txns */}
                      <td>
                        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#334155' }}>
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
                          <span className="bento-movement-status fast">
                            <ZapIcon size={12} color="#047857" /> Fast-Moving
                          </span>
                        )}
                        {p.movementStatus === 'slow_moving' && (
                          <span className="bento-movement-status slow">
                            <HourglassIcon size={12} color="#b45309" /> Slow-Moving
                          </span>
                        )}
                        {p.movementStatus === 'non_moving' && (
                          <span className="bento-movement-status non">
                            <AlertOctagonIcon size={12} color="#b91c1c" /> Non-Moving
                          </span>
                        )}
                      </td>

                      {/* Suggested Action */}
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                          <span
                            style={{
                              fontSize: '0.78rem',
                              fontWeight: 600,
                              color:
                                p.movementStatus === 'fast_moving'
                                  ? '#059669'
                                  : p.movementStatus === 'slow_moving'
                                  ? '#b45309'
                                  : '#dc2626',
                            }}
                          >
                            {p.movementStatus === 'fast_moving'
                              ? 'Restock recommended'
                              : p.movementStatus === 'slow_moving'
                              ? 'Tune order qty'
                              : 'Pause reorders'}
                          </span>

                          {onNavigateToPurchases &&
                            (p.movementStatus === 'fast_moving' || isLowStock) && (
                              <button
                                type="button"
                                className="bento-restock-btn"
                                onClick={() => onNavigateToPurchases(undefined, p.id)}
                                title={`Generate purchase order for ${p.name}`}
                              >
                                + Order
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer with Operational Details */}
        {summary && (
          <div className="bento-table-footer">
            <div>
              Displaying <b>{filteredProducts.length}</b> records out of <b>{summary.totalTrackedProducts}</b> products tracked in this location
            </div>
            <div>
              ⚡ Fast Threshold: ≥ {summary.fastMinUnits} units or ≥ {summary.fastMinTxns} bills ·
              ⏳ Slow: 1–{summary.fastMinUnits - 1} units ·
              🛑 Dead Stock: 0 units
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
