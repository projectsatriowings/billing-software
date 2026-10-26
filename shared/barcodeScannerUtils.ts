/**
 * Pure utility functions for Manufacturer Barcode Scanning & Validation.
 *
 * Implements GS1 modulo-10 check digit algorithms (EAN-8, UPC-A, EAN-13, GTIN-14),
 * input normalisation (AIM symbology prefix stripping, whitespace cleanup),
 * duplicate detection, barcode symbology detection, and list filtering.
 *
 * Free of React/DOM dependencies to enable direct unit testing.
 */

export interface BarcodeTargetItem {
  id: number | string;
  rowNum?: number;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  barcodeType?: 'MANUFACTURER' | 'INTERNAL' | null;
  category?: string | null;
  priceFormatted?: string | null;
  priceMinor?: number | null;
  unit?: string | null;
  scannedInSession?: boolean;
}

export type BarcodeSymbology = 'EAN-13' | 'UPC-A' | 'EAN-8' | 'GTIN-14' | 'Code 128';

export interface ScanValidationResult {
  isValid: boolean;
  normalizedCode: string;
  error?: string;
  warning?: string;
  info?: string;
  conflictingTargetId?: number | string;
  conflictingProductName?: string;
  barcodeType: BarcodeSymbology;
}

/**
 * Normalises scanned barcode strings:
 * - Trims outer whitespace
 * - Strips internal spaces, tabs, and newlines
 * - Strips AIM symbology identifiers (e.g. ]E0, ]E1, ]E4, ]C0, ]A0, ]e0) sent by barcode scanners
 */
export function normalizeScannedBarcode(raw: string): string {
  if (typeof raw !== 'string') return '';
  let str = raw.trim();

  // Strip AIM Symbology Identifiers (] followed by 1 code letter and 1 modifier character)
  // e.g. ]E0 for EAN/UPC, ]C0 for Code 128, ]e0 for GS1 DataBar
  str = str.replace(/^\][A-Za-z][0-9A-Za-z]/, '');

  // Strip all internal whitespace and line breaks
  str = str.replace(/[\s\r\n\t]/g, '');

  return str;
}

/**
 * Computes standard GS1 modulo-10 check digit for an arbitrary digit string.
 *
 * Moving right-to-left from the digit immediately preceding the check digit:
 * - Alternating weights 3 and 1 (weight 3 for odd distance from check digit).
 * - Check digit = (10 - (sum % 10)) % 10.
 */
export function calculateGs1CheckDigit(digits: string): number {
  if (!digits || !/^\d+$/.test(digits)) return -1;
  let sum = 0;
  const n = digits.length;
  for (let i = n - 1; i >= 0; i--) {
    const d = parseInt(digits[i], 10);
    const weight = (n - i) % 2 === 1 ? 3 : 1;
    sum += d * weight;
  }
  const rem = sum % 10;
  return rem === 0 ? 0 : 10 - rem;
}

/**
 * Verifies whether a numeric code of length 8, 12, 13, or 14 has a valid GS1 check digit.
 */
export function verifyGs1CheckDigit(code: string): { isValid: boolean; expectedCheckDigit?: number; actualCheckDigit?: number } {
  if (!code || !/^\d+$/.test(code)) return { isValid: false };
  const len = code.length;
  if (![8, 12, 13, 14].includes(len)) return { isValid: false };

  const dataPart = code.slice(0, len - 1);
  const actualCheckDigit = parseInt(code[len - 1], 10);
  const expectedCheckDigit = calculateGs1CheckDigit(dataPart);

  return {
    isValid: actualCheckDigit === expectedCheckDigit,
    expectedCheckDigit,
    actualCheckDigit,
  };
}

/**
 * Detects the standard barcode symbology for UI preview and labelling.
 */
export function detectBarcodeType(code: string): BarcodeSymbology {
  if (!code) return 'Code 128';
  const clean = code.trim();
  if (/^\d+$/.test(clean)) {
    if (clean.length === 13 && verifyGs1CheckDigit(clean).isValid) return 'EAN-13';
    if (clean.length === 12 && verifyGs1CheckDigit(clean).isValid) return 'UPC-A';
    if (clean.length === 8 && verifyGs1CheckDigit(clean).isValid) return 'EAN-8';
    if (clean.length === 14 && verifyGs1CheckDigit(clean).isValid) return 'GTIN-14';
    if (clean.length === 13) return 'EAN-13';
  }
  return 'Code 128';
}

/**
 * Validates a scanned barcode against GS1 check digit rules, character constraints,
 * and duplicate collision checks against current import session rows and store catalog.
 */
export function validateScannedBarcode(
  rawBarcode: string,
  options?: {
    currentTargetId?: number | string;
    targets?: BarcodeTargetItem[];
    takenCatalogBarcodes?: Map<string, { name: string; id?: string }>;
  }
): ScanValidationResult {
  const code = normalizeScannedBarcode(rawBarcode);

  // 1. Reject empty input
  if (!code) {
    return {
      isValid: false,
      normalizedCode: '',
      error: 'Please scan or enter a barcode.',
      barcodeType: 'Code 128',
    };
  }

  // 2. Reject non-printable / non-ASCII characters
  // Suggest setting scanner keyboard layout to English US
  // eslint-disable-next-line no-control-regex
  if (/[^\x20-\x7E]/.test(code)) {
    return {
      isValid: false,
      normalizedCode: code,
      error: 'Non-ASCII characters detected. Please check that your barcode scanner keyboard layout is set to English (US).',
      barcodeType: 'Code 128',
    };
  }

  // 3. Reject absurdly long input (> 60 characters)
  if (code.length > 60) {
    return {
      isValid: false,
      normalizedCode: code,
      error: `Barcode is too long (${code.length} characters, maximum 60 characters).`,
      barcodeType: 'Code 128',
    };
  }

  const barcodeType = detectBarcodeType(code);

  // 4. GS1 Check Digit Verification for numeric codes of length 8, 12, 13, 14
  if (/^\d+$/.test(code) && [8, 12, 13, 14].includes(code.length)) {
    const gs1Check = verifyGs1CheckDigit(code);
    if (!gs1Check.isValid) {
      return {
        isValid: false,
        normalizedCode: code,
        error: "Check digit doesn't match — scan it again",
        barcodeType,
      };
    }
  }

  const currentTargetId = options?.currentTargetId;
  const targets = options?.targets || [];
  const takenCatalog = options?.takenCatalogBarcodes || new Map();

  // Find current target product
  const currentTarget = currentTargetId !== undefined ? targets.find((t) => t.id === currentTargetId) : undefined;

  // 5. Check if the product already has this exact barcode
  if (currentTarget?.barcode && currentTarget.barcode.trim() === code) {
    return {
      isValid: true,
      normalizedCode: code,
      info: `Product "${currentTarget.name}" already has this exact barcode.`,
      barcodeType,
    };
  }

  // 6. Reject duplicate barcode assigned to another row in this import session
  const otherSessionRow = targets.find(
    (t) => t.id !== currentTargetId && t.barcode && t.barcode.trim() === code
  );
  if (otherSessionRow) {
    const rowDescriptor = otherSessionRow.rowNum ? `Row #${otherSessionRow.rowNum}` : 'another product';
    return {
      isValid: false,
      normalizedCode: code,
      error: `Barcode "${code}" is already assigned to ${rowDescriptor} ("${otherSessionRow.name}").`,
      conflictingTargetId: otherSessionRow.id,
      conflictingProductName: otherSessionRow.name,
      barcodeType,
    };
  }

  // 7. Reject duplicate barcode already assigned in store catalog
  const catalogMatch = takenCatalog.get(code);
  if (catalogMatch && catalogMatch.id !== String(currentTargetId)) {
    return {
      isValid: false,
      normalizedCode: code,
      error: `Barcode "${code}" is already assigned to existing catalogue product "${catalogMatch.name}".`,
      conflictingProductName: catalogMatch.name,
      barcodeType,
    };
  }

  // 8. Warning checks (valid, but issue advisories)
  let warning: string | undefined;

  if (code.startsWith('2') && /^\d+$/.test(code)) {
    warning = 'In-store / weighed-item code (prefix 2). Manufacturer barcodes typically use official GS1 country prefixes.';
  } else if (/^\d+$/.test(code) && ![8, 12, 13, 14].includes(code.length)) {
    warning = `Unusual numeric barcode length (${code.length} digits). Standard retail barcodes are 8, 12, 13, or 14 digits.`;
  } else if (/[A-Za-z]/.test(code)) {
    warning = 'Alphanumeric barcode code detected (internal shop format).';
  }

  return {
    isValid: true,
    normalizedCode: code,
    warning,
    barcodeType,
  };
}

/**
 * Pure filter for barcode targets list:
 * - Search query: matches product name, SKU, barcode, or row number
 * - Status chip: 'all' | 'no_barcode' | 'has_barcode'
 * - Category filter: 'all' or category name
 */
export function filterBarcodeTargets(
  targets: BarcodeTargetItem[],
  query: string,
  filterStatus: 'all' | 'no_barcode' | 'has_barcode',
  category: string
): BarcodeTargetItem[] {
  const q = (query || '').trim().toLowerCase();
  const cat = (category || '').trim().toLowerCase();

  return targets.filter((item) => {
    // 1. Status filter
    const hasBarcode = Boolean(item.barcode && item.barcode.trim());
    if (filterStatus === 'no_barcode' && hasBarcode) return false;
    if (filterStatus === 'has_barcode' && !hasBarcode) return false;

    // 2. Category filter
    if (cat && cat !== 'all') {
      const itemCat = (item.category || '').toLowerCase();
      if (itemCat !== cat) return false;
    }

    // 3. Search query matching
    if (!q) return true;

    const nameMatch = (item.name || '').toLowerCase().includes(q);
    const skuMatch = (item.sku || '').toLowerCase().includes(q);
    const bcMatch = (item.barcode || '').toLowerCase().includes(q);
    const rowMatch = item.rowNum !== undefined && String(item.rowNum) === q;

    return nameMatch || skuMatch || bcMatch || rowMatch;
  });
}

/**
 * Finds the next product in list order (after currentId, wrapping around) that does not have a barcode.
 * Returns null if all products already have a barcode.
 */
export function findNextTargetWithoutBarcode(
  targets: BarcodeTargetItem[],
  currentId: number | string | null
): BarcodeTargetItem | null {
  if (!targets || targets.length === 0) return null;

  const noBarcodeTargets = targets.filter((t) => !t.barcode || !t.barcode.trim());
  if (noBarcodeTargets.length === 0) return null;

  if (currentId === null || currentId === undefined) {
    return noBarcodeTargets[0];
  }

  const currentIndex = targets.findIndex((t) => t.id === currentId);
  if (currentIndex === -1) {
    return noBarcodeTargets[0];
  }

  // Look after current index
  for (let i = currentIndex + 1; i < targets.length; i++) {
    if (!targets[i].barcode || !targets[i].barcode!.trim()) {
      return targets[i];
    }
  }

  // Wrap around from beginning
  for (let i = 0; i <= currentIndex; i++) {
    if (!targets[i].barcode || !targets[i].barcode!.trim()) {
      return targets[i];
    }
  }

  return null;
}
