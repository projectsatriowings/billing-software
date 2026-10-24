import React from 'react';

export const StrictIsolationBanner: React.FC = () => {
  return (
    <div className="strict-isolation-banner">
      <div className="strict-isolation-left">
        <div className="shield-icon-wrapper">
          <svg className="shield-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <path d="M9 12l2 2 4-4" />
          </svg>
        </div>
        <div>
          <h4 className="isolation-title">Strict Business Isolation</h4>
          <p className="isolation-subtitle">
            Each business can only access its own data. No other business can see, modify or access another business’s information.
          </p>
        </div>
      </div>
      <div className="strict-isolation-grid">
        <div className="isolation-pill">
          <span className="check-bullet">✓</span>
          <span>Unique business ID</span>
        </div>
        <div className="isolation-pill">
          <span className="check-bullet">✓</span>
          <span>Role-based access control</span>
        </div>
        <div className="isolation-pill">
          <span className="check-bullet">✓</span>
          <span>Tenant-based data security</span>
        </div>
        <div className="isolation-pill">
          <span className="check-bullet">✓</span>
          <span>Encrypted authentication</span>
        </div>
      </div>
    </div>
  );
};
