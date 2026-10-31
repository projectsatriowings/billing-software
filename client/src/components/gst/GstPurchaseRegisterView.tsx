import React, { useState, useEffect } from 'react';
import { fetchGstPurchaseRegister, downloadFile } from '../../api.ts';
import { DownloadIcon, SpinnerIcon, AlertTriangleIcon } from './GstIcons.tsx';

interface GstPurchaseRegisterViewProps {
  onNavigate?: (tab: string, meta?: any) => void;
}

export const GstPurchaseRegisterView: React.FC<GstPurchaseRegisterViewProps> = ({ onNavigate }) => {
  const [period, setPeriod] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    period: string;
    items: any[];
    summary: {
      totalRecords: number;
      purchasesCount: number;
      expensesCount: number;
      totalTaxableMinor: number;
      totalGstMinor: number;
      totalItcMinor: number;
      totalAmountMinor: number;
    };
  } | null>(null);

  const [search, setSearch] = useState<string>('');
  const [docTypeFilter, setDocTypeFilter] = useState<string>('all');
  const [exporting, setExporting] = useState<boolean>(false);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchGstPurchaseRegister(period);
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load purchase register');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [period]);

  const handleExportCsv = async () => {
    try {
      setExporting(true);
      await downloadFile(
        `/api/gst/purchase-register/export?period=${encodeURIComponent(period)}`,
        `GST_Purchase_Register_${period}.csv`
      );
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const filteredItems = (data?.items || []).filter((item) => {
    if (docTypeFilter !== 'all' && item.docType !== docTypeFilter) return false;

    if (search.trim()) {
      const q = search.toLowerCase();
      const matchName = (item.supplierName || '').toLowerCase().includes(q);
      const matchGstin = (item.supplierGstin || '').toLowerCase().includes(q);
      const matchInv = (item.supplierInvoiceNumber || '').toLowerCase().includes(q);
      const matchDoc = (item.docNumber || '').toLowerCase().includes(q);
      if (!matchName && !matchGstin && !matchInv && !matchDoc) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            GST Purchase & Expense Inward Register
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Combined statutory record of all stock purchase bills and business expense vouchers bearing inward GST.
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
            type="button"
            onClick={handleExportCsv}
            disabled={exporting}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {exporting ? <SpinnerIcon className="h-4 w-4 animate-spin text-slate-500" /> : <DownloadIcon className="h-4 w-4 text-slate-600" />}
            <span>{exporting ? 'Exporting...' : 'Export CSV'}</span>
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      {data && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '1rem',
            marginBottom: '1.25rem',
          }}
        >
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Inward Records</div>
            <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
              {data.summary.totalRecords}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {data.summary.purchasesCount} Purchases · {data.summary.expensesCount} Expenses
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Taxable Inward Value</div>
            <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
              ₹{(data.summary.totalTaxableMinor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div className="mt-1 text-xs text-slate-400">Before Tax</div>
          </div>

          <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 shadow-sm dark:border-indigo-800/40 dark:bg-indigo-950/20">
            <div className="text-xs font-medium text-indigo-700 dark:text-indigo-300">Total Inward GST</div>
            <div className="mt-1 text-2xl font-bold text-indigo-600 dark:text-indigo-400">
              ₹{(data.summary.totalGstMinor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div className="mt-1 text-xs text-indigo-600/80">CGST + SGST + IGST</div>
          </div>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-sm dark:border-emerald-800/40 dark:bg-emerald-950/20">
            <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Reviewed Eligible ITC</div>
            <div className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              ₹{(data.summary.totalItcMinor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div className="mt-1 text-xs text-emerald-600/80">Approved Claim</div>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search supplier, GSTIN, invoice number..."
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
          <option value="all">All Inward Types</option>
          <option value="purchase">Stock Purchases</option>
          <option value="expense">Business Expenses</option>
        </select>
      </div>

      {/* Items Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <div className="flex h-48 items-center justify-center text-sm text-slate-500">
            Loading inward records...
          </div>
        ) : error ? (
          <div className="flex items-center justify-center gap-2 p-6 text-center text-sm text-rose-600">
            <AlertTriangleIcon className="h-4 w-4" />
            <span>{error}</span>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <p className="text-base font-semibold">No inward purchases or expenses found for {period}.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                <tr>
                  <th className="py-3 px-3">Type</th>
                  <th className="py-3 px-3">Doc Ref</th>
                  <th className="py-3 px-3">Supplier / Vendor</th>
                  <th className="py-3 px-3">Supplier GSTIN</th>
                  <th className="py-3 px-3">Supplier Bill No &amp; Date</th>
                  <th className="py-3 px-3 text-right">Taxable Value</th>
                  <th className="py-3 px-3 text-right">CGST</th>
                  <th className="py-3 px-3 text-right">SGST</th>
                  <th className="py-3 px-3 text-right">IGST</th>
                  <th className="py-3 px-3 text-right font-bold">Total Inward GST</th>
                  <th className="py-3 px-3 text-right font-bold text-emerald-600">Eligible ITC</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono">
                {filteredItems.map((item) => (
                  <tr key={`${item.docType}_${item.docId}`} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-3 font-sans">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          item.docType === 'purchase'
                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                            : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                        }`}
                      >
                        {item.docType}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-700 dark:text-slate-300 font-semibold">
                      {item.docNumber}
                    </td>
                    <td className="py-3 px-3 font-sans font-medium text-slate-900 dark:text-slate-100">
                      {item.supplierName}
                    </td>
                    <td className="py-3 px-3 text-[11px] text-slate-600 dark:text-slate-400">
                      {item.supplierGstin || <span className="text-slate-400 font-sans italic">Unregistered</span>}
                    </td>
                    <td className="py-3 px-3">
                      <div className="text-slate-800 dark:text-slate-200">{item.supplierInvoiceNumber}</div>
                      <div className="text-[10px] text-slate-400 font-sans">{item.supplierInvoiceDate}</div>
                    </td>
                    <td className="py-3 px-3 text-right text-slate-700 dark:text-slate-300">
                      ₹{(item.taxableMinor / 100).toFixed(2)}
                    </td>
                    <td className="py-3 px-3 text-right text-slate-600 dark:text-slate-400">
                      ₹{(item.cgstMinor / 100).toFixed(2)}
                    </td>
                    <td className="py-3 px-3 text-right text-slate-600 dark:text-slate-400">
                      ₹{(item.sgstMinor / 100).toFixed(2)}
                    </td>
                    <td className="py-3 px-3 text-right text-slate-600 dark:text-slate-400">
                      ₹{(item.igstMinor / 100).toFixed(2)}
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-slate-900 dark:text-white">
                      ₹{(item.totalGstMinor / 100).toFixed(2)}
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-emerald-600 dark:text-emerald-400">
                      ₹{(item.itcMinor / 100).toFixed(2)}
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
