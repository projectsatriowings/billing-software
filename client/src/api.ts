// Typed client API wrapper for Adaptive Billing Platform

export const getToken = (): string =>
  localStorage.getItem('billing_token') || localStorage.getItem('token') || '';
export const setToken = (t: string) => localStorage.setItem('billing_token', t);
export const clearToken = () => {
  localStorage.removeItem('billing_token');
  localStorage.removeItem('token');
};

export function withAuthToken(url: string): string {
  const token = getToken();
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

export async function downloadFile(url: string, defaultFilename: string): Promise<void> {
  const token = getToken();
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    const msg =
      errorData?.error?.message ||
      (typeof errorData?.error === 'string' ? errorData.error : null) ||
      errorData?.message ||
      `Export failed with status ${res.status}`;
    throw new Error(msg);
  }
  const blob = await res.blob();
  const objectUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = defaultFilename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(objectUrl);
  document.body.removeChild(a);
}

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

export async function changePassword(currentPassword: string, newPassword: string): Promise<{ token: string }> {
  const res = await api<{ token: string }>('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (res.token) {
    setToken(res.token);
  }
  return res;
}

export interface User {
  id: string;
  employeeId?: string;
  name: string;
  email: string;
  role: string;
  assignedLocation?: string;
  assignedCounter?: string;
  allowedLocations?: string[];
  active?: boolean;
}

export interface Branch {
  id: string;
  code: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  active: boolean;
  counters: string[];
  managerId?: string | null;
  managerName?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface BranchSummary {
  branch: Branch;
  todaySalesCount: number;
  todaySalesTotalMinor: number;
  todayCollectionsMinor: number;
  activeShiftsCount: number;
  activeShifts: {
    id: string;
    shiftNumber: string;
    cashierName: string;
    counter: string;
    openedAt: string;
    openingCashMinor: number;
  }[];
  pendingReviewShiftsCount: number;
  pendingReviewShifts: {
    id: string;
    shiftNumber: string;
    cashierName: string;
    closedAt: string;
    varianceMinor: number;
  }[];
  lowStockCount: number;
  lowStock: {
    id: string;
    name: string;
    sku: string;
    stockMilli: number;
  }[];
  staff: {
    id: string;
    name: string;
    email: string;
    role: string;
    active: boolean;
    counter?: string;
  }[];
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
  parentId?: string | null;
  parentName?: string | null;
  itemCount?: number;
}

export interface CategoryImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{
    row: number;
    name?: string;
    error: string;
  }>;
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
    purchasesCount?: number;
    purchasesTotalMinor?: number;
    purchasesTaxableMinor?: number;
    itcMinor?: number;
    netGstPayableMinor?: number;
    supplierPaymentsMinor?: number;
  };
  overall: {
    billCount: number;
    grossTotalMinor?: number;
    totalMinor: number;
    totalCreditNotesMinor?: number;
    customerCount: number;
    itemCount: number;
    totalSupplierPayablesMinor?: number;
    stockValuationMinor?: number;
  };
  gstPosition?: {
    outputGstMinor: number;
    itcMinor: number;
    netGstPayableMinor: number;
  };
  paymentBreakdown: { method: string; totalMinor: number }[];
  refundsPaid?: { mode: string; totalMinor: number }[];
  totalRefundsPaidMinor?: number;
  topItems: { name: string; qtyMilli: number; totalMinor: number }[];
  lowStock: { id: string; name: string; sku?: string; currentStockMilli: number }[];
  branchesOverview?: {
    totalBranches: number;
    activeBranches: number;
    totalCounters: number;
  };
  branchComparison?: {
    id: string;
    code: string;
    name: string;
    active: boolean;
    countersCount: number;
    counters: string[];
    todaySalesCount: number;
    todaySalesTotalMinor: number;
    todayCollectionsMinor: number;
    openShiftsCount: number;
  }[];
  shiftsSummary?: {
    openShiftsCount: number;
    pendingReviewShiftsCount: number;
    discrepanciesCount: number;
  };
  outstandingDuesMinor?: number;
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

export type {
  InventoryInsights,
  StockoutRiskItem,
  SlowMovingItem,
  InventoryDuplicateWarning,
  AuditVarianceHistory,
  BatchExpiryWarning,
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

export const openShift = (data: { openingCashMinor: number; location?: string; counter?: string; notes?: string }) =>
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

// Multi-Branch Management APIs
export const fetchBranches = () => api<{ branches: Branch[] }>('/api/branches');
export const createBranch = (data: Partial<Branch>) =>
  api<Branch>('/api/branches', { method: 'POST', body: JSON.stringify(data) });
export const updateBranch = (id: string, data: Partial<Branch>) =>
  api<Branch>(`/api/branches/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const fetchBranchSummary = (id: string) =>
  api<BranchSummary>(`/api/branches/${id}/summary`);

// Re-export GST and Expense shared types and utilities
export type {
  Expense,
  ExpenseCategory,
  GstTreatment,
  ItcEligibility,
  ItcMatchingStatus,
  ItcReviewStatus,
  ItcRegisterItem,
  Gstr2bRecord,
  Gstr2bImportSummary,
  Gstr3bSummary,
  GstOverviewMetrics,
} from '../../shared/types.ts';

export {
  calcExpense,
  STANDARD_EXPENSE_CATEGORIES,
} from '../../shared/gst.ts';

// --------------------------------------------------------------------------
// Expenses APIs
// --------------------------------------------------------------------------
export const fetchExpenses = (params: Record<string, string> = {}) => {
  const query = new URLSearchParams(params).toString();
  return api<{
    expenses: import('../../shared/types.ts').Expense[];
    totalCount: number;
    summary: {
      totalMinor: number;
      taxableMinor: number;
      totalGstMinor: number;
      itcMinor: number;
      paidMinor: number;
      balanceMinor: number;
    };
    page: number;
    limit: number;
  }>(`/api/expenses${query ? '?' + query : ''}`);
};

export const fetchExpenseCategories = () =>
  api<{ categories: typeof import('../../shared/gst.ts').STANDARD_EXPENSE_CATEGORIES }>('/api/expenses/categories');

export const createExpense = (data: any) =>
  api<{ expense: import('../../shared/types.ts').Expense }>('/api/expenses', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const fetchExpense = (id: string) =>
  api<{ expense: import('../../shared/types.ts').Expense }>(`/api/expenses/${id}`);

export const updateExpense = (id: string, data: any) =>
  api<{ expense: import('../../shared/types.ts').Expense }>(`/api/expenses/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const voidExpense = (id: string, reason: string) =>
  api<{ expense: import('../../shared/types.ts').Expense }>(`/api/expenses/${id}/void`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

// --------------------------------------------------------------------------
// GST Filing, ITC Register & Reconciliation APIs
// --------------------------------------------------------------------------
export const fetchGstOverview = (period?: string, gstin?: string) => {
  const q = new URLSearchParams();
  if (period) q.set('period', period);
  if (gstin) q.set('gstin', gstin);
  return api<import('../../shared/types.ts').GstOverviewMetrics>(`/api/gst/overview?${q.toString()}`);
};

export const fetchGstSalesRegister = (period?: string) => {
  const q = period ? `?period=${encodeURIComponent(period)}` : '';
  return api<{
    period: string;
    invoices: any[];
    summary: {
      totalInvoices: number;
      b2bCount: number;
      b2cCount: number;
      totalTaxableMinor: number;
      totalGstMinor: number;
      totalAmountMinor: number;
    };
  }>(`/api/gst/sales-register${q}`);
};

export const fetchGstPurchaseRegister = (period?: string) => {
  const q = period ? `?period=${encodeURIComponent(period)}` : '';
  return api<{
    period: string;
    items: any[];
    summary: {
      totalRecords: number;
      purchasesCount: number;
      expensesCount: number;
      totalTaxableMinor: number;
      totalGstMinor: number;
      totalItcMinor: number;
      totalAmountMinor: number;
    };
  }>(`/api/gst/purchase-register${q}`);
};

export const fetchItcRegister = (period?: string) => {
  const q = period ? `?period=${encodeURIComponent(period)}` : '';
  return api<{
    period: string;
    items: import('../../shared/types.ts').ItcRegisterItem[];
    summary: {
      totalRecords: number;
      totalPotentialItcMinor: number;
      totalReviewedEligibleItcMinor: number;
      totalIneligibleItcMinor: number;
      pendingReviewCount: number;
      matchedCount: number;
      mismatchCount: number;
      missingIn2BCount: number;
    };
  }>(`/api/gst/itc-register${q}`);
};

export const submitItcReview = (data: {
  docType: 'purchase' | 'expense';
  docId: string;
  returnPeriod: string;
  eligibilityStatus: string;
  reviewedEligibleItcMinor: number;
  reason: string;
}) =>
  api<{ ok: boolean; review: any }>('/api/gst/itc-review', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const importGstr2b = (data: {
  gstin: string;
  returnPeriod: string;
  filename: string;
  fileFormat: 'json' | 'csv';
  fileContent: any;
  forceOverwrite?: boolean;
}) =>
  api<{
    ok: boolean;
    importId: string;
    filename: string;
    returnPeriod: string;
    totalRecords: number;
    matchedCount: number;
    mismatchedCount: number;
    missingInBooksCount: number;
  }>('/api/gst/gstr2b/import', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const fetchGstr3b = (period?: string, gstin?: string) => {
  const q = new URLSearchParams();
  if (period) q.set('period', period);
  if (gstin) q.set('gstin', gstin);
  return api<import('../../shared/types.ts').Gstr3bSummary>(`/api/gst/gstr3b?${q.toString()}`);
};

export const saveGstr3b = (data: {
  gstin: string;
  returnPeriod: string;
  status: 'draft' | 'reviewed' | 'filed' | 'exported';
  summary?: any;
  notes?: string;
}) =>
  api<{ ok: boolean; id: string; status: string }>('/api/gst/gstr3b/save', {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const fetchGstHistory = () =>
  api<{
    history: {
      id: string;
      returnType: string;
      returnPeriod: string;
      gstin: string;
      status: string;
      summary: any;
      notes?: string | null;
      filedByName: string;
      filedAt: string;
      createdAt: string;
    }[];
  }>('/api/gst/history');

// --------------------------------------------------------------------------
// Accounts & Finance Additional Overview APIs
// --------------------------------------------------------------------------
export const fetchFinanceCashBank = () =>
  api<{
    todayDate: string;
    collectionsByMethod: { method: string; totalMinor: number }[];
    supplierPaymentsByMethod: { method: string; totalMinor: number }[];
    expensesByMethod: { method: string; totalMinor: number }[];
    cashDrawer: {
      totalCashCollectionsMinor: number;
      cashMovementsInMinor: number;
      cashMovementsOutMinor: number;
    };
    digitalBank: {
      totalUpiMinor: number;
      totalCardMinor: number;
      totalBankMinor: number;
    };
  }>('/api/finance/cash-bank');

export const fetchFinanceReceivables = () =>
  api<{
    totalReceivableMinor: number;
    customersCount: number;
    customers: {
      customerId: string;
      customerName: string;
      customerPhone?: string | null;
      totalDueMinor: number;
      openInvoicesCount: number;
      oldestInvoiceDate: string;
    }[];
  }>('/api/finance/receivables');

export const fetchFinancePayables = () =>
  api<{
    totalPayableMinor: number;
    suppliersCount: number;
    suppliers: {
      supplierId: string;
      supplierName: string;
      supplierPhone?: string | null;
      supplierGstin?: string | null;
      totalPayableMinor: number;
      openPurchasesCount: number;
      oldestBillDate: string;
    }[];
  }>('/api/finance/payables');


