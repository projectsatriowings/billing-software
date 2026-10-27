import React, { useState, useEffect } from 'react';
import { fetchFinanceCashBank } from '../../api.ts';
import { fmtMoney } from '../../../../shared/money.ts';

export function CashBankView() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchFinanceCashBank();
      setData(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to load cash & bank overview');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  if (loading) {
    return (
      <div style={{ padding: '3.5rem', textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
        ⏳ Loading Cash &amp; Bank balances...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Top Action Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <button
          type="button"
          onClick={loadData}
          className="btn btn-secondary"
          style={{ padding: '0.55rem 0.9rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem', marginLeft: 'auto' }}
        >
          🔄 Refresh Balances
        </button>
      </div>

      {error && (
        <div style={{
          borderRadius: '12px',
          border: '1px solid #fecdd3',
          background: '#fff1f2',
          padding: '1rem',
          fontSize: '0.82rem',
          fontWeight: 600,
          color: '#be123c',
        }}>
          ⚠️ {error}
        </div>
      )}

      {data && (
        <>
          {/* KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
            <div style={{
              background: '#ffffff',
              borderRadius: '14px',
              border: '1px solid #a7f3d0',
              padding: '1.25rem',
              boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#047857', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Estimated Cash in Drawer
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#059669', marginTop: '0.35rem', fontFamily: 'monospace' }}>
                {fmtMoney(
                  (data.cashDrawer?.totalCashCollectionsMinor || 0) +
                    (data.cashDrawer?.cashMovementsInMinor || 0) -
                    (data.cashDrawer?.cashMovementsOutMinor || 0)
                )}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#065f46', marginTop: '0.25rem' }}>
                Net collections + drawer float adjustments
              </div>
            </div>

            <div style={{
              background: '#ffffff',
              borderRadius: '14px',
              border: '1px solid #bae6fd',
              padding: '1.25rem',
              boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0369a1', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                UPI &amp; QR Direct Settlements
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0284c7', marginTop: '0.35rem', fontFamily: 'monospace' }}>
                {fmtMoney(data.digitalBank?.totalUpiMinor || 0)}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#075985', marginTop: '0.25rem' }}>
                Direct bank receipts via dynamic QR / UPI
              </div>
            </div>

            <div style={{
              background: '#ffffff',
              borderRadius: '14px',
              border: '1px solid #e9d5ff',
              padding: '1.25rem',
              boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
            }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#7e22ce', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Card &amp; Bank Transfer Dues
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#9333ea', marginTop: '0.35rem', fontFamily: 'monospace' }}>
                {fmtMoney((data.digitalBank?.totalCardMinor || 0) + (data.digitalBank?.totalBankMinor || 0))}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#6b21a8', marginTop: '0.25rem' }}>
                POS swipe terminals &amp; NEFT/RTGS receipts
              </div>
            </div>
          </div>

          {/* Breakdown Tables */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
            <div style={{
              background: '#ffffff',
              borderRadius: '14px',
              border: '1px solid #e2e8f0',
              padding: '1.25rem',
              boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
            }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 800, color: '#1e293b', marginBottom: '0.85rem' }}>
                💰 Inward Collections by Method
              </h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.82rem' }}>
                <tbody>
                  {(data.collectionsByMethod || []).map((c: any) => (
                    <tr key={c.method} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.65rem 0', fontWeight: 600, textTransform: 'capitalize', color: '#334155' }}>
                        {c.method}
                      </td>
                      <td style={{ padding: '0.65rem 0', textAlign: 'right', fontWeight: 800, color: '#0f172a', fontFamily: 'monospace' }}>
                        {fmtMoney(c.totalMinor)}
                      </td>
                    </tr>
                  ))}
                  {(!data.collectionsByMethod || data.collectionsByMethod.length === 0) && (
                    <tr>
                      <td colSpan={2} style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8' }}>
                        No collections recorded yet today
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{
              background: '#ffffff',
              borderRadius: '14px',
              border: '1px solid #e2e8f0',
              padding: '1.25rem',
              boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
            }}>
              <h3 style={{ fontSize: '0.9rem', fontWeight: 800, color: '#1e293b', marginBottom: '0.85rem' }}>
                💸 Outward Payouts by Method (Suppliers &amp; Expenses)
              </h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.82rem' }}>
                <tbody>
                  {(data.supplierPaymentsByMethod || []).map((c: any) => (
                    <tr key={c.method} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.65rem 0', fontWeight: 600, textTransform: 'capitalize', color: '#334155' }}>
                        Supplier Payouts ({c.method})
                      </td>
                      <td style={{ padding: '0.65rem 0', textAlign: 'right', fontWeight: 800, color: '#e11d48', fontFamily: 'monospace' }}>
                        {fmtMoney(c.totalMinor)}
                      </td>
                    </tr>
                  ))}
                  {(data.expensesByMethod || []).map((c: any) => (
                    <tr key={c.method} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.65rem 0', fontWeight: 600, textTransform: 'capitalize', color: '#334155' }}>
                        Expenses ({c.method})
                      </td>
                      <td style={{ padding: '0.65rem 0', textAlign: 'right', fontWeight: 800, color: '#d97706', fontFamily: 'monospace' }}>
                        {fmtMoney(c.totalMinor)}
                      </td>
                    </tr>
                  ))}
                  {(!data.supplierPaymentsByMethod || data.supplierPaymentsByMethod.length === 0) &&
                    (!data.expensesByMethod || data.expensesByMethod.length === 0) && (
                      <tr>
                        <td colSpan={2} style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8' }}>
                          No disbursements recorded yet today
                        </td>
                      </tr>
                    )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
