import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';
import { createApp } from '../src/app.ts';
import { connectDb, type DB } from '../src/db/index.ts';
import { signToken, hashPassword, passwordStamp, newId } from '../src/security.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-long-enough-32-chars-at-least';
const TEST_TENANT = 't_dash_cnt_' + Date.now();
const BRANCH_ANNA = 'b_anna_dash_' + Date.now();
const BRANCH_TNAGAR = 'b_tnagar_dash_' + Date.now();

let db: DB;
let server: http.Server;
let base = '';
let ownerToken = '';
let mgrToken = '';
let cashierToken = '';
let ownerId = '';
let mgrId = '';
let cashierId = '';

let counter1Id = '';
let counter2Id = '';
let disabledCounterId = '';
let tnagarCounterId = '';
let itemId = '';

async function api(method: string, path: string, headers: Record<string, string> = {}, body?: any, token?: string) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, body: json };
}

before(async () => {
  db = await connectDb();
  server = http.createServer(createApp(db, { secret: JWT_SECRET, log: false }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;

  // 1. Setup Tenant and 2 Branches
  await db.exec(`INSERT INTO tenants (id, name, business_type, state_code) VALUES (?, 'Supermarket Retail', 'retail', '33')`, [TEST_TENANT]);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, code, active) VALUES (?, ?, 'Anna Nagar', 'ANNA', true)`, [BRANCH_ANNA, TEST_TENANT]);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, code, active) VALUES (?, ?, 'T Nagar', 'TNAGAR', true)`, [BRANCH_TNAGAR, TEST_TENANT]);

  // 2. Setup Owner, Manager and Cashier
  const pwd = hashPassword('TestPass123!');
  ownerId = 'u_owner_' + Date.now();
  mgrId = 'u_mgr_' + Date.now();
  cashierId = 'u_cashier_' + Date.now();

  await db.exec(
    `INSERT INTO users (id, tenant_id, name, email, password_hash, role, active)
     VALUES (?, ?, 'Store Owner', ?, ?, 'owner', true)`,
    [ownerId, TEST_TENANT, `owner_${Date.now()}@test.local`, pwd]
  );
  ownerToken = signToken({ sub: ownerId, tid: TEST_TENANT, ph: passwordStamp(pwd), role: 'owner' }, JWT_SECRET, 3600);

  await db.exec(
    `INSERT INTO users (id, tenant_id, branch_id, name, email, password_hash, role, active)
     VALUES (?, ?, ?, 'Branch Manager', ?, ?, 'manager', true)`,
    [mgrId, TEST_TENANT, BRANCH_ANNA, `mgr_${Date.now()}@test.local`, pwd]
  );
  mgrToken = signToken({ sub: mgrId, tid: TEST_TENANT, ph: passwordStamp(pwd), role: 'manager', branchId: BRANCH_ANNA }, JWT_SECRET, 3600);

  await db.exec(
    `INSERT INTO users (id, tenant_id, branch_id, name, email, password_hash, role, active)
     VALUES (?, ?, ?, 'Cashier Lakshmi', ?, ?, 'cashier', true)`,
    [cashierId, TEST_TENANT, BRANCH_ANNA, `cashier_${Date.now()}@test.local`, pwd]
  );
  cashierToken = signToken({ sub: cashierId, tid: TEST_TENANT, ph: passwordStamp(pwd), role: 'cashier', branchId: BRANCH_ANNA }, JWT_SECRET, 3600);

  // 3. Create exactly 2 active counters in Anna Nagar (Counter 1 and Counter 2), plus 1 disabled counter
  counter1Id = 'cnt_anna_1_' + Date.now();
  counter2Id = 'cnt_anna_2_' + Date.now();
  disabledCounterId = 'cnt_anna_dis_' + Date.now();

  await db.exec(
    `INSERT INTO counters (id, tenant_id, branch_id, name, code, status) VALUES (?, ?, ?, 'Counter 1', 'ANNA-C01', 'ACTIVE')`,
    [counter1Id, TEST_TENANT, BRANCH_ANNA]
  );
  await db.exec(
    `INSERT INTO counters (id, tenant_id, branch_id, name, code, status) VALUES (?, ?, ?, 'Counter 2', 'ANNA-C02', 'ACTIVE')`,
    [counter2Id, TEST_TENANT, BRANCH_ANNA]
  );
  await db.exec(
    `INSERT INTO counters (id, tenant_id, branch_id, name, code, status) VALUES (?, ?, ?, 'Disabled Counter', 'ANNA-DIS', 'DISABLED')`,
    [disabledCounterId, TEST_TENANT, BRANCH_ANNA]
  );

  // 4. Create 1 counter in T Nagar
  tnagarCounterId = 'cnt_tnagar_1_' + Date.now();
  await db.exec(
    `INSERT INTO counters (id, tenant_id, branch_id, name, code, status) VALUES (?, ?, ?, 'Express Lane', 'TNG-EXP', 'ACTIVE')`,
    [tnagarCounterId, TEST_TENANT, BRANCH_TNAGAR]
  );

  // 5. Create test product with stock in Anna Nagar
  itemId = 'itm_' + Date.now();
  await db.exec(
    `INSERT INTO items (id, tenant_id, branch_id, name, sku, barcode, price_minor, cost_minor, track_stock, active)
     VALUES (?, ?, ?, 'Maggi Noodles 70g', ?, ?, 1400, 1000, true, true)`,
    [itemId, TEST_TENANT, BRANCH_ANNA, 'SKU-MAGGI-' + Date.now(), 'BC-MAGGI-' + Date.now()]
  );
  await db.exec(
    `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, location, qty_milli, kind)
     VALUES (?, ?, ?, ?, 'ANNA', 100000, 'purchase')`,
    ['sm_' + Date.now(), TEST_TENANT, BRANCH_ANNA, itemId]
  );
});

after(async () => {
  try {
    if (db && TEST_TENANT) {
      await db.exec('DELETE FROM invoice_lines WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM payments WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM invoices WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM shifts WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM counters WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM stock_moves WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM number_series WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM items WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM users WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM branches WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM tenants WHERE id = ?', [TEST_TENANT]);
    }
  } catch {}
  if ((server as any).closeAllConnections) (server as any).closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  if (db) await db.close();
  setTimeout(() => process.exit(0), 100).unref();
});

test('1. Dashboard shows only the 2 active counters for the branch (no phantom Counter 3/4)', async () => {
  const res = await api('GET', '/api/dashboard/today?branch=ANNA', {}, undefined, mgrToken);
  assert.equal(res.status, 200);
  assert.ok(res.body.countersToday);
  assert.equal(res.body.countersToday.counters.length, 2, 'Must display exactly 2 active counters');
  assert.equal(res.body.countersToday.counters[0].name, 'Counter 1');
  assert.equal(res.body.countersToday.counters[0].code, 'ANNA-C01');
  assert.equal(res.body.countersToday.counters[0].amountMinor, 0);
  assert.equal(res.body.countersToday.counters[1].name, 'Counter 2');
  assert.equal(res.body.countersToday.counters[1].code, 'ANNA-C02');
  assert.equal(res.body.countersToday.counters[1].amountMinor, 0);
  assert.equal(res.body.countersToday.totalMinor, 0);
});

test('2. Cashier selects Counter 2 and opens shift', async () => {
  const res = await api(
    'POST',
    '/api/shifts',
    {},
    {
      branchId: BRANCH_ANNA,
      counterId: counter2Id,
      counter: 'ANNA-C02',
      openingCashMinor: 100000,
    },
    cashierToken
  );
  assert.equal(res.status, 200);
  assert.ok(res.body.shift);
  assert.equal(res.body.shift.counterId, counter2Id);
  assert.equal(res.body.shift.counter, 'ANNA-C02');
  assert.equal(res.body.shift.counterNameSnapshot, 'Counter 2');
});

test('3. Cashier bills ₹702 from Counter 2 -> counter_id stored in database', async () => {
  const billRes = await api(
    'POST',
    '/api/invoices',
    {},
    {
      branchId: BRANCH_ANNA,
      counterId: counter2Id,
      counter: 'ANNA-C02',
      lines: [
        {
          itemId,
          name: 'Maggi Noodles 70g',
          qtyMilli: 1000,
          priceMinor: 70200, // ₹702.00
          taxRateBp: 0,
          inclusive: true,
        },
      ],
      payments: [
        { method: 'cash', amountMinor: 70200 },
      ],
    },
    cashierToken
  );
  assert.equal(billRes.status, 200);
  const invoiceId = billRes.body.invoiceId || billRes.body.id;
  assert.ok(invoiceId);

  // Verify counter_id stored directly on invoice and payment records in PostgreSQL
  const invRow = await db.one<any>('SELECT counter_id, counter, counter_name_snapshot FROM invoices WHERE id = ?', [invoiceId]);
  assert.equal(invRow.counterId ?? invRow.counter_id, counter2Id, 'Invoice must have counter_id set to Counter 2');
  assert.equal(invRow.counter, 'ANNA-C02');
  assert.equal(invRow.counterNameSnapshot ?? invRow.counter_name_snapshot, 'Counter 2');

  const payRow = await db.one<any>('SELECT counter_id, counter, counter_name_snapshot FROM payments WHERE invoice_id = ?', [invoiceId]);
  assert.equal(payRow.counterId ?? payRow.counter_id, counter2Id, 'Payment must have counter_id set to Counter 2');
  assert.equal(payRow.counter, 'ANNA-C02');
  assert.equal(payRow.counterNameSnapshot ?? payRow.counter_name_snapshot, 'Counter 2');
});

test('4. Dashboard Counters Today reflects ₹702 on Counter 2 and ₹0 on Counter 1', async () => {
  const res = await api('GET', '/api/dashboard/today?branch=ANNA', {}, undefined, mgrToken);
  assert.equal(res.status, 200);
  assert.ok(res.body.countersToday);
  assert.equal(res.body.countersToday.counters.length, 2);

  const c1 = res.body.countersToday.counters.find((c: any) => c.id === counter1Id);
  const c2 = res.body.countersToday.counters.find((c: any) => c.id === counter2Id);

  assert.ok(c1, 'Counter 1 must be present');
  assert.ok(c2, 'Counter 2 must be present');

  assert.equal(c1.amountMinor, 0, 'Counter 1 must be ₹0');
  assert.equal(c1.formattedAmount, '₹0');

  assert.equal(c2.amountMinor, 70200, 'Counter 2 must be ₹702 (70200 paise)');
  assert.equal(c2.formattedAmount, '₹702');

  assert.equal(res.body.countersToday.totalMinor, 70200, 'Branch total must be ₹702');
  assert.equal(res.body.countersToday.formattedTotal, '₹702');
});

test('5. Cashier switches to Counter 1 via /api/shifts/counter and bills ₹300', async () => {
  // Cashier switches active counter
  const switchRes = await api(
    'POST',
    '/api/shifts/counter',
    {},
    {
      branchId: BRANCH_ANNA,
      counterId: counter1Id,
    },
    cashierToken
  );
  assert.equal(switchRes.status, 200);
  assert.equal(switchRes.body.counterId, counter1Id);
  assert.equal(switchRes.body.counter, 'ANNA-C01');

  // Verify shift record in DB was updated to Counter 1
  const shiftRow = await db.one<any>(
    "SELECT counter_id, counter, counter_name_snapshot FROM shifts WHERE user_id = ? AND status = 'open'",
    [cashierId]
  );
  assert.equal(shiftRow.counterId ?? shiftRow.counter_id, counter1Id);
  assert.equal(shiftRow.counter, 'ANNA-C01');

  // Generate bill for ₹300 on Counter 1
  const billRes = await api(
    'POST',
    '/api/invoices',
    {},
    {
      branchId: BRANCH_ANNA,
      counterId: counter1Id,
      counter: 'ANNA-C01',
      lines: [
        {
          itemId,
          name: 'Maggi Noodles 70g',
          qtyMilli: 1000,
          priceMinor: 30000, // ₹300.00
          taxRateBp: 0,
          inclusive: true,
        },
      ],
      payments: [
        { method: 'cash', amountMinor: 30000 },
      ],
    },
    cashierToken
  );
  assert.equal(billRes.status, 200);

  // Check Dashboard: Counter 1 = ₹300, Counter 2 = ₹702, Branch Total = ₹1002
  const res = await api('GET', '/api/dashboard/today?branch=ANNA', {}, undefined, mgrToken);
  assert.equal(res.status, 200);

  const c1 = res.body.countersToday.counters.find((c: any) => c.id === counter1Id);
  const c2 = res.body.countersToday.counters.find((c: any) => c.id === counter2Id);

  assert.equal(c1.amountMinor, 30000, 'Counter 1 must be ₹300');
  assert.equal(c1.formattedAmount, '₹300');

  assert.equal(c2.amountMinor, 70200, 'Counter 2 must remain ₹702');
  assert.equal(c2.formattedAmount, '₹702');

  assert.equal(res.body.countersToday.totalMinor, 100200, 'Branch total must be ₹1002 (300 + 702)');
  assert.equal(res.body.countersToday.formattedTotal, '₹1,002');
});

test('6. Validation: Reject selecting disabled counter', async () => {
  const res = await api(
    'POST',
    '/api/shifts/counter',
    {},
    {
      branchId: BRANCH_ANNA,
      counterId: disabledCounterId,
    },
    cashierToken
  );
  assert.equal(res.status, 400);
  assert.equal(res.body.error?.code, 'COUNTER_DISABLED');
});

test('7. Validation: Reject counter belonging to another branch', async () => {
  const res = await api(
    'POST',
    '/api/shifts/counter',
    {},
    {
      branchId: BRANCH_ANNA,
      counterId: tnagarCounterId,
    },
    cashierToken
  );
  assert.equal(res.status, 400);
  assert.equal(res.body.error?.code, 'INVALID_COUNTER');
});

test('8. Branch Isolation: T Nagar dashboard only displays T Nagar counters and has ₹0 from Anna Nagar', async () => {
  const res = await api('GET', '/api/dashboard/today?branch=TNAGAR', {}, undefined, ownerToken);
  assert.equal(res.status, 200);
  assert.ok(res.body.countersToday);
  assert.equal(res.body.countersToday.counters.length, 1, 'T Nagar has exactly 1 counter');
  assert.equal(res.body.countersToday.counters[0].id, tnagarCounterId);
  assert.equal(res.body.countersToday.counters[0].amountMinor, 0, 'No sales should leak from Anna Nagar');
  assert.equal(res.body.countersToday.totalMinor, 0);
});


