import React, { useState, useEffect, useMemo } from 'react';
import {
  fetchPromotions,
  createPromotion,
  updatePromotion,
  duplicatePromotion,
  updatePromotionStatus,
  deletePromotion,
  type Promotion,
  type PromotionInput,
  type PromotionType,
  type PromotionStatus,
  type PromotionSummary,
  type Item,
  type Category,
  type Branch,
  type Party,
  type User,
} from '../../api';
import { ProductCategoryModal } from './ProductCategoryModal';
import { PromotionReportsModal } from './PromotionReportsModal';
import './promotions.css';

interface DiscountsPromotionsViewProps {
  user: User;
  items: Item[];
  categories: Category[];
  branches: Branch[];
  parties: Party[];
  onOpenPos?: () => void;
}

const DEFAULT_PROMO_INPUT: PromotionInput = {
  name: '',
  description: '',
  type: 'bogo',
  startDate: new Date().toISOString().slice(0, 10),
  endDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  branches: ['ALL'],
  counters: ['ALL'],
  status: 'active',
  rules: {
    qualifyingQty: 2,
    freeQty: 1,
    sameProduct: true,
    discountPct: 10,
    discountAmountMinor: 5000,
    minPurchaseQty: 1,
    minBillAmountMinor: 0,
    slabs: [
      { minQty: 3, discountPct: 5 },
      { minQty: 6, discountPct: 10 },
      { minQty: 12, discountPct: 15 },
    ],
  },
  customerEligibilityType: 'all',
  eligibleCustomerIds: [],
  maxTotalUsage: null,
  maxUsagePerCustomer: null,
  showBannerOnPos: true,
  allowStacking: false,
  minBillAmountMinor: 0,
  maxDiscountMinor: null,
};

export function DiscountsPromotionsView({
  user,
  items,
  categories,
  branches,
  parties,
}: DiscountsPromotionsViewProps) {
  // Navigation & Filter State
  const [activeTab, setActiveTab] = useState<PromotionStatus | 'all'>('active');
  const [search, setSearch] = useState('');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState('ALL');
  const [selectedBranchFilter, setSelectedBranchFilter] = useState('ALL');

  // Promotions List State
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [summary, setSummary] = useState<PromotionSummary>({
    totalPromotions: 0,
    activePromotions: 0,
    scheduledPromotions: 0,
    expiredPromotions: 0,
    draftPromotions: 0,
    pausedPromotions: 0,
    totalDiscountGivenMinor: 0,
    salesGeneratedMinor: 0,
  });
  const [loading, setLoading] = useState(false);

  // Wizard & Form State
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [editingPromoId, setEditingPromoId] = useState<string | null>(null);
  const [formData, setFormData] = useState<PromotionInput>(DEFAULT_PROMO_INPUT);
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Modals & Panels State
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [productModalTarget, setProductModalTarget] = useState<'qualifying' | 'free' | 'general'>('general');
  const [isReportsOpen, setIsReportsOpen] = useState(false);
  const [isSettingsExpanded, setIsSettingsExpanded] = useState(false);

  // Load Promotions from API
  const loadPromotionsList = async () => {
    setLoading(true);
    try {
      const res = await fetchPromotions({
        search,
        type: selectedTypeFilter,
        status: activeTab,
        branch: selectedBranchFilter,
      });
      setPromotions(res.promotions || []);
      if (res.summary) setSummary(res.summary);
    } catch (err) {
      console.error('Failed to load promotions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPromotionsList();
  }, [activeTab, search, selectedTypeFilter, selectedBranchFilter]);

  // Set default product for BOGO if available
  useEffect(() => {
    if (!formData.rules.qualifyingProductId && items.length > 0) {
      const defaultItem = items.find((i) => i.name.toLowerCase().includes('biscuit')) || items[0];
      setFormData((prev) => ({
        ...prev,
        rules: {
          ...prev.rules,
          qualifyingProductId: defaultItem.id,
          qualifyingProductName: defaultItem.name,
          freeProductId: defaultItem.id,
          freeProductName: defaultItem.name,
        },
      }));
    }
  }, [items]);

  // Derived selected items for visual cards in right column
  const qualifyingProduct = useMemo(
    () => items.find((i) => i.id === formData.rules.qualifyingProductId),
    [items, formData.rules.qualifyingProductId]
  );

  const freeProduct = useMemo(
    () => items.find((i) => i.id === formData.rules.freeProductId),
    [items, formData.rules.freeProductId]
  );

  // Wizard Handlers
  const handleResetForm = () => {
    setEditingPromoId(null);
    setStep(1);
    setFormError(null);
    const defaultItem = items.find((i) => i.name.toLowerCase().includes('biscuit')) || items[0];
    setFormData({
      ...DEFAULT_PROMO_INPUT,
      rules: {
        ...DEFAULT_PROMO_INPUT.rules,
        qualifyingProductId: defaultItem?.id,
        qualifyingProductName: defaultItem?.name,
        freeProductId: defaultItem?.id,
        freeProductName: defaultItem?.name,
      },
    });
  };

  const handleEditPromotion = (p: Promotion) => {
    setEditingPromoId(p.id);
    setStep(1);
    setFormError(null);
    setFormData({
      name: p.name,
      description: p.description,
      type: p.type,
      startDate: p.startDate,
      endDate: p.endDate,
      branches: p.branches,
      counters: p.counters,
      status: p.status,
      rules: { ...p.rules },
      customerEligibilityType: p.customerEligibilityType,
      eligibleCustomerIds: p.eligibleCustomerIds,
      maxTotalUsage: p.maxTotalUsage,
      maxUsagePerCustomer: p.maxUsagePerCustomer,
      showBannerOnPos: p.showBannerOnPos,
      allowStacking: p.allowStacking,
      minBillAmountMinor: p.minBillAmountMinor,
      maxDiscountMinor: p.maxDiscountMinor,
    });
  };

  const handleDuplicatePromotion = async (p: Promotion) => {
    try {
      await duplicatePromotion(p.id);
      loadPromotionsList();
    } catch (err: any) {
      alert(err.message || 'Failed to duplicate promotion');
    }
  };

  const handleToggleStatus = async (p: Promotion) => {
    const nextStatus: PromotionStatus = p.status === 'active' ? 'paused' : 'active';
    try {
      await updatePromotionStatus(p.id, nextStatus);
      loadPromotionsList();
    } catch (err: any) {
      alert(err.message || 'Failed to update promotion status');
    }
  };

  const handleDeletePromotion = async (p: Promotion) => {
    if (!confirm(`Are you sure you want to delete "${p.name}"?`)) return;
    try {
      await deletePromotion(p.id);
      if (editingPromoId === p.id) handleResetForm();
      loadPromotionsList();
    } catch (err: any) {
      alert(err.message || 'Failed to delete promotion');
    }
  };

  const handleSavePromotion = async () => {
    if (!formData.name.trim()) {
      setFormError('Please enter a promotion name.');
      setStep(1);
      return;
    }
    if (!formData.startDate || !formData.endDate) {
      setFormError('Please select both start and end dates.');
      setStep(1);
      return;
    }
    if (formData.endDate < formData.startDate) {
      setFormError('End date cannot be earlier than start date.');
      setStep(1);
      return;
    }

    setIsSaving(true);
    setFormError(null);
    try {
      if (editingPromoId) {
        await updatePromotion(editingPromoId, formData);
      } else {
        await createPromotion(formData);
      }
      handleResetForm();
      loadPromotionsList();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save promotion');
    } finally {
      setIsSaving(false);
    }
  };

  // Open Product Modal
  const openProductPicker = (target: 'qualifying' | 'free' | 'general') => {
    setProductModalTarget(target);
    setIsProductModalOpen(true);
  };

  const handleProductModalConfirm = (res: {
    productIds: string[];
    categoryNames: string[];
    singleProduct?: Item;
  }) => {
    if (productModalTarget === 'qualifying') {
      if (res.singleProduct) {
        setFormData((prev) => ({
          ...prev,
          rules: {
            ...prev.rules,
            qualifyingProductId: res.singleProduct?.id,
            qualifyingProductName: res.singleProduct?.name,
            freeProductId: prev.rules.sameProduct ? res.singleProduct?.id : prev.rules.freeProductId,
            freeProductName: prev.rules.sameProduct ? res.singleProduct?.name : prev.rules.freeProductName,
          },
        }));
      }
    } else if (productModalTarget === 'free') {
      if (res.singleProduct) {
        setFormData((prev) => ({
          ...prev,
          rules: {
            ...prev.rules,
            freeProductId: res.singleProduct?.id,
            freeProductName: res.singleProduct?.name,
          },
        }));
      }
    } else {
      setFormData((prev) => ({
        ...prev,
        rules: {
          ...prev.rules,
          productIds: res.productIds,
          categoryNames: res.categoryNames,
        },
      }));
    }
  };

  return (
    <div className="promotions-container">
      {/* Page Header */}
      <div className="promo-page-header">
        <div className="promo-title-area">
          <h1>Discounts &amp; Promotions</h1>
          <p>Create and manage offers, discounts and special promotions</p>
        </div>
      </div>

      {/* Main 3-Column SaaS Layout */}
      <div className="promo-layout-grid">
        {/* =========================================================================
            COLUMN 1: Promotions List & Filters (Left)
           ========================================================================= */}
        <div className="promo-card promo-col-left">
          {/* Top Status Tabs */}
          <div className="promo-top-actions">
            <div className="promo-status-pills">
              <button
                type="button"
                className={`promo-pill-tab ${activeTab === 'active' ? 'active' : ''}`}
                onClick={() => setActiveTab('active')}
              >
                Active Promotions
                <span className="promo-pill-badge">{summary.activePromotions}</span>
              </button>
              <button
                type="button"
                className={`promo-pill-tab ${activeTab === 'scheduled' ? 'active' : ''}`}
                onClick={() => setActiveTab('scheduled')}
              >
                Scheduled
                <span className="promo-pill-badge">{summary.scheduledPromotions}</span>
              </button>
              <button
                type="button"
                className={`promo-pill-tab ${activeTab === 'expired' ? 'active' : ''}`}
                onClick={() => setActiveTab('expired')}
              >
                Expired
                <span className="promo-pill-badge">{summary.expiredPromotions}</span>
              </button>
              <button
                type="button"
                className={`promo-pill-tab ${activeTab === 'draft' ? 'active' : ''}`}
                onClick={() => setActiveTab('draft')}
              >
                Draft
                <span className="promo-pill-badge">{summary.draftPromotions}</span>
              </button>
              <button
                type="button"
                className={`promo-pill-tab ${activeTab === 'paused' ? 'active' : ''}`}
                onClick={() => setActiveTab('paused')}
              >
                Paused
                <span className="promo-pill-badge">{summary.pausedPromotions}</span>
              </button>
            </div>

            <div className="promo-action-buttons-row">
              <button
                type="button"
                className="promo-btn-outline"
                onClick={handleResetForm}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                + Create Promotion
              </button>

              <button
                type="button"
                className="promo-btn-reports"
                onClick={() => setIsReportsOpen(true)}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="20" x2="18" y2="10"></line>
                  <line x1="12" y1="20" x2="12" y2="4"></line>
                  <line x1="6" y1="20" x2="6" y2="14"></line>
                </svg>
                Reports
              </button>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="promo-list-filters">
            <div className="promo-search-box">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="text"
                placeholder="Search promotions by name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <select
              value={selectedTypeFilter}
              onChange={(e) => setSelectedTypeFilter(e.target.value)}
              className="promo-filter-select"
            >
              <option value="ALL">All Types</option>
              <option value="bogo">BOGO</option>
              <option value="percentage">Percentage Discount</option>
              <option value="fixed_amount">Fixed Amount</option>
              <option value="category_discount">Category Discount</option>
              <option value="product_discount">Product Discount</option>
              <option value="quantity_based">Volume Slabs</option>
              <option value="bill_level">Bill Level</option>
            </select>

            <select
              value={selectedBranchFilter}
              onChange={(e) => setSelectedBranchFilter(e.target.value)}
              className="promo-filter-select"
            >
              <option value="ALL">All Branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.code}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {/* Promotions Table */}
          <div className="promo-table-container">
            <table className="promo-table">
              <thead>
                <tr>
                  <th>Promotion Name</th>
                  <th>Type</th>
                  <th>Validity</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '1.5rem', color: '#64748b' }}>
                      Loading promotions...
                    </td>
                  </tr>
                ) : promotions.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '1.5rem', color: '#64748b' }}>
                      No promotions found in this view. Click <strong>+ Create Promotion</strong> to create one.
                    </td>
                  </tr>
                ) : (
                  promotions.map((p) => {
                    const initials = p.name
                      .split(' ')
                      .slice(0, 2)
                      .map((w) => w[0]?.toUpperCase())
                      .join('');

                    return (
                      <tr
                        key={p.id}
                        className={editingPromoId === p.id ? 'active-row' : ''}
                        onClick={() => handleEditPromotion(p)}
                      >
                        <td>
                          <div className="promo-name-cell">
                            <div className="promo-avatar">{initials || 'PR'}</div>
                            <div>
                              <div className="promo-title-text">{p.name}</div>
                              <div className="promo-sub-text">
                                {p.rules.categoryNames?.join(', ') ||
                                  p.rules.qualifyingProductName ||
                                  (p.branches.includes('ALL') ? 'All Products' : p.branches.join(', '))}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="promo-badge-type">
                            {p.type === 'bogo'
                              ? 'BOGO'
                              : p.type === 'percentage'
                              ? 'PERCENT'
                              : p.type.toUpperCase().replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontSize: '0.78rem', color: '#334155' }}>
                            {p.startDate}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                            to {p.endDate}
                          </div>
                        </td>
                        <td>
                          <span className={`promo-status-badge status-${p.status}`}>
                            {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                          </span>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div className="promo-actions-cell">
                            <button
                              type="button"
                              className="promo-icon-btn"
                              title="Edit Promotion"
                              onClick={() => handleEditPromotion(p)}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                              </svg>
                            </button>
                            <button
                              type="button"
                              className="promo-icon-btn"
                              title="Duplicate Promotion"
                              onClick={() => handleDuplicatePromotion(p)}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                              </svg>
                            </button>
                            <button
                              type="button"
                              className="promo-icon-btn"
                              title={p.status === 'active' ? 'Pause Promotion' : 'Activate Promotion'}
                              onClick={() => handleToggleStatus(p)}
                            >
                              {p.status === 'active' ? (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <rect x="6" y="4" width="4" height="16"></rect>
                                  <rect x="14" y="4" width="4" height="16"></rect>
                                </svg>
                              ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                                </svg>
                              )}
                            </button>
                            <button
                              type="button"
                              className="promo-icon-btn danger"
                              title="Delete Promotion"
                              onClick={() => handleDeletePromotion(p)}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* =========================================================================
            COLUMN 2: Create Promotion – Three-Step Wizard (Middle)
           ========================================================================= */}
        <div className="promo-card promo-col-middle">
          <div className="promo-card-header">
            <h2 className="promo-card-title">
              {editingPromoId ? 'Edit Promotion' : 'Create Promotion'}
            </h2>
          </div>

          {/* Stepper Header */}
          <div className="promo-stepper">
            <div
              className={`promo-step-item ${step === 1 ? 'active' : step > 1 ? 'completed' : ''}`}
              onClick={() => setStep(1)}
            >
              <div className="promo-step-circle">1</div>
              <span className="promo-step-label">Basic Details</span>
            </div>

            <div
              className={`promo-step-item ${step === 2 ? 'active' : step > 2 ? 'completed' : ''}`}
              onClick={() => setStep(2)}
            >
              <div className="promo-step-circle">2</div>
              <span className="promo-step-label">Products &amp; Rules</span>
            </div>

            <div
              className={`promo-step-item ${step === 3 ? 'active' : ''}`}
              onClick={() => setStep(3)}
            >
              <div className="promo-step-circle">3</div>
              <span className="promo-step-label">Review</span>
            </div>
          </div>

          {formError && (
            <div
              style={{
                background: '#fee2e2',
                color: '#b91c1c',
                padding: '0.65rem 0.85rem',
                borderRadius: '8px',
                fontSize: '0.82rem',
                marginBottom: '1rem',
              }}
            >
              {formError}
            </div>
          )}

          {/* STEP 1: Basic Details */}
          {step === 1 && (
            <div>
              <div className="promo-form-group">
                <label className="promo-label">
                  Promotion Name <span className="req">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Enter promotion name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="promo-input"
                />
              </div>

              <div className="promo-form-group">
                <label className="promo-label">Promotion Description</label>
                <input
                  type="text"
                  placeholder="Optional brief description"
                  value={formData.description || ''}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="promo-input"
                />
              </div>

              <div className="promo-form-group">
                <label className="promo-label">
                  Promotion Type <span className="req">*</span>
                </label>
                <select
                  value={formData.type}
                  onChange={(e) => {
                    const newType = e.target.value as PromotionType;
                    setFormData({
                      ...formData,
                      type: newType,
                    });
                  }}
                  className="promo-select"
                >
                  <option value="bogo">Buy X Get Y (BOGO Free)</option>
                  <option value="percentage">Percentage Discount</option>
                  <option value="fixed_amount">Fixed Amount Discount</option>
                  <option value="buy_x_get_y_discount">Buy X Get Y at Discounted Price</option>
                  <option value="category_discount">Category-Wise Discount</option>
                  <option value="product_discount">Product-Wise Discount</option>
                  <option value="min_purchase">Minimum Purchase Discount</option>
                  <option value="quantity_based">Quantity-Based Discount (Tier Slabs)</option>
                  <option value="bill_level">Bill-Level Discount</option>
                </select>
              </div>

              <div className="promo-dates-row promo-form-group">
                <div>
                  <label className="promo-label">
                    Start Date <span className="req">*</span>
                  </label>
                  <input
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    className="promo-input"
                  />
                </div>
                <div>
                  <label className="promo-label">
                    End Date <span className="req">*</span>
                  </label>
                  <input
                    type="date"
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    className="promo-input"
                  />
                </div>
              </div>

              <div className="promo-form-group">
                <label className="promo-label">Applicable Branches</label>
                <select
                  value={formData.branches?.[0] || 'ALL'}
                  onChange={(e) => setFormData({ ...formData, branches: [e.target.value] })}
                  className="promo-select"
                >
                  <option value="ALL">All Branches</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.code}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="promo-form-group">
                <label className="promo-label">Applicable Counters</label>
                <select
                  value={formData.counters?.[0] || 'ALL'}
                  onChange={(e) => setFormData({ ...formData, counters: [e.target.value] })}
                  className="promo-select"
                >
                  <option value="ALL">All Counters</option>
                  <option value="COUNTER-1">Counter 1</option>
                  <option value="COUNTER-2">Counter 2</option>
                  <option value="COUNTER-3">Counter 3</option>
                </select>
              </div>

              <div className="promo-form-group">
                <label className="promo-label">Status</label>
                <div className="promo-status-segmented">
                  {(['draft', 'scheduled', 'active', 'paused'] as PromotionStatus[]).map((st) => (
                    <button
                      key={st}
                      type="button"
                      className={`promo-seg-btn ${formData.status === st ? 'active' : ''}`}
                      onClick={() => setFormData({ ...formData, status: st })}
                    >
                      {st.charAt(0).toUpperCase() + st.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="promo-wizard-actions">
                <div></div>
                <button
                  type="button"
                  className="promo-btn-primary"
                  onClick={() => setStep(2)}
                >
                  Next: Products &amp; Rules &rarr;
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Products & Rules */}
          {step === 2 && (
            <div>
              {/* Dynamic Form based on Type */}
              {formData.type === 'bogo' && (
                <div>
                  <div className="promo-form-group">
                    <label className="promo-label">BOGO Qualifying Rule</label>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="promo-btn-outline"
                        onClick={() => openProductPicker('qualifying')}
                      >
                        Choose Qualifying Product
                      </button>
                      <span style={{ fontSize: '0.84rem', color: '#475569' }}>
                        {qualifyingProduct?.name || 'No product chosen'}
                      </span>
                    </div>
                  </div>

                  <div className="promo-dates-row promo-form-group">
                    <div>
                      <label className="promo-label">Qualifying Quantity (Buy X)</label>
                      <input
                        type="number"
                        min="1"
                        value={formData.rules.qualifyingQty || 1}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            rules: {
                              ...formData.rules,
                              qualifyingQty: Math.max(1, parseInt(e.target.value) || 1),
                            },
                          })
                        }
                        className="promo-input"
                      />
                    </div>
                    <div>
                      <label className="promo-label">Free Quantity (Get Y)</label>
                      <input
                        type="number"
                        min="1"
                        value={formData.rules.freeQty || 1}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            rules: {
                              ...formData.rules,
                              freeQty: Math.max(1, parseInt(e.target.value) || 1),
                            },
                          })
                        }
                        className="promo-input"
                      />
                    </div>
                  </div>

                  <div className="promo-form-group">
                    <label className="promo-label">Free Product Option</label>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.25rem' }}>
                      <label style={{ fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <input
                          type="radio"
                          name="sameProductChoice"
                          checked={formData.rules.sameProduct !== false}
                          onChange={() =>
                            setFormData({
                              ...formData,
                              rules: {
                                ...formData.rules,
                                sameProduct: true,
                                freeProductId: formData.rules.qualifyingProductId,
                                freeProductName: formData.rules.qualifyingProductName,
                              },
                            })
                          }
                        />
                        Same as Qualifying Product
                      </label>
                      <label style={{ fontSize: '0.84rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <input
                          type="radio"
                          name="sameProductChoice"
                          checked={formData.rules.sameProduct === false}
                          onChange={() =>
                            setFormData({
                              ...formData,
                              rules: { ...formData.rules, sameProduct: false },
                            })
                          }
                        />
                        Different Free Product
                      </label>
                    </div>

                    {formData.rules.sameProduct === false && (
                      <div style={{ marginTop: '0.65rem' }}>
                        <button
                          type="button"
                          className="promo-btn-outline"
                          onClick={() => openProductPicker('free')}
                        >
                          Choose Free Item
                        </button>
                        <span style={{ fontSize: '0.84rem', color: '#475569', marginLeft: '0.5rem' }}>
                          {freeProduct?.name || 'No free product chosen'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {formData.type === 'percentage' && (
                <div>
                  <div className="promo-form-group">
                    <label className="promo-label">Applicable Products &amp; Categories</label>
                    <button
                      type="button"
                      className="promo-btn-outline"
                      onClick={() => openProductPicker('general')}
                    >
                      Select Products &amp; Categories ({(formData.rules.productIds?.length || 0) + (formData.rules.categoryNames?.length || 0)} selected)
                    </button>
                  </div>

                  <div className="promo-dates-row promo-form-group">
                    <div>
                      <label className="promo-label">Discount Percentage (%) <span className="req">*</span></label>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={formData.rules.discountPct || 10}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            rules: {
                              ...formData.rules,
                              discountPct: Math.min(100, Math.max(1, parseInt(e.target.value) || 0)),
                            },
                          })
                        }
                        className="promo-input"
                      />
                    </div>
                    <div>
                      <label className="promo-label">Max Discount Cap (₹)</label>
                      <input
                        type="number"
                        min="0"
                        placeholder="Optional max cap"
                        value={formData.rules.maxDiscountMinor ? formData.rules.maxDiscountMinor / 100 : ''}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            rules: {
                              ...formData.rules,
                              maxDiscountMinor: e.target.value ? Math.round(parseFloat(e.target.value) * 100) : undefined,
                            },
                          })
                        }
                        className="promo-input"
                      />
                    </div>
                  </div>

                  <div className="promo-dates-row promo-form-group">
                    <div>
                      <label className="promo-label">Min Purchase Quantity</label>
                      <input
                        type="number"
                        min="1"
                        value={formData.rules.minPurchaseQty || 1}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            rules: {
                              ...formData.rules,
                              minPurchaseQty: Math.max(1, parseInt(e.target.value) || 1),
                            },
                          })
                        }
                        className="promo-input"
                      />
                    </div>
                    <div>
                      <label className="promo-label">Min Bill Amount (₹)</label>
                      <input
                        type="number"
                        min="0"
                        placeholder="0 for none"
                        value={formData.rules.minBillAmountMinor ? formData.rules.minBillAmountMinor / 100 : ''}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            rules: {
                              ...formData.rules,
                              minBillAmountMinor: e.target.value ? Math.round(parseFloat(e.target.value) * 100) : 0,
                            },
                          })
                        }
                        className="promo-input"
                      />
                    </div>
                  </div>
                </div>
              )}

              {formData.type === 'fixed_amount' && (
                <div>
                  <div className="promo-form-group">
                    <label className="promo-label">Applicable Products &amp; Categories</label>
                    <button
                      type="button"
                      className="promo-btn-outline"
                      onClick={() => openProductPicker('general')}
                    >
                      Select Products &amp; Categories ({(formData.rules.productIds?.length || 0) + (formData.rules.categoryNames?.length || 0)} selected)
                    </button>
                  </div>

                  <div className="promo-dates-row promo-form-group">
                    <div>
                      <label className="promo-label">Flat Discount Amount (₹) <span className="req">*</span></label>
                      <input
                        type="number"
                        min="1"
                        value={(formData.rules.discountAmountMinor || 5000) / 100}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            rules: {
                              ...formData.rules,
                              discountAmountMinor: Math.round(parseFloat(e.target.value || '0') * 100),
                            },
                          })
                        }
                        className="promo-input"
                      />
                    </div>
                    <div>
                      <label className="promo-label">Min Purchase Amount (₹)</label>
                      <input
                        type="number"
                        min="0"
                        value={(formData.rules.minBillAmountMinor || 0) / 100}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            rules: {
                              ...formData.rules,
                              minBillAmountMinor: Math.round(parseFloat(e.target.value || '0') * 100),
                            },
                          })
                        }
                        className="promo-input"
                      />
                    </div>
                  </div>
                </div>
              )}

              {formData.type === 'category_discount' && (
                <div>
                  <div className="promo-form-group">
                    <label className="promo-label">Select Categories</label>
                    <button
                      type="button"
                      className="promo-btn-outline"
                      onClick={() => openProductPicker('general')}
                    >
                      Pick Categories ({formData.rules.categoryNames?.length || 0} selected)
                    </button>
                    {formData.rules.categoryNames && formData.rules.categoryNames.length > 0 && (
                      <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                        {formData.rules.categoryNames.map((c) => (
                          <span key={c} className="promo-item-tag">
                            {c}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="promo-dates-row promo-form-group">
                    <div>
                      <label className="promo-label">Discount Percentage (%)</label>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={formData.rules.discountPct || 10}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            rules: {
                              ...formData.rules,
                              discountPct: parseInt(e.target.value) || 0,
                            },
                          })
                        }
                        className="promo-input"
                      />
                    </div>
                    <div>
                      <label className="promo-label">Min Purchase Quantity</label>
                      <input
                        type="number"
                        min="1"
                        value={formData.rules.minPurchaseQty || 1}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            rules: {
                              ...formData.rules,
                              minPurchaseQty: parseInt(e.target.value) || 1,
                            },
                          })
                        }
                        className="promo-input"
                      />
                    </div>
                  </div>
                </div>
              )}

              {formData.type === 'product_discount' && (
                <div>
                  <div className="promo-form-group">
                    <label className="promo-label">Select Target Products</label>
                    <button
                      type="button"
                      className="promo-btn-outline"
                      onClick={() => openProductPicker('general')}
                    >
                      Choose Products ({formData.rules.productIds?.length || 0} selected)
                    </button>
                  </div>

                  <div className="promo-dates-row promo-form-group">
                    <div>
                      <label className="promo-label">Discount Percentage (%)</label>
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={formData.rules.discountPct || 10}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            rules: {
                              ...formData.rules,
                              discountPct: parseInt(e.target.value) || 0,
                            },
                          })
                        }
                        className="promo-input"
                      />
                    </div>
                    <div>
                      <label className="promo-label">OR Flat Discount (₹)</label>
                      <input
                        type="number"
                        min="0"
                        value={(formData.rules.discountAmountMinor || 0) / 100}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            rules: {
                              ...formData.rules,
                              discountAmountMinor: Math.round(parseFloat(e.target.value || '0') * 100),
                            },
                          })
                        }
                        className="promo-input"
                      />
                    </div>
                  </div>
                </div>
              )}

              {formData.type === 'quantity_based' && (
                <div>
                  <div className="promo-form-group">
                    <label className="promo-label">Volume Tier Slabs</label>
                    <table className="promo-slabs-table">
                      <thead>
                        <tr>
                          <th>Min Quantity</th>
                          <th>Discount (%)</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(formData.rules.slabs || []).map((s, idx) => (
                          <tr key={idx}>
                            <td>
                              <input
                                type="number"
                                min="1"
                                value={s.minQty}
                                onChange={(e) => {
                                  const updated = [...(formData.rules.slabs || [])];
                                  updated[idx] = { ...updated[idx], minQty: parseInt(e.target.value) || 1 };
                                  setFormData({ ...formData, rules: { ...formData.rules, slabs: updated } });
                                }}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min="1"
                                max="100"
                                value={s.discountPct || 0}
                                onChange={(e) => {
                                  const updated = [...(formData.rules.slabs || [])];
                                  updated[idx] = { ...updated[idx], discountPct: parseInt(e.target.value) || 0 };
                                  setFormData({ ...formData, rules: { ...formData.rules, slabs: updated } });
                                }}
                              />
                            </td>
                            <td>
                              <button
                                type="button"
                                className="promo-btn-link"
                                style={{ color: '#ef4444' }}
                                onClick={() => {
                                  const updated = (formData.rules.slabs || []).filter((_, i) => i !== idx);
                                  setFormData({ ...formData, rules: { ...formData.rules, slabs: updated } });
                                }}
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <button
                      type="button"
                      className="promo-btn-outline"
                      style={{ marginTop: '0.5rem' }}
                      onClick={() => {
                        const slabs = formData.rules.slabs || [];
                        const lastMin = slabs.length > 0 ? slabs[slabs.length - 1].minQty : 1;
                        setFormData({
                          ...formData,
                          rules: {
                            ...formData.rules,
                            slabs: [...slabs, { minQty: lastMin + 5, discountPct: 15 }],
                          },
                        });
                      }}
                    >
                      + Add Slab
                    </button>
                  </div>
                </div>
              )}

              {(formData.type === 'bill_level' || formData.type === 'min_purchase') && (
                <div>
                  <div className="promo-form-group">
                    <label className="promo-label">Minimum Bill Amount (₹) <span className="req">*</span></label>
                    <input
                      type="number"
                      min="1"
                      value={(formData.rules.minBillAmountMinor || 50000) / 100}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          rules: {
                            ...formData.rules,
                            minBillAmountMinor: Math.round(parseFloat(e.target.value || '0') * 100),
                          },
                        })
                      }
                      className="promo-input"
                    />
                  </div>

                  <div className="promo-dates-row promo-form-group">
                    <div>
                      <label className="promo-label">Discount Percentage (%)</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={formData.rules.discountPct || 10}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            rules: {
                              ...formData.rules,
                              discountPct: parseInt(e.target.value) || 0,
                            },
                          })
                        }
                        className="promo-input"
                      />
                    </div>
                    <div>
                      <label className="promo-label">OR Flat Discount (₹)</label>
                      <input
                        type="number"
                        min="0"
                        value={(formData.rules.discountAmountMinor || 0) / 100}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            rules: {
                              ...formData.rules,
                              discountAmountMinor: Math.round(parseFloat(e.target.value || '0') * 100),
                            },
                          })
                        }
                        className="promo-input"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="promo-wizard-actions">
                <button
                  type="button"
                  className="promo-btn-secondary"
                  onClick={() => setStep(1)}
                >
                  &larr; Back
                </button>
                <button
                  type="button"
                  className="promo-btn-primary"
                  onClick={() => setStep(3)}
                >
                  Next: Review &rarr;
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Review & Save */}
          {step === 3 && (
            <div>
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.65rem',
                  fontSize: '0.86rem',
                }}
              >
                <div>
                  <span style={{ color: '#64748b' }}>Promotion Name: </span>
                  <strong>{formData.name}</strong>
                </div>

                <div>
                  <span style={{ color: '#64748b' }}>Type: </span>
                  <span className="promo-badge-type">{formData.type.toUpperCase().replace(/_/g, ' ')}</span>
                </div>

                <div>
                  <span style={{ color: '#64748b' }}>Validity: </span>
                  <strong>{formData.startDate}</strong> to <strong>{formData.endDate}</strong>
                </div>

                <div>
                  <span style={{ color: '#64748b' }}>Branches: </span>
                  <strong>{(formData.branches || ['ALL']).join(', ')}</strong>
                </div>

                <div>
                  <span style={{ color: '#64748b' }}>Rule Summary: </span>
                  {formData.type === 'bogo' ? (
                    <span>
                      Buy {formData.rules.qualifyingQty} of {qualifyingProduct?.name || 'Selected Item'} &rarr; Get{' '}
                      {formData.rules.freeQty} Free
                    </span>
                  ) : formData.type === 'percentage' ? (
                    <span>{formData.rules.discountPct}% Discount on eligible items</span>
                  ) : (
                    <span>Configured promotional rules</span>
                  )}
                </div>

                <div>
                  <span style={{ color: '#64748b' }}>Stackable with other offers: </span>
                  <strong>{formData.allowStacking ? 'Yes' : 'No'}</strong>
                </div>
              </div>

              <div className="promo-wizard-actions">
                <button
                  type="button"
                  className="promo-btn-secondary"
                  onClick={() => setStep(2)}
                >
                  &larr; Back
                </button>
                <button
                  type="button"
                  className="promo-btn-primary"
                  onClick={handleSavePromotion}
                  disabled={isSaving}
                >
                  {isSaving ? 'Saving...' : editingPromoId ? 'Update Promotion' : 'Save & Activate'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* =========================================================================
            COLUMN 3: Dynamic Promotion Configuration Panel (Right Column)
           ========================================================================= */}
        <div className="promo-card promo-col-right">
          <div className="promo-config-title">
            Promotion Configuration ({formData.type === 'bogo' ? 'BOGO' : formData.type.toUpperCase().replace(/_/g, ' ')})
          </div>

          {/* BOGO Interactive Configuration Cards */}
          {formData.type === 'bogo' ? (
            <>
              {/* Qualifying Product Card */}
              <div className="promo-form-group">
                <label className="promo-label">Qualifying Product *</label>
                <div className="promo-product-card">
                  <div className="promo-product-card-left">
                    <div className="promo-product-icon-box">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                        <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                        <line x1="12" y1="22.08" x2="12" y2="12"></line>
                      </svg>
                    </div>
                    <div>
                      <div className="promo-product-title">{qualifyingProduct?.name || 'Biscuits'}</div>
                      <div className="promo-product-sub">
                        SKU: {qualifyingProduct?.sku || 'BSC001'} | HSN: {qualifyingProduct?.hsn || '1905'} | ₹
                        {((qualifyingProduct?.priceMinor || 5000) / 100).toFixed(2)}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="promo-change-btn"
                    onClick={() => openProductPicker('qualifying')}
                  >
                    Change
                  </button>
                </div>
              </div>

              {/* Qualifying Quantity Stepper */}
              <div className="promo-form-group">
                <label className="promo-label">Qualifying Quantity *</label>
                <div className="promo-stepper-counter">
                  <button
                    type="button"
                    className="promo-counter-btn"
                    onClick={() =>
                      setFormData({
                        ...formData,
                        rules: {
                          ...formData.rules,
                          qualifyingQty: Math.max(1, (formData.rules.qualifyingQty || 1) - 1),
                        },
                      })
                    }
                  >
                    &minus;
                  </button>
                  <span className="promo-counter-val">{formData.rules.qualifyingQty || 1}</span>
                  <button
                    type="button"
                    className="promo-counter-btn"
                    onClick={() =>
                      setFormData({
                        ...formData,
                        rules: {
                          ...formData.rules,
                          qualifyingQty: (formData.rules.qualifyingQty || 1) + 1,
                        },
                      })
                    }
                  >
                    +
                  </button>
                  <span className="promo-counter-hint">(Buy {formData.rules.qualifyingQty || 1})</span>
                </div>
              </div>

              {/* Free Product Card */}
              <div className="promo-form-group" style={{ marginTop: '1rem' }}>
                <label className="promo-label">Free Product *</label>
                <div className="promo-product-card">
                  <div className="promo-product-card-left">
                    <div className="promo-product-icon-box">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                        <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                        <line x1="12" y1="22.08" x2="12" y2="12"></line>
                      </svg>
                    </div>
                    <div>
                      <div className="promo-product-title">
                        {formData.rules.sameProduct ? qualifyingProduct?.name || 'Biscuits' : freeProduct?.name || 'Biscuits'}
                      </div>
                      <div className="promo-product-sub">
                        SKU: {qualifyingProduct?.sku || 'BSC001'} | HSN: {qualifyingProduct?.hsn || '1905'} | ₹
                        {((qualifyingProduct?.priceMinor || 5000) / 100).toFixed(2)}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="promo-change-btn"
                    onClick={() => openProductPicker('free')}
                  >
                    Change
                  </button>
                </div>
              </div>

              {/* Free Quantity Stepper */}
              <div className="promo-form-group">
                <label className="promo-label">Free Quantity *</label>
                <div className="promo-stepper-counter">
                  <button
                    type="button"
                    className="promo-counter-btn"
                    onClick={() =>
                      setFormData({
                        ...formData,
                        rules: {
                          ...formData.rules,
                          freeQty: Math.max(1, (formData.rules.freeQty || 1) - 1),
                        },
                      })
                    }
                  >
                    &minus;
                  </button>
                  <span className="promo-counter-val">{formData.rules.freeQty || 1}</span>
                  <button
                    type="button"
                    className="promo-counter-btn"
                    onClick={() =>
                      setFormData({
                        ...formData,
                        rules: {
                          ...formData.rules,
                          freeQty: (formData.rules.freeQty || 1) + 1,
                        },
                      })
                    }
                  >
                    +
                  </button>
                  <span className="promo-counter-hint">(Get {formData.rules.freeQty || 1})</span>
                </div>
              </div>
            </>
          ) : (
            <div className="promo-config-box">
              <div style={{ fontWeight: 600, color: '#334155', marginBottom: '0.35rem' }}>
                Offer Summary
              </div>
              <div style={{ fontSize: '0.84rem', color: '#64748b' }}>
                {formData.name || 'Unnamed offer'} is configured to automatically apply at billing when conditions match.
              </div>
            </div>
          )}

          {/* Expandable Additional Settings Accordion */}
          <div className="promo-accordion">
            <div
              className="promo-accordion-header"
              onClick={() => setIsSettingsExpanded(!isSettingsExpanded)}
            >
              <span>Additional Settings</span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={{
                  transform: isSettingsExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s',
                }}
              >
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </div>

            {isSettingsExpanded && (
              <div className="promo-accordion-content">
                {/* Max total usage limit */}
                <div>
                  <label className="promo-check-row">
                    <input
                      type="checkbox"
                      checked={formData.maxTotalUsage !== null && formData.maxTotalUsage !== undefined}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          maxTotalUsage: e.target.checked ? 100 : null,
                        })
                      }
                    />
                    <span>Set maximum usage limit</span>
                    <span className="promo-info-tip" title="Total number of times this offer can be claimed store-wide">ℹ</span>
                  </label>
                  {formData.maxTotalUsage !== null && formData.maxTotalUsage !== undefined && (
                    <input
                      type="number"
                      min="1"
                      value={formData.maxTotalUsage}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          maxTotalUsage: Math.max(1, parseInt(e.target.value) || 1),
                        })
                      }
                      className="promo-input"
                      style={{ marginTop: '0.35rem' }}
                      placeholder="e.g. 100 bills"
                    />
                  )}
                </div>

                {/* Apply on selected customers */}
                <div>
                  <label className="promo-check-row">
                    <input
                      type="checkbox"
                      checked={formData.customerEligibilityType === 'selected'}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          customerEligibilityType: e.target.checked ? 'selected' : 'all',
                        })
                      }
                    />
                    <span>Apply on selected customers</span>
                    <span className="promo-info-tip" title="Restrict promotion to VIP or selected registered customers">ℹ</span>
                  </label>
                  {formData.customerEligibilityType === 'selected' && (
                    <select
                      multiple
                      value={formData.eligibleCustomerIds}
                      onChange={(e) => {
                        const vals = Array.from(e.target.selectedOptions, (op) => op.value);
                        setFormData({ ...formData, eligibleCustomerIds: vals });
                      }}
                      className="promo-select"
                      style={{ marginTop: '0.35rem', height: '80px' }}
                    >
                      {parties
                        .filter((p) => p.type === 'customer')
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} {c.phone ? `(${c.phone})` : ''}
                          </option>
                        ))}
                    </select>
                  )}
                </div>

                {/* Show offer banner on POS */}
                <div>
                  <label className="promo-check-row">
                    <input
                      type="checkbox"
                      checked={formData.showBannerOnPos}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          showBannerOnPos: e.target.checked,
                        })
                      }
                    />
                    <span>Show offer banner on POS</span>
                    <span className="promo-info-tip" title="Displays offer highlight in cashier POS cart and sidebar">ℹ</span>
                  </label>
                </div>

                {/* Allow stacking */}
                <div>
                  <label className="promo-check-row">
                    <input
                      type="checkbox"
                      checked={formData.allowStacking}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          allowStacking: e.target.checked,
                        })
                      }
                    />
                    <span>Allow stacking with other promotions</span>
                    <span className="promo-info-tip" title="Allow this promotion to combine with other item or bill discounts">ℹ</span>
                  </label>
                </div>

                {/* Usage per customer */}
                <div>
                  <label className="promo-check-row">
                    <input
                      type="checkbox"
                      checked={formData.maxUsagePerCustomer !== null && formData.maxUsagePerCustomer !== undefined}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          maxUsagePerCustomer: e.target.checked ? 1 : null,
                        })
                      }
                    />
                    <span>Limit usage per customer</span>
                    <span className="promo-info-tip" title="Maximum times each registered phone number can use this offer">ℹ</span>
                  </label>
                  {formData.maxUsagePerCustomer !== null && formData.maxUsagePerCustomer !== undefined && (
                    <input
                      type="number"
                      min="1"
                      value={formData.maxUsagePerCustomer}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          maxUsagePerCustomer: Math.max(1, parseInt(e.target.value) || 1),
                        })
                      }
                      className="promo-input"
                      style={{ marginTop: '0.35rem' }}
                      placeholder="e.g. 1 use per customer"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Product & Category Selection Modal */}
      <ProductCategoryModal
        isOpen={isProductModalOpen}
        onClose={() => setIsProductModalOpen(false)}
        items={items}
        categories={categories}
        mode={
          productModalTarget === 'qualifying' || productModalTarget === 'free'
            ? 'single-product'
            : formData.type === 'category_discount'
            ? 'multi-category'
            : 'products-and-categories'
        }
        selectedProductIds={
          productModalTarget === 'qualifying'
            ? formData.rules.qualifyingProductId ? [formData.rules.qualifyingProductId] : []
            : productModalTarget === 'free'
            ? formData.rules.freeProductId ? [formData.rules.freeProductId] : []
            : formData.rules.productIds
        }
        selectedCategoryNames={formData.rules.categoryNames}
        onConfirm={handleProductModalConfirm}
        title={
          productModalTarget === 'qualifying'
            ? 'Choose Qualifying Product'
            : productModalTarget === 'free'
            ? 'Choose Free Product'
            : 'Select Eligible Products & Categories'
        }
      />

      {/* Reports Modal */}
      <PromotionReportsModal
        isOpen={isReportsOpen}
        onClose={() => setIsReportsOpen(false)}
        branches={branches}
      />
    </div>
  );
}
