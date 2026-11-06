import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';
import { createApp } from '../src/app.ts';
import { connectDb, type DB } from '../src/db/index.ts';
import { signToken, hashPassword, passwordStamp } from '../src/security.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-long-enough-32-chars-at-least';
const TEST_TENANT = 't_pos_stk_' + Date.now();
const BRANCH_MAIN = 'b_stk_main_' + Date.now();
const BRANCH_SEC = 'b_stk_sec_' + Date.now();

let db: DB;
let server: http.Server;
let base = '';
let cashierToken = '';
let cashierSecToken = '';

async function api(method: string, path: string, body?: any, token?: string, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
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

    // 1. Setup Tenant and Branches
    await db.exec(`INSERT INTO tenants (id, name, business_type) VALUES (?, 'POS Stock Test Mart', 'supermarket')`, [TEST_TENANT]);
    await db.exec(`INSERT INTO branches (id, tenant_id, name, code, active) VALUES (?, ?, 'SKS Main Central Branch', 'MAIN', true)`, [BRANCH_MAIN, TEST_TENANT]);
    await db.exec(`INSERT INTO branches (id, tenant_id, name, code, active) VALUES (?, ?, 'SKS Porur Branch', 'PORUR', true)`, [BRANCH_SEC, TEST_TENANT]);

    // 2. Setup Cashier in Main Branch
    const pwd = hashPassword('CashierPass123!');
    const cashierId = 'u_cashier_' + Date.now();
    await db.exec(
      `INSERT INTO users (id, tenant_id, branch_id, name, email, password_hash, role, active)
       VALUES (?, ?, ?, 'Cashier 1', ?, ?, 'cashier', true)`,
      [cashierId, TEST_TENANT, BRANCH_MAIN, `cashier_${Date.now()}@test.local`, pwd]
    );
    cashierToken = signToken(
      {
        sub: cashierId,
        tid: TEST_TENANT,
        ph: passwordStamp(pwd),
        role: 'cashier',
        branchId: BRANCH_MAIN,
      },
      JWT_SECRET,
      3600
    );

    // Setup Cashier in Secondary Branch
    const cashierSecId = 'u_cashier_sec_' + Date.now();
    await db.exec(
      `INSERT INTO users (id, tenant_id, branch_id, name, email, password_hash, role, active)
       VALUES (?, ?, ?, 'Cashier Porur', ?, ?, 'cashier', true)`,
      [cashierSecId, TEST_TENANT, BRANCH_SEC, `cashier_sec_${Date.now()}@test.local`, pwd]
    );
    cashierSecToken = signToken(
      {
        sub: cashierSecId,
        tid: TEST_TENANT,
        ph: passwordStamp(pwd),
        role: 'cashier',
        branchId: BRANCH_SEC,
      },
      JWT_SECRET,
      3600
    );

    // 3. Open a shift for Cashier 1
    const shiftId = 'shf_' + Date.now();
    await db.exec(
      `INSERT INTO shifts (id, tenant_id, user_id, branch_id, counter, status, opening_cash_minor, opened_at)
       VALUES (?, ?, ?, ?, 'COUNTER-1', 'open', 50000, now())`,
      [shiftId, TEST_TENANT, cashierId, BRANCH_MAIN]
    );

    // Open a shift for Cashier Porur
    const shiftSecId = 'shf_sec_' + Date.now();
    await db.exec(
      `INSERT INTO shifts (id, tenant_id, user_id, branch_id, counter, status, opening_cash_minor, opened_at)
       VALUES (?, ?, ?, ?, 'COUNTER-1', 'open', 50000, now())`,
      [shiftSecId, TEST_TENANT, cashierSecId, BRANCH_SEC]
    );
  } catch (err) {
    console.error('BEFORE FAILED:', err);
    throw err;
  }
});

after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  try {
    await db.exec(`DELETE FROM stock_moves WHERE tenant_id = ?`, [TEST_TENANT]);
    await db.exec(`DELETE FROM invoice_lines WHERE tenant_id = ?`, [TEST_TENANT]);
    await db.exec(`DELETE FROM invoices WHERE tenant_id = ?`, [TEST_TENANT]);
    await db.exec(`DELETE FROM number_series WHERE tenant_id = ?`, [TEST_TENANT]);
    await db.exec(`DELETE FROM shifts WHERE tenant_id = ?`, [TEST_TENANT]);
    await db.exec(`DELETE FROM users WHERE tenant_id = ?`, [TEST_TENANT]);
    await db.exec(`DELETE FROM items WHERE tenant_id = ?`, [TEST_TENANT]);
    await db.exec(`DELETE FROM branches WHERE tenant_id = ?`, [TEST_TENANT]);
    await db.exec(`DELETE FROM tenants WHERE id = ?`, [TEST_TENANT]);
  } catch {}
});

test('POS Stock Validation: selling 5 units when available stock is 4 units is blocked with INSUFFICIENT_STOCK error', async () => {
  const itemId = 'it_amul_milk_' + Date.now();
  await db.exec(
    `INSERT INTO items (id, tenant_id, branch_id, name, sku, barcode, unit, category, price_minor, cost_minor, track_stock, active)
     VALUES (?, ?, ?, 'Amul Taaza Milk 1L', 'MLK-AMU-1L', '8901234567801', 'pouch', 'Dairy & Eggs', 5400, 4500, true, true)`,
    [itemId, TEST_TENANT, BRANCH_MAIN]
  );

  // Add 4 units (+4000 milli) stock in Main branch
  await db.exec(
    `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, location, qty_milli, kind)
     VALUES (?, ?, ?, ?, 'MAIN', 4000, 'opening')`,
    ['sm_op_' + Date.now(), TEST_TENANT, BRANCH_MAIN, itemId]
  );

  // Attempt to bill 5 units (5000 milli)
  const res = await api('POST', '/api/invoices', {
    lines: [
      {
        itemId,
        name: 'Amul Taaza Milk 1L',
        qtyMilli: 5000,
        priceMinor: 5400,
        unit: 'pouch',
      },
    ],
    payments: [{ method: 'cash', amountMinor: 27000 }],
    counter: 'COUNTER-1',
  }, cashierToken);

  assert.equal(res.status, 400, `Should reject with HTTP 400, got: ${res.status} ${JSON.stringify(res.body)}`);
  assert.equal(res.body?.error?.code, 'INSUFFICIENT_STOCK', 'Code should be INSUFFICIENT_STOCK');
  assert.match(res.body?.error?.message, /Insufficient stock.*Only 4 units available/i, 'Error message should indicate 4 units available');

  // Verify stock in DB was NOT deducted
  const stockRow = await db.one<{ sum: string }>(
    `SELECT COALESCE(SUM(qty_milli), 0)::text as sum FROM stock_moves WHERE item_id = ? AND branch_id = ?`,
    [itemId, BRANCH_MAIN]
  );
  assert.equal(stockRow?.sum, '4000', 'Stock should still be 4000 milli (4 units)');

  // Verify no invoice was created
  const invCount = await db.one<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM invoices WHERE tenant_id = ?`,
    [TEST_TENANT]
  );
  assert.equal(invCount?.count, '0', 'Zero invoices should exist');
});

test('POS Stock Validation: selling exact 4 units when available stock is 4 succeeds and reduces stock to 0', async () => {
  const itemId = 'it_atta_' + Date.now();
  await db.exec(
    `INSERT INTO items (id, tenant_id, branch_id, name, sku, barcode, unit, category, price_minor, cost_minor, track_stock, active)
     VALUES (?, ?, ?, 'Aashirvaad Atta 5kg', 'ATT-AAS-5KG', '8901134467801', 'bag', 'Flour & Grains', 28000, 24000, true, true)`,
    [itemId, TEST_TENANT, BRANCH_MAIN]
  );

  // Add 4 units (+4000 milli) stock
  await db.exec(
    `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, location, qty_milli, kind)
     VALUES (?, ?, ?, ?, 'MAIN', 4000, 'opening')`,
    ['sm_op2_' + Date.now(), TEST_TENANT, BRANCH_MAIN, itemId]
  );

  // Bill 4 units (4000 milli)
  const res = await api('POST', '/api/invoices', {
    lines: [
      {
        itemId,
        name: 'Aashirvaad Atta 5kg',
        qtyMilli: 4000,
        priceMinor: 28000,
        unit: 'bag',
      },
    ],
    payments: [{ method: 'cash', amountMinor: 112000 }],
    counter: 'COUNTER-1',
  }, cashierToken);

  assert.equal(res.status, 200, `Should succeed with HTTP 200, got: ${res.status} ${JSON.stringify(res.body)}`);
  assert.ok(res.body.invoiceId, 'Should return created invoice ID');

  // Verify stock is now 0 milli in the branch
  const stockRow = await db.one<{ sum: string }>(
    `SELECT COALESCE(SUM(qty_milli), 0)::text as sum FROM stock_moves WHERE item_id = ? AND branch_id = ?`,
    [itemId, BRANCH_MAIN]
  );
  assert.equal(stockRow?.sum, '0', 'Stock should now be 0 milli');

  // Subsequent bill for 1 unit must fail
  const nextRes = await api('POST', '/api/invoices', {
    lines: [
      {
        itemId,
        name: 'Aashirvaad Atta 5kg',
        qtyMilli: 1000,
        priceMinor: 28000,
        unit: 'bag',
      },
    ],
    payments: [{ method: 'cash', amountMinor: 28000 }],
    counter: 'COUNTER-1',
  }, cashierToken);

  assert.equal(nextRes.status, 400, 'Subsequent bill must be rejected');
  assert.equal(nextRes.body?.error?.code, 'INSUFFICIENT_STOCK');
  assert.match(nextRes.body?.error?.message, /Only 0 units available/i);
});

test('POS Stock Validation: Branch isolation prevents using another branch stock', async () => {
  const itemId = 'it_sugar_' + Date.now();
  await db.exec(
    `INSERT INTO items (id, tenant_id, branch_id, name, sku, barcode, unit, category, price_minor, cost_minor, track_stock, active)
     VALUES (?, ?, ?, 'Madhur Sugar 1kg', 'SUG-MAD-1KG', '8901234567899', 'kg', 'Grocery', 4500, 3800, true, true)`,
    [itemId, TEST_TENANT, BRANCH_MAIN]
  );

  // Main branch has only 2 units (2000 milli)
  await db.exec(
    `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, location, qty_milli, kind)
     VALUES (?, ?, ?, ?, 'MAIN', 2000, 'opening')`,
    ['sm_sug_main_' + Date.now(), TEST_TENANT, BRANCH_MAIN, itemId]
  );

  // Porur branch has 20 units (20000 milli)
  await db.exec(
    `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, location, qty_milli, kind)
     VALUES (?, ?, ?, ?, 'PORUR', 20000, 'opening')`,
    ['sm_sug_sec_' + Date.now(), TEST_TENANT, BRANCH_SEC, itemId]
  );

  // Cashier at MAIN tries to bill 5 units -> Should FAIL (only 2 in MAIN)
  const mainRes = await api('POST', '/api/invoices', {
    lines: [
      {
        itemId,
        name: 'Madhur Sugar 1kg',
        qtyMilli: 5000,
        priceMinor: 4500,
        unit: 'kg',
      },
    ],
    payments: [{ method: 'cash', amountMinor: 22500 }],
    counter: 'COUNTER-1',
  }, cashierToken);

  assert.equal(mainRes.status, 400, 'Main branch sale of 5 units should fail');
  assert.equal(mainRes.body?.error?.code, 'INSUFFICIENT_STOCK');
  assert.match(mainRes.body?.error?.message, /Only 2 units available/i);

  // Cashier at PORUR tries to bill 5 units -> Should SUCCEED (20 in PORUR)
  const secRes = await api('POST', '/api/invoices', {
    lines: [
      {
        itemId,
        name: 'Madhur Sugar 1kg',
        qtyMilli: 5000,
        priceMinor: 4500,
        unit: 'kg',
      },
    ],
    payments: [{ method: 'cash', amountMinor: 22500 }],
    counter: 'COUNTER-1',
  }, cashierSecToken);

  assert.equal(secRes.status, 200, 'Porur branch sale of 5 units should succeed');
  assert.ok(secRes.body.invoiceId);

  // Verify Porur stock decreased from 20000 to 15000 milli
  const porurStock = await db.one<{ sum: string }>(
    `SELECT COALESCE(SUM(qty_milli), 0)::text as sum FROM stock_moves WHERE item_id = ? AND branch_id = ?`,
    [itemId, BRANCH_SEC]
  );
  assert.equal(porurStock?.sum, '15000', 'Porur stock should be 15000 milli (15 units)');

  // Verify Main stock remained untouched at 2000 milli
  const mainStock = await db.one<{ sum: string }>(
    `SELECT COALESCE(SUM(qty_milli), 0)::text as sum FROM stock_moves WHERE item_id = ? AND branch_id = ?`,
    [itemId, BRANCH_MAIN]
  );
  assert.equal(mainStock?.sum, '2000', 'Main stock should remain 2000 milli (2 units)');
});

test('POS Stock Validation: Untracked item (track_stock = false) can be billed without inventory limits', async () => {
  const itemId = 'it_service_' + Date.now();
  await db.exec(
    `INSERT INTO items (id, tenant_id, branch_id, name, sku, barcode, unit, category, price_minor, cost_minor, track_stock, active)
     VALUES (?, ?, ?, 'Home Delivery Service', 'SRV-DLV', 'DELIVERY01', 'service', 'Services', 5000, 0, false, true)`,
    [itemId, TEST_TENANT, BRANCH_MAIN]
  );

  // Zero stock in stock_moves for this item
  const res = await api('POST', '/api/invoices', {
    lines: [
      {
        itemId,
        name: 'Home Delivery Service',
        qtyMilli: 10000, // 10 units
        priceMinor: 5000,
        unit: 'service',
      },
    ],
    payments: [{ method: 'cash', amountMinor: 50000 }],
    counter: 'COUNTER-1',
  }, cashierToken);

  assert.equal(res.status, 200, 'Untracked item should succeed billing without stock check');
  assert.ok(res.body.invoiceId);
});
