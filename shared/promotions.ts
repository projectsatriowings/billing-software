// Shared Types and Pure Evaluation Engine for Discounts & Promotions

export type PromotionType =
  | 'percentage'
  | 'fixed_amount'
  | 'bogo'
  | 'buy_x_get_y_discount'
  | 'category_discount'
  | 'product_discount'
  | 'min_purchase'
  | 'quantity_based'
  | 'bill_level';

export const PROMOTION_TYPES: { id: PromotionType; label: string; description: string }[] = [
  { id: 'percentage', label: 'Percentage Discount', description: 'Percentage off on selected items or whole bill' },
  { id: 'fixed_amount', label: 'Fixed Amount Discount', description: 'Flat rupee discount on selected items or whole bill' },
  { id: 'bogo', label: 'Buy X Get Y Free (BOGO)', description: 'Buy qualifying items, get free items automatically' },
  { id: 'buy_x_get_y_discount', label: 'Buy X Get Y at Discounted Price', description: 'Buy qualifying items, get target items at special price' },
  { id: 'category_discount', label: 'Category-Wise Discount', description: 'Discount applied across an entire product category' },
  { id: 'product_discount', label: 'Product-Wise Discount', description: 'Special promotional pricing for specific products' },
  { id: 'min_purchase', label: 'Minimum Purchase Discount', description: 'Discount unlocked when purchase exceeds a minimum amount' },
  { id: 'quantity_based', label: 'Quantity-Based Discount', description: 'Tiered volume discounts based on quantity slabs' },
  { id: 'bill_level', label: 'Bill-Level Discount', description: 'Overall discount applied to the entire bill total' },
];

export type PromotionStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'expired';

export interface QuantitySlab {
  minQty: number;
  discountPct?: number;
  discountAmountMinor?: number; // paise
}

export interface PromotionRules {
  // Common targeting
  productIds?: string[];
  categoryNames?: string[];
  
  // Percentage / Fixed rules
  discountPct?: number; // e.g. 10 for 10%
  discountAmountMinor?: number; // in paise (e.g. 5000 = ₹50)
  maxDiscountMinor?: number; // max cap in paise
  minPurchaseQty?: number;
  minBillAmountMinor?: number; // in paise
  minSpendMinor?: number; // in paise

  // BOGO / Buy X Get Y
  qualifyingProductId?: string;
  qualifyingProductName?: string;
  qualifyingCategoryId?: string;
  qualifyingQty?: number;
  freeProductId?: string;
  freeProductName?: string;
  freeCategoryId?: string;
  freeQty?: number;
  sameProduct?: boolean;
  maxFreePerBill?: number;
  
  // Buy X Get Y at Discounted Price
  targetProductId?: string;
  targetProductName?: string;
  targetCategoryId?: string;
  targetQty?: number;
  targetDiscountPct?: number;
  targetFixedPriceMinor?: number;

  // Quantity Slabs
  slabs?: QuantitySlab[];
}

export interface Promotion {
  id: string;
  tenantId: string;
  name: string;
  description?: string | null;
  type: PromotionType;
  status: PromotionStatus;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  branches: string[]; // ['ALL'] or ['MAIN', 'BRANCH-2']
  counters: string[]; // ['ALL'] or ['COUNTER-1']
  rules: PromotionRules;
  customerEligibilityType: 'all' | 'selected';
  eligibleCustomerIds: string[];
  maxTotalUsage?: number | null;
  maxUsagePerCustomer?: number | null;
  currentUsageCount: number;
  showBannerOnPos: boolean;
  allowStacking: boolean;
  minBillAmountMinor: number;
  maxDiscountMinor?: number | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PromotionInput {
  name: string;
  description?: string | null;
  type: PromotionType;
  status?: PromotionStatus;
  startDate: string;
  endDate: string;
  branches?: string[];
  counters?: string[];
  rules: PromotionRules;
  customerEligibilityType?: 'all' | 'selected';
  eligibleCustomerIds?: string[];
  maxTotalUsage?: number | null;
  maxUsagePerCustomer?: number | null;
  showBannerOnPos?: boolean;
  allowStacking?: boolean;
  minBillAmountMinor?: number;
  maxDiscountMinor?: number | null;
}

export interface CartItemForEval {
  itemId?: string;
  name: string;
  category?: string;
  barcode?: string;
  sku?: string;
  hsn?: string;
  unit?: string;
  priceMinor: number; // paise
  taxRateBp?: number;
  taxInclusive?: boolean;
  qty: number; // units (e.g. 1, 2)
  isFreeItem?: boolean;
  appliedPromotionId?: string;
}

export interface AppliedPromotionDetail {
  promotionId: string;
  promotionName: string;
  promotionType: PromotionType;
  discountMinor: number; // paise
  description: string;
  qualifyingQty?: number;
  freeQty?: number;
  freeItemName?: string;
  lineIndex?: number;
}

export interface PromotionNudge {
  promotionId: string;
  promotionName: string;
  message: string;
  type: 'add_qty' | 'spend_more';
  missingQty?: number;
  missingAmountMinor?: number;
  targetItemName?: string;
}

export interface AutoFreeItem {
  productId?: string;
  productName: string;
  qty: number;
  priceMinor: number;
  taxRateBp?: number;
  taxInclusive?: boolean;
  unit?: string;
  hsn?: string;
  promotionId: string;
  promotionName: string;
}

export interface PromotionEvalResult {
  appliedPromotions: AppliedPromotionDetail[];
  lineDiscounts: Record<number, number>; // lineIndex -> discountMinor in paise
  billDiscountMinor: number; // bill-level discount in paise
  totalDiscountMinor: number; // sum of line discounts + bill discount
  nudges: PromotionNudge[];
  eligibleOffersCount: number;
  autoFreeItems: AutoFreeItem[];
}

/** Check whether a promotion is currently active on the given date and location */
export function isPromotionEligible(
  p: Promotion,
  ctx: {
    dateStr?: string; // YYYY-MM-DD
    branchCode?: string;
    counterCode?: string;
    partyId?: string;
    customerUsageCount?: number;
  }
): boolean {
  if (p.status !== 'active') return false;

  const today = ctx.dateStr || new Date().toISOString().slice(0, 10);
  if (p.startDate && p.startDate > today) return false;
  if (p.endDate && p.endDate < today) return false;

  if (p.maxTotalUsage !== null && p.maxTotalUsage !== undefined && p.maxTotalUsage > 0) {
    if (p.currentUsageCount >= p.maxTotalUsage) return false;
  }

  if (p.branches && p.branches.length > 0 && !p.branches.includes('ALL')) {
    if (ctx.branchCode && !p.branches.includes(ctx.branchCode)) return false;
  }

  if (p.counters && p.counters.length > 0 && !p.counters.includes('ALL')) {
    if (ctx.counterCode && !p.counters.includes(ctx.counterCode)) return false;
  }

  if (p.customerEligibilityType === 'selected') {
    if (!ctx.partyId || !p.eligibleCustomerIds?.includes(ctx.partyId)) {
      return false;
    }
  }

  if (p.maxUsagePerCustomer !== null && p.maxUsagePerCustomer !== undefined && p.maxUsagePerCustomer > 0) {
    if ((ctx.customerUsageCount ?? 0) >= p.maxUsagePerCustomer) {
      return false;
    }
  }

  return true;
}

/**
 * Pure, authoritative promotion evaluation engine.
 */
export function evaluatePromotions(
  cart: CartItemForEval[],
  promotions: Promotion[],
  context: {
    dateStr?: string;
    branchCode?: string;
    counterCode?: string;
    partyId?: string;
    customerUsageMap?: Record<string, number>;
  } = {}
): PromotionEvalResult {
  const lineDiscounts: Record<number, number> = {};
  const appliedPromotions: AppliedPromotionDetail[] = [];
  const nudges: PromotionNudge[] = [];
  const autoFreeItems: AutoFreeItem[] = [];
  let billDiscountMinor = 0;

  if (!cart || cart.length === 0 || !promotions || promotions.length === 0) {
    return {
      appliedPromotions: [],
      lineDiscounts: {},
      billDiscountMinor: 0,
      totalDiscountMinor: 0,
      nudges: [],
      eligibleOffersCount: 0,
      autoFreeItems: [],
    };
  }

  const eligiblePromotions = promotions.filter((p) =>
    isPromotionEligible(p, {
      ...context,
      customerUsageCount: context.partyId && context.customerUsageMap ? (context.customerUsageMap[p.id] || 0) : 0,
    })
  );

  const cartGrossSubtotal = cart.reduce((acc, c) => acc + (c.isFreeItem ? 0 : c.priceMinor * c.qty), 0);

  let hasAppliedNonStackable = false;

  for (const promo of eligiblePromotions) {
    if (hasAppliedNonStackable && !promo.allowStacking) {
      continue;
    }

    const rules = promo.rules || {};
    const minBillAmount = promo.minBillAmountMinor || rules.minBillAmountMinor || 0;

    if (minBillAmount > 0 && cartGrossSubtotal < minBillAmount) {
      const missing = minBillAmount - cartGrossSubtotal;
      nudges.push({
        promotionId: promo.id,
        promotionName: promo.name,
        message: `Add ₹${(missing / 100).toFixed(0)} more to unlock ${promo.name}`,
        type: 'spend_more',
        missingAmountMinor: missing,
      });
      continue;
    }

    switch (promo.type) {
      case 'bogo': {
        const qualProductId = rules.qualifyingProductId;
        const qualCategoryId = rules.qualifyingCategoryId;
        const qualQty = Math.max(1, rules.qualifyingQty || 1);
        const freeQtyConfig = Math.max(1, rules.freeQty || 1);
        const freeProductId = rules.sameProduct ? qualProductId : rules.freeProductId;
        const maxFreePerBill = rules.maxFreePerBill || 100;

        // Separate non-free qualifying items and explicitly free items in cart
        const qualLines = cart
          .map((item, idx) => ({ item, idx }))
          .filter(({ item }) => {
            if (item.isFreeItem) return false;
            if (qualProductId && item.itemId === qualProductId) return true;
            if (qualCategoryId && item.category?.toLowerCase() === qualCategoryId.toLowerCase()) return true;
            return false;
          });

        const freeLines = cart
          .map((item, idx) => ({ item, idx }))
          .filter(({ item }) => {
            if (!item.isFreeItem) return false;
            if (freeProductId && item.itemId === freeProductId) return true;
            return false;
          });

        const totalQualQty = qualLines.reduce((acc, { item }) => acc + item.qty, 0);

        if (totalQualQty >= qualQty) {
          // Qualified for BOGO!
          const setsEarned = Math.floor(totalQualQty / qualQty);
          const totalFreeEntitled = Math.min(setsEarned * freeQtyConfig, maxFreePerBill);

          if (rules.sameProduct || !freeProductId || freeProductId === qualProductId) {
            // Same product BOGO
            // Case A: Cart has explicit free item line
            const existingFreeUnits = freeLines.reduce((acc, { item }) => acc + item.qty, 0);

            if (existingFreeUnits > 0) {
              // Discount 100% on the free line items
              let remaining = totalFreeEntitled;
              let disc = 0;
              for (const { item, idx } of freeLines) {
                if (remaining <= 0) break;
                const units = Math.min(item.qty, remaining);
                const d = item.priceMinor * units;
                lineDiscounts[idx] = (lineDiscounts[idx] || 0) + d;
                disc += d;
                remaining -= units;
              }
              if (disc > 0) {
                appliedPromotions.push({
                  promotionId: promo.id,
                  promotionName: promo.name,
                  promotionType: promo.type,
                  discountMinor: disc,
                  description: `Buy ${qualQty} Get ${freeQtyConfig} Free (${totalFreeEntitled} free units)`,
                  qualifyingQty: totalQualQty,
                  freeQty: totalFreeEntitled,
                  freeItemName: qualLines[0]?.item.name,
                });
                if (!promo.allowStacking) hasAppliedNonStackable = true;
              }
            } else if (totalQualQty >= qualQty + freeQtyConfig) {
              // Case B: Cashier added 3 items together in one non-free line (e.g. qty: 3 for Buy 2 Get 1)
              // Calculate how many full groups of (qualQty + freeQtyConfig) are present
              const fullGroupSize = qualQty + freeQtyConfig;
              const groupsInCart = Math.floor(totalQualQty / fullGroupSize);
              const freeUnitsInCart = Math.min(groupsInCart * freeQtyConfig, maxFreePerBill);

              if (freeUnitsInCart > 0) {
                let remainingFree = freeUnitsInCart;
                let disc = 0;
                for (const { item, idx } of qualLines) {
                  if (remainingFree <= 0) break;
                  const units = Math.min(item.qty, remainingFree);
                  const d = item.priceMinor * units;
                  lineDiscounts[idx] = (lineDiscounts[idx] || 0) + d;
                  disc += d;
                  remainingFree -= units;
                }
                if (disc > 0) {
                  appliedPromotions.push({
                    promotionId: promo.id,
                    promotionName: promo.name,
                    promotionType: promo.type,
                    discountMinor: disc,
                    description: `Buy ${qualQty} Get ${freeQtyConfig} Free (${freeUnitsInCart} free items discounted)`,
                    qualifyingQty: totalQualQty,
                    freeQty: freeUnitsInCart,
                    freeItemName: qualLines[0]?.item.name,
                  });
                  if (!promo.allowStacking) hasAppliedNonStackable = true;
                }
              } else {
                // Customer has qualified (e.g. 2 items for Buy 2 Get 1), suggest auto adding 1 free unit
                const sample = qualLines[0].item;
                autoFreeItems.push({
                  productId: sample.itemId,
                  productName: sample.name,
                  qty: totalFreeEntitled,
                  priceMinor: sample.priceMinor,
                  taxRateBp: sample.taxRateBp,
                  taxInclusive: sample.taxInclusive,
                  unit: sample.unit,
                  hsn: sample.hsn,
                  promotionId: promo.id,
                  promotionName: promo.name,
                });
              }
            } else {
              // Case C: Exactly qualQty in cart (e.g. 2 biscuits).
              // Automatically specify free item to add to bill!
              const sample = qualLines[0].item;
              autoFreeItems.push({
                productId: sample.itemId,
                productName: sample.name,
                qty: totalFreeEntitled,
                priceMinor: sample.priceMinor,
                taxRateBp: sample.taxRateBp,
                taxInclusive: sample.taxInclusive,
                unit: sample.unit,
                hsn: sample.hsn,
                promotionId: promo.id,
                promotionName: promo.name,
              });
            }
          } else {
            // Different free product BOGO
            const targetFreeLines = cart
              .map((item, idx) => ({ item, idx }))
              .filter(({ item }) => item.itemId === freeProductId);

            if (targetFreeLines.length > 0) {
              let remaining = totalFreeEntitled;
              let disc = 0;
              for (const { item, idx } of targetFreeLines) {
                if (remaining <= 0) break;
                const units = Math.min(item.qty, remaining);
                const d = item.priceMinor * units;
                lineDiscounts[idx] = (lineDiscounts[idx] || 0) + d;
                disc += d;
                remaining -= units;
              }
              if (disc > 0) {
                appliedPromotions.push({
                  promotionId: promo.id,
                  promotionName: promo.name,
                  promotionType: promo.type,
                  discountMinor: disc,
                  description: `BOGO Offer: ${totalFreeEntitled} Free ${rules.freeProductName || 'item'}`,
                  qualifyingQty: totalQualQty,
                  freeQty: totalFreeEntitled,
                  freeItemName: rules.freeProductName,
                });
                if (!promo.allowStacking) hasAppliedNonStackable = true;
              }
            } else {
              nudges.push({
                promotionId: promo.id,
                promotionName: promo.name,
                message: `Qualified for BOGO! Add ${totalFreeEntitled} ${rules.freeProductName || 'Free Item'} to get it FREE!`,
                type: 'add_qty',
                missingQty: totalFreeEntitled,
                targetItemName: rules.freeProductName,
              });
            }
          }
        } else if (totalQualQty > 0) {
          const missing = qualQty - totalQualQty;
          nudges.push({
            promotionId: promo.id,
            promotionName: promo.name,
            message: `Add ${missing} more item${missing > 1 ? 's' : ''} to unlock ${promo.name}`,
            type: 'add_qty',
            missingQty: missing,
            targetItemName: qualLines[0]?.item.name,
          });
        }
        break;
      }

      case 'percentage':
      case 'product_discount':
      case 'category_discount': {
        const targetProductIds = rules.productIds || [];
        const targetCategories = (rules.categoryNames || []).map((c) => c.toLowerCase());
        const pct = rules.discountPct || 0;
        const flatAmount = rules.discountAmountMinor || 0;
        const minQty = rules.minPurchaseQty || 1;
        const maxDiscount = rules.maxDiscountMinor || promo.maxDiscountMinor;

        let promoDiscountTotal = 0;

        cart.forEach((item, idx) => {
          if (item.isFreeItem) return;
          const matchesProduct = targetProductIds.length > 0 && item.itemId && targetProductIds.includes(item.itemId);
          const matchesCategory = targetCategories.length > 0 && item.category && targetCategories.includes(item.category.toLowerCase());
          const matchesAll = targetProductIds.length === 0 && targetCategories.length === 0;

          if (matchesProduct || matchesCategory || matchesAll) {
            if (item.qty >= minQty) {
              const lineGross = item.priceMinor * item.qty;
              let disc = 0;
              if (pct > 0) {
                disc = Math.round((lineGross * pct) / 100);
              } else if (flatAmount > 0) {
                disc = flatAmount * item.qty;
              }

              if (disc > lineGross) disc = lineGross;

              if (maxDiscount && promoDiscountTotal + disc > maxDiscount) {
                disc = Math.max(0, maxDiscount - promoDiscountTotal);
              }

              if (disc > 0) {
                lineDiscounts[idx] = (lineDiscounts[idx] || 0) + disc;
                promoDiscountTotal += disc;
              }
            } else if (item.qty > 0 && minQty > item.qty) {
              const missing = minQty - item.qty;
              nudges.push({
                promotionId: promo.id,
                promotionName: promo.name,
                message: `Add ${missing} more ${item.name} to get ${pct > 0 ? pct + '% off' : 'promotional discount'}`,
                type: 'add_qty',
                missingQty: missing,
                targetItemName: item.name,
              });
            }
          }
        });

        if (promoDiscountTotal > 0) {
          appliedPromotions.push({
            promotionId: promo.id,
            promotionName: promo.name,
            promotionType: promo.type,
            discountMinor: promoDiscountTotal,
            description: `${pct > 0 ? pct + '% Off' : 'Special Discount'} applied`,
          });
          if (!promo.allowStacking) hasAppliedNonStackable = true;
        }
        break;
      }

      case 'fixed_amount': {
        const targetProductIds = rules.productIds || [];
        const targetCategories = (rules.categoryNames || []).map((c) => c.toLowerCase());
        const flatAmount = rules.discountAmountMinor || 0;
        const maxDiscount = rules.maxDiscountMinor || promo.maxDiscountMinor;

        if (flatAmount > 0) {
          if (targetProductIds.length === 0 && targetCategories.length === 0) {
            let disc = flatAmount;
            if (maxDiscount && disc > maxDiscount) disc = maxDiscount;
            if (disc > cartGrossSubtotal) disc = cartGrossSubtotal;

            if (disc > 0) {
              billDiscountMinor += disc;
              appliedPromotions.push({
                promotionId: promo.id,
                promotionName: promo.name,
                promotionType: promo.type,
                discountMinor: disc,
                description: `Flat ₹${(disc / 100).toFixed(0)} Off on bill`,
              });
              if (!promo.allowStacking) hasAppliedNonStackable = true;
            }
          } else {
            let promoDisc = 0;
            cart.forEach((item, idx) => {
              if (item.isFreeItem) return;
              const matchesProduct = targetProductIds.length > 0 && item.itemId && targetProductIds.includes(item.itemId);
              const matchesCategory = targetCategories.length > 0 && item.category && targetCategories.includes(item.category.toLowerCase());
              if (matchesProduct || matchesCategory) {
                let disc = flatAmount * item.qty;
                const lineGross = item.priceMinor * item.qty;
                if (disc > lineGross) disc = lineGross;
                if (maxDiscount && promoDisc + disc > maxDiscount) {
                  disc = Math.max(0, maxDiscount - promoDisc);
                }
                if (disc > 0) {
                  lineDiscounts[idx] = (lineDiscounts[idx] || 0) + disc;
                  promoDisc += disc;
                }
              }
            });

            if (promoDisc > 0) {
              appliedPromotions.push({
                promotionId: promo.id,
                promotionName: promo.name,
                promotionType: promo.type,
                discountMinor: promoDisc,
                description: `Flat discount applied on selected items`,
              });
              if (!promo.allowStacking) hasAppliedNonStackable = true;
            }
          }
        }
        break;
      }

      case 'quantity_based': {
        const slabs = (rules.slabs || []).sort((a, b) => b.minQty - a.minQty);
        const targetProductIds = rules.productIds || [];
        const targetCategories = (rules.categoryNames || []).map((c) => c.toLowerCase());

        let totalEligibleQty = 0;
        const matchingIndices: number[] = [];

        cart.forEach((item, idx) => {
          if (item.isFreeItem) return;
          const matchesProduct = targetProductIds.length === 0 || (item.itemId && targetProductIds.includes(item.itemId));
          const matchesCategory = targetCategories.length === 0 || (item.category && targetCategories.includes(item.category.toLowerCase()));
          if (matchesProduct && matchesCategory) {
            totalEligibleQty += item.qty;
            matchingIndices.push(idx);
          }
        });

        const appliedSlab = slabs.find((s) => totalEligibleQty >= s.minQty);
        if (appliedSlab) {
          let slabDiscountTotal = 0;
          matchingIndices.forEach((idx) => {
            const item = cart[idx];
            const lineGross = item.priceMinor * item.qty;
            let disc = 0;
            if (appliedSlab.discountPct && appliedSlab.discountPct > 0) {
              disc = Math.round((lineGross * appliedSlab.discountPct) / 100);
            } else if (appliedSlab.discountAmountMinor && appliedSlab.discountAmountMinor > 0) {
              disc = appliedSlab.discountAmountMinor * item.qty;
            }
            if (disc > lineGross) disc = lineGross;
            lineDiscounts[idx] = (lineDiscounts[idx] || 0) + disc;
            slabDiscountTotal += disc;
          });

          if (slabDiscountTotal > 0) {
            appliedPromotions.push({
              promotionId: promo.id,
              promotionName: promo.name,
              promotionType: promo.type,
              discountMinor: slabDiscountTotal,
              description: `Tier discount applied for purchasing ${totalEligibleQty} items (${appliedSlab.discountPct ? appliedSlab.discountPct + '%' : 'special rate'})`,
            });
            if (!promo.allowStacking) hasAppliedNonStackable = true;
          }
        } else if (slabs.length > 0 && totalEligibleQty > 0) {
          const nextSlab = slabs[slabs.length - 1];
          if (nextSlab && totalEligibleQty < nextSlab.minQty) {
            const missing = nextSlab.minQty - totalEligibleQty;
            nudges.push({
              promotionId: promo.id,
              promotionName: promo.name,
              message: `Add ${missing} more item${missing > 1 ? 's' : ''} to unlock volume discount (${nextSlab.discountPct ? nextSlab.discountPct + '% off' : 'special price'})`,
              type: 'add_qty',
              missingQty: missing,
            });
          }
        }
        break;
      }

      case 'min_purchase':
      case 'bill_level': {
        const minSpend = rules.minSpendMinor || rules.minBillAmountMinor || promo.minBillAmountMinor || 0;
        const pct = rules.discountPct || 0;
        const flatAmount = rules.discountAmountMinor || 0;
        const maxDiscount = rules.maxDiscountMinor || promo.maxDiscountMinor;

        if (cartGrossSubtotal >= minSpend) {
          let disc = 0;
          if (pct > 0) {
            disc = Math.round((cartGrossSubtotal * pct) / 100);
          } else if (flatAmount > 0) {
            disc = flatAmount;
          }

          if (maxDiscount && disc > maxDiscount) disc = maxDiscount;
          if (disc > cartGrossSubtotal) disc = cartGrossSubtotal;

          if (disc > 0) {
            billDiscountMinor += disc;
            appliedPromotions.push({
              promotionId: promo.id,
              promotionName: promo.name,
              promotionType: promo.type,
              discountMinor: disc,
              description: `${promo.name}: ${pct > 0 ? pct + '% off' : '₹' + (disc / 100).toFixed(0) + ' off'} on bill`,
            });
            if (!promo.allowStacking) hasAppliedNonStackable = true;
          }
        } else if (minSpend > cartGrossSubtotal) {
          const missing = minSpend - cartGrossSubtotal;
          nudges.push({
            promotionId: promo.id,
            promotionName: promo.name,
            message: `Spend ₹${(missing / 100).toFixed(0)} more to unlock ${pct > 0 ? pct + '% off' : '₹' + (flatAmount / 100).toFixed(0) + ' discount'}!`,
            type: 'spend_more',
            missingAmountMinor: missing,
          });
        }
        break;
      }

      case 'buy_x_get_y_discount': {
        const qualProductId = rules.qualifyingProductId;
        const qualQty = Math.max(1, rules.qualifyingQty || 1);
        const targetProductId = rules.targetProductId;
        const targetQty = Math.max(1, rules.targetQty || 1);
        const targetPct = rules.targetDiscountPct || 0;
        const targetFixed = rules.targetFixedPriceMinor;

        const qualUnits = cart
          .filter((c) => !c.isFreeItem && c.itemId === qualProductId)
          .reduce((sum, c) => sum + c.qty, 0);

        if (qualUnits >= qualQty) {
          const targetLineIdx = cart.findIndex((c) => c.itemId === targetProductId);
          if (targetLineIdx >= 0) {
            const targetItem = cart[targetLineIdx];
            const setsEarned = Math.floor(qualUnits / qualQty);
            const eligibleTargetUnits = Math.min(targetItem.qty, setsEarned * targetQty);

            let disc = 0;
            if (targetPct > 0) {
              disc = Math.round((targetItem.priceMinor * eligibleTargetUnits * targetPct) / 100);
            } else if (targetFixed !== undefined && targetFixed < targetItem.priceMinor) {
              disc = (targetItem.priceMinor - targetFixed) * eligibleTargetUnits;
            }

            if (disc > 0) {
              lineDiscounts[targetLineIdx] = (lineDiscounts[targetLineIdx] || 0) + disc;
              appliedPromotions.push({
                promotionId: promo.id,
                promotionName: promo.name,
                promotionType: promo.type,
                discountMinor: disc,
                description: `Special price applied on ${targetItem.name}`,
                lineIndex: targetLineIdx,
              });
              if (!promo.allowStacking) hasAppliedNonStackable = true;
            }
          } else {
            nudges.push({
              promotionId: promo.id,
              promotionName: promo.name,
              message: `Add ${rules.targetProductName || 'special offer item'} to get it at discounted price!`,
              type: 'add_qty',
              missingQty: targetQty,
              targetItemName: rules.targetProductName,
            });
          }
        }
        break;
      }
    }
  }

  const lineDiscountsTotal = Object.values(lineDiscounts).reduce((a, b) => a + b, 0);
  const totalDiscountMinor = lineDiscountsTotal + billDiscountMinor;

  return {
    appliedPromotions,
    lineDiscounts,
    billDiscountMinor,
    totalDiscountMinor,
    nudges,
    eligibleOffersCount: eligiblePromotions.length,
    autoFreeItems,
  };
}
