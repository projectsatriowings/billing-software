import React, { useState, useEffect } from 'react';
import {
  fetchDayClosingPreview,
  submitDayClosing,
  fetchDayClosingHistory,
  type User,
  type Shop,
} from '../../api.ts';
import {
  RupeeIcon,
  BanknoteIcon,
  CreditCardIcon,
  RefreshCwIcon,
  TrendingUpIcon,
  WalletIcon,
  ScaleIcon,
  ClockIcon,
  RotateCcwIcon,
  CheckCircle2Icon,
  AlertTriangleIcon,
  FileTextIcon,
  LockIcon,
  StoreIcon,
  ArrowDownLeftIcon,
  ArrowUpRightIcon,
} from '../inventory/InventoryIcons.tsx';

interface DayClosingViewProps {
  user: User;
  shop: Shop | null;
  selectedBranch?: string;
  branches?: any[];
}

export const DayClosingView: React.FC<DayClosingViewProps> = ({
  user,
  shop,
  selectedBranch,
  branches,
}) => {
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [preview, setPreview] = useState<any | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Closing form state
  const [actualCashStr, setActualCashStr] = useState<string>('');
  const [closingRemarks, setClosingRemarks] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );

  const activeBranchId = selectedBranch || (branches && branches[0]?.id) || 'MAIN';

  const loadPreview = async () => {
    try {
      setLoadingPreview(true);
      setError(null);
      const res = await fetchDayClosingPreview({
        branchId: activeBranchId,
        date: selectedDate,
      });
      setPreview(res);
      const expected = res.cashReconciliation?.expectedClosingCashMinor ?? res.cashDrawer?.expectedClosingCashMinor;
      if (expected !== undefined && !actualCashStr) {
        setActualCashStr((expected / 100).toFixed(2));
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch day closing preview');
    } finally {
      setLoadingPreview(false);
    }
  };

  const loadHistory = async () => {
    try {
      setLoadingHistory(true);
      const res = await fetchDayClosingHistory({ branchId: activeBranchId, limit: 30 });
      setHistory(res.records || res.history || []);
    } catch (err) {
      console.error('Failed to load history', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadPreview();
    loadHistory();
  }, [activeBranchId, selectedDate]);

  const fmt = (minor: number = 0) =>
    `₹${((minor || 0) / 100).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const isClosed = Boolean(preview?.isClosed || preview?.alreadyClosed);
  const closedRecord = preview?.closedRecord || null;

  const sales = preview?.salesSummary || preview?.sales || {
    grossSalesMinor: 0,
    returnsTotalMinor: 0,
    salesReturnsMinor: 0,
    netSalesMinor: 0,
    invoicesCount: 0,
    invoiceCount: 0,
    returnsCount: 0,
  };

  const returns = preview?.returnSummary || preview?.returns || {
    totalReturnsCount: 0,
    returnCount: 0,
    totalReturnValueMinor: 0,
    cashRefundsPaidMinor: 0,
    cashRefundsMinor: 0,
    upiRefundsPaidMinor: 0,
    upiRefundsMinor: 0,
    exchangeCreditAdjustedMinor: 0,
    exchangeCreditsMinor: 0,
    storeCreditsIssuedMinor: 0,
    storeCreditsMinor: 0,
  };

  const exchanges = preview?.exchangeSummary || preview?.exchanges || {
    exchangesCount: 0,
    exchangeCount: 0,
    exchangeAdjustedMinor: 0,
    oldProductsReturnedMinor: 0,
    newProductsSoldMinor: 0,
    additionalAmountCollectedMinor: 0,
    remainingCustomerCreditMinor: 0,
  };

  const payments = preview?.paymentSummary || preview?.payments || {
    cashCollectionsMinor: 0,
    cashMinor: 0,
    upiCollectionsMinor: 0,
    upiMinor: 0,
    cardCollectionsMinor: 0,
    cardMinor: 0,
    storeCreditMinor: 0,
  };

  const cashRec = preview?.cashReconciliation || preview?.cashDrawer || {
    openingCashMinor: 0,
    cashSalesReceivedMinor: 0,
    cashRefundsPaidMinor: 0,
    cashExpensesMinor: 0,
    cashInMinor: 0,
    cashOutMinor: 0,
    expectedClosingCashMinor: 0,
  };

  const profit = preview?.profitSummary || preview?.profit || {
    netSalesMinor: 0,
    netCogsMinor: 0,
    grossProfitMinor: 0,
    operatingExpensesMinor: 0,
    netProfitMinor: 0,
  };

  const marginPct =
    profit.netSalesMinor > 0
      ? (profit.grossProfitMinor / profit.netSalesMinor) * 100
      : 0;

  const actualCashMinor = Math.round((parseFloat(actualCashStr) || 0) * 100);
  const expectedCashMinor = cashRec.expectedClosingCashMinor || 0;
  const cashDifferenceMinor = actualCashMinor - expectedCashMinor;

  const handleSubmitClosing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preview) return;

    if (isClosed) {
      alert('This business date is already closed for this branch.');
      return;
    }

    if (isNaN(parseFloat(actualCashStr))) {
      alert('Please enter a valid actual closing cash amount.');
      return;
    }

    const confirmMsg =
      `Are you sure you want to close the day for ${preview.bdate || selectedDate}?\n` +
      `Expected Cash: ${fmt(expectedCashMinor)}\n` +
      `Actual Cash: ${fmt(actualCashMinor)}\n` +
      `Variance: ${cashDifferenceMinor >= 0 ? '+' : ''}${fmt(cashDifferenceMinor)}\n\n` +
      `Once submitted, all transactions for this day will be locked against ordinary edits.`;

    if (!window.confirm(confirmMsg)) return;

    try {
      setSubmitting(true);
      setError(null);
      const res = await submitDayClosing({
        branchId: activeBranchId,
        date: preview.bdate || selectedDate,
        actualCashMinor: actualCashMinor,
        remarks: closingRemarks.trim(),
      });
      setSuccessMsg(`Day closing completed successfully! Reference ID: ${res.dayClosing?.id || res.dayClosing?.bdate || 'OK'}`);
      await loadPreview();
      await loadHistory();
    } catch (err: any) {
      setError(err.message || 'Failed to submit day closing');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrint = (closingId: string) => {
    window.open(`/api/day-closing/${closingId}/print`, '_blank', 'width=900,height=800');
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Banner & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <span className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600">
              <LockIcon className="w-6 h-6" />
            </span>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Day Closing & Register Reconciliation</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Audit daily sales, returns, cash drawer floats, and seal register transactions
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-600">
            <ClockIcon className="w-4 h-4 text-slate-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-transparent font-medium text-slate-800 outline-none"
            />
          </div>

          <button
            onClick={() => { loadPreview(); loadHistory(); }}
            disabled={loadingPreview}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all"
            title="Refresh Day Data"
          >
            <RefreshCwIcon className={`w-3.5 h-3.5 ${loadingPreview ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3 text-red-700 text-sm">
          <AlertTriangleIcon className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-500" />
          <div className="flex-1">
            <strong>Error:</strong> {error}
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 text-xs font-semibold">✕</button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-3 text-emerald-800 text-sm">
          <CheckCircle2Icon className="w-5 h-5 flex-shrink-0 mt-0.5 text-emerald-600" />
          <div className="flex-1">
            <strong>Success:</strong> {successMsg}
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-700 text-xs font-semibold">✕</button>
        </div>
      )}

      {/* Already closed notice banner */}
      {isClosed && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="p-2 bg-amber-100 text-amber-800 rounded-xl">
              <LockIcon className="w-5 h-5" />
            </span>
            <div>
              <div className="text-sm font-bold text-amber-900">
                This business day ({preview.bdate || selectedDate}) is sealed and day-closing is completed!
              </div>
              <div className="text-xs text-amber-700 mt-0.5">
                Closed at {closedRecord?.closed_at ? new Date(closedRecord.closed_at).toLocaleTimeString('en-IN') : 'EOD'} by {closedRecord?.closed_by_name || 'Cashier'}. Transactions cannot be modified.
              </div>
            </div>
          </div>

          {closedRecord?.id && (
            <button
              onClick={() => handlePrint(closedRecord.id)}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-semibold shadow-sm transition"
            >
              <FileTextIcon className="w-4 h-4" />
              Print Closing Report
            </button>
          )}
        </div>
      )}

      {loadingPreview ? (
        <div className="p-12 text-center text-slate-500 bg-white rounded-2xl border border-slate-200">
          <RefreshCwIcon className="w-8 h-8 mx-auto mb-3 animate-spin text-indigo-500" />
          <p className="text-sm font-medium">Computing daily sales, returns, payments & reconciliation...</p>
        </div>
      ) : preview ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main 2 Columns: Financial & Reconciliation Breakdowns */}
          <div className="lg:col-span-2 space-y-6">
            {/* Section A: Sales Summary */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
                <div className="flex items-center gap-2 text-slate-800 font-bold text-sm">
                  <TrendingUpIcon className="w-4 h-4 text-indigo-600" />
                  Section A: Daily Sales Summary
                </div>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  {sales.invoicesCount || sales.invoiceCount || 0} Invoices
                </span>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                  <div className="text-xs font-medium text-slate-500">Gross Sales</div>
                  <div className="text-lg font-bold text-slate-900 mt-1">{fmt(sales.grossSalesMinor)}</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">{sales.invoicesCount || sales.invoiceCount || 0} bills issued</div>
                </div>

                <div className="p-3.5 bg-rose-50 rounded-xl border border-rose-100">
                  <div className="text-xs font-medium text-rose-600">Total Sales Returns</div>
                  <div className="text-lg font-bold text-rose-700 mt-1">-{fmt(sales.returnsTotalMinor || sales.salesReturnsMinor)}</div>
                  <div className="text-[11px] text-rose-500 mt-0.5">{sales.returnsCount || returns.totalReturnsCount || 0} credit notes</div>
                </div>

                <div className="p-3.5 bg-emerald-50 rounded-xl border border-emerald-100">
                  <div className="text-xs font-medium text-emerald-700">Net Sales</div>
                  <div className="text-lg font-bold text-emerald-800 mt-1">{fmt(sales.netSalesMinor)}</div>
                  <div className="text-[11px] text-emerald-600 mt-0.5">Gross - Returns</div>
                </div>
              </div>
            </div>

            {/* Section B & C: Returns & Exchanges */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Returns Summary */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2 text-slate-800 font-bold text-sm">
                    <RotateCcwIcon className="w-4 h-4 text-rose-500" />
                    Section B: Return & Refund Summary
                  </div>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-50 text-rose-600">
                    {returns.totalReturnsCount || returns.returnCount || 0} returns
                  </span>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span className="text-slate-500">Total Return Value:</span>
                    <span className="font-bold text-rose-600">{fmt(returns.totalReturnValueMinor)}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span className="text-slate-500">Cash Refunds Paid Out:</span>
                    <span className="font-semibold text-slate-800">{fmt(returns.cashRefundsPaidMinor || returns.cashRefundsMinor)}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span className="text-slate-500">UPI Refunds Processed:</span>
                    <span className="font-semibold text-slate-800">{fmt(returns.upiRefundsPaidMinor || returns.upiRefundsMinor)}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span className="text-slate-500">Exchange Adjustments:</span>
                    <span className="font-semibold text-indigo-600">{fmt(returns.exchangeCreditAdjustedMinor || returns.exchangeCreditsMinor)}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-slate-500">Store Credit Issued:</span>
                    <span className="font-semibold text-purple-600">{fmt(returns.storeCreditsIssuedMinor || returns.storeCreditsMinor)}</span>
                  </div>
                </div>
              </div>

              {/* Exchanges Summary */}
              <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2 text-slate-800 font-bold text-sm">
                    <ScaleIcon className="w-4 h-4 text-indigo-500" />
                    Section C: Exchange Transactions
                  </div>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600">
                    {exchanges.exchangesCount || exchanges.exchangeCount || 0} exchanges
                  </span>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span className="text-slate-500">Exchange Adjusted Credit:</span>
                    <span className="font-bold text-indigo-700">{fmt(returns.exchangeCreditAdjustedMinor || exchanges.exchangeAdjustedMinor)}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-50">
                    <span className="text-slate-500">New Purchase Billed:</span>
                    <span className="font-semibold text-slate-800">{fmt(exchanges.newProductsSoldMinor)}</span>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded-xl text-[11px] text-slate-600 leading-relaxed">
                    Exchanges seamlessly offset customer return credit against new garments sold without inflating gross cash collections.
                  </div>
                </div>
              </div>
            </div>

            {/* Section D: Payment Summary */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
                <div className="flex items-center gap-2 text-slate-800 font-bold text-sm">
                  <WalletIcon className="w-4 h-4 text-emerald-600" />
                  Section D: Tender & Payment Collections
                </div>
                <span className="text-xs text-slate-500">By Settlement Channel</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                  <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-semibold mb-1">
                    <BanknoteIcon className="w-3.5 h-3.5" /> Cash
                  </div>
                  <div className="text-base font-bold text-emerald-900">{fmt(payments.cashCollectionsMinor || payments.cashMinor)}</div>
                </div>

                <div className="p-3 bg-blue-50 rounded-xl border border-blue-100">
                  <div className="flex items-center gap-1.5 text-xs text-blue-700 font-semibold mb-1">
                    <RefreshCwIcon className="w-3.5 h-3.5" /> UPI / QR
                  </div>
                  <div className="text-base font-bold text-blue-900">{fmt(payments.upiCollectionsMinor || payments.upiMinor)}</div>
                </div>

                <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-100">
                  <div className="flex items-center gap-1.5 text-xs text-indigo-700 font-semibold mb-1">
                    <CreditCardIcon className="w-3.5 h-3.5" /> Card / POS
                  </div>
                  <div className="text-base font-bold text-indigo-900">{fmt(payments.cardCollectionsMinor || payments.cardMinor)}</div>
                </div>

                <div className="p-3 bg-purple-50 rounded-xl border border-purple-100">
                  <div className="flex items-center gap-1.5 text-xs text-purple-700 font-semibold mb-1">
                    <StoreIcon className="w-3.5 h-3.5" /> Store Credit
                  </div>
                  <div className="text-base font-bold text-purple-900">{fmt(payments.storeCreditMinor)}</div>
                </div>
              </div>
            </div>

            {/* Section F: Profit & Margin Breakdown */}
            <div className="bg-gradient-to-br from-slate-900 to-indigo-950 text-white rounded-2xl p-5 shadow-sm">
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-700">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <TrendingUpIcon className="w-4 h-4 text-emerald-400" />
                  Section F: Daily Gross Profit & COGS Analysis
                </div>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-indigo-300">
                  Accrual Basis
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-slate-400">Net Sales</div>
                  <div className="text-base font-bold text-white mt-0.5">{fmt(profit.netSalesMinor)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Net COGS (Cost)</div>
                  <div className="text-base font-bold text-rose-300 mt-0.5">{fmt(profit.netCogsMinor)}</div>
                  <div className="text-[10px] text-slate-400">Sold - Resellable Ret.</div>
                </div>
                <div>
                  <div className="text-xs text-emerald-400">Gross Profit</div>
                  <div className="text-base font-bold text-emerald-300 mt-0.5">{fmt(profit.grossProfitMinor)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Margin %</div>
                  <div className="text-base font-bold text-indigo-300 mt-0.5">{marginPct.toFixed(1)}%</div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Section E Cash Drawer Reconciliation & Submit Action */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
                <div className="flex items-center gap-2 text-slate-800 font-bold text-sm">
                  <BanknoteIcon className="w-4 h-4 text-emerald-600" />
                  Section E: Cash Drawer Reconciliation
                </div>
              </div>

              {/* Step-by-step breakdown */}
              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between py-1 text-slate-600">
                  <span>Opening Cash (Shift Base)</span>
                  <span className="font-semibold text-slate-900">{fmt(cashRec.openingCashMinor)}</span>
                </div>
                <div className="flex justify-between py-1 text-emerald-700">
                  <span className="flex items-center gap-1">
                    <ArrowDownLeftIcon className="w-3.5 h-3.5" /> (+) Cash Sales Received
                  </span>
                  <span className="font-semibold">+{fmt(cashRec.cashSalesReceivedMinor)}</span>
                </div>
                <div className="flex justify-between py-1 text-rose-700">
                  <span className="flex items-center gap-1">
                    <ArrowUpRightIcon className="w-3.5 h-3.5" /> (-) Cash Refunds Paid
                  </span>
                  <span className="font-semibold">-{fmt(cashRec.cashRefundsPaidMinor)}</span>
                </div>
                <div className="flex justify-between py-1 text-emerald-700">
                  <span>(+) Cash In / Deposits</span>
                  <span className="font-semibold">+{fmt(cashRec.cashInMinor)}</span>
                </div>
                <div className="flex justify-between py-1 text-rose-700">
                  <span>(-) Cash Out / Withdrawals</span>
                  <span className="font-semibold">-{fmt(cashRec.cashOutMinor)}</span>
                </div>
                <div className="flex justify-between py-1 text-rose-700 border-b border-slate-100 pb-2">
                  <span>(-) Cash Expenses</span>
                  <span className="font-semibold">-{fmt(cashRec.cashExpensesMinor)}</span>
                </div>

                {/* Expected Cash */}
                <div className="flex justify-between py-2 text-sm font-bold bg-slate-50 p-2.5 rounded-xl border border-slate-200 text-slate-900">
                  <span>Expected Closing Cash:</span>
                  <span className="text-indigo-700">{fmt(cashRec.expectedClosingCashMinor)}</span>
                </div>
              </div>

              {/* Form to submit closing */}
              {!isClosed ? (
                <form onSubmit={handleSubmitClosing} className="mt-5 space-y-4 pt-4 border-t border-slate-100">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Actual Physical Cash Counted (₹) *
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2.5 text-slate-400 font-bold text-sm">₹</span>
                      <input
                        type="number"
                        step="0.01"
                        required
                        value={actualCashStr}
                        onChange={(e) => setActualCashStr(e.target.value)}
                        placeholder="Enter drawer physical count"
                        className="w-full pl-8 pr-4 py-2 border border-slate-300 rounded-xl text-sm font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  {/* Cash Shortage / Excess indicator */}
                  <div className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-between ${
                    cashDifferenceMinor === 0
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : cashDifferenceMinor > 0
                      ? 'bg-blue-50 border-blue-200 text-blue-800'
                      : 'bg-rose-50 border-rose-200 text-rose-800'
                  }`}>
                    <span>
                      {cashDifferenceMinor === 0
                        ? 'Drawer Balanced (Exact Match)'
                        : cashDifferenceMinor > 0
                        ? 'Cash Excess / Surplus'
                        : 'Cash Shortage / Deficit'}
                    </span>
                    <span className="text-sm font-bold">
                      {cashDifferenceMinor >= 0 ? '+' : ''}{fmt(cashDifferenceMinor)}
                    </span>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Closing Remarks / Discrepancy Note
                    </label>
                    <textarea
                      rows={2}
                      value={closingRemarks}
                      onChange={(e) => setClosingRemarks(e.target.value)}
                      placeholder="e.g. Verified by head cashier, small coin shortage"
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-md transition disabled:opacity-50"
                  >
                    <LockIcon className="w-4 h-4" />
                    {submitting ? 'Submitting & Sealing Day...' : 'Submit & Seal Day Closing'}
                  </button>
                  <p className="text-[11px] text-slate-400 text-center">
                    This locks all transactions on {preview.bdate || selectedDate} against ordinary edits.
                  </p>
                </form>
              ) : (
                <div className="mt-5 p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Actual Closing Cash:</span>
                    <span className="font-bold text-slate-900">{fmt(closedRecord?.actual_cash_minor)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Cash Discrepancy:</span>
                    <span className={`font-bold ${(closedRecord?.variance_minor || 0) < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {(closedRecord?.variance_minor || 0) >= 0 ? '+' : ''}
                      {fmt(closedRecord?.variance_minor || 0)}
                    </span>
                  </div>
                  {closedRecord?.remarks && (
                    <div className="pt-2 text-[11px] text-slate-600 italic">
                      "{closedRecord.remarks}"
                    </div>
                  )}
                  {closedRecord?.id && (
                    <button
                      onClick={() => handlePrint(closedRecord.id)}
                      className="w-full mt-2 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                    >
                      <FileTextIcon className="w-3.5 h-3.5" />
                      Print Sealed Day Closing Report
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* History Table */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
          <div className="font-bold text-sm text-slate-900 flex items-center gap-2">
            <ClockIcon className="w-4 h-4 text-slate-500" />
            Previous Day Closings History
          </div>
          <span className="text-xs text-slate-500">{history.length} records</span>
        </div>

        {loadingHistory ? (
          <div className="py-6 text-center text-xs text-slate-400">Loading history...</div>
        ) : history.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">No sealed day closings found for this branch.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 font-semibold">
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Gross Sales</th>
                  <th className="py-2.5 px-3">Returns</th>
                  <th className="py-2.5 px-3">Net Sales</th>
                  <th className="py-2.5 px-3">Expected Cash</th>
                  <th className="py-2.5 px-3">Actual Cash</th>
                  <th className="py-2.5 px-3">Variance</th>
                  <th className="py-2.5 px-3">Gross Profit</th>
                  <th className="py-2.5 px-3">Closed By</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((h) => {
                  const variance = h.variance_minor ?? h.cash_difference_minor ?? 0;
                  return (
                    <tr key={h.id} className="hover:bg-slate-50">
                      <td className="py-3 px-3 font-bold text-slate-800">{h.bdate || h.closing_date}</td>
                      <td className="py-3 px-3">{fmt(h.gross_sales_minor)}</td>
                      <td className="py-3 px-3 text-rose-600">-{fmt(h.returns_total_minor || h.sales_returns_minor)}</td>
                      <td className="py-3 px-3 font-semibold text-emerald-700">{fmt(h.net_sales_minor)}</td>
                      <td className="py-3 px-3">{fmt(h.expected_cash_minor || h.expected_closing_cash_minor)}</td>
                      <td className="py-3 px-3 font-semibold text-slate-900">{fmt(h.actual_cash_minor || h.actual_closing_cash_minor)}</td>
                      <td className="py-3 px-3">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
                          variance === 0
                            ? 'bg-emerald-50 text-emerald-700'
                            : variance > 0
                            ? 'bg-blue-50 text-blue-700'
                            : 'bg-rose-50 text-rose-700'
                        }`}>
                          {variance >= 0 ? '+' : ''}{fmt(variance)}
                        </span>
                      </td>
                      <td className="py-3 px-3 font-semibold text-indigo-700">{fmt(h.gross_profit_minor)}</td>
                      <td className="py-3 px-3 text-slate-500">{h.closed_by_name || h.cashier_name || 'Cashier'}</td>
                      <td className="py-3 px-3 text-right">
                        <button
                          onClick={() => handlePrint(h.id)}
                          className="px-2.5 py-1 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition"
                        >
                          Print Report
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
