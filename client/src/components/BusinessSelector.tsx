import React from 'react';
import { type DemoBusiness, type User, type Shop } from '../api';
import { getMetaForType } from './businessTypes';

interface BusinessSelectorProps {
  user: User;
  currentShop: Shop | null;
  businesses: DemoBusiness[];
  onSelectBusiness: (tenantId: string) => void;
  onLogout: () => void;
  onBackToDashboard?: () => void;
}

export const BusinessSelector: React.FC<BusinessSelectorProps> = ({
  user,
  currentShop,
  businesses,
  onSelectBusiness,
  onLogout,
  onBackToDashboard,
}) => {
  return (
    <div className="selector-page-wrapper">
      {/* Top Navbar */}
      <header className="selector-navbar">
        <div className="selector-nav-container">
          <div className="selector-brand">
            <span className="selector-brand-icon">⚡</span>
            <span className="selector-brand-name">Adaptive Billing</span>
          </div>

          <div className="selector-user-menu">
            {onBackToDashboard && currentShop && (
              <button
                type="button"
                className="selector-back-btn"
                onClick={onBackToDashboard}
                title="Return to your store dashboard"
              >
                ← Back to Dashboard
              </button>
            )}
            <div className="user-profile-chip">
              <span className="user-avatar-circle">
                {user.name.charAt(0).toUpperCase()}
              </span>
              <div className="user-info-text">
                <span className="user-name">{user.name}</span>
                <span className="user-role-badge">Owner</span>
              </div>
            </div>
            <button
              type="button"
              className="selector-logout-btn"
              onClick={onLogout}
              title="Sign out of platform"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content matching Screen 8 */}
      <main className="selector-main-container">
        <div className="selector-card-box">
          {/* Header Icon */}
          <div className="selector-icon-header">
            <div className="selector-icon-circle">
              <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 21h18" />
                <path d="M5 21V7l8-4 6 3v15" />
                <path d="M9 10h1" />
                <path d="M9 14h1" />
                <path d="M9 18h1" />
                <path d="M14 10h1" />
                <path d="M14 14h1" />
                <path d="M14 18h1" />
              </svg>
            </div>
            <h2 className="selector-title">
              Your Business Store
            </h2>
            <p className="selector-subtitle">
              Your dedicated isolated business partition. Only you have access to your store dashboard and invoices.
            </p>
          </div>

          {/* List of Businesses */}
          <div className="selector-business-list">
            {businesses.length === 0 ? (
              <div className="selector-empty-state">
                <p>No business found for your account.</p>
              </div>
            ) : (
              businesses.map((biz) => {
                const meta = getMetaForType(biz.businessType);
                const isSelected = currentShop?.id === biz.id;

                return (
                  <div
                    key={biz.id}
                    className={`business-item-card ${isSelected ? 'current-active' : ''}`}
                    onClick={() => onSelectBusiness(biz.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') onSelectBusiness(biz.id);
                    }}
                  >
                    <div
                      className="business-card-icon-wrap"
                      style={{ backgroundColor: `${meta.badgeColor}15`, color: meta.badgeColor, borderColor: `${meta.badgeColor}35` }}
                    >
                      <span className="biz-icon-emoji">{meta.icon}</span>
                    </div>

                    <div className="business-card-details">
                      <div className="business-name-row">
                        <span className="business-card-name">{biz.name}</span>
                        {isSelected && <span className="current-badge">Currently Selected</span>}
                      </div>
                      <div className="business-card-meta-row">
                        <span className="business-type-label">{meta.title}</span>
                        {biz.address && (
                          <>
                            <span className="meta-bullet">•</span>
                            <span className="business-location">{biz.address}</span>
                          </>
                        )}
                        {biz.gstin && (
                          <>
                            <span className="meta-bullet">•</span>
                            <span className="business-gstin">GSTIN: {biz.gstin}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="business-card-action">
                      <span className="active-pill-badge">
                        <span>Open Dashboard</span>
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Action Row - Direct single-business access button */}
          <div className="selector-bottom-actions">
            <button
              type="button"
              className="btn btn-primary"
              style={{
                width: '100%',
                padding: '0.9rem 1.5rem',
                fontSize: '1rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.6rem',
                borderRadius: '12px',
                boxShadow: '0 4px 15px rgba(37, 99, 235, 0.35)',
              }}
              onClick={() => {
                if (businesses[0]?.id) {
                  onSelectBusiness(businesses[0].id);
                } else if (onBackToDashboard) {
                  onBackToDashboard();
                }
              }}
            >
              <span>Enter Store Dashboard</span>
              <span style={{ fontSize: '1.15rem' }}>→</span>
            </button>
          </div>
        </div>

        {/* Security Guarantee Banner */}
        <div className="selector-security-note">
          <div className="sec-note-shield">🛡️</div>
          <div className="sec-note-text">
            <strong>Strict Single-Customer Isolation Active:</strong> Logged in as <strong>{user.email}</strong>. Only your registered business is accessible. Other customers' dashboards, invoices, and customer lists are strictly isolated and never exposed.
          </div>
        </div>
      </main>
    </div>
  );
};
