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

const PW = 'Promo-Secret-2026';
let ownerToken = '';
let cashierToken = '';
let tenantId = '';
let createdPromoId = '';

test('Discounts and Promotions API integration', async (t) => {
  if (skipReason) {
    t.skip(skipReason);
    return;
  }

  await t.test('1. Setup tenant, owner, cashier, and item', async () => {
    const reg = await api('POST', '/api/auth/register', {
      name: 'Supermarket SuperStore',
      ownerName: 'Kanishka A',
      email: 'kanishka.owner@example.com',
      password: PW,
      businessType: 'retail',
    });
    assert.equal(reg.status, 200);
    ownerToken = reg.body.token;
    tenantId = reg.body.shop.id;

    // Create a cashier user
    const cash = await api('POST', '/api/users', {
      name: 'Cashier Counter 1',
      email: 'cashier1@example.com',
      password: PW,
      role: 'cashier',
    }, ownerToken);
    assert.equal(cash.status, 200);

    const loginCash = await api('POST', '/api/auth/login', {
      email: 'cashier1@example.com',
      password: PW,
    });
    assert.equal(loginCash.status, 200);
    cashierToken = loginCash.body.token;

    // Create item
    const item = await api('POST', '/api/items', {
      name: 'Britannia Marie Gold 200g',
      sku: 'BSC001',
      barcode: '8901030384874',
      hsn: '1905',
      unit: 'pcs',
      category: 'Snacks',
      priceMinor: 5000, // ₹50.00
      costMinor: 3500,
      taxRateBp: 500, // 5%
      taxInclusive: true,
    }, ownerToken);
    assert.equal(item.status, 200);
  });

  await t.test('2. Cashier cannot create promotion (role-based access)', async () => {
    const res = await api('POST', '/api/promotions', {
      name: 'Unauthorized Promo',
      type: 'percentage',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      rules: { discountPct: 10 },
    }, cashierToken);
    assert.equal(res.status, 403);
  });

  await t.test('3. Owner can create BOGO promotion', async () => {
    const res = await api('POST', '/api/promotions', {
      name: 'Buy 2 Get 1 Free Marie Gold',
      description: 'Buy 2 Britannia Marie Gold, get 1 Free',
      type: 'bogo',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      branches: ['ALL'],
      counters: ['ALL'],
      rules: {
        qualifyingProductId: 'BSC001',
        qualifyingQty: 2,
        freeProductId: 'BSC001',
        freeQty: 1,
        sameProduct: true,
        maxFreePerBill: 5,
      },
      customerEligibilityType: 'all',
      status: 'active',
    }, ownerToken);

    assert.equal(res.status, 200);
    assert.ok(res.body.promotion.id);
    assert.equal(res.body.promotion.name, 'Buy 2 Get 1 Free Marie Gold');
    createdPromoId = res.body.promotion.id;
  });

  await t.test('4. Fetch promotions and verify summary counts', async () => {
    const res = await api('GET', '/api/promotions', undefined, ownerToken);
    assert.equal(res.status, 200);
    assert.ok(res.body.promotions.length >= 1);
    assert.ok(res.body.summary.totalPromotions >= 1);
    assert.ok(res.body.summary.activePromotions >= 1);
  });

  await t.test('5. Duplicate promotion', async () => {
    const dup = await api('POST', `/api/promotions/${createdPromoId}/duplicate`, {}, ownerToken);
    assert.equal(dup.status, 200);
    assert.match(dup.body.promotion.name, /Buy 2 Get 1 Free Marie Gold \(Copy\)/);
    assert.equal(dup.body.promotion.status, 'draft');

    // Clean up duplicate
    const del = await api('DELETE', `/api/promotions/${dup.body.promotion.id}`, {}, ownerToken);
    assert.equal(del.status, 200);
  });

  await t.test('6. Cashier can evaluate promotion for POS cart', async () => {
    const evalRes = await api('POST', '/api/promotions/evaluate', {
      cart: [
        {
          itemId: 'BSC001',
          name: 'Britannia Marie Gold 200g',
          category: 'Snacks',
          priceMinor: 5000,
          qty: 3,
        },
      ],
      branch: 'MAIN',
      counter: 'COUNTER-1',
    }, cashierToken);

    assert.equal(evalRes.status, 200);
    assert.equal(evalRes.body.appliedPromotions.length, 1);
    assert.equal(evalRes.body.appliedPromotions[0].promotionId, createdPromoId);
    assert.equal(evalRes.body.appliedPromotions[0].discountMinor, 5000); // 1 free unit = ₹50
    assert.equal(evalRes.body.totalDiscountMinor, 5000);
  });

  await t.test('7. POS billing applies promotion and stores usage', async () => {
    const inv = await api('POST', '/api/invoices', {
      lines: [
        {
          itemId: 'BSC001',
          name: 'Britannia Marie Gold 200g',
          qtyMilli: 3000,
          priceMinor: 5000,
          discountMinor: 5000,
          taxRateBp: 500,
          inclusive: true,
          unit: 'pcs',
        },
      ],
      payments: [{ method: 'cash', amountMinor: 10000 }], // 3 * 50 - 50 = 100
      appliedPromotions: [
        {
          promotionId: createdPromoId,
          promotionName: 'Buy 2 Get 1 Free Marie Gold',
          promotionType: 'bogo',
          discountMinor: 5000,
        },
      ],
      promotionDiscountMinor: 5000,
      tender: { cashReceivedMinor: 10000 },
    }, cashierToken);

    assert.equal(inv.status, 200);
    assert.ok(inv.body.invoiceId);
    assert.equal(inv.body.totalMinor, 10000); // ₹100.00 payable

    // Verify promotion usage report
    const rep = await api('GET', '/api/promotions/reports?period=today', undefined, ownerToken);
    assert.equal(rep.status, 200);
    assert.equal(rep.body.overview.totalDiscountMinor, 5000);
    assert.equal(rep.body.overview.billsCount, 1);
    assert.equal(rep.body.mostUsedPromotions.length, 1);
    assert.equal(rep.body.mostUsedPromotions[0].promotionId, createdPromoId);
  });
});

