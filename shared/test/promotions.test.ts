import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePromotions,
  type Promotion,
  type CartItemForEval,
  isPromotionEligible,
} from '../promotions.ts';

describe('Promotions Engine', () => {
  const dummyBogoPromo: Promotion = {
    id: 'promo_bogo_1',
    tenantId: 't_main',
    name: 'Buy 2 Get 1 Free Marie Gold',
    type: 'bogo',
    status: 'active',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    branches: ['ALL'],
    counters: ['ALL'],
    rules: {
      qualifyingProductId: 'item_biscuit_marie',
      qualifyingQty: 2,
      freeProductId: 'item_biscuit_marie',
      freeQty: 1,
      sameProduct: true,
      maxFreePerBill: 5,
    },
    customerEligibilityType: 'all',
    eligibleCustomerIds: [],
    currentUsageCount: 0,
    showBannerOnPos: true,
    allowStacking: true,
    minBillAmountMinor: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const dummyPercentagePromo: Promotion = {
    id: 'promo_pct_1',
    tenantId: 't_main',
    name: '10% Off on Snacks Category',
    type: 'category_discount',
    status: 'active',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    branches: ['ALL'],
    counters: ['ALL'],
    rules: {
      categoryNames: ['Snacks'],
      discountPct: 10,
    },
    customerEligibilityType: 'all',
    eligibleCustomerIds: [],
    currentUsageCount: 0,
    showBannerOnPos: true,
    allowStacking: true,
    minBillAmountMinor: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const dummyBillLevelPromo: Promotion = {
    id: 'promo_bill_1',
    tenantId: 't_main',
    name: 'Weekend Special: ₹50 Off on ₹500+',
    type: 'bill_level',
    status: 'active',
    startDate: '2026-01-01',
    endDate: '2026-12-31',
    branches: ['ALL'],
    counters: ['ALL'],
    rules: {
      minBillAmountMinor: 50000,
      discountAmountMinor: 5000,
    },
    customerEligibilityType: 'all',
    eligibleCustomerIds: [],
    currentUsageCount: 0,
    showBannerOnPos: true,
    allowStacking: true,
    minBillAmountMinor: 50000,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  it('checks eligibility correctly', () => {
    assert.equal(isPromotionEligible(dummyBogoPromo, { branchCode: 'MAIN', dateStr: '2026-06-01' }), true);
    assert.equal(isPromotionEligible({ ...dummyBogoPromo, status: 'paused' }, {}), false);
    assert.equal(isPromotionEligible({ ...dummyBogoPromo, endDate: '2025-01-01' }, { dateStr: '2026-01-01' }), false);
    assert.equal(isPromotionEligible({ ...dummyBogoPromo, branches: ['BRANCH-2'] }, { branchCode: 'MAIN' }), false);
  });

  it('evaluates BOGO promotion when customer has 3 items (Buy 2 Get 1 Free)', () => {
    const cart: CartItemForEval[] = [
      {
        itemId: 'item_biscuit_marie',
        name: 'Britannia Marie Gold',
        category: 'Snacks',
        priceMinor: 3500, // ₹35.00
        qty: 3,
      },
    ];

    const result = evaluatePromotions(cart, [dummyBogoPromo], { branchCode: 'MAIN' });
    assert.equal(result.appliedPromotions.length, 1);
    assert.equal(result.appliedPromotions[0].promotionId, 'promo_bogo_1');
    assert.equal(result.appliedPromotions[0].discountMinor, 3500); // 1 free unit = ₹35
    assert.equal(result.lineDiscounts[0], 3500);
    assert.equal(result.totalDiscountMinor, 3500);
  });

  it('generates nudge when customer has 1 item for BOGO (needs 1 more to unlock)', () => {
    const cart: CartItemForEval[] = [
      {
        itemId: 'item_biscuit_marie',
        name: 'Britannia Marie Gold',
        category: 'Snacks',
        priceMinor: 3500,
        qty: 1,
      },
    ];

    const result = evaluatePromotions(cart, [dummyBogoPromo], { branchCode: 'MAIN' });
    assert.equal(result.appliedPromotions.length, 0);
    assert.equal(result.nudges.length, 1);
    assert.match(result.nudges[0].message, /Add 1 more item to unlock Buy 2 Get 1 Free Marie Gold/);
  });

  it('triggers auto free item when customer qualifies with 2 items for Buy 2 Get 1 Free', () => {
    const cart: CartItemForEval[] = [
      {
        itemId: 'item_biscuit_marie',
        name: 'Britannia Marie Gold',
        category: 'Snacks',
        priceMinor: 3500,
        qty: 2,
      },
    ];

    const result = evaluatePromotions(cart, [dummyBogoPromo], { branchCode: 'MAIN' });
    assert.equal(result.autoFreeItems.length, 1);
    assert.equal(result.autoFreeItems[0].productId, 'item_biscuit_marie');
    assert.equal(result.autoFreeItems[0].qty, 1);
  });

  it('evaluates percentage discount on category', () => {
    const cart: CartItemForEval[] = [
      {
        itemId: 'item_biscuit_marie',
        name: 'Britannia Marie Gold',
        category: 'Snacks',
        priceMinor: 3500,
        qty: 2, // ₹70 gross
      },
      {
        itemId: 'item_atta_5k',
        name: 'Atta 5kg',
        category: 'Grains & Staples',
        priceMinor: 29000,
        qty: 1, // Not snacks
      },
    ];

    const result = evaluatePromotions(cart, [dummyPercentagePromo], { branchCode: 'MAIN' });
    assert.equal(result.appliedPromotions.length, 1);
    assert.equal(result.appliedPromotions[0].discountMinor, 700); // 10% of ₹70.00 = ₹7.00 (700 paise)
    assert.equal(result.lineDiscounts[0], 700);
    assert.equal(result.lineDiscounts[1] || 0, 0);
  });

  it('evaluates bill level discount when threshold is met', () => {
    const cart: CartItemForEval[] = [
      {
        itemId: 'item_rice_5k',
        name: 'Basmati Rice',
        category: 'Grains & Staples',
        priceMinor: 55000, // ₹550
        qty: 1,
      },
    ];

    const result = evaluatePromotions(cart, [dummyBillLevelPromo], { branchCode: 'MAIN' });
    assert.equal(result.appliedPromotions.length, 1);
    assert.equal(result.billDiscountMinor, 5000); // ₹50 off
    assert.equal(result.totalDiscountMinor, 5000);
  });

  it('generates spend more nudge when bill threshold is not met', () => {
    const cart: CartItemForEval[] = [
      {
        itemId: 'item_biscuit_marie',
        name: 'Britannia Marie Gold',
        category: 'Snacks',
        priceMinor: 3500, // ₹35
        qty: 1,
      },
    ];

    const result = evaluatePromotions(cart, [dummyBillLevelPromo], { branchCode: 'MAIN' });
    assert.equal(result.appliedPromotions.length, 0);
    assert.equal(result.nudges.length, 1);
    assert.match(result.nudges[0].message, /Add ₹465 more/);
  });
});
