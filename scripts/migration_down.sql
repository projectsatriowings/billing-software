-- ============================================================================
-- migration_down.sql: Branch-Wise Data Isolation Rollback
-- Safely reverts schema and data back to tenant-level masters
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. PRE-CHECK: VERIFY NO DUPLICATE INVOICE NUMBERS ACROSS BRANCHES
-- If duplicate invoice numbers exist across branches, abort immediately!
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_dup_invoices INT;
BEGIN
  SELECT count(*) INTO v_dup_invoices
  FROM (
    SELECT tenant_id, number, count(*)
    FROM invoices
    GROUP BY tenant_id, number
    HAVING count(*) > 1
  ) dups;

  IF v_dup_invoices > 0 THEN
    RAISE EXCEPTION 'Rollback check failed: % duplicate invoice numbers found across branches. Cannot safely merge to tenant-level without number collision.', v_dup_invoices;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. DROP NOT NULL CONSTRAINTS ON branch_id COLUMNS
-- ----------------------------------------------------------------------------
ALTER TABLE invoices ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE shifts ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE payments ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE stock_moves ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE items ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE categories ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE parties ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE expenses ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE purchases ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE cash_movements ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE product_barcodes ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE stock_adjustments ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE stock_counts ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE promotions ALTER COLUMN branch_id DROP NOT NULL;
ALTER TABLE number_series ALTER COLUMN branch_id DROP NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. REVERT FOREIGN KEYS / REFERENCES POINTING TO COPIED RECORDS
-- ----------------------------------------------------------------------------
-- Revert invoice_lines pointing to copied items back to original items
UPDATE invoice_lines il
SET item_id = cr.original_id
FROM _bk_copied_records cr
WHERE il.item_id = cr.copied_id
  AND cr.entity_type = 'item';

-- Revert stock_moves pointing to copied items back to original items
UPDATE stock_moves sm
SET item_id = cr.original_id
FROM _bk_copied_records cr
WHERE sm.item_id = cr.copied_id
  AND cr.entity_type = 'item';

-- Revert invoices party_id pointing to copied parties back to original parties
UPDATE invoices inv
SET party_id = cr.original_id
FROM _bk_copied_records cr
WHERE inv.party_id = cr.copied_id
  AND cr.entity_type = 'party';

-- Revert purchases supplier_id pointing to copied parties back to original parties
UPDATE purchases pur
SET supplier_id = cr.original_id
FROM _bk_copied_records cr
WHERE pur.supplier_id = cr.copied_id
  AND cr.entity_type = 'party';

-- ----------------------------------------------------------------------------
-- 4. DELETE COPIED RECORDS
-- ----------------------------------------------------------------------------
DELETE FROM branch_inventory
WHERE item_id IN (SELECT copied_id FROM _bk_copied_records WHERE entity_type = 'item');

DELETE FROM product_barcodes
WHERE id IN (SELECT copied_id FROM _bk_copied_records WHERE entity_type = 'product_barcode');

DELETE FROM items
WHERE id IN (SELECT copied_id FROM _bk_copied_records WHERE entity_type = 'item');

DELETE FROM categories
WHERE id IN (SELECT copied_id FROM _bk_copied_records WHERE entity_type = 'category');

DELETE FROM parties
WHERE id IN (SELECT copied_id FROM _bk_copied_records WHERE entity_type = 'party');

-- ----------------------------------------------------------------------------
-- 5. RESTORE ORIGINAL branch_id VALUES FROM BACKUP TABLE
-- ----------------------------------------------------------------------------
-- Invoices: set NULL for records that were originally NULL
UPDATE invoices inv
SET branch_id = NULL
WHERE NOT EXISTS (
  SELECT 1 FROM _bk_migration_branch_backfill b
  WHERE b.table_name = 'invoices' AND b.record_id = inv.id
);

-- Shifts
UPDATE shifts s
SET branch_id = NULL
WHERE NOT EXISTS (
  SELECT 1 FROM _bk_migration_branch_backfill b
  WHERE b.table_name = 'shifts' AND b.record_id = s.id
);

-- Payments
UPDATE payments p
SET branch_id = NULL
WHERE NOT EXISTS (
  SELECT 1 FROM _bk_migration_branch_backfill b
  WHERE b.table_name = 'payments' AND b.record_id = p.id
);

-- Stock moves
UPDATE stock_moves sm
SET branch_id = NULL
WHERE NOT EXISTS (
  SELECT 1 FROM _bk_migration_branch_backfill b
  WHERE b.table_name = 'stock_moves' AND b.record_id = sm.id
);

-- Items
UPDATE items i
SET branch_id = NULL
WHERE NOT EXISTS (
  SELECT 1 FROM _bk_migration_branch_backfill b
  WHERE b.table_name = 'items' AND b.record_id = i.id
);

-- Categories, parties, promotions
UPDATE categories SET branch_id = NULL;
UPDATE parties SET branch_id = NULL;
UPDATE promotions SET branch_id = NULL;
UPDATE product_barcodes SET branch_id = NULL;
UPDATE stock_adjustments SET branch_id = NULL;
UPDATE stock_counts SET branch_id = NULL;
UPDATE number_series SET branch_id = NULL;
UPDATE payment_allocations SET branch_id = NULL;
UPDATE credit_allocations SET branch_id = NULL;
UPDATE supplier_payment_allocations SET branch_id = NULL;

-- ----------------------------------------------------------------------------
-- 6. RESTORE ORIGINAL UNIQUE INDEXES
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS categories_branch_name_uq;
DROP INDEX IF EXISTS items_branch_barcode_uq;
DROP INDEX IF EXISTS product_barcodes_tenant_branch;
DROP INDEX IF EXISTS parties_tenant_branch_phone;

DROP INDEX IF EXISTS idx_invoices_tenant_branch;
DROP INDEX IF EXISTS idx_shifts_tenant_branch;
DROP INDEX IF EXISTS idx_payments_tenant_branch;
DROP INDEX IF EXISTS idx_stock_moves_tenant_branch;
DROP INDEX IF EXISTS idx_items_tenant_branch;
DROP INDEX IF EXISTS idx_categories_tenant_branch;
DROP INDEX IF EXISTS idx_parties_tenant_branch;
DROP INDEX IF EXISTS idx_expenses_tenant_branch;
DROP INDEX IF EXISTS idx_purchases_tenant_branch;
DROP INDEX IF EXISTS idx_cash_movements_tenant_branch;
DROP INDEX IF EXISTS idx_product_barcodes_tenant_branch;
DROP INDEX IF EXISTS idx_stock_adjustments_tenant_branch;
DROP INDEX IF EXISTS idx_stock_counts_tenant_branch;
DROP INDEX IF EXISTS idx_promotions_tenant_branch;
DROP INDEX IF EXISTS idx_number_series_tenant_branch;

CREATE UNIQUE INDEX IF NOT EXISTS categories_name_uq ON categories (tenant_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS items_barcode_uq ON items (tenant_id, barcode) WHERE barcode IS NOT NULL AND barcode != '';
CREATE UNIQUE INDEX IF NOT EXISTS product_barcodes_uq ON product_barcodes (tenant_id, barcode);
CREATE INDEX IF NOT EXISTS idx_parties_phone ON parties (tenant_id, phone);

-- ----------------------------------------------------------------------------
-- 7. CLEANUP BACKUP TABLES
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS _bk_copied_records;
DROP TABLE IF EXISTS _bk_migration_branch_backfill;

COMMIT;

