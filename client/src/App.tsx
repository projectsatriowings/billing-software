import React, { useState, useEffect } from 'react';
import {
  api,
  setToken,
  clearToken,
  getToken,
  type User,
  type Shop,
  type Item,
  type Party,
  type Invoice,
  type DashboardReport,
  type DemoBusiness,
  type Category,
  STANDARD_UNITS,
  type UnitDef,
  type Purchase,
  type PurchaseLine,
  type PurchaseStatus,
  type Payment,
  type PaymentAllocation,
  type KhataOverview,
  type CustomerLedger,
  type LedgerEvent,
  type DuesSummary,
  type ReturnInfo,
  type CreditNoteDetail,
  can,
  calcPurchase,
  planSupplierPayment,
  type SupplierPaymentAllocationPlan,
  type SupplierLedger,
  type SupplierLedgerEntry,
  type SupplierPaymentRecord,
} from './api';
import { moneyInWords } from '../../shared/money.ts';
import {
  normalizePhone,
  whatsappLink,
  billMessage,
  receiptMessage,
  receiptCorrectionMessage,
  creditNoteMessage,
  type CreditNoteMessageInput,
} from '../../shared/whatsapp.ts';
import {
  calcReturn,
  planSettlement,
  type ReturnLineInput,
  type CalculatedReturn,
  type SettlementPlan,
} from '../../shared/returns.ts';
import { LandingPage } from './components/LandingPage';
import { RegisterWizard } from './components/RegisterWizard';
import { LoginPage } from './components/LoginPage';
import { BusinessSelector } from './components/BusinessSelector';
import { StrictIsolationBanner } from './components/StrictIsolationBanner';
import { InventoryDashboard } from './components/inventory/InventoryDashboard';
import { ShiftsDashboard } from './components/shifts/ShiftsDashboard.tsx';
import { SuperAdminDashboard } from './components/dashboards/SuperAdminDashboard';
import { StoreManagerDashboard } from './components/dashboards/StoreManagerDashboard';
import { CashierDashboard } from './components/dashboards/CashierDashboard';

// Format paise to INR
const formatRupees = (paise: number = 0) => {
  return '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// WhatsApp Bill Sharing Helpers (Strictly adhering to specs/WhatsApp Bill Sharing Spec.md)
export const validateIndianPhone = (raw: string): { valid: boolean; normalized: string | null } => {
  if (!raw || !raw.trim()) return { valid: false, normalized: null };
  let cleaned = raw.trim();
  if (cleaned.startsWith('+')) {
    cleaned = '+' + cleaned.replace(/\D/g, '');
  } else {
    cleaned = cleaned.replace(/\D/g, '');
  }
  const norm = normalizePhone(cleaned);
  // Indian national number after country code 91 must be exactly 10 digits (total 12 digits)
  if (norm && norm.length === 12 && norm.startsWith('91')) {
    return { valid: true, normalized: norm };
  }
  return { valid: false, normalized: null };
};

export const buildWhatsAppMessage = (opts: {
  shopName: string;
  number: string;
  totalMinor: number;
  balanceMinor: number;
  shareToken?: string;
  lang: 'en' | 'hi' | 'ta';
  includeLink?: boolean;
}): string => {
  const url = opts.includeLink && opts.shareToken
    ? `${window.location.origin}/b/${opts.shareToken}`
    : '';

  let msg = billMessage({
    shopName: opts.shopName,
    number: opts.number,
    totalMinor: opts.totalMinor,
    balanceMinor: opts.balanceMinor,
    url,
    lang: opts.lang,
    kind: 'sale',
  });

  if (!opts.includeLink || !url) {
    msg = msg.replace(/\n(View \/ download|बिल देखें \/ डाउनलोड करें|பில்லைப் பார்க்க \/ பதிவிறக்க):\s*$/m, '').trim();
  }
  return msg;
};

// Business Type Helper Functions
export const getBusinessIcon = (type?: string) => {
  switch (type) {
    case 'pharmacy': return '💊';
    case 'restaurant': return '🍽️';
    case 'wholesale': return '📦';
    case 'service': return '💼';
    case 'retail': return '🛒';
    default: return '🏢';
  }
};

export const getBusinessLabel = (type?: string) => {
  switch (type) {
    case 'pharmacy': return 'Pharmacy & Medicals';
    case 'restaurant': return 'Restaurant & Cafe';
    case 'wholesale': return 'Wholesale & B2B';
    case 'service': return 'Professional Services';
    case 'retail': return 'Retail & Supermarket';
    default: return 'General Business';
  }
};

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [shop, setShop] = useState<Shop | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'pos' | 'shifts' | 'items' | 'inventory' | 'purchases' | 'invoices' | 'customers' | 'suppliers' | 'reports' | 'settings'>('dashboard');
  const [activeShiftNumber, setActiveShiftNumber] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // View routing: 'landing' (Screen 1) | 'login' (Screen 7) | 'register' (Screens 2-6) | 'selector' (Screen 8) | 'dashboard' (Screen 9)
  const [view, setView] = useState<'landing' | 'login' | 'register' | 'selector' | 'dashboard'>('landing');
  const [regSelectedBusinessType, setRegSelectedBusinessType] = useState<string>('grocery');

  const navigateTo = (newView: 'landing' | 'login' | 'register' | 'selector' | 'dashboard') => {
    setView(newView);
    window.location.hash = newView;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Multi-business state
  const [demoBusinesses, setDemoBusinesses] = useState<DemoBusiness[]>([]);
  const [myBusinesses, setMyBusinesses] = useState<DemoBusiness[]>([]);
  const [showBusinessDropdown, setShowBusinessDropdown] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Auth inputs
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('demo@billing.local');
  const [password, setPassword] = useState('Password123!');
  const [authError, setAuthError] = useState('');

  // Register inputs
  const [regStoreName, setRegStoreName] = useState('');
  const [regBusinessType, setRegBusinessType] = useState('retail');
  const [regOwnerName, setRegOwnerName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('Password123!');
  const [regGstin, setRegGstin] = useState('');
  const [regPhone, setRegPhone] = useState('');

  // POS & Inventory State
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [categoriesList, setCategoriesList] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<{ item: Item; qty: number }[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [selectedPartyId, setSelectedPartyId] = useState<string>('');
  const [selectedPayMode, setSelectedPayMode] = useState<'cash' | 'upi' | 'card' | 'bank'>('cash');
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [printModalInvoiceId, setPrintModalInvoiceId] = useState<string | null>(null);

  // Modern Image 2 POS State
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [appliedDiscountPercent, setAppliedDiscountPercent] = useState<number>(0);
  const [showDiscountPicker, setShowDiscountPicker] = useState(false);
  const [heldOrders, setHeldOrders] = useState<{ id: string; cart: { item: Item; qty: number }[]; timestamp: Date }[]>([]);

  // Specialized Business Fields
  // Restaurant:
  const [restaurantTable, setRestaurantTable] = useState('Table 1');
  const [restaurantOrderType, setRestaurantOrderType] = useState<'Dine-in' | 'Takeaway' | 'Delivery'>('Dine-in');
  // Pharmacy:
  const [doctorName, setDoctorName] = useState('Dr. M. Ramesh MBBS, MD');
  // Wholesale:
  const [poNumber, setPoNumber] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  // Service:
  const [jobRef, setJobRef] = useState('');
  const [paymentDueDate, setPaymentDueDate] = useState('');

  // Invoices list state
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  // Analytics state
  const [report, setReport] = useState<DashboardReport | null>(null);

  // Settings tab form state
  const [settingsName, setSettingsName] = useState('');
  const [settingsType, setSettingsType] = useState('retail');
  const [settingsGstin, setSettingsGstin] = useState('');
  const [settingsPhone, setSettingsPhone] = useState('');
  const [settingsAddress, setSettingsAddress] = useState('');
  const [settingsUpiId, setSettingsUpiId] = useState('');
  const [settingsPrefix, setSettingsPrefix] = useState('');
  const [settingsSavedMsg, setSettingsSavedMsg] = useState('');

  // Settings: WhatsApp Bill Sharing (Section 9.1)
  const [settingsWhatsAppEnabled, setSettingsWhatsAppEnabled] = useState(true);
  const [settingsWhatsAppDefaultLang, setSettingsWhatsAppDefaultLang] = useState<'en' | 'hi' | 'ta'>('en');
  const [settingsWhatsAppIncludeLink, setSettingsWhatsAppIncludeLink] = useState(false);

  // WhatsApp Bill Sharing: Checkout Success Modal State (Section 4)
  const [checkoutSuccess, setCheckoutSuccess] = useState<{
    invoiceId: string;
    number: string;
    customerName?: string;
    customerPhone?: string;
    itemCount: number;
    totalMinor: number;
    paidMinor: number;
    balanceMinor: number;
    shareToken?: string;
    partyId?: string;
  } | null>(null);
  const [successPhone, setSuccessPhone] = useState('');
  const [successLang, setSuccessLang] = useState<'en' | 'hi' | 'ta'>('en');
  const [successSendState, setSuccessSendState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [successPhoneError, setSuccessPhoneError] = useState('');
  const [isSendingWhatsApp, setIsSendingWhatsApp] = useState(false);

  // WhatsApp Bill Sharing: Invoices Table Resend Popover State (Section 5)
  const [resendInvoice, setResendInvoice] = useState<Invoice | null>(null);
  const [resendPhone, setResendPhone] = useState('');
  const [resendLang, setResendLang] = useState<'en' | 'hi' | 'ta'>('en');
  const [resendSaveToCustomer, setResendSaveToCustomer] = useState(false);
  const [resendPhoneError, setResendPhoneError] = useState('');
  const [resendSendState, setResendSendState] = useState<'idle' | 'sending' | 'sent'>('idle');

  // Khata Payment Collection States
  const [duesSummary, setDuesSummary] = useState<DuesSummary | null>(null);

  // Collect Payment Modal State
  const [collectPaymentCustomer, setCollectPaymentCustomer] = useState<Party | null>(null);
  const [collectPreselectedInvoiceId, setCollectPreselectedInvoiceId] = useState<string | null>(null);
  const [collectAmountRupees, setCollectAmountRupees] = useState<string>('');
  const [collectMode, setCollectMode] = useState<'cash' | 'upi' | 'card' | 'bank' | 'cheque'>('cash');
  const [collectReferenceNo, setCollectReferenceNo] = useState<string>('');
  const [collectPaymentDate, setCollectPaymentDate] = useState<string>('');
  const [collectNote, setCollectNote] = useState<string>('');
  const [collectAllocations, setCollectAllocations] = useState<{ [invoiceId: string]: string }>({});
  const [collectKhataData, setCollectKhataData] = useState<KhataOverview | null>(null);
  const [collectLoading, setCollectLoading] = useState<boolean>(false);
  const [collectSaving, setCollectSaving] = useState<boolean>(false);
  const [collectError, setCollectError] = useState<string | null>(null);
  const [collectDiscardConfirm, setCollectDiscardConfirm] = useState<boolean>(false);

  // Receipt Success View Modal State
  const [receiptSuccessPayment, setReceiptSuccessPayment] = useState<Payment | null>(null);
  const [receiptSuccessPhone, setReceiptSuccessPhone] = useState<string>('');
  const [receiptSuccessSavePhone, setReceiptSuccessSavePhone] = useState<boolean>(false);
  const [receiptSuccessLang, setReceiptSuccessLang] = useState<'en' | 'hi' | 'ta'>('en');
  const [receiptSuccessSendState, setReceiptSuccessSendState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [receiptSuccessPhoneError, setReceiptSuccessPhoneError] = useState<string>('');

  // Customer Detail & Ledger View State
  const [ledgerCustomer, setLedgerCustomer] = useState<Party | null>(null);
  const [ledgerData, setLedgerData] = useState<CustomerLedger | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState<boolean>(false);
  const [ledgerFromDate, setLedgerFromDate] = useState<string>('');
  const [ledgerToDate, setLedgerToDate] = useState<string>('');
  const [reversingPayment, setReversingPayment] = useState<Payment | LedgerEvent | null>(null);
  const [reversalReason, setReversalReason] = useState<string>('');
  const [reversalError, setReversalError] = useState<string | null>(null);
  const [reversingLoading, setReversingLoading] = useState<boolean>(false);
  const [reversalWhatsAppNotice, setReversalWhatsAppNotice] = useState<{ receiptNo: string; amountMinor: number; phone?: string } | null>(null);

  // Sales Returns & Credit Notes State (Step 3 Spec)
  const [selectedInvoiceDetailId, setSelectedInvoiceDetailId] = useState<string | null>(null);
  const [invoiceDetailData, setInvoiceDetailData] = useState<any | null>(null);
  const [invoiceDetailLoading, setInvoiceDetailLoading] = useState<boolean>(false);

  const [returnModalInvoiceId, setReturnModalInvoiceId] = useState<string | null>(null);
  const [returnInfo, setReturnInfo] = useState<ReturnInfo | null>(null);
  const [returnInfoLoading, setReturnInfoLoading] = useState<boolean>(false);
  const [returnLinesInput, setReturnLinesInput] = useState<{
    [origLineId: string]: {
      returnQty: string;
      restock: boolean;
      reason: string;
      customReason: string;
    };
  }>({});
  const [returnSettlementType, setReturnSettlementType] = useState<'advance' | 'refund'>('advance');
  const [returnRefundMode, setReturnRefundMode] = useState<'cash' | 'upi' | 'card' | 'bank'>('cash');
  const [returnRefundReference, setReturnRefundReference] = useState<string>('');
  const [returnNote, setReturnNote] = useState<string>('');
  const [returnSaving, setReturnSaving] = useState<boolean>(false);
  const [returnError, setReturnError] = useState<string | null>(null);
  const [returnDiscardConfirm, setReturnDiscardConfirm] = useState<boolean>(false);

  // Credit Note Success Modal
  const [creditNoteSuccess, setCreditNoteSuccess] = useState<{
    creditNoteId: string;
    creditNoteNumber: string;
    originalInvoiceNumber: string;
    totalCreditMinor: number;
    shareToken?: string;
    settlement?: any;
    customerPhone?: string;
    customerName?: string;
  } | null>(null);

  // Void Credit Note Confirmation Modal
  const [voidCreditNoteTarget, setVoidCreditNoteTarget] = useState<{
    id: string;
    number: string;
    totalCreditMinor: number;
    advanceAmountMinor: number;
  } | null>(null);
  const [voidReasonInput, setVoidReasonInput] = useState<string>('');
  const [voidSaving, setVoidSaving] = useState<boolean>(false);
  const [voidError, setVoidError] = useState<string | null>(null);

  // WhatsApp Credit Note Share Modal
  const [creditNoteWhatsAppTarget, setCreditNoteWhatsAppTarget] = useState<{
    id: string;
    number: string;
    originalInvoiceNumber: string;
    phone: string;
    customerName?: string;
    totalCreditMinor: number;
    settlementSummary: string;
    shareToken?: string;
  } | null>(null);
  const [cnWhatsAppLang, setCnWhatsAppLang] = useState<'en' | 'hi' | 'ta'>('en');
  const [cnWhatsAppSendState, setCnWhatsAppSendState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [cnWhatsAppPhone, setCnWhatsAppPhone] = useState<string>('');
  const [cnWhatsAppPhoneError, setCnWhatsAppPhoneError] = useState<string>('');

  // Master Data: Item Form Modal (Add & Edit)
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [itemFormName, setItemFormName] = useState('');
  const [itemFormSku, setItemFormSku] = useState('');
  const [itemFormBarcode, setItemFormBarcode] = useState('');
  const [itemFormHsn, setItemFormHsn] = useState('');
  const [itemFormUnit, setItemFormUnit] = useState('pcs');
  const [itemFormCategory, setItemFormCategory] = useState('');
  const [itemFormPrice, setItemFormPrice] = useState('');
  const [itemFormCost, setItemFormCost] = useState('');
  const [itemFormTax, setItemFormTax] = useState('500');
  const [itemFormTaxInclusive, setItemFormTaxInclusive] = useState(true);
  const [itemFormStock, setItemFormStock] = useState('0');
  const [itemFormReorder, setItemFormReorder] = useState('0');
  const [itemFormMinStock, setItemFormMinStock] = useState('0');
  const [itemFormSupplierId, setItemFormSupplierId] = useState('');

  // Master Data: Party Form Modal (Customers & Suppliers, Add & Edit)
  const [showPartyModal, setShowPartyModal] = useState(false);
  const [partyModalType, setPartyModalType] = useState<'customer' | 'supplier'>('customer');
  const [editingParty, setEditingParty] = useState<Party | null>(null);
  const [partyFormName, setPartyFormName] = useState('');
  const [partyFormPhone, setPartyFormPhone] = useState('');
  const [partyFormEmail, setPartyFormEmail] = useState('');
  const [partyFormGstin, setPartyFormGstin] = useState('');
  const [partyFormAddress, setPartyFormAddress] = useState('');
  const [partyFormCreditLimit, setPartyFormCreditLimit] = useState('');

  // Master Data: Categories Management Modal
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState('');
  const [editingCatDesc, setEditingCatDesc] = useState('');

  // Master Data Search & Filters
  const [itemSearchMaster, setItemSearchMaster] = useState('');
  const [itemCatFilterMaster, setItemCatFilterMaster] = useState('ALL');
  const [customerFilterMaster, setCustomerFilterMaster] = useState('');
  const [supplierFilterMaster, setSupplierFilterMaster] = useState('');

  // Purchases & Stock Inward state
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [purchasesLoading, setPurchasesLoading] = useState(false);
  const [purchaseSearch, setPurchaseSearch] = useState('');
  const [purchaseStatusFilter, setPurchaseStatusFilter] = useState<'ALL' | 'unpaid' | 'partial' | 'paid' | 'voided'>('ALL');
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [selectedPurchaseDetails, setSelectedPurchaseDetails] = useState<Purchase | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [isSubmittingPurchase, setIsSubmittingPurchase] = useState(false);

  // New Purchase Form state
  const [purSupplierId, setPurSupplierId] = useState('');
  const [purSupplierInvoiceNumber, setPurSupplierInvoiceNumber] = useState('');
  const [purSupplierInvoiceDate, setPurSupplierInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [purPurchaseDate, setPurPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [purPaymentMethod, setPurPaymentMethod] = useState<'cash' | 'bank' | 'upi' | 'cheque'>('bank');
  const [purPaymentRef, setPurPaymentRef] = useState('');
  const [purPaidAmount, setPurPaidAmount] = useState('0');
  const [purOtherChargesLabel, setPurOtherChargesLabel] = useState('Transport / Freight');
  const [purOtherChargesRupees, setPurOtherChargesRupees] = useState('0');
  const [purOtherChargesGstBp, setPurOtherChargesGstBp] = useState(0);
  const [purNote, setPurNote] = useState('');
  const [purLines, setPurLines] = useState<Array<{
    itemId: string;
    name: string;
    unit: string;
    receivedQty: number;
    billedQty: number;
    costRupees: number;
    taxRateBp: number;
    discountRupees: number;
    batchNo: string;
    expiry: string;
    trackBatch?: boolean;
    sellingPriceMinor?: number;
  }>>([]);

  // Success Modal (Section 9.2)
  const [purchaseSuccess, setPurchaseSuccess] = useState<{
    purchase: Purchase;
    supplierName: string;
    itemsCount: number;
    unitsCount: number;
    paidMinor: number;
    payableMinor: number;
    paymentMode?: string;
    itcMinor: number;
  } | null>(null);

  // Pay Supplier Modal (Section 7.2)
  const [paySupplierModal, setPaySupplierModal] = useState<{
    supplierId: string;
    supplierName: string;
    supplierPhone?: string;
    totalPayableMinor: number;
    openPurchasesCount: number;
  } | null>(null);
  const [paySupplierAmount, setPaySupplierAmount] = useState('');
  const [paySupplierMode, setPaySupplierMode] = useState<'cash' | 'bank' | 'upi' | 'cheque'>('cash');
  const [paySupplierDate, setPaySupplierDate] = useState(new Date().toISOString().slice(0, 10));
  const [paySupplierRef, setPaySupplierRef] = useState('');
  const [paySupplierNote, setPaySupplierNote] = useState('');
  const [isSubmittingPaySupplier, setIsSubmittingPaySupplier] = useState(false);

  // Supplier Ledger Modal (Section 10.1)
  const [selectedSupplierLedger, setSelectedSupplierLedger] = useState<SupplierLedger | null>(null);
  const [supplierLedgerLoading, setSupplierLedgerLoading] = useState(false);

  // Void Purchase Modal (Section 11.3)
  const [voidPurchaseModal, setVoidPurchaseModal] = useState<Purchase | null>(null);
  const [voidPurchaseReason, setVoidPurchaseReason] = useState('');
  const [isSubmittingVoidPurchase, setIsSubmittingVoidPurchase] = useState(false);

  // Void Payment Modal (Section 11.3)
  const [voidPaymentModal, setVoidPaymentModal] = useState<{ id: string; number: string; amountMinor: number; supplierName: string } | null>(null);
  const [voidPaymentReason, setVoidPaymentReason] = useState('');
  const [isSubmittingVoidPayment, setIsSubmittingVoidPayment] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Fetch available demo businesses (sandbox preview only)
  const loadDemoBusinesses = async () => {
    try {
      const res = await api<{ businesses: DemoBusiness[] }>('/api/auth/demo-businesses');
      setDemoBusinesses(res.businesses || []);
    } catch (err) {
      console.error('Failed to load demo businesses', err);
    }
  };

  // Fetch only the authenticated user's own registered businesses (strictly isolated)
  const loadMyBusinesses = async () => {
    try {
      const res = await api<{ businesses: DemoBusiness[] }>('/api/auth/my-businesses');
      setMyBusinesses(res.businesses || []);
    } catch (err) {
      console.error('Failed to load user businesses', err);
    }
  };

  // Listen for hash changes
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '');
      if (['landing', 'login', 'register', 'selector', 'dashboard'].includes(hash)) {
        setView(hash as any);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Check auth
  useEffect(() => {
    loadDemoBusinesses();
    const initAuth = async () => {
      const token = getToken();
      const currentHash = window.location.hash.replace('#', '');
      if (!token) {
        setLoading(false);
        if (currentHash === 'login' || currentHash === 'register') {
          setView(currentHash);
        } else {
          setView('landing');
        }
        return;
      }
      try {
        const res = await api<{ user: User; shop: Shop }>('/api/auth/me');
        setUser(res.user);
        setShop(res.shop);
        initSettingsForm(res.shop);
        loadMyBusinesses();
        if (currentHash === 'dashboard') {
          setView('dashboard');
        } else if (currentHash === 'selector') {
          setView('selector');
        } else if (currentHash === 'register') {
          setView('register');
        } else if (currentHash === 'login') {
          setView('login');
        } else {
          setView('landing');
        }
      } catch {
        clearToken();
        setView('landing');
      } finally {
        setLoading(false);
      }
    };
    initAuth();
  }, []);

  const initSettingsForm = (s: Shop) => {
    setSettingsName(s.name || '');
    setSettingsType(s.businessType || 'retail');
    setSettingsGstin(s.gstin || '');
    setSettingsPhone(s.phone || '');
    setSettingsAddress(s.address || '');
    setSettingsUpiId(s.upiId || '');
    setSettingsPrefix(s.invoicePrefix || 'INV');
    setSettingsWhatsAppEnabled(s.whatsappEnabled !== false);
    setSettingsWhatsAppDefaultLang(s.whatsappDefaultLang || 'en');
    setSettingsWhatsAppIncludeLink(Boolean(s.whatsappIncludeLink));
  };

  // Fetch data when shop changes
  useEffect(() => {
    if (!user || !shop) return;
    if (!can(user.role as any, 'purchases') && activeTab === 'purchases') {
      setActiveTab('pos');
    }
    loadItems();
    loadCategories();
    loadParties();
    loadInvoices();
    if (can(user.role as any, 'purchases')) {
      loadPurchases();
    }
    loadReports();
    loadDuesSummary();
    checkActiveShift();
    initSettingsForm(shop);
  }, [user, shop?.id, activeTab]);

  const checkActiveShift = async () => {
    try {
      const res = await api<{ ok: boolean; activeShift: any }>('/api/shifts/active');
      setActiveShiftNumber(res.activeShift ? (res.activeShift.shiftNumber || 'ACTIVE') : null);
    } catch {
      setActiveShiftNumber(null);
    }
  };

  const loadItems = async () => {
    try {
      const res = await api<{ items: Item[] }>('/api/items?includeInactive=1');
      setItems(res.items);
      const cats = Array.from(new Set(res.items.map((i) => i.category).filter(Boolean))) as string[];
      if (cats.length > 0) setCategories(cats);
    } catch (err) {
      console.error('Failed to load items', err);
    }
  };

  const loadCategories = async () => {
    try {
      const res = await api<{ categories: Category[] }>('/api/categories?includeInactive=1');
      setCategoriesList(res.categories || []);
      const activeCats = (res.categories || []).filter((c) => c.active).map((c) => c.name);
      if (activeCats.length > 0) {
        setCategories(activeCats);
      }
    } catch (err) {
      console.error('Failed to load categories', err);
    }
  };

  const loadParties = async () => {
    try {
      const res = await api<{ parties: Party[] }>('/api/parties?includeInactive=1');
      setParties(res.parties);
      loadDuesSummary();
    } catch (err) {
      console.error('Failed to load parties', err);
    }
  };

  const loadDuesSummary = async () => {
    try {
      const res = await api<DuesSummary>('/api/parties/dues-summary');
      setDuesSummary(res);
    } catch (err) {
      console.error('Failed to load dues summary', err);
    }
  };

  const loadInvoices = async () => {
    try {
      const res = await api<{ invoices: Invoice[] }>('/api/invoices');
      setInvoices(res.invoices);
    } catch (err) {
      console.error('Failed to load invoices', err);
    }
  };

  const loadPurchases = async () => {
    try {
      setPurchasesLoading(true);
      const res = await api<{ purchases: Purchase[] }>('/api/purchases');
      setPurchases(res.purchases || []);
    } catch (err) {
      console.error('Failed to load purchases', err);
    } finally {
      setPurchasesLoading(false);
    }
  };

  const openNewPurchaseModal = (preselectedSupplierId?: string) => {
    const suppliers = parties.filter((p) => p.type === 'supplier');
    setPurSupplierId(preselectedSupplierId || suppliers[0]?.id || '');
    setPurSupplierInvoiceNumber('');
    setPurSupplierInvoiceDate(new Date().toISOString().slice(0, 10));
    setPurPurchaseDate(new Date().toISOString().slice(0, 10));
    setPurPaymentMethod('bank');
    setPurPaymentRef('');
    setPurPaidAmount('0');
    setPurOtherChargesLabel('Transport / Freight');
    setPurOtherChargesRupees('0');
    setPurOtherChargesGstBp(0);
    setPurNote('');
    if (items.length > 0) {
      const firstItem = items[0];
      setPurLines([{
        itemId: firstItem.id,
        name: firstItem.name,
        unit: firstItem.unit || 'pcs',
        receivedQty: 1,
        billedQty: 1,
        costRupees: (firstItem.costMinor || firstItem.priceMinor || 0) / 100,
        taxRateBp: firstItem.taxRateBp || 0,
        discountRupees: 0,
        batchNo: '',
        expiry: '',
        trackBatch: Boolean((firstItem as any).trackBatch ?? (firstItem as any).track_batch ?? (firstItem as any).hasBatches),
        sellingPriceMinor: firstItem.priceMinor,
      }]);
    } else {
      setPurLines([]);
    }
    setShowPurchaseModal(true);
  };

  const openNewPurchaseModalForSupplier = (supplierId: string) => {
    openNewPurchaseModal(supplierId);
  };

  const handleAddPurLine = () => {
    if (items.length === 0) return;
    const defaultItem = items[0];
    setPurLines((prev) => [
      ...prev,
      {
        itemId: defaultItem.id,
        name: defaultItem.name,
        unit: defaultItem.unit || 'pcs',
        receivedQty: 1,
        billedQty: 1,
        costRupees: (defaultItem.costMinor || defaultItem.priceMinor || 0) / 100,
        taxRateBp: defaultItem.taxRateBp || 0,
        discountRupees: 0,
        batchNo: '',
        expiry: '',
        trackBatch: Boolean((defaultItem as any).trackBatch ?? (defaultItem as any).track_batch ?? (defaultItem as any).hasBatches),
        sellingPriceMinor: defaultItem.priceMinor,
      },
    ]);
  };

  const handleRemovePurLine = (index: number) => {
    setPurLines((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePurLineChange = (index: number, field: string, value: any) => {
    setPurLines((prev) => {
      const copy = [...prev];
      const cur = { ...copy[index] };
      if (field === 'itemId') {
        const it = items.find((x) => x.id === value);
        if (it) {
          cur.itemId = it.id;
          cur.name = it.name;
          cur.unit = it.unit || 'pcs';
          cur.costRupees = (it.costMinor || it.priceMinor || 0) / 100;
          cur.taxRateBp = it.taxRateBp || 0;
          cur.trackBatch = Boolean((it as any).trackBatch ?? (it as any).track_batch ?? (it as any).hasBatches);
          cur.sellingPriceMinor = it.priceMinor;
        }
      } else if (field === 'receivedQty') {
        const num = parseFloat(value) || 0;
        cur.receivedQty = num;
        if (copy[index].billedQty === copy[index].receivedQty || !cur.billedQty) {
          cur.billedQty = num;
        }
      } else {
        (cur as any)[field] = value;
      }
      copy[index] = cur;
      return copy;
    });
  };

  const handleSavePurchase = async () => {
    if (!purSupplierId) {
      alert('Please select a supplier.');
      return;
    }
    if (!purSupplierInvoiceNumber.trim()) {
      alert('Supplier invoice number is required.');
      return;
    }
    if (!purSupplierInvoiceDate) {
      alert('Supplier invoice date is required.');
      return;
    }
    if (purLines.length === 0) {
      alert('Please add at least one line item.');
      return;
    }

    try {
      setIsSubmittingPurchase(true);
      const paidMinor = Math.max(0, Math.round(parseFloat(purPaidAmount || '0') * 100));
      const otherChargesMinor = Math.max(0, Math.round(parseFloat(purOtherChargesRupees || '0') * 100));

      const payload = {
        supplierId: purSupplierId,
        supplierInvoiceNumber: purSupplierInvoiceNumber.trim(),
        supplierInvoiceDate: purSupplierInvoiceDate,
        purchaseDate: purPurchaseDate || purSupplierInvoiceDate,
        paymentMethod: purPaymentMethod,
        paymentReference: purPaymentRef.trim() || undefined,
        paidMinor,
        otherChargesLabel: otherChargesMinor > 0 ? purOtherChargesLabel.trim() : undefined,
        otherChargesMinor,
        otherChargesGstBp: purOtherChargesGstBp,
        note: purNote.trim() || undefined,
        lines: purLines.map((l) => ({
          itemId: l.itemId,
          receivedQtyMilli: Math.max(1, Math.round(l.receivedQty * 1000)),
          billedQtyMilli: Math.max(1, Math.round((l.billedQty || l.receivedQty) * 1000)),
          costMinor: Math.max(0, Math.round(l.costRupees * 100)),
          discountMinor: Math.max(0, Math.round(l.discountRupees * 100)),
          taxRateBp: l.taxRateBp,
          batchNo: l.batchNo?.trim() || undefined,
          expiry: l.expiry?.trim() || undefined,
        })),
      };

      const res = await api<{ purchase: Purchase }>('/api/purchases', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      const sup = parties.find((p) => p.id === purSupplierId);
      const totalUnits = purLines.reduce((sum, l) => sum + l.receivedQty, 0);

      setPurchaseSuccess({
        purchase: res.purchase,
        supplierName: sup?.name || res.purchase.supplierName || 'Supplier',
        itemsCount: purLines.length,
        unitsCount: totalUnits,
        paidMinor: res.purchase.paidMinor,
        payableMinor: res.purchase.balanceMinor,
        paymentMode: res.purchase.paymentMethod,
        itcMinor: res.purchase.itcMinor || 0,
      });

      setShowPurchaseModal(false);
      loadPurchases();
      loadItems();
      loadParties();
    } catch (err: any) {
      alert(err.message || 'Failed to save purchase bill');
    } finally {
      setIsSubmittingPurchase(false);
    }
  };

  const handlePostDraftPurchase = async (purchaseId: string) => {
    try {
      const res = await api<{ purchase: Purchase }>(`/api/purchases/${purchaseId}`);
      showToast(`Purchase #${res.purchase.purchaseNumber || res.purchase.billNo} is active`);
      loadPurchases();
      loadItems();
    } catch (err: any) {
      alert(err.message || 'Failed to check purchase');
    }
  };

  const handleViewPurchaseDetails = async (id: string) => {
    try {
      setDetailsLoading(true);
      const res = await api<{ purchase: Purchase }>(`/api/purchases/${id}`);
      setSelectedPurchaseDetails(res.purchase);
    } catch (err: any) {
      alert(err.message || 'Failed to load purchase details');
    } finally {
      setDetailsLoading(false);
    }
  };

  // Pay Supplier Modal Handlers
  const handleOpenPaySupplier = (supplier: Party) => {
    const totalPayable = supplier.payableMinor || 0;
    setPaySupplierModal({
      supplierId: supplier.id,
      supplierName: supplier.name,
      supplierPhone: supplier.phone,
      totalPayableMinor: totalPayable,
      openPurchasesCount: supplier.openPurchasesCount || 0,
    });
    setPaySupplierAmount((totalPayable / 100).toFixed(2));
    setPaySupplierMode('cash');
    setPaySupplierDate(new Date().toISOString().slice(0, 10));
    setPaySupplierRef('');
    setPaySupplierNote('');
  };

  const handleSubmitPaySupplier = async () => {
    if (!paySupplierModal) return;
    const amtMinor = Math.round(parseFloat(paySupplierAmount || '0') * 100);
    if (amtMinor <= 0) {
      alert('Enter an amount above ₹0');
      return;
    }
    if (amtMinor > paySupplierModal.totalPayableMinor) {
      alert(`Amount cannot exceed the payable of ${formatRupees(paySupplierModal.totalPayableMinor)}. Advances to suppliers are not recorded here yet.`);
      return;
    }

    try {
      setIsSubmittingPaySupplier(true);
      await api('/api/purchases/pay-supplier', {
        method: 'POST',
        body: JSON.stringify({
          supplierId: paySupplierModal.supplierId,
          amountMinor: amtMinor,
          paymentDate: paySupplierDate,
          method: paySupplierMode,
          reference: paySupplierRef.trim() || undefined,
          note: paySupplierNote.trim() || undefined,
        }),
      });

      showToast(`✓ Payment of ${formatRupees(amtMinor)} recorded for ${paySupplierModal.supplierName}`);
      setPaySupplierModal(null);
      loadPurchases();
      loadParties();
      if (selectedSupplierLedger && selectedSupplierLedger.supplier.id === paySupplierModal.supplierId) {
        handleOpenSupplierLedger(paySupplierModal.supplierId);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to record supplier payment');
    } finally {
      setIsSubmittingPaySupplier(false);
    }
  };

  // Supplier Ledger Modal Handlers
  const handleOpenSupplierLedger = async (supplierId: string) => {
    try {
      setSupplierLedgerLoading(true);
      const res = await api<SupplierLedger>(`/api/parties/${supplierId}/supplier-ledger`);
      setSelectedSupplierLedger(res);
    } catch (err: any) {
      alert(err.message || 'Failed to load supplier ledger');
    } finally {
      setSupplierLedgerLoading(false);
    }
  };

  // Void Purchase Handlers
  const handleOpenVoidPurchase = (purchase: Purchase) => {
    setVoidPurchaseModal(purchase);
    setVoidPurchaseReason('');
  };

  const handleSubmitVoidPurchase = async () => {
    if (!voidPurchaseModal) return;
    if (!voidPurchaseReason.trim()) {
      alert('Void reason is mandatory');
      return;
    }

    try {
      setIsSubmittingVoidPurchase(true);
      await api(`/api/purchases/${voidPurchaseModal.id}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason: voidPurchaseReason.trim() }),
      });
      showToast(`✓ Purchase ${voidPurchaseModal.purchaseNumber || voidPurchaseModal.billNo} voided`);
      setVoidPurchaseModal(null);
      if (selectedPurchaseDetails?.id === voidPurchaseModal.id) {
        setSelectedPurchaseDetails(null);
      }
      loadPurchases();
      loadItems();
      loadParties();
    } catch (err: any) {
      alert(err.message || 'Failed to void purchase');
    } finally {
      setIsSubmittingVoidPurchase(false);
    }
  };

  // Void Supplier Payment Handlers
  const handleOpenVoidPayment = (payment: { id: string; number: string; amountMinor: number; supplierName: string }) => {
    setVoidPaymentModal(payment);
    setVoidPaymentReason('');
  };

  const handleSubmitVoidPayment = async () => {
    if (!voidPaymentModal) return;
    if (!voidPaymentReason.trim()) {
      alert('Void reason is mandatory');
      return;
    }

    try {
      setIsSubmittingVoidPayment(true);
      await api(`/api/purchases/payments/${voidPaymentModal.id}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason: voidPaymentReason.trim() }),
      });
      showToast(`✓ Payment ${voidPaymentModal.number} voided`);
      setVoidPaymentModal(null);
      loadPurchases();
      loadParties();
      if (selectedSupplierLedger) {
        handleOpenSupplierLedger(selectedSupplierLedger.supplier.id);
      }
    } catch (err: any) {
      alert(err.message || 'Failed to void payment');
    } finally {
      setIsSubmittingVoidPayment(false);
    }
  };


  const loadReports = async () => {
    try {
      const res = await api<DashboardReport>('/api/reports/dashboard');
      setReport(res);
    } catch (err) {
      console.error('Failed to load reports', err);
    }
  };

  // Business Switcher (strictly within user's own businesses/branches or sandbox demo)
  const handleSwitchBusiness = async (tenantId: string) => {
    try {
      const isDemo = tenantId.startsWith('t_demo_');
      const endpoint = isDemo ? '/api/auth/demo-switch' : '/api/auth/my-business-switch';
      const res = await api<{ token: string; user: User; shop: Shop }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ tenantId }),
      });
      setToken(res.token);
      setUser(res.user);
      setShop(res.shop);
      setCart([]);
      setSelectedCategory('ALL');
      setShowBusinessDropdown(false);
      showToast(`Switched to ${res.shop.name} (${getBusinessLabel(res.shop.businessType)})`);
      loadMyBusinesses();
    } catch (err: any) {
      alert(err.message || 'Failed to switch business');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      const res = await api<{ token: string; user: User; shop: Shop }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setToken(res.token);
      setUser(res.user);
      setShop(res.shop);
      loadMyBusinesses();
    } catch (err: any) {
      setAuthError(err.message || 'Login failed');
    }
  };


  const handleLogout = async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } catch { /* ignore */ }
    clearToken();
    setUser(null);
    setShop(null);
    navigateTo('landing');
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsSavedMsg('');
    try {
      const updated = await api<Shop>('/api/shop', {
        method: 'PUT',
        body: JSON.stringify({
          name: settingsName,
          businessType: settingsType,
          gstin: settingsGstin || null,
          phone: settingsPhone || null,
          address: settingsAddress || null,
          upiId: settingsUpiId || null,
          invoicePrefix: settingsPrefix || 'INV',
          whatsappEnabled: settingsWhatsAppEnabled,
          whatsappDefaultLang: settingsWhatsAppDefaultLang,
          whatsappIncludeLink: settingsWhatsAppIncludeLink,
        }),
      });
      setShop(updated);
      setSettingsSavedMsg('Shop settings updated successfully!');
      loadMyBusinesses();
      showToast('Store settings saved successfully!');
    } catch (err: any) {
      alert(err.message || 'Failed to update settings');
    }
  };

  const handleSwitchPackType = async (type: string) => {
    if (!shop) return;
    try {
      const updated = await api<Shop>('/api/shop', {
        method: 'PUT',
        body: JSON.stringify({
          name: shop.name,
          businessType: type,
          gstin: shop.gstin || null,
          phone: shop.phone || null,
          address: shop.address || null,
          upiId: shop.upiId || null,
          invoicePrefix: shop.invoicePrefix || 'INV',
          language: shop.language || 'en',
          locations: shop.locations || ['MAIN'],
        }),
      });
      setShop(updated);
      setSettingsType(type);
      showToast(`Activated ${getBusinessLabel(type)} mode for ${updated.name}!`);
      loadMyBusinesses();
    } catch (err: any) {
      alert(err.message || 'Failed to update business pack');
    }
  };

  // Cart operations
  const addToCart = (item: Item) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.item.id === item.id);
      if (existing) {
        return prev.map((c) => (c.item.id === item.id ? { ...c, qty: c.qty + 1 } : c));
      }
      return [...prev, { item, qty: 1 }];
    });
  };

  const updateCartQty = (itemId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((c) => (c.item.id === itemId ? { ...c, qty: Math.max(0, c.qty + delta) } : c))
        .filter((c) => c.qty > 0)
    );
  };

  // Cart Totals
  const cartSubtotalMinor = cart.reduce((acc, c) => acc + c.item.priceMinor * c.qty, 0);
  const cartTaxMinor = cart.reduce((acc, c) => {
    const gross = c.item.priceMinor * c.qty;
    const taxable = Math.round((gross * 10000) / (10000 + c.item.taxRateBp));
    return acc + (gross - taxable);
  }, 0);
  const cartTaxableMinor = cartSubtotalMinor - cartTaxMinor;
  const cartCgstMinor = Math.floor(cartTaxMinor / 2);
  const cartSgstMinor = cartTaxMinor - cartCgstMinor;
  const cartTotalMinor = cartSubtotalMinor;
  const discountMinor = Math.round((cartTotalMinor * appliedDiscountPercent) / 100);
  const finalPayableMinor = Math.max(0, cartTotalMinor - discountMinor);

  const handleHoldOrder = () => {
    if (cart.length === 0) {
      if (heldOrders.length > 0) {
        const last = heldOrders[heldOrders.length - 1];
        setCart(last.cart);
        setHeldOrders((prev) => prev.slice(0, prev.length - 1));
        showToast(`Restored held order with ${last.cart.length} item(s)`);
      } else {
        showToast('Cart is empty. Nothing to hold.');
      }
      return;
    }
    setHeldOrders((prev) => [...prev, { id: Date.now().toString(), cart, timestamp: new Date() }]);
    setCart([]);
    showToast('Order held successfully! Click "Hold Order" anytime to restore.');
  };

  const handleCheckout = async (isKot = false) => {
    if (cart.length === 0) return;
    setIsCheckingOut(true);
    try {
      const selectedCustomer = parties.find((p) => p.id === selectedPartyId);
      const lines = cart.map((c) => ({
        itemId: c.item.id,
        name: c.item.name,
        qtyMilli: c.qty * 1000,
        priceMinor: c.item.priceMinor,
        discountMinor: 0,
        taxRateBp: c.item.taxRateBp,
        inclusive: c.item.taxInclusive,
        unit: c.item.unit,
        hsn: c.item.hsn,
      }));

      // Build customer name with contextual business tags
      let custName = selectedCustomer ? selectedCustomer.name : undefined;
      if (shop?.businessType === 'restaurant') {
        custName = `${restaurantTable} (${restaurantOrderType}) ${custName ? '- ' + custName : ''}`;
      } else if (shop?.businessType === 'pharmacy' && doctorName) {
        custName = `${custName || 'Walk-in Patient'} [Prescribed by: ${doctorName}]`;
      } else if (shop?.businessType === 'wholesale' && poNumber) {
        custName = `${custName || 'B2B Buyer'} [PO: ${poNumber}]`;
      } else if (shop?.businessType === 'service' && jobRef) {
        custName = `${custName || 'Client'} [Ref: ${jobRef}]`;
      }

      const res = await api<{
        invoiceId: string;
        number: string;
        totalMinor: number;
        paidMinor: number;
        balanceMinor: number;
        shareToken?: string;
      }>('/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          lines,
          payments: [{ method: selectedPayMode, amountMinor: finalPayableMinor }],
          customerName: custName,
          customerPhone: selectedCustomer ? selectedCustomer.phone : undefined,
          partyId: selectedPartyId || undefined,
        }),
      });

      const itemsInBillCount = cart.reduce((acc, c) => acc + c.qty, 0);
      setCart([]);
      loadInvoices();
      loadReports();
      loadItems(); // refresh stock
      showToast(isKot ? `KOT & Bill Generated: ${res.number}` : `Invoice ${res.number} generated!`);

      // Trigger Checkout Success Modal for final bill (Section 4.1: Restaurant flow triggers after final bill, not KOT)
      if (!isKot) {
        setCheckoutSuccess({
          invoiceId: res.invoiceId,
          number: res.number,
          customerName: custName,
          customerPhone: selectedCustomer ? selectedCustomer.phone : undefined,
          itemCount: itemsInBillCount,
          totalMinor: res.totalMinor,
          paidMinor: res.paidMinor,
          balanceMinor: res.balanceMinor,
          shareToken: res.shareToken,
          partyId: selectedPartyId || undefined,
        });
        setSuccessPhone(selectedCustomer?.phone || '');
        setSuccessLang((shop?.whatsappDefaultLang as any) || 'en');
        setSuccessSendState('idle');
        setSuccessPhoneError('');
      }
    } catch (err: any) {
      alert(err.message || 'Checkout failed');
    } finally {
      setIsCheckingOut(false);
    }
  };

  const handleStartNewBill = () => {
    setCheckoutSuccess(null);
    setCart([]);
    setSelectedPartyId('');
    setCustomerSearch('');
    setAppliedDiscountPercent(0);
  };

  const handleSendWhatsAppFromSuccessModal = async () => {
    if (isSendingWhatsApp || !checkoutSuccess) return;
    const check = validateIndianPhone(successPhone);
    if (!check.valid || !check.normalized) {
      setSuccessPhoneError('Enter a valid 10-digit mobile number');
      return;
    }

    setIsSendingWhatsApp(true);
    try {
      const msg = buildWhatsAppMessage({
        shopName: shop?.name || 'Store',
        number: checkoutSuccess.number,
        totalMinor: checkoutSuccess.totalMinor,
        balanceMinor: checkoutSuccess.balanceMinor,
        shareToken: checkoutSuccess.shareToken,
        lang: successLang,
        includeLink: Boolean(shop?.whatsappIncludeLink),
      });

      const link = whatsappLink(check.normalized, msg);
      window.open(link, '_blank', 'noopener,noreferrer');

      // Asynchronously track (WhatsApp failure must never block billing)
      api(`/api/invoices/${checkoutSuccess.invoiceId}/whatsapp-track`, {
        method: 'POST',
        body: JSON.stringify({
          phone: successPhone,
          language: successLang,
        }),
      }).then(() => {
        loadInvoices();
      }).catch((err) => {
        console.error('WhatsApp track failed', err);
      });

      setSuccessSendState('sent');
    } finally {
      setIsSendingWhatsApp(false);
    }
  };

  const openWhatsAppResend = (inv: Invoice) => {
    setResendInvoice(inv);
    setResendPhone(inv.whatsappLastSentTo || inv.customerPhone || '');
    setResendLang((inv.whatsappLastLanguage as any) || shop?.whatsappDefaultLang || 'en');
    setResendSaveToCustomer(false);
    setResendPhoneError('');
    setResendSendState('idle');
  };

  const handleSendWhatsAppResend = async () => {
    if (isSendingWhatsApp || !resendInvoice) return;
    const check = validateIndianPhone(resendPhone);
    if (!check.valid || !check.normalized) {
      setResendPhoneError('Enter a valid 10-digit mobile number');
      return;
    }

    setIsSendingWhatsApp(true);
    try {
      const msg = buildWhatsAppMessage({
        shopName: shop?.name || 'Store',
        number: resendInvoice.number,
        totalMinor: resendInvoice.totalMinor,
        balanceMinor: resendInvoice.balanceMinor,
        shareToken: resendInvoice.shareToken,
        lang: resendLang,
        includeLink: Boolean(shop?.whatsappIncludeLink),
      });

      const link = whatsappLink(check.normalized, msg);
      window.open(link, '_blank', 'noopener,noreferrer');

      const trackRes = await api<{ success: boolean; sendCount: number; lastSentAt: string }>(
        `/api/invoices/${resendInvoice.id}/whatsapp-track`,
        {
          method: 'POST',
          body: JSON.stringify({
            phone: resendPhone,
            language: resendLang,
            saveToCustomer: resendSaveToCustomer,
          }),
        }
      ).catch((err) => {
        console.error('WhatsApp resend tracking failed', err);
        return null;
      });

      if (trackRes) {
        setInvoices((prev) =>
          prev.map((i) =>
            i.id === resendInvoice.id
              ? {
                  ...i,
                  whatsappSendCount: trackRes.sendCount,
                  whatsappLastSentAt: trackRes.lastSentAt,
                  whatsappLastSentTo: check.normalized!,
                  whatsappLastLanguage: resendLang,
                }
              : i
          )
        );
      }

      setResendSendState('sent');
      showToast(`Bill ${resendInvoice.number} opened in WhatsApp`);
    } finally {
      setIsSendingWhatsApp(false);
    }
  };

  // Master Data: Item Handlers
  const openAddItemModal = () => {
    setEditingItem(null);
    setItemFormName('');
    setItemFormSku('');
    setItemFormBarcode('');
    setItemFormHsn('');
    setItemFormUnit('pcs');
    setItemFormCategory(categoriesList[0]?.name || '');
    setItemFormPrice('');
    setItemFormCost('');
    setItemFormTax('500');
    setItemFormTaxInclusive(true);
    setItemFormStock('50');
    setItemFormReorder('10');
    setItemFormMinStock('5');
    setItemFormSupplierId('');
    setShowItemModal(true);
  };

  const openEditItemModal = (item: Item) => {
    setEditingItem(item);
    setItemFormName(item.name);
    setItemFormSku(item.sku || '');
    setItemFormBarcode(item.barcode || '');
    setItemFormHsn(item.hsn || '');
    setItemFormUnit(item.unit || 'pcs');
    setItemFormCategory(item.category || '');
    setItemFormPrice((item.priceMinor / 100).toFixed(2));
    setItemFormCost(item.costMinor ? (item.costMinor / 100).toFixed(2) : '');
    setItemFormTax(String(item.taxRateBp));
    setItemFormTaxInclusive(item.taxInclusive);
    setItemFormStock(String(item.currentStockMilli / 1000));
    setItemFormReorder(String(((item.reorderMilli ?? item.reorderLevelMilli) || 0) / 1000));
    setItemFormMinStock(String((item.minStockMilli || 0) / 1000));
    setItemFormSupplierId(item.preferredSupplierId || '');
    setShowItemModal(true);
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingItem) {
        await api(`/api/items/${editingItem.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: itemFormName,
            sku: itemFormSku || null,
            barcode: itemFormBarcode || null,
            hsn: itemFormHsn || null,
            unit: itemFormUnit,
            category: itemFormCategory || null,
            priceMinor: Math.round(parseFloat(itemFormPrice) * 100),
            costMinor: itemFormCost ? Math.round(parseFloat(itemFormCost) * 100) : 0,
            taxRateBp: parseInt(itemFormTax, 10),
            taxInclusive: itemFormTaxInclusive,
            reorderLevelMilli: Math.max(Math.round((parseFloat(itemFormReorder) || 0) * 1000), 0),
            minStockMilli: Math.max(Math.round((parseFloat(itemFormMinStock) || 0) * 1000), 0),
            preferredSupplierId: itemFormSupplierId || null,
          }),
        });
        showToast(`Item "${itemFormName}" updated successfully!`);
      } else {
        await api('/api/items', {
          method: 'POST',
          body: JSON.stringify({
            name: itemFormName,
            sku: itemFormSku || null,
            barcode: itemFormBarcode || null,
            hsn: itemFormHsn || null,
            unit: itemFormUnit,
            category: itemFormCategory || null,
            priceMinor: Math.round(parseFloat(itemFormPrice) * 100),
            costMinor: itemFormCost ? Math.round(parseFloat(itemFormCost) * 100) : 0,
            taxRateBp: parseInt(itemFormTax, 10),
            taxInclusive: itemFormTaxInclusive,
            openingStockMilli: Math.max(Math.round((parseFloat(itemFormStock) || 0) * 1000), 0),
            reorderLevelMilli: Math.max(Math.round((parseFloat(itemFormReorder) || 0) * 1000), 0),
            minStockMilli: Math.max(Math.round((parseFloat(itemFormMinStock) || 0) * 1000), 0),
            preferredSupplierId: itemFormSupplierId || null,
          }),
        });
        showToast(`Item "${itemFormName}" added to inventory!`);
      }
      setShowItemModal(false);
      loadItems();
      loadCategories();
    } catch (err: any) {
      alert(err.message || 'Failed to save item');
    }
  };

  const handleToggleItemActive = async (item: Item) => {
    try {
      if (item.active === false) {
        await api(`/api/items/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ active: true }),
        });
        showToast(`Item "${item.name}" reactivated!`);
      } else {
        await api(`/api/items/${item.id}`, {
          method: 'DELETE',
        });
        showToast(`Item "${item.name}" deactivated!`);
      }
      loadItems();
    } catch (err: any) {
      alert(err.message || 'Failed to change item status');
    }
  };

  // Master Data: Party Handlers (Customer & Supplier)
  const openAddPartyModal = (type: 'customer' | 'supplier') => {
    setEditingParty(null);
    setPartyModalType(type);
    setPartyFormName('');
    setPartyFormPhone('');
    setPartyFormEmail('');
    setPartyFormGstin('');
    setPartyFormAddress('');
    setPartyFormCreditLimit('');
    setShowPartyModal(true);
  };

  const openEditPartyModal = (party: Party) => {
    setEditingParty(party);
    setPartyModalType(party.type);
    setPartyFormName(party.name);
    setPartyFormPhone(party.phone || '');
    setPartyFormEmail(party.email || '');
    setPartyFormGstin(party.gstin || '');
    setPartyFormAddress(party.address || '');
    setPartyFormCreditLimit(party.creditLimitMinor ? String(party.creditLimitMinor / 100) : '');
    setShowPartyModal(true);
  };

  const handleSaveParty = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload: any = {
        name: partyFormName,
        type: partyModalType,
        phone: partyFormPhone || null,
        email: partyFormEmail || null,
        gstin: partyFormGstin ? partyFormGstin.trim().toUpperCase() : null,
        address: partyFormAddress || null,
        creditLimitMinor: partyFormCreditLimit ? Math.round(parseFloat(partyFormCreditLimit) * 100) : 0,
      };

      if (editingParty) {
        await api(`/api/parties/${editingParty.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        showToast(`${partyModalType === 'supplier' ? 'Supplier' : 'Customer'} "${partyFormName}" updated!`);
      } else {
        await api('/api/parties', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast(`${partyModalType === 'supplier' ? 'Supplier' : 'Customer'} "${partyFormName}" created!`);
      }
      setShowPartyModal(false);
      loadParties();
    } catch (err: any) {
      alert(err.message || 'Failed to save party');
    }
  };

  const handleTogglePartyActive = async (party: Party) => {
    try {
      if (party.active === false) {
        await api(`/api/parties/${party.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ active: true }),
        });
        showToast(`${party.type === 'supplier' ? 'Supplier' : 'Customer'} "${party.name}" reactivated!`);
      } else {
        await api(`/api/parties/${party.id}`, {
          method: 'DELETE',
        });
        showToast(`${party.type === 'supplier' ? 'Supplier' : 'Customer'} "${party.name}" deactivated!`);
      }
      loadParties();
    } catch (err: any) {
      alert(err.message || 'Failed to change party status');
    }
  };

  // =========================================================================
  // KHATA PAYMENT COLLECTION HANDLERS
  // =========================================================================

  const openCollectPayment = async (customer: Party, preselectedInvoiceId?: string) => {
    setCollectPaymentCustomer(customer);
    setCollectPreselectedInvoiceId(preselectedInvoiceId || null);
    setCollectMode('cash');
    setCollectReferenceNo('');
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    setCollectPaymentDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`);
    setCollectNote('');
    setCollectError(null);
    setCollectDiscardConfirm(false);
    setCollectLoading(true);

    try {
      const khata = await api<KhataOverview>(`/api/parties/${customer.id}/khata`);
      setCollectKhataData(khata);

      // Pre-fill amount to full dues (Section 5: Amount received pre-filled to full dues)
      const duesRupees = (khata.totalDuesMinor / 100).toFixed(2);
      const initAmount = khata.totalDuesMinor > 0 ? duesRupees : '';
      setCollectAmountRupees(initAmount);

      // Default oldest-first allocation (preselected invoice first if specified)
      const initialAllocs: { [id: string]: string } = {};
      let remaining = khata.totalDuesMinor;

      let sorted = [...khata.unpaidInvoices];
      if (preselectedInvoiceId) {
        sorted.sort((a, b) => (a.id === preselectedInvoiceId ? -1 : b.id === preselectedInvoiceId ? 1 : 0));
      }

      for (const inv of sorted) {
        if (remaining <= 0) {
          initialAllocs[inv.id] = '0.00';
          continue;
        }
        const toAlloc = Math.min(remaining, inv.balanceMinor);
        initialAllocs[inv.id] = (toAlloc / 100).toFixed(2);
        remaining -= toAlloc;
      }
      setCollectAllocations(initialAllocs);
    } catch (err: any) {
      setCollectError(err.message || 'Failed to load customer dues');
    } finally {
      setCollectLoading(false);
    }
  };

  const handleCollectAmountChange = (newAmtStr: string) => {
    setCollectAmountRupees(newAmtStr);
    if (!collectKhataData) return;

    const parsed = parseFloat(newAmtStr);
    const enteredMinor = Math.round((isNaN(parsed) ? 0 : Math.max(0, parsed)) * 100);

    let remaining = enteredMinor;
    const newAllocs: { [id: string]: string } = {};

    let sorted = [...collectKhataData.unpaidInvoices];
    if (collectPreselectedInvoiceId) {
      sorted.sort((a, b) => (a.id === collectPreselectedInvoiceId ? -1 : b.id === collectPreselectedInvoiceId ? 1 : 0));
    }

    for (const inv of sorted) {
      if (remaining <= 0) {
        newAllocs[inv.id] = '0.00';
        continue;
      }
      const toAlloc = Math.min(remaining, inv.balanceMinor);
      newAllocs[inv.id] = (toAlloc / 100).toFixed(2);
      remaining -= toAlloc;
    }
    setCollectAllocations(newAllocs);
  };

  const handleRowAllocChange = (invId: string, valStr: string) => {
    setCollectAllocations((prev) => ({
      ...prev,
      [invId]: valStr,
    }));
  };

  const handleCloseCollectModal = () => {
    const amt = parseFloat(collectAmountRupees);
    if (amt > 0 && !collectDiscardConfirm) {
      setCollectDiscardConfirm(true);
      return;
    }
    setCollectPaymentCustomer(null);
    setCollectKhataData(null);
    setCollectDiscardConfirm(false);
  };

  const handleSavePayment = async (andAddAnother: boolean = false) => {
    if (!collectPaymentCustomer || collectSaving) return;

    const amt = parseFloat(collectAmountRupees);
    if (!amt || isNaN(amt) || amt <= 0) {
      setCollectError('Enter an amount greater than zero.');
      return;
    }

    if (collectPaymentDate) {
      const d = new Date(collectPaymentDate);
      if (d.getTime() > Date.now() + 120000) {
        setCollectError('Payment date cannot be in the future.');
        return;
      }
      const todayKolkata = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const payDateKolkata = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      if (payDateKolkata < todayKolkata && user?.role === 'cashier') {
        setCollectError('Cashiers cannot record backdated payments. Only Owner, Manager or Accountant can.');
        return;
      }
    }

    setCollectSaving(true);
    setCollectError(null);

    const idempotencyKey = 'idemp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    const allocationsPayload = Object.entries(collectAllocations)
      .map(([invoiceId, strVal]) => ({
        invoiceId,
        amountMinor: Math.round(Math.max(0, parseFloat(strVal) || 0) * 100),
      }))
      .filter((a) => a.amountMinor > 0);

    try {
      const res = await api<{ payment: Payment; infoMessage?: string }>('/api/payments', {
        method: 'POST',
        body: JSON.stringify({
          customerId: collectPaymentCustomer.id,
          amountMinor: Math.round(amt * 100),
          mode: collectMode,
          referenceNo: collectReferenceNo.trim() || undefined,
          paymentDate: collectPaymentDate ? new Date(collectPaymentDate).toISOString() : undefined,
          note: collectNote.trim() || undefined,
          allocations: allocationsPayload,
          idempotencyKey,
        }),
      });

      showToast(`Payment ${res.payment.receiptNumber} recorded!`);
      loadParties();
      loadInvoices();
      loadDuesSummary();
      loadReports();

      const cust = collectPaymentCustomer;
      setCollectPaymentCustomer(null);
      setCollectKhataData(null);

      if (andAddAnother) {
        openCollectPayment(cust);
      } else {
        openReceiptSuccess(res.payment);
      }
    } catch (err: any) {
      setCollectError(err.message || 'Failed to save payment');
    } finally {
      setCollectSaving(false);
    }
  };

  const openReceiptSuccess = (payment: Payment) => {
    setReceiptSuccessPayment(payment);
    setReceiptSuccessPhone(payment.customerPhone || '');
    setReceiptSuccessSavePhone(false);
    setReceiptSuccessLang((shop?.whatsappDefaultLang as any) || 'en');
    setReceiptSuccessSendState('idle');
    setReceiptSuccessPhoneError('');
  };

  const handleSendReceiptWhatsApp = async (overrideLang?: 'en' | 'hi' | 'ta') => {
    if (!receiptSuccessPayment) return;
    const lang = overrideLang || receiptSuccessLang;
    const rawPhone = receiptSuccessPhone.trim() || receiptSuccessPayment.customerPhone || '';
    const cleaned = normalizePhone(rawPhone);
    if (!cleaned) {
      setReceiptSuccessPhoneError('Please enter a valid 10-digit mobile number');
      return;
    }
    setReceiptSuccessPhoneError('');
    setReceiptSuccessSendState('sending');

    const receiptLink = (shop?.whatsappIncludeLink !== false && receiptSuccessPayment.shareToken)
      ? `${window.location.origin}/r/${receiptSuccessPayment.shareToken}`
      : undefined;

    const msg = receiptMessage({
      shopName: shop?.name || 'Shop',
      receiptNo: receiptSuccessPayment.receiptNumber,
      amountMinor: receiptSuccessPayment.amountMinor,
      mode: receiptSuccessPayment.mode,
      settledInvoices: receiptSuccessPayment.allocations.map((a) => a.invoiceNumber),
      balanceMinor: receiptSuccessPayment.balanceAfterMinor ?? 0,
      advanceMinor: receiptSuccessPayment.advanceMinor > 0 ? receiptSuccessPayment.advanceMinor : undefined,
      url: receiptLink,
      lang,
    });

    const link = whatsappLink(cleaned, msg);
    window.open(link, '_blank');
    setReceiptSuccessSendState('sent');

    try {
      await api(`/api/payments/${receiptSuccessPayment.id}/whatsapp-track`, {
        method: 'POST',
        body: JSON.stringify({
          language: lang,
          phone: cleaned,
          saveToCustomerMaster: receiptSuccessSavePhone,
        }),
      });
      loadParties();
    } catch (err) {
      console.error('Failed to track receipt send', err);
    }
  };

  const openCustomerLedger = async (customer: Party) => {
    setLedgerCustomer(customer);
    setLedgerLoading(true);
    setLedgerFromDate('');
    setLedgerToDate('');
    setReversingPayment(null);
    setReversalReason('');
    setReversalError(null);
    setReversalWhatsAppNotice(null);
    try {
      const res = await api<CustomerLedger>(`/api/parties/${customer.id}/ledger`);
      setLedgerData(res);
    } catch (err: any) {
      alert(err.message || 'Failed to load customer ledger');
    } finally {
      setLedgerLoading(false);
    }
  };

  const handleFilterLedger = async () => {
    if (!ledgerCustomer) return;
    setLedgerLoading(true);
    try {
      const params = new URLSearchParams();
      if (ledgerFromDate) params.append('from', ledgerFromDate);
      if (ledgerToDate) params.append('to', ledgerToDate);
      const res = await api<CustomerLedger>(`/api/parties/${ledgerCustomer.id}/ledger?${params.toString()}`);
      setLedgerData(res);
    } catch (err: any) {
      alert(err.message || 'Failed to filter ledger');
    } finally {
      setLedgerLoading(false);
    }
  };

  const handleConfirmReversal = async () => {
    if (!reversingPayment || reversingLoading) return;
    if (!reversalReason.trim() || reversalReason.trim().length < 3) {
      setReversalError('Please provide a mandatory reversal reason (min 3 characters).');
      return;
    }

    setReversingLoading(true);
    setReversalError(null);

    try {
      await api<{ ok: boolean; payment: any }>(`/api/payments/${reversingPayment.id}/reverse`, {
        method: 'POST',
        body: JSON.stringify({ reason: reversalReason.trim() }),
      });

      const rDocNo = 'receiptNumber' in reversingPayment ? (reversingPayment as any).receiptNumber : reversingPayment.number;
      showToast(`Payment ${rDocNo} reversed!`);

      // Check if this payment was previously shared on WhatsApp
      if ((reversingPayment as any).whatsappSendCount > 0) {
        setReversalWhatsAppNotice({
          receiptNo: rDocNo,
          amountMinor: reversingPayment.amountMinor,
          phone: ledgerCustomer?.phone || undefined,
        });
      }

      setReversingPayment(null);
      setReversalReason('');

      // Refresh data
      loadParties();
      loadInvoices();
      loadDuesSummary();
      loadReports();
      if (ledgerCustomer) {
        handleFilterLedger();
      }
    } catch (err: any) {
      setReversalError(err.message || 'Failed to reverse payment');
    } finally {
      setReversingLoading(false);
    }
  };

  const handleSendCorrectionWhatsApp = (receiptNo: string, amountMinor: number, phone?: string) => {
    const raw = phone || ledgerCustomer?.phone || '';
    const cleaned = normalizePhone(raw);
    if (!cleaned) {
      alert('Customer does not have a valid mobile number');
      return;
    }
    const msg = receiptCorrectionMessage({
      shopName: shop?.name || 'Shop',
      receiptNo,
      amountMinor,
      lang: (shop?.whatsappDefaultLang as any) || 'en',
    });
    const link = whatsappLink(cleaned, msg);
    window.open(link, '_blank');
    setReversalWhatsAppNotice(null);
  };

  // ==========================================
  // Sales Returns & Credit Notes Handlers (Step 3 Spec)
  // ==========================================
  const openInvoiceDetail = async (invoiceId: string) => {
    setSelectedInvoiceDetailId(invoiceId);
    setInvoiceDetailLoading(true);
    try {
      const res = await api(`/api/invoices/${invoiceId}`);
      setInvoiceDetailData(res);
    } catch (err: any) {
      alert(err.message || 'Failed to load invoice details');
    } finally {
      setInvoiceDetailLoading(false);
    }
  };

  const openReturnModal = async (invoiceId: string) => {
    setReturnModalInvoiceId(invoiceId);
    setReturnInfoLoading(true);
    setReturnError(null);
    setReturnDiscardConfirm(false);
    try {
      const res = await api<ReturnInfo>(`/api/invoices/${invoiceId}/return-info`);
      setReturnInfo(res);

      const initialInput: {
        [origLineId: string]: {
          returnQty: string;
          restock: boolean;
          reason: string;
          customReason: string;
        };
      } = {};
      for (const l of res.lines) {
        initialInput[l.id] = {
          returnQty: '',
          restock: true,
          reason: '',
          customReason: '',
        };
      }
      setReturnLinesInput(initialInput);
      setReturnSettlementType(!res.customer ? 'refund' : 'advance');
      setReturnRefundMode('cash');
      setReturnRefundReference('');
      setReturnNote('');
    } catch (err: any) {
      alert(err.message || 'Failed to load return information');
      setReturnModalInvoiceId(null);
    } finally {
      setReturnInfoLoading(false);
    }
  };

  const handleReturnAll = () => {
    if (!returnInfo) return;
    setReturnLinesInput((prev) => {
      const next = { ...prev };
      for (const l of returnInfo.lines) {
        const qty = l.returnableQtyMilli / 1000;
        next[l.id] = {
          ...(next[l.id] || { restock: true, reason: '', customReason: '' }),
          returnQty: qty > 0 ? qty.toString() : '0',
        };
      }
      return next;
    });
  };

  const handleClearReturn = () => {
    if (!returnInfo) return;
    setReturnLinesInput((prev) => {
      const next = { ...prev };
      for (const l of returnInfo.lines) {
        next[l.id] = {
          ...(next[l.id] || { restock: true, reason: '', customReason: '' }),
          returnQty: '0',
        };
      }
      return next;
    });
  };

  const calculateReturnPreview = () => {
    if (!returnInfo) return null;
    const preparedLines: ReturnLineInput[] = [];

    let hasAnyReturn = false;
    for (const l of returnInfo.lines) {
      const inp = returnLinesInput[l.id];
      const returnQty = parseFloat(inp?.returnQty || '0');
      const returnQtyMilli = Math.round(returnQty * 1000);
      if (returnQtyMilli > 0) {
        hasAnyReturn = true;
        preparedLines.push({
          origLineId: l.id,
          itemId: l.itemId,
          name: l.name,
          hsn: l.hsn,
          unit: l.unit,
          billedQtyMilli: l.billedQtyMilli,
          alreadyReturnedQtyMilli: l.alreadyReturnedQtyMilli,
          returnQtyMilli,
          priceMinor: l.priceMinor,
          taxRateBp: l.taxRateBp,
          inclusive: l.inclusive,
          origTaxableMinor: l.origTaxableMinor,
          origCgstMinor: l.origCgstMinor,
          origSgstMinor: l.origSgstMinor,
          origIgstMinor: l.origIgstMinor,
          origTotalMinor: l.origTotalMinor,
          restock: inp?.restock ?? true,
          reason: inp?.reason === 'Other' && inp?.customReason ? `Other: ${inp.customReason.trim()}` : (inp?.reason || ''),
        });
      }
    }

    if (!hasAnyReturn) return null;

    try {
      const calculated = calcReturn(preparedLines, {
        isIntraState: returnInfo.invoice.intra,
      });

      const otherBills = returnInfo.otherUnpaidInvoices.map((oi) => ({
        id: oi.id,
        number: oi.number,
        balanceMinor: oi.balanceMinor,
      }));

      const isRegistered = Boolean(returnInfo.customer);
      const effectiveChoice = !isRegistered ? 'refund' : returnSettlementType;

      const settlement = planSettlement(
        calculated.totalCreditMinor,
        {
          id: returnInfo.invoice.id,
          number: returnInfo.invoice.number,
          balanceMinor: returnInfo.invoice.balanceMinor,
        },
        otherBills,
        isRegistered,
        effectiveChoice,
        effectiveChoice === 'refund' ? { mode: returnRefundMode, reference: returnRefundReference } : undefined,
      );

      return { calculated, settlement };
    } catch {
      return null;
    }
  };

  const handleCloseReturnModal = () => {
    if (!returnInfo) {
      setReturnModalInvoiceId(null);
      return;
    }
    const hasEnteredQty = Object.values(returnLinesInput).some((inp) => parseFloat(inp.returnQty || '0') > 0);
    if (hasEnteredQty && !returnDiscardConfirm) {
      setReturnDiscardConfirm(true);
      return;
    }
    setReturnDiscardConfirm(false);
    setReturnModalInvoiceId(null);
    setReturnInfo(null);
  };

  const handleSaveReturn = async () => {
    if (!returnInfo || returnSaving) return;
    setReturnError(null);

    const linesPayload: {
      origLineId: string;
      returnQtyMilli: number;
      restock: boolean;
      reason: string;
      customReason?: string;
    }[] = [];

    for (const l of returnInfo.lines) {
      const inp = returnLinesInput[l.id];
      const returnQty = parseFloat(inp?.returnQty || '0');
      const returnQtyMilli = Math.round(returnQty * 1000);
      if (returnQtyMilli > 0) {
        if (!inp?.reason || !inp.reason.trim()) {
          setReturnError(`Please select a reason for returned item: ${l.name}`);
          return;
        }
        if (inp.reason === 'Other' && (!inp.customReason || !inp.customReason.trim())) {
          setReturnError(`Please specify a custom reason for: ${l.name}`);
          return;
        }
        if (returnQtyMilli > l.returnableQtyMilli) {
          setReturnError(`Return quantity for ${l.name} cannot exceed returnable amount.`);
          return;
        }

        linesPayload.push({
          origLineId: l.id,
          returnQtyMilli,
          restock: inp?.restock ?? true,
          reason: inp.reason,
          customReason: inp.customReason?.trim() || undefined,
        });
      }
    }

    if (linesPayload.length === 0) {
      setReturnError('Please enter a return quantity greater than 0 for at least one item.');
      return;
    }

    const preview = calculateReturnPreview();
    if (!preview) {
      setReturnError('Unable to calculate credit note totals. Please check input values.');
      return;
    }

    if (preview.settlement.refundAmountMinor > 0 && !returnRefundMode) {
      setReturnError('Please select a payment mode for the refund (Cash, UPI, Card, Bank).');
      return;
    }

    setReturnSaving(true);
    const idempotencyKey = `ret_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    try {
      const res = await api<{
        success: boolean;
        creditNoteId: string;
        creditNoteNumber: string;
        totalCreditMinor: number;
        shareToken: string;
        settlement: any;
      }>(`/api/invoices/${returnInfo.invoice.id}/returns`, {
        method: 'POST',
        body: JSON.stringify({
          lines: linesPayload,
          settlementType: returnSettlementType,
          refundMode: returnRefundMode,
          refundReference: returnRefundReference.trim() || undefined,
          note: returnNote.trim() || undefined,
          idempotencyKey,
        }),
      });

      showToast(`Credit Note ${res.creditNoteNumber} issued!`);
      loadInvoices();
      loadParties();
      loadDuesSummary();
      loadReports();

      // If invoice detail modal is currently open, refresh it
      if (selectedInvoiceDetailId) {
        openInvoiceDetail(selectedInvoiceDetailId);
      }

      const origInvNum = returnInfo.invoice.number;
      const custPhone = returnInfo.customer?.phone || returnInfo.invoice.customerPhone;
      const custName = returnInfo.customer?.name || returnInfo.invoice.customerName;

      setReturnModalInvoiceId(null);
      setReturnInfo(null);

      // Open Success Modal
      setCreditNoteSuccess({
        creditNoteId: res.creditNoteId,
        creditNoteNumber: res.creditNoteNumber,
        originalInvoiceNumber: origInvNum,
        totalCreditMinor: res.totalCreditMinor,
        shareToken: res.shareToken,
        settlement: res.settlement,
        customerPhone: custPhone,
        customerName: custName,
      });
    } catch (err: any) {
      setReturnError(err.message || 'Failed to issue credit note');
    } finally {
      setReturnSaving(false);
    }
  };

  const handleOpenVoidModal = (target: {
    id: string;
    number: string;
    totalCreditMinor: number;
    advanceAmountMinor: number;
  }) => {
    // Only Owner or Manager
    if (user?.role !== 'owner' && user?.role !== 'manager') {
      alert('Only Owner or Manager can void a credit note.');
      return;
    }
    setVoidCreditNoteTarget(target);
    setVoidReasonInput('');
    setVoidError(null);
  };

  const handleConfirmVoid = async () => {
    if (!voidCreditNoteTarget || voidSaving) return;
    if (!voidReasonInput.trim()) {
      setVoidError('Please provide a mandatory void reason.');
      return;
    }

    setVoidSaving(true);
    setVoidError(null);
    try {
      await api(`/api/credit-notes/${voidCreditNoteTarget.id}/void`, {
        method: 'POST',
        body: JSON.stringify({ reason: voidReasonInput.trim() }),
      });

      showToast(`Credit Note ${voidCreditNoteTarget.number} voided!`);
      setVoidCreditNoteTarget(null);
      setVoidReasonInput('');

      loadInvoices();
      loadParties();
      loadDuesSummary();
      loadReports();

      if (selectedInvoiceDetailId) {
        openInvoiceDetail(selectedInvoiceDetailId);
      }
    } catch (err: any) {
      setVoidError(err.message || 'Failed to void credit note');
    } finally {
      setVoidSaving(false);
    }
  };

  const handleOpenCreditNoteWhatsApp = (target: {
    id: string;
    number: string;
    originalInvoiceNumber: string;
    phone: string;
    customerName?: string;
    totalCreditMinor: number;
    settlementSummary: string;
    shareToken?: string;
  }) => {
    setCreditNoteWhatsAppTarget(target);
    setCnWhatsAppPhone(target.phone || '');
    setCnWhatsAppLang((shop?.whatsappDefaultLang as any) || 'en');
    setCnWhatsAppSendState('idle');
    setCnWhatsAppPhoneError('');
  };

  const handleSendCreditNoteWhatsApp = async () => {
    if (!creditNoteWhatsAppTarget) return;
    const phoneValid = validateIndianPhone(cnWhatsAppPhone);
    if (!phoneValid.valid || !phoneValid.normalized) {
      setCnWhatsAppPhoneError('Please enter a valid 10-digit Indian mobile number');
      return;
    }

    setCnWhatsAppSendState('sending');
    setCnWhatsAppPhoneError('');

    try {
      const publicLink =
        shop?.whatsappIncludeLink && creditNoteWhatsAppTarget.shareToken
          ? `${window.location.origin}/c/${creditNoteWhatsAppTarget.shareToken}`
          : undefined;

      const msg = creditNoteMessage({
        shopName: shop?.name || 'Our Shop',
        customerName: creditNoteWhatsAppTarget.customerName,
        creditNoteNo: creditNoteWhatsAppTarget.number,
        originalBillNo: creditNoteWhatsAppTarget.originalInvoiceNumber,
        totalCreditMinor: creditNoteWhatsAppTarget.totalCreditMinor,
        settlementLine: creditNoteWhatsAppTarget.settlementSummary,
        publicLink,
        lang: cnWhatsAppLang,
      });

      await api(`/api/credit-notes/${creditNoteWhatsAppTarget.id}/whatsapp-track`, {
        method: 'POST',
        body: JSON.stringify({
          phone: phoneValid.normalized,
          language: cnWhatsAppLang,
          saveToCustomer: true,
        }),
      });

      const url = whatsappLink(phoneValid.normalized, msg);
      window.open(url, '_blank');
      setCnWhatsAppSendState('sent');
      showToast('Credit Note WhatsApp message ready!');
    } catch (err: any) {
      setCnWhatsAppPhoneError(err.message || 'Failed to send WhatsApp message');
      setCnWhatsAppSendState('idle');
    }
  };

  // Master Data: Categories Handlers
  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCatName.trim()) return;
    try {
      await api('/api/categories', {
        method: 'POST',
        body: JSON.stringify({
          name: newCatName.trim(),
          description: newCatDesc.trim() || undefined,
        }),
      });
      setNewCatName('');
      setNewCatDesc('');
      loadCategories();
      showToast('Category created!');
    } catch (err: any) {
      alert(err.message || 'Failed to create category');
    }
  };

  const handleUpdateCategory = async (id: string) => {
    if (!editingCatName.trim()) return;
    try {
      await api(`/api/categories/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: editingCatName.trim(),
          description: editingCatDesc.trim() || null,
        }),
      });
      setEditingCatId(null);
      loadCategories();
      loadItems();
      showToast('Category updated!');
    } catch (err: any) {
      alert(err.message || 'Failed to update category');
    }
  };

  const handleToggleCategoryActive = async (cat: Category) => {
    try {
      if (!cat.active) {
        await api(`/api/categories/${cat.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ active: true }),
        });
        showToast(`Category "${cat.name}" reactivated!`);
      } else {
        await api(`/api/categories/${cat.id}`, {
          method: 'DELETE',
        });
        showToast(`Category "${cat.name}" deactivated!`);
      }
      loadCategories();
    } catch (err: any) {
      alert(err.message || 'Failed to update category status');
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#94a3b8', fontSize: '1.1rem' }}>Loading Adaptive Billing...</p>
      </div>
    );
  }

  // View rendering based on active view state
  // Screen 1: Public Landing Page (available whether user is logged in or out)
  if (view === 'landing') {
    return (
      <LandingPage
        user={user}
        onNavigateDashboard={() => navigateTo('dashboard')}
        onLogout={handleLogout}
        onNavigateLogin={() => navigateTo('login')}
        onNavigateRegister={(businessType) => {
          if (businessType) setRegSelectedBusinessType(businessType);
          navigateTo('register');
        }}
      />
    );
  }

  // Screen 7: Login Page
  if (view === 'login') {
    return (
      <LoginPage
        onSuccess={(data) => {
          setUser(data.user);
          setShop(data.shop);
          loadDemoBusinesses();
          navigateTo('dashboard');
          showToast(`Welcome back, ${data.user.name}!`);
        }}
        onNavigateRegister={() => {
          navigateTo('register');
        }}
        onBackToHome={() => {
          navigateTo('landing');
        }}
      />
    );
  }

  // Screens 2-6: Dynamic Registration Wizard
  if (view === 'register') {
    return (
      <RegisterWizard
        initialBusinessType={regSelectedBusinessType}
        onSuccess={(data) => {
          setUser(data.user);
          setShop(data.shop);
          loadMyBusinesses();
          navigateTo('dashboard');
          showToast(`Business ${data.shop.name} registered successfully!`);
        }}
        onBackToHome={() => {
          navigateTo('landing');
        }}
        onNavigateLogin={() => {
          navigateTo('login');
        }}
      />
    );
  }

  // Screen 8: Single-business view (strictly isolated to customer's paid store)
  if (view === 'selector') {
    if (!user) {
      navigateTo('login');
      return null;
    }
    const userBusinesses = myBusinesses.length > 0 ? myBusinesses : (shop ? [shop as any] : []);
    return (
      <BusinessSelector
        user={user}
        currentShop={shop}
        businesses={userBusinesses}
        onSelectBusiness={(tenantId) => {
          handleSwitchBusiness(tenantId);
          navigateTo('dashboard');
        }}
        onLogout={handleLogout}
        onBackToDashboard={() => navigateTo('dashboard')}
      />
    );
  }

  // If user is not logged in and not on another screen, fallback to Landing Page
  if (!user) {
    return (
      <LandingPage
        user={user}
        onNavigateDashboard={() => navigateTo('dashboard')}
        onLogout={handleLogout}
        onNavigateLogin={() => navigateTo('login')}
        onNavigateRegister={(businessType) => {
          if (businessType) setRegSelectedBusinessType(businessType);
          navigateTo('register');
        }}
      />
    );
  }

  // Filter items matching search & quick categories
  const filteredItems = items.filter((item) => {
    const matchesCat =
      selectedCategory === 'ALL' ||
      item.category === selectedCategory ||
      (selectedCategory === 'Groceries' && /grocery|flour|grain|oil|sugar|salt|pulse/i.test(item.category || item.name)) ||
      (selectedCategory === 'Fresh Produce' && /produce|fruit|veg|fresh/i.test(item.category || item.name)) ||
      (selectedCategory === 'Beverages' && /beverage|tea|coffee|drink|juice/i.test(item.category || item.name)) ||
      (selectedCategory === 'Snacks' && /snack|biscuit|bakery|sweet|chip/i.test(item.category || item.name)) ||
      (selectedCategory === 'Household' && /household|clean|detergent|wash/i.test(item.category || item.name)) ||
      (selectedCategory === 'Personal Care' && /personal|soap|paste|cream|care/i.test(item.category || item.name)) ||
      (selectedCategory === 'Dairy' && /dairy|milk|butter|cheese|paneer|ghee/i.test(item.category || item.name)) ||
      (selectedCategory === 'Others' && !/grocery|flour|grain|oil|sugar|salt|pulse|produce|fruit|veg|fresh|beverage|tea|coffee|snack|biscuit|bakery|household|personal|dairy/i.test(item.category || item.name));

    const matchesSearch =
      !searchQuery ||
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (item.barcode && item.barcode.includes(searchQuery)) ||
      (item.sku && item.sku.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (item.hsn && item.hsn.includes(searchQuery)) ||
      (item.category && item.category.toLowerCase().includes(searchQuery.toLowerCase()));

    return matchesCat && matchesSearch;
  });

  // Low stock & out of stock calculation for live alerts
  const outOfStockItems = items.filter((i) => i.active !== false && (i.currentStockMilli ?? 0) <= 0);
  const lowStockItems = items.filter(
    (i) =>
      i.active !== false &&
      (i.currentStockMilli ?? 0) > 0 &&
      ((((i.reorderMilli ?? i.reorderLevelMilli) || 0) > 0 &&
        (i.currentStockMilli ?? 0) <= ((i.reorderMilli ?? i.reorderLevelMilli) || 0)) ||
        ((i.minStockMilli || 0) > 0 && (i.currentStockMilli ?? 0) <= (i.minStockMilli || 0))),
  );
  const totalStockAlerts = outOfStockItems.length + lowStockItems.length;

  const selectedParty = parties.find((p) => p.id === selectedPartyId);

  const filteredParties = parties.filter((p) => {
    if (!customerSearch) return true;
    const q = customerSearch.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.phone && p.phone.includes(q)) ||
      (p.gstin && p.gstin.toLowerCase().includes(q))
    );
  });

  return (
    <div className="app-container">
      {/* Toast Notification */}
      {toastMessage && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', background: '#10b981', color: '#ffffff', padding: '0.75rem 1.25rem', borderRadius: '8px', fontWeight: 700, boxShadow: '0 10px 25px rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>✨</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Left Sidebar Navigation */}
      <aside className="app-sidebar">
        <div className="sidebar-top">
          {/* Brand Logo & Title */}
          <div
            className="sidebar-brand"
            onClick={() => navigateTo('landing')}
            style={{ cursor: 'pointer' }}
            title="View public Landing Page"
          >
            <div className="sidebar-brand-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2L2 22h20L12 2z" />
                <path d="M12 2v20" strokeWidth="1.5" strokeDasharray="2 2" />
              </svg>
            </div>
            <div className="sidebar-brand-text">
              <span className="sidebar-brand-title">Adaptive Billing</span>
              <span className="sidebar-brand-subtitle">Cloud POS & GST</span>
            </div>
          </div>

          {/* Interactive Multi-Business Switcher & Store Profile */}
          <div className="sidebar-store-wrapper">
            <button
              type="button"
              className="sidebar-store-btn"
              onClick={() => setShowBusinessDropdown(!showBusinessDropdown)}
              title="Click to view store profile and partition details"
            >
              <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#6d4aff', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', flexShrink: 0 }}>
                🏬
              </div>
              <div className="sidebar-store-info">
                <span className="sidebar-store-name">
                  {shop?.name || 'Green Mart Supermarket'}
                </span>
                <span className="sidebar-store-badge">
                  {getBusinessLabel(shop?.businessType)} <span className="chevron-arrow">▾</span>
                </span>
              </div>
            </button>

            {showBusinessDropdown && (
              <>
                <div
                  className="dropdown-backdrop"
                  onClick={() => setShowBusinessDropdown(false)}
                />
                <div className="business-dropdown-menu sidebar-dropdown-flyout">
                  <div className="dropdown-header">
                    <span>Store Profile</span>
                    <span className="store-isolation-badge">🔒 Isolated Partition</span>
                  </div>

                  <div style={{ padding: '0.65rem' }}>
                    {/* Active Store Identity Card */}
                    <div className="store-profile-card">
                      <div className="store-profile-header">
                        <span className="store-profile-name">{shop?.name || 'Your Store'}</span>
                        <span className={`biz-badge biz-${shop?.businessType || 'retail'}`}>
                          {getBusinessIcon(shop?.businessType)} {getBusinessLabel(shop?.businessType)}
                        </span>
                      </div>

                      <div className="store-profile-meta-grid">
                        <div className="store-meta-item">
                          <span className="store-meta-label">GSTIN</span>
                          <span className="store-meta-val">{shop?.gstin || 'Unregistered B2C'}</span>
                        </div>
                        <div className="store-meta-item">
                          <span className="store-meta-label">Phone</span>
                          <span className="store-meta-val">{shop?.phone || 'Not configured'}</span>
                        </div>
                        <div className="store-meta-item">
                          <span className="store-meta-label">Address</span>
                          <span className="store-meta-val">{shop?.address || 'Store location not specified'}</span>
                        </div>
                      </div>

                      {/* Quick navigation actions */}
                      <div className="store-quick-actions">
                        <button
                          type="button"
                          className="store-quick-action-btn"
                          onClick={() => {
                            setActiveTab('settings');
                            setShowBusinessDropdown(false);
                          }}
                        >
                          ⚙️ Store Profile & Settings
                        </button>
                        <button
                          type="button"
                          className="store-quick-action-btn"
                          onClick={() => {
                            setActiveTab('pos');
                            setShowBusinessDropdown(false);
                          }}
                        >
                          🧾 Open POS Quick Billing
                        </button>
                        <button
                          type="button"
                          className="store-quick-action-btn"
                          onClick={() => {
                            setActiveTab('reports');
                            setShowBusinessDropdown(false);
                          }}
                        >
                          📊 Sales Reports & Analytics
                        </button>
                      </div>
                    </div>

                    <div className="store-single-tenant-note">
                      <span>🛡️</span>
                      <span>
                        <strong>Single-Business License Active:</strong> Your store data is strictly private to your account. No cross-store data leaks.
                      </span>
                    </div>
                  </div>

                  <div className="dropdown-footer">
                    <button
                      className="btn btn-secondary"
                      style={{ width: '100%', padding: '0.45rem', fontSize: '0.8rem', justifyContent: 'center' }}
                      onClick={() => {
                        setShowBusinessDropdown(false);
                        setActiveTab('settings');
                      }}
                    >
                      ⚙️ Store Profile & Tax Settings
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Navigation Links - Strictly Tailored per Role */}
          <nav className="sidebar-nav">
            {/* 1. Dashboard Tab - Custom title and icon per role */}
            <button
              type="button"
              className={`sidebar-nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('dashboard')}
            >
              <span className="nav-icon">
                {user.role === 'owner' ? '👑' : user.role === 'manager' ? '🏪' : '💳'}
              </span>
              <span className="nav-text">
                {user.role === 'owner' ? 'Dashboard' : user.role === 'manager' ? 'Branch Dashboard' : 'Cashier Station'}
              </span>
            </button>

            {/* 2. POS Counter - Available to Cashier, Store Manager, and Super Admin */}
            <button
              type="button"
              className={`sidebar-nav-item ${activeTab === 'pos' ? 'active' : ''}`}
              onClick={() => setActiveTab('pos')}
            >
              <span className="nav-icon">🛒</span>
              <span className="nav-text">POS Counter</span>
              <span className="nav-tag-shortcut">F1</span>
            </button>

            {/* 3. Cashier Shifts: ONLY for Cashier and Store Manager (Super Admin does not run cashier shifts!) */}
            {user.role !== 'owner' && (
              <button
                type="button"
                className={`sidebar-nav-item ${activeTab === 'shifts' ? 'active' : ''}`}
                onClick={() => setActiveTab('shifts')}
              >
                <span className="nav-icon">💵</span>
                <span className="nav-text">
                  {user.role === 'manager' ? 'Shift Approvals & Hub' : 'My Cashier Shift'}
                </span>
                {activeShiftNumber ? (
                  <span className="nav-shift-badge active" title={`Active Shift: ${activeShiftNumber}`}>
                    ● {activeShiftNumber}
                  </span>
                ) : (
                  <span className="nav-shift-badge closed">
                    Closed
                  </span>
                )}
              </button>
            )}

            {/* 4. Products: Only for Store Manager and Super Admin */}
            {user.role !== 'cashier' && (
              <button
                type="button"
                className={`sidebar-nav-item ${activeTab === 'items' ? 'active' : ''}`}
                onClick={() => setActiveTab('items')}
              >
                <span className="nav-icon">📦</span>
                <span className="nav-text">Products</span>
                <span className="nav-count-badge">{items.length}</span>
              </button>
            )}

            {/* 5. Inventory Hub: Only for Store Manager and Super Admin */}
            {user.role !== 'cashier' && (
              <button
                type="button"
                className={`sidebar-nav-item ${activeTab === 'inventory' ? 'active' : ''}`}
                onClick={() => setActiveTab('inventory')}
              >
                <span className="nav-icon">🏬</span>
                <span className="nav-text">Inventory Hub</span>
                {totalStockAlerts > 0 && (
                  <span
                    className={`nav-count-badge ${outOfStockItems.length > 0 ? 'blinking-badge-red' : 'blinking-badge-amber'}`}
                    title={`${outOfStockItems.length} out of stock, ${lowStockItems.length} low stock`}
                  >
                    {totalStockAlerts}
                  </span>
                )}
              </button>
            )}

            {/* 6. Bills & Invoices: Visible to all (Cashier views recent counter invoices) */}
            <button
              type="button"
              className={`sidebar-nav-item ${activeTab === 'invoices' ? 'active' : ''}`}
              onClick={() => setActiveTab('invoices')}
            >
              <span className="nav-icon">📄</span>
              <span className="nav-text">
                {user.role === 'cashier' ? 'Recent Bills' : 'Bills & Invoices'}
              </span>
            </button>

            {/* 7. Customers: Only for Store Manager and Super Admin */}
            {user.role !== 'cashier' && (
              <button
                type="button"
                className={`sidebar-nav-item ${activeTab === 'customers' ? 'active' : ''}`}
                onClick={() => setActiveTab('customers')}
              >
                <span className="nav-icon">👥</span>
                <span className="nav-text">Customers</span>
                <span className="nav-count-badge">{parties.filter((p) => p.type === 'customer').length}</span>
              </button>
            )}

            {/* 8. Suppliers: Only for Store Manager and Super Admin */}
            {user.role !== 'cashier' && (
              <button
                type="button"
                className={`sidebar-nav-item ${activeTab === 'suppliers' ? 'active' : ''}`}
                onClick={() => setActiveTab('suppliers')}
              >
                <span className="nav-icon">🚚</span>
                <span className="nav-text">Suppliers</span>
                <span className="nav-count-badge">{parties.filter((p) => p.type === 'supplier').length}</span>
              </button>
            )}

            {/* 9. Purchases & Inward: Only for Store Manager and Super Admin if permitted */}
            {user.role !== 'cashier' && can(user?.role as any, 'purchases') && (
              <button
                type="button"
                className={`sidebar-nav-item ${activeTab === 'purchases' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('purchases');
                  loadPurchases();
                }}
              >
                <span className="nav-icon">📥</span>
                <span className="nav-text">Purchases & Inward</span>
                <span className="nav-count-badge">{purchases.length}</span>
              </button>
            )}

            {/* Management Section: Only for Store Manager and Super Admin */}
            {user.role !== 'cashier' && (
              <>
                <div className="sidebar-section-label" style={{ marginTop: '0.75rem' }}>MANAGEMENT</div>
                <button
                  type="button"
                  className={`sidebar-nav-item ${activeTab === 'reports' ? 'active' : ''}`}
                  onClick={() => setActiveTab('reports')}
                >
                  <span className="nav-icon">📊</span>
                  <span className="nav-text">Analytics & Reports</span>
                </button>
                {user.role === 'owner' && (
                  <button
                    type="button"
                    className={`sidebar-nav-item ${activeTab === 'settings' ? 'active' : ''}`}
                    onClick={() => setActiveTab('settings')}
                  >
                    <span className="nav-icon">⚙️</span>
                    <span className="nav-text">Business Packs</span>
                  </button>
                )}
              </>
            )}
          </nav>
        </div>

        {/* Sidebar Footer (User Profile & Utilities Matching Image 2) */}
        <div className="sidebar-footer">
          <div className="sidebar-user-card">
            <div className="sidebar-user-avatar" title={user.name}>
              {user.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="sidebar-user-meta">
              <span className="sidebar-user-name">{user.name}</span>
              <span className="sidebar-user-role">
                <span className="user-status-dot"></span>
                {user.role === 'owner' ? '👑 Super Admin' : user.role === 'manager' ? '🏪 Store Manager' : user.role === 'cashier' ? '💳 Cashier' : user.role}
              </span>
            </div>
          </div>

          <div className="sidebar-footer-buttons-list">
            {user.role !== 'cashier' && (
              <button
                type="button"
                className="sidebar-action-row-btn"
                onClick={() => setActiveTab('settings')}
                title="Store Configuration & Settings"
              >
                <span className="action-row-icon">⚙️</span>
                <span>Settings</span>
              </button>
            )}
            <button
              type="button"
              className="sidebar-action-row-btn signout"
              onClick={handleLogout}
              title="Logout of current business"
            >
              <span className="action-row-icon">🚪</span>
              <span>Logout</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Body */}
      <main className="main-content">
        {/* Top Global Bar Matching Image 2 */}
        <div className="top-global-bar">
          <div className="top-global-search">
            <span className="global-search-icon">🔍</span>
            <input
              type="text"
              className="global-search-input"
              placeholder="Search products, barcode or customer..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="top-global-actions">
            <button
              type="button"
              className="top-notification-btn"
              title={
                totalStockAlerts > 0
                  ? `🔔 ${totalStockAlerts} Inventory Alert${totalStockAlerts > 1 ? 's' : ''} (${outOfStockItems.length} out of stock, ${lowStockItems.length} low stock) — Click to review`
                  : 'No inventory alerts'
              }
              onClick={() => setActiveTab('inventory')}
            >
              <span className="notif-icon">🔔</span>
              {totalStockAlerts > 0 && (
                <span className={`notif-badge ${outOfStockItems.length > 0 ? 'blinking-badge-red' : 'blinking-badge-amber'}`}>
                  {totalStockAlerts}
                </span>
              )}
            </button>
            <div className="top-user-chip" onClick={() => setActiveTab('settings')}>
              <div className="top-user-avatar">
                {user.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="top-user-details">
                <span className="top-user-name">{user.name}</span>
                <span className="top-user-role">{user.role}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Other Tab Headers */}
        {activeTab !== 'pos' && activeTab !== 'dashboard' && (
          <header className="content-top-header">
            <div className="content-header-left">
              <h1 className="content-page-title">
                {activeTab === 'shifts' && '💵 Cashier Shifts & Day-End Closing'}
                {activeTab === 'items' && '📦 Product & Stock Catalog'}
                {activeTab === 'inventory' && '🏬 Inventory Hub & Stock Operations'}
                {activeTab === 'purchases' && '📥 Purchases & Stock Inward'}
                {activeTab === 'invoices' && '🧾 Sales Invoices & Bills'}
                {activeTab === 'customers' && '👥 Customer Directory & Khata'}
                {activeTab === 'suppliers' && '🚚 Supplier Directory'}
                {activeTab === 'reports' && '📊 Business Analytics & Reports'}
                {activeTab === 'settings' && '⚙️ Business Configuration & Settings'}
              </h1>
              <span className="content-page-subtitle">
                {activeTab === 'shifts' && 'Manage cashier registers, drawer cash float, cash movements, and day-end reconciliation reports'}
                {activeTab === 'items' && 'Manage your catalog, stock balances, tax rates, and barcodes'}
                {activeTab === 'inventory' && 'Real-time stock valuation, movements ledger, manual adjustments, physical count audits, and replenishment'}
                {activeTab === 'purchases' && 'Record supplier invoices, inward goods stock into ledger, and track purchase GST'}
                {activeTab === 'invoices' && 'View issued invoices, audit trails, and print thermal receipts'}
                {activeTab === 'customers' && 'Manage customer accounts, GSTINs, and khata balances'}
                {activeTab === 'suppliers' && 'Manage vendors, purchase distributors, GSTIN verification, and credit limits'}
                {activeTab === 'reports' && 'Real-time sales revenue, tax breakdown, and top selling items'}
                {activeTab === 'settings' && 'Store profile, GST settings, and tailored trade packs'}
              </span>
            </div>

            <div className="content-header-right">
              <div className="header-store-chip">
                <span className="store-chip-dot"></span>
                <span className="store-chip-text">
                  {shop?.name} • <strong>{shop?.gstin || 'B2C Retail'}</strong>
                </span>
              </div>
            </div>
          </header>
        )}

        {/* ROLE-BASED DASHBOARDS (SUPER ADMIN / STORE MANAGER / CASHIER) */}
        {activeTab === 'dashboard' && (
          <div className="role-dashboards-view">
            {user.role === 'owner' && (
              <SuperAdminDashboard
                user={user}
                shop={shop}
                report={report}
                onRefreshReport={loadReports}
                onNavigate={setActiveTab}
              />
            )}
            {user.role === 'manager' && (
              <StoreManagerDashboard
                user={user}
                shop={shop}
                onNavigate={setActiveTab}
              />
            )}
            {user.role === 'cashier' && (
              <CashierDashboard
                user={user}
                shop={shop}
                onNavigateToPos={() => setActiveTab('pos')}
                onNavigateToShifts={() => setActiveTab('shifts')}
              />
            )}
            {user.role !== 'owner' && user.role !== 'manager' && user.role !== 'cashier' && (
              <SuperAdminDashboard
                user={user}
                shop={shop}
                report={report}
                onRefreshReport={loadReports}
                onNavigate={setActiveTab}
              />
            )}
          </div>
        )}

        {/* TAB 1: MODERN POS COUNTER (MATCHING IMAGE 2 LAYOUT) */}
        {activeTab === 'pos' && (
          <div className="pos-page-wrapper">
            {/* Header with Blue Cart Icon & Title */}
            <div className="pos-page-header">
              <div className="pos-header-title-wrap">
                <div className="pos-header-cart-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="9" cy="21" r="1"></circle>
                    <circle cx="20" cy="21" r="1"></circle>
                    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                  </svg>
                </div>
                <div>
                  <h1 className="pos-page-title">POS Billing Counter</h1>
                  <p className="pos-page-subtitle">Fast barcode scanning, dynamic cart calculation, and instant GST checkout</p>
                </div>
              </div>
            </div>

            {/* Blinking Low Stock & Out of Stock Alert Banner */}
            {totalStockAlerts > 0 && (
              <div className={`dashboard-stock-alert-banner ${outOfStockItems.length === 0 ? 'amber-only' : ''}`}>
                <div className="alert-banner-left">
                  <div className={`alert-banner-pulse-icon ${outOfStockItems.length === 0 ? 'amber' : ''}`}>
                    {outOfStockItems.length > 0 ? '🚨' : '⚠️'}
                  </div>
                  <div className="alert-banner-content">
                    <div className={`alert-banner-title ${outOfStockItems.length === 0 ? 'amber' : ''}`}>
                      <span className={`blinking-dot ${outOfStockItems.length > 0 ? 'red' : 'amber'}`}></span>
                      {outOfStockItems.length > 0 ? 'CRITICAL STOCK ALERT' : 'LOW STOCK WARNING'}
                    </div>
                    <div className={`alert-banner-desc ${outOfStockItems.length === 0 ? 'amber' : ''}`}>
                      {outOfStockItems.length > 0 && (
                        <span>
                          <strong>{outOfStockItems.length}</strong> {outOfStockItems.length === 1 ? 'product is' : 'products are'} completely <strong>Out of Stock</strong>
                        </span>
                      )}
                      {outOfStockItems.length > 0 && lowStockItems.length > 0 && <span> and </span>}
                      {lowStockItems.length > 0 && (
                        <span>
                          <strong>{lowStockItems.length}</strong> {lowStockItems.length === 1 ? 'product is' : 'products are'} running <strong>Low on Stock</strong>
                        </span>
                      )}
                      . Restock immediately to prevent missed sales at checkout.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  className={`alert-banner-btn ${outOfStockItems.length === 0 ? 'amber' : ''}`}
                  onClick={() => setActiveTab('inventory')}
                >
                  <span>Resolve in Inventory Hub</span>
                  <span>→</span>
                </button>
              </div>
            )}

            {/* Top Cards Row: Scan Barcode + 3 Badges */}
            <div className="pos-feature-row">
              {/* Scan Barcode Card */}
              <div className="scan-barcode-card">
                <div className="scan-barcode-left">
                  <div className="barcode-icon-box">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 5v4M3 5h4M21 5v4M21 5h-4M3 19v-4M3 19h4M21 19v-4M21 19h-4M7 9v6M10 9v6M14 9v6M17 9v6" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="scan-card-title">Scan Barcode</h4>
                    <p className="scan-card-subtitle">Scan product barcode to add items</p>
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-scan-action"
                  onClick={() => {
                    const el = document.getElementById('pos-product-search-input');
                    if (el) el.focus();
                    showToast('Ready for barcode input');
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                    <circle cx="12" cy="13" r="4"></circle>
                  </svg>
                  <span>Scan</span>
                </button>
              </div>

              {/* Badge 1: Fast Billing */}
              <div className="pos-feature-card">
                <div className="feature-icon-circle purple">
                  ⚡
                </div>
                <div className="feature-card-texts">
                  <span className="feature-title">Fast Billing</span>
                  <span className="feature-subtitle">Quick & Easy</span>
                </div>
              </div>

              {/* Badge 2: GST Ready */}
              <div className="pos-feature-card">
                <div className="feature-icon-circle cyan">
                  🛡️
                </div>
                <div className="feature-card-texts">
                  <span className="feature-title">GST Ready</span>
                  <span className="feature-subtitle">Automatic Tax</span>
                </div>
              </div>

              {/* Badge 3: Secure */}
              <div className="pos-feature-card">
                <div className="feature-icon-circle lavender">
                  🔒
                </div>
                <div className="feature-card-texts">
                  <span className="feature-title">Secure</span>
                  <span className="feature-subtitle">Your Data is Safe</span>
                </div>
              </div>
            </div>

            {/* Main Two-Column POS Layout */}
            <div className="pos-main-grid">
              {/* LEFT COLUMN: Controls & Catalog */}
              <div className="pos-left-panel">
                {/* 1. Customer Card */}
                <div className="pos-section-card">
                  <div className="pos-card-header">
                    <span className="card-header-icon blue">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                        <circle cx="12" cy="7" r="4"></circle>
                      </svg>
                    </span>
                    <span className="pos-card-heading">Customer</span>
                  </div>

                  <div className="customer-input-row">
                    <div className="customer-input-wrap">
                      <input
                        type="text"
                        className="pos-input"
                        placeholder="Search customer by name, phone or ID..."
                        value={customerSearch}
                        onChange={(e) => {
                          setCustomerSearch(e.target.value);
                          setShowCustomerDropdown(true);
                        }}
                        onFocus={() => setShowCustomerDropdown(true)}
                      />
                      {selectedParty && (
                        <div className="selected-customer-pill">
                          <span>{selectedParty.name}</span>
                          <button
                            type="button"
                            className="clear-pill-btn"
                            onClick={() => {
                              setSelectedPartyId('');
                              setCustomerSearch('');
                            }}
                            title="Switch to Walk-in"
                          >
                            ✕
                          </button>
                        </div>
                      )}

                      {showCustomerDropdown && (
                        <div className="customer-dropdown-list">
                          <div
                            className="customer-dropdown-item walkin"
                            onClick={() => {
                              setSelectedPartyId('');
                              setCustomerSearch('');
                              setShowCustomerDropdown(false);
                            }}
                          >
                            <span>🚶 Walk-in Customer</span>
                          </div>
                          {filteredParties.map((p) => (
                            <div
                              key={p.id}
                              className="customer-dropdown-item"
                              onClick={() => {
                                setSelectedPartyId(p.id);
                                setCustomerSearch(p.name);
                                setShowCustomerDropdown(false);
                              }}
                            >
                              <div className="cust-item-main">
                                <span className="cust-item-name">{p.name}</span>
                                <span className="cust-item-phone">{p.phone || 'No phone'}</span>
                              </div>
                              {p.gstin && <span className="cust-item-gstin">{p.gstin}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn-add-customer"
                      onClick={() => setShowPartyModal(true)}
                      title="Add New Customer"
                    >
                      +
                    </button>
                  </div>

                  {/* Contextual Wholesale Credit Alert */}
                  {shop?.businessType === 'wholesale' && selectedParty && (
                    <div className="wholesale-credit-alert">
                      <span>Credit Limit: <strong>{formatRupees(selectedParty.creditLimitMinor)}</strong></span>
                      {selectedParty.gstin && <span> • GSTIN: {selectedParty.gstin}</span>}
                    </div>
                  )}

                  {/* Contextual Pharmacy Doctor */}
                  {shop?.businessType === 'pharmacy' && (
                    <div style={{ marginTop: '0.65rem' }}>
                      <label style={{ fontSize: '0.72rem', color: '#be185d', fontWeight: 700 }}>Doctor / Prescription:</label>
                      <input
                        type="text"
                        className="pos-input"
                        style={{ padding: '0.4rem 0.65rem', fontSize: '0.82rem', marginTop: '0.2rem' }}
                        value={doctorName}
                        onChange={(e) => setDoctorName(e.target.value)}
                        placeholder="Dr. Name & Registration No."
                      />
                    </div>
                  )}
                </div>

                {/* 2. Product Search Card */}
                <div className="pos-section-card">
                  <div className="pos-card-header">
                    <span className="card-header-icon blue">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="4" width="20" height="16" rx="2"></rect>
                        <path d="M7 8v8M10 8v8M14 8v8M17 8v8"></path>
                      </svg>
                    </span>
                    <span className="pos-card-heading">Product Search</span>
                  </div>
                  <div className="product-search-input-wrap">
                    <input
                      id="pos-product-search-input"
                      type="text"
                      className="pos-input"
                      placeholder="Search product by name, barcode or category..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    <span className="search-input-right-icon">🔍</span>
                  </div>
                </div>

                {/* 3. Quick Categories (4x2 Grid Matching Image 2) */}
                <div className="pos-section-card">
                  <div className="pos-card-header space-between">
                    <span className="pos-card-heading">Quick Categories</span>
                    <button
                      type="button"
                      className="btn-view-all"
                      onClick={() => {
                        setSelectedCategory('ALL');
                        setSearchQuery('');
                      }}
                    >
                      View All
                    </button>
                  </div>

                  <div className="quick-categories-grid">
                    {/* 1: Groceries */}
                    <button
                      type="button"
                      className={`quick-cat-btn ${selectedCategory === 'Groceries' ? 'active' : ''}`}
                      onClick={() => setSelectedCategory(selectedCategory === 'Groceries' ? 'ALL' : 'Groceries')}
                    >
                      <div className="cat-icon-box green">
                        🛒
                      </div>
                      <span className="cat-label">Groceries</span>
                    </button>

                    {/* 2: Fresh Produce */}
                    <button
                      type="button"
                      className={`quick-cat-btn ${selectedCategory === 'Fresh Produce' ? 'active' : ''}`}
                      onClick={() => setSelectedCategory(selectedCategory === 'Fresh Produce' ? 'ALL' : 'Fresh Produce')}
                    >
                      <div className="cat-icon-box mint">
                        🍃
                      </div>
                      <span className="cat-label">Fresh Produce</span>
                    </button>

                    {/* 3: Beverages */}
                    <button
                      type="button"
                      className={`quick-cat-btn ${selectedCategory === 'Beverages' ? 'active' : ''}`}
                      onClick={() => setSelectedCategory(selectedCategory === 'Beverages' ? 'ALL' : 'Beverages')}
                    >
                      <div className="cat-icon-box blue">
                        🍾
                      </div>
                      <span className="cat-label">Beverages</span>
                    </button>

                    {/* 4: Snacks */}
                    <button
                      type="button"
                      className={`quick-cat-btn ${selectedCategory === 'Snacks' ? 'active' : ''}`}
                      onClick={() => setSelectedCategory(selectedCategory === 'Snacks' ? 'ALL' : 'Snacks')}
                    >
                      <div className="cat-icon-box red">
                        🍿
                      </div>
                      <span className="cat-label">Snacks</span>
                    </button>

                    {/* 5: Household */}
                    <button
                      type="button"
                      className={`quick-cat-btn ${selectedCategory === 'Household' ? 'active' : ''}`}
                      onClick={() => setSelectedCategory(selectedCategory === 'Household' ? 'ALL' : 'Household')}
                    >
                      <div className="cat-icon-box purple">
                        🏠
                      </div>
                      <span className="cat-label">Household</span>
                    </button>

                    {/* 6: Personal Care */}
                    <button
                      type="button"
                      className={`quick-cat-btn ${selectedCategory === 'Personal Care' ? 'active' : ''}`}
                      onClick={() => setSelectedCategory(selectedCategory === 'Personal Care' ? 'ALL' : 'Personal Care')}
                    >
                      <div className="cat-icon-box lavender">
                        👤
                      </div>
                      <span className="cat-label">Personal Care</span>
                    </button>

                    {/* 7: Dairy */}
                    <button
                      type="button"
                      className={`quick-cat-btn ${selectedCategory === 'Dairy' ? 'active' : ''}`}
                      onClick={() => setSelectedCategory(selectedCategory === 'Dairy' ? 'ALL' : 'Dairy')}
                    >
                      <div className="cat-icon-box cyan">
                        🥛
                      </div>
                      <span className="cat-label">Dairy</span>
                    </button>

                    {/* 8: Others */}
                    <button
                      type="button"
                      className={`quick-cat-btn ${selectedCategory === 'Others' ? 'active' : ''}`}
                      onClick={() => setSelectedCategory(selectedCategory === 'Others' ? 'ALL' : 'Others')}
                    >
                      <div className="cat-icon-box indigo">
                        🔲
                      </div>
                      <span className="cat-label">Others</span>
                    </button>
                  </div>
                </div>

                {/* 4. Product Catalog Quick-Add Grid */}
                <div className="pos-section-card product-catalog-card">
                  <div className="pos-card-header space-between">
                    <span className="pos-card-heading">
                      Matching Products ({filteredItems.length})
                    </span>
                    <button
                      type="button"
                      className="btn-add-item-link"
                      onClick={() => setShowItemModal(true)}
                    >
                      + Add Item
                    </button>
                  </div>

                  <div className="pos-quick-items-grid">
                    {filteredItems.slice(0, 10).map((item) => (
                      <div
                        key={item.id}
                        className="quick-item-card"
                        onClick={() => addToCart(item)}
                        title={`Click to add ${item.name} to cart`}
                      >
                        <div className="quick-item-top">
                          <span className="quick-item-name">{item.name}</span>
                          <span className="quick-item-cat">{item.category || 'General'}</span>
                        </div>
                        <div className="quick-item-bottom">
                          <span className="quick-item-price mono">{formatRupees(item.priceMinor)}</span>
                          <button
                            type="button"
                            className="quick-add-badge"
                            onClick={(e) => {
                              e.stopPropagation();
                              addToCart(item);
                            }}
                          >
                            + Add
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 5. Apply Discount Card */}
                <div
                  className="pos-section-card apply-discount-card"
                  onClick={() => setShowDiscountPicker(!showDiscountPicker)}
                >
                  <div className="discount-card-left">
                    <div className="discount-tag-icon">
                      🏷️
                    </div>
                    <div>
                      <h4 className="discount-card-title">Apply Discount</h4>
                      <p className="discount-card-subtitle">
                        {appliedDiscountPercent > 0
                          ? `${appliedDiscountPercent}% discount applied (${formatRupees(discountMinor)} off)`
                          : 'Add discounts, offers or loyalty points'}
                      </p>
                    </div>
                  </div>
                  <span className="discount-chevron">
                    {showDiscountPicker ? '▲' : '›'}
                  </span>
                </div>

                {showDiscountPicker && (
                  <div className="discount-picker-popover">
                    <div className="discount-pills-row">
                      {[0, 5, 10, 15, 20].map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          className={`discount-pill ${appliedDiscountPercent === pct ? 'active' : ''}`}
                          onClick={() => {
                            setAppliedDiscountPercent(pct);
                            setShowDiscountPicker(false);
                            showToast(pct > 0 ? `${pct}% discount applied!` : 'Discount cleared');
                          }}
                        >
                          {pct === 0 ? 'None' : `${pct}% OFF`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* RIGHT COLUMN: Current Cart & Payment */}
              <div className="pos-right-panel">
                <div className="current-cart-card">
                  {/* Cart Header */}
                  <div className="current-cart-header">
                    <div className="current-cart-title-wrap">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="9" cy="21" r="1"></circle>
                        <circle cx="20" cy="21" r="1"></circle>
                        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                      </svg>
                      <span className="current-cart-title">
                        Current Cart ({cart.reduce((a, b) => a + b.qty, 0)})
                      </span>
                    </div>
                    <div className="cart-header-actions">
                      <button
                        type="button"
                        className="btn-clear-cart"
                        disabled={cart.length === 0}
                        onClick={() => setCart([])}
                        title="Remove all items from current cart"
                      >
                        🗑️ Clear Cart
                      </button>
                      <button
                        type="button"
                        className="btn-hold-order"
                        onClick={handleHoldOrder}
                        title="Hold or restore pending bill"
                      >
                        ⏸️ {heldOrders.length > 0 ? `Hold Order (${heldOrders.length})` : 'Hold Order'}
                      </button>
                    </div>
                  </div>

                  {/* Cart Body */}
                  <div className="current-cart-body">
                    {cart.length === 0 ? (
                      <div className="empty-cart-state">
                        <div className="empty-cart-icon-wrapper">
                          <svg width="74" height="74" viewBox="0 0 24 24" fill="none" stroke="#6d4aff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="9" cy="21" r="1"></circle>
                            <circle cx="20" cy="21" r="1"></circle>
                            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                          </svg>
                          <div className="empty-cart-badge-plus">+</div>
                        </div>
                        <h3 className="empty-cart-title">Your cart is empty</h3>
                        <p className="empty-cart-subtitle">Scan a product or search to add items to your cart</p>
                        <button
                          type="button"
                          className="btn-start-shopping"
                          onClick={() => {
                            const el = document.getElementById('pos-product-search-input');
                            if (el) el.focus();
                          }}
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="9" cy="21" r="1"></circle>
                            <circle cx="20" cy="21" r="1"></circle>
                            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                          </svg>
                          <span>Start Shopping</span>
                        </button>
                      </div>
                    ) : (
                      <div className="cart-items-scroll-list">
                        {/* Specialized Restaurant Controls */}
                        {shop?.businessType === 'restaurant' && (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.65rem', padding: '0.55rem', background: '#fffbeb', borderRadius: '8px', border: '1px solid #fef3c7' }}>
                            <div>
                              <label style={{ fontSize: '0.72rem', color: '#b45309', fontWeight: 700 }}>Table:</label>
                              <select
                                className="form-input"
                                style={{ fontSize: '0.8rem', padding: '0.35rem', marginTop: '0.15rem' }}
                                value={restaurantTable}
                                onChange={(e) => setRestaurantTable(e.target.value)}
                              >
                                {['Table 1', 'Table 2', 'Table 3', 'Table 4 (Family AC)', 'Table 5', 'Takeaway / Parcel'].map((tbl) => (
                                  <option key={tbl} value={tbl}>{tbl}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label style={{ fontSize: '0.72rem', color: '#b45309', fontWeight: 700 }}>Order Type:</label>
                              <select
                                className="form-input"
                                style={{ fontSize: '0.8rem', padding: '0.35rem', marginTop: '0.15rem' }}
                                value={restaurantOrderType}
                                onChange={(e) => setRestaurantOrderType(e.target.value as any)}
                              >
                                <option value="Dine-in">Dine-in</option>
                                <option value="Takeaway">Takeaway</option>
                                <option value="Delivery">Delivery</option>
                              </select>
                            </div>
                          </div>
                        )}

                        {/* Cart Item Rows */}
                        {cart.map(({ item, qty }) => (
                          <div key={item.id} className="current-cart-row">
                            <div className="cart-row-info">
                              <div className="cart-row-name">{item.name}</div>
                              <div className="cart-row-unit-price mono">
                                {formatRupees(item.priceMinor)} × {qty} ({item.taxRateBp / 100}% GST)
                              </div>
                            </div>
                            <div className="cart-row-qty-ctrl">
                              <button
                                type="button"
                                className="cart-qty-btn"
                                onClick={() => updateCartQty(item.id, -1)}
                              >
                                -
                              </button>
                              <span className="cart-qty-num mono">{qty}</span>
                              <button
                                type="button"
                                className="cart-qty-btn"
                                onClick={() => updateCartQty(item.id, 1)}
                              >
                                +
                              </button>
                            </div>
                            <div className="cart-row-total mono">
                              {formatRupees(item.priceMinor * qty)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Cart Summary Card Matching Image 2 */}
                  <div className="current-cart-summary">
                    <div className="summary-line-item">
                      <span>Subtotal</span>
                      <span className="mono">{formatRupees(cartTaxableMinor)}</span>
                    </div>
                    <div className="summary-line-item">
                      <span>Discount</span>
                      <span className="mono" style={{ color: appliedDiscountPercent > 0 ? '#10b981' : undefined }}>
                        {appliedDiscountPercent > 0 ? `-${formatRupees(discountMinor)}` : '₹0.00'}
                      </span>
                    </div>
                    <div className="summary-line-item">
                      <span>Tax (GST)</span>
                      <span className="mono">{formatRupees(cartTaxMinor)}</span>
                    </div>

                    {/* Payment Mode Selector */}
                    <div className="cart-payment-modes">
                      {(['cash', 'upi', 'card', 'bank'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          className={`cart-pay-mode-btn ${selectedPayMode === mode ? 'active' : ''}`}
                          onClick={() => setSelectedPayMode(mode)}
                        >
                          {mode === 'cash' && '💵 Cash'}
                          {mode === 'upi' && '📱 UPI'}
                          {mode === 'card' && '💳 Card'}
                          {mode === 'bank' && '🏦 Bank'}
                        </button>
                      ))}
                    </div>

                    <div className="summary-total-checkout-row">
                      <div className="total-display-col">
                        <span className="total-label">Total</span>
                        <span className="total-amount-val mono">{formatRupees(finalPayableMinor)}</span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.4rem', flex: 1, justifyContent: 'flex-end' }}>
                        {shop?.businessType === 'restaurant' && (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '0.65rem 0.85rem', fontSize: '0.8rem', fontWeight: 700 }}
                            disabled={cart.length === 0 || isCheckingOut}
                            onClick={() => handleCheckout(true)}
                          >
                            🍳 KOT
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-proceed-payment"
                          disabled={cart.length === 0 || isCheckingOut}
                          onClick={() => handleCheckout(false)}
                        >
                          {isCheckingOut ? 'Processing...' : 'Proceed to Payment ›'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB: CASHIER SHIFTS & DAY-END CLOSING */}
        {activeTab === 'shifts' && user && (
          <ShiftsDashboard
            user={user}
            shop={shop}
            onNavigateToPos={() => setActiveTab('pos')}
          />
        )}

        {/* TAB 2: PRODUCTS */}
        {activeTab === 'items' && (() => {
          const filteredMasterItems = items.filter((item) => {
            const q = itemSearchMaster.trim().toLowerCase();
            const matchesQ = !q ||
              item.name.toLowerCase().includes(q) ||
              (item.sku && item.sku.toLowerCase().includes(q)) ||
              (item.barcode && item.barcode.includes(q)) ||
              (item.hsn && item.hsn.includes(q)) ||
              (item.category && item.category.toLowerCase().includes(q));
            const matchesCat = itemCatFilterMaster === 'ALL' || item.category === itemCatFilterMaster;
            return matchesQ && matchesCat;
          });

          return (
            <div className="card">
              <div className="card-title" style={{ flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                <div>
                  <span>Product & Inventory Master ({items.length} items for {shop?.name})</span>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 400, marginTop: '2px' }}>
                    Track selling price, cost price, GST tax rates, units and live ledger stock
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    className="form-input"
                    style={{ width: '180px', padding: '0.45rem 0.75rem', fontSize: '0.85rem' }}
                    placeholder="Search items, SKU, HSN..."
                    value={itemSearchMaster}
                    onChange={(e) => setItemSearchMaster(e.target.value)}
                  />
                  <select
                    className="form-input"
                    style={{ width: '140px', padding: '0.45rem 0.75rem', fontSize: '0.85rem' }}
                    value={itemCatFilterMaster}
                    onChange={(e) => setItemCatFilterMaster(e.target.value)}
                  >
                    <option value="ALL">All Categories</option>
                    {categoriesList.filter((c) => c.active).map((c) => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                  <button className="btn btn-secondary" onClick={() => setShowCategoryModal(true)}>
                    🏷️ Categories
                  </button>
                  <button className="btn btn-primary" onClick={openAddItemModal}>
                    + Add New Item
                  </button>
                </div>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Product Name</th>
                    <th>Category</th>
                    <th>SKU / Code</th>
                    <th>HSN / SAC</th>
                    <th>Selling Price</th>
                    {can(user?.role as any, 'purchases') && <th>Last Purchase Cost</th>}
                    <th>GST Rate</th>
                    <th>Current Stock</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMasterItems.map((i) => (
                    <tr key={i.id} style={{ opacity: i.active === false ? 0.6 : 1 }}>
                      <td style={{ fontWeight: 600 }}>
                        {i.name}
                        {i.barcode && (
                          <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                            Barcode: {i.barcode}
                          </div>
                        )}
                        {i.custom?.batch && (
                          <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                            Batch: {i.custom.batch} | Exp: {i.custom.expiry} | {i.custom.rack}
                          </div>
                        )}
                      </td>
                      <td><span className="badge badge-blue">{i.category || 'General'}</span></td>
                      <td className="mono" style={{ color: '#94a3b8' }}>{i.sku || '—'}</td>
                      <td className="mono" style={{ color: '#94a3b8' }}>{i.hsn || '—'}</td>
                      <td className="mono" style={{ fontWeight: 700, color: '#6d4aff' }}>{formatRupees(i.priceMinor)}</td>
                      {can(user?.role as any, 'purchases') && (
                        <td className="mono">{i.costMinor ? formatRupees(i.costMinor) : '—'}</td>
                      )}
                      <td className="mono">{i.taxRateBp / 100}% {i.taxInclusive ? '(Incl)' : '(Excl)'}</td>
                      <td>
                        <span className={`badge ${i.currentStockMilli > 0 ? 'badge-emerald' : 'badge-amber'}`}>
                          {i.currentStockMilli / 1000} {i.unit || 'pcs'}
                        </span>
                      </td>
                      <td>
                        {i.active !== false ? (
                          <span className="badge badge-emerald">Active</span>
                        ) : (
                          <span className="badge badge-amber">Inactive</span>
                        )}
                      </td>
                      <td style={{ display: 'flex', gap: '0.35rem' }}>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                          onClick={() => openEditItemModal(i)}
                        >
                          ✏️ Edit
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: '#60a5fa' }}
                          onClick={() => setActiveTab('inventory')}
                          title="Open Inventory Hub"
                        >
                          🏬 Stock
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: i.active !== false ? '#f87171' : '#34d399' }}
                          onClick={() => handleToggleItemActive(i)}
                          title={i.active !== false ? 'Deactivate this item' : 'Reactivate this item'}
                        >
                          {i.active !== false ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredMasterItems.length === 0 && (
                    <tr>
                      <td colSpan={10} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                        No products match your search or filter criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          );
        })()}

        {/* TAB: INVENTORY MANAGEMENT */}
        {activeTab === 'inventory' && (
          <InventoryDashboard
            items={items}
            categories={categories}
            suppliers={parties.filter((p) => p.type === 'supplier')}
            userRole={user?.role as any}
            businessType={shop?.businessType}
            allowNegativeStock={shop?.businessType === 'restaurant' || shop?.businessType === 'service'}
            onNavigateToPurchases={(supplierId) => {
              setActiveTab('purchases');
              if (supplierId) {
                openNewPurchaseModalForSupplier(supplierId);
              } else {
                openNewPurchaseModal();
              }
            }}
            showToast={showToast}
            onReloadItems={loadItems}
          />
        )}

        {/* TAB 3: BILLS & INVOICES */}
        {activeTab === 'invoices' && (
          <div className="card">
            <div className="card-title">
              <span>Past Sales Invoices ({invoices.length} bills)</span>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Invoice No</th>
                  <th>Date & Time</th>
                  <th>Customer / Reference</th>
                  <th>Total Amount</th>
                  <th>Taxable</th>
                  <th>GST</th>
                  <th>Payment Method</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="mono" style={{ fontWeight: 700, color: '#6d4aff' }}>
                      <button
                        type="button"
                        onClick={() => openInvoiceDetail(inv.id)}
                        style={{ background: 'none', border: 'none', color: '#6d4aff', fontWeight: 700, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                        title="View bill details & returns"
                      >
                        {inv.number}
                      </button>
                      {inv.kind === 'credit_note' && (
                        <span className="badge" style={{ marginLeft: '6px', background: '#e0e7ff', color: '#4338ca', fontSize: '0.65rem' }}>
                          CREDIT NOTE
                        </span>
                      )}
                      {inv.status === 'voided' && (
                        <span className="badge" style={{ marginLeft: '6px', background: '#fee2e2', color: '#b91c1c', fontSize: '0.65rem' }}>
                          VOIDED
                        </span>
                      )}
                    </td>
                    <td>{new Date(inv.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{inv.customerName || 'Walk-in Customer'}</div>
                      {inv.customerPhone && (
                        <div className="mono" style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          📞 {inv.customerPhone}
                        </div>
                      )}
                      {/* Returned Badge (Section 4.1) */}
                      {inv.fullyReturned ? (
                        <div style={{ marginTop: '4px' }}>
                          <span
                            className="badge"
                            style={{
                              background: '#fef3c7',
                              color: '#92400e',
                              border: '1px solid #fde68a',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                              padding: '2px 6px',
                            }}
                            onClick={() => openInvoiceDetail(inv.id)}
                            title="Every line on this bill is fully returned"
                          >
                            Fully Returned • {inv.creditNotes?.map((c) => c.number).join(', ') || 'CN'}
                          </span>
                        </div>
                      ) : (inv.returnedMinor && inv.returnedMinor > 0) ? (
                        <div style={{ marginTop: '4px' }}>
                          <span
                            className="badge"
                            style={{
                              background: '#e0f2fe',
                              color: '#0369a1',
                              border: '1px solid #bae6fd',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                              padding: '2px 6px',
                            }}
                            onClick={() => openInvoiceDetail(inv.id)}
                            title="Click to view linked credit notes"
                          >
                            Returned {formatRupees(inv.returnedMinor)} • {inv.creditNotes?.map((c) => c.number).join(', ')}
                          </span>
                        </div>
                      ) : null}
                      {inv.whatsappSendCount && inv.whatsappSendCount > 0 ? (
                        <div style={{ fontSize: '0.72rem', color: '#16a34a', marginTop: '3px', fontWeight: 500 }}>
                          WhatsApp sent ×{inv.whatsappSendCount} • last {new Date(inv.whatsappLastSentAt!).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })} • {inv.whatsappLastLanguage === 'ta' ? 'Tamil' : inv.whatsappLastLanguage === 'hi' ? 'Hindi' : 'English'}
                        </div>
                      ) : null}
                    </td>
                    <td className="mono" style={{ fontWeight: 700, color: '#1e1b4b' }}>{formatRupees(inv.totalMinor)}</td>
                    <td className="mono">{formatRupees(inv.taxableMinor)}</td>
                    <td className="mono">{formatRupees(inv.cgstMinor + inv.sgstMinor)}</td>
                    <td>
                      {inv.payments.map((p, idx) => (
                        <span key={idx} className="badge badge-emerald" style={{ marginRight: '4px' }}>
                          {p.method}
                        </span>
                      ))}
                    </td>
                    <td style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '0.3rem 0.55rem', fontSize: '0.75rem' }}
                        onClick={() => openInvoiceDetail(inv.id)}
                        title="View bill lines and linked returns"
                      >
                        👁️ View
                      </button>
                      <a
                        href={inv.kind === 'credit_note' ? `/api/credit-notes/${inv.id}/print?paper=thermal80&autoprint=true` : `/api/invoices/${inv.id}/print?paper=thermal80&autoprint=true`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-secondary"
                        style={{ padding: '0.3rem 0.55rem', fontSize: '0.75rem', textDecoration: 'none' }}
                      >
                        🖨️ Thermal
                      </a>
                      <a
                        href={inv.kind === 'credit_note' ? `/api/credit-notes/${inv.id}/print?paper=a4` : `/api/invoices/${inv.id}/print?paper=a4`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-secondary"
                        style={{ padding: '0.3rem 0.55rem', fontSize: '0.75rem', textDecoration: 'none' }}
                      >
                        📄 A4 GST
                      </a>

                      {/* Return / Credit Note action button (Section 4.1) */}
                      {inv.kind !== 'credit_note' && inv.status !== 'cancelled' && (
                        <button
                          type="button"
                          className="btn"
                          disabled={Boolean(inv.fullyReturned)}
                          style={{
                            padding: '0.3rem 0.55rem',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            background: inv.fullyReturned ? '#f1f5f9' : '#e0e7ff',
                            color: inv.fullyReturned ? '#94a3b8' : '#4338ca',
                            borderColor: inv.fullyReturned ? '#cbd5e1' : '#c7d2fe',
                            cursor: inv.fullyReturned ? 'not-allowed' : 'pointer',
                          }}
                          onClick={() => openReturnModal(inv.id)}
                          title={inv.fullyReturned ? 'Fully returned' : 'Issue sales return / credit note'}
                        >
                          🔄 Return / CN
                        </button>
                      )}

                      {/* Void action: Owner or Manager only, on credit notes (Section 11.2) */}
                      {inv.kind === 'credit_note' && inv.status !== 'voided' && (user?.role === 'owner' || user?.role === 'manager') && (
                        <button
                          type="button"
                          className="btn"
                          style={{
                            padding: '0.3rem 0.55rem',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            background: '#fee2e2',
                            color: '#b91c1c',
                            borderColor: '#fca5a5',
                          }}
                          onClick={() => handleOpenVoidModal({ id: inv.id, number: inv.number, totalCreditMinor: inv.totalMinor, advanceAmountMinor: 0 })}
                          title="Void this credit note (Owner/Manager only)"
                        >
                          🚫 Void
                        </button>
                      )}

                      {inv.balanceMinor > 0 && inv.status === 'posted' && inv.partyId && (
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{
                            padding: '0.3rem 0.55rem',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            background: '#f59e0b',
                            borderColor: '#d97706',
                          }}
                          onClick={() => {
                            const cust = parties.find((p) => p.id === inv.partyId) || {
                              id: inv.partyId!,
                              name: inv.customerName || 'Customer',
                              phone: inv.customerPhone,
                              type: 'customer',
                              creditLimitMinor: 0,
                            };
                            openCollectPayment(cust, inv.id);
                          }}
                          title="Collect payment towards this bill"
                        >
                          💰 Collect
                        </button>
                      )}
                      {shop?.whatsappEnabled !== false && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{
                            padding: '0.3rem 0.55rem',
                            fontSize: '0.75rem',
                            color: inv.status === 'cancelled' || inv.status === 'voided' ? '#94a3b8' : '#15803d',
                            borderColor: inv.status === 'cancelled' || inv.status === 'voided' ? '#e2e8f0' : '#86efac',
                            background: inv.status === 'cancelled' || inv.status === 'voided' ? '#f8fafc' : '#f0fdf4',
                            fontWeight: 600,
                          }}
                          disabled={inv.status === 'cancelled' || inv.status === 'voided'}
                          title={inv.status === 'cancelled' || inv.status === 'voided' ? 'Document cancelled / voided' : 'Resend on WhatsApp'}
                          onClick={() => {
                            if (inv.kind === 'credit_note') {
                              handleOpenCreditNoteWhatsApp({
                                id: inv.id,
                                number: inv.number,
                                originalInvoiceNumber: 'Original Bill',
                                phone: inv.customerPhone || '',
                                customerName: inv.customerName,
                                totalCreditMinor: inv.totalMinor,
                                settlementSummary: 'Credit Note Settlement',
                                shareToken: inv.shareToken,
                              });
                            } else {
                              openWhatsAppResend(inv);
                            }
                          }}
                        >
                          💬 WhatsApp
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 4: CUSTOMERS */}
        {activeTab === 'customers' && (() => {
          const customersList = parties.filter((p) => p.type === 'customer' || !p.type);
          const filteredCustomers = customersList.filter((p) => {
            if (!customerFilterMaster.trim()) return true;
            const q = customerFilterMaster.trim().toLowerCase();
            return (
              p.name.toLowerCase().includes(q) ||
              (p.phone && p.phone.includes(q)) ||
              (p.email && p.email.toLowerCase().includes(q)) ||
              (p.gstin && p.gstin.toLowerCase().includes(q)) ||
              (p.address && p.address.toLowerCase().includes(q))
            );
          });

          return (
            <div>
              {/* Customer Dues & Ageing Summary Header (Section 13) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.85rem', marginBottom: '1.25rem' }}>
                <div className="card" style={{ padding: '1rem', borderLeft: '4px solid #f59e0b', margin: 0 }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
                    Total Outstanding Dues
                  </div>
                  <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: '#b45309', marginTop: '4px' }}>
                    {formatRupees(duesSummary?.totalDuesMinor || 0)}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '2px' }}>
                    Across all credit customers
                  </div>
                </div>

                <div className="card" style={{ padding: '1rem', borderLeft: '4px solid #10b981', margin: 0 }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
                    Total Advance Held
                  </div>
                  <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: '#10b981', marginTop: '4px' }}>
                    {formatRupees(duesSummary?.totalAdvanceMinor || 0)}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '2px' }}>
                    On-account credit balances
                  </div>
                </div>

                <div className="card" style={{ padding: '1rem', borderLeft: '4px solid #3b82f6', margin: 0 }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
                    Ageing: 0–30 Days
                  </div>
                  <div className="mono" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1d4ed8', marginTop: '4px' }}>
                    {formatRupees(duesSummary?.ageing['0_30'] || 0)}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '2px' }}>
                    Current month dues
                  </div>
                </div>

                <div className="card" style={{ padding: '1rem', borderLeft: '4px solid #f97316', margin: 0 }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
                    Ageing: 31–60 Days
                  </div>
                  <div className="mono" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#c2410c', marginTop: '4px' }}>
                    {formatRupees(duesSummary?.ageing['31_60'] || 0)}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '2px' }}>
                    Over 30 days pending
                  </div>
                </div>

                <div className="card" style={{ padding: '1rem', borderLeft: '4px solid #ef4444', margin: 0 }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
                    Ageing: 60+ Days
                  </div>
                  <div className="mono" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#b91c1c', marginTop: '4px' }}>
                    {formatRupees(duesSummary?.ageing['61_plus'] || 0)}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '2px' }}>
                    Follow up required
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-title" style={{ flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                  <div>
                    <span>Customer Master & Khata Accounts ({customersList.length} customers)</span>
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 400, marginTop: '2px' }}>
                      Customer credit limits, GSTINs, phone numbers and digital billing contacts
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                      type="text"
                      className="form-input"
                      style={{ width: '220px', padding: '0.45rem 0.75rem', fontSize: '0.85rem' }}
                      placeholder="Search customers by name, phone, GSTIN..."
                      value={customerFilterMaster}
                      onChange={(e) => setCustomerFilterMaster(e.target.value)}
                    />
                    <button className="btn btn-primary" onClick={() => openAddPartyModal('customer')}>
                      + Add Customer
                    </button>
                  </div>
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Customer Name</th>
                      <th>Phone</th>
                      <th>GSTIN</th>
                      <th>Khata Balance (Dues)</th>
                      <th>Credit Limit</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCustomers.map((p) => {
                      const dues = p.duesMinor ?? 0;
                      const adv = p.advanceMinor ?? 0;
                      return (
                        <tr key={p.id} style={{ opacity: p.active === false ? 0.6 : 1 }}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{p.name}</div>
                            {p.email && <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{p.email}</div>}
                          </td>
                          <td className="mono">{p.phone || '—'}</td>
                          <td className="mono">{p.gstin || '—'}</td>
                          <td>
                            {dues > 0 ? (
                              <div>
                                <div className="mono" style={{ fontWeight: 800, color: '#b45309' }}>
                                  {formatRupees(dues)}
                                </div>
                                {adv > 0 && (
                                  <div style={{ fontSize: '0.72rem', color: '#15803d', fontWeight: 600 }}>
                                    Adv: {formatRupees(adv)}
                                  </div>
                                )}
                              </div>
                            ) : adv > 0 ? (
                              <span className="badge badge-emerald" style={{ fontWeight: 700 }}>
                                Advance: {formatRupees(adv)}
                              </span>
                            ) : (
                              <span className="mono" style={{ color: '#94a3b8' }}>₹0.00</span>
                            )}
                          </td>
                          <td className="mono">{formatRupees(p.creditLimitMinor)}</td>
                          <td>
                            {p.active !== false ? (
                              <span className="badge badge-emerald">Active</span>
                            ) : (
                              <span className="badge badge-amber">Inactive</span>
                            )}
                          </td>
                          <td style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                            {dues > 0 ? (
                              <button
                                className="btn btn-primary"
                                style={{
                                  padding: '0.25rem 0.6rem',
                                  fontSize: '0.75rem',
                                  fontWeight: 700,
                                  background: '#f59e0b',
                                  borderColor: '#d97706',
                                }}
                                onClick={() => openCollectPayment(p)}
                                title="Collect payment towards dues"
                              >
                                💰 Collect
                              </button>
                            ) : (
                              <button
                                className="btn btn-secondary"
                                style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                                onClick={() => openCollectPayment(p)}
                                title="Record advance payment"
                              >
                                💰 Advance
                              </button>
                            )}
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', fontWeight: 600 }}
                              onClick={() => openCustomerLedger(p)}
                              title="View Customer Khata Statement & Ledger"
                            >
                              📖 Ledger
                            </button>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                              onClick={() => openEditPartyModal(p)}
                              title="Edit Customer"
                            >
                              ✏️ Edit
                            </button>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: p.active !== false ? '#f87171' : '#34d399' }}
                              onClick={() => handleTogglePartyActive(p)}
                            >
                              {p.active !== false ? 'Deactivate' : 'Activate'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredCustomers.length === 0 && (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                          No customers found matching your search.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* TAB: SUPPLIERS */}
        {activeTab === 'suppliers' && (() => {
          const suppliersList = parties.filter((p) => p.type === 'supplier');
          const filteredSuppliers = suppliersList.filter((p) => {
            if (!supplierFilterMaster.trim()) return true;
            const q = supplierFilterMaster.trim().toLowerCase();
            return (
              p.name.toLowerCase().includes(q) ||
              (p.phone && p.phone.includes(q)) ||
              (p.email && p.email.toLowerCase().includes(q)) ||
              (p.gstin && p.gstin.toLowerCase().includes(q)) ||
              (p.address && p.address.toLowerCase().includes(q))
            );
          });

          return (
            <div className="card">
              <div className="card-title" style={{ flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                <div>
                  <span>Supplier Master & Wholesale Vendors ({suppliersList.length} vendors for {shop?.name})</span>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 400, marginTop: '2px' }}>
                    Manage suppliers, purchase distributors, GSTIN verification and vendor credit limits
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="text"
                    className="form-input"
                    style={{ width: '220px', padding: '0.45rem 0.75rem', fontSize: '0.85rem' }}
                    placeholder="Search suppliers by name, phone, GSTIN..."
                    value={supplierFilterMaster}
                    onChange={(e) => setSupplierFilterMaster(e.target.value)}
                  />
                  <button className="btn btn-primary" onClick={() => openAddPartyModal('supplier')}>
                    + Add New Supplier
                  </button>
                </div>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Supplier / Vendor Name</th>
                    <th>Phone</th>
                    <th>GSTIN</th>
                    <th>Address</th>
                    <th>Outstanding Payable</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSuppliers.map((p) => (
                    <tr key={p.id} style={{ opacity: p.active === false ? 0.6 : 1 }}>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td className="mono">{p.phone || '—'}</td>
                      <td className="mono">{p.gstin || '—'}</td>
                      <td style={{ maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {p.address || '—'}
                      </td>
                      <td>
                        {(p.payableMinor || 0) > 0 ? (
                          <div>
                            <div className="mono" style={{ fontWeight: 700, color: '#ef4444' }}>
                              {formatRupees(p.payableMinor)}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                              {p.openPurchasesCount} open bill{p.openPurchasesCount && p.openPurchasesCount > 1 ? 's' : ''}
                              {p.oldestDueDate ? ` • due ${p.oldestDueDate}` : ''}
                            </div>
                          </div>
                        ) : (
                          <span className="badge badge-emerald" style={{ background: '#ecfdf5', color: '#059669', border: '1px solid #a7f3d0' }}>
                            No dues
                          </span>
                        )}
                      </td>
                      <td>
                        {p.active !== false ? (
                          <span className="badge badge-emerald">Active</span>
                        ) : (
                          <span className="badge badge-amber">Inactive</span>
                        )}
                      </td>
                      <td style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        {can(user?.role as any, 'purchases.pay') && (p.payableMinor || 0) > 0 && (
                          <button
                            className="btn btn-primary"
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', background: '#10b981', borderColor: '#10b981' }}
                            onClick={() => handleOpenPaySupplier(p)}
                            title="Pay this supplier oldest-purchase first (FIFO)"
                          >
                            💳 Pay Supplier
                          </button>
                        )}
                        {can(user?.role as any, 'purchases') && (
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                            onClick={() => handleOpenSupplierLedger(p.id)}
                            title="View chronological running payable ledger"
                          >
                            📖 Ledger
                          </button>
                        )}
                        {can(user?.role as any, 'purchases') && (
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                            onClick={() => openNewPurchaseModalForSupplier(p.id)}
                            title="Create new purchase with this supplier preselected"
                          >
                            📥 + Purchase
                          </button>
                        )}
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                          onClick={() => openEditPartyModal(p)}
                        >
                          ✏️ Edit
                        </button>
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: p.active !== false ? '#f87171' : '#34d399' }}
                          onClick={() => handleTogglePartyActive(p)}
                        >
                          {p.active !== false ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredSuppliers.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '2.5rem', color: '#94a3b8' }}>
                        <div>🚚 No suppliers registered yet.</div>
                        <button
                          className="btn btn-primary"
                          style={{ marginTop: '0.75rem' }}
                          onClick={() => openAddPartyModal('supplier')}
                        >
                          + Add Your First Supplier
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          );
        })()}

        {/* TAB: PURCHASES & STOCK INWARD */}
        {activeTab === 'purchases' && (() => {
          const filteredPurchases = purchases.filter((p) => {
            if (purchaseStatusFilter === 'voided') {
              if (p.status !== 'voided') return false;
            } else if (purchaseStatusFilter === 'unpaid') {
              if (p.status === 'voided' || (p.paidMinor || 0) > 0) return false;
            } else if (purchaseStatusFilter === 'partial') {
              if (p.status === 'voided' || (p.paidMinor || 0) === 0 || (p.balanceMinor || 0) === 0) return false;
            } else if (purchaseStatusFilter === 'paid') {
              if (p.status === 'voided' || (p.balanceMinor || 0) > 0) return false;
            }
            if (!purchaseSearch.trim()) return true;
            const q = purchaseSearch.trim().toLowerCase();
            return (
              (p.purchaseNumber && p.purchaseNumber.toLowerCase().includes(q)) ||
              (p.supplierInvoiceNumber && p.supplierInvoiceNumber.toLowerCase().includes(q)) ||
              (p.billNo && p.billNo.toLowerCase().includes(q)) ||
              (p.supplierName && p.supplierName.toLowerCase().includes(q)) ||
              (p.supplierGstin && p.supplierGstin.toLowerCase().includes(q)) ||
              (p.supplierPhone && p.supplierPhone.includes(q))
            );
          });

          const nonVoidedPurchases = purchases.filter((p) => p.status !== 'voided');
          const totalPurchasesVolume = nonVoidedPurchases.reduce((sum, p) => sum + (p.totalMinor || 0), 0);
          const totalItcRecorded = nonVoidedPurchases.reduce((sum, p) => sum + (p.itcMinor || 0), 0);
          const totalBalancePayable = nonVoidedPurchases.reduce((sum, p) => sum + (p.balanceMinor || 0), 0);
          const openBillsCount = nonVoidedPurchases.filter((p) => (p.balanceMinor || 0) > 0).length;

          return (
            <div>
              {/* Purchases Metric Cards */}
              <div className="kpi-grid" style={{ marginBottom: '1.25rem' }}>
                <div className="kpi-card">
                  <div className="kpi-icon" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#6366f1' }}>
                    📥
                  </div>
                  <div>
                    <div className="kpi-val mono" style={{ color: '#6366f1' }}>
                      {formatRupees(totalPurchasesVolume)}
                    </div>
                    <div className="kpi-label">Total Inward Stock Volume</div>
                  </div>
                </div>

                <div className="kpi-card">
                  <div className="kpi-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981' }}>
                    🏛️
                  </div>
                  <div>
                    <div className="kpi-val mono" style={{ color: '#10b981' }}>
                      {formatRupees(totalItcRecorded)}
                    </div>
                    <div className="kpi-label">Input Tax Credit (ITC) Recorded</div>
                  </div>
                </div>

                <div className="kpi-card">
                  <div className="kpi-icon" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}>
                    💳
                  </div>
                  <div>
                    <div className="kpi-val mono" style={{ color: '#ef4444' }}>
                      {formatRupees(totalBalancePayable)}
                    </div>
                    <div className="kpi-label">Supplier Payable Balance</div>
                  </div>
                </div>

                <div className="kpi-card">
                  <div className="kpi-icon" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}>
                    📑
                  </div>
                  <div>
                    <div className="kpi-val mono" style={{ color: '#f59e0b' }}>{openBillsCount}</div>
                    <div className="kpi-label">Open Supplier Bills</div>
                  </div>
                </div>
              </div>

              {/* Main Purchases Table Card */}
              <div className="card">
                <div className="card-title" style={{ flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
                  <div>
                    <span>Purchases & Stock Inward ({purchases.length} bills for {shop?.name})</span>
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 400, marginTop: '2px' }}>
                      Record supplier invoices, inward goods stock into ledger, and track input GST credit
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* Status Filter Tabs */}
                    <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: '8px', padding: '2px' }}>
                      {([
                        { id: 'ALL', label: 'All Bills' },
                        { id: 'unpaid', label: 'Unpaid' },
                        { id: 'partial', label: 'Part-Paid' },
                        { id: 'paid', label: 'Paid' },
                        { id: 'voided', label: 'Voided' },
                      ] as const).map((st) => (
                        <button
                          key={st.id}
                          type="button"
                          style={{
                            padding: '0.35rem 0.75rem',
                            fontSize: '0.8rem',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontWeight: 600,
                            background: purchaseStatusFilter === st.id ? '#ffffff' : 'transparent',
                            color: purchaseStatusFilter === st.id ? '#6d4aff' : '#64748b',
                            boxShadow: purchaseStatusFilter === st.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                          }}
                          onClick={() => setPurchaseStatusFilter(st.id)}
                        >
                          {st.label}
                        </button>
                      ))}
                    </div>

                    <input
                      type="text"
                      className="form-input"
                      style={{ width: '230px', padding: '0.45rem 0.75rem', fontSize: '0.85rem' }}
                      placeholder="Search bill #, supplier, invoice #..."
                      value={purchaseSearch}
                      onChange={(e) => setPurchaseSearch(e.target.value)}
                    />

                    <button className="btn btn-primary" onClick={() => openNewPurchaseModal()}>
                      + Inward Goods / New Bill
                    </button>
                  </div>
                </div>

                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Purchase # & Date</th>
                      <th>Supplier Invoice # & Date</th>
                      <th>Supplier / Vendor</th>
                      <th>Status</th>
                      <th>Taxable Amount</th>
                      <th>GST (ITC)</th>
                      <th>Total Amount</th>
                      <th>Paid / Balance</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPurchases.map((p) => {
                      const isVoided = p.status === 'voided';
                      const isPaid = !isVoided && (p.balanceMinor || 0) === 0;
                      const isPartPaid = !isVoided && (p.paidMinor || 0) > 0 && (p.balanceMinor || 0) > 0;
                      const isUnpaid = !isVoided && (p.paidMinor || 0) === 0;

                      return (
                        <tr key={p.id} style={{ opacity: isVoided ? 0.65 : 1 }}>
                          <td>
                            <div style={{ fontWeight: 700, color: isVoided ? '#94a3b8' : '#6d4aff' }}>
                              {p.purchaseNumber || (p.billNo ? `#${p.billNo}` : `Ref: ${p.id.slice(-6)}`)}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                              {p.purchaseDate || p.bdate || (p.createdAt ? new Date(p.createdAt).toISOString().slice(0, 10) : '—')}
                            </div>
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{p.supplierInvoiceNumber || p.billNo || '—'}</div>
                            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                              {p.supplierInvoiceDate || p.bdate || '—'}
                            </div>
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{p.supplierName || 'Unknown Supplier'}</div>
                            {p.supplierGstin ? (
                              <div className="mono" style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                GSTIN: {p.supplierGstin}
                              </div>
                            ) : (
                              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Unregistered Supplier</div>
                            )}
                            {p.supplierPhone && (
                              <div className="mono" style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                                📞 {p.supplierPhone}
                              </div>
                            )}
                          </td>
                          <td>
                            {isVoided ? (
                              <span
                                className="badge"
                                style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}
                                title={p.voidReason ? `Voided: ${p.voidReason}` : 'Voided'}
                              >
                                ✕ Voided
                              </span>
                            ) : isPaid ? (
                              <span className="badge badge-emerald">
                                ✓ Paid
                              </span>
                            ) : isPartPaid ? (
                              <span className="badge badge-amber">
                                ⏳ Part-Paid
                              </span>
                            ) : (
                              <span className="badge" style={{ background: '#fff1f2', color: '#e11d48', border: '1px solid #fecdd3' }}>
                                ⚠️ Unpaid
                              </span>
                            )}
                          </td>
                          <td className="mono">{formatRupees(p.taxableMinor)}</td>
                          <td className="mono" style={{ color: '#6366f1' }}>
                            {formatRupees(p.itcMinor ?? (p.cgstMinor + p.sgstMinor + p.igstMinor))}
                          </td>
                          <td className="mono" style={{ fontWeight: 700, color: '#1e1b4b' }}>
                            {formatRupees(p.totalMinor)}
                          </td>
                          <td>
                            <div className="mono" style={{ color: '#10b981', fontSize: '0.85rem' }}>
                              Paid: {formatRupees(p.paidMinor)}
                            </div>
                            {(p.balanceMinor || 0) > 0 && !isVoided && (
                              <div className="mono" style={{ color: '#ef4444', fontSize: '0.8rem', fontWeight: 600 }}>
                                Bal: {formatRupees(p.balanceMinor)}
                              </div>
                            )}
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                                onClick={() => handleViewPurchaseDetails(p.id)}
                              >
                                👁️ View
                              </button>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                                onClick={() => window.open(`/api/purchases/${p.id}/print?format=a4`, '_blank')}
                                title="Print A4 Purchase Document"
                              >
                                📄 Print
                              </button>
                              {!isVoided && (p.balanceMinor || 0) > 0 && can(user?.role as any, 'purchases.pay') && (
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', background: '#10b981', borderColor: '#10b981' }}
                                  onClick={() => {
                                    const sup = parties.find((part) => part.id === p.supplierId);
                                    if (sup) {
                                      handleOpenPaySupplier(sup);
                                    } else {
                                      handleOpenPaySupplier({
                                        id: p.supplierId,
                                        name: p.supplierName || 'Supplier',
                                        phone: p.supplierPhone,
                                        payableMinor: p.balanceMinor,
                                        openPurchasesCount: 1,
                                        type: 'supplier',
                                        creditLimitMinor: 0,
                                      });
                                    }
                                  }}
                                  title="Pay supplier balance"
                                >
                                  💳 Pay
                                </button>
                              )}
                              {!isVoided && can(user?.role as any, 'purchases.void') && (
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: '#ef4444' }}
                                  onClick={() => handleOpenVoidPurchase(p)}
                                  title="Void this purchase and reverse stock inward"
                                >
                                  🗑️ Void
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {filteredPurchases.length === 0 && (
                      <tr>
                        <td colSpan={9} style={{ textAlign: 'center', padding: '2.5rem', color: '#94a3b8' }}>
                          <div>📥 No purchase bills found matching your filter.</div>
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ marginTop: '0.75rem' }}
                            onClick={() => openNewPurchaseModal()}
                          >
                            + Record Your First Purchase Bill
                          </button>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* TAB 5: REPORTS & ANALYTICS */}
        {activeTab === 'reports' && report && (
          <div>
            {/* KPI Cards */}
            <div className="kpi-grid">
              <div className="kpi-card">
                <div className="kpi-icon" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981' }}>
                  💰
                </div>
                <div>
                  <div className="kpi-val mono" style={{ color: '#10b981' }}>
                    {formatRupees(report.today.totalMinor)}
                  </div>
                  <div className="kpi-label">Today's Revenue ({shop?.name})</div>
                </div>
              </div>

              <div className="kpi-card">
                <div className="kpi-icon" style={{ background: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6' }}>
                  🧾
                </div>
                <div>
                  <div className="kpi-val mono">{report.today.billCount}</div>
                  <div className="kpi-label">Bills Generated Today</div>
                </div>
              </div>

              <div className="kpi-card">
                <div className="kpi-icon" style={{ background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}>
                  🏛️
                </div>
                <div>
                  <div className="kpi-val mono">{formatRupees(report.today.gstMinor)}</div>
                  <div className="kpi-label">GST Collected Today</div>
                </div>
              </div>

              <div className="kpi-card">
                <div className="kpi-icon" style={{ background: 'rgba(234, 88, 12, 0.15)', color: '#ea580c' }}>
                  📥
                </div>
                <div>
                  <div className="kpi-val mono" style={{ color: '#ea580c' }}>
                    {formatRupees(report.today.khataCollectionsMinor || 0)}
                  </div>
                  <div className="kpi-label">Today's Khata Collections</div>
                </div>
              </div>

              <div className="kpi-card">
                <div className="kpi-icon" style={{ background: 'rgba(139, 92, 246, 0.15)', color: '#8b5cf6' }}>
                  📦
                </div>
                <div>
                  <div className="kpi-val mono">{report.overall.itemCount}</div>
                  <div className="kpi-label">Active SKUs in Catalog</div>
                </div>
              </div>
            </div>

            {/* Top Items & Payment Breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
              <div className="card">
                <div className="card-title">Top Selling Products in {shop?.name}</div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Qty Sold</th>
                      <th>Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.topItems.map((item, idx) => (
                      <tr key={idx}>
                        <td style={{ fontWeight: 600 }}>{item.name}</td>
                        <td className="mono">{item.qtyMilli / 1000} units</td>
                        <td className="mono" style={{ color: '#6d4aff', fontWeight: 700 }}>
                          {formatRupees(item.totalMinor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="card">
                <div className="card-title">Payment Method Breakdown</div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Method</th>
                      <th>Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.paymentBreakdown.map((pay, idx) => (
                      <tr key={idx}>
                        <td style={{ textTransform: 'capitalize', fontWeight: 600 }}>{pay.method}</td>
                        <td className="mono" style={{ color: '#10b981', fontWeight: 700 }}>
                          {formatRupees(pay.totalMinor)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Customer Dues Summary & Top Outstanding Accounts (Section 13) */}
            <div className="card" style={{ marginTop: '1.25rem' }}>
              <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <span>Customer Outstanding Dues & Ageing Report</span>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 400, marginTop: '2px' }}>
                    Total outstanding dues: <b style={{ color: '#b45309' }}>{formatRupees(duesSummary?.totalDuesMinor || 0)}</b> across credit customers | Total advance held: <b style={{ color: '#10b981' }}>{formatRupees(duesSummary?.totalAdvanceMinor || 0)}</b>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <span className="badge badge-emerald">0-30d: {formatRupees(duesSummary?.ageing['0_30'] || 0)}</span>
                  <span className="badge badge-amber">31-60d: {formatRupees(duesSummary?.ageing['31_60'] || 0)}</span>
                  <span className="badge" style={{ background: '#fee2e2', color: '#b91c1c' }}>60+d: {formatRupees(duesSummary?.ageing['61_plus'] || 0)}</span>
                </div>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Customer Name</th>
                    <th>Phone</th>
                    <th>Oldest Unpaid Bill</th>
                    <th>Outstanding Dues</th>
                    <th>Advance Held</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(duesSummary?.topDebtors || []).map((debtor) => (
                    <tr key={debtor.id}>
                      <td style={{ fontWeight: 600 }}>{debtor.name}</td>
                      <td className="mono">{debtor.phone || '—'}</td>
                      <td>{debtor.oldestInvoiceDate ? new Date(debtor.oldestInvoiceDate).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—'}</td>
                      <td className="mono" style={{ fontWeight: 800, color: '#b45309' }}>
                        {formatRupees(debtor.duesMinor)}
                      </td>
                      <td className="mono">{debtor.advanceMinor > 0 ? formatRupees(debtor.advanceMinor) : '—'}</td>
                      <td>
                        <button
                          className="btn btn-primary"
                          style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', fontWeight: 700, background: '#f59e0b', borderColor: '#d97706' }}
                          onClick={() => {
                            const partyObj = parties.find((p) => p.id === debtor.id) || {
                              id: debtor.id,
                              name: debtor.name,
                              phone: debtor.phone,
                              type: 'customer',
                              creditLimitMinor: 0,
                            };
                            openCollectPayment(partyObj);
                          }}
                        >
                          💰 Collect Payment
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(!duesSummary?.topDebtors || duesSummary.topDebtors.length === 0) && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '1.5rem', color: '#94a3b8' }}>
                        No pending customer dues. All Khata accounts are clear!
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 6: SETTINGS & BUSINESS CONFIGURATION PACKS */}
        {activeTab === 'settings' && (
          <div>
            {/* Section 1: Business Profile Editor */}
            <div className="card settings-section">
              <div className="card-title">
                <span>⚙️ Active Store Configuration & Profile</span>
                <span className={`biz-badge biz-${shop?.businessType}`}>
                  Current: {getBusinessLabel(shop?.businessType)}
                </span>
              </div>

              {settingsSavedMsg && (
                <div style={{ background: 'rgba(16, 185, 129, 0.2)', border: '1px solid #10b981', color: '#6ee7b7', padding: '0.6rem 1rem', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '1rem' }}>
                  ✓ {settingsSavedMsg}
                </div>
              )}

              <form onSubmit={handleSaveSettings}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">Store / Enterprise Name</label>
                    <input
                      type="text"
                      className="form-input"
                      required
                      value={settingsName}
                      onChange={(e) => setSettingsName(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Business Type (Switches POS Features)</label>
                    <select
                      className="form-input"
                      value={settingsType}
                      onChange={(e) => setSettingsType(e.target.value)}
                    >
                      <option value="retail">🛒 Retail / Kirana / Supermarket</option>
                      <option value="pharmacy">💊 Pharmacy & Healthcare</option>
                      <option value="restaurant">🍽️ Restaurant / Cafe / Bakery</option>
                      <option value="wholesale">📦 Wholesale & Distribution</option>
                      <option value="service">💼 Professional & Technical Services</option>
                      <option value="general">🏢 General Business</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">GSTIN (15-digit GST Number)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={settingsGstin}
                      onChange={(e) => setSettingsGstin(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Phone / WhatsApp Number</label>
                    <input
                      type="text"
                      className="form-input"
                      value={settingsPhone}
                      onChange={(e) => setSettingsPhone(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Store Address</label>
                    <input
                      type="text"
                      className="form-input"
                      value={settingsAddress}
                      onChange={(e) => setSettingsAddress(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">UPI ID for Payment QR (VPA)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={settingsUpiId}
                      onChange={(e) => setSettingsUpiId(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Invoice Number Prefix</label>
                    <input
                      type="text"
                      className="form-input"
                      value={settingsPrefix}
                      onChange={(e) => setSettingsPrefix(e.target.value)}
                    />
                  </div>
                </div>
                <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="submit" className="btn btn-primary" style={{ padding: '0.6rem 1.25rem' }}>
                    Save Profile Changes
                  </button>
                </div>
              </form>
            </div>

            {/* WhatsApp Bill Sharing Settings Card (Section 9.1) */}
            <div className="card settings-section">
              <div className="card-title">
                <span>📲 WhatsApp Bill Sharing</span>
                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                  Configure click-to-chat WhatsApp receipts for POS checkout and invoice resends
                </span>
              </div>

              <form onSubmit={handleSaveSettings}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
                  {/* Enable WhatsApp sharing */}
                  <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: user?.role === 'owner' ? 'pointer' : 'default' }}>
                      <input
                        type="checkbox"
                        style={{ width: '18px', height: '18px', marginTop: '2px', accentColor: '#16a34a' }}
                        disabled={user?.role !== 'owner'}
                        checked={settingsWhatsAppEnabled}
                        onChange={(e) => setSettingsWhatsAppEnabled(e.target.checked)}
                      />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Enable WhatsApp Sharing</div>
                        <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '2px' }}>
                          When enabled, shows WhatsApp block in checkout modal and resend button on invoices.
                        </div>
                      </div>
                    </label>
                  </div>

                  {/* Default message language */}
                  <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <label className="form-label" style={{ marginBottom: '0.4rem', fontWeight: 600 }}>
                      Default Message Language
                    </label>
                    <select
                      className="form-input"
                      disabled={user?.role !== 'owner'}
                      value={settingsWhatsAppDefaultLang}
                      onChange={(e) => setSettingsWhatsAppDefaultLang(e.target.value as any)}
                    >
                      <option value="en">English (Default)</option>
                      <option value="hi">हिन्दी (Hindi)</option>
                      <option value="ta">தமிழ் (Tamil)</option>
                    </select>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>
                      Pre-selected language for checkout success modal and resend popover
                    </div>
                  </div>

                  {/* Include bill link in message */}
                  <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: user?.role === 'owner' ? 'pointer' : 'default' }}>
                      <input
                        type="checkbox"
                        style={{ width: '18px', height: '18px', marginTop: '2px', accentColor: '#16a34a' }}
                        disabled={user?.role !== 'owner'}
                        checked={settingsWhatsAppIncludeLink}
                        onChange={(e) => setSettingsWhatsAppIncludeLink(e.target.checked)}
                      />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Include Hosted Bill Link</div>
                        <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '2px' }}>
                          Adds a direct link for customer to view / download the full bill online without logging in.
                        </div>
                      </div>
                    </label>
                  </div>
                </div>

                {user?.role !== 'owner' ? (
                  <div style={{ fontSize: '0.85rem', color: '#b45309', background: '#fffbeb', padding: '0.6rem 0.85rem', borderRadius: '6px', border: '1px solid #fef3c7' }}>
                    ℹ️ Only business owners can change WhatsApp Bill Sharing settings.
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="submit" className="btn btn-primary" style={{ padding: '0.55rem 1.25rem' }}>
                      Save Bill Sharing Settings
                    </button>
                  </div>
                )}
              </form>
            </div>

            {/* Section 2: Explore Industry Packs */}
            <div className="card settings-section">
              <div className="card-title">
                <span>📦 Pre-Configured Industry Business Packs</span>
                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                  Switch your business instantly into any specialized industry flow
                </span>
              </div>

              <div className="settings-grid">
                {/* Pack 1: Retail */}
                <div className={`pack-card ${shop?.businessType === 'retail' ? 'active-pack' : ''}`}>
                  <div>
                    <div className="pack-card-header">
                      <span className="pack-card-title">🛒 Retail & Kirana</span>
                      <span className="biz-badge biz-retail">Thermal 80mm</span>
                    </div>
                    <p className="pack-card-desc">
                      Fast counter barcode checkout, thermal slips, instant UPI scan & pay, cash drawer integration.
                    </p>
                    <ul className="pack-features-list">
                      <li>✓ Rapid barcode scanner & SKU lookup</li>
                      <li>✓ Thermal 80mm / 58mm compact receipts</li>
                      <li>✓ Dynamic UPI QR code on bill</li>
                      <li>✓ Cashier discount safeguard limits</li>
                    </ul>
                  </div>
                  <button
                    className={`btn ${shop?.businessType === 'retail' ? 'btn-secondary' : 'btn-primary'}`}
                    disabled={shop?.businessType === 'retail'}
                    onClick={() => handleSwitchPackType('retail')}
                  >
                    {shop?.businessType === 'retail' ? '✓ Currently Active' : 'Activate Retail Mode'}
                  </button>
                </div>

                {/* Pack 2: Pharmacy */}
                <div className={`pack-card ${shop?.businessType === 'pharmacy' ? 'active-pack' : ''}`}>
                  <div>
                    <div className="pack-card-header">
                      <span className="pack-card-title">💊 Pharmacy & Medicals</span>
                      <span className="biz-badge biz-pharmacy">Drug License</span>
                    </div>
                    <p className="pack-card-desc">
                      Batch number & expiry date tracking (FEFO), doctor name on bills, Drug License display, Schedule H/H1 alerts.
                    </p>
                    <ul className="pack-features-list">
                      <li>✓ Batch number and expiry date on every line</li>
                      <li>✓ Schedule H & H1 warning tags on medicines</li>
                      <li>✓ Doctor name & prescription reference</li>
                      <li>✓ Rack & shelf storage location finder</li>
                    </ul>
                  </div>
                  <button
                    className={`btn ${shop?.businessType === 'pharmacy' ? 'btn-secondary' : 'btn-primary'}`}
                    disabled={shop?.businessType === 'pharmacy'}
                    onClick={() => handleSwitchPackType('pharmacy')}
                  >
                    {shop?.businessType === 'pharmacy' ? '✓ Currently Active' : 'Activate Pharmacy Mode'}
                  </button>
                </div>

                {/* Pack 3: Restaurant */}
                <div className={`pack-card ${shop?.businessType === 'restaurant' ? 'active-pack' : ''}`}>
                  <div>
                    <div className="pack-card-header">
                      <span className="pack-card-title">🍽️ Restaurant & Cafe</span>
                      <span className="biz-badge biz-restaurant">Table & KOT</span>
                    </div>
                    <p className="pack-card-desc">
                      Table management, Kitchen Order Tickets (KOT), Dine-in / Takeaway / Delivery options, 5% Food GST.
                    </p>
                    <ul className="pack-features-list">
                      <li>✓ Table 1-12 selector & Dine-in / Takeaway modes</li>
                      <li>✓ One-click Kitchen Order Ticket (KOT) print</li>
                      <li>✓ Split food menu categories & fast tiffin counter</li>
                      <li>✓ Flexible negative stock for kitchen prep</li>
                    </ul>
                  </div>
                  <button
                    className={`btn ${shop?.businessType === 'restaurant' ? 'btn-secondary' : 'btn-primary'}`}
                    disabled={shop?.businessType === 'restaurant'}
                    onClick={() => handleSwitchPackType('restaurant')}
                  >
                    {shop?.businessType === 'restaurant' ? '✓ Currently Active' : 'Activate Restaurant Mode'}
                  </button>
                </div>

                {/* Pack 4: Wholesale */}
                <div className={`pack-card ${shop?.businessType === 'wholesale' ? 'active-pack' : ''}`}>
                  <div>
                    <div className="pack-card-header">
                      <span className="pack-card-title">📦 Wholesale & B2B</span>
                      <span className="biz-badge biz-wholesale">A4 GST Invoices</span>
                    </div>
                    <p className="pack-card-desc">
                      B2B sales, PO numbers, vehicle tracking, delivery routes, customer credit limits, HSN compliance.
                    </p>
                    <ul className="pack-features-list">
                      <li>✓ B2B A4 GST Tax Invoice layout with terms</li>
                      <li>✓ Purchase Order (PO) & transport vehicle number</li>
                      <li>✓ Customer Khata balance & credit limit locks</li>
                      <li>✓ Bulk carton & sack unit measures</li>
                    </ul>
                  </div>
                  <button
                    className={`btn ${shop?.businessType === 'wholesale' ? 'btn-secondary' : 'btn-primary'}`}
                    disabled={shop?.businessType === 'wholesale'}
                    onClick={() => handleSwitchPackType('wholesale')}
                  >
                    {shop?.businessType === 'wholesale' ? '✓ Currently Active' : 'Activate Wholesale Mode'}
                  </button>
                </div>

                {/* Pack 5: Services */}
                <div className={`pack-card ${shop?.businessType === 'service' ? 'active-pack' : ''}`}>
                  <div>
                    <div className="pack-card-header">
                      <span className="pack-card-title">💼 Professional Services</span>
                      <span className="biz-badge biz-service">SAC & Due Dates</span>
                    </div>
                    <p className="pack-card-desc">
                      Time & project based billing, SAC codes (998314 etc.), job reference numbers, payment due dates.
                    </p>
                    <ul className="pack-features-list">
                      <li>✓ Hourly, monthly AMC and milestone billing units</li>
                      <li>✓ SAC code tax reporting (18% GST)</li>
                      <li>✓ Job / Project reference tracking</li>
                      <li>✓ Payment due date (Net 15/30) printed on bill</li>
                    </ul>
                  </div>
                  <button
                    className={`btn ${shop?.businessType === 'service' ? 'btn-secondary' : 'btn-primary'}`}
                    disabled={shop?.businessType === 'service'}
                    onClick={() => handleSwitchPackType('service')}
                  >
                    {shop?.businessType === 'service' ? '✓ Currently Active' : 'Activate Services Mode'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Strict Multi-Tenant Data Isolation Banner (Screen 9 Footer inside main content) */}
        <StrictIsolationBanner />
      </main>

      {/* PRINT RECEIPT MODAL */}
      {printModalInvoiceId && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '440px', background: '#ffffff', color: '#111827' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem', borderBottom: '1px solid #e5e7eb', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#111827' }}>Invoice Receipt Preview</h3>
              <button
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#6b7280' }}
                onClick={() => setPrintModalInvoiceId(null)}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: '0.5rem', maxHeight: '520px', overflowY: 'auto' }}>
              <iframe
                src={`/api/invoices/${printModalInvoiceId}/print?paper=thermal80`}
                style={{ width: '100%', height: '480px', border: 'none' }}
                title="Thermal Receipt"
              />
            </div>
            <div style={{ padding: '0.75rem 1rem', display: 'flex', gap: '0.5rem', borderTop: '1px solid #e5e7eb' }}>
              <a
                href={`/api/invoices/${printModalInvoiceId}/print?paper=thermal80&autoprint=true`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-primary"
                style={{ flex: 1, textDecoration: 'none', textAlign: 'center' }}
              >
                🖨️ Thermal Slip
              </a>
              <a
                href={`/api/invoices/${printModalInvoiceId}/print?paper=a4`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary"
                style={{ flex: 1, textDecoration: 'none', textAlign: 'center' }}
              >
                📄 A4 GST Copy
              </a>
              <button
                className="btn btn-secondary"
                onClick={() => setPrintModalInvoiceId(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}



      {/* MASTER DATA: ADD / EDIT ITEM MODAL */}
      {showItemModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <div>
                <h3 className="card-title" style={{ margin: 0 }}>
                  {editingItem ? `✏️ Edit Product: ${editingItem.name}` : `📦 Add New Item to ${shop?.name}`}
                </h3>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '2px' }}>
                  {editingItem ? 'Update product details, pricing, tax rates and units' : 'Register a new item with unit, tax rate, and opening stock'}
                </div>
              </div>
              <button
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.2rem', cursor: 'pointer' }}
                onClick={() => setShowItemModal(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveItem} className="modal-body">
              <div className="form-group">
                <label className="form-label">Product / Item Name *</label>
                <input
                  type="text"
                  className="form-input"
                  required
                  value={itemFormName}
                  onChange={(e) => setItemFormName(e.target.value)}
                  placeholder="e.g. Paracetamol 650mg / Basmati Rice 1kg"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">SKU / Item Code</label>
                  <input
                    type="text"
                    className="form-input"
                    value={itemFormSku}
                    onChange={(e) => setItemFormSku(e.target.value)}
                    placeholder="e.g. MED-001 or GROC-100"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Barcode / EAN</label>
                  <input
                    type="text"
                    className="form-input"
                    value={itemFormBarcode}
                    onChange={(e) => setItemFormBarcode(e.target.value)}
                    placeholder="Scan or enter barcode"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Category</label>
                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                    <select
                      className="form-input"
                      value={itemFormCategory}
                      onChange={(e) => setItemFormCategory(e.target.value)}
                    >
                      <option value="">Select or Type Category...</option>
                      {categoriesList.filter((c) => c.active).map((c) => (
                        <option key={c.id} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                  <input
                    type="text"
                    className="form-input"
                    style={{ marginTop: '0.35rem', fontSize: '0.8rem' }}
                    placeholder="Or type custom category name..."
                    value={itemFormCategory}
                    onChange={(e) => setItemFormCategory(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Unit of Measurement (UOM) *</label>
                  <select
                    className="form-input"
                    value={itemFormUnit}
                    onChange={(e) => setItemFormUnit(e.target.value)}
                    required
                  >
                    {STANDARD_UNITS.map((u) => (
                      <option key={u.code} value={u.code}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Selling Price (₹) *</label>
                  <input
                    type="number"
                    step="0.01"
                    className="form-input"
                    required
                    value={itemFormPrice}
                    onChange={(e) => setItemFormPrice(e.target.value)}
                    placeholder="e.g. 150.00"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Purchase / Cost Price (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="form-input"
                    value={itemFormCost}
                    onChange={(e) => setItemFormCost(e.target.value)}
                    placeholder="e.g. 120.00"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">HSN / SAC Code</label>
                  <input
                    type="text"
                    className="form-input"
                    value={itemFormHsn}
                    onChange={(e) => setItemFormHsn(e.target.value)}
                    placeholder="e.g. 3004 for medicines, 1006 for rice"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">GST Tax Rate</label>
                  <select
                    className="form-input"
                    value={itemFormTax}
                    onChange={(e) => setItemFormTax(e.target.value)}
                  >
                    <option value="0">0% (Nil / Exempt)</option>
                    <option value="500">5% GST (2.5% CGST + 2.5% SGST)</option>
                    <option value="1200">12% GST (6% CGST + 6% SGST)</option>
                    <option value="1800">18% GST (9% CGST + 9% SGST)</option>
                    <option value="2800">28% GST (14% CGST + 14% SGST)</option>
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                <input
                  type="checkbox"
                  id="itemTaxInclusive"
                  checked={itemFormTaxInclusive}
                  onChange={(e) => setItemFormTaxInclusive(e.target.checked)}
                />
                <label htmlFor="itemTaxInclusive" style={{ fontSize: '0.9rem', color: '#cbd5e1', cursor: 'pointer' }}>
                  Selling price is inclusive of GST (recommended for retail / grocery)
                </label>
              </div>

              {!editingItem ? (
                <div className="form-group" style={{ background: 'rgba(255,255,255,0.03)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Initial Opening Stock Quantity ({itemFormUnit})</span>
                    <span style={{ color: '#10b981', fontWeight: 600 }}>Ledger Tracked</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    className="form-input"
                    value={itemFormStock}
                    onChange={(e) => setItemFormStock(e.target.value)}
                    placeholder="e.g. 50"
                  />
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.35rem' }}>
                    Note: An opening stock ledger entry will be posted once upon creation.
                  </div>
                </div>
              ) : (
                <div style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', padding: '0.75rem', borderRadius: '8px', fontSize: '0.85rem', color: '#93c5fd' }}>
                  ℹ️ Current Ledger Stock: <strong>{editingItem.currentStockMilli / 1000} {editingItem.unit}</strong>.
                  Opening stock cannot be modified here to protect stock movement audit history.
                </div>
              )}

              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #334155', borderRadius: '8px', padding: '0.85rem', marginTop: '1rem' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f8fafc', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span>🏬 Inventory Alert & Reorder Settings</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>Reorder Level Threshold ({itemFormUnit})</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      className="form-input"
                      value={itemFormReorder}
                      onChange={(e) => setItemFormReorder(e.target.value)}
                      placeholder="e.g. 10 (0 = disabled)"
                    />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '0.75rem' }}>Minimum Buffer Stock ({itemFormUnit})</label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      className="form-input"
                      value={itemFormMinStock}
                      onChange={(e) => setItemFormMinStock(e.target.value)}
                      placeholder="e.g. 5"
                    />
                  </div>
                </div>
                <div className="form-group" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: '0.75rem' }}>Preferred Supplier (for Replenishment)</label>
                  <select
                    className="form-input"
                    value={itemFormSupplierId}
                    onChange={(e) => setItemFormSupplierId(e.target.value)}
                  >
                    <option value="">No Preferred Supplier Assigned</option>
                    {parties.filter((p) => p.type === 'supplier' && p.active !== false).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} {p.phone ? `(${p.phone})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowItemModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingItem ? 'Save Changes' : 'Save Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MASTER DATA: ADD / EDIT PARTY MODAL (CUSTOMERS & SUPPLIERS) */}
      {showPartyModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '540px' }}>
            <div className="modal-header">
              <div>
                <h3 className="card-title" style={{ margin: 0 }}>
                  {editingParty
                    ? `✏️ Edit ${partyModalType === 'supplier' ? 'Supplier' : 'Customer'}: ${editingParty.name}`
                    : `+ Add New ${partyModalType === 'supplier' ? 'Supplier / Vendor' : 'Customer / Khata Account'}`}
                </h3>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '2px' }}>
                  {partyModalType === 'supplier'
                    ? 'Enter supplier contact, GSTIN, and business address'
                    : 'Customer contact details, phone for digital bills, and credit limit'}
                </div>
              </div>
              <button
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.2rem', cursor: 'pointer' }}
                onClick={() => setShowPartyModal(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSaveParty} className="modal-body">
              <div className="form-group">
                <label className="form-label">
                  {partyModalType === 'supplier' ? 'Supplier / Vendor Business Name *' : 'Customer / Business Name *'}
                </label>
                <input
                  type="text"
                  className="form-input"
                  required
                  value={partyFormName}
                  onChange={(e) => setPartyFormName(e.target.value)}
                  placeholder={partyModalType === 'supplier' ? 'e.g. Metro Wholesale Distributors' : 'e.g. Rajesh Kumar'}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Mobile Phone Number</label>
                  <input
                    type="tel"
                    className="form-input"
                    value={partyFormPhone}
                    onChange={(e) => setPartyFormPhone(e.target.value)}
                    placeholder="10-digit mobile, e.g. 9840123456"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Email Address</label>
                  <input
                    type="email"
                    className="form-input"
                    value={partyFormEmail}
                    onChange={(e) => setPartyFormEmail(e.target.value)}
                    placeholder="name@example.com"
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">GSTIN (Optional for B2B)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={partyFormGstin}
                    onChange={(e) => setPartyFormGstin(e.target.value.toUpperCase())}
                    placeholder="15-digit GSTIN (e.g. 33AAAAA...)"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">
                    {partyModalType === 'supplier' ? 'Credit / Balance Limit (₹)' : 'Credit Limit / Khata Max (₹)'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    className="form-input"
                    value={partyFormCreditLimit}
                    onChange={(e) => setPartyFormCreditLimit(e.target.value)}
                    placeholder="e.g. 50000.00"
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Billing / Physical Address</label>
                <textarea
                  className="form-input"
                  rows={3}
                  value={partyFormAddress}
                  onChange={(e) => setPartyFormAddress(e.target.value)}
                  placeholder="Street address, city, pincode..."
                  style={{ resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowPartyModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingParty ? 'Save Changes' : partyModalType === 'supplier' ? 'Save Supplier' : 'Save Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MASTER DATA: CATEGORIES MANAGER MODAL */}
      {showCategoryModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '640px' }}>
            <div className="modal-header">
              <div>
                <h3 className="card-title" style={{ margin: 0 }}>🏷️ Product Categories Manager</h3>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '2px' }}>
                  Organize your inventory with categories and track live item counts
                </div>
              </div>
              <button
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.2rem', cursor: 'pointer' }}
                onClick={() => setShowCategoryModal(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              {/* Add Category Quick Form */}
              <form
                onSubmit={handleCreateCategory}
                style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', background: 'rgba(255,255,255,0.03)', padding: '0.75rem', borderRadius: '8px' }}
              >
                <input
                  type="text"
                  className="form-input"
                  style={{ flex: 1 }}
                  required
                  placeholder="New category name (e.g. Beverages, Dairy, Pulses)..."
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                />
                <input
                  type="text"
                  className="form-input"
                  style={{ flex: 1 }}
                  placeholder="Optional description..."
                  value={newCatDesc}
                  onChange={(e) => setNewCatDesc(e.target.value)}
                />
                <button type="submit" className="btn btn-primary" style={{ whiteSpace: 'nowrap' }}>
                  + Add Category
                </button>
              </form>

              {/* Categories Table */}
              <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
                <table className="data-table" style={{ fontSize: '0.85rem' }}>
                  <thead>
                    <tr>
                      <th>Category Name</th>
                      <th>Description</th>
                      <th>Items Count</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoriesList.map((cat) => (
                      <tr key={cat.id} style={{ opacity: !cat.active ? 0.6 : 1 }}>
                        <td style={{ fontWeight: 600 }}>
                          {editingCatId === cat.id ? (
                            <input
                              type="text"
                              className="form-input"
                              style={{ padding: '0.2rem 0.4rem', fontSize: '0.85rem' }}
                              value={editingCatName}
                              onChange={(e) => setEditingCatName(e.target.value)}
                            />
                          ) : (
                            cat.name
                          )}
                        </td>
                        <td style={{ color: '#94a3b8' }}>
                          {editingCatId === cat.id ? (
                            <input
                              type="text"
                              className="form-input"
                              style={{ padding: '0.2rem 0.4rem', fontSize: '0.85rem' }}
                              value={editingCatDesc}
                              onChange={(e) => setEditingCatDesc(e.target.value)}
                            />
                          ) : (
                            cat.description || '—'
                          )}
                        </td>
                        <td>
                          <span className="badge badge-blue">
                            {cat.itemCount || 0} products
                          </span>
                        </td>
                        <td>
                          {cat.active ? (
                            <span className="badge badge-emerald">Active</span>
                          ) : (
                            <span className="badge badge-amber">Inactive</span>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.35rem' }}>
                            {editingCatId === cat.id ? (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-primary"
                                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                                  onClick={() => handleUpdateCategory(cat.id)}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                                  onClick={() => setEditingCatId(null)}
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                                  onClick={() => {
                                    setEditingCatId(cat.id);
                                    setEditingCatName(cat.name);
                                    setEditingCatDesc(cat.description || '');
                                  }}
                                >
                                  ✏️
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', color: cat.active ? '#f87171' : '#34d399' }}
                                  onClick={() => handleToggleCategoryActive(cat)}
                                >
                                  {cat.active ? 'Deactivate' : 'Activate'}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {categoriesList.length === 0 && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: '1.5rem', color: '#94a3b8' }}>
                          No categories defined yet. Add one above!
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowCategoryModal(false)}>
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PURCHASES: NEW PURCHASE BILL & STOCK INWARD MODAL (SECTION 5) */}
      {showPurchaseModal && (() => {
        const suppliersList = parties.filter((p) => p.type === 'supplier');
        const selectedSupplier = suppliersList.find((s) => s.id === purSupplierId);

        // Map UI lines to calculation inputs
        const linesCalcInput = purLines.map((l) => ({
          itemId: l.itemId,
          name: l.name,
          unit: l.unit,
          billedQtyMilli: Math.max(1, Math.round((l.billedQty || l.receivedQty) * 1000)),
          receivedQtyMilli: Math.max(0, Math.round(l.receivedQty * 1000)),
          costMinor: Math.max(0, Math.round(l.costRupees * 100)),
          discountMinor: Math.max(0, Math.round(l.discountRupees * 100)),
          taxRateBp: l.taxRateBp,
          batchNo: l.batchNo?.trim(),
          expiry: l.expiry?.trim(),
        }));

        const otherChargesMinor = Math.max(0, Math.round(parseFloat(purOtherChargesRupees || '0') * 100));

        const calcResult = calcPurchase({
          lines: linesCalcInput,
          supplierGstin: selectedSupplier?.gstin,
          supplierState: selectedSupplier?.gstin ? selectedSupplier.gstin.slice(0, 2) : (selectedSupplier?.stateCode || '33'),
          shopState: shop?.gstin ? shop.gstin.slice(0, 2) : '33',
          otherChargesLabel: otherChargesMinor > 0 ? purOtherChargesLabel : undefined,
          otherChargesMinor,
          otherChargesGstBp: purOtherChargesGstBp,
        });

        const purGrandTotalMinor = calcResult.totalMinor;
        const purPaidMinor = Math.max(0, Math.round(parseFloat(purPaidAmount || '0') * 100));
        const purBalanceMinor = Math.max(0, purGrandTotalMinor - purPaidMinor);

        // Duplicate invoice check
        const isDuplicateInvoice = Boolean(
          purSupplierId &&
          purSupplierInvoiceNumber.trim() &&
          purchases.some((p) =>
            p.supplierId === purSupplierId &&
            p.status !== 'voided' &&
            (
              (p.supplierInvoiceNumber && p.supplierInvoiceNumber.trim().toLowerCase() === purSupplierInvoiceNumber.trim().toLowerCase()) ||
              (p.billNo && p.billNo.trim().toLowerCase() === purSupplierInvoiceNumber.trim().toLowerCase())
            )
          )
        );

        // Validation errors
        const validationErrors: string[] = [];
        if (!purSupplierId) validationErrors.push('Select a supplier');
        if (!purSupplierInvoiceNumber.trim()) validationErrors.push("Enter supplier's invoice number");
        if (isDuplicateInvoice) {
          const dup = purchases.find((p) =>
            p.supplierId === purSupplierId &&
            p.status !== 'voided' &&
            (
              (p.supplierInvoiceNumber && p.supplierInvoiceNumber.trim().toLowerCase() === purSupplierInvoiceNumber.trim().toLowerCase()) ||
              (p.billNo && p.billNo.trim().toLowerCase() === purSupplierInvoiceNumber.trim().toLowerCase())
            )
          );
          validationErrors.push(`Invoice ${purSupplierInvoiceNumber.trim()} from this supplier is already recorded as ${dup?.purchaseNumber || dup?.billNo || 'existing purchase'}.`);
        }
        if (!purSupplierInvoiceDate) validationErrors.push('Enter the supplier invoice date');
        else if (new Date(purSupplierInvoiceDate).getTime() > new Date(new Date().toISOString().slice(0, 10)).getTime()) {
          validationErrors.push('Supplier invoice date cannot be in the future');
        }
        if (purPurchaseDate && purSupplierInvoiceDate && new Date(purPurchaseDate).getTime() < new Date(purSupplierInvoiceDate).getTime()) {
          validationErrors.push('Purchase date cannot be before the supplier invoice date');
        }
        if (purLines.length === 0) {
          validationErrors.push('Add at least one item with a quantity');
        } else {
          for (let i = 0; i < purLines.length; i++) {
            const l = purLines[i];
            if (l.receivedQty <= 0) validationErrors.push(`Line ${i + 1} (${l.name}): received quantity must be > 0`);
            if (l.costRupees < 0) validationErrors.push(`Line ${i + 1} (${l.name}): cost cannot be negative`);
            if (l.trackBatch && (!l.batchNo?.trim() || !l.expiry?.trim())) {
              validationErrors.push(`Line ${i + 1} (${l.name}): Batch and expiry are required for this item`);
            }
          }
        }
        if (purPaidMinor > purGrandTotalMinor) {
          validationErrors.push(`Paid amount cannot exceed the purchase total of ${formatRupees(purGrandTotalMinor)}`);
        }
        if (purPaidMinor > 0 && !purPaymentMethod) {
          validationErrors.push('Select a payment method for the amount paid now');
        }

        const isValid = validationErrors.length === 0;

        const handleDismissPurchase = () => {
          const isDirty = Boolean(
            purSupplierInvoiceNumber.trim() ||
            purLines.length > 1 ||
            (purLines[0] && (purLines[0].costRupees > 0 || purLines[0].discountRupees > 0 || purLines[0].batchNo))
          );
          if (isDirty) {
            if (!confirm('Discard this purchase entry?')) return;
          }
          setShowPurchaseModal(false);
        };

        return (
          <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '1080px', width: '96%', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
              <div className="modal-header">
                <div>
                  <h3 className="card-title" style={{ margin: 0 }}>
                    📥 New Purchase & Stock Inward
                  </h3>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '2px' }}>
                    Record supplier bill faithfully • Stock in on save • Input Tax Credit (ITC) recorded
                  </div>
                </div>
                <button
                  style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.3rem', cursor: 'pointer' }}
                  onClick={handleDismissPurchase}
                >
                  ✕
                </button>
              </div>

              <div className="modal-body" style={{ overflowY: 'auto', flex: 1, padding: '1.25rem' }}>
                {/* Supplier Zone */}
                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '1.25rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                        <label className="form-label" style={{ margin: 0 }}>Supplier / Vendor *</label>
                        <button
                          type="button"
                          style={{ background: 'none', border: 'none', color: '#6d4aff', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', padding: 0 }}
                          onClick={() => openAddPartyModal('supplier')}
                        >
                          ＋ New Supplier
                        </button>
                      </div>
                      <select
                        className="form-input"
                        required
                        value={purSupplierId}
                        onChange={(e) => setPurSupplierId(e.target.value)}
                      >
                        <option value="">-- Choose Supplier --</option>
                        {suppliersList.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} {s.gstin ? `(${s.gstin})` : '(No GSTIN)'}
                          </option>
                        ))}
                      </select>
                      {selectedSupplier && !selectedSupplier.gstin && (
                        <div style={{ fontSize: '0.75rem', color: '#64748b', background: '#f1f5f9', padding: '0.35rem 0.5rem', borderRadius: '4px', marginTop: '4px' }}>
                          ℹ️ This supplier has no GSTIN recorded — no GST / ITC on this purchase.
                        </div>
                      )}
                      {selectedSupplier?.gstin && (
                        <div style={{ fontSize: '0.75rem', color: '#10b981', marginTop: '3px' }}>
                          ✓ GSTIN: {selectedSupplier.gstin} {selectedSupplier.stateCode ? `• State ${selectedSupplier.stateCode}` : ''}
                        </div>
                      )}
                    </div>

                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Supplier Invoice Number *</label>
                      <input
                        type="text"
                        className={`form-input ${isDuplicateInvoice ? 'form-input-error' : ''}`}
                        placeholder="e.g. SLT-2841"
                        required
                        value={purSupplierInvoiceNumber}
                        onChange={(e) => setPurSupplierInvoiceNumber(e.target.value)}
                      />
                      {isDuplicateInvoice && (
                        <div style={{ color: '#ef4444', fontSize: '0.75rem', fontWeight: 600, marginTop: '3px' }}>
                          ⚠️ Duplicate: Invoice "{purSupplierInvoiceNumber.trim()}" is already recorded for this supplier.
                        </div>
                      )}
                    </div>

                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Supplier Invoice Date *</label>
                      <input
                        type="date"
                        className="form-input"
                        required
                        max={new Date().toISOString().slice(0, 10)}
                        value={purSupplierInvoiceDate}
                        onChange={(e) => setPurSupplierInvoiceDate(e.target.value)}
                      />
                    </div>

                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Purchase (Inward) Date</label>
                      <input
                        type="date"
                        className="form-input"
                        value={purPurchaseDate}
                        min={purSupplierInvoiceDate}
                        onChange={(e) => setPurPurchaseDate(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                {/* Lines Table Zone */}
                <div style={{ marginBottom: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#1e1b4b' }}>
                        Purchase Lines ({purLines.length})
                      </h4>
                      <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                        Short-supply rule: stock, money & ITC calculated on Received Qty
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                        onClick={openAddItemModal}
                      >
                        ＋ New Item
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', background: '#e0e7ff', color: '#4338ca', borderColor: '#c7d2fe' }}
                        onClick={handleAddPurLine}
                      >
                        ＋ Add Line
                      </button>
                    </div>
                  </div>

                  <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                    <table className="data-table" style={{ margin: 0 }}>
                      <thead>
                        <tr style={{ background: '#f8fafc' }}>
                          <th style={{ minWidth: '180px' }}>Item</th>
                          <th style={{ width: '90px' }}>Qty Recv *</th>
                          <th style={{ width: '90px' }}>Billed Qty</th>
                          <th style={{ width: '100px' }}>Rate (₹) *</th>
                          <th style={{ width: '85px' }}>Discount (₹)</th>
                          <th style={{ width: '90px' }}>GST Rate</th>
                          <th style={{ width: '110px' }}>Batch / Exp</th>
                          <th style={{ width: '100px' }}>Line Total</th>
                          <th style={{ width: '110px' }}>Selling / Margin</th>
                          <th style={{ width: '36px' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {purLines.map((line, idx) => {
                          const lineCalc = calcResult.lines[idx];
                          const lineTotalRupees = (lineCalc?.totalMinor || 0) / 100;
                          const currentSellingRupees = (line.sellingPriceMinor || 0) / 100;
                          const marginPct = currentSellingRupees > 0 && line.costRupees > 0
                            ? Math.round(((currentSellingRupees - line.costRupees) / currentSellingRupees) * 100)
                            : null;
                          const hasShortSupply = line.billedQty > line.receivedQty;

                          return (
                            <React.Fragment key={idx}>
                              <tr>
                                <td>
                                  <select
                                    className="form-input"
                                    style={{ padding: '0.3rem 0.4rem', fontSize: '0.85rem' }}
                                    value={line.itemId}
                                    onChange={(e) => handlePurLineChange(idx, 'itemId', e.target.value)}
                                  >
                                    {items.map((it) => (
                                      <option key={it.id} value={it.id}>
                                        {it.name} ({it.unit || 'pcs'})
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    step="any"
                                    min="0.001"
                                    required
                                    className="form-input mono"
                                    style={{ padding: '0.3rem 0.4rem', fontSize: '0.85rem', fontWeight: 600 }}
                                    value={line.receivedQty}
                                    onChange={(e) => handlePurLineChange(idx, 'receivedQty', e.target.value)}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    step="any"
                                    min="0.001"
                                    className="form-input mono"
                                    style={{ padding: '0.3rem 0.4rem', fontSize: '0.85rem' }}
                                    value={line.billedQty}
                                    onChange={(e) => handlePurLineChange(idx, 'billedQty', parseFloat(e.target.value) || 0)}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    required
                                    className="form-input mono"
                                    style={{ padding: '0.3rem 0.4rem', fontSize: '0.85rem' }}
                                    value={line.costRupees}
                                    onChange={(e) => handlePurLineChange(idx, 'costRupees', parseFloat(e.target.value) || 0)}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    className="form-input mono"
                                    style={{ padding: '0.3rem 0.4rem', fontSize: '0.85rem' }}
                                    value={line.discountRupees}
                                    onChange={(e) => handlePurLineChange(idx, 'discountRupees', parseFloat(e.target.value) || 0)}
                                  />
                                </td>
                                <td>
                                  <select
                                    className="form-input mono"
                                    style={{ padding: '0.3rem 0.4rem', fontSize: '0.85rem' }}
                                    value={line.taxRateBp}
                                    onChange={(e) => handlePurLineChange(idx, 'taxRateBp', parseInt(e.target.value, 10))}
                                  >
                                    <option value={0}>0%</option>
                                    <option value={500}>5%</option>
                                    <option value={1200}>12%</option>
                                    <option value={1800}>18%</option>
                                    <option value={2800}>28%</option>
                                  </select>
                                </td>
                                <td>
                                  {line.trackBatch ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                      <input
                                        type="text"
                                        placeholder="Batch *"
                                        required
                                        className="form-input"
                                        style={{ padding: '0.2rem 0.35rem', fontSize: '0.75rem' }}
                                        value={line.batchNo}
                                        onChange={(e) => handlePurLineChange(idx, 'batchNo', e.target.value)}
                                      />
                                      <input
                                        type="date"
                                        placeholder="Exp *"
                                        required
                                        className="form-input"
                                        style={{ padding: '0.2rem 0.35rem', fontSize: '0.75rem' }}
                                        value={line.expiry}
                                        onChange={(e) => handlePurLineChange(idx, 'expiry', e.target.value)}
                                      />
                                    </div>
                                  ) : (
                                    <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>—</span>
                                  )}
                                </td>
                                <td className="mono" style={{ fontWeight: 700, color: '#1e1b4b', fontSize: '0.85rem' }}>
                                  ₹{lineTotalRupees.toFixed(2)}
                                </td>
                                <td>
                                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                    Sell: ₹{currentSellingRupees.toFixed(2)}
                                    {marginPct !== null && (
                                      <span style={{ color: marginPct >= 0 ? '#10b981' : '#ef4444', fontWeight: 600, display: 'block' }}>
                                        {marginPct}% margin
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1rem', padding: '0 4px' }}
                                    onClick={() => handleRemovePurLine(idx)}
                                    title="Remove Line"
                                  >
                                    🗑️
                                  </button>
                                </td>
                              </tr>
                              {hasShortSupply && (
                                <tr>
                                  <td colSpan={10} style={{ background: '#fffbeb', color: '#b45309', padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}>
                                    ⚠️ Short Supply: Billed {line.billedQty}, received {line.receivedQty} — this purchase records {line.receivedQty}. Record the balance when the supplier bills it.
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                        {purLines.length === 0 && (
                          <tr>
                            <td colSpan={10} style={{ textAlign: 'center', padding: '1.5rem', color: '#94a3b8' }}>
                              No products added yet. Click "+ Add Line" above.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Other Charges Zone */}
                <div style={{ background: '#f8fafc', padding: '0.75rem 1rem', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '1.25rem' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#64748b', marginBottom: '0.5rem' }}>
                    OTHER CHARGES (OPTIONAL)
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', alignItems: 'center' }}>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Transport / Freight / Loading"
                      value={purOtherChargesLabel}
                      onChange={(e) => setPurOtherChargesLabel(e.target.value)}
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="form-input mono"
                      placeholder="Amount (₹)"
                      value={purOtherChargesRupees}
                      onChange={(e) => setPurOtherChargesRupees(e.target.value)}
                    />
                    <select
                      className="form-input mono"
                      value={purOtherChargesGstBp}
                      onChange={(e) => setPurOtherChargesGstBp(parseInt(e.target.value, 10))}
                    >
                      <option value={0}>No GST (0%)</option>
                      <option value={500}>GST 5%</option>
                      <option value={1200}>GST 12%</option>
                      <option value={1800}>GST 18%</option>
                      <option value={2800}>GST 28%</option>
                    </select>
                  </div>
                </div>

                {/* Totals & Payment Zone (Section 6.6 & 7.1) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', alignItems: 'start' }}>
                  {/* Payment Zone */}
                  <div className="card" style={{ padding: '1rem', background: '#f8fafc', margin: 0 }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e1b4b', marginBottom: '0.75rem' }}>
                      PAYMENT AT PURCHASE TIME
                    </div>
                    <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                      <label className="form-label">Amount Paid Right Now (₹)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="form-input mono"
                        value={purPaidAmount}
                        onChange={(e) => setPurPaidAmount(e.target.value)}
                        placeholder="0.00"
                      />
                    </div>
                    {purPaidMinor > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label">Mode *</label>
                          <select
                            className="form-input"
                            value={purPaymentMethod}
                            onChange={(e) => setPurPaymentMethod(e.target.value as any)}
                          >
                            <option value="bank">🏦 Bank / Transfer</option>
                            <option value="upi">📱 UPI</option>
                            <option value="cash">💵 Cash</option>
                            <option value="cheque">📝 Cheque</option>
                          </select>
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label">Reference #</label>
                          <input
                            type="text"
                            className="form-input"
                            placeholder="e.g. UTR / Cheque #"
                            value={purPaymentRef}
                            onChange={(e) => setPurPaymentRef(e.target.value)}
                          />
                        </div>
                      </div>
                    )}
                    <div className="form-group" style={{ margin: 0 }}>
                      <label className="form-label">Note / Purchase Remarks</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. LR #4928 via Gati"
                        value={purNote}
                        onChange={(e) => setPurNote(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Live Totals Zone */}
                  <div className="card" style={{ padding: '1rem', background: '#f8fafc', margin: 0 }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e1b4b', marginBottom: '0.75rem' }}>
                      PURCHASE TOTALS (SECTION 6.6)
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem', fontSize: '0.85rem' }}>
                      <span style={{ color: '#64748b' }}>Taxable Value:</span>
                      <span className="mono">{formatRupees(calcResult.taxableMinor)}</span>
                    </div>
                    {calcResult.discountMinor > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem', fontSize: '0.85rem', color: '#10b981' }}>
                        <span>Line Discounts:</span>
                        <span className="mono">-{formatRupees(calcResult.discountMinor)}</span>
                      </div>
                    )}
                    {calcResult.otherChargesMinor > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem', fontSize: '0.85rem' }}>
                        <span style={{ color: '#64748b' }}>Other Charges ({purOtherChargesLabel}):</span>
                        <span className="mono">{formatRupees(calcResult.otherChargesMinor)}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem', fontSize: '0.85rem' }}>
                      <span style={{ color: '#64748b' }}>
                        GST (Input Tax Credit){calcResult.isIntraState ? ' (CGST+SGST)' : ' (IGST)'}:
                      </span>
                      <span className="mono" style={{ color: '#6366f1', fontWeight: 600 }}>
                        {formatRupees(calcResult.itcMinor)}
                      </span>
                    </div>
                    {calcResult.roundOffMinor !== 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem', fontSize: '0.85rem' }}>
                        <span style={{ color: '#64748b' }}>Round-off:</span>
                        <span className="mono">{formatRupees(calcResult.roundOffMinor)}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '2px solid #e2e8f0', fontSize: '1.1rem', fontWeight: 700 }}>
                      <span>Purchase Total:</span>
                      <span className="mono" style={{ color: '#1e1b4b' }}>{formatRupees(purGrandTotalMinor)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.35rem', fontSize: '0.85rem' }}>
                      <span style={{ color: '#10b981' }}>Paid Right Now:</span>
                      <span className="mono" style={{ color: '#10b981', fontWeight: 600 }}>{formatRupees(purPaidMinor)}</span>
                    </div>
                    {purBalanceMinor > 0 ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.35rem', fontSize: '0.9rem', color: '#ef4444', fontWeight: 700 }}>
                        <span>Balance Payable to Supplier:</span>
                        <span className="mono">{formatRupees(purBalanceMinor)}</span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.35rem', fontSize: '0.85rem', color: '#10b981', fontWeight: 600 }}>
                        <span>Status:</span>
                        <span>Fully Paid</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Validation Errors Box */}
                {!isValid && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '0.75rem 1rem', marginTop: '1.25rem' }}>
                    <div style={{ color: '#b91c1c', fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                      Please correct the following before saving:
                    </div>
                    <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#b91c1c', fontSize: '0.8rem' }}>
                      {validationErrors.map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Modal Actions Footer */}
              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleDismissPurchase}
                >
                  Cancel
                </button>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ minWidth: '220px', padding: '0.6rem 1.25rem' }}
                    disabled={!isValid || isSubmittingPurchase}
                    onClick={handleSavePurchase}
                    title={!isValid ? 'Fill all required fields to save' : 'Save purchase and receive stock into ledger'}
                  >
                    {isSubmittingPurchase ? 'Processing...' : 'Save Purchase & Receive Stock'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* PURCHASES: SUCCESS MODAL (SECTION 9.2) */}
      {purchaseSuccess && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '520px', width: '92%', textAlign: 'center', padding: '2rem' }}>
            <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: '#ecfdf5', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem', margin: '0 auto 1rem auto' }}>
              ✓
            </div>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 700, margin: '0 0 0.35rem 0', color: '#1e1b4b' }}>
              Purchase recorded — stock received
            </h2>
            <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 600, color: '#6d4aff', marginBottom: '1.25rem' }}>
              {purchaseSuccess.purchase.purchaseNumber || purchaseSuccess.purchase.billNo}
            </div>

            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '1.25rem', textAlign: 'left', marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                <span style={{ color: '#64748b' }}>Supplier:</span>
                <strong style={{ color: '#1e1b4b' }}>{purchaseSuccess.supplierName}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem', fontWeight: 700, borderTop: '1px solid #e2e8f0', paddingTop: '0.5rem' }}>
                <span>Purchase Total:</span>
                <span className="mono">{formatRupees(purchaseSuccess.purchase.totalMinor)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: '#64748b' }}>Stock received:</span>
                <span style={{ color: '#10b981', fontWeight: 600 }}>
                  Stock in: {purchaseSuccess.itemsCount} item{purchaseSuccess.itemsCount > 1 ? 's' : ''} • {purchaseSuccess.unitsCount} units
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: '#64748b' }}>Payment status:</span>
                <span>
                  {purchaseSuccess.paidMinor > 0
                    ? `Paid ${formatRupees(purchaseSuccess.paidMinor)} (${(purchaseSuccess.paymentMode || 'Bank').toUpperCase()}) • Payable ${formatRupees(purchaseSuccess.payableMinor)}`
                    : purchaseSuccess.payableMinor === 0
                    ? 'Fully paid'
                    : `Payable ${formatRupees(purchaseSuccess.payableMinor)}`}
                </span>
              </div>
              {purchaseSuccess.itcMinor > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#6366f1', borderTop: '1px dashed #e2e8f0', paddingTop: '0.5rem', fontWeight: 600 }}>
                  <span>Input Tax Credit (ITC) recorded:</span>
                  <span className="mono">{formatRupees(purchaseSuccess.itcMinor)}</span>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => window.open(`/api/purchases/${purchaseSuccess.purchase.id}/print?format=a4`, '_blank')}
              >
                📄 Print A4
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => window.open(`/api/purchases/${purchaseSuccess.purchase.id}/print?format=thermal`, '_blank')}
              >
                🧾 Print Thermal
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setPurchaseSuccess(null);
                  openNewPurchaseModal();
                }}
              >
                + New Purchase
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ minWidth: '100px' }}
                onClick={() => setPurchaseSuccess(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PURCHASES: VIEW PURCHASE DETAILS MODAL (SECTION 4.3) */}
      {selectedPurchaseDetails && (() => {
        const pur = selectedPurchaseDetails;
        const isVoided = pur.status === 'voided';

        return (
          <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '920px', width: '94%', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
              <div className="modal-header">
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <h3 className="card-title" style={{ margin: 0 }}>
                      Purchase: {pur.purchaseNumber || pur.billNo || pur.id}
                    </h3>
                    {isVoided ? (
                      <span className="badge" style={{ background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }}>
                        ✕ Voided
                      </span>
                    ) : (pur.balanceMinor || 0) === 0 ? (
                      <span className="badge badge-emerald">✓ Paid</span>
                    ) : (pur.paidMinor || 0) > 0 ? (
                      <span className="badge badge-amber">⏳ Part-Paid</span>
                    ) : (
                      <span className="badge" style={{ background: '#fff1f2', color: '#e11d48', border: '1px solid #fecdd3' }}>
                        ⚠️ Unpaid
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '3px' }}>
                    Recorded on {pur.purchaseDate || pur.bdate} • Internal PUR series
                  </div>
                </div>
                <button
                  style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.3rem', cursor: 'pointer' }}
                  onClick={() => setSelectedPurchaseDetails(null)}
                >
                  ✕
                </button>
              </div>

              <div className="modal-body" style={{ overflowY: 'auto', flex: 1, padding: '1.25rem' }}>
                {/* Voided Warning Notice */}
                {isVoided && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '0.85rem 1rem', borderRadius: '8px', marginBottom: '1rem' }}>
                    <strong>⚠️ VOIDED PURCHASE:</strong> This purchase was voided on {pur.voidedAt || '—'} by {pur.voidedBy || 'management'}. Reason: <em>"{pur.voidReason || 'No reason provided'}"</em>. Inward stock and payable have been reversed.
                  </div>
                )}

                {/* Metadata Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '1rem' }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Supplier</div>
                    <div style={{ fontWeight: 600 }}>{pur.supplierName || '—'}</div>
                    {pur.supplierPhone && <div className="mono" style={{ fontSize: '0.75rem', color: '#64748b' }}>📞 {pur.supplierPhone}</div>}
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Supplier GSTIN</div>
                    <div className="mono">{pur.supplierGstin || 'Unregistered'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Supplier Invoice # & Date</div>
                    <div style={{ fontWeight: 600 }}>{pur.supplierInvoiceNumber || pur.billNo || '—'}</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Date: {pur.supplierInvoiceDate || pur.bdate || '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Payment Method</div>
                    <div style={{ textTransform: 'uppercase', fontWeight: 600, fontSize: '0.85rem' }}>
                      {pur.paymentMethod || '—'}
                    </div>
                  </div>
                </div>

                {/* Lines Table */}
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', marginBottom: '1rem' }}>
                  <table className="data-table" style={{ margin: 0 }}>
                    <thead>
                      <tr style={{ background: '#f8fafc' }}>
                        <th>Item</th>
                        <th>Billed Qty</th>
                        <th>Recv Qty</th>
                        <th>Unit Rate</th>
                        <th>Discount</th>
                        <th>Taxable</th>
                        <th>GST (ITC)</th>
                        <th>Total</th>
                        <th>Stock Inward Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(pur.lines || []).map((l, idx) => (
                        <tr key={idx}>
                          <td style={{ fontWeight: 600 }}>
                            {l.name}
                            {l.batchNo && (
                              <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>
                                Batch: {l.batchNo} {l.expiry ? `• Exp: ${l.expiry}` : ''}
                              </div>
                            )}
                          </td>
                          <td className="mono">{((l.billedQtyMilli ?? l.qtyMilli) / 1000)} {l.unit || 'pcs'}</td>
                          <td className="mono" style={{ fontWeight: 600, color: '#10b981' }}>
                            {((l.receivedQtyMilli ?? l.qtyMilli) / 1000)} {l.unit || 'pcs'}
                          </td>
                          <td className="mono">{formatRupees(l.costMinor)}</td>
                          <td className="mono">{l.discountMinor ? formatRupees(l.discountMinor) : '—'}</td>
                          <td className="mono">{formatRupees(l.taxableMinor)}</td>
                          <td className="mono" style={{ color: '#6366f1' }}>
                            {formatRupees(l.taxMinor || ((l.cgstMinor || 0) + (l.sgstMinor || 0) + (l.igstMinor || 0)))} ({l.taxRateBp / 100}%)
                          </td>
                          <td className="mono" style={{ fontWeight: 700 }}>{formatRupees(l.totalMinor)}</td>
                          <td>
                            <span style={{ fontSize: '0.75rem', color: isVoided ? '#94a3b8' : '#10b981' }}>
                              {isVoided ? 'Reversed on Void' : `✓ +${((l.receivedQtyMilli ?? l.qtyMilli) / 1000)} ${l.unit || 'pcs'} to stock`}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Tax & Payable Summary */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                  <div style={{ background: '#f8fafc', padding: '0.85rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem', color: '#64748b' }}>INPUT TAX CREDIT BREAKUP</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                      <span>CGST:</span>
                      <span className="mono">{formatRupees(pur.cgstMinor)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                      <span>SGST:</span>
                      <span className="mono">{formatRupees(pur.sgstMinor)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                      <span>IGST:</span>
                      <span className="mono">{formatRupees(pur.igstMinor)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 600, color: '#6366f1', borderTop: '1px solid #e2e8f0', paddingTop: '0.35rem' }}>
                      <span>Total ITC Claimable:</span>
                      <span className="mono">{formatRupees(pur.itcMinor ?? (pur.cgstMinor + pur.sgstMinor + pur.igstMinor))}</span>
                    </div>
                  </div>

                  <div style={{ background: '#f8fafc', padding: '0.85rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem' }}>
                      <span style={{ color: '#64748b' }}>Taxable Subtotal:</span>
                      <span className="mono">{formatRupees(pur.taxableMinor)}</span>
                    </div>
                    {pur.otherChargesMinor && pur.otherChargesMinor > 0 ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem' }}>
                        <span style={{ color: '#64748b' }}>Other Charges ({pur.otherChargesLabel || 'Freight'}):</span>
                        <span className="mono">{formatRupees(pur.otherChargesMinor)}</span>
                      </div>
                    ) : null}
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem' }}>
                      <span style={{ color: '#64748b' }}>Input Tax Credit:</span>
                      <span className="mono" style={{ color: '#6366f1' }}>{formatRupees(pur.itcMinor ?? (pur.cgstMinor + pur.sgstMinor + pur.igstMinor))}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.05rem', fontWeight: 700, paddingTop: '0.35rem', borderTop: '1px solid #e2e8f0', marginTop: '0.35rem' }}>
                      <span>Purchase Total:</span>
                      <span className="mono">{formatRupees(pur.totalMinor)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginTop: '0.3rem', color: '#10b981' }}>
                      <span>Paid Amount:</span>
                      <span className="mono">{formatRupees(pur.paidMinor)}</span>
                    </div>
                    {(pur.balanceMinor || 0) > 0 && !isVoided ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', marginTop: '0.2rem', color: '#ef4444', fontWeight: 700 }}>
                        <span>Balance Payable:</span>
                        <span className="mono">{formatRupees(pur.balanceMinor)}</span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginTop: '0.2rem', color: '#10b981', fontWeight: 600 }}>
                        <span>Balance:</span>
                        <span>₹0.00 (Fully Settled)</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Payments History against this purchase */}
                {pur.payments && pur.payments.length > 0 && (
                  <div>
                    <h5 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#64748b' }}>
                      PAYMENT ALLOCATIONS AGAINST THIS PURCHASE
                    </h5>
                    <table className="data-table" style={{ margin: 0 }}>
                      <thead>
                        <tr style={{ background: '#f8fafc' }}>
                          <th>Payment Date</th>
                          <th>Payment #</th>
                          <th>Mode</th>
                          <th>Reference</th>
                          <th>Amount Allocated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pur.payments.map((pm: any, pidx: number) => (
                          <tr key={pidx}>
                            <td>{pm.paymentDate || pm.bdate || '—'}</td>
                            <td className="mono" style={{ fontWeight: 600 }}>{pm.paymentNumber || pm.id}</td>
                            <td style={{ textTransform: 'capitalize' }}>{pm.method || 'Cash'}</td>
                            <td className="mono">{pm.reference || '—'}</td>
                            <td className="mono" style={{ fontWeight: 600, color: '#10b981' }}>{formatRupees(pm.amountMinor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.85rem 1rem', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => window.open(`/api/purchases/${pur.id}/print?format=a4`, '_blank')}
                  >
                    📄 Print A4
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => window.open(`/api/purchases/${pur.id}/print?format=thermal`, '_blank')}
                  >
                    🧾 Print Thermal
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {!isVoided && (pur.balanceMinor || 0) > 0 && can(user?.role as any, 'purchases.pay') && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ background: '#10b981', borderColor: '#10b981' }}
                      onClick={() => {
                        const sup = parties.find((part) => part.id === pur.supplierId);
                        if (sup) {
                          handleOpenPaySupplier(sup);
                        } else {
                          handleOpenPaySupplier({
                            id: pur.supplierId,
                            name: pur.supplierName || 'Supplier',
                            phone: pur.supplierPhone,
                            payableMinor: pur.balanceMinor,
                            openPurchasesCount: 1,
                            type: 'supplier',
                            creditLimitMinor: 0,
                          });
                        }
                      }}
                    >
                      💳 Pay Supplier
                    </button>
                  )}
                  {!isVoided && can(user?.role as any, 'purchases.void') && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ color: '#ef4444' }}
                      onClick={() => handleOpenVoidPurchase(pur)}
                    >
                      🗑️ Void Purchase
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setSelectedPurchaseDetails(null)}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* PAY SUPPLIER MODAL (SECTION 7.2) */}
      {paySupplierModal && (() => {
        const amtMinor = Math.round(parseFloat(paySupplierAmount || '0') * 100);
        const openPurchasesForSup = purchases.filter((p) =>
          p.supplierId === paySupplierModal.supplierId &&
          p.status !== 'voided' &&
          (p.balanceMinor || 0) > 0
        );

        let allocationPlan: SupplierPaymentAllocationPlan = {
          allocations: [],
          totalAllocatedMinor: 0,
          payableBeforeMinor: paySupplierModal.totalPayableMinor,
          payableAfterMinor: paySupplierModal.totalPayableMinor,
          isFullySettled: false,
        };

        const exceedsPayable = amtMinor > paySupplierModal.totalPayableMinor;

        if (amtMinor > 0 && !exceedsPayable) {
          try {
            allocationPlan = planSupplierPayment(
              openPurchasesForSup.map((p) => ({
                id: p.id,
                purchaseNumber: p.purchaseNumber,
                supplierInvoiceNumber: p.supplierInvoiceNumber,
                supplierInvoiceDate: p.supplierInvoiceDate,
                bdate: p.bdate,
                totalMinor: p.totalMinor,
                paidMinor: p.paidMinor,
                balanceMinor: p.balanceMinor,
              })),
              amtMinor
            );
          } catch (e) {
            // Keep default allocationPlan
          }
        }

        return (
          <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '640px', width: '94%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
              <div className="modal-header">
                <div>
                  <h3 className="card-title" style={{ margin: 0 }}>
                    💳 Pay Supplier: {paySupplierModal.supplierName}
                  </h3>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '2px' }}>
                    FIFO oldest-purchase first allocation • Reduces payable ledger
                  </div>
                </div>
                <button
                  style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.3rem', cursor: 'pointer' }}
                  onClick={() => setPaySupplierModal(null)}
                >
                  ✕
                </button>
              </div>

              <div className="modal-body" style={{ overflowY: 'auto', flex: 1, padding: '1.25rem' }}>
                {/* Header balance info */}
                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>TOTAL OUTSTANDING PAYABLE</div>
                    <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color: '#ef4444' }}>
                      {formatRupees(paySupplierModal.totalPayableMinor)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>OPEN BILLS</div>
                    <div style={{ fontWeight: 600, color: '#1e1b4b' }}>
                      {openPurchasesForSup.length} purchase{openPurchasesForSup.length > 1 ? 's' : ''}
                    </div>
                  </div>
                </div>

                {/* Form fields */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Payment Amount (₹) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      className={`form-input mono ${exceedsPayable ? 'form-input-error' : ''}`}
                      required
                      value={paySupplierAmount}
                      onChange={(e) => setPaySupplierAmount(e.target.value)}
                    />
                    {exceedsPayable && (
                      <div style={{ color: '#ef4444', fontSize: '0.75rem', fontWeight: 600, marginTop: '3px' }}>
                        ⚠️ Amount cannot exceed the payable of {formatRupees(paySupplierModal.totalPayableMinor)}. Advances to suppliers are not recorded here yet.
                      </div>
                    )}
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Payment Mode *</label>
                    <select
                      className="form-input"
                      value={paySupplierMode}
                      onChange={(e) => setPaySupplierMode(e.target.value as any)}
                    >
                      <option value="cash">💵 Cash</option>
                      <option value="bank">🏦 Bank / NEFT / RTGS</option>
                      <option value="upi">📱 UPI / QR</option>
                      <option value="cheque">📝 Cheque</option>
                    </select>
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Payment Date *</label>
                    <input
                      type="date"
                      className="form-input"
                      required
                      max={new Date().toISOString().slice(0, 10)}
                      value={paySupplierDate}
                      onChange={(e) => setPaySupplierDate(e.target.value)}
                    />
                  </div>

                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">Reference #</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. UTR / Cheque #"
                      value={paySupplierRef}
                      onChange={(e) => setPaySupplierRef(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                  <label className="form-label">Internal Note (optional)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Internal reference (never printed)"
                    value={paySupplierNote}
                    onChange={(e) => setPaySupplierNote(e.target.value)}
                  />
                </div>

                {/* FIFO Allocation Preview */}
                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e1b4b' }}>
                      ALLOCATION PREVIEW (OLDEST FIRST)
                    </div>
                    {allocationPlan.isFullySettled && (
                      <span style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 600 }}>
                        ✓ This clears the full payable
                      </span>
                    )}
                  </div>

                  {allocationPlan.allocations.length > 0 ? (
                    <table className="data-table" style={{ margin: 0, fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ background: '#ffffff' }}>
                          <th>Purchase #</th>
                          <th>Supplier Inv #</th>
                          <th>Receives</th>
                          <th>Balance After</th>
                          <th>Status After</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allocationPlan.allocations.map((al, ai) => (
                          <tr key={ai}>
                            <td className="mono" style={{ fontWeight: 600 }}>{al.purchaseNumber}</td>
                            <td>{al.supplierInvoiceNumber || '—'}</td>
                            <td className="mono" style={{ color: '#10b981', fontWeight: 600 }}>{formatRupees(al.allocatedMinor)}</td>
                            <td className="mono">{formatRupees(al.balanceAfterMinor)}</td>
                            <td>
                              {al.statusAfter === 'paid' ? (
                                <span className="badge badge-emerald">Paid</span>
                              ) : (
                                <span className="badge badge-amber">Part-Paid</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center', padding: '1rem' }}>
                      Enter an amount above ₹0 to preview oldest-first FIFO allocations.
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #e2e8f0', fontSize: '0.9rem' }}>
                    <span style={{ color: '#64748b' }}>Payable After Payment:</span>
                    <strong className="mono" style={{ color: allocationPlan.isFullySettled ? '#10b981' : '#ef4444' }}>
                      {formatRupees(Math.max(0, paySupplierModal.totalPayableMinor - amtMinor))}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setPaySupplierModal(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ minWidth: '180px', background: '#10b981', borderColor: '#10b981' }}
                  disabled={amtMinor <= 0 || exceedsPayable || isSubmittingPaySupplier}
                  onClick={handleSubmitPaySupplier}
                >
                  {isSubmittingPaySupplier ? 'Recording...' : `Record Payment of ${formatRupees(amtMinor)}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* SUPPLIER LEDGER MODAL (SECTION 10.1) */}
      {selectedSupplierLedger && (() => {
        const led = selectedSupplierLedger;

        // Calculate Ageing (0-30, 31-60, 60+ days)
        const now = Date.now();
        let age0_30 = 0;
        let age31_60 = 0;
        let age61_plus = 0;
        for (const op of led.openPurchases) {
          const invDate = op.supplierInvoiceDate;
          if (invDate) {
            const daysOld = Math.floor((now - new Date(invDate).getTime()) / (1000 * 60 * 60 * 24));
            if (daysOld <= 30) age0_30 += op.balanceMinor;
            else if (daysOld <= 60) age31_60 += op.balanceMinor;
            else age61_plus += op.balanceMinor;
          } else {
            age0_30 += op.balanceMinor;
          }
        }

        return (
          <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '980px', width: '96%', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
              <div className="modal-header">
                <div>
                  <h3 className="card-title" style={{ margin: 0 }}>
                    📖 Supplier Ledger: {led.supplier.name}
                  </h3>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '2px' }}>
                    Chronological running payable • Complete history of purchases and payments
                  </div>
                </div>
                <button
                  style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.3rem', cursor: 'pointer' }}
                  onClick={() => setSelectedSupplierLedger(null)}
                >
                  ✕
                </button>
              </div>

              <div className="modal-body" style={{ overflowY: 'auto', flex: 1, padding: '1.25rem' }}>
                {/* Supplier Profile & Total Dues Header */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', background: '#f8fafc', padding: '1rem', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '1.25rem' }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>SUPPLIER DETAILS</div>
                    <div style={{ fontWeight: 700, fontSize: '1rem', color: '#1e1b4b' }}>{led.supplier.name}</div>
                    {led.supplier.phone && <div className="mono" style={{ fontSize: '0.8rem', color: '#64748b' }}>📞 {led.supplier.phone}</div>}
                    {led.supplier.gstin && <div className="mono" style={{ fontSize: '0.8rem', color: '#64748b' }}>GSTIN: {led.supplier.gstin}</div>}
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>CURRENT OUTSTANDING PAYABLE</div>
                    <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color: led.totalPayableMinor > 0 ? '#ef4444' : '#10b981' }}>
                      {formatRupees(led.totalPayableMinor)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      {led.openPurchases.length} open bill{led.openPurchases.length > 1 ? 's' : ''}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>QUICK ACTIONS</div>
                    {can(user?.role as any, 'purchases.pay') && led.totalPayableMinor > 0 && (
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ marginTop: '0.35rem', fontSize: '0.8rem', padding: '0.35rem 0.75rem', background: '#10b981', borderColor: '#10b981' }}
                        onClick={() => handleOpenPaySupplier(led.supplier)}
                      >
                        💳 Pay Supplier
                      </button>
                    )}
                  </div>
                </div>

                {/* Ageing Breakdown Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '0.75rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: '#166534', fontWeight: 600 }}>0 - 30 DAYS</div>
                    <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: '#166534' }}>{formatRupees(age0_30)}</div>
                  </div>
                  <div style={{ background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '8px', padding: '0.75rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: '#b45309', fontWeight: 600 }}>31 - 60 DAYS</div>
                    <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: '#b45309' }}>{formatRupees(age31_60)}</div>
                  </div>
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '0.75rem', textAlign: 'center' }}>
                    <div style={{ fontSize: '0.75rem', color: '#991b1b', fontWeight: 600 }}>60+ DAYS (OVERDUE)</div>
                    <div className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: '#991b1b' }}>{formatRupees(age61_plus)}</div>
                  </div>
                </div>

                {/* Chronological Ledger Table */}
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                  <table className="data-table" style={{ margin: 0 }}>
                    <thead>
                      <tr style={{ background: '#f8fafc' }}>
                        <th>Date</th>
                        <th>Entry Description</th>
                        <th>Status</th>
                        <th>Debit / Purchase (+)</th>
                        <th>Credit / Payment (-)</th>
                        <th>Running Payable</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {led.entries.map((ev, ei) => {
                        const isVoided = ev.status === 'voided';

                        return (
                          <tr key={ei} style={{ opacity: isVoided ? 0.6 : 1 }}>
                            <td>{ev.date}</td>
                            <td>
                              <div style={{ fontWeight: 600 }}>{ev.description}</div>
                              {ev.voidReason && (
                                <div style={{ fontSize: '0.7rem', color: '#ef4444' }}>
                                  Void Reason: {ev.voidReason}
                                </div>
                              )}
                            </td>
                            <td>
                              {isVoided ? (
                                <span className="badge" style={{ background: '#fef2f2', color: '#b91c1c' }}>Voided</span>
                              ) : ev.type === 'purchase' ? (
                                <span className="badge badge-blue">Purchase</span>
                              ) : (
                                <span className="badge badge-emerald">Payment</span>
                              )}
                            </td>
                            <td className="mono" style={{ color: ev.type === 'purchase' && !isVoided ? '#ef4444' : '#94a3b8' }}>
                              {ev.type === 'purchase' ? formatRupees(ev.amountMinor) : '—'}
                            </td>
                            <td className="mono" style={{ color: ev.type === 'payment' && !isVoided ? '#10b981' : '#94a3b8' }}>
                              {ev.type === 'payment' ? formatRupees(ev.amountMinor) : '—'}
                            </td>
                            <td className="mono" style={{ fontWeight: 700 }}>
                              {formatRupees(ev.runningPayableMinor)}
                            </td>
                            <td>
                              {ev.type === 'purchase' ? (
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                                  onClick={() => handleViewPurchaseDetails(ev.id)}
                                >
                                  👁️ View
                                </button>
                              ) : !isVoided && can(user?.role as any, 'purchases.void') ? (
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', color: '#ef4444' }}
                                  onClick={() => handleOpenVoidPayment({
                                    id: ev.id,
                                    number: ev.refNumber,
                                    amountMinor: ev.amountMinor,
                                    supplierName: led.supplier.name,
                                  })}
                                  title="Void supplier payment"
                                >
                                  🗑️ Void
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                      {led.entries.length === 0 && (
                        <tr>
                          <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                            No ledger history found for this supplier.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="modal-footer" style={{ display: 'flex', justifyContent: 'flex-end', padding: '0.85rem 1rem', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setSelectedSupplierLedger(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* VOID PURCHASE MODAL (SECTION 11.3) */}
      {voidPurchaseModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '520px', width: '92%', padding: '1.5rem' }}>
            <h3 style={{ margin: '0 0 0.5rem 0', color: '#b91c1c' }}>
              🗑️ Void Purchase {voidPurchaseModal.purchaseNumber || voidPurchaseModal.billNo}
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
              This will remove <strong>{formatRupees(voidPurchaseModal.totalMinor)}</strong> of purchase, take goods back out of stock with reverse stock moves, reduce the payable to {voidPurchaseModal.supplierName || 'supplier'} by <strong>{formatRupees(voidPurchaseModal.balanceMinor)}</strong>, and reverse <strong>{formatRupees(voidPurchaseModal.itcMinor || 0)}</strong> of ITC.
            </p>
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#b45309', padding: '0.65rem 0.85rem', borderRadius: '6px', fontSize: '0.8rem', marginBottom: '1rem' }}>
              ⚠️ Voiding is blocked if received stock has already been sold or if standing supplier payments exist against this purchase.
            </div>
            <div className="form-group">
              <label className="form-label">Mandatory Void Reason *</label>
              <textarea
                className="form-input"
                rows={3}
                required
                placeholder="e.g. Wrong supplier invoice number entered — re-entering bill"
                value={voidPurchaseReason}
                onChange={(e) => setVoidPurchaseReason(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setVoidPurchaseModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ background: '#ef4444', borderColor: '#ef4444' }}
                disabled={!voidPurchaseReason.trim() || isSubmittingVoidPurchase}
                onClick={handleSubmitVoidPurchase}
              >
                {isSubmittingVoidPurchase ? 'Voiding...' : 'Confirm Void Purchase'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VOID SUPPLIER PAYMENT MODAL (SECTION 11.3) */}
      {voidPaymentModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '520px', width: '92%', padding: '1.5rem' }}>
            <h3 style={{ margin: '0 0 0.5rem 0', color: '#b91c1c' }}>
              🗑️ Void Supplier Payment {voidPaymentModal.number}
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
              This will restore <strong>{formatRupees(voidPaymentModal.amountMinor)}</strong> to the payable to {voidPaymentModal.supplierName} and re-open the purchases it settled.
            </p>
            <div className="form-group">
              <label className="form-label">Mandatory Void Reason *</label>
              <textarea
                className="form-input"
                rows={3}
                required
                placeholder="e.g. Wrong bank payment recorded — paid from different account"
                value={voidPaymentReason}
                onChange={(e) => setVoidPaymentReason(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setVoidPaymentModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ background: '#ef4444', borderColor: '#ef4444' }}
                disabled={!voidPaymentReason.trim() || isSubmittingVoidPayment}
                onClick={handleSubmitVoidPayment}
              >
                {isSubmittingVoidPayment ? 'Voiding...' : 'Confirm Void Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          WHATSAPP BILL SHARING: CHECKOUT SUCCESS MODAL (SECTION 4)
          ========================================================================= */}
      {checkoutSuccess && (
        <div
          className="modal-overlay"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setCheckoutSuccess(null);
          }}
          tabIndex={-1}
        >
          <div
            className="modal-content"
            style={{
              maxWidth: '460px',
              width: '92%',
              borderRadius: '16px',
              padding: 0,
              overflow: 'hidden',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.25), 0 10px 10px -5px rgba(0, 0, 0, 0.15)',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
                padding: '1.25rem 1.5rem',
                borderBottom: '1px solid #a7f3d0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    background: '#10b981',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.25rem',
                    fontWeight: 'bold',
                  }}
                >
                  ✓
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#047857', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Bill Created
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#064e3b' }}>
                    #{checkoutSuccess.number}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCheckoutSuccess(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#065f46',
                  fontSize: '1.5rem',
                  cursor: 'pointer',
                  padding: '4px 8px',
                  lineHeight: 1,
                }}
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '1.25rem 1.5rem' }}>
              {/* Summary Line */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '0.85rem 1rem',
                  marginBottom: '1rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                    👤 {checkoutSuccess.customerName || 'Walk-in Customer'}
                  </span>
                  <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                    📦 {checkoutSuccess.itemCount} {checkoutSuccess.itemCount === 1 ? 'item' : 'items'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: '0.4rem', borderTop: '1px dashed #cbd5e1' }}>
                  <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#334155' }}>Grand Total</span>
                  <span className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a' }}>
                    {formatRupees(checkoutSuccess.totalMinor)}
                  </span>
                </div>

                {/* Balance Line (shown ONLY when balanceMinor > 0) */}
                {checkoutSuccess.balanceMinor > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.85rem',
                      marginTop: '0.4rem',
                      paddingTop: '0.4rem',
                      borderTop: '1px solid #e2e8f0',
                    }}
                  >
                    <span style={{ color: '#10b981' }}>Paid: {formatRupees(checkoutSuccess.paidMinor)}</span>
                    <span className="mono" style={{ color: '#ef4444', fontWeight: 700 }}>
                      Balance Due: {formatRupees(checkoutSuccess.balanceMinor)}
                    </span>
                  </div>
                )}
              </div>

              {/* WhatsApp Block (Section 4.3) */}
              {shop?.whatsappEnabled !== false && (
                <div
                  style={{
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: '12px',
                    padding: '1rem',
                    marginBottom: '1.25rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#166534', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span style={{ fontSize: '1.1rem' }}>💬</span> Share on WhatsApp
                    </span>

                    {/* Language Selector (en / hi / ta) */}
                    <div style={{ display: 'flex', gap: '3px', background: '#dcfce7', padding: '2px', borderRadius: '6px' }}>
                      {(['en', 'hi', 'ta'] as const).map((l) => (
                        <button
                          key={l}
                          type="button"
                          onClick={() => setSuccessLang(l)}
                          style={{
                            border: 'none',
                            background: successLang === l ? '#16a34a' : 'transparent',
                            color: successLang === l ? '#ffffff' : '#15803d',
                            fontSize: '0.72rem',
                            fontWeight: 600,
                            padding: '3px 8px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {l === 'en' ? 'English' : l === 'hi' ? 'हिन्दी' : 'தமிழ்'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Phone Input */}
                  <div style={{ marginBottom: '0.65rem' }}>
                    <input
                      type="tel"
                      className="form-input"
                      style={{
                        width: '100%',
                        borderColor: successPhoneError ? '#ef4444' : '#86efac',
                        background: '#ffffff',
                        fontSize: '0.95rem',
                        padding: '0.55rem 0.75rem',
                      }}
                      placeholder="Customer mobile number"
                      value={successPhone}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSuccessPhone(val);
                        if (!val.trim()) {
                          setSuccessPhoneError('');
                        } else {
                          const check = validateIndianPhone(val);
                          setSuccessPhoneError(check.valid ? '' : 'Enter a valid 10-digit mobile number');
                        }
                      }}
                    />
                    {successPhoneError && (
                      <div style={{ color: '#ef4444', fontSize: '0.78rem', marginTop: '4px', fontWeight: 500 }}>
                        {successPhoneError}
                      </div>
                    )}
                  </div>

                  {/* Send Button */}
                  <button
                    type="button"
                    disabled={!validateIndianPhone(successPhone).valid || isSendingWhatsApp}
                    onClick={handleSendWhatsAppFromSuccessModal}
                    style={{
                      width: '100%',
                      padding: '0.65rem 1rem',
                      borderRadius: '8px',
                      border: 'none',
                      background: validateIndianPhone(successPhone).valid ? '#25D366' : '#94a3b8',
                      color: '#ffffff',
                      fontWeight: 700,
                      fontSize: '0.95rem',
                      cursor: validateIndianPhone(successPhone).valid ? 'pointer' : 'not-allowed',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      boxShadow: validateIndianPhone(successPhone).valid ? '0 2px 4px rgba(37, 211, 102, 0.3)' : 'none',
                      transition: 'background 0.2s ease',
                    }}
                  >
                    <span>💬</span>
                    {successSendState === 'sent' ? 'Sent — Send Again' : 'Send Bill on WhatsApp'}
                  </button>
                </div>
              )}

              {/* Other Actions: Print Thermal & View A4 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <a
                  href={`/api/invoices/${checkoutSuccess.invoiceId}/print?paper=thermal80&autoprint=true`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.4rem',
                    padding: '0.6rem 0.75rem',
                    fontSize: '0.85rem',
                    textDecoration: 'none',
                    fontWeight: 600,
                  }}
                >
                  🖨️ Print Thermal Slip
                </a>
                <a
                  href={`/api/invoices/${checkoutSuccess.invoiceId}/print?paper=a4`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.4rem',
                    padding: '0.6rem 0.75rem',
                    fontSize: '0.85rem',
                    textDecoration: 'none',
                    fontWeight: 600,
                  }}
                >
                  📄 View A4 GST PDF
                </a>
              </div>

              {/* Footer: New Bill (Primary) */}
              <div>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    fontSize: '1rem',
                    fontWeight: 700,
                    borderRadius: '8px',
                  }}
                  onClick={handleStartNewBill}
                >
                  + Start New Bill
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          WHATSAPP BILL SHARING: INVOICES TABLE RESEND POPOVER (SECTION 5)
          ========================================================================= */}
      {resendInvoice && (
        <div
          className="modal-overlay"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setResendInvoice(null);
          }}
          tabIndex={-1}
        >
          <div
            className="modal-content"
            style={{
              maxWidth: '430px',
              width: '92%',
              borderRadius: '14px',
              padding: 0,
              overflow: 'hidden',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.25), 0 10px 10px -5px rgba(0, 0, 0, 0.15)',
            }}
          >
            {/* Popover Header */}
            <div
              style={{
                background: '#f0fdf4',
                padding: '1rem 1.25rem',
                borderBottom: '1px solid #bbf7d0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.25rem' }}>💬</span>
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#15803d', fontWeight: 600 }}>Resend Bill on WhatsApp</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#166534' }}>
                    #{resendInvoice.number}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setResendInvoice(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#15803d',
                  fontSize: '1.35rem',
                  cursor: 'pointer',
                  padding: '2px 6px',
                  lineHeight: 1,
                }}
                title="Close (Esc)"
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '1.25rem' }}>
              {/* Summary line */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '0.75rem',
                  marginBottom: '1rem',
                  fontSize: '0.85rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                  <span style={{ color: '#64748b' }}>Customer:</span>
                  <span style={{ fontWeight: 600 }}>{resendInvoice.customerName || 'Walk-in Customer'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Bill Total:</span>
                  <span className="mono" style={{ fontWeight: 700, color: '#0f172a' }}>
                    {formatRupees(resendInvoice.totalMinor)}
                  </span>
                </div>
                {resendInvoice.balanceMinor > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem', paddingTop: '0.25rem', borderTop: '1px solid #e2e8f0' }}>
                    <span style={{ color: '#ef4444', fontWeight: 600 }}>Balance Due:</span>
                    <span className="mono" style={{ color: '#ef4444', fontWeight: 700 }}>
                      {formatRupees(resendInvoice.balanceMinor)}
                    </span>
                  </div>
                )}
              </div>

              {/* Language Selector */}
              <div style={{ marginBottom: '0.85rem' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                  Message Language
                </label>
                <div style={{ display: 'flex', gap: '4px', background: '#f1f5f9', padding: '3px', borderRadius: '6px' }}>
                  {(['en', 'hi', 'ta'] as const).map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setResendLang(l)}
                      style={{
                        flex: 1,
                        border: 'none',
                        background: resendLang === l ? '#16a34a' : 'transparent',
                        color: resendLang === l ? '#ffffff' : '#334155',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        padding: '5px 8px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {l === 'en' ? 'English' : l === 'hi' ? 'हिन्दी' : 'தமிழ்'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Phone input */}
              <div style={{ marginBottom: '0.85rem' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.35rem' }}>
                  Customer Mobile Number
                </label>
                <input
                  type="tel"
                  className="form-input"
                  style={{
                    width: '100%',
                    borderColor: resendPhoneError ? '#ef4444' : '#cbd5e1',
                    fontSize: '0.95rem',
                    padding: '0.55rem 0.75rem',
                  }}
                  placeholder="10-digit mobile number"
                  value={resendPhone}
                  onChange={(e) => {
                    const val = e.target.value;
                    setResendPhone(val);
                    if (!val.trim()) {
                      setResendPhoneError('');
                    } else {
                      const check = validateIndianPhone(val);
                      setResendPhoneError(check.valid ? '' : 'Enter a valid 10-digit mobile number');
                    }
                  }}
                />
                {resendPhoneError && (
                  <div style={{ color: '#ef4444', fontSize: '0.78rem', marginTop: '4px', fontWeight: 500 }}>
                    {resendPhoneError}
                  </div>
                )}

                {/* Save to customer checkbox */}
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.82rem',
                    color: '#475569',
                    marginTop: '0.5rem',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    style={{ accentColor: '#16a34a' }}
                    checked={resendSaveToCustomer}
                    onChange={(e) => setResendSaveToCustomer(e.target.checked)}
                  />
                  Save mobile number to customer contact record
                </label>
              </div>

              {/* Send Button */}
              <button
                type="button"
                disabled={!validateIndianPhone(resendPhone).valid || isSendingWhatsApp}
                onClick={handleSendWhatsAppResend}
                style={{
                  width: '100%',
                  padding: '0.65rem 1rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: validateIndianPhone(resendPhone).valid ? '#25D366' : '#94a3b8',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  cursor: validateIndianPhone(resendPhone).valid ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  boxShadow: validateIndianPhone(resendPhone).valid ? '0 2px 4px rgba(37, 211, 102, 0.3)' : 'none',
                  transition: 'background 0.2s ease',
                  marginBottom: '0.5rem',
                }}
              >
                <span>💬</span>
                {resendSendState === 'sent' ? 'Sent — Send Again' : 'Send Bill on WhatsApp'}
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                style={{ width: '100%', padding: '0.55rem' }}
                onClick={() => setResendInvoice(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Khata Payment Collection Modal (Section 5) */}
      {collectPaymentCustomer && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1050,
            padding: '1rem',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseCollectModal();
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '680px',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
              borderRadius: '12px',
              overflow: 'hidden',
              background: '#ffffff',
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '1rem 1.25rem',
                borderBottom: '1px solid #e2e8f0',
                background: '#f8fafc',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1.25rem' }}>💰</span>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>
                    Collect Payment — {collectPaymentCustomer.name}
                  </h3>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>
                  <span>📞 {collectPaymentCustomer.phone || 'No phone'}</span>
                  {collectPaymentCustomer.gstin && <span>🏛️ {collectPaymentCustomer.gstin}</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseCollectModal}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.35rem',
                  cursor: 'pointer',
                  color: '#64748b',
                  lineHeight: 1,
                  padding: '4px 8px',
                }}
                title="Close"
              >
                ✕
              </button>
            </div>

            {/* Scrollable Body */}
            <div style={{ padding: '1.25rem', overflowY: 'auto', flex: 1 }}>
              {collectLoading ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                  Loading customer dues...
                </div>
              ) : (
                <>
                  {/* Dues and Live Balance Preview Banner */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                      gap: '0.75rem',
                      background: '#f1f5f9',
                      padding: '0.85rem',
                      borderRadius: '8px',
                      marginBottom: '1rem',
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Total Dues</div>
                      <div className="mono" style={{ fontSize: '1.05rem', fontWeight: 700, color: (collectKhataData?.totalDuesMinor || 0) > 0 ? '#ef4444' : '#16a34a' }}>
                        {formatRupees(collectKhataData?.totalDuesMinor || 0)}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Amount Paying</div>
                      <div className="mono" style={{ fontSize: '1.05rem', fontWeight: 700, color: '#2563eb' }}>
                        {formatRupees(Math.round((parseFloat(collectAmountRupees) || 0) * 100))}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>Balance After</div>
                      <div className="mono" style={{ fontSize: '1.05rem', fontWeight: 700, color: Math.max(0, (collectKhataData?.totalDuesMinor || 0) - Math.round((parseFloat(collectAmountRupees) || 0) * 100)) > 0 ? '#b91c1c' : '#16a34a' }}>
                        {formatRupees(Math.max(0, (collectKhataData?.totalDuesMinor || 0) - Math.round((parseFloat(collectAmountRupees) || 0) * 100)))}
                      </div>
                    </div>
                    {collectKhataData && Math.round((parseFloat(collectAmountRupees) || 0) * 100) > collectKhataData.totalDuesMinor && (
                      <div>
                        <div style={{ fontSize: '0.75rem', color: '#15803d', fontWeight: 600 }}>Advance Created</div>
                        <div className="mono" style={{ fontSize: '1.05rem', fontWeight: 700, color: '#16a34a' }}>
                          +{formatRupees(Math.round((parseFloat(collectAmountRupees) || 0) * 100) - collectKhataData.totalDuesMinor)}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Advance Warning if customer already has advance */}
                  {(collectKhataData?.party.advanceMinor || 0) > 0 && (
                    <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '0.6rem 0.85rem', marginBottom: '1rem', fontSize: '0.82rem', color: '#166534', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>ℹ️</span>
                      <span>Customer already has <strong>{formatRupees(collectKhataData?.party.advanceMinor || 0)}</strong> in unallocated Advance.</span>
                    </div>
                  )}

                  {/* Form inputs */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem', marginBottom: '1rem' }}>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                        <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>
                          Amount Received (₹) <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        {collectKhataData && collectKhataData.totalDuesMinor > 0 && (
                          <button
                            type="button"
                            onClick={() => handleCollectAmountChange((collectKhataData.totalDuesMinor / 100).toFixed(2))}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#2563eb',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                              padding: 0,
                            }}
                          >
                            Pay Full Dues ({formatRupees(collectKhataData.totalDuesMinor)})
                          </button>
                        )}
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="input"
                        placeholder="0.00"
                        value={collectAmountRupees}
                        onChange={(e) => handleCollectAmountChange(e.target.value)}
                        style={{ fontSize: '1.25rem', fontWeight: 700, padding: '0.6rem', color: '#0f172a' }}
                        autoFocus
                      />
                      {/* Quick Fill Chips */}
                      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem', flexWrap: 'wrap' }}>
                        {[500, 1000, 2000, 5000].map((chip) => (
                          <button
                            key={chip}
                            type="button"
                            onClick={() => handleCollectAmountChange(chip.toString())}
                            style={{
                              background: '#f1f5f9',
                              border: '1px solid #cbd5e1',
                              borderRadius: '4px',
                              padding: '2px 8px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                              color: '#475569',
                            }}
                          >
                            + ₹{chip}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '0.35rem' }}>
                        Payment Mode <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <select
                        className="input"
                        value={collectMode}
                        onChange={(e) => setCollectMode(e.target.value as any)}
                        style={{ padding: '0.55rem' }}
                      >
                        <option value="cash">💵 Cash</option>
                        <option value="upi">📱 UPI</option>
                        <option value="card">💳 Card</option>
                        <option value="bank">🏦 Bank Transfer</option>
                        <option value="cheque">📜 Cheque</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '0.35rem' }}>
                        Reference / UTR / Cheque #
                      </label>
                      <input
                        type="text"
                        className="input"
                        placeholder="e.g. UPI Ref / Cheque 123456"
                        value={collectReferenceNo}
                        onChange={(e) => setCollectReferenceNo(e.target.value)}
                        style={{ padding: '0.55rem' }}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '0.35rem' }}>
                        Payment Date
                      </label>
                      <input
                        type="date"
                        className="input"
                        value={collectPaymentDate ? collectPaymentDate.slice(0, 10) : ''}
                        max={new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}
                        onChange={(e) => setCollectPaymentDate(e.target.value)}
                        style={{ padding: '0.55rem' }}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '0.35rem' }}>
                        Note / Remarks
                      </label>
                      <input
                        type="text"
                        className="input"
                        placeholder="Optional remarks"
                        value={collectNote}
                        onChange={(e) => setCollectNote(e.target.value)}
                        style={{ padding: '0.55rem' }}
                      />
                    </div>
                  </div>

                  {/* Allocation Table (Oldest First FIFO by default) */}
                  <div style={{ marginTop: '1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155' }}>
                        Bill Allocation (Oldest First)
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                        You can adjust allocations manually
                      </span>
                    </div>

                    {collectKhataData && collectKhataData.unpaidInvoices.length > 0 ? (
                      <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                          <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                            <tr>
                              <th style={{ padding: '6px 10px' }}>Bill #</th>
                              <th style={{ padding: '6px 10px' }}>Date</th>
                              <th style={{ padding: '6px 10px', textAlign: 'right' }}>Total</th>
                              <th style={{ padding: '6px 10px', textAlign: 'right' }}>Balance Due</th>
                              <th style={{ padding: '6px 10px', textAlign: 'right', width: '140px' }}>Allocated (₹)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {collectKhataData.unpaidInvoices.map((inv) => (
                              <tr key={inv.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                <td style={{ padding: '6px 10px', fontWeight: 600 }}>{inv.number}</td>
                                <td style={{ padding: '6px 10px', color: '#64748b' }}>{inv.bdate}</td>
                                <td className="mono" style={{ padding: '6px 10px', textAlign: 'right' }}>{formatRupees(inv.totalMinor)}</td>
                                <td className="mono" style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: '#ef4444' }}>
                                  {formatRupees(inv.balanceMinor)}
                                </td>
                                <td style={{ padding: '4px 10px', textAlign: 'right' }}>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max={(inv.balanceMinor / 100).toFixed(2)}
                                    value={collectAllocations[inv.id] ?? '0.00'}
                                    onChange={(e) => handleRowAllocChange(inv.id, e.target.value)}
                                    style={{
                                      width: '100px',
                                      padding: '3px 6px',
                                      textAlign: 'right',
                                      borderRadius: '4px',
                                      border: '1px solid #cbd5e1',
                                      fontSize: '0.85rem',
                                      fontWeight: 600,
                                    }}
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '6px', padding: '1.25rem', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
                        Customer has no unpaid bills. The payment of <strong>{formatRupees(Math.round((parseFloat(collectAmountRupees) || 0) * 100))}</strong> will be recorded as an Advance.
                      </div>
                    )}
                  </div>

                  {/* Discard confirmation notice */}
                  {collectDiscardConfirm && (
                    <div style={{ marginTop: '1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '0.75rem', fontSize: '0.82rem', color: '#991b1b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>You have entered an amount. Discard this payment?</span>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          type="button"
                          onClick={() => setCollectDiscardConfirm(false)}
                          style={{ padding: '3px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontSize: '0.75rem' }}
                        >
                          Stay
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCollectDiscardConfirm(false);
                            setCollectPaymentCustomer(null);
                            setCollectKhataData(null);
                          }}
                          style={{ padding: '3px 8px', borderRadius: '4px', border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}
                        >
                          Discard
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Error display */}
                  {collectError && (
                    <div style={{ marginTop: '1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '0.75rem', fontSize: '0.82rem', color: '#dc2626' }}>
                      ⚠️ {collectError}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.85rem 1.25rem',
                borderTop: '1px solid #e2e8f0',
                background: '#f8fafc',
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCloseCollectModal}
                disabled={collectSaving}
              >
                Cancel
              </button>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => handleSavePayment(true)}
                  disabled={collectSaving || !parseFloat(collectAmountRupees) || parseFloat(collectAmountRupees) <= 0}
                  title="Record this payment and immediately open collection modal for split payment"
                >
                  Save & Add Another
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleSavePayment(false)}
                  disabled={collectSaving || !parseFloat(collectAmountRupees) || parseFloat(collectAmountRupees) <= 0}
                  style={{
                    background: '#16a34a',
                    borderColor: '#15803d',
                    fontWeight: 700,
                  }}
                >
                  {collectSaving ? 'Recording...' : `Record Payment (${formatRupees(Math.round((parseFloat(collectAmountRupees) || 0) * 100))})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Receipt Success View Modal (Section 8 & 9) */}
      {receiptSuccessPayment && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1060,
            padding: '1rem',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setReceiptSuccessPayment(null);
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '520px',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
              borderRadius: '12px',
              overflow: 'hidden',
              background: '#ffffff',
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '1rem 1.25rem',
                borderBottom: '1px solid #bbf7d0',
                background: '#f0fdf4',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    background: '#22c55e',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '1.1rem',
                  }}
                >
                  ✓
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#14532d' }}>
                    Payment Recorded Successfully
                  </h3>
                  <div style={{ fontSize: '0.78rem', color: '#15803d' }}>
                    Receipt #{receiptSuccessPayment.receiptNumber} • {receiptSuccessPayment.mode.toUpperCase()}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReceiptSuccessPayment(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '1.35rem',
                  cursor: 'pointer',
                  color: '#15803d',
                  padding: '2px 6px',
                }}
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '1.25rem', overflowY: 'auto', flex: 1 }}>
              {/* Summary Card */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '0.85rem',
                  marginBottom: '1rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <span style={{ color: '#64748b', fontSize: '0.85rem' }}>Customer:</span>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{receiptSuccessPayment.customerName || 'Customer'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                  <span style={{ color: '#64748b', fontSize: '0.85rem' }}>Amount Received:</span>
                  <span className="mono" style={{ fontWeight: 700, fontSize: '1.15rem', color: '#16a34a' }}>
                    {formatRupees(receiptSuccessPayment.amountMinor)}
                  </span>
                </div>
                {receiptSuccessPayment.allocations && receiptSuccessPayment.allocations.length > 0 && (
                  <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px dashed #e2e8f0', fontSize: '0.8rem' }}>
                    <div style={{ color: '#64748b', marginBottom: '0.25rem' }}>Settled against bills:</div>
                    {receiptSuccessPayment.allocations.map((a) => (
                      <div key={a.invoiceId} style={{ display: 'flex', justifyContent: 'space-between', color: '#334155', padding: '1px 0' }}>
                        <span>• Bill #{a.invoiceNumber}</span>
                        <span className="mono" style={{ fontWeight: 600 }}>{formatRupees(a.amountMinor)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {receiptSuccessPayment.advanceMinor > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.35rem', paddingTop: '0.35rem', borderTop: '1px dashed #e2e8f0', fontSize: '0.8rem', color: '#15803d' }}>
                    <span>Advance Created:</span>
                    <span className="mono" style={{ fontWeight: 600 }}>+{formatRupees(receiptSuccessPayment.advanceMinor)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid #e2e8f0', fontSize: '0.85rem' }}>
                  <span style={{ color: '#64748b' }}>Remaining Khata Dues:</span>
                  <span className="mono" style={{ fontWeight: 700, color: (receiptSuccessPayment.balanceAfterMinor ?? 0) > 0 ? '#ef4444' : '#16a34a' }}>
                    {formatRupees(receiptSuccessPayment.balanceAfterMinor ?? 0)}
                  </span>
                </div>
              </div>

              {/* Print Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '1.25rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    const w = window.open(`/api/payments/${receiptSuccessPayment.id}/receipt?format=thermal80`, '_blank', 'width=420,height=600');
                    if (w) w.focus();
                  }}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', padding: '0.55rem' }}
                >
                  <span>🖨️</span>
                  <span>Print Thermal</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    const w = window.open(`/api/payments/${receiptSuccessPayment.id}/receipt?format=a4`, '_blank');
                    if (w) w.focus();
                  }}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', padding: '0.55rem' }}
                >
                  <span>📄</span>
                  <span>View A4 PDF</span>
                </button>
              </div>

              {/* WhatsApp Share Section */}
              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.65rem' }}>
                  <span style={{ fontSize: '1.1rem' }}>💬</span>
                  <span style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0f172a' }}>
                    Send Payment Receipt on WhatsApp
                  </span>
                </div>

                {shop?.whatsappEnabled === false ? (
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '0.75rem', fontSize: '0.8rem', color: '#64748b' }}>
                    WhatsApp sharing is currently disabled in Shop Settings.
                  </div>
                ) : (
                  <>
                    {/* Language selector */}
                    <div style={{ marginBottom: '0.75rem' }}>
                      <div style={{ display: 'flex', gap: '4px', background: '#f1f5f9', padding: '3px', borderRadius: '6px' }}>
                        {(['en', 'hi', 'ta'] as const).map((l) => (
                          <button
                            key={l}
                            type="button"
                            onClick={() => setReceiptSuccessLang(l)}
                            style={{
                              flex: 1,
                              border: 'none',
                              background: receiptSuccessLang === l ? '#16a34a' : 'transparent',
                              color: receiptSuccessLang === l ? '#ffffff' : '#334155',
                              fontSize: '0.8rem',
                              fontWeight: 600,
                              padding: '4px 8px',
                              borderRadius: '4px',
                              cursor: 'pointer',
                            }}
                          >
                            {l === 'en' ? 'English' : l === 'hi' ? 'हिन्दी' : 'தமிழ்'}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Phone input */}
                    <div style={{ marginBottom: '0.75rem' }}>
                      <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.3rem' }}>
                        Customer WhatsApp Number
                      </label>
                      <input
                        type="tel"
                        className="input"
                        placeholder="10-digit mobile number"
                        value={receiptSuccessPhone}
                        onChange={(e) => {
                          setReceiptSuccessPhone(e.target.value);
                          setReceiptSuccessPhoneError('');
                        }}
                        style={{ padding: '0.55rem' }}
                      />
                      {receiptSuccessPhoneError && (
                        <div style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                          {receiptSuccessPhoneError}
                        </div>
                      )}
                      {!receiptSuccessPayment.customerPhone && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: '#475569', marginTop: '0.4rem', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={receiptSuccessSavePhone}
                            onChange={(e) => setReceiptSuccessSavePhone(e.target.checked)}
                          />
                          Save this number to customer profile
                        </label>
                      )}
                    </div>

                    {/* WhatsApp Action Button */}
                    <button
                      type="button"
                      onClick={() => handleSendReceiptWhatsApp()}
                      style={{
                        width: '100%',
                        padding: '0.65rem',
                        borderRadius: '6px',
                        border: 'none',
                        background: '#25D366',
                        color: '#ffffff',
                        fontWeight: 700,
                        fontSize: '0.9rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.5rem',
                        boxShadow: '0 2px 4px rgba(37, 211, 102, 0.3)',
                      }}
                    >
                      <span>💬</span>
                      {receiptSuccessSendState === 'sent' ? 'Sent — Send Again' : 'Send Receipt on WhatsApp'}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Footer */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                padding: '0.75rem 1.25rem',
                borderTop: '1px solid #e2e8f0',
                background: '#f8fafc',
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setReceiptSuccessPayment(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Detail & Khata Ledger Modal (Section 11 & 12) */}
      {ledgerCustomer && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1040,
            padding: '1rem',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setLedgerCustomer(null);
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '850px',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
              borderRadius: '12px',
              overflow: 'hidden',
              background: '#ffffff',
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '1rem 1.25rem',
                borderBottom: '1px solid #e2e8f0',
                background: '#f8fafc',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <span style={{ fontSize: '1.25rem' }}>📖</span>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#0f172a' }}>
                    Khata Ledger — {ledgerCustomer.name}
                  </h3>
                </div>
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>
                  <span>📞 {ledgerCustomer.phone || 'No phone'}</span>
                  {ledgerCustomer.gstin && <span>🏛️ GSTIN: {ledgerCustomer.gstin}</span>}
                  {ledgerCustomer.address && <span>📍 {ledgerCustomer.address}</span>}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => openCollectPayment(ledgerCustomer)}
                  style={{ background: '#16a34a', borderColor: '#15803d', padding: '0.4rem 0.8rem', fontSize: '0.82rem' }}
                >
                  💰 Collect Payment
                </button>
                <button
                  type="button"
                  onClick={() => setLedgerCustomer(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    fontSize: '1.35rem',
                    cursor: 'pointer',
                    color: '#64748b',
                    padding: '2px 6px',
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Filter and Summary Bar */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.75rem',
                padding: '0.75rem 1.25rem',
                borderBottom: '1px solid #e2e8f0',
                background: '#ffffff',
              }}
            >
              {/* Date Filters */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem' }}>
                <span style={{ color: '#64748b', fontWeight: 600 }}>From:</span>
                <input
                  type="date"
                  className="input"
                  value={ledgerFromDate}
                  onChange={(e) => setLedgerFromDate(e.target.value)}
                  style={{ padding: '3px 6px', fontSize: '0.8rem' }}
                />
                <span style={{ color: '#64748b', fontWeight: 600 }}>To:</span>
                <input
                  type="date"
                  className="input"
                  value={ledgerToDate}
                  onChange={(e) => setLedgerToDate(e.target.value)}
                  style={{ padding: '3px 6px', fontSize: '0.8rem' }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleFilterLedger}
                  style={{ padding: '3px 8px', fontSize: '0.8rem' }}
                >
                  Apply Filter
                </button>
              </div>

              {/* Balances & Statement Button */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 600 }}>OUTSTANDING DUES</div>
                  <div className="mono" style={{ fontSize: '1rem', fontWeight: 700, color: (ledgerData?.currentDuesMinor || 0) > 0 ? '#ef4444' : '#16a34a' }}>
                    {formatRupees(ledgerData?.currentDuesMinor || 0)}
                  </div>
                </div>

                {(ledgerData?.advanceMinor || 0) > 0 && (
                  <div style={{ textAlign: 'right', borderLeft: '1px solid #e2e8f0', paddingLeft: '0.75rem' }}>
                    <div style={{ fontSize: '0.7rem', color: '#15803d', fontWeight: 600 }}>ADVANCE HELD</div>
                    <div className="mono" style={{ fontSize: '1rem', fontWeight: 700, color: '#16a34a' }}>
                      {formatRupees(ledgerData?.advanceMinor || 0)}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    const params = new URLSearchParams();
                    if (ledgerFromDate) params.append('from', ledgerFromDate);
                    if (ledgerToDate) params.append('to', ledgerToDate);
                    const w = window.open(`/api/parties/${ledgerCustomer.id}/statement?${params.toString()}`, '_blank');
                    if (w) w.focus();
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.4rem 0.75rem', fontSize: '0.82rem' }}
                >
                  <span>📄</span>
                  <span>Print A4 Statement</span>
                </button>
              </div>
            </div>

            {/* Ledger Table */}
            <div style={{ padding: '1rem 1.25rem', overflowY: 'auto', flex: 1 }}>
              {ledgerLoading ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                  Loading ledger transactions...
                </div>
              ) : !ledgerData || ledgerData.events.length === 0 ? (
                <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
                  No transactions found for this customer.
                </div>
              ) : (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left' }}>
                      <tr>
                        <th style={{ padding: '8px 10px' }}>Date</th>
                        <th style={{ padding: '8px 10px' }}>Type</th>
                        <th style={{ padding: '8px 10px' }}>Ref / Doc #</th>
                        <th style={{ padding: '8px 10px' }}>Details / Mode</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right' }}>Debit (Bills)</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right' }}>Credit (Paid)</th>
                        <th style={{ padding: '8px 10px', textAlign: 'right' }}>Running Balance</th>
                        <th style={{ padding: '8px 10px', textAlign: 'center' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerData.events.map((ev, idx) => {
                        const isReversed = ev.status === 'reversed';
                        const isPayment = ev.kind === 'payment';
                        const canReverse = isPayment && !isReversed && (user?.role === 'owner' || user?.role === 'manager');

                        return (
                          <tr
                            key={ev.id || idx}
                            style={{
                              borderBottom: '1px solid #f1f5f9',
                              background: isReversed ? '#fff1f2' : idx % 2 === 0 ? '#ffffff' : '#fafafa',
                              opacity: isReversed ? 0.75 : 1,
                            }}
                          >
                            <td style={{ padding: '8px 10px', color: '#64748b' }}>
                              {ev.date.slice(0, 10)}
                            </td>
                            <td style={{ padding: '8px 10px' }}>
                              {ev.kind === 'invoice' ? (
                                <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600 }}>
                                  BILL
                                </span>
                              ) : isReversed ? (
                                <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 6px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600 }}>
                                  REVERSED
                                </span>
                              ) : (
                                <span style={{ background: '#dcfce7', color: '#15803d', padding: '2px 6px', borderRadius: '4px', fontSize: '0.72rem', fontWeight: 600 }}>
                                  PAYMENT
                                </span>
                              )}
                            </td>
                            <td style={{ padding: '8px 10px', fontWeight: 600, textDecoration: isReversed ? 'line-through' : 'none' }}>
                              {ev.number}
                            </td>
                            <td style={{ padding: '8px 10px', color: '#475569', fontSize: '0.78rem' }}>
                              {ev.mode ? ev.mode.toUpperCase() : ''}
                              {ev.referenceNo ? ` • Ref: ${ev.referenceNo}` : ''}
                              {isReversed && ev.reversalReason ? (
                                <div style={{ color: '#b91c1c', fontSize: '0.72rem', marginTop: '2px' }}>
                                  Reason: {ev.reversalReason}
                                </div>
                              ) : null}
                            </td>
                            <td className="mono" style={{ padding: '8px 10px', textAlign: 'right', fontWeight: ev.debitMinor > 0 ? 600 : 400, color: ev.debitMinor > 0 ? '#0f172a' : '#94a3b8' }}>
                              {ev.debitMinor > 0 ? formatRupees(ev.debitMinor) : '—'}
                            </td>
                            <td className="mono" style={{ padding: '8px 10px', textAlign: 'right', fontWeight: ev.creditMinor > 0 ? 600 : 400, color: ev.creditMinor > 0 ? '#16a34a' : '#94a3b8', textDecoration: isReversed ? 'line-through' : 'none' }}>
                              {ev.creditMinor > 0 ? formatRupees(ev.creditMinor) : '—'}
                            </td>
                            <td className="mono" style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: ev.runningBalanceMinor > 0 ? '#ef4444' : '#16a34a' }}>
                              {formatRupees(ev.runningBalanceMinor)}
                            </td>
                            <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                              {canReverse && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReversingPayment(ev);
                                    setReversalReason('');
                                    setReversalError(null);
                                  }}
                                  style={{
                                    border: '1px solid #fecaca',
                                    background: '#fff',
                                    color: '#dc2626',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    fontSize: '0.72rem',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                  }}
                                  title="Reverse this payment"
                                >
                                  Reverse
                                </button>
                              )}
                              {isReversed && (
                                <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}>—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Reversal Confirmation Modal Sub-overlay */}
            {reversingPayment && (
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  background: 'rgba(15, 23, 42, 0.75)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1070,
                  padding: '1rem',
                }}
              >
                <div
                  className="card"
                  style={{
                    width: '100%',
                    maxWidth: '460px',
                    borderRadius: '10px',
                    padding: '1.25rem',
                    background: '#ffffff',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.25)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#b91c1c', marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '1.25rem' }}>⚠️</span>
                    <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
                      Reverse Payment {'receiptNumber' in reversingPayment ? (reversingPayment as any).receiptNumber : reversingPayment.number}?
                    </h4>
                  </div>

                  <p style={{ fontSize: '0.82rem', color: '#475569', marginBottom: '0.75rem', lineHeight: 1.4 }}>
                    This action will permanently reverse the payment of <strong>{formatRupees(reversingPayment.amountMinor)}</strong>.
                    Any settled bills will have their unpaid balance restored, and an immutable reversal event will be logged in the ledger.
                  </p>

                  <div style={{ marginBottom: '0.85rem' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '0.35rem' }}>
                      Reversal Reason <span style={{ color: '#ef4444' }}>*</span>
                    </label>
                    <textarea
                      className="input"
                      rows={2}
                      placeholder="e.g. Cheque bounced / Wrong customer selected"
                      value={reversalReason}
                      onChange={(e) => setReversalReason(e.target.value)}
                      style={{ width: '100%', padding: '0.5rem', fontSize: '0.82rem' }}
                      autoFocus
                    />
                  </div>

                  {reversalError && (
                    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '0.5rem', color: '#dc2626', fontSize: '0.78rem', marginBottom: '0.75rem' }}>
                      ⚠️ {reversalError}
                    </div>
                  )}

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setReversingPayment(null);
                        setReversalError(null);
                      }}
                      disabled={reversingLoading}
                      style={{ padding: '0.4rem 0.8rem', fontSize: '0.82rem' }}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirmReversal}
                      disabled={reversingLoading || !reversalReason.trim()}
                      style={{
                        padding: '0.4rem 0.85rem',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        background: '#dc2626',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                      }}
                    >
                      {reversingLoading ? 'Reversing...' : 'Confirm Reversal'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* WhatsApp Correction Notice Sub-overlay */}
            {reversalWhatsAppNotice && (
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  background: 'rgba(15, 23, 42, 0.75)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 1080,
                  padding: '1rem',
                }}
              >
                <div
                  className="card"
                  style={{
                    width: '100%',
                    maxWidth: '440px',
                    borderRadius: '10px',
                    padding: '1.25rem',
                    background: '#ffffff',
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.25)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#b45309', marginBottom: '0.75rem' }}>
                    <span style={{ fontSize: '1.25rem' }}>💬</span>
                    <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
                      Send WhatsApp Reversal Notice?
                    </h4>
                  </div>

                  <p style={{ fontSize: '0.82rem', color: '#475569', marginBottom: '1rem', lineHeight: 1.4 }}>
                    Receipt <strong>#{reversalWhatsAppNotice.receiptNo}</strong> was previously shared on WhatsApp.
                    Would you like to send an automated correction notice to the customer?
                  </p>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setReversalWhatsAppNotice(null)}
                      style={{ padding: '0.4rem 0.8rem', fontSize: '0.82rem' }}
                    >
                      Skip
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSendCorrectionWhatsApp(reversalWhatsAppNotice.receiptNo, reversalWhatsAppNotice.amountMinor, reversalWhatsAppNotice.phone)}
                      style={{
                        padding: '0.4rem 0.85rem',
                        fontSize: '0.82rem',
                        fontWeight: 700,
                        background: '#25D366',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                      }}
                    >
                      <span>💬</span>
                      <span>Send Correction</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Footer */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                padding: '0.75rem 1.25rem',
                borderTop: '1px solid #e2e8f0',
                background: '#f8fafc',
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setLedgerCustomer(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 1. Invoice Detail Modal with Returns & Credit Notes Zone */}
      {/* ========================================================= */}
      {selectedInvoiceDetailId && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1040,
            padding: '1rem',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedInvoiceDetailId(null);
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '820px',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
              borderRadius: '12px',
              overflow: 'hidden',
              background: '#ffffff',
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '1rem 1.25rem',
                borderBottom: '1px solid #e2e8f0',
                background: '#f8fafc',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#0f172a' }}>
                    Bill #{invoiceDetailData?.invoice?.number || selectedInvoiceDetailId}
                  </h3>
                  {invoiceDetailData?.invoice?.status && (
                    <span
                      className="badge"
                      style={{
                        background: invoiceDetailData.invoice.status === 'posted' ? '#dcfce7' : '#fee2e2',
                        color: invoiceDetailData.invoice.status === 'posted' ? '#15803d' : '#b91c1c',
                        textTransform: 'uppercase',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                      }}
                    >
                      {invoiceDetailData.invoice.status}
                    </span>
                  )}
                  {invoiceDetailData?.invoice?.kind === 'credit_note' && (
                    <span className="badge" style={{ background: '#e0e7ff', color: '#4338ca', fontSize: '0.7rem' }}>
                      CREDIT NOTE
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
                  Issued on {invoiceDetailData?.invoice?.bdate ? new Date(invoiceDetailData.invoice.bdate).toLocaleDateString('en-IN') : '—'}
                  {invoiceDetailData?.invoice?.customerName && ` • Customer: ${invoiceDetailData.invoice.customerName}`}
                  {invoiceDetailData?.invoice?.customerPhone && ` (📞 ${invoiceDetailData.invoice.customerPhone})`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedInvoiceDetailId(null)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '1.25rem', overflowY: 'auto', flex: 1 }}>
              {invoiceDetailLoading || !invoiceDetailData ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                  Loading bill details...
                </div>
              ) : (
                <>
                  {/* Billed Items Table */}
                  <div style={{ marginBottom: '1.25rem' }}>
                    <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#334155', marginBottom: '0.5rem' }}>
                      Billed Items ({invoiceDetailData.lines?.length || 0} items)
                    </h4>
                    <table className="data-table" style={{ fontSize: '0.8rem' }}>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Item</th>
                          <th>HSN</th>
                          <th>Qty</th>
                          <th>Price</th>
                          <th>Taxable</th>
                          <th>Tax</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {invoiceDetailData.lines?.map((l: any, idx: number) => (
                          <tr key={l.id || idx}>
                            <td>{idx + 1}</td>
                            <td>
                              <b>{l.name}</b>
                            </td>
                            <td>{l.hsn || '—'}</td>
                            <td>{(l.qtyMilli / 1000).toLocaleString()} {l.unit || ''}</td>
                            <td>{formatRupees(l.priceMinor)}</td>
                            <td>{formatRupees(l.taxableMinor)}</td>
                            <td>{formatRupees(l.cgstMinor + l.sgstMinor)}</td>
                            <td style={{ fontWeight: 700 }}>{formatRupees(l.totalMinor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Totals Summary */}
                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      padding: '0.85rem 1rem',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                      gap: '0.75rem',
                      marginBottom: '1.5rem',
                      fontSize: '0.8rem',
                    }}
                  >
                    <div>
                      <div style={{ color: '#64748b' }}>Taxable Value</div>
                      <div style={{ fontWeight: 700 }}>{formatRupees(invoiceDetailData.invoice.taxableMinor)}</div>
                    </div>
                    <div>
                      <div style={{ color: '#64748b' }}>CGST + SGST</div>
                      <div style={{ fontWeight: 700 }}>{formatRupees(invoiceDetailData.invoice.cgstMinor + invoiceDetailData.invoice.sgstMinor)}</div>
                    </div>
                    {invoiceDetailData.invoice.roundOffMinor !== 0 && (
                      <div>
                        <div style={{ color: '#64748b' }}>Round Off</div>
                        <div style={{ fontWeight: 700 }}>{invoiceDetailData.invoice.roundOffMinor > 0 ? '+' : ''}{formatRupees(invoiceDetailData.invoice.roundOffMinor)}</div>
                      </div>
                    )}
                    <div>
                      <div style={{ color: '#64748b' }}>Total Bill</div>
                      <div style={{ fontWeight: 800, color: '#1e1b4b' }}>{formatRupees(invoiceDetailData.invoice.totalMinor)}</div>
                    </div>
                    <div>
                      <div style={{ color: '#64748b' }}>Paid Amount</div>
                      <div style={{ fontWeight: 700, color: '#16a34a' }}>{formatRupees(invoiceDetailData.invoice.paidMinor)}</div>
                    </div>
                    <div>
                      <div style={{ color: '#64748b' }}>Balance Due</div>
                      <div style={{ fontWeight: 700, color: invoiceDetailData.invoice.balanceMinor > 0 ? '#ea580c' : '#16a34a' }}>
                        {formatRupees(invoiceDetailData.invoice.balanceMinor)}
                      </div>
                    </div>
                  </div>

                  {/* Returns & Credit Notes Zone (Section 4.2) */}
                  <div style={{ borderTop: '2px solid #e2e8f0', paddingTop: '1.25rem', marginTop: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: '#1e293b' }}>
                          🔄 Returns & Credit Notes
                        </h4>
                        {invoiceDetailData.creditNotes && invoiceDetailData.creditNotes.length > 0 && (
                          <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
                            Returned {formatRupees(invoiceDetailData.invoice.returnedMinor || 0)} of {formatRupees(invoiceDetailData.invoice.totalMinor)} • {invoiceDetailData.creditNotes.length} credit note(s) issued
                          </div>
                        )}
                      </div>

                      {/* Return Action button */}
                      {invoiceDetailData.invoice.kind !== 'credit_note' && invoiceDetailData.invoice.status !== 'cancelled' && (
                        <button
                          type="button"
                          className="btn"
                          disabled={Boolean(invoiceDetailData.invoice.fullyReturned)}
                          style={{
                            padding: '0.35rem 0.75rem',
                            fontSize: '0.8rem',
                            fontWeight: 700,
                            background: invoiceDetailData.invoice.fullyReturned ? '#f1f5f9' : '#e0e7ff',
                            color: invoiceDetailData.invoice.fullyReturned ? '#94a3b8' : '#4338ca',
                            borderColor: invoiceDetailData.invoice.fullyReturned ? '#cbd5e1' : '#c7d2fe',
                            cursor: invoiceDetailData.invoice.fullyReturned ? 'not-allowed' : 'pointer',
                          }}
                          onClick={() => {
                            setSelectedInvoiceDetailId(null);
                            openReturnModal(invoiceDetailData.invoice.id);
                          }}
                          title={invoiceDetailData.invoice.fullyReturned ? 'Fully returned' : 'Issue a return against this bill'}
                        >
                          🔄 Issue Return / Credit Note
                        </button>
                      )}
                    </div>

                    {/* Credit notes list */}
                    {invoiceDetailData.creditNotes && invoiceDetailData.creditNotes.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                        {invoiceDetailData.creditNotes.map((cn: any) => (
                          <div
                            key={cn.id}
                            style={{
                              border: cn.status === 'voided' ? '1px dashed #ef4444' : '1px solid #cbd5e1',
                              borderRadius: '8px',
                              padding: '0.85rem 1rem',
                              background: cn.status === 'voided' ? '#fff5f5' : '#ffffff',
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontWeight: 800, color: '#4f46e5', fontSize: '0.9rem' }}>
                                  {cn.number}
                                </span>
                                <span
                                  className="badge"
                                  style={{
                                    background: cn.status === 'voided' ? '#fee2e2' : '#dcfce7',
                                    color: cn.status === 'voided' ? '#b91c1c' : '#15803d',
                                    fontSize: '0.68rem',
                                    fontWeight: 700,
                                    textTransform: 'uppercase',
                                  }}
                                >
                                  {cn.status}
                                </span>
                                <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                                  {new Date(cn.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                                </span>
                                {cn.createdByName && (
                                  <span style={{ fontSize: '0.75rem', color: '#475569' }}>
                                    by {cn.createdByName}
                                  </span>
                                )}
                              </div>

                              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                                <a
                                  href={`/api/credit-notes/${cn.id}/print?paper=thermal80&autoprint=true`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="btn btn-secondary"
                                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem', textDecoration: 'none' }}
                                >
                                  🖨️ Thermal
                                </a>
                                <a
                                  href={`/api/credit-notes/${cn.id}/print?paper=a4`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="btn btn-secondary"
                                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem', textDecoration: 'none' }}
                                >
                                  📄 A4
                                </a>
                                {shop?.whatsappEnabled !== false && cn.status !== 'voided' && (
                                  <button
                                    type="button"
                                    className="btn btn-secondary"
                                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem', color: '#15803d', borderColor: '#86efac', background: '#f0fdf4' }}
                                    onClick={() => handleOpenCreditNoteWhatsApp({
                                      id: cn.id,
                                      number: cn.number,
                                      originalInvoiceNumber: invoiceDetailData.invoice.number,
                                      phone: invoiceDetailData.invoice.customerPhone || '',
                                      customerName: invoiceDetailData.invoice.customerName,
                                      totalCreditMinor: cn.totalCreditMinor,
                                      settlementSummary: 'Credit Note issued',
                                      shareToken: cn.shareToken,
                                    })}
                                  >
                                    💬 WhatsApp
                                  </button>
                                )}
                                {cn.status !== 'voided' && (user?.role === 'owner' || user?.role === 'manager') && (
                                  <button
                                    type="button"
                                    className="btn"
                                    style={{
                                      padding: '0.25rem 0.5rem',
                                      fontSize: '0.72rem',
                                      fontWeight: 700,
                                      background: '#fee2e2',
                                      color: '#b91c1c',
                                      borderColor: '#fca5a5',
                                    }}
                                    onClick={() => handleOpenVoidModal({
                                      id: cn.id,
                                      number: cn.number,
                                      totalCreditMinor: cn.totalCreditMinor,
                                      advanceAmountMinor: cn.advanceAmountMinor || 0,
                                    })}
                                    title="Void this credit note (Owner/Manager only)"
                                  >
                                    🚫 Void
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Voided Details Banner */}
                            {cn.status === 'voided' && (
                              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '0.4rem 0.6rem', fontSize: '0.76rem', color: '#b91c1c', marginBottom: '0.5rem' }}>
                                ⚠️ <b>Voided</b> on {new Date(cn.voidedAt).toLocaleString('en-IN')}{cn.voidedByName ? ` by ${cn.voidedByName}` : ''}: "{cn.voidReason || 'No reason provided'}"
                              </div>
                            )}

                            {/* Returned Lines */}
                            <div style={{ fontSize: '0.78rem', marginBottom: '0.4rem' }}>
                              {cn.lines?.map((cl: any, cidx: number) => (
                                <div key={cidx} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                                  <div>
                                    <b>{cl.name}</b> × {(cl.qtyMilli / 1000).toLocaleString()} · Reason: <em>{cl.reason}</em> · Restock: <span style={{ fontWeight: 700, color: cl.restock ? '#16a34a' : '#dc2626' }}>{cl.restock ? 'YES' : 'NO'}</span>
                                  </div>
                                  <div style={{ fontWeight: 600 }}>{formatRupees(cl.totalMinor)}</div>
                                </div>
                              ))}
                            </div>

                            {/* Settlement Summary */}
                            <div style={{ borderTop: '1px dashed #cbd5e1', paddingTop: '0.4rem', fontSize: '0.76rem', color: '#475569' }}>
                              <b>Settlement:</b> Total Credit <b>{formatRupees(cn.totalCreditMinor)}</b>
                              {cn.allocations?.map((a: any, aidx: number) => (
                                <span key={aidx} style={{ marginLeft: '6px' }}>
                                  • {formatRupees(a.amountMinor)} adjusted on Bill #{a.invoiceNumber}
                                </span>
                              ))}
                              {cn.advanceAmountMinor > 0 && (
                                <span style={{ marginLeft: '6px', color: '#0369a1', fontWeight: 600 }}>
                                  • {formatRupees(cn.advanceAmountMinor)} kept as Customer Advance
                                </span>
                              )}
                              {cn.refundAmountMinor > 0 && (
                                <span style={{ marginLeft: '6px', color: '#0f172a', fontWeight: 600 }}>
                                  • {formatRupees(cn.refundAmountMinor)} refunded via {(cn.refundMode || 'cash').toUpperCase()}{cn.refundReference ? ` (Ref: ${cn.refundReference})` : ''}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '8px', textAlign: 'center', color: '#64748b', fontSize: '0.82rem' }}>
                        No returns or credit notes have been issued against this bill.
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                padding: '0.75rem 1.25rem',
                borderTop: '1px solid #e2e8f0',
                background: '#f8fafc',
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSelectedInvoiceDetailId(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 2. Create Return / Credit Note Modal (Sections 5, 6, 7)  */}
      {/* ========================================================= */}
      {returnModalInvoiceId && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1050,
            padding: '1rem',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCloseReturnModal();
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '860px',
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.25)',
              borderRadius: '12px',
              overflow: 'hidden',
              background: '#ffffff',
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '1rem 1.25rem',
                borderBottom: '1px solid #e2e8f0',
                background: '#f8fafc',
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#0f172a' }}>
                  Create Return / Credit Note — Against Bill #{returnInfo?.invoice?.number || ''}
                </h3>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
                  Customer: <b>{returnInfo?.customer?.name || returnInfo?.invoice?.customerName || 'Walk-in Customer'}</b>
                  {returnInfo?.invoice?.bdate && ` · Bill Date: ${new Date(returnInfo.invoice.bdate).toLocaleDateString('en-IN')}`}
                  {returnInfo && ` · Bill Total: ${formatRupees(returnInfo.invoice.totalMinor)}`}
                  {returnInfo && ` · Dues: ${formatRupees(returnInfo.invoice.balanceMinor)}`}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseReturnModal}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '1.25rem', overflowY: 'auto', flex: 1 }}>
              {returnInfoLoading || !returnInfo ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
                  Loading returnable items...
                </div>
              ) : (
                <>
                  {/* Warning if bill is older than 30 days (Section 12) */}
                  {returnInfo.billAgeDays > 30 && (
                    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '6px', padding: '0.65rem 0.85rem', fontSize: '0.8rem', color: '#b45309', marginBottom: '1rem' }}>
                      ⚠️ <b>Notice:</b> This bill is <b>{returnInfo.billAgeDays} days old</b>. As per GST policy, the credit note date is recorded as today so GST reversals land in the current period.
                    </div>
                  )}

                  {/* Discard confirmation warning */}
                  {returnDiscardConfirm && (
                    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '0.75rem', fontSize: '0.82rem', color: '#b91c1c', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>⚠️ You have entered return quantities. Discard and lose these changes?</span>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          type="button"
                          onClick={() => setReturnDiscardConfirm(false)}
                          style={{ padding: '3px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontSize: '0.75rem' }}
                        >
                          Continue Editing
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setReturnDiscardConfirm(false);
                            setReturnModalInvoiceId(null);
                            setReturnInfo(null);
                          }}
                          style={{ padding: '3px 8px', borderRadius: '4px', border: 'none', background: '#ef4444', color: '#fff', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }}
                        >
                          Discard
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Quick helper buttons (Section 14.1) */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#334155' }}>
                      Return Items & Restock Options
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        type="button"
                        onClick={handleReturnAll}
                        className="btn btn-secondary"
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem', fontWeight: 600 }}
                      >
                        ⚡ Return All
                      </button>
                      <button
                        type="button"
                        onClick={handleClearReturn}
                        className="btn btn-secondary"
                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                      >
                        Clear All
                      </button>
                    </div>
                  </div>

                  {/* Lines Table */}
                  <table className="data-table" style={{ fontSize: '0.8rem', marginBottom: '1.25rem' }}>
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Billed</th>
                        <th>Already Ret.</th>
                        <th style={{ width: '110px' }}>Return Qty</th>
                        <th style={{ width: '90px' }}>Restock?</th>
                        <th style={{ width: '180px' }}>Reason (Mandatory)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {returnInfo.lines.map((l) => {
                        const inp = returnLinesInput[l.id] || { returnQty: '', restock: true, reason: '', customReason: '' };
                        const returnableUnits = l.returnableQtyMilli / 1000;
                        const isFullyReturned = l.returnableQtyMilli === 0;

                        return (
                          <tr key={l.id} style={{ opacity: isFullyReturned ? 0.6 : 1 }}>
                            <td>
                              <b>{l.name}</b>
                              <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                                @ {formatRupees(l.priceMinor)} {l.unit ? `· ${l.unit}` : ''}
                              </div>
                            </td>
                            <td>{(l.billedQtyMilli / 1000).toLocaleString()}</td>
                            <td>{(l.alreadyReturnedQtyMilli / 1000).toLocaleString()}</td>
                            <td>
                              {isFullyReturned ? (
                                <span className="badge" style={{ background: '#f1f5f9', color: '#64748b', fontSize: '0.7rem' }}>
                                  Fully Ret.
                                </span>
                              ) : (
                                <input
                                  type="number"
                                  min="0"
                                  max={returnableUnits}
                                  step="any"
                                  placeholder={`Max ${returnableUnits}`}
                                  value={inp.returnQty}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setReturnLinesInput((prev) => ({
                                      ...prev,
                                      [l.id]: {
                                        ...(prev[l.id] || { restock: true, reason: '', customReason: '' }),
                                        returnQty: val,
                                      },
                                    }));
                                  }}
                                  style={{
                                    width: '100%',
                                    padding: '4px 6px',
                                    border: parseFloat(inp.returnQty) > returnableUnits ? '1px solid #ef4444' : '1px solid #cbd5e1',
                                    borderRadius: '4px',
                                    fontSize: '0.8rem',
                                    fontWeight: parseFloat(inp.returnQty) > 0 ? 700 : 400,
                                  }}
                                />
                              )}
                            </td>
                            <td>
                              <button
                                type="button"
                                disabled={isFullyReturned}
                                onClick={() => {
                                  setReturnLinesInput((prev) => {
                                    const cur = prev[l.id] || { returnQty: '', reason: '', customReason: '', restock: true };
                                    const newQty = (!parseFloat(cur.returnQty) && returnableUnits > 0)
                                      ? (returnableUnits >= 1 ? '1' : String(returnableUnits))
                                      : cur.returnQty;
                                    return {
                                      ...prev,
                                      [l.id]: {
                                        ...cur,
                                        returnQty: newQty,
                                        restock: !cur.restock,
                                      },
                                    };
                                  });
                                }}
                                style={{
                                  padding: '3px 8px',
                                  borderRadius: '4px',
                                  border: 'none',
                                  cursor: isFullyReturned ? 'not-allowed' : 'pointer',
                                  background: inp.restock ? '#dcfce7' : '#fee2e2',
                                  color: inp.restock ? '#15803d' : '#b91c1c',
                                  fontWeight: 700,
                                  fontSize: '0.72rem',
                                }}
                                title={inp.restock ? 'Item will return to sellable inventory' : 'Damaged / expired item will NOT enter stock'}
                              >
                                {inp.restock ? 'YES' : 'NO'}
                              </button>
                            </td>
                            <td>
                              <select
                                disabled={isFullyReturned}
                                value={inp.reason}
                                onChange={(e) => {
                                  const reasonVal = e.target.value;
                                  // Auto-toggle restock to false if Damaged or Expired
                                  const autoRestock = (reasonVal === 'Damaged' || reasonVal === 'Expired') ? false : inp.restock;
                                  // Auto-fill returnQty to 1 (or max returnable) if not yet entered
                                  const autoQty = (!parseFloat(inp.returnQty) && reasonVal && returnableUnits > 0)
                                    ? (returnableUnits >= 1 ? '1' : String(returnableUnits))
                                    : inp.returnQty;
                                  setReturnLinesInput((prev) => ({
                                    ...prev,
                                    [l.id]: {
                                      ...(prev[l.id] || { customReason: '' }),
                                      returnQty: autoQty,
                                      reason: reasonVal,
                                      restock: autoRestock,
                                    },
                                  }));
                                }}
                                style={{
                                  width: '100%',
                                  padding: '4px 6px',
                                  border: parseFloat(inp.returnQty) > 0 && !inp.reason ? '1px solid #ef4444' : '1px solid #cbd5e1',
                                  borderRadius: '4px',
                                  fontSize: '0.78rem',
                                  background: isFullyReturned ? '#f1f5f9' : '#ffffff',
                                  cursor: isFullyReturned ? 'not-allowed' : 'pointer',
                                }}
                              >
                                <option value="">Select reason...</option>
                                <option value="Defective">Defective</option>
                                <option value="Wrong Item">Wrong Item</option>
                                <option value="Customer Changed Mind">Customer Changed Mind</option>
                                <option value="Damaged">Damaged</option>
                                <option value="Expired">Expired</option>
                                <option value="Other">Other</option>
                              </select>

                              {inp.reason === 'Other' && (
                                <input
                                  type="text"
                                  placeholder="Specify reason..."
                                  value={inp.customReason}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setReturnLinesInput((prev) => ({
                                      ...prev,
                                      [l.id]: {
                                        ...(prev[l.id] || { returnQty: '', restock: true, reason: 'Other' }),
                                        customReason: val,
                                      },
                                    }));
                                  }}
                                  style={{
                                    width: '100%',
                                    marginTop: '4px',
                                    padding: '3px 6px',
                                    border: !inp.customReason ? '1px solid #ef4444' : '1px solid #cbd5e1',
                                    borderRadius: '4px',
                                    fontSize: '0.75rem',
                                  }}
                                />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {/* Live Calculations & Settlement Preview (Section 6 & 7) */}
                  {(() => {
                    const preview = calculateReturnPreview();
                    if (!preview) {
                      return (
                        <div style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '8px', padding: '1rem', textAlign: 'center', color: '#64748b', fontSize: '0.82rem' }}>
                          Enter return quantity above to see tax reversal and settlement calculation.
                        </div>
                      );
                    }

                    const { calculated, settlement } = preview;
                    const isWalkIn = !returnInfo.customer;

                    return (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                        {/* Tax Reversal Card */}
                        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '0.85rem 1rem' }}>
                          <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', fontWeight: 700, color: '#166534' }}>
                            GST Reversal Breakdown
                          </h4>
                          <div style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                              <span>Taxable Reversal:</span>
                              <b>{formatRupees(calculated.taxableTotalMinor)}</b>
                            </div>
                            {calculated.isIntraState ? (
                              <>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                  <span>CGST Reversal:</span>
                                  <span>{formatRupees(calculated.cgstMinor)}</span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                  <span>SGST Reversal:</span>
                                  <span>{formatRupees(calculated.sgstMinor)}</span>
                                </div>
                              </>
                            ) : (
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>IGST Reversal:</span>
                                <span>{formatRupees(calculated.igstMinor)}</span>
                              </div>
                            )}
                            {calculated.roundOffMinor !== 0 && (
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>Round Off:</span>
                                <span>{calculated.roundOffMinor > 0 ? '+' : ''}{formatRupees(calculated.roundOffMinor)}</span>
                              </div>
                            )}
                            <div style={{ borderTop: '1px solid #86efac', marginTop: '4px', paddingTop: '4px', display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem', fontWeight: 800, color: '#14532d' }}>
                              <span>TOTAL CREDIT:</span>
                              <span>{formatRupees(calculated.totalCreditMinor)}</span>
                            </div>
                          </div>
                        </div>

                        {/* Settlement Plan Card */}
                        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.85rem 1rem' }}>
                          <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', fontWeight: 700, color: '#0f172a' }}>
                            Credit Settlement
                          </h4>
                          <div style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {settlement.duesClearedMinor > 0 && (
                              <div style={{ color: '#0f172a' }}>
                                <span>• Clears dues on bills: </span>
                                <b>{formatRupees(settlement.duesClearedMinor)}</b>
                                {settlement.allocations.map((a, aidx) => (
                                  <div key={aidx} style={{ fontSize: '0.72rem', color: '#64748b', marginLeft: '12px' }}>
                                    Bill #{a.invoiceNumber}: {formatRupees(a.amountMinor)}
                                  </div>
                                ))}
                              </div>
                            )}

                            {settlement.remainderMinor > 0 && (
                              <div style={{ marginTop: '4px', borderTop: '1px dashed #cbd5e1', paddingTop: '6px' }}>
                                <div style={{ fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                                  Remainder Credit: {formatRupees(settlement.remainderMinor)}
                                </div>

                                {isWalkIn ? (
                                  <div>
                                    <div style={{ fontSize: '0.75rem', color: '#b45309', marginBottom: '4px' }}>
                                      Walk-in bill: Remainder must be refunded to customer.
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                      <select
                                        className="input"
                                        style={{ padding: '3px 6px', fontSize: '0.75rem', width: '100px' }}
                                        value={returnRefundMode}
                                        onChange={(e) => setReturnRefundMode(e.target.value as any)}
                                      >
                                        <option value="cash">Cash</option>
                                        <option value="upi">UPI</option>
                                        <option value="card">Card</option>
                                        <option value="bank">Bank</option>
                                      </select>
                                      <input
                                        type="text"
                                        placeholder="UTR / Ref (optional)"
                                        value={returnRefundReference}
                                        onChange={(e) => setReturnRefundReference(e.target.value)}
                                        style={{ padding: '3px 6px', fontSize: '0.75rem', flex: 1, border: '1px solid #cbd5e1', borderRadius: '4px' }}
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                        <input
                                          type="radio"
                                          name="returnSettlementChoice"
                                          checked={returnSettlementType === 'advance'}
                                          onChange={() => setReturnSettlementType('advance')}
                                        />
                                        <span>
                                          <b>Customer Advance</b> (Store Credit) [Recommended]
                                        </span>
                                      </label>
                                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                        <input
                                          type="radio"
                                          name="returnSettlementChoice"
                                          checked={returnSettlementType === 'refund'}
                                          onChange={() => setReturnSettlementType('refund')}
                                        />
                                        <span>
                                          <b>Refund Now</b> to Customer
                                        </span>
                                      </label>
                                    </div>

                                    {returnSettlementType === 'refund' && (
                                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '6px', marginLeft: '18px' }}>
                                        <select
                                          className="input"
                                          style={{ padding: '3px 6px', fontSize: '0.75rem', width: '100px' }}
                                          value={returnRefundMode}
                                          onChange={(e) => setReturnRefundMode(e.target.value as any)}
                                        >
                                          <option value="cash">Cash</option>
                                          <option value="upi">UPI</option>
                                          <option value="card">Card</option>
                                          <option value="bank">Bank</option>
                                        </select>
                                        <input
                                          type="text"
                                          placeholder="Payment Ref (optional)"
                                          value={returnRefundReference}
                                          onChange={(e) => setReturnRefundReference(e.target.value)}
                                          style={{ padding: '3px 6px', fontSize: '0.75rem', flex: 1, border: '1px solid #cbd5e1', borderRadius: '4px' }}
                                        />
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Note input */}
                  <div style={{ marginBottom: '0.5rem' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '2px' }}>
                      Overall Note (Optional)
                    </label>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g. Customer returned items within 7 days with receipt"
                      value={returnNote}
                      onChange={(e) => setReturnNote(e.target.value)}
                      style={{ padding: '0.45rem', fontSize: '0.8rem' }}
                    />
                  </div>

                  {/* Error display */}
                  {returnError && (
                    <div style={{ marginTop: '0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '0.65rem', fontSize: '0.8rem', color: '#dc2626' }}>
                      ⚠️ {returnError}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.85rem 1.25rem',
                borderTop: '1px solid #e2e8f0',
                background: '#f8fafc',
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCloseReturnModal}
                disabled={returnSaving}
              >
                Cancel
              </button>

              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveReturn}
                disabled={returnSaving || !calculateReturnPreview()}
                style={{
                  background: '#4f46e5',
                  borderColor: '#4338ca',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                }}
              >
                {returnSaving
                  ? 'Issuing Credit Note...'
                  : `Issue Credit Note (${formatRupees(calculateReturnPreview()?.calculated.totalCreditMinor || 0)})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 3. Credit Note Success Modal (Section 9)                  */}
      {/* ========================================================= */}
      {creditNoteSuccess && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1060,
            padding: '1rem',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setCreditNoteSuccess(null);
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '520px',
              borderRadius: '12px',
              overflow: 'hidden',
              background: '#ffffff',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            }}
          >
            {/* Success Header */}
            <div style={{ background: '#f0fdf4', borderBottom: '1px solid #bbf7d0', padding: '1.25rem', textAlign: 'center' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>✅</div>
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#166534' }}>
                Credit Note Issued
              </h3>
              <div style={{ fontSize: '0.82rem', color: '#15803d', marginTop: '4px' }}>
                Credit Note <b>{creditNoteSuccess.creditNoteNumber}</b> generated against Bill #{creditNoteSuccess.originalInvoiceNumber}
              </div>
            </div>

            {/* Content */}
            <div style={{ padding: '1.25rem' }}>
              <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Total Credit Amount</div>
                <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#1e1b4b' }}>
                  {formatRupees(creditNoteSuccess.totalCreditMinor)}
                </div>
                {creditNoteSuccess.settlement && (
                  <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: '4px' }}>
                    {creditNoteSuccess.settlement.duesClearedMinor > 0 && `₹${(creditNoteSuccess.settlement.duesClearedMinor / 100).toFixed(2)} dues cleared`}
                    {creditNoteSuccess.settlement.advanceAmountMinor > 0 && ` · ₹${(creditNoteSuccess.settlement.advanceAmountMinor / 100).toFixed(2)} customer advance`}
                    {creditNoteSuccess.settlement.refundAmountMinor > 0 && ` · ₹${(creditNoteSuccess.settlement.refundAmountMinor / 100).toFixed(2)} refunded (${(creditNoteSuccess.settlement.refundMode || 'cash').toUpperCase()})`}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', marginBottom: '0.75rem' }}>
                <a
                  href={`/api/credit-notes/${creditNoteSuccess.creditNoteId}/print?paper=thermal80&autoprint=true`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary"
                  style={{ textAlign: 'center', padding: '0.55rem', fontSize: '0.82rem', textDecoration: 'none', fontWeight: 600 }}
                >
                  🖨️ Thermal 80mm
                </a>
                <a
                  href={`/api/credit-notes/${creditNoteSuccess.creditNoteId}/print?paper=thermal58&autoprint=true`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary"
                  style={{ textAlign: 'center', padding: '0.55rem', fontSize: '0.82rem', textDecoration: 'none', fontWeight: 600 }}
                >
                  🖨️ Thermal 58mm
                </a>
              </div>

              <a
                href={`/api/credit-notes/${creditNoteSuccess.creditNoteId}/print?paper=a4`}
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary"
                style={{ display: 'block', textAlign: 'center', padding: '0.55rem', fontSize: '0.82rem', textDecoration: 'none', fontWeight: 600, marginBottom: '0.75rem' }}
              >
                📄 View A4 GST Credit Note
              </a>

              {shop?.whatsappEnabled !== false && (
                <button
                  type="button"
                  onClick={() => {
                    const cn = creditNoteSuccess;
                    setCreditNoteSuccess(null);
                    handleOpenCreditNoteWhatsApp({
                      id: cn.creditNoteId,
                      number: cn.creditNoteNumber,
                      originalInvoiceNumber: cn.originalInvoiceNumber,
                      phone: cn.customerPhone || '',
                      customerName: cn.customerName,
                      totalCreditMinor: cn.totalCreditMinor,
                      settlementSummary: cn.settlement?.advanceAmountMinor > 0
                        ? `₹${(cn.settlement.advanceAmountMinor / 100).toFixed(2)} kept as Store Credit`
                        : cn.settlement?.refundAmountMinor > 0
                        ? `₹${(cn.settlement.refundAmountMinor / 100).toFixed(2)} refunded`
                        : 'Adjusted towards bill dues',
                      shareToken: cn.shareToken,
                    });
                  }}
                  style={{
                    width: '100%',
                    padding: '0.65rem',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#25D366',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    marginBottom: '0.75rem',
                  }}
                >
                  <span>💬</span>
                  <span>Share on WhatsApp</span>
                </button>
              )}

              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCreditNoteSuccess(null)}
                style={{ width: '100%', padding: '0.55rem', fontSize: '0.82rem' }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 4. Void Credit Note Confirmation Modal (Section 11.3)     */}
      {/* ========================================================= */}
      {voidCreditNoteTarget && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1070,
            padding: '1rem',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !voidSaving) setVoidCreditNoteTarget(null);
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '480px',
              borderRadius: '12px',
              padding: '1.25rem',
              background: '#ffffff',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.25)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#b91c1c', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '1.5rem' }}>⚠️</span>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>
                Void Credit Note #{voidCreditNoteTarget.number}?
              </h3>
            </div>

            <p style={{ fontSize: '0.82rem', color: '#475569', marginBottom: '0.85rem', lineHeight: 1.45 }}>
              This will remove <b>{formatRupees(voidCreditNoteTarget.totalCreditMinor)}</b> of credit, re-open bill dues (or reduce customer advance / record refund as reversed), take restocked items back out of stock, and reverse this credit note's GST adjustment.
            </p>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '0.3rem' }}>
                Void Reason (Required) *
              </label>
              <textarea
                className="input"
                rows={3}
                placeholder="e.g. Wrong quantity — 2 returned instead of 1"
                value={voidReasonInput}
                onChange={(e) => setVoidReasonInput(e.target.value)}
                style={{ width: '100%', padding: '0.5rem', fontSize: '0.82rem' }}
              />
            </div>

            {voidError && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', padding: '0.65rem', fontSize: '0.8rem', color: '#dc2626', marginBottom: '1rem' }}>
                ⚠️ {voidError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setVoidCreditNoteTarget(null)}
                disabled={voidSaving}
                style={{ padding: '0.45rem 0.85rem' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmVoid}
                disabled={voidSaving || !voidReasonInput.trim()}
                style={{
                  padding: '0.45rem 0.95rem',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  background: '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: voidSaving || !voidReasonInput.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {voidSaving ? 'Voiding...' : 'Confirm Void'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* 5. WhatsApp Credit Note Share Modal (Section 9)           */}
      {/* ========================================================= */}
      {creditNoteWhatsAppTarget && (
        <div
          className="modal-backdrop"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1070,
            padding: '1rem',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setCreditNoteWhatsAppTarget(null);
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '460px',
              borderRadius: '12px',
              overflow: 'hidden',
              background: '#ffffff',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            }}
          >
            {/* Header */}
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.25rem' }}>💬</span>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>
                  Send Credit Note on WhatsApp
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCreditNoteWhatsAppTarget(null)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: '1.25rem' }}>
              <div style={{ background: '#f8fafc', borderRadius: '6px', padding: '0.65rem 0.85rem', marginBottom: '1rem', fontSize: '0.82rem' }}>
                <div>Credit Note: <b>{creditNoteWhatsAppTarget.number}</b></div>
                <div>Amount: <b>{formatRupees(creditNoteWhatsAppTarget.totalCreditMinor)}</b></div>
              </div>

              {/* Language Selector */}
              <div style={{ marginBottom: '0.85rem' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.3rem' }}>
                  Message Language
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.4rem' }}>
                  {(['en', 'hi', 'ta'] as const).map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => setCnWhatsAppLang(l)}
                      style={{
                        border: cnWhatsAppLang === l ? '2px solid #16a34a' : '1px solid #cbd5e1',
                        background: cnWhatsAppLang === l ? '#f0fdf4' : '#fff',
                        color: cnWhatsAppLang === l ? '#166534' : '#334155',
                        fontWeight: cnWhatsAppLang === l ? 700 : 500,
                        padding: '0.45rem',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '0.82rem',
                      }}
                    >
                      {l === 'en' ? 'English' : l === 'hi' ? 'हिन्दी' : 'தமிழ்'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Phone input */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.3rem' }}>
                  Customer Phone Number (10 digits)
                </label>
                <input
                  type="tel"
                  className="input"
                  placeholder="e.g. 9876543210"
                  value={cnWhatsAppPhone}
                  onChange={(e) => {
                    setCnWhatsAppPhone(e.target.value);
                    setCnWhatsAppPhoneError('');
                  }}
                  style={{ padding: '0.55rem' }}
                />
                {cnWhatsAppPhoneError && (
                  <div style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                    {cnWhatsAppPhoneError}
                  </div>
                )}
              </div>

              {/* Send Button */}
              <button
                type="button"
                onClick={handleSendCreditNoteWhatsApp}
                disabled={cnWhatsAppSendState === 'sending'}
                style={{
                  width: '100%',
                  padding: '0.65rem',
                  borderRadius: '6px',
                  border: 'none',
                  background: '#25D366',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                }}
              >
                <span>💬</span>
                <span>{cnWhatsAppSendState === 'sending' ? 'Opening...' : cnWhatsAppSendState === 'sent' ? 'Sent — Send Again' : 'Open WhatsApp'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
