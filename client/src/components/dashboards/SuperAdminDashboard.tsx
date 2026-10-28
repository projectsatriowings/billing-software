import React, { useState, useEffect } from 'react';
import {
  api,
  type User,
  type Shop,
  type DashboardReport,
  type Branch,
  fetchBranches,
  createBranch,
  updateBranch,
  fetchBranchSummary,
  type BranchSummary,
} from '../../api';

interface SuperAdminDashboardProps {
  user: User;
  shop: Shop | null;
  report?: DashboardReport | null;
  onNavigate?: (tab: 'pos' | 'shifts' | 'items' | 'inventory' | 'product-movement' | 'purchases' | 'invoices' | 'customers' | 'suppliers' | 'reports' | 'settings') => void;
  onRefreshReport?: () => void;
}

const formatRupees = (paise: number = 0) => {
  return '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export function SuperAdminDashboard({
  user,
  shop,
  report: propReport,
  onNavigate,
  onRefreshReport,
}: SuperAdminDashboardProps) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [usersList, setUsersList] = useState<User[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [branchSummary, setBranchSummary] = useState<BranchSummary | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'branches' | 'staff'>('overview');
  const [internalReport, setInternalReport] = useState<any>(null);

  // Branch create modal state
  const [showAddBranchModal, setShowAddBranchModal] = useState(false);
  const [newBranchCode, setNewBranchCode] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchAddress, setNewBranchAddress] = useState('');
  const [newBranchPhone, setNewBranchPhone] = useState('');
  const [newBranchManagerId, setNewBranchManagerId] = useState('');
  const [newBranchCounters, setNewBranchCounters] = useState('COUNTER-1, COUNTER-2');
  const [branchError, setBranchError] = useState('');
  const [isSubmittingBranch, setIsSubmittingBranch] = useState(false);

  // Branch edit modal state
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [editBranchCode, setEditBranchCode] = useState('');
  const [editBranchName, setEditBranchName] = useState('');
  const [editBranchAddress, setEditBranchAddress] = useState('');
  const [editBranchPhone, setEditBranchPhone] = useState('');
  const [editBranchActive, setEditBranchActive] = useState(true);
  const [editBranchManagerId, setEditBranchManagerId] = useState('');
  const [editBranchCounters, setEditBranchCounters] = useState<string[]>([]);
  const [newCounterInput, setNewCounterInput] = useState('');
  const [editingCounterIndex, setEditingCounterIndex] = useState<number | null>(null);
  const [editingCounterValue, setEditingCounterValue] = useState('');
  const [editBranchError, setEditBranchError] = useState('');
  const [editCounterError, setEditCounterError] = useState('');
  const [isSavingBranch, setIsSavingBranch] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Staff create modal state
  const [showAddStaffModal, setShowAddStaffModal] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffPassword, setNewStaffPassword] = useState('Staff123!');
  const [newStaffRole, setNewStaffRole] = useState<'manager' | 'cashier' | 'accountant'>('cashier');
  const [newStaffBranch, setNewStaffBranch] = useState('MAIN');
  const [newStaffCounter, setNewStaffCounter] = useState('COUNTER-1');
  const [staffError, setStaffError] = useState('');
  const [isSubmittingStaff, setIsSubmittingStaff] = useState(false);

  const loadBranches = async () => {
    try {
      const res = await fetchBranches();
      setBranches(res.branches || []);
    } catch (err) {
      console.error('Failed to load branches:', err);
    }
  };

  const loadUsers = async () => {
    try {
      const res = await api<{ users: User[] }>('/api/users');
      setUsersList(res.users || []);
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  };

  const loadDashboardReport = async () => {
    try {
      const res = await api<any>('/api/reports/dashboard');
      setInternalReport(res);
    } catch (err) {
      console.error('Failed to load dashboard report:', err);
    }
  };

  useEffect(() => {
    loadBranches();
    loadUsers();
    loadDashboardReport();
  }, []);

  const report = propReport || internalReport;

  const handleOpenBranchDetail = async (branchId: string) => {
    setSelectedBranchId(branchId);
    try {
      const sum = await fetchBranchSummary(branchId);
      setBranchSummary(sum);
    } catch (err) {
      console.error('Failed to load branch summary:', err);
    }
  };

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    setBranchError('');
    setIsSubmittingBranch(true);
    try {
      const counters = newBranchCounters
        .split(',')
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean);

      await createBranch({
        code: newBranchCode.trim().toUpperCase(),
        name: newBranchName.trim(),
        address: newBranchAddress.trim() || null,
        phone: newBranchPhone.trim() || null,
        managerId: newBranchManagerId || null,
        counters: counters.length ? counters : ['COUNTER-1'],
      });

      setShowAddBranchModal(false);
      setNewBranchCode('');
      setNewBranchName('');
      setNewBranchAddress('');
      setNewBranchPhone('');
      setNewBranchManagerId('');
      loadBranches();
      loadDashboardReport();
      onRefreshReport?.();
    } catch (err: any) {
      setBranchError(err.message || 'Failed to create branch');
    } finally {
      setIsSubmittingBranch(false);
    }
  };

  const handleToggleBranchActive = async (branch: Branch) => {
    try {
      await updateBranch(branch.id, { active: !branch.active });
      loadBranches();
      loadDashboardReport();
      onRefreshReport?.();
    } catch (err: any) {
      alert(err.message || 'Failed to update branch status');
    }
  };

  const handleOpenEditBranch = (b: Branch) => {
    setEditingBranch(b);
    setEditBranchCode(b.code);
    setEditBranchName(b.name);
    setEditBranchAddress(b.address || '');
    setEditBranchPhone(b.phone || '');
    setEditBranchActive(Boolean(b.active ?? true));
    setEditBranchManagerId(b.managerId || '');
    setEditBranchCounters(Array.isArray(b.counters) && b.counters.length > 0 ? [...b.counters] : ['COUNTER-1']);
    setNewCounterInput('');
    setEditingCounterIndex(null);
    setEditingCounterValue('');
    setEditBranchError('');
    setEditCounterError('');
  };

  const handleAddCounterToEdit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setEditCounterError('');
    const trimmed = newCounterInput.trim().toUpperCase();
    if (!trimmed) {
      setEditCounterError('Counter name/code cannot be empty.');
      return;
    }
    const sanitized = trimmed.replace(/[^A-Z0-9_\-\s]/g, '').trim();
    if (!sanitized) {
      setEditCounterError('Counter code must contain valid alphanumeric characters.');
      return;
    }
    if (editBranchCounters.some((c) => c.toUpperCase() === sanitized)) {
      setEditCounterError(`Counter "${sanitized}" already exists in this branch.`);
      return;
    }
    setEditBranchCounters((prev) => [...prev, sanitized]);
    setNewCounterInput('');
  };

  const handleStartEditCounter = (index: number) => {
    setEditingCounterIndex(index);
    setEditingCounterValue(editBranchCounters[index] || '');
    setEditCounterError('');
  };

  const handleSaveCounterEdit = (index: number) => {
    setEditCounterError('');
    const trimmed = editingCounterValue.trim().toUpperCase();
    if (!trimmed) {
      setEditCounterError('Counter name cannot be empty.');
      return;
    }
    const sanitized = trimmed.replace(/[^A-Z0-9_\-\s]/g, '').trim();
    if (!sanitized) {
      setEditCounterError('Counter code must contain valid alphanumeric characters.');
      return;
    }
    const isDup = editBranchCounters.some((c, i) => i !== index && c.toUpperCase() === sanitized);
    if (isDup) {
      setEditCounterError(`Counter "${sanitized}" already exists in this branch.`);
      return;
    }
    setEditBranchCounters((prev) => prev.map((c, i) => (i === index ? sanitized : c)));
    setEditingCounterIndex(null);
    setEditingCounterValue('');
  };

  const handleRemoveCounter = (index: number) => {
    setEditCounterError('');
    if (editBranchCounters.length <= 1) {
      setEditCounterError('A branch must have at least one counter. Cannot remove the only counter.');
      return;
    }
    setEditBranchCounters((prev) => prev.filter((_, i) => i !== index));
    if (editingCounterIndex === index) {
      setEditingCounterIndex(null);
      setEditingCounterValue('');
    }
  };

  const handleSaveBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBranch) return;
    setEditBranchError('');
    setEditCounterError('');

    const trimmedName = editBranchName.trim();
    if (!trimmedName) {
      setEditBranchError('Branch Name is required.');
      return;
    }

    const trimmedCode = editBranchCode.trim().toUpperCase().replace(/[^A-Z0-9_\-]/g, '');
    if (!trimmedCode) {
      setEditBranchError('Branch Code must contain alphanumeric characters.');
      return;
    }

    if (editBranchCounters.length === 0) {
      setEditBranchError('A branch must have at least one billing counter.');
      return;
    }

    setIsSavingBranch(true);
    try {
      const updated = await updateBranch(editingBranch.id, {
        code: trimmedCode,
        name: trimmedName,
        address: editBranchAddress.trim() || null,
        phone: editBranchPhone.trim() || null,
        active: editBranchActive,
        managerId: editBranchManagerId || null,
        counters: editBranchCounters,
      });

      if (editBranchManagerId) {
        const mgr = usersList.find((u) => u.id === editBranchManagerId);
        if (mgr) {
          updated.managerName = mgr.name;
        }
      } else {
        updated.managerName = null;
      }

      // Update state immediately without requiring a page refresh
      setBranches((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
      setEditingBranch(null);
      setToastMessage(`Branch "${updated.name}" (${updated.code}) updated successfully!`);
      setTimeout(() => setToastMessage(null), 4000);

      loadBranches();
      loadDashboardReport();
      onRefreshReport?.();
    } catch (err: any) {
      // Keep modal open and preserve entered values
      setEditBranchError(err.message || 'Failed to update branch. Please try again.');
    } finally {
      setIsSavingBranch(false);
    }
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setStaffError('');
    setIsSubmittingStaff(true);
    try {
      await api('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          name: newStaffName.trim(),
          email: newStaffEmail.trim(),
          password: newStaffPassword,
          role: newStaffRole,
          assignedLocation: newStaffBranch,
          assignedCounter: newStaffCounter,
          allowedLocations: [newStaffBranch],
        }),
      });

      setShowAddStaffModal(false);
      setNewStaffName('');
      setNewStaffEmail('');
      setNewStaffPassword('Staff123!');
      loadUsers();
    } catch (err: any) {
      setStaffError(err.message || 'Failed to create staff account');
    } finally {
      setIsSubmittingStaff(false);
    }
  };

  const handleToggleStaffActive = async (u: User) => {
    try {
      await api(`/api/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !u.active }),
      });
      loadUsers();
    } catch (err: any) {
      alert(err.message || 'Failed to update staff status');
    }
  };

  const totalBranches = report?.branchesOverview?.totalBranches ?? branches.length ?? 1;
  const activeBranches = report?.branchesOverview?.activeBranches ?? branches.filter((b) => b.active).length ?? 1;
  const totalCounters = report?.branchesOverview?.totalCounters ?? 1;

  const totalSalesMinor = report?.today?.totalMinor ?? 0;
  const billCount = report?.today?.billCount ?? 0;
  const grossSalesMinor = report?.today?.grossTotalMinor ?? totalSalesMinor;
  const customerCollectionsMinor = report?.today?.customerCollectionsMinor ?? report?.today?.khataCollectionsMinor ?? 0;
  const outstandingDues = report?.outstandingDuesMinor ?? 0;

  const openShifts = report?.shiftsSummary?.openShiftsCount ?? 0;
  const pendingReviews = report?.shiftsSummary?.pendingReviewShiftsCount ?? 0;
  const discrepancies = report?.shiftsSummary?.discrepanciesCount ?? 0;

  return (
    <div style={{ padding: '0.5rem 0', maxWidth: '1440px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Top Banner / Role Identifier */}
      <div
        style={{
          background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 45%, #0f172a 100%)',
          borderRadius: '16px',
          padding: '1.75rem 2rem',
          color: '#ffffff',
          position: 'relative',
          overflow: 'hidden',
          boxShadow: '0 12px 30px -5px rgba(30, 27, 75, 0.35)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', position: 'relative', zIndex: 2 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <span
                style={{
                  background: 'rgba(109, 74, 255, 0.25)',
                  color: '#c4b5fd',
                  border: '1px solid rgba(167, 139, 250, 0.4)',
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
                👑 Company Super Admin
              </span>
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                All Company Branches Access
              </span>
            </div>
            <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.02em' }}>
              {shop?.name || 'Adaptive Billing Platform'}
            </h1>
            <p style={{ margin: '0.35rem 0 0 0', color: '#cbd5e1', fontSize: '0.875rem' }}>
              Consolidated enterprise headquarters: multi-branch telemetry, staff governance, and real-time ledger oversight.
            </p>
          </div>

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
              <span>🛒</span> Launch POS
            </button>
            <button
              type="button"
              onClick={() => setActiveSubTab('branches')}
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
              <span>🌐</span> Branches Hub
            </button>
            <button
              type="button"
              onClick={() => onNavigate?.('reports')}
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
              <span>📊</span> Reports
            </button>
          </div>
        </div>

        {/* Navigation tabs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <button
            type="button"
            onClick={() => { setActiveSubTab('overview'); setSelectedBranchId(null); }}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '8px',
              fontSize: '0.875rem',
              fontWeight: 700,
              cursor: 'pointer',
              border: 'none',
              background: activeSubTab === 'overview' && !selectedBranchId ? '#6d4aff' : 'transparent',
              color: activeSubTab === 'overview' && !selectedBranchId ? '#ffffff' : '#cbd5e1',
              boxShadow: activeSubTab === 'overview' && !selectedBranchId ? '0 4px 12px rgba(109, 74, 255, 0.4)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            🏢 Company Overview
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('branches')}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '8px',
              fontSize: '0.875rem',
              fontWeight: 700,
              cursor: 'pointer',
              border: 'none',
              background: activeSubTab === 'branches' ? '#6d4aff' : 'transparent',
              color: activeSubTab === 'branches' ? '#ffffff' : '#cbd5e1',
              boxShadow: activeSubTab === 'branches' ? '0 4px 12px rgba(109, 74, 255, 0.4)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            🌐 Branches ({branches.length})
          </button>
          <button
            type="button"
            onClick={() => { setActiveSubTab('staff'); setSelectedBranchId(null); }}
            style={{
              padding: '0.5rem 1.25rem',
              borderRadius: '8px',
              fontSize: '0.875rem',
              fontWeight: 700,
              cursor: 'pointer',
              border: 'none',
              background: activeSubTab === 'staff' ? '#6d4aff' : 'transparent',
              color: activeSubTab === 'staff' ? '#ffffff' : '#cbd5e1',
              boxShadow: activeSubTab === 'staff' ? '0 4px 12px rgba(109, 74, 255, 0.4)' : 'none',
              transition: 'all 0.15s ease',
            }}
          >
            👥 Staff & Roles ({usersList.length})
          </button>
        </div>
      </div>

      {/* Main Tab Views */}
      {activeSubTab === 'overview' && !selectedBranchId && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Top Key Performance Metrics Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.25rem' }}>
            {/* 1. Today's Net Sales */}
            <div style={{ background: '#ffffff', borderRadius: '14px', padding: '1.25rem', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Today's Net Sales</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#0f172a', margin: '0.5rem 0' }}>{formatRupees(totalSalesMinor)}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#64748b', borderTop: '1px solid #f1f5f9', paddingTop: '0.5rem' }}>
                <span>{billCount} Invoices</span>
                <span style={{ color: '#059669', fontWeight: 600 }}>Gross: {formatRupees(grossSalesMinor)}</span>
              </div>
            </div>

            {/* 2. Customer Collections & Dues */}
            <div style={{ background: '#ffffff', borderRadius: '14px', padding: '1.25rem', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Customer Collections & Dues</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#059669', margin: '0.5rem 0' }}>{formatRupees(customerCollectionsMinor)}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.5rem' }}>
                <span style={{ color: '#64748b' }}>Outstanding Dues:</span>
                <span style={{ color: '#e11d48', fontWeight: 700 }}>{formatRupees(outstandingDues)}</span>
              </div>
            </div>

            {/* 3. Multi-Branch Operations */}
            <div style={{ background: '#ffffff', borderRadius: '14px', padding: '1.25rem', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Branches & Counters</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#4338ca', margin: '0.5rem 0' }}>
                {activeBranches} <span style={{ fontSize: '0.9rem', fontWeight: 500, color: '#64748b' }}>/ {totalBranches} Active</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#64748b', borderTop: '1px solid #f1f5f9', paddingTop: '0.5rem' }}>
                <span>Total Counters: {totalCounters}</span>
                <span style={{ color: '#4f46e5', fontWeight: 700, cursor: 'pointer' }} onClick={() => setActiveSubTab('branches')}>
                  Manage Branches ➔
                </span>
              </div>
            </div>

            {/* 4. Total GST & Tax Revenue (Pure Enterprise Total) */}
            <div style={{ background: '#ffffff', borderRadius: '14px', padding: '1.25rem', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total GST & Tax Revenue</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 900, color: '#0f172a', margin: '0.5rem 0' }}>
                {formatRupees(report?.today?.gstMinor ?? 0)}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem', borderTop: '1px solid #f1f5f9', paddingTop: '0.5rem' }}>
                <span style={{ color: '#64748b' }}>
                  Taxable: <strong style={{ color: '#0f172a' }}>{formatRupees(report?.today?.taxableMinor ?? 0)}</strong>
                </span>
                <span style={{ color: '#059669', fontWeight: 700 }}>✓ GST Compliant</span>
              </div>
            </div>
          </div>

          {/* Payment Method Breakdown Bar */}
          {report?.paymentBreakdown && report.paymentBreakdown.length > 0 && (
            <div style={{ background: '#ffffff', borderRadius: '16px', padding: '1.25rem 1.5rem', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1e293b' }}>Collections by Payment Instrument</span>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Reconciles cash drawer and electronic settlements</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                {report.paymentBreakdown.map((p: any) => (
                  <div key={p.method} style={{ background: '#f8fafc', borderRadius: '10px', padding: '0.75rem 1rem', border: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>{p.method}</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0f172a', marginTop: '2px' }}>{formatRupees(p.totalMinor)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Branch-wise Sales & Collection Comparison Table */}
          <div style={{ background: '#ffffff', borderRadius: '16px', padding: '1.5rem', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>
                  Branch Performance Comparison
                </h2>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                  Consolidated sales, payment collections, and branch performance across all authorized branches.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddBranchModal(true)}
                style={{
                  background: '#6d4aff',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.6rem 1.25rem',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 4px 12px rgba(109, 74, 255, 0.3)',
                }}
              >
                <span>➕</span> Add Branch
              </button>
            </div>

            {report?.branchComparison && report.branchComparison.length > 0 ? (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      <th style={{ padding: '0.75rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase' }}>Branch Code</th>
                      <th style={{ padding: '0.75rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase' }}>Branch Name</th>
                      <th style={{ padding: '0.75rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', textAlign: 'center' }}>Counters</th>
                      <th style={{ padding: '0.75rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', textAlign: 'right' }}>Today Invoices</th>
                      <th style={{ padding: '0.75rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', textAlign: 'right' }}>Today Sales</th>
                      <th style={{ padding: '0.75rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', textAlign: 'right' }}>Collections</th>
                      <th style={{ padding: '0.75rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', textAlign: 'center' }}>Avg Bill Value</th>
                      <th style={{ padding: '0.75rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', textAlign: 'center' }}>Status</th>
                      <th style={{ padding: '0.75rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.branchComparison.map((b: any) => (
                      <tr key={b.id || b.code} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.875rem 1rem', fontFamily: 'monospace', fontWeight: 800, color: '#1e293b' }}>{b.code}</td>
                        <td style={{ padding: '0.875rem 1rem', fontWeight: 700, color: '#0f172a' }}>{b.name}</td>
                        <td style={{ padding: '0.875rem 1rem', textAlign: 'center' }}>
                          <span style={{ padding: '2px 8px', background: '#f1f5f9', color: '#334155', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 600 }}>
                            {b.countersCount} counters
                          </span>
                        </td>
                        <td style={{ padding: '0.875rem 1rem', textAlign: 'right', color: '#334155', fontWeight: 600 }}>{b.todaySalesCount}</td>
                        <td style={{ padding: '0.875rem 1rem', textAlign: 'right', fontWeight: 800, color: '#0f172a' }}>{formatRupees(b.todaySalesTotalMinor)}</td>
                        <td style={{ padding: '0.875rem 1rem', textAlign: 'right', fontWeight: 700, color: '#059669' }}>{formatRupees(b.todayCollectionsMinor)}</td>
                        <td style={{ padding: '0.875rem 1rem', textAlign: 'center', fontWeight: 600, color: '#475569' }}>
                          {b.todaySalesCount > 0
                            ? formatRupees(Math.round(b.todaySalesTotalMinor / b.todaySalesCount))
                            : '—'}
                        </td>
                        <td style={{ padding: '0.875rem 1rem', textAlign: 'center' }}>
                          <span
                            style={{
                              padding: '2px 8px',
                              borderRadius: '999px',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              background: b.active ? '#ecfdf5' : '#f1f5f9',
                              color: b.active ? '#047857' : '#64748b',
                              border: b.active ? '1px solid #a7f3d0' : '1px solid #e2e8f0',
                            }}
                          >
                            {b.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td style={{ padding: '0.875rem 1rem', textAlign: 'right' }}>
                          <button
                            type="button"
                            onClick={() => handleOpenBranchDetail(b.id)}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#6d4aff',
                              fontSize: '0.8rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                              padding: '4px 8px',
                              borderRadius: '6px',
                            }}
                          >
                            Inspect ➔
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#94a3b8' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🌐</div>
                <div style={{ fontWeight: 600, color: '#64748b' }}>No branches configured yet.</div>
                <div style={{ fontSize: '0.85rem', marginTop: '4px' }}>Click "Add Branch" to create your first multi-branch node.</div>
              </div>
            )}
          </div>

          {/* Low Stock Alerts Across Company */}
          {report?.lowStock && report.lowStock.length > 0 && (
            <div style={{ background: '#ffffff', borderRadius: '16px', padding: '1.5rem', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1.2rem' }}>⚠️</span>
                  <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: '#0f172a' }}>Inventory Alerts Across Company Branches</h3>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate?.('inventory')}
                  style={{ background: 'none', border: 'none', color: '#6d4aff', fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  View Inventory Hub ➔
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
                {report.lowStock.map((item: any) => (
                  <div key={item.id} style={{ padding: '0.75rem 1rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#1e293b' }}>{item.name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>SKU: {item.sku || 'N/A'}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: '1rem', fontWeight: 900, color: '#e11d48' }}>{(item.currentStockMilli / 1000).toFixed(0)}</span>
                      <span style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: '4px' }}>left</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Selected Branch Detail Modal / Inspector */}
      {selectedBranchId && branchSummary && (
        <div style={{ background: '#ffffff', borderRadius: '16px', padding: '1.5rem 2rem', border: '1px solid #c7d2fe', boxShadow: '0 10px 25px rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '1rem', borderBottom: '1px solid #e2e8f0' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span style={{ padding: '3px 8px', background: '#e0e7ff', color: '#3730a3', fontFamily: 'monospace', fontWeight: 800, fontSize: '0.8rem', borderRadius: '6px' }}>
                  {branchSummary.branch.code}
                </span>
                <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: '#0f172a' }}>{branchSummary.branch.name}</h2>
              </div>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>
                {branchSummary.branch.address || 'No physical address configured'} • Phone: {branchSummary.branch.phone || 'N/A'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedBranchId(null)}
              style={{ padding: '0.5rem 1rem', background: '#f1f5f9', border: 'none', color: '#475569', fontSize: '0.8rem', fontWeight: 700, borderRadius: '8px', cursor: 'pointer' }}
            >
              ✕ Close Inspector
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', margin: '1.25rem 0' }}>
            <div style={{ background: '#f8fafc', borderRadius: '12px', padding: '1rem', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Today Sales</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#0f172a', marginTop: '4px' }}>
                {formatRupees(branchSummary.todaySalesTotalMinor)}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>{branchSummary.todaySalesCount} Invoices posted</div>
            </div>

            <div style={{ background: '#f8fafc', borderRadius: '12px', padding: '1rem', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Today Collections</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#059669', marginTop: '4px' }}>
                {formatRupees(branchSummary.todayCollectionsMinor)}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>Cash, UPI & Card collections</div>
            </div>

            <div style={{ background: '#f8fafc', borderRadius: '12px', padding: '1rem', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Active Cashier Shifts</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#4338ca', marginTop: '4px' }}>
                {branchSummary.activeShiftsCount} Active
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '4px' }}>{branchSummary.pendingReviewShiftsCount} shifts awaiting review</div>
            </div>
          </div>

          {/* Active Counters */}
          <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Configured Counters</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {branchSummary.branch.counters.map((c) => (
                <span key={c} style={{ padding: '4px 10px', background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe', fontFamily: 'monospace', fontSize: '0.75rem', fontWeight: 700, borderRadius: '6px' }}>
                  🖥️ {c}
                </span>
              ))}
            </div>
          </div>

          {/* Assigned Staff */}
          <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Assigned Staff at this Branch</div>
            {branchSummary.staff && branchSummary.staff.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
                {branchSummary.staff.map((s) => (
                  <div key={s.id} style={{ padding: '0.75rem', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.75rem' }}>
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{s.name}</div>
                    <div style={{ color: '#64748b' }}>{s.email}</div>
                    <div style={{ marginTop: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ textTransform: 'uppercase', fontWeight: 700, color: '#6d4aff' }}>{s.role}</span>
                      <span style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{s.counter || 'General'}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontStyle: 'italic' }}>No staff explicitly assigned to this branch yet.</div>
            )}
          </div>
        </div>
      )}

      {/* Branches Management SubTab */}
      {activeSubTab === 'branches' && (
        <div style={{ background: '#ffffff', borderRadius: '16px', padding: '1.5rem', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>Branch Configuration & Counters</h2>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>Add, activate, or reassign Store Managers to branches without deleting historical data.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddBranchModal(true)}
              style={{
                background: '#6d4aff',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '0.55rem 1.15rem',
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 4px 12px rgba(109, 74, 255, 0.3)',
              }}
            >
              <span>➕</span> Add New Branch
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem' }}>
            {branches.map((b) => (
              <div key={b.id} style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1.25rem', background: '#fafafa' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', fontWeight: 900, padding: '2px 8px', background: '#e2e8f0', color: '#1e293b', borderRadius: '4px' }}>
                        {b.code}
                      </span>
                      <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>{b.name}</h3>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '4px' }}>
                      {b.address || 'No physical address specified'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={() => handleOpenEditBranch(b)}
                      className="branch-card-edit-btn"
                      style={{
                        padding: '4px 10px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        borderRadius: '6px',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                      title={`Edit ${b.name}`}
                    >
                      <span>✏️</span> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleToggleBranchActive(b)}
                      style={{
                        padding: '4px 10px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        borderRadius: '999px',
                        border: 'none',
                        cursor: 'pointer',
                        background: b.active ? '#dcfce7' : '#f1f5f9',
                        color: b.active ? '#15803d' : '#64748b',
                      }}
                    >
                      {b.active ? 'Active' : 'Disabled'}
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #e2e8f0', fontSize: '0.75rem', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '0.5rem' }}>
                  <div>
                    <span style={{ fontWeight: 600, color: '#64748b' }}>Store Manager:</span>{' '}
                    {b.managerName ? <span style={{ fontWeight: 700, color: '#4338ca' }}>{b.managerName}</span> : <span style={{ color: '#94a3b8' }}>Unassigned</span>}
                  </div>
                  <div style={{ fontFamily: 'monospace', color: '#475569' }}>
                    <span style={{ fontWeight: 600 }}>Counters:</span> {b.counters.join(', ')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Staff Management SubTab */}
      {activeSubTab === 'staff' && (
        <div style={{ background: '#ffffff', borderRadius: '16px', padding: '1.5rem', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>Staff Hierarchy & Counter Assignments</h2>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>Manage Store Managers, Cashiers, and Accountants. Assign each cashier to a specific branch and billing counter.</p>
            </div>
            <button
              type="button"
              onClick={() => setShowAddStaffModal(true)}
              style={{
                background: '#6d4aff',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '0.55rem 1.15rem',
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 4px 12px rgba(109, 74, 255, 0.3)',
              }}
            >
              <span>👤</span> Add Staff Member
            </button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ padding: '0.75rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase' }}>Name & Email</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase' }}>Role</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase' }}>Assigned Branch</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase' }}>Assigned Counter</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', textAlign: 'center' }}>Status</th>
                  <th style={{ padding: '0.75rem 1rem', color: '#64748b', fontWeight: 700, fontSize: '0.75rem', textTransform: 'uppercase', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {usersList.map((u) => (
                  <tr key={u.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <div style={{ fontWeight: 700, color: '#0f172a' }}>{u.name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{u.email}</div>
                    </td>
                    <td style={{ padding: '0.875rem 1rem' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          background: u.role === 'owner' ? '#f3e8ff' : u.role === 'manager' ? '#dbeafe' : u.role === 'cashier' ? '#dcfce7' : '#f1f5f9',
                          color: u.role === 'owner' ? '#7e22ce' : u.role === 'manager' ? '#1d4ed8' : u.role === 'cashier' ? '#15803d' : '#475569',
                        }}
                      >
                        {u.role === 'owner' ? 'Super Admin' : u.role === 'manager' ? 'Store Manager' : u.role}
                      </span>
                    </td>
                    <td style={{ padding: '0.875rem 1rem', fontFamily: 'monospace', fontSize: '0.8rem', fontWeight: 700, color: '#334155' }}>
                      {u.assignedLocation || 'MAIN'}
                    </td>
                    <td style={{ padding: '0.875rem 1rem', fontFamily: 'monospace', fontSize: '0.8rem', color: '#64748b' }}>
                      {u.assignedCounter || 'COUNTER-1'}
                    </td>
                    <td style={{ padding: '0.875rem 1rem', textAlign: 'center' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: '999px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          background: u.active ? '#ecfdf5' : '#f1f5f9',
                          color: u.active ? '#047857' : '#64748b',
                        }}
                      >
                        {u.active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td style={{ padding: '0.875rem 1rem', textAlign: 'right' }}>
                      {u.id !== user.id && (
                        <button
                          type="button"
                          onClick={() => handleToggleStaffActive(u)}
                          style={{
                            background: 'transparent',
                            border: '1px solid #cbd5e1',
                            borderRadius: '6px',
                            padding: '3px 8px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            color: '#475569',
                            cursor: 'pointer',
                          }}
                        >
                          {u.active ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Floating Success Toast */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            top: '1.5rem',
            right: '1.5rem',
            background: '#0f172a',
            color: '#ffffff',
            padding: '0.85rem 1.25rem',
            borderRadius: '10px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            zIndex: 10000,
            fontSize: '0.875rem',
            fontWeight: 600,
            border: '1px solid #334155',
          }}
        >
          <span style={{ fontSize: '1.1rem' }}>✅</span>
          <span>{toastMessage}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              fontSize: '1rem',
              cursor: 'pointer',
              padding: '0 0 0 8px',
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Edit Branch Modal */}
      {editingBranch && (
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
          onClick={() => !isSavingBranch && setEditingBranch(null)}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              maxWidth: '560px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '1.75rem',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              border: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '0.75rem', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <div style={{ width: '34px', height: '34px', borderRadius: '8px', background: '#ede9fe', color: '#6d4aff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}>
                  ✏️
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>Edit Branch & Counters</h3>
                  <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px' }}>
                    Editing branch <strong style={{ color: '#4338ca' }}>{editingBranch.name}</strong> ({editingBranch.code})
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !isSavingBranch && setEditingBranch(null)}
                style={{ background: 'none', border: 'none', fontSize: '1.25rem', color: '#94a3b8', cursor: 'pointer', padding: '4px' }}
                disabled={isSavingBranch}
                aria-label="Close edit modal"
              >
                ✕
              </button>
            </div>

            {/* Error Banner */}
            {editBranchError && (
              <div style={{ padding: '0.65rem 0.85rem', background: '#fff1f2', color: '#be123c', border: '1px solid #fecdd3', borderRadius: '8px', fontSize: '0.825rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span>⚠️</span>
                <span>{editBranchError}</span>
              </div>
            )}

            <form onSubmit={handleSaveBranch} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              {/* Branch Code & Name */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    Branch Code (Unique Identifier) <span style={{ color: '#e11d48' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editBranchCode}
                    onChange={(e) => setEditBranchCode(e.target.value.toUpperCase())}
                    placeholder="e.g. MAIN, GODOWN"
                    style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontFamily: 'monospace', fontSize: '0.875rem', textTransform: 'uppercase', boxSizing: 'border-box' }}
                  />
                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '2px' }}>Used for multi-branch isolation & registers.</div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                    Branch Name <span style={{ color: '#e11d48' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editBranchName}
                    onChange={(e) => setEditBranchName(e.target.value)}
                    placeholder="e.g. City Central Hub"
                    style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.875rem', boxSizing: 'border-box' }}
                  />
                </div>
              </div>

              {/* Physical Address */}
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>Branch Address</label>
                <input
                  type="text"
                  value={editBranchAddress}
                  onChange={(e) => setEditBranchAddress(e.target.value)}
                  placeholder="Street address, City, Pincode"
                  style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.875rem', boxSizing: 'border-box' }}
                />
              </div>

              {/* Contact Phone & Status */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>Contact Phone</label>
                  <input
                    type="text"
                    value={editBranchPhone}
                    onChange={(e) => setEditBranchPhone(e.target.value)}
                    placeholder="Mobile or landline number"
                    style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.875rem', boxSizing: 'border-box' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>Branch Status</label>
                  <select
                    value={editBranchActive ? 'active' : 'inactive'}
                    onChange={(e) => setEditBranchActive(e.target.value === 'active')}
                    style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.875rem', boxSizing: 'border-box', background: '#ffffff' }}
                  >
                    <option value="active">Active (Operational & Billed)</option>
                    <option value="inactive">Inactive (Suspended)</option>
                  </select>
                </div>
              </div>

              {/* Assigned Store Manager */}
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>Assigned Store Manager</label>
                <select
                  value={editBranchManagerId}
                  onChange={(e) => setEditBranchManagerId(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.875rem', boxSizing: 'border-box', background: '#ffffff' }}
                >
                  <option value="">-- No Manager Assigned --</option>
                  {usersList
                    .filter((u) => u.role === 'manager' || u.role === 'owner')
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.role === 'owner' ? 'Owner / Super Admin' : 'Store Manager'}) — {m.email}
                      </option>
                    ))}
                </select>
                <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '2px' }}>
                  Store Managers have operational oversight of shifts, cashiers, and inventory in their assigned branches.
                </div>
              </div>

              {/* Dedicated Counters Section */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span>🖥️</span> Branch Counters ({editBranchCounters.length})
                    </h4>
                    <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                      Terminals belonging to this branch only. Counter numbering is branch-specific.
                    </p>
                  </div>
                </div>

                {editCounterError && (
                  <div style={{ padding: '0.5rem 0.75rem', background: '#fff1f2', color: '#be123c', border: '1px solid #fecdd3', borderRadius: '6px', fontSize: '0.75rem' }}>
                    ⚠️ {editCounterError}
                  </div>
                )}

                {/* Counters list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '170px', overflowY: 'auto' }}>
                  {editBranchCounters.map((cnt, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 10px',
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                      }}
                    >
                      {editingCounterIndex === idx ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1 }}>
                          <input
                            type="text"
                            value={editingCounterValue}
                            onChange={(e) => setEditingCounterValue(e.target.value.toUpperCase())}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleSaveCounterEdit(idx);
                              } else if (e.key === 'Escape') {
                                setEditingCounterIndex(null);
                              }
                            }}
                            autoFocus
                            style={{
                              flex: 1,
                              padding: '4px 8px',
                              fontFamily: 'monospace',
                              fontWeight: 700,
                              fontSize: '0.8rem',
                              border: '1px solid #6d4aff',
                              borderRadius: '6px',
                              outline: 'none',
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveCounterEdit(idx)}
                            style={{ padding: '3px 8px', background: '#10b981', color: '#ffffff', border: 'none', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer' }}
                          >
                            ✓ Save
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCounterIndex(null);
                              setEditCounterError('');
                            }}
                            style={{ padding: '3px 8px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer' }}
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '0.9rem' }}>🖥️</span>
                            <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#1e293b' }}>{cnt}</span>
                            {idx === 0 && (
                              <span style={{ fontSize: '0.65rem', background: '#ede9fe', color: '#6d4aff', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                                Primary
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <button
                              type="button"
                              onClick={() => handleStartEditCounter(idx)}
                              style={{ padding: '3px 7px', background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '4px', fontSize: '0.75rem', color: '#475569', cursor: 'pointer' }}
                              title="Rename counter"
                            >
                              ✏️ Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveCounter(idx)}
                              disabled={editBranchCounters.length <= 1}
                              style={{
                                padding: '3px 7px',
                                background: editBranchCounters.length <= 1 ? '#f8fafc' : '#fee2e2',
                                border: '1px solid ' + (editBranchCounters.length <= 1 ? '#e2e8f0' : '#fca5a5'),
                                borderRadius: '4px',
                                fontSize: '0.75rem',
                                color: editBranchCounters.length <= 1 ? '#94a3b8' : '#b91c1c',
                                cursor: editBranchCounters.length <= 1 ? 'not-allowed' : 'pointer',
                              }}
                              title={editBranchCounters.length <= 1 ? 'A branch must have at least one counter' : 'Remove counter'}
                            >
                              🗑️ Remove
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                {/* Add New Counter Input */}
                <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
                  <input
                    type="text"
                    placeholder="New counter (e.g. COUNTER-2, EXPRESS-1)"
                    value={newCounterInput}
                    onChange={(e) => setNewCounterInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddCounterToEdit();
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: '0.5rem 0.75rem',
                      border: '1px solid #cbd5e1',
                      borderRadius: '8px',
                      fontSize: '0.8rem',
                      fontFamily: 'monospace',
                      textTransform: 'uppercase',
                      background: '#ffffff',
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAddCounterToEdit}
                    style={{
                      padding: '0.5rem 1rem',
                      background: '#4f46e5',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    ➕ Add Counter
                  </button>
                </div>
              </div>

              {/* Form Footer Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid #f1f5f9' }}>
                <button
                  type="button"
                  onClick={() => setEditingBranch(null)}
                  disabled={isSavingBranch}
                  style={{ padding: '0.6rem 1rem', background: '#f1f5f9', border: 'none', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, color: '#475569', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingBranch}
                  style={{
                    padding: '0.6rem 1.35rem',
                    background: '#6d4aff',
                    border: 'none',
                    borderRadius: '8px',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    color: '#ffffff',
                    cursor: isSavingBranch ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 12px rgba(109, 74, 255, 0.3)',
                    opacity: isSavingBranch ? 0.75 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  {isSavingBranch ? 'Saving Changes...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Branch Modal */}
      {showAddBranchModal && (
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
          onClick={() => setShowAddBranchModal(false)}
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
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>Add New Branch</h3>
              <button
                type="button"
                onClick={() => setShowAddBranchModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.2rem', color: '#94a3b8', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {branchError && (
              <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.75rem', background: '#fff1f2', color: '#be123c', border: '1px solid #fecdd3', borderRadius: '8px', fontSize: '0.8rem' }}>
                {branchError}
              </div>
            )}

            <form onSubmit={handleCreateBranch} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', marginTop: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>Branch Code (Unique Identifier)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. NORTH, VELACHERY"
                  value={newBranchCode}
                  onChange={(e) => setNewBranchCode(e.target.value.toUpperCase())}
                  style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontFamily: 'monospace', fontSize: '0.875rem', textTransform: 'uppercase', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>Branch Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. North City Outlet"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.875rem', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>Physical Address</label>
                <input
                  type="text"
                  placeholder="Street, City, Pin"
                  value={newBranchAddress}
                  onChange={(e) => setNewBranchAddress(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.875rem', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>Contact Phone</label>
                <input
                  type="text"
                  placeholder="10-digit mobile number"
                  value={newBranchPhone}
                  onChange={(e) => setNewBranchPhone(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.875rem', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>Assign Store Manager (Optional)</label>
                <select
                  value={newBranchManagerId}
                  onChange={(e) => setNewBranchManagerId(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.875rem', boxSizing: 'border-box', background: '#ffffff' }}
                >
                  <option value="">-- No Manager Assigned --</option>
                  {usersList.filter((u) => u.role === 'manager').map((m) => (
                    <option key={m.id} value={m.id}>{m.name} ({m.email})</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>Configured Billing Counters (Comma-separated)</label>
                <input
                  type="text"
                  placeholder="COUNTER-1, COUNTER-2, EXPRESS"
                  value={newBranchCounters}
                  onChange={(e) => setNewBranchCounters(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.875rem', boxSizing: 'border-box' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid #f1f5f9' }}>
                <button
                  type="button"
                  onClick={() => setShowAddBranchModal(false)}
                  style={{ padding: '0.6rem 1rem', background: '#f1f5f9', border: 'none', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, color: '#475569', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingBranch}
                  style={{ padding: '0.6rem 1.25rem', background: '#6d4aff', border: 'none', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 700, color: '#ffffff', cursor: 'pointer', boxShadow: '0 4px 12px rgba(109, 74, 255, 0.3)' }}
                >
                  {isSubmittingBranch ? 'Creating...' : 'Create Branch Node'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Staff Modal */}
      {showAddStaffModal && (
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
          onClick={() => setShowAddStaffModal(false)}
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
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#0f172a' }}>Add New Staff Member</h3>
              <button
                type="button"
                onClick={() => setShowAddStaffModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.2rem', color: '#94a3b8', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {staffError && (
              <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.75rem', background: '#fff1f2', color: '#be123c', border: '1px solid #fecdd3', borderRadius: '8px', fontSize: '0.8rem' }}>
                {staffError}
              </div>
            )}

            <form onSubmit={handleCreateStaff} style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem', marginTop: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Kumar"
                  value={newStaffName}
                  onChange={(e) => setNewStaffName(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.875rem', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>Email Address (Login Username)</label>
                <input
                  type="email"
                  required
                  placeholder="e.g. ramesh@store.local"
                  value={newStaffEmail}
                  onChange={(e) => setNewStaffEmail(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.875rem', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>Login Password</label>
                <input
                  type="password"
                  required
                  value={newStaffPassword}
                  onChange={(e) => setNewStaffPassword(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.875rem', boxSizing: 'border-box' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>System Role</label>
                <select
                  value={newStaffRole}
                  onChange={(e) => setNewStaffRole(e.target.value as any)}
                  style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.875rem', boxSizing: 'border-box', background: '#ffffff' }}
                >
                  <option value="cashier">Cashier (Counter Billing & Drawer Shifts)</option>
                  <option value="manager">Store Manager (Branch Operations)</option>
                  <option value="accountant">Accountant (Ledgers & GST)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>Assigned Branch</label>
                <select
                  value={newStaffBranch}
                  onChange={(e) => setNewStaffBranch(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.875rem', boxSizing: 'border-box', background: '#ffffff' }}
                >
                  {branches.map((b) => (
                    <option key={b.code} value={b.code}>{b.name} ({b.code})</option>
                  ))}
                </select>
              </div>

              {newStaffRole === 'cashier' && (
                <div>
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>Assigned Billing Counter</label>
                  <input
                    type="text"
                    placeholder="e.g. COUNTER-1, COUNTER-2"
                    value={newStaffCounter}
                    onChange={(e) => setNewStaffCounter(e.target.value)}
                    style={{ width: '100%', padding: '0.6rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '0.875rem', boxSizing: 'border-box' }}
                  />
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '0.5rem', paddingTop: '0.75rem', borderTop: '1px solid #f1f5f9' }}>
                <button
                  type="button"
                  onClick={() => setShowAddStaffModal(false)}
                  style={{ padding: '0.6rem 1rem', background: '#f1f5f9', border: 'none', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, color: '#475569', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingStaff}
                  style={{ padding: '0.6rem 1.25rem', background: '#6d4aff', border: 'none', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 700, color: '#ffffff', cursor: 'pointer', boxShadow: '0 4px 12px rgba(109, 74, 255, 0.3)' }}
                >
                  {isSubmittingStaff ? 'Saving...' : 'Add Staff Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
