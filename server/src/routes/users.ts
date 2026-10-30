import { ROLES, type Role } from '../../../shared/types.ts';
import { audit } from '../audit.ts';
import { requirePerm } from '../auth.ts';
import { bad, conflict, notFound, V, type Router } from '../http.ts';
import { hashPassword, newId, passwordProblem } from '../security.ts';
import { parseEmail } from '../shopFields.ts';
import { j } from '../db/index.ts';

const view = (u: any) => {
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
    employeeId: u.id,
    name: u.name,
    email: u.email,
    role: u.role as Role,
    active: u.active,
    assignedLocation,
    assignedCounter,
    allowedLocations,
    createdAt: u.createdAt ?? u.created_at,
    lastLoginAt: u.lastLoginAt ?? u.last_login_at,
  };
};
const has = (o: any, k: string) => o != null && Object.prototype.hasOwnProperty.call(o, k);

/** Staff management. Owner and Store Manager (for assigned branch cashiers). */
export function registerUsers(r: Router) {
  r.get('/api/users', requirePerm('users'), async (ctx) => {
    const isManager = ctx.user!.role === 'manager';
    let rows = await ctx.db.query(`SELECT * FROM users WHERE tenant_id = ? ORDER BY created_at, id`, [ctx.user!.tenantId]);
    if (isManager) {
      const allowed = new Set(ctx.user!.allowedLocations || [ctx.user!.assignedLocation || 'MAIN']);
      rows = rows.filter((u: any) => allowed.has(u.assignedLocation || u.assigned_location || 'MAIN'));
    }
    return { users: rows.map(view), roles: ROLES };
  });

  r.post('/api/users', requirePerm('users'), async (ctx) => {
    const b = ctx.body ?? {};
    const name = V.str(b.name, 'Name', { required: true, max: 80 });
    const role = V.oneOf(b.role, 'Role', ROLES);
    const pwErr = passwordProblem(b.password);
    if (pwErr) throw bad(pwErr, 'WEAK_PASSWORD', { field: 'Password' });

    // Store manager restrictions
    const isManager = ctx.user!.role === 'manager';
    if (isManager) {
      if (role !== 'cashier') {
        throw bad('Store Managers can only create Cashier accounts.', 'FORBIDDEN_ROLE');
      }
    }

    let id: string;
    let email: string;
    if (role === 'cashier') {
      const customId = V.optStr(b.employeeId, 'Employee ID', 50)?.trim().toUpperCase();
      const employeeId = customId || ('CSH-' + Math.floor(1000 + Math.random() * 9000));
      id = employeeId;
      if (b.email && String(b.email).trim()) {
        email = parseEmail(b.email);
      } else {
        email = `${employeeId.toLowerCase()}@billing.local`;
      }
    } else {
      email = parseEmail(b.email);
      id = newId('u');
    }

    const assignedLocation = V.optStr(b.assignedLocation, 'Assigned location', 50) || (isManager ? (ctx.user!.assignedLocation || 'MAIN') : 'MAIN');
    const assignedCounter = V.optStr(b.assignedCounter, 'Assigned counter', 50) || 'COUNTER-1';
    let allowedLocations: string[] = [assignedLocation];
    if (Array.isArray(b.allowedLocations) && b.allowedLocations.length > 0) {
      allowedLocations = b.allowedLocations.map((l: any) => V.str(l, 'Branch', { required: true, max: 50 }));
    }

    if (isManager) {
      const allowed = new Set(ctx.user!.allowedLocations || [ctx.user!.assignedLocation || 'MAIN']);
      if (!allowed.has(assignedLocation)) {
        throw bad(`You cannot assign cashiers to branch "${assignedLocation}" outside your authorized branches.`, 'UNAUTHORIZED_BRANCH');
      }
    }

    const existing = await ctx.db.one(
      'SELECT id, email FROM users WHERE upper(id) = ? OR lower(email) = ?',
      [id.toUpperCase(), email.toLowerCase()]
    );
    if (existing) {
      if (existing.email.toLowerCase() === email.toLowerCase()) {
        throw conflict('Someone already uses this email', 'EMAIL_TAKEN');
      }
      throw conflict(`Employee ID "${id}" is already in use. Please choose another.`, 'EMPLOYEE_ID_TAKEN');
    }

    const hash = hashPassword(b.password);
    try {
      await ctx.db.tx(async (q) => {
        await q.exec(
          'INSERT INTO users (id, tenant_id, name, email, password_hash, role, assigned_location, assigned_counter, allowed_locations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)',
          [id, ctx.user!.tenantId, name, email, hash, role, assignedLocation, assignedCounter, j(allowedLocations)],
        );
        await audit(q, ctx, { action: 'user.create', entity: 'user', entityId: id, detail: { name, email, role, assignedLocation, assignedCounter, employeeId: id } });
      });
    } catch (e: any) {
      if (e?.code === '23505') {
        if (String(e.constraint ?? '').includes('users_email')) throw conflict('Someone already uses this email', 'EMAIL_TAKEN');
        if (String(e.constraint ?? '').includes('users_pkey')) throw conflict(`Employee ID "${id}" is already in use. Please choose another.`, 'EMPLOYEE_ID_TAKEN');
      }
      throw e;
    }
    return view(await ctx.db.one(`SELECT * FROM users WHERE id = ?`, [id]));
  });

  r.patch('/api/users/:id', requirePerm('users'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;
    const isManager = ctx.user!.role === 'manager';

    return ctx.db.tx(async (q) => {
      // Lock the shop's active owners first so two owners cannot demote each other at the same moment.
      await q.query(`SELECT id FROM users WHERE tenant_id = ? AND role = 'owner' AND active ORDER BY id FOR UPDATE`, [tenantId]);
      const t = await q.one(`SELECT * FROM users WHERE id = ? AND tenant_id = ?`, [ctx.params.id, tenantId]);
      if (!t) throw notFound('User');

      if (isManager) {
        if (t.role !== 'cashier') throw bad('Store managers can only manage cashier accounts', 'FORBIDDEN');
        const allowed = new Set(ctx.user!.allowedLocations || [ctx.user!.assignedLocation || 'MAIN']);
        const targetLoc = t.assignedLocation || t.assigned_location || 'MAIN';
        if (!allowed.has(targetLoc)) throw bad('You cannot manage staff outside your authorized branches', 'UNAUTHORIZED_BRANCH');
      }

      const name = has(b, 'name') ? V.str(b.name, 'Name', { required: true, max: 80 }) : t.name;
      const role: Role = has(b, 'role') ? V.oneOf(b.role, 'Role', ROLES) : t.role;
      if (isManager && role !== 'cashier') throw bad('Store managers cannot change user roles', 'FORBIDDEN');
      const active = has(b, 'active') ? V.bool(b.active) : t.active;

      const assignedLocation = has(b, 'assignedLocation')
        ? V.optStr(b.assignedLocation, 'Assigned location', 50) || 'MAIN'
        : (t.assignedLocation || t.assigned_location || 'MAIN');
      const assignedCounter = has(b, 'assignedCounter')
        ? V.optStr(b.assignedCounter, 'Assigned counter', 50) || 'COUNTER-1'
        : (t.assignedCounter || t.assigned_counter || 'COUNTER-1');
      const allowedLocations = has(b, 'allowedLocations') && Array.isArray(b.allowedLocations)
        ? b.allowedLocations.map((l: any) => V.str(l, 'Branch', { required: true, max: 50 }))
        : (t.allowedLocations || t.allowed_locations || [assignedLocation]);

      if (t.id === ctx.user!.id && (role !== t.role || !active)) {
        throw conflict('You cannot switch off yourself or change your own role. Ask another owner to do it.', 'SELF_CHANGE');
      }
      if (t.role === 'owner' && t.active && (role !== 'owner' || !active)) {
        const others = await q.one<{ n: number }>(`SELECT count(*) AS n FROM users WHERE tenant_id = ? AND role = 'owner' AND active AND id <> ?`, [tenantId, t.id]);
        if (!others || others.n < 1) throw conflict('The shop needs at least one active owner. Make someone else an owner first.', 'LAST_OWNER');
      }
      await q.exec(
        'UPDATE users SET name = ?, role = ?, active = ?, assigned_location = ?, assigned_counter = ?, allowed_locations = ?::jsonb WHERE id = ? AND tenant_id = ?',
        [name, role, active, assignedLocation, assignedCounter, j(allowedLocations), t.id, tenantId],
      );
      const action = t.active && !active ? 'user.deactivate' : !t.active && active ? 'user.activate' : role !== t.role ? 'user.role_change' : 'user.update';
      await audit(q, ctx, { action, entity: 'user', entityId: t.id, detail: { before: { name: t.name, role: t.role, active: t.active }, after: { name, role, active, assignedLocation, assignedCounter } } });
      return view(await q.one(`SELECT * FROM users WHERE id = ?`, [t.id]));
    });
  });

  // Owner or Store Manager sets a new password for a staff member who forgot theirs. Their old sessions stop working at once.
  r.post('/api/users/:id/reset-password', requirePerm('users'), async (ctx) => {
    const pwErr = passwordProblem(ctx.body?.newPassword);
    if (pwErr) throw bad(pwErr, 'WEAK_PASSWORD', { field: 'Password' });
    const isManager = ctx.user!.role === 'manager';
    const t = await ctx.db.one(
      'SELECT id, role, assigned_location FROM users WHERE (id = ? OR upper(id) = ?) AND tenant_id = ?',
      [ctx.params.id, ctx.params.id.toUpperCase(), ctx.user!.tenantId]
    );
    if (!t) throw notFound('User');
    if (isManager) {
      if (t.role !== 'cashier') throw bad('Store Managers can only reset Cashier passwords.', 'FORBIDDEN_ROLE');
      const allowed = new Set(ctx.user!.allowedLocations || [ctx.user!.assignedLocation || 'MAIN']);
      if (!allowed.has(t.assignedLocation || t.assigned_location || 'MAIN')) {
        throw bad('You cannot reset passwords for staff outside your authorized branches.', 'UNAUTHORIZED_BRANCH');
      }
    }
    const hash = hashPassword(ctx.body.newPassword);
    await ctx.db.tx(async (q) => {
      await q.exec('UPDATE users SET password_hash = ? WHERE id = ? AND tenant_id = ?', [hash, t.id, ctx.user!.tenantId]);
      await audit(q, ctx, { action: 'user.password_reset', entity: 'user', entityId: t.id });
    });
    return { ok: true, message: 'Password reset successfully' };
  });

  // Permanently delete user & reclaim DB storage
  r.delete('/api/users/:id', requirePerm('users'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const target = await ctx.db.one('SELECT * FROM users WHERE (id = ? OR lower(email) = lower(?)) AND tenant_id = ?', [ctx.params.id, ctx.params.id, tenantId]);
    if (!target) throw notFound('User');
    if (target.id === ctx.user!.id) throw conflict('You cannot delete your own account.', 'SELF_DELETE');

    if (target.role === 'owner') {
      const others = await ctx.db.one<{ n: number }>(`SELECT count(*) AS n FROM users WHERE tenant_id = ? AND role = 'owner' AND active AND id <> ?`, [tenantId, target.id]);
      if (!others || others.n < 1) throw conflict('Cannot delete the only owner account of this store.', 'LAST_OWNER');
    }

    await ctx.db.tx(async (q) => {
      await q.exec('UPDATE branches SET manager_id = NULL WHERE manager_id = ? AND tenant_id = ?', [target.id, tenantId]);
      await q.exec('DELETE FROM users WHERE id = ? AND tenant_id = ?', [target.id, tenantId]);
      await audit(q, ctx, { action: 'user.delete', entity: 'user', entityId: target.id, detail: { name: target.name, email: target.email, role: target.role } });
    });

    return { ok: true, deleted: target.id };
  });
}
