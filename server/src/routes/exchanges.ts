import { requirePerm, requireUser } from '../auth.ts';
import { bad, notFound, HtmlResponse, V, type Router } from '../http.ts';
import { newId } from '../security.ts';
import { j } from '../db/index.ts';
import { audit } from '../audit.ts';
import { calcReturn, type ReturnLineInput } from '../../../shared/returns.ts';
import { calcBill } from '../../../shared/tax.ts';
import { fmtMoney } from '../../../shared/money.ts';

export function registerExchanges(r: Router) {
  // 1. Process an Exchange Transaction atomically
  r.post('/api/exchanges', requirePerm('sell'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};

    const returnLinesInput = V.arr(b.returnLines, 'Return lines', { min: 1 });
    for (const rl of returnLinesInput) {
      if (!rl.origInvoiceId && b.origInvoiceId) {
        rl.origInvoiceId = b.origInvoiceId;
      }
    }

    const rawNewLines = b.newInvoice?.lines || b.newLines;
    if (!rawNewLines || !Array.isArray(rawNewLines) || rawNewLines.length === 0) {
      throw bad('New items to purchase are required to complete an exchange.');
    }

    const newLinesInput = rawNewLines;
    const newInvoiceInput = b.newInvoice || {};
    const customerInput = newInvoiceInput.customer || {
      name: b.customerName,
      phone: b.customerPhone,
    };
    const paymentMethod = (b.paymentMethod || newInvoiceInput.paymentMethod || 'cash').toLowerCase();
    const paymentReference = V.optStr(b.paymentReference ?? newInvoiceInput.paymentReference, 'Payment reference', 100);
    const refundMethod = (b.excessRefundMethod || b.refundMethod || newInvoiceInput.refundMethod || 'cash').toLowerCase();
    const refundReference = V.optStr(b.refundReference ?? newInvoiceInput.refundReference, 'Refund reference', 100);
    const note = V.optStr(b.note ?? newInvoiceInput.note, 'Note', 250);

    const todayStr = new Date().toISOString().slice(0, 10);
    const branchId = b.branchId || newInvoiceInput.branchId || ctx.user!.assignedLocation || 'MAIN';

    // Verify day closing status
    const closedDay = await ctx.db.one<any>(
      "SELECT id FROM day_closings WHERE tenant_id = ? AND branch_id = ? AND bdate = ? AND status = 'closed'",
      [tenantId, branchId, todayStr],
    );
    if (closedDay) {
      throw bad(`Day ${todayStr} has already undergone Day Closing for this branch. Cannot process exchanges on closed days.`, 'DAY_CLOSED');
    }

    let exchangeId = '';
    let savedCnId = '';
    let savedCnNumber = '';
    let savedSaleId = '';
    let savedSaleNumber = '';
    let returnTotalMinor = 0;
    let newTotalMinor = 0;
    let exchangeAdjustedMinor = 0;
    let customerPayableMinor = 0;
    let customerRefundMinor = 0;

    await ctx.db.tx(async (q) => {
      // 1. Lock and validate return items
      const origInvIds = Array.from(new Set(returnLinesInput.map((rl: any) => rl.origInvoiceId)));
      const invPlaceholders = origInvIds.map(() => '?').join(', ');
      const origInvs = await q.query<any>(
        `SELECT * FROM invoices WHERE tenant_id = ? AND id IN (${invPlaceholders}) FOR UPDATE`,
        [tenantId, ...origInvIds],
      );
      const origInvMap = new Map<string, any>(origInvs.map((i) => [i.id, i]));

      for (const invId of origInvIds) {
        const inv = origInvMap.get(invId);
        if (!inv) throw bad(`Original invoice ${invId} not found.`);
        if (inv.kind === 'credit_note') throw bad('Cannot return against a credit note.');
        if (inv.status === 'cancelled' || inv.status === 'voided') throw bad('Cannot return against a cancelled or voided bill.');
      }

      // Lock original lines
      const origLines = await q.query<any>(
        `SELECT * FROM invoice_lines WHERE tenant_id = ? AND invoice_id IN (${invPlaceholders}) FOR UPDATE`,
        [tenantId, ...origInvIds],
      );
      const origLineMap = new Map<string, any>(origLines.map((l) => [l.id, l]));

      // Query already returned quantities
      const returnedRows = await q.query<any>(
        `SELECT il.orig_line_id, il.item_id, il.name, SUM(il.qty_milli)::bigint AS returned_qty_milli
         FROM invoice_lines il
         JOIN invoices cn ON cn.id = il.invoice_id
         WHERE cn.tenant_id = ? AND cn.linked_invoice_id IN (${invPlaceholders}) AND cn.status = 'posted'
         GROUP BY il.orig_line_id, il.item_id, il.name`,
        [tenantId, ...origInvIds],
      );
      const returnedMap = new Map<string, number>();
      for (const rr of returnedRows) {
        const retQty = Number(rr.returnedQtyMilli ?? rr.returned_qty_milli ?? 0);
        const oId = rr.origLineId ?? rr.orig_line_id;
        const itId = rr.itemId ?? rr.item_id;
        if (oId) returnedMap.set(oId, retQty);
        else if (itId) returnedMap.set(`item:${itId}`, retQty);
        else if (rr.name) returnedMap.set(`name:${rr.name}`, retQty);
      }

      // Prepare return lines
      const preparedReturnLines: ReturnLineInput[] = [];
      for (const rl of returnLinesInput) {
        const origL = origLineMap.get(rl.origLineId);
        if (!origL) throw bad(`Line item ${rl.origLineId} not found.`);

        const billedQtyMilli = Number(origL.qtyMilli ?? origL.qty_milli ?? 0);
        const origItemId = origL.itemId ?? origL.item_id;
        const alreadyReturned =
          returnedMap.get(origL.id) ||
          (origItemId ? returnedMap.get(`item:${origItemId}`) : 0) ||
          (origL.name ? returnedMap.get(`name:${origL.name}`) : 0) ||
          0;
        const returnableQtyMilli = Math.max(0, billedQtyMilli - alreadyReturned);

        const retQty = V.int(rl.returnQtyMilli, `Return quantity for ${origL.name}`, { min: 1 });
        if (retQty > returnableQtyMilli) {
          throw bad(
            `Return quantity exceeds available returnable quantity for "${origL.name}". Only ${returnableQtyMilli / 1000} ${origL.unit || 'units'} left.`,
            'CONCURRENCY_ERROR',
          );
        }

        const rawCond = String(rl.condition || 'resellable').toLowerCase().trim();
        const condition: 'resellable' | 'damaged' | 'defective' =
          rawCond === 'defective' ? 'defective' : rawCond === 'damaged' ? 'damaged' : 'resellable';

        preparedReturnLines.push({
          origLineId: origL.id,
          itemId: origItemId || null,
          name: origL.name,
          hsn: origL.hsn,
          unit: origL.unit,
          batchNo: origL.batchNo ?? origL.batch_no,
          billedQtyMilli,
          alreadyReturnedQtyMilli: alreadyReturned,
          returnQtyMilli: retQty,
          priceMinor: Number(origL.priceMinor ?? origL.price_minor ?? 0),
          taxRateBp: Number(origL.taxRateBp ?? origL.tax_rate_bp ?? 0),
          inclusive: Boolean(origL.inclusive),
          origTaxableMinor: Number(origL.taxableMinor ?? origL.taxable_minor ?? 0),
          origCgstMinor: Number(origL.cgstMinor ?? origL.cgst_minor ?? 0),
          origSgstMinor: Number(origL.sgstMinor ?? origL.sgst_minor ?? 0),
          origIgstMinor: Number(origL.igstMinor ?? origL.igst_minor ?? 0),
          origTotalMinor: Number(origL.totalMinor ?? origL.total_minor ?? 0),
          restock: condition === 'resellable',
          condition,
          reason: rl.reason || 'Customer changed mind',
          remarks: rl.remarks,
        });
      }

      // Calculate return credit note
      const primaryOrigInv = origInvMap.get(returnLinesInput[0].origInvoiceId);
      const isIntraState = Boolean(primaryOrigInv?.intra ?? true);
      const calcReturnResult = calcReturn(preparedReturnLines, { isIntraState });
      returnTotalMinor = calcReturnResult.totalCreditMinor;

      // 2. Prepare & calculate new purchase bill
      const formattedNewLines = newLinesInput.map((l: any, i: number) => {
        const name = V.str(l.name, `New Item ${i + 1} name`, { required: true, max: 120 });
        const qtyMilli = V.int(l.qtyMilli, `New Item ${i + 1} quantity`, { min: 1, required: true });
        const priceMinor = V.int(l.priceMinor, `New Item ${i + 1} price`, { min: 0, required: true });
        const discountMinor = V.int(l.discountMinor ?? 0, `New Item ${i + 1} discount`, { min: 0 });
        const taxRateBp = V.int(l.taxRateBp ?? 0, `New Item ${i + 1} tax rate`, { min: 0, max: 10000 });
        const inclusive = V.bool(l.inclusive, true);
        const itemId = V.optStr(l.itemId, 'Item ID', 50);
        const unit = V.optStr(l.unit, 'Unit', 20);
        const hsn = V.optStr(l.hsn, 'HSN', 20);
        return { name, qtyMilli, priceMinor, discountMinor, taxRateBp, inclusive, itemId, unit, hsn };
      });

      const calcSaleResult = calcBill(
        formattedNewLines.map((l: any) => ({
          name: l.name,
          qtyMilli: l.qtyMilli,
          priceMinor: l.priceMinor,
          discountMinor: l.discountMinor,
          taxRateBp: l.taxRateBp,
          inclusive: l.inclusive,
        })),
        { intraState: isIntraState, roundTotal: 'rupee' },
      );
      newTotalMinor = calcSaleResult.totalMinor;

      // 3. Exchange Math
      exchangeAdjustedMinor = Math.min(returnTotalMinor, newTotalMinor);
      customerPayableMinor = Math.max(0, newTotalMinor - returnTotalMinor);
      customerRefundMinor = Math.max(0, returnTotalMinor - newTotalMinor);

      // Unique Exchange Reference ID
      exchangeId = 'EXC-' + Date.now().toString(36).toUpperCase() + '-' + Math.floor(Math.random() * 900 + 100);

      // 4. Generate Numbers from series
      // Next Credit Note number
      const cnSeriesRow = await q.one<any>(
        `INSERT INTO number_series (tenant_id, branch_id, series, next_no)
         VALUES (?, ?, 'CN', 2)
         ON CONFLICT (tenant_id, branch_id, series) DO UPDATE SET next_no = number_series.next_no + 1
         RETURNING (next_no - 1) AS assigned_no`,
        [tenantId, branchId],
      );
      const cnSeqNo = Number(cnSeriesRow?.assignedNo ?? cnSeriesRow?.assigned_no ?? 1);
      savedCnNumber = `CN-${1000 + cnSeqNo}`;

      // Next Invoice number
      const invPrefix = primaryOrigInv?.invoice_prefix || primaryOrigInv?.invoicePrefix || 'INV';
      const invSeriesRow = await q.one<any>(
        `INSERT INTO number_series (tenant_id, branch_id, series, next_no)
         VALUES (?, ?, ?, 2)
         ON CONFLICT (tenant_id, branch_id, series) DO UPDATE SET next_no = number_series.next_no + 1
         RETURNING (next_no - 1) AS assigned_no`,
        [tenantId, branchId, invPrefix],
      );
      const invSeqNo = Number(invSeriesRow?.assignedNo ?? invSeriesRow?.assigned_no ?? 1);
      savedSaleNumber = `${invPrefix}-${1000 + invSeqNo}`;

      savedCnId = newId('inv');
      savedSaleId = newId('inv');
      const shareTokenCn = newId('tok');
      const shareTokenSale = newId('tok');

      // 5. Insert Credit Note
      await q.exec(
        `INSERT INTO invoices (
          id, tenant_id, branch_id, client_id, number, kind, status, bdate,
          party_id, customer_name, customer_phone, customer_gstin,
          subtotal_minor, discount_minor, taxable_minor,
          cgst_minor, sgst_minor, igst_minor, round_off_minor, total_minor,
          paid_minor, balance_minor, applied_minor,
          rule_version, calc, custom, note,
          linked_invoice_id, share_token, created_by,
          location, counter, counter_id, counter_name_snapshot,
          exchange_id, is_exchange, exchange_adjusted_minor,
          refund_amount_minor, refund_mode, refund_reference, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, 'credit_note', 'posted', ?,
          ?, ?, ?, ?,
          ?, 0, ?,
          ?, ?, ?, ?, ?,
          0, 0, ?,
          '1.0', ?, '{}', ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, TRUE, ?,
          ?, ?, ?, NOW()
        )`,
        [
          savedCnId,
          tenantId,
          branchId,
          newId('client'),
          savedCnNumber,
          todayStr,
          (primaryOrigInv.partyId ?? primaryOrigInv.party_id) || customerInput.id || null,
          customerInput.name || (primaryOrigInv.customerName ?? primaryOrigInv.customer_name) || 'Retail Customer',
          customerInput.phone || (primaryOrigInv.customerPhone ?? primaryOrigInv.customer_phone) || null,
          customerInput.gstin || (primaryOrigInv.customerGstin ?? primaryOrigInv.customer_gstin) || null,
          calcReturnResult.taxableTotalMinor,
          calcReturnResult.taxableTotalMinor,
          calcReturnResult.cgstMinor,
          calcReturnResult.sgstMinor,
          calcReturnResult.igstMinor,
          calcReturnResult.roundOffMinor,
          returnTotalMinor,
          exchangeAdjustedMinor,
          j(calcReturnResult),
          `Exchange transaction: ${exchangeId}`,
          primaryOrigInv.id,
          shareTokenCn,
          ctx.user!.id,
          branchId,
          primaryOrigInv.counter || 'COUNTER-1',
          primaryOrigInv.counterId ?? primaryOrigInv.counter_id ?? null,
          primaryOrigInv.counterNameSnapshot ?? primaryOrigInv.counter_name_snapshot ?? null,
          exchangeId,
          exchangeAdjustedMinor,
          customerRefundMinor,
          customerRefundMinor > 0 ? refundMethod : null,
          customerRefundMinor > 0 ? refundReference : null,
        ],
      );

      // Insert Credit Note lines & stock moves
      for (let i = 0; i < calcReturnResult.lines.length; i++) {
        const cl = calcReturnResult.lines[i];
        const lineId = newId('inl');
        const origL = origLineMap.get(cl.origLineId);
        let costMinor = Number(origL?.cost_minor || 0);
        if (!costMinor && cl.itemId) {
          const itemCost = await q.one<any>('SELECT cost_minor FROM items WHERE id = ?', [cl.itemId]);
          costMinor = Number(itemCost?.cost_minor || 0);
        }

        await q.exec(
          `INSERT INTO invoice_lines (
            id, tenant_id, branch_id, invoice_id, pos, item_id, name, hsn, unit,
            qty_milli, price_minor, discount_minor, tax_rate_bp, inclusive,
            taxable_minor, cgst_minor, sgst_minor, igst_minor, total_minor,
            reason, restock, orig_line_id, item_condition, cost_minor
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            lineId,
            tenantId,
            branchId,
            savedCnId,
            i + 1,
            cl.itemId || null,
            cl.name,
            cl.hsn || null,
            cl.unit || null,
            cl.returnQtyMilli,
            cl.priceMinor,
            cl.taxRateBp,
            cl.inclusive,
            cl.taxableMinor,
            cl.cgstMinor,
            cl.sgstMinor,
            cl.igstMinor,
            cl.totalMinor,
            cl.reason,
            cl.restock,
            cl.origLineId,
            cl.condition,
            costMinor,
          ],
        );

        if (cl.itemId) {
          const moveLocation = cl.condition === 'damaged' ? 'DAMAGED' : cl.condition === 'defective' ? 'DEFECTIVE' : branchId;
          await q.exec(
            `INSERT INTO stock_moves (
              id, tenant_id, branch_id, item_id, location, qty_milli, kind, ref_type, ref_id, user_id, reason, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'return', 'exchange', ?, ?, ?, NOW())`,
            [
              newId('sm'),
              tenantId,
              branchId,
              cl.itemId,
              moveLocation,
              cl.returnQtyMilli,
              savedCnId,
              ctx.user!.id,
              `Exchange Return [${cl.condition}] - Ref: ${exchangeId}`,
            ],
          );
        }
      }

      // 6. Insert New Sales Invoice
      const additionalPaid = customerPayableMinor > 0 ? customerPayableMinor : 0;
      await q.exec(
        `INSERT INTO invoices (
          id, tenant_id, branch_id, client_id, number, kind, status, bdate,
          party_id, customer_name, customer_phone, customer_gstin,
          subtotal_minor, discount_minor, taxable_minor,
          cgst_minor, sgst_minor, igst_minor, round_off_minor, total_minor,
          paid_minor, balance_minor, applied_minor,
          rule_version, calc, custom, note,
          share_token, created_by,
          location, counter, counter_id, counter_name_snapshot,
          exchange_id, is_exchange, exchange_adjusted_minor, created_at
        ) VALUES (
          ?, ?, ?, ?, ?, 'sale', 'posted', ?,
          ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, 0, ?,
          '1.0', ?, '{}', ?,
          ?, ?,
          ?, ?, ?, ?,
          ?, TRUE, ?, NOW()
        )`,
        [
          savedSaleId,
          tenantId,
          branchId,
          newId('client'),
          savedSaleNumber,
          todayStr,
          customerInput.id || (primaryOrigInv.partyId ?? primaryOrigInv.party_id) || null,
          customerInput.name || (primaryOrigInv.customerName ?? primaryOrigInv.customer_name) || 'Retail Customer',
          customerInput.phone || (primaryOrigInv.customerPhone ?? primaryOrigInv.customer_phone) || null,
          customerInput.gstin || (primaryOrigInv.customerGstin ?? primaryOrigInv.customer_gstin) || null,
          calcSaleResult.subtotalMinor,
          calcSaleResult.discountMinor,
          calcSaleResult.taxableMinor,
          calcSaleResult.cgstMinor,
          calcSaleResult.sgstMinor,
          calcSaleResult.igstMinor,
          calcSaleResult.roundOffMinor,
          newTotalMinor,
          newTotalMinor, // paid in full via exchange credit + difference
          exchangeAdjustedMinor,
          j(calcSaleResult),
          note || `Exchange purchase: ${exchangeId}`,
          shareTokenSale,
          ctx.user!.id,
          branchId,
          primaryOrigInv.counter || 'COUNTER-1',
          primaryOrigInv.counterId ?? primaryOrigInv.counter_id ?? null,
          primaryOrigInv.counterNameSnapshot ?? primaryOrigInv.counter_name_snapshot ?? null,
          exchangeId,
          exchangeAdjustedMinor,
        ],
      );

      // Insert New Sales Lines & deduct stock
      for (let i = 0; i < calcSaleResult.lines.length; i++) {
        const sl = calcSaleResult.lines[i];
        const lineId = newId('inl');
        const origReqLine = formattedNewLines[i];
        let costMinor = 0;
        if (origReqLine.itemId) {
          const itemCost = await q.one<any>('SELECT cost_minor FROM items WHERE id = ?', [origReqLine.itemId]);
          costMinor = Number(itemCost?.cost_minor || 0);
        }

        await q.exec(
          `INSERT INTO invoice_lines (
            id, tenant_id, branch_id, invoice_id, pos, item_id, name, hsn, unit,
            qty_milli, price_minor, discount_minor, tax_rate_bp, inclusive,
            taxable_minor, cgst_minor, sgst_minor, igst_minor, total_minor,
            item_condition, cost_minor
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'resellable', ?)`,
          [
            lineId,
            tenantId,
            branchId,
            savedSaleId,
            i + 1,
            origReqLine.itemId || null,
            origReqLine.name,
            origReqLine.hsn || null,
            origReqLine.unit || null,
            origReqLine.qtyMilli,
            origReqLine.priceMinor,
            sl.discountMinor,
            sl.taxRateBp,
            sl.inclusive,
            sl.taxableMinor,
            sl.cgstMinor,
            sl.sgstMinor,
            sl.igstMinor,
            sl.totalMinor,
            costMinor,
          ],
        );

        if (origReqLine.itemId) {
          await q.exec(
            `INSERT INTO stock_moves (
              id, tenant_id, branch_id, item_id, location, qty_milli, kind, ref_type, ref_id, user_id, reason, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'sale', 'invoice', ?, ?, ?, NOW())`,
            [
              newId('sm'),
              tenantId,
              branchId,
              origReqLine.itemId,
              branchId,
              -origReqLine.qtyMilli, // deduct sold quantity
              savedSaleId,
              ctx.user!.id,
              `Exchange Sale - Ref: ${exchangeId}`,
            ],
          );
        }
      }

      // 7. Record Credit Allocation (Linking Return to New Bill)
      await q.exec(
        `INSERT INTO credit_allocations (
          id, tenant_id, branch_id, credit_note_id, invoice_id, customer_id, amount_minor, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          newId('ca'),
          tenantId,
          branchId,
          savedCnId,
          savedSaleId,
          customerInput.id || (primaryOrigInv.partyId ?? primaryOrigInv.party_id) || null,
          exchangeAdjustedMinor,
        ],
      );

      const openShiftRow = await q.one<any>(
        "SELECT id FROM shifts WHERE tenant_id = ? AND user_id = ? AND status = 'open' LIMIT 1",
        [tenantId, ctx.user!.id],
      );
      const shiftId = openShiftRow?.id || null;

      // 8. Handle Additional Payment (if customer payable > 0)
      if (customerPayableMinor > 0) {
        await q.exec(
          `INSERT INTO payments (
            id, tenant_id, branch_id, invoice_id, party_id, amount_minor,
            method, mode, kind, reference, shift_id, bdate, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'receipt', ?, ?, ?, ?, NOW())`,
          [
            newId('pay'),
            tenantId,
            branchId,
            savedSaleId,
            customerInput.id || primaryOrigInv.party_id || null,
            customerPayableMinor,
            paymentMethod,
            paymentMethod,
            paymentReference || `Exchange diff: ${exchangeId}`,
            shiftId,
            todayStr,
            ctx.user!.id,
          ],
        );
      }

      // 9. Handle Excess Refund / Store Credit (if return > new sale)
      if (customerRefundMinor > 0) {
        if (refundMethod === 'store_credit' && (customerInput.id || primaryOrigInv.party_id)) {
          const partyId = customerInput.id || primaryOrigInv.party_id;
          await q.exec(
            `UPDATE parties SET advance_minor = advance_minor + ? WHERE id = ? AND tenant_id = ?`,
            [customerRefundMinor, partyId, tenantId],
          );

          await q.exec(
            `INSERT INTO store_credits (
              id, tenant_id, party_id, credit_note_id, amount_minor, balance_minor, status, reference_no, notes, created_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, NOW(), NOW())`,
            [
              newId('sc'),
              tenantId,
              partyId,
              savedCnId,
              customerRefundMinor,
              customerRefundMinor,
              exchangeId,
              `Store credit remainder from Exchange ${exchangeId}`,
              ctx.user!.id,
            ],
          );
        } else {
          // Direct cash / UPI refund
          const openShiftRow = await q.one<any>(
            "SELECT id FROM shifts WHERE tenant_id = ? AND user_id = ? AND status = 'open' LIMIT 1",
            [tenantId, ctx.user!.id],
          );
          await q.exec(
            `INSERT INTO refund_transactions (
              id, tenant_id, credit_note_id, orig_invoice_id, party_id, amount_minor, method, reference_no, bdate, shift_id, notes, processed_by, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
            [
              newId('rfd'),
              tenantId,
              savedCnId,
              primaryOrigInv.id,
              customerInput.id || primaryOrigInv.party_id || null,
              customerRefundMinor,
              refundMethod,
              refundReference || `Exchange refund: ${exchangeId}`,
              todayStr,
              openShiftRow?.id || null,
              `Exchange credit excess refund`,
              ctx.user!.id,
            ],
          );
        }
      }

      // 10. Audit log
      await audit(q, ctx, {
        action: 'exchange.create',
        entity: 'exchange',
        entityId: exchangeId,
        detail: {
          exchangeId,
          creditNoteNumber: savedCnNumber,
          saleNumber: savedSaleNumber,
          returnTotalMinor,
          newTotalMinor,
          exchangeAdjustedMinor,
          customerPayableMinor,
          customerRefundMinor,
          paymentMethod,
        },
      });
    });

    return {
      success: true,
      exchangeId,
      returnTotalMinor,
      newPurchaseMinor: newTotalMinor,
      creditNote: {
        id: savedCnId,
        number: savedCnNumber,
        totalMinor: returnTotalMinor,
      },
      newInvoice: {
        id: savedSaleId,
        number: savedSaleNumber,
        totalMinor: newTotalMinor,
      },
      exchangeAdjustedMinor,
      customerPayableMinor,
      customerRefundMinor,
      paymentMethod,
    };
  });

  // 2. Printable Exchange Invoice
  r.get('/api/exchanges/:exchangeId/print', async (ctx) => {
    const exchangeId = ctx.params.exchangeId;
    const tenantId = (ctx.query.tenantId as string) || (ctx.user?.tenantId);
    if (!tenantId) throw bad('Missing tenantId');

    const shop = await ctx.db.one<any>('SELECT * FROM tenants WHERE id = ?', [tenantId]);
    if (!shop) throw notFound('Shop');

    const invSale = await ctx.db.one<any>(
      `SELECT * FROM invoices WHERE tenant_id = ? AND exchange_id = ? AND kind = 'sale' AND status = 'posted'`,
      [tenantId, exchangeId],
    );
    const invCn = await ctx.db.one<any>(
      `SELECT * FROM invoices WHERE tenant_id = ? AND exchange_id = ? AND kind = 'credit_note' AND status = 'posted'`,
      [tenantId, exchangeId],
    );

    if (!invSale && !invCn) throw notFound('Exchange record');

    const saleLines = invSale ? await ctx.db.query<any>('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY pos ASC', [invSale.id]) : [];
    const cnLines = invCn ? await ctx.db.query<any>('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY pos ASC', [invCn.id]) : [];
    const payments = invSale ? await ctx.db.query<any>('SELECT * FROM payments WHERE invoice_id = ?', [invSale.id]) : [];
    const refunds = invCn ? await ctx.db.query<any>('SELECT * FROM refund_transactions WHERE credit_note_id = ?', [invCn.id]) : [];

    const returnTotal = invCn ? Number(invCn.total_minor || 0) : 0;
    const saleTotal = invSale ? Number(invSale.total_minor || 0) : 0;
    const adjusted = invSale ? Number(invSale.exchange_adjusted_minor || 0) : Math.min(returnTotal, saleTotal);
    const payable = Math.max(0, saleTotal - returnTotal);
    const refundable = Math.max(0, returnTotal - saleTotal);
    const printDate = invSale?.bdate || new Date().toISOString().slice(0, 10);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Exchange Invoice - ${exchangeId}</title>
  <style>
    @media print { @page { margin: 10mm; size: auto; } }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 20px; color: #1e293b; line-height: 1.4; background: #fff; }
    .receipt { max-width: 480px; margin: 0 auto; border: 1px solid #e2e8f0; padding: 24px; border-radius: 8px; }
    .header { text-align: center; border-bottom: 2px dashed #cbd5e1; padding-bottom: 14px; margin-bottom: 14px; }
    .shop-title { font-size: 1.3rem; font-weight: 800; text-transform: uppercase; margin: 0 0 4px 0; }
    .badge { display: inline-block; background: #6366f1; color: #fff; font-size: 0.75rem; font-weight: 700; padding: 3px 10px; border-radius: 12px; margin-top: 6px; letter-spacing: 0.5px; }
    .meta-table { width: 100%; font-size: 0.85rem; margin-bottom: 14px; }
    .meta-table td { padding: 3px 0; }
    .sec-title { font-size: 0.82rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; margin: 14px 0 6px 0; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px; }
    .items-table { width: 100%; border-collapse: collapse; font-size: 0.84rem; margin-bottom: 12px; }
    .items-table th { text-align: left; padding: 5px 0; border-bottom: 1px solid #cbd5e1; font-size: 0.78rem; text-transform: uppercase; color: #64748b; }
    .items-table td { padding: 6px 0; border-bottom: 1px solid #f1f5f9; }
    .text-right { text-align: right; }
    .totals { width: 100%; font-size: 0.88rem; border-top: 2px dashed #cbd5e1; padding-top: 10px; margin-top: 10px; }
    .totals td { padding: 3px 0; }
    .grand-row { font-size: 1.05rem; font-weight: 800; color: #0f172a; border-top: 1px solid #cbd5e1; }
    .footer { text-align: center; font-size: 0.78rem; color: #64748b; margin-top: 20px; border-top: 1px solid #e2e8f0; padding-top: 12px; }
    .condition-tag { font-size: 0.7rem; padding: 1px 6px; border-radius: 4px; background: #f1f5f9; color: #475569; font-weight: 600; }
  </style>
</head>
<body>
  <div class="receipt">
    <div class="header">
      <h1 class="shop-title">${shop.name || 'Textile POS'}</h1>
      <div>${shop.address || ''}</div>
      ${shop.gstin ? `<div>GSTIN: <strong>${shop.gstin}</strong></div>` : ''}
      ${shop.phone ? `<div>Phone: ${shop.phone}</div>` : ''}
      <div class="badge">PRODUCT EXCHANGE INVOICE</div>
    </div>

    <table class="meta-table">
      <tr>
        <td><strong>Exchange Ref:</strong> ${exchangeId}</td>
        <td class="text-right"><strong>Date:</strong> ${printDate}</td>
      </tr>
      <tr>
        <td><strong>Credit Note:</strong> ${invCn?.number || '—'}</td>
        <td class="text-right"><strong>New Bill:</strong> ${invSale?.number || '—'}</td>
      </tr>
      ${invSale?.customer_name ? `<tr><td colspan="2"><strong>Customer:</strong> ${invSale.customer_name} ${invSale.customer_phone ? '(' + invSale.customer_phone + ')' : ''}</td></tr>` : ''}
    </table>

    <!-- 1. Old Items Returned -->
    <div class="sec-title" style="color: #dc2626;">◄ Returned Products (${cnLines.length} items)</div>
    <table class="items-table">
      <thead>
        <tr>
          <th>Item</th>
          <th>Qty</th>
          <th>Rate</th>
          <th class="text-right">Return Credit</th>
        </tr>
      </thead>
      <tbody>
        ${cnLines.map((l: any) => `
          <tr>
            <td>
              <div><strong>${l.name}</strong></div>
              <div><span class="condition-tag">${l.item_condition || 'resellable'}</span> <span style="font-size: 0.72rem; color: #64748b;">${l.reason || ''}</span></div>
            </td>
            <td>${l.qty_milli / 1000}</td>
            <td>${fmtMoney(l.price_minor)}</td>
            <td class="text-right" style="color: #dc2626; font-weight: 700;">-${fmtMoney(l.total_minor)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <!-- 2. New Items Purchased -->
    <div class="sec-title" style="color: #16a34a;">► New Purchased Products (${saleLines.length} items)</div>
    <table class="items-table">
      <thead>
        <tr>
          <th>Item</th>
          <th>Qty</th>
          <th>Rate</th>
          <th class="text-right">Total</th>
        </tr>
      </thead>
      <tbody>
        ${saleLines.map((l: any) => `
          <tr>
            <td><strong>${l.name}</strong></td>
            <td>${l.qty_milli / 1000}</td>
            <td>${fmtMoney(l.price_minor)}</td>
            <td class="text-right" style="font-weight: 700;">${fmtMoney(l.total_minor)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <!-- 3. Exchange Settlement Reconciliation -->
    <table class="totals">
      <tr>
        <td>New Purchase Total:</td>
        <td class="text-right font-bold">${fmtMoney(saleTotal)}</td>
      </tr>
      <tr>
        <td style="color: #dc2626;">Less Return Credit:</td>
        <td class="text-right" style="color: #dc2626; font-weight: 700;">-${fmtMoney(returnTotal)}</td>
      </tr>
      <tr>
        <td>Return Adjustment Applied:</td>
        <td class="text-right">${fmtMoney(adjusted)}</td>
      </tr>
      ${payable > 0 ? `
        <tr class="grand-row">
          <td><strong>Net Additional Paid:</strong></td>
          <td class="text-right"><strong>${fmtMoney(payable)}</strong></td>
        </tr>
        <tr>
          <td><small>Payment Mode:</small></td>
          <td class="text-right"><small>${payments[0]?.method?.toUpperCase() || 'CASH'}</small></td>
        </tr>
      ` : ''}
      ${refundable > 0 ? `
        <tr class="grand-row" style="color: #2563eb;">
          <td><strong>Refunded to Customer:</strong></td>
          <td class="text-right"><strong>${fmtMoney(refundable)}</strong></td>
        </tr>
        <tr>
          <td><small>Refund Method:</small></td>
          <td class="text-right"><small>${invCn?.refund_mode?.toUpperCase() || refunds[0]?.method?.toUpperCase() || 'CASH'}</small></td>
        </tr>
      ` : ''}
      ${payable === 0 && refundable === 0 ? `
        <tr class="grand-row">
          <td><strong>Net Amount Due:</strong></td>
          <td class="text-right"><strong>₹0.00 (Even Exchange)</strong></td>
        </tr>
      ` : ''}
    </table>

    <div class="footer">
      <div>Thank you for shopping with us!</div>
      <div style="margin-top: 4px; font-size: 0.72rem;">All returns and exchanges are recorded in full compliance with GST rules.</div>
    </div>
  </div>
  <script>window.onload = function() { window.print(); };</script>
</body>
</html>`;

    return new HtmlResponse(html);
  });
}
