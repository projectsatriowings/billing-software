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
import { AnimatedCounter } from '../common/AnimatedCounter.tsx';
import {
  RupeeIcon,
  BanknoteIcon,
  CreditCardIcon,
  RefreshCwIcon,
  TrendingUpIcon,
  WalletIcon,
  ScaleIcon,
  ClockIcon,
  RotateCcwIcon,
  CheckCircle2Icon,
  AlertTriangleIcon,
  FileTextIcon,
  LockIcon,
  ShoppingCartIcon,
  StoreIcon,
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  PlusIcon,
  UserIcon,
  MapPinIcon,
  ChevronRightIcon,
  ShieldCheckIcon,
} from '../inventory/InventoryIcons.tsx';

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

  // Safe format shift opened timestamp (contextual date + time)
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
      {/* 3D BENTO HERO CARD */}
      <div className="shifts-bento-hero bento-card-3d">
        <div className="shifts-hero-left">
          <div className="hero-status-pill-wrap">
            {activeShift ? (
              <span className="shift-bento-active-badge">
                <span className="pulse-green-dot"></span>
                ACTIVE CASHIER SHIFT
              </span>
            ) : (
              <span className="shift-bento-closed-badge">
                <span className="gray-dot"></span>
                NO ACTIVE SHIFT OPEN
              </span>
            )}
            <span className="bento-location-chip">
              <MapPinIcon size={13} />
              <span>{activeShift?.location || 'Main Counter'}</span>
            </span>
            {activeShift?.counter && (
              <span className="bento-counter-chip">
                <StoreIcon size={13} />
                <span>{activeShift.counter}</span>
              </span>
            )}
          </div>

          <h2 className="shifts-bento-title">
            {activeShift ? (
              <>
                Shift <span className="shift-num-highlight">#{activeShift.shiftNumber}</span>
                <span className="title-sep">•</span>
                <span className="title-cashier-group">
                  <UserIcon size={18} className="cashier-user-icon" />
                  <span>{activeShift.userName || user.name}</span>
                </span>
              </>
            ) : (
              'Drawer Register Ready for New Shift'
            )}
          </h2>

          <p className="shifts-bento-subtitle">
            {activeShift ? (
              <>
                Opened {formatShiftOpenedAt(activeShift.openedAt)}
                {getDurationString(activeShift.openedAt) && (
                  <> • Running for <strong>{getDurationString(activeShift.openedAt)}</strong></>
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
                className="bento-hero-btn primary"
                onClick={() => setIsCashMovementModalOpen(true)}
              >
                <ArrowDownLeftIcon size={16} />
                <span>Cash In / Out</span>
              </button>
              <button
                type="button"
                className="bento-hero-btn danger"
                onClick={() => setIsCloseShiftModalOpen(true)}
              >
                <LockIcon size={16} />
                <span>Close Shift</span>
              </button>
              <button
                type="button"
                className="bento-hero-btn secondary"
                onClick={() => setReportModalShiftId(activeShift.id)}
              >
                <FileTextIcon size={16} />
                <span>Live Summary</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              className="bento-hero-btn success large"
              onClick={() => setIsOpenShiftModalOpen(true)}
            >
              <PlusIcon size={18} />
              <span>Open New Cashier Shift</span>
            </button>
          )}
        </div>
      </div>

      {/* 5 REAL-TIME BENTO KPI METRIC CARDS WITH COUNTING ANIMATION */}
      {activeShift && summary && (
        <div className="shifts-bento-kpi-grid">
          {/* Card 1: Expected Drawer Cash */}
          <div className="shifts-bento-kpi-tile bento-card-3d kpi-tile-expected">
            <div className="kpi-tile-header">
              <div className="kpi-tile-icon-box emerald">
                <WalletIcon size={18} />
              </div>
              <span className="kpi-tile-label">EXPECTED IN DRAWER</span>
              <span className="bento-kpi-badge emerald">Live Balance</span>
            </div>
            <div className="kpi-tile-value font-mono text-emerald-600">
              <AnimatedCounter
                value={summary.expectedCashMinor / 100}
                formatter={(v) => '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              />
            </div>
            <div className="kpi-tile-footer">
              <span>Float ({formatMoney(summary.openingCashMinor)}) + Net Cash ({formatMoney(summary.expectedCashMinor - summary.openingCashMinor)})</span>
            </div>
          </div>

          {/* Card 2: Cash Sales Collected */}
          <div className="shifts-bento-kpi-tile bento-card-3d kpi-tile-cash-sales">
            <div className="kpi-tile-header">
              <div className="kpi-tile-icon-box green">
                <BanknoteIcon size={18} />
              </div>
              <span className="kpi-tile-label">CASH SALES</span>
              <span className="bento-kpi-badge green">Cash In</span>
            </div>
            <div className="kpi-tile-value font-mono text-emerald-600">
              <AnimatedCounter
                value={summary.cashSalesMinor / 100}
                formatter={(v) => '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              />
            </div>
            <div className="kpi-tile-footer">
              <span>Received into drawer from POS checkout</span>
            </div>
          </div>

          {/* Card 3: Non-Cash Collections */}
          <div className="shifts-bento-kpi-tile bento-card-3d kpi-tile-noncash">
            <div className="kpi-tile-header">
              <div className="kpi-tile-icon-box blue">
                <CreditCardIcon size={18} />
              </div>
              <span className="kpi-tile-label">NON-CASH (UPI / CARD)</span>
              <span className="bento-kpi-badge blue">Bank Direct</span>
            </div>
            <div className="kpi-tile-value font-mono text-blue-600">
              <AnimatedCounter
                value={summary.nonCashPaymentsMinor / 100}
                formatter={(v) => '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              />
            </div>
            <div className="kpi-tile-footer">
              <span>Direct bank credit (excluded from drawer)</span>
            </div>
          </div>

          {/* Card 4: Net Cash Movements */}
          <div className="shifts-bento-kpi-tile bento-card-3d kpi-tile-movements">
            <div className="kpi-tile-header">
              <div className="kpi-tile-icon-box amber">
                <RefreshCwIcon size={18} />
              </div>
              <span className="kpi-tile-label">NET CASH IN / OUT</span>
              <span className="bento-kpi-badge amber">
                {summary.cashInMinor >= summary.cashOutMinor ? '+Net In' : '-Net Out'}
              </span>
            </div>
            <div className="kpi-tile-value font-mono text-amber-600">
              <AnimatedCounter
                value={(summary.cashInMinor - summary.cashOutMinor) / 100}
                formatter={(v) => (v < 0 ? '-' : '') + '₹' + Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              />
            </div>
            <div className="kpi-tile-footer">
              <span>+{formatMoney(summary.cashInMinor)} In • -{formatMoney(summary.cashOutMinor)} Out</span>
            </div>
          </div>

          {/* Card 5: Total Shift Turnover */}
          <div className="shifts-bento-kpi-tile bento-card-3d kpi-tile-turnover">
            <div className="kpi-tile-header">
              <div className="kpi-tile-icon-box purple">
                <TrendingUpIcon size={18} />
              </div>
              <span className="kpi-tile-label">TOTAL COLLECTIONS</span>
              <span className="bento-kpi-badge purple">Gross Shift</span>
            </div>
            <div className="kpi-tile-value font-mono text-purple-600">
              <AnimatedCounter
                value={summary.totalCollectedMinor / 100}
                formatter={(v) => '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              />
            </div>
            <div className="kpi-tile-footer">
              <span>Cash ({formatMoney(summary.cashSalesMinor)}) + Digital ({formatMoney(summary.nonCashPaymentsMinor)})</span>
            </div>
          </div>
        </div>
      )}

      {/* BENTO SEGMENTED NAVIGATION TABS */}
      <div className="shifts-bento-nav-tabs">
        <button
          type="button"
          className={`bento-nav-tab ${selectedTab === 'overview' ? 'active' : ''}`}
          onClick={() => setSelectedTab('overview')}
        >
          <ScaleIcon size={16} />
          <span>Drawer Reconciliation</span>
        </button>
        <button
          type="button"
          className={`bento-nav-tab ${selectedTab === 'payments' ? 'active' : ''}`}
          onClick={() => setSelectedTab('payments')}
        >
          <CreditCardIcon size={16} />
          <span>Payment Breakdown</span>
        </button>
        <button
          type="button"
          className={`bento-nav-tab ${selectedTab === 'movements' ? 'active' : ''}`}
          onClick={() => setSelectedTab('movements')}
        >
          <ArrowDownLeftIcon size={16} />
          <span>Cash Movements</span>
          <span className="bento-tab-counter">{movements.length}</span>
        </button>
        <button
          type="button"
          className={`bento-nav-tab ${selectedTab === 'history' ? 'active' : ''}`}
          onClick={() => setSelectedTab('history')}
        >
          <ClockIcon size={16} />
          <span>Past Shifts</span>
          <span className="bento-tab-counter">{shiftHistory.length}</span>
        </button>
      </div>

      {/* TAB CONTENT 1: OVERVIEW & DRAWER FORMULA */}
      {selectedTab === 'overview' && (
        <div className="shifts-tab-content">
          {activeShift && summary ? (
            <div className="shifts-overview-layout">
              {/* Formula Demonstration Bento Card */}
              <div className="shifts-bento-card bento-card-3d formula-container-card">
                <div className="bento-card-header">
                  <div className="bento-card-title-group">
                    <div className="bento-card-icon-pill indigo">
                      <ScaleIcon size={18} />
                    </div>
                    <div>
                      <h3 className="bento-card-title">Authoritative Expected Cash Formula</h3>
                      <p className="bento-card-desc">Exact arithmetic model governing drawer cash reconciliation</p>
                    </div>
                  </div>
                  <span className="bento-pill-badge info">Strict Integer Paise Math</span>
                </div>

                <div className="formula-detailed-flow">
                  {/* Step 1 */}
                  <div className="formula-step-box">
                    <div className="step-box-header">
                      <span className="step-box-badge">01</span>
                      <BanknoteIcon size={15} className="step-box-icon" />
                    </div>
                    <span className="step-box-title">Opening Float</span>
                    <span className="step-box-desc">Physical cash in drawer at shift start</span>
                    <span className="step-box-amount font-mono">{formatMoney(summary.openingCashMinor)}</span>
                  </div>

                  <div className="formula-op-pill">+</div>

                  {/* Step 2 */}
                  <div className="formula-step-box">
                    <div className="step-box-header">
                      <span className="step-box-badge">02</span>
                      <PlusIcon size={15} className="step-box-icon text-emerald-600" />
                    </div>
                    <span className="step-box-title">Cash Sales</span>
                    <span className="step-box-desc">Cash payments received in POS</span>
                    <span className="step-box-amount font-mono text-emerald-600">+{formatMoney(summary.cashSalesMinor)}</span>
                  </div>

                  <div className="formula-op-pill">+</div>

                  {/* Step 3 */}
                  <div className="formula-step-box">
                    <div className="step-box-header">
                      <span className="step-box-badge">03</span>
                      <ArrowDownLeftIcon size={15} className="step-box-icon text-emerald-600" />
                    </div>
                    <span className="step-box-title">Cash-In</span>
                    <span className="step-box-desc">Safe transfers or float top-ups</span>
                    <span className="step-box-amount font-mono text-emerald-600">+{formatMoney(summary.cashInMinor)}</span>
                  </div>

                  <div className="formula-op-pill">-</div>

                  {/* Step 4 */}
                  <div className="formula-step-box">
                    <div className="step-box-header">
                      <span className="step-box-badge">04</span>
                      <ArrowUpRightIcon size={15} className="step-box-icon text-amber-600" />
                    </div>
                    <span className="step-box-title">Cash-Out</span>
                    <span className="step-box-desc">Petty cash, owner draws or safe drops</span>
                    <span className="step-box-amount font-mono text-amber-600">-{formatMoney(summary.cashOutMinor)}</span>
                  </div>

                  <div className="formula-op-pill">-</div>

                  {/* Step 5 */}
                  <div className="formula-step-box">
                    <div className="step-box-header">
                      <span className="step-box-badge">05</span>
                      <RotateCcwIcon size={15} className="step-box-icon text-rose-600" />
                    </div>
                    <span className="step-box-title">Cash Refunds</span>
                    <span className="step-box-desc">Refunds paid from drawer cash</span>
                    <span className="step-box-amount font-mono text-rose-600">-{formatMoney(summary.cashRefundsMinor)}</span>
                  </div>

                  <div className="formula-op-pill">=</div>

                  {/* Step Result */}
                  <div className="formula-step-box result">
                    <div className="step-box-header">
                      <span className="step-box-badge result">
                        <CheckCircle2Icon size={13} />
                      </span>
                      <WalletIcon size={15} className="step-box-icon text-indigo-600" />
                    </div>
                    <span className="step-box-title font-bold text-indigo-900">EXPECTED DRAWER CASH</span>
                    <span className="step-box-desc">Exact expected cash to count at close</span>
                    <span className="step-box-amount font-mono font-bold text-indigo-600">
                      {formatMoney(summary.expectedCashMinor)}
                    </span>
                  </div>
                </div>

                {/* Financial Safety Guarantee Bento Alert */}
                <div className="bento-safety-guarantee">
                  <div className="safety-guarantee-icon">
                    <ShieldCheckIcon size={20} />
                  </div>
                  <div className="safety-guarantee-content">
                    <strong>Financial Safety Guarantee:</strong> Unpaid credit sales ({formatMoney(summary.creditSalesUnpaidMinor)}) and digital payments ({formatMoney(summary.nonCashPaymentsMinor)}) are strictly isolated and do not artificially inflate the physical cash drawer.
                  </div>
                </div>
              </div>

              {/* Shift Actions Bento Card */}
              <div className="shifts-bento-card bento-card-3d side-actions-bento-card">
                <div className="bento-card-header">
                  <div className="bento-card-title-group">
                    <div className="bento-card-icon-pill emerald">
                      <PlusIcon size={18} />
                    </div>
                    <div>
                      <h3 className="bento-card-title">Shift Actions</h3>
                      <p className="bento-card-desc">Direct drawer operations</p>
                    </div>
                  </div>
                </div>

                <div className="bento-actions-stack">
                  <button
                    type="button"
                    className="bento-action-card emerald"
                    onClick={() => setIsCashMovementModalOpen(true)}
                  >
                    <div className="action-card-icon-box emerald">
                      <ArrowDownLeftIcon size={18} />
                    </div>
                    <div className="action-card-text">
                      <strong>Add Cash-In</strong>
                      <p>Deposit float or change from safe</p>
                    </div>
                    <ChevronRightIcon size={16} className="action-card-arrow" />
                  </button>

                  <button
                    type="button"
                    className="bento-action-card amber"
                    onClick={() => setIsCashMovementModalOpen(true)}
                  >
                    <div className="action-card-icon-box amber">
                      <ArrowUpRightIcon size={18} />
                    </div>
                    <div className="action-card-text">
                      <strong>Record Cash-Out</strong>
                      <p>Withdraw petty cash or owner draw</p>
                    </div>
                    <ChevronRightIcon size={16} className="action-card-arrow" />
                  </button>

                  <button
                    type="button"
                    className="bento-action-card indigo"
                    onClick={onNavigateToPos}
                  >
                    <div className="action-card-icon-box indigo">
                      <ShoppingCartIcon size={18} />
                    </div>
                    <div className="action-card-text">
                      <strong>Open POS Counter</strong>
                      <p>Record sales under this active shift</p>
                    </div>
                    <ChevronRightIcon size={16} className="action-card-arrow" />
                  </button>

                  <button
                    type="button"
                    className="bento-action-card rose"
                    onClick={() => setIsCloseShiftModalOpen(true)}
                  >
                    <div className="action-card-icon-box rose">
                      <LockIcon size={18} />
                    </div>
                    <div className="action-card-text">
                      <strong>Close Shift & Reconcile</strong>
                      <p>Count cash, compute variance & close</p>
                    </div>
                    <ChevronRightIcon size={16} className="action-card-arrow" />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bento-empty-shift-card bento-card-3d">
              <div className="bento-empty-icon-ring">
                <StoreIcon size={44} />
              </div>
              <h3 className="bento-empty-title">No Active Shift Open</h3>
              <p className="bento-empty-desc">
                You currently do not have an open shift. Click below to start your shift with an opening cash float to begin recording POS sales and drawer cash movements.
              </p>
              <button
                type="button"
                className="bento-hero-btn success large"
                onClick={() => setIsOpenShiftModalOpen(true)}
              >
                <PlusIcon size={18} />
                <span>Open Cashier Shift Now</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* TAB CONTENT 2: PAYMENT METHOD BREAKDOWN */}
      {selectedTab === 'payments' && (
        <div className="shifts-tab-content">
          <div className="shifts-bento-card bento-card-3d">
            <div className="bento-card-header">
              <div className="bento-card-title-group">
                <div className="bento-card-icon-pill blue">
                  <CreditCardIcon size={18} />
                </div>
                <div>
                  <h3 className="bento-card-title">Collections by Payment Method</h3>
                  <p className="bento-card-desc">Active shift transaction settlement breakdown</p>
                </div>
              </div>
              <span className="bento-pill-badge primary">Active Shift Receipts</span>
            </div>

            {summary && summary.paymentMethods.length > 0 ? (
              <div className="bento-table-wrapper">
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
              </div>
            ) : (
              <div className="bento-empty-state">
                <CreditCardIcon size={40} className="bento-empty-svg" />
                <p>No payments recorded yet for this active shift.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB CONTENT 3: CASH MOVEMENTS */}
      {selectedTab === 'movements' && (
        <div className="shifts-tab-content">
          <div className="shifts-bento-card bento-card-3d">
            <div className="bento-card-header">
              <div className="bento-card-title-group">
                <div className="bento-card-icon-pill amber">
                  <ArrowDownLeftIcon size={18} />
                </div>
                <div>
                  <h3 className="bento-card-title">Cash Movements Ledger</h3>
                  <p className="bento-card-desc">Detailed audit trail of drawer cash inflows and outflows</p>
                </div>
              </div>
              <button
                type="button"
                className="bento-btn-primary sm"
                onClick={() => setIsCashMovementModalOpen(true)}
                disabled={!activeShift}
              >
                <PlusIcon size={14} />
                <span>Record Movement</span>
              </button>
            </div>

            {movements.length > 0 ? (
              <div className="bento-table-wrapper">
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
                            {cm.movementType === 'cash_in' ? (
                              <>
                                <ArrowDownLeftIcon size={12} />
                                <span>CASH-IN</span>
                              </>
                            ) : (
                              <>
                                <ArrowUpRightIcon size={12} />
                                <span>CASH-OUT</span>
                              </>
                            )}
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
              </div>
            ) : (
              <div className="bento-empty-state">
                <FileTextIcon size={40} className="bento-empty-svg" />
                <p>No cash-in or cash-out movements recorded yet for this shift.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB CONTENT 4: SHIFT HISTORY */}
      {selectedTab === 'history' && (
        <div className="shifts-tab-content">
          <div className="shifts-bento-card bento-card-3d">
            <div className="bento-card-header">
              <div className="bento-card-title-group">
                <div className="bento-card-icon-pill purple">
                  <ClockIcon size={18} />
                </div>
                <div>
                  <h3 className="bento-card-title">All Cashier Shifts History</h3>
                  <p className="bento-card-desc">Historical registry of opened, reconciled, and audited shifts</p>
                </div>
              </div>
              <div className="bento-filter-pills-row">
                {['ALL', 'open', 'closed'].map((st) => (
                  <button
                    key={st}
                    type="button"
                    className={`bento-filter-pill ${historyStatusFilter === st ? 'active' : ''}`}
                    onClick={() => setHistoryStatusFilter(st)}
                  >
                    {st.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {loadingHistory ? (
              <div className="report-loading-state">
                <RefreshCwIcon size={20} className="spinning-icon" />
                <span>Loading past cashier shifts...</span>
              </div>
            ) : shiftHistory.length > 0 ? (
              <div className="bento-table-wrapper">
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
                          <td><strong>#{s.shiftNumber}</strong></td>
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
                              <span className="text-success font-semibold">Active</span>
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
                              <span className="bento-reviewed-badge" title={`Reviewed on ${s.reviewedAt}`}>
                                <CheckCircle2Icon size={13} />
                                <span>Reviewed</span>
                              </span>
                            ) : s.status === 'closed' && variance !== 0 ? (
                              <span className="bento-pending-badge" title="Shortage/Excess pending manager review">
                                <AlertTriangleIcon size={13} />
                                <span>Pending Review</span>
                              </span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          <td className="text-center">
                            <button
                              type="button"
                              className="bento-table-action-btn"
                              onClick={() => setReportModalShiftId(s.id)}
                              title="View full day-end report"
                            >
                              <FileTextIcon size={13} />
                              <span>Report</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="bento-empty-state">
                <ClockIcon size={40} className="bento-empty-svg" />
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
