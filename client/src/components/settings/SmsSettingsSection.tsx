import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { User, Shop } from '../../api';
import {
  getSmsTrialStatus,
  getSmsSettings,
  updateSmsSettings,
  activateSmsTrial,
  sendTestSms,
  getSmsHistory,
  retrySms,
  type SmsTrialStatus,
  type SmsSettings,
  type SmsHistoryItem,
} from '../../api';

interface SmsSettingsSectionProps {
  user: User;
  shop: Shop | null;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

export function SmsSettingsSection({ user, shop, showToast }: SmsSettingsSectionProps) {
  const isSuperAdmin = user.role === 'owner';
  const isManager = user.role === 'manager';

  // Trial Status State
  const [trial, setTrial] = useState<SmsTrialStatus | null>(null);
  const [loadingTrial, setLoadingTrial] = useState(true);
  const [isActivating, setIsActivating] = useState(false);

  // Settings State
  const [settings, setSettings] = useState<SmsSettings | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [provider, setProvider] = useState<string>('msg91');
  const [apiKey, setApiKey] = useState<string>('');
  const [senderId, setSenderId] = useState<string>('');
  const [templateId, setTemplateId] = useState<string>('');
  const [autoSendEnabled, setAutoSendEnabled] = useState<boolean>(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [showConfigCard, setShowConfigCard] = useState(false);

  // Test SMS State
  const [showTestModal, setShowTestModal] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testCustomMsg, setTestCustomMsg] = useState('');
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; msg: string } | null>(null);

  // Gateway response modal
  const [viewingResponse, setViewingResponse] = useState<any | null>(null);

  // History State
  const [history, setHistory] = useState<SmsHistoryItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const limit = 10;
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // Fetch trial status
  const loadTrial = useCallback(async () => {
    try {
      const data = await getSmsTrialStatus();
      setTrial(data);
    } catch (err: any) {
      console.error('Failed to load SMS trial status:', err);
    } finally {
      setLoadingTrial(false);
    }
  }, []);

  // Fetch settings
  const loadSettings = useCallback(async () => {
    try {
      const data = await getSmsSettings();
      setSettings(data);
      setProvider(data.provider || 'msg91');
      setSenderId(data.senderId || '');
      setTemplateId(data.templateId || '');
      setAutoSendEnabled(data.autoSendEnabled ?? true);
      setApiKey(''); // never populate raw key
    } catch (err: any) {
      console.error('Failed to load SMS settings:', err);
    } finally {
      setLoadingSettings(false);
    }
  }, []);

  // Fetch history
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await getSmsHistory({
        limit,
        offset: page * limit,
        q: searchQuery.trim() || undefined,
        status: statusFilter || undefined,
      });
      setHistory(res.history);
      setHistoryTotal(res.total);
    } catch (err: any) {
      console.error('Failed to load SMS history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, [page, searchQuery, statusFilter]);

  useEffect(() => {
    loadTrial();
    loadSettings();
  }, [loadTrial, loadSettings]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Save Settings Handler
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) {
      showToast('Only Super Admin can update SMS configuration.', 'warning');
      return;
    }

    setIsSavingSettings(true);
    try {
      const payload: any = {
        provider,
        senderId: senderId.trim(),
        templateId: templateId.trim(),
        autoSendEnabled,
      };
      if (apiKey.trim()) {
        payload.apiKey = apiKey.trim();
      }

      const res = await updateSmsSettings(payload);
      if (res.ok) {
        showToast('SMS Gateway settings updated successfully!', 'success');
        setSettings(res.settings);
        setApiKey('');
        loadTrial();
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to update SMS settings', 'error');
    } finally {
      setIsSavingSettings(false);
    }
  };

  // Activate Trial Handler
  const handleActivateTrial = async () => {
    if (!isSuperAdmin) {
      showToast('Only Super Admin can activate the Free SMS Trial.', 'warning');
      return;
    }
    const confirm = window.confirm(
      'Activate 100 Free SMS Trial?\n\n• Duration: Exactly 24 hours from activation\n• Total Quota: 100 transactional SMS\n• Starts immediately for all branches'
    );
    if (!confirm) return;

    setIsActivating(true);
    try {
      const res = await activateSmsTrial();
      setTrial(res.status);
      showToast('🎉 Free SMS Trial successfully activated! 100 credits available for 24 hours.', 'success');
      loadHistory();
    } catch (err: any) {
      showToast(err.message || 'Failed to activate SMS trial', 'error');
    } finally {
      setIsActivating(false);
    }
  };

  // Test SMS Handler
  const handleSendTestSms = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanDigits = testPhone.replace(/\D/g, '');
    if (cleanDigits.length < 10) {
      showToast('Please enter a valid 10-digit Indian mobile number.', 'warning');
      return;
    }

    setIsSendingTest(true);
    setTestResult(null);
    try {
      const res = await sendTestSms(testPhone.trim(), testCustomMsg.trim() || undefined);
      if (res.ok) {
        setTestResult({ success: true, msg: `SMS sent successfully! Message ID: ${res.messageId || 'OK'}` });
        showToast('Test SMS dispatched successfully!', 'success');
        loadTrial();
        loadHistory();
      } else {
        setTestResult({ success: false, msg: res.error || 'Gateway rejected SMS' });
        showToast(res.error || 'Failed to dispatch test SMS', 'error');
      }
    } catch (err: any) {
      setTestResult({ success: false, msg: err.message || 'Error communicating with SMS Gateway' });
      showToast(err.message || 'Failed to send test SMS', 'error');
    } finally {
      setIsSendingTest(false);
    }
  };

  // Retry Failed Message Handler
  const handleRetry = async (logId: string) => {
    setRetryingId(logId);
    try {
      const res = await retrySms(logId);
      if (res.ok) {
        showToast('Message retried and sent successfully!', 'success');
        loadTrial();
        loadHistory();
      } else {
        showToast(res.error || 'Retry failed', 'error');
        loadHistory();
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to retry SMS', 'error');
    } finally {
      setRetryingId(null);
    }
  };

  // Remaining time calculation
  const remainingTimeStr = useMemo(() => {
    if (!trial?.expiresAt || trial.status !== 'active') return null;
    const diffMs = new Date(trial.expiresAt).getTime() - Date.now();
    if (diffMs <= 0) return 'Expired';
    const hrs = Math.floor(diffMs / (1000 * 60 * 60));
    const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hrs}h ${mins}m remaining`;
  }, [trial]);

  const formatDate = (isoStr?: string | null) => {
    if (!isoStr) return '—';
    try {
      return new Date(isoStr).toLocaleString('en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return isoStr;
    }
  };

  const percentUsed = trial ? Math.min(100, Math.round((trial.creditsUsed / trial.totalCredits) * 100)) : 0;

  return (
    <div className="card settings-section" style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #f1f5f9', paddingBottom: '1.25rem', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '1.5rem' }}>💬</span>
            <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>
              SMS Gateway & Billing Notifications
            </h3>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                padding: '0.2rem 0.6rem',
                borderRadius: '999px',
                background: trial?.status === 'active' ? '#ecfdf5' : trial?.status === 'inactive' ? '#eff6ff' : '#fef2f2',
                color: trial?.status === 'active' ? '#047857' : trial?.status === 'inactive' ? '#1d4ed8' : '#b91c1c',
                border: `1px solid ${trial?.status === 'active' ? '#a7f3d0' : trial?.status === 'inactive' ? '#bfdbfe' : '#fecaca'}`,
              }}
            >
              {trial?.status === 'active' ? '🟢 Trial Active' : trial?.status === 'inactive' ? '🔵 Trial Available' : trial?.status === 'exhausted' ? '🟠 Credits Exhausted' : '🔴 Trial Expired'}
            </span>
          </div>
          <p style={{ margin: '0.4rem 0 0 0', color: '#64748b', fontSize: '0.88rem' }}>
            Multi-branch automatic bill SMS notifications (MSG91, SMSLocal, Fast2SMS) with 100 free SMS trial enforcement.
          </p>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => setShowConfigCard(!showConfigCard)}
              className="btn btn-outline"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                padding: '0.55rem 1rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontWeight: 600,
                fontSize: '0.86rem',
                background: showConfigCard ? '#eff6ff' : '#f8fafc',
                color: showConfigCard ? '#1d4ed8' : '#334155',
                cursor: 'pointer',
              }}
            >
              <span>⚙️</span>
              <span>{showConfigCard ? 'Close Gateway Config' : 'Configure Gateway'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setShowTestModal(true);
              setTestResult(null);
            }}
            className="btn btn-outline"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.55rem 1rem',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontWeight: 600,
              fontSize: '0.86rem',
              background: '#f8fafc',
              color: '#334155',
              cursor: 'pointer',
            }}
          >
            <span>📱</span>
            <span>Send Test SMS</span>
          </button>

          {isSuperAdmin && trial?.canActivate && (
            <button
              type="button"
              onClick={handleActivateTrial}
              disabled={isActivating}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.55rem 1.25rem',
                borderRadius: '8px',
                border: 'none',
                fontWeight: 700,
                fontSize: '0.86rem',
                background: 'linear-gradient(135deg, #6d4aff 0%, #4f46e5 100%)',
                color: '#ffffff',
                boxShadow: '0 4px 12px rgba(99, 102, 241, 0.35)',
                cursor: 'pointer',
              }}
            >
              <span>✨</span>
              <span>{isActivating ? 'Activating...' : 'Activate 100 Free SMS Trial'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Super Admin Gateway Configuration Card */}
      {isSuperAdmin && (showConfigCard || !settings?.isConfigured) && (
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            borderRadius: '12px',
            padding: '1.5rem',
            marginBottom: '1.75rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <div>
              <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>
                ⚙️ SMS Gateway Provider Configuration
              </h4>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.84rem', color: '#64748b' }}>
                Configure your official SMS gateway credentials. Keys are saved securely in database or backed by backend environment variables.
              </p>
            </div>
            <span
              style={{
                fontSize: '0.74rem',
                fontWeight: 700,
                padding: '0.2rem 0.5rem',
                borderRadius: '4px',
                background: settings?.hasApiKey ? '#ecfdf5' : '#fffbeb',
                color: settings?.hasApiKey ? '#047857' : '#b45309',
                border: `1px solid ${settings?.hasApiKey ? '#a7f3d0' : '#fde68a'}`,
              }}
            >
              {settings?.hasApiKey ? `API Key Saved (${settings.apiKeyMasked})` : 'No API Key Set'}
            </span>
          </div>

          <form onSubmit={handleSaveSettings}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
              {/* Provider Selection */}
              <div>
                <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
                  SMS Gateway Provider *
                </label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.55rem 0.75rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.86rem',
                    background: '#ffffff',
                  }}
                >
                  <option value="msg91">MSG91 Flow API (Recommended for India DLT)</option>
                  <option value="smslocal">SMSLocal / Textlocal India</option>
                  <option value="fast2sms">Fast2SMS (India)</option>
                  <option value="twilio">Twilio Global SMS</option>
                  <option value="simulator">SMS Simulator (Testing Mode - Free)</option>
                </select>
                <span style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.3rem', display: 'block' }}>
                  {provider === 'msg91' && 'India #1 enterprise gateway. Uses Flow API with variable mapping.'}
                  {provider === 'smslocal' && 'Textlocal India API. Instant setup with sender ID support.'}
                  {provider === 'fast2sms' && 'Note: Fast2SMS requires ₹100 minimum wallet recharge before API route unlocks.'}
                  {provider === 'simulator' && 'Zero-cost development mode. Outputs SMS payloads directly to server console.'}
                </span>
              </div>

              {/* API Key */}
              <div>
                <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
                  API Key / Auth Token
                </label>
                <input
                  type="password"
                  placeholder={settings?.hasApiKey ? `Leave blank to keep current (${settings.apiKeyMasked})` : 'Enter provider API Key'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.55rem 0.75rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.86rem',
                  }}
                />
                <span style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.3rem', display: 'block' }}>
                  Encrypted at rest and strictly kept in backend. Never sent to browser.
                </span>
              </div>

              {/* Sender ID */}
              <div>
                <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
                  Sender ID / Header (DLT)
                </label>
                <input
                  type="text"
                  placeholder="e.g. SKSSUP or TXTLCL"
                  maxLength={6}
                  value={senderId}
                  onChange={(e) => setSenderId(e.target.value.toUpperCase())}
                  style={{
                    width: '100%',
                    padding: '0.55rem 0.75rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.86rem',
                  }}
                />
                <span style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.3rem', display: 'block' }}>
                  6-character approved header name on Indian telecom DLT portal.
                </span>
              </div>

              {/* Template ID */}
              <div>
                <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
                  DLT Template ID / Flow ID
                </label>
                <input
                  type="text"
                  placeholder="e.g. 64a7c9f... or 110716..."
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.55rem 0.75rem',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.86rem',
                  }}
                />
                <span style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.3rem', display: 'block' }}>
                  MSG91 Flow ID or TRAI DLT Template ID approved by telecom operator.
                </span>
              </div>
            </div>

            {/* Toggle: Enable / Disable Automatic SMS */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.85rem 1.15rem',
                borderRadius: '8px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                marginBottom: '1.25rem',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1e293b' }}>
                  Automatic SMS After Bill Generation
                </div>
                <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                  When enabled, billing bills will automatically send a thank-you SMS with invoice number, amount, and loyalty points.
                </div>
              </div>

              <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={autoSendEnabled}
                  onChange={(e) => setAutoSendEnabled(e.target.checked)}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
                <span style={{ fontWeight: 700, fontSize: '0.86rem', color: autoSendEnabled ? '#047857' : '#64748b' }}>
                  {autoSendEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setShowConfigCard(false)}
                className="btn btn-outline"
                style={{ padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSavingSettings}
                style={{
                  padding: '0.5rem 1.25rem',
                  borderRadius: '6px',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: '0.86rem',
                  background: '#2563eb',
                  color: '#ffffff',
                  cursor: isSavingSettings ? 'not-allowed' : 'pointer',
                }}
              >
                {isSavingSettings ? 'Saving...' : 'Save Configuration'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Top 3 KPI Bento Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem', marginBottom: '1.75rem' }}>
        {/* Card 1: Provider & Integration Status */}
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '1.25rem',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                SMS Gateway Provider
              </span>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '0.2rem 0.5rem',
                    borderRadius: '6px',
                    background: settings?.authStatus === 'valid' ? '#ecfdf5' : (trial?.isConfigured ? '#fffbeb' : '#f8fafc'),
                    color: settings?.authStatus === 'valid' ? '#047857' : (trial?.isConfigured ? '#b45309' : '#64748b'),
                    border: `1px solid ${settings?.authStatus === 'valid' ? '#a7f3d0' : (trial?.isConfigured ? '#fde68a' : '#cbd5e1')}`,
                  }}
                >
                  {settings?.authStatus === 'valid'
                    ? `Auth Valid (${settings.walletBalance || '₹50.00'})`
                    : (trial?.isConfigured ? 'Awaiting Key' : 'Not Configured')}
                </span>
                {provider === 'fast2sms' && (
                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      padding: '0.2rem 0.5rem',
                      borderRadius: '6px',
                      background: '#fff7ed',
                      color: '#c2410c',
                      border: '1px solid #fed7aa',
                    }}
                    title="Fast2SMS requires a one-time ₹100 transaction to unlock API route"
                  >
                    API Route: ₹100 Req.
                  </span>
                )}
              </div>
            </div>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: '#0f172a' }}>
              {trial?.provider || 'Fast2SMS (India)'}
            </div>
            <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '0.35rem' }}>
              Automatic Billing SMS: <strong>{autoSendEnabled ? 'Active' : 'Paused'}</strong>
            </div>
          </div>
          <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid #e2e8f0', fontSize: '0.78rem', color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
            <span>Target Country: <strong style={{ color: '#1e293b' }}>India (+91)</strong></span>
            {settings?.walletBalance && <span>Wallet: <strong style={{ color: '#047857' }}>{settings.walletBalance}</strong></span>}
          </div>
        </div>

        {/* Card 2: Trial Credits (100 Free SMS) */}
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '1.25rem',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Free Trial Credits
              </span>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#4f46e5' }}>
                {trial?.remainingCredits ?? 100} Remaining
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.85rem', fontWeight: 800, color: '#1e293b' }}>
                {trial?.creditsUsed ?? 0}
              </span>
              <span style={{ fontSize: '1rem', color: '#64748b', fontWeight: 500 }}>
                / {trial?.totalCredits ?? 100} Used
              </span>
            </div>
            {/* Progress Bar */}
            <div style={{ marginTop: '0.75rem', width: '100%', height: '8px', background: '#e2e8f0', borderRadius: '999px', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${percentUsed}%`,
                  background: percentUsed >= 100 ? '#ef4444' : 'linear-gradient(90deg, #6366f1, #4f46e5)',
                  borderRadius: '999px',
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
          </div>
          <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', color: '#64748b' }}>
            <span>Concurrency Safe:</span>
            <strong style={{ color: '#047857' }}>PostgreSQL Atomic Lock Active</strong>
          </div>
        </div>

        {/* Card 3: 24-Hour Validity Window */}
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '1.25rem',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Trial Validity (24h)
              </span>
              {remainingTimeStr && (
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '0.2rem 0.5rem',
                    borderRadius: '6px',
                    background: remainingTimeStr === 'Expired' ? '#fef2f2' : '#eff6ff',
                    color: remainingTimeStr === 'Expired' ? '#b91c1c' : '#1d4ed8',
                  }}
                >
                  {remainingTimeStr}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.84rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Activated:</span>
                <span style={{ fontWeight: 600, color: '#1e293b' }}>{formatDate(trial?.activatedAt)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Expires:</span>
                <span style={{ fontWeight: 600, color: '#1e293b' }}>{formatDate(trial?.expiresAt)}</span>
              </div>
            </div>
          </div>
          <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid #e2e8f0', fontSize: '0.78rem', color: '#64748b' }}>
            <span>Trial Enforced: </span>
            <strong style={{ color: '#1e293b' }}>Server-side 24h & 100 SMS Hard Limit</strong>
          </div>
        </div>
      </div>

      {/* Role Notice Banner */}
      {!isSuperAdmin && (
        <div
          style={{
            marginBottom: '1.5rem',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            color: '#334155',
            fontSize: '0.86rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <span>ℹ️</span>
          <span>
            You are logged in as <strong>{user.role}</strong>. SMS gateway credentials and free trial activation are managed by Super Admin. You can view SMS history for your assigned branch below.
          </span>
        </div>
      )}

      {/* DLT Approved SMS Template Preview */}
      <div
        style={{
          background: '#f1f5f9',
          border: '1px solid #cbd5e1',
          borderRadius: '10px',
          padding: '1.25rem',
          marginBottom: '2rem',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <strong style={{ fontSize: '0.88rem', color: '#0f172a' }}>
            📜 Indian DLT-Approved Billing Template
          </strong>
          <span style={{ fontSize: '0.74rem', background: '#e2e8f0', color: '#475569', padding: '0.15rem 0.5rem', borderRadius: '4px', fontWeight: 600 }}>
            Auto-dispatched on Cashier "Generate Bill"
          </span>
        </div>
        <p style={{ margin: 0, fontSize: '0.84rem', color: '#334155', fontStyle: 'italic', background: '#ffffff', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px dashed #94a3b8' }}>
          "Thank you, <strong>[Customer Name]</strong>, for shopping at <strong>{shop?.name || 'Shop Name'}</strong>. Bill No: <strong>INV-1024</strong>. Amount: Rs.<strong>1250.00</strong>. Loyalty Points Earned: <strong>125</strong>. Visit again!"
        </p>
        <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.75rem', fontSize: '0.76rem', color: '#64748b', flexWrap: 'wrap' }}>
          <span>✓ Branch name dynamically formatted</span>
          <span>✓ Customer phone absent = Gracefully skipped</span>
          <span>✓ Billing & payment 100% resilient to SMS gateway delays</span>
          <span>✓ Zero duplicate SMS per invoice</span>
        </div>
      </div>

      {/* SMS History Section */}
      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#1e293b' }}>
              SMS Delivery History
            </h4>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
              Showing {history.length} of {historyTotal} records
            </span>
          </div>

          {/* Filters & Search */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search invoice, customer, mobile..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(0);
              }}
              style={{
                padding: '0.45rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '0.84rem',
                minWidth: '220px',
              }}
            />

            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(0);
              }}
              style={{
                padding: '0.45rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '0.84rem',
                background: '#ffffff',
              }}
            >
              <option value="">All Statuses</option>
              <option value="sent">Sent</option>
              <option value="delivered">Delivered</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
            </select>

            <button
              type="button"
              onClick={loadHistory}
              className="btn btn-outline"
              style={{ padding: '0.45rem 0.75rem', borderRadius: '6px', fontSize: '0.84rem', cursor: 'pointer' }}
              title="Refresh History"
            >
              🔄
            </button>
          </div>
        </div>

        {/* History Table */}
        <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 600 }}>
                <th style={{ padding: '0.75rem 1rem' }}>Invoice No</th>
                <th style={{ padding: '0.75rem 1rem' }}>Customer</th>
                <th style={{ padding: '0.75rem 1rem' }}>Mobile Number</th>
                <th style={{ padding: '0.75rem 1rem' }}>Branch</th>
                <th style={{ padding: '0.75rem 1rem' }}>Type</th>
                <th style={{ padding: '0.75rem 1rem' }}>Status</th>
                <th style={{ padding: '0.75rem 1rem' }}>Date & Time</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {historyLoading ? (
                <tr>
                  <td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                    Loading SMS history...
                  </td>
                </tr>
              ) : history.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: '2.5rem', textAlign: 'center', color: '#64748b' }}>
                    No SMS messages found matching your filter criteria.
                  </td>
                </tr>
              ) : (
                history.map((row) => {
                  const statusColors: Record<string, { bg: string; text: string; border: string }> = {
                    sent: { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0' },
                    delivered: { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
                    pending: { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
                    failed: { bg: '#fef2f2', text: '#b91c1c', border: '#fecaca' },
                  };
                  const col = statusColors[row.status] || statusColors.pending;

                  return (
                    <tr key={row.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#1e293b' }}>
                        {row.invoiceNumber || '—'}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: '#334155' }}>
                        <div>{row.customerName || 'Valued Customer'}</div>
                        {row.customerId && (
                          <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>ID: {row.customerId.slice(-6)}</div>
                        )}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', color: '#0f172a' }}>
                        +91 {row.mobileNumber}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: '#475569' }}>
                        {row.branchName || row.branchCode || 'Main'}
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            padding: '0.15rem 0.45rem',
                            borderRadius: '4px',
                            background: row.creditType === 'trial' ? '#f5f3ff' : '#ecfdf5',
                            color: row.creditType === 'trial' ? '#6d28d9' : '#047857',
                            border: `1px solid ${row.creditType === 'trial' ? '#ddd6fe' : '#a7f3d0'}`,
                          }}
                        >
                          {row.creditType === 'trial' ? 'Trial SMS' : 'Paid SMS'}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <span
                            style={{
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              padding: '0.15rem 0.5rem',
                              borderRadius: '4px',
                              background: col.bg,
                              color: col.text,
                              border: `1px solid ${col.border}`,
                            }}
                          >
                            {row.status}
                          </span>
                          {row.gatewayResponse && (
                            <button
                              type="button"
                              onClick={() => setViewingResponse(row.gatewayResponse)}
                              title="View gateway response"
                              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}
                            >
                              🔍
                            </button>
                          )}
                        </div>
                        {row.errorMessage && (
                          <div style={{ fontSize: '0.72rem', color: '#dc2626', marginTop: '0.2rem', maxWidth: '180px' }} title={row.errorMessage}>
                            {row.errorMessage.slice(0, 40)}...
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: '#64748b', fontSize: '0.78rem' }}>
                        {formatDate(row.sentAt || row.createdAt)}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>
                        {row.status === 'failed' ? (
                          <button
                            type="button"
                            onClick={() => handleRetry(row.id)}
                            disabled={retryingId === row.id}
                            style={{
                              padding: '0.3rem 0.65rem',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              borderRadius: '4px',
                              border: '1px solid #f87171',
                              background: '#fff',
                              color: '#dc2626',
                              cursor: 'pointer',
                            }}
                          >
                            {retryingId === row.id ? 'Retrying...' : 'Retry'}
                          </button>
                        ) : (
                          <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', fontSize: '0.82rem', color: '#64748b' }}>
          <div>
            Page {page + 1} of {Math.max(1, Math.ceil(historyTotal / limit))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="btn btn-outline"
              style={{ padding: '0.35rem 0.75rem', borderRadius: '4px', cursor: page === 0 ? 'not-allowed' : 'pointer' }}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={(page + 1) * limit >= historyTotal}
              onClick={() => setPage((p) => p + 1)}
              className="btn btn-outline"
              style={{ padding: '0.35rem 0.75rem', borderRadius: '4px', cursor: (page + 1) * limit >= historyTotal ? 'not-allowed' : 'pointer' }}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Gateway Response Modal */}
      {viewingResponse && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '10px',
              maxWidth: '540px',
              width: '100%',
              padding: '1.25rem',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1e293b' }}>
                Gateway Audit Response
              </h4>
              <button
                type="button"
                onClick={() => setViewingResponse(null)}
                style={{ background: 'transparent', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>
            <pre
              style={{
                background: '#0f172a',
                color: '#38bdf8',
                padding: '1rem',
                borderRadius: '6px',
                fontSize: '0.76rem',
                maxHeight: '300px',
                overflowY: 'auto',
              }}
            >
              {JSON.stringify(viewingResponse, null, 2)}
            </pre>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button
                type="button"
                onClick={() => setViewingResponse(null)}
                className="btn btn-outline"
                style={{ padding: '0.4rem 1rem', borderRadius: '6px', cursor: 'pointer' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Test SMS Modal */}
      {showTestModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '1rem',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              borderRadius: '12px',
              maxWidth: '480px',
              width: '100%',
              padding: '1.5rem',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h4 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#1e293b' }}>
                📱 Send Test SMS
              </h4>
              <button
                type="button"
                onClick={() => setShowTestModal(false)}
                style={{ background: 'transparent', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSendTestSms}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
                  Indian Mobile Number *
                </label>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ padding: '0.55rem 0.75rem', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRight: 'none', borderRadius: '6px 0 0 6px', fontSize: '0.88rem', color: '#475569', fontWeight: 600 }}>
                    +91
                  </span>
                  <input
                    type="tel"
                    required
                    placeholder="9840456789"
                    maxLength={10}
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    style={{
                      flex: 1,
                      padding: '0.55rem 0.75rem',
                      border: '1px solid #cbd5e1',
                      borderRadius: '0 6px 6px 0',
                      fontSize: '0.88rem',
                    }}
                  />
                </div>
                <span style={{ fontSize: '0.74rem', color: '#64748b', marginTop: '0.25rem', display: 'block' }}>
                  Must be 10 digits starting with 6, 7, 8, or 9
                </span>
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.84rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
                  Message Text (Optional)
                </label>
                <textarea
                  rows={3}
                  maxLength={160}
                  placeholder={`Test SMS from ${shop?.name || 'Store'}. Gateway integration verified!`}
                  value={testCustomMsg}
                  onChange={(e) => setTestCustomMsg(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.55rem 0.75rem',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {testResult && (
                <div
                  style={{
                    marginBottom: '1rem',
                    padding: '0.75rem 1rem',
                    borderRadius: '6px',
                    fontSize: '0.82rem',
                    background: testResult.success ? '#ecfdf5' : '#fef2f2',
                    color: testResult.success ? '#047857' : '#b91c1c',
                    border: `1px solid ${testResult.success ? '#a7f3d0' : '#fecaca'}`,
                  }}
                >
                  {testResult.msg}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => setShowTestModal(false)}
                  className="btn btn-outline"
                  style={{ padding: '0.55rem 1rem', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSendingTest || testPhone.length < 10}
                  style={{
                    padding: '0.55rem 1.25rem',
                    borderRadius: '6px',
                    border: 'none',
                    fontWeight: 600,
                    fontSize: '0.86rem',
                    background: '#6d4aff',
                    color: '#ffffff',
                    cursor: isSendingTest || testPhone.length < 10 ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isSendingTest ? 'Sending...' : 'Send SMS'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
