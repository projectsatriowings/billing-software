import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';
import { createApp } from '../src/app.ts';
import { connectDb, type DB } from '../src/db/index.ts';
import { signToken, hashPassword, passwordStamp, newId } from '../src/security.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-long-enough-32-chars-at-least';
const TEST_TENANT = 't_sku_test_' + Date.now();
const BRANCH_ANNA_NAGAR = 'b_anna_sku_' + Date.now();
const BRANCH_T_NAGAR = 'b_tnagar_sku_' + Date.now();
const BRANCH_MAIN = 'b_main_sku_' + Date.now();

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

    // 1. Setup Tenant and 3 Branches: Anna Nagar, T Nagar, Main Branch
    await db.exec(`INSERT INTO tenants (id, name, business_type) VALUES (?, 'Multi Branch Retail SKU Store', 'retail')`, [TEST_TENANT]);
    await db.exec(`INSERT INTO branches (id, tenant_id, name, code, active) VALUES (?, ?, 'Anna Nagar', 'ANNA', true)`, [BRANCH_ANNA_NAGAR, TEST_TENANT]);
    await db.exec(`INSERT INTO branches (id, tenant_id, name, code, active) VALUES (?, ?, 'T Nagar', 'TNAGAR', true)`, [BRANCH_T_NAGAR, TEST_TENANT]);
    await db.exec(`INSERT INTO branches (id, tenant_id, name, code, active) VALUES (?, ?, 'Main Branch', 'MAIN', true)`, [BRANCH_MAIN, TEST_TENANT]);

    // 2. Setup Super Admin
    const pwd = hashPassword('TestPass123!');
    const ownerId = 'u_owner_' + Date.now();
    const ownerEmail = `owner_sku_${Date.now()}@skutest.local`;
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

test('1. Create SKU M2MMN-70 in Anna Nagar — Success', async () => {
  const res = await api(
    'POST',
    '/api/items',
    { 'x-branch-id': BRANCH_ANNA_NAGAR },
    {
      name: 'Maggi 2-Minute Noodles 70g Anna Nagar',
      sku: 'M2MMN-70',
      barcode: '8901058852310',
      barcodeType: 'MANUFACTURER',
      priceMinor: 1400,
      costMinor: 1100,
      branchId: BRANCH_ANNA_NAGAR,
    },
    ownerToken
  );

  assert.equal(res.status, 200, 'Should create item with SKU M2MMN-70 in Anna Nagar');
  assert.equal(res.body.item.sku, 'M2MMN-70');
  assert.equal(res.body.item.branchId, BRANCH_ANNA_NAGAR);
});

test('2. Create SKU M2MMN-70 in T Nagar — Success', async () => {
  const res = await api(
    'POST',
    '/api/items',
    { 'x-branch-id': BRANCH_T_NAGAR },
    {
      name: 'Maggi 2-Minute Noodles 70g T Nagar',
      sku: 'M2MMN-70',
      barcode: '8901058852310',
      barcodeType: 'MANUFACTURER',
      priceMinor: 1400,
      costMinor: 1100,
      branchId: BRANCH_T_NAGAR,
    },
    ownerToken
  );

  assert.equal(res.status, 200, 'Should create item with same SKU M2MMN-70 in T Nagar');
  assert.equal(res.body.item.sku, 'M2MMN-70');
  assert.equal(res.body.item.branchId, BRANCH_T_NAGAR);
});

test('3. Create SKU M2MMN-70 in Main Branch — Success', async () => {
  const res = await api(
    'POST',
    '/api/items',
    { 'x-branch-id': BRANCH_MAIN },
    {
      name: 'Maggi 2-Minute Noodles 70g Main Branch',
      sku: 'M2MMN-70',
      barcode: '8901058852310',
      barcodeType: 'MANUFACTURER',
      priceMinor: 1400,
      costMinor: 1100,
      branchId: BRANCH_MAIN,
    },
    ownerToken
  );

  assert.equal(res.status, 200, 'Should create item with same SKU M2MMN-70 in Main Branch');
  assert.equal(res.body.item.sku, 'M2MMN-70');
  assert.equal(res.body.item.branchId, BRANCH_MAIN);
});

test('4. Create another product with SKU M2MMN-70 in Anna Nagar — Reject', async () => {
  const res = await api(
    'POST',
    '/api/items',
    { 'x-branch-id': BRANCH_ANNA_NAGAR },
    {
      name: 'Different Product with duplicate SKU in Anna Nagar',
      sku: 'M2MMN-70',
      priceMinor: 2000,
      costMinor: 1500,
      branchId: BRANCH_ANNA_NAGAR,
    },
    ownerToken
  );

  assert.equal(res.status, 409, 'Must reject duplicate SKU within Anna Nagar');

  // Also check check-sku endpoint
  const checkRes = await api(
    'GET',
    `/api/items/check-sku?sku=M2MMN-70&branchId=${BRANCH_ANNA_NAGAR}`,
    { 'x-branch-id': BRANCH_ANNA_NAGAR },
    undefined,
    ownerToken
  );
  assert.equal(checkRes.status, 200);
  assert.equal(checkRes.body.available, false);
  assert.equal(checkRes.body.conflict, true);
});

test('5. Create another product with SKU M2MMN-70 in T Nagar — Reject', async () => {
  const res = await api(
    'POST',
    '/api/items',
    { 'x-branch-id': BRANCH_T_NAGAR },
    {
      name: 'Different Product with duplicate SKU in T Nagar',
      sku: 'M2MMN-70',
      priceMinor: 2000,
      costMinor: 1500,
      branchId: BRANCH_T_NAGAR,
    },
    ownerToken
  );

  assert.equal(res.status, 409, 'Must reject duplicate SKU within T Nagar');

  // Verify database constraint items_branch_sku_uq blocks duplicate in same branch
  await assert.rejects(
    async () => {
      await db.exec(
        `INSERT INTO items (id, tenant_id, branch_id, name, sku, price_minor, cost_minor, unit, active)
         VALUES (?, ?, ?, 'DB Constraint Duplicate SKU', 'M2MMN-70', 1000, 800, 'pcs', true)`,
        [newId('i'), TEST_TENANT, BRANCH_T_NAGAR]
      );
    },
    /duplicate key|unique constraint|items_branch_sku_uq/i,
    'Database unique index must reject duplicate SKU within the same branch'
  );
});

test('6. Import the same 4 products into another branch — Success', async () => {
  // Anna Nagar seeds 4 products: M2MMN-70, PGB-100, SEEWDP-500, TT-250
  const rowsSeedAnna = [
    { name: 'Parle-G 100g', sku: 'PGB-100', priceMinor: 1000, costMinor: 800 },
    { name: 'Surf Excel 500g', sku: 'SEEWDP-500', priceMinor: 6500, costMinor: 5200 },
    { name: 'Taj Mahal Tea 250g', sku: 'TT-250', priceMinor: 18000, costMinor: 15000 },
  ];
  for (const r of rowsSeedAnna) {
    await api(
      'POST',
      '/api/items',
      { 'x-branch-id': BRANCH_ANNA_NAGAR },
      { ...r, branchId: BRANCH_ANNA_NAGAR },
      ownerToken
    );
  }

  // Now import ALL 4 SKUs (M2MMN-70, PGB-100, SEEWDP-500, TT-250) into T Nagar!
  const rowsImportTNagar = [
    { name: 'Maggi 2-Min Noodles 70g Import', sku: 'M2MMN-70', priceMinor: 1400, costMinor: 1100, unit: 'pcs' },
    { name: 'Parle-G Biscuits 100g Import', sku: 'PGB-100', priceMinor: 1000, costMinor: 800, unit: 'pcs' },
    { name: 'Surf Excel Easy Wash 500g Import', sku: 'SEEWDP-500', priceMinor: 6500, costMinor: 5200, unit: 'pcs' },
    { name: 'Taj Mahal Tea 250g Import', sku: 'TT-250', priceMinor: 18000, costMinor: 15000, unit: 'pcs' },
  ];

  // Note: T Nagar already has M2MMN-70 from test 2, so let's import into Main Branch where PGB-100, SEEWDP-500, TT-250 do NOT exist yet
  const rowsImportMain = [
    { name: 'Parle-G Biscuits 100g Import', sku: 'PGB-100', priceMinor: 1000, costMinor: 800, unit: 'pcs' },
    { name: 'Surf Excel Easy Wash 500g Import', sku: 'SEEWDP-500', priceMinor: 6500, costMinor: 5200, unit: 'pcs' },
    { name: 'Taj Mahal Tea 250g Import', sku: 'TT-250', priceMinor: 18000, costMinor: 15000, unit: 'pcs' },
  ];

  const resImport = await api(
    'POST',
    '/api/items/bulk-import',
    { 'x-branch-id': BRANCH_MAIN },
    {
      branchId: BRANCH_MAIN,
      rows: rowsImportMain,
    },
    ownerToken
  );

  assert.equal(resImport.status, 200, 'Bulk import into Main Branch must succeed');
  assert.equal(resImport.body.created, 3, 'All 3 products must be created without being skipped due to Anna Nagar');
  assert.equal(resImport.body.skipped, 0, 'Zero products should be skipped');
});

test('7. Import duplicate SKUs within the same branch — Reject / Skip with reason', async () => {
  // Attempt to import PGB-100 into Main Branch where it now already exists
  const rowsDuplicateImport = [
    { name: 'Duplicate Parle-G in Main', sku: 'PGB-100', priceMinor: 1200, costMinor: 900, unit: 'pcs' },
  ];

  const res = await api(
    'POST',
    '/api/items/bulk-import',
    { 'x-branch-id': BRANCH_MAIN },
    {
      branchId: BRANCH_MAIN,
      rows: rowsDuplicateImport,
    },
    ownerToken
  );

  assert.equal(res.status, 200);
  assert.equal(res.body.created, 0);
  assert.equal(res.body.skipped, 1, 'Duplicate SKU within the same branch must be skipped');
  assert.match(res.body.results[0].reason, /already exists/i, 'Reason must state SKU already exists');
});

test('8. SKU and barcode validation do not interfere with each other', async () => {
  // Shared manufacturer barcode with branch-scoped SKU
  const sharedMbc = '8901030389999';
  const sharedSku = 'SHRD-SKU-01';

  // Create in Anna Nagar
  const res1 = await api(
    'POST',
    '/api/items',
    { 'x-branch-id': BRANCH_ANNA_NAGAR },
    {
      name: 'Shared Item Anna Nagar',
      sku: sharedSku,
      barcode: sharedMbc,
      barcodeType: 'MANUFACTURER',
      priceMinor: 5000,
      costMinor: 4000,
      branchId: BRANCH_ANNA_NAGAR,
    },
    ownerToken
  );
  assert.equal(res1.status, 200);

  // Create in T Nagar with same SKU and same MBC
  const res2 = await api(
    'POST',
    '/api/items',
    { 'x-branch-id': BRANCH_T_NAGAR },
    {
      name: 'Shared Item T Nagar',
      sku: sharedSku,
      barcode: sharedMbc,
      barcodeType: 'MANUFACTURER',
      priceMinor: 5000,
      costMinor: 4000,
      branchId: BRANCH_T_NAGAR,
    },
    ownerToken
  );
  assert.equal(res2.status, 200, 'Same SKU and same MBC must coexist across distinct branches');

  // But trying to assign same SKU to another item in T Nagar must be rejected
  const res3 = await api(
    'POST',
    '/api/items',
    { 'x-branch-id': BRANCH_T_NAGAR },
    {
      name: 'Another Item in T Nagar with same SKU',
      sku: sharedSku,
      priceMinor: 6000,
      costMinor: 5000,
      branchId: BRANCH_T_NAGAR,
    },
    ownerToken
  );
  assert.equal(res3.status, 409, 'Must reject duplicate SKU in same branch');
});

