import assert from 'node:assert/strict';
import http from 'node:http';
import test, { after, before } from 'node:test';
import { createApp } from '../src/app.ts';
import { connectDb, migrate, type DB } from '../src/db/index.ts';
import { signToken, hashPassword, passwordStamp } from '../src/security.ts';
import { renderBillDoc } from '../../shared/bill.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-long-enough-32-chars-at-least';
const TEST_TENANT = 't_wh_test_' + Date.now();
const BRANCH_ID = 'b_wh_main_' + Date.now();

let db: DB;
let server: http.Server;
let base = '';
let ownerToken = '';
let ownerId = '';

async function api(method: string, path: string, headers: Record<string, string> = {}, body?: any, token?: string) {
  const res = await fetch(base + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-branch-id': BRANCH_ID,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { }
  return { status: res.status, body: json, text };
}

before(async () => {
  db = await connectDb();
  await migrate(db);
  server = http.createServer(createApp(db, { secret: JWT_SECRET, log: false }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;

  // 1. Setup Tenant and Branch
  await db.exec(
    `INSERT INTO tenants (id, name, business_type, state_code, gstin, address, phone)
     VALUES (?, 'StyleWell Co. Wholesale', 'retail', '24', '24ACAFS6901Q1ZT', 'G 29-30-31 Citi Industrial Estate Surat', '9879448228')`,
    [TEST_TENANT]
  );
  await db.exec(
    `INSERT INTO branches (id, tenant_id, name, code, active) VALUES (?, ?, 'Head Office Surat', 'SURAT', true)`,
    [BRANCH_ID, TEST_TENANT]
  );

  // 2. Setup Owner
  const pwd = hashPassword('OwnerPass123!');
  ownerId = 'u_wh_owner_' + Date.now();
  await db.exec(
    `INSERT INTO users (id, tenant_id, branch_id, name, email, password_hash, role, active)
     VALUES (?, ?, ?, 'Wholesale Owner', ?, ?, 'owner', true)`,
    [ownerId, TEST_TENANT, BRANCH_ID, `owner_wh_${Date.now()}@stylewell.local`, pwd]
  );
  ownerToken = signToken({ sub: ownerId, tid: TEST_TENANT, ph: passwordStamp(pwd), role: 'owner', branchId: BRANCH_ID }, JWT_SECRET, 3600);
});

after(async () => {
  try {
    if (server) {
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    }
    if (db) {
      await db.exec('DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE tenant_id = ?)', [TEST_TENANT]);
      await db.exec('DELETE FROM payments WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM stock_moves WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM invoices WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM items WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM parties WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM users WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM branches WHERE tenant_id = ?', [TEST_TENANT]);
      await db.exec('DELETE FROM tenants WHERE id = ?', [TEST_TENANT]);
      await db.close();
    }
  } catch { }
  process.exit(0);
});

test('1. Product item supports wholesale price and minimum wholesale quantity', async () => {
  const createRes = await api('POST', '/api/items', {}, {
    name: 'Fiona Silk Saree',
    sku: 'FIONA-01',
    barcode: 'FIONA88801',
    priceMinor: 65000, // Retail ₹650.00
    wholesalePriceMinor: 55500, // Wholesale ₹555.00
    minWholesaleQtyMilli: 16000, // 16 Pcs
    taxRateBp: 500,
    hsn: '5407',
    unit: 'Pcs',
  }, ownerToken);

  assert.equal(createRes.status, 200);
  assert.equal(createRes.body.item.wholesalePriceMinor, 55500);
  assert.equal(createRes.body.item.minWholesaleQtyMilli, 16000);
  assert.equal(createRes.body.item.priceMinor, 65000);

  // Update item wholesale price
  const updateRes = await api('PATCH', `/api/items/${createRes.body.item.id}`, {}, {
    wholesalePriceMinor: 54000,
  }, ownerToken);

  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.item.wholesalePriceMinor, 54000);
});

test('2. Wholesale customer management prevents duplicate phone and GSTIN', async () => {
  const phone = '937470' + Math.floor(1000 + Math.random() * 9000);
  const gstin = '24AAACR9377A1ZH';

  const cust1 = await api('POST', '/api/parties', {}, {
    name: 'Rikhabdas Gulabchand Fabrics Pvt Ltd',
    type: 'customer',
    customerType: 'wholesale',
    contactPerson: 'Mr. Rikhabdas',
    phone,
    gstin,
    address: '27 B Plot No. 45-A Central Road No. 3 Surat',
    creditLimitMinor: 5000000, // ₹50,000 credit limit
  }, ownerToken);

  assert.equal(cust1.status, 200);
  assert.equal(cust1.body.party.name, 'Rikhabdas Gulabchand Fabrics Pvt Ltd');

  // Try duplicate phone
  const dupPhone = await api('POST', '/api/parties', {}, {
    name: 'Duplicate Phone Buyer',
    type: 'customer',
    phone,
  }, ownerToken);
  if (dupPhone.status !== 409) {
    console.error('Test 2 dupPhone:', dupPhone.status, dupPhone.text);
  }
  assert.equal(dupPhone.status, 409);

  // Try duplicate GSTIN
  const dupGstin = await api('POST', '/api/parties', {}, {
    name: 'Duplicate GSTIN Buyer',
    type: 'customer',
    phone: '9898000001',
    gstin,
  }, ownerToken);
  if (dupGstin.status !== 409) {
    console.error('Test 2 dupGstin:', dupGstin.status, dupGstin.text);
  }
  assert.equal(dupGstin.status, 409);
});

test('3. Generates Wholesale Invoice with WH prefix, shared inventory deduction, and clean B2B layout without transport details', async () => {
  // 1. Create product and inward initial stock
  const itemRes = await api('POST', '/api/items', {}, {
    name: 'Lucknowi Vol.3 Fabric',
    sku: 'LUCK-V3',
    priceMinor: 65000,
    wholesalePriceMinor: 55500,
    minWholesaleQtyMilli: 10000,
    taxRateBp: 500,
    hsn: '5407',
    unit: 'Pcs',
  }, ownerToken);
  assert.equal(itemRes.status, 200);
  const item = itemRes.body.item;

  // Stock inward: 100 units
  await db.exec(
    `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, kind, qty_milli, created_at)
     VALUES (?, ?, ?, ?, 'opening', 100000, now())`,
    ['sm_in_' + Date.now(), TEST_TENANT, BRANCH_ID, item.id]
  );

  // 2. Create wholesale customer
  const custRes = await api('POST', '/api/parties', {}, {
    name: 'Suhani Fashions Surat',
    type: 'customer',
    phone: '98251' + Math.floor(10000 + Math.random() * 90000),
    gstin: '27AAPFU0939F1ZV',
    address: 'Ring Road Surat',
    creditLimitMinor: 10000000, // ₹1,00,000
  }, ownerToken);
  assert.equal(custRes.status, 200);
  const customer = custRes.body.party;

  // 3. Issue Wholesale Invoice
  const invoiceRes = await api('POST', '/api/invoices', {}, {
    invoiceType: 'wholesale',
    branchId: BRANCH_ID,
    customerId: customer.id,
    customer: {
      name: customer.name,
      phone: customer.phone,
      gstin: customer.gstin,
      address: customer.address,
    },
    lines: [
      {
        itemId: item.id,
        name: item.name,
        qtyMilli: 16000, // 16 units
        priceMinor: 55500, // ₹555.00
        taxRateBp: 500,
        discountMinor: 0,
        hsn: '5407',
        unit: 'Pcs',
      },
    ],
    payments: [
      {
        mode: 'bank',
        amountMinor: 500000, // ₹5,000 paid via NEFT
        reference: 'NEFT-BARB20261114',
      },
      {
        mode: 'credit',
        amountMinor: 432800, // Balance on credit
      },
    ],
    custom: {
      paymentTerms: 'NEFT / RTGS',
      billingAddress: 'Ring Road Surat',
      shippingAddress: 'Ring Road Surat',
    },
  }, ownerToken);

  if (invoiceRes.status !== 200) {
    console.error('Test 3 invoiceRes:', invoiceRes.status, invoiceRes.text);
  }
  assert.equal(invoiceRes.status, 200);
  const inv = invoiceRes.body.invoice || invoiceRes.body;
  assert.ok(inv.number.startsWith('WH-') || inv.number.startsWith('WH'), `Expected WH prefix, got: ${inv.number}`);
  assert.equal(inv.invoiceType, 'wholesale');

  // Verify stock deduction from shared inventory
  const moves = await db.query<{ kind: string; qtyMilli: number }>(
    `SELECT kind, qty_milli as "qtyMilli" FROM stock_moves WHERE item_id = ? AND kind = 'sale'`,
    [item.id]
  );
  assert.ok(moves.length > 0, 'Must have a sale stock move');
  assert.equal(moves[0].qtyMilli, -16000, 'Must deduct 16000 milli (16 units)');

  // 4. Test Print Endpoint produces Traditional A4 format without transport metadata
  const printRes = await api('GET', `/api/invoices/${inv.id}/print`, {}, undefined, ownerToken);
  assert.equal(printRes.status, 200);
  assert.ok(printRes.text.includes('TAX INVOICE'), 'Must have TAX INVOICE title');
  assert.equal(printRes.text.includes('Goods Sent By:'), false, 'Must NOT contain transport: Goods Sent By');
  assert.equal(printRes.text.includes('L.R. No :'), false, 'Must NOT contain transport: L.R. No');
  assert.equal(printRes.text.includes('Broker :'), false, 'Must NOT contain transport: Broker');
  assert.equal(printRes.text.includes('Haste :'), false, 'Must NOT contain transport: Haste');
  assert.equal(printRes.text.includes('BANK DETAILS'), false, 'Must NOT contain BANK DETAILS header');
  assert.equal(printRes.text.includes('AC NO.'), false, 'Must NOT contain AC NO.');
  assert.equal(printRes.text.includes('IFSC CODE'), false, 'Must NOT contain IFSC CODE');
  assert.equal(printRes.text.includes('SHREE KRISHNA SUPERMARKET'), false, 'Must NOT display retail shop name on wholesale invoice');
  assert.ok(printRes.text.includes('Total Amount in Words :'), 'Must have Total Amount in Words');
  assert.ok(printRes.text.includes('Certified that the particulars given'), 'Must have statutory tax certification');
  assert.ok(printRes.text.includes('Place of Supply'), 'Must contain Place of Supply');
  assert.ok(printRes.text.includes('Reverse Charge'), 'Must contain Reverse Charge');
  assert.ok(printRes.text.includes('HSN CODE'), 'Must have HSN summary table');
  assert.ok(printRes.text.includes('Authorised Signatory'), 'Must have Authorised Signatory');
});

test('4. Separate Business Identity for Retail (POS) and Wholesale (B2B)', async () => {
  // Update shop invoice profiles with separate trading names
  const patchRes = await api('PUT', '/api/shop', {}, {
    invoiceProfiles: {
      retail: {
        enabled: true,
        displayName: 'Sri Krishna Supermarket',
        legalName: 'Sri Krishna Retail Enterprises Pvt Ltd',
        gstin: '24ACAFS6901Q1ZT',
        address: 'Main Bazaar Surat',
        phone: '9879001122',
        invoicePrefix: 'RET',
        paper: 'thermal80',
        bankDetails: {
          bankName: 'STATE BANK OF INDIA',
          accountNo: '33445566778',
          branchName: 'Surat Main Branch',
          ifscCode: 'SBIN0000123',
        },
        terms: 'Goods once sold will not be taken back.',
      },
      wholesale: {
        enabled: true,
        displayName: 'SKS Wholesale Traders',
        legalName: 'SKS Trading & Distribution LLP',
        gstin: '24ACAFS6901Q1ZT',
        address: 'G-29 Textile Hub Surat',
        phone: '9879448899',
        email: 'billing@skswholesale.com',
        invoicePrefix: 'SKS',
        paper: 'wholesale_a4',
        bankDetails: {
          bankName: 'HDFC BANK',
          accountNo: '50200012345678',
          branchName: 'Ring Road Surat',
          ifscCode: 'HDFC0001234',
        },
        terms: 'Subject to Surat Jurisdiction.',
      },
    },
  }, ownerToken);
  assert.equal(patchRes.status, 200);

  // 1. Create a product for testing
  const itemRes = await api('POST', '/api/items', {}, {
    name: 'SKS Basmati Rice 10kg',
    sku: 'RICE-10KG',
    priceMinor: 120000, // ₹1200 retail
    wholesalePriceMinor: 95000, // ₹950 wholesale
    taxRateBp: 500,
    unit: 'Bags',
  }, ownerToken);
  assert.equal(itemRes.status, 200);
  const it = itemRes.body.item;

  // Inward stock
  await db.exec(
    `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, kind, qty_milli, created_at)
     VALUES (?, ?, ?, ?, 'opening', 50000, now())`,
    ['sm_test4_' + Date.now(), TEST_TENANT, BRANCH_ID, it.id]
  );

  // 2. Open shift for retail billing
  const openShiftRes = await api('POST', '/api/shifts', {}, {
    branchId: BRANCH_ID,
    counter: 'COUNTER-1',
    openingCashMinor: 100000,
  }, ownerToken);
  assert.equal(openShiftRes.status, 200);

  // 3. Issue Retail Invoice
  const retInvRes = await api('POST', '/api/invoices', {}, {
    invoiceType: 'retail',
    branchId: BRANCH_ID,
    customer: { name: 'Retail Walk-in Customer', phone: '9988776655' },
    lines: [
      {
        itemId: it.id,
        name: it.name,
        qtyMilli: 1000,
        priceMinor: 120000, // retail price
        taxRateBp: 500,
        unit: 'Bags',
      },
    ],
    payments: [{ mode: 'cash', amountMinor: 120000 }],
  }, ownerToken);
  if (retInvRes.status !== 200) {
    console.error('retInvRes:', retInvRes.status, retInvRes.text);
  }
  assert.equal(retInvRes.status, 200);
  const retInv = retInvRes.body.invoice || retInvRes.body;
  assert.ok(retInv.number.startsWith('RET-') || retInv.number.startsWith('RET'), `Expected RET prefix, got: ${retInv.number}`);

  // Print Retail Invoice -> check Retail Branding
  const retPrintRes = await api('GET', `/api/invoices/${retInv.id}/print`, {}, undefined, ownerToken);
  assert.equal(retPrintRes.status, 200);
  assert.ok(retPrintRes.text.includes('Sri Krishna Supermarket'), 'Retail print must use Retail Display Name');

  // 4. Issue Wholesale Invoice
  const whPartyRes = await api('POST', '/api/parties', {}, {
    name: 'Metro Grocers Distribution',
    type: 'customer',
    phone: '98252' + Math.floor(10000 + Math.random() * 90000),
  }, ownerToken);
  assert.equal(whPartyRes.status, 200);

  const whInvRes = await api('POST', '/api/invoices', {}, {
    invoiceType: 'wholesale',
    branchId: BRANCH_ID,
    customerId: whPartyRes.body.party.id,
    customer: { name: whPartyRes.body.party.name, phone: whPartyRes.body.party.phone },
    lines: [
      {
        itemId: it.id,
        name: it.name,
        qtyMilli: 10000, // 10 bags bulk
        priceMinor: 95000, // wholesale price
        taxRateBp: 500,
        unit: 'Bags',
      },
    ],
    payments: [{ mode: 'bank', amountMinor: 950000 }],
  }, ownerToken);
  assert.equal(whInvRes.status, 200);
  const whInv = whInvRes.body.invoice || whInvRes.body;
  assert.ok(whInv.number.startsWith('SKS-') || whInv.number.startsWith('SKS'), `Expected SKS prefix, got: ${whInv.number}`);

  // Print Wholesale Invoice -> check Wholesale Branding
  const whPrintRes = await api('GET', `/api/invoices/${whInv.id}/print`, {}, undefined, ownerToken);
  assert.equal(whPrintRes.status, 200);
  assert.ok(whPrintRes.text.includes('SKS Wholesale Traders'), 'Wholesale print must use Wholesale Display Name');
  assert.ok(whPrintRes.text.includes('SKS Trading &amp; Distribution LLP') || whPrintRes.text.includes('SKS Trading & Distribution LLP'), 'Wholesale print must include Legal Entity Name');
  assert.equal(whPrintRes.text.includes('BANK DETAILS'), false, 'Wholesale print must NOT contain BANK DETAILS');
  assert.equal(whPrintRes.text.includes('HDFC BANK'), false, 'Wholesale print must NOT display bank name');
  assert.equal(whPrintRes.text.includes('50200012345678'), false, 'Wholesale print must NOT display account number');
  assert.equal(whPrintRes.text.includes('Goods Sent By:'), false, 'Wholesale print must NOT contain Goods Sent By');

  // Verify updating wholesaleBusinessName directly updates wholesale display name
  const updateNameRes = await api('PUT', '/api/shop', {}, {
    wholesaleBusinessName: 'ABC Wholesale Traders',
  }, ownerToken);
  assert.equal(updateNameRes.status, 200);
  const updatedShop = updateNameRes.body.shop || updateNameRes.body;
  assert.equal(updatedShop.wholesaleBusinessName, 'ABC Wholesale Traders');
  assert.equal(updatedShop.invoiceProfiles.wholesale.displayName, 'ABC Wholesale Traders');
});
