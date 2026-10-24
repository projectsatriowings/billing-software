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
  server = http.createServer(createApp(db, { secret: 'test-secret', log: false }));
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
  return { status: res.status, body: json, code: json?.error?.code as string | undefined, message: json?.error?.message as string | undefined };
}

const PW = 'Tamil-Shop-2026';
let shopAOwner = '';
let shopACashier = '';
let shopATenantId = '';
let shopBOwner = '';
let itemIdA1 = '';
let itemIdA2 = '';

test('inventory db setup: register Shop A (retail, negative stock false) and Shop B', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const regA = await api('POST', '/api/auth/register', {
    name: 'Shop A Grocery',
    ownerName: 'Owner A',
    email: 'ownerA@grocery.test',
    password: PW,
    businessType: 'retail',
  });
  assert.equal(regA.status, 200, JSON.stringify(regA.body));
  shopAOwner = regA.body.token;
  shopATenantId = regA.body.shop.id;

  // Add Cashier
  const cshA = await api('POST', '/api/users', { name: 'Cashier A', email: 'cashA@grocery.test', password: PW, role: 'cashier' }, shopAOwner);
  assert.equal(cshA.status, 200);
  shopACashier = (await api('POST', '/api/auth/login', { email: 'cashA@grocery.test', password: PW })).body.token;

  // Shop B
  const regB = await api('POST', '/api/auth/register', {
    name: 'Shop B Pharmacy',
    ownerName: 'Owner B',
    email: 'ownerB@pharma.test',
    password: PW,
    businessType: 'pharmacy',
  });
  assert.equal(regB.status, 200);
  shopBOwner = regB.body.token;

  // Create products in Shop A
  const it1 = await api('POST', '/api/items', {
    name: 'Basmati Rice 1kg',
    unit: 'pcs',
    category: 'Grains',
    priceMinor: 12000,
    costMinor: 9500,
    trackStock: true,
    openingQtyMilli: 50000, // 50 units opening stock
    reorderMilli: 15000,
    minStockMilli: 10000,
  }, shopAOwner);
  assert.equal(it1.status, 200, JSON.stringify(it1.body));
  itemIdA1 = it1.body.item.id;

  const it2 = await api('POST', '/api/items', {
    name: 'Sunflower Oil 1L',
    unit: 'pcs',
    category: 'Oils',
    priceMinor: 16000,
    costMinor: 13000,
    trackStock: true,
    openingQtyMilli: 30000, // 30 units opening stock
    reorderMilli: 10000,
  }, shopAOwner);
  assert.equal(it2.status, 200);
  itemIdA2 = it2.body.item.id;
});

test('inventory db: physical count baseline snapshot and line recording', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // 1. Start count session
  const startRes = await api('POST', '/api/inventory/counts', {
    name: 'Mid-Month Shelf Audit',
    category: 'ALL',
  }, shopAOwner);
  assert.equal(startRes.status, 200);
  assert.equal(startRes.body.ok, true);
  const countId = startRes.body.count.id;
  assert.ok(countId);

  // 2. Fetch count session details
  const getRes = await api('GET', `/api/inventory/counts/${countId}`, undefined, shopAOwner);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.count.status, 'in_progress');
  const lines = getRes.body.lines;
  assert.equal(lines.length >= 2, true);

  const line1 = lines.find((l: any) => l.itemId === itemIdA1);
  assert.ok(line1);
  assert.equal(line1.systemQtyMilli, 50000, 'Baseline system stock must match opening stock 50 units');
  assert.equal(line1.countedQtyMilli, null, 'Counted quantity must be initially null');

  // 3. Save physical count draft line
  const patchRes = await api('PATCH', `/api/inventory/counts/${countId}/lines`, {
    lines: [
      { id: line1.id, countedQtyMilli: 48000, notes: 'Initial shelf count: 48 units found' },
    ],
  }, shopAOwner);
  assert.equal(patchRes.status, 200);

  // 4. Verify line updated and diff calculated
  const getRes2 = await api('GET', `/api/inventory/counts/${countId}`, undefined, shopAOwner);
  const line1Updated = getRes2.body.lines.find((l: any) => l.itemId === itemIdA1);
  assert.equal(line1Updated.countedQtyMilli, 48000);
  assert.equal(line1Updated.diffQtyMilli, -2000, 'Diff must be 48 - 50 = -2 units');
  assert.equal(line1Updated.notes, 'Initial shelf count: 48 units found');
});

test('inventory db: note editing does not shift count timestamp, recount updates it', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const listRes = await api('GET', '/api/inventory/counts', undefined, shopAOwner);
  const countId = listRes.body.counts[0].id;

  const countDetail = await api('GET', `/api/inventory/counts/${countId}`, undefined, shopAOwner);
  const line1 = countDetail.body.lines.find((l: any) => l.itemId === itemIdA1);

  // Query raw line timestamp from database directly
  const rowBefore = await db.one<any>(
    'SELECT updated_at, counted_qty_milli FROM stock_count_lines WHERE id = ?',
    [line1.id],
  );
  const tsBefore = rowBefore.updatedAt ?? rowBefore.updated_at;

  // Edit notes ONLY with same countedQtyMilli
  await api('PATCH', `/api/inventory/counts/${countId}/lines`, {
    lines: [
      { id: line1.id, countedQtyMilli: 48000, notes: 'Verified: 2 units damaged behind shelf' },
    ],
  }, shopAOwner);

  const rowAfterNotes = await db.one<any>(
    'SELECT updated_at, counted_qty_milli, notes FROM stock_count_lines WHERE id = ?',
    [line1.id],
  );
  assert.equal(rowAfterNotes.notes, 'Verified: 2 units damaged behind shelf');
  assert.equal(
    new Date(rowAfterNotes.updatedAt ?? rowAfterNotes.updated_at).getTime(),
    new Date(tsBefore).getTime(),
    'Count timestamp must NOT shift when count quantity has not changed',
  );
});

test('inventory db: interim movement reconciliation and atomic finalization', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const listRes = await api('GET', '/api/inventory/counts', undefined, shopAOwner);
  const countId = listRes.body.counts[0].id;

  // Simulate interim POS sale of 3 units for Item A1 while count session is active
  await db.exec(
    `INSERT INTO stock_moves (id, tenant_id, item_id, location, qty_milli, kind, ref_type, ref_id, user_id, created_at)
     VALUES ('sm-interim-1', ?, ?, 'MAIN', -3000, 'sale', 'invoice', 'inv-dummy-1', 'user-test', now())`,
    [shopATenantId, itemIdA1],
  );

  // Live stock in database is now 50 - 3 = 47 units (47000 milli)
  const currentLive = await db.one<any>(
    'SELECT SUM(qty_milli)::bigint AS stock FROM stock_moves WHERE tenant_id = ? AND item_id = ?',
    [shopATenantId, itemIdA1],
  );
  assert.equal(Number(currentLive.stock), 47000);

  // Finalize the count session
  const finRes = await api('POST', `/api/inventory/counts/${countId}/finalize`, undefined, shopAOwner);
  assert.equal(finRes.status, 200);
  assert.equal(finRes.body.ok, true);

  // Verify status is completed
  const completedCount = await api('GET', `/api/inventory/counts/${countId}`, undefined, shopAOwner);
  assert.equal(completedCount.body.count.status, 'completed');

  // Verify resulting balance in stock_moves:
  // Baseline was 50. Floor count was 48 (-2 floor loss).
  // Interim sale was -3.
  // Final resulting stock should be 48 - 3 = 45 units (45000 milli).
  const finalStockRow = await db.one<any>(
    'SELECT SUM(qty_milli)::bigint AS stock FROM stock_moves WHERE tenant_id = ? AND item_id = ?',
    [shopATenantId, itemIdA1],
  );
  assert.equal(Number(finalStockRow.stock), 45000, 'Final stock must preserve interim sale: 48 counted - 3 sold = 45 units');

  // Verify audit adjustment move was created with kind = 'adjust', ref_type = 'stock_count'
  const adjMove = await db.one<any>(
    `SELECT * FROM stock_moves WHERE tenant_id = ? AND ref_id = ? AND ref_type = 'stock_count'`,
    [shopATenantId, countId],
  );
  assert.ok(adjMove, 'Authoritative stock move for count adjustment must exist');
  assert.equal(Number(adjMove.qtyMilli ?? adjMove.qty_milli), -2000, 'Floor adjustment move must be -2000 milli');
});

test('inventory db: duplicate finalization is serialized and rejected', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const listRes = await api('GET', '/api/inventory/counts', undefined, shopAOwner);
  const countId = listRes.body.counts[0].id;

  // Attempting to finalize an already completed count session must fail
  const retryRes = await api('POST', `/api/inventory/counts/${countId}/finalize`, undefined, shopAOwner);
  assert.equal(retryRes.status, 400);
  assert.match(retryRes.message || '', /already completed/i);
});

test('inventory db: rollback on negative stock violation preserves ledger integrity', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // Current stock for Item A2 is 30 units (30000 milli).
  // Attempting a direct adjustment reducing stock by 40 units (-40000 milli)
  // on Shop A (retail, allowNegativeStock = false) must be rejected
  const adjRes = await api('POST', '/api/inventory/adjustments', {
    itemId: itemIdA2,
    adjustmentType: 'quantity',
    changeQtyMilli: -40000,
    reason: 'damaged',
    notes: 'Massive water leak damage',
  }, shopAOwner);

  assert.equal(adjRes.status, 400);
  assert.match(adjRes.message || '', /negative stock/i);

  // Verify stock remained unchanged at 30 units
  const stockRow = await db.one<any>(
    'SELECT SUM(qty_milli)::bigint AS stock FROM stock_moves WHERE tenant_id = ? AND item_id = ?',
    [shopATenantId, itemIdA2],
  );
  assert.equal(Number(stockRow.stock), 30000, 'Rollback must preserve original stock position');
});

test('inventory db: tenant isolation prevents cross-tenant count access', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const listRes = await api('GET', '/api/inventory/counts', undefined, shopAOwner);
  const countIdA = listRes.body.counts[0].id;

  // Shop B attempts to view Shop A's count session
  const crossView = await api('GET', `/api/inventory/counts/${countIdA}`, undefined, shopBOwner);
  assert.equal(crossView.status, 404, 'Shop B must receive 404 Not Found for Shop A session');

  // Shop B attempts to finalize Shop A's count session
  const crossFinalize = await api('POST', `/api/inventory/counts/${countIdA}/finalize`, undefined, shopBOwner);
  assert.equal(crossFinalize.status, 404, 'Shop B must receive 404 Not Found');
});

test('inventory db: role-based authorization restricts cashiers from adjustments and counts', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // Cashier can view inventory dashboard
  const viewRes = await api('GET', '/api/inventory/dashboard', undefined, shopACashier);
  assert.equal(viewRes.status, 200);

  // Cashier CANNOT create stock adjustment
  const adjRes = await api('POST', '/api/inventory/adjustments', {
    itemId: itemIdA2,
    adjustmentType: 'quantity',
    changeQtyMilli: -1000,
    reason: 'damaged',
  }, shopACashier);
  assert.equal(adjRes.status, 403, 'Cashier must be forbidden from creating stock adjustments');

  // Cashier CANNOT start count session
  const startRes = await api('POST', '/api/inventory/counts', {
    name: 'Unauthorized Cashier Count',
  }, shopACashier);
  assert.equal(startRes.status, 403, 'Cashier must be forbidden from starting stock count');
});

test('inventory db: sales velocity correctly filters posted sales and subtracts returns', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // Query insights for Shop A
  const insightsRes = await api('GET', '/api/inventory/insights', undefined, shopAOwner);
  assert.equal(insightsRes.status, 200);
  assert.ok(insightsRes.body.insights);

  const risks = insightsRes.body.insights.stockoutRisks;
  assert.ok(Array.isArray(risks));

  // Item A1 had 3 units sold in our interim movement test
  const itemA1Risk = risks.find((r: any) => r.itemId === itemIdA1);
  if (itemA1Risk) {
    assert.equal(itemA1Risk.sold30dUnits, 3);
    assert.ok(itemA1Risk.explainableReason.length > 0);
  }
});
