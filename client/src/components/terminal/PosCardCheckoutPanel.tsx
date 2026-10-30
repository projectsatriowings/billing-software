import React, { useState, useEffect } from 'react';
import { api } from '../../api';
import type {
  CardTerminal,
  TerminalTransaction,
  CardNetwork,
} from '../../../../shared/types';
import { CARD_NETWORKS } from '../../../../shared/types';

interface Props {
  branchId?: string;
  counter?: string;
  payableMinor: number;
  cashierName?: string;
  onPaymentSuccess: (details: {
    reference: string;
    terminalId?: string;
    transactionId?: string;
    cardNetwork?: string;
    cardLast4?: string;
    rrn?: string;
    verifiedBy: 'api' | 'cashier_manual';
  }) => void;
  showToast: (msg: string, type?: 'info' | 'error' | 'success') => void;
}

export const PosCardCheckoutPanel: React.FC<Props> = ({
  branchId,
  counter,
  payableMinor,
  onPaymentSuccess,
  showToast,
}) => {
  const [terminal, setTerminal] = useState<CardTerminal | null>(null);
  const [isLoadingTerminal, setIsLoadingTerminal] = useState(false);
  const [activeTx, setActiveTx] = useState<TerminalTransaction | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [instructions, setInstructions] = useState<string | null>(null);

  // Standalone fields
  const [standaloneRrn, setStandaloneRrn] = useState('');
  const [standaloneCardNetwork, setStandaloneCardNetwork] = useState<CardNetwork>('VISA');
  const [standaloneLast4, setStandaloneLast4] = useState('');
  const [standaloneAuthCode, setStandaloneAuthCode] = useState('');
  const [isConfirmingStandalone, setIsConfirmingStandalone] = useState(false);

  // Fetch active terminal for counter
  const loadActiveTerminal = async () => {
    if (!branchId) return;
    setIsLoadingTerminal(true);
    try {
      const q = new URLSearchParams({ branchId });
      if (counter) q.set('counter', counter);
      const res = await api<{ configured: boolean; terminal: CardTerminal | null }>(
        `/api/terminals/active?${q.toString()}`
      );
      setTerminal(res.terminal);
    } catch {
      // Non-fatal fallback
    } finally {
      setIsLoadingTerminal(false);
    }
  };

  useEffect(() => {
    loadActiveTerminal();
    setActiveTx(null);
    setInstructions(null);
  }, [branchId, counter]);

  // Auto-polling for in-flight integrated transaction
  useEffect(() => {
    if (!activeTx || activeTx.status !== 'processing') return;

    const interval = setInterval(async () => {
      try {
        const res = await api<{ transaction: TerminalTransaction }>(
          `/api/terminals/payments/${activeTx.id}/status`
        );
        const tx = res.transaction;
        setActiveTx(tx);

        if (tx.status === 'success') {
          showToast('✅ Card payment authorized successfully by terminal!', 'success');
          onPaymentSuccess({
            reference: `EDC:${tx.provider.toUpperCase()} | Net:${tx.cardNetwork || 'CARD'} | L4:${tx.cardLast4 || 'XXXX'} | RRN:${tx.providerRefNo || tx.providerTxId} | Auth:${tx.authCode || 'APPR'}`,
            terminalId: tx.terminalId,
            transactionId: tx.id,
            cardNetwork: tx.cardNetwork || undefined,
            cardLast4: tx.cardLast4 || undefined,
            rrn: tx.providerRefNo || undefined,
            verifiedBy: 'api',
          });
        } else if (tx.status === 'failed') {
          showToast(`❌ Card transaction declined: ${tx.errorReason || 'Declined'}`, 'error');
        }
      } catch {
        // Safe: non-destructive poll errors are ignored
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [activeTx?.id, activeTx?.status]);

  // Initiate integrated payment
  const handleInitiatePayment = async () => {
    if (payableMinor <= 0) {
      showToast('Payable amount must be greater than ₹0', 'error');
      return;
    }
    if (!branchId) {
      showToast('Branch must be assigned to start terminal payment', 'error');
      return;
    }

    setIsProcessing(true);
    try {
      const res = await api<{
        transaction: TerminalTransaction;
        instructions?: string;
      }>('/api/terminals/payments/initiate', {
        method: 'POST',
        body: JSON.stringify({
          branchId,
          counter: counter || undefined,
          terminalId: terminal?.id || undefined,
          amountMinor: payableMinor,
          idempotencyKey: `pos_card_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        }),
      });

      setActiveTx(res.transaction);
      setInstructions(res.instructions || 'Waiting for customer card swipe/tap & PIN on terminal...');

      if (res.transaction.status === 'success') {
        showToast('✅ Card payment approved immediately!', 'success');
        onPaymentSuccess({
          reference: `EDC:${res.transaction.provider.toUpperCase()} | Net:${res.transaction.cardNetwork || 'CARD'} | L4:${res.transaction.cardLast4 || 'XXXX'} | RRN:${res.transaction.providerRefNo || res.transaction.providerTxId}`,
          terminalId: res.transaction.terminalId,
          transactionId: res.transaction.id,
          cardNetwork: res.transaction.cardNetwork || undefined,
          cardLast4: res.transaction.cardLast4 || undefined,
          rrn: res.transaction.providerRefNo || undefined,
          verifiedBy: 'api',
        });
      } else if (res.transaction.status === 'failed') {
        showToast(`❌ Terminal Error: ${res.transaction.errorReason || 'Initiation failed'}`, 'error');
      } else {
        showToast(`₹${(payableMinor / 100).toFixed(2)} sent to card machine!`);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to initiate terminal payment', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Check Status manually
  const handleCheckStatus = async () => {
    if (!activeTx) return;
    setIsProcessing(true);
    try {
      const res = await api<{ transaction: TerminalTransaction }>(
        `/api/terminals/payments/${activeTx.id}/status`
      );
      setActiveTx(res.transaction);
      if (res.transaction.status === 'success') {
        showToast('✅ Payment verified & approved!', 'success');
        onPaymentSuccess({
          reference: `EDC:${res.transaction.provider.toUpperCase()} | Net:${res.transaction.cardNetwork || 'CARD'} | L4:${res.transaction.cardLast4 || 'XXXX'} | RRN:${res.transaction.providerRefNo || res.transaction.providerTxId}`,
          terminalId: res.transaction.terminalId,
          transactionId: res.transaction.id,
          cardNetwork: res.transaction.cardNetwork || undefined,
          cardLast4: res.transaction.cardLast4 || undefined,
          rrn: res.transaction.providerRefNo || undefined,
          verifiedBy: 'api',
        });
      } else if (res.transaction.status === 'failed') {
        showToast(`❌ Declined: ${res.transaction.errorReason || 'Payment failed'}`, 'error');
      } else {
        showToast('Transaction is still processing on terminal. Waiting for customer PIN...');
      }
    } catch (err: any) {
      showToast(err.message || 'Status check failed', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Cancel transaction
  const handleCancelPayment = async () => {
    if (!activeTx) return;
    try {
      await api(`/api/terminals/payments/${activeTx.id}/cancel`, { method: 'POST' });
      showToast('Transaction cancelled on card terminal.');
      setActiveTx(null);
      setInstructions(null);
    } catch (err: any) {
      showToast(err.message || 'Failed to cancel transaction', 'error');
    }
  };

  // Cashier manual standalone confirmation
  const handleConfirmStandalone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!standaloneRrn.trim()) {
      showToast('Please enter the 12-digit RRN / Reference number from the charge slip', 'error');
      return;
    }

    setIsConfirmingStandalone(true);
    try {
      // 1. Create transaction if not created yet
      let txId = activeTx?.id;
      if (!txId) {
        const init = await api<{ transaction: TerminalTransaction }>('/api/terminals/payments/initiate', {
          method: 'POST',
          body: JSON.stringify({
            branchId,
            counter: counter || undefined,
            terminalId: terminal?.id || undefined,
            amountMinor: payableMinor,
          }),
        });
        txId = init.transaction.id;
      }

      // 2. Confirm with cashier manual RRN
      const confirmed = await api<{ transaction: TerminalTransaction }>(
        `/api/terminals/payments/${txId}/confirm-standalone`,
        {
          method: 'POST',
          body: JSON.stringify({
            providerRefNo: standaloneRrn.trim(),
            cardNetwork: standaloneCardNetwork,
            cardLast4: standaloneLast4.trim() || undefined,
            authCode: standaloneAuthCode.trim() || undefined,
          }),
        }
      );

      setActiveTx(confirmed.transaction);
      showToast('✅ Standalone card payment recorded with cashier audit trail!', 'success');

      onPaymentSuccess({
        reference: `STD:CARD | Net:${standaloneCardNetwork} | L4:${standaloneLast4.trim() || 'XXXX'} | RRN:${standaloneRrn.trim()}${standaloneAuthCode.trim() ? ' | Auth:' + standaloneAuthCode.trim() : ''}`,
        terminalId: confirmed.transaction.terminalId,
        transactionId: confirmed.transaction.id,
        cardNetwork: standaloneCardNetwork,
        cardLast4: standaloneLast4.trim() || undefined,
        rrn: standaloneRrn.trim(),
        verifiedBy: 'cashier_manual',
      });
    } catch (err: any) {
      showToast(err.message || 'Failed to confirm standalone card payment', 'error');
    } finally {
      setIsConfirmingStandalone(false);
    }
  };

  const isIntegrated = terminal && terminal.connectionMode === 'integrated';

  return (
    <div style={{
      background: '#ffffff',
      border: '1.5px solid #e0e7ff',
      borderRadius: '14px',
      padding: '1.25rem',
      marginTop: '0.85rem',
      boxShadow: '0 4px 16px rgba(109, 74, 255, 0.06)',
    }}>
      {/* Header with Terminal Identity & Connection Mode */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '1rem',
        paddingBottom: '0.75rem',
        borderBottom: '1px solid #f1f5f9',
        flexWrap: 'wrap',
        gap: '8px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '38px',
            height: '38px',
            borderRadius: '10px',
            background: isIntegrated ? '#eff6ff' : '#f8fafc',
            color: isIntegrated ? '#2563eb' : '#475569',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.25rem',
          }}>
            {isIntegrated ? '⚡' : '📠'}
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.96rem', fontWeight: 800, color: 'var(--text-main)' }}>
                {terminal ? terminal.name : 'Card Terminal (Swipe / Tap)'}
              </span>
              {terminal && (
                <span style={{
                  padding: '2px 8px',
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  borderRadius: '10px',
                  background: isIntegrated ? '#dbeafe' : '#f1f5f9',
                  color: isIntegrated ? '#1e40af' : '#475569',
                }}>
                  {isIntegrated ? 'Integrated EDC' : 'Standalone Machine'}
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              {terminal
                ? `${terminal.provider.toUpperCase()} • ${terminal.counter ? `Counter: ${terminal.counter}` : 'All Counters'}`
                : 'No terminal configured for this counter. Standalone manual entry active.'}
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', fontWeight: 600 }}>Amount Due</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--primary)', fontFamily: 'monospace' }}>
            ₹{(payableMinor / 100).toFixed(2)}
          </div>
        </div>
      </div>

      {/* INTEGRATED TERMINAL FLOW */}
      {isIntegrated ? (
        <div>
          {/* State 1: Ready to send to machine */}
          {!activeTx && (
            <div style={{
              background: '#faf9ff',
              border: '1px solid #e0e7ff',
              borderRadius: '10px',
              padding: '1.25rem',
              textAlign: 'center',
            }}>
              <p style={{ fontSize: '0.86rem', color: '#475569', margin: '0 0 1rem 0' }}>
                Click below to send the exact payable amount (<strong>₹{(payableMinor / 100).toFixed(2)}</strong>) to <strong>{terminal.name}</strong>.
              </p>

              <button
                type="button"
                disabled={isProcessing}
                onClick={handleInitiatePayment}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 24px',
                  fontSize: '0.92rem',
                  fontWeight: 800,
                  background: 'linear-gradient(135deg, #6d4aff 0%, #5b3ee0 100%)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  boxShadow: '0 4px 14px rgba(109, 74, 255, 0.3)',
                  cursor: 'pointer',
                }}
              >
                <span>📠</span>
                <span>{isProcessing ? 'Connecting to EDC...' : `Send ₹${(payableMinor / 100).toFixed(2)} to Card Machine`}</span>
              </button>
            </div>
          )}

          {/* State 2: Processing on Machine */}
          {activeTx && activeTx.status === 'processing' && (
            <div style={{
              background: '#eff6ff',
              border: '1.5px solid #bfdbfe',
              borderRadius: '12px',
              padding: '1.25rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '0.85rem' }}>
                <div style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  border: '3px solid #3b82f6',
                  borderTopColor: 'transparent',
                  animation: 'spin 1s linear infinite',
                }} />
                <div>
                  <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#1e40af' }}>
                    Amount Displayed on Card Machine
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#3b82f6', marginTop: '2px' }}>
                    {instructions || 'Customer is tapping card or entering PIN...'}
                  </div>
                </div>
              </div>

              <div style={{
                background: '#ffffff',
                borderRadius: '8px',
                padding: '8px 12px',
                fontSize: '0.78rem',
                color: '#475569',
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '1rem',
              }}>
                <span>Ref: <strong style={{ fontFamily: 'monospace' }}>{activeTx.providerTxId || activeTx.id}</strong></span>
                <span>Provider: <strong>{activeTx.provider.toUpperCase()}</strong></span>
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  disabled={isProcessing}
                  onClick={handleCheckStatus}
                  style={{
                    flex: 1,
                    padding: '8px 14px',
                    fontSize: '0.84rem',
                    fontWeight: 700,
                    background: '#2563eb',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                  }}
                >
                  {isProcessing ? 'Checking...' : '🔄 Check Machine Status'}
                </button>
                <button
                  type="button"
                  onClick={handleCancelPayment}
                  style={{
                    padding: '8px 14px',
                    fontSize: '0.84rem',
                    fontWeight: 700,
                    background: '#fee2e2',
                    color: '#b91c1c',
                    border: '1px solid #fca5a5',
                    borderRadius: '8px',
                    cursor: 'pointer',
                  }}
                >
                  ✕ Cancel
                </button>
              </div>
            </div>
          )}

          {/* State 3: Approved & Verified */}
          {activeTx && activeTx.status === 'success' && (
            <div style={{
              background: '#f0fdf4',
              border: '1.5px solid #86efac',
              borderRadius: '12px',
              padding: '1.25rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.65rem' }}>
                <span style={{ fontSize: '1.25rem' }}>✅</span>
                <span style={{ fontSize: '0.98rem', fontWeight: 800, color: '#166534' }}>
                  Payment Verified by Bank
                </span>
                <span style={{
                  padding: '2px 8px',
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  borderRadius: '10px',
                  background: '#dcfce7',
                  color: '#15803d',
                  marginLeft: 'auto',
                }}>
                  API AUTHORIZED
                </span>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: '8px',
                background: '#ffffff',
                padding: '10px',
                borderRadius: '8px',
                fontSize: '0.78rem',
                border: '1px solid #dcfce7',
                marginBottom: '0.85rem',
              }}>
                <div>
                  <span style={{ color: '#64748b', display: 'block', fontSize: '0.72rem' }}>Network</span>
                  <strong style={{ color: '#15803d' }}>{activeTx.cardNetwork || 'CARD'}</strong>
                </div>
                <div>
                  <span style={{ color: '#64748b', display: 'block', fontSize: '0.72rem' }}>Card No</span>
                  <strong style={{ fontFamily: 'monospace' }}>•••• {activeTx.cardLast4 || 'XXXX'}</strong>
                </div>
                <div>
                  <span style={{ color: '#64748b', display: 'block', fontSize: '0.72rem' }}>Bank RRN</span>
                  <strong style={{ fontFamily: 'monospace' }}>{activeTx.providerRefNo || 'N/A'}</strong>
                </div>
                {activeTx.authCode && (
                  <div>
                    <span style={{ color: '#64748b', display: 'block', fontSize: '0.72rem' }}>Approval Code</span>
                    <strong style={{ fontFamily: 'monospace' }}>{activeTx.authCode}</strong>
                  </div>
                )}
              </div>

              <div style={{ fontSize: '0.76rem', color: '#15803d', fontWeight: 600 }}>
                Transaction successfully verified via {activeTx.provider.toUpperCase()} EDC. Ready to complete bill!
              </div>
            </div>
          )}

          {/* State 4: Failed / Declined */}
          {activeTx && activeTx.status === 'failed' && (
            <div style={{
              background: '#fef2f2',
              border: '1.5px solid #fca5a5',
              borderRadius: '12px',
              padding: '1.25rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.65rem' }}>
                <span style={{ fontSize: '1.2rem' }}>❌</span>
                <span style={{ fontSize: '0.94rem', fontWeight: 800, color: '#991b1b' }}>
                  Transaction Declined by Bank
                </span>
              </div>
              <p style={{ fontSize: '0.82rem', color: '#b91c1c', margin: '0 0 1rem 0' }}>
                {activeTx.errorReason || 'Card declined or session timed out on machine.'}
              </p>
              <button
                type="button"
                onClick={handleInitiatePayment}
                style={{
                  padding: '8px 16px',
                  fontSize: '0.84rem',
                  fontWeight: 700,
                  background: '#dc2626',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                }}
              >
                Retry on Card Machine
              </button>
            </div>
          )}
        </div>
      ) : (
        /* STANDALONE / MANUAL CARD FLOW */
        <div>
          {activeTx?.status === 'success' ? (
            <div style={{
              background: '#f0fdf4',
              border: '1.5px solid #86efac',
              borderRadius: '12px',
              padding: '1.25rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.65rem' }}>
                <span style={{ fontSize: '1.25rem' }}>✅</span>
                <span style={{ fontSize: '0.98rem', fontWeight: 800, color: '#166534' }}>
                  Standalone Card Payment Confirmed
                </span>
                <span style={{
                  padding: '2px 8px',
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  borderRadius: '10px',
                  background: '#fef3c7',
                  color: '#92400e',
                  marginLeft: 'auto',
                }}>
                  CASHIER VERIFIED
                </span>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: '8px',
                background: '#ffffff',
                padding: '10px',
                borderRadius: '8px',
                fontSize: '0.78rem',
                border: '1px solid #dcfce7',
                marginBottom: '0.85rem',
              }}>
                <div>
                  <span style={{ color: '#64748b', display: 'block', fontSize: '0.72rem' }}>Network</span>
                  <strong style={{ color: '#15803d' }}>{activeTx.cardNetwork || standaloneCardNetwork}</strong>
                </div>
                <div>
                  <span style={{ color: '#64748b', display: 'block', fontSize: '0.72rem' }}>Card Last 4</span>
                  <strong style={{ fontFamily: 'monospace' }}>•••• {activeTx.cardLast4 || standaloneLast4 || 'XXXX'}</strong>
                </div>
                <div>
                  <span style={{ color: '#64748b', display: 'block', fontSize: '0.72rem' }}>Charge Slip RRN</span>
                  <strong style={{ fontFamily: 'monospace' }}>{activeTx.providerRefNo || standaloneRrn}</strong>
                </div>
              </div>

              <div style={{ fontSize: '0.76rem', color: '#15803d', fontWeight: 600 }}>
                Audited to cashier. Ready to complete bill.
              </div>
            </div>
          ) : (
            <form onSubmit={handleConfirmStandalone}>
              <div style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '8px 12px',
                fontSize: '0.78rem',
                color: '#334155',
                marginBottom: '1rem',
                lineHeight: 1.4,
              }}>
                <strong>Instructions:</strong>
                <ol style={{ margin: '4px 0 0 0', paddingLeft: '1.25rem' }}>
                  <li>Swipe, insert, or tap card for <strong>₹{(payableMinor / 100).toFixed(2)}</strong> on the standalone card machine.</li>
                  <li>Once the charge slip prints, enter the <strong>12-digit RRN / Ref number</strong> below to verify.</li>
                </ol>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '10px', marginBottom: '0.85rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
                    Machine RRN / Ref Number *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 990012345678"
                    value={standaloneRrn}
                    onChange={(e) => setStandaloneRrn(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: '1.5px solid var(--border)',
                      fontSize: '0.86rem',
                      fontFamily: 'monospace',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
                    Card Network
                  </label>
                  <select
                    value={standaloneCardNetwork}
                    onChange={(e) => setStandaloneCardNetwork(e.target.value as any)}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      fontSize: '0.86rem',
                    }}
                  >
                    {CARD_NETWORKS.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Card Last 4 Digits (Optional)
                  </label>
                  <input
                    type="text"
                    maxLength={4}
                    placeholder="e.g. 4242"
                    value={standaloneLast4}
                    onChange={(e) => setStandaloneLast4(e.target.value.replace(/\D/g, ''))}
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      fontSize: '0.82rem',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.74rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    Approval / Auth Code (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 123456"
                    value={standaloneAuthCode}
                    onChange={(e) => setStandaloneAuthCode(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '7px 10px',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      fontSize: '0.82rem',
                    }}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isConfirmingStandalone}
                style={{
                  width: '100%',
                  padding: '9px 16px',
                  fontSize: '0.88rem',
                  fontWeight: 800,
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)',
                }}
              >
                {isConfirmingStandalone ? 'Recording...' : 'Confirm Card Payment & Verify'}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
};
