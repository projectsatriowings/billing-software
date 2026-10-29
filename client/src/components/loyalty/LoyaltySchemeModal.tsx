import React, { useState, useEffect } from 'react';
import type { Shop } from '../../api.ts';
import '../customers/CustomerDirectory.css';

export interface LoyaltySchemeModalProps {
  isOpen: boolean;
  onClose: () => void;
  shop: Shop | null;
  onSave: (settings: {
    loyaltyEnabled: boolean;
    loyaltyPointsPer100: number;
    loyaltyPointValueMinor: number;
    loyaltyMinPointsRedeem: number;
  }) => Promise<void>;
  onRefresh?: () => void;
}

export const LoyaltySchemeModal: React.FC<LoyaltySchemeModalProps> = ({
  isOpen,
  onClose,
  shop,
  onSave,
  onRefresh,
}) => {
  const [editLoyaltyEnabled, setEditLoyaltyEnabled] = useState(true);
  const [editPointsPer100, setEditPointsPer100] = useState(10);
  const [editPointValueRupees, setEditPointValueRupees] = useState(0.1);
  const [editMinRedeem, setEditMinRedeem] = useState(10);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (shop) {
      setEditLoyaltyEnabled(shop.loyaltyEnabled !== false);
      setEditPointsPer100(shop.loyaltyPointsPer100 ?? 10);
      setEditPointValueRupees((shop.loyaltyPointValueMinor ?? 10) / 100);
      setEditMinRedeem(shop.loyaltyMinPointsRedeem ?? 10);
    }
  }, [shop, isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave({
        loyaltyEnabled: editLoyaltyEnabled,
        loyaltyPointsPer100: Math.max(0, Number(editPointsPer100) || 0),
        loyaltyPointValueMinor: Math.round((Number(editPointValueRupees) || 0.1) * 100),
        loyaltyMinPointsRedeem: Math.max(0, Number(editMinRedeem) || 0),
      });
      onClose();
      if (onRefresh) onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to save loyalty settings');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="loyalty-modal-overlay" onClick={onClose}>
      <div className="loyalty-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="loyalty-modal-header">
          <div className="loyalty-header-left">
            <div className="loyalty-header-icon">🎁</div>
            <div>
              <h3 className="loyalty-header-title">Custom Loyalty Program Scheme</h3>
              <p className="loyalty-header-sub">Configure how points are earned and redeemed for your store</p>
            </div>
          </div>
          <button
            type="button"
            className="loyalty-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="loyalty-modal-body rectangular-view">
          {/* Program Toggle Banner */}
          <div
            className={`loyalty-toggle-banner ${editLoyaltyEnabled ? 'active' : 'inactive'}`}
            style={{
              background: editLoyaltyEnabled ? 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)' : '#f8fafc',
              border: editLoyaltyEnabled ? '1.5px solid #c4b5fd' : '1.5px solid #e2e8f0',
              borderRadius: '12px',
              padding: '0.85rem 1.15rem',
              marginBottom: '1rem',
              transition: 'all 0.2s ease',
            }}
          >
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', margin: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <span style={{ fontSize: '1.35rem' }}>{editLoyaltyEnabled ? '⭐' : '⏸️'}</span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '0.94rem', color: editLoyaltyEnabled ? '#4c1d95' : '#475569' }}>
                    Enable Customer Loyalty Rewards Program
                  </div>
                  <div style={{ fontSize: '0.78rem', color: editLoyaltyEnabled ? '#6d28d9' : '#64748b', marginTop: '2px' }}>
                    {editLoyaltyEnabled
                      ? 'Program is ACTIVE — points are calculated on sales and redeemable at checkout'
                      : 'Program is DISABLED — points calculation and counter redemption are turned OFF'}
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={editLoyaltyEnabled}
                onChange={(e) => setEditLoyaltyEnabled(e.target.checked)}
                style={{ width: '22px', height: '22px', accentColor: '#7c3aed', cursor: 'pointer' }}
              />
            </label>
          </div>

          {/* ONLY SHOW SCHEME WHEN ENABLED */}
          {editLoyaltyEnabled ? (
            <div className="loyalty-grid-2col">
              {/* LEFT COLUMN: Earning Scheme */}
              <div className="loyalty-config-pane purple-pane">
                <div className="pane-header">
                  <span className="pane-icon">🎁</span>
                  <div>
                    <h4 className="pane-title">1. Points Earning Scheme</h4>
                    <p className="pane-sub">How customers earn points on purchase</p>
                  </div>
                </div>

                <div className="pane-body">
                  <label className="pane-field-label">Points Earned per ₹100 Purchase</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                    <input
                      type="number"
                      min="0"
                      max="1000"
                      step="1"
                      className="form-input mono bold"
                      style={{ width: '100px', fontSize: '1.15rem', textAlign: 'center', color: '#7c3aed', background: '#ffffff' }}
                      value={editPointsPer100}
                      onChange={(e) => setEditPointsPer100(Number(e.target.value))}
                    />
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>
                      pts for every ₹100 spent
                    </span>
                  </div>

                  {/* Presets */}
                  <div className="preset-chips-row compact">
                    {[2, 5, 10, 15, 20].map((rate) => (
                      <button
                        key={rate}
                        type="button"
                        className={`preset-chip-btn ${editPointsPer100 === rate ? 'active' : ''}`}
                        onClick={() => setEditPointsPer100(rate)}
                      >
                        {rate} pts / ₹100
                      </button>
                    ))}
                  </div>

                  {/* Live Purchase Preview */}
                  <div className="loyalty-live-preview-box purple" style={{ marginTop: '0.85rem' }}>
                    <span style={{ fontSize: '1.15rem' }}>⚡</span>
                    <div style={{ fontSize: '0.78rem', color: '#4c1d95', lineHeight: 1.35 }}>
                      <strong>Live Example:</strong> A bill of <strong>₹500</strong> earns{' '}
                      <span className="preview-pill-stat purple">{Math.floor((500 * (Number(editPointsPer100) || 0)) / 100)} points</span>!
                    </div>
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN: Redemption Scheme */}
              <div className="loyalty-config-pane emerald-pane">
                <div className="pane-header">
                  <span className="pane-icon">🪙</span>
                  <div>
                    <h4 className="pane-title">2. Points Redemption Scheme</h4>
                    <p className="pane-sub">How much discount each point is worth at POS</p>
                  </div>
                </div>

                <div className="pane-body">
                  <label className="pane-field-label">Discount Value per 1 Point</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 800, color: '#059669' }}>₹</span>
                    <input
                      type="number"
                      min="0.01"
                      max="50"
                      step="0.05"
                      className="form-input mono bold"
                      style={{ width: '100px', fontSize: '1.15rem', textAlign: 'center', color: '#059669', background: '#ffffff' }}
                      value={editPointValueRupees}
                      onChange={(e) => setEditPointValueRupees(Number(e.target.value))}
                    />
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#475569' }}>
                      off bill per 1 pt
                    </span>
                  </div>

                  {/* Presets */}
                  <div className="preset-chips-row compact">
                    {[
                      { label: '₹0.10 (10 pts = ₹1)', val: 0.1 },
                      { label: '₹0.20 (5 pts = ₹1)', val: 0.2 },
                      { label: '₹0.50 (2 pts = ₹1)', val: 0.5 },
                      { label: '₹1.00 (1 pt = ₹1)', val: 1.0 },
                    ].map((p) => (
                      <button
                        key={p.val}
                        type="button"
                        className={`preset-chip-btn ${Math.abs(editPointValueRupees - p.val) < 0.001 ? 'active' : ''}`}
                        onClick={() => setEditPointValueRupees(p.val)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  {/* Minimum Points to Redeem */}
                  <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', whiteSpace: 'nowrap' }}>
                      Min Balance to Redeem:
                    </span>
                    <input
                      type="number"
                      min="0"
                      max="1000"
                      step="5"
                      className="form-input mono bold"
                      style={{ width: '70px', padding: '0.2rem 0.4rem', textAlign: 'center', fontSize: '0.85rem' }}
                      value={editMinRedeem}
                      onChange={(e) => setEditMinRedeem(Number(e.target.value))}
                    />
                    <span style={{ fontSize: '0.74rem', color: '#64748b' }}>pts required at POS</span>
                  </div>

                  {/* Live Redemption Preview */}
                  <div className="loyalty-live-preview-box" style={{ marginTop: '0.65rem' }}>
                    <span style={{ fontSize: '1.15rem' }}>🎁</span>
                    <div style={{ fontSize: '0.78rem', color: '#065f46', lineHeight: 1.35 }}>
                      <strong>Redemption Example:</strong> <strong>100 points</strong> ={' '}
                      <span className="preview-pill-stat">₹{(100 * (Number(editPointValueRupees) || 0.1)).toFixed(2)} discount</span> at counter!
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* INACTIVE / DISABLED VIEW */
            <div
              className="loyalty-disabled-state"
              style={{
                background: '#f8fafc',
                border: '1.5px dashed #cbd5e1',
                borderRadius: '12px',
                padding: '2.5rem 1.5rem',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.65rem',
                margin: '0.5rem 0',
              }}
            >
              <div
                style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '50%',
                  background: '#f1f5f9',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.75rem',
                }}
              >
                ⏸️
              </div>
              <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#334155' }}>
                Loyalty Rewards Program is Currently Disabled
              </h4>
              <p style={{ margin: 0, maxWidth: '440px', fontSize: '0.82rem', color: '#64748b', lineHeight: 1.5 }}>
                When disabled, points earning and redemption schemes are hidden and inactive. Customers will not accrue points, and the redemption button will not appear at POS checkout.
              </p>
              <button
                type="button"
                onClick={() => setEditLoyaltyEnabled(true)}
                className="btn btn-secondary"
                style={{
                  marginTop: '0.5rem',
                  padding: '0.45rem 1.25rem',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  color: '#6d28d9',
                  borderColor: '#c4b5fd',
                  background: '#ede9fe',
                  cursor: 'pointer',
                  borderRadius: '8px',
                }}
              >
                ✨ Click to Enable &amp; Configure Scheme
              </button>
            </div>
          )}
        </div>

        <div className="loyalty-modal-footer">
          <button
            type="button"
            className="btn-modal-cancel"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-modal-save"
            onClick={handleSave}
            disabled={isSaving}
            style={{
              background: editLoyaltyEnabled ? '#7c3aed' : '#475569',
            }}
          >
            {isSaving
              ? 'Saving...'
              : editLoyaltyEnabled
              ? 'Save Loyalty Scheme'
              : 'Save (Disable Program)'}
          </button>
        </div>
      </div>
    </div>
  );
};

