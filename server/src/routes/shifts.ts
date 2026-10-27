import { requirePerm, requireUser } from '../auth.ts';
import { bad, forbidden, notFound, HtmlResponse, V, type Router } from '../http.ts';
import { newId } from '../security.ts';
import { j, type Queryable } from '../db/index.ts';
import { audit } from '../audit.ts';
import {
  calcExpectedCash,
  calcShiftVariance,
  classifyVariance,
  compileShiftSummary,
  renderShiftClosingReportHtml,
  type RawPaymentItem,
} from '../../../shared/shifts.ts';
import type { CashMovement, Shift, ShiftClosingReport, ShiftSummary } from '../../../shared/types.ts';

/**
 * Computes authoritative financial metrics for a shift from database records.
 * Integrates:
 * 1. Payments (cash & non-cash collections from POS and Khata)
 * 2. Cash movements (authorized cash-in & cash-out)
 * 3. Cash refunds paid from the drawer on sales returns
 */
export async function computeShiftFinancials(
  q: Queryable,
  shift: any,
  tenantId: string,
  countedCashMinor?: number | null,
  targetBdate?: string | null,
): Promise<{
  summary: ShiftSummary;
  cashMovements: CashMovement[];
  recentTransactions: any[];
  refundsRows: any[];
}> {
  const shiftId = shift.id;
  const shiftUserId = shift.userId ?? shift.user_id;
  const openedAt = shift.openedAt ?? shift.opened_at ?? new Date(0).toISOString();
  const closedAt = shift.closedAt ?? shift.closed_at ?? new Date().toISOString();
  const openingCashMinor = Number(shift.openingCashMinor ?? shift.opening_cash_minor ?? 0);

  // Authoritative shop/tenant timezone determination
  const tenant = await q.one<any>(
    'SELECT timezone FROM tenants WHERE id = ?',
    [tenantId],
  );
  const tz = tenant?.timezone || 'Asia/Kolkata';

  let businessDate = targetBdate;
  if (!businessDate) {
    if (shift.status === 'closed' && (shift.closedAt || shift.closed_at)) {
      const closedAtDate = new Date(shift.closedAt ?? shift.closed_at);
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      businessDate = formatter.format(closedAtDate);
    } else {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      businessDate = formatter.format(now);
    }
  }

  // 1. Fetch eligible payments (both POS checkouts and Khata collections)
  // Authoritative filtering rules:
  // - Tenant isolation strictly enforced
  // - Scoped to this active cashier shift and cashier user
  // - Completed/posted payments only (exclude reversed)
  // - Completed/posted sales invoices only (exclude cancelled or non-sale)
  // - Scoped to the current business day (bdate / shop timezone) to prevent leakage of past days
  // - Split payments cleanly handled: each cash payment line item counted accurately
  const paymentsRows = await q.query<any>(
    `SELECT 
      p.id,
      p.amount_minor,
      COALESCE(p.mode, p.method, 'cash') AS method,
      p.status,
      p.kind,
      p.invoice_id,
      p.created_at,
      p.reference,
      i.number AS invoice_number,
      i.kind AS invoice_kind,
      c.name AS customer_name
     FROM payments p
     LEFT JOIN invoices i ON i.id = p.invoice_id
     LEFT JOIN parties c ON c.id = p.customer_id
     WHERE p.tenant_id = ?
       AND (p.status IS NULL OR p.status = 'posted')
       AND (p.invoice_id IS NULL OR (i.status = 'posted' AND i.kind = 'sale'))
       AND COALESCE(p.kind, 'receipt') = 'receipt'
       AND (
         (p.invoice_id IS NOT NULL AND (i.bdate = ? OR (i.created_at AT TIME ZONE ?)::date = ?::date))
         OR
         (p.invoice_id IS NULL AND (p.bdate = ? OR (p.created_at AT TIME ZONE ?)::date = ?::date))
       )
       AND (
         (p.shift_id = ? AND (p.created_by = ? OR p.created_by IS NULL))
         OR (
           p.shift_id IS NULL
           AND p.created_by = ?
           AND p.created_at >= ?
           AND p.created_at <= ?
         )
       )
     ORDER BY p.created_at DESC`,
    [
      tenantId,
      businessDate, tz, businessDate,
      businessDate, tz, businessDate,
      shiftId,
      shiftUserId,
      shiftUserId,
      openedAt,
      closedAt,
    ],
  );

  const rawPayments: RawPaymentItem[] = paymentsRows.map((r: any) => ({
    method: r.method,
    amountMinor: Number(r.amountMinor ?? r.amount_minor ?? 0),
    status: r.status,
    kind: r.kind,
    isInvoiceCheckout: Boolean(r.invoiceId ?? r.invoice_id),
  }));

  // 2. Fetch cash movements (Cash-In & Cash-Out)
  // Scoped strictly to this active shift and tenant without destructive timestamp/date filtering
  const cashMovesRows = await q.query<any>(
    `SELECT 
      cm.id,
      cm.tenant_id,
      cm.shift_id,
      cm.movement_type,
      cm.amount_minor,
      cm.reason,
      cm.notes,
      cm.created_by,
      u.name AS created_by_name,
      cm.created_at
     FROM cash_movements cm
     LEFT JOIN users u ON u.id = cm.created_by
     WHERE cm.tenant_id = ? AND cm.shift_id = ?
     ORDER BY cm.created_at ASC`,
    [tenantId, shiftId],
  );

  let cashInMinor = 0;
  let cashOutMinor = 0;
  const cashMovements: CashMovement[] = cashMovesRows.map((cm: any) => {
    const amt = Number(cm.amountMinor ?? cm.amount_minor ?? 0);
    const mType = (cm.movementType ?? cm.movement_type ?? '').toLowerCase();
    if (mType === 'cash_in' || mType === 'in') cashInMinor += amt;
    else if (mType === 'cash_out' || mType === 'out') cashOutMinor += amt;

    return {
      id: cm.id,
      tenantId: cm.tenantId ?? cm.tenant_id,
      shiftId: cm.shiftId ?? cm.shift_id,
      movementType: mType === 'cash_out' || mType === 'out' ? 'cash_out' : 'cash_in',
      amountMinor: amt,
      reason: cm.reason,
      notes: cm.notes ?? null,
      createdBy: cm.createdBy ?? cm.created_by,
      createdByName: cm.createdByName ?? cm.created_by_name,
      createdAt: cm.createdAt ?? cm.created_at,
    };
  });

  // 3. Fetch cash refunds paid from the drawer on credit notes
  // Scoped to the business day and active cashier
  const refundsRows = await q.query<any>(
    `SELECT 
      cn.id,
      cn.number,
      cn.refund_amount_minor,
      COALESCE(cn.refund_mode, 'cash') AS refund_mode,
      cn.customer_name,
      cn.created_at
     FROM invoices cn
     WHERE cn.tenant_id = ?
       AND cn.kind = 'credit_note'
       AND cn.status = 'posted'
       AND cn.refund_amount_minor > 0
       AND COALESCE(cn.refund_mode, 'cash') = 'cash'
       AND (cn.bdate = ? OR (cn.created_at AT TIME ZONE ?)::date = ?::date)
       AND (cn.created_by = ? OR cn.created_by IS NULL)
     ORDER BY cn.created_at DESC`,
    [tenantId, businessDate, tz, businessDate, shiftUserId],
  );

  let cashRefundsMinor = 0;
  for (const rf of refundsRows) {
    cashRefundsMinor += Number(rf.refundAmountMinor ?? rf.refund_amount_minor ?? 0);
  }

  // 4. Invoices and credit sales stats created during this shift on this business day
  const salesStatsRow = await q.one<any>(
    `SELECT 
      COUNT(*)::int AS invoices_count,
      COALESCE(SUM(total_minor), 0)::bigint AS total_sales_billed_minor,
      COALESCE(SUM(balance_minor), 0)::bigint AS credit_sales_unpaid_minor
     FROM invoices
     WHERE tenant_id = ?
       AND kind = 'sale'
       AND status = 'posted'
       AND (bdate = ? OR (created_at AT TIME ZONE ?)::date = ?::date)
       AND (created_by = ? OR created_by IS NULL)`,
    [tenantId, businessDate, tz, businessDate, shiftUserId],
  );

  const totalSalesBilledMinor = Number(salesStatsRow?.totalSalesBilledMinor ?? salesStatsRow?.total_sales_billed_minor ?? 0);
  const creditSalesUnpaidMinor = Number(salesStatsRow?.creditSalesUnpaidMinor ?? salesStatsRow?.credit_sales_unpaid_minor ?? 0);
  const invoicesCount = Number(salesStatsRow?.invoicesCount ?? salesStatsRow?.invoices_count ?? 0);

  // Compile summary
  const summary = compileShiftSummary({
    openingCashMinor,
    payments: rawPayments,
    cashInMinor,
    cashOutMinor,
    cashRefundsMinor,
    totalSalesBilledMinor,
    creditSalesUnpaidMinor,
    invoicesCount,
    returnsCount: refundsRows.length,
    cashMovesCount: cashMovements.length,
    countedCashMinor,
  });

  // Recent transactions list for report
  const recentTransactions = paymentsRows.slice(0, 20).map((p: any) => ({
    id: p.id,
    number: p.invoiceNumber ?? p.invoice_number ?? p.id,
    type: 'sale' as const,
    method: p.method,
    amountMinor: Number(p.amountMinor ?? p.amount_minor),
    customerName: p.customerName ?? p.customer_name ?? null,
    createdAt: p.createdAt ?? p.created_at,
  }));

  return { summary, cashMovements, recentTransactions, refundsRows };
}

export function registerShifts(r: Router) {
  // 1. Open a new cashier shift
  r.post('/api/shifts', requirePerm('shift'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;
    const userId = ctx.user!.id;

    const openingCashMinor = V.int(b.openingCashMinor ?? 0, 'Opening cash float (paise)', { min: 0 });
    const location = V.optStr(b.location, 'Location', 50) || ctx.user!.assignedLocation || 'MAIN';
    const counter = V.optStr(b.counter, 'Counter', 50) || ctx.user!.assignedCounter || 'COUNTER-1';
    const notes = V.optStr(b.notes, 'Opening notes', 500);

    return ctx.db.tx(async (q) => {
      // 1. Enforce one active shift per cashier: check if cashier already has an active shift
      const active = await q.one<any>(
        'SELECT id, shift_number FROM shifts WHERE tenant_id = ? AND user_id = ? AND status = \'open\'',
        [tenantId, userId],
      );
      if (active) {
        const activeNum = active.shiftNumber ?? active.shift_number ?? active.id;
        throw bad(
          `You already have an active shift open (${activeNum}). Please close your active shift before opening a new one.`,
          'ACTIVE_SHIFT_EXISTS',
        );
      }

      // 2. Generate sequential shift number (SHF-1001) using number_series
      const seriesRow = await q.one<{ assignedNo?: number; assigned_no?: number }>(
        `INSERT INTO number_series (tenant_id, series, next_no)
         VALUES (?, 'SHF', 2)
         ON CONFLICT (tenant_id, series) DO UPDATE SET next_no = number_series.next_no + 1
         RETURNING (next_no - 1) AS assigned_no`,
        [tenantId],
      );
      const seqNo = Number(seriesRow?.assignedNo ?? seriesRow?.assigned_no ?? 1);
      const shiftNumber = `SHF-${1000 + seqNo}`;

      const shiftId = newId('shf');
      const now = new Date().toISOString();

      await q.exec(
        `INSERT INTO shifts (
          id, tenant_id, shift_number, user_id, status,
          opened_at, opening_cash_minor, location, counter, note,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)`,
        [
          shiftId,
          tenantId,
          shiftNumber,
          userId,
          now,
          openingCashMinor,
          location,
          counter,
          notes || null,
          now,
          now,
        ],
      );

      await audit(q, ctx, {
        action: 'shift.open',
        entity: 'shift',
        entityId: shiftId,
        detail: { shiftNumber, openingCashMinor, location, counter },
      });

      return {
        ok: true,
        shift: {
          id: shiftId,
          shiftNumber,
          userId,
          userName: ctx.user!.name,
          location,
          counter,
          status: 'open',
          openedAt: now,
          openingCashMinor,
          note: notes || null,
        },
      };
    });
  });

  // 2. Get active shift for current cashier (with owner/manager fallback)
  r.get('/api/shifts/active', requirePerm('shift'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const userId = ctx.user!.id;
    const isManagerOrOwner = ['owner', 'manager', 'accountant'].includes(ctx.user!.role);
    const counterParam = (ctx.query.counter as string || ctx.query.location as string || '').trim();

    let sql = `SELECT s.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
       FROM shifts s
       JOIN users u ON u.id = s.user_id
       WHERE s.tenant_id = ? AND s.user_id = ? AND s.status = 'open'`;
    const params: any[] = [tenantId, userId];

    if (counterParam) {
      sql += ' AND (s.location = ? OR s.location = ?)';
      params.push(counterParam, counterParam === 'Counter 1' ? 'MAIN' : counterParam);
    }
    sql += ' ORDER BY s.opened_at DESC LIMIT 1';

    let shift = await ctx.db.one<any>(sql, params);

    // If an owner, manager, or accountant doesn't have an active shift opened by themselves, find the open shift for this tenant
    if (!shift && isManagerOrOwner) {
      let fallbackSql = `SELECT s.*, u.name AS user_name, u.email AS user_email, u.role AS user_role
         FROM shifts s
         JOIN users u ON u.id = s.user_id
         WHERE s.tenant_id = ? AND s.status = 'open'`;
      const fallbackParams: any[] = [tenantId];
      if (counterParam) {
        fallbackSql += ' AND (s.location = ? OR s.location = ?)';
        fallbackParams.push(counterParam, counterParam === 'Counter 1' ? 'MAIN' : counterParam);
      }
      fallbackSql += ' ORDER BY s.opened_at DESC LIMIT 1';

      shift = await ctx.db.one<any>(fallbackSql, fallbackParams);
    }

    if (!shift) {
      return { ok: true, activeShift: null };
    }

    // Compute live real-time totals
    const { summary, cashMovements } = await computeShiftFinancials(ctx.db, shift, tenantId);

    return {
      ok: true,
      activeShift: {
        id: shift.id,
        shiftNumber: shift.shiftNumber ?? shift.shift_number,
        userId: shift.userId ?? shift.user_id,
        userName: shift.userName ?? shift.user_name,
        userEmail: shift.userEmail ?? shift.user_email,
        userRole: shift.userRole ?? shift.user_role,
        location: shift.location || 'MAIN',
        status: shift.status,
        openedAt: shift.openedAt ?? shift.opened_at,
        openingCashMinor: Number(shift.openingCashMinor ?? shift.opening_cash_minor ?? 0),
        note: shift.note,
        summary,
        cashMovements,
      },
    };
  });

  // 3. List shifts history
  r.get('/api/shifts', requirePerm('shift'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const userRole = ctx.user!.role;
    const isManagerOrOwner = ['owner', 'manager', 'accountant'].includes(userRole);

    const limit = Math.min(100, Math.max(1, Number(ctx.query.limit ?? 50)));
    const offset = Math.max(0, Number(ctx.query.offset ?? 0));
    const status = (ctx.query.status as string || 'all').trim().toLowerCase();
    const filterUserId = (ctx.query.userId as string || '').trim();
    const filterLocation = (ctx.query.location as string || '').trim();

    let whereSql = 'WHERE s.tenant_id = ?';
    const params: unknown[] = [tenantId];

    // Cashiers only see their own shifts; Managers see their assigned branches; Owners/Accountants see all
    if (!isManagerOrOwner) {
      whereSql += ' AND s.user_id = ?';
      params.push(ctx.user!.id);
    } else {
      if (userRole === 'manager') {
        const allowed = ctx.user!.allowedLocations || [ctx.user!.assignedLocation || 'MAIN'];
        whereSql += ` AND s.location IN (${allowed.map(() => '?').join(', ')})`;
        params.push(...allowed);
      }
      if (filterUserId) {
        whereSql += ' AND s.user_id = ?';
        params.push(filterUserId);
      }
      if (filterLocation && filterLocation !== 'ALL') {
        whereSql += ' AND s.location = ?';
        params.push(filterLocation);
      }
    }

    if (status === 'open' || status === 'closed') {
      whereSql += ' AND s.status = ?';
      params.push(status);
    }

    const totalRow = await ctx.db.one<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM shifts s ${whereSql}`,
      params,
    );

    const rows = await ctx.db.query<any>(
      `SELECT 
        s.*,
        u.name AS user_name,
        u.email AS user_email,
        u.role AS user_role,
        cu.name AS closed_by_name,
        ru.name AS reviewed_by_name
       FROM shifts s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN users cu ON cu.id = s.closed_by
       LEFT JOIN users ru ON ru.id = s.reviewed_by
       ${whereSql}
       ORDER BY s.opened_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return {
      total: Number(totalRow?.count ?? 0),
      limit,
      offset,
      shifts: rows.map((r: any) => {
        const rawSummary = r.summary;
        const parsedSummary = typeof rawSummary === 'string' ? JSON.parse(rawSummary) : rawSummary;
        return {
          id: r.id,
          shiftNumber: r.shiftNumber ?? r.shift_number,
          userId: r.userId ?? r.user_id,
          userName: r.userName ?? r.user_name,
          userEmail: r.userEmail ?? r.user_email,
          userRole: r.userRole ?? r.user_role,
          location: r.location || 'MAIN',
          counter: r.counter || 'COUNTER-1',
          status: r.status,
          openedAt: r.openedAt ?? r.opened_at,
          closedAt: r.closedAt ?? r.closed_at,
          openingCashMinor: Number(r.openingCashMinor ?? r.opening_cash_minor ?? 0),
          expectedCashMinor: r.expectedCashMinor !== null && r.expectedCashMinor !== undefined
            ? Number(r.expectedCashMinor ?? r.expected_cash_minor)
            : null,
          countedCashMinor: r.countedCashMinor !== null && r.countedCashMinor !== undefined
            ? Number(r.countedCashMinor ?? r.counted_cash_minor)
            : null,
          varianceMinor: r.varianceMinor !== null && r.varianceMinor !== undefined
            ? Number(r.varianceMinor ?? r.variance_minor)
            : null,
          note: r.note,
          closedBy: r.closedBy ?? r.closed_by,
          closedByName: r.closedByName ?? r.closed_by_name,
          reviewedBy: r.reviewedBy ?? r.reviewed_by,
          reviewedByName: r.reviewedByName ?? r.reviewed_by_name,
          reviewedAt: r.reviewedAt ?? r.reviewed_at,
          reviewNotes: r.reviewNotes ?? r.review_notes,
          summary: parsedSummary ?? null,
        };
      }),
    };
  });

  // 4. Get single shift details
  r.get('/api/shifts/:id', requirePerm('shift'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const isManagerOrOwner = ['owner', 'manager', 'accountant'].includes(ctx.user!.role);

    const shift = await ctx.db.one<any>(
      `SELECT 
        s.*,
        u.name AS user_name,
        u.email AS user_email,
        u.role AS user_role,
        cu.name AS closed_by_name,
        ru.name AS reviewed_by_name
       FROM shifts s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN users cu ON cu.id = s.closed_by
       LEFT JOIN users ru ON ru.id = s.reviewed_by
       WHERE s.id = ? AND s.tenant_id = ?`,
      [ctx.params.id, tenantId],
    );
    if (!shift) throw notFound('Shift');

    // Cashiers cannot inspect other cashiers' shifts
    if (!isManagerOrOwner && (shift.userId ?? shift.user_id) !== ctx.user!.id) {
      throw forbidden('You can only view your own cashier shifts.');
    }

    const storedSummary = shift.status === 'closed' && shift.summary
      ? (typeof shift.summary === 'string' ? JSON.parse(shift.summary) : shift.summary)
      : null;

    const { summary, cashMovements, recentTransactions, refundsRows } = await computeShiftFinancials(
      ctx.db,
      shift,
      tenantId,
      shift.countedCashMinor ?? shift.counted_cash_minor,
    );

    return {
      ok: true,
      shift: {
        id: shift.id,
        shiftNumber: shift.shiftNumber ?? shift.shift_number,
        userId: shift.userId ?? shift.user_id,
        userName: shift.userName ?? shift.user_name,
        userEmail: shift.userEmail ?? shift.user_email,
        userRole: shift.userRole ?? shift.user_role,
        location: shift.location || 'MAIN',
        status: shift.status,
        openedAt: shift.openedAt ?? shift.opened_at,
        closedAt: shift.closedAt ?? shift.closed_at,
        openingCashMinor: Number(shift.openingCashMinor ?? shift.opening_cash_minor ?? 0),
        expectedCashMinor: Number(shift.expectedCashMinor ?? shift.expected_cash_minor ?? summary.expectedCashMinor),
        countedCashMinor: shift.countedCashMinor !== null && shift.countedCashMinor !== undefined
          ? Number(shift.countedCashMinor ?? shift.counted_cash_minor)
          : null,
        varianceMinor: shift.varianceMinor !== null && shift.varianceMinor !== undefined
          ? Number(shift.varianceMinor ?? shift.variance_minor)
          : null,
        note: shift.note,
        closedBy: shift.closedBy ?? shift.closed_by,
        closedByName: shift.closedByName ?? shift.closed_by_name,
        reviewedBy: shift.reviewedBy ?? shift.reviewed_by,
        reviewedByName: shift.reviewedByName ?? shift.reviewed_by_name,
        reviewedAt: shift.reviewedAt ?? shift.reviewed_at,
        reviewNotes: shift.reviewNotes ?? shift.review_notes,
        summary: storedSummary ?? summary,
        cashMovements,
        recentTransactions,
      },
      movements: cashMovements,
      payments: recentTransactions,
      returns: refundsRows || [],
    };
  });

  // 5. Record Cash-In or Cash-Out Movement
  r.post('/api/shifts/:id/cash-moves', requirePerm('shift'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;
    const shiftId = ctx.params.id;
    const isManagerOrOwner = ['owner', 'manager', 'accountant'].includes(ctx.user!.role);

    const movementType = V.oneOf(b.movementType ?? b.type, 'Movement type', ['cash_in', 'cash_out'] as const);
    const amountMinor = V.int(b.amountMinor, 'Movement amount (paise)', { min: 1 });
    const reason = V.str(b.reason, 'Movement reason', { required: true, min: 2, max: 100 });
    const notes = V.optStr(b.notes, 'Notes', 500);

    return ctx.db.tx(async (q) => {
      // 1. Lock shift row to check status
      const shift = await q.one<any>(
        'SELECT s.* FROM shifts s WHERE s.id = ? AND s.tenant_id = ? FOR UPDATE',
        [shiftId, tenantId],
      );
      if (!shift) throw notFound('Shift');

      if (shift.status !== 'open') {
        throw bad('Cannot record cash movements on a closed shift.', 'SHIFT_CLOSED');
      }

      // Cashiers can only record cash moves on their own active shift
      if (!isManagerOrOwner && (shift.userId ?? shift.user_id) !== ctx.user!.id) {
        throw forbidden('Cashiers can only record cash movements on their own active shift.');
      }

      const moveId = newId('cm');
      const now = new Date().toISOString();

      await q.exec(
        `INSERT INTO cash_movements (
          id, tenant_id, shift_id, movement_type, amount_minor,
          reason, notes, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          moveId,
          tenantId,
          shiftId,
          movementType,
          amountMinor,
          reason,
          notes || null,
          ctx.user!.id,
          now,
        ],
      );

      await audit(q, ctx, {
        action: 'shift.cash_move',
        entity: 'cash_movement',
        entityId: moveId,
        detail: {
          shiftId,
          shiftNumber: shift.shiftNumber ?? shift.shift_number,
          movementType,
          amountMinor,
          reason,
        },
      });

      // Compute authoritative updated summary immediately inside transaction
      const { summary } = await computeShiftFinancials(q, shift, tenantId);

      return {
        ok: true,
        movement: {
          id: moveId,
          shiftId,
          movementType,
          amountMinor,
          reason,
          notes: notes || null,
          createdBy: ctx.user!.id,
          createdByName: ctx.user!.name,
          createdAt: now,
        },
        summary,
      };
    });
  });

  // 6. Day-End Close Shift
  r.post('/api/shifts/:id/close', requirePerm('shift'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;
    const shiftId = ctx.params.id;
    const isManagerOrOwner = ['owner', 'manager'].includes(ctx.user!.role);

    const countedCashMinor = V.int(b.countedCashMinor, 'Actual counted cash (paise)', { min: 0, required: true });
    const closingNote = V.optStr(b.note ?? b.closingNote, 'Closing notes', 500);
    const varianceReason = V.optStr(b.varianceReason, 'Discrepancy explanation reason', 500);

    return ctx.db.tx(async (q) => {
      // 1. Lock shift row FOR UPDATE to serialize concurrent close requests
      const shift = await q.one<any>(
        'SELECT * FROM shifts WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [shiftId, tenantId],
      );
      if (!shift) throw notFound('Shift');

      if (shift.status !== 'open') {
        throw bad(
          `Shift ${shift.shiftNumber ?? shift.shift_number ?? shiftId} is already closed.`,
          'SHIFT_ALREADY_CLOSED',
        );
      }

      // Cashiers can only close their own shift
      if (!isManagerOrOwner && (shift.userId ?? shift.user_id) !== ctx.user!.id) {
        throw forbidden('Cashiers can only close their own active shift.');
      }

      const now = new Date().toISOString();
      shift.closed_at = now;
      shift.closedAt = now;

      // 2. Recalculate authoritative totals inside the transaction lock
      const { summary } = await computeShiftFinancials(q, shift, tenantId, countedCashMinor);
      const expectedCashMinor = summary.expectedCashMinor;
      const varianceMinor = calcShiftVariance(countedCashMinor, expectedCashMinor);
      const classification = classifyVariance(varianceMinor);

      // 3. Mandatory reason required if there is any cash shortage or excess
      if (classification.requiresReason) {
        const combinedReason = (varianceReason || closingNote || '').trim();
        if (!combinedReason) {
          throw bad(
            `A mandatory explanation reason is required for a cash ${classification.type === 'shortage' ? 'shortage' : 'excess'} of ₹${(classification.absAmountMinor / 100).toFixed(2)}.`,
            'VARIANCE_REASON_REQUIRED',
            { varianceMinor, classification: classification.type },
          );
        }
      }

      summary.countedCashMinor = countedCashMinor;
      summary.varianceMinor = varianceMinor;

      const finalNote = closingNote
        ? (varianceReason ? `${closingNote} • Discrepancy Reason: ${varianceReason}` : closingNote)
        : varianceReason || null;

      // 4. Update shift status to closed
      await q.exec(
        `UPDATE shifts SET
          status = 'closed',
          closed_at = ?,
          closed_by = ?,
          expected_cash_minor = ?,
          counted_cash_minor = ?,
          variance_minor = ?,
          summary = ?::jsonb,
          note = ?,
          updated_at = ?
         WHERE id = ? AND tenant_id = ?`,
        [
          now,
          ctx.user!.id,
          expectedCashMinor,
          countedCashMinor,
          varianceMinor,
          j(summary),
          finalNote,
          now,
          shiftId,
          tenantId,
        ],
      );

      // 5. Backfill direct shift_id on any fallback payments to ensure permanent attribution
      const shiftUserId = shift.userId ?? shift.user_id;
      const openedAt = shift.openedAt ?? shift.opened_at;
      await q.exec(
        `UPDATE payments
         SET shift_id = ?
         WHERE tenant_id = ?
           AND shift_id IS NULL
           AND created_by = ?
           AND created_at >= ?
           AND created_at <= ?`,
        [shiftId, tenantId, shiftUserId, openedAt, now],
      );

      await audit(q, ctx, {
        action: 'shift.close',
        entity: 'shift',
        entityId: shiftId,
        detail: {
          shiftNumber: shift.shiftNumber ?? shift.shift_number,
          expectedCashMinor,
          countedCashMinor,
          varianceMinor,
          isBalanced: classification.isBalanced,
          note: finalNote,
        },
      });

      return {
        ok: true,
        shift: {
          id: shiftId,
          shiftNumber: shift.shiftNumber ?? shift.shift_number,
          status: 'closed',
          openedAt: shift.openedAt ?? shift.opened_at,
          closedAt: now,
          openingCashMinor: Number(shift.openingCashMinor ?? shift.opening_cash_minor ?? 0),
          expectedCashMinor,
          countedCashMinor,
          varianceMinor,
          summary,
          note: finalNote,
        },
      };
    });
  });

  // 7. Review and acknowledge discrepancy (Manager / Owner only)
  r.post('/api/shifts/:id/review', requirePerm('shift'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const shiftId = ctx.params.id;
    const isManagerOrOwner = ['owner', 'manager'].includes(ctx.user!.role);
    if (!isManagerOrOwner) {
      throw forbidden('Only Owners and Managers can review and approve shift discrepancies.');
    }

    const b = ctx.body ?? {};
    const reviewNotes = V.str(b.reviewNotes ?? b.notes, 'Review notes', { required: true, min: 3, max: 500 });

    return ctx.db.tx(async (q) => {
      const shift = await q.one<any>(
        'SELECT id, status, shift_number, variance_minor FROM shifts WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [shiftId, tenantId],
      );
      if (!shift) throw notFound('Shift');

      const now = new Date().toISOString();

      await q.exec(
        `UPDATE shifts SET
          reviewed_by = ?,
          reviewed_at = ?,
          review_notes = ?,
          updated_at = ?
         WHERE id = ? AND tenant_id = ?`,
        [
          ctx.user!.id,
          now,
          reviewNotes,
          now,
          shiftId,
          tenantId,
        ],
      );

      await audit(q, ctx, {
        action: 'shift.review',
        entity: 'shift',
        entityId: shiftId,
        detail: {
          shiftNumber: shift.shiftNumber ?? shift.shift_number,
          reviewNotes,
          reviewedBy: ctx.user!.name,
        },
      });

      return {
        ok: true,
        shiftId,
        reviewedBy: ctx.user!.name,
        reviewedAt: now,
        reviewNotes,
      };
    });
  });

  // 8. Day-End Closing Report (JSON and Printable HTML)
  r.get('/api/shifts/:id/report', requirePerm('shift'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const shiftId = ctx.params.id;
    const isManagerOrOwner = ['owner', 'manager', 'accountant'].includes(ctx.user!.role);
    const format = (ctx.query.format as string || '').toLowerCase();

    const shift = await ctx.db.one<any>(
      `SELECT 
        s.*,
        u.name AS user_name,
        u.email AS user_email,
        u.role AS user_role,
        cu.name AS closed_by_name,
        ru.name AS reviewed_by_name
       FROM shifts s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN users cu ON cu.id = s.closed_by
       LEFT JOIN users ru ON ru.id = s.reviewed_by
       WHERE s.id = ? AND s.tenant_id = ?`,
      [shiftId, tenantId],
    );
    if (!shift) throw notFound('Shift');

    if (!isManagerOrOwner && (shift.userId ?? shift.user_id) !== ctx.user!.id) {
      throw forbidden('You can only access closing reports for your own shifts.');
    }

    const storedSummary = shift.status === 'closed' && shift.summary
      ? (typeof shift.summary === 'string' ? JSON.parse(shift.summary) : shift.summary)
      : null;

    const { summary, cashMovements, recentTransactions } = await computeShiftFinancials(
      ctx.db,
      shift,
      tenantId,
      shift.countedCashMinor ?? shift.counted_cash_minor,
    );
    const finalSummary = storedSummary ?? summary;

    const shiftObj: Shift = {
      id: shift.id,
      shiftNumber: shift.shiftNumber ?? shift.shift_number,
      userId: shift.userId ?? shift.user_id,
      userName: shift.userName ?? shift.user_name,
      userEmail: shift.userEmail ?? shift.user_email,
      userRole: shift.userRole ?? shift.user_role,
      location: shift.location || 'MAIN',
      status: shift.status,
      openedAt: shift.openedAt ?? shift.opened_at,
      closedAt: shift.closedAt ?? shift.closed_at,
      openingCashMinor: Number(shift.openingCashMinor ?? shift.opening_cash_minor ?? 0),
      expectedCashMinor: Number(shift.expectedCashMinor ?? shift.expected_cash_minor ?? finalSummary.expectedCashMinor),
      countedCashMinor: shift.countedCashMinor !== null && shift.countedCashMinor !== undefined
        ? Number(shift.countedCashMinor ?? shift.counted_cash_minor)
        : null,
      varianceMinor: shift.varianceMinor !== null && shift.varianceMinor !== undefined
        ? Number(shift.varianceMinor ?? shift.variance_minor)
        : null,
      summary: finalSummary,
      note: shift.note,
      closedBy: shift.closedBy ?? shift.closed_by,
      closedByName: shift.closedByName ?? shift.closed_by_name,
      reviewedBy: shift.reviewedBy ?? shift.reviewed_by,
      reviewedByName: shift.reviewedByName ?? shift.reviewed_by_name,
      reviewedAt: shift.reviewedAt ?? shift.reviewed_at,
      reviewNotes: shift.reviewNotes ?? shift.review_notes,
    };

    const shopRow = await ctx.db.one<any>('SELECT name, gstin, address, phone FROM tenants WHERE id = ?', [tenantId]);
    const shopInfo = {
      name: shopRow?.name || 'Adaptive Billing Shop',
      gstin: shopRow?.gstin,
      address: shopRow?.address,
      phone: shopRow?.phone,
    };

    const varianceMinor = shiftObj.varianceMinor ?? (summary.countedCashMinor !== null && summary.countedCashMinor !== undefined ? summary.countedCashMinor - summary.expectedCashMinor : 0);
    const varianceClassification = classifyVariance(varianceMinor);

    const report: ShiftClosingReport = {
      shop: shopInfo,
      shift: shiftObj,
      summary,
      varianceClassification,
      cashMovements,
      recentTransactions,
    };

    if (format === 'html' || format === 'print') {
      const html = renderShiftClosingReportHtml(report, shopInfo);
      return new HtmlResponse(html);
    }

    return { report };
  });
}
