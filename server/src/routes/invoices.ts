import { requirePerm, requireUser } from '../auth.ts';
import { bad, notFound, HtmlResponse, V, type Router } from '../http.ts';
import { newId } from '../security.ts';
import { j } from '../db/index.ts';
import { calcBill } from '../../../shared/tax.ts';
import { renderBillDoc, type PrintableBill } from '../../../shared/bill.ts';
import { DEFAULT_CONFIG } from '../../../shared/types.ts';
import { qrSvg, upiUri } from '../../../shared/qr.ts';
import { normalizePhone } from '../../../shared/whatsapp.ts';
import { audit } from '../audit.ts';

export function registerInvoices(r: Router) {
  // List invoices
  r.get('/api/invoices', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const limit = Math.min(100, Math.max(1, Number(ctx.query.limit ?? 50)));
    const q = (ctx.query.q ?? '').trim().toLowerCase();

    let sql = `
      SELECT i.*,
             COALESCE((SELECT json_agg(json_build_object('method', p.method, 'amountMinor', p.amount_minor))
                       FROM payments p WHERE p.invoice_id = i.id), '[]'::json) AS payments,
             COALESCE((SELECT json_agg(json_build_object('id', cn.id, 'number', cn.number, 'totalMinor', cn.total_minor, 'status', cn.status))
                       FROM invoices cn WHERE cn.linked_invoice_id = i.id AND cn.status = 'posted'), '[]'::json) AS credit_notes,
             COALESCE((SELECT SUM(cn.total_minor)
                       FROM invoices cn WHERE cn.linked_invoice_id = i.id AND cn.status = 'posted'), 0)::bigint AS returned_minor,
             COALESCE((SELECT bool_and(
               il.qty_milli <= COALESCE((
                 SELECT SUM(cl.qty_milli)
                 FROM invoice_lines cl
                 JOIN invoices cni ON cni.id = cl.invoice_id
                 WHERE cni.linked_invoice_id = i.id AND cni.status = 'posted' AND (cl.orig_line_id = il.id OR cl.item_id = il.item_id)
               ), 0)
             ) FROM invoice_lines il WHERE il.invoice_id = i.id), false) AS fully_returned
      FROM invoices i
      WHERE i.tenant_id = ?
    `;
    const params: unknown[] = [tenantId];

    if (q) {
      sql += ' AND (lower(i.number) LIKE ? OR lower(COALESCE(i.customer_name, \'\')) LIKE ? OR i.customer_phone LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    sql += ' ORDER BY i.created_at DESC LIMIT ?';
    params.push(limit);

    const rows = await ctx.db.query(sql, params);
    return {
      invoices: rows.map((r: any) => ({
        id: r.id,
        number: r.number,
        kind: r.kind,
        status: r.status,
        bdate: r.bdate,
        partyId: r.partyId ?? r.party_id,
        customerName: r.customerName ?? r.customer_name,
        customerPhone: r.customerPhone ?? r.customer_phone,
        totalMinor: Number(r.totalMinor ?? r.total_minor),
        taxableMinor: Number(r.taxableMinor ?? r.taxable_minor),
        cgstMinor: Number(r.cgstMinor ?? r.cgst_minor),
        sgstMinor: Number(r.sgstMinor ?? r.sgst_minor),
        igstMinor: Number(r.igstMinor ?? r.igst_minor),
        paidMinor: Number(r.paidMinor ?? r.paid_minor),
        balanceMinor: Number(r.balanceMinor ?? r.balance_minor),
        returnedMinor: Number(r.returnedMinor ?? r.returned_minor ?? 0),
        creditNotes: r.creditNotes || r.credit_notes || [],
        fullyReturned: Boolean(r.fullyReturned ?? r.fully_returned),
        linkedInvoiceId: r.linkedInvoiceId ?? r.linked_invoice_id,
        createdAt: r.createdAt ?? r.created_at,
        payments: r.payments || [],
        whatsappSendCount: Number(r.whatsappSendCount ?? r.whatsapp_send_count ?? 0),
        whatsappLastSentAt: r.whatsappLastSentAt ?? r.whatsapp_last_sent_at,
        whatsappLastSentTo: r.whatsappLastSentTo ?? r.whatsapp_last_sent_to,
        whatsappLastLanguage: r.whatsappLastLanguage ?? r.whatsapp_last_language,
        whatsappLastSentBy: r.whatsappLastSentBy ?? r.whatsapp_last_sent_by,
        location: r.location || 'MAIN',
        counter: r.counter || 'COUNTER-1',
        shareToken: r.shareToken ?? r.share_token,
      })),
    };
  });

  // Get invoice details
  r.get('/api/invoices/:id', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const inv = await ctx.db.one('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!inv) throw notFound('Invoice');

    const lines = await ctx.db.query('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY pos ASC', [inv.id]);
    const payments = await ctx.db.query('SELECT * FROM payments WHERE invoice_id = ? ORDER BY created_at ASC', [inv.id]);

    // Fetch linked credit notes (both posted and voided) for Returns zone (Section 4.2)
    const creditNotes = await ctx.db.query(
      `SELECT cn.*,
              u.name AS created_by_name,
              vu.name AS voided_by_name
       FROM invoices cn
       LEFT JOIN users u ON u.id = cn.created_by
       LEFT JOIN users vu ON vu.id = cn.voided_by
       WHERE cn.linked_invoice_id = ? AND cn.tenant_id = ?
       ORDER BY cn.created_at DESC`,
      [inv.id, tenantId],
    );

    let totalReturnedMinor = 0;
    const creditNotesWithDetails = [];
    for (const cn of creditNotes) {
      if (cn.status === 'posted') {
        totalReturnedMinor += Number(cn.totalMinor ?? cn.total_minor ?? 0);
      }
      const cnLines = await ctx.db.query(
        'SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY pos ASC',
        [cn.id],
      );
      const cnAllocations = await ctx.db.query(
        `SELECT ca.*, i.number AS invoice_number
         FROM credit_allocations ca
         JOIN invoices i ON i.id = ca.invoice_id
         WHERE ca.credit_note_id = ?`,
        [cn.id],
      );
      creditNotesWithDetails.push({
        id: cn.id,
        number: cn.number,
        status: cn.status,
        bdate: cn.bdate,
        createdAt: cn.createdAt ?? cn.created_at,
        totalCreditMinor: Number(cn.totalMinor ?? cn.total_minor),
        taxableTotalMinor: Number(cn.taxableMinor ?? cn.taxable_minor),
        cgstMinor: Number(cn.cgstMinor ?? cn.cgst_minor),
        sgstMinor: Number(cn.sgstMinor ?? cn.sgst_minor),
        igstMinor: Number(cn.igstMinor ?? cn.igst_minor),
        roundOffMinor: Number(cn.roundOffMinor ?? cn.round_off_minor),
        advanceAmountMinor: Number(cn.advanceAmountMinor ?? cn.advance_amount_minor ?? 0),
        refundAmountMinor: Number(cn.refundAmountMinor ?? cn.refund_amount_minor ?? 0),
        refundMode: cn.refundMode ?? cn.refund_mode,
        refundReference: cn.refundReference ?? cn.refund_reference,
        createdByName: cn.created_by_name,
        voidReason: cn.voidReason ?? cn.void_reason,
        voidedAt: cn.voidedAt ?? cn.voided_at,
        voidedByName: cn.voided_by_name,
        shareToken: cn.shareToken ?? cn.share_token,
        lines: cnLines.map((l: any) => ({
          id: l.id,
          name: l.name,
          qtyMilli: Number(l.qtyMilli ?? l.qty_milli),
          priceMinor: Number(l.priceMinor ?? l.price_minor),
          totalMinor: Number(l.totalMinor ?? l.total_minor),
          reason: l.reason,
          restock: Boolean(l.restock),
        })),
        allocations: cnAllocations.map((a: any) => ({
          invoiceId: a.invoice_id,
          invoiceNumber: a.invoice_number,
          amountMinor: Number(a.amount_minor),
        })),
      });
    }

    // Check if all lines are fully returned
    let isFullyReturned = lines.length > 0;
    const returnedLines = await ctx.db.query(
      `SELECT il.orig_line_id, il.item_id, il.name, SUM(il.qty_milli)::bigint AS returned_qty_milli
       FROM invoice_lines il
       JOIN invoices cn ON cn.id = il.invoice_id
       WHERE cn.linked_invoice_id = ? AND cn.tenant_id = ? AND cn.status = 'posted'
       GROUP BY il.orig_line_id, il.item_id, il.name`,
      [inv.id, tenantId],
    );
    const retMap = new Map<string, number>();
    for (const rl of returnedLines) {
      const origLineId = rl.origLineId ?? rl.orig_line_id;
      const itemId = rl.itemId ?? rl.item_id;
      const retQty = Number(rl.returnedQtyMilli ?? rl.returned_qty_milli ?? 0);
      if (origLineId) retMap.set(origLineId, (retMap.get(origLineId) ?? 0) + retQty);
      if (itemId) retMap.set(`item:${itemId}`, (retMap.get(`item:${itemId}`) ?? 0) + retQty);
      if (rl.name) retMap.set(`name:${rl.name}`, (retMap.get(`name:${rl.name}`) ?? 0) + retQty);
    }
    for (const l of lines) {
      const billed = Number(l.qtyMilli ?? l.qty_milli ?? 0);
      let ret = 0;
      const itemId = l.itemId ?? l.item_id;
      if (retMap.has(l.id)) ret = retMap.get(l.id)!;
      else if (itemId && retMap.has(`item:${itemId}`)) ret = retMap.get(`item:${itemId}`)!;
      else if (retMap.has(`name:${l.name}`)) ret = retMap.get(`name:${l.name}`)!;
      if (ret < billed) {
        isFullyReturned = false;
        break;
      }
    }

    return {
      fullyReturned: isFullyReturned,
      invoice: {
        ...inv,
        partyId: inv.partyId ?? inv.party_id,
        customerName: inv.customerName ?? inv.customer_name,
        customerPhone: inv.customerPhone ?? inv.customer_phone,
        totalMinor: Number(inv.totalMinor ?? inv.total_minor),
        taxableMinor: Number(inv.taxableMinor ?? inv.taxable_minor),
        cgstMinor: Number(inv.cgstMinor ?? inv.cgst_minor),
        sgstMinor: Number(inv.sgstMinor ?? inv.sgst_minor),
        subtotalMinor: Number(inv.subtotalMinor ?? inv.subtotal_minor),
        roundOffMinor: Number(inv.roundOffMinor ?? inv.round_off_minor),
        paidMinor: Number(inv.paidMinor ?? inv.paid_minor),
        balanceMinor: Number(inv.balanceMinor ?? inv.balance_minor),
        returnedMinor: totalReturnedMinor,
        fullyReturned: isFullyReturned,
        whatsappSendCount: Number(inv.whatsappSendCount ?? inv.whatsapp_send_count ?? 0),
        whatsappLastSentAt: inv.whatsappLastSentAt ?? inv.whatsapp_last_sent_at,
        whatsappLastSentTo: inv.whatsappLastSentTo ?? inv.whatsapp_last_sent_to,
        whatsappLastLanguage: inv.whatsappLastLanguage ?? inv.whatsapp_last_language,
        whatsappLastSentBy: inv.whatsappLastSentBy ?? inv.whatsapp_last_sent_by,
        shareToken: inv.shareToken ?? inv.share_token,
        tender: (typeof inv.custom === 'string' ? JSON.parse(inv.custom || '{}') : (inv.custom || {}))?.tender || null,
      },
      lines: lines.map((l: any) => ({
        id: l.id,
        pos: l.pos,
        name: l.name,
        qtyMilli: Number(l.qtyMilli ?? l.qty_milli),
        priceMinor: Number(l.priceMinor ?? l.price_minor),
        discountMinor: Number(l.discountMinor),
        taxRateBp: Number(l.taxRateBp),
        taxableMinor: Number(l.taxableMinor),
        cgstMinor: Number(l.cgstMinor),
        sgstMinor: Number(l.sgstMinor),
        totalMinor: Number(l.totalMinor),
        unit: l.unit,
        hsn: l.hsn,
      })),
      payments: payments.map((p: any) => ({
        id: p.id,
        method: p.method,
        amountMinor: Number(p.amountMinor),
        reference: p.reference,
        createdAt: p.createdAt,
      })),
      creditNotes: creditNotesWithDetails,
    };
  });

  // Create new bill (POS Checkout)
  r.post('/api/invoices', requirePerm('sell'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;
    const linesInput = V.arr(b.lines, 'Bill items', { min: 1 });
    const paymentsInput = V.arr(b.payments ?? [], 'Payments');
    const customerName = V.optStr(b.customerName, 'Customer name', 100);
    const customerPhone = V.optStr(b.customerPhone, 'Customer phone', 20);
    let partyId = V.optStr(b.partyId, 'Customer party', 50);
    const redeemedPoints = Math.max(0, V.int(b.redeemedPoints ?? 0, 'Redeemed points', { min: 0 }));
    const billDiscountMinor = V.int(b.billDiscountMinor ?? 0, 'Bill discount', { min: 0 });

    const cleanPhoneDigits = customerPhone ? customerPhone.replace(/\D/g, '').slice(-10) : '';
    if (!partyId && cleanPhoneDigits) {
      const match = await ctx.db.one<{ id: string }>(
        `SELECT id FROM parties 
         WHERE tenant_id = ? AND type = 'customer' 
           AND (phone = ? OR REPLACE(phone, ' ', '') LIKE ? OR phone LIKE ?) 
         LIMIT 1`,
        [tenantId, customerPhone, `%${cleanPhoneDigits}`, `%${cleanPhoneDigits}`]
      );
      if (match) partyId = match.id;
    }

    const tenderInput = b.tender;
    let tenderData: { cashReceivedMinor: number; changeReturnedMinor: number } | null = null;
    if (tenderInput && typeof tenderInput === 'object') {
      const cashRec = V.int(tenderInput.cashReceivedMinor ?? 0, 'Cash received', { min: 0 });
      if (cashRec > 0) {
        tenderData = {
          cashReceivedMinor: cashRec,
          changeReturnedMinor: Math.max(0, cashRec - (b.totalMinor ?? 0)),
        };
      }
    }

    const shop = await ctx.db.one('SELECT * FROM tenants WHERE id = ?', [tenantId]);
    if (!shop) throw notFound('Shop');

    const formattedLines = linesInput.map((l: any, i: number) => {
      const name = V.str(l.name, `Item ${i + 1} name`, { required: true, max: 120 });
      const qtyMilli = V.int(l.qtyMilli, `Item ${i + 1} quantity`, { min: 1, required: true });
      const priceMinor = V.int(l.priceMinor, `Item ${i + 1} price`, { min: 0, required: true });
      const discountMinor = V.int(l.discountMinor ?? 0, `Item ${i + 1} discount`, { min: 0 });
      const taxRateBp = V.int(l.taxRateBp ?? 0, `Item ${i + 1} tax rate`, { min: 0, max: 10000 });
      const inclusive = V.bool(l.inclusive, true);
      const itemId = V.optStr(l.itemId, 'Item ID', 50);
      const unit = V.optStr(l.unit, 'Unit', 20);
      const hsn = V.optStr(l.hsn, 'HSN', 20);
      return { name, qtyMilli, priceMinor, discountMinor, taxRateBp, inclusive, itemId, unit, hsn };
    });

    const calculated = calcBill(
      formattedLines.map((l) => ({
        name: l.name,
        qtyMilli: l.qtyMilli,
        priceMinor: l.priceMinor,
        discountMinor: l.discountMinor,
        taxRateBp: l.taxRateBp,
        inclusive: l.inclusive,
      })),
      {
        intraState: b.intra !== undefined ? Boolean(b.intra) : true,
        billDiscountMinor,
        roundTotal: 'rupee',
      },
    );

    const isIntra = b.intra !== undefined ? Boolean(b.intra) : true;
    const invoiceId = newId('inv');
    const shareToken = newId('tok');
    const todayStr = new Date().toISOString().slice(0, 10);

    let assignedNumber = '';
    let totalPaidMinor = 0;
    const location = V.optStr(b.location, 'Location', 50) || ctx.user!.assignedLocation || 'MAIN';
    const counter = V.optStr(b.counter, 'Counter', 50) || ctx.user!.assignedCounter || 'COUNTER-1';
    let earnedLoyaltyPoints = 0;
    let customerLoyaltyPoints: number | null = null;
    let isNewCustomer = false;

    await ctx.db.tx(async (q) => {
      // 0. Auto-enroll new customer if phone was given at counter and party does not exist yet
      if (!partyId && cleanPhoneDigits && cleanPhoneDigits.length >= 7) {
        const existingParty = await q.one<{ id: string }>(
          `SELECT id FROM parties 
           WHERE tenant_id = ? AND type = 'customer' 
             AND (phone = ? OR REPLACE(phone, ' ', '') LIKE ? OR phone LIKE ?) 
           LIMIT 1`,
          [tenantId, (customerPhone || cleanPhoneDigits).trim(), `%${cleanPhoneDigits}`, `%${cleanPhoneDigits}`]
        );
        if (existingParty) {
          partyId = existingParty.id;
        } else {
          isNewCustomer = true;
          const newCustId = newId('p');
          const assignedCustName = (customerName && customerName.trim() && !customerName.toLowerCase().includes('walk-in'))
            ? customerName.trim()
            : `Customer ${cleanPhoneDigits.slice(-4)}`;
          
          await q.exec(
            `INSERT INTO parties (
              id, tenant_id, type, name, phone, state_code, loyalty_points, active, custom
            ) VALUES (?, ?, 'customer', ?, ?, ?, 0, true, '{}'::jsonb)`,
            [newCustId, tenantId, assignedCustName, (customerPhone || cleanPhoneDigits).trim(), shop.stateCode ?? shop.state_code ?? '33']
          );
          partyId = newCustId;
        }
      }

      // 1. Generate sequential invoice number ensuring zero duplicate collisions
      const prefix = shop.invoicePrefix ?? shop.invoice_prefix ?? 'INV';
      while (true) {
        const seriesRow = await q.one<{ assignedNo?: number; assigned_no?: number }>(
          `INSERT INTO number_series (tenant_id, series, next_no)
           VALUES (?, ?, 2)
           ON CONFLICT (tenant_id, series) DO UPDATE SET next_no = number_series.next_no + 1
           RETURNING (next_no - 1) AS assigned_no`,
          [tenantId, prefix],
        );
        const seqNo = Number(seriesRow?.assignedNo ?? seriesRow?.assigned_no ?? 1);
        const candidate = `${prefix}-${1000 + seqNo}`;
        const collision = await q.one<{ id: string }>('SELECT id FROM invoices WHERE tenant_id = ? AND number = ? LIMIT 1', [tenantId, candidate]);
        if (!collision) {
          assignedNumber = candidate;
          break;
        }
      }

      // 2. Payments calculation
      for (const p of paymentsInput) {
        const amt = V.int(p.amountMinor, 'Payment amount', { min: 1 });
        totalPaidMinor += amt;
      }
      const balanceMinor = Math.max(0, calculated.totalMinor - totalPaidMinor);

      // Check for active cashier shift
      const activeShift = await q.one<{ id: string }>(
        "SELECT id FROM shifts WHERE tenant_id = ? AND user_id = ? AND status = 'open' FOR SHARE",
        [tenantId, ctx.user!.id],
      );

      // 3. Insert invoice
      if (tenderData) {
        tenderData.changeReturnedMinor = Math.max(0, tenderData.cashReceivedMinor - calculated.totalMinor);
      }

      const paymentStatus = balanceMinor === 0 ? 'paid' : (totalPaidMinor > 0 ? 'partial' : 'unpaid');

      await q.exec(
        `INSERT INTO invoices (
          id, tenant_id, client_id, number, kind, status, bdate, party_id,
          customer_name, customer_phone, party_name, party_phone, place_state, intra,
          subtotal_minor, discount_minor, taxable_minor, cgst_minor, sgst_minor, igst_minor,
          round_off_minor, rounding_minor, total_minor,
          paid_minor, balance_minor, payment_status, rule_version, calc, share_token, created_by, location, counter, shift_id, custom
        ) VALUES (
          ?, ?, ?, ?, 'sale', 'posted', ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, '1.0', ?::jsonb, ?, ?, ?, ?, ?, ?::jsonb
        )`,
        [
          invoiceId,
          tenantId,
          newId('cid'),
          assignedNumber,
          todayStr,
          partyId || null,
          customerName || null,
          customerPhone || null,
          customerName || null,
          customerPhone || null,
          b.placeState || '33',
          isIntra,
          calculated.subtotalMinor,
          billDiscountMinor,
          calculated.taxableMinor,
          calculated.cgstMinor,
          calculated.sgstMinor,
          calculated.igstMinor,
          calculated.roundOffMinor,
          calculated.roundOffMinor,
          calculated.totalMinor,
          totalPaidMinor,
          balanceMinor,
          paymentStatus,
          j(calculated),
          shareToken,
          ctx.user!.id,
          location,
          counter,
          activeShift?.id || null,
          j(tenderData ? { tender: tenderData } : {}),
        ],
      );

      // 4. Insert lines and update inventory
      for (let i = 0; i < formattedLines.length; i++) {
        const item = formattedLines[i];
        const calcL = calculated.lines[i];
        const lineId = newId('inl');

        await q.exec(
          `INSERT INTO invoice_lines (
            id, tenant_id, invoice_id, pos, item_id, name, hsn, unit,
            qty_milli, price_minor, discount_minor, tax_rate_bp, inclusive,
            taxable_minor, cgst_minor, sgst_minor, igst_minor, total_minor
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            lineId,
            tenantId,
            invoiceId,
            i + 1,
            item.itemId || null,
            item.name,
            item.hsn || null,
            item.unit || null,
            item.qtyMilli,
            item.priceMinor,
            calcL.discountMinor,
            item.taxRateBp,
            item.inclusive,
            calcL.taxableMinor,
            calcL.cgstMinor,
            calcL.sgstMinor,
            calcL.igstMinor,
            calcL.totalMinor,
          ],
        );

        // Deduct inventory at the sale's branch location (verifying item exists to prevent foreign key errors)
        if (item.itemId) {
          const itemExists = await q.one('SELECT id FROM items WHERE id = ? AND tenant_id = ? LIMIT 1', [item.itemId, tenantId]);
          if (itemExists) {
            await q.exec(
              `INSERT INTO stock_moves (id, tenant_id, item_id, location, qty_milli, kind, ref_type, ref_id, user_id)
               VALUES (?, ?, ?, ?, ?, 'sale', 'invoice', ?, ?)`,
              [newId('sm'), tenantId, item.itemId, location, -item.qtyMilli, invoiceId, ctx.user!.id],
            );
          }
        }
      }

      // 5. Insert payments
      for (const p of paymentsInput) {
        const amt = V.int(p.amountMinor, 'Payment amount', { min: 1 });
        const rawMethod = (p.method ?? p.mode ?? 'cash').toLowerCase();
        const method = V.oneOf(rawMethod, 'Payment method', ['cash', 'upi', 'card', 'bank', 'advance'] as const, 'cash');

        if (method === 'advance') {
          if (!partyId) {
            throw bad('Customer party required to use customer advance payment.');
          }
          const party = await q.one('SELECT advance_minor FROM parties WHERE id = ? AND tenant_id = ? FOR UPDATE', [partyId, tenantId]);
          const currentAdv = Number(party?.advanceMinor ?? party?.advance_minor ?? 0);
          if (currentAdv < amt) {
            throw bad(`Insufficient customer advance. Available: ₹${(currentAdv / 100).toFixed(2)}, Requested: ₹${(amt / 100).toFixed(2)}`);
          }
          await q.exec(
            'UPDATE parties SET advance_minor = advance_minor - ? WHERE id = ? AND tenant_id = ?',
            [amt, partyId, tenantId],
          );
        }

        await q.exec(
          `INSERT INTO payments (id, tenant_id, kind, method, mode, amount_minor, invoice_id, party_id, reference, shift_id, bdate, created_by, location, counter)
           VALUES (?, ?, 'receipt', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [newId('pay'), tenantId, method, method, amt, invoiceId, partyId || null, p.reference || null, activeShift?.id || null, todayStr, ctx.user!.id, location, counter],
        );

        if (method === 'card' && p.reference) {
          const rrnMatch = p.reference.match(/RRN:([^\s|]+)/i);
          if (rrnMatch && rrnMatch[1]) {
            await q.exec(
              `UPDATE terminal_transactions
               SET invoice_id = ?
               WHERE tenant_id = ? AND (provider_ref_no = ? OR provider_tx_id = ?) AND invoice_id IS NULL`,
              [invoiceId, tenantId, rrnMatch[1], rrnMatch[1]],
            );
          }
        }
      }

      // 6. Customer loyalty points calculation & update based on shop's custom rule
      if (partyId) {
        const isLoyaltyActive = Boolean(shop.loyaltyEnabled ?? shop.loyalty_enabled ?? true);
        const ptsPer100 = Number(shop.loyaltyPointsPer100 ?? shop.loyalty_points_per_100 ?? 10);
        const minRedeem = Number(shop.loyaltyMinPointsRedeem ?? shop.loyalty_min_points_redeem ?? 10);

        if (isLoyaltyActive && ptsPer100 > 0) {
          // calculated.totalMinor is in paise (₹100 = 10,000 paise)
          earnedLoyaltyPoints = Math.floor((calculated.totalMinor * ptsPer100) / 10000);
        } else {
          earnedLoyaltyPoints = 0;
        }

        if (redeemedPoints > 0) {
          if (!isLoyaltyActive) {
            throw bad('Loyalty rewards program is currently disabled for this store.');
          }
          const custParty = await q.one<{ loyalty_points: number; loyaltyPoints: number }>(
            'SELECT loyalty_points FROM parties WHERE id = ? AND tenant_id = ? FOR UPDATE',
            [partyId, tenantId]
          );
          const currentPts = Number(custParty?.loyaltyPoints ?? custParty?.loyalty_points ?? 0);
          if (currentPts < minRedeem) {
            throw bad(`Minimum ${minRedeem} points required to redeem (customer has ${currentPts} points).`);
          }
          if (currentPts < redeemedPoints) {
            throw bad(`Insufficient loyalty points. Customer has ${currentPts} points, requested to redeem ${redeemedPoints}.`);
          }
        }

        const updatedCust = await q.one<{ loyalty_points?: number; loyaltyPoints?: number }>(
          `UPDATE parties
           SET loyalty_points = GREATEST(0, loyalty_points - ? + ?)
           WHERE id = ? AND tenant_id = ?
           RETURNING loyalty_points`,
          [redeemedPoints, earnedLoyaltyPoints, partyId, tenantId]
        );
        customerLoyaltyPoints = Number(updatedCust?.loyaltyPoints ?? updatedCust?.loyalty_points ?? 0);
      }

      await audit(q, ctx, {
        action: 'invoice.create',
        entity: 'invoice',
        entityId: invoiceId,
        detail: {
          number: assignedNumber,
          totalMinor: calculated.totalMinor,
          lines: formattedLines.length,
          earnedLoyaltyPoints,
          redeemedPoints,
        },
      });
    });

    return {
      id: invoiceId,
      invoiceId,
      number: assignedNumber,
      totalMinor: calculated.totalMinor,
      paidMinor: totalPaidMinor,
      balanceMinor: Math.max(0, calculated.totalMinor - totalPaidMinor),
      location,
      counter,
      shareToken,
      tender: tenderData,
      earnedLoyaltyPoints,
      redeemedLoyaltyPoints: redeemedPoints,
      customerLoyaltyPoints,
      partyId,
      isNewCustomer,
    };
  });

  // Print Bill (HTML Thermal / A4 receipt)
  r.get('/api/invoices/:id/print', async (ctx) => {
    const inv = await ctx.db.one('SELECT * FROM invoices WHERE id = ?', [ctx.params.id]);
    if (!inv) throw notFound('Invoice');

    const shop = await ctx.db.one('SELECT * FROM tenants WHERE id = ?', [inv.tenantId ?? inv.tenant_id]);
    if (!shop) throw notFound('Shop');

    const lines = await ctx.db.query(
      `SELECT il.*, it.custom AS item_custom
       FROM invoice_lines il
       LEFT JOIN items it ON it.id = il.item_id
       WHERE il.invoice_id = ?
       ORDER BY il.pos ASC`,
      [inv.id],
    );
    const payments = await ctx.db.query('SELECT * FROM payments WHERE invoice_id = ? ORDER BY created_at ASC', [inv.id]);

    const paper = (ctx.query.paper === 'a4' || ctx.query.paper === 'thermal58') ? ctx.query.paper : 'thermal80';
    const autoPrint = ctx.query.autoprint === 'true';

    const custName = inv.customerName ?? inv.customer_name;
    const custPhone = inv.customerPhone ?? inv.customer_phone;
    const createdAt = inv.createdAt ?? inv.created_at;
    const customObj = typeof inv.custom === 'string' ? JSON.parse(inv.custom || '{}') : (inv.custom || {});
    const tender = customObj?.tender || null;

    const customFields: { label: string; value: string }[] = [];
    const pId = inv.partyId ?? inv.party_id;
    if (pId) {
      const custRow = await ctx.db.one<{ loyalty_points?: number; loyaltyPoints?: number }>(
        'SELECT loyalty_points FROM parties WHERE id = ?',
        [pId]
      );
      const pts = Number(custRow?.loyaltyPoints ?? custRow?.loyalty_points ?? 0);
      if (pts > 0) {
        customFields.push({ label: '⭐ Loyalty Balance', value: `${pts} pts` });
      }
    }
    const invCounter = inv.counter || customObj?.counter;
    if (invCounter) {
      customFields.push({ label: 'Counter', value: String(invCounter) });
    }

    const printable: PrintableBill = {
      number: inv.number,
      kind: 'sale',
      dateText: new Date(createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }),
      shop: {
        name: shop.name,
        address: shop.address,
        phone: shop.phone,
        gstin: shop.gstin,
        upiId: shop.upiId ?? shop.upi_id,
        logoUrl: shop.logoUrl ?? shop.logo_url ?? null,
      },
      customer: custName ? { name: custName, phone: custPhone } : null,
      lines: lines.map((l: any) => {
        let mrpMinor = 0;
        try {
          const itemCustom = typeof l.itemCustom === 'string' ? JSON.parse(l.itemCustom) : (l.itemCustom || {});
          if (typeof itemCustom.mrpMinor === 'number' && itemCustom.mrpMinor > 0) {
            mrpMinor = itemCustom.mrpMinor;
          } else if (typeof itemCustom.mrp_minor === 'number' && itemCustom.mrp_minor > 0) {
            mrpMinor = itemCustom.mrp_minor;
          }
        } catch {}

        const priceMinor = Number(l.priceMinor ?? l.price_minor);
        const discountMinor = Number(l.discountMinor ?? l.discount_minor);
        const qtyMilli = Number(l.qtyMilli ?? l.qty_milli);
        const discountPerUnit = qtyMilli > 0 ? Math.round((discountMinor * 1000) / qtyMilli) : 0;
        if (!mrpMinor || mrpMinor <= priceMinor) {
          if (discountPerUnit > 0) {
            mrpMinor = priceMinor + discountPerUnit;
          } else {
            mrpMinor = Math.max(priceMinor, Math.ceil((priceMinor * 1.15) / 100) * 100);
          }
        }

        return {
          name: l.name,
          hsn: l.hsn,
          unit: l.unit,
          qtyMilli,
          priceMinor,
          mrpMinor,
          discountMinor,
          taxRateBp: Number(l.taxRateBp ?? l.tax_rate_bp),
          taxableMinor: Number(l.taxableMinor ?? l.taxable_minor),
          cgstMinor: Number(l.cgstMinor ?? l.cgst_minor),
          sgstMinor: Number(l.sgstMinor ?? l.sgst_minor),
          igstMinor: Number(l.igstMinor ?? l.igst_minor),
          totalMinor: Number(l.totalMinor ?? l.total_minor),
        };
      }),
      totals: {
        subtotalMinor: Number(inv.subtotalMinor ?? inv.subtotal_minor),
        discountMinor: Number(inv.discountMinor ?? inv.discount_minor),
        taxableMinor: Number(inv.taxableMinor ?? inv.taxable_minor),
        cgstMinor: Number(inv.cgstMinor ?? inv.cgst_minor),
        sgstMinor: Number(inv.sgstMinor ?? inv.sgst_minor),
        igstMinor: Number(inv.igstMinor ?? inv.igst_minor),
        roundOffMinor: Number(inv.roundOffMinor ?? inv.round_off_minor),
        totalMinor: Number(inv.totalMinor ?? inv.total_minor),
        paidMinor: Number(inv.paidMinor ?? inv.paid_minor),
        balanceMinor: Number(inv.balanceMinor ?? inv.balance_minor),
      },
      payments: payments.map((p: any) => ({ method: p.method, amountMinor: Number(p.amountMinor ?? p.amount_minor) })),
      tender,
      customFields,
      intra: true,
    };

    let qrSvgMarkup = '';
    const upiId = shop.upiId ?? shop.upi_id;
    if (upiId) {
      const upi = upiUri({ vpa: upiId, name: shop.name, amountMinor: printable.totals.totalMinor, note: `Bill ${inv.number}` });
      qrSvgMarkup = qrSvg(upi, { size: 120 });
    }

    const html = renderBillDoc(printable, { ...DEFAULT_CONFIG.template, paper }, { qrSvg: qrSvgMarkup, qrCaption: 'Scan UPI to pay', autoPrint });
    return new HtmlResponse(html);
  });

  // Track WhatsApp bill share
  r.post('/api/invoices/:id/whatsapp-track', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const inv = await ctx.db.one('SELECT * FROM invoices WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!inv) throw notFound('Invoice');

    const b = ctx.body ?? {};
    const rawPhone = V.str(b.phone, 'Customer phone', { required: true, max: 30 });
    const normalized = normalizePhone(rawPhone);
    if (!normalized) throw bad('Invalid phone number. Must be a valid 10-digit mobile number.');

    const lang = V.oneOf(b.language ?? 'en', 'Language', ['en', 'hi', 'ta'] as const, 'en');
    const saveToCustomer = Boolean(b.saveToCustomer);
    const now = new Date().toISOString();
    const sentBy = ctx.user?.id || null;
    const newCount = Number(inv.whatsapp_send_count ?? inv.whatsappSendCount ?? 0) + 1;

    await ctx.db.exec(
      `UPDATE invoices SET
         whatsapp_send_count = COALESCE(whatsapp_send_count, 0) + 1,
         whatsapp_last_sent_at = ?,
         whatsapp_last_sent_to = ?,
         whatsapp_last_language = ?,
         whatsapp_last_sent_by = ?
       WHERE id = ? AND tenant_id = ?`,
      [now, normalized, lang, sentBy, inv.id, tenantId]
    );

    // If requested and invoice is linked to a customer party, save/update phone on customer master
    const partyId = inv.partyId ?? inv.party_id;
    if (saveToCustomer && partyId) {
      await ctx.db.exec(
        `UPDATE parties SET phone = ? WHERE id = ? AND tenant_id = ?`,
        [normalized, partyId, tenantId]
      );
      await ctx.db.exec(
        `UPDATE invoices SET customer_phone = ? WHERE id = ? AND tenant_id = ?`,
        [normalized, inv.id, tenantId]
      );
    }

    await audit(ctx.db, ctx, {
      action: 'invoice.whatsapp_share',
      entity: 'invoice',
      entityId: inv.id,
      detail: {
        number: inv.number,
        phone: normalized,
        language: lang,
        sendCount: newCount,
        saveToCustomer,
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

  // Public Hosted Bill Link (/b/:token)
  r.get('/b/:token', async (ctx) => {
    const inv = await ctx.db.one('SELECT * FROM invoices WHERE share_token = ?', [ctx.params.token]);
    if (!inv) throw notFound('Bill not found or link has expired.');

    const shop = await ctx.db.one('SELECT * FROM tenants WHERE id = ?', [inv.tenantId ?? inv.tenant_id]);
    if (!shop) throw notFound('Shop');

    const lines = await ctx.db.query(
      `SELECT il.*, it.custom AS item_custom
       FROM invoice_lines il
       LEFT JOIN items it ON it.id = il.item_id
       WHERE il.invoice_id = ?
       ORDER BY il.pos ASC`,
      [inv.id],
    );
    const payments = await ctx.db.query('SELECT * FROM payments WHERE invoice_id = ? ORDER BY created_at ASC', [inv.id]);

    const custName = inv.customerName ?? inv.customer_name;
    const custPhone = inv.customerPhone ?? inv.customer_phone;
    const createdAt = inv.createdAt ?? inv.created_at;
    const customObj = typeof inv.custom === 'string' ? JSON.parse(inv.custom || '{}') : (inv.custom || {});
    const tender = customObj?.tender || null;

    const printable: PrintableBill = {
      number: inv.number,
      kind: 'sale',
      dateText: new Date(createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }),
      shop: {
        name: shop.name,
        address: shop.address,
        phone: shop.phone,
        gstin: shop.gstin,
        upiId: shop.upiId ?? shop.upi_id,
        logoUrl: shop.logoUrl ?? shop.logo_url ?? null,
      },
      customer: custName ? { name: custName, phone: custPhone } : null,
      lines: lines.map((l: any) => {
        let mrpMinor = 0;
        try {
          const itemCustom = typeof l.itemCustom === 'string' ? JSON.parse(l.itemCustom) : (l.itemCustom || {});
          if (typeof itemCustom.mrpMinor === 'number' && itemCustom.mrpMinor > 0) {
            mrpMinor = itemCustom.mrpMinor;
          } else if (typeof itemCustom.mrp_minor === 'number' && itemCustom.mrp_minor > 0) {
            mrpMinor = itemCustom.mrp_minor;
          }
        } catch {}

        const priceMinor = Number(l.priceMinor ?? l.price_minor);
        const discountMinor = Number(l.discountMinor ?? l.discount_minor);
        const qtyMilli = Number(l.qtyMilli ?? l.qty_milli);
        const discountPerUnit = qtyMilli > 0 ? Math.round((discountMinor * 1000) / qtyMilli) : 0;
        if (!mrpMinor || mrpMinor <= priceMinor) {
          if (discountPerUnit > 0) {
            mrpMinor = priceMinor + discountPerUnit;
          } else {
            mrpMinor = Math.max(priceMinor, Math.ceil((priceMinor * 1.15) / 100) * 100);
          }
        }

        return {
          name: l.name,
          hsn: l.hsn,
          unit: l.unit,
          qtyMilli,
          priceMinor,
          mrpMinor,
          discountMinor,
          taxRateBp: Number(l.taxRateBp ?? l.tax_rate_bp),
          taxableMinor: Number(l.taxableMinor ?? l.taxable_minor),
          cgstMinor: Number(l.cgstMinor ?? l.cgst_minor),
          sgstMinor: Number(l.sgstMinor ?? l.sgst_minor),
          igstMinor: Number(l.igstMinor ?? l.igst_minor),
          totalMinor: Number(l.totalMinor ?? l.total_minor),
        };
      }),
      totals: {
        subtotalMinor: Number(inv.subtotalMinor ?? inv.subtotal_minor),
        discountMinor: Number(inv.discountMinor ?? inv.discount_minor),
        taxableMinor: Number(inv.taxableMinor ?? inv.taxable_minor),
        cgstMinor: Number(inv.cgstMinor ?? inv.cgst_minor),
        sgstMinor: Number(inv.sgstMinor ?? inv.sgst_minor),
        igstMinor: Number(inv.igstMinor ?? inv.igst_minor),
        roundOffMinor: Number(inv.roundOffMinor ?? inv.round_off_minor),
        totalMinor: Number(inv.totalMinor ?? inv.total_minor),
        paidMinor: Number(inv.paidMinor ?? inv.paid_minor),
        balanceMinor: Number(inv.balanceMinor ?? inv.balance_minor),
      },
      payments: payments.map((p: any) => ({ method: p.method, amountMinor: Number(p.amountMinor ?? p.amount_minor) })),
      tender,
      customFields: [],
      intra: true,
    };

    let qrSvgMarkup = '';
    const upiId = shop.upiId ?? shop.upi_id;
    if (upiId && printable.totals.balanceMinor > 0) {
      const upi = upiUri({ vpa: upiId, name: shop.name, amountMinor: printable.totals.balanceMinor, note: `Bill ${inv.number}` });
      qrSvgMarkup = qrSvg(upi, { size: 120 });
    }

    const html = renderBillDoc(printable, { ...DEFAULT_CONFIG.template, paper: 'a4' }, { qrSvg: qrSvgMarkup, qrCaption: 'Scan UPI to pay balance', autoPrint: false });
    return new HtmlResponse(html);
  });
}
