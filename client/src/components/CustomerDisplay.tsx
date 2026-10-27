import React, { useState, useEffect, useRef, useMemo } from 'react';
import { qrSvg } from '../../../shared/qr.ts';
import './CustomerDisplay.css';

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

function getCategoryIcon(catName: string = '') {
  const lower = catName.toLowerCase();
  if (lower.includes('produce') || lower.includes('veg') || lower.includes('fruit')) {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"></path>
        <path d="M2 21c0-3 1.85-5.36 5.08-6"></path>
      </svg>
    );
  }
  if (lower.includes('beverage') || lower.includes('drink') || lower.includes('tea') || lower.includes('coffee') || lower.includes('juice')) {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8h1a4 4 0 0 1 0 8h-1"></path>
        <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path>
        <line x1="6" y1="1" x2="6" y2="4"></line>
        <line x1="10" y1="1" x2="10" y2="4"></line>
      </svg>
    );
  }
  if (lower.includes('snack') || lower.includes('biscuit') || lower.includes('cookie') || lower.includes('chip') || lower.includes('chocolate')) {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
        <polyline points="2 17 12 22 22 17"></polyline>
        <polyline points="2 12 12 17 22 12"></polyline>
      </svg>
    );
  }
  if (lower.includes('dairy') || lower.includes('milk') || lower.includes('curd') || lower.includes('paneer') || lower.includes('cheese') || lower.includes('butter')) {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 2h8v3H8z"></path>
        <path d="M6 5h12l2 16H4L6 5z"></path>
      </svg>
    );
  }
  if (lower.includes('grain') || lower.includes('staple') || lower.includes('rice') || lower.includes('wheat') || lower.includes('dal') || lower.includes('pulse') || lower.includes('flour') || lower.includes('atta')) {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
        <path d="M2 17l10 5 10-5"></path>
        <path d="M2 12l10 5 10-5"></path>
      </svg>
    );
  }
  if (lower.includes('care') || lower.includes('soap') || lower.includes('shampoo') || lower.includes('paste')) {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1"></circle>
      <circle cx="20" cy="21" r="1"></circle>
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
    </svg>
  );
}

export const CustomerDisplay: React.FC<CustomerDisplayProps> = ({ counterId = 'counter-1' }) => {
  const [state, setState] = useState<CFDState>({
    counterId,
    shopName: 'Supermarket & Retail',
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

  // Sync mechanism: BroadcastChannel (0ms local dual-screen), Storage fallback, Long-polling (Tablets)
  useEffect(() => {
    let active = true;
    let bChannel: BroadcastChannel | null = null;

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

    try {
      const stored = localStorage.getItem(`cfd_state_${counterId}`);
      if (stored) {
        setState(JSON.parse(stored));
        setConnectionType('broadcast');
      }
    } catch {}

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

  // Auto-scroll on item scan
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
  const isUpiMode = state.status === 'payment_upi' || state.selectedPayMode === 'upi' || state.paymentDetails?.method === 'upi';
  const effectiveUpiId = state.upiId?.trim() || 'merchant@okaxis';

  const upiQrSvg = useMemo(() => {
    if (isUpiMode && state.totalMinor > 0) {
      if (state.paymentDetails?.upiUrl) {
        return qrSvg(state.paymentDetails.upiUrl, { size: 170, margin: 1 });
      }
      const upiString = `upi://pay?pa=${encodeURIComponent(effectiveUpiId)}&pn=${encodeURIComponent(state.shopName || 'Store')}&am=${(state.totalMinor / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Bill at ${state.shopName || 'Store'}`)}`;
      return qrSvg(upiString, { size: 170, margin: 1 });
    }
    return null;
  }, [isUpiMode, state.paymentDetails, effectiveUpiId, state.totalMinor, state.shopName]);

  const totalUnits = state.totalUnits || state.items.reduce((acc, it) => acc + it.qty, 0);
  const totalMrp = state.totalMrpMinor || state.items.reduce((acc, it) => acc + (it.mrpMinor || it.priceMinor) * it.qty, 0);
  const potentialLoyaltyPoints = Math.floor((state.totalMinor || 0) / 1000);

  return (
    <div className="cfd-root">
      {/* 1. TOP HEADER */}
      <header className="cfd-header">
        <div className="cfd-header-left">
          <div className="cfd-store-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
          </div>
          <div className="cfd-store-info">
            <h1 className="cfd-store-title">{state.shopName || 'Retail Store'}</h1>
            <div className="cfd-store-sub">
              <span>{state.tagline || 'GST Compliant Retail POS • Instant Digital Receipts'}</span>
              <span className="cfd-gst-pill">GST Verified</span>
            </div>
          </div>
        </div>

        <div className="cfd-header-right">
          <div className="cfd-sync-badge">
            <span className="cfd-sync-dot" />
            <span>{connectionType === 'broadcast' ? 'Dual-Screen 0ms' : connectionType === 'network' ? 'Wi-Fi Tablet' : 'Connecting...'}</span>
          </div>

          <div className="cfd-time-pill cfd-num">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            <span>{currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          </div>

          <button
            type="button"
            className="cfd-fullscreen-btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
          >
            {isFullscreen ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* 2. MAIN TWO-COLUMN VIEW */}
      <main className="cfd-content-grid">
        {/* LEFT COLUMN: LIVE SCANNED CART ITEMS */}
        <section className="cfd-cart-card">
          <div className="cfd-card-header">
            <div className="cfd-card-title-group">
              <div className="cfd-card-icon-box">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                  <line x1="3" y1="6" x2="21" y2="6"></line>
                  <path d="M16 10a4 4 0 0 1-8 0"></path>
                </svg>
              </div>
              <div>
                <h2 className="cfd-card-heading">Scanned Items</h2>
                <div className="cfd-card-subheading">
                  {state.items.length} {state.items.length === 1 ? 'item' : 'items'} • {totalUnits} {totalUnits === 1 ? 'unit' : 'units'} in cart
                </div>
              </div>
            </div>

            {state.status === 'completed' ? (
              <span className="cfd-state-badge completed">✓ Invoice Settled</span>
            ) : state.status.startsWith('payment') ? (
              <span className="cfd-state-badge payment">⚡ Awaiting Payment</span>
            ) : (
              <span className="cfd-state-badge billing">● Scanning Live</span>
            )}
          </div>

          {/* CATEGORY BREAKDOWN PILL STRIP */}
          {state.categoryBreakdown && Object.keys(state.categoryBreakdown).length > 0 && (
            <div className="cfd-cat-strip">
              <span className="cfd-cat-label">Categories:</span>
              <div className="cfd-cat-chips">
                {Object.values(state.categoryBreakdown).map((cat) => (
                  <div key={cat.name} className="cfd-cat-pill">
                    <span className="cfd-cat-icon-wrap">{getCategoryIcon(cat.name)}</span>
                    <span className="cfd-cat-name">{cat.name}</span>
                    <span className="cfd-cat-count">({cat.count} pcs)</span>
                    <span className="cfd-cat-total cfd-num">{formatCurrency(cat.totalMinor)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TABLE OR IDLE WELCOME STATE */}
          {isCartEmpty && state.status !== 'completed' ? (
            <div className="cfd-empty-state">
              <div className="cfd-empty-icon-box">
                <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                  <line x1="3" y1="6" x2="21" y2="6"></line>
                  <path d="M16 10a4 4 0 0 1-8 0"></path>
                </svg>
              </div>
              <h2 className="cfd-empty-title">Welcome to {state.shopName}!</h2>
              <p className="cfd-empty-sub">
                Products scanned at the cash counter will appear here instantly with full price & savings details.
              </p>

              <div className="cfd-empty-perks">
                <div className="cfd-perk-card">
                  <strong>⚡ Instant UPI & Cards</strong>
                  <span>Pay effortlessly with GPay, PhonePe, Paytm, or Card</span>
                </div>
                <div className="cfd-perk-card">
                  <strong>🧾 GST Tax Transparency</strong>
                  <span>Itemized bills with clear tax rates & HSN breakdown</span>
                </div>
                <div className="cfd-perk-card">
                  <strong>🎁 Loyalty Rewards</strong>
                  <span>Earn points on every purchase to redeem on future bills</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="cfd-table-container" ref={itemsContainerRef}>
              <table className="cfd-item-table">
                <thead>
                  <tr>
                    <th style={{ minWidth: '180px' }}>Item Description</th>
                    <th style={{ textAlign: 'center', width: '75px' }}>Qty</th>
                    <th style={{ textAlign: 'right', width: '90px' }}>MRP</th>
                    <th style={{ textAlign: 'right', width: '100px' }}>Store Price</th>
                    <th style={{ textAlign: 'right', width: '110px' }}>Total</th>
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
                      <tr key={item.id} className={isLatest ? 'new-item-pulse' : ''}>
                        <td>
                          <div className="cfd-item-title">{item.name}</div>
                          <div className="cfd-item-tags">
                            <span className="cfd-tag-badge">
                              {getCategoryIcon(item.category || 'General')}
                              <span>{item.category || 'General'}</span>
                            </span>
                            {savings > 0 && (
                              <span className="cfd-tag-savings cfd-num">
                                Save {formatCurrency(savings)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span className="cfd-qty-chip cfd-num">
                            {item.qty} {item.unit || 'pcs'}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span className="cfd-mrp-val cfd-num">
                            {formatCurrency(mrp)}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span className="cfd-rate-text cfd-num">
                            {formatCurrency(item.priceMinor)}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <span className="cfd-line-total cfd-num">
                            {formatCurrency(item.totalMinor)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* RIGHT COLUMN: FINANCIALS SUMMARY & INTERACTIVE HUB (ELIMINATES BLANK VOID) */}
        <section className="cfd-summary-col">
          {/* 1. FINANCIALS SUMMARY CARD */}
          <div className="cfd-summary-card">
            <div className="cfd-summary-head">
              <span className="cfd-summary-title">Bill Breakdown</span>
              <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                {state.items.length} {state.items.length === 1 ? 'item' : 'items'}
              </span>
            </div>

            <div className="cfd-summary-lines">
              {/* Items & Units */}
              <div className="cfd-calc-row">
                <span className="cfd-calc-label">
                  <span className="cfd-calc-icon-circle">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="9" cy="21" r="1"></circle>
                      <circle cx="20" cy="21" r="1"></circle>
                      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                    </svg>
                  </span>
                  <span>Items / Total Units</span>
                </span>
                <span className="cfd-calc-val cfd-num">
                  {state.items.length} items ({totalUnits} units)
                </span>
              </div>

              {/* Total MRP */}
              <div className="cfd-calc-row">
                <span className="cfd-calc-label">
                  <span className="cfd-calc-icon-circle">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
                      <circle cx="7" cy="7" r="1.5" fill="currentColor"></circle>
                    </svg>
                  </span>
                  <span>Total MRP Value</span>
                </span>
                <span className="cfd-calc-val cfd-num">
                  {formatCurrency(totalMrp)}
                </span>
              </div>

              {/* Taxable Subtotal */}
              <div className="cfd-calc-row">
                <span className="cfd-calc-label">
                  <span className="cfd-calc-icon-circle">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4" y="2" width="16" height="20" rx="2"></rect>
                      <line x1="8" y1="6" x2="16" y2="6"></line>
                      <line x1="8" y1="10" x2="16" y2="10"></line>
                      <line x1="8" y1="14" x2="12" y2="14"></line>
                    </svg>
                  </span>
                  <span>Taxable Subtotal</span>
                </span>
                <span className="cfd-calc-val cfd-num">
                  {formatCurrency(state.taxableSubtotalMinor || Math.max(0, state.subtotalMinor - state.taxMinor))}
                </span>
              </div>

              {/* Bill Discount (if applicable) */}
              {Boolean(state.discountMinor && state.discountMinor > 0) && (
                <div className="cfd-calc-row" style={{ color: '#059669' }}>
                  <span className="cfd-calc-label" style={{ color: '#059669' }}>
                    <span className="cfd-calc-icon-circle" style={{ background: '#d1fae5', color: '#059669' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="19" y1="5" x2="5" y2="19"></line>
                        <circle cx="6.5" cy="6.5" r="2.5"></circle>
                        <circle cx="17.5" cy="17.5" r="2.5"></circle>
                      </svg>
                    </span>
                    <span>Discount Applied</span>
                  </span>
                  <span className="cfd-calc-val cfd-num" style={{ color: '#059669', fontWeight: 700 }}>
                    - {formatCurrency(state.discountMinor)}
                  </span>
                </div>
              )}

              {/* Consolidated GST Tax */}
              <div className="cfd-gst-pill-box">
                <div className="cfd-gst-top">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                    </svg>
                    <span>Consolidated GST Tax</span>
                  </span>
                  <span className="cfd-num">{formatCurrency(state.taxMinor)}</span>
                </div>
                <div className="cfd-gst-sub cfd-num">
                  (CGST: {formatCurrency(state.cgstMinor || Math.floor(state.taxMinor / 2))} + SGST: {formatCurrency(state.sgstMinor || (state.taxMinor - Math.floor(state.taxMinor / 2)))})
                </div>
              </div>
            </div>

            {/* Savings Celebration Badge */}
            {state.savingsMinor > 0 && (
              <div className="cfd-savings-box">
                <div className="cfd-savings-left">
                  <span className="cfd-savings-star-badge">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                    </svg>
                  </span>
                  <span>Total Customer Savings</span>
                </div>
                <span className="cfd-savings-val cfd-num">{formatCurrency(state.savingsMinor)}</span>
              </div>
            )}

            {/* GRAND TOTAL PAYABLE CARD */}
            <div className="cfd-grand-card">
              <div className="cfd-grand-label-wrap">
                <span className="cfd-grand-title">Total Payable</span>
                <span className="cfd-grand-sub">Net Amount Due</span>
              </div>
              <div className="cfd-grand-amount cfd-num">
                {formatCurrency(state.totalMinor)}
              </div>
            </div>
          </div>

          {/* 2. INTERACTIVE PAYMENT & CUSTOMER ENGAGEMENT HUB (FILLS THE VOID) */}
          <div className="cfd-hub-card">
            {state.status === 'completed' ? (
              /* COMPLETED INVOICE STATE */
              <div className="cfd-completed-panel">
                <div className="cfd-success-circle">
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                </div>
                <h3 className="cfd-success-heading">Payment Successful!</h3>
                <p className="cfd-success-sub">Thank you for shopping with us today.</p>

                {state.paymentDetails?.invoiceNumber && (
                  <div className="cfd-invoice-chip">
                    Bill #{state.paymentDetails.invoiceNumber}
                  </div>
                )}

                {Boolean(state.paymentDetails?.changeDueMinor && state.paymentDetails.changeDueMinor > 0) && (
                  <div className="cfd-change-banner">
                    <span className="cfd-change-label">Change to Collect:</span>
                    <strong className="cfd-change-val cfd-num">
                      {formatCurrency(state.paymentDetails!.changeDueMinor!)}
                    </strong>
                  </div>
                )}
              </div>
            ) : isUpiMode && upiQrSvg ? (
              /* DYNAMIC UPI QR SCANNER (ACTIVE PAYMENT) */
              <div className="cfd-upi-panel">
                <span className="cfd-upi-badge">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                  </svg>
                  <span>Instant UPI QR</span>
                </span>
                <h4 className="cfd-upi-title">Scan to Pay with Any UPI App</h4>
                <p className="cfd-upi-sub">Google Pay • PhonePe • Paytm • BHIM • CRED</p>

                <div className="cfd-qr-box" dangerouslySetInnerHTML={{ __html: upiQrSvg }} />

                <div className="cfd-upi-amount-pill cfd-num">
                  <span>Pay Exact:</span>
                  <strong>{formatCurrency(state.totalMinor)}</strong>
                </div>

                <div className="cfd-vpa-pill">
                  UPI ID: <strong>{effectiveUpiId}</strong>
                </div>
              </div>
            ) : (
              /* SCANNING / CASH / IDLE LOYALTY HUB */
              <div className="cfd-loyalty-hub">
                <div className="cfd-loyalty-promo">
                  <div className="cfd-promo-icon">🎁</div>
                  <div className="cfd-promo-text">
                    <span className="cfd-promo-title">Customer Loyalty Rewards</span>
                    <span className="cfd-promo-desc">
                      {potentialLoyaltyPoints > 0
                        ? `You are earning +${potentialLoyaltyPoints} Points on this bill! Redeemable on your next visit.`
                        : 'Earn loyalty points on every purchase to unlock instant bill discounts!'}
                    </span>
                  </div>
                </div>

                <div className="cfd-payment-badges-row">
                  <span className="cfd-badges-title">Accepted Payment Modes</span>
                  <div className="cfd-badge-grid">
                    <div className="cfd-badge-item">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                      </svg>
                      <span>UPI QR</span>
                    </div>
                    <div className="cfd-badge-item">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="6" width="20" height="12" rx="2"></rect>
                        <circle cx="12" cy="12" r="3.5"></circle>
                        <path d="M6 12h.01M18 12h.01"></path>
                      </svg>
                      <span>Cash</span>
                    </div>
                    <div className="cfd-badge-item">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                        <line x1="1" y1="10" x2="23" y2="10"></line>
                      </svg>
                      <span>Card / Tap</span>
                    </div>
                    <div className="cfd-badge-item">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="1" x2="12" y2="23"></line>
                        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                      </svg>
                      <span>Khata / Pay</span>
                    </div>
                  </div>
                </div>

                <div className="cfd-assurance-tag">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                  </svg>
                  <span>100% Verified GST Compliant Billing Terminal</span>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};
