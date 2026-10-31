import React, { useState, useEffect, useRef } from 'react';
import {
  fetchBranchDeleteImpact,
  fetchManagerDeleteImpact,
  fetchCounterDeleteImpact,
  fetchCashierDeleteImpact,
  deleteBranch,
  deleteManager,
  deleteCounter,
  deleteCashier,
} from '../../api.ts';

export type DeleteEntityType = 'branch' | 'manager' | 'counter' | 'cashier';

export interface DeleteConfirmModalProps {
  type: DeleteEntityType;
  id: string;
  name: string;
  code?: string;
  isBranchScope?: boolean;
  isOpen: boolean;
  onClose: () => void;
  onDeleted: (id: string, name: string) => void;
  onDisableInstead?: (id: string) => void;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  type,
  id,
  name,
  code,
  isBranchScope = false,
  isOpen,
  onClose,
  onDeleted,
  onDisableInstead,
}) => {
  const [loadingImpact, setLoadingImpact] = useState<boolean>(true);
  const [deleting, setDeleting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [impactText, setImpactText] = useState<string>('');
  const [confirmInput, setConfirmInput] = useState<string>('');

  const inputRef = useRef<HTMLInputElement>(null);

  const typeLabels: Record<DeleteEntityType, string> = {
    branch: 'branch',
    manager: 'store manager',
    counter: 'counter',
    cashier: 'cashier',
  };

  const requiredConfirmation =
    type === 'branch' ? (code || name).trim() : type === 'manager' ? name.trim() : '';

  const isConfirmed = requiredConfirmation
    ? confirmInput.trim().toUpperCase() === requiredConfirmation.toUpperCase()
    : true;

  // Fetch impact on open
  useEffect(() => {
    if (!isOpen || !id) return;
    setLoadingImpact(true);
    setErrorMessage('');
    setConfirmInput('');

    async function loadImpact() {
      try {
        if (type === 'branch') {
          const res = await fetchBranchDeleteImpact(id);
          setImpactText(
            `This permanently deletes the branch, its ${res.countersCount} counters, ${res.counterLoginsCount} counter logins and ${res.cashiersCount} cashiers. The store manager ${
              res.managerName ? res.managerName : 'None'
            } will be unassigned (not deleted). Past bills are kept but will show the branch name only.`,
          );
        } else if (type === 'manager') {
          const res = await fetchManagerDeleteImpact(id);
          setImpactText(
            `This permanently deletes ${res.name}'s account. Branch ${
              res.branchName ? `${res.branchName}${res.branchCode ? ` (${res.branchCode})` : ''}` : 'Not assigned'
            } will have no manager.`,
          );
        } else if (type === 'counter') {
          const res = await fetchCounterDeleteImpact(id, isBranchScope);
          setImpactText(
            `This permanently deletes the counter and its login ${
              res.loginUsername ? `@${res.loginUsername}` : res.name
            }. ${res.defaultCashiersCount} cashiers using it as their default will switch to 'Any counter'.`,
          );
        } else if (type === 'cashier') {
          const res = await fetchCashierDeleteImpact(id, isBranchScope);
          setImpactText(`This permanently deletes ${res.name}'s account and signs them out everywhere.`);
        }
      } catch (err: any) {
        setImpactText(`This will permanently delete ${name} and related records from the database.`);
      } finally {
        setLoadingImpact(false);
      }
    }

    loadImpact();
  }, [isOpen, id, type, isBranchScope, name]);

  // Trap escape & focus
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleDelete = async () => {
    if (!isConfirmed || deleting) return;
    try {
      setDeleting(true);
      setErrorMessage('');

      if (type === 'branch') {
        await deleteBranch(id);
      } else if (type === 'manager') {
        await deleteManager(id);
      } else if (type === 'counter') {
        await deleteCounter(id, isBranchScope);
      } else if (type === 'cashier') {
        await deleteCashier(id, isBranchScope);
      }

      onDeleted(id, name);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Could not delete item. Please check permissions.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="um-delete-dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="um-delete-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !deleting) onClose();
      }}
    >
      <div className="um-delete-dialog">
        <div className="um-delete-header">
          <div className="um-delete-icon-tile" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </div>

          <div className="um-delete-title-area">
            <h2 id="um-delete-title">
              Delete {typeLabels[type]} &ldquo;{name}&rdquo;?
            </h2>
            <p>Permanent database deletion</p>
          </div>
        </div>

        {/* Impact description */}
        <div className="um-delete-impact-box">
          {loadingImpact ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#5F5B76' }}>
              <div className="um-btn-spinner" style={{ width: 14, height: 14 }} />
              <span>Checking dependencies and impact...</span>
            </div>
          ) : (
            impactText
          )}
        </div>

        {/* Warning line */}
        <div className="um-delete-warning-line">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span>This can&apos;t be undone.</span>
        </div>

        {/* Confirm by typing code/name if branch or store manager */}
        {requiredConfirmation ? (
          <div className="um-delete-confirm-box">
            <label htmlFor="um-delete-confirm-field">
              Type <code style={{ color: '#B42318', background: '#FEE4E2', padding: '2px 6px', borderRadius: 4 }}>{requiredConfirmation}</code> to confirm:
            </label>
            <input
              id="um-delete-confirm-field"
              ref={inputRef}
              type="text"
              autoFocus
              placeholder={`Type ${requiredConfirmation} to confirm`}
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              disabled={deleting}
            />
          </div>
        ) : null}

        {/* Suggest disable alternative */}
        {onDisableInstead && (
          <div className="um-delete-alt-link">
            Only need to stop access?{' '}
            <button
              type="button"
              onClick={() => {
                onClose();
                onDisableInstead(id);
              }}
            >
              Disable instead
            </button>
          </div>
        )}

        {errorMessage && (
          <div style={{ color: '#B42318', fontSize: 13, marginBottom: 16, background: '#FEE4E2', padding: '8px 12px', borderRadius: 6 }}>
            {errorMessage}
          </div>
        )}

        <div className="um-delete-footer">
          <button
            type="button"
            className="um-btn-secondary"
            onClick={onClose}
            disabled={deleting}
          >
            Cancel
          </button>

          <button
            type="button"
            className="um-btn-danger"
            disabled={!isConfirmed || deleting}
            onClick={handleDelete}
          >
            {deleting && <div className="um-btn-spinner" />}
            <span>Delete permanently</span>
          </button>
        </div>
      </div>
    </div>
  );
};

