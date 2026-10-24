import React, { useState, useEffect, useCallback } from 'react';
import type { StockMove, StockMoveKind, Item } from '../../api.ts';
import { fetchStockLedger } from '../../api.ts';

interface StockLedgerViewProps {
  initialItemId?: string;
  items: Item[];
  onOpenInvoice?: (invoiceId: string) => void;
  onOpenPurchase?: (purchaseId: string) => void;
}

export const StockLedgerView: React.FC<StockLedgerViewProps> = ({
  initialItemId,
  items,
}) => {
  const [moves, setMoves] = useState<StockMove[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedItemId, setSelectedItemId] = useState<string>(initialItemId || '');
  const [kindFilter, setKindFilter] = useState<string>('ALL');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const pageSize = 25;

  const loadLedger = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchStockLedger({
        itemId: selectedItemId || undefined,
        kind: kindFilter !== 'ALL' ? kindFilter : undefined,
        from: fromDate || undefined,
        to: toDate || undefined,
        q: searchQuery.trim() || undefined,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      setMoves(res.moves || []);
      setTotal(res.total || 0);
    } catch (err) {
      console.error('Failed to load stock ledger:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedItemId, kindFilter, fromDate, toDate, searchQuery, page]);

  useEffect(() => {
    loadLedger();
  }, [loadLedger]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const formatKindBadge = (kind: StockMoveKind) => {
    switch (kind) {
      case 'sale':
        return <span className="ledger-badge sale">Sale (POS)</span>;
      case 'purchase':
        return <span className="ledger-badge purchase">Purchase Inward</span>;
      case 'return':
        return <span className="ledger-badge return">Sales Return</span>;
      case 'adjust':
        return <span className="ledger-badge adjust">Stock Adjustment</span>;
      case 'opening':
        return <span className="ledger-badge opening">Opening Stock</span>;
      case 'transfer':
        return <span className="ledger-badge transfer">Transfer</span>;
      default:
        return <span className="ledger-badge default">{kind}</span>;
    }
  };

  const formatDateTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return (
        d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
        ' ' +
        d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      );
    } catch {
      return iso;
    }
  };

  return (
    <div className="stock-ledger-container">
      {/* Filters Bar */}
      <div className="ledger-filters-card">
        <div className="ledger-filter-row">
          {/* Search box */}
          <div className="filter-field search" style={{ flex: '1 1 240px' }}>
            <label className="filter-label">Search Ledger</label>
            <div className="search-input-wrap">
              <input
                type="text"
                className="filter-input"
                placeholder="Search by product, SKU, barcode, document #..."
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
          </div>

          {/* Product Dropdown */}
          <div className="filter-field" style={{ flex: '1 1 200px' }}>
            <label className="filter-label">Filter by Product</label>
            <select
              className="filter-select"
              value={selectedItemId}
              onChange={(e) => {
                setSelectedItemId(e.target.value);
                setPage(1);
              }}
            >
              <option value="">-- All Products --</option>
              {items
                .filter((i) => i.active !== false)
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} {i.sku ? `(${i.sku})` : ''}
                  </option>
                ))}
            </select>
          </div>

          {/* Movement Kind */}
          <div className="filter-field" style={{ flex: '0 1 180px' }}>
            <label className="filter-label">Movement Type</label>
            <select
              className="filter-select"
              value={kindFilter}
              onChange={(e) => {
                setKindFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="ALL">All Movements</option>
              <option value="sale">Sales (Outflow)</option>
              <option value="purchase">Purchases (Inflow)</option>
              <option value="return">Sales Returns (Restock)</option>
              <option value="adjust">Stock Adjustments</option>
              <option value="opening">Opening Stock</option>
              <option value="transfer">Transfers</option>
            </select>
          </div>

          {/* Date Range: From */}
          <div className="filter-field" style={{ flex: '0 1 140px' }}>
            <label className="filter-label">From Date</label>
            <input
              type="date"
              className="filter-input"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPage(1);
              }}
            />
          </div>

          {/* Date Range: To */}
          <div className="filter-field" style={{ flex: '0 1 140px' }}>
            <label className="filter-label">To Date</label>
            <input
              type="date"
              className="filter-input"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setPage(1);
              }}
            />
          </div>

          {/* Reset Filters */}
          {(selectedItemId || kindFilter !== 'ALL' || fromDate || toDate || searchQuery) && (
            <div className="filter-field" style={{ alignSelf: 'flex-end' }}>
              <button
                type="button"
                className="btn-reset-filters"
                onClick={() => {
                  setSelectedItemId('');
                  setKindFilter('ALL');
                  setFromDate('');
                  setToDate('');
                  setSearchQuery('');
                  setPage(1);
                }}
              >
                Reset
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Audit Banner */}
      <div className="ledger-audit-banner">
        <span className="banner-icon">🔒</span>
        <span>
          <strong>Immutable Stock Ledger:</strong> Historical stock movements cannot be directly edited or deleted.
          Corrections are preserved as linked adjustment movements with audit trails.
        </span>
      </div>

      {/* Ledger Table */}
      <div className="ledger-table-wrap">
        {loading ? (
          <div className="table-loading-spinner">
            <div className="spinner"></div>
            <p>Loading chronological stock ledger...</p>
          </div>
        ) : moves.length === 0 ? (
          <div className="table-empty-state">
            <span className="empty-icon">📜</span>
            <h3>No Stock Movements Found</h3>
            <p>No transactions match your current filters. Try resetting the filters above.</p>
          </div>
        ) : (
          <table className="inventory-data-table ledger-table">
            <thead>
              <tr>
                <th>Date & Time</th>
                <th>Product & Identifiers</th>
                <th>Type</th>
                <th>Reference Doc</th>
                <th style={{ textAlign: 'right' }}>In (+)</th>
                <th style={{ textAlign: 'right' }}>Out (-)</th>
                <th style={{ textAlign: 'right' }}>Prev Balance</th>
                <th style={{ textAlign: 'right' }}>New Balance</th>
                <th>Operator</th>
                <th>Reason / Notes</th>
              </tr>
            </thead>
            <tbody>
              {moves.map((m) => {
                const prevUnits = (m.previousBalanceMilli || 0) / 1000;
                const newUnits = (m.resultingBalanceMilli || 0) / 1000;
                const inUnits = (m.qtyInMilli || 0) / 1000;
                const outUnits = (m.qtyOutMilli || 0) / 1000;
                const unit = m.unit || 'pcs';

                return (
                  <tr key={m.id} className="ledger-row">
                    <td className="mono" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                      {formatDateTime(m.createdAt)}
                    </td>
                    <td>
                      <div className="item-cell-title">{m.itemName}</div>
                      <div className="item-cell-sub">
                        {m.sku ? `SKU: ${m.sku}` : ''}
                        {m.sku && m.barcode ? ' • ' : ''}
                        {m.barcode ? `Barcode: ${m.barcode}` : ''}
                        {m.batchNo ? ` • Batch: ${m.batchNo}` : ''}
                      </div>
                    </td>
                    <td>{formatKindBadge(m.kind)}</td>
                    <td>
                      {m.refNumber ? (
                        <span className="doc-ref-chip">
                          {m.refNumber}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>--</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {inUnits > 0 ? (
                        <span className="qty-in-pill">
                          +{inUnits.toFixed(1)} {unit}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-dim)' }}>-</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {outUnits > 0 ? (
                        <span className="qty-out-pill">
                          -{outUnits.toFixed(1)} {unit}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-dim)' }}>-</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)' }} className="mono">
                      {prevUnits.toFixed(1)}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }} className="mono">
                      <span className={newUnits <= 0 ? 'text-red' : 'text-purple'}>
                        {newUnits.toFixed(1)} {unit}
                      </span>
                    </td>
                    <td>
                      <span className="operator-chip">{m.userName || 'System'}</span>
                    </td>
                    <td style={{ maxWidth: '200px' }}>
                      <div className="notes-wrap" title={m.notes || m.reason || ''}>
                        {m.reason && <span className="reason-tag-inline">{m.reason}</span>}
                        {m.notes && <span className="notes-text">{m.notes}</span>}
                        {!m.reason && !m.notes && <span style={{ color: 'var(--text-dim)' }}>--</span>}
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
      {total > pageSize && (
        <div className="pagination-bar">
          <div className="pagination-info">
            Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total} movements
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
  );
};
