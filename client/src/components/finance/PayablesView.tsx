import React, { useState, useEffect } from 'react';
import { fetchFinancePayables } from '../../api.ts';
import { fmtMoney } from '../../../../shared/money.ts';

interface PayablesViewProps {
  onPaySupplier?: (supplierId: string) => void;
}

export function PayablesView({ onPaySupplier }: PayablesViewProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetchFinancePayables();
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

  const suppliers = (data?.suppliers || []).filter((s: any) => {
    const name = s.supplierName || '';
    const gstin = s.supplierGstin || '';
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return name.toLowerCase().includes(q) || gstin.toLowerCase().includes(q);
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
            Total Supplier Payables Due
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#ea580c', marginTop: '0.35rem', fontFamily: 'monospace' }}>
            {data ? fmtMoney(data.totalPayableMinor || 0) : '—'}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#9a3412', marginTop: '0.25rem' }}>
            Unsettled purchase bills &amp; vendor balances
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
            Vendors with Pending Balances
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#1e293b', marginTop: '0.35rem' }}>
            {data?.suppliersCount ?? (suppliers.length || 0)}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
            Distributors &amp; stock inward vendors
          </div>
        </div>

        <div style={{
          background: '#f8faff',
          borderRadius: '14px',
          border: '1px solid #c7d2fe',
          padding: '1.25rem',
          boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
        }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#4338ca', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Payment Settlement Flow
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#3730a3', marginTop: '0.5rem' }}>
            FIFO Invoice Matching
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6366f1', marginTop: '0.25rem' }}>
            Settles oldest inward invoices first
          </div>
        </div>
      </div>

      {/* Filter and Refresh Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <input
          type="text"
          placeholder="🔍 Search vendor by name or GSTIN..."
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
          🔄 Refresh Payables
        </button>
      </div>

      {/* Payables Table */}
      <div style={{
        background: '#ffffff',
        borderRadius: '14px',
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
      }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
            ⏳ Loading payables ledger...
          </div>
        ) : suppliers.length === 0 ? (
          <div style={{ padding: '3.5rem 1.5rem', textAlign: 'center', color: '#64748b' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🎉</div>
            <div style={{ fontSize: '1rem', fontWeight: 700, color: '#1e293b' }}>
              All supplier bills are fully settled!
            </div>
            <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>
              No outstanding supplier balances or pending purchase payments found.
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.84rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 700 }}>
                  <th style={{ padding: '0.85rem 1rem' }}>Supplier Name</th>
                  <th style={{ padding: '0.85rem 1rem' }}>GSTIN</th>
                  <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Open Purchases</th>
                  <th style={{ padding: '0.85rem 1rem' }}>Oldest Bill Date</th>
                  <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Outstanding Payable</th>
                  <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s: any) => (
                  <tr
                    key={s.supplierId}
                    style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f8faff')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '0.85rem 1rem', fontWeight: 700, color: '#0f172a' }}>
                      {s.supplierName || 'Unknown Vendor'}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', fontFamily: 'monospace', color: '#475569' }}>
                      {s.supplierGstin || <span style={{ color: '#94a3b8', fontStyle: 'italic', fontFamily: 'inherit' }}>Unregistered</span>}
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
                        {s.openPurchasesCount}
                      </span>
                    </td>
                    <td style={{ padding: '0.85rem 1rem', color: '#64748b' }}>
                      {s.oldestBillDate || '—'}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', textAlign: 'right', fontWeight: 800, color: '#e11d48', fontFamily: 'monospace', fontSize: '0.9rem' }}>
                      {fmtMoney(s.totalPayableMinor)}
                    </td>
                    <td style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => onPaySupplier && onPaySupplier(s.supplierId)}
                        className="btn btn-primary"
                        style={{ padding: '0.35rem 0.8rem', fontSize: '0.78rem', borderRadius: '8px' }}
                      >
                        Settle Bills ➔
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
