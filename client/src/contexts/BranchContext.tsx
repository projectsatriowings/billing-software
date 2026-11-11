import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Branch, User } from '../api.ts';
import { getActiveBranchScope, setActiveBranchScope } from '../api.ts';

export interface BranchContextType {
  branches: Branch[];
  selectedBranch: string; // 'all' or branch ID / code
  selectedBranchId: string | null; // canonical ID or null if 'all'
  selectedBranchCode: string; // e.g. 'MAIN' or 'ALL'
  selectedBranchName: string; // e.g. 'SKS Main Central Branch' or 'All Branches (Overall)'
  activeBranch: Branch | null; // active Branch object or null if 'all'
  isSuperAdmin: boolean;
  canAccessOverall: boolean;
  branchVersion: number;
  setBranch: (branchCodeOrId: string) => void;
  registerReloadHandler: (key: string, handler: (branch: string) => Promise<void> | void) => () => void;
}

const BranchContext = createContext<BranchContextType | null>(null);

export interface BranchProviderProps {
  children: React.ReactNode;
  user: User | null;
  branches: Branch[];
  onGlobalBranchChange?: (branchCodeOrId: string) => Promise<void> | void;
}

export const BranchProvider: React.FC<BranchProviderProps> = ({
  children,
  user,
  branches,
  onGlobalBranchChange,
}) => {
  const isSuperAdmin = Boolean(
    user && (user.role === 'owner' || user.role === 'admin' || String(user.role).toUpperCase() === 'SUPER_ADMIN')
  );

  const canAccessOverall = isSuperAdmin;

  // Resolve initial branch scope
  const initialBranch = useMemo(() => {
    if (!isSuperAdmin) {
      return user?.branchId || user?.assignedLocation || 'MAIN';
    }
    const saved = getActiveBranchScope();
    return saved || 'all';
  }, [isSuperAdmin, user?.branchId, user?.assignedLocation]);

  const [selectedBranch, setSelectedBranch] = useState<string>(initialBranch);
  const [branchVersion, setBranchVersion] = useState<number>(1);
  const reloadHandlersRef = useRef<Map<string, (branch: string) => Promise<void> | void>>(new Map());

  // Enforce role restrictions if user changes or is not Super Admin
  useEffect(() => {
    if (!isSuperAdmin && user) {
      const enforced = user.branchId || user.assignedLocation || 'MAIN';
      setSelectedBranch(enforced);
      setActiveBranchScope(enforced);
    }
  }, [isSuperAdmin, user]);

  // Resolve canonical active branch details
  const { activeBranch, selectedBranchId, selectedBranchCode, selectedBranchName } = useMemo(() => {
    const isAll = !selectedBranch || selectedBranch.toLowerCase() === 'all';
    if (isAll) {
      return {
        activeBranch: null,
        selectedBranchId: null,
        selectedBranchCode: 'ALL',
        selectedBranchName: 'All Branches (Overall)',
      };
    }

    const normalized = selectedBranch.trim();
    const found = branches.find(
      (b) => b.id === normalized || (b.code && b.code.toUpperCase() === normalized.toUpperCase())
    );

    if (found) {
      return {
        activeBranch: found,
        selectedBranchId: found.id,
        selectedBranchCode: found.code || 'MAIN',
        selectedBranchName: found.name || found.code || 'Main Branch',
      };
    }

    return {
      activeBranch: null,
      selectedBranchId: normalized,
      selectedBranchCode: normalized.toUpperCase(),
      selectedBranchName: normalized,
    };
  }, [selectedBranch, branches]);

  const registerReloadHandler = useCallback((key: string, handler: (branch: string) => Promise<void> | void) => {
    reloadHandlersRef.current.set(key, handler);
    return () => {
      reloadHandlersRef.current.delete(key);
    };
  }, []);

  const setBranch = useCallback(
    async (rawBranch: string) => {
      // Security Check: Only Super Admin can change branch
      if (!isSuperAdmin) {
        console.warn('[BranchContext] Branch switching is restricted to Super Admin.');
        return;
      }

      const nextBranch = (rawBranch || 'all').trim();
      setSelectedBranch(nextBranch);
      setActiveBranchScope(nextBranch);
      setBranchVersion((v) => v + 1);

      // Resolve code/id for event detail
      const isAll = nextBranch.toLowerCase() === 'all';
      const match = !isAll
        ? branches.find((b) => b.id === nextBranch || b.code?.toUpperCase() === nextBranch.toUpperCase())
        : null;

      const detail = {
        branch: nextBranch,
        branchId: match ? match.id : isAll ? null : nextBranch,
        branchCode: match ? match.code : isAll ? 'ALL' : nextBranch.toUpperCase(),
        branchName: match ? match.name : isAll ? 'All Branches (Overall)' : nextBranch,
      };

      // Dispatch global window event for components that listen directly
      window.dispatchEvent(new CustomEvent('branch_scope_changed', { detail }));

      // Run registered reload handlers
      for (const [, handler] of reloadHandlersRef.current) {
        try {
          await handler(nextBranch);
        } catch (e) {
          console.error('[BranchContext] Handler reload failed:', e);
        }
      }

      // Run global app change handler if provided
      if (onGlobalBranchChange) {
        try {
          await onGlobalBranchChange(nextBranch);
        } catch (err) {
          console.error('[BranchContext] Global branch change error:', err);
        }
      }
    },
    [isSuperAdmin, branches, onGlobalBranchChange]
  );

  const value = useMemo<BranchContextType>(
    () => ({
      branches,
      selectedBranch,
      selectedBranchId,
      selectedBranchCode,
      selectedBranchName,
      activeBranch,
      isSuperAdmin,
      canAccessOverall,
      branchVersion,
      setBranch,
      registerReloadHandler,
    }),
    [
      branches,
      selectedBranch,
      selectedBranchId,
      selectedBranchCode,
      selectedBranchName,
      activeBranch,
      isSuperAdmin,
      canAccessOverall,
      branchVersion,
      setBranch,
      registerReloadHandler,
    ]
  );

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
};

export function useBranch(): BranchContextType {
  const ctx = useContext(BranchContext);
  if (!ctx) {
    throw new Error('useBranch must be used within a BranchProvider');
  }
  return ctx;
}

