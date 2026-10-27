/**
 * ScanManufacturerBarcodeModal.tsx
 *
 * Dedicated modal dialog for assigning real manufacturer barcodes to products
 * during Bulk Product Import (Review & Fix step) or from Product & Inventory Master.
 *
 * Key Capabilities:
 * - High-speed USB/Bluetooth barcode scanner capture with continuous focus
 * - Instant barcode validation with GS1 check digit verification (EAN-8, UPC-A, EAN-13, GTIN-14)
 * - Conflict detection against import session rows and existing catalog items
 * - Automatic progression to the next product lacking a barcode
 * - Audio beeps on success/failure (Web Audio API)
 * - Single/high-resolution 300 DPI PNG download and thermal label printing
 * - Undo support for the last scanned barcode assignment
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  type BarcodeTargetItem,
  type BarcodeSymbology,
  normalizeScannedBarcode,
  validateScannedBarcode,
  filterBarcodeTargets,
  findNextTargetWithoutBarcode,
  detectBarcodeType,
} from '../../../shared/barcodeScannerUtils.ts';
import { renderBarcodeSvg } from '../../../shared/bulkImport.ts';

export interface ScanManufacturerBarcodeModalProps {
  targets: BarcodeTargetItem[];
  takenCatalogBarcodes?: Map<string, { name: string; id?: string }>;
  initialSelectedId?: number | string | null;
  shopName?: string;
  onAssign: (
    id: number | string,
    barcode: string | null,
    barcodeType?: 'MANUFACTURER' | 'INTERNAL' | null
  ) => void | Promise<void>;
  onClose: () => void;
}

// ── Web Audio Feedback ─────────────────────────────────────────────────────────

function playScanSound(type: 'success' | 'error') {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'success') {
      // Short high crisp beep: ~1200Hz
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1200, ctx.currentTime);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } else {
      // Low buzz error beep: ~280Hz
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(280, ctx.currentTime);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      osc.start();
      osc.stop(ctx.currentTime + 0.22);
    }
  } catch {
    // Fail silently if browser blocks autoplay or Web Audio is unavailable
  }
}

// ── Label Printing Utility ───────────────────────────────────────────────────

function printProductBarcodeLabel(target: BarcodeTargetItem, shopName?: string) {
  if (!target.barcode) return;
  const svgMarkup = renderBarcodeSvg(target.barcode);
  const printWindow = window.open('', '_blank', 'width=480,height=420');
  if (!printWindow) {
    alert('Please allow popups to print barcode labels.');
    return;
  }

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Print Label - ${target.name}</title>
        <style>
          @page {
            size: auto;
            margin: 4mm;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            margin: 0;
            padding: 8px;
            color: #000000;
            display: flex;
            justify-content: center;
          }
          .label-card {
            width: 58mm;
            border: 1px dashed #cbd5e1;
            padding: 6px 8px;
            text-align: center;
            box-sizing: border-box;
          }
          .store-name {
            font-size: 9px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 2px;
          }
          .product-name {
            font-size: 11px;
            font-weight: 700;
            line-height: 1.2;
            max-height: 26px;
            overflow: hidden;
            margin-bottom: 4px;
          }
          .price-line {
            font-size: 12px;
            font-weight: 800;
            margin-bottom: 4px;
          }
          .barcode-wrap {
            margin: 4px 0;
            display: flex;
            justify-content: center;
          }
          .barcode-wrap svg {
            max-width: 100%;
            height: 38px;
          }
          .barcode-digits {
            font-family: monospace;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 1px;
          }
          .sku-line {
            font-size: 8px;
            color: #475569;
            margin-top: 2px;
          }
        </style>
      </head>
      <body>
        <div class="label-card">
          ${shopName ? `<div class="store-name">${shopName}</div>` : ''}
          <div class="product-name">${target.name}</div>
          ${target.priceFormatted ? `<div class="price-line">MRP: ${target.priceFormatted}</div>` : ''}
          <div class="barcode-wrap">${svgMarkup}</div>
          <div class="sku-line">${target.sku ? `SKU: ${target.sku}` : ''}</div>
        </div>
        <script>
          window.onload = function() {
            window.print();
            setTimeout(function() { window.close(); }, 500);
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

// ── High Resolution 300 DPI PNG Download Utility ─────────────────────────────

function downloadBarcodePngHighRes(code: string, productName: string) {
  if (!code) return;
  const svgMarkup = renderBarcodeSvg(code);
  const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();

  img.onload = () => {
    const canvas = document.createElement('canvas');
    // High-resolution canvas for ≈300 DPI print quality
    const width = 1200;
    const height = 480;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      // Center SVG with padding
      ctx.drawImage(img, 60, 40, width - 120, height - 80);

      const pngUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = pngUrl;
      const safeName = (productName || 'product').toLowerCase().replace(/[^a-z0-9]/g, '_');
      a.download = `barcode_${safeName}_${code}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

// ── Main Dialog Component ────────────────────────────────────────────────────

export function ScanManufacturerBarcodeModal({
  targets,
  takenCatalogBarcodes = new Map(),
  initialSelectedId,
  shopName,
  onAssign,
  onClose,
}: ScanManufacturerBarcodeModalProps) {
  // Determine default filter chip: "no_barcode" if any target lacks one, otherwise "all"
  const initialFilterStatus = useMemo(() => {
    const hasAnyMissing = targets.some((t) => !t.barcode || !t.barcode.trim());
    return hasAnyMissing ? 'no_barcode' : 'all';
  }, [targets]);

  const [filterStatus, setFilterStatus] = useState<'all' | 'no_barcode' | 'has_barcode'>(initialFilterStatus);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Selected product ID
  const [selectedId, setSelectedId] = useState<number | string | null>(() => {
    if (initialSelectedId !== undefined && initialSelectedId !== null) {
      const match = targets.find((t) => t.id === initialSelectedId);
      if (match) return match.id;
    }
    const firstMissing = targets.find((t) => !t.barcode || !t.barcode.trim());
    return firstMissing ? firstMissing.id : targets[0]?.id ?? null;
  });

  // Scanning mode & continuous scan option
  const [isScanning, setIsScanning] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [scanInput, setScanInput] = useState('');

  // Scanner feedback state
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'warning' | 'error' | 'info';
    message: string;
    conflictingTargetId?: number | string;
    conflictingProductName?: string;
  } | null>(null);

  // Undo stack: stores the last assignment { targetId, previousBarcode, previousBarcodeType, previousScannedInSession }
  const [lastAssignment, setLastAssignment] = useState<{
    targetId: number | string;
    productName: string;
    previousBarcode: string | null;
    previousBarcodeType?: 'MANUFACTURER' | 'INTERNAL' | null;
    assignedBarcode: string;
  } | null>(null);

  // Session scanned count
  const [sessionScannedIds, setSessionScannedIds] = useState<Set<number | string>>(new Set());

  // Input refs
  const scanInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const selectedItemCardRef = useRef<HTMLDivElement>(null);

  // Unique categories in targets
  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    targets.forEach((t) => {
      if (t.category && t.category.trim()) {
        cats.add(t.category.trim());
      }
    });
    return Array.from(cats).sort();
  }, [targets]);

  // Counts for filter chips
  const totalCount = targets.length;
  const noBarcodeCount = useMemo(() => targets.filter((t) => !t.barcode || !t.barcode.trim()).length, [targets]);
  const hasBarcodeCount = totalCount - noBarcodeCount;

  // Filtered product list
  const filteredTargets = useMemo(() => {
    return filterBarcodeTargets(targets, searchQuery, filterStatus, selectedCategory);
  }, [targets, searchQuery, filterStatus, selectedCategory]);

  // Current selected item
  const selectedTarget = useMemo(() => {
    if (selectedId === null) return null;
    return targets.find((t) => t.id === selectedId) || null;
  }, [targets, selectedId]);

  // Auto-focus scanner input when scanning starts
  useEffect(() => {
    if (isScanning) {
      const timer = setTimeout(() => {
        scanInputRef.current?.focus();
        scanInputRef.current?.select();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isScanning, selectedId]);

  // Scroll selected product card into view in left list
  useEffect(() => {
    if (selectedItemCardRef.current) {
      selectedItemCardRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedId]);

  // Close on Escape when not scanning; cancel scanning when pressing Escape during scanning
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isScanning) {
          setIsScanning(false);
          setScanInput('');
          setFeedback(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isScanning, onClose]);

  // Select a product
  const handleSelectProduct = useCallback((target: BarcodeTargetItem) => {
    setSelectedId(target.id);
    setScanInput('');
    setFeedback(null);
  }, []);

  // Skip to next product without a barcode
  const handleSkipToNext = useCallback(() => {
    const next = findNextTargetWithoutBarcode(targets, selectedId);
    if (next) {
      setSelectedId(next.id);
      setScanInput('');
      setFeedback(null);
      if (isScanning) {
        setTimeout(() => scanInputRef.current?.focus(), 50);
      }
    } else {
      setFeedback({
        type: 'info',
        message: 'All products currently have a barcode assigned.',
      });
    }
  }, [targets, selectedId, isScanning]);

  // Barcode Submission & Validation Handler
  const handleProcessScan = useCallback(
    async (rawCode: string) => {
      if (!selectedTarget) {
        playScanSound('error');
        setFeedback({
          type: 'error',
          message: 'Please select a product before scanning.',
        });
        return;
      }

      const valResult = validateScannedBarcode(rawCode, {
        currentTargetId: selectedTarget.id,
        targets,
        takenCatalogBarcodes,
      });

      if (!valResult.isValid) {
        playScanSound('error');
        setFeedback({
          type: 'error',
          message: valResult.error || 'Invalid barcode.',
          conflictingTargetId: valResult.conflictingTargetId,
          conflictingProductName: valResult.conflictingProductName,
        });
        // Keep focus on input for immediate re-scan
        scanInputRef.current?.focus();
        scanInputRef.current?.select();
        return;
      }

      // Check if item already had this exact barcode
      if (valResult.info) {
        playScanSound('success');
        setFeedback({
          type: 'info',
          message: valResult.info,
        });
        setScanInput('');
        if (autoAdvance) {
          const next = findNextTargetWithoutBarcode(targets, selectedTarget.id);
          if (next) {
            setSelectedId(next.id);
          } else {
            setIsScanning(false);
          }
        }
        return;
      }

      // Save undo info
      setLastAssignment({
        targetId: selectedTarget.id,
        productName: selectedTarget.name,
        previousBarcode: selectedTarget.barcode || null,
        previousBarcodeType: selectedTarget.barcodeType || null,
        assignedBarcode: valResult.normalizedCode,
      });

      // Assign the barcode
      try {
        await onAssign(selectedTarget.id, valResult.normalizedCode, 'MANUFACTURER');
        playScanSound('success');

        // Track session scan
        setSessionScannedIds((prev) => new Set(prev).add(selectedTarget.id));

        const successMessage = valResult.warning
          ? `Assigned ${valResult.normalizedCode} (${valResult.warning})`
          : `Assigned barcode ${valResult.normalizedCode} to "${selectedTarget.name}"`;

        setFeedback({
          type: valResult.warning ? 'warning' : 'success',
          message: successMessage,
        });
        setScanInput('');

        // Continuous scanning workflow
        if (autoAdvance) {
          const next = findNextTargetWithoutBarcode(targets, selectedTarget.id);
          if (next) {
            setSelectedId(next.id);
            // Remain in scanning mode, keeping focus on scan input
            setTimeout(() => {
              scanInputRef.current?.focus();
            }, 60);
          } else {
            setIsScanning(false);
            setFeedback({
              type: 'success',
              message: `All products have been assigned barcodes!`,
            });
          }
        } else {
          setIsScanning(false);
        }
      } catch (err: unknown) {
        playScanSound('error');
        setFeedback({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to assign barcode.',
        });
      }
    },
    [selectedTarget, targets, takenCatalogBarcodes, onAssign, autoAdvance]
  );

  // Undo Last Assignment
  const handleUndo = useCallback(async () => {
    if (!lastAssignment) return;
    try {
      await onAssign(lastAssignment.targetId, lastAssignment.previousBarcode, lastAssignment.previousBarcodeType);
      playScanSound('success');
      setSelectedId(lastAssignment.targetId);
      setSessionScannedIds((prev) => {
        const copy = new Set(prev);
        copy.delete(lastAssignment.targetId);
        return copy;
      });
      setFeedback({
        type: 'info',
        message: `Reverted "${lastAssignment.productName}" to ${
          lastAssignment.previousBarcode ? `"${lastAssignment.previousBarcode}"` : 'no barcode'
        }.`,
      });
      setLastAssignment(null);
    } catch (err: unknown) {
      playScanSound('error');
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to undo barcode assignment.',
      });
    }
  }, [lastAssignment, onAssign]);

  // Remove Barcode from selected product
  const handleRemoveBarcode = useCallback(async () => {
    if (!selectedTarget || !selectedTarget.barcode) return;
    const prev = selectedTarget.barcode;
    const prevType = selectedTarget.barcodeType;

    setLastAssignment({
      targetId: selectedTarget.id,
      productName: selectedTarget.name,
      previousBarcode: prev,
      previousBarcodeType: prevType,
      assignedBarcode: '',
    });

    try {
      await onAssign(selectedTarget.id, null, null);
      playScanSound('success');
      setSessionScannedIds((prevIds) => {
        const copy = new Set(prevIds);
        copy.delete(selectedTarget.id);
        return copy;
      });
      setFeedback({
        type: 'info',
        message: `Removed barcode from "${selectedTarget.name}".`,
      });
    } catch (err: unknown) {
      playScanSound('error');
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to remove barcode.',
      });
    }
  }, [selectedTarget, onAssign]);

  // Jump to conflicting target
  const handleJumpToConflict = useCallback(
    (conflictId: number | string) => {
      const match = targets.find((t) => t.id === conflictId);
      if (match) {
        setSelectedId(match.id);
        setFeedback(null);
        setScanInput('');
      }
    },
    [targets]
  );

  // Progress metrics
  const progressPercent = totalCount > 0 ? Math.round((hasBarcodeCount / totalCount) * 100) : 0;
  const scannedNowCount = sessionScannedIds.size;

  return (
    <div
      id="scan-manufacturer-barcodes-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1400,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        id="scan-manufacturer-barcodes-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-mfr-dialog-title"
        style={{
          width: '940px',
          maxWidth: '96vw',
          height: '620px',
          maxHeight: '94vh',
          background: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 25px 60px -12px rgba(15, 23, 42, 0.45)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1px solid #e2e8f0',
        }}
      >
        {/* ── HEADER ── */}
        <div
          style={{
            padding: '1.1rem 1.4rem 0.9rem',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            background: '#ffffff',
            flexShrink: 0,
          }}
        >
          <div>
            <h2
              id="scan-mfr-dialog-title"
              style={{
                margin: 0,
                fontSize: '1.25rem',
                fontWeight: 700,
                color: '#0f172a',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <span>📷</span>
              <span>Scan Manufacturer Barcodes</span>
            </h2>
            <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>
              Pick a product, press Scan, then scan the barcode printed on its pack.
            </p>
          </div>
          <button
            id="scan-dialog-close-btn"
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '1.35rem',
              cursor: 'pointer',
              lineHeight: 1,
              padding: '0.25rem',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#334155';
              e.currentTarget.style.background = '#f1f5f9';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#94a3b8';
              e.currentTarget.style.background = 'transparent';
            }}
          >
            ✕
          </button>
        </div>

        {/* ── BODY (2 PANELS) ── */}
        <div
          style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: '340px 1fr',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {/* ── LEFT PANEL: PRODUCT LIST ── */}
          <div
            style={{
              borderRight: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
              background: '#ffffff',
              minHeight: 0,
            }}
          >
            {/* Search Box */}
            <div style={{ padding: '0.85rem 0.95rem 0.5rem' }}>
              <input
                ref={searchInputRef}
                id="scan-dialog-search-input"
                type="text"
                value={searchQuery}
                onFocus={() => {
                  // Stop scanning when focusing search box so searches are never captured as scans
                  if (isScanning) {
                    setIsScanning(false);
                    setFeedback(null);
                  }
                }}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name, SKU or barcode..."
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '8px',
                  border: '1.5px solid #cbd5e1',
                  fontSize: '0.86rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                  background: '#ffffff',
                  color: '#0f172a',
                }}
              />
            </div>

            {/* Filter Chips */}
            <div
              style={{
                display: 'flex',
                gap: '0.4rem',
                padding: '0 0.95rem 0.5rem',
                flexWrap: 'wrap',
              }}
            >
              <button
                id="scan-filter-no-barcode-btn"
                type="button"
                onClick={() => setFilterStatus('no_barcode')}
                style={{
                  padding: '0.3rem 0.75rem',
                  borderRadius: '20px',
                  border: filterStatus === 'no_barcode' ? '1.5px solid #6366f1' : '1px solid #cbd5e1',
                  background: filterStatus === 'no_barcode' ? '#eef2ff' : '#ffffff',
                  color: filterStatus === 'no_barcode' ? '#4f46e5' : '#475569',
                  fontWeight: filterStatus === 'no_barcode' ? 700 : 500,
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                No barcode {noBarcodeCount}
              </button>

              <button
                id="scan-filter-has-barcode-btn"
                type="button"
                onClick={() => setFilterStatus('has_barcode')}
                style={{
                  padding: '0.3rem 0.75rem',
                  borderRadius: '20px',
                  border: filterStatus === 'has_barcode' ? '1.5px solid #6366f1' : '1px solid #cbd5e1',
                  background: filterStatus === 'has_barcode' ? '#eef2ff' : '#ffffff',
                  color: filterStatus === 'has_barcode' ? '#4f46e5' : '#475569',
                  fontWeight: filterStatus === 'has_barcode' ? 700 : 500,
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                Has barcode {hasBarcodeCount}
              </button>

              <button
                id="scan-filter-all-btn"
                type="button"
                onClick={() => setFilterStatus('all')}
                style={{
                  padding: '0.3rem 0.75rem',
                  borderRadius: '20px',
                  border: filterStatus === 'all' ? '1.5px solid #6366f1' : '1px solid #cbd5e1',
                  background: filterStatus === 'all' ? '#eef2ff' : '#ffffff',
                  color: filterStatus === 'all' ? '#4f46e5' : '#475569',
                  fontWeight: filterStatus === 'all' ? 700 : 500,
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                All {totalCount}
              </button>
            </div>

            {/* Category Filter Dropdown */}
            <div style={{ padding: '0 0.95rem 0.65rem' }}>
              <select
                id="scan-category-filter-select"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.45rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '0.82rem',
                  background: '#ffffff',
                  color: '#334155',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              >
                <option value="all">All categories</option>
                {availableCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            {/* Scrollable Product Card List */}
            <div
              id="scan-product-scroll-list"
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '0 0.75rem 0.75rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.45rem',
                minHeight: 0,
              }}
            >
              {filteredTargets.length === 0 ? (
                <div style={{ padding: '2rem 1rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                  No matching products found.
                </div>
              ) : (
                filteredTargets.map((item) => {
                  const isSelected = item.id === selectedId;
                  const hasBarcode = Boolean(item.barcode && item.barcode.trim());
                  const isScannedNow = sessionScannedIds.has(item.id);

                  return (
                    <div
                      key={item.id}
                      ref={isSelected ? selectedItemCardRef : undefined}
                      id={`scan-target-item-${item.id}`}
                      onClick={() => handleSelectProduct(item)}
                      style={{
                        padding: '0.65rem 0.85rem',
                        borderRadius: '10px',
                        border: isSelected ? '2px solid #6366f1' : '1px solid #e2e8f0',
                        background: isSelected ? '#f5f3ff' : '#ffffff',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        boxShadow: isSelected ? '0 2px 8px rgba(99, 102, 241, 0.12)' : 'none',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                        <strong
                          style={{
                            fontSize: '0.88rem',
                            color: '#0f172a',
                            fontWeight: 700,
                            lineHeight: 1.25,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={item.name}
                        >
                          {item.name}
                        </strong>
                        <span style={{ fontSize: '0.74rem', color: '#64748b', flexShrink: 0, fontWeight: 500 }}>
                          {item.rowNum ? `Row ${item.rowNum}` : ''}
                        </span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.35rem' }}>
                        <span style={{ fontSize: '0.74rem', color: '#64748b', fontFamily: 'monospace' }}>
                          {item.sku || 'No SKU'}
                        </span>

                        {hasBarcode ? (
                          <span
                            style={{
                              fontSize: '0.74rem',
                              color: '#15803d',
                              fontWeight: 700,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '3px',
                            }}
                          >
                            {isScannedNow ? '✓ Scanned' : item.barcode}
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.74rem', color: '#b45309', fontWeight: 600 }}>
                            No barcode
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ── RIGHT PANEL: SELECTED PRODUCT & SCANNER ── */}
          <div
            style={{
              padding: '1.25rem 1.6rem',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              background: '#ffffff',
              minHeight: 0,
              overflowY: 'auto',
            }}
          >
            {selectedTarget ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Product Header & Skip Button */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                  <div>
                    <h3
                      id="scan-selected-product-name"
                      style={{
                        margin: 0,
                        fontSize: '1.25rem',
                        fontWeight: 800,
                        color: '#0f172a',
                        lineHeight: 1.3,
                      }}
                    >
                      {selectedTarget.name}
                    </h3>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '0.85rem',
                        marginTop: '0.35rem',
                        fontSize: '0.82rem',
                        color: '#475569',
                      }}
                    >
                      <span>
                        SKU: <strong>{selectedTarget.sku || 'N/A'}</strong>
                      </span>
                      <span>
                        Category: <strong>{selectedTarget.category || 'Unassigned'}</strong>
                      </span>
                      {selectedTarget.priceFormatted && (
                        <span>
                          Price: <strong>{selectedTarget.priceFormatted}</strong>
                        </span>
                      )}
                      {selectedTarget.rowNum && (
                        <span>
                          Row <strong>{selectedTarget.rowNum}</strong>
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    id="scan-skip-btn"
                    type="button"
                    onClick={handleSkipToNext}
                    style={{
                      padding: '0.35rem 0.85rem',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      background: '#f8fafc',
                      color: '#334155',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      flexShrink: 0,
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#e2e8f0')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '#f8fafc')}
                  >
                    Skip ›
                  </button>
                </div>

                {/* ── BARCODE PREVIEW AREA ── */}
                <div
                  id="scan-barcode-preview-box"
                  style={{
                    border: '1.5px solid #e2e8f0',
                    borderRadius: '12px',
                    padding: '1.1rem',
                    background: '#fafafa',
                    minHeight: '135px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                  }}
                >
                  {selectedTarget.barcode ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.65rem', width: '100%' }}>
                      {/* Barcode SVG Rendering */}
                      <div
                        id="scan-rendered-barcode-svg"
                        dangerouslySetInnerHTML={{ __html: renderBarcodeSvg(selectedTarget.barcode) }}
                        style={{
                          height: '56px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          maxWidth: '100%',
                          overflow: 'hidden',
                        }}
                      />

                      {/* Symbology Type & Code display */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span
                          style={{
                            fontSize: '0.74rem',
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: '12px',
                            background: '#e0e7ff',
                            color: '#3730a3',
                          }}
                        >
                          {detectBarcodeType(selectedTarget.barcode)}
                        </span>
                        <span style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: '0.92rem', color: '#1e293b' }}>
                          {selectedTarget.barcode}
                        </span>
                      </div>

                      {/* Action buttons: Download PNG, Print Label, Remove */}
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                        <button
                          id="scan-download-png-btn"
                          type="button"
                          onClick={() => downloadBarcodePngHighRes(selectedTarget.barcode!, selectedTarget.name)}
                          style={{
                            padding: '0.3rem 0.75rem',
                            borderRadius: '6px',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            color: '#334155',
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Download PNG
                        </button>

                        <button
                          id="scan-print-label-btn"
                          type="button"
                          onClick={() => printProductBarcodeLabel(selectedTarget, shopName)}
                          style={{
                            padding: '0.3rem 0.75rem',
                            borderRadius: '6px',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            color: '#334155',
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Print Label
                        </button>

                        <button
                          id="scan-remove-barcode-btn"
                          type="button"
                          onClick={handleRemoveBarcode}
                          style={{
                            padding: '0.3rem 0.75rem',
                            borderRadius: '6px',
                            border: '1px solid #fecaca',
                            background: '#fff1f2',
                            color: '#be123c',
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Placeholder: No barcode yet */
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.45rem', color: '#94a3b8' }}>
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5">
                        <path d="M3 5v14" />
                        <path d="M6 5v14" />
                        <path d="M10 5v14" />
                        <path d="M13 5v14" />
                        <path d="M17 5v14" />
                        <path d="M21 5v14" />
                      </svg>
                      <span style={{ fontSize: '0.92rem', fontWeight: 600, color: '#64748b' }}>No barcode yet</span>
                    </div>
                  )}
                </div>

                {/* Feedback notifications */}
                {feedback && (
                  <div
                    id="scan-dialog-feedback-msg"
                    style={{
                      padding: '0.65rem 0.95rem',
                      borderRadius: '8px',
                      background:
                        feedback.type === 'success'
                          ? '#f0fdf4'
                          : feedback.type === 'warning'
                          ? '#fffbeb'
                          : feedback.type === 'error'
                          ? '#fef2f2'
                          : '#f0f9ff',
                      border: `1px solid ${
                        feedback.type === 'success'
                          ? '#86efac'
                          : feedback.type === 'warning'
                          ? '#fde68a'
                          : feedback.type === 'error'
                          ? '#fca5a5'
                          : '#bae6fd'
                      }`,
                      color:
                        feedback.type === 'success'
                          ? '#15803d'
                          : feedback.type === 'warning'
                          ? '#92400e'
                          : feedback.type === 'error'
                          ? '#b91c1c'
                          : '#0369a1',
                      fontSize: '0.84rem',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.5rem',
                    }}
                  >
                    <span>{feedback.message}</span>
                    {feedback.conflictingTargetId !== undefined && (
                      <button
                        type="button"
                        onClick={() => handleJumpToConflict(feedback.conflictingTargetId!)}
                        style={{
                          padding: '0.2rem 0.55rem',
                          borderRadius: '4px',
                          border: '1px solid #b91c1c',
                          background: '#ffffff',
                          color: '#b91c1c',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Show that product ›
                      </button>
                    )}
                  </div>
                )}

                {/* ── SCAN CONTROLS ── */}
                {isScanning ? (
                  /* Active scanning panel */
                  <div
                    id="scan-active-capture-panel"
                    style={{
                      background: '#f5f3ff',
                      border: '2px solid #6366f1',
                      borderRadius: '12px',
                      padding: '0.85rem 1rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.65rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '0.92rem', color: '#4338ca' }}>
                        Scan the barcode on &quot;{selectedTarget.name}&quot; now
                      </strong>
                      <span style={{ fontSize: '0.74rem', color: '#6366f1', fontWeight: 600 }}>
                        Listening for scanner digits...
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <input
                        ref={scanInputRef}
                        id="scan-active-barcode-input"
                        type="text"
                        value={scanInput}
                        onChange={(e) => setScanInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleProcessScan(scanInput);
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setIsScanning(false);
                            setScanInput('');
                            setFeedback(null);
                          }
                        }}
                        placeholder="Scan with USB scanner or type digits..."
                        style={{
                          flex: 1,
                          padding: '0.55rem 0.85rem',
                          borderRadius: '8px',
                          border: '2px solid #6366f1',
                          fontSize: '0.94rem',
                          fontFamily: 'monospace',
                          fontWeight: 700,
                          outline: 'none',
                          background: '#ffffff',
                        }}
                      />

                      <button
                        id="scan-assign-submit-btn"
                        type="button"
                        onClick={() => handleProcessScan(scanInput)}
                        style={{
                          padding: '0.55rem 1.15rem',
                          borderRadius: '8px',
                          border: 'none',
                          background: '#6366f1',
                          color: '#ffffff',
                          fontWeight: 700,
                          fontSize: '0.88rem',
                          cursor: 'pointer',
                          boxShadow: '0 2px 8px rgba(99, 102, 241, 0.35)',
                        }}
                      >
                        Assign
                      </button>

                      <button
                        id="scan-cancel-btn"
                        type="button"
                        onClick={() => {
                          setIsScanning(false);
                          setScanInput('');
                          setFeedback(null);
                        }}
                        style={{
                          padding: '0.55rem 0.95rem',
                          borderRadius: '8px',
                          border: '1px solid #cbd5e1',
                          background: '#ffffff',
                          color: '#475569',
                          fontWeight: 600,
                          fontSize: '0.88rem',
                          cursor: 'pointer',
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Inactive / Ready to scan button */
                  <button
                    id="scan-start-scan-btn"
                    type="button"
                    onClick={() => {
                      setIsScanning(true);
                      setFeedback(null);
                      setScanInput('');
                    }}
                    style={{
                      width: '100%',
                      padding: '0.8rem 1rem',
                      borderRadius: '10px',
                      border: 'none',
                      background: '#6366f1',
                      color: '#ffffff',
                      fontWeight: 700,
                      fontSize: '0.98rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      boxShadow: '0 4px 12px rgba(99, 102, 241, 0.35)',
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#4f46e5')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '#6366f1')}
                  >
                    <span>📷</span>
                    <span>
                      {selectedTarget.barcode ? 'Rescan / Replace Barcode' : 'Scan Barcode'}
                    </span>
                  </button>
                )}

                {/* Option checkbox */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.55rem',
                    fontSize: '0.84rem',
                    color: '#334155',
                    cursor: 'pointer',
                    userSelect: 'none',
                  }}
                >
                  <input
                    id="scan-auto-advance-checkbox"
                    type="checkbox"
                    checked={autoAdvance}
                    onChange={(e) => setAutoAdvance(e.target.checked)}
                    style={{ width: '16px', height: '16px', accentColor: '#6366f1', cursor: 'pointer' }}
                  />
                  <span>After a successful scan, move to the next product without a barcode and keep scanning</span>
                </label>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#94a3b8' }}>
                Select a product from the list to view and scan its barcode.
              </div>
            )}
          </div>
        </div>

        {/* ── FOOTER ── */}
        <div
          style={{
            padding: '0.85rem 1.4rem',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#ffffff',
            flexShrink: 0,
          }}
        >
          {/* Progress Section */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', width: '380px', maxWidth: '50%' }}>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155' }}>
              <strong>{hasBarcodeCount}</strong> of <strong>{totalCount}</strong> products have a barcode
              {scannedNowCount > 0 && (
                <span style={{ color: '#15803d', fontWeight: 700 }}> • {scannedNowCount} scanned now</span>
              )}
            </div>
            {/* Smooth Progress Bar */}
            <div
              style={{
                width: '100%',
                height: '6px',
                background: '#e2e8f0',
                borderRadius: '3px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${progressPercent}%`,
                  height: '100%',
                  background: '#6366f1',
                  borderRadius: '3px',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>

          {/* Action buttons: Undo & Done */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            {lastAssignment && (
              <button
                id="scan-undo-btn"
                type="button"
                onClick={handleUndo}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '20px',
                  border: '1.5px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#334155',
                  fontWeight: 600,
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#ffffff')}
              >
                ↶ Undo last scan
              </button>
            )}

            <button
              id="scan-done-btn"
              type="button"
              onClick={onClose}
              style={{
                padding: '0.55rem 1.6rem',
                borderRadius: '20px',
                border: 'none',
                background: '#6366f1',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '0.88rem',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(99, 102, 241, 0.35)',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#4f46e5')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#6366f1')}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
