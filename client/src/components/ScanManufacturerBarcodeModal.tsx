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
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
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
import { qrSvg } from '../../../shared/qr.ts';

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
    const width = 1200;
    const height = 480;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
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

  // Scanning mode: 'camera' (Webcam/Live video) | 'gun' (USB scanner/manual) | 'mobile' (phone pairing)
  const [scanMode, setScanMode] = useState<'camera' | 'gun' | 'mobile'>('camera');
  const [isScanning, setIsScanning] = useState(true);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [scanInput, setScanInput] = useState('');

  // Camera state
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [availableCameras, setAvailableCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [cameraScanSuccessFlash, setCameraScanSuccessFlash] = useState(false);

  // Mobile pairing state
  const [mobileSessionId] = useState<string>(() => `mfr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`);
  const [isMobileConnected, setIsMobileConnected] = useState(false);
  const [scannerNetworkInfo, setScannerNetworkInfo] = useState<{ localIp?: string; httpPort?: number; tunnelUrl?: string; isTunnelAlive?: boolean } | null>(null);
  const [mobileConnectionType, setMobileConnectionType] = useState<'tunnel' | 'wifi'>('tunnel');
  const [isStartingTunnel, setIsStartingTunnel] = useState(false);
  const [tunnelError, setTunnelError] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  // Barcode gun buffer & tracking
  const [lastGunScan, setLastGunScan] = useState<string | null>(null);
  const gunKeystrokeBufferRef = useRef<string>('');
  const lastGunKeyTimeRef = useRef<number>(0);

  // Scanner feedback state
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'warning' | 'error' | 'info';
    message: string;
    conflictingTargetId?: number | string;
    conflictingProductName?: string;
  } | null>(null);

  // Undo stack: stores the last assignment
  const [lastAssignment, setLastAssignment] = useState<{
    targetId: number | string;
    productName: string;
    previousBarcode: string | null;
    previousBarcodeType?: 'MANUFACTURER' | 'INTERNAL' | null;
    assignedBarcode: string;
  } | null>(null);

  // Session scanned count
  const [sessionScannedIds, setSessionScannedIds] = useState<Set<number | string>>(new Set());

  // Input & device refs
  const scanInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const selectedItemCardRef = useRef<HTMLDivElement>(null);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);
  const isStartingCameraRef = useRef(false);
  const lastCameraScanRef = useRef<{ code: string; time: number } | null>(null);
  const lastGlobalScanRef = useRef<number>(0);
  const processedMobileScanIdsRef = useRef<Set<string>>(new Set());

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

  // Keep latest state in refs for closure safety in scanner callbacks
  const selectedTargetRef = useRef<BarcodeTargetItem | null>(null);
  selectedTargetRef.current = selectedTarget;

  const targetsRef = useRef<BarcodeTargetItem[]>(targets);
  targetsRef.current = targets;

  const takenCatalogBarcodesRef = useRef(takenCatalogBarcodes);
  takenCatalogBarcodesRef.current = takenCatalogBarcodes;

  const autoAdvanceRef = useRef(autoAdvance);
  autoAdvanceRef.current = autoAdvance;

  const onAssignRef = useRef(onAssign);
  onAssignRef.current = onAssign;

  // Stop Camera stream & release video tracks
  const stopCamera = useCallback(async () => {
    isStartingCameraRef.current = false;
    setIsStartingCamera(false);
    if (html5QrCodeRef.current) {
      try {
        const scanner = html5QrCodeRef.current;
        html5QrCodeRef.current = null;
        if (scanner.isScanning) {
          await scanner.stop();
        }
        scanner.clear();
      } catch {
        // ignore errors on stopping
      }
    }
    setIsCameraActive(false);
  }, []);

  // Safe close handler that stops camera first
  const handleModalClose = useCallback(async () => {
    await stopCamera();
    onClose();
  }, [stopCamera, onClose]);

  // Cleanup camera on component unmount
  useEffect(() => {
    return () => {
      if (html5QrCodeRef.current) {
        try {
          if (html5QrCodeRef.current.isScanning) {
            html5QrCodeRef.current.stop().catch(() => {});
          }
          html5QrCodeRef.current.clear();
        } catch {}
        html5QrCodeRef.current = null;
      }
    };
  }, []);

  // Barcode Submission & Validation Handler
  const handleProcessScan = useCallback(
    async (rawCode: string) => {
      const currentTarget = selectedTargetRef.current;
      if (!currentTarget) {
        playScanSound('error');
        setFeedback({
          type: 'error',
          message: 'Please select a product before scanning.',
        });
        return;
      }

      const valResult = validateScannedBarcode(rawCode, {
        currentTargetId: currentTarget.id,
        targets: targetsRef.current,
        takenCatalogBarcodes: takenCatalogBarcodesRef.current,
      });

      if (!valResult.isValid) {
        playScanSound('error');
        setFeedback({
          type: 'error',
          message: valResult.error || 'Invalid barcode.',
          conflictingTargetId: valResult.conflictingTargetId,
          conflictingProductName: valResult.conflictingProductName,
        });
        if (scanInputRef.current) {
          scanInputRef.current.focus();
          scanInputRef.current.select();
        }
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
        if (autoAdvanceRef.current) {
          const next = findNextTargetWithoutBarcode(targetsRef.current, currentTarget.id);
          if (next) {
            setSelectedId(next.id);
          }
        }
        return;
      }

      // Save undo info
      setLastAssignment({
        targetId: currentTarget.id,
        productName: currentTarget.name,
        previousBarcode: currentTarget.barcode || null,
        previousBarcodeType: currentTarget.barcodeType || null,
        assignedBarcode: valResult.normalizedCode,
      });

      // Assign the barcode
      try {
        await onAssignRef.current(currentTarget.id, valResult.normalizedCode, 'MANUFACTURER');
        playScanSound('success');

        // Track session scan
        setSessionScannedIds((prev) => new Set(prev).add(currentTarget.id));

        const successMessage = valResult.warning
          ? `Assigned ${valResult.normalizedCode} (${valResult.warning})`
          : `Assigned barcode ${valResult.normalizedCode} to "${currentTarget.name}"`;

        setFeedback({
          type: valResult.warning ? 'warning' : 'success',
          message: successMessage,
        });
        setScanInput('');

        // Continuous scanning workflow
        if (autoAdvanceRef.current) {
          const next = findNextTargetWithoutBarcode(targetsRef.current, currentTarget.id);
          if (next) {
            setSelectedId(next.id);
            setTimeout(() => {
              scanInputRef.current?.focus();
            }, 60);
          } else {
            setFeedback({
              type: 'success',
              message: `All products have been assigned barcodes!`,
            });
          }
        }
      } catch (err: unknown) {
        playScanSound('error');
        setFeedback({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to assign barcode.',
        });
      }
    },
    []
  );

  // Start Camera Scanner
  const startCamera = useCallback(async (cameraIdToUse?: string) => {
    if (isStartingCameraRef.current) return;
    isStartingCameraRef.current = true;
    setIsStartingCamera(true);
    setCameraError(null);

    try {
      const isSecure = typeof window !== 'undefined' && (
        Boolean(window.isSecureContext) ||
        window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1'
      );
      if (!isSecure) {
        setCameraError('Live camera video stream requires HTTPS or localhost. Switch to Barcode Gun or Phone Camera mode.');
        setIsStartingCamera(false);
        isStartingCameraRef.current = false;
        return;
      }

      const devices = await Html5Qrcode.getCameras();
      if (!devices || devices.length === 0) {
        setCameraError('No camera found on this computer. Please plug in a webcam or switch to Barcode Gun mode.');
        setIsStartingCamera(false);
        isStartingCameraRef.current = false;
        return;
      }

      setAvailableCameras(devices.map((d) => ({ id: d.id, label: d.label || `Camera ${d.id.slice(0, 5)}` })));

      const chosenId = cameraIdToUse || selectedCameraId || (() => {
        const back = devices.find((d) => /back|rear|environment|external|webcam/i.test(d.label));
        return back ? back.id : devices[0].id;
      })();
      setSelectedCameraId(chosenId);

      if (html5QrCodeRef.current) {
        try {
          if (html5QrCodeRef.current.isScanning) {
            await html5QrCodeRef.current.stop();
          }
          html5QrCodeRef.current.clear();
        } catch {}
        html5QrCodeRef.current = null;
      }

      const container = document.getElementById('mfr-barcode-camera-view');
      if (!container) {
        setIsStartingCamera(false);
        isStartingCameraRef.current = false;
        return;
      }

      const qrScanner = new Html5Qrcode('mfr-barcode-camera-view', {
        formatsToSupport: [
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.QR_CODE,
        ],
        verbose: false,
      });
      html5QrCodeRef.current = qrScanner;

      await qrScanner.start(
        chosenId,
        {
          fps: 20,
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            const width = Math.min(360, Math.floor(viewfinderWidth * 0.88));
            const height = Math.min(180, Math.floor(viewfinderHeight * 0.62));
            return { width, height };
          },
          aspectRatio: 1.6,
        },
        (decodedText) => {
          const raw = decodedText.trim();
          if (!raw) return;
          const now = Date.now();

          // Debounce duplicate scans: 2000ms cooldown for identical barcode, 900ms global scan cooldown
          if (lastCameraScanRef.current && lastCameraScanRef.current.code === raw && now - lastCameraScanRef.current.time < 2000) {
            return;
          }
          if (now - lastGlobalScanRef.current < 900) {
            return;
          }
          lastCameraScanRef.current = { code: raw, time: now };
          lastGlobalScanRef.current = now;

          // Flash visual HUD
          setCameraScanSuccessFlash(true);
          setTimeout(() => setCameraScanSuccessFlash(false), 500);

          handleProcessScan(raw);
        },
        () => {
          // Normal frame loop
        }
      );

      setIsCameraActive(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('NotAllowedError') || msg.includes('Permission')) {
        setCameraError('Camera permission was denied. Please click the camera icon in your browser address bar to allow access.');
      } else {
        setCameraError(`Camera error: ${msg}`);
      }
      setIsCameraActive(false);
    } finally {
      setIsStartingCamera(false);
      isStartingCameraRef.current = false;
    }
  }, [selectedCameraId, handleProcessScan]);

  // Switch between cameras
  const handleSwitchCamera = useCallback(async (newCameraId: string) => {
    setSelectedCameraId(newCameraId);
    if (isCameraActive) {
      await stopCamera();
      setTimeout(() => {
        startCamera(newCameraId);
      }, 120);
    }
  }, [isCameraActive, stopCamera, startCamera]);

  // Mode change handler
  const handleChangeScanMode = useCallback(async (newMode: 'camera' | 'gun' | 'mobile') => {
    if (newMode !== 'camera' && isCameraActive) {
      await stopCamera();
    }
    setScanMode(newMode);
    setFeedback(null);
    if (newMode === 'gun') {
      setIsScanning(true);
      setTimeout(() => scanInputRef.current?.focus(), 60);
    }
  }, [isCameraActive, stopCamera]);

  // Start / restart Cloudflare public tunnel on demand
  const handleStartPublicTunnel = useCallback(async (force = false) => {
    setIsStartingTunnel(true);
    setTunnelError(null);
    try {
      const res = await fetch('/api/scanner/restart-tunnel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
      const data = await res.json();
      if (data.ok && data.tunnelUrl) {
        setScannerNetworkInfo((prev) =>
          prev
            ? { ...prev, tunnelUrl: data.tunnelUrl, isTunnelAlive: true }
            : { tunnelUrl: data.tunnelUrl, isTunnelAlive: true, httpPort: 3001 }
        );
        setMobileConnectionType('tunnel');
      } else {
        setTunnelError(data.error || 'Failed to start public tunnel. You can use Local Wi-Fi mode.');
      }
    } catch (err: any) {
      setTunnelError(err?.message || 'Could not connect to server.');
    } finally {
      setIsStartingTunnel(false);
    }
  }, []);

  // Fetch network info for mobile QR scanner & auto-spawn tunnel for live video
  useEffect(() => {
    if (scanMode !== 'mobile') return;

    let isMounted = true;
    const fetchInfo = () => {
      fetch('/api/scanner/network-info')
        .then((r) => r.json())
        .then((data) => {
          if (!isMounted) return;
          setScannerNetworkInfo(data);
          if (data.tunnelUrl && data.isTunnelAlive) {
            setMobileConnectionType('tunnel');
          } else if (!data.tunnelUrl || !data.isTunnelAlive) {
            handleStartPublicTunnel(false);
          }
        })
        .catch(() => {});
    };

    fetchInfo();
    const timer = setInterval(fetchInfo, 3000);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [scanMode, handleStartPublicTunnel]);

  // Real-time listener for mobile scanner scans during this modal session (persists across tab changes)
  useEffect(() => {
    let active = true;
    let lastScanId = '';

    const listenForMobileScans = async () => {
      while (active) {
        try {
          const url = `/api/scanner/events?session=${encodeURIComponent(mobileSessionId)}${lastScanId ? `&after=${encodeURIComponent(lastScanId)}` : ''}`;
          const res = await fetch(url);
          if (!res.ok) {
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          const data = await res.json();
          if (!active) break;

          if (data.phoneConnected !== undefined) {
            setIsMobileConnected(Boolean(data.phoneConnected));
          }

          if (data.events && Array.isArray(data.events) && data.events.length > 0) {
            for (const ev of data.events) {
              lastScanId = ev.id;
              if (processedMobileScanIdsRef.current.has(ev.id)) continue;
              processedMobileScanIdsRef.current.add(ev.id);
              await handleProcessScan(ev.barcode);
            }
          }
        } catch {
          if (active) {
            await new Promise((r) => setTimeout(r, 2500));
          }
        }
      }
    };

    listenForMobileScans();
    return () => {
      active = false;
    };
  }, [mobileSessionId, handleProcessScan]);

  // Direct Local Wi-Fi URL (works 100% reliably if mobile and PC are on same Wi-Fi / hotspot)
  const localWifiUrl = useMemo(() => {
    const ip = scannerNetworkInfo?.localIp || '10.68.96.5';
    const port = scannerNetworkInfo?.httpPort || 3001;
    return `http://${ip}:${port}/scanner?session=${encodeURIComponent(mobileSessionId)}`;
  }, [scannerNetworkInfo, mobileSessionId]);

  // Cloudflare HTTPS Public URL (required by mobile browsers for continuous live video laser scanning)
  const tunnelScannerUrl = useMemo(() => {
    if (!scannerNetworkInfo?.tunnelUrl) return '';
    return `${scannerNetworkInfo.tunnelUrl}/scanner?session=${encodeURIComponent(mobileSessionId)}`;
  }, [scannerNetworkInfo, mobileSessionId]);

  // Currently active mobile scanner URL based on user-selected connection mode
  const activeMobileUrl = useMemo(() => {
    if (mobileConnectionType === 'tunnel') {
      return tunnelScannerUrl || '';
    }
    return localWifiUrl;
  }, [mobileConnectionType, tunnelScannerUrl, localWifiUrl]);

  // GLOBAL HARDWARE BARCODE GUN LISTENER:
  // Catches rapid scanner gun keystrokes everywhere in the modal (Camera tab, Gun tab, or product list)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Do not intercept if user is intentionally typing inside the search filter box
      const target = e.target as HTMLElement | null;
      if (target && target.id === 'scan-search-input') {
        return;
      }

      const now = Date.now();
      const timeDiff = now - lastGunKeyTimeRef.current;
      lastGunKeyTimeRef.current = now;

      if (e.key === 'Enter') {
        const code = gunKeystrokeBufferRef.current.trim();
        gunKeystrokeBufferRef.current = '';
        if (code.length >= 3) {
          e.preventDefault();
          e.stopPropagation();
          setLastGunScan(code);
          handleProcessScan(code);
          return;
        }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        // Hardware barcode guns transmit characters rapidly (< 80ms per key)
        // If more than 200ms elapsed since last keystroke, treat as a new scan burst
        if (timeDiff > 200) {
          gunKeystrokeBufferRef.current = e.key;
        } else {
          gunKeystrokeBufferRef.current += e.key;
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown, true);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown, true);
  }, [handleProcessScan]);

  // Auto-focus scanner input when scanning in gun mode
  useEffect(() => {
    if (isScanning && scanMode === 'gun') {
      const timer = setTimeout(() => {
        scanInputRef.current?.focus();
        scanInputRef.current?.select();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isScanning, scanMode, selectedId]);

  // Scroll selected product card into view in left list
  useEffect(() => {
    if (selectedItemCardRef.current) {
      selectedItemCardRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedId]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isCameraActive) {
          stopCamera();
        } else if (isScanning && scanMode === 'gun') {
          setIsScanning(false);
          setScanInput('');
          setFeedback(null);
        } else {
          handleModalClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCameraActive, isScanning, scanMode, stopCamera, handleModalClose]);

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
      if (isScanning && scanMode === 'gun') {
        setTimeout(() => scanInputRef.current?.focus(), 50);
      }
    } else {
      setFeedback({
        type: 'info',
        message: 'All products currently have a barcode assigned.',
      });
    }
  }, [targets, selectedId, isScanning, scanMode]);

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
        backgroundColor: 'rgba(15, 23, 42, 0.72)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.25rem',
        animation: 'fadeIn 0.2s ease-out',
      }}
    >
      <div
        id="scan-manufacturer-barcodes-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-mfr-dialog-title"
        style={{
          width: '1040px',
          maxWidth: '96vw',
          height: 'min(760px, 92vh)',
          maxHeight: '92vh',
          background: '#ffffff',
          borderRadius: '20px',
          boxShadow: '0 25px 70px -10px rgba(15, 23, 42, 0.35), 0 0 0 1px rgba(226, 232, 240, 0.9)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* ── HEADER ── */}
        <div
          style={{
            padding: '1.2rem 1.6rem',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#ffffff',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(129, 140, 248, 0.2) 100%)',
                border: '1px solid rgba(99, 102, 241, 0.25)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#4f46e5',
                flexShrink: 0,
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7V5a2 2 0 0 1 2-2h2" />
                <path d="M17 3h2a2 2 0 0 1 2 2v2" />
                <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
                <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
                <line x1="7" y1="8" x2="7" y2="16" />
                <line x1="10" y1="8" x2="10" y2="16" />
                <line x1="14" y1="8" x2="14" y2="16" />
                <line x1="17" y1="8" x2="17" y2="16" />
              </svg>
            </div>
            <div>
              <h2
                id="scan-mfr-dialog-title"
                style={{
                  margin: 0,
                  fontSize: '1.25rem',
                  fontWeight: 800,
                  color: '#0f172a',
                  letterSpacing: '-0.02em',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                Scan Manufacturer Barcodes
              </h2>
              <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.84rem', color: '#64748b' }}>
                Pick a product, press Scan, then scan the barcode printed on its pack.
              </p>
            </div>
          </div>

          <button
            id="scan-dialog-close-btn"
            type="button"
            onClick={handleModalClose}
            aria-label="Close dialog"
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              color: '#64748b',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = '#0f172a';
              e.currentTarget.style.background = '#f1f5f9';
              e.currentTarget.style.borderColor = '#cbd5e1';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = '#64748b';
              e.currentTarget.style.background = '#f8fafc';
              e.currentTarget.style.borderColor = '#e2e8f0';
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── BODY (2 PANELS) ── */}
        <div
          style={{
            flex: 1,
            display: 'grid',
            gridTemplateColumns: '360px 1fr',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {/* ── LEFT PANEL: PRODUCT LIST ── */}
          <div
            style={{
              borderRight: '1px solid #f1f5f9',
              display: 'flex',
              flexDirection: 'column',
              background: '#fafafa',
              minHeight: 0,
            }}
          >
            {/* Search Box */}
            <div style={{ padding: '0.9rem 1rem 0.6rem' }}>
              <div style={{ position: 'relative', width: '100%' }}>
                <span
                  style={{
                    position: 'absolute',
                    left: '11px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    display: 'flex',
                    alignItems: 'center',
                    color: '#94a3b8',
                    pointerEvents: 'none',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </span>
                <input
                  ref={searchInputRef}
                  id="scan-dialog-search-input"
                  type="text"
                  value={searchQuery}
                  onFocus={() => {
                    if (isScanning) {
                      setIsScanning(false);
                      setFeedback(null);
                    }
                  }}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search name, SKU, or barcode..."
                  style={{
                    width: '100%',
                    padding: '0.55rem 2rem 0.55rem 2.25rem',
                    borderRadius: '10px',
                    border: '1px solid #e2e8f0',
                    fontSize: '0.86rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                    background: '#ffffff',
                    color: '#0f172a',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                    transition: 'all 0.15s ease',
                  }}
                  onFocusCapture={(e) => {
                    e.currentTarget.style.borderColor = '#6366f1';
                    e.currentTarget.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.12)';
                  }}
                  onBlurCapture={(e) => {
                    e.currentTarget.style.borderColor = '#e2e8f0';
                    e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.03)';
                  }}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    style={{
                      position: 'absolute',
                      right: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    title="Clear search"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Filter Chips */}
            <div
              style={{
                display: 'flex',
                gap: '0.45rem',
                padding: '0 1rem 0.6rem',
                flexWrap: 'wrap',
              }}
            >
              <button
                id="scan-filter-no-barcode-btn"
                type="button"
                onClick={() => setFilterStatus('no_barcode')}
                style={{
                  padding: '0.35rem 0.75rem',
                  borderRadius: '20px',
                  border: filterStatus === 'no_barcode' ? '1.5px solid #f59e0b' : '1px solid #e2e8f0',
                  background: filterStatus === 'no_barcode' ? '#fffbeb' : '#ffffff',
                  color: filterStatus === 'no_barcode' ? '#b45309' : '#64748b',
                  fontWeight: 600,
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  transition: 'all 0.15s ease',
                  boxShadow: filterStatus === 'no_barcode' ? '0 1px 3px rgba(245, 158, 11, 0.15)' : 'none',
                }}
              >
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: '#f59e0b',
                  }}
                />
                <span>No barcode</span>
                <span
                  style={{
                    fontSize: '0.72rem',
                    padding: '1px 6px',
                    borderRadius: '10px',
                    background: filterStatus === 'no_barcode' ? 'rgba(245, 158, 11, 0.2)' : '#f1f5f9',
                    color: filterStatus === 'no_barcode' ? '#92400e' : '#475569',
                    fontWeight: 700,
                  }}
                >
                  {noBarcodeCount}
                </span>
              </button>

              <button
                id="scan-filter-has-barcode-btn"
                type="button"
                onClick={() => setFilterStatus('has_barcode')}
                style={{
                  padding: '0.35rem 0.75rem',
                  borderRadius: '20px',
                  border: filterStatus === 'has_barcode' ? '1.5px solid #10b981' : '1px solid #e2e8f0',
                  background: filterStatus === 'has_barcode' ? '#ecfdf5' : '#ffffff',
                  color: filterStatus === 'has_barcode' ? '#047857' : '#64748b',
                  fontWeight: 600,
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  transition: 'all 0.15s ease',
                  boxShadow: filterStatus === 'has_barcode' ? '0 1px 3px rgba(16, 185, 129, 0.15)' : 'none',
                }}
              >
                <span
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: '#10b981',
                  }}
                />
                <span>Has barcode</span>
                <span
                  style={{
                    fontSize: '0.72rem',
                    padding: '1px 6px',
                    borderRadius: '10px',
                    background: filterStatus === 'has_barcode' ? 'rgba(16, 185, 129, 0.2)' : '#f1f5f9',
                    color: filterStatus === 'has_barcode' ? '#065f46' : '#475569',
                    fontWeight: 700,
                  }}
                >
                  {hasBarcodeCount}
                </span>
              </button>

              <button
                id="scan-filter-all-btn"
                type="button"
                onClick={() => setFilterStatus('all')}
                style={{
                  padding: '0.35rem 0.75rem',
                  borderRadius: '20px',
                  border: filterStatus === 'all' ? '1.5px solid #6366f1' : '1px solid #e2e8f0',
                  background: filterStatus === 'all' ? '#eef2ff' : '#ffffff',
                  color: filterStatus === 'all' ? '#4f46e5' : '#64748b',
                  fontWeight: 600,
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  transition: 'all 0.15s ease',
                  boxShadow: filterStatus === 'all' ? '0 1px 3px rgba(99, 102, 241, 0.15)' : 'none',
                }}
              >
                <span>All</span>
                <span
                  style={{
                    fontSize: '0.72rem',
                    padding: '1px 6px',
                    borderRadius: '10px',
                    background: filterStatus === 'all' ? 'rgba(99, 102, 241, 0.2)' : '#f1f5f9',
                    color: filterStatus === 'all' ? '#3730a3' : '#475569',
                    fontWeight: 700,
                  }}
                >
                  {totalCount}
                </span>
              </button>
            </div>

            {/* Category Filter Dropdown */}
            <div style={{ padding: '0 1rem 0.65rem' }}>
              <div style={{ position: 'relative', width: '100%' }}>
                <span
                  style={{
                    position: 'absolute',
                    left: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    display: 'flex',
                    alignItems: 'center',
                    color: '#94a3b8',
                    pointerEvents: 'none',
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m20.59 13.41-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                    <line x1="7" y1="7" x2="7.01" y2="7" />
                  </svg>
                </span>
                <select
                  id="scan-category-filter-select"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.45rem 1.8rem 0.45rem 2.1rem',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    fontSize: '0.82rem',
                    fontWeight: 500,
                    background: '#ffffff',
                    color: '#334155',
                    outline: 'none',
                    cursor: 'pointer',
                    appearance: 'none',
                    WebkitAppearance: 'none',
                  }}
                >
                  <option value="all">All categories</option>
                  {availableCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <span
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    display: 'flex',
                    alignItems: 'center',
                    color: '#94a3b8',
                    pointerEvents: 'none',
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </span>
              </div>
            </div>

            {/* Scrollable Product Card List */}
            <div
              id="scan-product-scroll-list"
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '0 0.85rem 0.85rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                minHeight: 0,
              }}
            >
              {filteredTargets.length === 0 ? (
                <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                  <div style={{ display: 'inline-flex', padding: '10px', borderRadius: '50%', background: '#f1f5f9', marginBottom: '0.5rem' }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                  </div>
                  <div>No matching products found.</div>
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
                        padding: '0.75rem 0.9rem',
                        borderRadius: '12px',
                        border: isSelected ? '1.5px solid #6366f1' : '1px solid #e2e8f0',
                        background: isSelected ? 'linear-gradient(135deg, #ffffff 0%, #f5f3ff 100%)' : '#ffffff',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        boxShadow: isSelected ? '0 4px 14px rgba(99, 102, 241, 0.12)' : '0 1px 2px rgba(0,0,0,0.02)',
                        position: 'relative',
                        overflow: 'hidden',
                        flexShrink: 0,
                        minHeight: '66px',
                        boxSizing: 'border-box',
                      }}
                    >
                      {/* Left vertical accent indicator */}
                      {isSelected && (
                        <div
                          style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            bottom: 0,
                            width: '4px',
                            background: '#6366f1',
                            borderRadius: '0 4px 4px 0',
                          }}
                        />
                      )}

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', paddingLeft: isSelected ? '4px' : '0' }}>
                        <strong
                          style={{
                            fontSize: '0.88rem',
                            color: isSelected ? '#1e1b4b' : '#0f172a',
                            fontWeight: 700,
                            lineHeight: 1.3,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={item.name}
                        >
                          {item.name}
                        </strong>
                        <span
                          style={{
                            fontSize: '0.72rem',
                            color: '#64748b',
                            flexShrink: 0,
                            fontWeight: 600,
                            background: '#f1f5f9',
                            padding: '2px 6px',
                            borderRadius: '4px',
                          }}
                        >
                          {item.rowNum ? `Row ${item.rowNum}` : ''}
                        </span>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.45rem', paddingLeft: isSelected ? '4px' : '0' }}>
                        <span style={{ fontSize: '0.74rem', color: '#64748b', fontFamily: 'monospace', fontWeight: 600 }}>
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
                              gap: '4px',
                              background: '#ecfdf5',
                              padding: '2px 7px',
                              borderRadius: '6px',
                              border: '1px solid #bbf7d0',
                            }}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            <span>{isScannedNow ? 'Scanned' : item.barcode}</span>
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: '0.74rem',
                              color: '#b45309',
                              fontWeight: 600,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              background: '#fffbeb',
                              padding: '2px 7px',
                              borderRadius: '6px',
                              border: '1px solid #fde68a',
                            }}
                          >
                            <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#f59e0b' }} />
                            <span>No barcode</span>
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
              background: '#ffffff',
              minHeight: 0,
              overflowY: 'auto',
              maxHeight: '100%',
              gap: '1rem',
            }}
          >
            {selectedTarget ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
                {/* Product Header & Skip Button */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3
                      id="scan-selected-product-name"
                      style={{
                        margin: 0,
                        fontSize: '1.32rem',
                        fontWeight: 800,
                        color: '#0f172a',
                        lineHeight: 1.3,
                        letterSpacing: '-0.02em',
                      }}
                    >
                      {selectedTarget.name}
                    </h3>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '0.5rem',
                        marginTop: '0.5rem',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '0.78rem',
                          color: '#475569',
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <span style={{ color: '#94a3b8', fontWeight: 500 }}>SKU:</span>
                        <strong style={{ fontFamily: 'monospace', color: '#0f172a' }}>{selectedTarget.sku || 'N/A'}</strong>
                      </span>

                      <span
                        style={{
                          fontSize: '0.78rem',
                          color: '#475569',
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          padding: '3px 8px',
                          borderRadius: '6px',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        <span style={{ color: '#94a3b8', fontWeight: 500 }}>Category:</span>
                        <strong style={{ color: '#0f172a' }}>{selectedTarget.category || 'Unassigned'}</strong>
                      </span>

                      {selectedTarget.priceFormatted && (
                        <span
                          style={{
                            fontSize: '0.78rem',
                            color: '#15803d',
                            background: '#f0fdf4',
                            border: '1px solid #bbf7d0',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <span style={{ color: '#16a34a', fontWeight: 500 }}>Price:</span>
                          <strong style={{ color: '#15803d' }}>{selectedTarget.priceFormatted}</strong>
                        </span>
                      )}

                      {selectedTarget.rowNum && (
                        <span
                          style={{
                            fontSize: '0.78rem',
                            color: '#64748b',
                            background: '#f1f5f9',
                            border: '1px solid #e2e8f0',
                            padding: '3px 8px',
                            borderRadius: '6px',
                          }}
                        >
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
                      padding: '0.42rem 0.9rem',
                      borderRadius: '8px',
                      border: '1px solid #e2e8f0',
                      background: '#f8fafc',
                      color: '#475569',
                      fontWeight: 600,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      flexShrink: 0,
                      transition: 'all 0.15s ease',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#f1f5f9';
                      e.currentTarget.style.color = '#0f172a';
                      e.currentTarget.style.borderColor = '#cbd5e1';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#f8fafc';
                      e.currentTarget.style.color = '#475569';
                      e.currentTarget.style.borderColor = '#e2e8f0';
                    }}
                  >
                    <span>Skip</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </div>

                {/* ── BARCODE PREVIEW AREA ── */}
                <div
                  id="scan-barcode-preview-box"
                  style={{
                    border: '1px solid #e2e8f0',
                    borderRadius: '14px',
                    padding: '0.85rem 1.15rem',
                    background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    flexWrap: 'wrap',
                    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.03)',
                    flexShrink: 0,
                  }}
                >
                  {selectedTarget.barcode ? (
                    <>
                      {/* Left Side: Barcode SVG + Details */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', minWidth: 0 }}>
                        <div
                          id="scan-rendered-barcode-svg"
                          dangerouslySetInnerHTML={{ __html: renderBarcodeSvg(selectedTarget.barcode) }}
                          style={{
                            height: '42px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            maxWidth: '180px',
                            overflow: 'hidden',
                          }}
                        />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span
                              style={{
                                fontSize: '0.68rem',
                                fontWeight: 700,
                                padding: '1px 6px',
                                borderRadius: '6px',
                                background: '#e0e7ff',
                                color: '#3730a3',
                                border: '1px solid #c7d2fe',
                              }}
                            >
                              {detectBarcodeType(selectedTarget.barcode)}
                            </span>
                            <span
                              style={{
                                fontFamily: 'monospace',
                                fontWeight: 800,
                                fontSize: '0.96rem',
                                color: '#0f172a',
                                letterSpacing: '0.06em',
                              }}
                            >
                              {selectedTarget.barcode}
                            </span>
                          </div>
                          <span style={{ fontSize: '0.72rem', color: '#16a34a', fontWeight: 600 }}>
                            Current Assigned Barcode
                          </span>
                        </div>
                      </div>

                      {/* Right Side: Actions */}
                      <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                          id="scan-download-png-btn"
                          type="button"
                          onClick={() => downloadBarcodePngHighRes(selectedTarget.barcode!, selectedTarget.name)}
                          style={{
                            padding: '0.35rem 0.7rem',
                            borderRadius: '7px',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            color: '#334155',
                            fontSize: '0.76rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                          <span>Download</span>
                        </button>

                        <button
                          id="scan-print-label-btn"
                          type="button"
                          onClick={() => printProductBarcodeLabel(selectedTarget, shopName)}
                          style={{
                            padding: '0.35rem 0.7rem',
                            borderRadius: '7px',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            color: '#334155',
                            fontSize: '0.76rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="6 9 6 2 18 2 18 9" />
                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                            <rect x="6" y="14" width="12" height="8" />
                          </svg>
                          <span>Print</span>
                        </button>

                        <button
                          id="scan-remove-barcode-btn"
                          type="button"
                          onClick={handleRemoveBarcode}
                          style={{
                            padding: '0.35rem 0.7rem',
                            borderRadius: '7px',
                            border: '1px solid #fecaca',
                            background: '#fff1f2',
                            color: '#e11d48',
                            fontSize: '0.76rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                          <span>Remove</span>
                        </button>
                      </div>
                    </>
                  ) : (
                    /* Placeholder: No barcode yet */
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#64748b', padding: '0.35rem 0', width: '100%' }}>
                      <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', flexShrink: 0 }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 5v14M6 5v14M10 5v14M13 5v14M17 5v14M21 5v14" />
                        </svg>
                      </div>
                      <div>
                        <span style={{ fontSize: '0.86rem', fontWeight: 700, color: '#334155', display: 'block' }}>
                          No manufacturer barcode assigned yet
                        </span>
                        <span style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                          Scan pack with webcam, barcode gun, or phone below to assign
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Feedback notifications */}
                {feedback && (
                  <div
                    id="scan-dialog-feedback-msg"
                    style={{
                      padding: '0.75rem 1rem',
                      borderRadius: '10px',
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
                          ? '#bbf7d0'
                          : feedback.type === 'warning'
                          ? '#fde68a'
                          : feedback.type === 'error'
                          ? '#fecaca'
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
                      fontSize: '0.86rem',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.65rem',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {feedback.type === 'success' ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      ) : feedback.type === 'warning' ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                          <line x1="12" y1="9" x2="12" y2="13" />
                          <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                      ) : feedback.type === 'error' ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="15" y1="9" x2="9" y2="15" />
                          <line x1="9" y1="9" x2="15" y2="15" />
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0284c7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="12" y1="16" x2="12" y2="12" />
                          <line x1="12" y1="8" x2="12.01" y2="8" />
                        </svg>
                      )}
                      <span>{feedback.message}</span>
                    </div>

                    {feedback.conflictingTargetId !== undefined && (
                      <button
                        type="button"
                        onClick={() => handleJumpToConflict(feedback.conflictingTargetId!)}
                        style={{
                          padding: '0.25rem 0.65rem',
                          borderRadius: '6px',
                          border: '1px solid #b91c1c',
                          background: '#ffffff',
                          color: '#b91c1c',
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                        }}
                      >
                        <span>Show that product</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}

                {/* ── SCAN CONTROLS (CAMERA / USB GUN / MOBILE) ── */}
                <div
                  id="scan-active-capture-panel"
                  style={{
                    background: 'linear-gradient(135deg, #f8faff 0%, #f5f3ff 100%)',
                    border: '1.5px solid #6366f1',
                    borderRadius: '16px',
                    padding: '1.1rem 1.25rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.85rem',
                    boxShadow: '0 8px 25px -4px rgba(99, 102, 241, 0.18)',
                  }}
                >
                  <style>{`
                    #mfr-barcode-camera-view {
                      position: relative;
                      width: 100%;
                      max-width: 460px;
                      height: 190px;
                      border-radius: 12px;
                      overflow: hidden;
                      background: #090d16;
                      margin: 0 auto;
                    }
                    #mfr-barcode-camera-view video {
                      width: 100% !important;
                      height: 100% !important;
                      object-fit: cover !important;
                      border-radius: 12px !important;
                    }
                    #mfr-barcode-camera-view #mfr-barcode-camera-view__scan_region {
                      display: none !important;
                    }
                    #mfr-barcode-camera-view #mfr-barcode-camera-view__dashboard_section {
                      display: none !important;
                    }
                    @keyframes scanLaserSweep {
                      0% { top: 16%; opacity: 0.6; }
                      50% { top: 84%; opacity: 1; }
                      100% { top: 16%; opacity: 0.6; }
                    }
                    @keyframes scanLivePulse {
                      0% { transform: scale(0.95); opacity: 0.8; }
                      50% { transform: scale(1.2); opacity: 1; }
                      100% { transform: scale(0.95); opacity: 0.8; }
                    }
                  `}</style>

                  {/* Header & Mode Switcher Pills */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: isCameraActive ? '#10b981' : '#6366f1',
                          boxShadow: isCameraActive ? '0 0 8px #10b981' : '0 0 6px #6366f1',
                          display: 'inline-block',
                        }}
                      />
                      <strong style={{ fontSize: '0.94rem', color: '#1e1b4b' }}>
                        Assign Barcode to &quot;{selectedTarget.name}&quot;
                      </strong>
                    </div>

                    {/* Mode Switcher Tabs */}
                    <div
                      style={{
                        display: 'inline-flex',
                        background: '#e0e7ff',
                        padding: '3px',
                        borderRadius: '10px',
                        gap: '2px',
                      }}
                    >
                      <button
                        id="scan-mode-camera-btn"
                        type="button"
                        onClick={() => handleChangeScanMode('camera')}
                        style={{
                          padding: '0.3rem 0.65rem',
                          borderRadius: '8px',
                          border: 'none',
                          background: scanMode === 'camera' ? '#ffffff' : 'transparent',
                          color: scanMode === 'camera' ? '#4338ca' : '#475569',
                          fontWeight: 700,
                          fontSize: '0.78rem',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          boxShadow: scanMode === 'camera' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                          <circle cx="12" cy="13" r="4" />
                        </svg>
                        <span>Camera</span>
                        {isCameraActive && (
                          <span
                            style={{
                              width: '6px',
                              height: '6px',
                              borderRadius: '50%',
                              background: '#10b981',
                              animation: 'scanLivePulse 1.5s infinite',
                            }}
                          />
                        )}
                      </button>

                      <button
                        id="scan-mode-gun-btn"
                        type="button"
                        onClick={() => handleChangeScanMode('gun')}
                        style={{
                          padding: '0.3rem 0.65rem',
                          borderRadius: '8px',
                          border: 'none',
                          background: scanMode === 'gun' ? '#ffffff' : 'transparent',
                          color: scanMode === 'gun' ? '#4338ca' : '#475569',
                          fontWeight: 700,
                          fontSize: '0.78rem',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          boxShadow: scanMode === 'gun' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="3" y1="5" x2="3" y2="19" />
                          <line x1="7" y1="5" x2="7" y2="19" />
                          <line x1="11" y1="5" x2="11" y2="19" />
                          <line x1="15" y1="5" x2="15" y2="19" />
                          <line x1="19" y1="5" x2="19" y2="19" />
                        </svg>
                        <span>Barcode Gun / Manual</span>
                      </button>

                      <button
                        id="scan-mode-mobile-btn"
                        type="button"
                        onClick={() => handleChangeScanMode('mobile')}
                        style={{
                          padding: '0.3rem 0.65rem',
                          borderRadius: '8px',
                          border: 'none',
                          background: scanMode === 'mobile' ? '#ffffff' : 'transparent',
                          color: scanMode === 'mobile' ? '#4338ca' : '#475569',
                          fontWeight: 700,
                          fontSize: '0.78rem',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          boxShadow: scanMode === 'mobile' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="5" y="2" width="14" height="20" rx="2" />
                          <line x1="12" y1="18" x2="12.01" y2="18" />
                        </svg>
                        <span>Phone</span>
                        {isMobileConnected && (
                          <span style={{ fontSize: '0.65rem', background: '#dcfce7', color: '#15803d', padding: '1px 4px', borderRadius: '4px' }}>
                            Linked
                          </span>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* ── MODE 1: CAMERA SCANNER (WEBCAM / DEVICE CAMERA) ── */}
                  {scanMode === 'camera' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', alignItems: 'center' }}>
                      {/* Interactive Viewport Box */}
                      <div
                        style={{
                          position: 'relative',
                          width: '100%',
                          maxWidth: '460px',
                          height: '190px',
                          borderRadius: '14px',
                          overflow: 'hidden',
                          background: '#090d16',
                          boxShadow: '0 4px 18px rgba(15, 23, 42, 0.25)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {/* Target node for Html5Qrcode video mounting */}
                        <div id="mfr-barcode-camera-view" style={{ width: '100%', height: '100%' }} />

                        {/* Camera Starting / Loading Spinner */}
                        {isStartingCamera && (
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              background: 'rgba(9, 13, 22, 0.85)',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '0.5rem',
                              color: '#ffffff',
                              zIndex: 15,
                            }}
                          >
                            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2.5" style={{ animation: 'spin 1s linear infinite' }}>
                              <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                              <path d="M12 2a10 10 0 0 1 10 10" />
                            </svg>
                            <span style={{ fontSize: '0.84rem', fontWeight: 600 }}>Accessing camera...</span>
                          </div>
                        )}

                        {/* Ready / Idle state when camera is not running */}
                        {!isCameraActive && !isStartingCamera && (
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              background: 'linear-gradient(180deg, #0f172a 0%, #1e1b4b 100%)',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              padding: '1rem',
                              textAlign: 'center',
                              color: '#f8fafc',
                              zIndex: 12,
                              gap: '0.45rem',
                            }}
                          >
                            <div
                              style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '12px',
                                background: 'rgba(99, 102, 241, 0.2)',
                                border: '1px solid rgba(99, 102, 241, 0.4)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#a5b4fc',
                              }}
                            >
                              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                                <circle cx="12" cy="13" r="4" />
                              </svg>
                            </div>
                            <div style={{ fontSize: '0.92rem', fontWeight: 700, color: '#ffffff' }}>
                              Camera Scanner Ready
                            </div>
                            <button
                              id="scan-start-camera-feed-btn"
                              type="button"
                              onClick={() => startCamera()}
                              style={{
                                padding: '0.45rem 1.25rem',
                                borderRadius: '9px',
                                border: 'none',
                                background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
                                color: '#ffffff',
                                fontWeight: 700,
                                fontSize: '0.84rem',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.45rem',
                                boxShadow: '0 4px 14px rgba(99, 102, 241, 0.45)',
                                transition: 'all 0.15s ease',
                              }}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="5 3 19 12 5 21 5 3" />
                              </svg>
                              <span>Start Camera Scanner</span>
                            </button>
                            <span style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                              Hold product packaging barcode up to your webcam
                            </span>
                          </div>
                        )}

                        {/* Active Camera Viewfinder HUD */}
                        {isCameraActive && (
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              pointerEvents: 'none',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              zIndex: 10,
                            }}
                          >
                            {/* Central Reticle Box */}
                            <div
                              style={{
                                position: 'relative',
                                width: '74%',
                                height: '64%',
                                border: '1px solid rgba(255, 255, 255, 0.25)',
                                borderRadius: '8px',
                                boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.3)',
                              }}
                            >
                              {/* 4 Corner Brackets */}
                              <div style={{ position: 'absolute', top: -2, left: -2, width: '16px', height: '16px', borderTop: '3px solid #6366f1', borderLeft: '3px solid #6366f1' }} />
                              <div style={{ position: 'absolute', top: -2, right: -2, width: '16px', height: '16px', borderTop: '3px solid #6366f1', borderRight: '3px solid #6366f1' }} />
                              <div style={{ position: 'absolute', bottom: -2, left: -2, width: '16px', height: '16px', borderBottom: '3px solid #6366f1', borderLeft: '3px solid #6366f1' }} />
                              <div style={{ position: 'absolute', bottom: -2, right: -2, width: '16px', height: '16px', borderBottom: '3px solid #6366f1', borderRight: '3px solid #6366f1' }} />

                              {/* Animated Red Laser Scanning Beam */}
                              <div
                                style={{
                                  position: 'absolute',
                                  left: '4%',
                                  right: '4%',
                                  height: '2px',
                                  background: 'linear-gradient(90deg, transparent 0%, #ef4444 30%, #f87171 50%, #ef4444 70%, transparent 100%)',
                                  boxShadow: '0 0 8px #ef4444, 0 0 3px #f87171',
                                  animation: 'scanLaserSweep 2s ease-in-out infinite',
                                }}
                              />
                            </div>

                            {/* Live Instruction Pill */}
                            <div
                              style={{
                                position: 'absolute',
                                bottom: '8px',
                                padding: '3px 10px',
                                borderRadius: '20px',
                                background: 'rgba(15, 23, 42, 0.78)',
                                backdropFilter: 'blur(4px)',
                                color: '#ffffff',
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                              }}
                            >
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 6px #10b981' }} />
                              <span>Point product barcode (e.g. Marie Gold) into frame</span>
                            </div>

                            {/* Successful Scan Flash */}
                            {cameraScanSuccessFlash && (
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  background: 'rgba(16, 185, 129, 0.4)',
                                  backdropFilter: 'blur(2px)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: '#ffffff',
                                  fontSize: '0.96rem',
                                  fontWeight: 800,
                                }}
                              >
                                <div style={{ background: '#10b981', padding: '6px 16px', borderRadius: '20px', boxShadow: '0 4px 12px rgba(0,0,0,0.25)' }}>
                                  Barcode Detected!
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Camera Controls Bar: Switch Camera & Stop */}
                      {isCameraActive && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: '460px', gap: '0.5rem' }}>
                          {availableCameras.length > 1 ? (
                            <select
                              id="scan-camera-select"
                              value={selectedCameraId || ''}
                              onChange={(e) => handleSwitchCamera(e.target.value)}
                              style={{
                                padding: '0.35rem 0.65rem',
                                borderRadius: '8px',
                                border: '1px solid #cbd5e1',
                                background: '#ffffff',
                                fontSize: '0.78rem',
                                color: '#334155',
                                outline: 'none',
                                cursor: 'pointer',
                                flex: 1,
                              }}
                            >
                              {availableCameras.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.label || `Camera ${c.id.slice(0, 6)}`}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span style={{ fontSize: '0.76rem', color: '#15803d', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
                              Active Live Stream
                            </span>
                          )}

                          <button
                            id="scan-stop-camera-btn"
                            type="button"
                            onClick={() => stopCamera()}
                            style={{
                              padding: '0.35rem 0.85rem',
                              borderRadius: '8px',
                              border: '1px solid #cbd5e1',
                              background: '#ffffff',
                              color: '#475569',
                              fontWeight: 600,
                              fontSize: '0.78rem',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="4" y="4" width="16" height="16" rx="2" />
                            </svg>
                            <span>Pause Camera</span>
                          </button>
                        </div>
                      )}

                      {/* Camera Error Message */}
                      {cameraError && (
                        <div
                          style={{
                            width: '100%',
                            maxWidth: '460px',
                            padding: '0.65rem 0.85rem',
                            borderRadius: '8px',
                            background: '#fef2f2',
                            border: '1px solid #fecaca',
                            color: '#b91c1c',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '0.5rem',
                          }}
                        >
                          <span>{cameraError}</span>
                          <button
                            type="button"
                            onClick={() => handleChangeScanMode('gun')}
                            style={{
                              padding: '0.25rem 0.55rem',
                              borderRadius: '6px',
                              background: '#ffffff',
                              border: '1px solid #b91c1c',
                              color: '#b91c1c',
                              fontSize: '0.74rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            Switch to Gun
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── MODE 2: BARCODE GUN / MANUAL ENTRY ── */}
                  {scanMode === 'gun' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {/* Active Status Banner */}
                      <div
                        style={{
                          padding: '0.75rem 1rem',
                          background: 'linear-gradient(135deg, #ffffff 0%, #f0fdf4 100%)',
                          border: '1.5px solid #86efac',
                          borderRadius: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '0.75rem',
                          boxShadow: '0 2px 6px rgba(16, 185, 129, 0.08)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                          <span
                            style={{
                              width: '10px',
                              height: '10px',
                              borderRadius: '50%',
                              background: '#10b981',
                              boxShadow: '0 0 10px #10b981',
                              animation: 'scanLivePulse 1.5s infinite',
                            }}
                          />
                          <div>
                            <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#166534' }}>
                              Hardware Barcode Gun Ready & Listening
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#15803d', marginTop: '1px' }}>
                              Point your USB/Bluetooth laser gun at Marie Gold or any pack and pull the trigger.
                            </div>
                          </div>
                        </div>

                        {lastGunScan && (
                          <span
                            style={{
                              fontSize: '0.74rem',
                              fontWeight: 700,
                              fontFamily: 'monospace',
                              background: '#dcfce7',
                              color: '#166534',
                              padding: '2px 8px',
                              borderRadius: '6px',
                              border: '1px solid #bbf7d0',
                            }}
                          >
                            Last Gun Scan: {lastGunScan}
                          </span>
                        )}
                      </div>

                      {/* Rapid Input Field with autofocus */}
                      <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center' }}>
                        <div style={{ position: 'relative', flex: 1 }}>
                          <span
                            style={{
                              position: 'absolute',
                              left: '12px',
                              top: '50%',
                              transform: 'translateY(-50%)',
                              color: '#6366f1',
                              display: 'flex',
                              alignItems: 'center',
                            }}
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="3" y1="5" x2="3" y2="19" />
                              <line x1="7" y1="5" x2="7" y2="19" />
                              <line x1="11" y1="5" x2="11" y2="19" />
                              <line x1="15" y1="5" x2="15" y2="19" />
                              <line x1="19" y1="5" x2="19" y2="19" />
                              <line x1="22" y1="5" x2="22" y2="19" />
                            </svg>
                          </span>
                          <input
                            ref={scanInputRef}
                            id="scan-active-barcode-input"
                            type="text"
                            value={scanInput}
                            onChange={(e) => setScanInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const code = scanInput.trim() || gunKeystrokeBufferRef.current.trim();
                                if (code) {
                                  setLastGunScan(code);
                                  handleProcessScan(code);
                                }
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                setScanInput('');
                                setFeedback(null);
                              }
                            }}
                            placeholder="Pull trigger on barcode scanner gun or type numbers and press Enter..."
                            style={{
                              width: '100%',
                              padding: '0.7rem 0.85rem 0.7rem 2.5rem',
                              borderRadius: '10px',
                              border: '2px solid #6366f1',
                              fontSize: '0.98rem',
                              fontFamily: 'monospace',
                              fontWeight: 700,
                              outline: 'none',
                              background: '#ffffff',
                              color: '#0f172a',
                              boxSizing: 'border-box',
                              boxShadow: '0 0 0 3px rgba(99, 102, 241, 0.15)',
                            }}
                          />
                        </div>

                        <button
                          id="scan-assign-submit-btn"
                          type="button"
                          onClick={() => {
                            const code = scanInput.trim() || gunKeystrokeBufferRef.current.trim();
                            if (code) {
                              setLastGunScan(code);
                              handleProcessScan(code);
                            }
                          }}
                          style={{
                            padding: '0.7rem 1.3rem',
                            borderRadius: '10px',
                            border: 'none',
                            background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
                            color: '#ffffff',
                            fontWeight: 700,
                            fontSize: '0.9rem',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            boxShadow: '0 4px 12px rgba(99, 102, 241, 0.35)',
                            whiteSpace: 'nowrap',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span>Assign</span>
                        </button>

                        <button
                          id="scan-cancel-btn"
                          type="button"
                          onClick={() => {
                            setScanInput('');
                            setFeedback(null);
                          }}
                          style={{
                            padding: '0.7rem 1rem',
                            borderRadius: '10px',
                            border: '1px solid #cbd5e1',
                            background: '#ffffff',
                            color: '#475569',
                            fontWeight: 600,
                            fontSize: '0.9rem',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── MODE 3: MOBILE PHONE SCANNER ── */}
                  {scanMode === 'mobile' && (
                    <div
                      style={{
                        padding: '1.1rem',
                        background: '#ffffff',
                        borderRadius: '14px',
                        border: '1px solid #e2e8f0',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.85rem',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                      }}
                    >
                      {/* Connection Protocol Selector: Local Wi-Fi vs Cloudflare Tunnel */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                          <span
                            style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              background: isMobileConnected ? '#10b981' : '#f59e0b',
                              boxShadow: isMobileConnected ? '0 0 6px #10b981' : '0 0 6px #f59e0b',
                            }}
                          />
                          <strong style={{ fontSize: '0.88rem', color: isMobileConnected ? '#15803d' : '#0f172a' }}>
                            {isMobileConnected ? 'Phone Scanner Connected & Ready' : 'Connect Your Phone Camera'}
                          </strong>
                        </div>

                        {/* Connection Switcher Buttons */}
                        <div style={{ display: 'inline-flex', background: '#f1f5f9', padding: '3px', borderRadius: '10px', gap: '3px' }}>
                          <button
                            type="button"
                            onClick={() => setMobileConnectionType('tunnel')}
                            style={{
                              padding: '0.35rem 0.75rem',
                              borderRadius: '7px',
                              border: 'none',
                              background: mobileConnectionType === 'tunnel' ? '#ffffff' : 'transparent',
                              color: mobileConnectionType === 'tunnel' ? '#4338ca' : '#64748b',
                              fontWeight: 800,
                              fontSize: '0.76rem',
                              cursor: 'pointer',
                              boxShadow: mobileConnectionType === 'tunnel' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '5px',
                            }}
                          >
                            <span>Live Scanner (HTTPS)</span>
                            <span style={{ fontSize: '0.62rem', background: '#dcfce7', color: '#15803d', padding: '1px 5px', borderRadius: '4px' }}>
                              Recommended
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setMobileConnectionType('wifi')}
                            style={{
                              padding: '0.35rem 0.75rem',
                              borderRadius: '7px',
                              border: 'none',
                              background: mobileConnectionType === 'wifi' ? '#ffffff' : 'transparent',
                              color: mobileConnectionType === 'wifi' ? '#4338ca' : '#64748b',
                              fontWeight: 700,
                              fontSize: '0.76rem',
                              cursor: 'pointer',
                              boxShadow: mobileConnectionType === 'wifi' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                            }}
                          >
                            Local Wi-Fi (IP)
                          </button>
                        </div>
                      </div>

                      {/* Main QR Box & Instructions */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', gap: '1.2rem', flexWrap: 'wrap' }}>
                        {/* QR Code */}
                        {activeMobileUrl ? (
                          <div
                            style={{
                              padding: '8px',
                              background: '#ffffff',
                              borderRadius: '12px',
                              border: '1.5px solid #e2e8f0',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                            }}
                            dangerouslySetInnerHTML={{ __html: qrSvg(activeMobileUrl, { size: 135, margin: 1 }) }}
                          />
                        ) : (
                          <div style={{ width: '135px', height: '135px', background: '#f8fafc', borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontSize: '0.78rem', color: '#6366f1', gap: '8px', padding: '10px', textAlign: 'center' }}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5" style={{ animation: 'spin 1s linear infinite' }}>
                              <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                              <path d="M12 2a10 10 0 0 1 10 10" />
                            </svg>
                            <span>Preparing Live HTTPS QR...</span>
                          </div>
                        )}

                        {/* Guide & Controls */}
                        <div style={{ flex: 1, minWidth: '220px' }}>
                          {mobileConnectionType === 'tunnel' ? (
                            <div>
                              <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#1e293b', marginBottom: '0.25rem' }}>
                                Wireless Live Laser Scanner (Continuous Video)
                              </div>
                              <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.78rem', color: '#64748b', lineHeight: 1.45 }}>
                                Point your phone camera at this QR code to open the <strong>live viewfinder with red laser bar</strong>. It streams your phone camera continuously and detects barcodes instantly (no photo taking needed).
                              </p>
                              {scannerNetworkInfo?.tunnelUrl && scannerNetworkInfo?.isTunnelAlive ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                  <div style={{ fontSize: '0.76rem', color: '#16a34a', fontWeight: 700, background: '#f0fdf4', padding: '6px 10px', borderRadius: '8px', border: '1px solid #bbf7d0', wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', flexShrink: 0, boxShadow: '0 0 6px #22c55e' }}></span>
                                    <span>Active Live URL: {scannerNetworkInfo.tunnelUrl}</span>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                    <button
                                      type="button"
                                      onClick={() => handleStartPublicTunnel(true)}
                                      disabled={isStartingTunnel}
                                      style={{
                                        padding: '4px 10px',
                                        borderRadius: '6px',
                                        border: '1px solid #cbd5e1',
                                        background: '#f8fafc',
                                        color: '#334155',
                                        fontSize: '0.74rem',
                                        fontWeight: 700,
                                        cursor: isStartingTunnel ? 'wait' : 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '5px',
                                      }}
                                    >
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={isStartingTunnel ? { animation: 'spin 1s linear infinite' } : {}}>
                                        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                                      </svg>
                                      <span>{isStartingTunnel ? 'Generating...' : 'Refresh QR / Reconnect'}</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (activeMobileUrl) {
                                          navigator.clipboard?.writeText(activeMobileUrl);
                                          setCopySuccess(true);
                                          setTimeout(() => setCopySuccess(false), 2000);
                                        }
                                      }}
                                      style={{
                                        padding: '4px 10px',
                                        borderRadius: '6px',
                                        border: '1px solid #cbd5e1',
                                        background: copySuccess ? '#f0fdf4' : '#f8fafc',
                                        color: copySuccess ? '#15803d' : '#334155',
                                        fontSize: '0.74rem',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '5px',
                                      }}
                                    >
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                      </svg>
                                      <span>{copySuccess ? 'Copied!' : 'Copy Link'}</span>
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleStartPublicTunnel(true)}
                                  disabled={isStartingTunnel}
                                  style={{
                                    padding: '0.5rem 1rem',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                                    color: '#ffffff',
                                    fontWeight: 700,
                                    fontSize: '0.8rem',
                                    cursor: isStartingTunnel ? 'wait' : 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    boxShadow: '0 2px 8px rgba(2, 132, 199, 0.3)',
                                  }}
                                >
                                  {isStartingTunnel ? (
                                    <>
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" style={{ animation: 'spin 1s linear infinite' }}>
                                        <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                                        <path d="M12 2a10 10 0 0 1 10 10" />
                                      </svg>
                                      <span>Generating Secure Tunnel...</span>
                                    </>
                                  ) : (
                                    <>
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                                      </svg>
                                      <span>Start Live HTTPS Scanner</span>
                                    </>
                                  )}
                                </button>
                              )}
                              {tunnelError && (
                                <div style={{ color: '#dc2626', fontSize: '0.74rem', marginTop: '0.35rem', fontWeight: 600 }}>
                                  {tunnelError}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div>
                              <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#1e293b', marginBottom: '0.25rem' }}>
                                Direct Local Wi-Fi Connection
                              </div>
                              <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.78rem', color: '#64748b', lineHeight: 1.45 }}>
                                Use only when on the same Wi-Fi. <em>Note: Android Chrome restricts continuous live video stream over plain HTTP IP. For live video, use &quot;Live Scanner (HTTPS)&quot; above.</em>
                              </p>
                              <div style={{ fontSize: '0.76rem', color: '#0f172a', background: '#f8fafc', padding: '6px 10px', borderRadius: '8px', border: '1px solid #e2e8f0', wordBreak: 'break-all', fontFamily: 'monospace' }}>
                                {localWifiUrl}
                              </div>
                            </div>
                          )}

                          {activeMobileUrl && (
                            <div style={{ marginTop: '0.65rem' }}>
                              <a
                                href={activeMobileUrl}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                  fontSize: '0.76rem',
                                  color: '#4f46e5',
                                  fontWeight: 600,
                                  textDecoration: 'underline',
                                }}
                              >
                                Open Scanner URL in New Tab
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Option checkbox */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.65rem',
                    fontSize: '0.86rem',
                    color: '#334155',
                    cursor: 'pointer',
                    userSelect: 'none',
                    padding: '0.2rem 0',
                  }}
                >
                  <input
                    id="scan-auto-advance-checkbox"
                    type="checkbox"
                    checked={autoAdvance}
                    onChange={(e) => setAutoAdvance(e.target.checked)}
                    style={{
                      width: '18px',
                      height: '18px',
                      accentColor: '#6366f1',
                      cursor: 'pointer',
                      borderRadius: '4px',
                    }}
                  />
                  <span style={{ fontWeight: 500 }}>
                    After a successful scan, automatically move to the next product without a barcode and keep scanning
                  </span>
                </label>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '4rem 1rem', color: '#94a3b8' }}>
                <div style={{ display: 'inline-flex', padding: '14px', borderRadius: '50%', background: '#f8fafc', marginBottom: '0.8rem' }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.8">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <line x1="8" y1="21" x2="16" y2="21" />
                    <line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                </div>
                <div style={{ fontSize: '0.96rem', fontWeight: 700, color: '#475569' }}>No product selected</div>
                <div style={{ fontSize: '0.84rem', marginTop: '0.3rem' }}>Select a product from the list to view and scan its barcode.</div>
              </div>
            )}
          </div>
        </div>

        {/* ── FOOTER ── */}
        <div
          style={{
            padding: '1rem 1.6rem',
            borderTop: '1px solid #f1f5f9',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#ffffff',
            flexShrink: 0,
          }}
        >
          {/* Progress Section */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', width: '420px', maxWidth: '55%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '0.84rem', fontWeight: 600, color: '#334155' }}>
                <strong>{hasBarcodeCount}</strong> of <strong>{totalCount}</strong> products have a barcode
                {scannedNowCount > 0 && (
                  <span style={{ color: '#15803d', fontWeight: 700 }}> • {scannedNowCount} scanned now</span>
                )}
              </div>
              <span
                style={{
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  color: progressPercent === 100 ? '#15803d' : '#4f46e5',
                  background: progressPercent === 100 ? '#ecfdf5' : '#eef2ff',
                  padding: '2px 7px',
                  borderRadius: '10px',
                }}
              >
                {progressPercent}%
              </span>
            </div>
            {/* Smooth Progress Bar */}
            <div
              style={{
                width: '100%',
                height: '8px',
                background: '#e2e8f0',
                borderRadius: '9999px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${progressPercent}%`,
                  height: '100%',
                  background: progressPercent === 100 ? '#10b981' : 'linear-gradient(90deg, #6366f1 0%, #10b981 100%)',
                  borderRadius: '9999px',
                  transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
              />
            </div>
          </div>

          {/* Action buttons: Undo & Done */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {lastAssignment && (
              <button
                id="scan-undo-btn"
                type="button"
                onClick={handleUndo}
                style={{
                  padding: '0.55rem 1.1rem',
                  borderRadius: '10px',
                  border: '1.5px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#334155',
                  fontWeight: 600,
                  fontSize: '0.84rem',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#f8fafc';
                  e.currentTarget.style.borderColor = '#94a3b8';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = '#ffffff';
                  e.currentTarget.style.borderColor = '#cbd5e1';
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7v6h6" />
                  <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
                </svg>
                <span>Undo last scan</span>
              </button>
            )}

            <button
              id="scan-done-btn"
              type="button"
              onClick={handleModalClose}
              style={{
                padding: '0.6rem 1.8rem',
                borderRadius: '10px',
                border: 'none',
                background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '0.9rem',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                boxShadow: '0 4px 14px rgba(99, 102, 241, 0.35)',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 6px 18px rgba(99, 102, 241, 0.45)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 14px rgba(99, 102, 241, 0.35)';
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Done</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
