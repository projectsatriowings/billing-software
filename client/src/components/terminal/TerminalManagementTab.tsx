import React, { useState, useEffect } from 'react';
import { api } from '../../api';
import type {
  CardTerminal,
  Branch,
  TerminalProvider,
  TerminalConnectionMode,
} from '../../../../shared/types';
import { TERMINAL_PROVIDERS, TERMINAL_CONNECTION_MODES } from '../../../../shared/types';

interface Props {
  userRole?: string;
  payMethodsEnabled: string[];
  setPayMethodsEnabled: (methods: string[]) => void;
  onSavePaymentSettings: () => void;
  showToast: (msg: string, type?: 'info' | 'error' | 'success') => void;
}

const PROVIDER_METADATA: Record<TerminalProvider, { label: string; desc: string; color: string; bg: string }> = {
  paytm: { label: 'Paytm All-In-One POS', desc: 'Cloud EDC & LAN bridge integration', color: '#002970', bg: '#e6f0ff' },
  pinelabs: { label: 'Pine Labs Plutus', desc: 'Plutus Cloud API (Sale 4001)', color: '#0d6832', bg: '#e7f7ed' },
  hdfc: { label: 'HDFC Bank POS', desc: 'SmartHub Vyapar / Merchant ECR', color: '#004c8f', bg: '#e8f2fc' },
  icici: { label: 'ICICI Bank POS', desc: 'IMS Merchant Services ECR', color: '#a83232', bg: '#fcedec' },
  verifone: { label: 'Verifone Point / ECR', desc: 'Engage & Point terminals (P400, V200)', color: '#134e4a', bg: '#e6fffa' },
  standalone: { label: 'Standalone EDC Machine', desc: 'Cashier manual RRN & slip confirmation', color: '#475569', bg: '#f1f5f9' },
  mock: { label: 'Sandbox Mock Terminal', desc: 'Software simulator for testing & demo', color: '#6d28d9', bg: '#f5f3ff' },
};

export const TerminalManagementTab: React.FC<Props> = ({
  userRole,
  payMethodsEnabled,
  setPayMethodsEnabled,
  onSavePaymentSettings,
  showToast,
}) => {
  const [terminals, setTerminals] = useState<CardTerminal[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [branchFilter, setBranchFilter] = useState<string>('ALL');

  // Add / Edit Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Ping state
  const [pingingId, setPingingId] = useState<string | null>(null);
  const [pingResult, setPingResult] = useState<{ id: string; online: boolean; message: string } | null>(null);

  // Form state
  const [form, setForm] = useState({
    branchId: '',
    counter: '',
    name: '',
    provider: 'paytm' as TerminalProvider,
    connectionMode: 'integrated' as TerminalConnectionMode,
    model: '',
    serialNumber: '',
    terminalId: '',
    merchantId: '',
    ipAddress: '',
    port: '8080',
    apiEndpoint: '',
    authToken: '',
    secretKey: '',
  });

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [termRes, branchRes] = await Promise.all([
        api<{ terminals: CardTerminal[] }>('/api/terminals').catch(() => ({ terminals: [] })),
        api<{ branches: Branch[] }>('/api/branches').catch(() => ({ branches: [] })),
      ]);
      setTerminals(termRes.terminals || []);
      setBranches(branchRes.branches || []);
      if (branchRes.branches?.length > 0 && !form.branchId) {
        setForm((prev) => ({ ...prev, branchId: branchRes.branches[0].id }));
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to load card terminals', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const openAddModal = (presetProvider?: TerminalProvider) => {
    setEditingId(null);
    setForm({
      branchId: branches[0]?.id || '',
      counter: '',
      name: presetProvider ? `${PROVIDER_METADATA[presetProvider].label} - Counter 1` : 'Main Counter EDC',
      provider: presetProvider || 'paytm',
      connectionMode: presetProvider === 'standalone' ? 'standalone' : 'integrated',
      model: '',
      serialNumber: '',
      terminalId: '',
      merchantId: '',
      ipAddress: '',
      port: '8080',
      apiEndpoint: '',
      authToken: '',
      secretKey: '',
    });
    setIsModalOpen(true);
  };

  const openEditModal = (t: CardTerminal) => {
    setEditingId(t.id);
    setForm({
      branchId: t.branchId || (t as any).branch_id || branches[0]?.id || '',
      counter: t.counter || '',
      name: t.name,
      provider: t.provider,
      connectionMode: t.connectionMode,
      model: t.model || '',
      serialNumber: t.serialNumber || '',
      terminalId: t.terminalId || '',
      merchantId: t.merchantId || '',
      ipAddress: t.ipAddress || '',
      port: t.port ? String(t.port) : '8080',
      apiEndpoint: t.apiEndpoint || '',
      authToken: '',
      secretKey: '',
    });
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetBranchId = form.branchId || branches[0]?.id || '';
    if (!targetBranchId) {
      showToast('Please select a branch', 'error');
      return;
    }
    if (!form.name.trim()) {
      showToast('Please enter a terminal name', 'error');
      return;
    }

    setIsSaving(true);
    try {
      const payload: any = {
        branchId: targetBranchId,
        counter: form.counter.trim() || null,
        name: form.name.trim(),
        provider: form.provider,
        connectionMode: form.connectionMode,
        model: form.model.trim() || null,
        serialNumber: form.serialNumber.trim() || null,
        terminalId: form.terminalId.trim() || null,
        merchantId: form.merchantId.trim() || null,
        ipAddress: form.ipAddress.trim() || null,
        port: form.port ? parseInt(form.port, 10) : null,
        apiEndpoint: form.apiEndpoint.trim() || null,
      };

      if (form.authToken.trim()) payload.authToken = form.authToken.trim();
      if (form.secretKey.trim()) payload.secretKey = form.secretKey.trim();

      if (editingId) {
        await api(`/api/terminals/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        showToast(`✅ Terminal '${form.name}' updated successfully!`);
      } else {
        await api('/api/terminals', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        showToast(`✅ Terminal '${form.name}' added successfully!`);
      }

      setIsModalOpen(false);
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to save terminal', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (t: CardTerminal) => {
    if (!window.confirm(`Are you sure you want to remove card terminal '${t.name}'?`)) {
      return;
    }
    try {
      await api(`/api/terminals/${t.id}`, { method: 'DELETE' });
      showToast(`Terminal '${t.name}' deleted.`);
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete terminal', 'error');
    }
  };

  const handleToggleActive = async (t: CardTerminal) => {
    try {
      await api(`/api/terminals/${t.id}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ active: !t.active }),
      });
      showToast(`Terminal '${t.name}' ${!t.active ? 'activated' : 'deactivated'}.`);
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to toggle terminal state', 'error');
    }
  };

  const handlePing = async (t: CardTerminal) => {
    setPingingId(t.id);
    setPingResult(null);
    try {
      const res = await api<{ online: boolean; message?: string }>(`/api/terminals/${t.id}/ping`, {
        method: 'POST',
      });
      setPingResult({
        id: t.id,
        online: res.online,
        message: res.message || (res.online ? 'Terminal reachable and ready.' : 'Terminal unreachable.'),
      });
      showToast(res.online ? '✅ Terminal connected & responsive!' : '⚠️ Terminal connection check failed', res.online ? 'success' : 'error');
      loadData();
    } catch (err: any) {
      setPingResult({ id: t.id, online: false, message: err.message || 'Ping failed' });
      showToast(err.message || 'Ping failed', 'error');
    } finally {
      setPingingId(null);
    }
  };

  const filteredTerminals = terminals.filter((t) => {
    if (branchFilter === 'ALL') return true;
    return t.branchId === branchFilter;
  });

  return (
    <div style={{ maxWidth: '980px' }}>
      {/* 1. General Card Payment in POS toggle */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1rem 1.25rem',
        background: '#faf9ff',
        border: '1.5px solid #ede9fe',
        borderRadius: '12px',
        marginBottom: '1.75rem',
      }}>
        <div>
          <div style={{ fontSize: '0.98rem', fontWeight: 800, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>💳 Card Payment Mode in POS Checkout</span>
            {payMethodsEnabled.includes('card') && (
              <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 8px', background: '#dcfce7', color: '#166534', borderRadius: '12px' }}>
                Active in POS
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '3px' }}>
            Enables cashiers to accept Debit & Credit cards using integrated EDC machines or standalone card terminals.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button
            type="button"
            onClick={() => {
              const updated = payMethodsEnabled.includes('card')
                ? payMethodsEnabled.filter((m) => m !== 'card')
                : [...payMethodsEnabled, 'card'];
              setPayMethodsEnabled(updated);
              onSavePaymentSettings();
            }}
            style={{
              padding: '6px 14px',
              fontSize: '0.82rem',
              fontWeight: 700,
              borderRadius: '8px',
              border: 'none',
              cursor: 'pointer',
              background: payMethodsEnabled.includes('card') ? '#ef4444' : '#6d4aff',
              color: '#ffffff',
            }}
          >
            {payMethodsEnabled.includes('card') ? 'Disable Card Option' : 'Enable Card Option'}
          </button>
        </div>
      </div>

      {/* 2. Branch Card Terminals Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '1.25rem' }}>
        <div>
          <h4 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)', margin: '0 0 4px 0' }}>
            Branch Card Machines & EDC Terminals
          </h4>
          <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', margin: 0 }}>
            Configure and monitor card swipe machines across all shops, branches, and checkout counters.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {branches.length > 1 && (
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              style={{
                padding: '7px 12px',
                fontSize: '0.84rem',
                fontWeight: 600,
                borderRadius: '8px',
                border: '1px solid var(--border)',
                background: '#ffffff',
                color: 'var(--text-main)',
              }}
            >
              <option value="ALL">🏢 All Branches ({terminals.length})</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({terminals.filter((t) => t.branchId === b.id).length})
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={() => openAddModal()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 16px',
              fontSize: '0.86rem',
              fontWeight: 700,
              background: 'linear-gradient(135deg, #6d4aff 0%, #5b3ee0 100%)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(109, 74, 255, 0.25)',
              cursor: 'pointer',
            }}
          >
            <span>+</span>
            <span>Add Card Terminal</span>
          </button>
        </div>
      </div>

      {/* 3. Terminals Grid */}
      {isLoading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading card terminals...
        </div>
      ) : filteredTerminals.length === 0 ? (
        <div style={{
          border: '2px dashed #e2e8f0',
          borderRadius: '16px',
          padding: '2.5rem 1.5rem',
          textAlign: 'center',
          background: '#ffffff',
          marginBottom: '2rem',
        }}>
          <div style={{ fontSize: '2.4rem', marginBottom: '0.75rem' }}>📠</div>
          <h5 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-main)', margin: '0 0 6px 0' }}>
            No Card Terminals Configured
          </h5>
          <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', maxWidth: '480px', margin: '0 auto 1.5rem auto', lineHeight: 1.5 }}>
            Every branch and counter can have its own card machine (Paytm, Pine Labs, HDFC, ICICI, Verifone, or Standalone swipe machine).
          </p>

          <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <button
              type="button"
              onClick={() => openAddModal('paytm')}
              style={{ padding: '7px 14px', fontSize: '0.82rem', fontWeight: 700, background: '#e6f0ff', color: '#002970', border: '1px solid #bfdbfe', borderRadius: '8px', cursor: 'pointer' }}
            >
              + Paytm POS
            </button>
            <button
              type="button"
              onClick={() => openAddModal('pinelabs')}
              style={{ padding: '7px 14px', fontSize: '0.82rem', fontWeight: 700, background: '#e7f7ed', color: '#0d6832', border: '1px solid #bbf7d0', borderRadius: '8px', cursor: 'pointer' }}
            >
              + Pine Labs
            </button>
            <button
              type="button"
              onClick={() => openAddModal('hdfc')}
              style={{ padding: '7px 14px', fontSize: '0.82rem', fontWeight: 700, background: '#e8f2fc', color: '#004c8f', border: '1px solid #bae6fd', borderRadius: '8px', cursor: 'pointer' }}
            >
              + HDFC Bank POS
            </button>
            <button
              type="button"
              onClick={() => openAddModal('standalone')}
              style={{ padding: '7px 14px', fontSize: '0.82rem', fontWeight: 700, background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', cursor: 'pointer' }}
            >
              + Standalone EDC
            </button>
            <button
              type="button"
              onClick={() => openAddModal('mock')}
              style={{ padding: '7px 14px', fontSize: '0.82rem', fontWeight: 700, background: '#f5f3ff', color: '#6d28d9', border: '1px solid #ddd6fe', borderRadius: '8px', cursor: 'pointer' }}
            >
              + Sandbox Demo EDC
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
          {filteredTerminals.map((t) => {
            const meta = PROVIDER_METADATA[t.provider] || PROVIDER_METADATA.standalone;
            const isPinging = pingingId === t.id;
            const currentPing = pingResult?.id === t.id ? pingResult : null;

            return (
              <div
                key={t.id}
                style={{
                  background: '#ffffff',
                  border: t.active ? '1.5px solid #e2e8f0' : '1.5px dashed #cbd5e1',
                  borderRadius: '14px',
                  padding: '1.25rem',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.03)',
                  opacity: t.active ? 1 : 0.7,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  transition: 'all 0.2s ease',
                }}
              >
                <div>
                  {/* Top Bar: Provider Badge, Status, and Active Toggle */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <span style={{
                      padding: '3px 9px',
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      borderRadius: '6px',
                      background: meta.bg,
                      color: meta.color,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}>
                      {t.provider.toUpperCase()}
                    </span>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        color: t.status === 'online' ? '#166534' : t.status === 'busy' ? '#854d0e' : '#991b1b',
                      }}>
                        <span style={{
                          width: '7px',
                          height: '7px',
                          borderRadius: '50%',
                          background: t.status === 'online' ? '#22c55e' : t.status === 'busy' ? '#eab308' : '#ef4444',
                        }} />
                        {t.status.toUpperCase()}
                      </span>

                      <button
                        type="button"
                        onClick={() => handleToggleActive(t)}
                        title={t.active ? 'Deactivate Terminal' : 'Activate Terminal'}
                        style={{
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          color: t.active ? '#16a34a' : '#64748b',
                        }}
                      >
                        {t.active ? 'Active' : 'Inactive'}
                      </button>
                    </div>
                  </div>

                  {/* Terminal Name & Branch / Counter */}
                  <h5 style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--text-main)', margin: '0 0 4px 0' }}>
                    {t.name}
                  </h5>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: '0.85rem' }}>
                    <span>📍 {t.branchName || 'Main Branch'}</span>
                    <span>•</span>
                    <strong style={{ color: 'var(--primary)' }}>
                      {t.counter ? `Counter: ${t.counter}` : 'All Counters (Default)'}
                    </strong>
                  </div>

                  {/* Mode & Config Pill */}
                  <div style={{
                    background: '#f8fafc',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    fontSize: '0.76rem',
                    color: '#334155',
                    marginBottom: '0.85rem',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: '4px 10px',
                  }}>
                    <div>
                      <span style={{ color: '#64748b' }}>Mode: </span>
                      <strong>{t.connectionMode === 'integrated' ? '⚡ Integrated' : '✍️ Standalone'}</strong>
                    </div>
                    {t.terminalId && (
                      <div>
                        <span style={{ color: '#64748b' }}>TID: </span>
                        <span style={{ fontFamily: 'monospace' }}>{t.terminalId}</span>
                      </div>
                    )}
                    {t.merchantId && (
                      <div>
                        <span style={{ color: '#64748b' }}>MID: </span>
                        <span style={{ fontFamily: 'monospace' }}>{t.merchantId}</span>
                      </div>
                    )}
                    {t.ipAddress && (
                      <div>
                        <span style={{ color: '#64748b' }}>IP: </span>
                        <span style={{ fontFamily: 'monospace' }}>{t.ipAddress}:{t.port || 8080}</span>
                      </div>
                    )}
                  </div>

                  {/* Inline Ping Result Banner */}
                  {currentPing && (
                    <div style={{
                      padding: '6px 10px',
                      borderRadius: '6px',
                      fontSize: '0.74rem',
                      fontWeight: 600,
                      marginBottom: '0.75rem',
                      background: currentPing.online ? '#f0fdf4' : '#fef2f2',
                      color: currentPing.online ? '#15803d' : '#b91c1c',
                      border: `1px solid ${currentPing.online ? '#bbf7d0' : '#fecaca'}`,
                    }}>
                      {currentPing.online ? '✅ ' : '⚠️ '}{currentPing.message}
                    </div>
                  )}
                </div>

                {/* Card Actions Footer */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingTop: '0.75rem',
                  borderTop: '1px solid #f1f5f9',
                  marginTop: '0.5rem',
                }}>
                  <button
                    type="button"
                    disabled={isPinging}
                    onClick={() => handlePing(t)}
                    style={{
                      padding: '5px 10px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      background: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      color: '#334155',
                      cursor: 'pointer',
                    }}
                  >
                    {isPinging ? 'Pinging...' : '📡 Test Ping'}
                  </button>

                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={() => openEditModal(t)}
                      style={{
                        padding: '5px 10px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        background: '#eef2ff',
                        color: 'var(--primary)',
                        border: '1px solid #e0e7ff',
                        borderRadius: '6px',
                        cursor: 'pointer',
                      }}
                    >
                      ✏️ Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(t)}
                      style={{
                        padding: '5px 10px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        background: '#fff1f2',
                        color: '#e11d48',
                        border: '1px solid #ffe4e6',
                        borderRadius: '6px',
                        cursor: 'pointer',
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 4. Add / Edit Terminal Modal */}
      {isModalOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(15, 23, 42, 0.65)',
          backdropFilter: 'blur(4px)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
        }}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            width: '100%',
            maxWidth: '560px',
            maxHeight: '90vh',
            overflowY: 'auto',
            boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
            padding: '1.5rem',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '0.75rem' }}>
              <div>
                <h4 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-main)' }}>
                  {editingId ? 'Edit Card Terminal' : 'Add New Card Terminal'}
                </h4>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Configure provider API parameters and branch location.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#64748b' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSave}>
              {/* Branch & Counter Selection */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
                    Branch *
                  </label>
                  <select
                    value={form.branchId || branches[0]?.id || ''}
                    onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                    required
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.84rem' }}
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
                    Counter (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. COUNTER-1 (or blank for all)"
                    value={form.counter}
                    onChange={(e) => setForm({ ...form, counter: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.84rem' }}
                  />
                </div>
              </div>

              {/* Terminal Name */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
                  Terminal Display Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Counter 1 - Pine Labs EDC"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.84rem' }}
                />
              </div>

              {/* Provider Selection */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
                  Payment Provider / Device Type *
                </label>
                <select
                  value={form.provider}
                  onChange={(e) => {
                    const prov = e.target.value as TerminalProvider;
                    setForm({
                      ...form,
                      provider: prov,
                      connectionMode: prov === 'standalone' ? 'standalone' : form.connectionMode,
                    });
                  }}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.84rem' }}
                >
                  {TERMINAL_PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {PROVIDER_METADATA[p].label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Connection Mode (Integrated vs Standalone) */}
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '6px' }}>
                  Connection Mode *
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: form.connectionMode === 'integrated' ? '2px solid var(--primary)' : '1px solid var(--border)',
                    background: form.connectionMode === 'integrated' ? '#faf9ff' : '#ffffff',
                    cursor: 'pointer',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                  }}>
                    <input
                      type="radio"
                      name="connectionMode"
                      value="integrated"
                      checked={form.connectionMode === 'integrated'}
                      onChange={() => setForm({ ...form, connectionMode: 'integrated' })}
                    />
                    <span>⚡ Integrated (Cloud / LAN API)</span>
                  </label>

                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: form.connectionMode === 'standalone' ? '2px solid var(--primary)' : '1px solid var(--border)',
                    background: form.connectionMode === 'standalone' ? '#faf9ff' : '#ffffff',
                    cursor: 'pointer',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                  }}>
                    <input
                      type="radio"
                      name="connectionMode"
                      value="standalone"
                      checked={form.connectionMode === 'standalone'}
                      onChange={() => setForm({ ...form, connectionMode: 'standalone' })}
                    />
                    <span>✍️ Standalone (Cashier RRN)</span>
                  </label>
                </div>
              </div>

              {/* Identifiers: TID & MID */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
                    Terminal ID (TID)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 12345678"
                    value={form.terminalId}
                    onChange={(e) => setForm({ ...form, terminalId: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.84rem' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
                    Merchant ID (MID)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 9876543210"
                    value={form.merchantId}
                    onChange={(e) => setForm({ ...form, merchantId: e.target.value })}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.84rem' }}
                  />
                </div>
              </div>

              {/* Integrated-only parameters */}
              {form.connectionMode === 'integrated' && (
                <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '10px', marginBottom: '1rem', border: '1px solid #e2e8f0' }}>
                  <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#334155', marginBottom: '8px' }}>
                    Network & API Credentials (Encrypted with AES-256)
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '8px', marginBottom: '8px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.72rem', color: '#64748b', marginBottom: '2px' }}>
                        Local LAN IP (For ECR / Wi-Fi)
                      </label>
                      <input
                        type="text"
                        placeholder="192.168.1.50"
                        value={form.ipAddress}
                        onChange={(e) => setForm({ ...form, ipAddress: e.target.value })}
                        style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.72rem', color: '#64748b', marginBottom: '2px' }}>
                        Port
                      </label>
                      <input
                        type="number"
                        placeholder="8080"
                        value={form.port}
                        onChange={(e) => setForm({ ...form, port: e.target.value })}
                        style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}
                      />
                    </div>
                  </div>

                  <div style={{ marginBottom: '8px' }}>
                    <label style={{ display: 'block', fontSize: '0.72rem', color: '#64748b', marginBottom: '2px' }}>
                      Auth Token / API Key {editingId && '(Leave blank to keep current)'}
                    </label>
                    <input
                      type="password"
                      placeholder="••••••••••••••••"
                      value={form.authToken}
                      onChange={(e) => setForm({ ...form, authToken: e.target.value })}
                      style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.72rem', color: '#64748b', marginBottom: '2px' }}>
                      Secret Key / Master Key {editingId && '(Leave blank to keep current)'}
                    </label>
                    <input
                      type="password"
                      placeholder="••••••••••••••••"
                      value={form.secretKey}
                      onChange={(e) => setForm({ ...form, secretKey: e.target.value })}
                      style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}
                    />
                  </div>
                </div>
              )}

              {/* Submit Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '1.25rem' }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  style={{ padding: '8px 16px', fontSize: '0.85rem', fontWeight: 600, background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '8px', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  style={{
                    padding: '8px 20px',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    background: 'linear-gradient(135deg, #6d4aff 0%, #5b3ee0 100%)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(109, 74, 255, 0.25)',
                  }}
                >
                  {isSaving ? 'Saving...' : editingId ? 'Update Terminal' : 'Save Terminal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

