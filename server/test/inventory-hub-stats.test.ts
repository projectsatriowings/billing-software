import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';
import { createApp } from '../src/app.ts';
import { connectDb, type DB } from '../src/db/index.ts';
import { signToken, hashPassword, passwordStamp } from '../src/security.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-long-enough-32-chars-at-least';
const TEST_TENANT = 't_test_inv_hub_' + Date.now();
const BRANCH_MAIN = 'b_main_' + Date.now();
const BRANCH_SECONDARY = 'b_sec_' + Date.now();

let db: DB;
let server: http.Server;
let base = '';
let ownerToken = '';
let managerMainToken = '';
let managerSecToken = '';

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
  await db.exec(`INSERT INTO tenants (id, name, business_type) VALUES (?, 'Inventory Hub Test Mart', 'retail')`, [TEST_TENANT]);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, code, active) VALUES (?, ?, 'Main Branch', 'MAIN', true)`, [BRANCH_MAIN, TEST_TENANT]);
  await db.exec(`INSERT INTO branches (id, tenant_id, name, code, active) VALUES (?, ?, 'Porur Branch', 'PORUR', true)`, [BRANCH_SECONDARY, TEST_TENANT]);

  // 2. Setup Users
  const pwd = hashPassword('TestPass123!');
  const ownerId = 'u_owner_' + Date.now();
  const mgrMainId = 'u_mgrmain_' + Date.now();
  const mgrSecId = 'u_mgrsec_' + Date.now();

  await db.exec(
    `INSERT INTO users (id, tenant_id, branch_id, name, email, password_hash, role, active)
     VALUES (?, ?, NULL, 'Owner Admin', 'owner@invtest.local', ?, 'owner', true)`,
    [ownerId, TEST_TENANT, pwd]
  );
  await db.exec(
    `INSERT INTO users (id, tenant_id, branch_id, name, email, password_hash, role, active)
     VALUES (?, ?, ?, 'Manager Main', 'mgr1@invtest.local', ?, 'manager', true)`,
    [mgrMainId, TEST_TENANT, BRANCH_MAIN, pwd]
  );
  await db.exec(
    `INSERT INTO users (id, tenant_id, branch_id, name, email, password_hash, role, active)
     VALUES (?, ?, ?, 'Manager Sec', 'mgr2@invtest.local', ?, 'manager', true)`,
    [mgrSecId, TEST_TENANT, BRANCH_SECONDARY, pwd]
  );

  ownerToken = signToken({ sub: ownerId, tid: TEST_TENANT, ph: passwordStamp(pwd), role: 'owner' }, JWT_SECRET, 3600);
  managerMainToken = signToken({ sub: mgrMainId, tid: TEST_TENANT, ph: passwordStamp(pwd), role: 'manager', branchId: BRANCH_MAIN }, JWT_SECRET, 3600);
  managerSecToken = signToken({ sub: mgrSecId, tid: TEST_TENANT, ph: passwordStamp(pwd), role: 'manager', branchId: BRANCH_SECONDARY }, JWT_SECRET, 3600);

  // 3. Seed Items for Branch Main:
  // Item 1: In-Stock (Qty: 20 pcs, cost: 50.00 -> 5000 minor, reorder: 5)
  const it1 = 'it_main_1_' + Date.now();
  await db.exec(
    `INSERT INTO items (id, tenant_id, branch_id, name, sku, unit, price_minor, cost_minor, track_stock, active, reorder_milli)
     VALUES (?, ?, ?, 'Sunflower Oil 1L', 'OIL-001', 'pcs', 7000, 5000, true, true, 5000)`,
    [it1, TEST_TENANT, BRANCH_MAIN]
  );
  await db.exec(
    `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, location, qty_milli, kind, created_at)
     VALUES ('sm1_' || ?, ?, ?, ?, 'MAIN', 20000, 'opening', now())`,
    [Date.now(), TEST_TENANT, BRANCH_MAIN, it1]
  );

  // Item 2: Low Stock (Qty: 4 pcs, cost: 100.00 -> 10000 minor, reorder: 10)
  const it2 = 'it_main_2_' + Date.now();
  await db.exec(
    `INSERT INTO items (id, tenant_id, branch_id, name, sku, unit, price_minor, cost_minor, track_stock, active, reorder_milli)
     VALUES (?, ?, ?, 'Basmati Rice 5kg', 'RICE-001', 'pcs', 15000, 10000, true, true, 10000)`,
    [it2, TEST_TENANT, BRANCH_MAIN]
  );
  await db.exec(
    `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, location, qty_milli, kind, created_at)
     VALUES ('sm2_' || ?, ?, ?, ?, 'MAIN', 4000, 'opening', now())`,
    [Date.now(), TEST_TENANT, BRANCH_MAIN, it2]
  );

  // Item 3: Out of Stock (Qty: 0 pcs, cost: 30.00 -> 3000 minor)
  const it3 = 'it_main_3_' + Date.now();
  await db.exec(
    `INSERT INTO items (id, tenant_id, branch_id, name, sku, unit, price_minor, cost_minor, track_stock, active, reorder_milli)
     VALUES (?, ?, ?, 'Sugar 1kg', 'SUGAR-001', 'pcs', 4000, 3000, true, true, 5000)`,
    [it3, TEST_TENANT, BRANCH_MAIN]
  );

  // 4. Seed Items for Branch Secondary (Porur):
  // Item 4: In-Stock (Qty: 10 pcs, cost: 200.00 -> 20000 minor)
  const it4 = 'it_sec_1_' + Date.now();
  await db.exec(
    `INSERT INTO items (id, tenant_id, branch_id, name, sku, unit, price_minor, cost_minor, track_stock, active, reorder_milli)
     VALUES (?, ?, ?, 'Tea Powder 500g', 'TEA-001', 'pcs', 25000, 20000, true, true, 2000)`,
    [it4, TEST_TENANT, BRANCH_SECONDARY]
  );
  await db.exec(
    `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, location, qty_milli, kind, created_at)
     VALUES ('sm4_' || ?, ?, ?, ?, 'MAIN', 10000, 'opening', now())`,
    [Date.now(), TEST_TENANT, BRANCH_SECONDARY, it4]
  );
});

after(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
  if (db) {
    await db.exec('DELETE FROM stock_moves WHERE tenant_id = ?', [TEST_TENANT]);
    await db.exec('DELETE FROM items WHERE tenant_id = ?', [TEST_TENANT]);
    await db.exec('DELETE FROM users WHERE tenant_id = ?', [TEST_TENANT]);
    await db.exec('DELETE FROM branches WHERE tenant_id = ?', [TEST_TENANT]);
    await db.exec('DELETE FROM tenants WHERE id = ?', [TEST_TENANT]);
    await db.close();
  }
});

test('1. Inventory Dashboard Stats for Super Admin with Branch MAIN', async () => {
  // Call /api/inventory/dashboard with header x-branch-id: MAIN
  const res = await api('GET', '/api/inventory/dashboard', { 'x-branch-id': 'MAIN' }, ownerToken);
  assert.equal(res.status, 200);
  assert.ok(res.body.stats, 'stats object must be returned');

  const stats = res.body.stats;
  // Branch MAIN has 3 items: 1 In-Stock (20 pcs * 50 = 1000), 1 Low-Stock (4 pcs * 100 = 400), 1 Out-of-Stock (0 pcs)
  assert.equal(stats.totalActiveProducts, 3, 'Total active products for Branch MAIN must be 3');
  assert.equal(stats.inStockCount, 1, 'In-Stock count must be 1');
  assert.equal(stats.lowStockCount, 1, 'Low Stock count must be 1');
  assert.equal(stats.outOfStockCount, 1, 'Out of Stock count must be 1');

  // Total valuation: (20 * 50.00) + (4 * 100.00) = 1000 + 400 = 1400 INR = 140000 minor
  assert.equal(stats.totalStockValueMinor, 140000, 'Total stock value minor must be 140,000 (Rs. 1,400.00)');
});

test('2. Inventory Items list matches stats filters for Branch MAIN', async () => {
  // All items
  const resAll = await api('GET', '/api/inventory/items', { 'x-branch-id': 'MAIN' }, ownerToken);
  assert.equal(resAll.status, 200);
  assert.equal(resAll.body.total, 3);
  assert.equal(resAll.body.items.length, 3);

  // In-Stock items filter
  const resInStock = await api('GET', '/api/inventory/items?status=in_stock', { 'x-branch-id': 'MAIN' }, ownerToken);
  assert.equal(resInStock.status, 200);
  assert.equal(resInStock.body.total, 1);
  assert.equal(resInStock.body.items[0].stockStatus, 'in_stock');

  // Low Stock filter
  const resLow = await api('GET', '/api/inventory/items?status=low_stock', { 'x-branch-id': 'MAIN' }, ownerToken);
  assert.equal(resLow.status, 200);
  assert.equal(resLow.body.total, 1);
  assert.equal(resLow.body.items[0].stockStatus, 'low_stock');

  // Out of Stock filter
  const resOut = await api('GET', '/api/inventory/items?status=out_of_stock', { 'x-branch-id': 'MAIN' }, ownerToken);
  assert.equal(resOut.status, 200);
  assert.equal(resOut.body.total, 1);
  assert.equal(resOut.body.items[0].stockStatus, 'out_of_stock');
});

test('3. Store Manager is strictly isolated to assigned branch', async () => {
  // Manager for Porur branch
  const resSec = await api('GET', '/api/inventory/dashboard', {}, managerSecToken);
  assert.equal(resSec.status, 200);
  const stats = resSec.body.stats;

  // Porur only has 1 item: Qty 10 pcs * 200.00 = 2000 INR = 200000 minor
  assert.equal(stats.totalActiveProducts, 1);
  assert.equal(stats.inStockCount, 1);
  assert.equal(stats.lowStockCount, 0);
  assert.equal(stats.outOfStockCount, 0);
  assert.equal(stats.totalStockValueMinor, 200000);
});

test('4. Super Admin All Branches combines statistics across branches', async () => {
  const resAll = await api('GET', '/api/inventory/dashboard', { 'x-branch-id': 'all' }, ownerToken);
  assert.equal(resAll.status, 200);
  const stats = resAll.body.stats;

  // Total active = 3 (MAIN) + 1 (PORUR) = 4
  assert.equal(stats.totalActiveProducts, 4);
  assert.equal(stats.inStockCount, 2);
  assert.equal(stats.lowStockCount, 1);
  assert.equal(stats.outOfStockCount, 1);
  // Total valuation: 140000 + 200000 = 340000 minor (Rs. 3,400.00)
  assert.equal(stats.totalStockValueMinor, 340000);
});
