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
  const [email, setEmail] = useState('demo@billing.local');
  const [password, setPassword] = useState('Password123!');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

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
            {/* Header Badge */}
            <div className="login-avatar-badge">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>

            <h2 className="login-card-title">Welcome Back</h2>
            <p className="login-card-subtitle">Login to your account</p>

            {error && (
              <div className="login-alert-error">
                <span className="alert-icon">⚠️</span>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="login-auth-form">
              <div className="form-group">
                <label className="form-label" htmlFor="login-email">
                  Email address <span className="required-star">*</span>
                </label>
                <div className="input-with-icon">
                  <input
                    id="login-email"
                    type="email"
                    className="form-input"
                    required
                    placeholder="you@business.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
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
              >
                {isLoading ? (
                  <span className="btn-loading-content">
                    <span className="spinner-icon"></span> Logging in...
                  </span>
                ) : (
                  'Login'
                )}
              </button>
            </form>

            {/* Quick Demo Logins Helper */}
            <div className="demo-accounts-box">
              <div className="demo-accounts-title">Quick Demo Logins</div>
              <div className="demo-buttons-grid">
                <button
                  type="button"
                  className="demo-chip-btn"
                  onClick={() => handleDemoSelect('demo@billing.local', 'Password123!')}
                  title="Green Mart Retail / Supermarket"
                >
                  🛒 Green Mart Supermarket
                </button>
                <button
                  type="button"
                  className="demo-chip-btn"
                  onClick={() => handleDemoSelect('pharmacy@billing.local', 'Password123!')}
                  title="City Care Pharmacy"
                >
                  💊 City Care Pharmacy
                </button>
                <button
                  type="button"
                  className="demo-chip-btn"
                  onClick={() => handleDemoSelect('restaurant@billing.local', 'Password123!')}
                  title="Spice Route Cafe & Restaurant"
                >
                  🍽️ Spice Route Restaurant
                </button>
                <button
                  type="button"
                  className="demo-chip-btn"
                  onClick={() => handleDemoSelect('clothing@billing.local', 'Password123!')}
                  title="Style Haven Clothing"
                >
                  👗 Style Haven Clothing
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
