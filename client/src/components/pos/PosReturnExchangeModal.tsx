import React, { useState, useEffect } from 'react';
import { searchInvoicesForReturn, fetchInvoiceReturnInfo, createReturnCreditNote } from '../../api.ts';
import { RETURN_REASONS, RETURN_CONDITIONS, REFUND_METHODS } from '../../../../shared/returns.ts';

export interface ReturnSelectedLine {
  origInvoiceId: string;
  origInvoiceNumber: string;
  origLineId: string;
  itemId?: string;
  name: string;
  unit?: string;
  billedQtyMilli: number;
  returnableQtyMilli: number;
  returnQtyMilli: number;
  priceMinor: number;
  taxRateBp: number;
  inclusive: boolean;
  condition: 'resellable' | 'damaged' | 'defective';
  reason: string;
  remarks?: string;
  estimatedCreditMinor: number;
}

interface PosReturnExchangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectForExchange: (returnLines: ReturnSelectedLine[], invoiceNumber: string) => void;
  onReturnCompleted: (cnId: string, cnNumber: string) => void;
}

export const PosReturnExchangeModal: React.FC<PosReturnExchangeModalProps> = ({
  isOpen,
  onClose,
  onSelectForExchange,
  onReturnCompleted,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<any | null>(null);
  const [loadingInvoice, setLoadingInvoice] = useState(false);
  const [returnInfo, setReturnInfo] = useState<any | null>(null);

  // Per-line return selection state
  // lineId -> { returnQty: number, condition: string, reason: string, remarks: string, selected: boolean }
  const [lineStates, setLineStates] = useState<Record<string, {
    selected: boolean;
    returnQtyUnits: number;
    condition: 'resellable' | 'damaged' | 'defective';
    reason: string;
    remarks: string;
  }>>({});

  // Direct return refund state
  const [actionTab, setActionTab] = useState<'exchange' | 'refund'>('exchange');
  const [refundMethod, setRefundMethod] = useState<'cash' | 'upi' | 'bank' | 'store_credit'>('cash');
  const [refundRef, setRefundRef] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setErrorMsg('');
    try {
      const res = await searchInvoicesForReturn(q);
      setSearchResults(res.invoices || []);
      if (!res.invoices || res.invoices.length === 0) {
        setErrorMsg(`No posted sales bills found matching "${q}".`);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to search invoices.');
    } finally {
      setSearching(false);
    }
  };

  const handleSelectInvoice = async (inv: any) => {
    setSelectedInvoice(inv);
    setLoadingInvoice(true);
    setErrorMsg('');
    try {
      const res = await fetchInvoiceReturnInfo(inv.id);
      setReturnInfo(res);
      // Initialize line states
      const initStates: Record<string, any> = {};
      for (const l of res.lines || []) {
        initStates[l.id] = {
          selected: false,
          returnQtyUnits: l.returnableQtyMilli > 0 ? l.returnableQtyMilli / 1000 : 0,
          condition: 'resellable',
          reason: 'Customer changed mind',
          remarks: '',
        };
      }
      setLineStates(initStates);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to load invoice items.');
    } finally {
      setLoadingInvoice(false);
    }
  };

  const toggleLineSelect = (lineId: string, maxQtyUnits: number) => {
    setLineStates((prev) => {
      const cur = prev[lineId] || {
        selected: false,
        returnQtyUnits: maxQtyUnits,
        condition: 'resellable',
        reason: 'Customer changed mind',
        remarks: '',
      };
      return {
        ...prev,
        [lineId]: {
          ...cur,
          selected: !cur.selected,
          returnQtyUnits: cur.returnQtyUnits > 0 ? cur.returnQtyUnits : maxQtyUnits,
        },
      };
    });
  };

  const updateLine = (lineId: string, updates: Partial<{
    returnQtyUnits: number;
    condition: 'resellable' | 'damaged' | 'defective';
    reason: string;
    remarks: string;
    selected: boolean;
  }>) => {
    setLineStates((prev) => ({
      ...prev,
      [lineId]: { ...prev[lineId], ...updates },
    }));
  };

  // Compute selected items & estimated credit
  const selectedLinesList: ReturnSelectedLine[] = [];
  let totalEstimatedCreditMinor = 0;

  if (returnInfo && returnInfo.lines) {
    for (const l of returnInfo.lines) {
      const st = lineStates[l.id];
      if (st && st.selected && st.returnQtyUnits > 0) {
        const retQtyMilli = Math.round(st.returnQtyUnits * 1000);
        const billedMilli = Number(l.billedQtyMilli || 0);
        const origTotal = Number(l.origTotalMinor || 0);
        const estCredit = billedMilli > 0 ? Math.round((origTotal * retQtyMilli) / billedMilli) : 0;
        totalEstimatedCreditMinor += estCredit;

        selectedLinesList.push({
          origInvoiceId: selectedInvoice.id,
          origInvoiceNumber: selectedInvoice.number,
          origLineId: l.id,
          itemId: l.itemId,
          name: l.name,
          unit: l.unit,
          billedQtyMilli: billedMilli,
          returnableQtyMilli: Number(l.returnableQtyMilli || 0),
          returnQtyMilli: retQtyMilli,
          priceMinor: Number(l.priceMinor || 0),
          taxRateBp: Number(l.taxRateBp || 0),
          inclusive: Boolean(l.inclusive),
          condition: st.condition,
          reason: st.reason,
          remarks: st.remarks,
          estimatedCreditMinor: estCredit,
        });
      }
    }
  }

  const handleConfirmDirectReturn = async () => {
    if (selectedLinesList.length === 0) {
      setErrorMsg('Please select at least one item to return.');
      return;
    }
    setSubmitting(true);
    setErrorMsg('');
    try {
      const payloadLines = selectedLinesList.map((sl) => ({
        origLineId: sl.origLineId,
        returnQtyMilli: sl.returnQtyMilli,
        condition: sl.condition,
        restock: sl.condition === 'resellable',
        reason: sl.reason,
        remarks: sl.remarks,
      }));

      const res = await createReturnCreditNote(selectedInvoice.id, {
        lines: payloadLines,
        settlementType: refundMethod === 'store_credit' ? 'advance' : 'refund',
        refundMode: refundMethod === 'store_credit' ? undefined : refundMethod,
        refundReference: refundRef || undefined,
        note: `POS Return from ${selectedInvoice.number}`,
      });

      onReturnCompleted(res.creditNoteId, res.creditNoteNumber || res.number);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to process return.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmExchange = () => {
    if (selectedLinesList.length === 0) {
      setErrorMsg('Please select at least one item to exchange.');
      return;
    }
    onSelectForExchange(selectedLinesList, selectedInvoice.number);
    onClose();
  };

  const formatRupees = (paise: number) => {
    const rupees = (paise || 0) / 100;
    return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="modal-backdrop" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div
        className="modal-content bento-modal"
        style={{
          width: '95%',
          maxWidth: '920px',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          background: '#ffffff',
          borderRadius: '16px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.15)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.2rem 1.5rem',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.4rem' }}>🔄</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800 }}>POS Return & Exchange Terminal</h3>
              <p style={{ margin: '2px 0 0 0', fontSize: '0.78rem', color: '#94a3b8' }}>
                Search original bill, inspect returnable items, select reason & condition, and settle via Exchange or Refund
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '1.5rem',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body Container */}
        <div style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', flex: 1 }}>
          {errorMsg && (
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                color: '#dc2626',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                marginBottom: '1rem',
                fontSize: '0.85rem',
                fontWeight: 600,
              }}
            >
              ⚠️ {errorMsg}
            </div>
          )}

          {/* Search Box */}
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: '0.6rem', marginBottom: '1.2rem' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <input
                type="text"
                className="input"
                placeholder="Search by Bill Number (e.g. INV-1001) or Customer Mobile (e.g. 9876543210)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
                style={{
                  width: '100%',
                  padding: '0.7rem 1rem',
                  fontSize: '0.92rem',
                  borderRadius: '10px',
                  border: '1.5px solid #cbd5e1',
                }}
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={searching}
              style={{
                padding: '0.7rem 1.4rem',
                fontWeight: 700,
                borderRadius: '10px',
                background: '#3b82f6',
              }}
            >
              {searching ? 'Searching...' : '🔍 Search Invoice'}
            </button>
          </form>

          {/* Search Results Dropdown / Picker */}
          {searchResults.length > 0 && !selectedInvoice && (
            <div
              style={{
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                maxHeight: '220px',
                overflowY: 'auto',
                marginBottom: '1.2rem',
                boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
              }}
            >
              <div style={{ padding: '0.5rem 0.8rem', background: '#f8fafc', fontWeight: 700, fontSize: '0.78rem', color: '#64748b' }}>
                MATCHING INVOICES ({searchResults.length})
              </div>
              {searchResults.map((inv) => (
                <div
                  key={inv.id}
                  onClick={() => handleSelectInvoice(inv)}
                  style={{
                    padding: '0.7rem 1rem',
                    borderTop: '1px solid #f1f5f9',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#eff6ff')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div>
                    <div style={{ fontWeight: 800, color: '#1e293b' }}>
                      {inv.number} • <span style={{ color: '#059669' }}>{formatRupees(inv.total_minor)}</span>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                      Date: {inv.bdate} • Customer: {inv.customer_name || 'Retail'} {inv.customer_phone ? `(${inv.customer_phone})` : ''}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ background: '#3b82f6', color: '#fff', fontSize: '0.78rem', padding: '0.3rem 0.8rem' }}
                  >
                    Select ➔
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Invoice Detail & Lines Selection */}
          {loadingInvoice && (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
              ⏳ Loading invoice items and returnable quantities...
            </div>
          )}

          {selectedInvoice && returnInfo && !loadingInvoice && (
            <div>
              {/* Selected Bill Banner */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1.5px solid #e2e8f0',
                  borderRadius: '12px',
                  padding: '0.85rem 1.15rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                  marginBottom: '1rem',
                }}
              >
                <div>
                  <div style={{ fontSize: '1rem', fontWeight: 800, color: '#0f172a' }}>
                    Bill #{selectedInvoice.number}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                    Date: <strong>{selectedInvoice.bdate}</strong> • Customer: <strong>{selectedInvoice.customer_name || 'Retail'}</strong> {selectedInvoice.customer_phone ? `(${selectedInvoice.customer_phone})` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 700 }}>Original Bill Total</div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>{formatRupees(selectedInvoice.total_minor)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSelectedInvoice(null); setReturnInfo(null); }}
                    style={{
                      background: '#f1f5f9',
                      border: '1px solid #cbd5e1',
                      padding: '0.35rem 0.75rem',
                      borderRadius: '6px',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Change Bill
                  </button>
                </div>
              </div>

              {/* Items Table */}
              <div style={{ border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden', marginBottom: '1.2rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9', color: '#475569', textAlign: 'left', borderBottom: '1px solid #cbd5e1' }}>
                      <th style={{ padding: '0.6rem 0.75rem', width: '38px' }}>Select</th>
                      <th style={{ padding: '0.6rem 0.75rem' }}>Product</th>
                      <th style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>Sold / Ret.</th>
                      <th style={{ padding: '0.6rem 0.75rem', width: '90px' }}>Return Qty</th>
                      <th style={{ padding: '0.6rem 0.75rem' }}>Condition</th>
                      <th style={{ padding: '0.6rem 0.75rem' }}>Reason & Remarks</th>
                      <th style={{ padding: '0.6rem 0.75rem', textAlign: 'right' }}>Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {returnInfo.lines.map((l: any) => {
                      const st = lineStates[l.id] || { selected: false, returnQtyUnits: 0, condition: 'resellable', reason: 'Customer changed mind', remarks: '' };
                      const maxUnits = Number(l.returnableQtyMilli || 0) / 1000;
                      const isReturnable = maxUnits > 0;

                      return (
                        <tr
                          key={l.id}
                          style={{
                            borderBottom: '1px solid #f1f5f9',
                            background: st.selected ? '#f0fdf4' : 'transparent',
                            opacity: isReturnable ? 1 : 0.6,
                          }}
                        >
                          <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={st.selected}
                              disabled={!isReturnable}
                              onChange={() => toggleLineSelect(l.id, maxUnits)}
                              style={{ width: '16px', height: '16px', cursor: isReturnable ? 'pointer' : 'not-allowed' }}
                            />
                          </td>
                          <td style={{ padding: '0.6rem 0.75rem' }}>
                            <div style={{ fontWeight: 700, color: '#1e293b' }}>{l.name}</div>
                            <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                              Rate: {formatRupees(l.priceMinor)} {l.inclusive ? '(Tax Incl.)' : ''}
                            </div>
                          </td>
                          <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                            <div><strong>{l.billedQtyMilli / 1000}</strong> {l.unit || 'pcs'}</div>
                            <div style={{ fontSize: '0.72rem', color: l.alreadyReturnedQtyMilli > 0 ? '#dc2626' : '#94a3b8' }}>
                              {l.alreadyReturnedQtyMilli > 0 ? `Prev Ret: ${l.alreadyReturnedQtyMilli / 1000}` : 'No past returns'}
                            </div>
                          </td>
                          <td style={{ padding: '0.6rem 0.75rem' }}>
                            {isReturnable ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <input
                                  type="number"
                                  min={0.1}
                                  max={maxUnits}
                                  step="any"
                                  value={st.returnQtyUnits}
                                  disabled={!st.selected}
                                  onChange={(e) => updateLine(l.id, { returnQtyUnits: Math.min(maxUnits, Math.max(0, parseFloat(e.target.value) || 0)) })}
                                  style={{
                                    width: '65px',
                                    padding: '3px 6px',
                                    borderRadius: '6px',
                                    border: '1px solid #cbd5e1',
                                    fontWeight: 700,
                                    fontSize: '0.82rem',
                                  }}
                                />
                                <button
                                  type="button"
                                  title="Return Max Available"
                                  disabled={!st.selected}
                                  onClick={() => updateLine(l.id, { returnQtyUnits: maxUnits })}
                                  style={{
                                    background: '#f1f5f9',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '4px',
                                    padding: '2px 5px',
                                    fontSize: '0.68rem',
                                    cursor: 'pointer',
                                  }}
                                >
                                  Max
                                </button>
                              </div>
                            ) : (
                              <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontStyle: 'italic' }}>Fully returned</span>
                            )}
                          </td>
                          <td style={{ padding: '0.6rem 0.75rem' }}>
                            <select
                              value={st.condition}
                              disabled={!st.selected}
                              onChange={(e) => updateLine(l.id, { condition: e.target.value as any })}
                              style={{
                                padding: '3px 6px',
                                borderRadius: '6px',
                                border: '1px solid #cbd5e1',
                                fontSize: '0.78rem',
                                fontWeight: 600,
                                color: st.condition === 'resellable' ? '#16a34a' : st.condition === 'damaged' ? '#d97706' : '#dc2626',
                              }}
                            >
                              <option value="resellable">🟢 Resellable (Restock)</option>
                              <option value="damaged">🟡 Damaged (Hold)</option>
                              <option value="defective">🔴 Defective (Separate)</option>
                            </select>
                          </td>
                          <td style={{ padding: '0.6rem 0.75rem' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                              <select
                                value={st.reason}
                                disabled={!st.selected}
                                onChange={(e) => updateLine(l.id, { reason: e.target.value })}
                                style={{
                                  padding: '2px 5px',
                                  borderRadius: '6px',
                                  border: '1px solid #cbd5e1',
                                  fontSize: '0.75rem',
                                }}
                              >
                                {RETURN_REASONS.map((r) => (
                                  <option key={r} value={r}>{r}</option>
                                ))}
                              </select>
                              <input
                                type="text"
                                placeholder="Optional remarks..."
                                value={st.remarks}
                                disabled={!st.selected}
                                onChange={(e) => updateLine(l.id, { remarks: e.target.value })}
                                style={{
                                  padding: '2px 5px',
                                  borderRadius: '6px',
                                  border: '1px solid #e2e8f0',
                                  fontSize: '0.72rem',
                                }}
                              />
                            </div>
                          </td>
                          <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right', fontWeight: 800, color: '#dc2626' }}>
                            {st.selected ? `-${formatRupees(Math.round((Number(l.origTotalMinor || 0) * (st.returnQtyUnits * 1000)) / Number(l.billedQtyMilli || 1)))}` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Action Tabs & Mode Selection */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1.5px solid #cbd5e1',
                  borderRadius: '12px',
                  padding: '1.25rem',
                }}
              >
                {/* Summary bar */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap' }}>
                  <div>
                    <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Selected for Return: </span>
                    <strong style={{ fontSize: '0.95rem', color: '#0f172a' }}>{selectedLinesList.length} items</strong>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Total Return Credit Value: </span>
                    <strong style={{ fontSize: '1.25rem', color: '#dc2626' }}>{formatRupees(totalEstimatedCreditMinor)}</strong>
                  </div>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                  <button
                    type="button"
                    onClick={() => setActionTab('exchange')}
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      borderRadius: '8px',
                      border: actionTab === 'exchange' ? '2px solid #6366f1' : '1px solid #cbd5e1',
                      background: actionTab === 'exchange' ? '#e0e7ff' : '#ffffff',
                      color: actionTab === 'exchange' ? '#4338ca' : '#475569',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <span>🔄</span>
                    <span>1. Product Exchange (Carry to POS Cart)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActionTab('refund')}
                    style={{
                      flex: 1,
                      padding: '0.75rem',
                      borderRadius: '8px',
                      border: actionTab === 'refund' ? '2px solid #059669' : '1px solid #cbd5e1',
                      background: actionTab === 'refund' ? '#d1fae5' : '#ffffff',
                      color: actionTab === 'refund' ? '#065f46' : '#475569',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <span>💵</span>
                    <span>2. Direct Return & Refund</span>
                  </button>
                </div>

                {/* Tab 1: Exchange Action */}
                {actionTab === 'exchange' && (
                  <div>
                    <p style={{ margin: '0 0 1rem 0', fontSize: '0.82rem', color: '#475569', lineHeight: 1.5 }}>
                      The selected return credit of <strong>{formatRupees(totalEstimatedCreditMinor)}</strong> will be loaded directly into your POS billing cart. You can then scan or pick the new items the customer wants to buy, calculate the net payable difference or excess credit, and finalize both in one clean atomic step.
                    </p>
                    <button
                      type="button"
                      disabled={selectedLinesList.length === 0}
                      onClick={handleConfirmExchange}
                      style={{
                        width: '100%',
                        padding: '0.85rem',
                        borderRadius: '10px',
                        background: selectedLinesList.length === 0 ? '#94a3b8' : 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
                        color: '#fff',
                        fontWeight: 800,
                        fontSize: '0.95rem',
                        border: 'none',
                        cursor: selectedLinesList.length === 0 ? 'not-allowed' : 'pointer',
                        boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
                      }}
                    >
                      Apply Return Credit to POS Cart for Exchange ➔
                    </button>
                  </div>
                )}

                {/* Tab 2: Direct Refund Action */}
                {actionTab === 'refund' && (
                  <div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                          Refund / Disbursement Method
                        </label>
                        <select
                          value={refundMethod}
                          onChange={(e) => setRefundMethod(e.target.value as any)}
                          style={{
                            width: '100%',
                            padding: '0.6rem 0.8rem',
                            borderRadius: '8px',
                            border: '1px solid #cbd5e1',
                            fontSize: '0.85rem',
                            fontWeight: 700,
                          }}
                        >
                          <option value="cash">💵 Cash Refund (Taken from Drawer)</option>
                          <option value="upi">📱 UPI Refund / Online Transfer</option>
                          <option value="bank">🏦 Bank Account Transfer</option>
                          <option value="store_credit">🎟️ Store Credit / Customer Wallet</option>
                        </select>
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                          Refund Ref No / UPI Transaction ID
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. UPI-998822 / Cash Voucher..."
                          value={refundRef}
                          onChange={(e) => setRefundRef(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '0.6rem 0.8rem',
                            borderRadius: '8px',
                            border: '1px solid #cbd5e1',
                            fontSize: '0.85rem',
                          }}
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={selectedLinesList.length === 0 || submitting}
                      onClick={handleConfirmDirectReturn}
                      style={{
                        width: '100%',
                        padding: '0.85rem',
                        borderRadius: '10px',
                        background: selectedLinesList.length === 0 || submitting ? '#94a3b8' : '#059669',
                        color: '#fff',
                        fontWeight: 800,
                        fontSize: '0.95rem',
                        border: 'none',
                        cursor: selectedLinesList.length === 0 || submitting ? 'not-allowed' : 'pointer',
                        boxShadow: '0 4px 12px rgba(5, 150, 105, 0.3)',
                      }}
                    >
                      {submitting ? 'Processing Return & Refund...' : `Confirm Return & Refund ${formatRupees(totalEstimatedCreditMinor)} ✓`}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
