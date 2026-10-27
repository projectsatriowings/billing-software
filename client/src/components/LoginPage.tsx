import React, { useState } from 'react';
import { api, setToken, type User, type Shop } from '../api';

interface LoginPageProps {
  onSuccess: (data: { token: string; user: User; shop: Shop }) => void;
  onNavigateRegister: () => void;
  onBackToHome: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onSuccess,
  onNavigateRegister,
  onBackToHome,
}) => {
  const [selectedRole, setSelectedRole] = useState<'super_admin' | 'store_manager' | 'cashier'>('super_admin');
  const [email, setEmail] = useState('demo@billing.local');
  const [password, setPassword] = useState('Password123!');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  const handleRoleTabChange = (role: 'super_admin' | 'store_manager' | 'cashier') => {
    setSelectedRole(role);
    setError('');
    if (role === 'super_admin') {
      setEmail('demo@billing.local');
      setPassword('Password123!');
    } else if (role === 'store_manager') {
      setEmail('manager@billing.local');
      setPassword('Password123!');
    } else {
      setEmail('cashier@billing.local');
      setPassword('Password123!');
    }
  };

  // Forgot password modal state
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotStatus, setForgotStatus] = useState<{ message: string; isError?: boolean } | null>(null);
  const [isSendingReset, setIsSendingReset] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('Please provide both your email and password.');
      return;
    }

    setIsLoading(true);
    try {
      const data = await api<{ token: string; user: User; shop: Shop }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      });

      setToken(data.token);
      onSuccess(data);
    } catch (err: any) {
      setError(err?.message || 'Invalid email or password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDemoSelect = (demoEmail: string, demoPass: string) => {
    setEmail(demoEmail);
    setPassword(demoPass);
    setError('');
  };

  const handleSendForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail.trim()) {
      setForgotStatus({ message: 'Please enter your account email address.', isError: true });
      return;
    }

    setIsSendingReset(true);
    setForgotStatus(null);
    try {
      const res = await api<{ ok: boolean; message: string; note?: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: forgotEmail.trim() }),
      });
      setForgotStatus({
        message: res.note ? `${res.message} Notice: ${res.note}` : res.message,
        isError: false,
      });
    } catch (err: any) {
      setForgotStatus({
        message: err?.message || 'Unable to process password reset at this time.',
        isError: true,
      });
    } finally {
      setIsSendingReset(false);
    }
  };

  return (
    <div className="login-split-page">
      {/* Left Branding Pane - Matching Screen 7 */}
      <div className="login-left-pane">
        <div className="login-left-content">
          <div className="login-brand" onClick={onBackToHome} style={{ cursor: 'pointer' }}>
            <span className="brand-icon">⚡</span>
            <span className="brand-name">Adaptive Billing</span>
          </div>

          <div className="login-hero-copy">
            <h1 className="login-hero-title">
              Your Business. <br />
              <span className="login-hero-highlight">Our Platform.</span>
            </h1>
            <p className="login-hero-sub">
              Manage sales, inventory, customers and more — all in one place.
            </p>
          </div>

          {/* Visual Platform Showcase Preview */}
          <div className="login-preview-graphic">
            <div className="preview-tablet-frame">
              <div className="tablet-header">
                <span className="tablet-dot red"></span>
                <span className="tablet-dot yellow"></span>
                <span className="tablet-dot green"></span>
                <span className="tablet-title-bar">adaptive-billing.app/pos</span>
              </div>
              <div className="tablet-screen-mock">
                <div className="mock-stat-row">
                  <div className="mock-stat-chip">
                    <span className="chip-label">Sales</span>
                    <span className="chip-val">₹45,320</span>
                  </div>
                  <div className="mock-stat-chip">
                    <span className="chip-label">Orders</span>
                    <span className="chip-val">24</span>
                  </div>
                  <div className="mock-stat-chip">
                    <span className="chip-label">Products</span>
                    <span className="chip-val">120</span>
                  </div>
                </div>
                <div className="mock-grid-preview">
                  <div className="mock-item-cell">🛒 Groceries</div>
                  <div className="mock-item-cell">💊 Medicine</div>
                  <div className="mock-item-cell">👗 Textiles</div>
                  <div className="mock-item-cell">🍽️ Menu</div>
                </div>
              </div>
            </div>
          </div>

          {/* Value Tags matching Screen 7 */}
          <div className="login-value-tags">
            <div className="value-tag">
              <span className="tag-icon">🏢</span>
              <span>Multiple Business Types</span>
            </div>
            <div className="value-tag">
              <span className="tag-icon">🔒</span>
              <span>Secure & Reliable</span>
            </div>
            <div className="value-tag">
              <span className="tag-icon">⚡</span>
              <span>Easy to Access</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Form Pane */}
      <div className="login-right-pane">
        <div className="login-top-nav">
          <button type="button" onClick={onBackToHome} className="nav-back-home-btn">
            ← Back to Home
          </button>
        </div>

        <div className="login-form-container">
          <div className="login-card">
            {/* 3 Role Selection Tabs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', background: '#f1f5f9', padding: '6px', borderRadius: '12px', marginBottom: '1.25rem' }}>
              <button
                type="button"
                onClick={() => handleRoleTabChange('super_admin')}
                style={{
                  padding: '10px 4px',
                  borderRadius: '10px',
                  border: 'none',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                  background: selectedRole === 'super_admin' ? '#ffffff' : 'transparent',
                  color: selectedRole === 'super_admin' ? '#4338ca' : '#64748b',
                  boxShadow: selectedRole === 'super_admin' ? '0 2px 8px rgba(67, 56, 202, 0.15)' : 'none',
                  borderBottom: selectedRole === 'super_admin' ? '2px solid #4338ca' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <span style={{ fontSize: '1.25rem' }}>👑</span>
                <span>Super Admin</span>
              </button>

              <button
                type="button"
                onClick={() => handleRoleTabChange('store_manager')}
                style={{
                  padding: '10px 4px',
                  borderRadius: '10px',
                  border: 'none',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                  background: selectedRole === 'store_manager' ? '#ffffff' : 'transparent',
                  color: selectedRole === 'store_manager' ? '#0369a1' : '#64748b',
                  boxShadow: selectedRole === 'store_manager' ? '0 2px 8px rgba(3, 105, 161, 0.15)' : 'none',
                  borderBottom: selectedRole === 'store_manager' ? '2px solid #0284c7' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <span style={{ fontSize: '1.25rem' }}>🏪</span>
                <span>Store Manager</span>
              </button>

              <button
                type="button"
                onClick={() => handleRoleTabChange('cashier')}
                style={{
                  padding: '10px 4px',
                  borderRadius: '10px',
                  border: 'none',
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px',
                  background: selectedRole === 'cashier' ? '#ffffff' : 'transparent',
                  color: selectedRole === 'cashier' ? '#059669' : '#64748b',
                  boxShadow: selectedRole === 'cashier' ? '0 2px 8px rgba(5, 150, 105, 0.15)' : 'none',
                  borderBottom: selectedRole === 'cashier' ? '2px solid #059669' : 'none',
                  transition: 'all 0.15s ease',
                }}
              >
                <span style={{ fontSize: '1.25rem' }}>💳</span>
                <span>Cashier Counter</span>
              </button>
            </div>

            {/* Role Purpose Pill & Subtitle */}
            <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
              <h2 className="login-card-title" style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: '#0f172a' }}>
                {selectedRole === 'super_admin' && '👑 Super Admin Portal'}
                {selectedRole === 'store_manager' && '🏪 Store Manager Portal'}
                {selectedRole === 'cashier' && '💳 Cashier Billing Portal'}
              </h2>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                {selectedRole === 'super_admin' && 'Enterprise headquarters: consolidated sales, multi-branch network & governance.'}
                {selectedRole === 'store_manager' && 'Branch-level management: shift approvals, counter controls & staff supervision.'}
                {selectedRole === 'cashier' && 'Register checkout counter: POS billing, cash float & drawer shift operations.'}
              </p>
            </div>

            {error && (
              <div className="login-alert-error">
                <span className="alert-icon">⚠️</span>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="login-auth-form">
              <div className="form-group">
                <label className="form-label" htmlFor="login-email">
                  {selectedRole === 'super_admin' && 'Super Admin Email'}
                  {selectedRole === 'store_manager' && 'Store Manager Email'}
                  {selectedRole === 'cashier' && 'Cashier Employee ID or Email'}{' '}
                  <span className="required-star">*</span>
                </label>
                <div className="input-with-icon">
                  <input
                    id="login-email"
                    type={selectedRole === 'cashier' ? 'text' : 'email'}
                    className="form-input"
                    required
                    placeholder={selectedRole === 'cashier' ? 'e.g. CSH-101 or cashier@billing.local' : 'you@business.com'}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete={selectedRole === 'cashier' ? 'username' : 'email'}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="login-password">
                  Password <span className="required-star">*</span>
                </label>
                <div className="password-input-wrapper">
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    className="form-input"
                    required
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="password-toggle-btn"
                    onClick={() => setShowPassword(!showPassword)}
                    title={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="login-row-options">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  <span>Remember me</span>
                </label>

                <button
                  type="button"
                  className="forgot-password-link"
                  onClick={() => {
                    setForgotEmail(email);
                    setForgotStatus(null);
                    setShowForgotModal(true);
                  }}
                >
                  Forgot password?
                </button>
              </div>

              <button
                type="submit"
                className="btn-primary-login"
                disabled={isLoading}
                style={{
                  background:
                    selectedRole === 'super_admin'
                      ? 'linear-gradient(135deg, #4338ca 0%, #6d4aff 100%)'
                      : selectedRole === 'store_manager'
                      ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)'
                      : 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
                }}
              >
                {isLoading ? (
                  <span className="btn-loading-content">
                    <span className="spinner-icon"></span> Authenticating...
                  </span>
                ) : (
                  `Login as ${
                    selectedRole === 'super_admin'
                      ? 'Super Admin'
                      : selectedRole === 'store_manager'
                      ? 'Store Manager'
                      : 'Cashier'
                  }`
                )}
              </button>
            </form>

            {/* Quick 1-Click Role Logins */}
            <div className="demo-accounts-box" style={{ marginTop: '1.25rem' }}>
              <div className="demo-accounts-title">1-Click Role Demonstrations</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => handleRoleTabChange('super_admin')}
                  style={{
                    padding: '8px 4px',
                    borderRadius: '8px',
                    border: '1px solid #c7d2fe',
                    background: selectedRole === 'super_admin' ? '#eef2ff' : '#ffffff',
                    color: '#3730a3',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '2px',
                  }}
                  title="Super Admin (demo@billing.local)"
                >
                  <span>👑 Admin</span>
                  <span style={{ fontSize: '0.65rem', color: '#6366f1', fontWeight: 600 }}>demo@billing.local</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleRoleTabChange('store_manager')}
                  style={{
                    padding: '8px 4px',
                    borderRadius: '8px',
                    border: '1px solid #bae6fd',
                    background: selectedRole === 'store_manager' ? '#f0f9ff' : '#ffffff',
                    color: '#0369a1',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '2px',
                  }}
                  title="Store Manager (manager@billing.local)"
                >
                  <span>🏪 Manager</span>
                  <span style={{ fontSize: '0.65rem', color: '#0284c7', fontWeight: 600 }}>manager@billing.local</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleRoleTabChange('cashier')}
                  style={{
                    padding: '8px 4px',
                    borderRadius: '8px',
                    border: '1px solid #a7f3d0',
                    background: selectedRole === 'cashier' ? '#ecfdf5' : '#ffffff',
                    color: '#047857',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '2px',
                  }}
                  title="Cashier (cashier@billing.local)"
                >
                  <span>💳 Cashier</span>
                  <span style={{ fontSize: '0.65rem', color: '#059669', fontWeight: 600 }}>cashier@billing.local</span>
                </button>
              </div>
            </div>

            <div className="login-footer-action">
              <span>Don't have an account? </span>
              <button
                type="button"
                className="register-highlight-link"
                onClick={onNavigateRegister}
              >
                Register Your Business
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Forgot Password Modal */}
      {showForgotModal && (
        <div className="modal-backdrop">
          <div className="modal-dialog forgot-dialog">
            <div className="modal-header">
              <h3 className="modal-title">Reset Your Password</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowForgotModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <p className="forgot-modal-desc">
                Enter your registered business email address. If an account is found, we will issue a secure, single-use reset token and send instructions.
              </p>

              {forgotStatus && (
                <div className={`forgot-status-banner ${forgotStatus.isError ? 'error' : 'success'}`}>
                  <span>{forgotStatus.isError ? '⚠️' : '✅'}</span>
                  <span>{forgotStatus.message}</span>
                </div>
              )}

              <form onSubmit={handleSendForgotPassword} className="forgot-form">
                <div className="form-group">
                  <label className="form-label" htmlFor="forgot-email">
                    Account Email
                  </label>
                  <input
                    id="forgot-email"
                    type="email"
                    className="form-input"
                    required
                    placeholder="you@business.com"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                  />
                </div>

                <div className="modal-actions-row">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setShowForgotModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={isSendingReset}
                  >
                    {isSendingReset ? 'Sending...' : 'Send Reset Instructions'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
