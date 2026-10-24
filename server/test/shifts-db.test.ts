import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';
import { createApp } from '../src/app.ts';
import { connectWire } from '../src/db/wire.ts';
import { migrate, type DB } from '../src/db/index.ts';
import { MIGRATIONS } from '../src/db/schema.ts';
import { startTestDb, type TestDb } from './support/testdb.ts';

let pg: TestDb | null = null;
let db: DB;
let server: http.Server;
let base = '';
let skipReason: string | false = false;

before(async () => {
  pg = await startTestDb();
  if (!pg) {
    skipReason = 'PostgreSQL server programs (initdb, pg_ctl) were not found.';
    return;
  }
  db = await connectWire(pg.url);
  server = http.createServer(createApp(db, { secret: 'test-shift-secret', log: false }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  await migrate(db);
});

after(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
  if (db) await db.close();
  pg?.stop();
});

async function api(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body: json, code: json?.error?.code as string | undefined, message: json?.error?.message as string | undefined, text };
}

const PW = 'Tamil-Shop-2026';
let shopAOwner = '';
let shopACashier1 = '';
let shopACashier2 = '';
let shopAManager = '';
let shopAAccountant = '';
let shopATenantId = '';
let shopBOwner = '';

let itemIdA = '';
let shift1Id = '';
let invoice1Id = '';

test('shifts db setup: register Shop A (with 2 cashiers and manager) and Shop B', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // 1. Register Shop A
  const regA = await api('POST', '/api/auth/register', {
    name: 'Shop A Retail',
    ownerName: 'Owner A',
    email: 'ownerA@shifts.test',
    password: PW,
    businessType: 'retail',
  });
  assert.equal(regA.status, 200, JSON.stringify(regA.body));
  shopAOwner = regA.body.token;
  shopATenantId = regA.body.shop.id;

  // Add Cashier 1
  const cash1 = await api('POST', '/api/users', {
    name: 'Cashier One',
    email: 'cashier1@shifts.test',
    password: PW,
    role: 'cashier',
  }, shopAOwner);
  assert.equal(cash1.status, 200, JSON.stringify(cash1.body));
  const logCash1 = await api('POST', '/api/auth/login', { email: 'cashier1@shifts.test', password: PW });
  shopACashier1 = logCash1.body.token;

  // Add Cashier 2
  const cash2 = await api('POST', '/api/users', {
    name: 'Cashier Two',
    email: 'cashier2@shifts.test',
    password: PW,
    role: 'cashier',
  }, shopAOwner);
  assert.equal(cash2.status, 200, JSON.stringify(cash2.body));
  const logCash2 = await api('POST', '/api/auth/login', { email: 'cashier2@shifts.test', password: PW });
  shopACashier2 = logCash2.body.token;

  // Add Manager
  const mgr = await api('POST', '/api/users', {
    name: 'Manager Mary',
    email: 'manager@shifts.test',
    password: PW,
    role: 'manager',
  }, shopAOwner);
  assert.equal(mgr.status, 200, JSON.stringify(mgr.body));
  const logMgr = await api('POST', '/api/auth/login', { email: 'manager@shifts.test', password: PW });
  shopAManager = logMgr.body.token;

  // Add Accountant
  const acct = await api('POST', '/api/users', {
    name: 'Accountant Alex',
    email: 'accountant@shifts.test',
    password: PW,
    role: 'accountant',
  }, shopAOwner);
  assert.equal(acct.status, 200, JSON.stringify(acct.body));
  const logAcct = await api('POST', '/api/auth/login', { email: 'accountant@shifts.test', password: PW });
  shopAAccountant = logAcct.body.token;

  // 2. Register Shop B (Tenant isolation)
  const regB = await api('POST', '/api/auth/register', {
    name: 'Shop B Competitor',
    ownerName: 'Owner B',
    email: 'ownerB@shifts.test',
    password: PW,
    businessType: 'retail',
  });
  assert.equal(regB.status, 200, JSON.stringify(regB.body));
  shopBOwner = regB.body.token;

  // Create Product in Shop A
  const itm = await api('POST', '/api/items', {
    name: 'Aavin Milk 500ml',
    sku: 'MILK-500',
    barcode: '890123450001',
    priceMinor: 2500, // Rs 25.00
    costMinor: 2000,  // Rs 20.00
    openingQtyMilli: 100000, // 100 units
    trackStock: true,
  }, shopAOwner);
  assert.equal(itm.status, 200, JSON.stringify(itm.body));
  itemIdA = itm.body.item.id;
});

test('shifts db: open shift successfully, reject negative float, reject duplicate active shift', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // 1. Reject negative opening cash float
  const negRes = await api('POST', '/api/shifts', {
    openingCashMinor: -5000,
    location: 'MAIN',
  }, shopACashier1);
  assert.equal(negRes.status, 400);

  // 2. Open shift with valid opening cash float (Rs 1,000 = 100,000 paise)
  const openRes = await api('POST', '/api/shifts', {
    openingCashMinor: 100000,
    location: 'MAIN',
    notes: 'Morning Counter Opening Float',
  }, shopACashier1);
  assert.equal(openRes.status, 200, JSON.stringify(openRes.body));
  assert.equal(openRes.body.shift.status, 'open');
  assert.equal(openRes.body.shift.openingCashMinor, 100000);
  assert.match(openRes.body.shift.shiftNumber, /^SHF-\d+$/);
  shift1Id = openRes.body.shift.id;

  // 3. Prevent duplicate active shift for the same cashier
  const dupRes = await api('POST', '/api/shifts', {
    openingCashMinor: 50000,
  }, shopACashier1);
  assert.equal(dupRes.status, 400);
  assert.equal(dupRes.code, 'ACTIVE_SHIFT_EXISTS');

  // Cashier 2 can still open their own separate shift concurrently
  const cash2Open = await api('POST', '/api/shifts', {
    openingCashMinor: 50000,
    location: 'COUNTER-2',
  }, shopACashier2);
  assert.equal(cash2Open.status, 200, JSON.stringify(cash2Open.body));
});

test('shifts db: record cash-in and cash-out movements on active shift', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // 1. Cash-In: +Rs 500 (50,000 paise) float addition
  const inRes = await api('POST', `/api/shifts/${shift1Id}/cash-moves`, {
    movementType: 'cash_in',
    amountMinor: 50000,
    reason: 'Change Addition from Safe',
    notes: 'Denominations 10s and 20s',
  }, shopACashier1);
  assert.equal(inRes.status, 200, JSON.stringify(inRes.body));
  assert.equal(inRes.body.movement.movementType, 'cash_in');
  assert.equal(inRes.body.movement.amountMinor, 50000);

  // 2. Cash-Out: -Rs 200 (20,000 paise) for stationery / petty cash
  const outRes = await api('POST', `/api/shifts/${shift1Id}/cash-moves`, {
    movementType: 'cash_out',
    amountMinor: 20000,
    reason: 'Petty Cash - Counter Receipt Roll',
    notes: 'Paper rolls purchased',
  }, shopACashier1);
  assert.equal(outRes.status, 200, JSON.stringify(outRes.body));
  assert.equal(outRes.body.movement.movementType, 'cash_out');
  assert.equal(outRes.body.movement.amountMinor, 20000);

  // 3. Validation: reject amount <= 0
  const zeroRes = await api('POST', `/api/shifts/${shift1Id}/cash-moves`, {
    movementType: 'cash_in',
    amountMinor: 0,
    reason: 'Test Zero',
  }, shopACashier1);
  assert.equal(zeroRes.status, 400);

  // 4. Validation: reject missing reason
  const noReasonRes = await api('POST', `/api/shifts/${shift1Id}/cash-moves`, {
    movementType: 'cash_in',
    amountMinor: 10000,
    reason: '',
  }, shopACashier1);
  assert.equal(noReasonRes.status, 400);
});

test('shifts db: transaction tracking isolates cash, non-cash, credit, and refunds', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // 1. Cash sale via POS checkout: 4 packets @ Rs 25 = Rs 100.00 (10,000 paise), paid in CASH
  const sale1 = await api('POST', '/api/invoices', {
    lines: [{ itemId: itemIdA, name: 'Aavin Milk 500ml', qtyMilli: 4000, priceMinor: 2500 }],
    payments: [{ method: 'cash', amountMinor: 10000 }],
    customerName: 'Karthik',
  }, shopACashier1);
  assert.equal(sale1.status, 200, JSON.stringify(sale1.body));
  invoice1Id = sale1.body.id;

  // 2. Non-cash sale via POS checkout: 6 packets @ Rs 25 = Rs 150.00 (15,000 paise), paid in UPI
  const sale2 = await api('POST', '/api/invoices', {
    lines: [{ itemId: itemIdA, name: 'Aavin Milk 500ml', qtyMilli: 6000, priceMinor: 2500 }],
    payments: [{ method: 'upi', amountMinor: 15000, reference: 'UPI/123456789' }],
    customerName: 'Priya',
  }, shopACashier1);
  assert.equal(sale2.status, 200, JSON.stringify(sale2.body));

  // 3. Partial payment checkout: 8 packets @ Rs 25 = Rs 200.00 (20,000 paise)
  // Customer pays Rs 80 cash, remaining Rs 120 balance on credit
  const partyRes = await api('POST', '/api/parties', {
    name: 'Murugan Supermart',
    type: 'customer',
    phone: '9840123456',
  }, shopAOwner);
  const partyId = partyRes.body.party.id;

  const sale3 = await api('POST', '/api/invoices', {
    lines: [{ itemId: itemIdA, name: 'Aavin Milk 500ml', qtyMilli: 8000, priceMinor: 2500 }],
    partyId,
    customerName: 'Murugan Supermart',
    payments: [{ method: 'cash', amountMinor: 8000 }], // only Rs 80 paid
  }, shopACashier1);
  assert.equal(sale3.status, 200, JSON.stringify(sale3.body));
  assert.equal(sale3.body.paidMinor, 8000);
  assert.equal(sale3.body.balanceMinor, 12000);

  // 4. Sales Return with CASH refund from drawer: Return 1 packet from invoice1 (Rs 25 = 2,500 paise refund)
  const retInfo = await api('GET', `/api/invoices/${invoice1Id}/return-info`, undefined, shopACashier1);
  assert.equal(retInfo.status, 200);
  const origLineId = retInfo.body.lines[0].id;

  const retRes = await api('POST', `/api/invoices/${invoice1Id}/returns`, {
    lines: [{ origLineId, returnQtyMilli: 1000, reason: 'Wrong Item', restock: true }],
    settlementType: 'refund',
    refundMode: 'cash',
    refundReference: 'Counter Cash Return',
  }, shopACashier1);
  assert.equal(retRes.status, 200, JSON.stringify(retRes.body));
  assert.equal(retRes.body.settlement.refundAmountMinor, 2500);

  // 5. Query active shift live stats
  const activeRes = await api('GET', '/api/shifts/active', undefined, shopACashier1);
  assert.equal(activeRes.status, 200);
  const active = activeRes.body.activeShift;
  const s = active.summary;

  // Mathematical Reconciliation:
  // Opening Float: Rs 1,000 (100,000)
  // Cash Sales: Rs 100 (10,000) + Rs 80 (8,000) = Rs 180 (18,000)
  // Cash In: +Rs 500 (50,000)
  // Cash Out: -Rs 200 (20,000)
  // Cash Refund: -Rs 25 (2,500)
  // Expected Drawer Cash = 100,000 + 18,000 + 50,000 - 20,000 - 2,500 = 145,500 paise (Rs 1,455.00)
  assert.equal(s.openingCashMinor, 100000);
  assert.equal(s.cashSalesMinor, 18000);
  assert.equal(s.cashInMinor, 50000);
  assert.equal(s.cashOutMinor, 20000);
  assert.equal(s.cashRefundsMinor, 2500);
  assert.equal(s.expectedCashMinor, 145500);

  // Non-Cash: UPI Rs 150 (15,000 paise)
  assert.equal(s.nonCashPaymentsMinor, 15000);
  // Total Collections = Cash (18,000) + UPI (15,000) = 33,000 paise (Rs 330)
  assert.equal(s.totalCollectedMinor, 33000);
  // Credit Sales Unpaid: Rs 120 (12,000 paise)
  assert.equal(s.creditSalesUnpaidMinor, 12000);
});

test('shifts db: closing requires reason on variance, exact close balances cleanly', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // 1. Attempt close with variance (Counted Rs 1,400 vs Expected Rs 1,455 = shortage of Rs 55) WITHOUT reason -> REJECTED
  const rejectClose = await api('POST', `/api/shifts/${shift1Id}/close`, {
    countedCashMinor: 140000,
    varianceReason: '',
  }, shopACashier1);
  assert.equal(rejectClose.status, 400);
  assert.equal(rejectClose.code, 'VARIANCE_REASON_REQUIRED');

  // 2. Perform exact count close: Counted = Expected = 145,500 paise (Rs 1,455.00)
  const closeRes = await api('POST', `/api/shifts/${shift1Id}/close`, {
    countedCashMinor: 145500,
    note: 'Balanced Evening Close',
  }, shopACashier1);
  assert.equal(closeRes.status, 200, JSON.stringify(closeRes.body));
  assert.equal(closeRes.body.shift.status, 'closed');
  assert.equal(closeRes.body.shift.expectedCashMinor, 145500);
  assert.equal(closeRes.body.shift.countedCashMinor, 145500);
  assert.equal(closeRes.body.shift.varianceMinor, 0);

  // 3. Prevent duplicate close
  const dupClose = await api('POST', `/api/shifts/${shift1Id}/close`, {
    countedCashMinor: 145500,
  }, shopACashier1);
  assert.equal(dupClose.status, 400);
  assert.equal(dupClose.code, 'SHIFT_ALREADY_CLOSED');

  // 4. Prevent cash movements on closed shift
  const moveOnClosed = await api('POST', `/api/shifts/${shift1Id}/cash-moves`, {
    movementType: 'cash_in',
    amountMinor: 10000,
    reason: 'Late Deposit',
  }, shopACashier1);
  assert.equal(moveOnClosed.status, 400);
  assert.equal(moveOnClosed.code, 'SHIFT_CLOSED');
});

test('shifts db: cashier 2 closing with shortage variance and manager review', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // Cashier 2 active shift: opened with 50,000 paise (Rs 500)
  const active2 = await api('GET', '/api/shifts/active', undefined, shopACashier2);
  const shift2Id = active2.body.activeShift.id;

  // Expected = 50,000 paise
  // Counted = 48,000 paise (Rs 20 shortage, variance = -2000 paise)
  const close2 = await api('POST', `/api/shifts/${shift2Id}/close`, {
    countedCashMinor: 48000,
    varianceReason: 'Customer short on change 20 rupees, approved by floor incharge',
  }, shopACashier2);
  assert.equal(close2.status, 200, JSON.stringify(close2.body));
  assert.equal(close2.body.shift.status, 'closed');
  assert.equal(close2.body.shift.varianceMinor, -2000);

  // Manager reviews and acknowledges variance
  const reviewRes = await api('POST', `/api/shifts/${shift2Id}/review`, {
    reviewNotes: 'Reviewed with cashier. Small change deficit acknowledged and approved.',
  }, shopAManager);
  assert.equal(reviewRes.status, 200, JSON.stringify(reviewRes.body));
  assert.equal(reviewRes.body.reviewedBy, 'Manager Mary');

  // Cashier cannot review shifts (RBAC)
  const unauthorizedReview = await api('POST', `/api/shifts/${shift2Id}/review`, {
    reviewNotes: 'Self approval',
  }, shopACashier2);
  assert.equal(unauthorizedReview.status, 403);
});

test('shifts db: tenant isolation prevents cross-tenant access to shifts and reports', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // Shop B Owner attempts to access Shop A's shift
  const crossGet = await api('GET', `/api/shifts/${shift1Id}`, undefined, shopBOwner);
  assert.equal(crossGet.status, 404);

  // Shop B Owner attempts to record cash move on Shop A's shift
  const crossMove = await api('POST', `/api/shifts/${shift1Id}/cash-moves`, {
    movementType: 'cash_in',
    amountMinor: 10000,
    reason: 'Cross Tenant Hack',
  }, shopBOwner);
  assert.equal(crossMove.status, 404);

  // Shop B Owner attempts to view Shop A's closing report
  const crossReport = await api('GET', `/api/shifts/${shift1Id}/report`, undefined, shopBOwner);
  assert.equal(crossReport.status, 404);
});

test('shifts db: day-end closing report json and printable html generation', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // 1. JSON report
  const repJson = await api('GET', `/api/shifts/${shift1Id}/report`, undefined, shopACashier1);
  assert.equal(repJson.status, 200);
  const rep = repJson.body.report;
  assert.equal(rep.shift.shiftNumber.startsWith('SHF-'), true);
  assert.equal(rep.summary.expectedCashMinor, 145500);
  assert.equal(rep.summary.countedCashMinor, 145500);
  assert.equal(rep.summary.varianceMinor, 0);
  assert.ok(rep.cashMovements.length >= 2);

  // 2. Printable HTML report
  const repHtml = await api('GET', `/api/shifts/${shift1Id}/report?format=html`, undefined, shopACashier1);
  assert.equal(repHtml.status, 200);
  assert.match(repHtml.text, /DAY-END SHIFT CLOSING REPORT/);
  assert.match(repHtml.text, /Shop A Retail/);
  assert.match(repHtml.text, /Cash Drawer Reconciliation/);
  assert.match(repHtml.text, /Expected Cash in Drawer/);
});

test('shifts safety audit: payment attribution single shift guarantee and fallback isolation', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // 1. Cashier 1 opens Shift 3
  const openRes = await api('POST', '/api/shifts', {
    openingCashMinor: 60000, // Rs 600
    location: 'MAIN',
    notes: 'Audit Shift 3',
  }, shopACashier1);
  assert.equal(openRes.status, 200);
  const shift3Id = openRes.body.shift.id;

  // 2. POS sale during Shift 3 -> stamped with shift_id = shift3Id
  const sale3 = await api('POST', '/api/invoices', {
    lines: [{ itemId: itemIdA, name: 'Aavin Milk 500ml', qtyMilli: 2000, priceMinor: 2500 }],
    payments: [{ method: 'cash', amountMinor: 5000 }], // Rs 50 cash
  }, shopACashier1);
  assert.equal(sale3.status, 200);

  // Close Shift 3 (Counted Rs 650 = 65,000 paise, exact match)
  const close3 = await api('POST', `/api/shifts/${shift3Id}/close`, {
    countedCashMinor: 65000,
    note: 'Balanced Shift 3',
  }, shopACashier1);
  assert.equal(close3.status, 200);
  assert.equal(close3.body.shift.status, 'closed');
  assert.equal(close3.body.shift.expectedCashMinor, 65000);

  // 3. Make POS sale while Cashier 1 has NO open shift -> activeShift is null, shift_id is null
  const unshiftedSale = await api('POST', '/api/invoices', {
    lines: [{ itemId: itemIdA, name: 'Aavin Milk 500ml', qtyMilli: 1000, priceMinor: 2500 }],
    payments: [{ method: 'cash', amountMinor: 2500 }], // Rs 25 cash
  }, shopACashier1);
  assert.equal(unshiftedSale.status, 200);

  // 4. Verify closed Shift 3 expected cash remains 65,000 paise and is NOT mutated by subsequent unshifted payment
  const getShift3 = await api('GET', `/api/shifts/${shift3Id}`, undefined, shopACashier1);
  assert.equal(getShift3.status, 200);
  assert.equal(getShift3.body.shift.expectedCashMinor, 65000);
  assert.equal(getShift3.body.shift.summary.expectedCashMinor, 65000);

  // 5. Cashier 1 opens Shift 4
  const open4 = await api('POST', '/api/shifts', {
    openingCashMinor: 30000, // Rs 300
    location: 'MAIN',
    notes: 'Audit Shift 4',
  }, shopACashier1);
  assert.equal(open4.status, 200);
  const shift4Id = open4.body.shift.id;

  // Verify Shift 4's expected cash is just its opening float (30,000 paise);
  // the unshifted sale happened BEFORE Shift 4 opened, so it is NOT attributed to Shift 4
  const active4 = await api('GET', '/api/shifts/active', undefined, shopACashier1);
  assert.equal(active4.status, 200);
  assert.equal(active4.body.activeShift.summary.expectedCashMinor, 30000);
  assert.equal(active4.body.activeShift.summary.cashSalesMinor, 0);

  // Close Shift 4 cleanly
  const close4 = await api('POST', `/api/shifts/${shift4Id}/close`, {
    countedCashMinor: 30000,
    note: 'Balanced Shift 4',
  }, shopACashier1);
  assert.equal(close4.status, 200);
});

test('shifts safety audit: concurrent close requests serialization and duplicate rejection', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // 1. Cashier 2 opens Shift 5
  const openRes = await api('POST', '/api/shifts', {
    openingCashMinor: 40000, // Rs 400
    location: 'COUNTER-2',
  }, shopACashier2);
  assert.equal(openRes.status, 200);
  const shift5Id = openRes.body.shift.id;

  // 2. Launch two concurrent close requests simultaneously
  const [resA, resB] = await Promise.all([
    api('POST', `/api/shifts/${shift5Id}/close`, { countedCashMinor: 40000, note: 'Close Attempt A' }, shopACashier2),
    api('POST', `/api/shifts/${shift5Id}/close`, { countedCashMinor: 40000, note: 'Close Attempt B' }, shopACashier2),
  ]);

  // Exactly one must succeed (200) and the other must be rejected (400 SHIFT_ALREADY_CLOSED)
  const statuses = [resA.status, resB.status].sort();
  assert.deepEqual(statuses, [200, 400]);

  const rejected = resA.status === 400 ? resA : resB;
  assert.equal(rejected.code, 'SHIFT_ALREADY_CLOSED');

  // Verify shift is recorded as closed exactly once
  const shiftFinal = await api('GET', `/api/shifts/${shift5Id}`, undefined, shopACashier2);
  assert.equal(shiftFinal.status, 200);
  assert.equal(shiftFinal.body.shift.status, 'closed');
  assert.equal(shiftFinal.body.shift.expectedCashMinor, 40000);
});

test('shifts safety audit: cash refunds vs non-cash refunds drawer reconciliation', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // 1. Cashier 1 opens Shift 6
  const openRes = await api('POST', '/api/shifts', {
    openingCashMinor: 50000, // Rs 500 opening float
    location: 'MAIN',
  }, shopACashier1);
  assert.equal(openRes.status, 200);
  const shift6Id = openRes.body.shift.id;

  // Create customer party
  const partyRes = await api('POST', '/api/parties', {
    name: 'Govind Supermart',
    type: 'customer',
    phone: '9840998877',
  }, shopAOwner);
  const partyId = partyRes.body.party.id;

  // Sale: 4 items @ Rs 25 = Rs 100 paid in CASH
  const sale = await api('POST', '/api/invoices', {
    lines: [{ itemId: itemIdA, name: 'Aavin Milk 500ml', qtyMilli: 4000, priceMinor: 2500 }],
    partyId,
    customerName: 'Govind Supermart',
    payments: [{ method: 'cash', amountMinor: 10000 }],
  }, shopACashier1);
  assert.equal(sale.status, 200);
  const invId = sale.body.id;

  const retInfo = await api('GET', `/api/invoices/${invId}/return-info`, undefined, shopACashier1);
  const lineId = retInfo.body.lines[0].id;

  // Return 1 item: settled to CUSTOMER ADVANCE (not cash refund from drawer)
  const retAdvance = await api('POST', `/api/invoices/${invId}/returns`, {
    lines: [{ origLineId: lineId, returnQtyMilli: 1000, reason: 'Customer Changed Mind', restock: true }],
    settlementType: 'advance',
  }, shopACashier1);
  assert.equal(retAdvance.status, 200, JSON.stringify(retAdvance.body));
  assert.equal(retAdvance.body.settlement.advanceAmountMinor, 2500);
  assert.equal(retAdvance.body.settlement.refundAmountMinor, 0);

  // Return 1 item: settled to CASH REFUND paid from drawer
  const retCash = await api('POST', `/api/invoices/${invId}/returns`, {
    lines: [{ origLineId: lineId, returnQtyMilli: 1000, reason: 'Defective', restock: true }],
    settlementType: 'refund',
    refundMode: 'cash',
    refundReference: 'Drawer Cash Payout',
  }, shopACashier1);
  assert.equal(retCash.status, 200, JSON.stringify(retCash.body));
  assert.equal(retCash.body.settlement.refundAmountMinor, 2500);

  // Check active shift financials:
  // Opening: 50,000
  // Cash Sale: +10,000
  // Advance return: 0 deduction from drawer
  // Cash refund: -2,500 deduction from drawer
  // Expected Drawer Cash = 50,000 + 10,000 - 2,500 = 57,500 paise (Rs 575.00)
  const activeRes = await api('GET', '/api/shifts/active', undefined, shopACashier1);
  assert.equal(activeRes.status, 200);
  const s = activeRes.body.activeShift.summary;
  assert.equal(s.cashSalesMinor, 10000);
  assert.equal(s.cashRefundsMinor, 2500); // only cash refund counted, NOT advance
  assert.equal(s.expectedCashMinor, 57500);

  // Close Shift 6
  const close6 = await api('POST', `/api/shifts/${shift6Id}/close`, {
    countedCashMinor: 57500,
    note: 'Balanced Shift 6',
  }, shopACashier1);
  assert.equal(close6.status, 200);
  assert.equal(close6.body.shift.expectedCashMinor, 57500);
});

test('shifts safety audit: exclude supplier payments and cancelled invoice payments', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // Cashier 1 opens Shift 7
  const openRes = await api('POST', '/api/shifts', {
    openingCashMinor: 10000, // Rs 100
    location: 'MAIN',
  }, shopACashier1);
  assert.equal(openRes.status, 200);
  const shift7Id = openRes.body.shift.id;

  // Insert a supplier payment into payments table directly using db
  // (Simulating a supplier disbursement recorded during shift window)
  await db.exec(
    `INSERT INTO payments (id, tenant_id, kind, method, amount_minor, shift_id, bdate, created_by, created_at)
     VALUES (?, ?, 'supplier_payment', 'cash', 5000, ?, ?, ?, now())`,
    ['pay-supp-test-1', shopATenantId, shift7Id, new Date().toISOString().slice(0, 10), (await db.one<any>('SELECT user_id FROM shifts WHERE id = ?', [shift7Id])).userId],
  );

  // Insert a cancelled invoice payment into payments table directly
  await db.exec(
    `INSERT INTO invoices (id, tenant_id, client_id, number, kind, status, bdate, subtotal_minor, taxable_minor, total_minor, rule_version, share_token)
     VALUES ('inv-canc-test-1', ?, 'cid-c1', 'INV-CANC-1', 'sale', 'cancelled', '2026-10-23', 2000, 2000, 2000, '1.0', 'tok-c1')`,
    [shopATenantId],
  );
  await db.exec(
    `INSERT INTO payments (id, tenant_id, kind, method, amount_minor, invoice_id, shift_id, bdate, created_by, created_at)
     VALUES (?, ?, 'receipt', 'cash', 2000, 'inv-canc-test-1', ?, ?, ?, now())`,
    ['pay-canc-test-1', shopATenantId, shift7Id, new Date().toISOString().slice(0, 10), (await db.one<any>('SELECT user_id FROM shifts WHERE id = ?', [shift7Id])).userId],
  );

  // Check active shift:
  // Supplier payment (5,000) and Cancelled invoice payment (2,000) must be STRICTLY EXCLUDED!
  // Expected cash should remain opening float = 10,000 paise
  const activeRes = await api('GET', '/api/shifts/active', undefined, shopACashier1);
  assert.equal(activeRes.status, 200);
  const s = activeRes.body.activeShift.summary;
  assert.equal(s.cashSalesMinor, 0);
  assert.equal(s.cashPaymentsMinor, 0);
  assert.equal(s.expectedCashMinor, 10000);

  // Close Shift 7 cleanly
  const close7 = await api('POST', `/api/shifts/${shift7Id}/close`, {
    countedCashMinor: 10000,
    note: 'Balanced Shift 7',
  }, shopACashier1);
  assert.equal(close7.status, 200);
  assert.equal(close7.body.shift.expectedCashMinor, 10000);
});

test('shifts safety audit: Migration 13 idempotency and safety', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const m13 = MIGRATIONS.find((m) => m.version === 13);
  assert.ok(m13, 'Migration 13 must exist in schema');

  // Re-run every statement in Migration 13 against the existing test database
  for (const stmt of m13.statements) {
    await db.exec(stmt);
  }

  // Verify shifts table has columns and cash_movements table exists
  const shiftCols = await db.query<any>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'shifts'`,
  );
  const colNames = shiftCols.map((c: any) => c.columnName ?? c.column_name);
  assert.ok(colNames.includes('shift_number'));
  assert.ok(colNames.includes('closed_by'));
  assert.ok(colNames.includes('reviewed_by'));
  assert.ok(colNames.includes('review_notes'));

  const cashMoveCols = await db.query<any>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'cash_movements'`,
  );
  assert.ok(cashMoveCols.length >= 7);
});

test('shifts safety audit: accountant permissions and rbac role limits', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // 1. Accountant can view shift history list across all staff
  const listRes = await api('GET', '/api/shifts', undefined, shopAAccountant);
  assert.equal(listRes.status, 200);
  assert.ok(Array.isArray(listRes.body.shifts));
  assert.ok(listRes.body.shifts.length > 0);

  // 2. Accountant can view single shift details
  const detailRes = await api('GET', `/api/shifts/${shift1Id}`, undefined, shopAAccountant);
  assert.equal(detailRes.status, 200);
  assert.equal(detailRes.body.shift.id, shift1Id);

  // 3. Accountant can view shift closing report JSON and HTML
  const repJson = await api('GET', `/api/shifts/${shift1Id}/report`, undefined, shopAAccountant);
  assert.equal(repJson.status, 200);
  assert.equal(repJson.body.report.shift.id, shift1Id);

  const repHtml = await api('GET', `/api/shifts/${shift1Id}/report?format=html`, undefined, shopAAccountant);
  assert.equal(repHtml.status, 200);
  assert.match(repHtml.text, /DAY-END SHIFT CLOSING REPORT/);

  // 4. Accountant CANNOT review/approve shift variance (only Owner/Manager)
  const reviewRes = await api('POST', `/api/shifts/${shift1Id}/review`, {
    reviewNotes: 'Accountant unauthorized review',
  }, shopAAccountant);
  assert.equal(reviewRes.status, 403);

  // 5. Accountant CANNOT record cash movements or close an active cashier shift
  const openCash2 = await api('POST', '/api/shifts', {
    openingCashMinor: 10000,
    location: 'COUNTER-2',
  }, shopACashier2);
  assert.equal(openCash2.status, 200);
  const activeShift2Id = openCash2.body.shift.id;

  const moveRes = await api('POST', `/api/shifts/${activeShift2Id}/cash-moves`, {
    movementType: 'cash_in',
    amountMinor: 1000,
    reason: 'Accountant deposit',
  }, shopAAccountant);
  assert.equal(moveRes.status, 403);

  const closeByAcct = await api('POST', `/api/shifts/${activeShift2Id}/close`, {
    countedCashMinor: 10000,
  }, shopAAccountant);
  assert.equal(closeByAcct.status, 403);

  // 6. Cashier 1 CANNOT view another cashier's shift details or review it
  const crossCashierView = await api('GET', `/api/shifts/${activeShift2Id}`, undefined, shopACashier1);
  assert.equal(crossCashierView.status, 403);

  const crossCashierReview = await api('POST', `/api/shifts/${activeShift2Id}/review`, {
    reviewNotes: 'Cashier trying to review',
  }, shopACashier1);
  assert.equal(crossCashierReview.status, 403);

  // Close Cashier 2's shift cleanly
  const closeCash2 = await api('POST', `/api/shifts/${activeShift2Id}/close`, {
    countedCashMinor: 10000,
  }, shopACashier2);
  assert.equal(closeCash2.status, 200);
});

test('shifts safety audit: checkout racing with shift close serialization', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // 1. Cashier 1 opens Shift 8
  const openRes = await api('POST', '/api/shifts', {
    openingCashMinor: 20000, // Rs 200
    location: 'MAIN',
  }, shopACashier1);
  assert.equal(openRes.status, 200);
  const shift8Id = openRes.body.shift.id;

  // 2. Perform concurrent checkout and close simultaneously
  const [saleRes, closeRes] = await Promise.all([
    api('POST', '/api/invoices', {
      lines: [{ itemId: itemIdA, name: 'Aavin Milk 500ml', qtyMilli: 2000, priceMinor: 2500 }],
      payments: [{ method: 'cash', amountMinor: 5000 }], // Rs 50 cash
    }, shopACashier1),
    api('POST', `/api/shifts/${shift8Id}/close`, {
      countedCashMinor: 20000, // Cashier counted base float
      varianceReason: 'Racing test variance if payment included',
    }, shopACashier1),
  ]);

  // Both endpoints must respond cleanly without 500 internal errors or deadlocks
  assert.ok([200, 400].includes(saleRes.status));
  assert.ok([200, 400].includes(closeRes.status));

  // If close succeeded:
  if (closeRes.status === 200) {
    const shiftClosed = await api('GET', `/api/shifts/${shift8Id}`, undefined, shopACashier1);
    assert.equal(shiftClosed.status, 200);
    assert.equal(shiftClosed.body.shift.status, 'closed');

    // If sale committed before close: shift's expectedCashMinor must reflect 25,000 paise (20,000 + 5,000)
    // If sale committed after close: payment shift_id must NOT be shift8Id (it will be null or subsequent)
    const paymentRow = saleRes.body?.id ? await db.one<any>('SELECT shift_id FROM payments WHERE invoice_id = ?', [saleRes.body.id]) : null;
    if (paymentRow?.shift_id === shift8Id) {
      assert.equal(shiftClosed.body.shift.expectedCashMinor, 25000);
    } else {
      assert.equal(shiftClosed.body.shift.expectedCashMinor, 20000);
    }
  }
});


