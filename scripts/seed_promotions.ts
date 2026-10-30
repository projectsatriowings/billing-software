import '../server/src/env.ts';
import { connectDb } from '../server/src/db/index.ts';
import { j } from '../server/src/db/index.ts';

async function seedPromotions() {
  const db = await connectDb();
  const tenantId = 't_demo_supermarket';

  const user = await db.one<{ id: string }>('SELECT id FROM users WHERE tenant_id = ? LIMIT 1', [tenantId]);
  const userId = user?.id || null;

  // Clear existing promotions for demo tenant
  await db.exec('DELETE FROM promotion_usage WHERE tenant_id = ?', [tenantId]);
  await db.exec('DELETE FROM promotions WHERE tenant_id = ?', [tenantId]);

  // 1. Active: Buy 1 Get 1 Free - Britannia Marie Gold
  await db.exec(
    `INSERT INTO promotions (
      id, tenant_id, name, description, type, status, start_date, end_date,
      branches, counters, rules, customer_eligibility_type, eligible_customer_ids,
      max_total_usage, max_usage_per_customer, current_usage_count, show_banner_on_pos,
      allow_stacking, min_bill_amount_minor, max_discount_minor, created_by
    ) VALUES (?, ?, ?, ?, 'bogo', 'active', '2026-10-30', '2026-11-29',
      '["ALL"]'::jsonb, '["ALL"]'::jsonb, ?::jsonb, 'all', '[]'::jsonb,
      500, 3, 0, true, true, 0, null, ?)`,
    [
      'promo_bogo_marie',
      tenantId,
      'Buy 1 Get 1 Free',
      'Buy 1 Britannia Marie Gold, get 1 free automatically',
      j({
        qualifyingProductId: 'item_biscuit_marie',
        qualifyingProductName: 'Britannia Marie Gold Family Pack',
        qualifyingQty: 1,
        freeProductId: 'item_biscuit_marie',
        freeProductName: 'Britannia Marie Gold Family Pack',
        freeQty: 1,
        sameProduct: true,
        maxFreePerBill: 5,
      }),
      userId,
    ]
  );

  // 2. Scheduled: Diwali Mega Saver
  await db.exec(
    `INSERT INTO promotions (
      id, tenant_id, name, description, type, status, start_date, end_date,
      branches, counters, rules, customer_eligibility_type, eligible_customer_ids,
      max_total_usage, max_usage_per_customer, current_usage_count, show_banner_on_pos,
      allow_stacking, min_bill_amount_minor, max_discount_minor, created_by
    ) VALUES (?, ?, ?, ?, 'bill_level', 'scheduled', '2026-11-15', '2026-12-15',
      '["ALL"]'::jsonb, '["ALL"]'::jsonb, ?::jsonb, 'all', '[]'::jsonb,
      null, null, 0, true, false, 100000, null, ?)`,
    [
      'promo_scheduled_diwali',
      tenantId,
      'Diwali Mega Saver: ₹100 Off',
      'Spend ₹1,000 or more to get flat ₹100 bill discount',
      j({
        minBillAmountMinor: 100000,
        discountAmountMinor: 10000,
      }),
      userId,
    ]
  );

  // 3. Expired: Weekend Special 10% Off
  await db.exec(
    `INSERT INTO promotions (
      id, tenant_id, name, description, type, status, start_date, end_date,
      branches, counters, rules, customer_eligibility_type, eligible_customer_ids,
      max_total_usage, max_usage_per_customer, current_usage_count, show_banner_on_pos,
      allow_stacking, min_bill_amount_minor, max_discount_minor, created_by
    ) VALUES (?, ?, ?, ?, 'percentage', 'expired', '2026-09-01', '2026-09-30',
      '["ALL"]'::jsonb, '["ALL"]'::jsonb, ?::jsonb, 'all', '[]'::jsonb,
      100, 1, 42, true, false, 0, null, ?)`,
    [
      'promo_expired_weekend',
      tenantId,
      'Weekend Special 10% Off',
      'Special 10% off on Atta',
      j({
        discountPct: 10,
        productId: 'item_atta_5k',
        productName: 'Aashirvaad Shudh Chakki Atta (5kg)',
      }),
      userId,
    ]
  );

  console.log('✅ Seeded demo promotions matching reference screenshot (1 Active, 1 Scheduled, 1 Expired, 0 Draft)');
  await db.close();
}

seedPromotions().catch((err) => {
  console.error('Seed promotions failed:', err);
  process.exit(1);
});
