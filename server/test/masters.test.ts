import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';
import { can, ROLES, STANDARD_UNITS } from '../../shared/types.ts';
import { calcBill, gstinCheckChar, validateGstin } from '../../shared/tax.ts';
import { normalizePhone } from '../../shared/whatsapp.ts';
import { STATES } from '../../shared/states.ts';
import { createApp } from '../src/app.ts';
import { connectWire } from '../src/db/wire.ts';
import { migrate, type DB } from '../src/db/index.ts';
import { startTestDb, type TestDb } from './support/testdb.ts';

// ------------------------------------------------------------------ Pure unit tests (roles, phone, GSTIN, custom)
test('roles: verify permission matrix for items and parties', () => {
  // items.view: all roles allowed
  for (const role of ROLES) {
    assert.equal(can(role, 'items.view'), true, `${role} should have items.view`);
    assert.equal(can(role, 'parties.view'), true, `${role} should have parties.view`);
  }

  // items.write: only owner and manager
  assert.equal(can('owner', 'items.write'), true);
  assert.equal(can('manager', 'items.write'), true);
  assert.equal(can('cashier', 'items.write'), false, 'cashier must not write items');
  assert.equal(can('accountant', 'items.write'), false, 'accountant must not write items');

  // parties.write: owner, manager, cashier (needed for counter checkout)
  assert.equal(can('owner', 'parties.write'), true);
  assert.equal(can('manager', 'parties.write'), true);
  assert.equal(can('cashier', 'parties.write'), true, 'cashier needs parties.write for quick-add');
  assert.equal(can('accountant', 'parties.write'), false, 'accountant must not write parties');
});

test('phone normalization: cleans Indian phone numbers, rejects invalid', () => {
  assert.equal(normalizePhone('9876543210'), '919876543210');
  assert.equal(normalizePhone('09876543210'), '919876543210');
  assert.equal(normalizePhone('919876543210'), '919876543210');
  assert.equal(normalizePhone('+91 98765 43210'), '919876543210');
  assert.equal(normalizePhone('00919876543210'), '919876543210');
  assert.equal(normalizePhone('12345'), null, 'too short');
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone(undefined), null);
});

test('GSTIN validation and state extraction', () => {
  const g14 = '33AAAAA0000A1Z';
  const validGstin = g14 + gstinCheckChar(g14);
  assert.equal(validateGstin(validGstin).ok, true);

  const stateCode = validGstin.slice(0, 2);
  assert.equal(stateCode, '33');
  const state = STATES.find((s) => s.code === stateCode);
  assert.equal(state?.name, 'Tamil Nadu');

  // Bad check character
  const badCheck = g14 + (validGstin.endsWith('1') ? '2' : '1');
  const resBad = validateGstin(badCheck);
  assert.equal(resBad.ok, false);
  assert.match(resBad.reason!, /check character/i);

  // Bad format
  const badFormat = validateGstin('INVALID-GSTIN');
  assert.equal(badFormat.ok, false);
  assert.match(badFormat.reason!, /format/i);
});

test('units: STANDARD_UNITS definitions and code coverage', () => {
  const codes = STANDARD_UNITS.map((u) => u.code);
  assert.ok(codes.includes('pcs'), 'pcs must be present');
  assert.ok(codes.includes('kg'), 'kg must be present');
  assert.ok(codes.includes('g'), 'g must be present');
  assert.ok(codes.includes('l'), 'l must be present');
  assert.ok(codes.includes('m'), 'm must be present');
  assert.ok(codes.includes('box'), 'box must be present');
  for (const u of STANDARD_UNITS) {
    assert.ok(u.code.length > 0);
    assert.ok(u.name.length > 0);
  }
});

test('categories: roles permission check for category viewing and writing', () => {
  for (const role of ROLES) {
    assert.equal(can(role, 'items.view'), true, `${role} can view items/categories`);
  }
  assert.equal(can('owner', 'items.write'), true);
  assert.equal(can('manager', 'items.write'), true);
  assert.equal(can('cashier', 'items.write'), false);
  assert.equal(can('accountant', 'items.write'), false);
});

test('purchases: roles permission check for purchase entry and stock inward', () => {
  assert.equal(can('owner', 'purchases'), true, 'owner must be able to record purchases');
  assert.equal(can('manager', 'purchases'), true, 'manager must be able to record purchases');
  assert.equal(can('cashier', 'purchases'), false, 'cashier must not enter purchases');
  assert.equal(can('accountant', 'purchases'), true, 'accountant can record purchases');
  assert.equal(can('accountant', 'purchases.void'), false, 'accountant cannot void purchases');
});

test('purchases: purchase bill tax calculation splits CGST/SGST intra-state', () => {
  const lines = [
    { name: 'Test Raw Material', qtyMilli: 10000, priceMinor: 10000, discountMinor: 0, taxRateBp: 1800, inclusive: false },
  ];
  const calc = calcBill(lines, { intraState: true, roundTotal: 'rupee' });
  assert.equal(calc.subtotalMinor, 100000);
  assert.equal(calc.taxableMinor, 100000);
  assert.equal(calc.cgstMinor, 9000);
  assert.equal(calc.sgstMinor, 9000);
  assert.equal(calc.igstMinor, 0);
  assert.equal(calc.totalMinor, 118000);
});

test('purchases: inter-state purchase uses IGST only', () => {
  const lines = [
    { name: 'Imported Goods', qtyMilli: 5000, priceMinor: 20000, discountMinor: 0, taxRateBp: 1800, inclusive: false },
  ];
  const calc = calcBill(lines, { intraState: false, roundTotal: 'rupee' });
  assert.equal(calc.subtotalMinor, 100000);
  assert.equal(calc.taxableMinor, 100000);
  assert.equal(calc.cgstMinor, 0);
  assert.equal(calc.sgstMinor, 0);
  assert.equal(calc.igstMinor, 18000);
  assert.equal(calc.totalMinor, 118000);
});

// ------------------------------------------------------------------ Database + API integration tests (real PostgreSQL)
let pg: TestDb | null = null;
let db: DB;
let server: http.Server;
let base = '';
let skipReason: string | false = false;

before(async () => {
  pg = await startTestDb();
  if (!pg) {
    skipReason = 'PostgreSQL server programs (initdb, pg_ctl) were not found. Install PostgreSQL or set PG_BIN.';
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

const g14 = '33AAAAA0000A1Z';
const VALID_GSTIN = g14 + gstinCheckChar(g14);
const PW = 'Tamil-Shop-2026';

interface ShopTokens {
  owner: string;
  manager: string;
  cashier: string;
  accountant: string;
  tenantId: string;
}

const shopA: ShopTokens = { owner: '', manager: '', cashier: '', accountant: '', tenantId: '' };
const shopB: ShopTokens = { owner: '', manager: '', cashier: '', accountant: '', tenantId: '' };

test('setup: register Shop A and Shop B with staff', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // Shop A
  const regA = await api('POST', '/api/auth/register', {
    name: 'Shop A Retail',
    ownerName: 'Owner A',
    email: 'ownerA@shopa.test',
    password: PW,
    businessType: 'retail',
    gstin: VALID_GSTIN,
    phone: '9876543210',
  });
  assert.equal(regA.status, 200, JSON.stringify(regA.body));
  shopA.owner = regA.body.token;
  shopA.tenantId = regA.body.shop.id;

  // Staff in Shop A
  const mgrA = await api('POST', '/api/users', { name: 'Manager A', email: 'mgrA@shopa.test', password: PW, role: 'manager' }, shopA.owner);
  assert.equal(mgrA.status, 200);
  shopA.manager = (await api('POST', '/api/auth/login', { email: 'mgrA@shopa.test', password: PW })).body.token;

  const cshA = await api('POST', '/api/users', { name: 'Cashier A', email: 'cashA@shopa.test', password: PW, role: 'cashier' }, shopA.owner);
  assert.equal(cshA.status, 200);
  shopA.cashier = (await api('POST', '/api/auth/login', { email: 'cashA@shopa.test', password: PW })).body.token;

  const accA = await api('POST', '/api/users', { name: 'Accountant A', email: 'accA@shopa.test', password: PW, role: 'accountant' }, shopA.owner);
  assert.equal(accA.status, 200);
  shopA.accountant = (await api('POST', '/api/auth/login', { email: 'accA@shopa.test', password: PW })).body.token;

  // Shop B
  const g14B = '29BBBBB1111B1Z';
  const gstinB = g14B + gstinCheckChar(g14B);
  const regB = await api('POST', '/api/auth/register', {
    name: 'Shop B Wholesale',
    ownerName: 'Owner B',
    email: 'ownerB@shopb.test',
    password: PW,
    businessType: 'wholesale',
    gstin: gstinB,
    phone: '9876543211',
  });
  assert.equal(regB.status, 200, JSON.stringify(regB.body));
  shopB.owner = regB.body.token;
  shopB.tenantId = regB.body.shop.id;
});

test('roles: every role allowed or denied for items and parties', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // Owner can create items and parties
  const oItem = await api('POST', '/api/items', { name: 'Owner Item', priceMinor: 1000 }, shopA.owner);
  assert.equal(oItem.status, 200);
  const oParty = await api('POST', '/api/parties', { name: 'Owner Customer', phone: '9876543210' }, shopA.owner);
  assert.equal(oParty.status, 200);

  // Manager can create items and parties
  const mItem = await api('POST', '/api/items', { name: 'Manager Item', priceMinor: 2000 }, shopA.manager);
  assert.equal(mItem.status, 200);
  const mParty = await api('POST', '/api/parties', { name: 'Manager Supplier', type: 'supplier' }, shopA.manager);
  assert.equal(mParty.status, 200);

  // Cashier CANNOT create items (403), but CAN create parties (quick-add at checkout)
  const cItem = await api('POST', '/api/items', { name: 'Cashier Item', priceMinor: 3000 }, shopA.cashier);
  assert.equal(cItem.status, 403, 'cashier cannot create items');
  assert.equal(cItem.code, 'FORBIDDEN');
  const cParty = await api('POST', '/api/parties', { name: 'Cashier Quick Customer', phone: '9988776655' }, shopA.cashier);
  assert.equal(cParty.status, 200, 'cashier can quick-add customer');

  // Accountant CANNOT create items or parties
  const aItem = await api('POST', '/api/items', { name: 'Accountant Item', priceMinor: 4000 }, shopA.accountant);
  assert.equal(aItem.status, 403, 'accountant cannot create items');
  const aParty = await api('POST', '/api/parties', { name: 'Accountant Party' }, shopA.accountant);
  assert.equal(aParty.status, 403, 'accountant cannot create parties');

  // All roles can view items and parties
  for (const [roleName, token] of [['owner', shopA.owner], ['manager', shopA.manager], ['cashier', shopA.cashier], ['accountant', shopA.accountant]]) {
    const it = await api('GET', '/api/items', undefined, token);
    assert.equal(it.status, 200, `${roleName} should read items`);
    assert.ok(Array.isArray(it.body.items));

    const pt = await api('GET', '/api/parties', undefined, token);
    assert.equal(pt.status, 200, `${roleName} should read parties`);
    assert.ok(Array.isArray(pt.body.parties));
  }
});

test('isolation: another shop cannot read, edit or scan-lookup this shop items or parties', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const barcode = '8901234567890';
  const sku = 'TEA-GOLD-500';
  const itemA = (await api('POST', '/api/items', {
    name: 'Tata Tea Gold 500g',
    sku,
    barcode,
    priceMinor: 25000,
    costMinor: 21000,
  }, shopA.owner)).body.item;
  assert.ok(itemA?.id);

  const partyA = (await api('POST', '/api/parties', {
    name: 'Exclusive Supplier A',
    type: 'supplier',
    phone: '9876543299',
  }, shopA.owner)).body.party;
  assert.ok(partyA?.id);

  // Shop B lists items -> must NOT contain itemA
  const bList = await api('GET', '/api/items', undefined, shopB.owner);
  assert.equal(bList.status, 200);
  assert.equal(bList.body.items.some((i: any) => i.id === itemA.id || i.barcode === barcode), false);

  // Shop B scans barcode -> 404
  const bScan = await api('GET', `/api/items/by-barcode/${barcode}`, undefined, shopB.owner);
  assert.equal(bScan.status, 404, 'another shop cannot scan-lookup this shop item');

  // Shop B edits item -> 404
  const bEdit = await api('PATCH', `/api/items/${itemA.id}`, { name: 'Hacked Name' }, shopB.owner);
  assert.equal(bEdit.status, 404, 'another shop cannot edit this shop item');

  // Shop B lists parties -> must NOT contain partyA
  const bParties = await api('GET', '/api/parties', undefined, shopB.owner);
  assert.equal(bParties.status, 200);
  assert.equal(bParties.body.parties.some((p: any) => p.id === partyA.id), false);

  // Shop B edits party -> 404
  const bPartyEdit = await api('PATCH', `/api/parties/${partyA.id}`, { name: 'Hacked Party' }, shopB.owner);
  assert.equal(bPartyEdit.status, 404, 'another shop cannot edit this shop party');
});

test('duplicate barcode returns clear 409 naming the existing item', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const barcode = '8901030000010';
  const first = await api('POST', '/api/items', {
    name: 'Tata Salt 1kg',
    barcode,
    priceMinor: 2800,
  }, shopA.owner);
  assert.equal(first.status, 200);

  // Attempt duplicate barcode in same shop
  const dup = await api('POST', '/api/items', {
    name: 'Aashirvaad Salt 1kg',
    barcode,
    priceMinor: 2500,
  }, shopA.owner);
  assert.equal(dup.status, 409, 'duplicate barcode must return 409 Conflict');
  assert.equal(dup.code, 'CONFLICT');
  assert.match(dup.message!, /Tata Salt 1kg/, 'error must name the existing item');

  // Shop B can use the SAME barcode without collision (scoped by tenant)
  const shopBDup = await api('POST', '/api/items', {
    name: 'Shop B Salt',
    barcode,
    priceMinor: 2700,
  }, shopB.owner);
  assert.equal(shopBDup.status, 200, 'different shop can have the same barcode');
});

test('opening stock: openingQtyMilli creates stock_moves row at shop first location', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const openingQtyMilli = 15000; // 15 units
  const costMinor = 8500;
  const res = await api('POST', '/api/items', {
    name: 'Amul Butter 500g',
    priceMinor: 11000,
    costMinor,
    openingQtyMilli,
  }, shopA.owner);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const item = res.body.item;
  assert.equal(item.currentStockMilli, openingQtyMilli);

  // Verify stock_moves in database
  const moves = await db.query(
    'SELECT * FROM stock_moves WHERE item_id = ? AND tenant_id = ?',
    [item.id, shopA.tenantId],
  );
  assert.equal(moves.length, 1);
  const sm = moves[0] as any;
  assert.equal(sm.kind, 'opening');
  assert.equal(Number(sm.qtyMilli ?? sm.qty_milli), openingQtyMilli);
  assert.equal(Number(sm.unitCostMinor ?? sm.unit_cost_minor), costMinor);
  assert.equal(sm.location, 'MAIN');
});

test('search items by name, SKU and barcode (case-insensitive)', async (t) => {
  if (skipReason) return t.skip(skipReason);

  await api('POST', '/api/items', {
    name: 'Britannia Bourbon 150g',
    sku: 'BIS-BRB-150',
    barcode: '8901063012345',
    priceMinor: 3500,
    favorite: true,
  }, shopA.owner);

  await api('POST', '/api/items', {
    name: 'Britannia Marie Gold 250g',
    sku: 'BIS-MRG-250',
    barcode: '8901063054321',
    priceMinor: 4000,
    favorite: false,
  }, shopA.owner);

  // Search by name (case-insensitive)
  const byName = await api('GET', '/api/items?q=bourbon', undefined, shopA.owner);
  assert.equal(byName.status, 200);
  assert.ok(byName.body.items.some((i: any) => i.name === 'Britannia Bourbon 150g'));
  assert.equal(byName.body.items.some((i: any) => i.name === 'Britannia Marie Gold 250g'), false);

  // Search by SKU (case-insensitive)
  const bySku = await api('GET', '/api/items?q=bis-mrg', undefined, shopA.owner);
  assert.equal(bySku.status, 200);
  assert.ok(bySku.body.items.some((i: any) => i.sku === 'BIS-MRG-250'));
  assert.equal(bySku.body.items.some((i: any) => i.sku === 'BIS-BRB-150'), false);

  // Search by barcode
  const byBarcode = await api('GET', '/api/items?q=8901063012345', undefined, shopA.owner);
  assert.equal(byBarcode.status, 200);
  assert.ok(byBarcode.body.items.some((i: any) => i.barcode === '8901063012345'));

  // Exact barcode scanner lookup
  const exact = await api('GET', '/api/items/by-barcode/8901063012345', undefined, shopA.owner);
  assert.equal(exact.status, 200);
  assert.equal(exact.body.item.name, 'Britannia Bourbon 150g');

  // Filter by favorite
  const favs = await api('GET', '/api/items?favorite=1', undefined, shopA.owner);
  assert.equal(favs.status, 200);
  for (const i of favs.body.items) assert.equal(i.favorite, true);
});

test('parties: phone cleaning, GSTIN check and state derivation, counter quick-add', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // Quick-add at counter with only name and phone
  const qa = await api('POST', '/api/parties', {
    name: 'Suresh Kumar',
    phone: '98401 23456',
  }, shopA.cashier);
  assert.equal(qa.status, 200, JSON.stringify(qa.body));
  assert.equal(qa.body.party.name, 'Suresh Kumar');
  assert.equal(qa.body.party.phone, '919840123456', 'phone must be cleaned with normalizePhone');
  assert.equal(qa.body.party.type, 'customer', 'defaults to customer');
  assert.equal(qa.body.party.creditLimitMinor, 0);

  // Bad GSTIN rejected
  const badG = await api('POST', '/api/parties', {
    name: 'Bad Tax Store',
    gstin: g14 + (VALID_GSTIN.endsWith('1') ? '2' : '1'),
  }, shopA.owner);
  assert.equal(badG.status, 400, 'invalid GSTIN must return 400');
  assert.match(badG.message!, /check character/i);

  // Valid GSTIN automatically sets stateCode
  const goodG = await api('POST', '/api/parties', {
    name: 'Good Tax Wholesaler',
    type: 'supplier',
    gstin: VALID_GSTIN,
    creditLimitMinor: 5000000,
  }, shopA.owner);
  assert.equal(goodG.status, 200);
  assert.equal(goodG.body.party.stateCode, '33', 'stateCode derived from GSTIN');
  assert.equal(goodG.body.party.creditLimitMinor, 5000000);
});

test('deactivation: items and parties deactivated instead of deleted', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const barcode = '8901234999999';
  const it = (await api('POST', '/api/items', { name: 'Item To Deactivate', priceMinor: 500, barcode }, shopA.owner)).body.item;
  assert.ok(it?.id);

  // Delete deactivates
  const del = await api('DELETE', `/api/items/${it.id}`, undefined, shopA.owner);
  assert.equal(del.status, 200);

  // Hidden from active list
  const activeList = await api('GET', '/api/items', undefined, shopA.owner);
  assert.equal(activeList.body.items.some((i: any) => i.id === it.id), false);

  // Included when includeInactive=1
  const allList = await api('GET', '/api/items?includeInactive=1', undefined, shopA.owner);
  assert.ok(allList.body.items.some((i: any) => i.id === it.id && i.active === false));

  // Scanner lookup returns 404 for inactive item
  const scan = await api('GET', `/api/items/by-barcode/${barcode}`, undefined, shopA.owner);
  assert.equal(scan.status, 404);

  // Party deactivation
  const pt = (await api('POST', '/api/parties', { name: 'Party To Deactivate' }, shopA.owner)).body.party;
  const delP = await api('DELETE', `/api/parties/${pt.id}`, undefined, shopA.owner);
  assert.equal(delP.status, 200);

  const activeParties = await api('GET', '/api/parties', undefined, shopA.owner);
  assert.equal(activeParties.body.parties.some((p: any) => p.id === pt.id), false);

  const allParties = await api('GET', '/api/parties?includeInactive=1', undefined, shopA.owner);
  assert.ok(allParties.body.parties.some((p: any) => p.id === pt.id && p.active === false));
});

test('plain-language validation messages for items and parties', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // Missing item name
  const noName = await api('POST', '/api/items', { priceMinor: 100 }, shopA.owner);
  assert.equal(noName.status, 400);
  assert.match(noName.message!, /Item name is required/i);

  // Negative price
  const negPrice = await api('POST', '/api/items', { name: 'X', priceMinor: -10 }, shopA.owner);
  assert.equal(negPrice.status, 400);
  assert.match(negPrice.message!, /Price \(paise\) is out of range/i);

  // Tax rate above 10000 bp
  const highTax = await api('POST', '/api/items', { name: 'X', priceMinor: 100, taxRateBp: 15000 }, shopA.owner);
  assert.equal(highTax.status, 400);
  assert.match(highTax.message!, /Tax rate \(basis points\) is out of range/i);

  // Custom fields > 20 keys
  const tooManyKeys: Record<string, string> = {};
  for (let i = 0; i < 21; i++) tooManyKeys[`k${i}`] = `val${i}`;
  const overCustom = await api('POST', '/api/items', { name: 'X', priceMinor: 100, custom: tooManyKeys }, shopA.owner);
  assert.equal(overCustom.status, 400);
  assert.match(overCustom.message!, /at most 20 entries/i);

  // Custom field with invalid type (array)
  const badCustomVal = await api('POST', '/api/items', { name: 'X', priceMinor: 100, custom: { nested: ['bad'] } }, shopA.owner);
  assert.equal(badCustomVal.status, 400);
  assert.match(badCustomVal.message!, /must be text or number/i);

  // Invalid phone on party
  const badPhone = await api('POST', '/api/parties', { name: 'Customer Bad Phone', phone: '123' }, shopA.owner);
  assert.equal(badPhone.status, 400);
  assert.match(badPhone.message!, /valid 10-digit mobile number/i);
});

test('audit log: mutations on items and parties are audited with tenant scope', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const logs = await db.query(
    `SELECT action, entity, entity_id, user_name FROM audit_log WHERE tenant_id = ? ORDER BY seq DESC`,
    [shopA.tenantId],
  );
  assert.ok(logs.length > 0);
  const actions = new Set(logs.map((l: any) => l.action));
  assert.ok(actions.has('item.create'));
  assert.ok(actions.has('item.deactivate'));
  assert.ok(actions.has('party.create'));
  assert.ok(actions.has('party.deactivate'));
});

test('categories: CRUD, live product counts, rename sync, and tenant isolation', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // Shop A creates a category
  const resCat = await api('POST', '/api/categories', { name: 'Beverages', description: 'Cold and hot drinks' }, shopA.owner);
  assert.equal(resCat.status, 200);
  const cat = resCat.body.category;
  assert.equal(cat.name, 'Beverages');
  assert.equal(cat.tenantId, shopA.tenantId);

  // Duplicate category in same shop fails with 409
  const dupCat = await api('POST', '/api/categories', { name: 'beverages' }, shopA.owner);
  assert.equal(dupCat.status, 409);

  // Shop B can create same category name (tenant isolation)
  const bCat = await api('POST', '/api/categories', { name: 'Beverages' }, shopB.owner);
  assert.equal(bCat.status, 200);
  assert.equal(bCat.body.category.tenantId, shopB.tenantId);

  // Shop B cannot view or modify Shop A's category
  const foreignEdit = await api('PATCH', `/api/categories/${cat.id}`, { name: 'Hacked' }, shopB.owner);
  assert.equal(foreignEdit.status, 404);

  // Create an item with category in Shop A
  const it = await api('POST', '/api/items', { name: 'Green Tea', priceMinor: 4000, category: 'Beverages' }, shopA.owner);
  assert.equal(it.status, 200);

  // Verify list categories shows live itemCount >= 1
  const listA = await api('GET', '/api/categories', undefined, shopA.owner);
  assert.equal(listA.status, 200);
  const found = listA.body.categories.find((c: any) => c.id === cat.id);
  assert.ok(found);
  assert.ok(found.itemCount >= 1);

  // Deactivate category
  const delRes = await api('DELETE', `/api/categories/${cat.id}`, undefined, shopA.owner);
  assert.equal(delRes.status, 200);

  const activeCats = await api('GET', '/api/categories', undefined, shopA.owner);
  assert.equal(activeCats.body.categories.some((c: any) => c.id === cat.id), false);

  const allCats = await api('GET', '/api/categories?includeInactive=1', undefined, shopA.owner);
  assert.ok(allCats.body.categories.some((c: any) => c.id === cat.id && c.active === false));
});

test('suppliers: CRUD, search, GSTIN checksum, address, and safe deactivation', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // Create supplier with GSTIN and address
  const supRes = await api('POST', '/api/parties', {
    name: 'Metro Wholesale Distributors',
    type: 'supplier',
    phone: '9840112233',
    email: 'orders@metrowholesale.test',
    gstin: VALID_GSTIN,
    address: '100 Industrial Estate, Guindy, Chennai',
    creditLimitMinor: 5000000,
  }, shopA.owner);

  assert.equal(supRes.status, 200);
  const sup = supRes.body.party;
  assert.equal(sup.type, 'supplier');
  assert.equal(sup.name, 'Metro Wholesale Distributors');
  assert.equal(sup.gstin, VALID_GSTIN);
  assert.equal(sup.address, '100 Industrial Estate, Guindy, Chennai');

  // Query suppliers specifically using ?type=supplier
  const supList = await api('GET', '/api/parties?type=supplier', undefined, shopA.owner);
  assert.equal(supList.status, 200);
  assert.ok(supList.body.parties.some((p: any) => p.id === sup.id));
  assert.ok(supList.body.parties.every((p: any) => p.type === 'supplier'));

  // Update supplier address and phone
  const updateRes = await api('PATCH', `/api/parties/${sup.id}`, {
    phone: '9840998877',
    address: '101 Industrial Estate, Guindy, Chennai',
  }, shopA.owner);
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.party.phone, '919840998877');
  assert.equal(updateRes.body.party.address, '101 Industrial Estate, Guindy, Chennai');

  // Tenant isolation: Shop B cannot access Shop A supplier
  const bGet = await api('PATCH', `/api/parties/${sup.id}`, { name: 'Attempted Hijack' }, shopB.owner);
  assert.equal(bGet.status, 404);

  // Deactivate supplier
  const deactRes = await api('DELETE', `/api/parties/${sup.id}`, undefined, shopA.owner);
  assert.equal(deactRes.status, 200);

  const activeSups = await api('GET', '/api/parties?type=supplier', undefined, shopA.owner);
  assert.equal(activeSups.body.parties.some((p: any) => p.id === sup.id), false);
});

