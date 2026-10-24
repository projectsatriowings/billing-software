import React, { useState, useEffect } from 'react';
import {
  api,
  type User,
  type Shop,
  type Branch,
  fetchBranches,
  updateBranch,
  fetchBranchSummary,
  type BranchSummary,
} from '../../api';

interface StoreManagerDashboardProps {
  user: User;
  shop: Shop | null;
  onNavigate?: (tab: 'pos' | 'shifts' | 'items' | 'inventory' | 'purchases' | 'invoices' | 'customers' | 'suppliers' | 'reports' | 'settings') => void;
}

const formatRupees = (paise: number = 0) => {
  return '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export function StoreManagerDashboard({
  user,
  shop,
  onNavigate,
}: StoreManagerDashboardProps) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchCode, setSelectedBranchCode] = useState<string>(
    user.assignedLocation || 'MAIN',
  );
  const [branchSummary, setBranchSummary] = useState<BranchSummary | null>(null);
  const [loading, setLoading] = useState(true);

  // Review shift modal
  const [reviewShiftId, setReviewShiftId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);

  // Add counter state
  const [showAddCounterModal, setShowAddCounterModal] = useState(false);
  const [newCounterName, setNewCounterName] = useState('');

  // Add cashier state
  const [showAddCashierModal, setShowAddCashierModal] = useState(false);
  const [cashierName, setCashierName] = useState('');
  const [cashierEmail, setCashierEmail] = useState('');
  const [cashierPassword, setCashierPassword] = useState('Cashier123!');
  const [cashierCounter, setCashierCounter] = useState('COUNTER-1');
  const [cashierError, setCashierError] = useState('');
  const [isSubmittingCashier, setIsSubmittingCashier] = useState(false);

  const loadAuthorizedBranches = async () => {
    try {
      const res = await fetchBranches();
      const list = res.branches || [];
      setBranches(list);

      // Default to first branch if selected not in list
      if (list.length > 0) {
        const found = list.find((b) => b.code === selectedBranchCode);
        const activeBranch = found || list[0];
        setSelectedBranchCode(activeBranch.code);
        loadBranchDetails(activeBranch.id);
      }
    } catch (err) {
      console.error('Failed to load branches:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadBranchDetails = async (branchId: string) => {
    try {
      const sum = await fetchBranchSummary(branchId);
      setBranchSummary(sum);
    } catch (err) {
      console.error('Failed to load branch summary:', err);
    }
  };

  useEffect(() => {
    loadAuthorizedBranches();
  }, []);

  const handleBranchChange = (code: string) => {
    setSelectedBranchCode(code);
    const b = branches.find((item) => item.code === code);
    if (b) {
      loadBranchDetails(b.id);
    }
  };

  const handleApproveShift = async (shiftId: string) => {
    setIsSubmittingReview(true);
    try {
      await api(`/api/shifts/${shiftId}/review`, {
        method: 'POST',
        body: JSON.stringify({ reviewNotes: reviewNotes || 'Approved by Store Manager' }),
      });
      setReviewShiftId(null);
      setReviewNotes('');
      // Reload branch summary
      const currentBranch = branches.find((b) => b.code === selectedBranchCode);
      if (currentBranch) loadBranchDetails(currentBranch.id);
    } catch (err: any) {
      alert(err.message || 'Failed to review shift');
    } finally {
      setIsSubmittingReview(false);
    }
  };

  const handleAddCounter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCounterName.trim() || !branchSummary) return;

    const counter = newCounterName.trim().toUpperCase();
    const updatedCounters = Array.from(new Set([...branchSummary.branch.counters, counter]));

    try {
      await updateBranch(branchSummary.branch.id, {
        counters: updatedCounters,
      });
      setShowAddCounterModal(false);
      setNewCounterName('');
      loadBranchDetails(branchSummary.branch.id);
    } catch (err: any) {
      alert(err.message || 'Failed to add counter');
    }
  };

  const handleCreateCashier = async (e: React.FormEvent) => {
    e.preventDefault();
    setCashierError('');
    setIsSubmittingCashier(true);
    try {
      await api('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          name: cashierName.trim(),
          email: cashierEmail.trim(),
          password: cashierPassword,
          role: 'cashier',
          assignedLocation: selectedBranchCode,
          assignedCounter: cashierCounter,
          allowedLocations: [selectedBranchCode],
        }),
      });

      setShowAddCashierModal(false);
      setCashierName('');
      setCashierEmail('');
      setCashierPassword('Cashier123!');
      // Reload branch summary to show new cashier
      const currentBranch = branches.find((b) => b.code === selectedBranchCode);
      if (currentBranch) loadBranchDetails(currentBranch.id);
    } catch (err: any) {
      setCashierError(err.message || 'Failed to create cashier account');
    } finally {
      setIsSubmittingCashier(false);
    }
  };  if (loading) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: '#64748b', fontSize: '0.9rem' }}>
        Loading authorized branch operations...
      </div>
    );
  }

  const currentBranch = branches.find((b) => b.code === selectedBranchCode) || branches[0];

  return (
    <div style={{ padding: '0.5rem 0', maxWidth: '1440px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Top Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, #1e3a8a 0%, #1e1b4b 50%, #0f172a 100%)',
          borderRadius: '16px',
          padding: '1.75rem 2rem',
          color: '#ffffff',
          position: 'relative',
          overflow: 'hidden',
          boxShadow: '0 12px 30px -5px rgba(30, 58, 138, 0.35)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', position: 'relative', zIndex: 2 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <span
                style={{
                  background: 'rgba(59, 130, 246, 0.25)',
                  color: '#93c5fd',
                  border: '1px solid rgba(96, 165, 250, 0.4)',
                  padding: '3px 12px',
                  borderRadius: '999px',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                🏪 Store Manager Dashboard
              </span>
              <span style={{ fontSize: '0.75rem', color: '#cbd5e1' }}>
                Managing: <strong style={{ color: '#ffffff' }}>{currentBranch?.name || selectedBranchCode}</strong> ({selectedBranchCode})
              </span>
            </div>
            <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.02em' }}>
              {currentBranch?.name || shop?.name || 'Store Branch'}
            </h1>
            <p style={{ margin: '0.35rem 0 0 0', color: '#cbd5e1', fontSize: '0.875rem' }}>
              Branch operations hub: cashier shift monitoring, counter management, and physical inventory reconciliations.
            </p>
          </div>

          {/* Quick Action Navigation */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.6rem' }}>
            <button
              type="button"
              onClick={() => onNavigate?.('pos')}
              style={{
                background: '#059669',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '0.55rem 1.15rem',
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 2px 8px rgba(5, 150, 105, 0.3)',
              }}
            >
              <span>🛒</span> Start POS
            </button>
            <button
              type="button"
              onClick={() => onNavigate?.('shifts')}
              style={{
                background: '#4f46e5',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '0.55rem 1.15rem',
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 2px 8px rgba(79, 70, 229, 0.3)',
              }}
            >
              <span>⏱️</span> Shift Log
            </button>
            <button
              type="button"
              onClick={() => onNavigate?.('inventory')}
              style={{
                background: '#1e293b',
                color: '#e2e8f0',
                border: '1px solid #334155',
                borderRadius: '8px',
                padding: '0.55rem 1.15rem',
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <span>📦</span> Stock Hub
            </button>
          </div>
        </div>

        {/* Branch Selector (if manager has multiple branches assigned) */}
        {branches.length > 1 && (
          <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid rgba(255, 255, 255, 0.1)', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Switch Branch:</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {branches.map((b) => (
                <button
                  key={b.code}
                  type="button"
                  onClick={() => handleBranchChange(b.code)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: '8px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    border: 'none',
                    background: selectedBranchCode === b.code ? '#3b82f6' : 'rgba(255,255,255,0.1)',
                    color: '#ffffff',
                    boxShadow: selectedBranchCode === b.code ? '0 2px 8px rgba(59, 130, 246, 0.4)' : 'none',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {b.name} ({b.code})
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Branch Metrics KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem' }}>
        {/* Today's Branch Sales */}
        <div style={{ background: '#ffffff', borderRadius: '14px', padding: '1.25rem', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Today's Branch Sales</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#0f172a', margin: '0.5rem 0' }}>
            {formatRupees(branchSummary?.todaySalesTotalMinor ?? 0)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#64748b', borderTop: '1px solid #f1f5f9', paddingTop: '0.5rem' }}>
            <span>{branchSummary?.todaySalesCount ?? 0} Invoices</span>
            <span style={{ color: '#059669', fontWeight: 600 }}>Active Counter Sales</span>
          </div>
        </div>

        {/* Collections */}
        <div style={{ background: '#ffffff', borderRadius: '14px', padding: '1.25rem', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Today's Collections</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#059669', margin: '0.5rem 0' }}>
            {formatRupees(branchSummary?.todayCollectionsMinor ?? 0)}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#64748b', borderTop: '1px solid #f1f5f9', paddingTop: '0.5rem' }}>
            <span>Drawer cash & digital settlements</span>
          </div>
        </div>

        {/* Active Cashier Shifts */}
        <div style={{ background: '#ffffff', borderRadius: '14px', padding: '1.25rem', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Open Cashier Shifts</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#4338ca', margin: '0.5rem 0' }}>
            {branchSummary?.activeShiftsCount ?? 0} <span style={{ fontSize: '0.9rem', fontWeight: 500, color: '#64748b' }}>Active</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#64748b', borderTop: '1px solid #f1f5f9', paddingTop: '0.5rem' }}>
            <span>Counters: {branchSummary?.branch?.counters?.length ?? 1}</span>
            <span style={{ color: '#4f46e5', fontWeight: 700, cursor: 'pointer' }} onClick={() => onNavigate?.('shifts')}>
              View ➔
            </span>
          </div>
        </div>

        {/* Shift Reviews & Discrepancies */}
        <div style={{ background: '#ffffff', borderRadius: '14px', padding: '1.25rem', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Shift Reviews</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#0f172a', margin: '0.5rem 0' }}>
            {branchSummary?.pendingReviewShiftsCount ?? 0}{' '}
            <span style={{ fontSize: '0.9rem', fontWeight: 500, color: '#d97706' }}>Pending</span>
          </div>
          <div style={{ fontSize: '0.75rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.5rem' }}>
            {branchSummary && branchSummary.pendingReviewShiftsCount > 0 ? (
              <span style={{ color: '#d97706', fontWeight: 700 }}>⚠️ Requires Manager Approval</span>
            ) : (
              <span style={{ color: '#059669', fontWeight: 600 }}>✓ All closures reviewed</span>
            )}
          </div>
        </div>
      </div>

      {/* Main Grid: Active Shifts & Shift Reviews */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.5rem' }}>
        {/* Active Cashiers & Counters */}
        <div style={{ background: '#ffffff', borderRadius: '16px', padding: '1.25rem 1.5rem', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>Active Cashiers & Counters</h2>
              <p style={{ margin: '3px 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>Live open shifts currently processing billing in this branch.</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate?.('shifts')}
              style={{ background: 'none', border: 'none', fontSize: '0.8rem', fontWeight: 700, color: '#4f46e5', cursor: 'pointer' }}
            >
              Open Shift ➔
            </button>
          </div>

          {branchSummary?.activeShifts && branchSummary.activeShifts.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {branchSummary.activeShifts.map((s) => (
                <div key={s.id} style={{ padding: '0.875rem 1rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ padding: '2px 8px', background: '#e0e7ff', color: '#3730a3', fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 800, borderRadius: '4px' }}>
                        {s.counter}
                      </span>
                      <span style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.9rem' }}>{s.cashierName}</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>
                      Shift: <strong style={{ color: '#334155' }}>{s.shiftNumber}</strong> • Float: {formatRupees(s.openingCashMinor)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ padding: '3px 10px', background: '#dcfce7', color: '#15803d', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      ● Billing Active
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#94a3b8', fontSize: '0.85rem', background: '#f8fafc', borderRadius: '12px', border: '1px dashed #cbd5e1' }}>
              No active cashier shifts right now. Cashiers can log in and open their counter shift.
            </div>
          )}
        </div>

        {/* Closed Shifts Awaiting Manager Review / Discrepancies */}
        <div style={{ background: '#ffffff', borderRadius: '16px', padding: '1.25rem 1.5rem', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>Shift Closures Awaiting Review</h2>
              <p style={{ margin: '3px 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>Confirm cash drawer reconciliations and approve variance notes.</p>
            </div>
          </div>

          {branchSummary?.pendingReviewShifts && branchSummary.pendingReviewShifts.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {branchSummary.pendingReviewShifts.map((s) => (
                <div key={s.id} style={{ padding: '0.875rem 1rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontWeight: 800, color: '#0f172a', fontSize: '0.9rem' }}>{s.cashierName}</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px' }}>
                      Shift {s.shiftNumber} • Closed at: {new Date(s.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div style={{ fontSize: '0.75rem', marginTop: '4px' }}>
                      {s.varianceMinor !== 0 ? (
                        <span style={{ fontWeight: 800, color: '#e11d48' }}>
                          Variance: {formatRupees(s.varianceMinor)}
                        </span>
                      ) : (
                        <span style={{ fontWeight: 700, color: '#059669' }}>✓ Exact balance</span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => { setReviewShiftId(s.id); setReviewNotes(''); }}
                    style={{
                      padding: '0.45rem 1rem',
                      background: '#4f46e5',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      boxShadow: '0 2px 6px rgba(79, 70, 229, 0.3)',
                    }}
                  >
                    Approve ➔
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#94a3b8', fontSize: '0.85rem', background: '#f8fafc', borderRadius: '12px', border: '1px dashed #cbd5e1' }}>
              No shifts awaiting review. All past shifts are reviewed and approved.
            </div>
          )}
        </div>
      </div>

      {/* Branch Management & Staff Section */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.5rem' }}>
        {/* Branch Counters Management */}
        <div style={{ background: '#ffffff', borderRadius: '16px', padding: '1.25rem 1.5rem', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>Branch Counters</h2>
              <p style={{ margin: '3px 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>Configure point-of-sale checkout counters for this branch.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddCounterModal(true)}
              style={{
                padding: '0.45rem 0.9rem',
                background: '#eef2ff',
                color: '#4338ca',
                border: '1px solid #c7d2fe',
                borderRadius: '8px',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              ➕ Add Counter
            </button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem' }}>
            {branchSummary?.branch?.counters?.map((c) => (
              <div key={c} style={{ padding: '0.4rem 0.75rem', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.75rem', fontFamily: 'monospace', fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>🖥️</span> {c}
              </div>
            ))}
          </div>
        </div>

        {/* Branch Cashiers */}
        <div style={{ background: '#ffffff', borderRadius: '16px', padding: '1.25rem 1.5rem', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>Cashiers in this Branch</h2>
              <p style={{ margin: '3px 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>Staff authorized to bill and operate registers at this location.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddCashierModal(true)}
              style={{
                padding: '0.45rem 0.9rem',
                background: '#4f46e5',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                fontSize: '0.75rem',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 2px 6px rgba(79, 70, 229, 0.3)',
              }}
            >
              ➕ Add Cashier
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
            {branchSummary?.staff && branchSummary.staff.length > 0 ? (
              branchSummary.staff.map((st) => (
                <div key={st.id} style={{ padding: '0.6rem 0.75rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                  <div>
                    <span style={{ fontWeight: 800, color: '#0f172a' }}>{st.name}</span>
                    <span style={{ color: '#94a3b8', marginLeft: '6px' }}>({st.email})</span>
                  </div>
                  <span style={{ fontFamily: 'monospace', color: '#4338ca', fontWeight: 700, background: '#eef2ff', padding: '2px 6px', borderRadius: '4px' }}>{st.counter || 'COUNTER-1'}</span>
                </div>
              ))
            ) : (
              <div style={{ textAlign: 'center', padding: '1.5rem', fontSize: '0.8rem', color: '#94a3b8', fontStyle: 'italic' }}>
                No cashiers assigned to this branch yet.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Approve Shift Modal */}
      {reviewShiftId && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem',
          }}
          onClick={() => setReviewShiftId(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              maxWidth: '420px',
              width: '100%',
              padding: '1.75rem',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
              border: '1px solid #e2e8f0',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>Approve Shift Closure</h3>
            <p style={{ margin: '4px 0 1rem 0', fontSize: '0.8rem', color: '#64748b' }}>
              Add your manager sign-off note to confirm drawer physical cash reconciliation.
            </p>

            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>Manager Review Notes</label>
              <textarea
                rows={3}
                placeholder="e.g. Physical cash verified, variance verified against receipts."
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.6rem 0.75rem',
                  border: '1px solid #cbd5e1',
                  borderRadius: '8px',
                  fontSize: '0.85rem',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid #f1f5f9' }}>
              <button
                type="button"
                onClick={() => setReviewShiftId(null)}
                style={{
                  padding: '0.5rem 1rem',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#475569',
                  borderRadius: '8px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmittingReview}
                onClick={() => handleApproveShift(reviewShiftId)}
                style={{
                  padding: '0.5rem 1.25rem',
                  background: '#059669',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  opacity: isSubmittingReview ? 0.6 : 1,
                  boxShadow: '0 2px 8px rgba(5, 150, 105, 0.3)',
                }}
              >
                {isSubmittingReview ? 'Approving...' : 'Confirm Approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Counter Modal */}
      {showAddCounterModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem',
          }}
          onClick={() => setShowAddCounterModal(false)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              maxWidth: '400px',
              width: '100%',
              padding: '1.75rem',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
              border: '1px solid #e2e8f0',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>Add Branch Counter</h3>
            <form onSubmit={handleAddCounter} style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>Counter Identifier</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. COUNTER-3, EXPRESS-1"
                  value={newCounterName}
                  onChange={(e) => setNewCounterName(e.target.value.toUpperCase())}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.75rem',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                    boxSizing: 'border-box',
                    textTransform: 'uppercase',
                  }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid #f1f5f9' }}>
                <button
                  type="button"
                  onClick={() => setShowAddCounterModal(false)}
                  style={{
                    padding: '0.5rem 1rem',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    color: '#475569',
                    borderRadius: '8px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '0.5rem 1.25rem',
                    background: '#4f46e5',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(79, 70, 229, 0.3)',
                  }}
                >
                  Add Counter
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Cashier Modal */}
      {showAddCashierModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem',
          }}
          onClick={() => setShowAddCashierModal(false)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              maxWidth: '440px',
              width: '100%',
              padding: '1.75rem',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
              border: '1px solid #e2e8f0',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '0.75rem', borderBottom: '1px solid #f1f5f9' }}>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                Add Cashier for {selectedBranchCode}
              </h3>
              <button
                type="button"
                onClick={() => setShowAddCashierModal(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.1rem', cursor: 'pointer', fontWeight: 700 }}
              >
                ✕
              </button>
            </div>

            {cashierError && (
              <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: '#fff1f2', color: '#be123c', border: '1px solid #fecdd3', borderRadius: '8px', fontSize: '0.8rem' }}>
                {cashierError}
              </div>
            )}

            <form onSubmit={handleCreateCashier} style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>Cashier Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Kumar"
                  value={cashierName}
                  onChange={(e) => setCashierName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.75rem',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>Email / Sign-in ID</label>
                <input
                  type="email"
                  required
                  placeholder="cashier@store.com"
                  value={cashierEmail}
                  onChange={(e) => setCashierEmail(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.75rem',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>Initial Password</label>
                <input
                  type="password"
                  required
                  value={cashierPassword}
                  onChange={(e) => setCashierPassword(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.75rem',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    fontFamily: 'monospace',
                    fontSize: '0.85rem',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>Assigned Counter</label>
                <select
                  value={cashierCounter}
                  onChange={(e) => setCashierCounter(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.75rem',
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    boxSizing: 'border-box',
                    background: '#ffffff',
                  }}
                >
                  {branchSummary?.branch?.counters?.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem', paddingTop: '1rem', borderTop: '1px solid #f1f5f9' }}>
                <button
                  type="button"
                  onClick={() => setShowAddCashierModal(false)}
                  style={{
                    padding: '0.5rem 1rem',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    color: '#475569',
                    borderRadius: '8px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingCashier}
                  style={{
                    padding: '0.5rem 1.25rem',
                    background: '#4f46e5',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    opacity: isSubmittingCashier ? 0.6 : 1,
                    boxShadow: '0 2px 8px rgba(79, 70, 229, 0.3)',
                  }}
                >
                  {isSubmittingCashier ? 'Creating...' : 'Create Cashier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
