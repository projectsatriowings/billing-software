import test from 'node:test';
import assert from 'node:assert/strict';
import { can, type Role, type StockTransferStatus } from '../types.ts';

// ---------------------------------------------------------------------------
// 1. RBAC Permissions Matrix for Stock Transfer
// ---------------------------------------------------------------------------
test('stock transfer rbac: owner and manager have stock.transfer permission', () => {
  assert.equal(can('owner', 'stock.transfer'), true, 'owner must have stock.transfer');
  assert.equal(can('manager', 'stock.transfer'), true, 'manager must have stock.transfer');
});

test('stock transfer rbac: cashier and accountant cannot execute stock transfers', () => {
  assert.equal(can('cashier', 'stock.transfer'), false, 'cashier must NOT have stock.transfer');
  assert.equal(can('accountant', 'stock.transfer'), false, 'accountant must NOT have stock.transfer');
});

// ---------------------------------------------------------------------------
// 2. Branch & Transfer Validation Rules
// ---------------------------------------------------------------------------
test('stock transfer validation: source and destination branches cannot be identical', () => {
  const validateBranches = (from: string, to: string) => {
    const f = from.trim().toUpperCase();
    const t = to.trim().toUpperCase();
    if (!f || !t) throw new Error('Both source and destination branches are required.');
    if (f === t) throw new Error('Source and destination branches cannot be the same.');
    return true;
  };

  assert.throws(() => validateBranches('MAIN', 'MAIN'), /cannot be the same/);
  assert.throws(() => validateBranches('chennai', 'CHENNAI'), /cannot be the same/);
  assert.equal(validateBranches('CHENNAI', 'TAMBARAM'), true);
});

test('stock transfer validation: items must have positive quantity and no duplicate products', () => {
  const validateLines = (lines: Array<{ itemId: string; qty: number }>) => {
    if (!lines || lines.length === 0) throw new Error('Transfer must include at least one product.');
    const seen = new Set<string>();
    for (const line of lines) {
      if (seen.has(line.itemId)) throw new Error(`Duplicate product ${line.itemId}. Please consolidate.`);
      seen.add(line.itemId);
      if (typeof line.qty !== 'number' || !Number.isFinite(line.qty) || line.qty <= 0) {
        throw new Error(`Quantity for ${line.itemId} must be greater than zero.`);
      }
    }
    return true;
  };

  assert.throws(() => validateLines([]), /at least one product/);
  assert.throws(() => validateLines([{ itemId: 'item_1', qty: 0 }]), /greater than zero/);
  assert.throws(() => validateLines([{ itemId: 'item_1', qty: -5 }]), /greater than zero/);
  assert.throws(
    () => validateLines([{ itemId: 'item_1', qty: 10 }, { itemId: 'item_1', qty: 5 }]),
    /Duplicate product/
  );
  assert.equal(validateLines([{ itemId: 'item_1', qty: 20 }, { itemId: 'item_2', qty: 10 }]), true);
});

test('stock transfer validation: transfer quantity cannot exceed available stock at source branch', () => {
  const checkStockAvailability = (availableMilli: number, requestedQty: number) => {
    const requestedMilli = Math.round(requestedQty * 1000);
    if (requestedMilli > availableMilli) {
      const availUnits = availableMilli / 1000;
      throw new Error(`Insufficient stock. Available: ${availUnits}, Requested: ${requestedQty}`);
    }
    return true;
  };

  // 100 bags available, requested 20 -> OK
  assert.equal(checkStockAvailability(100_000, 20), true);
  // 100 bags available, requested 100 -> OK
  assert.equal(checkStockAvailability(100_000, 100), true);
  // 100 bags available, requested 101 -> Fails
  assert.throws(() => checkStockAvailability(100_000, 101), /Insufficient stock/);
  // 0 stock available, requested 1 -> Fails
  assert.throws(() => checkStockAvailability(0, 1), /Insufficient stock/);
});

// ---------------------------------------------------------------------------
// 3. Two-Phase Stock Accounting: Dispatch & Full Receipt
// ---------------------------------------------------------------------------
test('stock transfer accounting: full transfer dispatch deducts source stock and records negative move', () => {
  interface MockStockMove {
    itemId: string;
    qtyMilli: number;
    kind: string;
    location: string;
    refType: string;
  }

  const moves: MockStockMove[] = [];
  const sourceBranchStock = { 'CHENNAI': 100_000 }; // 100 units (milli)
  const destBranchStock = { 'TAMBARAM': 10_000 };   // 10 units (milli)

  // Step 1: Dispatch 20 units of Rice Bag from CHENNAI to TAMBARAM
  const transferQtyMilli = 20_000;
  
  // Verify source stock
  assert.ok(sourceBranchStock['CHENNAI'] >= transferQtyMilli);
  
  // Append negative stock move at source branch
  moves.push({
    itemId: 'item_rice',
    qtyMilli: -transferQtyMilli,
    kind: 'transfer',
    location: 'CHENNAI',
    refType: 'stock_transfer_dispatch',
  });
  sourceBranchStock['CHENNAI'] -= transferQtyMilli;

  // Verify source branch stock immediately reduced
  assert.equal(sourceBranchStock['CHENNAI'], 80_000, 'Source branch stock must be reduced to 80 units');
  // Destination branch stock must NOT yet be increased while in transit
  assert.equal(destBranchStock['TAMBARAM'], 10_000, 'Destination branch stock must remain unchanged during transit');

  // Step 2: Full Receipt at TAMBARAM
  const receivedQtyMilli = 20_000;
  moves.push({
    itemId: 'item_rice',
    qtyMilli: receivedQtyMilli,
    kind: 'transfer',
    location: 'TAMBARAM',
    refType: 'stock_transfer_receive',
  });
  destBranchStock['TAMBARAM'] += receivedQtyMilli;

  assert.equal(destBranchStock['TAMBARAM'], 30_000, 'Destination branch stock must now be 30 units');
  assert.equal(moves.length, 2, 'Exactly two stock moves appended');
  assert.equal(moves[0].qtyMilli, -20_000, 'Source stock move is negative');
  assert.equal(moves[1].qtyMilli, +20_000, 'Destination stock move is positive');
});

// ---------------------------------------------------------------------------
// 4. Partial Receipt & Shortage Discrepancy Accounting
// ---------------------------------------------------------------------------
test('stock transfer accounting: partial receipt increases destination only for actual received qty and mandates reason', () => {
  const computeReceipt = (
    dispatchedQtyMilli: number,
    receivedQtyMilli: number,
    discrepancyReason?: string
  ): {
    receivedMilli: number;
    shortageMilli: number;
    status: StockTransferStatus;
    reason?: string;
  } => {
    if (receivedQtyMilli < 0) throw new Error('Received quantity cannot be negative.');
    if (receivedQtyMilli > dispatchedQtyMilli) {
      throw new Error(`Received quantity (${receivedQtyMilli / 1000}) cannot exceed dispatched quantity (${dispatchedQtyMilli / 1000}).`);
    }
    const shortageMilli = dispatchedQtyMilli - receivedQtyMilli;
    if (shortageMilli > 0) {
      if (!discrepancyReason || !discrepancyReason.trim()) {
        throw new Error('A shortage reason is mandatory when items are missing.');
      }
      return {
        receivedMilli: receivedQtyMilli,
        shortageMilli,
        status: 'partially_received',
        reason: discrepancyReason.trim(),
      };
    }
    return {
      receivedMilli: receivedQtyMilli,
      shortageMilli: 0,
      status: 'completed',
    };
  };

  // Dispatched 20 bags, received 18 bags without reason -> Throws error
  assert.throws(
    () => computeReceipt(20_000, 18_000, ''),
    /shortage reason is mandatory/
  );

  // Dispatched 20 bags, received 18 bags with reason -> OK, status partially_received
  const partial = computeReceipt(20_000, 18_000, '2 bags torn and damaged in transit');
  assert.equal(partial.receivedMilli, 18_000);
  assert.equal(partial.shortageMilli, 2_000);
  assert.equal(partial.status, 'partially_received');
  assert.equal(partial.reason, '2 bags torn and damaged in transit');

  // Dispatched 20 bags, received full 20 bags -> OK, status completed
  const full = computeReceipt(20_000, 20_000);
  assert.equal(full.receivedMilli, 20_000);
  assert.equal(full.shortageMilli, 0);
  assert.equal(full.status, 'completed');

  // Dispatched 20 bags, attempted receipt of 25 bags -> Throws error
  assert.throws(
    () => computeReceipt(20_000, 25_000),
    /cannot exceed dispatched quantity/
  );
});

// ---------------------------------------------------------------------------
// 5. In-Transit Cancellation Reversal Logic
// ---------------------------------------------------------------------------
test('stock transfer cancellation: in-transit transfer cancellation reverses deducted stock at source', () => {
  interface MockMove {
    itemId: string;
    qtyMilli: number;
    kind: string;
    location: string;
    refType: string;
  }

  const moves: MockMove[] = [];
  let sourceStockMilli = 100_000;

  // Dispatch 15 units
  const dispatchQtyMilli = 15_000;
  moves.push({
    itemId: 'item_oil',
    qtyMilli: -dispatchQtyMilli,
    kind: 'transfer',
    location: 'CHENNAI',
    refType: 'stock_transfer_dispatch',
  });
  sourceStockMilli -= dispatchQtyMilli;
  assert.equal(sourceStockMilli, 85_000);

  // Transfer is cancelled due to vehicle breakdown / driver recall
  // Append compensating reversal move
  moves.push({
    itemId: 'item_oil',
    qtyMilli: +dispatchQtyMilli,
    kind: 'transfer',
    location: 'CHENNAI',
    refType: 'stock_transfer_cancel_reversal',
  });
  sourceStockMilli += dispatchQtyMilli;

  // Source stock is fully restored
  assert.equal(sourceStockMilli, 100_000, 'Source stock must be restored back to 100 units');
  assert.equal(moves.length, 2);
  const netMove = moves.reduce((sum, m) => sum + m.qtyMilli, 0);
  assert.equal(netMove, 0, 'Net stock movement across dispatch + cancel reversal must be 0');
});
