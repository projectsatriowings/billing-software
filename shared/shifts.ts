// Shared rules and pure calculations for Cashier Shifts & Day-End Closing.
// Integer minor units (paise) are used throughout. No floating-point math.

import type { CashMovement, Shift, ShiftClosingReport, ShiftPaymentMethodBreakdown, ShiftSummary, VarianceClassification } from './types.ts';
export type { VarianceClassification };

export interface ExpectedCashInput {
  openingCashMinor: number;
  cashSalesMinor: number;
  cashPaymentsMinor: number;
  cashInMinor: number;
  cashOutMinor: number;
  cashRefundsMinor: number;
}

/**
 * Expected drawer cash calculation formula:
 * Expected cash = Opening cash + Eligible cash received (sales + collections) + Cash-in - Cash-out - Cash refunds paid from drawer
 */
export function calcExpectedCash(input: ExpectedCashInput): number {
  const opening = Math.max(0, Math.floor(input.openingCashMinor || 0));
  const sales = Math.max(0, Math.floor(input.cashSalesMinor || 0));
  const collections = Math.max(0, Math.floor(input.cashPaymentsMinor || 0));
  const cashIn = Math.max(0, Math.floor(input.cashInMinor || 0));
  const cashOut = Math.max(0, Math.floor(input.cashOutMinor || 0));
  const refunds = Math.max(0, Math.floor(input.cashRefundsMinor || 0));

  return opening + sales + collections + cashIn - cashOut - refunds;
}

/**
 * Cash variance formula:
 * Cash variance = Counted cash - Expected cash
 * Zero: exact match
 * Negative: cash shortage
 * Positive: cash excess
 */
export function calcShiftVariance(countedCashMinor: number, expectedCashMinor: number): number {
  return Math.floor(countedCashMinor) - Math.floor(expectedCashMinor);
}

export function classifyVariance(varianceMinor: number): {
  type: VarianceClassification;
  label: string;
  isBalanced: boolean;
  requiresReason: boolean;
  absAmountMinor: number;
} {
  const abs = Math.abs(varianceMinor);
  if (varianceMinor === 0) {
    return {
      type: 'exact',
      label: 'Balanced (Exact match)',
      isBalanced: true,
      requiresReason: false,
      absAmountMinor: 0,
    };
  }
  if (varianceMinor < 0) {
    return {
      type: 'shortage',
      label: 'Cash Shortage (Deficit)',
      isBalanced: false,
      requiresReason: true,
      absAmountMinor: abs,
    };
  }
  return {
    type: 'excess',
    label: 'Cash Excess (Overage)',
    isBalanced: false,
    requiresReason: true,
    absAmountMinor: abs,
  };
}

export interface RawPaymentItem {
  method?: string;
  mode?: string;
  amountMinor: number;
  status?: string;
  kind?: string; // 'receipt' | 'refund'
  isInvoiceCheckout?: boolean;
}

export function compileShiftSummary(params: {
  openingCashMinor: number;
  payments: RawPaymentItem[];
  cashInMinor: number;
  cashOutMinor: number;
  cashRefundsMinor: number;
  totalSalesBilledMinor?: number;
  creditSalesUnpaidMinor?: number;
  invoicesCount?: number;
  returnsCount?: number;
  cashMovesCount?: number;
  countedCashMinor?: number | null;
}): ShiftSummary {
  const openingCashMinor = Math.max(0, Math.floor(params.openingCashMinor || 0));
  const cashInMinor = Math.max(0, Math.floor(params.cashInMinor || 0));
  const cashOutMinor = Math.max(0, Math.floor(params.cashOutMinor || 0));
  const cashRefundsMinor = Math.max(0, Math.floor(params.cashRefundsMinor || 0));

  let cashSalesMinor = 0;
  let cashPaymentsMinor = 0;
  let nonCashPaymentsMinor = 0;
  let totalCollectedMinor = 0;

  const methodMap = new Map<string, { count: number; total: number }>();

  for (const p of params.payments) {
    if (p.status === 'reversed') continue;
    const rawMethod = (p.mode || p.method || 'cash').toLowerCase();
    const amt = Math.max(0, Math.floor(p.amountMinor || 0));
    if (amt <= 0) continue;

    const curr = methodMap.get(rawMethod) || { count: 0, total: 0 };
    curr.count += 1;
    curr.total += amt;
    methodMap.set(rawMethod, curr);

    totalCollectedMinor += amt;

    if (rawMethod === 'cash') {
      if (p.isInvoiceCheckout) {
        cashSalesMinor += amt;
      } else {
        cashPaymentsMinor += amt;
      }
    } else {
      nonCashPaymentsMinor += amt;
    }
  }

  const paymentMethods: ShiftPaymentMethodBreakdown[] = Array.from(methodMap.entries())
    .map(([method, data]) => ({
      method,
      count: data.count,
      amountMinor: data.total,
    }))
    .sort((a, b) => b.amountMinor - a.amountMinor);

  const totalCashReceivedMinor = cashSalesMinor + cashPaymentsMinor;
  const expectedCashMinor = calcExpectedCash({
    openingCashMinor,
    cashSalesMinor,
    cashPaymentsMinor,
    cashInMinor,
    cashOutMinor,
    cashRefundsMinor,
  });

  const countedCashMinor = params.countedCashMinor !== null && params.countedCashMinor !== undefined
    ? Math.floor(params.countedCashMinor)
    : null;

  const varianceMinor = countedCashMinor !== null
    ? calcShiftVariance(countedCashMinor, expectedCashMinor)
    : null;

  return {
    openingCashMinor,
    cashSalesMinor,
    cashPaymentsMinor,
    totalCashReceivedMinor,
    cashInMinor,
    cashOutMinor,
    cashRefundsMinor,
    expectedCashMinor,
    countedCashMinor,
    varianceMinor,
    nonCashPaymentsMinor,
    totalCollectedMinor,
    totalSalesBilledMinor: Math.max(0, Math.floor(params.totalSalesBilledMinor || 0)),
    creditSalesUnpaidMinor: Math.max(0, Math.floor(params.creditSalesUnpaidMinor || 0)),
    paymentMethods,
    transactionsCount: params.payments.filter((p) => p.status !== 'reversed').length,
    invoicesCount: Math.max(0, Math.floor(params.invoicesCount || 0)),
    returnsCount: Math.max(0, Math.floor(params.returnsCount || 0)),
    cashMovesCount: Math.max(0, Math.floor(params.cashMovesCount || 0)),
  };
}

/** Formats paise minor units to clean Indian Rupee string: e.g. 150000 -> ₹1,500.00 */
export function formatMoney(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return '—';
  const isNeg = minor < 0;
  const abs = Math.abs(minor);
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  const paiseStr = paise.toString().padStart(2, '0');
  const rupeesStr = rupees.toLocaleString('en-IN');
  return `${isNeg ? '-' : ''}₹${rupeesStr}.${paiseStr}`;
}

/**
 * Generates an A4 or Thermal print-friendly HTML document for Day-End Closing Report
 */
export function renderShiftClosingReportHtml(report: ShiftClosingReport, shop: { name: string; gstin?: string | null; address?: string | null; phone?: string | null }): string {
  const { shift, summary, cashMovements, recentTransactions } = report;
  const variance = summary.varianceMinor ?? 0;
  const classification = classifyVariance(variance);

  const formatDate = (d?: string | null) => {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
    } catch {
      return d;
    }
  };

  const cashMovementsHtml = cashMovements.length > 0
    ? cashMovements.map((cm) => `
      <tr>
        <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 13px;">${formatDate(cm.createdAt)}</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 13px; font-weight: 600; color: ${cm.movementType === 'cash_in' ? '#16a34a' : '#dc2626'};">${cm.movementType === 'cash_in' ? '+ Cash-In' : '- Cash-Out'}</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 13px;">${escapeHtml(cm.reason)}${cm.notes ? ` <span style="color:#64748b;">(${escapeHtml(cm.notes)})</span>` : ''}</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 13px; text-align: right; font-weight: 600;">${formatMoney(cm.amountMinor)}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="4" style="padding: 12px; text-align: center; color: #94a3b8; font-size: 13px;">No cash movements recorded during this shift.</td></tr>`;

  const paymentsHtml = summary.paymentMethods.length > 0
    ? summary.paymentMethods.map((pm) => `
      <tr>
        <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 13px; text-transform: uppercase; font-weight: 600;">${escapeHtml(pm.method)}</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 13px; text-align: center;">${pm.count}</td>
        <td style="padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 13px; text-align: right; font-weight: 600;">${formatMoney(pm.amountMinor)}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="3" style="padding: 12px; text-align: center; color: #94a3b8; font-size: 13px;">No payments recorded.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Day-End Closing Report - ${escapeHtml(shift.shiftNumber || shift.id)}</title>
  <style>
    @media print {
      body { margin: 0; padding: 12px; background: #fff !important; }
      .no-print { display: none !important; }
    }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 0; padding: 24px; background: #f8fafc; }
    .report-card { max-width: 800px; margin: 0 auto; background: #fff; padding: 32px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); border: 1px solid #e2e8f0; }
    .header { border-bottom: 2px solid #0f172a; padding-bottom: 16px; margin-bottom: 20px; }
    .shop-title { font-size: 24px; font-weight: 800; margin: 0 0 4px 0; color: #0f172a; }
    .report-title { font-size: 18px; font-weight: 700; color: #2563eb; margin: 8px 0 0 0; }
    .meta-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 24px; padding: 12px 16px; background: #f1f5f9; border-radius: 6px; }
    .meta-item { font-size: 13px; line-height: 1.5; }
    .meta-label { font-weight: 600; color: #475569; }
    .section-title { font-size: 15px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #1e293b; margin: 24px 0 10px 0; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th { text-align: left; padding: 8px; font-size: 12px; font-weight: 700; text-transform: uppercase; color: #475569; border-bottom: 2px solid #cbd5e1; background: #f8fafc; }
    .reconciliation-box { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 16px; margin-bottom: 20px; }
    .recon-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; border-bottom: 1px dashed #e2e8f0; }
    .recon-row.total { border-top: 2px solid #0f172a; border-bottom: none; font-size: 16px; font-weight: 800; padding-top: 10px; margin-top: 6px; }
    .recon-row.counted { font-size: 15px; font-weight: 700; color: #2563eb; }
    .recon-row.variance { font-size: 16px; font-weight: 800; padding: 10px 0; }
    .variance-exact { color: #16a34a; }
    .variance-shortage { color: #dc2626; }
    .variance-excess { color: #2563eb; }
    .print-bar { max-width: 800px; margin: 0 auto 16px auto; display: flex; justify-content: flex-end; gap: 8px; }
    .btn { padding: 8px 16px; font-size: 14px; font-weight: 600; border-radius: 6px; cursor: pointer; border: none; }
    .btn-primary { background: #2563eb; color: #fff; }
    .btn-secondary { background: #e2e8f0; color: #0f172a; }
  </style>
</head>
<body>
  <div class="print-bar no-print">
    <button class="btn btn-secondary" onclick="window.close()">Close</button>
    <button class="btn btn-primary" onclick="window.print()">Print Report (Ctrl+P)</button>
  </div>
  <div class="report-card">
    <div class="header">
      <div class="shop-title">${escapeHtml(shop.name)}</div>
      ${shop.address ? `<div style="font-size: 13px; color: #64748b;">${escapeHtml(shop.address)}</div>` : ''}
      ${shop.gstin ? `<div style="font-size: 13px; color: #64748b;">GSTIN: <strong>${escapeHtml(shop.gstin)}</strong></div>` : ''}
      <div class="report-title">DAY-END SHIFT CLOSING REPORT</div>
    </div>

    <div class="meta-grid">
      <div class="meta-item"><span class="meta-label">Shift Number:</span> <strong>${escapeHtml(shift.shiftNumber || shift.id)}</strong></div>
      <div class="meta-item"><span class="meta-label">Status:</span> <strong>${escapeHtml(shift.status.toUpperCase())}</strong></div>
      <div class="meta-item"><span class="meta-label">Cashier / Staff:</span> ${escapeHtml(shift.userName || 'Unknown')}</div>
      <div class="meta-item"><span class="meta-label">Counter Location:</span> ${escapeHtml(shift.location || 'MAIN')}</div>
      <div class="meta-item"><span class="meta-label">Opened At:</span> ${formatDate(shift.openedAt)}</div>
      <div class="meta-item"><span class="meta-label">Closed At:</span> ${formatDate(shift.closedAt)}</div>
      ${shift.closedByName ? `<div class="meta-item"><span class="meta-label">Closed By:</span> ${escapeHtml(shift.closedByName)}</div>` : ''}
      ${shift.reviewedByName ? `<div class="meta-item"><span class="meta-label">Reviewed By:</span> ${escapeHtml(shift.reviewedByName)} (${formatDate(shift.reviewedAt)})</div>` : ''}
    </div>

    <div class="section-title">Cash Drawer Reconciliation</div>
    <div class="reconciliation-box">
      <div class="recon-row">
        <span>Opening Cash Float:</span>
        <span>${formatMoney(summary.openingCashMinor)}</span>
      </div>
      <div class="recon-row">
        <span>(+) Cash Sales (POS Checkout):</span>
        <span style="color: #16a34a;">+ ${formatMoney(summary.cashSalesMinor)}</span>
      </div>
      <div class="recon-row">
        <span>(+) Cash Payments (Khata / Credit Invoices):</span>
        <span style="color: #16a34a;">+ ${formatMoney(summary.cashPaymentsMinor)}</span>
      </div>
      <div class="recon-row">
        <span>(+) Authorized Cash-In:</span>
        <span style="color: #16a34a;">+ ${formatMoney(summary.cashInMinor)}</span>
      </div>
      <div class="recon-row">
        <span>(-) Authorized Cash-Out:</span>
        <span style="color: #dc2626;">- ${formatMoney(summary.cashOutMinor)}</span>
      </div>
      <div class="recon-row">
        <span>(-) Cash Refunds Paid to Customers:</span>
        <span style="color: #dc2626;">- ${formatMoney(summary.cashRefundsMinor)}</span>
      </div>
      <div class="recon-row total">
        <span>(=) Expected Cash in Drawer:</span>
        <span>${formatMoney(summary.expectedCashMinor)}</span>
      </div>
      <div class="recon-row counted" style="margin-top: 8px;">
        <span>Actual Counted Cash:</span>
        <span>${formatMoney(summary.countedCashMinor)}</span>
      </div>
      <div class="recon-row variance ${variance === 0 ? 'variance-exact' : variance < 0 ? 'variance-shortage' : 'variance-excess'}">
        <span>Cash Variance:</span>
        <span>${classification.label} • ${formatMoney(variance)}</span>
      </div>
      ${shift.note ? `
        <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed #cbd5e1; font-size: 13px;">
          <strong>Cashier Closing Note:</strong> ${escapeHtml(shift.note)}
        </div>
      ` : ''}
      ${shift.reviewNotes ? `
        <div style="margin-top: 4px; font-size: 13px; color: #475569;">
          <strong>Manager Review Note:</strong> ${escapeHtml(shift.reviewNotes)}
        </div>
      ` : ''}
    </div>

    <div class="section-title">Collections by Payment Method</div>
    <table>
      <thead>
        <tr>
          <th>Payment Method</th>
          <th style="text-align: center;">Transactions</th>
          <th style="text-align: right;">Amount Collected</th>
        </tr>
      </thead>
      <tbody>
        ${paymentsHtml}
      </tbody>
      <tfoot>
        <tr style="border-top: 2px solid #0f172a; font-weight: 700;">
          <td style="padding: 8px;">Total Collections</td>
          <td style="padding: 8px; text-align: center;">${summary.transactionsCount}</td>
          <td style="padding: 8px; text-align: right;">${formatMoney(summary.totalCollectedMinor)}</td>
        </tr>
      </tfoot>
    </table>

    <div class="section-title">Cash-In and Cash-Out Movements</div>
    <table>
      <thead>
        <tr>
          <th>Time</th>
          <th>Type</th>
          <th>Reason & Note</th>
          <th style="text-align: right;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${cashMovementsHtml}
      </tbody>
    </table>

    <div style="margin-top: 40px; display: grid; grid-template-columns: repeat(2, 1fr); gap: 40px; padding-top: 20px; border-top: 1px solid #cbd5e1;">
      <div style="text-align: center;">
        <div style="border-bottom: 1px solid #94a3b8; height: 40px;"></div>
        <div style="margin-top: 6px; font-size: 13px; font-weight: 600;">Cashier Signature (${escapeHtml(shift.userName || 'Staff')})</div>
      </div>
      <div style="text-align: center;">
        <div style="border-bottom: 1px solid #94a3b8; height: 40px;"></div>
        <div style="margin-top: 6px; font-size: 13px; font-weight: 600;">Manager / Owner Approval</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(s?: string | null): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
