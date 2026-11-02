import '../server/src/env.ts';
import { connectDb } from '../server/src/db/index.ts';

export async function migration46Down() {
  const db = await connectDb();
  console.log('Rolling back Migration 46...');
  try {
    await db.tx(async (q) => {
      // 1. Drop composite indexes
      const compositeIndexes = [
        'idx_categories_tenant_branch',
        'idx_items_tenant_branch',
        'idx_parties_tenant_branch',
        'idx_invoices_tenant_branch',
        'idx_payments_tenant_branch',
        'idx_shifts_tenant_branch',
        'idx_stock_moves_tenant_branch',
        'idx_purchases_tenant_branch',
        'idx_expenses_tenant_branch',
        'idx_cash_movements_tenant_branch',
        'idx_promotions_tenant_branch',
        'idx_product_barcodes_tenant_branch',
        'idx_stock_adjustments_tenant_branch',
        'idx_stock_counts_tenant_branch',
        'idx_payment_allocations_tenant_branch',
        'idx_credit_allocations_tenant_branch',
        'idx_supplier_payment_allocations_tenant_branch',
        'idx_number_series_tenant_branch',
        'idx_invoice_lines_tenant_branch',
        'idx_purchase_lines_tenant_branch',
        'idx_stock_count_lines_tenant_branch',
      ];
      for (const idx of compositeIndexes) {
        await q.exec(`DROP INDEX IF EXISTS ${idx}`);
      }

      // 2. Drop branch unique indexes
      await q.exec(`DROP INDEX IF EXISTS categories_branch_name_uq`);
      await q.exec(`DROP INDEX IF EXISTS items_branch_barcode_uq`);
      await q.exec(`DROP INDEX IF EXISTS product_barcodes_branch_barcode_uq`);
      await q.exec(`DROP INDEX IF EXISTS items_branch_sku_uq`);
      await q.exec(`DROP INDEX IF EXISTS parties_branch_phone_customer_uq`);
      await q.exec(`DROP INDEX IF EXISTS parties_branch_gstin_supplier_uq`);

      // 3. Re-create old indexes
      await q.exec(`CREATE UNIQUE INDEX IF NOT EXISTS categories_name_uq ON categories (tenant_id, lower(name))`);
      await q.exec(`CREATE UNIQUE INDEX IF NOT EXISTS items_barcode_uq ON items (tenant_id, barcode) WHERE barcode IS NOT NULL AND barcode <> ''`);
      await q.exec(`CREATE UNIQUE INDEX IF NOT EXISTS product_barcodes_uq ON product_barcodes (tenant_id, barcode)`);
      await q.exec(`CREATE INDEX IF NOT EXISTS items_sku ON items (tenant_id, sku)`);
      await q.exec(`CREATE INDEX IF NOT EXISTS idx_parties_phone ON parties (tenant_id, phone)`);

      // 4. Restore number_series PK
      await q.exec(`ALTER TABLE number_series DROP CONSTRAINT IF EXISTS number_series_pkey`);
      await q.exec(`ALTER TABLE number_series ADD PRIMARY KEY (tenant_id, series)`);
      await q.exec(`ALTER TABLE number_series DROP COLUMN IF EXISTS branch_id`);

      // 5. Drop NOT NULL on existing branch_id columns
      const existingTables = [
        'items',
        'parties',
        'invoices',
        'payments',
        'shifts',
        'stock_moves',
        'purchases',
        'expenses',
        'cash_movements',
      ];
      for (const tbl of existingTables) {
        await q.exec(`ALTER TABLE ${tbl} ALTER COLUMN branch_id DROP NOT NULL`);
      }

      // 6. Drop added branch_id columns
      const addedTables = [
        'categories',
        'promotions',
        'product_barcodes',
        'stock_adjustments',
        'stock_counts',
        'stock_count_lines',
        'payment_allocations',
        'credit_allocations',
        'supplier_payment_allocations',
        'invoice_lines',
        'purchase_lines',
      ];
      for (const tbl of addedTables) {
        await q.exec(`ALTER TABLE ${tbl} DROP COLUMN IF EXISTS branch_id`);
      }

      // 7. Re-create branch_inventory table and view
      await q.exec(`
        CREATE TABLE IF NOT EXISTS branch_inventory (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id),
          branch_id TEXT NOT NULL REFERENCES branches(id),
          item_id TEXT NOT NULL REFERENCES items(id),
          stock_milli BIGINT NOT NULL DEFAULT 0,
          shelf_bin TEXT,
          selling_price_minor BIGINT,
          reorder_level_milli BIGINT DEFAULT 0,
          active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (branch_id, item_id)
        )
      `);

      await q.exec(`
        CREATE OR REPLACE VIEW v_branch_inventory AS
        SELECT b.code AS branch_code,
           b.name AS branch_name,
           i.name AS product_name,
           i.category,
           i.barcode,
           COALESCE(((bi.stock_milli)::numeric / 1000.0), (0)::numeric) AS on_hand_qty,
           ((COALESCE(bi.selling_price_minor, i.price_minor))::numeric / 100.0) AS selling_price_rs,
           bi.shelf_bin
          FROM ((branches b
            CROSS JOIN items i)
            LEFT JOIN branch_inventory bi ON (((bi.branch_id = b.id) AND (bi.item_id = i.id))))
         WHERE ((i.active = true) AND ((i.branch_id IS NULL) OR (i.branch_id = b.id)))
      `);

      // 8. Remove version 46 from schema_migrations
      await q.exec('DELETE FROM schema_migrations WHERE version = 46');
    });
    console.log('✅ Migration 46 rolled back successfully!');
  } finally {
    await db.close();
  }
}

if (process.argv[1]?.endsWith('migration-46-down.mjs')) {
  migration46Down().catch((err) => {
    console.error('Rollback error:', err);
    process.exit(1);
  });
}

