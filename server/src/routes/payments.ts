import { requirePerm, requireUser } from '../auth.ts';
import { bad, forbidden, notFound, HtmlResponse, V, type Router } from '../http.ts';
import { newId } from '../security.ts';
import { audit } from '../audit.ts';
import { can } from '../../../shared/types.ts';
import { normalizePhone } from '../../../shared/whatsapp.ts';
import { qrSvg, upiUri } from '../../../shared/qr.ts';
import { DEFAULT_CONFIG } from '../../../shared/types.ts';
import {
  renderPaymentReceiptDoc,
  renderCustomerStatementDoc,
  type PrintablePaymentReceipt,
  type PrintableCustomerStatement,
  type PrintableReceiptAllocation,
} from '../../../shared/bill.ts';

const VALID_MODES = ['cash', 'upi', 'card', 'bank', 'cheque'] as const;
type PaymentMode = (typeof VALID_MODES)[number];

export function registerPayments(r: Router) {
  // 1. Create a customer payment collection
  r.post('/api/payments', requirePerm('collect'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;

    // Idempotency check: if already processed for this tenant, return existing record
    const idempotencyKey = V.optStr(b.idempotencyKey, 'Idempotency key', 128);
    if (idempotencyKey) {
      const existing = await ctx.db.one(
        'SELECT * FROM payments WHERE tenant_id = ? AND idempotency_key = ?',
        [tenantId, idempotencyKey],
      );
      if (existing) {
        const allocations = await ctx.db.query(
          `SELECT pa.*, i.number AS invoice_number, i.bdate AS invoice_date
           FROM payment_allocations pa
           JOIN invoices i ON i.id = pa.invoice_id
           WHERE pa.payment_id = ? AND pa.tenant_id = ?
           ORDER BY i.bdate ASC, i.created_at ASC`,
          [existing.id, tenantId],
        );
        return {
          idempotent: true,
          payment: formatPaymentWithAllocations(existing, allocations),
        };
      }
    }

    // Input validation
    const customerId = V.str(b.customerId, 'Customer ID', { required: true });
    const amountMinor = V.int(b.amountMinor, 'Amount received (paise)', { min: 1 });
    if (amountMinor <= 0) {
      throw bad('Enter an amount greater than zero.', 'VALIDATION', { field: 'amountMinor' });
    }

    const mode = V.oneOf(b.mode, 'Payment mode', VALID_MODES, 'cash');
    const referenceNo = V.optStr(b.referenceNo, 'Reference / UTR / Cheque number', 100);
    const note = V.optStr(b.note, 'Note', 200);

    // Payment date handling and backdating check
    let paymentDate = new Date();
    if (b.paymentDate) {
      const parsed = new Date(b.paymentDate);
      if (isNaN(parsed.getTime())) {
        throw bad('Invalid payment date', 'VALIDATION', { field: 'paymentDate' });
      }
      // Future date check (allow up to 2 minutes clock skew)
      if (parsed.getTime() > Date.now() + 120000) {
        throw bad('Payment date cannot be in the future.', 'VALIDATION', { field: 'paymentDate' });
      }

      // Backdated check: compare calendar dates in Asia/Kolkata
      const todayKolkata = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const paymentDateKolkata = parsed.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      if (paymentDateKolkata < todayKolkata) {
        // Backdating allowed for Owner, Manager, Accountant; blocked for Cashier
        if (!can(ctx.user!.role, 'payments.backdate')) {
          throw forbidden('Cashiers cannot record backdated payments. Only Owner, Manager or Accountant can.', 'FORBIDDEN');
        }
      }
      paymentDate = parsed;
    }

    // Manual allocation request if sent
    const requestedAllocations: { invoiceId: string; amountMinor: number }[] = Array.isArray(b.allocations)
      ? b.allocations.map((a: any) => ({
          invoiceId: String(a.invoiceId),
          amountMinor: Math.max(0, Math.floor(Number(a.amountMinor) || 0)),
        }))
      : [];

    let savedPayment: any = null;
    let savedAllocations: any[] = [];
    let infoMessage: string | null = null;
    let balanceAfterMinor = 0;

    await ctx.db.tx(async (q) => {
      // 1. Lock customer party
      const party = await q.one(
        'SELECT * FROM parties WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [customerId, tenantId],
      );
      if (!party) throw notFound('Customer');

      // 2. Lock and fetch all posted unpaid/part-paid invoices for this customer
      const unpaidInvoices = await q.query(
        `SELECT id, number, bdate, total_minor, balance_minor, paid_minor
         FROM invoices
         WHERE tenant_id = ? AND party_id = ? AND status = 'posted' AND balance_minor > 0
         ORDER BY bdate ASC, created_at ASC
         FOR UPDATE`,
        [tenantId, customerId],
      );

      let remainingAmount = amountMinor;
      const plannedAllocations: { invoiceId: string; amountMinor: number; invoiceNumber: string; invoiceDate: string }[] = [];

      if (requestedAllocations.length > 0) {
        // Manual allocation override
        const invoiceMap = new Map(unpaidInvoices.map((i: any) => [i.id, i]));
        for (const req of requestedAllocations) {
          if (remainingAmount <= 0) break;
          const inv = invoiceMap.get(req.invoiceId);
          if (!inv) {
            // Check if user submitted an invoice ID belonging to another tenant or customer
            const foreignInv = await q.one(
              'SELECT party_id, tenant_id FROM invoices WHERE id = ?',
              [req.invoiceId],
            );
            if (foreignInv && (foreignInv.tenant_id !== tenantId || foreignInv.party_id !== customerId)) {
              throw bad('Invalid invoice allocation for this customer or business', 'VALIDATION');
            }
            infoMessage = 'One or more bills were already settled or cancelled; remaining amount applied to next dues or advance.';
            continue;
          }

          const currentBal = Number(inv.balance_minor ?? inv.balanceMinor);
          const amtToAllocate = Math.min(req.amountMinor, currentBal, remainingAmount);
          if (amtToAllocate > 0) {
            plannedAllocations.push({
              invoiceId: inv.id,
              amountMinor: amtToAllocate,
              invoiceNumber: inv.number,
              invoiceDate: inv.bdate,
            });
            remainingAmount -= amtToAllocate;
            inv.balance_minor = currentBal - amtToAllocate;
          }
        }
      } else {
        // Default oldest-first allocation
        for (const inv of unpaidInvoices) {
          if (remainingAmount <= 0) break;
          const currentBal = Number(inv.balance_minor ?? inv.balanceMinor);
          if (currentBal <= 0) continue;
          const amtToAllocate = Math.min(remainingAmount, currentBal);
          if (amtToAllocate > 0) {
            plannedAllocations.push({
              invoiceId: inv.id,
              amountMinor: amtToAllocate,
              invoiceNumber: inv.number,
              invoiceDate: inv.bdate,
            });
            remainingAmount -= amtToAllocate;
            inv.balance_minor = currentBal - amtToAllocate;
          }
        }
      }

      // Any remaining amount becomes advance
      const advanceMinor = remainingAmount > 0 ? remainingAmount : 0;

      // 3. Update invoice balances
      for (const alloc of plannedAllocations) {
        await q.exec(
          `UPDATE invoices
           SET balance_minor = balance_minor - ?,
               paid_minor = paid_minor + ?
           WHERE id = ? AND tenant_id = ?`,
          [alloc.amountMinor, alloc.amountMinor, alloc.invoiceId, tenantId],
        );
      }

      // 4. Update customer advance if created
      if (advanceMinor > 0) {
        await q.exec(
          `UPDATE parties
           SET advance_minor = advance_minor + ?
           WHERE id = ? AND tenant_id = ?`,
          [advanceMinor, customerId, tenantId],
        );
      }

      // 5. Generate sequential receipt number from number_series
      const seriesRow = await q.one<{ assignedNo?: number; assigned_no?: number }>(
        `INSERT INTO number_series (tenant_id, series, next_no)
         VALUES (?, 'RCT', 2)
         ON CONFLICT (tenant_id, series) DO UPDATE SET next_no = number_series.next_no + 1
         RETURNING (next_no - 1) AS assigned_no`,
        [tenantId],
      );
      const seqNo = Number(seriesRow?.assignedNo ?? seriesRow?.assigned_no ?? 1);
      const receiptNumber = `RCT-${1000 + seqNo}`;

      // 6. Generate share token & check active cashier shift
      const shareToken = newId('tok');
      const paymentId = newId('pay');
      const activeShift = await q.one<{ id: string }>(
        "SELECT id FROM shifts WHERE tenant_id = ? AND user_id = ? AND status = 'open' FOR SHARE",
        [tenantId, ctx.user!.id],
      );

      // 7. Insert payment record
      await q.exec(
        `INSERT INTO payments (
          id, tenant_id, client_id, customer_id, party_id, receipt_number, amount_minor,
          mode, method, reference_no, reference, shift_id, payment_date, bdate, note, received_by, created_by,
          advance_minor, status, idempotency_key, share_token, kind, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, 'receipt', NOW())`,
        [
          paymentId,
          tenantId,
          (b.clientId as string) ?? null,
          customerId,
          customerId,
          receiptNumber,
          amountMinor,
          mode,
          mode, // method synced for compatibility
          referenceNo,
          referenceNo,
          activeShift?.id || null,
          paymentDate.toISOString(),
          paymentDate.toISOString().slice(0, 10),
          note,
          ctx.user!.id,
          ctx.user!.id,
          advanceMinor,
          idempotencyKey ?? null,
          shareToken,
        ],
      );

      // 8. Insert payment allocations
      for (const alloc of plannedAllocations) {
        const allocId = newId('pa');
        await q.exec(
          `INSERT INTO payment_allocations (
            id, tenant_id, payment_id, invoice_id, customer_id, amount_minor, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
          [allocId, tenantId, paymentId, alloc.invoiceId, customerId, alloc.amountMinor],
        );
      }

      // 9. Record audit
      await audit(q, ctx, {
        action: 'payment.collect',
        entity: 'payment',
        entityId: paymentId,
        detail: {
          receiptNumber,
          customerId,
          amountMinor,
          mode,
          referenceNo,
          advanceMinor,
          allocationsCount: plannedAllocations.length,
        },
      });

      // 10. Compute balance after payment
      const duesRow = await q.one<{ remainingDues: number }>(
        `SELECT COALESCE(SUM(balance_minor), 0)::bigint - (SELECT advance_minor FROM parties WHERE id = ?) AS remaining_dues
         FROM invoices
         WHERE tenant_id = ? AND party_id = ? AND status = 'posted'`,
        [customerId, tenantId, customerId],
      );
      balanceAfterMinor = Math.max(0, Number(duesRow?.remainingDues ?? 0));

      savedPayment = await q.one('SELECT * FROM payments WHERE id = ? AND tenant_id = ?', [paymentId, tenantId]);
      savedAllocations = plannedAllocations.map((a) => ({
        invoiceId: a.invoiceId,
        invoiceNumber: a.invoiceNumber,
        invoiceDate: a.invoiceDate,
        amountMinor: a.amountMinor,
      }));
    });

    return {
      payment: formatPaymentWithAllocations(savedPayment, savedAllocations, balanceAfterMinor),
      infoMessage,
    };
  });

  // 2. Customer Dues Overview (dues, advance, unpaid invoices list)
  const getCustomerDues = async (ctx: any) => {
    const tenantId = ctx.user!.tenantId;
    const customerId = ctx.params.id;

    const party = await ctx.db.one('SELECT * FROM parties WHERE id = ? AND tenant_id = ?', [customerId, tenantId]);
    if (!party) throw notFound('Customer');

    const advanceMinor = Number(party.advanceMinor ?? party.advance_minor ?? 0);

    // List unpaid / part-paid posted invoices
    const unpaidInvoices = await ctx.db.query(
      `SELECT id, number, bdate, total_minor, paid_minor, balance_minor, created_at
       FROM invoices
       WHERE tenant_id = ? AND party_id = ? AND status = 'posted' AND balance_minor > 0
       ORDER BY bdate ASC, created_at ASC`,
      [tenantId, customerId],
    );

    const totalUnpaidMinor = unpaidInvoices.reduce((sum: number, r: any) => sum + Number(r.balanceMinor ?? r.balance_minor ?? 0), 0);
    const totalDuesMinor = Math.max(0, totalUnpaidMinor - advanceMinor);

    // Lifetime billing and collection metrics
    const stats: any = await ctx.db.one(
      `SELECT
        (SELECT COALESCE(SUM(total_minor), 0)::bigint FROM invoices WHERE tenant_id = ? AND party_id = ? AND status = 'posted') AS total_billed,
        (SELECT COALESCE(SUM(amount_minor), 0)::bigint FROM payments WHERE tenant_id = ? AND customer_id = ? AND (status IS NULL OR status = 'posted')) AS total_collected`,
      [tenantId, customerId, tenantId, customerId],
    );

    const oldestInvoiceDate = unpaidInvoices.length > 0 ? (unpaidInvoices[0].bdate ?? unpaidInvoices[0].createdAt) : null;

    return {
      party: {
        id: party.id,
        name: party.name,
        phone: party.phone,
        gstin: party.gstin,
        advanceMinor,
        duesMinor: totalDuesMinor,
      },
      totalDuesMinor,
      totalAdvanceMinor: advanceMinor,
      totalUnpaidMinor,
      oldestInvoiceDate,
      unpaidCount: unpaidInvoices.length,
      totalBilledMinor: Number(stats?.totalBilled ?? stats?.total_billed ?? 0),
      totalCollectedMinor: Number(stats?.totalCollected ?? stats?.total_collected ?? 0),
      unpaidInvoices: unpaidInvoices.map((inv: any) => ({
        id: inv.id,
        number: inv.number,
        bdate: inv.bdate,
        totalMinor: Number(inv.totalMinor ?? inv.total_minor),
        paidMinor: Number(inv.paidMinor ?? inv.paid_minor),
        balanceMinor: Number(inv.balanceMinor ?? inv.balance_minor),
        createdAt: inv.createdAt ?? inv.created_at,
      })),
    };
  };

  r.get('/api/parties/:id/dues', requirePerm('parties.view'), getCustomerDues);
  r.get('/api/parties/:id/khata', requirePerm('parties.view'), getCustomerDues);

  // 3. Customer Ledger Statement with Running Balance
  r.get('/api/parties/:id/ledger', requirePerm('parties.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const customerId = ctx.params.id;
    const fromDate = ctx.query.from ? String(ctx.query.from).trim() : null;
    const toDate = ctx.query.to ? String(ctx.query.to).trim() : null;

    const party = await ctx.db.one('SELECT * FROM parties WHERE id = ? AND tenant_id = ?', [customerId, tenantId]);
    if (!party) throw notFound('Customer');

    // Fetch all posted sales invoices
    const invoices = await ctx.db.query(
      `SELECT id, number, bdate AS event_date, created_at, 'invoice' AS kind,
              total_minor, balance_minor, paid_minor, status
       FROM invoices
       WHERE tenant_id = ? AND party_id = ? AND kind = 'sale' AND status = 'posted'`,
      [tenantId, customerId],
    );

    // Fetch all credit notes for this customer
    const creditNotes = await ctx.db.query(
      `SELECT cn.id, cn.number, cn.bdate AS event_date, cn.created_at, 'credit_note' AS kind,
              cn.total_minor, cn.status, cn.advance_amount_minor, cn.refund_amount_minor,
              cn.refund_mode, cn.void_reason, cn.voided_at, cn.linked_invoice_id,
              orig.number AS linked_invoice_number,
              COALESCE((SELECT SUM(ca.amount_minor) FROM credit_allocations ca WHERE ca.credit_note_id = cn.id), 0)::bigint AS dues_cleared_minor
       FROM invoices cn
       LEFT JOIN invoices orig ON orig.id = cn.linked_invoice_id
       WHERE cn.tenant_id = ? AND cn.party_id = ? AND cn.kind = 'credit_note'`,
      [tenantId, customerId],
    );

    // Fetch all payments (with user who collected it)
    const payments = await ctx.db.query(
      `SELECT p.id, p.receipt_number,
              COALESCE(p.payment_date, p.created_at) AS event_date,
              p.created_at, 'payment' AS kind,
              p.amount_minor, p.mode, p.reference_no, p.status, p.reversal_reason,
              p.reversed_at, p.advance_minor, p.whatsapp_send_count,
              p.whatsapp_last_sent_at, p.whatsapp_last_language,
              p.received_by, u.name AS received_by_name
       FROM payments p
       LEFT JOIN users u ON u.id = p.received_by
       WHERE p.tenant_id = ? AND p.customer_id = ?`,
      [tenantId, customerId],
    );

    // Fetch allocations for payments
    const allocations = await ctx.db.query(
      `SELECT pa.payment_id, pa.invoice_id, pa.amount_minor, i.number AS invoice_number
       FROM payment_allocations pa
       JOIN invoices i ON i.id = pa.invoice_id
       WHERE pa.tenant_id = ? AND pa.customer_id = ?`,
      [tenantId, customerId],
    );
    const allocMap = new Map<string, { invoiceNumber: string; amountMinor: number }[]>();
    for (const a of allocations) {
      const pid = a.paymentId ?? a.payment_id;
      if (!allocMap.has(pid)) allocMap.set(pid, []);
      allocMap.get(pid)!.push({
        invoiceNumber: a.invoiceNumber ?? a.invoice_number,
        amountMinor: Number(a.amountMinor ?? a.amount_minor),
      });
    }

    // Merge all events chronologically (oldest first)
    const allEvents: any[] = [];
    for (const inv of invoices) {
      const invDate = inv.eventDate ?? inv.event_date ?? inv.bdate ?? inv.createdAt ?? inv.created_at ?? new Date().toISOString();
      const invCreatedAt = inv.createdAt ?? inv.created_at ?? invDate;
      allEvents.push({
        id: inv.id,
        kind: 'invoice',
        date: invDate,
        createdAt: invCreatedAt,
        number: inv.number,
        description: `Sales Bill ${inv.number}`,
        debitMinor: Number(inv.total_minor ?? inv.totalMinor),
        creditMinor: 0,
        amountMinor: Number(inv.total_minor ?? inv.totalMinor),
        status: inv.status,
      });
    }

    for (const p of payments) {
      const pAlloc = allocMap.get(p.id) || [];
      const isReversed = p.status === 'reversed';
      const pDate = p.eventDate ?? p.event_date ?? p.paymentDate ?? p.payment_date ?? p.createdAt ?? p.created_at ?? new Date().toISOString();
      const pCreatedAt = p.createdAt ?? p.created_at ?? pDate;
      allEvents.push({
        id: p.id,
        kind: 'payment',
        date: pDate,
        createdAt: pCreatedAt,
        number: p.receipt_number ?? p.receiptNumber,
        description: isReversed
          ? `Receipt ${p.receipt_number ?? p.receiptNumber} (${(p.mode ?? 'cash').toUpperCase()}) [REVERSED]`
          : `Receipt ${p.receipt_number ?? p.receiptNumber} (${(p.mode ?? 'cash').toUpperCase()})`,
        debitMinor: 0,
        creditMinor: isReversed ? 0 : Number(p.amount_minor ?? p.amountMinor),
        amountMinor: Number(p.amount_minor ?? p.amountMinor),
        mode: p.mode,
        referenceNo: p.reference_no ?? p.referenceNo,
        status: p.status,
        reversalReason: p.reversal_reason ?? p.reversalReason,
        reversedAt: p.reversed_at ?? p.reversedAt,
        advanceMinor: Number(p.advance_minor ?? p.advanceMinor ?? 0),
        receivedByName: p.received_by_name ?? p.receivedByName,
        whatsappSendCount: Number(p.whatsapp_send_count ?? p.whatsappSendCount ?? 0),
        whatsappLastSentAt: p.whatsapp_last_sent_at ?? p.whatsappLastSentAt,
        whatsappLastLanguage: p.whatsapp_last_language ?? p.whatsappLastLanguage,
        allocations: pAlloc,
      });
    }

    for (const cn of creditNotes) {
      const cnDate = cn.eventDate ?? cn.event_date ?? cn.bdate ?? cn.createdAt ?? cn.created_at ?? new Date().toISOString();
      const cnCreatedAt = cn.createdAt ?? cn.created_at ?? cnDate;
      const duesCleared = Number(cn.duesClearedMinor ?? cn.dues_cleared_minor ?? 0);
      const isVoided = cn.status === 'voided';
      const advMinor = Number(cn.advanceAmountMinor ?? cn.advance_amount_minor ?? 0);
      const refMinor = Number(cn.refundAmountMinor ?? cn.refund_amount_minor ?? 0);

      let noteExtra = '';
      if (advMinor > 0 && refMinor > 0) {
        noteExtra = ` (₹${(advMinor / 100).toFixed(2)} advance, ₹${(refMinor / 100).toFixed(2)} refunded)`;
      } else if (advMinor > 0) {
        noteExtra = ` (₹${(advMinor / 100).toFixed(2)} kept as advance)`;
      } else if (refMinor > 0) {
        noteExtra = ` (₹${(refMinor / 100).toFixed(2)} refunded via ${(cn.refund_mode || 'cash').toUpperCase()})`;
      }

      allEvents.push({
        id: cn.id,
        kind: 'credit_note',
        date: cnDate,
        createdAt: cnCreatedAt,
        number: cn.number,
        description: isVoided
          ? `Credit Note ${cn.number} • against ${cn.linked_invoice_number || 'bill'}${noteExtra} [VOIDED]`
          : `Credit Note ${cn.number} • against ${cn.linked_invoice_number || 'bill'}${noteExtra}`,
        debitMinor: 0,
        creditMinor: duesCleared,
        amountMinor: Number(cn.total_minor ?? cn.totalMinor ?? 0),
        status: cn.status,
        duesClearedMinor: duesCleared,
        advanceMinor: advMinor,
        refundMinor: refMinor,
        refundMode: cn.refund_mode,
        linkedInvoiceNumber: cn.linked_invoice_number,
      });

      // If voided, add a reversal event on voided_at restoring the dues (Section 11.3 & 10.1)
      if (isVoided && cn.voided_at && duesCleared > 0) {
        allEvents.push({
          id: `${cn.id}_void`,
          kind: 'credit_note_reversal',
          date: cn.voided_at,
          createdAt: cn.voided_at,
          number: cn.number,
          description: `Reversal: Voided Credit Note ${cn.number} • ${cn.void_reason || 'Reversed'}`,
          debitMinor: duesCleared,
          creditMinor: 0,
          amountMinor: duesCleared,
          status: 'posted',
        });
      }
    }

    // Sort chronologically (oldest first) for running balance computation
    allEvents.sort((a, b) => {
      const d1 = new Date(a.date).getTime();
      const d2 = new Date(b.date).getTime();
      if (d1 !== d2) return d1 - d2;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    let running = 0;
    const computedEvents: any[] = [];
    for (const ev of allEvents) {
      if (ev.kind === 'invoice') {
        running += ev.debitMinor;
      } else if (ev.kind === 'payment' && ev.status !== 'reversed') {
        running = Math.max(0, running - ev.creditMinor);
      } else if (ev.kind === 'credit_note') {
        running = Math.max(0, running - ev.creditMinor);
      } else if (ev.kind === 'credit_note_reversal') {
        running += ev.debitMinor;
      }
      ev.runningBalanceMinor = running;

      // Filter by date range if provided
      const evDateOnly = new Date(ev.date).toISOString().slice(0, 10);
      if (fromDate && evDateOnly < fromDate) continue;
      if (toDate && evDateOnly > toDate) continue;

      computedEvents.push(ev);
    }

    // Return newest first for ledger display
    computedEvents.reverse();

    const advanceMinor = Number(party.advanceMinor ?? party.advance_minor ?? 0);

    return {
      party: {
        id: party.id,
        name: party.name,
        phone: party.phone,
        gstin: party.gstin,
        address: party.address,
        advanceMinor,
      },
      currentDuesMinor: Math.max(0, running - advanceMinor),
      closingBalanceMinor: running,
      advanceMinor,
      events: computedEvents,
    };
  });

  // 4. Customer Statement Printable (A4)
  r.get('/api/parties/:id/statement', requirePerm('parties.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const customerId = ctx.params.id;
    const fromDate = ctx.query.from ? String(ctx.query.from).trim() : null;
    const toDate = ctx.query.to ? String(ctx.query.to).trim() : null;

    const party = await ctx.db.one('SELECT * FROM parties WHERE id = ? AND tenant_id = ?', [customerId, tenantId]);
    if (!party) throw notFound('Customer');

    const shop = await ctx.db.one('SELECT * FROM tenants WHERE id = ?', [tenantId]);
    if (!shop) throw notFound('Shop');

    // Run same query as ledger: fetch sales invoices
    const invoices = await ctx.db.query(
      `SELECT id, number, bdate AS event_date, created_at, total_minor, status
       FROM invoices
       WHERE tenant_id = ? AND party_id = ? AND kind = 'sale' AND status = 'posted'`,
      [tenantId, customerId],
    );

    // Fetch credit notes for customer
    const creditNotes = await ctx.db.query(
      `SELECT cn.id, cn.number, cn.bdate AS event_date, cn.created_at, 'credit_note' AS kind,
              cn.total_minor, cn.status, cn.advance_amount_minor, cn.refund_amount_minor,
              cn.refund_mode, cn.void_reason, cn.voided_at, cn.linked_invoice_id,
              orig.number AS linked_invoice_number,
              COALESCE((SELECT SUM(ca.amount_minor) FROM credit_allocations ca WHERE ca.credit_note_id = cn.id), 0)::bigint AS dues_cleared_minor
       FROM invoices cn
       LEFT JOIN invoices orig ON orig.id = cn.linked_invoice_id
       WHERE cn.tenant_id = ? AND cn.party_id = ? AND cn.kind = 'credit_note'`,
      [tenantId, customerId],
    );

    const payments = await ctx.db.query(
      `SELECT id, receipt_number, COALESCE(payment_date, created_at) AS event_date,
              created_at, amount_minor, mode, status
       FROM payments
       WHERE tenant_id = ? AND customer_id = ?`,
      [tenantId, customerId],
    );

    const allEvents: any[] = [];
    for (const inv of invoices) {
      const invDate = inv.eventDate ?? inv.event_date ?? inv.bdate ?? inv.createdAt ?? inv.created_at ?? new Date().toISOString();
      const invCreatedAt = inv.createdAt ?? inv.created_at ?? invDate;
      allEvents.push({
        id: inv.id,
        kind: 'invoice',
        date: invDate,
        createdAt: invCreatedAt,
        number: inv.number,
        description: `Bill ${inv.number}`,
        debitMinor: Number(inv.total_minor ?? inv.totalMinor),
        creditMinor: 0,
        status: inv.status,
      });
    }

    for (const p of payments) {
      const isReversed = p.status === 'reversed';
      const pDate = p.eventDate ?? p.event_date ?? p.paymentDate ?? p.payment_date ?? p.createdAt ?? p.created_at ?? new Date().toISOString();
      const pCreatedAt = p.createdAt ?? p.created_at ?? pDate;
      allEvents.push({
        id: p.id,
        kind: 'payment',
        date: pDate,
        createdAt: pCreatedAt,
        number: p.receipt_number ?? p.receiptNumber,
        description: isReversed
          ? `Receipt ${p.receipt_number ?? p.receiptNumber} [REVERSED]`
          : `Receipt ${p.receipt_number ?? p.receiptNumber} (${(p.mode ?? 'cash').toUpperCase()})`,
        debitMinor: 0,
        creditMinor: isReversed ? 0 : Number(p.amount_minor ?? p.amountMinor),
        status: p.status,
      });
    }

    for (const cn of creditNotes) {
      const cnDate = cn.eventDate ?? cn.event_date ?? cn.bdate ?? cn.createdAt ?? cn.created_at ?? new Date().toISOString();
      const cnCreatedAt = cn.createdAt ?? cn.created_at ?? cnDate;
      const duesCleared = Number(cn.duesClearedMinor ?? cn.dues_cleared_minor ?? 0);
      const isVoided = cn.status === 'voided';
      const advMinor = Number(cn.advanceAmountMinor ?? cn.advance_amount_minor ?? 0);
      const refMinor = Number(cn.refundAmountMinor ?? cn.refund_amount_minor ?? 0);

      let noteExtra = '';
      if (advMinor > 0 && refMinor > 0) {
        noteExtra = ` (₹${(advMinor / 100).toFixed(2)} adv, ₹${(refMinor / 100).toFixed(2)} refund)`;
      } else if (advMinor > 0) {
        noteExtra = ` (₹${(advMinor / 100).toFixed(2)} advance)`;
      } else if (refMinor > 0) {
        noteExtra = ` (₹${(refMinor / 100).toFixed(2)} refund)`;
      }

      allEvents.push({
        id: cn.id,
        kind: 'credit_note',
        date: cnDate,
        createdAt: cnCreatedAt,
        number: cn.number,
        description: isVoided
          ? `Credit Note ${cn.number} • against ${cn.linked_invoice_number || 'bill'}${noteExtra} [VOIDED]`
          : `Credit Note ${cn.number} • against ${cn.linked_invoice_number || 'bill'}${noteExtra}`,
        debitMinor: 0,
        creditMinor: duesCleared,
        status: cn.status,
      });

      if (isVoided && cn.voided_at && duesCleared > 0) {
        allEvents.push({
          id: `${cn.id}_void`,
          kind: 'credit_note_reversal',
          date: cn.voided_at,
          createdAt: cn.voided_at,
          number: cn.number,
          description: `Reversal: Voided Credit Note ${cn.number} • ${cn.void_reason || 'Reversed'}`,
          debitMinor: duesCleared,
          creditMinor: 0,
          status: 'posted',
        });
      }
    }

    allEvents.sort((a, b) => {
      const d1 = new Date(a.date).getTime();
      const d2 = new Date(b.date).getTime();
      if (d1 !== d2) return d1 - d2;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

    let running = 0;
    let openingBalance = 0;
    const statementRows: any[] = [];

    for (const ev of allEvents) {
      const evDateOnly = new Date(ev.date).toISOString().slice(0, 10);
      if (fromDate && evDateOnly < fromDate) {
        if (ev.kind === 'invoice' || ev.kind === 'credit_note_reversal') running += ev.debitMinor;
        else if ((ev.kind === 'payment' && ev.status !== 'reversed') || ev.kind === 'credit_note') running = Math.max(0, running - ev.creditMinor);
        openingBalance = running;
        continue;
      }

      if (ev.kind === 'invoice' || ev.kind === 'credit_note_reversal') running += ev.debitMinor;
      else if ((ev.kind === 'payment' && ev.status !== 'reversed') || ev.kind === 'credit_note') running = Math.max(0, running - ev.creditMinor);

      if (toDate && evDateOnly > toDate) continue;

      statementRows.push({
        dateText: new Date(ev.date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' }),
        kind: ev.kind,
        description: ev.description,
        refNumber: ev.number,
        debitMinor: ev.debitMinor,
        creditMinor: ev.creditMinor,
        runningBalanceMinor: running,
        status: ev.status,
      });
    }

    const advanceMinor = Number(party.advanceMinor ?? party.advance_minor ?? 0);

    let totalBilled = 0;
    let totalCollected = 0;
    for (const r of statementRows) {
      if (r.status !== 'reversed') {
        totalBilled += r.debitMinor;
        totalCollected += r.creditMinor;
      }
    }

    const statement: PrintableCustomerStatement = {
      shop: {
        name: shop.name,
        address: shop.address,
        phone: shop.phone,
        gstin: shop.gstin,
      },
      customer: {
        name: party.name,
        phone: party.phone,
        gstin: party.gstin,
        address: party.address,
      },
      dateRangeText: fromDate && toDate
        ? `${fromDate} to ${toDate}`
        : fromDate
        ? `From ${fromDate}`
        : toDate
        ? `Up to ${toDate}`
        : 'All Transactions',
      openingBalanceMinor: openingBalance,
      closingBalanceMinor: running,
      advanceMinor,
      totalBilledMinor: totalBilled,
      totalCollectedMinor: totalCollected,
      rows: statementRows,
    };

    const html = renderCustomerStatementDoc(statement);
    return new HtmlResponse(html);
  });



  // 6. Get Payment Details with Allocations
  r.get('/api/payments/:id', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const payment = await ctx.db.one(
      `SELECT p.*, u.name AS received_by_name, rev_u.name AS reversed_by_name,
              c.name AS customer_name, c.phone AS customer_phone, c.gstin AS customer_gstin,
              c.advance_minor AS customer_advance_minor
       FROM payments p
       LEFT JOIN users u ON u.id = p.received_by
       LEFT JOIN users rev_u ON rev_u.id = p.reversed_by
       LEFT JOIN parties c ON c.id = p.customer_id
       WHERE p.id = ? AND p.tenant_id = ?`,
      [ctx.params.id, tenantId],
    );
    if (!payment) throw notFound('Payment');

    const allocations = await ctx.db.query(
      `SELECT pa.*, i.number AS invoice_number, i.bdate AS invoice_date
       FROM payment_allocations pa
       JOIN invoices i ON i.id = pa.invoice_id
       WHERE pa.payment_id = ? AND pa.tenant_id = ?
       ORDER BY i.bdate ASC, i.created_at ASC`,
      [payment.id, tenantId],
    );

    // Compute customer current dues
    const duesRow = await ctx.db.one<{ dues: number }>(
      `SELECT COALESCE(SUM(balance_minor), 0)::bigint - (SELECT advance_minor FROM parties WHERE id = ?) AS dues
       FROM invoices
       WHERE tenant_id = ? AND party_id = ? AND status = 'posted'`,
      [payment.customer_id ?? payment.customerId, tenantId, payment.customer_id ?? payment.customerId],
    );

    return {
      payment: formatPaymentWithAllocations(
        payment,
        allocations,
        Math.max(0, Number(duesRow?.dues ?? 0)),
      ),
    };
  });

  // 7. Get Payment Receipt HTML (Thermal & A4)
  r.get('/api/payments/:id/receipt', requireUser, async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const format = (ctx.query.format as any) || 'thermal80';

    const payment = await ctx.db.one(
      `SELECT p.*, u.name AS received_by_name,
              c.name AS customer_name, c.phone AS customer_phone, c.gstin AS customer_gstin,
              c.advance_minor AS customer_advance_minor
       FROM payments p
       LEFT JOIN users u ON u.id = p.received_by
       LEFT JOIN parties c ON c.id = p.customer_id
       WHERE p.id = ? AND p.tenant_id = ?`,
      [ctx.params.id, tenantId],
    );
    if (!payment) throw notFound('Payment');

    const shop = await ctx.db.one('SELECT * FROM tenants WHERE id = ?', [tenantId]);
    if (!shop) throw notFound('Shop');

    const allocations = await ctx.db.query(
      `SELECT pa.*, i.number AS invoice_number, i.bdate AS invoice_date
       FROM payment_allocations pa
       JOIN invoices i ON i.id = pa.invoice_id
       WHERE pa.payment_id = ? AND pa.tenant_id = ?
       ORDER BY i.bdate ASC, i.created_at ASC`,
      [payment.id, tenantId],
    );

    const duesRow = await ctx.db.one<{ dues: number }>(
      `SELECT COALESCE(SUM(balance_minor), 0)::bigint - (SELECT advance_minor FROM parties WHERE id = ?) AS dues
       FROM invoices
       WHERE tenant_id = ? AND party_id = ? AND status = 'posted'`,
      [payment.customer_id ?? payment.customerId, tenantId, payment.customer_id ?? payment.customerId],
    );
    const balanceMinor = Math.max(0, Number(duesRow?.dues ?? 0));

    const printable: PrintablePaymentReceipt = {
      receiptNumber: payment.receipt_number ?? payment.receiptNumber,
      dateText: new Date(payment.payment_date ?? payment.createdAt).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
      shop: {
        name: shop.name,
        address: shop.address,
        phone: shop.phone,
        gstin: shop.gstin,
        upiId: shop.upi_id ?? shop.upiId,
      },
      customer: {
        name: payment.customer_name ?? payment.customerName ?? 'Customer',
        phone: payment.customer_phone ?? payment.customerPhone,
        gstin: payment.customer_gstin ?? payment.customerGstin,
      },
      amountMinor: Number(payment.amount_minor ?? payment.amountMinor),
      mode: payment.mode ?? payment.method ?? 'cash',
      reference: payment.reference_no ?? payment.referenceNo,
      note: payment.note,
      receivedBy: payment.received_by_name ?? payment.receivedByName,
      allocations: allocations.map((a: any) => ({
        invoiceNumber: a.invoice_number ?? a.invoiceNumber,
        invoiceDate: a.invoice_date ?? a.invoiceDate,
        amountMinor: Number(a.amount_minor ?? a.amountMinor),
      })),
      advanceMinor: Number(payment.advance_minor ?? payment.advanceMinor ?? 0),
      balanceMinor,
      customerAdvanceMinor: Number(payment.customer_advance_minor ?? payment.customerAdvanceMinor ?? 0),
      status: payment.status ?? 'posted',
      reversalReason: payment.reversal_reason ?? payment.reversalReason,
    };

    let qrSvgMarkup = '';
    const upiId = shop.upiId ?? shop.upi_id;
    if (upiId && balanceMinor > 0 && format === 'a4') {
      const upi = upiUri({
        vpa: upiId,
        name: shop.name,
        amountMinor: balanceMinor,
        note: `Balance for ${printable.customer.name}`,
      });
      qrSvgMarkup = qrSvg(upi, { size: 110 });
    }

    const html = renderPaymentReceiptDoc(
      printable,
      { ...DEFAULT_CONFIG.template, paper: format },
      { qrSvg: qrSvgMarkup, qrCaption: 'Scan UPI to pay balance', autoPrint: false },
    );
    return new HtmlResponse(html);
  });

  // 8. Reversal - Owner & Manager only
  r.post('/api/payments/:id/reverse', requirePerm('payments.reverse'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const paymentId = ctx.params.id;
    const b = ctx.body ?? {};

    const reason = V.str(b.reason, 'Reversal reason', { required: true, min: 3, max: 200 });

    let updatedPayment: any = null;

    await ctx.db.tx(async (q) => {
      // 1. Lock payment
      const payment = await q.one(
        'SELECT * FROM payments WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [paymentId, tenantId],
      );
      if (!payment) throw notFound('Payment');

      if (payment.status === 'reversed') {
        throw bad('Payment is already reversed', 'VALIDATION');
      }

      const advanceCreated = Number(payment.advance_minor ?? payment.advanceMinor ?? 0);
      const customerId = payment.customer_id ?? payment.customerId;

      // 2. Lock customer party
      const party = await q.one(
        'SELECT * FROM parties WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [customerId, tenantId],
      );
      if (!party) throw notFound('Customer');

      // 3. Block reversal if advance was already consumed
      const currentAdvance = Number(party.advance_minor ?? party.advanceMinor ?? 0);
      if (advanceCreated > 0 && currentAdvance < advanceCreated) {
        const usedAmt = advanceCreated - currentAdvance;
        throw bad(
          `This payment's advance (Rs ${(advanceCreated / 100).toFixed(2)}) was already used in subsequent bills. Reverse that usage first, or contact the owner.`,
          'ADVANCE_ALREADY_USED',
        );
      }

      // 4. Undo allocations
      const allocations = await q.query(
        'SELECT * FROM payment_allocations WHERE payment_id = ? AND tenant_id = ?',
        [paymentId, tenantId],
      );

      for (const alloc of allocations) {
        const allocAmt = Number(alloc.amount_minor ?? alloc.amountMinor);
        const invId = alloc.invoice_id ?? alloc.invoiceId;
        await q.exec(
          `UPDATE invoices
           SET balance_minor = balance_minor + ?,
               paid_minor = paid_minor - ?
           WHERE id = ? AND tenant_id = ?`,
          [allocAmt, allocAmt, invId, tenantId],
        );
      }

      // 5. Deduct advance created by this payment
      if (advanceCreated > 0) {
        await q.exec(
          `UPDATE parties
           SET advance_minor = advance_minor - ?
           WHERE id = ? AND tenant_id = ?`,
          [advanceCreated, customerId, tenantId],
        );
      }

      // 6. Mark payment reversed
      await q.exec(
        `UPDATE payments
         SET status = 'reversed',
             reversed_by = ?,
             reversed_at = NOW(),
             reversal_reason = ?
         WHERE id = ? AND tenant_id = ?`,
        [ctx.user!.id, reason, paymentId, tenantId],
      );

      // 7. Audit log
      await audit(q, ctx, {
        action: 'payment.reverse',
        entity: 'payment',
        entityId: paymentId,
        detail: {
          receiptNumber: payment.receipt_number ?? payment.receiptNumber,
          customerId,
          amountMinor: Number(payment.amount_minor ?? payment.amountMinor),
          reason,
          reversedBy: ctx.user!.name,
        },
      });

      updatedPayment = await q.one('SELECT * FROM payments WHERE id = ? AND tenant_id = ?', [paymentId, tenantId]);
    });

    return {
      ok: true,
      payment: updatedPayment,
    };
  });

  // 9. WhatsApp Send Tracking for Receipt
  r.post('/api/payments/:id/whatsapp-track', requirePerm('collect'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const paymentId = ctx.params.id;
    const b = ctx.body ?? {};

    const language = V.oneOf(b.language, 'Language', ['en', 'hi', 'ta'] as const, 'en');
    const phone = b.phone ? normalizePhone(String(b.phone)) : null;

    const payment = await ctx.db.one('SELECT * FROM payments WHERE id = ? AND tenant_id = ?', [paymentId, tenantId]);
    if (!payment) throw notFound('Payment');

    await ctx.db.tx(async (q) => {
      await q.exec(
        `UPDATE payments
         SET whatsapp_send_count = COALESCE(whatsapp_send_count, 0) + 1,
             whatsapp_last_sent_at = NOW(),
             whatsapp_last_sent_to = ?,
             whatsapp_last_language = ?,
             whatsapp_last_sent_by = ?
         WHERE id = ? AND tenant_id = ?`,
        [phone, language, ctx.user!.id, paymentId, tenantId],
      );

      // Save to customer master if requested
      const custId = payment.customer_id ?? payment.customerId;
      if (b.saveToCustomerMaster && phone && custId) {
        await q.exec(
          `UPDATE parties SET phone = ? WHERE id = ? AND tenant_id = ?`,
          [phone, custId, tenantId],
        );
      }
    });

    return { ok: true };
  });

  // 10. Public Hosted Receipt Link (/r/:token)
  r.get('/r/:token', async (ctx) => {
    const payment = await ctx.db.one('SELECT * FROM payments WHERE share_token = ?', [ctx.params.token]);
    if (!payment) throw notFound('Receipt not found or link has expired.');

    const tenantId = payment.tenant_id ?? payment.tenantId;
    const shop = await ctx.db.one('SELECT * FROM tenants WHERE id = ?', [tenantId]);
    if (!shop) throw notFound('Shop');

    const customer = await ctx.db.one('SELECT * FROM parties WHERE id = ?', [payment.customer_id ?? payment.customerId]);

    const allocations = await ctx.db.query(
      `SELECT pa.*, i.number AS invoice_number, i.bdate AS invoice_date
       FROM payment_allocations pa
       JOIN invoices i ON i.id = pa.invoice_id
       WHERE pa.payment_id = ?
       ORDER BY i.bdate ASC, i.created_at ASC`,
      [payment.id],
    );

    const duesRow = await ctx.db.one<{ dues: number }>(
      `SELECT COALESCE(SUM(balance_minor), 0)::bigint - (SELECT advance_minor FROM parties WHERE id = ?) AS dues
       FROM invoices
       WHERE tenant_id = ? AND party_id = ? AND status = 'posted'`,
      [payment.customer_id ?? payment.customerId, tenantId, payment.customer_id ?? payment.customerId],
    );
    const balanceMinor = Math.max(0, Number(duesRow?.dues ?? 0));

    const printable: PrintablePaymentReceipt = {
      receiptNumber: payment.receipt_number ?? payment.receiptNumber,
      dateText: new Date(payment.payment_date ?? payment.createdAt).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
      shop: {
        name: shop.name,
        address: shop.address,
        phone: shop.phone,
        gstin: shop.gstin,
        upiId: shop.upi_id ?? shop.upiId,
      },
      customer: {
        name: customer?.name ?? 'Customer',
        phone: customer?.phone,
        gstin: customer?.gstin,
      },
      amountMinor: Number(payment.amount_minor ?? payment.amountMinor),
      mode: payment.mode ?? payment.method ?? 'cash',
      reference: payment.reference_no ?? payment.referenceNo,
      note: payment.note,
      allocations: allocations.map((a: any) => ({
        invoiceNumber: a.invoice_number ?? a.invoiceNumber,
        invoiceDate: a.invoice_date ?? a.invoiceDate,
        amountMinor: Number(a.amount_minor ?? a.amountMinor),
      })),
      advanceMinor: Number(payment.advance_minor ?? payment.advanceMinor ?? 0),
      balanceMinor,
      customerAdvanceMinor: Number(customer?.advance_minor ?? customer?.advanceMinor ?? 0),
      status: payment.status ?? 'posted',
      reversalReason: payment.reversal_reason ?? payment.reversalReason,
    };

    let qrSvgMarkup = '';
    const upiId = shop.upiId ?? shop.upi_id;
    if (upiId && balanceMinor > 0) {
      const upi = upiUri({
        vpa: upiId,
        name: shop.name,
        amountMinor: balanceMinor,
        note: `Balance for ${printable.customer.name}`,
      });
      qrSvgMarkup = qrSvg(upi, { size: 110 });
    }

    const html = renderPaymentReceiptDoc(
      printable,
      { ...DEFAULT_CONFIG.template, paper: 'a4' },
      { qrSvg: qrSvgMarkup, qrCaption: 'Scan UPI to pay balance', autoPrint: false },
    );
    return new HtmlResponse(html);
  });

  // --------------------------------------------------------------------------
  // Financial Overview Endpoints for Accounts & Finance
  // --------------------------------------------------------------------------

  // Cash & Bank Overview
  r.get('/api/finance/cash-bank', requirePerm('reports'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const todayStr = new Date().toISOString().slice(0, 10);

    // 1. Drawer Cash collections today
    const cashSales = await ctx.db.one<{ total: number }>(
      `SELECT COALESCE(SUM(paid_minor), 0)::bigint AS total
       FROM invoices
       WHERE tenant_id = ? AND bdate = ? AND status = 'posted' AND kind = 'sale'`,
      [tenantId, todayStr],
    );

    // Collections by method
    const collectionsByMethod = await ctx.db.query<{ method: string; total: number }>(
      `SELECT COALESCE(mode, method) AS method, COALESCE(SUM(amount_minor), 0)::bigint AS total
       FROM payments
       WHERE tenant_id = ? AND (status IS NULL OR status = 'posted')
       GROUP BY COALESCE(mode, method)
       ORDER BY total DESC`,
      [tenantId],
    );

    // Supplier payments out by method
    const supplierPaymentsByMethod = await ctx.db.query<{ method: string; total: number }>(
      `SELECT COALESCE(method, 'cash') AS method, COALESCE(SUM(amount_minor), 0)::bigint AS total
       FROM payments
       WHERE tenant_id = ? AND kind = 'supplier_payment' AND status = 'posted'
       GROUP BY COALESCE(method, 'cash')
       ORDER BY total DESC`,
      [tenantId],
    );

    // Cash movements from active shifts
    const cashMovements = await ctx.db.query<{ movement_type: string; total: number }>(
      `SELECT movement_type, COALESCE(SUM(amount_minor), 0)::bigint AS total
       FROM cash_movements
       WHERE tenant_id = ?
       GROUP BY movement_type`,
      [tenantId],
    );

    // Expenses paid by method
    const expensesByMethod = await ctx.db.query<{ payment_method: string; total: number }>(
      `SELECT payment_method, COALESCE(SUM(paid_minor), 0)::bigint AS total
       FROM expenses
       WHERE tenant_id = ? AND status = 'posted'
       GROUP BY payment_method`,
      [tenantId],
    );

    const getSum = (arr: any[], key: string, valKey = 'total') =>
      arr.reduce((acc, row) => (row[key] ? acc + Number(row[valKey]) : acc), 0);

    const cashIn = Number(cashMovements.find((m: any) => (m.movementType ?? m.movement_type) === 'cash_in')?.total || 0);
    const cashOut = Number(cashMovements.find((m: any) => (m.movementType ?? m.movement_type) === 'cash_out')?.total || 0);

    return {
      todayDate: todayStr,
      collectionsByMethod: collectionsByMethod.map((c: any) => ({ method: c.method, totalMinor: Number(c.total) })),
      supplierPaymentsByMethod: supplierPaymentsByMethod.map((s: any) => ({ method: s.method, totalMinor: Number(s.total) })),
      expensesByMethod: expensesByMethod.map((e: any) => ({ method: e.paymentMethod ?? e.payment_method, totalMinor: Number(e.total) })),
      cashDrawer: {
        totalCashCollectionsMinor: Number(collectionsByMethod.find((c: any) => c.method === 'cash')?.total || 0),
        cashMovementsInMinor: cashIn,
        cashMovementsOutMinor: cashOut,
      },
      digitalBank: {
        totalUpiMinor: Number(collectionsByMethod.find((c: any) => c.method === 'upi')?.total || 0),
        totalCardMinor: Number(collectionsByMethod.find((c: any) => c.method === 'card')?.total || 0),
        totalBankMinor: Number(collectionsByMethod.find((c: any) => c.method === 'bank')?.total || 0),
      },
    };
  });

  // Receivables (Customer Outstanding Dues & Aging)
  r.get('/api/finance/receivables', requirePerm('reports'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;

    const customersWithDues = await ctx.db.query(
      `SELECT
        p.id AS customer_id, p.name AS customer_name, p.phone AS customer_phone,
        COALESCE(SUM(i.balance_minor), 0)::bigint AS total_due_minor,
        COUNT(i.id)::int AS open_invoices_count,
        MIN(i.bdate) AS oldest_invoice_date
       FROM parties p
       JOIN invoices i ON i.party_id = p.id AND i.tenant_id = p.tenant_id
       WHERE p.tenant_id = ? AND p.type = 'customer' AND i.status = 'posted' AND i.balance_minor > 0
       GROUP BY p.id, p.name, p.phone
       ORDER BY total_due_minor DESC`,
      [tenantId],
    );

    const totalReceivableMinor = customersWithDues.reduce((sum, c: any) => sum + Number(c.totalDueMinor ?? c.total_due_minor ?? 0), 0);

    return {
      totalReceivableMinor,
      customersCount: customersWithDues.length,
      customers: customersWithDues.map((c: any) => ({
        customerId: c.customerId ?? c.customer_id,
        customerName: c.customerName ?? c.customer_name ?? 'Customer',
        customerPhone: c.customerPhone ?? c.customer_phone,
        totalDueMinor: Number(c.totalDueMinor ?? c.total_due_minor ?? 0),
        openInvoicesCount: Number(c.openInvoicesCount ?? c.open_invoices_count ?? 0),
        oldestInvoiceDate: c.oldestInvoiceDate ?? c.oldest_invoice_date,
      })),
    };
  });

  // Payables (Supplier Outstanding Dues & Aging)
  r.get('/api/finance/payables', requirePerm('reports'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;

    const suppliersWithPayables = await ctx.db.query(
      `SELECT
        part.id AS supplier_id, part.name AS supplier_name, part.phone AS supplier_phone,
        part.gstin AS supplier_gstin,
        COALESCE(SUM(pur.balance_minor), 0)::bigint AS total_payable_minor,
        COUNT(pur.id)::int AS open_purchases_count,
        MIN(COALESCE(pur.purchase_date, pur.bdate)) AS oldest_bill_date
       FROM parties part
       JOIN purchases pur ON pur.supplier_id = part.id AND pur.tenant_id = part.tenant_id
       WHERE part.tenant_id = ? AND part.type = 'supplier' AND pur.status != 'voided' AND pur.balance_minor > 0
       GROUP BY part.id, part.name, part.phone, part.gstin
       ORDER BY total_payable_minor DESC`,
      [tenantId],
    );

    const totalPayableMinor = suppliersWithPayables.reduce((sum, s: any) => sum + Number(s.totalPayableMinor ?? s.total_payable_minor ?? 0), 0);

    return {
      totalPayableMinor,
      suppliersCount: suppliersWithPayables.length,
      suppliers: suppliersWithPayables.map((s: any) => ({
        supplierId: s.supplierId ?? s.supplier_id,
        supplierName: s.supplierName ?? s.supplier_name ?? 'Supplier',
        supplierPhone: s.supplierPhone ?? s.supplier_phone,
        supplierGstin: s.supplierGstin ?? s.supplier_gstin,
        totalPayableMinor: Number(s.totalPayableMinor ?? s.total_payable_minor ?? 0),
        openPurchasesCount: Number(s.openPurchasesCount ?? s.open_purchases_count ?? 0),
        oldestBillDate: s.oldestBillDate ?? s.oldest_bill_date,
      })),
    };
  });
}

function formatPaymentWithAllocations(p: any, allocations: any[] = [], balanceAfterMinor?: number) {
  return {
    id: p.id,
    receiptNumber: p.receipt_number ?? p.receiptNumber,
    customerId: p.customer_id ?? p.customerId,
    customerName: p.customer_name ?? p.customerName,
    customerPhone: p.customer_phone ?? p.customerPhone,
    amountMinor: Number(p.amount_minor ?? p.amountMinor),
    mode: p.mode ?? p.method ?? 'cash',
    referenceNo: p.reference_no ?? p.referenceNo ?? null,
    paymentDate: p.payment_date ?? p.paymentDate ?? p.created_at ?? p.createdAt,
    note: p.note ?? null,
    receivedBy: p.received_by ?? p.receivedBy,
    receivedByName: p.received_by_name ?? p.receivedByName ?? null,
    advanceMinor: Number(p.advance_minor ?? p.advanceMinor ?? 0),
    status: p.status ?? 'posted',
    reversedBy: p.reversed_by ?? p.reversedBy ?? null,
    reversedByName: p.reversed_by_name ?? p.reversedByName ?? null,
    reversedAt: p.reversed_at ?? p.reversedAt ?? null,
    reversalReason: p.reversal_reason ?? p.reversalReason ?? null,
    shareToken: p.share_token ?? p.shareToken,
    whatsappSendCount: Number(p.whatsapp_send_count ?? p.whatsappSendCount ?? 0),
    whatsappLastSentAt: p.whatsapp_last_sent_at ?? p.whatsappLastSentAt ?? null,
    whatsappLastSentTo: p.whatsapp_last_sent_to ?? p.whatsappLastSentTo ?? null,
    whatsappLastLanguage: p.whatsapp_last_language ?? p.whatsappLastLanguage ?? null,
    createdAt: p.created_at ?? p.createdAt,
    allocations: allocations.map((a: any) => ({
      invoiceId: a.invoice_id ?? a.invoiceId,
      invoiceNumber: a.invoice_number ?? a.invoiceNumber,
      invoiceDate: a.invoice_date ?? a.invoiceDate,
      amountMinor: Number(a.amount_minor ?? a.amountMinor),
    })),
    balanceAfterMinor: balanceAfterMinor !== undefined ? balanceAfterMinor : undefined,
  };
}
