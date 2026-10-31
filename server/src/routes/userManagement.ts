import { requireUser } from '../auth.ts';
import { audit } from '../audit.ts';
import { bad, conflict, HttpError, notFound, V, type Router, type Ctx } from '../http.ts';
import { hashPassword, newId, verifyPassword } from '../security.ts';
import { parseEmail } from '../shopFields.ts';
import { j, type DB } from '../db/index.ts';
import { enqueueUserEmail, sendTestEmail, getOwnerEmailForTenant, enqueueDeletionAlertEmail } from '../services/mailer.ts';

/**
 * Super Admin check: only 'owner' or 'super_admin' roles have access.
 */
function requireSuperAdmin(ctx: Ctx) {
  requireUser(ctx);
  const role = ctx.user!.role;
  if (role !== 'owner' && (role as string) !== 'super_admin') {
    throw new HttpError(403, 'FORBIDDEN', 'Access denied. Only Super Admin can access User Management.');
  }
}

/** Username format validation: 4-20 chars, a-z 0-9 . _ , cannot start/end with . or _ */
function validateUsernameFormat(username: string): string | null {
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
function validatePasswordRules(pw: string): string | null {
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

  // Shuffle
  return pwd.split('').sort(() => 0.5 - Math.random()).join('');
}

/** Ensure demo sample data exists for the current tenant matching the screenshots */
async function ensureDemoData(db: DB, tenantId: string) {
  const branchCount = await db.one<{ count: number }>(
    'SELECT count(*)::int as count FROM branches WHERE tenant_id = ? AND deleted_at IS NULL',
    [tenantId],
  );

  if (!branchCount || branchCount.count === 0) {
    // 1. Create SKS_MAIN branch (inactive, no manager)
    const brMainId = newId('br');
    await db.exec(
      `INSERT INTO branches (id, tenant_id, code, name, active, counters, manager_id, created_at)
       VALUES (?, ?, 'MAIN', 'SKS_MAIN', false, '["MAIN-C01"]'::jsonb, null, '2026-10-24T10:00:00Z')
       ON CONFLICT (tenant_id, code) DO NOTHING`,
      [brMainId, tenantId],
    );

    // 2. Create Shree Krishna-PORUR branch (active, with manager)
    const brPorId = newId('br');
    await db.exec(
      `INSERT INTO branches (id, tenant_id, code, name, active, counters, manager_id, created_at)
       VALUES (?, ?, 'SKS_POR', 'Shree Krishna–PORUR', true, '["POR-C01"]'::jsonb, null, '2026-10-29T10:00:00Z')
       ON CONFLICT (tenant_id, code) DO NOTHING`,
      [brPorId, tenantId],
    );
  }

  // Check managers
  const mgrCount = await db.one<{ count: number }>(
    `SELECT count(*)::int as count FROM users WHERE tenant_id = ? AND role = 'manager' AND deleted_at IS NULL`,
    [tenantId],
  );

  if (!mgrCount || mgrCount.count === 0) {
    const porBranch = await db.one<{ id: string }>(
      `SELECT id FROM branches WHERE tenant_id = ? AND code = 'SKS_POR'`,
      [tenantId],
    );

    // Create Karthik Raman
    const uKarthikId = newId('u');
    const hash = hashPassword('Password123!');
    await db.exec(
      `INSERT INTO users (id, tenant_id, name, username, email, password_hash, role, status, active, branch_id, last_login_at, created_at)
       VALUES (?, ?, 'Karthik Raman', 'karthik.r', 'karthik.r@example.com', ?, 'manager', 'ACTIVE', true, ?, now(), '2026-10-29T11:00:00Z')`,
      [uKarthikId, tenantId, hash, porBranch?.id || null],
    );

    if (porBranch) {
      await db.exec('UPDATE branches SET manager_id = ? WHERE id = ?', [uKarthikId, porBranch.id]);
    }

    // Create Divya Mohan
    const uDivyaId = newId('u');
    await db.exec(
      `INSERT INTO users (id, tenant_id, name, username, email, password_hash, role, status, active, branch_id, last_login_at, created_at)
       VALUES (?, ?, 'Divya Mohan', 'divya.m', null, ?, 'manager', 'INVITED', true, null, null, '2026-10-30T09:00:00Z')`,
      [uDivyaId, tenantId, hash],
    );
  }

  // Check counters
  const cntCount = await db.one<{ count: number }>(
    `SELECT count(*)::int as count FROM counters WHERE tenant_id = ?`,
    [tenantId],
  );

  if (!cntCount || cntCount.count === 0) {
    const mainBr = await db.one<{ id: string }>(`SELECT id FROM branches WHERE tenant_id = ? AND code = 'MAIN'`, [tenantId]);
    const porBr = await db.one<{ id: string }>(`SELECT id FROM branches WHERE tenant_id = ? AND code = 'SKS_POR'`, [tenantId]);

    if (mainBr) {
      await db.exec(
        `INSERT INTO counters (id, tenant_id, branch_id, name, code, login_username, status)
         VALUES (?, ?, ?, 'Counter 1', 'MAIN-C01', 'sks_main_c1', 'ACTIVE')
         ON CONFLICT (tenant_id, code) DO NOTHING`,
        [newId('cnt'), tenantId, mainBr.id],
      );
    }
    if (porBr) {
      await db.exec(
        `INSERT INTO counters (id, tenant_id, branch_id, name, code, login_username, status)
         VALUES (?, ?, ?, 'Counter 1', 'POR-C01', 'sks_por_c1', 'ACTIVE')
         ON CONFLICT (tenant_id, code) DO NOTHING`,
        [newId('cnt'), tenantId, porBr.id],
      );
    }
  }
}

export function registerUserManagement(r: Router) {
  // -------------------------------------------------------------------------
  // MAIL TEST (Super Admin only)
  // -------------------------------------------------------------------------
  r.post('/api/mail/test', async (ctx) => {
    requireSuperAdmin(ctx);
    const to = V.str(ctx.body?.to, 'Recipient email', { required: true });
    try {
      const res = await sendTestEmail(to);
      return res;
    } catch (err: any) {
      throw bad(err.message || 'SMTP test failed', 'MAIL_ERROR');
    }
  });

  // -------------------------------------------------------------------------
  // RESEND SIGN-IN DETAILS (Generates new temp password & emails)
  // -------------------------------------------------------------------------
  r.post('/api/users/:id/resend', async (ctx) => {
    requireSuperAdmin(ctx);
    const tenantId = ctx.user!.tenantId;
    const userId = ctx.params.id;

    const user = await ctx.db.one<any>(
      `SELECT u.*, b.name as branch_name, b.code as branch_code
       FROM users u
       LEFT JOIN branches b ON b.id = u.branch_id
       WHERE u.id = ? AND u.tenant_id = ? AND u.deleted_at IS NULL`,
      [userId, tenantId],
    );
    if (!user) throw notFound('User');
    if (!user.email) throw bad('This user does not have an email address.', 'NO_EMAIL');

    const tempPassword = generateStrongPassword();
    const hash = hashPassword(tempPassword);

    await ctx.db.exec(
      'UPDATE users SET password_hash = ?, must_change_password = true, updated_at = now() WHERE id = ?',
      [hash, user.id],
    );

    const roleName = user.role === 'manager' ? 'Store manager' : (user.role === 'cashier' ? 'Cashier' : 'Counter account');

    await enqueueUserEmail(ctx.db, {
      tenantId,
      userId: user.id,
      toEmail: user.email,
      type: 'RESEND',
      createdBy: ctx.user!.id,
      templateData: {
        name: user.name,
        roleName,
        branchName: user.branch_name,
        branchCode: user.branch_code,
        username: user.username,
        email: user.email,
        password: tempPassword,
        mustChangePassword: true,
      },
    });

    await audit(ctx.db, ctx, {
      action: 'user.resend_credentials',
      entity: 'user',
      entityId: user.id,
      detail: { name: user.name, email: user.email, role: user.role },
    });

    return {
      ok: true,
      temporaryPassword: tempPassword,
      emailQueued: true,
      toEmail: user.email,
    };
  });

  // -------------------------------------------------------------------------
  // 1. SUMMARY METRICS
  // -------------------------------------------------------------------------
  const getSummaryMetrics = async (ctx: Ctx) => {
    requireSuperAdmin(ctx);
    const tenantId = ctx.user!.tenantId;
    await ensureDemoData(ctx.db, tenantId);

    // Branches total, active, inactive
    const branches = await ctx.db.query<{ active: boolean; manager_id: string | null }>(
      'SELECT active, manager_id FROM branches WHERE tenant_id = ? AND deleted_at IS NULL',
      [tenantId],
    );
    const branchTotal = branches.length;
    const branchActive = branches.filter((b) => b.active).length;
    const branchInactive = branchTotal - branchActive;
    const branchesWithoutManager = branches.filter((b) => !b.manager_id).length;

    // Managers total, assigned, unassigned
    const managers = await ctx.db.query<{ branch_id: string | null }>(
      `SELECT branch_id FROM users WHERE tenant_id = ? AND role = 'manager' AND deleted_at IS NULL`,
      [tenantId],
    );
    const managerTotal = managers.length;
    const managerAssigned = managers.filter((m) => !!m.branch_id).length;
    const managerUnassigned = managerTotal - managerAssigned;

    // Counters total, active, distinct branches
    const counters = await ctx.db.query<{ status: string; branch_id: string }>(
      'SELECT status, branch_id FROM counters WHERE tenant_id = ?',
      [tenantId],
    );
    const counterTotal = counters.length;
    const counterActive = counters.filter((c) => c.status === 'ACTIVE').length;
    const counterBranches = new Set(counters.map((c) => c.branch_id)).size;

    return {
      branches: {
        total: branchTotal,
        active: branchActive,
        inactive: branchInactive,
      },
      managers: {
        total: managerTotal,
        assigned: managerAssigned,
        unassigned: managerUnassigned,
      },
      counters: {
        total: counterTotal,
        active: counterActive,
        branches: counterBranches,
      },
      branchesWithoutManager,
    };
  };

  r.get('/api/user-management/summary', getSummaryMetrics);
  r.get('/api/users/summary', getSummaryMetrics);

  // -------------------------------------------------------------------------
  // 2. CHECK USERNAME AVAILABILITY
  // -------------------------------------------------------------------------
  r.get('/api/managers/check-username', async (ctx) => {
    requireSuperAdmin(ctx);
    const tenantId = ctx.user!.tenantId;
    const username = V.str(ctx.query.username, 'Username', { required: true }).trim().toLowerCase();
    const excludeId = ctx.query.excludeId ? String(ctx.query.excludeId) : null;

    const fmtErr = validateUsernameFormat(username);
    if (fmtErr) {
      return { available: false, error: fmtErr };
    }

    // Check users table
    let userQuery = 'SELECT id FROM users WHERE tenant_id = ? AND lower(username) = ?';
    const params: unknown[] = [tenantId, username];
    if (excludeId) {
      userQuery += ' AND id != ?';
      params.push(excludeId);
    }
    const existingUser = await ctx.db.one(userQuery, params);
    if (existingUser) return { available: false, error: 'This username is already taken.' };

    // Check counters login username
    const existingCounter = await ctx.db.one(
      'SELECT id FROM counters WHERE tenant_id = ? AND lower(login_username) = ?',
      [tenantId, username],
    );
    if (existingCounter) return { available: false, error: 'This username is already taken by a counter.' };

    return { available: true };
  });

  // -------------------------------------------------------------------------
  // 3. CHECK EMAIL AVAILABILITY
  // -------------------------------------------------------------------------
  r.get('/api/managers/check-email', async (ctx) => {
    requireSuperAdmin(ctx);
    const tenantId = ctx.user!.tenantId;
    const emailRaw = V.str(ctx.query.email, 'Email', { required: true }).trim().toLowerCase();
    const excludeId = ctx.query.excludeId ? String(ctx.query.excludeId) : null;

    try {
      parseEmail(emailRaw);
    } catch {
      return { available: false, error: 'Enter a valid email, like name@store.com' };
    }

    let q = 'SELECT id FROM users WHERE tenant_id = ? AND lower(email) = ?';
    const params: unknown[] = [tenantId, emailRaw];
    if (excludeId) {
      q += ' AND id != ?';
      params.push(excludeId);
    }
    const existing = await ctx.db.one(q, params);
    if (existing) return { available: false, error: 'A manager with this email already exists.' };

    return { available: true };
  });

  // -------------------------------------------------------------------------
  // 4. GET STORE MANAGERS
  // -------------------------------------------------------------------------
  r.get('/api/managers', async (ctx) => {
    requireSuperAdmin(ctx);
    const tenantId = ctx.user!.tenantId;
    await ensureDemoData(ctx.db, tenantId);

    const search = ctx.query.search ? String(ctx.query.search).trim().toLowerCase() : '';
    const branchId = ctx.query.branchId ? String(ctx.query.branchId).trim() : '';
    const status = ctx.query.status ? String(ctx.query.status).trim().toUpperCase() : '';

    const rows = await ctx.db.query<any>(
      `SELECT u.id, u.name, u.username, u.email, u.phone, u.status, u.active,
              u.branch_id, u.last_login_at, u.created_at,
              b.name as branch_name, b.code as branch_code, b.active as branch_active,
              el.status as last_email_status, el.error_message as last_email_error, el.sent_at as last_email_sent_at
       FROM users u
       LEFT JOIN branches b ON b.id = u.branch_id
       LEFT JOIN LATERAL (
         SELECT status, error_message, sent_at
         FROM email_logs
         WHERE user_id = u.id
         ORDER BY created_at DESC
         LIMIT 1
       ) el ON true
       WHERE u.tenant_id = ? AND u.role = 'manager' AND u.deleted_at IS NULL
       ORDER BY u.created_at DESC`,
      [tenantId],
    );

    let managers = rows.map((r) => ({
      id: r.id,
      name: r.name,
      username: r.username || null,
      email: r.email || null,
      phone: r.phone || null,
      status: r.status || (r.active ? 'ACTIVE' : 'DISABLED'),
      branchId: r.branchId || r.branch_id || null,
      branchName: r.branchName || r.branch_name || null,
      branchCode: r.branchCode || r.branch_code || null,
      branchActive: r.branchActive ?? r.branch_active ?? true,
      lastLoginAt: r.lastLoginAt || r.last_login_at || null,
      createdAt: r.createdAt || r.created_at,
      lastEmailStatus: r.lastEmailStatus || r.last_email_status || null,
      lastEmailError: r.lastEmailError || r.last_email_error || null,
      lastEmailSentAt: r.lastEmailSentAt || r.last_email_sent_at || null,
    }));

    // In-memory combined filtering
    if (search) {
      managers = managers.filter((m) => {
        const matchName = m.name.toLowerCase().includes(search);
        const matchUsername = m.username ? m.username.toLowerCase().includes(search) : false;
        const matchEmail = m.email ? m.email.toLowerCase().includes(search) : false;
        const matchBranch = m.branchName ? m.branchName.toLowerCase().includes(search) || m.branchCode?.toLowerCase().includes(search) : false;
        return matchName || matchUsername || matchEmail || matchBranch;
      });
    }

    if (branchId) {
      if (branchId === 'unassigned') {
        managers = managers.filter((m) => !m.branchId);
      } else {
        managers = managers.filter((m) => m.branchId === branchId);
      }
    }

    if (status && status !== 'ALL') {
      managers = managers.filter((m) => m.status === status);
    }

    return { managers };
  });

  // -------------------------------------------------------------------------
  // 5. CREATE STORE MANAGER
  // -------------------------------------------------------------------------
  r.post('/api/managers', async (ctx) => {
    requireSuperAdmin(ctx);
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};

    const name = V.str(b.name, 'Full name', { required: true, max: 80 }).trim();
    if (name.length < 2) throw bad('Full name must be at least 2 characters.', 'VALIDATION');

    let username = b.username ? String(b.username).trim().toLowerCase() : null;
    let email = b.email ? String(b.email).trim().toLowerCase() : null;

    if (!username && !email) {
      throw bad('Add a username or an email ID to continue.', 'VALIDATION');
    }

    if (username) {
      const uErr = validateUsernameFormat(username);
      if (uErr) throw bad(uErr, 'INVALID_USERNAME');

      const existingU = await ctx.db.one(
        'SELECT id FROM users WHERE tenant_id = ? AND lower(username) = ?',
        [tenantId, username],
      );
      if (existingU) throw conflict('This username is already taken.', 'USERNAME_TAKEN');
    }

    if (email) {
      try {
        email = parseEmail(email);
      } catch {
        throw bad('Enter a valid email, like name@store.com', 'INVALID_EMAIL');
      }

      const existingE = await ctx.db.one(
        'SELECT id FROM users WHERE tenant_id = ? AND lower(email) = ?',
        [tenantId, email],
      );
      if (existingE) throw conflict('A manager with this email already exists.', 'EMAIL_TAKEN');
    }

    const password = V.str(b.password, 'Password', { required: true });
    const pwErr = validatePasswordRules(password);
    if (pwErr) throw bad(pwErr, 'WEAK_PASSWORD');

    const phone = b.phone ? String(b.phone).trim() : null;
    if (phone && !/^[0-9+\s\-]{10,15}$/.test(phone)) {
      throw bad('Enter a valid 10-digit mobile number.', 'INVALID_PHONE');
    }

    const branchId = b.branchId ? String(b.branchId).trim() : null;
    const sendEmail = Boolean(b.sendEmail && email);
    const mustChangePassword = b.mustChangePassword !== undefined ? Boolean(b.mustChangePassword) : true;

    const managerId = newId('u');
    const passwordHash = hashPassword(password);

    await ctx.db.tx(async (q) => {
      // If branch is provided:
      if (branchId) {
        const br = await q.one<any>('SELECT id, name, manager_id FROM branches WHERE id = ? AND tenant_id = ?', [branchId, tenantId]);
        if (!br) throw notFound('Branch');

        // Unassign old manager from this branch
        if (br.manager_id) {
          await q.exec('UPDATE users SET branch_id = NULL WHERE id = ?', [br.manager_id]);
          await audit(q, ctx, {
            action: 'branch.unassign_manager',
            entity: 'branch',
            entityId: branchId,
            detail: { previousManagerId: br.manager_id, branchName: br.name },
          });
        }

        // Set branch manager
        await q.exec('UPDATE branches SET manager_id = ?, updated_at = now() WHERE id = ?', [managerId, branchId]);
      }

      // Insert manager
      await q.exec(
        `INSERT INTO users (id, tenant_id, name, username, email, phone, password_hash, role, status, active, branch_id, must_change_password, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'manager', 'INVITED', true, ?, ?, ?, now(), now())`,
        [managerId, tenantId, name, username, email, phone, passwordHash, branchId || null, mustChangePassword, ctx.user!.id],
      );

      await audit(q, ctx, {
        action: 'user.create_manager',
        entity: 'user',
        entityId: managerId,
        detail: { name, username, email, branchId, sendEmail },
      });
    });

    if (sendEmail && email) {
      let bName: string | undefined;
      let bCode: string | undefined;
      if (branchId) {
        const br = await ctx.db.one<any>('SELECT name, code FROM branches WHERE id = ?', [branchId]);
        bName = br?.name;
        bCode = br?.code;
      }
      await enqueueUserEmail(ctx.db, {
        tenantId,
        userId: managerId,
        toEmail: email,
        type: 'WELCOME',
        createdBy: ctx.user!.id,
        templateData: {
          name,
          roleName: 'Store manager',
          branchName: bName,
          branchCode: bCode,
          username,
          email,
          password,
          mustChangePassword,
        },
      });
    }

    return {
      ok: true,
      id: managerId,
      name,
      username,
      email,
      phone,
      branchId,
      status: 'INVITED',
      lastLoginAt: null,
      emailSent: sendEmail,
      emailQueued: sendEmail,
    };
  });

  // -------------------------------------------------------------------------
  // 6. EDIT STORE MANAGER
  // -------------------------------------------------------------------------
  r.patch('/api/managers/:id', async (ctx) => {
    requireSuperAdmin(ctx);
    const tenantId = ctx.user!.tenantId;
    const managerId = ctx.params.id;
    const b = ctx.body ?? {};

    const existing = await ctx.db.one<any>(
      `SELECT * FROM users WHERE id = ? AND tenant_id = ? AND role = 'manager' AND deleted_at IS NULL`,
      [managerId, tenantId],
    );
    if (!existing) throw notFound('Store Manager');

    const name = b.name !== undefined ? V.str(b.name, 'Full name', { required: true, max: 80 }).trim() : existing.name;
    if (name.length < 2) throw bad('Full name must be at least 2 characters.', 'VALIDATION');

    let username = b.username !== undefined ? (b.username ? String(b.username).trim().toLowerCase() : null) : existing.username;
    let email = b.email !== undefined ? (b.email ? String(b.email).trim().toLowerCase() : null) : existing.email;

    if (!username && !email) {
      throw bad('A manager must have at least a username or an email ID.', 'VALIDATION');
    }

    if (username && username !== existing.username) {
      const uErr = validateUsernameFormat(username);
      if (uErr) throw bad(uErr, 'INVALID_USERNAME');

      const dupU = await ctx.db.one(
        'SELECT id FROM users WHERE tenant_id = ? AND lower(username) = ? AND id != ?',
        [tenantId, username, managerId],
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
        [tenantId, email, managerId],
      );
      if (dupE) throw conflict('A manager with this email already exists.', 'EMAIL_TAKEN');
    }

    const phone = b.phone !== undefined ? (b.phone ? String(b.phone).trim() : null) : existing.phone;
    const branchId = b.branchId !== undefined ? (b.branchId ? String(b.branchId).trim() : null) : existing.branch_id;

    await ctx.db.tx(async (q) => {
      // If branch changed:
      if (branchId !== existing.branch_id) {
        // Clear previous branch manager
        if (existing.branch_id) {
          await q.exec('UPDATE branches SET manager_id = NULL WHERE id = ? AND manager_id = ?', [existing.branch_id, managerId]);
        }

        // If new branch selected, unassign any old manager and set this one
        if (branchId) {
          const br = await q.one<any>('SELECT id, manager_id FROM branches WHERE id = ? AND tenant_id = ?', [branchId, tenantId]);
          if (!br) throw notFound('Branch');

          if (br.manager_id && br.manager_id !== managerId) {
            await q.exec('UPDATE users SET branch_id = NULL WHERE id = ?', [br.manager_id]);
          }
          await q.exec('UPDATE branches SET manager_id = ?, updated_at = now() WHERE id = ?', [managerId, branchId]);
        }
      }

      await q.exec(
        `UPDATE users
         SET name = ?, username = ?, email = ?, phone = ?, branch_id = ?, updated_at = now()
         WHERE id = ?`,
        [name, username, email, phone, branchId, managerId],
      );

      await audit(q, ctx, {
        action: 'user.update_manager',
        entity: 'user',
        entityId: managerId,
        detail: { name, username, email, phone, branchId },
      });
    });

    return { ok: true, id: managerId, name, username, email, phone, branchId };
  });

  // -------------------------------------------------------------------------
  // 7. RESET PASSWORD (ONE-TIME TEMPORARY PASSWORD)
  // -------------------------------------------------------------------------
  r.post('/api/managers/:id/reset-password', async (ctx) => {
    requireSuperAdmin(ctx);
    const tenantId = ctx.user!.tenantId;
    const managerId = ctx.params.id;

    const manager = await ctx.db.one<any>(
      `SELECT id, name, email, username FROM users WHERE id = ? AND tenant_id = ? AND role = 'manager' AND deleted_at IS NULL`,
      [managerId, tenantId],
    );
    if (!manager) throw notFound('Store Manager');

    const tempPassword = generateStrongPassword();
    const hash = hashPassword(tempPassword);

    await ctx.db.exec(
      'UPDATE users SET password_hash = ?, must_change_password = true, updated_at = now() WHERE id = ?',
      [hash, managerId],
    );

    await audit(ctx.db, ctx, {
      action: 'user.reset_password',
      entity: 'user',
      entityId: managerId,
      detail: { managerName: manager.name, email: manager.email },
    });

    let emailQueued = false;
    if (manager.email && ctx.body?.sendEmail !== false) {
      const mgrBranch = manager.branch_id
        ? await ctx.db.one<any>('SELECT name, code FROM branches WHERE id = ?', [manager.branch_id])
        : null;
      await enqueueUserEmail(ctx.db, {
        tenantId,
        userId: manager.id,
        toEmail: manager.email,
        type: 'RESET_PASSWORD',
        createdBy: ctx.user!.id,
        templateData: {
          name: manager.name,
          roleName: 'Store manager',
          branchName: mgrBranch?.name,
          branchCode: mgrBranch?.code,
          username: manager.username,
          email: manager.email,
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
      manager: {
        id: manager.id,
        name: manager.name,
        email: manager.email,
        username: manager.username,
      },
    };
  });

  // -------------------------------------------------------------------------
  // 8. DISABLE / ENABLE STORE MANAGER
  // -------------------------------------------------------------------------
  r.patch('/api/managers/:id/status', async (ctx) => {
    requireSuperAdmin(ctx);
    const tenantId = ctx.user!.tenantId;
    const managerId = ctx.params.id;
    const nextStatus = V.oneOf(ctx.body?.status, 'Status', ['ACTIVE', 'DISABLED']);

    const manager = await ctx.db.one<any>(
      `SELECT id, name, last_login_at FROM users WHERE id = ? AND tenant_id = ? AND role = 'manager' AND deleted_at IS NULL`,
      [managerId, tenantId],
    );
    if (!manager) throw notFound('Store Manager');

    let finalStatus: 'ACTIVE' | 'INVITED' | 'DISABLED' = nextStatus;
    const active = nextStatus === 'ACTIVE';

    if (active) {
      // If they have never logged in, revert to INVITED
      if (!manager.last_login_at) {
        finalStatus = 'INVITED';
      }
    }

    await ctx.db.exec(
      'UPDATE users SET status = ?, active = ?, updated_at = now() WHERE id = ?',
      [finalStatus, active, managerId],
    );

    await audit(ctx.db, ctx, {
      action: active ? 'user.enable' : 'user.disable',
      entity: 'user',
      entityId: managerId,
      detail: { name: manager.name, status: finalStatus },
    });

    return { ok: true, id: managerId, status: finalStatus, active };
  });

  // -------------------------------------------------------------------------
  // 9. ASSIGN / CHANGE BRANCH MANAGER
  // -------------------------------------------------------------------------
  r.patch('/api/branches/:id/manager', async (ctx) => {
    requireSuperAdmin(ctx);
    const tenantId = ctx.user!.tenantId;
    const branchId = ctx.params.id;
    const managerId = ctx.body?.managerId ? String(ctx.body.managerId).trim() : null;

    const branch = await ctx.db.one<any>(
      'SELECT id, name, code, manager_id FROM branches WHERE id = ? AND tenant_id = ?',
      [branchId, tenantId],
    );
    if (!branch) throw notFound('Branch');

    await ctx.db.tx(async (q) => {
      // 1. If branch had a previous manager, unassign them
      if (branch.manager_id && branch.manager_id !== managerId) {
        await q.exec('UPDATE users SET branch_id = NULL WHERE id = ?', [branch.manager_id]);
      }

      // 2. If assigning a new manager
      if (managerId) {
        const mgr = await q.one<any>(
          `SELECT id, name, branch_id FROM users WHERE id = ? AND tenant_id = ? AND role = 'manager'`,
          [managerId, tenantId],
        );
        if (!mgr) throw notFound('Store Manager');

        // If this manager previously had another branch, unassign from that branch
        if (mgr.branch_id && mgr.branch_id !== branchId) {
          await q.exec('UPDATE branches SET manager_id = NULL WHERE id = ?', [mgr.branch_id]);
        }

        // Assign manager to branch
        await q.exec('UPDATE branches SET manager_id = ?, updated_at = now() WHERE id = ?', [managerId, branchId]);
        await q.exec('UPDATE users SET branch_id = ?, updated_at = now() WHERE id = ?', [branchId, managerId]);
      } else {
        // Clear branch manager
        await q.exec('UPDATE branches SET manager_id = NULL, updated_at = now() WHERE id = ?', [branchId]);
      }

      await audit(q, ctx, {
        action: 'branch.assign_manager',
        entity: 'branch',
        entityId: branchId,
        detail: { branchName: branch.name, managerId },
      });
    });

    return { ok: true, branchId, managerId };
  });

  // -------------------------------------------------------------------------
  // 10. GET ALL COUNTERS (every counter in every branch)
  // -------------------------------------------------------------------------
  r.get('/api/counters', async (ctx) => {
    requireSuperAdmin(ctx);
    const tenantId = ctx.user!.tenantId;
    await ensureDemoData(ctx.db, tenantId);

    const search = ctx.query.search ? String(ctx.query.search).trim().toLowerCase() : '';
    const branchId = ctx.query.branchId ? String(ctx.query.branchId).trim() : '';
    const status = ctx.query.status ? String(ctx.query.status).trim().toUpperCase() : '';

    const rows = await ctx.db.query<any>(
      `SELECT c.id, c.name, c.code, c.login_username, c.status, c.created_at,
              b.id as branch_id, b.name as branch_name, b.code as branch_code, b.active as branch_active,
              u.id as manager_id, u.name as manager_name
       FROM counters c
       JOIN branches b ON b.id = c.branch_id
       LEFT JOIN users u ON u.id = b.manager_id
       WHERE c.tenant_id = ?
       ORDER BY b.name ASC, c.name ASC`,
      [tenantId],
    );

    let counters = rows.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      loginUsername: r.loginUsername || r.login_username || null,
      status: r.status,
      branch: {
        id: r.branchId || r.branch_id,
        name: r.branchName || r.branch_name,
        code: r.branchCode || r.branch_code,
        active: Boolean(r.branchActive ?? r.branch_active ?? true),
        status: (r.branchActive ?? r.branch_active ?? true) ? 'Active' : 'Inactive',
      },
      manager: r.manager_name ? { id: r.manager_id, name: r.manager_name } : null,
      createdAt: r.createdAt || r.created_at,
    }));

    if (search) {
      counters = counters.filter((c) => {
        const matchName = c.name.toLowerCase().includes(search);
        const matchCode = c.code.toLowerCase().includes(search);
        const matchLogin = c.loginUsername ? c.loginUsername.toLowerCase().includes(search) : false;
        const matchBranch = c.branch.name.toLowerCase().includes(search) || c.branch.code.toLowerCase().includes(search);
        return matchName || matchCode || matchLogin || matchBranch;
      });
    }

    if (branchId && branchId !== 'ALL') {
      counters = counters.filter((c) => c.branch.id === branchId);
    }

    if (status && status !== 'ALL') {
      counters = counters.filter((c) => c.status === status);
    }

    return { counters };
  });

  // -------------------------------------------------------------------------
  // 11. DISABLE / ENABLE COUNTER
  // -------------------------------------------------------------------------
  r.patch('/api/counters/:id/status', async (ctx) => {
    requireSuperAdmin(ctx);
    const tenantId = ctx.user!.tenantId;
    const counterId = ctx.params.id;
    const nextStatus = V.oneOf(ctx.body?.status, 'Status', ['ACTIVE', 'DISABLED']);

    const counter = await ctx.db.one<any>(
      'SELECT id, name, code FROM counters WHERE id = ? AND tenant_id = ?',
      [counterId, tenantId],
    );
    if (!counter) throw notFound('Counter');

    await ctx.db.exec(
      'UPDATE counters SET status = ?, updated_at = now() WHERE id = ?',
      [nextStatus, counterId],
    );

    await audit(ctx.db, ctx, {
      action: 'counter.status_change',
      entity: 'counter',
      entityId: counterId,
      detail: { name: counter.name, code: counter.code, status: nextStatus },
    });

    return { ok: true, id: counterId, status: nextStatus };
  });

  // -------------------------------------------------------------------------
  // 12. CREATE COUNTER
  // -------------------------------------------------------------------------
  r.post('/api/counters', async (ctx) => {
    requireSuperAdmin(ctx);
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};

    const name = V.str(b.name, 'Counter name', { required: true, max: 80 }).trim();
    const code = V.str(b.code, 'Counter code', { required: true, max: 30 }).trim().toUpperCase();
    const branchId = V.str(b.branchId, 'Branch ID', { required: true });
    const loginUsername = b.loginUsername ? String(b.loginUsername).trim().toLowerCase() : null;

    const branch = await ctx.db.one('SELECT id FROM branches WHERE id = ? AND tenant_id = ?', [branchId, tenantId]);
    if (!branch) throw notFound('Branch');

    const existingCode = await ctx.db.one(
      'SELECT id FROM counters WHERE tenant_id = ? AND code = ?',
      [tenantId, code],
    );
    if (existingCode) throw conflict(`Counter code "${code}" is already in use.`, 'DUPLICATE_COUNTER');

    if (loginUsername) {
      const existingUser = await ctx.db.one(
        'SELECT id FROM users WHERE tenant_id = ? AND lower(username) = ?',
        [tenantId, loginUsername],
      );
      if (existingUser) throw conflict('Username already taken by a manager.', 'DUPLICATE_LOGIN');
    }

    const counterId = newId('cnt');
    await ctx.db.exec(
      `INSERT INTO counters (id, tenant_id, branch_id, name, code, login_username, status)
       VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [counterId, tenantId, branchId, name, code, loginUsername],
    );

    // Keep branch.counters JSON in sync
    const br = await ctx.db.one<any>('SELECT counters FROM branches WHERE id = ?', [branchId]);
    let cntList: string[] = [];
    try {
      cntList = Array.isArray(br?.counters) ? br.counters : JSON.parse(br?.counters || '[]');
    } catch {
      cntList = [];
    }
    if (!cntList.includes(code)) {
      cntList.push(code);
      await ctx.db.exec('UPDATE branches SET counters = ?::jsonb WHERE id = ?', [j(cntList), branchId]);
    }

    const email = b.email ? String(b.email).trim().toLowerCase() : null;
    const sendEmail = Boolean(b.sendEmail && email);
    const password = b.password ? String(b.password).trim() : null;
    if (password && (loginUsername || email)) {
      const passwordHash = hashPassword(password);
      const uId = newId('u');
      await ctx.db.exec(
        `INSERT INTO users (id, tenant_id, name, username, email, password_hash, role, status, active, branch_id, counter_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'counter', 'INVITED', true, ?, ?, now(), now())`,
        [uId, tenantId, name, loginUsername, email, passwordHash, branchId, counterId]
      );
      if (sendEmail && email) {
        const brInfo = await ctx.db.one<any>('SELECT name, code FROM branches WHERE id = ?', [branchId]);
        await enqueueUserEmail(ctx.db, {
          tenantId,
          userId: uId,
          toEmail: email,
          type: 'WELCOME',
          createdBy: ctx.user!.id,
          templateData: {
            name,
            roleName: 'Counter account',
            branchName: brInfo?.name,
            branchCode: brInfo?.code,
            username: loginUsername,
            email,
            password,
          },
        });
      }
    }

    await audit(ctx.db, ctx, {
      action: 'counter.create',
      entity: 'counter',
      entityId: counterId,
      detail: { name, code, branchId, sendEmail },
    });

    return { ok: true, id: counterId, name, code, branchId, status: 'ACTIVE', emailSent: sendEmail };
  });

  // -------------------------------------------------------------------------
  // 13. EDIT COUNTER
  // -------------------------------------------------------------------------
  r.patch('/api/counters/:id', async (ctx) => {
    requireSuperAdmin(ctx);
    const tenantId = ctx.user!.tenantId;
    const counterId = ctx.params.id;
    const b = ctx.body ?? {};

    const counter = await ctx.db.one<any>(
      'SELECT * FROM counters WHERE id = ? AND tenant_id = ?',
      [counterId, tenantId],
    );
    if (!counter) throw notFound('Counter');

    const name = b.name !== undefined ? V.str(b.name, 'Counter name', { required: true, max: 80 }).trim() : counter.name;
    const code = b.code !== undefined ? V.str(b.code, 'Counter code', { required: true, max: 30 }).trim().toUpperCase() : counter.code;
    const loginUsername = b.loginUsername !== undefined ? (b.loginUsername ? String(b.loginUsername).trim().toLowerCase() : null) : counter.login_username;

    if (code !== counter.code) {
      const dup = await ctx.db.one(
        'SELECT id FROM counters WHERE tenant_id = ? AND code = ? AND id != ?',
        [tenantId, code, counterId],
      );
      if (dup) throw conflict(`Counter code "${code}" is already in use.`, 'DUPLICATE_COUNTER');
    }

    await ctx.db.exec(
      `UPDATE counters
       SET name = ?, code = ?, login_username = ?, updated_at = now()
       WHERE id = ?`,
      [name, code, loginUsername, counterId],
    );

    return { ok: true, id: counterId, name, code, loginUsername };
  });
  // -------------------------------------------------------------------------
  // DELETE IMPACT & DELETE: STORE MANAGERS
  // -------------------------------------------------------------------------
  r.get('/api/managers/:id/delete-impact', async (ctx) => {
    requireSuperAdmin(ctx);
    const tenantId = ctx.user!.tenantId;
    const managerId = ctx.params.id;

    const mgr = await ctx.db.one<any>(
      `SELECT u.*, b.name as branch_name, b.code as branch_code
       FROM users u
       LEFT JOIN branches b ON b.id = u.branch_id
       WHERE u.id = ? AND u.tenant_id = ? AND u.role = 'manager' AND u.deleted_at IS NULL`,
      [managerId, tenantId],
    );
    if (!mgr) throw notFound('Store manager');

    return {
      name: mgr.name,
      branchName: mgr.branch_name || null,
      branchCode: mgr.branch_code || null,
    };
  });

  r.delete('/api/managers/:id', async (ctx) => {
    requireSuperAdmin(ctx);
    const tenantId = ctx.user!.tenantId;
    const managerId = ctx.params.id;

    if (managerId === ctx.user!.id) {
      throw conflict('You cannot delete your own account.', 'CANNOT_DELETE_SELF');
    }

    const mgr = await ctx.db.one<any>(
      `SELECT * FROM users WHERE id = ? AND tenant_id = ? AND role = 'manager' AND deleted_at IS NULL`,
      [managerId, tenantId],
    );
    if (!mgr) throw notFound('Store manager');

    await ctx.db.tx(async (q) => {
      // 1. Audit BEFORE deleting
      await audit(q, ctx, {
        action: 'DELETE',
        entity: 'user',
        entityId: mgr.id,
        detail: { name: mgr.name, email: mgr.email, role: 'manager', branchId: mgr.branch_id },
      });

      // 2. Unassign from branches
      await q.exec('UPDATE branches SET manager_id = NULL WHERE manager_id = ?', [mgr.id]);

      // 3. Clear non-cascading user references
      await q.exec('UPDATE invoices SET whatsapp_last_sent_by = NULL WHERE whatsapp_last_sent_by = ?', [mgr.id]);
      await q.exec('UPDATE stock_adjustments SET created_by = NULL WHERE created_by = ?', [mgr.id]);
      await q.exec('UPDATE stock_counts SET created_by = NULL WHERE created_by = ?', [mgr.id]);
      await q.exec('UPDATE stock_counts SET finalized_by = NULL WHERE finalized_by = ?', [mgr.id]);
      await q.exec('UPDATE shifts SET closed_by = NULL WHERE closed_by = ?', [mgr.id]);
      await q.exec('UPDATE shifts SET reviewed_by = NULL WHERE reviewed_by = ?', [mgr.id]);
      await q.exec('UPDATE promotions SET created_by = NULL WHERE created_by = ?', [mgr.id]);
      await q.exec('DELETE FROM email_logs WHERE user_id = ?', [mgr.id]);

      // 4. Delete user
      await q.exec('DELETE FROM users WHERE id = ? AND tenant_id = ?', [mgr.id, tenantId]);
    });

    // Send alert email to store owner
    try {
      const ownerEmail = await getOwnerEmailForTenant(ctx.db, tenantId);
      if (ownerEmail) {
        const br = mgr.branch_id
          ? await ctx.db.one<any>('SELECT name, code FROM branches WHERE id = ?', [mgr.branch_id])
          : null;
        await enqueueDeletionAlertEmail(ctx.db, {
          tenantId,
          toEmail: ownerEmail,
          entityType: 'manager',
          entityName: mgr.name,
          entityCode: mgr.username || mgr.email,
          branchName: br ? `${br.name} (${br.code})` : 'Unassigned',
          deletedByUserId: ctx.user!.id,
          deletedByUserName: ctx.user!.name,
          deletedByUserRole: ctx.user!.role,
        });
      }
    } catch (err: any) {
      console.warn('[Manager Delete] Failed to enqueue deletion alert email:', err.message);
    }

    return { ok: true, deleted: mgr.id, name: mgr.name };
  });

  // -------------------------------------------------------------------------
  // DELETE IMPACT & DELETE: COUNTERS (Super Admin)
  // -------------------------------------------------------------------------
  r.get('/api/counters/:id/delete-impact', async (ctx) => {
    requireSuperAdmin(ctx);
    const tenantId = ctx.user!.tenantId;
    const counterId = ctx.params.id;

    const cnt = await ctx.db.one<any>(
      'SELECT * FROM counters WHERE id = ? AND tenant_id = ?',
      [counterId, tenantId],
    );
    if (!cnt) throw notFound('Counter');

    const defaultCashiers = await ctx.db.query<any>(
      `SELECT id, name FROM users WHERE counter_id = ? AND tenant_id = ? AND role = 'cashier' AND deleted_at IS NULL`,
      [cnt.id, tenantId],
    );

    return {
      name: cnt.name,
      code: cnt.code,
      loginUsername: cnt.login_username || cnt.loginUsername || null,
      defaultCashiersCount: defaultCashiers.length,
    };
  });

  r.delete('/api/counters/:id', async (ctx) => {
    requireSuperAdmin(ctx);
    const tenantId = ctx.user!.tenantId;
    const counterId = ctx.params.id;

    const cnt = await ctx.db.one<any>(
      'SELECT * FROM counters WHERE id = ? AND tenant_id = ?',
      [counterId, tenantId],
    );
    if (!cnt) throw notFound('Counter');

    let defaultCashiersCount = 0;
    await ctx.db.tx(async (q) => {
      const defaultCashiers = await q.query<any>(
        `SELECT id, name FROM users WHERE counter_id = ? AND tenant_id = ?`,
        [cnt.id, tenantId],
      );
      defaultCashiersCount = defaultCashiers.length;

      // 1. Audit BEFORE deleting
      await audit(q, ctx, {
        action: 'DELETE',
        entity: 'counter',
        entityId: cnt.id,
        detail: { name: cnt.name, code: cnt.code, branchId: cnt.branch_id, cashiersCount: defaultCashiers.length },
      });

      // 2. Snapshot counter name into bills, payments, and shifts
      const cName = cnt.name || cnt.code;
      await q.exec('UPDATE invoices SET counter_name_snapshot = COALESCE(counter_name_snapshot, ?) WHERE counter = ? OR counter = ?', [cName, cnt.code, cnt.name]);
      await q.exec('UPDATE payments SET counter_name_snapshot = COALESCE(counter_name_snapshot, ?) WHERE counter = ? OR counter = ?', [cName, cnt.code, cnt.name]);
      await q.exec('UPDATE shifts SET counter_name_snapshot = COALESCE(counter_name_snapshot, ?) WHERE counter = ? OR counter = ?', [cName, cnt.code, cnt.name]);

      // 3. Reset cashiers default counter to NULL
      await q.exec('UPDATE users SET counter_id = NULL WHERE counter_id = ?', [cnt.id]);

      // 4. Delete linked counter login users
      const linked = await q.query<any>(
        `SELECT id FROM users WHERE counter_id = ? OR (tenant_id = ? AND role = 'counter' AND (lower(username) = lower(?) OR lower(name) = lower(?)))`,
        [cnt.id, tenantId, cnt.login_username || cnt.loginUsername || '', cnt.name],
      );
      for (const lu of linked) {
        await q.exec('DELETE FROM email_logs WHERE user_id = ?', [lu.id]);
        await q.exec('DELETE FROM users WHERE id = ?', [lu.id]);
      }

      // 5. Delete counter
      await q.exec('DELETE FROM counters WHERE id = ? AND tenant_id = ?', [cnt.id, tenantId]);
    });

    // Send alert email to store owner
    try {
      const ownerEmail = await getOwnerEmailForTenant(ctx.db, tenantId);
      if (ownerEmail) {
        const br = cnt.branch_id
          ? await ctx.db.one<any>('SELECT name, code FROM branches WHERE id = ?', [cnt.branch_id])
          : null;
        await enqueueDeletionAlertEmail(ctx.db, {
          tenantId,
          toEmail: ownerEmail,
          entityType: 'counter',
          entityName: cnt.name,
          entityCode: cnt.code,
          branchName: br ? `${br.name} (${br.code})` : null,
          deletedByUserId: ctx.user!.id,
          deletedByUserName: ctx.user!.name,
          deletedByUserRole: ctx.user!.role,
          impactDetails: {
            cashiersCount: defaultCashiersCount,
          },
        });
      }
    } catch (err: any) {
      console.warn('[Counter Delete] Failed to enqueue deletion alert email:', err.message);
    }

    return { ok: true, deleted: cnt.id, name: cnt.name };
  });

  // -------------------------------------------------------------------------
  // DELETE IMPACT & DELETE: CASHIERS (Super Admin)
  // -------------------------------------------------------------------------
  r.get('/api/cashiers/:id/delete-impact', async (ctx) => {
    requireSuperAdmin(ctx);
    const tenantId = ctx.user!.tenantId;
    const cashierId = ctx.params.id;

    const csh = await ctx.db.one<any>(
      `SELECT id, name FROM users WHERE id = ? AND tenant_id = ? AND role = 'cashier' AND deleted_at IS NULL`,
      [cashierId, tenantId],
    );
    if (!csh) throw notFound('Cashier');

    return {
      name: csh.name,
    };
  });

  r.delete('/api/cashiers/:id', async (ctx) => {
    requireSuperAdmin(ctx);
    const tenantId = ctx.user!.tenantId;
    const cashierId = ctx.params.id;

    if (cashierId === ctx.user!.id) {
      throw conflict('You cannot delete your own account.', 'CANNOT_DELETE_SELF');
    }

    const csh = await ctx.db.one<any>(
      `SELECT * FROM users WHERE id = ? AND tenant_id = ? AND role = 'cashier' AND deleted_at IS NULL`,
      [cashierId, tenantId],
    );
    if (!csh) throw notFound('Cashier');

    await ctx.db.tx(async (q) => {
      // 1. Audit BEFORE deleting
      await audit(q, ctx, {
        action: 'DELETE',
        entity: 'user',
        entityId: csh.id,
        detail: { name: csh.name, email: csh.email, role: 'cashier', branchId: csh.branch_id },
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
      await q.exec('DELETE FROM users WHERE id = ? AND tenant_id = ?', [csh.id, tenantId]);
    });

    // Send alert email to store owner
    try {
      const ownerEmail = await getOwnerEmailForTenant(ctx.db, tenantId);
      if (ownerEmail) {
        const br = csh.branch_id
          ? await ctx.db.one<any>('SELECT name, code FROM branches WHERE id = ?', [csh.branch_id])
          : null;
        await enqueueDeletionAlertEmail(ctx.db, {
          tenantId,
          toEmail: ownerEmail,
          entityType: 'cashier',
          entityName: csh.name,
          entityCode: csh.username || csh.email,
          branchName: br ? `${br.name} (${br.code})` : null,
          deletedByUserId: ctx.user!.id,
          deletedByUserName: ctx.user!.name,
          deletedByUserRole: ctx.user!.role,
        });
      }
    } catch (err: any) {
      console.warn('[Cashier Delete] Failed to enqueue deletion alert email:', err.message);
    }

    return { ok: true, deleted: csh.id, name: csh.name };
  });

}