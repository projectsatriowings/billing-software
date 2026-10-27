import React, { useState, useEffect } from 'react';
import {
  fetchActiveShift,
  fetchShifts,
  fetchShiftDetails,
  type Shift,
  type CashMovement,
  type User,
  type Shop,
} from '../../api.ts';
import { formatMoney } from '../../../../shared/shifts.ts';
import { OpenShiftModal } from './OpenShiftModal.tsx';
import { CashMovementModal } from './CashMovementModal.tsx';
import { CloseShiftModal } from './CloseShiftModal.tsx';
import { ShiftClosingReportModal } from './ShiftClosingReportModal.tsx';

interface ShiftsDashboardProps {
  user: User;
  shop: Shop | null;
  onNavigateToPos?: () => void;
}

export const ShiftsDashboard: React.FC<ShiftsDashboardProps> = ({
  user,
  shop,
  onNavigateToPos,
}) => {
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [shiftHistory, setShiftHistory] = useState<Shift[]>([]);
  const [loadingActive, setLoadingActive] = useState<boolean>(true);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);
  const [selectedTab, setSelectedTab] = useState<'overview' | 'payments' | 'movements' | 'history'>('overview');
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>('ALL');

  // Modals state
  const [isOpenShiftModalOpen, setIsOpenShiftModalOpen] = useState<boolean>(false);
  const [isCashMovementModalOpen, setIsCashMovementModalOpen] = useState<boolean>(false);
  const [isCloseShiftModalOpen, setIsCloseShiftModalOpen] = useState<boolean>(false);
  const [reportModalShiftId, setReportModalShiftId] = useState<string | null>(null);

  // Active shift detail cache
  const [movements, setMovements] = useState<CashMovement[]>([]);

  useEffect(() => {
    loadActiveShift();
    loadHistory();

    const handleSync = () => {
      loadActiveShift();
      loadHistory();
    };

    window.addEventListener('shift_status_changed', handleSync);
    window.addEventListener('cash_movement_recorded', handleSync);

    return () => {
      window.removeEventListener('shift_status_changed', handleSync);
      window.removeEventListener('cash_movement_recorded', handleSync);
    };
  }, [historyStatusFilter]);

  const loadActiveShift = async () => {
    setLoadingActive(true);
    try {
      const res = await fetchActiveShift();
      setActiveShift(res.activeShift);
      if (res.activeShift) {
        // Load movements
        const det = await fetchShiftDetails(res.activeShift.id);
        setMovements(det.movements || (det.shift as any)?.cashMovements || []);
      } else {
        setMovements([]);
      }
    } catch (err: any) {
      console.error('Failed to load active shift:', err);
    } finally {
      setLoadingActive(false);
    }
  };

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await fetchShifts({ status: historyStatusFilter, limit: 50 });
      setShiftHistory(res.shifts || []);
    } catch (err: any) {
      console.error('Failed to load shift history:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleOpenSuccess = (newShift: Shift) => {
    setActiveShift(newShift);
    window.dispatchEvent(new Event('shift_status_changed'));
    loadActiveShift();
    loadHistory();
  };

  const handleCloseSuccess = (closedShift: Shift) => {
    setActiveShift(null);
    setReportModalShiftId(closedShift.id);
    window.dispatchEvent(new Event('shift_status_changed'));
    loadHistory();
  };

  const handleMovementSuccess = (_movement?: any, updatedSummary?: any) => {
    window.dispatchEvent(new Event('shift_status_changed'));
    window.dispatchEvent(new Event('cash_movement_recorded'));
    if (updatedSummary) {
      setActiveShift((prev) => (prev ? { ...prev, summary: updatedSummary } : null));
    }
    loadActiveShift();
    loadHistory();
  };

  const summary = activeShift?.summary;

  // Safe format shift opened timestamp (contextual date + time, with fallback)
  const formatShiftOpenedAt = (openedAtStr?: string | null) => {
    if (!openedAtStr) return 'Opening time unavailable';
    const date = new Date(openedAtStr);
    if (isNaN(date.getTime())) return 'Opening time unavailable';

    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = date.toDateString() === yesterday.toDateString();

    const timeStr = date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
    if (isToday) return timeStr;
    if (isYesterday) return `Yesterday · ${timeStr}`;
    const dateStr = date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
    return `${dateStr} · ${timeStr}`;
  };

  // Running shift duration calculation
  const getDurationString = (openedAtStr?: string | null) => {
    if (!openedAtStr) return '';
    const date = new Date(openedAtStr);
    if (isNaN(date.getTime())) return '';
    const diffMs = Math.max(0, Date.now() - date.getTime());
    const totalMinutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    if (hours === 0) return `${mins} min`;
    return `${hours} hr ${mins} min`;
  };

  return (
    <div className="shifts-dashboard-wrapper">
      {/* Top Banner / Hero Card */}
      <div className="shifts-hero-card">
        <div className="shifts-hero-left">
          <div className="hero-status-pill-wrap">
            {activeShift ? (
              <span className="shift-active-badge">
                <span className="pulse-green-dot"></span>
                ACTIVE CASHIER SHIFT
              </span>
            ) : (
              <span className="shift-closed-badge">
                <span className="gray-dot"></span>
                NO ACTIVE SHIFT OPEN
              </span>
            )}
            <span className="shop-location-chip">
              📍 {activeShift?.location || 'Main Counter'}
            </span>
          </div>

          <h2 className="shifts-hero-title">
            {activeShift ? (
              <>
                Shift <strong>{activeShift.shiftNumber}</strong> • Cashier: <strong>{activeShift.userName || user.name}</strong>
              </>
            ) : (
              'Drawer Register Ready for New Shift'
            )}
          </h2>

          <p className="shifts-hero-subtitle">
            {activeShift ? (
              <>
                Opened {formatShiftOpenedAt(activeShift.openedAt)}
                {getDurationString(activeShift.openedAt) && (
                  <> • Active for <strong>{getDurationString(activeShift.openedAt)}</strong></>
                )}
              </>
            ) : (
              'Open a shift with an initial opening cash float to begin recording sales and drawer cash movements.'
            )}
          </p>
        </div>

        <div className="shifts-hero-actions">
          {activeShift ? (
            <>
              <button
                type="button"
                className="btn btn-primary btn-hero-action"
                onClick={() => setIsCashMovementModalOpen(true)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4"/>
                </svg>
                <span>Cash In / Out</span>
              </button>
              <button
                type="button"
                className="btn btn-danger btn-hero-action"
                onClick={() => setIsCloseShiftModalOpen(true)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
                <span>Close Shift</span>
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-hero-action"
                onClick={() => setReportModalShiftId(activeShift.id)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                </svg>
                <span>Live Summary</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-success btn-hero-action large"
              onClick={() => setIsOpenShiftModalOpen(true)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="16"></line>
                <line x1="8" y1="12" x2="16" y2="12"></line>
              </svg>
              <span>Open New Cashier Shift</span>
            </button>
          )}
        </div>
      </div>

      {/* Real-time KPI Metric Cards */}
      {activeShift && summary && (
        <div className="shifts-kpi-grid">
          {/* Card 1: Expected Drawer Cash */}
          <div className="shift-kpi-card highlight-expected">
            <div className="kpi-card-top">
              <span className="kpi-label">EXPECTED IN DRAWER</span>
              <span className="kpi-icon">💰</span>
            </div>
            <div className="kpi-main-val font-mono">{formatMoney(summary.expectedCashMinor)}</div>
            <span className="kpi-subtext">
              Float ({formatMoney(summary.openingCashMinor)}) + Net Cash ({formatMoney(summary.expectedCashMinor - summary.openingCashMinor)})
            </span>
          </div>

          {/* Card 2: Cash Sales Collected */}
          <div className="shift-kpi-card">
            <div className="kpi-card-top">
              <span className="kpi-label">CASH SALES</span>
              <span className="kpi-icon text-success">💵</span>
            </div>
            <div className="kpi-main-val font-mono text-success">{formatMoney(summary.cashSalesMinor)}</div>
            <span className="kpi-subtext">Received into drawer from POS checkout</span>
          </div>

          {/* Card 3: Non-Cash Collections */}
          <div className="shift-kpi-card">
            <div className="kpi-card-top">
              <span className="kpi-label">NON-CASH (UPI / CARD)</span>
              <span className="kpi-icon text-primary">💳</span>
            </div>
            <div className="kpi-main-val font-mono text-primary">{formatMoney(summary.nonCashPaymentsMinor)}</div>
            <span className="kpi-subtext">Direct bank credit (excluded from drawer)</span>
          </div>

          {/* Card 4: Net Cash Movements */}
          <div className="shift-kpi-card">
            <div className="kpi-card-top">
              <span className="kpi-label">NET CASH IN / OUT</span>
              <span className="kpi-icon text-warning">🔄</span>
            </div>
            <div className="kpi-main-val font-mono text-warning">
              {formatMoney(summary.cashInMinor - summary.cashOutMinor)}
            </div>
            <span className="kpi-subtext">
              +{formatMoney(summary.cashInMinor)} In • -{formatMoney(summary.cashOutMinor)} Out
            </span>
          </div>

          {/* Card 5: Total Shift Turnover */}
          <div className="shift-kpi-card">
            <div className="kpi-card-top">
              <span className="kpi-label">TOTAL COLLECTIONS</span>
              <span className="kpi-icon">📈</span>
            </div>
            <div className="kpi-main-val font-mono">{formatMoney(summary.totalCollectedMinor)}</div>
            <span className="kpi-subtext">
              Cash ({formatMoney(summary.cashSalesMinor)}) + Digital ({formatMoney(summary.nonCashPaymentsMinor)})
            </span>
          </div>
        </div>
      )}

      {/* Tabs Navigation */}
      <div className="shifts-nav-tabs">
        <button
          type="button"
          className={`tab-btn ${selectedTab === 'overview' ? 'active' : ''}`}
          onClick={() => setSelectedTab('overview')}
        >
          🧮 Drawer Reconciliation
        </button>
        <button
          type="button"
          className={`tab-btn ${selectedTab === 'payments' ? 'active' : ''}`}
          onClick={() => setSelectedTab('payments')}
        >
          💳 Payment Breakdown
        </button>
        <button
          type="button"
          className={`tab-btn ${selectedTab === 'movements' ? 'active' : ''}`}
          onClick={() => setSelectedTab('movements')}
        >
          📋 Cash Movements ({movements.length})
        </button>
        <button
          type="button"
          className={`tab-btn ${selectedTab === 'history' ? 'active' : ''}`}
          onClick={() => setSelectedTab('history')}
        >
          📜 Past Shifts ({shiftHistory.length})
        </button>
      </div>

      {/* TAB CONTENT 1: OVERVIEW & DRAWER FORMULA */}
      {selectedTab === 'overview' && (
        <div className="shifts-tab-content">
          {activeShift && summary ? (
            <div className="shifts-overview-layout">
              {/* Formula Demonstration Box */}
              <div className="shifts-section-card">
                <div className="card-header-clean">
                  <h3 className="section-title">Authoritative Expected Cash Formula</h3>
                  <span className="badge-pill info">Strict Integer Paise Math</span>
                </div>

                <div className="formula-detailed-flow">
                  <div className="formula-step">
                    <div className="step-badge">1</div>
                    <div className="step-content">
                      <span className="step-title">Opening Float</span>
                      <span className="step-desc">Physical cash in drawer at shift start</span>
                      <span className="step-amount font-mono">{formatMoney(summary.openingCashMinor)}</span>
                    </div>
                  </div>

                  <div className="formula-operator">+</div>

                  <div className="formula-step">
                    <div className="step-badge">2</div>
                    <div className="step-content">
                      <span className="step-title">Cash Sales</span>
                      <span className="step-desc">Cash payments received against invoices</span>
                      <span className="step-amount font-mono text-success">+{formatMoney(summary.cashSalesMinor)}</span>
                    </div>
                  </div>

                  <div className="formula-operator">+</div>

                  <div className="formula-step">
                    <div className="step-badge">3</div>
                    <div className="step-content">
                      <span className="step-title">Cash-In Movements</span>
                      <span className="step-desc">Authorized safe transfers or change deposits</span>
                      <span className="step-amount font-mono text-success">+{formatMoney(summary.cashInMinor)}</span>
                    </div>
                  </div>

                  <div className="formula-operator">-</div>

                  <div className="formula-step">
                    <div className="step-badge">4</div>
                    <div className="step-content">
                      <span className="step-title">Cash-Out Movements</span>
                      <span className="step-desc">Petty cash, owner draws, or safe deposits</span>
                      <span className="step-amount font-mono text-warning">-{formatMoney(summary.cashOutMinor)}</span>
                    </div>
                  </div>

                  <div className="formula-operator">-</div>

                  <div className="formula-step">
                    <div className="step-badge">5</div>
                    <div className="step-content">
                      <span className="step-title">Cash Refunds</span>
                      <span className="step-desc">Refunds paid in physical cash from drawer</span>
                      <span className="step-amount font-mono text-danger">-{formatMoney(summary.cashRefundsMinor)}</span>
                    </div>
                  </div>

                  <div className="formula-operator">=</div>

                  <div className="formula-step result">
                    <div className="step-badge primary">✓</div>
                    <div className="step-content">
                      <span className="step-title">EXPECTED DRAWER CASH</span>
                      <span className="step-desc">Exact expected cash to be counted at closing</span>
                      <span className="step-amount font-mono font-bold text-primary">
                        {formatMoney(summary.expectedCashMinor)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="formula-safety-notice">
                  <span>🛡️</span>
                  <span>
                    <strong>Financial Safety Guarantee:</strong> Unpaid credit sales ({formatMoney(summary.creditSalesUnpaidMinor)}) and digital payments ({formatMoney(summary.nonCashPaymentsMinor)}) are strictly isolated and do not artificially inflate the physical cash drawer.
                  </span>
                </div>
              </div>

              {/* Quick Actions Card */}
              <div className="shifts-section-card side-actions-card">
                <h3 className="section-title">Shift Actions</h3>
                <div className="side-actions-list">
                  <button
                    type="button"
                    className="side-action-btn primary"
                    onClick={() => setIsCashMovementModalOpen(true)}
                  >
                    <span>📥</span>
                    <div>
                      <strong>Add Cash-In</strong>
                      <p>Deposit float or change from safe</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="side-action-btn warning"
                    onClick={() => setIsCashMovementModalOpen(true)}
                  >
                    <span>📤</span>
                    <div>
                      <strong>Record Cash-Out</strong>
                      <p>Withdraw petty cash or owner draw</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="side-action-btn success"
                    onClick={onNavigateToPos}
                  >
                    <span>🛒</span>
                    <div>
                      <strong>Open POS Counter</strong>
                      <p>Record sales under this active shift</p>
                    </div>
                  </button>

                  <button
                    type="button"
                    className="side-action-btn danger"
                    onClick={() => setIsCloseShiftModalOpen(true)}
                  >
                    <span>🔒</span>
                    <div>
                      <strong>Close Shift & Reconcile</strong>
                      <p>Count cash, compute variance, and finalize</p>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-shift-banner">
              <span className="empty-icon">🏪</span>
              <h3>No Active Shift Open</h3>
              <p>You currently do not have an open shift. Click below to start your shift with an opening cash float.</p>
              <button
                type="button"
                className="btn btn-success btn-lg"
                onClick={() => setIsOpenShiftModalOpen(true)}
              >
                🟢 Open Cashier Shift Now
              </button>
            </div>
          )}
        </div>
      )}

      {/* TAB CONTENT 2: PAYMENT METHOD BREAKDOWN */}
      {selectedTab === 'payments' && (
        <div className="shifts-tab-content">
          <div className="shifts-section-card">
            <div className="card-header-clean">
              <h3 className="section-title">Collections by Payment Method</h3>
              <span className="badge-pill">Active Shift Receipts</span>
            </div>

            {summary && summary.paymentMethods.length > 0 ? (
              <table className="shifts-table">
                <thead>
                  <tr>
                    <th>Payment Method</th>
                    <th>Classification</th>
                    <th className="text-center">Count</th>
                    <th className="text-right">Collected Amount</th>
                    <th className="text-right">% of Total</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.paymentMethods.map((pm) => {
                    const pct = summary.totalCollectedMinor > 0
                      ? ((pm.amountMinor / summary.totalCollectedMinor) * 100).toFixed(1)
                      : '0.0';
                    return (
                      <tr key={pm.method}>
                        <td>
                          <span className={`method-badge ${pm.method}`}>
                            {pm.method.toUpperCase()}
                          </span>
                        </td>
                        <td>
                          {pm.method === 'cash' ? (
                            <span className="text-success font-semibold">Physical Cash Drawer</span>
                          ) : (
                            <span className="text-muted">Digital / Bank Transfer</span>
                          )}
                        </td>
                        <td className="text-center font-mono">{pm.count}</td>
                        <td className="text-right font-mono font-semibold">{formatMoney(pm.amountMinor)}</td>
                        <td className="text-right font-mono text-muted">{pct}%</td>
                      </tr>
                    );
                  })}
                  <tr className="table-total-row">
                    <td colSpan={2}><strong>TOTAL SETTLED COLLECTIONS</strong></td>
                    <td className="text-center font-mono font-bold">
                      {summary.paymentMethods.reduce((a, b) => a + b.count, 0)}
                    </td>
                    <td className="text-right font-mono font-bold text-primary">
                      {formatMoney(summary.totalCollectedMinor)}
                    </td>
                    <td className="text-right font-mono font-bold">100%</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <div className="empty-subtab-state">
                <span>💳</span>
                <p>No payments recorded yet for this active shift.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB CONTENT 3: CASH MOVEMENTS */}
      {selectedTab === 'movements' && (
        <div className="shifts-tab-content">
          <div className="shifts-section-card">
            <div className="card-header-clean">
              <h3 className="section-title">Cash Movements Ledger</h3>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => setIsCashMovementModalOpen(true)}
                disabled={!activeShift}
              >
                + Record Movement
              </button>
            </div>

            {movements.length > 0 ? (
              <table className="shifts-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Type</th>
                    <th>Reason</th>
                    <th>Notes</th>
                    <th>Author</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((cm) => (
                    <tr key={cm.id}>
                      <td className="font-mono text-muted" style={{ fontSize: '0.85rem' }}>
                        {new Date(cm.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td>
                        <span className={`movement-tag ${cm.movementType}`}>
                          {cm.movementType === 'cash_in' ? 'CASH-IN' : 'CASH-OUT'}
                        </span>
                      </td>
                      <td><strong>{cm.reason}</strong></td>
                      <td className="text-muted">{cm.notes || '—'}</td>
                      <td>{cm.createdByName || 'Staff'}</td>
                      <td className={`text-right font-mono font-semibold ${cm.movementType === 'cash_in' ? 'text-success' : 'text-warning'}`}>
                        {cm.movementType === 'cash_in' ? '+' : '-'}{formatMoney(cm.amountMinor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty-subtab-state">
                <span>📋</span>
                <p>No cash-in or cash-out movements recorded yet for this shift.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB CONTENT 4: SHIFT HISTORY */}
      {selectedTab === 'history' && (
        <div className="shifts-tab-content">
          <div className="shifts-section-card">
            <div className="card-header-clean">
              <h3 className="section-title">All Cashier Shifts History</h3>
              <div className="filter-pills-row">
                {['ALL', 'open', 'closed'].map((st) => (
                  <button
                    key={st}
                    type="button"
                    className={`filter-pill ${historyStatusFilter === st ? 'active' : ''}`}
                    onClick={() => setHistoryStatusFilter(st)}
                  >
                    {st.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {loadingHistory ? (
              <div className="report-loading-state">
                <span className="spinner">⏳</span>
                <span>Loading past cashier shifts...</span>
              </div>
            ) : shiftHistory.length > 0 ? (
              <table className="shifts-table">
                <thead>
                  <tr>
                    <th>Shift #</th>
                    <th>Status</th>
                    <th>Cashier</th>
                    <th>Location</th>
                    <th>Opened</th>
                    <th>Closed</th>
                    <th className="text-right">Expected</th>
                    <th className="text-right">Counted</th>
                    <th className="text-right">Variance</th>
                    <th>Manager Review</th>
                    <th className="text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {shiftHistory.map((s) => {
                    const variance = s.varianceMinor ?? 0;
                    const isBalanced = variance === 0;
                    const isShortage = variance < 0;
                    const isExcess = variance > 0;
                    return (
                      <tr key={s.id}>
                        <td><strong>{s.shiftNumber}</strong></td>
                        <td>
                          <span className={`status-pill ${s.status}`}>
                            {s.status.toUpperCase()}
                          </span>
                        </td>
                        <td>{s.userName || 'Cashier'}</td>
                        <td className="text-muted">{s.location || 'MAIN'}</td>
                        <td className="font-mono" style={{ fontSize: '0.8rem' }}>
                          {new Date(s.openedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}{' '}
                          {new Date(s.openedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="font-mono text-muted" style={{ fontSize: '0.8rem' }}>
                          {s.closedAt ? (
                            <>
                              {new Date(s.closedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}{' '}
                              {new Date(s.closedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                            </>
                          ) : (
                            'Active'
                          )}
                        </td>
                        <td className="text-right font-mono">{formatMoney(s.expectedCashMinor)}</td>
                        <td className="text-right font-mono">
                          {s.countedCashMinor !== undefined && s.countedCashMinor !== null
                            ? formatMoney(s.countedCashMinor)
                            : '—'}
                        </td>
                        <td className="text-right font-mono">
                          {s.status === 'closed' ? (
                            <span className={`variance-tag ${isBalanced ? 'balanced' : isShortage ? 'shortage' : 'excess'}`}>
                              {isBalanced ? 'BALANCED' : formatMoney(variance)}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td>
                          {s.reviewedBy ? (
                            <span className="reviewed-check" title={`Reviewed on ${s.reviewedAt}`}>
                              ✅ Reviewed
                            </span>
                          ) : s.status === 'closed' && variance !== 0 ? (
                            <span className="pending-review-tag" title="Shortage/Excess pending manager review">
                              ⚠️ Pending Review
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="text-center">
                          <button
                            type="button"
                            className="btn btn-outline btn-xs"
                            onClick={() => setReportModalShiftId(s.id)}
                            title="View full day-end report"
                          >
                            📄 Report
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="empty-subtab-state">
                <span>📜</span>
                <p>No shift records found for filter "{historyStatusFilter}".</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODALS */}
      <OpenShiftModal
        isOpen={isOpenShiftModalOpen}
        onClose={() => setIsOpenShiftModalOpen(false)}
        onSuccess={handleOpenSuccess}
        userName={user.name}
        userRole={user.role}
      />

      {activeShift && (
        <CashMovementModal
          isOpen={isCashMovementModalOpen}
          onClose={() => setIsCashMovementModalOpen(false)}
          onSuccess={handleMovementSuccess}
          activeShift={activeShift}
        />
      )}

      {activeShift && summary && (
        <CloseShiftModal
          isOpen={isCloseShiftModalOpen}
          onClose={() => setIsCloseShiftModalOpen(false)}
          onSuccess={handleCloseSuccess}
          activeShift={activeShift}
          summary={summary}
        />
      )}

      {reportModalShiftId && (
        <ShiftClosingReportModal
          isOpen={Boolean(reportModalShiftId)}
          onClose={() => setReportModalShiftId(null)}
          shiftId={reportModalShiftId}
          userRole={user.role}
          onShiftUpdated={loadHistory}
        />
      )}
    </div>
  );
};
