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
  branches?: Array<{ code: string; name: string; counters?: string[] }>;
}

export const OpenShiftModal: React.FC<OpenShiftModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  userName,
  userRole,
  defaultLocation,
  defaultCounter,
  branches,
}) => {
  const [openingRupees, setOpeningRupees] = useState<string>('1000');
  const [location, setLocation] = useState<string>(() => {
    if (defaultLocation && !['COUNTER-1', 'COUNTER-2', 'COUNTER-3', 'EXPRESS'].includes(defaultLocation.toUpperCase())) {
      return defaultLocation;
    }
    return 'MAIN';
  });

  const [counter, setCounter] = useState<string>(() => {
    if (defaultCounter) {
      const m = defaultCounter.trim().match(/^counter[_\-\s]*(\d+)$/i);
      return m ? `COUNTER-${m[1]}` : defaultCounter.trim();
    }
    if (defaultLocation && ['COUNTER-1', 'COUNTER-2', 'COUNTER-3', 'EXPRESS'].includes(defaultLocation.toUpperCase())) {
      return defaultLocation.toUpperCase();
    }
    return 'COUNTER-1';
  });

  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const quickAmounts = [500, 1000, 2000, 5000];

  // Resolve counters available for the current branch
  const activeBranchObj = branches?.find((b) => (b.code || '').toUpperCase() === location.toUpperCase());
  const branchCounters: string[] = activeBranchObj?.counters && Array.isArray(activeBranchObj.counters) && activeBranchObj.counters.length > 0
    ? activeBranchObj.counters
    : ['COUNTER-1', 'COUNTER-2'];

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
        counter: counter.trim() || 'COUNTER-1',
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

  const isShiftExistsError = error && error.toLowerCase().includes('already have an active shift open');

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
                <span className="cashier-pill-tag" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                  </svg>
                  <span>{userName}</span> <span className="cashier-role-tag">({userRole})</span>
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
        <form onSubmit={handleSubmit} className="shift-modal-form">
          <div className="shift-modal-body">
          {error && (
            <div className="shift-modal-alert error" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span>{error}</span>
              </div>
              {isShiftExistsError && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ alignSelf: 'flex-start', marginTop: '4px', fontSize: '0.8rem', padding: '4px 10px' }}
                  onClick={onClose}
                >
                  View Active Shift
                </button>
              )}
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
                placeholder="0"
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

          {/* Store Branch Selection (if multiple branches available) */}
          {branches && branches.length > 1 && ['owner', 'manager'].includes(userRole) ? (
            <div className="form-group">
              <label className="form-label">Store Branch</label>
              <div className="select-input-wrapper">
                <select
                  className="form-input form-select"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                >
                  {branches.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}

          {/* Counter / Register Location */}
          <div className="form-group">
            <label className="form-label">Counter / Register Location</label>
            <div className="select-input-wrapper">
              <select
                className="form-input form-select"
                value={counter}
                onChange={(e) => setCounter(e.target.value)}
              >
                {branchCounters.map((c) => {
                  const m = c.trim().match(/^counter[_\-\s]*(\d+)$/i);
                  const label = m ? `Counter ${m[1]}` : c;
                  return (
                    <option key={c} value={c}>
                      {label}
                    </option>
                  );
                })}
                {!branchCounters.includes('COUNTER-1') && <option value="COUNTER-1">Counter 1</option>}
                {!branchCounters.includes('COUNTER-2') && <option value="COUNTER-2">Counter 2</option>}
                {!branchCounters.includes('COUNTER-3') && <option value="COUNTER-3">Counter 3</option>}
                {!branchCounters.includes('EXPRESS') && <option value="EXPRESS">Express Checkout</option>}
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
