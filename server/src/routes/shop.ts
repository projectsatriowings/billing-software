import { audit } from '../audit.ts';
import { requirePerm, requireUser } from '../auth.ts';
import { j } from '../db/index.ts';
import { conflict, notFound, type Router } from '../http.ts';
import { parseShopFields, shopFromRow, shopView, type ShopFields } from '../shopFields.ts';

/** Shop profile: any signed-in user can read it; only the owner (permission "settings") can change it. */
export function registerShop(r: Router) {
  r.get('/api/shop', requireUser, async (ctx) => {
    const t = await ctx.db.one('SELECT * FROM tenants WHERE id = ?', [ctx.user!.tenantId]);
    if (!t) throw notFound('Shop');
    return shopView(t);
  });

  r.put('/api/shop', requirePerm('settings'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    return ctx.db.tx(async (q) => {
      const row = await q.one('SELECT * FROM tenants WHERE id = ? FOR UPDATE', [tenantId]);
      if (!row) throw notFound('Shop');
      const cur = shopFromRow(row);
      const next = parseShopFields(ctx.body ?? {}, cur);

      // A location that already holds stock history cannot be removed (stock would become unreachable).
      for (const loc of cur.locations.filter((l) => !next.locations.includes(l))) {
        const used = await q.one('SELECT 1 AS x FROM stock_moves WHERE tenant_id = ? AND location = ? LIMIT 1', [tenantId, loc]);
        if (used) throw conflict(`Location "${loc}" already has stock records, so it cannot be removed.`, 'LOCATION_IN_USE', { location: loc });
      }

      const changed: Record<string, { from: unknown; to: unknown }> = {};
      for (const k of Object.keys(next) as (keyof ShopFields)[]) {
        if (JSON.stringify(cur[k]) !== JSON.stringify(next[k])) changed[k] = { from: cur[k], to: next[k] };
      }
      if (!Object.keys(changed).length) return shopView(row);

      await q.exec(
        `UPDATE tenants SET name = ?, business_type = ?, gstin = ?, state_code = ?, address = ?, phone = ?, upi_id = ?, invoice_prefix = ?, language = ?, locations = ?::jsonb, whatsapp_enabled = ?, whatsapp_default_lang = ?, whatsapp_include_link = ? WHERE id = ?`,
        [next.name, next.businessType, next.gstin, next.stateCode, next.address, next.phone, next.upiId, next.invoicePrefix, next.language, j(next.locations), next.whatsappEnabled, next.whatsappDefaultLang, next.whatsappIncludeLink, tenantId],
      );
      await audit(q, ctx, { action: 'shop.update', entity: 'tenant', entityId: tenantId, detail: { changed } });
      return shopView(await q.one('SELECT * FROM tenants WHERE id = ?', [tenantId]));
    });
  });
}
