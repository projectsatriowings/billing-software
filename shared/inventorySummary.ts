/**
 * Inventory Summary & Valuation Calculations
 * Single source of truth for Inventory Hub KPI metrics, valuations, status classifications, and formatting.
 */

export interface InventoryItemLike {
  id?: string;
  name?: string;
  category?: string | null;
  active?: boolean;
  trackStock?: boolean;
  track_stock?: boolean;
  currentStockMilli?: number | string | null;
  stockMilli?: number | string | null;
  stock_milli?: number | string | null;
  costMinor?: number | string | null;
  cost_minor?: number | string | null;
  priceMinor?: number | string | null;
  reorderMilli?: number | string | null;
  reorder_milli?: number | string | null;
  minStockMilli?: number | string | null;
  min_stock_milli?: number | string | null;
  unit?: string | null;
}

export interface InventorySummaryStats {
  totalActive: number;
  inStockCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  zeroStockCount: number;
  negativeStockCount: number;
  unconfiguredCount: number;
  distinctCategoryCount: number;
  totalStockValueMinor: number;
  totalStockValueRupees: number;
  inStockPct: number;
  lowStockPct: number;
  outOfStockPct: number;
}

export type StockStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | 'negative_stock';

/**
 * Parses numbers safely, stripping currency signs (₹, $), commas, and whitespace.
 * Defaults to fallback (0) if null, undefined, or NaN.
 */
export function parseNumberSafe(value: unknown, fallback: number = 0): number {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[₹$,\s]/g, '');
    if (!cleaned) return fallback;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

/**
 * Formats a currency value in Indian numbering format: e.g. ₹11,515.00
 */
export function formatIndianCurrency(amountRupees: unknown): string {
  const num = parseNumberSafe(amountRupees, 0);
  return num.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Formats stock quantities:
 * Whole numbers: no decimal places (e.g. "49 bag", not "49.0 bag")
 * Fractional values: up to 3 decimals without trailing zeros (e.g. "1.25 kg", "0.5 ltr")
 */
export function formatStockQuantity(stockUnits: unknown, unitName: string = ''): string {
  const num = parseNumberSafe(stockUnits, 0);
  const formattedNumber = Number.isInteger(num)
    ? num.toString()
    : parseFloat(num.toFixed(3)).toString();
  return unitName ? `${formattedNumber} ${unitName}` : formattedNumber;
}

/**
 * Determines stock status according to exact inventory rules:
 * - Negative: current stock < 0
 * - Out of Stock: current stock == 0
 * - Low Stock: stock > 0 AND reorder level is configured (> 0) AND stock <= reorder level
 * - In Stock: stock > 0 AND not Low Stock
 */
export function determineStockStatus(
  stockUnits: unknown,
  reorderUnits: unknown,
  minUnits: unknown = 0,
): StockStatus {
  const stock = parseNumberSafe(stockUnits, 0);
  const reorder = parseNumberSafe(reorderUnits, 0);
  const minStock = parseNumberSafe(minUnits, 0);
  const threshold = Math.max(reorder, minStock);

  if (stock < 0) return 'negative_stock';
  if (stock === 0) return 'out_of_stock';
  if (threshold > 0 && stock <= threshold) return 'low_stock';
  return 'in_stock';
}

/**
 * Computes inventory summary metrics for a given list of products in scope.
 */
export function calculateInventorySummary(items: InventoryItemLike[] = []): InventorySummaryStats {
  let totalActive = 0;
  let inStockCount = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let zeroStockCount = 0;
  let negativeStockCount = 0;
  let unconfiguredCount = 0;
  let totalStockValueMinor = 0;
  const categoriesSet = new Set<string>();

  for (const item of items) {
    // Only count active and tracked items
    const isActive = item.active !== false;
    const isTracked = item.trackStock !== false && item.track_stock !== false;
    if (!isActive || !isTracked) continue;

    totalActive++;

    const stockMilli = parseNumberSafe(
      item.currentStockMilli ?? item.stockMilli ?? item.stock_milli,
      0,
    );
    const costMinor = parseNumberSafe(item.costMinor ?? item.cost_minor, 0);
    const reorderMilli = parseNumberSafe(item.reorderMilli ?? item.reorder_milli, 0);
    const minStockMilli = parseNumberSafe(item.minStockMilli ?? item.min_stock_milli, 0);
    const thresholdMilli = Math.max(reorderMilli, minStockMilli);

    if (stockMilli < 0) {
      negativeStockCount++;
      outOfStockCount++;
    } else if (stockMilli === 0) {
      zeroStockCount++;
      outOfStockCount++;
    } else {
      // stockMilli > 0
      if (thresholdMilli > 0 && stockMilli <= thresholdMilli) {
        lowStockCount++;
      } else {
        inStockCount++;
      }
      totalStockValueMinor += Math.round((stockMilli * costMinor) / 1000);
    }

    if (reorderMilli <= 0 && minStockMilli <= 0) {
      unconfiguredCount++;
    }

    const cat = (item.category || '').trim();
    if (cat) {
      categoriesSet.add(cat.toLowerCase());
    }
  }

  const inStockPct = totalActive > 0 ? Math.round((inStockCount / totalActive) * 100) : 0;
  const lowStockPct = totalActive > 0 ? Math.round((lowStockCount / totalActive) * 100) : 0;
  const outOfStockPct = totalActive > 0 ? Math.max(0, 100 - inStockPct - lowStockPct) : 0;

  return {
    totalActive,
    inStockCount,
    lowStockCount,
    outOfStockCount,
    zeroStockCount,
    negativeStockCount,
    unconfiguredCount,
    distinctCategoryCount: categoriesSet.size,
    totalStockValueMinor,
    totalStockValueRupees: totalStockValueMinor / 100,
    inStockPct,
    lowStockPct,
    outOfStockPct,
  };
}
