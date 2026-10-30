import { requirePerm } from '../auth.ts';
import { bad, conflict, notFound, FileResponse, V, type Router } from '../http.ts';
import { newId } from '../security.ts';
import { audit } from '../audit.ts';
import {
  CATEGORY_SAMPLE_TEMPLATE_CSV,
  parseCategoryCsv,
  validateAndPlanCategoryImport,
  type CategoryImportRow,
} from '../../../shared/categories.ts';

export function registerCategories(r: Router) {
  // 1. Download sample CSV import template
  r.get('/api/categories/template', requirePerm('items.view'), async () => {
    return new FileResponse(
      CATEGORY_SAMPLE_TEMPLATE_CSV,
      'text/csv; charset=utf-8',
      'category_sample_template.csv',
    );
  });

  // 2. List categories with parent hierarchy and live product item count
  r.get('/api/categories', requirePerm('items.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const includeInactive = ctx.query.includeInactive === '1' || ctx.query.includeInactive === 'true';

    let sql = `
      SELECT c.*, p.name AS parent_name
      FROM categories c
      LEFT JOIN categories p ON p.id = c.parent_id AND p.tenant_id = c.tenant_id
      WHERE c.tenant_id = ?
    `;
    const params: unknown[] = [tenantId];
    if (!includeInactive) {
      sql += ' AND c.active = true';
    }
    sql += ' ORDER BY COALESCE(p.name, c.name) ASC, c.parent_id NULLS FIRST, c.name ASC';

    let rows = await ctx.db.query(sql, params);

    // Auto-discovery from products: Only register categories that do NOT exist yet
    const distinctItemCats = await ctx.db.query<{ category: string }>(
      'SELECT DISTINCT category FROM items WHERE tenant_id = ? AND category IS NOT NULL AND category <> \'\'',
      [tenantId],
    );
    if (distinctItemCats.length > 0) {
      const existingNames = new Set(rows.map((r: any) => (r.name || '').trim().toLowerCase()));
      let insertedNew = false;
      for (const itemCat of distinctItemCats) {
        const catName = itemCat.category.trim();
        if (!catName || existingNames.has(catName.toLowerCase())) continue;

        let parentName: string | null = null;
        let leafName = catName;
        for (const sep of ['→', '->', '>', '/']) {
          if (catName.includes(sep)) {
            const parts = catName.split(sep).map((s) => s.trim());
            if (parts.length === 2 && parts[0] && parts[1]) {
              parentName = parts[0];
              leafName = parts[1];
              break;
            }
          }
        }

        try {
          if (parentName) {
            let parent = await ctx.db.one<{ id: string }>(
              'SELECT id FROM categories WHERE tenant_id = ? AND lower(name) = lower(?)',
              [tenantId, parentName],
            );
            if (!parent && !existingNames.has(parentName.toLowerCase())) {
              const pId = newId('cat');
              await ctx.db.exec(
                'INSERT INTO categories (id, tenant_id, name, active) VALUES (?, ?, ?, true) ON CONFLICT (tenant_id, lower(name)) DO NOTHING',
                [pId, tenantId, parentName],
              );
              existingNames.add(parentName.toLowerCase());
              parent = await ctx.db.one<{ id: string }>(
                'SELECT id FROM categories WHERE tenant_id = ? AND lower(name) = lower(?)',
                [tenantId, parentName],
              );
              insertedNew = true;
            }
            if (!existingNames.has(leafName.toLowerCase())) {
              const catId = newId('cat');
              const res = await ctx.db.exec(
                'INSERT INTO categories (id, tenant_id, name, parent_id, active) VALUES (?, ?, ?, ?, true) ON CONFLICT (tenant_id, lower(name)) DO NOTHING',
                [catId, tenantId, leafName, parent?.id ?? null],
              );
              if (res) {
                existingNames.add(leafName.toLowerCase());
                insertedNew = true;
              }
            }
          } else {
            if (!existingNames.has(catName.toLowerCase())) {
              const catId = newId('cat');
              const res = await ctx.db.exec(
                'INSERT INTO categories (id, tenant_id, name, active) VALUES (?, ?, ?, true) ON CONFLICT (tenant_id, lower(name)) DO NOTHING',
                [catId, tenantId, catName],
              );
              if (res) {
                existingNames.add(catName.toLowerCase());
                insertedNew = true;
              }
            }
          }
        } catch {
          // ignore duplicate
        }
      }
      if (insertedNew) {
        rows = await ctx.db.query(sql, params);
      }
    }

    // Fetch item counts per category (aggregating on items.category name)
    const itemCounts = await ctx.db.query<{ category: string; cnt: number }>(
      'SELECT category, COUNT(*)::int AS cnt FROM items WHERE tenant_id = ? AND active = true AND category IS NOT NULL GROUP BY category',
      [tenantId],
    );
    const countMap = new Map<string, number>();
    for (const c of itemCounts) {
      if (c.category) countMap.set(c.category.toLowerCase(), Number(c.cnt));
    }

    return {
      categories: rows.map((cat: any) => {
        const nameLower = String(cat.name).toLowerCase();
        const directCount = countMap.get(nameLower) ?? 0;
        const pName = cat.parentName ?? cat.parent_name;
        const hierarchyCount = pName
          ? (countMap.get(`${pName} → ${cat.name}`.toLowerCase()) ??
             countMap.get(`${pName} -> ${cat.name}`.toLowerCase()) ??
             countMap.get(`${pName} > ${cat.name}`.toLowerCase()) ??
             countMap.get(`${pName} / ${cat.name}`.toLowerCase()) ?? 0)
          : 0;
        return {
          id: cat.id,
          tenantId: cat.tenantId ?? cat.tenant_id,
          name: cat.name,
          description: cat.description ?? null,
          active: Boolean(cat.active),
          parentId: cat.parentId ?? cat.parent_id ?? null,
          parentName: pName ?? null,
          createdAt: cat.createdAt ?? cat.created_at,
          itemCount: directCount + hierarchyCount,
        };
      }),
    };
  });

  // 3. Create category or subcategory
  r.post('/api/categories', requirePerm('items.write'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;

    const name = V.str(b.name, 'Category name', { required: true, max: 60 });
    const description = V.optStr(b.description, 'Description', 200);
    const parentId = V.optStr(b.parentId ?? b.parent_id, 'Parent category', 60);

    // Validate parent ownership and hierarchy depth
    if (parentId) {
      const parent = await ctx.db.one<{ id: string; name: string; parent_id: string | null }>(
        'SELECT id, name, parent_id FROM categories WHERE id = ? AND tenant_id = ?',
        [parentId, tenantId],
      );
      if (!parent) {
        throw bad('Parent category not found.', 'VALIDATION', { field: 'parentId' });
      }
      if (parent.parent_id) {
        throw bad('Cannot nest categories deeper than 2 levels (Main Category → Subcategory).', 'VALIDATION', { field: 'parentId' });
      }
    }

    // Case-insensitive duplicate check within same tenant
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
        'INSERT INTO categories (id, tenant_id, name, description, parent_id, active) VALUES (?, ?, ?, ?, ?, true)',
        [id, tenantId, name, description || null, parentId || null],
      );
      await audit(q, ctx, {
        action: 'category.create',
        entity: 'category',
        entityId: id,
        detail: { name, parentId: parentId || null },
      });
    });

    const created = await ctx.db.one(
      `SELECT c.*, p.name AS parent_name
       FROM categories c
       LEFT JOIN categories p ON p.id = c.parent_id AND p.tenant_id = c.tenant_id
       WHERE c.id = ? AND c.tenant_id = ?`,
      [id, tenantId],
    );

    return {
      category: {
        id: created.id,
        tenantId: created.tenantId ?? created.tenant_id,
        name: created.name,
        description: created.description ?? null,
        active: Boolean(created.active),
        parentId: created.parentId ?? created.parent_id ?? null,
        parentName: created.parentName ?? created.parent_name ?? null,
        createdAt: created.createdAt ?? created.created_at,
        itemCount: 0,
      },
    };
  });

  // 4. Update category (rename, edit description, change parent, toggle active)
  r.patch('/api/categories/:id', requirePerm('items.write'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;
    const cat = await ctx.db.one(
      'SELECT * FROM categories WHERE id = ? AND tenant_id = ?',
      [ctx.params.id, tenantId],
    );
    if (!cat) throw notFound('Category');

    const name = b.name !== undefined ? V.str(b.name, 'Category name', { required: true, max: 60 }) : cat.name;
    const description = b.description !== undefined ? V.optStr(b.description, 'Description', 200) : (cat.description ?? null);
    const active = b.active !== undefined ? V.bool(b.active) : Boolean(cat.active);
    const parentIdProvided = b.parentId !== undefined || b.parent_id !== undefined;
    const rawParentId = parentIdProvided ? (b.parentId ?? b.parent_id) : (cat.parentId ?? cat.parent_id ?? null);
    const parentId = rawParentId && String(rawParentId).trim() ? String(rawParentId).trim() : null;

    // Check unique name if name changed
    if (name.toLowerCase() !== String(cat.name).toLowerCase()) {
      const dup = await ctx.db.one(
        'SELECT id FROM categories WHERE tenant_id = ? AND lower(name) = lower(?) AND id <> ?',
        [tenantId, name, cat.id],
      );
      if (dup) throw conflict(`Category "${name}" already exists.`);
    }

    // Validate parent assignment
    if (parentId !== null) {
      if (parentId === cat.id) {
        throw bad('A category cannot be its own parent.', 'VALIDATION', { field: 'parentId' });
      }

      const parent = await ctx.db.one<{ id: string; name: string; parent_id: string | null }>(
        'SELECT id, name, parent_id FROM categories WHERE id = ? AND tenant_id = ?',
        [parentId, tenantId],
      );
      if (!parent) {
        throw bad('Parent category not found.', 'VALIDATION', { field: 'parentId' });
      }

      // Cycle detection: ensure cat.id is not a parent/ancestor of the target parent
      const child = await ctx.db.one(
        'SELECT id FROM categories WHERE tenant_id = ? AND id = ? AND parent_id = ?',
        [tenantId, parentId, cat.id],
      );
      if (child) {
        throw bad('Circular category relationship is not allowed.', 'VALIDATION', { field: 'parentId' });
      }

      // Max depth check: if cat has child categories, it cannot be made a child
      const hasChildren = await ctx.db.one(
        'SELECT id FROM categories WHERE tenant_id = ? AND parent_id = ? LIMIT 1',
        [tenantId, cat.id],
      );
      if (hasChildren) {
        throw bad('A category that has subcategories cannot be converted into a subcategory.', 'VALIDATION', { field: 'parentId' });
      }

      // Max depth check: if parent is already a subcategory
      if (parent.parent_id) {
        throw bad('Cannot nest categories deeper than 2 levels.', 'VALIDATION', { field: 'parentId' });
      }
    }

    await ctx.db.tx(async (q) => {
      await q.exec(
        'UPDATE categories SET name = ?, description = ?, active = ?, parent_id = ? WHERE id = ? AND tenant_id = ?',
        [name, description, active, parentId, cat.id, tenantId],
      );

      // If category is deactivated, also deactivate any child subcategories
      if (!active && Boolean(cat.active)) {
        await q.exec(
          'UPDATE categories SET active = false WHERE tenant_id = ? AND parent_id = ?',
          [tenantId, cat.id],
        );
      }

      // Keep products connected if category name changed
      if (name !== cat.name) {
        await q.exec(
          'UPDATE items SET category = ? WHERE tenant_id = ? AND category = ?',
          [name, tenantId, cat.name],
        );
      }

      await audit(q, ctx, {
        action: 'category.update',
        entity: 'category',
        entityId: cat.id,
        detail: { name, active, parentId },
      });
    });

    const updated = await ctx.db.one(
      `SELECT c.*, p.name AS parent_name
       FROM categories c
       LEFT JOIN categories p ON p.id = c.parent_id AND p.tenant_id = c.tenant_id
       WHERE c.id = ? AND c.tenant_id = ?`,
      [cat.id, tenantId],
    );

    return {
      category: {
        id: updated.id,
        tenantId: updated.tenantId ?? updated.tenant_id,
        name: updated.name,
        description: updated.description ?? null,
        active: Boolean(updated.active),
        parentId: updated.parentId ?? updated.parent_id ?? null,
        parentName: updated.parentName ?? updated.parent_name ?? null,
        createdAt: updated.createdAt ?? updated.created_at,
      },
    };
  });

  // 5. Permanent Delete category (and unlink from items/child categories)
  r.delete('/api/categories/:id', requirePerm('items.write'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const cat = await ctx.db.one<{ id: string; name: string }>(
      'SELECT id, name FROM categories WHERE id = ? AND tenant_id = ?',
      [ctx.params.id, tenantId],
    );
    if (!cat) throw notFound('Category');

    await ctx.db.tx(async (q) => {
      // 1. Unlink any products using this category or hierarchy string
      await q.exec(
        "UPDATE items SET category = '' WHERE tenant_id = ? AND (lower(category) = lower(?) OR category LIKE ? OR category LIKE ?)",
        [tenantId, cat.name, `%→ ${cat.name}`, `${cat.name} →%`],
      );

      // 2. Unlink any child categories (set their parent_id = NULL so they become top-level)
      await q.exec(
        'UPDATE categories SET parent_id = NULL WHERE tenant_id = ? AND parent_id = ?',
        [tenantId, cat.id],
      );

      // 3. Delete the category record
      await q.exec(
        'DELETE FROM categories WHERE id = ? AND tenant_id = ?',
        [cat.id, tenantId],
      );

      await audit(q, ctx, { action: 'category.delete', entity: 'category', entityId: cat.id, detail: { name: cat.name } });
    });

    return { ok: true, deleted: cat.id };
  });

  // 6. Bulk Category Import & Preview (handles 1,000+ rows safely)
  r.post('/api/categories/import', requirePerm('items.write'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;
    const dryRun = Boolean(b.dryRun);
    const updateExisting = Boolean(b.updateExisting);

    let rawRows: CategoryImportRow[] = [];
    if (Array.isArray(b.rows)) {
      rawRows = b.rows;
    } else if (typeof b.csvContent === 'string') {
      const parsed = parseCategoryCsv(b.csvContent);
      if (parsed.error) {
        throw bad(parsed.error, 'CSV_PARSE_ERROR');
      }
      rawRows = parsed.rows;
    } else {
      throw bad('Please provide a valid CSV file or category rows array.', 'VALIDATION');
    }

    if (rawRows.length === 0) {
      throw bad('No data rows found in upload. Please check the file.', 'VALIDATION');
    }

    // Safety limit: up to 2,500 rows per batch
    if (rawRows.length > 2500) {
      throw bad(
        `Import exceeds maximum allowed capacity of 2,500 rows per request (received ${rawRows.length} rows).`,
        'LIMIT_EXCEEDED',
      );
    }

    // Query current categories for tenant to validate parent references and duplicates
    const existing = await ctx.db.query<{ id: string; name: string; parent_id: string | null; active: boolean }>(
      'SELECT id, name, parent_id, active FROM categories WHERE tenant_id = ?',
      [tenantId],
    );

    const plan = validateAndPlanCategoryImport(
      rawRows,
      existing.map((e) => ({
        id: e.id,
        name: e.name,
        parentId: e.parent_id,
        active: Boolean(e.active),
      })),
    );

    // If dry run, return validation report and preview immediately without DB writes
    if (dryRun) {
      const duplicatesInDb = rawRows.filter(
        (r) => r.name && plan.existingNames.has(r.name.trim().toLowerCase()),
      ).length;

      return {
        valid: plan.valid,
        total: plan.total,
        mainCategoriesCount: plan.mainCategories.length,
        subcategoriesCount: plan.subcategories.length,
        duplicateCount: duplicatesInDb,
        errorCount: plan.errors.length,
        errors: plan.errors,
        preview: rawRows.slice(0, 10),
      };
    }

    // If commit import was requested but there are validation errors, reject without DB writes
    if (!plan.valid) {
      throw bad(
        `Import contains ${plan.errors.length} validation error(s). Please review the errors before proceeding.`,
        'VALIDATION_FAILED',
        { errors: plan.errors },
      );
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;

    // Execute atomic batch import inside transaction
    await ctx.db.tx(async (q) => {
      // Build in-memory lookup map of category names to IDs
      const nameToIdMap = new Map<string, string>();
      for (const e of existing) {
        nameToIdMap.set(e.name.toLowerCase().trim(), e.id);
      }

      // PASS 1: Process Main Categories (top-level)
      for (const item of plan.mainCategories) {
        const lower = item.name.toLowerCase();
        const existingId = nameToIdMap.get(lower);

        if (existingId) {
          if (updateExisting) {
            await q.exec(
              'UPDATE categories SET description = COALESCE(?, description), active = ? WHERE id = ? AND tenant_id = ?',
              [item.description, item.active, existingId, tenantId],
            );
            updated++;
          } else {
            skipped++;
          }
        } else {
          const id = newId('cat');
          await q.exec(
            'INSERT INTO categories (id, tenant_id, name, description, parent_id, active) VALUES (?, ?, ?, ?, NULL, ?)',
            [id, tenantId, item.name, item.description, item.active],
          );
          nameToIdMap.set(lower, id);
          created++;
        }
      }

      // PASS 2: Process Subcategories (with resolved parent IDs)
      for (const item of plan.subcategories) {
        const lower = item.name.toLowerCase();
        const existingId = nameToIdMap.get(lower);
        const parentLower = item.parentCategory!.toLowerCase().trim();
        const parentId = nameToIdMap.get(parentLower);

        if (!parentId) {
          throw bad(`Failed to resolve parent ID for subcategory "${item.name}".`);
        }

        if (existingId) {
          if (updateExisting) {
            await q.exec(
              'UPDATE categories SET parent_id = ?, description = COALESCE(?, description), active = ? WHERE id = ? AND tenant_id = ?',
              [parentId, item.description, item.active, existingId, tenantId],
            );
            updated++;
          } else {
            skipped++;
          }
        } else {
          const id = newId('cat');
          await q.exec(
            'INSERT INTO categories (id, tenant_id, name, description, parent_id, active) VALUES (?, ?, ?, ?, ?, ?)',
            [id, tenantId, item.name, item.description, parentId, item.active],
          );
          nameToIdMap.set(lower, id);
          created++;
        }
      }

      await audit(q, ctx, {
        action: 'category.import',
        entity: 'category',
        detail: {
          total: plan.total,
          created,
          updated,
          skipped,
          updateExisting,
        },
      });
    });

    return {
      success: true,
      total: plan.total,
      created,
      updated,
      skipped,
      errors: [],
    };
  });
}
