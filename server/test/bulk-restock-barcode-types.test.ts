import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';
import { createApp } from '../src/app.ts';
import { connectDb, type DB } from '../src/db/index.ts';
import { signToken, hashPassword, passwordStamp, newId } from '../src/security.ts';
import { matchProductToCatalog, type MatchCandidate } from '../../shared/bulkImport.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-long-enough-32-chars-at-least';
const TEST_TENANT = 't_restock_bc_' + Date.now();
const BRANCH_ANNA_NAGAR = 'b_anna_bc_' + Date.now();
const BRANCH_T_NAGAR = 'b_tnagar_bc_' + Date.now();

let db: DB;
let server: http.Server;
let base = '';
let ownerToken = '';

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

    // Setup Tenant and 2 Branches
    await db.exec(`INSERT INTO tenants (id, name, business_type) VALUES (?, 'Bulk Restock Barcode Store', 'retail')`, [TEST_TENANT]);
    await db.exec(`INSERT INTO branches (id, tenant_id, name, code, active) VALUES (?, ?, 'Anna Nagar', 'ANNA', true)`, [BRANCH_ANNA_NAGAR, TEST_TENANT]);
    await db.exec(`INSERT INTO branches (id, tenant_id, name, code, active) VALUES (?, ?, 'T Nagar', 'TNAGAR', true)`, [BRANCH_T_NAGAR, TEST_TENANT]);

    // Setup Super Admin
    const pwd = hashPassword('TestPass123!');
    const ownerId = 'u_owner_' + Date.now();
    const ownerEmail = `owner_restock_${Date.now()}@restocktest.local`;
    await db.exec(
      `INSERT INTO users (id, tenant_id, branch_id, name, email, password_hash, role, active)
       VALUES (?, ?, NULL, 'Super Owner', ?, ?, 'owner', true)`,
      [ownerId, TEST_TENANT, ownerEmail, pwd]
    );
    ownerToken = signToken({ sub: ownerId, tid: TEST_TENANT, ph: passwordStamp(pwd), role: 'owner' }, JWT_SECRET, 3600);
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
      await db.exec('DELETE FROM items WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM users WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM branches WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM tenants WHERE id = ?', [TEST_TENANT]);
      await db.close();
    }
  } catch {}
  process.exit(0);
});

let maggiAnnaId = '';
const maggiIbc = '2000000000015';

test('1. Import a new product and generate IBC — display IBC', async () => {
  // Import a new product in Anna Nagar with IBC
  const res = await api(
    'POST',
    '/api/items/bulk-import',
    { 'x-branch-id': BRANCH_ANNA_NAGAR },
    {
      branchId: BRANCH_ANNA_NAGAR,
      rows: [
        {
          name: 'Maggi 2-Minute Masala Noodles 70 g',
          sku: 'M2MMN-70',
          barcode: maggiIbc,
          barcodeType: 'INTERNAL',
          priceMinor: 1400,
          costMinor: 1100,
          unit: 'pcs',
          category: 'Grocery',
          openingStock: '30',
        },
      ],
    },
    ownerToken
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.created, 1);

  // Fetch the item via GET /api/items
  const listRes = await api('GET', `/api/items?branchId=${BRANCH_ANNA_NAGAR}`, { 'x-branch-id': BRANCH_ANNA_NAGAR }, undefined, ownerToken);
  assert.equal(listRes.status, 200);
  const item = listRes.body.items.find((i: any) => i.sku === 'M2MMN-70');
  assert.ok(item, 'Item must exist in list');
  maggiAnnaId = item.id;
  assert.equal(item.barcode, maggiIbc);
  assert.equal(item.barcodeType, 'INTERNAL', 'Must return barcodeType = INTERNAL from API');

  // Verify in database directly
  const dbItem = await db.one<{ barcodeType?: string; barcode_type?: string }>('SELECT barcode_type FROM items WHERE id = ?', [maggiAnnaId]);
  assert.equal(dbItem?.barcodeType ?? dbItem?.barcode_type, 'INTERNAL', 'items table barcode_type must be INTERNAL');

  const dbPb = await db.one<{ barcodeType?: string; barcode_type?: string }>('SELECT barcode_type FROM product_barcodes WHERE product_id = ? AND barcode = ?', [maggiAnnaId, maggiIbc]);
  assert.equal(dbPb?.barcodeType ?? dbPb?.barcode_type, 'INTERNAL', 'product_barcodes barcode_type must be INTERNAL');
});

test('2. Import the same product again — detect Restock and display IBC', async () => {
  // Simulate client loading catalogCandidates from GET /api/items
  const listRes = await api('GET', `/api/items?branchId=${BRANCH_ANNA_NAGAR}`, { 'x-branch-id': BRANCH_ANNA_NAGAR }, undefined, ownerToken);
  const catalogCandidates: MatchCandidate[] = listRes.body.items.map((it: any) => ({
    id: it.id,
    name: it.name,
    sku: it.sku || null,
    barcode: it.barcode || null,
    barcodeType: it.barcodeType || null,
    barcodes: it.barcodes || [],
    category: it.category || null,
    unit: it.unit || 'pcs',
    priceMinor: it.priceMinor,
    costMinor: it.costMinor ?? 0,
    currentStockMilli: it.currentStockMilli ?? 0,
    taxRateBp: it.taxRateBp ?? 500,
    taxInclusive: it.taxInclusive ?? true,
    hsn: it.hsn || null,
  }));

  // Match the same incoming row against catalog
  const matchResult = matchProductToCatalog('Maggi 2-Minute Masala Noodles 70 g', 'pcs', catalogCandidates, {});
  assert.equal(matchResult.classification, 'RESTOCK', 'Should detect RESTOCK');
  assert.ok(matchResult.matchedItem, 'Should have matchedItem');
  assert.equal(matchResult.matchedItem.id, maggiAnnaId);
  assert.equal(matchResult.matchedItem.barcode, maggiIbc);
  assert.equal(matchResult.matchedItem.barcodeType, 'INTERNAL', 'Candidate must preserve barcodeType = INTERNAL');

  // Verify frontend badge logic for restock:
  const barcodeTrim = (matchResult.matchedItem.barcode || '').trim();
  const hasBarcode = Boolean(barcodeTrim);
  const rowBarcodeType = matchResult.matchedItem.barcodeType;
  const isBarcodeAutoGenerated = false;
  const isIbc = hasBarcode && (
    rowBarcodeType === 'INTERNAL' ||
    (isBarcodeAutoGenerated && rowBarcodeType !== 'MANUFACTURER')
  );
  const isMbc = hasBarcode && !isIbc;

  assert.equal(isIbc, true, 'Badge must be IBC (true)');
  assert.equal(isMbc, false, 'Badge must NOT be MBC (false)');
});

test('3. Import a product with a manufacturer barcode — display MBC', async () => {
  const mfrBarcode = '8901058852310';
  const res = await api(
    'POST',
    '/api/items/bulk-import',
    { 'x-branch-id': BRANCH_ANNA_NAGAR },
    {
      branchId: BRANCH_ANNA_NAGAR,
      rows: [
        {
          name: 'KitKat 4 Finger Chocolate 38.5g',
          sku: 'KK-38',
          barcode: mfrBarcode,
          barcodeType: 'MANUFACTURER',
          priceMinor: 2500,
          costMinor: 2000,
          unit: 'pcs',
          category: 'Chocolates',
          openingStock: '50',
        },
      ],
    },
    ownerToken
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.created, 1);

  // Fetch list and verify barcodeType is MANUFACTURER
  const listRes = await api('GET', `/api/items?branchId=${BRANCH_ANNA_NAGAR}`, { 'x-branch-id': BRANCH_ANNA_NAGAR }, undefined, ownerToken);
  const item = listRes.body.items.find((i: any) => i.sku === 'KK-38');
  assert.ok(item);
  assert.equal(item.barcode, mfrBarcode);
  assert.equal(item.barcodeType, 'MANUFACTURER');

  // Verify badge logic for MBC:
  const isIbc = Boolean(item.barcode) && (item.barcodeType === 'INTERNAL');
  const isMbc = Boolean(item.barcode) && !isIbc;
  assert.equal(isMbc, true, 'Badge must be MBC');
  assert.equal(isIbc, false, 'Badge must not be IBC');
});

test('4. Import a product with both barcodes — preserve and identify both correctly', async () => {
  // Add a secondary manufacturer barcode to Maggi (which already has IBC)
  const maggiMbc = '8901058852399';
  const addBcRes = await api(
    'POST',
    `/api/items/${maggiAnnaId}/barcodes`,
    { 'x-branch-id': BRANCH_ANNA_NAGAR },
    {
      barcode: maggiMbc,
      barcodeType: 'MANUFACTURER',
      branchId: BRANCH_ANNA_NAGAR,
    },
    ownerToken
  );

  assert.equal(addBcRes.status, 200);
  assert.equal(addBcRes.body.barcodeType, 'MANUFACTURER');

  // Fetch item via GET /api/items/:id
  const getRes = await api('GET', `/api/items/${maggiAnnaId}`, { 'x-branch-id': BRANCH_ANNA_NAGAR }, undefined, ownerToken);
  assert.equal(getRes.status, 200);
  const it = getRes.body.item;
  assert.equal(it.barcode, maggiIbc);
  assert.equal(it.barcodeType, 'INTERNAL');
  assert.ok(Array.isArray(it.barcodes), 'barcodes array must be returned');
  assert.equal(it.barcodes.length, 2, 'Should have both barcodes');

  const ibcEntry = it.barcodes.find((b: any) => b.barcode === maggiIbc);
  const mbcEntry = it.barcodes.find((b: any) => b.barcode === maggiMbc);
  assert.ok(ibcEntry, 'IBC entry must exist');
  assert.equal(ibcEntry.barcodeType, 'INTERNAL');
  assert.ok(mbcEntry, 'MBC entry must exist');
  assert.equal(mbcEntry.barcodeType, 'MANUFACTURER');

  // Verify matchProductToCatalog matches using secondary MBC as well!
  const cand: MatchCandidate = {
    id: it.id,
    name: it.name,
    sku: it.sku,
    barcode: it.barcode,
    barcodeType: it.barcodeType,
    barcodes: it.barcodes,
    category: it.category,
    unit: it.unit,
    priceMinor: it.priceMinor,
    costMinor: it.costMinor,
    currentStockMilli: it.currentStockMilli,
    taxRateBp: it.taxRateBp,
    taxInclusive: it.taxInclusive,
    hsn: it.hsn,
  };

  const matchByMbc = matchProductToCatalog('Random Name', 'pcs', [cand], { barcode: maggiMbc });
  assert.equal(matchByMbc.classification, 'RESTOCK');
  assert.equal(matchByMbc.matchedItem?.id, maggiAnnaId);
});

test('5. Restock the same product in another branch — retrieve that branch\'s IBC', async () => {
  const maggiTnagarIbc = '2000000000088';
  // Create Maggi in T Nagar with T Nagar's own IBC
  const res = await api(
    'POST',
    '/api/items/bulk-import',
    { 'x-branch-id': BRANCH_T_NAGAR },
    {
      branchId: BRANCH_T_NAGAR,
      rows: [
        {
          name: 'Maggi 2-Minute Masala Noodles 70 g',
          sku: 'M2MMN-70',
          barcode: maggiTnagarIbc,
          barcodeType: 'INTERNAL',
          priceMinor: 1400,
          costMinor: 1100,
          unit: 'pcs',
          category: 'Grocery',
          openingStock: '20',
        },
      ],
    },
    ownerToken
  );
  assert.equal(res.status, 200);

  // Query Anna Nagar items: returns Anna Nagar IBC
  const annaRes = await api('GET', `/api/items?branchId=${BRANCH_ANNA_NAGAR}`, { 'x-branch-id': BRANCH_ANNA_NAGAR }, undefined, ownerToken);
  const annaItem = annaRes.body.items.find((i: any) => i.sku === 'M2MMN-70');
  assert.equal(annaItem.barcode, maggiIbc);
  assert.equal(annaItem.barcodeType, 'INTERNAL');

  // Query T Nagar items: returns T Nagar IBC
  const tnagarRes = await api('GET', `/api/items?branchId=${BRANCH_T_NAGAR}`, { 'x-branch-id': BRANCH_T_NAGAR }, undefined, ownerToken);
  const tnagarItem = tnagarRes.body.items.find((i: any) => i.sku === 'M2MMN-70');
  assert.equal(tnagarItem.barcode, maggiTnagarIbc);
  assert.equal(tnagarItem.barcodeType, 'INTERNAL');
});

test('6. Verify that restocking does not change existing barcode types in the database', async () => {
  // Check Anna Nagar Maggi barcode type before restock
  const beforePb = await db.one<{ barcodeType?: string; barcode_type?: string }>(
    'SELECT barcode_type FROM product_barcodes WHERE product_id = ? AND barcode = ?',
    [maggiAnnaId, maggiIbc]
  );
  assert.equal(beforePb?.barcodeType ?? beforePb?.barcode_type, 'INTERNAL');

  // Restock Anna Nagar Maggi by adding 40 units
  const restockRes = await api(
    'POST',
    '/api/items/bulk-import',
    { 'x-branch-id': BRANCH_ANNA_NAGAR },
    {
      branchId: BRANCH_ANNA_NAGAR,
      rows: [
        {
          isRestock: true,
          matchedItemId: maggiAnnaId,
          name: 'Maggi 2-Minute Masala Noodles 70 g',
          sku: 'M2MMN-70',
          barcode: maggiIbc,
          barcodeType: 'INTERNAL',
          priceMinor: 1400,
          costMinor: 1100,
          unit: 'pcs',
          category: 'Grocery',
          incomingStock: '40',
        },
      ],
    },
    ownerToken
  );

  assert.equal(restockRes.status, 200);
  assert.equal(restockRes.body.restocked, 1);

  // Verify in database: product_barcodes.barcode_type MUST STILL BE INTERNAL!
  const afterPb = await db.one<{ barcodeType?: string; barcode_type?: string }>(
    'SELECT barcode_type FROM product_barcodes WHERE product_id = ? AND barcode = ?',
    [maggiAnnaId, maggiIbc]
  );
  assert.equal(afterPb?.barcodeType ?? afterPb?.barcode_type, 'INTERNAL', 'product_barcodes.barcode_type must remain INTERNAL');

  // Verify in database: items.barcode_type MUST STILL BE INTERNAL!
  const afterItem = await db.one<{ barcodeType?: string; barcode_type?: string }>(
    'SELECT barcode_type FROM items WHERE id = ?',
    [maggiAnnaId]
  );
  assert.equal(afterItem?.barcodeType ?? afterItem?.barcode_type, 'INTERNAL', 'items.barcode_type must remain INTERNAL');
});
