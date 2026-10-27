import type { Router, Ctx } from '../http.ts';
import { bad } from '../http.ts';

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

interface CounterSession {
  state: CFDState;
  lastSeenDisplayAt?: number;
  displayDeviceInfo?: string;
  waitingListeners: Array<(state: CFDState) => void>;
}

const counters = new Map<string, CounterSession>();

function getOrCreateCounter(counterId: string): CounterSession {
  let session = counters.get(counterId);
  if (!session) {
    session = {
      state: {
        counterId,
        shopName: 'Supermarket POS',
        items: [],
        itemCount: 0,
        subtotalMinor: 0,
        discountMinor: 0,
        taxMinor: 0,
        totalMinor: 0,
        savingsMinor: 0,
        status: 'idle',
        updatedAt: Date.now(),
      },
      waitingListeners: [],
    };
    counters.set(counterId, session);
  }
  return session;
}

function enrichCfdState(st: CFDState): CFDState {
  if (!st || !Array.isArray(st.items)) return st;

  // Known item category hints for retail & supermarket items
  const categoryHints: Record<string, string> = {
    atta: 'Grocery',
    wheat: 'Grocery',
    flour: 'Grocery',
    sugar: 'Grocery',
    oil: 'Grocery',
    salt: 'Grocery',
    spice: 'Grocery',
    masala: 'Grocery',
    rice: 'Grains & Staples',
    dal: 'Grains & Staples',
    pulse: 'Grains & Staples',
    grain: 'Grains & Staples',
    biscuit: 'Snacks',
    snack: 'Snacks',
    cookie: 'Snacks',
    chocolate: 'Snacks',
    chips: 'Snacks',
    namkeen: 'Snacks',
    soap: 'Personal Care',
    shampoo: 'Personal Care',
    paste: 'Personal Care',
    milk: 'Dairy',
    curd: 'Dairy',
    paneer: 'Dairy',
    butter: 'Dairy',
    cheese: 'Dairy',
    tea: 'Beverages',
    coffee: 'Beverages',
    juice: 'Beverages',
  };

  const enrichedItems = st.items.map((item) => {
    const storePrice = item.priceMinor || 0;
    let mrpMinor = item.mrpMinor;
    if (!mrpMinor || mrpMinor <= storePrice) {
      mrpMinor = Math.max(storePrice, Math.ceil((storePrice * 1.15) / 100) * 100);
    }
    const qty = item.qty || 1;
    const savingsMinor = item.savingsMinor !== undefined
      ? item.savingsMinor
      : Math.max(0, (mrpMinor - storePrice) * qty);

    let category = item.category?.trim();
    if (!category || category === 'General') {
      const lower = (item.name || '').toLowerCase();
      for (const [kw, cat] of Object.entries(categoryHints)) {
        if (lower.includes(kw)) {
          category = cat;
          break;
        }
      }
      if (!category) category = 'General';
    }

    return {
      ...item,
      category,
      mrpMinor,
      priceMinor: storePrice,
      totalMinor: item.totalMinor || (storePrice * qty),
      savingsMinor,
    };
  });

  // Calculate category breakdown if missing
  let categoryBreakdown = st.categoryBreakdown;
  if (!categoryBreakdown || Object.keys(categoryBreakdown).length === 0) {
    const catMap: { [cat: string]: CFDCategorySummary } = {};
    for (const it of enrichedItems) {
      const cat = it.category || 'General';
      if (!catMap[cat]) catMap[cat] = { name: cat, count: 0, totalMinor: 0 };
      catMap[cat].count += it.qty || 1;
      catMap[cat].totalMinor += it.totalMinor || 0;
    }
    categoryBreakdown = catMap;
  }

  const totalUnits = st.totalUnits || enrichedItems.reduce((s, it) => s + (it.qty || 1), 0);
  const totalMrpMinor = st.totalMrpMinor || enrichedItems.reduce((s, it) => s + (it.mrpMinor || it.priceMinor) * (it.qty || 1), 0);
  const subtotalMinor = st.subtotalMinor || enrichedItems.reduce((s, it) => s + (it.priceMinor * (it.qty || 1)), 0);
  const taxMinor = st.taxMinor || 0;
  const taxableSubtotalMinor = st.taxableSubtotalMinor || Math.max(0, subtotalMinor - taxMinor);
  const cgstMinor = st.cgstMinor !== undefined ? st.cgstMinor : Math.floor(taxMinor / 2);
  const sgstMinor = st.sgstMinor !== undefined ? st.sgstMinor : taxMinor - cgstMinor;
  const savingsMinor = st.savingsMinor || Math.max(0, totalMrpMinor - subtotalMinor) + (st.discountMinor || 0);

  return {
    ...st,
    items: enrichedItems,
    itemCount: enrichedItems.length,
    subtotalMinor,
    totalUnits,
    categoryBreakdown,
    totalMrpMinor,
    taxableSubtotalMinor,
    cgstMinor,
    sgstMinor,
    savingsMinor,
  };
}

export function registerCfdBridge(r: Router) {
  // 1. Update CFD state from cashier POS
  r.post('/api/cfd/update', (ctx: Ctx) => {
    const counterId = ctx.body?.counterId || 'counter-1';
    const session = getOrCreateCounter(counterId);

    const merged = {
      ...session.state,
      ...ctx.body,
      counterId,
      updatedAt: Date.now(),
    };

    session.state = enrichCfdState(merged);

    return {
      ok: true,
      updatedAt: session.state.updatedAt,
      isDisplayActive: Boolean(session.lastSeenDisplayAt && Date.now() - session.lastSeenDisplayAt < 15000),
    };
  });

  // 2. Get current state of CFD
  r.get('/api/cfd/state', (ctx: Ctx) => {
    const counterId = ctx.query?.counter || 'counter-1';
    const session = getOrCreateCounter(counterId);
    session.state = enrichCfdState(session.state);
    const isDisplayActive = Boolean(session.lastSeenDisplayAt && Date.now() - session.lastSeenDisplayAt < 15000);

    return {
      ok: true,
      state: session.state,
      isDisplayActive,
      lastSeenDisplayAt: session.lastSeenDisplayAt,
    };
  });

  // 3. Heartbeat from customer display
  r.post('/api/cfd/heartbeat', (ctx: Ctx) => {
    const counterId = ctx.body?.counterId || 'counter-1';
    const session = getOrCreateCounter(counterId);
    session.lastSeenDisplayAt = Date.now();
    if (ctx.body?.deviceInfo) {
      session.displayDeviceInfo = String(ctx.body.deviceInfo).slice(0, 100);
    }
    session.state = enrichCfdState(session.state);
    return {
      ok: true,
      timestamp: Date.now(),
      state: session.state,
    };
  });

  // 4. Instant polling events for wireless customer display tablets
  r.get('/api/cfd/events', (ctx: Ctx) => {
    const counterId = ctx.query?.counter || 'counter-1';
    const session = getOrCreateCounter(counterId);
    session.lastSeenDisplayAt = Date.now();
    session.state = enrichCfdState(session.state);

    return {
      ok: true,
      state: session.state,
    };
  });
}
