import { requirePerm, requireUser } from '../auth.ts';
import { bad, notFound, forbidden, HtmlResponse, FileResponse, V, type Router } from '../http.ts';
import { newId, verifyPassword } from '../security.ts';
import { j, type Queryable } from '../db/index.ts';
import { audit } from '../audit.ts';
import { fmtMoney } from '../../../shared/money.ts';
import { resolveBranchScope } from '../branchScope.ts';

// Helper for safe growth percentage calculation (handles 0 gracefully without NaN/Infinity)
function calcGrowth(current: number, previous: number): number {
  if (previous === 0 && current === 0) return 0;
  if (previous === 0) return 100;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  if (isNaN(pct) || !isFinite(pct)) return 0;
  return Math.round(pct * 10) / 10;
}

// ============================================================================
// SMART CLOSING AUDIT & DETECTOR ENGINE
// ============================================================================

export type SmartAuditSeverity = 'critical' | 'warning' | 'info';

export type SmartAuditDetectorId =
  | 'cash_shortage'
  | 'cash_excess'
  | 'sales_mismatch'
  | 'payment_mismatch'
  | 'duplicate_transactions'
  | 'missing_transactions'
  | 'unusual_refund'
  | 'pending_bills'
  | 'unusual_discount'
  | 'stock_sales_consistency'
  | 'unassigned_transactions'
  | 'closing_readiness';

export interface SmartAuditIssue {
  id: string;
  detector: SmartAuditDetectorId;
  severity: SmartAuditSeverity;
  title: string;
  description: string;
  amountMinor?: number | null;
  count?: number;
  counterId?: string | null;
  counterCode?: string | null;
  cashierId?: string | null;
  cashierName?: string | null;
  bdate: string;
  recommendedAction: string;
  details?: Record<string, any>;
}

export interface SmartAuditResult {
  evaluatedAt: string;
  bdate: string;
  branchId: string;
  counterId?: string | null;
  cashierId?: string | null;
  readinessStatus: 'ready_to_submit' | 'ready_with_warnings' | 'action_required';
  readinessScore: number;
  summaryMessage: string;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  totalChecks: number;
  issues: SmartAuditIssue[];
  detectorSummary: Record<SmartAuditDetectorId, { status: 'passed' | 'warning' | 'failed'; issueCount: number }>;
}

export async function runSmartClosingAudit(
  db: Queryable,
  params: {
    tenantId: string;
    branchId: string;
    bdate: string;
    counterId?: string | null;
    cashierId?: string | null;
    shiftId?: string | null;
    actualCashMinor?: number | null;
  },
): Promise<SmartAuditResult> {
  const { tenantId, branchId, bdate, counterId, cashierId, shiftId, actualCashMinor } = params;

  const issues: SmartAuditIssue[] = [];

  const detectorSummary: Record<SmartAuditDetectorId, { status: 'passed' | 'warning' | 'failed'; issueCount: number }> = {
    cash_shortage: { status: 'passed', issueCount: 0 },
    cash_excess: { status: 'passed', issueCount: 0 },
    sales_mismatch: { status: 'passed', issueCount: 0 },
    payment_mismatch: { status: 'passed', issueCount: 0 },
    duplicate_transactions: { status: 'passed', issueCount: 0 },
    missing_transactions: { status: 'passed', issueCount: 0 },
    unusual_refund: { status: 'passed', issueCount: 0 },
    pending_bills: { status: 'passed', issueCount: 0 },
    unusual_discount: { status: 'passed', issueCount: 0 },
    stock_sales_consistency: { status: 'passed', issueCount: 0 },
    unassigned_transactions: { status: 'passed', issueCount: 0 },
    closing_readiness: { status: 'passed', issueCount: 0 },
  };

  const registerIssue = (issue: SmartAuditIssue) => {
    issues.push(issue);
    const d = issue.detector;
    detectorSummary[d].issueCount++;
    if (issue.severity === 'critical') {
      detectorSummary[d].status = 'failed';
    } else if (issue.severity === 'warning' && detectorSummary[d].status !== 'failed') {
      detectorSummary[d].status = 'warning';
    }
  };

  // Scoped SQL fragments
  const shiftClause = shiftId ? ' AND i.shift_id = ?' : '';
  const shiftParams = shiftId ? [shiftId] : [];
  const cashierClause = cashierId ? ' AND i.created_by = ?' : '';
  const cashierParams = cashierId ? [cashierId] : [];
  const counterClause = counterId
    ? (counterId === 'unassigned'
        ? " AND (i.counter_id IS NULL AND (i.counter IS NULL OR i.counter = ''))"
        : " AND (i.counter_id = ? OR (i.counter_id IS NULL AND i.counter = ?))")
    : '';
  const counterParams = (counterId && counterId !== 'unassigned') ? [counterId, counterId] : [];

  // --------------------------------------------------------------------------
  // DETECTORS 1 & 2: Cash Shortage & Excess Detectors
  // --------------------------------------------------------------------------
  let shiftFilterSql = shiftId ? ' AND id = ?' : '';
  const shiftFilterParams: any[] = shiftId ? [shiftId] : [];
  if (cashierId) {
    shiftFilterSql += ' AND user_id = ?';
    shiftFilterParams.push(cashierId);
  }
  const shiftsRow = await db.one<any>(
    `SELECT COALESCE(SUM(opening_cash_minor), 0)::bigint AS opening_cash_minor
     FROM shifts
     WHERE tenant_id = ? AND (location = ? OR branch_id = ?)
       AND (DATE(opened_at) = ?::date OR (created_at)::date = ?::date)
       ${shiftFilterSql}`,
    [tenantId, branchId, branchId, bdate, bdate, ...shiftFilterParams],
  );
  const openingCashMinor = Number(shiftsRow?.openingCashMinor ?? shiftsRow?.opening_cash_minor ?? 0);

  let cashPaySql = `
    SELECT COALESCE(SUM(p.amount_minor), 0)::bigint AS cash_sales_minor
    FROM payments p
    LEFT JOIN invoices i ON i.id = p.invoice_id
    WHERE p.tenant_id = ? AND (p.status IS NULL OR p.status = 'posted')
      AND p.method = 'cash' AND p.kind = 'receipt'
      AND (p.bdate = ? OR (p.created_at)::date = ?::date)
      AND (p.invoice_id IS NULL OR i.branch_id IS NULL OR i.branch_id = ?)
  `;
  const cashPayParams: any[] = [tenantId, bdate, bdate, branchId];
  if (cashierId) {
    cashPaySql += ' AND (p.created_by = ? OR (p.created_by IS NULL AND i.created_by = ?))';
    cashPayParams.push(cashierId, cashierId);
  }
  if (counterId) {
    if (counterId === 'unassigned') {
      cashPaySql += " AND (COALESCE(p.counter_id, p.counter, i.counter_id, i.counter) IS NULL OR COALESCE(p.counter_id, p.counter, i.counter_id, i.counter) = '')";
    } else {
      cashPaySql += " AND (p.counter_id = ? OR p.counter = ? OR (p.counter_id IS NULL AND (i.counter_id = ? OR i.counter = ?)))";
      cashPayParams.push(counterId, counterId, counterId, counterId);
    }
  }
  const cashPayRow = await db.one<any>(cashPaySql, cashPayParams);
  const cashSalesMinor = Number(cashPayRow?.cashSalesMinor ?? cashPayRow?.cash_sales_minor ?? 0);

  const refTxRow = await db.one<any>(
    `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS cash_refunds_minor
     FROM refund_transactions
     WHERE tenant_id = ? AND (bdate = ? OR (created_at)::date = ?::date) AND method = 'cash'
       ${shiftId ? ' AND shift_id = ?' : ''}
       ${cashierId ? ' AND processed_by = ?' : ''}`,
    [tenantId, bdate, bdate, ...(shiftId ? [shiftId] : []), ...(cashierId ? [cashierId] : [])],
  );
  let cashRefundsMinor = Number(refTxRow?.cashRefundsMinor ?? refTxRow?.cash_refunds_minor ?? 0);

  if (cashRefundsMinor === 0) {
    const retRow = await db.one<any>(
      `SELECT COALESCE(SUM(COALESCE(NULLIF(i.refund_amount_minor, 0), i.total_minor)), 0)::bigint AS cash_refunds_minor
       FROM invoices i
       WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.kind = 'credit_note' AND i.status = 'posted'
         AND i.refund_mode = 'cash'
         ${shiftClause} ${cashierClause} ${counterClause}`,
      [tenantId, branchId, bdate, ...shiftParams, ...cashierParams, ...counterParams],
    );
    cashRefundsMinor = Number(retRow?.cashRefundsMinor ?? retRow?.cash_refunds_minor ?? 0);
  }

  const expRow = await db.one<any>(
    `SELECT COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total_minor ELSE 0 END), 0)::bigint AS cash_expenses_minor
     FROM expenses
     WHERE tenant_id = ? AND branch_id = ? AND expense_date = ? AND status = 'posted'
       ${cashierId ? ' AND created_by = ?' : ''}`,
    [tenantId, branchId, bdate, ...(cashierId ? [cashierId] : [])],
  );
  const cashExpensesMinor = Number(expRow?.cashExpensesMinor ?? expRow?.cash_expenses_minor ?? 0);

  let cmSql = `SELECT
      COALESCE(SUM(CASE WHEN cm.movement_type = 'cash_in' THEN cm.amount_minor ELSE 0 END), 0)::bigint AS cash_in_minor,
      COALESCE(SUM(CASE WHEN cm.movement_type = 'cash_out' THEN cm.amount_minor ELSE 0 END), 0)::bigint AS cash_out_minor
     FROM cash_movements cm
     JOIN shifts s ON s.id = cm.shift_id
     WHERE cm.tenant_id = ? AND (s.location = ? OR s.branch_id = ?) AND (DATE(cm.created_at) = ?::date)`;
  const cmParams: any[] = [tenantId, branchId, branchId, bdate];
  if (shiftId) { cmSql += ' AND s.id = ?'; cmParams.push(shiftId); }
  if (cashierId) { cmSql += ' AND s.user_id = ?'; cmParams.push(cashierId); }
  const cmRow = await db.one<any>(cmSql, cmParams);
  const cashInMinor = Number(cmRow?.cashInMinor ?? cmRow?.cash_in_minor ?? 0);
  const cashOutMinor = Number(cmRow?.cashOutMinor ?? cmRow?.cash_out_minor ?? 0);

  const expectedClosingCashMinor = openingCashMinor + cashSalesMinor - cashRefundsMinor - cashExpensesMinor - cashOutMinor + cashInMinor;

  if (actualCashMinor !== null && actualCashMinor !== undefined) {
    const varianceMinor = actualCashMinor - expectedClosingCashMinor;
    if (varianceMinor < 0) {
      const shortageMinor = Math.abs(varianceMinor);
      registerIssue({
        id: 'det_cash_shortage',
        detector: 'cash_shortage',
        severity: 'critical',
        title: 'Cash Drawer Shortage Detected',
        description: `Physical counted cash (₹${(actualCashMinor / 100).toFixed(2)}) is ₹${(shortageMinor / 100).toFixed(2)} less than drawer expected cash (₹${(expectedClosingCashMinor / 100).toFixed(2)}).`,
        amountMinor: shortageMinor,
        bdate,
        counterId: counterId || null,
        cashierId: cashierId || null,
        recommendedAction: 'Verify physical cash count, review cash expense slips, and document shortage reason before submitting closing.',
        details: {
          expectedCashMinor: expectedClosingCashMinor,
          actualCashMinor,
          varianceMinor,
          openingCashMinor,
          cashSalesMinor,
          cashInMinor,
          cashOutMinor,
          cashRefundsMinor,
          cashExpensesMinor,
          formula: 'Expected Cash = Opening Cash (₹' + (openingCashMinor / 100).toFixed(2) + ') + Cash Sales (₹' + (cashSalesMinor / 100).toFixed(2) + ') + Deposits (₹' + (cashInMinor / 100).toFixed(2) + ') - Cash Refunds (₹' + (cashRefundsMinor / 100).toFixed(2) + ') - Cash Expenses (₹' + (cashExpensesMinor / 100).toFixed(2) + ') - Withdrawals (₹' + (cashOutMinor / 100).toFixed(2) + ')',
        },
      });
    } else if (varianceMinor > 0) {
      registerIssue({
        id: 'det_cash_excess',
        detector: 'cash_excess',
        severity: 'warning',
        title: 'Cash Drawer Surplus Detected',
        description: `Physical counted cash (₹${(actualCashMinor / 100).toFixed(2)}) is ₹${(varianceMinor / 100).toFixed(2)} higher than drawer expected cash (₹${(expectedClosingCashMinor / 100).toFixed(2)}).`,
        amountMinor: varianceMinor,
        bdate,
        counterId: counterId || null,
        cashierId: cashierId || null,
        recommendedAction: 'Verify whether all cash sales and customer advances were recorded in the system, and document the surplus reason.',
        details: {
          expectedCashMinor: expectedClosingCashMinor,
          actualCashMinor,
          varianceMinor,
          openingCashMinor,
          cashSalesMinor,
          cashInMinor,
          cashOutMinor,
          cashRefundsMinor,
          cashExpensesMinor,
          formula: 'Expected Cash = Opening Cash (₹' + (openingCashMinor / 100).toFixed(2) + ') + Cash Sales (₹' + (cashSalesMinor / 100).toFixed(2) + ') + Deposits (₹' + (cashInMinor / 100).toFixed(2) + ') - Cash Refunds (₹' + (cashRefundsMinor / 100).toFixed(2) + ') - Cash Expenses (₹' + (cashExpensesMinor / 100).toFixed(2) + ') - Withdrawals (₹' + (cashOutMinor / 100).toFixed(2) + ')',
        },
      });
    }
  }

  // --------------------------------------------------------------------------
  // DETECTOR 3: Sales Mismatch Detector
  // --------------------------------------------------------------------------
  const salesMismatches = await db.query<any>(
    `SELECT i.id, i.number, i.total_minor, i.subtotal_minor, i.discount_minor,
            i.taxable_minor, i.cgst_minor, i.sgst_minor, i.igst_minor, i.round_off_minor,
            COALESCE(SUM(il.total_minor), 0)::bigint AS lines_total_minor,
            COUNT(il.id) AS lines_count
     FROM invoices i
     LEFT JOIN invoice_lines il ON il.invoice_id = i.id
     WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.status = 'posted' AND i.kind = 'sale'
       ${shiftClause} ${cashierClause} ${counterClause}
     GROUP BY i.id, i.number, i.total_minor, i.subtotal_minor, i.discount_minor, i.taxable_minor, i.cgst_minor, i.sgst_minor, i.igst_minor, i.round_off_minor
     HAVING ABS(i.total_minor - (COALESCE(i.taxable_minor, i.subtotal_minor - COALESCE(i.discount_minor, 0)) + i.cgst_minor + i.sgst_minor + i.igst_minor + i.round_off_minor)) > 2
        OR (COUNT(il.id) > 0 AND ABS(i.total_minor - (COALESCE(SUM(il.total_minor), 0)::bigint - COALESCE(i.discount_minor, 0) + i.round_off_minor)) > 5)
     LIMIT 15`,
    [tenantId, branchId, bdate, ...shiftParams, ...cashierParams, ...counterParams],
  );
  if (salesMismatches.length > 0) {
    const totalDiffMinor = salesMismatches.reduce((acc: number, m: any) => {
      const calcTotal = Number(m.taxableMinor ?? m.taxable_minor ?? (Number(m.subtotalMinor ?? m.subtotal_minor ?? 0) - Number(m.discountMinor ?? m.discount_minor ?? 0))) +
        Number(m.cgstMinor ?? m.cgst_minor ?? 0) + Number(m.sgstMinor ?? m.sgst_minor ?? 0) +
        Number(m.igstMinor ?? m.igst_minor ?? 0) + Number(m.roundOffMinor ?? m.round_off_minor ?? 0);
      return acc + Math.abs(Number(m.totalMinor ?? m.total_minor ?? 0) - calcTotal);
    }, 0);

    registerIssue({
      id: 'det_sales_mismatch',
      detector: 'sales_mismatch',
      severity: 'critical',
      title: 'Invoice Sales Calculation Mismatch',
      description: `${salesMismatches.length} completed invoice(s) have bill header totals that do not match line items or tax component sums.`,
      amountMinor: totalDiffMinor,
      count: salesMismatches.length,
      bdate,
      recommendedAction: 'Audit affected invoices to verify line items, discounts, and GST tax calculations.',
      details: {
        affectedInvoices: salesMismatches.map((m: any) => ({
          id: m.id,
          number: m.number,
          totalMinor: Number(m.totalMinor ?? m.total_minor),
          linesTotalMinor: Number(m.linesTotalMinor ?? m.lines_total_minor),
          subtotalMinor: Number(m.subtotalMinor ?? m.subtotal_minor),
          discountMinor: Number(m.discountMinor ?? m.discount_minor),
          taxMinor: Number(m.cgstMinor ?? m.cgst_minor) + Number(m.sgstMinor ?? m.sgst_minor) + Number(m.igstMinor ?? m.igst_minor),
        })),
      },
    });
  }

  // --------------------------------------------------------------------------
  // DETECTOR 4: Payment Mismatch Detector
  // --------------------------------------------------------------------------
  const paymentMismatches = await db.query<any>(
    `SELECT i.id, i.number, i.total_minor, i.paid_minor,
            GREATEST(COALESCE(i.applied_minor, 0), COALESCE(i.exchange_adjusted_minor, 0))::bigint AS applied_minor,
            COALESCE(SUM(p.amount_minor), 0)::bigint AS ledger_payments_minor
     FROM invoices i
     LEFT JOIN payments p ON p.invoice_id = i.id AND (p.status IS NULL OR p.status = 'posted') AND p.kind = 'receipt'
     WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.status = 'posted' AND i.kind = 'sale'
       ${shiftClause} ${cashierClause} ${counterClause}
     GROUP BY i.id, i.number, i.total_minor, i.paid_minor, i.applied_minor, i.exchange_adjusted_minor
     HAVING ABS(i.paid_minor - (COALESCE(SUM(p.amount_minor), 0)::bigint + GREATEST(COALESCE(i.applied_minor, 0), COALESCE(i.exchange_adjusted_minor, 0))::bigint)) > 2
     LIMIT 15`,
    [tenantId, branchId, bdate, ...shiftParams, ...cashierParams, ...counterParams],
  );

  const orphanPayments = await db.query<any>(
    `SELECT p.id, p.method, p.amount_minor, p.reference, p.created_at
     FROM payments p
     WHERE p.tenant_id = ? AND p.branch_id = ? AND p.bdate = ? AND (p.status IS NULL OR p.status = 'posted')
       AND p.invoice_id IS NULL AND p.kind = 'receipt'
     LIMIT 15`,
    [tenantId, branchId, bdate],
  );

  if (paymentMismatches.length > 0 || orphanPayments.length > 0) {
    const totalDiscrepancyMinor = paymentMismatches.reduce((acc: number, m: any) => {
      const settled = Number(m.ledgerPaymentsMinor ?? m.ledger_payments_minor ?? 0) + Number(m.appliedMinor ?? m.applied_minor ?? 0);
      return acc + Math.abs(Number(m.paidMinor ?? m.paid_minor ?? 0) - settled);
    }, 0) + orphanPayments.reduce((acc: number, p: any) => acc + Number(p.amountMinor ?? p.amount_minor ?? 0), 0);

    registerIssue({
      id: 'det_payment_mismatch',
      detector: 'payment_mismatch',
      severity: 'critical',
      title: 'Payment & Settlement Ledger Mismatch',
      description: `${paymentMismatches.length} invoice(s) have payments that differ from the recorded paid amounts, and ${orphanPayments.length} orphan payment receipt(s) were found.`,
      amountMinor: totalDiscrepancyMinor,
      count: paymentMismatches.length + orphanPayments.length,
      bdate,
      recommendedAction: 'Verify payment method allocation logs and ensure each collection receipt is linked to a valid invoice.',
      details: {
        affectedInvoices: paymentMismatches.map((m: any) => ({
          id: m.id,
          number: m.number,
          totalMinor: Number(m.totalMinor ?? m.total_minor),
          paidMinor: Number(m.paidMinor ?? m.paid_minor),
          appliedMinor: Number(m.appliedMinor ?? m.applied_minor),
          ledgerPaymentsMinor: Number(m.ledgerPaymentsMinor ?? m.ledger_payments_minor),
          diffMinor: Math.abs(Number(m.paidMinor ?? m.paid_minor) - (Number(m.ledgerPaymentsMinor ?? m.ledger_payments_minor) + Number(m.appliedMinor ?? m.applied_minor))),
        })),
        orphanPayments: orphanPayments.map((p: any) => ({
          id: p.id,
          method: p.method,
          amountMinor: Number(p.amountMinor ?? p.amount_minor),
          reference: p.reference,
        })),
      },
    });
  }

  // --------------------------------------------------------------------------
  // DETECTOR 5: Duplicate Transaction Detector
  // --------------------------------------------------------------------------
  const duplicateInvoices = await db.query<any>(
    `SELECT i1.id AS id1, i1.number AS num1, i2.id AS id2, i2.number AS num2,
            i1.total_minor, i1.customer_phone, i1.created_at AS time1, i2.created_at AS time2
     FROM invoices i1
     JOIN invoices i2 ON i1.tenant_id = i2.tenant_id AND i1.branch_id = i2.branch_id
                     AND i1.bdate = i2.bdate AND i1.id < i2.id
                     AND i1.total_minor = i2.total_minor
                     AND i1.customer_phone = i2.customer_phone
                     AND i1.customer_phone IS NOT NULL AND i1.customer_phone != ''
                     AND ABS(EXTRACT(EPOCH FROM (i1.created_at - i2.created_at))) < 180
     WHERE i1.tenant_id = ? AND i1.branch_id = ? AND i1.bdate = ?
       AND i1.status = 'posted' AND i2.status = 'posted'
     LIMIT 10`,
    [tenantId, branchId, bdate],
  );

  const duplicateReferences = await db.query<any>(
    `SELECT p1.id AS pay1, p1.reference, p1.amount_minor, p1.invoice_id AS inv1,
            p2.id AS pay2, p2.invoice_id AS inv2, i1.number AS num1, i2.number AS num2
     FROM payments p1
     JOIN payments p2 ON p1.tenant_id = p2.tenant_id AND p1.bdate = p2.bdate
                     AND p1.id < p2.id AND p1.reference = p2.reference
                     AND p1.invoice_id != p2.invoice_id
     JOIN invoices i1 ON i1.id = p1.invoice_id
     JOIN invoices i2 ON i2.id = p2.invoice_id
     WHERE p1.tenant_id = ? AND p1.branch_id = ? AND p1.bdate = ?
       AND p1.reference IS NOT NULL AND TRIM(p1.reference) != ''
       AND LENGTH(TRIM(p1.reference)) >= 4
     LIMIT 10`,
    [tenantId, branchId, bdate],
  );

  if (duplicateInvoices.length > 0 || duplicateReferences.length > 0) {
    registerIssue({
      id: 'det_duplicate_transactions',
      detector: 'duplicate_transactions',
      severity: 'warning',
      title: 'Potential Duplicate Transactions Detected',
      description: `Identified ${duplicateInvoices.length} invoice pair(s) with identical customer and amount within 3 minutes, and ${duplicateReferences.length} duplicate payment reference code(s).`,
      count: duplicateInvoices.length + duplicateReferences.length,
      bdate,
      recommendedAction: 'Verify billing receipts to ensure customer was not charged twice and payment UTR/authorization was not duplicated.',
      details: {
        duplicateInvoices: duplicateInvoices.map((d: any) => ({
          invoice1: d.num1 || d.id1,
          invoice2: d.num2 || d.id2,
          amountMinor: Number(d.totalMinor ?? d.total_minor),
          customerPhone: d.customerPhone ?? d.customer_phone,
        })),
        duplicatePaymentReferences: duplicateReferences.map((d: any) => ({
          reference: d.reference,
          amountMinor: Number(d.amountMinor ?? d.amount_minor),
          invoice1: d.num1 || d.inv1,
          invoice2: d.num2 || d.inv2,
        })),
      },
    });
  }

  // --------------------------------------------------------------------------
  // DETECTOR 6: Missing / Date Attribution Anomaly Detector
  // --------------------------------------------------------------------------
  const dateAnomalies = await db.query<any>(
    `SELECT id, number, bdate, DATE(created_at) AS created_date, total_minor, status
     FROM invoices
     WHERE tenant_id = ? AND branch_id = ?
       AND (bdate IS NULL OR bdate = '' OR (DATE(created_at) = ?::date AND bdate != ?))
       AND status = 'posted'
     LIMIT 10`,
    [tenantId, branchId, bdate, bdate],
  );

  if (dateAnomalies.length > 0) {
    registerIssue({
      id: 'det_missing_transactions',
      detector: 'missing_transactions',
      severity: 'warning',
      title: 'Transaction Date Attribution Anomaly',
      description: `${dateAnomalies.length} transaction(s) have timestamp/business date mismatches or missing date values.`,
      count: dateAnomalies.length,
      bdate,
      recommendedAction: 'Confirm whether offline or delayed terminal bills were assigned to the intended business date.',
      details: {
        anomalies: dateAnomalies.map((a: any) => ({
          id: a.id,
          number: a.number,
          bdate: a.bdate,
          createdDate: a.createdDate ?? a.created_date,
          totalMinor: Number(a.totalMinor ?? a.total_minor),
        })),
      },
    });
  }

  // --------------------------------------------------------------------------
  // DETECTOR 7: Unusual Refund Detector
  // --------------------------------------------------------------------------
  const unusualRefunds = await db.query<any>(
    `SELECT i.id, i.number, i.total_minor, i.customer_name, i.customer_phone,
            i.reason, i.created_by, u.name AS cashier_name, i.created_at
     FROM invoices i
     LEFT JOIN users u ON u.id = i.created_by
     WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.kind = 'credit_note' AND i.status = 'posted'
       ${shiftClause} ${cashierClause} ${counterClause}
       AND (i.total_minor >= 200000 OR i.total_minor >= (
         SELECT COALESCE(AVG(total_minor) * 1.5, 200000)
         FROM invoices WHERE tenant_id = i.tenant_id AND branch_id = i.branch_id AND bdate = i.bdate AND kind = 'sale' AND status = 'posted'
       ))
     LIMIT 10`,
    [tenantId, branchId, bdate, ...shiftParams, ...cashierParams, ...counterParams],
  );

  if (unusualRefunds.length > 0) {
    const refundTotalMinor = unusualRefunds.reduce((acc: number, r: any) => acc + Number(r.totalMinor ?? r.total_minor ?? 0), 0);
    registerIssue({
      id: 'det_unusual_refund',
      detector: 'unusual_refund',
      severity: 'warning',
      title: 'High-Value Return / Refund Detected',
      description: `${unusualRefunds.length} return note(s) totaling ₹${(refundTotalMinor / 100).toFixed(2)} exceed ₹2,000 or 150% of the day’s average sales bill.`,
      amountMinor: refundTotalMinor,
      count: unusualRefunds.length,
      bdate,
      recommendedAction: 'Verify physical returned inventory condition, original sales bill reference, and manager authorization.',
      details: {
        refunds: unusualRefunds.map((r: any) => ({
          id: r.id,
          number: r.number,
          totalMinor: Number(r.totalMinor ?? r.total_minor),
          customer: r.customerName ?? r.customer_name,
          cashier: r.cashierName ?? r.cashier_name,
          reason: r.reason || 'N/A',
        })),
      },
    });
  }

  // --------------------------------------------------------------------------
  // DETECTOR 8: Pending Bill Detector
  // --------------------------------------------------------------------------
  const pendingCreditInvoices = await db.query<any>(
    `SELECT i.id, i.number, i.customer_name, i.total_minor, i.balance_minor, i.payment_status
     FROM invoices i
     WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.status = 'posted' AND i.kind = 'sale'
       AND i.balance_minor > 0
       ${shiftClause} ${cashierClause} ${counterClause}
     LIMIT 10`,
    [tenantId, branchId, bdate, ...shiftParams, ...cashierParams, ...counterParams],
  );

  const activeOpenShifts = await db.query<any>(
    `SELECT s.id, s.user_id, u.name AS cashier_name, s.status, s.opened_at, s.opening_cash_minor
     FROM shifts s
     LEFT JOIN users u ON u.id = s.user_id
     WHERE s.tenant_id = ? AND (s.location = ? OR s.branch_id = ?)
       AND DATE(s.opened_at) = ?::date AND s.status = 'open'`,
    [tenantId, branchId, branchId, bdate],
  );

  if (pendingCreditInvoices.length > 0 || activeOpenShifts.length > 0) {
    const unpaidMinor = pendingCreditInvoices.reduce((acc: number, p: any) => acc + Number(p.balanceMinor ?? p.balance_minor ?? 0), 0);
    registerIssue({
      id: 'det_pending_bills',
      detector: 'pending_bills',
      severity: activeOpenShifts.length > 0 ? 'warning' : 'info',
      title: activeOpenShifts.length > 0 ? 'Open Cashier Shifts & Pending Dues' : 'Unsettled Credit Sales Recorded',
      description: `${pendingCreditInvoices.length} bill(s) have pending customer credit balances (₹${(unpaidMinor / 100).toFixed(2)}), and ${activeOpenShifts.length} cashier shift(s) are currently still open.`,
      amountMinor: unpaidMinor,
      count: pendingCreditInvoices.length + activeOpenShifts.length,
      bdate,
      recommendedAction: 'Verify that customer dues are registered in Accounts Receivable and remind cashiers to submit shifts before daily closing.',
      details: {
        creditInvoices: pendingCreditInvoices.map((p: any) => ({
          number: p.number,
          customer: p.customerName ?? p.customer_name,
          totalMinor: Number(p.totalMinor ?? p.total_minor),
          balanceMinor: Number(p.balanceMinor ?? p.balance_minor),
          paymentStatus: p.paymentStatus ?? p.payment_status,
        })),
        openShifts: activeOpenShifts.map((s: any) => ({
          id: s.id,
          cashier: s.cashierName ?? s.cashier_name,
          openedAt: s.openedAt ?? s.opened_at,
          openingCashMinor: Number(s.openingCashMinor ?? s.opening_cash_minor),
        })),
      },
    });
  }

  // --------------------------------------------------------------------------
  // DETECTOR 9: Unusual Discount Detector
  // --------------------------------------------------------------------------
  const highDiscounts = await db.query<any>(
    `SELECT i.id, i.number, i.customer_name, i.subtotal_minor, i.discount_minor, i.total_minor,
            ROUND((i.discount_minor * 100.0) / NULLIF(i.subtotal_minor, 0), 1) AS discount_pct,
            u.name AS cashier_name
     FROM invoices i
     LEFT JOIN users u ON u.id = i.created_by
     WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.status = 'posted' AND i.kind = 'sale'
       AND i.discount_minor > 0
       AND (i.discount_minor >= 50000 OR (i.subtotal_minor > 0 AND (i.discount_minor * 100) / i.subtotal_minor >= 20))
       ${shiftClause} ${cashierClause} ${counterClause}
     ORDER BY i.discount_minor DESC
     LIMIT 10`,
    [tenantId, branchId, bdate, ...shiftParams, ...cashierParams, ...counterParams],
  );

  if (highDiscounts.length > 0) {
    const totalDiscountMinor = highDiscounts.reduce((acc: number, d: any) => acc + Number(d.discountMinor ?? d.discount_minor ?? 0), 0);
    registerIssue({
      id: 'det_unusual_discount',
      detector: 'unusual_discount',
      severity: 'warning',
      title: 'High Discount Billing Detected',
      description: `${highDiscounts.length} invoice(s) have discounts exceeding 20% or ₹500.00 (Total discounts: ₹${(totalDiscountMinor / 100).toFixed(2)}).`,
      amountMinor: totalDiscountMinor,
      count: highDiscounts.length,
      bdate,
      recommendedAction: 'Verify whether discounts were manager-approved and match active promotional rules.',
      details: {
        discounts: highDiscounts.map((d: any) => ({
          number: d.number,
          customer: d.customerName ?? d.customer_name,
          subtotalMinor: Number(d.subtotalMinor ?? d.subtotal_minor),
          discountMinor: Number(d.discountMinor ?? d.discount_minor),
          discountPct: Number(d.discountPct ?? d.discount_pct),
          cashier: d.cashierName ?? d.cashier_name,
        })),
      },
    });
  }

  // --------------------------------------------------------------------------
  // DETECTOR 10: Stock and Sales Consistency Detector
  // --------------------------------------------------------------------------
  const missingStockMoves = await db.query<any>(
    `SELECT i.number, il.id AS line_id, il.name, il.qty_milli, il.item_id
     FROM invoice_lines il
     JOIN invoices i ON i.id = il.invoice_id
     JOIN items it ON it.id = il.item_id
     WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.status = 'posted' AND i.kind = 'sale'
       AND it.track_stock = true
       ${shiftClause} ${cashierClause} ${counterClause}
       AND NOT EXISTS (
         SELECT 1 FROM stock_moves sm
         WHERE sm.tenant_id = i.tenant_id AND sm.ref_id = i.id AND sm.item_id = il.item_id AND sm.kind = 'sale'
       )
     LIMIT 10`,
    [tenantId, branchId, bdate, ...shiftParams, ...cashierParams, ...counterParams],
  );

  if (missingStockMoves.length > 0) {
    registerIssue({
      id: 'det_stock_sales_consistency',
      detector: 'stock_sales_consistency',
      severity: 'critical',
      title: 'Missing Stock Ledger Depletion Moves',
      description: `${missingStockMoves.length} sold stock-tracked line items do not have corresponding stock depletion moves in the inventory ledger.`,
      count: missingStockMoves.length,
      bdate,
      recommendedAction: 'Stock ledger synchronization required. Do not modify inventory records manually.',
      details: {
        affectedLines: missingStockMoves.map((m: any) => ({
          invoiceNumber: m.number,
          itemName: m.name,
          qtyMilli: Number(m.qtyMilli ?? m.qty_milli),
        })),
      },
    });
  }

  // --------------------------------------------------------------------------
  // DETECTOR 11: Unassigned Transaction Detector
  // --------------------------------------------------------------------------
  const unassignedTransactions = await db.query<any>(
    `SELECT i.id, i.number, i.total_minor, i.created_by, i.counter_id, i.counter
     FROM invoices i
     WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.status = 'posted'
       AND (
         (i.counter_id IS NULL AND (i.counter IS NULL OR i.counter = ''))
         OR (i.created_by IS NULL OR i.created_by = '')
       )
     LIMIT 15`,
    [tenantId, branchId, bdate],
  );

  if (unassignedTransactions.length > 0) {
    const unassignedTotalMinor = unassignedTransactions.reduce((acc: number, u: any) => acc + Number(u.totalMinor ?? u.total_minor ?? 0), 0);
    registerIssue({
      id: 'det_unassigned_transactions',
      detector: 'unassigned_transactions',
      severity: 'warning',
      title: 'Unassigned Register / Cashier Transactions',
      description: `${unassignedTransactions.length} transaction(s) totaling ₹${(unassignedTotalMinor / 100).toFixed(2)} have missing counter code or cashier attribution.`,
      amountMinor: unassignedTotalMinor,
      count: unassignedTransactions.length,
      bdate,
      recommendedAction: 'Inspect unassigned transactions in the Counter & Cashier Reports tab and attribute to correct billing register.',
      details: {
        unassignedInvoices: unassignedTransactions.map((u: any) => ({
          id: u.id,
          number: u.number,
          totalMinor: Number(u.totalMinor ?? u.total_minor),
          hasCounter: Boolean(u.counterId || u.counter),
          hasCashier: Boolean(u.createdBy || u.created_by),
        })),
      },
    });
  }

  // --------------------------------------------------------------------------
  // DETECTOR 12: Smart Closing Readiness
  // --------------------------------------------------------------------------
  const criticalCount = issues.filter((i) => i.severity === 'critical').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'info').length;

  let readinessStatus: 'ready_to_submit' | 'ready_with_warnings' | 'action_required' = 'ready_to_submit';
  if (criticalCount > 0) {
    readinessStatus = 'action_required';
    detectorSummary.closing_readiness.status = 'failed';
  } else if (warningCount > 0) {
    readinessStatus = 'ready_with_warnings';
    detectorSummary.closing_readiness.status = 'warning';
  } else {
    readinessStatus = 'ready_to_submit';
    detectorSummary.closing_readiness.status = 'passed';
  }

  let readinessScore = 100 - (criticalCount * 25) - (warningCount * 10);
  if (readinessScore < 0) readinessScore = 0;

  let summaryMessage = '';
  if (readinessStatus === 'action_required') {
    summaryMessage = `${criticalCount} critical financial issue(s) require resolution before submitting Day Closing.`;
  } else if (readinessStatus === 'ready_with_warnings') {
    summaryMessage = `${warningCount} warning observation(s) noted. Register is eligible to submit with acknowledged warnings.`;
  } else {
    summaryMessage = 'All 12 financial audit detectors passed. Financial ledgers, cash drawer floats, and transaction records are fully balanced.';
  }

  return {
    evaluatedAt: new Date().toISOString(),
    bdate,
    branchId,
    counterId: counterId || null,
    cashierId: cashierId || null,
    readinessStatus,
    readinessScore,
    summaryMessage,
    criticalCount,
    warningCount,
    infoCount,
    totalChecks: 12,
    issues,
    detectorSummary,
  };
}

export function registerDayClosing(r: Router) {
  // --------------------------------------------------------------------------
  // 1. Live preview / aggregation for a business day & shift
  // --------------------------------------------------------------------------
  r.get('/api/day-closing/preview', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    const todayStr = new Date().toISOString().slice(0, 10);
    const bdate = String(ctx.query.bdate || todayStr).trim();
    const rawBranch = String(ctx.query.branchId || ctx.query.branch || (scope.branchId ?? 'MAIN')).trim();

    // Resolve canonical branch ID and Code
    const branchRecord = await ctx.db.one<any>(
      `SELECT id, code, name FROM branches
       WHERE tenant_id = ? AND (id = ? OR UPPER(code) = UPPER(?)) AND (deleted_at IS NULL OR active = true)
       LIMIT 1`,
      [tenantId, rawBranch, rawBranch],
    );
    const branchId = branchRecord?.id || scope.branchId || rawBranch;
    const branchCode = branchRecord?.code || rawBranch;

    const shiftId = ctx.query.shiftId ? String(ctx.query.shiftId).trim() : null;
    const userRole = String(ctx.user!.role || '').toUpperCase();
    const isCashier = userRole === 'CASHIER' || userRole === 'COUNTER';
    const cashierId = isCashier
      ? ctx.user!.id
      : (ctx.query.cashierId ? String(ctx.query.cashierId).trim() : null);
    const counterId = ctx.query.counterId ? String(ctx.query.counterId).trim() : null;

    // Optional shift, cashier, and counter SQL filter fragments
    const shiftClause = shiftId ? ' AND i.shift_id = ?' : '';
    const shiftParams = shiftId ? [shiftId] : [];
    const cashierClause = cashierId ? ' AND i.created_by = ?' : '';
    const cashierParams = cashierId ? [cashierId] : [];
    const counterClause = counterId
      ? (counterId === 'unassigned'
          ? " AND (i.counter_id IS NULL AND (i.counter IS NULL OR i.counter = ''))"
          : " AND (i.counter_id = ? OR (i.counter_id IS NULL AND i.counter = ?))")
      : '';
    const counterParams = (counterId && counterId !== 'unassigned') ? [counterId, counterId] : [];

    // Check existing day closing record: scoped to individual cashier if cashierId is specified,
    // otherwise looks for the store-wide consolidated closing (cashier_id IS NULL).
    let closedRecordQuery = `
      SELECT dc.*, u.name AS closed_by_name, vu.name AS verified_by_name,
             au.name AS approved_by_name, ru.name AS reopened_by_name,
             su.name AS submitted_by_name, cu.name AS cashier_name
      FROM day_closings dc
      LEFT JOIN users u ON u.id = dc.closed_by
      LEFT JOIN users vu ON vu.id = dc.verified_by
      LEFT JOIN users au ON au.id = dc.approved_by
      LEFT JOIN users ru ON ru.id = dc.reopened_by
      LEFT JOIN users su ON su.id = dc.submitted_by
      LEFT JOIN users cu ON cu.id = dc.cashier_id
      WHERE dc.tenant_id = ? AND (dc.branch_id = ? OR dc.branch_id = ? OR dc.branch_id = ?) AND dc.bdate = ?`;
    const closedRecordParams: any[] = [tenantId, branchId, branchCode, rawBranch, bdate];

    if (cashierId) {
      closedRecordQuery += ` AND dc.cashier_id = ?`;
      closedRecordParams.push(cashierId);
      closedRecordQuery += ` ORDER BY dc.created_at DESC LIMIT 1`;
    } else {
      // In consolidated store view: prefer store-wide closing (cashier_id IS NULL), or latest branch closing if none
      closedRecordQuery += ` ORDER BY (dc.cashier_id IS NULL) DESC, dc.created_at DESC LIMIT 1`;
    }

    const closedRecord = await ctx.db.one<any>(closedRecordQuery, closedRecordParams);

    // List shifts available on this day for the branch
    const availableShifts = await ctx.db.query<any>(
      `SELECT s.id, s.user_id, u.name AS cashier_name, s.status,
              s.opening_cash_minor, s.expected_cash_minor, s.counted_cash_minor AS closing_cash_minor,
              s.variance_minor AS difference_minor, s.opened_at, s.closed_at
       FROM shifts s
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.tenant_id = ? AND (s.location = ? OR s.branch_id = ? OR s.location = ? OR s.branch_id = ?)
         AND DATE(s.opened_at) = ?::date
       ORDER BY s.opened_at ASC`,
      [tenantId, branchId, branchId, branchCode, branchCode, bdate],
    );

    // List cashiers who billed or opened shifts on this day
    const availableCashiers = await ctx.db.query<any>(
      `SELECT DISTINCT u.id, u.name, u.role
       FROM users u
       WHERE u.tenant_id = ?
         AND (
           LOWER(u.role) IN ('cashier', 'counter')
           OR EXISTS (
             SELECT 1 FROM invoices i
             WHERE i.tenant_id = u.tenant_id AND (i.branch_id = ? OR i.branch_id = ?) AND i.bdate = ? AND i.created_by = u.id
           )
           OR EXISTS (
             SELECT 1 FROM shifts s
             WHERE s.tenant_id = u.tenant_id AND (s.location = ? OR s.branch_id = ? OR s.location = ? OR s.branch_id = ?) AND DATE(s.opened_at) = ?::date AND s.user_id = u.id
           )
         )
       ORDER BY u.name ASC`,
      [tenantId, branchId, branchCode, bdate, branchId, branchId, branchCode, branchCode, bdate],
    );

    // List counters configured or used for billing
    const availableCounters = await ctx.db.query<any>(
      `SELECT DISTINCT c.id, c.name, c.code
       FROM (
         SELECT id, name, code, tenant_id, branch_id FROM counters WHERE status = 'ACTIVE'
         UNION
         SELECT DISTINCT i.counter_id AS id, COALESCE(NULLIF(i.counter_name_snapshot, ''), i.counter, 'Counter') AS name, COALESCE(NULLIF(i.counter, ''), i.counter_id) AS code, i.tenant_id, i.branch_id
         FROM invoices i WHERE i.counter_id IS NOT NULL OR (i.counter IS NOT NULL AND i.counter != '')
       ) c
       WHERE c.tenant_id = ? AND (c.branch_id = ? OR c.branch_id = ? OR c.branch_id IS NULL)
       ORDER BY c.code ASC`,
      [tenantId, branchId, branchCode],
    );

    // Day Closing Schedule & Overdue status calculation
    const schedule = await ctx.db.one<any>(
      `SELECT * FROM day_closing_schedules
       WHERE tenant_id = ? AND (branch_id = ? OR branch_id = ? OR branch_id = ?) AND (counter_id = ? OR counter_id IS NULL)
       ORDER BY (counter_id IS NOT NULL) DESC LIMIT 1`,
      [tenantId, branchId, branchCode, rawBranch, counterId || null],
    );

    const expectedClosingTime = schedule?.expectedClosingTime || schedule?.expected_closing_time || '22:00';
    const now = new Date();
    const istDate = new Date(now.getTime() + 5.5 * 3600000);
    const todayIstStr = istDate.toISOString().slice(0, 10);
    const currentIstTimeStr = istDate.toISOString().slice(11, 16);

    let isOverdue = false;
    let minutesOverdue = 0;
    const isClosedOrApproved = Boolean(closedRecord && (closedRecord.status === 'closed' || closedRecord.status === 'approved' || closedRecord.status === 'submitted'));
    const isScheduleEnabled = schedule ? (schedule.enabled !== false) : true;
    const isAutoAlertEnabled = schedule ? ((schedule.autoAlertOverdue ?? schedule.auto_alert_overdue) !== false) : true;

    if (!isClosedOrApproved && isScheduleEnabled && isAutoAlertEnabled) {
      if (bdate < todayIstStr) {
        isOverdue = true;
        minutesOverdue = 1440;
      } else if (bdate === todayIstStr) {
        const [expH, expM] = expectedClosingTime.split(':').map(Number);
        const [curH, curM] = currentIstTimeStr.split(':').map(Number);
        const expTotalMin = (expH || 0) * 60 + (expM || 0);
        const curTotalMin = (curH || 0) * 60 + (curM || 0);
        if (curTotalMin > expTotalMin) {
          isOverdue = true;
          minutesOverdue = curTotalMin - expTotalMin;
        }
      }
    }

    const scheduleInfo = {
      expectedClosingTime,
      firstReminderMinutesBefore: schedule?.firstReminderMinutesBefore ?? schedule?.first_reminder_minutes_before ?? 30,
      secondReminderMinutesBefore: schedule?.secondReminderMinutesBefore ?? schedule?.second_reminder_minutes_before ?? 15,
      finalReminderAtClosing: schedule?.finalReminderAtClosing ?? schedule?.final_reminder_at_closing ?? true,
      overdueReminderIntervalMinutes: schedule?.overdueReminderIntervalMinutes ?? schedule?.overdue_reminder_interval_minutes ?? 30,
      autoAlertOverdue: schedule?.autoAlertOverdue ?? schedule?.auto_alert_overdue ?? true,
      enabled: schedule?.enabled ?? true,
      isOverdue,
      minutesOverdue,
      lastReminderSentAt: schedule?.lastReminderSentAt || schedule?.last_reminder_sent_at || null,
      lastReminderType: schedule?.lastReminderType || schedule?.last_reminder_type || null,
    };

    // Sales Summary (kind = 'sale')
    const salesRow = await ctx.db.one<any>(
      `SELECT
        COUNT(*)::int AS invoices_count,
        COALESCE(SUM(total_minor), 0)::bigint AS gross_sales_minor,
        COALESCE(SUM(taxable_minor), 0)::bigint AS taxable_minor,
        COALESCE(SUM(discount_minor), 0)::bigint AS discounts_total_minor,
        COALESCE(SUM(cgst_minor + sgst_minor + igst_minor), 0)::bigint AS gst_collected_minor,
        COUNT(DISTINCT NULLIF(customer_phone, ''))::int AS unique_customers_count
       FROM invoices i
       WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.status = 'posted' AND i.kind = 'sale'
         ${shiftClause} ${cashierClause} ${counterClause}`,
      [tenantId, branchId, bdate, ...shiftParams, ...cashierParams, ...counterParams],
    );

    // Returns Summary (kind = 'credit_note')
    const returnsRow = await ctx.db.one<any>(
      `SELECT
        COUNT(*)::int AS returns_count,
        COALESCE(SUM(total_minor), 0)::bigint AS returns_total_minor,
        COALESCE(SUM(taxable_minor), 0)::bigint AS returns_taxable_minor
       FROM invoices i
       WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.status = 'posted' AND i.kind = 'credit_note'
         ${shiftClause} ${cashierClause} ${counterClause}`,
      [tenantId, branchId, bdate, ...shiftParams, ...cashierParams, ...counterParams],
    );

    // Cancelled / Voided Invoices
    const voidedRow = await ctx.db.one<any>(
      `SELECT COUNT(*)::int AS voided_count, COALESCE(SUM(i.total_minor), 0)::bigint AS voided_total_minor
       FROM invoices i
       WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.status = 'voided'
         ${shiftClause} ${cashierClause} ${counterClause}`,
      [tenantId, branchId, bdate, ...shiftParams, ...cashierParams, ...counterParams],
    );

    // Customer Outstanding (Credit / Partial unpaid invoices for this date)
    const outstandingRow = await ctx.db.one<any>(
      `SELECT COALESCE(SUM(i.total_minor - i.paid_minor), 0)::bigint AS outstanding_minor
       FROM invoices i
       WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.status = 'posted' AND i.total_minor > i.paid_minor
         ${shiftClause} ${cashierClause} ${counterClause}`,
      [tenantId, branchId, bdate, ...shiftParams, ...cashierParams, ...counterParams],
    );

    // Product Quantity & Lines Totals
    const itemsRow = await ctx.db.one<any>(
      `SELECT
        COUNT(DISTINCT il.item_id)::int AS distinct_items_count,
        COALESCE(SUM(il.qty_milli), 0)::bigint AS total_qty_milli
       FROM invoice_lines il
       JOIN invoices i ON i.id = il.invoice_id
       WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.status = 'posted' AND i.kind = 'sale'
         ${shiftClause} ${cashierClause} ${counterClause}`,
      [tenantId, branchId, bdate, ...shiftParams, ...cashierParams, ...counterParams],
    );

    const grossSalesMinor = Number(salesRow?.grossSalesMinor ?? salesRow?.gross_sales_minor ?? 0);
    const returnsTotalMinor = Number(returnsRow?.returnsTotalMinor ?? returnsRow?.returns_total_minor ?? 0);
    const netSalesMinor = Math.max(0, grossSalesMinor - returnsTotalMinor);
    const invoicesCount = Number(salesRow?.invoicesCount ?? salesRow?.invoices_count ?? 0);
    const returnsCount = Number(returnsRow?.returnsCount ?? returnsRow?.returns_count ?? 0);
    const discountsTotalMinor = Number(salesRow?.discountsTotalMinor ?? salesRow?.discounts_total_minor ?? 0);
    const gstCollectedMinor = Number(salesRow?.gstCollectedMinor ?? salesRow?.gst_collected_minor ?? 0);
    const taxableSalesMinor = Number(salesRow?.taxableMinor ?? salesRow?.taxable_minor ?? 0);
    const cancelledInvoicesCount = Number(voidedRow?.voidedCount ?? voidedRow?.voided_count ?? 0);
    const outstandingCustomerPaymentsMinor = Number(outstandingRow?.outstandingMinor ?? outstandingRow?.outstanding_minor ?? 0);
    const totalProductsSold = Number(itemsRow?.distinctItemsCount ?? itemsRow?.distinct_items_count ?? 0);
    const totalQuantitiesSoldMilli = Number(itemsRow?.totalQtyMilli ?? itemsRow?.total_qty_milli ?? 0);
    const totalCustomersBilled = Number(salesRow?.uniqueCustomersCount ?? salesRow?.unique_customers_count ?? 0);
    const averageBillValueMinor = invoicesCount > 0 ? Math.round(netSalesMinor / invoicesCount) : 0;

    // Refunds Breakdown
    const refundsRow = await ctx.db.one<any>(
      `SELECT
        COUNT(*)::int AS refunds_count,
        COALESCE(SUM(CASE WHEN method = 'cash' THEN amount_minor ELSE 0 END), 0)::bigint AS cash_refunds_minor,
        COALESCE(SUM(CASE WHEN method = 'upi' THEN amount_minor ELSE 0 END), 0)::bigint AS upi_refunds_minor,
        COALESCE(SUM(CASE WHEN method = 'card' THEN amount_minor ELSE 0 END), 0)::bigint AS card_refunds_minor,
        COALESCE(SUM(CASE WHEN method = 'bank' THEN amount_minor ELSE 0 END), 0)::bigint AS bank_refunds_minor,
        COALESCE(SUM(amount_minor), 0)::bigint AS total_refunds_minor
       FROM refund_transactions
       WHERE tenant_id = ? AND (bdate = ? OR (created_at)::date = ?::date)
         ${shiftId ? ' AND shift_id = ?' : ''}
         ${cashierId ? ' AND processed_by = ?' : ''}`,
      [tenantId, bdate, bdate, ...(shiftId ? [shiftId] : []), ...(cashierId ? [cashierId] : [])],
    );

    const storeCreditRow = await ctx.db.one<any>(
      `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS store_credits_issued_minor
       FROM store_credits
       WHERE tenant_id = ? AND DATE(created_at) = ?::date
         ${cashierId ? ' AND created_by = ?' : ''}`,
      [tenantId, bdate, ...(cashierId ? [cashierId] : [])],
    );

    const exchangeAdjustRow = await ctx.db.one<any>(
      `SELECT COALESCE(SUM(i.exchange_adjusted_minor), 0)::bigint AS exchange_adjusted_minor
       FROM invoices i
       WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.is_exchange = TRUE AND i.kind = 'sale'
         ${shiftClause} ${cashierClause} ${counterClause}`,
      [tenantId, branchId, bdate, ...shiftParams, ...cashierParams, ...counterParams],
    );

    const cashRefundsPaidMinor = Number(refundsRow?.cashRefundsMinor ?? refundsRow?.cash_refunds_minor ?? 0);
    const upiRefundsPaidMinor = Number(refundsRow?.upiRefundsMinor ?? refundsRow?.upi_refunds_minor ?? 0);
    const totalRefundsMinor = Number(refundsRow?.totalRefundsMinor ?? refundsRow?.total_refunds_minor ?? 0);
    const storeCreditsIssuedMinor = Number(storeCreditRow?.storeCreditsIssuedMinor ?? storeCreditRow?.store_credits_issued_minor ?? 0);
    const exchangeCreditAdjustedMinor = Number(exchangeAdjustRow?.exchangeAdjustedMinor ?? exchangeAdjustRow?.exchange_adjusted_minor ?? 0);

    // Exchanges Summary
    const exchangeStatsRow = await ctx.db.one<any>(
      `SELECT
        COUNT(DISTINCT i.exchange_id)::int AS exchanges_count,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN i.total_minor ELSE 0 END), 0)::bigint AS new_sold_minor,
        COALESCE(SUM(CASE WHEN i.kind = 'credit_note' THEN i.total_minor ELSE 0 END), 0)::bigint AS old_returned_minor
       FROM invoices i
       WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.is_exchange = TRUE AND i.status = 'posted'
         ${shiftClause} ${cashierClause} ${counterClause}`,
      [tenantId, branchId, bdate, ...shiftParams, ...cashierParams, ...counterParams],
    );

    const exchangesCount = Number(exchangeStatsRow?.exchangesCount ?? exchangeStatsRow?.exchanges_count ?? 0);
    const newProductsSoldMinor = Number(exchangeStatsRow?.newSoldMinor ?? exchangeStatsRow?.new_sold_minor ?? 0);
    const oldProductsReturnedMinor = Number(exchangeStatsRow?.oldReturnedMinor ?? exchangeStatsRow?.old_returned_minor ?? 0);
    const additionalAmountCollectedMinor = Math.max(0, newProductsSoldMinor - oldProductsReturnedMinor);
    const remainingCustomerCreditMinor = Math.max(0, oldProductsReturnedMinor - newProductsSoldMinor);

    // Payment Collections Summary by Channel
    let paymentSql = `SELECT
        COALESCE(p.method, 'cash') AS method,
        COUNT(*)::int AS count,
        COALESCE(SUM(p.amount_minor), 0)::bigint AS total_minor
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       WHERE p.tenant_id = ?
         AND (p.status IS NULL OR p.status = 'posted')
         AND (p.bdate = ? OR (p.created_at)::date = ?::date)
         AND (p.invoice_id IS NULL OR i.branch_id IS NULL OR i.branch_id = ?)`;
    const paymentParams: any[] = [tenantId, bdate, bdate, branchId];
    if (shiftId) {
      paymentSql += ' AND (i.shift_id = ? OR p.shift_id = ?)';
      paymentParams.push(shiftId, shiftId);
    }
    if (cashierId) {
      paymentSql += ' AND (p.created_by = ? OR (p.created_by IS NULL AND i.created_by = ?))';
      paymentParams.push(cashierId, cashierId);
    }
    if (counterId) {
      if (counterId === 'unassigned') {
        paymentSql += " AND (COALESCE(p.counter_id, p.counter, i.counter_id, i.counter) IS NULL OR COALESCE(p.counter_id, p.counter, i.counter_id, i.counter) = '')";
      } else {
        paymentSql += " AND (p.counter_id = ? OR p.counter = ? OR (p.counter_id IS NULL AND (i.counter_id = ? OR i.counter = ?)))";
        paymentParams.push(counterId, counterId, counterId, counterId);
      }
    }
    paymentSql += ` GROUP BY COALESCE(p.method, 'cash')`;

    const paymentRows = await ctx.db.query<any>(paymentSql, paymentParams);

    let cashCollectionsMinor = 0;
    let upiCollectionsMinor = 0;
    let cardCollectionsMinor = 0;
    let bankCollectionsMinor = 0;
    let storeCreditCollectionsMinor = 0;
    const collectionsSummary: Record<string, number> = {};

    for (const pr of paymentRows) {
      const m = String(pr.method).toLowerCase();
      const amt = Number(pr.totalMinor ?? pr.total_minor ?? 0);
      collectionsSummary[m] = amt;
      if (m === 'cash') cashCollectionsMinor += amt;
      else if (m === 'upi') upiCollectionsMinor += amt;
      else if (m === 'card') cardCollectionsMinor += amt;
      else if (m === 'bank' || m === 'bank_transfer') bankCollectionsMinor += amt;
      else if (m === 'store_credit') storeCreditCollectionsMinor += amt;
    }

    // Opening Cash from shifts for this date and branch
    let shiftFilterSql = shiftId ? ' AND id = ?' : '';
    const shiftFilterParams: any[] = shiftId ? [shiftId] : [];
    if (cashierId) {
      shiftFilterSql += ' AND user_id = ?';
      shiftFilterParams.push(cashierId);
    }
    const shiftsRow = await ctx.db.one<any>(
      `SELECT COALESCE(SUM(opening_cash_minor), 0)::bigint AS opening_cash_minor
       FROM shifts
       WHERE tenant_id = ? AND (location = ? OR branch_id = ?)
         AND (DATE(opened_at) = ?::date OR (created_at)::date = ?::date)
         ${shiftFilterSql}`,
      [tenantId, branchId, branchId, bdate, bdate, ...shiftFilterParams],
    );
    const openingCashMinor = Number(shiftsRow?.openingCashMinor ?? shiftsRow?.opening_cash_minor ?? 0);

    // Cash Expenses
    const expensesRow = await ctx.db.one<any>(
      `SELECT
        COALESCE(SUM(total_minor), 0)::bigint AS total_expenses_minor,
        COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total_minor ELSE 0 END), 0)::bigint AS cash_expenses_minor
       FROM expenses
       WHERE tenant_id = ? AND branch_id = ? AND expense_date = ? AND status = 'posted'
         ${cashierId ? ' AND created_by = ?' : ''}`,
      [tenantId, branchId, bdate, ...(cashierId ? [cashierId] : [])],
    );
    const cashExpensesMinor = Number(expensesRow?.cashExpensesMinor ?? expensesRow?.cash_expenses_minor ?? 0);
    const operatingExpensesMinor = Number(expensesRow?.totalExpensesMinor ?? expensesRow?.total_expenses_minor ?? 0);

    // Cash movements (In/Out)
    let cashMoveSql = `SELECT
        COALESCE(SUM(CASE WHEN cm.movement_type = 'cash_in' THEN cm.amount_minor ELSE 0 END), 0)::bigint AS cash_in_minor,
        COALESCE(SUM(CASE WHEN cm.movement_type = 'cash_out' THEN cm.amount_minor ELSE 0 END), 0)::bigint AS cash_out_minor
       FROM cash_movements cm
       JOIN shifts s ON s.id = cm.shift_id
       WHERE cm.tenant_id = ? AND (s.location = ? OR s.branch_id = ?) AND (DATE(cm.created_at) = ?::date)`;
    const cashMoveParams: any[] = [tenantId, branchId, branchId, bdate];
    if (shiftId) {
      cashMoveSql += ' AND s.id = ?';
      cashMoveParams.push(shiftId);
    }
    if (cashierId) {
      cashMoveSql += ' AND s.user_id = ?';
      cashMoveParams.push(cashierId);
    }
    const cashMovesRow = await ctx.db.one<any>(cashMoveSql, cashMoveParams);
    const cashInMinor = Number(cashMovesRow?.cashInMinor ?? cashMovesRow?.cash_in_minor ?? 0);
    const cashOutMinor = Number(cashMovesRow?.cashOutMinor ?? cashMovesRow?.cash_out_minor ?? 0);

    // Expected Closing Cash = Opening + Cash Sales - Refunds - Expenses - Cash Out + Cash In
    const expectedClosingCashMinor =
      openingCashMinor + cashCollectionsMinor - cashRefundsPaidMinor - cashExpensesMinor - cashOutMinor + cashInMinor;

    // Profit & COGS Summary
    // COGS for sales using historical snapshot cost on invoice_lines
    const salesCogsRow = await ctx.db.one<any>(
      `SELECT COALESCE(SUM(il.qty_milli * COALESCE(NULLIF(il.cost_minor, 0), it.cost_minor, 0) / 1000), 0)::bigint AS cogs_minor
       FROM invoice_lines il
       JOIN invoices i ON i.id = il.invoice_id
       LEFT JOIN items it ON it.id = il.item_id
       WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.kind = 'sale' AND i.status = 'posted'
         ${shiftClause} ${cashierClause} ${counterClause}`,
      [tenantId, branchId, bdate, ...shiftParams, ...cashierParams, ...counterParams],
    );
    const cogsMinor = Number(salesCogsRow?.cogsMinor ?? salesCogsRow?.cogs_minor ?? 0);

    // Returned COGS: ONLY for resellable items
    const returnedCogsRow = await ctx.db.one<any>(
      `SELECT COALESCE(SUM(il.qty_milli * COALESCE(NULLIF(il.cost_minor, 0), it.cost_minor, 0) / 1000), 0)::bigint AS returned_cogs_minor
       FROM invoice_lines il
       JOIN invoices i ON i.id = il.invoice_id
       LEFT JOIN items it ON it.id = il.item_id
       WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.kind = 'credit_note' AND i.status = 'posted'
         AND (il.item_condition IS NULL OR il.item_condition = 'resellable')
         ${shiftClause} ${cashierClause} ${counterClause}`,
      [tenantId, branchId, bdate, ...shiftParams, ...cashierParams, ...counterParams],
    );
    const returnedCogsMinor = Number(returnedCogsRow?.returnedCogsMinor ?? returnedCogsRow?.returned_cogs_minor ?? 0);

    const netCogsMinor = Math.max(0, cogsMinor - returnedCogsMinor);
    const grossProfitMinor = netSalesMinor - netCogsMinor;
    const netProfitMinor = grossProfitMinor - operatingExpensesMinor;

    // Duplicate Invoices Detection: Check for potential duplicate billing events on this date
    const duplicateInvoices = await ctx.db.query<any>(
      `SELECT i1.id AS invoice_id_1, i1.number AS number_1,
              i2.id AS invoice_id_2, i2.number AS number_2,
              i1.total_minor, i1.customer_phone, i1.created_at
       FROM invoices i1
       JOIN invoices i2 ON i1.tenant_id = i2.tenant_id
                       AND i1.branch_id = i2.branch_id
                       AND i1.bdate = i2.bdate
                       AND i1.id < i2.id
                       AND i1.total_minor = i2.total_minor
                       AND i1.customer_phone = i2.customer_phone
                       AND i1.customer_phone IS NOT NULL
                       AND i1.customer_phone != ''
                       AND ABS(EXTRACT(EPOCH FROM (i1.created_at - i2.created_at))) < 180
       WHERE i1.tenant_id = ? AND i1.branch_id = ? AND i1.bdate = ?
         AND i1.status = 'posted' AND i2.status = 'posted'
       LIMIT 5`,
      [tenantId, branchId, bdate],
    );

    // Closing Reminder: Check if previous business day was unclosed
    const yesterdayDate = new Date(new Date(bdate).getTime() - 86400000).toISOString().slice(0, 10);
    const prevDayRecord = await ctx.db.one<any>(
      `SELECT id, status FROM day_closings WHERE tenant_id = ? AND branch_id = ? AND bdate = ?`,
      [tenantId, branchId, yesterdayDate],
    );
    const prevDayInvoices = await ctx.db.one<any>(
      `SELECT COUNT(*)::int AS count FROM invoices WHERE tenant_id = ? AND branch_id = ? AND bdate = ? AND status = 'posted'`,
      [tenantId, branchId, yesterdayDate],
    );
    const hasUnclosedPrevDay = Boolean(
      (prevDayInvoices?.count || 0) > 0 &&
      (!prevDayRecord || prevDayRecord.status === 'open' || prevDayRecord.status === 'submitted')
    );

    const audit = await runSmartClosingAudit(ctx.db, {
      tenantId,
      branchId,
      bdate,
      counterId,
      cashierId,
      shiftId,
      actualCashMinor: closedRecord ? Number(closedRecord.actual_cash_minor) : null,
    });

    return {
      bdate,
      branchId,
      shiftId: shiftId || null,
      cashierId: cashierId || null,
      counterId: counterId || null,
      availableShifts,
      availableCashiers,
      availableCounters,
      scheduleInfo,
      isClosed: Boolean(closedRecord && (closedRecord.status === 'closed' || closedRecord.status === 'approved')),
      isSubmitted: Boolean(closedRecord && closedRecord.status === 'submitted'),
      isReopened: Boolean(closedRecord && closedRecord.status === 'reopened'),
      status: closedRecord?.status || 'open',
      closedRecord: closedRecord || null,

      // A. Sales Summary
      salesSummary: {
        grossSalesMinor,
        discountsTotalMinor,
        returnsTotalMinor,
        netSalesMinor,
        taxableSalesMinor,
        gstCollectedMinor,
        invoicesCount,
        returnsCount,
        cancelledInvoicesCount,
        outstandingCustomerPaymentsMinor,
        averageBillValueMinor,
        totalProductsSold,
        totalQuantitiesSold: Math.round(totalQuantitiesSoldMilli / 1000),
        totalQuantitiesSoldMilli,
        totalCustomersBilled,
      },

      // B. Return Summary
      returnSummary: {
        totalReturnsCount: returnsCount,
        totalReturnValueMinor: returnsTotalMinor,
        cashRefundsPaidMinor,
        upiRefundsPaidMinor,
        exchangeCreditAdjustedMinor,
        storeCreditsIssuedMinor,
        totalRefundsMinor,
      },

      // C. Exchange Summary
      exchangeSummary: {
        exchangesCount,
        oldProductsReturnedMinor,
        newProductsSoldMinor,
        additionalAmountCollectedMinor,
        remainingCustomerCreditMinor,
      },

      // D. Payment Collections Summary
      paymentSummary: {
        cashCollectionsMinor,
        upiCollectionsMinor,
        cardCollectionsMinor,
        bankCollectionsMinor,
        storeCreditCollectionsMinor,
        totalCollectionsMinor: cashCollectionsMinor + upiCollectionsMinor + cardCollectionsMinor + bankCollectionsMinor + storeCreditCollectionsMinor,
        breakdown: collectionsSummary,
      },

      // E. Cash Reconciliation
      cashReconciliation: {
        openingCashMinor,
        cashSalesReceivedMinor: cashCollectionsMinor,
        cashRefundsPaidMinor,
        cashExpensesMinor,
        cashInMinor,
        cashOutMinor,
        expectedClosingCashMinor,
        actualClosingCashMinor: closedRecord ? Number(closedRecord.actual_cash_minor) : null,
        varianceMinor: closedRecord ? Number(closedRecord.variance_minor) : null,
      },

      // F. Profit & COGS Summary
      profitSummary: {
        netSalesMinor,
        cogsMinor,
        returnedCogsMinor,
        netCogsMinor,
        grossProfitMinor,
        operatingExpensesMinor,
        netProfitMinor,
        marginPct: netSalesMinor > 0 ? (grossProfitMinor / netSalesMinor) * 100 : 0,
      },

      // G. Pre-Closing Alerts & Reminders
      duplicateAlerts: duplicateInvoices.map((d: any) => ({
        invoice1: d.number_1 || d.invoice_id_1,
        invoice2: d.number_2 || d.invoice_id_2,
        amountMinor: Number(d.total_minor || 0),
        customerPhone: d.customer_phone,
      })),
      closingReminder: {
        hasUnclosedPrevDay,
        prevDayDate: yesterdayDate,
        message: hasUnclosedPrevDay ? `Notice: Previous business day (${yesterdayDate}) register has not been sealed yet.` : null,
      },

      // H. Smart Closing Audit & Detector Results
      audit,
    };
  });

  // --------------------------------------------------------------------------
  // 1b. Smart Closing Audit & Detector endpoint
  // --------------------------------------------------------------------------
  r.get('/api/day-closing/audit', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    const todayStr = new Date().toISOString().slice(0, 10);
    const bdate = String(ctx.query.bdate || ctx.query.date || todayStr).trim();
    const branchId = (!scope.isSuperAdminAll && scope.branchId) ? scope.branchId : String(ctx.query.branchId || 'MAIN').trim();
    const shiftId = ctx.query.shiftId ? String(ctx.query.shiftId).trim() : null;
    const userRole = String(ctx.user!.role || '').toUpperCase();
    const isCashier = userRole === 'CASHIER' || userRole === 'COUNTER';
    const cashierId = isCashier
      ? ctx.user!.id
      : (ctx.query.cashierId ? String(ctx.query.cashierId).trim() : null);
    const counterId = ctx.query.counterId ? String(ctx.query.counterId).trim() : null;
    const actualCashMinor = ctx.query.actualCashMinor != null && ctx.query.actualCashMinor !== ''
      ? Number(ctx.query.actualCashMinor)
      : null;

    const audit = await runSmartClosingAudit(ctx.db, {
      tenantId,
      branchId,
      bdate,
      counterId,
      cashierId,
      shiftId,
      actualCashMinor,
    });

    return {
      success: true,
      audit,
    };
  });

  // --------------------------------------------------------------------------
  // 2. Submit Day Closing (Cashier / Manager step)
  // --------------------------------------------------------------------------
  r.post('/api/day-closing/submit', requirePerm('shift'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};

    const todayStr = new Date().toISOString().slice(0, 10);
    const bdate = String(b.bdate || todayStr).trim();
    const branchId = String(b.branchId || ctx.user!.assignedLocation || 'MAIN').trim();
    const shiftId = b.shiftId ? String(b.shiftId).trim() : null;
    const actualCashMinor = V.int(b.actualCashMinor, 'Actual closing cash', { min: 0 });
    const remarks = V.optStr(b.remarks, 'Closing remarks', 500);
    const userRole = String(ctx.user!.role || '').toUpperCase();
    const isOwnerOrManager = ['OWNER', 'SUPER_ADMIN', 'STORE_MANAGER', 'MANAGER'].includes(userRole);
    const isCashier = userRole === 'CASHIER' || userRole === 'COUNTER';
    const cashierId = isCashier
      ? ctx.user!.id
      : (b.cashierId ? String(b.cashierId).trim() : null);
    const targetStatus = isCashier ? 'submitted' : (b.status || (isOwnerOrManager ? 'approved' : 'submitted'));
    const isAutoApprove = targetStatus === 'approved' || targetStatus === 'closed';

    let savedRecord: any = null;

    const shiftClause = shiftId ? ' AND i.shift_id = ?' : '';
    const shiftParams = shiftId ? [shiftId] : [];
    const cashierClause = cashierId ? ' AND i.created_by = ?' : '';
    const cashierParams = cashierId ? [cashierId] : [];

    await ctx.db.tx(async (q) => {
      // Prevent duplicate approved Day Closing (scoped per cashier if cashierId provided, or store-wide if null)
      const existing = await q.one<any>(
        `SELECT * FROM day_closings
         WHERE tenant_id = ? AND branch_id = ? AND bdate = ?
           ${cashierId ? 'AND (cashier_id = ? OR (cashier_id IS NULL AND (submitted_by = ? OR closed_by = ?)))' : 'AND cashier_id IS NULL'}
         FOR UPDATE`,
        cashierId ? [tenantId, branchId, bdate, cashierId, cashierId, cashierId] : [tenantId, branchId, bdate],
      );
      if (existing && (existing.status === 'closed' || existing.status === 'approved')) {
        throw bad(`Day ${bdate} register is already approved and sealed. Reopening is required to modify.`, 'ALREADY_CLOSED');
      }
      if (existing && existing.status === 'submitted' && !isOwnerOrManager) {
        throw bad('Day Closing has already been submitted and is awaiting Management approval.', 'ALREADY_SUBMITTED');
      }

      // Re-aggregate authoritative figures inside transaction
      const salesRow = await q.one<any>(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(total_minor), 0)::bigint AS total
         FROM invoices i
         WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.status = 'posted' AND i.kind = 'sale'
           ${shiftClause} ${cashierClause}`,
        [tenantId, branchId, bdate, ...shiftParams, ...cashierParams],
      );
      const returnsRow = await q.one<any>(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(total_minor), 0)::bigint AS total
         FROM invoices i
         WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.status = 'posted' AND i.kind = 'credit_note'
           ${shiftClause} ${cashierClause}`,
        [tenantId, branchId, bdate, ...shiftParams, ...cashierParams],
      );

      const grossSalesMinor = Number(salesRow?.total || 0);
      const returnsTotalMinor = Number(returnsRow?.total || 0);
      const netSalesMinor = Math.max(0, grossSalesMinor - returnsTotalMinor);
      const invoicesCount = Number(salesRow?.count || 0);
      const returnsCount = Number(returnsRow?.count || 0);

      const refundsRow = await q.one<any>(
        `SELECT
          COUNT(*)::int AS count,
          COALESCE(SUM(CASE WHEN method = 'cash' THEN amount_minor ELSE 0 END), 0)::bigint AS cash_refunds,
          COALESCE(SUM(CASE WHEN method = 'upi' THEN amount_minor ELSE 0 END), 0)::bigint AS upi_refunds
         FROM refund_transactions
         WHERE tenant_id = ? AND (bdate = ? OR (created_at)::date = ?::date)
           ${shiftId ? ' AND shift_id = ?' : ''}
           ${cashierId ? ' AND processed_by = ?' : ''}`,
        [tenantId, bdate, bdate, ...(shiftId ? [shiftId] : []), ...(cashierId ? [cashierId] : [])],
      );
      const cashRefundsMinor = Number(refundsRow?.cashRefunds ?? refundsRow?.cash_refunds ?? 0);
      const upiRefundsMinor = Number(refundsRow?.upiRefunds ?? refundsRow?.upi_refunds ?? 0);
      const refundsCount = Number(refundsRow?.count || 0);

      const exchangeRow = await q.one<any>(
        `SELECT
          COUNT(DISTINCT i.exchange_id)::int AS count,
          COALESCE(SUM(i.exchange_adjusted_minor), 0)::bigint AS adjusted,
          COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN i.total_minor ELSE 0 END), 0)::bigint AS new_sold,
          COALESCE(SUM(CASE WHEN i.kind = 'credit_note' THEN i.total_minor ELSE 0 END), 0)::bigint AS old_returned
         FROM invoices i
         WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.is_exchange = TRUE AND i.status = 'posted'
           ${shiftClause} ${cashierClause}`,
        [tenantId, branchId, bdate, ...shiftParams, ...cashierParams],
      );
      const exchangesCount = Number(exchangeRow?.count || 0);
      const exchangeAdjustedMinor = Number(exchangeRow?.adjusted || 0);
      const newSoldMinor = Number(exchangeRow?.newSold ?? exchangeRow?.new_sold ?? 0);
      const oldReturnedMinor = Number(exchangeRow?.oldReturned ?? exchangeRow?.old_returned ?? 0);

      const scRow = await q.one<any>(
        `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS total
         FROM store_credits
         WHERE tenant_id = ? AND DATE(created_at) = ?::date
           ${cashierId ? ' AND created_by = ?' : ''}`,
        [tenantId, bdate, ...(cashierId ? [cashierId] : [])],
      );
      const storeCreditsIssuedMinor = Number(scRow?.total || 0);

      let paymentsSql = `SELECT
          COALESCE(SUM(CASE WHEN COALESCE(p.method, 'cash') = 'cash' THEN p.amount_minor ELSE 0 END), 0)::bigint AS cash,
          COALESCE(SUM(CASE WHEN p.method = 'upi' THEN p.amount_minor ELSE 0 END), 0)::bigint AS upi,
          COALESCE(SUM(CASE WHEN p.method = 'card' THEN p.amount_minor ELSE 0 END), 0)::bigint AS card
         FROM payments p
         LEFT JOIN invoices i ON i.id = p.invoice_id
         WHERE p.tenant_id = ? AND (p.status IS NULL OR p.status = 'posted') AND (p.bdate = ? OR (p.created_at)::date = ?::date)
           AND (p.invoice_id IS NULL OR i.branch_id IS NULL OR i.branch_id = ?)`;
      const paymentsParams: any[] = [tenantId, bdate, bdate, branchId];
      if (shiftId) {
        paymentsSql += ' AND (i.shift_id = ? OR p.shift_id = ?)';
        paymentsParams.push(shiftId, shiftId);
      }
      if (cashierId) {
        paymentsSql += ' AND (p.created_by = ? OR (p.created_by IS NULL AND i.created_by = ?))';
        paymentsParams.push(cashierId, cashierId);
      }
      const paymentsRow = await q.one<any>(paymentsSql, paymentsParams);
      const cashSalesMinor = Number(paymentsRow?.cash || 0);
      const upiCollectionsMinor = Number(paymentsRow?.upi || 0);
      const cardCollectionsMinor = Number(paymentsRow?.card || 0);

      const shiftsRow = await q.one<any>(
        `SELECT COALESCE(SUM(opening_cash_minor), 0)::bigint AS total
         FROM shifts
         WHERE tenant_id = ? AND (location = ? OR branch_id = ?) AND (DATE(opened_at) = ?::date OR (created_at)::date = ?::date)
           ${shiftId ? ' AND id = ?' : ''}
           ${cashierId ? ' AND user_id = ?' : ''}`,
        [tenantId, branchId, branchId, bdate, bdate, ...(shiftId ? [shiftId] : []), ...(cashierId ? [cashierId] : [])],
      );
      const openingCashMinor = Number(shiftsRow?.total || 0);

      const expRow = await q.one<any>(
        `SELECT
          COALESCE(SUM(total_minor), 0)::bigint AS total,
          COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN total_minor ELSE 0 END), 0)::bigint AS cash
         FROM expenses
         WHERE tenant_id = ? AND branch_id = ? AND expense_date = ? AND status = 'posted'
           ${cashierId ? ' AND created_by = ?' : ''}`,
        [tenantId, branchId, bdate, ...(cashierId ? [cashierId] : [])],
      );
      const cashExpensesMinor = Number(expRow?.cash || 0);
      const operatingExpensesMinor = Number(expRow?.total || 0);

      const cmRow = await q.one<any>(
        `SELECT
          COALESCE(SUM(CASE WHEN cm.movement_type = 'cash_in' THEN cm.amount_minor ELSE 0 END), 0)::bigint AS cin,
          COALESCE(SUM(CASE WHEN cm.movement_type = 'cash_out' THEN cm.amount_minor ELSE 0 END), 0)::bigint AS cout
         FROM cash_movements cm
         JOIN shifts s ON s.id = cm.shift_id
         WHERE cm.tenant_id = ? AND (s.location = ? OR s.branch_id = ?) AND (DATE(cm.created_at) = ?::date)
           ${shiftId ? ' AND s.id = ?' : ''}
           ${cashierId ? ' AND s.user_id = ?' : ''}`,
        [tenantId, branchId, branchId, bdate, ...(shiftId ? [shiftId] : []), ...(cashierId ? [cashierId] : [])],
      );
      const cashInMinor = Number(cmRow?.cin || 0);
      const cashOutMinor = Number(cmRow?.cout || 0);

      const expectedCashMinor =
        openingCashMinor + cashSalesMinor - cashRefundsMinor - cashExpensesMinor - cashOutMinor + cashInMinor;
      const varianceMinor = actualCashMinor - expectedCashMinor;

      const salesCogsRow = await q.one<any>(
        `SELECT COALESCE(SUM(il.qty_milli * COALESCE(NULLIF(il.cost_minor, 0), it.cost_minor, 0) / 1000), 0)::bigint AS cogs
         FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id LEFT JOIN items it ON it.id = il.item_id
         WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.kind = 'sale' AND i.status = 'posted'
           ${shiftClause} ${cashierClause}`,
        [tenantId, branchId, bdate, ...shiftParams, ...cashierParams],
      );
      const cogsMinor = Number(salesCogsRow?.cogs || 0);

      const retCogsRow = await q.one<any>(
        `SELECT COALESCE(SUM(il.qty_milli * COALESCE(NULLIF(il.cost_minor, 0), it.cost_minor, 0) / 1000), 0)::bigint AS cogs
         FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id LEFT JOIN items it ON it.id = il.item_id
         WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.kind = 'credit_note' AND i.status = 'posted'
           AND (il.item_condition IS NULL OR il.item_condition = 'resellable')
           ${shiftClause} ${cashierClause}`,
        [tenantId, branchId, bdate, ...shiftParams, ...cashierParams],
      );
      const returnedCogsMinor = Number(retCogsRow?.cogs || 0);
      const netCogsMinor = Math.max(0, cogsMinor - returnedCogsMinor);
      const grossProfitMinor = netSalesMinor - netCogsMinor;
      const netProfitMinor = grossProfitMinor - operatingExpensesMinor;

      const closingId = existing?.id || newId('dc');
      const isAutoApprove = targetStatus === 'approved' || targetStatus === 'closed';

      const auditSnapshot = await runSmartClosingAudit(q, {
        tenantId,
        branchId,
        bdate,
        cashierId,
        shiftId,
        actualCashMinor,
      });

      if (existing) {
        await q.exec(
          `UPDATE day_closings
           SET status = ?,
               shift_id = ?,
               cashier_id = ?,
               submitted_by = ?,
               submitted_at = NOW(),
               approved_by = ?,
               approved_at = ?,
               reopened_by = NULL,
               reopened_at = NULL,
               reopen_reason = NULL,
               opening_cash_minor = ?, cash_sales_minor = ?, cash_refunds_minor = ?, cash_expenses_minor = ?,
               cash_in_minor = ?, cash_out_minor = ?, expected_cash_minor = ?, actual_cash_minor = ?, variance_minor = ?,
               gross_sales_minor = ?, returns_total_minor = ?, net_sales_minor = ?, invoices_count = ?, returns_count = ?,
               exchanges_count = ?, refunds_count = ?, cogs_minor = ?, returned_cogs_minor = ?, net_cogs_minor = ?,
               gross_profit_minor = ?, operating_expenses_minor = ?, net_profit_minor = ?,
               collections_summary = ?, returns_summary = ?, exchanges_summary = ?,
               remarks = ?, audit_summary = ?, closed_by = ?, closed_at = NOW()
           WHERE id = ?`,
          [
            targetStatus,
            shiftId || null,
            cashierId || null,
            ctx.user!.id,
            isAutoApprove ? ctx.user!.id : null,
            isAutoApprove ? new Date().toISOString() : null,
            openingCashMinor, cashSalesMinor, cashRefundsMinor, cashExpensesMinor,
            cashInMinor, cashOutMinor, expectedCashMinor, actualCashMinor, varianceMinor,
            grossSalesMinor, returnsTotalMinor, netSalesMinor, invoicesCount, returnsCount,
            exchangesCount, refundsCount, cogsMinor, returnedCogsMinor, netCogsMinor,
            grossProfitMinor, operatingExpensesMinor, netProfitMinor,
            j({ cash: cashSalesMinor, upi: upiCollectionsMinor, card: cardCollectionsMinor }),
            j({ totalValueMinor: returnsTotalMinor, cashRefundsMinor, upiRefundsMinor, exchangeAdjustedMinor, storeCreditsIssuedMinor }),
            j({ count: exchangesCount, oldReturnedMinor, newSoldMinor, diffCollectedMinor: Math.max(0, newSoldMinor - oldReturnedMinor), remainingCreditMinor: Math.max(0, oldReturnedMinor - newSoldMinor) }),
            remarks || null, j(auditSnapshot), ctx.user!.id, closingId,
          ],
        );
      } else {
        await q.exec(
          `INSERT INTO day_closings (
            id, tenant_id, branch_id, bdate, status, shift_id, cashier_id, submitted_by, submitted_at,
            approved_by, approved_at,
            opening_cash_minor, cash_sales_minor, cash_refunds_minor, cash_expenses_minor,
            cash_in_minor, cash_out_minor, expected_cash_minor, actual_cash_minor, variance_minor,
            gross_sales_minor, returns_total_minor, net_sales_minor, invoices_count, returns_count,
            exchanges_count, refunds_count, cogs_minor, returned_cogs_minor, net_cogs_minor,
            gross_profit_minor, operating_expenses_minor, net_profit_minor,
            collections_summary, returns_summary, exchanges_summary,
            remarks, audit_summary, closed_by, closed_at, created_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, NOW(),
            ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, NOW(), NOW()
          )`,
          [
            closingId, tenantId, branchId, bdate, targetStatus, shiftId || null, cashierId || null, ctx.user!.id,
            isAutoApprove ? ctx.user!.id : null,
            isAutoApprove ? new Date().toISOString() : null,
            openingCashMinor, cashSalesMinor, cashRefundsMinor, cashExpensesMinor,
            cashInMinor, cashOutMinor, expectedCashMinor, actualCashMinor, varianceMinor,
            grossSalesMinor, returnsTotalMinor, netSalesMinor, invoicesCount, returnsCount,
            exchangesCount, refundsCount, cogsMinor, returnedCogsMinor, netCogsMinor,
            grossProfitMinor, operatingExpensesMinor, netProfitMinor,
            j({ cash: cashSalesMinor, upi: upiCollectionsMinor, card: cardCollectionsMinor }),
            j({ totalValueMinor: returnsTotalMinor, cashRefundsMinor, upiRefundsMinor, exchangeAdjustedMinor, storeCreditsIssuedMinor }),
            j({ count: exchangesCount, oldReturnedMinor, newSoldMinor, diffCollectedMinor: Math.max(0, newSoldMinor - oldReturnedMinor), remainingCreditMinor: Math.max(0, oldReturnedMinor - newSoldMinor) }),
            remarks || null, j(auditSnapshot), ctx.user!.id,
          ],
        );
      }

      // If approved or closed, lock invoices for this date (scoped to cashier if cashier closing, or branch-wide if consolidated)
      if (isAutoApprove) {
        await q.exec(
          `UPDATE invoices SET is_day_closed = TRUE
           WHERE tenant_id = ? AND branch_id = ? AND bdate = ?
             ${cashierId ? ' AND created_by = ?' : ''}`,
          cashierId ? [tenantId, branchId, bdate, cashierId] : [tenantId, branchId, bdate],
        );
      }

      // Audit log
      await audit(q, ctx, {
        action: isAutoApprove ? 'day_closing.approve' : 'day_closing.submit',
        entity: 'day_closing',
        entityId: closingId,
        detail: {
          bdate,
          branchId,
          shiftId,
          cashierId,
          status: targetStatus,
          expectedCashMinor,
          actualCashMinor,
          varianceMinor,
          netSalesMinor,
          grossProfitMinor,
        },
      });

      savedRecord = {
        id: closingId,
        bdate,
        branchId,
        shiftId,
        cashierId,
        status: targetStatus,
        expectedCashMinor,
        actualCashMinor,
        varianceMinor,
        netSalesMinor,
        grossProfitMinor,
      };
    });

    return { success: true, dayClosing: savedRecord };
  });

  // --------------------------------------------------------------------------
  // 3. Approve Day Closing (Manager / Owner approval)
  // --------------------------------------------------------------------------
  r.post('/api/day-closing/:id/approve', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const id = ctx.params.id;
    const roleUpper = String(ctx.user!.role || '').toUpperCase();
    if (roleUpper !== 'OWNER' && roleUpper !== 'SUPER_ADMIN' && roleUpper !== 'MANAGER' && roleUpper !== 'STORE_MANAGER') {
      throw forbidden('Only managers and owners can approve day closings');
    }

    const dc = await ctx.db.one<any>(
      `SELECT * FROM day_closings WHERE tenant_id = ? AND id = ?`,
      [tenantId, id],
    );
    if (!dc) throw notFound('Day closing record');

    const dcBranchId = dc.branch_id ?? dc.branchId;
    const dcBdate = dc.bdate;
    const dcCashierId = dc.cashier_id ?? dc.cashierId ?? null;
    const cashierClause = dcCashierId ? ' AND created_by = ?' : '';
    const cashierParams = dcCashierId ? [dcCashierId] : [];

    await ctx.db.tx(async (q) => {
      // Re-aggregate authoritative figures in case new bills/returns were added while reopened
      const salesRow = await q.one<any>(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(total_minor), 0)::bigint AS total
         FROM invoices WHERE tenant_id = ? AND branch_id = ? AND bdate = ? AND status = 'posted' AND kind = 'sale'
           ${cashierClause}`,
        [tenantId, dcBranchId, dcBdate, ...cashierParams],
      );
      const returnsRow = await q.one<any>(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(total_minor), 0)::bigint AS total
         FROM invoices WHERE tenant_id = ? AND branch_id = ? AND bdate = ? AND status = 'posted' AND kind = 'credit_note'
           ${cashierClause}`,
        [tenantId, dcBranchId, dcBdate, ...cashierParams],
      );
      const grossSalesMinor = Number(salesRow?.total || 0);
      const returnsTotalMinor = Number(returnsRow?.total || 0);
      const netSalesMinor = Math.max(0, grossSalesMinor - returnsTotalMinor);
      const invoicesCount = Number(salesRow?.count || 0);
      const returnsCount = Number(returnsRow?.count || 0);

      await q.exec(
        `UPDATE day_closings
         SET status = 'approved',
             approved_by = ?,
             approved_at = NOW(),
             reopened_by = NULL,
             reopened_at = NULL,
             reopen_reason = NULL,
             gross_sales_minor = ?,
             returns_total_minor = ?,
             net_sales_minor = ?,
             invoices_count = ?,
             returns_count = ?
         WHERE id = ? AND tenant_id = ?`,
        [ctx.user!.id, grossSalesMinor, returnsTotalMinor, netSalesMinor, invoicesCount, returnsCount, id, tenantId],
      );

      // Lock invoices for this day (scoped to cashier if cashier closing, or branch-wide if consolidated)
      await q.exec(
        `UPDATE invoices SET is_day_closed = TRUE
         WHERE tenant_id = ? AND branch_id = ? AND bdate = ?
           ${dcCashierId ? ' AND created_by = ?' : ''}`,
        dcCashierId ? [tenantId, dcBranchId, dcBdate, dcCashierId] : [tenantId, dcBranchId, dcBdate],
      );

      await audit(q, ctx, {
        action: 'day_closing.approve',
        entity: 'day_closing',
        entityId: id,
        detail: { bdate: dcBdate, branchId: dcBranchId, cashierId: dcCashierId, approvedBy: ctx.user!.id },
      });

      await q.exec(
        `INSERT INTO day_closing_notifications (
           id, tenant_id, branch_id, cashier_id, bdate, type, title, message, severity
         ) VALUES (?, ?, ?, ?, ?, 'approval', 'Day Closing Approved', ?, 'success')`,
        [newId('dcn'), tenantId, dcBranchId, dcCashierId || dc.submitted_by || null, dcBdate,
         `Day Closing for date ${dcBdate} was verified and approved by ${ctx.user!.name || 'Management'}.`],
      );
    });

    return {
      success: true,
      dayClosing: { ...dc, status: 'approved', approved_by: ctx.user!.id, approved_at: new Date().toISOString() },
      message: `Day closing for ${dc.bdate} approved successfully`,
    };
  });

  // --------------------------------------------------------------------------
  // 3b. Reject Day Closing (Manager / Owner rejection - returns to Cashier for recount)
  // --------------------------------------------------------------------------
  r.post('/api/day-closing/:id/reject', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const id = ctx.params.id;
    const roleUpper = String(ctx.user!.role || '').toUpperCase();
    if (roleUpper !== 'OWNER' && roleUpper !== 'SUPER_ADMIN' && roleUpper !== 'MANAGER' && roleUpper !== 'STORE_MANAGER') {
      throw forbidden('Only managers and owners can reject day closings');
    }

    const reason = V.str(ctx.body?.reason, 'Rejection reason', { min: 5, max: 500, required: true });

    const dc = await ctx.db.one<any>(
      `SELECT * FROM day_closings WHERE tenant_id = ? AND id = ?`,
      [tenantId, id],
    );
    if (!dc) throw notFound('Day closing record');

    if (dc.status === 'approved' || dc.status === 'closed') {
      throw bad('Cannot reject an already approved day closing. Reopening is required first.', 'ALREADY_APPROVED');
    }

    const dcBranchId = dc.branch_id ?? dc.branchId;
    const dcBdate = dc.bdate;
    const dcCashierId = dc.cashier_id ?? dc.cashierId ?? null;

    await ctx.db.tx(async (q) => {
      await q.exec(
        `UPDATE day_closings
         SET status = 'open',
             remarks = ?,
             reopened_by = NULL,
             reopened_at = NULL,
             reopen_reason = NULL
         WHERE id = ? AND tenant_id = ?`,
        [`[Returned for Recount by ${ctx.user!.name}]: ${reason}`, id, tenantId],
      );

      // Invoices remain open for cashier adjustments
      await q.exec(
        `UPDATE invoices SET is_day_closed = FALSE
         WHERE tenant_id = ? AND branch_id = ? AND bdate = ?
           ${dcCashierId ? ' AND created_by = ?' : ''}`,
        dcCashierId ? [tenantId, dcBranchId, dcBdate, dcCashierId] : [tenantId, dcBranchId, dcBdate],
      );

      await audit(q, ctx, {
        action: 'day_closing.reject',
        entity: 'day_closing',
        entityId: id,
        detail: { bdate: dcBdate, branchId: dcBranchId, cashierId: dcCashierId, rejectedBy: ctx.user!.id, reason },
      });

      await q.exec(
        `INSERT INTO day_closing_notifications (
           id, tenant_id, branch_id, cashier_id, bdate, type, title, message, severity
         ) VALUES (?, ?, ?, ?, ?, 'rejection', 'Day Closing Recount Requested', ?, 'warning')`,
        [newId('dcn'), tenantId, dcBranchId, dcCashierId || dc.submitted_by || null, dcBdate,
         `Management requested a recount for date ${dcBdate}. Reason: ${reason}`],
      );
    });

    return {
      success: true,
      dayClosing: { ...dc, status: 'open', remarks: `[Returned for Recount by ${ctx.user!.name}]: ${reason}` },
      message: `Day closing returned to Cashier for recount: ${reason}`,
    };
  });

  // --------------------------------------------------------------------------
  // 4. Reopen Day Closing (Owner authorization / Manager PIN verification)
  // --------------------------------------------------------------------------
  r.post('/api/day-closing/:id/reopen', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const id = ctx.params.id;
    const roleUpper = String(ctx.user!.role || '').toUpperCase();
    const isOwner = roleUpper === 'OWNER' || roleUpper === 'SUPER_ADMIN';
    const isManager = roleUpper === 'MANAGER' || roleUpper === 'STORE_MANAGER';
    if (!isOwner && !isManager) {
      throw forbidden('Only business owners or authorized managers can reopen a closed business day');
    }

    const reason = V.str(ctx.body?.reason, 'Reopening reason', { min: 5, max: 500, required: true });
    const pin = ctx.body?.pin ? String(ctx.body.pin).trim() : '';

    if (isManager) {
      if (!pin) {
        throw bad('Secure PIN or Manager password is required to reopen a closed day', 'PIN_REQUIRED');
      }
      const currentUserRecord = await ctx.db.one<any>('SELECT password_hash FROM users WHERE id = ? AND tenant_id = ?', [ctx.user!.id, tenantId]);
      let isVerified = false;
      if (currentUserRecord?.password_hash && verifyPassword(pin, currentUserRecord.password_hash)) {
        isVerified = true;
      } else {
        const owners = await ctx.db.query<any>("SELECT password_hash FROM users WHERE tenant_id = ? AND role IN ('owner', 'super_admin') AND active = true", [tenantId]);
        for (const o of owners) {
          if (o.password_hash && verifyPassword(pin, o.password_hash)) {
            isVerified = true;
            break;
          }
        }
      }
      if (!isVerified) {
        throw bad('Invalid security PIN or password authorization', 'INVALID_PIN');
      }
    }

    const dc = await ctx.db.one<any>(
      `SELECT * FROM day_closings WHERE tenant_id = ? AND id = ?`,
      [tenantId, id],
    );
    if (!dc) throw notFound('Day closing record');

    const dcBranchId = dc.branch_id ?? dc.branchId;
    const dcBdate = dc.bdate;
    const dcCashierId = dc.cashier_id ?? dc.cashierId ?? null;

    await ctx.db.tx(async (q) => {
      await q.exec(
        `UPDATE day_closings
         SET status = 'reopened', reopened_by = ?, reopened_at = NOW(), reopen_reason = ?
         WHERE id = ? AND tenant_id = ?`,
        [ctx.user!.id, reason, id, tenantId],
      );

      // Unlock invoices for this day
      await q.exec(
        `UPDATE invoices SET is_day_closed = FALSE
         WHERE tenant_id = ? AND branch_id = ? AND bdate = ?
           ${dcCashierId ? ' AND created_by = ?' : ''}`,
        dcCashierId ? [tenantId, dcBranchId, dcBdate, dcCashierId] : [tenantId, dcBranchId, dcBdate],
      );

      await audit(q, ctx, {
        action: 'day_closing.reopen',
        entity: 'day_closing',
        entityId: id,
        detail: { bdate: dcBdate, branchId: dcBranchId, reopenedBy: ctx.user!.id, reason },
      });
    });

    return {
      success: true,
      dayClosing: { ...dc, status: 'reopened', reopened_by: ctx.user!.id, reopen_reason: reason, reopened_at: new Date().toISOString() },
      message: `Day closing for ${dc.bdate} reopened. Transactions can be adjusted.`,
    };
  });

  // --------------------------------------------------------------------------
  // 5. Today vs Previous Day Comparison Engine (Phase 5)
  // --------------------------------------------------------------------------
  r.get('/api/day-closing/comparison', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    const todayStr = new Date().toISOString().slice(0, 10);
    const currentDate = String(ctx.query.date || todayStr).trim();
    const branchId = (!scope.isSuperAdminAll && scope.branchId) ? scope.branchId : String(ctx.query.branchId || 'MAIN').trim();

    // Helper to calculate standard single-day metrics
    async function getDayMetrics(dateStr: string) {
      const sales = await ctx.db.one<any>(
        `SELECT
          COUNT(*)::int AS invoices_count,
          COALESCE(SUM(total_minor), 0)::bigint AS gross_sales_minor,
          COALESCE(SUM(discount_minor), 0)::bigint AS discounts_minor,
          COALESCE(SUM(cgst_minor + sgst_minor + igst_minor), 0)::bigint AS gst_minor
         FROM invoices
         WHERE tenant_id = ? AND branch_id = ? AND bdate = ? AND status = 'posted' AND kind = 'sale'`,
        [tenantId, branchId, dateStr],
      );

      const returns = await ctx.db.one<any>(
        `SELECT
          COUNT(*)::int AS returns_count,
          COALESCE(SUM(total_minor), 0)::bigint AS returns_minor
         FROM invoices
         WHERE tenant_id = ? AND branch_id = ? AND bdate = ? AND status = 'posted' AND kind = 'credit_note'`,
        [tenantId, branchId, dateStr],
      );

      const exp = await ctx.db.one<any>(
        `SELECT COALESCE(SUM(total_minor), 0)::bigint AS expenses_minor
         FROM expenses WHERE tenant_id = ? AND branch_id = ? AND expense_date = ? AND status = 'posted'`,
        [tenantId, branchId, dateStr],
      );

      const cogsRow = await ctx.db.one<any>(
        `SELECT COALESCE(SUM(il.qty_milli * COALESCE(NULLIF(il.cost_minor, 0), it.cost_minor, 0) / 1000), 0)::bigint AS cogs
         FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id LEFT JOIN items it ON it.id = il.item_id
         WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.kind = 'sale' AND i.status = 'posted'`,
        [tenantId, branchId, dateStr],
      );

      const retCogsRow = await ctx.db.one<any>(
        `SELECT COALESCE(SUM(il.qty_milli * COALESCE(NULLIF(il.cost_minor, 0), it.cost_minor, 0) / 1000), 0)::bigint AS cogs
         FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id LEFT JOIN items it ON it.id = il.item_id
         WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate = ? AND i.kind = 'credit_note' AND i.status = 'posted'
           AND (il.item_condition IS NULL OR il.item_condition = 'resellable')`,
        [tenantId, branchId, dateStr],
      );

      const grossSales = Number(sales?.grossSalesMinor ?? sales?.gross_sales_minor ?? 0);
      const discounts = Number(sales?.discountsMinor ?? sales?.discounts_minor ?? 0);
      const returnsTotal = Number(returns?.returnsMinor ?? returns?.returns_minor ?? 0);
      const netSales = Math.max(0, grossSales - returnsTotal);
      const gst = Number(sales?.gstMinor ?? sales?.gst_minor ?? 0);
      const grossCogs = Number(cogsRow?.cogs || 0);
      const retCogs = Number(retCogsRow?.cogs || 0);
      const netCogs = Math.max(0, grossCogs - retCogs);
      const grossProfit = netSales - netCogs;
      const expenses = Number(exp?.expensesMinor ?? exp?.expenses_minor ?? 0);
      const operatingProfit = grossProfit - expenses;
      const invoicesCount = Number(sales?.invoicesCount ?? sales?.invoices_count ?? 0);
      const avgBill = invoicesCount > 0 ? Math.round(netSales / invoicesCount) : 0;

      return {
        grossSalesMinor: grossSales,
        discountsMinor: discounts,
        returnsTotalMinor: returnsTotal,
        netSalesMinor: netSales,
        gstCollectedMinor: gst,
        netCogsMinor: netCogs,
        grossProfitMinor: grossProfit,
        expensesMinor: expenses,
        operatingProfitMinor: operatingProfit,
        invoicesCount,
        averageBillValueMinor: avgBill,
      };
    }

    // Find the previous business day with transactions, or default to yesterday
    const prevDayRow = await ctx.db.one<any>(
      `SELECT DISTINCT bdate FROM invoices
       WHERE tenant_id = ? AND branch_id = ? AND bdate < ? AND status = 'posted'
       ORDER BY bdate DESC LIMIT 1`,
      [tenantId, branchId, currentDate],
    );

    // If no previous date found in DB, use calendar yesterday
    const prevDate = prevDayRow?.bdate || (() => {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    })();

    const currentMetrics = await getDayMetrics(currentDate);
    const previousMetrics = await getDayMetrics(prevDate);

    // Build metric comparisons with growth %
    function buildComparisonItem(curr: number, prev: number) {
      return {
        current: curr,
        previous: prev,
        difference: curr - prev,
        growthPct: calcGrowth(curr, prev),
      };
    }

    const comparison = {
      currentDate,
      previousDate: prevDate,
      metrics: {
        grossSales: buildComparisonItem(currentMetrics.grossSalesMinor, previousMetrics.grossSalesMinor),
        discounts: buildComparisonItem(currentMetrics.discountsMinor, previousMetrics.discountsMinor),
        returns: buildComparisonItem(currentMetrics.returnsTotalMinor, previousMetrics.returnsTotalMinor),
        netSales: buildComparisonItem(currentMetrics.netSalesMinor, previousMetrics.netSalesMinor),
        gstCollected: buildComparisonItem(currentMetrics.gstCollectedMinor, previousMetrics.gstCollectedMinor),
        cogs: buildComparisonItem(currentMetrics.netCogsMinor, previousMetrics.netCogsMinor),
        grossProfit: buildComparisonItem(currentMetrics.grossProfitMinor, previousMetrics.grossProfitMinor),
        expenses: buildComparisonItem(currentMetrics.expensesMinor, previousMetrics.expensesMinor),
        operatingProfit: buildComparisonItem(currentMetrics.operatingProfitMinor, previousMetrics.operatingProfitMinor),
        invoiceCount: buildComparisonItem(currentMetrics.invoicesCount, previousMetrics.invoicesCount),
        averageBillValue: buildComparisonItem(currentMetrics.averageBillValueMinor, previousMetrics.averageBillValueMinor),
      },
    };

    // Last 7 days trend for charting
    const last7DaysTrend: any[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(currentDate);
      d.setDate(d.getDate() - i);
      const dStr = d.toISOString().slice(0, 10);
      const m = await getDayMetrics(dStr);
      last7DaysTrend.push({
        date: dStr,
        grossSalesMinor: m.grossSalesMinor,
        netSalesMinor: m.netSalesMinor,
        grossProfitMinor: m.grossProfitMinor,
        expensesMinor: m.expensesMinor,
        invoicesCount: m.invoicesCount,
      });
    }

    return {
      bdate: currentDate,
      currentDate,
      previousDate: prevDate,
      metrics: {
        ...comparison.metrics,
        invoicesCount: comparison.metrics.invoiceCount,
      },
      comparison,
      last7DaysTrend,
    };
  });

  // --------------------------------------------------------------------------
  // 6. Custom Date Range Business Analytics Engine (Phase 6)
  // --------------------------------------------------------------------------
  r.get('/api/day-closing/analytics', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    const todayStr = new Date().toISOString().slice(0, 10);
    const startDate = String(ctx.query.startDate || todayStr).trim();
    const endDate = String(ctx.query.endDate || todayStr).trim();
    const branchId = (!scope.isSuperAdminAll && scope.branchId) ? scope.branchId : (ctx.query.branchId ? String(ctx.query.branchId).trim() : 'all');
    const comparisonMode = String(ctx.query.comparisonMode || 'previous_period'); // 'previous_period' | 'same_period_last_year' | 'none'

    const branchFilter = (branchId && branchId !== 'all') ? ' AND i.branch_id = ?' : '';
    const branchParams = (branchId && branchId !== 'all') ? [branchId] : [];

    // Helper to calculate aggregations over any date range
    async function calculateRangeMetrics(start: string, end: string) {
      const sales = await ctx.db.one<any>(
        `SELECT
          COUNT(*)::int AS invoices_count,
          COALESCE(SUM(total_minor), 0)::bigint AS gross_sales_minor,
          COALESCE(SUM(discount_minor), 0)::bigint AS discounts_minor,
          COALESCE(SUM(taxable_minor), 0)::bigint AS taxable_minor,
          COALESCE(SUM(cgst_minor + sgst_minor + igst_minor), 0)::bigint AS gst_minor
         FROM invoices i
         WHERE i.tenant_id = ? AND i.bdate >= ? AND i.bdate <= ? AND i.status = 'posted' AND i.kind = 'sale'
           ${branchFilter}`,
        [tenantId, start, end, ...branchParams],
      );

      const returns = await ctx.db.one<any>(
        `SELECT
          COUNT(*)::int AS returns_count,
          COALESCE(SUM(total_minor), 0)::bigint AS returns_minor
         FROM invoices i
         WHERE i.tenant_id = ? AND i.bdate >= ? AND i.bdate <= ? AND i.status = 'posted' AND i.kind = 'credit_note'
           ${branchFilter}`,
        [tenantId, start, end, ...branchParams],
      );

      const expFilter = (branchId && branchId !== 'all') ? ' AND branch_id = ?' : '';
      const expParams = (branchId && branchId !== 'all') ? [branchId] : [];
      const exp = await ctx.db.one<any>(
        `SELECT COALESCE(SUM(total_minor), 0)::bigint AS expenses_minor
         FROM expenses WHERE tenant_id = ? AND expense_date >= ? AND expense_date <= ? AND status = 'posted'
           ${expFilter}`,
        [tenantId, start, end, ...expParams],
      );

      const cogsRow = await ctx.db.one<any>(
        `SELECT COALESCE(SUM(il.qty_milli * COALESCE(NULLIF(il.cost_minor, 0), it.cost_minor, 0) / 1000), 0)::bigint AS cogs
         FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id LEFT JOIN items it ON it.id = il.item_id
         WHERE i.tenant_id = ? AND i.bdate >= ? AND i.bdate <= ? AND i.kind = 'sale' AND i.status = 'posted'
           ${branchFilter}`,
        [tenantId, start, end, ...branchParams],
      );

      const retCogsRow = await ctx.db.one<any>(
        `SELECT COALESCE(SUM(il.qty_milli * COALESCE(NULLIF(il.cost_minor, 0), it.cost_minor, 0) / 1000), 0)::bigint AS cogs
         FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id LEFT JOIN items it ON it.id = il.item_id
         WHERE i.tenant_id = ? AND i.bdate >= ? AND i.bdate <= ? AND i.kind = 'credit_note' AND i.status = 'posted'
           AND (il.item_condition IS NULL OR il.item_condition = 'resellable')
           ${branchFilter}`,
        [tenantId, start, end, ...branchParams],
      );

      const grossSales = Number(sales?.grossSalesMinor ?? sales?.gross_sales_minor ?? 0);
      const discounts = Number(sales?.discountsMinor ?? sales?.discounts_minor ?? 0);
      const returnsTotal = Number(returns?.returnsMinor ?? returns?.returns_minor ?? 0);
      const netSales = Math.max(0, grossSales - returnsTotal);
      const gst = Number(sales?.gstMinor ?? sales?.gst_minor ?? 0);
      const taxable = Number(sales?.taxableMinor ?? sales?.taxable_minor ?? 0);
      const grossCogs = Number(cogsRow?.cogs || 0);
      const retCogs = Number(retCogsRow?.cogs || 0);
      const netCogs = Math.max(0, grossCogs - retCogs);
      const grossProfit = netSales - netCogs;
      const expenses = Number(exp?.expensesMinor ?? exp?.expenses_minor ?? 0);
      const operatingProfit = grossProfit - expenses;
      const invoicesCount = Number(sales?.invoicesCount ?? sales?.invoices_count ?? 0);
      const avgBill = invoicesCount > 0 ? Math.round(netSales / invoicesCount) : 0;

      return {
        grossSalesMinor: grossSales,
        discountsMinor: discounts,
        returnsTotalMinor: returnsTotal,
        netSalesMinor: netSales,
        taxableMinor: taxable,
        gstCollectedMinor: gst,
        netCogsMinor: netCogs,
        grossProfitMinor: grossProfit,
        expensesMinor: expenses,
        operatingProfitMinor: operatingProfit,
        invoicesCount,
        averageBillValueMinor: avgBill,
      };
    }

    const currentRange = await calculateRangeMetrics(startDate, endDate);

    // Compute equivalent comparison date range
    let comparisonStartDate = '';
    let comparisonEndDate = '';
    let comparisonRange: any = null;

    if (comparisonMode !== 'none') {
      const sDate = new Date(startDate);
      const eDate = new Date(endDate);
      const diffMs = eDate.getTime() - sDate.getTime();
      const diffDays = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1);

      if (comparisonMode === 'same_period_last_year') {
        const ps = new Date(sDate);
        ps.setFullYear(ps.getFullYear() - 1);
        const pe = new Date(eDate);
        pe.setFullYear(pe.getFullYear() - 1);
        comparisonStartDate = ps.toISOString().slice(0, 10);
        comparisonEndDate = pe.toISOString().slice(0, 10);
      } else {
        // 'previous_period': interval of equal duration immediately preceding startDate
        const pe = new Date(sDate);
        pe.setDate(pe.getDate() - 1);
        const ps = new Date(pe);
        ps.setDate(ps.getDate() - (diffDays - 1));
        comparisonStartDate = ps.toISOString().slice(0, 10);
        comparisonEndDate = pe.toISOString().slice(0, 10);
      }

      comparisonRange = await calculateRangeMetrics(comparisonStartDate, comparisonEndDate);
    }

    // Daily time series for trend visualization
    const dailySeries = await ctx.db.query<any>(
      `SELECT
        i.bdate,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN i.total_minor ELSE 0 END), 0)::bigint AS gross_sales,
        COALESCE(SUM(CASE WHEN i.kind = 'credit_note' THEN i.total_minor ELSE 0 END), 0)::bigint AS returns,
        COUNT(CASE WHEN i.kind = 'sale' THEN 1 END)::int AS invoices_count
       FROM invoices i
       WHERE i.tenant_id = ? AND i.bdate >= ? AND i.bdate <= ? AND i.status = 'posted'
         ${branchFilter}
       GROUP BY i.bdate
       ORDER BY i.bdate ASC`,
      [tenantId, startDate, endDate, ...branchParams],
    );

    function buildRangeComp(curr: number, prev: number = 0) {
      return {
        current: curr,
        previous: prev,
        difference: curr - prev,
        growthPct: calcGrowth(curr, prev),
      };
    }

    return {
      period: {
        startDate,
        endDate,
        comparisonMode,
        comparisonStartDate,
        comparisonEndDate,
      },
      current: currentRange,
      comparison: comparisonRange ? {
        grossSales: buildRangeComp(currentRange.grossSalesMinor, comparisonRange.grossSalesMinor),
        discounts: buildRangeComp(currentRange.discountsMinor, comparisonRange.discountsMinor),
        returns: buildRangeComp(currentRange.returnsTotalMinor, comparisonRange.returnsTotalMinor),
        netSales: buildRangeComp(currentRange.netSalesMinor, comparisonRange.netSalesMinor),
        gstCollected: buildRangeComp(currentRange.gstCollectedMinor, comparisonRange.gstCollectedMinor),
        cogs: buildRangeComp(currentRange.netCogsMinor, comparisonRange.netCogsMinor),
        grossProfit: buildRangeComp(currentRange.grossProfitMinor, comparisonRange.grossProfitMinor),
        expenses: buildRangeComp(currentRange.expensesMinor, comparisonRange.expensesMinor),
        operatingProfit: buildRangeComp(currentRange.operatingProfitMinor, comparisonRange.operatingProfitMinor),
        invoiceCount: buildRangeComp(currentRange.invoicesCount, comparisonRange.invoicesCount),
        averageBillValue: buildRangeComp(currentRange.averageBillValueMinor, comparisonRange.averageBillValueMinor),
      } : null,
      dailySeries: dailySeries.map((d: any) => {
        const gross = Number(d.grossSales ?? d.gross_sales ?? 0);
        const ret = Number(d.returns ?? 0);
        return {
          date: d.bdate,
          grossSalesMinor: gross,
          returnsMinor: ret,
          netSalesMinor: Math.max(0, gross - ret),
          invoicesCount: Number(d.invoicesCount ?? d.invoices_count ?? 0),
        };
      }),
    };
  });

  // --------------------------------------------------------------------------
  // 7. Product-Wise Profitability & Performance (Phase 7)
  // --------------------------------------------------------------------------
  r.get('/api/day-closing/product-profitability', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    const todayStr = new Date().toISOString().slice(0, 10);
    const startDate = String(ctx.query.startDate || todayStr).trim();
    const endDate = String(ctx.query.endDate || todayStr).trim();
    const branchId = (!scope.isSuperAdminAll && scope.branchId) ? scope.branchId : (ctx.query.branchId ? String(ctx.query.branchId).trim() : 'all');
    const filter = String(ctx.query.filter || 'all').trim(); // 'all' | 'top_selling' | 'highest_revenue' | 'highest_profit' | 'lowest_profit' | 'loss_making' | 'most_returned'

    const branchFilter = (branchId && branchId !== 'all') ? ' AND i.branch_id = ?' : '';
    const branchParams = (branchId && branchId !== 'all') ? [branchId] : [];

    const rows = await ctx.db.query<any>(
      `SELECT
        il.item_id,
        il.name AS item_name,
        it.sku,
        it.barcode,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN il.qty_milli ELSE 0 END), 0)::bigint AS qty_sold_milli,
        COALESCE(SUM(CASE WHEN i.kind = 'credit_note' THEN il.qty_milli ELSE 0 END), 0)::bigint AS qty_returned_milli,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN il.total_minor ELSE 0 END), 0)::bigint AS gross_revenue_minor,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN il.discount_minor ELSE 0 END), 0)::bigint AS discounts_minor,
        COALESCE(SUM(CASE WHEN i.kind = 'credit_note' THEN il.total_minor ELSE 0 END), 0)::bigint AS return_value_minor,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN (il.qty_milli * COALESCE(NULLIF(il.cost_minor, 0), it.cost_minor, 0) / 1000) ELSE 0 END), 0)::bigint AS sales_cogs_minor,
        COALESCE(SUM(CASE WHEN i.kind = 'credit_note' AND (il.item_condition IS NULL OR il.item_condition = 'resellable') THEN (il.qty_milli * COALESCE(NULLIF(il.cost_minor, 0), it.cost_minor, 0) / 1000) ELSE 0 END), 0)::bigint AS return_cogs_minor
       FROM invoice_lines il
       JOIN invoices i ON i.id = il.invoice_id
       LEFT JOIN items it ON it.id = il.item_id
       WHERE i.tenant_id = ? AND i.bdate >= ? AND i.bdate <= ? AND i.status = 'posted'
         ${branchFilter}
       GROUP BY il.item_id, il.name, it.sku, it.barcode`,
      [tenantId, startDate, endDate, ...branchParams],
    );

    let products = rows.map((r: any) => {
      const qtySoldMilli = Number(r.qtySoldMilli ?? r.qty_sold_milli ?? 0);
      const qtyReturnedMilli = Number(r.qtyReturnedMilli ?? r.qty_returned_milli ?? 0);
      const netQtySoldMilli = qtySoldMilli - qtyReturnedMilli;
      const grossRevenueMinor = Number(r.grossRevenueMinor ?? r.gross_revenue_minor ?? 0);
      const discountsMinor = Number(r.discountsMinor ?? r.discounts_minor ?? 0);
      const returnValueMinor = Number(r.returnValueMinor ?? r.return_value_minor ?? 0);
      const netRevenueMinor = Math.max(0, grossRevenueMinor - returnValueMinor);
      const salesCogsMinor = Number(r.salesCogsMinor ?? r.sales_cogs_minor ?? 0);
      const returnCogsMinor = Number(r.returnCogsMinor ?? r.return_cogs_minor ?? 0);
      const netCogsMinor = Math.max(0, salesCogsMinor - returnCogsMinor);
      const grossProfitMinor = netRevenueMinor - netCogsMinor;
      const marginPct = netRevenueMinor > 0 ? (grossProfitMinor / netRevenueMinor) * 100 : 0;
      const returnRatePct = qtySoldMilli > 0 ? (qtyReturnedMilli / qtySoldMilli) * 100 : 0;

      return {
        id: r.itemId || r.item_id,
        itemId: r.itemId || r.item_id,
        name: r.itemName || r.item_name || r.name,
        sku: r.sku || '-',
        barcode: r.barcode || '-',
        qty_sold: Math.round(qtySoldMilli / 1000),
        qty_returned: Math.round(qtyReturnedMilli / 1000),
        net_qty: Math.round(netQtySoldMilli / 1000),
        gross_sales_minor: grossRevenueMinor,
        returns_minor: returnValueMinor,
        net_sales_minor: netRevenueMinor,
        cogs_minor: netCogsMinor,
        gross_profit_minor: grossProfitMinor,
        gross_margin_pct: Math.round(marginPct * 10) / 10,
        return_rate_pct: Math.round(returnRatePct * 10) / 10,
        qtySoldMilli,
        qtyReturnedMilli,
        netQtySoldMilli,
        grossRevenueMinor,
        discountsMinor,
        returnValueMinor,
        netRevenueMinor,
        netCogsMinor,
        grossProfitMinor,
        marginPct: Math.round(marginPct * 10) / 10,
        returnRatePct: Math.round(returnRatePct * 10) / 10,
      };
    });

    // Apply Filter / Sorting
    if (filter === 'top_selling') {
      products.sort((a, b) => b.netQtySoldMilli - a.netQtySoldMilli);
    } else if (filter === 'highest_revenue') {
      products.sort((a, b) => b.netRevenueMinor - a.netRevenueMinor);
    } else if (filter === 'highest_profit') {
      products.sort((a, b) => b.grossProfitMinor - a.grossProfitMinor);
    } else if (filter === 'lowest_profit') {
      products = products.filter(p => p.grossProfitMinor >= 0);
      products.sort((a, b) => a.grossProfitMinor - b.grossProfitMinor);
    } else if (filter === 'loss_making') {
      products = products.filter(p => p.grossProfitMinor < 0);
      products.sort((a, b) => a.grossProfitMinor - b.grossProfitMinor);
    } else if (filter === 'most_returned') {
      products = products.filter(p => p.qtyReturnedMilli > 0);
      products.sort((a, b) => b.returnRatePct - a.returnRatePct);
    } else {
      // Default: Highest profit first
      products.sort((a, b) => b.grossProfitMinor - a.grossProfitMinor);
    }

    return {
      startDate,
      endDate,
      filter,
      totalProductsCount: products.length,
      products,
    };
  });

  // --------------------------------------------------------------------------
  // 7b. Counter-wise Sales Breakdown Report (Day Closing Scope Only)
  // --------------------------------------------------------------------------
  r.get('/api/day-closing/counter-sales', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    const branchId = (!scope.isSuperAdminAll && scope.branchId) ? scope.branchId : String(ctx.query.branchId || 'MAIN').trim();
    const todayStr = new Date().toISOString().slice(0, 10);
    const date = String(ctx.query.date || ctx.query.bdate || todayStr).trim();
    const startDate = (ctx.query.startDate as string) || date;
    const endDate = (ctx.query.endDate as string) || date;

    // 1. Group invoices by counter
    const invoiceRows = await ctx.db.query<any>(
      `SELECT
        COALESCE(NULLIF(i.counter_id, ''), NULLIF(i.counter, ''), 'UNASSIGNED') AS counter_key,
        COALESCE(NULLIF(i.counter_id, ''), NULLIF(i.counter, '')) AS counter_identifier,
        COALESCE(NULLIF(i.counter_name_snapshot, ''), c.name, i.counter, 'Unassigned Counter') AS counter_name,
        COALESCE(c.code, i.counter, 'UNASSIGNED') AS counter_code,
        COUNT(CASE WHEN i.kind = 'sale' AND i.status = 'posted' THEN 1 END)::int AS invoices_count,
        COUNT(CASE WHEN i.kind = 'credit_note' AND i.status = 'posted' THEN 1 END)::int AS returns_count,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' AND i.status = 'posted' THEN i.total_minor ELSE 0 END), 0)::bigint AS gross_sales_minor,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' AND i.status = 'posted' THEN i.discount_minor ELSE 0 END), 0)::bigint AS discounts_total_minor,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' AND i.status = 'posted' THEN i.taxable_minor ELSE 0 END), 0)::bigint AS taxable_sales_minor,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' AND i.status = 'posted' THEN (i.cgst_minor + i.sgst_minor + i.igst_minor) ELSE 0 END), 0)::bigint AS gst_collected_minor,
        COALESCE(SUM(CASE WHEN i.kind = 'credit_note' AND i.status = 'posted' THEN i.total_minor ELSE 0 END), 0)::bigint AS returns_total_minor,
        COALESCE(SUM(CASE WHEN i.status = 'posted' AND i.total_minor > i.paid_minor THEN (i.total_minor - i.paid_minor) ELSE 0 END), 0)::bigint AS credit_sales_minor
       FROM invoices i
       LEFT JOIN counters c ON (c.id = i.counter_id OR c.code = i.counter) AND c.tenant_id = i.tenant_id
       WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate >= ? AND i.bdate <= ?
         AND i.status = 'posted'
       GROUP BY
        COALESCE(NULLIF(i.counter_id, ''), NULLIF(i.counter, ''), 'UNASSIGNED'),
        COALESCE(NULLIF(i.counter_id, ''), NULLIF(i.counter, '')),
        COALESCE(NULLIF(i.counter_name_snapshot, ''), c.name, i.counter, 'Unassigned Counter'),
        COALESCE(c.code, i.counter, 'UNASSIGNED')
       ORDER BY counter_code ASC`,
      [tenantId, branchId, startDate, endDate],
    );

    // 2. COGS by counter
    const cogsRows = await ctx.db.query<any>(
      `SELECT
        COALESCE(NULLIF(i.counter_id, ''), NULLIF(i.counter, ''), 'UNASSIGNED') AS counter_key,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN il.qty_milli * COALESCE(NULLIF(il.cost_minor, 0), it.cost_minor, 0) / 1000 ELSE 0 END), 0)::bigint AS cogs_minor,
        COALESCE(SUM(CASE WHEN i.kind = 'credit_note' AND (il.item_condition IS NULL OR il.item_condition = 'resellable') THEN il.qty_milli * COALESCE(NULLIF(il.cost_minor, 0), it.cost_minor, 0) / 1000 ELSE 0 END), 0)::bigint AS returned_cogs_minor
       FROM invoice_lines il
       JOIN invoices i ON i.id = il.invoice_id
       LEFT JOIN items it ON it.id = il.item_id
       WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate >= ? AND i.bdate <= ?
         AND i.status = 'posted'
       GROUP BY COALESCE(NULLIF(i.counter_id, ''), NULLIF(i.counter, ''), 'UNASSIGNED')`,
      [tenantId, branchId, startDate, endDate],
    );
    const cogsMap = new Map<string, { cogsMinor: number; returnedCogsMinor: number }>();
    for (const r of cogsRows) {
      cogsMap.set(r.counter_key || r.counterKey, {
        cogsMinor: Number(r.cogs_minor ?? r.cogsMinor ?? 0),
        returnedCogsMinor: Number(r.returned_cogs_minor ?? r.returnedCogsMinor ?? 0),
      });
    }

    // 3. Payment Collections by counter
    const paymentRows = await ctx.db.query<any>(
      `SELECT
        COALESCE(NULLIF(p.counter_id, ''), NULLIF(p.counter, ''), NULLIF(i.counter_id, ''), NULLIF(i.counter, ''), 'UNASSIGNED') AS counter_key,
        COALESCE(p.method, 'cash') AS method,
        COALESCE(SUM(p.amount_minor), 0)::bigint AS total_minor
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       WHERE p.tenant_id = ? AND (p.status IS NULL OR p.status = 'posted')
         AND (
           (p.bdate >= ? AND p.bdate <= ?)
           OR ((p.created_at)::date >= ?::date AND (p.created_at)::date <= ?::date)
         )
         AND (p.invoice_id IS NULL OR i.branch_id IS NULL OR i.branch_id = ?)
       GROUP BY
        COALESCE(NULLIF(p.counter_id, ''), NULLIF(p.counter, ''), NULLIF(i.counter_id, ''), NULLIF(i.counter, ''), 'UNASSIGNED'),
        COALESCE(p.method, 'cash')`,
      [tenantId, startDate, endDate, startDate, endDate, branchId],
    );

    const paymentMap = new Map<string, { cash: number; upi: number; card: number; bank: number; store_credit: number; total: number }>();
    for (const pr of paymentRows) {
      const key = pr.counter_key || pr.counterKey;
      if (!paymentMap.has(key)) {
        paymentMap.set(key, { cash: 0, upi: 0, card: 0, bank: 0, store_credit: 0, total: 0 });
      }
      const pObj = paymentMap.get(key)!;
      const m = String(pr.method).toLowerCase();
      const amt = Number(pr.total_minor ?? pr.totalMinor ?? 0);
      if (m === 'cash') pObj.cash += amt;
      else if (m === 'upi') pObj.upi += amt;
      else if (m === 'card') pObj.card += amt;
      else if (m === 'bank' || m === 'bank_transfer') pObj.bank += amt;
      else if (m === 'store_credit') pObj.store_credit += amt;
      pObj.total += amt;
    }

    const counters: any[] = [];
    let consolidatedGross = 0;
    let consolidatedReturns = 0;
    let consolidatedNet = 0;
    let consolidatedTaxable = 0;
    let consolidatedGst = 0;
    let consolidatedDiscounts = 0;
    let consolidatedInvoices = 0;
    let consolidatedReturnsCount = 0;
    let consolidatedCogs = 0;
    let consolidatedNetCogs = 0;
    let consolidatedProfit = 0;
    let consolidatedCreditSales = 0;
    const consolidatedCollections = { cash: 0, upi: 0, card: 0, bank: 0, storeCredit: 0, total: 0 };
    let exceptionCount = 0;

    for (const ir of invoiceRows) {
      const key = ir.counter_key || ir.counterKey;
      const isException = key === 'UNASSIGNED';
      if (isException) exceptionCount++;

      const gross = Number(ir.gross_sales_minor ?? ir.grossSalesMinor ?? 0);
      const ret = Number(ir.returns_total_minor ?? ir.returnsTotalMinor ?? 0);
      const net = Math.max(0, gross - ret);
      const invCount = Number(ir.invoices_count ?? ir.invoicesCount ?? 0);
      const retCount = Number(ir.returns_count ?? ir.returnsCount ?? 0);
      const discounts = Number(ir.discounts_total_minor ?? ir.discountsTotalMinor ?? 0);
      const taxable = Number(ir.taxable_sales_minor ?? ir.taxableSalesMinor ?? 0);
      const gst = Number(ir.gst_collected_minor ?? ir.gstCollectedMinor ?? 0);
      const creditSales = Number(ir.credit_sales_minor ?? ir.creditSalesMinor ?? 0);

      const cogsObj = cogsMap.get(key) || { cogsMinor: 0, returnedCogsMinor: 0 };
      const netCogs = Math.max(0, cogsObj.cogsMinor - cogsObj.returnedCogsMinor);
      const grossProfit = net - netCogs;
      const marginPct = net > 0 ? (grossProfit / net) * 100 : 0;

      const pObj = paymentMap.get(key) || { cash: 0, upi: 0, card: 0, bank: 0, store_credit: 0, total: 0 };

      consolidatedGross += gross;
      consolidatedReturns += ret;
      consolidatedNet += net;
      consolidatedTaxable += taxable;
      consolidatedGst += gst;
      consolidatedDiscounts += discounts;
      consolidatedInvoices += invCount;
      consolidatedReturnsCount += retCount;
      consolidatedCogs += cogsObj.cogsMinor;
      consolidatedNetCogs += netCogs;
      consolidatedProfit += grossProfit;
      consolidatedCreditSales += creditSales;
      consolidatedCollections.cash += pObj.cash;
      consolidatedCollections.upi += pObj.upi;
      consolidatedCollections.card += pObj.card;
      consolidatedCollections.bank += pObj.bank;
      consolidatedCollections.storeCredit += pObj.store_credit;
      consolidatedCollections.total += pObj.total;

      counters.push({
        counterKey: key,
        counterId: isException ? null : (ir.counter_identifier || ir.counterIdentifier || key),
        counterCode: ir.counter_code || ir.counterCode || (isException ? 'UNASSIGNED' : key),
        counterName: isException ? 'Unassigned Transactions (Exception)' : (ir.counter_name || ir.counterName || key),
        isException,
        invoicesCount: invCount,
        returnsCount: retCount,
        grossSalesMinor: gross,
        discountsTotalMinor: discounts,
        returnsTotalMinor: ret,
        netSalesMinor: net,
        taxableSalesMinor: taxable,
        gstCollectedMinor: gst,
        cogsMinor: cogsObj.cogsMinor,
        returnedCogsMinor: cogsObj.returnedCogsMinor,
        netCogsMinor: netCogs,
        grossProfitMinor: grossProfit,
        marginPct: Math.round(marginPct * 10) / 10,
        creditSalesMinor: creditSales,
        collections: {
          cash: pObj.cash,
          upi: pObj.upi,
          card: pObj.card,
          bank: pObj.bank,
          storeCredit: pObj.store_credit,
          total: pObj.total,
        },
      });
    }

    const consolidatedTotal = {
      invoicesCount: consolidatedInvoices,
      returnsCount: consolidatedReturnsCount,
      grossSalesMinor: consolidatedGross,
      discountsTotalMinor: consolidatedDiscounts,
      returnsTotalMinor: consolidatedReturns,
      netSalesMinor: consolidatedNet,
      taxableSalesMinor: consolidatedTaxable,
      gstCollectedMinor: consolidatedGst,
      cogsMinor: consolidatedCogs,
      netCogsMinor: consolidatedNetCogs,
      grossProfitMinor: consolidatedProfit,
      marginPct: consolidatedNet > 0 ? Math.round((consolidatedProfit / consolidatedNet) * 1000) / 10 : 0,
      creditSalesMinor: consolidatedCreditSales,
      collections: consolidatedCollections,
    };

    return {
      success: true,
      branchId,
      date,
      startDate,
      endDate,
      counters,
      consolidatedTotal,
      exceptionCount,
    };
  });

  // --------------------------------------------------------------------------
  // 7c. Cashier-wise Sales Breakdown Report (Day Closing Scope Only)
  // --------------------------------------------------------------------------
  r.get('/api/day-closing/cashier-sales', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    const branchId = (!scope.isSuperAdminAll && scope.branchId) ? scope.branchId : String(ctx.query.branchId || 'MAIN').trim();
    const todayStr = new Date().toISOString().slice(0, 10);
    const date = String(ctx.query.date || ctx.query.bdate || todayStr).trim();
    const startDate = (ctx.query.startDate as string) || date;
    const endDate = (ctx.query.endDate as string) || date;

    // 1. Group invoices by cashier
    const invoiceRows = await ctx.db.query<any>(
      `SELECT
        COALESCE(NULLIF(i.created_by, ''), 'UNASSIGNED') AS cashier_key,
        COALESCE(u.name, 'Unassigned Cashier') AS cashier_name,
        COALESCE(u.role, 'CASHIER') AS cashier_role,
        COUNT(CASE WHEN i.kind = 'sale' AND i.status = 'posted' THEN 1 END)::int AS invoices_count,
        COUNT(CASE WHEN i.kind = 'credit_note' AND i.status = 'posted' THEN 1 END)::int AS returns_count,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' AND i.status = 'posted' THEN i.total_minor ELSE 0 END), 0)::bigint AS gross_sales_minor,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' AND i.status = 'posted' THEN i.discount_minor ELSE 0 END), 0)::bigint AS discounts_total_minor,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' AND i.status = 'posted' THEN i.taxable_minor ELSE 0 END), 0)::bigint AS taxable_sales_minor,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' AND i.status = 'posted' THEN (i.cgst_minor + i.sgst_minor + i.igst_minor) ELSE 0 END), 0)::bigint AS gst_collected_minor,
        COALESCE(SUM(CASE WHEN i.kind = 'credit_note' AND i.status = 'posted' THEN i.total_minor ELSE 0 END), 0)::bigint AS returns_total_minor,
        COALESCE(SUM(CASE WHEN i.status = 'posted' AND i.total_minor > i.paid_minor THEN (i.total_minor - i.paid_minor) ELSE 0 END), 0)::bigint AS credit_sales_minor
       FROM invoices i
       LEFT JOIN users u ON u.id = i.created_by AND u.tenant_id = i.tenant_id
       WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate >= ? AND i.bdate <= ?
         AND i.status = 'posted'
       GROUP BY
        COALESCE(NULLIF(i.created_by, ''), 'UNASSIGNED'),
        COALESCE(u.name, 'Unassigned Cashier'),
        COALESCE(u.role, 'CASHIER')
       ORDER BY cashier_name ASC`,
      [tenantId, branchId, startDate, endDate],
    );

    // 2. Cashier COGS
    const cogsRows = await ctx.db.query<any>(
      `SELECT
        COALESCE(NULLIF(i.created_by, ''), 'UNASSIGNED') AS cashier_key,
        COALESCE(SUM(CASE WHEN i.kind = 'sale' THEN il.qty_milli * COALESCE(NULLIF(il.cost_minor, 0), it.cost_minor, 0) / 1000 ELSE 0 END), 0)::bigint AS cogs_minor,
        COALESCE(SUM(CASE WHEN i.kind = 'credit_note' AND (il.item_condition IS NULL OR il.item_condition = 'resellable') THEN il.qty_milli * COALESCE(NULLIF(il.cost_minor, 0), it.cost_minor, 0) / 1000 ELSE 0 END), 0)::bigint AS returned_cogs_minor
       FROM invoice_lines il
       JOIN invoices i ON i.id = il.invoice_id
       LEFT JOIN items it ON it.id = il.item_id
       WHERE i.tenant_id = ? AND i.branch_id = ? AND i.bdate >= ? AND i.bdate <= ?
         AND i.status = 'posted'
       GROUP BY COALESCE(NULLIF(i.created_by, ''), 'UNASSIGNED')`,
      [tenantId, branchId, startDate, endDate],
    );
    const cogsMap = new Map<string, { cogsMinor: number; returnedCogsMinor: number }>();
    for (const r of cogsRows) {
      cogsMap.set(r.cashier_key || r.cashierKey, {
        cogsMinor: Number(r.cogs_minor ?? r.cogsMinor ?? 0),
        returnedCogsMinor: Number(r.returned_cogs_minor ?? r.returnedCogsMinor ?? 0),
      });
    }

    // 3. Payment Collections by Cashier
    const paymentRows = await ctx.db.query<any>(
      `SELECT
        COALESCE(NULLIF(p.created_by, ''), NULLIF(i.created_by, ''), 'UNASSIGNED') AS cashier_key,
        COALESCE(p.method, 'cash') AS method,
        COALESCE(SUM(p.amount_minor), 0)::bigint AS total_minor
       FROM payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       WHERE p.tenant_id = ? AND (p.status IS NULL OR p.status = 'posted')
         AND (
           (p.bdate >= ? AND p.bdate <= ?)
           OR ((p.created_at)::date >= ?::date AND (p.created_at)::date <= ?::date)
         )
         AND (p.invoice_id IS NULL OR i.branch_id IS NULL OR i.branch_id = ?)
       GROUP BY
        COALESCE(NULLIF(p.created_by, ''), NULLIF(i.created_by, ''), 'UNASSIGNED'),
        COALESCE(p.method, 'cash')`,
      [tenantId, startDate, endDate, startDate, endDate, branchId],
    );
    const paymentMap = new Map<string, { cash: number; upi: number; card: number; bank: number; store_credit: number; total: number }>();
    for (const pr of paymentRows) {
      const key = pr.cashier_key || pr.cashierKey;
      if (!paymentMap.has(key)) {
        paymentMap.set(key, { cash: 0, upi: 0, card: 0, bank: 0, store_credit: 0, total: 0 });
      }
      const pObj = paymentMap.get(key)!;
      const m = String(pr.method).toLowerCase();
      const amt = Number(pr.total_minor ?? pr.totalMinor ?? 0);
      if (m === 'cash') pObj.cash += amt;
      else if (m === 'upi') pObj.upi += amt;
      else if (m === 'card') pObj.card += amt;
      else if (m === 'bank' || m === 'bank_transfer') pObj.bank += amt;
      else if (m === 'store_credit') pObj.store_credit += amt;
      pObj.total += amt;
    }

    // 4. Closing status per cashier for date
    const closingRows = await ctx.db.query<any>(
      `SELECT cashier_id, status, actual_cash_minor, expected_cash_minor, variance_minor, submitted_at, approved_at
       FROM day_closings
       WHERE tenant_id = ? AND branch_id = ? AND bdate = ? AND cashier_id IS NOT NULL`,
      [tenantId, branchId, date],
    );
    const closingMap = new Map<string, any>();
    for (const cl of closingRows) {
      closingMap.set(cl.cashier_id || cl.cashierId, cl);
    }

    const cashiers: any[] = [];
    let consolidatedGross = 0;
    let consolidatedReturns = 0;
    let consolidatedNet = 0;
    let consolidatedTaxable = 0;
    let consolidatedGst = 0;
    let consolidatedDiscounts = 0;
    let consolidatedInvoices = 0;
    let consolidatedReturnsCount = 0;
    let consolidatedCogs = 0;
    let consolidatedNetCogs = 0;
    let consolidatedProfit = 0;
    let consolidatedCreditSales = 0;
    const consolidatedCollections = { cash: 0, upi: 0, card: 0, bank: 0, storeCredit: 0, total: 0 };
    let exceptionCount = 0;

    for (const ir of invoiceRows) {
      const key = ir.cashier_key || ir.cashierKey;
      const isException = key === 'UNASSIGNED';
      if (isException) exceptionCount++;

      const gross = Number(ir.gross_sales_minor ?? ir.grossSalesMinor ?? 0);
      const ret = Number(ir.returns_total_minor ?? ir.returnsTotalMinor ?? 0);
      const net = Math.max(0, gross - ret);
      const invCount = Number(ir.invoices_count ?? ir.invoicesCount ?? 0);
      const retCount = Number(ir.returns_count ?? ir.returnsCount ?? 0);
      const discounts = Number(ir.discounts_total_minor ?? ir.discountsTotalMinor ?? 0);
      const taxable = Number(ir.taxable_sales_minor ?? ir.taxableSalesMinor ?? 0);
      const gst = Number(ir.gst_collected_minor ?? ir.gstCollectedMinor ?? 0);
      const creditSales = Number(ir.credit_sales_minor ?? ir.creditSalesMinor ?? 0);

      const cogsObj = cogsMap.get(key) || { cogsMinor: 0, returnedCogsMinor: 0 };
      const netCogs = Math.max(0, cogsObj.cogsMinor - cogsObj.returnedCogsMinor);
      const grossProfit = net - netCogs;
      const marginPct = net > 0 ? (grossProfit / net) * 100 : 0;

      const pObj = paymentMap.get(key) || { cash: 0, upi: 0, card: 0, bank: 0, store_credit: 0, total: 0 };
      const clObj = closingMap.get(key);

      consolidatedGross += gross;
      consolidatedReturns += ret;
      consolidatedNet += net;
      consolidatedTaxable += taxable;
      consolidatedGst += gst;
      consolidatedDiscounts += discounts;
      consolidatedInvoices += invCount;
      consolidatedReturnsCount += retCount;
      consolidatedCogs += cogsObj.cogsMinor;
      consolidatedNetCogs += netCogs;
      consolidatedProfit += grossProfit;
      consolidatedCreditSales += creditSales;
      consolidatedCollections.cash += pObj.cash;
      consolidatedCollections.upi += pObj.upi;
      consolidatedCollections.card += pObj.card;
      consolidatedCollections.bank += pObj.bank;
      consolidatedCollections.storeCredit += pObj.store_credit;
      consolidatedCollections.total += pObj.total;

      cashiers.push({
        cashierKey: key,
        cashierId: isException ? null : key,
        cashierName: isException ? 'Unassigned Transactions (Exception)' : (ir.cashier_name || ir.cashierName || key),
        cashierRole: ir.cashier_role || ir.cashierRole || 'CASHIER',
        isException,
        invoicesCount: invCount,
        returnsCount: retCount,
        grossSalesMinor: gross,
        discountsTotalMinor: discounts,
        returnsTotalMinor: ret,
        netSalesMinor: net,
        taxableSalesMinor: taxable,
        gstCollectedMinor: gst,
        cogsMinor: cogsObj.cogsMinor,
        returnedCogsMinor: cogsObj.returnedCogsMinor,
        netCogsMinor: netCogs,
        grossProfitMinor: grossProfit,
        marginPct: Math.round(marginPct * 10) / 10,
        creditSalesMinor: creditSales,
        collections: {
          cash: pObj.cash,
          upi: pObj.upi,
          card: pObj.card,
          bank: pObj.bank,
          storeCredit: pObj.store_credit,
          total: pObj.total,
        },
        closingStatus: clObj ? (clObj.status || 'open') : 'not_started',
        actualCashMinor: clObj ? Number(clObj.actual_cash_minor ?? clObj.actualCashMinor ?? 0) : null,
        expectedCashMinor: clObj ? Number(clObj.expected_cash_minor ?? clObj.expectedCashMinor ?? 0) : null,
        varianceMinor: clObj ? Number(clObj.variance_minor ?? clObj.varianceMinor ?? 0) : null,
      });
    }

    const consolidatedTotal = {
      invoicesCount: consolidatedInvoices,
      returnsCount: consolidatedReturnsCount,
      grossSalesMinor: consolidatedGross,
      discountsTotalMinor: consolidatedDiscounts,
      returnsTotalMinor: consolidatedReturns,
      netSalesMinor: consolidatedNet,
      taxableSalesMinor: consolidatedTaxable,
      gstCollectedMinor: consolidatedGst,
      cogsMinor: consolidatedCogs,
      netCogsMinor: consolidatedNetCogs,
      grossProfitMinor: consolidatedProfit,
      marginPct: consolidatedNet > 0 ? Math.round((consolidatedProfit / consolidatedNet) * 1000) / 10 : 0,
      creditSalesMinor: consolidatedCreditSales,
      collections: consolidatedCollections,
    };

    return {
      success: true,
      branchId,
      date,
      startDate,
      endDate,
      cashiers,
      consolidatedTotal,
      exceptionCount,
    };
  });

  // --------------------------------------------------------------------------
  // 7d. Smart Day Closing Schedule & Reminder Settings
  // --------------------------------------------------------------------------
  r.get('/api/day-closing/schedules', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    const rawBranch = String(ctx.query.branchId || ctx.query.branch || (scope.branchId ?? 'MAIN')).trim();

    // Resolve canonical branch ID and Code
    const branchRecord = await ctx.db.one<any>(
      `SELECT id, code, name FROM branches
       WHERE tenant_id = ? AND (id = ? OR UPPER(code) = UPPER(?)) AND (deleted_at IS NULL OR active = true)
       LIMIT 1`,
      [tenantId, rawBranch, rawBranch],
    );
    const branchId = branchRecord?.id || scope.branchId || rawBranch;
    const branchCode = branchRecord?.code || rawBranch;
    const counterId = ctx.query.counterId ? String(ctx.query.counterId).trim() : null;

    const schedules = await ctx.db.query<any>(
      `SELECT * FROM day_closing_schedules
       WHERE tenant_id = ? AND (branch_id = ? OR branch_id = ? OR branch_id = ?)
       ORDER BY (counter_id IS NOT NULL) DESC, created_at ASC`,
      [tenantId, branchId, branchCode, rawBranch],
    );

    const defaultSchedule = {
      expectedClosingTime: '22:00',
      firstReminderMinutesBefore: 30,
      secondReminderMinutesBefore: 15,
      finalReminderAtClosing: true,
      overdueReminderIntervalMinutes: 30,
      autoAlertOverdue: true,
      enabled: true,
    };

    const targetSchedule = counterId
      ? (schedules.find((s: any) => s.counter_id === counterId || s.counterId === counterId) || schedules.find((s: any) => !s.counter_id && !s.counterId) || defaultSchedule)
      : (schedules.find((s: any) => !s.counter_id && !s.counterId) || defaultSchedule);

    return {
      success: true,
      branchId,
      counterId,
      schedule: targetSchedule,
      allSchedules: schedules,
    };
  });

  r.post('/api/day-closing/schedules', requirePerm('shift'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};
    const scope = await resolveBranchScope(ctx);
    const rawBranch = String(b.branchId || ctx.query.branchId || ctx.query.branch || (scope.branchId ?? 'MAIN')).trim();

    // Resolve canonical branch ID and Code
    const branchRecord = await ctx.db.one<any>(
      `SELECT id, code, name FROM branches
       WHERE tenant_id = ? AND (id = ? OR UPPER(code) = UPPER(?)) AND (deleted_at IS NULL OR active = true)
       LIMIT 1`,
      [tenantId, rawBranch, rawBranch],
    );
    const branchId = branchRecord?.id || scope.branchId || rawBranch;
    const branchCode = branchRecord?.code || rawBranch;

    const counterId = b.counterId ? String(b.counterId).trim() : null;
    const expectedClosingTime = String(b.expectedClosingTime || '22:00').trim();
    const firstReminderMinutesBefore = Number(b.firstReminderMinutesBefore ?? 30);
    const secondReminderMinutesBefore = Number(b.secondReminderMinutesBefore ?? 15);
    const finalReminderAtClosing = Boolean(b.finalReminderAtClosing ?? true);
    const overdueReminderIntervalMinutes = Number(b.overdueReminderIntervalMinutes ?? 30);
    const autoAlertOverdue = Boolean(b.autoAlertOverdue ?? true);
    const enabled = Boolean(b.enabled ?? true);

    const existing = await ctx.db.one<any>(
      `SELECT id FROM day_closing_schedules
       WHERE tenant_id = ? AND (branch_id = ? OR branch_id = ? OR branch_id = ?) AND counter_id IS NOT DISTINCT FROM ?
       ORDER BY updated_at DESC LIMIT 1`,
      [tenantId, branchId, branchCode, rawBranch, counterId],
    );

    const id = existing?.id || newId('dcs');
    if (existing) {
      await ctx.db.exec(
        `UPDATE day_closing_schedules
         SET branch_id = ?,
             expected_closing_time = ?,
             first_reminder_minutes_before = ?,
             second_reminder_minutes_before = ?,
             final_reminder_at_closing = ?,
             overdue_reminder_interval_minutes = ?,
             auto_alert_overdue = ?,
             enabled = ?,
             updated_at = NOW()
         WHERE id = ?`,
        [branchId, expectedClosingTime, firstReminderMinutesBefore, secondReminderMinutesBefore, finalReminderAtClosing, overdueReminderIntervalMinutes, autoAlertOverdue, enabled, id],
      );
    } else {
      await ctx.db.exec(
        `INSERT INTO day_closing_schedules (
           id, tenant_id, branch_id, counter_id,
           expected_closing_time, first_reminder_minutes_before, second_reminder_minutes_before,
           final_reminder_at_closing, overdue_reminder_interval_minutes, auto_alert_overdue,
           enabled
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, tenantId, branchId, counterId, expectedClosingTime, firstReminderMinutesBefore, secondReminderMinutesBefore, finalReminderAtClosing, overdueReminderIntervalMinutes, autoAlertOverdue, enabled],
      );
    }

    return {
      success: true,
      id,
      schedule: {
        id,
        branchId,
        counterId,
        expectedClosingTime,
        firstReminderMinutesBefore,
        secondReminderMinutesBefore,
        finalReminderAtClosing,
        overdueReminderIntervalMinutes,
        autoAlertOverdue,
        enabled,
      },
    };
  });

  // --------------------------------------------------------------------------
  // 7e. Manager & Admin Closing Compliance Monitoring
  // --------------------------------------------------------------------------
  r.get('/api/day-closing/compliance', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    const rawBranch = String(ctx.query.branchId || ctx.query.branch || (scope.branchId ?? 'MAIN')).trim();

    // Resolve canonical branch ID and Code
    const branchRecord = await ctx.db.one<any>(
      `SELECT id, code, name FROM branches
       WHERE tenant_id = ? AND (id = ? OR UPPER(code) = UPPER(?)) AND (deleted_at IS NULL OR active = true)
       LIMIT 1`,
      [tenantId, rawBranch, rawBranch],
    );
    const branchId = branchRecord?.id || scope.branchId || rawBranch;
    const branchCode = branchRecord?.code || rawBranch;

    const now = new Date();
    const istDate = new Date(now.getTime() + 5.5 * 3600000);
    const todayIstStr = istDate.toISOString().slice(0, 10);
    const currentIstTimeStr = istDate.toISOString().slice(11, 16);
    const date = String(ctx.query.date || ctx.query.bdate || todayIstStr).trim();

    // 1. Fetch Schedule
    const schedule = await ctx.db.one<any>(
      `SELECT * FROM day_closing_schedules
       WHERE tenant_id = ? AND (branch_id = ? OR branch_id = ? OR branch_id = ?) AND counter_id IS NULL
       ORDER BY updated_at DESC LIMIT 1`,
      [tenantId, branchId, branchCode, rawBranch],
    );
    const expectedClosingTime = schedule?.expectedClosingTime || schedule?.expected_closing_time || '22:00';
    const isScheduleEnabled = schedule ? (schedule.enabled !== false) : true;
    const isAutoAlertEnabled = schedule ? ((schedule.autoAlertOverdue ?? schedule.auto_alert_overdue) !== false) : true;

    // 2. Fetch all Active Counters for this branch
    const counters = await ctx.db.query<any>(
      `SELECT c.id, c.name, c.code, c.status
       FROM counters c
       WHERE c.tenant_id = ? AND (c.branch_id = ? OR c.branch_id = ?) AND c.status = 'ACTIVE'
       ORDER BY c.code ASC`,
      [tenantId, branchId, branchCode],
    );

    // 3. Fetch all Cashiers active or with sales on this date
    const cashiers = await ctx.db.query<any>(
      `SELECT DISTINCT u.id, u.name, u.role
       FROM users u
       WHERE u.tenant_id = ?
         AND (
           EXISTS (SELECT 1 FROM invoices i WHERE i.tenant_id = u.tenant_id AND (i.branch_id = ? OR i.branch_id = ?) AND i.bdate = ? AND i.created_by = u.id)
           OR EXISTS (SELECT 1 FROM shifts s WHERE s.tenant_id = u.tenant_id AND (s.location = ? OR s.branch_id = ? OR s.location = ? OR s.branch_id = ?) AND DATE(s.opened_at) = ?::date AND s.user_id = u.id)
           OR LOWER(u.role) IN ('cashier', 'counter')
         )
       ORDER BY u.name ASC`,
      [tenantId, branchId, branchCode, date, branchId, branchId, branchCode, branchCode, date],
    );

    // 4. Fetch Day Closings for this date
    const dayClosings = await ctx.db.query<any>(
      `SELECT dc.*, u.name AS cashier_name, su.name AS submitted_by_name, au.name AS approved_by_name
       FROM day_closings dc
       LEFT JOIN users u ON u.id = dc.cashier_id
       LEFT JOIN users su ON su.id = dc.submitted_by
       LEFT JOIN users au ON au.id = dc.approved_by
       WHERE dc.tenant_id = ? AND (dc.branch_id = ? OR dc.branch_id = ? OR dc.branch_id = ?) AND dc.bdate = ?`,
      [tenantId, branchId, branchCode, rawBranch, date],
    );

    const consolidatedClosing = dayClosings.find((dc: any) => !dc.cashier_id && !dc.cashierId);
    const storeStatus = consolidatedClosing?.status || (dayClosings.length > 0 && dayClosings.every((dc: any) => dc.status === 'approved' || dc.status === 'closed') ? 'approved' : 'open');
    const isStoreClosed = storeStatus === 'approved' || storeStatus === 'closed';
    const isStoreSubmitted = storeStatus === 'submitted';

    let isBranchOverdue = false;
    let minutesOverdue = 0;

    // Overdue condition:
    // Only if:
    // 1. Day is NOT already closed or approved
    // 2. Day is NOT already submitted
    // 3. Schedule is enabled
    // 4. Auto alert overdue is enabled
    // 5. Target time has actually arrived or passed (for today, current IST time > expected closing time; for past dates, past day)
    if (!isStoreClosed && !isStoreSubmitted && isScheduleEnabled && isAutoAlertEnabled) {
      if (date < todayIstStr) {
        isBranchOverdue = true;
        minutesOverdue = 1440;
      } else if (date === todayIstStr) {
        const [expH, expM] = expectedClosingTime.split(':').map(Number);
        const [curH, curM] = currentIstTimeStr.split(':').map(Number);
        const expTotalMin = (expH || 0) * 60 + (expM || 0);
        const curTotalMin = (curH || 0) * 60 + (curM || 0);
        if (curTotalMin > expTotalMin) {
          isBranchOverdue = true;
          minutesOverdue = curTotalMin - expTotalMin;
        }
      }
    }

    // Calculate status per cashier
    const cashierMatrix = cashiers.map((c: any) => {
      const closing = dayClosings.find((dc: any) => (dc.cashier_id || dc.cashierId) === c.id);
      const st = closing ? closing.status : (isStoreClosed ? 'closed' : 'pending');
      const isOverdue = !isStoreClosed && !isStoreSubmitted && (st === 'open' || st === 'pending') && isBranchOverdue;
      return {
        cashierId: c.id,
        cashierName: c.name,
        role: c.role,
        status: st,
        isOverdue,
        submittedAt: closing?.submitted_at || null,
        approvedAt: closing?.approved_at || null,
        actualCashMinor: closing ? Number(closing.actual_cash_minor || 0) : null,
        varianceMinor: closing ? Number(closing.variance_minor || 0) : null,
      };
    });

    const totalRegisters = Math.max(counters.length, cashierMatrix.length, 1);
    const closedCount = cashierMatrix.filter((c: any) => c.status === 'approved' || c.status === 'closed').length;
    const submittedCount = cashierMatrix.filter((c: any) => c.status === 'submitted').length;
    const pendingCount = isStoreClosed ? 0 : cashierMatrix.filter((c: any) => c.status === 'pending' || c.status === 'open').length;
    const overdueCount = isBranchOverdue ? cashierMatrix.filter((c: any) => c.isOverdue).length : 0;
    const completionPct = isStoreClosed ? 100 : (totalRegisters > 0 ? Math.round((closedCount / totalRegisters) * 100) : 0);

    return {
      success: true,
      branchId,
      date,
      expectedClosingTime,
      isBranchOverdue,
      minutesOverdue,
      lastReminderSentAt: schedule?.lastReminderSentAt || schedule?.last_reminder_sent_at || null,
      lastReminderType: schedule?.lastReminderType || schedule?.last_reminder_type || null,
      summary: {
        totalRegisters,
        closedCount: isStoreClosed ? totalRegisters : closedCount,
        submittedCount,
        pendingCount,
        overdueCount,
        completionPct,
        isStoreClosed,
        isStoreSubmitted,
        storeStatus,
      },
      cashierMatrix,
      counters,
    };
  });

  // --------------------------------------------------------------------------
  // 7f. In-App Notifications & Manual Reminder Trigger
  // --------------------------------------------------------------------------
  r.post('/api/day-closing/send-reminder', requirePerm('shift'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};
    const scope = await resolveBranchScope(ctx);
    const branchId = (!scope.isSuperAdminAll && scope.branchId) ? scope.branchId : String(b.branchId || 'MAIN').trim();
    const todayStr = new Date().toISOString().slice(0, 10);
    const bdate = String(b.date || b.bdate || todayStr).trim();
    const cashierId = b.cashierId ? String(b.cashierId).trim() : null;
    const counterId = b.counterId ? String(b.counterId).trim() : null;
    const reminderType = String(b.reminderType || 'manual').trim();

    const title = reminderType === 'overdue'
      ? 'Day Closing OVERDUE Alert'
      : (reminderType === 'final' ? 'Final Closing Reminder' : 'Day Closing Reminder');
    const message = b.message || `Please count physical cash drawer and submit your end-of-day register reconciliation for ${bdate}.`;
    const severity = reminderType === 'overdue' ? 'error' : (reminderType === 'final' ? 'warning' : 'info');

    const notifId = newId('dcn');
    await ctx.db.exec(
      `INSERT INTO day_closing_notifications (
         id, tenant_id, branch_id, counter_id, cashier_id, bdate, type, title, message, severity
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [notifId, tenantId, branchId, counterId, cashierId, bdate, reminderType, title, message, severity],
    );

    await ctx.db.exec(
      `UPDATE day_closing_schedules
       SET last_reminder_sent_at = NOW(),
           last_reminder_type = ?
       WHERE tenant_id = ? AND branch_id = ? AND counter_id IS NOT DISTINCT FROM ?`,
      [reminderType, tenantId, branchId, counterId],
    );

    return {
      success: true,
      message: 'Reminder sent successfully.',
      notificationId: notifId,
    };
  });

  r.get('/api/day-closing/notifications', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const scope = await resolveBranchScope(ctx);
    const branchId = (!scope.isSuperAdminAll && scope.branchId) ? scope.branchId : String(ctx.query.branchId || 'MAIN').trim();
    const userRole = String(ctx.user!.role || '').toUpperCase();
    const isCashier = userRole === 'CASHIER' || userRole === 'COUNTER';

    let notifSql = `
      SELECT n.*, u.name AS cashier_name
      FROM day_closing_notifications n
      LEFT JOIN users u ON u.id = n.cashier_id
      WHERE n.tenant_id = ? AND n.branch_id = ?
    `;
    const notifParams: any[] = [tenantId, branchId];

    if (isCashier) {
      notifSql += ' AND (n.cashier_id = ? OR n.cashier_id IS NULL)';
      notifParams.push(ctx.user!.id);
    }
    notifSql += ' ORDER BY n.created_at DESC LIMIT 20';

    const notifications = await ctx.db.query<any>(notifSql, notifParams);
    const unreadCount = notifications.filter((n: any) => !n.is_read && !n.isRead).length;

    return {
      success: true,
      notifications,
      unreadCount,
    };
  });

  r.post('/api/day-closing/notifications/:id/read', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const id = ctx.params.id;

    await ctx.db.exec(
      `UPDATE day_closing_notifications
       SET is_read = TRUE, read_at = NOW()
       WHERE id = ? AND tenant_id = ?`,
      [id, tenantId],
    );

    return { success: true };
  });

  // --------------------------------------------------------------------------
  // 8. Historical Day Closings
  // --------------------------------------------------------------------------
  r.get('/api/day-closing/history', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const branchId = ctx.query.branchId as string;
    const cashierId = ctx.query.cashierId as string;
    const limit = Math.min(100, Math.max(1, Number(ctx.query.limit || 30)));

    let sql = `
      SELECT dc.*, u.name AS closed_by_name, vu.name AS verified_by_name,
             au.name AS approved_by_name, ru.name AS reopened_by_name,
             su.name AS submitted_by_name, cu.name AS cashier_name,
             b.name AS branch_name
      FROM day_closings dc
      LEFT JOIN users u ON u.id = dc.closed_by
      LEFT JOIN users vu ON vu.id = dc.verified_by
      LEFT JOIN users au ON au.id = dc.approved_by
      LEFT JOIN users ru ON ru.id = dc.reopened_by
      LEFT JOIN users su ON su.id = dc.submitted_by
      LEFT JOIN users cu ON cu.id = dc.cashier_id
      LEFT JOIN branches b ON b.id = dc.branch_id OR b.code = dc.branch_id
      WHERE dc.tenant_id = ?
    `;
    const params: any[] = [tenantId];

    if (branchId && branchId !== 'all') {
      sql += ` AND dc.branch_id = ?`;
      params.push(branchId);
    }
    if (cashierId) {
      sql += ` AND dc.cashier_id = ?`;
      params.push(cashierId);
    }

    sql += ` ORDER BY dc.bdate DESC, dc.created_at DESC LIMIT ?`;
    params.push(limit);

    const history = await ctx.db.query<any>(sql, params);
    return { history };
  });

  // --------------------------------------------------------------------------
  // 9. Printable Day Closing Report
  // --------------------------------------------------------------------------
  r.get('/api/day-closing/:id/print', async (ctx) => {
    const id = ctx.params.id;
    let tenantId = (ctx.query.tenantId as string) || ctx.user?.tenantId;

    const dc = await ctx.db.one<any>(
      `SELECT dc.*, u.name AS closed_by_name, vu.name AS verified_by_name,
              au.name AS approved_by_name, cu.name AS cashier_name, b.name AS branch_name
       FROM day_closings dc
       LEFT JOIN users u ON u.id = dc.closed_by
       LEFT JOIN users vu ON vu.id = dc.verified_by
       LEFT JOIN users au ON au.id = dc.approved_by
       LEFT JOIN users cu ON cu.id = dc.cashier_id
       LEFT JOIN branches b ON (b.id = dc.branch_id OR b.code = dc.branch_id) AND b.tenant_id = dc.tenant_id
       WHERE dc.id = ? ${tenantId ? 'AND dc.tenant_id = ?' : ''}`,
      tenantId ? [id, tenantId] : [id],
    );
    if (!dc) throw notFound('Day closing record');

    tenantId = tenantId || dc.tenantId || dc.tenant_id;
    const shop = tenantId ? await ctx.db.one<any>('SELECT * FROM tenants WHERE id = ?', [tenantId]) : null;

    const grossSalesMinor = Number(dc.grossSalesMinor ?? dc.gross_sales_minor ?? 0);
    const returnsTotalMinor = Number(dc.returnsTotalMinor ?? dc.returns_total_minor ?? 0);
    const netSalesMinor = Number(dc.netSalesMinor ?? dc.net_sales_minor ?? 0);
    const invoicesCount = Number(dc.invoicesCount ?? dc.invoices_count ?? 0);
    const returnsCount = Number(dc.returnsCount ?? dc.returns_count ?? 0);
    const exchangesCount = Number(dc.exchangesCount ?? dc.exchanges_count ?? 0);
    const refundsCount = Number(dc.refundsCount ?? dc.refunds_count ?? 0);
    const openingCashMinor = Number(dc.openingCashMinor ?? dc.opening_cash_minor ?? 0);
    const cashSalesMinor = Number(dc.cashSalesMinor ?? dc.cash_sales_minor ?? 0);
    const cashRefundsMinor = Number(dc.cashRefundsMinor ?? dc.cash_refunds_minor ?? 0);
    const cashExpensesMinor = Number(dc.cashExpensesMinor ?? dc.cash_expenses_minor ?? 0);
    const cashInMinor = Number(dc.cashInMinor ?? dc.cash_in_minor ?? 0);
    const cashOutMinor = Number(dc.cashOutMinor ?? dc.cash_out_minor ?? 0);
    const expectedCashMinor = Number(dc.expectedCashMinor ?? dc.expected_cash_minor ?? 0);
    const actualCashMinor = Number(dc.actualCashMinor ?? dc.actual_cash_minor ?? 0);
    const varianceMinor = Number(dc.varianceMinor ?? dc.variance_minor ?? 0);
    const netCogsMinor = Number(dc.netCogsMinor ?? dc.net_cogs_minor ?? 0);
    const grossProfitMinor = Number(dc.grossProfitMinor ?? dc.gross_profit_minor ?? 0);
    const operatingExpensesMinor = Number(dc.operatingExpensesMinor ?? dc.operating_expenses_minor ?? 0);
    const netProfitMinor = Number(dc.netProfitMinor ?? dc.net_profit_minor ?? 0);
    const branchName = dc.branchName || dc.branch_name || dc.branchId || dc.branch_id || 'Main';
    const closedByName = dc.closedByName || dc.closed_by_name || 'Cashier';
    const approvedByName = dc.approvedByName || dc.approved_by_name || '';
    const closedAt = dc.closedAt || dc.closed_at || new Date().toISOString();
    const approvedAt = dc.approvedAt || dc.approved_at || null;

    const varianceColor = varianceMinor === 0 ? '#16a34a' : varianceMinor > 0 ? '#2563eb' : '#dc2626';
    const varianceLabel = varianceMinor === 0 ? 'BALANCED' : varianceMinor > 0 ? `EXCESS (+${fmtMoney(varianceMinor)})` : `SHORTAGE (${fmtMoney(varianceMinor)})`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Day Closing Report - ${dc.bdate}</title>
  <style>
    @media print { @page { margin: 10mm; size: auto; } }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 24px; color: #1e293b; background: #fff; font-size: 0.88rem; }
    .sheet { max-width: 650px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 8px; padding: 28px; }
    .header { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 16px; }
    .shop-title { font-size: 1.4rem; font-weight: 800; text-transform: uppercase; margin: 0; }
    .report-badge { display: inline-block; background: #0f172a; color: #fff; font-size: 0.78rem; font-weight: 800; padding: 4px 12px; border-radius: 4px; margin-top: 8px; letter-spacing: 0.8px; }
    .status-badge { display: inline-block; padding: 3px 10px; border-radius: 9999px; font-weight: 800; font-size: 0.75rem; text-transform: uppercase; margin-top: 4px; }
    .status-badge.approved { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
    .status-badge.submitted { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
    .status-badge.reopened { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    .box { border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 14px; background: #f8fafc; }
    .box-title { font-size: 0.75rem; font-weight: 800; text-transform: uppercase; color: #64748b; margin-bottom: 8px; letter-spacing: 0.5px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
    .box table { width: 100%; border-collapse: collapse; }
    .box td { padding: 4px 0; }
    .text-right { text-align: right; }
    .font-bold { font-weight: 700; }
    .font-black { font-weight: 800; }
    .val-highlight { font-size: 1.15rem; font-weight: 800; }
    .footer { margin-top: 28px; display: flex; justify-content: space-between; border-top: 1px dashed #cbd5e1; padding-top: 24px; }
    .sig-line { width: 160px; border-top: 1px solid #0f172a; text-align: center; font-size: 0.75rem; padding-top: 4px; }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <h1 class="shop-title">${shop.name || 'Textile POS'}</h1>
      <div>${shop.address || ''}</div>
      ${shop.gstin ? `<div>GSTIN: <strong>${shop.gstin}</strong></div>` : ''}
      <div class="report-badge">DAILY BUSINESS CLOSING REPORT</div>
      <div>
        <span class="status-badge ${dc.status}">${dc.status === 'approved' ? 'SEALED & APPROVED' : dc.status}</span>
      </div>
    </div>

    <table style="width: 100%; margin-bottom: 16px; font-size: 0.85rem;">
      <tr>
        <td><strong>Closing Date:</strong> ${dc.bdate}</td>
        <td class="text-right"><strong>Branch:</strong> ${branchName}</td>
      </tr>
      <tr>
        <td><strong>Submitted By:</strong> ${closedByName}</td>
        <td class="text-right"><strong>Submitted At:</strong> ${new Date(closedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</td>
      </tr>
      ${approvedByName ? `
      <tr>
        <td><strong>Approved By:</strong> ${approvedByName}</td>
        <td class="text-right"><strong>Approved At:</strong> ${approvedAt ? new Date(approvedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '-'}</td>
      </tr>
      ` : ''}
    </table>

    <div class="grid">
      <!-- A. Sales Summary -->
      <div class="box">
        <div class="box-title">A. Sales Performance</div>
        <table>
          <tr><td>Gross Sales (${invoicesCount} bills):</td><td class="text-right font-bold">${fmtMoney(grossSalesMinor)}</td></tr>
          <tr><td style="color: #dc2626;">Sales Returns (${returnsCount} returns):</td><td class="text-right font-bold" style="color: #dc2626;">-${fmtMoney(returnsTotalMinor)}</td></tr>
          <tr style="border-top: 1px solid #cbd5e1;"><td><strong>Net Daily Sales:</strong></td><td class="text-right val-highlight" style="color: #0f172a;">${fmtMoney(netSalesMinor)}</td></tr>
        </table>
      </div>

      <!-- B. Cash Drawer Reconciliation -->
      <div class="box">
        <div class="box-title">B. Cash Drawer Reconciliation</div>
        <table>
          <tr><td>Opening Drawer Cash:</td><td class="text-right">${fmtMoney(openingCashMinor)}</td></tr>
          <tr><td>Cash Sales Received:</td><td class="text-right" style="color: #16a34a;">+${fmtMoney(cashSalesMinor)}</td></tr>
          <tr><td>Cash Refunds Paid:</td><td class="text-right" style="color: #dc2626;">-${fmtMoney(cashRefundsMinor)}</td></tr>
          <tr><td>Cash Expenses Paid:</td><td class="text-right" style="color: #dc2626;">-${fmtMoney(cashExpensesMinor)}</td></tr>
          <tr><td>Cash In / Deposits:</td><td class="text-right">+${fmtMoney(cashInMinor)}</td></tr>
          <tr><td>Cash Out / Withdrawals:</td><td class="text-right">-${fmtMoney(cashOutMinor)}</td></tr>
          <tr style="border-top: 1px solid #cbd5e1;"><td><strong>Expected Cash:</strong></td><td class="text-right font-black">${fmtMoney(expectedCashMinor)}</td></tr>
          <tr><td><strong>Actual Counted Cash:</strong></td><td class="text-right font-black">${fmtMoney(actualCashMinor)}</td></tr>
          <tr style="border-top: 1px dashed #cbd5e1;">
            <td><strong>Variance / Diff:</strong></td>
            <td class="text-right font-black" style="color: ${varianceColor};">${varianceLabel}</td>
          </tr>
        </table>
      </div>
    </div>

    <div class="grid">
      <!-- C. Returns & Exchanges -->
      <div class="box">
        <div class="box-title">C. Returns, Exchanges & Refunds</div>
        <table>
          <tr><td>Total Returns Value:</td><td class="text-right">${fmtMoney(returnsTotalMinor)}</td></tr>
          <tr><td>Cash Refunds Disbursed:</td><td class="text-right">${fmtMoney(cashRefundsMinor)}</td></tr>
          <tr><td>Number of Exchanges:</td><td class="text-right">${exchangesCount}</td></tr>
          <tr><td>Number of Refunds:</td><td class="text-right">${refundsCount}</td></tr>
        </table>
      </div>

      <!-- D. Profit & Margin -->
      <div class="box">
        <div class="box-title">D. Gross & Net Profit Summary</div>
        <table>
          <tr><td>Net Sales:</td><td class="text-right">${fmtMoney(netSalesMinor)}</td></tr>
          <tr><td>Net COGS (Product Cost):</td><td class="text-right">-${fmtMoney(netCogsMinor)}</td></tr>
          <tr style="border-top: 1px solid #cbd5e1;"><td><strong>Gross Profit:</strong></td><td class="text-right font-bold" style="color: #16a34a;">${fmtMoney(grossProfitMinor)}</td></tr>
          <tr><td>Operating Expenses:</td><td class="text-right">-${fmtMoney(operatingExpensesMinor)}</td></tr>
          <tr style="border-top: 1px solid #cbd5e1;"><td><strong>Net Profit:</strong></td><td class="text-right val-highlight" style="color: #2563eb;">${fmtMoney(netProfitMinor)}</td></tr>
        </table>
      </div>
    </div>

    ${dc.remarks ? `
      <div style="margin-top: 12px; padding: 8px 12px; background: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; font-size: 0.8rem;">
        <strong>Closing Remarks:</strong> ${dc.remarks}
      </div>
    ` : ''}

    <div class="footer">
      <div class="sig-line">Cashier Signature</div>
      <div class="sig-line">Store Manager Signature</div>
    </div>
  </div>
  <script>window.onload = function() { window.print(); };</script>
</body>
</html>`;

    return new HtmlResponse(html);

    return new HtmlResponse(html);
  });

  // --------------------------------------------------------------------------
  // 10. Export Day Closing History to CSV (Excel-compatible)
  // --------------------------------------------------------------------------
  r.get('/api/day-closing/history/export.csv', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const branchId = ctx.query.branchId as string;

    let sql = `
      SELECT dc.*, u.name AS closed_by_name, au.name AS approved_by_name, b.name AS branch_name
      FROM day_closings dc
      LEFT JOIN users u ON u.id = dc.closed_by
      LEFT JOIN users au ON au.id = dc.approved_by
      LEFT JOIN branches b ON b.id = dc.branch_id OR b.code = dc.branch_id
      WHERE dc.tenant_id = ?
    `;
    const params: any[] = [tenantId];
    if (branchId && branchId !== 'all') {
      sql += ` AND dc.branch_id = ?`;
      params.push(branchId);
    }
    sql += ` ORDER BY dc.bdate DESC LIMIT 365`;
    const history = await ctx.db.query<any>(sql, params);

    const escapeCsv = (str: any) => `"${String(str ?? '').replace(/"/g, '""')}"`;
    const header = [
      'Date', 'Branch', 'Status', 'Gross Sales (Rs)', 'Returns (Rs)', 'Net Sales (Rs)',
      'Total Invoices', 'COGS (Rs)', 'Gross Profit (Rs)', 'Expenses (Rs)', 'Net Profit (Rs)',
      'Opening Cash (Rs)', 'Expected Cash (Rs)', 'Actual Cash (Rs)', 'Variance (Rs)',
      'Submitted By', 'Approved By', 'Remarks'
    ];
    const rows = history.map((h: any) => [
      h.bdate,
      h.branch_name || h.branch_id,
      h.status,
      (Number(h.gross_sales_minor || 0) / 100).toFixed(2),
      (Number(h.returns_total_minor || h.sales_returns_minor || 0) / 100).toFixed(2),
      (Number(h.net_sales_minor || 0) / 100).toFixed(2),
      h.invoices_count || 0,
      (Number(h.net_cogs_minor || 0) / 100).toFixed(2),
      (Number(h.gross_profit_minor || 0) / 100).toFixed(2),
      (Number(h.operating_expenses_minor || 0) / 100).toFixed(2),
      (Number(h.net_profit_minor || 0) / 100).toFixed(2),
      (Number(h.opening_cash_minor || 0) / 100).toFixed(2),
      (Number(h.expected_cash_minor || 0) / 100).toFixed(2),
      (Number(h.actual_cash_minor || 0) / 100).toFixed(2),
      (Number(h.variance_minor ?? 0) / 100).toFixed(2),
      h.closed_by_name || 'Cashier',
      h.approved_by_name || '—',
      h.remarks || ''
    ]);

    const csvContent = [header, ...rows].map((r) => r.map(escapeCsv).join(',')).join('\r\n');
    return new FileResponse(csvContent, 'text/csv; charset=utf-8', `DayClosing_History_${new Date().toISOString().slice(0, 10)}.csv`);
  });

  // --------------------------------------------------------------------------
  // 11. Export Single Day Closing to CSV (Excel-compatible)
  // --------------------------------------------------------------------------
  r.get('/api/day-closing/:id/export.csv', async (ctx) => {
    const id = ctx.params.id;
    let tenantId = (ctx.query.tenantId as string) || ctx.user?.tenantId;

    const dc = await ctx.db.one<any>(
      `SELECT dc.*, u.name AS closed_by_name, au.name AS approved_by_name, b.name AS branch_name
       FROM day_closings dc
       LEFT JOIN users u ON u.id = dc.closed_by
       LEFT JOIN users au ON au.id = dc.approved_by
       LEFT JOIN branches b ON (b.id = dc.branch_id OR b.code = dc.branch_id) AND b.tenant_id = dc.tenant_id
       WHERE dc.id = ? ${tenantId ? 'AND dc.tenant_id = ?' : ''}`,
      tenantId ? [id, tenantId] : [id],
    );
    if (!dc) throw notFound('Day closing record');

    const escapeCsv = (str: any) => `"${String(str ?? '').replace(/"/g, '""')}"`;
    const rows = [
      ['Metric', 'Value'],
      ['Closing Date', dc.bdate],
      ['Branch', dc.branchName || dc.branch_name || dc.branchId || dc.branch_id],
      ['Status', dc.status],
      ['Gross Sales (Rs)', (Number(dc.grossSalesMinor ?? dc.gross_sales_minor ?? 0) / 100).toFixed(2)],
      ['Sales Returns (Rs)', (Number(dc.returnsTotalMinor ?? dc.returns_total_minor ?? 0) / 100).toFixed(2)],
      ['Net Sales (Rs)', (Number(dc.netSalesMinor ?? dc.net_sales_minor ?? 0) / 100).toFixed(2)],
      ['Total Invoices', dc.invoicesCount ?? dc.invoices_count ?? 0],
      ['Cost of Goods Sold (COGS Rs)', (Number(dc.netCogsMinor ?? dc.net_cogs_minor ?? 0) / 100).toFixed(2)],
      ['Gross Profit (Rs)', (Number(dc.grossProfitMinor ?? dc.gross_profit_minor ?? 0) / 100).toFixed(2)],
      ['Operating Expenses (Rs)', (Number(dc.operatingExpensesMinor ?? dc.operating_expenses_minor ?? 0) / 100).toFixed(2)],
      ['Net Operating Profit (Rs)', (Number(dc.netProfitMinor ?? dc.net_profit_minor ?? 0) / 100).toFixed(2)],
      ['Opening Cash Float (Rs)', (Number(dc.openingCashMinor ?? dc.opening_cash_minor ?? 0) / 100).toFixed(2)],
      ['Cash Sales Collected (Rs)', (Number(dc.cashSalesMinor ?? dc.cash_sales_minor ?? 0) / 100).toFixed(2)],
      ['Cash Refunds Paid (Rs)', (Number(dc.cashRefundsMinor ?? dc.cash_refunds_minor ?? 0) / 100).toFixed(2)],
      ['Cash Expenses Paid (Rs)', (Number(dc.cashExpensesMinor ?? dc.cash_expenses_minor ?? 0) / 100).toFixed(2)],
      ['Expected Closing Cash (Rs)', (Number(dc.expectedCashMinor ?? dc.expected_cash_minor ?? 0) / 100).toFixed(2)],
      ['Actual Physical Cash Counted (Rs)', (Number(dc.actualCashMinor ?? dc.actual_cash_minor ?? 0) / 100).toFixed(2)],
      ['Cash Variance / Diff (Rs)', (Number(dc.varianceMinor ?? dc.variance_minor ?? 0) / 100).toFixed(2)],
      ['Submitted By', dc.closedByName || dc.closed_by_name || 'Cashier'],
      ['Approved By', dc.approvedByName || dc.approved_by_name || '—'],
      ['Remarks', dc.remarks || ''],
    ];

    const csvContent = rows.map((r) => r.map(escapeCsv).join(',')).join('\r\n');
    return new FileResponse(csvContent, 'text/csv; charset=utf-8', `DayClosing_${dc.bdate}_${dc.branchId || dc.branch_id || 'main'}.csv`);
  });
}
