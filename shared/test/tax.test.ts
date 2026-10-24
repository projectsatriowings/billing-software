import test from 'node:test';
import assert from 'node:assert/strict';
import { calcBill, allocate, validateGstin, gstinCheckChar, RULE_VERSION } from '../tax.ts';
import { fmtMoney, parseMoney, parseQty, fmtQty, divRound, businessDate } from '../money.ts';

// These are the "golden bills". Expected numbers were worked out by hand
// (see comments) and must be approved by the shop's tax advisor before launch.

test('inclusive tax, two lines, intra-state (biscuits 2 x 20 @12%, soap 1 x 50 @18%)', () => {
  const r = calcBill(
    [
      { qtyMilli: 2000, priceMinor: 2000, taxRateBp: 1200, inclusive: true },
      { qtyMilli: 1000, priceMinor: 5000, taxRateBp: 1800, inclusive: true },
    ],
    { intraState: true },
  );
  // biscuits: 4000 -> taxable round(4000*10000/11200)=3571, tax 429 ; soap: 5000 -> 4237, tax 763
  assert.equal(r.lines[0].taxableMinor, 3571);
  assert.equal(r.lines[0].taxMinor, 429);
  assert.equal(r.lines[1].taxableMinor, 4237);
  assert.equal(r.lines[1].taxMinor, 763);
  assert.equal(r.taxableMinor, 7808);
  assert.equal(r.taxMinor, 1192);
  assert.equal(r.cgstMinor + r.sgstMinor, 1192);
  assert.equal(r.cgstMinor, 214 + 381);
  assert.equal(r.totalMinor, 9000);
  assert.equal(r.roundOffMinor, 0);
  assert.equal(r.ruleVersion, RULE_VERSION);
  assert.ok(r.explain.length >= 3);
});

test('exclusive tax splits evenly into CGST and SGST', () => {
  const r = calcBill([{ qtyMilli: 1000, priceMinor: 10000, taxRateBp: 1800, inclusive: false }], { intraState: true });
  assert.equal(r.taxableMinor, 10000);
  assert.equal(r.cgstMinor, 900);
  assert.equal(r.sgstMinor, 900);
  assert.equal(r.totalMinor, 11800);
});

test('inter-state supply uses IGST only', () => {
  const r = calcBill([{ qtyMilli: 1000, priceMinor: 10000, taxRateBp: 1800, inclusive: false }], { intraState: false });
  assert.equal(r.igstMinor, 1800);
  assert.equal(r.cgstMinor, 0);
  assert.equal(r.sgstMinor, 0);
});

test('odd tax amount: SGST takes the extra paisa so parts always add up', () => {
  const r = calcBill([{ qtyMilli: 1000, priceMinor: 105, taxRateBp: 500, inclusive: false }], { intraState: true, roundTotal: 'none' });
  // tax = round(105*5%) = 5.25 -> 5 ; cgst 2 sgst 3
  assert.equal(r.taxMinor, 5);
  assert.equal(r.cgstMinor, 2);
  assert.equal(r.sgstMinor, 3);
  assert.equal(r.cgstMinor + r.sgstMinor, r.taxMinor);
});

test('round-off up to the nearest rupee', () => {
  const r = calcBill([{ qtyMilli: 3000, priceMinor: 9999, taxRateBp: 500, inclusive: false }], { intraState: true });
  // gross 29997, tax round(1499.85)=1500, exact 31497 -> 31500, round-off +3
  assert.equal(r.totalMinor, 31500);
  assert.equal(r.roundOffMinor, 3);
});

test('round-off down', () => {
  const r = calcBill([{ qtyMilli: 1000, priceMinor: 31449, taxRateBp: 0, inclusive: true }], { intraState: true });
  assert.equal(r.totalMinor, 31400);
  assert.equal(r.roundOffMinor, -49);
});

test('roundTotal none keeps exact paise', () => {
  const r = calcBill([{ qtyMilli: 1000, priceMinor: 31449, taxRateBp: 0, inclusive: true }], { intraState: true, roundTotal: 'none' });
  assert.equal(r.totalMinor, 31449);
  assert.equal(r.roundOffMinor, 0);
});

test('percentage line discount before inclusive tax', () => {
  const r = calcBill([{ qtyMilli: 1000, priceMinor: 100000, discountBp: 1000, taxRateBp: 1800, inclusive: true }], { intraState: true });
  // 100000 - 10% = 90000 ; taxable round(90000*10000/11800)=76271 ; tax 13729
  assert.equal(r.discountMinor, 10000);
  assert.equal(r.taxableMinor, 76271);
  assert.equal(r.taxMinor, 13729);
  assert.equal(r.totalMinor, 90000);
});

test('bill discount is spread across lines and sums exactly', () => {
  assert.deepEqual(allocate(100, [3333, 3333, 3334]), [33, 33, 34]);
  assert.deepEqual(allocate(0, [1, 2]), [0, 0]);
  const r = calcBill(
    [
      { qtyMilli: 1000, priceMinor: 3333, taxRateBp: 0, inclusive: true },
      { qtyMilli: 1000, priceMinor: 3333, taxRateBp: 0, inclusive: true },
      { qtyMilli: 1000, priceMinor: 3334, taxRateBp: 0, inclusive: true },
    ],
    { intraState: true, billDiscountMinor: 100, roundTotal: 'none' },
  );
  assert.equal(r.discountMinor, 100);
  assert.equal(r.totalMinor, 10000 - 100);
});

test('fractional quantity (0.5 kg at Rs 45)', () => {
  const r = calcBill([{ qtyMilli: 500, priceMinor: 4500, taxRateBp: 0, inclusive: true }], { intraState: true, roundTotal: 'none' });
  assert.equal(r.lines[0].grossMinor, 2250);
  assert.equal(r.totalMinor, 2250);
});

test('zero-rated items carry no tax', () => {
  const r = calcBill([{ qtyMilli: 2000, priceMinor: 1000, taxRateBp: 0, inclusive: false }], { intraState: true });
  assert.equal(r.taxMinor, 0);
  assert.equal(r.totalMinor, 2000);
});

test('invalid input is rejected, not silently fixed', () => {
  assert.throws(() => calcBill([{ qtyMilli: 0, priceMinor: 100, taxRateBp: 0, inclusive: true }], { intraState: true }), /Quantity/);
  assert.throws(() => calcBill([{ qtyMilli: 1000, priceMinor: 100, discountMinor: 200, taxRateBp: 0, inclusive: true }], { intraState: true }), /Discount/);
  assert.throws(() => calcBill([{ qtyMilli: 1000, priceMinor: 100, taxRateBp: 0, inclusive: true }], { intraState: true, billDiscountMinor: 500 }), /Discount/);
  assert.throws(() => calcBill([{ qtyMilli: 1000, priceMinor: -5, taxRateBp: 0, inclusive: true }], { intraState: true }), /Price/);
});

test('property check: totals always reconcile for many random bills', () => {
  let seed = 12345;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let k = 0; k < 500; k++) {
    const n = 1 + rnd(6);
    const lines = Array.from({ length: n }, () => ({
      qtyMilli: 1 + rnd(20000),
      priceMinor: rnd(500000),
      taxRateBp: [0, 500, 1800, 4000][rnd(4)],
      inclusive: rnd(2) === 0,
      discountBp: rnd(3) === 0 ? rnd(3000) : 0,
    }));
    const r = calcBill(lines, { intraState: rnd(2) === 0, billDiscountMinor: 0 });
    const sumLines = r.lines.reduce((a, l) => a + l.totalMinor, 0);
    assert.equal(r.totalMinor, sumLines + r.roundOffMinor);
    assert.equal(r.taxMinor, r.cgstMinor + r.sgstMinor + r.igstMinor);
    assert.equal(r.taxableMinor + r.taxMinor, sumLines);
    assert.equal(r.totalMinor % 100, 0);
  }
});

test('GSTIN checksum', () => {
  assert.equal(validateGstin('27AAPFU0939F1ZV').ok, true);
  assert.equal(validateGstin('27AAPFU0939F1ZX').ok, false);
  assert.equal(validateGstin('123').ok, false);
  assert.equal(gstinCheckChar('27AAPFU0939F1Z'), 'V');
});

test('money helpers', () => {
  assert.equal(fmtMoney(123456789), '₹12,34,567.89');
  assert.equal(fmtMoney(5), '₹0.05');
  assert.equal(fmtMoney(-250, { plain: true }), '-2.50');
  assert.equal(parseMoney('1,200.5'), 120050);
  assert.equal(parseMoney('₹99'), 9900);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney('1.234'), null);
  assert.equal(parseQty('1.5'), 1500);
  assert.equal(parseQty('0.001'), 1);
  assert.equal(parseQty('x'), null);
  assert.equal(fmtQty(1500), '1.5');
  assert.equal(fmtQty(2000), '2');
  assert.equal(divRound(5, 2), 3);
  assert.equal(divRound(-5, 2), -3);
  assert.equal(businessDate('2026-10-16T20:00:00Z'), '2026-10-17'); // 01:30 IST next day
});
