import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';
import { createApp } from '../src/app.ts';
import { connectDb, type DB } from '../src/db/index.ts';
import { signToken, hashPassword, passwordStamp, newId } from '../src/security.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-long-enough-32-chars-at-least';
const TEST_TENANT = 't_supp_imp_' + Date.now();
const BRANCH_MAIN = 'b_main_supp_' + Date.now();

let db: DB;
let server: http.Server;
let base = '';
let ownerToken = '';
let supplierAId = '';
let supplierBId = '';

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

    // Setup Tenant and Branch
    await db.exec(`INSERT INTO tenants (id, name, business_type) VALUES (?, 'Supplier Bulk Import Store', 'retail')`, [TEST_TENANT]);
    await db.exec(`INSERT INTO branches (id, tenant_id, name, code, active) VALUES (?, ?, 'Main Store', 'MAIN', true)`, [BRANCH_MAIN, TEST_TENANT]);

    // Setup Super Admin
    const pwd = hashPassword('TestPass123!');
    const ownerId = 'u_owner_supp_' + Date.now();
    const ownerEmail = `owner_supp_${Date.now()}@supptest.local`;
    await db.exec(
      `INSERT INTO users (id, tenant_id, branch_id, name, email, password_hash, role, active)
       VALUES (?, ?, NULL, 'Store Owner', ?, ?, 'owner', true)`,
      [ownerId, TEST_TENANT, ownerEmail, pwd]
    );
    ownerToken = signToken({ sub: ownerId, tid: TEST_TENANT, ph: passwordStamp(pwd), role: 'owner' }, JWT_SECRET, 3600);

    // Setup Category
    await db.exec(
      `INSERT INTO categories (id, tenant_id, branch_id, name, active) VALUES (?, ?, ?, 'Grocery', true)`,
      [newId('cat'), TEST_TENANT, BRANCH_MAIN]
    );

    // Setup 2 Suppliers in parties table
    supplierAId = newId('party');
    supplierBId = newId('party');

    await db.exec(
      `INSERT INTO parties (id, tenant_id, branch_id, type, name, phone, gstin, active)
       VALUES (?, ?, ?, 'supplier', 'ABC Distributors', '9876543210', '33AABBC1122D1Z0', true)`,
      [supplierAId, TEST_TENANT, BRANCH_MAIN]
    );

    await db.exec(
      `INSERT INTO parties (id, tenant_id, branch_id, type, name, phone, gstin, active)
       VALUES (?, ?, ?, 'supplier', 'XYZ Wholesale Mart', '9123456780', '33XYZAB9988D1Z5', true)`,
      [supplierBId, TEST_TENANT, BRANCH_MAIN]
    );
  } catch (err) {
    console.error('BEFORE HOOK ERROR:', err);
    throw err;
  }
});

after(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
  if (db) {
    try {
      await db.exec(`DELETE FROM purchase_lines WHERE tenant_id = ?`, [TEST_TENANT]);
      await db.exec(`DELETE FROM purchases WHERE tenant_id = ?`, [TEST_TENANT]);
      await db.exec(`DELETE FROM stock_moves WHERE tenant_id = ?`, [TEST_TENANT]);
      await db.exec(`DELETE FROM product_barcodes WHERE tenant_id = ?`, [TEST_TENANT]);
      await db.exec(`DELETE FROM items WHERE tenant_id = ?`, [TEST_TENANT]);
      await db.exec(`DELETE FROM imports WHERE tenant_id = ?`, [TEST_TENANT]);
      await db.exec(`DELETE FROM parties WHERE tenant_id = ?`, [TEST_TENANT]);
      await db.exec(`DELETE FROM categories WHERE tenant_id = ?`, [TEST_TENANT]);
      await db.exec(`DELETE FROM number_series WHERE tenant_id = ?`, [TEST_TENANT]);
      await db.exec(`DELETE FROM users WHERE tenant_id = ?`, [TEST_TENANT]);
      await db.exec(`DELETE FROM branches WHERE tenant_id = ?`, [TEST_TENANT]);
      await db.exec(`DELETE FROM tenants WHERE id = ?`, [TEST_TENANT]);
    } catch (e) {
      console.warn('Cleanup warning:', e);
    }
    await db.close();
  }
  process.exit(0);
});

test('1. Rejects bulk import when supplierId is missing', async () => {
  const res = await api('POST', '/api/items/bulk-import', {}, {
    branchId: BRANCH_MAIN,
    rows: [
      { name: 'Product Without Supplier', priceMinor: 5000, costMinor: 3000, openingQtyMilli: 10000 },
    ],
  }, ownerToken);

  assert.equal(res.status, 400);
  const errMsg = res.body?.error?.message || res.body?.error || '';
  assert.match(errMsg, /supplier is required/i);
});

test('2. Rejects bulk import when supplierId is invalid or inactive', async () => {
  const res = await api('POST', '/api/items/bulk-import', {}, {
    branchId: BRANCH_MAIN,
    supplierId: 'non_existent_supplier_id',
    rows: [
      { name: 'Product With Bad Supplier', priceMinor: 5000, costMinor: 3000, openingQtyMilli: 10000 },
    ],
  }, ownerToken);

  assert.equal(res.status, 400);
  const errMsg = res.body?.error?.message || res.body?.error || '';
  assert.match(errMsg, /supplier was not found/i);
});

test('3. Imports multiple new products linked to Supplier A (ABC Distributors)', async () => {
  try {
    const rows = [
      {
        name: 'Organic Sunflower Oil 1L',
        priceMinor: 18000,
        costMinor: 14000,
        taxRateBp: 500,
        taxInclusive: true,
        openingQtyMilli: 25000, // 25 units
        category: 'Grocery',
      },
      {
        name: 'Whole Wheat Flour 5KG',
        priceMinor: 25000,
        costMinor: 20000,
        taxRateBp: 0,
        taxInclusive: true,
        openingQtyMilli: 15000, // 15 units
        category: 'Grocery',
      },
    ];

    const res = await api('POST', '/api/items/bulk-import', {}, {
      branchId: BRANCH_MAIN,
      supplierId: supplierAId,
      rows,
    }, ownerToken);

    if (res.status !== 200) {
      console.error('RES ERROR 3:', res.status, res.body);
    }
    assert.equal(res.status, 200);
    assert.equal(res.body.created, 2);
    assert.equal(res.body.supplierId, supplierAId);
    assert.equal(res.body.supplierName, 'ABC Distributors');
    assert.ok(res.body.purchaseId, 'A purchase order should be generated');
    assert.ok(res.body.purchaseNumber, 'A purchase number should be generated');

    // Verify items in DB have preferred_supplier_id set to Supplier A
    const itemsInDb = await db.query<any>(
      `SELECT id, name, preferred_supplier_id FROM items WHERE tenant_id = ? AND name IN ('Organic Sunflower Oil 1L', 'Whole Wheat Flour 5KG')`,
      [TEST_TENANT]
    );
    assert.equal(itemsInDb.length, 2);
    for (const item of itemsInDb) {
      const pSuppId = item.preferredSupplierId ?? item.preferred_supplier_id;
      assert.equal(pSuppId, supplierAId, `Item ${item.name} must have preferred_supplier_id = Supplier A`);
    }

    // Verify purchases table has record with supplier_id = supplierAId
    const purchase = await db.one<any>(
      `SELECT id, supplier_id, purchase_number, total_minor FROM purchases WHERE id = ?`,
      [res.body.purchaseId]
    );
    assert.ok(purchase);
    assert.equal(purchase.supplierId ?? purchase.supplier_id, supplierAId);
    assert.ok(Number(purchase.totalMinor ?? purchase.total_minor) > 0);

    // Verify stock moves link to this purchase
    const moves = await db.query<any>(
      `SELECT id, ref_id, ref_type, notes FROM stock_moves WHERE tenant_id = ? AND ref_id = ?`,
      [TEST_TENANT, res.body.purchaseId]
    );
    assert.equal(moves.length, 2);
    assert.equal(moves[0].refType ?? moves[0].ref_type, 'purchase');
    assert.match(moves[0].notes || '', /ABC Distributors/);
  } catch (err) {
    console.error('TEST 3 EXCEPTION:', err);
    throw err;
  }
});

test('4. Restocks existing products with Supplier B (XYZ Wholesale Mart)', async () => {
  // Find the oil item created earlier
  const oilItem = await db.one<any>(
    `SELECT id, name, preferred_supplier_id FROM items WHERE tenant_id = ? AND name = 'Organic Sunflower Oil 1L'`,
    [TEST_TENANT]
  );
  assert.ok(oilItem);
  assert.equal(oilItem.preferredSupplierId ?? oilItem.preferred_supplier_id, supplierAId);

  // Restock the oil product with Supplier B
  const restockRows = [
    {
      name: 'Organic Sunflower Oil 1L',
      isRestock: true,
      matchedItemId: oilItem.id,
      priceMinor: 18000,
      costMinor: 14500, // new cost
      taxRateBp: 500,
      taxInclusive: true,
      openingQtyMilli: 50000, // +50 units
      category: 'Grocery',
    },
  ];

  const res = await api('POST', '/api/items/bulk-import', {}, {
    branchId: BRANCH_MAIN,
    supplierId: supplierBId,
    rows: restockRows,
  }, ownerToken);

  assert.equal(res.status, 200);
  assert.equal(res.body.restocked, 1);
  assert.equal(res.body.supplierId, supplierBId);
  assert.equal(res.body.supplierName, 'XYZ Wholesale Mart');

  // Verify purchase was recorded under Supplier B
  const purchaseB = await db.one<any>(
    `SELECT id, supplier_id, purchase_number FROM purchases WHERE id = ?`,
    [res.body.purchaseId]
  );
  assert.ok(purchaseB);
  assert.equal(purchaseB.supplierId ?? purchaseB.supplier_id, supplierBId);

  // Verify that the original product's historical preferred supplier was preserved!
  const refreshedItem = await db.one<any>(
    `SELECT id, preferred_supplier_id FROM items WHERE id = ?`,
    [oilItem.id]
  );
  assert.equal(refreshedItem?.preferredSupplierId ?? refreshedItem?.preferred_supplier_id, supplierAId, 'Original supplier must be preserved');

  // Verify total stock for oilItem is now 25 + 50 = 75 units (75000 milli)
  const stockRow = await db.one<{ total: string }>(
    `SELECT SUM(qty_milli)::text as total FROM stock_moves WHERE item_id = ? AND tenant_id = ?`,
    [oilItem.id, TEST_TENANT]
  );
  assert.equal(Number(stockRow?.total), 75000);
});

test('5. Verifies supplier ledger and purchases query isolation', async () => {
  try {
    // Query Supplier A ledger: must contain purchase 1
    const ledgerA = await api('GET', `/api/parties/${supplierAId}/supplier-ledger`, {}, undefined, ownerToken);
    assert.equal(ledgerA.status, 200);
    assert.ok(Array.isArray(ledgerA.body?.entries), 'Supplier A entries should be an array');
    assert.ok(ledgerA.body.entries.length >= 1, 'Supplier A should have at least 1 entry');
    assert.equal(ledgerA.body.entries[0].type, 'purchase');

    // Query Supplier B ledger: must contain purchase 2
    const ledgerB = await api('GET', `/api/parties/${supplierBId}/supplier-ledger`, {}, undefined, ownerToken);
    assert.equal(ledgerB.status, 200);
    assert.ok(Array.isArray(ledgerB.body?.entries), 'Supplier B entries should be an array');
    assert.ok(ledgerB.body.entries.length >= 1, 'Supplier B should have at least 1 entry');
    assert.equal(ledgerB.body.entries[0].type, 'purchase');

    // Query /api/purchases: must show purchases from both suppliers
    const purchasesList = await api('GET', `/api/purchases`, {}, undefined, ownerToken);
    assert.equal(purchasesList.status, 200);
    assert.ok(Array.isArray(purchasesList.body?.purchases), 'Purchases should be an array');
    const supNames = purchasesList.body.purchases.map((p: any) => p.supplierName);
    assert.ok(supNames.includes('ABC Distributors'), 'Purchases list must include ABC Distributors');
    assert.ok(supNames.includes('XYZ Wholesale Mart'), 'Purchases list must include XYZ Wholesale Mart');
  } catch (e) {
    console.error('TEST 5 EXCEPTION:', e);
    throw e;
  }
});
