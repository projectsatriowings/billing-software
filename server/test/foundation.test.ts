import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';
import { gstinCheckChar, validateGstin } from '../../shared/tax.ts';
import { createApp } from '../src/app.ts';
import { connectWire } from '../src/db/wire.ts';
import { migrate, type DB } from '../src/db/index.ts';
import { MIGRATIONS } from '../src/db/schema.ts';
import { hashPassword, passwordProblem, passwordStamp, signToken, verifyPassword, verifyToken } from '../src/security.ts';
import { startTestDb, type TestDb } from './support/testdb.ts';

// ------------------------------------------------------------------ pure security units (no database needed)
test('passwords: hash is salted, verifies, rejects wrong and malformed', () => {
  const h1 = hashPassword('correct horse 9');
  const h2 = hashPassword('correct horse 9');
  assert.notEqual(h1, h2, 'same password must hash differently (random salt)');
  assert.ok(verifyPassword('correct horse 9', h1));
  assert.ok(!verifyPassword('correct horse 8', h1));
  assert.ok(!verifyPassword('x', 'not-a-hash'));
});

test('password policy gives plain-language problems', () => {
  assert.match(passwordProblem('short')!, /at least 8/);
  assert.match(passwordProblem('aaaaaaaaaa')!, /repeated/);
  assert.match(passwordProblem('Password123')!, /common/);
  assert.equal(passwordProblem('Tamil-Shop-2026'), null);
  assert.match(passwordProblem(undefined)!, /required/);
});

test('tokens: valid, tampered, expired, wrong secret, alg none', () => {
  const t = signToken({ sub: 'u1', tid: 't1', ph: 'abc' }, 'secret', 60, 1000);
  assert.equal(verifyToken(t, 'secret', 1030)?.sub, 'u1');
  assert.equal(verifyToken(t, 'secret', 1061), null, 'expired');
  assert.equal(verifyToken(t, 'other', 1030), null, 'wrong secret');
  const [h, , s] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'u1', tid: 'OTHER-SHOP', ph: 'abc', iat: 1000, exp: 2000 })).toString('base64url');
  assert.equal(verifyToken(`${h}.${forged}.${s}`, 'secret', 1030), null, 'payload changed, signature kept');
  const none = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  assert.equal(verifyToken(`${none}.${forged}.`, 'secret', 1030), null, 'alg none');
  assert.equal(verifyToken('garbage', 'secret'), null);
  assert.notEqual(passwordStamp('hash-a'), passwordStamp('hash-b'));
});

// ------------------------------------------------------------------ database + API (real PostgreSQL)
let pg: TestDb | null = null;
let db: DB;
let server: http.Server;
let base = '';
let skipReason: string | false = false;

before(async () => {
  pg = await startTestDb();
  if (!pg) { skipReason = 'PostgreSQL server programs (initdb, pg_ctl) were not found. Install PostgreSQL or set PG_BIN.'; return; }
  db = await connectWire(pg.url);
  server = http.createServer(createApp(db, { secret: 'test-secret', log: false }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
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
  return { status: res.status, body: json, code: json?.error?.code as string | undefined };
}

const g14 = '33AAAAA0000A1Z';
const GSTIN = g14 + gstinCheckChar(g14);
const PW = 'Tamil-Shop-2026';
const S = { a: {} as any, b: {} as any, cashier: {} as any, accountant: {} as any, owner2: {} as any };

test('migrations: apply once, then nothing to do, all tables exist', async (t) => {
  if (skipReason) return t.skip(skipReason);
  assert.deepEqual(await migrate(db), MIGRATIONS.map((m) => m.version));
  assert.deepEqual(await migrate(db), []);
  const rows = await db.query<{ n: string }>(`SELECT table_name AS n FROM information_schema.tables WHERE table_schema = 'public'`);
  const have = new Set(rows.map((r) => r.n));
  for (const tbl of ['tenants', 'users', 'parties', 'items', 'stock_moves', 'invoices', 'invoice_lines', 'payments', 'audit_log', 'config_versions', 'schema_migrations']) {
    assert.ok(have.has(tbl), `missing table ${tbl}`);
  }
});

test('public routes: health, meta, unknown route, protected routes need login', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const h = await api('GET', '/api/health');
  assert.equal(h.status, 200);
  assert.equal(h.body.db, 'up');
  const m = await api('GET', '/api/meta');
  assert.ok(m.body.packs.length >= 5 && m.body.roles.includes('cashier') && m.body.states.length > 30);
  assert.equal((await api('GET', '/api/nope')).status, 404);
  for (const p of ['/api/auth/me', '/api/users', '/api/shop']) assert.equal((await api('GET', p)).status, 401, p);
  assert.equal((await api('GET', '/api/auth/me', undefined, 'garbage-token')).status, 401);
  assert.equal((await api('POST', '/api/auth/login', { email: 'x@y.com', password: 'nope-nope-1' }, 'garbage-token')).status, 401, 'login still works as a public route (bad credentials, not bad token)');
});

test('register: creates shop + owner, validates input in plain language', async (t) => {
  if (skipReason) return t.skip(skipReason);
  assert.ok(validateGstin(GSTIN).ok, 'test GSTIN is valid');
  const ok = await api('POST', '/api/auth/register', { name: 'Sri Murugan Stores', ownerName: 'Murugan', email: 'Owner@MuruganStores.in', password: PW, businessType: 'retail', gstin: GSTIN, phone: '98765 43210' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.user.role, 'owner');
  assert.equal(ok.body.user.email, 'owner@muruganstores.in', 'email is stored lower-case');
  assert.equal(ok.body.shop.stateCode, '33', 'state taken from GSTIN');
  assert.equal(ok.body.shop.phone, '9876543210');
  assert.ok(ok.body.perms.includes('users') && ok.body.perms.includes('settings'));
  assert.equal(ok.body.token.split('.').length, 3);
  assert.equal(JSON.stringify(ok.body).includes('password'), false, 'no password data in the response');
  S.a = { token: ok.body.token, tenantId: ok.body.shop.id, userId: ok.body.user.id };

  const dup = await api('POST', '/api/auth/register', { name: 'Other', ownerName: 'X', email: 'owner@muruganstores.in', password: PW });
  assert.equal(dup.status, 409);
  assert.equal(dup.code, 'EMAIL_TAKEN');
  assert.equal((await api('POST', '/api/auth/register', { name: 'Z', ownerName: 'Z', email: 'z@z.in', password: 'short' })).code, 'WEAK_PASSWORD');
  assert.equal((await api('POST', '/api/auth/register', { name: 'Z', ownerName: 'Z', email: 'not-an-email', password: PW })).status, 400);
  assert.equal((await api('POST', '/api/auth/register', { name: 'Z', ownerName: 'Z', email: 'z@z.in', password: PW, gstin: g14 + (GSTIN.endsWith('1') ? '2' : '1') })).status, 400, 'bad GSTIN check digit');
  const mism = await api('POST', '/api/auth/register', { name: 'Z', ownerName: 'Z', email: 'z@z.in', password: PW, gstin: GSTIN, stateCode: '29' });
  assert.equal(mism.status, 400);
  assert.match(mism.body.error.message, /state/i);
  assert.equal((await api('POST', '/api/auth/register', { ownerName: 'Z', email: 'z@z.in', password: PW })).status, 400, 'shop name required');
});

test('login: right password works; wrong password and unknown email look identical', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const ok = await api('POST', '/api/auth/login', { email: 'OWNER@muruganstores.in', password: PW });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.shop.name, 'Sri Murugan Stores');
  const bad = await api('POST', '/api/auth/login', { email: 'owner@muruganstores.in', password: 'wrong-pass-1' });
  const unknown = await api('POST', '/api/auth/login', { email: 'nobody@muruganstores.in', password: 'wrong-pass-1' });
  assert.equal(bad.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(bad.body.error.message, unknown.body.error.message, 'must not reveal which emails exist');
  const me = await api('GET', '/api/auth/me', undefined, ok.body.token);
  assert.equal(me.body.user.id, S.a.userId);
});

test('staff: owner adds cashier + accountant; roles limit what each can do', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const c = await api('POST', '/api/users', { name: 'Ravi', email: 'ravi@muruganstores.in', password: PW, role: 'cashier' }, S.a.token);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.role, 'cashier');
  assert.equal('passwordHash' in c.body, false);
  S.cashier.id = c.body.id;
  const a = await api('POST', '/api/users', { name: 'CA Kumar', email: 'ca@muruganstores.in', password: PW, role: 'accountant' }, S.a.token);
  S.accountant.id = a.body.id;
  assert.equal((await api('POST', '/api/users', { name: 'Dup', email: 'RAVI@muruganstores.in', password: PW, role: 'cashier' }, S.a.token)).code, 'EMAIL_TAKEN');
  assert.equal((await api('POST', '/api/users', { name: 'Bad', email: 'bad@x.in', password: PW, role: 'superadmin' }, S.a.token)).status, 400);

  const list = await api('GET', '/api/users', undefined, S.a.token);
  assert.equal(list.body.users.length, 3);

  S.cashier.token = (await api('POST', '/api/auth/login', { email: 'ravi@muruganstores.in', password: PW })).body.token;
  S.accountant.token = (await api('POST', '/api/auth/login', { email: 'ca@muruganstores.in', password: PW })).body.token;
  const me = await api('GET', '/api/auth/me', undefined, S.cashier.token);
  assert.ok(me.body.perms.includes('sell') && !me.body.perms.includes('users') && !me.body.perms.includes('reports'));

  for (const tok of [S.cashier.token, S.accountant.token]) {
    assert.equal((await api('GET', '/api/users', undefined, tok)).status, 403);
    assert.equal((await api('POST', '/api/users', { name: 'Sneaky', email: 's@x.in', password: PW, role: 'owner' }, tok)).status, 403);
    assert.equal((await api('PUT', '/api/shop', { name: 'Hacked' }, tok)).status, 403);
    assert.equal((await api('PATCH', `/api/users/${S.a.userId}`, { active: false }, tok)).status, 403);
    assert.equal((await api('GET', '/api/shop', undefined, tok)).status, 200, 'everyone can read the shop profile');
  }
});

test('shop settings: owner edits profile with validation, changes are audited', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const up = await api('PUT', '/api/shop', { name: 'Sri Murugan Super Stores', invoicePrefix: 'smss', upiId: 'murugan@okbank', language: 'ta', locations: ['MAIN', 'GODOWN'], address: '12 Anna Salai, Chennai' }, S.a.token);
  assert.equal(up.status, 200, JSON.stringify(up.body));
  assert.equal(up.body.invoicePrefix, 'SMSS');
  assert.deepEqual(up.body.locations, ['MAIN', 'GODOWN']);
  assert.equal(up.body.language, 'ta');
  assert.equal((await api('PUT', '/api/shop', { upiId: 'no-at-sign' }, S.a.token)).status, 400);
  assert.equal((await api('PUT', '/api/shop', { invoicePrefix: 'TOO-LONG-PREFIX' }, S.a.token)).status, 400);
  assert.equal((await api('PUT', '/api/shop', { locations: ['A', 'a'] }, S.a.token)).status, 400, 'duplicate location');
  assert.equal((await api('PUT', '/api/shop', { language: 'fr' }, S.a.token)).status, 400);
  assert.equal((await api('PUT', '/api/shop', { name: '   ' }, S.a.token)).status, 400);
  assert.equal((await api('PUT', '/api/shop', { stateCode: '29' }, S.a.token)).status, 400, 'state must match the GSTIN');
  const same = await api('PUT', '/api/shop', { name: 'Sri Murugan Super Stores' }, S.a.token);
  assert.equal(same.status, 200);
  const audits = await db.query(`SELECT detail FROM audit_log WHERE tenant_id = ? AND action = 'shop.update'`, [S.a.tenantId]);
  assert.equal(audits.length, 1, 'only the real change is audited, the no-op is not');
  assert.equal(audits[0].detail.changed.name.from, 'Sri Murugan Stores');
});

test('a location that already holds stock cannot be removed', async (t) => {
  if (skipReason) return t.skip(skipReason);
  await db.exec(`INSERT INTO items (id, tenant_id, name) VALUES ('it_1', ?, 'Test item')`, [S.a.tenantId]);
  await db.exec(`INSERT INTO stock_moves (id, tenant_id, item_id, location, qty_milli, kind) VALUES ('sm_1', ?, 'it_1', 'GODOWN', 5000, 'opening')`, [S.a.tenantId]);
  const r = await api('PUT', '/api/shop', { locations: ['MAIN'] }, S.a.token);
  assert.equal(r.status, 409);
  assert.equal(r.code, 'LOCATION_IN_USE');
  assert.equal((await api('PUT', '/api/shop', { locations: ['MAIN', 'GODOWN', 'SHOP2'] }, S.a.token)).status, 200, 'adding is fine');
});

test('shops are fully separate: another shop cannot see or change this shop', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const b = await api('POST', '/api/auth/register', { name: 'Other Shop', ownerName: 'Other Owner', email: 'boss@othershop.in', password: PW });
  assert.equal(b.status, 200);
  S.b = { token: b.body.token, tenantId: b.body.shop.id, userId: b.body.user.id };
  const list = await api('GET', '/api/users', undefined, S.b.token);
  assert.equal(list.body.users.length, 1);
  assert.equal(list.body.users[0].email, 'boss@othershop.in');
  assert.equal((await api('PATCH', `/api/users/${S.cashier.id}`, { active: false }, S.b.token)).status, 404);
  assert.equal((await api('POST', `/api/users/${S.cashier.id}/reset-password`, { newPassword: 'Hacker-2026-x' }, S.b.token)).status, 404);
  assert.equal((await api('GET', '/api/shop', undefined, S.b.token)).body.name, 'Other Shop');
  assert.equal((await api('GET', '/api/auth/me', undefined, S.cashier.token)).status, 200, 'cashier of shop A unaffected');
  // a token cannot be re-pointed at another shop: the signature covers the shop id
  const [h, p, s] = S.cashier.token.split('.');
  const body = JSON.parse(Buffer.from(p, 'base64url').toString());
  body.tid = S.b.tenantId;
  const forged = `${h}.${Buffer.from(JSON.stringify(body)).toString('base64url')}.${s}`;
  assert.equal((await api('GET', '/api/users', undefined, forged)).status, 401);
});

test('owner safety: cannot switch off or demote yourself; two owners cannot demote each other at once', async (t) => {
  if (skipReason) return t.skip(skipReason);
  assert.equal((await api('PATCH', `/api/users/${S.a.userId}`, { active: false }, S.a.token)).code, 'SELF_CHANGE');
  assert.equal((await api('PATCH', `/api/users/${S.a.userId}`, { role: 'manager' }, S.a.token)).code, 'SELF_CHANGE');
  const o2 = await api('POST', '/api/users', { name: 'Second Owner', email: 'owner2@muruganstores.in', password: PW, role: 'owner' }, S.a.token);
  S.owner2 = { id: o2.body.id, token: (await api('POST', '/api/auth/login', { email: 'owner2@muruganstores.in', password: PW })).body.token };
  const [r1, r2] = await Promise.all([
    api('PATCH', `/api/users/${S.owner2.id}`, { role: 'manager' }, S.a.token),
    api('PATCH', `/api/users/${S.a.userId}`, { role: 'manager' }, S.owner2.token),
  ]);
  const statuses = [r1.status, r2.status].sort();
  assert.equal(statuses[0], 200, 'exactly one demotion goes through');
  assert.ok([403, 409].includes(statuses[1]), `the other is refused (got ${statuses[1]})`);
  const owners = await db.query(`SELECT id FROM users WHERE tenant_id = ? AND role = 'owner' AND active`, [S.a.tenantId]);
  assert.equal(owners.length, 1, 'the shop always keeps one active owner');
  // put things back so later steps use the original owner
  const survivor = owners[0].id === S.a.userId ? S.a.token : S.owner2.token;
  await api('PATCH', `/api/users/${owners[0].id === S.a.userId ? S.owner2.id : S.a.userId}`, { role: 'owner' }, survivor);
});

test('switching a user off signs them out immediately; switching on restores login', async (t) => {
  if (skipReason) return t.skip(skipReason);
  assert.equal((await api('GET', '/api/auth/me', undefined, S.cashier.token)).status, 200);
  const off = await api('PATCH', `/api/users/${S.cashier.id}`, { active: false }, S.a.token);
  assert.equal(off.body.active, false);
  assert.equal((await api('GET', '/api/auth/me', undefined, S.cashier.token)).status, 401, 'old token stops working at once');
  const login = await api('POST', '/api/auth/login', { email: 'ravi@muruganstores.in', password: PW });
  assert.equal(login.status, 403);
  assert.equal(login.code, 'ACCOUNT_OFF');
  await api('PATCH', `/api/users/${S.cashier.id}`, { active: true }, S.a.token);
  assert.equal((await api('POST', '/api/auth/login', { email: 'ravi@muruganstores.in', password: PW })).status, 200);
  const roleChange = await api('PATCH', `/api/users/${S.cashier.id}`, { role: 'manager' }, S.a.token);
  assert.equal(roleChange.body.role, 'manager');
  assert.ok((await api('GET', '/api/auth/me', undefined, S.cashier.token)).body.perms.includes('returns'), 'new role applies on the very next request');
  await api('PATCH', `/api/users/${S.cashier.id}`, { role: 'cashier' }, S.a.token);
});

test('passwords: change signs out old sessions; owner reset works; wrong current password refused', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const wrong = await api('POST', '/api/auth/change-password', { currentPassword: 'not-my-password', newPassword: 'Brand-New-2026' }, S.a.token);
  assert.equal(wrong.code, 'BAD_PASSWORD');
  assert.equal((await api('POST', '/api/auth/change-password', { currentPassword: PW, newPassword: 'short' }, S.a.token)).code, 'WEAK_PASSWORD');
  assert.equal((await api('POST', '/api/auth/change-password', { currentPassword: PW, newPassword: PW }, S.a.token)).status, 400, 'must be different');
  const oldToken = S.a.token;
  const ch = await api('POST', '/api/auth/change-password', { currentPassword: PW, newPassword: 'Brand-New-2026' }, oldToken);
  assert.equal(ch.status, 200);
  assert.equal((await api('GET', '/api/auth/me', undefined, oldToken)).status, 401, 'old session ended');
  assert.equal((await api('GET', '/api/auth/me', undefined, ch.body.token)).status, 200, 'new token works');
  S.a.token = ch.body.token;
  assert.equal((await api('POST', '/api/auth/login', { email: 'owner@muruganstores.in', password: PW })).status, 401, 'old password no longer works');

  const staffToken = (await api('POST', '/api/auth/login', { email: 'ca@muruganstores.in', password: PW })).body.token;
  assert.equal((await api('POST', `/api/users/${S.accountant.id}/reset-password`, { newPassword: 'abc' }, S.a.token)).code, 'WEAK_PASSWORD');
  assert.equal((await api('POST', `/api/users/${S.accountant.id}/reset-password`, { newPassword: 'Reset-By-Owner-1' }, S.a.token)).status, 200);
  assert.equal((await api('GET', '/api/auth/me', undefined, staffToken)).status, 401, 'staff session ended by the reset');
  assert.equal((await api('POST', '/api/auth/login', { email: 'ca@muruganstores.in', password: 'Reset-By-Owner-1' })).status, 200);
});

test('audit trail records who did what, tied to the right shop only', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const rows = await db.query<{ action: string; userName: string | null; correlationId: string | null }>(`SELECT action, user_name, correlation_id FROM audit_log WHERE tenant_id = ? ORDER BY seq`, [S.a.tenantId]);
  const actions = new Set(rows.map((r) => r.action));
  for (const a of ['shop.create', 'user.create', 'shop.update', 'user.deactivate', 'user.activate', 'user.role_change', 'auth.login', 'auth.login_failed', 'auth.password_changed', 'user.password_reset']) {
    assert.ok(actions.has(a), `audit is missing ${a}`);
  }
  assert.ok(rows.every((r) => r.correlationId), 'every event carries a request id for support');
  assert.ok(rows.find((r) => r.action === 'user.create')?.userName, 'actor name saved');
  const bRows = await db.query(`SELECT action FROM audit_log WHERE tenant_id = ?`, [S.b.tenantId]);
  assert.ok(bRows.every((r: any) => ['shop.create', 'auth.login'].includes(r.action)), 'other shop events never mix');
});

test('rate limit: repeated wrong passwords are blocked (runs last)', async (t) => {
  if (skipReason) return t.skip(skipReason);
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await api('POST', '/api/auth/login', { email: 'victim@muruganstores.in', password: 'guess-number-' + i })).status;
  assert.equal(last, 429);
});
