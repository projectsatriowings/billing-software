import { requirePerm } from '../auth.ts';
import { bad, conflict, notFound, V, type Router } from '../http.ts';
import { newId } from '../security.ts';
import { audit } from '../audit.ts';

export function registerCategories(r: Router) {
  // List categories with live item count
  r.get('/api/categories', requirePerm('items.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const includeInactive = ctx.query.includeInactive === '1' || ctx.query.includeInactive === 'true';

    let sql = 'SELECT * FROM categories WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];
    if (!includeInactive) {
      sql += ' AND active = true';
    }
    sql += ' ORDER BY name ASC';

    let rows = await ctx.db.query(sql, params);

    // Auto-discovery backward compatibility: If categories table is empty, initialize from items.category
    if (rows.length === 0) {
      const distinctItemCats = await ctx.db.query<{ category: string }>(
        'SELECT DISTINCT category FROM items WHERE tenant_id = ? AND category IS NOT NULL AND category <> \'\'',
        [tenantId],
      );
      if (distinctItemCats.length > 0) {
        for (const itemCat of distinctItemCats) {
          const catName = itemCat.category.trim();
          if (!catName) continue;
          const catId = newId('cat');
          try {
            await ctx.db.exec(
              'INSERT INTO categories (id, tenant_id, name, active) VALUES (?, ?, ?, true) ON CONFLICT DO NOTHING',
              [catId, tenantId, catName],
            );
          } catch {
            // ignore conflict
          }
        }
        rows = await ctx.db.query(sql, params);
      }
    }

    // Fetch item counts per category
    const itemCounts = await ctx.db.query<{ category: string; cnt: number }>(
      'SELECT category, COUNT(*)::int AS cnt FROM items WHERE tenant_id = ? AND active = true AND category IS NOT NULL GROUP BY category',
      [tenantId],
    );
    const countMap = new Map<string, number>();
    for (const c of itemCounts) {
      if (c.category) countMap.set(c.category.toLowerCase(), Number(c.cnt));
    }

    return {
      categories: rows.map((cat: any) => ({
        id: cat.id,
        tenantId: cat.tenantId ?? cat.tenant_id,
        name: cat.name,
        description: cat.description ?? null,
        active: Boolean(cat.active),
        createdAt: cat.createdAt ?? cat.created_at,
        itemCount: countMap.get(String(cat.name).toLowerCase()) ?? 0,
      })),
    };
  });

  // Create category
  r.post('/api/categories', requirePerm('items.write'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;

    const name = V.str(b.name, 'Category name', { required: true, max: 60 });
    const description = V.optStr(b.description, 'Description', 200);

    const existing = await ctx.db.one(
      'SELECT id FROM categories WHERE tenant_id = ? AND lower(name) = lower(?)',
      [tenantId, name],
    );
    if (existing) {
      throw conflict(`Category "${name}" already exists.`);
    }

    const id = newId('cat');
    await ctx.db.tx(async (q) => {
      await q.exec(
        'INSERT INTO categories (id, tenant_id, name, description, active) VALUES (?, ?, ?, ?, true)',
        [id, tenantId, name, description || null],
      );
      await audit(q, ctx, { action: 'category.create', entity: 'category', entityId: id, detail: { name } });
    });

    const created = await ctx.db.one('SELECT * FROM categories WHERE id = ? AND tenant_id = ?', [id, tenantId]);
    return {
      category: {
        id: created.id,
        tenantId: created.tenantId ?? created.tenant_id,
        name: created.name,
        description: created.description ?? null,
        active: Boolean(created.active),
        createdAt: created.createdAt ?? created.created_at,
        itemCount: 0,
      },
    };
  });

  // Update category
  r.patch('/api/categories/:id', requirePerm('items.write'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;
    const cat = await ctx.db.one('SELECT * FROM categories WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!cat) throw notFound('Category');

    const name = b.name !== undefined ? V.str(b.name, 'Category name', { required: true, max: 60 }) : cat.name;
    const description = b.description !== undefined ? V.optStr(b.description, 'Description', 200) : (cat.description ?? null);
    const active = b.active !== undefined ? V.bool(b.active) : Boolean(cat.active);

    if (name.toLowerCase() !== String(cat.name).toLowerCase()) {
      const dup = await ctx.db.one(
        'SELECT id FROM categories WHERE tenant_id = ? AND lower(name) = lower(?) AND id <> ?',
        [tenantId, name, cat.id],
      );
      if (dup) throw conflict(`Category "${name}" already exists.`);
    }

    await ctx.db.tx(async (q) => {
      await q.exec(
        'UPDATE categories SET name = ?, description = ?, active = ? WHERE id = ? AND tenant_id = ?',
        [name, description, active, cat.id, tenantId],
      );

      // Keep products connected if name changed
      if (name !== cat.name) {
        await q.exec(
          'UPDATE items SET category = ? WHERE tenant_id = ? AND category = ?',
          [name, tenantId, cat.name],
        );
      }

      await audit(q, ctx, { action: 'category.update', entity: 'category', entityId: cat.id, detail: { name, active } });
    });

    const updated = await ctx.db.one('SELECT * FROM categories WHERE id = ? AND tenant_id = ?', [cat.id, tenantId]);
    return {
      category: {
        id: updated.id,
        tenantId: updated.tenantId ?? updated.tenant_id,
        name: updated.name,
        description: updated.description ?? null,
        active: Boolean(updated.active),
        createdAt: updated.createdAt ?? updated.created_at,
      },
    };
  });

  // Safe deactivate category
  r.delete('/api/categories/:id', requirePerm('items.write'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const cat = await ctx.db.one('SELECT * FROM categories WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!cat) throw notFound('Category');

    await ctx.db.tx(async (q) => {
      await q.exec('UPDATE categories SET active = false WHERE id = ? AND tenant_id = ?', [cat.id, tenantId]);
      await audit(q, ctx, { action: 'category.deactivate', entity: 'category', entityId: cat.id });
    });

    return { ok: true };
  });
}
