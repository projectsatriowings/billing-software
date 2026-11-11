import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';
import { createApp } from '../src/app.ts';
import { connectDb, type DB } from '../src/db/index.ts';
import { signToken, hashPassword, passwordStamp } from '../src/security.ts';
import { newId } from '../src/security.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-long-enough-32-chars-at-least';
const TEST_TENANT = 't_bc_test_' + Date.now();
const BRANCH_ANNA_NAGAR = 'b_anna_' + Date.now();
const BRANCH_T_NAGAR = 'b_tnagar_' + Date.now();

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

    // 1. Setup Tenant and 2 Branches: Anna Nagar and T Nagar
    await db.exec(`INSERT INTO tenants (id, name, business_type) VALUES (?, 'Supermarket Multi Branch', 'retail')`, [TEST_TENANT]);
    await db.exec(`INSERT INTO branches (id, tenant_id, name, code, active) VALUES (?, ?, 'Anna Nagar', 'ANNA', true)`, [BRANCH_ANNA_NAGAR, TEST_TENANT]);
    await db.exec(`INSERT INTO branches (id, tenant_id, name, code, active) VALUES (?, ?, 'T Nagar', 'TNAGAR', true)`, [BRANCH_T_NAGAR, TEST_TENANT]);

    // 2. Setup Super Admin
    const pwd = hashPassword('TestPass123!');
    const ownerId = 'u_owner_' + Date.now();
    const ownerEmail = `owner_${Date.now()}@bc.local`;
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

test('Scenario 1: Add a product with MBC in Anna Nagar — successful', async () => {
  const mbc = '8901234567890';
  const res = await api(
    'POST',
    '/api/items',
    { 'x-branch-id': BRANCH_ANNA_NAGAR },
    {
      name: 'Tata Salt 1kg Anna Nagar',
      barcode: mbc,
      barcodeType: 'MANUFACTURER',
      priceMinor: 2800,
      costMinor: 2400,
      branchId: BRANCH_ANNA_NAGAR,
    },
    ownerToken
  );

  assert.equal(res.status, 200, 'Should successfully create item with MBC in Anna Nagar');
  assert.equal(res.body.item.barcode, mbc);
  assert.equal(res.body.item.branchId, BRANCH_ANNA_NAGAR);

  // Verify stored in product_barcodes with branch_id
  const pb = await db.one<{ id: string; barcodeType: string; branchId: string }>(
    `SELECT id, barcode_type, branch_id FROM product_barcodes WHERE tenant_id = ? AND branch_id = ? AND barcode = ?`,
    [TEST_TENANT, BRANCH_ANNA_NAGAR, mbc]
  );
  assert.ok(pb, 'product_barcodes row must exist for Anna Nagar');
  assert.equal(pb.barcodeType, 'MANUFACTURER');
  assert.equal(pb.branchId, BRANCH_ANNA_NAGAR);
});

test('Scenario 2: Add the same product with the same MBC in T Nagar — successful', async () => {
  const mbc = '8901234567890';
  const res = await api(
    'POST',
    '/api/items',
    { 'x-branch-id': BRANCH_T_NAGAR },
    {
      name: 'Tata Salt 1kg T Nagar',
      barcode: mbc,
      barcodeType: 'MANUFACTURER',
      priceMinor: 2800,
      costMinor: 2400,
      branchId: BRANCH_T_NAGAR,
    },
    ownerToken
  );

  assert.equal(res.status, 200, 'Should successfully create item with same MBC in T Nagar');
  assert.equal(res.body.item.barcode, mbc);
  assert.equal(res.body.item.branchId, BRANCH_T_NAGAR);

  // Verify stored in product_barcodes with branch_id
  const pb = await db.one<{ id: string; barcodeType: string; branchId: string }>(
    `SELECT id, barcode_type, branch_id FROM product_barcodes WHERE tenant_id = ? AND branch_id = ? AND barcode = ?`,
    [TEST_TENANT, BRANCH_T_NAGAR, mbc]
  );
  assert.ok(pb, 'product_barcodes row must exist for T Nagar with the same MBC');
  assert.equal(pb.barcodeType, 'MANUFACTURER');
  assert.equal(pb.branchId, BRANCH_T_NAGAR);
});

test('Scenario 3: Generate the same IBC in Anna Nagar and T Nagar — successful', async () => {
  const sharedIbc = '2001000000018';

  // 1. Add product with IBC in Anna Nagar
  const resAnna = await api(
    'POST',
    '/api/items',
    { 'x-branch-id': BRANCH_ANNA_NAGAR },
    {
      name: 'Fresh Apples Anna Nagar',
      barcode: sharedIbc,
      barcodeType: 'INTERNAL',
      priceMinor: 15000,
      costMinor: 12000,
      branchId: BRANCH_ANNA_NAGAR,
    },
    ownerToken
  );
  assert.equal(resAnna.status, 200, 'Anna Nagar should accept internal barcode');
  assert.equal(resAnna.body.item.barcode, sharedIbc);

  // 2. Add product with same IBC in T Nagar
  const resTNagar = await api(
    'POST',
    '/api/items',
    { 'x-branch-id': BRANCH_T_NAGAR },
    {
      name: 'Fresh Apples T Nagar',
      barcode: sharedIbc,
      barcodeType: 'INTERNAL',
      priceMinor: 15000,
      costMinor: 12000,
      branchId: BRANCH_T_NAGAR,
    },
    ownerToken
  );
  assert.equal(resTNagar.status, 200, 'T Nagar must accept the exact same internal barcode');
  assert.equal(resTNagar.body.item.barcode, sharedIbc);

  // Both branches must have distinct rows in product_barcodes
  const pbRows = await db.query<{ id: string; branchId: string; barcode: string; barcodeType: string }>(
    `SELECT id, branch_id, barcode, barcode_type FROM product_barcodes WHERE tenant_id = ? AND barcode = ?`,
    [TEST_TENANT, sharedIbc]
  );
  assert.equal(pbRows.length, 2, 'Both branch IBC records must coexist');
  const branches = new Set(pbRows.map((r) => r.branchId));
  assert.ok(branches.has(BRANCH_ANNA_NAGAR));
  assert.ok(branches.has(BRANCH_T_NAGAR));
});

test('Scenario 4: Assign the same IBC to two different products in Anna Nagar — reject', async () => {
  const sharedIbc = '2001000000018';

  // Attempt to create a 2nd product in Anna Nagar with the same IBC
  const res = await api(
    'POST',
    '/api/items',
    { 'x-branch-id': BRANCH_ANNA_NAGAR },
    {
      name: 'Red Delicious Apples Anna Nagar',
      barcode: sharedIbc,
      barcodeType: 'INTERNAL',
      priceMinor: 18000,
      costMinor: 14000,
      branchId: BRANCH_ANNA_NAGAR,
    },
    ownerToken
  );
  assert.equal(res.status, 409, 'Must reject duplicate IBC within the same branch (Anna Nagar)');

  // Also test assigning via POST /api/items/:id/barcodes
  const item3 = await api(
    'POST',
    '/api/items',
    { 'x-branch-id': BRANCH_ANNA_NAGAR },
    {
      name: 'Green Apples Anna Nagar',
      priceMinor: 18000,
      costMinor: 14000,
      branchId: BRANCH_ANNA_NAGAR,
    },
    ownerToken
  );
  assert.equal(item3.status, 200);

  const assignRes = await api(
    'POST',
    `/api/items/${item3.body.item.id}/barcodes`,
    { 'x-branch-id': BRANCH_ANNA_NAGAR },
    {
      barcode: sharedIbc,
      barcodeType: 'INTERNAL',
      branchId: BRANCH_ANNA_NAGAR,
    },
    ownerToken
  );
  assert.equal(assignRes.status, 409, 'Must reject assigning existing IBC to another product in Anna Nagar');
});

test('Scenario 5: Assign the same IBC to two different products in T Nagar — reject', async () => {
  const sharedIbc = '2001000000018';

  // Attempt to create a 2nd product in T Nagar with the same IBC
  const res = await api(
    'POST',
    '/api/items',
    { 'x-branch-id': BRANCH_T_NAGAR },
    {
      name: 'Shimla Apples T Nagar',
      barcode: sharedIbc,
      barcodeType: 'INTERNAL',
      priceMinor: 16000,
      costMinor: 13000,
      branchId: BRANCH_T_NAGAR,
    },
    ownerToken
  );
  assert.equal(res.status, 409, 'Must reject duplicate IBC within the same branch (T Nagar)');

  // Also test database-level constraint rejection
  const newProdId = newId('i');
  await db.exec(
    `INSERT INTO items (id, tenant_id, branch_id, name, price_minor, cost_minor, unit, active)
     VALUES (?, ?, ?, 'DB Constraint Test Item', 1000, 500, 'pcs', true)`,
    [newProdId, TEST_TENANT, BRANCH_T_NAGAR]
  );

  await assert.rejects(
    async () => {
      await db.exec(
        `INSERT INTO product_barcodes (id, tenant_id, branch_id, product_id, barcode, barcode_type)
         VALUES (?, ?, ?, ?, ?, 'INTERNAL')`,
        [newId('bc'), TEST_TENANT, BRANCH_T_NAGAR, newProdId, sharedIbc]
      );
    },
    /duplicate key|unique constraint|product_barcodes_internal_branch_uq/i,
    'Database unique index must reject duplicate internal barcode within the same branch'
  );
});

test('Scenario 6: Generate a new IBC in Anna Nagar — check duplicates only in Anna Nagar', async () => {
  // Generate IBC in Anna Nagar
  const resGenAnna = await api(
    'GET',
    `/api/items/generate-barcode?branchId=${BRANCH_ANNA_NAGAR}`,
    { 'x-branch-id': BRANCH_ANNA_NAGAR },
    undefined,
    ownerToken
  );
  assert.equal(resGenAnna.status, 200);
  assert.ok(resGenAnna.body.barcode);
  assert.equal(resGenAnna.body.barcodeType, 'INTERNAL');

  const annaBc = resGenAnna.body.barcode;

  // Verify that it is not equal to Anna Nagar's existing IBC '2001000000018'
  assert.notEqual(annaBc, '2001000000018');

  // Check validation API: available in Anna Nagar
  const checkRes = await api(
    'GET',
    `/api/items/check-barcode?barcode=${annaBc}&branchId=${BRANCH_ANNA_NAGAR}&barcodeType=INTERNAL`,
    { 'x-branch-id': BRANCH_ANNA_NAGAR },
    undefined,
    ownerToken
  );
  assert.equal(checkRes.status, 200);
  assert.equal(checkRes.body.available, true);
  assert.equal(checkRes.body.conflict, false);
});

test('Scenario 7: Switch branches and verify that barcode searches return the correct branch-specific records', async () => {
  const sharedIbc = '2001000000018';
  const sharedMbc = '8901234567890';

  // 1. Search by IBC in Anna Nagar -> returns Anna Nagar product
  const resByIbcAnna = await api(
    'GET',
    `/api/items/by-barcode/${sharedIbc}`,
    { 'x-branch-id': BRANCH_ANNA_NAGAR },
    undefined,
    ownerToken
  );
  assert.equal(resByIbcAnna.status, 200);
  assert.equal(resByIbcAnna.body.item.branchId, BRANCH_ANNA_NAGAR);
  assert.equal(resByIbcAnna.body.item.name, 'Fresh Apples Anna Nagar');

  // 2. Search by IBC in T Nagar -> returns T Nagar product
  const resByIbcTNagar = await api(
    'GET',
    `/api/items/by-barcode/${sharedIbc}`,
    { 'x-branch-id': BRANCH_T_NAGAR },
    undefined,
    ownerToken
  );
  assert.equal(resByIbcTNagar.status, 200);
  assert.equal(resByIbcTNagar.body.item.branchId, BRANCH_T_NAGAR);
  assert.equal(resByIbcTNagar.body.item.name, 'Fresh Apples T Nagar');

  // 3. Search by MBC in Anna Nagar -> returns Anna Nagar product
  const resByMbcAnna = await api(
    'GET',
    `/api/items/by-barcode/${sharedMbc}`,
    { 'x-branch-id': BRANCH_ANNA_NAGAR },
    undefined,
    ownerToken
  );
  assert.equal(resByMbcAnna.status, 200);
  assert.equal(resByMbcAnna.body.item.branchId, BRANCH_ANNA_NAGAR);
  assert.equal(resByMbcAnna.body.item.name, 'Tata Salt 1kg Anna Nagar');

  // 4. Search by MBC in T Nagar -> returns T Nagar product
  const resByMbcTNagar = await api(
    'GET',
    `/api/items/by-barcode/${sharedMbc}`,
    { 'x-branch-id': BRANCH_T_NAGAR },
    undefined,
    ownerToken
  );
  assert.equal(resByMbcTNagar.status, 200);
  assert.equal(resByMbcTNagar.body.item.branchId, BRANCH_T_NAGAR);
  assert.equal(resByMbcTNagar.body.item.name, 'Tata Salt 1kg T Nagar');

  // 5. Query /api/items?barcode=... with branch filter returns only that branch's item
  const queryAnna = await api(
    'GET',
    `/api/items?barcode=${sharedMbc}`,
    { 'x-branch-id': BRANCH_ANNA_NAGAR },
    undefined,
    ownerToken
  );
  assert.equal(queryAnna.status, 200);
  assert.equal(queryAnna.body.items.length, 1);
  assert.equal(queryAnna.body.items[0].branchId, BRANCH_ANNA_NAGAR);

  const queryTNagar = await api(
    'GET',
    `/api/items?barcode=${sharedMbc}`,
    { 'x-branch-id': BRANCH_T_NAGAR },
    undefined,
    ownerToken
  );
  assert.equal(queryTNagar.status, 200);
  assert.equal(queryTNagar.body.items.length, 1);
  assert.equal(queryTNagar.body.items[0].branchId, BRANCH_T_NAGAR);
});
