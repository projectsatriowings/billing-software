import { requirePerm, requireUser } from '../auth.ts';
import { bad, forbidden, notFound, HtmlResponse, V, type Router } from '../http.ts';
import { newId } from '../security.ts';
import { j } from '../db/index.ts';
import { audit } from '../audit.ts';
import { calcReturn, planSettlement, type ReturnLineInput } from '../../../shared/returns.ts';
import { renderCreditNoteDoc, type PrintableCreditNote } from '../../../shared/bill.ts';
import { DEFAULT_CONFIG } from '../../../shared/types.ts';
import { normalizePhone } from '../../../shared/whatsapp.ts';

export function registerCreditNotes(r: Router) {
  // 1. Get returnable info for an invoice (pre-fill Create Return / Credit Note screen)
  r.get('/api/invoices/:id/return-info', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const inv = await ctx.db.one(
      'SELECT * FROM invoices WHERE id = ? AND tenant_id = ?',
      [ctx.params.id, tenantId],
    );
    if (!inv) throw notFound('Invoice');
    if (inv.kind === 'credit_note') {
      throw bad('Cannot create a return against a credit note.', 'INVALID_KIND');
    }
    if (inv.status === 'cancelled') {
      throw bad('Cannot create a return on a cancelled bill.', 'CANCELLED_BILL');
    }
    if (inv.status === 'voided') {
      throw bad('Cannot create a return on a voided document.', 'VOIDED_BILL');
    }

    const shop = await ctx.db.one('SELECT * FROM tenants WHERE id = ?', [tenantId]);
    if (!shop) throw notFound('Shop');

    // Original lines
    const lines = await ctx.db.query(
      'SELECT * FROM invoice_lines WHERE invoice_id = ? AND tenant_id = ? ORDER BY pos ASC',
      [inv.id, tenantId],
    );

    // Sum of already returned quantities across all posted credit notes for each line
    const returnedLines = await ctx.db.query(
      `SELECT il.orig_line_id, il.item_id, il.name, SUM(il.qty_milli)::bigint AS returned_qty_milli
       FROM invoice_lines il
       JOIN invoices cn ON cn.id = il.invoice_id
       WHERE cn.linked_invoice_id = ?
         AND cn.tenant_id = ?
         AND cn.status = 'posted'
       GROUP BY il.orig_line_id, il.item_id, il.name`,
      [inv.id, tenantId],
    );

    const returnedMap = new Map<string, number>();
    for (const rl of returnedLines) {
      const origLineId = rl.origLineId ?? rl.orig_line_id;
      const itemId = rl.itemId ?? rl.item_id;
      const retQty = Number(rl.returnedQtyMilli ?? rl.returned_qty_milli ?? 0);
      if (origLineId) {
        returnedMap.set(origLineId, retQty);
      } else if (itemId) {
        returnedMap.set(`item:${itemId}`, retQty);
      } else {
        returnedMap.set(`name:${rl.name}`, retQty);
      }
    }

    let allFullyReturned = lines.length > 0;
    const formattedLines = lines.map((l: any) => {
      const billedQtyMilli = Number(l.qtyMilli ?? l.qty_milli ?? 0);
      let alreadyReturned = 0;
      if (returnedMap.has(l.id)) {
        alreadyReturned = returnedMap.get(l.id)!;
      } else if (l.itemId && returnedMap.has(`item:${l.itemId}`)) {
        alreadyReturned = returnedMap.get(`item:${l.itemId}`)!;
      } else if (returnedMap.has(`name:${l.name}`)) {
        alreadyReturned = returnedMap.get(`name:${l.name}`)!;
      }

      const returnableQtyMilli = Math.max(0, billedQtyMilli - alreadyReturned);
      if (returnableQtyMilli > 0) {
        allFullyReturned = false;
      }

      return {
        id: l.id,
        pos: l.pos,
        itemId: l.itemId ?? l.item_id,
        name: l.name,
        hsn: l.hsn,
        unit: l.unit,
        billedQtyMilli,
        alreadyReturnedQtyMilli: alreadyReturned,
        returnableQtyMilli,
        priceMinor: Number(l.priceMinor ?? l.price_minor ?? 0),
        discountMinor: Number(l.discountMinor ?? l.discount_minor ?? 0),
        taxRateBp: Number(l.taxRateBp ?? l.tax_rate_bp ?? 0),
        inclusive: Boolean(l.inclusive),
        origTaxableMinor: Number(l.taxableMinor ?? l.taxable_minor ?? 0),
        origCgstMinor: Number(l.cgstMinor ?? l.cgst_minor ?? 0),
        origSgstMinor: Number(l.sgstMinor ?? l.sgst_minor ?? 0),
        origIgstMinor: Number(l.igstMinor ?? l.igst_minor ?? 0),
        origTotalMinor: Number(l.totalMinor ?? l.total_minor ?? 0),
      };
    });

    // Customer and other unpaid bills
    const partyId = inv.partyId ?? inv.party_id;
    let customer: any = null;
    let otherUnpaidInvoices: any[] = [];

    if (partyId) {
      const party = await ctx.db.one(
        'SELECT id, name, phone, gstin, address, advance_minor FROM parties WHERE id = ? AND tenant_id = ?',
        [partyId, tenantId],
      );
      if (party) {
        customer = {
          id: party.id,
          name: party.name,
          phone: party.phone,
          gstin: party.gstin,
          address: party.address,
          advanceMinor: Number(party.advanceMinor ?? party.advance_minor ?? 0),
        };

        const otherInvs = await ctx.db.query(
          `SELECT id, number, bdate, balance_minor, total_minor, paid_minor, created_at
           FROM invoices
           WHERE tenant_id = ? AND party_id = ? AND status = 'posted' AND balance_minor > 0 AND id != ?
           ORDER BY bdate ASC, created_at ASC`,
          [tenantId, partyId, inv.id],
        );
        otherUnpaidInvoices = otherInvs.map((oi: any) => ({
          id: oi.id,
          number: oi.number,
          bdate: oi.bdate,
          balanceMinor: Number(oi.balanceMinor ?? oi.balance_minor ?? 0),
          totalMinor: Number(oi.totalMinor ?? oi.total_minor ?? 0),
        }));
      }
    }

    // Bill age in days
    const invDateStr = inv.bdate || (inv.createdAt ?? inv.created_at ?? new Date().toISOString()).slice(0, 10);
    const invoiceDate = new Date(invDateStr);
    const today = new Date();
    const billAgeDays = Math.max(0, Math.floor((today.getTime() - invoiceDate.getTime()) / (1000 * 60 * 60 * 24)));

    // Prior credit notes for this invoice
    const priorCreditNotes = await ctx.db.query(
      `SELECT id, number, bdate, status, total_minor, advance_amount_minor, refund_amount_minor,
              created_at, void_reason, voided_at
       FROM invoices
       WHERE linked_invoice_id = ? AND tenant_id = ?
       ORDER BY created_at DESC`,
      [inv.id, tenantId],
    );

    return {
      invoice: {
        id: inv.id,
        number: inv.number,
        bdate: inv.bdate,
        createdAt: inv.createdAt ?? inv.created_at,
        customerName: inv.customerName ?? inv.customer_name,
        customerPhone: inv.customerPhone ?? inv.customer_phone,
        partyId,
        intra: Boolean(inv.intra),
        totalMinor: Number(inv.totalMinor ?? inv.total_minor ?? 0),
        paidMinor: Number(inv.paidMinor ?? inv.paid_minor ?? 0),
        balanceMinor: Number(inv.balanceMinor ?? inv.balance_minor ?? 0),
      },
      lines: formattedLines,
      customer,
      otherUnpaidInvoices,
      billAgeDays,
      fullyReturned: allFullyReturned,
      priorCreditNotes: priorCreditNotes.map((cn: any) => ({
        id: cn.id,
        number: cn.number,
        bdate: cn.bdate,
        status: cn.status,
        totalMinor: Number(cn.totalMinor ?? cn.total_minor ?? 0),
        advanceAmountMinor: Number(cn.advanceAmountMinor ?? cn.advance_amount_minor ?? 0),
        refundAmountMinor: Number(cn.refundAmountMinor ?? cn.refund_amount_minor ?? 0),
        createdAt: cn.createdAt ?? cn.created_at,
        voidReason: cn.voidReason ?? cn.void_reason,
        voidedAt: cn.voidedAt ?? cn.voided_at,
      })),
    };
  });

  // 2. Issue Credit Note (Atomic save)
  r.post('/api/invoices/:id/returns', requirePerm('sell'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const b = ctx.body ?? {};

    // Double-click safety: Idempotency check
    const idempotencyKey = V.optStr(b.idempotencyKey, 'Idempotency key', 128);
    if (idempotencyKey) {
      const existing = await ctx.db.one(
        `SELECT id, number, total_minor, status, share_token
         FROM invoices
         WHERE tenant_id = ? AND idempotency_key = ?`,
        [tenantId, idempotencyKey],
      );
      if (existing) {
        return {
          idempotent: true,
          creditNoteId: existing.id,
          creditNoteNumber: existing.number,
          totalCreditMinor: Number(existing.totalMinor ?? existing.total_minor),
          status: existing.status,
          shareToken: existing.shareToken ?? existing.share_token,
        };
      }
    }

    const linesInput = V.arr(b.lines, 'Returned lines', { min: 1 });
    const settlementType = V.oneOf(b.settlementType ?? 'advance', 'Settlement type', ['advance', 'refund'] as const, 'advance');
    const refundMode = V.optStr(b.refundMode, 'Refund mode', 30);
    const refundReference = V.optStr(b.refundReference, 'Refund reference', 100);
    const overallNote = V.optStr(b.note, 'Note', 250);

    const VALID_REASONS = ['Defective', 'Wrong Item', 'Customer Changed Mind', 'Damaged', 'Expired', 'Other'];

    let savedCnId = '';
    let assignedNumber = '';
    let totalCreditMinor = 0;
    let savedShareToken = '';
    let settlementResult: any = null;
    let calculatedResult: any = null;

    await ctx.db.tx(async (q) => {
      // 1. Lock original invoice FOR UPDATE
      const origInv = await q.one(
        'SELECT * FROM invoices WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [ctx.params.id, tenantId],
      );
      if (!origInv) throw notFound('Invoice');
      if (origInv.kind === 'credit_note') {
        throw bad('Cannot return against a credit note.', 'INVALID_KIND');
      }
      if (origInv.status === 'cancelled') {
        throw bad('Cannot return on a cancelled bill.', 'CANCELLED_BILL');
      }
      if (origInv.status === 'voided') {
        throw bad('Cannot return on a voided document.', 'VOIDED_BILL');
      }

      // 2. Lock original lines
      const origLines = await q.query(
        'SELECT * FROM invoice_lines WHERE invoice_id = ? AND tenant_id = ? ORDER BY pos ASC FOR UPDATE',
        [origInv.id, tenantId],
      );
      const origLineMap = new Map(origLines.map((l: any) => [l.id, l]));

      // 3. Compute current already-returned quantities to guard against race conditions
      const returnedRows = await q.query(
        `SELECT il.orig_line_id, il.item_id, il.name, SUM(il.qty_milli)::bigint AS returned_qty_milli
         FROM invoice_lines il
         JOIN invoices cn ON cn.id = il.invoice_id
         WHERE cn.linked_invoice_id = ?
           AND cn.tenant_id = ?
           AND cn.status = 'posted'
         GROUP BY il.orig_line_id, il.item_id, il.name`,
        [origInv.id, tenantId],
      );
      const alreadyReturnedMap = new Map<string, number>();
      for (const rr of returnedRows) {
        const origLineId = rr.origLineId ?? rr.orig_line_id;
        const itemId = rr.itemId ?? rr.item_id;
        const retQty = Number(rr.returnedQtyMilli ?? rr.returned_qty_milli ?? 0);
        if (origLineId) {
          alreadyReturnedMap.set(origLineId, retQty);
        } else if (itemId) {
          alreadyReturnedMap.set(`item:${itemId}`, retQty);
        } else {
          alreadyReturnedMap.set(`name:${rr.name}`, retQty);
        }
      }

      // Check sum of prior credit notes for full-invoice reconciliation
      const priorTotalRow = await q.one<{ totalCredited?: number; total_credited?: number }>(
        `SELECT COALESCE(SUM(total_minor), 0)::bigint AS total_credited
         FROM invoices
         WHERE linked_invoice_id = ? AND tenant_id = ? AND status = 'posted'`,
        [origInv.id, tenantId],
      );
      const alreadyCreditedTotalMinor = Number(priorTotalRow?.totalCredited ?? priorTotalRow?.total_credited ?? 0);

      // 4. Validate requested return lines
      const preparedLines: ReturnLineInput[] = [];
      let totalReturnQtyMilli = 0;
      let allRemainingReturned = true;

      for (let i = 0; i < linesInput.length; i++) {
        const item = linesInput[i];
        const origLineId = V.str(item.origLineId, `Line ${i + 1} ID`, { required: true });
        const origL = origLineMap.get(origLineId);
        if (!origL) {
          throw bad(`Original line ${origLineId} not found on this invoice.`);
        }

        const billedQtyMilli = Number(origL.qtyMilli ?? origL.qty_milli ?? 0);
        let alreadyReturned = 0;
        if (alreadyReturnedMap.has(origL.id)) {
          alreadyReturned = alreadyReturnedMap.get(origL.id)!;
        } else if (origL.itemId && alreadyReturnedMap.has(`item:${origL.itemId}`)) {
          alreadyReturned = alreadyReturnedMap.get(`item:${origL.itemId}`)!;
        } else if (alreadyReturnedMap.has(`name:${origL.name}`)) {
          alreadyReturned = alreadyReturnedMap.get(`name:${origL.name}`)!;
        }

        const returnableQtyMilli = Math.max(0, billedQtyMilli - alreadyReturned);
        const returnQtyMilli = V.int(item.returnQtyMilli ?? 0, `Line ${origL.name} return quantity`, { min: 0 });

        if (returnQtyMilli > returnableQtyMilli) {
          throw bad(
            `Return quantity exceeds returnable quantity. The bill was updated on another counter — please refresh. (Only ${returnableQtyMilli / 1000} ${origL.unit || 'units'} left for ${origL.name})`,
            'CONCURRENCY_ERROR',
          );
        }

        if (returnQtyMilli > 0) {
          totalReturnQtyMilli += returnQtyMilli;

          // Validate reason
          const rawReason = V.str(item.reason, `Reason for ${origL.name}`, { required: true });
          let finalReason = rawReason.trim();
          if (!VALID_REASONS.includes(finalReason) && !finalReason.startsWith('Other:')) {
            throw bad(`Invalid reason '${finalReason}' for ${origL.name}. Must be one of: ${VALID_REASONS.join(', ')}.`);
          }
          if (finalReason === 'Other') {
            const custom = V.optStr(item.customReason, 'Custom reason', 150);
            if (!custom || !custom.trim()) {
              throw bad(`Please enter a specific reason for ${origL.name} when selecting 'Other'.`);
            }
            finalReason = `Other: ${custom.trim()}`;
          }

          // Restock flag
          const restock = Boolean(item.restock ?? true);

          preparedLines.push({
            origLineId: origL.id,
            itemId: origL.itemId ?? origL.item_id,
            name: origL.name,
            hsn: origL.hsn,
            unit: origL.unit,
            batchNo: origL.batchNo ?? origL.batch_no,
            billedQtyMilli,
            alreadyReturnedQtyMilli: alreadyReturned,
            returnQtyMilli,
            priceMinor: Number(origL.priceMinor ?? origL.price_minor),
            taxRateBp: Number(origL.taxRateBp ?? origL.tax_rate_bp),
            inclusive: Boolean(origL.inclusive),
            origTaxableMinor: Number(origL.taxableMinor ?? origL.taxable_minor),
            origCgstMinor: Number(origL.cgstMinor ?? origL.cgst_minor),
            origSgstMinor: Number(origL.sgstMinor ?? origL.sgst_minor),
            origIgstMinor: Number(origL.igstMinor ?? origL.igst_minor),
            origTotalMinor: Number(origL.totalMinor ?? origL.total_minor),
            restock,
            reason: finalReason,
          });
        }

        if (returnQtyMilli < returnableQtyMilli) {
          allRemainingReturned = false;
        }
      }

      if (totalReturnQtyMilli <= 0) {
        throw bad('Please select at least one item with a return quantity greater than 0.');
      }

      // Check if all lines on invoice are now completely returned
      let isFullInvoiceReturn = allRemainingReturned;
      if (origLines.length !== linesInput.length) {
        for (const l of origLines) {
          if (!linesInput.some((li: any) => li.origLineId === l.id)) {
            const billed = Number(l.qtyMilli ?? l.qty_milli ?? 0);
            const ret = alreadyReturnedMap.get(l.id) ?? 0;
            if (billed > ret) {
              isFullInvoiceReturn = false;
              break;
            }
          }
        }
      }

      // 5. Calculate reversal amounts
      const isIntraState = Boolean(origInv.intra);
      const calculated = calcReturn(preparedLines, {
        isIntraState,
        isFullInvoiceReturn,
        origInvoiceTotalMinor: Number(origInv.totalMinor ?? origInv.total_minor),
        alreadyCreditedTotalMinor,
      });

      totalCreditMinor = calculated.totalCreditMinor;
      calculatedResult = calculated;

      // 6. Settle credit
      const partyId = origInv.partyId ?? origInv.party_id;
      let customerParty: any = null;
      let otherUnpaidBills: { id: string; number: string; balanceMinor: number }[] = [];

      if (partyId) {
        customerParty = await q.one(
          'SELECT * FROM parties WHERE id = ? AND tenant_id = ? FOR UPDATE',
          [partyId, tenantId],
        );
        if (customerParty) {
          const otherRows = await q.query(
            `SELECT id, number, balance_minor
             FROM invoices
             WHERE tenant_id = ? AND party_id = ? AND status = 'posted' AND balance_minor > 0 AND id != ?
             ORDER BY bdate ASC, created_at ASC
             FOR UPDATE`,
            [tenantId, partyId, origInv.id],
          );
          otherUnpaidBills = otherRows.map((r: any) => ({
            id: r.id,
            number: r.number,
            balanceMinor: Number(r.balanceMinor ?? r.balance_minor),
          }));
        }
      }

      const origBalanceMinor = Number(origInv.balanceMinor ?? origInv.balance_minor);

      // Walk-in bills (no customer) are refund-only for any remainder
      let effectiveSettlementType = settlementType;
      if (!partyId) {
        if (b.settlementType === 'advance' && totalCreditMinor > origBalanceMinor) {
          throw bad('Walk-in bills cannot hold customer advance. Please select Refund Now.', 'INVALID_SETTLEMENT');
        }
        effectiveSettlementType = 'refund';
        if (totalCreditMinor > origBalanceMinor && !refundMode) {
          throw bad('A refund mode (Cash/UPI/Card/Bank) is required for walk-in returns.', 'VALIDATION');
        }
      }

      if (effectiveSettlementType === 'refund' && (totalCreditMinor > origBalanceMinor || !partyId)) {
        if (!refundMode) {
          throw bad('Please select a payment mode for the refund (Cash, UPI, Card, Bank).', 'VALIDATION');
        }
      }

      const settlement = planSettlement(
        totalCreditMinor,
        { id: origInv.id, number: origInv.number, balanceMinor: origBalanceMinor },
        otherUnpaidBills,
        Boolean(partyId),
        effectiveSettlementType,
        refundMode ? { mode: refundMode, reference: refundReference || undefined } : undefined,
      );

      settlementResult = settlement;

      // 7. Number series for Credit Note (CN-1001)
      const seriesRow = await q.one<{ assignedNo?: number; assigned_no?: number }>(
        `INSERT INTO number_series (tenant_id, series, next_no)
         VALUES (?, 'CN', 2)
         ON CONFLICT (tenant_id, series) DO UPDATE SET next_no = number_series.next_no + 1
         RETURNING (next_no - 1) AS assigned_no`,
        [tenantId],
      );
      const seqNo = Number(seriesRow?.assignedNo ?? seriesRow?.assigned_no ?? 1);
      assignedNumber = `CN-${1000 + seqNo}`;

      const cnId = newId('cn');
      savedCnId = cnId;
      savedShareToken = newId('tok');
      const todayStr = new Date().toISOString().slice(0, 10);

      // 8. Insert credit note invoice
      await q.exec(
        `INSERT INTO invoices (
          id, tenant_id, client_id, number, kind, status, bdate, party_id,
          customer_name, customer_phone, place_state, intra,
          subtotal_minor, discount_minor, taxable_minor, cgst_minor, sgst_minor, igst_minor,
          round_off_minor, total_minor, paid_minor, balance_minor,
          advance_amount_minor, refund_amount_minor, refund_mode, refund_reference,
          rule_version, calc, share_token, idempotency_key, note, linked_invoice_id, created_by, created_at
        ) VALUES (
          ?, ?, ?, ?, 'credit_note', 'posted', ?, ?,
          ?, ?, ?, ?,
          ?, 0, ?, ?, ?, ?,
          ?, ?, 0, 0,
          ?, ?, ?, ?,
          '1.0', ?::jsonb, ?, ?, ?, ?, ?, NOW()
        )`,
        [
          cnId,
          tenantId,
          newId('cid'),
          assignedNumber,
          todayStr,
          partyId || null,
          origInv.customer_name || origInv.customerName || null,
          origInv.customer_phone || origInv.customerPhone || null,
          origInv.place_state || origInv.placeState || '33',
          isIntraState,
          calculated.taxableTotalMinor,
          calculated.taxableTotalMinor,
          calculated.cgstMinor,
          calculated.sgstMinor,
          calculated.igstMinor,
          calculated.roundOffMinor,
          calculated.totalCreditMinor,
          settlement.advanceAmountMinor,
          settlement.refundAmountMinor,
          settlement.refundMode || null,
          settlement.refundReference || null,
          j(calculated),
          savedShareToken,
          idempotencyKey || null,
          overallNote || null,
          origInv.id,
          ctx.user!.id,
        ],
      );

      // 9. Insert lines and create restock stock moves
      for (let i = 0; i < calculated.lines.length; i++) {
        const cl = calculated.lines[i];
        const lineId = newId('inl');

        await q.exec(
          `INSERT INTO invoice_lines (
            id, tenant_id, invoice_id, pos, item_id, name, hsn, unit,
            qty_milli, price_minor, discount_minor, tax_rate_bp, inclusive,
            taxable_minor, cgst_minor, sgst_minor, igst_minor, total_minor,
            reason, restock, orig_line_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            lineId,
            tenantId,
            cnId,
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
          ],
        );

        // Stock moves: ONLY if restock is true and item has itemId
        if (cl.restock && cl.itemId) {
          await q.exec(
            `INSERT INTO stock_moves (
              id, tenant_id, item_id, location, qty_milli, kind, ref_type, ref_id, user_id, reason, created_at
            ) VALUES (?, ?, ?, 'MAIN', ?, 'return', 'credit_note', ?, ?, ?, NOW())`,
            [
              newId('sm'),
              tenantId,
              cl.itemId,
              cl.returnQtyMilli, // positive stock return
              cnId,
              ctx.user!.id,
              cl.reason,
            ],
          );
        }
      }

      // 10. Record credit allocations and update invoice balances
      for (const alloc of settlement.allocations) {
        await q.exec(
          `INSERT INTO credit_allocations (
            id, tenant_id, credit_note_id, invoice_id, customer_id, amount_minor, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [
            newId('ca'),
            tenantId,
            cnId,
            alloc.invoiceId,
            partyId || null,
            alloc.amountMinor,
          ],
        );

        await q.exec(
          `UPDATE invoices
           SET balance_minor = balance_minor - ?,
               paid_minor = paid_minor + ?
           WHERE id = ? AND tenant_id = ?`,
          [alloc.amountMinor, alloc.amountMinor, alloc.invoiceId, tenantId],
        );
      }

      // 11. Add customer advance if created
      if (settlement.advanceAmountMinor > 0 && partyId) {
        await q.exec(
          `UPDATE parties
           SET advance_minor = advance_minor + ?
           WHERE id = ? AND tenant_id = ?`,
          [settlement.advanceAmountMinor, partyId, tenantId],
        );
      }

      // 12. Audit
      await audit(q, ctx, {
        action: 'credit_note.create',
        entity: 'invoice',
        entityId: cnId,
        detail: {
          creditNoteNumber: assignedNumber,
          originalInvoiceNumber: origInv.number,
          totalCreditMinor: calculated.totalCreditMinor,
          duesClearedMinor: settlement.duesClearedMinor,
          advanceAmountMinor: settlement.advanceAmountMinor,
          refundAmountMinor: settlement.refundAmountMinor,
          linesCount: calculated.lines.length,
        },
      });
    });

    return {
      success: true,
      creditNoteId: savedCnId,
      creditNoteNumber: assignedNumber,
      totalCreditMinor,
      taxableTotalMinor: calculatedResult?.taxableTotalMinor ?? 0,
      cgstMinor: calculatedResult?.cgstMinor ?? 0,
      sgstMinor: calculatedResult?.sgstMinor ?? 0,
      igstMinor: calculatedResult?.igstMinor ?? 0,
      roundOffMinor: calculatedResult?.roundOffMinor ?? 0,
      shareToken: savedShareToken,
      settlement: {
        ...settlementResult,
        duesClearedTotalMinor: settlementResult?.duesClearedMinor ?? 0,
      },
    };
  });

  // 3. Get Credit Note details
  r.get('/api/credit-notes/:id', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const cn = await ctx.db.one(
      `SELECT * FROM invoices WHERE id = ? AND tenant_id = ? AND kind = 'credit_note'`,
      [ctx.params.id, tenantId],
    );
    if (!cn) throw notFound('Credit Note');

    const linkedInvoiceId = cn.linkedInvoiceId ?? cn.linked_invoice_id;
    const origInv = linkedInvoiceId ? await ctx.db.one(
      'SELECT id, number, bdate, total_minor, balance_minor FROM invoices WHERE id = ? AND tenant_id = ?',
      [linkedInvoiceId, tenantId],
    ) : null;

    const lines = await ctx.db.query(
      'SELECT * FROM invoice_lines WHERE invoice_id = ? AND tenant_id = ? ORDER BY pos ASC',
      [cn.id, tenantId],
    );

    const allocations = await ctx.db.query(
      `SELECT ca.*, i.number AS invoice_number, i.bdate AS invoice_date
       FROM credit_allocations ca
       JOIN invoices i ON i.id = ca.invoice_id
       WHERE ca.credit_note_id = ? AND ca.tenant_id = ?
       ORDER BY ca.created_at ASC`,
      [cn.id, tenantId],
    );

    const voidedBy = cn.voidedBy ?? cn.voided_by;
    const voidedByUser = voidedBy
      ? await ctx.db.one('SELECT id, name FROM users WHERE id = ?', [voidedBy])
      : null;
    const createdBy = cn.createdBy ?? cn.created_by;
    const createdByUser = createdBy
      ? await ctx.db.one('SELECT id, name FROM users WHERE id = ?', [createdBy])
      : null;

    return {
      creditNote: {
        id: cn.id,
        number: cn.number,
        status: cn.status,
        bdate: cn.bdate,
        createdAt: cn.createdAt ?? cn.created_at,
        linkedInvoiceId,
        originalInvoiceNumber: origInv?.number ?? '—',
        originalInvoiceDate: origInv?.bdate ?? '—',
        partyId: cn.partyId ?? cn.party_id,
        customerName: cn.customerName ?? cn.customer_name,
        customerPhone: cn.customerPhone ?? cn.customer_phone,
        totalCreditMinor: Number(cn.totalMinor ?? cn.total_minor ?? 0),
        taxableTotalMinor: Number(cn.taxableMinor ?? cn.taxable_minor ?? 0),
        cgstMinor: Number(cn.cgstMinor ?? cn.cgst_minor ?? 0),
        sgstMinor: Number(cn.sgstMinor ?? cn.sgst_minor ?? 0),
        igstMinor: Number(cn.igstMinor ?? cn.igst_minor ?? 0),
        roundOffMinor: Number(cn.roundOffMinor ?? cn.round_off_minor ?? 0),
        advanceAmountMinor: Number(cn.advanceAmountMinor ?? cn.advance_amount_minor ?? 0),
        refundAmountMinor: Number(cn.refundAmountMinor ?? cn.refund_amount_minor ?? 0),
        refundMode: cn.refundMode ?? cn.refund_mode,
        refundReference: cn.refundReference ?? cn.refund_reference,
        note: cn.note,
        voidReason: cn.voidReason ?? cn.void_reason,
        voidedAt: cn.voidedAt ?? cn.voided_at,
        voidedByName: voidedByUser?.name ?? null,
        createdByName: createdByUser?.name ?? null,
        shareToken: cn.shareToken ?? cn.share_token,
        whatsappSendCount: Number(cn.whatsappSendCount ?? cn.whatsapp_send_count ?? 0),
        whatsappLastSentAt: cn.whatsappLastSentAt ?? cn.whatsapp_last_sent_at,
        whatsappLastSentTo: cn.whatsappLastSentTo ?? cn.whatsapp_last_sent_to,
        whatsappLastLanguage: cn.whatsappLastLanguage ?? cn.whatsapp_last_language,
      },
      lines: lines.map((l: any) => ({
        id: l.id,
        pos: l.pos,
        itemId: l.itemId ?? l.item_id,
        name: l.name,
        hsn: l.hsn,
        unit: l.unit,
        qtyMilli: Number(l.qtyMilli ?? l.qty_milli ?? 0),
        priceMinor: Number(l.priceMinor ?? l.price_minor ?? 0),
        discountMinor: Number(l.discountMinor ?? l.discount_minor ?? 0),
        taxRateBp: Number(l.taxRateBp ?? l.tax_rate_bp ?? 0),
        taxableMinor: Number(l.taxableMinor ?? l.taxable_minor ?? 0),
        cgstMinor: Number(l.cgstMinor ?? l.cgst_minor ?? 0),
        sgstMinor: Number(l.sgstMinor ?? l.sgst_minor ?? 0),
        igstMinor: Number(l.igstMinor ?? l.igst_minor ?? 0),
        totalMinor: Number(l.totalMinor ?? l.total_minor ?? 0),
        reason: l.reason,
        restock: Boolean(l.restock),
      })),
      allocations: allocations.map((a: any) => ({
        invoiceId: a.invoiceId ?? a.invoice_id,
        invoiceNumber: a.invoiceNumber ?? a.invoice_number,
        invoiceDate: a.invoiceDate ?? a.invoice_date,
        amountMinor: Number(a.amountMinor ?? a.amount_minor ?? 0),
      })),
    };
  });

  // 4. Print Credit Note (Thermal 58/80 or A4 HTML)
  r.get('/api/credit-notes/:id/print', async (ctx) => {
    const cn = await ctx.db.one(
      `SELECT * FROM invoices WHERE id = ? AND kind = 'credit_note'`,
      [ctx.params.id],
    );
    if (!cn) throw notFound('Credit Note');

    const shopTenantId = cn.tenantId ?? cn.tenant_id;
    const shop = await ctx.db.one('SELECT * FROM tenants WHERE id = ?', [shopTenantId]);
    if (!shop) throw notFound('Shop');

    const linkedInvoiceId = cn.linkedInvoiceId ?? cn.linked_invoice_id;
    const origInv = linkedInvoiceId ? await ctx.db.one(
      'SELECT id, number, bdate, created_at FROM invoices WHERE id = ?',
      [linkedInvoiceId],
    ) : null;

    const lines = await ctx.db.query(
      'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY pos ASC',
      [cn.id],
    );

    const allocations = await ctx.db.query(
      `SELECT ca.*, i.number AS invoice_number
       FROM credit_allocations ca
       JOIN invoices i ON i.id = ca.invoice_id
       WHERE ca.credit_note_id = ?`,
      [cn.id],
    );

    const createdBy = cn.createdBy ?? cn.created_by;
    const createdByUser = createdBy
      ? await ctx.db.one('SELECT id, name FROM users WHERE id = ?', [createdBy])
      : null;

    const paper = ctx.query.paper === 'a4' || ctx.query.paper === 'thermal58' ? ctx.query.paper : 'thermal80';
    const autoPrint = ctx.query.autoprint === 'true';

    const printable: PrintableCreditNote = {
      creditNoteNumber: cn.number,
      creditNoteDateText: new Date(cn.createdAt ?? cn.created_at).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
      originalInvoiceNumber: origInv?.number ?? '—',
      originalInvoiceDateText: origInv ? new Date(origInv.bdate ?? origInv.createdAt ?? origInv.created_at).toLocaleDateString('en-IN') : '—',
      status: cn.status,
      shop: {
        name: shop.name,
        address: shop.address,
        phone: shop.phone,
        gstin: shop.gstin,
        upiId: shop.upiId ?? shop.upi_id,
      },
      customer: (cn.customerName ?? cn.customer_name) ? { name: cn.customerName ?? cn.customer_name, phone: cn.customerPhone ?? cn.customer_phone } : null,
      lines: lines.map((l: any) => ({
        name: l.name,
        hsn: l.hsn,
        unit: l.unit,
        returnQtyMilli: Number(l.qtyMilli ?? l.qty_milli ?? 0),
        priceMinor: Number(l.priceMinor ?? l.price_minor ?? 0),
        taxRateBp: Number(l.taxRateBp ?? l.tax_rate_bp ?? 0),
        taxableMinor: Number(l.taxableMinor ?? l.taxable_minor ?? 0),
        cgstMinor: Number(l.cgstMinor ?? l.cgst_minor ?? 0),
        sgstMinor: Number(l.sgstMinor ?? l.sgst_minor ?? 0),
        igstMinor: Number(l.igstMinor ?? l.igst_minor ?? 0),
        totalMinor: Number(l.totalMinor ?? l.total_minor ?? 0),
        reason: l.reason,
        restock: Boolean(l.restock),
      })),
      taxableTotalMinor: Number(cn.taxableMinor ?? cn.taxable_minor ?? 0),
      cgstMinor: Number(cn.cgstMinor ?? cn.cgst_minor ?? 0),
      sgstMinor: Number(cn.sgstMinor ?? cn.sgst_minor ?? 0),
      igstMinor: Number(cn.igstMinor ?? cn.igst_minor ?? 0),
      roundOffMinor: Number(cn.roundOffMinor ?? cn.round_off_minor ?? 0),
      totalCreditMinor: Number(cn.totalMinor ?? cn.total_minor ?? 0),
      settlement: {
        duesCleared: allocations.map((a: any) => ({
          invoiceNumber: a.invoiceNumber ?? a.invoice_number,
          amountMinor: Number(a.amountMinor ?? a.amount_minor ?? 0),
        })),
        refund: Number(cn.refundAmountMinor ?? cn.refund_amount_minor ?? 0) > 0 ? {
          amountMinor: Number(cn.refundAmountMinor ?? cn.refund_amount_minor),
          mode: cn.refundMode ?? cn.refund_mode ?? 'cash',
          reference: cn.refundReference ?? cn.refund_reference,
        } : undefined,
        advanceMinor: Number(cn.advanceAmountMinor ?? cn.advance_amount_minor ?? 0),
      },
      isIntraState: Boolean(cn.intra),
      issuedBy: createdByUser?.name,
      note: cn.note,
    };

    const html = renderCreditNoteDoc(printable, { ...DEFAULT_CONFIG.template, paper }, { autoPrint });
    return new HtmlResponse(html);
  });

  // 5. Public hosted credit note page (/c/:token)
  r.get('/c/:token', async (ctx) => {
    const cn = await ctx.db.one(
      `SELECT * FROM invoices WHERE share_token = ? AND kind = 'credit_note'`,
      [ctx.params.token],
    );
    if (!cn) throw notFound('Credit Note not found or link has expired.');

    const shopTenantId = cn.tenantId ?? cn.tenant_id;
    const shop = await ctx.db.one('SELECT * FROM tenants WHERE id = ?', [shopTenantId]);
    if (!shop) throw notFound('Shop');

    const linkedInvoiceId = cn.linkedInvoiceId ?? cn.linked_invoice_id;
    const origInv = linkedInvoiceId ? await ctx.db.one(
      'SELECT id, number, bdate, created_at FROM invoices WHERE id = ?',
      [linkedInvoiceId],
    ) : null;

    const lines = await ctx.db.query(
      'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY pos ASC',
      [cn.id],
    );

    const allocations = await ctx.db.query(
      `SELECT ca.*, i.number AS invoice_number
       FROM credit_allocations ca
       JOIN invoices i ON i.id = ca.invoice_id
       WHERE ca.credit_note_id = ?`,
      [cn.id],
    );

    const createdBy = cn.createdBy ?? cn.created_by;
    const createdByUser = createdBy
      ? await ctx.db.one('SELECT id, name FROM users WHERE id = ?', [createdBy])
      : null;

    const printable: PrintableCreditNote = {
      creditNoteNumber: cn.number,
      creditNoteDateText: new Date(cn.createdAt ?? cn.created_at).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
      originalInvoiceNumber: origInv?.number ?? '—',
      originalInvoiceDateText: origInv ? new Date(origInv.bdate ?? origInv.createdAt ?? origInv.created_at).toLocaleDateString('en-IN') : '—',
      status: cn.status,
      shop: {
        name: shop.name,
        address: shop.address,
        phone: shop.phone,
        gstin: shop.gstin,
        upiId: shop.upiId ?? shop.upi_id,
      },
      customer: (cn.customerName ?? cn.customer_name) ? { name: cn.customerName ?? cn.customer_name, phone: cn.customerPhone ?? cn.customer_phone } : null,
      lines: lines.map((l: any) => ({
        name: l.name,
        hsn: l.hsn,
        unit: l.unit,
        returnQtyMilli: Number(l.qtyMilli ?? l.qty_milli ?? 0),
        priceMinor: Number(l.priceMinor ?? l.price_minor ?? 0),
        taxRateBp: Number(l.taxRateBp ?? l.tax_rate_bp ?? 0),
        taxableMinor: Number(l.taxableMinor ?? l.taxable_minor ?? 0),
        cgstMinor: Number(l.cgstMinor ?? l.cgst_minor ?? 0),
        sgstMinor: Number(l.sgstMinor ?? l.sgst_minor ?? 0),
        igstMinor: Number(l.igstMinor ?? l.igst_minor ?? 0),
        totalMinor: Number(l.totalMinor ?? l.total_minor ?? 0),
        reason: l.reason,
        restock: Boolean(l.restock),
      })),
      taxableTotalMinor: Number(cn.taxableMinor ?? cn.taxable_minor ?? 0),
      cgstMinor: Number(cn.cgstMinor ?? cn.cgst_minor ?? 0),
      sgstMinor: Number(cn.sgstMinor ?? cn.sgst_minor ?? 0),
      igstMinor: Number(cn.igstMinor ?? cn.igst_minor ?? 0),
      roundOffMinor: Number(cn.roundOffMinor ?? cn.round_off_minor ?? 0),
      totalCreditMinor: Number(cn.totalMinor ?? cn.total_minor ?? 0),
      settlement: {
        duesCleared: allocations.map((a: any) => ({
          invoiceNumber: a.invoiceNumber ?? a.invoice_number,
          amountMinor: Number(a.amountMinor ?? a.amount_minor ?? 0),
        })),
        refund: Number(cn.refundAmountMinor ?? cn.refund_amount_minor ?? 0) > 0 ? {
          amountMinor: Number(cn.refundAmountMinor ?? cn.refund_amount_minor),
          mode: cn.refundMode ?? cn.refund_mode ?? 'cash',
          reference: cn.refundReference ?? cn.refund_reference,
        } : undefined,
        advanceMinor: Number(cn.advanceAmountMinor ?? cn.advance_amount_minor ?? 0),
      },
      isIntraState: Boolean(cn.intra),
      issuedBy: createdByUser?.name,
      note: cn.note,
    };

    const html = renderCreditNoteDoc(printable, { ...DEFAULT_CONFIG.template, paper: 'a4' }, { autoPrint: false });
    return new HtmlResponse(html);
  });

  // 6. Track WhatsApp Credit Note sharing
  r.post('/api/credit-notes/:id/whatsapp-track', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const cn = await ctx.db.one(
      `SELECT * FROM invoices WHERE id = ? AND tenant_id = ? AND kind = 'credit_note'`,
      [ctx.params.id, tenantId],
    );
    if (!cn) throw notFound('Credit Note');

    const b = ctx.body ?? {};
    const rawPhone = V.str(b.phone, 'Customer phone', { required: true, max: 30 });
    const normalized = normalizePhone(rawPhone);
    if (!normalized) throw bad('Invalid phone number. Must be a valid 10-digit mobile number.');

    const lang = V.oneOf(b.language ?? 'en', 'Language', ['en', 'hi', 'ta'] as const, 'en');
    const now = new Date().toISOString();
    const sentBy = ctx.user?.id || null;
    const currentCount = Number(cn.whatsappSendCount ?? cn.whatsapp_send_count ?? 0);
    const newCount = currentCount + 1;

    await ctx.db.exec(
      `UPDATE invoices SET
         whatsapp_send_count = COALESCE(whatsapp_send_count, 0) + 1,
         whatsapp_last_sent_at = ?,
         whatsapp_last_sent_to = ?,
         whatsapp_last_language = ?,
         whatsapp_last_sent_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [now, normalized, lang, sentBy, cn.id, tenantId],
    );

    // If requested and linked to customer party, update customer phone
    const cnPartyId = cn.partyId ?? cn.party_id;
    if (b.saveToCustomer && cnPartyId) {
      await ctx.db.exec(
        'UPDATE parties SET phone = ? WHERE id = ? AND tenant_id = ?',
        [normalized, cnPartyId, tenantId],
      );
      await ctx.db.exec(
        'UPDATE invoices SET customer_phone = ? WHERE id = ? AND tenant_id = ?',
        [normalized, cn.id, tenantId],
      );
    }

    await audit(ctx.db, ctx, {
      action: 'credit_note.whatsapp_share',
      entity: 'invoice',
      entityId: cn.id,
      detail: {
        number: cn.number,
        phone: normalized,
        language: lang,
        sendCount: newCount,
      },
    });

    return {
      success: true,
      sendCount: newCount,
      lastSentAt: now,
      lastSentTo: normalized,
      lastLanguage: lang,
    };
  });

  // 7. Void Credit Note (Owner / Manager only with reason)
  r.post('/api/credit-notes/:id/void', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const userRole = ctx.user!.role;

    // RBAC: Voiding moves stock and reverses GST, so voiding is Owner / Manager only (Section 11.2)
    if (userRole !== 'owner' && userRole !== 'manager') {
      throw forbidden('Only Owner or Manager can void a credit note.', 'FORBIDDEN');
    }

    const b = ctx.body ?? {};
    const reason = V.str(b.reason, 'Void reason', { required: true, max: 250 });
    if (!reason.trim()) {
      throw bad('A reason is required to void this credit note.', 'VALIDATION');
    }

    await ctx.db.tx(async (q) => {
      // 1. Lock credit note FOR UPDATE
      const cn = await q.one(
        `SELECT * FROM invoices WHERE id = ? AND tenant_id = ? AND kind = 'credit_note' FOR UPDATE`,
        [ctx.params.id, tenantId],
      );
      if (!cn) throw notFound('Credit Note');
      if (cn.status === 'voided') {
        throw bad('This credit note is already voided.', 'ALREADY_VOIDED');
      }

      // 2. Advance consumed guard (Section 11.3)
      const advanceCreated = Number(cn.advanceAmountMinor ?? cn.advance_amount_minor ?? 0);
      const partyId = cn.partyId ?? cn.party_id;
      if (advanceCreated > 0 && partyId) {
        const party = await q.one(
          'SELECT advance_minor FROM parties WHERE id = ? AND tenant_id = ? FOR UPDATE',
          [partyId, tenantId],
        );
        const currentAdvance = Number(party?.advanceMinor ?? party?.advance_minor ?? 0);
        if (currentAdvance < advanceCreated) {
          const usedMinor = advanceCreated - currentAdvance;
          throw bad(
            `₹${(usedMinor / 100).toFixed(2)} of this credit was already used on subsequent bills. Reverse that usage first.`,
            'ADVANCE_CONSUMED',
          );
        }

        // Reduce advance
        await q.exec(
          `UPDATE parties
           SET advance_minor = advance_minor - ?
           WHERE id = ? AND tenant_id = ?`,
          [advanceCreated, partyId, tenantId],
        );
      }

      // 3. Reverse dues allocations
      const allocations = await q.query(
        'SELECT * FROM credit_allocations WHERE credit_note_id = ? AND tenant_id = ?',
        [cn.id, tenantId],
      );
      for (const a of allocations) {
        const amt = Number(a.amountMinor ?? a.amount_minor ?? 0);
        const targetInvoiceId = a.invoiceId ?? a.invoice_id;
        await q.exec(
          `UPDATE invoices
           SET balance_minor = balance_minor + ?,
               paid_minor = paid_minor - ?
           WHERE id = ? AND tenant_id = ?`,
          [amt, amt, targetInvoiceId, tenantId],
        );
      }

      // 4. Reverse restocked items: take back out of stock via 'adjust' stock move
      const lines = await q.query(
        `SELECT * FROM invoice_lines WHERE invoice_id = ? AND tenant_id = ? AND restock = true AND item_id IS NOT NULL`,
        [cn.id, tenantId],
      );
      for (const l of lines) {
        const qtyMilli = Number(l.qtyMilli ?? l.qty_milli ?? 0);
        const itemId = l.itemId ?? l.item_id;
        await q.exec(
          `INSERT INTO stock_moves (
            id, tenant_id, item_id, location, qty_milli, kind, ref_type, ref_id, user_id, reason, created_at
          ) VALUES (?, ?, ?, 'MAIN', ?, 'adjust', 'credit_note_void', ?, ?, ?, NOW())`,
          [
            newId('sm'),
            tenantId,
            itemId,
            -qtyMilli, // Negative move to take restocked quantity back out
            cn.id,
            ctx.user!.id,
            `Voided Credit Note ${cn.number}: ${reason}`,
          ],
        );
      }

      // 5. Update credit note status to voided
      const now = new Date().toISOString();
      await q.exec(
        `UPDATE invoices SET
           status = 'voided',
           void_reason = ?,
           voided_by = ?,
           voided_at = ?
         WHERE id = ? AND tenant_id = ?`,
        [reason.trim(), ctx.user!.id, now, cn.id, tenantId],
      );

      // 6. Audit
      await audit(q, ctx, {
        action: 'credit_note.void',
        entity: 'invoice',
        entityId: cn.id,
        detail: {
          number: cn.number,
          reason: reason.trim(),
          totalCreditMinor: Number(cn.totalMinor ?? cn.total_minor ?? 0),
        },
      });
    });

    return {
      success: true,
      message: 'Credit note voided successfully.',
    };
  });
}
