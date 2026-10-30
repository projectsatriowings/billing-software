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
  CallbackResult,
  CardTerminalRecord,
  DecryptedSecrets,
} from '../types.ts';

/**
 * Mock Terminal Adapter for Sandbox, Demonstration & Automated Testing
 * Accurately models asynchronous EDC card swipe, customer PIN entry, card tap,
 * bank decline, timeout, and authorization response.
 */
export class MockTerminalAdapter implements TerminalAdapter {
  readonly name = 'Mock / Sandbox EDC Terminal';
  readonly provider = 'mock' as const;
  readonly connectionModes = ['integrated', 'standalone'] as const;

  async initiatePayment(params: InitiatePaymentParams): Promise<InitiatePaymentResult> {
    const pTxId = `MOCK-TX-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // Simulating specific test triggers based on amountMinor:
    // ₹8,888 (888800 paise) = Bank Declined
    if (params.amountMinor === 888800) {
      return {
        status: 'failed',
        providerTxId: pTxId,
        errorReason: 'Card Declined: Insufficient Funds (Simulated Decline)',
        rawResponse: { code: '51', message: 'INSUFFICIENT_FUNDS' },
      };
    }

    // ₹7,777 (777700 paise) = Card Expired
    if (params.amountMinor === 777700) {
      return {
        status: 'failed',
        providerTxId: pTxId,
        errorReason: 'Card Expired / Invalid CVV (Simulated)',
        rawResponse: { code: '54', message: 'EXPIRED_CARD' },
      };
    }

    // ₹9,999 (999900 paise) = Timeout Simulation (remains pending)
    if (params.amountMinor === 999900) {
      return {
        status: 'pending',
        providerTxId: pTxId,
        instructions: 'Simulated Long Wait: Customer presented card on terminal...',
        rawResponse: { state: 'WAITING_PIN' },
      };
    }

    // Default: Terminal displays amount, customer taps/inserts card
    return {
      status: 'processing',
      providerTxId: pTxId,
      instructions: 'Please tap, insert or swipe card on test EDC terminal.',
      rawResponse: { state: 'WAITING_FOR_CARD', pTxId },
    };
  }

  async getPaymentStatus(params: CheckStatusParams): Promise<TerminalStatusResult> {
    // If already finalized, return current status
    if (['success', 'failed', 'cancelled', 'refunded'].includes(params.transaction.status)) {
      return {
        status: params.transaction.status,
        providerTxId: params.transaction.provider_tx_id || undefined,
        providerRefNo: params.transaction.provider_ref_no || undefined,
        cardNetwork: params.transaction.card_network || undefined,
        cardLast4: params.transaction.card_last4 || undefined,
        authCode: params.transaction.auth_code || undefined,
        errorReason: params.transaction.error_reason || undefined,
      };
    }

    const amt = Number(params.transaction.amount_minor);

    // Timeout trigger simulation
    if (amt === 999900) {
      return {
        status: 'pending',
        providerTxId: params.transaction.provider_tx_id || undefined,
        errorReason: 'Customer is still entering PIN on device...',
      };
    }

    // Normal mock transaction succeeds on status check
    const rrn = `99${Date.now().toString().slice(-10)}`;
    const randomNetworks: Array<'VISA' | 'MASTERCARD' | 'RUPAY'> = ['VISA', 'MASTERCARD', 'RUPAY'];
    const net = randomNetworks[Math.floor(Math.random() * randomNetworks.length)];
    const last4 = String(1000 + Math.floor(Math.random() * 9000));

    return {
      status: 'success',
      providerTxId: params.transaction.provider_tx_id || `MOCK-TX-${Date.now()}`,
      providerRefNo: rrn,
      cardNetwork: net,
      cardLast4: last4,
      authCode: `AUTH${Math.floor(100000 + Math.random() * 900000)}`,
      rawResponse: {
        responseCode: '00',
        responseMessage: 'APPROVED',
        rrn,
        cardType: net,
        last4,
      },
    };
  }

  async cancelPayment(params: CancelPaymentParams): Promise<CancelPaymentResult> {
    return {
      cancelled: true,
      message: `Transaction ${params.transaction.id} successfully cancelled on mock terminal.`,
      rawResponse: { responseCode: 'CANCELLED_BY_USER' },
    };
  }

  async refundPayment(params: RefundPaymentParams): Promise<RefundPaymentResult> {
    return {
      status: 'success',
      refundTxId: `MOCK-REF-${Date.now()}`,
      message: `Refund of ₹${(params.refundAmountMinor / 100).toFixed(2)} processed successfully on mock terminal.`,
    };
  }

  async reconcileTransaction(params: ReconcileParams): Promise<ReconcileResult> {
    return {
      matched: true,
      providerStatus: 'SETTLED',
      amountMinor: Number(params.transaction.amount_minor),
      providerRefNo: params.transaction.provider_ref_no || 'MOCK-RRN-12345',
    };
  }

  async handleCallback(payload: any): Promise<CallbackResult> {
    const txId = payload.txId || payload.transactionId;
    return {
      handled: true,
      transactionId: txId,
      statusResult: {
        status: payload.status === 'SUCCESS' ? 'success' : 'failed',
        providerTxId: payload.providerTxId,
        providerRefNo: payload.rrn || 'CALLBACK-RRN',
        cardNetwork: payload.cardNetwork || 'VISA',
        cardLast4: payload.last4 || '1234',
        authCode: payload.authCode || 'APPR01',
      },
      ackBody: { status: 'OK' },
    };
  }

  async pingTerminal(_terminal: CardTerminalRecord, _secrets: DecryptedSecrets): Promise<{ online: boolean; message?: string }> {
    return {
      online: true,
      message: 'Mock EDC Terminal connected and responsive (Cloud Sandbox Mode).',
    };
  }
}
