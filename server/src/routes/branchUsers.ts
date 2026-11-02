import { requireUser } from '../auth.ts';
import { audit } from '../audit.ts';
import { bad, conflict, HttpError, notFound, V, type Router, type Ctx } from '../http.ts';
import { hashPassword, newId, verifyPassword } from '../security.ts';
import { parseEmail } from '../shopFields.ts';
import { j, type DB } from '../db/index.ts';
import { enqueueUserEmail, getOwnerEmailForTenant, enqueueDeletionAlertEmail } from '../services/mailer.ts';

/**
 * Resolves the logged-in Store Manager's branch strictly from their session/record.
 * Throws 403 NO_BRANCH if no branch is assigned.
 */
export async function requireStoreManagerBranch(ctx: Ctx): Promise<any> {
  requireUser(ctx);
  const user = ctx.user!;
  const role = user.role;

  if (role !== 'manager' && role !== 'owner' && (role as string) !== 'super_admin') {
    throw new HttpError(403, 'FORBIDDEN', 'Access denied. Only Store Managers can access this module.');
  }

  const tenantId = user.tenantId;

  // 1. Direct branchId on user
  if (user.branchId) {
    const br = await ctx.db.one<any>(
      'SELECT id, tenant_id, code, name, active, counters, manager_id FROM branches WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
      [user.branchId, tenantId],
    );
    if (br) return br;
  }

  // 2. Lookup by manager_id
  const brByMgr = await ctx.db.one<any>(
    'SELECT id, tenant_id, code, name, active, counters, manager_id FROM branches WHERE manager_id = ? AND tenant_id = ? AND deleted_at IS NULL',
    [user.id, tenantId],
  );
  if (brByMgr) return brByMgr;

  // 3. Lookup by assignedLocation code
  if (user.assignedLocation) {
    const brByCode = await ctx.db.one<any>(
      'SELECT id, tenant_id, code, name, active, counters, manager_id FROM branches WHERE code = ? AND tenant_id = ? AND deleted_at IS NULL',
      [user.assignedLocation, tenantId],
    );
    if (brByCode) return brByCode;
  }

  // 4. If super admin / owner, allow optional query parameter or pick first active branch
  if (role === 'owner' || (role as string) === 'super_admin') {
    if (ctx.query.branchId) {
      const qBr = await ctx.db.one<any>(
        'SELECT id, tenant_id, code, name, active, counters, manager_id FROM branches WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL',
        [ctx.query.branchId, tenantId],
      );
      if (qBr) return qBr;
    }
    const anyBr = await ctx.db.one<any>(
      "SELECT id, tenant_id, code, name, active, counters, manager_id FROM branches WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY code = 'SKS_POR' DESC, code = 'MAIN' DESC LIMIT 1",
      [tenantId],
    );
    if (anyBr) return anyBr;
  }

  // Manager has no branch assigned!
  throw new HttpError(403, 'NO_BRANCH', 'Waiting for branch assignment — contact your admin.');
}

/** Username format validation: 4-20 chars, a-z 0-9 . _ , cannot start/end with . or _ */
export function validateUsernameFormat(username: string): string | null {
  const u = username.trim().toLowerCase();
  if (u.length < 4 || u.length > 20) {
    return 'Use 4–20 letters, numbers, dot or underscore (not at the start or end).';
  }
  if (!/^[a-z0-9._]+$/.test(u)) {
    return 'Use 4–20 letters, numbers, dot or underscore (not at the start or end).';
  }
  if (u.startsWith('.') || u.startsWith('_') || u.endsWith('.') || u.endsWith('_')) {
    return 'Use 4–20 letters, numbers, dot or underscore (not at the start or end).';
  }
  return null;
}

/** Password strength validation: min 8 chars, at least one number, at least 3 of 4 rules met */
export function validatePasswordRules(pw: string): string | null {
  if (!pw || pw.length < 8) return 'Password must be at least 8 characters.';
  const hasUpper = /[A-Z]/.test(pw);
  const hasLower = /[a-z]/.test(pw);
  const hasNumber = /[0-9]/.test(pw);
  const hasSymbol = /[#@!$%&*]/.test(pw);

  if (!hasNumber) return 'Password must contain at least one number.';

  let score = 0;
  if (pw.length >= 8) score++;
  if (hasUpper && hasLower) score++;
  if (hasNumber) score++;
  if (hasSymbol) score++;

  if (score < 3) {
    return 'Password must satisfy at least 3 checklist requirements.';
  }
  return null;
}

/** Generates a strong 12-char password matching the spec */
export function generateStrongPassword(): string {
  const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lowers = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '#@!$%&*';
  const all = uppers + lowers + digits + symbols;

  let pwd = '';
  pwd += uppers[Math.floor(Math.random() * uppers.length)];
  pwd += lowers[Math.floor(Math.random() * lowers.length)];
  pwd += digits[Math.floor(Math.random() * digits.length)];
  pwd += symbols[Math.floor(Math.random() * symbols.length)];

  while (pwd.length < 12) {
    pwd += all[Math.floor(Math.random() * all.length)];
  }

  return pwd.split('').sort(() => 0.5 - Math.random()).join('');
}

export function registerBranchUsers(r: Router) {
  // -------------------------------------------------------------------------
  // 1. SUMMARY METRICS FOR STORE MANAGER'S BRANCH
  // -------------------------------------------------------------------------
  r.get('/api/branch/users/summary', async (ctx) => {
    ctx.res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const branch = await requireStoreManagerBranch(ctx);
    const tenantId = ctx.user!.tenantId;

    // Counters count in this branch
    const counters = await ctx.db.query<{ id: string; status: string }>(
      'SELECT id, status FROM counters WHERE tenant_id = ? AND branch_id = ?',
      [tenantId, branch.id],
    );
    const counterTotal = counters.length;
    const counterActive = counters.filter((c) => c.status === 'ACTIVE').length;
    const counterDisabled = counterTotal - counterActive;

    // Cashiers in this branch
    const cashiers = await ctx.db.query<{ id: string; status: string; counter_id: string | null }>(
      `SELECT id, status, counter_id FROM users WHERE tenant_id = ? AND branch_id = ? AND role = 'cashier' AND deleted_at IS NULL`,
      [tenantId, branch.id],
    );
    const cashierTotal = cashiers.length;
    const cashierActive = cashiers.filter((c) => c.status === 'ACTIVE').length;
    const cashierInvited = cashiers.filter((c) => c.status === 'INVITED').length;

    // Counters without cashier (no cashier has this counter set as default counter_id)
    const defaultCounterIds = new Set(cashiers.map((c: any) => c.counterId || c.counter_id).filter(Boolean));
    const countersWithoutCashier = counters.filter((c) => !defaultCounterIds.has(c.id)).length;

    return {
      branch: {
        id: branch.id,
        name: branch.name,
        code: branch.code,
        active: Boolean(branch.active),
      },
      counters: {
        total: counterTotal,
        active: counterActive,
        disabled: counterDisabled,
      },
      cashiers: {
        total: cashierTotal,
        active: cashierActive,
        invited: cashierInvited,
      },
      countersWithoutCashier,
    };
  });

  // -------------------------------------------------------------------------
  // 2. NEXT COUNTER CODE & SUGGESTED USERNAME
  // -------------------------------------------------------------------------
  r.get('/api/branch/counters/next-code', async (ctx) => {
    const branch = await requireStoreManagerBranch(ctx);
    const tenantId = ctx.user!.tenantId;

    const prefix = branch.code.includes('_') ? branch.code.split('_')[1] : branch.code;
    const shortPrefix = prefix.toUpperCase();

    // Query existing codes in this branch
    const rows = await ctx.db.query<{ code: string }>(
      'SELECT code FROM counters WHERE tenant_id = ? AND branch_id = ?',
      [tenantId, branch.id],
    );

    let maxNum = 0;
    const regex = new RegExp(`^${shortPrefix}-C0*([0-9]+)$`, 'i');
    for (const row of rows) {
      const match = row.code.match(regex);
      if (match) {
        const n = parseInt(match[1], 10);
        if (!isNaN(n) && n > maxNum) maxNum = n;
      }
    }

    const nextNum = maxNum + 1;
    const padded = nextNum < 10 ? `0${nextNum}` : `${nextNum}`;
    const code = `${shortPrefix}-C${padded}`;
    const suggestedUsername = `sks_${shortPrefix.toLowerCase()}_c${nextNum}`;

    return {
      code,
      suggestedUsername,
      prefix: shortPrefix,
    };
  });

  // -------------------------------------------------------------------------
  // 3. GET COUNTERS (Scoped to manager's branch)
  // -------------------------------------------------------------------------
  r.get('/api/branch/counters', async (ctx) => {
    ctx.res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const branch = await requireStoreManagerBranch(ctx);
    const tenantId = ctx.user!.tenantId;

    const search = ctx.query.search ? String(ctx.query.search).trim().toLowerCase() : '';
    const status = ctx.query.status ? String(ctx.query.status).trim().toUpperCase() : '';

    const counterRows = await ctx.db.query<any>(
      `SELECT c.id, c.name, c.code, c.login_username, c.status, c.last_active_at, c.created_at,
              u.email AS counter_email,
              el.status AS last_email_status, el.error_message AS last_email_error, el.sent_at AS last_email_sent_at
       FROM counters c
       LEFT JOIN users u ON u.counter_id = c.id AND u.role = 'counter' AND u.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT status, error_message, sent_at
         FROM email_logs
         WHERE user_id = u.id
         ORDER BY created_at DESC
         LIMIT 1
       ) el ON true
       WHERE c.tenant_id = ? AND c.branch_id = ?
       ORDER BY c.code ASC`,
      [tenantId, branch.id],
    );

    // Get all cashiers in this branch to map default counters
    const cashierRows = await ctx.db.query<{ name: string; counter_id: string | null }>(
      `SELECT name, counter_id FROM users WHERE tenant_id = ? AND branch_id = ? AND role = 'cashier' AND deleted_at IS NULL`,
      [tenantId, branch.id],
    );

    const cashierMap = new Map<string, string[]>();
    for (const c of cashierRows) {
      const cId = (c as any).counterId || (c as any).counter_id;
      if (cId) {
        if (!cashierMap.has(cId)) cashierMap.set(cId, []);
        cashierMap.get(cId)!.push(c.name);
      }
    }

    let counters = counterRows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      loginUsername: r.login_username || r.loginUsername || null,
      email: r.counter_email || null,
      status: r.status as 'ACTIVE' | 'DISABLED',
      lastActiveAt: r.last_active_at || r.lastActiveAt || null,
      cashiers: cashierMap.get(r.id) || [],
      createdAt: r.created_at || r.createdAt,
      lastEmailStatus: r.lastEmailStatus || r.last_email_status || null,
      lastEmailError: r.lastEmailError || r.last_email_error || null,
      lastEmailSentAt: r.lastEmailSentAt || r.last_email_sent_at || null,
    }));

    if (search) {
      counters = counters.filter((c) => {
        const mName = c.name.toLowerCase().includes(search);
        const mCode = c.code.toLowerCase().includes(search);
        const mUser = c.loginUsername ? c.loginUsername.toLowerCase().includes(search) : false;
        const mEmail = c.email ? c.email.toLowerCase().includes(search) : false;
        return mName || mCode || mUser || mEmail;
      });
    }

    if (status && status !== 'ALL') {
      counters = counters.filter((c) => c.status === status);
    }

    return { counters };
  });

  // -------------------------------------------------------------------------
  // 4. CREATE COUNTER (Scoped to manager's branch)
  // -------------------------------------------------------------------------
  r.post('/api/branch/counters', async (ctx) => {
    const branch = await requireStoreManagerBranch(ctx);
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};

    const name = V.str(b.name, 'Counter name', { required: true, max: 80 }).trim();
    if (name.length < 2) throw bad('Counter name must be at least 2 characters.', 'VALIDATION');

    const code = V.str(b.code, 'Counter code', { required: true, max: 20 }).trim().toUpperCase();
    if (!/^[A-Z0-9-]+$/.test(code) || code.length < 3 || code.length > 12) {
      throw bad('Counter code must be 3–12 uppercase letters, numbers or hyphens.', 'INVALID_CODE');
    }

    // Check code uniqueness within this branch
    const dupCode = await ctx.db.one(
      'SELECT id FROM counters WHERE tenant_id = ? AND branch_id = ? AND code = ?',
      [tenantId, branch.id, code],
    );
    if (dupCode) {
      throw conflict('A counter with this code already exists in your branch.', 'CODE_TAKEN');
    }

    let username = (b.username || b.loginUsername) ? String(b.username || b.loginUsername).trim().toLowerCase() : null;
    let email = b.email ? String(b.email).trim().toLowerCase() : null;

    if (!username && !email) {
      throw bad('Add a username, an email ID, or both to create a counter sign-in account.', 'VALIDATION');
    }

    if (username) {
      const uErr = validateUsernameFormat(username);
      if (uErr) throw bad(uErr, 'INVALID_USERNAME');

      const dupUser = await ctx.db.one('SELECT id FROM users WHERE tenant_id = ? AND lower(username) = ?', [tenantId, username]);
      if (dupUser) throw conflict('This username is already taken.', 'USERNAME_TAKEN');

      const dupCnt = await ctx.db.one('SELECT id FROM counters WHERE tenant_id = ? AND lower(login_username) = ?', [tenantId, username]);
      if (dupCnt) throw conflict('This username is already taken by another counter.', 'USERNAME_TAKEN');
    }

    if (email) {
      try {
        email = parseEmail(email);
      } catch {
        throw bad('Enter a valid email, like counter@store.com', 'INVALID_EMAIL');
      }
      const dupEmail = await ctx.db.one('SELECT id FROM users WHERE tenant_id = ? AND lower(email) = ?', [tenantId, email]);
      if (dupEmail) throw conflict('This email ID is already in use.', 'EMAIL_TAKEN');
    }

    const password = V.str(b.password, 'Password', { required: true, max: 128 });
    const pwErr = validatePasswordRules(password);
    if (pwErr) throw bad(pwErr, 'WEAK_PASSWORD');

    const sendEmail = Boolean(b.sendEmail && email);
    const mustChangePassword = b.mustChangePassword !== undefined ? Boolean(b.mustChangePassword) : true;

    const counterId = newId('cnt');
    const userId = newId('u');
    const passwordHash = hashPassword(password);

    await ctx.db.tx(async (q) => {
      // 1. Insert into counters
      await q.exec(
        `INSERT INTO counters (id, tenant_id, branch_id, name, code, login_username, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, now(), now())`,
        [counterId, tenantId, branch.id, name, code, username, ctx.user!.id],
      );

      // 2. Insert into users as counter account
      await q.exec(
        `INSERT INTO users (id, tenant_id, name, username, email, password_hash, role, status, active, branch_id, counter_id, must_change_password, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'counter', 'INVITED', true, ?, ?, ?, ?, now(), now())`,
        [userId, tenantId, name, username, email, passwordHash, branch.id, counterId, mustChangePassword, ctx.user!.id],
      );

      await audit(q, ctx, {
        action: 'counter.create',
        entity: 'counter',
        entityId: counterId,
        detail: { name, code, username, email, branchId: branch.id, sendEmail },
      });
    });

    if (sendEmail && email) {
      await enqueueUserEmail(ctx.db, {
        tenantId,
        userId: userId,
        toEmail: email,
        type: 'WELCOME',
        createdBy: ctx.user!.id,
        templateData: {
          name,
          roleName: 'Counter account',
          branchName: branch.name,
          branchCode: branch.code,
          username,
          email,
          password,
          mustChangePassword,
        },
      });
    }

    return {
      ok: true,
      id: counterId,
      name,
      code,
      loginUsername: username,
      email,
      status: 'ACTIVE',
      emailSent: sendEmail,
      emailQueued: sendEmail,
    };
  });

  // -------------------------------------------------------------------------
  // 5. EDIT COUNTER (Scoped to manager's branch)
  // -------------------------------------------------------------------------
  r.patch('/api/branch/counters/:id', async (ctx) => {
    const branch = await requireStoreManagerBranch(ctx);
    const tenantId = ctx.user!.tenantId;
    const counterId = ctx.params.id;
    const b = ctx.body ?? {};

    const existing = await ctx.db.one<any>(
      'SELECT * FROM counters WHERE id = ? AND tenant_id = ? AND branch_id = ?',
      [counterId, tenantId, branch.id],
    );
    if (!existing) throw notFound('Counter');

    const name = b.name !== undefined ? V.str(b.name, 'Counter name', { required: true, max: 80 }).trim() : existing.name;
    const code = b.code !== undefined ? V.str(b.code, 'Counter code', { required: true, max: 20 }).trim().toUpperCase() : existing.code;

    if (code !== existing.code) {
      if (!/^[A-Z0-9-]+$/.test(code) || code.length < 3 || code.length > 12) {
        throw bad('Counter code must be 3–12 uppercase letters, numbers or hyphens.', 'INVALID_CODE');
      }
      const dup = await ctx.db.one(
        'SELECT id FROM counters WHERE tenant_id = ? AND branch_id = ? AND code = ? AND id != ?',
        [tenantId, branch.id, code, counterId],
      );
      if (dup) throw conflict('A counter with this code already exists in your branch.', 'CODE_TAKEN');
    }

    const linkedUser = await ctx.db.one<any>(
      `SELECT * FROM users WHERE counter_id = ? AND tenant_id = ? AND role = 'counter' AND deleted_at IS NULL`,
      [counterId, tenantId],
    );

    const rawUsername = b.username !== undefined ? b.username : b.loginUsername;
    let username = rawUsername !== undefined ? (rawUsername ? String(rawUsername).trim().toLowerCase() : null) : (existing.login_username || linkedUser?.username);
    let email = b.email !== undefined ? (b.email ? String(b.email).trim().toLowerCase() : null) : linkedUser?.email;

    if (username && username !== existing.login_username) {
      const uErr = validateUsernameFormat(username);
      if (uErr) throw bad(uErr, 'INVALID_USERNAME');

      const dupU = await ctx.db.one(
        'SELECT id FROM users WHERE tenant_id = ? AND lower(username) = ? AND id != ?',
        [tenantId, username, linkedUser?.id || ''],
      );
      if (dupU) throw conflict('This username is already taken.', 'USERNAME_TAKEN');
    }

    if (email && email !== linkedUser?.email) {
      try {
        email = parseEmail(email);
      } catch {
        throw bad('Enter a valid email, like counter@store.com', 'INVALID_EMAIL');
      }
      const dupE = await ctx.db.one(
        'SELECT id FROM users WHERE tenant_id = ? AND lower(email) = ? AND id != ?',
        [tenantId, email, linkedUser?.id || ''],
      );
      if (dupE) throw conflict('This email ID is already in use.', 'EMAIL_TAKEN');
    }

    await ctx.db.tx(async (q) => {
      await q.exec(
        'UPDATE counters SET name = ?, code = ?, login_username = ?, updated_at = now() WHERE id = ?',
        [name, code, username, counterId],
      );

      if (linkedUser) {
        await q.exec(
          'UPDATE users SET name = ?, username = ?, email = ?, updated_at = now() WHERE id = ?',
          [name, username, email, linkedUser.id],
        );
      }

      await audit(q, ctx, {
        action: 'counter.update',
        entity: 'counter',
        entityId: counterId,
        detail: { name, code, username, email },
      });
    });

    return { ok: true, id: counterId, name, code, loginUsername: username, email };
  });

  // -------------------------------------------------------------------------
  // 6. GET CASHIERS (Scoped to manager's branch)
  // -------------------------------------------------------------------------
  r.get('/api/branch/cashiers', async (ctx) => {
    ctx.res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const branch = await requireStoreManagerBranch(ctx);
    const tenantId = ctx.user!.tenantId;

    const search = ctx.query.search ? String(ctx.query.search).trim().toLowerCase() : '';
    const status = ctx.query.status ? String(ctx.query.status).trim().toUpperCase() : '';

    const rows = await ctx.db.query<any>(
      `SELECT u.id, u.name, u.username, u.email, u.phone, u.status, u.last_login_at, u.created_at,
              c.id AS counter_id, c.name AS counter_name, c.code AS counter_code,
              el.status AS last_email_status, el.error_message AS last_email_error, el.sent_at AS last_email_sent_at
       FROM users u
       LEFT JOIN counters c ON c.id = u.counter_id
       LEFT JOIN LATERAL (
         SELECT status, error_message, sent_at
         FROM email_logs
         WHERE user_id = u.id
         ORDER BY created_at DESC
         LIMIT 1
       ) el ON true
       WHERE u.tenant_id = ? AND u.branch_id = ? AND u.role = 'cashier' AND u.deleted_at IS NULL
       ORDER BY u.name ASC`,
      [tenantId, branch.id],
    );

    let cashiers = rows.map((r: any) => {
      const cntId = r.counterId || r.counter_id;
      const cntName = r.counterName || r.counter_name;
      const cntCode = r.counterCode || r.counter_code;
      return {
        id: r.id,
        name: r.name,
        username: r.username || null,
        email: r.email || null,
        phone: r.phone || null,
        defaultCounter: cntId ? { id: cntId, name: cntName, code: cntCode } : null,
        status: (r.status as 'ACTIVE' | 'INVITED' | 'DISABLED') || 'ACTIVE',
        lastLoginAt: r.last_login_at || r.lastLoginAt || null,
        createdAt: r.created_at || r.createdAt,
      };
    });

    if (search) {
      cashiers = cashiers.filter((c) => {
        const mName = c.name.toLowerCase().includes(search);
        const mUser = c.username ? c.username.toLowerCase().includes(search) : false;
        const mEmail = c.email ? c.email.toLowerCase().includes(search) : false;
        const mCnt = c.defaultCounter
          ? c.defaultCounter.name.toLowerCase().includes(search) || c.defaultCounter.code.toLowerCase().includes(search)
          : false;
        return mName || mUser || mEmail || mCnt;
      });
    }

    if (status && status !== 'ALL') {
      cashiers = cashiers.filter((c) => c.status === status);
    }

    return { cashiers };
  });

  // -------------------------------------------------------------------------
  // 7. CREATE CASHIER (Scoped to manager's branch)
  // -------------------------------------------------------------------------
  r.post('/api/branch/cashiers', async (ctx) => {
    const branch = await requireStoreManagerBranch(ctx);
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};

    const name = V.str(b.name, 'Full name', { required: true, max: 80 }).trim();
    if (name.length < 2) throw bad('Full name must be at least 2 characters.', 'VALIDATION');

    let username = (b.username || b.loginUsername) ? String(b.username || b.loginUsername).trim().toLowerCase() : null;
    let email = b.email ? String(b.email).trim().toLowerCase() : null;

    if (!username && !email) {
      throw bad('Add a username, an email ID, or both to create a cashier sign-in account.', 'VALIDATION');
    }

    if (username) {
      const uErr = validateUsernameFormat(username);
      if (uErr) throw bad(uErr, 'INVALID_USERNAME');

      const dupUser = await ctx.db.one('SELECT id FROM users WHERE tenant_id = ? AND lower(username) = ?', [tenantId, username]);
      if (dupUser) throw conflict('This username is already taken.', 'USERNAME_TAKEN');

      const dupCnt = await ctx.db.one('SELECT id FROM counters WHERE tenant_id = ? AND lower(login_username) = ?', [tenantId, username]);
      if (dupCnt) throw conflict('This username is already taken by a counter.', 'USERNAME_TAKEN');
    }

    if (email) {
      try {
        email = parseEmail(email);
      } catch {
        throw bad('Enter a valid email, like name@store.com', 'INVALID_EMAIL');
      }
      const dupEmail = await ctx.db.one('SELECT id FROM users WHERE tenant_id = ? AND lower(email) = ?', [tenantId, email]);
      if (dupEmail) throw conflict('This email ID is already in use.', 'EMAIL_TAKEN');
    }

    const password = V.str(b.password, 'Password', { required: true, max: 128 });
    const pwErr = validatePasswordRules(password);
    if (pwErr) throw bad(pwErr, 'WEAK_PASSWORD');

    const defaultCounterId = b.defaultCounterId ? String(b.defaultCounterId).trim() : null;
    if (defaultCounterId) {
      const cnt = await ctx.db.one<any>(
        'SELECT id, status FROM counters WHERE id = ? AND branch_id = ? AND tenant_id = ?',
        [defaultCounterId, branch.id, tenantId],
      );
      if (!cnt) throw notFound('Default Counter');
      if (cnt.status === 'DISABLED') {
        throw bad('Cannot assign a disabled counter as default counter.', 'VALIDATION');
      }
    }

    const phone = b.phone ? String(b.phone).trim() : null;
    const sendEmail = Boolean(b.sendEmail && email);
    const mustChangePassword = b.mustChangePassword !== undefined ? Boolean(b.mustChangePassword) : true;

    const cashierId = newId('u');
    const passwordHash = hashPassword(password);

    await ctx.db.tx(async (q) => {
      await q.exec(
        `INSERT INTO users (id, tenant_id, name, username, email, phone, password_hash, role, status, active, branch_id, counter_id, must_change_password, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'cashier', 'INVITED', true, ?, ?, ?, ?, now(), now())`,
        [cashierId, tenantId, name, username, email, phone, passwordHash, branch.id, defaultCounterId, mustChangePassword, ctx.user!.id],
      );

      await audit(q, ctx, {
        action: 'cashier.create',
        entity: 'user',
        entityId: cashierId,
        detail: { name, username, email, branchId: branch.id, defaultCounterId, sendEmail },
      });
    });

    return {
      ok: true,
      id: cashierId,
      name,
      username,
      email,
      phone,
      defaultCounterId,
      status: 'INVITED',
      emailSent: sendEmail,
    };
  });

  // -------------------------------------------------------------------------
  // 8. EDIT CASHIER (Scoped to manager's branch)
  // -------------------------------------------------------------------------
  r.patch('/api/branch/cashiers/:id', async (ctx) => {
    const branch = await requireStoreManagerBranch(ctx);
    const tenantId = ctx.user!.tenantId;
    const cashierId = ctx.params.id;
    const b = ctx.body ?? {};

    const existing = await ctx.db.one<any>(
      `SELECT * FROM users WHERE id = ? AND tenant_id = ? AND branch_id = ? AND role = 'cashier' AND deleted_at IS NULL`,
      [cashierId, tenantId, branch.id],
    );
    if (!existing) throw notFound('Cashier');

    const name = b.name !== undefined ? V.str(b.name, 'Full name', { required: true, max: 80 }).trim() : existing.name;
    let username = b.username !== undefined ? (b.username ? String(b.username).trim().toLowerCase() : null) : existing.username;
    let email = b.email !== undefined ? (b.email ? String(b.email).trim().toLowerCase() : null) : existing.email;

    if (!username && !email) {
      throw bad('A cashier must have at least a username or an email ID.', 'VALIDATION');
    }

    if (username && username !== existing.username) {
      const uErr = validateUsernameFormat(username);
      if (uErr) throw bad(uErr, 'INVALID_USERNAME');

      const dupU = await ctx.db.one(
        'SELECT id FROM users WHERE tenant_id = ? AND lower(username) = ? AND id != ?',
        [tenantId, username, cashierId],
      );
      if (dupU) throw conflict('This username is already taken.', 'USERNAME_TAKEN');
    }

    if (email && email !== existing.email) {
      try {
        email = parseEmail(email);
      } catch {
        throw bad('Enter a valid email, like name@store.com', 'INVALID_EMAIL');
      }
      const dupE = await ctx.db.one(
        'SELECT id FROM users WHERE tenant_id = ? AND lower(email) = ? AND id != ?',
        [tenantId, email, cashierId],
      );
      if (dupE) throw conflict('This email ID is already in use.', 'EMAIL_TAKEN');
    }

    let counterId = existing.counter_id;
    if (b.defaultCounterId !== undefined) {
      counterId = b.defaultCounterId ? String(b.defaultCounterId).trim() : null;
      if (counterId) {
        const cnt = await ctx.db.one<any>(
          'SELECT id, status FROM counters WHERE id = ? AND branch_id = ? AND tenant_id = ?',
          [counterId, branch.id, tenantId],
        );
        if (!cnt) throw notFound('Default Counter');
        if (cnt.status === 'DISABLED') {
          throw bad('Cannot assign a disabled counter as default counter.', 'VALIDATION');
        }
      }
    }

    const phone = b.phone !== undefined ? (b.phone ? String(b.phone).trim() : null) : existing.phone;

    await ctx.db.tx(async (q) => {
      await q.exec(
        'UPDATE users SET name = ?, username = ?, email = ?, phone = ?, counter_id = ?, updated_at = now() WHERE id = ?',
        [name, username, email, phone, counterId, cashierId],
      );

      await audit(q, ctx, {
        action: 'cashier.update',
        entity: 'user',
        entityId: cashierId,
        detail: { name, username, email, defaultCounterId: counterId, phone },
      });
    });

    return { ok: true, id: cashierId, name, username, email, phone, defaultCounterId: counterId };
  });

  // -------------------------------------------------------------------------
  // 9. RESET PASSWORD (Scoped to manager's branch: counter or cashier)
  // -------------------------------------------------------------------------
  r.post('/api/branch/users/:id/reset-password', async (ctx) => {
    const branch = await requireStoreManagerBranch(ctx);
    const tenantId = ctx.user!.tenantId;
    const targetId = ctx.params.id;

    // Check if target is a counter in counters table
    const targetCounter = await ctx.db.one<any>(
      'SELECT id, name, login_username FROM counters WHERE id = ? AND tenant_id = ? AND branch_id = ?',
      [targetId, tenantId, branch.id],
    );

    let targetUser: any = null;
    let isCounter = false;

    if (targetCounter) {
      isCounter = true;
      targetUser = await ctx.db.one<any>(
        `SELECT id, name, username, email, role FROM users WHERE counter_id = ? AND tenant_id = ? AND role = 'counter' AND deleted_at IS NULL`,
        [targetCounter.id, tenantId],
      );
    } else {
      // Check if target is a cashier in users table
      targetUser = await ctx.db.one<any>(
        `SELECT id, name, username, email, role FROM users WHERE id = ? AND tenant_id = ? AND branch_id = ? AND role = 'cashier' AND deleted_at IS NULL`,
        [targetId, tenantId, branch.id],
      );
    }

    if (!targetUser) throw notFound('User / Counter');

    const tempPassword = generateStrongPassword();
    const passwordHash = hashPassword(tempPassword);
    const forceChange = true; // Both counters and cashiers must change on next login

    await ctx.db.tx(async (q) => {
      await q.exec(
        'UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = now() WHERE id = ?',
        [passwordHash, forceChange, targetUser.id],
      );

      await audit(q, ctx, {
        action: 'user.reset_password',
        entity: 'user',
        entityId: targetUser.id,
        detail: { targetName: targetUser.name, isCounter, branchId: branch.id },
      });
    });

    let emailQueued = false;
    if (targetUser.email && ctx.body?.sendEmail !== false) {
      const roleName = targetUser.role === 'counter' ? 'Counter account' : 'Cashier';
      await enqueueUserEmail(ctx.db, {
        tenantId,
        userId: targetUser.id,
        toEmail: targetUser.email,
        type: 'RESET_PASSWORD',
        createdBy: ctx.user!.id,
        templateData: {
          name: targetUser.name,
          roleName,
          branchName: branch.name,
          branchCode: branch.code,
          username: targetUser.username,
          email: targetUser.email,
          password: tempPassword,
          mustChangePassword: true,
        },
      });
      emailQueued = true;
    }

    return {
      ok: true,
      temporaryPassword: tempPassword,
      emailQueued,
      user: {
        id: targetUser.id,
        name: targetUser.name,
        email: targetUser.email,
        username: targetUser.username,
      },
    };
  });

  // -------------------------------------------------------------------------
  // 10. STATUS CHANGE (ACTIVE / DISABLED) - Scoped to manager's branch
  // -------------------------------------------------------------------------
  r.patch('/api/branch/users/:id/status', async (ctx) => {
    const branch = await requireStoreManagerBranch(ctx);
    const tenantId = ctx.user!.tenantId;
    const targetId = ctx.params.id;
    const rawStatus = V.str(ctx.body?.status, 'Status', { required: true }).trim().toUpperCase();
    if (rawStatus !== 'ACTIVE' && rawStatus !== 'DISABLED') {
      throw bad('Status must be ACTIVE or DISABLED', 'VALIDATION');
    }
    const nextStatus = rawStatus as 'ACTIVE' | 'DISABLED';

    // Check if counter
    const counter = await ctx.db.one<any>(
      'SELECT id, name FROM counters WHERE id = ? AND tenant_id = ? AND branch_id = ?',
      [targetId, tenantId, branch.id],
    );

    if (counter) {
      await ctx.db.tx(async (q) => {
        await q.exec('UPDATE counters SET status = ?, updated_at = now() WHERE id = ?', [nextStatus, targetId]);
        const active = nextStatus === 'ACTIVE';
        await q.exec(
          `UPDATE users SET status = ?, active = ?, updated_at = now() WHERE counter_id = ? AND role = 'counter'`,
          [nextStatus, active, targetId],
        );
        await audit(q, ctx, {
          action: active ? 'counter.enable' : 'counter.disable',
          entity: 'counter',
          entityId: targetId,
          detail: { name: counter.name, status: nextStatus },
        });
      });
      return { ok: true, id: targetId, status: nextStatus };
    }

    // Check if cashier
    const cashier = await ctx.db.one<any>(
      `SELECT id, name, last_login_at FROM users WHERE id = ? AND tenant_id = ? AND branch_id = ? AND role = 'cashier' AND deleted_at IS NULL`,
      [targetId, tenantId, branch.id],
    );
    if (!cashier) throw notFound('User / Counter');

    let finalStatus: 'ACTIVE' | 'INVITED' | 'DISABLED' = nextStatus;
    const active = nextStatus === 'ACTIVE';
    if (active && !cashier.last_login_at) {
      finalStatus = 'INVITED';
    }

    await ctx.db.tx(async (q) => {
      await q.exec('UPDATE users SET status = ?, active = ?, updated_at = now() WHERE id = ?', [finalStatus, active, targetId]);
      await audit(q, ctx, {
        action: active ? 'user.enable' : 'user.disable',
        entity: 'user',
        entityId: targetId,
        detail: { name: cashier.name, status: finalStatus },
      });
    });

    return { ok: true, id: targetId, status: finalStatus, active };
  });

  // -------------------------------------------------------------------------
  // 11. CHECK USERNAME & EMAIL (Universal availability across all system users)
  // -------------------------------------------------------------------------
  r.get('/api/users/check-username', async (ctx) => {
    requireUser(ctx);
    const tenantId = ctx.user!.tenantId;
    const username = V.str(ctx.query.username, 'Username', { required: true }).trim().toLowerCase();
    const excludeId = ctx.query.excludeId ? String(ctx.query.excludeId) : null;

    const fmtErr = validateUsernameFormat(username);
    if (fmtErr) {
      return { available: false, error: fmtErr };
    }

    let userQuery = 'SELECT id FROM users WHERE tenant_id = ? AND lower(username) = ?';
    const params: unknown[] = [tenantId, username];
    if (excludeId) {
      userQuery += ' AND id != ?';
      params.push(excludeId);
    }
    const existingUser = await ctx.db.one(userQuery, params);
    if (existingUser) return { available: false, error: 'This username is already taken.' };

    const existingCounter = await ctx.db.one(
      'SELECT id FROM counters WHERE tenant_id = ? AND lower(login_username) = ?',
      [tenantId, username],
    );
    if (existingCounter && existingCounter.id !== excludeId) {
      return { available: false, error: 'This username is already taken.' };
    }

    return { available: true };
  });

  r.get('/api/users/check-email', async (ctx) => {
    requireUser(ctx);
    const tenantId = ctx.user!.tenantId;
    const rawEmail = V.str(ctx.query.email, 'Email', { required: true }).trim().toLowerCase();
    const excludeId = ctx.query.excludeId ? String(ctx.query.excludeId) : null;

    let email = '';
    try {
      email = parseEmail(rawEmail);
    } catch {
      return { available: false, error: 'Enter a valid email, like name@store.com' };
    }

    let userQuery = 'SELECT id FROM users WHERE tenant_id = ? AND lower(email) = ?';
    const params: unknown[] = [tenantId, email];
    if (excludeId) {
      userQuery += ' AND id != ?';
      params.push(excludeId);
    }
    const existing = await ctx.db.one(userQuery, params);
    if (existing) return { available: false, error: 'This email ID is already in use.' };

    return { available: true };
  });
  // -------------------------------------------------------------------------
  // RESEND CREDENTIALS (STORE MANAGER - own branch only)
  // -------------------------------------------------------------------------
  r.post('/api/branch/users/:id/resend', async (ctx) => {
    const branch = await requireStoreManagerBranch(ctx);
    const tenantId = ctx.user!.tenantId;
    const userId = ctx.params.id;

    const user = await ctx.db.one<any>(
      `SELECT * FROM users
       WHERE id = ? AND tenant_id = ? AND branch_id = ? AND deleted_at IS NULL`,
      [userId, tenantId, branch.id],
    );
    if (!user) throw notFound('User / Counter not found');
    if (!user.email) throw bad('This account does not have an email address.', 'NO_EMAIL');

    const tempPassword = generateStrongPassword();
    const hash = hashPassword(tempPassword);

    await ctx.db.exec(
      'UPDATE users SET password_hash = ?, must_change_password = true, updated_at = now() WHERE id = ?',
      [hash, user.id],
    );

    const roleName = user.role === 'counter' ? 'Counter account' : 'Cashier';

    await enqueueUserEmail(ctx.db, {
      tenantId,
      userId: user.id,
      toEmail: user.email,
      type: 'RESEND',
      createdBy: ctx.user!.id,
      templateData: {
        name: user.name,
        roleName,
        branchName: branch.name,
        branchCode: branch.code,
        username: user.username,
        email: user.email,
        password: tempPassword,
        mustChangePassword: true,
      },
    });

    await audit(ctx.db, ctx, {
      action: 'branch_user.resend_credentials',
      entity: 'user',
      entityId: user.id,
      detail: { name: user.name, email: user.email, role: user.role, branchId: branch.id },
    });

    return {
      ok: true,
      temporaryPassword: tempPassword,
      emailQueued: true,
      toEmail: user.email,
    };
  });

  // -------------------------------------------------------------------------
  // DELETE IMPACT & DELETE: COUNTER (Store Manager - own branch only)
  // -------------------------------------------------------------------------
  r.get('/api/branch/counters/:id/delete-impact', async (ctx) => {
    const branch = await requireStoreManagerBranch(ctx);
    const tenantId = ctx.user!.tenantId;
    const counterId = ctx.params.id;

    const cnt = await ctx.db.one<any>(
      'SELECT * FROM counters WHERE id = ? AND tenant_id = ? AND branch_id = ?',
      [counterId, tenantId, branch.id],
    );
    if (!cnt) throw notFound('Counter');

    const defaultCashiers = await ctx.db.query<any>(
      `SELECT id, name FROM users WHERE counter_id = ? AND tenant_id = ? AND branch_id = ? AND role = 'cashier' AND deleted_at IS NULL`,
      [cnt.id, tenantId, branch.id],
    );

    return {
      name: cnt.name,
      code: cnt.code,
      loginUsername: cnt.login_username || cnt.loginUsername || null,
      defaultCashiersCount: defaultCashiers.length,
    };
  });

  r.delete('/api/branch/counters/:id', async (ctx) => {
    const branch = await requireStoreManagerBranch(ctx);
    const tenantId = ctx.user!.tenantId;
    const counterId = ctx.params.id;

    const cnt = await ctx.db.one<any>(
      'SELECT * FROM counters WHERE id = ? AND tenant_id = ? AND branch_id = ?',
      [counterId, tenantId, branch.id],
    );
    if (!cnt) throw notFound('Counter');

    let defaultCashiersCount = 0;
    await ctx.db.tx(async (q) => {
      const defaultCashiers = await q.query<any>(
        `SELECT id, name FROM users WHERE counter_id = ? AND tenant_id = ? AND branch_id = ?`,
        [cnt.id, tenantId, branch.id],
      );
      defaultCashiersCount = defaultCashiers.length;

      // 1. Audit BEFORE deleting
      await audit(q, ctx, {
        action: 'DELETE',
        entity: 'counter',
        entityId: cnt.id,
        detail: { name: cnt.name, code: cnt.code, branchId: branch.id, cashiersCount: defaultCashiers.length },
      });

      // 2. Snapshot counter name into bills, payments, and shifts
      const cName = cnt.name || cnt.code;
      await q.exec('UPDATE invoices SET counter_name_snapshot = COALESCE(counter_name_snapshot, ?) WHERE counter = ? OR counter = ?', [cName, cnt.code, cnt.name]);
      await q.exec('UPDATE payments SET counter_name_snapshot = COALESCE(counter_name_snapshot, ?) WHERE counter = ? OR counter = ?', [cName, cnt.code, cnt.name]);
      await q.exec('UPDATE shifts SET counter_name_snapshot = COALESCE(counter_name_snapshot, ?) WHERE counter = ? OR counter = ?', [cName, cnt.code, cnt.name]);

      // 3. Reset cashiers default counter to NULL
      await q.exec('UPDATE users SET counter_id = NULL WHERE counter_id = ? AND branch_id = ?', [cnt.id, branch.id]);

      // 4. Delete linked counter login users
      const linked = await q.query<any>(
        `SELECT id FROM users WHERE counter_id = ? OR (tenant_id = ? AND branch_id = ? AND role = 'counter' AND (lower(username) = lower(?) OR lower(name) = lower(?)))`,
        [cnt.id, tenantId, branch.id, cnt.login_username || cnt.loginUsername || '', cnt.name],
      );
      for (const lu of linked) {
        await q.exec('DELETE FROM email_logs WHERE user_id = ?', [lu.id]);
        await q.exec('DELETE FROM users WHERE id = ?', [lu.id]);
      }

      // 5. Delete counter
      await q.exec('DELETE FROM counters WHERE id = ? AND tenant_id = ? AND branch_id = ?', [cnt.id, tenantId, branch.id]);
    });

    // Send alert email to store owner
    try {
      const ownerEmail = await getOwnerEmailForTenant(ctx.db, tenantId);
      if (ownerEmail) {
        await enqueueDeletionAlertEmail(ctx.db, {
          tenantId,
          toEmail: ownerEmail,
          entityType: 'counter',
          entityName: cnt.name,
          entityCode: cnt.code,
          branchName: `${branch.name} (${branch.code})`,
          deletedByUserId: ctx.user!.id,
          deletedByUserName: ctx.user!.name,
          deletedByUserRole: ctx.user!.role,
          impactDetails: {
            cashiersCount: defaultCashiersCount,
          },
        });
      }
    } catch (err: any) {
      console.warn('[Branch Counter Delete] Failed to enqueue deletion alert email:', err.message);
    }

    return { success: true, id: cnt.id, ok: true, deleted: cnt.id, name: cnt.name };
  });

  // -------------------------------------------------------------------------
  // DELETE IMPACT & DELETE: CASHIER (Store Manager - own branch only)
  // -------------------------------------------------------------------------
  r.get('/api/branch/cashiers/:id/delete-impact', async (ctx) => {
    const branch = await requireStoreManagerBranch(ctx);
    const tenantId = ctx.user!.tenantId;
    const cashierId = ctx.params.id;

    const csh = await ctx.db.one<any>(
      `SELECT id, name FROM users WHERE id = ? AND tenant_id = ? AND branch_id = ? AND role = 'cashier' AND deleted_at IS NULL`,
      [cashierId, tenantId, branch.id],
    );
    if (!csh) throw notFound('Cashier');

    return {
      name: csh.name,
    };
  });

  r.delete('/api/branch/cashiers/:id', async (ctx) => {
    const branch = await requireStoreManagerBranch(ctx);
    const tenantId = ctx.user!.tenantId;
    const cashierId = ctx.params.id;

    if (cashierId === ctx.user!.id) {
      throw conflict('You cannot delete your own account.', 'CANNOT_DELETE_SELF');
    }

    const csh = await ctx.db.one<any>(
      `SELECT * FROM users WHERE id = ? AND tenant_id = ? AND branch_id = ? AND role = 'cashier' AND deleted_at IS NULL`,
      [cashierId, tenantId, branch.id],
    );
    if (!csh) throw notFound('Cashier');

    await ctx.db.tx(async (q) => {
      // 1. Audit BEFORE deleting
      await audit(q, ctx, {
        action: 'DELETE',
        entity: 'user',
        entityId: csh.id,
        detail: { name: csh.name, email: csh.email, role: 'cashier', branchId: branch.id },
      });

      // 2. Snapshot cashier name into bills, payments, and shifts
      await q.exec('UPDATE invoices SET cashier_name_snapshot = COALESCE(cashier_name_snapshot, ?) WHERE created_by = ?', [csh.name, csh.id]);
      await q.exec('UPDATE payments SET cashier_name_snapshot = COALESCE(cashier_name_snapshot, ?) WHERE created_by = ? OR user_id = ?', [csh.name, csh.id, csh.id]);
      await q.exec('UPDATE shifts SET cashier_name_snapshot = COALESCE(cashier_name_snapshot, ?) WHERE user_id = ?', [csh.name, csh.id]);

      // 3. Clear non-cascading references
      await q.exec('UPDATE invoices SET whatsapp_last_sent_by = NULL WHERE whatsapp_last_sent_by = ?', [csh.id]);
      await q.exec('UPDATE shifts SET closed_by = NULL WHERE closed_by = ?', [csh.id]);
      await q.exec('UPDATE shifts SET reviewed_by = NULL WHERE reviewed_by = ?', [csh.id]);
      await q.exec('DELETE FROM email_logs WHERE user_id = ?', [csh.id]);

      // 4. Delete cashier
      await q.exec('DELETE FROM users WHERE id = ? AND tenant_id = ? AND branch_id = ?', [csh.id, tenantId, branch.id]);
    });

    // Send alert email to store owner
    try {
      const ownerEmail = await getOwnerEmailForTenant(ctx.db, tenantId);
      if (ownerEmail) {
        await enqueueDeletionAlertEmail(ctx.db, {
          tenantId,
          toEmail: ownerEmail,
          entityType: 'cashier',
          entityName: csh.name,
          entityCode: csh.username || csh.email,
          branchName: `${branch.name} (${branch.code})`,
          deletedByUserId: ctx.user!.id,
          deletedByUserName: ctx.user!.name,
          deletedByUserRole: ctx.user!.role,
        });
      }
    } catch (err: any) {
      console.warn('[Branch Cashier Delete] Failed to enqueue deletion alert email:', err.message);
    }

    return { success: true, id: csh.id, ok: true, deleted: csh.id, name: csh.name };
  });

}