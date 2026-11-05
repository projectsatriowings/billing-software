import { createPortal } from 'react-dom';
import React, { useState } from 'react';
import { recordCashMovement, type CashMovement, type Shift, type ShiftSummary } from '../../api.ts';
import { formatMoney } from '../../../../shared/shifts.ts';
import {
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
  StoreIcon,
  ShieldCheckIcon,
  WalletIcon,
  ScaleIcon,
  CheckCircle2Icon,
  AlertTriangleIcon,
  ClockIcon,
  MapPinIcon,
  UserIcon,
} from '../inventory/InventoryIcons.tsx';

interface CashMovementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (movement: CashMovement, updatedSummary?: ShiftSummary) => void;
  activeShift: Shift;
}

export const CashMovementModal: React.FC<CashMovementModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  activeShift,
}) => {
  const [movementType, setMovementType] = useState<'cash_in' | 'cash_out'>('cash_in');
  const [amountRupees, setAmountRupees] = useState<string>('500');
  const [reasonCategory, setReasonCategory] = useState<string>('Change Addition from Safe');
  const [customReason, setCustomReason] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const cashInReasons = [
    'Change Addition from Safe',
    'Drawer Float Top-up',
    'Owner Cash Deposit',
    'Customer Returned Change',
    'Other Cash Inflow',
  ];

  const cashOutReasons = [
    'Petty Cash - Counter Receipt Roll & Stationery',
    'Owner Cash Draw',
    'Bank Cash Deposit',
    'Supplier Cash Advance',
    'Store Maintenance / Utility Cash',
    'Other Cash Outflow',
  ];

  const quickAmounts = [100, 200, 500, 1000, 2000, 5000];

  const handleTypeToggle = (type: 'cash_in' | 'cash_out') => {
    setMovementType(type);
    if (type === 'cash_in') {
      setReasonCategory(cashInReasons[0]);
    } else {
      setReasonCategory(cashOutReasons[0]);
    }
  };

  const parsedRupees = parseFloat(amountRupees.toString().replace(/,/g, '').trim()) || 0;
  const enteredMinor = Math.round(parsedRupees * 100);
  const currentDrawerMinor = activeShift.summary?.expectedCashMinor ?? (activeShift.openingCashMinor ?? 0);
  const projectedDrawerMinor = movementType === 'cash_in'
    ? currentDrawerMinor + enteredMinor
    : currentDrawerMinor - enteredMinor;
  const isOverdraw = movementType === 'cash_out' && enteredMinor > currentDrawerMinor;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanAmountStr = amountRupees.toString().replace(/,/g, '').trim();
    const rupees = parseFloat(cleanAmountStr);
    if (isNaN(rupees) || !isFinite(rupees) || rupees <= 0) {
      setError('Movement amount must be greater than zero.');
      return;
    }

    const effectiveReason = reasonCategory.includes('Other') && customReason.trim()
      ? customReason.trim()
      : reasonCategory;

    if (!effectiveReason || effectiveReason.trim().length < 2) {
      setError('Please provide an authorized reason for this cash movement.');
      return;
    }

    const amountMinor = Math.round(rupees * 100);
    if (!Number.isInteger(amountMinor) || amountMinor < 1) {
      setError('Movement amount is invalid.');
      return;
    }

    if (!activeShift?.id) {
      setError('No active shift found to record cash movement.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await recordCashMovement(activeShift.id, {
        movementType,
        amountMinor,
        reason: effectiveReason.trim(),
        notes: notes.trim() || undefined,
      });
      window.dispatchEvent(new CustomEvent('cash_movement_recorded', { detail: res }));
      window.dispatchEvent(new Event('shift_status_changed'));
      onSuccess(res.movement, res.summary);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to record cash movement.');
    } finally {
      setIsSubmitting(false);
    }
  };

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

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="shift-bento-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Top Accent Gradient Bar */}
        <div className={`modal-top-accent ${movementType === 'cash_in' ? 'green-accent' : 'amber-accent'}`}></div>

        {/* 1. Bento Modal Header */}
        <div className="shift-bento-header">
          <div className="shift-bento-header-left">
            <div className={`shift-bento-icon-badge ${movementType === 'cash_in' ? 'green' : 'amber'}`}>
              {movementType === 'cash_in' ? (
                <ArrowDownLeftIcon size={22} />
              ) : (
                <ArrowUpRightIcon size={22} />
              )}
            </div>
            <div className="shift-bento-title-wrap">
              <h3>
                <span>Record Cash Movement</span>
                <span className="shift-ref-pill">#{activeShift.shiftNumber || activeShift.id.slice(0, 8)}</span>
              </h3>
              <p>
                <StoreIcon size={12} />
                <span>{activeShift.location || 'Main Counter'}</span>
                <span>•</span>
                <UserIcon size={12} />
                <span>Cashier: <strong>{activeShift.userName || 'Current Cashier'}</strong></span>
                <span>•</span>
                <ClockIcon size={12} />
                <span>Opened {formatShiftOpenedAt(activeShift.openedAt)}</span>
              </p>
            </div>
          </div>

          <div className="shift-bento-header-actions">
            <span
              className={`cat-badge-live-sync ${movementType === 'cash_in' ? 'green' : 'amber'}`}
              style={{
                background: movementType === 'cash_in' ? '#ecfdf5' : '#fffbeb',
                color: movementType === 'cash_in' ? '#047857' : '#b45309',
                borderColor: movementType === 'cash_in' ? '#a7f3d0' : '#fde68a',
              }}
            >
              <span className="live-indicator-dot" style={{ background: movementType === 'cash_in' ? '#10b981' : '#f59e0b' }}></span>
              {movementType === 'cash_in' ? 'DRAWER CASH-IN' : 'DRAWER CASH-OUT'}
            </span>
            <button
              type="button"
              className="modal-close-btn"
              onClick={onClose}
              aria-label="Close modal without saving"
              title="Close without saving"
              disabled={isSubmitting}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>

        {/* Form Wrap */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div className="shift-bento-body">
            {/* Top 3-Tile Bento Ribbon */}
            <div className="shift-bento-ribbon cols-3">
              <div className="shift-bento-ribbon-tile">
                <div className="ribbon-tile-label">
                  <span>Current Drawer Cash</span>
                  <WalletIcon size={13} style={{ color: '#6366f1' }} />
                </div>
                <div className="ribbon-tile-val">{formatMoney(currentDrawerMinor)}</div>
                <div className="ribbon-tile-sub">Live recorded balance</div>
              </div>

              <div className="shift-bento-ribbon-tile">
                <div className="ribbon-tile-label">
                  <span>{movementType === 'cash_in' ? '+ Cash-In Amount' : '- Cash-Out Amount'}</span>
                  {movementType === 'cash_in' ? (
                    <ArrowDownLeftIcon size={13} style={{ color: '#10b981' }} />
                  ) : (
                    <ArrowUpRightIcon size={13} style={{ color: '#f59e0b' }} />
                  )}
                </div>
                <div
                  className="ribbon-tile-val"
                  style={{ color: movementType === 'cash_in' ? '#059669' : '#d97706' }}
                >
                  {movementType === 'cash_in' ? '+' : '-'}{formatMoney(enteredMinor)}
                </div>
                <div className="ribbon-tile-sub">Entered transaction delta</div>
              </div>

              <div className="shift-bento-ribbon-tile highlight">
                <div className="ribbon-tile-label">
                  <span>Projected Drawer Balance</span>
                  <ScaleIcon size={13} style={{ color: '#4f46e5' }} />
                </div>
                <div
                  className="ribbon-tile-val"
                  style={{ color: isOverdraw ? '#dc2626' : '#4338ca' }}
                >
                  {formatMoney(projectedDrawerMinor)}
                </div>
                <div className="ribbon-tile-sub">
                  {isOverdraw ? (
                    <span style={{ color: '#dc2626', fontWeight: 700 }}>Notice: Results in negative drawer cash</span>
                  ) : (
                    'Expected cash after this operation'
                  )}
                </div>
              </div>
            </div>

            {error && (
              <div className="shift-modal-alert error">
                <AlertTriangleIcon size={18} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            {/* Dual Column Bento Grid */}
            <div className="shift-bento-main-grid">
              {/* Left Column: Form Controls */}
              <div className="shift-bento-panel">
                <div className="shift-bento-panel-header">
                  <div className="panel-header-title-box">
                    <WalletIcon size={16} style={{ color: '#6366f1' }} />
                    <h4 className="panel-header-title">Movement Specification</h4>
                  </div>
                  <span className="bento-pill-badge info" style={{ fontSize: '0.68rem', padding: '0.15rem 0.5rem' }}>
                    Paise Accurate
                  </span>
                </div>

                {/* Movement Type Toggle */}
                <div className="movement-toggle-row">
                  <button
                    type="button"
                    className={`movement-toggle-btn in ${movementType === 'cash_in' ? 'active' : ''}`}
                    onClick={() => handleTypeToggle('cash_in')}
                  >
                    <ArrowDownLeftIcon size={16} />
                    <span>Cash-In (Deposit into Drawer)</span>
                  </button>
                  <button
                    type="button"
                    className={`movement-toggle-btn out ${movementType === 'cash_out' ? 'active' : ''}`}
                    onClick={() => handleTypeToggle('cash_out')}
                  >
                    <ArrowUpRightIcon size={16} />
                    <span>Cash-Out (Drawer Payout)</span>
                  </button>
                </div>

                {/* Amount input */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">
                    <span>Amount (₹)</span>
                    <span className="req">*</span>
                  </label>
                  <div className="rupee-input-wrapper">
                    <div className="rupee-badge-prefix">₹</div>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      className="form-input rupee-input"
                      placeholder="0.00"
                      value={amountRupees}
                      onChange={(e) => setAmountRupees(e.target.value)}
                      autoFocus
                      required
                    />
                  </div>
                  <div className="quick-amount-pills">
                    {quickAmounts.map((amt) => {
                      const isSelected = parseFloat(amountRupees.toString().replace(/,/g, '')) === amt;
                      return (
                        <button
                          key={amt}
                          type="button"
                          className={`quick-pill ${isSelected ? 'active' : ''}`}
                          onClick={() => setAmountRupees(amt.toString())}
                        >
                          <span className="quick-pill-currency">₹</span>
                          <span className="quick-pill-val">{amt.toLocaleString('en-IN')}</span>
                          {isSelected && (
                            <span className="quick-pill-check">
                              <CheckCircle2Icon size={12} />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Reason Select */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">
                    <span>Reason / Category</span>
                    <span className="req">*</span>
                  </label>
                  <div className="select-input-wrapper">
                    <select
                      className="form-input form-select"
                      value={reasonCategory}
                      onChange={(e) => setReasonCategory(e.target.value)}
                    >
                      {(movementType === 'cash_in' ? cashInReasons : cashOutReasons).map((r) => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {reasonCategory.includes('Other') && (
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">
                      <span>Specify Custom Reason</span>
                      <span className="req">*</span>
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="Enter specific audit reason..."
                      value={customReason}
                      onChange={(e) => setCustomReason(e.target.value)}
                      required
                    />
                  </div>
                )}

                {/* Notes */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Audit Notes & Reference (Optional)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g., Safe drop receipt #, Voucher id, Bag tag"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    maxLength={250}
                  />
                </div>
              </div>

              {/* Right Column: Live Calculation & Drawer Impact Bento Card */}
              <div className="shift-bento-panel">
                <div className="shift-bento-panel-header">
                  <div className="panel-header-title-box">
                    <ScaleIcon size={16} style={{ color: '#10b981' }} />
                    <h4 className="panel-header-title">Live Drawer Impact Calculation</h4>
                  </div>
                  <span className="bento-pill-badge primary" style={{ fontSize: '0.68rem', padding: '0.15rem 0.5rem' }}>
                    Real-time
                  </span>
                </div>

                {/* Calculation Breakdown Box */}
                <div className="live-calc-box">
                  <div className="live-calc-row">
                    <span>Current Expected Drawer Cash</span>
                    <strong>{formatMoney(currentDrawerMinor)}</strong>
                  </div>
                  <div className="live-calc-row">
                    <span>{movementType === 'cash_in' ? '+ Cash-In Addition' : '- Cash-Out Payout'}</span>
                    <strong style={{ color: movementType === 'cash_in' ? '#059669' : '#d97706' }}>
                      {movementType === 'cash_in' ? '+' : '-'}{formatMoney(enteredMinor)}
                    </strong>
                  </div>
                  <div className="live-calc-divider"></div>
                  <div className={`live-calc-result-box ${isOverdraw ? 'amber' : ''}`}>
                    <div>
                      <div className="calc-result-title">Projected Balance</div>
                      <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Post-operation drawer cash</div>
                    </div>
                    <div className={`calc-result-amount ${isOverdraw ? 'text-amber' : ''}`}>
                      {formatMoney(projectedDrawerMinor)}
                    </div>
                  </div>
                </div>

                {/* Active Shift Context */}
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.75rem 0.9rem', display: 'flex', flexDirection: 'column', gap: '0.45rem', fontSize: '0.78rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                    <span>Active Cashier Shift:</span>
                    <strong style={{ color: '#0f172a' }}>#{activeShift.shiftNumber}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                    <span>Assigned Register:</span>
                    <strong style={{ color: '#0f172a' }}>{activeShift.counter || 'COUNTER-1'} ({activeShift.location || 'MAIN'})</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                    <span>Cashier Identity:</span>
                    <strong style={{ color: '#0f172a' }}>{activeShift.userName || 'Demo Cashier'}</strong>
                  </div>
                </div>

                {/* Policy Notice Box */}
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '0.75rem 0.9rem', display: 'flex', gap: '0.65rem', alignItems: 'flex-start' }}>
                  <ShieldCheckIcon size={18} style={{ color: '#059669', flexShrink: 0, marginTop: '2px' }} />
                  <div style={{ fontSize: '0.74rem', color: '#166534', lineHeight: 1.45 }}>
                    <strong>Audit Trail Guarantee:</strong> Every cash-in and cash-out is permanently stamped with the shift ID, operator account, and timestamp. Unpaid invoices and digital transactions remain isolated.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Bento Modal Footer */}
          <div className="shift-bento-footer">
            <div className="shift-bento-footer-left">
              <ShieldCheckIcon size={15} style={{ color: '#059669' }} />
              <span>Paise-exact ledger calculation with full cashier audit attribution</span>
            </div>

            <div className="shift-bento-footer-actions">
              <button
                type="button"
                className="cat-btn-outline"
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancel
              </button>

              <button
                type="submit"
                id="btn-save-cash-movement"
                className={movementType === 'cash_in' ? 'cat-btn-primary' : 'cat-btn-danger'}
                disabled={isSubmitting || (movementType === 'cash_out' && enteredMinor <= 0)}
              >
                {isSubmitting ? (
                  <span>Recording Movement...</span>
                ) : movementType === 'cash_in' ? (
                  <>
                    <ArrowDownLeftIcon size={15} />
                    <span>Record Cash-In (+{formatMoney(enteredMinor)})</span>
                  </>
                ) : (
                  <>
                    <ArrowUpRightIcon size={15} />
                    <span>Record Cash-Out (-{formatMoney(enteredMinor)})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
