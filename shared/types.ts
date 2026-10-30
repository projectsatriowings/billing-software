// Types and rules shared by server and client.

export type Role = 'owner' | 'manager' | 'cashier' | 'accountant';
export const ROLES: Role[] = ['owner', 'manager', 'cashier', 'accountant'];

const ALL: Role[] = ['owner', 'manager', 'cashier', 'accountant'];
/** Who may do what. The server enforces this; the client only uses it to hide buttons. */
export const PERMS = {
  sell: ['owner', 'manager', 'cashier'],
  'bills.view': ALL,
  returns: ['owner', 'manager'],
  'items.view': ALL,
  'items.write': ['owner', 'manager'],
  'parties.view': ALL,
  'parties.write': ['owner', 'manager', 'cashier'],
  purchases: ['owner', 'manager', 'accountant'],
  'purchases.void': ['owner', 'manager'],
  'purchases.pay': ['owner', 'manager', 'accountant'],
  'stock.view': ALL,
  'stock.adjust': ['owner', 'manager'],
  collect: ['owner', 'manager', 'cashier', 'accountant'],
  'payments.reverse': ['owner', 'manager'],
  'payments.backdate': ['owner', 'manager', 'accountant'],
  shift: ['owner', 'manager', 'cashier', 'accountant'],
  reports: ['owner', 'manager', 'accountant'],
  export: ['owner', 'manager', 'accountant'],
  'config.edit': ['owner', 'manager'],
  'config.publish': ['owner'],
  import: ['owner', 'manager'],
  assistant: ['owner', 'manager'],
  audit: ['owner', 'manager', 'accountant'],
  users: ['owner'],
  settings: ['owner', 'manager'],
  backup: ['owner'],
  plan: ['owner'],
  support: ALL,
  branches: ['owner', 'manager'],
  expenses: ['owner', 'manager', 'accountant'],
  'expenses.write': ['owner', 'manager', 'accountant'],
  'expenses.void': ['owner', 'manager'],
  'gst.view': ['owner', 'manager', 'accountant'],
  'gst.manage': ['owner', 'accountant'],
} as const satisfies Record<string, readonly Role[]>;
export type Perm = keyof typeof PERMS;
export const can = (role: Role | undefined, perm: Perm): boolean => !!role && (PERMS[perm] as readonly Role[]).includes(role);

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

export interface BranchInput {
  code: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  active?: boolean;
  counters?: string[];
  managerId?: string | null;
}

export type FieldEntity = 'item' | 'customer' | 'invoice';
export type FieldType = 'text' | 'number' | 'date' | 'select';
export interface FieldDef {
  id: string; // stable identifier; labels can change without breaking reports
  entity: FieldEntity;
  label: string;
  type: FieldType;
  options?: string[];
  required?: boolean;
  showOnPrint?: boolean;
}

export type Paper = 'thermal58' | 'thermal80' | 'a4' | 'a5';
export type Lang = 'en' | 'ta' | 'hi';
export interface PrintTemplate {
  paper: Paper;
  showHsn: boolean;
  showDiscount: boolean;
  showTaxBreakup: boolean;
  showUnit: boolean;
  qr: 'none' | 'upi' | 'link';
  header: string;
  footer: string;
  terms: string;
  copies: 1 | 2 | 3;
  language: Lang;
}
export interface Rules {
  maxDiscountPctCashier: number; // 0-100; discounts above this need a manager
  allowNegativeStock: boolean;
  cashierCanEditPrice: boolean;
  creditLimitEnforced: boolean;
  roundTotal: 'rupee' | 'none';
  requireCustomerAboveMinor: number; // 0 = never required
}
export interface Features {
  batch: boolean; // batch + expiry tracking
  serial: boolean; // serial / IMEI numbers on lines
  multiLocation: boolean;
}
export interface Config {
  fields: FieldDef[];
  template: PrintTemplate;
  rules: Rules;
  features: Features;
}

export const DEFAULT_CONFIG: Config = {
  fields: [],
  template: { paper: 'thermal80', showHsn: false, showDiscount: true, showTaxBreakup: true, showUnit: true, qr: 'upi', header: '', footer: 'Thank you! Visit again.', terms: '', copies: 1, language: 'en' },
  rules: { maxDiscountPctCashier: 10, allowNegativeStock: false, cashierCanEditPrice: false, creditLimitEnforced: true, roundTotal: 'rupee', requireCustomerAboveMinor: 0 },
  features: { batch: false, serial: false, multiLocation: false },
};

export function mergeConfig(base: Config, over: Partial<Config> | undefined): Config {
  if (!over) return structuredClone(base);
  return {
    fields: over.fields ?? base.fields,
    template: { ...base.template, ...(over.template ?? {}) },
    rules: { ...base.rules, ...(over.rules ?? {}) },
    features: { ...base.features, ...(over.features ?? {}) },
  };
}

export interface ValidationReport { errors: string[]; warnings: string[] }

/** Validate a configuration before it can be previewed/published. Blocking problems go in `errors`. */
export function validateConfig(c: Config): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const f of c.fields ?? []) {
    if (!/^f_[a-z0-9_]{2,40}$/.test(f.id)) errors.push(`Field "${f.label || f.id}": id must look like f_name (letters, digits, underscore)`);
    if (seen.has(f.id)) errors.push(`Field id ${f.id} is used twice`);
    seen.add(f.id);
    if (!f.label?.trim()) errors.push(`Field ${f.id}: name is required`);
    if (!['item', 'customer', 'invoice'].includes(f.entity)) errors.push(`Field ${f.label}: unknown place "${f.entity}"`);
    if (!['text', 'number', 'date', 'select'].includes(f.type)) errors.push(`Field ${f.label}: unknown type "${f.type}"`);
    if (f.type === 'select' && (f.options?.filter((o) => o.trim()).length ?? 0) < 2) errors.push(`Field ${f.label}: a choice list needs at least 2 options`);
    if (f.required && f.entity === 'invoice') warnings.push(`Field ${f.label} is required on every bill: cashiers must fill it before they can pay`);
    if (f.showOnPrint && f.entity === 'item') warnings.push(`Field ${f.label}: item fields are not printed on the bill`);
  }
  const t = c.template;
  if (!['thermal58', 'thermal80', 'a4', 'a5'].includes(t.paper)) errors.push('Paper size is not supported');
  if (![1, 2, 3].includes(t.copies)) errors.push('Copies must be 1, 2 or 3');
  if (!['en', 'ta', 'hi'].includes(t.language)) errors.push('Bill language is not supported');
  if (!['none', 'upi', 'link'].includes(t.qr)) errors.push('QR option is not supported');
  if (t.paper === 'thermal58' && t.showHsn && t.showDiscount) warnings.push('58 mm paper is narrow: HSN and discount columns may wrap');
  if ((t.footer || '').length > 200 || (t.terms || '').length > 600) errors.push('Footer or terms text is too long');
  const r = c.rules;
  if (!(r.maxDiscountPctCashier >= 0 && r.maxDiscountPctCashier <= 100)) errors.push('Cashier discount limit must be between 0 and 100');
  if (!['rupee', 'none'].includes(r.roundTotal)) errors.push('Round-off option is not supported');
  if (r.allowNegativeStock) warnings.push('Negative stock is allowed: stock numbers may drift if items are sold before purchase entry');
  if (r.cashierCanEditPrice) warnings.push('Cashiers can change item prices at the counter');
  return { errors, warnings };
}

export const BUSINESS_TYPES = [
  'retail',
  'wholesale',
  'pharmacy',
  'restaurant',
  'service',
  'general',
  'grocery',
  'supermarket',
  'clothing',
  'electronics',
  'hardware',
  'other',
] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const PAYMENT_METHODS = ['cash', 'upi', 'card', 'bank', 'credit'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface PlanDef { id: string; name: string; maxUsers: number; invoicesPerMonth: number; note: string }
/** Placeholder plans for demo purposes: real prices and limits are a business decision. */
export const PLANS: PlanDef[] = [
  { id: 'free', name: 'Free', maxUsers: 2, invoicesPerMonth: 200, note: 'Single shop, basic reports' },
  { id: 'standard', name: 'Standard', maxUsers: 5, invoicesPerMonth: 3000, note: 'More staff and bills' },
  { id: 'pro', name: 'Pro', maxUsers: 25, invoicesPerMonth: 100000, note: 'Multi-location, priority support' },
];

export const SUGGESTED_TAX_RATES_BP = [0, 500, 1800, 4000];

export interface UnitDef {
  code: string;
  name: string;
}

export const STANDARD_UNITS: readonly UnitDef[] = [
  { code: 'pcs', name: 'Pieces (pcs)' },
  { code: 'kg', name: 'Kilograms (kg)' },
  { code: 'g', name: 'Grams (g)' },
  { code: 'l', name: 'Litres (l)' },
  { code: 'ml', name: 'Millilitres (ml)' },
  { code: 'm', name: 'Metres (m)' },
  { code: 'box', name: 'Boxes (box)' },
  { code: 'pack', name: 'Packs (pack)' },
  { code: 'strip', name: 'Strips (strip)' },
  { code: 'carton', name: 'Cartons (carton)' },
  { code: 'set', name: 'Sets (set)' },
];

export interface Category {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  active: boolean;
  parentId?: string | null;
  parentName?: string | null;
  createdAt?: string;
  itemCount?: number;
}

export interface CategoryImportRow {
  name: string;
  parentCategory?: string | null;
  description?: string | null;
  status?: string | null;
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

export type PurchaseStatus = 'draft' | 'posted' | 'voided' | 'cancelled';

export interface PurchaseLine {
  id: string;
  tenantId?: string;
  purchaseId?: string;
  itemId: string;
  name: string;
  hsn?: string;
  unit?: string;
  qtyMilli: number;
  billedQtyMilli?: number;
  receivedQtyMilli?: number;
  costMinor: number;
  discountMinor?: number;
  taxRateBp: number;
  taxableMinor: number;
  taxMinor: number;
  cgstMinor?: number;
  sgstMinor?: number;
  igstMinor?: number;
  totalMinor: number;
  batchNo?: string;
  expiry?: string;
}

export interface Purchase {
  id: string;
  tenantId?: string;
  purchaseNumber?: string;
  supplierId: string;
  supplierName?: string;
  supplierPhone?: string;
  supplierGstin?: string;
  billNo: string;
  supplierInvoiceNumber?: string;
  supplierInvoiceDate?: string;
  purchaseDate?: string;
  bdate: string;
  status: PurchaseStatus;
  subtotalMinor: number;
  discountMinor: number;
  taxableMinor: number;
  taxMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  itcMinor?: number;
  otherChargesLabel?: string;
  otherChargesMinor?: number;
  otherChargesGstMinor?: number;
  otherChargesGstBp?: number;
  roundOffMinor: number;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  paymentMethod?: string;
  note?: string;
  voidReason?: string;
  voidedBy?: string;
  voidedAt?: string;
  createdBy?: string;
  createdAt: string;
  lines?: PurchaseLine[];
  payments?: any[];
}

export type StockMoveKind = 'opening' | 'purchase' | 'sale' | 'return' | 'adjust' | 'transfer';
export type StockAdjustmentReason = 'damaged' | 'expired' | 'missing' | 'found' | 'correction' | 'physical_count_diff' | 'other';
export type StockCountStatus = 'draft' | 'in_progress' | 'completed' | 'cancelled';

export interface StockMove {
  id: string;
  seq?: number;
  tenantId?: string;
  itemId: string;
  itemName?: string;
  sku?: string | null;
  barcode?: string | null;
  unit?: string;
  category?: string | null;
  location: string;
  qtyMilli: number;
  qtyInMilli?: number;
  qtyOutMilli?: number;
  previousBalanceMilli?: number;
  resultingBalanceMilli?: number;
  kind: StockMoveKind;
  refType?: string | null;
  refId?: string | null;
  refLineId?: string | null;
  refNumber?: string | null;
  batchNo?: string | null;
  expiry?: string | null;
  unitCostMinor?: number | null;
  reason?: string | null;
  notes?: string | null;
  userId?: string | null;
  userName?: string | null;
  createdAt: string;
}

export interface StockAdjustment {
  id: string;
  tenantId?: string;
  adjustmentNumber: string;
  itemId: string;
  itemName?: string;
  sku?: string | null;
  barcode?: string | null;
  unit?: string;
  location: string;
  adjustmentType: 'quantity' | 'physical_count';
  reason: StockAdjustmentReason;
  oldQtyMilli: number;
  newQtyMilli: number;
  changeQtyMilli: number;
  unitCostMinor: number;
  notes?: string | null;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
}

export interface StockCountLine {
  id: string;
  countId: string;
  itemId: string;
  itemName: string;
  sku?: string | null;
  barcode?: string | null;
  category?: string | null;
  unit: string;
  systemQtyMilli: number;
  countedQtyMilli: number | null;
  diffQtyMilli: number | null;
  unitCostMinor: number;
  notes?: string | null;
}

export interface StockCount {
  id: string;
  tenantId?: string;
  countNumber: string;
  name: string;
  status: StockCountStatus;
  category?: string | null;
  location: string;
  notes?: string | null;
  totalItemsCount?: number;
  countedItemsCount?: number;
  discrepancyCount?: number;
  netDiffMilli?: number;
  createdBy?: string;
  createdByName?: string;
  finalizedBy?: string;
  finalizedByName?: string;
  finalizedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  lines?: StockCountLine[];
}

export interface InventoryDashboardStats {
  totalActiveProducts: number;
  inStockCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  zeroStockCount?: number;
  negativeStockCount?: number;
  unconfiguredCount: number;
  totalStockValueMinor: number | null;
  costingMethod?: string;
  valuationDate?: string;
  categoryBreakdown: {
    category: string;
    productCount: number;
    totalStockMilli: number;
    stockValueMinor: number | null;
  }[];
  recentMovements: StockMove[];
  replenishmentNeeded: {
    itemId: string;
    name: string;
    sku?: string | null;
    barcode?: string | null;
    category?: string | null;
    unit: string;
    currentStockMilli: number;
    minStockMilli: number;
    reorderMilli: number;
    suggestedOrderQtyMilli: number;
    preferredSupplierId?: string | null;
    preferredSupplierName?: string | null;
    preferredSupplierPhone?: string | null;
  }[];
}

export interface StockoutRiskItem {
  itemId: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  unit: string;
  category?: string | null;
  currentStockUnits: number;
  sold30dUnits: number;
  dailyVelocityUnits: number;
  ordersCount: number;
  runwayDays: number;
  riskLevel: 'out_of_stock' | 'critical' | 'high' | 'moderate';
  explainableReason: string;
  preferredSupplierName?: string | null;
  hasSufficientHistory?: boolean;
}

export interface SlowMovingItem {
  itemId: string;
  name: string;
  sku?: string | null;
  unit: string;
  category?: string | null;
  currentStockUnits: number;
  costMinor: number | null;
  tiedCapitalMinor: number | null;
  lastSaleAt: string | null;
  explainableReason: string;
}

export interface InventoryDuplicateWarning {
  type: 'barcode_collision' | 'name_duplicate';
  key: string;
  count: number;
  items: { id: string; name: string; sku?: string | null; barcode?: string | null }[];
  description: string;
}

export interface AuditVarianceHistory {
  id: string;
  countNumber: string;
  name: string;
  finalizedAt: string;
  totalLines: number;
  discrepantLines: number;
  accuracyPct: number;
  netDiffUnits: number;
  gainUnits: number;
  lossUnits: number;
  netVarianceValueMinor: number | null;
}

export interface BatchExpiryWarning {
  itemId: string;
  itemName: string;
  unit: string;
  batchNo: string;
  expiry: string;
  inwardUnits?: number;
  remainingUnits?: number | null;
  inwardBatchNotice?: string;
  status: 'expired' | 'expiring_soon' | 'healthy';
  warning: string;
}

export interface InventoryInsights {
  methodology: string;
  generatedAt: string;
  costingMethod: string;
  stockoutRisks: StockoutRiskItem[];
  slowMovingItems: SlowMovingItem[];
  duplicates: InventoryDuplicateWarning[];
  auditVariance: {
    recentCounts: AuditVarianceHistory[];
    adjustmentReasons: {
      reason: string;
      count: number;
      netChangeUnits: number;
      absChangeUnits: number;
    }[];
  };
  batchWarnings: BatchExpiryWarning[];
}

export type ShiftStatus = 'open' | 'closed';
export type CashMovementType = 'cash_in' | 'cash_out';

export interface CashMovement {
  id: string;
  tenantId?: string;
  shiftId: string;
  movementType: CashMovementType;
  amountMinor: number;
  reason: string;
  notes?: string | null;
  createdBy: string;
  createdByName?: string;
  createdAt: string;
}

export interface ShiftPaymentMethodBreakdown {
  method: string;
  count: number;
  amountMinor: number;
}

export interface ShiftSummary {
  openingCashMinor: number;
  cashSalesMinor: number;
  cashPaymentsMinor: number;
  totalCashReceivedMinor: number;
  cashInMinor: number;
  cashOutMinor: number;
  cashRefundsMinor: number;
  expectedCashMinor: number;
  countedCashMinor?: number | null;
  varianceMinor?: number | null;
  nonCashPaymentsMinor: number;
  totalCollectedMinor: number;
  totalSalesBilledMinor: number;
  creditSalesUnpaidMinor: number;
  paymentMethods: ShiftPaymentMethodBreakdown[];
  transactionsCount: number;
  invoicesCount: number;
  returnsCount: number;
  cashMovesCount: number;
}

export interface Shift {
  id: string;
  tenantId?: string;
  shiftNumber?: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  userRole?: Role;
  location: string;
  status: ShiftStatus;
  openedAt: string;
  closedAt?: string | null;
  openingCashMinor: number;
  expectedCashMinor?: number | null;
  countedCashMinor?: number | null;
  varianceMinor?: number | null;
  summary?: ShiftSummary | null;
  note?: string | null;
  closedBy?: string | null;
  closedByName?: string | null;
  reviewedBy?: string | null;
  reviewedByName?: string | null;
  reviewedAt?: string | null;
  reviewNotes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type VarianceClassification = 'exact' | 'shortage' | 'excess';

export interface ShiftClosingReport {
  shop?: { name: string; gstin?: string; address?: string; phone?: string };
  shift: Shift;
  summary: ShiftSummary;
  varianceClassification?: {
    type: VarianceClassification;
    label?: string;
    isBalanced?: boolean;
    absAmountMinor: number;
    requiresReason: boolean;
  };
  cashMovements: CashMovement[];
  recentTransactions: {
    id: string;
    number: string;
    type: 'sale' | 'payment' | 'credit_note';
    method: string;
    amountMinor: number;
    customerName?: string | null;
    createdAt: string;
  }[];
}

export type ExpenseCategory =
  | 'rent'
  | 'electricity'
  | 'internet'
  | 'transport'
  | 'advertising'
  | 'packaging'
  | 'maintenance'
  | 'office_supplies'
  | 'professional_fees'
  | 'salary'
  | 'tea_snacks'
  | 'other';

export type GstTreatment = 'regular' | 'composition' | 'exempt' | 'nil_rated' | 'non_gst' | 'import';
export type ItcEligibility = 'eligible' | 'ineligible' | 'blocked_17_5' | 'pending_review';

export interface Expense {
  id: string;
  tenantId: string;
  expenseNumber: string;
  expenseDate: string;
  category: ExpenseCategory | string;
  description?: string | null;
  notes?: string | null;
  supplierId?: string | null;
  supplierName?: string | null;
  supplierGstin?: string | null;
  supplierInvoiceNumber?: string | null;
  supplierInvoiceDate?: string | null;
  taxInclusive: boolean;
  taxRateBp: number;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  totalMinor: number;
  paymentMethod: 'cash' | 'upi' | 'card' | 'bank' | 'cheque' | 'credit';
  paymentStatus: 'paid' | 'unpaid' | 'partial';
  paidMinor: number;
  balanceMinor: number;
  gstTreatment: GstTreatment;
  itcEligibility: ItcEligibility;
  itcMinor: number;
  location: string;
  status: 'posted' | 'voided';
  voidReason?: string | null;
  voidedBy?: string | null;
  voidedAt?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ItcMatchingStatus =
  | 'pending_review'
  | 'matched'
  | 'missing_from_2b'
  | 'missing_in_books'
  | 'taxable_mismatch'
  | 'gst_mismatch'
  | 'requires_correction';

export type ItcReviewStatus =
  | 'pending_review'
  | 'eligible_reviewed'
  | 'partially_eligible_reviewed'
  | 'ineligible_reviewed'
  | 'blocked_17_5'
  | 'requires_correction';

export interface ItcRegisterItem {
  id: string;
  docType: 'purchase' | 'expense';
  docId: string;
  docNumber: string;
  docDate: string;
  supplierName: string;
  supplierGstin?: string | null;
  supplierInvoiceNumber: string;
  supplierInvoiceDate: string;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  totalGstMinor: number;
  totalAmountMinor: number;
  gstr2bMatchingStatus: ItcMatchingStatus;
  itcReviewStatus: ItcReviewStatus;
  reviewedEligibleItcMinor: number;
  ineligibleItcMinor: number;
  mismatchMinor: number;
  reviewDecisionReason?: string | null;
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  sourceLink: string;
}

export interface Gstr2bRecord {
  id: string;
  importId: string;
  returnPeriod: string;
  supplierGstin: string;
  supplierName?: string | null;
  invoiceNumber: string;
  invoiceType: string;
  invoiceDate: string;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  cessMinor: number;
  totalGstMinor: number;
  itcAvailability: string;
  reason?: string | null;
  matchedStatus: 'matched' | 'taxable_mismatch' | 'gst_mismatch' | 'missing_in_books' | 'unmatched';
  linkedDocType?: 'purchase' | 'expense' | null;
  linkedDocId?: string | null;
}

export interface Gstr2bImportSummary {
  id: string;
  gstin: string;
  returnPeriod: string;
  filename: string;
  fileFormat: 'json' | 'csv';
  totalRecords: number;
  totalTaxableMinor: number;
  totalCgstMinor: number;
  totalSgstMinor: number;
  totalIgstMinor: number;
  matchedCount: number;
  mismatchedCount: number;
  missingInBooksCount: number;
  createdAt: string;
}

export interface Gstr3bSummary {
  gstin: string;
  returnPeriod: string;
  status: 'draft' | 'reviewed' | 'finalized';
  table31Outward: {
    taxableSupplies: { taxableMinor: number; igstMinor: number; cgstMinor: number; sgstMinor: number };
    zeroRated: { taxableMinor: number; igstMinor: number; cgstMinor: number; sgstMinor: number };
    nilRatedExempt: { taxableMinor: number; igstMinor: number; cgstMinor: number; sgstMinor: number };
    reverseChargeInward: { taxableMinor: number; igstMinor: number; cgstMinor: number; sgstMinor: number };
    nonGst: { taxableMinor: number; igstMinor: number; cgstMinor: number; sgstMinor: number };
  };
  table4EligibleItc: {
    allOtherItc: { igstMinor: number; cgstMinor: number; sgstMinor: number; totalMinor: number };
    reversalRule42_43: { igstMinor: number; cgstMinor: number; sgstMinor: number; totalMinor: number };
    netItcAvailable: { igstMinor: number; cgstMinor: number; sgstMinor: number; totalMinor: number };
    ineligibleSection17_5: { igstMinor: number; cgstMinor: number; sgstMinor: number; totalMinor: number };
  };
  netTaxPayable: {
    igstMinor: number;
    cgstMinor: number;
    sgstMinor: number;
    totalMinor: number;
  };
  unresolvedMismatchesCount: number;
  unreviewedRecordsCount: number;
}

export interface GstOverviewMetrics {
  selectedGstin: string;
  returnPeriod: string;
  salesTaxableMinor: number;
  outputGstMinor: number;
  purchaseTaxableMinor: number;
  purchaseGstMinor: number;
  expenseTaxableMinor: number;
  expenseGstUnderReviewMinor: number;
  potentialItcMinor: number;
  reviewedEligibleItcMinor: number;
  ineligibleItcMinor: number;
  unresolvedMismatchesCount: number;
  estimatedNetGstLiabilityMinor: number;
  gstr1Status: 'ready' | 'pending';
  gstr3bStatus: 'draft' | 'ready_to_file' | 'pending_review';
}

// ── PRODUCT MOVEMENT ANALYSIS (FAST / SLOW / NON-MOVING) ───────────────────
export type ProductMovementStatus = 'fast_moving' | 'slow_moving' | 'non_moving';

export interface ProductMovementItem {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  unit: string;
  currentStockUnits: number;
  unitsSold: number;
  salesTxns: number;
  lastSoldAt: string | null;
  movementStatus: ProductMovementStatus;
  suggestedAction: string;
}

export interface ProductMovementSummary {
  fastMovingCount: number;
  slowMovingCount: number;
  nonMovingCount: number;
  totalTrackedProducts: number;
  totalUnitsSold: number;
  totalSalesBills: number;
  rangeDays: number;
  startDate: string;
  endDate: string;
  fastMinUnits: number;
  fastMinTxns: number;
  slowMinUnits: number;
}

export interface ProductMovementAnalysisData {
  summary: ProductMovementSummary;
  topSellers: {
    id: string;
    name: string;
    unit: string;
    unitsSold: number;
  }[];
  insights: {
    bestSeller?: {
      name: string;
      unitsSold: number;
      unit: string;
      salesTxns: number;
      currentStockUnits: number;
      runwayDays?: number | null;
    } | null;
    slowingProduct?: {
      name: string;
      unitsSold: number;
      unit: string;
      currentStockUnits: number;
      message: string;
    } | null;
    nonMovingSummary: {
      count: number;
      tiedCapitalMinor: number;
      days: number;
    };
  };
  products: ProductMovementItem[];
}

export interface SalesSummaryMetrics {
  netSalesMinor: number;
  grossSalesMinor: number;
  returnsMinor: number;
  billsCount: number;
  avgBillValueMinor: number;
  grossProfitMinor: number;
  cogsMinor: number;
  marginPct: number;
  returnsCount: number;
  returnRatePct: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  totalGstMinor: number;
  avgBillsPerDay: number;
  costEstimated: boolean;
}

export interface SalesComparisonDiff {
  netSalesChangePct: number;
  billsCountChangePct: number;
  avgBillChangePct: number;
  grossProfitChangePct: number;
  marginPointDiff: number;
}

export interface SalesOverviewPoint {
  date: string;
  label: string;
  weekday: string;
  salesMinor: number;
  billsCount: number;
  grossProfitMinor: number;
  avgBillMinor: number;
}

export interface CategorySalesItem {
  category: string;
  netSalesMinor: number;
  sharePct: number;
  billsCount: number;
  color: string;
}

export interface HeatmapCell {
  weekday: number;
  weekdayName: string;
  hour: number;
  hourLabel: string;
  salesMinor: number;
  billsCount: number;
}

export interface PaymentModeBreakdown {
  mode: string;
  label: string;
  totalMinor: number;
  sharePct: number;
  color: string;
}

export interface TopCustomerItem {
  id: string;
  name: string;
  phone?: string;
  netSalesMinor: number;
  billsCount: number;
  isB2B: boolean;
  isKhata: boolean;
  creditDuesMinor?: number;
}

export interface SalesInsight {
  id: string;
  type: 'growth' | 'peak' | 'returns' | 'credit' | 'info';
  title: string;
  description: string;
  tag?: string;
  icon: string;
  theme: 'emerald' | 'amber' | 'purple' | 'blue' | 'rose';
}

export interface DaywiseSalesRow {
  date: string;
  formattedDate: string;
  weekday: string;
  billsCount: number;
  grossSalesMinor: number;
  returnsMinor: number;
  netSalesMinor: number;
  discountMinor: number;
  gstMinor: number;
  grossProfitMinor: number;
  marginPct: number;
  prevWeekSameDayChangePct: number | null;
}

export interface CashierPerformanceRow {
  userId: string;
  userName: string;
  counterName: string;
  salesMinor: number;
  billsCount: number;
  avgBillMinor: number;
}

export interface CashierSummaryStrip {
  voidedBillsCount: number;
  voidedTotalMinor: number;
  discountsGivenMinor: number;
  billsOnCreditCount: number;
  billsOnCreditMinor: number;
}

export interface SalesAnalysisData {
  filters: {
    from: string;
    to: string;
    compare: 'previous_period' | 'same_period_last_month' | 'none';
    counterId: string;
    categoryId: string;
    userId: string;
    rangeDays: number;
  };
  filterOptions: {
    counters: { id: string; name: string }[];
    categories: string[];
    cashiers: { id: string; name: string; role: string }[];
  };
  summary: SalesSummaryMetrics;
  comparison: {
    hasComparison: boolean;
    periodLabel: string;
    summary: SalesSummaryMetrics;
    diff: SalesComparisonDiff;
  } | null;
  series: SalesOverviewPoint[];
  grouping: 'day' | 'week';
  categories: CategorySalesItem[];
  heatmap: {
    matrix: HeatmapCell[];
    peakSlot: string;
    maxCellSalesMinor: number;
  };
  payments: {
    modes: PaymentModeBreakdown[];
    totalPaidMinor: number;
  };
  topCustomers: TopCustomerItem[];
  insights: SalesInsight[];
  daywise: DaywiseSalesRow[];
  cashierPerformance: {
    rows: CashierPerformanceRow[];
    summaryStrip: CashierSummaryStrip;
  } | null;
}
