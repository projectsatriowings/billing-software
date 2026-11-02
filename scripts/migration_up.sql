-- ============================================================================
-- migration_up.sql: Branch-Wise Data Isolation Migration
-- All operations are wrapped in an atomic transaction
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. ADD branch_id COLUMNS WHERE MISSING
-- ----------------------------------------------------------------------------
ALTER TABLE categories ADD COLUMN IF NOT EXISTS branch_id TEXT;
ALTER TABLE promotions ADD COLUMN IF NOT EXISTS branch_id TEXT;
ALTER TABLE product_barcodes ADD COLUMN IF NOT EXISTS branch_id TEXT;
ALTER TABLE stock_adjustments ADD COLUMN IF NOT EXISTS branch_id TEXT;
ALTER TABLE stock_counts ADD COLUMN IF NOT EXISTS branch_id TEXT;
ALTER TABLE payment_allocations ADD COLUMN IF NOT EXISTS branch_id TEXT;
ALTER TABLE credit_allocations ADD COLUMN IF NOT EXISTS branch_id TEXT;
ALTER TABLE supplier_payment_allocations ADD COLUMN IF NOT EXISTS branch_id TEXT;
ALTER TABLE number_series ADD COLUMN IF NOT EXISTS branch_id TEXT;

-- ----------------------------------------------------------------------------
-- 2. BACKUP TRACKING TABLES (For 100% reversible rollback)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS _bk_migration_branch_backfill (
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  original_branch_id TEXT,
  PRIMARY KEY (table_name, record_id)
);

INSERT INTO _bk_migration_branch_backfill (table_name, record_id, original_branch_id)
SELECT 'invoices', id, branch_id FROM invoices WHERE branch_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO _bk_migration_branch_backfill (table_name, record_id, original_branch_id)
SELECT 'shifts', id, branch_id FROM shifts WHERE branch_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO _bk_migration_branch_backfill (table_name, record_id, original_branch_id)
SELECT 'payments', id, branch_id FROM payments WHERE branch_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO _bk_migration_branch_backfill (table_name, record_id, original_branch_id)
SELECT 'stock_moves', id, branch_id FROM stock_moves WHERE branch_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO _bk_migration_branch_backfill (table_name, record_id, original_branch_id)
SELECT 'items', id, branch_id FROM items WHERE branch_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Tracking table for copied records
CREATE TABLE IF NOT EXISTS _bk_copied_records (
  original_id TEXT NOT NULL,
  copied_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, copied_id)
);

-- ----------------------------------------------------------------------------
-- 3. DERIVED BRANCH_ID BACKFILL (Priority-based, no hardcoding)
-- ----------------------------------------------------------------------------

-- Invoices derivation:
-- Priority: 1. User branch, 2. Location branch code/name, 3. 'br_main_store'
UPDATE invoices inv
SET branch_id = COALESCE(
  u.branch_id,
  (SELECT b.id FROM branches b WHERE b.code = inv.location OR b.name = inv.location LIMIT 1),
  'br_main_store'
)
FROM users u
WHERE inv.created_by = u.id AND inv.branch_id IS NULL;

UPDATE invoices inv
SET branch_id = COALESCE(
  (SELECT b.id FROM branches b WHERE b.code = inv.location OR b.name = inv.location LIMIT 1),
  'br_main_store'
)
WHERE inv.branch_id IS NULL;

-- Shifts derivation:
-- Priority: 1. User branch, 2. Location branch code/name, 3. 'br_main_store'
UPDATE shifts s
SET branch_id = COALESCE(
  u.branch_id,
  (SELECT b.id FROM branches b WHERE b.code = s.location OR b.name = s.location LIMIT 1),
  'br_main_store'
)
FROM users u
WHERE s.user_id = u.id AND s.branch_id IS NULL;

UPDATE shifts s
SET branch_id = COALESCE(
  (SELECT b.id FROM branches b WHERE b.code = s.location OR b.name = s.location LIMIT 1),
  'br_main_store'
)
WHERE s.branch_id IS NULL;

-- Payments derivation:
-- Priority: 1. Invoice branch, 2. Purchase branch, 3. Shift branch, 4. Location branch, 5. 'br_main_store'
UPDATE payments p
SET branch_id = COALESCE(
  (SELECT inv.branch_id FROM invoices inv WHERE inv.id = p.invoice_id),
  (SELECT pur.branch_id FROM purchases pur WHERE pur.id = p.purchase_id),
  (SELECT shf.branch_id FROM shifts shf WHERE shf.id = p.shift_id),
  (SELECT b.id FROM branches b WHERE b.code = p.location OR b.name = p.location LIMIT 1),
  'br_main_store'
)
WHERE p.branch_id IS NULL;

-- Stock moves derivation:
-- Priority: 1. Invoice branch, 2. Purchase branch, 3. Location branch, 4. 'br_main_store'
UPDATE stock_moves sm
SET branch_id = COALESCE(
  (SELECT inv.branch_id FROM invoices inv WHERE sm.ref_type = 'invoice' AND sm.ref_id = inv.id),
  (SELECT pur.branch_id FROM purchases pur WHERE sm.ref_type = 'purchase' AND sm.ref_id = pur.id),
  (SELECT b.id FROM branches b WHERE b.code = sm.location OR b.name = sm.location LIMIT 1),
  'br_main_store'
)
WHERE sm.branch_id IS NULL;

-- Purchases, expenses, cash movements derivation:
UPDATE purchases SET branch_id = 'br_main_store' WHERE branch_id IS NULL;
UPDATE expenses SET branch_id = 'br_main_store' WHERE branch_id IS NULL;

UPDATE cash_movements cm
SET branch_id = COALESCE(
  (SELECT shf.branch_id FROM shifts shf WHERE cm.shift_id = shf.id),
  'br_main_store'
)
WHERE cm.branch_id IS NULL;
UPDATE cash_movements SET branch_id = 'br_main_store' WHERE branch_id IS NULL;

-- Masters backfill to br_main_store (where not yet set):
UPDATE items SET branch_id = 'br_main_store' WHERE branch_id IS NULL;
UPDATE categories SET branch_id = 'br_main_store' WHERE branch_id IS NULL;
UPDATE parties SET branch_id = 'br_main_store' WHERE branch_id IS NULL;
UPDATE promotions SET branch_id = 'br_main_store' WHERE branch_id IS NULL;

UPDATE product_barcodes pb
SET branch_id = i.branch_id
FROM items i
WHERE pb.product_id = i.id AND pb.branch_id IS NULL;
UPDATE product_barcodes SET branch_id = 'br_main_store' WHERE branch_id IS NULL;

UPDATE stock_adjustments SET branch_id = 'br_main_store' WHERE branch_id IS NULL;
UPDATE stock_counts SET branch_id = 'br_main_store' WHERE branch_id IS NULL;
UPDATE number_series SET branch_id = 'br_main_store' WHERE branch_id IS NULL;

UPDATE payment_allocations pa
SET branch_id = p.branch_id
FROM payments p
WHERE pa.payment_id = p.id AND pa.branch_id IS NULL;
UPDATE payment_allocations SET branch_id = 'br_main_store' WHERE branch_id IS NULL;

UPDATE credit_allocations SET branch_id = 'br_main_store' WHERE branch_id IS NULL;
UPDATE supplier_payment_allocations SET branch_id = 'br_main_store' WHERE branch_id IS NULL;

-- ----------------------------------------------------------------------------
-- 4. DROP COMPANY-WIDE UNIQUE INDEXES & CREATE BRANCH-SCOPED INDEXES
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS categories_name_uq;
DROP INDEX IF EXISTS items_barcode_uq;
DROP INDEX IF EXISTS product_barcodes_uq;
DROP INDEX IF EXISTS idx_parties_phone;

CREATE UNIQUE INDEX IF NOT EXISTS categories_branch_name_uq ON categories (tenant_id, branch_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS items_branch_barcode_uq ON items (tenant_id, branch_id, barcode) WHERE barcode IS NOT NULL AND barcode != '';
CREATE INDEX IF NOT EXISTS product_barcodes_tenant_branch ON product_barcodes (tenant_id, branch_id, barcode);
CREATE INDEX IF NOT EXISTS parties_tenant_branch_phone ON parties (tenant_id, branch_id, phone);

-- ----------------------------------------------------------------------------
-- 5. INLINE COPY LOGIC FOR NON-MAIN BRANCHES (STEP 9)
-- ----------------------------------------------------------------------------

-- 5a: Copy Categories needed by non-Main branch transactions
WITH needed_categories AS (
  SELECT DISTINCT c.id, c.name, c.tenant_id, target_refs.branch_id AS target_branch_id
  FROM categories c
  JOIN items i ON i.category = c.name
  JOIN (
    SELECT DISTINCT il.item_id, inv.branch_id
    FROM invoice_lines il
    JOIN invoices inv ON il.invoice_id = inv.id
    WHERE inv.branch_id IS NOT NULL AND inv.branch_id != 'br_main_store'
    UNION
    SELECT DISTINCT sm.item_id, sm.branch_id
    FROM stock_moves sm
    WHERE sm.branch_id IS NOT NULL AND sm.branch_id != 'br_main_store'
  ) target_refs ON target_refs.item_id = i.id
  WHERE NOT EXISTS (
    SELECT 1 FROM categories c2 
    WHERE c2.tenant_id = c.tenant_id 
      AND c2.branch_id = target_refs.branch_id 
      AND lower(c2.name) = lower(c.name)
  )
),
inserted_categories AS (
  INSERT INTO categories (
    id, tenant_id, branch_id, name, parent_id, description, active, created_at, updated_at
  )
  SELECT 
    c.id || '_' || nc.target_branch_id,
    c.tenant_id,
    nc.target_branch_id,
    c.name,
    NULL,
    c.description,
    c.active,
    now(),
    now()
  FROM needed_categories nc
  JOIN categories c ON c.id = nc.id
  ON CONFLICT DO NOTHING
  RETURNING id, tenant_id, branch_id, name
)
INSERT INTO _bk_copied_records (original_id, copied_id, entity_type, branch_id)
SELECT split_part(ic.id, '_' || ic.branch_id, 1), ic.id, 'category', ic.branch_id
FROM inserted_categories ic
ON CONFLICT DO NOTHING;

-- 5b: Copy Items needed by non-Main branch transactions
WITH needed_items AS (
  SELECT DISTINCT i.id AS original_item_id, target_refs.branch_id AS target_branch_id
  FROM items i
  JOIN (
    SELECT DISTINCT il.item_id, inv.branch_id
    FROM invoice_lines il
    JOIN invoices inv ON il.invoice_id = inv.id
    WHERE inv.branch_id IS NOT NULL AND inv.branch_id != 'br_main_store'
    UNION
    SELECT DISTINCT sm.item_id, sm.branch_id
    FROM stock_moves sm
    WHERE sm.branch_id IS NOT NULL AND sm.branch_id != 'br_main_store'
  ) target_refs ON target_refs.item_id = i.id
  WHERE NOT EXISTS (
    SELECT 1 FROM _bk_copied_records cr 
    WHERE cr.original_id = i.id 
      AND cr.branch_id = target_refs.branch_id 
      AND cr.entity_type = 'item'
  )
),
inserted_items AS (
  INSERT INTO items (
    id, tenant_id, branch_id, name, sku, barcode, hsn, unit, category,
    price_minor, cost_minor, tax_rate_bp, tax_inclusive, track_stock,
    track_batch, reorder_milli, favorite, custom, active, min_stock_milli,
    preferred_supplier_id, image_url, created_at, updated_at
  )
  SELECT 
    i.id || '_' || ni.target_branch_id,
    i.tenant_id,
    ni.target_branch_id,
    i.name,
    CASE WHEN i.sku IS NOT NULL AND i.sku != '' THEN i.sku || '-' || b.code ELSE NULL END,
    i.barcode,
    i.hsn,
    i.unit,
    i.category,
    i.price_minor,
    i.cost_minor,
    i.tax_rate_bp,
    i.tax_inclusive,
    i.track_stock,
    i.track_batch,
    i.reorder_milli,
    i.favorite,
    i.custom,
    i.active,
    i.min_stock_milli,
    NULL,
    i.image_url,
    now(),
    now()
  FROM needed_items ni
  JOIN items i ON i.id = ni.original_item_id
  JOIN branches b ON b.id = ni.target_branch_id
  ON CONFLICT DO NOTHING
  RETURNING id, tenant_id, branch_id
)
INSERT INTO _bk_copied_records (original_id, copied_id, entity_type, branch_id)
SELECT split_part(ii.id, '_' || ii.branch_id, 1), ii.id, 'item', ii.branch_id
FROM inserted_items ii
ON CONFLICT DO NOTHING;

-- 5c: Copy Barcodes for copied items
WITH inserted_barcodes AS (
  INSERT INTO product_barcodes (
    id, tenant_id, branch_id, product_id, barcode, is_primary, created_at, barcode_type
  )
  SELECT 
    pb.id || '_' || cr.branch_id,
    pb.tenant_id,
    cr.branch_id,
    cr.copied_id,
    pb.barcode,
    pb.is_primary,
    now(),
    pb.barcode_type
  FROM product_barcodes pb
  JOIN _bk_copied_records cr ON cr.original_id = pb.product_id AND cr.entity_type = 'item'
  ON CONFLICT DO NOTHING
  RETURNING id, tenant_id, branch_id
)
INSERT INTO _bk_copied_records (original_id, copied_id, entity_type, branch_id)
SELECT split_part(ib.id, '_' || ib.branch_id, 1), ib.id, 'product_barcode', ib.branch_id
FROM inserted_barcodes ib
ON CONFLICT DO NOTHING;

-- 5d: Re-point non-Main invoice_lines to the copied item records
UPDATE invoice_lines il
SET item_id = cr.copied_id
FROM invoices inv
JOIN _bk_copied_records cr ON cr.branch_id = inv.branch_id AND cr.entity_type = 'item'
WHERE il.invoice_id = inv.id
  AND il.item_id = cr.original_id
  AND inv.branch_id != 'br_main_store';

-- 5e: Re-point non-Main stock_moves to the copied item records
UPDATE stock_moves sm
SET item_id = cr.copied_id
FROM _bk_copied_records cr
WHERE sm.branch_id = cr.branch_id
  AND sm.item_id = cr.original_id
  AND cr.entity_type = 'item'
  AND sm.branch_id != 'br_main_store';

-- 5f: Parties copy & re-point (generic logic for non-Main invoices & purchases)
WITH needed_parties AS (
  SELECT DISTINCT p.id AS original_party_id, inv.branch_id AS target_branch_id
  FROM parties p
  JOIN invoices inv ON inv.party_id = p.id
  WHERE inv.branch_id IS NOT NULL AND inv.branch_id != 'br_main_store'
  UNION
  SELECT DISTINCT p.id AS original_party_id, pur.branch_id AS target_branch_id
  FROM parties p
  JOIN purchases pur ON pur.supplier_id = p.id
  WHERE pur.branch_id IS NOT NULL AND pur.branch_id != 'br_main_store'
),
inserted_parties AS (
  INSERT INTO parties (
    id, tenant_id, branch_id, type, name, phone, email, gstin, state_code,
    address, credit_limit_minor, loyalty_points, advance_minor, custom, active, created_at
  )
  SELECT 
    p.id || '_' || np.target_branch_id,
    p.tenant_id,
    np.target_branch_id,
    p.type,
    p.name,
    p.phone,
    p.email,
    p.gstin,
    p.state_code,
    p.address,
    p.credit_limit_minor,
    0,
    0,
    p.custom,
    p.active,
    now()
  FROM needed_parties np
  JOIN parties p ON p.id = np.original_party_id
  ON CONFLICT DO NOTHING
  RETURNING id, tenant_id, branch_id
)
INSERT INTO _bk_copied_records (original_id, copied_id, entity_type, branch_id)
SELECT split_part(ip.id, '_' || ip.branch_id, 1), ip.id, 'party', ip.branch_id
FROM inserted_parties ip
ON CONFLICT DO NOTHING;

UPDATE invoices inv
SET party_id = cr.copied_id
FROM _bk_copied_records cr
WHERE inv.party_id = cr.original_id
  AND inv.branch_id = cr.branch_id
  AND cr.entity_type = 'party'
  AND inv.branch_id != 'br_main_store';

UPDATE purchases pur
SET supplier_id = cr.copied_id
FROM _bk_copied_records cr
WHERE pur.supplier_id = cr.original_id
  AND pur.branch_id = cr.branch_id
  AND cr.entity_type = 'party'
  AND pur.branch_id != 'br_main_store';

-- ----------------------------------------------------------------------------
-- 6. RECALCULATE STORED STOCK IN branch_inventory FROM stock_moves
-- ----------------------------------------------------------------------------

-- Recalculate Main branch stored stock
INSERT INTO branch_inventory (id, tenant_id, branch_id, item_id, stock_milli, reorder_milli, selling_price_minor, cost_price_minor, shelf_bin, updated_at)
SELECT 
  'bi_' || sm.branch_id || '_' || sm.item_id,
  sm.tenant_id,
  sm.branch_id,
  sm.item_id,
  SUM(sm.qty_milli)::BIGINT,
  COALESCE(i.reorder_milli, 0),
  COALESCE(i.price_minor, 0),
  COALESCE(i.cost_minor, 0),
  'MAIN',
  now()
FROM stock_moves sm
JOIN items i ON sm.item_id = i.id
WHERE sm.branch_id = 'br_main_store'
GROUP BY sm.tenant_id, sm.branch_id, sm.item_id, i.reorder_milli, i.price_minor, i.cost_minor
ON CONFLICT (tenant_id, branch_id, item_id) 
DO UPDATE SET stock_milli = EXCLUDED.stock_milli, updated_at = now();

-- Calculate Porur branch stored stock SOLELY from Porur stock_moves (NOT copied from Main)
INSERT INTO branch_inventory (id, tenant_id, branch_id, item_id, stock_milli, reorder_milli, selling_price_minor, cost_price_minor, shelf_bin, updated_at)
SELECT 
  'bi_' || sm.branch_id || '_' || sm.item_id,
  sm.tenant_id,
  sm.branch_id,
  sm.item_id,
  SUM(sm.qty_milli)::BIGINT,
  COALESCE(i.reorder_milli, 0),
  COALESCE(i.price_minor, 0),
  COALESCE(i.cost_minor, 0),
  'PORUR',
  now()
FROM stock_moves sm
JOIN items i ON sm.item_id = i.id
WHERE sm.branch_id = 'br_porur_store'
GROUP BY sm.tenant_id, sm.branch_id, sm.item_id, i.reorder_milli, i.price_minor, i.cost_minor
ON CONFLICT (tenant_id, branch_id, item_id) 
DO UPDATE SET stock_milli = EXCLUDED.stock_milli, updated_at = now();

-- ----------------------------------------------------------------------------
-- 7. SET NOT NULL CONSTRAINTS ON ALL BRANCH-SCOPED TABLES
-- ----------------------------------------------------------------------------
ALTER TABLE invoices ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE shifts ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE payments ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE stock_moves ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE items ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE categories ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE parties ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE expenses ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE purchases ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE cash_movements ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE product_barcodes ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE stock_adjustments ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE stock_counts ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE promotions ALTER COLUMN branch_id SET NOT NULL;
ALTER TABLE number_series ALTER COLUMN branch_id SET NOT NULL;

-- ----------------------------------------------------------------------------
-- 8. COMPOSITE PERFORMANCE INDEXES
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_branch ON invoices (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_shifts_tenant_branch ON shifts (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_branch ON payments (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_moves_tenant_branch ON stock_moves (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_items_tenant_branch ON items (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_categories_tenant_branch ON categories (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_parties_tenant_branch ON parties (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_branch ON expenses (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_purchases_tenant_branch ON purchases (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_tenant_branch ON cash_movements (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_tenant_branch ON product_barcodes (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_adjustments_tenant_branch ON stock_adjustments (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_counts_tenant_branch ON stock_counts (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_promotions_tenant_branch ON promotions (tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_number_series_tenant_branch ON number_series (tenant_id, branch_id);

COMMIT;

