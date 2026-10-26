import React, { useState, useMemo, useEffect } from 'react';
import type { Party, Shop, Invoice } from '../../api.ts';
import { normalizePhone } from '../../../../shared/whatsapp.ts';
import './CustomerDirectory.css';

export interface CustomerDirectoryProps {
  parties: Party[];
  invoices?: Invoice[];
  duesSummary?: any; // kept optional for backwards compat
  shop: Shop | null;
  onAddCustomer: () => void;
  onEditCustomer: (customer: Party) => void;
  onCollectPayment?: (customer: Party) => void;
  onOpenLedger?: (customer: Party) => void;
  onToggleActive: (customer: Party) => void;
  onSelectForBilling?: (customer: Party) => void;
  onUpdateLoyaltySettings?: (settings: {
    loyaltyEnabled: boolean;
    loyaltyPointsPer100: number;
    loyaltyPointValueMinor: number;
    loyaltyMinPointsRedeem: number;
  }) => Promise<void>;
  onRefresh?: () => void;
}

export function formatRupees(paise: number = 0): string {
  return '₹' + (paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPointsValue(points: number = 0, pointValueMinor: number = 10): string {
  const rupees = points * (pointValueMinor / 100);
  return '₹' + rupees.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getAvatarColor(name: string): { bg: string; text: string; border: string } {
  const colors = [
    { bg: '#eef2ff', text: '#4f46e5', border: '#c7d2fe' }, // Indigo
    { bg: '#ecfdf5', text: '#059669', border: '#a7f3d0' }, // Emerald
    { bg: '#fdf4ff', text: '#9333ea', border: '#f0abfc' }, // Purple
    { bg: '#fff7ed', text: '#ea580c', border: '#fed7aa' }, // Orange
    { bg: '#f0fdfa', text: '#0d9488', border: '#99f6e4' }, // Teal
    { bg: '#eff6ff', text: '#2563eb', border: '#bfdbfe' }, // Blue
  ];
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export const CustomerDirectory: React.FC<CustomerDirectoryProps> = ({
  parties,
  invoices = [],
  shop,
  onAddCustomer,
  onEditCustomer,
  onToggleActive,
  onUpdateLoyaltySettings,
  onRefresh,
}) => {
  // Active Shop Loyalty Scheme Configuration (with defaults)
  const activePointsPer100 = shop?.loyaltyPointsPer100 ?? 10;
  const activePointValMinor = shop?.loyaltyPointValueMinor ?? 10;
  const activePointValRupees = activePointValMinor / 100;
  const activeLoyaltyEnabled = shop?.loyaltyEnabled ?? true;
  const activeMinRedeem = shop?.loyaltyMinPointsRedeem ?? 10;

  // Modal & Edit State for Custom Loyalty Points Scheme
  const [isLoyaltyModalOpen, setIsLoyaltyModalOpen] = useState(false);
  const [editLoyaltyEnabled, setEditLoyaltyEnabled] = useState(activeLoyaltyEnabled);
  const [editPointsPer100, setEditPointsPer100] = useState(activePointsPer100);
  const [editPointValueRupees, setEditPointValueRupees] = useState(activePointValRupees);
  const [editMinRedeem, setEditMinRedeem] = useState(activeMinRedeem);
  const [isSavingLoyalty, setIsSavingLoyalty] = useState(false);

  useEffect(() => {
    setEditLoyaltyEnabled(shop?.loyaltyEnabled ?? true);
    setEditPointsPer100(shop?.loyaltyPointsPer100 ?? 10);
    setEditPointValueRupees((shop?.loyaltyPointValueMinor ?? 10) / 100);
    setEditMinRedeem(shop?.loyaltyMinPointsRedeem ?? 10);
  }, [shop]);

  // State
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'has_points' | 'zero_points' | 'inactive'>('all');
  const [sortBy, setSortBy] = useState<'points_desc' | 'points_asc' | 'name_asc'>('points_desc');
  const [selectedCustomer, setSelectedCustomer] = useState<Party | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Filter customers to only customer parties
  const customersList = useMemo(() => {
    return parties.filter((p) => p.type === 'customer' || !p.type);
  }, [parties]);

  // Dynamic Customer Points & Invoice History:
  // Points are dynamic and synchronized directly with backend PostgreSQL database!
  const getCustomerPointsData = (party: Party) => {
    const custInvoices = invoices.filter(
      (inv) =>
        (inv.partyId === party.id || (party.phone && inv.customerPhone === party.phone)) &&
        inv.status !== 'cancelled' &&
        inv.kind !== 'credit_note'
    );

    const purchaseTotalPaise = custInvoices.reduce((sum, inv) => sum + (inv.totalMinor || 0), 0);
    const totalPoints = party.loyaltyPoints ?? 0;

    return {
      points: totalPoints,
      purchaseCount: custInvoices.length,
      totalSpendMinor: purchaseTotalPaise,
      invoices: custInvoices,
    };
  };

  // Derived metrics for Bento Cards
  const kpiStats = useMemo(() => {
    let totalCustomers = customersList.length;
    let totalPoints = 0;
    let hasPointsCount = 0;
    let zeroPointsCount = 0;
    let inactiveCount = 0;

    customersList.forEach((c) => {
      if (c.active === false) inactiveCount++;
      const data = getCustomerPointsData(c);
      totalPoints += data.points;
      if (data.points > 0) hasPointsCount++;
      else zeroPointsCount++;
    });

    const totalRupeesValue = totalPoints * activePointValRupees;

    return {
      totalCustomers,
      totalPoints,
      totalRupeesValue,
      hasPointsCount,
      zeroPointsCount,
      inactiveCount,
    };
  }, [customersList, invoices, activePointValRupees]);

  const handleSaveLoyaltyRules = async () => {
    if (!onUpdateLoyaltySettings) return;
    setIsSavingLoyalty(true);
    try {
      await onUpdateLoyaltySettings({
        loyaltyEnabled: editLoyaltyEnabled,
        loyaltyPointsPer100: Math.max(0, Number(editPointsPer100) || 0),
        loyaltyPointValueMinor: Math.round((Number(editPointValueRupees) || 0.1) * 100),
        loyaltyMinPointsRedeem: Math.max(0, Number(editMinRedeem) || 0),
      });
      setIsLoyaltyModalOpen(false);
    } catch (err: any) {
      alert(err.message || 'Failed to save loyalty settings');
    } finally {
      setIsSavingLoyalty(false);
    }
  };

  // Filter and Sort Customers
  const filteredCustomers = useMemo(() => {
    let list = customersList.filter((c) => {
      const data = getCustomerPointsData(c);

      // 1. Search Query (Name or Phone)
      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        const matches =
          c.name.toLowerCase().includes(q) ||
          (c.phone && c.phone.includes(q));
        if (!matches) return false;
      }

      // 2. Filter Tabs
      if (filterMode === 'inactive') return c.active === false;
      if (filterMode === 'has_points') return data.points > 0 && c.active !== false;
      if (filterMode === 'zero_points') return data.points === 0 && c.active !== false;

      return true;
    });

    // 3. Sorting
    list = [...list].sort((a, b) => {
      const pa = getCustomerPointsData(a).points;
      const pb = getCustomerPointsData(b).points;

      if (sortBy === 'points_desc') return pb - pa;
      if (sortBy === 'points_asc') return pa - pb;
      if (sortBy === 'name_asc') return a.name.localeCompare(b.name);
      return 0;
    });

    return list;
  }, [customersList, invoices, searchTerm, filterMode, sortBy]);

  // Copy phone helper
  const handleCopy = (text: string, id: string) => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Export CSV
  const handleExportCSV = () => {
    const headers = [
      'Customer Name',
      'Mobile Phone',
      'Email',
      'Loyalty Points Balance',
      'Cash Discount Value (INR)',
      'Status',
    ];

    const rows = filteredCustomers.map((c) => {
      const { points } = getCustomerPointsData(c);
      const cashVal = (points * 0.1).toFixed(2);

      return [
        `"${c.name.replace(/"/g, '""')}"`,
        `"${c.phone || ''}"`,
        `"${c.email || ''}"`,
        points,
        cashVal,
        c.active !== false ? 'Active' : 'Inactive',
      ];
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `customer_points_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="customer-dir-root">
      {/* 1. TOP BENTO KPI METRICS: CLEAN 3-CARD SUMMARY */}
      <div className="customer-kpi-grid">
        {/* Total Customers */}
        <div
          className={`customer-kpi-card purple ${filterMode === 'all' ? 'selected' : ''}`}
          onClick={() => setFilterMode('all')}
          title="Click to view all registered customers"
        >
          <div className="kpi-card-header">
            <span className="kpi-icon-box purple">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
            </span>
            <span className="kpi-tag purple">Total Registered</span>
          </div>
          <div className="kpi-val mono">{kpiStats.totalCustomers}</div>
          <div className="kpi-label">Total Customers</div>
          <div className="kpi-sub">Customers registered with name &amp; phone</div>
        </div>

        {/* Total Active Reward Points */}
        <div
          className={`customer-kpi-card amber ${filterMode === 'has_points' ? 'selected' : ''}`}
          onClick={() => setFilterMode('has_points')}
          title="Click to filter customers who have points"
        >
          <div className="kpi-card-header">
            <span className="kpi-icon-box amber">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"></path>
                <line x1="12" y1="6" x2="12" y2="8"></line>
                <line x1="12" y1="16" x2="12" y2="18"></line>
              </svg>
            </span>
            <span className="kpi-tag amber">{kpiStats.hasPointsCount} Customers</span>
          </div>
          <div className="kpi-val mono text-amber">
            {kpiStats.totalPoints.toLocaleString()} <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>pts</span>
          </div>
          <div className="kpi-label">Active Points Balance</div>
          <div className="kpi-sub">
            {activeLoyaltyEnabled ? `Scheme: ${activePointsPer100} pts per ₹100 spent` : 'Loyalty Program Paused'}
          </div>
        </div>

        {/* Total Points Redeemable Value (INR) */}
        <div className="customer-kpi-card emerald">
          <div className="kpi-card-header">
            <span className="kpi-icon-box emerald">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="1" x2="12" y2="23"></line>
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
              </svg>
            </span>
            <span className="kpi-tag emerald">1 pt = ₹{activePointValRupees.toFixed(2)}</span>
          </div>
          <div className="kpi-val mono text-emerald">{formatRupees(Math.round(kpiStats.totalRupeesValue * 100))}</div>
          <div className="kpi-label">Points Cash Value</div>
          <div className="kpi-sub">Redeemable counter discount value</div>
        </div>
      </div>

      {/* 2. CONTROLS, SEARCH & FILTER TOOLBAR */}
      <div className="customer-main-card">
        <div className="customer-card-header">
          <div className="header-info-group">
            <div className="header-icon-box">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="6" x2="12" y2="18"></line>
                <path d="M16 9.5a2.5 2.5 0 0 0-5 0c0 4 5 2 5 6a2.5 2.5 0 0 1-5 0"></path>
              </svg>
            </div>
            <div>
              <h2 className="header-title">
                Customer Directory &amp; Points ({filteredCustomers.length}{' '}
                {filteredCustomers.length === customersList.length ? 'total' : `of ${customersList.length}`})
              </h2>
              <p className="header-subtitle">
                Customer Name, Mobile Number, and Automatically Earned Points from Purchases
              </p>
            </div>
          </div>

          <div className="header-actions-group">
            {onUpdateLoyaltySettings && (
              <button
                type="button"
                className="btn-loyalty-rules"
                onClick={() => setIsLoyaltyModalOpen(true)}
                title="Configure custom loyalty points rules for your shop"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
                <span>Loyalty Scheme</span>
                <span className="loyalty-rule-badge">₹100 = {activePointsPer100} pts</span>
              </button>
            )}

            <button
              type="button"
              className="btn-export-csv"
              onClick={handleExportCSV}
              title="Download customer list as CSV"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>Export CSV</span>
            </button>

            <button
              type="button"
              className="customer-primary-add-btn"
              onClick={onAddCustomer}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>Add Customer</span>
            </button>
          </div>
        </div>

        {/* FILTER STRIP & SEARCH */}
        <div className="customer-filter-strip">
          <div className="filter-pills-row">
            <button
              type="button"
              className={`filter-pill ${filterMode === 'all' ? 'active' : ''}`}
              onClick={() => setFilterMode('all')}
            >
              All Customers <span className="pill-count">{kpiStats.totalCustomers}</span>
            </button>
            <button
              type="button"
              className={`filter-pill amber ${filterMode === 'has_points' ? 'active' : ''}`}
              onClick={() => setFilterMode('has_points')}
            >
              <span className="pill-dot amber"></span>
              Has Points <span className="pill-count">{kpiStats.hasPointsCount}</span>
            </button>
            <button
              type="button"
              className={`filter-pill slate ${filterMode === 'zero_points' ? 'active' : ''}`}
              onClick={() => setFilterMode('zero_points')}
            >
              Zero Points <span className="pill-count">{kpiStats.zeroPointsCount}</span>
            </button>
            {kpiStats.inactiveCount > 0 && (
              <button
                type="button"
                className={`filter-pill slate ${filterMode === 'inactive' ? 'active' : ''}`}
                onClick={() => setFilterMode('inactive')}
              >
                Inactive <span className="pill-count">{kpiStats.inactiveCount}</span>
              </button>
            )}
          </div>

          <div className="search-and-sort-group">
            <div className="customer-search-input-wrap">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="text"
                placeholder="Search customer name, mobile (+91)..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button type="button" className="clear-search-btn" onClick={() => setSearchTerm('')}>
                  ✕
                </button>
              )}
            </div>

            <div className="sort-dropdown-wrap">
              <label htmlFor="customer-sort">Sort:</label>
              <select
                id="customer-sort"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
              >
                <option value="points_desc">Highest Points</option>
                <option value="points_asc">Lowest Points</option>
                <option value="name_asc">Name (A–Z)</option>
              </select>
            </div>
          </div>
        </div>

        {/* 3. CLEAN & SIMPLE GRID: NAME, NUMBER, POINTS & CLEAN ACTIONS */}
        <div className="customer-table-container">
          <table className="customer-modern-table">
            <thead>
              <tr>
                <th style={{ width: '38%', minWidth: '220px' }}>CUSTOMER NAME</th>
                <th style={{ width: '28%', minWidth: '180px' }}>MOBILE NUMBER</th>
                <th style={{ width: '22%', minWidth: '160px' }}>LOYALTY POINTS</th>
                <th style={{ width: '12%', minWidth: '130px', textAlign: 'right' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map((c) => {
                const data = getCustomerPointsData(c);
                const avatarStyle = getAvatarColor(c.name);
                const pointsValueStr = formatPointsValue(data.points);

                return (
                  <tr
                    key={c.id}
                    className={`customer-row ${c.active === false ? 'inactive-row' : ''}`}
                    onClick={() => setSelectedCustomer(c)}
                  >
                    {/* Customer Name & Avatar (Clean without any # badge) */}
                    <td>
                      <div className="customer-cell-identity">
                        <div
                          className="customer-avatar"
                          style={{
                            background: avatarStyle.bg,
                            color: avatarStyle.text,
                            borderColor: avatarStyle.border,
                          }}
                        >
                          {c.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="customer-name-group">
                          <span className="customer-full-name">{c.name}</span>
                          {c.active === false && (
                            <span className="badge-inactive-tag">Inactive</span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Mobile Number */}
                    <td>
                      <div className="customer-contact-cell">
                        {c.phone ? (
                          <div
                            className="phone-copy-chip"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(c.phone!, c.id);
                            }}
                            title="Click to copy 10-digit mobile number"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                            </svg>
                            <span className="mono bold">{c.phone}</span>
                            <span className="copy-label">{copiedId === c.id ? 'Copied!' : '📋'}</span>
                          </div>
                        ) : (
                          <span className="text-muted">No mobile registered</span>
                        )}
                      </div>
                    </td>

                    {/* Loyalty Points Balance & Cash Value */}
                    <td>
                      <div className="loyalty-points-cell">
                        <div className="points-badge-row">
                          <span className="points-coin-icon">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="#f59e0b" stroke="#d97706" strokeWidth="2">
                              <circle cx="12" cy="12" r="10"></circle>
                              <path d="M12 6v12M15 9.5a2.5 2.5 0 0 0-5 0c0 4 5 2 5 6a2.5 2.5 0 0 1-5 0"></path>
                            </svg>
                          </span>
                          <span className="points-number mono">{data.points.toLocaleString()}</span>
                          <span className="points-unit">pts</span>
                        </div>
                        <div className="points-value-pill" title="Automatic 1 pt per ₹10 purchase">
                          ✓ Value: {pointsValueStr}
                        </div>
                      </div>
                    </td>

                    {/* Clean Actions: Edit & Deactivate */}
                    <td>
                      <div className="customer-actions-row" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="btn-action-edit"
                          onClick={() => onEditCustomer(c)}
                          title="Edit customer details"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                          </svg>
                          <span>Edit</span>
                        </button>

                        <button
                          type="button"
                          className={`btn-action-toggle ${c.active !== false ? 'deactivate' : 'activate'}`}
                          onClick={() => onToggleActive(c)}
                          title={c.active !== false ? 'Deactivate customer' : 'Activate customer'}
                        >
                          {c.active !== false ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredCustomers.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <div className="customer-empty-state">
                      <div className="empty-icon-box">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.8">
                          <circle cx="11" cy="11" r="8"></circle>
                          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                      </div>
                      <h3>No customers matched your search</h3>
                      <p>Try searching for a different customer name or mobile number.</p>
                      <button
                        type="button"
                        className="btn-reset-filters"
                        onClick={() => {
                          setSearchTerm('');
                          setFilterMode('all');
                        }}
                      >
                        Reset All Filters
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 4. CUSTOMER PROFILE DRAWER */}
      {selectedCustomer && (
        <div className="customer-drawer-backdrop" onClick={() => setSelectedCustomer(null)}>
          <div className="customer-drawer-panel" onClick={(e) => e.stopPropagation()}>
            {/* Drawer Header */}
            <div className="drawer-header">
              <div className="drawer-customer-title">
                {(() => {
                  const style = getAvatarColor(selectedCustomer.name);
                  return (
                    <div
                      className="drawer-avatar"
                      style={{
                        background: style.bg,
                        color: style.text,
                        borderColor: style.border,
                      }}
                    >
                      {selectedCustomer.name.slice(0, 2).toUpperCase()}
                    </div>
                  );
                })()}
                <div>
                  <h3 className="drawer-name">{selectedCustomer.name}</h3>
                  <div className="drawer-badges">
                    <span className={`status-badge-chip ${selectedCustomer.active !== false ? 'active' : 'inactive'}`}>
                      ● {selectedCustomer.active !== false ? 'Active Customer' : 'Inactive'}
                    </span>
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="drawer-close-btn"
                onClick={() => setSelectedCustomer(null)}
                title="Close Customer Profile"
              >
                ✕
              </button>
            </div>

            {/* Drawer Body */}
            <div className="drawer-body">
              {/* DIGITAL CUSTOMER POINTS CARD */}
              {(() => {
                const data = getCustomerPointsData(selectedCustomer);

                return (
                  <div className="supermarket-digital-card">
                    <div className="card-top-row">
                      <div className="card-brand">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="12" y1="6" x2="12" y2="18"></line>
                        </svg>
                        <span>{shop?.name ? shop.name.toUpperCase() : 'STORE'} REWARDS</span>
                      </div>
                    </div>

                    <div className="card-chip-graphic">
                      <svg width="34" height="26" viewBox="0 0 34 26" fill="none">
                        <rect width="34" height="26" rx="4" fill="#fbbf24" fillOpacity="0.85"></rect>
                        <path d="M0 13h34M17 0v26M10 0v26M24 0v26" stroke="#b45309" strokeWidth="1.2"></path>
                      </svg>
                    </div>

                    <div className="card-middle-points">
                      <div className="card-points-label">AVAILABLE LOYALTY POINTS</div>
                      <div className="card-points-val mono">
                        {data.points.toLocaleString()} <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>POINTS</span>
                      </div>
                      <div className="card-cash-equiv">
                        Redeemable Cash Value: <strong>{formatPointsValue(data.points)}</strong>
                      </div>
                    </div>

                    <div className="card-bottom-row">
                      <div className="card-holder-info">
                        <span className="c-label">CUSTOMER NAME</span>
                        <span className="c-name">{selectedCustomer.name.toUpperCase()}</span>
                      </div>
                      <div className="card-phone-info">
                        <span className="c-label">MOBILE NUMBER</span>
                        <span className="c-phone mono">{selectedCustomer.phone || 'NO MOBILE'}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Automatic Points Rule Callout */}
              <div className="auto-points-info-card">
                <span style={{ fontSize: '1.25rem' }}>⚡</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.84rem', color: '#0f172a' }}>
                    Shop Scheme: {activePointsPer100} Points per ₹100 Spent
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
                    Purchases at checkout automatically earn points. 1 point = ₹{activePointValRupees.toFixed(2)} counter discount.
                  </div>
                </div>
              </div>

              {/* Customer Contact */}
              <div className="drawer-section">
                <h4 className="section-heading">Contact Details</h4>
                <div className="drawer-info-list">
                  <div className="drawer-info-item">
                    <span className="info-key">Mobile Number</span>
                    <span className="info-val mono bold">{selectedCustomer.phone || 'Not registered'}</span>
                  </div>
                  {selectedCustomer.email && (
                    <div className="drawer-info-item">
                      <span className="info-key">Email Address</span>
                      <span className="info-val">{selectedCustomer.email}</span>
                    </div>
                  )}
                  {selectedCustomer.address && (
                    <div className="drawer-info-item">
                      <span className="info-key">Address / Location</span>
                      <span className="info-val">{selectedCustomer.address}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Recent Bills that Credited Points Automatically */}
              {(() => {
                const data = getCustomerPointsData(selectedCustomer);

                return (
                  <div className="drawer-section">
                    <h4 className="section-heading">Recent Purchases (Automatic Points)</h4>
                    <div className="points-history-list">
                      {data.invoices && data.invoices.length > 0 ? (
                        data.invoices.slice(0, 5).map((inv) => {
                          const pts = activePointsPer100 > 0 ? Math.floor(((inv.totalMinor || 0) * activePointsPer100) / 10000) : 0;
                          return (
                            <div key={inv.id} className="history-item-row">
                              <div className="history-item-left">
                                <span className="history-dot earned"></span>
                                <div>
                                  <div className="history-desc">Bill #{inv.number}</div>
                                  <div className="history-date">
                                    {formatRupees(inv.totalMinor)} • {inv.bdate || new Date(inv.createdAt).toLocaleDateString('en-IN')}
                                  </div>
                                </div>
                              </div>
                              <div className="history-points-val mono earned">
                                +{pts} pts
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div style={{ fontSize: '0.82rem', color: '#94a3b8', fontStyle: 'italic', padding: '0.5rem 0' }}>
                          No purchases recorded yet. Points will be automatically credited on checkout!
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Drawer Quick Actions */}
              <div className="drawer-actions-box">
                <button
                  type="button"
                  className="drawer-btn secondary"
                  onClick={() => {
                    onEditCustomer(selectedCustomer);
                    setSelectedCustomer(null);
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                  </svg>
                  <span>Edit Customer Details</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. CUSTOM LOYALTY PROGRAM RULES CONFIGURATION MODAL */}
      {isLoyaltyModalOpen && (
        <div className="loyalty-modal-overlay" onClick={() => setIsLoyaltyModalOpen(false)}>
          <div className="loyalty-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="loyalty-modal-header">
              <div className="loyalty-header-left">
                <div className="loyalty-header-icon">🎁</div>
                <div>
                  <h3 className="loyalty-header-title">Custom Loyalty Program Scheme</h3>
                  <p className="loyalty-header-sub">Configure how points are earned and redeemed for your store</p>
                </div>
              </div>
              <button
                type="button"
                className="loyalty-modal-close"
                onClick={() => setIsLoyaltyModalOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="loyalty-modal-body">
              {/* Program Toggle */}
              <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1.5px solid #e2e8f0' }}>
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#0f172a' }}>
                      Enable Customer Loyalty Program
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
                      Turn loyalty rewards ON or OFF for counter billing
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={editLoyaltyEnabled}
                    onChange={(e) => setEditLoyaltyEnabled(e.target.checked)}
                    style={{ width: '20px', height: '20px', accentColor: '#7c3aed', cursor: 'pointer' }}
                  />
                </label>
              </div>

              {/* Scheme: Points per ₹100 Spent */}
              <div>
                <label style={{ fontWeight: 700, fontSize: '0.88rem', color: '#1e293b', display: 'block', marginBottom: '0.35rem' }}>
                  Points Earned per ₹100 Purchase
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="number"
                    min="0"
                    max="1000"
                    step="1"
                    className="form-input mono bold"
                    style={{ width: '130px', fontSize: '1.1rem', textAlign: 'center', color: '#7c3aed' }}
                    value={editPointsPer100}
                    onChange={(e) => setEditPointsPer100(Number(e.target.value))}
                  />
                  <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#475569' }}>
                    Points for every ₹100 customer spends
                  </span>
                </div>

                {/* Preset Chips */}
                <div className="preset-chips-row">
                  {[2, 5, 10, 15, 20].map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      className={`preset-chip-btn ${editPointsPer100 === rate ? 'active' : ''}`}
                      onClick={() => setEditPointsPer100(rate)}
                    >
                      {rate} pts / ₹100
                    </button>
                  ))}
                </div>

                {/* Live Purchase Preview */}
                <div className="loyalty-live-preview-box purple" style={{ marginTop: '0.75rem' }}>
                  <span style={{ fontSize: '1.25rem' }}>⚡</span>
                  <div style={{ fontSize: '0.82rem', color: '#4c1d95', lineHeight: 1.4 }}>
                    <strong>Live Example:</strong> When a customer buys items worth <strong>₹500</strong>, they will earn{' '}
                    <span className="preview-pill-stat purple">{Math.floor((500 * (Number(editPointsPer100) || 0)) / 100)} points</span>!
                  </div>
                </div>
              </div>

              {/* Redemption Value */}
              <div>
                <label style={{ fontWeight: 700, fontSize: '0.88rem', color: '#1e293b', display: 'block', marginBottom: '0.35rem' }}>
                  Points Redemption Value (Discount per 1 Point)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1rem', fontWeight: 700, color: '#059669' }}>₹</span>
                  <input
                    type="number"
                    min="0.01"
                    max="50"
                    step="0.05"
                    className="form-input mono bold"
                    style={{ width: '130px', fontSize: '1.1rem', textAlign: 'center', color: '#059669' }}
                    value={editPointValueRupees}
                    onChange={(e) => setEditPointValueRupees(Number(e.target.value))}
                  />
                  <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#475569' }}>
                    Cash discount off the bill per 1 point redeemed
                  </span>
                </div>

                {/* Presets */}
                <div className="preset-chips-row">
                  {[
                    { label: '₹0.10 (10 pts = ₹1)', val: 0.1 },
                    { label: '₹0.20 (5 pts = ₹1)', val: 0.2 },
                    { label: '₹0.50 (2 pts = ₹1)', val: 0.5 },
                    { label: '₹1.00 (1 pt = ₹1)', val: 1.0 },
                  ].map((p) => (
                    <button
                      key={p.val}
                      type="button"
                      className={`preset-chip-btn ${Math.abs(editPointValueRupees - p.val) < 0.001 ? 'active' : ''}`}
                      onClick={() => setEditPointValueRupees(p.val)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {/* Live Redemption Preview */}
                <div className="loyalty-live-preview-box" style={{ marginTop: '0.75rem' }}>
                  <span style={{ fontSize: '1.25rem' }}>🎁</span>
                  <div style={{ fontSize: '0.82rem', color: '#065f46', lineHeight: 1.4 }}>
                    <strong>Redemption Example:</strong> When a customer redeems <strong>100 points</strong>, they get an instant{' '}
                    <span className="preview-pill-stat">₹{(100 * (Number(editPointValueRupees) || 0.1)).toFixed(2)} discount</span> at POS checkout.
                  </div>
                </div>
              </div>

              {/* Minimum Points to Redeem */}
              <div>
                <label style={{ fontWeight: 700, fontSize: '0.88rem', color: '#1e293b', display: 'block', marginBottom: '0.35rem' }}>
                  Minimum Points Required to Redeem
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    type="number"
                    min="0"
                    max="1000"
                    step="5"
                    className="form-input mono"
                    style={{ width: '130px', textAlign: 'center' }}
                    value={editMinRedeem}
                    onChange={(e) => setEditMinRedeem(Number(e.target.value))}
                  />
                  <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
                    Customer needs at least this balance before redemption is unlocked at POS
                  </span>
                </div>
              </div>
            </div>

            <div className="loyalty-modal-footer">
              <button
                type="button"
                className="btn-modal-cancel"
                onClick={() => setIsLoyaltyModalOpen(false)}
                disabled={isSavingLoyalty}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-modal-save"
                onClick={handleSaveLoyaltyRules}
                disabled={isSavingLoyalty}
              >
                {isSavingLoyalty ? 'Saving...' : 'Save Loyalty Scheme'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
