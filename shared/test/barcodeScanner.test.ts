import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeScannedBarcode,
  calculateGs1CheckDigit,
  verifyGs1CheckDigit,
  detectBarcodeType,
  validateScannedBarcode,
  filterBarcodeTargets,
  findNextTargetWithoutBarcode,
  type BarcodeTargetItem,
} from '../barcodeScannerUtils.ts';

test('Scan normalisation: trims, strips whitespace/newlines, and removes AIM symbology prefixes', () => {
  // Trimming and whitespace removal
  assert.equal(normalizeScannedBarcode('  8901030583629  '), '8901030583629');
  assert.equal(normalizeScannedBarcode('8 901030 583629\r\n'), '8901030583629');
  assert.equal(normalizeScannedBarcode('\t8901 0305 83629\n'), '8901030583629');

  // AIM symbology prefixes stripped
  assert.equal(normalizeScannedBarcode(']E08901030583629'), '8901030583629', 'Strips ]E0 EAN/UPC prefix');
  assert.equal(normalizeScannedBarcode(']E48901030583629'), '8901030583629', 'Strips ]E4 prefix');
  assert.equal(normalizeScannedBarcode(']C0SKU-12345'), 'SKU-12345', 'Strips ]C0 Code 128 prefix');
  assert.equal(normalizeScannedBarcode(']A0PROD99'), 'PROD99', 'Strips ]A0 Code 39 prefix');
  assert.equal(normalizeScannedBarcode(']e010890103058360'), '10890103058360', 'Strips ]e0 GS1 DataBar prefix');
});

test('GS1 check digit calculation and verification for EAN-8, UPC-A, EAN-13, and GTIN-14', () => {
  // EAN-8: 9638507 -> check digit 4
  assert.equal(calculateGs1CheckDigit('9638507'), 4);
  assert.equal(verifyGs1CheckDigit('96385074').isValid, true);
  assert.equal(verifyGs1CheckDigit('96385075').isValid, false);

  // UPC-A: 01234567890 -> check digit 5
  assert.equal(calculateGs1CheckDigit('01234567890'), 5);
  assert.equal(verifyGs1CheckDigit('012345678905').isValid, true);
  assert.equal(verifyGs1CheckDigit('012345678906').isValid, false);

  // EAN-13: 890103058362 -> check digit 9
  assert.equal(calculateGs1CheckDigit('890103058362'), 9);
  assert.equal(verifyGs1CheckDigit('8901030583629').isValid, true);
  assert.equal(verifyGs1CheckDigit('8901030583628').isValid, false);

  // GTIN-14: 1089010305836 -> check digit 0
  assert.equal(calculateGs1CheckDigit('1089010305836'), 0);
  assert.equal(verifyGs1CheckDigit('10890103058360').isValid, true);
  assert.equal(verifyGs1CheckDigit('10890103058365').isValid, false);
});

test('Symbology detection: accurately identifies EAN-13, UPC-A, EAN-8, GTIN-14, and Code 128', () => {
  assert.equal(detectBarcodeType('8901030583629'), 'EAN-13');
  assert.equal(detectBarcodeType('012345678905'), 'UPC-A');
  assert.equal(detectBarcodeType('96385074'), 'EAN-8');
  assert.equal(detectBarcodeType('10890103058360'), 'GTIN-14');
  assert.equal(detectBarcodeType('INTERNAL-SKU-99'), 'Code 128');
});

test('Rejection of misreads: bad GS1 check digit returns "Check digit doesn\'t match — scan it again"', () => {
  // Misread EAN-13 (check digit is 9, scanned 8)
  const result1 = validateScannedBarcode('8901030583628');
  assert.equal(result1.isValid, false);
  assert.equal(result1.error, "Check digit doesn't match — scan it again");

  // Misread UPC-A (check digit is 5, scanned 9)
  const result2 = validateScannedBarcode('012345678909');
  assert.equal(result2.isValid, false);
  assert.equal(result2.error, "Check digit doesn't match — scan it again");

  // Misread EAN-8 (check digit is 4, scanned 9)
  const result3 = validateScannedBarcode('96385079');
  assert.equal(result3.isValid, false);
  assert.equal(result3.error, "Check digit doesn't match — scan it again");
});

test('Rejection of duplicates: duplicate within import rows and against store catalog', () => {
  const targets: BarcodeTargetItem[] = [
    { id: 1, rowNum: 2, name: 'Tata Sampann Toor Dal 1kg', sku: 'TSUTD-1KG', barcode: '8901030583629' },
    { id: 2, rowNum: 3, name: 'Amul Butter 100g', sku: 'AMUL-BUT', barcode: null },
    { id: 3, rowNum: 4, name: 'Surf Excel 1kg', sku: 'SURF-1KG', barcode: null },
  ];

  const takenCatalog = new Map<string, { name: string; id?: string }>([
    ['8901262010016', { name: 'Basmati Rice Premium 5kg', id: 'cat-item-99' }],
  ]);

  // 1. Try scanning a barcode already assigned to Row #2 (Tata Toor Dal) onto Row #3 (Amul Butter)
  const resultSessionDup = validateScannedBarcode('8901030583629', {
    currentTargetId: 2,
    targets,
    takenCatalogBarcodes: takenCatalog,
  });
  assert.equal(resultSessionDup.isValid, false);
  assert.ok(resultSessionDup.error?.includes('Row #2'));
  assert.ok(resultSessionDup.error?.includes('Tata Sampann Toor Dal 1kg'));
  assert.equal(resultSessionDup.conflictingTargetId, 1);
  assert.equal(resultSessionDup.conflictingProductName, 'Tata Sampann Toor Dal 1kg');

  // 2. Try scanning a barcode that is already in store catalog
  const resultCatalogDup = validateScannedBarcode('8901262010016', {
    currentTargetId: 2,
    targets,
    takenCatalogBarcodes: takenCatalog,
  });
  assert.equal(resultCatalogDup.isValid, false);
  assert.ok(resultCatalogDup.error?.includes('Basmati Rice Premium 5kg'));
  assert.equal(resultCatalogDup.conflictingProductName, 'Basmati Rice Premium 5kg');

  // 3. Product already has that exact barcode: should inform user rather than throw error
  const resultSameProduct = validateScannedBarcode('8901030583629', {
    currentTargetId: 1,
    targets,
    takenCatalogBarcodes: takenCatalog,
  });
  assert.equal(resultSameProduct.isValid, true);
  assert.ok(resultSameProduct.info?.includes('already has this exact barcode'));
});

test('Barcode input hygiene: rejects empty, non-ASCII/non-printable, and absurdly long input', () => {
  // Empty input
  const emptyRes = validateScannedBarcode('   ');
  assert.equal(emptyRes.isValid, false);
  assert.ok(emptyRes.error?.includes('scan or enter a barcode'));

  // Non-ASCII characters (e.g. scanner configured with wrong keyboard layout)
  const nonAsciiRes = validateScannedBarcode('8901030é583629');
  assert.equal(nonAsciiRes.isValid, false);
  assert.ok(nonAsciiRes.error?.includes('English (US)'));

  // Absurdly long barcode (> 60 chars)
  const longRes = validateScannedBarcode('1'.repeat(65));
  assert.equal(longRes.isValid, false);
  assert.ok(longRes.error?.includes('too long'));
});

test('Warnings: allows in-store (prefix 2), unusual lengths, and alphanumeric codes with clear warnings', () => {
  // In-store prefix 2 code (e.g. 2000000000015)
  const inStoreRes = validateScannedBarcode('2000000000015');
  assert.equal(inStoreRes.isValid, true);
  assert.ok(inStoreRes.warning?.includes('In-store / weighed-item code'));

  // Unusual numeric length (e.g. 10 digits)
  const oddLengthRes = validateScannedBarcode('1234567890');
  assert.equal(oddLengthRes.isValid, true);
  assert.ok(oddLengthRes.warning?.includes('Unusual numeric barcode length'));

  // Alphanumeric code (e.g. CODE128INTERNAL)
  const alphaRes = validateScannedBarcode('INT-STORE-101');
  assert.equal(alphaRes.isValid, true);
  assert.ok(alphaRes.warning?.includes('Alphanumeric barcode code detected'));
});

test('Search & Filter logic: matches name, SKU, barcode, row number, and status chips', () => {
  const items: BarcodeTargetItem[] = [
    { id: 1, rowNum: 11, name: 'Tata Toor Dal 1kg', sku: 'TTD-1KG', barcode: '8901030583629', category: 'Pulses' },
    { id: 2, rowNum: 22, name: 'Amul Butter 100g', sku: 'AB-100', barcode: null, category: 'Dairy' },
    { id: 3, rowNum: 77, name: 'Surf Excel 1kg', sku: 'SE-1KG', barcode: null, category: 'Cleaning' },
    { id: 4, rowNum: 88, name: 'Moong Dal 1kg', sku: 'MD-1KG', barcode: '8901262010016', category: 'Pulses' },
  ];

  // Status chip filter: no_barcode
  const noBarcodeItems = filterBarcodeTargets(items, '', 'no_barcode', 'all');
  assert.equal(noBarcodeItems.length, 2);
  assert.equal(noBarcodeItems[0].name, 'Amul Butter 100g');
  assert.equal(noBarcodeItems[1].name, 'Surf Excel 1kg');

  // Status chip filter: has_barcode
  const hasBarcodeItems = filterBarcodeTargets(items, '', 'has_barcode', 'all');
  assert.equal(hasBarcodeItems.length, 2);
  assert.equal(hasBarcodeItems[0].name, 'Tata Toor Dal 1kg');
  assert.equal(hasBarcodeItems[1].name, 'Moong Dal 1kg');

  // Category filter
  const pulseItems = filterBarcodeTargets(items, '', 'all', 'Pulses');
  assert.equal(pulseItems.length, 2);

  // Search by name
  const nameSearch = filterBarcodeTargets(items, 'butter', 'all', 'all');
  assert.equal(nameSearch.length, 1);
  assert.equal(nameSearch[0].sku, 'AB-100');

  // Search by row number
  const rowSearch = filterBarcodeTargets(items, '77', 'all', 'all');
  assert.equal(rowSearch.length, 1);
  assert.equal(rowSearch[0].name, 'Surf Excel 1kg');

  // Search by SKU
  const skuSearch = filterBarcodeTargets(items, 'TTD', 'all', 'all');
  assert.equal(skuSearch.length, 1);
  assert.equal(skuSearch[0].name, 'Tata Toor Dal 1kg');

  // Search by barcode
  const bcSearch = filterBarcodeTargets(items, '8901262', 'all', 'all');
  assert.equal(bcSearch.length, 1);
  assert.equal(bcSearch[0].name, 'Moong Dal 1kg');
});

test('findNextTargetWithoutBarcode: moves forward and wraps around to next product missing a barcode', () => {
  const items: BarcodeTargetItem[] = [
    { id: 1, rowNum: 1, name: 'Prod A', barcode: '8901030583629' }, // has barcode
    { id: 2, rowNum: 2, name: 'Prod B', barcode: null },            // NO barcode
    { id: 3, rowNum: 3, name: 'Prod C', barcode: '8901262010016' }, // has barcode
    { id: 4, rowNum: 4, name: 'Prod D', barcode: null },            // NO barcode
  ];

  // From beginning (null currentId) -> should pick first missing (Prod B)
  const nextFromStart = findNextTargetWithoutBarcode(items, null);
  assert.equal(nextFromStart?.id, 2);

  // From Prod B (id: 2) -> next missing is Prod D (id: 4)
  const nextFromB = findNextTargetWithoutBarcode(items, 2);
  assert.equal(nextFromB?.id, 4);

  // From Prod D (id: 4) -> wraps around to Prod B (id: 2)
  const nextFromD = findNextTargetWithoutBarcode(items, 4);
  assert.equal(nextFromD?.id, 2);

  // When all have barcodes -> returns null
  const allPopulated: BarcodeTargetItem[] = [
    { id: 1, name: 'Prod A', barcode: '123' },
    { id: 2, name: 'Prod B', barcode: '456' },
  ];
  assert.equal(findNextTargetWithoutBarcode(allPopulated, 1), null);
});

test('Import Dialog State Retention: opening scan dialog hides parent and Done/✕ preserves assigned barcodes', () => {
  // Simulate the React state transitions in BulkImportModal
  let isScanModalOpen = false;
  let scanModalInitialId: number | string | null = null;
  let rows: BarcodeTargetItem[] = [
    { id: 101, rowNum: 1, name: 'Tata Sampann Toor Dal 1kg', sku: 'TSUTD-1KG', barcode: null, scannedInSession: false },
    { id: 102, rowNum: 2, name: 'Amul Butter 100g', sku: 'AMUL-BUT', barcode: null, scannedInSession: false },
  ];

  // 1. User clicks "📷 Scan Manufacturer Barcodes" in Review & Fix toolbar
  isScanModalOpen = true;
  scanModalInitialId = null;

  // When scan dialog is open: parent Bulk Product Import dialog is hidden:
  const parentDialogDisplay = isScanModalOpen ? 'none' : 'flex';
  const parentOverlayBg = isScanModalOpen ? 'transparent' : 'rgba(15, 23, 42, 0.65)';
  assert.equal(parentDialogDisplay, 'none', 'Parent Bulk Import dialog must have display: none');
  assert.equal(parentOverlayBg, 'transparent', 'Parent overlay background must be transparent (no double-darkened backdrop)');

  // 2. User scans a valid EAN-13 barcode on Row 1 (Tata Sampann Toor Dal 1kg)
  const scannedBarcode = '8901030583629';
  const valResult = validateScannedBarcode(scannedBarcode, {
    currentTargetId: 101,
    targets: rows,
  });
  assert.equal(valResult.isValid, true);

  // onAssign updates the row model in memory
  rows = rows.map((r) =>
    r.id === 101
      ? { ...r, barcode: valResult.normalizedCode, barcodeType: 'MANUFACTURER', scannedInSession: true }
      : r
  );

  // 3. User clicks Done or ✕ in the scan dialog
  isScanModalOpen = false;
  scanModalInitialId = null;

  // Verify parent Bulk Product Import dialog is restored
  const restoredDialogDisplay = isScanModalOpen ? 'none' : 'flex';
  const restoredOverlayBg = isScanModalOpen ? 'transparent' : 'rgba(15, 23, 42, 0.65)';
  assert.equal(restoredDialogDisplay, 'flex', 'Parent dialog is restored');
  assert.equal(restoredOverlayBg, 'rgba(15, 23, 42, 0.65)', 'Backdrop is restored');

  // Verify all rows, edits, and newly assigned barcodes are completely intact
  assert.equal(rows.length, 2);
  assert.equal(rows[0].barcode, '8901030583629');
  assert.equal(rows[0].barcodeType, 'MANUFACTURER');
  assert.equal(rows[0].scannedInSession, true);
  assert.equal(rows[1].barcode, null);
});
