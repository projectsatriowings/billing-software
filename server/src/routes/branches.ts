import { requirePerm, requireUser } from '../auth.ts';
import { audit } from '../audit.ts';
import { bad, conflict, notFound, V, type Router } from '../http.ts';
import { newId } from '../security.ts';
import { j } from '../db/index.ts';
import type { Branch, BranchInput } from '../../../shared/types.ts';

const parseCounters = (v: any): string[] => {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.map(String) : [v];
    } catch {
      return [v];
    }
  }
  return ['COUNTER-1'];
};

export const branchView = (b: any): Branch => ({
  id: b.id,
  code: b.code,
  name: b.name,
  address: b.address || null,
  phone: b.phone || null,
  active: Boolean(b.active ?? true),
  counters: parseCounters(b.counters),
  managerId: b.managerId ?? b.manager_id ?? null,
  managerName: b.managerName ?? b.manager_name ?? null,
  createdAt: b.createdAt ?? b.created_at,
  updatedAt: b.updatedAt ?? b.updated_at,
});

export function registerBranches(r: Router) {
  // 1. Get branches accessible to the user
  r.get('/api/branches', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const role = ctx.user!.role;

    // Super Admin / Owner: All company branches
    // Store Manager: Branches assigned in allowedLocations
    // Cashier: Assigned branch only
    let whereClause = 'WHERE b.tenant_id = ?';
    const params: unknown[] = [tenantId];

    if (role === 'manager') {
      const allowed = ctx.user!.allowedLocations || [ctx.user!.assignedLocation || 'MAIN'];
      whereClause += ` AND b.code IN (${allowed.map(() => '?').join(', ')})`;
      params.push(...allowed);
    } else if (role === 'cashier') {
      const assigned = ctx.user!.assignedLocation || 'MAIN';
      whereClause += ' AND b.code = ?';
      params.push(assigned);
    }

    const rows = await ctx.db.query<any>(
      `SELECT b.*, u.name AS manager_name
       FROM branches b
       LEFT JOIN users u ON u.id = b.manager_id
       ${whereClause}
       ORDER BY b.code = 'MAIN' DESC, b.code ASC`,
      params,
    );

    // If branches table is empty for this tenant (e.g. freshly registered), sync from tenant locations
    if (rows.length === 0 && role === 'owner') {
      const tenant = await ctx.db.one<any>('SELECT locations, name, address, phone FROM tenants WHERE id = ?', [tenantId]);
      const locations: string[] = Array.isArray(tenant?.locations)
        ? tenant.locations
        : (typeof tenant?.locations === 'string' ? JSON.parse(tenant.locations) : ['MAIN']);

      for (const loc of locations) {
        const branchId = newId('br');
        const code = loc.trim().toUpperCase();
        await ctx.db.exec(
          `INSERT INTO branches (id, tenant_id, code, name, address, phone, active, counters)
           VALUES (?, ?, ?, ?, ?, ?, TRUE, '["COUNTER-1"]')
           ON CONFLICT (tenant_id, code) DO NOTHING`,
          [branchId, tenantId, code, `${tenant?.name || 'Main'} (${code})`, tenant?.address || null, tenant?.phone || null],
        );
      }

      const syncedRows = await ctx.db.query<any>(
        `SELECT b.*, u.name AS manager_name
         FROM branches b
         LEFT JOIN users u ON u.id = b.manager_id
         WHERE b.tenant_id = ?
         ORDER BY b.code = 'MAIN' DESC, b.code ASC`,
        [tenantId],
      );
      return { branches: syncedRows.map(branchView) };
    }

    return { branches: rows.map(branchView) };
  });

  // 2. Create a new branch (Super Admin only)
  r.post('/api/branches', requirePerm('settings'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;

    const rawCode = V.str(b.code, 'Branch Code', { required: true, max: 20 });
    const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9_\-]/g, '');
    if (!code) throw bad('Branch code must contain alphanumeric characters (e.g. BR-NORTH, T-NAGAR)', 'VALIDATION');

    const name = V.str(b.name, 'Branch Name', { required: true, max: 100 });
    const address = V.optStr(b.address, 'Address', 300);
    const phone = V.optStr(b.phone, 'Phone', 30);
    const active = b.active !== undefined ? V.bool(b.active) : true;
    const managerId = V.optStr(b.managerId, 'Store Manager ID', 50);

    const countersList: string[] = Array.isArray(b.counters) && b.counters.length > 0
      ? Array.from(new Set(b.counters.map((c: any) => V.str(c, 'Counter', { required: true, max: 30 }).trim().toUpperCase())))
      : ['COUNTER-1'];

    // Check duplicate branch code within tenant
    const existing = await ctx.db.one('SELECT id FROM branches WHERE tenant_id = ? AND code = ?', [tenantId, code]);
    if (existing) throw conflict(`Branch with code "${code}" already exists in this company.`, 'DUPLICATE_BRANCH');

    // Verify manager exists in this tenant if provided
    if (managerId) {
      const mgr = await ctx.db.one('SELECT id, role FROM users WHERE id = ? AND tenant_id = ?', [managerId, tenantId]);
      if (!mgr) throw notFound('Store Manager');
      if (mgr.role !== 'manager' && mgr.role !== 'owner') {
        throw bad('Selected user must have Store Manager or Owner role.', 'INVALID_ROLE');
      }
    }

    const branchId = newId('br');
    await ctx.db.tx(async (q) => {
      await q.exec(
        `INSERT INTO branches (id, tenant_id, code, name, address, phone, active, counters, manager_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?)`,
        [branchId, tenantId, code, name, address, phone, active, j(countersList), managerId || null],
      );

      // Keep tenants.locations in sync
      const t = await q.one<any>('SELECT locations FROM tenants WHERE id = ?', [tenantId]);
      const curLocs: string[] = Array.isArray(t?.locations)
        ? t.locations
        : (typeof t?.locations === 'string' ? JSON.parse(t.locations) : ['MAIN']);
      if (!curLocs.includes(code)) {
        curLocs.push(code);
        await q.exec('UPDATE tenants SET locations = ?::jsonb WHERE id = ?', [j(curLocs), tenantId]);
      }

      // If manager assigned, add branch to manager's allowed_locations
      if (managerId) {
        const mgrUser = await q.one<any>('SELECT allowed_locations FROM users WHERE id = ?', [managerId]);
        const mgrAllowed: string[] = Array.isArray(mgrUser?.allowedLocations || mgrUser?.allowed_locations)
          ? (mgrUser.allowedLocations || mgrUser.allowed_locations)
          : ['MAIN'];
        if (!mgrAllowed.includes(code)) {
          mgrAllowed.push(code);
          await q.exec('UPDATE users SET allowed_locations = ?::jsonb WHERE id = ?', [j(mgrAllowed), managerId]);
        }
      }

      await audit(q, ctx, {
        action: 'branch.create',
        entity: 'branch',
        entityId: branchId,
        detail: { code, name, counters: countersList, managerId },
      });
    });

    const row = await ctx.db.one<any>(
      `SELECT b.*, u.name AS manager_name
       FROM branches b
       LEFT JOIN users u ON u.id = b.manager_id
       WHERE b.id = ?`,
      [branchId],
    );
    return branchView(row);
  });

  // 3. Update branch (Super Admin or Store Manager updating assigned branch counters)
  r.patch('/api/branches/:id', requirePerm('branches'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;
    const branchId = ctx.params.id;
    const isOwner = ctx.user!.role === 'owner';

    return ctx.db.tx(async (q) => {
      const cur = await q.one<any>('SELECT * FROM branches WHERE id = ? AND tenant_id = ?', [branchId, tenantId]);
      if (!cur) throw notFound('Branch');

      // If store manager, verify this branch is in their allowed locations
      if (!isOwner) {
        const allowed = new Set(ctx.user!.allowedLocations || [ctx.user!.assignedLocation || 'MAIN']);
        if (!allowed.has(cur.code)) {
          throw bad('You can only manage counters for your authorized branches.', 'FORBIDDEN');
        }
      }

      // Owner can update code
      let code = cur.code;
      if (isOwner && b.code !== undefined) {
        const rawCode = V.str(b.code, 'Branch Code', { required: true, max: 20 });
        const sanitizedCode = rawCode.trim().toUpperCase().replace(/[^A-Z0-9_\-]/g, '');
        if (!sanitizedCode) {
          throw bad('Branch code must contain alphanumeric characters (e.g. BR-NORTH, T-NAGAR)', 'VALIDATION');
        }
        if (sanitizedCode !== cur.code) {
          const dup = await q.one('SELECT id FROM branches WHERE tenant_id = ? AND code = ? AND id != ?', [tenantId, sanitizedCode, branchId]);
          if (dup) {
            throw conflict(`Branch with code "${sanitizedCode}" already exists in this company.`, 'DUPLICATE_BRANCH');
          }
          code = sanitizedCode;
        }
      }

      const name = isOwner && b.name !== undefined ? V.str(b.name, 'Branch Name', { required: true, max: 100 }) : cur.name;
      const address = isOwner && b.address !== undefined ? V.optStr(b.address, 'Address', 300) : cur.address;
      const phone = isOwner && b.phone !== undefined ? V.optStr(b.phone, 'Phone', 30) : cur.phone;
      const active = isOwner && b.active !== undefined ? V.bool(b.active) : cur.active;

      let counters = parseCounters(cur.counters);
      if (b.counters !== undefined) {
        if (!Array.isArray(b.counters) || b.counters.length === 0) {
          throw bad('A branch must have at least one counter.', 'VALIDATION');
        }
        counters = Array.from(new Set(b.counters.map((c: any) => V.str(c, 'Counter', { required: true, max: 30 }).trim().toUpperCase())));
        if (counters.length === 0) {
          throw bad('A branch must have at least one counter.', 'VALIDATION');
        }
      }

      let managerId = cur.manager_id;
      if (isOwner && b.managerId !== undefined) {
        managerId = V.optStr(b.managerId, 'Store Manager ID', 50);
        if (managerId) {
          const mgr = await q.one('SELECT id, role FROM users WHERE id = ? AND tenant_id = ?', [managerId, tenantId]);
          if (!mgr) throw notFound('Store Manager');
          if (mgr.role !== 'manager' && mgr.role !== 'owner') {
            throw bad('Selected user must have Store Manager or Owner role.', 'INVALID_ROLE');
          }
        }
      }

      // If branch code changed, cascade update location in all related records
      if (code !== cur.code) {
        // Sync tenants.locations
        const t = await q.one<any>('SELECT locations FROM tenants WHERE id = ?', [tenantId]);
        const curLocs: string[] = Array.isArray(t?.locations)
          ? t.locations
          : (typeof t?.locations === 'string' ? JSON.parse(t.locations) : ['MAIN']);
        const updatedLocs = curLocs.map((loc: string) => (loc === cur.code ? code : loc));
        if (!updatedLocs.includes(code)) {
          updatedLocs.push(code);
        }
        await q.exec('UPDATE tenants SET locations = ?::jsonb WHERE id = ?', [j(updatedLocs), tenantId]);

        // Sync users assigned_location
        await q.exec('UPDATE users SET assigned_location = ? WHERE tenant_id = ? AND assigned_location = ?', [code, tenantId, cur.code]);

        // Sync users allowed_locations
        const tenantUsers = await q.query<any>('SELECT id, allowed_locations FROM users WHERE tenant_id = ?', [tenantId]);
        for (const u of tenantUsers) {
          const userAllowed: string[] = Array.isArray(u.allowed_locations)
            ? u.allowed_locations
            : (typeof u.allowed_locations === 'string' ? JSON.parse(u.allowed_locations) : []);
          if (userAllowed.includes(cur.code)) {
            const newAllowed = userAllowed.map((l: string) => (l === cur.code ? code : l));
            await q.exec('UPDATE users SET allowed_locations = ?::jsonb WHERE id = ?', [j(newAllowed), u.id]);
          }
        }

        // Preserve and re-link transaction and movement records
        await q.exec('UPDATE invoices SET location = ? WHERE tenant_id = ? AND location = ?', [code, tenantId, cur.code]);
        await q.exec('UPDATE payments SET location = ? WHERE tenant_id = ? AND location = ?', [code, tenantId, cur.code]);
        await q.exec('UPDATE shifts SET location = ? WHERE tenant_id = ? AND location = ?', [code, tenantId, cur.code]);
        await q.exec('UPDATE expenses SET location = ? WHERE tenant_id = ? AND location = ?', [code, tenantId, cur.code]);
        await q.exec('UPDATE stock_moves SET location = ? WHERE tenant_id = ? AND location = ?', [code, tenantId, cur.code]);
        await q.exec('UPDATE stock_counts SET location = ? WHERE tenant_id = ? AND location = ?', [code, tenantId, cur.code]);
      }

      await q.exec(
        `UPDATE branches 
         SET code = ?, name = ?, address = ?, phone = ?, active = ?, counters = ?::jsonb, manager_id = ?, updated_at = now()
         WHERE id = ? AND tenant_id = ?`,
        [code, name, address, phone, active, j(counters), managerId || null, branchId, tenantId],
      );

      // If new manager assigned, ensure allowed_locations includes branch code
      if (managerId && managerId !== cur.manager_id) {
        const mgrUser = await q.one<any>('SELECT allowed_locations FROM users WHERE id = ?', [managerId]);
        const mgrAllowed: string[] = Array.isArray(mgrUser?.allowedLocations || mgrUser?.allowed_locations)
          ? (mgrUser.allowedLocations || mgrUser.allowed_locations)
          : ['MAIN'];
        if (!mgrAllowed.includes(code)) {
          mgrAllowed.push(code);
          await q.exec('UPDATE users SET allowed_locations = ?::jsonb WHERE id = ?', [j(mgrAllowed), managerId]);
        }
      }

      // If counters list changed, ensure active staff assigned to this branch have a valid counter
      if (b.counters !== undefined && counters.length > 0) {
        const primaryCounter = counters[0];
        const staffInBranch = await q.query<any>(
          'SELECT id, assigned_counter FROM users WHERE tenant_id = ? AND assigned_location = ?',
          [tenantId, code],
        );
        for (const st of staffInBranch) {
          if (!counters.includes(st.assigned_counter)) {
            await q.exec('UPDATE users SET assigned_counter = ? WHERE id = ?', [primaryCounter, st.id]);
          }
        }
      }

      await audit(q, ctx, {
        action: 'branch.update',
        entity: 'branch',
        entityId: branchId,
        detail: {
          before: { code: cur.code, name: cur.name, active: cur.active, counters: cur.counters, managerId: cur.manager_id },
          after: { code, name, active, counters, managerId },
        },
      });

      const updated = await q.one<any>(
        `SELECT b.*, u.name AS manager_name
         FROM branches b
         LEFT JOIN users u ON u.id = b.manager_id
         WHERE b.id = ?`,
        [branchId],
      );
      return branchView(updated);
    });
  });

  // 4. Detailed branch metrics summary
  r.get('/api/branches/:id/summary', requirePerm('branches'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const branchId = ctx.params.id;
    const branch = await ctx.db.one<any>('SELECT * FROM branches WHERE id = ? AND tenant_id = ?', [branchId, tenantId]);
    if (!branch) throw notFound('Branch');

    // Permission check for manager
    if (ctx.user!.role === 'manager') {
      const allowed = new Set(ctx.user!.allowedLocations || [ctx.user!.assignedLocation || 'MAIN']);
      if (!allowed.has(branch.code)) throw bad('Unauthorized branch access.', 'FORBIDDEN');
    }

    const loc = branch.code;
    const todayStr = new Date().toISOString().slice(0, 10);

    // Sales in this branch
    const sales = await ctx.db.one<{ count: number; total: number }>(
      `SELECT COUNT(*)::int AS count, COALESCE(SUM(total_minor), 0)::bigint AS total
       FROM invoices
       WHERE tenant_id = ? AND location = ? AND bdate = ? AND status = 'posted' AND kind = 'sale'`,
      [tenantId, loc, todayStr],
    );

    // Collections in this branch
    const collections = await ctx.db.one<{ total: number }>(
      `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS total
       FROM payments
       WHERE tenant_id = ? AND location = ? AND (status IS NULL OR status = 'posted')
         AND (bdate = ? OR (payment_date IS NOT NULL AND payment_date::date = ?::date))`,
      [tenantId, loc, todayStr, todayStr],
    );

    // Active shifts in this branch
    const activeShifts = await ctx.db.query<any>(
      `SELECT s.*, u.name AS cashier_name
       FROM shifts s
       JOIN users u ON u.id = s.user_id
       WHERE s.tenant_id = ? AND s.location = ? AND s.status = 'open'
       ORDER BY s.opened_at DESC`,
      [tenantId, loc],
    );

    // Closed shifts awaiting review in this branch
    const pendingReviewShifts = await ctx.db.query<any>(
      `SELECT s.*, u.name AS cashier_name, cu.name AS closed_by_name
       FROM shifts s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN users cu ON cu.id = s.closed_by
       WHERE s.tenant_id = ? AND s.location = ? AND s.status = 'closed' AND s.reviewed_by IS NULL
       ORDER BY s.closed_at DESC
       LIMIT 5`,
      [tenantId, loc],
    );

    // Low stock alerts at this branch location
    const lowStock = await ctx.db.query<any>(
      `SELECT it.id, it.name, it.sku, COALESCE(SUM(sm.qty_milli), 0)::bigint AS stock, it.reorder_milli AS reorder
       FROM items it
       LEFT JOIN stock_moves sm ON sm.item_id = it.id AND sm.tenant_id = it.tenant_id AND sm.location = ?
       WHERE it.tenant_id = ? AND it.active = TRUE AND it.track_stock = TRUE
       GROUP BY it.id, it.name, it.sku, it.reorder_milli
       HAVING COALESCE(SUM(sm.qty_milli), 0) <= 20000
       LIMIT 5`,
      [loc, tenantId],
    );

    // Staff assigned to this branch
    const staff = await ctx.db.query<any>(
      `SELECT id, name, email, role, active, assigned_counter
       FROM users
       WHERE tenant_id = ? AND assigned_location = ?
       ORDER BY role, name`,
      [tenantId, loc],
    );

    return {
      branch: branchView(branch),
      todaySalesCount: Number(sales?.count ?? 0),
      todaySalesTotalMinor: Number(sales?.total ?? 0),
      todayCollectionsMinor: Number(collections?.total ?? 0),
      activeShiftsCount: activeShifts.length,
      activeShifts: activeShifts.map((s) => ({
        id: s.id,
        shiftNumber: s.shiftNumber ?? s.shift_number,
        cashierName: s.cashierName ?? s.cashier_name,
        counter: s.counter || 'COUNTER-1',
        openedAt: s.openedAt ?? s.opened_at,
        openingCashMinor: Number(s.openingCashMinor ?? s.opening_cash_minor ?? 0),
      })),
      pendingReviewShiftsCount: pendingReviewShifts.length,
      pendingReviewShifts: pendingReviewShifts.map((s) => ({
        id: s.id,
        shiftNumber: s.shiftNumber ?? s.shift_number,
        cashierName: s.cashierName ?? s.cashier_name,
        closedAt: s.closedAt ?? s.closed_at,
        varianceMinor: s.varianceMinor !== null && s.varianceMinor !== undefined
          ? Number(s.varianceMinor ?? s.variance_minor)
          : 0,
      })),
      lowStockCount: lowStock.length,
      lowStock: lowStock.map((l) => ({
        id: l.id,
        name: l.name,
        sku: l.sku,
        stockMilli: Number(l.stock ?? 0),
      })),
      staff: staff.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        active: u.active,
        counter: u.assignedCounter ?? u.assigned_counter,
      })),
    };
  });

  // Permanently delete branch & reclaim DB storage
  r.delete('/api/branches/:id', requirePerm('settings'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const branch = await ctx.db.one('SELECT * FROM branches WHERE (id = ? OR code = ?) AND tenant_id = ?', [ctx.params.id, ctx.params.id, tenantId]);
    if (!branch) throw notFound('Branch');
    if (branch.code === 'MAIN') throw bad('Cannot delete Central Main Branch (MAIN)', 'MAIN_PROTECTED');

    await ctx.db.tx(async (q) => {
      await q.exec('DELETE FROM branch_inventory WHERE branch_id = ? AND tenant_id = ?', [branch.id, tenantId]);
      await q.exec('DELETE FROM branches WHERE id = ? AND tenant_id = ?', [branch.id, tenantId]);
      await audit(q, ctx, { action: 'branch.delete', entity: 'branch', entityId: branch.id, detail: { name: branch.name, code: branch.code } });
    });

    return { ok: true, deleted: branch.id };
  });
}
