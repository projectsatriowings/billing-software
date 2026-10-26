import React, { useState, useEffect, useRef } from 'react';
import { qrSvg } from '../../../shared/qr.ts';

export interface CFDCartItem {
  id: string;
  name: string;
  sku?: string;
  qty: number;
  unit?: string;
  category?: string;
  mrpMinor?: number;
  priceMinor: number;
  totalMinor: number;
  savingsMinor?: number;
}

export interface CFDCategorySummary {
  name: string;
  count: number;
  totalMinor: number;
}

export interface CFDPaymentDetails {
  method: string;
  amountMinor: number;
  upiUrl?: string;
  changeDueMinor?: number;
  invoiceNumber?: string;
}

export interface CFDState {
  counterId: string;
  shopName: string;
  upiId?: string;
  tagline?: string;
  cashierName?: string;
  customerName?: string;
  items: CFDCartItem[];
  itemCount: number;
  totalUnits?: number;
  categoryBreakdown?: { [cat: string]: CFDCategorySummary };
  totalMrpMinor?: number;
  taxableSubtotalMinor?: number;
  cgstMinor?: number;
  sgstMinor?: number;
  subtotalMinor: number;
  discountMinor: number;
  discountPercent?: number;
  taxMinor: number;
  totalMinor: number;
  savingsMinor: number;
  status: 'idle' | 'billing' | 'payment_upi' | 'payment_cash' | 'payment_card' | 'completed';
  selectedPayMode?: string;
  paymentDetails?: CFDPaymentDetails;
  updatedAt: number;
}

interface CustomerDisplayProps {
  counterId?: string;
}

function formatCurrency(minor: number): string {
  return '₹' + (minor / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function renderCategoryIcon(catName: string = '') {
  const lower = catName.toLowerCase();
  if (lower.includes('produce') || lower.includes('veg') || lower.includes('fruit')) {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"></path>
        <path d="M2 21c0-3 1.85-5.36 5.08-6"></path>
      </svg>
    );
  }
  if (lower.includes('beverage') || lower.includes('drink') || lower.includes('tea') || lower.includes('coffee') || lower.includes('juice')) {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M18 8h1a4 4 0 0 1 0 8h-1"></path>
        <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path>
        <line x1="6" y1="1" x2="6" y2="4"></line>
        <line x1="10" y1="1" x2="10" y2="4"></line>
      </svg>
    );
  }
  if (lower.includes('snack') || lower.includes('biscuit') || lower.includes('cookie') || lower.includes('chip') || lower.includes('chocolate')) {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
        <path d="M2 17l10 5 10-5"></path>
        <path d="M2 12l10 5 10-5"></path>
      </svg>
    );
  }
  if (lower.includes('care') || lower.includes('soap') || lower.includes('shampoo') || lower.includes('paste')) {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
      </svg>
    );
  }
  if (lower.includes('dairy') || lower.includes('milk') || lower.includes('curd') || lower.includes('paneer') || lower.includes('cheese') || lower.includes('butter')) {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M8 2h8v3H8z"></path>
        <path d="M6 5h12l2 16H4L6 5z"></path>
      </svg>
    );
  }
  if (lower.includes('grain') || lower.includes('staple') || lower.includes('rice') || lower.includes('wheat') || lower.includes('dal') || lower.includes('pulse') || lower.includes('flour') || lower.includes('atta')) {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
        <path d="M2 17l10 5 10-5"></path>
        <path d="M2 12l10 5 10-5"></path>
      </svg>
    );
  }
  if (lower.includes('house') || lower.includes('clean') || lower.includes('detergent')) {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
        <polyline points="9 22 9 12 15 12 15 22"></polyline>
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
      <circle cx="9" cy="21" r="1"></circle>
      <circle cx="20" cy="21" r="1"></circle>
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
    </svg>
  );
}

export const CustomerDisplay: React.FC<CustomerDisplayProps> = ({ counterId = 'counter-1' }) => {
  const [state, setState] = useState<CFDState>({
    counterId,
    shopName: 'Retail Counter',
    items: [],
    itemCount: 0,
    subtotalMinor: 0,
    discountMinor: 0,
    taxMinor: 0,
    totalMinor: 0,
    savingsMinor: 0,
    status: 'idle',
    updatedAt: Date.now(),
  });

  const [currentTime, setCurrentTime] = useState(new Date());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [connectionType, setConnectionType] = useState<'broadcast' | 'network' | 'connecting'>('connecting');
  const [lastScannedId, setLastScannedId] = useState<string | null>(null);
  const itemsContainerRef = useRef<HTMLDivElement | null>(null);

  // Live Clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Sync mechanism: 1) BroadcastChannel (0ms local dual-screen), 2) Storage, 3) Long-polling (Tablets)
  useEffect(() => {
    let active = true;
    let bChannel: BroadcastChannel | null = null;

    // 1. Setup local BroadcastChannel
    try {
      bChannel = new BroadcastChannel(`cfd_${counterId}`);
      bChannel.onmessage = (event) => {
        if (event.data && typeof event.data === 'object') {
          setState(event.data);
          setConnectionType('broadcast');
          if (event.data.items && event.data.items.length > 0) {
            setLastScannedId(event.data.items[event.data.items.length - 1].id);
          }
        }
      };
    } catch {}

    // 2. Storage event listener (fallback for local multi-window)
    const onStorage = (e: StorageEvent) => {
      if (e.key === `cfd_state_${counterId}` && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          setState(parsed);
          setConnectionType('broadcast');
        } catch {}
      }
    };
    window.addEventListener('storage', onStorage);

    // Initial check from localStorage
    try {
      const stored = localStorage.getItem(`cfd_state_${counterId}`);
      if (stored) {
        setState(JSON.parse(stored));
        setConnectionType('broadcast');
      }
    } catch {}

    // 3. Fast 1-second polling & Heartbeat for mobile screens and remote tablets
    let lastVersion = 0;
    const fetchLatestState = async () => {
      try {
        const res = await fetch(`/api/cfd/state?counter=${encodeURIComponent(counterId)}&_t=${Date.now()}`);
        if (res.ok && active) {
          const data = await res.json();
          if (data?.state && data.state.updatedAt > lastVersion) {
            lastVersion = data.state.updatedAt;
            setState(data.state);
            setConnectionType((prev) => (prev === 'broadcast' ? 'broadcast' : 'network'));
            if (data.state.items && data.state.items.length > 0) {
              setLastScannedId(data.state.items[data.state.items.length - 1].id);
            }
          }
        }
      } catch {}
    };

    fetchLatestState();
    const pollTimer = setInterval(fetchLatestState, 1000);

    // Heartbeat every 4 seconds to register display device
    const heartbeatTimer = setInterval(() => {
      fetch('/api/cfd/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          counterId,
          deviceInfo: `${navigator.platform || ''} ${navigator.userAgent.slice(0, 40)}`,
        }),
      }).catch(() => {});
    }, 4000);

    return () => {
      active = false;
      bChannel?.close();
      window.removeEventListener('storage', onStorage);
      clearInterval(pollTimer);
      clearInterval(heartbeatTimer);
    };
  }, [counterId]);

  // Auto-scroll to bottom of items list on new scan
  useEffect(() => {
    if (itemsContainerRef.current) {
      itemsContainerRef.current.scrollTop = itemsContainerRef.current.scrollHeight;
    }
  }, [state.items.length, lastScannedId]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const isCartEmpty = !state.items || state.items.length === 0;

  // Generate dynamic UPI QR SVG when UPI is chosen
  const isUpiMode = state.status === 'payment_upi' || state.selectedPayMode === 'upi' || state.paymentDetails?.method === 'upi';
  const effectiveUpiId = state.upiId?.trim() || 'merchant@okaxis';

  const upiQrSvg = React.useMemo(() => {
    if (isUpiMode && state.totalMinor > 0) {
      if (state.paymentDetails?.upiUrl) {
        return qrSvg(state.paymentDetails.upiUrl, { size: 240, margin: 2 });
      }
      const upiString = `upi://pay?pa=${encodeURIComponent(effectiveUpiId)}&pn=${encodeURIComponent(state.shopName || 'Retail Store')}&am=${(state.totalMinor / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Bill at ${state.shopName || 'Retail Store'}`)}`;
      return qrSvg(upiString, { size: 240, margin: 2 });
    }
    return null;
  }, [isUpiMode, state.paymentDetails, effectiveUpiId, state.totalMinor, state.shopName]);

  return (
    <div className="cfd-root-container">
      {/* CFD TOP BAR */}
      <header className="cfd-header">
        <div className="cfd-header-left">
          <div className="cfd-shop-badge">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
          </div>
          <div>
            <h1 className="cfd-shop-name">{state.shopName || 'Retail Checkout'}</h1>
            <div className="cfd-shop-tagline">
              {state.tagline || 'GST Compliant Retail POS • Instant Digital Receipts'}
            </div>
          </div>
        </div>

        <div className="cfd-header-right">
          <div className="cfd-sync-pill">
            <span className={`cfd-pulse-dot ${connectionType !== 'connecting' ? 'active' : ''}`} />
            <span>{connectionType === 'broadcast' ? 'Dual-Screen 0ms' : connectionType === 'network' ? 'Wi-Fi Tablet' : 'Connecting...'}</span>
          </div>

          <div className="cfd-clock-chip">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <span>{currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          </div>

          <button
            type="button"
            className="cfd-fullscreen-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen Mode'}
          >
            {isFullscreen ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* CFD MAIN VIEW */}
      <main className="cfd-main-grid">
        {/* LEFT COLUMN: LIVE SCANNED CART ITEMS */}
        <section className="cfd-items-column">
          <div className="cfd-section-card">
            <div className="cfd-section-header">
              <div className="terminal-title-group" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <div className="terminal-icon-box">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="9" cy="21" r="1"></circle>
                    <circle cx="20" cy="21" r="1"></circle>
                    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                  </svg>
                </div>
                <div>
                  <h2 className="terminal-heading" style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                    Billing Terminal
                  </h2>
                  <span className="terminal-subheading" style={{ fontSize: '0.74rem', color: '#64748b' }}>
                    {state.items.length} item{state.items.length === 1 ? '' : 's'} • {state.totalUnits || state.items.reduce((sum, it) => sum + it.qty, 0)} units
                  </span>
                </div>
              </div>
              {state.status === 'completed' ? (
                <span className="cfd-status-tag success">✓ Invoice Settled</span>
              ) : state.status.startsWith('payment') ? (
                <span className="cfd-status-tag payment">⚡ Awaiting Payment</span>
              ) : (
                <span className="cfd-status-tag active">● Live Register</span>
              )}
            </div>

            {/* CATEGORY BREAKDOWN PILL STRIP */}
            {state.categoryBreakdown && Object.keys(state.categoryBreakdown).length > 0 && (
              <div className="bento-category-strip-container cfd-category-strip">
                <span className="bento-category-strip-title">CATEGORY BREAKDOWN:</span>
                <div className="bento-category-strip">
                  {Object.values(state.categoryBreakdown).map((cat) => (
                    <div key={cat.name} className="bento-cat-summary-pill">
                      {renderCategoryIcon(cat.name)}
                      <span className="cat-pill-name">{cat.name}</span>
                      <span className="cat-pill-count">({cat.count} pcs)</span>
                      <span className="cat-pill-total mono">{formatCurrency(cat.totalMinor)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {isCartEmpty && state.status !== 'completed' ? (
              /* WELCOME HERO WHEN IDLE */
              <div className="cfd-welcome-hero">
                <div className="cfd-welcome-glow" />
                <div className="cfd-welcome-icon-wrap">
                  <svg width="54" height="54" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                    <line x1="3" y1="6" x2="21" y2="6"></line>
                    <path d="M16 10a4 4 0 0 1-8 0"></path>
                  </svg>
                </div>
                <h2 className="cfd-welcome-title">Welcome to {state.shopName}!</h2>
                <p className="cfd-welcome-subtitle">
                  Items scanned by the cashier will appear here in real-time.
                </p>

                <div className="cfd-feature-grid">
                  <div className="cfd-feature-card">
                    <span className="cfd-feat-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
                        <line x1="12" y1="18" x2="12.01" y2="18"></line>
                      </svg>
                    </span>
                    <strong>Instant UPI & Cards</strong>
                    <span>Pay with GPay, PhonePe, Paytm, or debit/credit cards</span>
                  </div>
                  <div className="cfd-feature-card">
                    <span className="cfd-feat-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                      </svg>
                    </span>
                    <strong>GST Tax Assurance</strong>
                    <span>100% itemized invoice with HSN & transparent tax rates</span>
                  </div>
                  <div className="cfd-feature-card">
                    <span className="cfd-feat-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                      </svg>
                    </span>
                    <strong>Fast Supermarket Checkout</strong>
                    <span>Laser barcode scanner for queue-free billing</span>
                  </div>
                </div>
              </div>
            ) : (
              /* ACTIVE CART LIST MATCHING POS */
              <div className="cfd-table-wrapper" ref={itemsContainerRef}>
                <table className="cfd-table">
                  <thead>
                    <tr>
                      <th style={{ minWidth: '140px' }}>PRODUCT</th>
                      <th style={{ textAlign: 'center', width: '75px' }}>QTY</th>
                      <th style={{ textAlign: 'right', width: '85px' }}>MRP</th>
                      <th style={{ textAlign: 'right', width: '95px' }}>STORE PRICE</th>
                      <th style={{ textAlign: 'right', width: '100px' }}>TOTAL PRICE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.items.map((item) => {
                      const isLatest = item.id === lastScannedId;
                      const mrp = item.mrpMinor || item.priceMinor;
                      const savings = item.savingsMinor !== undefined
                        ? item.savingsMinor
                        : Math.max(0, (mrp - item.priceMinor) * item.qty);

                      return (
                        <tr key={item.id} className={`cfd-row ${isLatest ? 'highlight-pulse' : ''}`}>
                          <td>
                            <div className="cfd-item-name">{item.name}</div>
                            <div className="cfd-item-meta">
                              <span className="bento-cart-cat-badge">
                                {renderCategoryIcon(item.category || 'General')}
                                <span>{item.category || 'General'}</span>
                              </span>
                              {savings > 0 && (
                                <span className="bento-cart-savings-tag">Save {formatCurrency(savings)}</span>
                              )}
                            </div>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span className="cfd-qty-badge mono">
                              {item.qty} {item.unit || 'pcs'}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }} className="cfd-mrp-val mono">
                            {formatCurrency(mrp)}
                          </td>
                          <td style={{ textAlign: 'right' }} className="cfd-store-val mono">
                            {formatCurrency(item.priceMinor)}
                          </td>
                          <td style={{ textAlign: 'right' }} className="cfd-total-val mono">
                            {formatCurrency(item.totalMinor)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* RIGHT COLUMN: BILLING TOTALS & NET PAYABLE */}
        <section className="cfd-summary-column">
          {/* DYNAMIC PAYMENT SUCCESS STATE */}
          {state.status === 'completed' && (
            <div className="cfd-payment-card completed">
              <div className="cfd-success-circle">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.8">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </div>
              <h3 className="cfd-success-title">Payment Successful!</h3>
              <p className="cfd-success-desc">Thank you for shopping with us.</p>

              {state.paymentDetails?.invoiceNumber && (
                <div className="cfd-invoice-badge">
                  <span>Bill #{state.paymentDetails.invoiceNumber}</span>
                </div>
              )}

              <div className="cfd-success-details">
                <div className="cfd-success-row">
                  <span>Amount Paid:</span>
                  <strong className="green">{formatCurrency(state.totalMinor)}</strong>
                </div>
                {Boolean(state.paymentDetails?.changeDueMinor && state.paymentDetails.changeDueMinor > 0) && (
                  <div className="cfd-change-box">
                    <span>Change to Collect:</span>
                    <strong className="cfd-change-amt">{formatCurrency(state.paymentDetails!.changeDueMinor!)}</strong>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* DYNAMIC UPI QR WHEN CASHIER INITIATES UPI */}
          {isUpiMode && upiQrSvg && (
            <div className="cfd-payment-card upi-mode">
              <div className="cfd-upi-header">
                <span className="cfd-upi-chip">⚡ Instant UPI</span>
                <h4>Scan to Pay with Any UPI App</h4>
                <p>Google Pay • PhonePe • Paytm • BHIM • CRED</p>
              </div>

              <div className="cfd-upi-qr-wrapper">
                <div
                  className="cfd-qr-frame"
                  dangerouslySetInnerHTML={{ __html: upiQrSvg }}
                />
                <div className="cfd-qr-amt-banner">
                  <span>Pay Exact:</span>
                  <strong>{formatCurrency(state.totalMinor)}</strong>
                </div>
              </div>

              <div className="cfd-vpa-text">
                <span>Merchant UPI: <strong>{effectiveUpiId}</strong></span>
              </div>
              <div className="cfd-scan-guide-pill">
                <span className="cfd-pulse-dot active"></span>
                <span>Dynamic QR • Amount pre-filled on your mobile</span>
              </div>
            </div>
          )}

          {/* FINANCIALS BREAKDOWN CARD WITH TOTAL PAYABLE */}
          <div className="cfd-totals-card">
            <div className="cfd-calc-row">
              <span className="cfd-calc-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="21" r="1"></circle>
                  <circle cx="20" cy="21" r="1"></circle>
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                </svg>
                <span>Items / Total Units</span>
              </span>
              <span className="cfd-calc-val mono">
                {state.items.length} items ({state.totalUnits || state.items.reduce((sum, it) => sum + it.qty, 0)} units)
              </span>
            </div>

            <div className="cfd-calc-row">
              <span className="cfd-calc-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
                  <circle cx="7" cy="7" r="1.5" fill="currentColor"></circle>
                </svg>
                <span>Total MRP Value</span>
              </span>
              <span className="cfd-calc-val mono">
                {formatCurrency(state.totalMrpMinor || state.items.reduce((sum, it) => sum + (it.mrpMinor || it.priceMinor) * it.qty, 0))}
              </span>
            </div>

            <div className="cfd-calc-row">
              <span className="cfd-calc-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="2" width="16" height="20" rx="2"></rect>
                  <line x1="8" y1="6" x2="16" y2="6"></line>
                  <line x1="8" y1="10" x2="16" y2="10"></line>
                  <line x1="8" y1="14" x2="12" y2="14"></line>
                  <line x1="8" y1="18" x2="10" y2="18"></line>
                </svg>
                <span>Taxable Subtotal</span>
              </span>
              <span className="cfd-calc-val mono">
                {formatCurrency(state.taxableSubtotalMinor || Math.max(0, state.subtotalMinor - state.taxMinor))}
              </span>
            </div>

            {Boolean(state.discountMinor && state.discountMinor > 0) && (
              <div className="cfd-calc-row discount">
                <span className="cfd-calc-label">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="19" y1="5" x2="5" y2="19"></line>
                    <circle cx="6.5" cy="6.5" r="2.5"></circle>
                    <circle cx="17.5" cy="17.5" r="2.5"></circle>
                  </svg>
                  <span>Bill Discount {state.discountPercent ? `(${state.discountPercent}%)` : ''}</span>
                </span>
                <span className="cfd-calc-val mono" style={{ color: '#059669', fontWeight: 800 }}>- {formatCurrency(state.discountMinor)}</span>
              </div>
            )}

            {/* CONSOLIDATED GST TAX WITH CGST + SGST SUB-BREAKDOWN */}
            <div className="cfd-gst-box">
              <div className="cfd-gst-top-row">
                <span className="cfd-calc-label">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                  </svg>
                  <span>Consolidated GST Tax</span>
                </span>
                <span className="cfd-calc-val mono">{formatCurrency(state.taxMinor)}</span>
              </div>
              <div className="cfd-gst-sub-row">
                (CGST: {formatCurrency(state.cgstMinor || Math.floor(state.taxMinor / 2))} + SGST: {formatCurrency(state.sgstMinor || (state.taxMinor - Math.floor(state.taxMinor / 2)))})
              </div>
            </div>

            {/* CELEBRATION CUSTOMER SAVINGS ALERT (EXACT MATCH TO POS) */}
            {state.savingsMinor > 0 && (
              <div className="cfd-savings-alert">
                <span className="savings-icon" style={{ display: 'inline-flex', alignItems: 'center', color: '#047857' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                  </svg>
                </span>
                <span>Total Customer Savings: <strong>{formatCurrency(state.savingsMinor)}</strong></span>
              </div>
            )}

            <div className="cfd-divider" />

            <div className="cfd-grand-total-row">
              <div>
                <span className="cfd-total-title">Total Payable</span>
                <span className="cfd-total-sub">Net Amount Due</span>
              </div>
              <div className="cfd-grand-amount">
                {formatCurrency(state.totalMinor)}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};
