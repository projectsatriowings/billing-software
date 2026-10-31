import { requirePerm, requireUser } from '../auth.ts';
import { bad, notFound, forbidden, V, type Router } from '../http.ts';
import { newId } from '../security.ts';
import { j } from '../db/index.ts';
import { audit } from '../audit.ts';
import {
  evaluatePromotions,
  type Promotion,
  type PromotionInput,
  type PromotionType,
  type PromotionStatus,
  type CartItemForEval,
} from '../../../shared/promotions.ts';

function rowToPromotion(r: any): Promotion {
  return {
    id: r.id,
    tenantId: r.tenantId ?? r.tenant_id,
    name: r.name,
    description: r.description || null,
    type: r.type as PromotionType,
    status: r.status as PromotionStatus,
    startDate: r.startDate ?? r.start_date,
    endDate: r.endDate ?? r.end_date,
    branches: Array.isArray(r.branches) ? r.branches : (typeof r.branches === 'string' ? JSON.parse(r.branches) : ['ALL']),
    counters: Array.isArray(r.counters) ? r.counters : (typeof r.counters === 'string' ? JSON.parse(r.counters) : ['ALL']),
    rules: typeof r.rules === 'string' ? JSON.parse(r.rules) : (r.rules || {}),
    customerEligibilityType: (r.customerEligibilityType ?? r.customer_eligibility_type ?? 'all') as 'all' | 'selected',
    eligibleCustomerIds: Array.isArray(r.eligibleCustomerIds ?? r.eligible_customer_ids)
      ? (r.eligibleCustomerIds ?? r.eligible_customer_ids)
      : (typeof (r.eligibleCustomerIds ?? r.eligible_customer_ids) === 'string' ? JSON.parse(r.eligibleCustomerIds ?? r.eligible_customer_ids) : []),
    maxTotalUsage: r.maxTotalUsage ?? r.max_total_usage ?? null,
    maxUsagePerCustomer: r.maxUsagePerCustomer ?? r.max_usage_per_customer ?? null,
    currentUsageCount: Number(r.currentUsageCount ?? r.current_usage_count ?? 0),
    showBannerOnPos: Boolean(r.showBannerOnPos ?? r.show_banner_on_pos ?? true),
    allowStacking: Boolean(r.allowStacking ?? r.allow_stacking ?? false),
    minBillAmountMinor: Number(r.minBillAmountMinor ?? r.min_bill_amount_minor ?? 0),
    maxDiscountMinor: (r.maxDiscountMinor ?? r.max_discount_minor) !== null ? Number(r.maxDiscountMinor ?? r.max_discount_minor) : null,
    createdBy: r.createdBy ?? r.created_by ?? null,
    createdAt: r.createdAt ?? r.created_at,
    updatedAt: r.updatedAt ?? r.updated_at,
  };
}

export function registerPromotions(r: Router) {
  // 1. List promotions with stats & filters
  r.get('/api/promotions', requirePerm('promotions.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const role = ctx.user!.role;
    const search = (ctx.query.search ?? '').trim().toLowerCase();
    const typeFilter = (ctx.query.type ?? '').trim();
    const statusFilter = (ctx.query.status ?? '').trim().toLowerCase();
    const branchFilter = (ctx.query.branch ?? '').trim();
    const today = new Date().toISOString().slice(0, 10);

    // Auto-update expired / scheduled statuses
    await ctx.db.exec(
      `UPDATE promotions
       SET status = 'expired', updated_at = now()
       WHERE tenant_id = ? AND status = 'active' AND end_date < ?`,
      [tenantId, today]
    );

    let sql = 'SELECT * FROM promotions WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];

    // Branch authorization for Store Managers
    if (role === 'manager') {
      const allowed = ctx.user!.allowedLocations?.length
        ? ctx.user!.allowedLocations
        : [ctx.user!.assignedLocation || 'MAIN'];
      // Manager can see promotions where branches contains 'ALL' or any of their allowed branches
      // Use jsonb_exists_any() function to prevent `?` operator collision with `toPgPlaceholders`
      sql += ` AND (branches @> '["ALL"]'::jsonb OR jsonb_exists_any(branches, ARRAY[${allowed.map(() => '?').join(', ')}]::text[]))`;
      params.push(...allowed);
    }

    if (search) {
      sql += ' AND lower(name) LIKE ?';
      params.push(`%${search}%`);
    }

    if (typeFilter && typeFilter !== 'ALL') {
      sql += ' AND type = ?';
      params.push(typeFilter);
    }

    if (statusFilter && statusFilter !== 'all') {
      sql += ' AND status = ?';
      params.push(statusFilter);
    }

    if (branchFilter && branchFilter !== 'ALL') {
      sql += ` AND (branches @> '["ALL"]'::jsonb OR branches @> ?)`;
      params.push(JSON.stringify([branchFilter]));
    }

    sql += ' ORDER BY created_at DESC';

    const rows = await ctx.db.query(sql, params);
    const promotions = rows.map(rowToPromotion);

    // Calculate aggregated metrics
    const allPromos = await ctx.db.query<{
      status: string;
      startDate: string;
      endDate: string;
      currentUsageCount: number;
    }>(
      'SELECT status, start_date AS "startDate", end_date AS "endDate", current_usage_count AS "currentUsageCount" FROM promotions WHERE tenant_id = ?',
      [tenantId]
    );

    let activeCount = 0;
    let scheduledCount = 0;
    let expiredCount = 0;
    let draftCount = 0;
    let pausedCount = 0;

    for (const p of allPromos) {
      if (p.status === 'draft') draftCount++;
      else if (p.status === 'paused') pausedCount++;
      else if (p.status === 'expired' || p.endDate < today) expiredCount++;
      else if (p.startDate > today) scheduledCount++;
      else activeCount++;
    }

    // Query promotion usage stats
    const usageStats = await ctx.db.one<{ totalDiscountMinor?: number; salesGeneratedMinor?: number }>(
      `SELECT 
         COALESCE(SUM(pu.discount_minor), 0)::bigint AS "totalDiscountMinor",
         COALESCE(SUM(i.total_minor), 0)::bigint AS "salesGeneratedMinor"
       FROM promotion_usage pu
       JOIN invoices i ON i.id = pu.invoice_id
       WHERE pu.tenant_id = ? AND i.status = 'posted'`,
      [tenantId]
    );

    return {
      promotions,
      summary: {
        totalPromotions: allPromos.length,
        activePromotions: activeCount,
        scheduledPromotions: scheduledCount,
        expiredPromotions: expiredCount,
        draftPromotions: draftCount,
        pausedPromotions: pausedCount,
        totalDiscountGivenMinor: Number(usageStats?.totalDiscountMinor ?? 0),
        salesGeneratedMinor: Number(usageStats?.salesGeneratedMinor ?? 0),
      },
    };
  });

  // 9. Promotion Reports and Analytics
  r.get('/api/promotions/reports', requirePerm('promotions.reports'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const role = ctx.user!.role;
    const period = ctx.query.period || 'this_month';
    const branchFilter = ctx.query.branch || '';
    const typeFilter = ctx.query.type || '';

    let startDate = '';
    let endDate = '';
    const now = new Date();

    if (period === 'today') {
      startDate = now.toISOString().slice(0, 10);
      endDate = startDate;
    } else if (period === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 86400000);
      startDate = weekAgo.toISOString().slice(0, 10);
      endDate = now.toISOString().slice(0, 10);
    } else if (period === 'custom' && ctx.query.startDate && ctx.query.endDate) {
      startDate = ctx.query.startDate;
      endDate = ctx.query.endDate;
    } else {
      // Month
      startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      endDate = now.toISOString().slice(0, 10);
    }

    let whereClause = `WHERE pu.tenant_id = ? AND i.status = 'posted' AND i.bdate >= ? AND i.bdate <= ?`;
    const params: unknown[] = [tenantId, startDate, endDate];

    if (role === 'manager') {
      const allowed = ctx.user!.allowedLocations || [ctx.user!.assignedLocation || 'MAIN'];
      whereClause += ` AND pu.branch IN (${allowed.map(() => '?').join(', ')})`;
      params.push(...allowed);
    } else if (branchFilter && branchFilter !== 'ALL') {
      whereClause += ` AND pu.branch = ?`;
      params.push(branchFilter);
    }

    if (typeFilter && typeFilter !== 'ALL') {
      whereClause += ` AND p.type = ?`;
      params.push(typeFilter);
    }

    // Consolidated overview
    const overview = await ctx.db.one<{
      totalDiscountsMinor?: number;
      billsCount?: number;
      revenueMinor?: number;
    }>(
      `SELECT 
         COALESCE(SUM(pu.discount_minor), 0)::bigint AS "totalDiscountsMinor",
         COUNT(DISTINCT pu.invoice_id)::int AS "billsCount",
         COALESCE(SUM(i.total_minor), 0)::bigint AS "revenueMinor"
       FROM promotion_usage pu
       JOIN invoices i ON i.id = pu.invoice_id
       JOIN promotions p ON p.id = pu.promotion_id
       ${whereClause}`,
      params
    );

    // Most used promotions
    const mostUsed = await ctx.db.query<{
      promotionId: string;
      name: string;
      type: string;
      usageCount: number;
      totalDiscountMinor: number;
      revenueGeneratedMinor: number;
    }>(
      `SELECT 
         p.id AS "promotionId",
         p.name,
         p.type,
         COUNT(pu.id)::int AS "usageCount",
         COALESCE(SUM(pu.discount_minor), 0)::bigint AS "totalDiscountMinor",
         COALESCE(SUM(i.total_minor), 0)::bigint AS "revenueGeneratedMinor"
       FROM promotion_usage pu
       JOIN promotions p ON p.id = pu.promotion_id
       JOIN invoices i ON i.id = pu.invoice_id
       ${whereClause}
       GROUP BY p.id, p.name, p.type
       ORDER BY "usageCount" DESC
       LIMIT 10`,
      params
    );

    // Branch performance
    const branchPerformance = await ctx.db.query<{
      branch: string;
      usageCount: number;
      totalDiscountMinor: number;
      totalSalesMinor: number;
    }>(
      `SELECT 
         COALESCE(pu.branch, 'MAIN') AS "branch",
         COUNT(pu.id)::int AS "usageCount",
         COALESCE(SUM(pu.discount_minor), 0)::bigint AS "totalDiscountMinor",
         COALESCE(SUM(i.total_minor), 0)::bigint AS "totalSalesMinor"
       FROM promotion_usage pu
       JOIN invoices i ON i.id = pu.invoice_id
       JOIN promotions p ON p.id = pu.promotion_id
       ${whereClause}
       GROUP BY COALESCE(pu.branch, 'MAIN')
       ORDER BY "usageCount" DESC`,
      params
    );

    // Daily timeline for charts
    const timeline = await ctx.db.query<{
      bdate: string;
      usageCount: number;
      discountMinor: number;
      salesMinor: number;
    }>(
      `SELECT 
         i.bdate,
         COUNT(pu.id)::int AS "usageCount",
         COALESCE(SUM(pu.discount_minor), 0)::bigint AS "discountMinor",
         COALESCE(SUM(i.total_minor), 0)::bigint AS "salesMinor"
       FROM promotion_usage pu
       JOIN invoices i ON i.id = pu.invoice_id
       JOIN promotions p ON p.id = pu.promotion_id
       ${whereClause}
       GROUP BY i.bdate
       ORDER BY i.bdate ASC`,
      params
    );

    // Promotion totals count
    const totalPromosCount = await ctx.db.one<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM promotions WHERE tenant_id = ?',
      [tenantId]
    );
    const activePromosCount = await ctx.db.one<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM promotions WHERE tenant_id = ? AND status = 'active' AND start_date <= ? AND end_date >= ?`,
      [tenantId, now.toISOString().slice(0, 10), now.toISOString().slice(0, 10)]
    );

    return {
      overview: {
        totalDiscountMinor: Number(overview?.totalDiscountsMinor ?? 0),
        billsCount: Number(overview?.billsCount ?? 0),
        revenueMinor: Number(overview?.revenueMinor ?? 0),
        totalPromotionsCount: Number(totalPromosCount?.count ?? 0),
        activePromotionsCount: Number(activePromosCount?.count ?? 0),
      },
      mostUsedPromotions: mostUsed,
      branchPerformance,
      timeline,
    };
  });

  // 2. Get single promotion
  r.get('/api/promotions/:id', requirePerm('promotions.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const promo = await ctx.db.one('SELECT * FROM promotions WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!promo) throw notFound('Promotion');
    return { promotion: rowToPromotion(promo) };
  });

  // 3. Create promotion
  r.post('/api/promotions', requirePerm('promotions.write'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const role = ctx.user!.role;
    const b = ctx.body ?? {};

    const name = V.str(b.name, 'Promotion name', { required: true, max: 120 });
    const description = V.optStr(b.description, 'Description', 500);
    const type = V.oneOf(b.type, 'Promotion type', [
      'percentage',
      'fixed_amount',
      'bogo',
      'buy_x_get_y_discount',
      'category_discount',
      'product_discount',
      'min_purchase',
      'quantity_based',
      'bill_level',
    ] as const, 'percentage');

    const startDate = V.str(b.startDate, 'Start date', { required: true, min: 10, max: 10 });
    const endDate = V.str(b.endDate, 'End date', { required: true, min: 10, max: 10 });
    if (endDate < startDate) throw bad('End date cannot be earlier than start date');

    const branches = Array.isArray(b.branches) && b.branches.length > 0 ? b.branches : ['ALL'];
    const counters = Array.isArray(b.counters) && b.counters.length > 0 ? b.counters : ['ALL'];

    // If manager, enforce branch assignment
    if (role === 'manager' && !branches.includes('ALL')) {
      const allowed = ctx.user!.allowedLocations || [ctx.user!.assignedLocation || 'MAIN'];
      const unauthorized = branches.some((br: string) => !allowed.includes(br));
      if (unauthorized) throw forbidden('You cannot create promotions for branches outside your assignment');
    }

    const rules = (typeof b.rules === 'object' && b.rules !== null) ? b.rules : {};
    const customerEligibilityType = V.oneOf(b.customerEligibilityType ?? 'all', 'Customer eligibility', ['all', 'selected'] as const, 'all');
    const eligibleCustomerIds = Array.isArray(b.eligibleCustomerIds) ? b.eligibleCustomerIds : [];
    const maxTotalUsage = b.maxTotalUsage ? Math.max(1, V.int(b.maxTotalUsage, 'Max total usage')) : null;
    const maxUsagePerCustomer = b.maxUsagePerCustomer ? Math.max(1, V.int(b.maxUsagePerCustomer, 'Max usage per customer')) : null;
    const showBannerOnPos = b.showBannerOnPos !== false;
    const allowStacking = Boolean(b.allowStacking);
    const minBillAmountMinor = Math.max(0, V.int(b.minBillAmountMinor ?? 0, 'Min bill amount'));
    const maxDiscountMinor = b.maxDiscountMinor ? Math.max(0, V.int(b.maxDiscountMinor, 'Max discount')) : null;

    // Status: draft, scheduled, or active based on start date
    let status: PromotionStatus = b.status || 'active';
    const today = new Date().toISOString().slice(0, 10);
    if (status !== 'draft' && status !== 'paused') {
      if (today < startDate) status = 'scheduled';
      else if (today > endDate) status = 'expired';
      else status = 'active';
    }

    const id = newId('promo');
    await ctx.db.exec(
      `INSERT INTO promotions (
        id, tenant_id, name, description, type, status, start_date, end_date,
        branches, counters, rules, customer_eligibility_type, eligible_customer_ids,
        max_total_usage, max_usage_per_customer, current_usage_count, show_banner_on_pos,
        allow_stacking, min_bill_amount_minor, max_discount_minor, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?::jsonb, ?, ?, 0, ?, ?, ?, ?, ?)`,
      [
        id,
        tenantId,
        name,
        description || null,
        type,
        status,
        startDate,
        endDate,
        j(branches),
        j(counters),
        j(rules),
        customerEligibilityType,
        j(eligibleCustomerIds),
        maxTotalUsage,
        maxUsagePerCustomer,
        showBannerOnPos,
        allowStacking,
        minBillAmountMinor,
        maxDiscountMinor,
        ctx.user!.id,
      ]
    );

    await audit(ctx.db, ctx, {
      entity: 'config',
      action: 'create',
      entityId: id,
      detail: { summary: `Created promotion ${name} (${type})` },
    });

    const created = await ctx.db.one('SELECT * FROM promotions WHERE id = ?', [id]);
    return { promotion: rowToPromotion(created) };
  });

  // 4. Update promotion
  r.put('/api/promotions/:id', requirePerm('promotions.write'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const existing = await ctx.db.one('SELECT * FROM promotions WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!existing) throw notFound('Promotion');

    const b = ctx.body ?? {};
    const name = V.str(b.name, 'Promotion name', { required: true, max: 120 });
    const description = V.optStr(b.description, 'Description', 500);
    const startDate = V.str(b.startDate, 'Start date', { required: true, min: 10, max: 10 });
    const endDate = V.str(b.endDate, 'End date', { required: true, min: 10, max: 10 });
    if (endDate < startDate) throw bad('End date cannot be earlier than start date');

    const branches = Array.isArray(b.branches) && b.branches.length > 0 ? b.branches : ['ALL'];
    const counters = Array.isArray(b.counters) && b.counters.length > 0 ? b.counters : ['ALL'];
    const rules = (typeof b.rules === 'object' && b.rules !== null) ? b.rules : {};
    const customerEligibilityType = V.oneOf(b.customerEligibilityType ?? 'all', 'Customer eligibility', ['all', 'selected'] as const, 'all');
    const eligibleCustomerIds = Array.isArray(b.eligibleCustomerIds) ? b.eligibleCustomerIds : [];
    const maxTotalUsage = b.maxTotalUsage ? Math.max(1, V.int(b.maxTotalUsage, 'Max total usage')) : null;
    const maxUsagePerCustomer = b.maxUsagePerCustomer ? Math.max(1, V.int(b.maxUsagePerCustomer, 'Max usage per customer')) : null;
    const showBannerOnPos = b.showBannerOnPos !== false;
    const allowStacking = Boolean(b.allowStacking);
    const minBillAmountMinor = Math.max(0, V.int(b.minBillAmountMinor ?? 0, 'Min bill amount'));
    const maxDiscountMinor = b.maxDiscountMinor ? Math.max(0, V.int(b.maxDiscountMinor, 'Max discount')) : null;

    let status: PromotionStatus = b.status || existing.status;
    const today = new Date().toISOString().slice(0, 10);
    if (status !== 'draft' && status !== 'paused') {
      if (today < startDate) status = 'scheduled';
      else if (today > endDate) status = 'expired';
      else status = 'active';
    }

    await ctx.db.exec(
      `UPDATE promotions SET
        name = ?, description = ?, status = ?, start_date = ?, end_date = ?,
        branches = ?::jsonb, counters = ?::jsonb, rules = ?::jsonb,
        customer_eligibility_type = ?, eligible_customer_ids = ?::jsonb,
        max_total_usage = ?, max_usage_per_customer = ?, show_banner_on_pos = ?,
        allow_stacking = ?, min_bill_amount_minor = ?, max_discount_minor = ?,
        updated_at = now()
       WHERE id = ? AND tenant_id = ?`,
      [
        name,
        description || null,
        status,
        startDate,
        endDate,
        j(branches),
        j(counters),
        j(rules),
        customerEligibilityType,
        j(eligibleCustomerIds),
        maxTotalUsage,
        maxUsagePerCustomer,
        showBannerOnPos,
        allowStacking,
        minBillAmountMinor,
        maxDiscountMinor,
        existing.id,
        tenantId,
      ]
    );

    const updated = await ctx.db.one('SELECT * FROM promotions WHERE id = ?', [existing.id]);
    return { promotion: rowToPromotion(updated) };
  });

  // 5. Duplicate promotion
  r.post('/api/promotions/:id/duplicate', requirePerm('promotions.write'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const orig = await ctx.db.one('SELECT * FROM promotions WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!orig) throw notFound('Promotion');

    const newPromoId = newId('promo');
    const newName = `${orig.name} (Copy)`;

    await ctx.db.exec(
      `INSERT INTO promotions (
        id, tenant_id, name, description, type, status, start_date, end_date,
        branches, counters, rules, customer_eligibility_type, eligible_customer_ids,
        max_total_usage, max_usage_per_customer, current_usage_count, show_banner_on_pos,
        allow_stacking, min_bill_amount_minor, max_discount_minor, created_by
      ) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?::jsonb, ?, ?, 0, ?, ?, ?, ?, ?)`,
      [
        newPromoId,
        tenantId,
        newName,
        orig.description,
        orig.type,
        orig.start_date,
        orig.end_date,
        j(orig.branches),
        j(orig.counters),
        j(orig.rules),
        orig.customer_eligibility_type,
        j(orig.eligible_customer_ids),
        orig.max_total_usage,
        orig.max_usage_per_customer,
        orig.show_banner_on_pos,
        orig.allow_stacking,
        orig.min_bill_amount_minor,
        orig.max_discount_minor,
        ctx.user!.id,
      ]
    );

    const dup = await ctx.db.one('SELECT * FROM promotions WHERE id = ?', [newPromoId]);
    return { promotion: rowToPromotion(dup) };
  });

  // 6. Update promotion status (Pause / Activate / Expire)
  r.patch('/api/promotions/:id/status', requirePerm('promotions.write'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};
    const newStatus = V.oneOf(b.status, 'Status', ['draft', 'scheduled', 'active', 'paused', 'expired'] as const, 'active');

    const promo = await ctx.db.one('SELECT * FROM promotions WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!promo) throw notFound('Promotion');

    await ctx.db.exec(
      'UPDATE promotions SET status = ?, updated_at = now() WHERE id = ? AND tenant_id = ?',
      [newStatus, promo.id, tenantId]
    );

    const updated = await ctx.db.one('SELECT * FROM promotions WHERE id = ?', [promo.id]);
    return { promotion: rowToPromotion(updated) };
  });

  // 7. Delete promotion
  r.delete('/api/promotions/:id', requirePerm('promotions.write'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const promo = await ctx.db.one('SELECT * FROM promotions WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!promo) throw notFound('Promotion');

    await ctx.db.exec('DELETE FROM promotions WHERE id = ? AND tenant_id = ?', [promo.id, tenantId]);
    await audit(ctx.db, ctx, {
      entity: 'config',
      action: 'delete',
      entityId: promo.id,
      detail: { summary: `Deleted promotion ${promo.name}` },
    });

    return { success: true };
  });

  // 8. Authoritative POS promotion evaluation
  r.post('/api/promotions/evaluate', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};
    const cart: CartItemForEval[] = Array.isArray(b.cart) ? b.cart : [];
    const partyId = V.optStr(b.partyId, 'Party ID', 50);
    const branchCode = V.optStr(b.branch, 'Branch', 50) || ctx.user!.assignedLocation || 'MAIN';
    const counterCode = V.optStr(b.counter, 'Counter', 50) || ctx.user!.assignedCounter || 'COUNTER-1';
    const today = new Date().toISOString().slice(0, 10);

    // Fetch all active promotions for this tenant
    const rows = await ctx.db.query(
      `SELECT * FROM promotions
       WHERE tenant_id = ? AND status = 'active' AND start_date <= ? AND end_date >= ?`,
      [tenantId, today, today]
    );
    const activePromotions = rows.map(rowToPromotion);

    // If customer partyId is known, check their previous usage of these promotions
    const customerUsageMap: Record<string, number> = {};
    if (partyId && activePromotions.length > 0) {
      const usageRows = await ctx.db.query<{ promotionId: string; usageCount: number }>(
        `SELECT promotion_id AS "promotionId", COUNT(*)::int AS "usageCount"
         FROM promotion_usage
         WHERE tenant_id = ? AND party_id = ?
         GROUP BY promotion_id`,
        [tenantId, partyId]
      );
      for (const u of usageRows) {
        customerUsageMap[u.promotionId] = u.usageCount;
      }
    }

    const result = evaluatePromotions(cart, activePromotions, {
      dateStr: today,
      branchCode,
      counterCode,
      partyId: partyId || undefined,
      customerUsageMap,
    });

    return result;
  });

}
