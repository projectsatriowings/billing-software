import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';
import { createApp } from '../src/app.ts';
import { connectDb, type DB } from '../src/db/index.ts';
import { signToken, hashPassword, passwordStamp, newId } from '../src/security.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-long-enough-32-chars-at-least';
const TEST_TENANT = 't_cnt_test_' + Date.now();
const BRANCH_ANNA_NAGAR = 'b_anna_cnt_' + Date.now();
const BRANCH_T_NAGAR = 'b_tnagar_cnt_' + Date.now();

let db: DB;
let server: http.Server;
let base = '';
let mgrAnnaToken = '';
let mgrTNagarToken = '';
let cashierAnnaToken = '';
let mgrAnnaId = '';
let mgrTNagarId = '';
let cashierAnnaId = '';

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
  await db.exec(`INSERT INTO tenants (id, name, business_type, state_code) VALUES (?, 'Counter Cashier Retail', 'retail', '33')`, [TEST_TENANT]);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, code, active) VALUES (?, ?, 'Anna Nagar', 'ANNA', true)`, [BRANCH_ANNA_NAGAR, TEST_TENANT]);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, code, active) VALUES (?, ?, 'T Nagar', 'TNAGAR', true)`, [BRANCH_T_NAGAR, TEST_TENANT]);

  // 2. Setup Store Managers
  const pwd = hashPassword('ManagerPass123!');
  mgrAnnaId = 'u_mgr_anna_' + Date.now();
  mgrTNagarId = 'u_mgr_tnagar_' + Date.now();

  await db.exec(
    `INSERT INTO users (id, tenant_id, branch_id, name, email, password_hash, role, active)
     VALUES (?, ?, ?, 'Anna Manager', ?, ?, 'manager', true)`,
    [mgrAnnaId, TEST_TENANT, BRANCH_ANNA_NAGAR, `mgr_anna_${Date.now()}@store.local`, pwd]
  );
  mgrAnnaToken = signToken({ sub: mgrAnnaId, tid: TEST_TENANT, ph: passwordStamp(pwd), role: 'manager', branchId: BRANCH_ANNA_NAGAR }, JWT_SECRET, 3600);

  await db.exec(
    `INSERT INTO users (id, tenant_id, branch_id, name, email, password_hash, role, active)
     VALUES (?, ?, ?, 'T Nagar Manager', ?, ?, 'manager', true)`,
    [mgrTNagarId, TEST_TENANT, BRANCH_T_NAGAR, `mgr_tnagar_${Date.now()}@store.local`, pwd]
  );
  mgrTNagarToken = signToken({ sub: mgrTNagarId, tid: TEST_TENANT, ph: passwordStamp(pwd), role: 'manager', branchId: BRANCH_T_NAGAR }, JWT_SECRET, 3600);
});

after(async () => {
  try {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    if (db) {
      await db.exec('DELETE FROM invoices WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM shifts WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM payments WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM counters WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM users WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM branches WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM tenants WHERE id = ?', [TEST_TENANT]);
      await db.close();
    }
  } catch {}
  process.exit(0);
});

test('1. Create counter requires only name and code; automatically scoped to manager branch', async () => {
  const res = await api('POST', '/api/branch/counters', {}, {
    name: 'Counter Express 1',
    code: 'CNT-01',
  }, mgrAnnaToken);

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.name, 'Counter Express 1');
  assert.equal(res.body.code, 'CNT-01');
  assert.equal(res.body.status, 'ACTIVE');

  // Verify stored in DB with branch_id = BRANCH_ANNA_NAGAR
  const row = await db.one<any>('SELECT * FROM counters WHERE id = ?', [res.body.id]);
  assert.ok(row);
  assert.equal(row.branchId, BRANCH_ANNA_NAGAR);
  assert.equal(row.name, 'Counter Express 1');
  assert.equal(row.code, 'CNT-01');
  assert.equal(row.status, 'ACTIVE');
});

test('2. Reject duplicate counter code in the same branch', async () => {
  const res = await api('POST', '/api/branch/counters', {}, {
    name: 'Counter Another',
    code: 'CNT-01', // duplicate code in Anna Nagar
  }, mgrAnnaToken);

  assert.equal(res.status, 409);
  assert.match(res.body.error.message || res.body.error, /already exists in your branch/i);
});

test('3. Reject duplicate counter name in the same branch', async () => {
  const res = await api('POST', '/api/branch/counters', {}, {
    name: 'Counter Express 1', // duplicate name in Anna Nagar
    code: 'CNT-02',
  }, mgrAnnaToken);

  assert.equal(res.status, 409);
  assert.match(res.body.error.message || res.body.error, /already exists in your branch/i);
});

test('4. Allow same counter code and name in a different branch', async () => {
  // T Nagar manager adds counter with identical name and code
  const res = await api('POST', '/api/branch/counters', {}, {
    name: 'Counter Express 1',
    code: 'CNT-01',
  }, mgrTNagarToken);

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.code, 'CNT-01');

  // Verify in DB under T Nagar
  const row = await db.one<any>('SELECT * FROM counters WHERE id = ?', [res.body.id]);
  assert.ok(row);
  assert.equal(row.branchId, BRANCH_T_NAGAR);
});

test('5. Add cashier requires only Name, Username or Email, and Password (no default counter required)', async () => {
  const cashierUsername = 'csh_' + Date.now().toString(36).slice(-6);
  const res = await api('POST', '/api/branch/cashiers', {}, {
    name: 'Lakshmi Cashier',
    username: cashierUsername,
    password: 'Password123!',
  }, mgrAnnaToken);

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.name, 'Lakshmi Cashier');
  cashierAnnaId = res.body.id;

  // Verify in DB: counter_id is NULL and branch_id is BRANCH_ANNA_NAGAR
  const row = await db.one<any>('SELECT * FROM users WHERE id = ?', [cashierAnnaId]);
  assert.ok(row);
  assert.equal(row.branchId, BRANCH_ANNA_NAGAR);
  assert.equal(row.counterId, null);
  assert.equal(row.role, 'cashier');

  // Generate cashier token for later tests
  cashierAnnaToken = signToken(
    { sub: cashierAnnaId, tid: TEST_TENANT, ph: passwordStamp(row.passwordHash), role: 'cashier', branchId: BRANCH_ANNA_NAGAR },
    JWT_SECRET,
    3600
  );
});

test('6. Counter list returns only counters for the manager branch with name, code, status', async () => {
  const res = await api('GET', '/api/branch/counters', {}, undefined, mgrAnnaToken);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.counters));
  assert.equal(res.body.counters.length, 1);
  assert.equal(res.body.counters[0].code, 'CNT-01');
  assert.equal(res.body.counters[0].status, 'ACTIVE');
  // Must NOT include sensitive columns or unrelated branch counters
  assert.equal(res.body.counters[0].loginUsername, undefined);
  assert.equal(res.body.counters[0].assignedCashiers, undefined);
});

test('7. Counter status toggle (ACTIVE <-> DISABLED)', async () => {
  const listRes = await api('GET', '/api/branch/counters', {}, undefined, mgrAnnaToken);
  const counterId = listRes.body.counters[0].id;

  // Disable counter
  const disableRes = await api('PATCH', `/api/branch/counters/${counterId}/status`, {}, {
    status: 'DISABLED',
  }, mgrAnnaToken);
  assert.equal(disableRes.status, 200);
  assert.equal(disableRes.body.status, 'DISABLED');

  // Verify in DB
  const rowAfterDisable = await db.one<any>('SELECT status FROM counters WHERE id = ?', [counterId]);
  assert.equal(rowAfterDisable.status, 'DISABLED');

  // Re-enable counter
  const enableRes = await api('PATCH', `/api/branch/counters/${counterId}/status`, {}, {
    status: 'ACTIVE',
  }, mgrAnnaToken);
  assert.equal(enableRes.status, 200);
  assert.equal(enableRes.body.status, 'ACTIVE');

  const rowAfterEnable = await db.one<any>('SELECT status FROM counters WHERE id = ?', [counterId]);
  assert.equal(rowAfterEnable.status, 'ACTIVE');
});

test('8. Invoice creation validates counter: disabled or wrong branch rejected', async () => {
  // Create an item and stock in Anna Nagar for invoicing
  const itemId = 'it_cnt_test_' + Date.now();
  await db.exec(
    `INSERT INTO items (id, tenant_id, branch_id, name, sku, barcode, unit, category, price_minor, cost_minor, track_stock, active)
     VALUES (?, ?, ?, 'Test Biscuit', 'TB-01', '8901234567891', 'pcs', 'General', 1000, 800, true, true)`,
    [itemId, TEST_TENANT, BRANCH_ANNA_NAGAR]
  );
  await db.exec(
    `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, location, qty_milli, kind)
     VALUES (?, ?, ?, ?, 'MAIN', 100000, 'opening')`,
    [newId('sm'), TEST_TENANT, BRANCH_ANNA_NAGAR, itemId]
  );

  // Start shift for Cashier in Anna Nagar
  const shiftId = 'sh_' + Date.now();
  await db.exec(
    `INSERT INTO shifts (id, tenant_id, branch_id, user_id, counter, status, opened_at)
     VALUES (?, ?, ?, ?, 'CNT-01', 'open', now())`,
    [shiftId, TEST_TENANT, BRANCH_ANNA_NAGAR, cashierAnnaId]
  );

  // A) Bill with counter from T Nagar should be rejected
  const wrongBranchRes = await api('POST', '/api/invoices', {}, {
    counter: 'NON_EXISTENT_CNT',
    customerPhone: '9876543210',
    lines: [{ itemId, name: 'Test Biscuit', qtyMilli: 1000, priceMinor: 1000 }],
    payments: [{ method: 'cash', amountMinor: 1000 }],
  }, cashierAnnaToken);
  assert.equal(wrongBranchRes.status, 400);
  assert.match(wrongBranchRes.body.error?.message || wrongBranchRes.body.error, /does not belong to this branch/i);

  // B) Disable CNT-01 and verify bill rejected with COUNTER_DISABLED
  const annaCounter = await db.one<any>('SELECT id FROM counters WHERE branch_id = ? AND code = ?', [BRANCH_ANNA_NAGAR, 'CNT-01']);
  await db.exec("UPDATE counters SET status = 'DISABLED' WHERE id = ?", [annaCounter.id]);

  const disabledRes = await api('POST', '/api/invoices', {}, {
    counter: 'CNT-01',
    customerPhone: '9876543210',
    lines: [{ itemId, name: 'Test Biscuit', qtyMilli: 1000, priceMinor: 1000 }],
    payments: [{ method: 'cash', amountMinor: 1000 }],
  }, cashierAnnaToken);
  assert.equal(disabledRes.status, 400);
  assert.match(disabledRes.body.error?.message || disabledRes.body.error, /currently disabled/i);

  // C) Re-enable CNT-01 and verify bill succeeds
  await db.exec("UPDATE counters SET status = 'ACTIVE' WHERE id = ?", [annaCounter.id]);

  const successRes = await api('POST', '/api/invoices', {}, {
    counter: 'CNT-01',
    customerPhone: '9876543210',
    lines: [{ itemId, name: 'Test Biscuit', qtyMilli: 1000, priceMinor: 1000 }],
    payments: [{ method: 'cash', amountMinor: 1000 }],
  }, cashierAnnaToken);
  assert.equal(successRes.status, 200);
  assert.ok(successRes.body.number);
  assert.equal(successRes.body.counter, 'CNT-01');
});

test('9. Counter deletion safety: rejected if counter has billing history', async () => {
  const annaCounter = await db.one<any>('SELECT id, name FROM counters WHERE branch_id = ? AND code = ?', [BRANCH_ANNA_NAGAR, 'CNT-01']);

  // Impact check
  const impactRes = await api('GET', `/api/branch/counters/${annaCounter.id}/delete-impact`, {}, undefined, mgrAnnaToken);
  assert.equal(impactRes.status, 200);
  assert.equal(impactRes.body.hasHistory, true);
  assert.equal(impactRes.body.canDelete, false);

  // Attempt delete
  const deleteRes = await api('DELETE', `/api/branch/counters/${annaCounter.id}`, {}, undefined, mgrAnnaToken);
  assert.equal(deleteRes.status, 409);
  assert.match(deleteRes.body.error?.message || deleteRes.body.error, /existing billing transactions or shift history/i);

  // Counter should still exist in DB
  const check = await db.one('SELECT id FROM counters WHERE id = ?', [annaCounter.id]);
  assert.ok(check);
});

test('10. Counter without billing history can be safely deleted', async () => {
  // Create a clean counter with no history
  const createRes = await api('POST', '/api/branch/counters', {}, {
    name: 'Temporary Counter',
    code: 'CNT-TEMP',
  }, mgrAnnaToken);
  assert.equal(createRes.status, 200);
  const tempId = createRes.body.id;

  // Impact check
  const impactRes = await api('GET', `/api/branch/counters/${tempId}/delete-impact`, {}, undefined, mgrAnnaToken);
  assert.equal(impactRes.status, 200);
  assert.equal(impactRes.body.hasHistory, false);
  assert.equal(impactRes.body.canDelete, true);

  // Delete
  const delRes = await api('DELETE', `/api/branch/counters/${tempId}`, {}, undefined, mgrAnnaToken);
  assert.equal(delRes.status, 200);
  assert.equal(delRes.body.ok, true);

  // Verify gone from DB
  const check = await db.one('SELECT id FROM counters WHERE id = ?', [tempId]);
  assert.equal(check, undefined);
});
