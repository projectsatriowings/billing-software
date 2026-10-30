import type { Queryable } from './db/index.ts';
import { j } from './db/index.ts';
import type { Ctx } from './http.ts';
import { newId } from './security.ts';

export interface AuditEntry {
  action: string; // e.g. 'user.create', 'shop.update', 'auth.login'
  entity?: string;
  entityId?: string;
  detail?: Record<string, unknown>;
  reason?: string;
  /** Needed only when there is no signed-in user on the request (register, failed login). */
  tenantId?: string;
  userId?: string | null;
  userName?: string | null;
}

/**
 * Append one business audit event. Call it with the transaction handle (`q`) so the event is saved
 * or rolled back together with the change it describes. Rows are only ever inserted, never updated.
 */
export async function audit(q: Queryable, ctx: Pick<Ctx, 'user' | 'requestId'>, e: AuditEntry): Promise<void> {
  const tenantId = e.tenantId ?? ctx.user?.tenantId;
  if (!tenantId) return;
  try {
    await q.exec(
      `INSERT INTO audit_log (id, tenant_id, user_id, user_name, action, entity, entity_id, detail, reason, correlation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?)`,
      [newId('a'), tenantId, e.userId ?? ctx.user?.id ?? null, e.userName ?? ctx.user?.name ?? null, e.action, e.entity ?? null, e.entityId ?? null, j(e.detail ?? {}), e.reason ?? null, ctx.requestId],
    );
  } catch (err) {
    console.warn('[audit] non-fatal audit log write failed:', err);
  }
}
