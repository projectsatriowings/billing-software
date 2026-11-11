import React, { useState, useMemo } from 'react';
import type { Invoice, Party, User, Shop } from '../../api.ts';
import type { Branch } from '../../../../shared/types.ts';
import {
  ReceiptIcon,
  PrinterIcon,
  FileTextIcon,
  RotateCcwIcon,
  EyeIcon,
  Building2Icon,
  PhoneIcon,
  CalendarIcon,
  SearchIcon,
  WalletIcon,
  CheckIcon,
  XCircleIcon,
  ClockIcon,
  UserIcon,
  CreditCardIcon,
  BanknoteIcon,
  ZapIcon,
  ArrowLeftIcon,
  ShoppingCartIcon,
  FilterIcon,
  AlertTriangleIcon,
} from '../inventory/InventoryIcons.tsx';

export interface RecentBillsBentoViewProps {
  invoices: Invoice[];
  user: User;
  shop: Shop | null;
  branches: Branch[];
  parties: Party[];
  activeBranch?: Branch | null;
  currentBranchName: string;
  currentBranchCode: string;
  selectedBranchScope: string;
  invoiceFilterDate: string;
  setInvoiceFilterDate: (d: string) => void;
  invoiceBranchFilter: string;
  setInvoiceBranchFilter: (b: string) => void;
  handleGlobalBranchChange: (scope: string) => void;
  formatRupees: (minor: number) => string;
  openInvoiceDetail: (id: string) => void;
  openReturnModal: (id: string) => void;
  handleOpenVoidModal: (params: { id: string; number: string; totalCreditMinor: number; advanceAmountMinor: number }) => void;
  openCollectPayment: (party: Party, invoiceId?: string) => void;
  openWhatsAppResend?: (inv: Invoice) => void;
  handleOpenCreditNoteWhatsApp?: (params: any) => void;
  onNavigateToPos: () => void;
}

export const RecentBillsBentoView: React.FC<RecentBillsBentoViewProps> = ({
  invoices,
  user,
  shop,
  branches,
  parties,
  activeBranch,
  currentBranchName,
  currentBranchCode,
  selectedBranchScope,
  invoiceFilterDate,
  setInvoiceFilterDate,
  invoiceBranchFilter,
  setInvoiceBranchFilter,
  handleGlobalBranchChange,
  formatRupees,
  openInvoiceDetail,
  openReturnModal,
  handleOpenVoidModal,
  openCollectPayment,
  openWhatsAppResend,
  handleOpenCreditNoteWhatsApp,
  onNavigateToPos,
}) => {
  const isCashier = user?.role === 'cashier';
  const [searchQuery, setSearchQuery] = useState('');
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'cash' | 'upi' | 'card'>('all');

  // Dates for quick filter chips
  const todayStr = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, []);

  const yesterdayStr = useMemo(() => {
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    const y = yest.getFullYear();
    const m = String(yest.getMonth() + 1).padStart(2, '0');
    const d = String(yest.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, []);

  // Filter invoices
  const filteredInvoices = useMemo(() => {
    const targetBranchCode = (currentBranchCode || 'MAIN').toUpperCase();
    const targetBranchId = activeBranch?.id || user?.branchId || '';

    return invoices.filter((inv) => {
      // 1. Branch Scope
      if (isCashier) {
        const invBranchCode = ((inv as any).location || '').toUpperCase();
        const invBranchId = inv.branchId || '';
        const matchCashier =
          (invBranchId && invBranchId === targetBranchId) ||
          (invBranchCode && invBranchCode === targetBranchCode) ||
          (!invBranchId && !invBranchCode);
        if (!matchCashier) return false;
      } else {
        if (invoiceBranchFilter && invoiceBranchFilter !== 'all') {
          const matchAdmin =
            inv.branchId === invoiceBranchFilter ||
            (inv as any).location === invoiceBranchFilter;
          if (!matchAdmin) return false;
        }
      }

      // 2. Date Filter
      if (invoiceFilterDate) {
        const invDate = inv.bdate || (inv.createdAt ? inv.createdAt.split('T')[0] : '');
        if (invDate !== invoiceFilterDate) return false;
      }

      // 3. Payment Method Filter
      if (paymentFilter !== 'all') {
        const hasMethod = inv.payments?.some((p: any) =>
          (p.method || '').toLowerCase().includes(paymentFilter.toLowerCase())
        );
        if (!hasMethod) return false;
      }

      // 4. Search Query (Number, Customer Name, Phone)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const numMatch = (inv.number || '').toLowerCase().includes(q);
        const nameMatch = (inv.customerName || '').toLowerCase().includes(q);
        const phoneMatch = (inv.customerPhone || '').toLowerCase().includes(q);
        if (!numMatch && !nameMatch && !phoneMatch) return false;
      }

      return true;
    });
  }, [
    invoices,
    isCashier,
    currentBranchCode,
    activeBranch,
    user,
    invoiceBranchFilter,
    invoiceFilterDate,
    paymentFilter,
    searchQuery,
  ]);

  // Compute Bento KPI Metrics
  const metrics = useMemo(() => {
    const salesInvs = filteredInvoices.filter((i) => i.kind === 'sale' && i.status === 'posted');
    const totalBillsCount = salesInvs.length;
    const totalSalesMinor = salesInvs.reduce((sum, i) => sum + (i.totalMinor || 0), 0);

    let cashMinor = 0;
    let digitalMinor = 0;

    for (const inv of filteredInvoices) {
      if (inv.status === 'posted') {
        for (const p of inv.payments || []) {
          const m = (p.method || '').toLowerCase();
          if (m === 'cash') {
            cashMinor += p.amountMinor || 0;
          } else {
            digitalMinor += p.amountMinor || 0;
          }
        }
      }
    }

    const returnsInvs = filteredInvoices.filter(
      (i) => i.kind === 'credit_note' || i.fullyReturned || ((i.returnedMinor || 0) > 0)
    );
    const returnsMinor = filteredInvoices.reduce((sum, i) => {
      if (i.kind === 'credit_note') return sum + (i.totalMinor || 0);
      return sum + (i.returnedMinor || 0);
    }, 0);

    return {
      totalBillsCount,
      totalSalesMinor,
      cashMinor,
      digitalMinor,
      returnsCount: returnsInvs.length,
      returnsMinor,
    };
  }, [filteredInvoices]);

  return (
    <div className="invoices-bento-root">
      {/* 1. Bento Top Context Strip */}
      <div className="invoices-context-strip">
        <div className="invoices-context-left">
          <div className="invoices-branch-pill">
            <Building2Icon size={14} className="invoices-branch-icon" />
            <span className="invoices-branch-label">Branch:</span>
            <span className="invoices-branch-name">{currentBranchName}</span>
            <span className="invoices-branch-code">({currentBranchCode})</span>
          </div>

          <div className="invoices-status-pill">
            <span className="invoices-live-dot" />
            <span>
              {isCashier ? 'Cashier Register Terminal' : 'Branch Sales Ledger'}
            </span>
          </div>
        </div>

        <div className="invoices-context-right">
          <button
            type="button"
            className="invoices-quick-pos-btn"
            onClick={onNavigateToPos}
            title="Switch back to POS Billing Counter (F1)"
          >
            <ShoppingCartIcon size={14} />
            <span>POS Counter</span>
          </button>
        </div>
      </div>

      {/* 2. Top Bento KPI Summary Cards */}
      <div className="invoices-kpi-grid">
        {/* KPI 1: Total Bills */}
        <div className="invoices-kpi-card">
          <div className="invoices-kpi-top">
            <div className="invoices-kpi-icon-wrap indigo">
              <ReceiptIcon size={20} />
            </div>
            <span className="invoices-kpi-badge indigo">
              {invoiceFilterDate === todayStr ? 'Today' : invoiceFilterDate ? 'Filtered' : 'All Bills'}
            </span>
          </div>
          <div className="invoices-kpi-body">
            <span className="invoices-kpi-label">Total Bills</span>
            <div className="invoices-kpi-value-row">
              <span className="invoices-kpi-value">{metrics.totalBillsCount}</span>
              <span className="invoices-kpi-sub-amount">{formatRupees(metrics.totalSalesMinor)}</span>
            </div>
            <span className="invoices-kpi-sub">Gross sales turnover</span>
          </div>
        </div>

        {/* KPI 2: Cash Sales */}
        <div className="invoices-kpi-card">
          <div className="invoices-kpi-top">
            <div className="invoices-kpi-icon-wrap emerald">
              <BanknoteIcon size={20} />
            </div>
            <span className="invoices-kpi-badge emerald">Drawer</span>
          </div>
          <div className="invoices-kpi-body">
            <span className="invoices-kpi-label">Cash Collected</span>
            <div className="invoices-kpi-value-row">
              <span className="invoices-kpi-value">{formatRupees(metrics.cashMinor)}</span>
            </div>
            <span className="invoices-kpi-sub">Received in cash register</span>
          </div>
        </div>

        {/* KPI 3: Digital Collections */}
        <div className="invoices-kpi-card">
          <div className="invoices-kpi-top">
            <div className="invoices-kpi-icon-wrap violet">
              <CreditCardIcon size={20} />
            </div>
            <span className="invoices-kpi-badge violet">UPI & Card</span>
          </div>
          <div className="invoices-kpi-body">
            <span className="invoices-kpi-label">Digital Non-Cash</span>
            <div className="invoices-kpi-value-row">
              <span className="invoices-kpi-value">{formatRupees(metrics.digitalMinor)}</span>
            </div>
            <span className="invoices-kpi-sub">Bank & QR direct credit</span>
          </div>
        </div>

        {/* KPI 4: Returns / Credit Notes */}
        <div className="invoices-kpi-card">
          <div className="invoices-kpi-top">
            <div className="invoices-kpi-icon-wrap amber">
              <RotateCcwIcon size={20} />
            </div>
            <span className="invoices-kpi-badge amber">Returns</span>
          </div>
          <div className="invoices-kpi-body">
            <span className="invoices-kpi-label">Returns & Refunds</span>
            <div className="invoices-kpi-value-row">
              <span className="invoices-kpi-value">{formatRupees(metrics.returnsMinor)}</span>
            </div>
            <span className="invoices-kpi-sub">{metrics.returnsCount} credit notes issued</span>
          </div>
        </div>
      </div>

      {/* 3. Bento Filter & Live Search Toolbar */}
      <div className="invoices-controls-bar">
        <div className="invoices-controls-left">
          {/* Search Box */}
          <div className="invoices-search-box">
            <SearchIcon size={15} className="invoices-search-icon" />
            <input
              type="text"
              className="invoices-search-input"
              placeholder="Search bill #, customer name, phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                className="invoices-clear-search-btn"
                onClick={() => setSearchQuery('')}
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          {/* Quick Date Presets */}
          <div className="invoices-filter-group">
            <button
              type="button"
              className={`invoices-filter-pill ${invoiceFilterDate === todayStr ? 'active' : ''}`}
              onClick={() => setInvoiceFilterDate(invoiceFilterDate === todayStr ? '' : todayStr)}
            >
              <CalendarIcon size={12} />
              <span>Today</span>
            </button>
            <button
              type="button"
              className={`invoices-filter-pill ${invoiceFilterDate === yesterdayStr ? 'active' : ''}`}
              onClick={() => setInvoiceFilterDate(invoiceFilterDate === yesterdayStr ? '' : yesterdayStr)}
            >
              <ClockIcon size={12} />
              <span>Yesterday</span>
            </button>
            <button
              type="button"
              className={`invoices-filter-pill ${!invoiceFilterDate ? 'active' : ''}`}
              onClick={() => setInvoiceFilterDate('')}
            >
              <span>All Dates</span>
            </button>
            {invoiceFilterDate && invoiceFilterDate !== todayStr && invoiceFilterDate !== yesterdayStr && (
              <span className="invoices-filter-pill active">
                <CalendarIcon size={12} />
                <span>{invoiceFilterDate}</span>
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginLeft: 4, color: 'inherit' }}
                  onClick={() => setInvoiceFilterDate('')}
                >
                  ✕
                </button>
              </span>
            )}
          </div>

          {/* Payment Method Filter */}
          <div className="invoices-filter-group">
            <button
              type="button"
              className={`invoices-filter-pill ${paymentFilter === 'all' ? 'active' : ''}`}
              onClick={() => setPaymentFilter('all')}
            >
              <span>All Modes</span>
            </button>
            <button
              type="button"
              className={`invoices-filter-pill ${paymentFilter === 'cash' ? 'active' : ''}`}
              onClick={() => setPaymentFilter(paymentFilter === 'cash' ? 'all' : 'cash')}
            >
              <BanknoteIcon size={12} />
              <span>Cash</span>
            </button>
            <button
              type="button"
              className={`invoices-filter-pill ${paymentFilter === 'upi' ? 'active' : ''}`}
              onClick={() => setPaymentFilter(paymentFilter === 'upi' ? 'all' : 'upi')}
            >
              <ZapIcon size={12} />
              <span>UPI</span>
            </button>
            <button
              type="button"
              className={`invoices-filter-pill ${paymentFilter === 'card' ? 'active' : ''}`}
              onClick={() => setPaymentFilter(paymentFilter === 'card' ? 'all' : 'card')}
            >
              <CreditCardIcon size={12} />
              <span>Card</span>
            </button>
          </div>
        </div>

        {/* Admin Multi-Branch Filter (Only for Super Admin / Store Manager) */}
        {!isCashier && branches.length > 0 && (
          <div className="invoices-controls-right">
            <div className="invoices-admin-branch-select-wrap">
              <Building2Icon size={13} style={{ color: '#6366f1' }} />
              <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#475569' }}>Branch:</span>
              <select
                className="invoices-branch-dropdown"
                value={invoiceBranchFilter}
                onChange={(e) => {
                  setInvoiceBranchFilter(e.target.value);
                  handleGlobalBranchChange(e.target.value);
                }}
              >
                <option value="all">All Branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* 4. Bento Invoices Table Card */}
      <div className="invoices-bento-table-card">
        {/* Table Header Bar */}
        <div className="invoices-table-header-bar">
          <div className="invoices-table-title-wrap">
            <h3 className="invoices-table-title">
              {isCashier ? 'Recent Cashier Bills' : 'Sales Invoices & Transactions'}
            </h3>
            <span className="invoices-count-badge">
              {filteredInvoices.length} {filteredInvoices.length === 1 ? 'bill' : 'bills'}
            </span>
          </div>

          <div style={{ fontSize: '0.76rem', color: '#64748b', fontWeight: 500 }}>
            {invoiceFilterDate ? `Date: ${invoiceFilterDate}` : 'All Recent Records'}
          </div>
        </div>

        {/* Table Body */}
        {filteredInvoices.length === 0 ? (
          <div className="invoices-empty-state">
            <div className="invoices-empty-icon-wrap">
              <ReceiptIcon size={36} />
            </div>
            <h4 className="invoices-empty-title">No Bills Found</h4>
            <p className="invoices-empty-sub">
              {searchQuery || invoiceFilterDate || paymentFilter !== 'all'
                ? 'No transactions matched the active filters. Try adjusting date or search query.'
                : 'No sales recorded yet for this register station. Go to POS to start billing.'}
            </p>
            <button
              type="button"
              className="invoices-empty-action-btn"
              onClick={onNavigateToPos}
            >
              <ShoppingCartIcon size={15} />
              <span>Open POS Billing Counter</span>
            </button>
          </div>
        ) : (
          <div className="invoices-table-scroller">
            <table className="invoices-bento-table">
              <thead>
                <tr>
                  <th>Invoice No</th>
                  <th>Branch</th>
                  <th>Date & Time</th>
                  <th>Customer / Contact</th>
                  <th style={{ textAlign: 'right' }}>Total Amount</th>
                  <th>Payment</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((inv) => (
                  <tr key={inv.id}>
                    {/* Invoice Number */}
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="bento-bill-btn"
                          onClick={() => openInvoiceDetail(inv.id)}
                          title="Click to view bill items, tax details and credit notes"
                        >
                          <ReceiptIcon size={13} />
                          <span>{inv.number}</span>
                        </button>
                        {inv.kind === 'credit_note' && (
                          <span className="invoices-tag-credit-note">CN</span>
                        )}
                        {inv.status === 'voided' && (
                          <span className="invoices-tag-voided">VOID</span>
                        )}
                      </div>
                    </td>

                    {/* Branch */}
                    <td>
                      <span className="invoices-branch-tag">
                        <Building2Icon size={12} style={{ color: '#6366f1' }} />
                        <span>
                          {branches.find((b) => b.id === inv.branchId || b.code === (inv as any).location)?.code ||
                            currentBranchCode ||
                            'MAIN'}
                        </span>
                      </span>
                    </td>

                    {/* Date & Time */}
                    <td>
                      <div className="invoices-datetime-wrap">
                        <span className="invoices-date-text">
                          {new Date(inv.createdAt).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                        <span className="invoices-time-text">
                          {new Date(inv.createdAt).toLocaleTimeString('en-IN', {
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true,
                          })}
                        </span>
                      </div>
                    </td>

                    {/* Customer */}
                    <td>
                      <div className="invoices-cust-wrap">
                        <div className="invoices-cust-name-row">
                          <UserIcon size={13} style={{ color: '#64748b' }} />
                          <span className="invoices-cust-name">{inv.customerName || 'Walk-in Customer'}</span>
                        </div>
                        {inv.customerPhone && (
                          <div className="invoices-cust-phone-row">
                            <PhoneIcon size={11} style={{ color: '#94a3b8' }} />
                            <span className="invoices-cust-phone">{inv.customerPhone}</span>
                          </div>
                        )}
                        {inv.fullyReturned ? (
                          <span
                            className="invoices-return-status-pill full"
                            onClick={() => openInvoiceDetail(inv.id)}
                            title="Fully returned"
                          >
                            <RotateCcwIcon size={10} />
                            <span>Fully Returned</span>
                          </span>
                        ) : (inv.returnedMinor || 0) > 0 ? (
                          <span
                            className="invoices-return-status-pill partial"
                            onClick={() => openInvoiceDetail(inv.id)}
                            title="Partially returned"
                          >
                            <RotateCcwIcon size={10} />
                            <span>Ret: {formatRupees(inv.returnedMinor || 0)}</span>
                          </span>
                        ) : null}
                      </div>
                    </td>

                    {/* Total Amount */}
                    <td style={{ textAlign: 'right' }}>
                      <span className="invoices-amount-total">
                        {formatRupees(inv.totalMinor)}
                      </span>
                    </td>

                    {/* Payment Method */}
                    <td>
                      <div className="invoices-pmt-wrap">
                        {inv.payments && inv.payments.length > 0 ? (
                          inv.payments.map((p: any, pidx: number) => {
                            const method = (p.method || 'cash').toLowerCase();
                            const isCash = method === 'cash';
                            const isUpi = method.includes('upi') || method.includes('qr');
                            const isCard = method.includes('card');
                            return (
                              <span
                                key={pidx}
                                className={`invoices-pmt-pill ${isCash ? 'cash' : isUpi ? 'upi' : isCard ? 'card' : 'other'}`}
                              >
                                {isCash ? (
                                  <BanknoteIcon size={11} />
                                ) : isUpi ? (
                                  <ZapIcon size={11} />
                                ) : isCard ? (
                                  <CreditCardIcon size={11} />
                                ) : (
                                  <WalletIcon size={11} />
                                )}
                                <span>{p.method}</span>
                              </span>
                            );
                          })
                        ) : (
                          <span className="invoices-pmt-pill cash">
                            <BanknoteIcon size={11} />
                            <span>CASH</span>
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Action Buttons (Strictly Zero Emojis) */}
                    <td>
                      <div className="bento-act-group">
                        {/* 1. View */}
                        <button
                          type="button"
                          className="bento-act-btn view"
                          onClick={() => openInvoiceDetail(inv.id)}
                          title="View bill lines & items"
                        >
                          <EyeIcon size={13} />
                          <span>View</span>
                        </button>

                        {/* 2. Thermal Print */}
                        <a
                          href={
                            inv.kind === 'credit_note'
                              ? `/api/credit-notes/${inv.id}/print?paper=thermal80&autoprint=true`
                              : `/api/invoices/${inv.id}/print?paper=thermal80&autoprint=true`
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="bento-act-btn thermal"
                          title="Print 80mm thermal receipt"
                        >
                          <PrinterIcon size={13} />
                          <span>Thermal</span>
                        </a>

                        {/* 3. A4 GST Print */}
                        <a
                          href={
                            inv.kind === 'credit_note'
                              ? `/api/credit-notes/${inv.id}/print?paper=a4`
                              : `/api/invoices/${inv.id}/print?paper=a4`
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="bento-act-btn a4"
                          title="Print official A4 GST tax invoice"
                        >
                          <FileTextIcon size={13} />
                          <span>A4 GST</span>
                        </a>

                        {/* 4. Return / Credit Note */}
                        {inv.kind !== 'credit_note' && inv.status !== 'cancelled' && (
                          <button
                            type="button"
                            className="bento-act-btn return"
                            disabled={Boolean(inv.fullyReturned)}
                            onClick={() => openReturnModal(inv.id)}
                            title={inv.fullyReturned ? 'Fully returned' : 'Issue sales return or credit note'}
                          >
                            <RotateCcwIcon size={13} />
                            <span>Return / CN</span>
                          </button>
                        )}

                        {/* 6. Void (Owner / Manager on Credit Note) */}
                        {inv.kind === 'credit_note' && inv.status !== 'voided' && (user?.role === 'owner' || user?.role === 'manager') && (
                          <button
                            type="button"
                            className="bento-act-btn void"
                            onClick={() =>
                              handleOpenVoidModal({
                                id: inv.id,
                                number: inv.number,
                                totalCreditMinor: inv.totalMinor,
                                advanceAmountMinor: 0,
                              })
                            }
                            title="Void this credit note (Manager only)"
                          >
                            <XCircleIcon size={13} />
                            <span>Void</span>
                          </button>
                        )}

                        {/* 7. Collect Payment (if unpaid balance due) */}
                        {inv.balanceMinor > 0 && inv.status === 'posted' && inv.partyId && (
                          <button
                            type="button"
                            className="bento-act-btn collect"
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
                            title="Collect balance payment towards this bill"
                          >
                            <WalletIcon size={13} />
                            <span>Collect</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
