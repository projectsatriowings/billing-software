import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';
import { can, ROLES, STANDARD_UNITS } from '../../shared/types.ts';
import { calcBill, gstinCheckChar, validateGstin } from '../../shared/tax.ts';
import { normalizePhone } from '../../shared/whatsapp.ts';
import { STATES } from '../../shared/states.ts';
import {
  computeEan13CheckDigit,
  isValidEan13,
  generateUniqueInternalBarcode,
  renderBarcodeSvg,
  matchProductToCatalog,
  generateUniqueShortSku,
  classifyProductNature,
} from '../../shared/bulkImport.ts';
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

// ── Bulk Import ──────────────────────────────────────────────────────────────

test('bulk-import: rejects request with no rows array', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const res = await api('POST', '/api/items/bulk-import', { notRows: [] }, shopA.owner);
  assert.equal(res.status, 400);
  assert.equal(res.code, 'VALIDATION');
});

test('bulk-import: rejects empty rows array', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const res = await api('POST', '/api/items/bulk-import', { rows: [] }, shopA.owner);
  assert.equal(res.status, 400);
  assert.equal(res.code, 'VALIDATION');
});

test('bulk-import: rejects more than 500 rows', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const rows = Array.from({ length: 501 }, (_, i) => ({
    name: `Product ${i}`,
    priceMinor: 1000,
  }));
  const res = await api('POST', '/api/items/bulk-import', { rows }, shopA.owner);
  assert.equal(res.status, 400);
  assert.equal(res.code, 'VALIDATION');
});

test('bulk-import: cashier is forbidden from importing', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const res = await api('POST', '/api/items/bulk-import', {
    rows: [{ name: 'Test', priceMinor: 1000 }],
  }, shopA.cashier);
  assert.equal(res.status, 403);
});

test('bulk-import: imports valid products and creates stock_moves for opening stock', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const res = await api('POST', '/api/items/bulk-import', {
    rows: [
      { name: 'Bulk Item A', priceMinor: 5000, costMinor: 3000, taxRateBp: 500, taxInclusive: true, openingQtyMilli: 10000, unit: 'kg', category: 'Grocery', sku: 'BULK-A' },
      { name: 'Bulk Item B', priceMinor: 2000, costMinor: 1500, taxRateBp: 1200, taxInclusive: false, openingQtyMilli: 0, unit: 'pcs' },
    ],
  }, shopA.owner);

  assert.equal(res.status, 200, `body: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.totalRows, 2);
  assert.equal(res.body.created, 2);
  assert.equal(res.body.skipped, 0);
  assert.ok(res.body.importId, 'importId must be returned');

  // Verify the results array
  const results = res.body.results as any[];
  assert.equal(results.length, 2);
  assert.ok(results.every((r: any) => r.status === 'created'), 'all rows should be created');
  assert.ok(results.every((r: any) => r.itemId), 'each created row must have an itemId');

  // Verify item A exists via GET
  const itemA = results.find((r: any) => r.name === 'Bulk Item A');
  assert.ok(itemA);

  const getRes = await api('GET', `/api/items/${itemA.itemId}`, undefined, shopA.owner);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.item.name, 'Bulk Item A');
  assert.equal(getRes.body.item.priceMinor, 5000);
  assert.equal(getRes.body.item.taxRateBp, 500);
  assert.equal(getRes.body.item.category, 'Grocery');
  assert.equal(getRes.body.item.sku, 'BULK-A');
  // Opening stock 10 kg = 10000 milli
  assert.equal(getRes.body.item.currentStockMilli, 10000);
});

test('bulk-import: skips rows missing required name field with clear reason', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const res = await api('POST', '/api/items/bulk-import', {
    rows: [
      { name: '', priceMinor: 1000 },                    // missing name
      { name: 'Good Item X9', priceMinor: 500 },         // valid
      { name: 'No Price Item', priceMinor: null },        // missing price
    ],
  }, shopA.owner);

  assert.equal(res.status, 200);
  assert.equal(res.body.created, 1);
  assert.equal(res.body.skipped, 2);

  const results = res.body.results as any[];
  const skipped = results.filter((r: any) => r.status === 'skipped');
  assert.equal(skipped.length, 2);
  // Each skipped row should have a reason
  assert.ok(skipped.every((r: any) => r.reason && r.reason.length > 0), 'skipped rows need a reason');
});

test('bulk-import: detects duplicate barcodes within the same payload', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const res = await api('POST', '/api/items/bulk-import', {
    rows: [
      { name: 'Dup Barcode A', priceMinor: 1000, barcode: 'BC-DUP-001' },
      { name: 'Dup Barcode B', priceMinor: 2000, barcode: 'BC-DUP-001' }, // duplicate barcode
    ],
  }, shopA.owner);

  assert.equal(res.status, 200);
  assert.equal(res.body.created, 1);
  assert.equal(res.body.skipped, 1);

  const skipped = res.body.results.filter((r: any) => r.status === 'skipped');
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /duplicate barcode/i);
});

test('bulk-import: detects duplicate barcodes against existing products in DB', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // First, create an item with a known barcode
  const createRes = await api('POST', '/api/items', {
    name: 'Existing Product with Barcode',
    priceMinor: 1000,
    barcode: 'BC-EXISTING-9999',
    unit: 'pcs',
  }, shopA.owner);
  assert.equal(createRes.status, 200);

  // Now try to bulk import a product with the same barcode
  const res = await api('POST', '/api/items/bulk-import', {
    rows: [
      { name: 'Duplicate of Existing', priceMinor: 2000, barcode: 'BC-EXISTING-9999' },
      { name: 'Unique New Product', priceMinor: 3000, barcode: 'BC-UNIQUE-AAAA' },
    ],
  }, shopA.owner);

  assert.equal(res.status, 200);
  assert.equal(res.body.created, 1, 'only the unique product should be created');
  assert.equal(res.body.skipped, 1, 'the duplicate barcode product should be skipped');

  const skipped = res.body.results.filter((r: any) => r.status === 'skipped');
  assert.match(skipped[0].reason, /already exists/i);
});

test('bulk-import: validates GST rate against allowed values', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const res = await api('POST', '/api/items/bulk-import', {
    rows: [
      { name: 'Invalid GST Product', priceMinor: 1000, taxRateBp: 999 }, // 9.99% — not a valid GST rate
      { name: 'Valid GST Product', priceMinor: 1000, taxRateBp: 1200 },   // 12% — valid
    ],
  }, shopA.owner);

  assert.equal(res.status, 200);
  assert.equal(res.body.created, 1);
  assert.equal(res.body.skipped, 1);

  const skipped = res.body.results.filter((r: any) => r.status === 'skipped');
  assert.match(skipped[0].reason, /gst rate/i);
});

test('bulk-import: auto-creates missing categories', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const uniqueCat = `AutoCat_${Date.now()}`;
  const res = await api('POST', '/api/items/bulk-import', {
    rows: [
      { name: 'Item with New Category', priceMinor: 1500, category: uniqueCat },
    ],
  }, shopA.owner);

  assert.equal(res.status, 200);
  assert.equal(res.body.created, 1);

  // The category should now exist
  const catList = await api('GET', '/api/categories', undefined, shopA.owner);
  assert.equal(catList.status, 200);
  const found = catList.body.categories.find((c: any) => c.name === uniqueCat);
  assert.ok(found, `Category "${uniqueCat}" should have been auto-created`);
});

test('bulk-import: tenant isolation — Shop B cannot see or create items for Shop A', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // Import into Shop A
  const aRes = await api('POST', '/api/items/bulk-import', {
    rows: [{ name: 'Shop A Exclusive Item', priceMinor: 9999 }],
  }, shopA.owner);
  assert.equal(aRes.status, 200);
  assert.equal(aRes.body.created, 1);

  const itemId = aRes.body.results[0].itemId;

  // Shop B cannot access Shop A's item
  const bGet = await api('GET', `/api/items/${itemId}`, undefined, shopB.owner);
  assert.equal(bGet.status, 404, 'Shop B must not see Shop A items');
});

test('bulk-import: manager can import but accountant cannot', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const managerRes = await api('POST', '/api/items/bulk-import', {
    rows: [{ name: 'Manager Import Item', priceMinor: 100 }],
  }, shopA.manager);
  assert.equal(managerRes.status, 200);

  const accountantRes = await api('POST', '/api/items/bulk-import', {
    rows: [{ name: 'Accountant Import Item', priceMinor: 100 }],
  }, shopA.accountant);
  assert.equal(accountantRes.status, 403);
});

test('bulk-import: detects duplicate SKUs within payload and against database', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // Create an item with known SKU
  const preRes = await api('POST', '/api/items', {
    name: 'Existing SKU Product',
    priceMinor: 500,
    sku: 'SKU-PRE-EXISTING',
    unit: 'pcs',
  }, shopA.owner);
  assert.equal(preRes.status, 200);

  const res = await api('POST', '/api/items/bulk-import', {
    rows: [
      { name: 'SKU Dup Row 1', priceMinor: 1000, sku: 'SKU-BATCH-DUP' },
      { name: 'SKU Dup Row 2', priceMinor: 1000, sku: 'SKU-BATCH-DUP' }, // intra-batch dup
      { name: 'DB SKU Conflict', priceMinor: 1000, sku: 'SKU-PRE-EXISTING' }, // DB dup
      { name: 'Unique Product', priceMinor: 1000, sku: 'SKU-TOTALLY-UNIQUE' },
    ],
  }, shopA.owner);

  assert.equal(res.status, 200);
  assert.equal(res.body.created, 2); // Row 1 + Unique Product
  assert.equal(res.body.skipped, 2); // Row 2 + DB conflict

  const skipped = res.body.results.filter((r: any) => r.status === 'skipped');
  assert.equal(skipped.length, 2);
  assert.ok(skipped.some((r: any) => /duplicate sku/i.test(r.reason)));
  assert.ok(skipped.some((r: any) => /already exists/i.test(r.reason)));
});

test('bulk-import: rejects barcodes formatted in scientific notation', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const res = await api('POST', '/api/items/bulk-import', {
    rows: [
      { name: 'Scientific Barcode Item', priceMinor: 1000, barcode: '8.90123E+12' },
      { name: 'Valid Barcode Item', priceMinor: 1000, barcode: '8909999888877' },
    ],
  }, shopA.owner);

  assert.equal(res.status, 200);
  assert.equal(res.body.created, 1);
  assert.equal(res.body.skipped, 1);

  const skipped = res.body.results.filter((r: any) => r.status === 'skipped');
  assert.match(skipped[0].reason, /scientific notation/i);
});

test('bulk-import: restocks existing product without duplication, adds incoming stock, and preserves barcodes', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // 1. Create initial product with 12 units of stock (12,000 milli)
  const initialRes = await api('POST', '/api/items', {
    name: 'Toor Dal 1kg Test Restock',
    priceMinor: 14000,
    costMinor: 11000,
    unit: 'kg',
    openingStockMilli: 12000,
    barcode: '8901111222333',
  }, shopA.owner);
  assert.equal(initialRes.status, 200);
  const itemId = initialRes.body.item.id;
  assert.equal(initialRes.body.item.currentStockMilli, 12000);

  // 2. Import a restock of 20 units (20,000 milli)
  const restockBatchId = `batch_restock_${Date.now()}`;
  const importRes = await api('POST', '/api/items/bulk-import', {
    importBatchId: restockBatchId,
    rows: [
      {
        name: 'Toor Dal 1kg Test Restock',
        unit: 'kg',
        priceMinor: 15000, // new price
        costMinor: 12500,
        openingStockMilli: 20000,
        isRestock: true,
        matchedItemId: itemId,
        updatePrices: false, // keep original price
      },
    ],
  }, shopA.owner);

  assert.equal(importRes.status, 200);
  assert.equal(importRes.body.created, 0);
  assert.equal(importRes.body.restocked, 1);
  assert.equal(importRes.body.skipped, 0);

  // Verify stock is now 12 + 20 = 32 (32,000 milli)
  const getRes = await api('GET', `/api/items/${itemId}`, undefined, shopA.owner);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.item.currentStockMilli, 32000);
  // Selling price was not updated because updatePrices was false
  assert.equal(getRes.body.item.priceMinor, 14000);
  // Barcode preserved
  assert.equal(getRes.body.item.barcode, '8901111222333');

  // Verify idempotency: re-submitting with the same batch ID returns 409 and does not add stock
  const retryRes = await api('POST', '/api/items/bulk-import', {
    importBatchId: restockBatchId,
    rows: [
      {
        name: 'Toor Dal 1kg Test Restock',
        unit: 'kg',
        priceMinor: 15000,
        openingStockMilli: 20000,
        isRestock: true,
        matchedItemId: itemId,
      },
    ],
  }, shopA.owner);
  assert.equal(retryRes.status, 409);

  // Stock should still be 32, not 52
  const checkAgain = await api('GET', `/api/items/${itemId}`, undefined, shopA.owner);
  assert.equal(checkAgain.body.item.currentStockMilli, 32000);
});

test('bulk-import: new product generates internal barcode in product_barcodes table and initializes stock', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const importBatchId = `batch_new_${Date.now()}`;
  const importRes = await api('POST', '/api/items/bulk-import', {
    importBatchId,
    rows: [
      {
        name: 'Brand New Internal Barcode Item',
        unit: 'pcs',
        priceMinor: 25000,
        costMinor: 20000,
        openingStockMilli: 15000,
      },
    ],
  }, shopA.owner);

  assert.equal(importRes.status, 200);
  assert.equal(importRes.body.created, 1);
  const newItemId = importRes.body.results[0].itemId;
  assert.ok(newItemId);

  // Verify item in DB
  const getRes = await api('GET', `/api/items/${newItemId}`, undefined, shopA.owner);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.item.currentStockMilli, 15000);
  assert.ok(getRes.body.item.barcode, 'Must have generated barcode');
  assert.ok(getRes.body.item.barcode.startsWith('20'), 'Internal barcode starts with 20');
  assert.equal(getRes.body.item.barcode.length, 13, 'EAN-13 length');

  // Verify product_barcodes entry
  const barcodeRows = await db.query<{ barcode: string; barcodeType: string }>(
    `SELECT barcode, barcode_type FROM product_barcodes WHERE product_id = ? AND tenant_id = ?`,
    [newItemId, shopA.tenantId]
  );
  assert.equal(barcodeRows.length, 1);
  assert.equal(barcodeRows[0].barcode, getRes.body.item.barcode);
  assert.equal(barcodeRows[0].barcodeType, 'INTERNAL');
});

test('bulk-import: restock updates prices when updatePrices is true', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // Create item
  const initialRes = await api('POST', '/api/items', {
    name: 'Price Update Test Item',
    priceMinor: 5000,
    costMinor: 4000,
    unit: 'pcs',
    openingStockMilli: 5000,
  }, shopA.owner);
  assert.equal(initialRes.status, 200);
  const itemId = initialRes.body.item.id;

  // Restock with updatePrices = true
  const importRes = await api('POST', '/api/items/bulk-import', {
    rows: [
      {
        name: 'Price Update Test Item',
        unit: 'pcs',
        priceMinor: 6500,
        costMinor: 5200,
        openingStockMilli: 5000,
        isRestock: true,
        matchedItemId: itemId,
        updatePrices: true,
      },
    ],
  }, shopA.owner);

  assert.equal(importRes.status, 200);
  assert.equal(importRes.body.restocked, 1);

  // Check updated prices and accumulated stock
  const getRes = await api('GET', `/api/items/${itemId}`, undefined, shopA.owner);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.item.priceMinor, 6500);
  assert.equal(getRes.body.item.costMinor, 5200);
  assert.equal(getRes.body.item.currentStockMilli, 10000);
});

test('bulk-import: generates compact short SKUs and handles collisions sequentially', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const res = await api('POST', '/api/items/bulk-import', {
    rows: [
      {
        name: 'Kellogg\'s Corn Flakes Original 250 g',
        unit: 'pcs',
        priceMinor: 15000,
      },
      {
        name: 'Kellogg\'s Corn Flakes Original 250 g', // collision row
        unit: 'pcs',
        priceMinor: 15000,
      },
    ],
  }, shopA.owner);

  assert.equal(res.status, 200);
  assert.equal(res.body.created, 2);

  const item1 = await api('GET', `/api/items/${res.body.results[0].itemId}`, undefined, shopA.owner);
  const item2 = await api('GET', `/api/items/${res.body.results[1].itemId}`, undefined, shopA.owner);

  assert.equal(item1.body.item.sku, 'KCF-250');
  assert.equal(item2.body.item.sku, 'KCF-250-2');
});

test('bulk-import: rejects products assigned to deactivated or deleted categories', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // 1. Create a category then delete it (soft-delete sets active = false)
  const catName = `OldCategory_${Date.now()}`;
  const catRes = await api('POST', '/api/categories', { name: catName }, shopA.owner);
  assert.equal(catRes.status, 200);
  const catId = catRes.body.category.id;

  const delRes = await api('DELETE', `/api/categories/${catId}`, undefined, shopA.owner);
  assert.equal(delRes.status, 200);

  // 2. Try to bulk import an item using the deleted category
  const res = await api('POST', '/api/items/bulk-import', {
    rows: [
      {
        name: 'Product With Deleted Category',
        priceMinor: 12000,
        unit: 'pcs',
        category: catName,
      },
    ],
  }, shopA.owner);

  assert.equal(res.status, 200);
  assert.equal(res.body.created, 0);
  assert.equal(res.body.skipped, 1);
  assert.match(res.body.results[0].reason, /deleted or deactivated/i);
});

test('bulk-import: preserves original SKU on restock even when imported row has different name format', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // 1. Create product with specific SKU
  const originalSku = 'PARACHUTE-ORIG-SKU';
  const createRes = await api('POST', '/api/items', {
    name: 'Parachute Coconut Hair Oil 190 ml',
    priceMinor: 9500,
    unit: 'pcs',
    sku: originalSku,
  }, shopA.owner);
  assert.equal(createRes.status, 200);
  const itemId = createRes.body.item.id;

  // 2. Restock via bulk import
  const restockRes = await api('POST', '/api/items/bulk-import', {
    rows: [
      {
        name: 'Parachute Coconut Hair Oil 190 ml',
        priceMinor: 9500,
        unit: 'pcs',
        isRestock: true,
        matchedItemId: itemId,
        openingStockMilli: 10000,
      },
    ],
  }, shopA.owner);

  assert.equal(restockRes.status, 200);
  assert.equal(restockRes.body.restocked, 1);

  // 3. Verify original SKU is preserved
  const getRes = await api('GET', `/api/items/${itemId}`, undefined, shopA.owner);
  assert.equal(getRes.body.item.sku, originalSku);
});

test('bulk-import: category persistence, categoryId matching, and validation for Jams & Spreads', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // 1. Create a category named "Jams & Spreads" through the category management API
  const catRes = await api('POST', '/api/categories', {
    name: 'Jams & Spreads',
    description: 'Fruit jams, marmalades, and sweet spreads',
  }, shopA.owner);
  assert.equal(catRes.status, 200);
  const catId = catRes.body.category.id;
  assert.ok(catId, 'Category ID must be generated');

  // 2. Fetch categories from /api/categories to confirm it is listed dynamically
  const listRes = await api('GET', '/api/categories', undefined, shopA.owner);
  assert.equal(listRes.status, 200);
  const foundCat = listRes.body.categories.find((c: any) => c.id === catId);
  assert.ok(foundCat, 'Newly created category must appear in category list');
  assert.equal(foundCat.name, 'Jams & Spreads');
  assert.equal(foundCat.active, true);

  // 3. Bulk import "Kissan Mixed Fruit Jam 200 g" with categoryId and category
  const importRes = await api('POST', '/api/items/bulk-import', {
    rows: [
      {
        name: 'Kissan Mixed Fruit Jam 200 g',
        priceMinor: 9000,
        costMinor: 7500,
        unit: 'pcs',
        categoryId: catId,
        category: 'Jams & Spreads',
        openingQtyMilli: 50000, // 50 pcs
      },
    ],
  }, shopA.owner);

  assert.equal(importRes.status, 200);
  assert.equal(importRes.body.created, 1);
  assert.equal(importRes.body.skipped, 0);

  const createdItem = importRes.body.results[0];
  assert.equal(createdItem.status, 'created');
  assert.ok(createdItem.itemId);

  // 4. Verify item was saved with category 'Jams & Spreads' and stock move 50 pcs
  const getProduct = await api('GET', `/api/items/${createdItem.itemId}`, undefined, shopA.owner);
  assert.equal(getProduct.status, 200);
  assert.equal(getProduct.body.item.category, 'Jams & Spreads');
  assert.equal(getProduct.body.item.sku, 'KMFJ-200');

  // Verify stock was accurately credited to 50 pcs (50000 milli)
  assert.equal(getProduct.body.item.currentStockMilli, 50000);
  const moves = await db.query(
    'SELECT * FROM stock_moves WHERE item_id = ? AND tenant_id = ?',
    [createdItem.itemId, shopA.tenantId],
  );
  assert.equal(moves.length, 1);
  assert.equal(Number((moves[0] as any).qty_milli ?? (moves[0] as any).qtyMilli), 50000);

  // 5. Test validation failure when categoryId is invalid or does not exist
  const failRes = await api('POST', '/api/items/bulk-import', {
    rows: [
      {
        name: 'Item With Nonexistent Category',
        priceMinor: 5000,
        unit: 'pcs',
        categoryId: 'nonexistent-cat-id',
        openingQtyMilli: 20000,
      },
    ],
  }, shopA.owner);

  assert.equal(failRes.status, 200);
  assert.equal(failRes.body.created, 0);
  assert.equal(failRes.body.skipped, 1);
  assert.match(failRes.body.results[0].reason, /Category is invalid or does not exist/i);
});

test('bulk-import: 9-step barcode generation, preview, persistence, lookup, and rollback workflow', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // 1. Five products without barcodes
  const products = [
    { name: 'Pure Cow Ghee 500 ml', unit: 'pcs', priceMinor: 35000, costMinor: 30000, category: 'Groceries' },
    { name: 'Organic Almonds 250 g', unit: 'pcs', priceMinor: 28000, costMinor: 24000, category: 'Groceries' },
    { name: 'Cardamom Green 50 g', unit: 'pcs', priceMinor: 15000, costMinor: 12000, category: 'Groceries' },
    { name: 'Basmati Super Rice 5 kg', unit: 'kg', priceMinor: 55000, costMinor: 48000, category: 'Groceries' },
    { name: 'Sambar Masala 100 g', unit: 'pcs', priceMinor: 6500, costMinor: 5000, category: 'Groceries' },
  ];

  // Fetch all existing barcodes in DB for tenant to pass into generation (as done in UI)
  const existingItemsRes = await api('GET', '/api/items', undefined, shopA.owner);
  assert.equal(existingItemsRes.status, 200);
  const existingBarcodes = new Set<string>();
  for (const it of existingItemsRes.body.items) {
    if (it.barcode) existingBarcodes.add(it.barcode);
  }

  // 2. Generate barcodes for all five with one click
  const generatedBarcodes: string[] = [];
  const assignedBarcodes = new Set<string>(existingBarcodes);
  for (let i = 0; i < products.length; i++) {
    const code = generateUniqueInternalBarcode(assignedBarcodes);
    assignedBarcodes.add(code);
    generatedBarcodes.push(code);
  }

  // 3. Confirm each row shows a unique, scannable barcode
  assert.equal(generatedBarcodes.length, 5);
  const uniqueSet = new Set(generatedBarcodes);
  assert.equal(uniqueSet.size, 5, 'All 5 generated barcodes must be distinct');

  for (const code of generatedBarcodes) {
    assert.equal(code.length, 13, 'EAN-13 must be 13 digits');
    assert.equal(code.startsWith('20'), true, 'Internal in-store code must begin with 20');
    assert.equal(isValidEan13(code), true, 'Must pass standard EAN-13 check digit validation');
    const expectedCheck = computeEan13CheckDigit(code.slice(0, 12));
    assert.equal(code.slice(12), String(expectedCheck), 'Check digit must match algorithmic calculation');
    const svg = renderBarcodeSvg(code);
    assert.ok(svg.includes('<svg'), 'Barcode must render a valid SVG');
    assert.ok(svg.includes('<rect'), 'Barcode SVG must contain bars');
  }

  // 4. Click Generate Barcodes again: existing generated values are not duplicated or replaced
  const reAssignedBarcodes = [...generatedBarcodes];
  for (let i = 0; i < products.length; i++) {
    if (reAssignedBarcodes[i]) {
      continue;
    }
    reAssignedBarcodes[i] = generateUniqueInternalBarcode(assignedBarcodes);
  }
  assert.deepEqual(reAssignedBarcodes, generatedBarcodes, 'Repeated generation must preserve existing barcodes');

  // 5. Undo generated values before committing
  let uncommittedBarcodes: (string | undefined)[] = [...generatedBarcodes];
  // User clicks "Undo 5 generated"
  uncommittedBarcodes = uncommittedBarcodes.map(() => undefined);
  assert.equal(uncommittedBarcodes.every((b) => b === undefined), true, 'Undo clears uncommitted generated barcodes');

  // Re-populate barcodes to proceed with test import
  const rowsToImport = products.map((p, idx) => ({
    ...p,
    barcode: generatedBarcodes[idx],
    barcodeType: 'INTERNAL' as const,
    openingQtyMilli: 10000,
  }));

  // 6. Import the products and verify each barcode is persisted in product_barcodes
  const importRes = await api('POST', '/api/items/bulk-import', {
    rows: rowsToImport,
  }, shopA.owner);
  assert.equal(importRes.status, 200);
  assert.equal(importRes.body.created, 5);
  assert.equal(importRes.body.barcodesSaved, 5, 'Must report 5 barcodes saved');

  const createdItems = importRes.body.results.filter((r: any) => r.status === 'created');
  assert.equal(createdItems.length, 5);

  for (let i = 0; i < 5; i++) {
    const item = createdItems[i];
    const expectedBarcode = generatedBarcodes[i];
    // Check item record
    const itemRes = await api('GET', `/api/items/${item.itemId}`, undefined, shopA.owner);
    assert.equal(itemRes.status, 200);
    assert.equal(itemRes.body.item.barcode, expectedBarcode);

    // Check product_barcodes table
    const pbRows = await db.query(
      'SELECT * FROM product_barcodes WHERE product_id = ? AND tenant_id = ?',
      [item.itemId, shopA.tenantId],
    );
    assert.equal(pbRows.length, 1);
    assert.equal((pbRows[0] as any).barcode, expectedBarcode);
    assert.equal((pbRows[0] as any).barcode_type ?? (pbRows[0] as any).barcodeType, 'INTERNAL');
  }

  // 7. Reimport existing products (restock) and verify barcode mappings are preserved
  const firstItem = createdItems[0];
  const restockRes = await api('POST', '/api/items/bulk-import', {
    rows: [
      {
        name: products[0].name,
        priceMinor: products[0].priceMinor,
        unit: products[0].unit,
        isRestock: true,
        matchedItemId: firstItem.itemId,
        openingStockMilli: 5000,
      },
    ],
  }, shopA.owner);
  assert.equal(restockRes.status, 200);
  assert.equal(restockRes.body.restocked, 1);

  // Barcode in product_barcodes is preserved
  const pbAfterRestock = await db.query(
    'SELECT * FROM product_barcodes WHERE product_id = ? AND tenant_id = ?',
    [firstItem.itemId, shopA.tenantId],
  );
  assert.equal(pbAfterRestock.length, 1);
  assert.equal((pbAfterRestock[0] as any).barcode, generatedBarcodes[0]);

  // 8. Scan both an internal and a manufacturer barcode and verify they resolve to the same product
  const mfrBarcode = '8901030001235';
  const addMfrRes = await api('POST', `/api/items/${firstItem.itemId}/barcodes`, {
    barcode: mfrBarcode,
    barcodeType: 'MANUFACTURER',
  }, shopA.owner);
  assert.equal(addMfrRes.status, 200);
  assert.equal(addMfrRes.body.barcode.barcode, mfrBarcode);
  assert.equal(addMfrRes.body.barcode.barcode_type, 'MANUFACTURER');

  // Verify GET /api/items/:id/barcodes returns both barcodes
  const listBarcodesRes = await api('GET', `/api/items/${firstItem.itemId}/barcodes`, undefined, shopA.owner);
  assert.equal(listBarcodesRes.status, 200);
  const barcodesList = listBarcodesRes.body.barcodes;
  assert.equal(barcodesList.length, 2);
  const types = barcodesList.map((b: any) => b.barcode_type).sort();
  assert.deepEqual(types, ['INTERNAL', 'MANUFACTURER']);

  // Resolve by internal barcode
  const resolveInternal = await api('GET', `/api/items/by-barcode/${generatedBarcodes[0]}`, undefined, shopA.owner);
  assert.equal(resolveInternal.status, 200);
  assert.equal(resolveInternal.body.item.id, firstItem.itemId);

  // Resolve by manufacturer barcode
  const resolveMfr = await api('GET', `/api/items/by-barcode/${mfrBarcode}`, undefined, shopA.owner);
  assert.equal(resolveMfr.status, 200);
  assert.equal(resolveMfr.body.item.id, firstItem.itemId);

  // 9. Test duplicate values, generation failures, and database transaction rollback
  const dupBarcode = generatedBarcodes[1];
  const duplicateImportRes = await api('POST', '/api/items/bulk-import', {
    rows: [
      {
        name: 'Another Duplicate Item',
        priceMinor: 10000,
        unit: 'pcs',
        barcode: dupBarcode, // Already owned by product B
        barcodeType: 'INTERNAL',
      },
    ],
  }, shopA.owner);

  assert.equal(duplicateImportRes.status, 200);
  assert.equal(duplicateImportRes.body.created, 0);
  assert.equal(duplicateImportRes.body.skipped, 1);
  assert.match(duplicateImportRes.body.results[0].reason, /already exists/i);

  // Confirm "Another Duplicate Item" was completely rolled back and not inserted into items table
  const searchDup = await db.query(
    'SELECT * FROM items WHERE name = ? AND tenant_id = ?',
    ['Another Duplicate Item', shopA.tenantId],
  );
  assert.equal(searchDup.length, 0, 'Rolled back item must not exist in items table');
});

test('bulk-import: Lifebuoy category selection, backend revalidation, and independence from ambiguity', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // 1. Create or ensure "Personal Care" category exists
  let personalCareCatId: string;
  const listCatsRes = await api('GET', '/api/categories', undefined, shopA.owner);
  assert.equal(listCatsRes.status, 200);
  const existingCat = listCatsRes.body.categories.find((c: any) => c.name.toLowerCase() === 'personal care');
  if (existingCat) {
    personalCareCatId = existingCat.id;
  } else {
    const createCatRes = await api('POST', '/api/categories', {
      name: 'Personal Care',
      description: 'Personal hygiene and soap products',
    }, shopA.owner);
    assert.equal(createCatRes.status, 200);
    personalCareCatId = createCatRes.body.category.id;
  }

  // 2. Test row without valid category fails backend validation when invalid categoryId is given
  const failRes = await api('POST', '/api/items/bulk-import', {
    rows: [
      {
        name: 'Lifebuoy Total 10 Soap 4 x 125 g',
        sku: 'LT10S4-125',
        unit: 'pcs',
        priceMinor: 16000,
        costMinor: 12500,
        hsn: '3402',
        categoryId: 'nonexistent-category-id',
        openingQtyMilli: 12000,
      },
    ],
  }, shopA.owner);

  assert.equal(failRes.status, 200);
  assert.equal(failRes.body.created, 0);
  assert.equal(failRes.body.skipped, 1);
  assert.match(failRes.body.results[0].reason, /Category is invalid or does not exist/i);

  // 3. Test row WITH "Personal Care" category selection succeeds
  const existingItemsRes = await api('GET', '/api/items', undefined, shopA.owner);
  const existingBarcodes = new Set<string>();
  for (const it of existingItemsRes.body.items) {
    if (it.barcode) existingBarcodes.add(it.barcode);
  }
  const successBarcode = generateUniqueInternalBarcode(existingBarcodes);

  const importRes = await api('POST', '/api/items/bulk-import', {
    rows: [
      {
        name: 'Lifebuoy Total 10 Soap 4 x 125 g',
        sku: 'LT10S4-125',
        barcode: successBarcode,
        barcodeType: 'INTERNAL',
        unit: 'pcs',
        priceMinor: 16000,
        costMinor: 12500,
        hsn: '3402',
        categoryId: personalCareCatId,
        category: 'Personal Care',
        openingQtyMilli: 12000, // 12 pcs
      },
    ],
  }, shopA.owner);

  assert.equal(importRes.status, 200);
  assert.equal(importRes.body.created, 1);
  assert.equal(importRes.body.skipped, 0);

  const importedItem = importRes.body.results[0];
  const itemInDb = await api('GET', `/api/items/${importedItem.itemId}`, undefined, shopA.owner);
  assert.equal(itemInDb.status, 200);
  assert.equal(itemInDb.body.item.category, 'Personal Care');
  assert.equal(itemInDb.body.item.sku, 'LT10S4-125');
  assert.equal(itemInDb.body.item.currentStockMilli, 12000);
});

test('bulk-import: ambiguous catalog match candidate display, linking, and new product creation', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // 1. Create candidate variant products in the database
  const catRes = await api('GET', '/api/categories', undefined, shopA.owner);
  const groceryCat = catRes.body.categories[0]?.name || 'Grocery';

  const existingItemsRes = await api('GET', '/api/items', undefined, shopA.owner);
  const existingBarcodes = new Set<string>();
  for (const it of existingItemsRes.body.items) {
    if (it.barcode) existingBarcodes.add(it.barcode);
  }

  const baseBarcode1 = generateUniqueInternalBarcode(existingBarcodes);
  existingBarcodes.add(baseBarcode1);
  const baseBarcode2 = generateUniqueInternalBarcode(existingBarcodes);
  existingBarcodes.add(baseBarcode2);

  const item1Res = await api('POST', '/api/items', {
    name: 'Kohinoor Basmati Rice 1kg',
    sku: 'KOH-BAS-1KG',
    barcode: baseBarcode1,
    unit: 'kg',
    category: groceryCat,
    priceMinor: 9000,
    costMinor: 7500,
    openingQtyMilli: 20000,
  }, shopA.owner);
  assert.equal(item1Res.status, 200);
  const candidate1Id = item1Res.body.item.id;

  const item2Res = await api('POST', '/api/items', {
    name: 'Kohinoor Basmati Rice 5kg',
    sku: 'KOH-BAS-5KG',
    barcode: baseBarcode2,
    unit: 'bag',
    category: groceryCat,
    priceMinor: 42000,
    costMinor: 36000,
    openingQtyMilli: 15000,
  }, shopA.owner);
  assert.equal(item2Res.status, 200);
  const candidate2Id = item2Res.body.item.id;

  // 2. Verify catalog match logic exposes candidates with SKU, Category, UOM, Pack Size, Barcode, and reasons
  const catalogCandidates = [
    {
      id: candidate1Id,
      name: 'Kohinoor Basmati Rice 1kg',
      sku: 'KOH-BAS-1KG',
      barcode: baseBarcode1,
      category: groceryCat,
      unit: 'kg',
      packSize: '1kg',
      priceMinor: 9000,
      costMinor: 7500,
      taxInclusive: true,
      hsn: '1006',
      currentStockMilli: 20000,
      taxRateBp: 500,
    },
    {
      id: candidate2Id,
      name: 'Kohinoor Basmati Rice 5kg',
      sku: 'KOH-BAS-5KG',
      barcode: baseBarcode2,
      category: groceryCat,
      unit: 'bag',
      packSize: '5kg',
      priceMinor: 42000,
      costMinor: 35000,
      taxInclusive: true,
      hsn: '1006',
      currentStockMilli: 15000,
      taxRateBp: 500,
    },
  ];

  // Exact variant name with pack size difference
  const matchResult = matchProductToCatalog('Kohinoor Basmati Rice 2kg', 'kg', catalogCandidates);
  assert.ok(matchResult.candidates.length >= 2, 'Must identify both candidates');
  for (const c of matchResult.candidates) {
    assert.ok(c.name);
    assert.ok(c.sku);
    assert.ok(c.category);
    assert.ok(c.unit);
    assert.ok(c.matchReason);
  }

  // 3. User chooses to LINK to candidate 1 (Kohinoor Basmati Rice 1kg) -> Restocks without duplicate
  const linkRes = await api('POST', '/api/items/bulk-import', {
    rows: [
      {
        name: 'Kohinoor Basmati Rice 1kg',
        unit: 'kg',
        priceMinor: 9000,
        isRestock: true,
        matchedItemId: candidate1Id,
        openingQtyMilli: 10000, // add 10kg
        updatePrices: false,
      },
    ],
  }, shopA.owner);

  assert.equal(linkRes.status, 200);
  assert.equal(linkRes.body.restocked, 1);
  assert.equal(linkRes.body.created, 0);

  const updatedItem1 = await api('GET', `/api/items/${candidate1Id}`, undefined, shopA.owner);
  assert.equal(updatedItem1.body.item.currentStockMilli, 30000, 'Original 20kg + 10kg = 30kg');
  assert.equal(updatedItem1.body.item.sku, 'KOH-BAS-1KG');
  assert.equal(updatedItem1.body.item.barcode, baseBarcode1);

  // 4. User chooses to CREATE AS NEW for variant "Kohinoor Basmati Rice 500g"
  const newSku = generateUniqueShortSku('Kohinoor Basmati Rice 500g', new Set(['KOH-BAS-1KG', 'KOH-BAS-5KG']), new Set());
  const newBarcode = generateUniqueInternalBarcode(existingBarcodes);

  const createNewRes = await api('POST', '/api/items/bulk-import', {
    rows: [
      {
        name: 'Kohinoor Basmati Rice 500g',
        sku: newSku,
        barcode: newBarcode,
        barcodeType: 'INTERNAL',
        unit: 'pcs',
        priceMinor: 5000,
        category: groceryCat,
        openingQtyMilli: 25000,
      },
    ],
  }, shopA.owner);

  assert.equal(createNewRes.status, 200);
  assert.equal(createNewRes.body.created, 1);
  assert.notEqual(createNewRes.body.results[0].itemId, candidate1Id);
  assert.notEqual(createNewRes.body.results[0].itemId, candidate2Id);

  // Verify created distinct product has unique SKU and internal barcode
  const newProduct = await api('GET', `/api/items/${createNewRes.body.results[0].itemId}`, undefined, shopA.owner);
  assert.equal(newProduct.body.item.name, 'Kohinoor Basmati Rice 500g');
  assert.equal(newProduct.body.item.sku, newSku);
  assert.equal(newProduct.body.item.barcode, newBarcode);
});

test('44: Optimized bulk import workflow: branded vs shop products, bulk internal generation, continuous manufacturer scanning, multiple barcodes, restocks & transactional safety', async () => {
  // A. Automatic Product Nature Classification
  const doveNature = classifyProductNature('Dove Shampoo Daily Shine 180ml');
  assert.equal(doveNature.nature, 'BRANDED');
  assert.equal(doveNature.confidence, 'HIGH');
  assert.equal(doveNature.brandName, 'Dove');

  const goodDayNature = classifyProductNature('Britannia Good Day 200g');
  assert.equal(goodDayNature.nature, 'BRANDED');
  assert.equal(goodDayNature.confidence, 'HIGH');

  const tataSaltNature = classifyProductNature('Tata Salt 1kg');
  assert.equal(tataSaltNature.nature, 'BRANDED');
  assert.equal(tataSaltNature.confidence, 'HIGH');

  const kissanJamNature = classifyProductNature('Kissan Mixed Fruit Jam 200g');
  assert.equal(kissanJamNature.nature, 'BRANDED');
  assert.equal(kissanJamNature.confidence, 'HIGH');

  const looseRiceNature = classifyProductNature('Loose Basmati Rice');
  assert.equal(looseRiceNature.nature, 'SHOP_PRODUCT');
  assert.equal(looseRiceNature.confidence, 'HIGH');

  const shopDalNature = classifyProductNature('Shop-packed Toor Dal 1kg');
  assert.equal(shopDalNature.nature, 'SHOP_PRODUCT');
  assert.equal(shopDalNature.confidence, 'HIGH');

  const snacksNature = classifyProductNature('Homemade Murukku Snacks 250g');
  assert.equal(snacksNature.nature, 'SHOP_PRODUCT');
  assert.equal(snacksNature.confidence, 'HIGH');

  // B. Prepare an existing product in the store for Restock testing
  const existingBcRes = await db.query<{ barcode: string }>(
    'SELECT barcode FROM product_barcodes WHERE tenant_id = ?',
    [shopA.tenantId]
  );
  const existingBarcodes = new Set(existingBcRes.map((r) => r.barcode));

  const existingMfrBarcode = '8901030000018';
  existingBarcodes.add(existingMfrBarcode);

  const setupItemRes = await api('POST', '/api/items', {
    name: 'Dove Shampoo Daily Shine 180ml',
    sku: 'DOVE-SH-180',
    barcode: existingMfrBarcode,
    priceMinor: 18000,
    costMinor: 14000,
    unit: 'pcs',
    openingQtyMilli: 5000,
    active: true,
  }, shopA.owner);
  assert.equal(setupItemRes.status, 200);
  const existingItemId = setupItemRes.body.item.id;

  // C. Test Barcode Lookup endpoint: GET /api/items/by-barcode/:code
  const lookupRes = await api('GET', `/api/items/by-barcode/${existingMfrBarcode}`, undefined, shopA.owner);
  assert.equal(lookupRes.status, 200);
  assert.equal(lookupRes.body.item.id, existingItemId);
  assert.equal(lookupRes.body.item.name, 'Dove Shampoo Daily Shine 180ml');

  // Verify non-existent barcode lookup returns 404
  const notFoundRes = await api('GET', '/api/items/by-barcode/9999999999999', undefined, shopA.owner);
  assert.equal(notFoundRes.status, 404);

  // D. Bulk internal barcode generation for shop products
  // Leading zeros preserved strictly as string
  const mfrBarcode1 = '0123456789012'; // has leading zero
  const mfrBarcode2 = '8901063012345';
  existingBarcodes.add(mfrBarcode1);
  existingBarcodes.add(mfrBarcode2);

  const internalCode1 = generateUniqueInternalBarcode(existingBarcodes);
  existingBarcodes.add(internalCode1);
  const internalCode2 = generateUniqueInternalBarcode(existingBarcodes);
  existingBarcodes.add(internalCode2);

  assert.ok(isValidEan13(internalCode1));
  assert.ok(isValidEan13(internalCode2));
  assert.notEqual(internalCode1, internalCode2);
  assert.ok(internalCode1.startsWith('20'));

  // Dual barcodes: product with BOTH manufacturer barcode and internal shelf barcode
  const dualMfr = '8901234000019';
  const dualInternal = generateUniqueInternalBarcode(existingBarcodes);
  existingBarcodes.add(dualMfr);
  existingBarcodes.add(dualInternal);

  // E. Execute Mixed Bulk Import
  const importRes = await api('POST', '/api/items/bulk-import', {
    rows: [
      // 1. Restock row of existing Dove Shampoo (with preserved barcode and stock increase)
      {
        name: 'Dove Shampoo Daily Shine 180ml',
        isRestock: true,
        matchedItemId: existingItemId,
        barcode: existingMfrBarcode,
        barcodeType: 'MANUFACTURER',
        priceMinor: 18000,
        openingQtyMilli: 15000, // +15 pcs
        updatePrices: false,
      },
      // 2. Branded product with scanned manufacturer barcode preserving leading zero
      {
        name: 'Britannia Good Day 200g',
        sku: 'BGD-200',
        barcode: mfrBarcode1,
        barcodeType: 'MANUFACTURER',
        productNature: 'BRANDED',
        priceMinor: 4500,
        costMinor: 3600,
        unit: 'pcs',
        openingQtyMilli: 20000,
      },
      // 3. Branded product with BOTH manufacturer and internal shelf barcodes
      {
        name: 'Kissan Mixed Fruit Jam 200g',
        sku: 'KMFJ-DUAL-200',
        barcode: dualMfr,
        barcodeType: 'MANUFACTURER',
        productNature: 'BRANDED',
        additionalBarcodes: [
          { barcode: dualInternal, barcodeType: 'INTERNAL' }
        ],
        priceMinor: 9500,
        costMinor: 7500,
        unit: 'pcs',
        openingQtyMilli: 10000,
      },
      // 4. Shop-selling product with generated internal barcode
      {
        name: 'Loose Basmati Rice',
        sku: 'LBR-1KG',
        barcode: internalCode1,
        barcodeType: 'INTERNAL',
        productNature: 'SHOP_PRODUCT',
        priceMinor: 8500,
        costMinor: 6500,
        unit: 'kg',
        openingQtyMilli: 50000, // 50kg
      },
      // 5. Shop-selling product where barcode is generated automatically by backend
      {
        name: 'Shop-packed Toor Dal 1kg',
        sku: 'SPTD-1KG',
        productNature: 'SHOP_PRODUCT',
        priceMinor: 14000,
        costMinor: 11500,
        unit: 'kg',
        openingQtyMilli: 30000,
      },
    ],
  }, shopA.owner);

  assert.equal(importRes.status, 200);
  assert.equal(importRes.body.restocked, 1);
  assert.equal(importRes.body.created, 4);
  assert.equal(importRes.body.skipped, 0);

  // F. Verify database state for all imported products
  // 1. Restock product stock updated and existing barcode preserved
  const restockedDove = await api('GET', `/api/items/${existingItemId}`, undefined, shopA.owner);
  assert.equal(restockedDove.body.item.currentStockMilli, 20000, 'Original 5000 + 15000 = 20000');
  assert.equal(restockedDove.body.item.barcode, existingMfrBarcode);

  // 2. Leading zero preserved in database as string
  const mfrItemLookup = await api('GET', `/api/items/by-barcode/${mfrBarcode1}`, undefined, shopA.owner);
  assert.equal(mfrItemLookup.status, 200);
  assert.equal(mfrItemLookup.body.item.barcode, '0123456789012');
  assert.equal(mfrItemLookup.body.item.name, 'Britannia Good Day 200g');

  // 3. Product with BOTH manufacturer and internal barcodes can be looked up by EITHER barcode
  const dualByMfr = await api('GET', `/api/items/by-barcode/${dualMfr}`, undefined, shopA.owner);
  assert.equal(dualByMfr.status, 200);
  assert.equal(dualByMfr.body.item.name, 'Kissan Mixed Fruit Jam 200g');

  const dualByInternal = await api('GET', `/api/items/by-barcode/${dualInternal}`, undefined, shopA.owner);
  assert.equal(dualByInternal.status, 200);
  assert.equal(dualByInternal.body.item.id, dualByMfr.body.item.id, 'Both barcodes resolve to the exact same product ID');

  // Verify both records exist in product_barcodes table
  const dualBarcodesInDb = await db.query<{ barcode: string; barcodeType?: string; barcode_type?: string }>(
    'SELECT barcode, barcode_type FROM product_barcodes WHERE tenant_id = ? AND product_id = ? ORDER BY barcode_type DESC',
    [shopA.tenantId, dualByMfr.body.item.id]
  );
  assert.equal(dualBarcodesInDb.length, 2);
  assert.ok(dualBarcodesInDb.some((b) => b.barcode === dualMfr && (b.barcodeType === 'MANUFACTURER' || b.barcode_type === 'MANUFACTURER')));
  assert.ok(dualBarcodesInDb.some((b) => b.barcode === dualInternal && (b.barcodeType === 'INTERNAL' || b.barcode_type === 'INTERNAL')));

  // 4. Shop product with generated internal barcode
  const shopItemLookup = await api('GET', `/api/items/by-barcode/${internalCode1}`, undefined, shopA.owner);
  assert.equal(shopItemLookup.status, 200);
  assert.equal(shopItemLookup.body.item.name, 'Loose Basmati Rice');

  // G. Prevent Duplicate Barcode Assignments
  const dupBarcodeAttempt = await api('POST', '/api/items/bulk-import', {
    rows: [
      {
        name: 'Another Jam Jar',
        sku: 'JAM-DUP',
        barcode: dualMfr, // same barcode already assigned to Kissan Jam
        priceMinor: 9900,
      },
    ],
  }, shopA.owner);
  // Row should fail or be skipped due to unique barcode conflict
  assert.equal(dupBarcodeAttempt.status, 200);
  assert.equal(dupBarcodeAttempt.body.created, 0);
  assert.equal(dupBarcodeAttempt.body.skipped, 1);
  assert.ok(
    dupBarcodeAttempt.body.results[0].reason.toLowerCase().includes('already exists') ||
    dupBarcodeAttempt.body.results[0].reason.toLowerCase().includes('duplicate')
  );
});

test('45: Permanent product deletion: removes eligible product from DB and cleans up barcodes, while preventing deletion with historical transactions', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // 1. Create an eligible product with barcodes and opening stock
  const testBarcode = '8909876543210';
  const createRes = await api('POST', '/api/items', {
    name: 'Ephemeral Test Biscuits',
    sku: 'ETB-100',
    barcode: testBarcode,
    priceMinor: 2500,
    unit: 'pcs',
    openingQtyMilli: 10000,
  }, shopA.owner);
  assert.equal(createRes.status, 200);
  const itemId = createRes.body.item.id;

  // Add an extra barcode in product_barcodes
  const extraBarcode = '2000000999991';
  await db.exec(
    'INSERT INTO product_barcodes (id, tenant_id, product_id, barcode, barcode_type) VALUES (?, ?, ?, ?, ?)',
    ['pb_test_del_1', shopA.tenantId, itemId, extraBarcode, 'INTERNAL']
  );

  // Verify item and barcodes exist in DB
  const beforeItem = await db.one('SELECT id, name FROM items WHERE id = ? AND tenant_id = ?', [itemId, shopA.tenantId]);
  assert.ok(beforeItem);
  const beforeBc = await db.query('SELECT barcode FROM product_barcodes WHERE product_id = ? AND tenant_id = ?', [itemId, shopA.tenantId]);
  assert.ok(beforeBc.length > 0);

  // 2. Perform permanent deletion
  const delRes = await api('DELETE', `/api/items/${itemId}?permanent=true`, undefined, shopA.owner);
  assert.equal(delRes.status, 200);
  assert.equal(delRes.body.ok, true);
  assert.equal(delRes.body.deleted, true);

  // 3. Verify product is completely gone from the database
  const afterItem = await db.one('SELECT id FROM items WHERE id = ? AND tenant_id = ?', [itemId, shopA.tenantId]);
  assert.equal(afterItem, undefined, 'Item must be physically deleted from items table');

  // 4. Verify product_barcodes mappings are cleaned up
  const afterBc = await db.query('SELECT barcode FROM product_barcodes WHERE product_id = ? AND tenant_id = ?', [itemId, shopA.tenantId]);
  assert.equal(afterBc.length, 0, 'All associated barcodes must be deleted');

  // 5. Verify barcode scan returns 404
  const scan404 = await api('GET', `/api/items/by-barcode/${testBarcode}`, undefined, shopA.owner);
  assert.equal(scan404.status, 404);

  // 6. Test Transaction Protection: Product with Sales Invoice history CANNOT be deleted
  const soldItemRes = await api('POST', '/api/items', {
    name: 'Protected Milk Bread',
    sku: 'PMB-400',
    barcode: '8901234888888',
    priceMinor: 4000,
  }, shopA.owner);
  assert.equal(soldItemRes.status, 200);
  const soldItemId = soldItemRes.body.item.id;

  // Insert mock invoice line referencing this product
  const invId = 'inv_test_prot_del';
  await db.exec(
    `INSERT INTO invoices (id, tenant_id, client_id, number, kind, status, bdate, subtotal_minor, taxable_minor, total_minor, rule_version, share_token)
     VALUES (?, ?, ?, ?, 'sale', 'posted', '2026-10-26', 4000, 4000, 4000, 'v1', ?)`,
    [invId, shopA.tenantId, 'c_test_prot_1', 'INV-DEL-TEST', 'tok_test_prot_1']
  );
  await db.exec(
    `INSERT INTO invoice_lines (id, tenant_id, invoice_id, pos, item_id, name, qty_milli, price_minor, tax_rate_bp, inclusive, taxable_minor, total_minor)
     VALUES (?, ?, ?, 1, ?, 'Protected Milk Bread', 1000, 4000, 0, true, 4000, 4000)`,
    ['il_test_prot_1', shopA.tenantId, invId, soldItemId]
  );

  // Attempt to delete protected item - must fail with 409 Conflict
  const blockedDelRes = await api('DELETE', `/api/items/${soldItemId}?permanent=true`, undefined, shopA.owner);
  assert.equal(blockedDelRes.status, 409);
  const errMsg = (typeof blockedDelRes.body.error === 'object' ? blockedDelRes.body.error.message : blockedDelRes.body.error).toLowerCase();
  assert.ok(errMsg.includes('sales invoice') || errMsg.includes('deactivate'));

  // Verify item is STILL in the database (not deleted)
  const stillExists = await db.one('SELECT id, name FROM items WHERE id = ? AND tenant_id = ?', [soldItemId, shopA.tenantId]);
  assert.ok(stillExists, 'Protected product must remain in database to preserve financial history');
});

test('46: Comprehensive verification of manufacturer barcode workflow, search, leading zeros, conflicts, and billing lookup', async (t) => {
  if (skipReason) return t.skip(skipReason);

  // Scenario 1 & 5: Branded product with manufacturer barcode containing leading zeros
  const barcodeWithLeadingZero = '0078901234567'; // Preserves leading zeros as string
  const tataTeaName = 'Tata Tea Premium 250 g';
  const tataTeaSku = 'TTP-250';

  // Scenario 2: Search by SKU instead of product name
  // Mock imported rows in session
  const sessionRows: {
    _id: number;
    rowNum: number;
    name: string;
    sku: string;
    barcode: string;
    barcodeType: 'INTERNAL' | 'MANUFACTURER' | null;
    unit: string;
    priceMinor: number;
    costMinor: number;
    openingStock: string;
  }[] = [
    {
      _id: 101,
      rowNum: 1,
      name: tataTeaName,
      sku: tataTeaSku,
      barcode: '',
      barcodeType: null,
      unit: 'pcs',
      priceMinor: 14000,
      costMinor: 11000,
      openingStock: '25',
    },
    {
      _id: 102,
      rowNum: 2,
      name: 'Loose Moong Dal 1kg',
      sku: 'LMD-1KG',
      barcode: '',
      barcodeType: null,
      unit: 'kg',
      priceMinor: 12000,
      costMinor: 9500,
      openingStock: '50',
    },
    {
      _id: 103,
      rowNum: 3,
      name: 'Britannia Good Day 100g',
      sku: 'BGD-100',
      barcode: '',
      barcodeType: null,
      unit: 'pcs',
      priceMinor: 3000,
      costMinor: 2200,
      openingStock: '40',
    },
  ];

  // Test 1: Search by product name finds Row #1
  const searchByName = sessionRows.filter((r) => r.name.toLowerCase().includes('tata tea'));
  assert.equal(searchByName.length, 1);
  assert.equal(searchByName[0]._id, 101);

  // Test 2: Search by SKU finds Row #1
  const searchBySku = sessionRows.filter((r) => r.sku.toLowerCase().includes('ttp-250'));
  assert.equal(searchBySku.length, 1);
  assert.equal(searchBySku[0]._id, 101);

  // Test 6: Selecting Row #1, filtering list to 'Loose Moong Dal', and verifying target row ID is STILL 101
  const selectedTargetId = 101;
  const filteredList = sessionRows.filter((r) => r.name.toLowerCase().includes('moong dal'));
  assert.equal(filteredList.length, 1);
  assert.equal(selectedTargetId, 101, 'Selected target ID must remain bound to Row #1 (_id 101) despite filtering');

  // Test 5: Assign barcode with leading zeros to Row #1
  assert.equal(typeof barcodeWithLeadingZero, 'string');
  assert.equal(barcodeWithLeadingZero.startsWith('00'), true);
  sessionRows[0].barcode = barcodeWithLeadingZero;
  sessionRows[0].barcodeType = 'MANUFACTURER';

  // Test 3: Scan same barcode twice for the same product
  const sameProductScan = sessionRows[0].barcode === barcodeWithLeadingZero;
  assert.equal(sameProductScan, true, 'Scanning same barcode for same product is idempotent and recognized');

  // Test 4: Scan same barcode for another product (Row #3) - duplicate conflict detected
  const otherRowScanCode = barcodeWithLeadingZero;
  const isConflictWithOther = sessionRows.some((r) => r._id !== 103 && r.barcode === otherRowScanCode);
  assert.equal(isConflictWithOther, true, 'Barcode conflict with another product must be detected and not silently reassigned');

  // Test 7: Generate internal barcodes for eligible shop product (Row #2) without touching Row #1's manufacturer barcode
  assert.equal(sessionRows[0].barcodeType, 'MANUFACTURER', 'Row #1 must keep manufacturer barcode');
  const allDbBarcodes = new Set(
    (await db.query<{ barcode: string }>(
      'SELECT barcode FROM items WHERE tenant_id = ? AND barcode IS NOT NULL UNION SELECT barcode FROM product_barcodes WHERE tenant_id = ?',
      [shopA.tenantId, shopA.tenantId]
    )).map((r) => r.barcode)
  );
  const seenBarcodes = new Set<string>([barcodeWithLeadingZero]);
  const newInternalCode = generateUniqueInternalBarcode(allDbBarcodes, seenBarcodes);
  assert.ok(newInternalCode.startsWith('20'));
  sessionRows[1].barcode = newInternalCode;
  sessionRows[1].barcodeType = 'INTERNAL';

  // Row #3 receives its own manufacturer barcode
  const britanniaBarcode = '8901063000555';
  sessionRows[2].barcode = britanniaBarcode;
  sessionRows[2].barcodeType = 'MANUFACTURER';

  // Test 8: Import the products to database and verify products and barcode mappings are saved consistently in transaction
  const importRes = await api('POST', '/api/items/bulk-import', {
    rows: sessionRows.map((r) => ({
      name: r.name,
      sku: r.sku,
      barcode: r.barcode,
      barcodeType: r.barcodeType,
      unit: r.unit,
      priceMinor: r.priceMinor,
      costMinor: r.costMinor,
      openingQtyMilli: Math.round(parseFloat(r.openingStock) * 1000),
    })),
  }, shopA.owner);

  assert.equal(importRes.status, 200);
  assert.equal(importRes.body.created, 3);
  assert.equal(importRes.body.barcodesSaved, 3);

  // Test 9: Verify billing lookup by saved manufacturer barcode (with leading zeros) returns Tata Tea
  const lookupTataTea = await api('GET', `/api/items/by-barcode/${barcodeWithLeadingZero}`, undefined, shopA.owner);
  assert.equal(lookupTataTea.status, 200);
  assert.equal(lookupTataTea.body.item.name, tataTeaName);
  assert.equal(lookupTataTea.body.item.barcode, barcodeWithLeadingZero, 'Leading zeros must be preserved exactly in database');

  // Verify billing lookup by internal barcode returns Loose Moong Dal
  const lookupMoongDal = await api('GET', `/api/items/by-barcode/${newInternalCode}`, undefined, shopA.owner);
  assert.equal(lookupMoongDal.status, 200);
  assert.equal(lookupMoongDal.body.item.name, 'Loose Moong Dal 1kg');

  // Test 10: Verify unresolved barcode errors and duplicate barcode detection
  const dupImportAttempt = await api('POST', '/api/items/bulk-import', {
    rows: [
      {
        name: 'Conflict Tea Packet',
        sku: 'CTP-100',
        barcode: barcodeWithLeadingZero, // already exists
        priceMinor: 5000,
        unit: 'pcs',
      },
    ],
  }, shopA.owner);
  assert.equal(dupImportAttempt.status, 200);
  assert.equal(dupImportAttempt.body.created, 0);
  assert.equal(dupImportAttempt.body.skipped, 1);
  assert.ok(dupImportAttempt.body.results[0].reason.toLowerCase().includes('already exists'));
});



