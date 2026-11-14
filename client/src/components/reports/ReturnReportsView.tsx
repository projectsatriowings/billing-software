import React, { useState, useEffect } from 'react';
import {
  fetchReturnReports,
  type User,
  type Shop,
} from '../../api.ts';
import {
  TrendingUpIcon,
  RotateCcwIcon,
  ScaleIcon,
  RupeeIcon,
  FileTextIcon,
  RefreshCwIcon,
  AlertTriangleIcon,
  StoreIcon,
  UserIcon,
} from '../inventory/InventoryIcons.tsx';

interface ReturnReportsViewProps {
  user: User;
  shop: Shop | null;
  selectedBranch?: string;
  branches?: any[];
}

type TabType =
  | 'daily_sales'
  | 'returns'
  | 'exchanges'
  | 'refunds'
  | 'gross_profit'
  | 'stock_condition'
  | 'store_credits'
  | 'cashier_perf';

export const ReturnReportsView: React.FC<ReturnReportsViewProps> = ({
  user,
  shop,
  selectedBranch,
  branches,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('daily_sales');
  const [period, setPeriod] = useState<string>('this_month');
  const [customStart, setCustomStart] = useState<string>(
    new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  );
  const [customEnd, setCustomEnd] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [loading, setLoading] = useState(false);
  const [reportRows, setReportRows] = useState<any[]>([]);
  const [reportSummary, setReportSummary] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeBranchId = selectedBranch || (branches && branches[0]?.id) || '';

  const getBackendReportType = (tab: TabType): string => {
    switch (tab) {
      case 'returns': return 'sales_returns';
      case 'stock_condition': return 'stock_returns';
      case 'cashier_perf': return 'cashier_performance';
      default: return tab;
    }
  };

  const loadReport = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchReturnReports({
        reportType: getBackendReportType(activeTab),
        filter: period,
        startDate: period === 'custom' ? customStart : undefined,
        endDate: period === 'custom' ? customEnd : undefined,
        branchId: activeBranchId,
      });
      setReportRows(res.rows || []);
      setReportSummary(res.summary || null);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch return reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, [activeBranchId, activeTab, period, customStart, customEnd]);

  const fmt = (minor: number = 0) =>
    `₹${((minor || 0) / 100).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const tabs: { key: TabType; label: string; icon: any }[] = [
    { key: 'daily_sales', label: '1. Daily Sales', icon: TrendingUpIcon },
    { key: 'returns', label: '2. Sales Returns', icon: RotateCcwIcon },
    { key: 'exchanges', label: '3. Exchanges', icon: ScaleIcon },
    { key: 'refunds', label: '4. Refunds', icon: RupeeIcon },
    { key: 'gross_profit', label: '5. Daily Gross Profit', icon: TrendingUpIcon },
    { key: 'stock_condition', label: '6. Stock Return by Condition', icon: StoreIcon },
    { key: 'store_credits', label: '7. Customer Store Credits', icon: StoreIcon },
    { key: 'cashier_perf', label: '8. Cashier Performance', icon: UserIcon },
  ];

  const exportCsv = (filename: string, rows: any[]) => {
    if (!rows || rows.length === 0) {
      alert('No data to export.');
      return;
    }
    const headers = Object.keys(rows[0]);
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [
        headers.join(','),
        ...rows.map((row) =>
          headers
            .map((h) => {
              const val = row[h];
              return typeof val === 'string' ? `"${val.replace(/"/g, '""')}"` : val;
            })
            .join(',')
        ),
      ].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${filename}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Header & Filter Controls */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="p-2.5 rounded-xl bg-purple-50 text-purple-600">
              <FileTextIcon className="w-6 h-6" />
            </span>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                Returns, Exchanges & Profit Reports
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Audit historical returns, inventory conditions, exchanges, and actual gross profits
              </p>
            </div>
          </div>
        </div>

        {/* Date Filter Bar */}
        <div className="flex flex-wrap items-center gap-2">
          {(['today', 'yesterday', 'this_week', 'this_month', 'custom'] as const).map(
            (p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition ${
                  period === p
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                }`}
              >
                {p.replace('_', ' ')}
              </button>
            )
          )}

          {period === 'custom' && (
            <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-200 text-xs">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="bg-transparent font-medium text-slate-700 outline-none text-xs"
              />
              <span className="text-slate-400">to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="bg-transparent font-medium text-slate-700 outline-none text-xs"
              />
            </div>
          )}

          <button
            onClick={loadReport}
            disabled={loading}
            className="p-2 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
            title="Refresh"
          >
            <RefreshCwIcon className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
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

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition ${
                activeTab === tab.key
                  ? 'bg-purple-50 text-purple-700 border border-purple-200 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="p-12 text-center text-slate-500 bg-white rounded-2xl border border-slate-200">
          <RefreshCwIcon className="w-8 h-8 mx-auto mb-3 animate-spin text-purple-500" />
          <p className="text-sm font-medium">Generating report for selected period...</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* TAB 1: Daily Sales Report */}
          {activeTab === 'daily_sales' && (
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="text-sm font-bold text-slate-900">
                  Daily Sales & Returns Breakdown
                </div>
                <button
                  onClick={() => exportCsv('daily_sales_report', reportRows)}
                  className="px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 transition"
                >
                  Export CSV
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 font-semibold">
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Gross Sales</th>
                      <th className="py-2.5 px-3">Sales Returns</th>
                      <th className="py-2.5 px-3">Net Sales</th>
                      <th className="py-2.5 px-3">Invoices</th>
                      <th className="py-2.5 px-3">Returns</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reportRows.map((row: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-semibold text-slate-800">{row.bdate || row.date}</td>
                        <td className="py-2.5 px-3">{fmt(row.gross_sales_minor)}</td>
                        <td className="py-2.5 px-3 text-rose-600">-{fmt(row.sales_returns_minor)}</td>
                        <td className="py-2.5 px-3 font-bold text-emerald-700">{fmt(row.net_sales_minor)}</td>
                        <td className="py-2.5 px-3">{row.invoices_count || row.invoice_count}</td>
                        <td className="py-2.5 px-3">{row.returns_count || row.return_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: Sales Return Report */}
          {activeTab === 'returns' && (
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-sm font-bold text-slate-900">Detailed Sales Returns</div>
                  <div className="text-xs text-slate-500">
                    Shows original invoice, orig sale date, return date, reason, condition & cashier
                  </div>
                </div>
                <button
                  onClick={() => exportCsv('sales_return_report', reportRows)}
                  className="px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 transition"
                >
                  Export CSV
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 font-semibold">
                      <th className="py-2.5 px-3">Return ID / CN</th>
                      <th className="py-2.5 px-3">Orig Invoice #</th>
                      <th className="py-2.5 px-3">Orig Date</th>
                      <th className="py-2.5 px-3">Return Date</th>
                      <th className="py-2.5 px-3">Customer</th>
                      <th className="py-2.5 px-3">Product</th>
                      <th className="py-2.5 px-3">Qty</th>
                      <th className="py-2.5 px-3">Amount</th>
                      <th className="py-2.5 px-3">Reason</th>
                      <th className="py-2.5 px-3">Condition</th>
                      <th className="py-2.5 px-3">Cashier</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reportRows.map((row: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-mono font-bold text-indigo-600">{row.credit_note_number || row.return_number}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-700">{row.orig_invoice_number || row.original_invoice_number}</td>
                        <td className="py-2.5 px-3 text-slate-500">{row.orig_sale_date || row.original_sale_date}</td>
                        <td className="py-2.5 px-3 font-semibold text-slate-800">{row.return_date || row.bdate}</td>
                        <td className="py-2.5 px-3">{row.customer_name || 'Walk-in'}</td>
                        <td className="py-2.5 px-3 max-w-[150px] truncate" title={row.product_name || row.item_name}>{row.product_name || row.item_name}</td>
                        <td className="py-2.5 px-3">{row.return_qty || ((row.qty_milli || 0)/1000)}</td>
                        <td className="py-2.5 px-3 font-bold text-rose-600">{fmt(row.return_amount_minor || row.total_minor)}</td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px]">
                            {row.return_reason || row.reason || '-'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            row.item_condition === 'resellable'
                              ? 'bg-emerald-50 text-emerald-700'
                              : row.item_condition === 'damaged'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-rose-50 text-rose-700'
                          }`}>
                            {row.item_condition || 'resellable'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-500">{row.cashier_name || 'Cashier'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: Exchange Report */}
          {activeTab === 'exchanges' && (
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-sm font-bold text-slate-900">Exchange Transactions</div>
                  <div className="text-xs text-slate-500">
                    Linked returns and new garment purchases
                  </div>
                </div>
                <button
                  onClick={() => exportCsv('exchanges_report', reportRows)}
                  className="px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 transition"
                >
                  Export CSV
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 font-semibold">
                      <th className="py-2.5 px-3">Exchange ID</th>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">New Invoice #</th>
                      <th className="py-2.5 px-3">New Purchase</th>
                      <th className="py-2.5 px-3">Return Adjusted</th>
                      <th className="py-2.5 px-3">Customer Paid</th>
                      <th className="py-2.5 px-3">Excess Refund</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reportRows.map((row: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-mono font-bold text-indigo-600">{row.exchange_id?.slice(0, 12)}...</td>
                        <td className="py-2.5 px-3">{row.bdate || row.date}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-800">{row.new_invoice_number || row.number}</td>
                        <td className="py-2.5 px-3 font-semibold text-slate-900">{fmt(row.new_purchase_minor || row.total_minor)}</td>
                        <td className="py-2.5 px-3 font-bold text-indigo-600">{fmt(row.exchange_adjusted_minor)}</td>
                        <td className="py-2.5 px-3 text-emerald-700">{fmt(row.customer_paid_minor || row.paid_minor)}</td>
                        <td className="py-2.5 px-3 text-rose-600">{fmt(row.excess_refund_minor || 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: Refund Report */}
          {activeTab === 'refunds' && (
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="text-sm font-bold text-slate-900">Refund Disbursements</div>
                <button
                  onClick={() => exportCsv('refunds_report', reportRows)}
                  className="px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 transition"
                >
                  Export CSV
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 font-semibold">
                      <th className="py-2.5 px-3">Refund ID</th>
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Method</th>
                      <th className="py-2.5 px-3">Amount</th>
                      <th className="py-2.5 px-3">Reference #</th>
                      <th className="py-2.5 px-3">Customer</th>
                      <th className="py-2.5 px-3">Processed By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reportRows.map((row: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-mono">{row.id?.slice(0, 8)}...</td>
                        <td className="py-2.5 px-3">{row.bdate || row.refund_date}</td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded-full bg-slate-100 font-bold uppercase text-[10px]">
                            {row.method || row.refund_method}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-bold text-rose-600">{fmt(row.amount_minor || row.refund_amount_minor)}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-500">{row.reference || row.refund_ref || '-'}</td>
                        <td className="py-2.5 px-3">{row.customer_name || 'Walk-in'}</td>
                        <td className="py-2.5 px-3 text-slate-500">{row.cashier_name || 'Cashier'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 5: Gross Profit Report */}
          {activeTab === 'gross_profit' && (
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-sm font-bold text-slate-900">Daily Gross Profit & COGS Report</div>
                  <div className="text-xs text-slate-500">
                    Net Sales minus Net Cost of Goods Sold (using purchase cost snapshots)
                  </div>
                </div>
                <button
                  onClick={() => exportCsv('gross_profit_report', reportRows)}
                  className="px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 transition"
                >
                  Export CSV
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 font-semibold">
                      <th className="py-2.5 px-3">Date</th>
                      <th className="py-2.5 px-3">Net Sales</th>
                      <th className="py-2.5 px-3">Net COGS (Cost)</th>
                      <th className="py-2.5 px-3">Gross Profit</th>
                      <th className="py-2.5 px-3">Gross Margin %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reportRows.map((row: any, idx: number) => {
                      const netSales = row.net_sales_minor || 0;
                      const cogs = row.net_cogs_minor || 0;
                      const profit = row.gross_profit_minor ?? (netSales - cogs);
                      const margin = netSales > 0 ? ((profit / netSales) * 100).toFixed(1) : '0.0';
                      return (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="py-2.5 px-3 font-bold text-slate-800">{row.bdate || row.date}</td>
                          <td className="py-2.5 px-3 font-semibold text-slate-900">{fmt(netSales)}</td>
                          <td className="py-2.5 px-3 text-rose-600">{fmt(cogs)}</td>
                          <td className="py-2.5 px-3 font-bold text-emerald-700">{fmt(profit)}</td>
                          <td className="py-2.5 px-3 font-bold text-indigo-600">{margin}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 6: Stock Return by Condition */}
          {activeTab === 'stock_condition' && (
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-sm font-bold text-slate-900">Returned Stock Inventory Routing</div>
                  <div className="text-xs text-slate-500">
                    Audit inventory destinations: Resellable (MAIN), Damaged (DAMAGED), Defective (DEFECTIVE)
                  </div>
                </div>
                <button
                  onClick={() => exportCsv('stock_condition_report', reportRows)}
                  className="px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 transition"
                >
                  Export CSV
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 font-semibold">
                      <th className="py-2.5 px-3">Condition</th>
                      <th className="py-2.5 px-3">Inventory Destination</th>
                      <th className="py-2.5 px-3">Total Qty Returned</th>
                      <th className="py-2.5 px-3">Total Cost Value</th>
                      <th className="py-2.5 px-3">Sellable Stock Impact</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reportRows.map((row: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-3 px-3 font-bold uppercase">{row.item_condition || row.condition}</td>
                        <td className="py-3 px-3 font-mono font-semibold text-indigo-600">{row.location}</td>
                        <td className="py-3 px-3 font-bold text-slate-800">{row.total_qty || ((row.qty_milli || 0)/1000)} units</td>
                        <td className="py-3 px-3 font-bold text-slate-900">{fmt(row.total_cost_minor)}</td>
                        <td className="py-3 px-3">
                          {(row.item_condition || row.condition) === 'resellable' ? (
                            <span className="px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold">
                              + Added back to sellable POS stock
                            </span>
                          ) : (
                            <span className="px-2 py-1 rounded-full bg-rose-50 text-rose-700 font-semibold">
                              Quarantined (Never added to POS stock)
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 7: Customer Store Credit */}
          {activeTab === 'store_credits' && (
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-sm font-bold text-slate-900">Customer Store Credit Ledger</div>
                  <div className="text-xs text-slate-500">Track outstanding store liability</div>
                </div>
                <button
                  onClick={() => exportCsv('store_credit_report', reportRows)}
                  className="px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 transition"
                >
                  Export CSV
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 font-semibold">
                      <th className="py-2.5 px-3">Customer</th>
                      <th className="py-2.5 px-3">Mobile</th>
                      <th className="py-2.5 px-3">Original Issued</th>
                      <th className="py-2.5 px-3">Used</th>
                      <th className="py-2.5 px-3">Remaining Balance</th>
                      <th className="py-2.5 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reportRows.map((row: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-semibold text-slate-800">{row.customer_name}</td>
                        <td className="py-2.5 px-3 font-mono">{row.customer_phone || row.phone || '-'}</td>
                        <td className="py-2.5 px-3">{fmt(row.amount_minor)}</td>
                        <td className="py-2.5 px-3 text-slate-500">{fmt(row.used_minor || 0)}</td>
                        <td className="py-2.5 px-3 font-bold text-purple-700">{fmt(row.balance_minor)}</td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            row.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                          }`}>
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 8: Cashier Performance */}
          {activeTab === 'cashier_perf' && (
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="text-sm font-bold text-slate-900">Cashier Sales & Returns Audit</div>
                <button
                  onClick={() => exportCsv('cashier_performance_report', reportRows)}
                  className="px-3 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 transition"
                >
                  Export CSV
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-400 font-semibold">
                      <th className="py-2.5 px-3">Cashier</th>
                      <th className="py-2.5 px-3">Bills Billed</th>
                      <th className="py-2.5 px-3">Gross Sales</th>
                      <th className="py-2.5 px-3">Returns Processed</th>
                      <th className="py-2.5 px-3">Return Value</th>
                      <th className="py-2.5 px-3">Net Handled</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reportRows.map((row: any, idx: number) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 font-semibold text-slate-800">{row.cashier_name}</td>
                        <td className="py-2.5 px-3">{row.invoices_count || row.invoice_count}</td>
                        <td className="py-2.5 px-3">{fmt(row.gross_sales_minor)}</td>
                        <td className="py-2.5 px-3 text-rose-600">{row.returns_count || row.return_count}</td>
                        <td className="py-2.5 px-3 text-rose-600">-{fmt(row.returns_total_minor || row.return_amount_minor)}</td>
                        <td className="py-2.5 px-3 font-bold text-emerald-700">{fmt(row.net_minor || (row.gross_sales_minor - (row.returns_total_minor || 0)))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
