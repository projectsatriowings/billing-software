import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';
import { createApp } from '../src/app.ts';
import { connectDb, type DB } from '../src/db/index.ts';
import { signToken, hashPassword, passwordStamp, newId } from '../src/security.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-long-enough-32-chars-at-least';
const TEST_TENANT = 't_stk_scoping_' + Date.now();
const BRANCH_ANNA_NAGAR = 'b_anna_stk_' + Date.now();
const BRANCH_T_NAGAR = 'b_tnagar_stk_' + Date.now();
const BRANCH_MAIN = 'b_main_stk_' + Date.now();

let db: DB;
let server: http.Server;
let base = '';
let ownerToken = '';

// Product IDs
const ITEM_A1_ID = 'i_a1_' + Date.now(); // Anna Nagar - In Stock (50 pcs)
const ITEM_A2_ID = 'i_a2_' + Date.now(); // Anna Nagar - Out of Stock (0 pcs)
const ITEM_T1_ID = 'i_t1_' + Date.now(); // T Nagar - In Stock (30 pcs)
const ITEM_T2_ID = 'i_t2_' + Date.now(); // T Nagar - Out of Stock (0 pcs)
const ITEM_M1_ID = 'i_m1_' + Date.now(); // Main Store - In Stock (100 pcs)
const ITEM_M2_ID = 'i_m2_' + Date.now(); // Main Store - In Stock (25 pcs)

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
  try {
    db = await connectDb();
    server = http.createServer(createApp(db, { secret: JWT_SECRET, log: false }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as any).port}`;

    // 1. Setup Tenant and 3 Branches: Anna Nagar, T Nagar, Main Branch
    await db.exec(`INSERT INTO tenants (id, name, business_type) VALUES (?, 'Supermarket Multi Branch Stock Test', 'retail')`, [TEST_TENANT]);
    await db.exec(`INSERT INTO branches (id, tenant_id, name, code, active) VALUES (?, ?, 'Anna Nagar', 'ANNA', true)`, [BRANCH_ANNA_NAGAR, TEST_TENANT]);
    await db.exec(`INSERT INTO branches (id, tenant_id, name, code, active) VALUES (?, ?, 'T Nagar', 'TNAGAR', true)`, [BRANCH_T_NAGAR, TEST_TENANT]);
    await db.exec(`INSERT INTO branches (id, tenant_id, name, code, active) VALUES (?, ?, 'Main Branch', 'MAIN', true)`, [BRANCH_MAIN, TEST_TENANT]);

    // 2. Setup Super Admin Owner User
    const pwd = hashPassword('TestPass123!');
    const ownerId = 'u_owner_' + Date.now();
    const ownerEmail = `owner_stk_${Date.now()}@stockscoping.local`;
    await db.exec(
      `INSERT INTO users (id, tenant_id, branch_id, name, email, password_hash, role, active)
       VALUES (?, ?, NULL, 'Super Owner', ?, ?, 'owner', true)`,
      [ownerId, TEST_TENANT, ownerEmail, pwd]
    );
    ownerToken = signToken({ sub: ownerId, tid: TEST_TENANT, ph: passwordStamp(pwd), role: 'owner' }, JWT_SECRET, 3600);

    // 3. Seed Products for Anna Nagar
    await db.exec(
      `INSERT INTO items (id, tenant_id, branch_id, name, sku, barcode, unit, category, price_minor, cost_minor, track_stock, active)
       VALUES (?, ?, ?, 'Anna Premium Ponni Rice 5kg', 'SKU-ANNA-RICE', '8901111111111', 'bag', 'Grains', 35000, 28000, true, true)`,
      [ITEM_A1_ID, TEST_TENANT, BRANCH_ANNA_NAGAR]
    );
    await db.exec(
      `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, location, qty_milli, kind, reason)
       VALUES (?, ?, ?, ?, 'ANNA', 50000, 'opening', 'Initial Stock')`,
      [newId('sm'), TEST_TENANT, BRANCH_ANNA_NAGAR, ITEM_A1_ID]
    );

    await db.exec(
      `INSERT INTO items (id, tenant_id, branch_id, name, sku, barcode, unit, category, price_minor, cost_minor, track_stock, active)
       VALUES (?, ?, ?, 'Anna Ghee 500ml', 'SKU-ANNA-GHEE', '8901111111112', 'bottle', 'Dairy', 32000, 25000, true, true)`,
      [ITEM_A2_ID, TEST_TENANT, BRANCH_ANNA_NAGAR]
    );
    // (A2 has 0 stock moves)

    // 4. Seed Products for T Nagar
    await db.exec(
      `INSERT INTO items (id, tenant_id, branch_id, name, sku, barcode, unit, category, price_minor, cost_minor, track_stock, active)
       VALUES (?, ?, ?, 'T Nagar Filter Coffee 200g', 'SKU-TNAGAR-COF', '8902222222221', 'pkt', 'Beverages', 18000, 14000, true, true)`,
      [ITEM_T1_ID, TEST_TENANT, BRANCH_T_NAGAR]
    );
    await db.exec(
      `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, location, qty_milli, kind, reason)
       VALUES (?, ?, ?, ?, 'MAIN', 30000, 'opening', 'Initial Stock')`,
      [newId('sm'), TEST_TENANT, BRANCH_T_NAGAR, ITEM_T1_ID]
    );
    // Add secondary barcode in product_barcodes for T1
    await db.exec(
      `INSERT INTO product_barcodes (id, tenant_id, branch_id, product_id, barcode, barcode_type)
       VALUES (?, ?, ?, ?, 'IBC-TNAGAR-999', 'INTERNAL')`,
      [newId('pbc'), TEST_TENANT, BRANCH_T_NAGAR, ITEM_T1_ID]
    );

    await db.exec(
      `INSERT INTO items (id, tenant_id, branch_id, name, sku, barcode, unit, category, price_minor, cost_minor, track_stock, active)
       VALUES (?, ?, ?, 'T Nagar Roasted Gram 500g', 'SKU-TNAGAR-GRAM', '8902222222222', 'pkt', 'Groceries', 8000, 6000, true, true)`,
      [ITEM_T2_ID, TEST_TENANT, BRANCH_T_NAGAR]
    );
    // (T2 has 0 stock moves)

    // 5. Seed Products for Main Branch
    await db.exec(
      `INSERT INTO items (id, tenant_id, branch_id, name, sku, barcode, unit, category, price_minor, cost_minor, track_stock, active)
       VALUES (?, ?, ?, 'Main Store Sunflower Oil 1L', 'SKU-MAIN-OIL', '8903333333331', 'pouch', 'Oils', 14000, 11000, true, true)`,
      [ITEM_M1_ID, TEST_TENANT, BRANCH_MAIN]
    );
    await db.exec(
      `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, location, qty_milli, kind, reason)
       VALUES (?, ?, ?, ?, 'MAIN', 100000, 'opening', 'Initial Stock')`,
      [newId('sm'), TEST_TENANT, BRANCH_MAIN, ITEM_M1_ID]
    );

    await db.exec(
      `INSERT INTO items (id, tenant_id, branch_id, name, sku, barcode, unit, category, price_minor, cost_minor, track_stock, active)
       VALUES (?, ?, ?, 'Main Store Sugar 1kg', 'SKU-MAIN-SUG', '8903333333332', 'kg', 'Groceries', 4500, 3800, true, true)`,
      [ITEM_M2_ID, TEST_TENANT, BRANCH_MAIN]
    );
    await db.exec(
      `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, location, qty_milli, kind, reason)
       VALUES (?, ?, ?, ?, 'MAIN', 25000, 'opening', 'Initial Stock')`,
      [newId('sm'), TEST_TENANT, BRANCH_MAIN, ITEM_M2_ID]
    );
  } catch (err) {
    console.error('BEFORE HOOK ERROR:', err);
    throw err;
  }
});

after(async () => {
  try {
    if (server) await new Promise<void>((r) => server.close(() => r()));
    if (db) {
      await db.exec('DELETE FROM stock_moves WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM product_barcodes WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM stock_transfer_lines WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM stock_transfers WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM number_series WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM items WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM users WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM branches WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM tenants WHERE id = ?', [TEST_TENANT]);
      await db.close();
    }
  } catch {}
  process.exit(0);
});

test('Scenario 1: Select Anna Nagar as source branch — displays only Anna Nagar products with accurate stock', async () => {
  const res = await api('GET', '/api/stock-transfers/branch-stock?branch=ANNA', {}, undefined, ownerToken);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.items));
  const itemIds = res.body.items.map((i: any) => i.id);

  // Must include Anna Nagar products
  assert.ok(itemIds.includes(ITEM_A1_ID), 'Anna Ponni Rice must be present');
  assert.ok(itemIds.includes(ITEM_A2_ID), 'Anna Ghee must be present');

  // Must NOT include T Nagar or Main Store products
  assert.ok(!itemIds.includes(ITEM_T1_ID), 'T Nagar Coffee must NOT be in Anna Nagar');
  assert.ok(!itemIds.includes(ITEM_T2_ID), 'T Nagar Gram must NOT be in Anna Nagar');
  assert.ok(!itemIds.includes(ITEM_M1_ID), 'Main Oil must NOT be in Anna Nagar');
  assert.ok(!itemIds.includes(ITEM_M2_ID), 'Main Sugar must NOT be in Anna Nagar');

  // Verify stock quantities for Anna Nagar products
  const a1 = res.body.items.find((i: any) => i.id === ITEM_A1_ID);
  assert.equal(a1.availableStockUnits, 50, 'Anna Rice must show 50 units');
  assert.equal(a1.availableStockMilli, 50000);

  const a2 = res.body.items.find((i: any) => i.id === ITEM_A2_ID);
  assert.equal(a2.availableStockUnits, 0, 'Anna Ghee must show 0 units');
});

test('Scenario 2: Select T Nagar as source branch — displays only T Nagar products with accurate stock', async () => {
  const res = await api('GET', '/api/stock-transfers/branch-stock?branch=TNAGAR', {}, undefined, ownerToken);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.items));
  const itemIds = res.body.items.map((i: any) => i.id);

  // Must include T Nagar products
  assert.ok(itemIds.includes(ITEM_T1_ID), 'T Nagar Coffee must be present');
  assert.ok(itemIds.includes(ITEM_T2_ID), 'T Nagar Gram must be present');

  // Must NOT include Anna Nagar or Main Store products
  assert.ok(!itemIds.includes(ITEM_A1_ID), 'Anna Rice must NOT be in T Nagar');
  assert.ok(!itemIds.includes(ITEM_A2_ID), 'Anna Ghee must NOT be in T Nagar');
  assert.ok(!itemIds.includes(ITEM_M1_ID), 'Main Oil must NOT be in T Nagar');
  assert.ok(!itemIds.includes(ITEM_M2_ID), 'Main Sugar must NOT be in T Nagar');

  // Verify stock quantities for T Nagar products
  const t1 = res.body.items.find((i: any) => i.id === ITEM_T1_ID);
  assert.equal(t1.availableStockUnits, 30, 'T Nagar Coffee must show 30 units');
  assert.equal(t1.availableStockMilli, 30000);

  const t2 = res.body.items.find((i: any) => i.id === ITEM_T2_ID);
  assert.equal(t2.availableStockUnits, 0, 'T Nagar Gram must show 0 units');
});

test('Scenario 3: Select Main Branch as source branch — displays only Main Branch products with accurate stock', async () => {
  const res = await api('GET', '/api/stock-transfers/branch-stock?branch=MAIN', {}, undefined, ownerToken);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.items));
  const itemIds = res.body.items.map((i: any) => i.id);

  // Must include Main Branch products
  assert.ok(itemIds.includes(ITEM_M1_ID), 'Main Oil must be present');
  assert.ok(itemIds.includes(ITEM_M2_ID), 'Main Sugar must be present');

  // Must NOT include Anna Nagar or T Nagar products
  assert.ok(!itemIds.includes(ITEM_A1_ID), 'Anna Rice must NOT be in Main Branch');
  assert.ok(!itemIds.includes(ITEM_A2_ID), 'Anna Ghee must NOT be in Main Branch');
  assert.ok(!itemIds.includes(ITEM_T1_ID), 'T Nagar Coffee must NOT be in Main Branch');
  assert.ok(!itemIds.includes(ITEM_T2_ID), 'T Nagar Gram must NOT be in Main Branch');

  // Verify stock quantities for Main Branch products
  const m1 = res.body.items.find((i: any) => i.id === ITEM_M1_ID);
  assert.equal(m1.availableStockUnits, 100, 'Main Oil must show 100 units');
  assert.equal(m1.availableStockMilli, 100000);

  const m2 = res.body.items.find((i: any) => i.id === ITEM_M2_ID);
  assert.equal(m2.availableStockUnits, 25, 'Main Sugar must show 25 units');
  assert.equal(m2.availableStockMilli, 25000);
});

test('Scenario 4: Verify that products with available stock show their actual quantities', async () => {
  // Query by branch code and branch ID
  const resCode = await api('GET', `/api/stock-transfers/branch-stock?branch=MAIN`, {}, undefined, ownerToken);
  const resId = await api('GET', `/api/stock-transfers/branch-stock?branch=${BRANCH_MAIN}`, {}, undefined, ownerToken);

  assert.equal(resCode.status, 200);
  assert.equal(resId.status, 200);

  const m1Code = resCode.body.items.find((i: any) => i.id === ITEM_M1_ID);
  const m1Id = resId.body.items.find((i: any) => i.id === ITEM_M1_ID);

  assert.equal(m1Code.availableStockUnits, 100);
  assert.equal(m1Id.availableStockUnits, 100);
});

test('Scenario 5: Verify that products belonging only to other branches do not appear in the transfer list', async () => {
  const res = await api('GET', '/api/stock-transfers/branch-stock?branch=TNAGAR', {}, undefined, ownerToken);
  const names = res.body.items.map((i: any) => i.name);
  assert.ok(!names.includes('Anna Premium Ponni Rice 5kg'), 'Anna Rice must NOT appear in T Nagar list');
  assert.ok(!names.includes('Main Store Sunflower Oil 1L'), 'Main Oil must NOT appear in T Nagar list');
});

test('Scenario 6: Verify that products with 0 stock cannot be added to a stock transfer', async () => {
  // Attempt 1: Transferring Anna Ghee (A2) which has 0 available stock
  const resZero = await api('POST', '/api/stock-transfers', {}, {
    fromBranch: 'ANNA',
    toBranch: 'TNAGAR',
    lines: [
      { itemId: ITEM_A2_ID, qty: 1 }
    ]
  }, ownerToken);

  assert.equal(resZero.status, 400);
  const msgZero = resZero.body.error?.message || resZero.body.message || JSON.stringify(resZero.body);
  assert.match(msgZero, /0 available stock/i);

  // Attempt 2: Transferring a product that belongs to another branch (e.g. T1 from ANNA)
  const resForeign = await api('POST', '/api/stock-transfers', {}, {
    fromBranch: 'ANNA',
    toBranch: 'MAIN',
    lines: [
      { itemId: ITEM_T1_ID, qty: 5 }
    ]
  }, ownerToken);

  assert.equal(resForeign.status, 400);
  const msgForeign = resForeign.body.error?.message || resForeign.body.message || JSON.stringify(resForeign.body);
  assert.match(msgForeign, /does not belong to source branch/i);

  // Attempt 3: Transferring more than available stock (e.g. 60 units of A1 when only 50 available)
  const resExcess = await api('POST', '/api/stock-transfers', {}, {
    fromBranch: 'ANNA',
    toBranch: 'TNAGAR',
    lines: [
      { itemId: ITEM_A1_ID, qty: 60 }
    ]
  }, ownerToken);

  assert.equal(resExcess.status, 400);
  const msgExcess = resExcess.body.error?.message || resExcess.body.message || JSON.stringify(resExcess.body);
  assert.match(msgExcess, /insufficient stock/i);
});

test('Scenario 7: Search products using product name, SKU and barcode', async () => {
  // Search by name in T Nagar
  const resName = await api('GET', '/api/stock-transfers/branch-stock?branch=TNAGAR&q=Coffee', {}, undefined, ownerToken);
  assert.equal(resName.status, 200);
  assert.equal(resName.body.items.length, 1);
  assert.equal(resName.body.items[0].id, ITEM_T1_ID);

  // Search by SKU in T Nagar
  const resSku = await api('GET', '/api/stock-transfers/branch-stock?branch=TNAGAR&q=SKU-TNAGAR-COF', {}, undefined, ownerToken);
  assert.equal(resSku.status, 200);
  assert.equal(resSku.body.items.length, 1);
  assert.equal(resSku.body.items[0].id, ITEM_T1_ID);

  // Search by primary barcode in T Nagar
  const resBc = await api('GET', '/api/stock-transfers/branch-stock?branch=TNAGAR&q=8902222222221', {}, undefined, ownerToken);
  assert.equal(resBc.status, 200);
  assert.equal(resBc.body.items.length, 1);
  assert.equal(resBc.body.items[0].id, ITEM_T1_ID);

  // Search by secondary internal barcode in product_barcodes in T Nagar
  const resSecondaryBc = await api('GET', '/api/stock-transfers/branch-stock?branch=TNAGAR&q=IBC-TNAGAR-999', {}, undefined, ownerToken);
  assert.equal(resSecondaryBc.status, 200);
  assert.equal(resSecondaryBc.body.items.length, 1);
  assert.equal(resSecondaryBc.body.items[0].id, ITEM_T1_ID);

  // Search in ANNA for Coffee -> must return empty
  const resAnnaCoffee = await api('GET', '/api/stock-transfers/branch-stock?branch=ANNA&q=Coffee', {}, undefined, ownerToken);
  assert.equal(resAnnaCoffee.status, 200);
  assert.equal(resAnnaCoffee.body.items.length, 0);
});

test('Scenario 8: Complete a transfer — source decreases, target increases, movements recorded accurately', async () => {
  // 1. Initial State: Main Branch has 100 units of M1, T Nagar has 0 units of M1 (not listed in TNAGAR)
  const initialMain = await api('GET', '/api/stock-transfers/branch-stock?branch=MAIN', {}, undefined, ownerToken);
  const m1MainBefore = initialMain.body.items.find((i: any) => i.id === ITEM_M1_ID);
  assert.equal(m1MainBefore.availableStockUnits, 100);

  const initialTNagar = await api('GET', '/api/stock-transfers/branch-stock?branch=TNAGAR', {}, undefined, ownerToken);
  assert.ok(!initialTNagar.body.items.some((i: any) => i.id === ITEM_M1_ID), 'M1 should not exist in T Nagar yet');

  // 2. Create Stock Transfer from MAIN to TNAGAR for 20 units of M1
  const createRes = await api('POST', '/api/stock-transfers', {}, {
    fromBranch: 'MAIN',
    toBranch: 'TNAGAR',
    notes: 'Restocking T Nagar Store with Sunflower Oil',
    lines: [
      { itemId: ITEM_M1_ID, qty: 20 }
    ]
  }, ownerToken);

  assert.equal(createRes.status, 200);
  assert.ok(createRes.body.success);
  const transferId = createRes.body.transferId;
  assert.ok(transferId);

  // 3. Dispatch the Transfer
  const dispatchRes = await api('POST', `/api/stock-transfers/${transferId}/dispatch`, {}, {}, ownerToken);
  assert.equal(dispatchRes.status, 200);
  assert.equal(dispatchRes.body.status, 'in_transit');

  // Check Main Branch stock has decreased by 20 units (from 100 to 80)
  const afterDispatchMain = await api('GET', '/api/stock-transfers/branch-stock?branch=MAIN', {}, undefined, ownerToken);
  const m1MainAfterDispatch = afterDispatchMain.body.items.find((i: any) => i.id === ITEM_M1_ID);
  assert.equal(m1MainAfterDispatch.availableStockUnits, 80, 'Main Branch stock must decrease to 80 units');

  // 4. Receive the Transfer at T Nagar
  const receiveRes = await api('POST', `/api/stock-transfers/${transferId}/receive`, {}, {
    lines: [
      { receivedQty: 20 }
    ]
  }, ownerToken);

  assert.equal(receiveRes.status, 200);
  assert.equal(receiveRes.body.status, 'completed');

  // Check T Nagar now has 20 units of M1
  const afterReceiveTNagar = await api('GET', '/api/stock-transfers/branch-stock?branch=TNAGAR', {}, undefined, ownerToken);
  const m1TNagarAfterReceive = afterReceiveTNagar.body.items.find((i: any) => i.id === ITEM_M1_ID);
  assert.ok(m1TNagarAfterReceive, 'M1 must now be in T Nagar inventory');
  assert.equal(m1TNagarAfterReceive.availableStockUnits, 20, 'T Nagar stock must increase to 20 units');

  // Anna Nagar must still NOT have M1
  const afterReceiveAnna = await api('GET', '/api/stock-transfers/branch-stock?branch=ANNA', {}, undefined, ownerToken);
  assert.ok(!afterReceiveAnna.body.items.some((i: any) => i.id === ITEM_M1_ID), 'M1 must still NOT be in Anna Nagar');

  // 5. Verify Transfer details and stock movement records
  const detailsRes = await api('GET', `/api/stock-transfers/${transferId}`, {}, undefined, ownerToken);
  assert.equal(detailsRes.status, 200);
  assert.equal(detailsRes.body.transfer.status, 'completed');
  assert.equal(detailsRes.body.stockMoves.source.length, 1, 'Must have 1 source dispatch move');
  assert.equal(detailsRes.body.stockMoves.source[0].qtyMilli, -20000);
  assert.equal(detailsRes.body.stockMoves.destination.length, 1, 'Must have 1 destination receipt move');
  assert.equal(detailsRes.body.stockMoves.destination[0].qtyMilli, 20000);
});

test('Scenario 9: Destination Branch Product Catalogue Synchronization & Scoping', async () => {
  // 1. T Nagar Catalogue must now include transferred item M1 with received stock (20 units = 20,000 milli)
  const tnagarCatRes = await api('GET', '/api/items', { 'x-branch-id': BRANCH_T_NAGAR }, undefined, ownerToken);
  assert.equal(tnagarCatRes.status, 200);
  const tnagarItems = tnagarCatRes.body.items;
  assert.ok(Array.isArray(tnagarItems));

  const m1InTNagar = tnagarItems.find((i: any) => i.id === ITEM_M1_ID);
  assert.ok(m1InTNagar, 'Transferred item M1 must be visible in T Nagar product catalogue');
  assert.equal(m1InTNagar.currentStockMilli, 20000, 'T Nagar stock for M1 must be 20,000 milli (20 units)');
  assert.equal(m1InTNagar.branchId, BRANCH_T_NAGAR, 'Item branchId in scoped catalogue must reflect active branch');
  assert.equal(m1InTNagar.branchName, 'T Nagar');

  // Transferred item must preserve all product master properties
  assert.equal(m1InTNagar.name, 'Main Store Sunflower Oil 1L');
  assert.equal(m1InTNagar.sku, 'SKU-MAIN-OIL');
  assert.equal(m1InTNagar.barcode, '8903333333331');
  assert.equal(m1InTNagar.priceMinor, 14000);
  assert.equal(m1InTNagar.costMinor, 11000);

  // Native T Nagar items must also be present
  const t1InTNagar = tnagarItems.find((i: any) => i.id === ITEM_T1_ID);
  assert.ok(t1InTNagar, 'Native T Nagar item T1 must be present');
  assert.equal(t1InTNagar.currentStockMilli, 30000);

  const t2InTNagar = tnagarItems.find((i: any) => i.id === ITEM_T2_ID);
  assert.ok(t2InTNagar, 'Native T Nagar item T2 must be present');
  assert.equal(t2InTNagar.currentStockMilli, 0);

  // Items exclusively in Anna Nagar (A1, A2) or Main Store (M2) must NOT be visible in T Nagar
  assert.ok(!tnagarItems.some((i: any) => i.id === ITEM_A1_ID), 'Anna Nagar item A1 must not be visible in T Nagar');
  assert.ok(!tnagarItems.some((i: any) => i.id === ITEM_A2_ID), 'Anna Nagar item A2 must not be visible in T Nagar');
  assert.ok(!tnagarItems.some((i: any) => i.id === ITEM_M2_ID), 'Untransferred Main Store item M2 must not be visible in T Nagar');

  // 2. Main Store Catalogue shows M1 with remaining stock (80 units = 80,000 milli)
  const mainCatRes = await api('GET', '/api/items', { 'x-branch-id': BRANCH_MAIN }, undefined, ownerToken);
  assert.equal(mainCatRes.status, 200);
  const m1InMain = mainCatRes.body.items.find((i: any) => i.id === ITEM_M1_ID);
  assert.ok(m1InMain);
  assert.equal(m1InMain.currentStockMilli, 80000, 'Main Store stock for M1 must be 80,000 milli (80 units)');
  assert.equal(m1InMain.branchId, BRANCH_MAIN);

  // 3. Anna Nagar Catalogue must NOT include M1
  const annaCatRes = await api('GET', '/api/items', { 'x-branch-id': BRANCH_ANNA_NAGAR }, undefined, ownerToken);
  assert.equal(annaCatRes.status, 200);
  assert.ok(!annaCatRes.body.items.some((i: any) => i.id === ITEM_M1_ID), 'M1 must not be in Anna Nagar catalogue');

  // 4. Super Admin All Branches view: total tenant stock is 80,000 + 20,000 = 100,000 milli
  const allCatRes = await api('GET', '/api/items', { 'x-branch-id': 'all' }, undefined, ownerToken);
  assert.equal(allCatRes.status, 200);
  const m1All = allCatRes.body.items.find((i: any) => i.id === ITEM_M1_ID);
  assert.ok(m1All);
  assert.equal(m1All.currentStockMilli, 100000, 'Tenant-wide stock for M1 must be sum across branches (100,000 milli)');

  // 5. GET /api/items/:id for transferred item in T Nagar scope
  const itemDetailRes = await api('GET', `/api/items/${ITEM_M1_ID}`, { 'x-branch-id': BRANCH_T_NAGAR }, undefined, ownerToken);
  assert.equal(itemDetailRes.status, 200);
  assert.equal(itemDetailRes.body.item.id, ITEM_M1_ID);
  assert.equal(itemDetailRes.body.item.branchId, BRANCH_T_NAGAR);
  assert.equal(itemDetailRes.body.item.currentStockMilli, 20000);

  // 6. POS barcode lookup for transferred item in T Nagar scope
  const bcLookupRes = await api('GET', `/api/items/by-barcode/${m1InTNagar.barcode}`, { 'x-branch-id': BRANCH_T_NAGAR }, undefined, ownerToken);
  assert.equal(bcLookupRes.status, 200);
  assert.equal(bcLookupRes.body.item.id, ITEM_M1_ID);
  assert.equal(bcLookupRes.body.item.currentStockMilli, 20000);

  // 7. Store Manager scope restriction: manager at T Nagar sees only T Nagar items
  const tnagarMgrPwd = hashPassword('MgrPass123!');
  const tnagarMgrId = 'u_mgr_tnagar_' + Date.now();
  await db.exec(
    `INSERT INTO users (id, tenant_id, branch_id, role, name, email, password_hash, active)
     VALUES (?, ?, ?, 'manager', 'T Nagar Store Manager', ?, ?, true)`,
    [tnagarMgrId, TEST_TENANT, BRANCH_T_NAGAR, `tnagar_mgr_${Date.now()}@stockscoping.local`, tnagarMgrPwd],
  );
  const tnagarMgrToken = signToken({ sub: tnagarMgrId, tid: TEST_TENANT, branchId: BRANCH_T_NAGAR, ph: passwordStamp(tnagarMgrPwd), role: 'manager' }, JWT_SECRET, 3600);

  const mgrCatRes = await api('GET', '/api/items', {}, undefined, tnagarMgrToken);
  assert.equal(mgrCatRes.status, 200);
  const mgrItems = mgrCatRes.body.items;
  assert.ok(mgrItems.some((i: any) => i.id === ITEM_M1_ID), 'Manager at T Nagar must see transferred M1');
  assert.ok(mgrItems.some((i: any) => i.id === ITEM_T1_ID), 'Manager at T Nagar must see native T1');
  assert.ok(!mgrItems.some((i: any) => i.id === ITEM_A1_ID), 'Manager at T Nagar must NOT see Anna Nagar A1');
  assert.ok(!mgrItems.some((i: any) => i.id === ITEM_M2_ID), 'Manager at T Nagar must NOT see untransferred M2');
});

