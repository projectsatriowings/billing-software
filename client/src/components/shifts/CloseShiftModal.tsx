import { createPortal } from 'react-dom';
import React, { useState, useEffect } from 'react';
import { closeShift, fetchActiveShift, fetchShiftDetails, type Shift, type ShiftSummary } from '../../api.ts';
import { formatMoney } from '../../../../shared/shifts.ts';
import {
  LockIcon,
  ShieldCheckIcon,
  WalletIcon,
  BanknoteIcon,
  TrendingUpIcon,
  CreditCardIcon,
  RefreshCwIcon,
  ScaleIcon,
  CheckCircle2Icon,
  AlertTriangleIcon,
  ClockIcon,
  UserIcon,
} from '../inventory/InventoryIcons.tsx';

interface CloseShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (closedShift: Shift) => void;
  activeShift: Shift;
  summary: ShiftSummary;
}

export const CloseShiftModal: React.FC<CloseShiftModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  activeShift,
  summary,
}) => {
  const [countedRupees, setCountedRupees] = useState<string>(() => {
    return (summary.expectedCashMinor / 100).toFixed(2);
  });
  const [closingNotes, setClosingNotes] = useState<string>('');
  const [varianceReason, setVarianceReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [userHasEditedCount, setUserHasEditedCount] = useState<boolean>(false);

  // Live updated summary
  const [liveSummary, setLiveSummary] = useState<ShiftSummary>(summary);
  const [loadingLive, setLoadingLive] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    const refreshLive = async () => {
      setLoadingLive(true);
      try {
        const details = await fetchShiftDetails(activeShift.id);
        if (isMounted && details?.shift?.summary) {
          setLiveSummary(details.shift.summary);
          if (!userHasEditedCount) {
            setCountedRupees((details.shift.summary.expectedCashMinor / 100).toFixed(2));
          }
        }
      } catch (err) {
        console.warn('Could not refresh live shift summary:', err);
      } finally {
        if (isMounted) setLoadingLive(false);
      }
    };

    refreshLive();
    return () => {
      isMounted = false;
    };
  }, [isOpen, activeShift.id]);

  if (!isOpen) return null;

  const activeSummary = liveSummary || summary;
  const expectedMinor = activeSummary.expectedCashMinor;

  const parsedRupees = parseFloat(countedRupees);
  const countedMinor = isNaN(parsedRupees) ? 0 : Math.round(parsedRupees * 100);
  const varianceMinor = countedMinor - expectedMinor;

  const isBalanced = varianceMinor === 0;
  const isShortage = varianceMinor < 0;
  const isExcess = varianceMinor > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = parseFloat(countedRupees);
    if (isNaN(parsed) || parsed < 0) {
      setError('Please enter a valid physical cash count (non-negative number).');
      return;
    }

    if (!isBalanced && (!varianceReason || varianceReason.trim().length < 3)) {
      setError('A variance reason (minimum 3 characters) is strictly required when counted cash differs from expected cash.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await closeShift(activeShift.id, {
        countedCashMinor: countedMinor,
        varianceReason: !isBalanced ? varianceReason.trim() : undefined,
        note: closingNotes.trim() || undefined,
      });

      window.dispatchEvent(new CustomEvent('shift_status_changed', { detail: res }));
      onSuccess(res.shift);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to close shift. Please try again.');
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
      <div className="shift-bento-dialog wide-1040" onClick={(e) => e.stopPropagation()}>
        {/* Top Accent Gradient Bar */}
        <div className="modal-top-accent red-accent"></div>

        {/* 1. Bento Header */}
        <div className="shift-bento-header">
          <div className="shift-bento-header-left">
            <div className="shift-bento-icon-badge rose">
              <LockIcon size={22} />
            </div>
            <div className="shift-bento-title-wrap">
              <h3>
                <span>Close Shift & Day-End Reconcile</span>
                <span className="shift-ref-pill">#{activeShift.shiftNumber || activeShift.id.slice(0, 8)}</span>
              </h3>
              <p>
                <UserIcon size={12} />
                <span>Cashier: <strong>{activeShift.userName || 'Current Cashier'}</strong></span>
                <span>•</span>
                <ClockIcon size={12} />
                <span>Opened {formatShiftOpenedAt(activeShift.openedAt)}</span>
                <span>•</span>
                <ScaleIcon size={12} />
                <span>Reconciliation Session</span>
              </p>
            </div>
          </div>

          <div className="shift-bento-header-actions">
            <span
              className="cat-badge-live-sync"
              style={{ background: '#fff1f2', color: '#e11d48', borderColor: '#fecdd3' }}
            >
              <span className="live-indicator-dot" style={{ background: '#e11d48' }}></span>
              CLOSING & RECONCILIATION
            </span>
            <button
              type="button"
              className="modal-close-btn"
              onClick={onClose}
              aria-label="Close modal"
              title="Close"
              disabled={isSubmitting}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div className="shift-bento-body">
            {/* Top 4-Tile Bento Ribbon */}
            <div className="shift-bento-ribbon">
              <div className="shift-bento-ribbon-tile">
                <div className="ribbon-tile-label">
                  <span>Opening Float</span>
                  <WalletIcon size={13} style={{ color: '#6366f1' }} />
                </div>
                <div className="ribbon-tile-val">{formatMoney(activeSummary.openingCashMinor)}</div>
                <div className="ribbon-tile-sub">Shift starting cash</div>
              </div>

              <div className="shift-bento-ribbon-tile">
                <div className="ribbon-tile-label">
                  <span>Cash Sales</span>
                  <BanknoteIcon size={13} style={{ color: '#10b981' }} />
                </div>
                <div className="ribbon-tile-val text-success" style={{ color: '#059669' }}>
                  +{formatMoney(activeSummary.cashSalesMinor)}
                </div>
                <div className="ribbon-tile-sub">Direct POS checkout cash</div>
              </div>

              <div className="shift-bento-ribbon-tile">
                <div className="ribbon-tile-label">
                  <span>Net Movements</span>
                  <RefreshCwIcon size={13} style={{ color: '#f59e0b' }} />
                </div>
                <div className="ribbon-tile-val" style={{ color: '#b45309' }}>
                  {formatMoney(activeSummary.cashInMinor - activeSummary.cashOutMinor)}
                </div>
                <div className="ribbon-tile-sub">
                  +{formatMoney(activeSummary.cashInMinor)} In • -{formatMoney(activeSummary.cashOutMinor)} Out
                </div>
              </div>

              <div className="shift-bento-ribbon-tile highlight">
                <div className="ribbon-tile-label">
                  <span>Authoritative Expected</span>
                  <ScaleIcon size={13} style={{ color: '#4f46e5' }} />
                </div>
                <div className="ribbon-tile-val" style={{ color: '#4338ca' }}>
                  {formatMoney(expectedMinor)}
                </div>
                <div className="ribbon-tile-sub">
                  {loadingLive ? 'Refreshing live...' : 'Exact formula ledger balance'}
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
              {/* Left Column: Physical Count Entry */}
              <div className="shift-bento-panel">
                <div className="shift-bento-panel-header">
                  <div className="panel-header-title-box">
                    <BanknoteIcon size={16} style={{ color: '#e11d48' }} />
                    <h4 className="panel-header-title">Physical Drawer Count</h4>
                  </div>
                  <span className="bento-pill-badge info" style={{ fontSize: '0.68rem', padding: '0.15rem 0.5rem' }}>
                    Cash Count
                  </span>
                </div>

                {/* Counted Cash Input */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">
                    <span>Actual Physical Cash Counted (₹)</span>
                    <span className="req">*</span>
                  </label>
                  <div className="rupee-input-wrapper large">
                    <div className="rupee-badge-prefix">₹</div>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className="form-input rupee-input large"
                      placeholder="0.00"
                      value={countedRupees}
                      onChange={(e) => {
                        setCountedRupees(e.target.value);
                        setUserHasEditedCount(true);
                      }}
                      autoFocus
                      required
                    />
                  </div>
                  <div className="quick-amount-pills">
                    <button
                      type="button"
                      className="quick-pill active"
                      onClick={() => {
                        setCountedRupees((expectedMinor / 100).toFixed(2));
                        setUserHasEditedCount(false);
                      }}
                    >
                      <CheckCircle2Icon size={13} />
                      <span>Match Expected ({formatMoney(expectedMinor)})</span>
                    </button>
                  </div>
                </div>

                {/* Variance Explanation if not balanced */}
                {!isBalanced && (
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">
                      <span>Reason for {isShortage ? 'Shortage' : 'Excess'}</span>
                      <span className="req">*</span>
                    </label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder={isShortage ? 'Explain cash shortage (e.g., miscounted change)...' : 'Explain cash surplus...'}
                      value={varianceReason}
                      onChange={(e) => setVarianceReason(e.target.value)}
                      required
                    />
                  </div>
                )}

                {/* Closing Shift Notes */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Shift Handover & Closing Notes (Optional)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g., Safe drop verified, Drawer handed over to next shift"
                    value={closingNotes}
                    onChange={(e) => setClosingNotes(e.target.value)}
                    maxLength={250}
                  />
                </div>
              </div>

              {/* Right Column: Live Variance & Reconciliation Intelligence */}
              <div className="shift-bento-panel">
                <div className="shift-bento-panel-header">
                  <div className="panel-header-title-box">
                    <ScaleIcon size={16} style={{ color: '#4f46e5' }} />
                    <h4 className="panel-header-title">Variance Reconciliation</h4>
                  </div>
                  <span
                    className={`bento-pill-badge ${isBalanced ? 'green' : isShortage ? 'red' : 'amber'}`}
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 800,
                      background: isBalanced ? '#ecfdf5' : isShortage ? '#fee2e2' : '#fef3c7',
                      color: isBalanced ? '#047857' : isShortage ? '#b91c1c' : '#b45309',
                    }}
                  >
                    {isBalanced ? 'BALANCED' : isShortage ? 'SHORTAGE' : 'EXCESS'}
                  </span>
                </div>

                {/* Variance Banner */}
                <div
                  className={`variance-banner ${isBalanced ? 'balanced' : isShortage ? 'shortage' : 'excess'}`}
                  style={{ margin: 0 }}
                >
                  <div className="variance-banner-left">
                    <div className="variance-icon-wrap">
                      {isBalanced ? (
                        <CheckCircle2Icon size={22} />
                      ) : (
                        <AlertTriangleIcon size={22} />
                      )}
                    </div>
                    <div>
                      <span className="variance-title">
                        {isBalanced && 'Cash Drawer Balanced'}
                        {isShortage && `Cash Shortage: -${formatMoney(Math.abs(varianceMinor))}`}
                        {isExcess && `Cash Excess: +${formatMoney(varianceMinor)}`}
                      </span>
                      <p className="variance-subtitle">
                        {isBalanced && `Actual Count (${formatMoney(countedMinor)}) matches Expected (${formatMoney(expectedMinor)})`}
                        {isShortage && `Deficit of ${formatMoney(Math.abs(varianceMinor))} requires manager explanation`}
                        {isExcess && `Surplus of ${formatMoney(varianceMinor)} requires manager explanation`}
                      </p>
                    </div>
                  </div>
                  <div className="variance-badge-number">
                    {isBalanced ? '₹0.00' : (varianceMinor < 0 ? '-' : '+') + formatMoney(Math.abs(varianceMinor))}
                  </div>
                </div>

                {/* Non-Cash Collections Isolation Summary */}
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '0.85rem 1rem', display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                  <CreditCardIcon size={18} style={{ color: '#2563eb', flexShrink: 0, marginTop: '2px' }} />
                  <div style={{ fontSize: '0.76rem', color: '#1e40af', lineHeight: 1.45 }}>
                    <strong>Non-Cash Collections Protected:</strong> Digital payments ({formatMoney(activeSummary.nonCashPaymentsMinor)}) are verified and credited directly to bank, not contaminating the physical drawer.
                  </div>
                </div>

                {/* Shift Financial Verification Guarantee */}
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.75rem 0.9rem', display: 'flex', gap: '0.65rem', alignItems: 'center', marginTop: 'auto', fontSize: '0.75rem', color: '#64748b' }}>
                  <ShieldCheckIcon size={16} style={{ color: '#059669', flexShrink: 0 }} />
                  <span>Permanent audit trail generated with variance classification and shift closing report.</span>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Bento Footer */}
          <div className="shift-bento-footer">
            <div className="shift-bento-footer-left">
              <ShieldCheckIcon size={15} style={{ color: '#059669' }} />
              <span>Shift reconciliation ledger finalized upon closing confirmation</span>
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
                id="btn-confirm-close-shift"
                className="cat-btn-danger"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <span>Closing Shift...</span>
                ) : (
                  <>
                    <LockIcon size={15} />
                    <span>Close Shift & Finalize Reconciliation</span>
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
