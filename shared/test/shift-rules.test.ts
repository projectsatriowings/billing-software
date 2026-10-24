import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calcExpectedCash,
  calcShiftVariance,
  classifyVariance,
  compileShiftSummary,
  formatMoney,
} from '../shifts.ts';

test('expected cash: basic formula with opening float, sales, movements, and refunds', () => {
  // Opening: Rs 1000 (100000 paise)
  // Cash Sales: Rs 5000 (500000 paise)
  // Cash Collections (Khata): Rs 1500 (150000 paise)
  // Cash In: Rs 500 (50000 paise)
  // Cash Out: Rs 300 (30000 paise)
  // Cash Refunds: Rs 200 (20000 paise)
  // Expected = 100000 + 500000 + 150000 + 50000 - 30000 - 20000 = 750000 paise (Rs 7500)
  const expected = calcExpectedCash({
    openingCashMinor: 100000,
    cashSalesMinor: 500000,
    cashPaymentsMinor: 150000,
    cashInMinor: 50000,
    cashOutMinor: 30000,
    cashRefundsMinor: 20000,
  });

  assert.equal(expected, 750000);
});

test('expected cash: non-cash payments (UPI, card, bank) are strictly excluded from drawer cash', () => {
  const summary = compileShiftSummary({
    openingCashMinor: 50000, // Rs 500
    payments: [
      { method: 'cash', amountMinor: 20000, isInvoiceCheckout: true }, // Cash sale Rs 200
      { method: 'upi', amountMinor: 100000, isInvoiceCheckout: true }, // UPI sale Rs 1000 (drawer excluded)
      { method: 'card', amountMinor: 80000, isInvoiceCheckout: true }, // Card sale Rs 800 (drawer excluded)
      { method: 'bank', amountMinor: 50000, isInvoiceCheckout: false }, // Bank collection Rs 500 (drawer excluded)
      { method: 'cash', amountMinor: 15000, isInvoiceCheckout: false }, // Cash collection Rs 150
    ],
    cashInMinor: 0,
    cashOutMinor: 0,
    cashRefundsMinor: 0,
  });

  assert.equal(summary.openingCashMinor, 50000);
  assert.equal(summary.cashSalesMinor, 20000);
  assert.equal(summary.cashPaymentsMinor, 15000);
  assert.equal(summary.totalCashReceivedMinor, 35000);
  assert.equal(summary.nonCashPaymentsMinor, 230000); // 1000 + 800 + 500 = Rs 2300
  assert.equal(summary.totalCollectedMinor, 265000); // 350 + 2300 = Rs 2650
  // Expected drawer cash MUST only include cash: 50000 + 35000 = 85000 paise (Rs 850)
  assert.equal(summary.expectedCashMinor, 85000);
});

test('partial payment: only the eligible amount paid is counted, not the full invoice value', () => {
  // A customer buys goods worth Rs 10,000, but only pays Rs 2,000 cash at counter on credit terms
  const summary = compileShiftSummary({
    openingCashMinor: 0,
    payments: [
      { method: 'cash', amountMinor: 200000, isInvoiceCheckout: true }, // Rs 2000 paid
    ],
    totalSalesBilledMinor: 1000000, // Rs 10000 total bill
    creditSalesUnpaidMinor: 800000, // Rs 8000 remaining credit
    cashInMinor: 0,
    cashOutMinor: 0,
    cashRefundsMinor: 0,
  });

  assert.equal(summary.cashSalesMinor, 200000);
  assert.equal(summary.expectedCashMinor, 200000);
  assert.equal(summary.totalSalesBilledMinor, 1000000);
  assert.equal(summary.creditSalesUnpaidMinor, 800000);
});

test('unpaid credit invoice: contributes 0 to drawer cash', () => {
  const summary = compileShiftSummary({
    openingCashMinor: 100000,
    payments: [], // No payment received at checkout (100% credit invoice)
    totalSalesBilledMinor: 500000,
    creditSalesUnpaidMinor: 500000,
    cashInMinor: 0,
    cashOutMinor: 0,
    cashRefundsMinor: 0,
  });

  assert.equal(summary.cashSalesMinor, 0);
  assert.equal(summary.expectedCashMinor, 100000); // Only opening cash remains in drawer
});

test('refunds: only cash refunds paid from drawer reduce expected cash', () => {
  // Opening: Rs 1000
  // Cash Sales: Rs 2000
  // Cash Refund (Returned item refunded in cash): Rs 500 (50000 paise)
  const summaryWithCashRefund = compileShiftSummary({
    openingCashMinor: 100000,
    payments: [{ method: 'cash', amountMinor: 200000, isInvoiceCheckout: true }],
    cashInMinor: 0,
    cashOutMinor: 0,
    cashRefundsMinor: 50000, // Cash refund paid out
  });

  // Expected = 100000 + 200000 - 50000 = 250000 paise (Rs 2500)
  assert.equal(summaryWithCashRefund.expectedCashMinor, 250000);

  // If refund was done via UPI or Store Credit / Advance, cashRefundsMinor is 0
  const summaryWithUpiRefund = compileShiftSummary({
    openingCashMinor: 100000,
    payments: [{ method: 'cash', amountMinor: 200000, isInvoiceCheckout: true }],
    cashInMinor: 0,
    cashOutMinor: 0,
    cashRefundsMinor: 0, // UPI refund does not touch physical cash drawer
  });

  assert.equal(summaryWithUpiRefund.expectedCashMinor, 300000);
});

test('cash movements: cash-in increases drawer, cash-out decreases drawer', () => {
  // Opening: Rs 1000
  // Sales: Rs 1000
  // Cash In: +Rs 2000 (Owner added float)
  // Cash Out: -Rs 500 (Petty cash stationery)
  const expected = calcExpectedCash({
    openingCashMinor: 100000,
    cashSalesMinor: 100000,
    cashPaymentsMinor: 0,
    cashInMinor: 200000,
    cashOutMinor: 50000,
    cashRefundsMinor: 0,
  });

  // 1000 + 1000 + 2000 - 500 = 3500 (350000 paise)
  assert.equal(expected, 350000);
});

test('variance: exact match produces zero variance and requires no reason', () => {
  const expected = 500000;
  const counted = 500000;
  const variance = calcShiftVariance(counted, expected);
  const info = classifyVariance(variance);

  assert.equal(variance, 0);
  assert.equal(info.type, 'exact');
  assert.equal(info.isBalanced, true);
  assert.equal(info.requiresReason, false);
});

test('variance: shortage produces negative variance and requires explanation', () => {
  const expected = 500000; // Rs 5000 expected
  const counted = 485000;  // Rs 4850 counted (Rs 150 missing)
  const variance = calcShiftVariance(counted, expected);
  const info = classifyVariance(variance);

  assert.equal(variance, -15000);
  assert.equal(info.type, 'shortage');
  assert.equal(info.isBalanced, false);
  assert.equal(info.requiresReason, true);
  assert.equal(info.absAmountMinor, 15000);
});

test('variance: excess produces positive variance and requires explanation', () => {
  const expected = 500000; // Rs 5000 expected
  const counted = 512000;  // Rs 5120 counted (Rs 120 extra)
  const variance = calcShiftVariance(counted, expected);
  const info = classifyVariance(variance);

  assert.equal(variance, 12000);
  assert.equal(info.type, 'excess');
  assert.equal(info.isBalanced, false);
  assert.equal(info.requiresReason, true);
  assert.equal(info.absAmountMinor, 12000);
});

test('reversals: reversed payments are excluded from shift collections', () => {
  const summary = compileShiftSummary({
    openingCashMinor: 0,
    payments: [
      { method: 'cash', amountMinor: 50000, status: 'posted', isInvoiceCheckout: true },
      { method: 'cash', amountMinor: 25000, status: 'reversed', isInvoiceCheckout: true }, // reversed!
      { method: 'upi', amountMinor: 30000, status: 'posted', isInvoiceCheckout: true },
      { method: 'upi', amountMinor: 10000, status: 'reversed', isInvoiceCheckout: true }, // reversed!
    ],
    cashInMinor: 0,
    cashOutMinor: 0,
    cashRefundsMinor: 0,
  });

  assert.equal(summary.cashSalesMinor, 50000);
  assert.equal(summary.nonCashPaymentsMinor, 30000);
  assert.equal(summary.totalCollectedMinor, 80000);
  assert.equal(summary.transactionsCount, 2); // Only 2 valid non-reversed transactions
});

test('formatMoney: correctly formats positive, negative and zero amounts in Indian format', () => {
  assert.equal(formatMoney(0), '₹0.00');
  assert.equal(formatMoney(150000), '₹1,500.00');
  assert.equal(formatMoney(10000000), '₹1,00,000.00');
  assert.equal(formatMoney(-5000), '-₹50.00');
  assert.equal(formatMoney(null), '—');
});
