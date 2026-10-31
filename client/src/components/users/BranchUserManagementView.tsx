import React, { useState, useEffect, useMemo, useRef } from 'react';
import './userManagement.css';
import { DeleteConfirmModal, type DeleteEntityType } from './DeleteConfirmModal.tsx';
import { MailStatusBadge } from './MailStatusBadge.tsx';
import { resendBranchUserCredentials } from '../../api.ts';
import {
  fetchBranchUsersSummary,
  fetchBranchCountersNextCode,
  fetchBranchCounters,
  createBranchCounter,
  updateBranchCounter,
  fetchBranchCashiers,
  createBranchCashier,
  updateBranchCashier,
  resetBranchUserPassword,
  updateBranchUserStatus,
  checkUserUsernameAvailability,
  checkUserEmailAvailability,
  type BranchUsersSummary,
  type BranchCounterItem,
  type BranchCashierItem,
  type BranchCounterInput,
  type BranchCashierInput,
  type User,
} from '../../api.ts';

// ============================================================================
// ICONS (Thin stroke, Lucide style, accessible)
// ============================================================================
const Icons = {
  Lock: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  Monitor: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
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
  Close: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
};

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

/** Generates strong 12-char password without confusing lookalikes */
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

interface BranchUserManagementViewProps {
  user?: User | null;
}

export const BranchUserManagementView: React.FC<BranchUserManagementViewProps> = ({ user }) => {
  // Tabs: 'counters' | 'cashiers'
  const [activeTab, setActiveTab] = useState<'counters' | 'cashiers'>('counters');

  // Sync tab with URL query parameter (?tab=counters|cashiers)
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('tab');
      if (p === 'counters' || p === 'cashiers') {
        setActiveTab(p);
      }
    } catch {}

    const onPop = () => {
      try {
        const p = new URLSearchParams(window.location.search).get('tab');
        if (p === 'counters' || p === 'cashiers') {
          setActiveTab(p);
        }
      } catch {}
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Summary & Branch
  const [summary, setSummary] = useState<BranchUsersSummary>({
    branch: { id: '', name: '', code: '', active: true },
    counters: { total: 0, active: 0, disabled: 0 },
    cashiers: { total: 0, active: 0, invited: 0 },
    countersWithoutCashier: 0,
  });

  const [counters, setCounters] = useState<BranchCounterItem[]>([]);
  const [cashiers, setCashiers] = useState<BranchCashierItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasNoBranch, setHasNoBranch] = useState(false);

  // Filters (separate for each tab, cleared on tab switch)
  const [cntSearch, setCntSearch] = useState('');
  const [cntStatusFilter, setCntStatusFilter] = useState('ALL');

  const [cshSearch, setCshSearch] = useState('');
  const [cshStatusFilter, setCshStatusFilter] = useState('ALL');

  // Toast
  const [toast, setToast] = useState<ToastMessage | null>(null);

  // --------------------------------------------------------------------------
  // PERMANENT DELETE STATE & HANDLER (Store Manager - own branch only)
  // --------------------------------------------------------------------------
  const [deleteModal, setDeleteModal] = useState<{
    open: boolean;
    type: DeleteEntityType;
    id: string;
    name: string;
    code?: string;
  }>({
    open: false,
    type: 'counter',
    id: '',
    name: '',
  });

  const handleOpenDelete = (type: DeleteEntityType, id: string, name: string, code?: string) => {
    setDeleteModal({ open: true, type, id, name, code });
  };

  const handleDeleted = async (id: string, name: string) => {
    if (deleteModal.type === 'counter') {
      setCounters((prev) => prev.filter((c) => c.id !== id));
      setCashiers((prev) =>
        prev.map((csh) =>
          csh.defaultCounter?.id === id ? { ...csh, defaultCounter: null } : csh
        )
      );
    } else if (deleteModal.type === 'cashier') {
      setCashiers((prev) => prev.filter((c) => c.id !== id));
      setCounters((prev) =>
        prev.map((cnt) => ({
          ...cnt,
          cashiers: cnt.cashiers.filter((cName) => cName !== name),
        }))
      );
    }
    showToast(`${name} deleted`);
    await loadData();
  };

  const handleDisableInstead = async (id: string) => {
    if (deleteModal.type === 'counter') {
      const cnt = counters.find((c) => c.id === id);
      if (cnt && cnt.status !== 'DISABLED') {
        await handleToggleCounterStatus(cnt);
      }
    } else if (deleteModal.type === 'cashier') {
      const csh = cashiers.find((c) => c.id === id);
      if (csh && csh.status !== 'DISABLED') {
        await handleToggleCashierStatus(csh);
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

  // RESEND SIGN-IN DETAILS
  // --------------------------------------------------------------------------
  const handleResend = async (user: { id: string; name: string; email: string | null }) => {
    if (!user.email) return;
    try {
      const res = await resendBranchUserCredentials(user.id);
      showToast(`Sign-in details emailed to ${user.email}`);
      if (res.temporaryPassword) {
        setResetModalData({
          open: true,
          name: user.name,
          temporaryPassword: res.temporaryPassword,
          email: user.email,
        });
      }
      loadData();
    } catch (err: any) {
      showToast(`Couldn't email ${user.email} — Retry`, true, () => handleResend(user));
    }
  };



  // --------------------------------------------------------------------------
  // DATA FETCHING
  // --------------------------------------------------------------------------
  const loadData = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const branchIdParam = user?.branchId || (user as any)?.branch_id || undefined;
      const [sumRes, cntRes, cshRes] = await Promise.all([
        fetchBranchUsersSummary(branchIdParam),
        fetchBranchCounters(),
        fetchBranchCashiers(),
      ]);
      setSummary(sumRes);
      setCounters(cntRes.counters || []);
      setCashiers(cshRes.cashiers || []);
      setHasNoBranch(false);
    } catch (err: any) {
      if (err.message?.includes('Waiting for branch assignment') || err.message?.includes('NO_BRANCH')) {
        setHasNoBranch(true);
      } else {
        console.error('Failed to load branch users data', err);
        setLoadError(err.message || 'Failed to load branch data');
        showToast(err.message || 'Failed to load branch data', true, () => loadData());
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user]);

  // Tab switch clears filters and syncs with URL
  const handleTabSwitch = (tab: 'counters' | 'cashiers') => {
    setActiveTab(tab);
    setCntSearch('');
    setCntStatusFilter('ALL');
    setCshSearch('');
    setCshStatusFilter('ALL');
    try {
      const url = new URL(window.location.href);
      url.pathname = '/user-management';
      url.searchParams.set('tab', tab);
      window.history.replaceState({}, '', url.toString());
    } catch {}
  };

  // --------------------------------------------------------------------------
  // SHARED DRAWER STATE (Add / Edit Counter & Add / Edit Cashier)
  // --------------------------------------------------------------------------
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'add_counter' | 'edit_counter' | 'add_cashier' | 'edit_cashier'>('add_counter');
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form Fields
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formUsername, setFormUsername] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formDefaultCounterId, setFormDefaultCounterId] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formSendEmail, setFormSendEmail] = useState(true);
  const [formMustChangePassword, setFormMustChangePassword] = useState(true);

  // Suggestions & Live Validation
  const [suggestedCode, setSuggestedCode] = useState('');
  const [suggestedUsername, setSuggestedUsername] = useState('');

  const [usernameAvailability, setUsernameAvailability] = useState<{ checked: boolean; available: boolean; error?: string }>({
    checked: false,
    available: true,
  });
  const [emailAvailability, setEmailAvailability] = useState<{ checked: boolean; available: boolean; error?: string }>({
    checked: false,
    available: true,
  });
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formDirty, setFormDirty] = useState(false);

  // Open Drawer: Add Counter
  const openAddCounterDrawer = async () => {
    setDrawerMode('add_counter');
    setEditingId(null);
    setFormName('');
    setFormUsername('');
    setFormEmail('');
    setFormPassword(generateClientPassword());
    setShowPassword(false);
    setFormSendEmail(false);
    setFormMustChangePassword(false); // Counter default OFF
    setUsernameAvailability({ checked: false, available: true });
    setEmailAvailability({ checked: false, available: true });
    setDrawerError(null);
    setFormDirty(false);

    try {
      const next = await fetchBranchCountersNextCode();
      setFormCode(next.code);
      setSuggestedCode(next.code);
      setSuggestedUsername(next.suggestedUsername);
    } catch {
      setFormCode('POR-C02');
      setSuggestedUsername('sks_por_c2');
    }

    setIsDrawerOpen(true);
  };

  // Open Drawer: Edit Counter
  const openEditCounterDrawer = (counter: BranchCounterItem) => {
    setDrawerMode('edit_counter');
    setEditingId(counter.id);
    setFormName(counter.name);
    setFormCode(counter.code);
    setFormUsername(counter.loginUsername || '');
    setFormEmail(counter.email || '');
    setFormPassword('');
    setShowPassword(false);
    setUsernameAvailability({ checked: true, available: true });
    setEmailAvailability({ checked: true, available: true });
    setDrawerError(null);
    setFormDirty(false);
    setIsDrawerOpen(true);
  };

  // Open Drawer: Add Cashier
  const openAddCashierDrawer = () => {
    setDrawerMode('add_cashier');
    setEditingId(null);
    setFormName('');
    setFormUsername('');
    setFormEmail('');
    setFormPassword(generateClientPassword());
    setShowPassword(false);
    setFormDefaultCounterId(counters.find((c) => c.status !== 'DISABLED')?.id || '');
    setFormPhone('');
    setFormSendEmail(true);
    setFormMustChangePassword(true); // Cashier default ON
    setUsernameAvailability({ checked: false, available: true });
    setEmailAvailability({ checked: false, available: true });
    setDrawerError(null);
    setFormDirty(false);
    setIsDrawerOpen(true);
  };

  // Open Drawer: Edit Cashier
  const openEditCashierDrawer = (cashier: BranchCashierItem) => {
    setDrawerMode('edit_cashier');
    setEditingId(cashier.id);
    setFormName(cashier.name);
    setFormUsername(cashier.username || '');
    setFormEmail(cashier.email || '');
    setFormPassword('');
    setShowPassword(false);
    setFormDefaultCounterId(cashier.defaultCounter?.id || '');
    setFormPhone(cashier.phone || '');
    setFormSendEmail(false);
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

  // Cashier username suggestion logic
  const cashierUsernameSuggestion = useMemo(() => {
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

  // Debounced server checks for username & email across all users
  useEffect(() => {
    if (!isDrawerOpen) return;
    const trimmed = formUsername.trim().toLowerCase();
    if (!trimmed) {
      setUsernameAvailability({ checked: false, available: true });
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
        const res = await checkUserUsernameAvailability(trimmed, editingId || undefined);
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
  }, [formUsername, isDrawerOpen, editingId]);

  useEffect(() => {
    if (!isDrawerOpen) return;
    const trimmed = formEmail.trim().toLowerCase();
    if (!trimmed) {
      setEmailAvailability({ checked: false, available: true });
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
        const res = await checkUserEmailAvailability(trimmed, editingId || undefined);
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
  }, [formEmail, isDrawerOpen, editingId]);

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

  // Is Create/Save button enabled
  const isFormValid = useMemo(() => {
    if (!formName.trim() || formName.trim().length < 2) return false;
    if (!signinBoxStatus.ok) return false;

    if (drawerMode === 'add_counter') {
      if (!formCode.trim() || formCode.trim().length < 3) return false;
      if (!formPassword || formPassword.length < 8 || !pwRules.number) return false;
      let score = 0;
      if (pwRules.length) score++;
      if (pwRules.casing) score++;
      if (pwRules.number) score++;
      if (pwRules.symbol) score++;
      if (score < 3) return false;
    }

    if (drawerMode === 'add_cashier') {
      if (!formPassword || formPassword.length < 8 || !pwRules.number) return false;
      let score = 0;
      if (pwRules.length) score++;
      if (pwRules.casing) score++;
      if (pwRules.number) score++;
      if (pwRules.symbol) score++;
      if (score < 3) return false;
    }

    return true;
  }, [drawerMode, formName, formCode, signinBoxStatus, formPassword, pwRules]);

  // Submit Drawer Form (Counter or Cashier)
  const handleSubmitDrawer = async (e: React.FormEvent) => {
    e.preventDefault();
    setDrawerError(null);

    try {
      setIsSubmitting(true);

      if (drawerMode === 'add_counter') {
        const payload: BranchCounterInput = {
          name: formName.trim(),
          code: formCode.trim().toUpperCase(),
          username: formUsername.trim().toLowerCase() || null,
          email: formEmail.trim().toLowerCase() || null,
          password: formPassword,
          sendEmail: Boolean(formSendEmail && formEmail.trim()),
          mustChangePassword: formMustChangePassword,
        };
        const res = await createBranchCounter(payload);
        const emailMsg = res.emailSent ? ' · sign-in details emailed' : '';
        showToast(`${payload.name} created${emailMsg}`);
        setIsDrawerOpen(false);
        setActiveTab('counters');
        await loadData();
      } else if (drawerMode === 'edit_counter' && editingId) {
        await updateBranchCounter(editingId, {
          name: formName.trim(),
          code: formCode.trim().toUpperCase(),
          username: formUsername.trim().toLowerCase() || null,
          email: formEmail.trim().toLowerCase() || null,
        });
        showToast(`Counter ${formName} updated`);
        setIsDrawerOpen(false);
        await loadData();
      } else if (drawerMode === 'add_cashier') {
        const payload: BranchCashierInput = {
          name: formName.trim(),
          username: formUsername.trim().toLowerCase() || null,
          email: formEmail.trim().toLowerCase() || null,
          password: formPassword,
          defaultCounterId: formDefaultCounterId || null,
          phone: formPhone.trim() || null,
          sendEmail: Boolean(formSendEmail && formEmail.trim()),
          mustChangePassword: formMustChangePassword,
        };
        const res = await createBranchCashier(payload);
        const emailMsg = res.emailSent ? ' · sign-in details emailed' : '';
        showToast(`Cashier ${payload.name} created${emailMsg}`);
        setIsDrawerOpen(false);
        setActiveTab('cashiers');
        await loadData();
      } else if (drawerMode === 'edit_cashier' && editingId) {
        await updateBranchCashier(editingId, {
          name: formName.trim(),
          username: formUsername.trim().toLowerCase() || null,
          email: formEmail.trim().toLowerCase() || null,
          defaultCounterId: formDefaultCounterId || null,
          phone: formPhone.trim() || null,
        });
        showToast(`Cashier ${formName} updated`);
        setIsDrawerOpen(false);
        await loadData();
      }
    } catch (err: any) {
      console.error('Error in drawer submit', err);
      setDrawerError(err.message || 'Failed to save changes');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --------------------------------------------------------------------------
  // RESET PASSWORD MODAL
  // --------------------------------------------------------------------------
  const [resetModalData, setResetModalData] = useState<{
    open: boolean;
    name: string;
    temporaryPassword: string;
    email: string | null;
  }>({
    open: false,
    name: '',
    temporaryPassword: '',
    email: null,
  });

  const handleResetPassword = async (id: string, name: string, email: string | null) => {
    try {
      const res = await resetBranchUserPassword(id);
      setResetModalData({
        open: true,
        name,
        temporaryPassword: res.temporaryPassword,
        email,
      });
      showToast('Temporary password generated');
    } catch (err: any) {
      showToast(err.message || 'Failed to reset password');
    }
  };

  // --------------------------------------------------------------------------
  // CONFIRMATION DIALOG (Disable / Enable)
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

  const handleToggleCounterStatus = (cnt: BranchCounterItem) => {
    if (cnt.status === 'DISABLED') {
      updateBranchUserStatus(cnt.id, 'ACTIVE')
        .then(() => {
          showToast(`Enabled ${cnt.name}`);
          loadData();
        })
        .catch((err) => showToast(err.message || 'Failed to enable counter'));
    } else {
      setConfirmDialog({
        open: true,
        title: `Disable ${cnt.name} (${cnt.code})?`,
        message: 'This counter won’t be able to sign in or create bills.',
        confirmText: 'Disable counter',
        danger: true,
        onConfirm: async () => {
          await updateBranchUserStatus(cnt.id, 'DISABLED');
          showToast(`Disabled ${cnt.name}`);
          setConfirmDialog((c) => ({ ...c, open: false }));
          await loadData();
        },
      });
    }
  };

  const handleToggleCashierStatus = (csh: BranchCashierItem) => {
    if (csh.status === 'DISABLED') {
      updateBranchUserStatus(csh.id, 'ACTIVE')
        .then(() => {
          showToast(`Enabled ${csh.name}`);
          loadData();
        })
        .catch((err) => showToast(err.message || 'Failed to enable cashier'));
    } else {
      setConfirmDialog({
        open: true,
        title: `Disable ${csh.name}?`,
        message: `${csh.name} won’t be able to sign in.`,
        confirmText: 'Disable cashier',
        danger: true,
        onConfirm: async () => {
          await updateBranchUserStatus(csh.id, 'DISABLED');
          showToast(`Disabled ${csh.name}`);
          setConfirmDialog((c) => ({ ...c, open: false }));
          await loadData();
        },
      });
    }
  };

  // --------------------------------------------------------------------------
  // FILTERING LOGIC
  // --------------------------------------------------------------------------
  const filteredCounters = useMemo(() => {
    return counters.filter((c) => {
      if (cntStatusFilter !== 'ALL') {
        if (c.status !== cntStatusFilter) return false;
      }
      if (cntSearch.trim()) {
        const q = cntSearch.toLowerCase();
        const mName = c.name.toLowerCase().includes(q);
        const mCode = c.code.toLowerCase().includes(q);
        const mLogin = c.loginUsername ? c.loginUsername.toLowerCase().includes(q) : false;
        const mEmail = c.email ? c.email.toLowerCase().includes(q) : false;
        return mName || mCode || mLogin || mEmail;
      }
      return true;
    });
  }, [counters, cntSearch, cntStatusFilter]);

  const filteredCashiers = useMemo(() => {
    return cashiers.filter((c) => {
      if (cshStatusFilter !== 'ALL') {
        if (c.status !== cshStatusFilter) return false;
      }
      if (cshSearch.trim()) {
        const q = cshSearch.toLowerCase();
        const mName = c.name.toLowerCase().includes(q);
        const mUser = c.username ? c.username.toLowerCase().includes(q) : false;
        const mEmail = c.email ? c.email.toLowerCase().includes(q) : false;
        const mCnt = c.defaultCounter
          ? c.defaultCounter.name.toLowerCase().includes(q) || c.defaultCounter.code.toLowerCase().includes(q)
          : false;
        return mName || mUser || mEmail || mCnt;
      }
      return true;
    });
  }, [cashiers, cshSearch, cshStatusFilter]);

  // Non-disabled counters for cashier default dropdown
  const activeCounters = useMemo(() => {
    return counters.filter((c) => c.status !== 'DISABLED');
  }, [counters]);

  // --------------------------------------------------------------------------
  // UNASSIGNED MANAGER STATE
  // --------------------------------------------------------------------------
  if (hasNoBranch) {
    return (
      <div className="um-page-wrapper">
        <div className="um-container">
          <div className="um-card" style={{ padding: '60px 24px', textAlign: 'center' }}>
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: '#FEF6E7',
                color: '#C27A0E',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px auto',
              }}
            >
              <Icons.AlertTriangle />
            </div>
            <h2 style={{ fontSize: '22px', fontWeight: 700, color: '#1A1830', margin: '0 0 8px 0' }}>
              Waiting for branch assignment
            </h2>
            <p style={{ fontSize: '15px', color: '#5F5B76', maxWidth: '440px', margin: '0 auto' }}>
              Waiting for branch assignment — contact your admin. Your store manager account is not currently assigned to an active branch.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="um-page-wrapper">
      <div className="um-container">
        {/* ==================================================================
            A) HEADER
            ================================================================== */}
        <div>
          {/* Locked Branch Badge */}
          {summary.branch.name && (
            <div className="um-locked-branch-badge" title="Your assigned branch">
              <Icons.Lock />
              <span>{summary.branch.name}</span>
              <span className="code-chip">{summary.branch.code}</span>
            </div>
          )}

          <header className="um-header-row">
            <div className="um-header-titles">
              <h1>User Management</h1>
              <p>Create and manage the counters and cashiers of your branch.</p>
            </div>
            <div className="um-header-actions">
              <button
                type="button"
                className="um-btn-base um-btn-secondary"
                onClick={openAddCounterDrawer}
                aria-label="Add counter"
              >
                <Icons.Monitor />
                <span>Add counter</span>
              </button>
              <button
                type="button"
                className="um-btn-base um-btn-primary"
                onClick={openAddCashierDrawer}
                aria-label="Add cashier"
              >
                <Icons.UserPlus />
                <span>Add cashier</span>
              </button>
            </div>
          </header>
        </div>

        {/* ==================================================================
            B) THREE STAT CARDS
            ================================================================== */}
        <div className="um-stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {/* 1. Counters */}
          <div className="um-stat-card">
            <div className="um-stat-card-header">
              <div className="um-stat-icon-tile green">
                <Icons.Monitor />
              </div>
              <span className="um-stat-label">Counters</span>
            </div>
            <div className="um-stat-value">{summary.counters.total}</div>
            <div className="um-stat-hint">
              {summary.counters.active} active · {summary.counters.disabled} disabled
            </div>
          </div>

          {/* 2. Cashiers */}
          <div className="um-stat-card">
            <div className="um-stat-card-header">
              <div className="um-stat-icon-tile blue">
                <Icons.Users />
              </div>
              <span className="um-stat-label">Cashiers</span>
            </div>
            <div className="um-stat-value">{summary.cashiers.total}</div>
            <div className="um-stat-hint">
              {summary.cashiers.active} active · {summary.cashiers.invited} invited
            </div>
          </div>

          {/* 3. Counters Without Cashier */}
          <div className="um-stat-card">
            <div className="um-stat-card-header">
              <div className="um-stat-icon-tile amber">
                <Icons.AlertTriangle />
              </div>
              <span className="um-stat-label">Counters Without Cashier</span>
            </div>
            <div className="um-stat-value">{summary.countersWithoutCashier}</div>
            <div className="um-stat-hint">No cashier set as their default</div>
          </div>
        </div>

        {/* ==================================================================
            C) TABS (Underline style)
            ================================================================== */}
        <div className="um-tabs-row" role="tablist" aria-label="Counters and Cashiers">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'counters'}
            className={`um-tab-btn ${activeTab === 'counters' ? 'active' : ''}`}
            onClick={() => handleTabSwitch('counters')}
          >
            <span>Counters</span>
            <span className="um-tab-badge">{summary.counters.total}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'cashiers'}
            className={`um-tab-btn ${activeTab === 'cashiers' ? 'active' : ''}`}
            onClick={() => handleTabSwitch('cashiers')}
          >
            <span>Cashiers</span>
            <span className="um-tab-badge">{summary.cashiers.total}</span>
          </button>
        </div>

        {/* ==================================================================
            D) TAB 1: COUNTERS
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
                  placeholder="Search by counter name, code or login"
                  value={cntSearch}
                  onChange={(e) => setCntSearch(e.target.value)}
                  aria-label="Search counters"
                />
              </div>

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
                    <th>Counter Login</th>
                    <th>Cashiers</th>
                    <th>Status</th>
                    <th>Last Active</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [1, 2, 3].map((k) => (
                      <tr key={`skel-cnt-${k}`}>
                        <td colSpan={6} style={{ padding: '20px 24px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <div className="um-skeleton-pulse" style={{ width: 40, height: 40, borderRadius: 10 }} />
                            <div style={{ flex: 1 }}>
                              <div className="um-skeleton-pulse" style={{ width: '28%', height: 16, borderRadius: 4, marginBottom: 8 }} />
                              <div className="um-skeleton-pulse" style={{ width: '16%', height: 12, borderRadius: 4 }} />
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : loadError ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="um-empty-state" style={{ padding: '40px 24px' }}>
                          <h3 className="um-empty-title" style={{ color: '#B42318' }}>Failed to load counters</h3>
                          <p className="um-empty-sub">{loadError}</p>
                          <button
                            type="button"
                            className="um-btn um-btn-secondary"
                            onClick={() => loadData()}
                            style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                          >
                            Retry
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : filteredCounters.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="um-empty-state">
                          <h3 className="um-empty-title">No counters found</h3>
                          <p className="um-empty-sub">Try a different search or filter, or add a new counter.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredCounters.map((cnt) => (
                      <tr key={cnt.id}>
                        {/* Counter: grey tile + name + code */}
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

                        {/* Counter Login */}
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            {cnt.loginUsername && (
                              <span className="um-user-handle" style={{ fontSize: '13.5px' }}>
                                @{cnt.loginUsername}
                              </span>
                            )}
                            {cnt.email && (
                              <span style={{ fontSize: '13px', color: '#5F5B76' }}>
                                {cnt.email}
                              </span>
                            )}
                            {!cnt.loginUsername && !cnt.email && <span style={{ color: '#8C88A2' }}>—</span>}
                          </div>
                        </td>

                        {/* Cashiers assigned as default */}
                        <td>
                          {cnt.cashiers.length > 0 ? (
                            <span style={{ fontWeight: 600, color: '#1A1830' }}>
                              {cnt.cashiers.join(', ')}
                            </span>
                          ) : (
                            <span className="um-warning-text">
                              <Icons.AlertCircle />
                              <span>None yet</span>
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

                        {/* Last Active */}
                        <td>
                          <span style={{ color: '#5F5B76' }}>{formatDate(cnt.lastActiveAt)}</span>
                        </td>

                        {/* Actions */}
                        <td>
                          <div className="um-row-actions">
                            <button
                              type="button"
                              className="um-action-btn edit"
                              onClick={() => openEditCounterDrawer(cnt)}
                              aria-label="Edit counter"
                              title="Edit counter"
                            >
                              <Icons.Pencil />
                              <span className="um-tooltip">Edit</span>
                            </button>
                            <button
                              type="button"
                              className="um-action-btn key"
                              onClick={() => handleResetPassword(cnt.id, cnt.name, cnt.email)}
                              aria-label="Reset password"
                              title="Reset password"
                            >
                              <Icons.Key />
                              <span className="um-tooltip">Reset password</span>
                            </button>
                            {cnt.email && (
                              <button
                                type="button"
                                className="um-action-btn mail"
                                onClick={() => handleResend(cnt)}
                                aria-label="Resend sign-in details"
                                title="Resend sign-in details"
                              >
                                <Icons.Send />
                                <span className="um-tooltip">Resend email</span>
                              </button>
                            )}
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
              <span>Showing {filteredCounters.length} of {counters.length} counters in {summary.branch.name || 'your branch'}</span>
            </div>
          </div>
        )}

        {/* ==================================================================
            E) TAB 2: CASHIERS
            ================================================================== */}
        {activeTab === 'cashiers' && (
          <div className="um-card">
            <div className="um-toolbar">
              <div className="um-search-wrap">
                <span className="um-search-icon">
                  <Icons.Search />
                </span>
                <input
                  type="text"
                  className="um-search-input"
                  placeholder="Search by name, username, email or counter"
                  value={cshSearch}
                  onChange={(e) => setCshSearch(e.target.value)}
                  aria-label="Search cashiers"
                />
              </div>

              <select
                className="um-select"
                value={cshStatusFilter}
                onChange={(e) => setCshStatusFilter(e.target.value)}
                aria-label="Filter cashiers by status"
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
                    <th>Cashier</th>
                    <th>Default Counter</th>
                    <th>Status</th>
                    <th>Last Sign-In</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [1, 2, 3].map((k) => (
                      <tr key={`skel-csh-${k}`}>
                        <td colSpan={5} style={{ padding: '20px 24px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <div className="um-skeleton-pulse" style={{ width: 40, height: 40, borderRadius: 20 }} />
                            <div style={{ flex: 1 }}>
                              <div className="um-skeleton-pulse" style={{ width: '28%', height: 16, borderRadius: 4, marginBottom: 8 }} />
                              <div className="um-skeleton-pulse" style={{ width: '18%', height: 12, borderRadius: 4 }} />
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : loadError ? (
                    <tr>
                      <td colSpan={5}>
                        <div className="um-empty-state" style={{ padding: '40px 24px' }}>
                          <h3 className="um-empty-title" style={{ color: '#B42318' }}>Failed to load cashiers</h3>
                          <p className="um-empty-sub">{loadError}</p>
                          <button
                            type="button"
                            className="um-btn um-btn-secondary"
                            onClick={() => loadData()}
                            style={{ marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                          >
                            Retry
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : filteredCashiers.length === 0 ? (
                    <tr>
                      <td colSpan={5}>
                        <div className="um-empty-state">
                          <h3 className="um-empty-title">No cashiers found</h3>
                          <p className="um-empty-sub">Try a different search or filter, or add a new cashier.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredCashiers.map((csh) => {
                      const hasUser = Boolean(csh.username);
                      const hasEmail = Boolean(csh.email);

                      return (
                        <tr key={csh.id}>
                          {/* Cashier: Avatar initials + name + username/email */}
                          <td>
                            <div className="um-user-col">
                              <div className="um-avatar-initials" style={{ backgroundColor: '#E6EEFF', color: '#1F4FD1' }}>
                                {getInitials(csh.name)}
                              </div>
                              <div className="um-user-info">
                                <span className="um-user-name">{csh.name}</span>
                                <span className="um-user-sub">
                                  {hasUser && <span className="um-user-handle">@{csh.username}</span>}
                                  {hasUser && hasEmail && <span> · </span>}
                                  {hasEmail && (
                                  <span className="um-email-with-status">
                                    <span>{csh.email}</span>
                                    <MailStatusBadge
                                      status={csh.lastEmailStatus}
                                      error={csh.lastEmailError}
                                      sentAt={csh.lastEmailSentAt}
                                      onRetry={() => handleResend(csh)}
                                    />
                                  </span>
                                )}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* Default Counter */}
                          <td>
                            {csh.defaultCounter ? (
                              <div className="um-branch-cell">
                                <span className="um-branch-name" style={{ fontSize: '13.5px' }}>{csh.defaultCounter.name}</span>
                                <div>
                                  <span className="um-mono-chip">{csh.defaultCounter.code}</span>
                                </div>
                              </div>
                            ) : (
                              <span style={{ color: '#5F5B76', fontWeight: 500 }}>Any counter</span>
                            )}
                          </td>

                          {/* Status */}
                          <td>
                            <span className={`um-status-pill ${csh.status.toLowerCase()}`}>
                              <span className="um-status-dot" />
                              <span>{csh.status === 'ACTIVE' ? 'Active' : csh.status === 'INVITED' ? 'Invited' : 'Disabled'}</span>
                            </span>
                          </td>

                          {/* Last Sign-in */}
                          <td>
                            <span style={{ color: '#5F5B76' }}>{formatDate(csh.lastLoginAt)}</span>
                          </td>

                          {/* Actions */}
                          <td>
                            <div className="um-row-actions">
                              <button
                                type="button"
                                className="um-action-btn edit"
                                onClick={() => openEditCashierDrawer(csh)}
                                aria-label="Edit cashier"
                                title="Edit cashier"
                              >
                                <Icons.Pencil />
                                <span className="um-tooltip">Edit</span>
                              </button>
                              <button
                                type="button"
                                className="um-action-btn key"
                                onClick={() => handleResetPassword(csh.id, csh.name, csh.email)}
                                aria-label="Reset password"
                                title="Reset password"
                              >
                                <Icons.Key />
                                <span className="um-tooltip">Reset password</span>
                              </button>
                              {csh.email && (
                                <button
                                  type="button"
                                  className="um-action-btn mail"
                                  onClick={() => handleResend(csh)}
                                  aria-label="Resend sign-in details"
                                  title="Resend sign-in details"
                                >
                                  <Icons.Send />
                                  <span className="um-tooltip">Resend email</span>
                                </button>
                              )}
                              {csh.status === 'DISABLED' ? (
                                <button
                                  type="button"
                                  className="um-action-btn enable"
                                  onClick={() => handleToggleCashierStatus(csh)}
                                  aria-label="Enable cashier"
                                  title="Enable cashier"
                                >
                                  <Icons.Power />
                                  <span className="um-tooltip">Enable cashier</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="um-action-btn disable"
                                  onClick={() => handleToggleCashierStatus(csh)}
                                  aria-label="Disable cashier"
                                  title="Disable cashier"
                                >
                                  <Icons.Power />
                                  <span className="um-tooltip">Disable cashier</span>
                                </button>
                              )}
                              <button
                                type="button"
                                className="um-action-btn delete"
                                onClick={() => handleOpenDelete('cashier', csh.id, csh.name)}
                                aria-label={`Delete ${csh.name}`}
                                title="Delete cashier"
                              >
                                <Icons.Trash />
                                <span className="um-tooltip">Delete cashier</span>
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
              <span>Showing {filteredCashiers.length} of {cashiers.length} cashiers in {summary.branch.name || 'your branch'}</span>
            </div>
          </div>
        )}

        {/* ==================================================================
            F) SHARED DRAWER (Add/Edit Counter & Add/Edit Cashier)
            ================================================================== */}
        {isDrawerOpen && (
          <div
            className="um-drawer-overlay"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget) handleCloseDrawer();
            }}
          >
            <div className="um-drawer" role="dialog" aria-modal="true" aria-labelledby="branch-drawer-title">
              {/* Header */}
              <div className="um-drawer-header">
                <div className="um-drawer-title-group">
                  <h2 id="branch-drawer-title">
                    {drawerMode === 'add_counter' && 'Add counter'}
                    {drawerMode === 'edit_counter' && 'Edit counter'}
                    {drawerMode === 'add_cashier' && 'Add cashier'}
                    {drawerMode === 'edit_cashier' && 'Edit cashier'}
                  </h2>
                  <p>
                    {drawerMode === 'add_counter' && 'A counter account signs in on the billing terminal with a username or email ID.'}
                    {drawerMode === 'edit_counter' && 'Update the counter account name, code or sign-in ID.'}
                    {drawerMode === 'add_cashier' && 'Cashiers sign in with their username or email ID, plus this password.'}
                    {drawerMode === 'edit_cashier' && 'Update cashier details, sign-in ID or default counter.'}
                  </p>
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

              {/* Form Body */}
              <form onSubmit={handleSubmitDrawer} className="um-drawer-body">
                {drawerError && <div className="um-error-banner">{drawerError}</div>}

                {/* 1. Branch (Read-only locked box) */}
                <div className="um-form-group">
                  <label className="um-form-label">Branch</label>
                  <div
                    style={{
                      height: '46px',
                      backgroundColor: '#F8F7FF',
                      border: '1px solid #DAD8E6',
                      borderRadius: '10px',
                      padding: '0 14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontWeight: 600,
                      fontSize: '13.5px',
                      color: '#1A1830',
                    }}
                  >
                    <Icons.Lock />
                    <span>{summary.branch.name}</span>
                    <span className="um-mono-chip" style={{ fontSize: '11px' }}>{summary.branch.code}</span>
                  </div>
                  <div className="um-field-helper">You can only add users to your own branch.</div>
                </div>

                {/* 2a. COUNTER ONLY: Counter Name & Counter Code */}
                {(drawerMode === 'add_counter' || drawerMode === 'edit_counter') && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div className="um-form-group">
                      <label className="um-form-label" htmlFor="bm-counter-name">Counter name *</label>
                      <input
                        id="bm-counter-name"
                        type="text"
                        className="um-form-input"
                        placeholder="e.g. Counter 2"
                        value={formName}
                        onChange={(e) => {
                          setFormName(e.target.value);
                          setFormDirty(true);
                        }}
                        required
                        minLength={2}
                      />
                    </div>

                    <div className="um-form-group">
                      <label className="um-form-label" htmlFor="bm-counter-code">Counter code *</label>
                      <input
                        id="bm-counter-code"
                        type="text"
                        className="um-form-input mono"
                        placeholder="e.g. POR-C02"
                        value={formCode}
                        onChange={(e) => {
                          setFormCode(e.target.value.toUpperCase());
                          setFormDirty(true);
                        }}
                        required
                        minLength={3}
                        maxLength={12}
                      />
                    </div>
                  </div>
                )}
                {(drawerMode === 'add_counter' || drawerMode === 'edit_counter') && (
                  <div className="um-field-helper" style={{ marginTop: '-12px' }}>Unique within your branch.</div>
                )}

                {/* 2b. CASHIER ONLY: Full Name */}
                {(drawerMode === 'add_cashier' || drawerMode === 'edit_cashier') && (
                  <div className="um-form-group">
                    <label className="um-form-label" htmlFor="bm-cashier-name">Full name *</label>
                    <input
                      id="bm-cashier-name"
                      type="text"
                      className="um-form-input"
                      placeholder="e.g. Lakshmi Prakash"
                      value={formName}
                      onChange={(e) => {
                        setFormName(e.target.value);
                        setFormDirty(true);
                      }}
                      required
                      minLength={2}
                    />
                  </div>
                )}

                {/* 3. SIGN-IN ID GROUP BOX */}
                <div className={`um-signin-group-box ${signinBoxStatus.ok ? 'valid' : ''}`}>
                  <h3 className="um-signin-group-title">Sign-in ID *</h3>
                  <p className="um-signin-group-sub">
                    Add a username, an email ID, or both. Whichever you add can be used to sign in; the other is optional.
                  </p>

                  {/* Username */}
                  <div className="um-form-group">
                    <label className="um-form-label" htmlFor="bm-username">
                      <span>Username {Boolean(formEmail.trim()) && <span style={{ color: '#5F5B76', fontWeight: 400 }}>(optional)</span>}</span>
                    </label>
                    <div className="um-input-prefix-wrap">
                      <span className="um-input-prefix">@</span>
                      <input
                        id="bm-username"
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
                      {!formUsername && (drawerMode.includes('counter') ? suggestedUsername : cashierUsernameSuggestion) && (
                        <button
                          type="button"
                          className="um-suggestion-btn"
                          onClick={() => {
                            const sugg = drawerMode.includes('counter') ? suggestedUsername : cashierUsernameSuggestion;
                            setFormUsername(sugg);
                            setFormDirty(true);
                          }}
                        >
                          Use @{drawerMode.includes('counter') ? suggestedUsername : cashierUsernameSuggestion}
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
                        Letters, numbers, dot or underscore · 4–20 characters.
                      </div>
                    )}
                  </div>

                  <div className="um-or-divider">—— OR ——</div>

                  {/* Email ID */}
                  <div className="um-form-group">
                    <label className="um-form-label" htmlFor="bm-email">
                      <span>Email ID {Boolean(formUsername.trim()) && <span style={{ color: '#5F5B76', fontWeight: 400 }}>(optional)</span>}</span>
                    </label>
                    <input
                      id="bm-email"
                      type="email"
                      className="um-form-input"
                      placeholder="name@yourstore.com"
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

                {/* 4. PASSWORD (Create mode only) */}
                {(drawerMode === 'add_counter' || drawerMode === 'add_cashier') && (
                  <div className="um-form-group">
                    <div className="um-form-label">
                      <span>Password *</span>
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
                        placeholder="••••••••••••"
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
                              showToast('Password copied');
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
                )}

                {/* Edit mode: Reset password button */}
                {(drawerMode === 'edit_counter' || drawerMode === 'edit_cashier') && editingId && (
                  <div style={{ padding: '12px 0', borderTop: '1px solid #ECEAF4', borderBottom: '1px solid #ECEAF4' }}>
                    <button
                      type="button"
                      className="um-btn-action"
                      onClick={() => handleResetPassword(editingId, formName, formEmail || null)}
                    >
                      Reset password for {formName}
                    </button>
                  </div>
                )}

                {/* 5. CASHIER ONLY: Default counter & Mobile */}
                {(drawerMode === 'add_cashier' || drawerMode === 'edit_cashier') && (
                  <>
                    <div className="um-form-group">
                      <label className="um-form-label" htmlFor="bm-default-counter">Default counter</label>
                      <select
                        id="bm-default-counter"
                        className="um-select"
                        value={formDefaultCounterId}
                        onChange={(e) => {
                          setFormDefaultCounterId(e.target.value);
                          setFormDirty(true);
                        }}
                      >
                        <option value="">Any counter in this branch</option>
                        {activeCounters.map((cnt) => (
                          <option key={cnt.id} value={cnt.id}>
                            {cnt.name} ({cnt.code})
                          </option>
                        ))}
                      </select>
                      <div className="um-field-helper">The cashier can still sign in at any active counter of this branch.</div>
                    </div>

                    <div className="um-form-group">
                      <label className="um-form-label" htmlFor="bm-cashier-phone">Mobile number (optional)</label>
                      <input
                        id="bm-cashier-phone"
                        type="tel"
                        className="um-form-input"
                        placeholder="+91 98xxx xxxxx"
                        value={formPhone}
                        onChange={(e) => {
                          setFormPhone(e.target.value);
                          setFormDirty(true);
                        }}
                      />
                    </div>
                  </>
                )}

                {/* 6. OPTIONS BOX (Create mode only) */}
                {(drawerMode === 'add_counter' || drawerMode === 'add_cashier') && (
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
                        <span className="um-checkbox-title">Email the sign-in details</span>
                        <span className="um-checkbox-hint">
                          {!formEmail.trim()
                            ? 'Add an email ID to send the details. Otherwise, share them yourself.'
                            : `Sends the email ID and password to ${formEmail.trim()}.`}
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
                          {drawerMode === 'add_cashier'
                            ? 'Recommended, so only the cashier knows it.'
                            : 'Usually off for shared counter logins.'}
                        </span>
                      </div>
                    </label>
                  </div>
                )}

                {/* Fixed Footer */}
                <div className="um-drawer-footer">
                  <button
                    type="button"
                    className="um-btn-base um-btn-secondary"
                    onClick={handleCloseDrawer}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="um-btn-base um-btn-primary"
                    disabled={isSubmitting || !isFormValid}
                  >
                    {isSubmitting
                      ? 'Saving...'
                      : drawerMode === 'add_counter'
                      ? 'Create counter'
                      : drawerMode === 'add_cashier'
                      ? 'Create cashier'
                      : 'Save changes'}
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
            <div className="um-modal-card" role="dialog" aria-modal="true" aria-labelledby="bm-pw-modal-title">
              <div className="um-modal-header">
                <h3 id="bm-pw-modal-title" className="um-modal-title">Temporary Password Generated</h3>
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
                  Share this temporary password with <strong>{resetModalData.name}</strong>. They will be prompted to change it when they sign in.
                </p>
                <div className="um-temp-password-box">
                  <span className="um-temp-password-code">{resetModalData.temporaryPassword}</span>
                  <button
                    type="button"
                    className="um-btn-base um-btn-secondary"
                    style={{ minHeight: '36px', padding: '0 12px' }}
                    onClick={() => {
                      navigator.clipboard.writeText(resetModalData.temporaryPassword);
                      showToast('Password copied');
                    }}
                  >
                    <Icons.Copy />
                    <span>Copy</span>
                  </button>
                </div>
                {resetModalData.email && (
                  <p style={{ fontSize: '13px', color: '#5F5B76' }}>
                    Sign-in instructions have also been queued for <strong>{resetModalData.email}</strong>.
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
            <div className="um-modal-card" role="dialog" aria-modal="true" aria-labelledby="bm-confirm-title">
              <div className="um-modal-header">
                <h3 id="bm-confirm-title" className="um-modal-title">{confirmDialog.title}</h3>
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
            PERMANENT DELETE CONFIRMATION MODAL
            ================================================================== */}
        {deleteModal.open && (
          <DeleteConfirmModal
            type={deleteModal.type}
            id={deleteModal.id}
            name={deleteModal.name}
            code={deleteModal.code}
            isBranchScope={true}
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

export default BranchUserManagementView;
