import React, { useState } from 'react';
import { importGstr2b } from '../../api.ts';
import { XIcon, CheckCircleIcon, AlertTriangleIcon } from './GstIcons.tsx';

interface Gstr2bImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete: () => void;
  defaultPeriod?: string;
  defaultGstin?: string;
}

export const Gstr2bImportModal: React.FC<Gstr2bImportModalProps> = ({
  isOpen,
  onClose,
  onImportComplete,
  defaultPeriod = new Date().toISOString().slice(0, 7),
  defaultGstin = '',
}) => {
  const [gstin, setGstin] = useState(defaultGstin);
  const [returnPeriod, setReturnPeriod] = useState(defaultPeriod);
  const [file, setFile] = useState<File | null>(null);
  const [fileFormat, setFileFormat] = useState<'json' | 'csv'>('json');
  const [parsedPreview, setParsedPreview] = useState<{
    recordCount: number;
    sampleRows: any[];
    rawContent: any;
  } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [importResult, setImportResult] = useState<{
    totalRecords: number;
    matchedCount: number;
    mismatchedCount: number;
    missingInBooksCount: number;
  } | null>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    setParseError(null);
    setParsedPreview(null);
    setImportResult(null);

    if (!selectedFile) {
      setFile(null);
      return;
    }

    setFile(selectedFile);
    const isJson = selectedFile.name.toLowerCase().endsWith('.json');
    const isCsv = selectedFile.name.toLowerCase().endsWith('.csv');

    if (!isJson && !isCsv) {
      setParseError('Unsupported file type. Please upload a standard GST Portal GSTR-2B JSON or CSV file.');
      return;
    }

    const detectedFormat = isJson ? 'json' : 'csv';
    setFileFormat(detectedFormat);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        if (detectedFormat === 'json') {
          const json = JSON.parse(text);
          let records: any[] = [];
          if (json.data?.docdata?.b2b) {
            // Nested portal structure
            records = json.data.docdata.b2b;
          } else if (Array.isArray(json.b2b)) {
            records = json.b2b;
          } else if (Array.isArray(json)) {
            records = json;
          } else {
            // Flatten generic b2b if present
            records = [json];
          }
          setParsedPreview({
            recordCount: records.length || 1,
            sampleRows: records.slice(0, 5),
            rawContent: json,
          });
        } else {
          // CSV preview
          const lines = text.split(/\r?\n/).filter(Boolean);
          if (lines.length < 2) {
            setParseError('CSV file has no data rows.');
            return;
          }
          const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
          const samples = lines.slice(1, 6).map((l) => {
            const cols = l.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
            const obj: Record<string, string> = {};
            headers.forEach((h, idx) => {
              obj[h] = cols[idx] || '';
            });
            return obj;
          });
          setParsedPreview({
            recordCount: lines.length - 1,
            sampleRows: samples,
            rawContent: text,
          });
        }
      } catch (err: any) {
        setParseError(`Failed to parse file: ${err.message || 'Invalid format'}`);
      }
    };
    reader.readAsText(selectedFile);
  };

  const handleImport = async (forceOverwrite = false) => {
    if (!parsedPreview || !file) return;
    setIsSubmitting(true);
    setParseError(null);

    try {
      const res = await importGstr2b({
        gstin: gstin.trim().toUpperCase(),
        returnPeriod,
        filename: file.name,
        fileFormat,
        fileContent: parsedPreview.rawContent,
        forceOverwrite,
      });

      setImportResult({
        totalRecords: res.totalRecords,
        matchedCount: res.matchedCount,
        mismatchedCount: res.mismatchedCount,
        missingInBooksCount: res.missingInBooksCount,
      });
      onImportComplete();
    } catch (err: any) {
      if (err.status === 409) {
        if (
          window.confirm(
            'A GSTR-2B import for this GSTIN and period already exists. Do you want to overwrite and re-match?'
          )
        ) {
          handleImport(true);
          return;
        }
      }
      setParseError(err.message || 'Import failed. Please check the file structure.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Import GSTR-2B Statement</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Upload official GST portal GSTR-2B JSON or Excel/CSV download to reconcile against purchase invoices and expenses.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          {importResult ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center dark:border-emerald-800/40 dark:bg-emerald-950/30">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/60">
                <CheckCircleIcon className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h3 className="mt-3 text-lg font-bold text-emerald-900 dark:text-emerald-200">Reconciliation Complete</h3>
              <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
                GSTR-2B records were matched against existing purchases & expenses.
              </p>
              <div className="mt-6 grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-white p-3 shadow-sm dark:bg-slate-800">
                  <div className="text-xs text-slate-500">Auto-Matched</div>
                  <div className="text-xl font-bold text-emerald-600">{importResult.matchedCount}</div>
                </div>
                <div className="rounded-lg bg-white p-3 shadow-sm dark:bg-slate-800">
                  <div className="text-xs text-slate-500">Mismatches</div>
                  <div className="text-xl font-bold text-amber-600">{importResult.mismatchedCount}</div>
                </div>
                <div className="rounded-lg bg-white p-3 shadow-sm dark:bg-slate-800">
                  <div className="text-xs text-slate-500">Missing in Books</div>
                  <div className="text-xl font-bold text-rose-600">{importResult.missingInBooksCount}</div>
                </div>
              </div>
              <button
                onClick={onClose}
                className="mt-6 rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
              >
                View ITC Register
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Recipient GSTIN (Your Shop)
                  </label>
                  <input
                    type="text"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value.toUpperCase())}
                    placeholder="e.g. 33AAAAA0000A1Z5"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono uppercase focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Return Period (YYYY-MM)
                  </label>
                  <input
                    type="month"
                    value={returnPeriod}
                    onChange={(e) => setReturnPeriod(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Select Statement File (GSTR-2B JSON / CSV)
                </label>
                <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 p-6 text-center hover:border-indigo-500 dark:border-slate-700">
                  <input
                    type="file"
                    accept=".json,.csv"
                    onChange={handleFileChange}
                    className="hidden"
                    id="gstr2b-file-upload"
                  />
                  <label
                    htmlFor="gstr2b-file-upload"
                    className="cursor-pointer font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                  >
                    {file ? file.name : 'Click to select GSTR-2B JSON or CSV file'}
                  </label>
                  <p className="mt-1 text-xs text-slate-400">
                    Official download from GST Portal (GSTR-2B auto-drafted ITC statement)
                  </p>
                </div>
              </div>

              {parseError && (
                <div className="flex items-center gap-1.5 rounded-lg bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                  <AlertTriangleIcon className="h-4 w-4 shrink-0" />
                  <span>{parseError}</span>
                </div>
              )}

              {parsedPreview && (
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/40">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700 dark:text-slate-300">
                    <span>Parsed Content Preview</span>
                    <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                      {parsedPreview.recordCount} items detected
                    </span>
                  </div>
                  <div className="max-h-40 overflow-x-auto text-[11px] font-mono text-slate-600 dark:text-slate-300">
                    <pre className="whitespace-pre-wrap">
                      {JSON.stringify(parsedPreview.sampleRows, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {!importResult && (
          <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4 dark:border-slate-800">
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              onClick={() => handleImport(false)}
              disabled={!parsedPreview || isSubmitting}
              className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {isSubmitting ? 'Importing & Reconciling...' : 'Confirm & Reconcile'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
