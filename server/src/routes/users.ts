import { ROLES, type Role } from '../../../shared/types.ts';
import { audit } from '../audit.ts';
import { requirePerm } from '../auth.ts';
import { bad, conflict, notFound, V, type Router } from '../http.ts';
import { hashPassword, newId, passwordProblem } from '../security.ts';
import { parseEmail } from '../shopFields.ts';

const COLS = 'id, name, email, role, active, created_at, last_login_at';
const view = (u: any) => ({ id: u.id, name: u.name, email: u.email, role: u.role as Role, active: u.active, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt });
const has = (o: any, k: string) => o != null && Object.prototype.hasOwnProperty.call(o, k);

/** Staff management. Owner only (permission "users"). Every query is scoped to the signed-in shop. */
export function registerUsers(r: Router) {
  r.get('/api/users', requirePerm('users'), async (ctx) => {
    const rows = await ctx.db.query(`SELECT ${COLS} FROM users WHERE tenant_id = ? ORDER BY created_at, id`, [ctx.user!.tenantId]);
    return { users: rows.map(view), roles: ROLES };
  });

  r.post('/api/users', requirePerm('users'), async (ctx) => {
    const b = ctx.body ?? {};
    const name = V.str(b.name, 'Name', { required: true, max: 80 });
    const email = parseEmail(b.email);
    const role = V.oneOf(b.role, 'Role', ROLES);
    const pwErr = passwordProblem(b.password);
    if (pwErr) throw bad(pwErr, 'WEAK_PASSWORD', { field: 'Password' });
    if (await ctx.db.one('SELECT 1 AS x FROM users WHERE lower(email) = ?', [email])) throw conflict('Someone already uses this email', 'EMAIL_TAKEN');
    const id = newId('u');
    const hash = hashPassword(b.password);
    try {
      await ctx.db.tx(async (q) => {
        await q.exec('INSERT INTO users (id, tenant_id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)', [id, ctx.user!.tenantId, name, email, hash, role]);
        await audit(q, ctx, { action: 'user.create', entity: 'user', entityId: id, detail: { name, email, role } });
      });
    } catch (e: any) {
      if (e?.code === '23505' && String(e.constraint ?? '').includes('users_email')) throw conflict('Someone already uses this email', 'EMAIL_TAKEN');
      throw e;
    }
    return view(await ctx.db.one(`SELECT ${COLS} FROM users WHERE id = ?`, [id]));
  });

  r.patch('/api/users/:id', requirePerm('users'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;
    return ctx.db.tx(async (q) => {
      // Lock the shop's active owners first so two owners cannot demote each other at the same moment.
      await q.query(`SELECT id FROM users WHERE tenant_id = ? AND role = 'owner' AND active ORDER BY id FOR UPDATE`, [tenantId]);
      const t = await q.one(`SELECT ${COLS} FROM users WHERE id = ? AND tenant_id = ?`, [ctx.params.id, tenantId]);
      if (!t) throw notFound('User');
      const name = has(b, 'name') ? V.str(b.name, 'Name', { required: true, max: 80 }) : t.name;
      const role: Role = has(b, 'role') ? V.oneOf(b.role, 'Role', ROLES) : t.role;
      const active = has(b, 'active') ? V.bool(b.active) : t.active;
      if (name === t.name && role === t.role && active === t.active) return view(t);
      if (t.id === ctx.user!.id && (role !== t.role || !active)) {
        throw conflict('You cannot switch off yourself or change your own role. Ask another owner to do it.', 'SELF_CHANGE');
      }
      if (t.role === 'owner' && t.active && (role !== 'owner' || !active)) {
        const others = await q.one<{ n: number }>(`SELECT count(*) AS n FROM users WHERE tenant_id = ? AND role = 'owner' AND active AND id <> ?`, [tenantId, t.id]);
        if (!others || others.n < 1) throw conflict('The shop needs at least one active owner. Make someone else an owner first.', 'LAST_OWNER');
      }
      await q.exec('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ? AND tenant_id = ?', [name, role, active, t.id, tenantId]);
      const action = t.active && !active ? 'user.deactivate' : !t.active && active ? 'user.activate' : role !== t.role ? 'user.role_change' : 'user.update';
      await audit(q, ctx, { action, entity: 'user', entityId: t.id, detail: { before: { name: t.name, role: t.role, active: t.active }, after: { name, role, active } } });
      return view(await q.one(`SELECT ${COLS} FROM users WHERE id = ?`, [t.id]));
    });
  });

  // Owner sets a new password for a staff member who forgot theirs. Their old sessions stop working at once.
  r.post('/api/users/:id/reset-password', requirePerm('users'), async (ctx) => {
    const pwErr = passwordProblem(ctx.body?.newPassword);
    if (pwErr) throw bad(pwErr, 'WEAK_PASSWORD', { field: 'Password' });
    const t = await ctx.db.one('SELECT id FROM users WHERE id = ? AND tenant_id = ?', [ctx.params.id, ctx.user!.tenantId]);
    if (!t) throw notFound('User');
    const hash = hashPassword(ctx.body.newPassword);
    await ctx.db.tx(async (q) => {
      await q.exec('UPDATE users SET password_hash = ? WHERE id = ? AND tenant_id = ?', [hash, t.id, ctx.user!.tenantId]);
      await audit(q, ctx, { action: 'user.password_reset', entity: 'user', entityId: t.id });
    });
  });
}
