import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';

interface MobileScannerProps {
  sessionId: string;
}

interface ScannedHistoryItem {
  id: string;
  barcode: string;
  time: string;
  status: 'sent' | 'error';
}

export const MobileScanner: React.FC<MobileScannerProps> = ({ sessionId }) => {
  const isSecure = typeof window !== 'undefined' && (Boolean(window.isSecureContext) || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const [activeMode, setActiveMode] = useState<'live' | 'snap' | 'manual'>(isSecure ? 'live' : 'snap');
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [flashSuccess, setFlashSuccess] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [history, setHistory] = useState<ScannedHistoryItem[]>([]);
  const [manualCode, setManualCode] = useState('');
  const [isSubmittingManual, setIsSubmittingManual] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [availableCameras, setAvailableCameras] = useState<any[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [networkInfo, setNetworkInfo] = useState<{ tunnelUrl?: string; isTunnelAlive?: boolean } | null>(null);

  useEffect(() => {
    fetch('/api/scanner/network-info')
      .then((r) => r.json())
      .then((d) => setNetworkInfo(d))
      .catch(() => {});
  }, []);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanTimeRef = useRef<{ [code: string]: number }>({});
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Play crisp POS checkout beep sound
  const playBeep = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1850, ctx.currentTime);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch {}
  };

  // Heartbeat to POS server
  useEffect(() => {
    let timer: any;
    const sendHeartbeat = async () => {
      try {
        const res = await fetch('/api/scanner/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            deviceInfo: `${navigator.platform || ''} ${navigator.userAgent.slice(0, 50)}`,
          }),
        });
        if (res.ok) {
          setIsConnected(true);
        } else {
          setIsConnected(false);
        }
      } catch {
        setIsConnected(false);
      }
    };

    sendHeartbeat();
    timer = setInterval(sendHeartbeat, 5000);
    return () => clearInterval(timer);
  }, [sessionId]);

  // Dispatch scanned barcode to POS terminal
  const dispatchBarcode = async (code: string) => {
    const clean = code.trim();
    if (!clean) return;

    // Debounce duplicate scans: 2500ms cooldown for the same barcode, and 1000ms cooldown between ANY scans
    const now = Date.now();
    if (lastScanTimeRef.current[clean] && now - lastScanTimeRef.current[clean] < 2500) {
      return;
    }
    if (lastScanTimeRef.current['__LAST_GLOBAL__'] && now - lastScanTimeRef.current['__LAST_GLOBAL__'] < 1000) {
      return;
    }
    lastScanTimeRef.current[clean] = now;
    lastScanTimeRef.current['__LAST_GLOBAL__'] = now;

    playBeep();
    if (window.navigator?.vibrate) {
      try {
        window.navigator.vibrate(120);
      } catch {}
    }

    setFlashSuccess(true);
    setTimeout(() => setFlashSuccess(false), 600);
    setLastScanned(clean);

    try {
      const res = await fetch('/api/scanner/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          barcode: clean,
          deviceInfo: navigator.userAgent.slice(0, 40),
        }),
      });

      const newItem: ScannedHistoryItem = {
        id: String(now),
        barcode: clean,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        status: res.ok ? 'sent' : 'error',
      };
      setHistory((prev) => [newItem, ...prev.slice(0, 24)]);
    } catch {
      const newItem: ScannedHistoryItem = {
        id: String(now),
        barcode: clean,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        status: 'error',
      };
      setHistory((prev) => [newItem, ...prev.slice(0, 24)]);
    }
  };

  // Start continuous live camera stream
  useEffect(() => {
    if (activeMode !== 'live') {
      if (scannerRef.current && isScanning) {
        scannerRef.current.stop().catch(() => {});
        setIsScanning(false);
      }
      return;
    }

    let isMounted = true;

    async function initCamera() {
      try {
        setCameraError(null);
        if (!isSecure) {
          setCameraError('Live video viewfinder requires HTTPS. Tap "Activate Live Scanner" above or use Snapshot mode below.');
          return;
        }

        const container = document.getElementById('qr-reader-interactive');
        if (!container || !isMounted) return;

        // If scanner is currently active, stop it before re-initializing
        if (scannerRef.current) {
          if (scannerRef.current.isScanning) {
            try { await scannerRef.current.stop(); } catch {}
          }
        } else {
          scannerRef.current = new Html5Qrcode('qr-reader-interactive', {
            formatsToSupport: [
              Html5QrcodeSupportedFormats.EAN_13,
              Html5QrcodeSupportedFormats.EAN_8,
              Html5QrcodeSupportedFormats.CODE_128,
              Html5QrcodeSupportedFormats.CODE_39,
              Html5QrcodeSupportedFormats.UPC_A,
              Html5QrcodeSupportedFormats.UPC_E,
              Html5QrcodeSupportedFormats.QR_CODE,
            ],
            verbose: false,
          });
        }

        // Use selected camera ID if user manually chose one, otherwise request rear camera directly
        const cameraTarget: any = selectedCameraId
          ? selectedCameraId
          : { facingMode: 'environment' };

        try {
          await scannerRef.current.start(
            cameraTarget,
            {
              fps: 20,
              qrbox: (viewfinderWidth, viewfinderHeight) => {
                const width = Math.min(320, Math.floor(viewfinderWidth * 0.88));
                const height = Math.min(220, Math.floor(viewfinderHeight * 0.62));
                return { width, height };
              },
              aspectRatio: 1.333,
            },
            (decodedText) => {
              dispatchBarcode(decodedText);
            },
            () => {}
          );
          if (isMounted) {
            setIsScanning(true);
            setCameraError(null);
          }
        } catch (startErr: any) {
          // If specific rear camera constraint failed, try user facing or default
          if (!selectedCameraId) {
            await scannerRef.current.start(
              { facingMode: 'user' },
              {
                fps: 20,
                qrbox: (w, h) => ({
                  width: Math.min(320, Math.floor(w * 0.88)),
                  height: Math.min(220, Math.floor(h * 0.62)),
                }),
                aspectRatio: 1.333,
              },
              (decodedText) => dispatchBarcode(decodedText),
              () => {}
            );
            if (isMounted) {
              setIsScanning(true);
              setCameraError(null);
            }
          } else {
            throw startErr;
          }
        }

        // Camera stream is running! Now enumerate cameras so the user can use the Flip button
        try {
          const devices = await Html5Qrcode.getCameras();
          if (isMounted && devices && devices.length > 0) {
            setAvailableCameras(devices);
          }
        } catch {}
      } catch (err: any) {
        if (!isMounted) return;
        const msg = String(err?.message || err);
        console.warn('Camera stream error:', msg);
        setIsScanning(false);
        if (msg.includes('NotSupportedError') || msg.includes('secure context') || !window.isSecureContext) {
          setCameraError('Live video requires HTTPS. Use Snapshot (Photo Shutter) mode below.');
        } else if (msg.includes('NotAllowedError') || msg.includes('Permission') || msg.includes('denied')) {
          setCameraError('Camera access was blocked. Tap "Retry Camera Access" below and tap "Allow" when prompted.');
        } else {
          setCameraError('Could not start live camera. Tap "Retry Camera Access" or switch to Snapshot mode.');
        }
      }
    }

    const t = setTimeout(() => {
      initCamera();
    }, 200);

    return () => {
      isMounted = false;
      clearTimeout(t);
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch(() => {});
        setIsScanning(false);
      }
    };
  }, [activeMode, selectedCameraId, isSecure]);

  // Handle Snapshot image decode
  const handleSnapFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const tempScanner = new Html5Qrcode('file-scanner-temp');
      const decodedResult = await tempScanner.scanFileV2(file, false);
      if (decodedResult?.decodedText) {
        dispatchBarcode(decodedResult.decodedText);
      } else {
        alert('Could not detect barcode in that image. Please try aiming closer to the barcode sticker.');
      }
    } catch (err: any) {
      alert('Could not detect barcode. Please hold the barcode flat in good lighting and try again.');
    } finally {
      e.target.value = '';
    }
  };

  // Toggle Torch / Flashlight
  const toggleTorch = async () => {
    if (!scannerRef.current || !isScanning) return;
    try {
      const apply = !torchOn;
      await scannerRef.current.applyVideoConstraints({
        advanced: [{ torch: apply } as any],
      });
      setTorchOn(apply);
    } catch {
      alert('Torch is not supported by this camera hardware.');
    }
  };

  // Switch between available cameras
  const cycleCamera = () => {
    if (availableCameras.length <= 1) return;
    const currentIdx = availableCameras.findIndex((c) => c.id === selectedCameraId);
    const nextIdx = (currentIdx + 1) % availableCameras.length;
    setSelectedCameraId(availableCameras[nextIdx].id);
  };

  // Submit manual barcode
  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    setIsSubmittingManual(true);
    dispatchBarcode(manualCode.trim());
    setManualCode('');
    setIsSubmittingManual(false);
  };

  return (
    <div className={`mobile-scanner-viewport ${flashSuccess ? 'flash-active' : ''}`}>
      {/* Top Mobile App Header */}
      <header className="mobile-scanner-header">
        <div className="mobile-brand-row">
          <div className="mobile-brand-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M3 5v14M8 5v14M12 5v14M17 5v14M21 5v14" />
            </svg>
          </div>
          <div>
            <h1 className="mobile-brand-title">AtrioWings Mobile Scanner</h1>
            <div className="mobile-session-tag">
              <span>Terminal #{sessionId}</span>
            </div>
          </div>
        </div>

        <div className="mobile-header-status">
          <div className={`mobile-status-pill ${isConnected ? 'online' : 'connecting'}`}>
            <span className="mobile-status-dot"></span>
            <span>{isConnected ? 'POS Connected' : 'Connecting...'}</span>
          </div>
        </div>
      </header>

      {/* HTTPS Upgrade Banner for Continuous Live Laser Barcode Scanner */}
      {typeof window !== 'undefined' && window.location.protocol !== 'https:' && (
        <div
          style={{
            margin: '10px 14px 4px',
            background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
            borderRadius: '14px',
            padding: '12px 14px',
            color: '#ffffff',
            boxShadow: '0 4px 16px rgba(79, 70, 229, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', color: '#fef08a' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </span>
            <div>
              <div style={{ fontWeight: 800, fontSize: '0.88rem' }}>Activate Live Laser Scanner</div>
              <div style={{ fontSize: '0.72rem', opacity: 0.9, marginTop: '2px', lineHeight: 1.3 }}>
                Switch to HTTPS to scan live continuously without taking photos.
              </div>
            </div>
          </div>
          {networkInfo?.tunnelUrl ? (
            <button
              type="button"
              onClick={() => {
                window.location.href = `${networkInfo.tunnelUrl}/scanner?session=${encodeURIComponent(sessionId)}`;
              }}
              style={{
                padding: '8px 14px',
                background: '#ffffff',
                color: '#4338ca',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 800,
                fontSize: '0.78rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <span>Switch Now</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={async () => {
                try {
                  const res = await fetch('/api/scanner/restart-tunnel', { method: 'POST' });
                  const data = await res.json();
                  if (data.ok && data.tunnelUrl) {
                    window.location.href = `${data.tunnelUrl}/scanner?session=${encodeURIComponent(sessionId)}`;
                  }
                } catch {}
              }}
              style={{
                padding: '8px 14px',
                background: '#ffffff',
                color: '#4338ca',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 800,
                fontSize: '0.78rem',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <span>Launch Live</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Mode Selector Tabs */}
      <nav className="mobile-mode-tabs">
        <button
          type="button"
          className={`mobile-tab-btn ${activeMode === 'live' ? 'active' : ''}`}
          onClick={() => setActiveMode('live')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          <span>Live Video</span>
        </button>

        <button
          type="button"
          className={`mobile-tab-btn ${activeMode === 'snap' ? 'active' : ''}`}
          onClick={() => setActiveMode('snap')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
          <span>Camera Snap</span>
        </button>

        <button
          type="button"
          className={`mobile-tab-btn ${activeMode === 'manual' ? 'active' : ''}`}
          onClick={() => setActiveMode('manual')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <line x1="6" y1="8" x2="6" y2="8" />
            <line x1="10" y1="8" x2="10" y2="8" />
            <line x1="14" y1="8" x2="14" y2="8" />
            <line x1="18" y1="8" x2="18" y2="8" />
            <line x1="6" y1="12" x2="18" y2="12" />
          </svg>
          <span>Keypad</span>
        </button>
      </nav>

      {/* Main View Area */}
      <main className="mobile-scanner-main">
        {/* MODE 1: LIVE CONTINUOUS STREAM */}
        {activeMode === 'live' && (
          <div className="mobile-live-container">
            <div className="mobile-viewfinder-card">
              <div id="qr-reader-interactive" className="mobile-interactive-viewport"></div>

              {/* Viewfinder Overlays: Laser Bar & Reticle Corners */}
              {isScanning && !cameraError && (
                <>
                  <div className="scanner-laser-bar"></div>
                  <div className="reticle-corner top-left"></div>
                  <div className="reticle-corner top-right"></div>
                  <div className="reticle-corner bottom-left"></div>
                  <div className="reticle-corner bottom-right"></div>
                </>
              )}

              {/* Viewfinder Starting Loader */}
              {!isScanning && !cameraError && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(15, 23, 42, 0.94)',
                    color: '#f8fafc',
                    zIndex: 20,
                    gap: '12px',
                    padding: '20px',
                    textAlign: 'center',
                  }}
                >
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5" style={{ animation: 'spin 1s linear infinite' }}>
                    <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                    <path d="M12 2a10 10 0 0 1 10 10" />
                  </svg>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>Opening Live Camera...</div>
                  <div style={{ fontSize: '0.76rem', color: '#94a3b8', maxWidth: '240px' }}>
                    Tap &quot;Allow&quot; if your phone browser asks for camera permission.
                  </div>
                </div>
              )}

              {/* Camera Error / Permission Blocked Overlay */}
              {cameraError && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(15, 23, 42, 0.96)',
                    color: '#f8fafc',
                    zIndex: 25,
                    gap: '10px',
                    padding: '24px',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(239, 68, 68, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#fca5a5' }}>Camera Not Opening</div>
                  <div style={{ fontSize: '0.78rem', color: '#cbd5e1', lineHeight: 1.45, maxWidth: '280px' }}>
                    {cameraError}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', maxWidth: '240px', marginTop: '6px' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setCameraError(null);
                        setSelectedCameraId(null);
                        setActiveMode('snap');
                        setTimeout(() => setActiveMode('live'), 100);
                      }}
                      style={{
                        padding: '10px 16px',
                        borderRadius: '10px',
                        border: 'none',
                        background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
                        color: '#ffffff',
                        fontWeight: 700,
                        fontSize: '0.84rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        boxShadow: '0 4px 12px rgba(79, 70, 229, 0.4)',
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                      </svg>
                      <span>Retry Camera Access</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveMode('snap')}
                      style={{
                        padding: '8px 14px',
                        borderRadius: '10px',
                        border: '1px solid #334155',
                        background: 'rgba(255, 255, 255, 0.08)',
                        color: '#cbd5e1',
                        fontWeight: 600,
                        fontSize: '0.78rem',
                        cursor: 'pointer',
                      }}
                    >
                      Use Photo Shutter (Snap) Instead
                    </button>
                  </div>
                </div>
              )}

              {/* Instant Scan Success Feedback Toast on Viewfinder */}
              {flashSuccess && (
                <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  background: 'rgba(22, 163, 74, 0.95)',
                  color: '#ffffff',
                  padding: '0.65rem 1.25rem',
                  borderRadius: '12px',
                  fontWeight: 800,
                  fontSize: '0.88rem',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
                  zIndex: 30,
                  textAlign: 'center',
                  pointerEvents: 'none',
                  whiteSpace: 'nowrap',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>BARCODE SCANNED</span>
                  </div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 600, opacity: 0.95, marginTop: '2px' }}>
                    Added to Counter Bill
                  </div>
                </div>
              )}

              {/* Quick Camera Bar (Torch & Flip) */}
              <div className="mobile-camera-controls">
                <button
                  type="button"
                  className={`camera-tool-btn ${torchOn ? 'active' : ''}`}
                  onClick={toggleTorch}
                  title="Toggle Flashlight / Torch"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                  </svg>
                  <span>{torchOn ? 'Torch On' : 'Torch'}</span>
                </button>

                {availableCameras.length > 1 && (
                  <button
                    type="button"
                    className="camera-tool-btn"
                    onClick={cycleCamera}
                    title="Switch Camera"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                    </svg>
                    <span>Flip</span>
                  </button>
                )}
              </div>
            </div>

            <p className="mobile-guide-hint">
              Position product barcode sticker inside the rectangle. Auto-scans continuously.
            </p>
          </div>
        )}

        {/* MODE 2: INSTANT CAMERA SHUTTER SNAP */}
        {activeMode === 'snap' && (
          <div className="mobile-snap-container">
            {cameraError && (
              <div className="mobile-camera-alert">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{cameraError}</span>
              </div>
            )}

            <div className="snap-shutter-card">
              <div className="snap-hero-icon">
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </div>
              <h3 className="snap-title">Point & Shoot Barcode</h3>
              <p className="snap-desc">
                Opens your phone's native camera immediately. Works over Wi-Fi, HTTP, and HTTPS without restrictions.
              </p>

              <label className="mobile-big-shutter-btn">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleSnapFile}
                  style={{ display: 'none' }}
                />
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="4" fill="currentColor" />
                </svg>
                <span>Tap to Scan Barcode</span>
              </label>
            </div>
            <div id="file-scanner-temp" style={{ display: 'none' }}></div>
          </div>
        )}

        {/* MODE 3: MANUAL NUMERIC KEYPAD */}
        {activeMode === 'manual' && (
          <form className="mobile-manual-card" onSubmit={handleManualSubmit}>
            <div className="manual-header">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M3 5v14M8 5v14M12 5v14M17 5v14M21 5v14" />
              </svg>
              <div>
                <h3 className="manual-title">Manual Barcode / SKU</h3>
                <span className="manual-sub">Type numbers if sticker is scratched</span>
              </div>
            </div>

            <div className="manual-input-wrap">
              <input
                type="text"
                className="manual-barcode-input"
                placeholder="0"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                autoFocus
              />
              {manualCode && (
                <button
                  type="button"
                  className="manual-clear-btn"
                  onClick={() => setManualCode('')}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>

            <button
              type="submit"
              className="manual-submit-btn"
              disabled={!manualCode.trim() || isSubmittingManual}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Send to Cart</span>
            </button>
          </form>
        )}

        {/* Last Scanned Banner */}
        {lastScanned && (
          <div className="mobile-last-scanned-card">
            <span className="last-scan-label">Last Dispatched:</span>
            <span className="last-scan-val mono">{lastScanned}</span>
            <span className="last-scan-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Dispatched</span>
            </span>
          </div>
        )}

        {/* Live Scanned History Feed */}
        <section className="mobile-history-section">
          <div className="mobile-history-header">
            <h4 className="history-title">Session Scans ({history.length})</h4>
            {history.length > 0 && (
              <button
                type="button"
                className="history-clear-btn"
                onClick={() => setHistory([])}
              >
                Clear
              </button>
            )}
          </div>

          {history.length === 0 ? (
            <div className="history-empty">
              <span>Ready. Barcodes scanned on this phone will appear here in real-time.</span>
            </div>
          ) : (
            <div className="history-list">
              {history.map((item) => (
                <div key={item.id} className="history-item">
                  <div className="history-item-left">
                    <span className="history-code mono">{item.barcode}</span>
                    <span className="history-time">{item.time}</span>
                  </div>
                  <div className="history-item-right">
                    {item.status === 'sent' ? (
                      <span className="history-badge sent" style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span>Sent</span>
                      </span>
                    ) : (
                      <span className="history-badge err">Retry</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Floating Bottom Bar: Return to Desktop note */}
      <footer className="mobile-scanner-footer">
        <span>Keep this tab open while scanning counter items</span>
      </footer>
    </div>
  );
};
