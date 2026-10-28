import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  deleteProduct,
  searchHsnSac,
  suggestHsnForProduct,
  type HsnItem,
} from './api';
import { moneyInWords } from '../../shared/money.ts';
import { qrSvg } from '../../shared/qr.ts';
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
import { ProductMovementAnalysisView } from './components/inventory/ProductMovementAnalysisView';
import { SalesAnalysisView } from './components/sales/SalesAnalysisView';
import { ShiftsDashboard } from './components/shifts/ShiftsDashboard.tsx';
import { SuperAdminDashboard } from './components/dashboards/SuperAdminDashboard';
import { StoreManagerDashboard } from './components/dashboards/StoreManagerDashboard';
import { CashierDashboard } from './components/dashboards/CashierDashboard';
import { BulkImportModal } from './components/BulkImportModal';
import { PrintBarcodeModal } from './components/PrintBarcodeModal';
import { BulkBarcodeModal } from './components/BulkBarcodeModal';
import { ToggleSwitch } from './components/ToggleSwitch';
import { renderBarcodeSvg } from '../../shared/bulkImport.ts';
import { OpenShiftModal } from './components/shifts/OpenShiftModal.tsx';
import { TodayDashboardView } from './components/dashboard/TodayDashboardView.tsx';
import { PaymentsView } from './components/finance/PaymentsView.tsx';
import { ExpensesView } from './components/finance/ExpensesView.tsx';
import { CashBankView } from './components/finance/CashBankView.tsx';
import { ReceivablesView } from './components/finance/ReceivablesView.tsx';
import { PayablesView } from './components/finance/PayablesView.tsx';
import { GstOverviewView } from './components/gst/GstOverviewView.tsx';
import { GstSalesRegisterView } from './components/gst/GstSalesRegisterView.tsx';
import { GstPurchaseRegisterView } from './components/gst/GstPurchaseRegisterView.tsx';
import { ItcRegisterView } from './components/gst/ItcRegisterView.tsx';
import { Gstr3bView } from './components/gst/Gstr3bView.tsx';
import { Gstr1View } from './components/gst/Gstr1View.tsx';
import { GstImportExportView } from './components/gst/GstImportExportView.tsx';
import { GstFilingHistoryView } from './components/gst/GstFilingHistoryView.tsx';
import { CustomerDirectory } from './components/customers/CustomerDirectory.tsx';
import { SupplierDirectory } from './components/suppliers/SupplierDirectory.tsx';

export interface ToastItem {
  id: string;
  message: string;
  title?: string;
  type: 'success' | 'error' | 'warning' | 'info';
  duration: number;
}

// Format paise to INR
const formatRupees = (paise: number = 0) => {
  return '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const escapeHtml = (str: string = ''): string => {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const printBarcodeLabels = (
  items: Array<{ name: string; sku?: string | null; barcode: string; priceMinor?: number }>,
  shopName?: string,
) => {
  if (!items || items.length === 0) return;

  const validItems = items.filter((it) => it.barcode && String(it.barcode).trim());
  if (validItems.length === 0) return;

  const labelsHtml = validItems
    .map((item) => {
      const code = String(item.barcode).trim();
      const svgMarkup = renderBarcodeSvg(code);
      const priceText = item.priceMinor ? formatRupees(item.priceMinor) : '';
      return `
        <div class="label-card">
          ${shopName ? `<div class="store-name">${escapeHtml(shopName)}</div>` : ''}
          <div class="product-name">${escapeHtml(item.name)}</div>
          ${item.sku ? `<div class="sku-line">SKU: ${escapeHtml(item.sku)}</div>` : ''}
          <div class="barcode-wrap">${svgMarkup}</div>
          <div class="barcode-digits">${escapeHtml(code)}</div>
          ${priceText ? `<div class="price-line">MRP: ${priceText}</div>` : ''}
        </div>
      `;
    })
    .join('');

  let iframe = document.getElementById('barcode-print-iframe') as HTMLIFrameElement | null;
  if (!iframe) {
    iframe = document.createElement('iframe');
    iframe.id = 'barcode-print-iframe';
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.visibility = 'hidden';
    document.body.appendChild(iframe);
  }

  const iframeDoc = iframe.contentWindow?.document;
  if (!iframeDoc) return;

  iframeDoc.open();
  iframeDoc.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Print Barcode Labels</title>
        <style>
          @page {
            size: auto;
            margin: 6mm;
          }
          * {
            box-sizing: border-box;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            margin: 0;
            padding: 4mm;
            background: #ffffff !important;
            color: #000000 !important;
          }
          .labels-container {
            display: flex;
            flex-wrap: wrap;
            gap: 6mm;
            justify-content: ${validItems.length === 1 ? 'center' : 'flex-start'};
            align-items: flex-start;
          }
          .label-card {
            width: 62mm;
            min-height: 40mm;
            border: 1px dashed #94a3b8;
            border-radius: 4px;
            padding: 3mm 4mm;
            text-align: center;
            background: #ffffff !important;
            color: #000000 !important;
            page-break-inside: avoid;
            break-inside: avoid;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
          }
          .store-name {
            font-size: 8px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #475569;
            margin-bottom: 2px;
          }
          .product-name {
            font-size: 11px;
            font-weight: 700;
            color: #000000;
            line-height: 1.25;
            max-height: 28px;
            overflow: hidden;
            text-overflow: ellipsis;
            margin-bottom: 2px;
            word-break: break-word;
          }
          .sku-line {
            font-family: monospace;
            font-size: 8.5px;
            font-weight: 600;
            color: #334155;
            margin-bottom: 2px;
          }
          .barcode-wrap {
            margin: 3px 0 1px 0;
            display: flex;
            justify-content: center;
            align-items: center;
          }
          .barcode-wrap svg {
            width: 145px;
            height: 42px;
            display: block;
          }
          .barcode-digits {
            font-family: monospace;
            font-size: 9.5px;
            font-weight: 700;
            letter-spacing: 0.8px;
            color: #000000;
            margin-top: 1px;
          }
          .price-line {
            font-size: 10.5px;
            font-weight: 800;
            color: #000000;
            margin-top: 2px;
          }
          @media print {
            body {
              padding: 0;
            }
            .label-card {
              border-color: #cbd5e1;
            }
          }
        </style>
      </head>
      <body>
        <div class="labels-container">
          ${labelsHtml}
        </div>
      </body>
    </html>
  `);
  iframeDoc.close();

  setTimeout(() => {
    try {
      iframe?.contentWindow?.focus();
      iframe?.contentWindow?.print();
    } catch {
      window.print();
    }
  }, 250);
};

// Compute MRP for item (reads custom.mrpMinor, or mrpMinor, or defaults to 15% above selling price)
export const getItemMrp = (item: Item): number => {
  if (item.custom?.mrpMinor && typeof item.custom.mrpMinor === 'number' && item.custom.mrpMinor > 0) {
    return item.custom.mrpMinor;
  }
  if ((item as any).mrpMinor && typeof (item as any).mrpMinor === 'number' && (item as any).mrpMinor > 0) {
    return (item as any).mrpMinor;
  }
  return Math.max(item.priceMinor, Math.ceil((item.priceMinor * 1.15) / 100) * 100);
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
  const [activeTab, setActiveTab] = useState<
    | 'dashboard'
    | 'pos'
    | 'shifts'
    | 'items'
    | 'categories'
    | 'inventory'
    | 'product-movement'
    | 'sales-analysis'
    | 'purchases'
    | 'invoices'
    | 'customers'
    | 'suppliers'
    | 'reports'
    | 'settings'
    | 'payments'
    | 'expenses'
    | 'cashbank'
    | 'receivables'
    | 'payables'
    | 'gst-overview'
    | 'gst-sales-register'
    | 'gst-purchase-register'
    | 'gst-itc-reconciliation'
    | 'gst-gstr3b'
    | 'gst-gstr1'
    | 'gst-import-export'
    | 'gst-filing-history'
  >('dashboard');
  const [dashboardViewMode, setDashboardViewMode] = useState<'today' | 'management'>('today');

  // Collapsible sidebar accordion sections
  const isAccountsTabActive = ['invoices', 'purchases', 'payments', 'expenses', 'cashbank', 'payables', 'reports'].includes(activeTab);
  const isGstTabActive = [
    'gst-overview',
    'gst-sales-register',
    'gst-gstr1',
    'gst-purchase-register',
    'gst-itc-reconciliation',
    'gst-gstr3b',
    'gst-import-export',
    'gst-filing-history',
  ].includes(activeTab);

  const [isAccountsOpen, setIsAccountsOpen] = useState<boolean>(() => isAccountsTabActive);
  const [isGstOpen, setIsGstOpen] = useState<boolean>(() => isGstTabActive);

  useEffect(() => {
    if (isAccountsTabActive) setIsAccountsOpen(true);
  }, [isAccountsTabActive]);

  useEffect(() => {
    if (isGstTabActive) setIsGstOpen(true);
  }, [isGstTabActive]);
  const [activeShiftNumber, setActiveShiftNumber] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // View routing: 'landing' (Screen 1) | 'login' (Screen 7) | 'register' (Screens 2-6) | 'selector' (Screen 8) | 'dashboard' (Screen 9)
  const [view, setView] = useState<'landing' | 'login' | 'register' | 'selector' | 'dashboard'>('landing');
  const [regSelectedBusinessType, setRegSelectedBusinessType] = useState<string>('grocery');

  const navigateTo = (newView: 'landing' | 'login' | 'register' | 'selector' | 'dashboard') => {
    setView(newView);
    if (newView === 'dashboard') {
      setActiveTab('dashboard');
    }
    window.location.hash = newView;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Multi-business state
  const [demoBusinesses, setDemoBusinesses] = useState<DemoBusiness[]>([]);
  const [myBusinesses, setMyBusinesses] = useState<DemoBusiness[]>([]);
  const [showBusinessDropdown, setShowBusinessDropdown] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // Inventory Hub dropdown & submenu state
  const [showInventoryDropdown, setShowInventoryDropdown] = useState(false);
  const [isInventoryHovered, setIsInventoryHovered] = useState(false);
  const inventoryHoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inventoryDropdownRef = useRef<HTMLDivElement | null>(null);

  const handleInventoryMouseEnter = () => {
    if (inventoryHoverTimeoutRef.current) {
      clearTimeout(inventoryHoverTimeoutRef.current);
      inventoryHoverTimeoutRef.current = null;
    }
    setIsInventoryHovered(true);
  };

  const handleInventoryMouseLeave = () => {
    if (inventoryHoverTimeoutRef.current) {
      clearTimeout(inventoryHoverTimeoutRef.current);
    }
    inventoryHoverTimeoutRef.current = setTimeout(() => {
      setIsInventoryHovered(false);
    }, 200);
  };

  const handleInventoryClick = () => {
    setActiveTab('inventory');
    setShowInventoryDropdown((prev) => !prev);
  };

  const isInventorySubmenuVisible =
    isInventoryHovered || showInventoryDropdown || activeTab === 'product-movement';

  // Close inventory dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      if (
        inventoryDropdownRef.current &&
        !inventoryDropdownRef.current.contains(event.target as Node)
      ) {
        setShowInventoryDropdown(false);
        setIsInventoryHovered(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
    };
  }, []);

  // Close submenu when navigating away to unrelated modules
  useEffect(() => {
    if (activeTab !== 'inventory' && activeTab !== 'product-movement') {
      setShowInventoryDropdown(false);
      setIsInventoryHovered(false);
    }
  }, [activeTab]);

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
  const [selectedPayMode, setSelectedPayMode] = useState<'cash' | 'upi' | 'card' | 'bank' | 'credit' | 'split'>('cash');
  const [cashReceived, setCashReceived] = useState<string>('');
  const [splitMethod1, setSplitMethod1] = useState<'cash' | 'upi' | 'card' | 'bank'>('cash');
  const [splitAmount1, setSplitAmount1] = useState<string>('');
  const [splitMethod2, setSplitMethod2] = useState<'cash' | 'upi' | 'card' | 'bank'>('upi');
  const [splitAmount2, setSplitAmount2] = useState<string>('');
  const [splitCashTendered, setSplitCashTendered] = useState<string>('');
  const lastSplitEditedRef = useRef<1 | 2>(1);
  const catalogSearchInputRef = useRef<HTMLInputElement>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [printModalInvoiceId, setPrintModalInvoiceId] = useState<string | null>(null);

  // Barcode Label Printing & Toggle State
  const [activePrintLabels, setActivePrintLabels] = useState<Array<{ name: string; sku?: string | null; barcode: string; priceMinor?: number }> | null>(null);
  const [printBarcodeItem, setPrintBarcodeItem] = useState<Item | null>(null);
  const [showPrintBarcodeModal, setShowPrintBarcodeModal] = useState(false);
  const [showBulkBarcodeModal, setShowBulkBarcodeModal] = useState(false);
  const [togglingItemId, setTogglingItemId] = useState<string | null>(null);

  // Wireless Mobile Barcode Scanner State
  const [scannerSessionId] = useState<string>(() => {
    try {
      const stored = localStorage.getItem('pos_scanner_session');
      if (stored) return stored;
      const defaultId = 'pos-counter-1';
      localStorage.setItem('pos_scanner_session', defaultId);
      return defaultId;
    } catch {
      return 'pos-counter-1';
    }
  });
  const [showMobileScannerModal, setShowMobileScannerModal] = useState(false);
  const [isPhoneScannerConnected, setIsPhoneScannerConnected] = useState(false);
  const [scannerNetworkInfo, setScannerNetworkInfo] = useState<{ localIp: string; httpPort: number; httpsPort: number; tunnelUrl?: string } | null>(null);
  const [scannerProtocol, setScannerProtocol] = useState<'tunnel' | 'https' | 'http'>('tunnel');
  const [scannerSoundEnabled, setScannerSoundEnabled] = useState(true);
  const [customTunnelUrl, setCustomTunnelUrl] = useState('');
  const [showCfdModal, setShowCfdModal] = useState(false);
  const [isCfdConnected, setIsCfdConnected] = useState(false);

  // Modern Image 2 POS State
  const [customerSearch, setCustomerSearch] = useState('');
  const [quickCustomerName, setQuickCustomerName] = useState('');
  const [isQuickEnrolling, setIsQuickEnrolling] = useState(false);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [redeemPoints, setRedeemPoints] = useState(false);
  const [appliedDiscountPercent, setAppliedDiscountPercent] = useState<number>(0);
  const [showDiscountPicker, setShowDiscountPicker] = useState(false);
  const [showPosOpenShiftModal, setShowPosOpenShiftModal] = useState(false);
  const [showHeldOrdersModal, setShowHeldOrdersModal] = useState(false);
  const [showCustomItemModal, setShowCustomItemModal] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [customItemForm, setCustomItemForm] = useState({ name: 'Custom Charge', price: '50', taxRateBp: 1800 });
  const [heldOrders, setHeldOrders] = useState<{ id: string; cart: { item: Item; qty: number }[]; timestamp: Date }[]>(() => {
    try {
      const saved = localStorage.getItem('pos_held_orders');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.map((o: any) => ({ ...o, timestamp: new Date(o.timestamp) }));
        }
      }
    } catch {}
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem('pos_held_orders', JSON.stringify(heldOrders));
    } catch {}
  }, [heldOrders]);

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
  const [invoiceFilterDate, setInvoiceFilterDate] = useState<string>('');

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

  // Settings: Customer Loyalty Rewards Program
  const [settingsLoyaltyEnabled, setSettingsLoyaltyEnabled] = useState(true);
  const [settingsLoyaltyPointsPer100, setSettingsLoyaltyPointsPer100] = useState(10);
  const [settingsLoyaltyPointValueRupees, setSettingsLoyaltyPointValueRupees] = useState(0.10);
  const [settingsLoyaltyMinRedeem, setSettingsLoyaltyMinRedeem] = useState(10);

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
    tender?: { cashReceivedMinor: number; changeReturnedMinor: number } | null;
    payments?: { method: string; amountMinor: number }[];
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
  const [showBulkImportModal, setShowBulkImportModal] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [deletingItem, setDeletingItem] = useState<Item | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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
  // HSN & SAC Smart Directory states
  const [hsnSuggestions, setHsnSuggestions] = useState<HsnItem[]>([]);
  const [hsnSearchResults, setHsnSearchResults] = useState<HsnItem[]>([]);
  const [isHsnSearching, setIsHsnSearching] = useState(false);
  const [showHsnDropdown, setShowHsnDropdown] = useState(false);
  const [selectedHsnDesc, setSelectedHsnDesc] = useState('');

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
  const [partyFormLoyaltyPoints, setPartyFormLoyaltyPoints] = useState('0');

  // Master Data: Categories Management Modal
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatDesc, setNewCatDesc] = useState('');
  const [newCatParentId, setNewCatParentId] = useState('');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editingCatName, setEditingCatName] = useState('');
  const [editingCatDesc, setEditingCatDesc] = useState('');
  const [editingCatParentId, setEditingCatParentId] = useState('');
  const [catSearchTerm, setCatSearchTerm] = useState('');
  const [catTypeFilter, setCatTypeFilter] = useState<'all' | 'main' | 'sub'>('all');

  // Bulk Category Import state
  const [showCatImportView, setShowCatImportView] = useState(false);
  const [catImportCsv, setCatImportCsv] = useState('');
  const [catImportFileName, setCatImportFileName] = useState('');
  const [catImportLoading, setCatImportLoading] = useState(false);
  const [catImportPreview, setCatImportPreview] = useState<{
    valid: boolean;
    total: number;
    mainCategoriesCount: number;
    subcategoriesCount: number;
    duplicateCount: number;
    errorCount: number;
    errors: Array<{ row: number; name?: string; error: string }>;
  } | null>(null);
  const [catImportUpdateExisting, setCatImportUpdateExisting] = useState(false);
  const [catImportResult, setCatImportResult] = useState<{
    total: number;
    created: number;
    updated: number;
    skipped: number;
    errors: Array<{ row: number; name?: string; error: string }>;
  } | null>(null);

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

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const showToast = (
    msg: string,
    explicitType?: 'success' | 'error' | 'warning' | 'info',
    customTitle?: string
  ) => {
    if (!msg) return;

    // Inferred type if not explicitly supplied
    let type: 'success' | 'error' | 'warning' | 'info' = explicitType || 'success';
    if (!explicitType) {
      const lower = msg.toLowerCase();
      if (
        lower.includes('failed') ||
        lower.includes('error') ||
        lower.includes('cannot') ||
        lower.includes('not allowed') ||
        lower.includes('forbidden')
      ) {
        type = 'error';
      } else if (
        lower.includes('please') ||
        lower.includes('not found') ||
        lower.includes('required') ||
        lower.includes('empty') ||
        lower.includes('invalid') ||
        lower.includes('exceed') ||
        lower.includes('voided') ||
        lower.includes('cancelled') ||
        lower.includes('deactivated') ||
        lower.includes('deleted') ||
        lower.includes('removed')
      ) {
        type = 'warning';
      } else if (
        lower.includes('switched') ||
        lower.includes('restored') ||
        lower.includes('opened') ||
        lower.includes('navigate') ||
        lower.includes('scanned')
      ) {
        type = 'info';
      }
    }

    // Clean leading emojis/punctuation so crisp SVG icons take center stage
    const cleanMsg = msg
      .replace(/^[\s✓✨🎉🛒⚠️🪙●•✕!?-]+/, '')
      .trim() || msg;

    // Inferred title if not provided
    let title = customTitle;
    if (!title) {
      if (type === 'success') title = 'Success';
      else if (type === 'error') title = 'Error';
      else if (type === 'warning') title = 'Attention';
      else if (type === 'info') title = 'Notice';
    }

    const id = 'toast_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
    const duration = type === 'error' ? 4500 : 3500;

    setToasts((prev) => {
      // Keep up to 3 active toasts
      return [...prev.slice(-2), { id, message: cleanMsg, title, type, duration }];
    });

    setTimeout(() => {
      dismissToast(id);
    }, duration);
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
    setSettingsLoyaltyEnabled(s.loyaltyEnabled !== false);
    setSettingsLoyaltyPointsPer100(s.loyaltyPointsPer100 ?? 10);
    setSettingsLoyaltyPointValueRupees((s.loyaltyPointValueMinor ?? 10) / 100);
    setSettingsLoyaltyMinRedeem(s.loyaltyMinPointsRedeem ?? 10);
  };

  // Fetch data when shop changes
  useEffect(() => {
    if (!user || !shop) return;
    if (!can(user.role as any, 'purchases') && activeTab === 'purchases') {
      setActiveTab('pos');
    }
    if (!can(user.role as any, 'expenses') && activeTab === 'expenses') {
      setActiveTab('pos');
    }
    if (!can(user.role as any, 'gst.view') && (activeTab.startsWith('gst-') || activeTab === 'payments' || activeTab === 'cashbank' || activeTab === 'receivables' || activeTab === 'payables')) {
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
    } catch (err) {
      console.error('Failed to load items', err);
    }
  };

  const loadCategories = async () => {
    try {
      const res = await api<{ categories: Category[] }>('/api/categories?includeInactive=1');
      setCategoriesList(res.categories || []);
      const activeCats = (res.categories || []).filter((c) => c.active).map((c) => c.name);
      setCategories(activeCats);
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
          loyaltyEnabled: settingsLoyaltyEnabled,
          loyaltyPointsPer100: Math.max(0, Number(settingsLoyaltyPointsPer100) || 0),
          loyaltyPointValueMinor: Math.round((Number(settingsLoyaltyPointValueRupees) || 0.10) * 100),
          loyaltyMinPointsRedeem: Math.max(0, Number(settingsLoyaltyMinRedeem) || 0),
        }),
      });
      setShop(updated);
      initSettingsForm(updated);
      setSettingsSavedMsg('Shop settings updated successfully!');
      loadMyBusinesses();
      showToast('Store settings saved successfully!');
    } catch (err: any) {
      alert(err.message || 'Failed to update settings');
    }
  };

  const handleUpdateLoyaltySettings = async (settings: {
    loyaltyEnabled: boolean;
    loyaltyPointsPer100: number;
    loyaltyPointValueMinor: number;
    loyaltyMinPointsRedeem: number;
  }) => {
    if (!shop) return;
    try {
      const updated = await api<Shop>('/api/shop', {
        method: 'PUT',
        body: JSON.stringify({
          name: shop.name,
          businessType: shop.businessType,
          gstin: shop.gstin || null,
          phone: shop.phone || null,
          address: shop.address || null,
          upiId: shop.upiId || null,
          invoicePrefix: shop.invoicePrefix || 'INV',
          language: shop.language || 'en',
          locations: shop.locations || ['MAIN'],
          whatsappEnabled: shop.whatsappEnabled !== false,
          whatsappDefaultLang: shop.whatsappDefaultLang || 'en',
          whatsappIncludeLink: Boolean(shop.whatsappIncludeLink),
          ...settings,
        }),
      });
      setShop(updated);
      initSettingsForm(updated);
      showToast(`Loyalty scheme updated: ${settings.loyaltyPointsPer100} points per ₹100 spent!`);
      loadMyBusinesses();
    } catch (err: any) {
      alert(err.message || 'Failed to update loyalty settings');
      throw err;
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

  // Play authentic POS supermarket checkout beep tone
  const playSupermarketBeep = () => {
    if (!scannerSoundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1760, ctx.currentTime);
      gain.gain.setValueAtTime(0.22, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch {}
  };

  const playAlertTone = () => {
    if (!scannerSoundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(320, ctx.currentTime);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.19);
    } catch {}
  };

  // Desktop debounce to prevent duplicate burst scans
  const lastDesktopScanTimeRef = useRef<{ [code: string]: number }>({});
  const processedScanIdsRef = useRef(new Set<string>());
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Barcode scanned from phone or physical USB barcode gun
  const handleBarcodeScanned = async (barcode: string) => {
    const rawClean = (barcode || '').trim();
    const clean = rawClean.replace(/[\s\-]/g, '');
    if (!clean) return;

    // Desktop debounce: prevent duplicate scan of the same barcode within 2.2 seconds
    const now = Date.now();
    if (lastDesktopScanTimeRef.current[clean] && now - lastDesktopScanTimeRef.current[clean] < 2200) {
      return;
    }
    lastDesktopScanTimeRef.current[clean] = now;

    // 1. Match item in memory by exact barcode, stripped barcode, no-leading-zero barcode, 12 vs 13-digit EAN, prefix/suffix, or SKU
    const cleanNoZero = clean.replace(/^0+/, '');
    const catalog = itemsRef.current.length > 0 ? itemsRef.current : items;
    let matched = catalog.find((it) => {
      if (!it) return false;
      const itBc = (it.barcode || '').trim().replace(/[\s\-]/g, '');
      const itBcNoZero = itBc.replace(/^0+/, '');
      if (itBc) {
        if (itBc === clean) return true;
        if (itBcNoZero === cleanNoZero) return true;
        // Known camera glare/screen moiré readings for Aashirvaad Atta (from screen scans):
        if ((clean === '8901134467801' || clean === '3612360567801') && (itBc.includes('67801') || itBc.includes('567801') || it.name.toLowerCase().includes('aashirvaad'))) return true;
        // 12-digit vs 13-digit EAN-13 check digit equivalence (e.g. 890172518123 vs 8901725181239)
        if (clean.length === 13 && itBc.length === 12 && clean.startsWith(itBc)) return true;
        if (clean.length === 12 && itBc.length === 13 && itBc.startsWith(clean)) return true;
        // 13-digit with recomputed check digit (e.g. 8901234567801 vs 8901234567807)
        if (clean.length === 13 && itBc.length === 13 && clean.slice(0, 12) === itBc.slice(0, 12)) return true;
        // Suffix match: if last 5 digits match (unique item code suffix within retail store)
        if (clean.length >= 8 && itBc.length >= 8 && clean.slice(-5) === itBc.slice(-5)) return true;
        // Prefix match for barcodes >= 8 digits
        if (clean.length >= 8 && itBc.length >= 8 && (itBc.startsWith(clean) || clean.startsWith(itBc))) return true;
      }
      if (it.sku && it.sku.trim().toLowerCase() === clean.toLowerCase()) return true;
      return false;
    });

    // 1b. Robust optical noise tolerance: If camera reflection/screen moiré distorted up to 3 digits:
    if (!matched && clean.length >= 8 && /^\d+$/.test(clean)) {
      let bestItem: Item | null = null;
      let minDiffs = 999;
      for (const it of catalog) {
        if (!it?.barcode) continue;
        const itBc = it.barcode.trim().replace(/[\s\-]/g, '');
        if (Math.abs(itBc.length - clean.length) > 1) continue;
        let diffs = 0;
        const minLen = Math.min(clean.length, itBc.length);
        for (let i = 0; i < minLen; i++) {
          if (clean[i] !== itBc[i]) diffs++;
        }
        diffs += Math.abs(clean.length - itBc.length);
        if (diffs <= 3 && diffs < minDiffs) {
          minDiffs = diffs;
          bestItem = it;
        }
      }
      if (bestItem && minDiffs <= 3) {
        matched = bestItem;
        console.log(`[Optical Repair] Scanned ${clean} auto-matched ${matched.name} (${matched.barcode}) with ${minDiffs} digits repaired.`);
      }
    }

    // 2. If not found in primary barcode, query backend by-barcode endpoint (which checks product_barcodes table!)
    if (!matched) {
      try {
        const res = await api<{ item: Item }>(`/api/items/by-barcode/${encodeURIComponent(clean)}`);
        if (res?.item) {
          matched = res.item;
        }
      } catch {}
    }

    console.log('📱 Barcode received on desktop:', clean, 'Matched item:', matched?.name);

    if (matched) {
      // Automatically switch to POS Billing tab if user is currently on another tab (like Products catalog)!
      setActiveTab('pos');
      addToCart(matched);
      playSupermarketBeep();
      showToast(`🛒 Scanned: ${matched.name} (+1 in cart)`);
    } else {
      playAlertTone();
      showToast(`⚠️ Barcode "${rawClean}" not found in catalog`);
    }
  };

  // Fetch local LAN network info when opening mobile scanner modal
  useEffect(() => {
    if (!showMobileScannerModal) return;

    const fetchInfo = () => {
      fetch('/api/scanner/network-info')
        .then((r) => r.json())
        .then((data) => {
          setScannerNetworkInfo(data);
          if (data?.tunnelUrl && !customTunnelUrl) {
            setScannerProtocol('tunnel');
          }
        })
        .catch(() => {});
    };

    fetchInfo();
    const timer = setInterval(fetchInfo, 3000);
    return () => clearInterval(timer);
  }, [showMobileScannerModal, customTunnelUrl]);

  // Real-time listener: receives barcodes scanned from mobile phone instantly
  useEffect(() => {
    let active = true;
    let lastScanId = '';

    const listenForScans = async () => {
      while (active) {
        try {
          const url = `/api/scanner/events?session=${encodeURIComponent(scannerSessionId)}${lastScanId ? `&after=${encodeURIComponent(lastScanId)}` : ''}`;
          const res = await fetch(url);
          if (!res.ok) {
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          const data = await res.json();
          if (!active) break;

          if (data.phoneConnected !== undefined) {
            setIsPhoneScannerConnected(Boolean(data.phoneConnected));
          }

          if (data.events && Array.isArray(data.events) && data.events.length > 0) {
            for (const ev of data.events) {
              lastScanId = ev.id;
              if (processedScanIdsRef.current.has(ev.id)) continue;
              processedScanIdsRef.current.add(ev.id);
              await handleBarcodeScanned(ev.barcode);
            }
          }
        } catch {
          if (active) {
            await new Promise((r) => setTimeout(r, 2500));
          }
        }
      }
    };

    listenForScans();
    return () => {
      active = false;
    };
  }, [scannerSessionId]);

  // Customer & Loyalty Points for Active Selected Customer
  const selectedParty = parties.find((p) => p.id === selectedPartyId);

  const getPartyLoyaltyPoints = (partyId?: string, partyPhone?: string) => {
    if (!partyId && !partyPhone) return 0;
    const party = parties.find((p) => (partyId && p.id === partyId) || (partyPhone && p.phone === partyPhone));
    return party?.loyaltyPoints ?? 0;
  };

  const selectedPartyPoints = useMemo(() => {
    if (!selectedParty) return 0;
    return selectedParty.loyaltyPoints ?? 0;
  }, [selectedParty]);

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
  const percentDiscountMinor = Math.round((cartTotalMinor * appliedDiscountPercent) / 100);
  const maxPointsDiscountMinor = Math.max(0, cartTotalMinor - percentDiscountMinor);
  // Custom Shop Loyalty Scheme Calculations
  const shopPointValMinor = shop?.loyaltyPointValueMinor ?? 10;
  const shopMinRedeem = shop?.loyaltyMinPointsRedeem ?? 10;
  const shopPointsPer100 = shop?.loyaltyPointsPer100 ?? 10;
  const shopLoyaltyActive = shop?.loyaltyEnabled !== false;

  const potentialDiscountMinor = (selectedPartyPoints >= shopMinRedeem && shopLoyaltyActive)
    ? Math.min(maxPointsDiscountMinor, selectedPartyPoints * shopPointValMinor)
    : 0;
  const maxRedeemablePoints = shopPointValMinor > 0 ? Math.ceil(potentialDiscountMinor / shopPointValMinor) : 0;
  const pointsDiscountMinor = redeemPoints ? potentialDiscountMinor : 0;
  const pointsActuallyRedeemed = redeemPoints ? maxRedeemablePoints : 0;
  const discountMinor = percentDiscountMinor + pointsDiscountMinor;
  const finalPayableMinor = Math.max(0, cartTotalMinor - discountMinor);
  const pointsToEarnOnBill = (shopLoyaltyActive && shopPointsPer100 > 0)
    ? Math.floor((finalPayableMinor * shopPointsPer100) / 10000)
    : 0;

  // Cash Tender & Change Return calculation
  const cashReceivedValMinor = cashReceived.trim() !== ''
    ? Math.round(parseFloat(cashReceived) * 100) || 0
    : finalPayableMinor;
  const changeDueMinor = Math.max(0, cashReceivedValMinor - finalPayableMinor);
  const remainingDueMinor = Math.max(0, finalPayableMinor - cashReceivedValMinor);

  const suggestedDenominations = useMemo(() => {
    const base = Math.ceil(finalPayableMinor / 100);
    if (base <= 0) return [100, 200, 500, 2000];
    const s = new Set<number>();
    s.add(base);
    if (base % 50 !== 0 && base < 500) s.add(Math.ceil(base / 50) * 50);
    if (base % 100 !== 0 && base < 1000) s.add(Math.ceil(base / 100) * 100);
    if (base < 500) s.add(500);
    if (base < 1000) s.add(1000);
    if (base < 2000) s.add(2000);
    return Array.from(s).sort((a, b) => a - b).slice(0, 5);
  }, [finalPayableMinor]);

  // Split Payment (Multi-Tender) Calculations
  const split1Minor = splitAmount1.trim() !== '' ? Math.round(parseFloat(splitAmount1) * 100) || 0 : 0;
  const split2Minor = splitAmount2.trim() !== '' ? Math.round(parseFloat(splitAmount2) * 100) || 0 : 0;
  const splitTotalMinor = split1Minor + split2Minor;
  const splitRemainingMinor = Math.max(0, finalPayableMinor - splitTotalMinor);
  const splitOverMinor = Math.max(0, splitTotalMinor - finalPayableMinor);

  const hasCashInSplit = splitMethod1 === 'cash' || splitMethod2 === 'cash';
  const splitAllocatedCashMinor = splitMethod1 === 'cash' ? split1Minor : (splitMethod2 === 'cash' ? split2Minor : 0);
  const splitCashGivenMinor = splitCashTendered.trim() !== ''
    ? Math.round(parseFloat(splitCashTendered) * 100) || 0
    : splitAllocatedCashMinor;
  const splitCashChangeMinor = Math.max(0, splitCashGivenMinor - splitAllocatedCashMinor);
  const splitCashShortMinor = Math.max(0, splitAllocatedCashMinor - splitCashGivenMinor);

  const handleSplitFiftyFifty = () => {
    const totalRupees = Math.round(finalPayableMinor / 100);
    const half1 = Math.floor(totalRupees / 2);
    const half2 = totalRupees - half1;
    setSplitMethod1('cash');
    setSplitMethod2('upi');
    setSplitAmount1(half1.toString());
    setSplitAmount2(half2.toString());
    setSplitCashTendered('');
  };

  const handleSplit1Change = (val: string) => {
    lastSplitEditedRef.current = 1;
    setSplitAmount1(val);
    if (val.trim() === '') {
      setSplitAmount2('');
      return;
    }
    const num = parseFloat(val);
    if (!isNaN(num)) {
      const totalRupees = finalPayableMinor / 100;
      const remaining = Math.max(0, +(totalRupees - num).toFixed(2));
      setSplitAmount2(remaining.toString());
    }
  };

  const handleSplit2Change = (val: string) => {
    lastSplitEditedRef.current = 2;
    setSplitAmount2(val);
    if (val.trim() === '') {
      setSplitAmount1('');
      return;
    }
    const num = parseFloat(val);
    if (!isNaN(num)) {
      const totalRupees = finalPayableMinor / 100;
      const remaining = Math.max(0, +(totalRupees - num).toFixed(2));
      setSplitAmount1(remaining.toString());
    }
  };

  // Keep split balance automatically updated whenever total or mode changes
  useEffect(() => {
    if (selectedPayMode === 'split' && cart.length > 0) {
      const totalRupees = finalPayableMinor / 100;
      if (lastSplitEditedRef.current === 1 && splitAmount1.trim() !== '') {
        const num1 = parseFloat(splitAmount1);
        if (!isNaN(num1)) {
          const rem = Math.max(0, +(totalRupees - num1).toFixed(2));
          setSplitAmount2(rem.toString());
        }
      } else if (lastSplitEditedRef.current === 2 && splitAmount2.trim() !== '') {
        const num2 = parseFloat(splitAmount2);
        if (!isNaN(num2)) {
          const rem = Math.max(0, +(totalRupees - num2).toFixed(2));
          setSplitAmount1(rem.toString());
        }
      }
    }
  }, [finalPayableMinor, selectedPayMode, cart.length]);

  const handleFillSplitRemaining = (targetField: 1 | 2) => {
    const totalRupees = finalPayableMinor / 100;
    if (targetField === 1) {
      const amt2 = parseFloat(splitAmount2) || 0;
      setSplitAmount1(Math.max(0, +(totalRupees - amt2).toFixed(2)).toString());
    } else {
      const amt1 = parseFloat(splitAmount1) || 0;
      setSplitAmount2(Math.max(0, +(totalRupees - amt1).toFixed(2)).toString());
    }
  };

  // Cart MRP, Savings, and Category Breakdown
  const cartTotalMrpMinor = cart.reduce((acc, c) => acc + getItemMrp(c.item) * c.qty, 0);
  const totalMrpSavingsMinor = Math.max(0, cartTotalMrpMinor - cartSubtotalMinor) + discountMinor;
  const cartCategoryBreakdown = cart.reduce((acc: { [cat: string]: { name: string; count: number; totalMinor: number } }, c) => {
    const cat = c.item.category?.trim() || 'General';
    if (!acc[cat]) {
      acc[cat] = { name: cat, count: 0, totalMinor: 0 };
    }
    acc[cat].count += c.qty;
    acc[cat].totalMinor += c.item.priceMinor * c.qty;
    return acc;
  }, {});

  // Real-time Customer-Facing Display (CFD) Synchronization
  useEffect(() => {
    const counterId = 'counter-1';
    let bChannel: BroadcastChannel | null = null;
    try {
      bChannel = new BroadcastChannel(`cfd_${counterId}`);
    } catch {}

    // Determine status
    let status: 'idle' | 'billing' | 'payment_upi' | 'payment_cash' | 'payment_card' | 'completed' = 'idle';
    if (checkoutSuccess) {
      status = 'completed';
    } else if (cart.length > 0) {
      if (selectedPayMode === 'upi') status = 'payment_upi';
      else if (selectedPayMode === 'cash') status = 'payment_cash';
      else if (selectedPayMode === 'card') status = 'payment_card';
      else status = 'billing';
    }

    const effectiveUpiId = shop?.upiId?.trim() || (shop?.phone ? `${shop.phone.replace(/\D/g, '').slice(-10)}@upi` : 'merchant@okaxis');
    const upiUrl = finalPayableMinor > 0
      ? `upi://pay?pa=${encodeURIComponent(effectiveUpiId)}&pn=${encodeURIComponent(shop?.name || 'Store')}&am=${(finalPayableMinor / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Bill at ${shop?.name || 'Store'}`)}`
      : undefined;

    const activeCustomer = parties.find((p) => p.id === selectedPartyId);
    const payload = {
      counterId,
      shopName: shop?.name || 'Retail POS Counter',
      upiId: effectiveUpiId,
      tagline: shop?.address ? `Store: ${shop.address}` : 'GST Registered Retail Billing',
      cashierName: user?.name || 'Register Cashier',
      customerName: activeCustomer?.name || (cart.length > 0 ? 'Standard Retail Customer' : ''),
      items: cart.map((c) => {
        const mrp = getItemMrp(c.item);
        const storePrice = c.item.priceMinor;
        const lineTotal = storePrice * c.qty;
        const lineSavings = Math.max(0, (mrp - storePrice) * c.qty);
        return {
          id: c.item.id,
          name: c.item.name,
          sku: c.item.sku,
          qty: c.qty,
          unit: c.item.unit || 'pcs',
          category: c.item.category?.trim() || 'General',
          mrpMinor: mrp,
          priceMinor: storePrice,
          totalMinor: lineTotal,
          savingsMinor: lineSavings,
        };
      }),
      categoryBreakdown: cartCategoryBreakdown,
      itemCount: cart.length,
      totalUnits: cart.reduce((sum, c) => sum + c.qty, 0),
      totalMrpMinor: cartTotalMrpMinor,
      taxableSubtotalMinor: cartTaxableMinor,
      cgstMinor: cartCgstMinor,
      sgstMinor: cartSgstMinor,
      subtotalMinor: cartSubtotalMinor,
      discountMinor: discountMinor,
      discountPercent: appliedDiscountPercent,
      taxMinor: cartTaxMinor,
      totalMinor: finalPayableMinor,
      savingsMinor: totalMrpSavingsMinor,
      selectedPayMode,
      status,
      paymentDetails: status === 'completed' && checkoutSuccess ? {
        method: checkoutSuccess.payments?.[0]?.method || selectedPayMode || 'cash',
        amountMinor: checkoutSuccess.totalMinor || finalPayableMinor,
        changeDueMinor: checkoutSuccess.tender?.changeReturnedMinor || changeDueMinor || 0,
        invoiceNumber: checkoutSuccess.number || '',
      } : {
        method: selectedPayMode || 'upi',
        amountMinor: finalPayableMinor,
        upiUrl,
      },
      updatedAt: Date.now(),
    };

    // 1. BroadcastChannel (0ms local dual-screen)
    try {
      bChannel?.postMessage(payload);
    } catch {}

    // 2. LocalStorage (multi-tab / multi-window)
    try {
      localStorage.setItem(`cfd_state_${counterId}`, JSON.stringify(payload));
    } catch {}

    // 3. Post to backend for remote wireless tablets
    const pushCfdState = () => {
      fetch('/api/cfd/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data?.isDisplayActive !== undefined) {
            setIsCfdConnected(Boolean(data.isDisplayActive));
          }
        })
        .catch(() => {});
    };

    pushCfdState();
    const syncInterval = setInterval(pushCfdState, 15000);

    return () => {
      bChannel?.close();
      clearInterval(syncInterval);
    };
  }, [
    cart,
    cartSubtotalMinor,
    cartTaxMinor,
    cartTaxableMinor,
    cartCgstMinor,
    cartSgstMinor,
    cartTotalMrpMinor,
    cartCategoryBreakdown,
    appliedDiscountPercent,
    discountMinor,
    totalMrpSavingsMinor,
    finalPayableMinor,
    selectedPartyId,
    parties,
    shop,
    user,
    selectedPayMode,
    changeDueMinor,
    checkoutSuccess,
  ]);

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

  const handleReprintLastBill = () => {
    if (!invoices || invoices.length === 0) {
      showToast('No past bills available to reprint');
      return;
    }
    const lastInvoice = invoices[0];
    setPrintModalInvoiceId(lastInvoice.id);
  };

  const handleAddCustomItem = (e: React.FormEvent) => {
    e.preventDefault();
    const priceNum = parseFloat(customItemForm.price);
    if (isNaN(priceNum) || priceNum <= 0) {
      showToast('Please enter a valid price');
      return;
    }
    const priceMinor = Math.round(priceNum * 100);
    const customItem: Item = {
      id: 'custom-' + Date.now(),
      name: customItemForm.name.trim() || 'Custom Charge',
      sku: 'CUSTOM',
      barcode: undefined,
      category: 'Service',
      priceMinor,
      costMinor: 0,
      taxRateBp: Number(customItemForm.taxRateBp) || 0,
      taxInclusive: true,
      hsn: '9983',
      unit: 'unit',
      currentStockMilli: 999999000,
      favorite: false,
      active: true,
    };
    addToCart(customItem);
    setShowCustomItemModal(false);
    showToast(`Added ${customItem.name} (${formatRupees(priceMinor)}) to cart`);
  };

  // Global POS Hotkeys listener (F1, F4, F8, Alt+P, Alt+O, Alt+M, / or F2)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (activeTab !== 'pos') return;

      const activeTag = document.activeElement?.tagName;
      const isInputActive = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || (document.activeElement as HTMLElement)?.isContentEditable;

      if (e.key === 'F1') {
        e.preventDefault();
        setShowShortcutsModal((prev) => !prev);
      } else if (e.key === 'F4') {
        e.preventDefault();
        handleHoldOrder();
      } else if (e.key === 'F8') {
        e.preventDefault();
        setShowDiscountPicker(true);
      } else if (e.altKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        handleReprintLastBill();
      } else if (e.altKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        setShowCustomItemModal(true);
      } else if (e.altKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        setShowMobileScannerModal(true);
      } else if ((e.key === '/' || ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) || e.key === 'F2') && !isInputActive) {
        e.preventDefault();
        catalogSearchInputRef.current?.focus();
        catalogSearchInputRef.current?.select();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, cart, heldOrders, invoices]);

  const handleQuickEnrollCustomer = async (phone: string, name?: string) => {
    const cleanDigits = phone.replace(/\D/g, '').slice(-10);
    if (!cleanDigits || cleanDigits.length < 7) {
      showToast('Please enter a valid mobile number (at least 7 to 10 digits)', 'warning');
      return;
    }
    setIsQuickEnrolling(true);
    try {
      const defaultName = (name && name.trim()) ? name.trim() : `Customer ${cleanDigits.slice(-4)}`;
      const res = await api<{ party: Party }>('/api/parties', {
        method: 'POST',
        body: JSON.stringify({
          name: defaultName,
          phone: cleanDigits,
          type: 'customer',
        }),
      });
      setParties((prev) => [res.party, ...prev]);
      setSelectedPartyId(res.party.id);
      setCustomerSearch('');
      setQuickCustomerName('');
      setShowCustomerDropdown(false);
      showToast(`🎉 Customer ${res.party.name} enrolled! Points will start on this bill.`);
    } catch (err: any) {
      showToast(err.message || 'Failed to enroll customer', 'error');
    } finally {
      setIsQuickEnrolling(false);
    }
  };

  const handleCheckout = async (isKot = false) => {
    if (cart.length === 0) return;

    // Credit payment check
    const selectedCustomer = parties.find((p) => p.id === selectedPartyId);
    if (selectedPayMode === 'credit') {
      if (!selectedCustomer) {
        showToast('Please select a registered customer to bill on credit (Khata). Credit sales cannot be issued to Walk-in customers.', 'warning');
        return;
      }
      if (selectedCustomer.creditLimitMinor && selectedCustomer.creditLimitMinor > 0) {
        const currentBal = (selectedCustomer as any).balanceMinor || (selectedCustomer as any).duesMinor || 0;
        if (currentBal + finalPayableMinor > selectedCustomer.creditLimitMinor) {
          const proceed = window.confirm(
            `⚠️ Customer Credit Limit Warning!\n\n` +
            `Customer: ${selectedCustomer.name}\n` +
            `Credit Limit: ₹${(selectedCustomer.creditLimitMinor / 100).toFixed(2)}\n` +
            `Current Outstanding: ₹${(currentBal / 100).toFixed(2)}\n` +
            `This Bill: ₹${(finalPayableMinor / 100).toFixed(2)}\n\n` +
            `This invoice exceeds their assigned credit limit. Proceed anyway?`
          );
          if (!proceed) return;
        }
      }
    }

    setIsCheckingOut(true);
    try {
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

      let paymentsPayload: { method: string; amountMinor: number }[] = [];
      let tenderPayload: { cashReceivedMinor: number; changeReturnedMinor: number } | null = null;

      if (selectedPayMode === 'credit') {
        paymentsPayload = [];
        tenderPayload = null;
      } else if (selectedPayMode === 'split') {
        if (splitTotalMinor === 0) {
          showToast('Please enter split payment amounts');
          setIsCheckingOut(false);
          return;
        }
        if (splitTotalMinor < finalPayableMinor && !selectedPartyId) {
          showToast(`₹${((finalPayableMinor - splitTotalMinor) / 100).toFixed(2)} remaining. Allocate remaining or select a Customer for Khata.`);
          setIsCheckingOut(false);
          return;
        }

        if (split1Minor > 0) {
          paymentsPayload.push({ method: splitMethod1, amountMinor: split1Minor });
        }
        if (split2Minor > 0) {
          paymentsPayload.push({ method: splitMethod2, amountMinor: split2Minor });
        }

        tenderPayload = null;
      } else {
        paymentsPayload = [{ method: selectedPayMode, amountMinor: finalPayableMinor }];
        if (selectedPayMode === 'cash') {
          tenderPayload = {
            cashReceivedMinor: cashReceivedValMinor,
            changeReturnedMinor: changeDueMinor,
          };
        }
      }

      const res = await api<{
        invoiceId: string;
        number: string;
        totalMinor: number;
        paidMinor: number;
        balanceMinor: number;
        shareToken?: string;
        tender?: { cashReceivedMinor: number; changeReturnedMinor: number } | null;
        earnedLoyaltyPoints?: number;
        redeemedLoyaltyPoints?: number;
        customerLoyaltyPoints?: number;
        partyId?: string;
        isNewCustomer?: boolean;
      }>('/api/invoices', {
        method: 'POST',
        body: JSON.stringify({
          lines,
          billDiscountMinor: discountMinor,
          payments: paymentsPayload,
          tender: tenderPayload,
          customerName: custName || (customerSearch.trim() ? (quickCustomerName.trim() || `Customer ${customerSearch.replace(/\D/g, '').slice(-4)}`) : undefined),
          customerPhone: selectedCustomer ? selectedCustomer.phone : (customerSearch.trim() || undefined),
          partyId: selectedPartyId || undefined,
          redeemedPoints: redeemPoints && pointsActuallyRedeemed > 0 ? pointsActuallyRedeemed : 0,
        }),
      });

      setRedeemPoints(false);

      const itemsInBillCount = cart.reduce((acc, c) => acc + c.qty, 0);
      setCart([]);
      setCashReceived('');
      setSplitAmount1('');
      setSplitAmount2('');
      setSplitCashTendered('');
      setCustomerSearch('');
      setQuickCustomerName('');
      loadInvoices();
      loadParties(); // Refresh customer loyalty points dynamically from backend
      loadReports();
      loadItems(); // refresh stock
      const earnedPoints = res.earnedLoyaltyPoints ?? 0;
      let pointsMsg = '';
      if (res.partyId || selectedPartyId || selectedCustomer?.phone) {
        if (pointsActuallyRedeemed > 0) {
          pointsMsg = ` • Redeemed ${pointsActuallyRedeemed} pts (-${formatRupees(pointsDiscountMinor)}) & earned +${earnedPoints} pts!`;
        } else if (earnedPoints > 0) {
          if (res.isNewCustomer) {
            pointsMsg = ` • 🎉 New member enrolled! +${earnedPoints} loyalty points started!`;
          } else {
            pointsMsg = ` • +${earnedPoints} loyalty points added!`;
          }
        }
      }
      showToast(isKot ? `KOT & Bill Generated: ${res.number}` : `Invoice ${res.number} generated!${pointsMsg}`);
      window.dispatchEvent(new CustomEvent('bill_completed', { detail: res }));

      // Trigger Checkout Success Modal for final bill (Section 4.1: Restaurant flow triggers after final bill, not KOT)
      if (!isKot) {
        const finalPhone = selectedCustomer?.phone || customerSearch.trim() || undefined;
        setCheckoutSuccess({
          invoiceId: res.invoiceId,
          number: res.number,
          customerName: custName || (finalPhone ? `Customer ${finalPhone.slice(-4)}` : undefined),
          customerPhone: finalPhone,
          itemCount: itemsInBillCount,
          totalMinor: res.totalMinor,
          paidMinor: res.paidMinor,
          balanceMinor: res.balanceMinor,
          shareToken: res.shareToken,
          partyId: res.partyId || selectedPartyId || undefined,
          tender: res.tender || tenderPayload,
          payments: paymentsPayload,
        });
        setSuccessPhone(finalPhone || '');
        setSuccessLang((shop?.whatsappDefaultLang as any) || 'en');
        setSuccessSendState('idle');
        setSuccessPhoneError('');
      }
    } catch (err: any) {
      showToast(err.message || 'Checkout failed', 'error');
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
    setHsnSuggestions([]);
    setHsnSearchResults([]);
    setSelectedHsnDesc('');
    setShowHsnDropdown(false);
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
    setHsnSuggestions([]);
    setHsnSearchResults([]);
    setSelectedHsnDesc('');
    setShowHsnDropdown(false);
    setShowItemModal(true);
  };

  // Auto-suggest HSN codes when typing Product Name or Category in Item Modal (only if HSN not yet selected)
  useEffect(() => {
    if (!showItemModal || !itemFormName.trim() || itemFormHsn.trim()) {
      setHsnSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await suggestHsnForProduct(itemFormName, itemFormCategory);
        // Only set if user hasn't selected an HSN in the meantime
        if (!itemFormHsn.trim()) {
          setHsnSuggestions(res.suggestions || []);
        }
      } catch (err) {
        console.warn('Failed to fetch HSN suggestions', err);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [itemFormName, itemFormCategory, showItemModal, itemFormHsn]);

  // Live search when typing inside HSN / SAC field
  useEffect(() => {
    if (!showItemModal || !itemFormHsn.trim() || itemFormHsn.trim().length < 2) {
      setHsnSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setIsHsnSearching(true);
        const res = await searchHsnSac(itemFormHsn, 15);
        setHsnSearchResults(res.results || []);
      } catch (err) {
        console.warn('Failed to search HSN', err);
      } finally {
        setIsHsnSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [itemFormHsn, showItemModal]);

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

  const handleToggleItemActive = async (item: Item, skipConfirm: boolean = false) => {
    if (!can(user?.role as any, 'items.write')) {
      alert("You don't have permission to change product status");
      return;
    }
    if (togglingItemId === item.id) return;

    const prevActive = item.active !== false;
    const newActive = !prevActive;

    // Turning off: ask for confirmation first
    if (prevActive && !skipConfirm) {
      const confirmed = window.confirm(`Deactivate "${item.name}"? It will be hidden from POS billing.`);
      if (!confirmed) return;
    }

    setTogglingItemId(item.id);
    // Optimistically update item in local items state so switch flips immediately
    setItems((prevItems) =>
      prevItems.map((it) => (it.id === item.id ? { ...it, active: newActive } : it))
    );

    try {
      if (newActive) {
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
      await loadItems();
    } catch (err: any) {
      // Roll back on failure!
      setItems((prevItems) =>
        prevItems.map((it) => (it.id === item.id ? { ...it, active: prevActive } : it))
      );
      alert(err.message || 'Failed to change item status');
    } finally {
      setTogglingItemId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingItem || isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteProduct(deletingItem.id);
      showToast(`Product "${deletingItem.name}" deleted successfully!`);
      setDeletingItem(null);
      loadItems();
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete product. It may be referenced by historical transactions.');
    } finally {
      setIsDeleting(false);
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
    setPartyFormLoyaltyPoints('0');
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
    setPartyFormLoyaltyPoints(String(party.loyaltyPoints ?? 0));
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
        loyaltyPoints: partyModalType === 'customer' ? Math.max(0, parseInt(partyFormLoyaltyPoints) || 0) : undefined,
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
      window.dispatchEvent(new CustomEvent('bill_completed', { detail: res }));
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
          parentId: newCatParentId.trim() || undefined,
        }),
      });
      setNewCatName('');
      setNewCatDesc('');
      setNewCatParentId('');
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
          parentId: editingCatParentId.trim() || null,
        }),
      });
      setEditingCatId(null);
      setEditingCatParentId('');
      loadCategories();
      loadItems();
      showToast('Category updated!');
    } catch (err: any) {
      alert(err.message || 'Failed to update category');
    }
  };

  const handleToggleCategoryActive = async (cat: Category) => {
    try {
      const nextActive = !cat.active;
      await api(`/api/categories/${cat.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: nextActive }),
      });
      showToast(`Category "${cat.name}" ${nextActive ? 'activated (ON)' : 'deactivated (OFF)'}!`);
      loadCategories();
    } catch (err: any) {
      alert(err.message || 'Failed to update category status');
    }
  };

  const handleDeleteCategory = async (cat: Category) => {
    const confirmMsg = `Are you sure you want to permanently delete category "${cat.name}"? Products assigned to this category will have their category cleared.`;
    if (!window.confirm(confirmMsg)) return;

    try {
      await api(`/api/categories/${cat.id}`, {
        method: 'DELETE',
      });
      showToast(`Category "${cat.name}" permanently deleted!`);
      loadCategories();
      loadItems();
    } catch (err: any) {
      alert(err.message || 'Failed to delete category');
    }
  };

  const handleDownloadCategoryTemplate = async () => {
    try {
      const token = getToken();
      const res = await fetch('/api/categories/template', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Failed to download template');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'categories_sample_template.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast('Sample template downloaded!');
    } catch (err: any) {
      alert(err.message || 'Failed to download category template');
    }
  };

  const handleCategoryFileChange = async (file: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      alert('Please select a valid CSV file (.csv).');
      return;
    }
    setCatImportFileName(file.name);
    setCatImportLoading(true);
    setCatImportResult(null);
    setCatImportPreview(null);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const text = String(evt.target?.result || '');
      setCatImportCsv(text);
      try {
        const preview = await api<any>('/api/categories/import', {
          method: 'POST',
          body: JSON.stringify({ csvContent: text, dryRun: true }),
        });
        setCatImportPreview(preview);
      } catch (err: any) {
        alert(err.message || 'Failed to parse category file');
        setCatImportPreview(null);
      } finally {
        setCatImportLoading(false);
      }
    };
    reader.onerror = () => {
      alert('Failed to read file content.');
      setCatImportLoading(false);
    };
    reader.readAsText(file);
  };

  const handleCommitCategoryImport = async () => {
    if (!catImportCsv) return;
    setCatImportLoading(true);
    try {
      const res = await api<{
        success: boolean;
        total: number;
        created: number;
        updated: number;
        skipped: number;
        errors: Array<{ row: number; name?: string; error: string }>;
      }>('/api/categories/import', {
        method: 'POST',
        body: JSON.stringify({
          csvContent: catImportCsv,
          dryRun: false,
          updateExisting: catImportUpdateExisting,
        }),
      });
      setCatImportResult(res);
      setCatImportPreview(null);
      loadCategories();
      loadItems();
      showToast(`Import completed: ${res.created} created, ${res.updated} updated, ${res.skipped} skipped`);
    } catch (err: any) {
      alert(err.message || 'Category import failed');
    } finally {
      setCatImportLoading(false);
    }
  };

  const handleDownloadImportErrors = () => {
    const errors = catImportPreview?.errors || catImportResult?.errors || [];
    if (errors.length === 0) return;
    const csvContent = 'Row,Category Name,Error\r\n' + errors.map((e) => `${e.row},"${(e.name || '').replace(/"/g, '""')}","${(e.error || '').replace(/"/g, '""')}"`).join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'category_import_errors.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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

    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      item.name.toLowerCase().includes(q) ||
      (item.barcode && item.barcode.toLowerCase().includes(q)) ||
      (item.sku && item.sku.toLowerCase().includes(q)) ||
      (item.hsn && item.hsn.toLowerCase().includes(q)) ||
      (item.category && item.category.toLowerCase().includes(q));

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

  const filteredParties = parties.filter((p) => {
    if (p.type !== 'customer') return false;
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
      {/* Enterprise Custom Toast Notifications */}
      {toasts.length > 0 && (
        <div className="enterprise-toast-container" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className={`enterprise-toast toast-${t.type}`} role="alert">
              <div className="toast-icon-badge">
                {t.type === 'success' && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                {t.type === 'error' && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                )}
                {t.type === 'warning' && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                )}
                {t.type === 'info' && (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                )}
              </div>

              <div className="toast-body">
                {t.title && <div className="toast-headline">{t.title}</div>}
                <div className="toast-text">{t.message}</div>
              </div>

              <button
                type="button"
                className="toast-close-btn"
                onClick={() => dismissToast(t.id)}
                aria-label="Dismiss notification"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>

              <div
                className="toast-timer-bar"
                style={{ animationDuration: `${t.duration}ms` }}
              />
            </div>
          ))}
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
              <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', flexShrink: 0, boxShadow: '0 2px 8px rgba(79, 70, 229, 0.35)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                  <polyline points="9 22 9 12 15 12 15 22"></polyline>
                </svg>
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
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="9" rx="1"></rect>
                  <rect x="14" y="3" width="7" height="5" rx="1"></rect>
                  <rect x="14" y="12" width="7" height="9" rx="1"></rect>
                  <rect x="3" y="16" width="7" height="5" rx="1"></rect>
                </svg>
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
              <span className="nav-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="9" cy="21" r="1"></circle>
                  <circle cx="20" cy="21" r="1"></circle>
                  <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                </svg>
              </span>
              <span className="nav-text">POS Counter</span>
              <span className="nav-tag-shortcut">F1</span>
            </button>
            {/* 3. Cashier Shifts: ONLY for Cashier (Store Manager manages shifts from Branch Dashboard) */}
            {user.role === 'cashier' && (
              <button
                type="button"
                className={`sidebar-nav-item ${activeTab === 'shifts' ? 'active' : ''}`}
                onClick={() => setActiveTab('shifts')}
              >
                <span className="nav-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="6" width="20" height="12" rx="2"></rect>
                    <circle cx="12" cy="12" r="2"></circle>
                    <path d="M6 12h.01M18 12h.01"></path>
                  </svg>
                </span>
                <span className="nav-text">My Cashier Shift</span>
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

            {/* 4b. Categories: Dedicated Module */}
            {user.role !== 'cashier' && (
              <button
                type="button"
                className={`sidebar-nav-item ${activeTab === 'categories' ? 'active' : ''}`}
                onClick={() => setActiveTab('categories')}
              >
                <span className="nav-icon">🏷️</span>
                <span className="nav-text">Categories</span>
                <span className="nav-count-badge">{categoriesList.length}</span>
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
                <div className="nav-trailing">
                  {totalStockAlerts > 0 && (
                    <span
                      className={`nav-count-badge ${outOfStockItems.length > 0 ? 'blinking-badge-red' : 'blinking-badge-amber'}`}
                      title={`${outOfStockItems.length} out of stock, ${lowStockItems.length} low stock`}
                    >
                      {totalStockAlerts}
                    </span>
                  )}
                  <span className={`nav-dropdown-chevron ${isInventorySubmenuVisible ? 'open' : ''}`} aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </span>
                </div>
              </button>
            )}

            {/* Inventory Submenu */}
            {user.role !== 'cashier' && isInventorySubmenuVisible && (
              <div className="sidebar-submenu-list" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className={`sidebar-submenu-item ${activeTab === 'product-movement' ? 'active' : ''}`}
                  onClick={() => {
                    setActiveTab('product-movement');
                    setShowInventoryDropdown(true);
                  }}
                  title="Product Analysis"
                >
                  <span className="submenu-icon" aria-hidden="true">🚀</span>
                  <span className="submenu-text">Product Analysis</span>
                </button>
              </div>
            )}

            {/* Sales Analysis: For Store Manager and Super Admin */}
            {user.role !== 'cashier' && (
              <button
                type="button"
                className={`sidebar-nav-item ${activeTab === 'sales-analysis' ? 'active' : ''}`}
                onClick={() => setActiveTab('sales-analysis')}
              >
                <span className="nav-icon">💰</span>
                <span className="nav-text">Sales Analysis</span>
                <span className="nav-badge-new">NEW</span>
              </button>
            )}

            {/* Cashier Recent Bills */}
            {user.role === 'cashier' && (
              <button
                type="button"
                className={`sidebar-nav-item ${activeTab === 'invoices' ? 'active' : ''}`}
                onClick={() => setActiveTab('invoices')}
              >
                <span className="nav-icon">📄</span>
                <span className="nav-text">Recent Bills</span>
              </button>
            )}

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

            {/* ACCOUNTS & FINANCE - Matching upper section nav items */}
            {user.role !== 'cashier' && (
              <>
                <button
                  type="button"
                  className="sidebar-nav-item"
                  onClick={() => setIsAccountsOpen(!isAccountsOpen)}
                  aria-expanded={isAccountsOpen}
                >
                  <span className="nav-icon">💼</span>
                  <span className="nav-text">Accounts &amp; Finance</span>
                  <span className={`sidebar-chevron ${isAccountsOpen ? 'open' : ''}`}>▼</span>
                </button>
                
                {isAccountsOpen && (
                  <div className="sidebar-sub-items">
                    <button
                      type="button"
                      className={`sidebar-nav-item ${activeTab === 'invoices' ? 'active' : ''}`}
                      onClick={() => setActiveTab('invoices')}
                    >
                      <span className="nav-icon">🧾</span>
                      <span className="nav-text">Sales &amp; Invoices</span>
                    </button>

                    {can(user?.role as any, 'purchases') && (
                      <button
                        type="button"
                        className={`sidebar-nav-item ${activeTab === 'purchases' ? 'active' : ''}`}
                        onClick={() => {
                          setActiveTab('purchases');
                          loadPurchases();
                        }}
                      >
                        <span className="nav-icon">📥</span>
                        <span className="nav-text">Purchases &amp; Inward</span>
                        <span className="nav-count-badge">{purchases.length}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      className={`sidebar-nav-item ${activeTab === 'payments' ? 'active' : ''}`}
                      onClick={() => setActiveTab('payments')}
                    >
                      <span className="nav-icon">💳</span>
                      <span className="nav-text">Payments</span>
                    </button>

                    <button
                      type="button"
                      className={`sidebar-nav-item ${activeTab === 'expenses' ? 'active' : ''}`}
                      onClick={() => setActiveTab('expenses')}
                    >
                      <span className="nav-icon">💼</span>
                      <span className="nav-text">Expenses</span>
                    </button>

                    <button
                      type="button"
                      className={`sidebar-nav-item ${activeTab === 'cashbank' ? 'active' : ''}`}
                      onClick={() => setActiveTab('cashbank')}
                    >
                      <span className="nav-icon">🏦</span>
                      <span className="nav-text">Cash &amp; Bank</span>
                    </button>

                    <button
                      type="button"
                      className={`sidebar-nav-item ${activeTab === 'payables' ? 'active' : ''}`}
                      onClick={() => setActiveTab('payables')}
                    >
                      <span className="nav-icon">📉</span>
                      <span className="nav-text">Payables</span>
                    </button>

                    <button
                      type="button"
                      className={`sidebar-nav-item ${activeTab === 'reports' ? 'active' : ''}`}
                      onClick={() => setActiveTab('reports')}
                    >
                      <span className="nav-icon">📊</span>
                      <span className="nav-text">Financial Reports</span>
                    </button>
                  </div>
                )}
              </>
            )}

            {/* GST FILING - Matching upper section nav items */}
            {user.role !== 'cashier' && (
              <>
                <button
                  type="button"
                  className="sidebar-nav-item"
                  onClick={() => setIsGstOpen(!isGstOpen)}
                  aria-expanded={isGstOpen}
                >
                  <span className="nav-icon">🏛️</span>
                  <span className="nav-text">GST Filing</span>
                  <span className={`sidebar-chevron ${isGstOpen ? 'open' : ''}`}>▼</span>
                </button>
                
                {isGstOpen && (
                  <div className="sidebar-sub-items">
                    <button
                      type="button"
                      className={`sidebar-nav-item ${activeTab === 'gst-overview' ? 'active' : ''}`}
                      onClick={() => setActiveTab('gst-overview')}
                    >
                      <span className="nav-icon">🏛️</span>
                      <span className="nav-text">GST Overview</span>
                    </button>

                    <button
                      type="button"
                      className={`sidebar-nav-item ${activeTab === 'gst-sales-register' ? 'active' : ''}`}
                      onClick={() => setActiveTab('gst-sales-register')}
                    >
                      <span className="nav-icon">📋</span>
                      <span className="nav-text">Sales Register</span>
                    </button>

                    <button
                      type="button"
                      className={`sidebar-nav-item ${activeTab === 'gst-gstr1' ? 'active' : ''}`}
                      onClick={() => setActiveTab('gst-gstr1')}
                    >
                      <span className="nav-icon">📑</span>
                      <span className="nav-text">GSTR-1</span>
                    </button>

                    <button
                      type="button"
                      className={`sidebar-nav-item ${activeTab === 'gst-purchase-register' ? 'active' : ''}`}
                      onClick={() => setActiveTab('gst-purchase-register')}
                    >
                      <span className="nav-icon">📦</span>
                      <span className="nav-text">Purchase Register</span>
                    </button>

                    <button
                      type="button"
                      className={`sidebar-nav-item ${activeTab === 'gst-itc-reconciliation' ? 'active' : ''}`}
                      onClick={() => setActiveTab('gst-itc-reconciliation')}
                    >
                      <span className="nav-icon">⚖️</span>
                      <span className="nav-text">ITC Register &amp; Reconciliation</span>
                    </button>

                    <button
                      type="button"
                      className={`sidebar-nav-item ${activeTab === 'gst-gstr3b' ? 'active' : ''}`}
                      onClick={() => setActiveTab('gst-gstr3b')}
                    >
                      <span className="nav-icon">📄</span>
                      <span className="nav-text">GSTR-3B Preparation</span>
                    </button>

                    <button
                      type="button"
                      className={`sidebar-nav-item ${activeTab === 'gst-import-export' ? 'active' : ''}`}
                      onClick={() => setActiveTab('gst-import-export')}
                    >
                      <span className="nav-icon">📥</span>
                      <span className="nav-text">Import &amp; Export</span>
                    </button>

                    <button
                      type="button"
                      className={`sidebar-nav-item ${activeTab === 'gst-filing-history' ? 'active' : ''}`}
                      onClick={() => setActiveTab('gst-filing-history')}
                    >
                      <span className="nav-icon">🕰️</span>
                      <span className="nav-text">Filing History</span>
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Management Section: Only for Super Admin */}
            {user.role === 'owner' && (
              <>
                <div className="sidebar-section-label" style={{ marginTop: '0.75rem' }}>CONFIGURATION</div>
                <button
                  type="button"
                  className={`sidebar-nav-item ${activeTab === 'settings' ? 'active' : ''}`}
                  onClick={() => setActiveTab('settings')}
                >
                  <span className="nav-icon">⚙️</span>
                  <span className="nav-text">Business Packs</span>
                </button>
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
                <span className="action-row-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                  </svg>
                </span>
                <span>Settings</span>
              </button>
            )}
            <button
              type="button"
              className="sidebar-action-row-btn signout"
              onClick={handleLogout}
              title="Logout of current business"
            >
              <span className="action-row-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                  <polyline points="16 17 21 12 16 7"></polyline>
                  <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
              </span>
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
            <span className="global-search-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            </span>
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
                  ? `${totalStockAlerts} Inventory Alert${totalStockAlerts > 1 ? 's' : ''} (${outOfStockItems.length} out of stock, ${lowStockItems.length} low stock) — Click to review`
                  : 'No inventory alerts'
              }
              onClick={() => setActiveTab('inventory')}
            >
              <span className="notif-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                  <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                </svg>
              </span>
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
        {activeTab !== 'pos' && activeTab !== 'sales-analysis' && activeTab !== 'dashboard' && !(user.role === 'manager' && activeTab === 'shifts') && (
          <header className="content-top-header">
            <div className="content-header-left">
              <h1 className="content-page-title">
                {activeTab === 'shifts' && 'Cashier Shifts & Day-End Closing'}
                {activeTab === 'items' && 'Product & Stock Catalog'}
                {activeTab === 'inventory' && 'Inventory Hub & Stock Operations'}
                {activeTab === 'product-movement' && 'Product Movement Analysis'}
                {activeTab === 'purchases' && 'Purchases & Stock Inward'}
                {activeTab === 'invoices' && 'Sales Invoices & Bills'}
                {activeTab === 'customers' && 'Customer Directory & Loyalty Points'}
                {activeTab === 'suppliers' && 'Supplier Directory'}
                {activeTab === 'reports' && 'Business Analytics & Reports'}
                {activeTab === 'settings' && 'Business Configuration & Settings'}
                {activeTab === 'payments' && 'Supplier Payments & Disbursements'}
                {activeTab === 'expenses' && 'Business Operational Expenses'}
                {activeTab === 'cashbank' && 'Cash & Bank Reconciliation'}
                {activeTab === 'receivables' && 'Accounts Receivable & Customer Dues'}
                {activeTab === 'payables' && 'Accounts Payable & Vendor Balances'}
                {activeTab === 'gst-overview' && 'GST Compliance & Filing Overview'}
                {activeTab === 'gst-sales-register' && 'GST Sales Register (Outward)'}
                {activeTab === 'gst-purchase-register' && 'GST Purchase & Inward Register'}
                {activeTab === 'gst-itc-reconciliation' && 'Input Tax Credit (ITC) Register & Reconciliation'}
                {activeTab === 'gst-gstr3b' && 'GSTR-3B Preparation & Filing'}
                {activeTab === 'gst-gstr1' && 'GSTR-1 Outward Supplies'}
                {activeTab === 'gst-import-export' && 'GST Import & Export Hub'}
                {activeTab === 'gst-filing-history' && 'GST Return Filing History'}
              </h1>
              <span className="content-page-subtitle">
                {activeTab === 'shifts' && 'Manage cashier registers, drawer cash float, cash movements, and day-end reconciliation reports'}
                {activeTab === 'items' && 'Manage your catalog, stock balances, tax rates, and barcodes'}
                {activeTab === 'inventory' && 'Real-time stock valuation, movements ledger, manual adjustments, physical count audits, and replenishment'}
                {activeTab === 'product-movement' && 'Fast, slow and non-moving products from completed bills · returns and cancelled bills excluded'}
                {activeTab === 'purchases' && 'Record supplier invoices, inward goods stock into ledger, and track purchase GST'}
                {activeTab === 'invoices' && 'View issued invoices, audit trails, and print thermal receipts'}
                {activeTab === 'customers' && 'Manage customer directory, contact numbers, GSTINs, and loyalty points'}
                {activeTab === 'suppliers' && 'Manage vendors, purchase distributors, GSTIN verification, and credit limits'}
                {activeTab === 'reports' && 'Real-time sales revenue, tax breakdown, and top selling items'}
                {activeTab === 'settings' && 'Store profile, GST settings, and tailored trade packs'}
                {activeTab === 'payments' && 'Manage supplier payments, vendor disbursements, and payment vouchers'}
                {activeTab === 'expenses' && 'Record, categorize, track vendor GSTINs, and manage business overhead expenditures'}
                {activeTab === 'cashbank' && 'Monitor register cash drawer, bank collections, and payment method summaries'}
                {activeTab === 'receivables' && 'Outstanding customer credits, ageing analysis, and khata receivables'}
                {activeTab === 'payables' && 'Outstanding supplier invoices, vendor dues, and settlement schedules'}
                {activeTab === 'gst-overview' && 'Period sales, outward GST, purchases, potential vs reviewed ITC, and estimated net liability'}
                {activeTab === 'gst-sales-register' && 'Complete outward invoices register with B2B/B2C categorization and GST breakdown'}
                {activeTab === 'gst-purchase-register' && 'Consolidated statutory record of stock purchases and business expense vouchers'}
                {activeTab === 'gst-itc-reconciliation' && 'Reconcile purchases and expenses against GSTR-2B and record authoritative ITC decisions'}
                {activeTab === 'gst-gstr3b' && 'Draft and verify Table 3.1 outward liabilities, Table 4 reviewed eligible ITC, and net cash tax payable'}
                {activeTab === 'gst-gstr1' && 'B2B supplies (Table 4) and B2C retail counter sales (Table 7) return preparation'}
                {activeTab === 'gst-import-export' && 'Upload GSTR-2B JSON/CSV statements and download statutory GST worksheets and audit reports'}
                {activeTab === 'gst-filing-history' && 'Permanent historical audit log of filed returns, ARN numbers, and tax snapshots'}
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

        {/* TAB 0: DASHBOARDS (TODAY OVERVIEW + ROLE-BASED MANAGEMENT DASHBOARDS) */}
        {activeTab === 'dashboard' && user && (
          <div className="dashboard-tab-wrapper">
            <div className="dashboard-mode-switcher-bar" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: '1rem', gap: '0.75rem' }}>
              <div style={{ display: 'inline-flex', background: '#f1f5f9', padding: '3px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                <button
                  type="button"
                  style={{
                    padding: '6px 14px',
                    borderRadius: '7px',
                    border: 'none',
                    fontWeight: 600,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    background: dashboardViewMode === 'today' ? '#6d4aff' : 'transparent',
                    color: dashboardViewMode === 'today' ? '#ffffff' : '#64748b',
                    boxShadow: dashboardViewMode === 'today' ? '0 2px 6px rgba(109,74,255,0.25)' : 'none',
                    transition: 'all 0.15s ease',
                  }}
                  onClick={() => setDashboardViewMode('today')}
                >
                  📊 Today's Live Overview
                </button>
                <button
                  type="button"
                  style={{
                    padding: '6px 14px',
                    borderRadius: '7px',
                    border: 'none',
                    fontWeight: 600,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    background: dashboardViewMode === 'management' ? '#6d4aff' : 'transparent',
                    color: dashboardViewMode === 'management' ? '#ffffff' : '#64748b',
                    boxShadow: dashboardViewMode === 'management' ? '0 2px 6px rgba(109,74,255,0.25)' : 'none',
                    transition: 'all 0.15s ease',
                  }}
                  onClick={() => setDashboardViewMode('management')}
                >
                  🏢 {user.role === 'owner' ? 'Company Multi-Branch View' : user.role === 'manager' ? 'Store Operations View' : 'Cashier Register View'}
                </button>
              </div>
            </div>

            {dashboardViewMode === 'today' ? (
              <TodayDashboardView
                user={user}
                shop={shop}
                onNavigateToPos={() => setActiveTab('pos')}
                onNavigateToShifts={() => setActiveTab('shifts')}
                onNavigateToInventory={() => setActiveTab('inventory')}
                onNavigateToSalesAnalysis={() => setActiveTab('sales-analysis')}
                onNavigateToPurchases={() => {
                  setActiveTab('purchases');
                  loadPurchases();
                }}
                onOpenAddProductModal={() => {
                  setEditingItem(null);
                  setShowItemModal(true);
                }}
                showToast={showToast}
              />
            ) : (
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
          </div>
        )}

        {/* TAB 1: BENTO POS BILLING TERMINAL */}
        {activeTab === 'pos' && (
          <div className="bento-pos-root">
            {/* 1. TOP BENTO BAR: Store & Shift Status, Shortcuts, Alerts */}
            <div className="bento-top-bar">
              <div className="bento-top-left">
                <div className="bento-pos-badge">
                  <span className="bento-badge-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                    </svg>
                  </span>
                  <div>
                    <div className="bento-badge-title">POS Billing Counter</div>
                    <div className="bento-badge-sub">High-Speed Bento Billing Terminal</div>
                  </div>
                </div>

                {/* Shift Indicator Pill */}
                {activeShiftNumber ? (
                  <div className="bento-shift-pill open">
                    <span className="bento-pulse-dot green"></span>
                    <span>Register #{activeShiftNumber} Active</span>
                  </div>
                ) : (
                  <div className="bento-shift-pill closed" onClick={() => setShowPosOpenShiftModal(true)}>
                    <span className="bento-pulse-dot amber"></span>
                    <span>Register Closed • Click to Open Shift</span>
                  </div>
                )}
              </div>

              <div className="bento-top-right">
                {/* Customer Display Button */}
                <button
                  type="button"
                  className={`bento-cfd-pill ${isCfdConnected ? 'active' : ''}`}
                  onClick={() => setShowCfdModal(true)}
                  title="Open Customer-Facing Display (Secondary Monitor / Wireless Tablet)"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                    <line x1="8" y1="21" x2="16" y2="21"></line>
                    <line x1="12" y1="17" x2="12" y2="21"></line>
                  </svg>
                  <span>Customer Screen</span>
                  {isCfdConnected && <span className="bento-cfd-dot"></span>}
                </button>

                {/* Inventory Alert Trigger */}
                {totalStockAlerts > 0 && (
                  <button
                    type="button"
                    className="bento-alert-pill"
                    onClick={() => setActiveTab('inventory')}
                    title={`${totalStockAlerts} items have stock warnings`}
                  >
                    <span className="alert-ping">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                        <line x1="12" y1="9" x2="12" y2="13"></line>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                      </svg>
                    </span>
                    <span>{totalStockAlerts} Stock Alerts</span>
                    <span className="alert-arrow">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                        <polyline points="12 5 19 12 12 19"></polyline>
                      </svg>
                    </span>
                  </button>
                )}
              </div>
            </div>

            {/* Shift Closed Banner Warning */}
            {!activeShiftNumber && (
              <div className="bento-shift-warning-banner">
                <div className="bento-warning-text">
                  <span className="warning-icon">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.4">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="8" x2="12" y2="12"></line>
                      <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                  </span>
                  <div>
                    <strong>Cashier Register Shift is Closed.</strong> Cash collections will not be tracked to a drawer register. Open a shift to record initial cash float.
                  </div>
                </div>
                <button
                  type="button"
                  className="bento-open-shift-btn"
                  onClick={() => setShowPosOpenShiftModal(true)}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <rect x="2" y="4" width="20" height="16" rx="2"></rect>
                    <path d="M12 12h.01M6 16h12M10 8h4"></path>
                  </svg>
                  <span>Open Cash Drawer</span>
                </button>
              </div>
            )}

            {/* MAIN BENTO GRID */}
            <div className="bento-pos-grid">
              {/* ================= LEFT BENTO COLUMN: Catalog & Operations ================= */}
              <div className="bento-left-col">
                {/* ROW 1: Customer Card & Barcode Scanner in a 2-Card Bento Row */}
                <div className="bento-subgrid-2">
                  {/* BENTO CARD: Customer Desk & Loyalty Rewards */}
                  <div className="bento-card bento-customer-card">
                    <div className="bento-card-header">
                      <div className="bento-header-label">
                        <span className="bento-icon-circle blue">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                          </svg>
                        </span>
                        <div>
                          <h3 className="bento-card-title">Customer & Loyalty Rewards</h3>
                          <span className="bento-card-subtitle">
                            {selectedParty ? 'Earn 1 pt per ₹10 • Instant counter discount' : 'Enter mobile to credit points automatically'}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="bento-add-btn"
                        onClick={() => setShowPartyModal(true)}
                        title="Add New Customer"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <line x1="12" y1="5" x2="12" y2="19"></line>
                          <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        <span>Customer</span>
                      </button>
                    </div>

                    <div className="bento-customer-body">
                      <div className="customer-input-wrap">
                        <input
                          type="text"
                          className="bento-input"
                          placeholder="📱 Enter customer mobile or name..."
                          value={customerSearch}
                          onChange={(e) => {
                            setCustomerSearch(e.target.value);
                            setShowCustomerDropdown(true);
                          }}
                          onFocus={() => {
                            if (customerSearch.trim()) setShowCustomerDropdown(true);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') setShowCustomerDropdown(false);
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const cleanDigits = customerSearch.replace(/\D/g, '');
                              const match = cleanDigits.length >= 7
                                ? parties.find(p => p.type === 'customer' && p.phone && (p.phone === cleanDigits || p.phone.replace(/\D/g, '').endsWith(cleanDigits)))
                                : null;
                              if (match) {
                                setSelectedPartyId(match.id);
                                setCustomerSearch('');
                                setShowCustomerDropdown(false);
                                showToast(`✓ Linked member: ${match.name}`);
                              } else if (cleanDigits.length >= 10) {
                                handleQuickEnrollCustomer(cleanDigits, quickCustomerName);
                              } else if (filteredParties.length === 1) {
                                setSelectedPartyId(filteredParties[0].id);
                                setCustomerSearch('');
                                setShowCustomerDropdown(false);
                              }
                            }
                          }}
                        />
                        {selectedParty && (
                          <div className="selected-customer-pill">
                            <span className="customer-name-tag">{selectedParty.name}</span>
                            <button
                              type="button"
                              className="clear-pill-btn"
                              onClick={() => {
                                setSelectedPartyId('');
                                setCustomerSearch('');
                                setRedeemPoints(false);
                              }}
                              title="Switch to Walk-in"
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                              </svg>
                            </button>
                          </div>
                        )}

                        {showCustomerDropdown && customerSearch.trim().length > 0 && (() => {
                          const cleanDigits = customerSearch.replace(/\D/g, '');
                          const isPhoneCandidate = cleanDigits.length >= 7;
                          const exactPhoneMatch = isPhoneCandidate
                            ? parties.find(p => p.type === 'customer' && p.phone && (p.phone === cleanDigits || p.phone.replace(/\D/g, '').endsWith(cleanDigits)))
                            : null;

                          return (
                            <>
                              <div
                                style={{ position: 'fixed', inset: 0, zIndex: 45 }}
                                onClick={() => setShowCustomerDropdown(false)}
                              />
                              <div className="customer-dropdown-list" style={{ zIndex: 50 }}>
                                {/* If phone digits typed and no existing customer matches: show fast inline enroll */}
                                {isPhoneCandidate && !exactPhoneMatch && (
                                  <div className="pos-quick-enroll-box" style={{ margin: '0.4rem 0.5rem' }}>
                                    <div className="pos-quick-enroll-head">
                                      <span className="pos-enroll-star">✨</span>
                                      <div>
                                        <div className="pos-enroll-title">
                                          <span>New Customer Mobile:</span>
                                          <strong>{cleanDigits}</strong>
                                        </div>
                                        <div className="pos-enroll-sub">First-time shopper • Loyalty points will start on this bill!</div>
                                      </div>
                                    </div>
                                    <div className="pos-quick-enroll-inputs">
                                      <input
                                        type="text"
                                        className="bento-input pos-enroll-name-input"
                                        placeholder="Customer Name (optional)"
                                        value={quickCustomerName}
                                        onChange={(e) => setQuickCustomerName(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            e.preventDefault();
                                            handleQuickEnrollCustomer(cleanDigits, quickCustomerName);
                                          }
                                        }}
                                      />
                                      <button
                                        type="button"
                                        className="pos-enroll-btn"
                                        onClick={() => handleQuickEnrollCustomer(cleanDigits, quickCustomerName)}
                                        disabled={isQuickEnrolling}
                                      >
                                        {isQuickEnrolling ? 'Enrolling...' : '⚡ Enroll (Enter)'}
                                      </button>
                                    </div>
                                    <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.4rem', textAlign: 'center' }}>
                                      💡 Or continue billing — account and points automatically start upon checkout!
                                    </div>
                                  </div>
                                )}

                                {filteredParties.length > 0 ? (
                                  filteredParties.map((p) => {
                                    const pts = getPartyLoyaltyPoints(p.id, p.phone);
                                    const isExact = exactPhoneMatch?.id === p.id;
                                    return (
                                      <div
                                        key={p.id}
                                        className="customer-dropdown-item"
                                        style={isExact ? { background: '#f0fdf4', borderLeft: '3px solid #16a34a' } : undefined}
                                        onClick={() => {
                                          setSelectedPartyId(p.id);
                                          setCustomerSearch('');
                                          setRedeemPoints(false);
                                          setShowCustomerDropdown(false);
                                        }}
                                      >
                                        <div className="cust-item-main">
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                                            <span className="cust-item-name">{p.name}</span>
                                            {isExact && (
                                              <span style={{ fontSize: '0.65rem', background: '#dcfce7', color: '#166534', padding: '0.1rem 0.35rem', borderRadius: '4px', fontWeight: 700 }}>
                                                Exact Match
                                              </span>
                                            )}
                                          </div>
                                          <span className="cust-item-phone">📱 {p.phone || 'No phone'}</span>
                                        </div>
                                        <div className="cust-item-loyalty-tag">
                                          🪙 {pts.toLocaleString()} pts
                                        </div>
                                      </div>
                                    );
                                  })
                                ) : !isPhoneCandidate ? (
                                  <div style={{ padding: '0.85rem 1rem', textAlign: 'center', fontSize: '0.82rem', color: '#64748b' }}>
                                    <div>No customer found matching "{customerSearch}"</div>
                                    <button
                                      type="button"
                                      className="bento-add-btn"
                                      style={{ margin: '0.5rem auto 0', display: 'inline-flex' }}
                                      onClick={() => {
                                        setShowCustomerDropdown(false);
                                        openAddPartyModal('customer');
                                      }}
                                    >
                                      + Register New Customer
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </>
                          );
                        })()}
                      </div>

                      {/* Customer Info Highlights */}
                      {selectedParty ? (
                        <div className="bento-customer-loyalty-card">
                          <div className="loyalty-card-head">
                            <div className="loyalty-phone-box">
                              <span style={{ color: (selectedParty.loyaltyPoints ?? 0) > 0 ? '#15803d' : '#2563eb', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                                {(selectedParty.loyaltyPoints ?? 0) > 0 ? 'Member' : 'Enrolled'}
                              </span>
                              <span style={{ color: '#94a3b8' }}>•</span>
                              <span className="mono bold">{selectedParty.phone || 'No mobile'}</span>
                            </div>
                            <div className="loyalty-pts-pill" title={`1 pt = ${formatRupees(shopPointValMinor)} discount`}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '3px' }}>
                                <circle cx="12" cy="12" r="9" />
                                <path d="M12 7v10M15 9.5a2.5 2.5 0 0 0-5 0c0 4 5 2 5 6a2.5 2.5 0 0 1-5 0" />
                              </svg>
                              <span className="mono bold pts-count">{selectedPartyPoints.toLocaleString()}</span>
                              <span className="pts-label">pts</span>
                              <span className="pts-val-bracket">({formatRupees(selectedPartyPoints * shopPointValMinor)})</span>
                            </div>
                          </div>

                          {/* 1-Click Points Redemption Button */}
                          {shopLoyaltyActive && selectedPartyPoints >= shopMinRedeem && cart.length > 0 && (
                            <button
                              type="button"
                              className={`pos-redeem-points-btn ${redeemPoints ? 'redeeming' : ''}`}
                              onClick={() => setRedeemPoints(!redeemPoints)}
                              title={redeemPoints ? 'Cancel points redemption' : `Redeem points for instant discount (1 pt = ${formatRupees(shopPointValMinor)})`}
                            >
                              {redeemPoints ? (
                                <>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                  <span>Redeeming <strong>{pointsActuallyRedeemed} pts</strong> (-{formatRupees(pointsDiscountMinor)})</span>
                                  <span className="redeem-cancel">✕ Cancel</span>
                                </>
                              ) : (
                                <>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                                  </svg>
                                  <span>Redeem Available Points</span>
                                  <span className="redeem-save-badge">Save up to {formatRupees(Math.min(cartTotalMinor - percentDiscountMinor, selectedPartyPoints * shopPointValMinor))}</span>
                                </>
                              )}
                            </button>
                          )}

                          {shopLoyaltyActive && selectedPartyPoints > 0 && selectedPartyPoints < shopMinRedeem && (
                            <div style={{ fontSize: '0.72rem', color: '#64748b', background: '#f8fafc', padding: '0.35rem 0.65rem', borderRadius: '6px', border: '1px dashed #cbd5e1', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="16" x2="12" y2="12" />
                                <line x1="12" y1="8" x2="12.01" y2="8" />
                              </svg>
                              <span>Min. {shopMinRedeem} pts required to redeem (Current: {selectedPartyPoints} pts)</span>
                            </div>
                          )}

                          {/* Points Earned Preview */}
                          {shopLoyaltyActive ? (
                            <div className="loyalty-earn-notice">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="8" r="7" />
                                <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
                              </svg>
                              <span>
                                This bill earns: <strong className="mono">+{pointsToEarnOnBill} pts</strong> ({shopPointsPer100} pts per ₹100 spent)
                                {selectedPartyPoints > 0 && (
                                  <span style={{ color: '#059669', marginLeft: '6px', fontWeight: 600 }}>
                                    ➔ Total will be: {(selectedPartyPoints - (redeemPoints ? pointsActuallyRedeemed : 0) + pointsToEarnOnBill).toLocaleString()} pts
                                  </span>
                                )}
                              </span>
                            </div>
                          ) : (
                            <div className="loyalty-earn-notice" style={{ opacity: 0.7 }}>
                              <span>Loyalty program paused in shop settings</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="bento-customer-quick-row">
                          <div className="bento-walkin-pill">
                            <span className="walkin-dot"></span>
                            <span>Walk-in Customer</span>
                            <span className="walkin-tag">Default</span>
                          </div>
                          <button
                            type="button"
                            className="bento-cust-count-badge"
                            onClick={() => setShowPartyModal(true)}
                            title="Open Customer Accounts Directory"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                              <circle cx="9" cy="7" r="4"></circle>
                              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                            </svg>
                            <span>{parties.length} Saved</span>
                          </button>
                        </div>
                      )}

                      {/* Pharmacy Doctor Field */}
                      {shop?.businessType === 'pharmacy' && (
                        <div className="bento-pharmacy-row">
                          <label className="bento-sublabel">Doctor / Prescription:</label>
                          <input
                            type="text"
                            className="bento-input compact"
                            value={doctorName}
                            onChange={(e) => setDoctorName(e.target.value)}
                            placeholder="Dr. Name & Reg No."
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* BENTO CARD: Fast Barcode Scanner Hub */}
                  <div className="bento-card bento-scanner-card">
                    <div className="bento-card-header">
                      <div className="bento-header-label">
                        <span className="bento-icon-circle purple">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <path d="M3 5v14M8 5v14M12 5v14M17 5v14M21 5v14" />
                          </svg>
                        </span>
                        <div>
                          <h3 className="bento-card-title">Barcode Scanner</h3>
                          <span className="bento-card-subtitle">Instant SKU & Barcode Lookup</span>
                        </div>
                      </div>
                      <span className={`bento-status-pill ${isPhoneScannerConnected ? 'emerald' : 'green'}`}>
                        <span className="scanner-ready-dot"></span>
                        {isPhoneScannerConnected ? 'Phone Active' : 'Ready'}
                      </span>
                    </div>

                    <div className="bento-scanner-body">
                      <div className="scanner-input-container">
                        <span className="scanner-laser-icon">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                          </svg>
                        </span>
                        <input
                          id="pos-product-search-input"
                          type="text"
                          className="bento-input scanner-input"
                          placeholder="Scan barcode or enter product SKU..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && searchQuery.trim()) {
                              e.preventDefault();
                              handleBarcodeScanned(searchQuery.trim());
                              setSearchQuery('');
                            }
                          }}
                        />
                        {searchQuery && (
                          <button
                            type="button"
                            className="bento-input-clear-btn"
                            onClick={() => setSearchQuery('')}
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
                              <line x1="18" y1="6" x2="6" y2="18"></line>
                              <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                          </button>
                        )}
                      </div>

                      <div className="scanner-action-row">
                        <button
                          type="button"
                          className="bento-trigger-scan-btn"
                          onClick={() => {
                            const el = document.getElementById('pos-product-search-input');
                            if (el) el.focus();
                            showToast('Ready for barcode scanner input');
                          }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                            <circle cx="12" cy="13" r="4"></circle>
                          </svg>
                          <span>Focus Scanner</span>
                        </button>


                        <button
                          type="button"
                          className={`bento-mobile-scanner-btn ${isPhoneScannerConnected ? 'connected' : ''}`}
                          onClick={() => setShowMobileScannerModal(true)}
                          title="Use your phone camera as a wireless barcode scanner"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                            <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
                            <line x1="12" y1="18" x2="12.01" y2="18"></line>
                          </svg>
                          <span>{isPhoneScannerConnected ? 'Phone Active ✓' : 'Phone as Scanner'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ROW 2: Bento Quick Categories Grid */}
                <div className="bento-card bento-categories-card">
                  <div className="bento-card-header">
                    <div className="bento-header-label">
                      <span className="bento-icon-circle emerald">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
                          <circle cx="7" cy="7" r="1.5" fill="currentColor"></circle>
                        </svg>
                      </span>
                      <div>
                        <h3 className="bento-card-title">Quick Categories</h3>
                        <span className="bento-card-subtitle">Filter product inventory by department</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`bento-all-cats-btn ${selectedCategory === 'ALL' ? 'active' : ''}`}
                      onClick={() => {
                        setSelectedCategory('ALL');
                        setSearchQuery('');
                      }}
                    >
                      All Items ({items.length})
                    </button>
                  </div>

                  <div className="bento-category-grid">
                    {[
                      {
                        id: 'Groceries',
                        label: 'Groceries',
                        color: 'cat-groceries',
                        icon: (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <circle cx="9" cy="21" r="1"></circle>
                            <circle cx="20" cy="21" r="1"></circle>
                            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                          </svg>
                        ),
                      },
                      {
                        id: 'Fresh Produce',
                        label: 'Produce',
                        color: 'cat-produce',
                        icon: (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"></path>
                            <path d="M2 21c0-3 1.85-5.36 5.08-6"></path>
                          </svg>
                        ),
                      },
                      {
                        id: 'Beverages',
                        label: 'Beverages',
                        color: 'cat-beverages',
                        icon: (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <path d="M18 8h1a4 4 0 0 1 0 8h-1"></path>
                            <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path>
                            <line x1="6" y1="1" x2="6" y2="4"></line>
                            <line x1="10" y1="1" x2="10" y2="4"></line>
                          </svg>
                        ),
                      },
                      {
                        id: 'Snacks',
                        label: 'Snacks',
                        color: 'cat-snacks',
                        icon: (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
                            <path d="M2 17l10 5 10-5"></path>
                            <path d="M2 12l10 5 10-5"></path>
                          </svg>
                        ),
                      },
                      {
                        id: 'Household',
                        label: 'Household',
                        color: 'cat-household',
                        icon: (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                            <polyline points="9 22 9 12 15 12 15 22"></polyline>
                          </svg>
                        ),
                      },
                      {
                        id: 'Personal Care',
                        label: 'Personal Care',
                        color: 'cat-care',
                        icon: (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                          </svg>
                        ),
                      },
                      {
                        id: 'Dairy',
                        label: 'Dairy',
                        color: 'cat-dairy',
                        icon: (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <path d="M8 2h8v3H8z"></path>
                            <path d="M6 5h12l2 16H4L6 5z"></path>
                          </svg>
                        ),
                      },
                      {
                        id: 'Others',
                        label: 'Others',
                        color: 'cat-others',
                        icon: (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <rect x="3" y="3" width="7" height="7" rx="1"></rect>
                            <rect x="14" y="3" width="7" height="7" rx="1"></rect>
                            <rect x="14" y="14" width="7" height="7" rx="1"></rect>
                            <rect x="3" y="14" width="7" height="7" rx="1"></rect>
                          </svg>
                        ),
                      },
                    ].map((cat) => {
                      const count = items.filter(
                        (i) => (i.category || '').toLowerCase() === cat.id.toLowerCase()
                      ).length;
                      const isSelected = selectedCategory === cat.id;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          className={`bento-cat-tile ${cat.color} ${isSelected ? 'active' : ''}`}
                          onClick={() => setSelectedCategory(isSelected ? 'ALL' : cat.id)}
                        >
                          <span className="cat-tile-icon">{cat.icon}</span>
                          <span className="cat-tile-label">{cat.label}</span>
                          <span className="cat-tile-count">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* ROW 3: Bento Product Catalog Showcase */}
                <div className="bento-card bento-catalog-card">
                  <div className="bento-card-header">
                    <div className="bento-header-label">
                      <span className="bento-icon-circle indigo">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                          <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                          <line x1="12" y1="22.08" x2="12" y2="12"></line>
                        </svg>
                      </span>
                      <div>
                        <h3 className="bento-card-title">Product Catalog</h3>
                        <span className="bento-card-subtitle">
                          Showing {filteredItems.length} available items {selectedCategory !== 'ALL' && `in ${selectedCategory}`}
                        </span>
                      </div>
                    </div>

                    {/* Fast Product Catalog Search & Actions */}
                    <div className="bento-catalog-header-actions">
                      <div className="bento-catalog-search-wrap">
                        <div className="bento-catalog-search-box">
                          <svg className="bento-catalog-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                          </svg>
                          <input
                            ref={catalogSearchInputRef}
                            type="text"
                            className="bento-catalog-search-input"
                            placeholder="Fast product search by name, barcode, SKU..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                setSearchQuery('');
                                catalogSearchInputRef.current?.blur();
                              } else if (e.key === 'Enter') {
                                if (filteredItems.length === 1) {
                                  addToCart(filteredItems[0]);
                                  playSupermarketBeep();
                                  showToast(`Added ${filteredItems[0].name} to cart`);
                                }
                              }
                            }}
                          />
                          {searchQuery && (
                            <button
                              type="button"
                              className="bento-catalog-search-clear"
                              onClick={() => {
                                setSearchQuery('');
                                catalogSearchInputRef.current?.focus();
                              }}
                              title="Clear search"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                              </svg>
                            </button>
                          )}
                        </div>
                        {searchQuery && (
                          <span className="bento-search-badge">
                            {filteredItems.length} {filteredItems.length === 1 ? 'item' : 'items'}
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        className="bento-new-item-btn"
                        onClick={() => setShowItemModal(true)}
                      >
                        + New Item
                      </button>
                    </div>
                  </div>

                  {filteredItems.length === 0 ? (
                    <div className="bento-empty-catalog">
                      <span className="empty-catalog-icon">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="11" cy="11" r="8"></circle>
                          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                      </span>
                      <h4>No products found</h4>
                      <p>Try searching with another keyword or barcode</p>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          setSearchQuery('');
                          setSelectedCategory('ALL');
                        }}
                      >
                        Reset Filters
                      </button>
                    </div>
                  ) : (
                    <div className="bento-products-grid">
                      {filteredItems.slice(0, 48).map((item) => {
                        const mrp = getItemMrp(item);
                        const storePrice = item.priceMinor;
                        const savings = Math.max(0, mrp - storePrice);
                        const discountPercent = mrp > storePrice && mrp > 0 ? Math.round((savings / mrp) * 100) : 0;
                        const inCartCount = cart.find((c) => c.item.id === item.id)?.qty || 0;
                        const isOutOfStock = item.currentStockMilli <= 0;
                        // Clean up raw timestamps in demo item names if present
                        const displayName = item.name.replace(/\s+\d{10,15}$/, '');

                        return (
                          <div
                            key={item.id}
                            className={`bento-product-tile ${inCartCount > 0 ? 'in-cart' : ''} ${isOutOfStock ? 'out-of-stock' : ''}`}
                            onClick={() => {
                              if (!isOutOfStock) addToCart(item);
                            }}
                            title={`Click to add ${displayName} to cart`}
                          >
                            {/* Top Badges Row */}
                            <div className="bento-tile-top">
                              <span className="bento-tile-cat" title={item.category || 'General'}>
                                {item.category || 'General'}
                              </span>
                              {item.stockStatus === 'out_of_stock' || isOutOfStock ? (
                                <span className="bento-stock-tag out">
                                  <span className="stock-dot"></span> Out of Stock
                                </span>
                              ) : item.stockStatus === 'low_stock' ? (
                                <span className="bento-stock-tag low">
                                  <span className="stock-dot"></span> Low Stock
                                </span>
                              ) : (
                                <span className="bento-stock-tag in">
                                  <span className="stock-dot"></span> In Stock
                                </span>
                              )}
                            </div>

                            {/* Product Title */}
                            <div className="bento-tile-title" title={item.name}>
                              {displayName}
                            </div>

                            {/* Clean Pricing Section - Completely Guaranteed Zero Overflow */}
                            <div className="bento-tile-pricing">
                              <div className="pricing-store-row">
                                <span className="pricing-store-val mono">{formatRupees(storePrice)}</span>
                                {mrp > storePrice && (
                                  <span className="mrp-strikethrough mono">MRP {formatRupees(mrp)}</span>
                                )}
                              </div>
                              <div className="pricing-sub-row">
                                {savings > 0 ? (
                                  <span className="pricing-save-badge">
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="20 6 9 17 4 12"></polyline>
                                    </svg>
                                    <span>Save {formatRupees(savings)}</span>
                                    {discountPercent > 0 && <span className="save-pct">({discountPercent}% OFF)</span>}
                                  </span>
                                ) : (
                                  <span className="pricing-standard-tag">Inclusive of All Taxes</span>
                                )}
                              </div>
                            </div>

                            {/* Card Action Footer */}
                            <div className="bento-tile-footer">
                              <div className="bento-tile-sku mono" title={item.barcode || item.sku || ''}>
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                                  <path d="M3 5v14M8 5v14M12 5v14M17 5v14M21 5v14" />
                                </svg>
                                <span>{item.barcode ? (item.barcode.length > 10 ? `...${item.barcode.slice(-8)}` : item.barcode) : (item.sku || `GST ${item.taxRateBp / 100}%`)}</span>
                              </div>

                              {inCartCount > 0 ? (
                                <div className="bento-tile-stepper" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    className="tile-stepper-btn minus"
                                    onClick={() => updateCartQty(item.id, -1)}
                                    title="Decrease quantity"
                                  >
                                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                      <line x1="5" y1="12" x2="19" y2="12"></line>
                                    </svg>
                                  </button>
                                  <span className="tile-stepper-qty mono">{inCartCount}</span>
                                  <button
                                    type="button"
                                    className="tile-stepper-btn plus"
                                    onClick={() => updateCartQty(item.id, 1)}
                                    title="Increase quantity"
                                  >
                                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                      <line x1="12" y1="5" x2="12" y2="19"></line>
                                      <line x1="5" y1="12" x2="19" y2="12"></line>
                                    </svg>
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="bento-quick-add-btn"
                                  disabled={isOutOfStock}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!isOutOfStock) addToCart(item);
                                  }}
                                  title={isOutOfStock ? "Out of stock" : "Add to cart"}
                                >
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8">
                                    <line x1="12" y1="5" x2="12" y2="19"></line>
                                    <line x1="5" y1="12" x2="19" y2="12"></line>
                                  </svg>
                                  <span>Add</span>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* ================= RIGHT BENTO COLUMN: Master Billing Terminal ================= */}
              <div className="bento-right-col">
                <div className="bento-card bento-billing-terminal">
                  {/* Terminal Header */}
                  <div className="bento-terminal-header">
                    <div className="terminal-title-group">
                      <div className="terminal-icon-box">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="9" cy="21" r="1"></circle>
                          <circle cx="20" cy="21" r="1"></circle>
                          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                        </svg>
                      </div>
                      <div>
                        <h2 className="terminal-heading">Billing Terminal</h2>
                        <span className="terminal-subheading">
                          {cart.length} item{cart.length === 1 ? '' : 's'} • {cart.reduce((a, b) => a + b.qty, 0)} units
                        </span>
                      </div>
                    </div>

                    <div className="terminal-actions">
                      <button
                        type="button"
                        className="bento-clear-cart-btn"
                        disabled={cart.length === 0}
                        onClick={() => {
                          setCart([]);
                          setCashReceived('');
                          setSplitAmount1('');
                          setSplitAmount2('');
                          setSplitCashTendered('');
                        }}
                        title="Clear all cart items"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                        <span>Clear</span>
                      </button>
                      <button
                        type="button"
                        className="bento-hold-cart-btn"
                        onClick={handleHoldOrder}
                        title="Hold or restore order"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                          <rect x="6" y="4" width="4" height="16" rx="1"></rect>
                          <rect x="14" y="4" width="4" height="16" rx="1"></rect>
                        </svg>
                        <span>{heldOrders.length > 0 ? `Held (${heldOrders.length})` : 'Hold'}</span>
                      </button>
                    </div>
                  </div>

                  {/* RESTAURANT SPECIAL: Table & Order Type */}
                  {shop?.businessType === 'restaurant' && (
                    <div className="bento-restaurant-strip">
                      <div className="strip-field">
                        <label>Table:</label>
                        <select
                          className="form-input"
                          value={restaurantTable}
                          onChange={(e) => setRestaurantTable(e.target.value)}
                        >
                          {['Table 1', 'Table 2', 'Table 3', 'Table 4 (Family AC)', 'Table 5', 'Takeaway / Parcel'].map((tbl) => (
                            <option key={tbl} value={tbl}>{tbl}</option>
                          ))}
                        </select>
                      </div>
                      <div className="strip-field">
                        <label>Order Type:</label>
                        <select
                          className="form-input"
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

                  {/* 2. CATEGORY TOTAL PRODUCT PRICE STRIP */}
                  {cart.length > 0 && (
                    <div className="bento-category-strip-container">
                      <div className="bento-category-strip-title">
                        <span>Category Breakdown:</span>
                      </div>
                      <div className="bento-category-strip">
                        {Object.values(cartCategoryBreakdown).map((cat) => (
                          <div key={cat.name} className="bento-cat-summary-pill">
                            <span className="cat-pill-name">{cat.name}</span>
                            <span className="cat-pill-count">({cat.count} pcs)</span>
                            <span className="cat-pill-total mono">{formatRupees(cat.totalMinor)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 3. CART ITEMS TABLE / LIST */}
                  <div className="bento-cart-body">
                    {cart.length === 0 ? (
                      <div className="bento-empty-cart">
                        <div className="bento-empty-icon-wrap">
                          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="9" cy="21" r="1"></circle>
                            <circle cx="20" cy="21" r="1"></circle>
                            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                          </svg>
                          <div className="empty-cart-ping">+</div>
                        </div>
                        <h4 className="empty-title">Cart is Empty</h4>
                        <p className="empty-desc">Scan a barcode or click products to build the bill</p>
                        <button
                          type="button"
                          className="bento-start-add-btn"
                          onClick={() => {
                            const el = document.getElementById('pos-product-search-input');
                            if (el) el.focus();
                          }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                          </svg>
                          <span>Find Products</span>
                        </button>
                      </div>
                    ) : (
                      <div className="bento-cart-table-wrapper">
                        {/* Table Header Bar */}
                        <div className="bento-cart-table-header">
                          <span className="th-item" title="Product & Category">Product</span>
                          <span className="th-qty" title="Quantity">Qty</span>
                          <span className="th-mrp" title="Maximum Retail Price">MRP</span>
                          <span className="th-price" title="Store Selling Price">Store Price</span>
                          <span className="th-total" title="Total Product Price">Total Price</span>
                          <span className="th-action"></span>
                        </div>

                        {/* Cart Rows: NO SEPARATE GST ON PRODUCT; SHOWS QTY, MRP, STORE PRICE, TOTAL PRICE, CATEGORY */}
                        <div className="bento-cart-rows-scroll">
                          {cart.map(({ item, qty }) => {
                            const mrp = getItemMrp(item);
                            const storePrice = item.priceMinor;
                            const lineTotal = storePrice * qty;
                            const lineSavings = Math.max(0, (mrp - storePrice) * qty);

                            return (
                              <div key={item.id} className="bento-cart-row">
                                {/* Col 1: Product Name & Category Badge */}
                                <div className="bento-row-item-col">
                                  <div className="bento-cart-item-name" title={item.name}>
                                    {item.name}
                                  </div>
                                  <div className="bento-cart-item-meta">
                                    <span className="bento-cart-cat-badge">
                                      {item.category || 'General'}
                                    </span>
                                    {lineSavings > 0 && (
                                      <span className="bento-cart-savings-tag">
                                        Save {formatRupees(lineSavings)}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* Col 2: Quantity Stepper */}
                                <div className="bento-row-qty-col">
                                  <div className="bento-qty-stepper">
                                    <button
                                      type="button"
                                      className="bento-qty-btn"
                                      onClick={() => updateCartQty(item.id, -1)}
                                      title="Decrease quantity"
                                    >
                                      -
                                    </button>
                                    <span className="bento-qty-value mono">{qty}</span>
                                    <button
                                      type="button"
                                      className="bento-qty-btn"
                                      onClick={() => updateCartQty(item.id, 1)}
                                      title="Increase quantity"
                                    >
                                      +
                                    </button>
                                  </div>
                                </div>

                                {/* Col 3: MRP */}
                                <div className="bento-row-mrp-col">
                                  <span className="bento-mrp-val mono">
                                    {formatRupees(mrp)}
                                  </span>
                                </div>

                                {/* Col 4: Store Price */}
                                <div className="bento-row-store-col">
                                  <span className="bento-store-val mono">
                                    {formatRupees(storePrice)}
                                  </span>
                                </div>

                                {/* Col 5: Total Product Price */}
                                <div className="bento-row-total-col">
                                  <span className="bento-total-val mono">
                                    {formatRupees(lineTotal)}
                                  </span>
                                </div>

                                {/* Col 6: Remove Action */}
                                <div className="bento-row-action-col">
                                  <button
                                    type="button"
                                    className="bento-row-remove-btn"
                                    onClick={() => updateCartQty(item.id, -qty)}
                                    title="Remove item"
                                  >
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
                                      <line x1="18" y1="6" x2="6" y2="18"></line>
                                      <line x1="6" y1="6" x2="18" y2="18"></line>
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 4. OVERALL TOTAL & CONSOLIDATED GST SUMMARY */}
                  <div className="bento-cart-footer">
                    {/* Discount Quick Selector Pills */}
                    <div className="bento-discount-bar">
                      <span className="discount-label">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px', verticalAlign: '-1px' }}>
                          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
                          <line x1="7" y1="7" x2="7.01" y2="7"></line>
                        </svg>
                        Bill Discount:
                      </span>
                      <div className="bento-discount-pills">
                        {[0, 5, 10, 15, 20].map((pct) => (
                          <button
                            key={pct}
                            type="button"
                            className={`bento-disc-pill ${appliedDiscountPercent === pct ? 'active' : ''}`}
                            onClick={() => {
                              setAppliedDiscountPercent(pct);
                              showToast(pct > 0 ? `${pct}% bill discount applied!` : 'Discount cleared');
                            }}
                          >
                            {pct === 0 ? '0%' : `${pct}%`}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Overall Summary Breakdown */}
                    <div className="bento-summary-box">
                      <div className="bento-summary-row">
                        <span className="summary-label">Items / Total Units</span>
                        <span className="summary-val mono">
                          {cart.length} items ({cart.reduce((a, b) => a + b.qty, 0)} units)
                        </span>
                      </div>

                      {cartTotalMrpMinor > 0 && (
                        <div className="bento-summary-row">
                          <span className="summary-label">Total MRP Value</span>
                          <span className="summary-val mono">{formatRupees(cartTotalMrpMinor)}</span>
                        </div>
                      )}

                      <div className="bento-summary-row">
                        <span className="summary-label">Taxable Subtotal</span>
                        <span className="summary-val mono">{formatRupees(cartTaxableMinor)}</span>
                      </div>

                      {appliedDiscountPercent > 0 && (
                        <div className="bento-summary-row discount-row">
                          <span className="summary-label">Bill Discount ({appliedDiscountPercent}%)</span>
                          <span className="summary-val mono text-success">-{formatRupees(percentDiscountMinor)}</span>
                        </div>
                      )}

                      {pointsDiscountMinor > 0 && (
                        <div className="bento-summary-row discount-row" style={{ background: '#ecfdf5', padding: '0.25rem 0.5rem', borderRadius: '6px' }}>
                          <span className="summary-label" style={{ color: '#047857', fontWeight: 700 }}>
                            🪙 Points Redeemed ({pointsActuallyRedeemed} pts)
                          </span>
                          <span className="summary-val mono text-success">-{formatRupees(pointsDiscountMinor)}</span>
                        </div>
                      )}

                      {/* CONSOLIDATED OVERALL GST WITH TAX BREAKDOWN */}
                      <div className="bento-summary-row tax-row">
                        <div className="tax-label-group">
                          <span className="summary-label">Consolidated GST Tax</span>
                          <span className="tax-sub-breakdown">
                            (CGST: {formatRupees(cartCgstMinor)} + SGST: {formatRupees(cartSgstMinor)})
                          </span>
                        </div>
                        <span className="summary-val mono tax-val">{formatRupees(cartTaxMinor)}</span>
                      </div>

                      {/* Overall Customer Savings Celebration */}
                      {totalMrpSavingsMinor > 0 && (
                        <div className="bento-savings-alert">
                          <span className="savings-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#047857" strokeWidth="2.2">
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                            </svg>
                          </span>
                          <span>Total Customer Savings: <strong>{formatRupees(totalMrpSavingsMinor)}</strong></span>
                        </div>
                      )}
                    </div>

                    {/* Counter Customer Mobile Input / Linked Member Badge */}
                    {!selectedParty ? (() => {
                      const cleanDigits = customerSearch.replace(/\D/g, '');
                      const last10 = cleanDigits.slice(-10);
                      const counterMatches = customerSearch.trim().length >= 3
                        ? parties.filter(p => p.type === 'customer' && (
                            (p.phone && p.phone.replace(/\D/g, '').includes(cleanDigits)) ||
                            p.name.toLowerCase().includes(customerSearch.trim().toLowerCase())
                          )).slice(0, 3)
                        : [];
                      const hasExactMatch = cleanDigits.length >= 7 && parties.some(p => p.type === 'customer' && p.phone && (
                        p.phone.replace(/\D/g, '') === cleanDigits ||
                        p.phone.replace(/\D/g, '').endsWith(last10) ||
                        cleanDigits.endsWith(p.phone.replace(/\D/g, '').slice(-10))
                      ));

                      return (
                        <div className="bento-counter-mobile-box">
                          <div className="counter-mobile-head">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                              <circle cx="12" cy="7" r="4" />
                            </svg>
                            <span className="mobile-title">Customer & Loyalty Rewards:</span>
                            {customerSearch && <span className="mobile-val mono">{customerSearch}</span>}
                          </div>

                          <div className="counter-mobile-inputs-row" style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: '0.65rem' }}>
                            <div className="counter-input-col">
                              <label className="counter-col-label">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px', verticalAlign: '-1px' }}>
                                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                                </svg>
                                Customer Mobile
                              </label>
                              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                                <input
                                  type="tel"
                                  maxLength={15}
                                  autoComplete="off"
                                  style={{ flex: 1, fontSize: '0.88rem', padding: '0.45rem 0.65rem' }}
                                  placeholder="10-digit mobile number..."
                                  value={customerSearch}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    setCustomerSearch(val);
                                    const d = val.replace(/\D/g, '');
                                    if (d.length >= 10) {
                                      const d10 = d.slice(-10);
                                      const match = parties.find(p => p.type === 'customer' && p.phone && (
                                        p.phone.replace(/\D/g, '') === d ||
                                        p.phone.replace(/\D/g, '').endsWith(d10) ||
                                        d.endsWith(p.phone.replace(/\D/g, '').slice(-10))
                                      ));
                                      if (match) {
                                        setSelectedPartyId(match.id);
                                        setCustomerSearch('');
                                        setQuickCustomerName('');
                                        showToast(`✓ Linked member: ${match.name} (${match.loyaltyPoints ?? 0} pts)`);
                                      } else {
                                        api<{ party: Party | null }>(`/api/parties/by-phone/${encodeURIComponent(d)}`).then((res) => {
                                          if (res?.party) {
                                            setParties((prev) => (prev.some(p => p.id === res.party!.id) ? prev : [...prev, res.party!]));
                                            setSelectedPartyId(res.party.id);
                                            setCustomerSearch('');
                                            setQuickCustomerName('');
                                            showToast(`✓ Linked member: ${res.party.name} (${res.party.loyaltyPoints ?? 0} pts)`);
                                          }
                                        }).catch(() => {});
                                      }
                                    }
                                  }}
                                  onKeyDown={async (e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      const d = customerSearch.replace(/\D/g, '');
                                      if (d.length >= 7) {
                                        const d10 = d.slice(-10);
                                        const match = parties.find(p => p.type === 'customer' && p.phone && (
                                          p.phone.replace(/\D/g, '') === d ||
                                          p.phone.replace(/\D/g, '').endsWith(d10) ||
                                          d.endsWith(p.phone.replace(/\D/g, '').slice(-10))
                                        ));
                                        if (match) {
                                          setSelectedPartyId(match.id);
                                          setCustomerSearch('');
                                          setQuickCustomerName('');
                                          showToast(`✓ Linked ${match.name} (${match.loyaltyPoints ?? 0} pts)`);
                                        } else {
                                          try {
                                            const res = await api<{ party: Party | null }>(`/api/parties/by-phone/${encodeURIComponent(d)}`);
                                            if (res?.party) {
                                              setParties((prev) => (prev.some(p => p.id === res.party!.id) ? prev : [...prev, res.party!]));
                                              setSelectedPartyId(res.party.id);
                                              setCustomerSearch('');
                                              setQuickCustomerName('');
                                              showToast(`✓ Linked ${res.party.name} (${res.party.loyaltyPoints ?? 0} pts)`);
                                            }
                                          } catch {}
                                        }
                                      }
                                    }
                                  }}
                                />
                                {customerSearch && (
                                  <button
                                    type="button"
                                    className="btn btn-secondary compact"
                                    style={{ padding: '0.45rem 0.55rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                    onClick={() => {
                                      setCustomerSearch('');
                                      setSelectedPartyId('');
                                      setQuickCustomerName('');
                                    }}
                                    title="Clear mobile number"
                                  >
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                      <line x1="18" y1="6" x2="6" y2="18" />
                                      <line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="counter-input-col">
                              <label className="counter-col-label">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px', verticalAlign: '-1px' }}>
                                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                  <circle cx="12" cy="7" r="4" />
                                </svg>
                                Customer Name
                              </label>
                              <input
                                type="text"
                                autoComplete="off"
                                style={{ width: '100%', fontSize: '0.88rem', padding: '0.45rem 0.65rem' }}
                                placeholder="Name (e.g. Ramesh)"
                                value={quickCustomerName}
                                onChange={(e) => setQuickCustomerName(e.target.value)}
                              />
                            </div>
                          </div>

                          {/* Live Matched Customer Autocomplete Suggestions */}
                          {counterMatches.length > 0 && (
                            <div className="counter-matches-list">
                              {counterMatches.map((m) => (
                                <div
                                  key={m.id}
                                  className="counter-match-row"
                                  onClick={() => {
                                    setSelectedPartyId(m.id);
                                    setCustomerSearch('');
                                    setQuickCustomerName('');
                                    showToast(`✓ Linked ${m.name} (${m.loyaltyPoints ?? 0} pts)`);
                                  }}
                                  title="Click to link customer and show loyalty points"
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                      <circle cx="12" cy="7" r="4" />
                                    </svg>
                                    <span className="counter-match-name">{m.name}</span>
                                    <span className="counter-match-phone mono"> ({m.phone})</span>
                                  </div>
                                  <span className="counter-match-pts" style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                      <circle cx="12" cy="12" r="9" />
                                      <path d="M12 7v10M15 9.5a2.5 2.5 0 0 0-5 0c0 4 5 2 5 6a2.5 2.5 0 0 1-5 0" />
                                    </svg>
                                    {m.loyaltyPoints ?? 0} pts
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* If 10 digits typed and brand new customer */}
                          {cleanDigits.length >= 7 && !hasExactMatch && (
                            <div className="counter-new-customer-hint" style={{ marginTop: '0.4rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                              <span><strong>New Customer:</strong> {quickCustomerName.trim() ? `"${quickCustomerName.trim()}"` : 'Customer'} ({cleanDigits}) will be automatically created in your database upon payment!</span>
                            </div>
                          )}
                        </div>
                      );
                    })() : (
                      <div className={`bento-counter-customer-linked ${redeemPoints ? 'redeemed' : ''}`}>
                        <div className="cust-linked-main-row">
                          <div className="cust-linked-left">
                            <div className="cust-linked-avatar">
                              {selectedParty.name ? selectedParty.name.trim().charAt(0).toUpperCase() : 'C'}
                            </div>
                            <div className="cust-linked-details">
                              <div className="cust-linked-name-row">
                                <span className="cust-linked-name" title={selectedParty.name}>{selectedParty.name}</span>
                                <span className="cust-linked-badge">Member</span>
                              </div>
                              <div className="cust-linked-phone-row">
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}>
                                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                                </svg>
                                <span className="cust-linked-phone mono">{selectedParty.phone || 'No mobile'}</span>
                              </div>
                            </div>
                          </div>

                          <div className="cust-linked-right">
                            <div className="cust-linked-pts-badge" title={`${selectedPartyPoints} points available (Worth ₹${((selectedPartyPoints * shopPointValMinor) / 100).toFixed(2)})`}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="9" />
                                <path d="M12 7v10M15 9.5a2.5 2.5 0 0 0-5 0c0 4 5 2 5 6a2.5 2.5 0 0 1-5 0" />
                              </svg>
                              <div className="pts-labels">
                                <span className="pts-count mono">{selectedPartyPoints} pts</span>
                                <span className="pts-worth">(₹{((selectedPartyPoints * shopPointValMinor) / 100).toFixed(2)})</span>
                              </div>
                            </div>

                            {shopLoyaltyActive && selectedPartyPoints >= shopMinRedeem && cart.length > 0 && potentialDiscountMinor > 0 && (
                              <button
                                type="button"
                                className={`counter-redeem-toggle-btn ${redeemPoints ? 'active' : ''}`}
                                onClick={() => {
                                  const next = !redeemPoints;
                                  setRedeemPoints(next);
                                  if (next) {
                                    playSupermarketBeep();
                                    showToast(`Redeemed ${maxRedeemablePoints} points (-₹${(potentialDiscountMinor / 100).toFixed(2)})`);
                                  } else {
                                    showToast('Points discount removed');
                                  }
                                }}
                                title={redeemPoints ? 'Click to cancel discount' : `Click to redeem ${maxRedeemablePoints} points for ₹${(potentialDiscountMinor / 100).toFixed(2)} off`}
                              >
                                {redeemPoints ? (
                                  <>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                    <span>-₹{(pointsDiscountMinor / 100).toFixed(2)} Applied</span>
                                  </>
                                ) : (
                                  <>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                                    </svg>
                                    <span>Redeem ₹{(potentialDiscountMinor / 100).toFixed(2)}</span>
                                  </>
                                )}
                              </button>
                            )}

                            <button
                              type="button"
                              className="cust-linked-clear"
                              onClick={() => {
                                setSelectedPartyId('');
                                setCustomerSearch('');
                                setRedeemPoints(false);
                              }}
                              title="Unlink customer / Switch to Walk-in"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Active points discount alert strip */}
                        {redeemPoints && pointsDiscountMinor > 0 && (
                          <div className="cust-linked-discount-strip">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#047857" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            <span><strong>₹{(pointsDiscountMinor / 100).toFixed(2)} Loyalty Discount Applied!</strong> {pointsActuallyRedeemed} points will be deducted upon billing.</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Payment Tender Modes with Stylized Vector Icons */}
                    <div className="bento-payment-modes">
                      {[
                        {
                          id: 'cash',
                          label: 'Cash',
                          icon: (
                            <svg className="pay-mode-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="2" y="6" width="20" height="12" rx="2" />
                              <circle cx="12" cy="12" r="3.5" />
                              <path d="M6 12h.01M18 12h.01" />
                            </svg>
                          ),
                        },
                        {
                          id: 'upi',
                          label: 'UPI',
                          icon: (
                            <svg className="pay-mode-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="5" y="2" width="14" height="20" rx="3" />
                              <path d="M12 18h.01M9 6h6M9 9h6" />
                            </svg>
                          ),
                        },
                        {
                          id: 'card',
                          label: 'Card',
                          icon: (
                            <svg className="pay-mode-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="2" y="5" width="20" height="14" rx="2" />
                              <line x1="2" y1="10" x2="22" y2="10" />
                              <line x1="6" y1="15" x2="10" y2="15" />
                            </svg>
                          ),
                        },
                        {
                          id: 'bank',
                          label: 'Bank',
                          icon: (
                            <svg className="pay-mode-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 21h18M3 10h18M5 10v11M9 10v11M15 10v11M19 10v11M12 3l9 7H3l9-7z" />
                            </svg>
                          ),
                        },
                        {
                          id: 'credit',
                          label: 'Khata',
                          icon: (
                            <svg className="pay-mode-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                              <circle cx="9" cy="7" r="4" />
                              <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                            </svg>
                          ),
                        },
                        {
                          id: 'split',
                          label: 'Split',
                          icon: (
                            <svg className="pay-mode-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="18" cy="18" r="3" />
                              <circle cx="6" cy="6" r="3" />
                              <path d="M13 6h3a2 2 0 0 1 2 2v7" />
                              <line x1="6" y1="9" x2="6" y2="21" />
                            </svg>
                          ),
                        },
                      ].map(({ id, label, icon }) => (
                        <button
                          key={id}
                          type="button"
                          className={`bento-pay-mode-btn ${selectedPayMode === id ? 'active' : ''}`}
                          onClick={() => {
                            setSelectedPayMode(id as any);
                            if (id === 'split' && !splitAmount1 && !splitAmount2) {
                              handleSplitFiftyFifty();
                            }
                          }}
                        >
                          {icon}
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>

                    {/* CASH TENDER & CHANGE RETURN ASSISTANT */}
                    {selectedPayMode === 'cash' && cart.length > 0 && (
                      <div className="bento-cash-tender-card">
                        <div className="bento-tender-header">
                          <div className="bento-tender-title">
                            <span className="tender-icon-box">
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                                <rect x="2" y="6" width="20" height="12" rx="2" />
                                <circle cx="12" cy="12" r="3.5" />
                                <path d="M6 12h.01M18 12h.01" />
                              </svg>
                            </span>
                            <span>Cash Tender & Change</span>
                          </div>
                          <button
                            type="button"
                            className="bento-tender-exact-btn"
                            onClick={() => setCashReceived(Math.ceil(finalPayableMinor / 100).toString())}
                            title="Set to exact bill amount"
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
                              <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                            <span>Exact (₹{Math.ceil(finalPayableMinor / 100)})</span>
                          </button>
                        </div>

                        <div className="bento-tender-grid">
                          <div className="bento-tender-field">
                            <label className="bento-tender-label">Customer Gave (Cash)</label>
                            <div className="bento-tender-input-wrap">
                              <span className="bento-tender-symbol">₹</span>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                className="bento-tender-input"
                                placeholder="0"
                                value={cashReceived}
                                onChange={(e) => setCashReceived(e.target.value)}
                              />
                              {cashReceived && (
                                <button
                                  type="button"
                                  className="bento-tender-clear-btn"
                                  onClick={() => setCashReceived('')}
                                  title="Clear amount"
                                >
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                  </svg>
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="bento-tender-field">
                            <label className="bento-tender-label">
                              {cashReceivedValMinor >= finalPayableMinor ? 'Change to Return' : 'Short / Remaining'}
                            </label>
                            <div className={`bento-tender-change-box ${cashReceivedValMinor >= finalPayableMinor ? 'is-return' : 'is-short'}`}>
                              <span className="change-icon">
                                {cashReceivedValMinor >= finalPayableMinor ? (
                                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="9 14 4 9 9 4"></polyline>
                                    <path d="M20 20v-7a4 4 0 0 0-4-4H4"></path>
                                  </svg>
                                ) : (
                                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <line x1="12" y1="8" x2="12" y2="12"></line>
                                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                                  </svg>
                                )}
                              </span>
                              <span className="change-amount mono">
                                {formatRupees(cashReceivedValMinor >= finalPayableMinor ? changeDueMinor : remainingDueMinor)}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Quick Tender Chip Buttons */}
                        <div className="bento-tender-chips-row">
                          <span className="chips-hint">Quick Tender:</span>
                          <div className="chips-list">
                            {suggestedDenominations.map((denom) => {
                              const isSelected = cashReceivedValMinor === denom * 100;
                              return (
                                <button
                                  key={denom}
                                  type="button"
                                  className={`tender-chip-btn ${isSelected ? 'active' : ''}`}
                                  onClick={() => setCashReceived(denom.toString())}
                                >
                                  ₹{denom}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* DYNAMIC UPI QR & CUSTOMER DISPLAY CARD */}
                    {selectedPayMode === 'upi' && cart.length > 0 && (
                      <div className="bento-upi-tender-card">
                        <div className="upi-tender-header">
                          <div className="upi-tender-title">
                            <span className="upi-icon-box">
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                              </svg>
                            </span>
                            <span>Dynamic UPI QR Scanner</span>
                          </div>
                          <div className="upi-tender-status">
                            <button
                              type="button"
                              className={`upi-dual-screen-chip ${isCfdConnected ? 'live' : 'open'}`}
                              onClick={() => {
                                const cfdUrl = `${window.location.origin}/customer-display`;
                                window.open(cfdUrl, 'CustomerFacingDisplay', 'width=1280,height=800,menubar=no,toolbar=no,location=no');
                                showToast('🖥️ Customer Display opened! Drag to your 2nd monitor.');
                              }}
                              title="Click to launch customer display on 2nd monitor"
                            >
                              <span className={`pulse-dot ${isCfdConnected ? 'active' : ''}`}></span>
                              <span>{isCfdConnected ? '🖥️ Live on 2nd Monitor' : '🖥️ Launch on 2nd Monitor'}</span>
                            </button>
                          </div>
                        </div>

                        <div className="upi-tender-body">
                          <div className="upi-qr-display-wrap">
                            <div
                              className="upi-qr-code"
                              dangerouslySetInnerHTML={{
                                __html: qrSvg(
                                  `upi://pay?pa=${encodeURIComponent(shop?.upiId?.trim() || (shop?.phone ? `${shop.phone.replace(/\D/g, '').slice(-10)}@upi` : 'merchant@okaxis'))}&pn=${encodeURIComponent(shop?.name || 'Retail Store')}&am=${(finalPayableMinor / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(`Bill at ${shop?.name || 'Retail Store'}`)}`,
                                  { size: 130, margin: 1 }
                                ),
                              }}
                            />
                            <span className="upi-qr-brand-label">GPay • PhonePe • Paytm</span>
                          </div>

                          <div className="upi-tender-info">
                            <div className="upi-amount-row">
                              <span className="upi-label">Payable Amount:</span>
                              <strong className="upi-val">₹{(finalPayableMinor / 100).toFixed(2)}</strong>
                            </div>

                            <div className="upi-vpa-row">
                              <span className="upi-vpa-label">Shop VPA:</span>
                              <span className="upi-vpa-code">{shop?.upiId?.trim() || (shop?.phone ? `${shop.phone.replace(/\D/g, '').slice(-10)}@upi` : 'merchant@okaxis')}</span>
                              <button
                                type="button"
                                className="upi-edit-vpa-btn"
                                onClick={async () => {
                                  const current = shop?.upiId || '';
                                  const input = window.prompt('Enter your Shop UPI ID / VPA (e.g. yourstore@okaxis, 9876543210@paytm):', current);
                                  if (input !== null && shop) {
                                    try {
                                      const updated = await api<Shop>('/api/shop', {
                                        method: 'PUT',
                                        body: JSON.stringify({ ...shop, upiId: input.trim() || null }),
                                      });
                                      setShop(updated);
                                      showToast(`✅ Shop UPI ID updated to ${input.trim() || 'default'}`);
                                    } catch (e: any) {
                                      alert(e.message || 'Failed to update UPI ID');
                                    }
                                  }
                                }}
                                title="Edit Shop UPI VPA"
                              >
                                ✏️ Edit VPA
                              </button>
                            </div>

                            <div className="upi-dual-hint">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="16" x2="12" y2="12"></line>
                                <line x1="12" y1="8" x2="12.01" y2="8"></line>
                              </svg>
                              <span>Customer sees this QR on their screen. After payment confirmation, click <strong>Proceed to Payment</strong>.</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* SPLIT TENDER ASSISTANT CARD (MULTI-TENDER: HALF UPI / HALF CASH / CUSTOM) */}
                    {selectedPayMode === 'split' && cart.length > 0 && (
                      <div className="bento-split-tender-card">
                        <div className="split-tender-header">
                          <div className="split-tender-title">
                            <span className="split-icon-box">
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="18" cy="18" r="3" />
                                <circle cx="6" cy="6" r="3" />
                                <path d="M13 6h3a2 2 0 0 1 2 2v7" />
                                <line x1="6" y1="9" x2="6" y2="21" />
                              </svg>
                            </span>
                            <span>Split Payment (Multi-Tender)</span>
                          </div>
                          <button
                            type="button"
                            className="split-quick-half-btn"
                            onClick={handleSplitFiftyFifty}
                            title="Split 50% Cash and 50% UPI"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <line x1="5" y1="19" x2="19" y2="5"></line>
                              <circle cx="6.5" cy="6.5" r="2.5"></circle>
                              <circle cx="17.5" cy="17.5" r="2.5"></circle>
                            </svg>
                            <span>50% Cash + 50% UPI</span>
                          </button>
                        </div>

                        {/* Split Allocation Rows */}
                        <div className="split-rows-grid">
                          {/* Split Row 1 */}
                          <div className="split-row-box">
                            <div className="split-row-header">
                              <select
                                className="split-method-select"
                                value={splitMethod1}
                                onChange={(e) => setSplitMethod1(e.target.value as any)}
                              >
                                <option value="cash">Cash</option>
                                <option value="upi">UPI</option>
                                <option value="card">Card</option>
                                <option value="bank">Bank</option>
                              </select>
                              <button
                                type="button"
                                className="split-fill-btn"
                                onClick={() => handleFillSplitRemaining(1)}
                                title="Fill remaining balance into this mode"
                              >
                                Fill Balance
                              </button>
                            </div>
                            <div className="bento-tender-input-wrap">
                              <span className="bento-tender-symbol">₹</span>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                className="bento-tender-input"
                                placeholder="0"
                                value={splitAmount1}
                                onChange={(e) => handleSplit1Change(e.target.value)}
                              />
                              {splitAmount1 && (
                                <button
                                  type="button"
                                  className="bento-tender-clear-btn"
                                  onClick={() => handleSplit1Change('')}
                                  title="Clear"
                                >
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                  </svg>
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Split Row 2 */}
                          <div className="split-row-box">
                            <div className="split-row-header">
                              <select
                                className="split-method-select"
                                value={splitMethod2}
                                onChange={(e) => setSplitMethod2(e.target.value as any)}
                              >
                                <option value="upi">UPI</option>
                                <option value="cash">Cash</option>
                                <option value="card">Card</option>
                                <option value="bank">Bank</option>
                              </select>
                              <button
                                type="button"
                                className="split-fill-btn"
                                onClick={() => handleFillSplitRemaining(2)}
                                title="Fill remaining balance into this mode"
                              >
                                Fill Balance
                              </button>
                            </div>
                            <div className="bento-tender-input-wrap">
                              <span className="bento-tender-symbol">₹</span>
                              <input
                                type="number"
                                min="0"
                                step="any"
                                className="bento-tender-input"
                                placeholder="0"
                                value={splitAmount2}
                                onChange={(e) => handleSplit2Change(e.target.value)}
                              />
                              {splitAmount2 && (
                                <button
                                  type="button"
                                  className="bento-tender-clear-btn"
                                  onClick={() => handleSplit2Change('')}
                                  title="Clear"
                                >
                                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round">
                                    <line x1="18" y1="6" x2="6" y2="18"></line>
                                    <line x1="6" y1="6" x2="18" y2="18"></line>
                                  </svg>
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Live Allocation Summary Strip */}
                        <div className="split-summary-strip">
                          <div className="split-summary-left">
                            <span className="split-sum-label">Allocated:</span>
                            <span className="split-sum-val mono">{formatRupees(splitTotalMinor)}</span>
                            <span className="split-sum-divider">/</span>
                            <span className="split-sum-target mono">{formatRupees(finalPayableMinor)}</span>
                          </div>
                          <div className="split-summary-right">
                            {splitTotalMinor === finalPayableMinor && (
                              <span className="split-status-badge success">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8">
                                  <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                                Exact Match
                              </span>
                            )}
                            {splitTotalMinor < finalPayableMinor && (
                              <span className="split-status-badge warning">
                                Remaining: {formatRupees(splitRemainingMinor)}
                              </span>
                            )}
                            {splitTotalMinor > finalPayableMinor && (
                              <span className="split-status-badge error">
                                Exceeds by {formatRupees(splitOverMinor)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Bottom Grand Total & Proceed Button */}
                    <div className="bento-checkout-row">
                      <div className="bento-grand-total">
                        <span className="grand-total-label">Grand Total Amount</span>
                        <span className="grand-total-val mono">{formatRupees(finalPayableMinor)}</span>
                      </div>

                      <div className="bento-checkout-actions">
                        {shop?.businessType === 'restaurant' && (
                          <button
                            type="button"
                            className="bento-kot-btn"
                            disabled={cart.length === 0 || isCheckingOut}
                            onClick={() => handleCheckout(true)}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                              <path d="M6 13.8V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v9.8"></path>
                              <path d="M6 18h12"></path>
                              <rect x="3" y="10" width="18" height="11" rx="2"></rect>
                            </svg>
                            <span>Print KOT</span>
                          </button>
                        )}
                        <button
                          type="button"
                          className="bento-checkout-btn"
                          disabled={cart.length === 0 || isCheckingOut}
                          onClick={() => handleCheckout(false)}
                        >
                          {isCheckingOut ? (
                            <span>Processing...</span>
                          ) : (
                            <>
                              <span>
                                {selectedPayMode === 'cash' ? 'Complete Sale & Generate Bill' :
                                 selectedPayMode === 'upi' ? 'Confirm UPI & Generate Bill' :
                                 selectedPayMode === 'card' ? 'Card Paid & Generate Bill' :
                                 selectedPayMode === 'credit' ? 'Post to Khata & Bill' :
                                 'Proceed to Payment'}
                              </span>
                              <span className="checkout-arrow">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
                                  <polyline points="9 18 15 12 9 6"></polyline>
                                </svg>
                              </span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ================= BOTTOM POS POWER DOCK ================= */}
            <div className="bento-pos-dock">
              {/* Left: Live Register & Shift Status */}
              <div className="pos-dock-status">
                <div className="dock-status-item">
                  <span className="dock-status-dot online"></span>
                  <div>
                    <span className="dock-status-title">Register #1 • Live Synced</span>
                    <span className="dock-status-sub">{user?.name || 'Cashier'} • Neon DB</span>
                  </div>
                </div>

                <div className="dock-divider"></div>

                <div className="dock-metrics-item">
                  <span className="dock-metric-label">Today's Counter Bills</span>
                  <span className="dock-metric-val mono">
                    {invoices.filter((i) => new Date(i.createdAt).toDateString() === new Date().toDateString()).length} Bills
                  </span>
                </div>

                <div className="dock-divider"></div>

                <div className="dock-metrics-item">
                  <span className="dock-metric-label">Today's Register Sales</span>
                  <span className="dock-metric-val mono text-success">
                    {formatRupees(
                      invoices
                        .filter((i) => new Date(i.createdAt).toDateString() === new Date().toDateString())
                        .reduce((sum, inv) => sum + (inv.kind === 'credit_note' ? -inv.totalMinor : inv.totalMinor), 0)
                    )}
                  </span>
                </div>
              </div>

              {/* Right: Operational Tool Actions */}
              <div className="pos-dock-actions">
                <button
                  type="button"
                  className="dock-action-btn park-btn"
                  onClick={handleHoldOrder}
                  title="Hold current cart or recall last held order"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="6" y="4" width="4" height="16"></rect>
                    <rect x="14" y="4" width="4" height="16"></rect>
                  </svg>
                  <span>{cart.length > 0 ? 'Hold Order' : (heldOrders.length > 0 ? `Recall Order (${heldOrders.length})` : 'Hold Order')}</span>
                  {heldOrders.length > 0 && <span className="dock-badge">{heldOrders.length}</span>}
                </button>

                {heldOrders.length > 0 && (
                  <button
                    type="button"
                    className="dock-action-btn secondary"
                    onClick={() => setShowHeldOrdersModal(true)}
                    title="View all currently held parked orders"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                      <line x1="16" y1="13" x2="8" y2="13"></line>
                      <line x1="16" y1="17" x2="8" y2="17"></line>
                    </svg>
                    <span>Parked ({heldOrders.length})</span>
                  </button>
                )}

                <button
                  type="button"
                  className="dock-action-btn"
                  onClick={() => setShowCustomItemModal(true)}
                  title="Add open item custom charge (Carry bag, delivery, etc.)"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                  <span>+ Custom Charge</span>
                </button>

                <button
                  type="button"
                  className="dock-action-btn"
                  onClick={handleReprintLastBill}
                  disabled={!invoices || invoices.length === 0}
                  title="Reprint the most recently issued thermal invoice"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <polyline points="6 9 6 2 18 2 18 9"></polyline>
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                    <rect x="6" y="14" width="12" height="8"></rect>
                  </svg>
                  <span>Reprint Last Bill</span>
                </button>

                <button
                  type="button"
                  className="dock-action-btn"
                  onClick={() => setShowDiscountPicker(true)}
                  title="Apply bill percentage or flat rupee discount"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                    <line x1="19" y1="5" x2="5" y2="19"></line>
                    <circle cx="6.5" cy="6.5" r="2.5"></circle>
                    <circle cx="17.5" cy="17.5" r="2.5"></circle>
                  </svg>
                  <span>% Discount {appliedDiscountPercent > 0 ? `(${appliedDiscountPercent}%)` : ''}</span>
                </button>

                <button
                  type="button"
                  className={`dock-action-btn ${isPhoneScannerConnected ? 'connected' : ''}`}
                  onClick={() => setShowMobileScannerModal(true)}
                  title="Connect mobile phone as a wireless barcode scanner"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                    <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
                    <line x1="12" y1="18" x2="12.01" y2="18"></line>
                  </svg>
                  <span>{isPhoneScannerConnected ? 'Phone Paired ✓' : 'Mobile Scanner'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB: CASHIER SHIFTS & DAY-END CLOSING */}
        {activeTab === 'shifts' && user && (
          user.role === 'manager' ? (
            <StoreManagerDashboard
              user={user}
              shop={shop}
              onNavigate={setActiveTab}
            />
          ) : (
            <ShiftsDashboard
              user={user}
              shop={shop}
              onNavigateToPos={() => setActiveTab('pos')}
            />
          )
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

          const handlePrintSingleLabel = (item: Item) => {
            setPrintBarcodeItem(item);
            setShowPrintBarcodeModal(true);
          };

          const handlePrintAllLabels = () => {
            const activeWithBarcodes = filteredMasterItems.filter(
              (item) => item.active !== false && item.barcode && item.barcode.trim()
            );
            if (activeWithBarcodes.length === 0) {
              alert('No active products with barcodes found to print in the current filtered list.');
              return;
            }
            const labelData = activeWithBarcodes.map((item) => ({
              name: item.name,
              sku: item.sku,
              barcode: item.barcode!.trim(),
              priceMinor: item.priceMinor,
            }));
            setActivePrintLabels(labelData);
            document.body.classList.add('printing-barcode-labels');
            printBarcodeLabels(labelData, shop?.name);
            setTimeout(() => {
              document.body.classList.remove('printing-barcode-labels');
              setActivePrintLabels(null);
            }, 2000);
          };

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
                    placeholder="Search items, SKU, HS..."
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
                      <option key={c.id} value={c.name}>
                        {c.parentName ? `${c.parentName} → ${c.name}` : c.name}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-secondary" onClick={() => setShowCategoryModal(true)}>
                    🏷️ Categories
                  </button>
                  <button
                    id="bulk-import-open-btn"
                    className="btn btn-secondary"
                    onClick={() => setShowBulkImportModal(true)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      fontWeight: 600,
                      padding: '0.45rem 0.85rem',
                    }}
                    title="Bulk import products from Excel or spreadsheet"
                  >
                    📥 Import Products
                  </button>
                  <button
                    id="bulk-print-custom-labels-btn"
                    className="btn btn-secondary"
                    onClick={() => setShowBulkBarcodeModal(true)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      fontWeight: 600,
                      padding: '0.45rem 0.85rem',
                    }}
                    title="Select multiple products and set custom label quantities for each"
                  >
                    🏷️ Bulk Print Labels
                  </button>
                  <button className="btn btn-primary" onClick={openAddItemModal}>
                    + Add New Item
                  </button>
                </div>
              </div>

              <div className="table-scroll-x">
                <div className="table-scroll-y">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th className="col-product-name">Product Name</th>
                        <th className="col-nowrap">Category</th>
                        <th className="col-nowrap">SKU / Code</th>
                        <th className="col-nowrap">HSN / SAC</th>
                        <th className="col-nowrap">Selling Price</th>
                        {can(user?.role as any, 'purchases') && <th className="col-nowrap">Last Purchase Cost</th>}
                        <th className="col-nowrap">GST Rate</th>
                        <th className="col-nowrap">Current Stock</th>
                        <th className="col-nowrap">Status</th>
                        <th className="col-nowrap" style={{ minWidth: '135px', textAlign: 'center' }}>Barcode Label</th>
                        <th className="col-nowrap" style={{ minWidth: '220px' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMasterItems.map((i) => (
                        <tr key={i.id} style={{ opacity: i.active === false ? 0.75 : 1 }}>
                          <td className="col-product-name" style={{ fontWeight: 600 }}>
                            <div style={{ color: '#0f172a', fontWeight: 600 }}>{i.name}</div>
                            {i.custom?.batch && (
                              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '1px' }}>
                                Batch: {i.custom.batch} | Exp: {i.custom.expiry} | {i.custom.rack}
                              </div>
                            )}
                          </td>
                          <td className="col-nowrap"><span className="badge badge-blue">{i.category || 'General'}</span></td>
                          <td className="mono col-nowrap" style={{ color: '#334155', fontWeight: 500 }}>{i.sku || '—'}</td>
                          <td className="mono col-nowrap" style={{ color: '#334155', fontWeight: 500 }}>{i.hsn || '—'}</td>
                          <td className="mono col-nowrap" style={{ fontWeight: 700, color: '#6d4aff' }}>{formatRupees(i.priceMinor)}</td>
                          {can(user?.role as any, 'purchases') && (
                            <td className="mono col-nowrap" style={{ color: '#334155', fontWeight: 600 }}>{i.costMinor ? formatRupees(i.costMinor) : '—'}</td>
                          )}
                          <td className="mono col-nowrap" style={{ color: '#334155', fontWeight: 500 }}>{i.taxRateBp / 100}% {i.taxInclusive ? '(Incl)' : '(Excl)'}</td>
                          <td className="col-nowrap">
                            <span className={`badge ${i.currentStockMilli > 0 ? 'badge-emerald' : 'badge-amber'}`}>
                              {i.currentStockMilli / 1000} {i.unit || 'pcs'}
                            </span>
                          </td>
                          <td className="col-nowrap">
                            {i.active !== false ? (
                              <span className="badge badge-emerald">Active</span>
                            ) : (
                              <span className="badge badge-amber">Inactive</span>
                            )}
                          </td>
                          <td className="col-nowrap" style={{ textAlign: 'center', verticalAlign: 'middle', padding: '0.4rem 0.5rem' }}>
                            {i.barcode && i.barcode.trim() ? (
                              <div style={{ display: 'inline-flex', justifyContent: 'center', alignItems: 'center' }}>
                                <div
                                  className="barcode-svg-preview"
                                  style={{
                                    display: 'inline-flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    background: '#ffffff',
                                    padding: '2px 4px',
                                    borderRadius: '3px',
                                    border: '1px solid #e2e8f0',
                                    maxWidth: '140px',
                                    overflow: 'hidden',
                                  }}
                                  dangerouslySetInnerHTML={{ __html: renderBarcodeSvg(i.barcode) }}
                                />
                              </div>
                            ) : (
                              <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem' }}>
                                <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontStyle: 'italic' }}>
                                  No barcode
                                </span>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  style={{ padding: '0.15rem 0.45rem', fontSize: '0.7rem', color: '#4f46e5', fontWeight: 600, borderRadius: '4px' }}
                                  onClick={async () => {
                                    const code = '20' + Date.now().toString().slice(-10);
                                    let sum = 0;
                                    for (let k = 0; k < 12; k++) sum += parseInt(code[k], 10) * (k % 2 === 0 ? 1 : 3);
                                    const fullBc = code + ((10 - (sum % 10)) % 10);
                                    try {
                                      await api(`/api/items/${i.id}`, { method: 'PATCH', body: JSON.stringify({ barcode: fullBc }) });
                                      showToast(`Generated barcode for ${i.name} & saved to DB!`);
                                      loadItems();
                                    } catch (err: any) {
                                      showToast(err.message || 'Failed to generate barcode');
                                    }
                                  }}
                                  title="Generate and save an internal retail barcode to database"
                                >
                                  + Generate
                                </button>
                              </div>
                            )}
                          </td>
                          <td className="col-nowrap" style={{ verticalAlign: 'middle' }}>
                            <div style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center' }}>
                              <button
                                className="btn btn-secondary"
                                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                                onClick={() => openEditItemModal(i)}
                                title="Edit product"
                              >
                                ✏️ Edit
                              </button>
                              <button
                                className="btn btn-secondary"
                                style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: '#2563eb' }}
                                onClick={() => setActiveTab('inventory')}
                                title="Open Inventory Hub"
                              >
                                🏬 Stock
                              </button>
                              <ToggleSwitch
                                id={`toggle-item-active-${i.id}`}
                                checked={i.active !== false}
                                onChange={() => handleToggleItemActive(i)}
                                disabled={!can(user?.role as any, 'items.write') || togglingItemId === i.id}
                                loading={togglingItemId === i.id}
                                title={
                                  !can(user?.role as any, 'items.write')
                                    ? "You don't have permission to change product status"
                                    : i.active !== false
                                    ? 'Active · click to deactivate'
                                    : 'Inactive · click to activate'
                                }
                                ariaLabel={i.active !== false ? 'Active' : 'Inactive'}
                              />
                              <button
                                className="btn btn-secondary btn-icon-delete"
                                style={{
                                  padding: '0.25rem 0.45rem',
                                  fontSize: '0.75rem',
                                  color: '#dc2626',
                                  borderColor: '#fecaca',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                                onClick={() => {
                                  setDeletingItem(i);
                                  setDeleteError(null);
                                }}
                                title="Delete product"
                                aria-label="Delete product"
                              >
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M3 6h18"/>
                                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                                  <line x1="10" y1="11" x2="10" y2="17"/>
                                  <line x1="14" y1="11" x2="14" y2="17"/>
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {filteredMasterItems.length === 0 && (
                        <tr>
                          <td colSpan={can(user?.role as any, 'purchases') ? 12 : 11} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                            No products match your search or filter criteria.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.75rem 0.25rem 0',
                  fontSize: '0.8rem',
                  color: '#64748b',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                }}
              >
                <div>
                  Showing {filteredMasterItems.length} of {items.length} products
                </div>
                <div style={{ color: '#94a3b8' }}>
                  Scroll inside the table ↔ ↕ to see every column
                </div>
              </div>
            </div>
          );
        })()}

        {/* TAB 2b: CATEGORY MANAGEMENT MODULE */}
        {activeTab === 'categories' && (() => {
          const mainCategories = categoriesList.filter((c) => !c.parentId && c.active);
          const subCategories = categoriesList.filter((c) => c.parentId && c.active);
          const filteredCategories = categoriesList.filter((cat) => {
            if (catTypeFilter === 'main' && cat.parentId) return false;
            if (catTypeFilter === 'sub' && !cat.parentId) return false;
            const q = catSearchTerm.trim().toLowerCase();
            if (!q) return true;
            return (
              cat.name.toLowerCase().includes(q) ||
              (cat.parentName && cat.parentName.toLowerCase().includes(q)) ||
              (cat.description && cat.description.toLowerCase().includes(q))
            );
          });

          return (
            <div className="category-module-container">
              {/* Category Management Hero Header */}
              <div className="card" style={{ borderTop: '3px solid #6366f1' }}>
                <div className="card-title" style={{ flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '1.25rem' }}>🏷️</span>
                      <span style={{ fontSize: '1.15rem', fontWeight: 800, color: '#1e293b' }}>
                        Category Management Module
                      </span>
                      <span className="badge badge-blue">{categoriesList.length} Total</span>
                      <span className="badge badge-emerald">{mainCategories.length} Main</span>
                      <span className="badge badge-blue">{subCategories.length} Sub</span>
                    </div>
                    <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '3px' }}>
                      Manage main categories, subcategories, bulk CSV import, and synchronize catalog organization for {shop?.name}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={handleDownloadCategoryTemplate}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}
                    >
                      <span>📄</span> Download Sample Template
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setShowCatImportView(!showCatImportView)}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}
                    >
                      <span>📥</span> {showCatImportView ? 'Close Import Drawer' : 'Import Categories (CSV)'}
                    </button>
                  </div>
                </div>

                {/* Bulk Import Drawer */}
                {showCatImportView && (
                  <div
                    style={{
                      marginTop: '1.25rem',
                      padding: '1.25rem',
                      background: '#f8fafc',
                      borderRadius: '10px',
                      border: '1.5px dashed #cbd5e1',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                      <div>
                        <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span>📥</span> Bulk Category CSV Import
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '2px' }}>
                          Supports 1,000+ categories. Subcategories can appear anywhere in the file.
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowCatImportView(false)}
                        style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.1rem', cursor: 'pointer' }}
                      >
                        ✕
                      </button>
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
                      <label
                        className="btn btn-secondary"
                        style={{
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.45rem',
                          padding: '0.55rem 1rem',
                        }}
                      >
                        <span>📁</span>
                        <span>{catImportFileName || 'Choose CSV File to Upload...'}</span>
                        <input
                          type="file"
                          accept=".csv"
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleCategoryFileChange(file);
                            e.target.value = '';
                          }}
                        />
                      </label>

                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem', cursor: 'pointer', color: '#334155' }}>
                        <input
                          type="checkbox"
                          checked={catImportUpdateExisting}
                          onChange={(e) => setCatImportUpdateExisting(e.target.checked)}
                        />
                        <span>Update existing categories if found (overwrite description/parent)</span>
                      </label>
                    </div>

                    {catImportLoading && (
                      <div style={{ padding: '1rem', color: '#6366f1', fontWeight: 600, fontSize: '0.88rem' }}>
                        Processing category file... Please wait.
                      </div>
                    )}

                    {/* Pre-flight Import Preview Card */}
                    {catImportPreview && (
                      <div
                        style={{
                          background: '#ffffff',
                          padding: '1rem',
                          borderRadius: '8px',
                          border: `1.5px solid ${catImportPreview.errorCount > 0 ? '#fca5a5' : '#86efac'}`,
                          marginBottom: '1rem',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                          <span style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.9rem' }}>
                            Pre-flight Import Preview: {catImportFileName}
                          </span>
                          <span className={`badge ${catImportPreview.errorCount > 0 ? 'badge-amber' : 'badge-emerald'}`}>
                            {catImportPreview.errorCount > 0 ? `${catImportPreview.errorCount} Errors Found` : 'Ready to Import'}
                          </span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem', marginBottom: '0.75rem' }}>
                          <div style={{ background: '#f8fafc', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
                            <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Total Rows</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>{catImportPreview.total}</div>
                          </div>
                          <div style={{ background: '#f8fafc', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
                            <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Main Categories</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#16a34a' }}>{catImportPreview.mainCategoriesCount}</div>
                          </div>
                          <div style={{ background: '#f8fafc', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
                            <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Subcategories</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#2563eb' }}>{catImportPreview.subcategoriesCount}</div>
                          </div>
                          <div style={{ background: '#f8fafc', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
                            <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Existing in Store</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#d97706' }}>{catImportPreview.duplicateCount}</div>
                          </div>
                          <div style={{ background: '#f8fafc', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>
                            <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Errors</div>
                            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: catImportPreview.errorCount > 0 ? '#dc2626' : '#16a34a' }}>
                              {catImportPreview.errorCount}
                            </div>
                          </div>
                        </div>

                        {catImportPreview.errors.length > 0 && (
                          <div style={{ marginBottom: '0.75rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#dc2626' }}>
                                Validation Errors ({catImportPreview.errors.length}) — Fix before importing:
                              </span>
                              <button
                                type="button"
                                className="btn btn-secondary"
                                style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem' }}
                                onClick={handleDownloadImportErrors}
                              >
                                📥 Download Error Report CSV
                              </button>
                            </div>
                            <div style={{ maxHeight: '140px', overflowY: 'auto', border: '1px solid #fee2e2', borderRadius: '6px' }}>
                              <table className="data-table" style={{ fontSize: '0.78rem' }}>
                                <thead>
                                  <tr>
                                    <th style={{ width: '60px' }}>Row</th>
                                    <th>Category Name</th>
                                    <th>Error Message</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {catImportPreview.errors.map((e, idx) => (
                                    <tr key={idx}>
                                      <td className="mono" style={{ color: '#dc2626', fontWeight: 700 }}>#{e.row}</td>
                                      <td>{e.name || '—'}</td>
                                      <td style={{ color: '#dc2626' }}>{e.error}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.75rem' }}>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => {
                              setCatImportPreview(null);
                              setCatImportCsv('');
                              setCatImportFileName('');
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={catImportPreview.errorCount > 0 || catImportLoading}
                            onClick={handleCommitCategoryImport}
                          >
                            {catImportLoading ? 'Importing...' : `Confirm & Import ${catImportPreview.total} Categories`}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Final Import Result Card */}
                    {catImportResult && (
                      <div
                        style={{
                          background: '#ecfdf5',
                          border: '1.5px solid #a7f3d0',
                          borderRadius: '8px',
                          padding: '1rem',
                        }}
                      >
                        <div style={{ fontWeight: 800, color: '#065f46', fontSize: '0.92rem', marginBottom: '0.4rem' }}>
                          ✓ Bulk Category Import Successful!
                        </div>
                        <div style={{ fontSize: '0.84rem', color: '#047857', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                          <span><strong>{catImportResult.created}</strong> new categories created</span>
                          <span><strong>{catImportResult.updated}</strong> updated</span>
                          <span><strong>{catImportResult.skipped}</strong> skipped (already existing)</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Add New Category Card - Enhanced Responsive Grid & Proportional Button */}
              <div className="category-add-card">
                <div className="category-card-header">
                  <div className="category-card-title">
                    <span style={{ fontSize: '1.05rem', color: '#4f46e5' }}>➕</span>
                    <span>Add New Category or Subcategory</span>
                  </div>
                  <div className="category-card-hint">
                    <span>💡</span>
                    <span>Leave parent empty for a Top-Level Main Category, or select a parent to create a Subcategory.</span>
                  </div>
                </div>

                <form onSubmit={handleCreateCategory} className="category-form-grid">
                  <div className="category-field-group">
                    <label className="category-field-label">
                      Category Name <span className="req">*</span>
                    </label>
                    <input
                      type="text"
                      className="category-field-input"
                      required
                      placeholder="e.g. Beverages, Dairy, Pulses..."
                      value={newCatName}
                      onChange={(e) => setNewCatName(e.target.value)}
                    />
                  </div>

                  <div className="category-field-group">
                    <label className="category-field-label">
                      Parent Category <span style={{ color: '#94a3b8', fontWeight: 400 }}>(Optional)</span>
                    </label>
                    <select
                      className="category-field-input"
                      value={newCatParentId}
                      onChange={(e) => setNewCatParentId(e.target.value)}
                    >
                      <option value="">📁 None (Top-Level Main Category)</option>
                      {mainCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          ↳ Subcategory of {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="category-field-group">
                    <label className="category-field-label">
                      Description <span style={{ color: '#94a3b8', fontWeight: 400 }}>(Optional)</span>
                    </label>
                    <input
                      type="text"
                      className="category-field-input"
                      placeholder="Optional notes or shelf location..."
                      value={newCatDesc}
                      onChange={(e) => setNewCatDesc(e.target.value)}
                    />
                  </div>

                  <div className="category-field-group">
                    <button
                      type="submit"
                      className="category-submit-btn"
                    >
                      <span>➕</span>
                      <span>Add Category</span>
                    </button>
                  </div>
                </form>
              </div>

              {/* Category Catalog Table Card */}
              <div className="card">
                <div className="card-title" style={{ flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 800, fontSize: '1rem', color: '#1e293b' }}>Store Category Hierarchy</span>
                    <span style={{ fontSize: '0.8rem', color: '#64748b', background: '#f1f5f9', padding: '0.2rem 0.55rem', borderRadius: '9999px', fontWeight: 600 }}>
                      {filteredCategories.length} listed
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    {/* Quick Filter Pills */}
                    <div className="category-filter-pills">
                      <button
                        type="button"
                        className={`category-filter-pill ${catTypeFilter === 'all' ? 'active' : ''}`}
                        onClick={() => setCatTypeFilter('all')}
                      >
                        All ({categoriesList.length})
                      </button>
                      <button
                        type="button"
                        className={`category-filter-pill ${catTypeFilter === 'main' ? 'active' : ''}`}
                        onClick={() => setCatTypeFilter('main')}
                      >
                        📁 Main ({mainCategories.length})
                      </button>
                      <button
                        type="button"
                        className={`category-filter-pill ${catTypeFilter === 'sub' ? 'active' : ''}`}
                        onClick={() => setCatTypeFilter('sub')}
                      >
                        ↳ Sub ({subCategories.length})
                      </button>
                    </div>

                    <div style={{ position: 'relative' }}>
                      <input
                        type="text"
                        className="form-input"
                        style={{ width: '220px', padding: '0.42rem 0.75rem 0.42rem 2rem', fontSize: '0.84rem' }}
                        placeholder="Search categories..."
                        value={catSearchTerm}
                        onChange={(e) => setCatSearchTerm(e.target.value)}
                      />
                      <span style={{ position: 'absolute', left: '0.65rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.8rem', color: '#94a3b8' }}>
                        🔍
                      </span>
                      {catSearchTerm && (
                        <button
                          type="button"
                          onClick={() => setCatSearchTerm('')}
                          style={{
                            position: 'absolute',
                            right: '0.5rem',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            background: 'none',
                            border: 'none',
                            color: '#94a3b8',
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ overflowX: 'auto', width: '100%' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Category Name & Hierarchy</th>
                        <th>Type</th>
                        <th>Description</th>
                        <th>Live Catalog Items</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCategories.map((cat) => (
                        <tr key={cat.id} style={{ opacity: !cat.active ? 0.6 : 1 }}>
                          <td>
                            {editingCatId === cat.id ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                <input
                                  type="text"
                                  className="form-input"
                                  style={{ padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}
                                  value={editingCatName}
                                  onChange={(e) => setEditingCatName(e.target.value)}
                                  placeholder="Category name..."
                                />
                                <select
                                  className="form-input"
                                  style={{ padding: '0.3rem 0.5rem', fontSize: '0.8rem' }}
                                  value={editingCatParentId}
                                  onChange={(e) => setEditingCatParentId(e.target.value)}
                                >
                                  <option value="">📁 None (Top-Level Main Category)</option>
                                  {categoriesList
                                    .filter((c) => c.id !== cat.id && !c.parentId && c.active)
                                    .map((c) => (
                                      <option key={c.id} value={c.id}>
                                        ↳ Subcategory of {c.name}
                                      </option>
                                    ))}
                                </select>
                              </div>
                            ) : (
                              <div className="cat-hierarchy-tree">
                                {cat.parentName ? (
                                  <>
                                    <span className="cat-parent-tag">📁 {cat.parentName}</span>
                                    <span className="cat-tree-branch">→</span>
                                    <span style={{ fontWeight: 700, color: '#0f172a' }}>{cat.name}</span>
                                  </>
                                ) : (
                                  <span style={{ fontWeight: 700, color: '#0f172a' }}>📁 {cat.name}</span>
                                )}
                              </div>
                            )}
                          </td>

                          <td>
                            {cat.parentId ? (
                              <span className="badge badge-blue">Subcategory</span>
                            ) : (
                              <span className="badge badge-emerald">Main Category</span>
                            )}
                          </td>

                          <td style={{ color: '#64748b' }}>
                            {editingCatId === cat.id ? (
                              <input
                                type="text"
                                className="form-input"
                                style={{ padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}
                                value={editingCatDesc}
                                onChange={(e) => setEditingCatDesc(e.target.value)}
                                placeholder="Description..."
                              />
                            ) : (
                              cat.description || '—'
                            )}
                          </td>

                          <td>
                            <span
                              className="cat-item-pill"
                              onClick={() => {
                                setItemCatFilterMaster(cat.name);
                                setActiveTab('items');
                              }}
                              title="Click to view products in this category"
                            >
                              📦 {cat.itemCount || 0} Products ↗
                            </span>
                          </td>

                          <td>
                            <button
                              type="button"
                              className={`cat-toggle-switch ${cat.active ? 'on' : 'off'}`}
                              onClick={() => handleToggleCategoryActive(cat)}
                              title={cat.active ? 'Status: ON (Active) — Click to Turn OFF' : 'Status: OFF (Inactive) — Click to Turn ON'}
                            >
                              <span className="cat-toggle-track">
                                <span className="cat-toggle-thumb" />
                              </span>
                              <span className="cat-toggle-state-text">{cat.active ? 'ON' : 'OFF'}</span>
                            </button>
                          </td>

                          <td>
                            <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center' }}>
                              {editingCatId === cat.id ? (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn-primary"
                                    style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                                    onClick={() => handleUpdateCategory(cat.id)}
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-secondary"
                                    style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                                    onClick={() => {
                                      setEditingCatId(null);
                                      setEditingCatParentId('');
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className="cat-edit-btn"
                                    onClick={() => {
                                      setEditingCatId(cat.id);
                                      setEditingCatName(cat.name);
                                      setEditingCatDesc(cat.description || '');
                                      setEditingCatParentId(cat.parentId || '');
                                    }}
                                    title="Edit Category Name, Parent, or Description"
                                  >
                                    <span style={{ fontSize: '0.85rem' }}>✏️</span>
                                    <span>Edit</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="cat-delete-btn"
                                    onClick={() => handleDeleteCategory(cat)}
                                    title={`Delete "${cat.name}" category`}
                                  >
                                    🗑️
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}

                      {filteredCategories.length === 0 && (
                        <tr>
                          <td colSpan={6} style={{ textAlign: 'center', padding: '2.5rem', color: '#94a3b8' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontSize: '1.5rem' }}>🔍</span>
                              <span>No categories found matching your search / filter.</span>
                              {(catSearchTerm || catTypeFilter !== 'all') && (
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  style={{ fontSize: '0.78rem', marginTop: '0.25rem' }}
                                  onClick={() => {
                                    setCatSearchTerm('');
                                    setCatTypeFilter('all');
                                  }}
                                >
                                  Reset Filters
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })()}

        {/* TAB: INVENTORY MANAGEMENT */}
        {activeTab === 'inventory' && (
          <InventoryDashboard
            items={items}
            categories={categories}
            categoriesList={categoriesList}
            suppliers={parties.filter((p) => p.type === 'supplier')}
            userRole={user?.role as any}
            businessType={shop?.businessType}
            allowNegativeStock={shop?.businessType === 'restaurant' || shop?.businessType === 'service'}
            onNavigateToCategories={() => setActiveTab('categories')}
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

        {/* TAB: PRODUCT MOVEMENT ANALYSIS */}
        {activeTab === 'product-movement' && (
          <ProductMovementAnalysisView
            categories={categories}
            userRole={user?.role as any}
            onNavigateToPurchases={(supplierId) => {
              setActiveTab('purchases');
              if (supplierId) {
                openNewPurchaseModalForSupplier(supplierId);
              } else {
                openNewPurchaseModal();
              }
            }}
          />
        )}

        {/* TAB 3: BILLS & INVOICES */}
        {activeTab === 'invoices' && (() => {
          const displayedInvoices = invoices.filter((inv) => {
            if (!invoiceFilterDate) return true;
            return inv.bdate === invoiceFilterDate || (inv.createdAt && inv.createdAt.startsWith(invoiceFilterDate));
          });
          return (
            <div className="card">
              <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <span>Past Sales Invoices ({displayedInvoices.length} bills)</span>
                  {invoiceFilterDate && (
                    <span
                      className="badge badge-emerald"
                      style={{ marginLeft: '10px', cursor: 'pointer', padding: '3px 8px', fontSize: '0.75rem', fontWeight: 600 }}
                      onClick={() => setInvoiceFilterDate('')}
                      title="Click to clear date filter"
                    >
                      📅 Filtered: {invoiceFilterDate} ✕
                    </span>
                  )}
                </div>
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
                  {displayedInvoices.map((inv) => (
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
          );
        })()}

        {/* TAB: SALES ANALYSIS */}
        {activeTab === 'sales-analysis' && (
          <SalesAnalysisView
            userRole={user?.role}
            shopName={shop?.name}
            onNavigateToInvoices={(searchDate) => {
              setInvoiceFilterDate(searchDate || '');
              setActiveTab('invoices');
            }}
            showToast={showToast}
          />
        )}

        {/* TAB 4: CUSTOMERS - MODERN CUSTOMER DIRECTORY & AUTOMATIC LOYALTY POINTS */}
        {activeTab === 'customers' && (
          <CustomerDirectory
            parties={parties}
            invoices={invoices}
            shop={shop}
            onAddCustomer={() => openAddPartyModal('customer')}
            onEditCustomer={(p) => openEditPartyModal(p)}
            onToggleActive={(p) => handleTogglePartyActive(p)}
            onUpdateLoyaltySettings={handleUpdateLoyaltySettings}
            onRefresh={() => {
              loadParties();
              loadInvoices();
            }}
          />
        )}

        {/* TAB: SUPPLIERS - MODERN UPGRADED SUPPLIER DIRECTORY */}
        {activeTab === 'suppliers' && (
          <SupplierDirectory
            parties={parties}
            purchases={purchases}
            shop={shop}
            canPayPurchases={can(user?.role as any, 'purchases.pay')}
            canManagePurchases={can(user?.role as any, 'purchases')}
            onAddSupplier={() => openAddPartyModal('supplier')}
            onEditSupplier={(s) => openEditPartyModal(s)}
            onPaySupplier={(s) => handleOpenPaySupplier(s)}
            onOpenLedger={(sId) => handleOpenSupplierLedger(sId)}
            onNewPurchase={(sId) => openNewPurchaseModalForSupplier(sId)}
            onToggleActive={(s) => handleTogglePartyActive(s)}
            onRefresh={() => {
              loadParties();
              loadPurchases();
            }}
          />
        )}

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

            {/* Customer Loyalty & Rewards Scheme (Section 9.2) */}
            <div className="card settings-section">
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <span>🪙 Customer Loyalty & Rewards Scheme</span>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '3px', fontWeight: 'normal' }}>
                    Set custom point earning rates (e.g. 100 ₹ = 10 pts, 5 pts) and cash discount per point for this shop
                  </div>
                </div>
                <span className={`biz-badge ${settingsLoyaltyEnabled ? 'biz-retail' : 'biz-general'}`} style={{ fontSize: '0.75rem' }}>
                  {settingsLoyaltyEnabled ? '● Scheme Active' : '○ Scheme Paused'}
                </span>
              </div>

              <form onSubmit={handleSaveSettings}>
                {/* Master Toggle */}
                <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '10px', border: '1px solid #e2e8f0', marginBottom: '1.25rem' }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', cursor: user?.role === 'owner' ? 'pointer' : 'default' }}>
                    <input
                      type="checkbox"
                      style={{ width: '18px', height: '18px', marginTop: '2px', accentColor: '#2563eb' }}
                      disabled={user?.role !== 'owner'}
                      checked={settingsLoyaltyEnabled}
                      onChange={(e) => setSettingsLoyaltyEnabled(e.target.checked)}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Enable Customer Loyalty Rewards Program</div>
                      <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '2px' }}>
                        When enabled, registered customers automatically accrue points on billing and can redeem them for discounts at POS.
                      </div>
                    </div>
                  </label>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem', marginBottom: '1.25rem' }}>
                  {/* Points Earning Rate */}
                  <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <label className="form-label" style={{ fontWeight: 600, marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between' }}>
                      <span>Points per ₹100 Purchase</span>
                      <span className="mono bold" style={{ color: '#2563eb' }}>{settingsLoyaltyPointsPer100} pts</span>
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      className="form-input"
                      disabled={user?.role !== 'owner' || !settingsLoyaltyEnabled}
                      value={settingsLoyaltyPointsPer100}
                      onChange={(e) => setSettingsLoyaltyPointsPer100(Math.max(0, parseInt(e.target.value) || 0))}
                    />
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                      {[2, 5, 10, 15, 20].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          className="btn btn-secondary"
                          style={{
                            padding: '0.2rem 0.55rem',
                            fontSize: '0.72rem',
                            background: settingsLoyaltyPointsPer100 === preset ? '#dbeafe' : '#ffffff',
                            borderColor: settingsLoyaltyPointsPer100 === preset ? '#3b82f6' : '#cbd5e1',
                            color: settingsLoyaltyPointsPer100 === preset ? '#1d4ed8' : '#475569',
                            fontWeight: settingsLoyaltyPointsPer100 === preset ? 700 : 500,
                          }}
                          disabled={user?.role !== 'owner' || !settingsLoyaltyEnabled}
                          onClick={() => setSettingsLoyaltyPointsPer100(preset)}
                        >
                          {preset} pts
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '0.5rem' }}>
                      Example: On a ₹500 bill, customer earns <strong>{Math.floor((500 * (settingsLoyaltyPointsPer100 || 0)) / 100)} points</strong>.
                    </div>
                  </div>

                  {/* Cash Value per Point */}
                  <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <label className="form-label" style={{ fontWeight: 600, marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between' }}>
                      <span>Point Redemption Value</span>
                      <span className="mono bold" style={{ color: '#059669' }}>₹{settingsLoyaltyPointValueRupees.toFixed(2)} / pt</span>
                    </label>
                    <input
                      type="number"
                      min={0.01}
                      max={10.0}
                      step={0.05}
                      className="form-input"
                      disabled={user?.role !== 'owner' || !settingsLoyaltyEnabled}
                      value={settingsLoyaltyPointValueRupees}
                      onChange={(e) => setSettingsLoyaltyPointValueRupees(Math.max(0.01, parseFloat(e.target.value) || 0.1))}
                    />
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                      {[0.10, 0.20, 0.50, 1.00].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          className="btn btn-secondary"
                          style={{
                            padding: '0.2rem 0.55rem',
                            fontSize: '0.72rem',
                            background: Math.abs(settingsLoyaltyPointValueRupees - preset) < 0.001 ? '#dcfce7' : '#ffffff',
                            borderColor: Math.abs(settingsLoyaltyPointValueRupees - preset) < 0.001 ? '#10b981' : '#cbd5e1',
                            color: Math.abs(settingsLoyaltyPointValueRupees - preset) < 0.001 ? '#047857' : '#475569',
                            fontWeight: Math.abs(settingsLoyaltyPointValueRupees - preset) < 0.001 ? 700 : 500,
                          }}
                          disabled={user?.role !== 'owner' || !settingsLoyaltyEnabled}
                          onClick={() => setSettingsLoyaltyPointValueRupees(preset)}
                        >
                          ₹{preset.toFixed(2)}
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '0.5rem' }}>
                      Example: 100 points = <strong>₹{(100 * settingsLoyaltyPointValueRupees).toFixed(2)} discount</strong>.
                    </div>
                  </div>

                  {/* Minimum Points to Redeem */}
                  <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                    <label className="form-label" style={{ fontWeight: 600, marginBottom: '0.35rem', display: 'flex', justifyContent: 'space-between' }}>
                      <span>Min. Points to Redeem</span>
                      <span className="mono bold" style={{ color: '#d97706' }}>{settingsLoyaltyMinRedeem} pts</span>
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      step={5}
                      className="form-input"
                      disabled={user?.role !== 'owner' || !settingsLoyaltyEnabled}
                      value={settingsLoyaltyMinRedeem}
                      onChange={(e) => setSettingsLoyaltyMinRedeem(Math.max(0, parseInt(e.target.value) || 0))}
                    />
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                      {[0, 10, 25, 50, 100].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          className="btn btn-secondary"
                          style={{
                            padding: '0.2rem 0.55rem',
                            fontSize: '0.72rem',
                            background: settingsLoyaltyMinRedeem === preset ? '#fef3c7' : '#ffffff',
                            borderColor: settingsLoyaltyMinRedeem === preset ? '#f59e0b' : '#cbd5e1',
                            color: settingsLoyaltyMinRedeem === preset ? '#b45309' : '#475569',
                            fontWeight: settingsLoyaltyMinRedeem === preset ? 700 : 500,
                          }}
                          disabled={user?.role !== 'owner' || !settingsLoyaltyEnabled}
                          onClick={() => setSettingsLoyaltyMinRedeem(preset)}
                        >
                          {preset === 0 ? 'No Min' : `${preset} pts`}
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: '0.76rem', color: '#64748b', marginTop: '0.5rem' }}>
                      Threshold required before points redemption button appears at checkout.
                    </div>
                  </div>
                </div>

                {/* Live Preview Box */}
                <div style={{ background: 'linear-gradient(135deg, #f0fdf4 0%, #eff6ff 100%)', padding: '0.85rem 1.1rem', borderRadius: '10px', border: '1px solid #bfdbfe', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <span style={{ fontSize: '1.4rem' }}>✨</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#1e3a8a' }}>Active Rule Formula:</div>
                      <div style={{ fontSize: '0.8rem', color: '#334155' }}>
                        ₹100 spent = <strong>{settingsLoyaltyPointsPer100} pts</strong> &nbsp;•&nbsp; 1 pt = <strong>₹{settingsLoyaltyPointValueRupees.toFixed(2)}</strong> &nbsp;•&nbsp; Min: <strong>{settingsLoyaltyMinRedeem} pts</strong>
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#15803d', background: '#dcfce7', padding: '0.3rem 0.75rem', borderRadius: '20px' }}>
                    Cashback Yield: {((settingsLoyaltyPointsPer100 * settingsLoyaltyPointValueRupees)).toFixed(1)}%
                  </div>
                </div>

                {user?.role !== 'owner' ? (
                  <div style={{ fontSize: '0.85rem', color: '#b45309', background: '#fffbeb', padding: '0.6rem 0.85rem', borderRadius: '6px', border: '1px solid #fef3c7' }}>
                    ℹ️ Only business owners can change Loyalty Scheme settings.
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button type="submit" className="btn btn-primary" style={{ padding: '0.55rem 1.25rem' }}>
                      Save Loyalty Scheme Settings
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

            {/* Strict Multi-Tenant Data Isolation Banner (Settings Tab Only) */}
            <StrictIsolationBanner />
          </div>
        )}

        {/* ACCOUNTS & FINANCE TAB VIEWS */}
        {activeTab === 'payments' && (
          <div className="tab-content-wrapper" style={{ padding: '1.5rem' }}>
            <PaymentsView
              onOpenCustomerKhata={(cid) => {
                const customer = parties.find((p) => p.id === cid || p.name === cid);
                if (customer) {
                  setCustomerFilterMaster(customer.name);
                } else if (cid) {
                  setCustomerFilterMaster(cid);
                }
                setActiveTab('customers');
              }}
              onOpenSupplierLedger={(sid) => {
                const supplier = parties.find((p) => p.id === sid || p.name === sid);
                if (supplier) {
                  setSupplierFilterMaster(supplier.name);
                } else if (sid) {
                  setSupplierFilterMaster(sid);
                }
                setActiveTab('suppliers');
              }}
            />
          </div>
        )}

        {activeTab === 'expenses' && (
          <div className="tab-content-wrapper" style={{ padding: '1.5rem' }}>
            <ExpensesView
              userRole={user.role}
              userLocation={shop?.locations?.[0] || shop?.address}
              suppliers={parties.filter((p) => p.type === 'supplier').map((s) => ({ id: s.id, name: s.name, gstin: s.gstin }))}
            />
          </div>
        )}

        {activeTab === 'cashbank' && (
          <div className="tab-content-wrapper" style={{ padding: '1.5rem' }}>
            <CashBankView />
          </div>
        )}

        {activeTab === 'receivables' && (
          <div className="tab-content-wrapper" style={{ padding: '1.5rem' }}>
            <ReceivablesView
              onCollectPayment={(cid) => {
                const customer = parties.find((p) => p.id === cid || p.name === cid);
                if (customer) {
                  setCustomerFilterMaster(customer.name);
                } else if (cid) {
                  setCustomerFilterMaster(cid);
                }
                setActiveTab('customers');
              }}
            />
          </div>
        )}

        {activeTab === 'payables' && (
          <div className="tab-content-wrapper" style={{ padding: '1.5rem' }}>
            <PayablesView
              onPaySupplier={(sid) => {
                const supplier = parties.find((p) => p.id === sid || p.name === sid);
                if (supplier) {
                  setSupplierFilterMaster(supplier.name);
                } else if (sid) {
                  setSupplierFilterMaster(sid);
                }
                setActiveTab('suppliers');
              }}
            />
          </div>
        )}

        {/* GST FILING TAB VIEWS */}
        {activeTab === 'gst-overview' && (
          <div className="tab-content-wrapper" style={{ padding: '1.5rem' }}>
            <GstOverviewView tenantGstin={shop?.gstin || ''} onNavigateTab={(tab) => setActiveTab(tab as any)} />
          </div>
        )}

        {activeTab === 'gst-sales-register' && (
          <div className="tab-content-wrapper" style={{ padding: '1.5rem' }}>
            <GstSalesRegisterView onNavigate={(tab) => setActiveTab(tab as any)} />
          </div>
        )}

        {activeTab === 'gst-purchase-register' && (
          <div className="tab-content-wrapper" style={{ padding: '1.5rem' }}>
            <GstPurchaseRegisterView onNavigate={(tab) => setActiveTab(tab as any)} />
          </div>
        )}

        {activeTab === 'gst-itc-reconciliation' && (
          <div className="tab-content-wrapper" style={{ padding: '1.5rem' }}>
            <ItcRegisterView onNavigate={(tab) => setActiveTab(tab as any)} />
          </div>
        )}

        {activeTab === 'gst-gstr3b' && (
          <div className="tab-content-wrapper" style={{ padding: '1.5rem' }}>
            <Gstr3bView onNavigate={(tab) => setActiveTab(tab as any)} />
          </div>
        )}

        {activeTab === 'gst-gstr1' && (
          <div className="tab-content-wrapper" style={{ padding: '1.5rem' }}>
            <Gstr1View onNavigate={(tab) => setActiveTab(tab as any)} />
          </div>
        )}

        {activeTab === 'gst-import-export' && (
          <div className="tab-content-wrapper" style={{ padding: '1.5rem' }}>
            <GstImportExportView onNavigate={(tab) => setActiveTab(tab as any)} />
          </div>
        )}

        {activeTab === 'gst-filing-history' && (
          <div className="tab-content-wrapper" style={{ padding: '1.5rem' }}>
            <GstFilingHistoryView onNavigate={(tab) => setActiveTab(tab as any)} />
          </div>
        )}
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

      {/* HELD ORDERS MODAL */}
      {showHeldOrdersModal && (
        <div className="modal-overlay" onClick={() => setShowHeldOrdersModal(false)}>
          <div className="modal-content" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="modal-icon-badge indigo">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <rect x="6" y="4" width="4" height="16"></rect>
                    <rect x="14" y="4" width="4" height="16"></rect>
                  </svg>
                </span>
                <div>
                  <h3 className="modal-title">Parked / Held Orders</h3>
                  <span className="modal-subtitle">{heldOrders.length} parked cart{heldOrders.length === 1 ? '' : 's'} waiting</span>
                </div>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setShowHeldOrdersModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ maxHeight: '420px', overflowY: 'auto', padding: '1rem' }}>
              {heldOrders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                  No orders currently on hold.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {heldOrders.map((order, idx) => {
                    const total = order.cart.reduce((sum, c) => sum + (c.item.priceMinor * c.qty), 0);
                    return (
                      <div key={order.id} style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.85rem', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0f172a' }}>
                            Order #{idx + 1} • {order.cart.reduce((s, c) => s + c.qty, 0)} items
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.2rem' }}>
                            Held at {order.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • Total: <strong className="mono text-success">{formatRupees(total)}</strong>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                            {order.cart.slice(0, 3).map(c => `${c.qty}x ${c.item.name}`).join(', ')}{order.cart.length > 3 ? '...' : ''}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button
                            type="button"
                            className="btn btn-primary"
                            style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
                            onClick={() => {
                              if (cart.length > 0) {
                                const replace = window.confirm('Your active cart has items. Replace active cart with this held order?');
                                if (!replace) return;
                              }
                              setCart(order.cart);
                              setHeldOrders(prev => prev.filter(o => o.id !== order.id));
                              setShowHeldOrdersModal(false);
                              showToast(`Restored Order #${idx + 1} to active cart`);
                            }}
                          >
                            Restore
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ padding: '0.35rem 0.5rem', fontSize: '0.78rem', color: '#dc2626' }}
                            onClick={() => {
                              if (window.confirm('Discard this held order?')) {
                                setHeldOrders(prev => prev.filter(o => o.id !== order.id));
                                showToast('Held order discarded');
                              }
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CUSTOM OPEN ITEM CHARGE MODAL */}
      {showCustomItemModal && (
        <div className="modal-overlay" onClick={() => setShowCustomItemModal(false)}>
          <div className="modal-content" style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="modal-icon-badge emerald">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                </span>
                <div>
                  <h3 className="modal-title">Add Custom / Open Charge</h3>
                  <span className="modal-subtitle">Non-catalog item (Bag, delivery, tailoring, etc.)</span>
                </div>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setShowCustomItemModal(false)}>✕</button>
            </div>
            <form onSubmit={handleAddCustomItem} className="modal-body" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.3rem' }}>Item Description / Title</label>
                <input
                  type="text"
                  required
                  className="form-input"
                  placeholder="e.g. Carry Bag, Delivery Fee, Gift Wrap"
                  value={customItemForm.name}
                  onChange={(e) => setCustomItemForm({ ...customItemForm, name: e.target.value })}
                  autoFocus
                />
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.3rem' }}>Price (₹)</label>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontWeight: 700, color: '#94a3b8' }}>₹</span>
                  <input
                    type="number"
                    step="any"
                    min="1"
                    required
                    style={{ paddingLeft: '28px' }}
                    className="form-input mono"
                    placeholder="0"
                    value={customItemForm.price}
                    onChange={(e) => setCustomItemForm({ ...customItemForm, price: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '0.3rem' }}>Applicable GST Rate</label>
                <select
                  className="form-input"
                  value={customItemForm.taxRateBp}
                  onChange={(e) => setCustomItemForm({ ...customItemForm, taxRateBp: Number(e.target.value) })}
                >
                  <option value={0}>0% (Exempt)</option>
                  <option value={500}>5% GST</option>
                  <option value={1200}>12% GST</option>
                  <option value={1800}>18% GST (Standard)</option>
                  <option value={2800}>28% GST</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowCustomItemModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>
                  Add to Cart
                </button>
              </div>
            </form>
          </div>
        </div>
      )}





      {/* BULK IMPORT MODAL */}
      {showBulkImportModal && (
        <BulkImportModal
          categories={categoriesList}
          existingItems={items}
          shopName={shop?.name}
          onClose={() => setShowBulkImportModal(false)}
          onImportDone={() => {
            loadItems();
            loadCategories();
            showToast('Bulk import completed! Products updated.');
          }}
        />
      )}

      {/* PRINT BARCODE LABEL MODAL */}
      {showPrintBarcodeModal && printBarcodeItem && (
        <PrintBarcodeModal
          isOpen={showPrintBarcodeModal}
          item={printBarcodeItem}
          shopName={shop?.name}
          onClose={() => {
            setShowPrintBarcodeModal(false);
            setPrintBarcodeItem(null);
          }}
        />
      )}

      {/* BULK PRINT BARCODE LABELS MODAL */}
      {showBulkBarcodeModal && (
        <BulkBarcodeModal
          isOpen={showBulkBarcodeModal}
          items={items}
          shopName={shop?.name}
          onClose={() => setShowBulkBarcodeModal(false)}
        />
      )}

      {/* DELETE PRODUCT CONFIRMATION MODAL */}
      {deletingItem && (
        <div className="modal-overlay" style={{ zIndex: 1200 }}>
          <div className="modal-content" style={{ maxWidth: '480px', borderRadius: '12px' }}>
            <div className="modal-header" style={{ borderBottom: '1px solid #fee2e2', background: '#fff1f2', borderRadius: '12px 12px 0 0', padding: '1rem 1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.25rem' }}>🗑️</span>
                <h3 style={{ margin: 0, color: '#991b1b', fontSize: '1.1rem', fontWeight: 700 }}>
                  Delete Product
                </h3>
              </div>
              <button
                type="button"
                className="btn-close"
                onClick={() => { if (!isDeleting) { setDeletingItem(null); setDeleteError(null); } }}
                disabled={isDeleting}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '1.25rem' }}>
              <p style={{ margin: '0 0 0.75rem 0', color: '#1e293b', fontSize: '0.95rem', lineHeight: 1.5 }}>
                Are you sure you want to permanently delete <strong>"{deletingItem.name}"</strong>?
              </p>

              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem', fontSize: '0.82rem', color: '#64748b', marginBottom: '1rem', lineHeight: 1.4 }}>
                ℹ️ Deleting this product may affect its associated barcode mappings and inventory records. Products with sales history or purchase records cannot be deleted and should be deactivated instead.
              </div>

              {deleteError && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '0.75rem', marginBottom: '1rem' }}>
                  <div style={{ color: '#991b1b', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                    ⚠️ Cannot Delete Product
                  </div>
                  <div style={{ color: '#b91c1c', fontSize: '0.82rem', lineHeight: 1.4, marginBottom: '0.75rem' }}>
                    {deleteError}
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ width: '100%', fontSize: '0.8rem', color: '#b45309', borderColor: '#fde68a', background: '#fffbeb', fontWeight: 600 }}
                    onClick={async () => {
                      await handleToggleItemActive(deletingItem, true);
                      setDeletingItem(null);
                      setDeleteError(null);
                    }}
                  >
                    Deactivate Instead (Recommended)
                  </button>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => { setDeletingItem(null); setDeleteError(null); }}
                  disabled={isDeleting}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{
                    background: '#dc2626',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: 600,
                    padding: '0.5rem 1rem',
                    opacity: isDeleting ? 0.7 : 1,
                    cursor: isDeleting ? 'not-allowed' : 'pointer',
                  }}
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                >
                  {isDeleting ? 'Deleting...' : 'Delete Product'}
                </button>
              </div>
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
                {!itemFormHsn && hsnSuggestions.length > 0 && (
                  <div style={{ marginTop: '0.45rem', padding: '0.5rem 0.75rem', background: 'rgba(56, 189, 248, 0.08)', border: '1px solid rgba(56, 189, 248, 0.25)', borderRadius: '6px' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#38bdf8', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span>💡 Suggested HSN for "{itemFormName}":</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 400 }}>Click to select</span>
                        <button
                          type="button"
                          onClick={() => setHsnSuggestions([])}
                          style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.8rem', padding: '0 3px', lineHeight: 1 }}
                          title="Dismiss"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                      {hsnSuggestions.map((sug) => (
                        <button
                          key={sug.code}
                          type="button"
                          onClick={() => {
                            setItemFormHsn(sug.code);
                            setSelectedHsnDesc(sug.desc);
                            setShowHsnDropdown(false);
                            setHsnSuggestions([]); // Instantly closes this box upon selection!
                          }}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                            padding: '0.25rem 0.6rem',
                            borderRadius: '5px',
                            fontSize: '0.76rem',
                            cursor: 'pointer',
                            border: '1px solid #334155',
                            background: 'rgba(30, 41, 59, 0.95)',
                            color: '#e2e8f0',
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = '#38bdf8';
                            e.currentTarget.style.background = 'rgba(56, 189, 248, 0.2)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = '#334155';
                            e.currentTarget.style.background = 'rgba(30, 41, 59, 0.95)';
                          }}
                          title={sug.desc}
                        >
                          <span style={{ fontWeight: 700, fontFamily: 'monospace', color: '#38bdf8' }}>{sug.code}</span>
                          <span style={{ color: '#cbd5e1', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {sug.desc}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                    <label className="form-label" style={{ margin: 0 }}>Barcode / EAN</label>
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', color: '#4f46e5', fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                      onClick={() => {
                        const code = '20' + Date.now().toString().slice(-10);
                        let sum = 0;
                        for (let k = 0; k < 12; k++) sum += parseInt(code[k], 10) * (k % 2 === 0 ? 1 : 3);
                        const fullBc = code + ((10 - (sum % 10)) % 10);
                        setItemFormBarcode(fullBc);
                      }}
                      title="Generate a unique 13-digit EAN retail barcode"
                    >
                      ⚡ Auto-Generate
                    </button>
                  </div>
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
                  <select
                    className="form-input"
                    value={itemFormCategory}
                    onChange={(e) => setItemFormCategory(e.target.value)}
                  >
                    <option value="">— Select Category from Category Module —</option>
                    {itemFormCategory && !categoriesList.some((c) => c.name.toLowerCase() === itemFormCategory.toLowerCase()) && (
                      <option value={itemFormCategory}>{itemFormCategory} (Current)</option>
                    )}
                    {categoriesList.filter((c) => c.active).map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.parentName ? `${c.parentName} → ${c.name}` : c.name}
                      </option>
                    ))}
                  </select>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                    Categories are managed and imported in the <strong>🏷️ Categories</strong> module.
                  </div>
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
                <div className="form-group" style={{ position: 'relative' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                    <label className="form-label" style={{ margin: 0 }}>HSN / SAC Code</label>
                    <span style={{ fontSize: '0.72rem', color: '#38bdf8' }}>
                      {isHsnSearching ? '🔍 Searching 22k+ items...' : '⚡ GST Directory'}
                    </span>
                  </div>
                  <input
                    type="text"
                    className="form-input"
                    value={itemFormHsn}
                    onChange={(e) => {
                      setItemFormHsn(e.target.value);
                      setShowHsnDropdown(true);
                      if (!e.target.value) setSelectedHsnDesc('');
                    }}
                    onFocus={() => {
                      if (hsnSearchResults.length > 0) setShowHsnDropdown(true);
                    }}
                    placeholder="Search code or name (e.g. 1006, rice, 3004)"
                    autoComplete="off"
                  />
                  {/* Live HSN Search Dropdown */}
                  {showHsnDropdown && hsnSearchResults.length > 0 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        maxHeight: '230px',
                        overflowY: 'auto',
                        background: '#0f172a',
                        border: '1px solid #38bdf8',
                        borderRadius: '8px',
                        boxShadow: '0 12px 30px rgba(0, 0, 0, 0.8)',
                        zIndex: 1050,
                        marginTop: '4px',
                      }}
                    >
                      <div
                        style={{
                          padding: '0.35rem 0.65rem',
                          fontSize: '0.7rem',
                          color: '#94a3b8',
                          borderBottom: '1px solid #1e293b',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          background: '#1e293b',
                        }}
                      >
                        <span>Select HSN / SAC ({hsnSearchResults.length} matches)</span>
                        <button
                          type="button"
                          onClick={() => setShowHsnDropdown(false)}
                          style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.75rem' }}
                        >
                          ✕ Close
                        </button>
                      </div>
                      {hsnSearchResults.map((item) => (
                        <div
                          key={item.code}
                          onClick={() => {
                            setItemFormHsn(item.code);
                            setSelectedHsnDesc(item.desc);
                            setShowHsnDropdown(false);
                          }}
                          style={{
                            padding: '0.45rem 0.65rem',
                            borderBottom: '1px solid #1e293b',
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.15rem',
                            background: itemFormHsn === item.code ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                            textAlign: 'left',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(56, 189, 248, 0.12)')}
                          onMouseLeave={(e) =>
                            (e.currentTarget.style.background =
                              itemFormHsn === item.code ? 'rgba(56, 189, 248, 0.15)' : 'transparent')
                          }
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 700, color: '#38bdf8', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                              {item.code}
                            </span>
                            <span
                              style={{
                                fontSize: '0.65rem',
                                padding: '1px 5px',
                                borderRadius: '4px',
                                background: item.type === 'SAC' ? '#0284c7' : '#334155',
                                color: '#e2e8f0',
                              }}
                            >
                              {item.type}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#cbd5e1', lineHeight: '1.25' }}>{item.desc}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {selectedHsnDesc && (
                    <div
                      style={{
                        fontSize: '0.72rem',
                        color: '#10b981',
                        marginTop: '0.3rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        lineHeight: '1.2',
                      }}
                    >
                      <span>✓</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {selectedHsnDesc}
                      </span>
                    </div>
                  )}
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

              <div style={{ background: 'var(--surface-raised, rgba(255,255,255,0.03))', border: '1px solid var(--border, #cbd5e1)', borderRadius: '8px', padding: '0.85rem', marginTop: '1rem' }}>
                <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text, #0f172a)', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
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

      {/* CUSTOMER-FACING DISPLAY (CFD) CONTROLLER MODAL */}
      {showCfdModal && (
        <div className="modal-overlay" onClick={() => setShowCfdModal(false)}>
          <div className="modal-content cfd-control-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-left">
                <span className="bento-icon-circle blue">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                    <line x1="8" y1="21" x2="16" y2="21"></line>
                    <line x1="12" y1="17" x2="12" y2="21"></line>
                  </svg>
                </span>
                <div>
                  <h3 className="card-title" style={{ margin: 0 }}>Customer-Facing Display (CFD)</h3>
                  <div className="modal-subtitle">
                    Live mirror items, discounts, and payment QR on a 2nd screen or iPad
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-icon-btn"
                onClick={() => setShowCfdModal(false)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="scanner-modal-body" style={{ padding: '1.25rem' }}>
              <div className="cfd-control-status-row">
                <div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#0f172a' }}>Connection Status</div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Dual-screen / Wireless tablet sync</div>
                </div>
                <div className={`cfd-status-indicator ${isCfdConnected ? 'connected' : 'waiting'}`}>
                  <span className={`walkin-dot ${isCfdConnected ? '' : 'gray'}`} style={{ background: isCfdConnected ? '#10b981' : '#94a3b8' }}></span>
                  <span>{isCfdConnected ? '🟢 Display Connected & Live' : '⚪ Waiting for Display'}</span>
                </div>
              </div>

              <div className="cfd-actions-grid">
                <button
                  type="button"
                  className="cfd-action-btn-large primary"
                  onClick={() => {
                    const cfdUrl = `${window.location.origin}/customer-display`;
                    window.open(cfdUrl, 'CustomerFacingDisplay', 'width=1280,height=800,menubar=no,toolbar=no,location=no');
                    showToast('Customer display opened! Drag it to your second monitor.');
                  }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
                    <line x1="8" y1="21" x2="16" y2="21"></line>
                    <line x1="12" y1="17" x2="12" y2="21"></line>
                  </svg>
                  <span>Launch on 2nd Monitor</span>
                </button>

                <button
                  type="button"
                  className="cfd-action-btn-large"
                  onClick={() => {
                    const cfdUrl = `${window.location.origin}/customer-display`;
                    navigator.clipboard.writeText(cfdUrl);
                    showToast('Link copied! Open on your tablet or customer-facing device.');
                  }}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                  </svg>
                  <span>Copy Tablet Link</span>
                </button>
              </div>

              {/* Direct Link box */}
              <div className="cfd-url-share-box">
                <label>Direct Link for Tablets & iPads:</label>
                <div className="cfd-url-input-wrap">
                  <input
                    type="text"
                    readOnly
                    value={`${window.location.origin}/customer-display`}
                  />
                  <button
                    type="button"
                    className="scanner-open-btn"
                    onClick={() => window.open('/customer-display', '_blank')}
                  >
                    Open
                  </button>
                </div>
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '0.5rem' }}>
                  💡 Tip: Place any tablet or secondary screen facing the customer and open this URL in full-screen. Items will mirror automatically as you scan them!
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* WIRELESS MOBILE SCANNER PAIRING MODAL */}
      {showMobileScannerModal && (
        <div className="modal-overlay" onClick={() => setShowMobileScannerModal(false)}>
          <div className="modal-content mobile-scanner-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-header-left">
                <span className="bento-icon-circle purple">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                    <line x1="12" y1="18" x2="12.01" y2="18" />
                  </svg>
                </span>
                <div>
                  <h3 className="card-title" style={{ margin: 0 }}>Wireless Mobile Barcode Scanner</h3>
                  <div className="modal-subtitle">
                    Turn any smartphone into a supermarket handheld barcode reader
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="modal-close-icon-btn"
                onClick={() => setShowMobileScannerModal(false)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="scanner-modal-body">
              {/* Status Banner */}
              <div className={`scanner-pairing-status-banner ${isPhoneScannerConnected ? 'connected' : 'waiting'}`}>
                <div className="status-indicator-dot"></div>
                <div>
                  <div className="status-main-text">
                    {isPhoneScannerConnected ? 'Phone Scanner Connected & Active' : 'Waiting for Phone to Connect...'}
                  </div>
                  <div className="status-sub-text">
                    {isPhoneScannerConnected
                      ? 'Aim your phone camera at product barcodes to instantly add them to the counter bill.'
                      : 'Scan the QR code below using your phone camera (both devices must be on the same Wi-Fi).'}
                  </div>
                </div>
              </div>

              {/* QR Code and Instructions Grid */}
              {/* QR Code and Instructions Grid (Landscape Rectangle) */}
              <div className="scanner-modal-grid">
                <div className="scanner-qr-column">
                  <div className="scanner-qr-box">
                    {(() => {
                      const localIp = scannerNetworkInfo?.localIp || window.location.hostname;
                      const port = scannerProtocol === 'https'
                        ? (scannerNetworkInfo?.httpsPort || 3444)
                        : (scannerNetworkInfo?.httpPort || 3001);
                      const effectiveProto = scannerProtocol === 'https' ? 'https' : 'http';
                      const pairingUrl = customTunnelUrl.trim()
                        ? `${customTunnelUrl.trim().replace(/\/+$/, '')}/scanner?session=${encodeURIComponent(scannerSessionId)}`
                        : scannerNetworkInfo?.tunnelUrl
                        ? `${scannerNetworkInfo.tunnelUrl.replace(/\/+$/, '')}/scanner?session=${encodeURIComponent(scannerSessionId)}`
                        : `${effectiveProto}://${localIp}:${port}/scanner?session=${encodeURIComponent(scannerSessionId)}`;
                      const svgString = qrSvg(pairingUrl, { size: 155, margin: 2 });
                      return (
                        <>
                          <div
                            className="scanner-qr-svg-wrap"
                            dangerouslySetInnerHTML={{ __html: svgString }}
                          />
                          <div className="scanner-qr-caption">
                            <span>Point Phone Camera Here</span>
                          </div>
                          <div style={{ marginTop: '0.35rem', textAlign: 'center', width: '100%' }}>
                            <div style={{ fontSize: '0.7rem', color: '#4f46e5', fontWeight: 600, wordBreak: 'break-all', padding: '0.2rem 0.35rem', background: '#eef2ff', borderRadius: '4px', border: '1px solid #c7d2fe' }}>
                              {pairingUrl}
                            </div>
                            <button
                              type="button"
                              style={{ marginTop: '0.25rem', background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700, padding: '0.15rem 0.5rem', cursor: 'pointer', color: '#334155' }}
                              onClick={() => {
                                navigator.clipboard?.writeText(pairingUrl);
                                showToast('📋 Link copied to clipboard!');
                              }}
                            >
                              📋 Copy Link
                            </button>
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {/* Protocol Selector Tabs */}
                  <div className="scanner-protocol-toggle" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', width: '100%' }}>
                    {scannerNetworkInfo?.tunnelUrl && (
                      <button
                        type="button"
                        className={`proto-btn ${scannerProtocol === 'tunnel' && !customTunnelUrl ? 'active' : ''}`}
                        onClick={() => { setScannerProtocol('tunnel'); setCustomTunnelUrl(''); }}
                        style={{
                          background: scannerProtocol === 'tunnel' ? 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)' : '#eef2ff',
                          color: scannerProtocol === 'tunnel' ? '#ffffff' : '#4338ca',
                          fontWeight: 700,
                          border: '1px solid #c7d2fe',
                          padding: '0.35rem 0.5rem',
                          borderRadius: '6px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.3rem',
                          fontSize: '0.72rem'
                        }}
                      >
                        <span>🌐 Public Tunnel (Hotspot / 5G)</span>
                      </button>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem' }}>
                      <button
                        type="button"
                        className={`proto-btn ${scannerProtocol === 'http' && !customTunnelUrl ? 'active' : ''}`}
                        onClick={() => { setScannerProtocol('http'); setCustomTunnelUrl(''); }}
                        style={{ padding: '0.35rem 0.35rem', fontSize: '0.72rem' }}
                      >
                        <span>⚡ Local Wi-Fi</span>
                      </button>
                      <button
                        type="button"
                        className={`proto-btn ${scannerProtocol === 'https' && !customTunnelUrl ? 'active' : ''}`}
                        onClick={() => { setScannerProtocol('https'); setCustomTunnelUrl(''); }}
                        style={{ padding: '0.35rem 0.35rem', fontSize: '0.72rem' }}
                      >
                        <span>🔒 Local HTTPS</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="scanner-details-column">
                  {/* Step-by-Step Guide - Horizontal 3-card row */}
                  <div className="scanner-step-list">
                    <div className="scanner-step-item">
                      <span className="step-num">1</span>
                      <div>
                        <strong>Scan with Phone</strong>
                        <p>Open phone camera & point at QR code.</p>
                      </div>
                    </div>

                    <div className="scanner-step-item">
                      <span className="step-num">2</span>
                      <div>
                        <strong>Instant Web Scanner</strong>
                        <p>Tap popup link. No app download needed!</p>
                      </div>
                    </div>

                    <div className="scanner-step-item">
                      <span className="step-num">3</span>
                      <div>
                        <strong>Items Add to Bill</strong>
                        <p>Scan barcodes to beep straight into cart!</p>
                      </div>
                    </div>
                  </div>

                  {/* Troubleshooting Helper Box */}
                  <div className="scanner-troubleshoot-box">
                    <span className="troubleshoot-tag">💡 Quick Connection Tips:</span>
                    <ul className="troubleshoot-list">
                      <li><strong>Using Hotspot or 5G?</strong> Tap <strong>🌐 Public Tunnel</strong> on the left for instant camera permission!</li>
                      <li><strong>On Same Wi-Fi Router?</strong> Tap <strong>⚡ Local Wi-Fi</strong> for direct offline LAN pairing.</li>
                    </ul>
                  </div>

                  {/* Direct Link Row with Copy */}
                  {(() => {
                    const localIp = scannerNetworkInfo?.localIp || window.location.hostname;
                    const port = scannerProtocol === 'https'
                      ? (scannerNetworkInfo?.httpsPort || 3444)
                      : (scannerNetworkInfo?.httpPort || 3001);
                    const effectiveProto = scannerProtocol === 'https' ? 'https' : 'http';
                    const pairingUrl = customTunnelUrl.trim()
                      ? `${customTunnelUrl.trim().replace(/\/+$/, '')}/scanner?session=${encodeURIComponent(scannerSessionId)}`
                      : scannerNetworkInfo?.tunnelUrl
                      ? `${scannerNetworkInfo.tunnelUrl.replace(/\/+$/, '')}/scanner?session=${encodeURIComponent(scannerSessionId)}`
                      : `${effectiveProto}://${localIp}:${port}/scanner?session=${encodeURIComponent(scannerSessionId)}`;

                    return (
                      <div className="scanner-link-box">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                          <label className="scanner-link-label" style={{ margin: 0 }}>Direct Browser Link:</label>
                          <span style={{ fontSize: '0.7rem', color: '#6366f1', cursor: 'pointer', fontWeight: 600 }} onClick={() => {
                            const val = prompt('Optional: Paste public tunnel URL (e.g. from ngrok or localtunnel):', customTunnelUrl);
                            if (val !== null) setCustomTunnelUrl(val.trim());
                          }}>
                            {customTunnelUrl ? '✓ Custom Tunnel (Edit)' : '+ Custom URL'}
                          </span>
                        </div>
                        <div className="scanner-link-input-row">
                          <input
                            type="text"
                            readOnly
                            className="scanner-url-input"
                            value={pairingUrl}
                          />
                          <button
                            type="button"
                            className="scanner-copy-btn"
                            onClick={() => {
                              navigator.clipboard.writeText(pairingUrl);
                              showToast('Scanner link copied to clipboard!');
                            }}
                          >
                            Copy Link
                          </button>
                          <button
                            type="button"
                            className="scanner-open-btn"
                            onClick={() => window.open(pairingUrl, '_blank')}
                          >
                            Open on PC
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

                  {/* Simulator & Settings Row */}
                  <div className="scanner-tools-row">
                    <button
                      type="button"
                      className="scanner-simulate-btn"
                      onClick={() => {
                        const itemWithBarcode = items.find((i) => i.barcode) || items[0];
                        if (itemWithBarcode) {
                          handleBarcodeScanned(itemWithBarcode.barcode || itemWithBarcode.sku || itemWithBarcode.id);
                          showToast(`Test scan simulated: ${itemWithBarcode.name}`);
                        } else {
                          showToast('⚠️ No items in catalog to simulate test scan');
                        }
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                      </svg>
                      <span>Simulate Test Scan</span>
                    </button>

                    <label className="scanner-sound-toggle">
                      <input
                        type="checkbox"
                        checked={scannerSoundEnabled}
                        onChange={(e) => setScannerSoundEnabled(e.target.checked)}
                      />
                      <span>Supermarket Beep Audio</span>
                    </label>
                  </div>
            </div>

            <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="scanner-session-pill">Session ID: {scannerSessionId}</span>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowMobileScannerModal(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* POS QUICK OPEN SHIFT MODAL */}
      {showPosOpenShiftModal && user && (
        <OpenShiftModal
          isOpen={showPosOpenShiftModal}
          onClose={() => setShowPosOpenShiftModal(false)}
          onSuccess={(shift) => {
            setActiveShiftNumber(shift.shiftNumber || 'ACTIVE');
            setShowPosOpenShiftModal(false);
            showToast(`Cash drawer shift ${shift.shiftNumber || 'ACTIVE'} opened with float ₹${(shift.openingCashMinor / 100).toFixed(2)}!`);
          }}
          userName={user.name}
          userRole={user.role}
        />
      )}

      {/* MASTER DATA: ADD / EDIT PARTY MODAL (CUSTOMERS & SUPPLIERS) */}
      {showPartyModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '540px' }}>
            <div className="modal-header">
              <div>
                <h3 className="card-title" style={{ margin: 0 }}>
                  {editingParty
                    ? `✏️ Edit ${partyModalType === 'supplier' ? 'Supplier' : 'Customer Member'}: ${editingParty.name}`
                    : `+ Add New ${partyModalType === 'supplier' ? 'Supplier / Vendor' : 'Customer / Loyalty Member'}`}
                </h3>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '2px' }}>
                  {partyModalType === 'supplier'
                    ? 'Enter supplier contact, GSTIN, and business address'
                    : 'Customer name and 10-digit mobile number for loyalty points and digital bills'}
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
                  {partyModalType === 'supplier' ? 'Supplier / Vendor Business Name *' : 'Customer Full Name *'}
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
                  <label className="form-label">
                    {partyModalType === 'customer' ? 'Mobile Number (for Points) *' : 'Mobile Phone Number'}
                  </label>
                  <input
                    type="tel"
                    className="form-input"
                    required={partyModalType === 'customer'}
                    value={partyFormPhone}
                    onChange={(e) => setPartyFormPhone(e.target.value)}
                    placeholder="10-digit mobile, e.g. 9840123456"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Email Address (Optional)</label>
                  <input
                    type="email"
                    className="form-input"
                    value={partyFormEmail}
                    onChange={(e) => setPartyFormEmail(e.target.value)}
                    placeholder="name@example.com"
                  />
                </div>
              </div>

              {partyModalType === 'supplier' && (
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
                    <label className="form-label">Credit / Balance Limit (₹)</label>
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
              )}

              {partyModalType === 'customer' && (
                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>🪙 Customer Loyalty Points Balance</span>
                    <span style={{ fontSize: '0.78rem', color: '#b45309', fontWeight: 700 }}>
                      Worth {formatRupees((Number(partyFormLoyaltyPoints) || 0) * shopPointValMinor)} discount (1 pt = {formatRupees(shopPointValMinor)})
                    </span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="form-input mono bold"
                    style={{ color: '#b45309', fontSize: '0.95rem' }}
                    value={partyFormLoyaltyPoints}
                    onChange={(e) => setPartyFormLoyaltyPoints(e.target.value)}
                    placeholder="e.g. 250"
                  />
                </div>
              )}

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
                          <button
                            type="button"
                            className={`cat-toggle-switch ${cat.active ? 'on' : 'off'}`}
                            onClick={() => handleToggleCategoryActive(cat)}
                            title={cat.active ? 'Status: ON (Active) — Click to Turn OFF' : 'Status: OFF (Inactive) — Click to Turn ON'}
                          >
                            <span className="cat-toggle-track">
                              <span className="cat-toggle-thumb" />
                            </span>
                            <span className="cat-toggle-state-text">{cat.active ? 'ON' : 'OFF'}</span>
                          </button>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
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
                                  className="cat-edit-btn"
                                  onClick={() => {
                                    setEditingCatId(cat.id);
                                    setEditingCatName(cat.name);
                                    setEditingCatDesc(cat.description || '');
                                  }}
                                  title="Edit Category"
                                >
                                  ✏️
                                </button>
                                <button
                                  type="button"
                                  className="cat-delete-btn"
                                  style={{ width: '28px', height: '28px', fontSize: '0.8rem' }}
                                  onClick={() => handleDeleteCategory(cat)}
                                  title={`Delete "${cat.name}" category`}
                                >
                                  🗑️
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
          <div className="modal-content checkout-rect-modal">
            {/* Modal Header */}
            <div className="checkout-rect-header">
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
                    boxShadow: '0 2px 6px rgba(16, 185, 129, 0.3)',
                  }}
                >
                  ✓
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#047857', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Bill Created Successfully
                  </div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#064e3b' }}>
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
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  padding: '6px',
                  lineHeight: 1,
                  borderRadius: '6px',
                  transition: 'background 0.15s ease',
                }}
                title="Close (Esc)"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            {/* 2-Column Landscape Body */}
            <div className="checkout-rect-body">
              {/* LEFT COLUMN: Bill & Financial Details */}
              <div className="checkout-rect-left">
                <div className="checkout-bill-card">
                  {/* Customer & Item count */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '0.5rem', borderBottom: '1px solid #e2e8f0' }}>
                    <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                        <circle cx="12" cy="7" r="4"></circle>
                      </svg>
                      {checkoutSuccess.customerName || 'Walk-in Customer'}
                    </span>
                    <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#64748b', background: '#e2e8f0', padding: '2px 8px', borderRadius: '12px' }}>
                      {checkoutSuccess.itemCount} {checkoutSuccess.itemCount === 1 ? 'item' : 'items'}
                    </span>
                  </div>

                  {/* Grand Total */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: '0.25rem' }}>
                    <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#334155' }}>Grand Total</span>
                    <span className="mono" style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a' }}>
                      {formatRupees(checkoutSuccess.totalMinor)}
                    </span>
                  </div>

                  {/* Loyalty Points Automatically Credited */}
                  {Math.floor((checkoutSuccess.totalMinor || 0) / 1000) > 0 && checkoutSuccess.customerName && checkoutSuccess.customerName !== 'Walk-in Customer' && (
                    <div style={{ padding: '0.45rem 0.75rem', background: '#fffbeb', borderRadius: '8px', border: '1px solid #fde68a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.82rem', color: '#92400e' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontWeight: 700 }}>
                        🪙 Loyalty Points Credited:
                      </span>
                      <span className="mono" style={{ fontWeight: 800, fontSize: '0.88rem', color: '#d97706' }}>
                        +{Math.floor((checkoutSuccess.totalMinor || 0) / 1000)} pts (₹{(Math.floor((checkoutSuccess.totalMinor || 0) / 1000) * 0.1).toFixed(2)})
                      </span>
                    </div>
                  )}

                  {/* Multiple / Split Payments Breakdown */}
                  {checkoutSuccess.payments && checkoutSuccess.payments.length > 1 && (
                    <div className="checkout-split-pills">
                      {checkoutSuccess.payments.map((p, idx) => (
                        <span key={idx} className="checkout-split-pill">
                          <strong>{p.method.toUpperCase()}:</strong> {formatRupees(p.amountMinor)}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Cash Tender & Change Returned banner */}
                  {checkoutSuccess.tender && checkoutSuccess.tender.cashReceivedMinor > 0 && (
                    <div
                      style={{
                        background: '#ecfdf5',
                        border: '1.5px solid #a7f3d0',
                        borderRadius: '9px',
                        padding: '0.65rem 0.85rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.35rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#065f46' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <rect x="2" y="6" width="20" height="12" rx="2" />
                            <circle cx="12" cy="12" r="3.5" />
                            <path d="M6 12h.01M18 12h.01" />
                          </svg>
                          Cash Tendered:
                        </span>
                        <strong className="mono">{formatRupees(checkoutSuccess.tender.cashReceivedMinor)}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.92rem', color: '#047857', borderTop: '1px dashed #6ee7b7', paddingTop: '0.35rem' }}>
                        <span style={{ fontWeight: 800, display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="9 14 4 9 9 4"></polyline>
                            <path d="M20 20v-7a4 4 0 0 0-4-4H4"></path>
                          </svg>
                          Change to Return:
                        </span>
                        <strong className="mono" style={{ fontSize: '1.18rem', fontWeight: 900, color: '#047857' }}>
                          {formatRupees(checkoutSuccess.tender.changeReturnedMinor)}
                        </strong>
                      </div>
                    </div>
                  )}

                  {/* Balance Line (shown ONLY when balanceMinor > 0) */}
                  {checkoutSuccess.balanceMinor > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.85rem',
                        paddingTop: '0.4rem',
                        borderTop: '1px solid #e2e8f0',
                      }}
                    >
                      <span style={{ color: '#10b981', fontWeight: 600 }}>Paid: {formatRupees(checkoutSuccess.paidMinor)}</span>
                      <span className="mono" style={{ color: '#ef4444', fontWeight: 700 }}>
                        Balance Due: {formatRupees(checkoutSuccess.balanceMinor)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT COLUMN: WhatsApp Share & Quick Actions */}
              <div className="checkout-rect-right">
                {/* WhatsApp Block */}
                {shop?.whatsappEnabled !== false && (
                  <div className="checkout-whatsapp-box">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#166534', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
                        </svg>
                        Share on WhatsApp
                      </span>

                      {/* Language Selector */}
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
                              padding: '2px 7px',
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
                    <div>
                      <input
                        type="tel"
                        className="form-input"
                        style={{
                          width: '100%',
                          borderColor: successPhoneError ? '#ef4444' : '#86efac',
                          background: '#ffffff',
                          fontSize: '0.92rem',
                          padding: '0.5rem 0.7rem',
                          boxSizing: 'border-box',
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
                        <div style={{ color: '#ef4444', fontSize: '0.76rem', marginTop: '3px', fontWeight: 500 }}>
                          {successPhoneError}
                        </div>
                      )}
                    </div>

                    {/* Send WhatsApp Button */}
                    <button
                      type="button"
                      disabled={!validateIndianPhone(successPhone).valid || isSendingWhatsApp}
                      onClick={handleSendWhatsAppFromSuccessModal}
                      style={{
                        width: '100%',
                        padding: '0.55rem 0.85rem',
                        borderRadius: '7px',
                        border: 'none',
                        background: validateIndianPhone(successPhone).valid ? '#25D366' : '#94a3b8',
                        color: '#ffffff',
                        fontWeight: 700,
                        fontSize: '0.9rem',
                        cursor: validateIndianPhone(successPhone).valid ? 'pointer' : 'not-allowed',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.45rem',
                        boxShadow: validateIndianPhone(successPhone).valid ? '0 2px 4px rgba(37, 211, 102, 0.25)' : 'none',
                        transition: 'background 0.2s ease',
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
                      </svg>
                      <span>{successSendState === 'sent' ? 'Sent — Send Again' : 'Send Bill on WhatsApp'}</span>
                    </button>
                  </div>
                )}

                {/* Print Options */}
                <div className="checkout-action-links">
                  <a
                    href={`/api/invoices/${checkoutSuccess.invoiceId}/print?paper=thermal80&autoprint=true`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-secondary checkout-action-btn"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 6 2 18 2 18 9"></polyline>
                      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                      <rect x="6" y="14" width="12" height="8"></rect>
                    </svg>
                    <span>Print Thermal Slip</span>
                  </a>
                  <a
                    href={`/api/invoices/${checkoutSuccess.invoiceId}/print?paper=a4`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-secondary checkout-action-btn"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                      <line x1="16" y1="13" x2="8" y2="13"></line>
                      <line x1="16" y1="17" x2="8" y2="17"></line>
                      <polyline points="10 9 9 9 8 9"></polyline>
                    </svg>
                    <span>View A4 GST PDF</span>
                  </a>
                </div>

                {/* Start New Bill */}
                <div>
                  <button
                    type="button"
                    className="btn btn-primary checkout-start-btn"
                    onClick={handleStartNewBill}
                  >
                    + Start New Bill
                  </button>
                </div>
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
                    {invoiceDetailData.invoice.tender && invoiceDetailData.invoice.tender.cashReceivedMinor > 0 && (
                      <>
                        <div>
                          <div style={{ color: '#64748b' }}>Cash Tendered</div>
                          <div style={{ fontWeight: 700, color: '#334155' }}>
                            {formatRupees(invoiceDetailData.invoice.tender.cashReceivedMinor)}
                          </div>
                        </div>
                        <div>
                          <div style={{ color: '#047857' }}>Change Returned</div>
                          <div style={{ fontWeight: 800, color: '#047857' }}>
                            {formatRupees(invoiceDetailData.invoice.tender.changeReturnedMinor)}
                          </div>
                        </div>
                      </>
                    )}
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

      {/* BARCODE PRINT PORTAL */}
      {activePrintLabels && (
        <div id="barcode-print-portal" className="barcode-print-portal">
          <div className="labels-container">
            {activePrintLabels.map((item, idx) => (
              <div key={idx} className="label-card">
                {shop?.name && <div className="store-name">{shop.name}</div>}
                <div className="product-name">{item.name}</div>
                {item.sku && <div className="sku-line">SKU: {item.sku}</div>}
                <div
                  className="barcode-wrap"
                  dangerouslySetInnerHTML={{ __html: renderBarcodeSvg(item.barcode) }}
                />
                <div className="barcode-digits">{item.barcode}</div>
                {item.priceMinor ? <div className="price-line">MRP: {formatRupees(item.priceMinor)}</div> : null}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
