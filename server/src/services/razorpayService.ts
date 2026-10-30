/**
 * Razorpay Integration Service for UPI QR Codes and Payment Verification.
 * Communicates directly with official Razorpay REST APIs using native fetch.
 */

export interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
}

export interface CreateQrParams {
  keyId: string;
  keySecret: string;
  amountMinor: number;
  merchantName: string;
  description: string;
  expiryMinutes?: number;
  notes?: Record<string, string>;
}

export interface RazorpayQrResult {
  id: string;
  imageUrl?: string;
  qrPayload: string;
  status: string;
  closeBy?: number;
}

export interface VerifyQrResult {
  qrId: string;
  status: 'active' | 'closed' | 'expired';
  paymentsCount: number;
  payments: Array<{
    id: string;
    amount: number;
    status: string;
    method: string;
    vpa?: string;
  }>;
}

// Optional mock handler for automated isolated testing
type RazorpayApiHandler = (url: string, options: RequestInit) => Promise<Response>;
let customFetch: RazorpayApiHandler | null = null;

export function setRazorpayFetchForTest(fn: RazorpayApiHandler | null) {
  customFetch = fn;
}

function getAuthHeader(keyId: string, keySecret: string): string {
  const token = Buffer.from(`${keyId.trim()}:${keySecret.trim()}`).toString('base64');
  return `Basic ${token}`;
}

async function doFetch(url: string, options: RequestInit): Promise<Response> {
  if (customFetch) {
    return customFetch(url, options);
  }
  return fetch(url, options);
}

/**
 * Validates Razorpay credentials by calling the authenticated /v1/payments endpoint.
 * Returns true if the key ID and Secret authenticate successfully.
 */
export async function validateRazorpayCredentials(creds: RazorpayCredentials): Promise<{ valid: boolean; error?: string }> {
  if (!creds.keyId || !creds.keySecret) {
    return { valid: false, error: 'Key ID and Key Secret are required.' };
  }
  if (!creds.keyId.startsWith('rzp_test_') && !creds.keyId.startsWith('rzp_live_')) {
    return { valid: false, error: 'Key ID must start with rzp_test_ or rzp_live_' };
  }

  try {
    const res = await doFetch('https://api.razorpay.com/v1/payments?count=1', {
      method: 'GET',
      headers: {
        Authorization: getAuthHeader(creds.keyId, creds.keySecret),
        'User-Agent': 'AdaptiveBilling-POS/1.0',
      },
    });

    if (res.status === 200) {
      return { valid: true };
    }

    if (res.status === 401) {
      return { valid: false, error: 'Invalid Razorpay Key ID or Key Secret.' };
    }

    const errBody = await res.json().catch(() => ({}));
    return {
      valid: false,
      error: errBody?.error?.description || `Razorpay validation returned status ${res.status}`,
    };
  } catch (err: any) {
    return { valid: false, error: `Connection to Razorpay failed: ${err.message || 'Network error'}` };
  }
}

/**
 * Creates a unique dynamic UPI QR code on Razorpay for an invoice / payment attempt.
 */
export async function createRazorpayQr(params: CreateQrParams): Promise<RazorpayQrResult> {
  const body: Record<string, unknown> = {
    type: 'upi_qr',
    name: params.merchantName.slice(0, 40),
    usage: 'single_use',
    fixed_amount: true,
    payment_amount: params.amountMinor, // amount in paise
    description: params.description.slice(0, 30),
    notes: params.notes || {},
  };

  if (params.expiryMinutes && params.expiryMinutes > 0) {
    const closeByUnix = Math.floor(Date.now() / 1000) + params.expiryMinutes * 60;
    body.close_by = closeByUnix;
  }

  const res = await doFetch('https://api.razorpay.com/v1/payments/qr_codes', {
    method: 'POST',
    headers: {
      Authorization: getAuthHeader(params.keyId, params.keySecret),
      'Content-Type': 'application/json',
      'User-Agent': 'AdaptiveBilling-POS/1.0',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const msg = errBody?.error?.description || `Razorpay QR creation failed with status ${res.status}`;
    throw new Error(msg);
  }

  const data = await res.json();
  const qrPayload = data.qr_payload || data.image_content || `upi://pay?pa=merchant@razorpay&pn=${encodeURIComponent(params.merchantName)}&am=${(params.amountMinor / 100).toFixed(2)}&cu=INR`;

  return {
    id: data.id,
    imageUrl: data.image_url,
    qrPayload,
    status: data.status || 'active',
    closeBy: data.close_by,
  };
}

/**
 * Fetches the status of a dynamic QR code and any associated payments.
 */
export async function fetchRazorpayQrStatus(creds: RazorpayCredentials, qrId: string): Promise<VerifyQrResult> {
  const res = await doFetch(`https://api.razorpay.com/v1/payments/qr_codes/${encodeURIComponent(qrId)}`, {
    method: 'GET',
    headers: {
      Authorization: getAuthHeader(creds.keyId, creds.keySecret),
      'User-Agent': 'AdaptiveBilling-POS/1.0',
    },
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody?.error?.description || `Failed to fetch QR status (${res.status})`);
  }

  const data = await res.json();
  const payments = Array.isArray(data.payments) ? data.payments : [];

  return {
    qrId: data.id,
    status: data.status,
    paymentsCount: Number(data.payments_amount_received ? 1 : payments.length),
    payments: payments.map((p: any) => ({
      id: p.id,
      amount: Number(p.amount),
      status: p.status,
      method: p.method,
      vpa: p.vpa,
    })),
  };
}

