import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';
import { createApp } from '../src/app.ts';
import { connectWire } from '../src/db/wire.ts';
import { migrate, type DB } from '../src/db/index.ts';
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
  server = http.createServer(createApp(db, { secret: 'test-role-dashboards-secret', log: false }));
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

const PW = 'Password123!';
let ownerToken = '';
let managerToken = '';
let cashierToken = '';
let northBranchId = '';
let testItemId = '';

test('role dashboards: register business and verify default MAIN branch', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const reg = await api('POST', '/api/auth/register', {
    name: 'Mega Mart Supermarket',
    businessType: 'retail',
    ownerName: 'Apex Owner',
    email: 'owner@megamart.local',
    password: PW,
    phone: '9876543210',
  });
  assert.equal(reg.status, 200, `Register failed: ${reg.text}`);
  ownerToken = reg.body.token;

  // Owner lists branches
  const branchesRes = await api('GET', '/api/branches', undefined, ownerToken);
  assert.equal(branchesRes.status, 200);
  assert.ok(Array.isArray(branchesRes.body.branches));
  assert.ok(branchesRes.body.branches.length >= 1);
  const mainBranch = branchesRes.body.branches.find((b: any) => b.code === 'MAIN');
  assert.ok(mainBranch, 'Default MAIN branch must exist');
});

test('role dashboards: owner creates NORTH branch', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const createRes = await api('POST', '/api/branches', {
    code: 'NORTH',
    name: 'Mega Mart North Branch',
    address: '42 Commercial Street, North Wing',
    phone: '9123456780',
    counters: ['COUNTER-1', 'COUNTER-2'],
  }, ownerToken);

  assert.equal(createRes.status, 200, `Failed to create branch: ${createRes.text}`);
  assert.equal(createRes.body.code, 'NORTH');
  northBranchId = createRes.body.id;
  assert.deepEqual(createRes.body.counters, ['COUNTER-1', 'COUNTER-2']);
});

test('role dashboards: owner creates store manager and cashier with branch/counter assignment', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // Create Store Manager assigned to NORTH
  const mgrRes = await api('POST', '/api/users', {
    name: 'Naveen Manager',
    email: 'manager.north@megamart.local',
    password: PW,
    role: 'manager',
    assignedLocation: 'NORTH',
    allowedLocations: ['NORTH'],
  }, ownerToken);
  assert.equal(mgrRes.status, 200, `Failed to create manager: ${mgrRes.text}`);

  // Create Cashier assigned to NORTH and COUNTER-2
  const cshRes = await api('POST', '/api/users', {
    name: 'Priya Cashier',
    email: 'cashier.north@megamart.local',
    password: PW,
    role: 'cashier',
    assignedLocation: 'NORTH',
    assignedCounter: 'COUNTER-2',
    allowedLocations: ['NORTH'],
  }, ownerToken);
  assert.equal(cshRes.status, 200, `Failed to create cashier: ${cshRes.text}`);

  // Log in as manager
  const mgrLogin = await api('POST', '/api/auth/login', {
    email: 'manager.north@megamart.local',
    password: PW,
  });
  assert.equal(mgrLogin.status, 200);
  managerToken = mgrLogin.body.token;
  assert.equal(mgrLogin.body.user.assignedLocation, 'NORTH');

  // Log in as cashier
  const cshLogin = await api('POST', '/api/auth/login', {
    email: 'cashier.north@megamart.local',
    password: PW,
  });
  assert.equal(cshLogin.status, 200);
  cashierToken = cshLogin.body.token;
  assert.equal(cshLogin.body.user.assignedLocation, 'NORTH');
  assert.equal(cshLogin.body.user.assignedCounter, 'COUNTER-2');
});

test('role dashboards: store manager authorization restrictions', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // Store manager lists branches -> only their assigned branches returned
  const mgrBranches = await api('GET', '/api/branches', undefined, managerToken);
  assert.equal(mgrBranches.status, 200);
  assert.equal(mgrBranches.body.branches.length, 1);
  assert.equal(mgrBranches.body.branches[0].code, 'NORTH');

  // Store manager cannot create a new company branch (owner only)
  const forbiddenCreate = await api('POST', '/api/branches', {
    code: 'SOUTH',
    name: 'Mega Mart South',
  }, managerToken);
  assert.equal(forbiddenCreate.status, 403);

  // Store manager can fetch summary for their assigned branch
  const northSummary = await api('GET', `/api/branches/${northBranchId}/summary`, undefined, managerToken);
  assert.equal(northSummary.status, 200);
  assert.equal(northSummary.body.branch.code, 'NORTH');

  // Cashier cannot access reports dashboard endpoint
  const cashierReports = await api('GET', '/api/reports/dashboard', undefined, cashierToken);
  assert.equal(cashierReports.status, 403);
});

test('role dashboards: cashier opens shift at NORTH counter-2 and creates bill', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // Create an item as owner
  const itemRes = await api('POST', '/api/items', {
    name: 'Basmati Rice 5kg',
    priceMinor: 45000,
    openingQtyMilli: 50000,
  }, ownerToken);
  assert.equal(itemRes.status, 200, `Failed to create item: ${itemRes.text}`);
  testItemId = itemRes.body.item.id;

  // Cashier opens shift
  const openRes = await api('POST', '/api/shifts', {
    openingCashMinor: 200000, // Rs 2000 float
    location: 'NORTH',
    counter: 'COUNTER-2',
    notes: 'Morning shift opening',
  }, cashierToken);
  assert.equal(openRes.status, 200, `Failed to open shift: ${openRes.text}`);
  assert.equal(openRes.body.shift.location, 'NORTH');
  assert.equal(openRes.body.shift.counter, 'COUNTER-2');

  // Cashier checks out an invoice
  const invRes = await api('POST', '/api/invoices', {
    customerName: 'Walk-in Customer',
    lines: [
      {
        itemId: testItemId,
        name: 'Basmati Rice 5kg',
        qtyMilli: 2000, // 2 bags
        priceMinor: 45000,
      },
    ],
    payments: [
      {
        method: 'cash',
        amountMinor: 90000, // Rs 900
      },
    ],
  }, cashierToken);

  assert.equal(invRes.status, 200, `Checkout failed: ${invRes.text}`);
  assert.equal(invRes.body.location, 'NORTH');
  assert.equal(invRes.body.counter, 'COUNTER-2');

  // Verify shift summary reflects this cash sale
  const activeShiftRes = await api('GET', '/api/shifts/active', undefined, cashierToken);
  assert.equal(activeShiftRes.status, 200);
  assert.ok(activeShiftRes.body.activeShift);
  assert.equal(activeShiftRes.body.activeShift.summary.cashSalesMinor, 90000);
  assert.equal(activeShiftRes.body.activeShift.summary.expectedCashMinor, 290000); // 2000 + 900
});

test('role dashboards: super admin consolidated reporting with branch comparison', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const reportRes = await api('GET', '/api/reports/dashboard?branchComparison=true', undefined, ownerToken);
  assert.equal(reportRes.status, 200);
  assert.ok(Array.isArray(reportRes.body.branchComparison));

  const northRow = reportRes.body.branchComparison.find((b: any) => b.code === 'NORTH');
  assert.ok(northRow, 'NORTH branch must be present in branchComparison');
  assert.equal(northRow.todaySalesTotalMinor, 90000);
  assert.equal(northRow.todaySalesCount, 1);
  assert.equal(northRow.openShiftsCount, 1);
});
