import React, { useState } from 'react';
import { recordCashMovement, type CashMovement, type Shift } from '../../api.ts';

interface CashMovementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (movement: CashMovement) => void;
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

  const quickAmounts = [100, 200, 500, 1000, 2000];

  const handleTypeToggle = (type: 'cash_in' | 'cash_out') => {
    setMovementType(type);
    if (type === 'cash_in') {
      setReasonCategory(cashInReasons[0]);
    } else {
      setReasonCategory(cashOutReasons[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedRupees = parseFloat(amountRupees);
    if (isNaN(parsedRupees) || parsedRupees <= 0) {
      setError('Movement amount must be greater than zero.');
      return;
    }

    const effectiveReason = reasonCategory.includes('Other') && customReason.trim()
      ? customReason.trim()
      : reasonCategory;

    if (!effectiveReason) {
      setError('Please provide an authorized reason for this cash movement.');
      return;
    }

    const amountMinor = Math.round(parsedRupees * 100);

    setIsSubmitting(true);
    try {
      const res = await recordCashMovement(activeShift.id, {
        movementType,
        amountMinor,
        reason: effectiveReason,
        notes: notes.trim() || undefined,
      });
      onSuccess(res.movement);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to record cash movement.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content shift-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Top Accent Gradient Bar */}
        <div className={`modal-top-accent ${movementType === 'cash_in' ? 'green-accent' : 'amber-accent'}`}></div>

        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-title-wrap">
            <div className={`modal-icon-badge ${movementType === 'cash_in' ? 'green' : 'amber'}`}>
              {movementType === 'cash_in' ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v14M19 9l-7 7-7-7M2 20h20"/>
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 16V2M5 9l7-7 7 7M2 20h20"/>
                </svg>
              )}
            </div>
            <div>
              <h2 className="modal-title">Record Cash Movement</h2>
              <p className="modal-subtitle">
                Shift: <span className="shift-ref-pill">#{activeShift.shiftNumber || activeShift.id.slice(0, 8)}</span> • Drawer Cash Flow
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

        <form onSubmit={handleSubmit} className="shift-modal-body">
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

          {/* Movement Type Toggle */}
          <div className="movement-toggle-row">
            <button
              type="button"
              className={`movement-toggle-btn in ${movementType === 'cash_in' ? 'active' : ''}`}
              onClick={() => handleTypeToggle('cash_in')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v14M19 9l-7 7-7-7M2 20h20"/>
              </svg>
              <span>Cash-In (Deposit into Drawer)</span>
            </button>
            <button
              type="button"
              className={`movement-toggle-btn out ${movementType === 'cash_out' ? 'active' : ''}`}
              onClick={() => handleTypeToggle('cash_out')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 16V2M5 9l7-7 7 7M2 20h20"/>
              </svg>
              <span>Cash-Out (Drawer Payout)</span>
            </button>
          </div>

          {/* Amount input */}
          <div className="form-group">
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
                placeholder="0"
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="quick-amount-pills">
              {quickAmounts.map((amt) => {
                const isSelected = parseFloat(amountRupees) === amt;
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
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Reason Select */}
          <div className="form-group">
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
            <div className="form-group">
              <label className="form-label">
                <span>Specify Custom Reason</span>
                <span className="req">*</span>
              </label>
              <input
                type="text"
                className="form-input"
                placeholder="Enter specific reason..."
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                required
              />
            </div>
          )}

          {/* Notes */}
          <div className="form-group">
            <label className="form-label">Audit Notes & Reference (Optional)</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g., Voucher #, Denominations or Safe bag id"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={250}
            />
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
              className={`btn ${movementType === 'cash_in' ? 'btn-success-gradient' : 'btn-warning-gradient'}`}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <span className="spinner-sm"></span>
                  <span>Recording...</span>
                </>
              ) : movementType === 'cash_in' ? (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2v14M19 9l-7 7-7-7M2 20h20"/>
                  </svg>
                  <span>Confirm Cash-In (+)</span>
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 16V2M5 9l7-7 7 7M2 20h20"/>
                  </svg>
                  <span>Confirm Cash-Out (-)</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
