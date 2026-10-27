import type { Router } from '../http.ts';
import { requirePerm } from '../auth.ts';
import { searchHsnSac, suggestHsnForProduct } from '../services/hsnService.ts';

export function registerHsn(r: Router): void {
  /**
   * Search HSN & SAC codes by keyword or code prefix
   * GET /api/hsn/search?q=rice&limit=20
   */
  r.get('/api/hsn/search', async (ctx) => {
    const q = (ctx.query.q || '').toString();
    const limit = Math.min(Number(ctx.query.limit || 20), 50);
    const results = searchHsnSac(q, limit);
    return { q, results, total: results.length };
  });

  /**
   * Suggest HSN code based on product name and category
   * GET /api/hsn/suggest?name=Basmati%20Rice&category=Grains
   */
  r.get('/api/hsn/suggest', async (ctx) => {
    const name = (ctx.query.name || '').toString();
    const category = (ctx.query.category || '').toString();
    const suggestions = suggestHsnForProduct(name, category);
    return { name, category, suggestions };
  });
}
