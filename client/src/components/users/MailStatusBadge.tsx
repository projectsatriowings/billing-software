import React from 'react';

export interface MailStatusBadgeProps {
  status?: 'SENT' | 'FAILED' | 'QUEUED' | null;
  error?: string | null;
  sentAt?: string | null;
  onRetry?: () => void;
}

export const MailStatusBadge: React.FC<MailStatusBadgeProps> = ({
  status,
  error,
  sentAt,
  onRetry,
}) => {
  if (status === 'SENT') {
    const timeFormatted = sentAt ? new Date(sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const dateFormatted = sentAt ? new Date(sentAt).toLocaleDateString([], { day: 'numeric', month: 'short' }) : '';

    return (
      <span
        className="um-mail-status-icon sent"
        tabIndex={0}
        role="img"
        aria-label={`Sign-in details emailed successfully on ${dateFormatted} at ${timeFormatted}`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
        <span
          style={{
            position: 'absolute',
            bottom: -2,
            right: -3,
            backgroundColor: '#11683F',
            borderRadius: '50%',
            width: 7,
            height: 7,
            border: '1.5px solid #FFFFFF',
          }}
          aria-hidden="true"
        />
        <span className="um-tooltip">
          Sign-in details emailed {sentAt ? `(${dateFormatted}, ${timeFormatted})` : ''}
        </span>
      </span>
    );
  }

  if (status === 'FAILED') {
    return (
      <span
        className="um-mail-status-icon failed"
        onClick={(e) => {
          e.stopPropagation();
          onRetry?.();
        }}
        tabIndex={0}
        role="button"
        aria-label={`Email failed: ${error || 'Delivery failed'}. Click to retry.`}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
        <span
          style={{
            position: 'absolute',
            bottom: -2,
            right: -3,
            backgroundColor: '#B42318',
            borderRadius: '50%',
            width: 7,
            height: 7,
            border: '1.5px solid #FFFFFF',
          }}
          aria-hidden="true"
        />
        <span className="um-tooltip">
          Email failed: {error || 'Could not deliver'} — Click to retry
        </span>
      </span>
    );
  }

  // Not sent / null
  return (
    <span
      className="um-mail-status-icon never"
      tabIndex={0}
      role="img"
      aria-label="Sign-in details have not been emailed"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
        <polyline points="22,6 12,13 2,6" />
      </svg>
      <span className="um-tooltip">Never emailed</span>
    </span>
  );
};

