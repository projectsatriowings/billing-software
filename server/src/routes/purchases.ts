import { requirePerm } from '../auth.ts';
import { bad, conflict, notFound, forbidden, V, type Router } from '../http.ts';
import { newId } from '../security.ts';
import { audit } from '../audit.ts';
import { calcPurchase, planSupplierPayment } from '../../../shared/purchases.ts';
import { renderPurchaseDoc, type PrintablePurchase } from '../../../shared/bill.ts';
import { fmtMoney } from '../../../shared/money.ts';

function formatPurchase(r: any, lines: any[] = [], payments: any[] = []) {
  const totalMinor = Number(r.totalMinor ?? r.total_minor ?? 0);
  const paidMinor = Number(r.paidMinor ?? r.paid_minor ?? 0);
  const balanceMinor = Number(r.balanceMinor ?? r.balance_minor ?? Math.max(0, totalMinor - paidMinor));
  const rawStatus = r.status || 'posted';

  // Derived payment status when status is posted
  let paymentStatus: 'paid' | 'part_paid' | 'unpaid' | 'voided' = 'unpaid';
  if (rawStatus === 'voided') {
    paymentStatus = 'voided';
  } else if (balanceMinor === 0) {
    paymentStatus = 'paid';
  } else if (paidMinor > 0) {
    paymentStatus = 'part_paid';
  } else {
    paymentStatus = 'unpaid';
  }

  return {
    id: r.id,
    tenantId: r.tenantId ?? r.tenant_id,
    purchaseNumber: r.purchaseNumber ?? r.purchase_number ?? ('PUR-' + r.id.slice(-4)),
    supplierId: r.supplierId ?? r.supplier_id,
    supplierName: r.supplierName ?? r.supplier_name ?? null,
    supplierPhone: r.supplierPhone ?? r.supplier_phone ?? null,
    supplierGstin: r.supplierGstin ?? r.supplier_gstin ?? null,
    supplierAddress: r.supplierAddress ?? r.supplier_address ?? null,
    supplierInvoiceNumber: r.supplierInvoiceNumber ?? r.supplier_invoice_number ?? r.billNo ?? r.bill_no ?? '',
    supplierInvoiceDate: r.supplierInvoiceDate ?? r.supplier_invoice_date ?? r.bdate ?? '',
    purchaseDate: r.purchaseDate ?? r.purchase_date ?? r.bdate ?? '',
    billNo: r.supplierInvoiceNumber ?? r.supplier_invoice_number ?? r.billNo ?? r.bill_no ?? '',
    bdate: r.purchaseDate ?? r.purchase_date ?? r.bdate ?? '',
    status: rawStatus,
    paymentStatus,
    subtotalMinor: Number(r.subtotalMinor ?? r.subtotal_minor ?? r.taxableMinor ?? r.taxable_minor ?? 0),
    discountMinor: Number(r.discountMinor ?? r.discount_minor ?? 0),
    taxableMinor: Number(r.taxableMinor ?? r.taxable_minor ?? 0),
    taxMinor: Number(r.taxMinor ?? r.tax_minor ?? 0),
    cgstMinor: Number(r.cgstMinor ?? r.cgst_minor ?? 0),
    sgstMinor: Number(r.sgstMinor ?? r.sgst_minor ?? 0),
    igstMinor: Number(r.igstMinor ?? r.igst_minor ?? 0),
    itcMinor: Number(r.itcMinor ?? r.itc_minor ?? ((r.cgstMinor ?? r.cgst_minor ?? 0) + (r.sgstMinor ?? r.sgst_minor ?? 0) + (r.igstMinor ?? r.igst_minor ?? 0))),
    otherChargesLabel: r.otherChargesLabel ?? r.other_charges_label ?? null,
    otherChargesMinor: Number(r.otherChargesMinor ?? r.other_charges_minor ?? 0),
    otherChargesGstMinor: Number(r.otherChargesGstMinor ?? r.other_charges_gst_minor ?? 0),
    otherChargesGstBp: Number(r.otherChargesGstBp ?? r.other_charges_gst_bp ?? 0),
    roundOffMinor: Number(r.roundOffMinor ?? r.round_off_minor ?? 0),
    totalMinor,
    paidMinor,
    balanceMinor,
    paymentMethod: r.paymentMethod ?? r.payment_method ?? null,
    note: r.note ?? null,
    voidReason: r.voidReason ?? r.void_reason ?? null,
    voidedBy: r.voidedBy ?? r.voided_by ?? null,
    voidedAt: r.voidedAt ?? r.voided_at ?? null,
    createdBy: r.createdBy ?? r.created_by ?? null,
    createdAt: r.createdAt ?? r.created_at,
    lines: lines.map((l: any) => ({
      id: l.id,
      purchaseId: l.purchaseId ?? l.purchase_id,
      itemId: l.itemId ?? l.item_id,
      name: l.name,
      hsn: l.hsn ?? null,
      unit: l.unit ?? null,
      billedQtyMilli: Number(l.billedQtyMilli ?? l.billed_qty_milli ?? l.qtyMilli ?? l.qty_milli ?? 0),
      receivedQtyMilli: Number(l.receivedQtyMilli ?? l.received_qty_milli ?? l.qtyMilli ?? l.qty_milli ?? 0),
      qtyMilli: Number(l.receivedQtyMilli ?? l.received_qty_milli ?? l.qtyMilli ?? l.qty_milli ?? 0),
      costMinor: Number(l.costMinor ?? l.cost_minor ?? 0),
      discountMinor: Number(l.discountMinor ?? l.discount_minor ?? 0),
      taxRateBp: Number(l.taxRateBp ?? l.tax_rate_bp ?? 0),
      taxableMinor: Number(l.taxableMinor ?? l.taxable_minor ?? 0),
      taxMinor: Number(l.taxMinor ?? l.tax_minor ?? 0),
      cgstMinor: Number(l.cgstMinor ?? l.cgst_minor ?? 0),
      sgstMinor: Number(l.sgstMinor ?? l.sgst_minor ?? 0),
      igstMinor: Number(l.igstMinor ?? l.igst_minor ?? 0),
      totalMinor: Number(l.totalMinor ?? l.total_minor ?? 0),
      batchNo: l.batchNo ?? l.batch_no ?? null,
      expiry: l.expiry ?? null,
    })),
    payments: payments.map((p: any) => ({
      id: p.id,
      paymentNumber: p.paymentNumber ?? p.payment_number ?? null,
      method: p.method ?? p.mode,
      amountMinor: Number(p.amountMinor ?? p.amount_minor ?? 0),
      reference: p.reference ?? p.referenceNo ?? p.reference_no ?? null,
      bdate: p.bdate ?? p.paymentDate ?? p.payment_date,
      status: p.status || 'posted',
      voidReason: p.voidReason ?? p.void_reason ?? null,
      createdAt: p.createdAt ?? p.created_at,
    })),
  };
}

export function registerPurchases(r: Router) {
  // List purchases with filters & supplier details
  // Excluded for Cashier role!
  r.get('/api/purchases', requirePerm('purchases'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const status = ctx.query.status;
    const supplierId = ctx.query.supplierId;
    const from = ctx.query.from;
    const to = ctx.query.to;
    const q = (ctx.query.q ?? '').trim().toLowerCase();

    let sql = `
      SELECT p.*,
             part.name AS supplier_name,
             part.phone AS supplier_phone,
             part.gstin AS supplier_gstin,
             part.address AS supplier_address
      FROM purchases p
      LEFT JOIN parties part ON p.supplier_id = part.id AND part.tenant_id = p.tenant_id
      WHERE p.tenant_id = ?
    `;
    const params: unknown[] = [tenantId];

    if (status && status !== 'ALL') {
      if (status === 'voided') {
        sql += ' AND p.status = \'voided\'';
      } else if (status === 'paid') {
        sql += ' AND p.status != \'voided\' AND p.balance_minor = 0';
      } else if (status === 'part_paid') {
        sql += ' AND p.status != \'voided\' AND p.balance_minor > 0 AND p.paid_minor > 0';
      } else if (status === 'unpaid') {
        sql += ' AND p.status != \'voided\' AND p.paid_minor = 0';
      } else {
        sql += ' AND p.status = ?';
        params.push(status);
      }
    }

    if (supplierId) {
      sql += ' AND p.supplier_id = ?';
      params.push(supplierId);
    }

    if (from) {
      sql += ' AND COALESCE(p.purchase_date, p.bdate) >= ?';
      params.push(from);
    }
    if (to) {
      sql += ' AND COALESCE(p.purchase_date, p.bdate) <= ?';
      params.push(to);
    }

    if (q) {
      sql += ' AND (lower(COALESCE(p.purchase_number, \'\')) LIKE ? OR lower(COALESCE(p.supplier_invoice_number, p.bill_no, \'\')) LIKE ? OR lower(COALESCE(part.name, \'\')) LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    const limit = Math.min(Math.max(V.int(ctx.query.limit ?? 100, 'Limit', { min: 1, max: 500 }), 1), 500);
    const offset = Math.max(V.int(ctx.query.offset ?? 0, 'Offset', { min: 0 }), 0);

    sql += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = await ctx.db.query(sql, params);
    return {
      purchases: rows.map((row) => formatPurchase(row)),
    };
  });

  // Get single purchase with lines and payment history
  r.get('/api/purchases/:id', requirePerm('purchases'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const purchase = await ctx.db.one(
      `SELECT p.*,
              part.name AS supplier_name,
              part.phone AS supplier_phone,
              part.gstin AS supplier_gstin,
              part.address AS supplier_address
       FROM purchases p
       LEFT JOIN parties part ON p.supplier_id = part.id AND part.tenant_id = p.tenant_id
       WHERE p.id = ? AND p.tenant_id = ?`,
      [ctx.params.id, tenantId],
    );
    if (!purchase) throw notFound('Purchase');

    const lines = await ctx.db.query(
      'SELECT * FROM purchase_lines WHERE purchase_id = ? AND tenant_id = ? ORDER BY id ASC',
      [purchase.id, tenantId],
    );

    // Fetch payments either directly linked or through supplier_payment_allocations
    const payments = await ctx.db.query(
      `SELECT DISTINCT p.*, spa.amount_minor AS allocated_to_this_purchase
       FROM payments p
       LEFT JOIN supplier_payment_allocations spa ON spa.payment_id = p.id AND spa.tenant_id = p.tenant_id
       WHERE (p.purchase_id = ? OR spa.purchase_id = ?) AND p.tenant_id = ?
       ORDER BY p.created_at ASC`,
      [purchase.id, purchase.id, tenantId],
    );

    return { purchase: formatPurchase(purchase, lines, payments) };
  });

  // Create purchase bill (Atomic Save & Stock Inward)
  r.post('/api/purchases', requirePerm('purchases'), async (ctx) => {
    try {
      const b = ctx.body ?? {};
      const tenantId = ctx.user!.tenantId;

    // Idempotency check
    const idempotencyKey = V.optStr(b.idempotencyKey, 'Idempotency key', 100);
    if (idempotencyKey) {
      const existing = await ctx.db.one(
        'SELECT * FROM purchases WHERE tenant_id = ? AND idempotency_key = ? AND status != \'voided\'',
        [tenantId, idempotencyKey],
      );
      if (existing) {
        const lines = await ctx.db.query(
          'SELECT * FROM purchase_lines WHERE purchase_id = ? AND tenant_id = ? ORDER BY id ASC',
          [existing.id, tenantId],
        );
        return { idempotent: true, purchase: formatPurchase(existing, lines) };
      }
    }

    const supplierId = V.str(b.supplierId, 'Supplier', { required: true, max: 60 });
    const supplierInvoiceNumber = V.str(b.supplierInvoiceNumber || b.billNo, 'Supplier Invoice Number', { required: true, min: 1, max: 60 });
    const supplierInvoiceDate = V.str(b.supplierInvoiceDate || b.bdate, 'Supplier Invoice Date', { required: true, min: 10, max: 20 });
    const purchaseDate = V.optStr(b.purchaseDate || b.bdate, 'Purchase Date', 20) || new Date().toISOString().slice(0, 10);
    const note = V.optStr(b.note, 'Note', 500);
    const linesInput = V.arr(b.lines, 'Purchase items', { min: 1 });
    const paidMinor = V.int(b.paidMinor ?? 0, 'Paid amount (paise)', { min: 0 });
    const paymentMethod = b.paymentMethod ? V.oneOf(b.paymentMethod, 'Payment method', ['cash', 'upi', 'card', 'bank'] as const) : 'cash';
    const paymentReference = V.optStr(b.paymentReference || b.reference, 'Payment reference', 100);

    const otherChargesLabel = V.optStr(b.otherChargesLabel, 'Other charges label', 100);
    const otherChargesMinor = V.int(b.otherChargesMinor ?? 0, 'Other charges amount', { min: 0 });
    const otherChargesGstBp = V.int(b.otherChargesGstBp ?? 0, 'Other charges GST rate', { min: 0, max: 10000 });

    // Date validations
    const todayStr = new Date().toISOString().slice(0, 10);
    if (supplierInvoiceDate > todayStr) {
      throw bad('Supplier invoice date cannot be in the future', 'INVALID_DATE');
    }
    if (purchaseDate < supplierInvoiceDate) {
      throw bad('Purchase date cannot be before the supplier invoice date', 'INVALID_DATE');
    }

    // 1. Verify supplier belongs to this business
    const supplier = await ctx.db.one<{ id: string; name: string; gstin?: string; state_code?: string; stateCode?: string; address?: string }>(
      'SELECT id, name, gstin, state_code, address FROM parties WHERE id = ? AND tenant_id = ?',
      [supplierId, tenantId],
    );
    if (!supplier) {
      throw notFound('Supplier not found in your business');
    }

    // 2. Duplicate Check: same supplier + same supplier invoice number already recorded (non-voided)
    const duplicate = await ctx.db.one<{ id: string; purchase_number?: string; purchaseNumber?: string; bdate?: string; purchase_date?: string; purchaseDate?: string }>(
      `SELECT id, purchase_number, bdate, purchase_date
       FROM purchases
       WHERE tenant_id = ?
         AND supplier_id = ?
         AND lower(COALESCE(supplier_invoice_number, bill_no, '')) = lower(?)
         AND status != 'voided'`,
      [tenantId, supplierId, supplierInvoiceNumber],
    );
    if (duplicate) {
      const purNum = duplicate.purchaseNumber ?? duplicate.purchase_number ?? duplicate.id;
      const purDate = duplicate.purchaseDate ?? duplicate.purchase_date ?? duplicate.bdate ?? '';
      throw bad(
        `Invoice ${supplierInvoiceNumber} from this supplier is already recorded as ${purNum} on ${purDate}.`,
        'DUPLICATE_PURCHASE',
      );
    }

    // 3. Verify items and lines
    let totalReceivedUnits = 0;
    const formattedLines: Array<{
      itemId: string;
      name: string;
      hsn: string | null;
      unit: string;
      billedQtyMilli: number;
      receivedQtyMilli: number;
      costMinor: number;
      discountMinor: number;
      taxRateBp: number;
      inclusive: boolean;
      batchNo: string | null;
      expiry: string | null;
    }> = [];

    for (let i = 0; i < linesInput.length; i++) {
      const l = linesInput[i];
      const itemId = V.str(l.itemId, `Item ${i + 1} product ID`, { required: true });
      const itemRow = await ctx.db.one<{ id: string; name: string; hsn?: string; unit?: string; track_batch?: boolean; trackBatch?: boolean }>(
        'SELECT id, name, hsn, unit, track_batch FROM items WHERE id = ? AND tenant_id = ?',
        [itemId, tenantId],
      );
      if (!itemRow) {
        throw notFound(`Product ID "${itemId}" not found in your business`);
      }

      const billedQtyMilli = V.int(l.billedQtyMilli ?? l.qtyMilli, `Item "${itemRow.name}" billed quantity`, { min: 1, required: true });
      const receivedQtyMilli = V.int(l.receivedQtyMilli ?? billedQtyMilli, `Item "${itemRow.name}" received quantity`, { min: 0 });
      totalReceivedUnits += receivedQtyMilli;

      const costMinor = V.int(l.costMinor, `Item "${itemRow.name}" purchase rate`, { min: 0, required: true });
      const discountMinor = V.int(l.discountMinor ?? 0, `Item "${itemRow.name}" discount`, { min: 0 });
      const taxRateBp = V.int(l.taxRateBp ?? 0, `Item "${itemRow.name}" tax rate`, { min: 0, max: 10000 });
      const inclusive = V.bool(l.inclusive, false);
      const batchNo = V.optStr(l.batchNo, 'Batch number', 40);
      const expiry = V.optStr(l.expiry, 'Expiry date', 20);

      // Batch tracked items validation
      const isBatchTracked = Boolean(itemRow.trackBatch ?? itemRow.track_batch);
      if (isBatchTracked && (!batchNo || !expiry)) {
        throw bad(`Batch and expiry are required for batch-tracked item "${itemRow.name}"`, 'BATCH_REQUIRED');
      }

      formattedLines.push({
        itemId,
        name: itemRow.name,
        hsn: itemRow.hsn ?? V.optStr(l.hsn, 'HSN', 20),
        unit: itemRow.unit ?? 'pcs',
        billedQtyMilli,
        receivedQtyMilli,
        costMinor,
        discountMinor,
        taxRateBp,
        inclusive,
        batchNo,
        expiry,
      });
    }

    if (totalReceivedUnits === 0 && linesInput.length > 0) {
      throw bad('Add at least one item with a quantity received above zero', 'ZERO_RECEIVED_QUANTITY');
    }

    // 4. Exact Tax & ITC Calculations using shared purchase engine
    const shop = await ctx.db.one<{ state_code?: string; stateCode?: string }>('SELECT state_code FROM tenants WHERE id = ?', [tenantId]);
    const shopState = shop?.stateCode ?? shop?.state_code ?? '33';
    const supplierState = supplier.stateCode ?? supplier.state_code ?? (supplier.gstin ? supplier.gstin.slice(0, 2) : shopState);

    const calc = calcPurchase({
      lines: formattedLines,
      supplierGstin: supplier.gstin,
      supplierState,
      shopState,
      otherChargesLabel,
      otherChargesMinor,
      otherChargesGstBp,
    });

    if (paidMinor > calc.totalMinor) {
      throw bad(`Paid amount cannot exceed the purchase total of ${fmtMoney(calc.totalMinor)}`, 'INVALID_PAID_AMOUNT');
    }

    const purchaseId = newId('pur');
    const balanceMinor = Math.max(0, calc.totalMinor - paidMinor);

    let savedPurchaseNumber = '';
    let savedPaymentNumber = '';

    await ctx.db.tx(async (q) => {
      // 5. Generate collision-free purchase number from number_series (PUR- prefix)
      const seriesRow = await q.one<{ assignedNo?: number; assigned_no?: number }>(
        `INSERT INTO number_series (tenant_id, series, next_no)
         VALUES (?, 'PUR', 2)
         ON CONFLICT (tenant_id, series) DO UPDATE SET next_no = number_series.next_no + 1
         RETURNING (next_no - 1) AS assigned_no`,
        [tenantId],
      );
      const seqNo = Number(seriesRow?.assignedNo ?? seriesRow?.assigned_no ?? 1);
      savedPurchaseNumber = `PUR-${1000 + seqNo}`;

      // Insert purchase master
      await q.exec(
        `INSERT INTO purchases (
          id, tenant_id, supplier_id, purchase_number, bill_no, supplier_invoice_number,
          supplier_invoice_date, purchase_date, bdate, status,
          subtotal_minor, discount_minor, taxable_minor, tax_minor,
          cgst_minor, sgst_minor, igst_minor, itc_minor,
          other_charges_label, other_charges_minor, other_charges_gst_minor, other_charges_gst_bp,
          round_off_minor, total_minor, paid_minor, balance_minor,
          payment_method, note, created_by, idempotency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())`,
        [
          purchaseId,
          tenantId,
          supplierId,
          savedPurchaseNumber,
          supplierInvoiceNumber,
          supplierInvoiceNumber,
          supplierInvoiceDate,
          purchaseDate,
          purchaseDate,
          calc.subtotalMinor,
          calc.discountMinor,
          calc.taxableMinor,
          calc.taxMinor,
          calc.cgstMinor,
          calc.sgstMinor,
          calc.igstMinor,
          calc.itcMinor,
          calc.otherChargesLabel,
          calc.otherChargesMinor,
          calc.otherChargesGstMinor,
          calc.otherChargesGstBp,
          calc.roundOffMinor,
          calc.totalMinor,
          paidMinor,
          balanceMinor,
          paidMinor > 0 ? paymentMethod : null,
          note,
          ctx.user!.id,
          idempotencyKey || null,
        ],
      );

      // Insert purchase lines & stock inward moves
      for (let i = 0; i < formattedLines.length; i++) {
        const item = formattedLines[i];
        const cl = calc.lines[i];
        const lineId = newId('prl');

        await q.exec(
          `INSERT INTO purchase_lines (
            id, tenant_id, purchase_id, item_id, name, hsn, unit,
            qty_milli, billed_qty_milli, received_qty_milli,
            cost_minor, discount_minor, tax_rate_bp,
            taxable_minor, tax_minor, cgst_minor, sgst_minor, igst_minor, total_minor,
            batch_no, expiry
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            lineId,
            tenantId,
            purchaseId,
            item.itemId,
            item.name,
            item.hsn,
            item.unit,
            item.receivedQtyMilli,
            item.billedQtyMilli,
            item.receivedQtyMilli,
            item.costMinor,
            item.discountMinor,
            item.taxRateBp,
            cl.taxableMinor,
            cl.taxMinor,
            cl.cgstMinor,
            cl.sgstMinor,
            cl.igstMinor,
            cl.totalMinor,
            item.batchNo,
            item.expiry,
          ],
        );

        // Stock inward: only for receivedQtyMilli > 0
        if (item.receivedQtyMilli > 0) {
          await q.exec(
            `INSERT INTO stock_moves (
              id, tenant_id, item_id, location, qty_milli, kind,
              ref_type, ref_id, ref_line_id, batch_no, expiry, unit_cost_minor, user_id
            ) VALUES (?, ?, ?, 'MAIN', ?, 'purchase', 'purchase', ?, ?, ?, ?, ?, ?)`,
            [
              newId('sm'),
              tenantId,
              item.itemId,
              item.receivedQtyMilli,
              purchaseId,
              lineId,
              item.batchNo,
              item.expiry,
              item.costMinor,
              ctx.user!.id,
            ],
          );

          // Update Last purchase price on product master (Section 6.5)
          await q.exec(
            'UPDATE items SET cost_minor = ?, updated_at = now() WHERE id = ? AND tenant_id = ?',
            [item.costMinor, item.itemId, tenantId],
          );
        }
      }

      // 6. Record Payment at purchase time if paidMinor > 0
      if (paidMinor > 0) {
        const paySeriesRow = await q.one<{ assignedNo?: number; assigned_no?: number }>(
          `INSERT INTO number_series (tenant_id, series, next_no)
           VALUES (?, 'PAY', 2)
           ON CONFLICT (tenant_id, series) DO UPDATE SET next_no = number_series.next_no + 1
           RETURNING (next_no - 1) AS assigned_no`,
          [tenantId],
        );
        const paySeqNo = Number(paySeriesRow?.assignedNo ?? paySeriesRow?.assigned_no ?? 1);
        savedPaymentNumber = `PAY-${1000 + paySeqNo}`;

        const paymentId = newId('pay');
        await q.exec(
          `INSERT INTO payments (
            id, tenant_id, kind, method, amount_minor, purchase_id, party_id,
            reference, bdate, payment_date, payment_number, status, created_by
          ) VALUES (?, ?, 'supplier_payment', ?, ?, ?, ?, ?, ?, now(), ?, 'posted', ?)`,
          [
            paymentId,
            tenantId,
            paymentMethod,
            paidMinor,
            purchaseId,
            supplierId,
            paymentReference || (supplierInvoiceNumber ? `Inv #${supplierInvoiceNumber}` : null),
            purchaseDate,
            savedPaymentNumber,
            ctx.user!.id,
          ],
        );

        await q.exec(
          `INSERT INTO supplier_payment_allocations (
            id, tenant_id, payment_id, purchase_id, supplier_id, amount_minor, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'posted', now())`,
          [
            newId('spa'),
            tenantId,
            paymentId,
            purchaseId,
            supplierId,
            paidMinor,
          ],
        );
      }

      await audit(q, ctx, {
        action: 'purchase.create',
        entity: 'purchase',
        entityId: purchaseId,
        detail: {
          purchaseNumber: savedPurchaseNumber,
          supplierInvoiceNumber,
          totalMinor: calc.totalMinor,
          itcMinor: calc.itcMinor,
          supplierId,
          linesCount: formattedLines.length,
          paidMinor,
        },
      });
    });

    const created = await ctx.db.one(
      `SELECT p.*,
              part.name AS supplier_name,
              part.phone AS supplier_phone,
              part.gstin AS supplier_gstin,
              part.address AS supplier_address
       FROM purchases p
       LEFT JOIN parties part ON p.supplier_id = part.id AND part.tenant_id = p.tenant_id
       WHERE p.id = ? AND p.tenant_id = ?`,
      [purchaseId, tenantId],
    );

    const lines = await ctx.db.query(
      'SELECT * FROM purchase_lines WHERE purchase_id = ? AND tenant_id = ? ORDER BY id ASC',
      [purchaseId, tenantId],
    );

      return { ok: true, purchase: formatPurchase(created, lines) };
    } catch (err: any) {
      console.error('CREATE_PURCHASE_FAIL:', err?.message, err?.stack);
      throw bad(err?.message || 'Create purchase failed', 'PURCHASE_ERROR', { stack: err?.stack });
    }
  });

  // Pay Supplier Flow (FIFO oldest purchase first)
  // Permitted roles: Owner, Manager, Accountant
  r.post('/api/purchases/pay-supplier', requirePerm('purchases.pay'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;

    const supplierId = V.str(b.supplierId, 'Supplier', { required: true });
    const amountMinor = V.int(b.amountMinor, 'Payment amount', { min: 1, required: true });
    const paymentMode = V.oneOf(b.paymentMode || b.method, 'Payment mode', ['cash', 'upi', 'card', 'bank', 'cheque'] as const, 'cash');
    const paymentDate = V.optStr(b.paymentDate || b.bdate, 'Payment date', 20) || new Date().toISOString().slice(0, 10);
    const reference = V.optStr(b.reference || b.referenceNo, 'Reference', 100);
    const note = V.optStr(b.note, 'Note', 500);

    const todayStr = new Date().toISOString().slice(0, 10);
    if (paymentDate > todayStr) {
      throw bad('Payment date cannot be in the future', 'INVALID_DATE');
    }

    // 1. Fetch open purchases for this supplier
    const openPurchases = await ctx.db.query(
      `SELECT id, purchase_number, bill_no, supplier_invoice_number, supplier_invoice_date, bdate,
              total_minor, paid_minor, balance_minor
       FROM purchases
       WHERE tenant_id = ? AND supplier_id = ? AND status != 'voided' AND balance_minor > 0
       ORDER BY COALESCE(supplier_invoice_date, bdate) ASC, purchase_number ASC`,
      [tenantId, supplierId],
    );

    const totalPayableMinor = openPurchases.reduce((sum, p) => sum + Math.max(0, Number(p.balanceMinor ?? p.balance_minor ?? 0)), 0);
    if (amountMinor > totalPayableMinor) {
      throw bad(
        `Amount cannot exceed the payable of ${fmtMoney(totalPayableMinor)}. Advances to suppliers are not recorded here yet.`,
        'OVERPAYMENT_BLOCKED',
      );
    }

    const plan = planSupplierPayment(
      openPurchases.map((p) => ({
        id: p.id,
        purchaseNumber: p.purchaseNumber ?? p.purchase_number,
        billNo: p.supplierInvoiceNumber ?? p.supplier_invoice_number ?? p.billNo,
        supplierInvoiceNumber: p.supplierInvoiceNumber ?? p.supplier_invoice_number ?? p.billNo,
        supplierInvoiceDate: p.supplierInvoiceDate ?? p.supplier_invoice_date ?? p.bdate,
        bdate: p.bdate,
        totalMinor: Number(p.totalMinor ?? p.total_minor),
        paidMinor: Number(p.paidMinor ?? p.paid_minor),
        balanceMinor: Number(p.balanceMinor ?? p.balance_minor),
      })),
      amountMinor,
    );

    let savedPaymentNumber = '';
    const paymentId = newId('pay');

    await ctx.db.tx(async (q) => {
      // 2. Sequential payment number from series PAY
      const paySeriesRow = await q.one<{ assignedNo?: number; assigned_no?: number }>(
        `INSERT INTO number_series (tenant_id, series, next_no)
         VALUES (?, 'PAY', 2)
         ON CONFLICT (tenant_id, series) DO UPDATE SET next_no = number_series.next_no + 1
         RETURNING (next_no - 1) AS assigned_no`,
        [tenantId],
      );
      const paySeqNo = Number(paySeriesRow?.assignedNo ?? paySeriesRow?.assigned_no ?? 1);
      savedPaymentNumber = `PAY-${1000 + paySeqNo}`;

      await q.exec(
        `INSERT INTO payments (
          id, tenant_id, kind, method, amount_minor, party_id, reference, note,
          bdate, payment_date, payment_number, status, created_by
        ) VALUES (?, ?, 'supplier_payment', ?, ?, ?, ?, ?, ?, now(), ?, 'posted', ?)`,
        [
          paymentId,
          tenantId,
          paymentMode,
          amountMinor,
          supplierId,
          reference,
          note,
          paymentDate,
          savedPaymentNumber,
          ctx.user!.id,
        ],
      );

      // Record allocations & update purchase balances
      for (const alloc of plan.allocations) {
        await q.exec(
          `INSERT INTO supplier_payment_allocations (
            id, tenant_id, payment_id, purchase_id, supplier_id, amount_minor, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'posted', now())`,
          [
            newId('spa'),
            tenantId,
            paymentId,
            alloc.purchaseId,
            supplierId,
            alloc.allocatedMinor,
          ],
        );

        await q.exec(
          `UPDATE purchases
           SET paid_minor = paid_minor + ?,
               balance_minor = balance_minor - ?
           WHERE id = ? AND tenant_id = ?`,
          [alloc.allocatedMinor, alloc.allocatedMinor, alloc.purchaseId, tenantId],
        );
      }

      await audit(q, ctx, {
        action: 'purchase.pay_supplier',
        entity: 'payment',
        entityId: paymentId,
        detail: {
          paymentNumber: savedPaymentNumber,
          supplierId,
          amountMinor,
          allocationsCount: plan.allocations.length,
          payableAfterMinor: plan.payableAfterMinor,
        },
      });
    });

    return {
      ok: true,
      paymentId,
      paymentNumber: savedPaymentNumber,
      allocations: plan.allocations,
      totalAllocatedMinor: plan.totalAllocatedMinor,
      payableBeforeMinor: plan.payableBeforeMinor,
      payableAfterMinor: plan.payableAfterMinor,
      isFullySettled: plan.isFullySettled,
    };
  });

  // Void Purchase (Owner & Manager only!)
  r.post('/api/purchases/:id/void', requirePerm('purchases.void'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const voidReason = V.str(ctx.body?.voidReason || ctx.body?.reason, 'Void reason', { required: true, min: 3 });

    const purchase = await ctx.db.one(
      'SELECT * FROM purchases WHERE id = ? AND tenant_id = ?',
      [ctx.params.id, tenantId],
    );
    if (!purchase) throw notFound('Purchase');
    if (purchase.status === 'voided') {
      throw bad('This purchase has already been voided.', 'ALREADY_VOIDED');
    }

    // 1. Payment Guard: Cannot void a purchase that has standing supplier payments
    const standingAllocations = await ctx.db.query(
      `SELECT spa.*, p.payment_number, p.amount_minor AS pay_amount
       FROM supplier_payment_allocations spa
       JOIN payments p ON spa.payment_id = p.id
       WHERE spa.purchase_id = ? AND spa.tenant_id = ? AND spa.status != 'voided'`,
      [purchase.id, tenantId],
    );

    const directPayments = await ctx.db.query(
      `SELECT id, payment_number, amount_minor
       FROM payments
       WHERE purchase_id = ? AND tenant_id = ? AND status != 'voided'`,
      [purchase.id, tenantId],
    );

    const allPayments = [...standingAllocations, ...directPayments];
    if (allPayments.length > 0) {
      const totalPaidMinor = allPayments.reduce((s, p) => s + Number(p.amountMinor ?? p.amount_minor ?? p.allocated_minor ?? 0), 0);
      const payRefs = Array.from(new Set(allPayments.map((p) => p.paymentNumber ?? p.payment_number ?? p.id)));
      throw bad(
        `Paid ₹${(totalPaidMinor / 100).toFixed(2)} against this purchase via ${payRefs.join(', ')}. Void that payment first.`,
        'PAYMENTS_EXIST',
      );
    }

    // 2. Stock Guard: Cannot void if received stock has already been sold
    const lines = await ctx.db.query(
      'SELECT * FROM purchase_lines WHERE purchase_id = ? AND tenant_id = ?',
      [purchase.id, tenantId],
    );

    for (const l of lines) {
      const receivedMilli = Number(l.receivedQtyMilli ?? l.received_qty_milli ?? l.qtyMilli ?? l.qty_milli ?? 0);
      if (receivedMilli > 0) {
        const stockRow = await ctx.db.one<{ stock?: number; current_stock_milli?: number }>(
          `SELECT COALESCE(SUM(qty_milli), 0) AS stock
           FROM stock_moves
           WHERE item_id = ? AND tenant_id = ?`,
          [l.itemId ?? l.item_id, tenantId],
        );
        const currentStockMilli = Number(stockRow?.stock ?? stockRow?.current_stock_milli ?? 0);
        if (currentStockMilli < receivedMilli) {
          throw bad(
            `${l.name}: only ${(currentStockMilli / 1000).toFixed(1)} of ${(receivedMilli / 1000).toFixed(1)} units remain in stock — this purchase cannot be voided until the stock position is corrected.`,
            'INSUFFICIENT_STOCK',
          );
        }
      }
    }

    // 3. Atomically reverse stock moves, update status, and audit
    await ctx.db.tx(async (q) => {
      await q.exec(
        `UPDATE purchases
         SET status = 'voided',
             void_reason = ?,
             voided_by = ?,
             voided_at = now()
         WHERE id = ? AND tenant_id = ?`,
        [voidReason, ctx.user!.id, purchase.id, tenantId],
      );

      // Reverse stock moves
      for (const l of lines) {
        const receivedMilli = Number(l.receivedQtyMilli ?? l.received_qty_milli ?? l.qtyMilli ?? l.qty_milli ?? 0);
        if (receivedMilli > 0) {
          await q.exec(
            `INSERT INTO stock_moves (
              id, tenant_id, item_id, location, qty_milli, kind,
              ref_type, ref_id, ref_line_id, batch_no, expiry, unit_cost_minor, user_id, reason
            ) VALUES (?, ?, ?, 'MAIN', ?, 'adjust', 'purchase', ?, ?, ?, ?, ?, ?, 'purchase_void')`,
            [
              newId('sm'),
              tenantId,
              l.itemId ?? l.item_id,
              -receivedMilli,
              purchase.id,
              l.id,
              l.batchNo ?? l.batch_no,
              l.expiry,
              l.costMinor ?? l.cost_minor,
              ctx.user!.id,
            ],
          );
        }
      }

      await audit(q, ctx, {
        action: 'purchase.void',
        entity: 'purchase',
        entityId: purchase.id,
        detail: {
          purchaseNumber: purchase.purchaseNumber ?? purchase.purchase_number,
          voidReason,
        },
      });
    });

    return { ok: true, message: 'Purchase voided successfully' };
  });

  // Void Supplier Payment (Owner & Manager only!)
  r.post('/api/purchases/payments/:id/void', requirePerm('purchases.void'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const voidReason = V.str(ctx.body?.voidReason || ctx.body?.reason, 'Void reason', { required: true, min: 3 });

    const payment = await ctx.db.one(
      'SELECT * FROM payments WHERE id = ? AND tenant_id = ?',
      [ctx.params.id, tenantId],
    );
    if (!payment) throw notFound('Payment');
    if (payment.status === 'voided') {
      throw bad('This supplier payment has already been voided.', 'ALREADY_VOIDED');
    }

    const allocations = await ctx.db.query(
      'SELECT * FROM supplier_payment_allocations WHERE payment_id = ? AND tenant_id = ?',
      [payment.id, tenantId],
    );

    await ctx.db.tx(async (q) => {
      await q.exec(
        `UPDATE payments
         SET status = 'voided',
             reversal_reason = ?,
             reversed_by = ?,
             reversed_at = now()
         WHERE id = ? AND tenant_id = ?`,
        [voidReason, ctx.user!.id, payment.id, tenantId],
      );

      // Reopen purchases that were settled by this payment
      for (const alloc of allocations) {
        await q.exec(
          `UPDATE supplier_payment_allocations
           SET status = 'voided'
           WHERE id = ? AND tenant_id = ?`,
          [alloc.id, tenantId],
        );

        await q.exec(
          `UPDATE purchases
           SET paid_minor = GREATEST(0, paid_minor - ?),
               balance_minor = balance_minor + ?
           WHERE id = ? AND tenant_id = ?`,
          [alloc.amountMinor ?? alloc.amount_minor, alloc.amountMinor ?? alloc.amount_minor, alloc.purchaseId ?? alloc.purchase_id, tenantId],
        );
      }

      // If directly attached to purchase
      if (payment.purchaseId ?? payment.purchase_id) {
        const purId = payment.purchaseId ?? payment.purchase_id;
        const amt = Number(payment.amountMinor ?? payment.amount_minor);
        await q.exec(
          `UPDATE purchases
           SET paid_minor = GREATEST(0, paid_minor - ?),
               balance_minor = balance_minor + ?
           WHERE id = ? AND tenant_id = ?`,
          [amt, amt, purId, tenantId],
        );
      }

      await audit(q, ctx, {
        action: 'purchase.payment_void',
        entity: 'payment',
        entityId: payment.id,
        detail: {
          paymentNumber: payment.paymentNumber ?? payment.payment_number,
          voidReason,
        },
      });
    });

    return { ok: true, message: 'Supplier payment voided successfully' };
  });

  // Print Document (Thermal or A4 format)
  r.get('/api/purchases/:id/print', requirePerm('purchases'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const format = (ctx.query.format || 'a4') as 'a4' | 'thermal58' | 'thermal80';

    const purchase = await ctx.db.one(
      `SELECT p.*,
              part.name AS supplier_name,
              part.phone AS supplier_phone,
              part.gstin AS supplier_gstin,
              part.address AS supplier_address,
              u.name AS recorded_by_name
       FROM purchases p
       LEFT JOIN parties part ON p.supplier_id = part.id AND part.tenant_id = p.tenant_id
       LEFT JOIN users u ON p.created_by = u.id
       WHERE p.id = ? AND p.tenant_id = ?`,
      [ctx.params.id, tenantId],
    );
    if (!purchase) throw notFound('Purchase');

    const lines = await ctx.db.query(
      'SELECT * FROM purchase_lines WHERE purchase_id = ? AND tenant_id = ? ORDER BY id ASC',
      [purchase.id, tenantId],
    );

    const shop = await ctx.db.one<{ name: string; address?: string; phone?: string; gstin?: string; state_code?: string }>(
      'SELECT name, address, phone, gstin, state_code FROM tenants WHERE id = ?',
      [tenantId],
    );

    const isIntraState = !purchase.igst_minor || Number(purchase.igst_minor) === 0;

    const printable: PrintablePurchase = {
      purchaseNumber: purchase.purchase_number || purchase.purchaseNumber || ('PUR-' + purchase.id.slice(-4)),
      status: purchase.status || 'posted',
      purchaseDate: purchase.purchase_date || purchase.purchaseDate || purchase.bdate || '',
      supplierInvoiceNumber: purchase.supplier_invoice_number || purchase.supplierInvoiceNumber || purchase.bill_no || '',
      supplierInvoiceDate: purchase.supplier_invoice_date || purchase.supplierInvoiceDate || purchase.bdate || '',
      shop: {
        name: shop?.name || 'My Store',
        address: shop?.address,
        phone: shop?.phone,
        gstin: shop?.gstin,
      },
      supplier: {
        name: purchase.supplier_name || 'Supplier',
        phone: purchase.supplier_phone,
        gstin: purchase.supplier_gstin,
        address: purchase.supplier_address,
      },
      lines: lines.map((l: any) => ({
        name: l.name,
        hsn: l.hsn,
        unit: l.unit,
        billedQtyMilli: Number(l.billed_qty_milli ?? l.qty_milli ?? 0),
        receivedQtyMilli: Number(l.received_qty_milli ?? l.qty_milli ?? 0),
        costMinor: Number(l.cost_minor ?? 0),
        discountMinor: Number(l.discount_minor ?? 0),
        taxRateBp: Number(l.tax_rate_bp ?? 0),
        taxableMinor: Number(l.taxable_minor ?? 0),
        cgstMinor: Number(l.cgst_minor ?? 0),
        sgstMinor: Number(l.sgst_minor ?? 0),
        igstMinor: Number(l.igst_minor ?? 0),
        totalMinor: Number(l.total_minor ?? 0),
        batchNo: l.batch_no,
        expiry: l.expiry,
      })),
      taxableTotalMinor: Number(purchase.taxable_minor ?? 0),
      cgstMinor: Number(purchase.cgst_minor ?? 0),
      sgstMinor: Number(purchase.sgst_minor ?? 0),
      igstMinor: Number(purchase.igst_minor ?? 0),
      itcMinor: Number(purchase.itc_minor ?? (Number(purchase.cgst_minor ?? 0) + Number(purchase.sgst_minor ?? 0) + Number(purchase.igst_minor ?? 0))),
      otherChargesLabel: purchase.other_charges_label,
      otherChargesMinor: Number(purchase.other_charges_minor ?? 0),
      otherChargesGstMinor: Number(purchase.other_charges_gst_minor ?? 0),
      roundOffMinor: Number(purchase.round_off_minor ?? 0),
      totalMinor: Number(purchase.total_minor ?? 0),
      paidMinor: Number(purchase.paid_minor ?? 0),
      balanceMinor: Number(purchase.balance_minor ?? 0),
      paymentMethod: purchase.payment_method,
      recordedBy: purchase.recorded_by_name,
      voidReason: purchase.void_reason,
      voidedBy: purchase.voided_by,
      voidedAt: purchase.voided_at,
      isIntraState,
    };

    const paper = format === 'thermal58' ? 'thermal58' : (format === 'thermal80' ? 'thermal80' : 'a4');
    const html = renderPurchaseDoc(printable, {
      paper,
      showHsn: true,
      showDiscount: true,
      showTaxBreakup: true,
      showUnit: true,
      qr: 'none',
      header: '',
      footer: '',
      terms: '',
      copies: 1,
      language: 'en',
    });

    ctx.res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return html;
  });
}
