import React, { useState, useEffect } from 'react';
import {
  type User,
  type Shop,
  type Shift,
  type ShiftSummary,
  type CashMovement,
  fetchActiveShift,
  fetchShiftDetails,
} from '../../api.ts';
import { formatMoney } from '../../../../shared/shifts.ts';
import { OpenShiftModal } from '../shifts/OpenShiftModal.tsx';
import { CashMovementModal } from '../shifts/CashMovementModal.tsx';
import { CloseShiftModal } from '../shifts/CloseShiftModal.tsx';
import { ShiftClosingReportModal } from '../shifts/ShiftClosingReportModal.tsx';

interface ShiftPaymentItem {
  id: string;
  invoiceId?: string;
  invoiceNumber?: string;
  method: string;
  amountMinor: number;
  createdAt: string;
}

interface CashierDashboardProps {
  user: User;
  shop: Shop | null;
  onNavigateToPos: () => void;
  onNavigateToShifts?: () => void;
}

export const CashierDashboard: React.FC<CashierDashboardProps> = ({
  user,
  shop,
  onNavigateToPos,
  onNavigateToShifts,
}) => {
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [payments, setPayments] = useState<ShiftPaymentItem[]>([]);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Modals
  const [isOpenModalOpen, setIsOpenModalOpen] = useState(false);
  const [isMovementModalOpen, setIsMovementModalOpen] = useState(false);
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [closingReportShiftId, setClosingReportShiftId] = useState<string | null>(null);

  const assignedBranch = user.assignedLocation || 'MAIN';
  const assignedCounter = user.assignedCounter || 'COUNTER-1';

  const loadShiftData = async () => {
    setLoading(true);
    try {
      const res = await fetchActiveShift();
      setActiveShift(res.activeShift);
      if (res.activeShift) {
        const details = await fetchShiftDetails(res.activeShift.id);
        setSummary((details as any).summary || res.activeShift.summary || null);
        setPayments(details.payments || []);
        setMovements(details.movements || []);
      } else {
        setSummary(null);
        setPayments([]);
        setMovements([]);
      }
    } catch (err) {
      console.error('Failed to load cashier shift data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadShiftData();
  }, []);

  const handleOpenSuccess = (shift: Shift) => {
    setActiveShift(shift);
    loadShiftData();
  };

  const handleCloseSuccess = (shift: Shift) => {
    setActiveShift(null);
    setClosingReportShiftId(shift.id);
    loadShiftData();
  };

  const handleMovementSuccess = () => {
    loadShiftData();
  };

  // Payment breakdown helpers
  const cashSalesMinor = summary?.paymentMethods?.find((m) => m.method.toLowerCase() === 'cash')?.amountMinor || summary?.cashSalesMinor || 0;
  const upiSalesMinor = summary?.paymentMethods?.find((m) => m.method.toLowerCase() === 'upi')?.amountMinor || 0;
  const cardSalesMinor = summary?.paymentMethods?.find((m) => m.method.toLowerCase() === 'card')?.amountMinor || 0;
  const otherSalesMinor = (summary?.paymentMethods || [])
    .filter((m) => !['cash', 'upi', 'card'].includes(m.method.toLowerCase()))
    .reduce((acc, curr) => acc + curr.amountMinor, 0);
  const totalTransactions = summary?.transactionsCount || payments.length;

  // Duration helper
  const getElapsedDuration = (openedAtStr: string) => {
    const start = new Date(openedAtStr).getTime();
    const now = Date.now();
    const diffMins = Math.max(0, Math.floor((now - start) / 60000));
    const hrs = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    if (hrs === 0) return `${mins}m`;
    return `${hrs}h ${mins}m`;
  };

  return (
    <div className="role-dashboard cashier-dashboard" style={{ padding: '1.5rem', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Top Banner / Cashier Station Identity */}
      <div
        style={{
          background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          borderRadius: '16px',
          padding: '1.5rem 2rem',
          color: '#ffffff',
          marginBottom: '1.5rem',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '1rem',
          boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.3)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '14px',
              background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '28px',
              boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)',
            }}
          >
            💳
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
              <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
                Cashier Terminal: {user.name}
              </h1>
              <span
                style={{
                  background: 'rgba(59, 130, 246, 0.2)',
                  color: '#93c5fd',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                  padding: '2px 10px',
                  borderRadius: '999px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                }}
              >
                CASHIER
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', color: '#94a3b8', fontSize: '0.875rem' }}>
              <span>
                🏪 <strong>Branch:</strong> {assignedBranch}
              </span>
              <span>•</span>
              <span>
                🖥️ <strong>Counter:</strong> {assignedCounter}
              </span>
              <span>•</span>
              <span>🏢 {shop?.name || 'Central Store'}</span>
            </div>
          </div>
        </div>

        {/* Big POS Trigger Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            type="button"
            onClick={onNavigateToPos}
            style={{
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '12px',
              padding: '0.875rem 1.75rem',
              fontSize: '1.05rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)',
              transition: 'all 0.2s ease',
            }}
          >
            <span>🛒 Start Billing / Launch POS</span>
            <span
              style={{
                background: 'rgba(255, 255, 255, 0.25)',
                padding: '2px 8px',
                borderRadius: '6px',
                fontSize: '0.75rem',
              }}
            >
              F1
            </span>
          </button>
        </div>
      </div>

      {/* Main Grid: Shift Management + Live Status */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.8fr) minmax(0, 1.2fr)', gap: '1.5rem', marginBottom: '1.5rem' }}>
        {/* Left Column: Shift Register Status */}
        <div
          style={{
            background: '#ffffff',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            padding: '1.5rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ fontSize: '1.25rem' }}>💵</span>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#0f172a' }}>
                Cash Register & Shift Status
              </h2>
            </div>
            {activeShift ? (
              <span
                style={{
                  background: '#dcfce7',
                  color: '#15803d',
                  padding: '4px 12px',
                  borderRadius: '999px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', display: 'inline-block' }}></span>
                ACTIVE SHIFT #{activeShift.shiftNumber}
              </span>
            ) : (
              <span
                style={{
                  background: '#fef2f2',
                  color: '#b91c1c',
                  padding: '4px 12px',
                  borderRadius: '999px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                }}
              >
                ● REGISTER CLOSED
              </span>
            )}
          </div>

          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>Loading shift state...</div>
          ) : activeShift && summary ? (
            <div>
              {/* Active Shift Timing & Duration Banner */}
              <div
                style={{
                  background: '#f8fafc',
                  borderRadius: '12px',
                  padding: '1rem',
                  marginBottom: '1.25rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  border: '1px solid #e2e8f0',
                }}
              >
                <div>
                  <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 600 }}>
                    Shift Opened At
                  </div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#1e293b' }}>
                    {new Date(activeShift.openedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    {' '}• {new Date(activeShift.openedAt).toLocaleDateString('en-IN')}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', fontWeight: 600 }}>
                    Running Duration
                  </div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#2563eb' }}>
                    ⏱️ {getElapsedDuration(activeShift.openedAt)}
                  </div>
                </div>
              </div>

              {/* Key Cash Register Figures */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.25rem' }}>
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', padding: '1rem' }}>
                  <div style={{ fontSize: '0.75rem', color: '#166534', fontWeight: 600, textTransform: 'uppercase' }}>
                    Live Drawer Cash
                  </div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#15803d', marginTop: '4px' }}>
                    {formatMoney(summary.expectedCashMinor)}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#166534', marginTop: '4px' }}>
                    Float + In - Out + Cash Sales
                  </div>
                </div>

                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '12px', padding: '1rem' }}>
                  <div style={{ fontSize: '0.75rem', color: '#1e40af', fontWeight: 600, textTransform: 'uppercase' }}>
                    Opening Float
                  </div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#1d4ed8', marginTop: '4px' }}>
                    {formatMoney(activeShift.openingCashMinor)}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#1e40af', marginTop: '4px' }}>
                    Starting float amount
                  </div>
                </div>

                <div style={{ background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: '12px', padding: '1rem' }}>
                  <div style={{ fontSize: '0.75rem', color: '#6b21a8', fontWeight: 600, textTransform: 'uppercase' }}>
                    Total Sales This Shift
                  </div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#7e22ce', marginTop: '4px' }}>
                    {formatMoney(summary.totalSalesBilledMinor || 0)}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: '#6b21a8', marginTop: '4px' }}>
                    {totalTransactions} bills generated
                  </div>
                </div>
              </div>

              {/* Cash Controls: In/Out and Close */}
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => setIsMovementModalOpen(true)}
                  style={{
                    flex: 1,
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '10px',
                    padding: '0.75rem 1rem',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    color: '#334155',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  <span>💸 Record Cash In / Out</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsCloseModalOpen(true)}
                  style={{
                    background: '#fee2e2',
                    border: '1px solid #fca5a5',
                    borderRadius: '10px',
                    padding: '0.75rem 1.25rem',
                    fontWeight: 700,
                    fontSize: '0.9rem',
                    color: '#991b1b',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span>🔒 End & Close Shift</span>
                </button>
              </div>
            </div>
          ) : (
            /* Closed Shift State */
            <div
              style={{
                textAlign: 'center',
                padding: '2.5rem 1.5rem',
                background: '#fafafa',
                borderRadius: '12px',
                border: '2px dashed #e2e8f0',
              }}
            >
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🛡️</div>
              <h3 style={{ margin: '0 0 0.5rem 0', color: '#1e293b', fontSize: '1.2rem', fontWeight: 700 }}>
                No Active Shift Register Open
              </h3>
              <p style={{ color: '#64748b', fontSize: '0.9rem', maxWidth: '420px', margin: '0 auto 1.5rem auto' }}>
                Open a shift register for <strong>{assignedBranch}</strong> ({assignedCounter}) with an initial cash float before starting your billing operations.
              </p>
              <button
                type="button"
                onClick={() => setIsOpenModalOpen(true)}
                style={{
                  background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.875rem 2rem',
                  fontSize: '1rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)',
                }}
              >
                ✨ Open Cashier Shift Register
              </button>
            </div>
          )}
        </div>

        {/* Right Column: Shift Sales by Payment Method */}
        <div
          style={{
            background: '#ffffff',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            padding: '1.5rem',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ fontSize: '1.25rem' }}>📊</span>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#0f172a' }}>
                Sales by Payment Mode
              </h2>
            </div>
            {summary && (
              <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                {totalTransactions} transactions
              </span>
            )}
          </div>

          {activeShift && summary ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', flex: 1, justifyContent: 'center' }}>
              {/* Cash Sales */}
              <div
                style={{
                  background: '#f8fafc',
                  borderRadius: '10px',
                  padding: '0.875rem 1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderLeft: '4px solid #10b981',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ fontSize: '1.2rem' }}>💵</span>
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1e293b' }}>Cash Sales</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Direct in drawer</div>
                  </div>
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>
                  {formatMoney(cashSalesMinor)}
                </div>
              </div>

              {/* UPI Sales */}
              <div
                style={{
                  background: '#f8fafc',
                  borderRadius: '10px',
                  padding: '0.875rem 1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderLeft: '4px solid #3b82f6',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ fontSize: '1.2rem' }}>📱</span>
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1e293b' }}>UPI / QR Pay</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Instant bank transfer</div>
                  </div>
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>
                  {formatMoney(upiSalesMinor)}
                </div>
              </div>

              {/* Card Sales */}
              <div
                style={{
                  background: '#f8fafc',
                  borderRadius: '10px',
                  padding: '0.875rem 1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderLeft: '4px solid #8b5cf6',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ fontSize: '1.2rem' }}>💳</span>
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1e293b' }}>Card / POS Swipe</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Debit / Credit cards</div>
                  </div>
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>
                  {formatMoney(cardSalesMinor)}
                </div>
              </div>

              {/* Other / Khata / Bank */}
              <div
                style={{
                  background: '#f8fafc',
                  borderRadius: '10px',
                  padding: '0.875rem 1rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderLeft: '4px solid #f59e0b',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ fontSize: '1.2rem' }}>📑</span>
                  <div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1e293b' }}>Other / Khata Credit</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Bank transfer or credit ledger</div>
                  </div>
                </div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>
                  {formatMoney(otherSalesMinor)}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: '#94a3b8', margin: 'auto', padding: '2rem' }}>
              Open a shift to view live sales distribution by payment method.
            </div>
          )}
        </div>
      </div>

      {/* Bottom Section: Recent Shift Payments & Cash Movements */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          padding: '1.5rem',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: '#0f172a' }}>
              Current Shift Activity Log
            </h2>
            <p style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '0.85rem' }}>
              Real-time feed of invoices, payments, and drawer movements for Counter {assignedCounter}
            </p>
          </div>
          {onNavigateToShifts && (
            <button
              type="button"
              onClick={onNavigateToShifts}
              style={{
                background: 'transparent',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                padding: '6px 14px',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: '#475569',
                cursor: 'pointer',
              }}
            >
              View Full Shifts Ledger →
            </button>
          )}
        </div>

        {payments.length === 0 && movements.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#94a3b8' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🧾</div>
            <div style={{ fontWeight: 600, color: '#64748b' }}>No transactions recorded in this shift yet.</div>
            <div style={{ fontSize: '0.85rem', marginTop: '4px' }}>Click "Start Billing / Launch POS" above to issue your first invoice!</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #f1f5f9', color: '#64748b' }}>
                  <th style={{ padding: '0.75rem 1rem' }}>Type</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Time</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Reference / Details</th>
                  <th style={{ padding: '0.75rem 1rem' }}>Method / Category</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {/* Payments */}
                {payments.map((p) => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span
                        style={{
                          background: '#ecfdf5',
                          color: '#065f46',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                        }}
                      >
                        BILL SALE
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>
                      {new Date(p.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#1e293b' }}>
                      {p.invoiceNumber ? `Invoice #${p.invoiceNumber}` : `Payment #${p.id.slice(0, 8)}`}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textTransform: 'uppercase', color: '#475569', fontSize: '0.8rem' }}>
                      {p.method}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: '#10b981' }}>
                      +{formatMoney(p.amountMinor)}
                    </td>
                  </tr>
                ))}

                {/* Movements */}
                {movements.map((m) => (
                  <tr key={m.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span
                        style={{
                          background: m.movementType === 'cash_in' ? '#eff6ff' : '#fef2f2',
                          color: m.movementType === 'cash_in' ? '#1e40af' : '#991b1b',
                          padding: '2px 8px',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                        }}
                      >
                        {m.movementType === 'cash_in' ? 'CASH IN' : 'CASH OUT'}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#64748b' }}>
                      {new Date(m.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#334155' }}>
                      {m.reason || 'Drawer Cash Movement'}
                      {m.notes && <span style={{ color: '#94a3b8', fontSize: '0.75rem', marginLeft: '6px' }}>({m.notes})</span>}
                    </td>
                    <td style={{ padding: '0.75rem 1rem', color: '#64748b', fontSize: '0.8rem' }}>
                      DRAWER FLOAT
                    </td>
                    <td
                      style={{
                        padding: '0.75rem 1rem',
                        textAlign: 'right',
                        fontWeight: 700,
                        color: m.movementType === 'cash_in' ? '#2563eb' : '#dc2626',
                      }}
                    >
                      {m.movementType === 'cash_in' ? '+' : '-'}{formatMoney(m.amountMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Open Shift */}
      {isOpenModalOpen && (
        <OpenShiftModal
          isOpen={isOpenModalOpen}
          onClose={() => setIsOpenModalOpen(false)}
          onSuccess={handleOpenSuccess}
          userName={user.name}
          userRole={user.role}
          defaultLocation={assignedBranch}
          defaultCounter={assignedCounter}
        />
      )}

      {/* Modal: Cash In / Out */}
      {isMovementModalOpen && activeShift && (
        <CashMovementModal
          isOpen={isMovementModalOpen}
          onClose={() => setIsMovementModalOpen(false)}
          onSuccess={handleMovementSuccess}
          activeShift={activeShift}
        />
      )}

      {/* Modal: Close Shift */}
      {isCloseModalOpen && activeShift && summary && (
        <CloseShiftModal
          isOpen={isCloseModalOpen}
          onClose={() => setIsCloseModalOpen(false)}
          onSuccess={handleCloseSuccess}
          activeShift={activeShift}
          summary={summary}
        />
      )}

      {/* Modal: Day-End Closing Report */}
      {closingReportShiftId && (
        <ShiftClosingReportModal
          shiftId={closingReportShiftId}
          isOpen={!!closingReportShiftId}
          onClose={() => setClosingReportShiftId(null)}
          userRole={user.role}
        />
      )}
    </div>
  );
};
