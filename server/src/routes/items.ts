import { requirePerm } from '../auth.ts';
import { bad, conflict, notFound, V, type Router } from '../http.ts';
import { newId } from '../security.ts';
import { audit } from '../audit.ts';

function validateCustom(raw: unknown): Record<string, string | number> {
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw bad('Custom fields must be an object', 'VALIDATION', { field: 'custom' });
  }
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length > 20) {
    throw bad('Custom fields can have at most 20 entries', 'VALIDATION', { field: 'custom' });
  }
  const cleaned: Record<string, string | number> = {};
  for (const k of keys) {
    const val = obj[k];
    if (typeof val === 'number') {
      if (!Number.isFinite(val)) throw bad(`Custom field "${k}" must be a valid number`, 'VALIDATION', { field: `custom.${k}` });
      cleaned[k] = val;
    } else if (typeof val === 'string') {
      cleaned[k] = val;
    } else {
      throw bad(`Custom field "${k}" must be text or number`, 'VALIDATION', { field: `custom.${k}` });
    }
  }
  return cleaned;
}

function formatItem(r: any) {
  return {
    id: r.id,
    tenantId: r.tenantId ?? r.tenant_id,
    name: r.name,
    sku: r.sku ?? null,
    barcode: r.barcode ?? null,
    hsn: r.hsn ?? null,
    unit: r.unit,
    category: r.category ?? null,
    priceMinor: Number(r.priceMinor ?? r.price_minor ?? 0),
    costMinor: Number(r.costMinor ?? r.cost_minor ?? 0),
    taxRateBp: Number(r.taxRateBp ?? r.tax_rate_bp ?? 0),
    taxInclusive: Boolean(r.taxInclusive ?? r.tax_inclusive),
    trackStock: Boolean(r.trackStock ?? r.track_stock),
    reorderMilli: Number(r.reorderMilli ?? r.reorder_milli ?? 0),
    minStockMilli: Number(r.minStockMilli ?? r.min_stock_milli ?? 0),
    preferredSupplierId: r.preferredSupplierId ?? r.preferred_supplier_id ?? null,
    favorite: Boolean(r.favorite),
    custom: typeof r.custom === 'string' ? JSON.parse(r.custom) : (r.custom ?? {}),
    currentStockMilli: Number(r.currentStockMilli ?? r.current_stock_milli ?? 0),
    active: Boolean(r.active),
    createdAt: r.createdAt ?? r.created_at,
    updatedAt: r.updatedAt ?? r.updated_at,
  };
}

export function registerItems(r: Router) {
  // List items with search, filters, pagination and stock
  r.get('/api/items', requirePerm('items.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const q = (ctx.query.q ?? '').trim().toLowerCase();
    const barcode = (ctx.query.barcode ?? '').trim();
    const category = (ctx.query.category ?? '').trim();
    const favoriteParam = ctx.query.favorite;
    const includeInactive = ctx.query.includeInactive === '1' || ctx.query.includeInactive === 'true';

    let sql = `
      SELECT i.*,
             COALESCE((SELECT SUM(sm.qty_milli) FROM stock_moves sm WHERE sm.item_id = i.id AND sm.tenant_id = i.tenant_id), 0) AS current_stock_milli
      FROM items i
      WHERE i.tenant_id = ?
    `;
    const params: unknown[] = [tenantId];

    if (!includeInactive) {
      sql += ' AND i.active = true';
    }

    if (barcode) {
      sql += ' AND (i.barcode = ? OR EXISTS (SELECT 1 FROM product_barcodes pb WHERE pb.tenant_id = i.tenant_id AND pb.product_id = i.id AND pb.barcode = ?))';
      params.push(barcode, barcode);
    } else if (q) {
      sql += ' AND (lower(i.name) LIKE ? OR lower(COALESCE(i.sku, \'\')) LIKE ? OR lower(COALESCE(i.barcode, \'\')) LIKE ? OR EXISTS (SELECT 1 FROM product_barcodes pb WHERE pb.tenant_id = i.tenant_id AND pb.product_id = i.id AND lower(pb.barcode) LIKE ?))';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }

    if (category) {
      sql += ' AND i.category = ?';
      params.push(category);
    }

    if (favoriteParam !== undefined && favoriteParam !== '') {
      const isFav = favoriteParam === '1' || favoriteParam === 'true';
      sql += ' AND i.favorite = ?';
      params.push(isFav);
    }

    const limit = Math.min(Math.max(V.int(ctx.query.limit ?? 100, 'Limit', { min: 1, max: 500 }), 1), 500);
    const offset = Math.max(V.int(ctx.query.offset ?? 0, 'Offset', { min: 0 }), 0);

    sql += ' ORDER BY i.favorite DESC, i.name ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = await ctx.db.query(sql, params);
    return { items: rows.map(formatItem) };
  });

  // Get single item by ID
  r.get('/api/items/:id', requirePerm('items.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const row = await ctx.db.one(
      `SELECT i.*,
              COALESCE((SELECT SUM(sm.qty_milli) FROM stock_moves sm WHERE sm.item_id = i.id AND sm.tenant_id = i.tenant_id), 0) AS current_stock_milli
       FROM items i
       WHERE i.tenant_id = ? AND i.id = ?`,
      [tenantId, ctx.params.id],
    );
    if (!row) throw notFound('Item');
    return { item: formatItem(row) };
  });

  // Get single item by exact barcode (for barcode scanners) — checks both primary and product_barcodes
  r.get('/api/items/by-barcode/:code', requirePerm('items.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const code = (ctx.params.code ?? '').trim();
    if (!code) throw bad('Barcode is required', 'VALIDATION', { field: 'code' });

    const prefix12 = code.length === 13 ? code.slice(0, 12) : code;
    const row = await ctx.db.one(
      `SELECT i.*,
              COALESCE((SELECT SUM(sm.qty_milli) FROM stock_moves sm WHERE sm.item_id = i.id AND sm.tenant_id = i.tenant_id), 0) AS current_stock_milli
       FROM items i
       WHERE i.tenant_id = ? AND i.active = true
         AND (
           i.barcode = ?
           OR (length(?) = 13 AND i.barcode = ?)
           OR (length(i.barcode) = 13 AND substr(i.barcode, 1, 12) = ?)
           OR EXISTS (
             SELECT 1 FROM product_barcodes pb
             WHERE pb.tenant_id = i.tenant_id AND pb.product_id = i.id
               AND (pb.barcode = ? OR (length(?) = 13 AND pb.barcode = ?))
           )
         )
       LIMIT 1`,
      [tenantId, code, code, prefix12, prefix12, code, code, prefix12],
    );
    if (!row && code.length >= 8 && /^\d+$/.test(code)) {
      const allRows = await ctx.db.query<{ id: string; barcode: string | null }>(
        `SELECT id, barcode FROM items WHERE tenant_id = ? AND active = true AND barcode IS NOT NULL`,
        [tenantId],
      );
      const candidates = allRows.filter((r: { id: string; barcode: string | null }) => {
        const itBc = (r.barcode || '').trim().replace(/[\s\-]/g, '');
        if (itBc.length !== code.length) return false;
        let diffs = 0;
        for (let i = 0; i < code.length; i++) {
          if (code[i] !== itBc[i]) {
            diffs++;
            if (diffs > 1) return false;
          }
        }
        return diffs === 1;
      });
      if (candidates.length === 1) {
        const candidateRow = await ctx.db.one(
          `SELECT i.*, COALESCE((SELECT SUM(sm.qty_milli) FROM stock_moves sm WHERE sm.item_id = i.id AND sm.tenant_id = i.tenant_id), 0) AS current_stock_milli
           FROM items i WHERE i.id = ? AND i.tenant_id = ?`,
          [candidates[0].id, tenantId],
        );
        if (candidateRow) return { item: formatItem(candidateRow) };
      }
    }

    if (!row) throw notFound('Item');
    return { item: formatItem(row) };
  });

  // Get all registered barcodes for an item
  r.get('/api/items/:id/barcodes', requirePerm('items.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const item = await ctx.db.one('SELECT id FROM items WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!item) throw notFound('Item');

    const rows = await ctx.db.query(
      `SELECT id, barcode, barcode_type, created_at FROM product_barcodes WHERE tenant_id = ? AND product_id = ? ORDER BY created_at ASC`,
      [tenantId, item.id],
    );
    const barcodes = rows.map((r: any) => ({
      id: r.id,
      barcode: r.barcode,
      barcodeType: r.barcodeType ?? r.barcode_type,
      barcode_type: r.barcodeType ?? r.barcode_type,
      createdAt: r.createdAt ?? r.created_at,
    }));
    return { barcodes };
  });

  // Add a new barcode (INTERNAL or MANUFACTURER) to an existing product
  r.post('/api/items/:id/barcodes', requirePerm('items.write'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;
    const item = await ctx.db.one<{ id: string; name: string }>('SELECT id, name FROM items WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!item) throw notFound('Item');

    const barcode = V.str(b.barcode, 'Barcode', { required: true, max: 60 }).trim();
    const rawType = (b.barcodeType || '').toString().toUpperCase();
    const barcodeType: 'INTERNAL' | 'MANUFACTURER' = rawType === 'INTERNAL' ? 'INTERNAL' : 'MANUFACTURER';

    // Verify barcode uniqueness against other items
    const existingItem = await ctx.db.one<{ id: string; name: string }>(
      'SELECT id, name FROM items WHERE tenant_id = ? AND barcode = ? AND id <> ?',
      [tenantId, barcode, item.id],
    );
    if (existingItem) {
      throw conflict(`Barcode "${barcode}" is already used by item "${existingItem.name}".`);
    }

    const existingMapping = await ctx.db.one<{ productId: string }>(
      'SELECT product_id FROM product_barcodes WHERE tenant_id = ? AND barcode = ? AND product_id <> ?',
      [tenantId, barcode, item.id],
    );
    if (existingMapping) {
      throw conflict(`Barcode "${barcode}" is already registered to another item.`);
    }

    const bcId = newId('bc');
    await ctx.db.exec(
      `INSERT INTO product_barcodes (id, tenant_id, product_id, barcode, barcode_type)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (tenant_id, barcode) DO NOTHING`,
      [bcId, tenantId, item.id, barcode, barcodeType],
    );

    const barcodeRecord = { id: bcId, barcode, barcode_type: barcodeType, barcodeType };
    return {
      ok: true,
      id: bcId,
      barcode: barcodeRecord,
      barcodeRecord,
      barcodeType,
      barcode_type: barcodeType,
    };
  });

  // Create item
  r.post('/api/items', requirePerm('items.write'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;

    const name = V.str(b.name, 'Item name', { required: true, max: 120 });
    const priceMinor = V.int(b.priceMinor, 'Price (paise)', { min: 0, required: true });
    const costMinor = V.int(b.costMinor ?? 0, 'Cost (paise)', { min: 0 });
    const taxRateBp = V.int(b.taxRateBp ?? 0, 'Tax rate (basis points)', { min: 0, max: 10000 });
    const sku = V.optStr(b.sku, 'SKU', 60);
    const barcode = V.optStr(b.barcode, 'Barcode', 60);
    const hsn = V.optStr(b.hsn, 'HSN', 20);
    const unit = V.str(b.unit || 'pcs', 'Unit', { max: 20 });
    const category = V.optStr(b.category, 'Category', 60);
    const taxInclusive = V.bool(b.taxInclusive, true);
    const trackStock = V.bool(b.trackStock, true);
    const reorderMilli = V.int(b.reorderMilli ?? b.reorderLevelMilli ?? 0, 'Reorder quantity', { min: 0 });
    const minStockMilli = V.int(b.minStockMilli ?? 0, 'Minimum stock quantity', { min: 0 });
    const preferredSupplierId = V.optStr(b.preferredSupplierId, 'Preferred supplier', 60);
    const favorite = V.bool(b.favorite, false);
    const custom = validateCustom(b.custom);
    const openingQtyMilli = V.int(b.openingQtyMilli ?? b.openingStockMilli ?? 0, 'Opening quantity', { min: 0 });

    if (barcode) {
      const existing = await ctx.db.one<{ id: string; name: string }>(
        'SELECT id, name FROM items WHERE tenant_id = ? AND barcode = ?',
        [tenantId, barcode],
      );
      if (existing) {
        throw conflict(`Item "${existing.name}" already uses this barcode.`);
      }
    }

    let firstLocation = 'MAIN';
    if (openingQtyMilli > 0) {
      const shop = await ctx.db.one<{ locations: unknown }>('SELECT locations FROM tenants WHERE id = ?', [tenantId]);
      if (shop?.locations) {
        const locs = typeof shop.locations === 'string' ? JSON.parse(shop.locations) : shop.locations;
        if (Array.isArray(locs) && locs.length > 0 && typeof locs[0] === 'string' && locs[0].trim()) {
          firstLocation = locs[0].trim();
        }
      }
    }

    const id = newId('i');

    await ctx.db.tx(async (q) => {
      await q.exec(
        `INSERT INTO items (
          id, tenant_id, name, sku, barcode, hsn, unit, category,
          price_minor, cost_minor, tax_rate_bp, tax_inclusive, track_stock,
          reorder_milli, min_stock_milli, preferred_supplier_id, favorite, custom, active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, true)`,
        [id, tenantId, name, sku, barcode, hsn, unit, category, priceMinor, costMinor, taxRateBp, taxInclusive, trackStock, reorderMilli, minStockMilli, preferredSupplierId || null, favorite, JSON.stringify(custom)],
      );

      if (barcode) {
        await q.exec(
          `INSERT INTO product_barcodes (id, tenant_id, product_id, barcode, barcode_type)
           VALUES (?, ?, ?, ?, 'MANUFACTURER')
           ON CONFLICT (tenant_id, barcode) DO NOTHING`,
          [newId('bc'), tenantId, id, barcode],
        );
      }

      if (openingQtyMilli > 0) {
        await q.exec(
          `INSERT INTO stock_moves (id, tenant_id, item_id, location, qty_milli, kind, unit_cost_minor, reason, user_id)
           VALUES (?, ?, ?, ?, ?, 'opening', ?, 'Initial opening stock', ?)`,
          [newId('sm'), tenantId, id, firstLocation, openingQtyMilli, costMinor, ctx.user!.id],
        );
      }

      await audit(q, ctx, {
        action: 'item.create',
        entity: 'item',
        entityId: id,
        detail: { name, priceMinor, sku, barcode, openingQtyMilli },
      });
    });

    const created = await ctx.db.one(
      `SELECT i.*,
              COALESCE((SELECT SUM(sm.qty_milli) FROM stock_moves sm WHERE sm.item_id = i.id AND sm.tenant_id = i.tenant_id), 0) AS current_stock_milli
       FROM items i
       WHERE i.id = ? AND i.tenant_id = ?`,
      [id, tenantId],
    );
    return { item: formatItem(created) };
  });

  // Update item (deactivate instead of delete)
  r.patch('/api/items/:id', requirePerm('items.write'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;
    const item = await ctx.db.one('SELECT * FROM items WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!item) throw notFound('Item');

    const name = b.name !== undefined ? V.str(b.name, 'Item name', { required: true, max: 120 }) : item.name;
    const priceMinor = b.priceMinor !== undefined ? V.int(b.priceMinor, 'Price (paise)', { min: 0 }) : Number(item.priceMinor ?? item.price_minor ?? 0);
    const costMinor = b.costMinor !== undefined ? V.int(b.costMinor, 'Cost (paise)', { min: 0 }) : Number(item.costMinor ?? item.cost_minor ?? 0);
    const taxRateBp = b.taxRateBp !== undefined ? V.int(b.taxRateBp, 'Tax rate (basis points)', { min: 0, max: 10000 }) : Number(item.taxRateBp ?? item.tax_rate_bp ?? 0);
    const sku = b.sku !== undefined ? V.optStr(b.sku, 'SKU', 60) : (item.sku ?? null);
    const barcode = b.barcode !== undefined ? V.optStr(b.barcode, 'Barcode', 60) : (item.barcode ?? null);
    const hsn = b.hsn !== undefined ? V.optStr(b.hsn, 'HSN', 20) : (item.hsn ?? null);
    const unit = b.unit !== undefined ? V.str(b.unit, 'Unit', { max: 20 }) : (item.unit ?? 'pcs');
    const category = b.category !== undefined ? V.optStr(b.category, 'Category', 60) : (item.category ?? null);
    const taxInclusive = b.taxInclusive !== undefined ? V.bool(b.taxInclusive) : Boolean(item.taxInclusive ?? item.tax_inclusive);
    const trackStock = b.trackStock !== undefined ? V.bool(b.trackStock) : Boolean(item.trackStock ?? item.track_stock);
    const reorderMilli = (b.reorderMilli !== undefined || b.reorderLevelMilli !== undefined) ? V.int(b.reorderMilli ?? b.reorderLevelMilli, 'Reorder quantity', { min: 0 }) : Number(item.reorderMilli ?? item.reorder_milli ?? 0);
    const minStockMilli = b.minStockMilli !== undefined ? V.int(b.minStockMilli, 'Minimum stock', { min: 0 }) : Number(item.minStockMilli ?? item.min_stock_milli ?? 0);
    const preferredSupplierId = b.preferredSupplierId !== undefined ? V.optStr(b.preferredSupplierId, 'Preferred supplier', 60) : (item.preferredSupplierId ?? item.preferred_supplier_id ?? null);
    const favorite = b.favorite !== undefined ? V.bool(b.favorite) : Boolean(item.favorite);
    const custom = b.custom !== undefined ? validateCustom(b.custom) : (typeof item.custom === 'string' ? JSON.parse(item.custom) : (item.custom ?? {}));
    const active = b.active !== undefined ? V.bool(b.active) : Boolean(item.active);

    if (barcode && barcode !== item.barcode) {
      const dup = await ctx.db.one<{ id: string; name: string }>(
        'SELECT id, name FROM items WHERE tenant_id = ? AND barcode = ? AND id <> ?',
        [tenantId, barcode, item.id],
      );
      if (dup) {
        throw conflict(`Item "${dup.name}" already uses this barcode.`);
      }
    }

    await ctx.db.tx(async (q) => {
      await q.exec(
        `UPDATE items SET
          name = ?, price_minor = ?, cost_minor = ?, tax_rate_bp = ?, sku = ?, barcode = ?,
          hsn = ?, unit = ?, category = ?, tax_inclusive = ?, track_stock = ?, reorder_milli = ?,
          min_stock_milli = ?, preferred_supplier_id = ?, favorite = ?, custom = ?::jsonb, active = ?, updated_at = now()
         WHERE id = ? AND tenant_id = ?`,
        [name, priceMinor, costMinor, taxRateBp, sku, barcode, hsn, unit, category, taxInclusive, trackStock, reorderMilli, minStockMilli, preferredSupplierId || null, favorite, JSON.stringify(custom ?? {}), active, item.id, tenantId],
      );

      // Keep product_barcodes table synchronized
      if (barcode !== item.barcode) {
        if (item.barcode) {
          await q.exec(
            'DELETE FROM product_barcodes WHERE tenant_id = ? AND product_id = ? AND barcode = ?',
            [tenantId, item.id, item.barcode],
          );
        }
        if (barcode) {
          const bType = barcode.startsWith('20') && barcode.length === 13 ? 'INTERNAL' : 'MANUFACTURER';
          await q.exec(
            `INSERT INTO product_barcodes (id, tenant_id, product_id, barcode, barcode_type)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (tenant_id, barcode) DO UPDATE SET product_id = EXCLUDED.product_id, barcode_type = EXCLUDED.barcode_type`,
            [newId('bc'), tenantId, item.id, barcode, bType],
          );
        }
      }

      await audit(q, ctx, { action: 'item.update', entity: 'item', entityId: item.id, detail: { name, priceMinor, active } });
    });

    const updated = await ctx.db.one(
      `SELECT i.*,
              COALESCE((SELECT SUM(sm.qty_milli) FROM stock_moves sm WHERE sm.item_id = i.id AND sm.tenant_id = i.tenant_id), 0) AS current_stock_milli
       FROM items i
       WHERE i.id = ? AND i.tenant_id = ?`,
      [item.id, tenantId],
    );
    return { item: formatItem(updated) };
  });

  // Deactivate or permanently delete item
  r.delete('/api/items/:id', requirePerm('items.write'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const isPermanent = ctx.query.permanent === 'true' || ctx.query.hard === 'true' || ctx.query.force === 'true';

    const item = await ctx.db.one('SELECT * FROM items WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!item) throw notFound('Item');

    if (!isPermanent) {
      // Deactivate item (soft delete)
      await ctx.db.tx(async (q) => {
        await q.exec('UPDATE items SET active = false, updated_at = now() WHERE id = ? AND tenant_id = ?', [item.id, tenantId]);
        await audit(q, ctx, { action: 'item.deactivate', entity: 'item', entityId: item.id });
      });
      return { ok: true, active: false };
    }

    // ── Actual Database Deletion (Permanent) ─────────────────────────────────
    // Check 1: Invoices / Sales lines
    const invRes = await ctx.db.one<{ cnt: string | number }>(
      'SELECT COUNT(*) as cnt FROM invoice_lines WHERE item_id = ? AND tenant_id = ?',
      [item.id, tenantId]
    );
    const invCount = Number(invRes?.cnt || 0);
    if (invCount > 0) {
      throw conflict(
        `Cannot delete "${item.name}": it is referenced by ${invCount} sales invoice record(s). Deactivate this product instead to preserve sales and tax records.`
      );
    }

    // Check 2: Purchase lines
    const purRes = await ctx.db.one<{ cnt: string | number }>(
      'SELECT COUNT(*) as cnt FROM purchase_lines WHERE item_id = ? AND tenant_id = ?',
      [item.id, tenantId]
    );
    const purCount = Number(purRes?.cnt || 0);
    if (purCount > 0) {
      throw conflict(
        `Cannot delete "${item.name}": it is referenced by ${purCount} purchase bill record(s). Deactivate this product instead to preserve accounting and supplier records.`
      );
    }

    // Check 3: Transactional stock moves (sales, purchases, returns, transfers, adjustments)
    const stockRes = await ctx.db.one<{ cnt: string | number }>(
      `SELECT COUNT(*) as cnt FROM stock_moves WHERE item_id = ? AND tenant_id = ? AND kind IN ('sale', 'purchase', 'return', 'transfer', 'adjust')`,
      [item.id, tenantId]
    );
    const stockCount = Number(stockRes?.cnt || 0);
    if (stockCount > 0) {
      throw conflict(
        `Cannot delete "${item.name}": it has ${stockCount} transactional stock movement(s). Deactivate this product instead to retain inventory audit logs.`
      );
    }

    // Check 4: Stock adjustments
    const adjRes = await ctx.db.one<{ cnt: string | number }>(
      'SELECT COUNT(*) as cnt FROM stock_adjustments WHERE item_id = ? AND tenant_id = ?',
      [item.id, tenantId]
    );
    const adjCount = Number(adjRes?.cnt || 0);
    if (adjCount > 0) {
      throw conflict(
        `Cannot delete "${item.name}": it is referenced by inventory stock adjustment records. Deactivate this product instead.`
      );
    }

    // Safe to delete! Perform transactional cleanup of associated barcodes and opening stock moves
    await ctx.db.tx(async (q) => {
      await q.exec('DELETE FROM stock_moves WHERE item_id = ? AND tenant_id = ?', [item.id, tenantId]);
      await q.exec('DELETE FROM stock_count_lines WHERE item_id = ? AND tenant_id = ?', [item.id, tenantId]);
      await q.exec('DELETE FROM product_barcodes WHERE product_id = ? AND tenant_id = ?', [item.id, tenantId]);
      await q.exec('DELETE FROM items WHERE id = ? AND tenant_id = ?', [item.id, tenantId]);
      await audit(q, ctx, {
        action: 'item.delete',
        entity: 'item',
        entityId: item.id,
        detail: { name: item.name, sku: item.sku, barcode: item.barcode },
      });
    });

    return { ok: true, deleted: true, itemId: item.id, message: `Product "${item.name}" deleted successfully` };
  });

  // Dedicated permanent delete route alias
  r.delete('/api/items/:id/permanent', requirePerm('items.write'), async (ctx) => {
    ctx.query.permanent = 'true';
    const tenantId = ctx.user!.tenantId;
    const item = await ctx.db.one('SELECT * FROM items WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!item) throw notFound('Item');

    const invRes = await ctx.db.one<{ cnt: string | number }>(
      'SELECT COUNT(*) as cnt FROM invoice_lines WHERE item_id = ? AND tenant_id = ?',
      [item.id, tenantId]
    );
    const invCount = Number(invRes?.cnt || 0);
    if (invCount > 0) {
      throw conflict(
        `Cannot delete "${item.name}": it is referenced by ${invCount} sales invoice record(s). Deactivate this product instead to preserve sales and tax records.`
      );
    }

    const purRes = await ctx.db.one<{ cnt: string | number }>(
      'SELECT COUNT(*) as cnt FROM purchase_lines WHERE item_id = ? AND tenant_id = ?',
      [item.id, tenantId]
    );
    const purCount = Number(purRes?.cnt || 0);
    if (purCount > 0) {
      throw conflict(
        `Cannot delete "${item.name}": it is referenced by ${purCount} purchase bill record(s). Deactivate this product instead to preserve accounting and supplier records.`
      );
    }

    const stockRes = await ctx.db.one<{ cnt: string | number }>(
      `SELECT COUNT(*) as cnt FROM stock_moves WHERE item_id = ? AND tenant_id = ? AND kind IN ('sale', 'purchase', 'return', 'transfer', 'adjust')`,
      [item.id, tenantId]
    );
    const stockCount = Number(stockRes?.cnt || 0);
    if (stockCount > 0) {
      throw conflict(
        `Cannot delete "${item.name}": it has ${stockCount} transactional stock movement(s). Deactivate this product instead to retain inventory audit logs.`
      );
    }

    const adjRes = await ctx.db.one<{ cnt: string | number }>(
      'SELECT COUNT(*) as cnt FROM stock_adjustments WHERE item_id = ? AND tenant_id = ?',
      [item.id, tenantId]
    );
    const adjCount = Number(adjRes?.cnt || 0);
    if (adjCount > 0) {
      throw conflict(
        `Cannot delete "${item.name}": it is referenced by inventory stock adjustment records. Deactivate this product instead.`
      );
    }

    await ctx.db.tx(async (q) => {
      await q.exec('DELETE FROM stock_moves WHERE item_id = ? AND tenant_id = ?', [item.id, tenantId]);
      await q.exec('DELETE FROM stock_count_lines WHERE item_id = ? AND tenant_id = ?', [item.id, tenantId]);
      await q.exec('DELETE FROM product_barcodes WHERE product_id = ? AND tenant_id = ?', [item.id, tenantId]);
      await q.exec('DELETE FROM items WHERE id = ? AND tenant_id = ?', [item.id, tenantId]);
      await audit(q, ctx, {
        action: 'item.delete',
        entity: 'item',
        entityId: item.id,
        detail: { name: item.name, sku: item.sku, barcode: item.barcode },
      });
    });

    return { ok: true, deleted: true, itemId: item.id, message: `Product "${item.name}" deleted successfully` };
  });
}
