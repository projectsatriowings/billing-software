import React, { useState, useEffect, useMemo } from 'react';
import {
  getToken,
  fetchExpenses,
  fetchExpenseCategories,
  createExpense,
  updateExpense,
  voidExpense,
  calcExpense,
  STANDARD_EXPENSE_CATEGORIES,
  type Expense,
  type ExpenseCategory,
  type GstTreatment,
  type ItcEligibility,
} from '../../api.ts';
import { fmtMoney } from '../../../../shared/money.ts';
import { validateGstin } from '../../../../shared/tax.ts';

type DatePreset = 'all' | 'today' | 'this_month' | 'last_month' | 'this_quarter' | 'this_fy' | 'custom';

function getPresetDateRange(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  switch (preset) {
    case 'today': {
      const todayStr = fmt(now);
      return { from: todayStr, to: todayStr };
    }
    case 'this_month': {
      const first = new Date(year, month, 1);
      const last = new Date(year, month + 1, 0);
      return { from: fmt(first), to: fmt(last) };
    }
    case 'last_month': {
      const first = new Date(year, month - 1, 1);
      const last = new Date(year, month, 0);
      return { from: fmt(first), to: fmt(last) };
    }
    case 'this_quarter': {
      const qStart = Math.floor(month / 3) * 3;
      const first = new Date(year, qStart, 1);
      const last = new Date(year, qStart + 3, 0);
      return { from: fmt(first), to: fmt(last) };
    }
    case 'this_fy': {
      // Indian Financial Year: Apr 1 - Mar 31
      const fyStartYear = month >= 3 ? year : year - 1;
      const first = new Date(fyStartYear, 3, 1);
      const last = new Date(fyStartYear + 1, 3, 0);
      return { from: fmt(first), to: fmt(last) };
    }
    case 'all':
    default:
      return { from: '', to: '' };
  }
}

function formatDateDisplay(dStr: string): string {
  if (!dStr) return '';
  const parts = dStr.split('-');
  if (parts.length !== 3) return dStr;
  const year = parts[0];
  const monthNum = parseInt(parts[1], 10) - 1;
  const day = parts[2];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${months[monthNum] || parts[1]} ${year}`;
}

interface ExpensesViewProps {
  userRole?: string;
  userLocation?: string;
  suppliers?: { id: string; name: string; gstin?: string | null }[];
}

export function ExpensesView({ userRole, userLocation, suppliers = [] }: ExpensesViewProps) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Filters & Datebar
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [treatmentFilter, setTreatmentFilter] = useState('ALL');
  const [itcFilter, setItcFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Summary Metrics
  const [summary, setSummary] = useState({
    totalMinor: 0,
    taxableMinor: 0,
    totalGstMinor: 0,
    itcMinor: 0,
    paidMinor: 0,
    balanceMinor: 0,
  });

  // Modal States
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [viewingExpense, setViewingExpense] = useState<Expense | null>(null);
  const [voidingExpense, setVoidingExpense] = useState<Expense | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
  const [formCategory, setFormCategory] = useState<ExpenseCategory>('rent');
  const [formDesc, setFormDesc] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formSupplierId, setFormSupplierId] = useState('');
  const [formSupplierName, setFormSupplierName] = useState('');
  const [formSupplierGstin, setFormSupplierGstin] = useState('');
  const [formInvoiceNumber, setFormInvoiceNumber] = useState('');
  const [formInvoiceDate, setFormInvoiceDate] = useState('');
  const [formAmountRupees, setFormAmountRupees] = useState('');
  const [formTaxInclusive, setFormTaxInclusive] = useState(false);
  const [formTaxRateBp, setFormTaxRateBp] = useState<number>(0);
  const [formPaymentMethod, setFormPaymentMethod] = useState<'cash' | 'upi' | 'card' | 'bank' | 'cheque'>('cash');
  const [formPaymentStatus, setFormPaymentStatus] = useState<'paid' | 'unpaid' | 'partial'>('paid');
  const [formPaidRupees, setFormPaidRupees] = useState('');
  const [formGstTreatment, setFormGstTreatment] = useState<GstTreatment>('exempt');
  const [formItcEligibility, setFormItcEligibility] = useState<ItcEligibility>('ineligible');

  const canWrite = userRole === 'owner' || userRole === 'manager' || userRole === 'accountant';
  const canVoid = userRole === 'owner' || userRole === 'manager';

  const loadExpenses = async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = { page: String(page), limit: '25' };
      if (from) params.from = from;
      if (to) params.to = to;
      if (categoryFilter !== 'ALL') params.category = categoryFilter;
      if (statusFilter !== 'ALL') params.paymentStatus = statusFilter;
      if (treatmentFilter !== 'ALL') params.gstTreatment = treatmentFilter;
      if (itcFilter !== 'ALL') params.itcEligibility = itcFilter;
      if (searchQuery.trim()) params.q = searchQuery.trim();

      const res = await fetchExpenses(params);
      setExpenses(res.expenses);
      setTotalCount(res.totalCount);
      setSummary(res.summary);
    } catch (err: any) {
      setError(err?.message || 'Failed to load expenses');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExpenses();
  }, [from, to, categoryFilter, statusFilter, treatmentFilter, itcFilter, page]);

  // Live Tax Calculation in Form
  const parsedAmountMinor = Math.round((parseFloat(formAmountRupees) || 0) * 100);
  let liveCalc = {
    taxableMinor: parsedAmountMinor,
    cgstMinor: 0,
    sgstMinor: 0,
    igstMinor: 0,
    totalGstMinor: 0,
    totalMinor: parsedAmountMinor,
    itcMinor: 0,
  };
  try {
    if (parsedAmountMinor > 0) {
      liveCalc = calcExpense({
        amountMinor: parsedAmountMinor,
        taxInclusive: formTaxInclusive,
        taxRateBp: formTaxRateBp,
        intraState: true,
        gstTreatment: formGstTreatment,
        itcEligibility: formItcEligibility,
      });
    }
  } catch {}

  const handleOpenNew = () => {
    setEditingExpense(null);
    setFormDate(new Date().toISOString().slice(0, 10));
    setFormCategory('rent');
    setFormDesc('');
    setFormNotes('');
    setFormSupplierId('');
    setFormSupplierName('');
    setFormSupplierGstin('');
    setFormInvoiceNumber('');
    setFormInvoiceDate('');
    setFormAmountRupees('');
    setFormTaxInclusive(false);
    setFormTaxRateBp(0);
    setFormPaymentMethod('cash');
    setFormPaymentStatus('paid');
    setFormPaidRupees('');
    setFormGstTreatment('exempt');
    setFormItcEligibility('ineligible');
    setShowFormModal(true);
  };

  const handleOpenEdit = (exp: Expense) => {
    setEditingExpense(exp);
    setFormDate(exp.expenseDate);
    setFormCategory((exp.category as any) || 'rent');
    setFormDesc(exp.description || '');
    setFormNotes(exp.notes || '');
    setFormSupplierId(exp.supplierId || '');
    setFormSupplierName(exp.supplierName || '');
    setFormSupplierGstin(exp.supplierGstin || '');
    setFormInvoiceNumber(exp.supplierInvoiceNumber || '');
    setFormInvoiceDate(exp.supplierInvoiceDate || '');
    setFormAmountRupees(
      (exp.taxInclusive ? exp.totalMinor / 100 : exp.taxableMinor / 100).toFixed(2),
    );
    setFormTaxInclusive(exp.taxInclusive);
    setFormTaxRateBp(exp.taxRateBp);
    setFormPaymentMethod((exp.paymentMethod as any) || 'cash');
    setFormPaymentStatus(exp.paymentStatus);
    setFormPaidRupees((exp.paidMinor / 100).toFixed(2));
    setFormGstTreatment(exp.gstTreatment);
    setFormItcEligibility(exp.itcEligibility);
    setShowFormModal(true);
  };

  const handleCategoryChange = (cat: ExpenseCategory) => {
    setFormCategory(cat);
    const standard = STANDARD_EXPENSE_CATEGORIES.find((c) => c.id === cat);
    if (standard) {
      setFormGstTreatment(standard.defaultGstTreatment);
      setFormItcEligibility(standard.defaultItcEligibility);
    }
  };

  const handleSupplierSelect = (supId: string) => {
    setFormSupplierId(supId);
    const sup = suppliers.find((s) => s.id === supId);
    if (sup) {
      setFormSupplierName(sup.name);
      setFormSupplierGstin(sup.gstin || '');
      if (sup.gstin) {
        setFormGstTreatment('regular');
      }
    }
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (parsedAmountMinor <= 0) {
      alert('Please enter a valid expense amount greater than zero.');
      return;
    }

    if (formSupplierGstin && formSupplierGstin.trim()) {
      const gstinVal = validateGstin(formSupplierGstin.trim());
      if (!gstinVal.ok) {
        alert(`Supplier GSTIN error: ${gstinVal.reason}`);
        return;
      }
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const paidMinor =
        formPaymentStatus === 'paid'
          ? liveCalc.totalMinor
          : formPaymentStatus === 'unpaid'
            ? 0
            : Math.round((parseFloat(formPaidRupees) || 0) * 100);

      const payload = {
        expenseDate: formDate,
        category: formCategory,
        description: formDesc || undefined,
        notes: formNotes || undefined,
        supplierId: formSupplierId || undefined,
        supplierName: formSupplierName || undefined,
        supplierGstin: formSupplierGstin || undefined,
        supplierInvoiceNumber: formInvoiceNumber || undefined,
        supplierInvoiceDate: formInvoiceDate || undefined,
        amountMinor: parsedAmountMinor,
        taxInclusive: formTaxInclusive,
        taxRateBp: formTaxRateBp,
        paymentMethod: formPaymentMethod,
        paymentStatus: formPaymentStatus,
        paidMinor,
        gstTreatment: formGstTreatment,
        itcEligibility: formItcEligibility,
      };

      if (editingExpense) {
        await updateExpense(editingExpense.id, payload);
        setSuccessMsg(`Expense ${editingExpense.expenseNumber} updated successfully.`);
      } else {
        const res = await createExpense(payload);
        setSuccessMsg(`Expense ${res.expense.expenseNumber} recorded successfully.`);
      }

      setShowFormModal(false);
      loadExpenses();
    } catch (err: any) {
      alert(err?.message || 'Failed to save expense');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmVoid = async () => {
    if (!voidingExpense) return;
    if (!voidReason.trim()) {
      alert('Please enter a reason for voiding this expense.');
      return;
    }
    setIsSubmitting(true);
    try {
      await voidExpense(voidingExpense.id, voidReason.trim());
      setSuccessMsg(`Expense ${voidingExpense.expenseNumber} has been voided.`);
      setVoidingExpense(null);
      setVoidReason('');
      loadExpenses();
    } catch (err: any) {
      alert(err?.message || 'Failed to void expense');
    } finally {
      setIsSubmitting(false);
    }
  };

  const [isExporting, setIsExporting] = useState(false);

  const handleExportCsv = async () => {
    try {
      setIsExporting(true);
      const token = getToken();
      const q = new URLSearchParams();
      if (from) q.set('from', from);
      if (to) q.set('to', to);
      if (categoryFilter !== 'ALL') q.set('category', categoryFilter);
      if (token) q.set('token', token);

      const res = await fetch(`/api/expenses/export?${q.toString()}`, {
        method: 'GET',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || errJson?.message || `Export failed (HTTP ${res.status})`);
      }

      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition');
      let filename = `Expense_Register_${from || 'ALL'}_to_${to || 'ALL'}.csv`;
      if (disposition && disposition.includes('filename=')) {
        const match = disposition.match(/filename="?([^";]+)"?/);
        if (match && match[1]) filename = match[1];
      }

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err?.message || 'Failed to download Expense CSV');
    } finally {
      setIsExporting(false);
    }
  };

  // Custom Date Modal state
  const [showDateModal, setShowDateModal] = useState(false);
  const [modalYear, setModalYear] = useState(() => new Date().getFullYear());
  const [modalFrom, setModalFrom] = useState('');
  const [modalTo, setModalTo] = useState('');

  const handleSelectPreset = (p: DatePreset) => {
    setDatePreset(p);
    const range = getPresetDateRange(p);
    setFrom(range.from);
    setTo(range.to);
    setPage(1);
  };

  const handleOpenDateModal = () => {
    setModalFrom(from);
    setModalTo(to);
    if (from) {
      const y = parseInt(from.split('-')[0], 10);
      if (!isNaN(y)) setModalYear(y);
    } else {
      setModalYear(new Date().getFullYear());
    }
    setShowDateModal(true);
  };

  const handleSelectMonth = (mIndex: number) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const first = `${modalYear}-${pad(mIndex + 1)}-01`;
    const lastDay = new Date(modalYear, mIndex + 1, 0).getDate();
    const last = `${modalYear}-${pad(mIndex + 1)}-${pad(lastDay)}`;
    setFrom(first);
    setTo(last);
    setDatePreset('custom');
    setShowDateModal(false);
    setPage(1);
  };

  const handleApplyCustomModalRange = () => {
    setFrom(modalFrom);
    setTo(modalTo);
    setDatePreset('custom');
    setShowDateModal(false);
    setPage(1);
  };

  const handleClearFilters = () => {
    setDatePreset('all');
    setFrom('');
    setTo('');
    setCategoryFilter('ALL');
    setStatusFilter('ALL');
    setTreatmentFilter('ALL');
    setItcFilter('ALL');
    setSearchQuery('');
    setPage(1);
  };

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (from || to) count++;
    if (categoryFilter !== 'ALL') count++;
    if (statusFilter !== 'ALL') count++;
    if (treatmentFilter !== 'ALL') count++;
    if (itcFilter !== 'ALL') count++;
    if (searchQuery.trim()) count++;
    return count;
  }, [from, to, categoryFilter, statusFilter, treatmentFilter, itcFilter, searchQuery]);

  const totalPages = Math.ceil(totalCount / 25) || 1;

  return (
    <div className="expense-view-root">
      {/* Top Action Toolbar */}
      <div className="expense-top-toolbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            background: '#f3f0ff',
            color: '#6d4aff',
            padding: '0.35rem 0.85rem',
            borderRadius: '9999px',
            fontSize: '0.8rem',
            fontWeight: 700,
            border: '1px solid #ede9fe',
          }}>
            ⚡ Expense Register &amp; ITC Tracker
          </span>
          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
            • {totalCount} total entries recorded
          </span>
        </div>

        <div className="expense-toolbar-actions">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={isExporting}
            title="Download Expense Register CSV"
            style={{
              background: '#ffffff',
              color: '#334155',
              border: '1.5px solid #cbd5e1',
              borderRadius: '10px',
              padding: '0.5rem 0.95rem',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: isExporting ? 'wait' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              opacity: isExporting ? 0.7 : 1,
            }}
          >
            {isExporting ? '⏳ Exporting...' : '📥 Export CSV'}
          </button>
          <button
            type="button"
            onClick={loadExpenses}
            title="Refresh records"
            style={{
              background: '#ffffff',
              color: '#334155',
              border: '1.5px solid #cbd5e1',
              borderRadius: '10px',
              padding: '0.5rem 0.95rem',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
          >
            🔄 Refresh
          </button>
          {canWrite && (
            <button
              type="button"
              onClick={handleOpenNew}
              style={{
                background: 'linear-gradient(135deg, #6d4aff 0%, #4f46e5 100%)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '10px',
                padding: '0.5rem 1.15rem',
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                boxShadow: '0 4px 14px rgba(109, 74, 255, 0.35)',
              }}
            >
              ➕ Record Expense
            </button>
          )}
        </div>
      </div>

      {/* Success & Error alerts */}
      {successMsg && (
        <div style={{ background: '#dcfce7', border: '1px solid #86efac', color: '#166534', padding: '0.75rem 1rem', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600 }}>✅ {successMsg}</span>
          <button type="button" onClick={() => setSuccessMsg(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold', color: '#166534' }}>✕</button>
        </div>
      )}
      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', padding: '0.75rem 1rem', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 600 }}>⚠️ {error}</span>
          <button type="button" onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 'bold', color: '#991b1b' }}>✕</button>
        </div>
      )}

      {/* Summary KPI Cards Grid (Fully Responsive) */}
      <div className="expense-kpi-grid">
        {/* Card 1: Total Expenses */}
        <div className="expense-kpi-card" style={{ border: '1.5px solid #e0e7ff' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'linear-gradient(90deg, #6d4aff, #818cf8)' }} />
          <div className="expense-kpi-top">
            <span className="expense-kpi-label" style={{ color: '#4338ca' }}>
              Total Expenses
            </span>
            <span style={{ fontSize: '1.1rem' }}>💼</span>
          </div>
          <div className="expense-kpi-value" style={{ color: '#1e1b4b' }}>
            {fmtMoney(summary.totalMinor)}
          </div>
          <div className="expense-kpi-sub" style={{ color: '#6366f1' }}>
            {totalCount} voucher{totalCount === 1 ? '' : 's'} recorded
          </div>
        </div>

        {/* Card 2: Taxable Value */}
        <div className="expense-kpi-card" style={{ border: '1.5px solid #bfdbfe' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'linear-gradient(90deg, #3b82f6, #60a5fa)' }} />
          <div className="expense-kpi-top">
            <span className="expense-kpi-label" style={{ color: '#1d4ed8' }}>
              Taxable Value
            </span>
            <span style={{ fontSize: '1.1rem' }}>📄</span>
          </div>
          <div className="expense-kpi-value" style={{ color: '#2563eb' }}>
            {fmtMoney(summary.taxableMinor)}
          </div>
          <div className="expense-kpi-sub" style={{ color: '#64748b' }}>
            Base overhead cost
          </div>
        </div>

        {/* Card 3: Total GST */}
        <div className="expense-kpi-card" style={{ border: '1.5px solid #fde68a' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'linear-gradient(90deg, #f59e0b, #fbbf24)' }} />
          <div className="expense-kpi-top">
            <span className="expense-kpi-label" style={{ color: '#b45309' }}>
              Expense GST
            </span>
            <span style={{ fontSize: '1.1rem' }}>🏛️</span>
          </div>
          <div className="expense-kpi-value" style={{ color: '#d97706' }}>
            {fmtMoney(summary.totalGstMinor)}
          </div>
          <div className="expense-kpi-sub" style={{ color: '#92400e' }}>
            CGST + SGST + IGST
          </div>
        </div>

        {/* Card 4: Eligible ITC Claimed */}
        <div className="expense-kpi-card" style={{ border: '1.5px solid #a7f3d0' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'linear-gradient(90deg, #10b981, #34d399)' }} />
          <div className="expense-kpi-top">
            <span className="expense-kpi-label" style={{ color: '#047857' }}>
              Eligible ITC Claimed
            </span>
            <span style={{ fontSize: '1.1rem' }}>⚖️</span>
          </div>
          <div className="expense-kpi-value" style={{ color: '#059669' }}>
            {fmtMoney(summary.itcMinor)}
          </div>
          <div className="expense-kpi-sub" style={{ color: '#065f46' }}>
            Credit claimable on GSTR-3B
          </div>
        </div>

        {/* Card 5: Paid / Balance */}
        <div className="expense-kpi-card" style={{ border: '1.5px solid #fecdd3' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'linear-gradient(90deg, #f43f5e, #fb7185)' }} />
          <div className="expense-kpi-top">
            <span className="expense-kpi-label" style={{ color: '#be123c' }}>
              Paid vs Due
            </span>
            <span style={{ fontSize: '1.1rem' }}>💳</span>
          </div>
          <div className="expense-kpi-value" style={{ color: '#0f172a' }}>
            {fmtMoney(summary.paidMinor)}
          </div>
          <div className="expense-kpi-sub" style={{ color: summary.balanceMinor > 0 ? '#dc2626' : '#166534' }}>
            {summary.balanceMinor > 0 ? `Unpaid: ${fmtMoney(summary.balanceMinor)}` : 'All Paid In Full'}
          </div>
        </div>
      </div>

      {/* Datebar & Filters Container Card */}
      <div className="expense-filter-card">
        {/* Tier 1: Period Presets & Interactive Custom Date Trigger */}
        <div className="expense-datebar-tier">
          {/* Preset Buttons */}
          <div className="expense-preset-scroll">
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em', marginRight: '0.2rem', whiteSpace: 'nowrap' }}>
              Period:
            </span>
            {([
              { id: 'all', label: 'All Time' },
              { id: 'today', label: 'Today' },
              { id: 'this_month', label: 'This Month' },
              { id: 'last_month', label: 'Last Month' },
              { id: 'this_quarter', label: 'This Quarter' },
              { id: 'this_fy', label: 'This FY' },
            ] as const).map((p) => {
              const active = datePreset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectPreset(p.id)}
                  className="expense-preset-btn"
                  style={{
                    border: active ? '1.5px solid #6d4aff' : '1.5px solid #e2e8f0',
                    background: active ? '#6d4aff' : '#f8f7ff',
                    color: active ? '#ffffff' : '#475569',
                    boxShadow: active ? '0 2px 6px rgba(109, 74, 255, 0.3)' : 'none',
                  }}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Custom Date Range Trigger (replaces raw input calendar!) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleOpenDateModal}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                background: datePreset === 'custom' || from || to ? '#f3f0ff' : '#ffffff',
                border: datePreset === 'custom' || from || to ? '1.5px solid #6d4aff' : '1.5px solid #cbd5e1',
                borderRadius: '8px',
                padding: '0.4rem 0.85rem',
                fontSize: '0.82rem',
                fontWeight: 600,
                color: datePreset === 'custom' || from || to ? '#6d4aff' : '#334155',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}
              title="Click to select custom dates or pick by month"
            >
              <span style={{ fontSize: '0.9rem' }}>📅</span>
              <span>
                {from && to
                  ? `${formatDateDisplay(from)} → ${formatDateDisplay(to)}`
                  : from
                    ? `From ${formatDateDisplay(from)}`
                    : to
                      ? `Until ${formatDateDisplay(to)}`
                      : 'Pick Custom Date Range...'}
              </span>
              <span style={{ fontSize: '0.65rem', marginLeft: '0.15rem', color: '#6d4aff' }}>▼</span>
            </button>
            {(from || to) && (
              <button
                type="button"
                onClick={() => handleSelectPreset('all')}
                style={{
                  background: '#f1f5f9',
                  border: '1px solid #cbd5e1',
                  borderRadius: '50%',
                  width: '26px',
                  height: '26px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                  color: '#64748b',
                }}
                title="Reset date filter"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: '1px', background: '#f1f5f9' }} />

        {/* Tier 2: Category, Payment, ITC & Search Filter (Fully Responsive Grid) */}
        <div className="expense-filter-grid">
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Category
            </label>
            <select
              value={categoryFilter}
              onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
              style={{
                width: '100%',
                padding: '0.5rem 0.65rem',
                fontSize: '0.85rem',
                borderRadius: '8px',
                border: '1.5px solid #cbd5e1',
                background: '#ffffff',
                color: '#1e293b',
                outline: 'none',
              }}
            >
              <option value="ALL">All Categories</option>
              {STANDARD_EXPENSE_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Payment Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              style={{
                width: '100%',
                padding: '0.5rem 0.65rem',
                fontSize: '0.85rem',
                borderRadius: '8px',
                border: '1.5px solid #cbd5e1',
                background: '#ffffff',
                color: '#1e293b',
                outline: 'none',
              }}
            >
              <option value="ALL">All Payment Status</option>
              <option value="paid">Paid</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partial</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              ITC Eligibility
            </label>
            <select
              value={itcFilter}
              onChange={(e) => { setItcFilter(e.target.value); setPage(1); }}
              style={{
                width: '100%',
                padding: '0.5rem 0.65rem',
                fontSize: '0.85rem',
                borderRadius: '8px',
                border: '1.5px solid #cbd5e1',
                background: '#ffffff',
                color: '#1e293b',
                outline: 'none',
              }}
            >
              <option value="ALL">All ITC Status</option>
              <option value="eligible">Eligible ITC</option>
              <option value="ineligible">Ineligible</option>
              <option value="blocked_17_5">Blocked 17(5)</option>
              <option value="pending_review">Pending Review</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#475569', marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Search Records
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder="Search expense #, vendor, invoice..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadExpenses()}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.65rem 0.5rem 2.2rem',
                  fontSize: '0.85rem',
                  borderRadius: '8px',
                  border: '1.5px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#1e293b',
                  outline: 'none',
                }}
              />
              <span style={{ position: 'absolute', left: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: '0.9rem' }}>
                🔍
              </span>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(''); }}
                  style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '0.8rem' }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {activeFilterCount > 0 && (
            <div style={{ alignSelf: 'flex-end' }}>
              <button
                type="button"
                onClick={handleClearFilters}
                style={{
                  background: '#fef2f2',
                  color: '#dc2626',
                  border: '1.5px solid #fecaca',
                  borderRadius: '8px',
                  padding: '0.45rem 0.85rem',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  height: '38px',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
                title="Reset all filters"
              >
                <span>Reset</span>
                <span style={{ background: '#dc2626', color: '#fff', fontSize: '0.7rem', padding: '0.1rem 0.35rem', borderRadius: '9999px', fontWeight: 700 }}>
                  {activeFilterCount}
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Expense Table Card */}
      <div style={{ background: '#ffffff', borderRadius: '14px', border: '1.5px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 2px 8px rgba(49, 46, 129, 0.04)' }}>
        {loading ? (
          <div style={{ padding: '3.5rem 1.5rem', textAlign: 'center', color: '#64748b' }}>
            <span style={{ fontSize: '1.75rem', display: 'block', marginBottom: '0.5rem' }}>⏳</span>
            <div style={{ fontWeight: 600, color: '#334155' }}>Loading expense records...</div>
          </div>
        ) : expenses.length === 0 ? (
          <div style={{ padding: '3.5rem 1.5rem', textAlign: 'center', background: '#fafbfc' }}>
            <div style={{
              width: '56px',
              height: '56px',
              margin: '0 auto 1rem',
              borderRadius: '16px',
              background: '#f1f5f9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.75rem',
            }}>
              📂
            </div>
            <h4 style={{ margin: '0 0 0.35rem', fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>
              No expenses found
            </h4>
            <p style={{ margin: '0 auto 1.25rem', maxWidth: '420px', fontSize: '0.875rem', color: '#64748b', lineHeight: 1.5 }}>
              {activeFilterCount > 0
                ? 'No expense records match the applied date range or category filters. Try resetting the filters to view all entries.'
                : 'No operational expenses have been recorded yet. Click below to record your first business expense.'}
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  style={{
                    background: '#ffffff',
                    color: '#334155',
                    border: '1.5px solid #cbd5e1',
                    borderRadius: '10px',
                    padding: '0.5rem 1rem',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  🔄 Reset Filters
                </button>
              )}
              {canWrite && (
                <button
                  type="button"
                  onClick={handleOpenNew}
                  style={{
                    background: 'linear-gradient(135deg, #6d4aff 0%, #4f46e5 100%)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '0.5rem 1.15rem',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(109, 74, 255, 0.35)',
                  }}
                >
                  ➕ Record New Expense
                </button>
              )}
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1.5px solid #e2e8f0', color: '#475569', fontWeight: '700', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '0.85rem 1rem' }}>Expense #</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Date</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Category</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Vendor / Supplier</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Invoice / Ref</th>
                  <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Taxable</th>
                  <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>GST</th>
                  <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Total</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Payment</th>
                  <th style={{ padding: '0.85rem 1rem' }}>ITC Status</th>
                  <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((exp) => {
                  const isVoided = exp.status === 'voided';
                  const catObj = STANDARD_EXPENSE_CATEGORIES.find((c) => c.id === exp.category);
                  const catLabel = catObj?.label || exp.category;

                  return (
                    <tr
                      key={exp.id}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        opacity: isVoided ? 0.6 : 1,
                        background: isVoided ? '#fafafa' : '#ffffff',
                      }}
                    >
                      <td style={{ padding: '0.85rem 1rem', fontWeight: '700', color: '#1e1b4b' }}>
                        {exp.expenseNumber}
                        {isVoided && (
                          <span style={{ marginLeft: '0.4rem', background: '#fee2e2', color: '#991b1b', fontSize: '0.65rem', padding: '0.15rem 0.4rem', borderRadius: '4px', textTransform: 'uppercase', fontWeight: 700 }}>
                            Voided
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '0.85rem 1rem', color: '#475569', whiteSpace: 'nowrap' }}>{exp.expenseDate}</td>
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <span style={{ background: '#f8f7ff', color: '#4338ca', border: '1px solid #e0e7ff', padding: '0.2rem 0.55rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: '600' }}>
                          {catLabel}
                        </span>
                      </td>
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <div style={{ fontWeight: '600', color: '#1e293b' }}>{exp.supplierName || '—'}</div>
                        {exp.supplierGstin && (
                          <div style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: 'monospace' }}>
                            {exp.supplierGstin}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '0.85rem 1rem', color: '#475569' }}>
                        {exp.supplierInvoiceNumber ? (
                          <>
                            <div style={{ fontWeight: 600 }}>{exp.supplierInvoiceNumber}</div>
                            {exp.supplierInvoiceDate && (
                              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{exp.supplierInvoiceDate}</div>
                            )}
                          </>
                        ) : (
                          <span style={{ color: '#cbd5e1' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '0.85rem 1rem', textAlign: 'right', color: '#334155', fontFamily: 'monospace' }}>
                        {fmtMoney(exp.taxableMinor)}
                      </td>
                      <td style={{ padding: '0.85rem 1rem', textAlign: 'right', color: '#d97706', fontWeight: '600', fontFamily: 'monospace' }}>
                        {fmtMoney(exp.cgstMinor + exp.sgstMinor + exp.igstMinor)}
                      </td>
                      <td style={{ padding: '0.85rem 1rem', textAlign: 'right', fontWeight: '800', color: '#0f172a', fontFamily: 'monospace' }}>
                        {fmtMoney(exp.totalMinor)}
                      </td>
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '0.2rem 0.5rem',
                            borderRadius: '6px',
                            fontSize: '0.72rem',
                            fontWeight: '700',
                            textTransform: 'uppercase',
                            background:
                              exp.paymentStatus === 'paid'
                                ? '#dcfce7'
                                : exp.paymentStatus === 'partial'
                                  ? '#fef3c7'
                                  : '#fee2e2',
                            color:
                              exp.paymentStatus === 'paid'
                                ? '#166534'
                                : exp.paymentStatus === 'partial'
                                  ? '#92400e'
                                  : '#991b1b',
                          }}
                        >
                          {exp.paymentStatus} ({exp.paymentMethod})
                        </span>
                      </td>
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '0.2rem 0.5rem',
                            borderRadius: '6px',
                            fontSize: '0.72rem',
                            fontWeight: '700',
                            background:
                              exp.itcEligibility === 'eligible'
                                ? '#e0f2fe'
                                : exp.itcEligibility === 'blocked_17_5'
                                  ? '#fee2e2'
                                  : '#f1f5f9',
                            color:
                              exp.itcEligibility === 'eligible'
                                ? '#0369a1'
                                : exp.itcEligibility === 'blocked_17_5'
                                  ? '#b91c1c'
                                  : '#475569',
                          }}
                        >
                          {exp.itcEligibility === 'blocked_17_5' ? 'Blocked 17(5)' : exp.itcEligibility}
                        </span>
                        {exp.itcMinor > 0 && (
                          <div style={{ fontSize: '0.72rem', color: '#059669', fontWeight: '600', marginTop: '0.15rem', fontFamily: 'monospace' }}>
                            {fmtMoney(exp.itcMinor)}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '0.85rem 1rem', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        <button
                          type="button"
                          onClick={() => setViewingExpense(exp)}
                          style={{
                            marginRight: '0.35rem',
                            padding: '0.25rem 0.5rem',
                            fontSize: '0.8rem',
                            background: '#ffffff',
                            border: '1.5px solid #cbd5e1',
                            borderRadius: '6px',
                            cursor: 'pointer',
                          }}
                          title="View Details"
                        >
                          👁️
                        </button>
                        {canWrite && !isVoided && (
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(exp)}
                            style={{
                              marginRight: '0.35rem',
                              padding: '0.25rem 0.5rem',
                              fontSize: '0.8rem',
                              background: '#ffffff',
                              border: '1.5px solid #cbd5e1',
                              borderRadius: '6px',
                              cursor: 'pointer',
                            }}
                            title="Edit Expense"
                          >
                            ✏️
                          </button>
                        )}
                        {canVoid && !isVoided && (
                          <button
                            type="button"
                            onClick={() => setVoidingExpense(exp)}
                            style={{
                              padding: '0.25rem 0.5rem',
                              fontSize: '0.8rem',
                              background: '#fff1f2',
                              border: '1.5px solid #fecdd3',
                              color: '#dc2626',
                              borderRadius: '6px',
                              cursor: 'pointer',
                            }}
                            title="Void Expense"
                          >
                            🚫
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Strip */}
        {totalPages > 1 && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0.85rem 1.25rem',
            background: '#f8fafc',
            borderTop: '1px solid #e2e8f0',
          }}>
            <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
              Showing Page {page} of {totalPages} ({totalCount} total vouchers)
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={{
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: page <= 1 ? '#f1f5f9' : '#ffffff',
                  color: page <= 1 ? '#94a3b8' : '#334155',
                  cursor: page <= 1 ? 'not-allowed' : 'pointer',
                }}
              >
                ← Previous
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                style={{
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: page >= totalPages ? '#f1f5f9' : '#ffffff',
                  color: page >= totalPages ? '#94a3b8' : '#334155',
                  cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                }}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* New / Edit Expense Modal (Fully Responsive & Modern Executive Layout) */}
      {showFormModal && (
        <div className="expense-popover-overlay" onClick={() => setShowFormModal(false)}>
          <div
            className="expense-modal-box"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="expense-modal-header">
              <div className="expense-modal-title-wrap">
                <div className="expense-modal-icon-badge">💼</div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>
                    {editingExpense ? `Edit Expense (${editingExpense.expenseNumber})` : 'Record Business Expense'}
                  </h3>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.15rem' }}>
                    Log non-inventory overheads, vendor invoices, and ITC tax treatments
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowFormModal(false)}
                style={{
                  background: '#f1f5f9',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  width: '34px',
                  height: '34px',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  color: '#64748b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s ease',
                }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitForm} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {/* Primary Expense Info */}
              <div className="expense-form-row-2">
                <div className="expense-form-group">
                  <label className="expense-form-label">
                    Expense Date <span className="required">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="expense-input-control"
                  />
                </div>

                <div className="expense-form-group">
                  <label className="expense-form-label">
                    Expense Category <span className="required">*</span>
                  </label>
                  <select
                    value={formCategory}
                    onChange={(e) => handleCategoryChange(e.target.value as any)}
                    className="expense-input-control"
                  >
                    {STANDARD_EXPENSE_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Vendor / Supplier Link Card */}
              <div className="expense-form-card">
                <div className="expense-card-header">
                  <div className="expense-card-title">
                    <span>🏢</span> Vendor / Supplier Details
                  </div>
                  <span className="expense-badge-pill expense-badge-optional">Optional</span>
                </div>

                <div className="expense-form-group">
                  <label className="expense-form-label">Select Registered Supplier</label>
                  <select
                    value={formSupplierId}
                    onChange={(e) => handleSupplierSelect(e.target.value)}
                    className="expense-input-control"
                  >
                    <option value="">— Non-registered / Ad-hoc Vendor —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} {s.gstin ? `(${s.gstin})` : ''}</option>
                    ))}
                  </select>
                </div>

                <div className="expense-form-row-2">
                  <div className="expense-form-group">
                    <label className="expense-form-label">Vendor Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Acme Services"
                      value={formSupplierName}
                      onChange={(e) => setFormSupplierName(e.target.value)}
                      className="expense-input-control"
                    />
                  </div>

                  <div className="expense-form-group">
                    <label className="expense-form-label">Vendor GSTIN</label>
                    <input
                      type="text"
                      maxLength={15}
                      placeholder="15-digit GSTIN (e.g. 33AAAAA0000A1Z5)"
                      value={formSupplierGstin}
                      onChange={(e) => setFormSupplierGstin(e.target.value.toUpperCase())}
                      className="expense-input-control"
                      style={{ textTransform: 'uppercase', fontFamily: 'monospace' }}
                    />
                  </div>
                </div>

                <div className="expense-form-row-2">
                  <div className="expense-form-group">
                    <label className="expense-form-label">Vendor Bill / Invoice #</label>
                    <input
                      type="text"
                      placeholder="e.g. INV-1049"
                      value={formInvoiceNumber}
                      onChange={(e) => setFormInvoiceNumber(e.target.value)}
                      className="expense-input-control"
                    />
                  </div>

                  <div className="expense-form-group">
                    <label className="expense-form-label">Vendor Bill Date</label>
                    <input
                      type="date"
                      value={formInvoiceDate}
                      onChange={(e) => setFormInvoiceDate(e.target.value)}
                      className="expense-input-control"
                    />
                  </div>
                </div>
              </div>

              {/* Amount and GST Details Card */}
              <div className="expense-form-card">
                <div className="expense-card-header">
                  <div className="expense-card-title">
                    <span>💰</span> Amount &amp; GST Details
                  </div>
                  <span className="expense-badge-pill expense-badge-auto">Live Tax Engine</span>
                </div>

                <div className="expense-form-row-2">
                  <div className="expense-form-group">
                    <label className="expense-form-label">
                      Expense Amount (₹) <span className="required">*</span>
                    </label>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <span style={{ position: 'absolute', left: '0.85rem', fontWeight: 800, color: '#6d4aff', fontSize: '1.05rem', pointerEvents: 'none' }}>₹</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        placeholder="0.00"
                        value={formAmountRupees}
                        onChange={(e) => setFormAmountRupees(e.target.value)}
                        className="expense-input-control"
                        style={{ paddingLeft: '2.1rem', fontWeight: 800, fontSize: '1.05rem', fontFamily: 'JetBrains Mono, monospace', color: '#1e1b4b' }}
                      />
                    </div>
                  </div>

                  <div className="expense-form-group">
                    <label className="expense-form-label">GST Rate</label>
                    <select
                      value={formTaxRateBp}
                      onChange={(e) => setFormTaxRateBp(Number(e.target.value))}
                      className="expense-input-control"
                    >
                      <option value="0">0% (Nil / Exempt)</option>
                      <option value="500">5%</option>
                      <option value="1200">12%</option>
                      <option value="1800">18%</option>
                      <option value="2800">28%</option>
                    </select>
                  </div>
                </div>

                <div className="expense-form-row-2">
                  <div className="expense-form-group">
                    <label className="expense-form-label">GST Treatment</label>
                    <select
                      value={formGstTreatment}
                      onChange={(e) => setFormGstTreatment(e.target.value as any)}
                      className="expense-input-control"
                    >
                      <option value="regular">Regular Taxable</option>
                      <option value="composition">Composition</option>
                      <option value="exempt">Exempt</option>
                      <option value="nil_rated">Nil-Rated</option>
                      <option value="non_gst">Non-GST</option>
                    </select>
                  </div>

                  <div className="expense-form-group">
                    <label className="expense-form-label">ITC Eligibility</label>
                    <select
                      value={formItcEligibility}
                      onChange={(e) => setFormItcEligibility(e.target.value as any)}
                      className="expense-input-control"
                    >
                      <option value="eligible">Eligible ITC (Claimable on GSTR-3B)</option>
                      <option value="ineligible">Ineligible</option>
                      <option value="blocked_17_5">Blocked Sec 17(5) (Food, Cab, etc.)</option>
                      <option value="pending_review">Pending Review</option>
                    </select>
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.65rem',
                    padding: '0.65rem 0.85rem',
                    background: '#ffffff',
                    borderRadius: '10px',
                    border: '1.5px solid #e2e8f0',
                    cursor: 'pointer',
                  }}
                  onClick={() => setFormTaxInclusive(!formTaxInclusive)}
                >
                  <input
                    type="checkbox"
                    id="taxInclusiveCheck"
                    checked={formTaxInclusive}
                    onChange={(e) => setFormTaxInclusive(e.target.checked)}
                    style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#6d4aff' }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div>
                    <label htmlFor="taxInclusiveCheck" style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e1b4b', cursor: 'pointer' }}>
                      Amount is Tax-Inclusive
                    </label>
                    <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                      Auto reverse-calculates base taxable amount and CGST/SGST/IGST portions
                    </div>
                  </div>
                </div>

                {/* Real-time Calculation Breakdown Box */}
                {parsedAmountMinor > 0 && (
                  <div className="expense-calc-pill-grid">
                    <div className="expense-calc-pill-item">
                      <span className="expense-calc-pill-label">Taxable Base</span>
                      <span className="expense-calc-pill-val">{fmtMoney(liveCalc.taxableMinor)}</span>
                    </div>
                    <div className="expense-calc-pill-item">
                      <span className="expense-calc-pill-label">Total GST</span>
                      <span className="expense-calc-pill-val" style={{ color: '#d97706' }}>{fmtMoney(liveCalc.totalGstMinor)}</span>
                    </div>
                    <div className="expense-calc-pill-item">
                      <span className="expense-calc-pill-label">Total Payable</span>
                      <span className="expense-calc-pill-val" style={{ color: '#6d4aff' }}>{fmtMoney(liveCalc.totalMinor)}</span>
                    </div>
                    <div className="expense-calc-pill-item" style={{ gridColumn: 'span 3', borderTop: '1px solid #e0e7ff', paddingTop: '0.45rem', marginTop: '0.15rem', display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>
                        Eligible ITC Credit (GSTR-3B):
                      </span>
                      <span style={{
                        fontSize: '0.85rem',
                        fontWeight: 800,
                        fontFamily: 'JetBrains Mono, monospace',
                        padding: '0.2rem 0.55rem',
                        borderRadius: '6px',
                        background: liveCalc.itcMinor > 0 ? '#dcfce7' : '#f1f5f9',
                        color: liveCalc.itcMinor > 0 ? '#166534' : '#64748b',
                      }}>
                        {fmtMoney(liveCalc.itcMinor)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Payment Details Card */}
              <div className="expense-form-card">
                <div className="expense-card-header">
                  <div className="expense-card-title">
                    <span>💳</span> Payment Status &amp; Mode
                  </div>
                </div>

                <div className="expense-form-row-2">
                  <div className="expense-form-group">
                    <label className="expense-form-label">Payment Status</label>
                    <select
                      value={formPaymentStatus}
                      onChange={(e) => setFormPaymentStatus(e.target.value as any)}
                      className="expense-input-control"
                    >
                      <option value="paid">Fully Paid</option>
                      <option value="unpaid">Unpaid (Credit)</option>
                      <option value="partial">Partially Paid</option>
                    </select>
                  </div>

                  <div className="expense-form-group">
                    <label className="expense-form-label">Payment Method</label>
                    <select
                      value={formPaymentMethod}
                      onChange={(e) => setFormPaymentMethod(e.target.value as any)}
                      className="expense-input-control"
                    >
                      <option value="cash">Cash</option>
                      <option value="upi">UPI / QR</option>
                      <option value="card">Card</option>
                      <option value="bank">Bank Transfer / NEFT</option>
                      <option value="cheque">Cheque</option>
                    </select>
                  </div>
                </div>

                {formPaymentStatus === 'partial' && (
                  <div className="expense-form-group" style={{ marginTop: '0.35rem' }}>
                    <label className="expense-form-label">Paid Amount (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formPaidRupees}
                      onChange={(e) => setFormPaidRupees(e.target.value)}
                      className="expense-input-control"
                    />
                  </div>
                )}

                <div className="expense-form-group" style={{ marginTop: '0.35rem' }}>
                  <label className="expense-form-label">Description / Purpose</label>
                  <input
                    type="text"
                    placeholder="e.g. Office high-speed broadband monthly subscription"
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                    className="expense-input-control"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', borderTop: '1.5px solid #f1f5f9', paddingTop: '1.15rem', flexWrap: 'wrap', gap: '0.75rem' }}>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                  * Required fields • Amounts in INR (₹)
                </span>
                <div style={{ display: 'flex', gap: '0.65rem' }}>
                  <button
                    type="button"
                    onClick={() => setShowFormModal(false)}
                    disabled={isSubmitting}
                    style={{
                      background: '#ffffff',
                      border: '1.5px solid #cbd5e1',
                      borderRadius: '10px',
                      padding: '0.65rem 1.35rem',
                      fontWeight: 600,
                      color: '#475569',
                      cursor: 'pointer',
                      fontSize: '0.85rem',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    style={{
                      background: 'linear-gradient(135deg, #6d4aff 0%, #4f46e5 100%)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '10px',
                      padding: '0.65rem 1.65rem',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      cursor: isSubmitting ? 'not-allowed' : 'pointer',
                      boxShadow: '0 4px 14px rgba(109, 74, 255, 0.35)',
                      transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                    }}
                  >
                    {isSubmitting ? 'Saving...' : editingExpense ? 'Update Expense' : 'Save Expense'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Expense Modal */}
      {viewingExpense && (
        <div className="expense-popover-overlay" onClick={() => setViewingExpense(null)}>
          <div
            className="expense-popover-box"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '580px', padding: '1.5rem' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', borderBottom: '1.5px solid #f1f5f9', paddingBottom: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                  <span style={{ color: '#6d4aff' }}>📄</span> Expense Voucher #{viewingExpense.expenseNumber}
                </h3>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.15rem' }}>
                  Recorded on {formatDateDisplay(viewingExpense.expenseDate)}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setViewingExpense(null)}
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  width: '28px',
                  height: '28px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.85rem',
                  color: '#64748b',
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.85rem', fontSize: '0.85rem', background: '#f8fafc', padding: '1rem', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <div><strong style={{ color: '#64748b' }}>Date:</strong> <span style={{ color: '#0f172a', fontWeight: 600 }}>{formatDateDisplay(viewingExpense.expenseDate)}</span></div>
              <div><strong style={{ color: '#64748b' }}>Category:</strong> <span style={{ color: '#0f172a', fontWeight: 600 }}>{viewingExpense.category}</span></div>
              <div><strong style={{ color: '#64748b' }}>Vendor:</strong> <span style={{ color: '#0f172a', fontWeight: 600 }}>{viewingExpense.supplierName || '—'}</span></div>
              <div><strong style={{ color: '#64748b' }}>Vendor GSTIN:</strong> <span style={{ color: '#0f172a', fontWeight: 600, fontFamily: 'monospace' }}>{viewingExpense.supplierGstin || '—'}</span></div>
              <div><strong style={{ color: '#64748b' }}>Invoice #:</strong> <span style={{ color: '#0f172a', fontWeight: 600 }}>{viewingExpense.supplierInvoiceNumber || '—'}</span></div>
              <div><strong style={{ color: '#64748b' }}>Invoice Date:</strong> <span style={{ color: '#0f172a' }}>{viewingExpense.supplierInvoiceDate ? formatDateDisplay(viewingExpense.supplierInvoiceDate) : '—'}</span></div>
              <div><strong style={{ color: '#64748b' }}>Taxable Base:</strong> <span style={{ color: '#1e1b4b', fontWeight: 700, fontFamily: 'monospace' }}>{fmtMoney(viewingExpense.taxableMinor)}</span></div>
              <div><strong style={{ color: '#64748b' }}>Total GST:</strong> <span style={{ color: '#d97706', fontWeight: 700, fontFamily: 'monospace' }}>{fmtMoney(viewingExpense.cgstMinor + viewingExpense.sgstMinor + viewingExpense.igstMinor)}</span></div>
              <div style={{ gridColumn: '1 / -1', background: '#ffffff', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 700, color: '#334155' }}>Total Expense Amount:</span>
                <span style={{ fontSize: '1.15rem', fontWeight: 800, color: '#6d4aff', fontFamily: 'monospace' }}>{fmtMoney(viewingExpense.totalMinor)}</span>
              </div>
              <div><strong style={{ color: '#64748b' }}>Payment Mode:</strong> <span style={{ textTransform: 'capitalize' }}>{viewingExpense.paymentMethod} ({viewingExpense.paymentStatus})</span></div>
              <div><strong style={{ color: '#64748b' }}>ITC Status:</strong> <span style={{ color: viewingExpense.itcEligibility === 'eligible' ? '#059669' : '#dc2626', fontWeight: 700 }}>{viewingExpense.itcEligibility}</span> ({fmtMoney(viewingExpense.itcMinor)})</div>
              {viewingExpense.description && (
                <div style={{ gridColumn: '1 / -1' }}><strong style={{ color: '#64748b' }}>Description:</strong> <span style={{ color: '#334155' }}>{viewingExpense.description}</span></div>
              )}
            </div>

            <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setViewingExpense(null)}
                style={{
                  background: '#ffffff',
                  border: '1.5px solid #cbd5e1',
                  borderRadius: '8px',
                  padding: '0.5rem 1.25rem',
                  fontWeight: 600,
                  color: '#475569',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Void Expense Modal */}
      {voidingExpense && (
        <div className="expense-popover-overlay" onClick={() => setVoidingExpense(null)}>
          <div
            className="expense-popover-box"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '460px', padding: '1.5rem' }}
          >
            <h3 style={{ margin: '0 0 0.5rem', color: '#dc2626', fontSize: '1.15rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span>🚫</span> Void Expense #{voidingExpense.expenseNumber}
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem', lineHeight: 1.4 }}>
              Voiding this expense reverses financial entries and marks linked ITC credit as ineligible. This cannot be undone.
            </p>
            <div style={{ marginBottom: '1.15rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: '700', color: '#334155', marginBottom: '0.35rem' }}>
                Reason for Voiding *
              </label>
              <textarea
                required
                rows={3}
                placeholder="Explain why this expense is being voided..."
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                className="expense-input-control"
                style={{ resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setVoidingExpense(null)}
                disabled={isSubmitting}
                style={{
                  background: '#ffffff',
                  border: '1.5px solid #cbd5e1',
                  borderRadius: '8px',
                  padding: '0.5rem 1rem',
                  fontWeight: 600,
                  color: '#475569',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmVoid}
                disabled={isSubmitting}
                style={{
                  background: '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '0.5rem 1.25rem',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  boxShadow: '0 4px 10px rgba(220, 38, 38, 0.3)',
                }}
              >
                {isSubmitting ? 'Voiding...' : 'Confirm Void'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Accounting Period & Month Selector Popover Modal */}
      {showDateModal && (
        <div className="expense-popover-overlay" onClick={() => setShowDateModal(false)}>
          <div
            className="expense-popover-box"
            onClick={(e) => e.stopPropagation()}
            style={{
              padding: '1.25rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
              <div>
                <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <span>📅</span> Select Accounting Period
                </h4>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.15rem' }}>
                  Pick a calendar month or choose an exact custom date range
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowDateModal(false)}
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  width: '28px',
                  height: '28px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.85rem',
                  color: '#64748b',
                }}
              >
                ✕
              </button>
            </div>

            {/* Quick 1-Click Month Grid with Year Stepper */}
            <div style={{ background: '#f8f7ff', border: '1px solid #ede9fe', borderRadius: '10px', padding: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#4338ca', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Single Month View
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => setModalYear((y) => y - 1)}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      padding: '0.15rem 0.5rem',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      color: '#475569',
                    }}
                    title="Previous Year"
                  >
                    ◀
                  </button>
                  <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#1e1b4b', minWidth: '45px', textAlign: 'center' }}>
                    {modalYear}
                  </span>
                  <button
                    type="button"
                    onClick={() => setModalYear((y) => y + 1)}
                    style={{
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      padding: '0.15rem 0.5rem',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      color: '#475569',
                    }}
                    title="Next Year"
                  >
                    ▶
                  </button>
                </div>
              </div>

              {/* 12 Months Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.4rem' }}>
                {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((mName, mIdx) => {
                  const pad = (n: number) => String(n).padStart(2, '0');
                  const targetStart = `${modalYear}-${pad(mIdx + 1)}-01`;
                  const isCurrentSelection = from === targetStart;
                  return (
                    <button
                      key={mName}
                      type="button"
                      onClick={() => handleSelectMonth(mIdx)}
                      style={{
                        padding: '0.45rem 0.2rem',
                        fontSize: '0.8rem',
                        fontWeight: isCurrentSelection ? 700 : 500,
                        borderRadius: '7px',
                        border: isCurrentSelection ? '1.5px solid #6d4aff' : '1px solid #e2e8f0',
                        background: isCurrentSelection ? '#6d4aff' : '#ffffff',
                        color: isCurrentSelection ? '#ffffff' : '#334155',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {mName}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom Date Range (From & To) */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.85rem' }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#475569', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Or Custom Start &amp; End Dates
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', marginBottom: '0.25rem' }}>
                    From Date
                  </label>
                  <input
                    type="date"
                    value={modalFrom}
                    onChange={(e) => setModalFrom(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.45rem 0.6rem',
                      fontSize: '0.82rem',
                      borderRadius: '7px',
                      border: '1.5px solid #cbd5e1',
                      outline: 'none',
                      background: '#ffffff',
                      color: '#0f172a',
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', marginBottom: '0.25rem' }}>
                    To Date
                  </label>
                  <input
                    type="date"
                    value={modalTo}
                    onChange={(e) => setModalTo(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.45rem 0.6rem',
                      fontSize: '0.82rem',
                      borderRadius: '7px',
                      border: '1.5px solid #cbd5e1',
                      outline: 'none',
                      background: '#ffffff',
                      color: '#0f172a',
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '0.25rem', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  handleSelectPreset('all');
                  setShowDateModal(false);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#64748b',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: '0.4rem',
                }}
              >
                Clear to All Time
              </button>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setShowDateModal(false)}
                  style={{
                    background: '#ffffff',
                    border: '1.5px solid #cbd5e1',
                    borderRadius: '8px',
                    padding: '0.45rem 0.85rem',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    color: '#475569',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApplyCustomModalRange}
                  style={{
                    background: 'linear-gradient(135deg, #6d4aff 0%, #4f46e5 100%)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '0.45rem 1.15rem',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: '0 3px 10px rgba(109, 74, 255, 0.3)',
                  }}
                >
                  Apply Range
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
