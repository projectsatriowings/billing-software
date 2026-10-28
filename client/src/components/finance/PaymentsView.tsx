import React, { useState, useEffect } from 'react';
import { api, type Payment, type SupplierPaymentRecord } from '../../api.ts';
import { fmtMoney } from '../../../../shared/money.ts';

interface PaymentsViewProps {
  onOpenCustomerLedger?: (customerId: string) => void;
  onOpenSupplierLedger?: (supplierId: string) => void;
}

export function PaymentsView({ onOpenCustomerLedger, onOpenSupplierLedger }: PaymentsViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<'customer' | 'supplier'>('supplier');
  const [customerPayments, setCustomerPayments] = useState<Payment[]>([]);
  const [supplierPayments, setSupplierPayments] = useState<SupplierPaymentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState('ALL');

  const loadData = async () => {
    setLoading(true);
    try {
      if (activeSubTab === 'customer') {
        const res = await api<{ payments: Payment[] }>('/api/payments?limit=50');
        setCustomerPayments(res.payments || []);
      } else {
        const res = await api<{ payments: SupplierPaymentRecord[] }>('/api/suppliers/payments/history?limit=50').catch(() => ({ payments: [] }));
        setSupplierPayments(res.payments || []);
      }
    } catch {
      // Fallback
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeSubTab]);

  const filteredCustomerPayments = customerPayments.filter((p) => {
    if (modeFilter !== 'ALL' && p.mode !== modeFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchName = (p.customerName || '').toLowerCase().includes(q);
      const matchRec = (p.receiptNumber || '').toLowerCase().includes(q);
      const matchRef = (p.referenceNo || '').toLowerCase().includes(q);
      if (!matchName && !matchRec && !matchRef) return false;
    }
    return true;
  });

  const filteredSupplierPayments = supplierPayments.filter((p) => {
    if (modeFilter !== 'ALL' && p.method !== modeFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchNum = (p.paymentNumber || '').toLowerCase().includes(q);
      const matchRef = (p.reference || '').toLowerCase().includes(q);
      if (!matchNum && !matchRef) return false;
    }
    return true;
  });

  const totalCustomerReceived = customerPayments.reduce((sum, p) => sum + p.amountMinor, 0);
  const totalSupplierDisbursed = supplierPayments.reduce((sum, p) => sum + p.amountMinor, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
        <div style={{
          background: '#ffffff',
          borderRadius: '14px',
          border: '1px solid #bbf7d0',
          padding: '1.25rem',
          boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
        }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Total Customer Collections (Inward)
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#16a34a', marginTop: '0.35rem', fontFamily: 'monospace' }}>
            {fmtMoney(totalCustomerReceived)}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#166534', marginTop: '0.25rem' }}>
            Customer dues collected &amp; cash advances
          </div>
        </div>

        <div style={{
          background: '#ffffff',
          borderRadius: '14px',
          border: '1px solid #fecdd3',
          padding: '1.25rem',
          boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
        }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#be123c', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Total Supplier Payments (Outward)
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#e11d48', marginTop: '0.35rem', fontFamily: 'monospace' }}>
            {fmtMoney(totalSupplierDisbursed)}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#9f1239', marginTop: '0.25rem' }}>
            Disbursements for stock purchase bills
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
            Net Flow Difference
          </div>
          <div style={{
            fontSize: '1.75rem',
            fontWeight: 800,
            color: totalCustomerReceived >= totalSupplierDisbursed ? '#6d4aff' : '#d97706',
            marginTop: '0.35rem',
            fontFamily: 'monospace',
          }}>
            {fmtMoney(totalCustomerReceived - totalSupplierDisbursed)}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
            Inward receipts minus outward disbursements
          </div>
        </div>
      </div>

      {/* Tabs and Filters Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{
          display: 'inline-flex',
          background: '#ede9fe',
          padding: '0.3rem',
          borderRadius: '12px',
          gap: '0.35rem',
        }}>
          <button
            type="button"
            onClick={() => setActiveSubTab('customer')}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.82rem',
              fontWeight: 700,
              borderRadius: '9px',
              border: 'none',
              cursor: 'pointer',
              background: activeSubTab === 'customer' ? '#ffffff' : 'transparent',
              color: activeSubTab === 'customer' ? '#6d4aff' : '#64748b',
              boxShadow: activeSubTab === 'customer' ? '0 2px 6px rgba(109,74,255,0.15)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            📥 Customer Receipts ({customerPayments.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('supplier')}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.82rem',
              fontWeight: 700,
              borderRadius: '9px',
              border: 'none',
              cursor: 'pointer',
              background: activeSubTab === 'supplier' ? '#ffffff' : 'transparent',
              color: activeSubTab === 'supplier' ? '#6d4aff' : '#64748b',
              boxShadow: activeSubTab === 'supplier' ? '0 2px 6px rgba(109,74,255,0.15)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            📤 Supplier Payments ({supplierPayments.length})
          </button>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder={activeSubTab === 'customer' ? '🔍 Search customer, receipt #...' : '🔍 Search voucher, ref #...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              minWidth: '220px',
              padding: '0.55rem 0.85rem',
              fontSize: '0.82rem',
              borderRadius: '10px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#1e293b',
              outline: 'none',
            }}
          />

          <select
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value)}
            style={{
              padding: '0.55rem 0.85rem',
              fontSize: '0.82rem',
              borderRadius: '10px',
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#1e293b',
              outline: 'none',
            }}
          >
            <option value="ALL">All Modes</option>
            <option value="cash">Cash</option>
            <option value="upi">UPI / QR</option>
            <option value="card">Card</option>
            <option value="bank">Bank / NEFT</option>
          </select>

          <button
            type="button"
            onClick={loadData}
            className="btn btn-secondary"
            style={{ padding: '0.55rem 0.85rem', fontSize: '0.8rem' }}
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Main Ledger Table */}
      <div style={{
        background: '#ffffff',
        borderRadius: '14px',
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
      }}>
        {loading ? (
          <div style={{ padding: '3.5rem', textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
            ⏳ Loading payment vouchers...
          </div>
        ) : activeSubTab === 'customer' ? (
          filteredCustomerPayments.length === 0 ? (
            <div style={{ padding: '3.5rem 1.5rem', textAlign: 'center', color: '#64748b' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🧾</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#1e293b' }}>No customer payment receipts found</div>
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>
                Customer receipts recorded via collections will appear here automatically.
              </div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.84rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 700 }}>
                    <th style={{ padding: '0.85rem 1rem' }}>Receipt #</th>
                    <th style={{ padding: '0.85rem 1rem' }}>Date</th>
                    <th style={{ padding: '0.85rem 1rem' }}>Customer</th>
                    <th style={{ padding: '0.85rem 1rem' }}>Payment Mode</th>
                    <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Amount Received</th>
                    <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomerPayments.map((p) => (
                    <tr
                      key={p.id}
                      style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f8faff')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ padding: '0.85rem 1rem', fontFamily: 'monospace', fontWeight: 700, color: '#0f172a' }}>
                        {p.receiptNumber}
                      </td>
                      <td style={{ padding: '0.85rem 1rem', color: '#64748b' }}>
                        {p.paymentDate}
                      </td>
                      <td style={{ padding: '0.85rem 1rem', fontWeight: 700, color: '#1e293b' }}>
                        {p.customerName || 'Counter Customer'}
                      </td>
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '0.2rem 0.55rem',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          background: p.mode === 'cash' ? '#ecfdf5' : p.mode === 'upi' ? '#eff6ff' : '#f5f3ff',
                          color: p.mode === 'cash' ? '#047857' : p.mode === 'upi' ? '#1d4ed8' : '#6d28d9',
                          border: `1px solid ${p.mode === 'cash' ? '#a7f3d0' : '#bfdbfe'}`,
                        }}>
                          {p.mode}
                        </span>
                      </td>
                      <td style={{ padding: '0.85rem 1rem', textAlign: 'right', fontWeight: 800, color: '#16a34a', fontFamily: 'monospace', fontSize: '0.9rem' }}>
                        {fmtMoney(p.amountMinor)}
                      </td>
                      <td style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>
                        {p.customerId && (
                          <button
                            type="button"
                            onClick={() => onOpenCustomerLedger && onOpenCustomerLedger(p.customerId)}
                            className="btn btn-secondary"
                            style={{ padding: '0.3rem 0.7rem', fontSize: '0.75rem' }}
                          >
                            View Customer ➔
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          filteredSupplierPayments.length === 0 ? (
            <div style={{ padding: '3.5rem 1.5rem', textAlign: 'center', color: '#64748b' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🚚</div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#1e293b' }}>No supplier disbursements found</div>
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>
                Supplier payouts recorded against purchase orders will appear here automatically.
              </div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.84rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 700 }}>
                    <th style={{ padding: '0.85rem 1rem' }}>Voucher #</th>
                    <th style={{ padding: '0.85rem 1rem' }}>Date</th>
                    <th style={{ padding: '0.85rem 1rem' }}>Recorded By</th>
                    <th style={{ padding: '0.85rem 1rem' }}>Payment Method</th>
                    <th style={{ padding: '0.85rem 1rem' }}>Reference #</th>
                    <th style={{ padding: '0.85rem 1rem', textAlign: 'right' }}>Amount Paid</th>
                    <th style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSupplierPayments.map((p) => (
                    <tr
                      key={p.id}
                      style={{ borderBottom: '1px solid #f1f5f9', transition: 'background 0.15s' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f8faff')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <td style={{ padding: '0.85rem 1rem', fontFamily: 'monospace', fontWeight: 700, color: '#0f172a' }}>
                        {p.paymentNumber}
                      </td>
                      <td style={{ padding: '0.85rem 1rem', color: '#64748b' }}>
                        {p.date}
                      </td>
                      <td style={{ padding: '0.85rem 1rem', color: '#475569' }}>
                        {p.recordedBy || 'Manager'}
                      </td>
                      <td style={{ padding: '0.85rem 1rem' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '0.2rem 0.55rem',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          background: p.method === 'cash' ? '#ecfdf5' : '#eff6ff',
                          color: p.method === 'cash' ? '#047857' : '#1d4ed8',
                          border: `1px solid ${p.method === 'cash' ? '#a7f3d0' : '#bfdbfe'}`,
                        }}>
                          {p.method}
                        </span>
                      </td>
                      <td style={{ padding: '0.85rem 1rem', color: '#64748b' }}>
                        {p.reference || '—'}
                      </td>
                      <td style={{ padding: '0.85rem 1rem', textAlign: 'right', fontWeight: 800, color: '#e11d48', fontFamily: 'monospace', fontSize: '0.9rem' }}>
                        {fmtMoney(p.amountMinor)}
                      </td>
                      <td style={{ padding: '0.85rem 1rem', textAlign: 'center' }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '0.2rem 0.55rem',
                          borderRadius: '6px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          background: '#f0fdf4',
                          color: '#16a34a',
                          border: '1px solid #bbf7d0',
                        }}>
                          ✓ Settled
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
