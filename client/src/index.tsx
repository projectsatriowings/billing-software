import React, { Component, ReactNode, ErrorInfo } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { MobileScanner } from './components/MobileScanner';
import { CustomerDisplay } from './components/CustomerDisplay';
import './index.css';
import './components/inventory/PurchaseBentoModal.css';

interface ErrorBoundaryProps {
  children: ReactNode;
  isScanner?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class RootErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('RootErrorBoundary caught an error:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoDashboard = () => {
    window.location.hash = '#dashboard';
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const isScanner = this.props.isScanner;
      const errorMessage = this.state.error?.message || 'An unexpected error occurred while loading this view.';

      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8fafc',
          padding: '24px',
          fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
          boxSizing: 'border-box',
        }}>
          <div style={{
            maxWidth: '480px',
            width: '100%',
            background: '#ffffff',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.08), 0 8px 10px -6px rgba(15, 23, 42, 0.04)',
            padding: '32px 28px',
            textAlign: 'center',
          }}>
            <div style={{
              width: '56px',
              height: '56px',
              borderRadius: '14px',
              background: '#fef2f2',
              color: '#ef4444',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '18px',
              border: '1px solid #fee2e2',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            </div>

            <h2 style={{
              fontSize: '20px',
              fontWeight: 700,
              color: '#0f172a',
              margin: '0 0 8px 0',
              letterSpacing: '-0.02em',
            }}>
              {isScanner ? 'Scanner Service Notice' : 'Application Notice'}
            </h2>

            <p style={{
              fontSize: '14px',
              color: '#64748b',
              lineHeight: 1.55,
              margin: '0 0 24px 0',
            }}>
              {errorMessage}
            </p>

            <div style={{
              display: 'flex',
              gap: '12px',
              justifyContent: 'center',
              flexWrap: 'wrap',
            }}>
              <button
                type="button"
                onClick={this.handleReload}
                style={{
                  background: '#6366f1',
                  color: '#ffffff',
                  border: 'none',
                  padding: '11px 22px',
                  borderRadius: '10px',
                  fontSize: '14px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  boxShadow: '0 4px 12px rgba(99, 102, 241, 0.25)',
                  fontFamily: 'inherit',
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
                </svg>
                Reload Page
              </button>

              {!isScanner && (
                <button
                  type="button"
                  onClick={this.handleGoDashboard}
                  style={{
                    background: '#f8fafc',
                    color: '#334155',
                    border: '1px solid #cbd5e1',
                    padding: '11px 20px',
                    borderRadius: '10px',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    fontFamily: 'inherit',
                  }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                    <polyline points="9 22 9 12 15 12 15 22"/>
                  </svg>
                  Go to Dashboard
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  const urlParams = new URLSearchParams(window.location.search);
  const isScanner = window.location.pathname.startsWith('/scanner') || urlParams.get('mode') === 'scanner' || urlParams.has('scanner');
  const isCfd = window.location.pathname.startsWith('/customer-display') || window.location.pathname.startsWith('/cfd') || urlParams.get('mode') === 'cfd' || urlParams.has('cfd');
  const sessionId = urlParams.get('session') || 'pos-counter-1';
  const counterId = urlParams.get('counter') || 'counter-1';

  if (isScanner) {
    root.render(
      <RootErrorBoundary isScanner={true}>
        <MobileScanner sessionId={sessionId} />
      </RootErrorBoundary>
    );
  } else if (isCfd) {
    root.render(
      <RootErrorBoundary>
        <CustomerDisplay counterId={counterId} />
      </RootErrorBoundary>
    );
  } else {
    root.render(
      <RootErrorBoundary>
        <App />
      </RootErrorBoundary>
    );
  }
}
