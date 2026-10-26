import React from 'react';

export interface ToggleSwitchProps {
  checked: boolean;
  onChange: () => void | Promise<void>;
  disabled?: boolean;
  loading?: boolean;
  ariaLabel?: string;
  title?: string;
  id?: string;
  className?: string;
}

/**
 * Reusable accessible toggle switch component
 * Size: track 40 × 22px, knob 16px white circle
 * Active: Green track (#10b981)
 * Inactive: Red track (#ef4444)
 */
export function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
  loading = false,
  ariaLabel,
  title,
  id,
  className = '',
}: ToggleSwitchProps) {
  const isInteractive = !disabled && !loading;

  const defaultTitle = checked
    ? 'Active · click to deactivate'
    : 'Inactive · click to activate';

  const defaultAriaLabel = checked ? 'Active' : 'Inactive';

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isInteractive) return;
    onChange();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (!isInteractive) return;
      onChange();
    }
  };

  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel || defaultAriaLabel}
      title={title || defaultTitle}
      disabled={disabled || loading}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`toggle-switch ${checked ? 'is-checked' : ''} ${
        disabled || loading ? 'is-disabled' : ''
      } ${className}`.trim()}
      style={{
        width: '40px',
        height: '22px',
        borderRadius: '999px',
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        border: 'none',
        padding: 0,
        margin: 0,
        backgroundColor: checked ? '#10b981' : '#ef4444',
        cursor: isInteractive ? 'pointer' : 'not-allowed',
        opacity: isInteractive ? 1 : 0.5,
        transition: 'background-color 0.2s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease',
        flexShrink: 0,
        verticalAlign: 'middle',
      }}
    >
      <span
        className="toggle-switch-knob"
        style={{
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          backgroundColor: '#ffffff',
          position: 'absolute',
          top: '3px',
          left: '3px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.25)',
          transform: checked ? 'translateX(18px)' : 'translateX(0)',
          transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          pointerEvents: 'none',
        }}
      />
    </button>
  );
}
