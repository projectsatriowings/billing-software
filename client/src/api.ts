// Typed client API wrapper for Adaptive Billing Platform

export const getToken = (): string => localStorage.getItem('billing_token') || '';
export const setToken = (t: string) => localStorage.setItem('billing_token', t);
export const clearToken = () => localStorage.removeItem('billing_token');

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new Event('auth_required'));
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.message || `HTTP Error ${res.status}`);
  }
  return data as T;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface Shop {
  id: string;
  name: string;
  businessType: string;
  gstin?: string;
  phone?: string;
  address?: string;
  upiId?: string;
  invoicePrefix: string;
  language?: string;
  locations?: string[];
  whatsappEnabled?: boolean;
  whatsappDefaultLang?: 'en' | 'hi' | 'ta';
  whatsappIncludeLink?: boolean;
}

export interface DemoBusiness {
  id: string;
  name: string;
  businessType: string;
  gstin?: string;
  phone?: string;
  address?: string;
  invoicePrefix: string;
  ownerEmail: string;
  ownerName: string;
}

export interface Item {
  id: string;
  name: string;
  sku?: string;
  barcode?: string;
  hsn?: string;
  unit: string;
  category?: string;
  priceMinor: number;
  costMinor: number;
  taxRateBp: number;
  taxInclusive: boolean;
  currentStockMilli: number;
  reorderMilli?: number;
  reorderLevelMilli?: number;
  minStockMilli?: number;
  preferredSupplierId?: string | null;
  preferredSupplierName?: string | null;
  preferredSupplierPhone?: string | null;
  stockStatus?: 'in_stock' | 'low_stock' | 'out_of_stock';
  stockValueMinor?: number | null;
  favorite: boolean;
  active?: boolean;
  custom?: Record<string, any>;
}

export {
  STANDARD_UNITS,
  type UnitDef,
  type Purchase,
  type PurchaseLine,
  type PurchaseStatus,
  type StockMove,
  type StockAdjustment,
  type StockCount,
  type StockCountLine,
  type InventoryDashboardStats,
  type StockMoveKind,
  type StockAdjustmentReason,
  type StockCountStatus,
  can,
  type Role,
  type Perm,
} from '../../shared/types.ts';
export { calcPurchase, planSupplierPayment, type PurchaseLineInput, type CalculatedPurchase, type CalculatedPurchaseLine, type SupplierPaymentAllocationPlan, type OpenPurchaseForAllocation } from '../../shared/purchases.ts';

export interface Party {
  id: string;
  name: string;
  type: 'customer' | 'supplier';
  phone?: string;
  email?: string;
  gstin?: string;
  stateCode?: string;
  address?: string;
  creditLimitMinor: number;
  advanceMinor?: number;
  unpaidInvoicesMinor?: number;
  duesMinor?: number;
  payableMinor?: number;
  unpaidPurchasesMinor?: number;
  openPurchasesCount?: number;
  oldestDueDate?: string | null;
  active?: boolean;
}

export interface Category {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  active: boolean;
  itemCount?: number;
}

export interface InvoiceCreditNoteSummary {
  id: string;
  number: string;
  totalMinor: number;
  status: string;
}

export interface Invoice {
  id: string;
  number: string;
  kind: string;
  status: string;
  bdate: string;
  partyId?: string;
  customerName?: string;
  customerPhone?: string;
  totalMinor: number;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  paidMinor: number;
  balanceMinor: number;
  returnedMinor?: number;
  creditNotes?: InvoiceCreditNoteSummary[];
  fullyReturned?: boolean;
  linkedInvoiceId?: string;
  createdAt: string;
  payments: { method: string; amountMinor: number }[];
  whatsappSendCount?: number;
  whatsappLastSentAt?: string;
  whatsappLastSentTo?: string;
  whatsappLastLanguage?: 'en' | 'hi' | 'ta' | string;
  whatsappLastSentBy?: string;
  shareToken?: string;
}

export interface ReturnInfoLine {
  id: string;
  pos: number;
  itemId?: string | null;
  name: string;
  hsn?: string | null;
  unit?: string | null;
  billedQtyMilli: number;
  alreadyReturnedQtyMilli: number;
  returnableQtyMilli: number;
  priceMinor: number;
  discountMinor: number;
  taxRateBp: number;
  inclusive: boolean;
  origTaxableMinor: number;
  origCgstMinor: number;
  origSgstMinor: number;
  origIgstMinor: number;
  origTotalMinor: number;
}

export interface ReturnInfo {
  invoice: {
    id: string;
    number: string;
    bdate: string;
    createdAt: string;
    customerName?: string;
    customerPhone?: string;
    partyId?: string;
    intra: boolean;
    totalMinor: number;
    paidMinor: number;
    balanceMinor: number;
  };
  lines: ReturnInfoLine[];
  customer?: {
    id: string;
    name: string;
    phone?: string;
    gstin?: string;
    address?: string;
    advanceMinor: number;
  } | null;
  otherUnpaidInvoices: {
    id: string;
    number: string;
    bdate: string;
    balanceMinor: number;
    totalMinor: number;
  }[];
  billAgeDays: number;
  fullyReturned: boolean;
  priorCreditNotes: {
    id: string;
    number: string;
    bdate: string;
    status: string;
    totalMinor: number;
    advanceAmountMinor: number;
    refundAmountMinor: number;
    createdAt: string;
    voidReason?: string;
    voidedAt?: string;
  }[];
}

export interface CreditNoteDetail {
  id: string;
  number: string;
  status: 'posted' | 'voided';
  bdate: string;
  createdAt: string;
  linkedInvoiceId: string;
  originalInvoiceNumber: string;
  originalInvoiceDate: string;
  partyId?: string;
  customerName?: string;
  customerPhone?: string;
  totalCreditMinor: number;
  taxableTotalMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  roundOffMinor: number;
  advanceAmountMinor: number;
  refundAmountMinor: number;
  refundMode?: string;
  refundReference?: string;
  note?: string;
  voidReason?: string;
  voidedAt?: string;
  voidedByName?: string;
  createdByName?: string;
  shareToken: string;
  whatsappSendCount: number;
  whatsappLastSentAt?: string;
  whatsappLastSentTo?: string;
  whatsappLastLanguage?: string;
  lines: {
    id: string;
    pos?: number;
    itemId?: string;
    name: string;
    hsn?: string;
    unit?: string;
    qtyMilli: number;
    priceMinor: number;
    discountMinor?: number;
    taxRateBp?: number;
    taxableMinor?: number;
    cgstMinor?: number;
    sgstMinor?: number;
    igstMinor?: number;
    totalMinor: number;
    reason: string;
    restock: boolean;
  }[];
  allocations: {
    invoiceId: string;
    invoiceNumber: string;
    invoiceDate?: string;
    amountMinor: number;
  }[];
}

export interface DashboardReport {
  today: {
    billCount: number;
    grossTotalMinor?: number;
    totalMinor: number;
    taxableMinor: number;
    gstMinor: number;
    khataCollectionsMinor?: number;
    totalCreditNotesMinor?: number;
    creditNotesCount?: number;
    returnRatePct?: number;
  };
  overall: {
    billCount: number;
    grossTotalMinor?: number;
    totalMinor: number;
    totalCreditNotesMinor?: number;
    customerCount: number;
    itemCount: number;
  };
  paymentBreakdown: { method: string; totalMinor: number }[];
  refundsPaid?: { mode: string; totalMinor: number }[];
  totalRefundsPaidMinor?: number;
  topItems: { name: string; qtyMilli: number; totalMinor: number }[];
  lowStock: { id: string; name: string; sku?: string; currentStockMilli: number }[];
}

export interface PaymentAllocation {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate?: string;
  amountMinor: number;
}

export interface Payment {
  id: string;
  receiptNumber: string;
  customerId: string;
  customerName?: string;
  customerPhone?: string;
  amountMinor: number;
  mode: string;
  referenceNo?: string | null;
  paymentDate: string;
  note?: string | null;
  receivedBy: string;
  receivedByName?: string | null;
  advanceMinor: number;
  status: 'posted' | 'reversed';
  reversedBy?: string | null;
  reversedByName?: string | null;
  reversedAt?: string | null;
  reversalReason?: string | null;
  shareToken?: string;
  whatsappSendCount: number;
  whatsappLastSentAt?: string | null;
  whatsappLastSentTo?: string | null;
  whatsappLastLanguage?: 'en' | 'hi' | 'ta' | null;
  createdAt: string;
  allocations: PaymentAllocation[];
  balanceAfterMinor?: number;
}

export interface KhataOverview {
  party: {
    id: string;
    name: string;
    phone?: string | null;
    gstin?: string | null;
    advanceMinor: number;
    duesMinor: number;
  };
  totalDuesMinor: number;
  totalAdvanceMinor: number;
  totalUnpaidMinor: number;
  oldestInvoiceDate: string | null;
  unpaidCount: number;
  totalBilledMinor: number;
  totalCollectedMinor: number;
  unpaidInvoices: {
    id: string;
    number: string;
    bdate: string;
    totalMinor: number;
    paidMinor: number;
    balanceMinor: number;
    createdAt: string;
  }[];
}

export interface LedgerEvent {
  id: string;
  kind: 'invoice' | 'payment';
  date: string;
  createdAt: string;
  number: string;
  description: string;
  debitMinor: number;
  creditMinor: number;
  amountMinor: number;
  runningBalanceMinor: number;
  status: string;
  mode?: string;
  referenceNo?: string;
  reversalReason?: string;
  reversedAt?: string;
  advanceMinor?: number;
  receivedByName?: string;
  whatsappSendCount?: number;
  whatsappLastSentAt?: string;
  whatsappLastLanguage?: 'en' | 'hi' | 'ta';
  allocations?: { invoiceNumber: string; amountMinor: number }[];
}

export interface CustomerLedger {
  party: {
    id: string;
    name: string;
    phone?: string | null;
    gstin?: string | null;
    address?: string | null;
    advanceMinor: number;
  };
  currentDuesMinor: number;
  closingBalanceMinor: number;
  advanceMinor: number;
  events: LedgerEvent[];
}

export interface DuesSummary {
  totalDuesMinor: number;
  totalAdvanceMinor: number;
  ageing: {
    '0_30': number;
    '31_60': number;
    '61_plus': number;
  };
  topDebtors: {
    id: string;
    name: string;
    phone?: string;
    gstin?: string;
    advanceMinor: number;
    unpaidMinor: number;
    duesMinor: number;
    oldestInvoiceDate?: string;
  }[];
}

export interface SupplierPayablesSummary {
  totalPayableMinor: number;
  ageing: {
    '0_30': number;
    '31_60': number;
    '61_plus': number;
    days0_30?: number;
    days31_60?: number;
    days60Plus?: number;
  };
  topSuppliers: {
    id: string;
    name: string;
    phone: string | null;
    gstin: string | null;
    payableMinor: number;
    openPurchasesCount: number;
    oldestInvoiceDate: string | null;
  }[];
}

export interface SupplierLedgerEntry {
  id: string;
  date: string;
  createdAt: string;
  type: 'purchase' | 'payment';
  refNumber: string;
  description: string;
  status: string;
  amountMinor: number;
  moneyEffect: number;
  runningPayableMinor: number;
  voidReason?: string | null;
}

export interface SupplierPaymentRecord {
  id: string;
  paymentNumber: string;
  method: string;
  amountMinor: number;
  reference?: string | null;
  date: string;
  status: string;
  recordedBy?: string | null;
  voidReason?: string | null;
  createdAt: string;
}

export interface SupplierLedger {
  supplier: Party;
  totalPayableMinor: number;
  runningPayableMinor: number;
  openPurchases: {
    id: string;
    purchaseNumber: string;
    supplierInvoiceNumber: string;
    supplierInvoiceDate: string;
    totalMinor: number;
    paidMinor: number;
    balanceMinor: number;
  }[];
  entries: SupplierLedgerEntry[];
  paymentHistory: SupplierPaymentRecord[];
}

export const fetchInventoryDashboard = () =>
  api<{ stats: import('../../shared/types.ts').InventoryDashboardStats }>('/api/inventory/dashboard');

export const fetchInventoryItems = (params: {
  q?: string;
  category?: string;
  status?: string;
  sort?: string;
  limit?: number;
  offset?: number;
} = {}) => {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.category && params.category !== 'ALL') sp.set('category', params.category);
  if (params.status && params.status !== 'all') sp.set('status', params.status);
  if (params.sort) sp.set('sort', params.sort);
  if (params.limit) sp.set('limit', String(params.limit));
  if (params.offset) sp.set('offset', String(params.offset));
  const queryStr = sp.toString() ? `?${sp.toString()}` : '';
  return api<{ items: Item[]; total: number; limit: number; offset: number }>(`/api/inventory/items${queryStr}`);
};

export const fetchStockLedger = (params: {
  itemId?: string;
  kind?: string;
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
  offset?: number;
} = {}) => {
  const sp = new URLSearchParams();
  if (params.itemId) sp.set('itemId', params.itemId);
  if (params.kind && params.kind !== 'ALL') sp.set('kind', params.kind);
  if (params.from) sp.set('from', params.from);
  if (params.to) sp.set('to', params.to);
  if (params.q) sp.set('q', params.q);
  if (params.limit) sp.set('limit', String(params.limit));
  if (params.offset) sp.set('offset', String(params.offset));
  const queryStr = sp.toString() ? `?${sp.toString()}` : '';
  return api<{ moves: import('../../shared/types.ts').StockMove[]; total: number; limit: number; offset: number }>(`/api/inventory/ledger${queryStr}`);
};

export const adjustStock = (data: {
  itemId: string;
  adjustmentType: 'quantity' | 'physical_count';
  changeQtyMilli?: number;
  newQtyMilli?: number;
  reason: string;
  notes?: string;
}) =>
  api<{ ok: boolean; adjustment: import('../../shared/types.ts').StockAdjustment; resultingStockMilli: number }>('/api/inventory/adjustments', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const fetchStockCounts = () =>
  api<{ counts: import('../../shared/types.ts').StockCount[] }>('/api/inventory/counts');

export const startStockCount = (data: { name: string; category?: string; notes?: string }) =>
  api<{ ok: boolean; count: import('../../shared/types.ts').StockCount }>('/api/inventory/counts', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const fetchStockCountDetails = (id: string) =>
  api<{ count: import('../../shared/types.ts').StockCount; lines: import('../../shared/types.ts').StockCountLine[] }>(`/api/inventory/counts/${id}`);

export const saveStockCountLines = (id: string, lines: { lineId: string; countedQtyMilli: number | null; notes?: string }[]) =>
  api<{ ok: boolean }>(`/api/inventory/counts/${id}/lines`, {
    method: 'PATCH',
    body: JSON.stringify({ lines }),
  });

export const finalizeStockCount = (id: string) =>
  api<{ ok: boolean; countNumber: string; appliedAdjustmentsCount: number }>(`/api/inventory/counts/${id}/finalize`, {
    method: 'POST',
  });

export const cancelStockCount = (id: string) =>
  api<{ ok: boolean }>(`/api/inventory/counts/${id}/cancel`, {
    method: 'POST',
  });

export const updateItemReorder = (
  id: string,
  data: { reorderMilli: number; minStockMilli?: number; preferredSupplierId?: string | null },
) =>
  api<{ ok: boolean; item: any }>(`/api/inventory/items/${id}/reorder`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });

export const fetchInventoryInsights = () =>
  api<{ insights: import('../../shared/types.ts').InventoryInsights }>('/api/inventory/insights');

export const fetchProductMovementAnalysis = (params: {
  range?: string;
  from?: string;
  to?: string;
  fastMinUnits?: number;
  fastMinTxns?: number;
} = {}) => {
  const sp = new URLSearchParams();
  if (params.range) sp.set('range', params.range);
  if (params.from) sp.set('from', params.from);
  if (params.to) sp.set('to', params.to);
  if (params.fastMinUnits !== undefined) sp.set('fastMinUnits', String(params.fastMinUnits));
  if (params.fastMinTxns !== undefined) sp.set('fastMinTxns', String(params.fastMinTxns));
  const qs = sp.toString() ? `?${sp.toString()}` : '';
  return api<import('../../shared/types.ts').ProductMovementAnalysisData>(`/api/inventory/movement-analysis${qs}`);
};

export type {
  InventoryInsights,
  StockoutRiskItem,
  SlowMovingItem,
  InventoryDuplicateWarning,
  AuditVarianceHistory,
  BatchExpiryWarning,
  ProductMovementStatus,
  ProductMovementItem,
  ProductMovementSummary,
  ProductMovementAnalysisData,
  Shift,
  ShiftStatus,
  CashMovement,
  CashMovementType,
  ShiftSummary,
  ShiftPaymentMethodBreakdown,
  ShiftClosingReport,
} from '../../shared/types.ts';

// Cashier Shifts & Day-End Closing API
export const fetchActiveShift = () =>
  api<{ ok: boolean; activeShift: import('../../shared/types.ts').Shift | null }>('/api/shifts/active');

export const openShift = (data: { openingCashMinor: number; location?: string; notes?: string }) =>
  api<{ ok: boolean; shift: import('../../shared/types.ts').Shift }>('/api/shifts', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const fetchShifts = (params: { status?: string; limit?: number; offset?: number } = {}) => {
  const sp = new URLSearchParams();
  if (params.status && params.status !== 'ALL') sp.set('status', params.status);
  if (params.limit) sp.set('limit', String(params.limit));
  if (params.offset) sp.set('offset', String(params.offset));
  const qs = sp.toString() ? `?${sp.toString()}` : '';
  return api<{ ok: boolean; shifts: import('../../shared/types.ts').Shift[]; total: number }>(`/api/shifts${qs}`);
};

export const fetchShiftDetails = (id: string) =>
  api<{
    ok: boolean;
    shift: import('../../shared/types.ts').Shift;
    movements: import('../../shared/types.ts').CashMovement[];
    payments: any[];
    returns: any[];
  }>(`/api/shifts/${id}`);

export const recordCashMovement = (
  id: string,
  data: { movementType: 'cash_in' | 'cash_out'; amountMinor: number; reason: string; notes?: string },
) =>
  api<{ ok: boolean; movement: import('../../shared/types.ts').CashMovement }>(`/api/shifts/${id}/cash-moves`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const closeShift = (
  id: string,
  data: { countedCashMinor: number; varianceReason?: string; note?: string },
) =>
  api<{ ok: boolean; shift: import('../../shared/types.ts').Shift }>(`/api/shifts/${id}/close`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const reviewShift = (id: string, data: { reviewNotes?: string }) =>
  api<{ ok: boolean; shiftId: string; reviewedBy: string; reviewedAt: string; reviewNotes?: string }>(`/api/shifts/${id}/review`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const fetchShiftReport = (id: string) =>
  api<{ ok: boolean; report: import('../../shared/types.ts').ShiftClosingReport }>(`/api/shifts/${id}/report`);

// ── Bulk Product Import ──────────────────────────────────────────────────────

export interface AdditionalBarcode {
  barcode: string;
  barcodeType?: 'INTERNAL' | 'MANUFACTURER' | null;
}

export interface BulkImportRow {
  name: string;
  sku?: string | null;
  barcode?: string | null;
  hsn?: string | null;
  unit?: string | null;
  categoryId?: string | null;
  category?: string | null;
  barcodeType?: 'INTERNAL' | 'MANUFACTURER' | null;
  additionalBarcodes?: (string | AdditionalBarcode)[] | null;
  productNature?: 'BRANDED' | 'SHOP_PRODUCT' | null;
  /** Selling price in paise (integer). */
  priceMinor: number;
  /** Cost price in paise (integer). */
  costMinor?: number | null;
  /** GST tax rate in basis points (e.g. 500 = 5%). */
  taxRateBp?: number | null;
  /** Whether selling price already includes GST. */
  taxInclusive?: boolean | null;
  /** Opening / incoming stock in milli-units (e.g. 5000 = 5 pieces). */
  openingQtyMilli?: number | null;
  /** Whether this row is an identified restock of an existing product */
  isRestock?: boolean;
  /** The existing product ID being restocked */
  matchedItemId?: string | null;
  /** Whether to update the existing product price details */
  updatePrices?: boolean;
}

export interface BulkImportRowResult {
  rowIndex: number;
  status: 'created' | 'restocked' | 'skipped';
  name?: string;
  itemId?: string;
  reason?: string;
}

export interface BulkImportResult {
  importId: string;
  totalRows: number;
  created: number;
  restocked: number;
  skipped: number;
  barcodesSaved: number;
  results: BulkImportRowResult[];
}

export const bulkImportItems = (rows: BulkImportRow[], importBatchId?: string) =>
  api<BulkImportResult>('/api/items/bulk-import', {
    method: 'POST',
    body: JSON.stringify({ rows, importBatchId }),
  });

export const fetchItemByBarcode = (code: string) =>
  api<{ item: Item }>(`/api/items/by-barcode/${encodeURIComponent(code)}`);

export const deleteProduct = (id: string) =>
  api<{ ok: boolean; deleted: boolean; itemId: string; message: string }>(`/api/items/${encodeURIComponent(id)}?permanent=true`, {
    method: 'DELETE',
  });
