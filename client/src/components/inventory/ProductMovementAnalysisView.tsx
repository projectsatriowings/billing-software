import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { ProductMovementAnalysisData, ProductMovementItem, ProductMovementStatus } from '../../api.ts';
import { fetchProductMovementAnalysis } from '../../api.ts';
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
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Table filters & sorting
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [sortField, setSortField] = useState<'units_desc' | 'units_asc' | 'txns_desc' | 'name_asc' | 'stock_desc' | 'stock_asc'>('units_desc');

  // Load analytics from API
  const loadAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchProductMovementAnalysis({
        range: selectedRange,
        from: selectedRange === 'custom' ? customFrom : undefined,
        to: selectedRange === 'custom' ? customTo : undefined,
      });
      setData(res);
    } catch (err: any) {
      console.error('Failed to load product movement analysis:', err);
      setError(err?.message || 'Failed to load movement analysis');
    } finally {
      setLoading(false);
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
      const endStr = end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
      return `${startStr} – ${endStr}`;
    } catch {
      return '';
    }
  }, [data?.summary]);

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

      const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

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
      `"${p.movementStatus === 'fast_moving' ? 'Fast-moving' : p.movementStatus === 'slow_moving' ? 'Slow-moving' : 'Non-moving'}"`,
      `"${p.suggestedAction}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `product-movement-analysis-${new Date().toISOString().slice(0, 10)}.csv`);
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
  const nonPct = Math.round(((summary?.nonMovingCount || 0) / totalTracked) * 100);

  const maxGroupCount = Math.max(
    1,
    summary?.fastMovingCount || 0,
    summary?.slowMovingCount || 0,
    summary?.nonMovingCount || 0
  );

  return (
    <div className="product-movement-container" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* ── HEADER & FILTER BAR ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
            Product Movement Analysis
          </h2>
          <p style={{ margin: 0, fontSize: '0.84rem', color: '#64748b' }}>
            Fast, slow and non-moving products from completed bills · returns and cancelled bills excluded
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {/* Date range pills */}
          <div
            style={{
              display: 'inline-flex',
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: '8px',
              padding: '2px',
              gap: '2px',
            }}
          >
            <button
              type="button"
              onClick={() => setSelectedRange('7d')}
              style={{
                padding: '0.35rem 0.85rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                background: selectedRange === '7d' ? '#6d4aff' : 'transparent',
                color: selectedRange === '7d' ? '#ffffff' : '#475569',
                transition: 'all 0.15s ease',
              }}
            >
              Last 7 Days
            </button>
            <button
              type="button"
              onClick={() => setSelectedRange('30d')}
              style={{
                padding: '0.35rem 0.85rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                background: selectedRange === '30d' ? '#6d4aff' : 'transparent',
                color: selectedRange === '30d' ? '#ffffff' : '#475569',
                transition: 'all 0.15s ease',
              }}
            >
              Last 30 Days
            </button>
            <button
              type="button"
              onClick={() => setSelectedRange('90d')}
              style={{
                padding: '0.35rem 0.85rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                background: selectedRange === '90d' ? '#6d4aff' : 'transparent',
                color: selectedRange === '90d' ? '#ffffff' : '#475569',
                transition: 'all 0.15s ease',
              }}
            >
              Last 90 Days
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedRange('custom');
                setShowCustomPicker(!showCustomPicker);
              }}
              style={{
                padding: '0.35rem 0.85rem',
                fontSize: '0.8rem',
                fontWeight: 600,
                borderRadius: '6px',
                border: 'none',
                cursor: 'pointer',
                background: selectedRange === 'custom' ? '#6d4aff' : 'transparent',
                color: selectedRange === 'custom' ? '#ffffff' : '#475569',
                transition: 'all 0.15s ease',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <CalendarIcon size={14} /> Custom Range
            </button>
          </div>

          {rangeDisplayLabel && (
            <span style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 500 }}>
              {rangeDisplayLabel}
            </span>
          )}
        </div>
      </div>

      {/* Custom Date Range Picker Dropdown */}
      {showCustomPicker && selectedRange === 'custom' && (
        <form
          onSubmit={handleApplyCustomRange}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: '8px',
            padding: '0.75rem 1rem',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155' }}>Custom Date Range:</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <label style={{ fontSize: '0.75rem', color: '#64748b' }}>From:</label>
            <input
              type="date"
              className="form-input"
              style={{ width: '140px', padding: '0.3rem 0.5rem', fontSize: '0.8rem' }}
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              required
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <label style={{ fontSize: '0.75rem', color: '#64748b' }}>To:</label>
            <input
              type="date"
              className="form-input"
              style={{ width: '140px', padding: '0.3rem 0.5rem', fontSize: '0.8rem' }}
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              required
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem' }}
          >
            Apply Range
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem' }}
            onClick={() => setShowCustomPicker(false)}
          >
            Close
          </button>
        </form>
      )}

      {/* Loading & Error States */}
      {loading && !data && (
        <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⏳</div>
          <p style={{ margin: 0, fontWeight: 500 }}>Analyzing product sales and movement patterns...</p>
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '1rem 1.25rem',
            background: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '8px',
            color: '#b91c1c',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <AlertTriangleIcon size={16} /> {error}
          </span>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem' }}
            onClick={loadAnalysis}
          >
            Retry
          </button>
        </div>
      )}

      {/* ── 4 SUMMARY METRIC CARDS ── */}
      {summary && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '0.85rem',
          }}
        >
          {/* Card 1: Fast-Moving */}
          <div
            style={{
              background: '#ffffff',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
              borderTop: '3px solid #f59e0b',
              padding: '1rem 1.15rem',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <div
              style={{
                fontSize: '0.74rem',
                fontWeight: 700,
                color: '#334155',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
              }}
            >
              <ZapIcon size={14} color="#f59e0b" /> FAST-MOVING PRODUCTS
            </div>
            <div
              style={{
                fontSize: '2rem',
                fontWeight: 800,
                color: '#10b981',
                fontFamily: 'monospace',
                marginTop: '0.35rem',
                lineHeight: 1.1,
              }}
            >
              {summary.fastMovingCount}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.35rem' }}>
              ≥ {summary.fastMinUnits} units sold or ≥ {summary.fastMinTxns} bills in period
            </div>
          </div>

          {/* Card 2: Slow-Moving */}
          <div
            style={{
              background: '#ffffff',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
              borderTop: '3px solid #f97316',
              padding: '1rem 1.15rem',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <div
              style={{
                fontSize: '0.74rem',
                fontWeight: 700,
                color: '#334155',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
              }}
            >
              <HourglassIcon size={14} color="#f97316" /> SLOW-MOVING PRODUCTS
            </div>
            <div
              style={{
                fontSize: '2rem',
                fontWeight: 800,
                color: '#f59e0b',
                fontFamily: 'monospace',
                marginTop: '0.35rem',
                lineHeight: 1.1,
              }}
            >
              {summary.slowMovingCount}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.35rem' }}>
              Sold, but below fast-moving threshold
            </div>
          </div>

          {/* Card 3: Non-Moving */}
          <div
            style={{
              background: '#ffffff',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
              borderTop: '3px solid #ef4444',
              padding: '1rem 1.15rem',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <div
              style={{
                fontSize: '0.74rem',
                fontWeight: 700,
                color: '#334155',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
              }}
            >
              <AlertOctagonIcon size={14} color="#ef4444" /> NON-MOVING PRODUCTS
            </div>
            <div
              style={{
                fontSize: '2rem',
                fontWeight: 800,
                color: '#ef4444',
                fontFamily: 'monospace',
                marginTop: '0.35rem',
                lineHeight: 1.1,
              }}
            >
              {summary.nonMovingCount}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.35rem' }}>
              Zero sales in the last {summary.rangeDays} days
            </div>
          </div>

          {/* Card 4: Total Units Sold */}
          <div
            style={{
              background: '#ffffff',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
              borderTop: '3px solid #6366f1',
              padding: '1rem 1.15rem',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <div
              style={{
                fontSize: '0.74rem',
                fontWeight: 700,
                color: '#334155',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
              }}
            >
              <PackageIcon size={14} color="#6366f1" /> TOTAL UNITS SOLD
            </div>
            <div
              style={{
                fontSize: '2rem',
                fontWeight: 800,
                color: '#6d4aff',
                fontFamily: 'monospace',
                marginTop: '0.35rem',
                lineHeight: 1.1,
              }}
            >
              {summary.totalUnitsSold.toLocaleString('en-IN')}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.35rem' }}>
              Across {summary.totalSalesBills} bills · pcs, kg &amp; ltr
            </div>
          </div>
        </div>
      )}

      {/* ── CHARTS & INSIGHTS ROW (3 COLUMNS) ── */}
      {data && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '1rem',
          }}
        >
          {/* Box 1: Top 10 Best-Selling Products */}
          <div
            style={{
              background: '#ffffff',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
              padding: '1.15rem',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <h3 style={{ margin: '0 0 2px 0', fontSize: '0.95rem', fontWeight: 700, color: '#0f172a' }}>
              Top 10 Best-Selling Products
            </h3>
            <p style={{ margin: '0 0 1rem 0', fontSize: '0.78rem', color: '#64748b' }}>
              By quantity sold · {rangeDisplayLabel || 'period'}
            </p>

            {topSellers.length === 0 ? (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                No completed sales recorded during this date period.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                {topSellers.map((item, idx) => {
                  const pct = Math.max(5, Math.min(100, (item.unitsSold / topSellerMax) * 100));
                  return (
                    <div
                      key={item.id || idx}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', fontSize: '0.78rem' }}
                    >
                      <span
                        style={{
                          width: '135px',
                          minWidth: '135px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          fontWeight: 500,
                          color: '#334155',
                        }}
                        title={item.name}
                      >
                        {item.name}
                      </span>
                      <div
                        style={{
                          flex: 1,
                          height: '14px',
                          background: '#ede9fe',
                          borderRadius: '999px',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${pct}%`,
                            height: '100%',
                            background: '#6d4aff',
                            borderRadius: '999px',
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>
                      <span
                        style={{
                          minWidth: '55px',
                          textAlign: 'right',
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          color: '#0f172a',
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

          {/* Box 2: Movement Classification */}
          <div
            style={{
              background: '#ffffff',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
              padding: '1.15rem',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <h3 style={{ margin: '0 0 2px 0', fontSize: '0.95rem', fontWeight: 700, color: '#0f172a' }}>
              Movement Classification
            </h3>
            <p style={{ margin: '0 0 1rem 0', fontSize: '0.78rem', color: '#64748b' }}>
              Number of products in each group
            </p>

            {/* Vertical Bar Chart */}
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'space-around',
                height: '150px',
                padding: '0.5rem 0',
                borderBottom: '1px solid #e2e8f0',
              }}
            >
              {/* Fast-Moving Col */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0f172a', fontFamily: 'monospace' }}>
                  {summary?.fastMovingCount || 0}
                </span>
                <div
                  style={{
                    width: '44px',
                    height: `${Math.max(8, Math.round(((summary?.fastMovingCount || 0) / maxGroupCount) * 110))}px`,
                    background: '#10b981',
                    borderRadius: '6px 6px 0 0',
                    transition: 'height 0.3s ease',
                  }}
                />
                <span style={{ fontSize: '0.74rem', color: '#475569', fontWeight: 600 }}>Fast-moving</span>
              </div>

              {/* Slow-Moving Col */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0f172a', fontFamily: 'monospace' }}>
                  {summary?.slowMovingCount || 0}
                </span>
                <div
                  style={{
                    width: '44px',
                    height: `${Math.max(8, Math.round(((summary?.slowMovingCount || 0) / maxGroupCount) * 110))}px`,
                    background: '#f59e0b',
                    borderRadius: '6px 6px 0 0',
                    transition: 'height 0.3s ease',
                  }}
                />
                <span style={{ fontSize: '0.74rem', color: '#475569', fontWeight: 600 }}>Slow-moving</span>
              </div>

              {/* Non-Moving Col */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#0f172a', fontFamily: 'monospace' }}>
                  {summary?.nonMovingCount || 0}
                </span>
                <div
                  style={{
                    width: '44px',
                    height: `${Math.max(8, Math.round(((summary?.nonMovingCount || 0) / maxGroupCount) * 110))}px`,
                    background: '#ef4444',
                    borderRadius: '6px 6px 0 0',
                    transition: 'height 0.3s ease',
                  }}
                />
                <span style={{ fontSize: '0.74rem', color: '#475569', fontWeight: 600 }}>Non-moving</span>
              </div>
            </div>

            <div style={{ fontSize: '0.78rem', color: '#64748b', textAlign: 'center', marginTop: '0.85rem' }}>
              {totalTracked} tracked products · {fastPct}% fast · {slowPct}% slow · {nonPct}% non-moving
            </div>
          </div>

          {/* Box 3: Insights */}
          <div
            style={{
              background: '#ffffff',
              borderRadius: '10px',
              border: '1px solid #e2e8f0',
              padding: '1.15rem',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            <h3 style={{ margin: '0 0 2px 0', fontSize: '0.95rem', fontWeight: 700, color: '#0f172a' }}>
              Insights
            </h3>
            <p style={{ margin: '0 0 0.85rem 0', fontSize: '0.78rem', color: '#64748b' }}>
              Updated with the date range
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', flex: 1, justifyContent: 'space-between' }}>
              {/* Insight 1: Best seller */}
              {data.insights.bestSeller ? (
                <div
                  style={{
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    borderRadius: '8px',
                    padding: '0.65rem 0.85rem',
                    fontSize: '0.8rem',
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#92400e', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <TrophyIcon size={15} color="#b45309" /> Best seller: {data.insights.bestSeller.name}
                  </div>
                  <div style={{ color: '#78350f', fontSize: '0.76rem', lineHeight: 1.35 }}>
                    {data.insights.bestSeller.unitsSold} {data.insights.bestSeller.unit} in {data.insights.bestSeller.salesTxns} bills.
                    {data.insights.bestSeller.currentStockUnits !== undefined && (
                      <span>
                        {' '}Only {data.insights.bestSeller.currentStockUnits} {data.insights.bestSeller.unit} left
                        {data.insights.bestSeller.runwayDays !== null && data.insights.bestSeller.runwayDays !== undefined
                          ? ` — about ${data.insights.bestSeller.runwayDays} days of stock.`
                          : '.'}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '0.65rem 0.85rem',
                    fontSize: '0.78rem',
                    color: '#64748b',
                  }}
                >
                  No top seller data available for this period.
                </div>
              )}

              {/* Insight 2: Slowing / Attention */}
              {data.insights.slowingProduct ? (
                <div
                  style={{
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: '8px',
                    padding: '0.65rem 0.85rem',
                    fontSize: '0.8rem',
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#1e40af', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <TrendingDownIcon size={15} color="#1e40af" /> {data.insights.slowingProduct.name}
                  </div>
                  <div style={{ color: '#1e3a8a', fontSize: '0.76rem', lineHeight: 1.35 }}>
                    {data.insights.slowingProduct.message}
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: '8px',
                    padding: '0.65rem 0.85rem',
                    fontSize: '0.78rem',
                    color: '#15803d',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <CheckIcon size={14} color="#15803d" /> No severe slow-moving inventory bottlenecks detected.
                </div>
              )}

              {/* Insight 3: Non-moving products */}
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  padding: '0.65rem 0.85rem',
                  fontSize: '0.8rem',
                }}
              >
                <div style={{ fontWeight: 700, color: '#991b1b', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <PackageIcon size={15} color="#991b1b" /> {data.insights.nonMovingSummary.count} products haven&apos;t sold in {data.insights.nonMovingSummary.days} days
                </div>
                <div style={{ color: '#7f1d1d', fontSize: '0.76rem', lineHeight: 1.35 }}>
                  {data.insights.nonMovingSummary.tiedCapitalMinor > 0 ? (
                    <span>
                      ₹{(data.insights.nonMovingSummary.tiedCapitalMinor / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })} at cost sitting on shelves. Review before the next purchase order.
                    </span>
                  ) : (
                    <span>Review shelf space and catalog demand before purchasing more.</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── PRODUCT MOVEMENT DETAILS TABLE ── */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: '10px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Table Title & Action Bar */}
        <div
          style={{
            padding: '1rem 1.25rem',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.75rem',
          }}
        >
          <div>
            <h3 style={{ margin: '0 0 2px 0', fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
              Product Movement Details
            </h3>
            <p style={{ margin: 0, fontSize: '0.75rem', color: '#94a3b8' }}>
              Click a column header to sort
            </p>
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '0.4rem 0.85rem',
              fontSize: '0.8rem',
              fontWeight: 600,
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#334155',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <DownloadIcon size={14} /> Export CSV
          </button>
        </div>

        {/* Filter Controls Bar */}
        <div
          style={{
            padding: '0.75rem 1.25rem',
            background: '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            gap: '0.65rem',
            flexWrap: 'wrap',
          }}
        >
          {/* Search input */}
          <div style={{ flex: '1 1 200px', maxWidth: '300px', position: 'relative' }}>
            <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', color: '#94a3b8' }}>
              <SearchIcon size={14} />
            </span>
            <input
              type="text"
              placeholder="Search by product, SKU or category..."
              className="form-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                paddingLeft: '28px',
                paddingTop: '0.38rem',
                paddingBottom: '0.38rem',
                fontSize: '0.82rem',
                borderRadius: '6px',
              }}
            />
          </div>

          {/* Category Dropdown */}
          <select
            className="form-input"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={{ padding: '0.38rem 0.65rem', fontSize: '0.82rem', borderRadius: '6px', width: 'auto' }}
          >
            <option value="ALL">All Categories ▾</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {/* Movement Status Dropdown */}
          <select
            className="form-input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ padding: '0.38rem 0.65rem', fontSize: '0.82rem', borderRadius: '6px', width: 'auto' }}
          >
            <option value="ALL">All Movement Status ▾</option>
            <option value="fast_moving">Fast-Moving</option>
            <option value="slow_moving">Slow-Moving</option>
            <option value="non_moving">Non-Moving</option>
          </select>

          {/* Sort Dropdown */}
          <select
            className="form-input"
            value={sortField}
            onChange={(e) => setSortField(e.target.value as any)}
            style={{ padding: '0.38rem 0.65rem', fontSize: '0.82rem', borderRadius: '6px', width: 'auto' }}
          >
            <option value="units_desc">Sort: Units Sold (High-Low) ▾</option>
            <option value="units_asc">Sort: Units Sold (Low-High) ▴</option>
            <option value="txns_desc">Sort: Sales Txns (High-Low) ▾</option>
            <option value="name_asc">Sort: Product Name (A-Z)</option>
            <option value="stock_desc">Sort: Current Stock (High-Low)</option>
            <option value="stock_asc">Sort: Current Stock (Low-High)</option>
          </select>
        </div>

        {/* Scrollable Data Table */}
        <div style={{ overflowX: 'auto', width: '100%' }}>
          <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                <th
                  onClick={() => setSortField(sortField === 'name_asc' ? 'units_desc' : 'name_asc')}
                  style={{ textAlign: 'left', padding: '0.75rem 0.95rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  PRODUCT NAME {sortField === 'name_asc' ? '▴' : ''}
                </th>
                <th style={{ textAlign: 'left', padding: '0.75rem 0.95rem', whiteSpace: 'nowrap' }}>CATEGORY</th>
                <th style={{ textAlign: 'left', padding: '0.75rem 0.95rem', whiteSpace: 'nowrap' }}>SKU / CODE</th>
                <th
                  onClick={() => setSortField(sortField === 'stock_desc' ? 'stock_asc' : 'stock_desc')}
                  style={{ textAlign: 'left', padding: '0.75rem 0.95rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  CURRENT STOCK {sortField === 'stock_desc' ? '▼' : sortField === 'stock_asc' ? '▲' : ''}
                </th>
                <th
                  onClick={() => setSortField(sortField === 'units_desc' ? 'units_asc' : 'units_desc')}
                  style={{ textAlign: 'left', padding: '0.75rem 0.95rem', cursor: 'pointer', whiteSpace: 'nowrap', color: '#6d4aff' }}
                >
                  UNITS SOLD {sortField === 'units_desc' ? '▼' : sortField === 'units_asc' ? '▲' : ''}
                </th>
                <th
                  onClick={() => setSortField(sortField === 'txns_desc' ? 'units_desc' : 'txns_desc')}
                  style={{ textAlign: 'left', padding: '0.75rem 0.95rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
                >
                  SALES TXNS {sortField === 'txns_desc' ? '▼' : ''}
                </th>
                <th style={{ textAlign: 'left', padding: '0.75rem 0.95rem', whiteSpace: 'nowrap' }}>LAST SOLD</th>
                <th style={{ textAlign: 'left', padding: '0.75rem 0.95rem', whiteSpace: 'nowrap' }}>MOVEMENT STATUS</th>
                <th style={{ textAlign: 'left', padding: '0.75rem 0.95rem', whiteSpace: 'nowrap' }}>SUGGESTED ACTION</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                    No products matching your search or filters.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((p) => {
                  const isNegStock = p.currentStockUnits < 0;
                  return (
                    <tr
                      key={p.id}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        transition: 'background-color 0.1s ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f8fafc')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                    >
                      {/* Product Name */}
                      <td style={{ padding: '0.65rem 0.95rem', fontWeight: 700, color: '#0f172a' }}>
                        {p.name}
                      </td>

                      {/* Category */}
                      <td style={{ padding: '0.65rem 0.95rem', whiteSpace: 'nowrap' }}>
                        <span
                          style={{
                            background: '#f1f5f9',
                            color: '#475569',
                            border: '1px solid #e2e8f0',
                            borderRadius: '999px',
                            padding: '2px 8px',
                            fontSize: '0.74rem',
                            fontWeight: 500,
                          }}
                        >
                          {p.category || 'General'}
                        </span>
                      </td>

                      {/* SKU / Code */}
                      <td style={{ padding: '0.65rem 0.95rem', fontFamily: 'monospace', color: '#64748b' }}>
                        {p.sku || '—'}
                      </td>

                      {/* Current Stock */}
                      <td
                        style={{
                          padding: '0.65rem 0.95rem',
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          color: isNegStock ? '#dc2626' : '#1e293b',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {p.currentStockUnits} {p.unit}
                      </td>

                      {/* Units Sold */}
                      <td
                        style={{
                          padding: '0.65rem 0.95rem',
                          fontFamily: 'monospace',
                          fontWeight: 800,
                          color: '#6d4aff',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {p.unitsSold} {p.unit}
                      </td>

                      {/* Sales Txns */}
                      <td style={{ padding: '0.65rem 0.95rem', fontFamily: 'monospace', color: '#334155' }}>
                        {p.salesTxns}
                      </td>

                      {/* Last Sold */}
                      <td style={{ padding: '0.65rem 0.95rem', color: '#475569', whiteSpace: 'nowrap' }}>
                        {formatLastSold(p.lastSoldAt)}
                      </td>

                      {/* Movement Status Badge */}
                      <td style={{ padding: '0.65rem 0.95rem', whiteSpace: 'nowrap' }}>
                        {p.movementStatus === 'fast_moving' && (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              background: '#ecfdf5',
                              color: '#065f46',
                              border: '1px solid #a7f3d0',
                              borderRadius: '999px',
                              padding: '2px 9px',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                            }}
                          >
                            <ZapIcon size={12} color="#065f46" /> Fast-moving
                          </span>
                        )}
                        {p.movementStatus === 'slow_moving' && (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              background: '#fffbeb',
                              color: '#b45309',
                              border: '1px solid #fde68a',
                              borderRadius: '999px',
                              padding: '2px 9px',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                            }}
                          >
                            <HourglassIcon size={12} color="#b45309" /> Slow-moving
                          </span>
                        )}
                        {p.movementStatus === 'non_moving' && (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                              background: '#fef2f2',
                              color: '#b91c1c',
                              border: '1px solid #fecaca',
                              borderRadius: '999px',
                              padding: '2px 9px',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                            }}
                          >
                            <AlertOctagonIcon size={12} color="#b91c1c" /> Non-moving
                          </span>
                        )}
                      </td>

                      {/* Suggested Action */}
                      <td style={{ padding: '0.65rem 0.95rem', whiteSpace: 'nowrap' }}>
                        {p.movementStatus === 'fast_moving' && (
                          <span style={{ color: '#16a34a', fontWeight: 600 }}>
                            Consider restocking
                          </span>
                        )}
                        {p.movementStatus === 'slow_moving' && (
                          <span style={{ color: '#b45309', fontWeight: 600 }}>
                            Review purchase qty &amp; pricing
                          </span>
                        )}
                        {p.movementStatus === 'non_moving' && (
                          <span style={{ color: '#dc2626', fontWeight: 600 }}>
                            Review demand before buying
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

        {/* Table Footer */}
        {summary && (
          <div
            style={{
              padding: '0.75rem 1.25rem',
              background: '#f8fafc',
              borderTop: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.5rem',
              fontSize: '0.78rem',
              color: '#64748b',
            }}
          >
            <div>
              Showing {filteredProducts.length} of {data?.products.length || 0} products
            </div>
            <div>
              Thresholds: Fast ≥ {summary.fastMinUnits} units or ≥ {summary.fastMinTxns} bills · Slow 1–{summary.fastMinUnits - 1} units · Non-moving 0 units (configurable in settings)
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
