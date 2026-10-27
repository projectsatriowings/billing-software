import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calcExpense,
  normalizeInvoiceNumber,
  compareBookAnd2B,
  validateGstr2bJson,
  validateGstr2bCsv,
  STANDARD_EXPENSE_CATEGORIES,
} from '../gst.ts';

test('STANDARD_EXPENSE_CATEGORIES includes retail essentials', () => {
  const ids = STANDARD_EXPENSE_CATEGORIES.map((c) => c.id);
  assert.ok(ids.includes('rent'));
  assert.ok(ids.includes('electricity'));
  assert.ok(ids.includes('packaging'));
  assert.ok(ids.includes('transport'));
  assert.ok(ids.includes('advertising'));
  assert.ok(ids.includes('maintenance'));
});

test('calcExpense with intra-state 18% exclusive tax (Packaging ₹1,000)', () => {
  const res = calcExpense({
    amountMinor: 100000,
    taxRateBp: 1800,
    taxInclusive: false,
    intraState: true,
    gstTreatment: 'regular',
    itcEligibility: 'eligible',
  });

  assert.equal(res.taxableMinor, 100000); // ₹1,000.00
  assert.equal(res.cgstMinor, 9000); // 9% = ₹90.00
  assert.equal(res.sgstMinor, 9000); // 9% = ₹90.00
  assert.equal(res.igstMinor, 0);
  assert.equal(res.totalGstMinor, 18000); // ₹180.00
  assert.equal(res.totalMinor, 118000); // ₹1,180.00
  assert.equal(res.itcMinor, 18000); // full ITC eligible
});

test('calcExpense with inter-state 18% exclusive tax (Advertising ₹5,000)', () => {
  const res = calcExpense({
    amountMinor: 500000,
    taxRateBp: 1800,
    taxInclusive: false,
    intraState: false,
    gstTreatment: 'regular',
    itcEligibility: 'eligible',
  });

  assert.equal(res.taxableMinor, 500000);
  assert.equal(res.cgstMinor, 0);
  assert.equal(res.sgstMinor, 0);
  assert.equal(res.igstMinor, 90000); // ₹900.00
  assert.equal(res.totalGstMinor, 90000);
  assert.equal(res.totalMinor, 590000);
  assert.equal(res.itcMinor, 90000);
});

test('calcExpense with inclusive tax (Shop Rent ₹11,800 @ 18% inclusive)', () => {
  const res = calcExpense({
    amountMinor: 1180000,
    taxRateBp: 1800,
    taxInclusive: true,
    intraState: true,
    gstTreatment: 'regular',
    itcEligibility: 'eligible',
  });

  // Base taxable = 1,180,000 * 10,000 / 11,800 = 1,000,000
  assert.equal(res.taxableMinor, 1000000);
  assert.equal(res.totalGstMinor, 180000);
  assert.equal(res.cgstMinor, 90000);
  assert.equal(res.sgstMinor, 90000);
  assert.equal(res.totalMinor, 1180000);
  assert.equal(res.itcMinor, 180000);
});

test('calcExpense with ineligible / blocked ITC (Sec 17(5) Refreshment ₹500)', () => {
  const res = calcExpense({
    amountMinor: 50000,
    taxRateBp: 500,
    taxInclusive: false,
    intraState: true,
    gstTreatment: 'regular',
    itcEligibility: 'ineligible',
  });

  assert.equal(res.totalGstMinor, 2500); // ₹25 GST paid
  assert.equal(res.itcMinor, 0); // ₹0 ITC claimed
  assert.equal(res.totalMinor, 52500);
});

test('calcExpense with non_gst or exempt treatment yields 0 tax and 0 ITC', () => {
  const res = calcExpense({
    amountMinor: 250000,
    taxRateBp: 1800,
    taxInclusive: false,
    intraState: true,
    gstTreatment: 'exempt',
    itcEligibility: 'eligible',
  });

  assert.equal(res.taxableMinor, 250000);
  assert.equal(res.totalGstMinor, 0);
  assert.equal(res.itcMinor, 0);
  assert.equal(res.totalMinor, 250000);
});

test('normalizeInvoiceNumber removes delimiters and handles case', () => {
  assert.equal(normalizeInvoiceNumber('INV/2026/001'), 'INV2026001');
  assert.equal(normalizeInvoiceNumber('inv-0042-b'), 'INV0042B');
  assert.equal(normalizeInvoiceNumber('  B-26 / 99  '), 'B2699');
});

test('compareBookAnd2B detects exact match within rounding tolerance', () => {
  const book = {
    docType: 'purchase' as const,
    docId: 'pur_1',
    docNumber: 'PUR-001',
    supplierName: 'ABC Textiles',
    supplierGstin: '33AABCT1234A1Z5',
    supplierInvoiceNumber: 'INV/2026/001',
    supplierInvoiceDate: '2026-05-10',
    taxableMinor: 100000,
    cgstMinor: 9000,
    sgstMinor: 9000,
    igstMinor: 0,
    totalGstMinor: 18000,
  };

  const g2b = {
    id: 'g2b_1',
    supplierGstin: '33AABCT1234A1Z5',
    invoiceNumber: 'INV2026001',
    invoiceDate: '10-05-2026',
    taxableMinor: 100050, // 50 paise diff
    cgstMinor: 9010,
    sgstMinor: 9010,
    igstMinor: 0,
    totalGstMinor: 18020, // 20 paise diff
  };

  const matchResult = compareBookAnd2B(book, g2b);
  assert.equal(matchResult.status, 'matched');
});

test('compareBookAnd2B flags taxable mismatch when exceeding tolerance', () => {
  const book = {
    docType: 'purchase' as const,
    docId: 'pur_1',
    docNumber: 'PUR-001',
    supplierName: 'ABC Textiles',
    supplierGstin: '33AABCT1234A1Z5',
    supplierInvoiceNumber: 'INV/2026/001',
    supplierInvoiceDate: '2026-05-10',
    taxableMinor: 100000,
    cgstMinor: 9000,
    sgstMinor: 9000,
    igstMinor: 0,
    totalGstMinor: 18000,
  };

  const g2b = {
    id: 'g2b_1',
    supplierGstin: '33AABCT1234A1Z5',
    invoiceNumber: 'INV2026001',
    invoiceDate: '10-05-2026',
    taxableMinor: 120000, // ₹200 diff
    cgstMinor: 10800,
    sgstMinor: 10800,
    igstMinor: 0,
    totalGstMinor: 21600,
  };

  const matchResult = compareBookAnd2B(book, g2b);
  assert.equal(matchResult.status, 'taxable_mismatch');
  assert.equal(matchResult.taxableDiffMinor, -20000);
});

test('validateGstr2bJson parses GST portal nested docdata structure', () => {
  const sampleJson = {
    data: {
      docdata: {
        b2b: [
          {
            ctin: '33AABCS1429B1Z8',
            trdnm: 'Supreme Textiles Ltd',
            inv: [
              {
                inum: 'ST-0045/26',
                dt: '12-05-2026',
                val: 11800.0,
                itcavl: 'Y',
                items: [
                  {
                    num: 1,
                    txval: 10000.0,
                    rt: 18,
                    camt: 900.0,
                    samt: 900.0,
                    iamt: 0.0,
                    csamt: 0.0,
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  };

  const parsed = validateGstr2bJson(sampleJson);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].supplierGstin, '33AABCS1429B1Z8');
  assert.equal(parsed.records[0].supplierName, 'Supreme Textiles Ltd');
  assert.equal(parsed.records[0].invoiceNumber, 'ST-0045/26');
  assert.equal(parsed.records[0].taxableMinor, 1000000);
  assert.equal(parsed.records[0].cgstMinor, 90000);
  assert.equal(parsed.records[0].sgstMinor, 90000);
  assert.equal(parsed.records[0].totalGstMinor, 180000);
});

test('validateGstr2bCsv parses standard CSV export', () => {
  const sampleCsv = `GSTIN of supplier,Trade/Legal name,Invoice number,Invoice date,Invoice Value,Taxable Value,Central Tax,State/UT Tax,Integrated Tax,Cess,ITC Available
33AABCS1429B1Z8,Supreme Textiles Ltd,ST-0045/26,12-05-2026,11800.00,10000.00,900.00,900.00,0.00,0.00,Yes`;

  const parsed = validateGstr2bCsv(sampleCsv);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].supplierGstin, '33AABCS1429B1Z8');
  assert.equal(parsed.records[0].supplierName, 'Supreme Textiles Ltd');
  assert.equal(parsed.records[0].invoiceNumber, 'ST-0045/26');
  assert.equal(parsed.records[0].taxableMinor, 1000000);
  assert.equal(parsed.records[0].cgstMinor, 90000);
  assert.equal(parsed.records[0].sgstMinor, 90000);
  assert.equal(parsed.records[0].totalGstMinor, 180000);
});
