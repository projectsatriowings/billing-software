import { requirePerm } from '../auth.ts';
import { bad, notFound, forbidden, V, type Router, type Ctx } from '../http.ts';
import { newId } from '../security.ts';
import { audit } from '../audit.ts';
import type { Queryable } from '../db/index.ts';
import { DEFAULT_CONFIG, can, type Rules, type StockAdjustmentReason } from '../../../shared/types.ts';
import { PACKS } from '../../../shared/packs.ts';

async function getTenantRules(q: Queryable, tenantId: string): Promise<Rules> {
  const published = await q.one<{ payload: unknown }>(
    `SELECT payload FROM config_versions WHERE tenant_id = ? AND status = 'published' ORDER BY version DESC LIMIT 1`,
    [tenantId],
  );
  if (published?.payload) {
    const p = typeof published.payload === 'string' ? JSON.parse(published.payload) : published.payload;
    if (p?.rules) return { ...DEFAULT_CONFIG.rules, ...p.rules };
  }
  const tenant = await q.one<{ business_type?: string; businessType?: string }>('SELECT business_type FROM tenants WHERE id = ?', [tenantId]);
  const bType = tenant?.businessType ?? tenant?.business_type;
  const pack = PACKS.find((pk) => pk.id === (bType || 'general'));
  if (pack?.config?.rules) {
    return { ...DEFAULT_CONFIG.rules, ...pack.config.rules };
  }
  return DEFAULT_CONFIG.rules;
}

export function registerInventory(r: Router) {
  // 1. Inventory Dashboard Summary Stats
  r.get('/api/inventory/dashboard', requirePerm('stock.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const isAuthorizedForCost = ['owner', 'manager', 'accountant'].includes(ctx.user!.role);

    // Products breakdown
    const counts = await ctx.db.one<{
      totalActive: number;
      inStock: number;
      lowStock: number;
      outOfStock: number;
      unconfigured: number;
      totalStockValueMinor: number;
    }>(
      `WITH item_stock AS (
        SELECT 
          i.id,
          i.name,
          i.reorder_milli,
          COALESCE(i.min_stock_milli, 0) AS min_stock_milli,
          i.cost_minor,
          COALESCE((SELECT SUM(sm.qty_milli) FROM stock_moves sm WHERE sm.item_id = i.id AND sm.tenant_id = i.tenant_id), 0)::bigint AS stock_milli
        FROM items i
        WHERE i.tenant_id = ? AND i.active = true AND i.track_stock = true
      )
      SELECT
        COUNT(*)::int AS total_active,
        COUNT(CASE WHEN stock_milli > 0 THEN 1 END)::int AS in_stock,
        COUNT(CASE 
          WHEN stock_milli > 0 
           AND (reorder_milli > 0 OR min_stock_milli > 0)
           AND stock_milli <= GREATEST(reorder_milli, min_stock_milli)
          THEN 1 
        END)::int AS low_stock,
        COUNT(CASE WHEN stock_milli <= 0 THEN 1 END)::int AS out_of_stock,
        COUNT(CASE WHEN stock_milli = 0 THEN 1 END)::int AS zero_stock,
        COUNT(CASE WHEN stock_milli < 0 THEN 1 END)::int AS negative_stock,
        COUNT(CASE WHEN (reorder_milli = 0 AND min_stock_milli = 0) THEN 1 END)::int AS unconfigured,
        COALESCE(SUM(CASE WHEN stock_milli > 0 THEN (stock_milli * cost_minor / 1000) ELSE 0 END), 0)::bigint AS total_stock_value_minor
      FROM item_stock`,
      [tenantId],
    );

    // Category breakdown
    const categoryRows = await ctx.db.query<{
      category: string;
      productCount: number;
      totalStockMilli: number;
      stockValueMinor: number;
    }>(
      `WITH item_stock AS (
        SELECT 
          COALESCE(NULLIF(TRIM(i.category), ''), 'Uncategorized') AS category,
          COALESCE((SELECT SUM(sm.qty_milli) FROM stock_moves sm WHERE sm.item_id = i.id AND sm.tenant_id = i.tenant_id), 0)::bigint AS stock_milli,
          i.cost_minor
        FROM items i
        WHERE i.tenant_id = ? AND i.active = true AND i.track_stock = true
      )
      SELECT 
        category,
        COUNT(*)::int AS product_count,
        COALESCE(SUM(stock_milli), 0)::bigint AS total_stock_milli,
        COALESCE(SUM(CASE WHEN stock_milli > 0 THEN (stock_milli * cost_minor / 1000) ELSE 0 END), 0)::bigint AS stock_value_minor
      FROM item_stock
      GROUP BY category
      ORDER BY total_stock_milli DESC`,
      [tenantId],
    );

    // Recent Stock Movements (top 10)
    const recentMoves = await ctx.db.query(
      `SELECT 
        sm.id, sm.seq, sm.item_id, sm.location, sm.qty_milli, sm.kind,
        sm.ref_type, sm.ref_id, sm.batch_no, sm.expiry, sm.unit_cost_minor,
        sm.reason, sm.notes, sm.user_id, sm.created_at,
        i.name AS item_name, i.sku AS item_sku, i.barcode AS item_barcode, i.unit AS item_unit,
        u.name AS user_name,
        COALESCE(inv.number, pur.purchase_number, pur.supplier_invoice_number, cn.number, adj.adjustment_number, sc.count_number, sm.ref_id) AS ref_number
       FROM stock_moves sm
       JOIN items i ON i.id = sm.item_id AND i.tenant_id = sm.tenant_id
       LEFT JOIN users u ON u.id = sm.user_id
       LEFT JOIN invoices inv ON inv.id = sm.ref_id AND sm.ref_type = 'invoice'
       LEFT JOIN purchases pur ON pur.id = sm.ref_id AND sm.ref_type = 'purchase'
       LEFT JOIN invoices cn ON cn.id = sm.ref_id AND sm.ref_type = 'credit_note'
       LEFT JOIN stock_adjustments adj ON adj.id = sm.ref_id AND sm.ref_type = 'adjustment'
       LEFT JOIN stock_counts sc ON sc.id = sm.ref_id AND sm.ref_type = 'stock_count'
       WHERE sm.tenant_id = ?
       ORDER BY sm.created_at DESC, sm.seq DESC
       LIMIT 10`,
      [tenantId],
    );

    // Replenishment items needing reorder
    const replenishmentRows = await ctx.db.query(
      `WITH item_stock AS (
        SELECT 
          i.id,
          i.name,
          i.sku,
          i.barcode,
          i.category,
          i.unit,
          i.reorder_milli,
          COALESCE(i.min_stock_milli, 0) AS min_stock_milli,
          i.preferred_supplier_id,
          COALESCE((SELECT SUM(sm.qty_milli) FROM stock_moves sm WHERE sm.item_id = i.id AND sm.tenant_id = i.tenant_id), 0)::bigint AS stock_milli
        FROM items i
        WHERE i.tenant_id = ? AND i.active = true AND i.track_stock = true
          AND (i.reorder_milli > 0 OR COALESCE(i.min_stock_milli, 0) > 0)
      )
      SELECT 
        s.id AS item_id,
        s.name,
        s.sku,
        s.barcode,
        s.category,
        s.unit,
        s.stock_milli AS current_stock_milli,
        s.reorder_milli,
        s.min_stock_milli,
        p.id AS supplier_id,
        p.name AS supplier_name,
        p.phone AS supplier_phone,
        GREATEST(1000, (GREATEST(s.reorder_milli, s.min_stock_milli) * 2 - s.stock_milli)) AS suggested_order_qty_milli
      FROM item_stock s
      LEFT JOIN parties p ON p.id = s.preferred_supplier_id AND p.tenant_id = ?
      WHERE s.stock_milli <= GREATEST(s.reorder_milli, s.min_stock_milli)
      ORDER BY (s.stock_milli - GREATEST(s.reorder_milli, s.min_stock_milli)) ASC
      LIMIT 15`,
      [tenantId, tenantId],
    );

    return {
      stats: {
        totalActiveProducts: Number((counts as any)?.totalActive ?? (counts as any)?.total_active ?? 0),
        inStockCount: Number((counts as any)?.inStock ?? (counts as any)?.in_stock ?? 0),
        lowStockCount: Number((counts as any)?.lowStock ?? (counts as any)?.low_stock ?? 0),
        outOfStockCount: Number((counts as any)?.outOfStock ?? (counts as any)?.out_of_stock ?? 0),
        zeroStockCount: Number((counts as any)?.zeroStock ?? (counts as any)?.zero_stock ?? 0),
        negativeStockCount: Number((counts as any)?.negativeStock ?? (counts as any)?.negative_stock ?? 0),
        unconfiguredCount: Number((counts as any)?.unconfigured ?? 0),
        totalStockValueMinor: isAuthorizedForCost ? Number((counts as any)?.totalStockValueMinor ?? (counts as any)?.total_stock_value_minor ?? 0) : null,
        costingMethod: 'Current Item Master Cost',
        valuationDate: new Date().toISOString(),
        categoryBreakdown: categoryRows.map((c) => ({
          category: c.category,
          productCount: Number(c.productCount),
          totalStockMilli: Number(c.totalStockMilli),
          stockValueMinor: isAuthorizedForCost ? Number(c.stockValueMinor) : null,
        })),
        recentMovements: recentMoves.map((m: any) => {
          const qty = Number(m.qtyMilli ?? m.qty_milli);
          return {
            id: m.id,
            itemId: m.itemId ?? m.item_id,
            itemName: m.itemName ?? m.item_name,
            sku: m.sku ?? m.item_sku,
            barcode: m.barcode ?? m.item_barcode,
            unit: m.unit ?? m.item_unit ?? 'pcs',
            location: m.location,
            qtyMilli: qty,
            qtyInMilli: qty > 0 ? qty : 0,
            qtyOutMilli: qty < 0 ? Math.abs(qty) : 0,
            kind: m.kind,
            refType: m.refType ?? m.ref_type,
            refId: m.refId ?? m.ref_id,
            refNumber: m.refNumber ?? m.ref_number,
            batchNo: m.batchNo ?? m.batch_no,
            expiry: m.expiry,
            unitCostMinor: isAuthorizedForCost ? Number(m.unitCostMinor ?? m.unit_cost_minor ?? 0) : null,
            reason: m.reason,
            notes: m.notes,
            userId: m.userId ?? m.user_id,
            userName: m.userName ?? m.user_name,
            createdAt: m.createdAt ?? m.created_at,
          };
        }),
        replenishmentNeeded: replenishmentRows.map((r: any) => ({
          itemId: r.itemId ?? r.item_id,
          name: r.name,
          sku: r.sku,
          barcode: r.barcode,
          category: r.category,
          unit: r.unit ?? 'pcs',
          currentStockMilli: Number(r.currentStockMilli ?? r.current_stock_milli),
          minStockMilli: Number(r.minStockMilli ?? r.min_stock_milli),
          reorderMilli: Number(r.reorderMilli ?? r.reorder_milli),
          suggestedOrderQtyMilli: Number(r.suggestedOrderQtyMilli ?? r.suggested_order_qty_milli),
          preferredSupplierId: r.supplierId ?? r.supplier_id ?? null,
          preferredSupplierName: r.supplierName ?? r.supplier_name ?? null,
          preferredSupplierPhone: r.supplierPhone ?? r.supplier_phone ?? null,
        })),
      },
      lowStockCount: Number((counts as any)?.lowStock ?? (counts as any)?.low_stock ?? 0),
      outOfStockCount: Number((counts as any)?.outOfStock ?? (counts as any)?.out_of_stock ?? 0),
      totalActiveProducts: Number((counts as any)?.totalActive ?? (counts as any)?.total_active ?? 0),
      replenishmentSuggestions: replenishmentRows.map((r: any) => ({
        itemId: r.itemId ?? r.item_id,
        name: r.name,
        currentStockMilli: Number(r.currentStockMilli ?? r.current_stock_milli),
        suggestedOrderQtyMilli: Number(r.suggestedOrderQtyMilli ?? r.suggested_order_qty_milli),
      })),
    };
  });

  // 2. Filterable Inventory Item List
  r.get('/api/inventory/items', requirePerm('stock.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const isAuthorizedForCost = ['owner', 'manager', 'accountant'].includes(ctx.user!.role);
    const q = (ctx.query.q ?? '').trim().toLowerCase();
    const category = (ctx.query.category ?? '').trim();
    const status = (ctx.query.status ?? ctx.query.stockStatus ?? 'all').trim().toLowerCase();
    const sort = (ctx.query.sort ?? 'name_asc').trim().toLowerCase();
    const limit = Math.min(Math.max(V.int(ctx.query.limit ?? 50, 'Limit', { min: 1, max: 200 }), 1), 200);
    const offset = Math.max(V.int(ctx.query.offset ?? 0, 'Offset', { min: 0 }), 0);

    let whereSql = `WHERE i.tenant_id = ? AND i.active = true AND i.track_stock = true`;
    const params: unknown[] = [tenantId];

    if (category && category !== 'ALL') {
      whereSql += ` AND i.category = ?`;
      params.push(category);
    }

    if (q) {
      whereSql += ` AND (lower(i.name) LIKE ? OR lower(COALESCE(i.sku, '')) LIKE ? OR lower(COALESCE(i.barcode, '')) LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    let statusCondition = '';
    if (status === 'in_stock') {
      statusCondition = `WHERE stock_milli > 0`;
    } else if (status === 'low_stock') {
      statusCondition = `WHERE stock_milli > 0 AND (reorder_milli > 0 OR min_stock_milli > 0) AND stock_milli <= GREATEST(reorder_milli, min_stock_milli)`;
    } else if (status === 'out_of_stock') {
      statusCondition = `WHERE stock_milli <= 0`;
    } else if (status === 'zero_stock') {
      statusCondition = `WHERE stock_milli = 0`;
    } else if (status === 'negative_stock') {
      statusCondition = `WHERE stock_milli < 0`;
    } else if (status === 'unconfigured') {
      statusCondition = `WHERE reorder_milli = 0 AND min_stock_milli = 0`;
    }

    let orderSql = 'ORDER BY name ASC';
    if (sort === 'name_desc') orderSql = 'ORDER BY name DESC';
    else if (sort === 'stock_asc') orderSql = 'ORDER BY stock_milli ASC, name ASC';
    else if (sort === 'stock_desc') orderSql = 'ORDER BY stock_milli DESC, name ASC';
    else if (sort === 'value_asc') orderSql = 'ORDER BY stock_value_minor ASC, name ASC';
    else if (sort === 'value_desc') orderSql = 'ORDER BY stock_value_minor DESC, name ASC';

    const baseCte = `
      WITH item_stats AS (
        SELECT 
          i.id,
          i.tenant_id,
          i.name,
          i.sku,
          i.barcode,
          i.hsn,
          i.unit,
          i.category,
          i.price_minor,
          i.cost_minor,
          i.reorder_milli,
          COALESCE(i.min_stock_milli, 0) AS min_stock_milli,
          i.preferred_supplier_id,
          p.name AS preferred_supplier_name,
          p.phone AS preferred_supplier_phone,
          COALESCE((SELECT SUM(sm.qty_milli) FROM stock_moves sm WHERE sm.item_id = i.id AND sm.tenant_id = i.tenant_id), 0)::bigint AS stock_milli,
          COALESCE(CASE WHEN (SELECT SUM(sm.qty_milli) FROM stock_moves sm WHERE sm.item_id = i.id AND sm.tenant_id = i.tenant_id) > 0 
                   THEN ((SELECT SUM(sm.qty_milli) FROM stock_moves sm WHERE sm.item_id = i.id AND sm.tenant_id = i.tenant_id) * i.cost_minor / 1000) 
                   ELSE 0 END, 0)::bigint AS stock_value_minor,
          i.created_at,
          i.updated_at
        FROM items i
        LEFT JOIN parties p ON p.id = i.preferred_supplier_id AND p.tenant_id = i.tenant_id
        ${whereSql}
      )
    `;

    // Total count for pagination
    const totalRow = await ctx.db.one<{ total: number }>(
      `${baseCte} SELECT COUNT(*)::int AS total FROM item_stats ${statusCondition}`,
      params,
    );
    const total = Number(totalRow?.total ?? 0);

    // Page items
    const rows = await ctx.db.query(
      `${baseCte} SELECT * FROM item_stats ${statusCondition} ${orderSql} LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return {
      total,
      limit,
      offset,
      items: rows.map((r: any) => {
        const stockMilli = Number(r.stockMilli ?? r.stock_milli);
        const reorderMilli = Number(r.reorderMilli ?? r.reorder_milli);
        const minStockMilli = Number(r.minStockMilli ?? r.min_stock_milli);
        const threshold = Math.max(reorderMilli, minStockMilli);

        let stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock' | 'negative_stock' = 'in_stock';
        if (stockMilli < 0) stockStatus = 'negative_stock';
        else if (stockMilli === 0) stockStatus = 'out_of_stock';
        else if (threshold > 0 && stockMilli <= threshold) stockStatus = 'low_stock';

        return {
          id: r.id,
          name: r.name,
          sku: r.sku ?? null,
          barcode: r.barcode ?? null,
          hsn: r.hsn ?? null,
          unit: r.unit,
          category: r.category ?? null,
          priceMinor: Number(r.priceMinor ?? r.price_minor ?? 0),
          costMinor: isAuthorizedForCost ? Number(r.costMinor ?? r.cost_minor ?? 0) : null,
          currentStockMilli: stockMilli,
          reorderMilli,
          minStockMilli,
          hasThreshold: threshold > 0,
          stockStatus,
          stockValueMinor: isAuthorizedForCost ? Number(r.stockValueMinor ?? r.stock_value_minor ?? 0) : null,
          preferredSupplierId: r.preferredSupplierId ?? r.preferred_supplier_id ?? null,
          preferredSupplierName: r.preferredSupplierName ?? r.preferred_supplier_name ?? null,
          preferredSupplierPhone: r.preferredSupplierPhone ?? r.preferred_supplier_phone ?? null,
          createdAt: r.createdAt ?? r.created_at,
          updatedAt: r.updatedAt ?? r.updated_at,
        };
      }),
    };
  });

  // 3. Stock Ledger with running balances
  r.get('/api/inventory/ledger', requirePerm('stock.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const isAuthorizedForCost = ['owner', 'manager', 'accountant'].includes(ctx.user!.role);
    const itemId = (ctx.query.itemId ?? '').trim();
    const kind = (ctx.query.kind ?? '').trim();
    const from = (ctx.query.from ?? '').trim();
    const to = (ctx.query.to ?? '').trim();
    const q = (ctx.query.q ?? '').trim().toLowerCase();
    const limit = Math.min(Math.max(V.int(ctx.query.limit ?? 50, 'Limit', { min: 1, max: 200 }), 1), 200);
    const offset = Math.max(V.int(ctx.query.offset ?? 0, 'Offset', { min: 0 }), 0);

    let filterConditions = '';
    const filterParams: unknown[] = [];

    if (itemId) {
      filterConditions += ' AND sm.item_id = ?';
      filterParams.push(itemId);
    }
    if (kind && kind !== 'ALL') {
      filterConditions += ' AND sm.kind = ?';
      filterParams.push(kind);
    }
    if (from) {
      filterConditions += ' AND sm.created_at >= ?::timestamptz';
      filterParams.push(from + 'T00:00:00Z');
    }
    if (to) {
      filterConditions += ' AND sm.created_at <= ?::timestamptz';
      filterParams.push(to + 'T23:59:59.999Z');
    }
    if (q) {
      filterConditions += ` AND (
        lower(i.name) LIKE ? OR
        lower(COALESCE(i.sku, '')) LIKE ? OR
        lower(COALESCE(i.barcode, '')) LIKE ? OR
        lower(COALESCE(inv.number, '')) LIKE ? OR
        lower(COALESCE(pur.purchase_number, '')) LIKE ? OR
        lower(COALESCE(pur.supplier_invoice_number, '')) LIKE ? OR
        lower(COALESCE(cn.number, '')) LIKE ? OR
        lower(COALESCE(adj.adjustment_number, '')) LIKE ? OR
        lower(COALESCE(sc.count_number, '')) LIKE ?
      )`;
      const wild = `%${q}%`;
      filterParams.push(wild, wild, wild, wild, wild, wild, wild, wild, wild);
    }

    // CTE computes the partition-based running balance over chronological history
    const baseCte = `
      WITH full_moves AS (
        SELECT 
          sm.id,
          sm.seq,
          sm.tenant_id,
          sm.item_id,
          sm.location,
          sm.qty_milli,
          sm.kind,
          sm.ref_type,
          sm.ref_id,
          sm.ref_line_id,
          sm.batch_no,
          sm.expiry,
          sm.unit_cost_minor,
          sm.reason,
          sm.notes,
          sm.user_id,
          sm.created_at,
          i.name AS item_name,
          i.sku AS item_sku,
          i.barcode AS item_barcode,
          i.unit AS item_unit,
          i.category AS item_category,
          u.name AS user_name,
          COALESCE(inv.number, pur.purchase_number, pur.supplier_invoice_number, cn.number, adj.adjustment_number, sc.count_number, sm.ref_id) AS ref_number,
          SUM(sm.qty_milli) OVER (
            PARTITION BY sm.item_id 
            ORDER BY sm.created_at ASC, sm.seq ASC
          )::bigint AS resulting_balance_milli
        FROM stock_moves sm
        JOIN items i ON i.id = sm.item_id AND i.tenant_id = sm.tenant_id
        LEFT JOIN users u ON u.id = sm.user_id
        LEFT JOIN invoices inv ON inv.id = sm.ref_id AND sm.ref_type = 'invoice'
        LEFT JOIN purchases pur ON pur.id = sm.ref_id AND sm.ref_type = 'purchase'
        LEFT JOIN invoices cn ON cn.id = sm.ref_id AND sm.ref_type = 'credit_note'
        LEFT JOIN stock_adjustments adj ON adj.id = sm.ref_id AND sm.ref_type = 'adjustment'
        LEFT JOIN stock_counts sc ON sc.id = sm.ref_id AND sm.ref_type = 'stock_count'
        WHERE sm.tenant_id = ?
        ${filterConditions}
      )
    `;

    const totalRow = await ctx.db.one<{ total: number }>(
      `${baseCte} SELECT COUNT(*)::int AS total FROM full_moves`,
      [tenantId, ...filterParams],
    );
    const total = Number(totalRow?.total ?? 0);

    const rows = await ctx.db.query(
      `${baseCte} SELECT * FROM full_moves ORDER BY created_at DESC, seq DESC LIMIT ? OFFSET ?`,
      [tenantId, ...filterParams, limit, offset],
    );

    const movesList = rows.map((m: any) => {
      const qty = Number(m.qtyMilli ?? m.qty_milli);
      const resulting = Number(m.resultingBalanceMilli ?? m.resulting_balance_milli);
      const previous = resulting - qty;
      return {
        id: m.id,
        seq: Number(m.seq),
        itemId: m.itemId ?? m.item_id,
        itemName: m.itemName ?? m.item_name,
        sku: m.itemSku ?? m.item_sku ?? null,
        barcode: m.itemBarcode ?? m.item_barcode ?? null,
        unit: m.itemUnit ?? m.item_unit ?? 'pcs',
        category: m.itemCategory ?? m.item_category ?? null,
        location: m.location,
        qtyMilli: qty,
        qtyInMilli: qty > 0 ? qty : 0,
        qtyOutMilli: qty < 0 ? Math.abs(qty) : 0,
        previousBalanceMilli: previous,
        resultingBalanceMilli: resulting,
        kind: m.kind,
        refType: m.refType ?? m.ref_type,
        refId: m.refId ?? m.ref_id,
        refNumber: m.refNumber ?? m.ref_number,
        batchNo: m.batchNo ?? m.batch_no,
        expiry: m.expiry,
        unitCostMinor: isAuthorizedForCost ? Number(m.unitCostMinor ?? m.unit_cost_minor ?? 0) : null,
        reason: m.reason,
        notes: m.notes,
        userId: m.userId ?? m.user_id,
        userName: m.userName ?? m.user_name,
        createdAt: m.createdAt ?? m.created_at,
      };
    });

    return {
      total,
      limit,
      offset,
      moves: movesList,
      movements: movesList,
    };
  });

  // 4. Record Permission-Controlled Stock Adjustment
  r.post('/api/inventory/adjustments', requirePerm('stock.adjust'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;

    const itemId = V.str(b.itemId, 'Product', { required: true, max: 60 });
    const adjustmentType = V.oneOf(b.adjustmentType, 'Adjustment type', ['quantity', 'physical_count'] as const);
    const reasonRaw = V.str(b.reason, 'Adjustment reason', { required: true, max: 60 });
    const reason = V.oneOf(
      reasonRaw,
      'Reason',
      ['damaged', 'expired', 'missing', 'found', 'correction', 'physical_count_diff', 'other'] as const,
    );
    const notes = V.optStr(b.notes, 'Notes', 500);

    return ctx.db.tx(async (q) => {
      // 1. Lock item row for atomic concurrency safety
      const item = await q.one<any>(
        `SELECT id, name, sku, barcode, cost_minor, track_stock 
         FROM items 
         WHERE id = ? AND tenant_id = ? FOR UPDATE`,
        [itemId, tenantId],
      );
      if (!item) throw notFound('Item');
      const trackStock = item.trackStock ?? item.track_stock ?? true;
      if (!trackStock) throw bad(`Stock tracking is disabled for item "${item.name}".`);

      // 2. Compute current stock inside the transaction lock
      const currentStockRow = await q.one<any>(
        `SELECT COALESCE(SUM(qty_milli), 0)::bigint AS current_stock_milli 
         FROM stock_moves 
         WHERE item_id = ? AND tenant_id = ?`,
        [itemId, tenantId],
      );
      const currentStockMilli = Number(currentStockRow?.currentStockMilli ?? currentStockRow?.current_stock_milli ?? 0);

      // 3. Calculate delta & resulting balance
      let deltaMilli = 0;
      let newStockMilli = 0;

      if (adjustmentType === 'physical_count') {
        newStockMilli = V.int(b.newQtyMilli, 'Counted quantity (milli-units)', { min: 0, required: true });
        deltaMilli = newStockMilli - currentStockMilli;
      } else {
        // Delta mode: positive (e.g. found/add) or negative (e.g. damaged/missing)
        deltaMilli = V.int(b.changeQtyMilli, 'Adjustment quantity (milli-units)', { required: true });
        newStockMilli = currentStockMilli + deltaMilli;
      }

      if (deltaMilli === 0) {
        throw bad('Adjustment quantity is zero. The counted quantity already matches system stock.');
      }

      // 4. Enforce negative stock policy
      const rules = await getTenantRules(q, tenantId);
      if (!rules.allowNegativeStock && newStockMilli < 0) {
        throw bad(
          `Adjustment would result in negative stock (${(newStockMilli / 1000).toFixed(1)} units) for "${item.name}". Store policy does not permit negative stock.`,
          'NEGATIVE_STOCK_FORBIDDEN',
        );
      }

      // 5. Generate sequential adjustment number (ADJ-1001)
      const seriesRow = await q.one<any>(
        `INSERT INTO number_series (tenant_id, series, next_no)
         VALUES (?, 'ADJ', 2)
         ON CONFLICT (tenant_id, series) DO UPDATE SET next_no = number_series.next_no + 1
         RETURNING (next_no - 1) AS assigned_no`,
        [tenantId],
      );
      let seqNo = Number(seriesRow?.assignedNo ?? seriesRow?.assigned_no ?? 1);
      let adjustmentNumber = `ADJ-${1000 + seqNo}`;

      const existingAdj = await q.one('SELECT id FROM stock_adjustments WHERE tenant_id = ? AND adjustment_number = ?', [tenantId, adjustmentNumber]);
      if (existingAdj) {
        const maxRow = await q.one<any>(
          `SELECT adjustment_number FROM stock_adjustments WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1`,
          [tenantId],
        );
        const match = (maxRow?.adjustmentNumber ?? maxRow?.adjustment_number ?? '').match(/ADJ-(\d+)/);
        const nextNum = match ? parseInt(match[1], 10) + 1 : 1000 + seqNo + 1;
        adjustmentNumber = `ADJ-${nextNum}`;
        await q.exec(
          `INSERT INTO number_series (tenant_id, series, next_no) VALUES (?, 'ADJ', ?) ON CONFLICT (tenant_id, series) DO UPDATE SET next_no = GREATEST(number_series.next_no, ?)`,
          [tenantId, nextNum - 1000 + 1, nextNum - 1000 + 1],
        );
      }

      const adjId = newId('adj');
      const moveId = newId('sm');
      const now = new Date().toISOString();
      const itemCostMinor = Number(item.costMinor ?? item.cost_minor ?? 0);

      // 6. Record audit header in stock_adjustments
      await q.exec(
        `INSERT INTO stock_adjustments (
          id, tenant_id, adjustment_number, item_id, location, adjustment_type,
          reason, old_qty_milli, new_qty_milli, change_qty_milli, unit_cost_minor,
          notes, created_by, created_at
        ) VALUES (?, ?, ?, ?, 'MAIN', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          adjId,
          tenantId,
          adjustmentNumber,
          itemId,
          adjustmentType,
          reason,
          currentStockMilli,
          newStockMilli,
          deltaMilli,
          itemCostMinor,
          notes,
          ctx.user!.id,
          now,
        ],
      );

      // 7. Record immutable stock move
      await q.exec(
        `INSERT INTO stock_moves (
          id, tenant_id, item_id, location, qty_milli, kind,
          ref_type, ref_id, unit_cost_minor, reason, notes, user_id, created_at
        ) VALUES (?, ?, ?, 'MAIN', ?, 'adjust', 'adjustment', ?, ?, ?, ?, ?, ?)`,
        [
          moveId,
          tenantId,
          itemId,
          deltaMilli,
          adjId,
          itemCostMinor,
          reason,
          notes || `Stock Adjustment ${adjustmentNumber}`,
          ctx.user!.id,
          now,
        ],
      );

      // 8. Audit log entry
      await audit(q, ctx, {
        action: 'inventory.adjust',
        entity: 'stock_adjustment',
        entityId: adjId,
        detail: {
          adjustmentNumber,
          itemId,
          itemName: item.name,
          reason,
          oldStockMilli: currentStockMilli,
          deltaMilli,
          newStockMilli,
        },
      });

      return {
        ok: true,
        adjustment: {
          id: adjId,
          adjustmentNumber,
          itemId,
          itemName: item.name,
          reason,
          oldQtyMilli: currentStockMilli,
          newQtyMilli: newStockMilli,
          changeQtyMilli: deltaMilli,
          createdAt: now,
        },
        resultingStockMilli: newStockMilli,
      };
    });
  });

  // 5. Physical Stock Count Sessions
  // List count sessions
  r.get('/api/inventory/counts', requirePerm('stock.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const rows = await ctx.db.query(
      `SELECT 
        sc.*,
        u.name AS created_by_name,
        fu.name AS finalized_by_name,
        COUNT(scl.id)::int AS total_items_count,
        COUNT(CASE WHEN scl.counted_qty_milli IS NOT NULL THEN 1 END)::int AS counted_items_count,
        COUNT(CASE WHEN scl.diff_qty_milli IS NOT NULL AND scl.diff_qty_milli <> 0 THEN 1 END)::int AS discrepancy_count,
        COALESCE(SUM(scl.diff_qty_milli), 0)::bigint AS net_diff_milli
       FROM stock_counts sc
       LEFT JOIN users u ON u.id = sc.created_by
       LEFT JOIN users fu ON fu.id = sc.finalized_by
       LEFT JOIN stock_count_lines scl ON scl.count_id = sc.id
       WHERE sc.tenant_id = ?
       GROUP BY sc.id, u.name, fu.name
       ORDER BY sc.created_at DESC`,
      [tenantId],
    );

    return {
      counts: rows.map((r: any) => ({
        id: r.id,
        countNumber: r.countNumber ?? r.count_number,
        name: r.name,
        status: r.status,
        category: r.category ?? null,
        location: r.location,
        notes: r.notes ?? null,
        totalItemsCount: Number(r.totalItemsCount ?? r.total_items_count ?? 0),
        countedItemsCount: Number(r.countedItemsCount ?? r.counted_items_count ?? 0),
        discrepancyCount: Number(r.discrepancyCount ?? r.discrepancy_count ?? 0),
        netDiffMilli: Number(r.netDiffMilli ?? r.net_diff_milli ?? 0),
        createdBy: r.createdBy ?? r.created_by,
        createdByName: r.createdByName ?? r.created_by_name,
        finalizedBy: r.finalizedBy ?? r.finalized_by,
        finalizedByName: r.finalizedByName ?? r.finalized_by_name,
        finalizedAt: r.finalizedAt ?? r.finalized_at,
        createdAt: r.createdAt ?? r.created_at,
        updatedAt: r.updatedAt ?? r.updated_at,
      })),
    };
  });

  // Start new stock count session
  r.post('/api/inventory/counts', requirePerm('stock.adjust'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;

    const name = V.str(b.name, 'Session name', { required: true, max: 120 });
    const category = V.optStr(b.category, 'Category filter', 60);
    const notes = V.optStr(b.notes, 'Notes', 500);

    return ctx.db.tx(async (q) => {
      // 1. Generate count number STC-1001
      const seriesRow = await q.one<any>(
        `INSERT INTO number_series (tenant_id, series, next_no)
         VALUES (?, 'STC', 2)
         ON CONFLICT (tenant_id, series) DO UPDATE SET next_no = number_series.next_no + 1
         RETURNING (next_no - 1) AS assigned_no`,
        [tenantId],
      );
      let seqNo = Number(seriesRow?.assignedNo ?? seriesRow?.assigned_no ?? 1);
      let countNumber = `STC-${1000 + seqNo}`;

      const existing = await q.one('SELECT id FROM stock_counts WHERE tenant_id = ? AND count_number = ?', [tenantId, countNumber]);
      if (existing) {
        const maxRow = await q.one<any>(
          `SELECT count_number FROM stock_counts WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1`,
          [tenantId],
        );
        const match = (maxRow?.countNumber ?? maxRow?.count_number ?? '').match(/STC-(\d+)/);
        const nextNum = match ? parseInt(match[1], 10) + 1 : 1000 + seqNo + 1;
        countNumber = `STC-${nextNum}`;
        await q.exec(
          `INSERT INTO number_series (tenant_id, series, next_no) VALUES (?, 'STC', ?) ON CONFLICT (tenant_id, series) DO UPDATE SET next_no = GREATEST(number_series.next_no, ?)`,
          [tenantId, nextNum - 1000 + 1, nextNum - 1000 + 1],
        );
      }
      const countId = newId('stc');

      // 2. Insert count header
      await q.exec(
        `INSERT INTO stock_counts (
          id, tenant_id, count_number, name, status, category, location, notes, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'in_progress', ?, 'MAIN', ?, ?, now(), now())`,
        [countId, tenantId, countNumber, name, category || null, notes, ctx.user!.id],
      );

      // 3. Snapshot items into stock_count_lines
      let itemsSql = `
        SELECT 
          i.id,
          i.name,
          i.sku,
          i.barcode,
          i.category,
          i.unit,
          i.cost_minor,
          COALESCE((SELECT SUM(sm.qty_milli) FROM stock_moves sm WHERE sm.item_id = i.id AND sm.tenant_id = i.tenant_id), 0)::bigint AS current_stock_milli
        FROM items i
        WHERE i.tenant_id = ? AND i.active = true AND i.track_stock = true
      `;
      const itemParams: unknown[] = [tenantId];
      if (category && category !== 'ALL') {
        itemsSql += ` AND i.category = ?`;
        itemParams.push(category);
      }
      itemsSql += ` ORDER BY i.category ASC, i.name ASC`;

      const targetItems = await q.query(itemsSql, itemParams);
      if (targetItems.length === 0) {
        throw bad('No active stock-tracked items found for the selected category.');
      }

      for (const item of targetItems) {
        const lineId = newId('scl');
        const systemQtyMilli = Number(item.currentStockMilli ?? item.current_stock_milli ?? 0);
        await q.exec(
          `INSERT INTO stock_count_lines (
            id, tenant_id, count_id, item_id, system_qty_milli, unit_cost_minor, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, now(), now())`,
          [lineId, tenantId, countId, item.id, systemQtyMilli, Number(item.costMinor ?? item.cost_minor ?? 0)],
        );
      }

      await audit(q, ctx, {
        action: 'inventory.count_start',
        entity: 'stock_count',
        entityId: countId,
        detail: { countNumber, name, category, itemCount: targetItems.length },
      });

      return {
        ok: true,
        count: {
          id: countId,
          countNumber,
          name,
          status: 'in_progress',
          category: category || null,
          totalItemsCount: targetItems.length,
        },
      };
    });
  });

  // Get count session details and item lines
  r.get('/api/inventory/counts/:id', requirePerm('stock.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const isAuthorizedForCost = ['owner', 'manager', 'accountant'].includes(ctx.user!.role);

    const count = await ctx.db.one(
      `SELECT 
        sc.*,
        u.name AS created_by_name,
        fu.name AS finalized_by_name
       FROM stock_counts sc
       LEFT JOIN users u ON u.id = sc.created_by
       LEFT JOIN users fu ON fu.id = sc.finalized_by
       WHERE sc.id = ? AND sc.tenant_id = ?`,
      [ctx.params.id, tenantId],
    );
    if (!count) throw notFound('Stock Count Session');

    const lines = await ctx.db.query(
      `SELECT 
        scl.*,
        i.name AS item_name,
        i.sku,
        i.barcode,
        i.category,
        i.unit
       FROM stock_count_lines scl
       JOIN items i ON i.id = scl.item_id AND i.tenant_id = scl.tenant_id
       WHERE scl.count_id = ? AND scl.tenant_id = ?
       ORDER BY i.category ASC, i.name ASC`,
      [count.id, tenantId],
    );

    return {
      count: {
        id: count.id,
        countNumber: count.countNumber ?? count.count_number,
        name: count.name,
        status: count.status,
        category: count.category ?? null,
        location: count.location,
        notes: count.notes ?? null,
        createdByName: count.createdByName ?? count.created_by_name,
        finalizedByName: count.finalizedByName ?? count.finalized_by_name,
        finalizedAt: count.finalizedAt ?? count.finalized_at,
        createdAt: count.createdAt ?? count.created_at,
        updatedAt: count.updatedAt ?? count.updated_at,
      },
      lines: lines.map((l: any) => ({
        id: l.id,
        countId: l.countId ?? l.count_id,
        itemId: l.itemId ?? l.item_id,
        itemName: l.itemName ?? l.item_name,
        sku: l.sku ?? null,
        barcode: l.barcode ?? null,
        category: l.category ?? null,
        unit: l.unit ?? 'pcs',
        systemQtyMilli: Number(l.systemQtyMilli ?? l.system_qty_milli ?? 0),
        countedQtyMilli: (l.countedQtyMilli ?? l.counted_qty_milli) !== null && (l.countedQtyMilli ?? l.counted_qty_milli) !== undefined ? Number(l.countedQtyMilli ?? l.counted_qty_milli) : null,
        diffQtyMilli: (l.diffQtyMilli ?? l.diff_qty_milli) !== null && (l.diffQtyMilli ?? l.diff_qty_milli) !== undefined ? Number(l.diffQtyMilli ?? l.diff_qty_milli) : null,
        unitCostMinor: isAuthorizedForCost ? Number(l.unitCostMinor ?? l.unit_cost_minor ?? 0) : null,
        notes: l.notes ?? null,
      })),
    };
  });

  // Save physical count draft lines
  r.patch('/api/inventory/counts/:id/lines', requirePerm('stock.adjust'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;
    const linesInput = V.arr(b.lines, 'Counted lines', { min: 1 });

    return ctx.db.tx(async (q) => {
      const count = await q.one('SELECT id, status FROM stock_counts WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
      if (!count) throw notFound('Stock Count Session');
      if (count.status !== 'in_progress') {
        throw bad(`Cannot edit lines in a ${count.status} session.`);
      }

      for (const l of linesInput) {
        const lineId = (l.lineId ?? l.id ?? '').trim();
        const itemId = (l.itemId ?? '').trim();
        const countedQtyMilli = l.countedQtyMilli !== null && l.countedQtyMilli !== undefined ? V.int(l.countedQtyMilli, 'Counted quantity', { min: 0 }) : null;
        const lineNotes = V.optStr(l.notes, 'Line notes', 200);

        let currentLine = null;
        if (lineId) {
          currentLine = await q.one<any>(
            'SELECT id, system_qty_milli, counted_qty_milli FROM stock_count_lines WHERE id = ? AND count_id = ? AND tenant_id = ?',
            [lineId, count.id, tenantId],
          );
        } else if (itemId) {
          currentLine = await q.one<any>(
            'SELECT id, system_qty_milli, counted_qty_milli FROM stock_count_lines WHERE item_id = ? AND count_id = ? AND tenant_id = ?',
            [itemId, count.id, tenantId],
          );
        }
        if (!currentLine) continue;

        const effectiveLineId = currentLine.id;
        const systemQtyMilli = Number(currentLine.systemQtyMilli ?? currentLine.system_qty_milli ?? 0);
        const diffQtyMilli = countedQtyMilli !== null ? countedQtyMilli - systemQtyMilli : null;
        const prevCountedRaw = currentLine.countedQtyMilli ?? currentLine.counted_qty_milli;
        const prevCounted = prevCountedRaw !== null && prevCountedRaw !== undefined ? Number(prevCountedRaw) : null;
        const isCountChanged = countedQtyMilli !== prevCounted;

        if (isCountChanged) {
          await q.exec(
            `UPDATE stock_count_lines SET
              counted_qty_milli = ?,
              diff_qty_milli = ?,
              notes = ?,
              updated_at = now()
             WHERE id = ? AND count_id = ? AND tenant_id = ?`,
            [countedQtyMilli, diffQtyMilli, lineNotes, effectiveLineId, count.id, tenantId],
          );
        } else {
          await q.exec(
            `UPDATE stock_count_lines SET
              notes = ?
             WHERE id = ? AND count_id = ? AND tenant_id = ?`,
            [lineNotes, effectiveLineId, count.id, tenantId],
          );
        }
      }

      await q.exec('UPDATE stock_counts SET updated_at = now() WHERE id = ? AND tenant_id = ?', [count.id, tenantId]);

      return { ok: true };
    });
  });

  // Finalize stock count: generate adjustments and update stock moves safely reconciling interim movements
  r.post('/api/inventory/counts/:id/finalize', requirePerm('stock.adjust'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;

    return ctx.db.tx(async (q) => {
      // 1. Row-lock stock_counts header to serialize concurrent finalization and prevent duplicate adjustments
      const count = await q.one<any>(
        'SELECT id, count_number, status, name, created_at, location FROM stock_counts WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [ctx.params.id, tenantId],
      );
      if (!count) throw notFound('Stock Count Session');
      const countStatus = count.status;
      const countNumber = count.countNumber ?? count.count_number;
      if (countStatus !== 'in_progress') {
        throw bad(`Session ${countNumber} is already ${countStatus}. Cannot finalize.`);
      }

      const countLocation = count.location || 'MAIN';
      const countCreatedAt = count.createdAt ?? count.created_at;

      const lines = await q.query(
        `SELECT scl.*, i.name AS item_name, i.unit AS item_unit, i.cost_minor
         FROM stock_count_lines scl
         JOIN items i ON i.id = scl.item_id AND i.tenant_id = scl.tenant_id
         WHERE scl.count_id = ? AND scl.tenant_id = ?`,
        [count.id, tenantId],
      );

      const rules = await getTenantRules(q, tenantId);
      const now = new Date().toISOString();
      let appliedAdjustmentsCount = 0;

      for (const line of lines as any[]) {
        const countedRaw = line.countedQtyMilli ?? line.counted_qty_milli;
        if (countedRaw === null || countedRaw === undefined) {
          continue; // Item was uncounted / skipped in this count session
        }

        const countedMilli = Number(countedRaw);
        const baselineSystemMilli = Number(line.systemQtyMilli ?? line.system_qty_milli ?? 0);
        const lineItemId = line.itemId ?? line.item_id;
        const lineItemName = line.itemName ?? line.item_name;
        const lineUnit = line.itemUnit ?? line.item_unit ?? 'pcs';
        const lineCostMinor = Number(line.costMinor ?? line.cost_minor ?? 0);
        const lineCountedAt = line.updatedAt ?? line.updated_at ?? line.createdAt ?? line.created_at ?? countCreatedAt;

        // 2. Query live stock right now from authoritative stock_moves
        const currentLiveRow = await q.one<any>(
          `SELECT COALESCE(SUM(qty_milli), 0)::bigint AS current_stock_milli
           FROM stock_moves
           WHERE tenant_id = ? AND item_id = ? AND location = ?`,
          [tenantId, lineItemId, countLocation],
        );
        const currentLiveStockMilli = Number(currentLiveRow?.currentStockMilli ?? currentLiveRow?.current_stock_milli ?? 0);

        // 3. Query valid interim movements that occurred prior to when physical count was recorded
        const priorMovesRow = await q.one<any>(
          `SELECT COALESCE(SUM(qty_milli), 0)::bigint AS prior_delta_milli
           FROM stock_moves
           WHERE tenant_id = ? 
             AND item_id = ? 
             AND location = ? 
             AND created_at >= ? 
             AND created_at < ?
             AND (ref_type IS NULL OR ref_type != 'stock_count')`,
          [tenantId, lineItemId, countLocation, countCreatedAt, lineCountedAt],
        );
        const priorDeltaMilli = Number(priorMovesRow?.priorDeltaMilli ?? priorMovesRow?.prior_delta_milli ?? 0);

        // Expected stock at the moment physical count was taken
        const expectedStockAtCountMilli = baselineSystemMilli + priorDeltaMilli;

        // True physical floor variance identified by the count
        const reconciledDiffMilli = countedMilli - expectedStockAtCountMilli;

        // Resulting live stock position after applying the floor variance
        const resultingStockMilli = currentLiveStockMilli + reconciledDiffMilli;

        // 4. Verify negative stock policy
        if (!rules.allowNegativeStock && resultingStockMilli < 0) {
          throw bad(
            `Physical count for "${lineItemName}" would result in negative stock (${(resultingStockMilli / 1000).toFixed(1)} ${lineUnit}), which is not permitted under current store configuration. Please review interim movements or recount.`,
          );
        }

        // Update line diff_qty_milli with the reconciled variance
        await q.exec(
          `UPDATE stock_count_lines SET
            diff_qty_milli = ?,
            updated_at = now()
           WHERE id = ? AND count_id = ? AND tenant_id = ?`,
          [reconciledDiffMilli, line.id, count.id, tenantId],
        );

        if (reconciledDiffMilli === 0) {
          continue; // Reconciled count matches expected stock perfectly, no ledger adjustment needed
        }

        // 5. Generate adjustment number
        const seriesRow = await q.one<any>(
          `INSERT INTO number_series (tenant_id, series, next_no)
           VALUES (?, 'ADJ', 2)
           ON CONFLICT (tenant_id, series) DO UPDATE SET next_no = number_series.next_no + 1
           RETURNING (next_no - 1) AS assigned_no`,
          [tenantId],
        );
        let seqNo = Number(seriesRow?.assignedNo ?? seriesRow?.assigned_no ?? 1);
        let adjustmentNumber = `ADJ-${1000 + seqNo}`;

        const existingAdj = await q.one('SELECT id FROM stock_adjustments WHERE tenant_id = ? AND adjustment_number = ?', [tenantId, adjustmentNumber]);
        if (existingAdj) {
          const maxRow = await q.one<any>(
            `SELECT adjustment_number FROM stock_adjustments WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1`,
            [tenantId],
          );
          const match = (maxRow?.adjustmentNumber ?? maxRow?.adjustment_number ?? '').match(/ADJ-(\d+)/);
          const nextNum = match ? parseInt(match[1], 10) + 1 : 1000 + seqNo + 1;
          adjustmentNumber = `ADJ-${nextNum}`;
          await q.exec(
            `INSERT INTO number_series (tenant_id, series, next_no) VALUES (?, 'ADJ', ?) ON CONFLICT (tenant_id, series) DO UPDATE SET next_no = GREATEST(number_series.next_no, ?)`,
            [tenantId, nextNum - 1000 + 1, nextNum - 1000 + 1],
          );
        }

        const adjId = newId('adj');
        const moveId = newId('sm');
        const adjReason: StockAdjustmentReason = 'physical_count_diff';

        // 6. Record stock_adjustment audit record
        await q.exec(
          `INSERT INTO stock_adjustments (
            id, tenant_id, adjustment_number, item_id, location, adjustment_type,
            reason, old_qty_milli, new_qty_milli, change_qty_milli, unit_cost_minor,
            notes, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, 'physical_count', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            adjId,
            tenantId,
            adjustmentNumber,
            lineItemId,
            countLocation,
            adjReason,
            currentLiveStockMilli,
            resultingStockMilli,
            reconciledDiffMilli,
            lineCostMinor,
            `Count ${countNumber}: ${lineItemName} (Baseline: ${(baselineSystemMilli / 1000).toFixed(1)}, Counted: ${(countedMilli / 1000).toFixed(1)}, Reconciled Diff: ${(reconciledDiffMilli / 1000).toFixed(1)})`,
            ctx.user!.id,
            now,
          ],
        );

        // 7. Record authoritative stock_move correction
        await q.exec(
          `INSERT INTO stock_moves (
            id, tenant_id, item_id, location, qty_milli, kind,
            ref_type, ref_id, ref_line_id, unit_cost_minor, reason, notes, user_id, created_at
          ) VALUES (?, ?, ?, ?, ?, 'adjust', 'stock_count', ?, ?, ?, ?, ?, ?, ?)`,
          [
            moveId,
            tenantId,
            lineItemId,
            countLocation,
            reconciledDiffMilli,
            count.id,
            line.id,
            lineCostMinor,
            'physical_count_diff',
            `Physical Count ${countNumber} Reconciled Adjustment`,
            ctx.user!.id,
            now,
          ],
        );

        appliedAdjustmentsCount++;
      }

      // 8. Mark count session as completed
      await q.exec(
        `UPDATE stock_counts SET
          status = 'completed',
          finalized_by = ?,
          finalized_at = now(),
          updated_at = now()
         WHERE id = ? AND tenant_id = ?`,
        [ctx.user!.id, count.id, tenantId],
      );

      await audit(q, ctx, {
        action: 'inventory.count_finalize',
        entity: 'stock_count',
        entityId: count.id,
        detail: {
          countNumber,
          name: count.name,
          appliedAdjustmentsCount,
        },
      });

      return {
        ok: true,
        countNumber,
        appliedAdjustmentsCount,
        adjustmentsCreated: appliedAdjustmentsCount,
      };
    });
  });

  // Cancel stock count session
  r.post('/api/inventory/counts/:id/cancel', requirePerm('stock.adjust'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    return ctx.db.tx(async (q) => {
      const count = await q.one<{ id: string; status: string; count_number: string }>(
        'SELECT id, status, count_number FROM stock_counts WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [ctx.params.id, tenantId],
      );
      if (!count) throw notFound('Stock Count Session');
      if (count.status === 'completed') {
        throw bad(`Cannot cancel a finalized count session.`);
      }

      await q.exec(
        `UPDATE stock_counts SET status = 'cancelled', updated_at = now() WHERE id = ? AND tenant_id = ?`,
        [count.id, tenantId],
      );

      await audit(q, ctx, {
        action: 'inventory.count_cancel',
        entity: 'stock_count',
        entityId: count.id,
        detail: { countNumber: count.count_number },
      });

      return { ok: true };
    });
  });

  // 6. Quick Update Reorder Settings
  r.patch('/api/inventory/items/:id/reorder', requirePerm('stock.adjust'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;

    const item = await ctx.db.one('SELECT id, name FROM items WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!item) throw notFound('Item');

    const reorderMilli = V.int(b.reorderMilli ?? b.reorderLevelMilli ?? 0, 'Reorder quantity', { min: 0 });
    const minStockMilli = V.int(b.minStockMilli ?? 0, 'Minimum stock quantity', { min: 0 });
    const preferredSupplierId = V.optStr(b.preferredSupplierId, 'Preferred supplier', 60);

    await ctx.db.tx(async (q) => {
      await q.exec(
        `UPDATE items SET
          reorder_milli = ?,
          min_stock_milli = ?,
          preferred_supplier_id = ?,
          updated_at = now()
         WHERE id = ? AND tenant_id = ?`,
        [reorderMilli, minStockMilli, preferredSupplierId || null, item.id, tenantId],
      );

      await audit(q, ctx, {
        action: 'item.reorder_update',
        entity: 'item',
        entityId: item.id,
        detail: { name: item.name, reorderMilli, minStockMilli, preferredSupplierId },
      });
    });

    const updated = await ctx.db.one(
      `SELECT i.*,
              COALESCE((SELECT SUM(sm.qty_milli) FROM stock_moves sm WHERE sm.item_id = i.id AND sm.tenant_id = i.tenant_id), 0) AS current_stock_milli
       FROM items i
       WHERE i.id = ? AND i.tenant_id = ?`,
      [item.id, tenantId],
    );

    return {
      ok: true,
      item: {
        id: updated.id,
        name: updated.name,
        reorderMilli: Number(updated.reorder_milli),
        minStockMilli: Number(updated.min_stock_milli),
        preferredSupplierId: updated.preferred_supplier_id,
        currentStockMilli: Number(updated.current_stock_milli),
      },
    };
  });

  // 7. Real-Data Inventory Insights & Risk Intelligence (Phase 3)
  r.get('/api/inventory/insights', requirePerm('stock.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const isAuthorizedForCost = ['owner', 'manager', 'accountant'].includes(ctx.user!.role);

    // 1. Stockout Risks with explainable velocity & days of runway
    const stockoutRiskRows = await ctx.db.query(
      `WITH sales_30d AS (
        SELECT 
          sm.item_id,
          COALESCE(SUM(ABS(sm.qty_milli)), 0)::bigint AS gross_sold_milli,
          COUNT(DISTINCT sm.ref_id)::int AS orders_count
        FROM stock_moves sm
        LEFT JOIN invoices inv ON inv.id = sm.ref_id AND sm.ref_type = 'invoice'
        WHERE sm.tenant_id = ? 
          AND sm.kind = 'sale' 
          AND (inv.id IS NULL OR inv.status = 'posted')
          AND sm.created_at >= (now() - interval '30 days')
        GROUP BY sm.item_id
      ),
      returns_30d AS (
        SELECT 
          sm.item_id,
          COALESCE(SUM(sm.qty_milli), 0)::bigint AS returned_milli
        FROM stock_moves sm
        LEFT JOIN invoices cn ON cn.id = sm.ref_id AND sm.ref_type = 'credit_note'
        WHERE sm.tenant_id = ? 
          AND sm.kind = 'return' 
          AND (cn.id IS NULL OR cn.status = 'posted')
          AND sm.created_at >= (now() - interval '30 days')
        GROUP BY sm.item_id
      ),
      item_stock AS (
        SELECT 
          i.id,
          i.name,
          i.sku,
          i.barcode,
          i.unit,
          i.category,
          i.cost_minor,
          i.reorder_milli,
          COALESCE(i.min_stock_milli, 0) AS min_stock_milli,
          i.preferred_supplier_id,
          p.name AS preferred_supplier_name,
          i.created_at,
          GREATEST(1, LEAST(30, EXTRACT(DAY FROM (now() - i.created_at))::int)) AS days_active,
          COALESCE((SELECT SUM(sm.qty_milli) FROM stock_moves sm WHERE sm.item_id = i.id AND sm.tenant_id = i.tenant_id), 0)::bigint AS stock_milli
        FROM items i
        LEFT JOIN parties p ON p.id = i.preferred_supplier_id AND p.tenant_id = i.tenant_id
        WHERE i.tenant_id = ? AND i.active = true AND i.track_stock = true
      )
      SELECT 
        s.*,
        GREATEST(0, COALESCE(sl.gross_sold_milli, 0) - COALESCE(rt.returned_milli, 0))::bigint AS net_sold_30d_milli,
        COALESCE(sl.gross_sold_milli, 0)::bigint AS gross_sold_30d_milli,
        COALESCE(rt.returned_milli, 0)::bigint AS returned_30d_milli,
        COALESCE(sl.orders_count, 0)::int AS orders_30d_count
      FROM item_stock s
      LEFT JOIN sales_30d sl ON sl.item_id = s.id
      LEFT JOIN returns_30d rt ON rt.item_id = s.id
      WHERE (GREATEST(0, COALESCE(sl.gross_sold_milli, 0) - COALESCE(rt.returned_milli, 0)) > 0 OR s.stock_milli <= 0)
      ORDER BY 
        CASE 
          WHEN s.stock_milli <= 0 THEN 0
          WHEN GREATEST(0, COALESCE(sl.gross_sold_milli, 0) - COALESCE(rt.returned_milli, 0)) > 0 
            THEN (s.stock_milli::numeric / (GREATEST(0, COALESCE(sl.gross_sold_milli, 0) - COALESCE(rt.returned_milli, 0))::numeric / s.days_active))
          ELSE 999 
        END ASC
      LIMIT 20`,
      [tenantId, tenantId, tenantId],
    );

    const stockoutRisks = stockoutRiskRows.map((r: any) => {
      const stockMilli = Number(r.stockMilli ?? r.stock_milli);
      const netSoldMilli = Number(r.netSold30dMilli ?? r.net_sold_30d_milli ?? 0);
      const grossSoldMilli = Number(r.grossSold30dMilli ?? r.gross_sold_30d_milli ?? 0);
      const returnedMilli = Number(r.returned30dMilli ?? r.returned_30d_milli ?? 0);
      const ordersCount = Number(r.orders30dCount ?? r.orders_30d_count);
      const daysActive = Number(r.daysActive ?? r.days_active ?? 30);
      const dailyVelocityMilli = daysActive > 0 ? (netSoldMilli / daysActive) : 0;
      const unit = r.unit || 'pcs';
      const hasSufficientHistory = daysActive >= 7 || ordersCount >= 3;

      let runwayDays = 999;
      let riskLevel: 'out_of_stock' | 'critical' | 'high' | 'moderate' = 'moderate';
      let explainableReason = '';

      if (stockMilli <= 0) {
        runwayDays = 0;
        riskLevel = 'out_of_stock';
        if (netSoldMilli > 0) {
          explainableReason = `Completely depleted (0 ${unit}) with active net demand (${(netSoldMilli / 1000).toFixed(1)} ${unit} net across ${ordersCount} orders over ${daysActive}d observation period). Immediate replenishment required.`;
        } else {
          explainableReason = `Stock is currently zero or negative. Immediate replenishment needed before customer checkout.`;
        }
      } else if (dailyVelocityMilli > 0) {
        runwayDays = Number((stockMilli / dailyVelocityMilli).toFixed(1));
        const historyNotice = !hasSufficientHistory ? ` (Preliminary: product active for ${daysActive} days)` : '';
        if (runwayDays <= 3) {
          riskLevel = 'critical';
          explainableReason = `Critical stockout within ${runwayDays} days! Selling ~${(dailyVelocityMilli / 1000).toFixed(1)} ${unit}/day${historyNotice}. Current stock (${(stockMilli / 1000).toFixed(1)} ${unit}) will not survive the week.`;
        } else if (runwayDays <= 7) {
          riskLevel = 'high';
          explainableReason = `Estimated ${runwayDays} days of buffer remaining based on net velocity of ${(dailyVelocityMilli / 1000).toFixed(1)} ${unit}/day (${(netSoldMilli / 1000).toFixed(1)} ${unit} net sold over ${daysActive} days)${historyNotice}.`;
        } else {
          riskLevel = 'moderate';
          explainableReason = `Adequate short-term cover (~${runwayDays} days), but nearing reorder threshold.${historyNotice}`;
        }
      }

      return {
        itemId: r.id,
        name: r.name,
        sku: r.sku,
        barcode: r.barcode,
        unit,
        category: r.category,
        currentStockUnits: stockMilli / 1000,
        sold30dUnits: netSoldMilli / 1000,
        grossSold30dUnits: grossSoldMilli / 1000,
        returned30dUnits: returnedMilli / 1000,
        dailyVelocityUnits: Number((dailyVelocityMilli / 1000).toFixed(2)),
        ordersCount,
        runwayDays,
        riskLevel,
        hasSufficientHistory,
        explainableReason,
        preferredSupplierName: r.preferredSupplierName ?? r.preferred_supplier_name,
      };
    }).filter((r) => r.riskLevel === 'out_of_stock' || r.riskLevel === 'critical' || r.riskLevel === 'high');

    // 2. Slow-Moving and Dead Stock Insights (tied-up working capital)
    const deadStockRows = await ctx.db.query(
      `WITH sales_60d AS (
        SELECT 
          sm.item_id,
          MAX(sm.created_at) AS last_sale_at,
          COALESCE(SUM(ABS(sm.qty_milli)), 0)::bigint AS sold_60d_milli
        FROM stock_moves sm
        WHERE sm.tenant_id = ? 
          AND sm.kind = 'sale' 
          AND sm.created_at >= (now() - interval '60 days')
        GROUP BY sm.item_id
      ),
      item_stock AS (
        SELECT 
          i.id,
          i.name,
          i.sku,
          i.barcode,
          i.unit,
          i.category,
          i.cost_minor,
          COALESCE((SELECT SUM(sm.qty_milli) FROM stock_moves sm WHERE sm.item_id = i.id AND sm.tenant_id = i.tenant_id), 0)::bigint AS stock_milli,
          i.created_at
        FROM items i
        WHERE i.tenant_id = ? AND i.active = true AND i.track_stock = true
      )
      SELECT 
        s.*,
        sl.last_sale_at,
        COALESCE(sl.sold_60d_milli, 0)::bigint AS sold_60d_milli
      FROM item_stock s
      LEFT JOIN sales_60d sl ON sl.item_id = s.id
      WHERE s.stock_milli > 0 AND COALESCE(sl.sold_60d_milli, 0) = 0
      ORDER BY (s.stock_milli * s.cost_minor) DESC
      LIMIT 15`,
      [tenantId, tenantId],
    );

    const slowMovingItems = deadStockRows.map((r: any) => {
      const stockMilli = Number(r.stockMilli ?? r.stock_milli);
      const costMinor = Number(r.costMinor ?? r.cost_minor ?? 0);
      const tiedCapitalMinor = isAuthorizedForCost ? Math.round((stockMilli * costMinor) / 1000) : null;
      return {
        itemId: r.id,
        name: r.name,
        sku: r.sku,
        unit: r.unit || 'pcs',
        category: r.category,
        currentStockUnits: stockMilli / 1000,
        costMinor: isAuthorizedForCost ? costMinor : null,
        tiedCapitalMinor,
        lastSaleAt: r.lastSaleAt ?? r.last_sale_at ?? null,
        explainableReason: `Zero sales recorded in the past 60 days. ${(stockMilli / 1000).toFixed(1)} ${r.unit || 'pcs'} idle in storage${tiedCapitalMinor ? ` (₹${(tiedCapitalMinor / 100).toFixed(2)} tied capital)` : ''}.`,
      };
    });

    // 3. Duplicate Items & Barcode Collision Warnings
    const barcodeDuplicates = await ctx.db.query(
      `SELECT 
        barcode,
        COUNT(*)::int AS count,
        json_agg(json_build_object('id', id, 'name', name, 'sku', sku)) AS items
      FROM items
      WHERE tenant_id = ? AND active = true AND barcode IS NOT NULL AND TRIM(barcode) != ''
      GROUP BY barcode
      HAVING COUNT(*) > 1
      LIMIT 10`,
      [tenantId],
    );

    const nameDuplicates = await ctx.db.query(
      `SELECT 
        lower(trim(name)) AS norm_name,
        COUNT(*)::int AS count,
        json_agg(json_build_object('id', id, 'name', name, 'sku', sku, 'barcode', barcode)) AS items
      FROM items
      WHERE tenant_id = ? AND active = true
      GROUP BY lower(trim(name))
      HAVING COUNT(*) > 1
      LIMIT 10`,
      [tenantId],
    );

    const duplicates = [
      ...barcodeDuplicates.map((b: any) => ({
        type: 'barcode_collision' as const,
        key: b.barcode,
        count: Number(b.count),
        items: typeof b.items === 'string' ? JSON.parse(b.items) : b.items,
        description: `Barcode "${b.barcode}" is assigned to ${b.count} different product records. POS scanner may select the wrong item.`,
      })),
      ...nameDuplicates.map((n: any) => ({
        type: 'name_duplicate' as const,
        key: n.norm_name,
        count: Number(n.count),
        items: typeof n.items === 'string' ? JSON.parse(n.items) : n.items,
        description: `${n.count} products share the identical name "${n.norm_name}". Consider consolidating to avoid split stock balances.`,
      })),
    ];

    // 4. Stock Variance Insights from Physical Counts & Audit History
    const countHistory = await ctx.db.query(
      `SELECT 
        sc.id,
        sc.count_number,
        sc.name,
        sc.finalized_at,
        COUNT(scl.id)::int AS total_lines,
        COUNT(CASE WHEN COALESCE(scl.diff_qty_milli, 0) != 0 THEN 1 END)::int AS discrepant_lines,
        COALESCE(SUM(scl.diff_qty_milli), 0)::bigint AS net_diff_milli,
        COALESCE(SUM(CASE WHEN scl.diff_qty_milli > 0 THEN scl.diff_qty_milli ELSE 0 END), 0)::bigint AS gain_qty_milli,
        COALESCE(SUM(CASE WHEN scl.diff_qty_milli < 0 THEN ABS(scl.diff_qty_milli) ELSE 0 END), 0)::bigint AS loss_qty_milli,
        COALESCE(SUM(scl.diff_qty_milli * scl.unit_cost_minor / 1000), 0)::bigint AS net_variance_value_minor
      FROM stock_counts sc
      JOIN stock_count_lines scl ON scl.count_id = sc.id
      WHERE sc.tenant_id = ? AND sc.status = 'completed'
      GROUP BY sc.id, sc.count_number, sc.name, sc.finalized_at
      ORDER BY sc.finalized_at DESC
      LIMIT 5`,
      [tenantId],
    );

    const adjustmentReasonBreakdown = await ctx.db.query(
      `SELECT 
        reason,
        COUNT(*)::int AS count,
        COALESCE(SUM(change_qty_milli), 0)::bigint AS net_change_milli,
        COALESCE(SUM(ABS(change_qty_milli)), 0)::bigint AS abs_change_milli
      FROM stock_adjustments
      WHERE tenant_id = ? AND created_at >= (now() - interval '90 days')
      GROUP BY reason
      ORDER BY count DESC`,
      [tenantId],
    );

    // 5. Inward Batches Near Expiry (Perishable stock received)
    const expiringBatches = await ctx.db.query(
      `SELECT 
        sm.item_id,
        i.name AS item_name,
        i.unit,
        sm.batch_no,
        sm.expiry,
        COALESCE(SUM(sm.qty_milli), 0)::bigint AS inward_qty_milli
      FROM stock_moves sm
      JOIN items i ON i.id = sm.item_id AND i.tenant_id = sm.tenant_id
      WHERE sm.tenant_id = ? 
        AND sm.batch_no IS NOT NULL 
        AND TRIM(sm.batch_no) != ''
        AND sm.expiry IS NOT NULL 
        AND TRIM(sm.expiry) != ''
      GROUP BY sm.item_id, i.name, i.unit, sm.batch_no, sm.expiry
      HAVING SUM(sm.qty_milli) > 0
      ORDER BY sm.expiry ASC
      LIMIT 15`,
      [tenantId],
    );

    const todayStr = new Date().toISOString().split('T')[0];
    const expiryDateThreshold = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

    const batchWarnings = expiringBatches.map((b: any) => {
      const exp = b.expiry || '';
      const isExpired = exp < todayStr;
      const isNearExpiry = exp >= todayStr && exp <= expiryDateThreshold;
      const qtyUnits = Number(b.inwardQtyMilli ?? b.inward_qty_milli) / 1000;
      return {
        itemId: b.itemId ?? b.item_id,
        itemName: b.itemName ?? b.item_name,
        unit: b.unit || 'pcs',
        batchNo: b.batchNo ?? b.batch_no,
        expiry: exp,
        inwardUnits: qtyUnits,
        remainingUnits: null, // Note: POS sales moves do not track per-batch depletion
        inwardBatchNotice: 'POS sales track aggregate inventory; inward volume reflects received purchase batches.',
        status: isExpired ? ('expired' as const) : isNearExpiry ? ('expiring_soon' as const) : ('healthy' as const),
        warning: isExpired
          ? `Received batch "${b.batch_no}" expired on ${exp} (${qtyUnits.toFixed(1)} ${b.unit || 'pcs'} received inward). POS checkout does not record batch-level deductions; verify physical lot on shelf.`
          : isNearExpiry
          ? `Received batch "${b.batch_no}" expires within 30 days (${exp}) (${qtyUnits.toFixed(1)} ${b.unit || 'pcs'} received inward).`
          : `Received batch "${b.batch_no}" expires on ${exp}.`,
      };
    }).filter((b) => b.status === 'expired' || b.status === 'expiring_soon');

    return {
      insights: {
        methodology: 'Rule-based historical demand analysis computed from 30-day net sales (completed sales minus customer returns, excluding voided bills) divided by product active days (up to 30 days). No heuristic or ungrounded machine learning.',
        generatedAt: new Date().toISOString(),
        costingMethod: 'Current Item Master Cost (INR)',
        stockoutRisks,
        slowMovingItems,
        duplicates,
        auditVariance: {
          recentCounts: countHistory.map((c: any) => {
            const totalLines = Number(c.totalLines ?? c.total_lines);
            const discLines = Number(c.discrepantLines ?? c.discrepant_lines);
            const accuracyPct = totalLines > 0 ? Number((((totalLines - discLines) / totalLines) * 100).toFixed(1)) : 100;
            return {
              id: c.id,
              countNumber: c.countNumber ?? c.count_number,
              name: c.name,
              finalizedAt: c.finalizedAt ?? c.finalized_at,
              totalLines,
              discrepantLines: discLines,
              accuracyPct,
              netDiffUnits: Number(c.netDiffMilli ?? c.net_diff_milli) / 1000,
              gainUnits: Number(c.gainQtyMilli ?? c.gain_qty_milli) / 1000,
              lossUnits: Number(c.lossQtyMilli ?? c.loss_qty_milli) / 1000,
              netVarianceValueMinor: isAuthorizedForCost ? Number(c.netVarianceValueMinor ?? c.net_variance_value_minor) : null,
            };
          }),
          adjustmentReasons: adjustmentReasonBreakdown.map((a: any) => ({
            reason: a.reason,
            count: Number(a.count),
            netChangeUnits: Number(a.netChangeMilli ?? a.net_change_milli) / 1000,
            absChangeUnits: Number(a.absChangeMilli ?? a.abs_change_milli) / 1000,
          })),
        },
        batchWarnings,
      },
    };
  });
}

