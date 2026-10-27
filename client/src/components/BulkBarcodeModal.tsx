import React, { useState, useEffect, useMemo, useRef } from 'react';
import { type Item } from '../api';
import { renderBarcodeSvg } from '../../../shared/bulkImport.ts';

export interface LabelSizeOption {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  isThermal: boolean;
}

export const BULK_LABEL_SIZES: LabelSizeOption[] = [
  { id: 'thermal-50-25', name: 'Thermal roll — 50 × 25 mm (Standard)', widthMm: 50, heightMm: 25, isThermal: true },
  { id: 'small-40-20', name: 'Small label — 40 × 20 mm', widthMm: 40, heightMm: 20, isThermal: true },
  { id: 'standard-50-30', name: 'Standard label — 50 × 30 mm', widthMm: 50, heightMm: 30, isThermal: true },
  { id: 'large-60-40', name: 'Large label — 60 × 40 mm', widthMm: 60, heightMm: 40, isThermal: true },
  { id: 'sheet-a4', name: 'A4 / Sheet Sticker Grid (62 × 40 mm)', widthMm: 62, heightMm: 40, isThermal: false },
];

export interface BulkBarcodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: Item[];
  shopName?: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const formatPrice = (paise?: number | null) => {
  if (paise == null) return '';
  return '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export function BulkBarcodeModal({ isOpen, onClose, items, shopName }: BulkBarcodeModalProps) {
  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  // Selection & custom quantity map: { [itemId]: quantity }
  const [selectedMap, setSelectedMap] = useState<Record<string, number>>({});

  // Label configuration
  const [selectedSizeId, setSelectedSizeId] = useState<string>('thermal-50-25');
  const [showProductName, setShowProductName] = useState<boolean>(true);
  const [showPrice, setShowPrice] = useState<boolean>(true);
  const [showShopName, setShowShopName] = useState<boolean>(false);
  const [showBarcodeNumber, setShowBarcodeNumber] = useState<boolean>(true);
  const [showSku, setShowSku] = useState<boolean>(true);

  // Active view tab: 'select' | 'preview'
  const [activeTab, setActiveTab] = useState<'select' | 'preview'>('select');
  const [validationError, setValidationError] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Reset search and tab when reopened
  useEffect(() => {
    if (isOpen) {
      setValidationError(null);
    }
  }, [isOpen]);

  // Unique categories for filtering
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const it of items) {
      if (it.category) set.add(it.category);
    }
    return Array.from(set).sort();
  }, [items]);

  // Filtered available items for the picker list
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((it) => {
      const matchesQ =
        !q ||
        it.name.toLowerCase().includes(q) ||
        (it.sku && it.sku.toLowerCase().includes(q)) ||
        (it.barcode && it.barcode.toLowerCase().includes(q)) ||
        (it.category && it.category.toLowerCase().includes(q));
      const matchesCat = categoryFilter === 'ALL' || it.category === categoryFilter;
      return matchesQ && matchesCat;
    });
  }, [items, searchQuery, categoryFilter]);

  // Lookup map for fast access
  const itemsById = useMemo(() => {
    const map = new Map<string, Item>();
    for (const it of items) map.set(it.id, it);
    return map;
  }, [items]);

  // Selected products list with their quantities
  const selectedEntries = useMemo(() => {
    const entries: Array<{ item: Item; quantity: number }> = [];
    for (const [id, qty] of Object.entries(selectedMap)) {
      const it = itemsById.get(id);
      if (it && qty > 0) {
        entries.push({ item: it, quantity: qty });
      }
    }
    return entries;
  }, [selectedMap, itemsById]);

  // Total label count across all selected products
  const totalLabels = useMemo(() => {
    return selectedEntries.reduce((sum, entry) => sum + entry.quantity, 0);
  }, [selectedEntries]);

  // Flattened array of labels for preview & print
  const flatLabels = useMemo(() => {
    const list: Item[] = [];
    for (const entry of selectedEntries) {
      for (let i = 0; i < entry.quantity; i++) {
        list.push(entry.item);
      }
    }
    return list;
  }, [selectedEntries]);

  if (!isOpen) return null;

  const currentSize = BULK_LABEL_SIZES.find((s) => s.id === selectedSizeId) || BULK_LABEL_SIZES[0];

  // Handlers
  const handleToggleItem = (item: Item) => {
    setValidationError(null);
    const barcodeTrim = (item.barcode || '').trim();
    if (!barcodeTrim) {
      setValidationError(`"${item.name}" has no barcode assigned. It cannot be printed until a barcode is added.`);
      return;
    }

    setSelectedMap((prev) => {
      const next = { ...prev };
      if (next[item.id]) {
        delete next[item.id];
      } else {
        next[item.id] = 1; // Default 1 copy upon initial selection
      }
      return next;
    });
  };

  const handleSetQuantity = (itemId: string, rawVal: number | string) => {
    setValidationError(null);
    const val = typeof rawVal === 'string' ? parseInt(rawVal, 10) : rawVal;
    if (isNaN(val)) return;
    const clamped = Math.max(1, Math.min(val, 500));
    setSelectedMap((prev) => ({
      ...prev,
      [itemId]: clamped,
    }));
  };

  const handleAdjustQuantity = (itemId: string, delta: number) => {
    setValidationError(null);
    setSelectedMap((prev) => {
      const current = prev[itemId] || 1;
      const next = Math.max(1, Math.min(current + delta, 500));
      return { ...prev, [itemId]: next };
    });
  };

  const handleRemoveItem = (itemId: string) => {
    setValidationError(null);
    setSelectedMap((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    setValidationError(null);
    const validInFilter = filteredItems.filter((it) => it.barcode && it.barcode.trim());
    if (validInFilter.length === 0) {
      setValidationError('None of the products in the current filter have barcodes assigned.');
      return;
    }
    setSelectedMap((prev) => {
      const next = { ...prev };
      for (const it of validInFilter) {
        if (!next[it.id]) next[it.id] = 1;
      }
      return next;
    });
  };

  const handleClearSelection = () => {
    setSelectedMap({});
    setValidationError(null);
  };

  const handleSetAllQuantities = (qty: number) => {
    setValidationError(null);
    setSelectedMap((prev) => {
      const next: Record<string, number> = {};
      for (const id of Object.keys(prev)) {
        next[id] = Math.max(1, Math.min(qty, 500));
      }
      return next;
    });
  };

  const handlePrint = () => {
    setValidationError(null);
    if (selectedEntries.length === 0) {
      setValidationError('Please select at least one product with a valid barcode to print.');
      return;
    }
    if (totalLabels <= 0) {
      setValidationError('Total label quantity must be at least 1.');
      return;
    }

    // Verify all selected products have barcodes
    for (const entry of selectedEntries) {
      const b = (entry.item.barcode || '').trim();
      if (!b) {
        setValidationError(`Cannot print: Product "${entry.item.name}" is missing a barcode.`);
        return;
      }
      if (entry.quantity <= 0) {
        setValidationError(`Invalid quantity for "${entry.item.name}". Please enter 1 or more.`);
        return;
      }
    }

    const isThermal = currentSize.isThermal;
    const widthMm = currentSize.widthMm;
    const heightMm = currentSize.heightMm;

    // Build print HTML
    let bodyContent = '';
    if (isThermal) {
      // Thermal roll continuous pages
      bodyContent = flatLabels
        .map((item) => {
          const barcodeTrim = item.barcode!.trim();
          const svgMarkup = renderBarcodeSvg(barcodeTrim, false);
          return `
            <div class="print-label-page">
              ${showShopName && shopName ? `<div class="label-shop">${escapeHtml(shopName)}</div>` : ''}
              ${showProductName ? `<div class="label-name">${escapeHtml(item.name)}</div>` : ''}
              ${showSku && item.sku ? `<div class="label-sku">SKU: ${escapeHtml(item.sku)}</div>` : ''}
              <div class="label-barcode-svg">${svgMarkup}</div>
              ${showBarcodeNumber ? `<div class="label-barcode-num">${escapeHtml(barcodeTrim)}</div>` : ''}
              ${showPrice && item.priceMinor != null ? `<div class="label-price">${formatPrice(item.priceMinor)}</div>` : ''}
            </div>
          `;
        })
        .join('');
    } else {
      // Sheet grid layout
      const cardsHtml = flatLabels
        .map((item) => {
          const barcodeTrim = item.barcode!.trim();
          const svgMarkup = renderBarcodeSvg(barcodeTrim, false);
          return `
            <div class="label-card">
              ${showShopName && shopName ? `<div class="label-shop">${escapeHtml(shopName)}</div>` : ''}
              <div class="label-name">${escapeHtml(item.name)}</div>
              ${showSku && item.sku ? `<div class="label-sku">SKU: ${escapeHtml(item.sku)}</div>` : ''}
              <div class="label-barcode-svg">${svgMarkup}</div>
              ${showBarcodeNumber ? `<div class="label-barcode-num">${escapeHtml(barcodeTrim)}</div>` : ''}
              ${showPrice && item.priceMinor != null ? `<div class="label-price">${formatPrice(item.priceMinor)}</div>` : ''}
            </div>
          `;
        })
        .join('');
      bodyContent = `<div class="sheet-container">${cardsHtml}</div>`;
    }

    let iframe = document.getElementById('bulk-barcode-print-iframe') as HTMLIFrameElement | null;
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = 'bulk-barcode-print-iframe';
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.style.visibility = 'hidden';
      document.body.appendChild(iframe);
    }

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      alert('Unable to open print frame. Please check browser print permissions.');
      return;
    }

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Bulk Print Barcode Labels (${totalLabels} labels)</title>
          <style>
            @page {
              size: ${isThermal ? `${widthMm}mm ${heightMm}mm` : 'auto'};
              margin: ${isThermal ? '0' : '6mm'};
            }
            * {
              box-sizing: border-box;
              margin: 0;
              padding: 0;
            }
            html, body {
              width: 100%;
              background: #ffffff !important;
              color: #000000 !important;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            }
            ${
              isThermal
                ? `
            .print-label-page {
              width: ${widthMm}mm;
              height: ${heightMm}mm;
              page-break-after: always;
              break-after: page;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              text-align: center;
              padding: 1.5mm 2mm;
              overflow: hidden;
              background: #ffffff !important;
            }
            .print-label-page:last-child {
              page-break-after: auto;
              break-after: auto;
            }
            `
                : `
            .sheet-container {
              display: flex;
              flex-wrap: wrap;
              gap: 5mm;
              justify-content: flex-start;
              align-items: flex-start;
              padding: 4mm;
            }
            .label-card {
              width: 62mm;
              min-height: 38mm;
              border: 1px dashed #cbd5e1;
              border-radius: 4px;
              padding: 2.5mm 3.5mm;
              text-align: center;
              page-break-inside: avoid;
              break-inside: avoid;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              background: #ffffff !important;
            }
            `
            }
            .label-shop {
              font-size: 6pt;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              color: #475569;
              margin-bottom: 0.5mm;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              max-width: 95%;
            }
            .label-name {
              font-size: 7.5pt;
              font-weight: 800;
              color: #000000;
              line-height: 1.15;
              max-height: 4.5mm;
              overflow: hidden;
              text-overflow: ellipsis;
              margin-bottom: 0.5mm;
              max-width: 95%;
            }
            .label-sku {
              font-family: monospace;
              font-size: 5.5pt;
              font-weight: 600;
              color: #334155;
              margin-bottom: 0.5mm;
            }
            .label-barcode-svg {
              width: 92%;
              display: flex;
              justify-content: center;
              align-items: center;
              margin: 0.5mm 0;
            }
            .label-barcode-svg svg {
              width: 100%;
              max-height: 11mm;
              display: block;
            }
            .label-barcode-num {
              font-family: monospace;
              font-size: 6.5pt;
              font-weight: 800;
              letter-spacing: 0.8px;
              color: #000000;
              margin-top: 0.5mm;
            }
            .label-price {
              font-size: 8.5pt;
              font-weight: 900;
              color: #000000;
              margin-top: 0.5mm;
            }
          </style>
        </head>
        <body>
          ${bodyContent}
        </body>
      </html>
    `);
    doc.close();

    setTimeout(() => {
      try {
        iframe?.contentWindow?.focus();
        iframe?.contentWindow?.print();
      } catch (err) {
        console.error('Print iframe trigger failed, falling back:', err);
        window.print();
      }
    }, 250);
  };

  return (
    <div
      className="modal-backdrop"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        padding: '1rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="bulk-barcode-dialog"
        style={{
          background: '#ffffff',
          borderRadius: '14px',
          maxWidth: '960px',
          width: '100%',
          maxHeight: '92vh',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.3)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          animation: 'modalScale 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* MODAL HEADER */}
        <div
          style={{
            padding: '1.1rem 1.4rem',
            borderBottom: '1px solid #e2e8f0',
            background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.6rem' }}>🏷️</span>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>
                  Bulk Barcode Label Printing
                </h3>
                {totalLabels > 0 && (
                  <span
                    style={{
                      background: '#2563eb',
                      color: '#ffffff',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      padding: '0.2rem 0.6rem',
                      borderRadius: '999px',
                      letterSpacing: '0.3px',
                    }}
                  >
                    {totalLabels} {totalLabels === 1 ? 'label' : 'labels'} ({selectedEntries.length} {selectedEntries.length === 1 ? 'product' : 'products'})
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '2px' }}>
                Select multiple products, set custom label quantities for each, preview, and print together
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {/* TAB SELECTOR */}
            <div
              style={{
                display: 'inline-flex',
                background: '#e2e8f0',
                borderRadius: '8px',
                padding: '3px',
                gap: '2px',
              }}
            >
              <button
                type="button"
                onClick={() => setActiveTab('select')}
                style={{
                  border: 'none',
                  background: activeTab === 'select' ? '#ffffff' : 'transparent',
                  color: activeTab === 'select' ? '#0f172a' : '#64748b',
                  fontWeight: activeTab === 'select' ? 700 : 500,
                  padding: '0.35rem 0.8rem',
                  fontSize: '0.82rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  boxShadow: activeTab === 'select' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                📋 Select & Quantities ({selectedEntries.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  if (selectedEntries.length === 0) {
                    setValidationError('Select at least one product first to preview labels.');
                    return;
                  }
                  setActiveTab('preview');
                }}
                style={{
                  border: 'none',
                  background: activeTab === 'preview' ? '#ffffff' : 'transparent',
                  color: activeTab === 'preview' ? '#0f172a' : '#64748b',
                  fontWeight: activeTab === 'preview' ? 700 : 500,
                  padding: '0.35rem 0.8rem',
                  fontSize: '0.82rem',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  boxShadow: activeTab === 'preview' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                👁️ Preview ({totalLabels})
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              style={{
                border: 'none',
                background: '#e2e8f0',
                color: '#475569',
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                fontSize: '1rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
              }}
              title="Close modal (Esc)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* VALIDATION ALERT */}
        {validationError && (
          <div
            style={{
              padding: '0.65rem 1.25rem',
              background: '#fef2f2',
              borderBottom: '1px solid #fee2e2',
              color: '#991b1b',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>⚠️</span>
              <span>{validationError}</span>
            </div>
            <button
              type="button"
              onClick={() => setValidationError(null)}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#991b1b',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              ✕
            </button>
          </div>
        )}

        {/* LABEL CONFIGURATION BAR */}
        <div
          style={{
            padding: '0.65rem 1.4rem',
            background: '#ffffff',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '0.75rem',
            fontSize: '0.82rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontWeight: 700, color: '#334155' }}>Label Format:</span>
            <select
              className="form-input"
              value={selectedSizeId}
              onChange={(e) => setSelectedSizeId(e.target.value)}
              style={{
                padding: '0.35rem 0.65rem',
                fontSize: '0.82rem',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontWeight: 600,
              }}
            >
              {BULK_LABEL_SIZES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', color: '#334155', fontWeight: 500 }}>
              <input type="checkbox" checked={showProductName} onChange={(e) => setShowProductName(e.target.checked)} />
              Name
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', color: '#334155', fontWeight: 500 }}>
              <input type="checkbox" checked={showSku} onChange={(e) => setShowSku(e.target.checked)} />
              SKU
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', color: '#334155', fontWeight: 500 }}>
              <input type="checkbox" checked={showBarcodeNumber} onChange={(e) => setShowBarcodeNumber(e.target.checked)} />
              Barcode Digits
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', color: '#334155', fontWeight: 500 }}>
              <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} />
              Price
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', color: '#334155', fontWeight: 500 }}>
              <input type="checkbox" checked={showShopName} onChange={(e) => setShowShopName(e.target.checked)} />
              Store Name
            </label>
          </div>
        </div>

        {/* TAB 1: PRODUCT SELECTION & QUANTITIES */}
        {activeTab === 'select' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.1fr 1fr',
              flex: 1,
              minHeight: '380px',
              maxHeight: 'calc(92vh - 210px)',
              overflow: 'hidden',
            }}
          >
            {/* LEFT PANEL: PRODUCT SEARCH & AVAILABLE ITEMS */}
            <div
              style={{
                borderRight: '1px solid #e2e8f0',
                display: 'flex',
                flexDirection: 'column',
                background: '#f8fafc',
                overflow: 'hidden',
              }}
            >
              {/* Search Toolbar */}
              <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', background: '#ffffff', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Search products by name, SKU, barcode..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ flex: 1, padding: '0.45rem 0.75rem', fontSize: '0.85rem' }}
                  />
                  <select
                    className="form-input"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    style={{ width: '130px', padding: '0.45rem 0.5rem', fontSize: '0.82rem' }}
                  >
                    <option value="ALL">All Categories</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.78rem', color: '#64748b' }}>
                  <span>
                    Showing {filteredItems.length} products ({filteredItems.filter((it) => it.barcode && it.barcode.trim()).length} printable with barcode)
                  </span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={handleSelectAllFiltered}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#2563eb',
                        fontWeight: 600,
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: '0.78rem',
                      }}
                    >
                      + Select All Valid
                    </button>
                  </div>
                </div>
              </div>

              {/* Items List */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
                {filteredItems.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: '#94a3b8' }}>
                    <div style={{ fontSize: '1.5rem', marginBottom: '0.4rem' }}>🔍</div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>No products match your search</div>
                    <div style={{ fontSize: '0.8rem', marginTop: '4px' }}>Try searching with a different name or SKU</div>
                  </div>
                ) : (
                  filteredItems.map((item) => {
                    const isSelected = Boolean(selectedMap[item.id]);
                    const hasBarcode = Boolean(item.barcode && item.barcode.trim());
                    return (
                      <div
                        key={item.id}
                        onClick={() => {
                          if (hasBarcode) handleToggleItem(item);
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          padding: '0.6rem 0.75rem',
                          borderRadius: '8px',
                          marginBottom: '4px',
                          background: isSelected ? '#eff6ff' : '#ffffff',
                          border: isSelected ? '1px solid #bfdbfe' : '1px solid #e2e8f0',
                          cursor: hasBarcode ? 'pointer' : 'not-allowed',
                          opacity: hasBarcode ? 1 : 0.65,
                          transition: 'all 0.12s ease',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={!hasBarcode}
                          onChange={() => handleToggleItem(item)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ width: '16px', height: '16px', cursor: hasBarcode ? 'pointer' : 'not-allowed' }}
                        />

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', justifyContent: 'space-between' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {item.name}
                            </span>
                            {item.priceMinor != null && (
                              <span style={{ fontWeight: 800, fontSize: '0.85rem', color: '#047857' }}>
                                {formatPrice(item.priceMinor)}
                              </span>
                            )}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '2px', fontSize: '0.75rem', color: '#64748b' }}>
                            {item.sku && <span>SKU: <strong style={{ color: '#334155' }}>{item.sku}</strong></span>}
                            {item.category && <span style={{ color: '#94a3b8' }}>• {item.category}</span>}
                          </div>

                          <div style={{ marginTop: '3px', fontSize: '0.75rem' }}>
                            {hasBarcode ? (
                              <span style={{ fontFamily: 'monospace', color: '#2563eb', fontWeight: 600 }}>
                                ❚❚❚ {item.barcode}
                              </span>
                            ) : (
                              <span style={{ color: '#dc2626', fontWeight: 600, background: '#fef2f2', padding: '1px 6px', borderRadius: '4px' }}>
                                ⚠️ No barcode assigned (cannot print)
                              </span>
                            )}
                          </div>
                        </div>

                        {isSelected && (
                          <div
                            style={{
                              background: '#2563eb',
                              color: '#ffffff',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: '999px',
                            }}
                          >
                            ×{selectedMap[item.id] || 1}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* RIGHT PANEL: SELECTED PRODUCTS & INDEPENDENT QUANTITIES */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                background: '#ffffff',
                overflow: 'hidden',
              }}
            >
              {/* Selected List Header */}
              <div
                style={{
                  padding: '0.75rem 1rem',
                  borderBottom: '1px solid #e2e8f0',
                  background: '#f8fafc',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0f172a' }}>
                    Selected Products for Printing
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
                    Enter the label quantity for each item
                  </div>
                </div>

                {selectedEntries.length > 0 && (
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={() => handleSetAllQuantities(1)}
                      style={{
                        background: '#f1f5f9',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        padding: '2px 6px',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        color: '#334155',
                      }}
                      title="Set all selected to 1 label each"
                    >
                      All = 1
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSetAllQuantities(5)}
                      style={{
                        background: '#f1f5f9',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        padding: '2px 6px',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        color: '#334155',
                      }}
                      title="Set all selected to 5 labels each"
                    >
                      All = 5
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSetAllQuantities(10)}
                      style={{
                        background: '#f1f5f9',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        padding: '2px 6px',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        color: '#334155',
                      }}
                      title="Set all selected to 10 labels each"
                    >
                      All = 10
                    </button>
                    <button
                      type="button"
                      onClick={handleClearSelection}
                      style={{
                        background: '#fee2e2',
                        border: '1px solid #fca5a5',
                        color: '#991b1b',
                        borderRadius: '6px',
                        padding: '2px 8px',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                      title="Remove all selected products"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>

              {/* Selected List Items */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem' }}>
                {selectedEntries.length === 0 ? (
                  <div
                    style={{
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      textAlign: 'center',
                      padding: '2rem 1.5rem',
                      color: '#94a3b8',
                    }}
                  >
                    <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>👈</div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#475569' }}>
                      No products selected yet
                    </div>
                    <div style={{ fontSize: '0.82rem', color: '#64748b', maxWidth: '280px', marginTop: '6px', lineHeight: 1.4 }}>
                      Check items on the left list to add them here and set custom label quantities for each.
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {selectedEntries.map(({ item, quantity }, idx) => (
                      <div
                        key={item.id}
                        style={{
                          background: '#ffffff',
                          border: '1px solid #cbd5e1',
                          borderRadius: '8px',
                          padding: '0.65rem 0.85rem',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.75rem',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                        }}
                      >
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', width: '18px' }}>
                          #{idx + 1}
                        </span>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {item.name}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', marginTop: '2px' }}>
                            {item.sku && (
                              <span style={{ color: '#475569' }}>
                                SKU: <strong>{item.sku}</strong>
                              </span>
                            )}
                            <span style={{ fontFamily: 'monospace', color: '#2563eb', fontWeight: 600 }}>
                              {item.barcode}
                            </span>
                            {item.priceMinor != null && (
                              <span style={{ color: '#047857', fontWeight: 700 }}>
                                {formatPrice(item.priceMinor)}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* QUANTITY CONTROL */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <button
                            type="button"
                            onClick={() => handleAdjustQuantity(item.id, -1)}
                            disabled={quantity <= 1}
                            style={{
                              width: '26px',
                              height: '26px',
                              border: '1px solid #cbd5e1',
                              background: quantity <= 1 ? '#f1f5f9' : '#ffffff',
                              borderRadius: '6px',
                              cursor: quantity <= 1 ? 'not-allowed' : 'pointer',
                              fontWeight: 700,
                              fontSize: '0.9rem',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#334155',
                            }}
                            title="Decrease quantity by 1"
                          >
                            −
                          </button>

                          <input
                            type="number"
                            min="1"
                            max="500"
                            value={quantity}
                            onChange={(e) => handleSetQuantity(item.id, e.target.value)}
                            style={{
                              width: '54px',
                              height: '26px',
                              textAlign: 'center',
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              fontWeight: 700,
                              fontSize: '0.85rem',
                              color: '#0f172a',
                              background: '#ffffff',
                            }}
                            title="Label quantity for this product"
                          />

                          <button
                            type="button"
                            onClick={() => handleAdjustQuantity(item.id, 1)}
                            disabled={quantity >= 500}
                            style={{
                              width: '26px',
                              height: '26px',
                              border: '1px solid #cbd5e1',
                              background: quantity >= 500 ? '#f1f5f9' : '#ffffff',
                              borderRadius: '6px',
                              cursor: quantity >= 500 ? 'not-allowed' : 'pointer',
                              fontWeight: 700,
                              fontSize: '0.9rem',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#334155',
                            }}
                            title="Increase quantity by 1"
                          >
                            +
                          </button>

                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.id)}
                            style={{
                              marginLeft: '6px',
                              width: '26px',
                              height: '26px',
                              border: 'none',
                              background: 'transparent',
                              color: '#94a3b8',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              fontSize: '0.9rem',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                            title="Remove from print list"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: LIVE PREVIEW */}
        {activeTab === 'preview' && (
          <div
            style={{
              flex: 1,
              minHeight: '380px',
              maxHeight: 'calc(92vh - 210px)',
              overflowY: 'auto',
              background: '#f1f5f9',
              padding: '1.25rem',
            }}
          >
            <div
              style={{
                maxWidth: '850px',
                margin: '0 auto',
                background: '#ffffff',
                borderRadius: '10px',
                border: '1px solid #e2e8f0',
                padding: '1rem',
                boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid #e2e8f0',
                  paddingBottom: '0.75rem',
                  marginBottom: '1rem',
                }}
              >
                <div>
                  <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#0f172a' }}>
                    Label Print Preview ({totalLabels} total labels)
                  </h4>
                  <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
                    Target size: {currentSize.name}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveTab('select')}
                  style={{
                    background: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    padding: '0.35rem 0.75rem',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    color: '#334155',
                  }}
                >
                  ← Edit Quantities
                </button>
              </div>

              {/* Labels Grid Preview */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
                  gap: '12px',
                  maxHeight: '480px',
                  overflowY: 'auto',
                  padding: '4px',
                }}
              >
                {flatLabels.map((item, idx) => {
                  const barcodeTrim = item.barcode!.trim();
                  const svg = renderBarcodeSvg(barcodeTrim, false);
                  return (
                    <div
                      key={`${item.id}-${idx}`}
                      style={{
                        background: '#ffffff',
                        border: '1px dashed #94a3b8',
                        borderRadius: '6px',
                        padding: '8px 10px',
                        textAlign: 'center',
                        position: 'relative',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.03)',
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          top: '3px',
                          left: '5px',
                          fontSize: '0.62rem',
                          fontWeight: 700,
                          color: '#94a3b8',
                        }}
                      >
                        #{idx + 1}
                      </div>

                      {showShopName && shopName && (
                        <div style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', color: '#475569', marginBottom: '2px', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {shopName}
                        </div>
                      )}

                      {showProductName && (
                        <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.2, maxHeight: '28px', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                          {item.name}
                        </div>
                      )}

                      {showSku && item.sku && (
                        <div style={{ fontSize: '0.62rem', fontFamily: 'monospace', color: '#475569', marginTop: '1px' }}>
                          SKU: {item.sku}
                        </div>
                      )}

                      <div
                        style={{
                          width: '100%',
                          maxHeight: '36px',
                          margin: '4px 0 2px 0',
                          display: 'flex',
                          justifyContent: 'center',
                        }}
                        dangerouslySetInnerHTML={{ __html: svg }}
                      />

                      {showBarcodeNumber && (
                        <div style={{ fontFamily: 'monospace', fontSize: '0.7rem', fontWeight: 700, color: '#000000', letterSpacing: '0.5px' }}>
                          {barcodeTrim}
                        </div>
                      )}

                      {showPrice && item.priceMinor != null && (
                        <div style={{ fontSize: '0.82rem', fontWeight: 900, color: '#000000', marginTop: '2px' }}>
                          {formatPrice(item.priceMinor)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* MODAL FOOTER */}
        <div
          style={{
            padding: '0.9rem 1.4rem',
            borderTop: '1px solid #e2e8f0',
            background: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.85rem', color: '#475569' }}>
              <strong>{selectedEntries.length}</strong> {selectedEntries.length === 1 ? 'product' : 'products'} selected • <strong>{totalLabels}</strong> total {totalLabels === 1 ? 'label' : 'labels'}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              style={{
                padding: '0.5rem 1rem',
                fontSize: '0.85rem',
                fontWeight: 600,
                borderRadius: '8px',
              }}
            >
              Cancel
            </button>

            {activeTab === 'select' ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={selectedEntries.length === 0}
                onClick={() => setActiveTab('preview')}
                style={{
                  padding: '0.5rem 1rem',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  borderRadius: '8px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                👁️ Preview Labels ({totalLabels})
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setActiveTab('select')}
                style={{
                  padding: '0.5rem 1rem',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  borderRadius: '8px',
                }}
              >
                ← Back to Selection
              </button>
            )}

            <button
              id="bulk-print-confirm-btn"
              type="button"
              className="btn btn-primary"
              disabled={selectedEntries.length === 0 || totalLabels <= 0}
              onClick={handlePrint}
              style={{
                padding: '0.5rem 1.25rem',
                fontSize: '0.88rem',
                fontWeight: 700,
                borderRadius: '8px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                backgroundColor: selectedEntries.length === 0 ? '#94a3b8' : '#2563eb',
                cursor: selectedEntries.length === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              🖨️ Print {totalLabels > 0 ? `${totalLabels} Labels` : 'Labels'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
