import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { Item, Category, Branch } from '../../api';
import {
  fetchPromotions,
  createPromotion,
  updatePromotion,
  deletePromotion,
  updatePromotionStatus,
  duplicatePromotion,
  type Promotion,
  type PromotionType,
  type PromotionStatus,
  type PromotionInput,
} from '../../api';
import { ProductCategoryModal } from './ProductCategoryModal';
import { PromotionReportsModal } from './PromotionReportsModal';
import './promotions.css';

interface DiscountsPromotionsViewProps {
  user: any;
  items: Item[];
  categories: Category[];
  branches: Branch[];
  parties?: any[];
  onOpenPos?: () => void;
}

type ScreenMode = 'list' | 'create' | 'edit';
type StatusFilterType = 'all' | 'active' | 'scheduled' | 'expired' | 'draft_paused';

// Helper formatters
const formatRupees = (paise: number = 0): string => {
  return '₹' + (paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const formatDateShort = (dateStr: string): string => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const calculateDays = (startStr: string, endStr: string): number => {
  if (!startStr || !endStr) return 1;
  const d1 = new Date(startStr);
  const d2 = new Date(endStr);
  const diffTime = d2.getTime() - d1.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(1, isNaN(diffDays) ? 1 : diffDays);
};

export function DiscountsPromotionsView({
  user,
  items,
  categories,
  branches,
  onOpenPos,
}: DiscountsPromotionsViewProps) {
  // Screens navigation
  const [screenMode, setScreenMode] = useState<ScreenMode>('list');
  const [editingPromoId, setEditingPromoId] = useState<string | null>(null);

  // Data
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [showReportsModal, setShowReportsModal] = useState(false);

  // Screen 1: Filter states
  const [statusFilter, setStatusFilter] = useState<StatusFilterType>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [branchFilter, setBranchFilter] = useState<string>('ALL');

  // Screen 2: Form states
  const [offerType, setOfferType] = useState<PromotionType>('bogo');

  // BOGO inputs
  const [bogoBuyQty, setBogoBuyQty] = useState<number>(2);
  const [bogoFreeQty, setBogoFreeQty] = useState<number>(1);
  const [bogoSameProduct, setBogoSameProduct] = useState<boolean>(true);
  const [bogoQualifyingItem, setBogoQualifyingItem] = useState<Item | null>(null);
  const [bogoFreeItem, setBogoFreeItem] = useState<Item | null>(null);

  // Percentage inputs
  const [discountPct, setDiscountPct] = useState<number>(10);
  const [pctItem, setPctItem] = useState<Item | null>(null);

  // Flat amount inputs
  const [flatDiscountMinor, setFlatDiscountMinor] = useState<number>(5000); // 5000 paise = ₹50
  const [flatItem, setFlatItem] = useState<Item | null>(null);

  // Bill level inputs
  const [billMinSpendMinor, setBillMinSpendMinor] = useState<number>(100000); // ₹1,000
  const [billDiscountMinor, setBillDiscountMinor] = useState<number>(10000); // ₹100

  // General details
  const [promoName, setPromoName] = useState<string>('');
  const [promoDescription, setPromoDescription] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('2026-10-30');
  const [endDate, setEndDate] = useState<string>('2026-11-29');
  const [selectedBranch, setSelectedBranch] = useState<string>('ALL');
  const [selectedCounter, setSelectedCounter] = useState<string>('ALL');
  const [limitPerBill, setLimitPerBill] = useState<string>('');
  const [allowStacking, setAllowStacking] = useState<boolean>(false);

  // Product Selection Modal
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [modalTargetField, setModalTargetField] = useState<'bogo_buy' | 'bogo_free' | 'pct_item' | 'flat_item'>('bogo_buy');

  // Default fallback product: prefer Aashirvaad Atta or Britannia Marie Gold or first available
  const defaultSampleItem = useMemo<Item>(() => {
    const foundAtta = items.find((i) => i.name.toLowerCase().includes('atta') || i.name.toLowerCase().includes('aashirvaad'));
    if (foundAtta) return foundAtta;
    const foundMarie = items.find((i) => i.name.toLowerCase().includes('marie'));
    if (foundMarie) return foundMarie;
    if (items.length > 0) return items[0];
    return {
      id: 'item_sample_atta',
      name: 'Aashirvaad Shudh Chakki Atta (5kg)',
      sku: 'BSC001',
      hsn: '1905',
      unit: 'pack',
      category: 'Grains & Staples',
      priceMinor: 29000,
      costMinor: 24000,
      taxRateBp: 0,
      taxInclusive: true,
      currentStockMilli: 50000,
      favorite: false,
    };
  }, [items]);

  // Set default product initially when items are loaded
  useEffect(() => {
    if (!bogoQualifyingItem) {
      setBogoQualifyingItem(defaultSampleItem);
    }
    if (!pctItem) {
      setPctItem(defaultSampleItem);
    }
    if (!flatItem) {
      setFlatItem(defaultSampleItem);
    }
  }, [defaultSampleItem, bogoQualifyingItem, pctItem, flatItem]);

  // Load promotions list from API
  const loadPromotionsList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchPromotions();
      setPromotions(res.promotions || []);
    } catch (err: any) {
      console.error('Failed to load promotions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPromotionsList();
  }, [loadPromotionsList]);

  // Status counts for Screen 1 summary cards
  const counts = useMemo(() => {
    let active = 0;
    let scheduled = 0;
    let expired = 0;
    let draftPaused = 0;

    promotions.forEach((p) => {
      if (p.status === 'active') active++;
      else if (p.status === 'scheduled') scheduled++;
      else if (p.status === 'expired') expired++;
      else if (p.status === 'draft' || p.status === 'paused') draftPaused++;
    });

    return { active, scheduled, expired, draftPaused };
  }, [promotions]);

  // Filtered list for Screen 1
  const filteredPromotions = useMemo(() => {
    return promotions.filter((p) => {
      // 1. Status Filter
      if (statusFilter === 'active' && p.status !== 'active') return false;
      if (statusFilter === 'scheduled' && p.status !== 'scheduled') return false;
      if (statusFilter === 'expired' && p.status !== 'expired') return false;
      if (statusFilter === 'draft_paused' && p.status !== 'draft' && p.status !== 'paused') return false;

      // 2. Type Filter
      if (typeFilter !== 'ALL') {
        if (typeFilter === 'bogo' && p.type !== 'bogo') return false;
        if (typeFilter === 'percentage' && p.type !== 'percentage' && p.type !== 'category_discount') return false;
        if (typeFilter === 'flat' && p.type !== 'fixed_amount' && p.type !== 'product_discount') return false;
        if (typeFilter === 'bill_value' && p.type !== 'bill_level' && p.type !== 'min_purchase') return false;
      }

      // 3. Branch Filter
      if (branchFilter !== 'ALL') {
        const branchesList = p.branches || [];
        if (!branchesList.includes('ALL') && !branchesList.includes(branchFilter)) {
          return false;
        }
      }

      // 4. Search Filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = p.name.toLowerCase().includes(q);
        const matchDesc = (p.description || '').toLowerCase().includes(q);
        const matchProd = (p.rules?.qualifyingProductName || '').toLowerCase().includes(q);
        if (!matchName && !matchDesc && !matchProd) return false;
      }

      return true;
    });
  }, [promotions, statusFilter, typeFilter, branchFilter, searchQuery]);

  // Auto-generate placeholder promotion name based on current rule
  const autoGeneratedName = useMemo(() => {
    if (offerType === 'bogo') {
      const prodName = bogoQualifyingItem?.name ? bogoQualifyingItem.name.split('(')[0].trim() : 'Product';
      return `Buy ${bogoBuyQty} Get ${bogoFreeQty} Free – ${prodName}`;
    }
    if (offerType === 'percentage') {
      const prodName = pctItem?.name ? pctItem.name.split('(')[0].trim() : 'Product';
      return `${discountPct}% Off – ${prodName}`;
    }
    if (offerType === 'fixed_amount' || offerType === 'product_discount') {
      const prodName = flatItem?.name ? flatItem.name.split('(')[0].trim() : 'Product';
      return `Flat ₹${flatDiscountMinor / 100} Off – ${prodName}`;
    }
    if (offerType === 'bill_level' || offerType === 'min_purchase') {
      return `₹${billDiscountMinor / 100} Off on orders above ₹${billMinSpendMinor / 100}`;
    }
    return 'Special Promotion';
  }, [offerType, bogoBuyQty, bogoFreeQty, bogoQualifyingItem, discountPct, pctItem, flatDiscountMinor, flatItem, billDiscountMinor, billMinSpendMinor]);

  // Live Summary sentence in Green Info Box
  const liveSummarySentence = useMemo(() => {
    if (offerType === 'bogo') {
      const totalUnits = bogoBuyQty + bogoFreeQty;
      const prodName = bogoQualifyingItem?.name || 'the product';
      return `Customer puts ${totalUnits} packs of ${prodName} in the basket and pays for ${bogoBuyQty}. The cheapest ${bogoFreeQty} ring up free.`;
    }
    if (offerType === 'percentage') {
      const prodName = pctItem?.name || 'the product';
      return `Customer gets ${discountPct}% discount on every unit of ${prodName} purchased.`;
    }
    if (offerType === 'fixed_amount' || offerType === 'product_discount') {
      const prodName = flatItem?.name || 'the product';
      return `Customer saves ${formatRupees(flatDiscountMinor)} flat on every unit of ${prodName} purchased.`;
    }
    if (offerType === 'bill_level' || offerType === 'min_purchase') {
      return `Customer gets ${formatRupees(billDiscountMinor)} off when total bill value reaches ${formatRupees(billMinSpendMinor)} or more.`;
    }
    return '';
  }, [offerType, bogoBuyQty, bogoFreeQty, bogoQualifyingItem, discountPct, pctItem, flatDiscountMinor, flatItem, billDiscountMinor, billMinSpendMinor]);

  // Live Bill Preview Calculations
  const billPreviewData = useMemo(() => {
    let productName = 'Aashirvaad Shudh Chakki Atta (5kg)';
    let unitPrice = 29000; // paise
    let qty = 3;
    let discountAmount = 29000;

    if (offerType === 'bogo') {
      const currentItem = bogoQualifyingItem || defaultSampleItem;
      productName = currentItem.name;
      unitPrice = currentItem.priceMinor || 29000;
      qty = bogoBuyQty + bogoFreeQty;
      discountAmount = unitPrice * bogoFreeQty;
    } else if (offerType === 'percentage') {
      const currentItem = pctItem || defaultSampleItem;
      productName = currentItem.name;
      unitPrice = currentItem.priceMinor || 29000;
      qty = 1;
      discountAmount = Math.round((unitPrice * discountPct) / 100);
    } else if (offerType === 'fixed_amount' || offerType === 'product_discount') {
      const currentItem = flatItem || defaultSampleItem;
      productName = currentItem.name;
      unitPrice = currentItem.priceMinor || 29000;
      qty = 1;
      discountAmount = Math.min(flatDiscountMinor, unitPrice);
    } else if (offerType === 'bill_level' || offerType === 'min_purchase') {
      productName = 'Assorted Groceries & Staples';
      unitPrice = billMinSpendMinor;
      qty = 1;
      discountAmount = billDiscountMinor;
    }

    const subtotal = unitPrice * qty;
    const payable = Math.max(0, subtotal - discountAmount);

    return {
      productName,
      unitPrice,
      qty,
      subtotal,
      discountAmount,
      payable,
    };
  }, [offerType, bogoBuyQty, bogoFreeQty, bogoQualifyingItem, discountPct, pctItem, flatDiscountMinor, flatItem, billMinSpendMinor, billDiscountMinor, defaultSampleItem]);

  // Days count for schedule
  const scheduleDaysCount = useMemo(() => {
    return calculateDays(startDate, endDate);
  }, [startDate, endDate]);

  // Checklist Validation
  const checklist = useMemo(() => {
    const isOfferTypeReady = true;
    let isProductsReady = false;
    let productsDetail = 'Choose qualifying product';

    if (offerType === 'bogo') {
      isProductsReady = !!bogoQualifyingItem;
      productsDetail = bogoQualifyingItem ? bogoQualifyingItem.name : 'Choose qualifying product';
    } else if (offerType === 'percentage') {
      isProductsReady = !!pctItem;
      productsDetail = pctItem ? pctItem.name : 'Choose product';
    } else if (offerType === 'fixed_amount' || offerType === 'product_discount') {
      isProductsReady = !!flatItem;
      productsDetail = flatItem ? flatItem.name : 'Choose product';
    } else {
      isProductsReady = true;
      productsDetail = `Orders over ${formatRupees(billMinSpendMinor)}`;
    }

    const effectiveName = promoName.trim() || autoGeneratedName;
    const isNameReady = effectiveName.length > 0;
    const nameDetail = effectiveName;

    const isScheduleReady = !!startDate && !!endDate && new Date(startDate) <= new Date(endDate);
    const scheduleDetail = `${formatDateShort(startDate)} – ${formatDateShort(endDate)} (${scheduleDaysCount} days)`;

    return {
      isOfferTypeReady,
      offerTypeDetail:
        offerType === 'bogo'
          ? 'Buy X, get Y free'
          : offerType === 'percentage'
          ? 'Percentage off'
          : offerType === 'fixed_amount' || offerType === 'product_discount'
          ? 'Flat amount off'
          : 'Bill value offer',
      isProductsReady,
      productsDetail,
      isNameReady,
      nameDetail,
      isScheduleReady,
      scheduleDetail,
      canPublish: isOfferTypeReady && isProductsReady && isNameReady && isScheduleReady,
    };
  }, [offerType, bogoQualifyingItem, pctItem, flatItem, billMinSpendMinor, promoName, autoGeneratedName, startDate, endDate, scheduleDaysCount]);

  // Handlers for Promotion Actions
  const handleOpenCreate = () => {
    setEditingPromoId(null);
    setOfferType('bogo');
    setBogoBuyQty(2);
    setBogoFreeQty(1);
    setBogoSameProduct(true);
    setBogoQualifyingItem(defaultSampleItem);
    setBogoFreeItem(defaultSampleItem);
    setDiscountPct(10);
    setFlatDiscountMinor(5000);
    setBillMinSpendMinor(100000);
    setBillDiscountMinor(10000);
    setPromoName('');
    setPromoDescription('');
    setStartDate('2026-10-30');
    setEndDate('2026-11-29');
    setSelectedBranch('ALL');
    setSelectedCounter('ALL');
    setLimitPerBill('');
    setAllowStacking(false);
    setScreenMode('create');
  };

  const handleOpenEdit = (promo: Promotion) => {
    setEditingPromoId(promo.id);
    setOfferType(promo.type);
    setPromoName(promo.name);
    setPromoDescription(promo.description || '');
    setStartDate(promo.startDate || '2026-10-30');
    setEndDate(promo.endDate || '2026-11-29');
    setSelectedBranch(promo.branches?.[0] || 'ALL');
    setSelectedCounter(promo.counters?.[0] || 'ALL');
    setAllowStacking(promo.allowStacking || false);
    setLimitPerBill(promo.rules?.maxFreePerBill ? String(promo.rules.maxFreePerBill) : '');

    // Restore rule fields
    if (promo.type === 'bogo') {
      setBogoBuyQty(promo.rules?.qualifyingQty || 2);
      setBogoFreeQty(promo.rules?.freeQty || 1);
      setBogoSameProduct(promo.rules?.sameProduct !== false);
      const buyItem = items.find((i) => i.id === promo.rules?.qualifyingProductId);
      if (buyItem) setBogoQualifyingItem(buyItem);
      const freeItem = items.find((i) => i.id === promo.rules?.freeProductId);
      if (freeItem) setBogoFreeItem(freeItem);
    } else if (promo.type === 'percentage') {
      setDiscountPct(promo.rules?.discountPct || 10);
      const prodId = promo.rules?.productIds?.[0];
      const item = items.find((i) => i.id === prodId);
      if (item) setPctItem(item);
    } else if (promo.type === 'fixed_amount' || promo.type === 'product_discount') {
      setFlatDiscountMinor(promo.rules?.discountAmountMinor || 5000);
      const prodId = promo.rules?.productIds?.[0];
      const item = items.find((i) => i.id === prodId);
      if (item) setFlatItem(item);
    } else if (promo.type === 'bill_level' || promo.type === 'min_purchase') {
      setBillMinSpendMinor(promo.rules?.minBillAmountMinor || 100000);
      setBillDiscountMinor(promo.rules?.discountAmountMinor || 10000);
    }

    setScreenMode('edit');
  };

  const handleDuplicate = async (promo: Promotion) => {
    setActionLoading(true);
    try {
      await duplicatePromotion(promo.id);
      await loadPromotionsList();
    } catch (err: any) {
      alert(err.message || 'Failed to duplicate promotion');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleStatus = async (promo: Promotion) => {
    setActionLoading(true);
    try {
      const nextStatus: PromotionStatus = promo.status === 'active' ? 'paused' : 'active';
      await updatePromotionStatus(promo.id, nextStatus);
      await loadPromotionsList();
    } catch (err: any) {
      alert(err.message || 'Failed to update status');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (promo: Promotion) => {
    if (!window.confirm(`Are you sure you want to delete promotion "${promo.name}"?`)) return;
    setActionLoading(true);
    try {
      await deletePromotion(promo.id);
      await loadPromotionsList();
    } catch (err: any) {
      alert(err.message || 'Failed to delete promotion');
    } finally {
      setActionLoading(false);
    }
  };

  // Save / Publish Promotion
  const handleSavePromotion = async (status: PromotionStatus) => {
    setActionLoading(true);
    try {
      const effectiveName = promoName.trim() || autoGeneratedName;

      // Construct rules based on offer type
      let rules: Record<string, any> = {};
      if (offerType === 'bogo') {
        const qualifying = bogoQualifyingItem || defaultSampleItem;
        const free = bogoSameProduct ? qualifying : bogoFreeItem || qualifying;
        rules = {
          qualifyingProductId: qualifying.id,
          qualifyingProductName: qualifying.name,
          qualifyingQty: bogoBuyQty,
          freeProductId: free.id,
          freeProductName: free.name,
          freeQty: bogoFreeQty,
          sameProduct: bogoSameProduct,
          maxFreePerBill: limitPerBill ? parseInt(limitPerBill, 10) : 10,
        };
      } else if (offerType === 'percentage') {
        const prod = pctItem || defaultSampleItem;
        rules = {
          productIds: [prod.id],
          discountPct,
          minPurchaseQty: 1,
        };
      } else if (offerType === 'fixed_amount' || offerType === 'product_discount') {
        const prod = flatItem || defaultSampleItem;
        rules = {
          productIds: [prod.id],
          discountAmountMinor: flatDiscountMinor,
          minPurchaseQty: 1,
        };
      } else if (offerType === 'bill_level' || offerType === 'min_purchase') {
        rules = {
          minBillAmountMinor: billMinSpendMinor,
          discountAmountMinor: billDiscountMinor,
        };
      }

      const payload: PromotionInput = {
        name: effectiveName,
        description: promoDescription.trim() || undefined,
        type: offerType,
        status,
        startDate,
        endDate,
        branches: selectedBranch === 'ALL' ? ['ALL'] : [selectedBranch],
        counters: selectedCounter === 'ALL' ? ['ALL'] : [selectedCounter],
        rules,
        allowStacking,
        customerEligibilityType: 'all',
      };

      if (editingPromoId) {
        await updatePromotion(editingPromoId, payload);
      } else {
        await createPromotion(payload);
      }

      await loadPromotionsList();
      setScreenMode('list');
    } catch (err: any) {
      alert(err.message || 'Failed to save promotion');
    } finally {
      setActionLoading(false);
    }
  };

  // Product Selection Modal Trigger
  const openProductSelector = (target: 'bogo_buy' | 'bogo_free' | 'pct_item' | 'flat_item') => {
    setModalTargetField(target);
    setProductModalOpen(true);
  };

  const handleProductSelected = (result: { singleProduct?: Item }) => {
    if (result.singleProduct) {
      if (modalTargetField === 'bogo_buy') {
        setBogoQualifyingItem(result.singleProduct);
        if (bogoSameProduct) {
          setBogoFreeItem(result.singleProduct);
        }
      } else if (modalTargetField === 'bogo_free') {
        setBogoFreeItem(result.singleProduct);
      } else if (modalTargetField === 'pct_item') {
        setPctItem(result.singleProduct);
      } else if (modalTargetField === 'flat_item') {
        setFlatItem(result.singleProduct);
      }
    }
    setProductModalOpen(false);
  };

  // Helper for rendering a promotion rule in Screen 1 row
  const getOfferRuleText = (p: Promotion) => {
    if (p.type === 'bogo') {
      const bQty = p.rules?.qualifyingQty || 1;
      const fQty = p.rules?.freeQty || 1;
      return `Buy ${bQty} → get ${fQty} free`;
    }
    if (p.type === 'percentage' || p.type === 'category_discount') {
      const pct = p.rules?.discountPct || 10;
      return `${pct}% off`;
    }
    if (p.type === 'fixed_amount' || p.type === 'product_discount') {
      const amt = p.rules?.discountAmountMinor || 5000;
      return `${formatRupees(amt)} off`;
    }
    if (p.type === 'bill_level' || p.type === 'min_purchase') {
      const minBill = p.rules?.minBillAmountMinor || 100000;
      const disc = p.rules?.discountAmountMinor || 10000;
      return `${formatRupees(disc)} off over ${formatRupees(minBill)}`;
    }
    return p.name;
  };

  // Progress Bar for Screen 1
  const getRunsProgress = (p: Promotion) => {
    if (!p.startDate || !p.endDate) return { pct: 0, text: '' };
    const start = new Date(p.startDate).getTime();
    const end = new Date(p.endDate).getTime();
    const now = new Date('2026-10-30').getTime(); // Project reference time

    const totalDays = Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1);
    const elapsedDays = Math.max(1, Math.min(totalDays, Math.round((now - start) / (1000 * 60 * 60 * 24)) + 1));

    let pct = Math.round((elapsedDays / totalDays) * 100);
    if (p.status === 'scheduled') pct = 0;
    if (p.status === 'expired') pct = 100;

    return {
      pct: Math.min(100, Math.max(0, pct)),
      text: `Day ${elapsedDays} of ${totalDays}`,
    };
  };

  // =========================================================================
  // RENDER: SCREEN 2 - NEW / EDIT PROMOTION
  // =========================================================================
  if (screenMode === 'create' || screenMode === 'edit') {
    return (
      <main className="promo-page-wrapper">
        <div className="promo-container">
          {/* Back link */}
          <div className="promo-back-row">
            <button
              type="button"
              className="promo-back-btn"
              onClick={() => setScreenMode('list')}
              aria-label="Back to all promotions"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"></line>
                <polyline points="12 19 5 12 12 5"></polyline>
              </svg>
              All promotions
            </button>
          </div>

          {/* Heading */}
          <div className="promo-header-titles">
            <h1>{screenMode === 'edit' ? 'Edit promotion' : 'New promotion'}</h1>
            <p>Pick the kind of offer, set the rule, and check how it prints on the bill before you publish.</p>
          </div>

          <div style={{ height: '24px' }}></div>

          {/* Two-Column Form & Sidebar */}
          <div className="promo-new-layout">
            {/* LEFT FORM */}
            <div className="promo-form-col">
              {/* SECTION 1: WHAT KIND OF OFFER? */}
              <section className="promo-section-card" aria-labelledby="heading-section-1">
                <div className="promo-section-card-header">
                  <div className="promo-number-badge">1</div>
                  <h2 id="heading-section-1">What kind of offer?</h2>
                </div>

                <div className="promo-tiles-grid" role="radiogroup" aria-label="Promotion Type">
                  {/* Tile 1: Buy X get Y free */}
                  <button
                    type="button"
                    className={`promo-offer-tile ${offerType === 'bogo' ? 'selected' : ''}`}
                    onClick={() => setOfferType('bogo')}
                    aria-pressed={offerType === 'bogo'}
                  >
                    <div className="promo-tile-icon-box">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 12 20 22 4 22 4 12"></polyline>
                        <rect x="2" y="7" width="20" height="5"></rect>
                        <line x1="12" y1="22" x2="12" y2="7"></line>
                        <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path>
                        <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path>
                      </svg>
                    </div>
                    <div className="promo-tile-text-group">
                      <span className="promo-tile-title">Buy X, get Y free</span>
                      <span className="promo-tile-desc">Free units when they buy enough</span>
                    </div>
                  </button>

                  {/* Tile 2: Percentage off */}
                  <button
                    type="button"
                    className={`promo-offer-tile ${offerType === 'percentage' ? 'selected' : ''}`}
                    onClick={() => setOfferType('percentage')}
                    aria-pressed={offerType === 'percentage'}
                  >
                    <div className="promo-tile-icon-box">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="19" y1="5" x2="5" y2="19"></line>
                        <circle cx="6.5" cy="6.5" r="2.5"></circle>
                        <circle cx="17.5" cy="17.5" r="2.5"></circle>
                      </svg>
                    </div>
                    <div className="promo-tile-text-group">
                      <span className="promo-tile-title">Percentage off</span>
                      <span className="promo-tile-desc">A % discount on a product</span>
                    </div>
                  </button>

                  {/* Tile 3: Flat amount off */}
                  <button
                    type="button"
                    className={`promo-offer-tile ${offerType === 'fixed_amount' || offerType === 'product_discount' ? 'selected' : ''}`}
                    onClick={() => setOfferType('fixed_amount')}
                    aria-pressed={offerType === 'fixed_amount' || offerType === 'product_discount'}
                  >
                    <div className="promo-tile-icon-box">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 3h12"></path>
                        <path d="M6 8h12"></path>
                        <path d="M6 13l8.5 8"></path>
                        <path d="M6 13h3a4 4 0 0 0 0-8"></path>
                      </svg>
                    </div>
                    <div className="promo-tile-text-group">
                      <span className="promo-tile-title">Flat amount off</span>
                      <span className="promo-tile-desc">A fixed ₹ discount on a product</span>
                    </div>
                  </button>

                  {/* Tile 4: Bill value offer */}
                  <button
                    type="button"
                    className={`promo-offer-tile ${offerType === 'bill_level' || offerType === 'min_purchase' ? 'selected' : ''}`}
                    onClick={() => setOfferType('bill_level')}
                    aria-pressed={offerType === 'bill_level' || offerType === 'min_purchase'}
                  >
                    <div className="promo-tile-icon-box">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="9" cy="21" r="1"></circle>
                        <circle cx="20" cy="21" r="1"></circle>
                        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                      </svg>
                    </div>
                    <div className="promo-tile-text-group">
                      <span className="promo-tile-title">Bill value offer</span>
                      <span className="promo-tile-desc">Spend a minimum, save on the bill</span>
                    </div>
                  </button>
                </div>
              </section>

              {/* SECTION 2: SET THE RULE */}
              <section className="promo-section-card" aria-labelledby="heading-section-2">
                <div className="promo-section-card-header">
                  <div className="promo-number-badge">2</div>
                  <h2 id="heading-section-2">Set the rule</h2>
                </div>

                <div className="promo-rule-container">
                  {/* BOGO Configuration */}
                  {offerType === 'bogo' && (
                    <>
                      {/* Customer Buys Box */}
                      <div className="promo-rule-box">
                        <div className="promo-rule-box-header">CUSTOMER BUYS</div>
                        <div className="promo-rule-stepper-row">
                          <div className="promo-stepper">
                            <button
                              type="button"
                              className="promo-stepper-btn"
                              onClick={() => setBogoBuyQty(Math.max(1, bogoBuyQty - 1))}
                              disabled={bogoBuyQty <= 1}
                              aria-label="Decrease buy quantity"
                            >
                              −
                            </button>
                            <span className="promo-stepper-val">{bogoBuyQty}</span>
                            <button
                              type="button"
                              className="promo-stepper-btn"
                              onClick={() => setBogoBuyQty(Math.min(20, bogoBuyQty + 1))}
                              disabled={bogoBuyQty >= 20}
                              aria-label="Increase buy quantity"
                            >
                              +
                            </button>
                          </div>

                          <span className="promo-rule-label-connector">of</span>

                          {/* Product Card */}
                          {bogoQualifyingItem ? (
                            <div className="promo-product-card">
                              <div className="promo-product-card-left">
                                <div className="promo-product-icon">
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                                    <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                                    <line x1="12" y1="22.08" x2="12" y2="12"></line>
                                  </svg>
                                </div>
                                <div className="promo-product-details">
                                  <span className="promo-product-name">{bogoQualifyingItem.name}</span>
                                  <span className="promo-product-mono">
                                    SKU {bogoQualifyingItem.sku || 'BSC001'} · HSN {bogoQualifyingItem.hsn || '1905'} · {formatRupees(bogoQualifyingItem.priceMinor)}
                                  </span>
                                </div>
                              </div>
                              <button
                                type="button"
                                className="promo-product-change-btn"
                                onClick={() => openProductSelector('bogo_buy')}
                              >
                                Change
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="promo-dashed-choose-btn"
                              onClick={() => openProductSelector('bogo_buy')}
                            >
                              + Choose qualifying product
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Arrow Down */}
                      <div className="promo-bogo-arrow-row">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="5" x2="12" y2="19"></line>
                          <polyline points="19 12 12 19 5 12"></polyline>
                        </svg>
                        <span>and gets free</span>
                      </div>

                      {/* Customer Gets Free Box */}
                      <div className="promo-rule-box">
                        <div className="promo-rule-box-header">
                          <span>CUSTOMER GETS FREE</span>
                          <label className="promo-checkbox-label" style={{ minHeight: 'auto' }}>
                            <input
                              type="checkbox"
                              className="promo-checkbox-input"
                              checked={bogoSameProduct}
                              onChange={(e) => {
                                setBogoSameProduct(e.target.checked);
                                if (e.target.checked) {
                                  setBogoFreeItem(bogoQualifyingItem);
                                }
                              }}
                            />
                            Same product
                          </label>
                        </div>

                        <div className="promo-rule-stepper-row">
                          <div className="promo-stepper">
                            <button
                              type="button"
                              className="promo-stepper-btn"
                              onClick={() => setBogoFreeQty(Math.max(1, bogoFreeQty - 1))}
                              disabled={bogoFreeQty <= 1}
                              aria-label="Decrease free quantity"
                            >
                              −
                            </button>
                            <span className="promo-stepper-val">{bogoFreeQty}</span>
                            <button
                              type="button"
                              className="promo-stepper-btn"
                              onClick={() => setBogoFreeQty(Math.min(20, bogoFreeQty + 1))}
                              disabled={bogoFreeQty >= 20}
                              aria-label="Increase free quantity"
                            >
                              +
                            </button>
                          </div>

                          <span className="promo-rule-label-connector">of</span>

                          {/* Free Product display */}
                          {bogoSameProduct ? (
                            <div className="promo-product-card">
                              <div className="promo-product-card-left">
                                <div className="promo-product-icon">
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                                    <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                                    <line x1="12" y1="22.08" x2="12" y2="12"></line>
                                  </svg>
                                </div>
                                <div className="promo-product-details">
                                  <span className="promo-product-name">{bogoQualifyingItem?.name || 'Same product'}</span>
                                  <span className="promo-product-mono">
                                    SKU {bogoQualifyingItem?.sku || 'BSC001'} · HSN {bogoQualifyingItem?.hsn || '1905'} · {formatRupees(bogoQualifyingItem?.priceMinor)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ) : bogoFreeItem ? (
                            <div className="promo-product-card">
                              <div className="promo-product-card-left">
                                <div className="promo-product-icon">
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                                    <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                                    <line x1="12" y1="22.08" x2="12" y2="12"></line>
                                  </svg>
                                </div>
                                <div className="promo-product-details">
                                  <span className="promo-product-name">{bogoFreeItem.name}</span>
                                  <span className="promo-product-mono">
                                    SKU {bogoFreeItem.sku || 'SKU'} · {formatRupees(bogoFreeItem.priceMinor)}
                                  </span>
                                </div>
                              </div>
                              <button
                                type="button"
                                className="promo-product-change-btn"
                                onClick={() => openProductSelector('bogo_free')}
                              >
                                Change
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="promo-dashed-choose-btn"
                              onClick={() => openProductSelector('bogo_free')}
                            >
                              + Choose free product
                            </button>
                          )}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Percentage Off Configuration */}
                  {offerType === 'percentage' && (
                    <div className="promo-rule-box">
                      <div className="promo-rule-box-header">DISCOUNT PERCENTAGE</div>
                      <div className="promo-rule-stepper-row">
                        <div className="promo-stepper">
                          <button
                            type="button"
                            className="promo-stepper-btn"
                            onClick={() => setDiscountPct(Math.max(5, discountPct - 5))}
                            disabled={discountPct <= 5}
                            aria-label="Decrease discount percentage"
                          >
                            −
                          </button>
                          <span className="promo-stepper-val">{discountPct}%</span>
                          <button
                            type="button"
                            className="promo-stepper-btn"
                            onClick={() => setDiscountPct(Math.min(90, discountPct + 5))}
                            disabled={discountPct >= 90}
                            aria-label="Increase discount percentage"
                          >
                            +
                          </button>
                        </div>

                        <span className="promo-rule-label-connector">off</span>

                        {pctItem ? (
                          <div className="promo-product-card">
                            <div className="promo-product-card-left">
                              <div className="promo-product-icon">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                                </svg>
                              </div>
                              <div className="promo-product-details">
                                <span className="promo-product-name">{pctItem.name}</span>
                                <span className="promo-product-mono">{formatRupees(pctItem.priceMinor)}</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              className="promo-product-change-btn"
                              onClick={() => openProductSelector('pct_item')}
                            >
                              Change
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="promo-dashed-choose-btn"
                            onClick={() => openProductSelector('pct_item')}
                          >
                            + Choose product
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Flat Amount Off Configuration */}
                  {(offerType === 'fixed_amount' || offerType === 'product_discount') && (
                    <div className="promo-rule-box">
                      <div className="promo-rule-box-header">FLAT DISCOUNT AMOUNT</div>
                      <div className="promo-rule-stepper-row">
                        <div className="promo-stepper">
                          <button
                            type="button"
                            className="promo-stepper-btn"
                            onClick={() => setFlatDiscountMinor(Math.max(1000, flatDiscountMinor - 1000))}
                            disabled={flatDiscountMinor <= 1000}
                            aria-label="Decrease discount amount"
                          >
                            −
                          </button>
                          <span className="promo-stepper-val">₹{flatDiscountMinor / 100}</span>
                          <button
                            type="button"
                            className="promo-stepper-btn"
                            onClick={() => setFlatDiscountMinor(Math.min(28000, flatDiscountMinor + 1000))}
                            disabled={flatDiscountMinor >= 28000}
                            aria-label="Increase discount amount"
                          >
                            +
                          </button>
                        </div>

                        <span className="promo-rule-label-connector">off</span>

                        {flatItem ? (
                          <div className="promo-product-card">
                            <div className="promo-product-card-left">
                              <div className="promo-product-icon">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                                </svg>
                              </div>
                              <div className="promo-product-details">
                                <span className="promo-product-name">{flatItem.name}</span>
                                <span className="promo-product-mono">{formatRupees(flatItem.priceMinor)}</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              className="promo-product-change-btn"
                              onClick={() => openProductSelector('flat_item')}
                            >
                              Change
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="promo-dashed-choose-btn"
                            onClick={() => openProductSelector('flat_item')}
                          >
                            + Choose product
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Bill Value Offer Configuration */}
                  {(offerType === 'bill_level' || offerType === 'min_purchase') && (
                    <div className="promo-rule-box">
                      <div className="promo-rule-box-header">BILL VALUE THRESHOLDS</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <div className="promo-rule-stepper-row">
                          <span className="promo-rule-label-connector" style={{ minWidth: '180px' }}>
                            When the bill is at least
                          </span>
                          <div className="promo-stepper">
                            <button
                              type="button"
                              className="promo-stepper-btn"
                              onClick={() => setBillMinSpendMinor(Math.max(10000, billMinSpendMinor - 10000))}
                              disabled={billMinSpendMinor <= 10000}
                              aria-label="Decrease bill threshold"
                            >
                              −
                            </button>
                            <span className="promo-stepper-val">₹{billMinSpendMinor / 100}</span>
                            <button
                              type="button"
                              className="promo-stepper-btn"
                              onClick={() => setBillMinSpendMinor(billMinSpendMinor + 10000)}
                              aria-label="Increase bill threshold"
                            >
                              +
                            </button>
                          </div>
                        </div>

                        <div className="promo-rule-stepper-row">
                          <span className="promo-rule-label-connector" style={{ minWidth: '180px' }}>
                            take off
                          </span>
                          <div className="promo-stepper">
                            <button
                              type="button"
                              className="promo-stepper-btn"
                              onClick={() => setBillDiscountMinor(Math.max(1000, billDiscountMinor - 5000))}
                              disabled={billDiscountMinor <= 1000}
                              aria-label="Decrease discount amount"
                            >
                              −
                            </button>
                            <span className="promo-stepper-val">₹{billDiscountMinor / 100}</span>
                            <button
                              type="button"
                              className="promo-stepper-btn"
                              onClick={() => setBillDiscountMinor(billDiscountMinor + 5000)}
                              aria-label="Increase discount amount"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Green Info Box - Live Plain English Summary */}
                  <div className="promo-live-summary-box">
                    <svg className="promo-live-summary-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="16" x2="12" y2="12"></line>
                      <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                    <span>{liveSummarySentence}</span>
                  </div>
                </div>
              </section>

              {/* SECTION 3: NAME IT */}
              <section className="promo-section-card" aria-labelledby="heading-section-3">
                <div className="promo-section-card-header">
                  <div className="promo-number-badge">3</div>
                  <h2 id="heading-section-3">Name it</h2>
                </div>

                <div className="promo-form-group">
                  <label htmlFor="promo-name-input" className="promo-form-label">
                    Promotion name *
                  </label>
                  <input
                    id="promo-name-input"
                    type="text"
                    className="promo-text-input"
                    value={promoName}
                    onChange={(e) => setPromoName(e.target.value)}
                    placeholder={`e.g. ${autoGeneratedName}`}
                    required
                  />
                  <div className="promo-input-helper">
                    Shown to cashiers and printed on the customer's bill.
                  </div>
                </div>

                <div className="promo-form-group">
                  <label htmlFor="promo-desc-input" className="promo-form-label">
                    Description (optional)
                  </label>
                  <textarea
                    id="promo-desc-input"
                    className="promo-textarea"
                    value={promoDescription}
                    onChange={(e) => setPromoDescription(e.target.value)}
                    placeholder="Internal notes or staff instructions..."
                  />
                </div>
              </section>

              {/* SECTION 4: WHEN AND WHERE */}
              <section className="promo-section-card" aria-labelledby="heading-section-4">
                <div className="promo-section-card-header">
                  <div className="promo-number-badge">4</div>
                  <h2 id="heading-section-4">When and where</h2>
                </div>

                <div className="promo-dates-grid">
                  <div className="promo-form-group">
                    <label htmlFor="promo-start-date" className="promo-form-label">
                      Start date *
                    </label>
                    <input
                      id="promo-start-date"
                      type="date"
                      className="promo-date-input"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      required
                    />
                  </div>

                  <div className="promo-form-group">
                    <label htmlFor="promo-end-date" className="promo-form-label">
                      End date *
                    </label>
                    <input
                      id="promo-end-date"
                      type="date"
                      className="promo-date-input"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="promo-input-helper" style={{ marginBottom: '16px' }}>
                  Runs for {scheduleDaysCount} days ({formatDateShort(startDate)} – {formatDateShort(endDate)})
                </div>

                <div className="promo-dates-grid">
                  <div className="promo-form-group">
                    <label htmlFor="promo-branches-select" className="promo-form-label">
                      Branches
                    </label>
                    <select
                      id="promo-branches-select"
                      className="promo-dropdown-select"
                      style={{ width: '100%' }}
                      value={selectedBranch}
                      onChange={(e) => setSelectedBranch(e.target.value)}
                    >
                      <option value="ALL">All branches</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.code || b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="promo-form-group">
                    <label htmlFor="promo-counters-select" className="promo-form-label">
                      Counters
                    </label>
                    <select
                      id="promo-counters-select"
                      className="promo-dropdown-select"
                      style={{ width: '100%' }}
                      value={selectedCounter}
                      onChange={(e) => setSelectedCounter(e.target.value)}
                    >
                      <option value="ALL">All counters</option>
                      <option value="C1">Counter 1 (Main Billing)</option>
                      <option value="C2">Counter 2 (Express Checkout)</option>
                      <option value="C3">Counter 3</option>
                    </select>
                  </div>
                </div>

                <div className="promo-divider-line"></div>

                <div className="promo-form-group">
                  <label htmlFor="promo-limit-input" className="promo-form-label">
                    Limit per bill
                  </label>
                  <input
                    id="promo-limit-input"
                    type="number"
                    min="1"
                    className="promo-text-input"
                    value={limitPerBill}
                    onChange={(e) => setLimitPerBill(e.target.value)}
                    placeholder="No limit"
                    style={{ maxWidth: '240px' }}
                  />
                  <div className="promo-input-helper">
                    Optional limit on how many times this offer applies per invoice.
                  </div>
                </div>

                <div className="promo-form-group" style={{ marginTop: '14px' }}>
                  <label className="promo-checkbox-label">
                    <input
                      type="checkbox"
                      className="promo-checkbox-input"
                      checked={allowStacking}
                      onChange={(e) => setAllowStacking(e.target.checked)}
                    />
                    Can combine with other offers
                  </label>
                </div>
              </section>
            </div>

            {/* RIGHT SIDEBAR */}
            <aside className="promo-sidebar-col" aria-label="Bill Preview and Actions">
              {/* Bill Preview Card */}
              <div className="promo-sidebar-card">
                <h3 className="promo-sidebar-card-title">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1Z"></path>
                    <line x1="8" y1="6" x2="16" y2="6"></line>
                    <line x1="8" y1="10" x2="16" y2="10"></line>
                    <line x1="8" y1="14" x2="12" y2="14"></line>
                  </svg>
                  Bill preview
                </h3>

                <div className="promo-receipt-box">
                  <div className="promo-receipt-store-name">[SUPERMARKET POS]</div>
                  <div className="promo-receipt-dashed-line"></div>

                  <div className="promo-receipt-item-name">{billPreviewData.productName}</div>
                  <div className="promo-receipt-row">
                    <span>
                      {billPreviewData.qty} × {formatRupees(billPreviewData.unitPrice)}
                    </span>
                    <span>{formatRupees(billPreviewData.subtotal)}</span>
                  </div>

                  <div className="promo-receipt-row offer-line" style={{ marginTop: '4px' }}>
                    <span style={{ maxWidth: '170px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {promoName.trim() || autoGeneratedName}
                    </span>
                    <span>−{formatRupees(billPreviewData.discountAmount)}</span>
                  </div>

                  <div className="promo-receipt-dashed-line"></div>

                  <div className="promo-receipt-row total-line">
                    <span>Total</span>
                    <span>{formatRupees(billPreviewData.payable)}</span>
                  </div>
                </div>

                <div className="promo-savings-banner">
                  Customer saves {formatRupees(billPreviewData.discountAmount)}
                </div>
              </div>

              {/* Ready to Publish Checklist */}
              <div className="promo-sidebar-card">
                <h3 className="promo-sidebar-card-title">Ready to publish?</h3>

                <div className="promo-checklist-group">
                  {/* Item 1: Offer type */}
                  <div className="promo-checklist-item">
                    <svg className="promo-check-icon complete" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                      <polyline points="22 4 12 14.01 9 11.01"></polyline>
                    </svg>
                    <div className="promo-check-details">
                      <span className="promo-check-title">Offer type</span>
                      <span className="promo-check-subtitle">{checklist.offerTypeDetail}</span>
                    </div>
                  </div>

                  {/* Item 2: Products */}
                  <div className="promo-checklist-item">
                    {checklist.isProductsReady ? (
                      <svg className="promo-check-icon complete" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                      </svg>
                    ) : (
                      <svg className="promo-check-icon incomplete" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                      </svg>
                    )}
                    <div className="promo-check-details">
                      <span className="promo-check-title">Products</span>
                      <span className="promo-check-subtitle">{checklist.productsDetail}</span>
                    </div>
                  </div>

                  {/* Item 3: Name */}
                  <div className="promo-checklist-item">
                    {checklist.isNameReady ? (
                      <svg className="promo-check-icon complete" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                      </svg>
                    ) : (
                      <svg className="promo-check-icon incomplete" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                      </svg>
                    )}
                    <div className="promo-check-details">
                      <span className="promo-check-title">Name</span>
                      <span className="promo-check-subtitle">{checklist.nameDetail}</span>
                    </div>
                  </div>

                  {/* Item 4: Schedule */}
                  <div className="promo-checklist-item">
                    {checklist.isScheduleReady ? (
                      <svg className="promo-check-icon complete" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                      </svg>
                    ) : (
                      <svg className="promo-check-icon incomplete" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                      </svg>
                    )}
                    <div className="promo-check-details">
                      <span className="promo-check-title">Schedule</span>
                      <span className="promo-check-subtitle">{checklist.scheduleDetail}</span>
                    </div>
                  </div>
                </div>

                {/* Publish & Draft Actions */}
                <div className="promo-sidebar-actions">
                  <button
                    type="button"
                    className="promo-btn-base promo-btn-primary"
                    disabled={!checklist.canPublish || actionLoading}
                    onClick={() => handleSavePromotion('active')}
                  >
                    {actionLoading ? 'Publishing...' : 'Publish promotion'}
                  </button>

                  <button
                    type="button"
                    className="promo-btn-base promo-btn-secondary"
                    disabled={actionLoading}
                    onClick={() => handleSavePromotion('draft')}
                  >
                    Save as draft
                  </button>

                  <button
                    type="button"
                    className="promo-btn-base promo-btn-link"
                    onClick={() => setScreenMode('list')}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </aside>
          </div>
        </div>

        {/* Product Selection Modal */}
        <ProductCategoryModal
          isOpen={productModalOpen}
          onClose={() => setProductModalOpen(false)}
          items={items}
          categories={categories}
          mode="single-product"
          onConfirm={handleProductSelected}
          title="Select product"
        />
      </main>
    );
  }

  // =========================================================================
  // RENDER: SCREEN 1 - PROMOTIONS LIST
  // =========================================================================
  return (
    <main className="promo-page-wrapper">
      <div className="promo-container">
        {/* 1. Header row */}
        <header className="promo-header-row">
          <div className="promo-header-titles">
            <h1>Discounts & Promotions</h1>
            <p>Create and manage offers across your branches and counters.</p>
          </div>

          <div className="promo-header-actions">
            <button
              type="button"
              className="promo-btn-base promo-btn-secondary"
              onClick={() => setShowReportsModal(true)}
              aria-label="View promotions analytics reports"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10"></line>
                <line x1="12" y1="20" x2="12" y2="4"></line>
                <line x1="6" y1="20" x2="6" y2="14"></line>
              </svg>
              Reports
            </button>

            <button
              type="button"
              className="promo-btn-base promo-btn-primary"
              onClick={handleOpenCreate}
              aria-label="Create new promotion"
            >
              + New promotion
            </button>
          </div>
        </header>

        {/* 2. Status Summary Cards (4 Equal Clickable Filter Cards) */}
        <section className="promo-status-cards-grid" aria-label="Promotion Status Filters">
          {/* Active Card */}
          <button
            type="button"
            className={`promo-status-card ${statusFilter === 'active' ? 'selected' : ''}`}
            onClick={() => setStatusFilter('active')}
            aria-pressed={statusFilter === 'active'}
          >
            <div className="promo-card-dot-row">
              <span className="promo-status-dot active"></span>
              <span>Active</span>
            </div>
            <div className="promo-card-count">{counts.active}</div>
            <div className="promo-card-hint">Running now</div>
          </button>

          {/* Scheduled Card */}
          <button
            type="button"
            className={`promo-status-card ${statusFilter === 'scheduled' ? 'selected' : ''}`}
            onClick={() => setStatusFilter('scheduled')}
            aria-pressed={statusFilter === 'scheduled'}
          >
            <div className="promo-card-dot-row">
              <span className="promo-status-dot scheduled"></span>
              <span>Scheduled</span>
            </div>
            <div className="promo-card-count">{counts.scheduled}</div>
            <div className="promo-card-hint">Starts later</div>
          </button>

          {/* Expired Card */}
          <button
            type="button"
            className={`promo-status-card ${statusFilter === 'expired' ? 'selected' : ''}`}
            onClick={() => setStatusFilter('expired')}
            aria-pressed={statusFilter === 'expired'}
          >
            <div className="promo-card-dot-row">
              <span className="promo-status-dot expired"></span>
              <span>Expired</span>
            </div>
            <div className="promo-card-count">{counts.expired}</div>
            <div className="promo-card-hint">Ended</div>
          </button>

          {/* Drafts & paused Card */}
          <button
            type="button"
            className={`promo-status-card ${statusFilter === 'draft_paused' ? 'selected' : ''}`}
            onClick={() => setStatusFilter('draft_paused')}
            aria-pressed={statusFilter === 'draft_paused'}
          >
            <div className="promo-card-dot-row">
              <span className="promo-status-dot draft_paused"></span>
              <span>Drafts & paused</span>
            </div>
            <div className="promo-card-count">{counts.draftPaused}</div>
            <div className="promo-card-hint">Not live</div>
          </button>
        </section>

        {/* 3. Main White Panel */}
        <section className="promo-main-panel" aria-label="Promotions list and filters">
          {/* a. Toolbar */}
          <div className="promo-toolbar">
            <div className="promo-search-wrapper">
              <svg className="promo-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="text"
                className="promo-search-input"
                placeholder="Search by promotion or product name"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search by promotion or product name"
              />
            </div>

            <select
              className="promo-dropdown-select"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label="Filter by promotion type"
            >
              <option value="ALL">All types</option>
              <option value="bogo">Buy X get Y free</option>
              <option value="percentage">Percentage off</option>
              <option value="flat">Flat amount off</option>
              <option value="bill_value">Bill value offer</option>
            </select>

            <select
              className="promo-dropdown-select"
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              aria-label="Filter by branch"
            >
              <option value="ALL">All branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.code || b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* b. Promotion Rows */}
          {loading ? (
            <div style={{ padding: '48px', textAlign: 'center', color: 'var(--promo-text-secondary)' }}>
              Loading promotions...
            </div>
          ) : filteredPromotions.length === 0 ? (
            /* c. Empty State */
            <div className="promo-empty-state">
              <h3>No promotions found</h3>
              <p>Try adjusting your search or filters to find what you're looking for.</p>
            </div>
          ) : (
            <div className="promo-rows-list" role="list">
              {filteredPromotions.map((p) => {
                const runs = getRunsProgress(p);
                const chipType =
                  p.type === 'bogo'
                    ? 'BOGO'
                    : p.type === 'percentage' || p.type === 'category_discount'
                    ? 'PERCENT'
                    : p.type === 'fixed_amount' || p.type === 'product_discount'
                    ? 'FLAT'
                    : 'BILL';

                const branchLabel = p.branches?.includes('ALL') || !p.branches?.length ? 'All branches' : p.branches.join(', ');
                const productLabel =
                  p.rules?.qualifyingProductName ||
                  p.rules?.categoryNames?.join(', ') ||
                  p.description ||
                  'All items';

                return (
                  <div key={p.id} className="promo-row-item" role="listitem">
                    {/* Left: Icon Tile + Names */}
                    <div className="promo-row-info-col">
                      <div className="promo-row-icon-tile">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 12 20 22 4 22 4 12"></polyline>
                          <rect x="2" y="7" width="20" height="5"></rect>
                          <line x1="12" y1="22" x2="12" y2="7"></line>
                          <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"></path>
                          <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"></path>
                        </svg>
                      </div>

                      <div className="promo-row-text-group">
                        <div className="promo-row-title-row">
                          <span className="promo-row-name">{p.name}</span>
                          <span className="promo-type-chip">{chipType}</span>
                        </div>
                        <span className="promo-row-subtitle">
                          {productLabel} · {branchLabel}
                        </span>
                      </div>
                    </div>

                    {/* Column: OFFER */}
                    <div className="promo-row-col-offer">
                      <div className="promo-col-label">OFFER</div>
                      <div className="promo-offer-rule">{getOfferRuleText(p)}</div>
                    </div>

                    {/* Column: RUNS */}
                    <div className="promo-row-col-runs">
                      <div className="promo-col-label">RUNS</div>
                      <div className="promo-runs-dates">
                        {formatDateShort(p.startDate)} – {formatDateShort(p.endDate)}
                      </div>
                      <div className="promo-runs-bar-track">
                        <div className="promo-runs-bar-fill" style={{ width: `${runs.pct}%` }}></div>
                      </div>
                      <div className="promo-runs-day-count">{runs.text}</div>
                    </div>

                    {/* Status Pill */}
                    <div>
                      <span className={`promo-status-pill ${p.status}`}>
                        ● {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                      </span>
                    </div>

                    {/* Actions: Edit, Duplicate, Pause/Activate, Delete */}
                    <div className="promo-row-actions">
                      <button
                        type="button"
                        className="promo-btn-edit-outline"
                        onClick={() => handleOpenEdit(p)}
                        aria-label={`Edit promotion ${p.name}`}
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        className="promo-icon-btn"
                        onClick={() => handleDuplicate(p)}
                        disabled={actionLoading}
                        aria-label={`Duplicate promotion ${p.name}`}
                        title="Duplicate"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                      </button>

                      <button
                        type="button"
                        className="promo-icon-btn"
                        onClick={() => handleToggleStatus(p)}
                        disabled={actionLoading}
                        aria-label={p.status === 'paused' ? `Activate promotion ${p.name}` : `Pause promotion ${p.name}`}
                        title={p.status === 'paused' ? 'Activate' : 'Pause'}
                      >
                        {p.status === 'paused' ? (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="5 3 19 12 5 21 5 3"></polygon>
                          </svg>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="6" y="4" width="4" height="16"></rect>
                            <rect x="14" y="4" width="4" height="16"></rect>
                          </svg>
                        )}
                      </button>

                      <button
                        type="button"
                        className="promo-icon-btn delete"
                        onClick={() => handleDelete(p)}
                        disabled={actionLoading}
                        aria-label={`Delete promotion ${p.name}`}
                        title="Delete"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* d. Footer strip */}
          <footer className="promo-footer-strip">
            <span>
              Showing {filteredPromotions.length}{' '}
              {statusFilter === 'active'
                ? 'active'
                : statusFilter === 'scheduled'
                ? 'scheduled'
                : statusFilter === 'expired'
                ? 'expired'
                : statusFilter === 'draft_paused'
                ? 'draft/paused'
                : ''}{' '}
              {filteredPromotions.length === 1 ? 'promotion' : 'promotions'}
            </span>
          </footer>
        </section>
      </div>

      {/* Reports Analytics Modal */}
      {showReportsModal && (
        <PromotionReportsModal
          isOpen={showReportsModal}
          onClose={() => setShowReportsModal(false)}
          branches={branches}
        />
      )}
    </main>
  );
}
