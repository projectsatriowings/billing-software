import assert from 'node:assert/strict';
import test from 'node:test';
import { renderBarcodeSvg } from '../bulkImport.ts';

interface ProductItem {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  priceMinor?: number | null;
}

/**
 * Pure helper function simulating the label expansion logic inside BulkBarcodeModal
 */
function expandBulkLabels(
  items: ProductItem[],
  selectedMap: Record<string, number>
): { flatLabels: ProductItem[]; totalCount: number; errors: string[] } {
  const errors: string[] = [];
  const flatLabels: ProductItem[] = [];
  const itemsById = new Map<string, ProductItem>(items.map((it) => [it.id, it]));

  const entries = Object.entries(selectedMap).filter(([_, qty]) => qty > 0);
  if (entries.length === 0) {
    errors.push('No products selected');
    return { flatLabels, totalCount: 0, errors };
  }

  for (const [id, qty] of entries) {
    const item = itemsById.get(id);
    if (!item) {
      errors.push(`Item ID ${id} not found`);
      continue;
    }
    const barcodeTrim = (item.barcode || '').trim();
    if (!barcodeTrim) {
      errors.push(`Item "${item.name}" has no barcode assigned and cannot be printed`);
      continue;
    }
    if (qty <= 0 || !Number.isInteger(qty)) {
      errors.push(`Invalid quantity ${qty} for item "${item.name}"`);
      continue;
    }

    for (let i = 0; i < qty; i++) {
      flatLabels.push(item);
    }
  }

  return { flatLabels, totalCount: flatLabels.length, errors };
}

test('bulk barcode: verify exact required test example (Rice 10, Banana 3, Colgate 5 => 18 total)', () => {
  const testProducts: ProductItem[] = [
    {
      id: 'prod_1',
      name: 'Automated Test Rice 5kg',
      sku: 'RICE-5KG',
      barcode: '2001000000018',
      priceMinor: 35000,
    },
    {
      id: 'prod_2',
      name: 'BANANA',
      sku: 'FRUIT-BAN',
      barcode: '2001000000025',
      priceMinor: 6000,
    },
    {
      id: 'prod_3',
      name: 'Colgate Strong Teeth Dental Cream 200g',
      sku: 'COLG-200G',
      barcode: '8901314010542',
      priceMinor: 11000,
    },
  ];

  const selectedQuantities = {
    prod_1: 10,
    prod_2: 3,
    prod_3: 5,
  };

  const result = expandBulkLabels(testProducts, selectedQuantities);

  assert.equal(result.errors.length, 0, 'Should have no errors for valid items');
  assert.equal(result.totalCount, 18, 'Expected exactly 18 labels in total (10 + 3 + 5)');
  assert.equal(result.flatLabels.length, 18);

  // Verify counts of each individual product
  const countRice = result.flatLabels.filter((it) => it.id === 'prod_1').length;
  const countBanana = result.flatLabels.filter((it) => it.id === 'prod_2').length;
  const countColgate = result.flatLabels.filter((it) => it.id === 'prod_3').length;

  assert.equal(countRice, 10, 'Rice should appear exactly 10 times');
  assert.equal(countBanana, 3, 'Banana should appear exactly 3 times');
  assert.equal(countColgate, 5, 'Colgate should appear exactly 5 times');

  // Verify barcodes are correctly preserved without modification
  for (const label of result.flatLabels) {
    if (label.id === 'prod_1') assert.equal(label.barcode, '2001000000018');
    if (label.id === 'prod_2') assert.equal(label.barcode, '2001000000025');
    if (label.id === 'prod_3') assert.equal(label.barcode, '8901314010542');

    // Verify SVG generation works for each copy
    const svg = renderBarcodeSvg(label.barcode!);
    assert.ok(svg.includes('<svg'), 'Barcode SVG should render properly');
  }
});

test('bulk barcode: rejects products without barcodes and rejects empty selections', () => {
  const productsWithMissingBarcodes: ProductItem[] = [
    { id: 'p_nobarcode_1', name: 'Loose Potato', sku: 'VEG-POT', barcode: null },
    { id: 'p_nobarcode_2', name: 'Custom Service', sku: 'SRV-01', barcode: '   ' },
    { id: 'p_valid', name: 'Britannia Good Day 100g', sku: 'BIS-01', barcode: '8901063012015' },
  ];

  // Test empty selection
  const emptyResult = expandBulkLabels(productsWithMissingBarcodes, {});
  assert.equal(emptyResult.totalCount, 0);
  assert.ok(emptyResult.errors.some((e) => e.includes('No products selected')));

  // Test selecting a product without a barcode
  const missingResult = expandBulkLabels(productsWithMissingBarcodes, {
    p_nobarcode_1: 5,
    p_valid: 2,
  });
  assert.ok(missingResult.errors.some((e) => e.includes('has no barcode assigned')));
  assert.equal(missingResult.totalCount, 2, 'Only the valid product should be expanded');

  // Test invalid quantities (<= 0)
  const invalidQtyResult = expandBulkLabels(productsWithMissingBarcodes, {
    p_valid: -3,
  });
  assert.equal(invalidQtyResult.totalCount, 0);
});
