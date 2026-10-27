import React, { useState, useEffect } from 'react';
import { fetchGstOverview, type GstOverviewMetrics } from '../../api.ts';
import { fmtMoney } from '../../../../shared/money.ts';

interface GstOverviewViewProps {
  tenantGstin?: string;
  onNavigateTab: (tab: string) => void;
}

export function GstOverviewView({ tenantGstin = '', onNavigateTab }: GstOverviewViewProps) {
  const [period, setPeriod] = useState<string>(() => new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [metrics, setMetrics] = useState<GstOverviewMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const loadOverview = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchGstOverview(period, tenantGstin);
      setMetrics(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to load GST overview');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, [period, tenantGstin]);

  return (
    <div className="gst-view-wrapper">
      {/* Top Filter and Actions Bar */}
      <div className="gst-header-card">
        <div className="gst-header-left">
          <h2 className="gst-header-title">
            <span>🏛️</span> GST Compliance &amp; Return Summary
          </h2>
          <p className="gst-header-subtitle">
            Authoritative figures derived from authorized invoices, stock purchases, and reviewed eligible ITC for {periodLabel}.
          </p>
        </div>

        <div className="gst-header-actions">
          {/* Month Stepper Picker */}
          <div className="gst-period-picker-group">
            <span className="gst-period-label">Period</span>
            <button
              type="button"
              className="gst-period-nav-btn"
              onClick={() => changeMonth(-1)}
              title="Previous Month"
            >
              ◀
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
              ▶
            </button>
          </div>

          <button
            type="button"
            onClick={setThisMonth}
            className="gst-pill-btn"
            title="Jump to current return month"
          >
            📅 Current
          </button>

          <button
            type="button"
            onClick={loadOverview}
            disabled={loading}
            className="gst-pill-btn"
            title="Refresh live figures"
          >
            <span>🔄</span> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs font-semibold text-rose-700">
          ⚠️ {error}
        </div>
      )}

      {loading ? (
        <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
          <div className="text-2xl animate-spin">⏳</div>
          <div className="font-semibold text-slate-700">Aggregating live GST metrics for {periodLabel}...</div>
          <div className="text-xs text-slate-400">Computing outward invoices, purchase registers &amp; verified ITC ledger</div>
        </div>
      ) : metrics ? (
        <>
          {/* Main Net Position Hero Card */}
          <div className="gst-hero-liability">
            <div className="gst-hero-layout">
              <div className="gst-hero-left">
                <div className="gst-hero-badge">
                  <span className="gst-hero-badge-dot"></span>
                  <span>ESTIMATED NET GST PAYABLE (PERIOD {metrics.returnPeriod})</span>
                </div>
                <div className="gst-hero-amount">
                  {fmtMoney(metrics.estimatedNetGstLiabilityMinor)}
                </div>
                <div className="gst-hero-formula-bar">
                  <span className="text-slate-300 text-xs font-semibold">Formula:</span>
                  <div className="gst-formula-chip">
                    <span>Output GST:</span>
                    <strong>{fmtMoney(metrics.outputGstMinor)}</strong>
                  </div>
                  <span className="gst-formula-op">−</span>
                  <div className="gst-formula-chip">
                    <span>Reviewed Eligible ITC:</span>
                    <strong>{fmtMoney(metrics.reviewedEligibleItcMinor)}</strong>
                  </div>
                  <span className="gst-formula-op">=</span>
                  <div className="gst-formula-chip" style={{ background: 'rgba(167, 139, 250, 0.25)', borderColor: 'rgba(167, 139, 250, 0.4)' }}>
                    <span>Net Cash:</span>
                    <strong>{fmtMoney(metrics.estimatedNetGstLiabilityMinor)}</strong>
                  </div>
                </div>
              </div>

              <div className="gst-hero-actions">
                <button
                  type="button"
                  onClick={() => onNavigateTab('gst-itc-reconciliation')}
                  className="gst-hero-btn-primary"
                >
                  <span>⚖️</span> Reconcile ITC Register
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateTab('gst-gstr3b')}
                  className="gst-hero-btn-secondary"
                >
                  <span>📄</span> Prepare GSTR-3B
                </button>
              </div>
            </div>
          </div>

          {/* 10 Required Summary Cards Grid */}
          <div className="gst-kpi-grid">
            {/* 1. Outward Taxable */}
            <div className="gst-kpi-card">
              <div className="gst-kpi-card-top">
                <div className="gst-kpi-label-group">
                  <span className="gst-kpi-num-badge">01</span>
                  <span className="gst-kpi-title">Outward Taxable</span>
                </div>
                <span className="gst-kpi-icon-pill">📊</span>
              </div>
              <div className="gst-kpi-val">
                {fmtMoney(metrics.salesTaxableMinor)}
              </div>
              <div className="gst-kpi-sub">Total net billable sales</div>
            </div>

            {/* 2. Output GST */}
            <div className="gst-kpi-card output-gst">
              <div className="gst-kpi-card-top">
                <div className="gst-kpi-label-group">
                  <span className="gst-kpi-num-badge">02</span>
                  <span className="gst-kpi-title">Output GST</span>
                </div>
                <span className="gst-kpi-icon-pill">🏛️</span>
              </div>
              <div className="gst-kpi-val">
                {fmtMoney(metrics.outputGstMinor)}
              </div>
              <div className="gst-kpi-sub">Tax collected on sales</div>
            </div>

            {/* 3. Purchase GST */}
            <div className="gst-kpi-card">
              <div className="gst-kpi-card-top">
                <div className="gst-kpi-label-group">
                  <span className="gst-kpi-num-badge">03</span>
                  <span className="gst-kpi-title">Purchase GST</span>
                </div>
                <span className="gst-kpi-icon-pill">📦</span>
              </div>
              <div className="gst-kpi-val">
                {fmtMoney(metrics.purchaseGstMinor)}
              </div>
              <div className="gst-kpi-sub">Tax on stock purchases</div>
            </div>

            {/* 4. Expense GST */}
            <div className="gst-kpi-card expense-gst">
              <div className="gst-kpi-card-top">
                <div className="gst-kpi-label-group">
                  <span className="gst-kpi-num-badge">04</span>
                  <span className="gst-kpi-title">Expense GST</span>
                </div>
                <span className="gst-kpi-icon-pill">💼</span>
              </div>
              <div className="gst-kpi-val">
                {fmtMoney(metrics.expenseGstUnderReviewMinor)}
              </div>
              <div className="gst-kpi-sub">Operating overheads</div>
            </div>

            {/* 5. Potential ITC */}
            <div className="gst-kpi-card">
              <div className="gst-kpi-card-top">
                <div className="gst-kpi-label-group">
                  <span className="gst-kpi-num-badge">05</span>
                  <span className="gst-kpi-title">Potential ITC</span>
                </div>
                <span className="gst-kpi-icon-pill">📥</span>
              </div>
              <div className="gst-kpi-val">
                {fmtMoney(metrics.potentialItcMinor)}
              </div>
              <div className="gst-kpi-sub">Purchases + Expense GST</div>
            </div>

            {/* 6. Reviewed Eligible ITC */}
            <div className="gst-kpi-card eligible-itc">
              <div className="gst-kpi-card-top">
                <div className="gst-kpi-label-group">
                  <span className="gst-kpi-num-badge">06</span>
                  <span className="gst-kpi-title">Reviewed Eligible ITC</span>
                </div>
                <span className="gst-kpi-icon-pill" style={{ background: '#d1fae5', color: '#047857' }}>✅</span>
              </div>
              <div className="gst-kpi-val">
                {fmtMoney(metrics.reviewedEligibleItcMinor)}
              </div>
              <div className="gst-kpi-sub">Approved for GSTR-3B</div>
            </div>

            {/* 7. Ineligible / Blocked */}
            <div className="gst-kpi-card ineligible-itc">
              <div className="gst-kpi-card-top">
                <div className="gst-kpi-label-group">
                  <span className="gst-kpi-num-badge">07</span>
                  <span className="gst-kpi-title">Ineligible / Blocked</span>
                </div>
                <span className="gst-kpi-icon-pill" style={{ background: '#ffe4e6', color: '#e11d48' }}>🚫</span>
              </div>
              <div className="gst-kpi-val">
                {fmtMoney(metrics.ineligibleItcMinor)}
              </div>
              <div className="gst-kpi-sub">Sec 17(5) / Exempt</div>
            </div>

            {/* 8. GSTR-2B Differences */}
            <div className="gst-kpi-card diff-alert">
              <div className="gst-kpi-card-top">
                <div className="gst-kpi-label-group">
                  <span className="gst-kpi-num-badge">08</span>
                  <span className="gst-kpi-title">GSTR-2B Differences</span>
                </div>
                <span className="gst-kpi-icon-pill" style={{ background: '#fef3c7', color: '#b45309' }}>⚠️</span>
              </div>
              <div className="gst-kpi-val">
                {metrics.unresolvedMismatchesCount}
              </div>
              <div className="gst-kpi-sub">
                {metrics.unresolvedMismatchesCount > 0 ? 'Mismatches to resolve' : 'Clean / fully matched'}
              </div>
            </div>

            {/* 9. GSTR-1 Status */}
            <div className="gst-kpi-card">
              <div className="gst-kpi-card-top">
                <div className="gst-kpi-label-group">
                  <span className="gst-kpi-num-badge">09</span>
                  <span className="gst-kpi-title">GSTR-1 Outward</span>
                </div>
                <span className="gst-kpi-icon-pill">📑</span>
              </div>
              <div>
                <span className={`gst-status-badge ${metrics.gstr1Status === 'ready' ? 'ready' : 'in-progress'}`}>
                  <span className="gst-status-dot"></span>
                  <span>{metrics.gstr1Status === 'ready' ? 'Ready to Export' : 'In Progress'}</span>
                </span>
              </div>
              <div className="gst-kpi-sub">Sales Register synced</div>
            </div>

            {/* 10. GSTR-3B Status */}
            <div className="gst-kpi-card">
              <div className="gst-kpi-card-top">
                <div className="gst-kpi-label-group">
                  <span className="gst-kpi-num-badge">10</span>
                  <span className="gst-kpi-title">GSTR-3B Summary</span>
                </div>
                <span className="gst-kpi-icon-pill">📄</span>
              </div>
              <div>
                <span className={`gst-status-badge ${metrics.gstr3bStatus === 'ready_to_file' ? 'ready' : 'in-progress'}`}>
                  <span className="gst-status-dot"></span>
                  <span className="capitalize">
                    {metrics.gstr3bStatus === 'draft'
                      ? 'Draft Computation'
                      : metrics.gstr3bStatus === 'ready_to_file'
                      ? 'Ready to File'
                      : 'Pending Review'}
                  </span>
                </span>
              </div>
              <div className="gst-kpi-sub">Subject to ITC review</div>
            </div>
          </div>

          {/* Quick Action Navigation Grid: Recommended GST Journey */}
          <div className="gst-journey-card">
            <div className="gst-journey-header">
              <h3 className="gst-journey-title">
                <span>🧭</span> Recommended GST Compliance Journey
              </h3>
              <p className="gst-journey-subtitle">
                Complete all 3 sequential steps each tax period to guarantee audit defense and prevent interest liabilities.
              </p>
            </div>

            <div className="gst-journey-grid">
              {/* Step 1 */}
              <div className="gst-journey-step">
                <div className="gst-journey-step-top">
                  <span className="gst-journey-step-tag">Step 01 • Outward Sales</span>
                  <h4 className="gst-journey-step-title">Verify Outward Sales Register</h4>
                  <p className="gst-journey-step-desc">
                    Audit outward tax collected on POS retail counter bills, B2B wholesale invoices, and credit notes.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateTab('gst-sales-register')}
                  className="gst-journey-action-btn"
                >
                  <span>View Sales Register</span>
                  <span>➔</span>
                </button>
              </div>

              {/* Step 2 */}
              <div className="gst-journey-step">
                <div className="gst-journey-step-top">
                  <span className="gst-journey-step-tag">Step 02 • Inward &amp; 2B</span>
                  <h4 className="gst-journey-step-title">Match Inward &amp; Reconcile ITC</h4>
                  <p className="gst-journey-step-desc">
                    Cross-examine purchase distributor bills and expense vouchers against portal GSTR-2B before filing.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateTab('gst-itc-reconciliation')}
                  className="gst-journey-action-btn"
                >
                  <span>Reconcile ITC Register</span>
                  <span>➔</span>
                </button>
              </div>

              {/* Step 3 */}
              <div className="gst-journey-step">
                <div className="gst-journey-step-top">
                  <span className="gst-journey-step-tag">Step 03 • Statutory Return</span>
                  <h4 className="gst-journey-step-title">Compute &amp; File GSTR-3B</h4>
                  <p className="gst-journey-step-desc">
                    Review Table 3.1 outward liabilities, claim authorized Table 4 ITC, compute net cash liability, and lock.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigateTab('gst-gstr3b')}
                  className="gst-journey-action-btn"
                >
                  <span>Open GSTR-3B Worksheet</span>
                  <span>➔</span>
                </button>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
