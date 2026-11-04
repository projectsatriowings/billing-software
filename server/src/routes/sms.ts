import { requirePerm, requireUser } from '../auth.ts';
import { bad, forbidden, notFound, V, type Router } from '../http.ts';
import { audit } from '../audit.ts';
import { resolveBranchScope } from '../branchScope.ts';
import {
  getTrialStatus,
  activateTrial,
  sendSms,
  normalizeIndianPhone,
  getTenantSmsConfig,
  verifyGatewayStatus,
  type SmsProviderType,
} from '../services/smsService.ts';

export function registerSms(r: Router) {
  /**
   * Get Free SMS Trial status & Gateway configuration.
   * Accessible by Super Admin and Store Managers.
   */
  r.get('/api/sms/trial-status', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const status = await getTrialStatus(ctx.db, tenantId);
    return status;
  });

  /**
   * Get SMS Settings (provider, credentials status, senderId, templateId, autoSendEnabled).
   * Accessible by Super Admin and Store Managers.
   * NOTE: Full API keys are NEVER exposed to the frontend.
   */
  r.get('/api/sms/settings', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const config = await getTenantSmsConfig(ctx.db, tenantId);
    const health = await verifyGatewayStatus(config);

    const key = config.apiKey || '';
    const apiKeyMasked = key.length > 8
      ? `${key.slice(0, 4)}••••${key.slice(-4)}`
      : (key ? '••••••••' : '');

    return {
      provider: config.provider,
      senderId: config.senderId || '',
      templateId: config.templateId || '',
      autoSendEnabled: config.autoSendEnabled,
      hasApiKey: Boolean(key),
      apiKeyMasked,
      isConfigured: Boolean(config.apiKey || config.provider === 'simulator'),
      authStatus: health.authenticated ? 'valid' : (config.apiKey ? 'invalid' : 'unconfigured'),
      walletBalance: health.walletBalance || null,
      apiRouteUnlocked: health.apiRouteUnlocked,
      statusMessage: health.statusMessage,
      providerNotice: config.provider === 'fast2sms'
        ? 'Fast2SMS policy requires a one-time transaction of ₹100 or more on fast2sms.com to unlock external API sending.'
        : null,
    };
  });

  /**
   * Update SMS Gateway Settings.
   * Restricted strictly to Super Admin (Owner).
   */
  r.post('/api/sms/settings', requireUser, async (ctx) => {
    if (ctx.user!.role !== 'owner') {
      throw forbidden('Only Super Admin can configure SMS gateway settings.');
    }

    const tenantId = ctx.user!.tenantId;
    const provider = V.str(ctx.body?.provider, 'Provider', { required: true }).toLowerCase() as SmsProviderType;
    const validProviders: SmsProviderType[] = ['msg91', 'smslocal', 'fast2sms', 'twilio', 'generic', 'simulator'];
    if (!validProviders.includes(provider)) {
      throw bad(`Invalid SMS provider. Must be one of: ${validProviders.join(', ')}`);
    }

    const senderId = ctx.body?.senderId !== undefined ? String(ctx.body.senderId).trim() : null;
    const templateId = ctx.body?.templateId !== undefined ? String(ctx.body.templateId).trim() : null;
    const autoSendEnabled = ctx.body?.autoSendEnabled !== undefined ? Boolean(ctx.body.autoSendEnabled) : true;
    const apiKeyRaw = ctx.body?.apiKey ? String(ctx.body.apiKey).trim() : null;

    // Fetch existing settings
    const existing = await ctx.db.one<any>('SELECT * FROM sms_settings WHERE tenant_id = ?', [tenantId]);
    const finalApiKey = apiKeyRaw && !apiKeyRaw.includes('••••') ? apiKeyRaw : (existing?.api_key || existing?.apiKey || null);

    await ctx.db.exec(
      `INSERT INTO sms_settings (tenant_id, provider, api_key, sender_id, template_id, auto_send_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, now(), now())
       ON CONFLICT (tenant_id) DO UPDATE
       SET provider = EXCLUDED.provider,
           api_key = COALESCE(EXCLUDED.api_key, sms_settings.api_key),
           sender_id = EXCLUDED.sender_id,
           template_id = EXCLUDED.template_id,
           auto_send_enabled = EXCLUDED.auto_send_enabled,
           updated_at = now()`,
      [tenantId, provider, finalApiKey, senderId, templateId, autoSendEnabled]
    );

    await audit(ctx.db, ctx, {
      action: 'sms.settings_updated',
      entity: 'sms_settings',
      entityId: tenantId,
      detail: {
        provider,
        senderId,
        templateId,
        autoSendEnabled,
        apiKeyUpdated: Boolean(apiKeyRaw && !apiKeyRaw.includes('••••')),
      },
    });

    const updatedConfig = await getTenantSmsConfig(ctx.db, tenantId);
    const key = updatedConfig.apiKey || '';
    const apiKeyMasked = key.length > 8
      ? `${key.slice(0, 4)}••••${key.slice(-4)}`
      : (key ? '••••••••' : '');

    return {
      ok: true,
      settings: {
        provider: updatedConfig.provider,
        senderId: updatedConfig.senderId || '',
        templateId: updatedConfig.templateId || '',
        autoSendEnabled: updatedConfig.autoSendEnabled,
        hasApiKey: Boolean(key),
        apiKeyMasked,
      },
    };
  });

  /**
   * Activate Free SMS Trial (100 SMS for 24 Hours).
   * Restricted strictly to Super Admin (Owner).
   */
  r.post('/api/sms/trial/activate', requireUser, async (ctx) => {
    if (ctx.user!.role !== 'owner') {
      throw forbidden('Only Super Admin can activate the Free SMS Trial.');
    }

    const tenantId = ctx.user!.tenantId;
    try {
      const status = await activateTrial(ctx.db, tenantId, ctx.user!.id);
      await audit(ctx.db, ctx, {
        action: 'sms.trial_activated',
        entity: 'sms_trial',
        entityId: tenantId,
        detail: {
          totalCredits: status.totalCredits,
          expiresAt: status.expiresAt,
        },
      });
      return { ok: true, status };
    } catch (err: any) {
      throw bad(err.message || 'Failed to activate SMS trial');
    }
  });

  /**
   * Send a Test SMS.
   * Allowed for Super Admin and Store Manager.
   */
  r.post('/api/sms/test', requireUser, async (ctx) => {
    if (ctx.user!.role !== 'owner' && ctx.user!.role !== 'manager') {
      throw forbidden('Only Super Admin and Store Managers can send test SMS.');
    }

    const scope = await resolveBranchScope(ctx);
    const branchId = scope.branchId || (await ctx.db.one<{ id: string }>('SELECT id FROM branches WHERE tenant_id = ? ORDER BY code = \'MAIN\' DESC LIMIT 1', [ctx.user!.tenantId]))?.id;
    if (!branchId) {
      throw bad('No branch found for tenant.');
    }

    const rawMobile = V.str(ctx.body?.mobileNumber, 'Mobile number', { required: true });
    const norm = normalizeIndianPhone(rawMobile);
    if (!norm) {
      throw bad('Invalid Indian mobile number. Must be 10 digits starting with 6, 7, 8, or 9.');
    }

    const shop = await ctx.db.one<any>('SELECT name FROM tenants WHERE id = ?', [ctx.user!.tenantId]);
    const shopName = shop?.name || 'Supermarket';
    const testMsg = ctx.body?.message
      ? V.str(ctx.body.message, 'Message', { max: 160 })
      : `Test SMS from ${shopName}. Your SMS Gateway integration is working successfully!`;

    const res = await sendSms(ctx.db, {
      tenantId: ctx.user!.tenantId,
      branchId,
      mobileNumber: norm.digits10,
      customerName: 'Test Recipient',
      messageText: testMsg,
      templateVars: {
        name: 'Test Customer',
        shop: shopName,
        bill_no: 'TEST-001',
        amount: '100.00',
        points: '10',
      },
      creditType: 'trial',
    });

    await audit(ctx.db, ctx, {
      action: 'sms.test_sent',
      entity: 'sms_log',
      entityId: res.logId || 'test',
      detail: {
        mobile: norm.digits10,
        status: res.status,
        error: res.error,
      },
    });

    if (!res.success) {
      return {
        ok: false,
        error: res.error,
        status: res.status,
        logId: res.logId,
      };
    }

    return {
      ok: true,
      messageId: res.messageId,
      logId: res.logId,
      remainingCredits: res.remainingCredits,
    };
  });

  /**
   * List SMS History with branch isolation and search/status filters.
   * Super Admin sees all or filtered by branch.
   * Store Manager sees ONLY their assigned branch.
   */
  r.get('/api/sms/history', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);

    const limit = Math.min(100, Math.max(1, Number(ctx.query.limit || 20)));
    const offset = Math.max(0, Number(ctx.query.offset || 0));
    const status = (ctx.query.status as string || '').trim().toLowerCase();
    const q = (ctx.query.q as string || '').trim().toLowerCase();

    let whereSql = 'WHERE l.tenant_id = ?';
    const params: any[] = [tenantId];

    if (!scope.isSuperAdminAll && scope.branchId) {
      whereSql += ' AND l.branch_id = ?';
      params.push(scope.branchId);
    } else if (ctx.query.branchId && ctx.query.branchId !== 'all') {
      whereSql += ' AND l.branch_id = ?';
      params.push(ctx.query.branchId);
    }

    if (status && ['pending', 'sent', 'failed', 'delivered'].includes(status)) {
      whereSql += ' AND l.status = ?';
      params.push(status);
    }

    if (q) {
      whereSql += ' AND (lower(COALESCE(i.number, \'\')) LIKE ? OR lower(COALESCE(l.customer_name, \'\')) LIKE ? OR l.mobile_number LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const countRow = await ctx.db.one<{ total: number }>(
      `SELECT count(*)::int AS total
       FROM sms_logs l
       LEFT JOIN invoices i ON i.id = l.invoice_id
       ${whereSql}`,
      params
    );

    const total = Number(countRow?.total || 0);

    const rows = await ctx.db.query<any>(
      `SELECT l.id,
              l.tenant_id as "tenantId",
              l.branch_id as "branchId",
              b.name as "branchName",
              b.code as "branchCode",
              l.customer_id as "customerId",
              l.invoice_id as "invoiceId",
              i.number as "invoiceNumber",
              l.customer_name as "customerName",
              l.mobile_number as "mobileNumber",
              l.message_text as "messageText",
              l.status,
              l.credit_type as "creditType",
              l.gateway_provider as "gatewayProvider",
              l.gateway_message_id as "gatewayMessageId",
              l.gateway_response as "gatewayResponse",
              l.error_message as "errorMessage",
              l.retry_count as "retryCount",
              l.sent_at as "sentAt",
              l.created_at as "createdAt"
       FROM sms_logs l
       LEFT JOIN branches b ON b.id = l.branch_id
       LEFT JOIN invoices i ON i.id = l.invoice_id
       ${whereSql}
       ORDER BY l.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return {
      total,
      limit,
      offset,
      history: rows,
    };
  });

  /**
   * Retry sending a failed SMS message.
   */
  r.post('/api/sms/retry/:id', requireUser, async (ctx) => {
    if (ctx.user!.role !== 'owner' && ctx.user!.role !== 'manager') {
      throw forbidden('Only Super Admin and Store Managers can retry failed SMS.');
    }

    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    const branchFilter = (!scope.isSuperAdminAll && scope.branchId) ? ' AND branch_id = ?' : '';
    const branchParams = (!scope.isSuperAdminAll && scope.branchId) ? [scope.branchId] : [];

    const log = await ctx.db.one<any>(
      `SELECT * FROM sms_logs WHERE id = ? AND tenant_id = ?${branchFilter}`,
      [ctx.params.id, tenantId, ...branchParams]
    );

    if (!log) throw notFound('SMS log entry');
    if (log.status !== 'failed') {
      throw bad(`Only failed SMS can be retried. Current status is ${log.status}.`);
    }

    const res = await sendSms(ctx.db, {
      tenantId,
      branchId: log.branchId || log.branch_id,
      customerId: log.customerId || log.customer_id || undefined,
      invoiceId: log.invoiceId || log.invoice_id || undefined,
      customerName: log.customerName || log.customer_name || undefined,
      mobileNumber: log.mobileNumber || log.mobile_number,
      messageText: log.messageText || log.message_text,
      creditType: log.creditType || log.credit_type || 'trial',
      isRetry: true,
      existingLogId: log.id,
    });

    await audit(ctx.db, ctx, {
      action: 'sms.retried',
      entity: 'sms_log',
      entityId: log.id,
      detail: {
        success: res.success,
        status: res.status,
        error: res.error,
      },
    });

    return {
      ok: res.success,
      status: res.status,
      error: res.error,
      remainingCredits: res.remainingCredits,
    };
  });
}
