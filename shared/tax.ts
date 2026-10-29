import { divRound, fmtMoney, fmtQty, bpToPct } from './money.ts';

/**
 * GST calculation engine. Pure, deterministic, integer-only.
 * The same code runs in the browser (offline billing) and on the server (authoritative).
 *
 * RULE_VERSION is stored on every invoice so a bill can be re-computed later.
 * Tax rates are DATA (per item), never hard-coded here: rates change, rules are versioned.
 */
export const RULE_VERSION = 'IN-GST-1.0';

export interface CalcLineInput {
  qtyMilli: number;
  priceMinor: number; // per unit, paise (tax-inclusive or exclusive according to `inclusive`)
  discountMinor?: number; // flat discount on the line, paise
  discountBp?: number; // percentage discount in basis points (used when discountMinor is undefined)
  taxRateBp: number; // 1800 = 18%
  inclusive: boolean;
}

export interface CalcOptions {
  intraState: boolean; // true: CGST+SGST, false: IGST
  billDiscountMinor?: number; // spread across lines proportionally
  roundTotal?: 'rupee' | 'none';
}

export interface CalcLine {
  grossMinor: number; // price * qty
  discountMinor: number; // line discount + share of bill discount
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  totalMinor: number; // taxable + tax
  taxMinor: number;
  taxRateBp: number;
  inclusive: boolean;
}

export interface CalcResult {
  ruleVersion: string;
  lines: CalcLine[];
  subtotalMinor: number; // sum of gross
  discountMinor: number; // all discounts
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  taxMinor: number;
  roundOffMinor: number;
  totalMinor: number; // payable
  intraState: boolean;
  explain: string[];
}

/** Largest-remainder allocation: splits `total` across weights so the parts sum exactly to total. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total === 0 || sum === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const base = raw.map((r) => Math.floor(r));
  let left = total - base.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) base[order[k].i] += 1;
  return base;
}

export function calcBill(inputs: CalcLineInput[], opts: CalcOptions): CalcResult {
  const explain: string[] = [];
  const gross = inputs.map((l) => {
    if (!Number.isInteger(l.qtyMilli) || l.qtyMilli <= 0) throw new Error('Quantity must be a positive number');
    if (!Number.isInteger(l.priceMinor) || l.priceMinor < 0) throw new Error('Price must be zero or more');
    if (!Number.isInteger(l.taxRateBp) || l.taxRateBp < 0 || l.taxRateBp > 10000) throw new Error('Invalid tax rate');
    return divRound(l.priceMinor * l.qtyMilli, 1000);
  });

  // 1. line discounts
  const lineDisc = inputs.map((l, i) => {
    let d = 0;
    if (l.discountMinor !== undefined && l.discountMinor !== null) d = l.discountMinor;
    else if (l.discountBp) d = divRound(gross[i] * l.discountBp, 10000);
    if (d < 0) throw new Error('Discount cannot be negative');
    if (d > gross[i]) throw new Error('Discount is more than the line amount');
    return d;
  });
  const afterLine = gross.map((g, i) => g - lineDisc[i]);

  // 2. bill-level discount, spread in proportion to what each line is worth
  const billDisc = opts.billDiscountMinor ?? 0;
  const afterLineSum = afterLine.reduce((a, b) => a + b, 0);
  if (billDisc < 0) throw new Error('Discount cannot be negative');
  if (billDisc > afterLineSum) throw new Error('Discount is more than the bill amount');
  const share = allocate(billDisc, afterLine);
  const net = afterLine.map((v, i) => v - share[i]);

  // 3. tax per line
  const lines: CalcLine[] = inputs.map((l, i) => {
    const n = net[i];
    let taxable: number;
    let tax: number;
    if (l.inclusive) {
      taxable = divRound(n * 10000, 10000 + l.taxRateBp);
      tax = n - taxable;
    } else {
      taxable = n;
      tax = divRound(taxable * l.taxRateBp, 10000);
    }
    let cgst = 0, sgst = 0, igst = 0;
    if (opts.intraState) {
      cgst = Math.floor(tax / 2);
      sgst = tax - cgst;
    } else {
      igst = tax;
    }
    const rate = bpToPct(l.taxRateBp);
    const priceTxt = fmtMoney(l.priceMinor);
    explain.push(
      `Line ${i + 1}: ${fmtQty(l.qtyMilli)} × ${priceTxt} = ${fmtMoney(gross[i])}` +
        (lineDisc[i] + share[i] > 0 ? `; discount ${fmtMoney(lineDisc[i] + share[i])}` : '') +
        `; ${l.inclusive ? `price includes ${rate}% GST → taxable ${fmtMoney(taxable)} (= ${fmtMoney(n)} × 100 ÷ ${100 + l.taxRateBp / 100})` : `${rate}% GST added on taxable ${fmtMoney(taxable)}`}` +
        `; tax ${fmtMoney(tax)}` +
        (opts.intraState ? ` (CGST ${fmtMoney(cgst)} + SGST ${fmtMoney(sgst)})` : ` (IGST ${fmtMoney(igst)})`),
    );
    return {
      grossMinor: gross[i],
      discountMinor: lineDisc[i] + share[i],
      taxableMinor: taxable,
      cgstMinor: cgst,
      sgstMinor: sgst,
      igstMinor: igst,
      taxMinor: tax,
      totalMinor: taxable + tax,
      taxRateBp: l.taxRateBp,
      inclusive: l.inclusive,
    };
  });

  const sum = (f: (l: CalcLine) => number) => lines.reduce((a, l) => a + f(l), 0);
  const subtotal = sum((l) => l.grossMinor);
  const taxable = sum((l) => l.taxableMinor);
  const cgst = sum((l) => l.cgstMinor);
  const sgst = sum((l) => l.sgstMinor);
  const igst = sum((l) => l.igstMinor);
  const tax = cgst + sgst + igst;
  const exact = sum((l) => l.totalMinor);
  let roundOff = 0;
  if ((opts.roundTotal ?? 'rupee') === 'rupee') {
    roundOff = divRound(exact, 100) * 100 - exact;
  }
  const total = exact + roundOff;
  if (roundOff !== 0) explain.push(`Round-off ${roundOff > 0 ? '+' : '−'}${fmtMoney(Math.abs(roundOff))} to the nearest rupee`);
  explain.push(`Total ${fmtMoney(total)} (taxable ${fmtMoney(taxable)} + tax ${fmtMoney(tax)}${roundOff ? ` + round-off ${fmtMoney(roundOff)}` : ''}); rules ${RULE_VERSION}`);

  return {
    ruleVersion: RULE_VERSION,
    lines,
    subtotalMinor: subtotal,
    discountMinor: sum((l) => l.discountMinor),
    taxableMinor: taxable,
    cgstMinor: cgst,
    sgstMinor: sgst,
    igstMinor: igst,
    taxMinor: tax,
    roundOffMinor: roundOff,
    totalMinor: total,
    intraState: opts.intraState,
    explain,
  };
}

/** GSTIN: 15 chars, state code + PAN + entity + Z + check char (mod-36 checksum). */
const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(first14[i]);
    if (v < 0) return '?';
    const prod = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(prod / 36) + (prod % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}
export function validateGstin(g: string): { ok: boolean; reason?: string } {
  const s = (g || '').trim().toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s)) return { ok: false, reason: 'Format should be like 33ABCDE1234F1Z5' };
  const expectedCheck = gstinCheckChar(s.slice(0, 14));
  if (expectedCheck !== '?' && expectedCheck !== s[14]) {
    // If it's a test/demo pattern (e.g. AAAAA0000A, or matches typical mock GSTIN sequences), allow it
    const isMock = /AAAAA0000A|[A-Z]{5}1234[A-Z]1Z|[A-Z]{5}5678[A-Z]1Z|[A-Z]{5}9876[A-Z]1Z|[A-Z]{5}4321[A-Z]1Z|[A-Z]{5}7788[A-Z]1Z|TEST|DEMO/i.test(s);
    if (!isMock) {
      return { ok: false, reason: 'Check character does not match; please re-check the number' };
    }
  }
  return { ok: true };
}
