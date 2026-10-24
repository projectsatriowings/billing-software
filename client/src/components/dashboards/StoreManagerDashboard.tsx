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
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-500 text-sm">
        Loading authorized branch operations...
      </div>
    );
  }

  const currentBranch = branches.find((b) => b.code === selectedBranchCode) || branches[0];

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white rounded-2xl p-6 shadow-xl border border-blue-800/40 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-blue-500/30 text-blue-300 border border-blue-400/30">
                🏪 Store Manager Dashboard
              </span>
              <span className="text-xs text-slate-300">
                Managing: <strong className="text-white">{currentBranch?.name || selectedBranchCode}</strong>
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-white">
              {currentBranch?.name || shop?.name || 'Store Branch'}
            </h1>
            <p className="text-sm text-slate-300 mt-1">
              Branch operations hub: cashier shift monitoring, counter management, and physical inventory reconciliations.
            </p>
          </div>

          {/* Quick Action Navigation */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onNavigate?.('pos')}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold rounded-lg shadow-md transition-all flex items-center gap-1.5"
            >
              <span>🛒</span> Start POS
            </button>
            <button
              onClick={() => onNavigate?.('shifts')}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-lg shadow-md transition-all flex items-center gap-1.5"
            >
              <span>⏱️</span> Shift Log
            </button>
            <button
              onClick={() => onNavigate?.('inventory')}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold rounded-lg border border-slate-700 transition-all flex items-center gap-1.5"
            >
              <span>📦</span> Stock Hub
            </button>
          </div>
        </div>

        {/* Branch Selector (if manager has multiple branches assigned) */}
        {branches.length > 1 && (
          <div className="mt-5 pt-4 border-t border-slate-800/80 flex items-center gap-3">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Switch Branch:</span>
            <div className="flex flex-wrap gap-2">
              {branches.map((b) => (
                <button
                  key={b.code}
                  onClick={() => handleBranchChange(b.code)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    selectedBranchCode === b.code
                      ? 'bg-blue-500 text-white shadow'
                      : 'bg-slate-800/60 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {b.name} ({b.code})
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Branch Metrics KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Today's Branch Sales */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Today's Branch Sales</div>
          <div className="text-2xl font-black text-slate-900 mt-2">
            {formatRupees(branchSummary?.todaySalesTotalMinor ?? 0)}
          </div>
          <div className="text-xs text-slate-500 mt-2 pt-2 border-t border-slate-100 flex items-center justify-between">
            <span>{branchSummary?.todaySalesCount ?? 0} Invoices</span>
            <span className="text-emerald-600 font-semibold">Active Counter Sales</span>
          </div>
        </div>

        {/* Collections */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Today's Collections</div>
          <div className="text-2xl font-black text-emerald-600 mt-2">
            {formatRupees(branchSummary?.todayCollectionsMinor ?? 0)}
          </div>
          <div className="text-xs text-slate-500 mt-2 pt-2 border-t border-slate-100">
            <span>Drawer cash & digital settlements</span>
          </div>
        </div>

        {/* Active Cashier Shifts */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Open Cashier Shifts</div>
          <div className="text-2xl font-black text-indigo-700 mt-2">
            {branchSummary?.activeShiftsCount ?? 0} <span className="text-sm font-medium text-slate-500">Active</span>
          </div>
          <div className="text-xs text-slate-500 mt-2 pt-2 border-t border-slate-100 flex items-center justify-between">
            <span>Counters: {branchSummary?.branch?.counters?.length ?? 1}</span>
            <span className="text-indigo-600 font-semibold cursor-pointer" onClick={() => onNavigate?.('shifts')}>
              View ➔
            </span>
          </div>
        </div>

        {/* Shift Reviews & Discrepancies */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Shift Reviews</div>
          <div className="text-2xl font-black text-slate-900 mt-2">
            {branchSummary?.pendingReviewShiftsCount ?? 0}{' '}
            <span className="text-sm font-medium text-amber-600">Pending</span>
          </div>
          <div className="text-xs text-slate-500 mt-2 pt-2 border-t border-slate-100">
            {branchSummary && branchSummary.pendingReviewShiftsCount > 0 ? (
              <span className="text-amber-600 font-bold">Requires Manager Approval</span>
            ) : (
              <span className="text-emerald-600 font-semibold">All closures reviewed</span>
            )}
          </div>
        </div>
      </div>

      {/* Main Grid: Active Shifts & Shift Reviews */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Cashiers & Counters */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Active Cashiers & Counters</h2>
              <p className="text-xs text-slate-500">Live open shifts currently processing billing in this branch.</p>
            </div>
            <button
              onClick={() => onNavigate?.('shifts')}
              className="text-xs font-semibold text-indigo-600 hover:underline"
            >
              Open Shift ➔
            </button>
          </div>

          {branchSummary?.activeShifts && branchSummary.activeShifts.length > 0 ? (
            <div className="space-y-3">
              {branchSummary.activeShifts.map((s) => (
                <div key={s.id} className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 font-mono text-xs font-bold rounded">
                        {s.counter}
                      </span>
                      <span className="font-bold text-slate-900 text-sm">{s.cashierName}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">
                      Shift: <strong className="text-slate-700">{s.shiftNumber}</strong> • Float: {formatRupees(s.openingCashMinor)}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-full text-xs font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      Billing Active
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-slate-400 text-sm bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
              No active cashier shifts right now. Cashiers can log in and open their counter shift.
            </div>
          )}
        </div>

        {/* Closed Shifts Awaiting Manager Review / Discrepancies */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Shift Closures Awaiting Review</h2>
              <p className="text-xs text-slate-500">Confirm cash drawer reconciliations and approve variance notes.</p>
            </div>
          </div>

          {branchSummary?.pendingReviewShifts && branchSummary.pendingReviewShifts.length > 0 ? (
            <div className="space-y-3">
              {branchSummary.pendingReviewShifts.map((s) => (
                <div key={s.id} className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                  <div>
                    <div className="font-bold text-slate-900 text-sm">{s.cashierName}</div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Shift {s.shiftNumber} • Closed at: {new Date(s.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="text-xs mt-1">
                      {s.varianceMinor !== 0 ? (
                        <span className="font-bold text-rose-600">
                          Variance: {formatRupees(s.varianceMinor)}
                        </span>
                      ) : (
                        <span className="font-semibold text-emerald-600">✓ Exact balance</span>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={() => { setReviewShiftId(s.id); setReviewNotes(''); }}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors"
                  >
                    Approve ➔
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-slate-400 text-sm bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
              No shifts awaiting review. All past shifts are reviewed and approved.
            </div>
          )}
        </div>
      </div>

      {/* Branch Management & Staff Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Branch Counters Management */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Branch Counters</h2>
              <p className="text-xs text-slate-500">Configure point-of-sale checkout counters for this branch.</p>
            </div>
            <button
              onClick={() => setShowAddCounterModal(true)}
              className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-lg border border-indigo-200 transition-colors"
            >
              ➕ Add Counter
            </button>
          </div>

          <div className="flex flex-wrap gap-2 mt-3">
            {branchSummary?.branch?.counters?.map((c) => (
              <div key={c} className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-800 flex items-center gap-1.5">
                <span>🖥️</span> {c}
              </div>
            ))}
          </div>
        </div>

        {/* Branch Cashiers */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-200">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Cashiers in this Branch</h2>
              <p className="text-xs text-slate-500">Staff authorized to bill and operate registers at this location.</p>
            </div>
            <button
              onClick={() => setShowAddCashierModal(true)}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors"
            >
              ➕ Add Cashier
            </button>
          </div>

          <div className="space-y-2 mt-3 max-h-48 overflow-y-auto">
            {branchSummary?.staff && branchSummary.staff.length > 0 ? (
              branchSummary.staff.map((st) => (
                <div key={st.id} className="p-2.5 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-slate-900">{st.name}</span>
                    <span className="text-slate-400 ml-2">({st.email})</span>
                  </div>
                  <span className="font-mono text-slate-600 font-semibold">{st.counter || 'COUNTER-1'}</span>
                </div>
              ))
            ) : (
              <div className="text-center py-4 text-xs text-slate-400 italic">
                No cashiers assigned to this branch yet.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Approve Shift Modal */}
      {reviewShiftId && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 animate-scaleUp">
            <h3 className="text-base font-bold text-slate-900">Approve Shift Closure</h3>
            <p className="text-xs text-slate-500 mt-1">
              Add your manager sign-off note to confirm drawer physical cash reconciliation.
            </p>

            <div className="mt-4">
              <label className="block text-xs font-bold text-slate-700 mb-1">Manager Review Notes</label>
              <textarea
                rows={3}
                placeholder="e.g. Physical cash verified, variance verified against receipts."
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setReviewShiftId(null)}
                className="px-3.5 py-1.5 border border-slate-300 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSubmittingReview}
                onClick={() => handleApproveShift(reviewShiftId)}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow disabled:opacity-50"
              >
                {isSubmittingReview ? 'Approving...' : 'Confirm Approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Counter Modal */}
      {showAddCounterModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 animate-scaleUp">
            <h3 className="text-base font-bold text-slate-900">Add Branch Counter</h3>
            <form onSubmit={handleAddCounter} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Counter Identifier</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. COUNTER-3, EXPRESS-1"
                  value={newCounterName}
                  onChange={(e) => setNewCounterName(e.target.value.toUpperCase())}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-sm uppercase focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddCounterModal(false)}
                  className="px-3.5 py-1.5 border border-slate-300 text-slate-700 rounded-lg font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow"
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
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-scaleUp">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                Add Cashier for {selectedBranchCode}
              </h3>
              <button onClick={() => setShowAddCashierModal(false)} className="text-slate-400 hover:text-slate-600 font-bold">
                ✕
              </button>
            </div>

            {cashierError && (
              <div className="mt-3 p-2 bg-rose-50 text-rose-700 border border-rose-200 rounded text-xs">
                {cashierError}
              </div>
            )}

            <form onSubmit={handleCreateCashier} className="mt-4 space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Cashier Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Kumar"
                  value={cashierName}
                  onChange={(e) => setCashierName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Email / Sign-in ID</label>
                <input
                  type="email"
                  required
                  placeholder="cashier@store.com"
                  value={cashierEmail}
                  onChange={(e) => setCashierEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Initial Password</label>
                <input
                  type="password"
                  required
                  value={cashierPassword}
                  onChange={(e) => setCashierPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Assigned Counter</label>
                <select
                  value={cashierCounter}
                  onChange={(e) => setCashierCounter(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500"
                >
                  {branchSummary?.branch?.counters?.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddCashierModal(false)}
                  className="px-3.5 py-1.5 border border-slate-300 text-slate-700 rounded-lg font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingCashier}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow disabled:opacity-50"
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
