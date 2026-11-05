import { createPortal } from 'react-dom';
import React, { useState } from 'react';
import {
  StoreIcon,
  UserIcon,
  MapPinIcon,
  CheckCircle2Icon,
  InfoIcon,
  ZapIcon,
  ArrowRightIcon,
  SparklesIcon,
} from '../inventory/InventoryIcons.tsx';

export interface SelectCounterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCounter: (counterName: string) => void;
  currentCounter?: string;
  branchName: string;
  branchCode: string;
  cashierName: string;
  availableCounters?: string[];
  canClose?: boolean;
}

interface CounterOption {
  id: string;
  label: string;
  tag: string;
  desc: string;
  isExpress?: boolean;
}

export const SelectCounterModal: React.FC<SelectCounterModalProps> = ({
  isOpen,
  onClose,
  onSelectCounter,
  currentCounter = 'Counter 1',
  branchName,
  branchCode,
  cashierName,
  availableCounters,
  canClose = true,
}) => {
  const [selected, setSelected] = useState<string>(() => {
    return currentCounter || 'Counter 1';
  });
  const [isCustomMode, setIsCustomMode] = useState<boolean>(false);
  const [customCounterText, setCustomCounterText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  // Build list of counter options
  const defaultPresets: CounterOption[] = [
    { id: 'Counter 1', label: 'Counter 1', tag: 'Primary', desc: 'Main Lane Checkout Register' },
    { id: 'Counter 2', label: 'Counter 2', tag: 'Standard', desc: 'Secondary Lane Register' },
    { id: 'Counter 3', label: 'Counter 3', tag: 'Standard', desc: 'Standard Checkout Lane 3' },
    { id: 'Express Counter', label: 'Express Counter', tag: 'Fast Track', desc: 'Quick Pay & Basket Only Lane', isExpress: true },
  ];

  // If branch provides specific counters, merge or use them
  const branchList = availableCounters && availableCounters.length > 0
    ? availableCounters.map((c, idx) => ({
        id: c,
        label: c,
        tag: idx === 0 ? 'Primary' : c.toLowerCase().includes('express') ? 'Fast Track' : 'Standard',
        desc: c.toLowerCase().includes('express') ? 'Quick Pay & Basket Only Lane' : `Checkout Station (${c})`,
        isExpress: c.toLowerCase().includes('express'),
      }))
    : defaultPresets;

  const handleSelect = (counterId: string) => {
    setSelected(counterId);
    setIsCustomMode(false);
    setError(null);
  };

  const handleConfirm = () => {
    let finalCounter = selected;
    if (isCustomMode) {
      const trimmed = customCounterText.trim();
      if (!trimmed) {
        setError('Please enter a valid counter name or choose one from the list.');
        return;
      }
      finalCounter = trimmed;
    }

    if (!finalCounter) {
      setError('Please select a checkout counter before continuing.');
      return;
    }

    onSelectCounter(finalCounter);
    onClose();
  };

  return createPortal(
    <div
      className="modal-overlay"
      onClick={() => {
        if (canClose) onClose();
      }}
      style={{
        zIndex: 99999,
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      <div
        className="shift-bento-dialog wide-1040"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '880px',
          width: '92vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          background: '#ffffff',
          borderRadius: '20px',
          overflow: 'hidden',
          boxShadow: '0 25px 60px -15px rgba(15, 23, 42, 0.28), 0 10px 24px -5px rgba(15, 23, 42, 0.08)',
          border: '1.5px solid rgba(226, 232, 240, 0.95)',
        }}
      >
        {/* Top Accent Gradient Bar */}
        <div className="modal-top-accent purple-accent" style={{ height: '4px', background: 'linear-gradient(90deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%)' }}></div>

        {/* 1. Bento Header */}
        <div className="shift-bento-header" style={{ padding: '1.1rem 1.6rem', borderBottom: '1px solid #e2e8f0' }}>
          <div className="shift-bento-header-left" style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
            <div
              className="shift-bento-icon-badge purple"
              style={{
                width: '46px',
                height: '46px',
                borderRadius: '13px',
                background: 'linear-gradient(135deg, #ede9fe 0%, #e0e7ff 100%)',
                color: '#6366f1',
                border: '1.2px solid #c7d2fe',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(99, 102, 241, 0.15)',
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
            </div>
            <div className="shift-bento-title-wrap">
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>Select Billing Counter</span>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '20px',
                    background: '#ede9fe',
                    color: '#6d28d9',
                    border: '1px solid #ddd6fe',
                  }}
                >
                  POS Register
                </span>
              </h3>
              <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                Choose the counter you are operating today for accurate shift logs and transaction data collection.
              </p>
            </div>
          </div>

          <div className="shift-bento-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.25rem 0.65rem',
                borderRadius: '20px',
                background: '#f1f5f9',
                border: '1px solid #cbd5e1',
                fontSize: '0.74rem',
                fontWeight: 700,
                color: '#334155',
              }}
              title={`Branch: ${branchName} (${branchCode})`}
            >
              <MapPinIcon size={12} style={{ color: '#6366f1' }} />
              <span>{branchName || 'Main Store'}</span>
            </div>

            {canClose && (
              <button
                type="button"
                className="modal-close-btn"
                onClick={onClose}
                aria-label="Close"
                title="Close"
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  color: '#64748b',
                  transition: 'all 0.15s ease',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* 2. Bento Body */}
        <div className="shift-bento-body" style={{ padding: '1.3rem 1.6rem', background: '#f8fafc', flex: 1, overflowY: 'auto' }}>
          {/* Top 3-Tile Context Ribbon */}
          <div className="shift-bento-ribbon cols-3" style={{ marginBottom: '1.2rem' }}>
            <div className="shift-bento-ribbon-tile">
              <div className="ribbon-tile-label">
                <span>Active Branch</span>
                <StoreIcon size={13} style={{ color: '#6366f1' }} />
              </div>
              <div className="ribbon-tile-val" style={{ fontSize: '1.05rem', color: '#1e293b' }}>
                {branchName || 'Main Branch'}
              </div>
              <div className="ribbon-tile-sub">Location Code: {branchCode}</div>
            </div>

            <div className="shift-bento-ribbon-tile">
              <div className="ribbon-tile-label">
                <span>Cashier On Duty</span>
                <UserIcon size={13} style={{ color: '#059669' }} />
              </div>
              <div className="ribbon-tile-val" style={{ fontSize: '1.05rem', color: '#1e293b' }}>
                {cashierName || 'Cashier'}
              </div>
              <div className="ribbon-tile-sub">Terminal Operator</div>
            </div>

            <div className="shift-bento-ribbon-tile highlight">
              <div className="ribbon-tile-label">
                <span>Selected Counter</span>
                <SparklesIcon size={13} style={{ color: '#8b5cf6' }} />
              </div>
              <div className="ribbon-tile-val" style={{ fontSize: '1.05rem', color: '#6d28d9' }}>
                {isCustomMode ? (customCounterText.trim() || 'Custom Counter') : selected}
              </div>
              <div className="ribbon-tile-sub">Billing Destination</div>
            </div>
          </div>

          {/* Error Notice */}
          {error && (
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#991b1b',
                padding: '0.65rem 0.9rem',
                borderRadius: '10px',
                fontSize: '0.82rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginBottom: '1rem',
              }}
            >
              <InfoIcon size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* Section Heading */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Choose Checkout Station
            </span>
            <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
              Click any card to select
            </span>
          </div>

          {/* Bento Cards Grid for Available Counters */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '0.85rem',
              marginBottom: '1.2rem',
            }}
          >
            {branchList.map((c) => {
              const isCardActive = !isCustomMode && selected === c.id;
              return (
                <div
                  key={c.id}
                  onClick={() => handleSelect(c.id)}
                  style={{
                    background: isCardActive ? 'linear-gradient(135deg, #f5f3ff 0%, #eef2ff 100%)' : '#ffffff',
                    border: isCardActive ? '2px solid #6366f1' : '1.5px solid #e2e8f0',
                    borderRadius: '14px',
                    padding: '1rem',
                    cursor: 'pointer',
                    transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '0.65rem',
                    boxShadow: isCardActive
                      ? '0 8px 20px -3px rgba(99, 102, 241, 0.22), 0 2px 6px rgba(99, 102, 241, 0.08)'
                      : '0 2px 5px rgba(15, 23, 42, 0.03)',
                    transform: isCardActive ? 'translateY(-2px)' : 'none',
                    position: 'relative',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '10px',
                        background: isCardActive ? '#6366f1' : '#f1f5f9',
                        color: isCardActive ? '#ffffff' : '#475569',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {c.isExpress ? <ZapIcon size={18} /> : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                          <line x1="8" y1="21" x2="16" y2="21" />
                          <line x1="12" y1="17" x2="12" y2="21" />
                        </svg>
                      )}
                    </div>
                    <span
                      style={{
                        fontSize: '0.68rem',
                        fontWeight: 800,
                        textTransform: 'uppercase',
                        padding: '2px 7px',
                        borderRadius: '12px',
                        background: isCardActive ? '#6366f1' : c.isExpress ? '#fef3c7' : '#f1f5f9',
                        color: isCardActive ? '#ffffff' : c.isExpress ? '#92400e' : '#475569',
                        letterSpacing: '0.03em',
                      }}
                    >
                      {c.tag}
                    </span>
                  </div>

                  <div>
                    <div style={{ fontSize: '1.02rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.2rem' }}>
                      {c.label}
                    </div>
                    <div style={{ fontSize: '0.73rem', color: '#64748b', lineHeight: 1.35 }}>
                      {c.desc}
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingTop: '0.5rem',
                      borderTop: isCardActive ? '1px solid rgba(99, 102, 241, 0.2)' : '1px solid #f1f5f9',
                    }}
                  >
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, color: isCardActive ? '#4f46e5' : '#94a3b8' }}>
                      {isCardActive ? 'Selected Counter' : 'Click to select'}
                    </span>
                    <div
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        border: isCardActive ? '2px solid #6366f1' : '1.5px solid #cbd5e1',
                        background: isCardActive ? '#6366f1' : '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#ffffff',
                      }}
                    >
                      {isCardActive && <CheckCircle2Icon size={14} />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Custom Counter Option Bento Box */}
          <div
            style={{
              background: '#ffffff',
              border: isCustomMode ? '2px solid #8b5cf6' : '1.5px solid #e2e8f0',
              borderRadius: '14px',
              padding: '1rem 1.2rem',
              boxShadow: '0 1px 3px rgba(15, 23, 42, 0.03)',
              marginBottom: '1rem',
              transition: 'all 0.18s ease',
            }}
          >
            <div
              onClick={() => {
                setIsCustomMode(!isCustomMode);
                if (!isCustomMode && !customCounterText) {
                  setCustomCounterText('Counter 4');
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <div
                  style={{
                    width: '30px',
                    height: '30px',
                    borderRadius: '8px',
                    background: isCustomMode ? '#ede9fe' : '#f8fafc',
                    color: isCustomMode ? '#7c3aed' : '#64748b',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <SparklesIcon size={16} />
                </div>
                <div>
                  <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#1e293b' }}>
                    Other / Custom Register Name
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                    Type a custom counter name or dedicated terminal identifier
                  </div>
                </div>
              </div>

              <div
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  color: isCustomMode ? '#7c3aed' : '#64748b',
                  background: isCustomMode ? '#f5f3ff' : '#f1f5f9',
                  padding: '3px 8px',
                  borderRadius: '6px',
                }}
              >
                {isCustomMode ? 'Active' : 'Custom +'}
              </div>
            </div>

            {isCustomMode && (
              <div style={{ marginTop: '0.85rem', paddingTop: '0.85rem', borderTop: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center' }}>
                  <input
                    type="text"
                    value={customCounterText}
                    onChange={(e) => {
                      setCustomCounterText(e.target.value);
                      setError(null);
                    }}
                    placeholder="e.g., Counter 4, Kiosk 1, Drive-Through, Bakery Billing..."
                    style={{
                      flex: 1,
                      padding: '0.65rem 0.9rem',
                      borderRadius: '10px',
                      border: '1.5px solid #c4b5fd',
                      fontSize: '0.88rem',
                      fontWeight: 600,
                      outline: 'none',
                    }}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (customCounterText.trim()) {
                        setSelected(customCounterText.trim());
                      }
                    }}
                    style={{
                      padding: '0.65rem 1rem',
                      borderRadius: '10px',
                      background: '#7c3aed',
                      color: '#ffffff',
                      border: 'none',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                    }}
                  >
                    Apply
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Audit & Data Collection Notice */}
          <div
            style={{
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: '12px',
              padding: '0.75rem 1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.65rem',
              color: '#1e40af',
              fontSize: '0.78rem',
              lineHeight: 1.4,
            }}
          >
            <InfoIcon size={16} style={{ flexShrink: 0, color: '#2563eb' }} />
            <span>
              <strong>Data Collection Notice:</strong> Every bill generated, payment received, and cash float movement for this cashier session will be attributed to this counter.
            </span>
          </div>
        </div>

        {/* 3. Bento Footer */}
        <div
          className="shift-bento-footer"
          style={{
            padding: '1rem 1.6rem',
            borderTop: '1px solid #e2e8f0',
            background: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.84rem', color: '#475569' }}>
            <span>Active Counter:</span>
            <span
              style={{
                fontWeight: 800,
                color: '#4338ca',
                background: '#e0e7ff',
                padding: '3px 10px',
                borderRadius: '8px',
                border: '1px solid #c7d2fe',
                fontSize: '0.88rem',
              }}
            >
              {isCustomMode ? (customCounterText.trim() || 'Custom Counter') : selected}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {canClose && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onClose}
                style={{
                  padding: '0.65rem 1.15rem',
                  borderRadius: '10px',
                  fontWeight: 700,
                  fontSize: '0.86rem',
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  color: '#475569',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            )}

            <button
              type="button"
              className="btn btn-primary"
              onClick={handleConfirm}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.65rem 1.4rem',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                color: '#ffffff',
                border: 'none',
                fontWeight: 800,
                fontSize: '0.88rem',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(79, 70, 229, 0.35)',
                transition: 'all 0.15s ease',
              }}
            >
              <span>Confirm & Start Billing</span>
              <ArrowRightIcon size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
