import React, { useState } from 'react';
import { openShift, type Shift } from '../../api.ts';

interface OpenShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (shift: Shift) => void;
  userName: string;
  userRole: string;
  defaultLocation?: string;
  defaultCounter?: string;
}

export const OpenShiftModal: React.FC<OpenShiftModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  userName,
  userRole,
  defaultLocation,
  defaultCounter,
}) => {
  const [openingRupees, setOpeningRupees] = useState<string>('1000');
  const [location, setLocation] = useState<string>(defaultLocation || 'MAIN');
  const [counter, setCounter] = useState<string>(defaultCounter || 'COUNTER-1');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const quickAmounts = [500, 1000, 2000, 5000];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedRupees = parseFloat(openingRupees);
    if (isNaN(parsedRupees) || parsedRupees < 0) {
      setError('Please enter a valid non-negative opening cash float amount.');
      return;
    }

    const openingCashMinor = Math.round(parsedRupees * 100);

    setIsSubmitting(true);
    try {
      const res = await openShift({
        openingCashMinor,
        location: location.trim() || 'MAIN',
        counter: counter.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onSuccess(res.shift);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to open shift. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content shift-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Top Accent Gradient Bar */}
        <div className="modal-top-accent"></div>

        {/* Modal Header */}
        <div className="modal-header">
          <div className="modal-title-wrap">
            <div className="modal-icon-badge green">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M7 15h0M2 9.5h20" />
                <circle cx="12" cy="14" r="2" />
              </svg>
            </div>
            <div>
              <h2 className="modal-title">Open Cashier Shift</h2>
              <p className="modal-subtitle">
                Drawer register for cashier:{' '}
                <span className="cashier-pill-tag">
                  👤 {userName} <span className="cashier-role-tag">({userRole})</span>
                </span>
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

        {/* Form Body */}
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

          {/* Opening Float Input */}
          <div className="form-group">
            <label className="form-label">
              <span>Opening Cash Float (₹)</span>
              <span className="req">*</span>
            </label>

            <div className="rupee-input-wrapper">
              <div className="rupee-badge-prefix">₹</div>
              <input
                type="number"
                min="0"
                step="0.01"
                className="form-input rupee-input"
                placeholder="0.00"
                value={openingRupees}
                onChange={(e) => setOpeningRupees(e.target.value)}
                autoFocus
                required
              />
            </div>

            {/* Quick Preset Buttons */}
            <div className="quick-amount-pills">
              {quickAmounts.map((amt) => {
                const isSelected = parseFloat(openingRupees) === amt;
                return (
                  <button
                    key={amt}
                    type="button"
                    className={`quick-pill ${isSelected ? 'active' : ''}`}
                    onClick={() => setOpeningRupees(amt.toString())}
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

            <div className="form-hint-callout">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="16" x2="12" y2="12"></line>
                <line x1="12" y1="8" x2="12.01" y2="8"></line>
              </svg>
              <span>Physical cash counted and placed into the drawer at shift start.</span>
            </div>
          </div>

          {/* Counter / Location */}
          <div className="form-group">
            <label className="form-label">Counter / Register Location</label>
            <div className="select-input-wrapper">
              <select
                className="form-input form-select"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              >
                <option value="MAIN">Main Billing Counter (MAIN)</option>
                <option value="COUNTER-1">Counter 1</option>
                <option value="COUNTER-2">Counter 2</option>
                <option value="EXPRESS">Express Checkout</option>
              </select>
            </div>
          </div>

          {/* Opening Shift Notes */}
          <div className="form-group">
            <label className="form-label">Opening Shift Notes (Optional)</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g., Morning counter shift, notes on change denominations"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={200}
            />
          </div>

          {/* Modal Actions */}
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
              className="btn btn-primary btn-start-shift"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <span className="spinner-sm"></span>
                  <span>Starting Shift...</span>
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                  </svg>
                  <span>Start Cashier Shift</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
