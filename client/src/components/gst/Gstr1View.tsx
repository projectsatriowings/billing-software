import React, { useState, useEffect } from 'react';
import { fetchGstSalesRegister, downloadFile } from '../../api.ts';
import { DownloadIcon, SpinnerIcon, AlertTriangleIcon } from './GstIcons.tsx';

interface Gstr1ViewProps {
  onNavigate?: (tab: string, meta?: any) => void;
}

export const Gstr1View: React.FC<Gstr1ViewProps> = ({ onNavigate }) => {
  const [period, setPeriod] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState<boolean>(true);
  const [exporting, setExporting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [salesData, setSalesData] = useState<any>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchGstSalesRegister(period);
        setSalesData(data);
      } catch (err: any) {
        setError(err.message || 'Failed to fetch GSTR-1 data');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [period]);

  const b2bInvoices = (salesData?.invoices || []).filter((inv: any) => Boolean(inv.customerGstin));
  const b2cInvoices = (salesData?.invoices || []).filter((inv: any) => !inv.customerGstin);

  const b2bTaxable = b2bInvoices.reduce((acc: number, inv: any) => acc + (inv.taxableMinor || 0), 0);
  const b2bCgst = b2bInvoices.reduce((acc: number, inv: any) => acc + (inv.cgstMinor || 0), 0);
  const b2bSgst = b2bInvoices.reduce((acc: number, inv: any) => acc + (inv.sgstMinor || 0), 0);
  const b2bIgst = b2bInvoices.reduce((acc: number, inv: any) => acc + (inv.igstMinor || 0), 0);

  const b2cTaxable = b2cInvoices.reduce((acc: number, inv: any) => acc + (inv.taxableMinor || 0), 0);
  const b2cCgst = b2cInvoices.reduce((acc: number, inv: any) => acc + (inv.cgstMinor || 0), 0);
  const b2cSgst = b2cInvoices.reduce((acc: number, inv: any) => acc + (inv.sgstMinor || 0), 0);
  const b2cIgst = b2cInvoices.reduce((acc: number, inv: any) => acc + (inv.igstMinor || 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            GSTR-1 Preparation (Outward Supplies Return)
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Worksheets categorized into B2B Invoices (Table 4) and B2C Supplies (Table 7) for GST Portal filing.
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
            onClick={async () => {
              try {
                setExporting(true);
                await downloadFile(
                  `/api/gst/sales-register/export?period=${encodeURIComponent(period)}`,
                  `GSTR1_Sales_Register_${period}.csv`
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
            <span className="inline-flex items-center">{exporting ? <SpinnerIcon size={15} /> : <DownloadIcon size={15} />}</span> {exporting ? 'Exporting...' : 'Download GSTR-1 CSV'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center gap-2 text-sm text-slate-500">
          <SpinnerIcon size={18} /> Loading GSTR-1 worksheets...
        </div>
      ) : error ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-sm font-semibold text-rose-700">
          <AlertTriangleIcon size={16} /> <span>{error}</span>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Section 4: B2B Invoices */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-3.5 dark:border-slate-800 dark:bg-slate-800/60">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Table 4: B2B Invoices (Supplies to Registered Persons)
                </h2>
                <p className="text-xs text-slate-500">Invoices containing valid recipient GSTIN</p>
              </div>
              <div className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                {b2bInvoices.length} Invoices · Taxable: ₹{(b2bTaxable / 100).toFixed(2)}
              </div>
            </div>

            {b2bInvoices.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No B2B invoices recorded in this period.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="border-b border-slate-200 bg-slate-100/50 font-sans font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300">
                    <tr>
                      <th className="py-2.5 px-4">Invoice #</th>
                      <th className="py-2.5 px-4">Date</th>
                      <th className="py-2.5 px-4 font-sans">Customer</th>
                      <th className="py-2.5 px-4">GSTIN</th>
                      <th className="py-2.5 px-4 text-right">Taxable Value</th>
                      <th className="py-2.5 px-4 text-right">CGST</th>
                      <th className="py-2.5 px-4 text-right">SGST</th>
                      <th className="py-2.5 px-4 text-right">IGST</th>
                      <th className="py-2.5 px-4 text-right font-bold">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                    {b2bInvoices.map((inv: any) => (
                      <tr key={inv.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-4 font-semibold text-indigo-600 dark:text-indigo-400">
                          {inv.invoiceNumber}
                        </td>
                        <td className="py-2.5 px-4 text-slate-500">{inv.invoiceDate}</td>
                        <td className="py-2.5 px-4 font-sans font-medium text-slate-900 dark:text-slate-100">
                          {inv.customerName}
                        </td>
                        <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">{inv.customerGstin}</td>
                        <td className="py-2.5 px-4 text-right">₹{(inv.taxableMinor / 100).toFixed(2)}</td>
                        <td className="py-2.5 px-4 text-right">₹{(inv.cgstMinor / 100).toFixed(2)}</td>
                        <td className="py-2.5 px-4 text-right">₹{(inv.sgstMinor / 100).toFixed(2)}</td>
                        <td className="py-2.5 px-4 text-right">₹{(inv.igstMinor / 100).toFixed(2)}</td>
                        <td className="py-2.5 px-4 text-right font-bold text-slate-900 dark:text-white">
                          ₹{(inv.totalMinor / 100).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-slate-200 bg-slate-50 font-bold dark:border-slate-800 dark:bg-slate-800/60">
                    <tr>
                      <td colSpan={4} className="py-2.5 px-4 font-sans">Total B2B</td>
                      <td className="py-2.5 px-4 text-right">₹{(b2bTaxable / 100).toFixed(2)}</td>
                      <td className="py-2.5 px-4 text-right">₹{(b2bCgst / 100).toFixed(2)}</td>
                      <td className="py-2.5 px-4 text-right">₹{(b2bSgst / 100).toFixed(2)}</td>
                      <td className="py-2.5 px-4 text-right">₹{(b2bIgst / 100).toFixed(2)}</td>
                      <td className="py-2.5 px-4 text-right">₹{((b2bTaxable + b2bCgst + b2bSgst + b2bIgst) / 100).toFixed(2)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Table 7: B2C (Others) Summary */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 bg-slate-50 px-6 py-3.5 dark:border-slate-800 dark:bg-slate-800/60">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Table 7: B2C (Others) — Supplies to Unregistered Consumers
              </h2>
              <p className="text-xs text-slate-500">Consolidated counter/retail retail sales</p>
            </div>
            <div className="p-6">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: '1rem',
                }}
              >
                <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-800/50">
                  <div className="text-xs text-slate-500">B2C Bills Count</div>
                  <div className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{b2cInvoices.length}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-800/50">
                  <div className="text-xs text-slate-500">Taxable Value</div>
                  <div className="mt-1 text-xl font-bold font-mono text-slate-900 dark:text-white">
                    ₹{(b2cTaxable / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-800/50">
                  <div className="text-xs text-slate-500">Central Tax (CGST)</div>
                  <div className="mt-1 text-xl font-bold font-mono text-indigo-600 dark:text-indigo-400">
                    ₹{(b2cCgst / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 p-4 dark:bg-slate-800/50">
                  <div className="text-xs text-slate-500">State/UT Tax (SGST)</div>
                  <div className="mt-1 text-xl font-bold font-mono text-indigo-600 dark:text-indigo-400">
                    ₹{(b2cSgst / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
