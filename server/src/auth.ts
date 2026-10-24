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
    const h = ctx.req.headers.authorization;
    if (!h || !h.startsWith('Bearer ')) return null;
    const p = verifyToken(h.slice(7).trim(), secret);
    if (!p) return null;
    const u = await ctx.db.one<{ id: string; tenantId: string; name: string; email: string; role: AuthUser['role']; active: boolean; passwordHash: string }>(
      'SELECT id, tenant_id, name, email, role, active, password_hash FROM users WHERE id = ? AND tenant_id = ?',
      [p.sub, p.tid],
    );
    if (!u || !u.active || passwordStamp(u.passwordHash) !== p.ph) return null;
    return { id: u.id, tenantId: u.tenantId, name: u.name, role: u.role, email: u.email };
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
