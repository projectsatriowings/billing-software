import React, { useState, useEffect } from 'react';
import { fetchShiftReport, reviewShift, type ShiftClosingReport } from '../../api.ts';
import { formatMoney, classifyVariance } from '../../../../shared/shifts.ts';

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
  const [reviewSuccess, setReviewSuccess] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen || !shiftId) return;
    loadReport();
  }, [isOpen, shiftId]);

  const loadReport = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchShiftReport(shiftId);
      setReport(res.report);
    } catch (err: any) {
      setError(err.message || 'Failed to load shift closing report.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const isManagerOrOwner = ['owner', 'manager'].includes(userRole);
  const varClass = report
    ? report.varianceClassification || classifyVariance(report.summary.varianceMinor ?? 0)
    : { type: 'balanced' as const, absAmountMinor: 0, requiresReason: false };

  const handlePrint = () => {
    const printUrl = `/api/shifts/${shiftId}/report?format=html`;
    const win = window.open(printUrl, '_blank');
    if (win) {
      win.focus();
    }
  };

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewNotes.trim()) return;

    setIsReviewing(true);
    try {
      await reviewShift(shiftId, { reviewNotes: reviewNotes.trim() });
      setReviewSuccess(true);
      await loadReport();
      if (onShiftUpdated) onShiftUpdated();
    } catch (err: any) {
      alert(err.message || 'Failed to submit manager review.');
    } finally {
      setIsReviewing(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content shift-report-modal wide" onClick={(e) => e.stopPropagation()}>
        {/* Top Accent Gradient Bar */}
        <div className="modal-top-accent purple-accent"></div>

        <div className="modal-header">
          <div className="modal-title-wrap">
            <div className="modal-icon-badge purple">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
            </div>
            <div>
              <h2 className="modal-title">Day-End Shift Closing Report</h2>
              <p className="modal-subtitle">Official Authoritative Audit & Drawer Settlement</p>
            </div>
          </div>
          <div className="header-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handlePrint}
              title="Print thermal or A4 day-end receipt"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 6 2 18 2 18 9"></polyline>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                <rect x="6" y="14" width="12" height="8"></rect>
              </svg>
              <span>Print Report</span>
            </button>
            <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close modal">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>

        <div className="modal-body report-modal-scroll">
          {loading && (
            <div className="report-loading-state">
              <span className="spinner">⏳</span>
              <span>Compiling authoritative shift report...</span>
            </div>
          )}

          {error && (
            <div className="shift-modal-alert error">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          {report && !loading && (
            <div className="closing-report-document">
              {/* Header Box */}
              <div className="report-header-banner">
                <div className="report-store-info">
                  <h3 className="report-store-name">{report.shop?.name || 'Adaptive Billing'}</h3>
                  <span className="report-store-meta">
                    {report.shop?.gstin ? `GSTIN: ${report.shop.gstin}` : 'B2C Retail'} • {report.shop?.phone || ''}
                  </span>
                </div>
                <div className="report-shift-badge-box">
                  <span className="report-shift-no">{report.shift.shiftNumber}</span>
                  <span className={`status-pill ${report.shift.status}`}>
                    {report.shift.status.toUpperCase()}
                  </span>
                </div>
              </div>

              {/* Meta Grid */}
              <div className="report-meta-grid">
                <div className="meta-item">
                  <span className="meta-label">Cashier</span>
                  <span className="meta-val">{report.shift.userName}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Location</span>
                  <span className="meta-val">{report.shift.location || 'MAIN'}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Opened At</span>
                  <span className="meta-val">{new Date(report.shift.openedAt).toLocaleString('en-IN')}</span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Closed At</span>
                  <span className="meta-val">
                    {report.shift.closedAt ? new Date(report.shift.closedAt).toLocaleString('en-IN') : 'Still Open'}
                  </span>
                </div>
              </div>

              {/* Drawer Cash Reconciliation Table */}
              <div className="report-section">
                <h4 className="report-section-title">💵 Cash Drawer Reconciliation</h4>
                <table className="report-table">
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
                      <td className="text-right font-mono font-bold">{formatMoney(report.summary.countedCashMinor)}</td>
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
                  <div className={`report-discrepancy-card ${varClass.type}`}>
                    <span className="discrepancy-badge">
                      {varClass.type === 'shortage' ? 'DEFICIT EXPLANATION' : 'SURPLUS EXPLANATION'}
                    </span>
                    <p className="discrepancy-text">
                      {report.shift.note || 'No explanation reason recorded.'}
                    </p>
                  </div>
                )}
              </div>

              {/* Collections by Payment Method */}
              <div className="report-section">
                <h4 className="report-section-title">💳 Total Collections by Payment Method</h4>
                <table className="report-table">
                  <thead>
                    <tr>
                      <th>Payment Method</th>
                      <th className="text-center">Count</th>
                      <th className="text-right">Total Amount</th>
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
                    <tr className="total-row">
                      <td><strong>TOTAL SETTLED COLLECTIONS</strong></td>
                      <td className="text-center font-mono font-bold">
                        {report.summary.paymentMethods.reduce((a, b) => a + b.count, 0)}
                      </td>
                      <td className="text-right font-mono font-bold text-primary">
                        {formatMoney(report.summary.totalCollectedMinor)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Cash Movements Ledger */}
              {report.cashMovements.length > 0 && (
                <div className="report-section">
                  <h4 className="report-section-title">📋 Shift Cash Movements Log ({report.cashMovements.length})</h4>
                  <table className="report-table">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Type</th>
                        <th>Reason / Notes</th>
                        <th>Recorded By</th>
                        <th className="text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.cashMovements.map((cm) => (
                        <tr key={cm.id}>
                          <td className="text-muted font-mono" style={{ fontSize: '0.8rem' }}>
                            {new Date(cm.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td>
                            <span className={`movement-tag ${cm.movementType}`}>
                              {cm.movementType === 'cash_in' ? 'CASH-IN' : 'CASH-OUT'}
                            </span>
                          </td>
                          <td>
                            <strong>{cm.reason}</strong>
                            {cm.notes && <span className="cell-notes"> • {cm.notes}</span>}
                          </td>
                          <td className="text-muted">{cm.createdByName || 'Staff'}</td>
                          <td className={`text-right font-mono font-semibold ${cm.movementType === 'cash_in' ? 'text-success' : 'text-warning'}`}>
                            {cm.movementType === 'cash_in' ? '+' : '-'}{formatMoney(cm.amountMinor)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Manager Review Status */}
              <div className="report-section review-section">
                <h4 className="report-section-title">🛡️ Manager Review & Audit Status</h4>
                {report.shift.reviewedBy ? (
                  <div className="manager-reviewed-card">
                    <span className="reviewed-badge">✅ REVIEWED & APPROVED</span>
                    <p className="reviewed-by-line">
                      Reviewed by <strong>{report.shift.reviewedByName || report.shift.reviewedBy}</strong> on{' '}
                      {new Date(report.shift.reviewedAt!).toLocaleString('en-IN')}
                    </p>
                    {report.shift.reviewNotes && (
                      <p className="reviewed-notes">
                        <em>Review Notes:</em> {report.shift.reviewNotes}
                      </p>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="pending-review-notice">
                      <span>⏳</span>
                      <span>No manager review recorded yet for this shift.</span>
                    </div>

                    {isManagerOrOwner && report.shift.status === 'closed' && (
                      <form onSubmit={handleReviewSubmit} className="manager-review-form">
                        <label className="form-label font-semibold">
                          Acknowledge & Sign-off Discrepancy (Manager/Owner Action)
                        </label>
                        <textarea
                          className="form-input form-textarea"
                          rows={2}
                          placeholder="Enter audit acknowledgment notes (e.g., Shortage inspected and approved, cash handed over to safe)"
                          value={reviewNotes}
                          onChange={(e) => setReviewNotes(e.target.value)}
                          required
                        />
                        <button
                          type="submit"
                          className="btn btn-primary btn-sm"
                          style={{ marginTop: '0.5rem' }}
                          disabled={isReviewing}
                        >
                          {isReviewing ? 'Saving Review...' : 'Acknowledge & Approve Discrepancy'}
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-primary" onClick={handlePrint}>
            🖨️ Print Thermal / A4 Report
          </button>
        </div>
      </div>
    </div>
  );
};
