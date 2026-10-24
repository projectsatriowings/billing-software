import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, whatsappLink, billMessage } from '../whatsapp.ts';

// Helper matching client validation
function validateIndianPhone(raw: string): { valid: boolean; normalized: string | null } {
  if (!raw || !raw.trim()) return { valid: false, normalized: null };
  let cleaned = raw.trim();
  if (cleaned.startsWith('+')) {
    cleaned = '+' + cleaned.replace(/\D/g, '');
  } else {
    cleaned = cleaned.replace(/\D/g, '');
  }
  const norm = normalizePhone(cleaned);
  if (norm && norm.length === 12 && norm.startsWith('91')) {
    return { valid: true, normalized: norm };
  }
  return { valid: false, normalized: null };
}

function buildTestMessage(opts: {
  shopName: string;
  number: string;
  totalMinor: number;
  balanceMinor: number;
  url?: string;
  lang: 'en' | 'hi' | 'ta';
  includeLink?: boolean;
}): string {
  let msg = billMessage({
    shopName: opts.shopName,
    number: opts.number,
    totalMinor: opts.totalMinor,
    balanceMinor: opts.balanceMinor,
    url: (opts.includeLink && opts.url) ? opts.url : '',
    lang: opts.lang,
    kind: 'sale',
  });
  if (!opts.includeLink || !opts.url) {
    msg = msg.replace(/\n(View \/ download|बिल देखें \/ डाउनलोड करें|பில்லைப் பார்க்க \/ பதிவிறக்க):\s*$/m, '').trim();
  }
  return msg;
}

test('WhatsApp Phone Rules (Section 6 table)', () => {
  // 1. "98765 43210" -> +91 98765 43210 -> wa.me/919876543210 (Valid)
  const c1 = validateIndianPhone('98765 43210');
  assert.equal(c1.valid, true);
  assert.equal(c1.normalized, '919876543210');
  assert.equal(whatsappLink(c1.normalized!, 'hi'), 'https://wa.me/919876543210?text=hi');

  // 2. "+91 98765 43210" -> wa.me/919876543210 (Valid)
  const c2 = validateIndianPhone('+91 98765 43210');
  assert.equal(c2.valid, true);
  assert.equal(c2.normalized, '919876543210');

  // 3. "098765 43210" -> Leading 0 stripped -> wa.me/919876543210 (Valid)
  const c3 = validateIndianPhone('098765 43210');
  assert.equal(c3.valid, true);
  assert.equal(c3.normalized, '919876543210');

  // 4. "919876543210" -> wa.me/919876543210 (Valid)
  const c4 = validateIndianPhone('919876543210');
  assert.equal(c4.valid, true);
  assert.equal(c4.normalized, '919876543210');

  // 5. "98765" (landline / short) -> Invalid
  const c5 = validateIndianPhone('98765');
  assert.equal(c5.valid, false);
  assert.equal(c5.normalized, null);

  // 6. "abcdefghij" (non-numeric) -> Invalid
  const c6 = validateIndianPhone('abcdefghij');
  assert.equal(c6.valid, false);
  assert.equal(c6.normalized, null);
});

test('WhatsApp Templates - English, Hindi, Tamil placeholders & no raw tags', () => {
  const shopName = 'Sri Kumaran Stores';
  const number = 'SKM-1001';
  const totalMinor = 124000; // ₹1,240.00
  const balanceMinor = 0; // Fully paid

  // English
  const en = buildTestMessage({ shopName, number, totalMinor, balanceMinor, lang: 'en', includeLink: false });
  assert.ok(en.includes('Sri Kumaran Stores'));
  assert.ok(en.includes('SKM-1001'));
  assert.ok(en.includes('₹1,240.00'));
  assert.ok(!en.includes('Balance due'), 'Fully paid bill must omit balance line');
  assert.ok(!en.includes('View / download'), 'Link disabled must omit link line');
  assert.ok(!en.includes('{'), 'No unreplaced template placeholders');

  // Hindi
  const hi = buildTestMessage({ shopName, number, totalMinor, balanceMinor, lang: 'hi', includeLink: false });
  assert.ok(hi.includes('Sri Kumaran Stores'));
  assert.ok(hi.includes('SKM-1001'));
  assert.ok(hi.includes('₹1,240.00'));
  assert.ok(!hi.includes('बकाया'), 'Fully paid bill must omit balance line');
  assert.ok(!hi.includes('{'), 'No unreplaced template placeholders');

  // Tamil
  const ta = buildTestMessage({ shopName, number, totalMinor, balanceMinor, lang: 'ta', includeLink: false });
  assert.ok(ta.includes('Sri Kumaran Stores'));
  assert.ok(ta.includes('SKM-1001'));
  assert.ok(ta.includes('₹1,240.00'));
  assert.ok(!ta.includes('நிலுவை'), 'Fully paid bill must omit balance line');
  assert.ok(!ta.includes('{'), 'No unreplaced template placeholders');
});

test('WhatsApp Templates - Part-paid bill includes balance line', () => {
  const shopName = 'Metro Mart';
  const number = 'INV-5002';
  const totalMinor = 150000; // ₹1,500.00
  const balanceMinor = 50000; // ₹500.00 balance

  // English
  const en = buildTestMessage({ shopName, number, totalMinor, balanceMinor, lang: 'en', includeLink: false });
  assert.ok(en.includes('Balance due: ₹500.00'));

  // Hindi
  const hi = buildTestMessage({ shopName, number, totalMinor, balanceMinor, lang: 'hi', includeLink: false });
  assert.ok(hi.includes('बकाया ₹500.00'));

  // Tamil
  const ta = buildTestMessage({ shopName, number, totalMinor, balanceMinor, lang: 'ta', includeLink: false });
  assert.ok(ta.includes('நிலுவை ₹500.00'));
});

test('WhatsApp Templates - Hosted bill link included when enabled', () => {
  const shopName = 'Sri Kumaran Stores';
  const number = 'SKM-1001';
  const totalMinor = 124000;
  const balanceMinor = 0;
  const url = 'https://billing.example.com/b/tok_test123';

  // English with link
  const en = buildTestMessage({ shopName, number, totalMinor, balanceMinor, url, lang: 'en', includeLink: true });
  assert.ok(en.includes('View / download: https://billing.example.com/b/tok_test123'));

  // Hindi with link
  const hi = buildTestMessage({ shopName, number, totalMinor, balanceMinor, url, lang: 'hi', includeLink: true });
  assert.ok(hi.includes('बिल देखें / डाउनलोड करें: https://billing.example.com/b/tok_test123'));

  // Tamil with link
  const ta = buildTestMessage({ shopName, number, totalMinor, balanceMinor, url, lang: 'ta', includeLink: true });
  assert.ok(ta.includes('பில்லைப் பார்க்க / பதிவிறக்க: https://billing.example.com/b/tok_test123'));
});
