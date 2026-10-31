import React, { useState, useEffect } from 'react';
import { fetchGstHistory } from '../../api.ts';
import { AlertTriangleIcon } from './GstIcons.tsx';

interface GstFilingHistoryViewProps {
  onNavigate?: (tab: string, meta?: any) => void;
}

export const GstFilingHistoryView: React.FC<GstFilingHistoryViewProps> = ({ onNavigate }) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetchGstHistory();
        setHistory(res.history || []);
      } catch (err: any) {
        setError(err.message || 'Failed to load return filing history');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          GST Return Filing &amp; Review History
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Permanent audit log of monthly return preparations, reviews, ARN acknowledgments, and locked statements.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <div className="flex h-48 items-center justify-center text-sm text-slate-500">
            Loading filing logs...
          </div>
        ) : error ? (
          <div className="flex items-center justify-center gap-2 p-6 text-center text-sm text-rose-600">
            <AlertTriangleIcon className="h-4 w-4" />
            <span>{error}</span>
          </div>
        ) : history.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <p className="text-base font-semibold">No filing history logged yet.</p>
            <p className="mt-1 text-xs">
              When you save or mark returns as reviewed in GSTR-3B or GSTR-1, the authorized snapshot will be archived here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                <tr>
                  <th className="py-3 px-4">Return Type</th>
                  <th className="py-3 px-4">Period</th>
                  <th className="py-3 px-4">GSTIN</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Filed / Reviewed By</th>
                  <th className="py-3 px-4">Date &amp; Time</th>
                  <th className="py-3 px-4">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono">
                {history.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4 font-sans font-bold text-indigo-600 dark:text-indigo-400">
                      {item.returnType}
                    </td>
                    <td className="py-3 px-4">{item.returnPeriod}</td>
                    <td className="py-3 px-4 text-slate-700 dark:text-slate-300">{item.gstin}</td>
                    <td className="py-3 px-4 font-sans">
                      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                        {item.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-sans text-slate-800 dark:text-slate-200 font-medium">
                      {item.filedByName}
                    </td>
                    <td className="py-3 px-4 text-slate-500">{new Date(item.filedAt).toLocaleString()}</td>
                    <td className="py-3 px-4 font-sans text-slate-600 dark:text-slate-400">
                      {item.notes || '—'}
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
