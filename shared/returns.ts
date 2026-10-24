import { divRound, fmtMoney } from './money.ts';

export interface ReturnLineInput {
  origLineId: string;
  itemId?: string | null;
  name: string;
  hsn?: string | null;
  unit?: string | null;
  batchNo?: string | null;
  billedQtyMilli: number;
  alreadyReturnedQtyMilli: number;
  returnQtyMilli: number;
  priceMinor: number;
  taxRateBp: number;
  inclusive: boolean;
  origTaxableMinor: number;
  origCgstMinor: number;
  origSgstMinor: number;
  origIgstMinor: number;
  origTotalMinor: number;
  restock: boolean;
  reason?: string;
}

export interface CalculatedReturnLine {
  origLineId: string;
  itemId?: string | null;
  name: string;
  hsn?: string | null;
  unit?: string | null;
  batchNo?: string | null;
  billedQtyMilli: number;
  alreadyReturnedQtyMilli: number;
  returnQtyMilli: number;
  returnableQtyMilli: number;
  priceMinor: number;
  taxRateBp: number;
  inclusive: boolean;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  taxMinor: number;
  totalMinor: number;
  restock: boolean;
  reason: string;
}

export interface CalculatedReturn {
  lines: CalculatedReturnLine[];
  taxableTotalMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  taxMinor: number;
  roundOffMinor: number;
  totalCreditMinor: number;
  isIntraState: boolean;
}

export interface SettlementAllocation {
  invoiceId: string;
  invoiceNumber: string;
  amountMinor: number;
  isOrigInvoice: boolean;
}

export interface SettlementPlan {
  allocations: SettlementAllocation[];
  duesClearedMinor: number;
  remainderMinor: number;
  advanceAmountMinor: number;
  refundAmountMinor: number;
  refundMode?: string;
  refundReference?: string;
  totalCreditMinor: number;
}

/**
 * Calculates proportional credit note line reversals and totals.
 * Follows Section 6 of specs/Returns and Credit Notes Spec.md.
 */
export function calcReturn(
  linesInput: ReturnLineInput[],
  opts: {
    isIntraState: boolean;
    isFullInvoiceReturn?: boolean;
    origInvoiceTotalMinor?: number;
    alreadyCreditedTotalMinor?: number;
  },
): CalculatedReturn {
  const lines: CalculatedReturnLine[] = [];
  let taxableTotal = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;

  for (const l of linesInput) {
    const returnable = Math.max(0, l.billedQtyMilli - l.alreadyReturnedQtyMilli);
    if (l.returnQtyMilli < 0) {
      throw new Error(`Return quantity for ${l.name} cannot be negative.`);
    }
    if (l.returnQtyMilli > returnable) {
      throw new Error(`Only ${returnable / 1000} ${l.unit || 'units'} left to return on ${l.name}.`);
    }

    if (l.returnQtyMilli === 0) continue;

    let taxableMinor = 0;
    let cgstMinor = 0;
    let sgstMinor = 0;
    let igstMinor = 0;

    // If returning all remaining of this line and there were prior returns, reconcile to avoid paisa residue
    if (l.returnQtyMilli === returnable && l.alreadyReturnedQtyMilli > 0) {
      const priorRatio = l.alreadyReturnedQtyMilli / l.billedQtyMilli;
      const priorTaxable = divRound(l.origTaxableMinor * l.alreadyReturnedQtyMilli, l.billedQtyMilli);
      const priorCgst = divRound(l.origCgstMinor * l.alreadyReturnedQtyMilli, l.billedQtyMilli);
      const priorSgst = divRound(l.origSgstMinor * l.alreadyReturnedQtyMilli, l.billedQtyMilli);
      const priorIgst = divRound(l.origIgstMinor * l.alreadyReturnedQtyMilli, l.billedQtyMilli);

      taxableMinor = l.origTaxableMinor - priorTaxable;
      cgstMinor = l.origCgstMinor - priorCgst;
      sgstMinor = l.origSgstMinor - priorSgst;
      igstMinor = l.origIgstMinor - priorIgst;
    } else {
      taxableMinor = divRound(l.origTaxableMinor * l.returnQtyMilli, l.billedQtyMilli);
      if (opts.isIntraState) {
        cgstMinor = divRound(l.origCgstMinor * l.returnQtyMilli, l.billedQtyMilli);
        sgstMinor = divRound(l.origSgstMinor * l.returnQtyMilli, l.billedQtyMilli);
        igstMinor = 0;
      } else {
        cgstMinor = 0;
        sgstMinor = 0;
        igstMinor = divRound(l.origIgstMinor * l.returnQtyMilli, l.billedQtyMilli);
      }
    }

    const taxMinor = cgstMinor + sgstMinor + igstMinor;
    const totalMinor = taxableMinor + taxMinor;

    taxableTotal += taxableMinor;
    cgstTotal += cgstMinor;
    sgstTotal += sgstMinor;
    igstTotal += igstMinor;

    lines.push({
      origLineId: l.origLineId,
      itemId: l.itemId,
      name: l.name,
      hsn: l.hsn,
      unit: l.unit,
      batchNo: l.batchNo,
      billedQtyMilli: l.billedQtyMilli,
      alreadyReturnedQtyMilli: l.alreadyReturnedQtyMilli,
      returnQtyMilli: l.returnQtyMilli,
      returnableQtyMilli: returnable,
      priceMinor: l.priceMinor,
      taxRateBp: l.taxRateBp,
      inclusive: l.inclusive,
      taxableMinor,
      cgstMinor,
      sgstMinor,
      igstMinor,
      taxMinor,
      totalMinor,
      restock: Boolean(l.restock),
      reason: (l.reason || '').trim(),
    });
  }

  const taxTotal = cgstTotal + sgstTotal + igstTotal;
  const exactTotal = taxableTotal + taxTotal;

  // Round off to nearest rupee
  let roundedTotal = divRound(exactTotal, 100) * 100;

  // If this return represents the complete remaining return of the entire bill,
  // reconcile totalCreditMinor so cumulative credit equals original bill total
  if (
    opts.isFullInvoiceReturn &&
    opts.origInvoiceTotalMinor !== undefined &&
    opts.alreadyCreditedTotalMinor !== undefined
  ) {
    roundedTotal = Math.max(0, opts.origInvoiceTotalMinor - opts.alreadyCreditedTotalMinor);
  }

  const roundOffMinor = roundedTotal - exactTotal;

  return {
    lines,
    taxableTotalMinor: taxableTotal,
    cgstMinor: cgstTotal,
    sgstMinor: sgstTotal,
    igstMinor: igstTotal,
    taxMinor: taxTotal,
    roundOffMinor,
    totalCreditMinor: roundedTotal,
    isIntraState: opts.isIntraState,
  };
}

/**
 * Plans settlement: clears original bill dues first, then other customer bills FIFO,
 * then allocates remainder to Customer Advance or Refund Now.
 */
export function planSettlement(
  totalCreditMinor: number,
  origInvoice: { id: string; number: string; balanceMinor: number },
  otherBills: { id: string; number: string; balanceMinor: number }[],
  isRegisteredCustomer: boolean,
  remainderChoice: 'advance' | 'refund',
  refundOpts?: { mode: string; reference?: string },
): SettlementPlan {
  const allocations: SettlementAllocation[] = [];
  let unallocated = totalCreditMinor;

  // 1. Clear original bill dues first
  const origDue = Math.max(0, origInvoice.balanceMinor);
  const toOrig = Math.min(unallocated, origDue);
  if (toOrig > 0) {
    allocations.push({
      invoiceId: origInvoice.id,
      invoiceNumber: origInvoice.number,
      amountMinor: toOrig,
      isOrigInvoice: true,
    });
    unallocated -= toOrig;
  }

  // 2. Clear other customer bills oldest-first (FIFO) if registered customer
  if (unallocated > 0 && isRegisteredCustomer) {
    for (const b of otherBills) {
      const bDue = Math.max(0, b.balanceMinor);
      if (bDue <= 0) continue;
      const toB = Math.min(unallocated, bDue);
      if (toB > 0) {
        allocations.push({
          invoiceId: b.id,
          invoiceNumber: b.number,
          amountMinor: toB,
          isOrigInvoice: false,
        });
        unallocated -= toB;
      }
      if (unallocated === 0) break;
    }
  }

  const duesClearedMinor = totalCreditMinor - unallocated;
  const remainderMinor = unallocated;

  let advanceAmountMinor = 0;
  let refundAmountMinor = 0;
  let refundMode: string | undefined;
  let refundReference: string | undefined;

  if (remainderMinor > 0) {
    if (!isRegisteredCustomer || remainderChoice === 'refund') {
      refundAmountMinor = remainderMinor;
      refundMode = refundOpts?.mode || 'cash';
      refundReference = refundOpts?.reference;
    } else {
      advanceAmountMinor = remainderMinor;
    }
  }

  return {
    allocations,
    duesClearedMinor,
    remainderMinor,
    advanceAmountMinor,
    refundAmountMinor,
    refundMode,
    refundReference,
    totalCreditMinor,
  };
}
