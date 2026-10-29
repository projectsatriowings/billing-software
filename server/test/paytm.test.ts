import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePaytmChecksum,
  verifyPaytmSignature,
  validatePaytmCredentials,
  createPaytmQr,
  fetchPaytmOrderStatus,
  setPaytmFetchForTest,
} from '../src/services/paytmService.ts';
import {
  generatePhonePeXVerify,
  verifyPhonePeSignature,
  validatePhonePeCredentials,
  createPhonePeQr,
  fetchPhonePeStatus,
  setPhonePeFetchForTest,
} from '../src/services/phonepeService.ts';

describe('Paytm & PhonePe Multi-Payment Provider Unit Tests', () => {

  describe('1. Paytm Checksums & Signatures', () => {
    const merchantKey = 'paytm_test_merchant_key_12345';
    const payload = JSON.stringify({ mid: 'TESTMID123', orderId: 'ORD_99999', amount: '125.00' });

    test('generatePaytmChecksum produces consistent hash', () => {
      const checksum1 = generatePaytmChecksum(payload, merchantKey);
      const checksum2 = generatePaytmChecksum(payload, merchantKey);
      assert.ok(checksum1 && checksum1.length > 20, 'Checksum should be non-empty');
      assert.equal(checksum1, checksum2, 'Checksums of identical payload must match');
    });

    test('verifyPaytmSignature verifies authentic payload and rejects tampering', () => {
      const checksum = generatePaytmChecksum(payload, merchantKey);
      assert.equal(verifyPaytmSignature(payload, checksum, merchantKey), true, 'Authentic checksum must verify');

      const tamperedPayload = JSON.stringify({ mid: 'TESTMID123', orderId: 'ORD_99999', amount: '1.00' });
      assert.equal(verifyPaytmSignature(tamperedPayload, checksum, merchantKey), false, 'Tampered payload must fail');
      assert.equal(verifyPaytmSignature(payload, checksum, 'wrong_key'), false, 'Wrong key must fail verification');
    });
  });

  describe('2. PhonePe X-VERIFY Signatures', () => {
    const saltKey = 'phonepe-salt-key-sample-uuid-12345';
    const saltIndex = '1';
    const endpoint = '/pg/v1/status/TESTMID/ORD_88888';
    const body = '';

    test('generatePhonePeXVerify produces valid sha256 + salt checksum', () => {
      const xVerify = generatePhonePeXVerify(body, endpoint, saltKey, saltIndex);
      assert.ok(xVerify.endsWith('###1'), 'X-Verify must end with ###<saltIndex>');
      assert.equal(verifyPhonePeSignature(body + endpoint, xVerify, saltKey, saltIndex), true);
    });

    test('verifyPhonePeSignature rejects invalid signature or mismatched index', () => {
      const xVerify = generatePhonePeXVerify(body, endpoint, saltKey, saltIndex);
      assert.equal(verifyPhonePeSignature(body + endpoint, xVerify, saltKey, '2'), false, 'Mismatched salt index must fail');
      assert.equal(verifyPhonePeSignature(body + endpoint, 'invalid_sig###1', saltKey, saltIndex), false, 'Invalid signature must fail');
    });
  });

  describe('3. Paytm Credential Validation & QR Generation', () => {
    test('validatePaytmCredentials succeeds when gateway responds with success', async () => {
      setPaytmFetchForTest(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          body: {
            resultInfo: { resultStatus: 'SUCCESS', resultCode: '0000', resultMsg: 'Success' },
          },
        }),
      } as any));

      const res = await validatePaytmCredentials({
        mid: 'TEST_MID_001',
        merchantKey: 'TEST_KEY_001',
        mode: 'test',
      });
      assert.equal(res.valid, true);
    });

    test('validatePaytmCredentials returns error when credentials fail', async () => {
      setPaytmFetchForTest(async () => ({
        ok: false,
        status: 401,
        json: async () => ({
          body: {
            resultInfo: { resultStatus: 'FAILURE', resultCode: '2001', resultMsg: 'Invalid Merchant Credentials' },
          },
        }),
      } as any));

      const res = await validatePaytmCredentials({
        mid: 'BAD_MID',
        merchantKey: 'BAD_KEY',
        mode: 'test',
      });
      assert.equal(res.valid, false);
      assert.ok(res.error, 'Error message must be present');
    });

    test('createPaytmQr returns dynamic QR payload and intent URL', async () => {
      setPaytmFetchForTest(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          body: {
            resultInfo: { resultStatus: 'SUCCESS' },
            qrData: 'upi://pay?pa=paytm-test@paytm&pn=TestShop&am=250.00&tr=ORD_12345',
            qrCodeId: 'QR_PTM_001',
          },
        }),
      } as any));

      const qr = await createPaytmQr({
        mid: 'TEST_MID_001',
        merchantKey: 'TEST_KEY_001',
        orderId: 'ORD_12345',
        amountMinor: 25000,
        merchantName: 'Test Shop',
        mode: 'test',
      });

      assert.equal(qr.id, 'QR_PTM_001');
      assert.ok(qr.qrPayload.includes('upi://pay'), 'QR payload must be a UPI URI');
      assert.equal(qr.status, 'active');
    });

    test('fetchPaytmOrderStatus reports correct status', async () => {
      setPaytmFetchForTest(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          body: {
            resultInfo: { resultStatus: 'TXN_SUCCESS' },
            txnId: 'TXN_PTM_998877',
            txnAmount: '250.00',
          },
        }),
      } as any));

      const status = await fetchPaytmOrderStatus(
        'TEST_MID_001',
        'TEST_KEY_001',
        'ORD_12345',
        'test'
      );

      assert.equal(status.status, 'paid');
      assert.equal(status.txnId, 'TXN_PTM_998877');
      assert.equal(status.amountMinor, 25000);
    });
  });

  describe('4. PhonePe Credential Validation & QR Generation', () => {
    test('validatePhonePeCredentials succeeds when status endpoint returns valid response', async () => {
      setPhonePeFetchForTest(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          code: 'PAYMENT_SUCCESS',
          message: 'Status check verified',
        }),
      } as any));

      const res = await validatePhonePeCredentials({
        mid: 'PHONEPE_TEST_MID',
        saltKey: 'phonepe_salt_123456789',
        saltIndex: '1',
        mode: 'test',
      });
      assert.equal(res.valid, true);
    });

    test('createPhonePeQr returns dynamic QR payload and intent string', async () => {
      setPhonePeFetchForTest(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          code: 'SUCCESS',
          data: {
            merchantTransactionId: 'TXN_PHP_123',
            qrString: 'upi://pay?pa=phonepe-merchant@ybl&pn=Shop&am=500.00&tr=TXN_PHP_123',
          },
        }),
      } as any));

      const qr = await createPhonePeQr({
        mid: 'PHONEPE_TEST_MID',
        saltKey: 'phonepe_salt_123456789',
        saltIndex: '1',
        merchantTransactionId: 'ORD_PHP_001',
        amountMinor: 50000,
        merchantName: 'Supermarket',
        mode: 'test',
      });

      assert.equal(qr.id, 'ORD_PHP_001');
      assert.ok(qr.qrPayload.includes('upi://pay'), 'Must return valid UPI intent link');
    });

    test('fetchPhonePeStatus correctly maps PAYMENT_SUCCESS to paid', async () => {
      setPhonePeFetchForTest(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          code: 'PAYMENT_SUCCESS',
          data: {
            transactionId: 'T2610290001',
            amount: 50000,
          },
        }),
      } as any));

      const status = await fetchPhonePeStatus(
        'PHONEPE_TEST_MID',
        'phonepe_salt_123456789',
        'ORD_PHP_001',
        '1',
        'test'
      );

      assert.equal(status.status, 'paid');
      assert.equal(status.transactionId, 'T2610290001');
      assert.equal(status.amountMinor, 50000);
    });
  });
});
