import React, { useState, useEffect, useCallback } from 'react';
import type { Item, Party, Role, InventoryDashboardStats, InventoryInsights, Category } from '../../api.ts';
import {
  fetchInventoryDashboard,
  fetchInventoryItems,
  fetchInventoryInsights,
  can,
} from '../../api.ts';
import { StockLedgerView } from './StockLedgerView.tsx';
import { StockAdjustmentModal } from './StockAdjustmentModal.tsx';
import { PhysicalStockCountView } from './PhysicalStockCountView.tsx';
import { ReorderConfigModal } from './ReorderConfigModal.tsx';

interface InventoryDashboardProps {
  items: Item[];
  categories: string[];
  categoriesList?: Category[];
  suppliers: Party[];
  userRole?: Role;
  businessType?: string;
  allowNegativeStock?: boolean;
  onNavigateToPurchases?: (supplierId?: string, itemId?: string) => void;
  onNavigateToCategories?: () => void;
  showToast: (msg: string) => void;
  onReloadItems: () => void;
}

export const InventoryDashboard: React.FC<InventoryDashboardProps> = ({
  items,
  categories,
  categoriesList = [],
  suppliers,
  userRole,
  businessType = 'retail',
  allowNegativeStock = false,
  onNavigateToPurchases,
  onNavigateToCategories,
  showToast,
  onReloadItems,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'ledger' | 'counts' | 'replenish' | 'insights'>('overview');
  const [stats, setStats] = useState<InventoryDashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState<boolean>(true);
  const [insights, setInsights] = useState<InventoryInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState<boolean>(false);

  // Items table state
  const [tableItems, setTableItems] = useState<Item[]>([]);
  const [totalItems, setTotalItems] = useState<number>(0);
  const [itemsLoading, setItemsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<string>('name_asc');
  const [page, setPage] = useState<number>(1);
  const pageSize = 20;

  // Modals state
  const [adjustmentTargetItem, setAdjustmentTargetItem] = useState<Item | null>(null);
  const [showAdjustmentModal, setShowAdjustmentModal] = useState<boolean>(false);

  const [reorderTargetItem, setReorderTargetItem] = useState<Item | null>(null);
  const [showReorderModal, setShowReorderModal] = useState<boolean>(false);

  const [selectedLedgerItemId, setSelectedLedgerItemId] = useState<string | undefined>(undefined);

  const isOwnerOrManager = can(userRole, 'stock.adjust');
  const isAuthorizedForCost = ['owner', 'manager', 'accountant'].includes(userRole || '');

  // Load dashboard stats
  const loadDashboardStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await fetchInventoryDashboard();
      setStats(res.stats);
    } catch (err) {
      console.error('Failed to load inventory stats:', err);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // Load Phase 3 insights
  const loadInsights = useCallback(async () => {
    setInsightsLoading(true);
    try {
      const res = await fetchInventoryInsights();
      setInsights(res.insights);
    } catch (err) {
      console.error('Failed to load inventory insights:', err);
    } finally {
      setInsightsLoading(false);
    }
  }, []);

  // Load items table
  const loadTableItems = useCallback(async () => {
    setItemsLoading(true);
    try {
      const res = await fetchInventoryItems({
        q: searchQuery.trim() || undefined,
        category: categoryFilter !== 'ALL' ? categoryFilter : undefined,
        status: statusFilter !== 'all' ? statusFilter : undefined,
        sort: sortField,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      setTableItems(res.items || []);
      setTotalItems(res.total || 0);
    } catch (err) {
      console.error('Failed to load inventory items:', err);
    } finally {
      setItemsLoading(false);
    }
  }, [searchQuery, categoryFilter, statusFilter, sortField, page]);

  useEffect(() => {
    loadDashboardStats();
    loadInsights();
  }, [loadDashboardStats, loadInsights]);

  useEffect(() => {
    if (activeSubTab === 'overview') {
      loadTableItems();
    } else if (activeSubTab === 'insights') {
      loadInsights();
    }
  }, [activeSubTab, loadTableItems, loadInsights]);

  const handleRefreshAll = () => {
    loadDashboardStats();
    loadTableItems();
    loadInsights();
    onReloadItems();
  };

  const handleAdjustmentSuccess = (_resultingMilli: number, itemName: string) => {
    showToast(`Stock for "${itemName}" updated successfully!`);
    handleRefreshAll();
  };

  const handleReorderSuccess = (updatedItem: any) => {
    showToast(`Reorder levels for "${updatedItem.name}" updated!`);
    handleRefreshAll();
  };

  const handleOpenItemLedger = (item: Item) => {
    setSelectedLedgerItemId(item.id);
    setActiveSubTab('ledger');
  };

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  // Service business notice
  const isServiceBusiness = businessType === 'service';

  return (
    <div className="inventory-module-wrapper">
      {/* Module Title Bar */}
      <div className="inventory-title-bar">
        <div className="title-left">
          <div className="title-row">
            <span className="title-icon">🏬</span>
            <h1 className="inventory-heading">Inventory Hub</h1>
            <span className="badge-live-sync">Neon PostgreSQL Live</span>
          </div>
          <p className="inventory-subheading">
            Live stock balances, audit ledger, replenishment suggestions, and physical counts
          </p>
        </div>

        <div className="title-actions" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {onNavigateToCategories && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '0.6rem 1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              onClick={onNavigateToCategories}
              title="Open Category Management Module"
            >
              <span>🏷️</span> Categories ({categories.length})
            </button>
          )}
          {isOwnerOrManager && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setAdjustmentTargetItem(null);
                setShowAdjustmentModal(true);
              }}
            >
              <span>⚖️</span> Manual Stock Adjustment
            </button>
          )}
        </div>
      </div>

      {/* Blinking Inventory Alert Banner */}
      {stats && (stats.outOfStockCount > 0 || stats.lowStockCount > 0) && (
        <div
          className={`dashboard-stock-alert-banner ${stats.outOfStockCount === 0 ? 'amber-only' : ''}`}
          style={{ marginBottom: '1.25rem' }}
        >
          <div className="alert-banner-left">
            <div className={`alert-banner-pulse-icon ${stats.outOfStockCount === 0 ? 'amber' : ''}`}>
              {stats.outOfStockCount > 0 ? '🚨' : '⚠️'}
            </div>
            <div className="alert-banner-content">
              <div className={`alert-banner-title ${stats.outOfStockCount === 0 ? 'amber' : ''}`}>
                <span className={`blinking-dot ${stats.outOfStockCount > 0 ? 'red' : 'amber'}`}></span>
                {stats.outOfStockCount > 0 ? 'CRITICAL INVENTORY ALERT' : 'LOW STOCK RESTOCK WARNING'}
              </div>
              <div className={`alert-banner-desc ${stats.outOfStockCount === 0 ? 'amber' : ''}`}>
                {stats.outOfStockCount > 0 && (
                  <span>
                    <strong>{stats.outOfStockCount}</strong> {stats.outOfStockCount === 1 ? 'item is' : 'items are'} completely <strong>Out of Stock</strong>
                  </span>
                )}
                {stats.outOfStockCount > 0 && stats.lowStockCount > 0 && <span> and </span>}
                {stats.lowStockCount > 0 && (
                  <span>
                    <strong>{stats.lowStockCount}</strong> {stats.lowStockCount === 1 ? 'item is' : 'items are'} at or below reorder threshold
                  </span>
                )}
                . Fast replenishment is recommended to maintain active checkout operations.
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {stats.outOfStockCount > 0 && (
              <button
                type="button"
                className="alert-banner-btn"
                onClick={() => {
                  setActiveSubTab('overview');
                  setStatusFilter('out_of_stock');
                }}
              >
                <span>Filter Out of Stock ({stats.outOfStockCount})</span>
              </button>
            )}
            {stats.replenishmentNeeded.length > 0 && (
              <button
                type="button"
                className="alert-banner-btn amber"
                onClick={() => setActiveSubTab('replenish')}
              >
                <span>Replenishment Plan ({stats.replenishmentNeeded.length})</span>
                <span>→</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Service Business Banner */}
      {isServiceBusiness && (
        <div className="service-business-notice-card">
          <span className="notice-icon">💡</span>
          <div>
            <strong>Service Business Notice:</strong> This business is configured for services and consulting with zero
            mandatory inventory. Inventory features are optional and will only apply if you sell physical consumables or goods.
          </div>
        </div>
      )}

      {/* Top 5 Metrics KPI Cards (Section 2) */}
      <div className="inventory-kpi-grid">
        {/* KPI 1: Active Tracked Products */}
        <div
          className="kpi-card purple"
          onClick={() => {
            setActiveSubTab('overview');
            setStatusFilter('all');
          }}
        >
          <div className="kpi-header">
            <span className="kpi-icon-wrap purple">📦</span>
            <span className="kpi-label">Active Tracked Items</span>
          </div>
          <div className="kpi-body">
            <span className="kpi-value mono">{statsLoading ? '--' : stats?.totalActiveProducts ?? 0}</span>
          </div>
          <div className="kpi-footer">
            <span>In product master</span>
            <span className="kpi-link">View all →</span>
          </div>
        </div>

        {/* KPI 2: In-Stock Products */}
        <div
          className="kpi-card green"
          onClick={() => {
            setActiveSubTab('overview');
            setStatusFilter('in_stock');
          }}
        >
          <div className="kpi-header">
            <span className="kpi-icon-wrap green">✓</span>
            <span className="kpi-label">In-Stock Products</span>
          </div>
          <div className="kpi-body">
            <span className="kpi-value mono text-green">{statsLoading ? '--' : stats?.inStockCount ?? 0}</span>
            <span className="kpi-sub-badge green">
              {stats?.totalActiveProducts
                ? `${Math.round(((stats.inStockCount || 0) / stats.totalActiveProducts) * 100)}%`
                : '100%'}
            </span>
          </div>
          <div className="kpi-footer">
            <span>Sufficient shelf stock</span>
            <span className="kpi-link">Filter →</span>
          </div>
        </div>

        {/* KPI 3: Low-Stock Products */}
        <div
          className="kpi-card amber"
          onClick={() => {
            setActiveSubTab('overview');
            setStatusFilter('low_stock');
          }}
        >
          <div className="kpi-header">
            <span className="kpi-icon-wrap amber">⚠️</span>
            <span className="kpi-label">Low Stock Alerts</span>
          </div>
          <div className="kpi-body">
            <span className="kpi-value mono text-amber">{statsLoading ? '--' : stats?.lowStockCount ?? 0}</span>
            {stats && stats.lowStockCount > 0 && (
              <span className="kpi-sub-badge amber blinking-badge-amber">Needs Attention</span>
            )}
          </div>
          <div className="kpi-footer">
            <span>At or below reorder level</span>
            <span className="kpi-link">Review →</span>
          </div>
        </div>

        {/* KPI 4: Out-of-Stock Products */}
        <div
          className="kpi-card red"
          onClick={() => {
            setActiveSubTab('overview');
            setStatusFilter('out_of_stock');
            setPage(1);
          }}
        >
          <div className="kpi-header">
            <span className="kpi-icon-wrap red">🚨</span>
            <span className="kpi-label">Out of Stock</span>
          </div>
          <div className="kpi-body">
            <span className="kpi-value mono text-red">{statsLoading ? '--' : stats?.outOfStockCount ?? 0}</span>
            {stats && (stats.negativeStockCount || 0) > 0 ? (
              <span className="kpi-sub-badge" style={{ background: '#f3e8ff', color: '#6b21a8', border: '1px solid #d8b4fe' }}>
                {stats.negativeStockCount} Negative
              </span>
            ) : stats && stats.outOfStockCount > 0 ? (
              <span className="kpi-sub-badge red blinking-badge-red">Critical</span>
            ) : null}
          </div>
          <div className="kpi-footer">
            <span>
              {stats && (stats.negativeStockCount || 0) > 0
                ? `Zero: ${stats.zeroStockCount ?? 0} | Negative: ${stats.negativeStockCount}`
                : 'Zero or negative quantity'}
            </span>
            <span className="kpi-link">Filter →</span>
          </div>
        </div>

        {/* KPI 5: Total Stock Valuation (Costing method & valuation date) */}
        <div
          className="kpi-card blue"
          style={{ cursor: isAuthorizedForCost ? 'pointer' : 'default' }}
          onClick={() => {
            if (isAuthorizedForCost) {
              setActiveSubTab('overview');
              setSortField('value_desc');
              setStatusFilter('in_stock');
              setPage(1);
            }
          }}
          title={
            isAuthorizedForCost
              ? 'Stock Value at Current Item Master Cost: calculated as positive stock quantity × items.cost_minor. Reflects replacement cost from product master, not FIFO or weighted average.'
              : 'Restricted to owner/manager/accountant'
          }
        >
          <div className="kpi-header">
            <span className="kpi-icon-wrap blue">💰</span>
            <span className="kpi-label">Stock Value at Current Item Master Cost</span>
          </div>
          <div className="kpi-body">
            {isAuthorizedForCost ? (
              <span className="kpi-value mono" style={{ fontSize: '1.45rem' }}>
                ₹{((stats?.totalStockValueMinor || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </span>
            ) : (
              <span className="kpi-value mono text-muted" style={{ fontSize: '1.1rem' }}>
                Restricted (Staff)
              </span>
            )}
          </div>
          <div className="kpi-footer">
            <span style={{ fontSize: '0.72rem', display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span>Method: <strong>{stats?.costingMethod || 'Current Item Master Cost'}</strong></span>
              <span>As of: Today (Live Neon Sync)</span>
            </span>
            {isAuthorizedForCost ? <span className="kpi-link">Sort value →</span> : <span className="kpi-icon-lock">🔒</span>}
          </div>
        </div>
      </div>

      {/* Navigation Tabs (Sub-Navigation) */}
      <div className="inventory-nav-tabs-bar">
        <button
          type="button"
          className={`inv-tab-btn ${activeSubTab === 'overview' ? 'active' : ''}`}
          onClick={() => {
            setActiveSubTab('overview');
            setStatusFilter('all');
          }}
        >
          <span className="tab-icon">📦</span>
          <span>Stock Overview & Items</span>
        </button>
        <button
          type="button"
          className={`inv-tab-btn ${activeSubTab === 'ledger' ? 'active' : ''}`}
          onClick={() => {
            setSelectedLedgerItemId(undefined);
            setActiveSubTab('ledger');
          }}
        >
          <span className="tab-icon">📜</span>
          <span>Stock Movement Ledger</span>
        </button>
        <button
          type="button"
          className={`inv-tab-btn ${activeSubTab === 'counts' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('counts')}
        >
          <span className="tab-icon">📋</span>
          <span>Physical Stock Counts</span>
        </button>
        <button
          type="button"
          className={`inv-tab-btn ${activeSubTab === 'replenish' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('replenish')}
        >
          <span className="tab-icon">🔔</span>
          <span>Replenishment Suggestions</span>
          {stats && stats.replenishmentNeeded.length > 0 && (
            <span className="tab-count-badge red blinking-badge-red">{stats.replenishmentNeeded.length}</span>
          )}
        </button>
        <button
          type="button"
          className={`inv-tab-btn ${activeSubTab === 'insights' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('insights')}
        >
          <span className="tab-icon">⚡</span>
          <span>Insights & Risk Intelligence</span>
          {insights && ((insights.stockoutRisks?.length || 0) + (insights.batchWarnings?.length || 0) > 0) && (
            <span className="tab-count-badge amber">
              {(insights.stockoutRisks?.length || 0) + (insights.batchWarnings?.length || 0)}
            </span>
          )}
        </button>
      </div>

      {/* SUB-VIEW 1: Stock Overview & Items */}
      {activeSubTab === 'overview' && (
        <div className="inv-subview-content">
          {/* Filters Bar */}
          <div className="inv-table-filters-card">
            <div className="inv-search-box">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                className="inv-search-input"
                placeholder="Search products by name, SKU, or barcode..."
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
                >
                  ✕
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
                {categoriesList && categoriesList.length > 0
                  ? categoriesList
                      .filter((c) => c.active)
                      .map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.parentName ? `${c.parentName} → ${c.name}` : c.name}
                        </option>
                      ))
                  : categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
              </select>

              {/* Status Filter */}
              <select
                className="inv-select"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All Stock Statuses</option>
                <option value="in_stock">In Stock (Healthy)</option>
                <option value="low_stock">⚠️ Low Stock (At Reorder Point)</option>
                <option value="out_of_stock">🚨 Out of Stock (0 or Negative)</option>
                <option value="zero_stock">🔴 Zero Stock (Exactly 0)</option>
                <option value="negative_stock">🟣 Negative Stock (Oversold / &lt; 0)</option>
                <option value="unconfigured">⚙️ Unconfigured (No Reorder Level)</option>
              </select>

              {/* Sorting */}
              <select
                className="inv-select"
                value={sortField}
                onChange={(e) => {
                  setSortField(e.target.value);
                  setPage(1);
                }}
              >
                <option value="name_asc">Name (A-Z)</option>
                <option value="name_desc">Name (Z-A)</option>
                <option value="stock_asc">Stock (Lowest First)</option>
                <option value="stock_desc">Stock (Highest First)</option>
                {isAuthorizedForCost && <option value="value_desc">Valuation (Highest First)</option>}
              </select>
            </div>
          </div>

          {/* Items Table */}
          <div className="ledger-table-wrap">
            {itemsLoading ? (
              <div className="table-loading-spinner">
                <div className="spinner"></div>
                <p>Loading inventory balances...</p>
              </div>
            ) : tableItems.length === 0 ? (
              <div className="table-empty-state">
                <span className="empty-icon">📦</span>
                <h3>No Items Found</h3>
                <p>No inventory items matched your current filter criteria.</p>
              </div>
            ) : (
              <table className="inventory-data-table">
                <thead>
                  <tr>
                    <th>Product & Identifiers</th>
                    <th>Category</th>
                    <th style={{ textAlign: 'right' }}>Current Stock</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Reorder Level</th>
                    <th style={{ textAlign: 'right' }}>Min Buffer</th>
                    {isAuthorizedForCost && <th style={{ textAlign: 'right' }}>Unit Cost</th>}
                    {isAuthorizedForCost && <th style={{ textAlign: 'right' }}>Total Value</th>}
                    <th>Supplier</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tableItems.map((item) => {
                    const currentUnits = item.currentStockMilli / 1000;
                    const reorderUnits = (item.reorderMilli || 0) / 1000;
                    const minUnits = (item.minStockMilli || 0) / 1000;
                    const unit = item.unit || 'pcs';

                    return (
                      <tr key={item.id} className="item-row">
                        <td>
                          <div className="item-cell-title">{item.name}</div>
                          <div className="item-cell-sub">
                            {item.sku ? `SKU: ${item.sku}` : ''}
                            {item.sku && item.barcode ? ' • ' : ''}
                            {item.barcode ? `Barcode: ${item.barcode}` : ''}
                          </div>
                        </td>
                        <td>
                          {(() => {
                            const matched = categoriesList?.find((c) => c.name.toLowerCase() === (item.category || '').toLowerCase());
                            if (matched && matched.parentName) {
                              return (
                                <span className="category-pill" title={`${matched.parentName} → ${item.category}`}>
                                  <span style={{ opacity: 0.65 }}>{matched.parentName} → </span>
                                  {item.category}
                                </span>
                              );
                            }
                            return <span className="category-pill">{item.category || 'General'}</span>;
                          })()}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span
                            className={`stock-number-pill ${
                              currentUnits < 0 ? 'negative' : currentUnits === 0 ? 'zero' : ''
                            }`}
                          >
                            {currentUnits.toFixed(1)} {unit}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`status-pill ${
                              currentUnits < 0
                                ? 'purple'
                                : currentUnits === 0
                                ? 'red'
                                : item.stockStatus === 'low_stock'
                                ? 'amber'
                                : 'green'
                            }`}
                          >
                            {currentUnits < 0
                              ? 'Negative Stock'
                              : currentUnits === 0
                              ? 'Out of Stock'
                              : item.stockStatus === 'low_stock'
                              ? 'Low Stock'
                              : 'In Stock'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {reorderUnits > 0 ? (
                            <span
                              className="editable-reorder-link"
                              title="Click to change reorder point"
                              onClick={() => {
                                setReorderTargetItem(item);
                                setShowReorderModal(true);
                              }}
                            >
                              {reorderUnits.toFixed(1)} {unit} ✏️
                            </span>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                              <button
                                type="button"
                                className="btn-configure-tag"
                                onClick={() => {
                                  setReorderTargetItem(item);
                                  setShowReorderModal(true);
                                }}
                              >
                                + Set Reorder
                              </button>
                              {minUnits === 0 && (
                                <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>Not Configured</span>
                              )}
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }} className="mono">
                          {minUnits > 0 ? `${minUnits.toFixed(1)} ${unit}` : '--'}
                        </td>
                        {isAuthorizedForCost && (
                          <td style={{ textAlign: 'right', color: 'var(--text-muted)' }} className="mono">
                            ₹{(item.costMinor / 100).toFixed(2)}
                          </td>
                        )}
                        {isAuthorizedForCost && (
                          <td style={{ textAlign: 'right', fontWeight: 700 }} className="mono">
                            ₹{(((item.stockValueMinor || 0)) / 100).toFixed(2)}
                          </td>
                        )}
                        <td>
                          {item.preferredSupplierName ? (
                            <span className="supplier-chip" title={item.preferredSupplierPhone || ''}>
                              {item.preferredSupplierName}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>--</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <div className="table-actions-cluster">
                            <button
                              type="button"
                              className="btn-action-small"
                              title="View stock movement history for this item"
                              onClick={() => handleOpenItemLedger(item)}
                            >
                              📜 Ledger
                            </button>
                            {isOwnerOrManager && (
                              <button
                                type="button"
                                className="btn-action-small primary"
                                title="Adjust physical or system stock"
                                onClick={() => {
                                  setAdjustmentTargetItem(item);
                                  setShowAdjustmentModal(true);
                                }}
                              >
                                ⚖️ Adjust
                              </button>
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

          {/* Pagination */}
          {totalItems > pageSize && (
            <div className="pagination-bar">
              <div className="pagination-info">
                Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, totalItems)} of {totalItems} items
              </div>
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
            </div>
          )}
        </div>
      )}

      {/* SUB-VIEW 2: Stock Movement Ledger */}
      {activeSubTab === 'ledger' && (
        <div className="inv-subview-content">
          <StockLedgerView initialItemId={selectedLedgerItemId} items={items} />
        </div>
      )}

      {/* SUB-VIEW 3: Physical Stock Counts */}
      {activeSubTab === 'counts' && (
        <div className="inv-subview-content">
          <PhysicalStockCountView
            categories={categories}
            categoriesList={categoriesList}
            userRole={userRole}
            onInventoryUpdated={handleRefreshAll}
            showToast={showToast}
          />
        </div>
      )}

      {/* SUB-VIEW 4: Replenishment Suggestions */}
      {activeSubTab === 'replenish' && (
        <div className="inv-subview-content">
          <div className="replenishment-header-card">
            <div>
              <h3 className="section-title">Replenishment & Purchase Recommendations</h3>
              <p className="section-subtitle">
                Target-stock policy formula: max(1 base unit, 2 × max(reorder point, min stock) − current stock). Calculates quantity to restore buffer up to 2× reorder threshold. Does not factor supplier lead times, pending purchase orders, or vendor pack sizes.
              </p>
            </div>
          </div>

          {!stats || stats.replenishmentNeeded.length === 0 ? (
            <div className="table-empty-state">
              <span className="empty-icon">✓</span>
              <h3>All Products Sufficiently Stocked</h3>
              <p>No products have currently dropped to or below their configured reorder levels.</p>
            </div>
          ) : (
            <div className="ledger-table-wrap">
              <table className="inventory-data-table replenishment-table">
                <thead>
                  <tr>
                    <th>Product & Identifiers</th>
                    <th>Category</th>
                    <th style={{ textAlign: 'right' }}>Current Stock</th>
                    <th style={{ textAlign: 'right' }}>Reorder Point</th>
                    <th style={{ textAlign: 'right' }}>Deficit / Gap</th>
                    <th style={{ textAlign: 'right' }}>
                      Suggested Order
                      <span
                        className="info-tooltip-trigger"
                        title="Target-Stock Formula: max(1, 2 × max(reorder point, min stock) − current stock). Targets 2× reorder point to rebuild working buffer. Note: Does not account for supplier lead time, pending purchase orders, or vendor pack sizes."
                        style={{ marginLeft: '4px', cursor: 'help', fontSize: '0.85em' }}
                      >
                        ℹ️
                      </span>
                    </th>
                    <th>Supplier Details</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.replenishmentNeeded.map((r) => {
                    const currentUnits = r.currentStockMilli / 1000;
                    const reorderUnits = r.reorderMilli / 1000;
                    const suggestedUnits = r.suggestedOrderQtyMilli / 1000;
                    const deficitUnits = Math.max(0, reorderUnits - currentUnits);

                    return (
                      <tr key={r.itemId}>
                        <td>
                          <div className="item-cell-title">{r.name}</div>
                          <div className="item-cell-sub">
                            {r.sku ? `SKU: ${r.sku}` : ''}
                            {r.sku && r.barcode ? ' • ' : ''}
                            {r.barcode ? `Barcode: ${r.barcode}` : ''}
                          </div>
                        </td>
                        <td>
                          <span className="category-pill">{r.category || 'General'}</span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span className={`stock-number-pill ${currentUnits <= 0 ? 'zero' : 'low'}`}>
                            {currentUnits.toFixed(1)} {r.unit}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }} className="mono">
                          {reorderUnits.toFixed(1)} {r.unit}
                        </td>
                        <td style={{ textAlign: 'right', color: '#f43f5e', fontWeight: 700 }} className="mono">
                          -{deficitUnits.toFixed(1)} {r.unit}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span className="suggested-order-badge">
                            +{suggestedUnits.toFixed(1)} {r.unit}
                          </span>
                        </td>
                        <td>
                          {r.preferredSupplierName ? (
                            <div>
                              <div style={{ fontWeight: 600 }}>{r.preferredSupplierName}</div>
                              {r.preferredSupplierPhone && (
                                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                  📞 {r.preferredSupplierPhone}
                                </div>
                              )}
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
                              No supplier linked
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="btn-primary-small"
                            onClick={() => {
                              if (onNavigateToPurchases) {
                                onNavigateToPurchases(r.preferredSupplierId || undefined, r.itemId);
                              } else {
                                showToast(`Navigate to Purchases to place order for ${r.name}`);
                              }
                            }}
                          >
                            📥 Inward / Order
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SUB-VIEW 5: Insights & Risk Intelligence (Phase 3) */}
      {activeSubTab === 'insights' && (
        <div className="inv-subview-content">
          {/* Methodology & Grounding Banner */}
          <div className="insights-methodology-banner">
            <span className="insights-methodology-icon">🧠</span>
            <div style={{ flex: 1 }}>
              <div className="insights-methodology-title">
                Grounded Inventory Intelligence & Risk Analytics
              </div>
              <div className="insights-methodology-text">
                Every metric, velocity run-rate, dead capital calculation, and variance score is computed
                deterministically from your authoritative PostgreSQL stock ledger (<code>stock_moves</code>) and actual
                30–90 day customer transactions. No synthetic estimations or black-box guesses.
              </div>
              <div className="insights-methodology-meta">
                <span>Costing: <strong>{insights?.costingMethod || 'Current Item Master Cost (INR)'}</strong></span>
                <span>Ledger: <strong>Authoritative stock_moves</strong></span>
                <span>Sync: <strong>Neon PostgreSQL Live</strong></span>
              </div>
            </div>
          </div>

          {insightsLoading ? (
            <div className="table-loading-spinner">
              <div className="spinner"></div>
              <p>Analyzing stockout runways, movement velocity, and audit history...</p>
            </div>
          ) : !insights ? (
            <div className="table-empty-state">
              <span className="empty-icon">⚠️</span>
              <h3>Unable to Load Insights</h3>
              <p>An error occurred while computing inventory intelligence.</p>
              <button type="button" className="btn-primary" onClick={loadInsights} style={{ marginTop: '0.75rem' }}>
                Retry Analysis
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Row 1: Stockout Risk Radar + Slow Moving Dead Stock */}
              <div className="insights-grid">
                {/* 1. Stockout Risk Radar */}
                <div className="insights-panel-card">
                  <div className="insights-panel-header">
                    <h3>
                      <span>🚨</span> Stockout-Risk Radar & Consumption Runway
                    </h3>
                    <span className="badge-live-sync">30-Day Sales Velocity</span>
                  </div>
                  <div className="insights-panel-body">
                    {insights.stockoutRisks.length === 0 ? (
                      <div className="table-empty-state" style={{ padding: '2rem 1rem' }}>
                        <span className="empty-icon">✓</span>
                        <h4>No Immediate Stockout Risks</h4>
                        <p>All items maintain sufficient inventory cover based on current 30-day velocity.</p>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {insights.stockoutRisks.map((item) => (
                          <div
                            key={item.itemId}
                            style={{
                              padding: '0.75rem 0.9rem',
                              background: '#f8fafc',
                              border: '1px solid var(--border)',
                              borderRadius: '6px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.4rem',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '0.9rem' }}>
                                {item.name}
                              </span>
                              <span
                                className={`runway-badge ${
                                  item.riskLevel === 'out_of_stock' || item.riskLevel === 'critical'
                                    ? 'critical'
                                    : 'high'
                                }`}
                              >
                                {item.riskLevel === 'out_of_stock'
                                  ? 'Depleted (0d)'
                                  : `~${item.runwayDays} Days Runway`}
                              </span>
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              Stock: <strong>{item.currentStockUnits.toFixed(1)} {item.unit}</strong> • Velocity: <strong>{item.dailyVelocityUnits.toFixed(1)} {item.unit}/day</strong> ({item.sold30dUnits.toFixed(1)} {item.unit} sold across {item.ordersCount} orders)
                            </div>
                            <div style={{ fontSize: '0.78rem', color: '#b91c1c', background: '#fef2f2', padding: '0.35rem 0.5rem', borderRadius: '4px' }}>
                              {item.explainableReason}
                            </div>
                            {item.preferredSupplierName && (
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.25rem', paddingTop: '0.35rem', borderTop: '1px dashed var(--border)', fontSize: '0.75rem' }}>
                                <span style={{ color: 'var(--text-dim)' }}>
                                  Supplier: <strong>{item.preferredSupplierName}</strong>
                                </span>
                                {onNavigateToPurchases && (
                                  <button
                                    type="button"
                                    className="btn-action-small primary"
                                    onClick={() => onNavigateToPurchases(undefined, item.itemId)}
                                  >
                                    Order Reorder →
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. Slow-Moving & Dead Stock Analyzer */}
                <div className="insights-panel-card">
                  <div className="insights-panel-header">
                    <h3>
                      <span>⏳</span> Stagnant Capital & Dead-Stock Analyzer
                    </h3>
                    <span className="badge-live-sync">60-Day Inactivity</span>
                  </div>
                  <div className="insights-panel-body">
                    {insights.slowMovingItems.length === 0 ? (
                      <div className="table-empty-state" style={{ padding: '2rem 1rem' }}>
                        <span className="empty-icon">✓</span>
                        <h4>Healthy Inventory Turnover</h4>
                        <p>No stagnant products detected with zero sales in the past 60 days.</p>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {insights.slowMovingItems.map((item) => (
                          <div
                            key={item.itemId}
                            style={{
                              padding: '0.75rem 0.9rem',
                              background: '#f8fafc',
                              border: '1px solid var(--border)',
                              borderRadius: '6px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.4rem',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '0.9rem' }}>
                                {item.name}
                              </span>
                              {item.tiedCapitalMinor !== null && (
                                <span className="dead-capital-badge">
                                  ₹{(item.tiedCapitalMinor / 100).toFixed(2)} Tied
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              Idle Stock: <strong>{item.currentStockUnits.toFixed(1)} {item.unit}</strong> • Category: {item.category || 'General'}
                            </div>
                            <div style={{ fontSize: '0.78rem', color: '#92400e', background: '#fffbeb', padding: '0.35rem 0.5rem', borderRadius: '4px' }}>
                              {item.explainableReason} Recommendation: Consider bundle promotion or supplier return.
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Row 2: Duplicate-Item Detector + Batch & Expiry + Audit Variance */}
              <div className="insights-grid">
                {/* 3. Duplicate Items & Barcode Collision Detector */}
                <div className="insights-panel-card">
                  <div className="insights-panel-header">
                    <h3>
                      <span>⚠️</span> Duplicate-Item & Barcode Collision Detector
                    </h3>
                    <span className="badge-live-sync">Data Integrity</span>
                  </div>
                  <div className="insights-panel-body">
                    {insights.duplicates.length === 0 ? (
                      <div className="table-empty-state" style={{ padding: '2rem 1rem' }}>
                        <span className="empty-icon">✓</span>
                        <h4>Clean Master Data</h4>
                        <p>Zero barcode collisions or duplicate item names found in this store.</p>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {insights.duplicates.map((dup, idx) => (
                          <div
                            key={idx}
                            style={{
                              padding: '0.75rem 0.9rem',
                              background: '#fef2f2',
                              border: '1px solid #fecaca',
                              borderRadius: '6px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.35rem',
                            }}
                          >
                            <div style={{ fontWeight: 700, color: '#991b1b', fontSize: '0.86rem' }}>
                              {dup.type === 'barcode_collision' ? 'Barcode Collision' : 'Duplicate Product Name'}: "{dup.key}"
                            </div>
                            <div style={{ fontSize: '0.78rem', color: '#7f1d1d' }}>
                              {dup.description}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                              Affected Items:{' '}
                              {dup.items.map((it) => (
                                <span key={it.id} style={{ background: '#ffffff', padding: '0.1rem 0.4rem', borderRadius: '3px', border: '1px solid #fca5a5' }}>
                                  {it.name} {it.sku ? `(${it.sku})` : ''}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* 4. Inward Batches Near Expiry */}
                <div className="insights-panel-card">
                  <div className="insights-panel-header">
                    <h3>
                      <span>📦</span> Inward Batches Near Expiry
                    </h3>
                    <span className="badge-live-sync">Received Inward Lots</span>
                  </div>
                  <div className="insights-panel-body">
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.75rem', lineHeight: 1.4 }}>
                      Identifies received purchase batches approaching expiry. Note: Because POS sales track total item stock rather than individual batch lots, this volume reflects inward quantity received, not verified on-shelf lot balances.
                    </p>
                    {insights.batchWarnings.length === 0 ? (
                      <div className="table-empty-state" style={{ padding: '2rem 1rem' }}>
                        <span className="empty-icon">✓</span>
                        <h4>No Expiry Risks Detected</h4>
                        <p>All tracked received batch lots are within safe shelf-life windows.</p>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {insights.batchWarnings.map((batch, idx) => (
                          <div
                            key={idx}
                            style={{
                              padding: '0.75rem 0.9rem',
                              background: batch.status === 'expired' ? '#fff1f2' : '#fffbeb',
                              border: `1px solid ${batch.status === 'expired' ? '#fecdd3' : '#fde68a'}`,
                              borderRadius: '6px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '0.35rem',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontWeight: 700, color: 'var(--text-main)', fontSize: '0.88rem' }}>
                                {batch.itemName}
                              </span>
                              <span className="batch-quarantine-badge">
                                {batch.status === 'expired' ? 'EXPIRED' : 'EXPIRING SOON'}
                              </span>
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              Batch: <strong>{batch.batchNo}</strong> • Expiry Date: <strong>{batch.expiry}</strong> • Inward Received Qty: <strong>{((batch.inwardUnits ?? batch.remainingUnits ?? 0)).toFixed(1)} {batch.unit}</strong>
                            </div>
                            <div style={{ fontSize: '0.76rem', color: batch.status === 'expired' ? '#9f1239' : '#92400e' }}>
                              {batch.warning}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Row 3: Physical Count Accuracy & Audit History */}
              <div className="insights-panel-card">
                <div className="insights-panel-header">
                  <h3>
                    <span>⚖️</span> Physical Count Audit Accuracy & Shrinkage Analytics
                  </h3>
                  <span className="badge-live-sync">Audit Trail History</span>
                </div>
                <div className="insights-panel-body">
                  {insights.auditVariance.recentCounts.length === 0 ? (
                    <div className="table-empty-state" style={{ padding: '2rem 1rem' }}>
                      <span className="empty-icon">📋</span>
                      <h4>No Completed Physical Counts Yet</h4>
                      <p>Conduct and finalize physical counts in the "Physical Stock Counts" tab to populate inventory audit variance analytics.</p>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                      <table className="inventory-data-table">
                        <thead>
                          <tr>
                            <th>Count Session</th>
                            <th>Date Finalized</th>
                            <th style={{ textAlign: 'right' }}>Audited Items</th>
                            <th style={{ textAlign: 'right' }}>Discrepancies</th>
                            <th
                              style={{ textAlign: 'right' }}
                              title="SKU Match Rate: (Audited Items - Discrepant Items) / Audited Items × 100%. Measures line-item match percentage, distinct from quantity variance or financial variance."
                            >
                              SKU Match Rate %
                            </th>
                            <th style={{ textAlign: 'right' }}>Net Variance Units</th>
                            {isAuthorizedForCost && <th style={{ textAlign: 'right' }}>Net Value Variance</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {insights.auditVariance.recentCounts.map((c) => (
                            <tr key={c.id}>
                              <td>
                                <div style={{ fontWeight: 700 }}>{c.name}</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>#{c.countNumber}</div>
                              </td>
                              <td>{new Date(c.finalizedAt).toLocaleDateString('en-IN')}</td>
                              <td style={{ textAlign: 'right' }} className="mono">{c.totalLines}</td>
                              <td style={{ textAlign: 'right', color: c.discrepantLines > 0 ? '#b91c1c' : '#059669' }} className="mono">
                                {c.discrepantLines}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                <span
                                  className={`status-pill ${
                                    c.accuracyPct >= 95 ? 'green' : c.accuracyPct >= 85 ? 'amber' : 'red'
                                  }`}
                                >
                                  {c.accuracyPct}%
                                </span>
                              </td>
                              <td style={{ textAlign: 'right' }} className="mono">
                                <span style={{ color: c.netDiffUnits < 0 ? '#b91c1c' : c.netDiffUnits > 0 ? '#059669' : 'inherit' }}>
                                  {c.netDiffUnits > 0 ? `+${c.netDiffUnits.toFixed(1)}` : c.netDiffUnits.toFixed(1)}
                                </span>
                              </td>
                              {isAuthorizedForCost && (
                                <td style={{ textAlign: 'right' }} className="mono">
                                  {c.netVarianceValueMinor !== null ? (
                                    <span style={{ color: c.netVarianceValueMinor < 0 ? '#b91c1c' : c.netVarianceValueMinor > 0 ? '#059669' : 'inherit', fontWeight: 700 }}>
                                      {c.netVarianceValueMinor > 0 ? '+' : ''}₹{(c.netVarianceValueMinor / 100).toFixed(2)}
                                    </span>
                                  ) : (
                                    '--'
                                  )}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {insights.auditVariance.adjustmentReasons.length > 0 && (
                        <div style={{ marginTop: '0.5rem', background: '#f8fafc', padding: '0.85rem', borderRadius: '6px', border: '1px solid var(--border)' }}>
                          <div style={{ fontWeight: 700, fontSize: '0.82rem', marginBottom: '0.5rem', color: 'var(--text-main)' }}>
                            Top Adjustment Reasons (Last 90 Days):
                          </div>
                          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                            {insights.auditVariance.adjustmentReasons.map((ar) => (
                              <span
                                key={ar.reason}
                                style={{
                                  background: '#ffffff',
                                  border: '1px solid var(--border)',
                                  padding: '0.25rem 0.6rem',
                                  borderRadius: '4px',
                                  fontSize: '0.78rem',
                                }}
                              >
                                <strong style={{ textTransform: 'capitalize' }}>{ar.reason.replace(/_/g, ' ')}</strong>: {ar.count} events ({ar.netChangeUnits > 0 ? '+' : ''}{ar.netChangeUnits.toFixed(1)} units)
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stock Adjustment Modal */}
      {showAdjustmentModal && (
        <StockAdjustmentModal
          isOpen={showAdjustmentModal}
          onClose={() => setShowAdjustmentModal(false)}
          onSuccess={handleAdjustmentSuccess}
          items={items}
          preselectedItem={adjustmentTargetItem}
          userRole={userRole}
          allowNegativeStock={allowNegativeStock}
        />
      )}

      {/* Reorder Config Modal */}
      {showReorderModal && reorderTargetItem && (
        <ReorderConfigModal
          isOpen={showReorderModal}
          onClose={() => {
            setShowReorderModal(false);
            setReorderTargetItem(null);
          }}
          onSuccess={handleReorderSuccess}
          item={reorderTargetItem}
          suppliers={suppliers}
        />
      )}
    </div>
  );
};
