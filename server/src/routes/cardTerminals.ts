import type { Router } from '../http.ts';
import { requirePerm } from '../auth.ts';
import { bad, notFound, V } from '../http.ts';
import { newId, encryptSecret } from '../security.ts';
import { audit } from '../audit.ts';
import { env } from '../env.ts';
import { terminalEngine } from '../services/terminal/terminalEngine.ts';
import type { CardTerminalRecord, TerminalProvider, TerminalConnectionMode } from '../services/terminal/types.ts';
import { TERMINAL_PROVIDERS, TERMINAL_CONNECTION_MODES, CARD_NETWORKS } from '../../../shared/types.ts';

const MASTER_KEY = env.jwtSecret || 'adaptive-billing-payment-master-secret-32-chars';

function formatTerminalResponse(t: CardTerminalRecord & { branch_name?: string }) {
  return {
    id: t.id,
    tenantId: t.tenant_id,
    branchId: t.branch_id,
    branchName: t.branch_name,
    counter: t.counter,
    name: t.name,
    provider: t.provider,
    model: t.model,
    serialNumber: t.serial_number,
    terminalId: t.terminal_id,
    merchantId: t.merchant_id,
    connectionMode: t.connection_mode,
    ipAddress: t.ip_address,
    port: t.port,
    apiEndpoint: t.api_endpoint,
    hasAuthToken: !!t.auth_token_encrypted,
    hasSecretKey: !!t.secret_key_encrypted,
    active: t.active,
    status: t.status,
    lastSeenAt: t.last_seen_at,
    config: t.config || {},
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

export function registerCardTerminals(r: Router): void {
  // 1. List terminals for tenant (optionally filter by branch)
  r.get('/api/terminals', requirePerm('sell'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const branchId = ctx.query.branchId ? String(ctx.query.branchId) : null;

    let sql = `
      SELECT t.*, b.name AS branch_name
      FROM card_terminals t
      LEFT JOIN branches b ON b.id = t.branch_id
      WHERE t.tenant_id = ?
    `;
    const params: any[] = [tenantId];

    if (branchId) {
      sql += ` AND t.branch_id = ?`;
      params.push(branchId);
    }

    sql += ` ORDER BY t.created_at ASC`;

    const rows = await ctx.db.query<CardTerminalRecord & { branch_name?: string }>(sql, params);
    return { terminals: rows.map(formatTerminalResponse) };
  });

  // 2. Get active terminal for cashier's branch & counter
  r.get('/api/terminals/active', requirePerm('sell'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const branchId = ctx.query.branchId ? String(ctx.query.branchId) : null;
    const counter = ctx.query.counter ? String(ctx.query.counter) : null;
    const terminalId = ctx.query.terminalId ? String(ctx.query.terminalId) : null;

    if (!branchId && !terminalId) {
      throw bad('branchId or terminalId is required to locate active card terminal.');
    }

    const terminal = await terminalEngine.findActiveTerminal(ctx.db, tenantId, branchId || '', counter, terminalId);
    if (!terminal) {
      return {
        configured: false,
        terminal: null,
        message: 'No card machine configured for this counter. You can record payments standalone or configure a terminal in Settings.',
      };
    }

    const branch = await ctx.db.one<any>('SELECT name FROM branches WHERE id = ? AND tenant_id = ?', [terminal.branch_id, tenantId]);

    return {
      configured: true,
      terminal: formatTerminalResponse({ ...terminal, branch_name: branch?.name }),
    };
  });

  // 3. Create a new card terminal
  r.post('/api/terminals', requirePerm('settings'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;

    const branchId = V.str(b.branchId, 'Branch ID', { max: 64, required: true });
    const name = V.str(b.name, 'Terminal Name', { max: 128, required: true });
    const provider = V.oneOf(b.provider, 'Provider', TERMINAL_PROVIDERS);
    const connectionMode = V.oneOf(b.connectionMode || 'integrated', 'Connection Mode', TERMINAL_CONNECTION_MODES);

    // Verify branch exists for tenant
    const branch = await ctx.db.one<any>('SELECT * FROM branches WHERE id = ? AND tenant_id = ?', [branchId, tenantId]);
    if (!branch) {
      throw bad(`Branch '${branchId}' not found.`);
    }

    const counter = V.optStr(b.counter, 'Counter', 64) || null;
    const model = V.optStr(b.model, 'Model', 64) || null;
    const serialNumber = V.optStr(b.serialNumber, 'Serial Number', 64) || null;
    const terminalId = V.optStr(b.terminalId, 'Terminal ID (TID)', 64) || null;
    const merchantId = V.optStr(b.merchantId, 'Merchant ID (MID)', 64) || null;
    const ipAddress = V.optStr(b.ipAddress, 'IP Address', 64) || null;
    const port = b.port ? Math.floor(Number(b.port)) : null;
    const apiEndpoint = V.optStr(b.apiEndpoint, 'API Endpoint', 512) || null;

    let authTokenEncrypted: string | null = null;
    if (b.authToken && String(b.authToken).trim()) {
      authTokenEncrypted = encryptSecret(String(b.authToken).trim(), MASTER_KEY);
    }

    let secretKeyEncrypted: string | null = null;
    if (b.secretKey && String(b.secretKey).trim()) {
      secretKeyEncrypted = encryptSecret(String(b.secretKey).trim(), MASTER_KEY);
    }

    const id = newId('term');
    const config = typeof b.config === 'object' && b.config !== null ? b.config : {};

    await ctx.db.tx(async (q) => {
      await q.exec(
        `INSERT INTO card_terminals (
          id, tenant_id, branch_id, counter, name, provider, model, serial_number,
          terminal_id, merchant_id, connection_mode, ip_address, port, api_endpoint,
          auth_token_encrypted, secret_key_encrypted, active, status, config, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, TRUE, 'online', ?, now(), now()
        )`,
        [
          id,
          tenantId,
          branchId,
          counter,
          name,
          provider,
          model,
          serialNumber,
          terminalId,
          merchantId,
          connectionMode,
          ipAddress,
          port,
          apiEndpoint,
          authTokenEncrypted,
          secretKeyEncrypted,
          JSON.stringify(config),
        ],
      );

      await audit(q, ctx, {
        action: 'terminals.create',
        entity: 'card_terminals',
        entityId: id,
        detail: { name, branchId, provider, connectionMode, terminalId },
      });
    });

    const created = await ctx.db.one<CardTerminalRecord>(
      'SELECT * FROM card_terminals WHERE id = ? AND tenant_id = ?',
      [id, tenantId],
    );

    return { terminal: formatTerminalResponse({ ...created!, branch_name: branch.name }) };
  });

  // 4. Update a card terminal
  r.put('/api/terminals/:id', requirePerm('settings'), async (ctx) => {
    const id = String(ctx.params.id);
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};

    const existing = await ctx.db.one<CardTerminalRecord>(
      'SELECT * FROM card_terminals WHERE id = ? AND tenant_id = ?',
      [id, tenantId],
    );
    if (!existing) {
      throw notFound('Card terminal not found.');
    }

    const branchId = b.branchId ? V.str(b.branchId, 'Branch ID', { max: 64 }) : existing.branch_id;
    const name = b.name ? V.str(b.name, 'Terminal Name', { max: 128 }) : existing.name;
    const provider = b.provider ? V.oneOf(b.provider, 'Provider', TERMINAL_PROVIDERS) : existing.provider;
    const connectionMode = b.connectionMode
      ? V.oneOf(b.connectionMode, 'Connection Mode', TERMINAL_CONNECTION_MODES)
      : existing.connection_mode;

    const counter = b.counter !== undefined ? (V.optStr(b.counter, 'Counter', 64) || null) : existing.counter;
    const model = b.model !== undefined ? (V.optStr(b.model, 'Model', 64) || null) : existing.model;
    const serialNumber = b.serialNumber !== undefined ? (V.optStr(b.serialNumber, 'Serial Number', 64) || null) : existing.serial_number;
    const terminalId = b.terminalId !== undefined ? (V.optStr(b.terminalId, 'Terminal ID', 64) || null) : existing.terminal_id;
    const merchantId = b.merchantId !== undefined ? (V.optStr(b.merchantId, 'Merchant ID', 64) || null) : existing.merchant_id;
    const ipAddress = b.ipAddress !== undefined ? (V.optStr(b.ipAddress, 'IP Address', 64) || null) : existing.ip_address;
    const port = b.port !== undefined ? (b.port ? Math.floor(Number(b.port)) : null) : existing.port;
    const apiEndpoint = b.apiEndpoint !== undefined ? (V.optStr(b.apiEndpoint, 'API Endpoint', 512) || null) : existing.api_endpoint;

    let authTokenEncrypted = existing.auth_token_encrypted;
    if (b.authToken !== undefined) {
      authTokenEncrypted = b.authToken && String(b.authToken).trim() ? encryptSecret(String(b.authToken).trim(), MASTER_KEY) : null;
    }

    let secretKeyEncrypted = existing.secret_key_encrypted;
    if (b.secretKey !== undefined) {
      secretKeyEncrypted = b.secretKey && String(b.secretKey).trim() ? encryptSecret(String(b.secretKey).trim(), MASTER_KEY) : null;
    }

    const active = b.active !== undefined ? Boolean(b.active) : existing.active;
    const config = typeof b.config === 'object' && b.config !== null ? b.config : existing.config;

    await ctx.db.tx(async (q) => {
      await q.exec(
        `UPDATE card_terminals SET
          branch_id = ?, counter = ?, name = ?, provider = ?, model = ?, serial_number = ?,
          terminal_id = ?, merchant_id = ?, connection_mode = ?, ip_address = ?, port = ?,
          api_endpoint = ?, auth_token_encrypted = ?, secret_key_encrypted = ?,
          active = ?, config = ?, updated_at = now()
        WHERE id = ? AND tenant_id = ?`,
        [
          branchId,
          counter,
          name,
          provider,
          model,
          serialNumber,
          terminalId,
          merchantId,
          connectionMode,
          ipAddress,
          port,
          apiEndpoint,
          authTokenEncrypted,
          secretKeyEncrypted,
          active,
          JSON.stringify(config),
          id,
          tenantId,
        ],
      );

      await audit(q, ctx, {
        action: 'terminals.update',
        entity: 'card_terminals',
        entityId: id,
        detail: { name, branchId, provider, connectionMode, active },
      });
    });

    const updated = await ctx.db.one<CardTerminalRecord>(
      'SELECT * FROM card_terminals WHERE id = ? AND tenant_id = ?',
      [id, tenantId],
    );

    return { terminal: formatTerminalResponse(updated!) };
  });

  // 5. Delete a card terminal
  r.delete('/api/terminals/:id', requirePerm('settings'), async (ctx) => {
    const id = String(ctx.params.id);
    const tenantId = ctx.user!.tenantId;

    const existing = await ctx.db.one<CardTerminalRecord>(
      'SELECT * FROM card_terminals WHERE id = ? AND tenant_id = ?',
      [id, tenantId],
    );
    if (!existing) {
      throw notFound('Card terminal not found.');
    }

    await ctx.db.tx(async (q) => {
      await q.exec('DELETE FROM card_terminals WHERE id = ? AND tenant_id = ?', [id, tenantId]);
      await audit(q, ctx, {
        action: 'terminals.delete',
        entity: 'card_terminals',
        entityId: id,
        detail: { name: existing.name, provider: existing.provider },
      });
    });

    return { success: true, message: `Terminal '${existing.name}' removed.` };
  });

  // 6. Ping / test connection with terminal
  r.post('/api/terminals/:id/ping', requirePerm('settings'), async (ctx) => {
    const id = String(ctx.params.id);
    const tenantId = ctx.user!.tenantId;

    const pingRes = await terminalEngine.pingTerminal(ctx.db, tenantId, id);
    return pingRes;
  });

  // 7. Toggle terminal active status
  r.post('/api/terminals/:id/toggle', requirePerm('settings'), async (ctx) => {
    const id = String(ctx.params.id);
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};
    const active = Boolean(b.active);

    const updated = await terminalEngine.setTerminalActive(ctx.db, tenantId, id, active);
    return { terminal: formatTerminalResponse(updated) };
  });

  // 8. Initiate payment on card terminal
  r.post('/api/terminals/payments/initiate', requirePerm('sell'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;

    const branchId = V.str(b.branchId, 'Branch ID', { max: 64, required: true });
    const amountMinor = Math.floor(Number(b.amountMinor));
    if (isNaN(amountMinor) || amountMinor <= 0) {
      throw bad('amountMinor must be a positive integer in paise.');
    }

    const terminalId = b.terminalId ? String(b.terminalId) : undefined;
    const counter = b.counter ? String(b.counter) : undefined;
    const invoiceId = b.invoiceId ? String(b.invoiceId) : undefined;
    const idempotencyKey = b.idempotencyKey ? String(b.idempotencyKey) : undefined;

    const res = await terminalEngine.initiatePayment(ctx.db, tenantId, {
      terminalId,
      branchId,
      counter,
      amountMinor,
      invoiceId,
      cashierId: ctx.user!.id,
      cashierName: ctx.user!.name,
      idempotencyKey,
      metadata: b.metadata,
    });

    return {
      transaction: res.transaction,
      instructions: res.instructions,
      rawResponse: res.rawResponse,
    };
  });

  // 9. Check status of a terminal payment
  r.get('/api/terminals/payments/:txId/status', requirePerm('sell'), async (ctx) => {
    const txId = String(ctx.params.txId);
    const tenantId = ctx.user!.tenantId;

    const tx = await terminalEngine.checkStatus(ctx.db, tenantId, txId);
    return { transaction: tx };
  });

  // 10. Cancel an in-flight card transaction
  r.post('/api/terminals/payments/:txId/cancel', requirePerm('sell'), async (ctx) => {
    const txId = String(ctx.params.txId);
    const tenantId = ctx.user!.tenantId;

    const cancelRes = await terminalEngine.cancelPayment(ctx.db, tenantId, txId);
    return cancelRes;
  });

  // 11. Confirm standalone card machine payment (cashier RRN entry)
  r.post('/api/terminals/payments/:txId/confirm-standalone', requirePerm('sell'), async (ctx) => {
    const txId = String(ctx.params.txId);
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};

    const providerRefNo = V.str(b.providerRefNo, 'Card Machine Reference / RRN', { max: 32, required: true });
    const cardNetwork = (V.optStr(b.cardNetwork, 'Card Network', 32) || 'OTHER') as any;
    const cardLast4 = V.optStr(b.cardLast4, 'Card Last 4 Digits', 4) || undefined;
    const authCode = V.optStr(b.authCode, 'Approval / Auth Code', 32) || undefined;

    const updated = await terminalEngine.confirmStandalonePayment(ctx.db, tenantId, {
      transactionId: txId,
      cashierId: ctx.user!.id,
      cashierName: ctx.user!.name,
      providerRefNo,
      cardNetwork,
      cardLast4,
      authCode,
    });

    await audit(ctx.db, ctx, {
      action: 'terminals.confirm_standalone',
      entity: 'terminal_transactions',
      entityId: txId,
      detail: { rrn: providerRefNo, cardNetwork, cardLast4, amountMinor: updated.amount_minor },
    });

    return { transaction: updated };
  });

  // 12. List terminal transactions (for reports & reconciliation)
  r.get('/api/terminals/transactions', requirePerm('reports'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const branchId = ctx.query.branchId ? String(ctx.query.branchId) : null;
    const terminalId = ctx.query.terminalId ? String(ctx.query.terminalId) : null;
    const status = ctx.query.status ? String(ctx.query.status) : null;
    const limit = Math.min(100, Math.max(1, Number(ctx.query.limit) || 50));

    let sql = `
      SELECT tx.*, t.name AS terminal_name, b.name AS branch_name
      FROM terminal_transactions tx
      LEFT JOIN card_terminals t ON t.id = tx.terminal_id
      LEFT JOIN branches b ON b.id = tx.branch_id
      WHERE tx.tenant_id = ?
    `;
    const params: any[] = [tenantId];

    if (branchId) {
      sql += ` AND tx.branch_id = ?`;
      params.push(branchId);
    }
    if (terminalId) {
      sql += ` AND tx.terminal_id = ?`;
      params.push(terminalId);
    }
    if (status) {
      sql += ` AND tx.status = ?`;
      params.push(status);
    }

    sql += ` ORDER BY tx.created_at DESC LIMIT ?`;
    params.push(limit);

    const rows = await ctx.db.query<any>(sql, params);
    return { transactions: rows };
  });

  // 13. Reconcile transaction
  r.post('/api/terminals/transactions/:txId/reconcile', requirePerm('reports'), async (ctx) => {
    const txId = String(ctx.params.txId);
    const tenantId = ctx.user!.tenantId;

    const res = await terminalEngine.reconcileTransaction(ctx.db, tenantId, txId);
    return res;
  });

  // 14. Webhook listener for provider cloud callbacks
  r.post('/api/terminals/webhook/:provider', async (ctx) => {
    const provider = String(ctx.params.provider) as TerminalProvider;
    const payload = ctx.body ?? {};

    try {
      const adapter = terminalEngine.getAdapter(provider);
      if (adapter.handleCallback) {
        const sig = ctx.req.headers['x-signature'] as string | undefined;
        const cbRes = await adapter.handleCallback(payload, sig);
        if (cbRes.handled && cbRes.transactionId && cbRes.statusResult) {
          // If transactionId matches in database, update it
          const tx = await ctx.db.one<any>(
            'SELECT * FROM terminal_transactions WHERE (id = ? OR provider_tx_id = ?) LIMIT 1',
            [cbRes.transactionId, cbRes.transactionId],
          );
          if (tx) {
            const isSuccess = cbRes.statusResult.status === 'success';
            await ctx.db.exec(
              `UPDATE terminal_transactions SET
                status = ?,
                provider_ref_no = COALESCE(?, provider_ref_no),
                card_network = COALESCE(?, card_network),
                card_last4 = COALESCE(?, card_last4),
                auth_code = COALESCE(?, auth_code),
                verified_at = COALESCE(verified_at, now()),
                verified_by = 'webhook',
                updated_at = now()
              WHERE id = ?`,
              [
                cbRes.statusResult.status,
                cbRes.statusResult.providerRefNo || null,
                cbRes.statusResult.cardNetwork || null,
                cbRes.statusResult.cardLast4 || null,
                cbRes.statusResult.authCode || null,
                tx.id,
              ],
            );
          }
        }
        return cbRes.ackBody || { status: 'OK' };
      }
    } catch (err: any) {
      console.warn(`Webhook error for provider ${provider}:`, err.message);
    }
    return { status: 'IGNORED' };
  });
}
