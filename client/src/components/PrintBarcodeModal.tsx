import React, { useState, useEffect, useRef } from 'react';
import { type Item } from '../api';
import { renderBarcodeSvg, isValidEan13 } from '../../../shared/bulkImport.ts';

export interface LabelSizeOption {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  isThermal: boolean;
}

export const LABEL_SIZES: LabelSizeOption[] = [
  { id: 'thermal-50-25', name: 'Thermal roll - 50 × 25 mm', widthMm: 50, heightMm: 25, isThermal: true },
  { id: 'small-40-20', name: 'Small label - 40 × 20 mm', widthMm: 40, heightMm: 20, isThermal: true },
  { id: 'standard-50-30', name: 'Standard label - 50 × 30 mm', widthMm: 50, heightMm: 30, isThermal: true },
  { id: 'large-60-40', name: 'Large label - 60 × 40 mm', widthMm: 60, heightMm: 40, isThermal: true },
  { id: 'custom', name: 'Custom size', widthMm: 50, heightMm: 25, isThermal: true },
];

export interface PrintBarcodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: Item | null;
  shopName?: string;
}

export function PrintBarcodeModal({ isOpen, onClose, item, shopName }: PrintBarcodeModalProps) {
  const [selectedSizeId, setSelectedSizeId] = useState<string>('thermal-50-25');
  const [customWidthMm, setCustomWidthMm] = useState<number>(50);
  const [customHeightMm, setCustomHeightMm] = useState<number>(25);

  const [showProductName, setShowProductName] = useState<boolean>(true);
  const [showPrice, setShowPrice] = useState<boolean>(true);
  const [showShopName, setShowShopName] = useState<boolean>(false);
  const [showBarcodeNumber, setShowBarcodeNumber] = useState<boolean>(true);

  const [copies, setCopies] = useState<number>(1);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);

  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !item) return null;

  const currentSizeOption = LABEL_SIZES.find((s) => s.id === selectedSizeId) || LABEL_SIZES[0];
  const widthMm = selectedSizeId === 'custom' ? customWidthMm : currentSizeOption.widthMm;
  const heightMm = selectedSizeId === 'custom' ? customHeightMm : currentSizeOption.heightMm;

  const barcodeTrim = (item.barcode || '').trim();
  const hasBarcode = Boolean(barcodeTrim);

  const isNumeric1213 = /^\d{12,13}$/.test(barcodeTrim);
  const isInternal = barcodeTrim.startsWith('20') && barcodeTrim.length === 13;
  const isEan = isNumeric1213;

  let barcodeTypeLabel = 'Code 128';
  if (isEan) {
    barcodeTypeLabel = isInternal ? 'EAN-13 (IBC)' : 'EAN-13 (MBC)';
  } else if (barcodeTrim.startsWith('INV-')) {
    barcodeTypeLabel = 'Code 128 (IBC)';
  }

  const barcodeSvgBarsOnly = hasBarcode ? renderBarcodeSvg(barcodeTrim, false) : '';

  const formatPrice = (paise: number = 0) => {
    return '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Proportional sticker dimensions for preview (base width 280px)
  const previewStickerWidth = 280;
  const previewStickerHeight = Math.max(120, Math.min(220, Math.round(280 * (heightMm / widthMm))));

  const handleDownloadPng = async () => {
    if (!hasBarcode || isDownloading) return;
    setIsDownloading(true);

    try {
      const scale = 12; // 12 pixels per mm for high-res 300+ DPI
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(widthMm * scale);
      canvas.height = Math.round(heightMm * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Fill clean white background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Convert SVG to Image
      const svgBlob = new Blob([barcodeSvgBarsOnly], { type: 'image/svg+xml;charset=utf-8' });
      const blobUrl = URL.createObjectURL(svgBlob);
      const barcodeImg = new Image();
      barcodeImg.crossOrigin = 'anonymous';

      await new Promise<void>((resolve) => {
        barcodeImg.onload = () => resolve();
        barcodeImg.onerror = () => resolve();
        barcodeImg.src = blobUrl;
      });
      URL.revokeObjectURL(blobUrl);

      const centerX = canvas.width / 2;
      let curY = Math.round(canvas.height * 0.12);

      // 1. Shop name
      if (showShopName && shopName) {
        ctx.fillStyle = '#475569';
        ctx.font = `bold ${Math.round(canvas.height * 0.08)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(shopName.toUpperCase(), centerX, curY);
        curY += Math.round(canvas.height * 0.09);
      }

      // 2. Product name
      if (showProductName) {
        ctx.fillStyle = '#000000';
        ctx.font = `bold ${Math.round(canvas.height * 0.12)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(item.name, centerX, curY);
        curY += Math.round(canvas.height * 0.08);
      }

      // 3. Barcode image
      const barImgWidth = Math.round(canvas.width * 0.85);
      const barImgHeight = Math.round(canvas.height * 0.36);
      const barImgX = (canvas.width - barImgWidth) / 2;
      ctx.drawImage(barcodeImg, barImgX, curY, barImgWidth, barImgHeight);
      curY += barImgHeight + Math.round(canvas.height * 0.06);

      // 4. Barcode number
      if (showBarcodeNumber) {
        ctx.fillStyle = '#000000';
        ctx.font = `bold ${Math.round(canvas.height * 0.10)}px monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(barcodeTrim, centerX, curY);
        curY += Math.round(canvas.height * 0.11);
      }

      // 5. Selling price
      if (showPrice && item.priceMinor != null) {
        ctx.fillStyle = '#000000';
        ctx.font = `900 ${Math.round(canvas.height * 0.14)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(formatPrice(item.priceMinor), centerX, curY);
      }

      // Trigger download
      const dataUrl = canvas.toDataURL('image/png');
      const downloadLink = document.createElement('a');
      const safeName = item.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
      downloadLink.download = `${safeName}_barcode_${barcodeTrim}.png`;
      downloadLink.href = dataUrl;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
    } catch (err) {
      console.error('Failed to download barcode label PNG:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  const handlePrint = () => {
    if (!hasBarcode) {
      alert('This product does not have a barcode assigned. Please add a barcode before printing.');
      return;
    }

    const safeCopies = Math.max(1, Math.min(copies || 1, 500));

    // Construct single label HTML
    const singleLabelHtml = `
      <div class="print-label-page">
        ${showShopName && shopName ? `<div class="label-shop">${escapeHtml(shopName)}</div>` : ''}
        ${showProductName ? `<div class="label-name">${escapeHtml(item.name)}</div>` : ''}
        <div class="label-barcode-svg">${barcodeSvgBarsOnly}</div>
        ${showBarcodeNumber ? `<div class="label-barcode-num">${escapeHtml(barcodeTrim)}</div>` : ''}
        ${showPrice && item.priceMinor != null ? `<div class="label-price">${formatPrice(item.priceMinor)}</div>` : ''}
      </div>
    `;

    // Repeat for N copies
    const pagesHtml = Array.from({ length: safeCopies }, () => singleLabelHtml).join('');

    let iframe = document.getElementById('barcode-modal-print-iframe') as HTMLIFrameElement | null;
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.id = 'barcode-modal-print-iframe';
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
    if (!doc) return;

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Print Barcode Label - ${escapeHtml(item.name)}</title>
          <style>
            @page {
              size: ${widthMm}mm ${heightMm}mm;
              margin: 0;
            }
            * {
              box-sizing: border-box;
              margin: 0;
              padding: 0;
            }
            html, body {
              width: 100%;
              height: 100%;
              background: #ffffff !important;
              color: #000000 !important;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            }
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
              padding: 1.5mm 2.5mm;
              overflow: hidden;
              background: #ffffff !important;
            }
            .print-label-page:last-child {
              page-break-after: avoid;
              break-after: avoid;
            }
            .label-shop {
              font-size: 7pt;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              color: #475569;
              margin-bottom: 0.5mm;
              max-width: 100%;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            }
            .label-name {
              font-size: 8.5pt;
              font-weight: 800;
              color: #000000;
              line-height: 1.15;
              margin-bottom: 0.8mm;
              max-width: 100%;
              word-break: break-word;
              display: -webkit-box;
              -webkit-line-clamp: 2;
              -webkit-box-orient: vertical;
              overflow: hidden;
            }
            .label-barcode-svg {
              display: flex;
              justify-content: center;
              align-items: center;
              width: 100%;
              margin: 0.5mm 0;
            }
            .label-barcode-svg svg {
              width: ${Math.round(widthMm * 0.82)}mm;
              height: ${Math.round(heightMm * 0.42)}mm;
              display: block;
              shape-rendering: crispEdges;
            }
            .label-barcode-num {
              font-family: "Courier New", Courier, monospace;
              font-size: 8pt;
              font-weight: 700;
              letter-spacing: 1px;
              color: #000000;
              margin-top: 0.5mm;
            }
            .label-price {
              font-size: 10pt;
              font-weight: 900;
              color: #000000;
              margin-top: 0.5mm;
            }
          </style>
        </head>
        <body>
          ${pagesHtml}
        </body>
      </html>
    `);
    doc.close();

    setTimeout(() => {
      try {
        iframe?.contentWindow?.focus();
        iframe?.contentWindow?.print();
      } catch (err) {
        console.error('Print failed in iframe:', err);
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
        backgroundColor: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1050,
        padding: '1rem',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={modalRef}
        className="print-barcode-dialog"
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          maxWidth: '680px',
          width: '100%',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.25)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          animation: 'modalScale 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem 1rem',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.25rem' }}>🖨️</span>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                Print Barcode Label
              </h2>
            </div>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '3px', fontWeight: 500 }}>
              {item.name} • EAN-13 or Code 128, sized for your label stock
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.25rem',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '0.25rem',
              lineHeight: 1,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#0f172a')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
          >
            ✕
          </button>
        </div>

        {/* Modal Body: 2 Columns */}
        <div
          style={{
            padding: '1.5rem',
            display: 'grid',
            gridTemplateColumns: '240px 1fr',
            gap: '1.5rem',
            alignItems: 'start',
          }}
        >
          {/* Left Column: Label Configuration */}
          <div>
            {/* Label size */}
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
                Label size
              </label>
              <select
                className="form-input"
                style={{
                  width: '100%',
                  padding: '0.5rem 0.65rem',
                  fontSize: '0.85rem',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                }}
                value={selectedSizeId}
                onChange={(e) => setSelectedSizeId(e.target.value)}
              >
                {LABEL_SIZES.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.name}
                  </option>
                ))}
              </select>

              {/* Custom size inputs */}
              {selectedSizeId === 'custom' && (
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: '0.72rem', color: '#64748b' }}>W (mm)</span>
                    <input
                      type="number"
                      min="20"
                      max="150"
                      className="form-input"
                      style={{ width: '100%', padding: '0.35rem 0.5rem', fontSize: '0.82rem' }}
                      value={customWidthMm}
                      onChange={(e) => setCustomWidthMm(Math.max(10, parseInt(e.target.value) || 50))}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: '0.72rem', color: '#64748b' }}>H (mm)</span>
                    <input
                      type="number"
                      min="10"
                      max="150"
                      className="form-input"
                      style={{ width: '100%', padding: '0.35rem 0.5rem', fontSize: '0.82rem' }}
                      value={customHeightMm}
                      onChange={(e) => setCustomHeightMm(Math.max(10, parseInt(e.target.value) || 25))}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Show on label checkboxes */}
            <div style={{ marginTop: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: '0.5rem' }}>
                Show on label
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', fontSize: '0.85rem', color: '#1e293b', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showProductName}
                    onChange={(e) => setShowProductName(e.target.checked)}
                    style={{ width: '16px', height: '16px', accentColor: '#6d4aff', cursor: 'pointer' }}
                  />
                  <span>Product name</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', fontSize: '0.85rem', color: '#1e293b', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showPrice}
                    onChange={(e) => setShowPrice(e.target.checked)}
                    style={{ width: '16px', height: '16px', accentColor: '#6d4aff', cursor: 'pointer' }}
                  />
                  <span>Selling price</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', fontSize: '0.85rem', color: '#1e293b', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showShopName}
                    onChange={(e) => setShowShopName(e.target.checked)}
                    style={{ width: '16px', height: '16px', accentColor: '#6d4aff', cursor: 'pointer' }}
                  />
                  <span>Shop name</span>
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', fontSize: '0.85rem', color: '#1e293b', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={showBarcodeNumber}
                    onChange={(e) => setShowBarcodeNumber(e.target.checked)}
                    style={{ width: '16px', height: '16px', accentColor: '#6d4aff', cursor: 'pointer' }}
                  />
                  <span>Barcode number</span>
                </label>
              </div>
            </div>

            {/* Number of labels */}
            <div style={{ marginTop: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
                Number of labels
              </label>
              <input
                type="number"
                min="1"
                max="500"
                className="form-input"
                style={{
                  width: '100%',
                  padding: '0.5rem 0.65rem',
                  fontSize: '0.85rem',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                }}
                value={copies}
                onChange={(e) => setCopies(Math.max(1, parseInt(e.target.value) || 1))}
              />
            </div>
          </div>

          {/* Right Column: Live Preview */}
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155', marginBottom: '0.4rem' }}>
              Preview
            </div>
            <div
              style={{
                background: '#f8fafc',
                borderRadius: '8px',
                border: '1px solid #f1f5f9',
                padding: '1.5rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '210px',
                boxSizing: 'border-box',
              }}
            >
              {hasBarcode ? (
                <div
                  style={{
                    background: '#ffffff',
                    borderRadius: '4px',
                    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.08)',
                    border: '1px solid #e2e8f0',
                    padding: '12px 16px',
                    width: `${previewStickerWidth}px`,
                    minHeight: `${previewStickerHeight}px`,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                    boxSizing: 'border-box',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {/* Shop name (optional) */}
                  {showShopName && (
                    <div
                      style={{
                        fontSize: '10px',
                        fontWeight: 700,
                        color: '#475569',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        marginBottom: '2px',
                      }}
                    >
                      {shopName || 'STORE'}
                    </div>
                  )}

                  {/* Product name */}
                  {showProductName && (
                    <div
                      style={{
                        fontSize: '14px',
                        fontWeight: 800,
                        color: '#000000',
                        textAlign: 'center',
                        lineHeight: 1.2,
                        marginBottom: '4px',
                        maxWidth: '100%',
                        wordBreak: 'break-word',
                      }}
                    >
                      {item.name}
                    </div>
                  )}

                  {/* Barcode bars */}
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      width: '100%',
                      margin: '2px 0',
                    }}
                    dangerouslySetInnerHTML={{ __html: barcodeSvgBarsOnly }}
                  />

                  {/* Barcode number text */}
                  {showBarcodeNumber && (
                    <div
                      style={{
                        fontFamily: 'monospace',
                        fontSize: '13px',
                        fontWeight: 700,
                        letterSpacing: '1px',
                        color: '#000000',
                        textAlign: 'center',
                        marginTop: '3px',
                      }}
                    >
                      {barcodeTrim}
                    </div>
                  )}

                  {/* Selling price */}
                  {showPrice && item.priceMinor != null && (
                    <div
                      style={{
                        fontSize: '17px',
                        fontWeight: 900,
                        color: '#000000',
                        textAlign: 'center',
                        marginTop: '4px',
                      }}
                    >
                      {formatPrice(item.priceMinor)}
                    </div>
                  )}
                </div>
              ) : (
                <div
                  style={{
                    background: '#fff1f2',
                    border: '1px dashed #fda4af',
                    borderRadius: '8px',
                    padding: '1.25rem',
                    textAlign: 'center',
                    color: '#9f1239',
                    maxWidth: '280px',
                  }}
                >
                  <div style={{ fontSize: '1.5rem', marginBottom: '0.35rem' }}>⚠️</div>
                  <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>No Barcode Assigned</div>
                  <div style={{ fontSize: '0.75rem', marginTop: '0.25rem', color: '#be123c' }}>
                    This product does not have a barcode. Please assign a barcode in Edit Product before printing.
                  </div>
                </div>
              )}
            </div>

            {/* Info caption */}
            <div
              style={{
                fontSize: '0.72rem',
                color: '#64748b',
                textAlign: 'center',
                marginTop: '0.75rem',
                fontFamily: 'monospace',
              }}
            >
              {hasBarcode
                ? `Code 128 • ${barcodeTrim} • ${widthMm} × ${heightMm} mm`
                : 'No barcode available'}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '1rem 1.5rem',
            borderTop: '1px solid #f1f5f9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#ffffff',
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            style={{
              padding: '0.45rem 1rem',
              borderRadius: '6px',
              fontWeight: 600,
              fontSize: '0.85rem',
            }}
          >
            Close
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <span style={{ fontSize: '0.85rem', color: '#64748b', marginRight: '0.25rem' }}>
              {copies} {copies === 1 ? 'label' : 'labels'}
            </span>

            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleDownloadPng}
              disabled={!hasBarcode || isDownloading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.45rem 0.9rem',
                borderRadius: '6px',
                fontWeight: 600,
                fontSize: '0.85rem',
                opacity: !hasBarcode ? 0.5 : 1,
                cursor: !hasBarcode ? 'not-allowed' : 'pointer',
              }}
              title="Download previewed label as PNG image"
            >
              <span>📥</span>
              <span>{isDownloading ? 'Generating...' : 'Download PNG'}</span>
            </button>

            <button
              type="button"
              className="btn btn-primary"
              onClick={handlePrint}
              disabled={!hasBarcode}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.45rem 1.1rem',
                borderRadius: '6px',
                fontWeight: 700,
                fontSize: '0.85rem',
                background: !hasBarcode
                  ? '#94a3b8'
                  : 'linear-gradient(135deg, #6d4aff 0%, #5833ea 100%)',
                color: '#ffffff',
                border: 'none',
                boxShadow: !hasBarcode ? 'none' : '0 2px 6px rgba(109, 74, 255, 0.35)',
                opacity: !hasBarcode ? 0.6 : 1,
                cursor: !hasBarcode ? 'not-allowed' : 'pointer',
              }}
              title="Print configured barcode label"
            >
              <span>🖨️</span>
              <span>Print {copies} {copies === 1 ? 'Label' : 'Labels'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function escapeHtml(str: string = ''): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
