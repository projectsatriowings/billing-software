import React, { useState, useMemo } from 'react';
import { changePassword, type User } from '../../api';
import { evaluatePassword } from './passwordStrength';
import './authViews.css';

interface ChangePasswordViewProps {
  changeToken?: string;
  initialCurrentPassword?: string;
  identifier?: string;
  onSuccess: (data: {
    token: string;
    user?: User;
    shop?: any;
    perms?: string[];
    role?: string;
    branchId?: string | null;
  }) => void;
  onCancel?: () => void;
}

const Icons = {
  Lock: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  ),
  ShieldCheck: () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  ),
  Eye: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  EyeOff: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  ),
  Check: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  Cross: () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  AlertCircle: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
};

export const ChangePasswordView: React.FC<ChangePasswordViewProps> = ({
  changeToken,
  initialCurrentPassword = '',
  identifier = '',
  onSuccess,
  onCancel,
}) => {
  const [currentPassword, setCurrentPassword] = useState(initialCurrentPassword);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);

  const [confirmPassword, setConfirmPassword] = useState('');
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const validation = useMemo(
    () => evaluatePassword(newPassword, currentPassword),
    [newPassword, currentPassword]
  );

  const passwordsMatch = newPassword === confirmPassword;
  const showMismatchError = confirmPassword.length > 0 && !passwordsMatch;

  const canSubmit =
    currentPassword.trim().length > 0 &&
    validation.isValid &&
    passwordsMatch &&
    !isLoading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setIsLoading(true);
    setServerError(null);

    try {
      const res = await changePassword(currentPassword, newPassword, changeToken);
      onSuccess(res);
    } catch (err: any) {
      setServerError(err.message || 'Failed to update password. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-view-page">
      <div className="auth-view-container">
        {/* Brand Header */}
        <div className="auth-view-brand">
          <div className="auth-brand-logo-badge">
            <Icons.ShieldCheck />
          </div>
          <span className="auth-brand-title">Shree Krishna Retail</span>
        </div>

        {/* Card */}
        <div className="auth-card">
          <div className="auth-card-header">
            <div className="auth-card-badge">
              <Icons.Lock />
              <span>Security Setup</span>
            </div>
            <h1 className="auth-card-title">Set a new password</h1>
            <p className="auth-card-subtitle">
              For your security, replace the temporary password from your email with a strong personal password.
            </p>
            {identifier && (
              <div className="auth-user-chip" title="Account being updated">
                <span>Account:</span>
                <strong>{identifier}</strong>
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="auth-form" noValidate>
            {/* Field 1: Temporary password */}
            <div className="auth-field-group">
              <label className="auth-label" htmlFor="cur-pwd">
                <span>Temporary / Current password</span>
              </label>
              <div className="auth-input-wrap">
                <input
                  id="cur-pwd"
                  type={showCurrentPassword ? 'text' : 'password'}
                  className="auth-input"
                  placeholder="Enter temporary password"
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value);
                    setServerError(null);
                  }}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="auth-toggle-pwd-btn"
                  onClick={() => setShowCurrentPassword((v) => !v)}
                  title={showCurrentPassword ? 'Hide password' : 'Show password'}
                  aria-label={showCurrentPassword ? 'Hide password' : 'Show password'}
                >
                  {showCurrentPassword ? <Icons.EyeOff /> : <Icons.Eye />}
                </button>
              </div>
            </div>

            {/* Field 2: New password */}
            <div className="auth-field-group">
              <label className="auth-label" htmlFor="new-pwd">
                <span>New password</span>
              </label>
              <div className="auth-input-wrap">
                <input
                  id="new-pwd"
                  type={showNewPassword ? 'text' : 'password'}
                  className={`auth-input ${newPassword && !validation.isValid ? 'has-error' : ''}`}
                  placeholder="Create a strong password"
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    setServerError(null);
                  }}
                  required
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="auth-toggle-pwd-btn"
                  onClick={() => setShowNewPassword((v) => !v)}
                  title={showNewPassword ? 'Hide password' : 'Show password'}
                  aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                >
                  {showNewPassword ? <Icons.EyeOff /> : <Icons.Eye />}
                </button>
              </div>

              {/* 4-segment strength meter */}
              {newPassword.length > 0 && (
                <div className="auth-strength-wrap">
                  <div className="auth-strength-bars">
                    {[1, 2, 3, 4].map((step) => {
                      const isFilled = validation.strengthScore >= step;
                      return (
                        <div
                          key={step}
                          className="auth-strength-segment"
                          style={{
                            backgroundColor: isFilled ? validation.strengthColor : '#ECEAF4',
                          }}
                        />
                      );
                    })}
                  </div>
                  <div className="auth-strength-footer">
                    <span style={{ color: '#8C88A2' }}>Password strength:</span>
                    <span className="auth-strength-label" style={{ color: validation.strengthColor }}>
                      {validation.strengthLabel}
                    </span>
                  </div>
                </div>
              )}

              {/* Live checklist */}
              <div className="auth-checklist">
                <div className={`auth-checklist-item ${validation.hasMinLength ? 'met' : ''}`}>
                  <span className="auth-checklist-icon">
                    {validation.hasMinLength ? <Icons.Check /> : <Icons.Cross />}
                  </span>
                  <span>At least 8 characters</span>
                </div>
                <div className={`auth-checklist-item ${validation.hasNumber ? 'met' : ''}`}>
                  <span className="auth-checklist-icon">
                    {validation.hasNumber ? <Icons.Check /> : <Icons.Cross />}
                  </span>
                  <span>At least one number</span>
                </div>
                <div className={`auth-checklist-item ${validation.hasMix ? 'met' : ''}`}>
                  <span className="auth-checklist-icon">
                    {validation.hasMix ? <Icons.Check /> : <Icons.Cross />}
                  </span>
                  <span>Mix of uppercase, lowercase or symbols</span>
                </div>
                <div className={`auth-checklist-item ${validation.isDifferentFromCurrent ? 'met' : ''}`}>
                  <span className="auth-checklist-icon">
                    {validation.isDifferentFromCurrent ? <Icons.Check /> : <Icons.Cross />}
                  </span>
                  <span>Different from temporary password</span>
                </div>
              </div>
            </div>

            {/* Field 3: Confirm new password */}
            <div className="auth-field-group">
              <label className="auth-label" htmlFor="confirm-pwd">
                <span>Confirm new password</span>
              </label>
              <div className="auth-input-wrap">
                <input
                  id="confirm-pwd"
                  type={showConfirmPassword ? 'text' : 'password'}
                  className={`auth-input ${showMismatchError ? 'has-error' : ''}`}
                  placeholder="Re-enter new password"
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setServerError(null);
                  }}
                  required
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="auth-toggle-pwd-btn"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  title={showConfirmPassword ? 'Hide password' : 'Show password'}
                  aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                >
                  {showConfirmPassword ? <Icons.EyeOff /> : <Icons.Eye />}
                </button>
              </div>

              {showMismatchError && (
                <div className="auth-field-error">
                  <Icons.AlertCircle />
                  <span>Passwords don't match</span>
                </div>
              )}
            </div>

            {/* Server Error Alert */}
            {serverError && (
              <div className="auth-server-error" role="alert">
                <Icons.AlertCircle />
                <span>{serverError}</span>
              </div>
            )}

            {/* Save and Continue Button */}
            <button
              type="submit"
              className="auth-submit-btn"
              disabled={!canSubmit}
            >
              {isLoading ? (
                <>
                  <span className="auth-btn-spinner" />
                  <span>Updating password...</span>
                </>
              ) : (
                <span>Save and continue</span>
              )}
            </button>

            {onCancel && (
              <div className="auth-secondary-action">
                <button
                  type="button"
                  className="auth-text-link"
                  onClick={onCancel}
                >
                  Sign in with a different account
                </button>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
};

