import { createPortal } from 'react-dom';
import React, { useState } from 'react';
import { openShift, type Shift } from '../../api.ts';
import { formatMoney } from '../../../../shared/shifts.ts';
import {
  StoreIcon,
  ShieldCheckIcon,
  WalletIcon,
  CheckCircle2Icon,
  AlertTriangleIcon,
  UserIcon,
  MapPinIcon,
  PlusIcon,
} from '../inventory/InventoryIcons.tsx';

interface OpenShiftModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (shift: Shift) => void;
  userName: string;
  userRole: string;
  defaultLocation?: string;
  defaultCounter?: string;
  defaultCounterId?: string;
  branches?: Array<{ id?: string; code: string; name: string; counters?: string[]; counterDetails?: any[] }>;
  counterDetails?: any[];
}

export const OpenShiftModal: React.FC<OpenShiftModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  userName,
  userRole,
  defaultLocation,
  defaultCounter,
  defaultCounterId,
  branches,
  counterDetails,
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

  const quickAmounts = [500, 1000, 2000, 5000, 10000];

  // Resolve counters available for the current branch
  const activeBranchObj = branches?.find((b) => (b.code || '').toUpperCase() === location.toUpperCase());
  const detailsList = counterDetails || activeBranchObj?.counterDetails;
  const activeDetails = detailsList ? detailsList.filter((c: any) => c.status !== 'DISABLED') : null;

  const branchCounters: Array<{ code: string; name: string; id?: string }> = React.useMemo(() => {
    if (activeDetails && activeDetails.length > 0) {
      return activeDetails.map((c: any) => ({
        id: c.id,
        code: c.code,
        name: c.name || c.code,
      }));
    }
    const rawCounters = activeBranchObj?.counters && Array.isArray(activeBranchObj.counters) && activeBranchObj.counters.length > 0
      ? activeBranchObj.counters
      : ['COUNTER-1'];
    return rawCounters.map((c: string) => {
      const m = c.trim().match(/^counter[_\-\s]*(\d+)$/i);
      return {
        code: c,
        name: m ? `Counter ${m[1]}` : c,
      };
    });
  }, [activeDetails, activeBranchObj]);

  const parsedRupees = parseFloat(openingRupees) || 0;
  const openingCashMinor = Math.round(parsedRupees * 100);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = parseFloat(openingRupees);
    if (isNaN(parsed) || parsed < 0) {
      setError('Please enter a valid non-negative opening cash float amount.');
      return;
    }

    const matchedCounter = branchCounters.find(
      (c) => (defaultCounterId && c.id === defaultCounterId) || c.code === counter || c.name === counter
    );
    const counterCode = matchedCounter?.code || counter.trim() || 'COUNTER-1';
    const counterId = matchedCounter?.id;

    setIsSubmitting(true);
    try {
      const res = await openShift({
        openingCashMinor,
        location: location.trim() || 'MAIN',
        counter: counterCode,
        counterId,
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

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="shift-bento-dialog" onClick={(e) => e.stopPropagation()}>
        {/* Top Accent Gradient Bar */}
        <div className="modal-top-accent green-accent"></div>

        {/* 1. Bento Header */}
        <div className="shift-bento-header">
          <div className="shift-bento-header-left">
            <div className="shift-bento-icon-badge green">
              <StoreIcon size={22} />
            </div>
            <div className="shift-bento-title-wrap">
              <h3>
                <span>Open Cashier Shift</span>
              </h3>
              <p>
                <UserIcon size={12} />
                <span>Cashier: <strong>{userName}</strong> ({userRole})</span>
                <span>•</span>
                <MapPinIcon size={12} />
                <span>Branch: {location}</span>
                <span>•</span>
                <StoreIcon size={12} />
                <span>{counter}</span>
              </p>
            </div>
          </div>

          <div className="shift-bento-header-actions">
            <span
              className="cat-badge-live-sync"
              style={{ background: '#ecfdf5', color: '#047857', borderColor: '#a7f3d0' }}
            >
              <span className="live-indicator-dot"></span>
              DRAWER SETUP
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
            {/* Top 3-Tile Bento Ribbon */}
            <div className="shift-bento-ribbon cols-3">
              <div className="shift-bento-ribbon-tile highlight">
                <div className="ribbon-tile-label">
                  <span>Starting Float</span>
                  <WalletIcon size={13} style={{ color: '#059669' }} />
                </div>
                <div className="ribbon-tile-val text-success" style={{ color: '#059669' }}>
                  {formatMoney(openingCashMinor)}
                </div>
                <div className="ribbon-tile-sub">Initial physical cash in register</div>
              </div>

              <div className="shift-bento-ribbon-tile">
                <div className="ribbon-tile-label">
                  <span>Counter Terminal</span>
                  <StoreIcon size={13} style={{ color: '#6366f1' }} />
                </div>
                <div className="ribbon-tile-val" style={{ fontSize: '1.15rem' }}>
                  {counter}
                </div>
                <div className="ribbon-tile-sub">Location: {location}</div>
              </div>

              <div className="shift-bento-ribbon-tile">
                <div className="ribbon-tile-label">
                  <span>Shift Status</span>
                  <CheckCircle2Icon size={13} style={{ color: '#10b981' }} />
                </div>
                <div className="ribbon-tile-val" style={{ fontSize: '1.15rem', color: '#16a34a' }}>
                  Ready to Open
                </div>
                <div className="ribbon-tile-sub">Immediate POS enablement</div>
              </div>
            </div>

            {error && (
              <div className="shift-modal-alert error" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <AlertTriangleIcon size={18} style={{ flexShrink: 0 }} />
                  <span>{error}</span>
                </div>
                {isShiftExistsError && (
                  <button
                    type="button"
                    className="cat-btn-outline"
                    style={{ alignSelf: 'flex-start', marginTop: '4px', fontSize: '0.8rem', padding: '4px 10px' }}
                    onClick={onClose}
                  >
                    View Active Shift
                  </button>
                )}
              </div>
            )}

            {/* Dual Column Bento Grid */}
            <div className="shift-bento-main-grid">
              {/* Left Column: Form Controls */}
              <div className="shift-bento-panel">
                <div className="shift-bento-panel-header">
                  <div className="panel-header-title-box">
                    <WalletIcon size={16} style={{ color: '#059669' }} />
                    <h4 className="panel-header-title">Opening Float & Location</h4>
                  </div>
                  <span className="bento-pill-badge info" style={{ fontSize: '0.68rem', padding: '0.15rem 0.5rem' }}>
                    Cash Float
                  </span>
                </div>

                {/* Opening Float Input */}
                <div className="form-group" style={{ marginBottom: 0 }}>
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
                              <CheckCircle2Icon size={12} />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Store Branch Selection (if multiple branches available) */}
                {branches && branches.length > 1 && ['owner', 'manager'].includes(userRole) ? (
                  <div className="form-group" style={{ marginBottom: 0 }}>
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
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Counter / Register Location</label>
                  <div className="select-input-wrapper">
                    <select
                      className="form-input form-select"
                      value={counter}
                      onChange={(e) => setCounter(e.target.value)}
                    >
                      {branchCounters.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name} ({c.code})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Opening Shift Notes */}
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Opening Shift Notes (Optional)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g., Change verified with store supervisor"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    maxLength={200}
                  />
                </div>
              </div>

              {/* Right Column: Briefing Bento Card */}
              <div className="shift-bento-panel">
                <div className="shift-bento-panel-header">
                  <div className="panel-header-title-box">
                    <ShieldCheckIcon size={16} style={{ color: '#4f46e5' }} />
                    <h4 className="panel-header-title">Shift Audit Readiness</h4>
                  </div>
                  <span className="bento-pill-badge primary" style={{ fontSize: '0.68rem', padding: '0.15rem 0.5rem' }}>
                    Active Checklist
                  </span>
                </div>

                {/* Cashier Briefing Box */}
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.9rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: '#e0e7ff', color: '#4338ca', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <UserIcon size={18} />
                    </div>
                    <div>
                      <strong style={{ display: 'block', fontSize: '0.92rem', color: '#0f172a' }}>{userName}</strong>
                      <span style={{ fontSize: '0.76rem', color: '#64748b' }}>Assigned Cashier ({userRole.toUpperCase()})</span>
                    </div>
                  </div>
                  <div className="live-calc-divider"></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#64748b' }}>
                    <span>Registered Counter:</span>
                    <strong style={{ color: '#0f172a' }}>{counter}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#64748b' }}>
                    <span>Store Branch:</span>
                    <strong style={{ color: '#0f172a' }}>{location}</strong>
                  </div>
                </div>

                {/* Checklist Rules */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', fontSize: '0.78rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', color: '#334155' }}>
                    <CheckCircle2Icon size={15} style={{ color: '#10b981', flexShrink: 0 }} />
                    <span>Physical drawer bills and coins counted</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', color: '#334155' }}>
                    <CheckCircle2Icon size={15} style={{ color: '#10b981', flexShrink: 0 }} />
                    <span>Opening float stamped to audit ledger</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', color: '#334155' }}>
                    <CheckCircle2Icon size={15} style={{ color: '#10b981', flexShrink: 0 }} />
                    <span>POS register counter automatically linked</span>
                  </div>
                </div>

                {/* Financial Guarantee Card */}
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '0.75rem 0.9rem', display: 'flex', gap: '0.65rem', alignItems: 'flex-start', marginTop: 'auto' }}>
                  <ShieldCheckIcon size={18} style={{ color: '#059669', flexShrink: 0, marginTop: '2px' }} />
                  <div style={{ fontSize: '0.74rem', color: '#166534', lineHeight: 1.45 }}>
                    <strong>Mathematical Precision:</strong> All future cash sales, refunds, and drawer movements will strictly calculate against this opening float.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 3. Bento Footer */}
          <div className="shift-bento-footer">
            <div className="shift-bento-footer-left">
              <ShieldCheckIcon size={15} style={{ color: '#059669' }} />
              <span>Register drawer session locked to terminal & cashier identity</span>
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
                id="btn-confirm-open-shift"
                className="cat-btn-primary"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <span>Opening Shift...</span>
                ) : (
                  <>
                    <PlusIcon size={15} />
                    <span>Open Cashier Shift Now</span>
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
