import { can, type Perm } from '../../shared/types.ts';
import { forbidden, unauthorized, type AuthUser, type Ctx, type Handler } from './http.ts';
import { passwordStamp, verifyToken } from './security.ts';

/**
 * Reads the "Authorization: Bearer <token>" header. Returns null (never throws) when there is no valid session,
 * so public routes keep working even if the browser still holds an old token.
 * The user is re-read from the database on every request, so switching a user off or changing a role
 * or password takes effect immediately.
 */
export function makeAuthenticator(secret: string) {
  return async (ctx: Ctx): Promise<AuthUser | null> => {
    let tokenStr: string | null = null;
    const h = ctx.req.headers.authorization;
    if (h && h.startsWith('Bearer ')) {
      tokenStr = h.slice(7).trim();
    } else if (ctx.query && typeof ctx.query.token === 'string' && ctx.query.token.trim()) {
      tokenStr = ctx.query.token.trim();
    }
    if (!tokenStr) return null;
    const p = verifyToken(tokenStr, secret);
    if (!p) return null;
    const u = await ctx.db.one<any>(
      'SELECT * FROM users WHERE id = ? AND tenant_id = ?',
      [p.sub, p.tid],
    );
    if (!u || !u.active || passwordStamp(u.passwordHash) !== p.ph) return null;
    const parseAllowed = (v: any): string[] | null => {
      if (Array.isArray(v)) return v;
      if (typeof v === 'string') {
        try { const parsed = JSON.parse(v); return Array.isArray(parsed) ? parsed : [v]; } catch { return [v]; }
      }
      return null;
    };
    const assignedLocation = u.assignedLocation || u.assigned_location || 'MAIN';
    const assignedCounter = u.assignedCounter || u.assigned_counter || 'COUNTER-1';
    const allowedLocations = parseAllowed(u.allowedLocations || u.allowed_locations) || [assignedLocation];
    return {
      id: u.id,
      tenantId: u.tenantId,
      name: u.name,
      role: u.role,
      email: u.email,
      assignedLocation,
      assignedCounter,
      allowedLocations,
      branchId: u.branchId || u.branch_id || null,
      username: u.username || null,
      counterId: u.counterId || u.counter_id || null,
    };
  };
}

/** Route guard: any signed-in user. */
export const requireUser: Handler = (ctx) => {
  if (!ctx.user) throw unauthorized();
};

/** Route guard: signed in AND allowed to do `perm` (the same table the client uses to hide buttons). */
export const requirePerm = (perm: Perm): Handler => (ctx) => {
  if (!ctx.user) throw unauthorized();
  if (!can(ctx.user.role, perm)) throw forbidden('You do not have permission to do this. Ask the shop owner.', 'FORBIDDEN', { needs: perm });
};
