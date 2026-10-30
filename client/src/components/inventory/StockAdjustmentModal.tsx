import React, { useState, useEffect } from 'react';
import type { Item, Role } from '../../api.ts';
import { adjustStock, can } from '../../api.ts';
import {
  SlidersIcon,
  LockIcon,
  AlertTriangleIcon,
  XIcon,
  PlusIcon,
  MinusIcon,
  ClipboardCheckIcon,
} from './InventoryIcons.tsx';

interface StockAdjustmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (resultingStockMilli: number, itemName: string) => void;
  items: Item[];
  preselectedItem?: Item | null;
  userRole?: Role;
  allowNegativeStock?: boolean;
}

export const StockAdjustmentModal: React.FC<StockAdjustmentModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  items,
  preselectedItem,
  userRole,
  allowNegativeStock = false,
}) => {
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [adjustmentType, setAdjustmentType] = useState<'quantity' | 'physical_count'>('quantity');
  const [qtyInput, setQtyInput] = useState<string>('');
  const [reason, setReason] = useState<string>('correction');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState<boolean>(false);

  useEffect(() => {
    if (preselectedItem) {
      setSelectedItemId(preselectedItem.id);
      setSearchQuery(preselectedItem.name);
    } else {
      setSelectedItemId('');
      setSearchQuery('');
    }
    setAdjustmentType('quantity');
    setQtyInput('');
    setReason('correction');
    setNotes('');
    setError(null);
    setShowConfirm(false);
  }, [isOpen, preselectedItem]);

  if (!isOpen) return null;

  const isAuthorized = can(userRole, 'stock.adjust');
  const selectedItem = items.find((i) => i.id === selectedItemId);
  const currentStockMilli = selectedItem ? selectedItem.currentStockMilli : 0;
  const currentUnits = currentStockMilli / 1000;
  const unit = selectedItem?.unit || 'pcs';

  const enteredUnits = parseFloat(qtyInput) || 0;
  const enteredMilli = Math.round(enteredUnits * 1000);

  let newStockMilli = currentStockMilli;
  let changeMilli = 0;

  if (adjustmentType === 'physical_count') {
    newStockMilli = Math.max(0, enteredMilli);
    changeMilli = newStockMilli - currentStockMilli;
  } else {
    changeMilli = enteredMilli;
    newStockMilli = currentStockMilli + changeMilli;
  }

  const newUnits = newStockMilli / 1000;
  const changeUnits = changeMilli / 1000;
  const willBeNegative = newStockMilli < 0;

  // Filter items for searchable dropdown
  const filteredItems = items.filter(
    (i) =>
      i.active !== false &&
      (i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (i.sku && i.sku.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (i.barcode && i.barcode.toLowerCase().includes(searchQuery.toLowerCase()))),
  );

  const handleValidateAndPromptConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isAuthorized) {
      setError('You do not have permission to perform stock adjustments. Ask a store manager or owner.');
      return;
    }

    if (!selectedItemId) {
      setError('Please select a product to adjust.');
      return;
    }

    if (qtyInput === '' || isNaN(enteredUnits)) {
      setError('Please enter a valid quantity.');
      return;
    }

    if (changeMilli === 0) {
      setError('Adjustment amount cannot be zero (counted stock already matches system stock).');
      return;
    }

    if (willBeNegative && !allowNegativeStock) {
      setError(`Adjustment would cause negative stock (${newUnits} ${unit}), which is forbidden by store policy.`);
      return;
    }

    setShowConfirm(true);
  };

  const handleConfirmSubmit = async () => {
    if (!selectedItem) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const payload: any = {
        itemId: selectedItem.id,
        adjustmentType,
        reason,
        notes: notes.trim(),
      };

      if (adjustmentType === 'physical_count') {
        payload.newQtyMilli = newStockMilli;
      } else {
        payload.changeQtyMilli = changeMilli;
      }

      const res = await adjustStock(payload);
      setIsSubmitting(false);
      setShowConfirm(false);
      onSuccess(res.resultingStockMilli, selectedItem.name);
      onClose();
    } catch (err: any) {
      setIsSubmitting(false);
      setError(err?.message || 'Failed to record stock adjustment. Please check inputs and retry.');
    }
  };

  return (
    <div className="modal-overlay modal-backdrop" onClick={onClose} style={{ zIndex: 10000 }}>
      <div
        className="modal-content inventory-modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '580px', width: '92%' }}
      >
        <div className="modal-header">
          <div className="modal-title-wrap">
            <span className="modal-icon-badge purple"><SlidersIcon size={20} /></span>
            <div>
              <h2 className="modal-title">Manual Stock Adjustment</h2>
              <p className="modal-subtitle">Record damaged, expired, missing or counted variance</p>
            </div>
          </div>
          <button type="button" className="btn-close-modal" onClick={onClose} aria-label="Close modal">
            <XIcon size={18} />
          </button>
        </div>

        {!isAuthorized ? (
          <div className="permission-warning-banner" style={{ margin: '1.5rem', padding: '1.25rem' }}>
            <span className="warning-icon"><LockIcon size={20} /></span>
            <div>
              <h4 style={{ margin: '0 0 0.25rem 0', color: '#991b1b' }}>Access Restricted</h4>
              <p style={{ margin: 0, fontSize: '0.88rem', color: '#7f1d1d' }}>
                Cashiers cannot perform direct inventory adjustments. Only owners and managers are permitted to modify
                stock positions.
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleValidateAndPromptConfirm} className="modal-form-body">
            {error && (
              <div className="form-error-alert" style={{ marginBottom: '1rem' }}>
                <span className="error-icon"><AlertTriangleIcon size={16} /></span>
                <span>{error}</span>
              </div>
            )}

            {/* Product Selection */}
            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <label className="field-label required">Select Product</label>
              {!preselectedItem ? (
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Search product by name, barcode, or SKU..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setSelectedItemId('');
                    }}
                  />
                  {searchQuery && !selectedItemId && filteredItems.length > 0 && (
                    <div className="product-search-dropdown-list">
                      {filteredItems.slice(0, 8).map((it) => (
                        <div
                          key={it.id}
                          className="search-item-row"
                          onClick={() => {
                            setSelectedItemId(it.id);
                            setSearchQuery(it.name);
                          }}
                        >
                          <div style={{ fontWeight: 600 }}>{it.name}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            Current: {(it.currentStockMilli / 1000).toFixed(1)} {it.unit}
                            {it.barcode ? ` • Barcode: ${it.barcode}` : ''}
                            {it.sku ? ` • SKU: ${it.sku}` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="selected-item-pill-card">
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1rem' }}>{selectedItem?.name}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {selectedItem?.sku ? `SKU: ${selectedItem.sku} • ` : ''}
                      {selectedItem?.barcode ? `Barcode: ${selectedItem.barcode} • ` : ''}
                      Category: {selectedItem?.category || 'General'}
                    </div>
                  </div>
                  <div className="item-stock-stat-badge">
                    <span className="badge-lbl">Current Stock</span>
                    <span className="badge-val">
                      {currentUnits.toFixed(1)} {unit}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {selectedItem && (
              <>
                {/* Current Stock Banner */}
                <div className="current-stock-info-banner">
                  <div className="info-stat">
                    <span className="stat-label">System Stock Balance</span>
                    <span className="stat-number">
                      {currentUnits.toFixed(1)} <small>{unit}</small>
                    </span>
                  </div>
                  <div className="info-stat">
                    <span className="stat-label">Stock Status</span>
                    <span
                      className={`status-pill ${
                        currentUnits <= 0 ? 'red' : currentUnits <= (selectedItem.reorderMilli || 0) / 1000 ? 'amber' : 'green'
                      }`}
                    >
                      {currentUnits <= 0
                        ? 'Out of Stock'
                        : currentUnits <= (selectedItem.reorderMilli || 0) / 1000
                        ? 'Low Stock'
                        : 'In Stock'}
                    </span>
                  </div>
                </div>

                {/* Adjustment Mode Switcher */}
                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label className="field-label">Adjustment Mode</label>
                  <div className="mode-segmented-control">
                    <button
                      type="button"
                      className={`segment-btn ${adjustmentType === 'quantity' ? 'active' : ''}`}
                      onClick={() => setAdjustmentType('quantity')}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <PlusIcon size={13} />
                        <MinusIcon size={13} />
                        Delta Adjustment
                      </span>
                      <small>Add or deduct quantity</small>
                    </button>
                    <button
                      type="button"
                      className={`segment-btn ${adjustmentType === 'physical_count' ? 'active' : ''}`}
                      onClick={() => setAdjustmentType('physical_count')}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                        <ClipboardCheckIcon size={14} />
                        Physical Counted Quantity
                      </span>
                      <small>Set final stock count</small>
                    </button>
                  </div>
                </div>

                {/* Quantity Input */}
                <div className="form-row-2col" style={{ marginBottom: '1rem' }}>
                  <div className="form-group">
                    <label className="field-label required">
                      {adjustmentType === 'quantity' ? 'Adjustment Quantity (+/-)' : 'Actual Physical Count'}
                    </label>
                    <div className="input-with-unit">
                      <input
                        type="number"
                        step="any"
                        className="form-input"
                        placeholder={adjustmentType === 'quantity' ? 'e.g. -2 for damage, +5 for found' : 'e.g. 24'}
                        value={qtyInput}
                        onChange={(e) => setQtyInput(e.target.value)}
                        required
                        autoFocus
                      />
                      <span className="input-unit-tag">{unit}</span>
                    </div>
                    <span className="field-helper">
                      {adjustmentType === 'quantity'
                        ? 'Use negative numbers (e.g. -5) for lost/damaged stock'
                        : 'Enter the exact quantity counted on the shelf'}
                    </span>
                  </div>

                  <div className="form-group">
                    <label className="field-label required">Reason for Adjustment</label>
                    <select
                      className="form-input select"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      required
                    >
                      <option value="correction">Stock Count Correction</option>
                      <option value="damaged">Damaged / Breakage</option>
                      <option value="expired">Expired / Past Date</option>
                      <option value="missing">Missing / Shrinkage / Theft</option>
                      <option value="found">Found / Unrecorded Stock</option>
                      <option value="other">Other Adjustment</option>
                    </select>
                  </div>
                </div>

                {/* Change Preview Box */}
                {qtyInput !== '' && !isNaN(enteredUnits) && (
                  <div className={`adjustment-preview-box ${willBeNegative ? 'negative-alert' : ''}`}>
                    <div className="preview-flow">
                      <div className="preview-step">
                        <span className="step-lbl">Current</span>
                        <span className="step-val">{currentUnits.toFixed(1)}</span>
                      </div>
                      <div className="preview-arrow">
                        {changeMilli >= 0 ? `+${changeUnits.toFixed(1)}` : `${changeUnits.toFixed(1)}`}
                      </div>
                      <div className="preview-step highlight">
                        <span className="step-lbl">Resulting Stock</span>
                        <span className={`step-val ${willBeNegative ? 'text-red' : 'text-purple'}`}>
                          {newUnits.toFixed(1)} {unit}
                        </span>
                      </div>
                    </div>
                    {willBeNegative && (
                      <div className="negative-warning-text" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <AlertTriangleIcon size={14} /> Store rules do not permit negative stock balances.
                      </div>
                    )}
                  </div>
                )}

                {/* Notes Input */}
                <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                  <label className="field-label">Notes & Audit Memo</label>
                  <textarea
                    className="form-input"
                    rows={2}
                    placeholder="Provide specific notes or inspection reference (optional)..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    maxLength={500}
                  />
                </div>
              </>
            )}

            <div className="modal-actions-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={isSubmitting}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSubmitting || !selectedItem || qtyInput === '' || (willBeNegative && !allowNegativeStock)}
              >
                Review & Save Adjustment
              </button>
            </div>
          </form>
        )}

        {/* Confirmation Dialog Overlay */}
        {showConfirm && selectedItem && (
          <div className="sub-modal-backdrop">
            <div className="confirm-modal-box">
              <div className="confirm-icon-wrap amber"><AlertTriangleIcon size={24} /></div>
              <h3 className="confirm-title">Confirm Stock Adjustment</h3>
              <p className="confirm-desc">
                You are about to record a permanent stock movement for <strong>{selectedItem.name}</strong>.
              </p>

              <div className="confirm-summary-list">
                <div className="summary-row">
                  <span>Current Balance:</span>
                  <strong>
                    {currentUnits.toFixed(1)} {unit}
                  </strong>
                </div>
                <div className="summary-row">
                  <span>Adjustment:</span>
                  <strong style={{ color: changeMilli >= 0 ? '#10b981' : '#f43f5e' }}>
                    {changeMilli >= 0 ? `+${changeUnits.toFixed(1)}` : `${changeUnits.toFixed(1)}`} {unit}
                  </strong>
                </div>
                <div className="summary-row highlight">
                  <span>New Balance:</span>
                  <strong>
                    {newUnits.toFixed(1)} {unit}
                  </strong>
                </div>
                <div className="summary-row">
                  <span>Reason:</span>
                  <span className="reason-tag">{reason.toUpperCase()}</span>
                </div>
              </div>

              <div className="confirm-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowConfirm(false)}
                  disabled={isSubmitting}
                >
                  Go Back
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleConfirmSubmit}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Saving Movement...' : 'Yes, Apply Adjustment'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
