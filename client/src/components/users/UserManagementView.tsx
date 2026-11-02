import React, { useState, useEffect, useRef, useMemo } from 'react';
import './userManagement.css';
import {
  fetchUserManagementSummary,
  fetchManagers,
  checkUsernameAvailability,
  checkEmailAvailability,
  createManager,
  updateManager,
  resetManagerPassword,
  updateManagerStatus,
  assignBranchManager,
  fetchCounters,
  updateCounterStatus,
  createCounter,
  updateCounter,
  fetchBranches,
  createBranch,
  updateBranch,
  type UserManagementSummary,
  type StoreManager,
  type CounterItem,
  type ManagerInput,
} from '../../api.ts';
import type { Branch } from '../../api.ts';
import { DeleteConfirmModal, type DeleteEntityType } from './DeleteConfirmModal.tsx';
import { MailStatusBadge } from './MailStatusBadge.tsx';
import { resendUserCredentials, testMailConnection } from '../../api.ts';

// ============================================================================
// SVG ICONS (Thin stroke, Lucide style, accessible)
// ============================================================================
const Icons = {
  Building: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01" />
    </svg>
  ),
  Users: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  UserPlus: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" y1="8" x2="19" y2="14" />
      <line x1="22" y1="11" x2="16" y2="11" />
    </svg>
  ),
  Monitor: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  AlertTriangle: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  AlertCircle: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  Search: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  Eye: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  EyeOff: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  ),
  Copy: () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  Check: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  Pencil: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  ),
  Key: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m11.39 11.61 7.11-7.11" />
      <path d="m15.5 4.5 3 3" />
      <path d="m18.5 7.5 2-2" />
    </svg>
  ),
  Send: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  ),
  Power: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2v10" />
      <path d="M18.36 6.64A9 9 0 1 1 5.63 6.64" />
    </svg>
  ),
  Trash: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  ),
  Mail: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  Close: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
};

// ============================================================================
// HELPERS
// ============================================================================
function getInitials(name: string): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function formatDate(isoStr?: string | null): string {
  if (!isoStr) return 'Never';
  try {
    const d = new Date(isoStr);
    const now = new Date();
    const diffHours = (now.getTime() - d.getTime()) / (1000 * 60 * 60);

    const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });

    if (diffHours < 24 && d.getDate() === now.getDate()) {
      return `Today, ${timeStr}`;
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (diffHours < 48 && d.getDate() === yesterday.getDate()) {
      return `Yesterday, ${timeStr}`;
    }
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return 'Never';
  }
}

function formatCreatedDate(isoStr?: string | null): string {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    return `Created ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  } catch {
    return '';
  }
}

/** Generates strong 12-char password */
function generateClientPassword(): string {
  const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lowers = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '#@!$%&*';
  const all = uppers + lowers + digits + symbols;

  let pwd = '';
  pwd += uppers[Math.floor(Math.random() * uppers.length)];
  pwd += lowers[Math.floor(Math.random() * lowers.length)];
  pwd += digits[Math.floor(Math.random() * digits.length)];
  pwd += symbols[Math.floor(Math.random() * symbols.length)];

  while (pwd.length < 12) {
    pwd += all[Math.floor(Math.random() * all.length)];
  }
  return pwd.split('').sort(() => 0.5 - Math.random()).join('');
}

interface ToastMessage {
  id: string;
  text: string;
  danger?: boolean;
  retryFn?: () => void;
}

export const UserManagementView: React.FC = () => {
  // Navigation Tabs: 'managers' | 'branches' | 'counters'
  const [activeTab, setActiveTab] = useState<'managers' | 'branches' | 'counters'>('managers');

  // Sync tab with URL query parameter (?tab=managers|branches|counters)
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('tab');
      if (p === 'managers' || p === 'branches' || p === 'counters') {
        setActiveTab(p);
      }
    } catch {}

    const onPop = () => {
      try {
        const p = new URLSearchParams(window.location.search).get('tab');
        if (p === 'managers' || p === 'branches' || p === 'counters') {
          setActiveTab(p);
        }
      } catch {}
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const handleTabSwitch = (tab: 'managers' | 'branches' | 'counters') => {
    setActiveTab(tab);
    try {
      const url = new URL(window.location.href);
      url.pathname = '/user-management';
      url.searchParams.set('tab', tab);
      window.history.replaceState({}, '', url.toString());
    } catch {}
  };

  // Live Data State
  const [summary, setSummary] = useState<UserManagementSummary>({
    branches: { total: 0, active: 0, inactive: 0 },
    managers: { total: 0, assigned: 0, unassigned: 0 },
    counters: { total: 0, active: 0, branches: 0 },
    branchesWithoutManager: 0,
  });

  const [managers, setManagers] = useState<StoreManager[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [counters, setCounters] = useState<CounterItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [mgrSearch, setMgrSearch] = useState('');
  const [mgrBranchFilter, setMgrBranchFilter] = useState('ALL');
  const [mgrStatusFilter, setMgrStatusFilter] = useState('ALL');

  const [cntSearch, setCntSearch] = useState('');
  const [cntBranchFilter, setCntBranchFilter] = useState('ALL');
  const [cntStatusFilter, setCntStatusFilter] = useState('ALL');

  // Derived card metrics directly from the loaded tables data (single source of truth)
  const computedBranchTotal = branches.length;
  const computedBranchActive = branches.filter((b) => b.active).length;
  const computedBranchInactive = computedBranchTotal - computedBranchActive;

  // A manager is assigned if their branchId is set and points to an existing branch
  const activeBranchIds = new Set(branches.map((b) => b.id));
  const computedManagersTotal = managers.length;
  const computedManagersAssigned = managers.filter((m) => Boolean(m.branchId && activeBranchIds.has(m.branchId))).length;
  const computedManagersUnassigned = computedManagersTotal - computedManagersAssigned;

  // A branch is without a manager if no manager is assigned to its branchId and branch.managerId is empty
  const assignedBranchIds = new Set(
    managers.filter((m) => Boolean(m.branchId)).map((m) => m.branchId as string)
  );
  const computedBranchesWithoutManager = branches.filter(
    (b) => !assignedBranchIds.has(b.id) && !b.managerId
  ).length;

  const computedCounterTotal = counters.length;
  const computedCounterActive = counters.filter((c) => c.status === 'ACTIVE').length;
  const computedCounterBranches = new Set(counters.map((c) => c.branch.id)).size;

  // Prefer computed values from the live loaded tables, falling back to summary
  const displayBranchesTotal = branches.length > 0 ? computedBranchTotal : summary.branches.total;
  const displayBranchesActive = branches.length > 0 ? computedBranchActive : summary.branches.active;
  const displayBranchesInactive = branches.length > 0 ? computedBranchInactive : summary.branches.inactive;

  const displayManagersTotal = managers.length > 0 ? computedManagersTotal : summary.managers.total;
  const displayManagersAssigned = managers.length > 0 ? computedManagersAssigned : summary.managers.assigned;
  const displayManagersUnassigned = managers.length > 0 ? computedManagersUnassigned : summary.managers.unassigned;

  const displayCountersTotal = counters.length > 0 ? computedCounterTotal : summary.counters.total;
  const displayCountersActive = counters.length > 0 ? computedCounterActive : summary.counters.active;
  const displayCounterBranches = counters.length > 0 ? computedCounterBranches : summary.counters.branches;

  const displayBranchesWithoutManager = branches.length > 0 ? computedBranchesWithoutManager : summary.branchesWithoutManager;

  // Toast
  const [toast, setToast] = useState<ToastMessage | null>(null);

  // --------------------------------------------------------------------------
  // PERMANENT DELETE STATE & HANDLERS
  // --------------------------------------------------------------------------
  const [deleteModal, setDeleteModal] = useState<{
    open: boolean;
    type: DeleteEntityType;
    id: string;
    name: string;
    code?: string;
  }>({
    open: false,
    type: 'manager',
    id: '',
    name: '',
  });

  const handleOpenDelete = (type: DeleteEntityType, id: string, name: string, code?: string) => {
    setDeleteModal({ open: true, type, id, name, code });
  };

  const handleDeleted = (id: string, name: string) => {
    if (deleteModal.type === 'manager') {
      setManagers((prev) => prev.filter((m) => m.id !== id));
      setBranches((prev) => prev.map((b) => (b.managerId === id ? { ...b, managerId: null, managerName: null } : b)));
    } else if (deleteModal.type === 'branch') {
      setBranches((prev) => prev.filter((b) => b.id !== id));
      setManagers((prev) => prev.map((m) => (m.branchId === id ? { ...m, branchId: null, branchName: null, branchCode: null } : m)));
      setCounters((prev) => prev.filter((c) => c.branch.id !== id));
    } else if (deleteModal.type === 'counter') {
      setCounters((prev) => prev.filter((c) => c.id !== id));
    }
    showToast(`${name} deleted`);
    loadAllData();
  };

  const handleDisableInstead = async (id: string) => {
    if (deleteModal.type === 'manager') {
      const mgr = managers.find((m) => m.id === id);
      if (mgr && mgr.status !== 'DISABLED') {
        await handleToggleManagerStatus(mgr);
      }
    } else if (deleteModal.type === 'counter') {
      const cnt = counters.find((c) => c.id === id);
      if (cnt && cnt.status !== 'DISABLED') {
        await handleToggleCounterStatus(cnt);
      }
    }
  };

  // --------------------------------------------------------------------------
  const showToast = (text: string, danger = false, retryFn?: () => void) => {
    const id = Math.random().toString();
    setToast({ id, text, danger, retryFn });
    setTimeout(() => {
      setToast((curr) => (curr?.id === id ? null : curr));
    }, 4500);
  };

  // RESEND CREDENTIALS HANDLER
  // --------------------------------------------------------------------------
  const handleResend = async (user: { id: string; name: string; email: string | null }) => {
    if (!user.email) return;
    try {
      const res = await resendUserCredentials(user.id);
      showToast(`Sign-in details emailed to ${user.email}`);
      if (res.temporaryPassword) {
        setResetModalData({
          open: true,
          managerName: user.name,
          temporaryPassword: res.temporaryPassword,
          managerEmail: user.email,
        });
      }
      loadAllData();
    } catch (err: any) {
      showToast(`Couldn't email ${user.email} — Retry`, true, () => handleResend(user));
    }
  };

  // --------------------------------------------------------------------------
  // TEST MAIL MODAL STATE & HANDLER
  // --------------------------------------------------------------------------
  const [mailTestModal, setMailTestModal] = useState<{
    open: boolean;
    email: string;
    loading: boolean;
    result: { ok: boolean; message: string } | null;
  }>({
    open: false,
    email: '',
    loading: false,
    result: null,
  });

  const handleSendTestMail = async () => {
    if (!mailTestModal.email || mailTestModal.loading) return;
    setMailTestModal((m) => ({ ...m, loading: true, result: null }));
    try {
      const res = await testMailConnection(mailTestModal.email.trim());
      setMailTestModal((m) => ({ ...m, loading: false, result: res }));
      showToast(`Test email sent to ${mailTestModal.email}`);
    } catch (err: any) {
      setMailTestModal((m) => ({
        ...m,
        loading: false,
        result: { ok: false, message: err.message || 'SMTP test failed' },
      }));
    }
  };



  // --------------------------------------------------------------------------
  // DATA FETCHING
  // --------------------------------------------------------------------------
  const loadAllData = async () => {
    try {
      setLoading(true);
      const [sumRes, mgrRes, brRes, cntRes] = await Promise.all([
        fetchUserManagementSummary(),
        fetchManagers(),
        fetchBranches(),
        fetchCounters(),
      ]);
      setSummary(sumRes);
      setManagers(mgrRes.managers || []);
      setBranches(brRes.branches || []);
      setCounters(cntRes.counters || []);
    } catch (err: any) {
      console.error('Failed to load user management data', err);
      showToast(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  // --------------------------------------------------------------------------
  // DRAWER STATE (Add / Edit Manager)
  // --------------------------------------------------------------------------
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingManager, setEditingManager] = useState<StoreManager | null>(null);
  const [drawerPreselectedBranchId, setDrawerPreselectedBranchId] = useState<string | null>(null);

  // Drawer Form fields
  const [formName, setFormName] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formBranchId, setFormBranchId] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formSendEmail, setFormSendEmail] = useState(true);
  const [formMustChangePassword, setFormMustChangePassword] = useState(true);

  // Drawer Validation & Live checks
  const [usernameAvailability, setUsernameAvailability] = useState<{ checked: boolean; available: boolean; error?: string }>({
    checked: false,
    available: true,
  });
  const [emailAvailability, setEmailAvailability] = useState<{ checked: boolean; available: boolean; error?: string }>({
    checked: false,
    available: true,
  });
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [isSubmittingManager, setIsSubmittingManager] = useState(false);
  const [formDirty, setFormDirty] = useState(false);

  // Open Drawer in Create Mode
  const openAddManagerDrawer = (preselectedBranchId?: string) => {
    setEditingManager(null);
    setDrawerPreselectedBranchId(preselectedBranchId || null);
    setFormName('');
    setFormUsername('');
    setFormEmail('');
    setFormPassword(generateClientPassword());
    setShowPassword(false);
    setFormBranchId(preselectedBranchId || '');
    setFormPhone('');
    setFormSendEmail(false);
    setFormMustChangePassword(true);
    setUsernameAvailability({ checked: false, available: true });
    setEmailAvailability({ checked: false, available: true });
    setDrawerError(null);
    setFormDirty(false);
    setIsDrawerOpen(true);
  };

  // Open Drawer in Edit Mode
  const openEditManagerDrawer = (manager: StoreManager) => {
    setEditingManager(manager);
    setDrawerPreselectedBranchId(null);
    setFormName(manager.name);
    setFormUsername(manager.username || '');
    setFormEmail(manager.email || '');
    setFormPassword('');
    setShowPassword(false);
    setFormBranchId(manager.branchId || '');
    setFormPhone(manager.phone || '');
    setFormSendEmail(false);
    setFormMustChangePassword(false);
    setUsernameAvailability({ checked: true, available: true });
    setEmailAvailability({ checked: true, available: true });
    setDrawerError(null);
    setFormDirty(false);
    setIsDrawerOpen(true);
  };

  // Close Drawer with discard confirm
  const handleCloseDrawer = () => {
    if (formDirty) {
      if (!window.confirm('Discard unsaved changes?')) {
        return;
      }
    }
    setIsDrawerOpen(false);
  };

  // Username suggestion logic
  const usernameSuggestion = useMemo(() => {
    if (formEmail && formEmail.includes('@')) {
      const prefix = formEmail.split('@')[0].toLowerCase().replace(/[^a-z0-9._]/g, '');
      if (prefix.length >= 4) return prefix;
    }
    if (formName.trim()) {
      const parts = formName.trim().toLowerCase().split(/\s+/);
      if (parts.length >= 2) {
        return `${parts[0]}.${parts[1][0]}`.replace(/[^a-z0-9._]/g, '');
      } else if (parts[0].length >= 4) {
        return parts[0].replace(/[^a-z0-9._]/g, '');
      }
    }
    return '';
  }, [formName, formEmail]);

  // Debounced server checks for username & email
  useEffect(() => {
    if (!isDrawerOpen) return;
    const trimmed = formUsername.trim().toLowerCase();
    if (!trimmed) {
      setUsernameAvailability({ checked: false, available: true });
      return;
    }

    if (editingManager && trimmed === editingManager.username?.toLowerCase()) {
      setUsernameAvailability({ checked: true, available: true });
      return;
    }

    // Client format check
    if (trimmed.length < 4 || trimmed.length > 20 || !/^[a-z0-9._]+$/.test(trimmed) || trimmed.startsWith('.') || trimmed.startsWith('_') || trimmed.endsWith('.') || trimmed.endsWith('_')) {
      setUsernameAvailability({
        checked: true,
        available: false,
        error: 'Use 4–20 letters, numbers, dot or underscore (not at the start or end).',
      });
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await checkUsernameAvailability(trimmed, editingManager?.id);
        setUsernameAvailability({
          checked: true,
          available: res.available,
          error: res.error,
        });
      } catch (err: any) {
        setUsernameAvailability({
          checked: true,
          available: false,
          error: err.message || 'Error checking username',
        });
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [formUsername, isDrawerOpen, editingManager]);

  useEffect(() => {
    if (!isDrawerOpen) return;
    const trimmed = formEmail.trim().toLowerCase();
    if (!trimmed) {
      setEmailAvailability({ checked: false, available: true });
      return;
    }

    if (editingManager && trimmed === editingManager.email?.toLowerCase()) {
      setEmailAvailability({ checked: true, available: true });
      return;
    }

    // Client format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailAvailability({
        checked: true,
        available: false,
        error: 'Enter a valid email, like name@store.com',
      });
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await checkEmailAvailability(trimmed, editingManager?.id);
        setEmailAvailability({
          checked: true,
          available: res.available,
          error: res.error,
        });
      } catch (err: any) {
        setEmailAvailability({
          checked: true,
          available: false,
          error: err.message || 'Error checking email',
        });
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [formEmail, isDrawerOpen, editingManager]);

  // Password rules checklist calculations
  const pwRules = useMemo(() => {
    const pw = formPassword;
    return {
      length: pw.length >= 8,
      casing: /[a-z]/.test(pw) && /[A-Z]/.test(pw),
      number: /[0-9]/.test(pw),
      symbol: /[#@!$%&*]/.test(pw),
    };
  }, [formPassword]);

  const pwStrength = useMemo(() => {
    if (!formPassword) return { score: 0, label: 'None', color: '#E6E4F0' };
    let score = 0;
    if (pwRules.length) score++;
    if (pwRules.casing) score++;
    if (pwRules.number) score++;
    if (pwRules.symbol) score++;

    if (score <= 1) return { score: 1, label: 'Weak', color: '#B42318' };
    if (score === 2) return { score: 2, label: 'Fair', color: '#C27A0E' };
    if (score === 3) return { score: 3, label: 'Good', color: '#1F4FD1' };
    return { score: 4, label: 'Strong', color: '#11683F' };
  }, [formPassword, pwRules]);

  // Sign-in ID group validation status
  const signinBoxStatus = useMemo(() => {
    const hasU = Boolean(formUsername.trim());
    const hasE = Boolean(formEmail.trim());

    if (!hasU && !hasE) {
      return { ok: false, type: 'amber', message: 'Add a username or an email ID to continue.' };
    }

    if (hasU && (!usernameAvailability.available || usernameAvailability.error)) {
      return { ok: false, type: 'red', message: 'Fix the highlighted field to continue.' };
    }
    if (hasE && (!emailAvailability.available || emailAvailability.error)) {
      return { ok: false, type: 'red', message: 'Fix the highlighted field to continue.' };
    }

    if (hasU && hasE) {
      return {
        ok: true,
        type: 'green',
        message: `Can sign in with @${formUsername.trim().toLowerCase()} or ${formEmail.trim().toLowerCase()}`,
      };
    } else if (hasU) {
      return {
        ok: true,
        type: 'green',
        message: `Can sign in with @${formUsername.trim().toLowerCase()}`,
      };
    } else {
      return {
        ok: true,
        type: 'green',
        message: `Can sign in with ${formEmail.trim().toLowerCase()}`,
      };
    }
  }, [formUsername, formEmail, usernameAvailability, emailAvailability]);

  // Save Manager (Create or Edit)
  const handleSaveManager = async (e: React.FormEvent) => {
    e.preventDefault();
    setDrawerError(null);

    if (formName.trim().length < 2) {
      setDrawerError('Full name must be at least 2 characters.');
      return;
    }

    if (!signinBoxStatus.ok) {
      setDrawerError('Please provide a valid username or email ID.');
      return;
    }

    if (!editingManager) {
      if (!formPassword || formPassword.length < 8) {
        setDrawerError('Password must be at least 8 characters.');
        return;
      }
      if (!pwRules.number) {
        setDrawerError('Password must contain at least one number.');
        return;
      }
      let metCount = 0;
      if (pwRules.length) metCount++;
      if (pwRules.casing) metCount++;
      if (pwRules.number) metCount++;
      if (pwRules.symbol) metCount++;
      if (metCount < 3) {
        setDrawerError('Password must satisfy at least 3 checklist requirements.');
        return;
      }
    }

    try {
      setIsSubmittingManager(true);
      const payload: ManagerInput = {
        name: formName.trim(),
        username: formUsername.trim().toLowerCase() || null,
        email: formEmail.trim().toLowerCase() || null,
        phone: formPhone.trim() || null,
        branchId: formBranchId || null,
        sendEmail: Boolean(formSendEmail && formEmail.trim()),
        mustChangePassword: formMustChangePassword,
      };

      if (!editingManager) {
        payload.password = formPassword;
        await createManager(payload);
        showToast(`Store manager ${payload.name} created successfully`);
      } else {
        if (formPassword) payload.password = formPassword;
        await updateManager(editingManager.id, payload);
        showToast(`Store manager ${payload.name} updated successfully`);
      }

      setIsDrawerOpen(false);
      await loadAllData();
    } catch (err: any) {
      console.error('Error saving manager', err);
      setDrawerError(err.message || 'Failed to save store manager');
    } finally {
      setIsSubmittingManager(false);
    }
  };

  // Branch assignment warning in drawer
  const targetBranchCurrentManager = useMemo(() => {
    if (!formBranchId) return null;
    const br = branches.find((b) => b.id === formBranchId);
    if (!br || !br.managerId) return null;
    if (editingManager && br.managerId === editingManager.id) return null;
    return br.managerName || 'Another manager';
  }, [formBranchId, branches, editingManager]);

  // Unassigned managers (for "Pick an existing manager" section in drawer)
  const unassignedManagers = useMemo(() => {
    return managers.filter((m) => !m.branchId && m.status !== 'DISABLED');
  }, [managers]);

  const handlePickExistingManager = async (managerId: string) => {
    if (!formBranchId) return;
    try {
      await assignBranchManager(formBranchId, managerId);
      const chosenMgr = managers.find((m) => m.id === managerId);
      const chosenBr = branches.find((b) => b.id === formBranchId);
      showToast(`Assigned ${chosenMgr?.name || 'manager'} to ${chosenBr?.name || 'branch'}`);
      setIsDrawerOpen(false);
      await loadAllData();
    } catch (err: any) {
      showToast(err.message || 'Failed to assign manager');
    }
  };

  // --------------------------------------------------------------------------
  // RESET PASSWORD MODAL
  // --------------------------------------------------------------------------
  const [resetModalData, setResetModalData] = useState<{
    open: boolean;
    managerName: string;
    temporaryPassword: string;
    managerEmail: string | null;
  }>({
    open: false,
    managerName: '',
    temporaryPassword: '',
    managerEmail: null,
  });

  const handleResetPasswordClick = async (mgr: StoreManager) => {
    try {
      const res = await resetManagerPassword(mgr.id);
      setResetModalData({
        open: true,
        managerName: mgr.name,
        temporaryPassword: res.temporaryPassword,
        managerEmail: mgr.email,
      });
      showToast('Password reset successfully');
    } catch (err: any) {
      showToast(err.message || 'Failed to reset password');
    }
  };

  // --------------------------------------------------------------------------
  // CONFIRMATION DIALOG (Disable / Enable Manager)
  // --------------------------------------------------------------------------
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    confirmText: string;
    danger?: boolean;
    onConfirm: () => Promise<void>;
  }>({
    open: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    onConfirm: async () => {},
  });

  const handleToggleManagerStatus = (mgr: StoreManager) => {
    if (mgr.status === 'DISABLED') {
      // Re-enable directly
      updateManagerStatus(mgr.id, 'ACTIVE')
        .then(() => {
          showToast(`Enabled ${mgr.name}`);
          loadAllData();
        })
        .catch((err) => showToast(err.message || 'Failed to enable manager'));
    } else {
      // Confirm disable
      setConfirmDialog({
        open: true,
        title: `Disable ${mgr.name}?`,
        message: 'They will no longer be able to sign in or access their branch.',
        confirmText: 'Disable manager',
        danger: true,
        onConfirm: async () => {
          await updateManagerStatus(mgr.id, 'DISABLED');
          showToast(`Disabled ${mgr.name}`);
          setConfirmDialog((c) => ({ ...c, open: false }));
          await loadAllData();
        },
      });
    }
  };

  // --------------------------------------------------------------------------
  // COUNTER STATUS TOGGLE
  // --------------------------------------------------------------------------
  const handleToggleCounterStatus = (cnt: CounterItem) => {
    if (cnt.status === 'DISABLED') {
      updateCounterStatus(cnt.id, 'ACTIVE')
        .then(() => {
          showToast(`Enabled ${cnt.name}`);
          loadAllData();
        })
        .catch((err) => showToast(err.message || 'Failed to enable counter'));
    } else {
      setConfirmDialog({
        open: true,
        title: `Disable ${cnt.name} (${cnt.code})?`,
        message: 'Staff will no longer be able to log in to this counter.',
        confirmText: 'Disable counter',
        danger: true,
        onConfirm: async () => {
          await updateCounterStatus(cnt.id, 'DISABLED');
          showToast(`Disabled ${cnt.name}`);
          setConfirmDialog((c) => ({ ...c, open: false }));
          await loadAllData();
        },
      });
    }
  };

  // --------------------------------------------------------------------------
  // BRANCH MODAL (Create / Edit) & VIEW BRANCH MODAL
  // --------------------------------------------------------------------------
  const [branchModal, setBranchModal] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    branchId?: string;
    name: string;
    code: string;
    address: string;
    phone: string;
    active: boolean;
    managerId: string;
  }>({
    open: false,
    mode: 'create',
    name: '',
    code: '',
    address: '',
    phone: '',
    active: true,
    managerId: '',
  });

  const [viewBranchModal, setViewBranchModal] = useState<{
    open: boolean;
    branch: Branch | null;
  }>({
    open: false,
    branch: null,
  });

  const openCreateBranchModal = () => {
    setBranchModal({
      open: true,
      mode: 'create',
      name: '',
      code: '',
      address: '',
      phone: '',
      active: true,
      managerId: '',
    });
  };

  const openEditBranchModal = (br: Branch) => {
    setBranchModal({
      open: true,
      mode: 'edit',
      branchId: br.id,
      name: br.name,
      code: br.code,
      address: br.address || '',
      phone: br.phone || '',
      active: br.active,
      managerId: br.managerId || '',
    });
  };

  const handleSaveBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchModal.name.trim() || !branchModal.code.trim()) {
      alert('Branch name and code are required.');
      return;
    }
    try {
      if (branchModal.mode === 'create') {
        await createBranch({
          name: branchModal.name.trim(),
          code: branchModal.code.trim().toUpperCase(),
          address: branchModal.address.trim() || null,
          phone: branchModal.phone.trim() || null,
          active: branchModal.active,
          managerId: branchModal.managerId || null,
        });
        showToast(`Branch ${branchModal.name} created successfully`);
      } else if (branchModal.branchId) {
        await updateBranch(branchModal.branchId, {
          name: branchModal.name.trim(),
          code: branchModal.code.trim().toUpperCase(),
          address: branchModal.address.trim() || null,
          phone: branchModal.phone.trim() || null,
          active: branchModal.active,
          managerId: branchModal.managerId || null,
        });
        showToast(`Branch ${branchModal.name} updated successfully`);
      }
      setBranchModal((b) => ({ ...b, open: false }));
      await loadAllData();
    } catch (err: any) {
      alert(err.message || 'Failed to save branch');
    }
  };

  // --------------------------------------------------------------------------
  // COUNTER MODAL (Create / Edit) & VIEW COUNTER MODAL
  // --------------------------------------------------------------------------
  const [counterModal, setCounterModal] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    counterId?: string;
    name: string;
    code: string;
    branchId: string;
    loginUsername: string;
  }>({
    open: false,
    mode: 'create',
    name: '',
    code: '',
    branchId: '',
    loginUsername: '',
  });

  const [viewCounterModal, setViewCounterModal] = useState<{
    open: boolean;
    counter: CounterItem | null;
  }>({
    open: false,
    counter: null,
  });

  const openEditCounterModal = (c: CounterItem) => {
    setCounterModal({
      open: true,
      mode: 'edit',
      counterId: c.id,
      name: c.name,
      code: c.code,
      branchId: c.branch.id,
      loginUsername: c.loginUsername || '',
    });
  };

  const handleSaveCounter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!counterModal.name.trim() || !counterModal.code.trim()) {
      alert('Counter name and code are required.');
      return;
    }
    try {
      if (counterModal.mode === 'create') {
        await createCounter({
          name: counterModal.name.trim(),
          code: counterModal.code.trim().toUpperCase(),
          branchId: counterModal.branchId,
          loginUsername: counterModal.loginUsername.trim().toLowerCase() || undefined,
        });
        showToast(`Counter ${counterModal.name} created successfully`);
      } else if (counterModal.counterId) {
        await updateCounter(counterModal.counterId, {
          name: counterModal.name.trim(),
          code: counterModal.code.trim().toUpperCase(),
          loginUsername: counterModal.loginUsername.trim().toLowerCase() || undefined,
        });
        showToast(`Counter ${counterModal.name} updated successfully`);
      }
      setCounterModal((c) => ({ ...c, open: false }));
      await loadAllData();
    } catch (err: any) {
      alert(err.message || 'Failed to save counter');
    }
  };

  // --------------------------------------------------------------------------
  // FILTERING LOGIC
  // --------------------------------------------------------------------------
  const filteredManagers = useMemo(() => {
    return managers.filter((m) => {
      if (mgrBranchFilter !== 'ALL') {
        if (mgrBranchFilter === 'NOT_ASSIGNED') {
          if (m.branchId) return false;
        } else if (m.branchId !== mgrBranchFilter) {
          return false;
        }
      }
      if (mgrStatusFilter !== 'ALL') {
        if (m.status !== mgrStatusFilter) return false;
      }
      if (mgrSearch.trim()) {
        const q = mgrSearch.toLowerCase();
        const mName = m.name.toLowerCase().includes(q);
        const mUser = m.username ? m.username.toLowerCase().includes(q) : false;
        const mEmail = m.email ? m.email.toLowerCase().includes(q) : false;
        const mBranch = m.branchName ? m.branchName.toLowerCase().includes(q) : false;
        return mName || mUser || mEmail || mBranch;
      }
      return true;
    });
  }, [managers, mgrSearch, mgrBranchFilter, mgrStatusFilter]);

  const filteredCounters = useMemo(() => {
    return counters.filter((c) => {
      if (cntBranchFilter !== 'ALL' && c.branch.id !== cntBranchFilter) {
        return false;
      }
      if (cntStatusFilter !== 'ALL' && c.status !== cntStatusFilter) {
        return false;
      }
      if (cntSearch.trim()) {
        const q = cntSearch.toLowerCase();
        const matchName = c.name.toLowerCase().includes(q);
        const matchCode = c.code.toLowerCase().includes(q);
        const matchLogin = c.loginUsername ? c.loginUsername.toLowerCase().includes(q) : false;
        const matchBranch = c.branch.name.toLowerCase().includes(q) || c.branch.code.toLowerCase().includes(q);
        return matchName || matchCode || matchLogin || matchBranch;
      }
      return true;
    });
  }, [counters, cntSearch, cntBranchFilter, cntStatusFilter]);

  return (
    <div className="um-page-wrapper">
      <div className="um-container">
        {/* ==================================================================
            A) HEADER
            ================================================================== */}
        <header className="um-header-row">
          <div className="um-header-titles">
            <h1>User Management</h1>
            <p>Manage branches, store managers and their sign-in access.</p>
          </div>
          <div className="um-header-actions">
            <button
              type="button"
              className="um-btn-base um-btn-secondary"
              onClick={openCreateBranchModal}
              aria-label="Create branch"
            >
              <Icons.Building />
              <span>Create branch</span>
            </button>
            <button
              type="button"
              className="um-btn-base um-btn-primary"
              onClick={() => openAddManagerDrawer()}
              aria-label="Add store manager"
            >
              <Icons.UserPlus />
              <span>Add store manager</span>
            </button>
          </div>
        </header>

        {/* ==================================================================
            B) FOUR STAT CARDS
            ================================================================== */}
        <div className="um-stats-grid">
          {/* 1. Branches */}
          <div className="um-stat-card">
            <div className="um-stat-card-header">
              <div className="um-stat-icon-tile purple">
                <Icons.Building />
              </div>
              <span className="um-stat-label">Branches</span>
            </div>
            <div className="um-stat-value">{displayBranchesTotal}</div>
            <div className="um-stat-hint">
              {displayBranchesActive} active · {displayBranchesInactive} inactive
            </div>
          </div>

          {/* 2. Store Managers */}
          <div className="um-stat-card">
            <div className="um-stat-card-header">
              <div className="um-stat-icon-tile blue">
                <Icons.Users />
              </div>
              <span className="um-stat-label">Store Managers</span>
            </div>
            <div className="um-stat-value">{displayManagersTotal}</div>
            <div className="um-stat-hint">
              {displayManagersAssigned} assigned · {displayManagersUnassigned} not assigned
            </div>
          </div>

          {/* 3. Counters */}
          <div className="um-stat-card">
            <div className="um-stat-card-header">
              <div className="um-stat-icon-tile green">
                <Icons.Monitor />
              </div>
              <span className="um-stat-label">Counters</span>
            </div>
            <div className="um-stat-value">{displayCountersTotal}</div>
            <div className="um-stat-hint">
              {displayCountersActive} active · {displayCounterBranches === 1 ? 'across 1 branch' : `across ${displayCounterBranches} branches`}
            </div>
          </div>

          {/* 4. Branches Without Manager */}
          <div className="um-stat-card">
            <div className="um-stat-card-header">
              <div className="um-stat-icon-tile amber">
                <Icons.AlertTriangle />
              </div>
              <span className="um-stat-label">Branches Without Manager</span>
            </div>
            <div className="um-stat-value">{displayBranchesWithoutManager}</div>
            <div className="um-stat-hint">Assign one so the branch can be run</div>
          </div>
        </div>

        {/* ==================================================================
            C) TABS (Underline style)
            ================================================================== */}
        <div className="um-tabs-row" role="tablist" aria-label="User Management Sections">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'managers'}
            className={`um-tab-btn ${activeTab === 'managers' ? 'active' : ''}`}
            onClick={() => handleTabSwitch('managers')}
          >
            <span>Store managers</span>
            <span className="um-tab-badge">{displayManagersTotal}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'branches'}
            className={`um-tab-btn ${activeTab === 'branches' ? 'active' : ''}`}
            onClick={() => handleTabSwitch('branches')}
          >
            <span>Branches</span>
            <span className="um-tab-badge">{displayBranchesTotal}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'counters'}
            className={`um-tab-btn ${activeTab === 'counters' ? 'active' : ''}`}
            onClick={() => handleTabSwitch('counters')}
          >
            <span>All counters</span>
            <span className="um-tab-badge">{displayCountersTotal}</span>
          </button>
        </div>

        {/* ==================================================================
            TAB 1: STORE MANAGERS
            ================================================================== */}
        {activeTab === 'managers' && (
          <div className="um-card">
            <div className="um-toolbar">
              <div className="um-search-wrap">
                <span className="um-search-icon">
                  <Icons.Search />
                </span>
                <input
                  type="text"
                  className="um-search-input"
                  placeholder="Search by name, username, email or branch"
                  value={mgrSearch}
                  onChange={(e) => setMgrSearch(e.target.value)}
                  aria-label="Search store managers"
                />
              </div>

              <select
                className="um-select"
                value={mgrBranchFilter}
                onChange={(e) => setMgrBranchFilter(e.target.value)}
                aria-label="Filter by branch"
              >
                <option value="ALL">All branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
                <option value="NOT_ASSIGNED">Not assigned</option>
              </select>

              <select
                className="um-select"
                value={mgrStatusFilter}
                onChange={(e) => setMgrStatusFilter(e.target.value)}
                aria-label="Filter by status"
              >
                <option value="ALL">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="INVITED">Invited</option>
                <option value="DISABLED">Disabled</option>
              </select>
            </div>

            <div className="um-table-container">
              <table className="um-table">
                <thead>
                  <tr>
                    <th>Manager</th>
                    <th>Assigned Branch</th>
                    <th>Status</th>
                    <th>Last Sign-In</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredManagers.length === 0 ? (
                    <tr>
                      <td colSpan={5}>
                        <div className="um-empty-state">
                          <h3 className="um-empty-title">No store managers found</h3>
                          <p className="um-empty-sub">Try a different search or filter, or add a new store manager.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredManagers.map((mgr) => {
                      const hasUsername = Boolean(mgr.username);
                      const hasEmail = Boolean(mgr.email);

                      return (
                        <tr key={mgr.id}>
                          {/* Manager: Avatar initials + name + username/email */}
                          <td>
                            <div className="um-user-col">
                              <div className="um-avatar-initials">{getInitials(mgr.name)}</div>
                              <div className="um-user-info">
                                <span className="um-user-name">{mgr.name}</span>
                                <span className="um-user-sub">
                                  {hasUsername && <span className="um-user-handle">@{mgr.username}</span>}
                                  {hasUsername && hasEmail && <span> · </span>}
                                  {hasEmail && (
                                    <span className="um-email-with-status">
                                      <span>{mgr.email}</span>
                                      <MailStatusBadge
                                        status={mgr.lastEmailStatus}
                                        error={mgr.lastEmailError}
                                        sentAt={mgr.lastEmailSentAt}
                                        onRetry={() => handleResend(mgr)}
                                      />
                                    </span>
                                  )}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* Assigned Branch */}
                          <td>
                            {mgr.branchName ? (
                              <div className="um-branch-cell">
                                <span className="um-branch-name">{mgr.branchName}</span>
                                <div>
                                  <span className="um-mono-chip">{mgr.branchCode || 'BRANCH'}</span>
                                </div>
                              </div>
                            ) : (
                              <span className="um-warning-text">
                                <Icons.AlertCircle />
                                <span>Not assigned</span>
                              </span>
                            )}
                          </td>

                          {/* Status Pill */}
                          <td>
                            <span className={`um-status-pill ${mgr.status.toLowerCase()}`}>
                              <span className="um-status-dot" />
                              <span>{mgr.status === 'ACTIVE' ? 'Active' : mgr.status === 'INVITED' ? 'Invited' : 'Disabled'}</span>
                            </span>
                          </td>

                          {/* Last Sign-in */}
                          <td>
                            <span style={{ color: '#5F5B76' }}>{formatDate(mgr.lastLoginAt)}</span>
                          </td>

                          {/* Actions */}
                          <td>
                            <div className="um-row-actions">
                              <button
                                type="button"
                                className="um-action-btn edit"
                                onClick={() => openEditManagerDrawer(mgr)}
                                aria-label="Edit manager"
                                title="Edit manager"
                              >
                                <Icons.Pencil />
                                <span className="um-tooltip">Edit</span>
                              </button>
                              <button
                                type="button"
                                className="um-action-btn key"
                                onClick={() => handleResetPasswordClick(mgr)}
                                aria-label="Reset password"
                                title="Reset password"
                              >
                                <Icons.Key />
                                <span className="um-tooltip">Reset password</span>
                              </button>
                              {mgr.email && (
                                <button
                                  type="button"
                                  className="um-action-btn mail"
                                  onClick={() => handleResend(mgr)}
                                  aria-label="Resend sign-in details"
                                  title="Resend sign-in details"
                                >
                                  <Icons.Send />
                                  <span className="um-tooltip">Resend email</span>
                                </button>
                              )}
                              {mgr.status === 'DISABLED' ? (
                                <button
                                  type="button"
                                  className="um-action-btn enable"
                                  onClick={() => handleToggleManagerStatus(mgr)}
                                  aria-label="Enable manager"
                                  title="Enable manager"
                                >
                                  <Icons.Power />
                                  <span className="um-tooltip">Enable manager</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="um-action-btn disable"
                                  onClick={() => handleToggleManagerStatus(mgr)}
                                  aria-label="Disable manager"
                                  title="Disable manager"
                                >
                                  <Icons.Power />
                                  <span className="um-tooltip">Disable manager</span>
                                </button>
                              )}
                              <button
                                type="button"
                                className="um-action-btn delete"
                                onClick={() => handleOpenDelete('manager', mgr.id, mgr.name)}
                                aria-label="Delete manager"
                                title="Delete manager"
                              >
                                <Icons.Trash />
                                <span className="um-tooltip">Delete manager</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="um-footer-strip">
              <span>Showing {filteredManagers.length} of {managers.length} store managers</span>
            </div>
          </div>
        )}

        {/* ==================================================================
            TAB 2: BRANCHES
            ================================================================== */}
        {activeTab === 'branches' && (
          <div className="um-card">
            <div className="um-table-container">
              <table className="um-table">
                <thead>
                  <tr>
                    <th>Branch</th>
                    <th>Code</th>
                    <th>Store Manager</th>
                    <th>Counters</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {branches.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="um-empty-state">
                          <h3 className="um-empty-title">No branches found</h3>
                          <p className="um-empty-sub">Click "Create branch" to add your first branch.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    branches.map((br) => {
                      const countersTotal = br.countersTotal ?? (Array.isArray(br.counters) ? br.counters.length : 1);
                      const countersActive = br.countersActive ?? (br.active ? countersTotal : 0);

                      return (
                        <tr key={br.id}>
                          {/* Branch name + Created date */}
                          <td>
                            <div className="um-branch-cell">
                              <span className="um-branch-name">{br.name}</span>
                              <span style={{ fontSize: '13px', color: '#5F5B76' }}>
                                {formatCreatedDate(br.createdAt)}
                              </span>
                            </div>
                          </td>

                          {/* Code */}
                          <td>
                            <span className="um-mono-chip">{br.code}</span>
                          </td>

                          {/* Store Manager */}
                          <td>
                            {br.managerName ? (
                              <div className="um-user-col">
                                <div className="um-avatar-initials sm">{getInitials(br.managerName)}</div>
                                <div className="um-user-info">
                                  <span className="um-user-name" style={{ fontSize: '13.5px' }}>{br.managerName}</span>
                                  <span className="um-user-sub" style={{ fontSize: '12.5px' }}>
                                    {br.managerEmail || (br.managerUsername ? `@${br.managerUsername}` : '')}
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <span className="um-warning-text">
                                <Icons.AlertCircle />
                                <span>Not assigned</span>
                              </span>
                            )}
                          </td>

                          {/* Counters count */}
                          <td>
                            <span style={{ color: '#1A1830', fontWeight: 500 }}>
                              {countersTotal} total · {countersActive} active
                            </span>
                          </td>

                          {/* Status */}
                          <td>
                            <span className={`um-status-pill ${br.active ? 'active' : 'inactive'}`}>
                              <span className="um-status-dot" />
                              <span>{br.active ? 'Active' : 'Inactive'}</span>
                            </span>
                          </td>

                          {/* Actions */}
                          <td>
                            <div className="um-row-actions">
                              <button
                                type="button"
                                className="um-action-btn view"
                                onClick={() => setViewBranchModal({ open: true, branch: br })}
                                aria-label="View branch"
                                title="View branch"
                              >
                                <Icons.Eye />
                                <span className="um-tooltip">View branch</span>
                              </button>
                              <button
                                type="button"
                                className="um-action-btn edit"
                                onClick={() => openEditBranchModal(br)}
                                aria-label="Edit branch"
                                title="Edit branch"
                              >
                                <Icons.Pencil />
                                <span className="um-tooltip">Edit branch</span>
                              </button>
                              <button
                                type="button"
                                className="um-action-btn manager"
                                onClick={() => openAddManagerDrawer(br.id)}
                                aria-label={br.managerName ? `Change manager (${br.managerName})` : 'Assign manager'}
                                title={br.managerName ? `Change manager (${br.managerName})` : 'Assign manager'}
                              >
                                <Icons.UserPlus />
                                <span className="um-tooltip">{br.managerName ? 'Change manager' : 'Assign manager'}</span>
                              </button>
                              <button
                                type="button"
                                className="um-action-btn delete"
                                onClick={() => handleOpenDelete('branch', br.id, br.name, br.code)}
                                aria-label={`Delete ${br.name}`}
                                title="Delete branch"
                              >
                                <Icons.Trash />
                                <span className="um-tooltip">Delete branch</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="um-footer-strip">
              <span>Showing {branches.length} branches</span>
            </div>
          </div>
        )}

        {/* ==================================================================
            TAB 3: ALL COUNTERS
            ================================================================== */}
        {activeTab === 'counters' && (
          <div className="um-card">
            <div className="um-toolbar">
              <div className="um-search-wrap">
                <span className="um-search-icon">
                  <Icons.Search />
                </span>
                <input
                  type="text"
                  className="um-search-input"
                  placeholder="Search by counter name, code, login or branch"
                  value={cntSearch}
                  onChange={(e) => setCntSearch(e.target.value)}
                  aria-label="Search counters"
                />
              </div>

              <select
                className="um-select"
                value={cntBranchFilter}
                onChange={(e) => setCntBranchFilter(e.target.value)}
                aria-label="Filter counters by branch"
              >
                <option value="ALL">All branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>

              <select
                className="um-select"
                value={cntStatusFilter}
                onChange={(e) => setCntStatusFilter(e.target.value)}
                aria-label="Filter counters by status"
              >
                <option value="ALL">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="DISABLED">Disabled</option>
              </select>
            </div>

            <div className="um-table-container">
              <table className="um-table">
                <thead>
                  <tr>
                    <th>Counter</th>
                    <th>Branch</th>
                    <th>Counter Login</th>
                    <th>Branch Manager</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCounters.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="um-empty-state">
                          <h3 className="um-empty-title">No counters found</h3>
                          <p className="um-empty-sub">Try a different search or filter.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredCounters.map((cnt) => (
                      <tr key={cnt.id}>
                        {/* Counter: monitor tile + name + code */}
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div
                              style={{
                                width: '40px',
                                height: '40px',
                                borderRadius: '10px',
                                backgroundColor: '#EFEEF7',
                                color: '#4A4760',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                              }}
                            >
                              <Icons.Monitor />
                            </div>
                            <div className="um-user-info">
                              <span className="um-user-name">{cnt.name}</span>
                              <div>
                                <span className="um-mono-chip">{cnt.code}</span>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Branch + inactive warning */}
                        <td>
                          <div className="um-branch-cell">
                            <span className="um-branch-name">{cnt.branch.name}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span className="um-mono-chip">{cnt.branch.code}</span>
                              {!cnt.branch.active && (
                                <span style={{ color: '#B42318', fontSize: '12px', fontWeight: 600 }}>
                                  Branch inactive
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Counter Login */}
                        <td>
                          {cnt.loginUsername ? (
                            <span className="um-user-handle" style={{ fontSize: '13.5px' }}>
                              @{cnt.loginUsername}
                            </span>
                          ) : (
                            <span style={{ color: '#8C88A2' }}>—</span>
                          )}
                        </td>

                        {/* Branch Manager */}
                        <td>
                          {cnt.manager ? (
                            <span style={{ fontWeight: 600, color: '#1A1830' }}>{cnt.manager.name}</span>
                          ) : (
                            <span className="um-warning-text">
                              <Icons.AlertCircle />
                              <span>Not assigned</span>
                            </span>
                          )}
                        </td>

                        {/* Status */}
                        <td>
                          <span className={`um-status-pill ${cnt.status.toLowerCase()}`}>
                            <span className="um-status-dot" />
                            <span>{cnt.status === 'ACTIVE' ? 'Active' : 'Disabled'}</span>
                          </span>
                        </td>

                        {/* Actions */}
                        <td>
                          <div className="um-row-actions">
                            <button
                              type="button"
                              className="um-action-btn view"
                              onClick={() => setViewCounterModal({ open: true, counter: cnt })}
                              aria-label="View counter"
                              title="View counter"
                            >
                              <Icons.Eye />
                              <span className="um-tooltip">View counter</span>
                            </button>
                            <button
                              type="button"
                              className="um-action-btn edit"
                              onClick={() => openEditCounterModal(cnt)}
                              aria-label="Edit counter"
                              title="Edit counter"
                            >
                              <Icons.Pencil />
                              <span className="um-tooltip">Edit counter</span>
                            </button>
                            {cnt.status === 'DISABLED' ? (
                              <button
                                type="button"
                                className="um-action-btn enable"
                                onClick={() => handleToggleCounterStatus(cnt)}
                                aria-label="Enable counter"
                                title="Enable counter"
                              >
                                <Icons.Power />
                                <span className="um-tooltip">Enable counter</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="um-action-btn disable"
                                onClick={() => handleToggleCounterStatus(cnt)}
                                aria-label="Disable counter"
                                title="Disable counter"
                              >
                                <Icons.Power />
                                <span className="um-tooltip">Disable counter</span>
                              </button>
                            )}
                            <button
                              type="button"
                              className="um-action-btn delete"
                              onClick={() => handleOpenDelete('counter', cnt.id, cnt.name, cnt.code)}
                              aria-label={`Delete ${cnt.name}`}
                              title="Delete counter"
                            >
                              <Icons.Trash />
                              <span className="um-tooltip">Delete counter</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="um-footer-strip">
              <span>Showing {filteredCounters.length} of {counters.length} counters</span>
            </div>
          </div>
        )}

        {/* ==================================================================
            DRAWER: ADD / EDIT STORE MANAGER
            ================================================================== */}
        {isDrawerOpen && (
          <div
            className="um-drawer-overlay"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget) handleCloseDrawer();
            }}
          >
            <div
              className="um-drawer"
              role="dialog"
              aria-modal="true"
              aria-labelledby="um-drawer-heading"
            >
              {/* Header */}
              <div className="um-drawer-header">
                <div className="um-drawer-title-group">
                  <h2 id="um-drawer-heading">
                    {editingManager ? 'Edit store manager' : 'Add store manager'}
                  </h2>
                  <p>They can sign in with their username or email ID, plus this password.</p>
                </div>
                <button
                  type="button"
                  className="um-drawer-close-btn"
                  onClick={handleCloseDrawer}
                  aria-label="Close drawer"
                >
                  <Icons.Close />
                </button>
              </div>

              {/* Body */}
              <form onSubmit={handleSaveManager} className="um-drawer-body">
                {drawerError && <div className="um-error-banner">{drawerError}</div>}

                {/* "Pick an existing manager" section if opened from branch assignment */}
                {drawerPreselectedBranchId && unassignedManagers.length > 0 && !editingManager && (
                  <div className="um-pick-existing-panel">
                    <span className="um-pick-title">Or pick an existing unassigned manager:</span>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <select
                        className="um-select"
                        style={{ flex: 1, height: '40px' }}
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) handlePickExistingManager(e.target.value);
                        }}
                      >
                        <option value="" disabled>
                          Select unassigned manager...
                        </option>
                        {unassignedManagers.map((um) => (
                          <option key={um.id} value={um.id}>
                            {um.name} ({um.username ? `@${um.username}` : um.email})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* Field 1: Full Name */}
                <div className="um-form-group">
                  <label className="um-form-label" htmlFor="um-mgr-fullname">
                    <span>Full name *</span>
                  </label>
                  <input
                    id="um-mgr-fullname"
                    type="text"
                    className="um-form-input"
                    placeholder="e.g. Anitha Kumar"
                    value={formName}
                    onChange={(e) => {
                      setFormName(e.target.value);
                      setFormDirty(true);
                    }}
                    required
                    minLength={2}
                  />
                </div>

                {/* Field 2: Sign-in ID Group Box */}
                <div className={`um-signin-group-box ${signinBoxStatus.ok ? 'valid' : ''}`}>
                  <h3 className="um-signin-group-title">Sign-in ID *</h3>
                  <p className="um-signin-group-sub">
                    Add a username, an email ID, or both. Whichever you add can be used to sign in; the other is optional.
                  </p>

                  {/* Username */}
                  <div className="um-form-group">
                    <label className="um-form-label" htmlFor="um-mgr-username">
                      <span>Username {Boolean(formEmail.trim()) && <span style={{ color: '#5F5B76', fontWeight: 400 }}>(optional)</span>}</span>
                    </label>
                    <div className="um-input-prefix-wrap">
                      <span className="um-input-prefix">@</span>
                      <input
                        id="um-mgr-username"
                        type="text"
                        className="um-form-input has-prefix"
                        placeholder="username"
                        value={formUsername}
                        autoCapitalize="none"
                        autoComplete="off"
                        spellCheck="false"
                        onChange={(e) => {
                          const val = e.target.value.toLowerCase().replace(/\s+/g, '');
                          setFormUsername(val);
                          setFormDirty(true);
                        }}
                      />
                      {!formUsername && usernameSuggestion && (
                        <button
                          type="button"
                          className="um-suggestion-btn"
                          onClick={() => {
                            setFormUsername(usernameSuggestion);
                            setFormDirty(true);
                          }}
                        >
                          Use @{usernameSuggestion}
                        </button>
                      )}
                    </div>

                    {formUsername.trim() ? (
                      usernameAvailability.error ? (
                        <div className="um-field-helper error">{usernameAvailability.error}</div>
                      ) : usernameAvailability.available && usernameAvailability.checked ? (
                        <div className="um-field-helper success">@{formUsername.trim()} is available.</div>
                      ) : null
                    ) : (
                      <div className="um-field-helper">
                        4–20 characters, lowercase letters, numbers, dot or underscore.
                      </div>
                    )}
                  </div>

                  <div className="um-or-divider">—— OR ——</div>

                  {/* Email ID */}
                  <div className="um-form-group">
                    <label className="um-form-label" htmlFor="um-mgr-email">
                      <span>Email ID {Boolean(formUsername.trim()) && <span style={{ color: '#5F5B76', fontWeight: 400 }}>(optional)</span>}</span>
                    </label>
                    <input
                      id="um-mgr-email"
                      type="email"
                      className="um-form-input"
                      placeholder="anitha.k@example.com"
                      value={formEmail}
                      onChange={(e) => {
                        setFormEmail(e.target.value);
                        setFormDirty(true);
                      }}
                    />
                    {formEmail.trim() ? (
                      emailAvailability.error ? (
                        <div className="um-field-helper error">{emailAvailability.error}</div>
                      ) : (
                        <div className="um-field-helper success">Email is available.</div>
                      )
                    ) : (
                      <div className="um-field-helper">Needed if you want to email the sign-in details.</div>
                    )}
                  </div>

                  {/* Status Bar */}
                  <div className={`um-signin-status-bar ${signinBoxStatus.type}`}>
                    {signinBoxStatus.ok && <Icons.Check />}
                    <span>{signinBoxStatus.message}</span>
                  </div>
                </div>

                {/* Field 3: Password */}
                <div className="um-form-group">
                  <div className="um-form-label">
                    <span>Password {!editingManager && '*'}</span>
                    <button
                      type="button"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#5B3BE8',
                        cursor: 'pointer',
                        fontSize: '12.5px',
                        fontWeight: 600,
                        padding: 0,
                      }}
                      onClick={() => {
                        const newP = generateClientPassword();
                        setFormPassword(newP);
                        setFormDirty(true);
                      }}
                    >
                      Generate strong password
                    </button>
                  </div>

                  <div className="um-pw-wrap">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      className="um-form-input mono"
                      placeholder={editingManager ? 'Leave blank to keep current password' : '••••••••••••'}
                      value={formPassword}
                      onChange={(e) => {
                        setFormPassword(e.target.value);
                        setFormDirty(true);
                      }}
                    />
                    <div className="um-pw-actions">
                      <button
                        type="button"
                        className="um-pw-btn"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <Icons.EyeOff /> : <Icons.Eye />}
                      </button>
                      {formPassword && (
                        <button
                          type="button"
                          className="um-pw-btn"
                          onClick={() => {
                            navigator.clipboard.writeText(formPassword);
                            showToast('Password copied to clipboard');
                          }}
                          aria-label="Copy password"
                        >
                          <Icons.Copy />
                        </button>
                      )}
                    </div>
                  </div>

                  {formPassword && (
                    <>
                      <div className="um-pw-strength-bar">
                        {[1, 2, 3, 4].map((step) => (
                          <div
                            key={step}
                            className="um-pw-strength-segment"
                            style={{
                              backgroundColor: step <= pwStrength.score ? pwStrength.color : '#E6E4F0',
                            }}
                          />
                        ))}
                      </div>
                      <div className="um-pw-strength-label" style={{ color: pwStrength.color }}>
                        Strength: {pwStrength.label}
                      </div>

                      <div className="um-pw-checklist">
                        <div className={`um-pw-check-item ${pwRules.length ? 'met' : ''}`}>
                          <Icons.Check />
                          <span>At least 8 characters</span>
                        </div>
                        <div className={`um-pw-check-item ${pwRules.casing ? 'met' : ''}`}>
                          <Icons.Check />
                          <span>Upper and lower case letters</span>
                        </div>
                        <div className={`um-pw-check-item ${pwRules.number ? 'met' : ''}`}>
                          <Icons.Check />
                          <span>At least one number</span>
                        </div>
                        <div className={`um-pw-check-item ${pwRules.symbol ? 'met' : ''}`}>
                          <Icons.Check />
                          <span>At least one symbol (e.g. # @ !)</span>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Field 4: Assign to Branch */}
                <div className="um-form-group">
                  <label className="um-form-label" htmlFor="um-mgr-branch">
                    <span>Assign to branch</span>
                  </label>
                  <select
                    id="um-mgr-branch"
                    className="um-select"
                    value={formBranchId}
                    onChange={(e) => {
                      setFormBranchId(e.target.value);
                      setFormDirty(true);
                    }}
                  >
                    <option value="">No branch (unassigned)</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.code}) · {b.active ? 'active' : 'inactive'}
                      </option>
                    ))}
                  </select>
                  {targetBranchCurrentManager && (
                    <div className="um-field-helper" style={{ color: '#8A5300', fontWeight: 500 }}>
                      ⚠ This branch is currently managed by {targetBranchCurrentManager}. Assigning will unassign them.
                    </div>
                  )}
                  <div className="um-field-helper">You can assign or change the branch later.</div>
                </div>

                {/* Field 5: Mobile Number */}
                <div className="um-form-group">
                  <label className="um-form-label" htmlFor="um-mgr-phone">
                    <span>Mobile number (optional)</span>
                  </label>
                  <input
                    id="um-mgr-phone"
                    type="tel"
                    className="um-form-input"
                    placeholder="e.g. +91 98765 43210"
                    value={formPhone}
                    onChange={(e) => {
                      setFormPhone(e.target.value);
                      setFormDirty(true);
                    }}
                  />
                </div>

                {/* Checkboxes box */}
                <div className="um-options-box">
                  <label className="um-checkbox-label">
                    <input
                      type="checkbox"
                      className="um-checkbox-input"
                      checked={formSendEmail}
                      disabled={!formEmail.trim()}
                      onChange={(e) => setFormSendEmail(e.target.checked)}
                    />
                    <div className="um-checkbox-text">
                      <span className="um-checkbox-title">Email sign-in details to the manager</span>
                      <span className="um-checkbox-hint">
                        {!formEmail.trim()
                          ? 'Add an email address above to enable sending login details.'
                          : 'Sends their username, temporary password and login link.'}
                      </span>
                    </div>
                  </label>

                  <label className="um-checkbox-label">
                    <input
                      type="checkbox"
                      className="um-checkbox-input"
                      checked={formMustChangePassword}
                      onChange={(e) => setFormMustChangePassword(e.target.checked)}
                    />
                    <div className="um-checkbox-text">
                      <span className="um-checkbox-title">Ask to change password on first sign-in</span>
                      <span className="um-checkbox-hint">
                        Manager will be prompted to choose a new private password immediately after logging in.
                      </span>
                    </div>
                  </label>
                </div>

                {/* Footer Buttons */}
                <div className="um-drawer-footer">
                  <button
                    type="button"
                    className="um-btn-base um-btn-secondary"
                    onClick={handleCloseDrawer}
                    disabled={isSubmittingManager}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="um-btn-base um-btn-primary"
                    disabled={isSubmittingManager || !signinBoxStatus.ok}
                  >
                    {isSubmittingManager
                      ? 'Saving...'
                      : editingManager
                      ? 'Save changes'
                      : 'Create manager'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ==================================================================
            MODAL: RESET PASSWORD RESULT
            ================================================================== */}
        {resetModalData.open && (
          <div className="um-modal-overlay" role="presentation">
            <div className="um-modal-card" role="dialog" aria-modal="true" aria-labelledby="um-pw-modal-title">
              <div className="um-modal-header">
                <h3 id="um-pw-modal-title" className="um-modal-title">Temporary Password Generated</h3>
                <button
                  type="button"
                  className="um-drawer-close-btn"
                  onClick={() => setResetModalData((d) => ({ ...d, open: false }))}
                  aria-label="Close"
                >
                  <Icons.Close />
                </button>
              </div>
              <div className="um-modal-body">
                <p>
                  Share this temporary password with <strong>{resetModalData.managerName}</strong>. They will be prompted to change it when they sign in.
                </p>
                <div className="um-temp-password-box">
                  <span className="um-temp-password-code">{resetModalData.temporaryPassword}</span>
                  <button
                    type="button"
                    className="um-btn-base um-btn-secondary"
                    style={{ minHeight: '36px', padding: '0 12px' }}
                    onClick={() => {
                      navigator.clipboard.writeText(resetModalData.temporaryPassword);
                      showToast('Temporary password copied');
                    }}
                  >
                    <Icons.Copy />
                    <span>Copy</span>
                  </button>
                </div>
                {resetModalData.managerEmail && (
                  <p style={{ fontSize: '13px', color: '#5F5B76' }}>
                    Sign-in instructions have also been queued for <strong>{resetModalData.managerEmail}</strong>.
                  </p>
                )}
              </div>
              <div className="um-modal-footer">
                <button
                  type="button"
                  className="um-btn-base um-btn-primary"
                  onClick={() => setResetModalData((d) => ({ ...d, open: false }))}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================================
            MODAL: CONFIRM ACTION (Disable / Enable)
            ================================================================== */}
        {confirmDialog.open && (
          <div className="um-modal-overlay" role="presentation">
            <div className="um-modal-card" role="dialog" aria-modal="true" aria-labelledby="um-confirm-title">
              <div className="um-modal-header">
                <h3 id="um-confirm-title" className="um-modal-title">{confirmDialog.title}</h3>
                <button
                  type="button"
                  className="um-drawer-close-btn"
                  onClick={() => setConfirmDialog((c) => ({ ...c, open: false }))}
                  aria-label="Close"
                >
                  <Icons.Close />
                </button>
              </div>
              <div className="um-modal-body">
                <p>{confirmDialog.message}</p>
              </div>
              <div className="um-modal-footer">
                <button
                  type="button"
                  className="um-btn-base um-btn-secondary"
                  onClick={() => setConfirmDialog((c) => ({ ...c, open: false }))}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={`um-btn-base ${confirmDialog.danger ? 'um-btn-action danger' : 'um-btn-primary'}`}
                  style={{ minHeight: '40px', padding: '0 16px' }}
                  onClick={confirmDialog.onConfirm}
                >
                  {confirmDialog.confirmText}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================================
            MODAL: CREATE / EDIT BRANCH
            ================================================================== */}
        {branchModal.open && (
          <div className="um-modal-overlay" role="presentation">
            <div className="um-modal-card" role="dialog" aria-modal="true">
              <div className="um-modal-header">
                <h3 className="um-modal-title">
                  {branchModal.mode === 'create' ? 'Create branch' : 'Edit branch'}
                </h3>
                <button
                  type="button"
                  className="um-drawer-close-btn"
                  onClick={() => setBranchModal((b) => ({ ...b, open: false }))}
                >
                  <Icons.Close />
                </button>
              </div>
              <form onSubmit={handleSaveBranch}>
                <div className="um-modal-body">
                  <div className="um-form-group">
                    <label className="um-form-label">Branch Name *</label>
                    <input
                      type="text"
                      className="um-form-input"
                      placeholder="e.g. Shree Krishna–PORUR"
                      value={branchModal.name}
                      onChange={(e) => setBranchModal({ ...branchModal, name: e.target.value })}
                      required
                    />
                  </div>

                  <div className="um-form-group">
                    <label className="um-form-label">Branch Code *</label>
                    <input
                      type="text"
                      className="um-form-input mono"
                      placeholder="e.g. SKS_POR"
                      value={branchModal.code}
                      onChange={(e) => setBranchModal({ ...branchModal, code: e.target.value.toUpperCase() })}
                      required
                    />
                  </div>

                  <div className="um-form-group">
                    <label className="um-form-label">Store Manager</label>
                    <select
                      className="um-select"
                      value={branchModal.managerId}
                      onChange={(e) => setBranchModal({ ...branchModal, managerId: e.target.value })}
                    >
                      <option value="">No manager (unassigned)</option>
                      {managers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.username ? `@${m.username}` : m.email})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="um-form-group">
                    <label className="um-form-label">Address</label>
                    <input
                      type="text"
                      className="um-form-input"
                      placeholder="Street, locality, city"
                      value={branchModal.address}
                      onChange={(e) => setBranchModal({ ...branchModal, address: e.target.value })}
                    />
                  </div>

                  <div className="um-form-group">
                    <label className="um-form-label">Phone</label>
                    <input
                      type="tel"
                      className="um-form-input"
                      placeholder="+91 98765 43210"
                      value={branchModal.phone}
                      onChange={(e) => setBranchModal({ ...branchModal, phone: e.target.value })}
                    />
                  </div>

                  <label className="um-checkbox-label">
                    <input
                      type="checkbox"
                      className="um-checkbox-input"
                      checked={branchModal.active}
                      onChange={(e) => setBranchModal({ ...branchModal, active: e.target.checked })}
                    />
                    <div className="um-checkbox-text">
                      <span className="um-checkbox-title">Active branch</span>
                      <span className="um-checkbox-hint">Inactive branches cannot process transactions.</span>
                    </div>
                  </label>
                </div>
                <div className="um-modal-footer">
                  <button
                    type="button"
                    className="um-btn-base um-btn-secondary"
                    onClick={() => setBranchModal((b) => ({ ...b, open: false }))}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="um-btn-base um-btn-primary">
                    {branchModal.mode === 'create' ? 'Create branch' : 'Save branch'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ==================================================================
            MODAL: VIEW BRANCH DETAILS
            ================================================================== */}
        {viewBranchModal.open && viewBranchModal.branch && (
          <div className="um-modal-overlay" role="presentation">
            <div className="um-modal-card" role="dialog" aria-modal="true">
              <div className="um-modal-header">
                <h3 className="um-modal-title">{viewBranchModal.branch.name}</h3>
                <button
                  type="button"
                  className="um-drawer-close-btn"
                  onClick={() => setViewBranchModal({ open: false, branch: null })}
                >
                  <Icons.Close />
                </button>
              </div>
              <div className="um-modal-body">
                <div>
                  <span style={{ fontSize: '12px', color: '#5F5B76', fontWeight: 600 }}>CODE</span>
                  <div><span className="um-mono-chip">{viewBranchModal.branch.code}</span></div>
                </div>
                <div>
                  <span style={{ fontSize: '12px', color: '#5F5B76', fontWeight: 600 }}>STATUS</span>
                  <div>
                    <span className={`um-status-pill ${viewBranchModal.branch.active ? 'active' : 'inactive'}`}>
                      <span className="um-status-dot" />
                      <span>{viewBranchModal.branch.active ? 'Active' : 'Inactive'}</span>
                    </span>
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '12px', color: '#5F5B76', fontWeight: 600 }}>STORE MANAGER</span>
                  <div>
                    {viewBranchModal.branch.managerName ? (
                      <span style={{ fontWeight: 600 }}>{viewBranchModal.branch.managerName}</span>
                    ) : (
                      <span className="um-warning-text"><Icons.AlertCircle /> Not assigned</span>
                    )}
                  </div>
                </div>
                {viewBranchModal.branch.address && (
                  <div>
                    <span style={{ fontSize: '12px', color: '#5F5B76', fontWeight: 600 }}>ADDRESS</span>
                    <div style={{ color: '#1A1830' }}>{viewBranchModal.branch.address}</div>
                  </div>
                )}
                {viewBranchModal.branch.phone && (
                  <div>
                    <span style={{ fontSize: '12px', color: '#5F5B76', fontWeight: 600 }}>PHONE</span>
                    <div style={{ color: '#1A1830' }}>{viewBranchModal.branch.phone}</div>
                  </div>
                )}
                <div>
                  <span style={{ fontSize: '12px', color: '#5F5B76', fontWeight: 600 }}>COUNTERS</span>
                  <div style={{ color: '#1A1830' }}>
                    {viewBranchModal.branch.countersTotal ?? 1} total · {viewBranchModal.branch.countersActive ?? 1} active
                  </div>
                </div>
              </div>
              <div className="um-modal-footer">
                <button
                  type="button"
                  className="um-btn-base um-btn-primary"
                  onClick={() => setViewBranchModal({ open: false, branch: null })}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================================
            MODAL: EDIT COUNTER
            ================================================================== */}
        {counterModal.open && (
          <div className="um-modal-overlay" role="presentation">
            <div className="um-modal-card" role="dialog" aria-modal="true">
              <div className="um-modal-header">
                <h3 className="um-modal-title">
                  {counterModal.mode === 'create' ? 'Create counter' : 'Edit counter'}
                </h3>
                <button
                  type="button"
                  className="um-drawer-close-btn"
                  onClick={() => setCounterModal((c) => ({ ...c, open: false }))}
                >
                  <Icons.Close />
                </button>
              </div>
              <form onSubmit={handleSaveCounter}>
                <div className="um-modal-body">
                  <div className="um-form-group">
                    <label className="um-form-label">Counter Name *</label>
                    <input
                      type="text"
                      className="um-form-input"
                      placeholder="e.g. Counter 1"
                      value={counterModal.name}
                      onChange={(e) => setCounterModal({ ...counterModal, name: e.target.value })}
                      required
                    />
                  </div>

                  <div className="um-form-group">
                    <label className="um-form-label">Counter Code *</label>
                    <input
                      type="text"
                      className="um-form-input mono"
                      placeholder="e.g. MAIN-C01"
                      value={counterModal.code}
                      onChange={(e) => setCounterModal({ ...counterModal, code: e.target.value.toUpperCase() })}
                      required
                    />
                  </div>

                  <div className="um-form-group">
                    <label className="um-form-label">Counter Login Username</label>
                    <div className="um-input-prefix-wrap">
                      <span className="um-input-prefix">@</span>
                      <input
                        type="text"
                        className="um-form-input has-prefix"
                        placeholder="sks_main_c1"
                        value={counterModal.loginUsername}
                        onChange={(e) => setCounterModal({ ...counterModal, loginUsername: e.target.value.toLowerCase().replace(/\s+/g, '') })}
                      />
                    </div>
                  </div>
                </div>
                <div className="um-modal-footer">
                  <button
                    type="button"
                    className="um-btn-base um-btn-secondary"
                    onClick={() => setCounterModal((c) => ({ ...c, open: false }))}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="um-btn-base um-btn-primary">
                    Save counter
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ==================================================================
            MODAL: VIEW COUNTER
            ================================================================== */}
        {viewCounterModal.open && viewCounterModal.counter && (
          <div className="um-modal-overlay" role="presentation">
            <div className="um-modal-card" role="dialog" aria-modal="true">
              <div className="um-modal-header">
                <h3 className="um-modal-title">{viewCounterModal.counter.name}</h3>
                <button
                  type="button"
                  className="um-drawer-close-btn"
                  onClick={() => setViewCounterModal({ open: false, counter: null })}
                >
                  <Icons.Close />
                </button>
              </div>
              <div className="um-modal-body">
                <div>
                  <span style={{ fontSize: '12px', color: '#5F5B76', fontWeight: 600 }}>CODE</span>
                  <div><span className="um-mono-chip">{viewCounterModal.counter.code}</span></div>
                </div>
                <div>
                  <span style={{ fontSize: '12px', color: '#5F5B76', fontWeight: 600 }}>BRANCH</span>
                  <div style={{ fontWeight: 600 }}>
                    {viewCounterModal.counter.branch.name} ({viewCounterModal.counter.branch.code})
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '12px', color: '#5F5B76', fontWeight: 600 }}>LOGIN USERNAME</span>
                  <div className="um-user-handle" style={{ fontSize: '14px' }}>
                    {viewCounterModal.counter.loginUsername ? `@${viewCounterModal.counter.loginUsername}` : '—'}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '12px', color: '#5F5B76', fontWeight: 600 }}>BRANCH MANAGER</span>
                  <div>
                    {viewCounterModal.counter.manager ? (
                      <span style={{ fontWeight: 600 }}>{viewCounterModal.counter.manager.name}</span>
                    ) : (
                      <span className="um-warning-text"><Icons.AlertCircle /> Not assigned</span>
                    )}
                  </div>
                </div>
                <div>
                  <span style={{ fontSize: '12px', color: '#5F5B76', fontWeight: 600 }}>STATUS</span>
                  <div>
                    <span className={`um-status-pill ${viewCounterModal.counter.status.toLowerCase()}`}>
                      <span className="um-status-dot" />
                      <span>{viewCounterModal.counter.status === 'ACTIVE' ? 'Active' : 'Disabled'}</span>
                    </span>
                  </div>
                </div>
              </div>
              <div className="um-modal-footer">
                <button
                  type="button"
                  className="um-btn-base um-btn-primary"
                  onClick={() => setViewCounterModal({ open: false, counter: null })}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ==================================================================
            PERMANENT DELETE CONFIRMATION MODAL
            ================================================================== */}
        {deleteModal.open && (
          <DeleteConfirmModal
            type={deleteModal.type}
            id={deleteModal.id}
            name={deleteModal.name}
            code={deleteModal.code}
            isBranchScope={false}
            isOpen={deleteModal.open}
            onClose={() => setDeleteModal((prev) => ({ ...prev, open: false }))}
            onDeleted={handleDeleted}
            onError={(err) => {
              console.error('Delete error:', err);
              showToast(err.message || `Could not delete ${deleteModal.name}`, true);
            }}
            onDisableInstead={handleDisableInstead}
          />
        )}

        {/* ==================================================================
            TOAST NOTIFICATION (Bottom Centre, Dark #1A1830)
            ================================================================== */}
        {toast && (
          <div className="um-toast-container" role="status" aria-live="polite">
            <span className="um-toast-tick">✓</span>
            <span>{toast.text}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserManagementView;
