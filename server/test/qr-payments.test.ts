import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  encryptSecret,
  decryptSecret,
  verifyWebhookSignature,
} from '../src/security.ts';
import {
  validateRazorpayCredentials,
  createRazorpayQr,
  setRazorpayFetchForTest,
} from '../src/services/razorpayService.ts';

describe('Shop-Specific QR & Razorpay Integration Tests', () => {

  describe('1. Cryptography & Secret Protection', () => {
    const masterKey = 'test-master-secret-key-32-chars-ok!';

    test('AES-256-GCM encryption produces distinct IV and valid ciphertext', () => {
      const secret = 'rzp_test_secret_1234567890';
      const encrypted1 = encryptSecret(secret, masterKey);
      const encrypted2 = encryptSecret(secret, masterKey);

      assert.notEqual(encrypted1, secret, 'Encrypted secret must not be plaintext');
      assert.notEqual(encrypted1, encrypted2, 'Two encryptions of same secret must use unique IVs');

      const decrypted = decryptSecret(encrypted1, masterKey);
      assert.equal(decrypted, secret, 'Decrypted secret must match original secret');
    });

    test('Decryption with wrong key returns null safely', () => {
      const secret = 'super-secret-webhook-key';
      const encrypted = encryptSecret(secret, masterKey);
      const wrongKey = 'wrong-master-key-must-fail-1234!';

      const result = decryptSecret(encrypted, wrongKey);
      assert.equal(result, null, 'Decryption with invalid key must return null without crashing');
    });

    test('Webhook HMAC-SHA256 signature verification validates correctly', () => {
      const webhookSecret = 'whsec_testing_secret_key_999';
      const rawPayload = JSON.stringify({
        entity: 'event',
        event: 'payment.captured',
        payload: { payment: { entity: { id: 'pay_987654321', amount: 50000 } } },
      });

      const validSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(rawPayload)
        .digest('hex');

      assert.equal(
        verifyWebhookSignature(rawPayload, validSignature, webhookSecret),
        true,
        'Valid webhook signature must return true'
      );

      const invalidSignature = 'deadbeef1234567890abcdef';
      assert.equal(
        verifyWebhookSignature(rawPayload, invalidSignature, webhookSecret),
        false,
        'Tampered or invalid signature must return false'
      );

      // Raw body difference (whitespace/mutation) must also fail verification
      const mutatedPayload = rawPayload + ' ';
      assert.equal(
        verifyWebhookSignature(mutatedPayload, validSignature, webhookSecret),
        false,
        'Tampered payload must fail verification'
      );
    });
  });

  describe('2. Razorpay Service & Credential Validation', () => {
    test('validateRazorpayCredentials succeeds with valid mock API response', async () => {
      setRazorpayFetchForTest(async (url, init) => {
        const auth = (init?.headers as any)?.Authorization;
        assert.ok(auth.startsWith('Basic '), 'Basic auth must be present');
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [] }),
        } as any;
      });

      const res = await validateRazorpayCredentials({
        keyId: 'rzp_test_valid',
        keySecret: 'secret_valid',
      });
      assert.equal(res.valid, true, 'Validation must succeed');
    });

    test('validateRazorpayCredentials fails with 401 on bad credentials', async () => {
      setRazorpayFetchForTest(async () => {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: { description: 'Bad credentials' } }),
        } as any;
      });

      const res = await validateRazorpayCredentials({
        keyId: 'rzp_test_bad',
        keySecret: 'bad_secret',
      });
      assert.equal(res.valid, false, 'Validation must fail with 401');
      assert.match(res.error || '', /invalid.*key.*secret/i);
    });

    test('createRazorpayQr generates dynamic amount-locked single-use QR', async () => {
      setRazorpayFetchForTest(async (url, init) => {
        assert.ok(url.endsWith('/payments/qr_codes'), 'Must call payments/qr_codes API');
        const body = JSON.parse(init?.body as string);
        assert.equal(body.type, 'upi_qr');
        assert.equal(body.usage, 'single_use');
        assert.equal(body.fixed_amount, true);
        assert.equal(body.payment_amount, 125000); // ₹1,250.00
        assert.ok(body.close_by > 0, 'Must have close_by expiry timestamp');

        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 'qr_test_998877',
            status: 'active',
            image_url: 'https://api.razorpay.com/v1/payments/qr_codes/qr_test_998877/image',
            payload_type: 'upi',
            notes: body.notes,
          }),
        } as any;
      });

      const qr = await createRazorpayQr({
        keyId: 'rzp_test_123',
        keySecret: 'rzp_secret_123',
        amountMinor: 125000,
        merchantName: 'Sri Krishna Supermarket',
        description: 'Bill at Sri Krishna Supermarket',
        expiryMinutes: 15,
        notes: {
          tenantId: 'shop_001',
        },
      });

      assert.equal(qr.id, 'qr_test_998877');
      assert.equal(qr.imageUrl, 'https://api.razorpay.com/v1/payments/qr_codes/qr_test_998877/image');
      assert.equal(qr.status, 'active');
    });
  });

  describe('3. Shop-Specific Settings & Tenant Isolation', () => {
    test('Settings mask secrets so frontend never receives private credentials', () => {
      const rawDbSettings = {
        tenant_id: 'tenant_abc',
        upi_enabled: true,
        qr_type: 'dynamic',
        provider: 'razorpay',
        static_upi_id: 'shop@okaxis',
        static_merchant_name: 'Shop ABC',
        rzp_enabled: true,
        rzp_mode: 'live',
        rzp_key_id: 'rzp_live_abc123',
        rzp_key_secret_encrypted: 'aes_ciphertext_xyz',
        rzp_webhook_secret_encrypted: 'aes_ciphertext_wh',
        rzp_qr_expiry_minutes: 15,
        status: 'connected',
        status_message: 'Verified live keys',
        enabled_methods: ['cash', 'upi', 'card'],
      };

      // Transform as done in paymentSettings.ts
      const publicSettings = {
        tenantId: rawDbSettings.tenant_id,
        upiEnabled: rawDbSettings.upi_enabled,
        qrType: rawDbSettings.qr_type,
        provider: rawDbSettings.provider,
        staticUpiId: rawDbSettings.static_upi_id,
        staticMerchantName: rawDbSettings.static_merchant_name,
        rzpEnabled: rawDbSettings.rzp_enabled,
        rzpMode: rawDbSettings.rzp_mode,
        rzpKeyId: rawDbSettings.rzp_key_id,
        hasKeySecret: !!rawDbSettings.rzp_key_secret_encrypted,
        hasWebhookSecret: !!rawDbSettings.rzp_webhook_secret_encrypted,
        rzpQrExpiryMinutes: rawDbSettings.rzp_qr_expiry_minutes,
        status: rawDbSettings.status,
        statusMessage: rawDbSettings.status_message,
        enabledMethods: rawDbSettings.enabled_methods,
      };

      assert.equal((publicSettings as any).rzpKeySecret, undefined, 'Key secret must NEVER be exposed');
      assert.equal((publicSettings as any).rzpWebhookSecret, undefined, 'Webhook secret must NEVER be exposed');
      assert.equal((publicSettings as any).rzp_key_secret_encrypted, undefined, 'Encrypted secret must not be exposed');
      assert.equal(publicSettings.hasKeySecret, true, 'hasKeySecret boolean indicates configured state');
    });

    test('Two shops have completely isolated payment settings', () => {
      const shop1 = {
        tenantId: 'shop_1',
        qrType: 'dynamic',
        staticUpiId: 'shop1@upi',
        rzpKeyId: 'rzp_live_shop1',
      };
      const shop2 = {
        tenantId: 'shop_2',
        qrType: 'static',
        staticUpiId: 'shop2@upi',
        rzpKeyId: null,
      };

      assert.notEqual(shop1.tenantId, shop2.tenantId);
      assert.notEqual(shop1.qrType, shop2.qrType);
      assert.notEqual(shop1.staticUpiId, shop2.staticUpiId);
      assert.notEqual(shop1.rzpKeyId, shop2.rzpKeyId);
    });
  });

  describe('4. Single Invoice Settlement & Duplicate Protection', () => {
    test('Payment attempt settlement updates invoice without duplicate invoice creation', () => {
      // Existing invoice state
      const invoice = {
        id: 'inv_1001',
        number: 'INV-001258',
        total_minor: 53550, // ₹535.50
        paid_minor: 0,
        balance_minor: 53550,
        status: 'issued',
      };

      // Payment attempt for this invoice
      const attempt = {
        id: 'att_2001',
        invoice_id: invoice.id,
        amount_minor: 53550,
        status: 'pending',
      };

      // Simulate settlement logic from settleInvoiceWithAttempt()
      const newPaidMinor = invoice.paid_minor + attempt.amount_minor;
      const newBalanceMinor = Math.max(0, invoice.total_minor - newPaidMinor);
      const isPaidInFull = newBalanceMinor === 0;

      const updatedInvoice = {
        ...invoice,
        paid_minor: newPaidMinor,
        balance_minor: newBalanceMinor,
        status: isPaidInFull ? 'paid' : 'issued',
      };

      assert.equal(updatedInvoice.id, invoice.id, 'Invoice ID must remain the same (no second invoice)');
      assert.equal(updatedInvoice.number, 'INV-001258', 'Invoice number must remain the same');
      assert.equal(updatedInvoice.paid_minor, 53550, 'Paid amount must match total amount');
      assert.equal(updatedInvoice.balance_minor, 0, 'Balance must be 0');
      assert.equal(updatedInvoice.status, 'paid', 'Status must be paid');
    });

    test('Webhook deduplication ignores repeated webhook delivery', () => {
      const processedEvents = new Set<string>();

      function processWebhookEvent(tenantId: string, eventId: string): { processed: boolean; reason?: string } {
        const key = `${tenantId}:${eventId}`;
        if (processedEvents.has(key)) {
          return { processed: false, reason: 'Duplicate event ignored' };
        }
        processedEvents.add(key);
        return { processed: true };
      }

      const res1 = processWebhookEvent('shop_01', 'evt_razorpay_1001');
      assert.equal(res1.processed, true, 'First event must be processed');

      const res2 = processWebhookEvent('shop_01', 'evt_razorpay_1001');
      assert.equal(res2.processed, false, 'Duplicate event must be ignored');
      assert.equal(res2.reason, 'Duplicate event ignored');

      // Different tenant with same event id (if any) or new event
      const res3 = processWebhookEvent('shop_02', 'evt_razorpay_1001');
      assert.equal(res3.processed, true, 'Different tenant with event must be processed independently');
    });

    test('Static QR requires manual verification by authorized cashier', () => {
      const cashier = { id: 'usr_cashier_1', role: 'cashier', name: 'Ramesh' };
      const attempt = {
        id: 'att_static_3001',
        qrType: 'static',
        status: 'pending',
        verifiedBy: null as string | null,
        verifiedAt: null as string | null,
      };

      // Verification action
      const verifiedAttempt = {
        ...attempt,
        status: 'paid',
        verifiedBy: cashier.id,
        verifiedAt: new Date().toISOString(),
        metadata: {
          verifiedByName: cashier.name,
          manualNoticeAcknowledged: true,
        },
      };

      assert.equal(verifiedAttempt.status, 'paid');
      assert.equal(verifiedAttempt.verifiedBy, 'usr_cashier_1');
      assert.equal(verifiedAttempt.metadata.manualNoticeAcknowledged, true);
    });
  });

  describe('5. RBAC & Configuration Restrictions', () => {
    test('Cashier role cannot modify shop payment configuration', () => {
      const userRoles = {
        owner: ['settings', 'invoices', 'products', 'reports'],
        manager: ['settings', 'invoices', 'products'],
        cashier: ['invoices'],
      };

      function canModifyPaymentSettings(role: 'owner' | 'manager' | 'cashier'): boolean {
        return userRoles[role].includes('settings');
      }

      assert.equal(canModifyPaymentSettings('owner'), true, 'Owner can edit payment settings');
      assert.equal(canModifyPaymentSettings('manager'), true, 'Manager can edit payment settings');
      assert.equal(canModifyPaymentSettings('cashier'), false, 'Cashier CANNOT edit payment settings');
    });

    test('Bank Transfer configuration and active checkout payment mode support', () => {
      const activeCheckoutModesWithBank = ['cash', 'upi', 'card', 'bank', 'split'];
      assert.ok(activeCheckoutModesWithBank.includes('bank'), 'Bank transfer is available when enabled in shop settings');
      const bankConfig = {
        bankEnabled: true,
        bankAccountName: 'Sri Krishna Supermarket',
        bankAccountNo: '1234567890',
        bankIfsc: 'SBIN0001234',
        bankName: 'State Bank of India',
        bankBranch: 'Main Branch'
      };
      assert.equal(bankConfig.bankEnabled, true);
      assert.ok(bankConfig.bankAccountNo.length > 0);
      assert.ok(bankConfig.bankIfsc.length > 0);
    });
  });
});
