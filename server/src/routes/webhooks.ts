import { bad, forbidden, notFound, type Router } from '../http.ts';
import { decryptSecret, verifyWebhookSignature, newId } from '../security.ts';
import { verifyPaytmSignature } from '../services/paytmService.ts';
import { verifyPhonePeSignature } from '../services/phonepeService.ts';
import { env } from '../env.ts';
import { settleInvoiceWithAttempt } from './qrPayments.ts';
import { j } from '../db/index.ts';

const MASTER_KEY = env.jwtSecret || 'adaptive-billing-payment-master-secret-32-chars';

export function registerWebhooks(r: Router) {
  // 1. Razorpay Webhook Receiver
  r.post('/api/webhooks/razorpay/:tenantId', async (ctx) => {
    const tenantId = ctx.params.tenantId;
    if (!tenantId) throw bad('Missing tenant identifier.');

    const settings = await ctx.db.one('SELECT * FROM shop_payment_settings WHERE tenant_id = ?', [tenantId]);
    if (!settings) throw notFound('Tenant payment settings');

    const webhookSecretEnc = settings.rzpWebhookSecretEncrypted || settings.rzp_webhook_secret_encrypted;
    const webhookSecret = decryptSecret(webhookSecretEnc, MASTER_KEY);
    if (!webhookSecret) {
      throw forbidden('Webhook secret not configured for this tenant.');
    }

    const signature = ctx.req.headers['x-razorpay-signature'] as string | undefined;
    const rawBody = ctx.raw ? ctx.raw.toString('utf8') : JSON.stringify(ctx.body || {});
    const isValid = verifyWebhookSignature(rawBody, signature, webhookSecret);
    if (!isValid) {
      throw forbidden('Invalid Razorpay webhook signature.');
    }

    const event = ctx.body ?? {};
    const eventId = event.event_id || event.id || `evt_${Date.now()}`;
    const eventType = event.event || 'unknown';

    // Idempotency: Prevent duplicate webhook processing
    const alreadyProcessed = await ctx.db.one(
      'SELECT id FROM payment_webhook_events WHERE tenant_id = ? AND event_id = ?',
      [tenantId, eventId]
    );
    if (alreadyProcessed) {
      return { status: 'ok', deduplicated: true };
    }

    await ctx.db.exec(
      `INSERT INTO payment_webhook_events (id, tenant_id, event_id, event_type, payload)
       VALUES (?, ?, ?, ?, ?)`,
      [newId('pwe'), tenantId, eventId, eventType, j(event)]
    );

    const payload = event.payload || {};
    let providerQrId: string | undefined;
    let providerPaymentId: string | undefined;
    let paymentStatus: string | undefined;
    let amountPaid: number | undefined;

    if (payload.payment?.entity) {
      const p = payload.payment.entity;
      providerPaymentId = p.id;
      paymentStatus = p.status;
      amountPaid = p.amount;
      if (p.notes?.qr_id) providerQrId = p.notes.qr_id;
    } else if (payload.qr_code?.entity) {
      const q = payload.qr_code.entity;
      providerQrId = q.id;
      if (q.status === 'closed') paymentStatus = 'captured';
    }

    if (eventType === 'payment.captured' || paymentStatus === 'captured' || paymentStatus === 'authorized') {
      let attempt = null;
      if (providerQrId) {
        attempt = await ctx.db.one(
          'SELECT * FROM payment_attempts WHERE tenant_id = ? AND provider_qr_id = ?',
          [tenantId, providerQrId]
        );
      }
      if (!attempt && providerPaymentId) {
        attempt = await ctx.db.one(
          'SELECT * FROM payment_attempts WHERE tenant_id = ? AND (provider_payment_id = ? OR id = ?)',
          [tenantId, providerPaymentId, providerPaymentId]
        );
      }

      if (attempt && attempt.status !== 'paid') {
        await ctx.db.tx(async (q) => {
          await q.exec(
            `UPDATE payment_attempts
             SET status = 'paid', provider_payment_id = ?, verified_at = now(), updated_at = now()
             WHERE id = ? AND tenant_id = ?`,
            [providerPaymentId || attempt.providerPaymentId, attempt.id, tenantId]
          );

          const invoiceId = attempt.invoiceId || attempt.invoice_id;
          if (invoiceId) {
            await settleInvoiceWithAttempt(
              q,
              invoiceId,
              tenantId,
              Number(attempt.amountMinor ?? attempt.amount_minor),
              providerPaymentId
            );
          }
        });
      }
    }

    return { status: 'ok', processed: true };
  });

  // 2. Paytm Webhook Callback Receiver
  r.post('/api/webhooks/paytm/:tenantId', async (ctx) => {
    const tenantId = ctx.params.tenantId;
    if (!tenantId) throw bad('Missing tenant identifier.');

    const settings = await ctx.db.one('SELECT * FROM shop_payment_settings WHERE tenant_id = ?', [tenantId]);
    if (!settings) throw notFound('Tenant payment settings');

    const mKeyEnc = settings.paytmMerchantKeyEncrypted || settings.paytm_merchant_key_encrypted;
    const merchantKey = decryptSecret(mKeyEnc, MASTER_KEY);
    if (!merchantKey) throw forbidden('Paytm Merchant Key not configured.');

    const body = ctx.body ?? {};
    const checksum = (ctx.req.headers['x-paytm-signature'] as string) || body.CHECKSUMHASH || body.head?.signature || '';
    const bodyStr = ctx.raw ? ctx.raw.toString('utf8') : JSON.stringify(body);

    const eventId = body.ORDERID || body.body?.orderId || `paytm_${Date.now()}`;

    // Deduplication check
    const alreadyProcessed = await ctx.db.one(
      'SELECT id FROM payment_webhook_events WHERE tenant_id = ? AND event_id = ?',
      [tenantId, eventId]
    );
    if (alreadyProcessed) {
      return { status: 'ok', deduplicated: true };
    }

    await ctx.db.exec(
      `INSERT INTO payment_webhook_events (id, tenant_id, event_id, event_type, payload)
       VALUES (?, ?, ?, 'paytm.callback', ?)`,
      [newId('pwe'), tenantId, eventId, j(body)]
    );

    const status = body.STATUS || body.body?.resultInfo?.resultStatus;
    const orderId = body.ORDERID || body.body?.orderId;
    const txnId = body.TXNID || body.body?.txnId;

    if (status === 'TXN_SUCCESS' && orderId) {
      const attempt = await ctx.db.one(
        'SELECT * FROM payment_attempts WHERE tenant_id = ? AND id = ?',
        [tenantId, orderId]
      );

      if (attempt && attempt.status !== 'paid') {
        await ctx.db.tx(async (q) => {
          await q.exec(
            `UPDATE payment_attempts
             SET status = 'paid', provider_payment_id = ?, verified_at = now(), updated_at = now()
             WHERE id = ? AND tenant_id = ?`,
            [txnId || `paytm_${orderId}`, attempt.id, tenantId]
          );

          const invoiceId = attempt.invoiceId || attempt.invoice_id;
          if (invoiceId) {
            await settleInvoiceWithAttempt(
              q,
              invoiceId,
              tenantId,
              Number(attempt.amountMinor ?? attempt.amount_minor),
              txnId
            );
          }
        });
      }
    }

    return { status: 'ok', processed: true };
  });

  // 3. PhonePe Webhook Callback Receiver
  r.post('/api/webhooks/phonepe/:tenantId', async (ctx) => {
    const tenantId = ctx.params.tenantId;
    if (!tenantId) throw bad('Missing tenant identifier.');

    const settings = await ctx.db.one('SELECT * FROM shop_payment_settings WHERE tenant_id = ?', [tenantId]);
    if (!settings) throw notFound('Tenant payment settings');

    const saltEnc = settings.phonepeSaltKeyEncrypted || settings.phonepe_salt_key_encrypted;
    const saltKey = decryptSecret(saltEnc, MASTER_KEY);
    const saltIndex = settings.phonepeSaltIndex || settings.phonepe_salt_index || '1';
    if (!saltKey) throw forbidden('PhonePe Salt Key not configured.');

    const xVerify = ctx.req.headers['x-verify'] as string | undefined;
    const body = ctx.body ?? {};
    const base64Response = body.response || '';

    if (xVerify && base64Response) {
      const isValid = verifyPhonePeSignature(base64Response, xVerify, saltKey, saltIndex);
      if (!isValid) throw forbidden('Invalid PhonePe signature.');
    }

    let decoded: any = {};
    try {
      decoded = JSON.parse(Buffer.from(base64Response, 'base64').toString('utf8'));
    } catch {
      decoded = body;
    }

    const eventId = decoded.data?.merchantTransactionId || `phonepe_${Date.now()}`;

    // Deduplication check
    const alreadyProcessed = await ctx.db.one(
      'SELECT id FROM payment_webhook_events WHERE tenant_id = ? AND event_id = ?',
      [tenantId, eventId]
    );
    if (alreadyProcessed) {
      return { status: 'ok', deduplicated: true };
    }

    await ctx.db.exec(
      `INSERT INTO payment_webhook_events (id, tenant_id, event_id, event_type, payload)
       VALUES (?, ?, ?, 'phonepe.callback', ?)`,
      [newId('pwe'), tenantId, eventId, j(decoded)]
    );

    const isSuccess = decoded.code === 'PAYMENT_SUCCESS';
    const txnId = decoded.data?.transactionId;
    const merchantTxnId = decoded.data?.merchantTransactionId;

    if (isSuccess && merchantTxnId) {
      const attempt = await ctx.db.one(
        'SELECT * FROM payment_attempts WHERE tenant_id = ? AND id = ?',
        [tenantId, merchantTxnId]
      );

      if (attempt && attempt.status !== 'paid') {
        await ctx.db.tx(async (q) => {
          await q.exec(
            `UPDATE payment_attempts
             SET status = 'paid', provider_payment_id = ?, verified_at = now(), updated_at = now()
             WHERE id = ? AND tenant_id = ?`,
            [txnId || `phonepe_${merchantTxnId}`, attempt.id, tenantId]
          );

          const invoiceId = attempt.invoiceId || attempt.invoice_id;
          if (invoiceId) {
            await settleInvoiceWithAttempt(
              q,
              invoiceId,
              tenantId,
              Number(attempt.amountMinor ?? attempt.amount_minor),
              txnId
            );
          }
        });
      }
    }

    return { status: 'ok', processed: true };
  });
}
