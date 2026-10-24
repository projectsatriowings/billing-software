import { requirePerm } from '../auth.ts';
import { bad, notFound, V, type Router } from '../http.ts';
import { newId } from '../security.ts';
import { audit } from '../audit.ts';
import { normalizePhone } from '../../../shared/whatsapp.ts';
import { validateGstin } from '../../../shared/tax.ts';

function validateCustom(raw: unknown): Record<string, string | number> {
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw bad('Custom fields must be an object', 'VALIDATION', { field: 'custom' });
  }
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length > 20) {
    throw bad('Custom fields can have at most 20 entries', 'VALIDATION', { field: 'custom' });
  }
  const cleaned: Record<string, string | number> = {};
  for (const k of keys) {
    const val = obj[k];
    if (typeof val === 'number') {
      if (!Number.isFinite(val)) throw bad(`Custom field "${k}" must be a valid number`, 'VALIDATION', { field: `custom.${k}` });
      cleaned[k] = val;
    } else if (typeof val === 'string') {
      cleaned[k] = val;
    } else {
      throw bad(`Custom field "${k}" must be text or number`, 'VALIDATION', { field: `custom.${k}` });
    }
  }
  return cleaned;
}

function formatParty(p: any) {
  const unpaidMinor = Number(p.unpaidInvoicesMinor ?? p.unpaid_invoices_minor ?? 0);
  const advanceMinor = Number(p.advanceMinor ?? p.advance_minor ?? 0);
  const duesMinor = Math.max(0, unpaidMinor - advanceMinor);

  const unpaidPurchasesMinor = Number(p.unpaidPurchasesMinor ?? p.unpaid_purchases_minor ?? 0);
  const payableMinor = unpaidPurchasesMinor;
  const openPurchasesCount = Number(p.openPurchasesCount ?? p.open_purchases_count ?? 0);
  const oldestDueDate = p.oldestDueDate ?? p.oldest_due_date ?? null;

  return {
    id: p.id,
    tenantId: p.tenantId ?? p.tenant_id,
    type: p.type,
    name: p.name,
    phone: p.phone ?? null,
    email: p.email ?? null,
    gstin: p.gstin ?? null,
    stateCode: p.stateCode ?? p.state_code ?? null,
    address: p.address ?? null,
    creditLimitMinor: Number(p.creditLimitMinor ?? p.credit_limit_minor ?? 0),
    advanceMinor,
    unpaidInvoicesMinor: unpaidMinor,
    duesMinor,
    unpaidPurchasesMinor,
    payableMinor,
    openPurchasesCount,
    oldestDueDate,
    custom: typeof p.custom === 'string' ? JSON.parse(p.custom) : (p.custom ?? {}),
    active: Boolean(p.active),
    createdAt: p.createdAt ?? p.created_at,
  };
}

export function registerParties(r: Router) {
  // List parties (customers, suppliers)
  r.get('/api/parties', requirePerm('parties.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const type = ctx.query.type; // customer or supplier
    const q = (ctx.query.q ?? '').trim().toLowerCase();
    const includeInactive = ctx.query.includeInactive === '1' || ctx.query.includeInactive === 'true';

    let sql = `
      SELECT p.*,
             COALESCE((SELECT SUM(i.balance_minor) FROM invoices i WHERE i.party_id = p.id AND i.tenant_id = p.tenant_id AND i.status = 'posted'), 0)::bigint AS unpaid_invoices_minor,
             COALESCE((SELECT SUM(pur.balance_minor) FROM purchases pur WHERE pur.supplier_id = p.id AND pur.tenant_id = p.tenant_id AND pur.status != 'voided'), 0)::bigint AS unpaid_purchases_minor,
             COALESCE((SELECT COUNT(*) FROM purchases pur WHERE pur.supplier_id = p.id AND pur.tenant_id = p.tenant_id AND pur.status != 'voided' AND pur.balance_minor > 0), 0)::int AS open_purchases_count,
             (SELECT MIN(COALESCE(pur.supplier_invoice_date, pur.bdate)) FROM purchases pur WHERE pur.supplier_id = p.id AND pur.tenant_id = p.tenant_id AND pur.status != 'voided' AND pur.balance_minor > 0) AS oldest_due_date
      FROM parties p
      WHERE p.tenant_id = ?
    `;
    const params: unknown[] = [tenantId];

    if (!includeInactive) {
      sql += ' AND active = true';
    }

    if (type) {
      sql += ' AND type = ?';
      params.push(type);
    }
    if (q) {
      sql += ' AND (lower(name) LIKE ? OR phone LIKE ? OR lower(COALESCE(email, \'\')) LIKE ? OR lower(COALESCE(gstin, \'\')) LIKE ?)';
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }

    const limit = Math.min(Math.max(V.int(ctx.query.limit ?? 100, 'Limit', { min: 1, max: 500 }), 1), 500);
    const offset = Math.max(V.int(ctx.query.offset ?? 0, 'Offset', { min: 0 }), 0);

    sql += ' ORDER BY name ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = await ctx.db.query(sql, params);
    return { parties: rows.map(formatParty) };
  });

  // Customer Dues Summary & Ageing (0-30, 31-60, 60+ days)
  r.get('/api/parties/dues-summary', requirePerm('parties.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;

    // Fetch unpaid posted invoices grouped by party
    const unpaidInvoices = await ctx.db.query(
      `SELECT party_id, total_minor, balance_minor, bdate, created_at
       FROM invoices
       WHERE tenant_id = ? AND status = 'posted' AND balance_minor > 0
       ORDER BY bdate ASC, created_at ASC`,
      [tenantId],
    );

    // Fetch all customers with active advance
    const customers = await ctx.db.query(
      `SELECT id, name, phone, gstin, advance_minor
       FROM parties
       WHERE tenant_id = ? AND type = 'customer' AND active = true`,
      [tenantId],
    );

    const custMap = new Map(customers.map((c: any) => [c.id, {
      id: c.id,
      name: c.name,
      phone: c.phone,
      gstin: c.gstin,
      advanceMinor: Number(c.advance_minor ?? c.advanceMinor ?? 0),
      unpaidMinor: 0,
      oldestInvoiceDate: null as string | null,
    }]));

    const now = Date.now();
    let age0_30 = 0;
    let age31_60 = 0;
    let age61_plus = 0;

    for (const inv of unpaidInvoices) {
      const pid = inv.party_id ?? inv.partyId;
      const c = custMap.get(pid);
      const bal = Number(inv.balance_minor ?? inv.balanceMinor);
      if (c) {
        c.unpaidMinor += bal;
        if (!c.oldestInvoiceDate) {
          c.oldestInvoiceDate = inv.bdate ?? inv.created_at;
        }
      }
    }

    let totalDuesMinor = 0;
    let totalAdvanceMinor = 0;
    const debtors: any[] = [];

    for (const c of custMap.values()) {
      totalAdvanceMinor += c.advanceMinor;
      const dues = Math.max(0, c.unpaidMinor - c.advanceMinor);
      if (dues > 0) {
        totalDuesMinor += dues;
        debtors.push({
          id: c.id,
          name: c.name,
          phone: c.phone,
          gstin: c.gstin,
          advanceMinor: c.advanceMinor,
          unpaidMinor: c.unpaidMinor,
          duesMinor: dues,
          oldestInvoiceDate: c.oldestInvoiceDate,
        });

        // Ageing bucket based on oldest unpaid invoice
        if (c.oldestInvoiceDate) {
          const invTime = new Date(c.oldestInvoiceDate).getTime();
          const daysOld = Math.floor((now - invTime) / (1000 * 60 * 60 * 24));
          if (daysOld <= 30) {
            age0_30 += dues;
          } else if (daysOld <= 60) {
            age31_60 += dues;
          } else {
            age61_plus += dues;
          }
        } else {
          age0_30 += dues;
        }
      }
    }

    // Sort top debtors descending
    debtors.sort((a, b) => b.duesMinor - a.duesMinor);

    return {
      totalDuesMinor,
      totalAdvanceMinor,
      ageing: {
        '0_30': age0_30,
        '31_60': age31_60,
        '61_plus': age61_plus,
        days0_30: age0_30,
        days31_60: age31_60,
        days60Plus: age61_plus,
        days0To30: age0_30,
        days31To60: age31_60,
      },
      topDebtors: debtors.slice(0, 20),
    };
  });

  // Get party by ID
  r.get('/api/parties/:id', requirePerm('parties.view'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const row = await ctx.db.one(
      `SELECT p.*,
              COALESCE((SELECT SUM(i.balance_minor) FROM invoices i WHERE i.party_id = p.id AND i.tenant_id = p.tenant_id AND i.status = 'posted'), 0)::bigint AS unpaid_invoices_minor
       FROM parties p
       WHERE p.id = ? AND p.tenant_id = ?`,
      [ctx.params.id, tenantId]
    );
    if (!row) throw notFound('Party');
    return { party: formatParty(row) };
  });

  // Create party (supports standard add and quick-add for counter)
  r.post('/api/parties', requirePerm('parties.write'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;

    const name = V.str(b.name, 'Customer/Supplier name', { required: true, max: 120 });
    const type = V.oneOf(b.type, 'Party type', ['customer', 'supplier'] as const, 'customer');

    let phone: string | null = null;
    if (b.phone !== undefined && b.phone !== null && String(b.phone).trim() !== '') {
      phone = normalizePhone(String(b.phone));
      if (!phone) {
        throw bad('Please enter a valid 10-digit mobile number', 'VALIDATION', { field: 'phone' });
      }
    }

    const email = V.optStr(b.email, 'Email', 100);

    let gstin: string | null = null;
    let stateCode: string | null = null;

    if (b.gstin !== undefined && b.gstin !== null && String(b.gstin).trim() !== '') {
      const g = String(b.gstin).trim().toUpperCase();
      const v = validateGstin(g);
      if (!v.ok) {
        throw bad(v.reason ?? 'Invalid GSTIN', 'VALIDATION', { field: 'gstin' });
      }
      gstin = g;
      stateCode = g.slice(0, 2);
    } else if (b.stateCode !== undefined && b.stateCode !== null && String(b.stateCode).trim() !== '') {
      stateCode = V.str(b.stateCode, 'State code', { max: 2 });
    } else {
      const shop = await ctx.db.one<{ stateCode: string; state_code: string }>('SELECT state_code FROM tenants WHERE id = ?', [tenantId]);
      stateCode = shop?.stateCode ?? shop?.state_code ?? '33';
    }

    const address = V.optStr(b.address, 'Address', 300);
    const creditLimitMinor = V.int(b.creditLimitMinor ?? 0, 'Credit limit (paise)', { min: 0 });
    const custom = validateCustom(b.custom);

    const id = newId('p');
    await ctx.db.tx(async (q) => {
      await q.exec(
        `INSERT INTO parties (
          id, tenant_id, type, name, phone, email, gstin, state_code,
          address, credit_limit_minor, custom, active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, true)`,
        [id, tenantId, type, name, phone, email, gstin, stateCode, address, creditLimitMinor, JSON.stringify(custom)],
      );
      await audit(q, ctx, { action: 'party.create', entity: 'party', entityId: id, detail: { name, type, phone, gstin } });
    });

    const created = await ctx.db.one('SELECT * FROM parties WHERE id = ? AND tenant_id = ?', [id, tenantId]);
    return { party: formatParty(created) };
  });

  // Update party
  r.patch('/api/parties/:id', requirePerm('parties.write'), async (ctx) => {
    const b = ctx.body ?? {};
    const tenantId = ctx.user!.tenantId;
    const party = await ctx.db.one('SELECT * FROM parties WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!party) throw notFound('Party');

    const name = b.name !== undefined ? V.str(b.name, 'Name', { required: true, max: 120 }) : party.name;
    const type = b.type !== undefined ? V.oneOf(b.type, 'Party type', ['customer', 'supplier'] as const) : party.type;

    let phone = party.phone;
    if (b.phone !== undefined) {
      if (b.phone === null || String(b.phone).trim() === '') {
        phone = null;
      } else {
        const cleaned = normalizePhone(String(b.phone));
        if (!cleaned) throw bad('Please enter a valid 10-digit mobile number', 'VALIDATION', { field: 'phone' });
        phone = cleaned;
      }
    }

    const email = b.email !== undefined ? V.optStr(b.email, 'Email', 100) : party.email;

    let gstin = party.gstin;
    let stateCode = party.stateCode ?? party.state_code;
    if (b.gstin !== undefined) {
      if (b.gstin === null || String(b.gstin).trim() === '') {
        gstin = null;
        if (b.stateCode !== undefined) {
          stateCode = V.optStr(b.stateCode, 'State code', 2);
        }
      } else {
        const g = String(b.gstin).trim().toUpperCase();
        const v = validateGstin(g);
        if (!v.ok) throw bad(v.reason ?? 'Invalid GSTIN', 'VALIDATION', { field: 'gstin' });
        gstin = g;
        stateCode = g.slice(0, 2);
      }
    } else if (b.stateCode !== undefined) {
      stateCode = V.optStr(b.stateCode, 'State code', 2);
    }

    const address = b.address !== undefined ? V.optStr(b.address, 'Address', 300) : (party.address ?? null);
    const creditLimitMinor = b.creditLimitMinor !== undefined ? V.int(b.creditLimitMinor, 'Credit limit (paise)', { min: 0 }) : Number(party.creditLimitMinor ?? party.credit_limit_minor ?? 0);
    const custom = b.custom !== undefined ? validateCustom(b.custom) : (typeof party.custom === 'string' ? JSON.parse(party.custom) : (party.custom ?? {}));
    const active = b.active !== undefined ? V.bool(b.active) : Boolean(party.active);

    await ctx.db.tx(async (q) => {
      await q.exec(
        `UPDATE parties SET
          name = ?, type = ?, phone = ?, email = ?, gstin = ?, state_code = ?,
          address = ?, credit_limit_minor = ?, custom = ?::jsonb, active = ?
         WHERE id = ? AND tenant_id = ?`,
        [name, type, phone, email, gstin, stateCode, address, creditLimitMinor, JSON.stringify(custom ?? {}), active, party.id, tenantId],
      );
      await audit(q, ctx, { action: 'party.update', entity: 'party', entityId: party.id, detail: { name, type, active } });
    });

    const updated = await ctx.db.one('SELECT * FROM parties WHERE id = ? AND tenant_id = ?', [party.id, tenantId]);
    return { party: formatParty(updated) };
  });

  // Deactivate party (instead of delete)
  r.delete('/api/parties/:id', requirePerm('parties.write'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const party = await ctx.db.one('SELECT * FROM parties WHERE id = ? AND tenant_id = ?', [ctx.params.id, tenantId]);
    if (!party) throw notFound('Party');

    await ctx.db.tx(async (q) => {
      await q.exec('UPDATE parties SET active = false WHERE id = ? AND tenant_id = ?', [party.id, tenantId]);
      await audit(q, ctx, { action: 'party.deactivate', entity: 'party', entityId: party.id });
    });

    return { ok: true };
  });

  // Supplier Payables Summary & Ageing (0-30, 31-60, 60+ days)
  r.get('/api/parties/payables-summary', requirePerm('purchases'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;

    const openPurchases = await ctx.db.query(
      `SELECT p.id, p.supplier_id, p.total_minor, p.balance_minor,
              p.supplier_invoice_date, p.bdate, p.created_at,
              part.name AS supplier_name, part.phone AS supplier_phone, part.gstin AS supplier_gstin
       FROM purchases p
       JOIN parties part ON p.supplier_id = part.id AND part.tenant_id = p.tenant_id
       WHERE p.tenant_id = ? AND p.status != 'voided' AND p.balance_minor > 0
       ORDER BY COALESCE(p.supplier_invoice_date, p.bdate) ASC`,
      [tenantId],
    );

    const supMap = new Map<string, {
      id: string;
      name: string;
      phone: string | null;
      gstin: string | null;
      payableMinor: number;
      openPurchasesCount: number;
      oldestInvoiceDate: string | null;
    }>();

    const now = Date.now();
    let age0_30 = 0;
    let age31_60 = 0;
    let age61_plus = 0;
    let totalPayableMinor = 0;

    for (const pur of openPurchases) {
      const sid = pur.supplier_id ?? pur.supplierId;
      const bal = Number(pur.balance_minor ?? pur.balanceMinor ?? 0);
      totalPayableMinor += bal;

      let sup = supMap.get(sid);
      if (!sup) {
        sup = {
          id: sid,
          name: pur.supplier_name ?? pur.supplierName ?? 'Supplier',
          phone: pur.supplier_phone ?? pur.supplierPhone ?? null,
          gstin: pur.supplier_gstin ?? pur.supplierGstin ?? null,
          payableMinor: 0,
          openPurchasesCount: 0,
          oldestInvoiceDate: pur.supplier_invoice_date ?? pur.supplierInvoiceDate ?? pur.bdate,
        };
        supMap.set(sid, sup);
      }
      sup.payableMinor += bal;
      sup.openPurchasesCount += 1;

      // Ageing calculation
      const invDate = pur.supplier_invoice_date ?? pur.supplierInvoiceDate ?? pur.bdate ?? pur.created_at;
      if (invDate) {
        const daysOld = Math.floor((now - new Date(invDate).getTime()) / (1000 * 60 * 60 * 24));
        if (daysOld <= 30) {
          age0_30 += bal;
        } else if (daysOld <= 60) {
          age31_60 += bal;
        } else {
          age61_plus += bal;
        }
      } else {
        age0_30 += bal;
      }
    }

    const topSuppliers = Array.from(supMap.values()).sort((a, b) => b.payableMinor - a.payableMinor);

    return {
      totalPayableMinor,
      ageing: {
        '0_30': age0_30,
        '31_60': age31_60,
        '61_plus': age61_plus,
        days0_30: age0_30,
        days31_60: age31_60,
        days60Plus: age61_plus,
      },
      topSuppliers: topSuppliers.slice(0, 20),
    };
  });

  // Supplier Ledger & Payment History (Chronological running payable)
  r.get('/api/parties/:id/supplier-ledger', requirePerm('purchases'), async (ctx) => {
    const tenantId = ctx.user!.tenantId;
    const supplier = await ctx.db.one(
      'SELECT * FROM parties WHERE id = ? AND tenant_id = ?',
      [ctx.params.id, tenantId],
    );
    if (!supplier) throw notFound('Supplier');

    // 1. Fetch all purchases
    const purchases = await ctx.db.query(
      `SELECT id, purchase_number, bill_no, supplier_invoice_number, supplier_invoice_date,
              purchase_date, bdate, total_minor, paid_minor, balance_minor, status,
              created_at, void_reason, voided_at
       FROM purchases
       WHERE supplier_id = ? AND tenant_id = ?
       ORDER BY created_at ASC`,
      [supplier.id, tenantId],
    );

    // 2. Fetch all supplier payments
    const payments = await ctx.db.query(
      `SELECT p.id, p.payment_number, p.method, p.amount_minor, p.reference, p.bdate,
              p.payment_date, p.status, p.reversal_reason AS void_reason, p.reversed_at AS voided_at, p.created_at,
              u.name AS recorded_by_name
       FROM payments p
       LEFT JOIN users u ON p.created_by = u.id
       WHERE p.party_id = ? AND p.tenant_id = ? AND p.kind = 'supplier_payment'
       ORDER BY p.created_at ASC`,
      [supplier.id, tenantId],
    );

    // 3. Interleave into chronological ledger
    interface LedgerEntry {
      id: string;
      date: string;
      createdAt: string;
      type: 'purchase' | 'payment';
      refNumber: string;
      description: string;
      status: string;
      amountMinor: number;
      moneyEffect: number; // + for purchase (owed), - for payment (paid)
      runningPayableMinor: number;
      voidReason?: string | null;
    }

    const rawEvents: Array<{
      id: string;
      date: string;
      createdAt: string;
      type: 'purchase' | 'payment';
      refNumber: string;
      description: string;
      status: string;
      amountMinor: number;
      moneyEffect: number;
      voidReason?: string | null;
    }> = [];

    for (const pur of purchases) {
      const isVoided = pur.status === 'voided';
      const purNum = pur.purchase_number ?? pur.purchaseNumber ?? pur.id;
      const invNum = pur.supplier_invoice_number ?? pur.bill_no ?? '';
      const total = Number(pur.total_minor ?? pur.totalMinor ?? 0);
      rawEvents.push({
        id: pur.id,
        date: pur.purchase_date ?? pur.purchaseDate ?? pur.bdate ?? '',
        createdAt: pur.created_at ?? pur.createdAt,
        type: 'purchase',
        refNumber: purNum,
        description: `Purchase ${purNum} • Supplier invoice ${invNum}`,
        status: pur.status || 'posted',
        amountMinor: total,
        moneyEffect: isVoided ? 0 : total,
        voidReason: pur.void_reason ?? pur.voidReason,
      });
    }

    for (const pay of payments) {
      const isVoided = pay.status === 'voided';
      const payNum = pay.payment_number ?? pay.paymentNumber ?? pay.id;
      const amt = Number(pay.amount_minor ?? pay.amountMinor ?? 0);
      const methodStr = (pay.method ?? 'Cash').toUpperCase();
      rawEvents.push({
        id: pay.id,
        date: pay.bdate ?? pay.payment_date ?? '',
        createdAt: pay.created_at ?? pay.createdAt,
        type: 'payment',
        refNumber: payNum,
        description: `Payment ${payNum} • ${methodStr}${pay.reference ? ` (Ref: ${pay.reference})` : ''}`,
        status: pay.status || 'posted',
        amountMinor: amt,
        moneyEffect: isVoided ? 0 : -amt,
        voidReason: pay.void_reason ?? pay.voidReason,
      });
    }

    // Sort ascending by createdAt to compute running payable
    rawEvents.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    let running = 0;
    const ledgerEntries: LedgerEntry[] = [];
    for (const ev of rawEvents) {
      running += ev.moneyEffect;
      ledgerEntries.push({
        ...ev,
        runningPayableMinor: running,
      });
    }

    // Reverse for display (newest first)
    const displayEntries = [...ledgerEntries].reverse();

    const openPurchases = purchases
      .filter((p: any) => p.status !== 'voided' && Number(p.balance_minor ?? p.balanceMinor ?? 0) > 0)
      .map((p: any) => ({
        id: p.id,
        purchaseNumber: p.purchase_number ?? p.purchaseNumber ?? p.id,
        supplierInvoiceNumber: p.supplier_invoice_number ?? p.bill_no ?? '',
        supplierInvoiceDate: p.supplier_invoice_date ?? p.bdate ?? '',
        totalMinor: Number(p.total_minor ?? p.totalMinor ?? 0),
        paidMinor: Number(p.paid_minor ?? p.paidMinor ?? 0),
        balanceMinor: Number(p.balance_minor ?? p.balanceMinor ?? 0),
      }));

    const totalPayableMinor = openPurchases.reduce((sum, p) => sum + p.balanceMinor, 0);

    return {
      supplier: formatParty(supplier),
      totalPayableMinor,
      runningPayableMinor: running,
      openPurchases,
      entries: displayEntries,
      paymentHistory: payments.map((p: any) => ({
        id: p.id,
        paymentNumber: p.payment_number ?? p.paymentNumber ?? p.id,
        method: p.method,
        amountMinor: Number(p.amount_minor ?? p.amountMinor ?? 0),
        reference: p.reference,
        date: p.bdate ?? p.payment_date,
        status: p.status,
        recordedBy: p.recorded_by_name,
        voidReason: p.void_reason,
        createdAt: p.created_at,
      })),
    };
  });
}

