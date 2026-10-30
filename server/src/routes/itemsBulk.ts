import { requirePerm } from '../auth.ts';
import { bad, conflict, type Router } from '../http.ts';
import { newId } from '../security.ts';
import { audit } from '../audit.ts';
import { generateUniqueShortSku, generateUniqueInternalBarcode } from '../../../shared/bulkImport.ts';

// ── Supported GST rates (basis points) ──────────────────────────────────────
const VALID_GST_RATES_BP = new Set([0, 250, 500, 1200, 1800, 2800]);

export interface AdditionalBarcode {
  barcode: string;
  barcodeType?: 'INTERNAL' | 'MANUFACTURER' | null;
}

export interface BulkImportRow {
  name: string;
  sku?: string | null;
  barcode?: string | null;
  barcodeType?: 'INTERNAL' | 'MANUFACTURER' | null;
  additionalBarcodes?: (string | AdditionalBarcode)[] | null;
  productNature?: 'BRANDED' | 'SHOP_PRODUCT' | null;
  imageUrl?: string | null;
  hsn?: string | null;
  unit?: string | null;
  categoryId?: string | null;
  category?: string | null;
  priceMinor: number;          // selling price in paise
  costMinor?: number | null;
  taxRateBp?: number | null;
  taxInclusive?: boolean | null;
  openingQtyMilli?: number | null; // quantity supplied in this import

  // Restock & matching fields
  isRestock?: boolean;
  matchedItemId?: string | null;
  updatePrices?: boolean;
}

interface ValidatedRow extends Omit<BulkImportRow, 'additionalBarcodes'> {
  _rowIndex: number;            // 1-based
  additionalBarcodes?: { barcode: string; barcodeType: 'INTERNAL' | 'MANUFACTURER' }[];
  imageUrl?: string | null;
}

interface RowResult {
  rowIndex: number;
  status: 'created' | 'restocked' | 'skipped';
  name?: string;
  itemId?: string;
  reason?: string;
}

/** Coerce a value to number or null (handles empty strings). */
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Trim string or return null. */
function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * Validate a single raw row from the payload.
 * Returns { errors } when invalid, or { row } when valid.
 */
function validateRow(raw: Record<string, unknown>, rowIndex: number): { errors: string[] } | { row: ValidatedRow } {
  const errors: string[] = [];

  const name = toStr(raw.name);
  if (!name) errors.push('Product name is required');
  else if (name.length > 120) errors.push('Product name is too long (max 120 characters)');

  const priceRaw = toNum(raw.priceMinor);
  if (priceRaw === null) errors.push('Selling price is required and must be a number');
  else if (priceRaw < 0) errors.push('Selling price cannot be negative');

  const costRaw = toNum(raw.costMinor);
  if (costRaw !== null && costRaw < 0) errors.push('Cost price cannot be negative');

  const openingQtyRaw = toNum(raw.openingQtyMilli ?? raw.openingStockMilli);
  if (openingQtyRaw !== null && openingQtyRaw < 0) errors.push('Stock quantity cannot be negative');

  const taxRateBpRaw = toNum(raw.taxRateBp);
  if (taxRateBpRaw !== null && !VALID_GST_RATES_BP.has(taxRateBpRaw)) {
    errors.push(`GST rate ${(taxRateBpRaw / 100).toFixed(1)}% is not a supported rate (valid: 0%, 2.5%, 5%, 12%, 18%, 28%)`);
  }

  const sku = toStr(raw.sku);
  if (sku && sku.length > 60) errors.push('SKU is too long (max 60 characters)');

  const barcode = toStr(raw.barcode);
  if (barcode && barcode.length > 60) errors.push('Barcode is too long (max 60 characters)');

  const rawBarcodeType = toStr(raw.barcodeType);
  const barcodeType: 'INTERNAL' | 'MANUFACTURER' | null =
    rawBarcodeType === 'INTERNAL' || rawBarcodeType === 'MANUFACTURER'
      ? rawBarcodeType
      : null;

  const SCIENTIFIC_NOTATION_RE = /^[0-9]+(\.[0-9]+)?[eE]\+[0-9]+$/;
  if (barcode && SCIENTIFIC_NOTATION_RE.test(barcode)) {
    errors.push('Barcode looks like Excel scientific notation (e.g. 8.9E+12). Format the column as Text and re-export.');
  }
  if (sku && SCIENTIFIC_NOTATION_RE.test(sku)) {
    errors.push('SKU looks like Excel scientific notation. Format the column as Text and re-export.');
  }

  const hsn = toStr(raw.hsn);
  if (hsn && hsn.length > 20) errors.push('HSN code is too long (max 20 characters)');

  const categoryId = toStr(raw.categoryId);
  const category = toStr(raw.category);
  if (category && category.length > 60) errors.push('Category name is too long (max 60 characters)');

  const unit = toStr(raw.unit) || 'pcs';
  if (unit.length > 20) errors.push('Unit is too long (max 20 characters)');

  const isRestock = Boolean(raw.isRestock);
  const matchedItemId = toStr(raw.matchedItemId);
  if (isRestock && !matchedItemId) {
    errors.push('Matched product ID is required for restock');
  }

  const additionalBarcodes: { barcode: string; barcodeType: 'INTERNAL' | 'MANUFACTURER' }[] = [];
  if (Array.isArray(raw.additionalBarcodes)) {
    for (const item of raw.additionalBarcodes) {
      if (!item) continue;
      const bStr = typeof item === 'string' ? toStr(item) : toStr((item as any).barcode);
      if (!bStr) continue;
      if (bStr.length > 60) {
        errors.push(`Additional barcode "${bStr}" is too long (max 60 characters)`);
      }
      const bTypeStr = typeof item === 'object' && item !== null ? toStr((item as any).barcodeType) : null;
      const bType: 'INTERNAL' | 'MANUFACTURER' =
        bTypeStr === 'INTERNAL' || bTypeStr === 'MANUFACTURER'
          ? bTypeStr
          : (bStr.startsWith('20') && bStr.length === 13 ? 'INTERNAL' : 'MANUFACTURER');
      additionalBarcodes.push({ barcode: bStr, barcodeType: bType });
    }
  }

  const rawNature = toStr(raw.productNature);
  const productNature: 'BRANDED' | 'SHOP_PRODUCT' | null =
    rawNature === 'BRANDED' || rawNature === 'SHOP_PRODUCT' ? rawNature : null;

  if (errors.length > 0) return { errors };

  return {
    row: {
      _rowIndex: rowIndex,
      name: name!,
      sku,
      barcode,
      barcodeType,
      additionalBarcodes,
      productNature,
      hsn,
      unit,
      categoryId,
      category,
      priceMinor: Math.round(priceRaw!),
      costMinor: costRaw !== null ? Math.round(costRaw) : 0,
      taxRateBp: taxRateBpRaw ?? 500,
      taxInclusive: raw.taxInclusive === false || raw.taxInclusive === 'false' ? false : true,
      openingQtyMilli: openingQtyRaw !== null ? Math.round(openingQtyRaw) : 0,
      isRestock,
      matchedItemId,
      updatePrices: Boolean(raw.updatePrices),
    },
  };
}

export function registerItemsBulk(r: Router) {
  /**
   * POST /api/items/bulk-import
   *
   * Body: {
   *   importBatchId?: string,
   *   rows: BulkImportRow[]
   * }
   * Returns: { importId, totalRows, created, restocked, skipped, results: RowResult[] }
   *
   * Each row is processed inside a single shared transaction.
   * New products receive unique SKUs & internal barcodes if not provided.
   * Restocks add incoming quantity to existing stock and reuse existing product IDs & SKUs.
   * Missing categories are created safely.
   */
  r.post('/api/items/bulk-import', requirePerm('items.write'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;

    if (!Array.isArray(b.rows)) throw bad('rows must be an array', 'VALIDATION', { field: 'rows' });
    if (b.rows.length === 0) throw bad('rows array is empty', 'VALIDATION', { field: 'rows' });
    if (b.rows.length > 500) throw bad('Cannot import more than 500 products at a time', 'VALIDATION', { field: 'rows' });

    // ── Idempotency check ───────────────────────────────────────────────────
    const importBatchId = b.importBatchId ? String(b.importBatchId).trim() : null;
    if (importBatchId) {
      const existingImport = await ctx.db.one<{ id: string; status: string }>(
        `SELECT id, status FROM imports WHERE id = ? AND tenant_id = ? AND status = 'committed'`,
        [importBatchId, tenantId],
      );
      if (existingImport) {
        throw conflict('This import batch has already been processed and committed.', 'CONFLICT', { importBatchId });
      }
    }
    const importId = importBatchId || newId('imp');

    // ── Step 1: Validate all rows up-front ──────────────────────────────────
    const validRows: ValidatedRow[] = [];
    const results: RowResult[] = [];

    for (let i = 0; i < b.rows.length; i++) {
      const raw = b.rows[i];
      if (typeof raw !== 'object' || raw === null) {
        results.push({ rowIndex: i + 1, status: 'skipped', reason: 'Row is not a valid object' });
        continue;
      }
      const validated = validateRow(raw as Record<string, unknown>, i + 1);
      if ('errors' in validated) {
        results.push({ rowIndex: i + 1, status: 'skipped', name: toStr((raw as any).name) ?? undefined, reason: validated.errors.join('; ') });
      } else {
        validRows.push(validated.row);
      }
    }

    // ── Step 2: Separate restocks from new products ─────────────────────────
    const restockRows: ValidatedRow[] = [];
    const newProductRows: ValidatedRow[] = [];

    for (const r of validRows) {
      if (r.isRestock && r.matchedItemId) {
        restockRows.push(r);
      } else {
        newProductRows.push(r);
      }
    }

    // Verify all restock matched items belong to this tenant
    const matchedItemIds = [...new Set(restockRows.map((r) => r.matchedItemId!))];
    const existingMatchedItems = new Map<string, { id: string; name: string; sku: string | null; barcode: string | null }>();
    if (matchedItemIds.length > 0) {
      const placeholders = matchedItemIds.map(() => '?').join(', ');
      const rows = await ctx.db.query<{ id: string; name: string; sku: string | null; barcode: string | null }>(
        `SELECT id, name, sku, barcode FROM items WHERE tenant_id = ? AND id IN (${placeholders})`,
        [tenantId, ...matchedItemIds],
      );
      for (const item of rows) {
        existingMatchedItems.set(item.id, item);
      }
    }

    const validRestocks: ValidatedRow[] = [];
    for (const row of restockRows) {
      if (!existingMatchedItems.has(row.matchedItemId!)) {
        results.push({
          rowIndex: row._rowIndex,
          status: 'skipped',
          name: row.name,
          reason: `Matched product ID ${row.matchedItemId} was not found in your catalog`,
        });
      } else {
        validRestocks.push(row);
      }
    }

    // ── Step 3: Duplicate checks for NEW products (Intra-batch & Against DB) ─
    const barcodesInPayload = new Map<string, number>(); // barcode -> first rowIndex
    const skusInPayload = new Map<string, number>();      // lower(sku) -> first rowIndex

    for (const row of newProductRows) {
      let isDup = false;
      if (row.barcode) {
        const first = barcodesInPayload.get(row.barcode);
        if (first !== undefined) {
          results.push({
            rowIndex: row._rowIndex,
            status: 'skipped',
            name: row.name,
            reason: `Duplicate barcode "${row.barcode}" — already present in row ${first} of this import`,
          });
          isDup = true;
        } else {
          barcodesInPayload.set(row.barcode, row._rowIndex);
        }
      }
      if (row.sku && !isDup) {
        const key = row.sku.toLowerCase();
        const first = skusInPayload.get(key);
        if (first !== undefined) {
          results.push({
            rowIndex: row._rowIndex,
            status: 'skipped',
            name: row.name,
            reason: `Duplicate SKU "${row.sku}" — already present in row ${first} of this import`,
          });
          isDup = true;
        } else {
          skusInPayload.set(key, row._rowIndex);
        }
      }
    }

    const newRowsAfterIntraDedup = newProductRows.filter(
      (r) =>
        (!r.barcode || barcodesInPayload.get(r.barcode) === r._rowIndex) &&
        (!r.sku || skusInPayload.get(r.sku.toLowerCase()) === r._rowIndex),
    );

    // Check duplicate barcodes & SKUs against database
    const barcodesToCheck = newRowsAfterIntraDedup.map((r) => r.barcode).filter(Boolean) as string[];
    const existingBarcodes = new Map<string, string>();
    if (barcodesToCheck.length > 0) {
      const placeholders = barcodesToCheck.map(() => '?').join(', ');
      const existing = await ctx.db.query<{ barcode: string; name: string }>(
        `SELECT barcode, name FROM items WHERE tenant_id = ? AND barcode IN (${placeholders}) AND barcode IS NOT NULL
         UNION
         SELECT pb.barcode, i.name FROM product_barcodes pb JOIN items i ON i.id = pb.product_id WHERE pb.tenant_id = ? AND pb.barcode IN (${placeholders})`,
        [tenantId, ...barcodesToCheck, tenantId, ...barcodesToCheck],
      );
      for (const e of existing) existingBarcodes.set(e.barcode, e.name);
    }

    const skusToCheck = newRowsAfterIntraDedup.map((r) => r.sku).filter(Boolean) as string[];
    const existingSkus = new Map<string, string>();
    if (skusToCheck.length > 0) {
      const placeholders = skusToCheck.map(() => '?').join(', ');
      const existing = await ctx.db.query<{ sku: string; name: string }>(
        `SELECT sku, name FROM items WHERE tenant_id = ? AND lower(sku) IN (${placeholders}) AND sku IS NOT NULL`,
        [tenantId, ...skusToCheck.map((s) => s.toLowerCase())],
      );
      for (const e of existing) existingSkus.set(e.sku.toLowerCase(), e.name);
    }

    const validNewRows: ValidatedRow[] = [];
    for (const row of newRowsAfterIntraDedup) {
      if (row.barcode && existingBarcodes.has(row.barcode)) {
        const existingName = existingBarcodes.get(row.barcode);
        results.push({
          rowIndex: row._rowIndex,
          status: 'skipped',
          name: row.name,
          reason: `Barcode "${row.barcode}" already exists — used by existing product "${existingName}"`,
        });
      } else if (row.sku && existingSkus.has(row.sku.toLowerCase())) {
        const existingName = existingSkus.get(row.sku.toLowerCase());
        results.push({
          rowIndex: row._rowIndex,
          status: 'skipped',
          name: row.name,
          reason: `SKU "${row.sku}" already exists — used by existing product "${existingName}"`,
        });
      } else {
        validNewRows.push(row);
      }
    }

    if (validRestocks.length === 0 && validNewRows.length === 0) {
      // Nothing to insert — return results immediately
      const created = results.filter((r) => r.status === 'created').length;
      const restocked = results.filter((r) => r.status === 'restocked').length;
      const skipped = results.filter((r) => r.status === 'skipped').length;
      return { importId, totalRows: b.rows.length, created, restocked, skipped, results };
    }

    // ── Step 4: Validate categories & reject deleted / missing ones ─────────
    const categoryIds = [...new Set(validNewRows.map((r) => r.categoryId).filter(Boolean) as string[])];
    const categoryNames = [...new Set(validNewRows.map((r) => r.category).filter(Boolean) as string[])];

    const catById = new Map<string, { id: string; name: string; active: boolean }>();
    const catByName = new Map<string, { id: string; name: string; active: boolean }>();

    if (categoryIds.length > 0) {
      const placeholders = categoryIds.map(() => '?').join(', ');
      const cats = await ctx.db.query<{ id: string; name: string; active: boolean }>(
        `SELECT id, name, active FROM categories WHERE tenant_id = ? AND id IN (${placeholders})`,
        [tenantId, ...categoryIds],
      );
      for (const c of cats) {
        catById.set(c.id, c);
        catByName.set(c.name.toLowerCase(), c);
      }
    }

    if (categoryNames.length > 0) {
      const placeholders = categoryNames.map(() => '?').join(', ');
      const cats = await ctx.db.query<{ id: string; name: string; active: boolean }>(
        `SELECT id, name, active FROM categories WHERE tenant_id = ? AND lower(name) IN (${placeholders})`,
        [tenantId, ...categoryNames.map((c) => c.toLowerCase())],
      );
      for (const c of cats) {
        catById.set(c.id, c);
        catByName.set(c.name.toLowerCase(), c);
      }
    }

    const rowsReadyForInsert: ValidatedRow[] = [];
    for (const row of validNewRows) {
      if (row.categoryId) {
        const resolved = catById.get(row.categoryId);
        if (!resolved) {
          results.push({
            rowIndex: row._rowIndex,
            status: 'skipped',
            name: row.name,
            reason: 'Category is invalid or does not exist. Please select an active category.',
          });
          continue;
        }
        if (!resolved.active) {
          results.push({
            rowIndex: row._rowIndex,
            status: 'skipped',
            name: row.name,
            reason: `Category "${resolved.name}" has been deleted or deactivated. Please select a valid active category.`,
          });
          continue;
        }
        row.categoryId = resolved.id;
        row.category = resolved.name;
        rowsReadyForInsert.push(row);
      } else if (row.category) {
        const resolved = catByName.get(row.category.toLowerCase());
        if (resolved) {
          if (!resolved.active) {
            results.push({
              rowIndex: row._rowIndex,
              status: 'skipped',
              name: row.name,
              reason: `Category "${resolved.name}" has been deleted or deactivated. Please select a valid active category.`,
            });
            continue;
          }
          row.categoryId = resolved.id;
          row.category = resolved.name;
        } else {
          // Auto-create missing category by name
          const catName = row.category.trim();
          const newCatId = newId('cat');
          try {
            await ctx.db.exec(
              'INSERT INTO categories (id, tenant_id, name, active) VALUES (?, ?, ?, true) ON CONFLICT DO NOTHING',
              [newCatId, tenantId, catName],
            );
            const createdCat = { id: newCatId, name: catName, active: true };
            catById.set(newCatId, createdCat);
            catByName.set(catName.toLowerCase(), createdCat);
            row.categoryId = newCatId;
            row.category = catName;
          } catch {
            // ignore
          }
        }
        rowsReadyForInsert.push(row);
      } else {
        // No category provided
        rowsReadyForInsert.push(row);
      }
    }

    // ── Step 5: Get warehouse location ────────────────────────────────────────
    let firstLocation = 'MAIN';
    const shop = await ctx.db.one<{ locations: unknown }>('SELECT locations FROM tenants WHERE id = ?', [tenantId]);
    if (shop?.locations) {
      const locs = typeof shop.locations === 'string' ? JSON.parse(shop.locations) : shop.locations;
      if (Array.isArray(locs) && locs.length > 0 && typeof locs[0] === 'string' && locs[0].trim()) {
        firstLocation = locs[0].trim();
      }
    }

    // Fetch existing SKUs for auto-SKU generator collision avoidance
    const allTenantSkus = new Set(
      (await ctx.db.query<{ sku: string }>('SELECT lower(sku) as sku FROM items WHERE tenant_id = ? AND sku IS NOT NULL', [tenantId]))
        .map((r) => r.sku)
    );
    const seenImportSkus = new Set<string>();

    // Fetch existing Barcodes for auto-barcode generator collision avoidance
    const allTenantBarcodes = new Set(
      (await ctx.db.query<{ barcode: string }>(
        `SELECT barcode FROM items WHERE tenant_id = ? AND barcode IS NOT NULL
         UNION
         SELECT barcode FROM product_barcodes WHERE tenant_id = ?`,
        [tenantId, tenantId],
      )).map((r) => r.barcode)
    );
    const seenImportBarcodes = new Set<string>();

    // ── Step 6: Atomic transaction for all restocks and new products ──────────
    let created = 0;
    let restocked = 0;
    let skipped = results.filter((r) => r.status === 'skipped').length;
    let barcodesSaved = 0;

    await ctx.db.tx(async (q) => {
      // 1. Create missing categories if not already existing or deleted
      for (const row of rowsReadyForInsert) {
        if (row.category && !catByName.has(row.category.toLowerCase())) {
          const catId = newId('cat');
          await q.exec(
            `INSERT INTO categories (id, tenant_id, name, active) VALUES (?, ?, ?, true)
             ON CONFLICT DO NOTHING`,
            [catId, tenantId, row.category],
          );
          catByName.set(row.category.toLowerCase(), { id: catId, name: row.category, active: true });
        }
      }

      // 2. Process Restocks
      for (const row of validRestocks) {
        const itemId = row.matchedItemId!;
        try {
          // If incoming stock > 0, record inventory stock-in movement
          if ((row.openingQtyMilli ?? 0) > 0) {
            await q.exec(
              `INSERT INTO stock_moves (id, tenant_id, item_id, location, qty_milli, kind, ref_type, ref_id, unit_cost_minor, reason, user_id)
               VALUES (?, ?, ?, ?, ?, 'purchase', 'import', ?, ?, 'Bulk import restock shipment', ?)`,
              [newId('sm'), tenantId, itemId, firstLocation, row.openingQtyMilli, importId, row.costMinor ?? 0, ctx.user!.id],
            );
          }

          // If price updates requested, update product pricing
          if (row.imageUrl) {
          await q.exec(
            'UPDATE items SET image_url = COALESCE(NULLIF(?, \'\'), image_url) WHERE id = ? AND tenant_id = ?',
            [row.imageUrl, row.matchedItemId, tenantId],
          );
        }
        if (row.updatePrices) {
            await q.exec(
              `UPDATE items
               SET price_minor = ?, cost_minor = ?, tax_rate_bp = ?, tax_inclusive = ?, hsn = COALESCE(?, hsn), updated_at = now()
               WHERE id = ? AND tenant_id = ?`,
              [row.priceMinor, row.costMinor ?? 0, row.taxRateBp ?? 500, row.taxInclusive ?? true, row.hsn || null, itemId, tenantId],
            );
          }

          const matchedItemInfo = existingMatchedItems.get(itemId);
          const oldPrimaryBarcode = matchedItemInfo?.barcode || null;
          const newBarcodeTrim = row.barcode ? row.barcode.trim() : null;

          // If row specifies a barcode or explicitly cleared, update primary barcode on items table
          if (newBarcodeTrim !== oldPrimaryBarcode) {
            if (newBarcodeTrim) {
              const conflictItem = await q.one<{ id: string; name: string }>(
                'SELECT id, name FROM items WHERE tenant_id = ? AND barcode = ? AND id <> ?',
                [tenantId, newBarcodeTrim, itemId],
              );
              if (!conflictItem) {
                await q.exec(
                  'UPDATE items SET barcode = ?, updated_at = now() WHERE id = ? AND tenant_id = ?',
                  [newBarcodeTrim, itemId, tenantId],
                );
              }
            } else if (row.barcode === null || row.barcode === '') {
              await q.exec(
                'UPDATE items SET barcode = NULL, updated_at = now() WHERE id = ? AND tenant_id = ?',
                [itemId, tenantId],
              );
            }

            // If the old barcode was in product_barcodes, remove unless retained in additionalBarcodes
            if (oldPrimaryBarcode && oldPrimaryBarcode !== newBarcodeTrim) {
              const keepInAdditional = (row.additionalBarcodes || []).some(
                (ab) => ab.barcode && ab.barcode.trim() === oldPrimaryBarcode,
              );
              if (!keepInAdditional) {
                await q.exec(
                  'DELETE FROM product_barcodes WHERE tenant_id = ? AND product_id = ? AND barcode = ?',
                  [tenantId, itemId, oldPrimaryBarcode],
                );
              }
            }
          }

          // Register new barcode in product_barcodes table
          if (newBarcodeTrim) {
            const bType =
              row.barcodeType ||
              (newBarcodeTrim.startsWith('20') && newBarcodeTrim.length === 13 ? 'INTERNAL' : 'MANUFACTURER');
            const existingBc = await q.one<{ id: string; product_id: string }>(
              'SELECT id, product_id FROM product_barcodes WHERE tenant_id = ? AND barcode = ?',
              [tenantId, newBarcodeTrim],
            );
            if (!existingBc) {
              await q.exec(
                `INSERT INTO product_barcodes (id, tenant_id, product_id, barcode, barcode_type)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT (tenant_id, barcode) DO UPDATE SET product_id = EXCLUDED.product_id, barcode_type = EXCLUDED.barcode_type`,
                [newId('bc'), tenantId, itemId, newBarcodeTrim, bType],
              );
              barcodesSaved++;
            } else if (existingBc.product_id !== itemId) {
              await q.exec(
                'UPDATE product_barcodes SET product_id = ?, barcode_type = ? WHERE id = ?',
                [itemId, bType, existingBc.id],
              );
            } else {
              await q.exec(
                'UPDATE product_barcodes SET barcode_type = ? WHERE id = ?',
                [bType, existingBc.id],
              );
            }
          }

          if (row.additionalBarcodes && row.additionalBarcodes.length > 0) {
            for (const ab of row.additionalBarcodes) {
              const abTrim = ab.barcode.trim();
              if (abTrim && abTrim !== row.barcode?.trim()) {
                const existingAb = await q.one<{ id: string; productId: string }>(
                  'SELECT id, product_id FROM product_barcodes WHERE tenant_id = ? AND barcode = ?',
                  [tenantId, abTrim],
                );
                if (!existingAb) {
                  const abType = ab.barcodeType || (abTrim.startsWith('20') && abTrim.length === 13 ? 'INTERNAL' : 'MANUFACTURER');
                  await q.exec(
                    `INSERT INTO product_barcodes (id, tenant_id, product_id, barcode, barcode_type)
                     VALUES (?, ?, ?, ?, ?)
                     ON CONFLICT (tenant_id, barcode) DO NOTHING`,
                    [newId('bc'), tenantId, itemId, abTrim, abType],
                  );
                  barcodesSaved++;
                }
              }
            }
          }

          results.push({ rowIndex: row._rowIndex, status: 'restocked', name: row.name, itemId });
          restocked++;
        } catch (err: any) {
          results.push({
            rowIndex: row._rowIndex,
            status: 'skipped',
            name: row.name,
            reason: `Restock failed: ${err.message || 'database error'}`,
          });
          skipped++;
        }
      }

      // 3. Process New Products
      for (const row of rowsReadyForInsert) {
        const id = newId('i');
        // Ensure compact short SKU
        const finalSku = row.sku ? row.sku.trim() : generateUniqueShortSku(row.name, allTenantSkus, seenImportSkus);
        allTenantSkus.add(finalSku.toLowerCase());

        // Ensure Barcode (manufacturer if given, or generate internal EAN-13)
        let finalBarcode = row.barcode ? row.barcode.trim() : null;
        let barcodeType: 'INTERNAL' | 'MANUFACTURER' = row.barcodeType || 'MANUFACTURER';
        if (!finalBarcode) {
          finalBarcode = generateUniqueInternalBarcode(allTenantBarcodes, seenImportBarcodes);
          seenImportBarcodes.add(finalBarcode);
          barcodeType = 'INTERNAL';
        } else if (!row.barcodeType) {
          barcodeType = finalBarcode.startsWith('20') && finalBarcode.length === 13 ? 'INTERNAL' : 'MANUFACTURER';
          seenImportBarcodes.add(finalBarcode);
        } else {
          seenImportBarcodes.add(finalBarcode);
        }

        await q.exec('SAVEPOINT sp_bulk_row');
        try {
          // Insert item
          await q.exec(
            `INSERT INTO items (
              id, tenant_id, name, sku, barcode, hsn, unit, category,
              price_minor, cost_minor, tax_rate_bp, tax_inclusive, track_stock,
              reorder_milli, min_stock_milli, favorite, custom, active, import_id, image_url
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, 0, 0, false, '{}'::jsonb, true, ?, ?)`,
            [
              id, tenantId, row.name, finalSku, finalBarcode, row.hsn || null,
              row.unit || 'pcs', row.category || null,
              row.priceMinor, row.costMinor ?? 0, row.taxRateBp ?? 500, row.taxInclusive ?? true,
              importId, row.imageUrl || null,
            ],
          );

          // Insert into product_barcodes table (if barcode mapping fails, rolls back item creation)
          if (finalBarcode) {
            await q.exec(
              `INSERT INTO product_barcodes (id, tenant_id, product_id, barcode, barcode_type)
               VALUES (?, ?, ?, ?, ?)`,
              [newId('bc'), tenantId, id, finalBarcode, barcodeType],
            );
            barcodesSaved++;
          }

          if (row.additionalBarcodes && row.additionalBarcodes.length > 0) {
            for (const ab of row.additionalBarcodes) {
              const abTrim = ab.barcode.trim();
              if (abTrim && abTrim !== finalBarcode) {
                const abType = ab.barcodeType || (abTrim.startsWith('20') && abTrim.length === 13 ? 'INTERNAL' : 'MANUFACTURER');
                await q.exec(
                  `INSERT INTO product_barcodes (id, tenant_id, product_id, barcode, barcode_type)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT (tenant_id, barcode) DO NOTHING`,
                  [newId('bc'), tenantId, id, abTrim, abType],
                );
                barcodesSaved++;
                seenImportBarcodes.add(abTrim);
              }
            }
          }

          // Record opening stock if provided
          if ((row.openingQtyMilli ?? 0) > 0) {
            await q.exec(
              `INSERT INTO stock_moves (id, tenant_id, item_id, location, qty_milli, kind, ref_type, ref_id, unit_cost_minor, reason, user_id)
               VALUES (?, ?, ?, ?, ?, 'opening', 'import', ?, ?, 'Bulk import opening stock', ?)`,
              [newId('sm'), tenantId, id, firstLocation, row.openingQtyMilli, importId, row.costMinor ?? 0, ctx.user!.id],
            );
          }

          await q.exec('RELEASE SAVEPOINT sp_bulk_row');
          results.push({ rowIndex: row._rowIndex, status: 'created', name: row.name, itemId: id });
          created++;
        } catch (err: any) {
          await q.exec('ROLLBACK TO SAVEPOINT sp_bulk_row');
          results.push({
            rowIndex: row._rowIndex,
            status: 'skipped',
            name: row.name,
            reason: err?.message?.includes('product_barcodes') || err?.code === '23505'
              ? 'Product code or barcode conflict occurred during insertion'
              : (err?.message || 'Insertion failed'),
          });
          skipped++;
        }
      }

      // 4. Record in imports table
      const totalSkipped = b.rows.length - (created + restocked);
      await q.exec(
        `INSERT INTO imports (id, tenant_id, kind, total_rows, accepted, rejected, status, created_by)
         VALUES (?, ?, 'items', ?, ?, ?, 'committed', ?)`,
        [importId, tenantId, b.rows.length, created + restocked, totalSkipped, ctx.user!.id],
      );

      // 5. Audit log
      await audit(q, ctx, {
        action: 'item.bulk_import',
        entity: 'item',
        entityId: importId,
        detail: { importId, totalRows: b.rows.length, created, restocked, skipped: totalSkipped, barcodesSaved },
      });
    });

    skipped = results.filter((r) => r.status === 'skipped').length;
    results.sort((a, b) => a.rowIndex - b.rowIndex);

    return {
      importId,
      totalRows: b.rows.length,
      created,
      restocked,
      skipped,
      barcodesSaved,
      results,
    };
  });
}
