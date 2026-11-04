import React from 'react';

export interface BentoHeaderCardProps {
  icon: React.ReactNode;
  badgeText?: string;
  badgeTooltip?: string;
  subtitle: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export const BentoHeaderCard: React.FC<BentoHeaderCardProps> = ({
  icon,
  badgeText = 'Live',
  badgeTooltip,
  subtitle,
  actions,
  className = '',
  children,
}) => {
  return (
    <div className={`cat-bento-header-card bento-card-3d ${className}`}>
      <div className="cat-bento-header-content">
        <div className="cat-bento-title-group">
          <div className="cat-bento-icon-box">
            {icon}
          </div>
          <div>
            {badgeText && (
              <div className="cat-bento-title-row" style={{ margin: 0, marginBottom: '2px' }}>
                <span className="cat-badge-live-sync" title={badgeTooltip}>
                  <span className="live-indicator-dot"></span>
                  {badgeText}
                </span>
              </div>
            )}
            <p className="cat-bento-subtitle" style={{ margin: 0 }}>
              {subtitle}
            </p>
          </div>
        </div>

        {actions && (
          <div className="cat-bento-header-actions">
            {actions}
          </div>
        )}
      </div>

      {children}
    </div>
  );
};

export interface StatCardProps {
  icon: React.ReactNode;
  iconVariant?: 'green' | 'amber' | 'red' | 'slate' | 'indigo' | 'purple' | 'blue';
  label: string;
  statusPill?: {
    text: string;
    variant?: string;
  };
  count: React.ReactNode;
  countColor?: string;
  countVariant?: 'green' | 'amber' | 'red' | 'slate' | 'blue' | 'default';
  hint: React.ReactNode;
  isSelected?: boolean;
  onClick?: () => void;
  title?: string;
  cardVariant?: string;
  className?: string;
  useSansFont?: boolean;
}

export const StatCard: React.FC<StatCardProps> = ({
  icon,
  iconVariant = 'indigo',
  label,
  statusPill,
  count,
  countColor,
  countVariant,
  hint,
  isSelected = false,
  onClick,
  title,
  cardVariant = '',
  className = '',
  useSansFont = false,
}) => {
  const countColorClass = countVariant ? `text-${countVariant}` : '';

  return (
    <div
      className={`cat-bento-kpi-card bento-card-3d ${cardVariant} ${isSelected ? 'active-filter' : ''} ${className}`}
      onClick={onClick}
      title={title}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-pressed={onClick ? isSelected : undefined}
      onKeyDown={onClick ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      } : undefined}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
    >
      <div className="cat-kpi-header">
        <div className="cat-kpi-header-left">
          <div className={`cat-icon-badge ${iconVariant}`}>
            {icon}
          </div>
          <span className="cat-kpi-title">{label}</span>
        </div>
        {statusPill && (
          <span className={`kpi-sub-badge ${statusPill.variant || 'purple'}`}>
            {statusPill.text}
          </span>
        )}
      </div>

      <div
        className={`cat-kpi-num ${useSansFont ? 'font-sans' : 'mono'} ${countColorClass}`}
        style={countColor ? { color: countColor } : undefined}
      >
        {count}
      </div>

      <div className="cat-kpi-footer">
        <span>{hint}</span>
        <span className="cat-kpi-arrow">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <polyline points="12 5 19 12 12 19"></polyline>
          </svg>
        </span>
      </div>
    </div>
  );
};

export interface StatusPillProps {
  status: string;
  label?: string;
  className?: string;
}

export const StatusPill: React.FC<StatusPillProps> = ({ status, label, className = '' }) => {
  const normStatus = status.toLowerCase();
  const displayLabel = label || (normStatus.charAt(0).toUpperCase() + normStatus.slice(1));

  return (
    <span className={`promo-status-pill ${normStatus} ${className}`}>
      <span className="promo-status-dot-inner"></span>
      {displayLabel}
    </span>
  );
};

export interface TypeChipProps {
  label: string;
  className?: string;
}

export const TypeChip: React.FC<TypeChipProps> = ({ label, className = '' }) => {
  return (
    <span className={`promo-type-chip ${className}`}>
      {label}
    </span>
  );
};

export interface BentoButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline';
  icon?: React.ReactNode;
}

export const BentoButton: React.FC<BentoButtonProps> = ({
  variant = 'primary',
  icon,
  children,
  className = '',
  ...props
}) => {
  const btnClass = variant === 'primary' ? 'cat-btn-primary' : 'cat-btn-outline';
  return (
    <button type="button" className={`${btnClass} ${className}`} {...props}>
      {icon && <span>{icon}</span>}
      {children}
    </button>
  );
};

