import React, { useState, useMemo } from 'react';
import type { Party, Shop, Purchase } from '../../api.ts';
import './SupplierDirectory.css';

export interface SupplierDirectoryProps {
  parties: Party[];
  purchases?: Purchase[];
  shop: Shop | null;
  canPayPurchases?: boolean;
  canManagePurchases?: boolean;
  onAddSupplier: () => void;
  onEditSupplier: (supplier: Party) => void;
  onPaySupplier: (supplier: Party) => void;
  onOpenLedger: (supplierId: string) => void;
  onNewPurchase: (supplierId: string) => void;
  onToggleActive: (supplier: Party) => void;
  onRefresh?: () => void;
}

export function formatRupees(paise: number = 0): string {
  return '₹' + (paise / 100).toLocaleString('en-IN', {
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

// Calculate days difference relative to today
function getDueDateStatus(dueDateStr?: string | null): { isOverdue: boolean; daysDiff: number; label: string } | null {
  if (!dueDateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDateStr);
  due.setHours(0, 0, 0, 0);

  if (isNaN(due.getTime())) return null;

  const diffTime = due.getTime() - today.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return {
      isOverdue: true,
      daysDiff: Math.abs(diffDays),
      label: `Overdue by ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'}`,
    };
  } else if (diffDays === 0) {
    return {
      isOverdue: false,
      daysDiff: 0,
      label: 'Due Today',
    };
  } else if (diffDays <= 7) {
    return {
      isOverdue: false,
      daysDiff: diffDays,
      label: `Due in ${diffDays} day${diffDays === 1 ? '' : 's'}`,
    };
  } else {
    return {
      isOverdue: false,
      daysDiff: diffDays,
      label: `Due ${dueDateStr}`,
    };
  }
}

export const SupplierDirectory: React.FC<SupplierDirectoryProps> = ({
  parties,
  purchases = [],
  shop,
  canPayPurchases = true,
  canManagePurchases = true,
  onAddSupplier,
  onEditSupplier,
  onPaySupplier,
  onOpenLedger,
  onNewPurchase,
  onToggleActive,
  onRefresh,
}) => {
  // State
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'has_dues' | 'overdue' | 'zero_dues' | 'inactive'>('all');
  const [sortBy, setSortBy] = useState<'payable_desc' | 'due_date_asc' | 'name_asc'>('payable_desc');
  const [selectedSupplier, setSelectedSupplier] = useState<Party | null>(null);
  const [actionMenuOpenId, setActionMenuOpenId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Filter parties to suppliers only
  const suppliersList = useMemo(() => {
    return parties.filter((p) => p.type === 'supplier');
  }, [parties]);

  // Derived KPI stats
  const kpiStats = useMemo(() => {
    let totalSuppliers = suppliersList.length;
    let totalPayableMinor = 0;
    let totalOpenBills = 0;
    let overdueCount = 0;
    let overduePayableMinor = 0;
    let zeroDuesCount = 0;
    let hasDuesCount = 0;
    let inactiveCount = 0;

    suppliersList.forEach((s) => {
      if (s.active === false) inactiveCount++;

      const payable = s.payableMinor || 0;
      totalPayableMinor += payable;
      totalOpenBills += s.openPurchasesCount || 0;

      if (payable > 0) {
        hasDuesCount++;
        const status = getDueDateStatus(s.oldestDueDate);
        if (status && status.isOverdue) {
          overdueCount++;
          overduePayableMinor += payable;
        }
      } else {
        zeroDuesCount++;
      }
    });

    return {
      totalSuppliers,
      totalPayableMinor,
      totalOpenBills,
      hasDuesCount,
      overdueCount,
      overduePayableMinor,
      zeroDuesCount,
      inactiveCount,
    };
  }, [suppliersList]);

  // Filter and Sort suppliers
  const filteredSuppliers = useMemo(() => {
    return suppliersList
      .filter((s) => {
        // Mode filter
        if (filterMode === 'has_dues') {
          if ((s.payableMinor || 0) <= 0) return false;
        } else if (filterMode === 'overdue') {
          if ((s.payableMinor || 0) <= 0) return false;
          const status = getDueDateStatus(s.oldestDueDate);
          if (!status || !status.isOverdue) return false;
        } else if (filterMode === 'zero_dues') {
          if ((s.payableMinor || 0) > 0) return false;
        } else if (filterMode === 'inactive') {
          if (s.active !== false) return false;
        }

        // Search text
        if (!searchTerm.trim()) return true;
        const q = searchTerm.trim().toLowerCase();
        return (
          s.name.toLowerCase().includes(q) ||
          (s.phone && s.phone.includes(q)) ||
          (s.email && s.email.toLowerCase().includes(q)) ||
          (s.gstin && s.gstin.toLowerCase().includes(q)) ||
          (s.address && s.address.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (sortBy === 'payable_desc') {
          return (b.payableMinor || 0) - (a.payableMinor || 0);
        } else if (sortBy === 'due_date_asc') {
          const dateA = a.oldestDueDate || '9999-99-99';
          const dateB = b.oldestDueDate || '9999-99-99';
          return dateA.localeCompare(dateB);
        } else if (sortBy === 'name_asc') {
          return a.name.localeCompare(b.name);
        }
        return 0;
      });
  }, [suppliersList, filterMode, searchTerm, sortBy]);

  // Copy to clipboard helper
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Export CSV
  const handleExportCSV = () => {
    const headers = [
      'Supplier / Vendor Name',
      'Mobile Phone',
      'Email',
      'GSTIN',
      'Address',
      'Outstanding Payable (INR)',
      'Open Purchases Count',
      'Oldest Due Date',
      'Status',
    ];

    const rows = filteredSuppliers.map((s) => {
      const payableRupees = ((s.payableMinor || 0) / 100).toFixed(2);
      return [
        `"${s.name.replace(/"/g, '""')}"`,
        `"${s.phone || ''}"`,
        `"${s.email || ''}"`,
        `"${s.gstin || ''}"`,
        `"${(s.address || '').replace(/"/g, '""')}"`,
        payableRupees,
        s.openPurchasesCount || 0,
        s.oldestDueDate || '',
        s.active !== false ? 'Active' : 'Inactive',
      ];
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `supplier_directory_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="supplier-dir-root">
      {/* 1. TOP BENTO KPI CARDS STRIP */}
      <div className="supplier-kpi-grid">
        {/* Total Registered Suppliers */}
        <div
          className={`supplier-kpi-card blue ${filterMode === 'all' ? 'selected' : ''}`}
          onClick={() => setFilterMode('all')}
          title="Click to view all registered suppliers"
        >
          <div className="kpi-card-header">
            <span className="kpi-icon-box blue">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="1" y="3" width="15" height="13"></rect>
                <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon>
                <circle cx="5.5" cy="18.5" r="2.5"></circle>
                <circle cx="18.5" cy="18.5" r="2.5"></circle>
              </svg>
            </span>
            <span className="kpi-tag blue">Registered Vendors</span>
          </div>
          <div className="kpi-val mono">{kpiStats.totalSuppliers}</div>
          <div className="kpi-label">Total Suppliers</div>
          <div className="kpi-sub">Active supply chain partners for {shop?.name || 'Store'}</div>
        </div>

        {/* Total Outstanding Payable */}
        <div
          className={`supplier-kpi-card rose ${filterMode === 'has_dues' ? 'selected' : ''}`}
          onClick={() => setFilterMode('has_dues')}
          title="Click to view suppliers with pending dues"
        >
          <div className="kpi-card-header">
            <span className="kpi-icon-box rose">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <line x1="12" y1="1" x2="12" y2="23"></line>
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
              </svg>
            </span>
            <span className="kpi-tag rose">{kpiStats.hasDuesCount} Vendors Due</span>
          </div>
          <div className="kpi-val mono text-rose">{formatRupees(kpiStats.totalPayableMinor)}</div>
          <div className="kpi-label">Total Outstanding Payable</div>
          <div className="kpi-sub">{kpiStats.totalOpenBills} unpaid purchase inward bills</div>
        </div>

        {/* Overdue Bills Alert */}
        <div
          className={`supplier-kpi-card amber ${filterMode === 'overdue' ? 'selected' : ''}`}
          onClick={() => setFilterMode('overdue')}
          title="Click to view suppliers with overdue bills"
        >
          <div className="kpi-card-header">
            <span className="kpi-icon-box amber">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
            </span>
            <span className="kpi-tag amber">{kpiStats.overdueCount > 0 ? '⚠️ Action Required' : 'On Track'}</span>
          </div>
          <div className="kpi-val mono text-amber">
            {kpiStats.overdueCount} <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>Vendors</span>
          </div>
          <div className="kpi-label">Overdue Bills Alert</div>
          <div className="kpi-sub">
            {kpiStats.overdueCount > 0 ? `${formatRupees(kpiStats.overduePayableMinor)} past payment due date` : 'No overdue supplier bills!'}
          </div>
        </div>

        {/* Settled / Zero Dues */}
        <div
          className={`supplier-kpi-card emerald ${filterMode === 'zero_dues' ? 'selected' : ''}`}
          onClick={() => setFilterMode('zero_dues')}
          title="Click to view settled suppliers"
        >
          <div className="kpi-card-header">
            <span className="kpi-icon-box emerald">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
            </span>
            <span className="kpi-tag emerald">100% Cleared</span>
          </div>
          <div className="kpi-val mono text-emerald">{kpiStats.zeroDuesCount}</div>
          <div className="kpi-label">Settled / No Dues</div>
          <div className="kpi-sub">Vendors with zero pending balance</div>
        </div>
      </div>

      {/* 2. MAIN CARD & TOOLBAR */}
      <div className="supplier-main-card">
        <div className="supplier-card-header">
          <div className="header-info-group">
            <div className="header-icon-box">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <rect x="1" y="3" width="15" height="13"></rect>
                <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon>
                <circle cx="5.5" cy="18.5" r="2.5"></circle>
                <circle cx="18.5" cy="18.5" r="2.5"></circle>
              </svg>
            </div>
            <div>
              <h2 className="header-title">
                Supplier Master &amp; Vendors ({filteredSuppliers.length}{' '}
                {filteredSuppliers.length === suppliersList.length ? 'total' : `of ${suppliersList.length}`})
              </h2>
              <p className="header-subtitle">
                Purchase distributors, stock inward management, GSTIN verification &amp; payable settlements
              </p>
            </div>
          </div>

          <div className="header-actions-group">
            <button
              type="button"
              className="btn-export-csv"
              onClick={handleExportCSV}
              title="Download supplier directory as CSV"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <span>Export CSV</span>
            </button>

            <button type="button" className="supplier-primary-add-btn" onClick={onAddSupplier}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span>Add Supplier</span>
            </button>
          </div>
        </div>

        {/* FILTER STRIP & SEARCH TOOLBAR */}
        <div className="supplier-filter-strip">
          <div className="filter-pills-row">
            <button
              type="button"
              className={`filter-pill ${filterMode === 'all' ? 'active' : ''}`}
              onClick={() => setFilterMode('all')}
            >
              All Vendors <span className="pill-count">{kpiStats.totalSuppliers}</span>
            </button>
            <button
              type="button"
              className={`filter-pill rose ${filterMode === 'has_dues' ? 'active' : ''}`}
              onClick={() => setFilterMode('has_dues')}
            >
              <span className="pill-dot rose"></span>
              Has Dues <span className="pill-count">{kpiStats.hasDuesCount}</span>
            </button>
            {kpiStats.overdueCount > 0 && (
              <button
                type="button"
                className={`filter-pill amber ${filterMode === 'overdue' ? 'active' : ''}`}
                onClick={() => setFilterMode('overdue')}
              >
                <span className="pill-dot amber"></span>
                Overdue ⚠️ <span className="pill-count">{kpiStats.overdueCount}</span>
              </button>
            )}
            <button
              type="button"
              className={`filter-pill emerald ${filterMode === 'zero_dues' ? 'active' : ''}`}
              onClick={() => setFilterMode('zero_dues')}
            >
              <span className="pill-dot emerald"></span>
              Settled <span className="pill-count">{kpiStats.zeroDuesCount}</span>
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
            <div className="supplier-search-input-wrap">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="text"
                placeholder="Search vendor name, phone, GSTIN, city..."
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
              <label htmlFor="supplier-sort">Sort:</label>
              <select
                id="supplier-sort"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
              >
                <option value="payable_desc">Highest Payable</option>
                <option value="due_date_asc">Earliest Due Date</option>
                <option value="name_asc">Name (A–Z)</option>
              </select>
            </div>
          </div>
        </div>

        {/* 3. MODERN SUPPLIERS DATA TABLE */}
        <div className="supplier-table-container">
          <table className="supplier-modern-table">
            <thead>
              <tr>
                <th style={{ width: '28%', minWidth: '220px' }}>SUPPLIER / VENDOR NAME</th>
                <th style={{ width: '18%', minWidth: '150px' }}>CONTACT</th>
                <th style={{ width: '16%', minWidth: '140px' }}>GSTIN</th>
                <th style={{ width: '22%', minWidth: '180px' }}>OUTSTANDING PAYABLE</th>
                <th style={{ width: '16%', minWidth: '180px', textAlign: 'right' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {filteredSuppliers.map((s) => {
                const avatarStyle = getAvatarColor(s.name);
                const payable = s.payableMinor || 0;
                const dueDateStatus = getDueDateStatus(s.oldestDueDate);

                return (
                  <tr
                    key={s.id}
                    className={`supplier-row ${s.active === false ? 'inactive-row' : ''}`}
                    onClick={() => setSelectedSupplier(s)}
                  >
                    {/* Supplier Identity & Avatar */}
                    <td>
                      <div className="supplier-cell-identity">
                        <div
                          className="supplier-avatar"
                          style={{
                            background: avatarStyle.bg,
                            color: avatarStyle.text,
                            borderColor: avatarStyle.border,
                          }}
                        >
                          {s.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="supplier-name-group">
                          <span className="supplier-full-name">{s.name}</span>
                          <div className="supplier-sub-details">
                            {s.address ? (
                              <span className="supplier-address-snippet" title={s.address}>
                                📍 {s.address}
                              </span>
                            ) : (
                              <span className="text-muted">Wholesale Vendor</span>
                            )}
                            {s.active === false && (
                              <span className="badge-inactive-tag">Inactive</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Contact (Phone & Email) */}
                    <td>
                      <div className="supplier-contact-cell">
                        {s.phone ? (
                          <div
                            className="phone-copy-chip"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(s.phone!, s.id + '-phone');
                            }}
                            title="Click to copy contact number"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                            </svg>
                            <span className="mono bold">{s.phone}</span>
                            <span className="copy-label">{copiedId === s.id + '-phone' ? 'Copied!' : '📋'}</span>
                          </div>
                        ) : (
                          <span className="text-muted">No phone</span>
                        )}
                        {s.email && (
                          <span className="supplier-email-sub" title={s.email}>
                            ✉️ {s.email}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* GSTIN */}
                    <td>
                      <div className="supplier-gstin-cell">
                        {s.gstin ? (
                          <div
                            className="gstin-chip"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(s.gstin!, s.id + '-gstin');
                            }}
                            title="Click to copy GSTIN"
                          >
                            <span className="mono bold">{s.gstin}</span>
                            <span className="gstin-status">✓ Tax Registered</span>
                          </div>
                        ) : (
                          <span className="badge-unregistered-tag">Unregistered</span>
                        )}
                      </div>
                    </td>

                    {/* Outstanding Payable & Aging */}
                    <td>
                      <div className="supplier-payable-cell">
                        {payable > 0 ? (
                          <div className="payable-amount-box">
                            <span className="payable-val mono">{formatRupees(payable)}</span>
                            <div className="payable-meta-row">
                              <span className="open-bills-count">
                                {s.openPurchasesCount || 1} open bill{(s.openPurchasesCount || 1) > 1 ? 's' : ''}
                              </span>
                              {dueDateStatus && (
                                <span className={`due-aging-tag ${dueDateStatus.isOverdue ? 'overdue' : 'upcoming'}`}>
                                  {dueDateStatus.isOverdue ? '⚠️ ' : '⏱️ '}
                                  {dueDateStatus.label}
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="settled-status-pill">
                            <span className="settled-check">✓</span>
                            <span>No Dues • Settled</span>
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Modern Action Controls */}
                    <td>
                      <div className="supplier-actions-row" onClick={(e) => e.stopPropagation()}>
                        {/* Primary Settle / Pay Due button (when payable > 0) */}
                        {canPayPurchases && payable > 0 && (
                          <button
                            type="button"
                            className="btn-action-pay"
                            onClick={() => onPaySupplier(s)}
                            title="Pay this supplier oldest-purchase first (FIFO)"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                              <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                              <line x1="1" y1="10" x2="23" y2="10"></line>
                            </svg>
                            <span>Pay Due</span>
                          </button>
                        )}

                        {/* Stock Inward Shortcut */}
                        {canManagePurchases && (
                          <button
                            type="button"
                            className="btn-action-inward"
                            onClick={() => onNewPurchase(s.id)}
                            title="Receive stock / create purchase inward for this supplier"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                              <polyline points="7 10 12 15 17 10"></polyline>
                              <line x1="12" y1="15" x2="12" y2="3"></line>
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                            </svg>
                            <span>+ Inward</span>
                          </button>
                        )}

                        {/* More Actions Dropdown */}
                        <div className="action-menu-wrap">
                          <button
                            type="button"
                            className="btn-action-more"
                            onClick={() => setActionMenuOpenId(actionMenuOpenId === s.id ? null : s.id)}
                            title="More options"
                          >
                            •••
                          </button>

                          {actionMenuOpenId === s.id && (
                            <>
                              <div
                                className="action-dropdown-backdrop"
                                onClick={() => setActionMenuOpenId(null)}
                              />
                              <div className="action-dropdown-menu">
                                {canManagePurchases && (
                                  <button
                                    type="button"
                                    className="dropdown-item"
                                    onClick={() => {
                                      setActionMenuOpenId(null);
                                      onOpenLedger(s.id);
                                    }}
                                  >
                                    <span>📖 View Running Ledger</span>
                                  </button>
                                )}

                                <button
                                  type="button"
                                  className="dropdown-item"
                                  onClick={() => {
                                    setActionMenuOpenId(null);
                                    onEditSupplier(s);
                                  }}
                                >
                                  <span>✏️ Edit Supplier Details</span>
                                </button>

                                <button
                                  type="button"
                                  className={`dropdown-item ${s.active !== false ? 'danger' : 'success'}`}
                                  onClick={() => {
                                    setActionMenuOpenId(null);
                                    onToggleActive(s);
                                  }}
                                >
                                  <span>{s.active !== false ? '🚫 Deactivate Supplier' : '✓ Activate Supplier'}</span>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {filteredSuppliers.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <div className="supplier-empty-state">
                      <div className="empty-icon-box">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.8">
                          <rect x="1" y="3" width="15" height="13"></rect>
                          <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon>
                          <circle cx="5.5" cy="18.5" r="2.5"></circle>
                          <circle cx="18.5" cy="18.5" r="2.5"></circle>
                        </svg>
                      </div>
                      <h3>No suppliers matched your criteria</h3>
                      <p>Try searching for a different vendor name, phone, or GSTIN.</p>
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

      {/* 4. SUPPLIER 360° PROFILE DRAWER */}
      {selectedSupplier && (
        <div className="supplier-drawer-backdrop" onClick={() => setSelectedSupplier(null)}>
          <div className="supplier-drawer-panel" onClick={(e) => e.stopPropagation()}>
            {/* Drawer Header */}
            <div className="drawer-header">
              <div className="drawer-supplier-title">
                {(() => {
                  const style = getAvatarColor(selectedSupplier.name);
                  return (
                    <div
                      className="drawer-avatar"
                      style={{
                        background: style.bg,
                        color: style.text,
                        borderColor: style.border,
                      }}
                    >
                      {selectedSupplier.name.slice(0, 2).toUpperCase()}
                    </div>
                  );
                })()}
                <div>
                  <h3 className="drawer-name">{selectedSupplier.name}</h3>
                  <div className="drawer-badges">
                    <span className={`status-badge-chip ${selectedSupplier.active !== false ? 'active' : 'inactive'}`}>
                      ● {selectedSupplier.active !== false ? 'Active Supplier' : 'Inactive'}
                    </span>
                    {selectedSupplier.gstin && (
                      <span className="gstin-verified-tag">✓ GST Registered</span>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="drawer-close-btn"
                onClick={() => setSelectedSupplier(null)}
                title="Close Profile"
              >
                ✕
              </button>
            </div>

            {/* Drawer Body */}
            <div className="drawer-body">
              {/* DIGITAL SUPPLIER OUTSTANDING CARD */}
              <div className="supplier-digital-card">
                <div className="card-top-row">
                  <div className="card-brand">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                      <rect x="1" y="3" width="15" height="13"></rect>
                      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon>
                      <circle cx="5.5" cy="18.5" r="2.5"></circle>
                      <circle cx="18.5" cy="18.5" r="2.5"></circle>
                    </svg>
                    <span>{shop?.name ? shop.name.toUpperCase() : 'STORE'} VENDOR DESK</span>
                  </div>
                  <span className="card-badge">PURCHASE MASTER</span>
                </div>

                <div className="card-middle-payable">
                  <div className="card-payable-label">CURRENT OUTSTANDING DUE</div>
                  <div className="card-payable-val mono">
                    {formatRupees(selectedSupplier.payableMinor || 0)}
                  </div>
                  <div className="card-bills-equiv">
                    {(selectedSupplier.payableMinor || 0) > 0 ? (
                      <span>
                        {selectedSupplier.openPurchasesCount || 1} Unpaid Inward Bill{(selectedSupplier.openPurchasesCount || 1) > 1 ? 's' : ''}
                        {selectedSupplier.oldestDueDate ? ` • Due: ${selectedSupplier.oldestDueDate}` : ''}
                      </span>
                    ) : (
                      <span style={{ color: '#86efac' }}>✓ All invoices settled in full</span>
                    )}
                  </div>
                </div>

                <div className="card-bottom-row">
                  <div className="card-holder-info">
                    <span className="c-label">VENDOR NAME</span>
                    <span className="c-name">{selectedSupplier.name.toUpperCase()}</span>
                  </div>
                  <div className="card-phone-info">
                    <span className="c-label">GSTIN / TAX NO</span>
                    <span className="c-phone mono">{selectedSupplier.gstin || 'UNREGISTERED'}</span>
                  </div>
                </div>
              </div>

              {/* Status Alert */}
              {(() => {
                const status = getDueDateStatus(selectedSupplier.oldestDueDate);
                const payable = selectedSupplier.payableMinor || 0;

                if (payable > 0 && status && status.isOverdue) {
                  return (
                    <div className="drawer-alert-card overdue">
                      <span className="alert-emoji">⚠️</span>
                      <div>
                        <div className="alert-title">Payment Overdue</div>
                        <div className="alert-desc">
                          This supplier has bills past due by {status.daysDiff} days. Settle dues promptly to maintain credit terms.
                        </div>
                      </div>
                    </div>
                  );
                } else if (payable > 0) {
                  return (
                    <div className="drawer-alert-card due-soon">
                      <span className="alert-emoji">⏱️</span>
                      <div>
                        <div className="alert-title">Payment Due Soon</div>
                        <div className="alert-desc">
                          Current payment due date: {selectedSupplier.oldestDueDate || 'Upon statement'}.
                        </div>
                      </div>
                    </div>
                  );
                } else {
                  return (
                    <div className="drawer-alert-card settled">
                      <span className="alert-emoji">✓</span>
                      <div>
                        <div className="alert-title">Account In Good Standing</div>
                        <div className="alert-desc">
                          No outstanding dues pending with this vendor.
                        </div>
                      </div>
                    </div>
                  );
                }
              })()}

              {/* Vendor Contact Details */}
              <div className="drawer-section">
                <h4 className="section-heading">Contact &amp; Tax Information</h4>
                <div className="drawer-info-list">
                  <div className="drawer-info-item">
                    <span className="info-key">Phone Number</span>
                    <span className="info-val mono bold">{selectedSupplier.phone || 'Not registered'}</span>
                  </div>
                  {selectedSupplier.email && (
                    <div className="drawer-info-item">
                      <span className="info-key">Email Address</span>
                      <span className="info-val">{selectedSupplier.email}</span>
                    </div>
                  )}
                  {selectedSupplier.gstin && (
                    <div className="drawer-info-item">
                      <span className="info-key">GSTIN Number</span>
                      <span className="info-val mono bold text-indigo">{selectedSupplier.gstin}</span>
                    </div>
                  )}
                  {selectedSupplier.address && (
                    <div className="drawer-info-item">
                      <span className="info-key">Warehouse / Office</span>
                      <span className="info-val">{selectedSupplier.address}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Recent Inward Purchases from this Supplier */}
              {(() => {
                const vendorPurchases = purchases.filter(
                  (p) => p.supplierId === selectedSupplier.id || p.supplierName === selectedSupplier.name
                );

                return (
                  <div className="drawer-section">
                    <h4 className="section-heading">Recent Stock Inwards ({vendorPurchases.length})</h4>
                    <div className="purchases-history-list">
                      {vendorPurchases.length > 0 ? (
                        vendorPurchases.slice(0, 5).map((pur) => (
                          <div key={pur.id} className="history-purchase-row">
                            <div className="history-purchase-left">
                              <span className={`pur-status-dot ${pur.status === 'posted' ? 'received' : 'draft'}`}></span>
                              <div>
                                <div className="history-bill-no">Bill #{pur.billNo || pur.supplierInvoiceNumber || pur.purchaseNumber || pur.id.slice(0, 8)}</div>
                                <div className="history-bill-date">
                                  {pur.bdate || pur.purchaseDate || 'Recent'}
                                </div>
                              </div>
                            </div>
                            <div className="history-purchase-right">
                              <div className="pur-total-val mono">{formatRupees(pur.totalMinor)}</div>
                              <span className={`pur-paid-badge ${(pur.balanceMinor || 0) > 0 ? 'due' : 'paid'}`}>
                                {(pur.balanceMinor || 0) > 0 ? `Due: ${formatRupees(pur.balanceMinor)}` : 'Fully Paid'}
                              </span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="no-purchases-note">
                          No stock inward bills recorded for this supplier yet.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Drawer Quick Action Buttons */}
              <div className="drawer-actions-box">
                {canPayPurchases && (selectedSupplier.payableMinor || 0) > 0 && (
                  <button
                    type="button"
                    className="drawer-btn primary-pay"
                    onClick={() => {
                      onPaySupplier(selectedSupplier);
                      setSelectedSupplier(null);
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
                      <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
                      <line x1="1" y1="10" x2="23" y2="10"></line>
                    </svg>
                    <span>💳 Settle Supplier Dues (FIFO)</span>
                  </button>
                )}

                {canManagePurchases && (
                  <div className="drawer-dual-btn-row">
                    <button
                      type="button"
                      className="drawer-btn secondary"
                      onClick={() => {
                        onNewPurchase(selectedSupplier.id);
                        setSelectedSupplier(null);
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                      </svg>
                      <span>+ New Inward</span>
                    </button>

                    <button
                      type="button"
                      className="drawer-btn secondary"
                      onClick={() => {
                        onOpenLedger(selectedSupplier.id);
                        setSelectedSupplier(null);
                      }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
                      </svg>
                      <span>Ledger Statement</span>
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  className="drawer-btn edit-outline"
                  onClick={() => {
                    onEditSupplier(selectedSupplier);
                    setSelectedSupplier(null);
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                  </svg>
                  <span>Edit Supplier Details</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
