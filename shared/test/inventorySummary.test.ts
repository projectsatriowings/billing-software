import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateInventorySummary,
  determineStockStatus,
  formatIndianCurrency,
  formatStockQuantity,
  parseNumberSafe,
} from '../inventorySummary.ts';

test('inventory summary: empty product list', () => {
  const summary = calculateInventorySummary([]);
  assert.equal(summary.totalActive, 0);
  assert.equal(summary.inStockCount, 0);
  assert.equal(summary.lowStockCount, 0);
  assert.equal(summary.outOfStockCount, 0);
  assert.equal(summary.zeroStockCount, 0);
  assert.equal(summary.negativeStockCount, 0);
  assert.equal(summary.unconfiguredCount, 0);
  assert.equal(summary.distinctCategoryCount, 0);
  assert.equal(summary.totalStockValueMinor, 0);
  assert.equal(summary.totalStockValueRupees, 0);
  assert.equal(summary.inStockPct, 0);
  assert.equal(summary.lowStockPct, 0);
  assert.equal(summary.outOfStockPct, 0);
  assert.ok(!Number.isNaN(summary.inStockPct));
});

test('inventory summary: all in stock with and without reorder levels', () => {
  const items = [
    {
      id: 'item-1',
      name: 'Aashirvaad Atta',
      category: 'Flour & Grains',
      currentStockMilli: 49000, // 49 bags
      costMinor: 23500, // ₹235.00
      reorderMilli: 10000, // 10 bags threshold
      active: true,
      trackStock: true,
    },
    {
      id: 'item-2',
      name: 'Amul Milk',
      category: 'Dairy',
      currentStockMilli: 60000, // 60 units
      costMinor: 4600, // ₹46.00
      reorderMilli: 0, // Unconfigured reorder level -> counts as in stock
      active: true,
      trackStock: true,
    },
  ];

  const summary = calculateInventorySummary(items);
  assert.equal(summary.totalActive, 2);
  assert.equal(summary.inStockCount, 2);
  assert.equal(summary.lowStockCount, 0);
  assert.equal(summary.outOfStockCount, 0);
  assert.equal(summary.unconfiguredCount, 1);
  assert.equal(summary.distinctCategoryCount, 2);

  // Valuation: (49 * 23500) + (60 * 4600) = 1,151,500 + 276,000 = 1,427,500 paise (₹14,275.00)
  assert.equal(summary.totalStockValueMinor, 1427500);
  assert.equal(summary.totalStockValueRupees, 14275);
  assert.equal(summary.inStockPct, 100);
  assert.equal(summary.lowStockPct, 0);
  assert.equal(summary.outOfStockPct, 0);
});

test('inventory summary: mix of in-stock, low stock, zero stock, and negative stock', () => {
  const items = [
    // In-stock (above reorder)
    {
      id: '1',
      name: 'Item In Stock',
      category: 'Cat A',
      currentStockMilli: 50000, // 50 units
      reorderMilli: 20000, // 20 units
      costMinor: 10000, // ₹100
      active: true,
      trackStock: true,
    },
    // Low stock (stock > 0 and stock <= reorder)
    {
      id: '2',
      name: 'Item Low Stock',
      category: 'Cat A',
      currentStockMilli: 15000, // 15 units <= 20
      reorderMilli: 20000,
      costMinor: 5000, // ₹50
      active: true,
      trackStock: true,
    },
    // Out of stock: exactly zero
    {
      id: '3',
      name: 'Item Zero Stock',
      category: 'Cat B',
      currentStockMilli: 0,
      reorderMilli: 10000,
      costMinor: 2000,
      active: true,
      trackStock: true,
    },
    // Out of stock: negative (oversold)
    {
      id: '4',
      name: 'Item Negative Stock',
      category: 'Cat C',
      currentStockMilli: -5000,
      reorderMilli: 10000,
      costMinor: 8000,
      active: true,
      trackStock: true,
    },
  ];

  const summary = calculateInventorySummary(items);
  assert.equal(summary.totalActive, 4);
  assert.equal(summary.inStockCount, 1);
  assert.equal(summary.lowStockCount, 1);
  assert.equal(summary.outOfStockCount, 2);
  assert.equal(summary.zeroStockCount, 1);
  assert.equal(summary.negativeStockCount, 1);
  assert.equal(summary.distinctCategoryCount, 3);

  // Valuation: only positive stock contributes:
  // Item 1: 50 * 10000 = 500,000 paise
  // Item 2: 15 * 5000 = 75,000 paise
  // Items 3 & 4: 0
  // Total = 575,000 paise = ₹5,750.00
  assert.equal(summary.totalStockValueMinor, 575000);
  assert.equal(summary.totalStockValueRupees, 5750);

  // Percentages: 1/4 = 25%, 1/4 = 25%, 2/4 = 50%
  assert.equal(summary.inStockPct, 25);
  assert.equal(summary.lowStockPct, 25);
  assert.equal(summary.outOfStockPct, 50);
});

test('inventory summary: handles string numbers, formatted currency, and snake_case', () => {
  const items = [
    {
      id: 'str-1',
      name: 'String item',
      category: 'Snacks',
      stock_milli: '49000',
      cost_minor: '₹23,500.00',
      reorder_milli: '10000',
      active: true,
      track_stock: true,
    },
    {
      id: 'str-2',
      name: 'Untracked or inactive item',
      category: 'Snacks',
      stock_milli: '10000',
      cost_minor: '1000',
      active: false, // inactive -> must be excluded
      track_stock: true,
    },
  ];

  const summary = calculateInventorySummary(items);
  assert.equal(summary.totalActive, 1);
  assert.equal(summary.inStockCount, 1);
  assert.equal(summary.totalStockValueMinor, 1151500);
  assert.equal(summary.totalStockValueRupees, 11515);
});

test('inventory formatting: formatIndianCurrency', () => {
  assert.equal(formatIndianCurrency(11515), '₹11,515.00');
  assert.equal(formatIndianCurrency(2760), '₹2,760.00');
  assert.equal(formatIndianCurrency(0), '₹0.00');
  assert.equal(formatIndianCurrency('₹235.00'), '₹235.00');
  assert.equal(formatIndianCurrency(null), '₹0.00');
  assert.equal(formatIndianCurrency(undefined), '₹0.00');
});

test('inventory formatting: formatStockQuantity', () => {
  assert.equal(formatStockQuantity(49.0, 'bag'), '49 bag');
  assert.equal(formatStockQuantity(60, 'pouch'), '60 pouch');
  assert.equal(formatStockQuantity(1.25, 'kg'), '1.25 kg');
  assert.equal(formatStockQuantity(0, 'pcs'), '0 pcs');
  assert.equal(formatStockQuantity(49), '49');
  assert.equal(formatStockQuantity('15.500', 'ltr'), '15.5 ltr');
});

test('inventory classification: determineStockStatus', () => {
  // Negative
  assert.equal(determineStockStatus(-2, 10), 'negative_stock');
  // Out of stock
  assert.equal(determineStockStatus(0, 10), 'out_of_stock');
  // Low stock (stock <= reorder)
  assert.equal(determineStockStatus(5, 10), 'low_stock');
  assert.equal(determineStockStatus(10, 10), 'low_stock');
  // In stock (stock > reorder)
  assert.equal(determineStockStatus(11, 10), 'in_stock');
  // In stock when no reorder level is set
  assert.equal(determineStockStatus(5, 0), 'in_stock');
});
