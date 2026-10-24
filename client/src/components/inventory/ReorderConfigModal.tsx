import React, { useState, useEffect } from 'react';
import type { Item, Party } from '../../api.ts';
import { updateItemReorder } from '../../api.ts';

interface ReorderConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedItem: any) => void;
  item: Item | null;
  suppliers: Party[];
}

export const ReorderConfigModal: React.FC<ReorderConfigModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  item,
  suppliers,
}) => {
  const [reorderUnits, setReorderUnits] = useState<string>('');
  const [minStockUnits, setMinStockUnits] = useState<string>('');
  const [preferredSupplierId, setPreferredSupplierId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (item) {
      setReorderUnits(item.reorderMilli ? (item.reorderMilli / 1000).toString() : '0');
      setMinStockUnits(item.minStockMilli ? (item.minStockMilli / 1000).toString() : '0');
      setPreferredSupplierId(item.preferredSupplierId || '');
    }
    setError(null);
  }, [isOpen, item]);

  if (!isOpen || !item) return null;

  const unit = item.unit || 'pcs';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const reorderVal = parseFloat(reorderUnits) || 0;
    const minStockVal = parseFloat(minStockUnits) || 0;

    if (reorderVal < 0 || minStockVal < 0) {
      setError('Thresholds must be zero or a positive quantity.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await updateItemReorder(item.id, {
        reorderMilli: Math.round(reorderVal * 1000),
        minStockMilli: Math.round(minStockVal * 1000),
        preferredSupplierId: preferredSupplierId || null,
      });
      setIsSubmitting(false);
      onSuccess(res.item);
      onClose();
    } catch (err: any) {
      setIsSubmitting(false);
      setError(err?.message || 'Failed to update reorder settings.');
    }
  };

  return (
    <div className="modal-overlay modal-backdrop" onClick={onClose} style={{ zIndex: 10000 }}>
      <div
        className="modal-content inventory-modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '480px', width: '92%' }}
      >
        <div className="modal-header">
          <div className="modal-title-wrap">
            <span className="modal-icon-badge blue">🔔</span>
            <div>
              <h2 className="modal-title">Reorder & Low Stock Settings</h2>
              <p className="modal-subtitle">Configure thresholds for {item.name}</p>
            </div>
          </div>
          <button type="button" className="btn-close-modal" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form-body">
          {error && (
            <div className="form-error-alert" style={{ marginBottom: '1rem' }}>
              <span className="error-icon">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <div className="item-meta-summary-box" style={{ marginBottom: '1.25rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.98rem', color: 'var(--text-main)' }}>{item.name}</div>
            <div style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
              Current stock on shelf:{' '}
              <strong style={{ color: 'var(--primary)', fontFamily: 'JetBrains Mono, monospace' }}>
                {(item.currentStockMilli / 1000).toFixed(1)} {unit}
              </strong>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="field-label">Reorder Level ({unit})</label>
            <div className="input-with-unit">
              <input
                type="number"
                step="any"
                min="0"
                className="form-input"
                placeholder="e.g. 20"
                value={reorderUnits}
                onChange={(e) => setReorderUnits(e.target.value)}
                autoFocus
              />
              <span className="input-unit-tag">{unit}</span>
            </div>
            <span className="field-helper">
              When stock drops to or below this level, an automated reorder suggestion is generated.
            </span>
          </div>

          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label className="field-label">Safety / Minimum Buffer Stock ({unit})</label>
            <div className="input-with-unit">
              <input
                type="number"
                step="any"
                min="0"
                className="form-input"
                placeholder="e.g. 5"
                value={minStockUnits}
                onChange={(e) => setMinStockUnits(e.target.value)}
              />
              <span className="input-unit-tag">{unit}</span>
            </div>
            <span className="field-helper">Critical threshold below which the item is flagged as urgently needing replenishment.</span>
          </div>

          <div className="form-group" style={{ marginBottom: '1.25rem' }}>
            <label className="field-label">Preferred Supplier</label>
            <select
              className="form-input select"
              value={preferredSupplierId}
              onChange={(e) => setPreferredSupplierId(e.target.value)}
            >
              <option value="">-- No Preferred Supplier Linked --</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.phone ? `(${s.phone})` : ''}
                </option>
              ))}
            </select>
            <span className="field-helper">
              Link this item to a supplier for instant 1-click purchase order creation.
            </span>
          </div>

          <div className="modal-actions-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
