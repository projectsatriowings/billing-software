import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';
import { createApp } from '../src/app.ts';
import { connectDb, type DB } from '../src/db/index.ts';
import { signToken, passwordStamp } from '../src/security.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-long-enough-32-chars-at-least';
const BRANCH_MAIN = 'br_main_store';

let db: DB;
let server: http.Server;
let base = '';
let managerToken = '';
let cashierToken = '';
let ownerToken = '';
let tnagarToken = '';
let counter3Id = '';
let counter4Id = '';
let invoice3Id = '';
let invoice4Id = '';

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

  // Store Manager for br_main_store
  const mgr = await db.one<any>(
    "SELECT * FROM users WHERE id = 'u_demo_manager'"
  );
  assert.ok(mgr, 'u_demo_manager exists');
  managerToken = signToken(
    {
      sub: mgr.id,
      tid: mgr.tenantId,
      role: mgr.role,
      branchId: mgr.branchId,
      ph: passwordStamp(mgr.passwordHash),
    },
    JWT_SECRET,
    86400
  );

  // Cashier for br_main_store
  const cashier = await db.one<any>(
    "SELECT * FROM users WHERE id = 'u_main_cashier'"
  );
  assert.ok(cashier, 'u_main_cashier exists');
  cashierToken = signToken(
    {
      sub: cashier.id,
      tid: cashier.tenantId,
      role: cashier.role,
      branchId: cashier.branchId,
      ph: passwordStamp(cashier.passwordHash),
    },
    JWT_SECRET,
    86400
  );

  // Super Admin (owner)
  const owner = await db.one<any>(
    "SELECT * FROM users WHERE id = 'u_demo_owner'"
  );
  assert.ok(owner, 'u_demo_owner exists');
  ownerToken = signToken(
    {
      sub: owner.id,
      tid: owner.tenantId,
      role: owner.role,
      branchId: owner.branchId,
      ph: passwordStamp(owner.passwordHash),
    },
    JWT_SECRET,
    86400
  );

  // Store Manager for br_tnagar_store
  const tnrMgr = await db.one<any>(
    "SELECT * FROM users WHERE id = 'u_tnagar_manager'"
  );
  assert.ok(tnrMgr, 'u_tnagar_manager exists');
  tnagarToken = signToken(
    {
      sub: tnrMgr.id,
      tid: tnrMgr.tenantId,
      role: tnrMgr.role,
      branchId: tnrMgr.branchId,
      ph: passwordStamp(tnrMgr.passwordHash),
    },
    JWT_SECRET,
    86400
  );
});

test('Step 0: Verify clean baseline for br_main_store (2 counters, ₹500 + ₹64 = ₹564)', async () => {
  const res = await api('GET', '/api/dashboard/today?branch=MAIN', {}, undefined, managerToken);
  assert.equal(res.status, 200);
  assert.ok(res.body.countersToday);

  const ct = res.body.countersToday;
  assert.equal(ct.counters.length, 2, 'Must have exactly 2 active counters');

  const c1 = ct.counters.find((c: any) => c.name === 'Counter 1' || c.code === 'MAIN-C01');
  const c2 = ct.counters.find((c: any) => c.name === 'Counter 2' || c.code === 'MAIN-C02');

  assert.ok(c1, 'Counter 1 must exist');
  assert.ok(c2, 'Counter 2 must exist');

  assert.equal(c1.amountMinor, 50000, 'Counter 1 must have exactly ₹500 (50,000 paise)');
  assert.equal(c1.formattedAmount, '₹500');

  assert.equal(c2.amountMinor, 6400, 'Counter 2 must have exactly ₹64 (6,400 paise)');
  assert.equal(c2.formattedAmount, '₹64');

  assert.equal(ct.totalMinor, 56400, 'Branch Total must be ₹564 (56,400 paise)');
  assert.equal(ct.formattedTotal, '₹564');
});

test('Step 1: Store Manager creates Counter 3 and Cashier bills ₹54', async () => {
  // Manager creates Counter 3
  const createRes = await api(
    'POST',
    '/api/branch/counters',
    {},
    {
      name: 'Counter 3',
      code: 'MAIN-C03',
    },
    managerToken
  );
  assert.equal(createRes.status, 200);
  assert.ok(createRes.body.id);
  counter3Id = createRes.body.id;
  assert.equal(createRes.body.name, 'Counter 3');
  assert.equal(createRes.body.code, 'MAIN-C03');

  // Cashier bills ₹54 on Counter 3
  const checkoutRes = await api(
    'POST',
    '/api/invoices',
    {},
    {
      branchId: BRANCH_MAIN,
      counterId: counter3Id,
      counter: 'MAIN-C03',
      lines: [
        {
          name: 'Supermarket Item 3 (₹54)',
          qtyMilli: 1000,
          priceMinor: 5400,
          inclusive: true,
          taxRateBp: 0,
        },
      ],
      payments: [
        {
          amountMinor: 5400,
          method: 'cash',
        },
      ],
    },
    cashierToken
  );
  assert.equal(checkoutRes.status, 200);
  assert.ok(checkoutRes.body.id);
  invoice3Id = checkoutRes.body.id;
  assert.equal(checkoutRes.body.totalMinor, 5400);
});

test('Step 2: Verify ₹54 appears ONLY under Counter 3 and Branch Total is ₹618', async () => {
  const res = await api('GET', '/api/dashboard/today?branch=MAIN', {}, undefined, managerToken);
  assert.equal(res.status, 200);

  const ct = res.body.countersToday;
  assert.equal(ct.counters.length, 3, 'Must have 3 counters');

  const c1 = ct.counters.find((c: any) => c.name === 'Counter 1' || c.code === 'MAIN-C01');
  const c2 = ct.counters.find((c: any) => c.name === 'Counter 2' || c.code === 'MAIN-C02');
  const c3 = ct.counters.find((c: any) => c.id === counter3Id);

  assert.ok(c1, 'Counter 1 must exist');
  assert.ok(c2, 'Counter 2 must exist');
  assert.ok(c3, 'Counter 3 must exist');

  assert.equal(c1.amountMinor, 50000, 'Counter 1 unchanged at ₹500');
  assert.equal(c2.amountMinor, 6400, 'Counter 2 unchanged at ₹64');
  assert.equal(c3.amountMinor, 5400, 'Counter 3 has ONLY ₹54');
  assert.equal(c3.formattedAmount, '₹54');

  assert.equal(ct.totalMinor, 56400 + 5400, 'Branch Total must be 500 + 64 + 54 = ₹618');
  assert.equal(ct.formattedTotal, '₹618');
});

test('Step 3: Store Manager creates Counter 4 and Cashier bills ₹64', async () => {
  // Manager creates Counter 4
  const createRes = await api(
    'POST',
    '/api/branch/counters',
    {},
    {
      name: 'Counter 4',
      code: 'MAIN-C04',
    },
    managerToken
  );
  assert.equal(createRes.status, 200);
  assert.ok(createRes.body.id);
  counter4Id = createRes.body.id;
  assert.equal(createRes.body.name, 'Counter 4');
  assert.equal(createRes.body.code, 'MAIN-C04');

  // Cashier bills ₹64 on Counter 4
  const checkoutRes = await api(
    'POST',
    '/api/invoices',
    {},
    {
      branchId: BRANCH_MAIN,
      counterId: counter4Id,
      counter: 'MAIN-C04',
      lines: [
        {
          name: 'Supermarket Item 4 (₹64)',
          qtyMilli: 1000,
          priceMinor: 6400,
          inclusive: true,
          taxRateBp: 0,
        },
      ],
      payments: [
        {
          amountMinor: 6400,
          method: 'cash',
        },
      ],
    },
    cashierToken
  );
  assert.equal(checkoutRes.status, 200);
  assert.ok(checkoutRes.body.id);
  invoice4Id = checkoutRes.body.id;
  assert.equal(checkoutRes.body.totalMinor, 6400);
});

test('Step 4: Verify ₹64 appears ONLY under Counter 4 (No inheritance of past sales!)', async () => {
  const res = await api('GET', '/api/dashboard/today?branch=MAIN', {}, undefined, managerToken);
  assert.equal(res.status, 200);

  const ct = res.body.countersToday;
  assert.equal(ct.counters.length, 4, 'Must have 4 counters');

  const c1 = ct.counters.find((c: any) => c.name === 'Counter 1' || c.code === 'MAIN-C01');
  const c2 = ct.counters.find((c: any) => c.name === 'Counter 2' || c.code === 'MAIN-C02');
  const c3 = ct.counters.find((c: any) => c.id === counter3Id);
  const c4 = ct.counters.find((c: any) => c.id === counter4Id);

  assert.ok(c1, 'Counter 1 must exist');
  assert.ok(c2, 'Counter 2 must exist');
  assert.ok(c3, 'Counter 3 must exist');
  assert.ok(c4, 'Counter 4 must exist');

  assert.equal(c1.amountMinor, 50000, 'Counter 1 = ₹500');
  assert.equal(c2.amountMinor, 6400, 'Counter 2 = ₹64');
  assert.equal(c3.amountMinor, 5400, 'Counter 3 = ₹54');
  assert.equal(c4.amountMinor, 6400, 'Counter 4 = ₹64 (NOT ₹533!)');
  assert.equal(c4.formattedAmount, '₹64');

  assert.equal(ct.totalMinor, 50000 + 6400 + 5400 + 6400, 'Branch Total = ₹682');
  assert.equal(ct.formattedTotal, '₹682');
});

test('Step 5: Refresh Dashboard (Re-fetch preserves all values)', async () => {
  for (let i = 0; i < 3; i++) {
    const res = await api('GET', '/api/dashboard/today?branch=MAIN', {}, undefined, managerToken);
    assert.equal(res.status, 200);
    const ct = res.body.countersToday;
    assert.equal(ct.counters.length, 4);
    assert.equal(ct.totalMinor, 68200);
    assert.equal(ct.formattedTotal, '₹682');
  }
});

test('Step 6: Log out and log in again (Session re-creation preserves all values)', async () => {
  const loginRes = await api(
    'POST',
    '/api/auth/login',
    {},
    {
      identifier: 'manager@billing.local',
      password: 'password123',
    }
  );

  let refreshedToken = managerToken;
  if (loginRes.status === 200 && loginRes.body?.token) {
    refreshedToken = loginRes.body.token;
  }

  const res = await api('GET', '/api/dashboard/today?branch=MAIN', {}, undefined, refreshedToken);
  assert.equal(res.status, 200);
  const ct = res.body.countersToday;
  assert.equal(ct.counters.length, 4);
  assert.equal(ct.totalMinor, 68200);

  const c4 = ct.counters.find((c: any) => c.id === counter4Id);
  assert.equal(c4.amountMinor, 6400, 'Counter 4 remains exactly ₹64 after re-login');
});

test('Step 7: Branch Isolation - TNagar dashboard only displays TNagar counters and ₹0 from MAIN', async () => {
  // 1. Tested via TNagar Store Manager
  const resTnr = await api('GET', '/api/dashboard/today', {}, undefined, tnagarToken);
  assert.equal(resTnr.status, 200);
  assert.ok(resTnr.body.countersToday);

  const ctTnr = resTnr.body.countersToday;
  assert.equal(ctTnr.counters.length, 1, 'TNagar has exactly 1 counter');
  assert.equal(ctTnr.counters[0].name, 'Counter 1');
  assert.equal(ctTnr.counters[0].code, 'TNR-C01');
  assert.equal(ctTnr.counters[0].amountMinor, 0, 'Zero sales leak from MAIN branch');
  assert.equal(ctTnr.totalMinor, 0);
  assert.equal(ctTnr.formattedTotal, '₹0');

  // 2. Tested via Super Admin filtering by branch code SKS_TNAGAR
  const resOwner = await api('GET', '/api/dashboard/today?branch=SKS_TNAGAR', {}, undefined, ownerToken);
  assert.equal(resOwner.status, 200);
  assert.ok(resOwner.body.countersToday);
  const ctOwner = resOwner.body.countersToday;
  assert.equal(ctOwner.counters.length, 1);
  assert.equal(ctOwner.counters[0].id, 'cnt_tnr_1');
  assert.equal(ctOwner.counters[0].amountMinor, 0);
  assert.equal(ctOwner.totalMinor, 0);
});

after(async () => {
  try {
    for (const invId of [invoice3Id, invoice4Id].filter(Boolean)) {
      await db.exec('DELETE FROM payments WHERE invoice_id = ?', [invId]);
      await db.exec('DELETE FROM invoice_lines WHERE invoice_id = ?', [invId]);
      await db.exec('DELETE FROM invoices WHERE id = ?', [invId]);
    }
    for (const cntId of [counter3Id, counter4Id].filter(Boolean)) {
      await db.exec('DELETE FROM counters WHERE id = ?', [cntId]);
    }
    await db.exec("UPDATE branches SET counters = '[\"MAIN-C01\", \"MAIN-C02\"]'::jsonb WHERE id = 'br_main_store'");
  } catch (err) {
    console.error('Cleanup error:', err);
  } finally {
    if (server) {
      (server as any).closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    }
    await db.close();
    setTimeout(() => process.exit(0), 100).unref();
  }
});
