import { requirePerm } from '../auth.ts';
import { bad, conflict, notFound, V, type Router, type Ctx } from '../http.ts';
import { newId } from '../security.ts';
import { audit } from '../audit.ts';
import { resolveBranchScope } from '../branchScope.ts';
import { generateUniqueInternalBarcode } from '../../../shared/bulkImport.ts';

function isInternalBarcode(barcode?: string | null, barcodeType?: string | null): boolean {
  if (!barcode) return false;
  const t = (barcodeType || '').toUpperCase();
  if (t === 'INTERNAL') return true;
  if (t === 'MANUFACTURER') return false;
  const trimmed = barcode.trim();
  return trimmed.startsWith('20') && trimmed.length === 13;
}

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
    branchId: r.branchId ?? r.branch_id,
    branchName: r.branchName ?? r.branch_name ?? null,
    branchCode: r.branchCode ?? r.branch_code ?? null,
    name: r.name,
    sku: r.sku ?? null,
    barcode: r.barcode ?? null,
    barcodeType: r.barcodeType ?? r.barcode_type ?? null,
    barcodes: (typeof (r.allBarcodes ?? r.all_barcodes) === 'string'
      ? JSON.parse(r.allBarcodes ?? r.all_barcodes)
      : (r.allBarcodes ?? r.all_barcodes ?? r.barcodes ?? [])),
    hsn: r.hsn ?? null,
    unit: r.unit,
    category: r.category ?? null,
    priceMinor: Number(r.priceMinor ?? r.price_minor ?? 0),
    costMinor: Number(r.costMinor ?? r.cost_minor ?? 0),
    taxRateBp: Number(r.taxRateBp ?? r.tax_rate_bp ?? 0),
    taxInclusive: Boolean(r.taxInclusive ?? r.tax_inclusive),
    trackStock: Boolean(r.trackStock ?? r.track_stock),
    reorderMilli: Number(r.reorderMilli ?? r.reorder_milli ?? 0),
    preferredSupplierId: r.preferredSupplierId ?? r.preferred_supplier_id ?? null,
    favorite: Boolean(r.favorite),
    imageUrl: r.imageUrl ?? r.image_url ?? (typeof r.custom === 'object' && r.custom?.image ? r.custom.image : null),
    image: r.imageUrl ?? r.image_url ?? (typeof r.custom === 'object' && r.custom?.image ? r.custom.image : null),
    custom: typeof r.custom === 'string' ? JSON.parse(r.custom) : (r.custom ?? {}),
    currentStockMilli: Number(r.currentStockMilli ?? r.current_stock_milli ?? 0),
    active: Boolean(r.active),
    createdAt: r.createdAt ?? r.created_at,
    updatedAt: r.updatedAt ?? r.updated_at,
  };
}

/**
 * Builds SQL condition to check if an item is associated with a specific branch:
 * 1) It was created in this branch (i.branch_id = branchId), OR
 * 2) It has stock moves recorded in this branch (transferred, counted, sold, adjusted), OR
 * 3) It was transferred to this branch via completed / received stock transfer
 */
function buildBranchAssociationClause(branchId: string, branchCode: string) {
  return {
    sql: `(
      i.branch_id = ?
      OR EXISTS (
        SELECT 1 FROM stock_moves sm_assoc
        WHERE sm_assoc.tenant_id = i.tenant_id
          AND sm_assoc.item_id = i.id
          AND (
            sm_assoc.branch_id = ?
            OR (sm_assoc.branch_id IS NULL AND (UPPER(sm_assoc.location) = UPPER(?) OR UPPER(sm_assoc.location) = UPPER(?)))
          )
      )
      OR EXISTS (
        SELECT 1 FROM stock_transfers st_assoc
        JOIN stock_transfer_lines stl_assoc ON stl_assoc.transfer_id = st_assoc.id
        WHERE st_assoc.tenant_id = i.tenant_id
          AND stl_assoc.item_id = i.id
          AND st_assoc.status IN ('completed', 'received', 'partially_received')
          AND (st_assoc.to_branch = ? OR st_assoc.to_branch = ?)
      )
    )`,
    params: [branchId, branchId, branchCode, branchId, branchId, branchCode],
  };
}

export function registerItems(r: Router) {
  // List items with search, filters, pagination and stock
  r.get('/api/items', requirePerm('items.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    const q = (ctx.query.q ?? '').trim().toLowerCase();
    const barcode = (ctx.query.barcode ?? '').trim();
    const category = (ctx.query.category ?? '').trim();
    const favoriteParam = ctx.query.favorite;
    const includeInactive = ctx.query.includeInactive === '1' || ctx.query.includeInactive === 'true';

    let targetBranch: { id: string; name: string; code: string } | null = null;
    if (!scope.isSuperAdminAll && scope.branchId) {
      targetBranch = (await ctx.db.one<{ id: string; name: string; code: string }>(
        'SELECT id, name, code FROM branches WHERE tenant_id = ? AND (id = ? OR UPPER(code) = UPPER(?)) AND deleted_at IS NULL LIMIT 1',
        [tenantId, scope.branchId, scope.branchId],
      )) ?? { id: scope.branchId, name: 'Branch', code: scope.branchId };
    }

    let sql: string;
    const params: unknown[] = [];

    if (targetBranch) {
      sql = `
        SELECT i.*,
               ? AS branch_id,
               ? AS branch_name,
               ? AS branch_code,
               COALESCE((
                 SELECT json_agg(bc_row)
                 FROM (
                   SELECT DISTINCT ON (pb.barcode)
                     pb.id, pb.barcode, pb.barcode_type AS "barcodeType", pb.barcode_type, pb.branch_id AS "branchId"
                   FROM product_barcodes pb
                   WHERE pb.tenant_id = i.tenant_id
                     AND pb.product_id = i.id
                     AND (pb.branch_id = ? OR pb.branch_id = i.branch_id OR pb.branch_id IS NULL)
                   ORDER BY pb.barcode, (pb.branch_id = ?) DESC, pb.created_at ASC
                 ) bc_row
               ), '[]'::json) AS all_barcodes,
               COALESCE((
                 SELECT SUM(sm.qty_milli)
                 FROM stock_moves sm
                 WHERE sm.item_id = i.id
                   AND sm.tenant_id = i.tenant_id
                   AND (
                     sm.branch_id = ?
                     OR (sm.branch_id IS NULL AND (UPPER(sm.location) = UPPER(?) OR UPPER(sm.location) = UPPER(?)))
                   )
               ), 0) AS current_stock_milli
        FROM items i
        WHERE i.tenant_id = ?
      `;
      params.push(
        targetBranch.id, targetBranch.name, targetBranch.code,
        targetBranch.id, targetBranch.id,
        targetBranch.id, targetBranch.code, targetBranch.id,
        tenantId,
      );

      const assoc = buildBranchAssociationClause(targetBranch.id, targetBranch.code);
      sql += ` AND ${assoc.sql}`;
      params.push(...assoc.params);
    } else {
      sql = `
        SELECT i.*,
               b.name AS branch_name,
               b.code AS branch_code,
               COALESCE((
                 SELECT json_agg(bc_row)
                 FROM (
                   SELECT DISTINCT ON (pb.barcode)
                     pb.id, pb.barcode, pb.barcode_type AS "barcodeType", pb.barcode_type, pb.branch_id AS "branchId"
                   FROM product_barcodes pb
                   WHERE pb.tenant_id = i.tenant_id
                     AND pb.product_id = i.id
                   ORDER BY pb.barcode, pb.created_at ASC
                 ) bc_row
               ), '[]'::json) AS all_barcodes,
               COALESCE((
                 SELECT SUM(sm.qty_milli)
                 FROM stock_moves sm
                 WHERE sm.item_id = i.id AND sm.tenant_id = i.tenant_id
               ), 0) AS current_stock_milli
        FROM items i
        LEFT JOIN branches b ON b.id = i.branch_id AND b.tenant_id = i.tenant_id
        WHERE i.tenant_id = ?
      `;
      params.push(tenantId);
    }

    if (!includeInactive) {
      sql += ' AND i.active = true';
    }

    if (barcode) {
      if (targetBranch) {
        sql += ` AND (
          i.barcode = ?
          OR EXISTS (
            SELECT 1 FROM product_barcodes pb
            WHERE pb.tenant_id = i.tenant_id
              AND (pb.branch_id = ? OR pb.branch_id = i.branch_id OR pb.branch_id IS NULL)
              AND pb.product_id = i.id
              AND pb.barcode = ?
          )
        )`;
        params.push(barcode, targetBranch.id, barcode);
      } else {
        sql += ` AND (
          i.barcode = ?
          OR EXISTS (
            SELECT 1 FROM product_barcodes pb
            WHERE pb.tenant_id = i.tenant_id
              AND pb.product_id = i.id
              AND pb.barcode = ?
          )
        )`;
        params.push(barcode, barcode);
      }
    } else if (q) {
      if (targetBranch) {
        sql += ` AND (
          lower(i.name) LIKE ?
          OR lower(COALESCE(i.sku, '')) LIKE ?
          OR lower(COALESCE(i.barcode, '')) LIKE ?
          OR EXISTS (
            SELECT 1 FROM product_barcodes pb
            WHERE pb.tenant_id = i.tenant_id
              AND (pb.branch_id = ? OR pb.branch_id = i.branch_id OR pb.branch_id IS NULL)
              AND pb.product_id = i.id
              AND lower(pb.barcode) LIKE ?
          )
        )`;
        params.push(`%${q}%`, `%${q}%`, `%${q}%`, targetBranch.id, `%${q}%`);
      } else {
        sql += ` AND (
          lower(i.name) LIKE ?
          OR lower(COALESCE(i.sku, '')) LIKE ?
          OR lower(COALESCE(i.barcode, '')) LIKE ?
          OR EXISTS (
            SELECT 1 FROM product_barcodes pb
            WHERE pb.tenant_id = i.tenant_id
              AND pb.product_id = i.id
              AND lower(pb.barcode) LIKE ?
          )
        )`;
        params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
      }
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

  // Generate a unique internal barcode (IBC) for a branch
  const generateBarcodeHandler = async (ctx: Ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    const rawBranch = (ctx.query?.branchId ?? ctx.body?.branchId ?? scope.branchId ?? '').toString().trim();
    let branchId = scope.branchId;
    if (rawBranch && rawBranch.toLowerCase() !== 'all') {
      const br = await ctx.db.one<{ id: string }>(
        'SELECT id FROM branches WHERE tenant_id = ? AND (id = ? OR UPPER(code) = UPPER(?)) AND deleted_at IS NULL LIMIT 1',
        [tenantId, rawBranch, rawBranch],
      );
      if (br) branchId = br.id;
    }
    if (!branchId) {
      const mainBr = await ctx.db.one<{ id: string }>(
        "SELECT id FROM branches WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY (code = 'MAIN') DESC, created_at ASC LIMIT 1",
        [tenantId],
      );
      branchId = mainBr?.id || null;
    }

    // Check duplicates ONLY within this branch, and only for internal barcodes
    let branchSql = '';
    const sqlParams: unknown[] = [tenantId];
    if (branchId) {
      branchSql = ' AND branch_id = ?';
      sqlParams.push(branchId);
    }
    const branchPbParams: unknown[] = [tenantId];
    let pbBranchSql = '';
    if (branchId) {
      pbBranchSql = ' AND pb.branch_id = ?';
      branchPbParams.push(branchId);
    }

    const existingRows = await ctx.db.query<{ barcode: string }>(
      `SELECT barcode FROM items
       WHERE tenant_id = ? ${branchSql} AND barcode IS NOT NULL AND (barcode LIKE '20%' AND length(barcode) = 13)
       UNION
       SELECT pb.barcode FROM product_barcodes pb
       WHERE pb.tenant_id = ? ${pbBranchSql} AND (pb.barcode_type = 'INTERNAL' OR (pb.barcode LIKE '20%' AND length(pb.barcode) = 13))`,
      [...sqlParams, ...branchPbParams],
    );

    const existingCodes = new Set<string>(existingRows.map((r: { barcode: string }) => r.barcode));
    const generated = generateUniqueInternalBarcode(existingCodes, new Set<string>());
    return {
      barcode: generated,
      barcodeType: 'INTERNAL',
      branchId: branchId || null,
    };
  };

  r.get('/api/items/generate-barcode', requirePerm('items.write'), generateBarcodeHandler);
  r.post('/api/items/generate-barcode', requirePerm('items.write'), generateBarcodeHandler);

  // Validate / duplicate-check barcode for a branch
  r.get('/api/items/check-barcode', requirePerm('items.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    const barcode = (ctx.query.barcode ?? '').toString().trim();
    if (!barcode) throw bad('Barcode is required', 'VALIDATION', { field: 'barcode' });

    const rawType = (ctx.query.barcodeType ?? '').toString().toUpperCase();
    const barcodeType: 'INTERNAL' | 'MANUFACTURER' = rawType === 'INTERNAL' || (barcode.startsWith('20') && barcode.length === 13)
      ? 'INTERNAL'
      : 'MANUFACTURER';

    const rawBranch = (ctx.query.branchId ?? scope.branchId ?? '').toString().trim();
    let branchId = scope.branchId;
    if (rawBranch && rawBranch.toLowerCase() !== 'all') {
      const br = await ctx.db.one<{ id: string }>(
        'SELECT id FROM branches WHERE tenant_id = ? AND (id = ? OR UPPER(code) = UPPER(?)) AND deleted_at IS NULL LIMIT 1',
        [tenantId, rawBranch, rawBranch],
      );
      if (br) branchId = br.id;
    }

    const excludeProductId = (ctx.query.productId ?? ctx.query.excludeId ?? '').toString().trim() || null;

    let itemFilter = 'WHERE tenant_id = ? AND barcode = ?';
    const itemParams: unknown[] = [tenantId, barcode];
    if (branchId) {
      itemFilter += ' AND branch_id = ?';
      itemParams.push(branchId);
    }
    if (excludeProductId) {
      itemFilter += ' AND id <> ?';
      itemParams.push(excludeProductId);
    }

    if (barcodeType === 'INTERNAL') {
      // Internal barcodes must be unique within the branch
      const dupItem = await ctx.db.one<{ id: string; name: string }>(
        `SELECT id, name FROM items ${itemFilter} LIMIT 1`,
        itemParams,
      );
      if (dupItem) {
        return {
          available: false,
          conflict: true,
          barcodeType: 'INTERNAL',
          branchId,
          conflictingItem: { id: dupItem.id, name: dupItem.name },
          message: `Internal barcode "${barcode}" is already used by "${dupItem.name}" in this branch.`,
        };
      }

      let pbFilter = `WHERE pb.tenant_id = ? AND pb.barcode = ? AND pb.barcode_type = 'INTERNAL'`;
      const pbParams: unknown[] = [tenantId, barcode];
      if (branchId) {
        pbFilter += ' AND pb.branch_id = ?';
        pbParams.push(branchId);
      }
      if (excludeProductId) {
        pbFilter += ' AND pb.product_id <> ?';
        pbParams.push(excludeProductId);
      }

      const dupPb = await ctx.db.one<{ productId: string; name: string }>(
        `SELECT pb.product_id, i.name
         FROM product_barcodes pb
         JOIN items i ON i.id = pb.product_id
         ${pbFilter}
         LIMIT 1`,
        pbParams,
      );
      if (dupPb) {
        return {
          available: false,
          conflict: true,
          barcodeType: 'INTERNAL',
          branchId,
          conflictingItem: { id: dupPb.productId, name: dupPb.name },
          message: `Internal barcode "${barcode}" is already registered to "${dupPb.name}" in this branch.`,
        };
      }

      return { available: true, conflict: false, barcodeType: 'INTERNAL', branchId };
    } else {
      // Manufacturer Barcode: allowed across branches! Only check within the same branch
      const dupItem = await ctx.db.one<{ id: string; name: string }>(
        `SELECT id, name FROM items ${itemFilter} LIMIT 1`,
        itemParams,
      );
      if (dupItem) {
        return {
          available: false,
          conflict: true,
          barcodeType: 'MANUFACTURER',
          branchId,
          conflictingItem: { id: dupItem.id, name: dupItem.name },
          message: `Manufacturer barcode "${barcode}" is already assigned to "${dupItem.name}" in this branch.`,
        };
      }

      let pbFilter = `WHERE pb.tenant_id = ? AND pb.barcode = ?`;
      const pbParams: unknown[] = [tenantId, barcode];
      if (branchId) {
        pbFilter += ' AND pb.branch_id = ?';
        pbParams.push(branchId);
      }
      if (excludeProductId) {
        pbFilter += ' AND pb.product_id <> ?';
        pbParams.push(excludeProductId);
      }

      const dupPb = await ctx.db.one<{ productId: string; name: string }>(
        `SELECT pb.product_id, i.name
         FROM product_barcodes pb
         JOIN items i ON i.id = pb.product_id
         ${pbFilter}
         LIMIT 1`,
        pbParams,
      );
      if (dupPb) {
        return {
          available: false,
          conflict: true,
          barcodeType: 'MANUFACTURER',
          branchId,
          conflictingItem: { id: dupPb.productId, name: dupPb.name },
          message: `Manufacturer barcode "${barcode}" is already registered to "${dupPb.name}" in this branch.`,
        };
      }

      return { available: true, conflict: false, barcodeType: 'MANUFACTURER', branchId };
    }
  });

  // Validate / duplicate-check SKU for a branch
  r.get('/api/items/check-sku', requirePerm('items.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    const sku = (ctx.query.sku ?? '').toString().trim();
    if (!sku) throw bad('SKU is required', 'VALIDATION', { field: 'sku' });

    const rawBranch = (ctx.query.branchId ?? scope.branchId ?? '').toString().trim();
    let branchId = scope.branchId;
    if (rawBranch && rawBranch.toLowerCase() !== 'all') {
      const br = await ctx.db.one<{ id: string }>(
        'SELECT id FROM branches WHERE tenant_id = ? AND (id = ? OR UPPER(code) = UPPER(?)) AND deleted_at IS NULL LIMIT 1',
        [tenantId, rawBranch, rawBranch],
      );
      if (br) branchId = br.id;
    }
    if (!branchId) {
      const fallbackBr = await ctx.db.one<{ id: string }>(
        "SELECT id FROM branches WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY (code = 'MAIN') DESC, created_at ASC LIMIT 1",
        [tenantId],
      );
      branchId = fallbackBr?.id || null;
    }

    const excludeProductId = (ctx.query.productId ?? ctx.query.excludeId ?? '').toString().trim() || null;

    let itemFilter = 'WHERE tenant_id = ? AND lower(sku) = lower(?)';
    const itemParams: unknown[] = [tenantId, sku];
    if (branchId) {
      itemFilter += ' AND branch_id = ?';
      itemParams.push(branchId);
    }
    if (excludeProductId) {
      itemFilter += ' AND id <> ?';
      itemParams.push(excludeProductId);
    }

    const dupItem = await ctx.db.one<{ id: string; name: string }>(
      `SELECT id, name FROM items ${itemFilter} LIMIT 1`,
      itemParams,
    );
    if (dupItem) {
      return {
        available: false,
        conflict: true,
        branchId,
        conflictingItem: { id: dupItem.id, name: dupItem.name },
        message: `SKU "${sku}" is already used by "${dupItem.name}" in this branch.`,
      };
    }

    return { available: true, conflict: false, branchId };
  });

  // Get single item by ID
  r.get('/api/items/:id', requirePerm('items.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    let targetBranch: { id: string; name: string; code: string } | null = null;
    if (!scope.isSuperAdminAll && scope.branchId) {
      targetBranch = (await ctx.db.one<{ id: string; name: string; code: string }>(
        'SELECT id, name, code FROM branches WHERE tenant_id = ? AND (id = ? OR UPPER(code) = UPPER(?)) AND deleted_at IS NULL LIMIT 1',
        [tenantId, scope.branchId, scope.branchId],
      )) ?? { id: scope.branchId, name: 'Branch', code: scope.branchId };
    }

    let sql: string;
    let params: unknown[];

    if (targetBranch) {
      const assoc = buildBranchAssociationClause(targetBranch.id, targetBranch.code);
      sql = `SELECT i.*,
                    ? AS branch_id,
                    ? AS branch_name,
                    ? AS branch_code,
                    COALESCE((
                      SELECT json_agg(bc_row)
                      FROM (
                        SELECT DISTINCT ON (pb.barcode)
                          pb.id, pb.barcode, pb.barcode_type AS "barcodeType", pb.barcode_type, pb.branch_id AS "branchId"
                        FROM product_barcodes pb
                        WHERE pb.tenant_id = i.tenant_id
                          AND pb.product_id = i.id
                          AND (pb.branch_id = ? OR pb.branch_id = i.branch_id OR pb.branch_id IS NULL)
                        ORDER BY pb.barcode, (pb.branch_id = ?) DESC, pb.created_at ASC
                      ) bc_row
                    ), '[]'::json) AS all_barcodes,
                    COALESCE((
                      SELECT SUM(sm.qty_milli)
                      FROM stock_moves sm
                      WHERE sm.item_id = i.id
                        AND sm.tenant_id = i.tenant_id
                        AND (
                          sm.branch_id = ?
                          OR (sm.branch_id IS NULL AND (UPPER(sm.location) = UPPER(?) OR UPPER(sm.location) = UPPER(?)))
                        )
                    ), 0) AS current_stock_milli
             FROM items i
             WHERE i.tenant_id = ? AND i.id = ?
               AND ${assoc.sql}`;
      params = [
        targetBranch.id, targetBranch.name, targetBranch.code,
        targetBranch.id, targetBranch.id,
        targetBranch.id, targetBranch.code, targetBranch.id,
        tenantId, ctx.params.id,
        ...assoc.params,
      ];
    } else {
      sql = `SELECT i.*,
                    b.name AS branch_name,
                    b.code AS branch_code,
                    COALESCE((
                      SELECT json_agg(bc_row)
                      FROM (
                        SELECT DISTINCT ON (pb.barcode)
                          pb.id, pb.barcode, pb.barcode_type AS "barcodeType", pb.barcode_type, pb.branch_id AS "branchId"
                        FROM product_barcodes pb
                        WHERE pb.tenant_id = i.tenant_id
                          AND pb.product_id = i.id
                        ORDER BY pb.barcode, pb.created_at ASC
                      ) bc_row
                    ), '[]'::json) AS all_barcodes,
                    COALESCE((
                      SELECT SUM(sm.qty_milli)
                      FROM stock_moves sm
                      WHERE sm.item_id = i.id AND sm.tenant_id = i.tenant_id
                    ), 0) AS current_stock_milli
             FROM items i
             LEFT JOIN branches b ON b.id = i.branch_id AND b.tenant_id = i.tenant_id
             WHERE i.tenant_id = ? AND i.id = ?`;
      params = [tenantId, ctx.params.id];
    }

    const row = await ctx.db.one(sql, params);
    if (!row) throw notFound('Item');
    return { item: formatItem(row) };
  });

  // Get single item by exact barcode (for barcode scanners) — checks both primary and product_barcodes
  r.get('/api/items/by-barcode/:code', requirePerm('items.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    const code = (ctx.params.code ?? '').trim();
    if (!code) throw bad('Barcode is required', 'VALIDATION', { field: 'code' });

    let targetBranch: { id: string; name: string; code: string } | null = null;
    if (!scope.isSuperAdminAll && scope.branchId) {
      targetBranch = (await ctx.db.one<{ id: string; name: string; code: string }>(
        'SELECT id, name, code FROM branches WHERE tenant_id = ? AND (id = ? OR UPPER(code) = UPPER(?)) AND deleted_at IS NULL LIMIT 1',
        [tenantId, scope.branchId, scope.branchId],
      )) ?? { id: scope.branchId, name: 'Branch', code: scope.branchId };
    }

    const prefix12 = code.length === 13 ? code.slice(0, 12) : code;
    let row: any = null;

    if (targetBranch) {
      const assoc = buildBranchAssociationClause(targetBranch.id, targetBranch.code);
      row = await ctx.db.one(
        `SELECT i.*,
                ? AS branch_id,
                ? AS branch_name,
                ? AS branch_code,
                COALESCE((
                  SELECT json_agg(bc_row)
                  FROM (
                    SELECT DISTINCT ON (pb.barcode)
                      pb.id, pb.barcode, pb.barcode_type AS "barcodeType", pb.barcode_type, pb.branch_id AS "branchId"
                    FROM product_barcodes pb
                    WHERE pb.tenant_id = i.tenant_id
                      AND pb.product_id = i.id
                      AND (pb.branch_id = ? OR pb.branch_id = i.branch_id OR pb.branch_id IS NULL)
                    ORDER BY pb.barcode, (pb.branch_id = ?) DESC, pb.created_at ASC
                  ) bc_row
                ), '[]'::json) AS all_barcodes,
                COALESCE((
                  SELECT SUM(sm.qty_milli)
                  FROM stock_moves sm
                  WHERE sm.item_id = i.id
                    AND sm.tenant_id = i.tenant_id
                    AND (
                      sm.branch_id = ?
                      OR (sm.branch_id IS NULL AND (UPPER(sm.location) = UPPER(?) OR UPPER(sm.location) = UPPER(?)))
                    )
                ), 0) AS current_stock_milli
         FROM items i
         WHERE i.tenant_id = ? AND i.active = true
           AND ${assoc.sql}
           AND (
             i.barcode = ?
             OR (length(?) = 13 AND i.barcode = ?)
             OR (length(i.barcode) = 13 AND substr(i.barcode, 1, 12) = ?)
             OR EXISTS (
               SELECT 1 FROM product_barcodes pb
               WHERE pb.tenant_id = i.tenant_id
                 AND (pb.branch_id = ? OR pb.branch_id = i.branch_id OR pb.branch_id IS NULL)
                 AND pb.product_id = i.id
                 AND (pb.barcode = ? OR (length(?) = 13 AND pb.barcode = ?))
             )
           )
         LIMIT 1`,
        [
          targetBranch.id, targetBranch.name, targetBranch.code,
          targetBranch.id, targetBranch.id,
          targetBranch.id, targetBranch.code, targetBranch.id,
          tenantId,
          ...assoc.params,
          code, code, prefix12, prefix12,
          targetBranch.id, code, code, prefix12,
        ],
      );
    } else {
      row = await ctx.db.one(
        `SELECT i.*,
                b.name AS branch_name,
                b.code AS branch_code,
                COALESCE((
                  SELECT json_agg(bc_row)
                  FROM (
                    SELECT DISTINCT ON (pb.barcode)
                      pb.id, pb.barcode, pb.barcode_type AS "barcodeType", pb.barcode_type, pb.branch_id AS "branchId"
                    FROM product_barcodes pb
                    WHERE pb.tenant_id = i.tenant_id
                      AND pb.product_id = i.id
                    ORDER BY pb.barcode, pb.created_at ASC
                  ) bc_row
                ), '[]'::json) AS all_barcodes,
                COALESCE((
                  SELECT SUM(sm.qty_milli)
                  FROM stock_moves sm
                  WHERE sm.item_id = i.id AND sm.tenant_id = i.tenant_id
                ), 0) AS current_stock_milli
         FROM items i
         LEFT JOIN branches b ON b.id = i.branch_id AND b.tenant_id = i.tenant_id
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
    }

    if (!row && code.length >= 8 && /^\d+$/.test(code)) {
      let candidateSql: string;
      let candParams: unknown[];
      if (targetBranch) {
        const assoc = buildBranchAssociationClause(targetBranch.id, targetBranch.code);
        candidateSql = `SELECT id, barcode FROM items i WHERE tenant_id = ? AND active = true AND barcode IS NOT NULL AND ${assoc.sql}`;
        candParams = [tenantId, ...assoc.params];
      } else {
        candidateSql = `SELECT id, barcode FROM items WHERE tenant_id = ? AND active = true AND barcode IS NOT NULL`;
        candParams = [tenantId];
      }
      const allRows = await ctx.db.query<{ id: string; barcode: string | null }>(candidateSql, candParams);
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
        let candidateRow: any;
        if (targetBranch) {
          candidateRow = await ctx.db.one(
            `SELECT i.*,
                    ? AS branch_id,
                    ? AS branch_name,
                    ? AS branch_code,
                    COALESCE((
                      SELECT json_agg(bc_row)
                      FROM (
                        SELECT DISTINCT ON (pb.barcode)
                          pb.id, pb.barcode, pb.barcode_type AS "barcodeType", pb.barcode_type, pb.branch_id AS "branchId"
                        FROM product_barcodes pb
                        WHERE pb.tenant_id = i.tenant_id
                          AND pb.product_id = i.id
                          AND (pb.branch_id = ? OR pb.branch_id = i.branch_id OR pb.branch_id IS NULL)
                        ORDER BY pb.barcode, (pb.branch_id = ?) DESC, pb.created_at ASC
                      ) bc_row
                    ), '[]'::json) AS all_barcodes,
                    COALESCE((
                      SELECT SUM(sm.qty_milli)
                      FROM stock_moves sm
                      WHERE sm.item_id = i.id
                        AND sm.tenant_id = i.tenant_id
                        AND (
                          sm.branch_id = ?
                          OR (sm.branch_id IS NULL AND (UPPER(sm.location) = UPPER(?) OR UPPER(sm.location) = UPPER(?)))
                        )
                    ), 0) AS current_stock_milli
             FROM items i WHERE i.id = ? AND i.tenant_id = ?`,
            [
              targetBranch.id, targetBranch.name, targetBranch.code,
              targetBranch.id, targetBranch.id,
              targetBranch.id, targetBranch.code, targetBranch.id,
              candidates[0].id, tenantId,
            ],
          );
        } else {
          candidateRow = await ctx.db.one(
            `SELECT i.*,
                    b.name AS branch_name,
                    b.code AS branch_code,
                    COALESCE((
                      SELECT json_agg(bc_row)
                      FROM (
                        SELECT DISTINCT ON (pb.barcode)
                          pb.id, pb.barcode, pb.barcode_type AS "barcodeType", pb.barcode_type, pb.branch_id AS "branchId"
                        FROM product_barcodes pb
                        WHERE pb.tenant_id = i.tenant_id
                          AND pb.product_id = i.id
                        ORDER BY pb.barcode, pb.created_at ASC
                      ) bc_row
                    ), '[]'::json) AS all_barcodes,
                    COALESCE((
                      SELECT SUM(sm.qty_milli)
                      FROM stock_moves sm
                      WHERE sm.item_id = i.id AND sm.tenant_id = i.tenant_id
                    ), 0) AS current_stock_milli
             FROM items i
             LEFT JOIN branches b ON b.id = i.branch_id AND b.tenant_id = i.tenant_id
             WHERE i.id = ? AND i.tenant_id = ?`,
            [candidates[0].id, tenantId],
          );
        }
        if (candidateRow) return { item: formatItem(candidateRow) };
      }
    }

    if (!row) throw notFound('Item');
    return { item: formatItem(row) };
  });

  // Get all registered barcodes for an item
  r.get('/api/items/:id/barcodes', requirePerm('items.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    let targetBranch: { id: string; name: string; code: string } | null = null;
    if (!scope.isSuperAdminAll && scope.branchId) {
      targetBranch = (await ctx.db.one<{ id: string; name: string; code: string }>(
        'SELECT id, name, code FROM branches WHERE tenant_id = ? AND (id = ? OR UPPER(code) = UPPER(?)) AND deleted_at IS NULL LIMIT 1',
        [tenantId, scope.branchId, scope.branchId],
      )) ?? { id: scope.branchId, name: 'Branch', code: scope.branchId };
    }

    let itemSql = 'SELECT id, branch_id FROM items i WHERE id = ? AND tenant_id = ?';
    const itemParams: unknown[] = [ctx.params.id, tenantId];
    if (targetBranch) {
      const assoc = buildBranchAssociationClause(targetBranch.id, targetBranch.code);
      itemSql += ` AND ${assoc.sql}`;
      itemParams.push(...assoc.params);
    }
    const item = await ctx.db.one<{ id: string; branchId?: string; branch_id?: string }>(itemSql, itemParams);
    if (!item) throw notFound('Item');

    let bcSql = 'SELECT id, barcode, barcode_type, branch_id, created_at FROM product_barcodes WHERE tenant_id = ? AND product_id = ?';
    const bcParams: unknown[] = [tenantId, item.id];
    if (targetBranch) {
      bcSql += ' AND (branch_id = ? OR branch_id = ? OR branch_id IS NULL)';
      bcParams.push(targetBranch.id, item.branchId ?? item.branch_id);
    }
    bcSql += ' ORDER BY created_at ASC';

    const rows = await ctx.db.query(bcSql, bcParams);
    const barcodes = rows.map((r: any) => ({
      id: r.id,
      barcode: r.barcode,
      barcodeType: r.barcodeType ?? r.barcode_type,
      barcode_type: r.barcodeType ?? r.barcode_type,
      branchId: r.branchId ?? r.branch_id ?? null,
      createdAt: r.createdAt ?? r.created_at,
    }));
    return { barcodes };
  });

  // Add a new barcode (INTERNAL or MANUFACTURER) to an existing product
  r.post('/api/items/:id/barcodes', requirePerm('items.write'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    let targetBranch: { id: string; name: string; code: string } | null = null;
    if (!scope.isSuperAdminAll && scope.branchId) {
      targetBranch = (await ctx.db.one<{ id: string; name: string; code: string }>(
        'SELECT id, name, code FROM branches WHERE tenant_id = ? AND (id = ? OR UPPER(code) = UPPER(?)) AND deleted_at IS NULL LIMIT 1',
        [tenantId, scope.branchId, scope.branchId],
      )) ?? { id: scope.branchId, name: 'Branch', code: scope.branchId };
    }

    let itemSql = 'SELECT id, name, branch_id FROM items i WHERE id = ? AND tenant_id = ?';
    const itemParams: unknown[] = [ctx.params.id, tenantId];
    if (targetBranch) {
      const assoc = buildBranchAssociationClause(targetBranch.id, targetBranch.code);
      itemSql += ` AND ${assoc.sql}`;
      itemParams.push(...assoc.params);
    }
    const item = await ctx.db.one<{ id: string; name: string; branchId?: string; branch_id?: string }>(itemSql, itemParams);
    if (!item) throw notFound('Item');
    const branchId = b.branchId || b.branch_id || targetBranch?.id || item.branchId || item.branch_id || scope.branchId;

    const barcode = V.str(b.barcode, 'Barcode', { required: true, max: 60 }).trim();
    const rawType = (b.barcodeType || '').toString().toUpperCase();
    const barcodeType: 'INTERNAL' | 'MANUFACTURER' = rawType === 'INTERNAL'
      ? 'INTERNAL'
      : (rawType === 'MANUFACTURER' ? 'MANUFACTURER' : (barcode.startsWith('20') && barcode.length === 13 ? 'INTERNAL' : 'MANUFACTURER'));

    // Verify barcode uniqueness against other items in the same branch
    const existingItem = await ctx.db.one<{ id: string; name: string }>(
      'SELECT id, name FROM items WHERE tenant_id = ? AND branch_id = ? AND barcode = ? AND id <> ?',
      [tenantId, branchId, barcode, item.id],
    );
    if (existingItem) {
      throw conflict(`Barcode "${barcode}" is already used by item "${existingItem.name}" in this branch.`);
    }

    if (barcodeType === 'INTERNAL') {
      const existingMapping = await ctx.db.one<{ productId: string }>(
        "SELECT product_id FROM product_barcodes WHERE tenant_id = ? AND branch_id = ? AND barcode = ? AND product_id <> ? AND barcode_type = 'INTERNAL'",
        [tenantId, branchId, barcode, item.id],
      );
      if (existingMapping) {
        throw conflict(`Internal barcode "${barcode}" is already registered to another item in this branch.`);
      }
    }

    // Check if this product already has this barcode registered
    const existingSelf = await ctx.db.one<{ id: string }>(
      'SELECT id FROM product_barcodes WHERE tenant_id = ? AND branch_id = ? AND product_id = ? AND barcode = ?',
      [tenantId, branchId, item.id, barcode],
    );

    let bcId = existingSelf?.id;
    if (!bcId) {
      bcId = newId('bc');
      await ctx.db.exec(
        `INSERT INTO product_barcodes (id, tenant_id, branch_id, product_id, barcode, barcode_type)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [bcId, tenantId, branchId, item.id, barcode, barcodeType],
      );
    }

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
    const scope = await resolveBranchScope(ctx);
    let branchId: string | null = null;
    const candidateBranch = (b.branchId || b.branch_id || scope.branchId || '').toString().trim();
    if (candidateBranch && candidateBranch.toLowerCase() !== 'all') {
      const br = await ctx.db.one<{ id: string }>(
        'SELECT id FROM branches WHERE tenant_id = ? AND (id = ? OR UPPER(code) = UPPER(?)) AND deleted_at IS NULL LIMIT 1',
        [tenantId, candidateBranch, candidateBranch],
      );
      if (br) branchId = br.id;
    }
    if (!branchId) {
      const fallbackBr = await ctx.db.one<{ id: string }>(
        "SELECT id FROM branches WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY (code = 'MAIN') DESC, created_at ASC LIMIT 1",
        [tenantId],
      );
      branchId = fallbackBr?.id || null;
    }
    if (!branchId) {
      throw bad('Branch ID is required to create an item.', 'BRANCH_REQUIRED');
    }

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
    const preferredSupplierId = V.optStr(b.preferredSupplierId, 'Preferred supplier', 60);
    const favorite = V.bool(b.favorite, false);
    const custom = validateCustom(b.custom);
    const openingQtyMilli = V.int(b.openingQtyMilli ?? b.openingStockMilli ?? 0, 'Opening quantity', { min: 0 });
    const imageUrl = (b.imageUrl ?? b.image) ? String(b.imageUrl ?? b.image).trim() : null;

    if (barcode) {
      const rawType = (b.barcodeType || '').toString().toUpperCase();
      const barcodeType: 'INTERNAL' | 'MANUFACTURER' = rawType === 'INTERNAL'
        ? 'INTERNAL'
        : (rawType === 'MANUFACTURER' ? 'MANUFACTURER' : (barcode.startsWith('20') && barcode.length === 13 ? 'INTERNAL' : 'MANUFACTURER'));

      const existing = await ctx.db.one<{ id: string; name: string }>(
        'SELECT id, name FROM items WHERE tenant_id = ? AND branch_id = ? AND barcode = ?',
        [tenantId, branchId, barcode],
      );
      if (existing) {
        throw conflict(`Item "${existing.name}" already uses this barcode in this branch.`);
      }

      if (barcodeType === 'INTERNAL') {
        const existingPb = await ctx.db.one<{ productId: string }>(
          "SELECT product_id FROM product_barcodes WHERE tenant_id = ? AND branch_id = ? AND barcode = ? AND barcode_type = 'INTERNAL'",
          [tenantId, branchId, barcode],
        );
        if (existingPb) {
          throw conflict(`Internal barcode "${barcode}" is already registered to another item in this branch.`);
        }
      }
    }

    if (sku) {
      const existingSku = await ctx.db.one<{ id: string; name: string }>(
        'SELECT id, name FROM items WHERE tenant_id = ? AND branch_id = ? AND lower(sku) = lower(?)',
        [tenantId, branchId, sku],
      );
      if (existingSku) {
        throw conflict(`Item "${existingSku.name}" already uses this SKU code in this branch.`);
      }
    }

    const id = newId('i');

    await ctx.db.tx(async (q) => {
      const rawType = (b.barcodeType || '').toString().toUpperCase();
      const barcodeType: 'INTERNAL' | 'MANUFACTURER' = rawType === 'INTERNAL'
        ? 'INTERNAL'
        : (rawType === 'MANUFACTURER' ? 'MANUFACTURER' : (barcode && barcode.startsWith('20') && barcode.length === 13 ? 'INTERNAL' : 'MANUFACTURER'));

      await q.exec(
        `INSERT INTO items (
          id, tenant_id, branch_id, name, sku, barcode, barcode_type, hsn, unit, category,
          price_minor, cost_minor, tax_rate_bp, tax_inclusive, track_stock,
          reorder_milli, preferred_supplier_id, favorite, custom, active, image_url
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, true, ?)`,
        [id, tenantId, branchId, name, sku, barcode, barcode ? barcodeType : 'INTERNAL', hsn, unit, category, priceMinor, costMinor, taxRateBp, taxInclusive, trackStock, reorderMilli, preferredSupplierId || null, favorite, JSON.stringify(custom), imageUrl],
      );

      if (barcode) {
        await q.exec(
          `INSERT INTO product_barcodes (id, tenant_id, branch_id, product_id, barcode, barcode_type)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [newId('bc'), tenantId, branchId, id, barcode, barcodeType],
        );
      }

      if (openingQtyMilli > 0) {
        await q.exec(
          `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, location, qty_milli, kind, unit_cost_minor, reason, user_id)
           VALUES (?, ?, ?, ?, 'MAIN', ?, 'opening', ?, 'Initial Stock', ?)`,
          [newId('sm'), tenantId, branchId, id, openingQtyMilli, costMinor, ctx.user!.id],
        );
      }

      await audit(q, ctx, { action: 'item.create', entity: 'item', entityId: id, detail: { name, priceMinor, branchId } });
    });

    const created = await ctx.db.one(
      `SELECT i.*,
              COALESCE((SELECT SUM(sm.qty_milli) FROM stock_moves sm WHERE sm.item_id = i.id AND sm.tenant_id = i.tenant_id AND sm.branch_id = i.branch_id), 0) AS current_stock_milli
       FROM items i
       WHERE i.id = ? AND i.tenant_id = ?`,
      [id, tenantId],
    );
    return { item: formatItem(created) };
  });

  // Update item
  r.patch('/api/items/:id', requirePerm('items.write'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    let targetBranch: { id: string; name: string; code: string } | null = null;
    if (!scope.isSuperAdminAll && scope.branchId) {
      targetBranch = (await ctx.db.one<{ id: string; name: string; code: string }>(
        'SELECT id, name, code FROM branches WHERE tenant_id = ? AND (id = ? OR UPPER(code) = UPPER(?)) AND deleted_at IS NULL LIMIT 1',
        [tenantId, scope.branchId, scope.branchId],
      )) ?? { id: scope.branchId, name: 'Branch', code: scope.branchId };
    }

    let itemSql = 'SELECT * FROM items i WHERE id = ? AND tenant_id = ?';
    const itemParams: unknown[] = [ctx.params.id, tenantId];
    if (targetBranch) {
      const assoc = buildBranchAssociationClause(targetBranch.id, targetBranch.code);
      itemSql += ` AND ${assoc.sql}`;
      itemParams.push(...assoc.params);
    }
    const item = await ctx.db.one(itemSql, itemParams);
    if (!item) throw notFound('Item');
    const branchId = b.branchId || b.branch_id || targetBranch?.id || item.branchId || item.branch_id || scope.branchId;

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
    const preferredSupplierId = b.preferredSupplierId !== undefined ? V.optStr(b.preferredSupplierId, 'Preferred supplier', 60) : (item.preferredSupplierId ?? item.preferred_supplier_id ?? null);
    const favorite = b.favorite !== undefined ? V.bool(b.favorite) : Boolean(item.favorite);
    const custom = b.custom !== undefined ? validateCustom(b.custom) : (typeof item.custom === 'string' ? JSON.parse(item.custom) : (item.custom ?? {}));
    const active = b.active !== undefined ? V.bool(b.active) : Boolean(item.active);
    const hasImage = b.imageUrl !== undefined || b.image !== undefined;
    const imageUrl = hasImage ? ((b.imageUrl ?? b.image) ? String(b.imageUrl ?? b.image).trim() : null) : (item.imageUrl ?? item.image_url ?? null);

    if (barcode && barcode !== item.barcode) {
      const rawType = (b.barcodeType || '').toString().toUpperCase();
      const barcodeType: 'INTERNAL' | 'MANUFACTURER' = rawType === 'INTERNAL'
        ? 'INTERNAL'
        : (rawType === 'MANUFACTURER' ? 'MANUFACTURER' : (barcode.startsWith('20') && barcode.length === 13 ? 'INTERNAL' : 'MANUFACTURER'));

      const dup = await ctx.db.one<{ id: string; name: string }>(
        'SELECT id, name FROM items WHERE tenant_id = ? AND branch_id = ? AND barcode = ? AND id <> ?',
        [tenantId, branchId, barcode, item.id],
      );
      if (dup) {
        throw conflict(`Item "${dup.name}" already uses this barcode in this branch.`);
      }

      if (barcodeType === 'INTERNAL') {
        const existingPb = await ctx.db.one<{ productId: string }>(
          "SELECT product_id FROM product_barcodes WHERE tenant_id = ? AND branch_id = ? AND barcode = ? AND product_id <> ? AND barcode_type = 'INTERNAL'",
          [tenantId, branchId, barcode, item.id],
        );
        if (existingPb) {
          throw conflict(`Internal barcode "${barcode}" is already registered to another item in this branch.`);
        }
      }
    }

    if (sku && sku !== item.sku) {
      const dupSku = await ctx.db.one<{ id: string; name: string }>(
        'SELECT id, name FROM items WHERE tenant_id = ? AND branch_id = ? AND lower(sku) = lower(?) AND id <> ?',
        [tenantId, branchId, sku, item.id],
      );
      if (dupSku) {
        throw conflict(`Item "${dupSku.name}" already uses this SKU code in this branch.`);
      }
    }

    await ctx.db.tx(async (q) => {
      const rawType = (b.barcodeType || '').toString().toUpperCase();
      const bType: 'INTERNAL' | 'MANUFACTURER' = rawType === 'INTERNAL'
        ? 'INTERNAL'
        : (rawType === 'MANUFACTURER' ? 'MANUFACTURER' : (item.barcode_type || (barcode && barcode.startsWith('20') && barcode.length === 13 ? 'INTERNAL' : 'MANUFACTURER')));

      await q.exec(
        `UPDATE items SET
          name = ?, price_minor = ?, cost_minor = ?, tax_rate_bp = ?, sku = ?, barcode = ?, barcode_type = ?,
          hsn = ?, unit = ?, category = ?, tax_inclusive = ?, track_stock = ?, reorder_milli = ?,
          preferred_supplier_id = ?, favorite = ?, custom = ?::jsonb, active = ?, image_url = ?, updated_at = now()
         WHERE id = ? AND tenant_id = ?`,
        [name, priceMinor, costMinor, taxRateBp, sku, barcode, barcode ? bType : (item.barcode_type || 'INTERNAL'), hsn, unit, category, taxInclusive, trackStock, reorderMilli, preferredSupplierId || null, favorite, JSON.stringify(custom ?? {}), active, imageUrl, item.id, tenantId],
      );

      // Keep product_barcodes table synchronized
      if (barcode !== item.barcode) {
        if (item.barcode) {
          await q.exec(
            'DELETE FROM product_barcodes WHERE tenant_id = ? AND branch_id = ? AND product_id = ? AND barcode = ?',
            [tenantId, branchId, item.id, item.barcode],
          );
        }
        if (barcode) {
          await q.exec(
            'DELETE FROM product_barcodes WHERE tenant_id = ? AND branch_id = ? AND product_id = ? AND barcode = ?',
            [tenantId, branchId, item.id, barcode],
          );
          await q.exec(
            `INSERT INTO product_barcodes (id, tenant_id, branch_id, product_id, barcode, barcode_type)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [newId('bc'), tenantId, branchId, item.id, barcode, bType],
          );
        }
      }

      await audit(q, ctx, { action: 'item.update', entity: 'item', entityId: item.id, detail: { name, priceMinor, active } });
    });

    const updated = await ctx.db.one(
      `SELECT i.*,
              COALESCE(?, i.branch_id) AS branch_id,
              COALESCE(?, b.name) AS branch_name,
              COALESCE(?, b.code) AS branch_code,
              COALESCE((
                SELECT SUM(sm.qty_milli)
                FROM stock_moves sm
                WHERE sm.item_id = i.id
                  AND sm.tenant_id = i.tenant_id
                  AND (
                    sm.branch_id = COALESCE(?, i.branch_id)
                    OR (sm.branch_id IS NULL AND (UPPER(sm.location) = UPPER(COALESCE(?, b.code, 'MAIN')) OR UPPER(sm.location) = UPPER(COALESCE(?, i.branch_id, 'MAIN'))))
                  )
              ), 0) AS current_stock_milli
       FROM items i
       LEFT JOIN branches b ON b.id = i.branch_id AND b.tenant_id = i.tenant_id
       WHERE i.id = ? AND i.tenant_id = ?`,
      [
        targetBranch?.id ?? null,
        targetBranch?.name ?? null,
        targetBranch?.code ?? null,
        targetBranch?.id ?? null,
        targetBranch?.code ?? null,
        targetBranch?.id ?? null,
        item.id,
        tenantId,
      ],
    );
    return { item: formatItem(updated) };
  });

  // Permanent delete item & reclaim DB storage
  r.delete('/api/items/:id', requirePerm('items.write'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    let itemSql = 'SELECT * FROM items WHERE id = ? AND tenant_id = ?';
    const itemParams: unknown[] = [ctx.params.id, tenantId];
    if (!scope.isSuperAdminAll && scope.branchId) {
      itemSql += ' AND branch_id = ?';
      itemParams.push(scope.branchId);
    }
    const item = await ctx.db.one(itemSql, itemParams);
    if (!item) throw notFound('Item');

    await ctx.db.tx(async (q) => {
      await q.exec('UPDATE invoice_lines SET item_id = NULL WHERE item_id = ? AND tenant_id = ?', [item.id, tenantId]);
      await q.exec('UPDATE purchase_lines SET item_id = NULL WHERE item_id = ? AND tenant_id = ?', [item.id, tenantId]);
      await q.exec('UPDATE stock_transfer_lines SET item_id = NULL WHERE item_id = ? AND tenant_id = ?', [item.id, tenantId]);
      await q.exec('DELETE FROM stock_adjustments WHERE item_id = ? AND tenant_id = ?', [item.id, tenantId]);
      await q.exec('DELETE FROM stock_count_lines WHERE item_id = ? AND tenant_id = ?', [item.id, tenantId]);
      await q.exec('DELETE FROM stock_moves WHERE item_id = ? AND tenant_id = ?', [item.id, tenantId]);
      await q.exec('DELETE FROM product_barcodes WHERE product_id = ? AND tenant_id = ?', [item.id, tenantId]);
      await q.exec('DELETE FROM items WHERE id = ? AND tenant_id = ?', [item.id, tenantId]);
      await audit(q, ctx, {
        action: 'item.delete',
        entity: 'item',
        entityId: item.id,
        detail: { name: item.name, sku: item.sku, barcode: item.barcode },
      });
    });

    return { ok: true, deleted: true, itemId: item.id, message: `Product "${item.name}" permanently deleted from database` };
  });

  // Dedicated permanent delete route alias
  r.delete('/api/items/:id/permanent', requirePerm('items.write'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    let itemSql = 'SELECT * FROM items WHERE id = ? AND tenant_id = ?';
    const itemParams: unknown[] = [ctx.params.id, tenantId];
    if (!scope.isSuperAdminAll && scope.branchId) {
      itemSql += ' AND branch_id = ?';
      itemParams.push(scope.branchId);
    }
    const item = await ctx.db.one(itemSql, itemParams);
    if (!item) throw notFound('Item');

    await ctx.db.tx(async (q) => {
      await q.exec('UPDATE invoice_lines SET item_id = NULL WHERE item_id = ? AND tenant_id = ?', [item.id, tenantId]);
      await q.exec('UPDATE purchase_lines SET item_id = NULL WHERE item_id = ? AND tenant_id = ?', [item.id, tenantId]);
      await q.exec('UPDATE stock_transfer_lines SET item_id = NULL WHERE item_id = ? AND tenant_id = ?', [item.id, tenantId]);
      await q.exec('DELETE FROM stock_adjustments WHERE item_id = ? AND tenant_id = ?', [item.id, tenantId]);
      await q.exec('DELETE FROM stock_count_lines WHERE item_id = ? AND tenant_id = ?', [item.id, tenantId]);
      await q.exec('DELETE FROM stock_moves WHERE item_id = ? AND tenant_id = ?', [item.id, tenantId]);
      await q.exec('DELETE FROM product_barcodes WHERE product_id = ? AND tenant_id = ?', [item.id, tenantId]);
      await q.exec('DELETE FROM items WHERE id = ? AND tenant_id = ?', [item.id, tenantId]);
      await audit(q, ctx, {
        action: 'item.delete',
        entity: 'item',
        entityId: item.id,
        detail: { name: item.name, sku: item.sku, barcode: item.barcode },
      });
    });

    return { ok: true, deleted: true, itemId: item.id, message: `Product "${item.name}" permanently deleted from database` };
  });
}
