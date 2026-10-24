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
  onNavigate?: (tab: 'pos' | 'shifts' | 'items' | 'inventory' | 'purchases' | 'invoices' | 'customers' | 'suppliers' | 'reports' | 'settings') => void;
  onRefreshReport?: () => void;
}

const formatRupees = (paise: number = 0) => {
  return '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export function SuperAdminDashboard({
  user,
  shop,
  report,
  onNavigate,
  onRefreshReport,
}: SuperAdminDashboardProps) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [usersList, setUsersList] = useState<User[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [branchSummary, setBranchSummary] = useState<BranchSummary | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'branches' | 'staff'>('overview');

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

  useEffect(() => {
    loadBranches();
    loadUsers();
  }, []);

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
      onRefreshReport?.();
    } catch (err: any) {
      alert(err.message || 'Failed to update branch status');
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
  const creditNotesMinor = report?.today?.totalCreditNotesMinor ?? 0;
  const khataCollectionsMinor = report?.today?.khataCollectionsMinor ?? 0;
  const outstandingDues = report?.outstandingDuesMinor ?? 0;

  const openShifts = report?.shiftsSummary?.openShiftsCount ?? 0;
  const pendingReviews = report?.shiftsSummary?.pendingReviewShiftsCount ?? 0;
  const discrepancies = report?.shiftsSummary?.discrepanciesCount ?? 0;

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Top Banner / Role Identifier */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-6 shadow-xl border border-indigo-800/40 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-indigo-500/30 text-indigo-300 border border-indigo-400/30">
                👑 Company Super Admin
              </span>
              <span className="text-xs text-slate-400">All Company Branches Access</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white">
              {shop?.name || 'Adaptive Billing Platform'}
            </h1>
            <p className="text-sm text-slate-300 mt-1">
              Consolidated enterprise headquarters: multi-branch telemetry, staff governance, and real-time ledger oversight.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onNavigate?.('pos')}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg shadow-md transition-all flex items-center gap-1.5"
            >
              <span>🛒</span> Launch POS
            </button>
            <button
              onClick={() => onNavigate?.('shifts')}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg shadow-md transition-all flex items-center gap-1.5"
            >
              <span>⏱️</span> Shifts Hub
            </button>
            <button
              onClick={() => onNavigate?.('reports')}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold rounded-lg border border-slate-700 transition-all flex items-center gap-1.5"
            >
              <span>📊</span> Reports
            </button>
          </div>
        </div>

        {/* Navigation tabs */}
        <div className="flex items-center gap-1 mt-6 pt-4 border-t border-slate-800">
          <button
            onClick={() => { setActiveSubTab('overview'); setSelectedBranchId(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeSubTab === 'overview' && !selectedBranchId
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-300 hover:bg-slate-800/60'
            }`}
          >
            🏢 Company Overview
          </button>
          <button
            onClick={() => setActiveSubTab('branches')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeSubTab === 'branches'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-300 hover:bg-slate-800/60'
            }`}
          >
            🌐 Branches ({branches.length})
          </button>
          <button
            onClick={() => { setActiveSubTab('staff'); setSelectedBranchId(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeSubTab === 'staff'
                ? 'bg-indigo-600 text-white shadow'
                : 'text-slate-300 hover:bg-slate-800/60'
            }`}
          >
            👥 Staff & Roles ({usersList.length})
          </button>
        </div>
      </div>

      {/* Main Tab Views */}
      {activeSubTab === 'overview' && !selectedBranchId && (
        <div className="space-y-6">
          {/* Top Key Performance Metrics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Today's Net Sales */}
            <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200 relative overflow-hidden">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Today's Net Sales</div>
              <div className="text-2xl font-black text-slate-900 mt-2">{formatRupees(totalSalesMinor)}</div>
              <div className="flex items-center justify-between text-xs text-slate-500 mt-2 pt-2 border-t border-slate-100">
                <span>{billCount} Invoices</span>
                <span className="text-emerald-600 font-semibold">Gross: {formatRupees(grossSalesMinor)}</span>
              </div>
            </div>

            {/* 2. Customer Collections & Dues */}
            <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Khata Collections & Dues</div>
              <div className="text-2xl font-black text-emerald-600 mt-2">{formatRupees(khataCollectionsMinor)}</div>
              <div className="flex items-center justify-between text-xs mt-2 pt-2 border-t border-slate-100">
                <span className="text-slate-500">Outstanding:</span>
                <span className="text-rose-600 font-bold">{formatRupees(outstandingDues)}</span>
              </div>
            </div>

            {/* 3. Multi-Branch Operations */}
            <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Branches & Counters</div>
              <div className="text-2xl font-black text-indigo-700 mt-2">
                {activeBranches} <span className="text-sm font-medium text-slate-500">/ {totalBranches} Active</span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 mt-2 pt-2 border-t border-slate-100">
                <span>Total Counters: {totalCounters}</span>
                <span className="text-indigo-600 font-semibold cursor-pointer" onClick={() => setActiveSubTab('branches')}>
                  Manage ➔
                </span>
              </div>
            </div>

            {/* 4. Active Shifts & Discrepancies */}
            <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
              <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Shift Oversight</div>
              <div className="text-2xl font-black text-slate-900 mt-2">
                {openShifts} <span className="text-sm font-medium text-emerald-600">Open Shifts</span>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 mt-2 pt-2 border-t border-slate-100">
                <span className={pendingReviews > 0 ? 'text-amber-600 font-semibold' : 'text-slate-500'}>
                  {pendingReviews} Need Review
                </span>
                {discrepancies > 0 ? (
                  <span className="px-1.5 py-0.5 bg-rose-100 text-rose-700 rounded font-bold">
                    ⚠️ {discrepancies} Discrepancy
                  </span>
                ) : (
                  <span className="text-emerald-600 font-semibold">✓ Balanced</span>
                )}
              </div>
            </div>
          </div>

          {/* Payment Method Breakdown Bar */}
          {report?.paymentBreakdown && report.paymentBreakdown.length > 0 && (
            <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
              <div className="text-sm font-bold text-slate-800 mb-3 flex items-center justify-between">
                <span>Collections by Payment Instrument</span>
                <span className="text-xs text-slate-500 font-normal">Reconciles cash drawer and electronic settlements</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {report.paymentBreakdown.map((p) => (
                  <div key={p.method} className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                    <div className="text-xs font-semibold text-slate-500 uppercase">{p.method}</div>
                    <div className="text-base font-bold text-slate-900 mt-0.5">{formatRupees(p.totalMinor)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Branch-wise Sales & Collection Comparison Table */}
          <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">Branch Performance Comparison</h2>
                <p className="text-xs text-slate-500">Live sales, payment collections, and cashier shifts across all authorized branches.</p>
              </div>
              <button
                onClick={() => setShowAddBranchModal(true)}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1"
              >
                <span>➕</span> Add Branch
              </button>
            </div>

            {report?.branchComparison && report.branchComparison.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 uppercase">
                      <th className="py-2.5 px-3">Branch Code</th>
                      <th className="py-2.5 px-3">Branch Name</th>
                      <th className="py-2.5 px-3 text-center">Counters</th>
                      <th className="py-2.5 px-3 text-right">Today Invoices</th>
                      <th className="py-2.5 px-3 text-right">Today Sales</th>
                      <th className="py-2.5 px-3 text-right">Collections</th>
                      <th className="py-2.5 px-3 text-center">Open Shifts</th>
                      <th className="py-2.5 px-3 text-center">Status</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.branchComparison.map((b) => (
                      <tr key={b.id || b.code} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-3 font-mono font-bold text-slate-800">{b.code}</td>
                        <td className="py-3 px-3 font-semibold text-slate-900">{b.name}</td>
                        <td className="py-3 px-3 text-center">
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md text-xs font-medium">
                            {b.countersCount} counters
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right text-slate-700">{b.todaySalesCount}</td>
                        <td className="py-3 px-3 text-right font-bold text-slate-900">{formatRupees(b.todaySalesTotalMinor)}</td>
                        <td className="py-3 px-3 text-right font-semibold text-emerald-600">{formatRupees(b.todayCollectionsMinor)}</td>
                        <td className="py-3 px-3 text-center">
                          {b.openShiftsCount > 0 ? (
                            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold">
                              {b.openShiftsCount} Active
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs">—</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                            b.active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500'
                          }`}>
                            {b.active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            onClick={() => handleOpenBranchDetail(b.id)}
                            className="px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded transition-colors"
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
              <div className="text-center py-8 text-slate-400 text-sm">
                No branches configured yet. Click "Add Branch" to create your first multi-branch node.
              </div>
            )}
          </div>

          {/* Low Stock Alerts Across Company */}
          {report?.lowStock && report.lowStock.length > 0 && (
            <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">⚠️</span>
                  <h3 className="text-sm font-bold text-slate-900">Inventory Alerts Across Company Branches</h3>
                </div>
                <button
                  onClick={() => onNavigate?.('inventory')}
                  className="text-xs font-semibold text-indigo-600 hover:underline"
                >
                  View Inventory Hub ➔
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {report.lowStock.map((item) => (
                  <div key={item.id} className="p-3 bg-amber-50/60 border border-amber-200/80 rounded-lg flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-slate-800">{item.name}</div>
                      <div className="text-xs text-slate-500">SKU: {item.sku || 'N/A'}</div>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-black text-rose-600">{(item.currentStockMilli / 1000).toFixed(0)}</span>
                      <span className="text-xs text-slate-500 ml-1">left</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Selected Branch Detail Modal / Overlay */}
      {selectedBranchId && branchSummary && (
        <div className="bg-white rounded-2xl p-6 shadow-xl border border-indigo-200 animate-fadeIn">
          <div className="flex items-center justify-between pb-4 border-b border-slate-200">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 font-mono font-bold text-xs rounded">
                  {branchSummary.branch.code}
                </span>
                <h2 className="text-xl font-black text-slate-900">{branchSummary.branch.name}</h2>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {branchSummary.branch.address || 'No physical address configured'} • Phone: {branchSummary.branch.phone || 'N/A'}
              </p>
            </div>
            <button
              onClick={() => setSelectedBranchId(null)}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors"
            >
              ✕ Close Inspector
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 my-5">
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
              <div className="text-xs text-slate-500 font-bold uppercase">Today Sales</div>
              <div className="text-xl font-black text-slate-900 mt-1">
                {formatRupees(branchSummary.todaySalesTotalMinor)}
              </div>
              <div className="text-xs text-slate-500 mt-1">{branchSummary.todaySalesCount} Invoices posted</div>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
              <div className="text-xs text-slate-500 font-bold uppercase">Today Collections</div>
              <div className="text-xl font-black text-emerald-600 mt-1">
                {formatRupees(branchSummary.todayCollectionsMinor)}
              </div>
              <div className="text-xs text-slate-500 mt-1">Cash, UPI & Card collections</div>
            </div>

            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
              <div className="text-xs text-slate-500 font-bold uppercase">Active Cashier Shifts</div>
              <div className="text-xl font-black text-indigo-700 mt-1">
                {branchSummary.activeShiftsCount} Active
              </div>
              <div className="text-xs text-slate-500 mt-1">{branchSummary.pendingReviewShiftsCount} shifts awaiting review</div>
            </div>
          </div>

          {/* Active Counters in this Branch */}
          <div className="mt-4 pt-4 border-t border-slate-100">
            <h4 className="text-xs font-bold text-slate-700 uppercase mb-2">Configured Counters</h4>
            <div className="flex flex-wrap gap-2">
              {branchSummary.branch.counters.map((c) => (
                <span key={c} className="px-3 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 font-mono text-xs font-bold rounded-lg">
                  🖥️ {c}
                </span>
              ))}
            </div>
          </div>

          {/* Assigned Staff */}
          <div className="mt-5 pt-4 border-t border-slate-100">
            <h4 className="text-xs font-bold text-slate-700 uppercase mb-3">Assigned Staff at this Branch</h4>
            {branchSummary.staff && branchSummary.staff.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {branchSummary.staff.map((s) => (
                  <div key={s.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                    <div className="font-bold text-slate-900">{s.name}</div>
                    <div className="text-slate-500">{s.email}</div>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="capitalize font-semibold text-indigo-600">{s.role}</span>
                      <span className="text-slate-400 font-mono">{s.counter || 'General'}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-slate-400 italic">No staff explicitly assigned to this branch yet.</div>
            )}
          </div>
        </div>
      )}

      {/* Branches Management SubTab */}
      {activeSubTab === 'branches' && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Branch Configuration & Counters</h2>
              <p className="text-xs text-slate-500">Add, activate, or reassign Store Managers to branches without deleting historical data.</p>
            </div>
            <button
              onClick={() => setShowAddBranchModal(true)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow"
            >
              <span>➕</span> Add New Branch
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {branches.map((b) => (
              <div key={b.id} className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-black px-2 py-0.5 bg-slate-200 text-slate-800 rounded">
                        {b.code}
                      </span>
                      <h3 className="font-bold text-slate-900">{b.name}</h3>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      {b.address || 'No address specified'}
                    </div>
                  </div>
                  <button
                    onClick={() => handleToggleBranchActive(b)}
                    className={`px-2.5 py-1 text-xs font-bold rounded-full transition-colors ${
                      b.active ? 'bg-emerald-100 text-emerald-800 hover:bg-rose-100 hover:text-rose-800' : 'bg-slate-200 text-slate-600 hover:bg-emerald-100 hover:text-emerald-800'
                    }`}
                  >
                    {b.active ? 'Active' : 'Disabled'}
                  </button>
                </div>

                <div className="mt-3 pt-3 border-t border-slate-200 text-xs flex flex-wrap items-center justify-between gap-2">
                  <div className="text-slate-600">
                    <span className="font-semibold">Store Manager:</span>{' '}
                    {b.managerName ? <span className="font-bold text-indigo-700">{b.managerName}</span> : <span className="text-slate-400">Unassigned</span>}
                  </div>
                  <div className="text-slate-600 font-mono">
                    <span className="font-semibold">Counters:</span> {b.counters.join(', ')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Staff Management SubTab */}
      {activeSubTab === 'staff' && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Staff Hierarchy & Counter Assignments</h2>
              <p className="text-xs text-slate-500">Manage Store Managers, Cashiers, and Accountants. Assign each cashier to a specific branch and billing counter.</p>
            </div>
            <button
              onClick={() => setShowAddStaffModal(true)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow"
            >
              <span>👤</span> Add Staff Member
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 uppercase">
                  <th className="py-2.5 px-3">Name & Email</th>
                  <th className="py-2.5 px-3">Role</th>
                  <th className="py-2.5 px-3">Assigned Branch</th>
                  <th className="py-2.5 px-3">Assigned Counter</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {usersList.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 px-3">
                      <div className="font-bold text-slate-900">{u.name}</div>
                      <div className="text-xs text-slate-500">{u.email}</div>
                    </td>
                    <td className="py-3 px-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${
                        u.role === 'owner'
                          ? 'bg-purple-100 text-purple-800'
                          : u.role === 'manager'
                          ? 'bg-blue-100 text-blue-800'
                          : u.role === 'cashier'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}>
                        {u.role === 'owner' ? 'Super Admin' : u.role === 'manager' ? 'Store Manager' : u.role}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-mono text-xs font-bold text-slate-700">
                      {u.assignedLocation || 'MAIN'}
                    </td>
                    <td className="py-3 px-3 font-mono text-xs text-slate-600">
                      {u.assignedCounter || 'COUNTER-1'}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        u.active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                      }`}>
                        {u.active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      {u.id !== user.id && (
                        <button
                          onClick={() => handleToggleStaffActive(u)}
                          className="px-2 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded"
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

      {/* Add Branch Modal */}
      {showAddBranchModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-scaleUp">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">Add New Branch</h3>
              <button onClick={() => setShowAddBranchModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>

            {branchError && (
              <div className="mt-3 p-2.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-lg text-xs font-medium">
                {branchError}
              </div>
            )}

            <form onSubmit={handleCreateBranch} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Branch Code (Unique ID)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. BR-NORTH, T-NAGAR"
                  value={newBranchCode}
                  onChange={(e) => setNewBranchCode(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-indigo-500 uppercase"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Branch Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. North City Outlet"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Physical Address</label>
                <input
                  type="text"
                  placeholder="Street, City, State"
                  value={newBranchAddress}
                  onChange={(e) => setNewBranchAddress(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Contact Phone</label>
                <input
                  type="text"
                  placeholder="10-digit mobile number"
                  value={newBranchPhone}
                  onChange={(e) => setNewBranchPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Assign Store Manager (Optional)</label>
                <select
                  value={newBranchManagerId}
                  onChange={(e) => setNewBranchManagerId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">-- No Manager Assigned --</option>
                  {usersList
                    .filter((u) => u.role === 'manager' || u.role === 'owner')
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.email})
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Counters (Comma Separated)</label>
                <input
                  type="text"
                  value={newBranchCounters}
                  onChange={(e) => setNewBranchCounters(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddBranchModal(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg font-bold hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingBranch}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow transition-colors disabled:opacity-50"
                >
                  {isSubmittingBranch ? 'Saving...' : 'Create Branch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Staff Modal */}
      {showAddStaffModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-scaleUp">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">Add Staff Account</h3>
              <button onClick={() => setShowAddStaffModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>

            {staffError && (
              <div className="mt-3 p-2.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-lg text-xs font-medium">
                {staffError}
              </div>
            )}

            <form onSubmit={handleCreateStaff} className="space-y-4 mt-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="Staff member name"
                  value={newStaffName}
                  onChange={(e) => setNewStaffName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Email (Sign-in ID)</label>
                <input
                  type="email"
                  required
                  placeholder="staff@store.com"
                  value={newStaffEmail}
                  onChange={(e) => setNewStaffEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Initial Password</label>
                <input
                  type="password"
                  required
                  value={newStaffPassword}
                  onChange={(e) => setNewStaffPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Role</label>
                <select
                  value={newStaffRole}
                  onChange={(e: any) => setNewStaffRole(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="cashier">Cashier (Billing & Shifts only)</option>
                  <option value="manager">Store Manager (Assigned branch operations)</option>
                  <option value="accountant">Accountant (Purchases, GST, Ledger)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Assigned Branch</label>
                  <select
                    value={newStaffBranch}
                    onChange={(e) => setNewStaffBranch(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500"
                  >
                    {branches.map((b) => (
                      <option key={b.code} value={b.code}>
                        {b.name} ({b.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Counter</label>
                  <input
                    type="text"
                    value={newStaffCounter}
                    onChange={(e) => setNewStaffCounter(e.target.value.toUpperCase())}
                    placeholder="COUNTER-1"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-indigo-500 uppercase"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddStaffModal(false)}
                  className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg font-bold hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingStaff}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow transition-colors disabled:opacity-50"
                >
                  {isSubmittingStaff ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
