import { PERMS, type Perm, type Role } from '../../../shared/types.ts';
import { audit } from '../audit.ts';
import { requireUser } from '../auth.ts';
import { bad, conflict, HttpError, rateLimit, V, type Router } from '../http.ts';
import { burnPasswordTime, hashPassword, newId, passwordProblem, passwordStamp, signToken, verifyPassword } from '../security.ts';
import { parseEmail, parseShopFields, shopView } from '../shopFields.ts';
import { j } from '../db/index.ts';

export const permsFor = (role: Role): Perm[] => (Object.keys(PERMS) as Perm[]).filter((p) => (PERMS[p] as readonly Role[]).includes(role));
export const userView = (u: any) => {
  const parseAllowed = (v: any): string[] | null => {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') {
      try { const parsed = JSON.parse(v); return Array.isArray(parsed) ? parsed : [v]; } catch { return [v]; }
    }
    return null;
  };
  const assignedLocation = u.assignedLocation || u.assigned_location || 'MAIN';
  const assignedCounter = u.assignedCounter || u.assigned_counter || 'COUNTER-1';
  const allowedLocations = parseAllowed(u.allowedLocations || u.allowed_locations) || [assignedLocation];
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as Role,
    assignedLocation,
    assignedCounter,
    allowedLocations,
  };
};

const weak = (pw: unknown) => {
  const p = passwordProblem(pw);
  if (p) throw bad(p, 'WEAK_PASSWORD', { field: 'Password' });
};

/** The secret that signs tokens is the same one the request checker uses: it is passed in once, from createApp. */
export function registerAuth(r: Router, tokens: { secret: string; ttlSeconds: number }) {
  const issueToken = (u: { id: string; tenantId: string; passwordHash: string }) =>
    signToken({ sub: u.id, tid: u.tenantId, ph: passwordStamp(u.passwordHash) }, tokens.secret, tokens.ttlSeconds);

  // Create a new shop and its first (owner) user.
  r.post('/api/auth/register', async (ctx) => {
    rateLimit(`reg:${ctx.ip}`, 10, 60 * 60_000);
    const b = ctx.body ?? {};
    const shop = parseShopFields(b);
    const ownerName = V.str(b.ownerName, 'Your name', { required: true, max: 80 });
    const email = parseEmail(b.email);
    weak(b.password);
    if (await ctx.db.one('SELECT 1 AS x FROM users WHERE lower(email) = ?', [email])) {
      throw conflict('An account with this email already exists. Please sign in instead.', 'EMAIL_TAKEN');
    }
    const tenantId = newId('t');
    const userId = newId('u');
    const passwordHash = hashPassword(b.password);
    try {
      await ctx.db.tx(async (q) => {
        await q.exec(
          `INSERT INTO tenants (id, name, business_type, gstin, state_code, address, phone, upi_id, invoice_prefix, language, locations)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)`,
          [tenantId, shop.name, shop.businessType, shop.gstin, shop.stateCode, shop.address, shop.phone, shop.upiId, shop.invoicePrefix, shop.language, j(shop.locations)],
        );
        await q.exec(`INSERT INTO users (id, tenant_id, name, email, password_hash, role, last_login_at) VALUES (?, ?, ?, ?, ?, 'owner', now())`, [userId, tenantId, ownerName, email, passwordHash]);
        await audit(q, ctx, { action: 'shop.create', entity: 'tenant', entityId: tenantId, tenantId, userId, userName: ownerName, detail: { name: shop.name, businessType: shop.businessType } });
      });
    } catch (e: any) {
      if (e?.code === '23505' && String(e.constraint ?? '').includes('users_email')) throw conflict('An account with this email already exists. Please sign in instead.', 'EMAIL_TAKEN');
      throw e;
    }
    const tenant = await ctx.db.one('SELECT * FROM tenants WHERE id = ?', [tenantId]);
    return { token: issueToken({ id: userId, tenantId, passwordHash }), user: { id: userId, name: ownerName, email, role: 'owner' as Role }, shop: shopView(tenant), perms: permsFor('owner') };
  });

  r.post('/api/auth/login', async (ctx) => {
    const email = parseEmail(ctx.body?.email);
    const password = V.str(ctx.body?.password, 'Password', { required: true, max: 128 });
    rateLimit(`login:${ctx.ip}:${email}`, 10, 15 * 60_000);
    rateLimit(`login-ip:${ctx.ip}`, 100, 15 * 60_000);
    const u = await ctx.db.one('SELECT id, tenant_id, name, email, role, active, password_hash, assigned_location, assigned_counter, allowed_locations FROM users WHERE lower(email) = ?', [email]);
    if (!u) {
      burnPasswordTime(password);
      throw new HttpError(401, 'BAD_LOGIN', 'Email or password is wrong');
    }
    if (!verifyPassword(password, u.passwordHash)) {
      await audit(ctx.db, ctx, { action: 'auth.login_failed', entity: 'user', entityId: u.id, tenantId: u.tenantId, userId: u.id, userName: u.name });
      throw new HttpError(401, 'BAD_LOGIN', 'Email or password is wrong');
    }
    if (!u.active) throw new HttpError(403, 'ACCOUNT_OFF', 'This account has been switched off. Please ask the shop owner.');
    await ctx.db.exec('UPDATE users SET last_login_at = now() WHERE id = ?', [u.id]);
    await audit(ctx.db, ctx, { action: 'auth.login', entity: 'user', entityId: u.id, tenantId: u.tenantId, userId: u.id, userName: u.name });
    const shop = await ctx.db.one('SELECT * FROM tenants WHERE id = ?', [u.tenantId]);
    return { token: issueToken(u), user: userView(u), shop: shopView(shop), perms: permsFor(u.role) };
  });

  r.get('/api/auth/me', requireUser, async (ctx) => {
    const shop = await ctx.db.one('SELECT * FROM tenants WHERE id = ?', [ctx.user!.tenantId]);
    return { user: userView(ctx.user), shop: shopView(shop), perms: permsFor(ctx.user!.role) };
  });

  // Tokens are stateless: the browser simply forgets its token. Recorded so the audit trail shows sign-outs.
  r.post('/api/auth/logout', requireUser, async (ctx) => {
    await audit(ctx.db, ctx, { action: 'auth.logout', entity: 'user', entityId: ctx.user!.id });
  });

  // Changing your own password signs out every other device (their tokens carry the old password fingerprint).
  r.post('/api/auth/change-password', requireUser, async (ctx) => {
    rateLimit(`pw:${ctx.user!.id}`, 10, 15 * 60_000);
    const cur = V.str(ctx.body?.currentPassword, 'Current password', { required: true, max: 128 });
    const next = ctx.body?.newPassword;
    weak(next);
    const u = await ctx.db.one('SELECT id, tenant_id, password_hash FROM users WHERE id = ?', [ctx.user!.id]);
    if (!u || !verifyPassword(cur, u.passwordHash)) throw new HttpError(400, 'BAD_PASSWORD', 'Your current password is not correct');
    if (next === cur) throw bad('Please choose a new password that is different from the current one', 'VALIDATION', { field: 'New password' });
    const passwordHash = hashPassword(next);
    await ctx.db.tx(async (q) => {
      await q.exec('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, u.id]);
      await audit(q, ctx, { action: 'auth.password_changed', entity: 'user', entityId: u.id });
    });
    return { token: issueToken({ id: u.id, tenantId: u.tenantId, passwordHash }) };
  });
  // Step 5: Forgot-password flow
  const resetTokens = new Map<string, { userId: string; expiresAt: number }>();

  r.post('/api/auth/forgot-password', async (ctx) => {
    rateLimit(`forgot-pw:${ctx.ip}`, 5, 15 * 60_000);
    const email = parseEmail(ctx.body?.email);
    const u = await ctx.db.one('SELECT id, name, email FROM users WHERE lower(email) = ?', [email]);

    if (u) {
      const rawToken = crypto.randomUUID();
      const expiresAt = Date.now() + 15 * 60_000;
      resetTokens.set(rawToken, { userId: u.id, expiresAt });
    }

    const emailConfigured = Boolean(process.env.SMTP_HOST || process.env.SENDGRID_API_KEY || process.env.RESEND_API_KEY);
    const note = !emailConfigured
      ? 'Outbound email delivery is not configured on this server (SMTP_HOST is not set). In development, please use the provided demo accounts or configure SMTP credentials.'
      : undefined;

    return {
      ok: true,
      message: 'If an account associated with that email exists, reset instructions have been processed.',
      emailConfigured,
      note,
    };
  });

  r.post('/api/auth/reset-password', async (ctx) => {
    rateLimit(`reset-pw:${ctx.ip}`, 5, 15 * 60_000);
    const token = V.str(ctx.body?.token, 'Reset token', { required: true });
    const next = ctx.body?.newPassword;
    weak(next);

    const record = resetTokens.get(token);
    if (!record || record.expiresAt < Date.now()) {
      resetTokens.delete(token);
      throw new HttpError(400, 'EXPIRED_TOKEN', 'This password reset link is invalid or has expired.');
    }

    resetTokens.delete(token);
    const passwordHash = hashPassword(next);
    await ctx.db.tx(async (q) => {
      await q.exec('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, record.userId]);
      await audit(q, ctx, { action: 'auth.password_reset', entity: 'user', entityId: record.userId });
    });

    return { ok: true, message: 'Password has been successfully updated. You may now log in.' };
  });

  // Return ONLY public demo businesses (t_demo_*) for preview and sandbox exploration.
  // Real registered customer businesses are NEVER leaked here!
  r.get('/api/auth/demo-businesses', async (ctx) => {
    const rows = await ctx.db.query(
      `SELECT t.id, t.name, t.business_type as "businessType", t.gstin, t.phone, t.address, t.invoice_prefix as "invoicePrefix",
              u.email as "ownerEmail", u.name as "ownerName"
       FROM tenants t
       LEFT JOIN users u ON u.tenant_id = t.id AND u.role = 'owner'
       WHERE t.id LIKE 't_demo_%'
       ORDER BY t.created_at ASC`
    );
    return { businesses: rows };
  });

  // Switch to another demo business without re-entering credentials (strictly demo only!)
  r.post('/api/auth/demo-switch', async (ctx) => {
    const tenantId = ctx.body?.tenantId;
    if (!tenantId) throw bad('tenantId is required', 'VALIDATION');
    if (!String(tenantId).startsWith('t_demo_')) {
      throw new HttpError(403, 'FORBIDDEN', 'Access denied: Cannot switch to private customer business');
    }
    const u = await ctx.db.one(
      `SELECT u.id, u.tenant_id, u.name, u.email, u.role, u.active, u.password_hash 
       FROM users u 
       WHERE u.tenant_id = ? AND u.role = 'owner' LIMIT 1`,
      [tenantId]
    );
    if (!u) throw new HttpError(404, 'NOT_FOUND', 'Demo business account not found');
    const shop = await ctx.db.one('SELECT * FROM tenants WHERE id = ?', [u.tenantId]);
    return { token: issueToken(u), user: userView(u), shop: shopView(shop), perms: permsFor(u.role) };
  });

  // Return ONLY the businesses belonging to the current authenticated user
  r.get('/api/auth/my-businesses', requireUser, async (ctx) => {
    const user = ctx.user!;
    const rows = await ctx.db.query(
      `SELECT t.id, t.name, t.business_type as "businessType", t.gstin, t.phone, t.address, t.invoice_prefix as "invoicePrefix",
              u.email as "ownerEmail", u.name as "ownerName"
       FROM tenants t
       JOIN users u ON u.tenant_id = t.id
       WHERE u.id = ? OR (lower(u.email) = lower(?) AND u.role = 'owner')
       ORDER BY t.created_at ASC`,
      [user.id, user.email]
    );

    if (rows.length === 0) {
      const currentShop = await ctx.db.one('SELECT * FROM tenants WHERE id = ?', [user.tenantId]);
      if (currentShop) {
        rows.push({
          id: currentShop.id,
          name: currentShop.name,
          businessType: currentShop.businessType,
          gstin: currentShop.gstin,
          phone: currentShop.phone,
          address: currentShop.address,
          invoicePrefix: currentShop.invoicePrefix,
          ownerEmail: user.email,
          ownerName: user.name,
        });
      }
    }

    return { businesses: rows };
  });

  // Switch between user's own registered businesses/branches
  r.post('/api/auth/my-business-switch', requireUser, async (ctx) => {
    const tenantId = ctx.body?.tenantId;
    if (!tenantId) throw bad('tenantId is required', 'VALIDATION');
    const user = ctx.user!;
    const u = await ctx.db.one(
      `SELECT u.id, u.tenant_id, u.name, u.email, u.role, u.active, u.password_hash 
       FROM users u 
       WHERE u.tenant_id = ? AND (u.id = ? OR (lower(u.email) = lower(?) AND u.role = 'owner'))
       LIMIT 1`,
      [tenantId, user.id, user.email]
    );
    if (!u) {
      throw new HttpError(403, 'FORBIDDEN', 'Access denied: You do not have permission to access this business.');
    }
    const shop = await ctx.db.one('SELECT * FROM tenants WHERE id = ?', [u.tenantId]);
    return { token: issueToken(u), user: userView(u), shop: shopView(shop), perms: permsFor(u.role) };
  });
}
