import type { Ctx } from './http.ts';
import { bad, unauthorized } from './http.ts';

export interface BranchScope {
  branchId: string | null;
  isSuperAdminAll: boolean;
}

/**
 * Resolves the active branch scope for the current request.
 * - Super Admin (owner):
 *     - If query param 'branch' / 'branchId' / 'branchCode' or header 'x-branch-id' is 'all' or empty:
 *       returns { branchId: null, isSuperAdminAll: true }
 *     - If specific branch ID or Code is provided:
 *       resolves to canonical branch ID and returns { branchId, isSuperAdminAll: false }
 * - Non-Super-Admin (manager, cashier, accountant, etc.):
 *     - Strictly scoped to their assigned user.branchId or user.assignedLocation:
 *       returns { branchId: canonicalBranchId, isSuperAdminAll: false }
 *     - If user has no branch linked, throws 400 NO_BRANCH error.
 */
export async function resolveBranchScope(ctx: Ctx): Promise<BranchScope> {
  if (!ctx.user) throw unauthorized();

  const user = ctx.user;
  const isSuperAdmin = user.role === 'owner' || String(user.role).toUpperCase() === 'SUPER_ADMIN';

  if (!isSuperAdmin) {
    const rawBranch = user.branchId || user.assignedLocation;
    if (!rawBranch) {
      throw bad("Your account isn't linked to a branch. Contact your admin.", 'NO_BRANCH');
    }
    const br = await ctx.db.one<{ id: string }>(
      'SELECT id FROM branches WHERE tenant_id = ? AND (id = ? OR UPPER(code) = UPPER(?)) AND (deleted_at IS NULL OR active = true) LIMIT 1',
      [user.tenantId, rawBranch, rawBranch],
    );
    return {
      branchId: br?.id ?? rawBranch,
      isSuperAdminAll: false,
    };
  }

  // Super Admin view
  const rawParam = (
    (ctx.query?.branch as string) ||
    (ctx.query?.branchId as string) ||
    (ctx.query?.branchCode as string) ||
    (ctx.req?.headers?.['x-branch-id'] as string) ||
    ''
  ).trim();

  if (!rawParam || rawParam.toLowerCase() === 'all' || ['true', 'false', 'undefined', 'null'].includes(rawParam.toLowerCase())) {
    return {
      branchId: null,
      isSuperAdminAll: true,
    };
  }

  // If rawParam is a branch code (e.g. 'MAIN', 'SKS_POR', 'SKS_TNAGAR'), resolve to canonical branch ID
  const br = await ctx.db.one<{ id: string }>(
    'SELECT id FROM branches WHERE tenant_id = ? AND (id = ? OR UPPER(code) = UPPER(?)) AND (deleted_at IS NULL OR active = true) LIMIT 1',
    [user.tenantId, rawParam, rawParam],
  );

  return {
    branchId: br?.id ?? rawParam,
    isSuperAdminAll: false,
  };
}
