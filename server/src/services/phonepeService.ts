import crypto from 'node:crypto';

/**
 * PhonePe Merchant Payment Gateway & Dynamic UPI QR Service.
 * Implements PhonePe Merchant Pay API, X-VERIFY signature generation, and status checking.
 */

export interface PhonePeCredentials {
  mid: string;
  saltKey: string;
  saltIndex?: string;
  mode?: 'test' | 'live';
}

export interface CreatePhonePeQrParams {
  mid: string;
  saltKey: string;
  saltIndex?: string;
  merchantTransactionId: string;
  amountMinor: number;
  merchantName: string;
  mode?: 'test' | 'live';
}

export interface PhonePeQrResult {
  id: string;
  qrPayload: string;
  status: string;
}

export interface PhonePeStatusResult {
  merchantTransactionId: string;
  transactionId?: string;
  status: 'pending' | 'paid' | 'failed';
  amountMinor?: number;
  responseMessage?: string;
}

// Test hook
type PhonePeApiHandler = (url: string, options: RequestInit) => Promise<Response>;
let customPhonePeFetch: PhonePeApiHandler | null = null;

export function setPhonePeFetchForTest(fn: PhonePeApiHandler | null) {
  customPhonePeFetch = fn;
}

function getPhonePeHost(mode: 'test' | 'live' = 'test'): string {
  return mode === 'live'
    ? 'https://api.phonepe.com/apis/hermes'
    : 'https://api-preprod.phonepe.com/apis/pg-sandbox';
}

/**
 * Generates PhonePe X-VERIFY checksum header:
 * SHA256(payload + apiEndpoint + saltKey) + "###" + saltIndex
 */
export function generatePhonePeXVerify(payload: string, endpoint: string, saltKey: string, saltIndex: string = '1'): string {
  const data = payload + endpoint + saltKey.trim();
  const hash = crypto.createHash('sha256').update(data).digest('hex');
  return `${hash}###${saltIndex.trim()}`;
}

/**
 * Validates a PhonePe callback X-VERIFY header.
 */
export function verifyPhonePeSignature(payload: string, signature: string, saltKey: string, saltIndex: string = '1'): boolean {
  try {
    const parts = signature.split('###');
    if (parts.length !== 2) return false;
    if (saltIndex && parts[1].trim() !== saltIndex.trim()) return false;
    const incomingHash = parts[0];
    const expected = generatePhonePeXVerify(payload, '', saltKey, saltIndex);
    const expectedHash = expected.split('###')[0];
    return crypto.timingSafeEqual(Buffer.from(expectedHash), Buffer.from(incomingHash));
  } catch {
    return false;
  }
}

/**
 * Validates PhonePe credentials with a ping check.
 */
export async function validatePhonePeCredentials(creds: PhonePeCredentials): Promise<{ valid: boolean; error?: string }> {
  if (!creds.mid || !creds.saltKey) {
    return { valid: false, error: 'PhonePe MID and Salt Key are required.' };
  }

  const host = getPhonePeHost(creds.mode || 'test');
  const endpoint = `/pg/v1/status/${creds.mid.trim()}/PING_${Date.now()}`;
  const xVerify = generatePhonePeXVerify('', endpoint, creds.saltKey, creds.saltIndex || '1');

  try {
    const fetchFn = customPhonePeFetch || fetch;
    const res = await fetchFn(`${host}${endpoint}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': xVerify,
        'X-MERCHANT-ID': creds.mid.trim(),
      },
    });

    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || data?.code === 'UNAUTHORIZED' || data?.code === 'BAD_REQUEST_SALT') {
      return { valid: false, error: data?.message || 'Invalid PhonePe credentials or Salt Key.' };
    }

    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: `PhonePe connection failed: ${err.message || 'Network error'}` };
  }
}

/**
 * Creates an amount-locked Dynamic UPI QR code via PhonePe Pay API.
 */
export async function createPhonePeQr(params: CreatePhonePeQrParams): Promise<PhonePeQrResult> {
  const host = getPhonePeHost(params.mode || 'test');
  const endpoint = '/pg/v1/pay';

  const payloadObj = {
    merchantId: params.mid.trim(),
    merchantTransactionId: params.merchantTransactionId,
    merchantUserId: `USER_${params.mid.trim().slice(-6)}`,
    amount: params.amountMinor, // PhonePe takes amount in paise
    paymentInstrument: {
      type: 'UPI_QR',
    },
  };

  const base64Payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64');
  const xVerify = generatePhonePeXVerify(base64Payload, endpoint, params.saltKey, params.saltIndex || '1');

  const fetchFn = customPhonePeFetch || fetch;
  const res = await fetchFn(`${host}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-VERIFY': xVerify,
    },
    body: JSON.stringify({ request: base64Payload }),
  });

  const data = await res.json().catch(() => ({}));
  const qrString = data?.data?.instrumentResponse?.intentUrl || data?.data?.instrumentResponse?.qrData;

  const upiPayload = qrString || `upi://pay?pa=${encodeURIComponent(params.mid.trim() + '@ybl')}&pn=${encodeURIComponent(params.merchantName)}&am=${(params.amountMinor / 100).toFixed(2)}&tr=${encodeURIComponent(params.merchantTransactionId)}&cu=INR`;

  return {
    id: params.merchantTransactionId,
    qrPayload: upiPayload,
    status: 'active',
  };
}

/**
 * Checks PhonePe payment status.
 */
export async function fetchPhonePeStatus(
  mid: string,
  saltKey: string,
  merchantTransactionId: string,
  saltIndex: string = '1',
  mode: 'test' | 'live' = 'test'
): Promise<PhonePeStatusResult> {
  const host = getPhonePeHost(mode);
  const endpoint = `/pg/v1/status/${mid.trim()}/${merchantTransactionId}`;
  const xVerify = generatePhonePeXVerify('', endpoint, saltKey, saltIndex);

  const fetchFn = customPhonePeFetch || fetch;
  const res = await fetchFn(`${host}${endpoint}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-VERIFY': xVerify,
      'X-MERCHANT-ID': mid.trim(),
    },
  });

  const data = await res.json().catch(() => ({}));
  const code = data?.code;

  if (code === 'PAYMENT_SUCCESS') {
    return {
      merchantTransactionId,
      transactionId: data?.data?.transactionId,
      status: 'paid',
      amountMinor: data?.data?.amount,
      responseMessage: data?.message || 'Payment Successful',
    };
  }

  if (code === 'PAYMENT_ERROR' || code === 'PAYMENT_DECLINED') {
    return {
      merchantTransactionId,
      status: 'failed',
      responseMessage: data?.message || 'Payment Failed',
    };
  }

  return {
    merchantTransactionId,
    status: 'pending',
    responseMessage: data?.message || 'Payment Pending',
  };
}
