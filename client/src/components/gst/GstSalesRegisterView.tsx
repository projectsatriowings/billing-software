import React, { useState, useEffect, useRef } from 'react';
import { fetchGstSalesRegister, downloadFile } from '../../api.ts';
import {
  DownloadIcon,
  SpinnerIcon,
  AlertTriangleIcon,
  RefreshIcon,
  CalendarIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileSpreadsheetIcon,
} from './GstIcons.tsx';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface MonthYearPickerProps {
  value: string; // 'YYYY-MM'
  onChange: (val: string) => void;
}

export const MonthYearPicker: React.FC<MonthYearPickerProps> = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const [selectedYearStr, selectedMonthStr] = (value || '').split('-');
  const selectedYear = parseInt(selectedYearStr, 10) || new Date().getFullYear();
  const selectedMonth = parseInt(selectedMonthStr, 10) || (new Date().getMonth() + 1);

  const [viewYear, setViewYear] = useState<number>(selectedYear);

  useEffect(() => {
    setViewYear(selectedYear);
  }, [selectedYear]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const displayMonthName = MONTH_NAMES[selectedMonth - 1] || 'Nov';
  const displayLabel = `${displayMonthName} ${selectedYear}`;

  return (
    <div className="relative inline-block w-full sm:w-auto" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          height: '40px',
          borderRadius: '10px',
          border: isOpen ? '1px solid #5B4FE9' : '1px solid #E2E0EF',
          background: '#FFFFFF',
          padding: '0 14px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          cursor: 'pointer',
          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
          transition: 'all 0.15s ease',
          fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
          width: '100%',
          justifyContent: 'space-between',
          boxSizing: 'border-box',
        }}
        onMouseEnter={(e) => {
          if (!isOpen) e.currentTarget.style.borderColor = '#CBD5E1';
        }}
        onMouseLeave={(e) => {
          if (!isOpen) e.currentTarget.style.borderColor = '#E2E0EF';
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <CalendarIcon size={16} className="text-slate-500" />
          <span style={{ color: '#64748B', fontSize: '13px', fontWeight: 500 }}>Period:</span>
          <span style={{ color: '#0F172A', fontSize: '14px', fontWeight: 600 }}>{displayLabel}</span>
        </div>
        <ChevronDownIcon
          size={14}
          className="text-slate-400 transition-transform duration-200"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'none', marginLeft: '6px' }}
        />
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 60,
            background: '#FFFFFF',
            borderRadius: '12px',
            border: '1px solid #E2E0EF',
            boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.12), 0 8px 10px -6px rgba(15, 23, 42, 0.04)',
            padding: '16px',
            width: '260px',
            fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
            boxSizing: 'border-box',
          }}
        >
          {/* Year Switcher Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
            <button
              type="button"
              onClick={() => setViewYear((y) => y - 1)}
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '8px',
                border: '1px solid #E2E8F0',
                background: '#FFFFFF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#475569',
              }}
              title="Previous Year"
            >
              <ChevronLeftIcon size={14} />
            </button>
            <span style={{ fontSize: '15px', fontWeight: 700, color: '#0F172A' }}>{viewYear}</span>
            <button
              type="button"
              onClick={() => setViewYear((y) => y + 1)}
              disabled={viewYear >= currentYear}
              style={{
                width: '30px',
                height: '30px',
                borderRadius: '8px',
                border: '1px solid #E2E8F0',
                background: '#FFFFFF',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: viewYear >= currentYear ? 'not-allowed' : 'pointer',
                color: viewYear >= currentYear ? '#CBD5E1' : '#475569',
                opacity: viewYear >= currentYear ? 0.4 : 1,
              }}
              title="Next Year"
            >
              <ChevronRightIcon size={14} />
            </button>
          </div>

          {/* 3x4 Month Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
            {MONTH_NAMES.map((name, idx) => {
              const monthNum = idx + 1;
              const isFuture = viewYear > currentYear || (viewYear === currentYear && monthNum > currentMonth);
              const isSelected = viewYear === selectedYear && monthNum === selectedMonth;
              const monthKey = `${viewYear}-${String(monthNum).padStart(2, '0')}`;

              return (
                <button
                  key={name}
                  type="button"
                  disabled={isFuture}
                  onClick={() => {
                    onChange(monthKey);
                    setIsOpen(false);
                  }}
                  style={{
                    height: '36px',
                    borderRadius: '8px',
                    border: 'none',
                    fontSize: '13px',
                    fontWeight: isSelected ? 600 : 500,
                    cursor: isFuture ? 'not-allowed' : 'pointer',
                    background: isSelected ? '#5B4CF5' : 'transparent',
                    color: isSelected ? '#FFFFFF' : isFuture ? '#CBD5E1' : '#334155',
                    boxShadow: isSelected ? '0 2px 6px rgba(91, 76, 245, 0.3)' : 'none',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected && !isFuture) {
                      e.currentTarget.style.backgroundColor = '#F1F5F9';
                      e.currentTarget.style.color = '#0F172A';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected && !isFuture) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = '#334155';
                    }
                  }}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

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
  const [exportMenuOpen, setExportMenuOpen] = useState<boolean>(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [exportMenuOpen]);

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
    <div className="gst-sales-register-container">
      {/* ── ACTIONS ROW: PERIOD PICKER & EXPORT CSV BUTTON ── */}
      <div className="gst-sales-register-actions-row">
        {/* Left: Custom Month/Year Picker */}
        <div className="gst-sales-register-period-wrapper">
          <MonthYearPicker value={period} onChange={setPeriod} />
        </div>

        {/* Right: Export CSV Split Button */}
        <div className="gst-export-split-btn-container" ref={exportMenuRef}>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={exporting}
            className="gst-export-split-btn-main"
            title="Export outward sales register to CSV"
          >
            {exporting ? (
              <SpinnerIcon size={16} className="text-slate-500 animate-spin" />
            ) : (
              <DownloadIcon size={16} className="text-slate-600" />
            )}
            <span>{exporting ? 'Exporting...' : 'Export CSV'}</span>
          </button>

          {/* Full-height vertical divider */}
          <div className="gst-export-split-btn-divider" aria-hidden="true" />

          {/* Dropdown Toggle Chevron */}
          <button
            type="button"
            onClick={() => setExportMenuOpen(!exportMenuOpen)}
            disabled={exporting}
            className={`gst-export-split-btn-chevron ${exportMenuOpen ? 'is-active' : ''}`}
            title="More export options"
            aria-expanded={exportMenuOpen}
            aria-haspopup="true"
          >
            <ChevronDownIcon
              size={14}
              style={{
                transform: exportMenuOpen ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.15s ease',
              }}
            />
          </button>

          {/* Export Menu Dropdown (Right-aligned popover) */}
          {exportMenuOpen && (
            <div className="gst-export-dropdown-popover">
              <button
                type="button"
                onClick={() => {
                  setExportMenuOpen(false);
                  handleExportCsv();
                }}
                className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-md flex items-center gap-2"
              >
                <DownloadIcon size={14} className="text-slate-500" />
                <span>Export CSV (Sales Register)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setExportMenuOpen(false);
                  handleExportCsv();
                }}
                className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-md flex items-center gap-2"
              >
                <FileSpreadsheetIcon size={14} className="text-emerald-600" />
                <span>Export Excel (.csv)</span>
              </button>
              {onNavigate && (
                <button
                  type="button"
                  onClick={() => {
                    setExportMenuOpen(false);
                    onNavigate('gst-gstr1');
                  }}
                  className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-md flex items-center gap-2"
                >
                  <span className="text-purple-600 font-bold text-[10px] px-1.5 py-0.5 bg-purple-50 rounded">JSON</span>
                  <span>GSTR-1 Outward Supplies</span>
                </button>
              )}
            </div>
          )}
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
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900" style={{ marginBottom: '1.5rem' }}>
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
                  <th className="p-3">Invoice #</th>
                  <th className="p-3">Date</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Customer Name</th>
                  <th className="p-3">Customer GSTIN</th>
                  <th className="p-3">Place of Supply</th>
                  <th className="p-3 text-right">Taxable Value</th>
                  <th className="p-3 text-right">CGST</th>
                  <th className="p-3 text-right">SGST</th>
                  <th className="p-3 text-right">IGST</th>
                  <th className="p-3 text-right">Round Off</th>
                  <th className="p-3 text-right">Total Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filteredInvoices.map((inv) => {
                  const isB2B = Boolean(inv.customerGstin);
                  return (
                    <tr key={inv.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                      <td className="p-3 font-semibold text-slate-900 dark:text-white">
                        {inv.invoiceNumber || inv.number}
                      </td>
                      <td className="p-3 text-slate-600 dark:text-slate-300">{inv.invoiceDate || inv.bdate}</td>
                      <td className="p-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${isB2B
                            ? 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300'
                            : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                            }`}
                        >
                          {isB2B ? 'B2B' : 'B2C'}
                        </span>
                      </td>
                      <td className="p-3 text-slate-800 dark:text-slate-200">
                        {inv.customerName || (isB2B ? 'Registered Buyer' : 'Counter Retail Cash')}
                      </td>
                      <td className="p-3 font-mono text-slate-600 dark:text-slate-400">
                        {inv.customerGstin || '—'}
                      </td>
                      <td className="p-3 text-slate-600 dark:text-slate-400">
                        {inv.placeOfSupplyState || (inv.intra ? 'Tamil Nadu (33)' : 'Interstate')}
                      </td>
                      <td className="p-3 text-right font-medium text-slate-900 dark:text-white">
                        ₹{(inv.taxableMinor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-3 text-right text-slate-600 dark:text-slate-300">
                        ₹{(inv.cgstMinor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-3 text-right text-slate-600 dark:text-slate-300">
                        ₹{(inv.sgstMinor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-3 text-right text-slate-600 dark:text-slate-300">
                        ₹{(inv.igstMinor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="p-3 text-right text-slate-400">
                        {inv.roundOffMinor ? `₹${(inv.roundOffMinor / 100).toFixed(2)}` : '—'}
                      </td>
                      <td className="p-3 text-right font-bold text-slate-900 dark:text-white">
                        ₹{(inv.totalAmountMinor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
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
