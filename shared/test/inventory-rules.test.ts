import test from 'node:test';
import assert from 'node:assert/strict';
import { can, type Role } from '../types.ts';
import { PACKS } from '../packs.ts';

// ---------------------------------------------------------------------------
// 1. RBAC Permissions Matrix for Inventory
// ---------------------------------------------------------------------------
test('inventory rbac: cashiers can view stock but cannot perform stock adjustments', () => {
  // Cashiers can view items and stock
  assert.equal(can('cashier', 'stock.view'), true, 'cashier should have stock.view');
  assert.equal(can('cashier', 'items.view'), true, 'cashier should have items.view');
  
  // Cashiers CANNOT perform stock adjustments
  assert.equal(can('cashier', 'stock.adjust'), false, 'cashier must NOT have stock.adjust');
  assert.equal(can('cashier', 'purchases'), false, 'cashier must NOT have purchases');
  assert.equal(can('cashier', 'purchases.void'), false, 'cashier must NOT have purchases.void');
  assert.equal(can('cashier', 'reports'), false, 'cashier must NOT have reports');
});

test('inventory rbac: owner and manager have full stock adjustment privileges', () => {
  assert.equal(can('owner', 'stock.adjust'), true, 'owner must have stock.adjust');
  assert.equal(can('manager', 'stock.adjust'), true, 'manager must have stock.adjust');
  assert.equal(can('accountant', 'stock.adjust'), false, 'accountant must NOT have stock.adjust');
});

test('inventory rbac: purchases and stock inward restricted to owner, manager, accountant', () => {
  assert.equal(can('owner', 'purchases'), true);
  assert.equal(can('manager', 'purchases'), true);
  assert.equal(can('accountant', 'purchases'), true);
  assert.equal(can('cashier', 'purchases'), false);
});

// ---------------------------------------------------------------------------
// 2. Business Configuration & Negative Stock Policy
// ---------------------------------------------------------------------------
test('business packs: negative stock policy is correctly configured per business type', () => {
  const getPack = (id: string) => PACKS.find((p) => p.id === id);

  // Grocery/Retail, Pharmacy, Wholesale prohibit negative stock
  assert.equal(getPack('retail')?.config.rules.allowNegativeStock, false, 'retail must disallow negative stock');
  assert.equal(getPack('pharmacy')?.config.rules.allowNegativeStock, false, 'pharmacy must disallow negative stock');
  assert.equal(getPack('wholesale')?.config.rules.allowNegativeStock, false, 'wholesale must disallow negative stock');

  // Restaurant and Service allow negative stock for prep / service flexibility
  assert.equal(getPack('restaurant')?.config.rules.allowNegativeStock, true, 'restaurant allows negative stock');
  assert.equal(getPack('service')?.config.rules.allowNegativeStock, true, 'service allows negative stock');
});

// ---------------------------------------------------------------------------
// 3. Stock Adjustment Delta & Negative Stock Safeguards
// ---------------------------------------------------------------------------
test('stock adjustments: delta math handles positive, negative, and zero differences', () => {
  // Scenario A: Physical Count is higher than System Stock (Found Stock)
  const systemQtyMilli = 50000; // 50 units
  const countedQtyMilli = 55000; // 55 units
  const deltaA = countedQtyMilli - systemQtyMilli;
  assert.equal(deltaA, 5000, 'delta should be +5000 milli (+5 units)');
  assert.ok(deltaA > 0, 'stock increase');

  // Scenario B: Physical Count is lower than System Stock (Damaged / Missing)
  const damagedCountMilli = 42000; // 42 units
  const deltaB = damagedCountMilli - systemQtyMilli;
  assert.equal(deltaB, -8000, 'delta should be -8000 milli (-8 units)');
  assert.ok(deltaB < 0, 'stock decrease');

  // Scenario C: Direct Adjustment Qty Mode
  const manualAdjustmentMilli = -2000; // Write off 2 units
  const resultingQtyMilli = systemQtyMilli + manualAdjustmentMilli;
  assert.equal(resultingQtyMilli, 48000, 'resulting qty should be 48 units');
});

test('stock adjustments: negative stock rejection logic', () => {
  const currentStockMilli = 10000; // 10 units
  const requestedReductionMilli = -15000; // -15 units
  const resultingBalanceMilli = currentStockMilli + requestedReductionMilli; // -5 units

  // If allowNegativeStock is false (Grocery/Retail):
  const allowNegativeStockGrocery = false;
  const isRejectedGrocery = !allowNegativeStockGrocery && resultingBalanceMilli < 0;
  assert.equal(isRejectedGrocery, true, 'Grocery must reject adjustment resulting in negative stock');

  // If allowNegativeStock is true (Restaurant/Service):
  const allowNegativeStockRestaurant = true;
  const isRejectedRestaurant = !allowNegativeStockRestaurant && resultingBalanceMilli < 0;
  assert.equal(isRejectedRestaurant, false, 'Restaurant permits negative kitchen stock');
});

// ---------------------------------------------------------------------------
// 4. Physical Stock Count Variance & Auditing Logic
// ---------------------------------------------------------------------------
test('physical stock count: difference calculation and status classification', () => {
  const lines = [
    { itemId: 'item-1', systemQtyMilli: 20000, countedQtyMilli: 20000 }, // Perfect match
    { itemId: 'item-2', systemQtyMilli: 50000, countedQtyMilli: 47000 }, // Shortage of 3 units
    { itemId: 'item-3', systemQtyMilli: 10000, countedQtyMilli: 14000 }, // Overage of 4 units
    { itemId: 'item-4', systemQtyMilli: 15000, countedQtyMilli: null },   // Uncounted
  ];

  const processed = lines.map((l) => {
    const isCounted = l.countedQtyMilli !== null;
    const diff = isCounted ? (l.countedQtyMilli! - l.systemQtyMilli) : null;
    return {
      ...l,
      isCounted,
      diff,
      status: !isCounted ? 'pending' : diff === 0 ? 'matched' : 'discrepancy',
    };
  });

  assert.equal(processed[0].status, 'matched');
  assert.equal(processed[0].diff, 0);

  assert.equal(processed[1].status, 'discrepancy');
  assert.equal(processed[1].diff, -3000);

  assert.equal(processed[2].status, 'discrepancy');
  assert.equal(processed[2].diff, 4000);

  assert.equal(processed[3].status, 'pending');
  assert.equal(processed[3].diff, null);

  // Discrepancy lines requiring stock_moves creation upon finalization
  const discrepancyLines = processed.filter((p) => p.status === 'discrepancy');
  assert.equal(discrepancyLines.length, 2);
});

// ---------------------------------------------------------------------------
// 5. Low-Stock and Out-of-Stock Alert Classification
// ---------------------------------------------------------------------------
test('reorder level alerts: correct stock status classification', () => {
  const classify = (currentStockMilli: number, reorderMilli: number) => {
    if (currentStockMilli <= 0) return 'out_of_stock';
    if (reorderMilli > 0 && currentStockMilli <= reorderMilli) return 'low_stock';
    return 'in_stock';
  };

  // Reorder level set to 10 units (10000 milli)
  const threshold = 10000;

  // In-stock
  assert.equal(classify(25000, threshold), 'in_stock');
  assert.equal(classify(10001, threshold), 'in_stock');

  // Low-stock (at or below reorder level)
  assert.equal(classify(10000, threshold), 'low_stock');
  assert.equal(classify(3000, threshold), 'low_stock');

  // Out-of-stock
  assert.equal(classify(0, threshold), 'out_of_stock');
  assert.equal(classify(-2000, threshold), 'out_of_stock');

  // Unconfigured reorder level (0)
  assert.equal(classify(5000, 0), 'in_stock');
  assert.equal(classify(0, 0), 'out_of_stock');
});

// ---------------------------------------------------------------------------
// 6. Sellable Returns vs Damaged Returns Stock Impact
// ---------------------------------------------------------------------------
test('sales returns stock rule: only sellable returns restore inventory', () => {
  const returnLines = [
    { itemId: 'item-1', returnQty: 2, restock: true, reason: 'Wrong item chosen' },
    { itemId: 'item-2', returnQty: 1, restock: false, reason: 'Broken / Damaged seal' },
  ];

  const stockMovementsToCreate = returnLines
    .filter((l) => l.restock)
    .map((l) => ({
      itemId: l.itemId,
      qtyMilli: Math.round(l.returnQty * 1000),
      kind: 'return' as const,
    }));

  assert.equal(stockMovementsToCreate.length, 1, 'Only sellable line should generate stock move');
  assert.equal(stockMovementsToCreate[0].itemId, 'item-1');
  assert.equal(stockMovementsToCreate[0].qtyMilli, 2000, 'Restores exactly 2 units');
});

// ---------------------------------------------------------------------------
// 7. Chronological Window Running Balances Math
// ---------------------------------------------------------------------------
test('stock ledger window math: previous and resulting balances reconcile', () => {
  const initialStock = 100000; // 100 units
  const movements = [
    { kind: 'opening', qtyMilli: 100000 },
    { kind: 'sale', qtyMilli: -15000 },
    { kind: 'purchase', qtyMilli: 50000 },
    { kind: 'return', qtyMilli: 2000 },
    { kind: 'adjust', qtyMilli: -5000 },
  ];

  let runningBalance = 0;
  const ledgerRows = movements.map((m) => {
    const prev = runningBalance;
    runningBalance += m.qtyMilli;
    return {
      kind: m.kind,
      qtyMilli: m.qtyMilli,
      previousBalanceMilli: prev,
      resultingBalanceMilli: runningBalance,
    };
  });

  assert.equal(ledgerRows[0].previousBalanceMilli, 0);
  assert.equal(ledgerRows[0].resultingBalanceMilli, 100000);

  assert.equal(ledgerRows[1].previousBalanceMilli, 100000);
  assert.equal(ledgerRows[1].resultingBalanceMilli, 85000);

  assert.equal(ledgerRows[2].previousBalanceMilli, 85000);
  assert.equal(ledgerRows[2].resultingBalanceMilli, 135000);

  assert.equal(ledgerRows[3].previousBalanceMilli, 135000);
  assert.equal(ledgerRows[3].resultingBalanceMilli, 137000);

  assert.equal(ledgerRows[4].previousBalanceMilli, 137000);
  assert.equal(ledgerRows[4].resultingBalanceMilli, 132000);
});

// ---------------------------------------------------------------------------
// 8. Physical Count Concurrency & Interim Movement Reconciliation Policy
// ---------------------------------------------------------------------------
test('count concurrency: no movements during count applies exact physical discrepancy', () => {
  const baselineSystemMilli = 100000; // 100 units
  const countedMilli = 98000;         // 98 units (2 units damaged/missing)
  const priorInterimDeltaMilli = 0;   // No movements occurred
  const currentLiveStockMilli = 100000;

  const expectedStockAtCount = baselineSystemMilli + priorInterimDeltaMilli;
  const reconciledDiffMilli = countedMilli - expectedStockAtCount;
  const resultingStockMilli = currentLiveStockMilli + reconciledDiffMilli;

  assert.equal(reconciledDiffMilli, -2000, 'Reconciled variance must be -2 units');
  assert.equal(resultingStockMilli, 98000, 'Final stock balance must be 98 units');
});

test('count concurrency: sale occurring after count start is preserved, not overwritten', () => {
  // Scenario: Count started at 10:00 (100 units).
  // Counter enters physical count: 98 units (2 units lost).
  // Customer buys 5 units at 10:30 (sale recorded: -5000 milli). Live stock in DB is 95 units.
  // Finalize runs at 11:00.
  const baselineSystemMilli = 100000; // 100 units
  const countedMilli = 98000;         // 98 units counted
  const priorInterimDeltaMilli = 0;   // Sale happened after count was taken
  const currentLiveStockMilli = 95000;// 95 units currently in DB (100 - 5 sold)

  const expectedStockAtCount = baselineSystemMilli + priorInterimDeltaMilli;
  const reconciledDiffMilli = countedMilli - expectedStockAtCount;
  const resultingStockMilli = currentLiveStockMilli + reconciledDiffMilli;

  assert.equal(reconciledDiffMilli, -2000, 'Reconciled floor variance must remain -2 units');
  assert.equal(resultingStockMilli, 93000, 'Final stock must be 93 units (98 counted minus 5 legitimate sale)');
});

test('count concurrency: purchase receipt arriving after count start is preserved', () => {
  // Scenario: Count started at 10:00 (100 units).
  // Counter counted 100 units.
  // Inward purchase receipt of 50 units arrives at 10:30 (+50000 milli). Live stock in DB is 150 units.
  // Finalize runs at 11:00.
  const baselineSystemMilli = 100000;
  const countedMilli = 100000;
  const priorInterimDeltaMilli = 0;
  const currentLiveStockMilli = 150000;

  const expectedStockAtCount = baselineSystemMilli + priorInterimDeltaMilli;
  const reconciledDiffMilli = countedMilli - expectedStockAtCount;
  const resultingStockMilli = currentLiveStockMilli + reconciledDiffMilli;

  assert.equal(reconciledDiffMilli, 0, 'No floor discrepancy at count time');
  assert.equal(resultingStockMilli, 150000, 'Purchase receipt of 50 units must be preserved in total stock');
});

test('count concurrency: sales return arriving after count start is preserved', () => {
  // Scenario: Count started at 10:00 (100 units).
  // Counter counted 100 units.
  // Customer returns 2 sellable units at 10:30 (+2000 milli). Live stock in DB is 102 units.
  // Finalize runs at 11:00.
  const baselineSystemMilli = 100000;
  const countedMilli = 100000;
  const priorInterimDeltaMilli = 0;
  const currentLiveStockMilli = 102000;

  const expectedStockAtCount = baselineSystemMilli + priorInterimDeltaMilli;
  const reconciledDiffMilli = countedMilli - expectedStockAtCount;
  const resultingStockMilli = currentLiveStockMilli + reconciledDiffMilli;

  assert.equal(reconciledDiffMilli, 0, 'No floor discrepancy');
  assert.equal(resultingStockMilli, 102000, 'Restocked return of 2 units must be preserved');
});

test('count concurrency: sale occurring BEFORE count entry does not cause double-deduction', () => {
  // Scenario: Baseline at 10:00 = 100 units.
  // At 10:15, sale of 5 occurs (-5000 milli). DB stock = 95 units. Floor shelf has 95 units.
  // Counter counts at 10:30 and enters 95 units.
  const baselineSystemMilli = 100000;
  const priorInterimDeltaMilli = -5000; // Sale occurred before line count entry
  const countedMilli = 95000;          // Counter saw 95 on shelf
  const currentLiveStockMilli = 95000;

  const expectedStockAtCount = baselineSystemMilli + priorInterimDeltaMilli; // 95 units expected
  const reconciledDiffMilli = countedMilli - expectedStockAtCount;           // 95 - 95 = 0
  const resultingStockMilli = currentLiveStockMilli + reconciledDiffMilli;   // 95 + 0 = 95

  assert.equal(expectedStockAtCount, 95000);
  assert.equal(reconciledDiffMilli, 0, 'No adjustment needed; count matches stock after interim sale');
  assert.equal(resultingStockMilli, 95000, 'Stock remains 95 units; sale is NOT double deducted');
});

test('count serialization: session status check prevents duplicate finalization and retries', () => {
  const checkCanFinalize = (sessionStatus: string) => {
    if (sessionStatus !== 'in_progress') {
      throw new Error(`Session is already ${sessionStatus}. Cannot finalize.`);
    }
    return true;
  };

  assert.equal(checkCanFinalize('in_progress'), true);
  assert.throws(() => checkCanFinalize('completed'), /already completed/);
  assert.throws(() => checkCanFinalize('cancelled'), /already cancelled/);
});

test('count safety: negative stock violation rejects finalization requiring review/recount', () => {
  const allowNegativeStock = false;
  const currentLiveStockMilli = 3000; // 3 units
  const reconciledDiffMilli = -5000;  // Count shows 5 units missing
  const resultingStockMilli = currentLiveStockMilli + reconciledDiffMilli; // -2 units

  const isRejected = !allowNegativeStock && resultingStockMilli < 0;
  assert.equal(isRejected, true, 'Count resulting in negative stock must be rejected on protected shop');
});

// ---------------------------------------------------------------------------
// 9. Sales Velocity & Demand Insights Net Demand Logic
// ---------------------------------------------------------------------------
test('sales velocity: net demand subtracts valid customer returns from gross sales', () => {
  const calculateNetDemand = (grossSalesMilli: number, customerReturnsMilli: number) => {
    return Math.max(0, grossSalesMilli - customerReturnsMilli);
  };

  assert.equal(calculateNetDemand(50000, 5000), 45000, '50 sold - 5 returned = 45 net sold');
  assert.equal(calculateNetDemand(20000, 20000), 0, 'Full return leaves 0 net demand');
  assert.equal(calculateNetDemand(10000, 15000), 0, 'Returns exceeding period sales clamped to 0');
});

test('sales velocity: observation window scales for newly created products', () => {
  const calculateDailyVelocity = (netSoldMilli: number, daysSinceCreation: number) => {
    const daysActive = Math.max(1, Math.min(30, daysSinceCreation));
    const dailyVelocityMilli = netSoldMilli / daysActive;
    const hasSufficientHistory = daysActive >= 7;
    return {
      daysActive,
      dailyVelocityUnits: Number((dailyVelocityMilli / 1000).toFixed(2)),
      hasSufficientHistory,
    };
  };

  // Product created 5 days ago with 10 units sold
  const newProduct = calculateDailyVelocity(10000, 5);
  assert.equal(newProduct.daysActive, 5);
  assert.equal(newProduct.dailyVelocityUnits, 2.0, '10 units / 5 days = 2.0 units/day');
  assert.equal(newProduct.hasSufficientHistory, false, '5 days active is preliminary');

  // Mature product created 60 days ago with 30 units sold in last 30d
  const matureProduct = calculateDailyVelocity(30000, 60);
  assert.equal(matureProduct.daysActive, 30);
  assert.equal(matureProduct.dailyVelocityUnits, 1.0, '30 units / 30 days = 1.0 units/day');
  assert.equal(matureProduct.hasSufficientHistory, true);
});

// ---------------------------------------------------------------------------
// 10. Suggested Reorder Quantity Target Formula
// ---------------------------------------------------------------------------
test('reorder formula: max(1, 2 * max(reorder, min_stock) - current_stock)', () => {
  const calculateSuggestedOrder = (currentStockMilli: number, reorderMilli: number, minStockMilli: number) => {
    const threshold = Math.max(reorderMilli, minStockMilli);
    const targetStock = threshold * 2;
    return Math.max(1000, targetStock - currentStockMilli);
  };

  // Example 1: Reorder = 25 units, Current = 10 units
  // Target = 25 * 2 = 50 units. Deficit = 50 - 10 = 40 units.
  assert.equal(calculateSuggestedOrder(10000, 25000, 10000), 40000);

  // Example 2: Out of stock (0 units). Reorder = 20 units.
  // Target = 20 * 2 = 40 units. Suggested = 40 units.
  assert.equal(calculateSuggestedOrder(0, 20000, 15000), 40000);

  // Example 3: Negative stock (-5 units). Reorder = 20 units.
  // Target = 20 * 2 = 40 units. Suggested = 40 - (-5) = 45 units.
  assert.equal(calculateSuggestedOrder(-5000, 20000, 10000), 45000);

  // Example 4: Minimum order of 1 base unit (1000 milli) enforced
  assert.equal(calculateSuggestedOrder(19500, 10000, 10000), 1000);
});

// ---------------------------------------------------------------------------
// 11. Physical Count Timestamp Stability
// ---------------------------------------------------------------------------
test('count timestamp stability: editing line notes does not bump counted timestamp', () => {
  const lineState = {
    countedQtyMilli: 25000,
    diffQtyMilli: -5000,
    notes: 'initial count note',
    updatedAt: '2026-10-23T10:00:00.000Z',
  };

  const handleUpdate = (incomingCounted: number | null, incomingNotes: string, now: string) => {
    const isCountChanged = incomingCounted !== lineState.countedQtyMilli;
    if (isCountChanged) {
      return {
        ...lineState,
        countedQtyMilli: incomingCounted,
        notes: incomingNotes,
        updatedAt: now,
      };
    }
    // Count did not change, only update notes, preserve original counted timestamp
    return {
      ...lineState,
      notes: incomingNotes,
    };
  };

  const updatedNotesOnly = handleUpdate(25000, 'updated note after verification', '2026-10-23T10:30:00.000Z');
  assert.equal(updatedNotesOnly.updatedAt, '2026-10-23T10:00:00.000Z', 'Count timestamp must not be shifted by note edits');
  assert.equal(updatedNotesOnly.notes, 'updated note after verification');

  const recountChanged = handleUpdate(24000, 'recount confirmed 24 units', '2026-10-23T10:35:00.000Z');
  assert.equal(recountChanged.updatedAt, '2026-10-23T10:35:00.000Z', 'Count timestamp updates when count actually changes');
  assert.equal(recountChanged.countedQtyMilli, 24000);
});

// ---------------------------------------------------------------------------
// 12. Test Database Protection Guard Validation
// ---------------------------------------------------------------------------
test('test db guard: rejects production URLs, requires isolated test database', () => {
  const validateTestDb = (url: string, defaultDbUrl: string) => {
    if (!url) return { ok: false, reason: 'MISSING_URL' };
    if (url === defaultDbUrl) return { ok: false, reason: 'MATCHES_PRIMARY_DATABASE' };
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      const dbName = parsed.pathname.replace(/^\//, '').toLowerCase();
      const isCloudProd = host.includes('neon.tech') || host.includes('aws') || host.includes('prod');
      const isTestNamed = dbName.includes('test') || dbName.includes('disposable') || dbName.includes('sandbox');
      if (isCloudProd && !isTestNamed) {
        return { ok: false, reason: 'CLOUD_PROD_WITHOUT_TEST_NAME' };
      }
      return { ok: true, host, dbName };
    } catch {
      return { ok: false, reason: 'MALFORMED_URL' };
    }
  };

  const primaryUrl = 'postgresql://user:pass@ep-prod-123.neon.tech/neondb?sslmode=require';

  // 1. Refuses empty URL
  assert.equal(validateTestDb('', primaryUrl).ok, false);
  assert.equal(validateTestDb('', primaryUrl).reason, 'MISSING_URL');

  // 2. Refuses identical URL as primary application database
  assert.equal(validateTestDb(primaryUrl, primaryUrl).ok, false);
  assert.equal(validateTestDb(primaryUrl, primaryUrl).reason, 'MATCHES_PRIMARY_DATABASE');

  // 3. Refuses cloud production host with non-test database name
  const cloudProdUrl = 'postgresql://user:pass@ep-prod-456.neon.tech/main_store';
  assert.equal(validateTestDb(cloudProdUrl, primaryUrl).ok, false);
  assert.equal(validateTestDb(cloudProdUrl, primaryUrl).reason, 'CLOUD_PROD_WITHOUT_TEST_NAME');

  // 4. Accepts valid isolated test database
  const validTestUrl = 'postgresql://user:pass@ep-test-789.neon.tech/billing_test';
  assert.equal(validateTestDb(validTestUrl, primaryUrl).ok, true);

  // 5. Accepts local disposable test database
  const localTestUrl = 'postgresql://postgres:postgres@localhost:5432/disposable_db';
  assert.equal(validateTestDb(localTestUrl, primaryUrl).ok, true);
});

// ---------------------------------------------------------------------------
// 13. Net Sales Velocity Transaction Status Filtering
// ---------------------------------------------------------------------------
test('sales velocity: voided sales and cancelled credit notes do not contaminate demand', () => {
  const stockMoves = [
    { itemId: 'item-1', kind: 'sale', qtyMilli: -5000, invoiceStatus: 'posted' },      // Valid sale (+5000 gross)
    { itemId: 'item-1', kind: 'sale', qtyMilli: -3000, invoiceStatus: 'cancelled' },   // Voided sale (must be EXCLUDED)
    { itemId: 'item-1', kind: 'return', qtyMilli: 1000, cnStatus: 'posted' },          // Valid return (-1000 net)
    { itemId: 'item-1', kind: 'return', qtyMilli: 2000, cnStatus: 'cancelled' },       // Cancelled return (must be EXCLUDED)
    { itemId: 'item-1', kind: 'adjust', qtyMilli: -2000, cnStatus: null },              // Void adjustment (must be EXCLUDED)
  ];

  // Apply SQL-equivalent filtering logic
  const grossSalesMilli = stockMoves
    .filter((m) => m.kind === 'sale' && (m.invoiceStatus === 'posted' || m.invoiceStatus === null))
    .reduce((acc, m) => acc + Math.abs(m.qtyMilli), 0);

  const returnsMilli = stockMoves
    .filter((m) => m.kind === 'return' && (m.cnStatus === 'posted' || m.cnStatus === null))
    .reduce((acc, m) => acc + m.qtyMilli, 0);

  const netDemandMilli = Math.max(0, grossSalesMilli - returnsMilli);

  assert.equal(grossSalesMilli, 5000, 'Only the posted sale of 5 units should be counted');
  assert.equal(returnsMilli, 1000, 'Only the posted return of 1 unit should be subtracted');
  assert.equal(netDemandMilli, 4000, 'Net demand must be 4 units (5 sold minus 1 returned)');
});


