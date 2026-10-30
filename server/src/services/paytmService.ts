import crypto from 'node:crypto';

/**
 * Paytm Merchant Payment Gateway & Dynamic UPI QR Service.
 * Implements Paytm All-in-One QR generation, checksum signing, and status checking.
 */

export interface PaytmCredentials {
  mid: string;
  merchantKey: string;
  website?: string;
  mode?: 'test' | 'live';
}

export interface CreatePaytmQrParams {
  mid: string;
  merchantKey: string;
  orderId: string;
  amountMinor: number;
  merchantName: string;
  mode?: 'test' | 'live';
  notes?: Record<string, string>;
}

export interface PaytmQrResult {
  id: string;
  qrPayload: string;
  qrImageUrl?: string;
  status: string;
}

export interface PaytmOrderStatusResult {
  orderId: string;
  txnId?: string;
  status: 'pending' | 'paid' | 'failed';
  amountMinor?: number;
  responseMessage?: string;
}

// Test hook
type PaytmApiHandler = (url: string, options: RequestInit) => Promise<Response>;
let customPaytmFetch: PaytmApiHandler | null = null;

export function setPaytmFetchForTest(fn: PaytmApiHandler | null) {
  customPaytmFetch = fn;
}

function getPaytmHost(mode: 'test' | 'live' = 'test'): string {
  return mode === 'live' ? 'https://securegw.paytm.in' : 'https://securegw-stage.paytm.in';
}

/**
 * Generates Paytm HMAC-SHA256 signature for API requests.
 */
export function generatePaytmChecksum(bodyString: string, merchantKey: string): string {
  return crypto.createHmac('sha256', merchantKey.trim()).update(bodyString).digest('base64');
}

/**
 * Validates a Paytm callback signature.
 */
export function verifyPaytmSignature(bodyString: string, signature: string, merchantKey: string): boolean {
  try {
    const expected = generatePaytmChecksum(bodyString, merchantKey);
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Validates Paytm credentials by testing with the status check endpoint.
 */
export async function validatePaytmCredentials(creds: PaytmCredentials): Promise<{ valid: boolean; error?: string }> {
  if (!creds.mid || !creds.merchantKey) {
    return { valid: false, error: 'Paytm MID and Merchant Key are required.' };
  }

  const host = getPaytmHost(creds.mode || 'test');
  const body = JSON.stringify({
    mid: creds.mid.trim(),
    orderId: `PING_${Date.now()}`,
  });
  const signature = generatePaytmChecksum(body, creds.merchantKey);

  try {
    const fetchFn = customPaytmFetch || fetch;
    const res = await fetchFn(`${host}/v3/order/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        head: { signature, version: 'v1' },
        body: JSON.parse(body),
      }),
    });

    const data = await res.json().catch(() => ({}));
    const resultInfo = data?.body?.resultInfo;

    // A valid MID returns 200 with resultStatus (e.g. TXN_FAILURE with 'Order does not exist', which proves auth succeeded)
    if (resultInfo?.resultStatus === 'TXN_FAILURE' && resultInfo?.resultMsg?.toLowerCase().includes('order')) {
      return { valid: true };
    }
    if (resultInfo?.resultStatus === 'FAILURE' || !res.ok) {
      return { valid: false, error: resultInfo?.resultMsg || `Paytm authentication failed (${res.status}).` };
    }
    if (res.ok && (resultInfo?.resultStatus === 'TXN_SUCCESS' || !resultInfo?.resultCode?.includes('AUTHENTICATION'))) {
      return { valid: true };
    }

    if (resultInfo?.resultMsg?.toLowerCase().includes('checksum') || resultInfo?.resultMsg?.toLowerCase().includes('auth')) {
      return { valid: false, error: resultInfo?.resultMsg || 'Invalid Paytm Merchant Key or MID.' };
    }

    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: `Paytm connection failed: ${err.message || 'Network error'}` };
  }
}

/**
 * Creates an amount-locked Dynamic UPI QR code via Paytm All-in-One API.
 */
export async function createPaytmQr(params: CreatePaytmQrParams): Promise<PaytmQrResult> {
  const host = getPaytmHost(params.mode || 'test');
  const amountStr = (params.amountMinor / 100).toFixed(2);

  const requestBody = {
    mid: params.mid.trim(),
    orderId: params.orderId,
    amount: amountStr,
    businessType: 'UPI_QR_CODE',
    posId: 'POS_TERMINAL',
  };

  const bodyStr = JSON.stringify(requestBody);
  const signature = generatePaytmChecksum(bodyStr, params.merchantKey);

  const fetchFn = customPaytmFetch || fetch;
  const res = await fetchFn(`${host}/paymentservices/qr/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      head: {
        clientId: 'C11',
        version: 'v1',
        signature,
      },
      body: requestBody,
    }),
  });

  const data = await res.json().catch(() => ({}));
  const qrData = data?.body?.qrData;
  const qrCodeId = data?.body?.qrCodeId || params.orderId;

  // Fallback to standard UPI intent QR locked to Paytm MID VPA if QR API returns standard string
  const upiPayload = qrData || `upi://pay?pa=${encodeURIComponent(params.mid.trim() + '@paytm')}&pn=${encodeURIComponent(params.merchantName)}&am=${amountStr}&tr=${encodeURIComponent(params.orderId)}&cu=INR`;

  return {
    id: qrCodeId,
    qrPayload: upiPayload,
    qrImageUrl: data?.body?.image || null,
    status: 'active',
  };
}

/**
 * Checks the status of a Paytm transaction.
 */
export async function fetchPaytmOrderStatus(
  mid: string,
  merchantKey: string,
  orderId: string,
  mode: 'test' | 'live' = 'test'
): Promise<PaytmOrderStatusResult> {
  const host = getPaytmHost(mode);
  const body = JSON.stringify({
    mid: mid.trim(),
    orderId,
  });
  const signature = generatePaytmChecksum(body, merchantKey);

  const fetchFn = customPaytmFetch || fetch;
  const res = await fetchFn(`${host}/v3/order/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      head: { signature, version: 'v1' },
      body: JSON.parse(body),
    }),
  });

  const data = await res.json().catch(() => ({}));
  const bodyData = data?.body || {};
  const status = bodyData.resultInfo?.resultStatus;

  if (status === 'TXN_SUCCESS') {
    return {
      orderId,
      txnId: bodyData.txnId,
      status: 'paid',
      amountMinor: Math.round(parseFloat(bodyData.txnAmount || '0') * 100),
      responseMessage: bodyData.resultInfo?.resultMsg,
    };
  }

  if (status === 'TXN_FAILURE') {
    return {
      orderId,
      txnId: bodyData.txnId,
      status: 'failed',
      responseMessage: bodyData.resultInfo?.resultMsg,
    };
  }

  return {
    orderId,
    status: 'pending',
    responseMessage: bodyData.resultInfo?.resultMsg || 'Waiting for payment',
  };
}
