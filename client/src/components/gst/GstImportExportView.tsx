import React, { useState, useEffect } from 'react';
import { Gstr2bImportModal } from './Gstr2bImportModal.tsx';
import { downloadFile, fetchGstOverview, type GstOverviewMetrics } from '../../api.ts';
import { fmtMoney } from '../../../../shared/money.ts';

interface GstImportExportViewProps {
  onNavigate?: (tab: string, meta?: any) => void;
}

export const GstImportExportView: React.FC<GstImportExportViewProps> = ({ onNavigate }) => {
  const [period, setPeriod] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [isImportModalOpen, setIsImportModalOpen] = useState<boolean>(false);
  const [downloadingIdx, setDownloadingIdx] = useState<number | null>(null);
  const [downloadingBundle, setDownloadingBundle] = useState<boolean>(false);
  const [metrics, setMetrics] = useState<GstOverviewMetrics | null>(null);
  const [loadingMetrics, setLoadingMetrics] = useState<boolean>(true);

  // Calculate start and end date for the selected period
  const [yearStr, monthStr] = period.split('-');
  const yearNum = parseInt(yearStr, 10);
  const monthNum = parseInt(monthStr, 10);
  const lastDay = yearNum && monthNum ? new Date(yearNum, monthNum, 0).getDate() : 31;
  const toDate = `${period}-${String(lastDay).padStart(2, '0')}`;

  // Period label e.g., "October 2026"
  const periodLabel = (() => {
    if (!yearNum || !monthNum) return period;
    const d = new Date(yearNum, monthNum - 1, 1);
    return d.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  })();

  const changeMonth = (delta: number) => {
    if (!yearNum || !monthNum) return;
    const d = new Date(yearNum, monthNum - 1 + delta, 1);
    setPeriod(d.toISOString().slice(0, 7));
  };

  const setThisMonth = () => setPeriod(new Date().toISOString().slice(0, 7));

  useEffect(() => {
    let cancelled = false;
    const loadOverview = async () => {
      try {
        setLoadingMetrics(true);
        const data = await fetchGstOverview(period);
        if (!cancelled) setMetrics(data);
      } catch (e) {
        console.error('Failed to load GST overview for period', e);
      } finally {
        if (!cancelled) setLoadingMetrics(false);
      }
    };
    loadOverview();
    return () => {
      cancelled = true;
    };
  }, [period]);

  const statutoryRegisters = [
    {
      id: 'sales',
      title: 'GST Sales Register',
      badge: 'GSTR-1 Outward',
      badgeTheme: 'emerald',
      description: 'Categorized B2B invoices and B2C sales with customer GSTINs, HSN, and tax breakdown.',
      format: 'CSV / Excel',
      statLabel: 'Outward Taxable',
      statValue: fmtMoney(metrics?.salesTaxableMinor || 0),
      statSub: `Output GST: ${fmtMoney(metrics?.outputGstMinor || 0)}`,
      link: `/api/gst/sales-register/export?period=${encodeURIComponent(period)}`,
      icon: '📊',
      filingDeadline: 'File by 11th',
    },
    {
      id: 'purchase',
      title: 'GST Purchase & Inward Register',
      badge: 'Inward Supplies',
      badgeTheme: 'indigo',
      description: 'Vendor inward stock supplies, distributor bills, purchase GST, and inward delivery items.',
      format: 'CSV / Excel',
      statLabel: 'Purchase Taxable',
      statValue: fmtMoney(metrics?.purchaseTaxableMinor || 0),
      statSub: `Purchase GST: ${fmtMoney(metrics?.purchaseGstMinor || 0)}`,
      link: `/api/gst/purchase-register/export?period=${encodeURIComponent(period)}`,
      icon: '📦',
      filingDeadline: 'Reconcile on 14th',
    },
    {
      id: 'expense',
      title: 'Business Expense Register',
      badge: 'Section 16 / 17 ITC',
      badgeTheme: 'blue',
      description: 'Audit log of operational overheads, rent, utilities, services, vendor GSTINs, and ITC eligibility.',
      format: 'CSV / Excel',
      statLabel: 'Expense Taxable',
      statValue: fmtMoney(metrics?.expenseTaxableMinor || 0),
      statSub: 'ITC Claimable',
      link: `/api/expenses/export?from=${period}-01&to=${toDate}`,
      icon: '💼',
      filingDeadline: 'Monthly Audit',
    },
    {
      id: 'itc_recon',
      title: 'ITC Reconciliation Report',
      badge: 'GSTR-2B Audit',
      badgeTheme: 'purple',
      description: 'Book transactions matched against GSTR-2B with mismatch differences and reviewed decisions.',
      format: 'CSV / Excel',
      statLabel: 'Reviewed Eligible ITC',
      statValue: fmtMoney(metrics?.reviewedEligibleItcMinor || 0),
      statSub: metrics?.unresolvedMismatchesCount ? `⚠️ ${metrics.unresolvedMismatchesCount} to reconcile` : '✓ All Matched',
      link: `/api/gst/itc-register/export?period=${encodeURIComponent(period)}`,
      icon: '⚖️',
      filingDeadline: 'Audit before 20th',
    },
    {
      id: 'gstr3b',
      title: 'GSTR-3B Computation Worksheet',
      badge: 'Monthly Return',
      badgeTheme: 'amber',
      description: 'Table 3.1 outward liabilities, Table 4 reviewed eligible ITC, and net cash tax payable.',
      format: 'CSV / Excel',
      statLabel: 'Est. Net Tax Liability',
      statValue: fmtMoney(metrics?.estimatedNetGstLiabilityMinor || 0),
      statSub: 'Final Tax Payable',
      link: `/api/gst/gstr3b/export?period=${encodeURIComponent(period)}`,
      icon: '📑',
      filingDeadline: 'File & Pay by 20th',
    },
  ];

  const handleDownloadSingle = async (reg: typeof statutoryRegisters[0], idx: number) => {
    try {
      setDownloadingIdx(idx);
      const safeFilename = `${reg.title.replace(/[^a-zA-Z0-9_-]/g, '_')}_${period}.csv`;
      await downloadFile(reg.link, safeFilename);
    } catch (err: any) {
      alert(`Export failed: ${err.message}`);
    } finally {
      setDownloadingIdx(null);
    }
  };

  const handleDownloadAllBundle = async () => {
    try {
      setDownloadingBundle(true);
      for (const item of statutoryRegisters) {
        const safeFilename = `${item.title.replace(/[^a-zA-Z0-9_-]/g, '_')}_${period}.csv`;
        await downloadFile(item.link, safeFilename);
        await new Promise((r) => setTimeout(r, 400));
      }
    } catch (err: any) {
      alert(`CA Pack export failed: ${err.message}`);
    } finally {
      setDownloadingBundle(false);
    }
  };

  return (
    <div className="gst-view-wrapper">
      {/* Top Filter & Statutory Filing Timeline Control Bar */}
      <div className="gst-header-card">
        <div className="gst-header-left">
          <h2 className="gst-header-title">
            <span>📥</span> GST Import &amp; Export Hub
          </h2>
          <p className="gst-header-subtitle">
            Upload GSTR-2B JSON/CSV statements and download statutory GST worksheets and audit reports for {periodLabel}.
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
        </div>
      </div>

      {/* Statutory Filing Deadlines Pill Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-xs">
        <div className="text-xs font-bold text-slate-700">
          Statutory Deadlines for {periodLabel} (01 {periodLabel.split(' ')[0]} – {lastDay} {periodLabel}):
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-800">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <strong>GSTR-1 Outward:</strong> 11th Due
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-indigo-800">
            <span className="h-2 w-2 rounded-full bg-indigo-500" />
            <strong>GSTR-2B Draft:</strong> Available 14th
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-amber-800">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <strong>GSTR-3B Return &amp; Tax:</strong> 20th Due
          </span>
        </div>
      </div>

      {/* GSTR-2B Statement Import Center Banner */}
      <div className="gst-import-hero">
        <div className="gst-import-hero-layout">
          <div className="gst-import-hero-left">
            <div className="gst-import-icon-badge">
              📥
            </div>
            <div>
              <div className="gst-import-hero-title-row">
                <h3 className="gst-import-hero-title">
                  Import GSTR-2B Auto-Drafted ITC Statement
                </h3>
                <span className="gst-import-pill">
                  Government Portal Sync
                </span>
              </div>
              <p className="gst-import-hero-desc">
                Upload your official monthly <strong>GSTR-2B JSON or CSV</strong> downloaded from the GST Common Portal (released on the 14th). The platform automatically cross-examines invoice numbers, taxable values, and tax amounts against your inward purchases and expense vouchers.
              </p>

              {/* 3 Step Workflow */}
              <div className="gst-import-steps-row">
                <span className="gst-import-step-chip">
                  <span>1️⃣</span> Download 2B from GST Portal
                </span>
                <span className="gst-import-step-arrow">→</span>
                <span className="gst-import-step-chip">
                  <span>2️⃣</span> Upload JSON/CSV Here
                </span>
                <span className="gst-import-step-arrow">→</span>
                <span className="gst-import-step-chip">
                  <span>3️⃣</span> Auto-Match &amp; Claim ITC
                </span>
              </div>
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setIsImportModalOpen(true)}
              className="gst-import-hero-btn"
            >
              <span>⚡</span> Launch 2B Import Wizard
            </button>
          </div>
        </div>
      </div>

      {/* Period Quick Overview Stats Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '1rem',
        }}
      >
        <div className="gst-kpi-card">
          <div className="gst-kpi-card-top">
            <div className="gst-kpi-label-group">
              <span className="gst-kpi-num-badge">01</span>
              <span className="gst-kpi-title">Outward Sales Taxable</span>
            </div>
            <span className="gst-kpi-icon-pill">📊</span>
          </div>
          <div className="gst-kpi-val">
            {loadingMetrics ? '...' : fmtMoney(metrics?.salesTaxableMinor || 0)}
          </div>
          <div className="gst-kpi-sub" style={{ color: '#059669', fontWeight: 600 }}>
            Output GST: {loadingMetrics ? '...' : fmtMoney(metrics?.outputGstMinor || 0)}
          </div>
        </div>

        <div className="gst-kpi-card">
          <div className="gst-kpi-card-top">
            <div className="gst-kpi-label-group">
              <span className="gst-kpi-num-badge">02</span>
              <span className="gst-kpi-title">Inward Purchases Taxable</span>
            </div>
            <span className="gst-kpi-icon-pill">📦</span>
          </div>
          <div className="gst-kpi-val">
            {loadingMetrics ? '...' : fmtMoney(metrics?.purchaseTaxableMinor || 0)}
          </div>
          <div className="gst-kpi-sub" style={{ color: '#4338ca', fontWeight: 600 }}>
            Purchase GST: {loadingMetrics ? '...' : fmtMoney(metrics?.purchaseGstMinor || 0)}
          </div>
        </div>

        <div className="gst-kpi-card">
          <div className="gst-kpi-card-top">
            <div className="gst-kpi-label-group">
              <span className="gst-kpi-num-badge">03</span>
              <span className="gst-kpi-title">Claimable Expenses Taxable</span>
            </div>
            <span className="gst-kpi-icon-pill">💼</span>
          </div>
          <div className="gst-kpi-val">
            {loadingMetrics ? '...' : fmtMoney(metrics?.expenseTaxableMinor || 0)}
          </div>
          <div className="gst-kpi-sub" style={{ color: '#d97706', fontWeight: 600 }}>
            Expense GST: {loadingMetrics ? '...' : fmtMoney(metrics?.expenseGstUnderReviewMinor || 0)}
          </div>
        </div>

        <div className="gst-kpi-card eligible-itc">
          <div className="gst-kpi-card-top">
            <div className="gst-kpi-label-group">
              <span className="gst-kpi-num-badge">04</span>
              <span className="gst-kpi-title">Reviewed Eligible ITC</span>
            </div>
            <span className="gst-kpi-icon-pill" style={{ background: '#d1fae5', color: '#047857' }}>✅</span>
          </div>
          <div className="gst-kpi-val">
            {loadingMetrics ? '...' : fmtMoney(metrics?.reviewedEligibleItcMinor || 0)}
          </div>
          <div className="gst-kpi-sub">
            {metrics?.unresolvedMismatchesCount ? (
              <span style={{ color: '#b45309', fontWeight: 700 }}>⚠️ {metrics.unresolvedMismatchesCount} to reconcile</span>
            ) : (
              <span style={{ color: '#059669', fontWeight: 700 }}>✓ Fully Reconciled for GSTR-3B</span>
            )}
          </div>
        </div>
      </div>

      {/* Featured 1-Click All-In-One CA Audit Package Banner */}
      <div className="gst-ca-bundle-banner">
        <div className="gst-ca-bundle-left">
          <div className="gst-ca-bundle-icon">
            🗂️
          </div>
          <div className="gst-ca-bundle-info">
            <div className="gst-ca-bundle-title-row">
              <h3 className="gst-ca-bundle-title">
                Complete CA Audit Package ({periodLabel})
              </h3>
              <span className="gst-ca-bundle-tag">1-Click All 5 Registers</span>
            </div>
            <p className="gst-ca-bundle-desc">
              One-click download of all 5 verified statutory registers (Sales, Purchases, Expenses, 2B Reconciliation, and GSTR-3B Computation) formatted specifically for your Chartered Accountant or tax auditor.
            </p>
          </div>
        </div>

        <div>
          <button
            type="button"
            onClick={handleDownloadAllBundle}
            disabled={downloadingBundle}
            className="gst-ca-bundle-btn"
          >
            <span>{downloadingBundle ? '⏳' : '📥'}</span>
            <span>{downloadingBundle ? 'Generating 5 Files...' : 'Download Full CA Audit Pack (5 CSVs)'}</span>
          </button>
        </div>
      </div>

      {/* 5 Symmetrical Financial Registers Grid */}
      <div>
        <div className="mb-3">
          <h3 className="text-base font-bold text-slate-900">
            Individual Statutory Return Registers ({periodLabel})
          </h3>
          <p className="text-xs text-slate-500">
            Download individual CSV / Excel registers for specific filing schedules and cross-verification.
          </p>
        </div>

        <div className="gst-registers-grid">
          {statutoryRegisters.map((reg, idx) => (
            <div key={reg.id} className="gst-register-card">
              <div>
                <div className="gst-register-top">
                  <div className="gst-register-badge-group">
                    <span className="gst-register-icon">{reg.icon}</span>
                    <span className={`gst-register-badge ${reg.badgeTheme}`}>
                      {reg.badge}
                    </span>
                  </div>
                  <span className="gst-register-format">{reg.format}</span>
                </div>

                <h4 className="gst-register-title">{reg.title}</h4>
                <p className="gst-register-desc">{reg.description}</p>

                {/* Metric pill */}
                <div className="gst-register-stats-pill">
                  <div className="gst-register-stat-row">
                    <span className="gst-register-stat-label">{reg.statLabel}:</span>
                    <span className="gst-register-stat-val">{reg.statValue}</span>
                  </div>
                  <div className="gst-register-stat-sub">
                    <span style={{ fontWeight: 700, color: '#475569' }}>⏰ {reg.filingDeadline}</span>
                    <span style={{ fontWeight: 600, color: '#0f172a' }}>{reg.statSub}</span>
                  </div>
                </div>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => handleDownloadSingle(reg, idx)}
                  disabled={downloadingIdx !== null}
                  className="gst-register-download-btn"
                >
                  <span>{downloadingIdx === idx ? '⏳' : '⬇️'}</span>
                  <span>{downloadingIdx === idx ? 'Exporting...' : `Download ${reg.format}`}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Statutory Filing Calendar & Auditor Handoff Instructions */}
      <div className="gst-journey-card">
        <div className="gst-journey-header">
          <h3 className="gst-journey-title">
            <span>📚</span> Statutory Filing Calendar &amp; CA Handoff Workflow
          </h3>
          <p className="gst-journey-subtitle">
            Follow this standard monthly schedule to file on time, avoid late fees (Section 47), and ensure 100% of your vendor input tax credit is safe under Section 16(2)(aa):
          </p>
        </div>

        <div className="gst-journey-grid">
          <div className="gst-journey-step">
            <div className="gst-journey-step-top">
              <span className="gst-journey-step-tag">Phase 1 • Before 11th</span>
              <h4 className="gst-journey-step-title">GSTR-1 Outward Return</h4>
              <p className="gst-journey-step-desc">
                Download the <strong>GST Sales Register</strong>. Your CA needs this to report B2B invoices and B2C sales on the GST Portal so your wholesale customers can claim their tax credit.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate && onNavigate('gst-sales-register')}
              className="gst-journey-action-btn"
            >
              <span>View Sales Register</span>
              <span>➔</span>
            </button>
          </div>

          <div className="gst-journey-step">
            <div className="gst-journey-step-top">
              <span className="gst-journey-step-tag">Phase 2 • On 14th</span>
              <h4 className="gst-journey-step-title">GSTR-2B Statement Import</h4>
              <p className="gst-journey-step-desc">
                Download your official GSTR-2B from the GST Portal and launch the <strong>2B Import Wizard</strong> here. The platform cross-examines vendor invoices against your purchase bills.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsImportModalOpen(true)}
              className="gst-journey-action-btn"
            >
              <span>Launch 2B Wizard</span>
              <span>➔</span>
            </button>
          </div>

          <div className="gst-journey-step">
            <div className="gst-journey-step-top">
              <span className="gst-journey-step-tag">Phase 3 • Before 20th</span>
              <h4 className="gst-journey-step-title">GSTR-3B Tax Filing &amp; Payment</h4>
              <p className="gst-journey-step-desc">
                Click <strong>Download Full CA Audit Pack</strong> to email all 5 registers to your CA. Verify Table 3.1 &amp; Table 4, pay net cash liability via Challan, and lock the return.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate && onNavigate('gst-gstr3b')}
              className="gst-journey-action-btn"
            >
              <span>Open GSTR-3B Worksheet</span>
              <span>➔</span>
            </button>
          </div>
        </div>
      </div>

      <Gstr2bImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportComplete={() => {
          setIsImportModalOpen(false);
          if (onNavigate) onNavigate('gst-itc-reconciliation');
        }}
        defaultPeriod={period}
      />
    </div>
  );
};
