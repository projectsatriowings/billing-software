import { audit } from '../audit.ts';
import { requirePerm, requireUser } from '../auth.ts';
import { bad, forbidden, notFound, V, type Router } from '../http.ts';
import { newId, decryptSecret } from '../security.ts';
import { env } from '../env.ts';
import { qrSvg, upiUri } from '../../../shared/qr.ts';
import { createRazorpayQr, fetchRazorpayQrStatus } from '../services/razorpayService.ts';
import { createPaytmQr, fetchPaytmOrderStatus } from '../services/paytmService.ts';
import { createPhonePeQr, fetchPhonePeStatus } from '../services/phonepeService.ts';
import { j, type Queryable } from '../db/index.ts';

const MASTER_KEY = env.jwtSecret || 'adaptive-billing-payment-master-secret-32-chars';

export function registerQrPayments(r: Router) {
  // 1. Create a payment attempt (Dynamic or Static QR)
  r.post('/api/payment-attempts', requirePerm('sell'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};

    const amountMinor = V.int(b.amountMinor, 'Payment amount (paise)', { min: 1 });
    const invoiceId = V.optStr(b.invoiceId, 'Invoice ID', 50);
    const idempotencyKey = V.optStr(b.idempotencyKey, 'Idempotency key', 100);
    const customerName = V.optStr(b.customerName, 'Customer name', 100);

    // Enforce tenant isolation on linked invoice
    if (invoiceId) {
      const inv = await ctx.db.one('SELECT id, total_minor, paid_minor, balance_minor FROM invoices WHERE id = ? AND tenant_id = ?', [invoiceId, tenantId]);
      if (!inv) throw notFound('Invoice');
      if (amountMinor > Number(inv.balanceMinor ?? inv.balance_minor ?? inv.total_minor)) {
        throw bad('Payment amount exceeds invoice balance.');
      }
    }

    // Idempotency check: if an active attempt exists with this idempotency key, return it
    if (idempotencyKey) {
      const existing = await ctx.db.one('SELECT * FROM payment_attempts WHERE tenant_id = ? AND idempotency_key = ?', [tenantId, idempotencyKey]);
      if (existing && existing.status !== 'cancelled' && existing.status !== 'failed') {
        const isExpired = existing.expiresAt && new Date(existing.expiresAt).getTime() < Date.now();
        if (!isExpired) {
          const payload = existing.qrPayload || existing.qr_payload || '';
          return {
            idempotent: true,
            id: existing.id,
            attemptId: existing.id,
            status: existing.status,
            amountMinor: Number(existing.amountMinor ?? existing.amount_minor),
            qrPayload: payload,
            qrSvg: qrSvg(payload, { size: 220 }),
            qrImageUrl: existing.qrImageUrl ?? existing.qr_image_url ?? null,
            expiresAt: existing.expiresAt ?? existing.expires_at,
            provider: existing.provider,
            qrType: existing.qrType ?? existing.qr_type,
          };
        }
      }
    }

    // Load shop payment settings
    const settings = await ctx.db.one('SELECT * FROM shop_payment_settings WHERE tenant_id = ?', [tenantId]);
    const shop = await ctx.db.one('SELECT name, phone, upi_id FROM tenants WHERE id = ?', [tenantId]);
    if (!shop) throw notFound('Shop');

    const upiEnabled = settings ? Boolean(settings.upiEnabled ?? settings.upi_enabled) : true;
    if (!upiEnabled) {
      throw bad('UPI payments are currently disabled in Store Settings.');
    }

    const qrType: 'static' | 'dynamic' = (settings?.qrType || settings?.qr_type || 'static') as any;
    const provider: 'manual' | 'razorpay' | 'paytm' | 'phonepe' = (settings?.provider || 'manual') as any;
    const merchantName = settings?.staticMerchantName || settings?.static_merchant_name || shop.name || 'Store';

    const attemptId = newId('pa');
    let qrPayload = '';
    let qrImageUrl: string | null = null;
    let providerQrId: string | null = null;
    let expiresAt: string | null = null;

    if (qrType === 'dynamic') {
      if (provider === 'razorpay') {
        const keyId = settings?.rzpKeyId || settings?.rzp_key_id;
        const keySecretEnc = settings?.rzpKeySecretEncrypted || settings?.rzp_key_secret_encrypted;
        const keySecret = decryptSecret(keySecretEnc, MASTER_KEY);

        if (!keyId || !keySecret) {
          throw bad('Razorpay is enabled but Key ID or Secret is missing in Store Settings.');
        }

        const expiryMin = Number(settings?.rzpQrExpiryMinutes || settings?.rzp_qr_expiry_minutes || 10);
        try {
          const rzpQr = await createRazorpayQr({
            keyId,
            keySecret,
            amountMinor,
            merchantName,
            description: invoiceId ? `Bill ${invoiceId}` : `Bill at ${merchantName}`,
            expiryMinutes: expiryMin,
            notes: {
              tenant_id: tenantId,
              attempt_id: attemptId,
              invoice_id: invoiceId || '',
            },
          });

          providerQrId = rzpQr.id;
          qrPayload = rzpQr.qrPayload;
          qrImageUrl = rzpQr.imageUrl || null;
          if (rzpQr.closeBy) {
            expiresAt = new Date(rzpQr.closeBy * 1000).toISOString();
          }
        } catch (err: any) {
          throw bad(`Failed to generate Razorpay Dynamic QR: ${err.message || 'API error'}`);
        }
      } else if (provider === 'paytm') {
        const mid = settings?.paytmMid || settings?.paytm_mid;
        const mKeyEnc = settings?.paytmMerchantKeyEncrypted || settings?.paytm_merchant_key_encrypted;
        const merchantKey = decryptSecret(mKeyEnc, MASTER_KEY);
        const mode = (settings?.paytmMode || settings?.paytm_mode || 'test') as 'test' | 'live';

        if (!mid || !merchantKey) {
          throw bad('Paytm is selected but MID or Merchant Key is missing in Store Settings.');
        }

        try {
          const paytmQr = await createPaytmQr({
            mid,
            merchantKey,
            orderId: attemptId,
            amountMinor,
            merchantName,
            mode,
            notes: { tenant_id: tenantId, invoice_id: invoiceId || '' },
          });

          providerQrId = paytmQr.id;
          qrPayload = paytmQr.qrPayload;
          qrImageUrl = paytmQr.qrImageUrl || null;
          expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        } catch (err: any) {
          throw bad(`Failed to generate Paytm Dynamic QR: ${err.message || 'API error'}`);
        }
      } else if (provider === 'phonepe') {
        const mid = settings?.phonepeMid || settings?.phonepe_mid;
        const saltEnc = settings?.phonepeSaltKeyEncrypted || settings?.phonepe_salt_key_encrypted;
        const saltKey = decryptSecret(saltEnc, MASTER_KEY);
        const saltIndex = settings?.phonepeSaltIndex || settings?.phonepe_salt_index || '1';
        const mode = (settings?.phonepeMode || settings?.phonepe_mode || 'test') as 'test' | 'live';

        if (!mid || !saltKey) {
          throw bad('PhonePe is selected but MID or Salt Key is missing in Store Settings.');
        }

        try {
          const phonepeQr = await createPhonePeQr({
            mid,
            saltKey,
            saltIndex,
            merchantTransactionId: attemptId,
            amountMinor,
            merchantName,
            mode,
          });

          providerQrId = phonepeQr.id;
          qrPayload = phonepeQr.qrPayload;
          expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        } catch (err: any) {
          throw bad(`Failed to generate PhonePe Dynamic QR: ${err.message || 'API error'}`);
        }
      } else {
        // Fallback to static
        const vpa = (settings?.staticUpiId || settings?.static_upi_id || shop.upiId || shop.upi_id || (shop.phone ? `${shop.phone.replace(/\D/g, '').slice(-10)}@upi` : '')).trim();
        if (!vpa) throw bad('No Shop UPI VPA configured in Store Settings.');
        qrPayload = upiUri({
          vpa,
          name: merchantName,
          amountMinor,
          note: invoiceId ? `Bill payment ${invoiceId}` : `Payment to ${merchantName}`,
        });
      }
    } else {
      // Static or manual QR
      const vpa = (settings?.staticUpiId || settings?.static_upi_id || shop.upiId || shop.upi_id || (shop.phone ? `${shop.phone.replace(/\D/g, '').slice(-10)}@upi` : '')).trim();
      if (!vpa) {
        throw bad('No Shop UPI VPA is configured in Store Settings.');
      }
      qrPayload = upiUri({
        vpa,
        name: merchantName,
        amountMinor,
        note: invoiceId ? `Bill payment ${invoiceId}` : `Payment to ${merchantName}`,
      });
    }

    await ctx.db.exec(
      `INSERT INTO payment_attempts (
        id, tenant_id, invoice_id, amount_minor, currency, qr_type, provider,
        provider_qr_id, qr_payload, qr_image_url, status, expires_at, idempotency_key, metadata
      ) VALUES (?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [
        attemptId,
        tenantId,
        invoiceId || null,
        amountMinor,
        qrType,
        provider,
        providerQrId,
        qrPayload,
        qrImageUrl,
        expiresAt,
        idempotencyKey || null,
        j({ customerName }),
      ]
    );

    await audit(ctx.db, ctx, {
      action: 'payment_attempt.create',
      entity: 'payment_attempts',
      entityId: attemptId,
      detail: {
        amountMinor,
        qrType,
        provider,
        invoiceId,
      },
    });

    return {
      id: attemptId,
      attemptId,
      status: 'pending',
      amountMinor,
      qrPayload,
      qrSvg: qrSvg(qrPayload, { size: 220 }),
      qrImageUrl,
      expiresAt,
      provider,
      qrType,
    };
  });

  // 2. Poll payment attempt status
  r.get('/api/payment-attempts/:id/status', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const attempt = await ctx.db.one('SELECT * FROM payment_attempts WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!attempt) throw notFound('Payment attempt');

    // Check expiry
    const isExpired = attempt.status === 'pending' && attempt.expiresAt && new Date(attempt.expiresAt).getTime() < Date.now();
    if (isExpired) {
      await ctx.db.exec('UPDATE payment_attempts SET status = ? WHERE id = ? AND tenant_id = ?', ['expired', attempt.id, tenantId]);
      attempt.status = 'expired';
    }

    return {
      id: attempt.id,
      attemptId: attempt.id,
      status: attempt.status,
      amountMinor: Number(attempt.amountMinor ?? attempt.amount_minor),
      invoiceId: attempt.invoiceId ?? attempt.invoice_id,
      providerPaymentId: attempt.providerPaymentId ?? attempt.provider_payment_id,
      verifiedAt: attempt.verifiedAt ?? attempt.verified_at,
      errorReason: attempt.errorReason ?? attempt.error_reason,
    };
  });

  // 3. Active server-side verify (Razorpay, Paytm, or PhonePe)
  r.post('/api/payment-attempts/:id/verify', requirePerm('sell'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const attempt = await ctx.db.one('SELECT * FROM payment_attempts WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!attempt) throw notFound('Payment attempt');

    if (attempt.status === 'paid') {
      return { status: 'paid', alreadySettled: true, verifiedAt: attempt.verifiedAt ?? attempt.verified_at };
    }

    const settings = await ctx.db.one('SELECT * FROM shop_payment_settings WHERE tenant_id = ?', [tenantId]);
    const provider = attempt.provider;

    let isSuccess = false;
    let providerPaymentId: string | undefined = undefined;

    if (provider === 'razorpay') {
      const keyId = settings?.rzpKeyId || settings?.rzp_key_id;
      const keySecretEnc = settings?.rzpKeySecretEncrypted || settings?.rzp_key_secret_encrypted;
      const keySecret = decryptSecret(keySecretEnc, MASTER_KEY);

      if (!keyId || !keySecret) throw bad('Razorpay credentials not found for this shop.');
      const qrId = attempt.providerQrId || attempt.provider_qr_id;
      const check = await fetchRazorpayQrStatus({ keyId, keySecret }, qrId);

      const successfulPayment = check.payments.find((p) => p.status === 'captured' || p.status === 'authorized');
      if (successfulPayment) {
        isSuccess = true;
        providerPaymentId = successfulPayment.id;
      }
    } else if (provider === 'paytm') {
      const mid = settings?.paytmMid || settings?.paytm_mid;
      const mKeyEnc = settings?.paytmMerchantKeyEncrypted || settings?.paytm_merchant_key_encrypted;
      const merchantKey = decryptSecret(mKeyEnc, MASTER_KEY);
      const mode = (settings?.paytmMode || settings?.paytm_mode || 'test') as 'test' | 'live';

      if (!mid || !merchantKey) throw bad('Paytm credentials not found for this shop.');
      const check = await fetchPaytmOrderStatus(mid, merchantKey, attempt.id, mode);
      if (check.status === 'paid') {
        isSuccess = true;
        providerPaymentId = check.txnId || `paytm_${attempt.id}`;
      }
    } else if (provider === 'phonepe') {
      const mid = settings?.phonepeMid || settings?.phonepe_mid;
      const saltEnc = settings?.phonepeSaltKeyEncrypted || settings?.phonepe_salt_key_encrypted;
      const saltKey = decryptSecret(saltEnc, MASTER_KEY);
      const saltIndex = settings?.phonepeSaltIndex || settings?.phonepe_salt_index || '1';
      const mode = (settings?.phonepeMode || settings?.phonepe_mode || 'test') as 'test' | 'live';

      if (!mid || !saltKey) throw bad('PhonePe credentials not found for this shop.');
      const check = await fetchPhonePeStatus(mid, saltKey, attempt.id, saltIndex, mode);
      if (check.status === 'paid') {
        isSuccess = true;
        providerPaymentId = check.transactionId || `phonepe_${attempt.id}`;
      }
    } else {
      throw bad('Only Dynamic QR providers support automatic server verification.');
    }

    if (!isSuccess) {
      return { status: attempt.status, verified: false, message: `Payment not yet confirmed by ${provider}.` };
    }

    // Atomic settlement inside DB transaction
    await ctx.db.tx(async (q) => {
      const freshAttempt = await q.one('SELECT * FROM payment_attempts WHERE id = ? AND tenant_id = ? FOR UPDATE', [attempt.id, tenantId]);
      if (freshAttempt.status === 'paid') return;

      await q.exec(
        `UPDATE payment_attempts
         SET status = 'paid', provider_payment_id = ?, verified_at = now(), updated_at = now()
         WHERE id = ? AND tenant_id = ?`,
        [providerPaymentId || null, attempt.id, tenantId]
      );

      const invoiceId = freshAttempt.invoiceId || freshAttempt.invoice_id;
      if (invoiceId) {
        await settleInvoiceWithAttempt(q, invoiceId, tenantId, Number(freshAttempt.amountMinor ?? freshAttempt.amount_minor), providerPaymentId);
      }
    });

    await audit(ctx.db, ctx, {
      action: 'payment_attempt.verify_success',
      entity: 'payment_attempts',
      entityId: attempt.id,
      detail: {
        provider,
        providerPaymentId,
        amountMinor: attempt.amountMinor ?? attempt.amount_minor,
      },
    });

    return { status: 'paid', verified: true, providerPaymentId, message: 'Payment verified and settled!' };
  });

  // 4. Manual Cashier Verification (for Static QR, Cash, or Terminal verification)
  r.post('/api/payment-attempts/:id/manual-verify', requirePerm('sell'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const attempt = await ctx.db.one('SELECT * FROM payment_attempts WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!attempt) throw notFound('Payment attempt');

    if (attempt.status === 'paid') {
      return { status: 'paid', alreadySettled: true };
    }

    const b = ctx.body ?? {};
    const referenceNo = V.optStr(b.referenceNo || b.providerPaymentId, 'Reference / UTR number', 100);
    const cashierNotes = V.optStr(b.notes || b.note, 'Cashier verification note', 200);

    await ctx.db.tx(async (q) => {
      await q.exec(
        `UPDATE payment_attempts
         SET status = 'paid', provider_payment_id = ?, verified_at = now(), verified_by = ?,
             metadata = metadata || ?::jsonb, updated_at = now()
         WHERE id = ? AND tenant_id = ?`,
        [
          referenceNo || null,
          ctx.user!.id,
          j({
            manualVerification: true,
            cashierName: ctx.user!.name,
            cashierNotes,
            verifiedAtIso: new Date().toISOString(),
          }),
          attempt.id,
          tenantId,
        ]
      );

      const invoiceId = attempt.invoiceId || attempt.invoice_id;
      if (invoiceId) {
        await settleInvoiceWithAttempt(q, invoiceId, tenantId, Number(attempt.amountMinor ?? attempt.amount_minor), referenceNo ?? undefined);
      }
    });

    await audit(ctx.db, ctx, {
      action: 'payment_attempt.manual_verify',
      entity: 'payment_attempts',
      entityId: attempt.id,
      detail: {
        verifiedBy: ctx.user!.id,
        cashierName: ctx.user!.name,
        referenceNo,
        notes: cashierNotes,
      },
    });

    return { status: 'paid', referenceNo, verifiedByName: ctx.user!.name };
  });

  // 5. Cancel an attempt
  r.post('/api/payment-attempts/:id/cancel', requirePerm('sell'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const attempt = await ctx.db.one('SELECT * FROM payment_attempts WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!attempt) throw notFound('Payment attempt');

    if (attempt.status === 'paid') {
      throw bad('Cannot cancel an already settled payment attempt.');
    }

    await ctx.db.exec('UPDATE payment_attempts SET status = ? WHERE id = ? AND tenant_id = ?', ['cancelled', attempt.id, tenantId]);
    await audit(ctx.db, ctx, {
      action: 'payment_attempt.cancel',
      entity: 'payment_attempts',
      entityId: attempt.id,
      detail: {},
    });
    return { ok: true, status: 'cancelled' };
  });
}

/**
 * Idempotently and safely settles an invoice when a payment succeeds.
 * Never creates a second invoice. Updates paid_minor and balance_minor in-place.
 */
export async function settleInvoiceWithAttempt(
  q: Queryable,
  invoiceId: string,
  tenantId: string,
  amountMinor: number,
  paymentReference?: string
) {
  const inv = await q.one('SELECT id, total_minor, paid_minor, balance_minor FROM invoices WHERE id = ? AND tenant_id = ? FOR UPDATE', [invoiceId, tenantId]);
  if (!inv) return;

  const currentPaid = Number(inv.paidMinor ?? inv.paid_minor ?? 0);
  const currentTotal = Number(inv.totalMinor ?? inv.total_minor ?? 0);

  const newPaid = Math.min(currentTotal, currentPaid + amountMinor);
  const newBalance = Math.max(0, currentTotal - newPaid);

  await q.exec(
    `UPDATE invoices
     SET paid_minor = ?, balance_minor = ?, updated_at = now()
     WHERE id = ? AND tenant_id = ?`,
    [newPaid, newBalance, invoiceId, tenantId]
  );

  const paymentId = newId('pay');
  await q.exec(
    `INSERT INTO payments (id, tenant_id, invoice_id, amount_minor, method, reference, created_at)
     VALUES (?, ?, ?, ?, 'upi', ?, now())`,
    [paymentId, tenantId, invoiceId, amountMinor, paymentReference || null]
  );
}
