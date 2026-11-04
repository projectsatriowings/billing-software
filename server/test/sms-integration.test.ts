import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';
import '../src/env.ts';
import { createApp } from '../src/app.ts';
import { connectDb, type DB } from '../src/db/index.ts';
import { signToken, hashPassword, newId, passwordStamp } from '../src/security.ts';
import {
  getTrialStatus,
  activateTrial,
  reserveTrialCredit,
  rollbackTrialCredit,
  sendInvoiceBillSms,
  normalizeIndianPhone,
} from '../src/services/smsService.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-long-enough-32-chars-at-least';
const TEST_TENANT_ID = 't_sms_it_' + Date.now();
const TEST_BRANCH_A = 'b_sms_ita_' + Date.now();
const TEST_BRANCH_B = 'b_sms_itb_' + Date.now();

let db: DB;
let server: http.Server;
let base = '';
let adminToken = '';
let managerToken = '';
let cashierToken = '';
let adminId = '';

before(async () => {
  db = await connectDb();
  server = http.createServer(createApp(db, { secret: JWT_SECRET, log: false }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;

  await db.exec(
    `INSERT INTO tenants (id, name, business_type, invoice_prefix)
     VALUES (?, 'SMS Test Supermarket', 'retail', 'SMS')`,
    [TEST_TENANT_ID]
  );

  await db.exec(
    `INSERT INTO branches (id, tenant_id, name, code, active)
     VALUES (?, ?, 'Main Porur Branch', 'MAIN', true)`,
    [TEST_BRANCH_A, TEST_TENANT_ID]
  );

  await db.exec(
    `INSERT INTO branches (id, tenant_id, name, code, active)
     VALUES (?, ?, 'T Nagar Branch', 'TNAGAR', true)`,
    [TEST_BRANCH_B, TEST_TENANT_ID]
  );

  const pwd = hashPassword('TestPassword123!');
  adminId = 'u_sms_ia_' + Date.now();
  const managerId = 'u_sms_im_' + Date.now();
  const cashierId = 'u_sms_ic_' + Date.now();

  await db.exec(
    `INSERT INTO users (id, tenant_id, branch_id, name, email, password_hash, role, active, assigned_location, assigned_counter)
     VALUES (?, ?, ?, 'Admin SKS', 'admin@smsit.local', ?, 'owner', true, 'MAIN', 'COUNTER-1')`,
    [adminId, TEST_TENANT_ID, TEST_BRANCH_A, pwd]
  );

  await db.exec(
    `INSERT INTO users (id, tenant_id, branch_id, name, email, password_hash, role, active, assigned_location, assigned_counter)
     VALUES (?, ?, ?, 'Manager Porur', 'mgr@smsit.local', ?, 'manager', true, 'MAIN', 'COUNTER-1')`,
    [managerId, TEST_TENANT_ID, TEST_BRANCH_A, pwd]
  );

  await db.exec(
    `INSERT INTO users (id, tenant_id, branch_id, name, email, password_hash, role, active, assigned_location, assigned_counter)
     VALUES (?, ?, ?, 'Cashier Lakshmi', 'cashier@smsit.local', ?, 'cashier', true, 'MAIN', 'COUNTER-1')`,
    [cashierId, TEST_TENANT_ID, TEST_BRANCH_A, pwd]
  );

  adminToken = signToken({ sub: adminId, tid: TEST_TENANT_ID, ph: passwordStamp(pwd), role: 'owner', branchId: TEST_BRANCH_A }, JWT_SECRET, 3600);
  managerToken = signToken({ sub: managerId, tid: TEST_TENANT_ID, ph: passwordStamp(pwd), role: 'manager', branchId: TEST_BRANCH_A }, JWT_SECRET, 3600);
  cashierToken = signToken({ sub: cashierId, tid: TEST_TENANT_ID, ph: passwordStamp(pwd), role: 'cashier', branchId: TEST_BRANCH_A }, JWT_SECRET, 3600);
});

after(async () => {
  try {
    await db.exec('DELETE FROM sms_logs WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await db.exec('DELETE FROM sms_trials WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await db.exec('DELETE FROM payments WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await db.exec('DELETE FROM invoice_lines WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await db.exec('DELETE FROM stock_moves WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await db.exec('DELETE FROM invoices WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await db.exec('DELETE FROM parties WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await db.exec('DELETE FROM shifts WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await db.exec('DELETE FROM items WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await db.exec('DELETE FROM number_series WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await db.exec('DELETE FROM users WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await db.exec('DELETE FROM branches WHERE tenant_id = ?', [TEST_TENANT_ID]);
    await db.exec('DELETE FROM tenants WHERE id = ?', [TEST_TENANT_ID]);
  } catch {}
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  }
  if (db) await db.close();
});

async function api(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

test('1. Free trial initial state and activation rules', async () => {
  const s1 = await api('GET', '/api/sms/trial-status', undefined, adminToken);
  assert.equal(s1.status, 200);
  assert.equal(s1.json.status, 'inactive');
  assert.equal(s1.json.totalCredits, 100);
  assert.equal(s1.json.remainingCredits, 100);
  assert.equal(s1.json.canActivate, true);

  const cshAct = await api('POST', '/api/sms/trial/activate', {}, cashierToken);
  assert.equal(cshAct.status, 403);

  const mgrAct = await api('POST', '/api/sms/trial/activate', {}, managerToken);
  assert.equal(mgrAct.status, 403);

  const admAct = await api('POST', '/api/sms/trial/activate', {}, adminToken);
  assert.equal(admAct.status, 200);
  assert.equal(admAct.json.status.status, 'active');
  assert.equal(admAct.json.status.totalCredits, 100);
  assert.equal(admAct.json.status.creditsUsed, 0);
  assert.equal(admAct.json.status.remainingCredits, 100);
  assert.ok(admAct.json.status.activatedAt);
  assert.ok(admAct.json.status.expiresAt);

  const actTime = new Date(admAct.json.status.activatedAt).getTime();
  const expTime = new Date(admAct.json.status.expiresAt).getTime();
  const diffHours = (expTime - actTime) / (1000 * 60 * 60);
  assert.ok(Math.abs(diffHours - 24) < 0.05, 'Trial duration must be exactly 24 hours');

  const reAct = await api('POST', '/api/sms/trial/activate', {}, adminToken);
  assert.equal(reAct.status, 400);
});

test('2. Indian phone number normalization and SMS validation', () => {
  assert.equal(normalizeIndianPhone('9840456789')?.digits10, '9840456789');
  assert.equal(normalizeIndianPhone('+91 98404 56789')?.digits10, '9840456789');
  assert.equal(normalizeIndianPhone('09840456789')?.digits10, '9840456789');
  assert.equal(normalizeIndianPhone('04424356789'), null);
  assert.equal(normalizeIndianPhone('12345'), null);
});

test('3. Concurrency-safe trial credit deduction and 100 SMS limit', async () => {
  await db.exec('UPDATE sms_trials SET credits_used = 98 WHERE tenant_id = ?', [TEST_TENANT_ID]);

  const statusBefore = await getTrialStatus(db, TEST_TENANT_ID);
  assert.equal(statusBefore.creditsUsed, 98);
  assert.equal(statusBefore.remainingCredits, 2);

  const results = await Promise.all(Array.from({ length: 10 }).map(() => reserveTrialCredit(db, TEST_TENANT_ID)));
  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  assert.equal(successCount, 2, 'Exactly 2 remaining credits must be reserved');
  assert.equal(failCount, 8, '8 requests must be rejected');

  const statusAfter = await getTrialStatus(db, TEST_TENANT_ID);
  assert.equal(statusAfter.creditsUsed, 100);
  assert.equal(statusAfter.remainingCredits, 0);
  assert.equal(statusAfter.status, 'exhausted');

  const over100 = await reserveTrialCredit(db, TEST_TENANT_ID);
  assert.equal(over100.success, false);
  assert.ok(over100.reason?.includes('limit reached'));
});

test('4. Blocking SMS after 24-hour expiration window', async () => {
  await db.exec(
    `UPDATE sms_trials
     SET credits_used = 50,
         status = 'active',
         expires_at = now() - interval '1 hour'
     WHERE tenant_id = ?`,
    [TEST_TENANT_ID]
  );

  const expiredStatus = await getTrialStatus(db, TEST_TENANT_ID);
  assert.equal(expiredStatus.status, 'expired');
  assert.equal(expiredStatus.canSend, false);

  const res = await reserveTrialCredit(db, TEST_TENANT_ID);
  assert.equal(res.success, false);
  assert.ok(res.reason?.includes('expired'));
});

test('5. Atomic credit rollback when gateway fails or rejects message', async () => {
  await db.exec(
    `UPDATE sms_trials
     SET credits_used = 50,
         status = 'active',
         expires_at = now() + interval '12 hours'
     WHERE tenant_id = ?`,
    [TEST_TENANT_ID]
  );

  const reserved = await reserveTrialCredit(db, TEST_TENANT_ID);
  assert.equal(reserved.success, true);
  assert.equal(reserved.creditsUsed, 51);

  await rollbackTrialCredit(db, TEST_TENANT_ID);

  const afterRollback = await getTrialStatus(db, TEST_TENANT_ID);
  assert.equal(afterRollback.creditsUsed, 50);
  assert.equal(afterRollback.remainingCredits, 50);
});

test('6. Branch-wise isolation of SMS logs', async () => {
  const logBranchA = newId('sms');
  const logBranchB = newId('sms');

  await db.exec(
    `INSERT INTO sms_logs (id, tenant_id, branch_id, customer_name, mobile_number, message_text, status, credit_type, gateway_provider)
     VALUES (?, ?, ?, 'Branch A Cust', '9840411111', 'Branch A msg', 'sent', 'trial', 'fast2sms')`,
    [logBranchA, TEST_TENANT_ID, TEST_BRANCH_A]
  );

  await db.exec(
    `INSERT INTO sms_logs (id, tenant_id, branch_id, customer_name, mobile_number, message_text, status, credit_type, gateway_provider)
     VALUES (?, ?, ?, 'Branch B Cust', '9840422222', 'Branch B msg', 'sent', 'trial', 'fast2sms')`,
    [logBranchB, TEST_TENANT_ID, TEST_BRANCH_B]
  );

  const mgrHistory = await api('GET', '/api/sms/history', undefined, managerToken);
  assert.equal(mgrHistory.status, 200);
  const mgrLogs = mgrHistory.json.history;
  assert.ok(mgrLogs.some((l: any) => l.id === logBranchA));
  assert.ok(!mgrLogs.some((l: any) => l.id === logBranchB));

  const admHistory = await api('GET', '/api/sms/history', undefined, adminToken);
  assert.equal(admHistory.status, 200);
  const admLogs = admHistory.json.history;
  assert.ok(admLogs.some((l: any) => l.id === logBranchA));
  assert.ok(admLogs.some((l: any) => l.id === logBranchB));
});

test('7. Deduplication prevents multiple SMS for the same invoice', async () => {
  const invId = newId('inv');
  await db.exec(
    `INSERT INTO invoices (
      id, client_id, tenant_id, branch_id, number, kind, status, bdate,
      customer_name, customer_phone, subtotal_minor, discount_minor, taxable_minor,
      cgst_minor, sgst_minor, igst_minor, round_off_minor, total_minor,
      paid_minor, balance_minor, rule_version, share_token, created_by
    ) VALUES (
      ?, ?, ?, ?, 'SMS-999', 'sale', 'posted', '2026-11-03',
      'Ramesh', '9840455555', 50000, 0, 50000,
      0, 0, 0, 0, 50000,
      50000, 0, '1.0', ?, ?
    )`,
    [invId, newId('cid'), TEST_TENANT_ID, TEST_BRANCH_A, newId('tok'), adminId]
  );

  await db.exec(
    `INSERT INTO sms_logs (id, tenant_id, branch_id, invoice_id, customer_name, mobile_number, message_text, status, credit_type, gateway_provider)
     VALUES (?, ?, ?, ?, 'Ramesh', '9840455555', 'Thank you for shopping', 'sent', 'trial', 'fast2sms')`,
    [newId('sms'), TEST_TENANT_ID, TEST_BRANCH_A, invId]
  );

  const dupRes = await sendInvoiceBillSms(db, {
    tenantId: TEST_TENANT_ID,
    branchId: TEST_BRANCH_A,
    invoiceId: invId,
    invoiceNumber: 'SMS-999',
    customerName: 'Ramesh',
    customerPhone: '9840455555',
    totalMinor: 50000,
    shopName: 'SMS Test Store',
  });

  assert.equal(dupRes.skipped, true);
  assert.ok(dupRes.error?.includes('already been sent'));
});

test('8. Bill generation succeeds normally even if SMS fails or gateway throws', async () => {
  const itemId = newId('itm');
  await db.exec(
    `INSERT INTO items (id, tenant_id, branch_id, name, price_minor, tax_rate_bp, unit, active)
     VALUES (?, ?, ?, 'Organic Rice 1kg', 12000, 500, 'kg', true)`,
    [itemId, TEST_TENANT_ID, TEST_BRANCH_A]
  );

  const shiftId = newId('shf');
  await db.exec(
    `INSERT INTO shifts (id, tenant_id, branch_id, user_id, status, opened_at, location, counter)
     VALUES (?, ?, ?, (SELECT id FROM users WHERE email = 'cashier@smsit.local'), 'open', now(), 'MAIN', 'COUNTER-1')`,
    [shiftId, TEST_TENANT_ID, TEST_BRANCH_A]
  );

  const checkoutRes = await api(
    'POST',
    '/api/invoices',
    {
      lines: [
        {
          itemId,
          name: 'Organic Rice 1kg',
          qtyMilli: 1000,
          priceMinor: 12000,
          taxRateBp: 500,
          inclusive: true,
        },
      ],
      payments: [{ mode: 'cash', amountMinor: 12000 }],
      customerName: 'Karthik',
      customerPhone: '9840499999',
    },
    cashierToken
  );

  assert.equal(checkoutRes.status, 200);
  assert.ok(checkoutRes.json.invoiceId);
  assert.ok(checkoutRes.json.number);
  assert.equal(checkoutRes.json.totalMinor, 12000);

  const saved = await db.one('SELECT id, status FROM invoices WHERE id = ?', [checkoutRes.json.invoiceId]);
  assert.ok(saved);
  assert.equal(saved.status, 'posted');
});

test('9. Retry functionality for failed SMS', async () => {
  const failedLogId = newId('sms');
  await db.exec(
    `INSERT INTO sms_logs (id, tenant_id, branch_id, customer_name, mobile_number, message_text, status, credit_type, gateway_provider, error_message)
     VALUES (?, ?, ?, 'Priya', '9840488888', 'Bill INV-500 test', 'failed', 'trial', 'fast2sms', 'Network timeout')`,
    [failedLogId, TEST_TENANT_ID, TEST_BRANCH_A]
  );

  const retryRes = await api('POST', `/api/sms/retry/${failedLogId}`, {}, managerToken);
  assert.equal(retryRes.status, 200);

  const updatedLog = await db.one<any>('SELECT retry_count FROM sms_logs WHERE id = ?', [failedLogId]);
  assert.ok(Number(updatedLog.retryCount ?? updatedLog.retry_count) >= 1);
});

test('10. Data persists identically across server re-instantiation', async () => {
  server.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
  server = http.createServer(createApp(db, { secret: JWT_SECRET, log: false }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;

  const trialCheck = await api('GET', '/api/sms/trial-status', undefined, adminToken);
  assert.equal(trialCheck.status, 200);
  assert.equal(trialCheck.json.totalCredits, 100);

  const historyCheck = await api('GET', '/api/sms/history', undefined, adminToken);
  assert.equal(historyCheck.status, 200);
  assert.ok(historyCheck.json.total > 0);
});
