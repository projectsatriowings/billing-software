import type { DB } from '../../db/index.ts';
import { env } from '../../env.ts';
import { decryptSecret, newId } from '../../security.ts';
import type {
  CardTerminalRecord,
  TerminalTransactionRecord,
  TerminalAdapter,
  TerminalProvider,
  InitiatePaymentResult,
  TerminalStatusResult,
  CancelPaymentResult,
  RefundPaymentResult,
  ReconcileResult,
  CardNetwork,
} from './types.ts';
import { StandaloneTerminalAdapter } from './adapters/standaloneAdapter.ts';
import { MockTerminalAdapter } from './adapters/mockTerminalAdapter.ts';
import { PaytmPosAdapter } from './adapters/paytmPosAdapter.ts';
import { PineLabsAdapter } from './adapters/pineLabsAdapter.ts';
import { HdfcPosAdapter } from './adapters/hdfcPosAdapter.ts';
import { IciciPosAdapter } from './adapters/iciciPosAdapter.ts';
import { VerifoneAdapter } from './adapters/verifoneAdapter.ts';

const MASTER_KEY = env.jwtSecret || 'adaptive-billing-payment-master-secret-32-chars';

export class TerminalEngine {
  private adapters = new Map<TerminalProvider, TerminalAdapter>();

  constructor() {
    this.registerAdapter(new StandaloneTerminalAdapter());
    this.registerAdapter(new MockTerminalAdapter());
    this.registerAdapter(new PaytmPosAdapter());
    this.registerAdapter(new PineLabsAdapter());
    this.registerAdapter(new HdfcPosAdapter());
    this.registerAdapter(new IciciPosAdapter());
    this.registerAdapter(new VerifoneAdapter());
  }

  registerAdapter(adapter: TerminalAdapter): void {
    this.adapters.set(adapter.provider, adapter);
  }

  getAdapter(provider: TerminalProvider): TerminalAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new Error(`Unsupported terminal payment provider: '${provider}'.`);
    }
    return adapter;
  }

  private decryptSecrets(terminal: CardTerminalRecord) {
    return {
      authToken: (terminal.authTokenEncrypted || terminal.auth_token_encrypted) ? decryptSecret((terminal.authTokenEncrypted || terminal.auth_token_encrypted), MASTER_KEY) || undefined : undefined,
      secretKey: (terminal.secretKeyEncrypted || terminal.secret_key_encrypted) ? decryptSecret((terminal.secretKeyEncrypted || terminal.secret_key_encrypted), MASTER_KEY) || undefined : undefined,
    };
  }

  private maskCardLast4(val?: string | null): string | null {
    if (!val) return null;
    const digits = val.replace(/\D/g, '');
    return digits.length >= 4 ? digits.slice(-4) : digits || null;
  }

  /**
   * Resolve active card terminal for a given branch and counter.
   */
  async findActiveTerminal(
    db: DB,
    tenantId: string,
    branchId: string,
    counter?: string | null,
    terminalId?: string | null,
  ): Promise<CardTerminalRecord | null> {
    if (terminalId) {
      return (
        (await db.one<CardTerminalRecord>(
          'SELECT * FROM card_terminals WHERE id = ? AND tenant_id = ? AND active = TRUE AND (deleted_at IS NULL)',
          [terminalId, tenantId],
        )) || null
      );
    }

    // Try exact branch + counter match
    if (counter) {
      const counterTerminal = await db.one<CardTerminalRecord>(
        'SELECT * FROM card_terminals WHERE tenant_id = ? AND branch_id = ? AND counter = ? AND active = TRUE AND (deleted_at IS NULL) ORDER BY updated_at DESC LIMIT 1',
        [tenantId, branchId, counter],
      );
      if (counterTerminal) return counterTerminal;
    }

    // Try branch-wide default terminal (counter IS NULL or counter = '')
    const branchTerminal = await db.one<CardTerminalRecord>(
      `SELECT * FROM card_terminals WHERE tenant_id = ? AND branch_id = ? AND (counter IS NULL OR counter = '' OR counter = 'ALL') AND active = TRUE AND (deleted_at IS NULL) ORDER BY updated_at DESC LIMIT 1`,
      [tenantId, branchId],
    );
    if (branchTerminal) return branchTerminal;

    // Fallback: any active terminal in this branch
    return (
      (await db.one<CardTerminalRecord>(
        'SELECT * FROM card_terminals WHERE tenant_id = ? AND branch_id = ? AND active = TRUE AND (deleted_at IS NULL) ORDER BY updated_at DESC LIMIT 1',
        [tenantId, branchId],
      )) || null
    );
  }

  /**
   * Initiate a card payment on an integrated or standalone terminal.
   */
  async initiatePayment(
    db: DB,
    tenantId: string,
    params: {
      terminalId?: string;
      branchId: string;
      counter?: string;
      amountMinor: number;
      invoiceId?: string;
      cashierId: string;
      cashierName?: string;
      idempotencyKey?: string;
      metadata?: Record<string, any>;
    },
  ): Promise<{ transaction: TerminalTransactionRecord; instructions?: string; rawResponse?: any }> {
    if (params.amountMinor <= 0) {
      throw new Error('Payment amount must be greater than zero.');
    }

    // Idempotency check: if transaction already exists for idempotencyKey, return it
    if (params.idempotencyKey) {
      const existing = await db.one<TerminalTransactionRecord>(
        'SELECT * FROM terminal_transactions WHERE tenant_id = ? AND idempotency_key = ?',
        [tenantId, params.idempotencyKey],
      );
      if (existing) {
        return { transaction: existing };
      }
    }

    const terminal = await this.findActiveTerminal(db, tenantId, params.branchId, params.counter, params.terminalId);
    if (!terminal) {
      throw new Error('No active card machine configured for this branch or counter. Please configure a terminal in Store Settings.');
    }

    const adapter = this.getAdapter(terminal.provider);
    const decryptedSecrets = this.decryptSecrets(terminal);
    const txId = newId('ttx');

    // Call provider adapter
    let initResult: InitiatePaymentResult;
    try {
      initResult = await adapter.initiatePayment({
        terminal,
        amountMinor: params.amountMinor,
        invoiceId: params.invoiceId,
        counter: params.counter,
        cashierId: params.cashierId,
        cashierName: params.cashierName,
        idempotencyKey: params.idempotencyKey,
        decryptedSecrets,
        metadata: params.metadata,
      });
    } catch (err: any) {
      initResult = {
        status: 'failed',
        errorReason: err.message || 'Payment initiation failed.',
      };
    }

    const initialStatus = initResult.status;
    const cardLast4 = this.maskCardLast4(initResult.cardLast4);
    const verifiedAt = initialStatus === 'success' ? new Date().toISOString() : null;
    const verifiedBy = initialStatus === 'success' ? 'api' : null;

    // Insert record in terminal_transactions
    await db.exec(
      `INSERT INTO terminal_transactions (
        id, tenant_id, branch_id, terminal_id, invoice_id, counter,
        amount_minor, currency, provider, connection_mode,
        provider_tx_id, provider_ref_no, card_network, card_last4, auth_code,
        status, error_reason, idempotency_key, cashier_id, cashier_name,
        verified_at, verified_by, metadata, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, now(), now()
      )`,
      [
        txId,
        tenantId,
        params.branchId,
        terminal.id,
        params.invoiceId || null,
        params.counter || null,
        params.amountMinor,
        'INR',
        terminal.provider,
        (terminal.connectionMode || terminal.connection_mode),
        initResult.providerTxId || null,
        initResult.providerRefNo || null,
        initResult.cardNetwork || null,
        cardLast4,
        initResult.authCode || null,
        initialStatus,
        initResult.errorReason || null,
        params.idempotencyKey || null,
        params.cashierId,
        params.cashierName || null,
        verifiedAt,
        verifiedBy,
        JSON.stringify(params.metadata || {}),
      ],
    );

    // Update terminal status & last seen
    await db.exec(
      `UPDATE card_terminals SET status = ?, last_seen_at = now(), updated_at = now() WHERE id = ? AND tenant_id = ?`,
      [initialStatus === 'failed' ? 'error' : initialStatus === 'processing' ? 'busy' : 'online', terminal.id, tenantId],
    );

    const saved = await db.one<TerminalTransactionRecord>(
      'SELECT * FROM terminal_transactions WHERE id = ? AND tenant_id = ?',
      [txId, tenantId],
    );

    return {
      transaction: saved!,
      instructions: initResult.instructions,
      rawResponse: initResult.rawResponse,
    };
  }

  /**
   * Check status of a terminal payment (poll / cashier check).
   */
  async checkStatus(
    db: DB,
    tenantId: string,
    transactionId: string,
  ): Promise<TerminalTransactionRecord> {
    const tx = await db.one<TerminalTransactionRecord>(
      'SELECT * FROM terminal_transactions WHERE id = ? AND tenant_id = ?',
      [transactionId, tenantId],
    );
    if (!tx) {
      throw new Error(`Terminal transaction '${transactionId}' not found.`);
    }

    // If already finalized (success, failed, cancelled, refunded), return existing record
    if (['success', 'failed', 'cancelled', 'refunded'].includes(tx.status)) {
      return tx;
    }

    const terminal = await db.one<CardTerminalRecord>(
      'SELECT * FROM card_terminals WHERE id = ? AND tenant_id = ?',
      [(tx.terminalId || tx.terminal_id), tenantId],
    );
    if (!terminal) {
      throw new Error(`Configured terminal for transaction '${transactionId}' no longer exists.`);
    }

    const adapter = this.getAdapter(terminal.provider);
    const decryptedSecrets = this.decryptSecrets(terminal);

    const statusRes: TerminalStatusResult = await adapter.getPaymentStatus({
      terminal,
      transaction: tx,
      decryptedSecrets,
    });

    // PCI: Mask card number
    const cardLast4 = this.maskCardLast4(statusRes.cardLast4 || (tx.cardLast4 || tx.card_last4));
    const newStatus = statusRes.status;
    const isSuccess = newStatus === 'success';
    const verifiedAt = isSuccess && !(tx.verifiedAt || tx.verified_at) ? new Date().toISOString() : (tx.verifiedAt || tx.verified_at);
    const verifiedBy = isSuccess && !(tx.verifiedBy || tx.verified_by) ? 'api' : (tx.verifiedBy || tx.verified_by);

    await db.exec(
      `UPDATE terminal_transactions SET
        status = ?,
        provider_tx_id = COALESCE(?, provider_tx_id),
        provider_ref_no = COALESCE(?, provider_ref_no),
        card_network = COALESCE(?, card_network),
        card_last4 = COALESCE(?, card_last4),
        auth_code = COALESCE(?, auth_code),
        error_reason = COALESCE(?, error_reason),
        verified_at = ?,
        verified_by = ?,
        updated_at = now()
      WHERE id = ? AND tenant_id = ?`,
      [
        newStatus,
        statusRes.providerTxId || null,
        statusRes.providerRefNo || null,
        statusRes.cardNetwork || null,
        cardLast4,
        statusRes.authCode || null,
        statusRes.errorReason || null,
        verifiedAt,
        verifiedBy,
        transactionId,
        tenantId,
      ],
    );

    if (isSuccess) {
      await db.exec(
        `UPDATE card_terminals SET status = 'online', last_seen_at = now(), updated_at = now() WHERE id = ? AND tenant_id = ?`,
        [terminal.id, tenantId],
      );
    }

    return (await db.one<TerminalTransactionRecord>(
      'SELECT * FROM terminal_transactions WHERE id = ? AND tenant_id = ?',
      [transactionId, tenantId],
    ))!;
  }

  /**
   * Cashier confirms a standalone card machine payment by providing the physical slip RRN.
   */
  async confirmStandalonePayment(
    db: DB,
    tenantId: string,
    params: {
      transactionId: string;
      cashierId: string;
      cashierName?: string;
      providerRefNo: string; // RRN
      cardNetwork: CardNetwork;
      cardLast4?: string;
      authCode?: string;
    },
  ): Promise<TerminalTransactionRecord> {
    const tx = await db.one<TerminalTransactionRecord>(
      'SELECT * FROM terminal_transactions WHERE id = ? AND tenant_id = ?',
      [params.transactionId, tenantId],
    );
    if (!tx) {
      throw new Error(`Terminal transaction '${params.transactionId}' not found.`);
    }

    if (tx.status === 'success') {
      return tx; // Already confirmed
    }

    const cleanRrn = params.providerRefNo.trim();
    if (!cleanRrn || cleanRrn.length < 4 || cleanRrn.length > 32) {
      throw new Error('Please enter a valid Card Machine Reference / RRN number (min 4 characters).');
    }

    const cardLast4 = this.maskCardLast4(params.cardLast4);

    await db.exec(
      `UPDATE terminal_transactions SET
        status = 'success',
        provider_ref_no = ?,
        card_network = ?,
        card_last4 = ?,
        auth_code = ?,
        verified_at = now(),
        verified_by = 'cashier_manual',
        cashier_id = ?,
        cashier_name = COALESCE(?, cashier_name),
        updated_at = now()
      WHERE id = ? AND tenant_id = ?`,
      [
        cleanRrn,
        params.cardNetwork || 'OTHER',
        cardLast4,
        params.authCode ? params.authCode.trim() : null,
        params.cashierId,
        params.cashierName || null,
        params.transactionId,
        tenantId,
      ],
    );

    return (await db.one<TerminalTransactionRecord>(
      'SELECT * FROM terminal_transactions WHERE id = ? AND tenant_id = ?',
      [params.transactionId, tenantId],
    ))!;
  }

  /**
   * Cancel an in-flight card transaction.
   */
  async cancelPayment(
    db: DB,
    tenantId: string,
    transactionId: string,
  ): Promise<CancelPaymentResult> {
    const tx = await db.one<TerminalTransactionRecord>(
      'SELECT * FROM terminal_transactions WHERE id = ? AND tenant_id = ?',
      [transactionId, tenantId],
    );
    if (!tx) {
      throw new Error(`Terminal transaction '${transactionId}' not found.`);
    }

    if (tx.status === 'success') {
      throw new Error('Cannot cancel a successful transaction. Please perform a return or refund instead.');
    }

    const terminal = await db.one<CardTerminalRecord>(
      'SELECT * FROM card_terminals WHERE id = ? AND tenant_id = ?',
      [(tx.terminalId || tx.terminal_id), tenantId],
    );

    let cancelRes: CancelPaymentResult = { cancelled: true };
    if (terminal) {
      const adapter = this.getAdapter(terminal.provider);
      const decryptedSecrets = this.decryptSecrets(terminal);
      cancelRes = await adapter.cancelPayment({
        terminal,
        transaction: tx,
        decryptedSecrets,
      });
    }

    await db.exec(
      `UPDATE terminal_transactions SET status = 'cancelled', error_reason = ?, updated_at = now() WHERE id = ? AND tenant_id = ?`,
      [cancelRes.message || 'Cancelled by user', transactionId, tenantId],
    );

    if (terminal) {
      await db.exec(
        `UPDATE card_terminals SET status = 'online', updated_at = now() WHERE id = ? AND tenant_id = ?`,
        [terminal.id, tenantId],
      );
    }

    return cancelRes;
  }

  /**
   * Ping / Test connection with a physical card terminal.
   */
  async pingTerminal(
    db: DB,
    tenantId: string,
    terminalId: string,
  ): Promise<{ online: boolean; message?: string }> {
    const terminal = await db.one<CardTerminalRecord>(
      'SELECT * FROM card_terminals WHERE id = ? AND tenant_id = ?',
      [terminalId, tenantId],
    );
    if (!terminal) {
      throw new Error(`Terminal '${terminalId}' not found.`);
    }

    const adapter = this.getAdapter(terminal.provider);
    const decryptedSecrets = this.decryptSecrets(terminal);
    const res = adapter.pingTerminal
      ? await adapter.pingTerminal(terminal, decryptedSecrets)
      : { online: true, message: `${adapter.name} configuration verified.` };

    await db.exec(
      `UPDATE card_terminals SET status = ?, last_seen_at = now(), updated_at = now() WHERE id = ? AND tenant_id = ?`,
      [res.online ? 'online' : 'error', terminalId, tenantId],
    );

    return res;
  }

  /**
   * Toggle terminal active state.
   */
  async setTerminalActive(
    db: DB,
    tenantId: string,
    terminalId: string,
    active: boolean,
  ): Promise<CardTerminalRecord> {
    await db.exec(
      `UPDATE card_terminals SET active = ?, updated_at = now() WHERE id = ? AND tenant_id = ?`,
      [active, terminalId, tenantId],
    );
    const updated = await db.one<CardTerminalRecord>(
      'SELECT * FROM card_terminals WHERE id = ? AND tenant_id = ?',
      [terminalId, tenantId],
    );
    if (!updated) {
      throw new Error(`Terminal '${terminalId}' not found.`);
    }
    return updated;
  }

  /**
   * Reconcile a terminal transaction.
   */
  async reconcileTransaction(
    db: DB,
    tenantId: string,
    transactionId: string,
  ): Promise<ReconcileResult> {
    const tx = await db.one<TerminalTransactionRecord>(
      'SELECT * FROM terminal_transactions WHERE id = ? AND tenant_id = ?',
      [transactionId, tenantId],
    );
    if (!tx) {
      throw new Error(`Terminal transaction '${transactionId}' not found.`);
    }

    const terminal = await db.one<CardTerminalRecord>(
      'SELECT * FROM card_terminals WHERE id = ? AND tenant_id = ?',
      [(tx.terminalId || tx.terminal_id), tenantId],
    );

    let res: ReconcileResult = {
      matched: !!(tx.providerRefNo || tx.provider_ref_no),
      providerStatus: tx.status,
      amountMinor: Number((tx.amountMinor || tx.amount_minor)),
      providerRefNo: (tx.providerRefNo || tx.provider_ref_no) || undefined,
    };

    if (terminal) {
      const adapter = this.getAdapter(terminal.provider);
      const decryptedSecrets = this.decryptSecrets(terminal);
      if (adapter.reconcileTransaction) {
        res = await adapter.reconcileTransaction({
          terminal,
          transaction: tx,
          decryptedSecrets,
        });
      }
    }

    if (res.matched) {
      await db.exec(
        `UPDATE terminal_transactions SET reconciled = TRUE, reconciled_at = now(), updated_at = now() WHERE id = ? AND tenant_id = ?`,
        [transactionId, tenantId],
      );
    }

    return res;
  }
}

// Global Singleton Instance
export const terminalEngine = new TerminalEngine();
