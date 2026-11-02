import React, { useState, useEffect } from 'react';
import {
  fetchItcRegister,
  submitItcReview,
  downloadFile,
  type ItcRegisterItem,
} from '../../api.ts';
import { Gstr2bImportModal } from './Gstr2bImportModal.tsx';
import {
  UploadIcon,
  DownloadIcon,
  SpinnerIcon,
  BarChartIcon,
  BookOpenIcon,
  CheckCircleIcon,
  BanIcon,
  ClockIcon,
  ScaleIcon,
  AlertTriangleIcon,
  XCircleIcon,
} from './GstIcons.tsx';

interface ItcRegisterViewProps {
  onNavigate?: (tab: string, meta?: any) => void;
}

export const ItcRegisterView: React.FC<ItcRegisterViewProps> = ({ onNavigate }) => {
  const [period, setPeriod] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState<boolean>(true);
  const [exporting, setExporting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ItcRegisterItem[]>([]);
  const [summary, setSummary] = useState<any>(null);

  // Filters
  const [search, setSearch] = useState<string>('');
  const [docTypeFilter, setDocTypeFilter] = useState<string>('all');
  const [matchingFilter, setMatchingFilter] = useState<string>('all');
  const [reviewFilter, setReviewFilter] = useState<string>('all');

  // Review Modal State
  const [selectedItemForReview, setSelectedItemForReview] = useState<ItcRegisterItem | null>(null);
  const [reviewEligibility, setReviewEligibility] = useState<string>('eligible_reviewed');
  const [customEligibleAmount, setCustomEligibleAmount] = useState<string>('');
  const [reviewReason, setReviewReason] = useState<string>('');
  const [submittingReview, setSubmittingReview] = useState<boolean>(false);

  // Import Modal
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchItcRegister(period);
      setItems(res.items);
      setSummary(res.summary);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch ITC register');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [period]);

  const openReviewModal = (item: ItcRegisterItem) => {
    setSelectedItemForReview(item);
    setReviewEligibility(item.itcReviewStatus === 'pending_review' ? 'eligible_reviewed' : item.itcReviewStatus);
    setCustomEligibleAmount((item.reviewedEligibleItcMinor / 100).toFixed(2));
    setReviewReason(item.reviewDecisionReason || '');
  };

  const handleSaveReview = async () => {
    if (!selectedItemForReview) return;
    if (!reviewReason.trim()) {
      alert('Please provide a reason or note for this ITC decision.');
      return;
    }

    setSubmittingReview(true);
    try {
      const eligibleMinor =
        reviewEligibility === 'ineligible_reviewed' || reviewEligibility === 'blocked_17_5'
          ? 0
          : reviewEligibility === 'eligible_reviewed'
          ? selectedItemForReview.totalGstMinor
          : Math.round(parseFloat(customEligibleAmount || '0') * 100);

      await submitItcReview({
        docType: selectedItemForReview.docType,
        docId: selectedItemForReview.docId,
        returnPeriod: period,
        eligibilityStatus: reviewEligibility,
        reviewedEligibleItcMinor: eligibleMinor,
        reason: reviewReason.trim(),
      });

      setSelectedItemForReview(null);
      await loadData();
    } catch (err: any) {
      alert(`Error saving review: ${err.message}`);
    } finally {
      setSubmittingReview(false);
    }
  };

  const filteredItems = items.filter((item) => {
    if (docTypeFilter !== 'all' && item.docType !== docTypeFilter) return false;
    if (matchingFilter !== 'all' && item.gstr2bMatchingStatus !== matchingFilter) return false;
    if (reviewFilter !== 'all' && item.itcReviewStatus !== reviewFilter) return false;

    if (search.trim()) {
      const term = search.toLowerCase();
      const matchName = item.supplierName.toLowerCase().includes(term);
      const matchGstin = (item.supplierGstin || '').toLowerCase().includes(term);
      const matchInv = (item.supplierInvoiceNumber || '').toLowerCase().includes(term);
      const matchDoc = (item.docNumber || '').toLowerCase().includes(term);
      if (!matchName && !matchGstin && !matchInv && !matchDoc) return false;
    }
    return true;
  });

  const getMatchingBadge = (status: string) => {
    switch (status) {
      case 'matched':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckCircleIcon className="h-3 w-3" /> Matched in 2B
          </span>
        );
      case 'taxable_mismatch':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            <AlertTriangleIcon className="h-3 w-3" /> Taxable Mismatch
          </span>
        );
      case 'gst_mismatch':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertTriangleIcon className="h-3 w-3" /> Tax Diff
          </span>
        );
      case 'missing_in_2b':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            <XCircleIcon className="h-3 w-3" /> Not in 2B
          </span>
        );
      case 'missing_in_books':
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-950/40 dark:text-purple-300">
            <AlertTriangleIcon className="h-3 w-3" /> Not in Books
          </span>
        );
      default:
        return <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">{status}</span>;
    }
  };

  const getReviewBadge = (status: string) => {
    switch (status) {
      case 'eligible_reviewed':
        return <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">Eligible (Reviewed)</span>;
      case 'partially_eligible_reviewed':
        return <span className="rounded-full bg-cyan-100 px-2.5 py-0.5 text-xs font-semibold text-cyan-800 dark:bg-cyan-900/60 dark:text-cyan-200">Partially Eligible</span>;
      case 'ineligible_reviewed':
        return <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-800 dark:bg-rose-900/60 dark:text-rose-200">Ineligible</span>;
      case 'blocked_17_5':
        return <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-900 dark:bg-red-950 dark:text-red-300">Blocked Sec 17(5)</span>;
      case 'requires_correction':
        return <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">Requires Correction</span>;
      case 'pending_review':
      default:
        return <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">Pending Review</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            ITC Register & Reconciliation
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Compare purchase invoices and business expenses against auto-drafted GSTR-2B. Authorize eligible tax credits for GSTR-3B.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Return Period:</span>
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
          </div>

          <button
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
          >
            <UploadIcon className="h-4 w-4" />
            <span>Import GSTR-2B</span>
          </button>

          <button
            type="button"
            onClick={async () => {
              try {
                setExporting(true);
                await downloadFile(
                  `/api/gst/itc-register/export?period=${encodeURIComponent(period)}`,
                  `ITC_Reconciliation_Report_${period}.csv`
                );
              } catch (err: any) {
                alert(`Export failed: ${err.message}`);
              } finally {
                setExporting(false);
              }
            }}
            disabled={exporting}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {exporting ? <SpinnerIcon className="h-4 w-4 animate-spin text-slate-500" /> : <BarChartIcon className="h-4 w-4 text-slate-600" />}
            <span>{exporting ? 'Exporting...' : 'Export CSV'}</span>
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: '1rem',
            marginBottom: '1.25rem',
          }}
        >
          {/* Card 1: Total Book GST */}
          <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-xs transition-all hover:border-purple-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider dark:text-slate-400">Total Book GST</span>
              <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <BookOpenIcon className="h-3.5 w-3.5 text-slate-500" />
                <span>Books</span>
              </span>
            </div>
            <div className="mt-2 text-2xl font-black text-slate-900 tracking-tight dark:text-white">
              ₹{(summary.totalPotentialItcMinor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div className="mt-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {summary.totalRecords} records (Purchases + Expenses)
            </div>
          </div>

          {/* Card 2: Reviewed Eligible ITC */}
          <div className="flex flex-col justify-between rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/70 to-white p-4 shadow-xs transition-all hover:border-emerald-300 hover:shadow-md dark:border-emerald-900/50 dark:from-slate-900 dark:to-emerald-950/20">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider dark:text-emerald-300">Reviewed Eligible ITC</span>
              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-100/80 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200">
                <CheckCircleIcon className="h-3.5 w-3.5 text-emerald-700" />
                <span>Claimable</span>
              </span>
            </div>
            <div className="mt-2 text-2xl font-black text-emerald-600 tracking-tight dark:text-emerald-400">
              ₹{(summary.totalReviewedEligibleItcMinor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div className="mt-2 text-[11px] font-medium text-emerald-700/80 dark:text-emerald-300/80">
              Approved for GSTR-3B Table 4
            </div>
          </div>

          {/* Card 3: Ineligible / Blocked ITC */}
          <div className="flex flex-col justify-between rounded-2xl border border-rose-200/80 bg-gradient-to-br from-rose-50/70 to-white p-4 shadow-xs transition-all hover:border-rose-300 hover:shadow-md dark:border-rose-900/50 dark:from-slate-900 dark:to-rose-950/20">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-rose-800 uppercase tracking-wider dark:text-rose-300">Ineligible / Blocked ITC</span>
              <span className="inline-flex items-center gap-1 rounded-lg bg-rose-100/80 px-2 py-0.5 text-[11px] font-bold text-rose-800 dark:bg-rose-900/60 dark:text-rose-200">
                <BanIcon className="h-3.5 w-3.5 text-rose-700" />
                <span>Sec 17(5)</span>
              </span>
            </div>
            <div className="mt-2 text-2xl font-black text-rose-600 tracking-tight dark:text-rose-400">
              ₹{(summary.totalIneligibleItcMinor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div className="mt-2 text-[11px] font-medium text-rose-700/80 dark:text-rose-300/80">
              Excluded per Sec 17(5) / Non-business
            </div>
          </div>

          {/* Card 4: Pending Review */}
          <div className="flex flex-col justify-between rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50/70 to-white p-4 shadow-xs transition-all hover:border-amber-300 hover:shadow-md dark:border-amber-900/50 dark:from-slate-900 dark:to-amber-950/20">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-800 uppercase tracking-wider dark:text-amber-300">Pending Review</span>
              <span className="inline-flex items-center gap-1 rounded-lg bg-amber-100/80 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-900/60 dark:text-amber-200">
                <ClockIcon className="h-3.5 w-3.5 text-amber-700" />
                <span>Needs Action</span>
              </span>
            </div>
            <div className="mt-2 text-2xl font-black text-amber-600 tracking-tight dark:text-amber-400">
              {summary.pendingReviewCount}
            </div>
            <div className="mt-2 text-[11px] font-medium text-amber-700/80 dark:text-amber-300/80">
              Transactions requiring tax decision
            </div>
          </div>

          {/* Card 5: 2B Matching Result */}
          <div className="flex flex-col justify-between rounded-2xl border border-indigo-200/80 bg-gradient-to-br from-indigo-50/70 to-white p-4 shadow-xs transition-all hover:border-indigo-300 hover:shadow-md dark:border-indigo-900/50 dark:from-slate-900 dark:to-indigo-950/20">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-indigo-800 uppercase tracking-wider dark:text-indigo-300">2B Matching Result</span>
              <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-100/80 px-2 py-0.5 text-[11px] font-bold text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200">
                <ScaleIcon className="h-3.5 w-3.5 text-indigo-700" />
                <span>Alignment</span>
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-black text-emerald-600">{summary.matchedCount}</span>
              <span className="text-xs font-semibold text-slate-500">matched /</span>
              <span className="text-2xl font-black text-rose-600">{summary.mismatchCount + summary.missingIn2BCount}</span>
              <span className="text-xs font-semibold text-slate-500">diffs</span>
            </div>
            <div className="mt-2 text-[11px] font-medium text-indigo-700/80 dark:text-indigo-300/80">
              GSTR-2B portal comparison
            </div>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search supplier, GSTIN, invoice no..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>

        <select
          value={docTypeFilter}
          onChange={(e) => setDocTypeFilter(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        >
          <option value="all">All Documents</option>
          <option value="purchase">Stock Purchases Only</option>
          <option value="expense">Business Expenses Only</option>
        </select>

        <select
          value={matchingFilter}
          onChange={(e) => setMatchingFilter(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        >
          <option value="all">All 2B Statuses</option>
          <option value="matched">Matched in 2B</option>
          <option value="missing_in_2b">Missing from 2B</option>
          <option value="taxable_mismatch">Taxable Value Mismatch</option>
          <option value="gst_mismatch">GST Amount Mismatch</option>
        </select>

        <select
          value={reviewFilter}
          onChange={(e) => setReviewFilter(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        >
          <option value="all">All Review Statuses</option>
          <option value="pending_review">Pending Review</option>
          <option value="eligible_reviewed">Eligible (Reviewed)</option>
          <option value="partially_eligible_reviewed">Partially Eligible</option>
          <option value="ineligible_reviewed">Ineligible (Reviewed)</option>
          <option value="blocked_17_5">Blocked Sec 17(5)</option>
          <option value="requires_correction">Requires Correction</option>
        </select>
      </div>

      {/* ITC Register Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <div className="flex h-48 items-center justify-center text-sm text-slate-500">
            Loading ITC reconciliation items...
          </div>
        ) : error ? (
          <div className="flex items-center justify-center gap-2 p-6 text-center text-sm text-rose-600 dark:text-rose-400">
            <AlertTriangleIcon className="h-4 w-4" />
            <span>{error}</span>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <p className="text-base font-semibold">No transactions found for this period and filter.</p>
            <p className="mt-1 text-xs">Purchases and GST expenses recorded in {period} will automatically appear here for ITC reconciliation.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                <tr>
                  <th className="py-3 px-3">Type</th>
                  <th className="py-3 px-3">Supplier / Vendor</th>
                  <th className="py-3 px-3">Supplier GSTIN</th>
                  <th className="py-3 px-3">Invoice Details</th>
                  <th className="py-3 px-3 text-right">Taxable Value</th>
                  <th className="py-3 px-3 text-right">CGST / SGST</th>
                  <th className="py-3 px-3 text-right">IGST</th>
                  <th className="py-3 px-3 text-right font-bold">Total GST</th>
                  <th className="py-3 px-3 text-center">GSTR-2B Status</th>
                  <th className="py-3 px-3 text-center">ITC Eligibility</th>
                  <th className="py-3 px-3 text-right font-bold">Reviewed ITC</th>
                  <th className="py-3 px-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {filteredItems.map((item) => (
                  <tr key={`${item.docType}_${item.docId}`} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-3">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          item.docType === 'purchase'
                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                            : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                        }`}
                      >
                        {item.docType}
                      </span>
                      <div className="mt-0.5 text-[10px] text-slate-400 font-mono">
                        {item.docNumber}
                      </div>
                    </td>

                    <td className="py-3 px-3 font-medium text-slate-900 dark:text-slate-100">
                      <div>{item.supplierName}</div>
                      {item.reviewDecisionReason && (
                        <div className="mt-0.5 max-w-xs truncate text-[10px] text-slate-500 italic">
                          Note: {item.reviewDecisionReason}
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                      {item.supplierGstin || <span className="text-slate-400 italic">Unregistered</span>}
                    </td>

                    <td className="py-3 px-3">
                      <div className="font-mono text-slate-800 dark:text-slate-200">{item.supplierInvoiceNumber}</div>
                      <div className="text-[10px] text-slate-400">{item.supplierInvoiceDate}</div>
                    </td>

                    <td className="py-3 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                      ₹{(item.taxableMinor / 100).toFixed(2)}
                    </td>

                    <td className="py-3 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                      <div>C: ₹{(item.cgstMinor / 100).toFixed(2)}</div>
                      <div>S: ₹{(item.sgstMinor / 100).toFixed(2)}</div>
                    </td>

                    <td className="py-3 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                      ₹{(item.igstMinor / 100).toFixed(2)}
                    </td>

                    <td className="py-3 px-3 text-right font-mono font-bold text-slate-900 dark:text-white">
                      ₹{(item.totalGstMinor / 100).toFixed(2)}
                    </td>

                    <td className="py-3 px-3 text-center">
                      {getMatchingBadge(item.gstr2bMatchingStatus)}
                      {item.mismatchMinor !== 0 && (
                        <div className="mt-0.5 text-[10px] font-mono font-semibold text-rose-500">
                          Diff: ₹{(Math.abs(item.mismatchMinor) / 100).toFixed(2)}
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-3 text-center">
                      {getReviewBadge(item.itcReviewStatus)}
                    </td>

                    <td className="py-3 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      ₹{(item.reviewedEligibleItcMinor / 100).toFixed(2)}
                    </td>

                    <td className="py-3 px-3 text-center">
                      <button
                        onClick={() => openReviewModal(item)}
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 hover:border-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Review Modal */}
      {selectedItemForReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
            <div className="border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Review ITC Eligibility</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Authoritative decision for GSTR-3B Input Tax Credit claim.
              </p>
            </div>

            <div className="space-y-4 p-6 text-xs">
              <div className="rounded-xl bg-slate-50 p-3 space-y-1 dark:bg-slate-800/40">
                <div className="flex justify-between">
                  <span className="text-slate-500">Supplier:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedItemForReview.supplierName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Supplier GSTIN:</span>
                  <span className="font-mono text-slate-800 dark:text-slate-200">{selectedItemForReview.supplierGstin || 'Unregistered'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Invoice:</span>
                  <span className="font-mono text-slate-800 dark:text-slate-200">
                    {selectedItemForReview.supplierInvoiceNumber} ({selectedItemForReview.supplierInvoiceDate})
                  </span>
                </div>
                <div className="flex justify-between font-bold border-t border-slate-200 pt-1 mt-1 dark:border-slate-700">
                  <span>Original GST in Books:</span>
                  <span className="font-mono text-indigo-600 dark:text-indigo-400">
                    ₹{(selectedItemForReview.totalGstMinor / 100).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>GSTR-2B Statement Status:</span>
                  <span>{getMatchingBadge(selectedItemForReview.gstr2bMatchingStatus)}</span>
                </div>
              </div>

              <div>
                <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
                  ITC Eligibility Decision
                </label>
                <select
                  value={reviewEligibility}
                  onChange={(e) => {
                    const val = e.target.value;
                    setReviewEligibility(val);
                    if (val === 'eligible_reviewed') {
                      setCustomEligibleAmount((selectedItemForReview.totalGstMinor / 100).toFixed(2));
                    } else if (val === 'ineligible_reviewed' || val === 'blocked_17_5') {
                      setCustomEligibleAmount('0.00');
                    }
                  }}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                >
                  <option value="eligible_reviewed">Eligible — Full ITC Claim</option>
                  <option value="partially_eligible_reviewed">Partially Eligible — Specific Amount</option>
                  <option value="ineligible_reviewed">Ineligible — Non-business / Exempt supplies</option>
                  <option value="blocked_17_5">Blocked Credit — Section 17(5) (Food, Motor Vehicles, etc.)</option>
                  <option value="requires_correction">Requires Correction — Disputed with Vendor</option>
                </select>
              </div>

              {reviewEligibility === 'partially_eligible_reviewed' && (
                <div>
                  <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
                    Eligible Amount to Claim (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={customEligibleAmount}
                    onChange={(e) => setCustomEligibleAmount(e.target.value)}
                    max={(selectedItemForReview.totalGstMinor / 100).toFixed(2)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Cannot exceed total tax of ₹{(selectedItemForReview.totalGstMinor / 100).toFixed(2)}
                  </p>
                </div>
              )}

              <div>
                <label className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">
                  Decision Reason / Audit Note <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={2}
                  value={reviewReason}
                  onChange={(e) => setReviewReason(e.target.value)}
                  placeholder="e.g. Verified with 2B; inputs used exclusively for taxable retail garment sales."
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
              <button
                onClick={() => setSelectedItemForReview(null)}
                disabled={submittingReview}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveReview}
                disabled={submittingReview}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
              >
                {submittingReview ? 'Saving Review...' : 'Save Decision'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GSTR-2B Import Modal */}
      <Gstr2bImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportComplete={() => {
          setIsImportModalOpen(false);
          loadData();
        }}
        defaultPeriod={period}
      />
    </div>
  );
};
