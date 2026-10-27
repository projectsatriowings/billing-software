import React, { useState, useEffect, useCallback } from 'react';
import type { StockCount, StockCountLine, Role, Category } from '../../api.ts';
import {
  fetchStockCounts,
  startStockCount,
  fetchStockCountDetails,
  saveStockCountLines,
  finalizeStockCount,
  cancelStockCount,
  can,
} from '../../api.ts';

interface PhysicalStockCountViewProps {
  categories: string[];
  categoriesList?: Category[];
  userRole?: Role;
  onInventoryUpdated: () => void;
  showToast: (msg: string) => void;
}

export const PhysicalStockCountView: React.FC<PhysicalStockCountViewProps> = ({
  categories,
  categoriesList = [],
  userRole,
  onInventoryUpdated,
  showToast,
}) => {
  const [counts, setCounts] = useState<StockCount[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeCountId, setActiveCountId] = useState<string | null>(null);
  const [activeCount, setActiveCount] = useState<StockCount | null>(null);
  const [activeLines, setActiveLines] = useState<StockCountLine[]>([]);
  const [activeLoading, setActiveLoading] = useState<boolean>(false);

  // New count session modal
  const [showNewModal, setShowNewModal] = useState<boolean>(false);
  const [newCountName, setNewCountName] = useState<string>('');
  const [newCountCategory, setNewCountCategory] = useState<string>('ALL');
  const [newCountNotes, setNewCountNotes] = useState<string>('');
  const [isStarting, setIsStarting] = useState<boolean>(false);
  const [newError, setNewError] = useState<string | null>(null);

  // Draft inputs on the active count sheet
  const [countedInputs, setCountedInputs] = useState<{ [lineId: string]: string }>({});
  const [lineNotesInputs, setLineNotesInputs] = useState<{ [lineId: string]: string }>({});
  const [isSavingDraft, setIsSavingDraft] = useState<boolean>(false);

  // Finalize confirmation modal
  const [showFinalizeModal, setShowFinalizeModal] = useState<boolean>(false);
  const [isFinalizing, setIsFinalizing] = useState<boolean>(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);

  // Filter within active session
  const [lineFilter, setLineFilter] = useState<'all' | 'pending' | 'discrepancy' | 'matched'>('all');
  const [lineSearch, setLineSearch] = useState<string>('');

  const isAuthorized = can(userRole, 'stock.adjust');

  const loadCountsList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchStockCounts();
      setCounts(res.counts || []);
    } catch (err) {
      console.error('Failed to load stock count sessions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCountsList();
  }, [loadCountsList]);

  // Load single count details
  const loadCountDetails = useCallback(async (countId: string) => {
    setActiveLoading(true);
    try {
      const res = await fetchStockCountDetails(countId);
      setActiveCount(res.count);
      setActiveLines(res.lines || []);

      // Populate draft inputs
      const initialCounts: { [lineId: string]: string } = {};
      const initialNotes: { [lineId: string]: string } = {};
      for (const l of res.lines || []) {
        if (l.countedQtyMilli !== null && l.countedQtyMilli !== undefined) {
          initialCounts[l.id] = (l.countedQtyMilli / 1000).toString();
        }
        if (l.notes) {
          initialNotes[l.id] = l.notes;
        }
      }
      setCountedInputs(initialCounts);
      setLineNotesInputs(initialNotes);
    } catch (err) {
      console.error('Failed to load count details:', err);
    } finally {
      setActiveLoading(false);
    }
  }, []);

  const handleOpenCountSession = (countId: string) => {
    setActiveCountId(countId);
    loadCountDetails(countId);
  };

  const handleBackToList = () => {
    setActiveCountId(null);
    setActiveCount(null);
    setActiveLines([]);
    loadCountsList();
  };

  // Start new count
  const handleStartCount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCountName.trim()) {
      setNewError('Session name is required.');
      return;
    }

    setIsStarting(true);
    setNewError(null);
    try {
      const res = await startStockCount({
        name: newCountName.trim(),
        category: newCountCategory !== 'ALL' ? newCountCategory : undefined,
        notes: newCountNotes.trim() || undefined,
      });
      setIsStarting(false);
      setShowNewModal(false);
      setNewCountName('');
      setNewCountCategory('ALL');
      setNewCountNotes('');
      showToast(`Started stock count session ${res.count.countNumber}!`);
      handleOpenCountSession(res.count.id);
    } catch (err: any) {
      setIsStarting(false);
      setNewError(err?.message || 'Failed to start stock count session.');
    }
  };

  // Save draft inputs
  const handleSaveDraft = async () => {
    if (!activeCountId || !activeCount) return;
    setIsSavingDraft(true);
    try {
      const linesPayload = activeLines.map((l) => {
        const valStr = countedInputs[l.id];
        let countedQtyMilli: number | null = null;
        if (valStr !== undefined && valStr.trim() !== '') {
          const num = parseFloat(valStr);
          if (!isNaN(num) && num >= 0) {
            countedQtyMilli = Math.round(num * 1000);
          }
        }
        return {
          lineId: l.id,
          countedQtyMilli,
          notes: lineNotesInputs[l.id] || '',
        };
      });

      await saveStockCountLines(activeCountId, linesPayload);
      setIsSavingDraft(false);
      showToast('Count progress saved to draft.');
      loadCountDetails(activeCountId);
    } catch (err: any) {
      setIsSavingDraft(false);
      alert(err?.message || 'Failed to save count draft.');
    }
  };

  // Finalize and apply adjustments
  const handleFinalize = async () => {
    if (!activeCountId || !activeCount) return;
    setIsFinalizing(true);
    setFinalizeError(null);

    try {
      // First save any unsaved inputs
      const linesPayload = activeLines.map((l) => {
        const valStr = countedInputs[l.id];
        let countedQtyMilli: number | null = null;
        if (valStr !== undefined && valStr.trim() !== '') {
          const num = parseFloat(valStr);
          if (!isNaN(num) && num >= 0) {
            countedQtyMilli = Math.round(num * 1000);
          }
        }
        return {
          lineId: l.id,
          countedQtyMilli,
          notes: lineNotesInputs[l.id] || '',
        };
      });
      await saveStockCountLines(activeCountId, linesPayload);

      // Finalize
      const res = await finalizeStockCount(activeCountId);
      setIsFinalizing(false);
      setShowFinalizeModal(false);
      showToast(
        `Finalized count ${res.countNumber}! Applied ${res.appliedAdjustmentsCount} stock adjustment movement(s).`,
      );
      onInventoryUpdated();
      loadCountDetails(activeCountId);
    } catch (err: any) {
      setIsFinalizing(false);
      setFinalizeError(err?.message || 'Failed to finalize count session.');
    }
  };

  // Cancel count
  const handleCancel = async () => {
    if (!activeCountId || !activeCount) return;
    if (!confirm('Are you sure you want to cancel this stock count session? No inventory changes will be made.')) {
      return;
    }
    try {
      await cancelStockCount(activeCountId);
      showToast(`Stock count ${activeCount.countNumber} cancelled.`);
      loadCountDetails(activeCountId);
    } catch (err: any) {
      alert(err?.message || 'Failed to cancel session.');
    }
  };

  // Compute live variance stats on current sheet
  let totalCounted = 0;
  let totalMatched = 0;
  let totalDiscrepancy = 0;
  let totalShortageMilli = 0;
  let totalSurplusMilli = 0;
  const discrepanciesToReview: {
    item: StockCountLine;
    systemUnits: number;
    countedUnits: number;
    diffUnits: number;
  }[] = [];

  for (const l of activeLines) {
    const valStr = countedInputs[l.id];
    const systemUnits = l.systemQtyMilli / 1000;
    if (valStr !== undefined && valStr.trim() !== '') {
      const num = parseFloat(valStr);
      if (!isNaN(num) && num >= 0) {
        totalCounted++;
        const diff = num - systemUnits;
        if (Math.abs(diff) < 0.001) {
          totalMatched++;
        } else {
          totalDiscrepancy++;
          if (diff < 0) totalShortageMilli += Math.abs(diff) * 1000;
          else totalSurplusMilli += diff * 1000;

          discrepanciesToReview.push({
            item: l,
            systemUnits,
            countedUnits: num,
            diffUnits: diff,
          });
        }
      }
    }
  }

  // Filter lines on the sheet
  const filteredLines = activeLines.filter((l) => {
    const matchesSearch =
      !lineSearch ||
      l.itemName.toLowerCase().includes(lineSearch.toLowerCase()) ||
      (l.sku && l.sku.toLowerCase().includes(lineSearch.toLowerCase())) ||
      (l.barcode && l.barcode.toLowerCase().includes(lineSearch.toLowerCase()));

    if (!matchesSearch) return false;

    const valStr = countedInputs[l.id];
    const hasCount = valStr !== undefined && valStr.trim() !== '';
    const num = hasCount ? parseFloat(valStr) : NaN;
    const isCounted = !isNaN(num);
    const diff = isCounted ? num - l.systemQtyMilli / 1000 : 0;

    if (lineFilter === 'pending') return !isCounted;
    if (lineFilter === 'matched') return isCounted && Math.abs(diff) < 0.001;
    if (lineFilter === 'discrepancy') return isCounted && Math.abs(diff) >= 0.001;
    return true;
  });

  return (
    <div className="physical-count-container">
      {!activeCountId ? (
        // View 1: List of Count Sessions
        <div>
          <div className="count-sessions-header">
            <div>
              <h3 className="section-title">Physical Stock Count Sessions</h3>
              <p className="section-subtitle">
                Conduct periodic shelf audits, reconcile physical stock with system counts, and generate approved adjustments.
              </p>
            </div>
            {isAuthorized && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  setNewCountName(`Inventory Count - ${new Date().toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`);
                  setShowNewModal(true);
                }}
              >
                <span>➕</span> Start New Physical Count
              </button>
            )}
          </div>

          {loading ? (
            <div className="table-loading-spinner">
              <div className="spinner"></div>
              <p>Loading count sessions...</p>
            </div>
          ) : counts.length === 0 ? (
            <div className="table-empty-state">
              <span className="empty-icon">📋</span>
              <h3>No Physical Count Sessions Found</h3>
              <p>Start a new count session to audit inventory on your shelves and reconcile differences.</p>
              {isAuthorized && (
                <button
                  type="button"
                  className="btn-primary"
                  style={{ marginTop: '1rem' }}
                  onClick={() => setShowNewModal(true)}
                >
                  Start First Count Session
                </button>
              )}
            </div>
          ) : (
            <div className="ledger-table-wrap">
              <table className="inventory-data-table count-sessions-table">
                <thead>
                  <tr>
                    <th>Session Number</th>
                    <th>Session Name</th>
                    <th>Scope / Category</th>
                    <th>Status</th>
                    <th>Items Audited</th>
                    <th>Discrepancies</th>
                    <th>Created By</th>
                    <th>Date</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {counts.map((c) => (
                    <tr key={c.id}>
                      <td className="mono" style={{ fontWeight: 700 }}>
                        {c.countNumber}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{c.name}</div>
                        {c.notes && <div className="item-cell-sub">{c.notes}</div>}
                      </td>
                      <td>
                        <span className="category-pill">{c.category || 'All Products'}</span>
                      </td>
                      <td>
                        <span
                          className={`status-pill ${
                            c.status === 'completed' ? 'green' : c.status === 'in_progress' ? 'amber' : 'gray'
                          }`}
                        >
                          {c.status === 'in_progress'
                            ? 'In Progress'
                            : c.status === 'completed'
                            ? 'Completed'
                            : 'Cancelled'}
                        </span>
                      </td>
                      <td>
                        <div>
                          <strong>{c.countedItemsCount}</strong> / {c.totalItemsCount} counted
                        </div>
                        <div className="mini-progress-bar">
                          <div
                            className="progress-fill"
                            style={{
                              width: `${
                                c.totalItemsCount ? Math.min(100, Math.round((c.countedItemsCount! / c.totalItemsCount) * 100)) : 0
                              }%`,
                            }}
                          ></div>
                        </div>
                      </td>
                      <td>
                        {c.discrepancyCount && c.discrepancyCount > 0 ? (
                          <span className="discrepancy-pill">
                            {c.discrepancyCount} difference(s)
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>0 discrepancies</span>
                        )}
                      </td>
                      <td>{c.createdByName || 'System'}</td>
                      <td className="mono" style={{ fontSize: '0.8rem' }}>
                        {new Date(c.createdAt).toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn-action-small"
                          onClick={() => handleOpenCountSession(c.id)}
                        >
                          {c.status === 'in_progress' ? 'Continue Count →' : 'View Audit →'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        // View 2: Active Count Sheet
        <div className="active-count-sheet">
          {/* Header Bar */}
          <div className="sheet-top-bar">
            <div className="sheet-top-left">
              <button type="button" className="btn-back-link" onClick={handleBackToList}>
                ← Back to Sessions
              </button>
              <div className="sheet-title-row">
                <span className="sheet-id-badge mono">{activeCount?.countNumber}</span>
                <h2 className="sheet-title">{activeCount?.name}</h2>
                <span
                  className={`status-pill ${
                    activeCount?.status === 'completed'
                      ? 'green'
                      : activeCount?.status === 'in_progress'
                      ? 'amber'
                      : 'gray'
                  }`}
                >
                  {activeCount?.status === 'in_progress'
                    ? 'In Progress (Draft)'
                    : activeCount?.status === 'completed'
                    ? 'Completed & Reconciled'
                    : 'Cancelled'}
                </span>
              </div>
              <div className="sheet-meta-info">
                Scope: <strong>{activeCount?.category || 'All Products'}</strong> • Created by:{' '}
                <strong>{activeCount?.createdByName || 'User'}</strong>
                {activeCount?.finalizedByName ? ` • Finalized by: ${activeCount.finalizedByName}` : ''}
              </div>
            </div>

            <div className="sheet-top-actions">
              {activeCount?.status === 'in_progress' && isAuthorized && (
                <>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleSaveDraft}
                    disabled={isSavingDraft}
                  >
                    {isSavingDraft ? 'Saving Draft...' : '💾 Save Draft'}
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => setShowFinalizeModal(true)}
                  >
                    ⚖️ Finalize & Apply Adjustments
                  </button>
                  <button type="button" className="btn-text-danger" onClick={handleCancel}>
                    Cancel Session
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Real-Time Stats Overview Banner */}
          <div className="count-stats-grid">
            <div className="count-stat-card">
              <span className="stat-label">Total Items to Audit</span>
              <span className="stat-value">{activeLines.length}</span>
            </div>
            <div className="count-stat-card">
              <span className="stat-label">Count Progress</span>
              <span className="stat-value text-purple">
                {totalCounted} / {activeLines.length}{' '}
                <small>({activeLines.length ? Math.round((totalCounted / activeLines.length) * 100) : 0}%)</small>
              </span>
            </div>
            <div className="count-stat-card">
              <span className="stat-label">Exact Match</span>
              <span className="stat-value text-green">
                {totalMatched} <small>items</small>
              </span>
            </div>
            <div className="count-stat-card">
              <span className="stat-label">Discrepancies</span>
              <span className="stat-value text-amber">
                {totalDiscrepancy} <small>items</small>
              </span>
            </div>
          </div>

          {/* Notice: Protected Workflow */}
          <div className="count-workflow-notice">
            <span className="notice-icon">ℹ️</span>
            <span>
              <strong>Inventory Protection Guard:</strong> System stock is <em>not</em> altered while you enter counts.
              Stock adjustments will be created only when an authorized user clicks <strong>Finalize & Apply Adjustments</strong>.
            </span>
          </div>

          {/* Filtering within Sheet */}
          <div className="sheet-filters-bar">
            <div className="sheet-segmented-filter">
              <button
                type="button"
                className={`filter-tab ${lineFilter === 'all' ? 'active' : ''}`}
                onClick={() => setLineFilter('all')}
              >
                All Items ({activeLines.length})
              </button>
              <button
                type="button"
                className={`filter-tab ${lineFilter === 'pending' ? 'active' : ''}`}
                onClick={() => setLineFilter('pending')}
              >
                Pending Count ({activeLines.length - totalCounted})
              </button>
              <button
                type="button"
                className={`filter-tab ${lineFilter === 'discrepancy' ? 'active' : ''}`}
                onClick={() => setLineFilter('discrepancy')}
              >
                Discrepancies Only ({totalDiscrepancy})
              </button>
              <button
                type="button"
                className={`filter-tab ${lineFilter === 'matched' ? 'active' : ''}`}
                onClick={() => setLineFilter('matched')}
              >
                Matched ({totalMatched})
              </button>
            </div>

            <div className="sheet-search-wrap">
              <input
                type="text"
                className="filter-input"
                placeholder="Search items on this sheet..."
                value={lineSearch}
                onChange={(e) => setLineSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Count Lines Table */}
          {activeLoading ? (
            <div className="table-loading-spinner">
              <div className="spinner"></div>
              <p>Loading items...</p>
            </div>
          ) : (
            <div className="ledger-table-wrap">
              <table className="inventory-data-table count-sheet-table">
                <thead>
                  <tr>
                    <th>Product & SKU / Barcode</th>
                    <th>Category</th>
                    <th style={{ textAlign: 'right' }}>System Expected</th>
                    <th style={{ width: '180px' }}>Physical Count</th>
                    <th style={{ textAlign: 'right' }}>Difference</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLines.map((l) => {
                    const systemUnits = l.systemQtyMilli / 1000;
                    const valStr = countedInputs[l.id] ?? '';
                    const hasCount = valStr.trim() !== '';
                    const num = hasCount ? parseFloat(valStr) : NaN;
                    const isCounted = !isNaN(num);
                    const diffUnits = isCounted ? num - systemUnits : 0;
                    const isCompleted = activeCount?.status === 'completed';

                    return (
                      <tr key={l.id} className={isCounted && Math.abs(diffUnits) >= 0.001 ? 'discrepancy-row' : ''}>
                        <td>
                          <div className="item-cell-title">{l.itemName}</div>
                          <div className="item-cell-sub">
                            {l.sku ? `SKU: ${l.sku}` : ''}
                            {l.sku && l.barcode ? ' • ' : ''}
                            {l.barcode ? `Barcode: ${l.barcode}` : ''}
                          </div>
                        </td>
                        <td>
                          <span className="category-pill">{l.category || 'General'}</span>
                        </td>
                        <td style={{ textAlign: 'right' }} className="mono">
                          <strong style={{ fontSize: '0.95rem' }}>
                            {systemUnits.toFixed(1)} {l.unit}
                          </strong>
                        </td>
                        <td>
                          {isCompleted ? (
                            <span className="mono" style={{ fontWeight: 700 }}>
                              {l.countedQtyMilli !== null ? `${(l.countedQtyMilli / 1000).toFixed(1)} ${l.unit}` : '--'}
                            </span>
                          ) : (
                            <div className="input-with-unit small">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                className="form-input count-input-box"
                                placeholder="Enter count..."
                                value={valStr}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setCountedInputs((prev) => ({ ...prev, [l.id]: v }));
                                }}
                              />
                              <span className="input-unit-tag">{l.unit}</span>
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {!isCounted ? (
                            <span className="diff-pill pending">Pending</span>
                          ) : Math.abs(diffUnits) < 0.001 ? (
                            <span className="diff-pill match">✓ Match</span>
                          ) : diffUnits < 0 ? (
                            <span className="diff-pill shortage">
                              ▼ {diffUnits.toFixed(1)} {l.unit}
                            </span>
                          ) : (
                            <span className="diff-pill surplus">
                              ▲ +{diffUnits.toFixed(1)} {l.unit}
                            </span>
                          )}
                        </td>
                        <td>
                          {isCompleted ? (
                            <span>{l.notes || '--'}</span>
                          ) : (
                            <input
                              type="text"
                              className="form-input line-note-box"
                              placeholder="Observation..."
                              value={lineNotesInputs[l.id] ?? ''}
                              onChange={(e) => {
                                const v = e.target.value;
                                setLineNotesInputs((prev) => ({ ...prev, [l.id]: v }));
                              }}
                            />
                          )}
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

      {/* Start New Session Modal */}
      {showNewModal && (
        <div className="modal-overlay modal-backdrop" onClick={() => setShowNewModal(false)} style={{ zIndex: 10000 }}>
          <div
            className="modal-content inventory-modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '480px', width: '92%' }}
          >
            <div className="modal-header">
              <div className="modal-title-wrap">
                <span className="modal-icon-badge purple">📋</span>
                <div>
                  <h2 className="modal-title">Start Physical Stock Count</h2>
                  <p className="modal-subtitle">Snapshot inventory for shelf auditing</p>
                </div>
              </div>
              <button type="button" className="btn-close-modal" onClick={() => setShowNewModal(false)} aria-label="Close modal">
                ✕
              </button>
            </div>

            <form onSubmit={handleStartCount} className="modal-form-body">
              {newError && (
                <div className="form-error-alert" style={{ marginBottom: '1rem' }}>
                  <span className="error-icon">⚠️</span>
                  <span>{newError}</span>
                </div>
              )}

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="field-label required">Session Name</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Monthly Physical Audit - Oct 2026"
                  value={newCountName}
                  onChange={(e) => setNewCountName(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="form-group" style={{ marginBottom: '1rem' }}>
                <label className="field-label">Audit Scope</label>
                <select
                  className="form-input select"
                  value={newCountCategory}
                  onChange={(e) => setNewCountCategory(e.target.value)}
                >
                  <option value="ALL">📦 All Tracked Products in Store</option>
                  {categoriesList && categoriesList.length > 0
                    ? categoriesList
                        .filter((c) => c.active)
                        .map((c) => (
                          <option key={c.id} value={c.name}>
                            📁 {c.parentName ? `${c.parentName} → ${c.name}` : c.name}
                          </option>
                        ))
                    : categories.map((c) => (
                        <option key={c} value={c}>
                          📁 Category: {c}
                        </option>
                      ))}
                </select>
                <span className="field-helper">You can audit your entire catalog or limit this audit to a specific category.</span>
              </div>

              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label className="field-label">Notes & Purpose</label>
                <textarea
                  className="form-input"
                  rows={2}
                  placeholder="Optional notes or audit reason..."
                  value={newCountNotes}
                  onChange={(e) => setNewCountNotes(e.target.value)}
                />
              </div>

              <div className="modal-actions-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowNewModal(false)}
                  disabled={isStarting}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={isStarting}>
                  {isStarting ? 'Starting Session...' : 'Create Count Session'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Finalize Confirmation Modal */}
      {showFinalizeModal && (
        <div className="modal-overlay modal-backdrop" onClick={() => setShowFinalizeModal(false)} style={{ zIndex: 10000 }}>
          <div
            className="modal-content inventory-modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '580px', width: '92%' }}
          >
            <div className="modal-header">
              <div className="modal-title-wrap">
                <span className="modal-icon-badge amber">⚖️</span>
                <div>
                  <h2 className="modal-title">Finalize Physical Stock Count</h2>
                  <p className="modal-subtitle">Review differences before applying stock adjustments</p>
                </div>
              </div>
              <button type="button" className="btn-close-modal" onClick={() => setShowFinalizeModal(false)} aria-label="Close modal">
                ✕
              </button>
            </div>

            <div className="modal-form-body">
              {finalizeError && (
                <div className="form-error-alert" style={{ marginBottom: '1rem' }}>
                  <span className="error-icon">⚠️</span>
                  <span>{finalizeError}</span>
                </div>
              )}

              <p style={{ margin: '0 0 1rem 0', fontSize: '0.92rem', color: 'var(--text-main)' }}>
                Finalizing this count session will create auditable stock adjustment movements for all items with verified differences.
              </p>

              <div className="review-stat-summary-bar">
                <div className="review-stat">
                  <span>Counted Items</span>
                  <strong>{totalCounted}</strong>
                </div>
                <div className="review-stat">
                  <span>Matched</span>
                  <strong style={{ color: '#10b981' }}>{totalMatched}</strong>
                </div>
                <div className="review-stat">
                  <span>Adjustments to Apply</span>
                  <strong style={{ color: '#f59e0b' }}>{discrepanciesToReview.length}</strong>
                </div>
              </div>

              {discrepanciesToReview.length > 0 ? (
                <div className="discrepancy-review-scroll-table">
                  <table className="mini-review-table">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th style={{ textAlign: 'right' }}>System</th>
                        <th style={{ textAlign: 'right' }}>Physical</th>
                        <th style={{ textAlign: 'right' }}>Adjustment</th>
                      </tr>
                    </thead>
                    <tbody>
                      {discrepanciesToReview.map((d) => (
                        <tr key={d.item.id}>
                          <td>{d.item.itemName}</td>
                          <td style={{ textAlign: 'right' }} className="mono">
                            {d.systemUnits.toFixed(1)}
                          </td>
                          <td style={{ textAlign: 'right' }} className="mono">
                            {d.countedUnits.toFixed(1)}
                          </td>
                          <td
                            style={{
                              textAlign: 'right',
                              fontWeight: 700,
                              color: d.diffUnits >= 0 ? '#10b981' : '#f43f5e',
                            }}
                            className="mono"
                          >
                            {d.diffUnits >= 0 ? `+${d.diffUnits.toFixed(1)}` : d.diffUnits.toFixed(1)} {d.item.unit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="perfect-match-banner">
                  <span>🎉</span>
                  <span>All counted items match system quantities! No adjustments needed.</span>
                </div>
              )}

              <div className="modal-actions-footer" style={{ marginTop: '1.25rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowFinalizeModal(false)}
                  disabled={isFinalizing}
                >
                  Back to Count Sheet
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleFinalize}
                  disabled={isFinalizing}
                >
                  {isFinalizing ? 'Finalizing & Reconciling...' : 'Confirm & Apply Adjustments'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
