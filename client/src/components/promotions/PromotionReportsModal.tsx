import React, { useState, useEffect } from 'react';
import {
  fetchPromotionReports,
  type PromotionReportsData,
  type Branch,
} from '../../api';

interface PromotionReportsModalProps {
  isOpen: boolean;
  onClose: () => void;
  branches: Branch[];
}

export function PromotionReportsModal({
  isOpen,
  onClose,
  branches,
}: PromotionReportsModalProps) {
  const [period, setPeriod] = useState<'today' | 'week' | 'this_month' | 'custom'>('this_month');
  const [customStart, setCustomStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [customEnd, setCustomEnd] = useState(() => new Date().toISOString().slice(0, 10));
  const [selectedBranch, setSelectedBranch] = useState('ALL');
  const [selectedType, setSelectedType] = useState('ALL');

  const [loading, setLoading] = useState(false);
  const [reportsData, setReportsData] = useState<PromotionReportsData | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetchPromotionReports({
        period,
        startDate: period === 'custom' ? customStart : undefined,
        endDate: period === 'custom' ? customEnd : undefined,
        branch: selectedBranch !== 'ALL' ? selectedBranch : undefined,
        type: selectedType !== 'ALL' ? selectedType : undefined,
      });
      setReportsData(res);
    } catch (err) {
      console.error('Failed to load promotions report:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, period, customStart, customEnd, selectedBranch, selectedType]);

  if (!isOpen) return null;

  const overview = reportsData?.overview || {
    totalDiscountMinor: 0,
    billsCount: 0,
    revenueMinor: 0,
    totalPromotionsCount: 0,
    activePromotionsCount: 0,
  };

  return (
    <div className="promo-modal-overlay" onClick={onClose}>
      <div className="promo-reports-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="promo-modal-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="promo-reports-icon">📊</span>
              <h3 className="promo-modal-title">Promotions & Discounts Analytics</h3>
            </div>
            <p className="promo-modal-subtitle">
              Comprehensive performance metrics, revenue contribution, and promotion usage
            </p>
          </div>
          <button className="promo-modal-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        {/* Filters header bar */}
        <div className="promo-reports-filters">
          <div className="promo-pills-group">
            <button
              className={`promo-filter-pill ${period === 'today' ? 'active' : ''}`}
              onClick={() => setPeriod('today')}
            >
              Today
            </button>
            <button
              className={`promo-filter-pill ${period === 'week' ? 'active' : ''}`}
              onClick={() => setPeriod('week')}
            >
              This Week
            </button>
            <button
              className={`promo-filter-pill ${period === 'this_month' ? 'active' : ''}`}
              onClick={() => setPeriod('this_month')}
            >
              This Month
            </button>
            <button
              className={`promo-filter-pill ${period === 'custom' ? 'active' : ''}`}
              onClick={() => setPeriod('custom')}
            >
              Custom Range
            </button>
          </div>

          {period === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="promo-date-input-sm"
              />
              <span>to</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="promo-date-input-sm"
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="promo-select-sm"
            >
              <option value="ALL">All Branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.code}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>

            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="promo-select-sm"
            >
              <option value="ALL">All Offer Types</option>
              <option value="bogo">BOGO</option>
              <option value="percentage">Percentage Discount</option>
              <option value="fixed_amount">Fixed Amount</option>
              <option value="category_discount">Category Discount</option>
              <option value="product_discount">Product Discount</option>
              <option value="quantity_based">Volume / Tier Slabs</option>
              <option value="bill_level">Bill Level</option>
            </select>
          </div>
        </div>

        {/* Reports Content */}
        <div className="promo-reports-content">
          {loading ? (
            <div className="promo-loading-state">Loading promotion analytics...</div>
          ) : (
            <>
              {/* KPI Top Cards */}
              <div className="promo-kpi-grid">
                <div className="promo-kpi-card">
                  <div className="promo-kpi-label">Total Discount Provided</div>
                  <div className="promo-kpi-value text-success">
                    ₹{(overview.totalDiscountMinor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                  <div className="promo-kpi-hint">Direct customer savings</div>
                </div>

                <div className="promo-kpi-card">
                  <div className="promo-kpi-label">Bills with Promotions</div>
                  <div className="promo-kpi-value text-primary">
                    {overview.billsCount.toLocaleString('en-IN')}
                  </div>
                  <div className="promo-kpi-hint">Invoices with promo applied</div>
                </div>

                <div className="promo-kpi-card">
                  <div className="promo-kpi-label">Sales Generated</div>
                  <div className="promo-kpi-value">
                    ₹{(overview.revenueMinor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </div>
                  <div className="promo-kpi-hint">From promo-assisted bills</div>
                </div>

                <div className="promo-kpi-card">
                  <div className="promo-kpi-label">Active / Total Offers</div>
                  <div className="promo-kpi-value text-indigo">
                    {overview.activePromotionsCount} / {overview.totalPromotionsCount}
                  </div>
                  <div className="promo-kpi-hint">Configured promotions</div>
                </div>
              </div>

              {/* Grid 2-column: Most Used + Branch breakdown */}
              <div className="promo-reports-sections-grid">
                {/* Most Used Promotions */}
                <div className="promo-card-panel">
                  <h4 className="promo-section-title">Most-Used Promotions</h4>
                  {(!reportsData?.mostUsedPromotions || reportsData.mostUsedPromotions.length === 0) ? (
                    <div className="promo-empty-table-note">No promotion usage recorded for this timeframe.</div>
                  ) : (
                    <div className="promo-table-wrap">
                      <table className="promo-data-table">
                        <thead>
                          <tr>
                            <th>Promotion</th>
                            <th>Type</th>
                            <th style={{ textAlign: 'right' }}>Uses</th>
                            <th style={{ textAlign: 'right' }}>Discount Given</th>
                            <th style={{ textAlign: 'right' }}>Sales</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportsData.mostUsedPromotions.map((p) => (
                            <tr key={p.promotionId}>
                              <td style={{ fontWeight: 600 }}>{p.name}</td>
                              <td>
                                <span className={`promo-type-badge ${p.type}`}>
                                  {p.type.toUpperCase().replace(/_/g, ' ')}
                                </span>
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 600 }}>{p.usageCount}</td>
                              <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 600 }}>
                                ₹{(p.totalDiscountMinor / 100).toFixed(2)}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                ₹{(p.revenueGeneratedMinor / 100).toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Branch Performance */}
                <div className="promo-card-panel">
                  <h4 className="promo-section-title">Branch Performance</h4>
                  {(!reportsData?.branchPerformance || reportsData.branchPerformance.length === 0) ? (
                    <div className="promo-empty-table-note">No branch transactions for this period.</div>
                  ) : (
                    <div className="promo-table-wrap">
                      <table className="promo-data-table">
                        <thead>
                          <tr>
                            <th>Branch</th>
                            <th style={{ textAlign: 'right' }}>Usage Count</th>
                            <th style={{ textAlign: 'right' }}>Discount (₹)</th>
                            <th style={{ textAlign: 'right' }}>Sales (₹)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportsData.branchPerformance.map((b) => (
                            <tr key={b.branch}>
                              <td style={{ fontWeight: 600 }}>{b.branch}</td>
                              <td style={{ textAlign: 'right', fontWeight: 600 }}>{b.usageCount}</td>
                              <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 600 }}>
                                ₹{(b.totalDiscountMinor / 100).toFixed(2)}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                ₹{(b.totalSalesMinor / 100).toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>

              {/* Daily Trend Table */}
              {reportsData?.timeline && reportsData.timeline.length > 0 && (
                <div className="promo-card-panel" style={{ marginTop: '1.25rem' }}>
                  <h4 className="promo-section-title">Daily Activity Breakdown</h4>
                  <div className="promo-table-wrap">
                    <table className="promo-data-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th style={{ textAlign: 'right' }}>Promotions Applied</th>
                          <th style={{ textAlign: 'right' }}>Total Discount Given</th>
                          <th style={{ textAlign: 'right' }}>Associated Billed Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportsData.timeline.map((t) => (
                          <tr key={t.bdate}>
                            <td>{t.bdate}</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{t.usageCount}</td>
                            <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 600 }}>
                              ₹{(t.discountMinor / 100).toFixed(2)}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              ₹{(t.salesMinor / 100).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="promo-modal-footer">
          <div style={{ marginLeft: 'auto' }}>
            <button type="button" className="promo-btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

