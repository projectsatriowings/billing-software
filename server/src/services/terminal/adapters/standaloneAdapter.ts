import type {
  TerminalAdapter,
  InitiatePaymentParams,
  InitiatePaymentResult,
  CheckStatusParams,
  TerminalStatusResult,
  CancelPaymentParams,
  CancelPaymentResult,
  RefundPaymentParams,
  RefundPaymentResult,
  ReconcileParams,
  ReconcileResult,
  CardTerminalRecord,
  DecryptedSecrets,
} from '../types.ts';

/**
 * Standalone Card Terminal Adapter
 * For non-integrated, standalone bank EDC swipe machines.
 * Cashier initiates sale on EDC directly, then inputs RRN reference number into Adaptive Billing.
 * PCI DSS compliant: Never captures PAN or PIN.
 */
export class StandaloneTerminalAdapter implements TerminalAdapter {
  readonly name = 'Standalone EDC Card Machine';
  readonly provider = 'standalone' as const;
  readonly connectionModes = ['standalone'] as const;

  async initiatePayment(params: InitiatePaymentParams): Promise<InitiatePaymentResult> {
    const amountRs = (params.amountMinor / 100).toFixed(2);
    return {
      status: 'pending',
      instructions: `Swipe/Tap card for ₹${amountRs} on standalone terminal. Once approved, enter the 12-digit RRN from the printed charge slip.`,
      rawResponse: { mode: 'standalone', amountMinor: params.amountMinor },
    };
  }

  async getPaymentStatus(params: CheckStatusParams): Promise<TerminalStatusResult> {
    // For standalone, status depends on cashier's manual confirmation
    return {
      status: params.transaction.status,
      providerRefNo: params.transaction.provider_ref_no || undefined,
      cardNetwork: params.transaction.card_network || undefined,
      cardLast4: params.transaction.card_last4 || undefined,
      authCode: params.transaction.auth_code || undefined,
      errorReason: params.transaction.error_reason || undefined,
    };
  }

  async cancelPayment(_params: CancelPaymentParams): Promise<CancelPaymentResult> {
    return {
      cancelled: true,
      message: 'Standalone transaction cancelled by cashier.',
    };
  }

  async refundPayment(params: RefundPaymentParams): Promise<RefundPaymentResult> {
    const refundRs = (params.refundAmountMinor / 100).toFixed(2);
    return {
      status: 'success',
      refundTxId: `STD-REF-${Date.now()}`,
      message: `Perform manual refund of ₹${refundRs} on physical terminal using original RRN ${params.transaction.provider_ref_no || 'N/A'}.`,
    };
  }

  async reconcileTransaction(params: ReconcileParams): Promise<ReconcileResult> {
    const hasRrn = !!params.transaction.provider_ref_no;
    return {
      matched: hasRrn,
      providerStatus: params.transaction.status,
      providerRefNo: params.transaction.provider_ref_no || undefined,
      amountMinor: Number(params.transaction.amount_minor),
      discrepancyNote: hasRrn ? undefined : 'Missing RRN reference number for standalone transaction.',
    };
  }

  async pingTerminal(_terminal: CardTerminalRecord, _secrets: DecryptedSecrets): Promise<{ online: boolean; message?: string }> {
    return {
      online: true,
      message: 'Standalone terminal is marked active and ready for cashier manual entry.',
    };
  }
}

