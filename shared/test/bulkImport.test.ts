import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateShortSku,
  generateUniqueShortSku,
  generateUniqueSku,
  computeEan13CheckDigit,
  generateInternalBarcode,
  suggestCategory,
  normalizeProductName,
  matchProductToCatalog,
  classifyProductNature,
} from '../bulkImport.ts';

test('SKU generation: compact readable codes from product name and package size', () => {
  // Test all 5 examples from the user prompt
  assert.equal(generateShortSku('Britannia Good Day Cashew Cookies 200 g'), 'BGDCC-200');
  assert.equal(generateShortSku('Kellogg\'s Corn Flakes Original 250 g'), 'KCF-250');
  assert.equal(generateShortSku('Tata Sampann Toor Dal 1 kg'), 'TSTD-1KG');
  assert.equal(generateShortSku('Amul Butter 100 g'), 'AB-100');
  assert.equal(generateShortSku('Parachute Coconut Hair Oil 190 ml'), 'PCHO-190ML');

  // Test collisions: appends -2, -3, etc.
  const existingSkus = new Set(['bgdcc-200']);
  const seenInImport = new Set<string>();

  const sku1 = generateUniqueShortSku('Britannia Good Day Cashew Cookies 200 g', existingSkus, seenInImport);
  assert.equal(sku1, 'BGDCC-200-2', 'Collides with database, should append -2');

  const sku2 = generateUniqueShortSku('Britannia Good Day Cashew Cookies 200 g', existingSkus, seenInImport);
  assert.equal(sku2, 'BGDCC-200-3', 'Collides with previous row in same import, should append -3');

  const sku3 = generateUniqueShortSku('Amul Butter 100 g', existingSkus, seenInImport);
  assert.equal(sku3, 'AB-100', 'Unique SKU should be base format');
});

test('Barcode generation: produces valid EAN-13 internal barcodes', () => {
  const barcode = generateInternalBarcode(1);
  assert.equal(barcode.length, 13);
  assert.ok(barcode.startsWith('20'), 'Internal barcode starts with 20');

  // Verify check digit
  const body = barcode.slice(0, 12);
  const check = computeEan13CheckDigit(body);
  assert.equal(barcode.slice(12), String(check));
});

test('Category suggestion: matches product names to existing database categories accurately', () => {
  const storeCats = [
    { id: 'cat-1', name: 'Biscuits & Cookies' },
    { id: 'cat-2', name: 'Breakfast & Cereals' },
    { id: 'cat-3', name: 'Pulses' },
    { id: 'cat-4', name: 'Dairy Products' },
    { id: 'cat-5', name: 'Hair Care' },
    { id: 'cat-6', name: 'Personal Care' },
    { id: 'cat-7', name: 'Edible Oils' },
    { id: 'cat-8', name: 'Grocery' },
  ];

  // Test all 5 examples from user prompt
  assert.equal(suggestCategory('Britannia Good Day Cashew Cookies 200 g', storeCats)?.name, 'Biscuits & Cookies');
  assert.equal(suggestCategory('Kellogg\'s Corn Flakes Original 250 g', storeCats)?.name, 'Breakfast & Cereals');
  assert.equal(suggestCategory('Tata Sampann Toor Dal 1 kg', storeCats)?.name, 'Pulses');
  assert.equal(suggestCategory('Amul Butter 100 g', storeCats)?.name, 'Dairy Products');
  // Parachute Coconut Hair Oil MUST match Hair Care, NOT Edible Oils!
  assert.equal(suggestCategory('Parachute Coconut Hair Oil 190 ml', storeCats)?.name, 'Hair Care');

  // Fallback to broader categories if specific subcategory does not exist
  const limitedCats = [
    { id: 'cat-a', name: 'Snacks' },
    { id: 'cat-b', name: 'Grocery' },
    { id: 'cat-c', name: 'Personal Care' },
  ];
  assert.equal(suggestCategory('Britannia Good Day Cashew Cookies 200 g', limitedCats)?.name, 'Snacks');
  assert.equal(suggestCategory('Tata Sampann Toor Dal 1 kg', limitedCats)?.name, 'Grocery');
  assert.equal(suggestCategory('Parachute Coconut Hair Oil 190 ml', limitedCats)?.name, 'Personal Care');

  // Test Kissan Mixed Fruit Jam matching Jams & Spreads
  const jamCats = [
    { id: 'cat-jams', name: 'Jams & Spreads' },
    { id: 'cat-snacks', name: 'Snacks' },
    { id: 'cat-grocery', name: 'Grocery' },
  ];
  assert.equal(suggestCategory('Kissan Mixed Fruit Jam 200 g', jamCats)?.name, 'Jams & Spreads');
  assert.equal(suggestCategory('Kissan Mixed Fruit Jam 200 g', jamCats)?.id, 'cat-jams');

  // Test full suite of standard supermarket categories
  const fullCats = [
    { id: 'c-bev', name: 'Beverages' },
    { id: 'c-cer', name: 'Cereals' },
    { id: 'c-dai', name: 'Dairy' },
    { id: 'c-oil', name: 'Edible Oils' },
    { id: 'c-gro', name: 'Grocery' },
    { id: 'c-hou', name: 'Household' },
    { id: 'c-jam', name: 'Jams & Spreads' },
    { id: 'c-pc', name: 'Personal Care' },
    { id: 'c-pul', name: 'Pulses' },
    { id: 'c-snk', name: 'Snacks' },
  ];

  assert.equal(suggestCategory('Tata Tea Gold 250 g', fullCats)?.name, 'Beverages');
  assert.equal(suggestCategory('Kellogg\'s Corn Flakes Original 250 g', fullCats)?.name, 'Cereals');
  assert.equal(suggestCategory('Amul Butter 100 g', fullCats)?.name, 'Dairy');
  assert.equal(suggestCategory('Fortune Sunlite Refined Sunflower Oil 1 L', fullCats)?.name, 'Edible Oils');
  assert.equal(suggestCategory('Surf Excel Detergent Powder 1 kg', fullCats)?.name, 'Household');
  assert.equal(suggestCategory('Kissan Mixed Fruit Jam 200 g', fullCats)?.name, 'Jams & Spreads');
  assert.equal(suggestCategory('Parachute Coconut Hair Oil 190 ml', fullCats)?.name, 'Personal Care');
  assert.equal(suggestCategory('Tata Sampann Toor Dal 1 kg', fullCats)?.name, 'Pulses');
  assert.equal(suggestCategory('Britannia Good Day Cashew Cookies 200 g', fullCats)?.name, 'Snacks');

  // Test newly created dynamic category without hardcoding (e.g. Pet Care or Frozen Foods)
  const customDynamicCats = [
    { id: 'c-pet', name: 'Pet Care & Accessories' },
    { id: 'c-froz', name: 'Frozen Foods' },
  ];
  assert.equal(suggestCategory('Pedigree Adult Dog Food 3kg', customDynamicCats)?.name, 'Pet Care & Accessories');
  assert.equal(suggestCategory('Sumeru Frozen Green Peas 500g', customDynamicCats)?.name, 'Frozen Foods');

  // Uncertain / ambiguous matches return null (clearly marked as Needs Category)
  assert.equal(suggestCategory('Mystery Metallic Fastener Bolt 5mm', storeCats), null);
});

test('Product matching: classifies Restock, New, and Ambiguous', () => {
  const catalog = [
    {
      id: 'i-1',
      name: 'Tata Salt 1kg',
      sku: 'SALT-001',
      barcode: '8901234567890',
      category: 'Grocery',
      unit: 'kg',
      priceMinor: 2800,
      costMinor: 2200,
      currentStockMilli: 12000,
      taxRateBp: 0,
      taxInclusive: true,
      hsn: '2501',
    },
    {
      id: 'i-2',
      name: 'Basmati Rice 1kg',
      sku: 'RICE-001',
      barcode: '8901234567891',
      category: 'Grocery',
      unit: 'kg',
      priceMinor: 9500,
      costMinor: 7500,
      currentStockMilli: 5000,
      taxRateBp: 500,
      taxInclusive: true,
      hsn: '1006',
    },
    {
      id: 'i-3',
      name: 'Basmati Rice 5kg',
      sku: 'RICE-005',
      barcode: '8901234567892',
      category: 'Grocery',
      unit: 'kg',
      priceMinor: 45000,
      costMinor: 38000,
      currentStockMilli: 2000,
      taxRateBp: 500,
      taxInclusive: true,
      hsn: '1006',
    },
  ];

  // 1. Exact match -> RESTOCK
  const res1 = matchProductToCatalog('Tata Salt 1kg', 'kg', catalog);
  assert.equal(res1.classification, 'RESTOCK');
  assert.equal(res1.matchedItem?.id, 'i-1');

  // 2. Ambiguous match -> AMBIGUOUS (multiple variants)
  const res2 = matchProductToCatalog('Basmati Rice', 'kg', catalog);
  assert.equal(res2.classification, 'AMBIGUOUS');
  assert.equal(res2.candidates.length, 2);

  // 3. New product -> NEW_PRODUCT
  const res3 = matchProductToCatalog('Moong Dal 1kg', 'kg', catalog);
  assert.equal(res3.classification, 'NEW_PRODUCT');
  assert.equal(res3.matchedItem, null);
});

test('Product classification: accurately classifies branded products vs shop-selling products', () => {
  // Test branded examples from user prompt
  const dove = classifyProductNature('Dove Shampoo Daily Shine 180 ml');
  assert.equal(dove.nature, 'BRANDED');
  assert.equal(dove.confidence, 'HIGH');
  assert.equal(dove.brandName, 'Dove');

  const goodDay = classifyProductNature('Britannia Good Day biscuits 200 g');
  assert.equal(goodDay.nature, 'BRANDED');
  assert.equal(goodDay.confidence, 'HIGH');
  assert.equal(goodDay.brandName, 'Britannia');

  const tataSalt = classifyProductNature('Tata Salt 1 kg');
  assert.equal(tataSalt.nature, 'BRANDED');
  assert.equal(tataSalt.confidence, 'HIGH');
  assert.equal(tataSalt.brandName, 'Tata');

  const kissanJam = classifyProductNature('Kissan Jam Mixed Fruit 200 g');
  assert.equal(kissanJam.nature, 'BRANDED');
  assert.equal(kissanJam.confidence, 'HIGH');
  assert.equal(kissanJam.brandName, 'Kissan');

  // Test shop-selling products from user prompt
  const looseRice = classifyProductNature('loose rice');
  assert.equal(looseRice.nature, 'SHOP_PRODUCT');
  assert.equal(looseRice.confidence, 'HIGH');

  const shopPulses = classifyProductNature('shop-packed pulses');
  assert.equal(shopPulses.nature, 'SHOP_PRODUCT');
  assert.equal(shopPulses.confidence, 'HIGH');

  const homemadeSnacks = classifyProductNature('homemade snacks 250g');
  assert.equal(homemadeSnacks.nature, 'SHOP_PRODUCT');
  assert.equal(homemadeSnacks.confidence, 'HIGH');

  // Generic commodities without brand suggested as SHOP_PRODUCT
  const toorDal = classifyProductNature('Toor Dal 1kg');
  assert.equal(toorDal.nature, 'SHOP_PRODUCT');
  assert.equal(toorDal.confidence, 'LOW');

  // Catalog item brand recognition
  const catalog = [
    { name: 'Nandini GoodLife Milk 500ml', barcode: '8901234567890' }
  ];
  const nandini = classifyProductNature('Nandini Curd 200g', catalog);
  assert.equal(nandini.nature, 'BRANDED');
  assert.equal(nandini.confidence, 'HIGH');
});

