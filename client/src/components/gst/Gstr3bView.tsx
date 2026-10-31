import React, { useState, useEffect } from 'react';
import { fetchGstr3b, saveGstr3b, downloadFile, type Gstr3bSummary } from '../../api.ts';
import { fmtMoney } from '../../../../shared/money.ts';
import {
  FileTextIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  SpinnerIcon,
  CheckIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  GstBuildingIcon,
  ArrowRightIcon,
} from './GstIcons.tsx';

interface Gstr3bViewProps {
  onNavigate?: (tab: string, meta?: any) => void;
}

export const Gstr3bView: React.FC<Gstr3bViewProps> = ({ onNavigate }) => {
  const [period, setPeriod] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [exporting, setExporting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [gstr3b, setGstr3b] = useState<Gstr3bSummary | null>(null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  const [yearStr, monthStr] = period.split('-');
  const yearNum = parseInt(yearStr, 10);
  const monthNum = parseInt(monthStr, 10);

  const changeMonth = (delta: number) => {
    if (!yearNum || !monthNum) return;
    const d = new Date(yearNum, monthNum - 1 + delta, 1);
    setPeriod(d.toISOString().slice(0, 7));
  };

  const setThisMonth = () => setPeriod(new Date().toISOString().slice(0, 7));

  const periodLabel = (() => {
    if (!yearNum || !monthNum) return period;
    const d = new Date(yearNum, monthNum - 1, 1);
    return d.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  })();

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      setSaveSuccessMsg(null);
      const data = await fetchGstr3b(period);
      setGstr3b(data);
    } catch (err: any) {
      setError(err.message || 'Failed to generate GSTR-3B statement');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [period]);

  const handleSaveDraft = async (status: 'draft' | 'reviewed') => {
    if (!gstr3b) return;
    setSaving(true);
    setSaveSuccessMsg(null);
    try {
      await saveGstr3b({
        gstin: gstr3b.gstin,
        returnPeriod: period,
        status,
        summary: gstr3b,
        notes: `GSTR-3B for ${period} saved as ${status}.`,
      });
      setSaveSuccessMsg(`GSTR-3B successfully saved as ${status}.`);
      await loadData();
    } catch (err: any) {
      alert(`Error saving GSTR-3B: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const renderAmount = (
    minor: number,
    opts: { isEligible?: boolean; isReversal?: boolean; isHighlight?: boolean } = {}
  ) => {
    if (!minor || minor === 0) {
      return <span className="zero-val">₹0.00</span>;
    }
    let cls = 'active-val';
    if (opts.isEligible) cls = 'eligible-val';
    if (opts.isReversal) cls = 'reversal-val';
    return <span className={cls}>{fmtMoney(minor)}</span>;
  };

  return (
    <div className="gstr3b-view-wrapper">
      {/* Header and Action Controls Card */}
      <div className="gstr3b-header-card">
        <div className="gstr3b-header-left">
          <h1 className="gstr3b-header-title">
            <span className="inline-flex items-center text-indigo-600"><FileTextIcon className="h-6 w-6" /></span> GSTR-3B Preparation &amp; Filing Worksheets
          </h1>
          <p className="gstr3b-header-subtitle">
            Monthly summary return computation based on authorized sales invoices and reviewed eligible Input Tax Credit for {periodLabel}.
          </p>
        </div>

        <div className="gstr3b-header-actions">
          {/* Month Stepper Picker */}
          <div className="gst-period-picker-group">
            <span className="gst-period-label">Period</span>
            <button
              type="button"
              className="gst-period-nav-btn"
              onClick={() => changeMonth(-1)}
              title="Previous Month"
            >
              <ChevronLeftIcon className="h-3.5 w-3.5" />
            </button>
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="gst-period-input"
            />
            <button
              type="button"
              className="gst-period-nav-btn"
              onClick={() => changeMonth(1)}
              title="Next Month"
            >
              <ChevronRightIcon className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={setThisMonth}
            className="gst-pill-btn"
            title="Jump to current return month"
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            <span>Current</span>
          </button>

          <button
            type="button"
            onClick={async () => {
              try {
                setExporting(true);
                await downloadFile(
                  `/api/gst/gstr3b/export?period=${encodeURIComponent(period)}`,
                  `GSTR3B_Summary_${period}.csv`
                );
              } catch (err: any) {
                alert(`Export failed: ${err.message}`);
              } finally {
                setExporting(false);
              }
            }}
            disabled={exporting}
            className="gst-pill-btn"
            title="Download filing summary in JSON / CSV format"
          >
            {exporting ? <SpinnerIcon className="h-4 w-4 animate-spin text-slate-500" /> : <DownloadIcon className="h-4 w-4 text-slate-600" />}
            <span>{exporting ? 'Exporting...' : 'Export JSON / CSV'}</span>
          </button>

          <button
            type="button"
            onClick={() => handleSaveDraft('reviewed')}
            disabled={saving || !gstr3b}
            className="gst-pill-btn success"
            title="Lock return after reviewing all ITC decisions"
          >
            {saving ? <SpinnerIcon className="h-4 w-4 animate-spin" /> : <CheckIcon className="h-4 w-4" />}
            <span>{saving ? 'Locking...' : 'Mark Reviewed & Lock'}</span>
          </button>
        </div>
      </div>

      {saveSuccessMsg && (
        <div className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-semibold text-emerald-800 shadow-sm">
          <CheckCircleIcon className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      {/* Review & Warning Alert Banner */}
      {gstr3b && (gstr3b.unreviewedRecordsCount > 0 || gstr3b.unresolvedMismatchesCount > 0) && (
        <div className="gstr3b-alert-banner">
          <div className="gstr3b-alert-content">
            <span className="gstr3b-alert-icon">
              <AlertTriangleIcon className="h-5 w-5 text-amber-600" />
            </span>
            <div className="gstr3b-alert-text">
              <div className="gstr3b-alert-title">
                Draft Status Alert — Audit Review Pending
              </div>
              <div className="gstr3b-alert-desc">
                Unreviewed purchase vouchers or unresolved portal mismatches exist. Figures below represent a preliminary calculated draft. Complete decisions in the ITC Register before statutory filing.
              </div>
              <div className="gstr3b-alert-chips">
                <span className="gstr3b-alert-chip">
                  {gstr3b.unreviewedRecordsCount} Unreviewed Inward Items
                </span>
                <span className="gstr3b-alert-chip">
                  {gstr3b.unresolvedMismatchesCount} GSTR-2B Mismatches
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate && onNavigate('gst-itc-reconciliation')}
            className="gstr3b-alert-btn"
          >
            <span className="inline-flex items-center gap-1">Open ITC Register <ArrowRightIcon className="h-3.5 w-3.5" /></span>
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
          <SpinnerIcon className="h-8 w-8 text-indigo-600 animate-spin" />
          <div className="font-semibold text-slate-700">Computing GSTR-3B table summaries for {periodLabel}...</div>
          <div className="text-xs text-slate-400">Balancing Table 3.1 outward liabilities with Table 4 eligible input credit</div>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-sm font-semibold text-rose-700 shadow-sm">
          <AlertTriangleIcon className="h-5 w-5 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      ) : gstr3b ? (
        <div className="space-y-6">
          {/* Net Payable Summary Hero Card */}
          <div className="gstr3b-hero-card">
            <div className="gstr3b-hero-layout">
              <div className="gstr3b-hero-left">
                <div className="gstr3b-hero-badge">
                  <GstBuildingIcon className="h-3.5 w-3.5 text-indigo-200" />
                  <span>ESTIMATED NET TAX PAYABLE (AFTER ELIGIBLE ITC)</span>
                </div>
                <div className="gstr3b-hero-amount">
                  {fmtMoney(gstr3b.netTaxPayable.totalMinor)}
                </div>
                <div className="gstr3b-hero-meta">
                  <div className="gstr3b-meta-tag">
                    <span>GSTIN:</span>
                    <strong>{gstr3b.gstin}</strong>
                  </div>
                  <div className="gstr3b-meta-tag">
                    <span>Period:</span>
                    <strong>{gstr3b.returnPeriod}</strong>
                  </div>
                  <div className={`gstr3b-meta-tag ${gstr3b.status === 'reviewed' ? 'status-reviewed' : 'status-draft'}`}>
                    <span>● STATUS: {gstr3b.status}</span>
                  </div>
                </div>
              </div>

              {/* Tax split breakdown cards */}
              <div className="gstr3b-tax-split-grid">
                <div className="gstr3b-tax-split-item">
                  <span className="gstr3b-tax-split-label">IGST Payable</span>
                  <span className="gstr3b-tax-split-value">
                    {fmtMoney(gstr3b.netTaxPayable.igstMinor)}
                  </span>
                </div>
                <div className="gstr3b-tax-split-item">
                  <span className="gstr3b-tax-split-label">CGST Payable</span>
                  <span className="gstr3b-tax-split-value">
                    {fmtMoney(gstr3b.netTaxPayable.cgstMinor)}
                  </span>
                </div>
                <div className="gstr3b-tax-split-item">
                  <span className="gstr3b-tax-split-label">SGST Payable</span>
                  <span className="gstr3b-tax-split-value">
                    {fmtMoney(gstr3b.netTaxPayable.sgstMinor)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Table 3.1: Details of Outward Supplies and Inward Supplies Liable to Reverse Charge */}
          <div className="gstr3b-table-card">
            <div className="gstr3b-table-header">
              <div className="gstr3b-table-title-group">
                <span className="gstr3b-table-badge">Table 3.1</span>
                <div>
                  <h2 className="gstr3b-table-title">
                    Details of Outward Supplies and Inward Supplies Liable to Reverse Charge
                  </h2>
                  <p className="gstr3b-table-note">
                    Authoritative summary of outward taxable, zero-rated, exempt sales, and RCM inward liabilities.
                  </p>
                </div>
              </div>
            </div>

            <div className="gstr3b-table-wrapper">
              <table className="gstr3b-stat-table">
                <thead>
                  <tr>
                    <th style={{ width: '40%' }}>Nature of Supplies</th>
                    <th className="num">Total Taxable Value</th>
                    <th className="num">Integrated Tax (IGST)</th>
                    <th className="num">Central Tax (CGST)</th>
                    <th className="num">State/UT Tax (SGST)</th>
                    <th className="num">Cess</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ fontWeight: 700, color: '#0f172a' }}>
                      (a) Outward taxable supplies (other than zero rated, nil rated and exempted)
                    </td>
                    <td className="num">{renderAmount(gstr3b.table31Outward.taxableSupplies.taxableMinor)}</td>
                    <td className="num">{renderAmount(gstr3b.table31Outward.taxableSupplies.igstMinor)}</td>
                    <td className="num">{renderAmount(gstr3b.table31Outward.taxableSupplies.cgstMinor)}</td>
                    <td className="num">{renderAmount(gstr3b.table31Outward.taxableSupplies.sgstMinor)}</td>
                    <td className="num"><span className="zero-val">₹0.00</span></td>
                  </tr>
                  <tr>
                    <td style={{ color: '#475569' }}>
                      (b) Outward taxable supplies (zero rated)
                    </td>
                    <td className="num">{renderAmount(gstr3b.table31Outward.zeroRated.taxableMinor)}</td>
                    <td className="num">{renderAmount(gstr3b.table31Outward.zeroRated.igstMinor)}</td>
                    <td className="num"><span className="zero-val">₹0.00</span></td>
                    <td className="num"><span className="zero-val">₹0.00</span></td>
                    <td className="num"><span className="zero-val">₹0.00</span></td>
                  </tr>
                  <tr>
                    <td style={{ color: '#475569' }}>
                      (c) Other outward supplies (nil rated, exempted)
                    </td>
                    <td className="num">{renderAmount(gstr3b.table31Outward.nilRatedExempt.taxableMinor)}</td>
                    <td className="num"><span className="zero-val">₹0.00</span></td>
                    <td className="num"><span className="zero-val">₹0.00</span></td>
                    <td className="num"><span className="zero-val">₹0.00</span></td>
                    <td className="num"><span className="zero-val">₹0.00</span></td>
                  </tr>
                  <tr>
                    <td style={{ color: '#475569' }}>
                      (d) Inward supplies liable to reverse charge
                    </td>
                    <td className="num">{renderAmount(gstr3b.table31Outward.reverseChargeInward.taxableMinor)}</td>
                    <td className="num">{renderAmount(gstr3b.table31Outward.reverseChargeInward.igstMinor)}</td>
                    <td className="num">{renderAmount(gstr3b.table31Outward.reverseChargeInward.cgstMinor)}</td>
                    <td className="num">{renderAmount(gstr3b.table31Outward.reverseChargeInward.sgstMinor)}</td>
                    <td className="num"><span className="zero-val">₹0.00</span></td>
                  </tr>
                  <tr>
                    <td style={{ color: '#475569' }}>
                      (e) Non-GST outward supplies
                    </td>
                    <td className="num">{renderAmount(gstr3b.table31Outward.nonGst.taxableMinor)}</td>
                    <td className="num"><span className="zero-val">₹0.00</span></td>
                    <td className="num"><span className="zero-val">₹0.00</span></td>
                    <td className="num"><span className="zero-val">₹0.00</span></td>
                    <td className="num"><span className="zero-val">₹0.00</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Table 4: Eligible Input Tax Credit (ITC) */}
          <div className="gstr3b-table-card">
            <div className="gstr3b-table-header">
              <div className="gstr3b-table-title-group">
                <span className="gstr3b-table-badge" style={{ background: '#059669' }}>Table 4</span>
                <div>
                  <h2 className="gstr3b-table-title">
                    Eligible Input Tax Credit (ITC)
                  </h2>
                  <p className="gstr3b-table-note">
                    Breakdown of available credits from verified inward supply invoices and statutory reversals.
                  </p>
                </div>
              </div>
            </div>

            <div className="gstr3b-table-wrapper">
              <table className="gstr3b-stat-table">
                <thead>
                  <tr>
                    <th style={{ width: '40%' }}>Details</th>
                    <th className="num">Integrated Tax (IGST)</th>
                    <th className="num">Central Tax (CGST)</th>
                    <th className="num">State/UT Tax (SGST)</th>
                    <th className="num">Cess</th>
                  </tr>
                </thead>
                <tbody>
                  {/* (A) ITC Available */}
                  <tr className="section-header">
                    <td colSpan={5}>
                      (A) ITC Available (whether in full or part)
                    </td>
                  </tr>
                  <tr>
                    <td style={{ paddingLeft: '2rem', fontWeight: 600, color: '#0f172a' }}>
                      (5) All other ITC (Purchases &amp; Expenses Reviewed as Eligible)
                    </td>
                    <td className="num">{renderAmount(gstr3b.table4EligibleItc.allOtherItc.igstMinor, { isEligible: true })}</td>
                    <td className="num">{renderAmount(gstr3b.table4EligibleItc.allOtherItc.cgstMinor, { isEligible: true })}</td>
                    <td className="num">{renderAmount(gstr3b.table4EligibleItc.allOtherItc.sgstMinor, { isEligible: true })}</td>
                    <td className="num"><span className="zero-val">₹0.00</span></td>
                  </tr>

                  {/* (B) ITC Reversed */}
                  <tr className="section-header danger">
                    <td colSpan={5}>
                      (B) ITC Reversed
                    </td>
                  </tr>
                  <tr>
                    <td style={{ paddingLeft: '2rem', color: '#475569' }}>
                      (2) Others (Rule 42, 43 or non-business apportionment)
                    </td>
                    <td className="num">{renderAmount(gstr3b.table4EligibleItc.reversalRule42_43.igstMinor, { isReversal: true })}</td>
                    <td className="num">{renderAmount(gstr3b.table4EligibleItc.reversalRule42_43.cgstMinor, { isReversal: true })}</td>
                    <td className="num">{renderAmount(gstr3b.table4EligibleItc.reversalRule42_43.sgstMinor, { isReversal: true })}</td>
                    <td className="num"><span className="zero-val">₹0.00</span></td>
                  </tr>

                  {/* (C) Net ITC Available */}
                  <tr className="highlight-summary">
                    <td style={{ fontWeight: 800 }}>
                      (C) Net ITC Available (A) − (B)
                    </td>
                    <td className="num">{renderAmount(gstr3b.table4EligibleItc.netItcAvailable.igstMinor, { isEligible: true })}</td>
                    <td className="num">{renderAmount(gstr3b.table4EligibleItc.netItcAvailable.cgstMinor, { isEligible: true })}</td>
                    <td className="num">{renderAmount(gstr3b.table4EligibleItc.netItcAvailable.sgstMinor, { isEligible: true })}</td>
                    <td className="num"><span className="zero-val">₹0.00</span></td>
                  </tr>

                  {/* (D) Ineligible ITC */}
                  <tr className="section-header slate">
                    <td colSpan={5}>
                      (D) Ineligible ITC
                    </td>
                  </tr>
                  <tr>
                    <td style={{ paddingLeft: '2rem', color: '#64748b' }}>
                      (1) As per section 17(5) (Blocked credits)
                    </td>
                    <td className="num">{renderAmount(gstr3b.table4EligibleItc.ineligibleSection17_5.igstMinor)}</td>
                    <td className="num">{renderAmount(gstr3b.table4EligibleItc.ineligibleSection17_5.cgstMinor)}</td>
                    <td className="num">{renderAmount(gstr3b.table4EligibleItc.ineligibleSection17_5.sgstMinor)}</td>
                    <td className="num"><span className="zero-val">₹0.00</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Table 5: Payment of Tax */}
          <div className="gstr3b-table-card">
            <div className="gstr3b-table-header">
              <div className="gstr3b-table-title-group">
                <span className="gstr3b-table-badge" style={{ background: '#312e81' }}>Table 5</span>
                <div>
                  <h2 className="gstr3b-table-title">
                    5. Payment of Tax (Net Tax Payable)
                  </h2>
                  <p className="gstr3b-table-note">
                    Tax liabilities settled through eligible input tax credits versus net balance payable in cash through electronic cash ledger.
                  </p>
                </div>
              </div>
            </div>

            <div className="gstr3b-table-wrapper">
              <table className="gstr3b-stat-table">
                <thead>
                  <tr>
                    <th style={{ width: '40%' }}>Description</th>
                    <th className="num">Tax Payable (Output)</th>
                    <th className="num">Paid Through ITC</th>
                    <th className="num" style={{ background: '#f5f3ff', color: '#4338ca' }}>
                      Tax Paid in Cash (Net)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ fontWeight: 700, color: '#0f172a' }}>Integrated Tax (IGST)</td>
                    <td className="num">{renderAmount(gstr3b.table31Outward.taxableSupplies.igstMinor)}</td>
                    <td className="num">{renderAmount(gstr3b.table4EligibleItc.netItcAvailable.igstMinor, { isEligible: true })}</td>
                    <td className="num cash-paid-cell">
                      {fmtMoney(gstr3b.netTaxPayable.igstMinor)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: 700, color: '#0f172a' }}>Central Tax (CGST)</td>
                    <td className="num">{renderAmount(gstr3b.table31Outward.taxableSupplies.cgstMinor)}</td>
                    <td className="num">{renderAmount(gstr3b.table4EligibleItc.netItcAvailable.cgstMinor, { isEligible: true })}</td>
                    <td className="num cash-paid-cell">
                      {fmtMoney(gstr3b.netTaxPayable.cgstMinor)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ fontWeight: 700, color: '#0f172a' }}>State/UT Tax (SGST)</td>
                    <td className="num">{renderAmount(gstr3b.table31Outward.taxableSupplies.sgstMinor)}</td>
                    <td className="num">{renderAmount(gstr3b.table4EligibleItc.netItcAvailable.sgstMinor, { isEligible: true })}</td>
                    <td className="num cash-paid-cell">
                      {fmtMoney(gstr3b.netTaxPayable.sgstMinor)}
                    </td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr style={{ background: '#f8fafc', fontWeight: 800, borderTop: '2px solid #cbd5e1' }}>
                    <td style={{ fontWeight: 800, color: '#0f172a' }}>Total Cash Payable</td>
                    <td className="num" style={{ fontWeight: 800 }}>
                      {fmtMoney(
                        gstr3b.table31Outward.taxableSupplies.igstMinor +
                          gstr3b.table31Outward.taxableSupplies.cgstMinor +
                          gstr3b.table31Outward.taxableSupplies.sgstMinor
                      )}
                    </td>
                    <td className="num" style={{ fontWeight: 800, color: '#059669' }}>
                      {fmtMoney(
                        gstr3b.table4EligibleItc.netItcAvailable.igstMinor +
                          gstr3b.table4EligibleItc.netItcAvailable.cgstMinor +
                          gstr3b.table4EligibleItc.netItcAvailable.sgstMinor
                      )}
                    </td>
                    <td className="num cash-paid-cell" style={{ fontSize: '1rem', color: '#312e81' }}>
                      {fmtMoney(gstr3b.netTaxPayable.totalMinor)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
