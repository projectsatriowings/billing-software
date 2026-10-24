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
  const [cashierEmployeeId, setCashierEmployeeId] = useState('');
  const [cashierEmail, setCashierEmail] = useState('');
  const [cashierPassword, setCashierPassword] = useState('Cashier123!');
  const [showPassword, setShowPassword] = useState(false);
  const [cashierCounter, setCashierCounter] = useState('COUNTER-1');
  const [cashierError, setCashierError] = useState('');
  const [isSubmittingCashier, setIsSubmittingCashier] = useState(false);

  // Credentials One-Time Display / WhatsApp Share State
  const [createdCashierCredentials, setCreatedCashierCredentials] = useState<{
    name: string;
    employeeId: string;
    email: string;
    initialPassword: string;
    branch: string;
    counter: string;
    loginUrl: string;
    isReset?: boolean;
  } | null>(null);
  const [copiedCredentials, setCopiedCredentials] = useState(false);

  // Reset Cashier Password State
  const [resetCashierUser, setResetCashierUser] = useState<any | null>(null);
  const [resetPasswordVal, setResetPasswordVal] = useState('Cashier123!');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [isSubmittingReset, setIsSubmittingReset] = useState(false);
  const [resetError, setResetError] = useState('');

  const generateEmployeeId = () => {
    const num = Math.floor(100 + Math.random() * 900);
    setCashierEmployeeId(`CSH-${num}`);
  };

  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
    let res = '';
    for (let i = 0; i < 10; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setCashierPassword(res);
  };

  const getWhatsAppMessage = (creds: {
    name: string;
    employeeId: string;
    email: string;
    initialPassword: string;
    branch: string;
    counter: string;
    loginUrl: string;
    isReset?: boolean;
  }) => {
    const storeName = shop?.name || 'Adaptive Billing Platform';
    return (
`👋 Hello ${creds.name},

${creds.isReset ? `🔑 Your Cashier login credentials for ${storeName} have been reset:` : `🎉 Welcome to ${storeName}! Here are your Cashier login credentials:`}

🆔 Employee ID: ${creds.employeeId}
📧 Sign-in ID / Email: ${creds.email}
🔑 Initial Password: ${creds.initialPassword}
🏪 Branch: ${creds.branch}
🖥️ Counter: ${creds.counter}
🌐 Login URL: ${creds.loginUrl}

⚠️ Security Reminder: Please sign in at the Cashier portal and change your password upon first login.`
    );
  };

  const handleCopyCredentials = (creds: any) => {
    const text = getWhatsAppMessage(creds);
    navigator.clipboard.writeText(text);
    setCopiedCredentials(true);
    setTimeout(() => setCopiedCredentials(false), 3000);
  };

  const handleOpenWhatsApp = (creds: any) => {
    const text = getWhatsAppMessage(creds);
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

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
      const empId = cashierEmployeeId.trim().toUpperCase() || ('CSH-' + Math.floor(100 + Math.random() * 900));
      const res = await api<any>('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          name: cashierName.trim(),
          employeeId: empId,
          email: cashierEmail.trim() || undefined,
          password: cashierPassword,
          role: 'cashier',
          assignedLocation: selectedBranchCode,
          assignedCounter: cashierCounter,
          allowedLocations: [selectedBranchCode],
        }),
      });

      // Save credentials for one-time display and WhatsApp sharing
      setCreatedCashierCredentials({
        name: cashierName.trim(),
        employeeId: res.employeeId || res.id || empId,
        email: res.email || (cashierEmail.trim() || `${empId.toLowerCase()}@billing.local`),
        initialPassword: cashierPassword,
        branch: selectedBranchCode,
        counter: cashierCounter,
        loginUrl: window.location.origin,
      });
      setCopiedCredentials(false);

      setShowAddCashierModal(false);
      setCashierName('');
      setCashierEmployeeId('');
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
  };

  const handleResetCashierPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetCashierUser) return;
    setResetError('');
    setIsSubmittingReset(true);
    try {
      await api(`/api/users/${resetCashierUser.id}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword: resetPasswordVal }),
      });

      setCreatedCashierCredentials({
        name: resetCashierUser.name,
        employeeId: resetCashierUser.id,
        email: resetCashierUser.email,
        initialPassword: resetPasswordVal,
        branch: selectedBranchCode,
        counter: resetCashierUser.counter || resetCashierUser.assignedCounter || 'COUNTER-1',
        loginUrl: window.location.origin,
        isReset: true,
      });
      setCopiedCredentials(false);
      setResetCashierUser(null);
    } catch (err: any) {
      setResetError(err.message || 'Failed to reset cashier password');
    } finally {
      setIsSubmittingReset(false);
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.5rem', maxHeight: '250px', overflowY: 'auto' }}>
            {branchSummary?.staff && branchSummary.staff.length > 0 ? (
              branchSummary.staff.map((st) => (
                <div key={st.id} style={{ padding: '0.65rem 0.85rem', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <div style={{ width: '28px', height: '28px', borderRadius: '6px', background: '#e0e7ff', color: '#4338ca', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.8rem' }}>
                      💳
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 800, color: '#0f172a' }}>{st.name}</span>
                        <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', padding: '1px 5px', background: '#eef2ff', color: '#4338ca', borderRadius: '4px', fontWeight: 700 }}>
                          ID: {st.id}
                        </span>
                      </div>
                      <div style={{ color: '#64748b', fontSize: '0.72rem', marginTop: '2px' }}>
                        <span>{st.email}</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ fontFamily: 'monospace', color: '#0369a1', fontWeight: 700, background: '#e0f2fe', padding: '2px 6px', borderRadius: '4px', fontSize: '0.72rem' }}>
                      {st.counter || 'COUNTER-1'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setResetCashierUser(st);
                        setResetPasswordVal('Cashier123!');
                        setResetError('');
                        setShowResetPassword(false);
                      }}
                      title="Reset Cashier Password"
                      style={{
                        padding: '3px 7px',
                        background: '#ffffff',
                        border: '1px solid #cbd5e1',
                        borderRadius: '6px',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        color: '#475569',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                      }}
                    >
                      🔑 Reset PW
                    </button>
                  </div>
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
              maxWidth: '460px',
              width: '100%',
              padding: '1.75rem',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
              border: '1px solid #e2e8f0',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '0.75rem', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.25rem' }}>💳</span>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                  Create Cashier Account
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddCashierModal(false)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.1rem', cursor: 'pointer', fontWeight: 700 }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '0.6rem 0.85rem', background: '#eff6ff', borderRadius: '8px', border: '1px solid #bfdbfe', marginTop: '0.85rem', fontSize: '0.75rem', color: '#1e40af' }}>
              🏪 Assigned to branch: <strong>{selectedBranchCode}</strong> ({shop?.name || 'Central Store'})
            </div>

            {cashierError && (
              <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: '#fff1f2', color: '#be123c', border: '1px solid #fecdd3', borderRadius: '8px', fontSize: '0.8rem' }}>
                {cashierError}
              </div>
            )}

            <form onSubmit={handleCreateCashier} style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  Cashier Employee Full Name <span style={{ color: '#ef4444' }}>*</span>
                </label>
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155' }}>
                    Employee ID <span style={{ color: '#64748b', fontWeight: 500 }}>(Login Identifier)</span>
                  </label>
                  <button
                    type="button"
                    onClick={generateEmployeeId}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#4f46e5',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    ⚡ Auto-Generate
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="e.g. CSH-101 (Leave empty to auto-generate)"
                  value={cashierEmployeeId}
                  onChange={(e) => setCashierEmployeeId(e.target.value.toUpperCase())}
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

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  Email ID <span style={{ color: '#64748b', fontWeight: 500 }}>(Optional — Employee ID can be used to log in)</span>
                </label>
                <input
                  type="email"
                  placeholder="e.g. ramesh@store.com (optional)"
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155' }}>
                    Initial Password <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={generateRandomPassword}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#4f46e5',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      🎲 Generate
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#64748b',
                        fontSize: '0.72rem',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
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
                <span style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '2px', display: 'block' }}>
                  Minimum 8 characters. Stored securely hashed using scrypt.
                </span>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                  Assigned POS Counter <span style={{ color: '#ef4444' }}>*</span>
                </label>
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
                    padding: '0.55rem 1.1rem',
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
                    padding: '0.55rem 1.35rem',
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
                  {isSubmittingCashier ? 'Creating...' : 'Create Cashier Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* One-Time Credentials & WhatsApp Sharing Modal */}
      {createdCashierCredentials && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(5px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '1rem',
          }}
          onClick={() => setCreatedCashierCredentials(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '20px',
              maxWidth: '500px',
              width: '100%',
              padding: '2rem',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              border: '1px solid #e2e8f0',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
              <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#dcfce7', color: '#16a34a', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', marginBottom: '0.75rem' }}>
                ✓
              </div>
              <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, color: '#0f172a' }}>
                {createdCashierCredentials.isReset ? 'Cashier Password Reset Successfully' : 'Cashier Account Created!'}
              </h3>
              <p style={{ margin: '6px 0 0 0', fontSize: '0.82rem', color: '#64748b' }}>
                Initial credentials are shown <strong>only once</strong>. Copy and send them to the employee via WhatsApp now.
              </p>
            </div>

            {/* Credentials Card */}
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                fontSize: '0.85rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.5rem' }}>
                <span style={{ color: '#64748b', fontWeight: 600 }}>Employee Name:</span>
                <span style={{ fontWeight: 800, color: '#0f172a' }}>{createdCashierCredentials.name}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.5rem' }}>
                <span style={{ color: '#64748b', fontWeight: 600 }}>Employee ID (Sign-in):</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#4338ca', background: '#eef2ff', padding: '2px 8px', borderRadius: '6px' }}>
                  {createdCashierCredentials.employeeId}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.5rem' }}>
                <span style={{ color: '#64748b', fontWeight: 600 }}>Sign-in Email / ID:</span>
                <span style={{ fontWeight: 700, color: '#334155' }}>{createdCashierCredentials.email}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.5rem' }}>
                <span style={{ color: '#64748b', fontWeight: 600 }}>Initial Password:</span>
                <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecdd3', padding: '3px 8px', borderRadius: '6px' }}>
                  {createdCashierCredentials.initialPassword}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.5rem' }}>
                <span style={{ color: '#64748b', fontWeight: 600 }}>Assigned Station:</span>
                <span style={{ fontWeight: 700, color: '#0f172a' }}>
                  {createdCashierCredentials.branch} • {createdCashierCredentials.counter}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#64748b', fontWeight: 600 }}>Login Portal URL:</span>
                <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: '#2563eb' }}>
                  {createdCashierCredentials.loginUrl}
                </span>
              </div>
            </div>

            {/* Security Notice */}
            <div style={{ marginTop: '1rem', padding: '0.65rem 0.85rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', fontSize: '0.75rem', color: '#92400e', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>🔒</span>
              <span>
                <strong>Security Guarantee:</strong> Passwords are never stored in plaintext. If lost, use the Reset Password action.
              </span>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginTop: '1.25rem' }}>
              <div style={{ display: 'flex', gap: '0.65rem' }}>
                <button
                  type="button"
                  onClick={() => handleCopyCredentials(createdCashierCredentials)}
                  style={{
                    flex: 1,
                    padding: '0.75rem 1rem',
                    background: copiedCredentials ? '#16a34a' : '#4f46e5',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '10px',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    boxShadow: '0 4px 12px rgba(79, 70, 229, 0.25)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span>{copiedCredentials ? '✓' : '📋'}</span>
                  <span>{copiedCredentials ? 'Copied to Clipboard!' : 'Copy Login Details'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleOpenWhatsApp(createdCashierCredentials)}
                  title="Open WhatsApp Web or App to paste and send"
                  style={{
                    flex: 1,
                    padding: '0.75rem 1rem',
                    background: '#25d366',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '10px',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    boxShadow: '0 4px 12px rgba(37, 211, 102, 0.3)',
                  }}
                >
                  <span style={{ fontSize: '1.1rem' }}>💬</span>
                  <span>Open WhatsApp</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => setCreatedCashierCredentials(null)}
                style={{
                  width: '100%',
                  padding: '0.65rem',
                  background: '#f1f5f9',
                  color: '#475569',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Done / Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Cashier Password Modal */}
      {resetCashierUser && (
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
          onClick={() => setResetCashierUser(null)}
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '0.75rem', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.25rem' }}>🔑</span>
                <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>
                  Reset Cashier Password
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setResetCashierUser(null)}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.1rem', cursor: 'pointer', fontWeight: 700 }}
              >
                ✕
              </button>
            </div>

            <p style={{ margin: '8px 0 0 0', fontSize: '0.82rem', color: '#64748b' }}>
              Reset password for <strong>{resetCashierUser.name}</strong> ({resetCashierUser.id}).
            </p>

            {resetError && (
              <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: '#fff1f2', color: '#be123c', border: '1px solid #fecdd3', borderRadius: '8px', fontSize: '0.8rem' }}>
                {resetError}
              </div>
            )}

            <form onSubmit={handleResetCashierPassword} style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155' }}>
                    New Initial Password <span style={{ color: '#ef4444' }}>*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowResetPassword(!showResetPassword)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#4f46e5',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {showResetPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <input
                  type={showResetPassword ? 'text' : 'password'}
                  required
                  value={resetPasswordVal}
                  onChange={(e) => setResetPasswordVal(e.target.value)}
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
                <span style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '3px', display: 'block' }}>
                  New password will be securely hashed. You can copy details to WhatsApp right after saving.
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid #f1f5f9' }}>
                <button
                  type="button"
                  onClick={() => setResetCashierUser(null)}
                  style={{
                    padding: '0.55rem 1rem',
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
                  disabled={isSubmittingReset}
                  style={{
                    padding: '0.55rem 1.35rem',
                    background: '#4f46e5',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    opacity: isSubmittingReset ? 0.6 : 1,
                    boxShadow: '0 2px 8px rgba(79, 70, 229, 0.3)',
                  }}
                >
                  {isSubmittingReset ? 'Updating...' : 'Save & Share Credentials'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
