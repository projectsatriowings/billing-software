import React, { useState, useEffect } from 'react';
import { closeShift, fetchActiveShift, fetchShiftDetails, type Shift, type ShiftSummary } from '../../api.ts';
import { formatMoney } from '../../../../shared/shifts.ts';

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
  const [liveSummary, setLiveSummary] = useState<ShiftSummary>(summary);
  const [loadingLive, setLoadingLive] = useState<boolean>(false);
  const [userHasEditedCount, setUserHasEditedCount] = useState<boolean>(false);
  const [countedRupees, setCountedRupees] = useState<string>(
    ((summary?.expectedCashMinor ?? 0) / 100).toFixed(2)
  );
  const [varianceReason, setVarianceReason] = useState<string>('');
  const [closingNote, setClosingNote] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Authoritative live data fetching & real-time synchronization
  useEffect(() => {
    if (!isOpen) {
      setUserHasEditedCount(false);
      return;
    }

    if (summary) {
      setLiveSummary(summary);
      if (!userHasEditedCount) {
        setCountedRupees(((summary.expectedCashMinor ?? 0) / 100).toFixed(2));
      }
    }

    let mounted = true;
    const fetchFreshTotals = async () => {
      setLoadingLive(true);
      try {
        let freshSummary: ShiftSummary | null = null;
        if (activeShift?.id) {
          try {
            const det = await fetchShiftDetails(activeShift.id);
            if (det?.shift?.summary) {
              freshSummary = det.shift.summary;
            }
          } catch (detErr) {
            console.warn('Could not fetch shift details by id:', detErr);
          }
        }
        if (!freshSummary) {
          const res = await fetchActiveShift();
          if (res?.activeShift?.summary) {
            freshSummary = res.activeShift.summary;
          }
        }
        if (mounted && freshSummary) {
          setLiveSummary(freshSummary);
          if (!userHasEditedCount) {
            setCountedRupees(((freshSummary.expectedCashMinor ?? 0) / 100).toFixed(2));
          }
        }
      } catch (err) {
        console.warn('Could not refresh live shift summary:', err);
      } finally {
        if (mounted) setLoadingLive(false);
      }
    };

    fetchFreshTotals();

    const handleSync = (e?: any) => {
      if (e?.detail?.summary) {
        setLiveSummary(e.detail.summary);
        if (!userHasEditedCount) {
          setCountedRupees(((e.detail.summary.expectedCashMinor ?? 0) / 100).toFixed(2));
        }
      }
      fetchFreshTotals();
    };

    window.addEventListener('shift_status_changed', handleSync);
    window.addEventListener('cash_movement_recorded', handleSync);

    return () => {
      mounted = false;
      window.removeEventListener('shift_status_changed', handleSync);
      window.removeEventListener('cash_movement_recorded', handleSync);
    };
  }, [isOpen, activeShift?.id, summary]);

  if (!isOpen) return null;

  const activeSummary = liveSummary || summary;
  const parsedCounted = parseFloat(countedRupees);
  const countedMinor = isNaN(parsedCounted) || parsedCounted < 0 ? 0 : Math.round(parsedCounted * 100);
  const expectedMinor = activeSummary?.expectedCashMinor ?? 0;
  const varianceMinor = countedMinor - expectedMinor;

  const isBalanced = varianceMinor === 0;
  const isShortage = varianceMinor < 0;
  const isExcess = varianceMinor > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (isNaN(parsedCounted) || parsedCounted < 0) {
      setError('Please enter a valid non-negative counted cash amount.');
      return;
    }

    if (!isBalanced && !varianceReason.trim()) {
      setError(
        `A mandatory explanation reason is required for a cash ${
          isShortage ? 'shortage' : 'excess'
        } of ${formatMoney(Math.abs(varianceMinor))}.`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await closeShift(activeShift.id, {
        countedCashMinor: countedMinor,
        varianceReason: varianceReason.trim() || undefined,
        note: closingNote.trim() || undefined,
      });
      window.dispatchEvent(new Event('shift_status_changed'));
      onSuccess(res.shift);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to close shift.');
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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content shift-modal-card wide" onClick={(e) => e.stopPropagation()}>
        {/* Top Accent Gradient Bar */}
        <div className="modal-top-accent red-accent"></div>

        <div className="modal-header">
          <div className="modal-title-wrap">
            <div className="modal-icon-badge red">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
            </div>
            <div>
              <h2 className="modal-title">Close Shift & Day-End Reconcile</h2>
              <p className="modal-subtitle">
                Shift: <span className="shift-ref-pill">#{activeShift.shiftNumber || activeShift.id.slice(0, 8)}</span> • Cashier:{' '}
                <span className="cashier-pill-tag">👤 {activeShift.userName || 'Current Cashier'}</span>
                {activeShift.openedAt && (
                  <> • Opened: <span>{formatShiftOpenedAt(activeShift.openedAt)}</span></>
                )}
              </p>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close modal">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="shift-modal-form">
          <div className="shift-modal-body">
          {error && (
            <div className="shift-modal-alert error">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* Expected Drawer Cash Breakdown Panel */}
          <div className="shift-reconciliation-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h4 className="panel-subheading" style={{ margin: 0 }}>Authoritative Drawer Cash Balance</h4>
              {loadingLive && (
                <span style={{ fontSize: '12px', color: '#3b82f6', fontWeight: 600 }}>
                  ↻ Refreshing live totals...
                </span>
              )}
            </div>
            <div className="recon-formula-grid">
              <div className="recon-term">
                <span className="term-label">Opening Float</span>
                <span className="term-val">{formatMoney(activeSummary.openingCashMinor)}</span>
              </div>
              <span className="recon-op">+</span>
              <div className="recon-term">
                <span className="term-label">Cash Sales</span>
                <span className="term-val">{formatMoney(activeSummary.cashSalesMinor)}</span>
              </div>
              {activeSummary.cashPaymentsMinor > 0 && (
                <>
                  <span className="recon-op">+</span>
                  <div className="recon-term">
                    <span className="term-label">Customer Receipts</span>
                    <span className="term-val text-success">+{formatMoney(activeSummary.cashPaymentsMinor)}</span>
                  </div>
                </>
              )}
              <span className="recon-op">+</span>
              <div className="recon-term">
                <span className="term-label">Cash-In</span>
                <span className="term-val text-success">+{formatMoney(activeSummary.cashInMinor)}</span>
              </div>
              <span className="recon-op">-</span>
              <div className="recon-term">
                <span className="term-label">Cash-Out</span>
                <span className="term-val text-warning">-{formatMoney(activeSummary.cashOutMinor)}</span>
              </div>
              <span className="recon-op">-</span>
              <div className="recon-term">
                <span className="term-label">Cash Refunds</span>
                <span className="term-val text-danger">-{formatMoney(activeSummary.cashRefundsMinor)}</span>
              </div>
              <span className="recon-op">=</span>
              <div className="recon-term expected-term">
                <span className="term-label">EXPECTED CASH</span>
                <span className="term-val expected-val">{formatMoney(expectedMinor)}</span>
              </div>
            </div>

            <div className="recon-noncash-notice">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
              <span>
                <strong>Non-Cash Collections:</strong> UPI, Card, and Bank payments total{' '}
                <strong>{formatMoney(activeSummary.nonCashPaymentsMinor)}</strong> and are safely excluded from the physical cash drawer.
              </span>
            </div>
          </div>

          {/* Physical Counted Cash Input */}
          <div className="form-group count-cash-group">
            <label className="form-label">
              <span>Actual Physical Cash Counted in Drawer (₹)</span>
              <span className="req">*</span>
            </label>
            <div className="rupee-input-wrapper large">
              <div className="rupee-badge-prefix">₹</div>
              <input
                type="number"
                min="0"
                step="0.01"
                className="form-input rupee-input large"
                placeholder="0"
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <span>Match Expected ({formatMoney(expectedMinor)})</span>
              </button>
            </div>
          </div>

          {/* Live Variance Visual Indicator */}
          <div className={`variance-banner ${isBalanced ? 'balanced' : isShortage ? 'shortage' : 'excess'}`}>
            <div className="variance-banner-left">
              <div className="variance-icon-wrap">
                {isBalanced ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                ) : isShortage ? (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 20 4 8 20 8 12 20"></polygon>
                  </svg>
                ) : (
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 4 4 16 20 16 12 4"></polygon>
                  </svg>
                )}
              </div>
              <div>
                <span className="variance-title">
                  {isBalanced && 'Status: Matched • Cash Drawer Balanced (₹0.00 Variance)'}
                  {isShortage && `Status: Short • Cash Shortage (${formatMoney(Math.abs(varianceMinor))} Deficit)`}
                  {isExcess && `Status: Over • Cash Excess (+${formatMoney(varianceMinor)} Surplus)`}
                </span>
                <p className="variance-subtitle">
                  {isBalanced && `Actual Cash (${formatMoney(countedMinor)}) = Expected Cash (${formatMoney(expectedMinor)}). Exact match.`}
                  {isShortage && `Cash Difference = Actual (${formatMoney(countedMinor)}) - Expected (${formatMoney(expectedMinor)}) = -${formatMoney(Math.abs(varianceMinor))}. Explanation required.`}
                  {isExcess && `Cash Difference = Actual (${formatMoney(countedMinor)}) - Expected (${formatMoney(expectedMinor)}) = +${formatMoney(varianceMinor)}. Explanation required.`}
                </p>
              </div>
            </div>
            <div className="variance-badge-number">
              {formatMoney(varianceMinor)}
            </div>
          </div>

          {/* Mandatory Discrepancy Reason if variance != 0 */}
          {!isBalanced && (
            <div className="form-group highlight-danger">
              <label className="form-label text-danger">
                <span>Mandatory Discrepancy Explanation Reason</span>
                <span className="req">*</span>
              </label>
              <textarea
                className="form-input form-textarea"
                rows={2}
                placeholder="Explain the reason for cash shortage or excess (e.g., Shortage on customer change, Safe transfer difference, etc.)"
                value={varianceReason}
                onChange={(e) => setVarianceReason(e.target.value)}
                required
              />
              <span className="form-hint text-warning">
                This explanation will be permanently recorded in the Day-End Closing Report and flagged for Manager review.
              </span>
            </div>
          )}

          {/* General Closing Notes */}
          <div className="form-group">
            <label className="form-label">General Handover / Closing Notes (Optional)</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g., Evening handover to night cashier, all card batches settled"
              value={closingNote}
              onChange={(e) => setClosingNote(e.target.value)}
              maxLength={250}
            />
          </div>
          </div>

          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary modal-cancel-btn"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-danger btn-finalize-close"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <span className="spinner-sm"></span>
                  <span>Closing & Finalizing Shift...</span>
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                  </svg>
                  <span>Finalize Day-End Close</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
