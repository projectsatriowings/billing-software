import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';
import { createApp } from '../src/app.ts';
import { connectDb, type DB } from '../src/db/index.ts';
import { signToken, hashPassword, passwordStamp } from '../src/security.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-long-enough-32-chars-at-least';
const TEST_TENANT = 't_test_branch_sel_' + Date.now();
const BRANCH_MAIN = 'b_main_' + Date.now();
const BRANCH_PORUR = 'b_por_' + Date.now();

let db: DB;
let server: http.Server;
let base = '';
let ownerToken = '';
let managerPorurToken = '';

async function api(method: string, path: string, headers: Record<string, string> = {}, token?: string) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
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
  await db.exec(`INSERT INTO tenants (id, name, business_type) VALUES (?, 'Branch Scope Mart', 'retail')`, [TEST_TENANT]);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, code, active) VALUES (?, ?, 'Main Store', 'MAIN', true)`, [BRANCH_MAIN, TEST_TENANT]);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, code, active) VALUES (?, ?, 'Porur Store', 'PORUR', true)`, [BRANCH_PORUR, TEST_TENANT]);

  // 2. Setup Super Admin and Store Manager
  const pwd = hashPassword('TestPass123!');
  const ownerId = 'u_owner_' + Date.now();
  const mgrPorurId = 'u_mgrpor_' + Date.now();

  await db.exec(
    `INSERT INTO users (id, tenant_id, branch_id, name, email, password_hash, role, active)
     VALUES (?, ?, NULL, 'Super Owner', 'owner@branches.local', ?, 'owner', true)`,
    [ownerId, TEST_TENANT, pwd]
  );
  await db.exec(
    `INSERT INTO users (id, tenant_id, branch_id, name, email, password_hash, role, active)
     VALUES (?, ?, ?, 'Porur Manager', 'mgrporur@branches.local', ?, 'manager', true)`,
    [mgrPorurId, TEST_TENANT, BRANCH_PORUR, pwd]
  );

  ownerToken = signToken({ sub: ownerId, tid: TEST_TENANT, ph: passwordStamp(pwd), role: 'owner' }, JWT_SECRET, 3600);
  managerPorurToken = signToken({ sub: mgrPorurId, tid: TEST_TENANT, ph: passwordStamp(pwd), role: 'manager', branchId: BRANCH_PORUR }, JWT_SECRET, 3600);

  // 3. Seed Items
  // MAIN: 2 items
  const itM1 = 'it_m1_' + Date.now();
  const itM2 = 'it_m2_' + Date.now();
  await db.exec(
    `INSERT INTO items (id, tenant_id, branch_id, name, sku, unit, price_minor, cost_minor, track_stock, active)
     VALUES (?, ?, ?, 'Main Biscuit', 'BIS-M1', 'pcs', 3000, 2000, true, true)`,
    [itM1, TEST_TENANT, BRANCH_MAIN]
  );
  await db.exec(
    `INSERT INTO items (id, tenant_id, branch_id, name, sku, unit, price_minor, cost_minor, track_stock, active)
     VALUES (?, ?, ?, 'Main Chocolate', 'CHOC-M2', 'pcs', 5000, 3500, true, true)`,
    [itM2, TEST_TENANT, BRANCH_MAIN]
  );

  // PORUR: 1 item
  const itP1 = 'it_p1_' + Date.now();
  await db.exec(
    `INSERT INTO items (id, tenant_id, branch_id, name, sku, unit, price_minor, cost_minor, track_stock, active)
     VALUES (?, ?, ?, 'Porur Juice', 'JUI-P1', 'pcs', 6000, 4000, true, true)`,
    [itP1, TEST_TENANT, BRANCH_PORUR]
  );

  // 4. Seed Categories
  await db.exec(
    `INSERT INTO categories (id, tenant_id, branch_id, name, active) VALUES ('cat_m1_' || ?, ?, ?, 'Main Snacks', true)`,
    [Date.now(), TEST_TENANT, BRANCH_MAIN]
  );
  await db.exec(
    `INSERT INTO categories (id, tenant_id, branch_id, name, active) VALUES ('cat_p1_' || ?, ?, ?, 'Porur Beverages', true)`,
    [Date.now(), TEST_TENANT, BRANCH_PORUR]
  );

  // 5. Seed Invoices
  // Invoice in MAIN
  await db.exec(
    `INSERT INTO invoices (id, tenant_id, branch_id, client_id, number, kind, status, bdate, subtotal_minor, taxable_minor, cgst_minor, sgst_minor, round_off_minor, total_minor, paid_minor, balance_minor, rule_version, calc, custom, share_token)
     VALUES ('inv_m1_' || ?, ?, ?, 'cid1', 'INV-MAIN-001', 'sale', 'posted', now()::date::text, 3000, 3000, 0, 0, 0, 3000, 3000, 0, '1.0', '{}'::jsonb, '{}'::jsonb, 'tok1_' || ?)`,
    [Date.now(), TEST_TENANT, BRANCH_MAIN, Date.now()]
  );
  // Invoice in PORUR
  await db.exec(
    `INSERT INTO invoices (id, tenant_id, branch_id, client_id, number, kind, status, bdate, subtotal_minor, taxable_minor, cgst_minor, sgst_minor, round_off_minor, total_minor, paid_minor, balance_minor, rule_version, calc, custom, share_token)
     VALUES ('inv_p1_' || ?, ?, ?, 'cid2', 'INV-POR-001', 'sale', 'posted', now()::date::text, 6000, 6000, 0, 0, 0, 6000, 6000, 0, '1.0', '{}'::jsonb, '{}'::jsonb, 'tok2_' || ?)`,
    [Date.now(), TEST_TENANT, BRANCH_PORUR, Date.now()]
  );
});

after(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
  if (db) {
    await db.exec('DELETE FROM invoices WHERE tenant_id = ?', [TEST_TENANT]);
    await db.exec('DELETE FROM categories WHERE tenant_id = ?', [TEST_TENANT]);
    await db.exec('DELETE FROM items WHERE tenant_id = ?', [TEST_TENANT]);
    await db.exec('DELETE FROM users WHERE tenant_id = ?', [TEST_TENANT]);
    await db.exec('DELETE FROM branches WHERE tenant_id = ?', [TEST_TENANT]);
    await db.exec('DELETE FROM tenants WHERE id = ?', [TEST_TENANT]);
    await db.close();
  }
});

test('1. Super Admin "all" returns consolidated items, categories, and invoices', async () => {
  const resItems = await api('GET', '/api/items', { 'x-branch-id': 'all' }, ownerToken);
  assert.equal(resItems.status, 200);
  assert.equal(resItems.body.items.length, 3, 'All 3 items across branches must be returned');

  const resInvoices = await api('GET', '/api/invoices', { 'x-branch-id': 'all' }, ownerToken);
  assert.equal(resInvoices.status, 200);
  assert.equal(resInvoices.body.invoices.length, 2, 'All 2 invoices across branches must be returned');

  const resCats = await api('GET', '/api/categories', { 'x-branch-id': 'all' }, ownerToken);
  assert.equal(resCats.status, 200);
  assert.equal(resCats.body.categories.length, 2, 'All 2 categories across branches must be returned');
});

test('2. Super Admin selecting Branch MAIN filters modules to MAIN', async () => {
  const resItems = await api('GET', '/api/items', { 'x-branch-id': 'MAIN' }, ownerToken);
  assert.equal(resItems.status, 200);
  assert.equal(resItems.body.items.length, 2, 'Only 2 items from MAIN must be returned');
  assert.ok(resItems.body.items.every((i: any) => i.branchId === BRANCH_MAIN));

  const resInvoices = await api('GET', '/api/invoices', { 'x-branch-id': 'MAIN' }, ownerToken);
  assert.equal(resInvoices.status, 200);
  assert.equal(resInvoices.body.invoices.length, 1, 'Only 1 invoice from MAIN must be returned');
  assert.equal(resInvoices.body.invoices[0].number, 'INV-MAIN-001');

  const resCats = await api('GET', '/api/categories', { 'x-branch-id': 'MAIN' }, ownerToken);
  assert.equal(resCats.status, 200);
  assert.equal(resCats.body.categories.length, 1, 'Only MAIN category must be returned');
  assert.equal(resCats.body.categories[0].name, 'Main Snacks');
});

test('3. Super Admin selecting Branch PORUR filters modules to PORUR', async () => {
  const resItems = await api('GET', '/api/items', { 'x-branch-id': 'PORUR' }, ownerToken);
  assert.equal(resItems.status, 200);
  assert.equal(resItems.body.items.length, 1, 'Only 1 item from PORUR must be returned');
  assert.equal(resItems.body.items[0].sku, 'JUI-P1');

  const resInvoices = await api('GET', '/api/invoices', { 'x-branch-id': 'PORUR' }, ownerToken);
  assert.equal(resInvoices.status, 200);
  assert.equal(resInvoices.body.invoices.length, 1, 'Only 1 invoice from PORUR must be returned');
  assert.equal(resInvoices.body.invoices[0].number, 'INV-POR-001');

  const resCats = await api('GET', '/api/categories', { 'x-branch-id': 'PORUR' }, ownerToken);
  assert.equal(resCats.status, 200);
  assert.equal(resCats.body.categories.length, 1, 'Only PORUR category must be returned');
  assert.equal(resCats.body.categories[0].name, 'Porur Beverages');
});

test('4. Store Manager cannot bypass branch isolation by sending different x-branch-id', async () => {
  // Store Manager for PORUR tries to request MAIN or all
  const resItems = await api('GET', '/api/items', { 'x-branch-id': 'MAIN' }, managerPorurToken);
  assert.equal(resItems.status, 200);
  // Manager must still strictly receive only their assigned PORUR items!
  assert.equal(resItems.body.items.length, 1);
  assert.equal(resItems.body.items[0].sku, 'JUI-P1');

  const resInvoices = await api('GET', '/api/invoices', { 'x-branch-id': 'all' }, managerPorurToken);
  assert.equal(resInvoices.status, 200);
  assert.equal(resInvoices.body.invoices.length, 1);
  assert.equal(resInvoices.body.invoices[0].number, 'INV-POR-001');
});
