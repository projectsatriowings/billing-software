import React, { useState, useEffect } from 'react';
import { fetchGstSalesRegister, downloadFile } from '../../api.ts';
import { DownloadIcon, SpinnerIcon, AlertTriangleIcon } from './GstIcons.tsx';

interface GstSalesRegisterViewProps {
  onNavigate?: (tab: string, meta?: any) => void;
}

export const GstSalesRegisterView: React.FC<GstSalesRegisterViewProps> = ({ onNavigate }) => {
  const [period, setPeriod] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    period: string;
    invoices: any[];
    summary: {
      totalInvoices: number;
      b2bCount: number;
      b2cCount: number;
      totalTaxableMinor: number;
      totalGstMinor: number;
      totalAmountMinor: number;
    };
  } | null>(null);

  const [search, setSearch] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [exporting, setExporting] = useState<boolean>(false);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetchGstSalesRegister(period);
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load sales register');
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
        `/api/gst/sales-register/export?period=${encodeURIComponent(period)}`,
        `GST_Sales_Register_${period}.csv`
      );
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const filteredInvoices = (data?.invoices || []).filter((inv) => {
    if (typeFilter === 'b2b' && !inv.customerGstin) return false;
    if (typeFilter === 'b2c' && inv.customerGstin) return false;

    if (search.trim()) {
      const q = search.toLowerCase();
      const invNum = String(inv.invoiceNumber || inv.number || '').toLowerCase();
      const matchInv = invNum.includes(q);
      const matchCust = (inv.customerName || '').toLowerCase().includes(q);
      const matchGstin = (inv.customerGstin || '').toLowerCase().includes(q);
      if (!matchInv && !matchCust && !matchGstin) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            GST Sales Register (Outward Supplies)
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Comprehensive audit log of all outward retail and wholesale bills, GST breakdown, and B2B/B2C classification.
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
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Invoices</div>
            <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
              {data.summary.totalInvoices}
            </div>
            <div className="mt-1 text-xs text-slate-400">
              {data.summary.b2bCount} B2B · {data.summary.b2cCount} B2C
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Taxable Outward Value</div>
            <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
              ₹{(data.summary.totalTaxableMinor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div className="mt-1 text-xs text-slate-400">Before Tax</div>
          </div>

          <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4 shadow-sm dark:border-indigo-800/40 dark:bg-indigo-950/20">
            <div className="text-xs font-medium text-indigo-700 dark:text-indigo-300">Total Output GST</div>
            <div className="mt-1 text-2xl font-bold text-indigo-600 dark:text-indigo-400">
              ₹{(data.summary.totalGstMinor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div className="mt-1 text-xs text-indigo-600/80">CGST + SGST + IGST</div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Gross Invoice Value</div>
            <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">
              ₹{(data.summary.totalAmountMinor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </div>
            <div className="mt-1 text-xs text-slate-400">Total Billed</div>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search invoice number, customer name, GSTIN..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
        >
          <option value="all">All Invoices</option>
          <option value="b2b">B2B (Registered with GSTIN)</option>
          <option value="b2c">B2C (Consumer Sales)</option>
        </select>
      </div>

      {/* Invoices Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <div className="flex h-48 items-center justify-center text-sm text-slate-500">
            Loading sales register records...
          </div>
        ) : error ? (
          <div className="flex items-center justify-center gap-2 p-6 text-center text-sm text-rose-600">
            <AlertTriangleIcon className="h-4 w-4" />
            <span>{error}</span>
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <p className="text-base font-semibold">No sales invoices found for {period}.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                <tr>
                  <th className="py-3 px-3">Invoice Number</th>
                  <th className="py-3 px-3">Date</th>
                  <th className="py-3 px-3">Customer Name</th>
                  <th className="py-3 px-3">GSTIN</th>
                  <th className="py-3 px-3 text-center">Type</th>
                  <th className="py-3 px-3 text-right">Taxable Value</th>
                  <th className="py-3 px-3 text-right">CGST</th>
                  <th className="py-3 px-3 text-right">SGST</th>
                  <th className="py-3 px-3 text-right">IGST</th>
                  <th className="py-3 px-3 text-right font-bold">Total Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono">
                {filteredInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-3 font-semibold text-indigo-600 dark:text-indigo-400">
                      {inv.invoiceNumber || inv.number || '-'}
                    </td>
                    <td className="py-3 px-3 text-slate-500">{inv.invoiceDate || inv.date || '-'}</td>
                    <td className="py-3 px-3 font-sans font-medium text-slate-900 dark:text-slate-100">
                      {inv.customerName || 'Walk-in Customer'}
                    </td>
                    <td className="py-3 px-3 text-[11px] text-slate-600 dark:text-slate-400">
                      {inv.customerGstin || <span className="text-slate-400 font-sans italic">N/A</span>}
                    </td>
                    <td className="py-3 px-3 text-center font-sans">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold ${
                          inv.customerGstin
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {inv.customerGstin ? 'B2B' : 'B2C'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right text-slate-700 dark:text-slate-300">
                      ₹{(inv.taxableMinor / 100).toFixed(2)}
                    </td>
                    <td className="py-3 px-3 text-right text-slate-600 dark:text-slate-400">
                      ₹{(inv.cgstMinor / 100).toFixed(2)}
                    </td>
                    <td className="py-3 px-3 text-right text-slate-600 dark:text-slate-400">
                      ₹{(inv.sgstMinor / 100).toFixed(2)}
                    </td>
                    <td className="py-3 px-3 text-right text-slate-600 dark:text-slate-400">
                      ₹{(inv.igstMinor / 100).toFixed(2)}
                    </td>
                    <td className="py-3 px-3 text-right font-bold text-slate-900 dark:text-white">
                      ₹{(inv.totalMinor / 100).toFixed(2)}
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
