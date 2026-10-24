import { calcBill } from './tax.ts';
import { divRound, fmtMoney } from './money.ts';

export interface PurchaseLineInput {
  itemId: string;
  name: string;
  hsn?: string | null;
  unit?: string | null;
  billedQtyMilli: number;
  receivedQtyMilli: number;
  costMinor: number; // Unit purchase rate (paise)
  discountMinor?: number; // Line discount (paise)
  taxRateBp: number; // Basis points (e.g. 1200 for 12%)
  inclusive?: boolean;
  batchNo?: string | null;
  expiry?: string | null;
}

export interface CalculatedPurchaseLine {
  itemId: string;
  name: string;
  hsn?: string | null;
  unit?: string | null;
  billedQtyMilli: number;
  receivedQtyMilli: number;
  costMinor: number;
  discountMinor: number;
  taxRateBp: number;
  inclusive: boolean;
  batchNo?: string | null;
  expiry?: string | null;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export interface CalculatedPurchase {
  lines: CalculatedPurchaseLine[];
  subtotalMinor: number;
  discountMinor: number;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  taxMinor: number;
  itcMinor: number;
  otherChargesLabel: string | null;
  otherChargesMinor: number;
  otherChargesGstMinor: number;
  otherChargesGstBp: number;
  roundOffMinor: number;
  totalMinor: number;
  isIntraState: boolean;
  hasGstin: boolean;
}

export interface OpenPurchaseForAllocation {
  id: string;
  purchaseNumber?: string | null;
  billNo?: string | null;
  supplierInvoiceNumber?: string | null;
  supplierInvoiceDate?: string | null;
  bdate?: string | null;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
}

export interface SupplierPaymentAllocationPlan {
  allocations: Array<{
    purchaseId: string;
    purchaseNumber: string;
    supplierInvoiceNumber: string;
    allocatedMinor: number;
    balanceBeforeMinor: number;
    balanceAfterMinor: number;
    statusAfter: 'paid' | 'part_paid' | 'unpaid';
  }>;
  totalAllocatedMinor: number;
  payableBeforeMinor: number;
  payableAfterMinor: number;
  isFullySettled: boolean;
}

/**
 * Calculates purchase totals, per-line GST, and Input Tax Credit (ITC)
 * adhering strictly to Section 6 of Purchase and Stock Inward Spec.
 *
 * Rule: Money, ITC, and stock follow the received quantity at the billed rate.
 * If supplier has no GSTIN on record, ITC = 0 and tax = 0 on all lines.
 */
export function calcPurchase(params: {
  lines: PurchaseLineInput[];
  supplierGstin?: string | null;
  supplierState?: string | null;
  shopState?: string | null;
  otherChargesLabel?: string | null;
  otherChargesMinor?: number;
  otherChargesGstBp?: number;
}): CalculatedPurchase {
  const {
    lines,
    supplierGstin,
    supplierState = '33',
    shopState = '33',
    otherChargesLabel = null,
    otherChargesMinor = 0,
    otherChargesGstBp = 0,
  } = params;

  const hasGstin = Boolean(supplierGstin && supplierGstin.trim().length >= 15);
  const isIntraState = !supplierState || !shopState || supplierState === shopState;

  // If supplier has no GSTIN, tax is 0 on every line
  if (!hasGstin) {
    let sumTaxable = 0;
    let sumDiscount = 0;
    let sumGross = 0;

    const calcLines: CalculatedPurchaseLine[] = lines.map((l) => {
      const grossMinor = Math.round((l.costMinor * l.receivedQtyMilli) / 1000);
      const discountMinor = Math.min(l.discountMinor ?? 0, grossMinor);
      const taxableMinor = Math.max(0, grossMinor - discountMinor);

      sumGross += grossMinor;
      sumDiscount += discountMinor;
      sumTaxable += taxableMinor;

      return {
        itemId: l.itemId,
        name: l.name,
        hsn: l.hsn,
        unit: l.unit,
        billedQtyMilli: l.billedQtyMilli,
        receivedQtyMilli: l.receivedQtyMilli,
        costMinor: l.costMinor,
        discountMinor,
        taxRateBp: 0,
        inclusive: Boolean(l.inclusive),
        batchNo: l.batchNo,
        expiry: l.expiry,
        taxableMinor,
        cgstMinor: 0,
        sgstMinor: 0,
        igstMinor: 0,
        taxMinor: 0,
        totalMinor: taxableMinor,
      };
    });

    const rawTotal = sumTaxable + otherChargesMinor;
    const roundedTotal = Math.round(rawTotal / 100) * 100;
    const roundOffMinor = roundedTotal - rawTotal;

    return {
      lines: calcLines,
      subtotalMinor: sumGross,
      discountMinor: sumDiscount,
      taxableMinor: sumTaxable,
      cgstMinor: 0,
      sgstMinor: 0,
      igstMinor: 0,
      taxMinor: 0,
      itcMinor: 0,
      otherChargesLabel: otherChargesMinor > 0 ? (otherChargesLabel || 'Transport') : null,
      otherChargesMinor,
      otherChargesGstMinor: 0,
      otherChargesGstBp: 0,
      roundOffMinor,
      totalMinor: roundedTotal,
      isIntraState,
      hasGstin: false,
    };
  }

  // Supplier with valid GSTIN -> calculate GST using tax engine
  const billCalc = calcBill(
    lines.map((l) => ({
      name: l.name,
      qtyMilli: l.receivedQtyMilli, // Money & tax follow received quantity
      priceMinor: l.costMinor,
      discountMinor: l.discountMinor ?? 0,
      taxRateBp: l.taxRateBp,
      inclusive: Boolean(l.inclusive),
    })),
    {
      intraState: isIntraState,
      roundTotal: 'none', // We apply final rounding with other charges
    },
  );

  const calcLines: CalculatedPurchaseLine[] = lines.map((l, idx) => {
    const cl = billCalc.lines[idx];
    return {
      itemId: l.itemId,
      name: l.name,
      hsn: l.hsn,
      unit: l.unit,
      billedQtyMilli: l.billedQtyMilli,
      receivedQtyMilli: l.receivedQtyMilli,
      costMinor: l.costMinor,
      discountMinor: cl.discountMinor,
      taxRateBp: l.taxRateBp,
      inclusive: Boolean(l.inclusive),
      batchNo: l.batchNo,
      expiry: l.expiry,
      taxableMinor: cl.taxableMinor,
      cgstMinor: cl.cgstMinor,
      sgstMinor: cl.sgstMinor,
      igstMinor: cl.igstMinor,
      taxMinor: cl.taxMinor,
      totalMinor: cl.totalMinor,
    };
  });

  // Calculate Other Charges GST if applicable
  let otherChargesGstMinor = 0;
  let otherCgstMinor = 0;
  let otherSgstMinor = 0;
  let otherIgstMinor = 0;

  if (otherChargesMinor > 0 && otherChargesGstBp > 0) {
    otherChargesGstMinor = Math.round((otherChargesMinor * otherChargesGstBp) / 10000);
    if (isIntraState) {
      otherCgstMinor = Math.round(otherChargesGstMinor / 2);
      otherSgstMinor = otherChargesGstMinor - otherCgstMinor;
    } else {
      otherIgstMinor = otherChargesGstMinor;
    }
  }

  const taxableTotal = billCalc.taxableMinor + (otherChargesGstBp > 0 ? otherChargesMinor : 0);
  const totalCgst = billCalc.cgstMinor + otherCgstMinor;
  const totalSgst = billCalc.sgstMinor + otherSgstMinor;
  const totalIgst = billCalc.igstMinor + otherIgstMinor;
  const totalTax = totalCgst + totalSgst + totalIgst;
  const itcMinor = totalTax;

  const rawTotal = billCalc.lines.reduce((sum, l) => sum + l.totalMinor, 0) + otherChargesMinor + otherChargesGstMinor;
  const roundedTotal = Math.round(rawTotal / 100) * 100;
  const roundOffMinor = roundedTotal - rawTotal;

  return {
    lines: calcLines,
    subtotalMinor: billCalc.subtotalMinor,
    discountMinor: billCalc.discountMinor,
    taxableMinor: taxableTotal,
    cgstMinor: totalCgst,
    sgstMinor: totalSgst,
    igstMinor: totalIgst,
    taxMinor: totalTax,
    itcMinor,
    otherChargesLabel: otherChargesMinor > 0 ? (otherChargesLabel || 'Transport') : null,
    otherChargesMinor,
    otherChargesGstMinor,
    otherChargesGstBp,
    roundOffMinor,
    totalMinor: roundedTotal,
    isIntraState,
    hasGstin: true,
  };
}

/**
 * Plans supplier payment allocation in strict FIFO order (oldest purchase first)
 * adhering to Section 7.2 and 7.3 of Purchase and Stock Inward Spec.
 */
export function planSupplierPayment(
  openPurchases: OpenPurchaseForAllocation[],
  paymentAmountMinor: number,
): SupplierPaymentAllocationPlan {
  const payableBefore = openPurchases.reduce((sum, p) => sum + Math.max(0, p.balanceMinor), 0);

  if (paymentAmountMinor > payableBefore) {
    throw new Error(
      `Amount cannot exceed the payable of ${fmtMoney(payableBefore)}. Advances to suppliers are not recorded here yet.`,
    );
  }

  // Sort FIFO: oldest supplier invoice date, then bdate, then purchase number
  const sorted = [...openPurchases]
    .filter((p) => p.balanceMinor > 0)
    .sort((a, b) => {
      const dateA = a.supplierInvoiceDate || a.bdate || '';
      const dateB = b.supplierInvoiceDate || b.bdate || '';
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      const numA = a.purchaseNumber || a.id;
      const numB = b.purchaseNumber || b.id;
      return numA.localeCompare(numB);
    });

  let remaining = paymentAmountMinor;
  const allocations: SupplierPaymentAllocationPlan['allocations'] = [];

  for (const pur of sorted) {
    if (remaining <= 0) break;
    const alloc = Math.min(pur.balanceMinor, remaining);
    const balanceAfter = pur.balanceMinor - alloc;
    allocations.push({
      purchaseId: pur.id,
      purchaseNumber: pur.purchaseNumber || pur.id,
      supplierInvoiceNumber: pur.supplierInvoiceNumber || pur.billNo || '',
      allocatedMinor: alloc,
      balanceBeforeMinor: pur.balanceMinor,
      balanceAfterMinor: balanceAfter,
      statusAfter: balanceAfter === 0 ? 'paid' : 'part_paid',
    });
    remaining -= alloc;
  }

  const totalAllocated = paymentAmountMinor - remaining;
  const payableAfter = payableBefore - totalAllocated;

  return {
    allocations,
    totalAllocatedMinor: totalAllocated,
    payableBeforeMinor: payableBefore,
    payableAfterMinor: payableAfter,
    isFullySettled: payableAfter === 0,
  };
}
