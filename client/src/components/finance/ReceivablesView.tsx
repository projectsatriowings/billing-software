import React, { useState, useEffect } from 'react';
import { fetchFinanceReceivables } from '../../api.ts';
import { fmtMoney } from '../../../../shared/money.ts';

interface ReceivablesViewProps {
  onCollectPayment?: (customerId: string) => void;
}

export function ReceivablesView({ onCollectPayment }: ReceivablesViewProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetchFinanceReceivables();
      setData(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const customers = (data?.customers || []).filter((c: any) => {
    const name = c.customerName || '';
    const phone = c.customerPhone || '';
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return name.toLowerCase().includes(q) || phone.toLowerCase().includes(q);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Top Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
        <div style={{
          background: '#ffffff',
          borderRadius: '14px',
          border: '1px solid #fed7aa',
          padding: '1.25rem',
          boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
        }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#c2410c', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Total Outstanding Receivables
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#ea580c', marginTop: '0.35rem', fontFamily: 'monospace' }}>
            {data ? fmtMoney(data.totalReceivableMinor || 0) : '—'}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#9a3412', marginTop: '0.25rem' }}>
            Pending customer khata credit balances
          </div>
        </div>

        <div style={{
          background: '#ffffff',
          borderRadius: '14px',
          border: '1px solid #e2e8f0',
          padding: '1.25rem',
          boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
        }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Customers with Overdue Khata
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#1e293b', marginTop: '0.35rem' }}>
            {data?.customersCount ?? (customers.length || 0)}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
            Active debtors with balance dues
          </div>
        </div>

        <div style={{
          background: '#f0fdf4',
          borderRadius: '14px',
          border: '1px solid #bbf7d0',
          padding: '1.25rem',
          boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
        }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Collection Recovery
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#166534', marginTop: '0.5rem' }}>
            Instant Payment Links
          </div>
          <div style={{ fontSize: '0.75rem', color: '#16a34a', marginTop: '0.25rem' }}>
            WhatsApp statement &amp; UPI QR collection
          </div>
        </div>
      </div>

      {/* Filter and Refresh Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <input
          type="text"
          placeholder="🔍 Search customer by name or phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            minWidth: '280px',
            maxWidth: '360px',
            padding: '0.6rem 0.9rem',
            fontSize: '0.82rem',
            borderRadius: '10px',
            border: '1px solid #cbd5e1',
            background: '#ffffff',
            color: '#1e293b',
            outline: 'none',
          }}
        />
        <button
          type="button"
          onClick={loadData}
          className="btn btn-secondary"
          style={{ padding: '0.55rem 0.9rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}
        >
          🔄 Refresh Receivables
        </button>
      </div>

      {/* Receivables Table */}
      <div style={{
        background: '#ffffff',
        borderRadius: '14px',
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
      }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
            ⏳ Loading receivables ledger...
          </div>
        ) : customers.length === 0 ? (
          <div style={{ padding: '3.5rem 1.5rem', textAlign: 'center', color: '#64748b' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🎉</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#1e293b' }}>
              All customer accounts are clear!
            </div>
            <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>
              No outstanding khata balances or overdue customer invoices found.
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.84rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 700 }}>
                  <th style={{ padding: '0.85rem 1rem' }}>Customer Name</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Phone Number</th>
                  <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Unpaid Invoices</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Oldest Bill Date</th>
                  <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Outstanding Due</th>
                  <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c: any) => (
                  <tr
                    key={c.customerId}
                    style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f8faff')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '0.85rem 1rem', fontWeight: 700, color: '#0f172a' }}>
                      {c.customerName || 'Counter Customer'}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', fontFamily: 'monospace', color: '#475569' }}>
                      {c.customerPhone || <span style={{ color: '#94a3b8', fontStyle: 'italic', fontFamily: 'inherit' }}>No Phone</span>}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>
                      <span style={{
                        display: 'inline-block',
                        background: '#f1f5f9',
                        color: '#334155',
                        padding: '0.2rem 0.6rem',
                        borderRadius: '999px',
                        fontWeight: 700,
                        fontSize: '0.75rem',
                      }}>
                        {c.openInvoicesCount}
                      </span>
                    </td>
                    <td style={{ padding: '0.85rem 1rem', color: '#64748b' }}>
                      {c.oldestInvoiceDate || '—'}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', textAlign: 'right', fontWeight: 800, color: '#e11d48', fontFamily: 'monospace', fontSize: '0.9rem' }}>
                      {fmtMoney(c.totalDueMinor)}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => onCollectPayment && onCollectPayment(c.customerId)}
                        className="btn btn-primary"
                        style={{ padding: '0.35rem 0.8rem', fontSize: '0.78rem', borderRadius: '8px' }}
                      >
                        Collect Khata ➔
                      </button>
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
}
