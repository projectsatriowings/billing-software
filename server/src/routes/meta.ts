import { BUSINESS_TYPES, PERMS, ROLES } from '../../../shared/types.ts';
import { PACKS } from '../../../shared/packs.ts';
import { STATES } from '../../../shared/states.ts';
import { HttpError, type Router } from '../http.ts';

/** Public routes: a health check for hosting, and the lists the sign-up screen needs. */
export function registerMeta(r: Router) {
  r.get('/api/health', async (ctx) => {
    try {
      await ctx.db.one('SELECT 1 AS ok');
    } catch {
      throw new HttpError(503, 'DB_DOWN', 'The database is not reachable right now');
    }
    return { ok: true, db: 'up', driver: ctx.db.driver, time: new Date().toISOString() };
  });

  r.get('/api/meta', () => ({
    roles: ROLES,
    perms: PERMS,
    businessTypes: BUSINESS_TYPES,
    states: STATES,
    languages: [{ id: 'en', name: 'English' }, { id: 'ta', name: 'தமிழ்' }, { id: 'hi', name: 'हिन्दी' }],
    packs: PACKS.map((p) => ({ id: p.id, name: p.name, blurb: p.blurb })),
  }));
}
