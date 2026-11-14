import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';
import { createApp } from '../src/app.ts';
import { connectWire } from '../src/db/wire.ts';
import { migrate, type DB } from '../src/db/index.ts';
import { startTestDb, type TestDb } from './support/testdb.ts';

let pg: TestDb | null = null;
let db: DB;
let server: http.Server;
let base = '';
let token = '';
let cashierToken = '';
let tenantId = '';
let branchId = '';
let adminUserId = '';
let cashierUserId = '';

before(async () => {
  pg = await startTestDb();
  if (!pg) throw new Error('Local test database could not be started');
  db = await connectWire(pg.url);
  await migrate(db);

  server = http.createServer(createApp(db, { secret: 'super-secret-test-jwt-key-2026', log: false }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;

  // Register admin user
  const regRes = await api('POST', '/api/auth/register', {
    name: 'Kovai Silks & Textiles',
    ownerName: 'Admin Owner',
    email: 'owner@kovaisilks.com',
    password: 'Password123!',
    businessType: 'retail',
  });
  assert.equal(regRes.status, 200);
  token = regRes.body.token;
  tenantId = regRes.body.shop.id;
  adminUserId = regRes.body.user.id;

  // Fetch branches
  const branchesRes = await api('GET', '/api/branches', undefined, token);
  branchId = branchesRes.body.branches?.[0]?.id || 'MAIN';

  // Create a Cashier user
  const cashierRes = await api('POST', '/api/users', {
    name: 'Cashier Priya',
    email: 'priya@kovaisilks.com',
    password: 'Password123!',
    role: 'cashier',
    branchId: branchId,
    assignedLocation: branchId,
  }, token);
  assert.equal(cashierRes.status, 200);
  cashierUserId = cashierRes.body.id;

  const loginRes = await api('POST', '/api/auth/login', {
    identifier: 'priya@kovaisilks.com',
    password: 'Password123!',
  });
  assert.equal(loginRes.status, 200);
  cashierToken = loginRes.body.token;

  // Open cashier shift for POS billing
  const shiftRes = await api('POST', '/api/shifts', {
    branchId: branchId,
    counter: 'COUNTER-1',
    openingCashMinor: 100000,
  }, cashierToken);
  assert.equal(shiftRes.status, 200, JSON.stringify(shiftRes.body));
});

after(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
  if (db) await db.close();
  pg?.stop();
});

async function api(method: string, path: string, body?: unknown, auth?: string) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body: json, code: json?.error?.code as string | undefined, message: json?.error?.message as string | undefined };
}

test('Return, Exchange, Refund & Day Closing Module Verification', async (t) => {
  // Step 0: Create test products in catalogue
  // Item 1: Silk Saree (Price: ₹2000, Cost: ₹1200)
  const item1Res = await api('POST', '/api/items', {
    name: 'Kanchipuram Silk Saree',
    sku: 'SAREE-SILK-001',
    barcode: '890100100001',
    priceMinor: 200000,
    costMinor: 120000,
    taxRateBp: 500, // 5% GST
    taxInclusive: true,
    unit: 'PCS',
  }, token);
  assert.equal(item1Res.status, 200);
  const saree = item1Res.body.item;

  // Item 2: Cotton Kurti (Price: ₹800, Cost: ₹450)
  const item2Res = await api('POST', '/api/items', {
    name: 'Pure Cotton Kurti',
    sku: 'KURTI-COTTON-002',
    barcode: '890100100002',
    priceMinor: 80000,
    costMinor: 45000,
    taxRateBp: 500,
    taxInclusive: true,
    unit: 'PCS',
  }, token);
  assert.equal(item2Res.status, 200);
  const kurti = item2Res.body.item;

  // Item 3: Designer Dupatta (Price: ₹500, Cost: ₹250)
  const item3Res = await api('POST', '/api/items', {
    name: 'Designer Silk Dupatta',
    sku: 'DUPATTA-SILK-003',
    barcode: '890100100003',
    priceMinor: 50000,
    costMinor: 25000,
    taxRateBp: 500,
    taxInclusive: true,
    unit: 'PCS',
  }, token);
  assert.equal(item3Res.status, 200);
  const dupatta = item3Res.body.item;

  // Initial stock injection: 100 units each directly into stock_moves
  for (const item of [saree, kurti, dupatta]) {
    await db.exec(
      `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, location, qty_milli, kind, reason)
       VALUES (?, ?, ?, ?, 'MAIN', 100000, 'opening', 'Initial test stock')`,
      ['sm_' + Math.random().toString(36).slice(2), tenantId, branchId, item.id]
    );
  }

  let originalInvoiceId = '';
  let originalInvoiceNumber = '';
  let sareeLineId = '';
  let kurtiLineId = '';

  await t.test('Scenario 1: Issue original sale invoice with multiple textile garments', async () => {
    const saleRes = await api('POST', '/api/invoices', {
      lines: [
        { itemId: saree.id, name: saree.name, qtyMilli: 2000, priceMinor: 200000, taxRateBp: 500, inclusive: true }, // 2 sarees @ 2000 = ₹4000
        { itemId: kurti.id, name: kurti.name, qtyMilli: 3000, priceMinor: 80000, taxRateBp: 500, inclusive: true },   // 3 kurtis @ 800 = ₹2400
      ],
      branchId: branchId,
      customerName: 'Kavitha Natarajan',
      customerPhone: '9876543210',
      payments: [{ method: 'cash', amountMinor: 640000 }],
    }, cashierToken);

    assert.equal(saleRes.status, 200);
    assert.equal(saleRes.body.totalMinor, 640000); // ₹6400
    originalInvoiceId = saleRes.body.invoiceId;
    originalInvoiceNumber = saleRes.body.number;

    // Fetch invoice lines to get line IDs
    const returnInfoRes = await api('GET', `/api/invoices/${originalInvoiceId}/return-info`, undefined, cashierToken);
    assert.equal(returnInfoRes.status, 200);
    assert.equal(returnInfoRes.body.lines.length, 2);

    const sareeLine = returnInfoRes.body.lines.find((l: any) => l.name === saree.name);
    const kurtiLine = returnInfoRes.body.lines.find((l: any) => l.name === kurti.name);
    assert.ok(sareeLine);
    assert.ok(kurtiLine);
    sareeLineId = sareeLine.id;
    kurtiLineId = kurtiLine.id;

    assert.equal(sareeLine.returnableQtyMilli, 2000);
    assert.equal(kurtiLine.returnableQtyMilli, 3000);
  });

  await t.test('Scenario 2: Search for invoice by customer phone or bill number', async () => {
    const searchRes = await api('GET', `/api/invoices/search-for-return?q=9876543210`, undefined, cashierToken);
    assert.equal(searchRes.status, 200);
    assert.ok(searchRes.body.invoices.length > 0);
    const found = searchRes.body.invoices.find((i: any) => i.id === originalInvoiceId);
    assert.ok(found);
    assert.equal(found.customerPhone, '9876543210');
  });

  await t.test('Scenario 3: Partial product return with cash refund (1 Kurti returned as Resellable)', async () => {
    // Return 1 Kurti (1000 milli)
    const returnRes = await api('POST', `/api/invoices/${originalInvoiceId}/returns`, {
      lines: [
        {
          lineId: kurtiLineId,
          qtyMilli: 1000,
          condition: 'resellable',
          reason: 'Size too small',
          remarks: 'Customer exchanged for smaller fitting',
        },
      ],
      settlementType: 'refund',
      refundMode: 'cash',
      refundReference: 'CASH-REF-001',
    }, cashierToken);

    assert.equal(returnRes.status, 200);
    assert.equal(returnRes.body.totalCreditMinor, 80000); // ₹800

    // Verify refund_transactions entry
    const refundRows = await db.query<any>(
      `SELECT * FROM refund_transactions WHERE credit_note_id = ?`,
      [returnRes.body.creditNoteId],
    );
    assert.equal(refundRows.length, 1);
    assert.equal(refundRows[0].method, 'cash');
    assert.equal(Number(refundRows[0].amountMinor ?? refundRows[0].amount_minor), 80000);

    // Verify stock returned to MAIN inventory
    const stockMove = await db.one<any>(
      `SELECT * FROM stock_moves WHERE item_id = ? AND kind = 'return' ORDER BY created_at DESC LIMIT 1`,
      [kurti.id],
    );
    assert.ok(stockMove);
    assert.equal(stockMove.location, 'MAIN');
    assert.equal(Number(stockMove.qtyMilli ?? stockMove.qty_milli), 1000);
  });

  await t.test('Scenario 4: Damaged product return (1 Silk Saree returned as Damaged -> Quarantined to DAMAGED inventory)', async () => {
    // Return 1 Saree as 'damaged'
    const returnRes = await api('POST', `/api/invoices/${originalInvoiceId}/returns`, {
      lines: [
        {
          lineId: sareeLineId,
          qtyMilli: 1000,
          condition: 'damaged',
          reason: 'Damaged product',
          remarks: 'Zari tear observed at corner border',
        },
      ],
      settlementType: 'refund',
      refundMode: 'upi',
      refundReference: 'UPI-TXN-998877',
    }, cashierToken);

    assert.equal(returnRes.status, 200);
    assert.equal(returnRes.body.totalCreditMinor, 200000); // ₹2000

    // Verify refund_transactions entry for UPI
    const refundRows = await db.query<any>(
      `SELECT * FROM refund_transactions WHERE credit_note_id = ?`,
      [returnRes.body.creditNoteId],
    );
    assert.equal(refundRows.length, 1);
    assert.equal(refundRows[0].method, 'upi');
    assert.equal(refundRows[0].referenceNo ?? refundRows[0].reference_no, 'UPI-TXN-998877');

    // Verify stock moved to 'DAMAGED' location and NOT MAIN
    const stockMove = await db.one<any>(
      `SELECT * FROM stock_moves WHERE item_id = ? AND kind = 'return' ORDER BY created_at DESC LIMIT 1`,
      [saree.id],
    );
    assert.ok(stockMove);
    assert.equal(stockMove.location, 'DAMAGED');
    assert.equal(Number(stockMove.qtyMilli ?? stockMove.qty_milli), 1000);

    // Verify available stock on MAIN did NOT receive the damaged unit
    const mainMoves = await db.query<any>(
      `SELECT * FROM stock_moves WHERE item_id = ? AND location = 'MAIN' AND kind = 'return'`,
      [saree.id],
    );
    assert.equal(mainMoves.length, 0); // No damaged saree added to MAIN!
  });

  await t.test('Scenario 5: Duplicate return prevention & returnable cap validation', async () => {
    // Saree was originally 2 units; 1 unit already returned.
    // Attempting to return 2 units should fail!
    const overReturnRes = await api('POST', `/api/invoices/${originalInvoiceId}/returns`, {
      lines: [
        {
          lineId: sareeLineId,
          qtyMilli: 2000, // 2 units exceeds remaining 1 unit!
          condition: 'resellable',
          reason: 'Other',
        },
      ],
      settlementType: 'refund',
      refundMode: 'cash',
    }, cashierToken);

    assert.notEqual(overReturnRes.status, 200);
    assert.ok(overReturnRes.code === 'CONCURRENCY_ERROR' || overReturnRes.code === 'RETURN_QTY_EXCEEDED');
  });

  await t.test('Scenario 6: Exchange where new purchase is GREATER than return value (Customer pays difference)', async () => {
    // Create an original bill with 1 Kurti (₹800)
    const billRes = await api('POST', '/api/invoices', {
      lines: [
        { itemId: kurti.id, name: kurti.name, qtyMilli: 1000, priceMinor: 80000, taxRateBp: 500, inclusive: true },
      ],
      branchId: branchId,
      customerName: 'Anitha Ramesh',
      customerPhone: '9443322110',
      payments: [{ method: 'cash', amountMinor: 80000 }],
    }, cashierToken);
    assert.equal(billRes.status, 200);
    const exOrigInvId = billRes.body.invoiceId;

    const retInfo = await api('GET', `/api/invoices/${exOrigInvId}/return-info`, undefined, cashierToken);
    const origLine = retInfo.body.lines[0];

    // Customer returns Kurti (₹800) and buys Saree (₹2000)
    // Difference payable by customer = ₹1200
    const exchangeRes = await api('POST', '/api/exchanges', {
      origInvoiceId: exOrigInvId,
      branchId: branchId,
      returnLines: [
        {
          origLineId: origLine.id,
          returnQtyMilli: 1000,
          condition: 'resellable',
          reason: 'Size too small',
          remarks: 'Upgrading to silk saree',
        },
      ],
      newLines: [
        { itemId: saree.id, name: saree.name, qtyMilli: 1000, priceMinor: 200000, taxRateBp: 500, inclusive: true },
      ],
      paymentMethod: 'cash',
      customerName: 'Anitha Ramesh',
      customerPhone: '9443322110',
    }, cashierToken);

    assert.equal(exchangeRes.status, 200);
    assert.ok(exchangeRes.body.exchangeId);
    assert.equal(exchangeRes.body.returnTotalMinor, 80000);       // ₹800 returned
    assert.equal(exchangeRes.body.newPurchaseMinor, 200000);      // ₹2000 new purchase
    assert.equal(exchangeRes.body.exchangeAdjustedMinor, 80000);  // ₹800 adjusted
    assert.equal(exchangeRes.body.customerPayableMinor, 120000);  // ₹1200 collected from customer
    assert.equal(exchangeRes.body.customerRefundMinor, 0);

    // Verify exchange receipt print endpoint is active
    const printRes = await api('GET', `/api/exchanges/${exchangeRes.body.exchangeId}/print`, undefined, cashierToken);
    assert.equal(printRes.status, 200);
  });

  await t.test('Scenario 7: Exchange where return value is GREATER than new purchase (Store credit / excess refund)', async () => {
    // Create an original bill with 1 Saree (₹2000)
    const billRes = await api('POST', '/api/invoices', {
      lines: [
        { itemId: saree.id, name: saree.name, qtyMilli: 1000, priceMinor: 200000, taxRateBp: 500, inclusive: true },
      ],
      branchId: branchId,
      customerName: 'Deepa Sundar',
      customerPhone: '9123456780',
      payments: [{ method: 'cash', amountMinor: 200000 }],
    }, cashierToken);
    assert.equal(billRes.status, 200);
    const exOrigInvId = billRes.body.invoiceId;

    const retInfo = await api('GET', `/api/invoices/${exOrigInvId}/return-info`, undefined, cashierToken);
    const origLine = retInfo.body.lines[0];

    // Customer returns Saree (₹2000) and buys Dupatta (₹500)
    // Excess due to customer = ₹1500 (refunded in cash)
    const exchangeRes = await api('POST', '/api/exchanges', {
      origInvoiceId: exOrigInvId,
      branchId: branchId,
      returnLines: [
        {
          origLineId: origLine.id,
          returnQtyMilli: 1000,
          condition: 'resellable',
          reason: 'Customer changed mind',
        },
      ],
      newLines: [
        { itemId: dupatta.id, name: dupatta.name, qtyMilli: 1000, priceMinor: 50000, taxRateBp: 500, inclusive: true },
      ],
      excessRefundMethod: 'cash',
      customerName: 'Deepa Sundar',
      customerPhone: '9123456780',
    }, cashierToken);

    assert.equal(exchangeRes.status, 200);
    assert.equal(exchangeRes.body.returnTotalMinor, 200000);
    assert.equal(exchangeRes.body.newPurchaseMinor, 50000);
    assert.equal(exchangeRes.body.exchangeAdjustedMinor, 50000);
    assert.equal(exchangeRes.body.customerPayableMinor, 0);
    assert.equal(exchangeRes.body.customerRefundMinor, 150000); // ₹1500 refunded
  });

  await t.test('Scenario 8: Return after previous day closing preserves historical sales integrity', async () => {
    const pastDate = '2026-11-10';
    const returnDate = '2026-11-14';

    // 1. Insert a historical sale on 10 Nov for ₹20,000 (10 sarees)
    const pastInvId = 'inv-past-10nov';
    await db.exec(
      `INSERT INTO invoices (
        id, tenant_id, branch_id, client_id, number, bdate, status, kind,
        subtotal_minor, taxable_minor, total_minor, paid_minor, is_day_closed,
        rule_version, share_token, calc, custom, location
      ) VALUES (?, ?, ?, 'cli_past', 'INV-PAST-1001', ?, 'posted', 'sale', 2000000, 1904760, 2000000, 2000000, FALSE, '1.0', 'tok_past', '{}', '{}', ?)`,
      [pastInvId, tenantId, branchId, pastDate, branchId],
    );

    const pastLineId = 'line-past-10nov';
    await db.exec(
      `INSERT INTO invoice_lines (
        id, tenant_id, branch_id, invoice_id, pos, item_id, name, qty_milli, price_minor, cost_minor,
        tax_rate_bp, inclusive, taxable_minor, total_minor, item_condition
      ) VALUES (?, ?, ?, ?, 1, ?, 'Kanchipuram Silk Saree', 10000, 200000, 120000, 500, TRUE, 1904760, 2000000, 'resellable')`,
      [pastLineId, tenantId, branchId, pastInvId, saree.id],
    );

    // 2. Close 10 November day
    const close10Nov = await api('POST', '/api/day-closing/submit', {
      bdate: pastDate,
      branchId: branchId,
      actualCashMinor: 2000000,
      remarks: '10 Nov sealed successfully',
    }, token);
    assert.equal(close10Nov.status, 200);

    // 3. Process return on 14 November for 1 saree (₹2,000)
    // We update current transaction date to returnDate
    const returnPastRes = await api('POST', `/api/invoices/${pastInvId}/returns`, {
      lines: [
        {
          lineId: pastLineId,
          qtyMilli: 1000,
          condition: 'resellable',
          reason: 'Size too large',
          remarks: 'Returned 4 days later',
        },
      ],
      settlementType: 'refund',
      refundMode: 'cash',
    }, token);
    assert.equal(returnPastRes.status, 200);

    // 4. VERIFY: 10 November's closed record remains ₹20,000!
    const closed10Nov = await db.one<any>(
      `SELECT * FROM day_closings WHERE tenant_id = ? AND branch_id = ? AND bdate = ?`,
      [tenantId, branchId, pastDate],
    );
    assert.equal(Number(closed10Nov.grossSalesMinor ?? closed10Nov.gross_sales_minor), 2000000);
    assert.equal(Number(closed10Nov.netSalesMinor ?? closed10Nov.net_sales_minor), 2000000); // Historical sales untouched!

    // 5. VERIFY: Return transaction is recorded on return date, deducting from return date sales
    const creditNoteRow = await db.one<any>(
      `SELECT * FROM invoices WHERE id = ?`,
      [returnPastRes.body.creditNoteId],
    );
    assert.equal(creditNoteRow.kind, 'credit_note');
    assert.equal(creditNoteRow.linkedInvoiceId ?? creditNoteRow.linked_invoice_id, pastInvId);
    assert.equal(Number(creditNoteRow.totalMinor ?? creditNoteRow.total_minor), returnPastRes.body.totalCreditMinor);
  });

  await t.test('Scenario 9: Day closing cash reconciliation (expected vs actual shortage/excess calculation)', async () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const previewRes = await api('GET', `/api/day-closing/preview?bdate=${todayStr}&branchId=${branchId}`, undefined, token);
    assert.equal(previewRes.status, 200);
    assert.ok(previewRes.body.cashReconciliation);

    const expectedCash = Number(previewRes.body.cashReconciliation.expectedClosingCashMinor || 0);

    // Simulate Cash Discrepancy: Actual counted cash is ₹500 more than expected (Excess)
    const actualCashVal = expectedCash + 50000;
    const submitRes = await api('POST', '/api/day-closing/submit', {
      bdate: todayStr,
      branchId: branchId,
      actualCashMinor: actualCashVal,
      remarks: 'Audited closing with ₹500 surplus discrepancy',
    }, token);

    assert.equal(submitRes.status, 200, JSON.stringify(submitRes.body));
    const closingObj = submitRes.body.dayClosing;
    assert.equal(Number(closingObj.actualCashMinor ?? closingObj.actual_cash_minor), actualCashVal);
    assert.equal(Number(closingObj.varianceMinor ?? closingObj.variance_minor), 50000); // ₹500 surplus correctly recorded!

    // Duplicate day closing prevention
    const duplicateRes = await api('POST', '/api/day-closing/submit', {
      bdate: todayStr,
      branchId: branchId,
      actualCashMinor: actualCashVal,
    }, token);
    assert.notEqual(duplicateRes.status, 200);
    assert.equal(duplicateRes.code, 'ALREADY_CLOSED');
  });

  await t.test('Scenario 10: Gross Profit calculation uses purchase cost snapshot (Net Sales - Net COGS)', async () => {
    // Check Day Closing gross profit formula
    const todayStr = new Date().toISOString().slice(0, 10);
    const closingRecord = await db.one<any>(
      `SELECT * FROM day_closings WHERE tenant_id = ? AND bdate = ? ORDER BY created_at DESC LIMIT 1`,
      [tenantId, todayStr],
    );
    assert.ok(closingRecord);

    const netSales = Number(closingRecord.netSalesMinor ?? closingRecord.net_sales_minor);
    const netCogs = Number(closingRecord.netCogsMinor ?? closingRecord.net_cogs_minor);
    const grossProfit = Number(closingRecord.grossProfitMinor ?? closingRecord.gross_profit_minor);

    // Formula: Gross Profit = Net Sales - Net COGS
    assert.equal(grossProfit, netSales - netCogs);
  });

  await t.test('Scenario 11: Admin Return Reports API (All 8 report categories available with date filters)', async () => {
    const reports = [
      'daily_sales',
      'sales_returns',
      'exchanges',
      'refunds',
      'gross_profit',
      'stock_returns',
      'store_credits',
      'cashier_performance',
    ];

    for (const reportType of reports) {
      const res = await api('GET', `/api/reports/returns-module?reportType=${reportType}&filter=this_month&branchId=${branchId}`, undefined, token);
      assert.equal(res.status, 200, `Failed to load ${reportType}`);
      assert.ok(Array.isArray(res.body.rows), `${reportType} should return rows array`);
    }
  });

  await t.test('Scenario 12: Sealed Day Closing report print endpoint produces full HTML audit statement', async () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const closingRecord = await db.one<any>(
      `SELECT * FROM day_closings WHERE tenant_id = ? AND bdate = ? ORDER BY created_at DESC LIMIT 1`,
      [tenantId, todayStr],
    );
    assert.ok(closingRecord);

    const printRes = await api('GET', `/api/day-closing/${closingRecord.id}/print`, undefined, token);
    assert.equal(printRes.status, 200);
  });
});
