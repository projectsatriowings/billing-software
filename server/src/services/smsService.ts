import type { DB } from '../db/index.ts';
import { newId } from '../security.ts';
import { j } from '../db/index.ts';

export type SmsProviderType = 'msg91' | 'smslocal' | 'fast2sms' | 'twilio' | 'generic' | 'simulator';

export interface SmsConfig {
  provider: SmsProviderType;
  apiKey: string;
  senderId?: string;
  templateId?: string;
  dltTemplateId?: string;
  dltEntityId?: string;
  autoSendEnabled: boolean;
  gatewayUrl?: string;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFrom?: string;
}

export function getEnvSmsConfig(): SmsConfig {
  return {
    provider: (process.env.SMS_PROVIDER?.toLowerCase() || 'msg91') as SmsProviderType,
    apiKey: process.env.SMS_API_KEY || '',
    senderId: process.env.SMS_SENDER_ID || '',
    templateId: process.env.SMS_TEMPLATE_ID || process.env.SMS_DLT_TE_ID || '',
    dltTemplateId: process.env.SMS_TEMPLATE_ID || process.env.SMS_DLT_TE_ID || '',
    dltEntityId: process.env.SMS_DLT_PE_ID || '',
    autoSendEnabled: true,
    gatewayUrl: process.env.SMS_GATEWAY_URL || '',
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
    twilioFrom: process.env.TWILIO_FROM || '',
  };
}

/**
 * Resolves SMS Configuration for a tenant by merging DB settings with environment variables.
 * DB settings take priority when configured.
 */
export async function getTenantSmsConfig(db: DB, tenantId: string): Promise<SmsConfig> {
  const envConfig = getEnvSmsConfig();
  try {
    const row = await db.one<any>(
      'SELECT * FROM sms_settings WHERE tenant_id = ?',
      [tenantId]
    );

    if (!row) {
      return envConfig;
    }

    const provider = (row.provider || envConfig.provider) as SmsProviderType;
    const apiKey = (row.apiKey ?? row.api_key) || envConfig.apiKey;
    const senderId = (row.senderId ?? row.sender_id) || envConfig.senderId;
    const templateId = (row.templateId ?? row.template_id) || envConfig.templateId;
    const dltEntityId = (row.entityId ?? row.entity_id) || envConfig.dltEntityId;
    const autoSendEnabled = row.autoSendEnabled !== undefined
      ? Boolean(row.autoSendEnabled)
      : (row.auto_send_enabled !== undefined ? Boolean(row.auto_send_enabled) : true);

    return {
      provider,
      apiKey,
      senderId,
      templateId,
      dltTemplateId: templateId,
      dltEntityId,
      autoSendEnabled,
      gatewayUrl: envConfig.gatewayUrl,
      twilioAccountSid: envConfig.twilioAccountSid,
      twilioAuthToken: envConfig.twilioAuthToken,
      twilioFrom: envConfig.twilioFrom,
    };
  } catch {
    return envConfig;
  }
}

export interface NormalizedPhone {
  raw: string;
  digits10: string; // 9840456789
  e164: string;     // +919840456789
  isValid: boolean;
}

/**
 * Normalizes phone number strictly for Indian mobile numbers (10 digits starting with 6-9).
 */
export function normalizeIndianPhone(input: string | null | undefined): NormalizedPhone | null {
  if (!input) return null;
  let digits = String(input).replace(/\D/g, '');
  if (digits.startsWith('0091')) digits = digits.slice(4);
  else if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1);

  if (digits.length !== 10) return null;
  if (!['6', '7', '8', '9'].includes(digits[0])) return null;

  return {
    raw: input,
    digits10: digits,
    e164: `+91${digits}`,
    isValid: true,
  };
}

export interface SmsTrialStatus {
  status: 'inactive' | 'active' | 'expired' | 'exhausted';
  totalCredits: number;
  creditsUsed: number;
  remainingCredits: number;
  activatedAt: string | null;
  expiresAt: string | null;
  activatedBy: string | null;
  canActivate: boolean;
  canSend: boolean;
  provider: string;
  providerType: string;
  isConfigured: boolean;
  autoSendEnabled: boolean;
}

/**
 * Evaluates and synchronizes the free trial status for a business tenant.
 */
export async function getTrialStatus(db: DB, tenantId: string): Promise<SmsTrialStatus> {
  const config = await getTenantSmsConfig(db, tenantId);
  const isConfigured = Boolean(
    config.apiKey ||
    (config.twilioAccountSid && config.twilioAuthToken) ||
    config.gatewayUrl ||
    config.provider === 'simulator'
  );

  const row = await db.one<any>(
    'SELECT * FROM sms_trials WHERE tenant_id = ?',
    [tenantId]
  );

  const providerNames: Record<SmsProviderType, string> = {
    msg91: 'MSG91 Flow API (India DLT)',
    smslocal: 'SMSLocal / Textlocal (India)',
    fast2sms: 'Fast2SMS (India)',
    twilio: 'Twilio SMS',
    simulator: 'SMS Simulator (Testing Mode)',
    generic: 'Generic HTTP Gateway',
  };

  const providerName = providerNames[config.provider] || config.provider;

  if (!row) {
    return {
      status: 'inactive',
      totalCredits: 100,
      creditsUsed: 0,
      remainingCredits: 100,
      activatedAt: null,
      expiresAt: null,
      activatedBy: null,
      canActivate: true,
      canSend: false,
      provider: providerName,
      providerType: config.provider,
      isConfigured,
      autoSendEnabled: config.autoSendEnabled,
    };
  }

  const now = new Date();
  const rawExpires = row.expiresAt ?? row.expires_at;
  const rawActivated = row.activatedAt ?? row.activated_at;
  const expiresAt = rawExpires ? new Date(rawExpires) : null;
  const activatedAt = rawActivated ? new Date(rawActivated) : null;
  const totalCredits = Number(row.totalCredits ?? row.total_credits ?? 100);
  const creditsUsed = Number(row.creditsUsed ?? row.credits_used ?? 0);
  const remainingCredits = Math.max(0, totalCredits - creditsUsed);

  let currentStatus: 'inactive' | 'active' | 'expired' | 'exhausted' = row.status;

  if (row.status === 'active') {
    if (expiresAt && now > expiresAt) {
      currentStatus = 'expired';
      await db.exec('UPDATE sms_trials SET status = \'expired\', updated_at = now() WHERE tenant_id = ?', [tenantId]);
    } else if (remainingCredits <= 0) {
      currentStatus = 'exhausted';
      await db.exec('UPDATE sms_trials SET status = \'exhausted\', updated_at = now() WHERE tenant_id = ?', [tenantId]);
    }
  }

  return {
    status: currentStatus,
    totalCredits,
    creditsUsed,
    remainingCredits,
    activatedAt: activatedAt ? activatedAt.toISOString() : null,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    activatedBy: row.activatedBy ?? row.activated_by ?? null,
    canActivate: currentStatus === 'inactive',
    canSend: currentStatus === 'active' && remainingCredits > 0 && (!expiresAt || now <= expiresAt),
    provider: providerName,
    providerType: config.provider,
    isConfigured,
    autoSendEnabled: config.autoSendEnabled,
  };
}

export interface GatewayHealthStatus {
  authenticated: boolean;
  walletBalance?: string | null;
  apiRouteUnlocked: boolean;
  statusMessage: string;
}

/**
 * Checks whether the configured provider authentication succeeds
 * and whether the provider requires a minimum transaction to unlock API sending.
 */
export async function verifyGatewayStatus(config: SmsConfig): Promise<GatewayHealthStatus> {
  if (!config.apiKey && config.provider !== 'simulator') {
    return {
      authenticated: false,
      apiRouteUnlocked: false,
      statusMessage: 'No API Key configured.',
    };
  }

  if (config.provider === 'simulator') {
    return {
      authenticated: true,
      apiRouteUnlocked: true,
      statusMessage: 'Simulator mode active. All messages will be simulated at zero cost.',
    };
  }

  if (config.provider === 'fast2sms') {
    try {
      const resp = await fetch('https://www.fast2sms.com/dev/wallet', {
        headers: { authorization: config.apiKey },
      });
      const data: any = await resp.json().catch(() => ({}));
      if (resp.ok && data.return === true) {
        return {
          authenticated: true,
          walletBalance: data.wallet ? `₹${parseFloat(data.wallet).toFixed(2)}` : '₹50.00',
          apiRouteUnlocked: false, // Fast2SMS requires 100 INR transaction
          statusMessage: 'Fast2SMS API Key is valid and authenticated (Wallet: ₹' + (data.wallet ?? '50.00') + '). Fast2SMS policy requires a one-time transaction of ₹100 or more on fast2sms.com before API route sending is unlocked.',
        };
      }
      return {
        authenticated: false,
        apiRouteUnlocked: false,
        statusMessage: data.message || 'Invalid Fast2SMS API Key',
      };
    } catch (err: any) {
      return {
        authenticated: false,
        apiRouteUnlocked: false,
        statusMessage: 'Could not connect to Fast2SMS: ' + err.message,
      };
    }
  }

  return {
    authenticated: Boolean(config.apiKey),
    apiRouteUnlocked: Boolean(config.apiKey),
    statusMessage: 'Gateway configured.',
  };
}

/**
 * Super Admin activation of the 100 free SMS 24-hour trial.
 */
export async function activateTrial(db: DB, tenantId: string, userId: string): Promise<SmsTrialStatus> {
  const current = await db.one<any>('SELECT * FROM sms_trials WHERE tenant_id = ?', [tenantId]);
  if (current && current.status !== 'inactive') {
    throw new Error(`Trial cannot be re-activated. Current status: ${current.status}.`);
  }

  const totalCredits = 100;
  await db.exec(
    `INSERT INTO sms_trials (tenant_id, status, total_credits, credits_used, activated_at, expires_at, activated_by, created_at, updated_at)
     VALUES (?, 'active', ?, 0, now(), now() + interval '24 hours', ?, now(), now())
     ON CONFLICT (tenant_id) DO UPDATE
     SET status = 'active',
         total_credits = EXCLUDED.total_credits,
         credits_used = 0,
         activated_at = now(),
         expires_at = now() + interval '24 hours',
         activated_by = EXCLUDED.activated_by,
         updated_at = now()
     WHERE sms_trials.status = 'inactive'`,
    [tenantId, totalCredits, userId]
  );

  return getTrialStatus(db, tenantId);
}

/**
 * Concurrency-safe atomic trial credit reservation.
 * Guarantees that even with concurrent billing checkouts, credits_used never exceeds 100.
 */
export async function reserveTrialCredit(db: DB, tenantId: string): Promise<{ success: boolean; creditsUsed?: number; remainingCredits?: number; reason?: string }> {
  const now = new Date();
  const row = await db.one<any>(
    `UPDATE sms_trials
     SET credits_used = credits_used + 1,
         updated_at = now()
     WHERE tenant_id = ?
       AND status = 'active'
       AND expires_at > now()
       AND credits_used < total_credits
     RETURNING credits_used, total_credits, expires_at`,
    [tenantId]
  );

  if (!row) {
    const check = await db.one<any>('SELECT status, expires_at, credits_used, total_credits FROM sms_trials WHERE tenant_id = ?', [tenantId]);
    if (!check || check.status === 'inactive') {
      return { success: false, reason: 'SMS Free Trial is not activated. Super Admin must activate the trial in SMS Settings.' };
    }
    const checkExpires = check.expiresAt ?? check.expires_at;
    const checkUsed = Number(check.creditsUsed ?? check.credits_used ?? 0);
    const checkTotal = Number(check.totalCredits ?? check.total_credits ?? 100);

    if (checkExpires && new Date(checkExpires) <= now) {
      await db.exec('UPDATE sms_trials SET status = \'expired\', updated_at = now() WHERE tenant_id = ?', [tenantId]);
      return { success: false, reason: 'Free SMS trial expired (24 hours exceeded).' };
    }
    if (checkUsed >= checkTotal) {
      await db.exec('UPDATE sms_trials SET status = \'exhausted\', updated_at = now() WHERE tenant_id = ?', [tenantId]);
      return { success: false, reason: 'Free SMS trial credit limit reached (100 SMS used).' };
    }
    return { success: false, reason: 'Free SMS trial is currently unavailable or inactive.' };
  }

  const creditsUsed = Number(row.credits_used || row.creditsUsed || 0);
  const totalCredits = Number(row.total_credits || row.totalCredits || 100);
  const remaining = Math.max(0, totalCredits - creditsUsed);

  if (creditsUsed >= totalCredits) {
    await db.exec('UPDATE sms_trials SET status = \'exhausted\', updated_at = now() WHERE tenant_id = ?', [tenantId]);
  }

  return {
    success: true,
    creditsUsed,
    remainingCredits: remaining,
  };
}

/**
 * Atomically rolls back a reserved credit if the gateway fails or rejects the message.
 */
export async function rollbackTrialCredit(db: DB, tenantId: string): Promise<void> {
  await db.exec(
    `UPDATE sms_trials
     SET credits_used = GREATEST(0, credits_used - 1),
         status = CASE WHEN status = 'exhausted' THEN 'active' ELSE status END,
         updated_at = now()
     WHERE tenant_id = ?`,
    [tenantId]
  );
}

export interface GatewaySendResult {
  success: boolean;
  messageId?: string;
  rawResponse?: any;
  error?: string;
}

/**
 * Dispatches the SMS through the configured gateway provider.
 */
export async function dispatchToGateway(
  phone: NormalizedPhone,
  messageText: string,
  config: SmsConfig,
  templateVars?: {
    name?: string;
    shop?: string;
    bill_no?: string;
    amount?: string;
    points?: string;
  }
): Promise<GatewaySendResult> {
  if (config.provider === 'simulator') {
    console.log(`\n📱 [SMS SIMULATOR] Sent to +91 ${phone.digits10}:\n"${messageText}"\n`);
    return {
      success: true,
      messageId: `sim_${Date.now()}`,
      rawResponse: { simulated: true, to: phone.e164, message: messageText, timestamp: new Date().toISOString() },
    };
  }

  if (!config.apiKey && !config.twilioAccountSid && !config.gatewayUrl) {
    return {
      success: false,
      error: 'SMS Gateway credentials not configured. Please enter API credentials in SMS Settings.',
    };
  }

  try {
    switch (config.provider) {
      case 'msg91': {
        // MSG91 Official Flow API (POST https://control.msg91.com/api/v5/flow/)
        const templateId = config.templateId || config.dltTemplateId;
        if (!templateId) {
          return {
            success: false,
            error: 'MSG91 requires a Template/Flow ID. Please configure SMS_TEMPLATE_ID in SMS Settings or .env.',
          };
        }

        const recipientPayload: Record<string, any> = {
          mobiles: `91${phone.digits10}`,
          name: templateVars?.name || 'Customer',
          shop: templateVars?.shop || 'Supermarket',
          bill_no: templateVars?.bill_no || '',
          amount: templateVars?.amount || '',
          points: templateVars?.points || '0',
          message: messageText,
        };

        const flowPayload: Record<string, any> = {
          template_id: templateId,
          short_url: '0',
          recipients: [recipientPayload],
        };

        if (config.senderId) {
          flowPayload.sender = config.senderId;
        }

        const resp = await fetch('https://control.msg91.com/api/v5/flow/', {
          method: 'POST',
          headers: {
            'authkey': config.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(flowPayload),
        });

        const data: any = await resp.json().catch(() => ({}));
        if (!resp.ok || data.type === 'error') {
          return {
            success: false,
            rawResponse: data,
            error: data.message || `MSG91 Error HTTP ${resp.status}`,
          };
        }

        const messageId = data.message || data.request_id || `msg_${Date.now()}`;
        return { success: true, messageId: String(messageId), rawResponse: data };
      }

      case 'smslocal': {
        // Textlocal / SMSLocal India API (https://api.textlocal.in/send/)
        const params = new URLSearchParams();
        params.append('apikey', config.apiKey);
        params.append('numbers', `91${phone.digits10}`);
        params.append('message', messageText);
        if (config.senderId) {
          params.append('sender', config.senderId);
        }

        const resp = await fetch('https://api.textlocal.in/send/', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });

        const data: any = await resp.json().catch(() => ({}));
        if (!resp.ok || data.status === 'failure') {
          const errMsg = data.errors && Array.isArray(data.errors)
            ? data.errors.map((e: any) => e.message).join(', ')
            : (data.message || `SMSLocal HTTP Error ${resp.status}`);
          return { success: false, rawResponse: data, error: errMsg };
        }

        const msgId = Array.isArray(data.messages) && data.messages[0]?.id
          ? String(data.messages[0].id)
          : (data.batch_id ? String(data.batch_id) : `smsloc_${Date.now()}`);

        return { success: true, messageId: msgId, rawResponse: data };
      }

      case 'fast2sms': {
        // Fast2SMS Bulk SMS V2 API for India
        const payload: Record<string, any> = {
          numbers: phone.digits10,
        };

        if (config.templateId || config.dltTemplateId) {
          payload.route = 'dlt';
          payload.sender_id = config.senderId || undefined;
          payload.message = config.templateId || config.dltTemplateId;
        } else {
          // Standard / Quick SMS Route
          payload.route = 'q';
          payload.message = messageText;
        }

        const resp = await fetch('https://www.fast2sms.com/dev/bulkV2', {
          method: 'POST',
          headers: {
            'authorization': config.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        const data: any = await resp.json().catch(() => ({}));

        if (!resp.ok || data.return === false || data.status_code === 999 || (data.status_code && data.status_code !== 200)) {
          let err: string;
          if (data.status_code === 999 || String(data.message).includes('100 INR')) {
            err = 'Fast2SMS Policy: A one-time transaction of ₹100 or more is required on fast2sms.com before using the API route.';
          } else if (data.status_code === 412) {
            err = 'Invalid Fast2SMS API Key. Please check your Dev API authorization key.';
          } else {
            err = data.message
              ? (Array.isArray(data.message) ? data.message.join(', ') : String(data.message))
              : `Fast2SMS HTTP Error ${resp.status}`;
          }
          return { success: false, rawResponse: data, error: err };
        }

        const messageId = data.request_id || (Array.isArray(data.data) && data.data[0]?.message_id) || `fst_${Date.now()}`;
        return { success: true, messageId: String(messageId), rawResponse: data };
      }

      case 'twilio': {
        const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64');
        const params = new URLSearchParams();
        params.append('To', phone.e164);
        params.append('From', config.twilioFrom || '');
        params.append('Body', messageText);

        const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });

        const data: any = await resp.json().catch(() => ({}));
        if (!resp.ok || data.error_code) {
          return { success: false, rawResponse: data, error: data.message || `Twilio Error ${resp.status}` };
        }
        return { success: true, messageId: data.sid || `tw_${Date.now()}`, rawResponse: data };
      }

      case 'generic':
      default: {
        const url = config.gatewayUrl;
        if (!url) {
          return { success: false, error: 'SMS_GATEWAY_URL not configured for generic provider.' };
        }

        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            phone: phone.digits10,
            e164: phone.e164,
            message: messageText,
            senderId: config.senderId,
          }),
        });

        const data: any = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          return { success: false, rawResponse: data, error: data.error || data.message || `Gateway returned HTTP ${resp.status}` };
        }
        return { success: true, messageId: data.id || data.messageId || `gen_${Date.now()}`, rawResponse: data };
      }
    }
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Network exception while connecting to SMS Gateway',
    };
  }
}

export interface SendSmsOptions {
  tenantId: string;
  branchId: string;
  mobileNumber: string;
  customerId?: string;
  customerName?: string;
  messageText: string;
  templateVars?: {
    name?: string;
    shop?: string;
    bill_no?: string;
    amount?: string;
    points?: string;
  };
  invoiceId?: string;
  creditType?: 'trial' | 'paid';
  isRetry?: boolean;
  existingLogId?: string;
}

export interface SendSmsResult {
  success: boolean;
  skipped?: boolean;
  logId?: string;
  messageId?: string;
  status: 'sent' | 'failed' | 'pending' | 'skipped';
  error?: string;
  remainingCredits?: number;
}

/**
 * Primary transactional SMS sender:
 * 1. Checks and normalizes phone number
 * 2. Deduplicates by invoice
 * 3. Atomically reserves trial credit
 * 4. Dispatches to gateway
 * 5. Consumes or rolls back credit based on acceptance
 * 6. Records audit history
 */
export async function sendSms(db: DB, opts: SendSmsOptions): Promise<SendSmsResult> {
  const normPhone = normalizeIndianPhone(opts.mobileNumber);
  if (!normPhone) {
    return {
      success: false,
      skipped: true,
      status: 'skipped',
      error: 'Invalid or missing Indian mobile number (must be 10 digits starting with 6-9)',
    };
  }

  // Deduplication guard for invoice SMS
  if (opts.invoiceId && !opts.isRetry) {
    const existing = await db.one<any>(
      `SELECT id, status FROM sms_logs
       WHERE tenant_id = ? AND invoice_id = ? AND status IN ('sent', 'delivered', 'pending')
       LIMIT 1`,
      [opts.tenantId, opts.invoiceId]
    );
    if (existing) {
      return {
        success: true,
        skipped: true,
        logId: existing.id,
        status: existing.status,
        error: 'SMS has already been sent for this invoice.',
      };
    }
  }

  const creditType = opts.creditType || 'trial';
  let reserved = false;
  let remainingCredits: number | undefined;

  const config = await getTenantSmsConfig(db, opts.tenantId);

  if (creditType === 'trial') {
    const reservation = await reserveTrialCredit(db, opts.tenantId);
    if (!reservation.success) {
      const failLogId = opts.existingLogId || newId('sms');
      if (!opts.existingLogId) {
        await db.exec(
          `INSERT INTO sms_logs (
            id, tenant_id, branch_id, customer_id, invoice_id, customer_name, mobile_number, message_text,
            status, credit_type, gateway_provider, error_message, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'failed', 'trial', ?, ?, now(), now())`,
          [
            failLogId,
            opts.tenantId,
            opts.branchId,
            opts.customerId || null,
            opts.invoiceId || null,
            opts.customerName || null,
            normPhone.digits10,
            opts.messageText,
            config.provider,
            reservation.reason,
          ]
        );
      }
      return {
        success: false,
        logId: failLogId,
        status: 'failed',
        error: reservation.reason,
      };
    }
    reserved = true;
    remainingCredits = reservation.remainingCredits;
  }

  const logId = opts.existingLogId || newId('sms');

  // Create or update log in pending state
  if (!opts.existingLogId) {
    await db.exec(
      `INSERT INTO sms_logs (
        id, tenant_id, branch_id, customer_id, invoice_id, customer_name, mobile_number, message_text,
        status, credit_type, gateway_provider, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, now(), now())`,
      [
        logId,
        opts.tenantId,
        opts.branchId,
        opts.customerId || null,
        opts.invoiceId || null,
        opts.customerName || null,
        normPhone.digits10,
        opts.messageText,
        creditType,
        config.provider,
      ]
    );
  }

  const result = await dispatchToGateway(normPhone, opts.messageText, config, opts.templateVars);

  if (result.success) {
    // Accepted by gateway -> credit permanently consumed
    await db.exec(
      `UPDATE sms_logs
       SET status = 'sent',
           gateway_message_id = ?,
           gateway_response = ?::jsonb,
           error_message = NULL,
           retry_count = retry_count + ${opts.isRetry ? 1 : 0},
           sent_at = now(),
           updated_at = now()
       WHERE id = ?`,
      [result.messageId || null, j(result.rawResponse || {}), logId]
    );

    return {
      success: true,
      logId,
      messageId: result.messageId,
      status: 'sent',
      remainingCredits,
    };
  } else {
    // Failed or rejected -> Roll back reserved trial credit
    if (reserved) {
      await rollbackTrialCredit(db, opts.tenantId);
    }

    const errDetail = result.error || 'Gateway rejected SMS request';
    await db.exec(
      `UPDATE sms_logs
       SET status = 'failed',
           gateway_response = ?::jsonb,
           error_message = ?,
           retry_count = retry_count + ${opts.isRetry ? 1 : 0},
           updated_at = now()
       WHERE id = ?`,
      [j(result.rawResponse || {}), errDetail, logId]
    );

    return {
      success: false,
      logId,
      status: 'failed',
      error: errDetail,
      remainingCredits,
    };
  }
}

/**
 * Builds DLT compliant bill message template and sends SMS.
 */
export async function sendInvoiceBillSms(
  db: DB,
  params: {
    tenantId: string;
    branchId: string;
    customerId?: string | null;
    invoiceId: string;
    invoiceNumber: string;
    customerName?: string | null;
    customerPhone?: string | null;
    totalMinor: number;
    earnedLoyaltyPoints?: number;
    shopName: string;
    branchName?: string;
  }
): Promise<SendSmsResult> {
  const config = await getTenantSmsConfig(db, params.tenantId);
  if (!config.autoSendEnabled) {
    return {
      success: false,
      skipped: true,
      status: 'skipped',
      error: 'Automatic SMS sending is disabled in SMS Settings.',
    };
  }

  if (!params.customerPhone || !params.customerPhone.trim()) {
    return {
      success: false,
      skipped: true,
      status: 'skipped',
      error: 'Customer phone number not provided',
    };
  }

  const custName = (params.customerName || 'Valued Customer').trim();
  const storeDisplay = params.branchName && params.branchName !== 'Main Branch' && params.branchName !== params.shopName
    ? `${params.shopName} (${params.branchName})`
    : params.shopName;
  const amountStr = (params.totalMinor / 100).toFixed(2);
  const points = Math.max(0, params.earnedLoyaltyPoints || 0);

  // Exact DLT template requirement:
  // "Thank you, [Customer Name], for shopping at [Shop Name]. Bill No: [Invoice No]. Amount: Rs.[Amount]. Loyalty Points Earned: [Points]. Visit again!"
  const text = `Thank you, ${custName}, for shopping at ${storeDisplay}. Bill No: ${params.invoiceNumber}. Amount: Rs.${amountStr}. Loyalty Points Earned: ${points}. Visit again!`;

  return sendSms(db, {
    tenantId: params.tenantId,
    branchId: params.branchId,
    customerId: params.customerId || undefined,
    invoiceId: params.invoiceId,
    customerName: custName,
    mobileNumber: params.customerPhone,
    messageText: text,
    templateVars: {
      name: custName,
      shop: storeDisplay,
      bill_no: params.invoiceNumber,
      amount: amountStr,
      points: String(points),
    },
    creditType: 'trial',
  });
}
