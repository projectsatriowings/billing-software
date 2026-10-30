import '../server/src/env.ts';
import { connectDb } from '../server/src/db/index.ts';
import { newId } from '../server/src/security.ts';
import { j } from '../server/src/db/index.ts';

async function seedPromotions() {
  const db = await connectDb();
  const tenantId = 't_demo_supermarket';

  const user = await db.one<{ id: string }>('SELECT id FROM users WHERE tenant_id = ? LIMIT 1', [tenantId]);
  const userId = user?.id || null;

  const item = await db.one<{ id: string; name: string; sku: string; price_minor: number }>(
    "SELECT id, name, sku, price_minor FROM items WHERE tenant_id = ? AND lower(name) LIKE '%marie%' LIMIT 1",
    [tenantId]
  );

  const itemId = item?.id || 'item_biscuit_marie';
  const itemName = item?.name || 'Britannia Marie Gold Family Pack';

  // Clear existing
  await db.exec('DELETE FROM promotions WHERE tenant_id = ?', [tenantId]);

  // 1. Buy 2 Get 1 Free (Active)
  await db.exec(
    `INSERT INTO promotions (
      id, tenant_id, name, description, type, status, start_date, end_date,
      branches, counters, rules, customer_eligibility_type, eligible_customer_ids,
      max_total_usage, max_usage_per_customer, current_usage_count, show_banner_on_pos,
      allow_stacking, min_bill_amount_minor, max_discount_minor, created_by
    ) VALUES (?, ?, ?, ?, 'bogo', 'active', '2026-10-01', '2026-11-30',
      '["ALL"]'::jsonb, '["ALL"]'::jsonb, ?::jsonb, 'all', '[]'::jsonb,
      500, 3, 0, true, true, 0, null, ?)`,
    [
      'promo_bogo_marie',
      tenantId,
      'Buy 2 Get 1 Free',
      'Buy 2 Britannia Marie Gold, get 1 free automatically',
      j({
        qualifyingProductId: itemId,
        qualifyingProductName: itemName,
        qualifyingQty: 2,
        freeProductId: itemId,
        freeProductName: itemName,
        freeQty: 1,
        sameProduct: true,
        maxFreePerBill: 5,
      }),
      userId,
    ]
  );

  // 2. 10% Off on Snacks Category (Active)
  await db.exec(
    `INSERT INTO promotions (
      id, tenant_id, name, description, type, status, start_date, end_date,
      branches, counters, rules, customer_eligibility_type, eligible_customer_ids,
      max_total_usage, max_usage_per_customer, current_usage_count, show_banner_on_pos,
      allow_stacking, min_bill_amount_minor, max_discount_minor, created_by
    ) VALUES (?, ?, ?, ?, 'category_discount', 'active', '2026-10-01', '2026-11-30',
      '["ALL"]'::jsonb, '["ALL"]'::jsonb, ?::jsonb, 'all', '[]'::jsonb,
      null, null, 0, true, true, 0, null, ?)`,
    [
      'promo_snacks_pct',
      tenantId,
      '10% Off on Snacks & Biscuits',
      'Flat 10% instant discount across all Snacks category items',
      j({
        categoryNames: ['Snacks'],
        discountPct: 10,
        minPurchaseQty: 1,
      }),
      userId,
    ]
  );

  // 3. Scheduled Mega Sale
  await db.exec(
    `INSERT INTO promotions (
      id, tenant_id, name, description, type, status, start_date, end_date,
      branches, counters, rules, customer_eligibility_type, eligible_customer_ids,
      max_total_usage, max_usage_per_customer, current_usage_count, show_banner_on_pos,
      allow_stacking, min_bill_amount_minor, max_discount_minor, created_by
    ) VALUES (?, ?, ?, ?, 'bill_level', 'scheduled', '2026-11-15', '2026-12-05',
      '["ALL"]'::jsonb, '["ALL"]'::jsonb, ?::jsonb, 'all', '[]'::jsonb,
      null, null, 0, true, false, 50000, null, ?)`,
    [
      'promo_diwali_bill',
      tenantId,
      'Mega Festive Saver: ₹50 Off on ₹500+',
      'Spend ₹500 or more to get flat ₹50 bill discount',
      j({
        minBillAmountMinor: 50000,
        discountAmountMinor: 5000,
      }),
      userId,
    ]
  );

  // 4. Expired Promotion (Matches screenshot: "28 Sept 2026 - 23 Oct 2026")
  await db.exec(
    `INSERT INTO promotions (
      id, tenant_id, name, description, type, status, start_date, end_date,
      branches, counters, rules, customer_eligibility_type, eligible_customer_ids,
      max_total_usage, max_usage_per_customer, current_usage_count, show_banner_on_pos,
      allow_stacking, min_bill_amount_minor, max_discount_minor, created_by
    ) VALUES (?, ?, ?, ?, 'bogo', 'expired', '2026-09-28', '2026-10-23',
      '["ALL"]'::jsonb, '["ALL"]'::jsonb, ?::jsonb, 'all', '[]'::jsonb,
      100, 1, 42, true, false, 0, null, ?)`,
    [
      'promo_milk_bogo',
      tenantId,
      'Buy 2 Get 1 Free',
      'Milk Products Special Offer',
      j({
        qualifyingCategoryId: 'Dairy Products',
        qualifyingQty: 2,
        freeCategoryId: 'Dairy Products',
        freeQty: 1,
        sameProduct: true,
      }),
      userId,
    ]
  );

  console.log('✅ Seeded demo promotions for t_demo_supermarket');
  await db.close();
}

seedPromotions().catch((err) => {
  console.error('Seed promotions failed:', err);
  process.exit(1);
});
