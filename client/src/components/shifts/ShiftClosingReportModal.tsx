import { createPortal } from 'react-dom';
import React, { useState, useEffect } from 'react';
import { fetchShiftReport, reviewShift, type ShiftClosingReport } from '../../api.ts';
import { formatMoney, classifyVariance } from '../../../../shared/shifts.ts';
import {
  FileTextIcon,
  ShieldCheckIcon,
  WalletIcon,
  BanknoteIcon,
  TrendingUpIcon,
  CreditCardIcon,
  RefreshCwIcon,
  ScaleIcon,
  CheckCircle2Icon,
  AlertTriangleIcon,
  ClockIcon,
  PrinterIcon,
} from '../inventory/InventoryIcons.tsx';

interface ShiftClosingReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  shiftId: string;
  userRole: string;
  onShiftUpdated?: () => void;
}

export const ShiftClosingReportModal: React.FC<ShiftClosingReportModalProps> = ({
  isOpen,
  onClose,
  shiftId,
  userRole,
  onShiftUpdated,
}) => {
  const [report, setReport] = useState<ShiftClosingReport | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<string>('');
  const [isReviewing, setIsReviewing] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen && shiftId) {
      loadReport();
    }
  }, [isOpen, shiftId]);

  if (!isOpen) return null;

  const loadReport = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchShiftReport(shiftId);
      setReport(data.report);
    } catch (err: any) {
      setError(err.message || 'Failed to load shift closing report.');
    } finally {
      setLoading(false);
    }
  };

  const isManagerOrOwner = ['owner', 'manager', 'admin'].includes(userRole);

  const handlePrint = () => {
    window.print();
  };

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!report) return;

    setIsReviewing(true);
    try {
      await reviewShift(report.shift.id, { reviewNotes: reviewNotes.trim() });
      await loadReport();
      if (onShiftUpdated) onShiftUpdated();
    } catch (err: any) {
      alert(err.message || 'Failed to submit manager review.');
    } finally {
      setIsReviewing(false);
    }
  };

  const varClass = report ? classifyVariance(report.summary.varianceMinor ?? 0) : { type: 'balanced' };

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="shift-bento-dialog wide-1040" onClick={(e) => e.stopPropagation()}>
        {/* Top Accent Gradient Bar */}
        <div className="modal-top-accent purple-accent"></div>

        {/* 1. Bento Header */}
        <div className="shift-bento-header">
          <div className="shift-bento-header-left">
            <div className="shift-bento-icon-badge purple">
              <FileTextIcon size={22} />
            </div>
            <div className="shift-bento-title-wrap">
              <h3>
                <span>Day-End Shift Closing Report</span>
                {report && (
                  <span className="shift-ref-pill">#{report.shift.shiftNumber}</span>
                )}
              </h3>
              <p>
                <span>Official Authoritative Audit & Drawer Settlement</span>
                {report?.shift?.userName && (
                  <>
                    <span>•</span>
                    <span>Cashier: <strong>{report.shift.userName}</strong></span>
                  </>
                )}
                {report?.shift?.location && (
                  <>
                    <span>•</span>
                    <span>Location: {report.shift.location}</span>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="shift-bento-header-actions">
            <button
              type="button"
              className="cat-btn-outline"
              onClick={handlePrint}
              title="Print thermal or A4 day-end receipt"
            >
              <PrinterIcon size={14} />
              <span>Print Report</span>
            </button>
            <button
              type="button"
              className="modal-close-btn"
              onClick={onClose}
              aria-label="Close modal"
              title="Close"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="shift-bento-body">
          {loading && (
            <div className="report-loading-state">
              <RefreshCwIcon size={20} className="spinning-icon" />
              <span>Compiling authoritative shift report...</span>
            </div>
          )}

          {error && (
            <div className="shift-modal-alert error">
              <AlertTriangleIcon size={18} />
              <span>{error}</span>
            </div>
          )}

          {report && !loading && (
            <>
              {/* 4-Tile Bento Ribbon */}
              <div className="shift-bento-ribbon">
                <div className="shift-bento-ribbon-tile">
                  <div className="ribbon-tile-label">
                    <span>Expected Cash</span>
                    <WalletIcon size={13} style={{ color: '#6366f1' }} />
                  </div>
                  <div className="ribbon-tile-val">{formatMoney(report.summary.expectedCashMinor)}</div>
                  <div className="ribbon-tile-sub">Calculated drawer total</div>
                </div>

                <div className="shift-bento-ribbon-tile">
                  <div className="ribbon-tile-label">
                    <span>Counted Cash</span>
                    <BanknoteIcon size={13} style={{ color: '#059669' }} />
                  </div>
                  <div className="ribbon-tile-val text-success">
                    {report.summary.countedCashMinor !== undefined && report.summary.countedCashMinor !== null
                      ? formatMoney(report.summary.countedCashMinor)
                      : '—'}
                  </div>
                  <div className="ribbon-tile-sub">Physical drawer count</div>
                </div>

                <div className="shift-bento-ribbon-tile highlight">
                  <div className="ribbon-tile-label">
                    <span>Variance</span>
                    <ScaleIcon size={13} style={{ color: '#4f46e5' }} />
                  </div>
                  <div
                    className="ribbon-tile-val"
                    style={{
                      color: (report.summary.varianceMinor ?? 0) === 0
                        ? '#059669'
                        : (report.summary.varianceMinor ?? 0) < 0
                          ? '#dc2626'
                          : '#d97706',
                    }}
                  >
                    {(report.summary.varianceMinor ?? 0) === 0
                      ? 'BALANCED'
                      : formatMoney(report.summary.varianceMinor ?? 0)}
                  </div>
                  <div className="ribbon-tile-sub">
                    {(report.summary.varianceMinor ?? 0) === 0 ? 'Zero discrepancy' : varClass.type.toUpperCase()}
                  </div>
                </div>

                <div className="shift-bento-ribbon-tile">
                  <div className="ribbon-tile-label">
                    <span>Total Collections</span>
                    <TrendingUpIcon size={13} style={{ color: '#7c3aed' }} />
                  </div>
                  <div className="ribbon-tile-val" style={{ color: '#7c3aed' }}>
                    {formatMoney(report.summary.totalCollectedMinor)}
                  </div>
                  <div className="ribbon-tile-sub">Cash + Digital combined</div>
                </div>
              </div>

              {/* Dual Column Bento Grid */}
              <div className="shift-bento-main-grid">
                {/* Left Bento Panel: Cash Reconciliation & Payments */}
                <div className="shift-bento-panel">
                  <div className="shift-bento-panel-header">
                    <div className="panel-header-title-box">
                      <BanknoteIcon size={16} style={{ color: '#059669' }} />
                      <h4 className="panel-header-title">Drawer Cash Reconciliation</h4>
                    </div>
                  </div>

                  <table className="report-table" style={{ margin: 0 }}>
                    <tbody>
                      <tr>
                        <td>Opening Cash Float</td>
                        <td className="text-right font-mono">{formatMoney(report.summary.openingCashMinor)}</td>
                      </tr>
                      <tr>
                        <td>(+) Cash Sales & Direct Receipts</td>
                        <td className="text-right font-mono text-success">+{formatMoney(report.summary.cashSalesMinor)}</td>
                      </tr>
                      <tr>
                        <td>(+) Cash-In Drawer Movements</td>
                        <td className="text-right font-mono text-success">+{formatMoney(report.summary.cashInMinor)}</td>
                      </tr>
                      <tr>
                        <td>(-) Cash-Out Drawer Movements</td>
                        <td className="text-right font-mono text-warning">-{formatMoney(report.summary.cashOutMinor)}</td>
                      </tr>
                      <tr>
                        <td>(-) Cash Refunds Paid from Drawer</td>
                        <td className="text-right font-mono text-danger">-{formatMoney(report.summary.cashRefundsMinor)}</td>
                      </tr>
                      <tr className="highlight-row">
                        <td><strong>EXPECTED DRAWER CASH</strong></td>
                        <td className="text-right font-mono font-bold">{formatMoney(report.summary.expectedCashMinor)}</td>
                      </tr>
                      <tr className="highlight-row secondary">
                        <td><strong>ACTUAL PHYSICAL COUNTED CASH</strong></td>
                        <td className="text-right font-mono font-bold">
                          {report.summary.countedCashMinor !== undefined && report.summary.countedCashMinor !== null
                            ? formatMoney(report.summary.countedCashMinor)
                            : '—'}
                        </td>
                      </tr>
                      <tr className={`variance-row ${varClass.type}`}>
                        <td>
                          <strong>CASH VARIANCE ({varClass.type.toUpperCase()})</strong>
                        </td>
                        <td className="text-right font-mono font-bold">
                          {formatMoney(report.summary.varianceMinor)}
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  {/* Variance Explanation Notice */}
                  {report.summary.varianceMinor !== 0 && (
                    <div className={`report-discrepancy-card ${varClass.type}`} style={{ margin: 0 }}>
                      <span className="discrepancy-badge">
                        {varClass.type === 'shortage' ? 'DEFICIT EXPLANATION' : 'SURPLUS EXPLANATION'}
                      </span>
                      <p className="discrepancy-text">
                        {report.shift.note || 'No explanation reason recorded.'}
                      </p>
                    </div>
                  )}

                  {/* Payment Methods Breakdown */}
                  <div style={{ marginTop: '0.5rem' }}>
                    <div className="panel-header-title-box" style={{ marginBottom: '0.65rem' }}>
                      <CreditCardIcon size={15} style={{ color: '#2563eb' }} />
                      <h4 className="panel-header-title" style={{ fontSize: '0.86rem' }}>Settled Collections by Method</h4>
                    </div>
                    <table className="report-table" style={{ margin: 0 }}>
                      <thead>
                        <tr>
                          <th>Method</th>
                          <th className="text-center">Count</th>
                          <th className="text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.summary.paymentMethods.map((pm) => (
                          <tr key={pm.method}>
                            <td>
                              <span className={`method-badge ${pm.method}`}>
                                {pm.method.toUpperCase()}
                              </span>
                            </td>
                            <td className="text-center font-mono">{pm.count}</td>
                            <td className="text-right font-mono font-semibold">{formatMoney(pm.amountMinor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Right Bento Panel: Shift Meta, Movements & Review */}
                <div className="shift-bento-panel">
                  <div className="shift-bento-panel-header">
                    <div className="panel-header-title-box">
                      <ShieldCheckIcon size={16} style={{ color: '#7c3aed' }} />
                      <h4 className="panel-header-title">Audit Log & Sign-Off</h4>
                    </div>
                    <span
                      className={`status-pill ${report.shift.status}`}
                      style={{ fontSize: '0.68rem', padding: '0.2rem 0.55rem' }}
                    >
                      {report.shift.status.toUpperCase()}
                    </span>
                  </div>

                  {/* Metadata Card */}
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.45rem', fontSize: '0.78rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                      <span>Cashier:</span>
                      <strong style={{ color: '#0f172a' }}>{report.shift.userName}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                      <span>Location / Register:</span>
                      <strong style={{ color: '#0f172a' }}>{report.shift.location || 'MAIN'} ({report.shift.counter || 'COUNTER-1'})</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                      <span>Opened At:</span>
                      <strong style={{ color: '#0f172a' }}>{new Date(report.shift.openedAt).toLocaleString('en-IN')}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b' }}>
                      <span>Closed At:</span>
                      <strong style={{ color: '#0f172a' }}>
                        {report.shift.closedAt ? new Date(report.shift.closedAt).toLocaleString('en-IN') : 'Still Open'}
                      </strong>
                    </div>
                  </div>

                  {/* Manager Review Status */}
                  <div style={{ marginTop: '0.25rem' }}>
                    {report.shift.reviewedBy ? (
                      <div className="manager-reviewed-card" style={{ margin: 0 }}>
                        <span className="reviewed-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <CheckCircle2Icon size={14} /> REVIEWED & AUDITED
                        </span>
                        <p className="reviewed-by-line" style={{ margin: '0.35rem 0' }}>
                          By <strong>{report.shift.reviewedByName || report.shift.reviewedBy}</strong> on{' '}
                          {new Date(report.shift.reviewedAt!).toLocaleString('en-IN')}
                        </p>
                        {report.shift.reviewNotes && (
                          <p className="reviewed-notes" style={{ margin: 0 }}>
                            <em>Notes:</em> {report.shift.reviewNotes}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div>
                        <div className="pending-review-notice" style={{ margin: 0, marginBottom: '0.5rem' }}>
                          <ClockIcon size={15} />
                          <span>Discrepancy pending manager review sign-off</span>
                        </div>

                        {isManagerOrOwner && report.shift.status === 'closed' && (
                          <form onSubmit={handleReviewSubmit} className="manager-review-form" style={{ margin: 0 }}>
                            <label className="form-label font-semibold" style={{ fontSize: '0.78rem' }}>
                              Acknowledge & Sign-Off Discrepancy
                            </label>
                            <textarea
                              className="form-input form-textarea"
                              rows={2}
                              placeholder="Enter audit acknowledgment notes..."
                              value={reviewNotes}
                              onChange={(e) => setReviewNotes(e.target.value)}
                              required
                            />
                            <button
                              type="submit"
                              className="cat-btn-primary"
                              style={{ marginTop: '0.5rem', alignSelf: 'flex-start' }}
                              disabled={isReviewing}
                            >
                              {isReviewing ? 'Saving Review...' : 'Acknowledge & Approve Discrepancy'}
                            </button>
                          </form>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Movements Count */}
                  {report.cashMovements.length > 0 && (
                    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '0.75rem 0.9rem', fontSize: '0.76rem', color: '#64748b', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                      <span>Recorded Cash Movements:</span>
                      <strong style={{ color: '#0f172a' }}>{report.cashMovements.length} transactions</strong>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* 3. Bento Footer */}
        <div className="shift-bento-footer">
          <div className="shift-bento-footer-left">
            <ShieldCheckIcon size={15} style={{ color: '#059669' }} />
            <span>Immutable day-end settlement record archived with Neon PostgreSQL</span>
          </div>

          <div className="shift-bento-footer-actions">
            <button type="button" className="cat-btn-outline" onClick={onClose}>
              Close
            </button>
            <button type="button" className="cat-btn-primary" onClick={handlePrint}>
              <PrinterIcon size={14} />
              <span>Print A4 / Thermal Receipt</span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
