/**
 * Bulk Import Helpers: SKU generation, Category suggestion, Product matching, Barcode generation.
 * Shared between client and server.
 */

// ── 1. Compact Short SKU Generation ──────────────────────────────────────────

/**
 * Extracts package size information from product name (e.g. "200 g" -> "200", "1 kg" -> "1KG", "190 ml" -> "190ML")
 */
export function extractPackSize(name: string): { raw: string; suffix: string } | null {
  if (!name) return null;

  // Match e.g. "4 x 125 g", "200 g", "200g", "200 gm", "1 kg", "1kg", "190 ml", "190ml", "1 l", "1.5 l", "10 pcs"
  const m = name.match(/\b(\d+(?:\s*[xX*]\s*\d+(?:\.\d+)?)?)\s*(kg|g|gm|gms|l|ltr|litre|litres|ml|pcs|pc|pack|box|m|meter)\b/i);
  if (!m) return null;

  const numPart = m[1].replace(/\s+/g, '').toUpperCase();
  const unit = m[2].toLowerCase();

  let uStr = '';
  if (['g', 'gm', 'gms'].includes(unit)) {
    // For grams, omit the unit suffix when numeric value is present (e.g. 200, 100, 250, 4X125)
    uStr = '';
  } else if (['kg'].includes(unit)) {
    uStr = 'KG';
  } else if (['ml'].includes(unit)) {
    uStr = 'ML';
  } else if (['l', 'ltr', 'litre', 'litres'].includes(unit)) {
    uStr = 'L';
  } else if (['pc', 'pcs', 'pack', 'box'].includes(unit)) {
    uStr = 'PC';
  } else if (['m', 'meter'].includes(unit)) {
    uStr = 'M';
  } else {
    uStr = unit.toUpperCase();
  }

  return {
    raw: m[0],
    suffix: `${numPart}${uStr}`,
  };
}

// Common marketing words and fillers to ignore when generating abbreviation initials
const FILLER_WORDS = new Set([
  'ORIGINAL', 'CLASSIC', 'REGULAR', 'SPECIAL', 'PREMIUM', 'PURE', 'FRESH',
  'STANDARD', 'SUPER', 'FLAVOUR', 'FLAVOR', 'NATURAL', 'NEW', 'BEST',
  'AND', 'THE', 'OF', 'IN', 'FOR', 'WITH', '&',
]);

/**
 * Clean product name into a compact, readable short SKU based on initials and package size:
 * - Britannia Good Day Cashew Cookies 200 g -> BGDCC-200
 * - Kellogg's Corn Flakes Original 250 g -> KCF-250
 * - Tata Sampann Toor Dal 1 kg -> TSTD-1KG
 * - Amul Butter 100 g -> AB-100
 * - Parachute Coconut Hair Oil 190 ml -> PCHO-190ML
 */
export function generateShortSku(name: string): string {
  if (!name || !name.trim()) return 'ITEM';

  const pack = extractPackSize(name);
  let baseName = name;
  if (pack) {
    baseName = name.replace(pack.raw, ' ');
  }

  // Clean punctuation and split into words
  const words = baseName
    .replace(/['’]s\b/gi, '') // remove possessives e.g. "Kellogg's" -> "Kellogg"
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);

  if (words.length === 0) {
    return pack ? `ITEM-${pack.suffix}` : 'ITEM';
  }

  let codePrefix = '';

  if (words.length === 1) {
    const singleWord = words[0].toUpperCase();
    if (singleWord.length <= 4) {
      codePrefix = singleWord;
    } else {
      codePrefix = singleWord.slice(0, 4);
    }
  } else {
    // Multi-word product: filter filler words if we have at least 2 other words
    const significantWords = words.filter((w) => !FILLER_WORDS.has(w.toUpperCase()));
    const effectiveWords = significantWords.length >= 2 ? significantWords : words;

    // Take initials of each effective word (up to 6 letters)
    const initials = effectiveWords.map((w) => {
      if (/^\d/.test(w)) {
        return w.slice(0, 2).toUpperCase();
      }
      return w[0].toUpperCase();
    });

    codePrefix = initials.join('').slice(0, 6);
  }

  if (pack && pack.suffix) {
    return `${codePrefix}-${pack.suffix}`;
  }
  return codePrefix;
}

/**
 * Generate a deterministic, compact, readable, and unique short SKU.
 * Checks collisions against existing database SKUs and rows in the current import.
 * If a generated SKU already exists, appends -2, -3, etc. (e.g. BGDCC-200-2).
 */
export function generateUniqueShortSku(
  name: string,
  existingSkus: Set<string>, // lowercased
  seenInImport: Set<string>  // lowercased
): string {
  const baseSku = generateShortSku(name);
  const lowerBase = baseSku.toLowerCase();

  if (!existingSkus.has(lowerBase) && !seenInImport.has(lowerBase)) {
    seenInImport.add(lowerBase);
    return baseSku;
  }

  // Collision detected -> append sequence suffix (-2, -3, ...)
  let seq = 2;
  while (seq <= 9999) {
    const candidate = `${baseSku}-${seq}`;
    const lowerCandidate = candidate.toLowerCase();
    if (!existingSkus.has(lowerCandidate) && !seenInImport.has(lowerCandidate)) {
      seenInImport.add(lowerCandidate);
      return candidate;
    }
    seq++;
  }

  // Fallback
  const fallback = `${baseSku}-${Date.now().toString().slice(-3)}`;
  seenInImport.add(fallback.toLowerCase());
  return fallback;
}

// Backwards compatibility alias
export const generateUniqueSku = generateUniqueShortSku;
export const generateBaseSkuPrefix = generateShortSku;

// ── 2. EAN-13 & Code 128 Barcode Generation & Rendering ────────────────────

/**
 * Computes standard EAN-13 check digit for a 12-digit string.
 */
export function computeEan13CheckDigit(twelveDigits: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(twelveDigits[i], 10);
    sum += i % 2 === 0 ? digit * 1 : digit * 3;
  }
  const rem = sum % 10;
  return rem === 0 ? 0 : 10 - rem;
}

/**
 * Validates whether a barcode string is a valid 13-digit EAN-13 code with correct check digit.
 */
export function isValidEan13(barcode: string): boolean {
  if (!barcode || typeof barcode !== 'string') return false;
  const clean = barcode.trim();
  if (!/^\d{13}$/.test(clean)) return false;
  const body = clean.slice(0, 12);
  const check = parseInt(clean[12], 10);
  return computeEan13CheckDigit(body) === check;
}

/**
 * Generates an internal 13-digit EAN-compatible barcode starting with '20' (GS1 in-store internal range).
 */
export function generateInternalBarcode(counter: number = 1): string {
  const body = `20${String(counter).padStart(10, '0')}`;
  const check = computeEan13CheckDigit(body);
  return `${body}${check}`;
}

/**
 * Generates a guaranteed-unique internal EAN-13 barcode starting with '20' (GS1 in-store internal range).
 * Checks against existing database barcodes and barcodes already assigned in the current import.
 * Numbers are sequential, preserve leading zeros, and never clash.
 */
export function generateUniqueInternalBarcode(
  existingBarcodes: Set<string> = new Set(),
  seenInImport: Set<string> = new Set(),
  seedCounter: number = 1
): string {
  const existing = existingBarcodes || new Set();
  const seen = seenInImport || new Set();

  // Find highest existing sequence number within 20... in-store range if present
  let maxSeq = 0;
  const scanCode = (code: string) => {
    if (typeof code === 'string' && code.startsWith('20') && code.length === 13) {
      const numPart = parseInt(code.slice(2, 12), 10);
      if (Number.isFinite(numPart) && numPart > maxSeq) {
        maxSeq = numPart;
      }
    }
  };

  for (const b of existing) scanCode(b);
  for (const b of seen) scanCode(b);

  const startSeq = Math.max(maxSeq + 1, seedCounter);

  for (let attempt = 0; attempt < 100000; attempt++) {
    const currentSeq = startSeq + attempt;
    const body = `20${String(currentSeq).padStart(10, '0')}`;
    const check = computeEan13CheckDigit(body);
    const candidate = `${body}${check}`;

    if (!existing.has(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      return candidate;
    }
  }

  // Fallback
  const fallbackBody = `20${String(Date.now()).slice(-10).padStart(10, '0')}`;
  const fallback = `${fallbackBody}${computeEan13CheckDigit(fallbackBody)}`;
  seen.add(fallback);
  return fallback;
}

// EAN-13 Bit Encoding Tables (L, G, R)
const EAN_L: string[] = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011'
];
const EAN_G: string[] = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111'
];
const EAN_R: string[] = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100'
];
const EAN_PARITY: string[] = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'
];

/**
 * Renders an EAN-13 barcode as a compact, scannable SVG image.
 */
export function renderEan13Svg(barcode: string, includeText: boolean = true): string {
  let code = barcode.trim();
  if (code.length === 12 && /^\d+$/.test(code)) {
    code += computeEan13CheckDigit(code);
  }
  if (code.length !== 13 || !/^\d+$/.test(code)) {
    return renderCode128Svg(code, includeText);
  }

  const d1 = parseInt(code[0], 10);
  const parity = EAN_PARITY[d1];

  let bitPattern = '';
  // Start guard
  bitPattern += '101';

  // Left 6 digits
  for (let i = 1; i <= 6; i++) {
    const digit = parseInt(code[i], 10);
    const p = parity[i - 1];
    bitPattern += p === 'L' ? EAN_L[digit] : EAN_G[digit];
  }

  // Center guard
  bitPattern += '01010';

  // Right 6 digits
  for (let i = 7; i <= 12; i++) {
    const digit = parseInt(code[i], 10);
    bitPattern += EAN_R[digit];
  }

  // End guard
  bitPattern += '101';

  const quietLeft = 8;
  const barWidth = 1;
  const guardHeight = includeText ? 22 : 24;
  const digitHeight = includeText ? 18 : 24;
  const svgWidth = 112;
  const svgHeight = includeText ? 28 : 24;

  let rects = '';
  for (let i = 0; i < bitPattern.length; i++) {
    if (bitPattern[i] === '1') {
      const isGuard = i < 3 || (i >= 45 && i < 50) || i >= 92;
      const height = isGuard ? guardHeight : digitHeight;
      const x = quietLeft + i * barWidth;
      rects += `<rect x="${x}" y="0" width="${barWidth}" height="${height}" fill="#000000" />`;
    }
  }

  const textY = 26;
  const textElems = includeText
    ? `<text x="2" y="${textY}" font-family="monospace" font-size="7.5" font-weight="600" fill="#000000">${code[0]}</text><text x="13" y="${textY}" font-family="monospace" font-size="7.5" font-weight="600" letter-spacing="1.2" fill="#000000">${code.slice(1, 7)}</text><text x="58" y="${textY}" font-family="monospace" font-size="7.5" font-weight="600" letter-spacing="1.2" fill="#000000">${code.slice(7, 13)}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}" style="display:block;">${rects}${textElems}</svg>`;
}

// Code 128 Patterns (B-S-B-S-B-S widths) for ASCII printable chars
const C128_PATTERNS: number[] = [
  0x6cc, 0x66c, 0x666, 0x498, 0x48c, 0x44c, 0x4c8, 0x4c4, 0x464, 0x648,
  0x644, 0x624, 0x59c, 0x4dc, 0x4ce, 0x5dc, 0x4ae, 0x47a, 0x6ac, 0x6d4,
  0x764, 0x6f4, 0x6da, 0x756, 0x6ae, 0x6ee, 0x776, 0x5b6, 0x5da, 0x5ee,
  0x73c, 0x79c, 0x7ce, 0x52c, 0x54c, 0x54e, 0x45c, 0x45e, 0x534, 0x4b4,
  0x4b6, 0x49e, 0x634, 0x654, 0x656, 0x696, 0x734, 0x754, 0x756, 0x6b6,
  0x6da, 0x6de, 0x7b6, 0x7da, 0x7de, 0x774, 0x776, 0x76e, 0x7ae, 0x7ee,
  0x7f4, 0x7f6, 0x7fa, 0x67c, 0x67e, 0x6bc, 0x6be, 0x6d8, 0x6e8, 0x768,
  0x76a, 0x7a8, 0x7aa, 0x7ea, 0x7ee, 0x7fa, 0x7b4, 0x7b6, 0x7ba, 0x7dc,
  0x7de, 0x7ea, 0x7ec, 0x7fa, 0x7dc, 0x7ee, 0x7fa, 0x778, 0x77a, 0x798,
  0x79a, 0x7ac, 0x7ae, 0x7b4, 0x7b8, 0x7ba, 0x7c8, 0x7ca, 0x7cc, 0x7ce,
  0x7d0, 0x7d4, 0x7d8, 0x7dc, 0x718, 0x728, 0x738
];

/**
 * Fallback renderer for arbitrary non-EAN barcodes using Code 128 format.
 */
export function renderCode128Svg(text: string, includeText: boolean = true): string {
  const clean = text.trim() || 'BARCODE';
  const display = clean.length > 16 ? clean.slice(0, 16) : clean;
  const svgWidth = Math.max(90, display.length * 9 + 30);
  const svgHeight = includeText ? 28 : 24;

  let pattern = '11010010000'; // Start Code B
  for (let i = 0; i < display.length; i++) {
    const code = display.charCodeAt(i) - 32;
    const pat = C128_PATTERNS[code >= 0 && code < C128_PATTERNS.length ? code : 0];
    pattern += pat.toString(2).padStart(11, '0');
  }
  pattern += '1100011101011'; // Stop

  const quiet = 6;
  const barWidth = 1;
  const barHeight = includeText ? 18 : 24;
  let rects = '';
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '1') {
      rects += `<rect x="${quiet + i * barWidth}" y="0" width="${barWidth}" height="${barHeight}" fill="#000000" />`;
    }
  }

  const textX = Math.round(svgWidth / 2);
  const textElem = includeText
    ? `<text x="${textX}" y="26" font-family="monospace" font-size="7.5" font-weight="600" text-anchor="middle" fill="#000000">${display}</text>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}" style="display:block;">${rects}${textElem}</svg>`;
}

/**
 * Automatically chooses EAN-13 or Code 128 based on barcode content and returns SVG string.
 */
export function renderBarcodeSvg(barcode: string, includeText: boolean = true): string {
  if (!barcode || !barcode.trim()) return '';
  const clean = barcode.trim();
  if (/^\d{12,13}$/.test(clean)) {
    return renderEan13Svg(clean, includeText);
  }
  return renderCode128Svg(clean, includeText);
}

// ── 3. Dynamic Category Suggestion ───────────────────────────────────────────

export interface CategoryConcept {
  id: string;
  keywords: string[];
  targetCategoryPatterns: string[];
}

export const CATEGORY_CONCEPTS: CategoryConcept[] = [
  {
    id: 'hair_care',
    keywords: ['coconut hair oil', 'hair oil', 'hair serum', 'hair cream', 'shampoo', 'conditioner', 'parachute', 'clinic plus', 'head & shoulders', 'pantene', 'vatika', 'bajaj almond', 'hair'],
    targetCategoryPatterns: ['hair care', 'hair', 'personal care', 'beauty & personal care', 'toiletries'],
  },
  {
    id: 'biscuits_cookies',
    keywords: ['cashew cookies', 'good day', 'biscuit', 'biscuits', 'cookie', 'cookies', 'rusk', 'wafer', 'wafers', 'cracker', 'crackers', 'oreo', 'bourbon', 'marie', 'digestive', 'parle g', 'britannia'],
    targetCategoryPatterns: ['biscuits & cookies', 'biscuits', 'cookies', 'bakery & biscuits', 'snacks', 'bakery', 'packaged foods'],
  },
  {
    id: 'breakfast_cereals',
    keywords: ['corn flakes', 'flakes', 'cereal', 'cereals', 'oats', 'muesli', 'granola', 'kellogg', 'chocos', 'breakfast'],
    targetCategoryPatterns: ['breakfast & cereals', 'breakfast', 'cereals', 'cereal', 'packaged foods', 'staples', 'grocery'],
  },
  {
    id: 'pulses',
    keywords: ['toor dal', 'moong dal', 'chana dal', 'urad dal', 'masoor dal', 'dal', 'toor', 'moong', 'chana', 'urad', 'masoor', 'rajma', 'lentil', 'lentils', 'pulse', 'pulses', 'chickpea', 'gram', 'tata sampann toor dal'],
    targetCategoryPatterns: ['pulses', 'dals & pulses', 'dal', 'grocery', 'staples'],
  },
  {
    id: 'dairy',
    keywords: ['butter', 'cheese', 'milk', 'paneer', 'curd', 'yogurt', 'ghee', 'cream', 'chaas', 'lassi', 'amul butter', 'amul cheese', 'amul milk', 'amul', 'dairy'],
    targetCategoryPatterns: ['dairy products', 'dairy', 'milk & dairy', 'chilled', 'grocery'],
  },
  {
    id: 'personal_care',
    keywords: ['soap', 'body wash', 'bodywash', 'face wash', 'facewash', 'toothpaste', 'paste', 'toothbrush', 'brush', 'lotion', 'body lotion', 'deodorant', 'deo', 'dettol', 'colgate', 'dove', 'lifebuoy', 'lux', 'ponds', 'nivea', 'vaseline', 'shaving'],
    targetCategoryPatterns: ['personal care', 'beauty & personal care', 'toiletries', 'bath & body'],
  },
  {
    id: 'household',
    keywords: ['detergent', 'washing powder', 'surf excel', 'ariel', 'tide', 'rin', 'wheel', 'vim', 'dishwash', 'harpic', 'toilet cleaner', 'floor cleaner', 'lysol', 'colin', 'cleaner', 'mop', 'sponge', 'scrub', 'mosquito', 'repellent', 'odonil'],
    targetCategoryPatterns: ['household', 'home care', 'cleaning', 'household & cleaning'],
  },
  {
    id: 'edible_oils',
    keywords: [
      'mustard oil', 'sunflower oil', 'groundnut oil', 'sesame oil', 'refined oil',
      'cooking oil', 'rice bran oil', 'olive oil', 'saffola', 'fortune oil',
      'gemini oil', 'dhara oil', 'edible oil', 'canola oil', 'vegetable oil', 'soyabean oil',
    ],
    targetCategoryPatterns: ['edible oils', 'cooking oils', 'oils', 'grocery'],
  },
  {
    id: 'spices',
    keywords: ['masala', 'chili powder', 'chilli powder', 'turmeric', 'haldi', 'cumin', 'jeera', 'coriander powder', 'dhania', 'pepper', 'black pepper', 'cardamom', 'elaichi', 'clove', 'garam masala', 'sambhar masala', 'everest', 'mdh', 'catch', 'spice', 'spices'],
    targetCategoryPatterns: ['spices', 'masalas', 'spices & masalas', 'grocery'],
  },
  {
    id: 'staples_flours',
    keywords: ['atta', 'wheat', 'flour', 'maida', 'sooji', 'rava', 'besan', 'sugar', 'salt', 'jaggery', 'aashirvaad', 'pillsbury', 'fortune atta', 'tata salt'],
    targetCategoryPatterns: ['staples', 'flours', 'grains & staples', 'grocery'],
  },
  {
    id: 'rice',
    keywords: ['basmati rice', 'basmati', 'sona masoori', 'kolam', 'raw rice', 'boiled rice', 'poha', 'biryani rice', 'daawat', 'india gate', 'rice'],
    targetCategoryPatterns: ['rice', 'grains & rice', 'staples', 'grocery'],
  },
  {
    id: 'beverages',
    keywords: ['tea', 'chai', 'coffee', 'juice', 'cola', 'soda', 'syrup', 'drink', 'beverage', 'water', 'frooti', 'pepsi', 'coke', 'maaza', 'tata tea', 'taj mahal', 'red label', 'nescafe', 'bru', 'horlicks', 'boost', 'bournvita'],
    targetCategoryPatterns: ['beverages', 'tea & coffee', 'drinks', 'juices'],
  },
  {
    id: 'snacks',
    keywords: ['chips', 'namkeen', 'bhujia', 'mixture', 'popcorn', 'lays', 'kurkure', 'haldiram', 'bikaji', 'bingo', 'snack', 'snacks'],
    targetCategoryPatterns: ['snacks', 'namkeen', 'packaged foods'],
  },
  {
    id: 'jams_spreads',
    keywords: [
      'jam',
      'jams',
      'spread',
      'spreads',
      'marmalade',
      'peanut butter',
      'honey',
      'mayonnaise',
      'ketchup',
      'sauce',
      'sauces',
      'kissan',
      'nutella',
      'hershey',
    ],
    targetCategoryPatterns: [
      'jams & spreads',
      'jams and spreads',
      'jams',
      'spreads',
      'sauces & spreads',
      'packaged foods',
      'grocery',
    ],
  },
  {
    id: 'chocolates',
    keywords: ['chocolate', 'candy', 'toffee', 'gum', 'cadbury', 'dairy milk', 'kitkat', '5 star', 'snickers', 'gems'],
    targetCategoryPatterns: ['chocolates & confectionery', 'chocolates', 'sweets', 'confectionery', 'snacks'],
  },
  {
    id: 'pet_care',
    keywords: ['pedigree', 'whiskas', 'dog food', 'cat food', 'pet food', 'dog', 'cat', 'puppy', 'kitten', 'pet'],
    targetCategoryPatterns: ['pet care & accessories', 'pet care', 'pet supplies', 'pets', 'pet food'],
  },
  {
    id: 'frozen_foods',
    keywords: ['frozen peas', 'frozen corn', 'frozen', 'mccain', 'french fries', 'nuggets', 'ice cream', 'ice-cream'],
    targetCategoryPatterns: ['frozen foods', 'frozen', 'ice creams & desserts'],
  },
  {
    id: 'bakery_breads',
    keywords: ['bread', 'pav', 'bun', 'cake', 'pastry', 'muffin', 'croissant', 'bake'],
    targetCategoryPatterns: ['bakery & breads', 'bakery', 'breads & bakery', 'packaged foods'],
  },
];

const CATEGORY_STOP_WORDS = new Set([
  '&', 'and', 'or', 'the', 'of', 'for', 'in', 'with', 'to', 'a', 'an',
  'item', 'items', 'product', 'products', 'good', 'goods', 'all', 'etc',
  'food', 'foods', 'other', 'general', 'various', 'misc', 'miscellaneous',
]);

/**
 * Generates singular and plural stems for a word (e.g., 'jams' -> ['jams', 'jam'], 'cereal' -> ['cereal', 'cereals']).
 */
function getWordStems(word: string): string[] {
  const w = word.toLowerCase().trim();
  if (w.length < 3) return [w];
  const stems = new Set<string>([w]);

  if (w.endsWith('ies') && w.length > 4) {
    stems.add(w.slice(0, -3) + 'y');
  } else if (
    w.endsWith('es') &&
    w.length > 4 &&
    (w.endsWith('shes') || w.endsWith('ches') || w.endsWith('xes') || w.endsWith('ses'))
  ) {
    stems.add(w.slice(0, -2));
  } else if (w.endsWith('s') && w.length > 3 && !w.endsWith('ss') && !w.endsWith('us')) {
    stems.add(w.slice(0, -1));
  } else {
    stems.add(w + 's');
  }

  return [...stems];
}

/**
 * Suggests an existing store category based on the product name and active categories in the database.
 * Dynamic: matches any database category by token & stem analysis without hardcoded IDs or required fixed names.
 * Accurate: uses domain concepts and priority scoring to disambiguate (e.g. hair oil -> personal care).
 * Safe: returns null if the match is ambiguous or confident match is not found.
 */
export function suggestCategory(
  productName: string,
  storeCategories: { id: string; name: string }[]
): { id: string; name: string } | null {
  if (!productName || !productName.trim() || !storeCategories || storeCategories.length === 0) {
    return null;
  }

  const cleanName = productName.toLowerCase().trim();

  // Score each active store category
  const scoredCategories = storeCategories.map((cat) => {
    let score = 0;
    const catNameLower = cat.name.toLowerCase().trim();

    // 1. Exact full category name match (highest dynamic priority)
    if (catNameLower.length >= 3) {
      const fullBoundary = new RegExp(`(^|\\b)${catNameLower.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(\\b|$)`, 'i');
      if (fullBoundary.test(cleanName)) {
        score += 1000 + catNameLower.length * 10;
      }
    }

    // 2. Token & Stem matching for dynamic multi-word categories (e.g., "Jams & Spreads", "Organic Honey")
    const tokens = catNameLower
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !CATEGORY_STOP_WORDS.has(t));

    for (const token of tokens) {
      const stems = getWordStems(token);
      for (const stem of stems) {
        if (stem.length >= 3 && !CATEGORY_STOP_WORDS.has(stem)) {
          const stemRegex = new RegExp(`(^|\\b)${stem.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(\\b|$)`, 'i');
          if (stemRegex.test(cleanName)) {
            // Give significant points for each matching category token stem
            score += 150 + stem.length * 5;
            break; // Count each category token only once
          }
        }
      }
    }

    // 3. Concept matching from domain knowledge (boosts categories when product contains specific brands/ingredients)
    for (const concept of CATEGORY_CONCEPTS) {
      const matchedKeyword = concept.keywords.find((kw) => {
        const kwRegex = new RegExp(`(^|\\b)${kw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(\\b|$)`, 'i');
        return kwRegex.test(cleanName);
      });

      if (matchedKeyword) {
        const patternIdx = concept.targetCategoryPatterns.findIndex((p) => {
          if (catNameLower === p) return true;
          if (catNameLower.includes(p)) return true;
          const pTokens = p.split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !CATEGORY_STOP_WORDS.has(t));
          return pTokens.some((pt) => tokens.includes(pt));
        });

        if (patternIdx !== -1) {
          // Earlier patterns in the concept list are higher priority
          score += Math.max(80, 400 - patternIdx * 40);
        }
      }
    }

    return { cat, score };
  });

  // Filter out non-matching categories
  const positiveMatches = scoredCategories
    .filter((sc) => sc.score > 0)
    .sort((a, b) => b.score - a.score);

  if (positiveMatches.length === 0) {
    return null;
  }

  const topMatch = positiveMatches[0];

  // Disambiguation: if there is another category with the exact same top score, match is ambiguous
  if (positiveMatches.length > 1) {
    const runnerUp = positiveMatches[1];
    if (runnerUp.score === topMatch.score) {
      // Ambiguous match — user must select manually
      return null;
    }
  }

  // Minimum confidence threshold
  if (topMatch.score < 100) {
    return null;
  }

  return topMatch.cat;
}

// ── 3B. Automatic Product Classification (Branded vs Shop Product) ─────────────

export type ProductNature = 'BRANDED' | 'SHOP_PRODUCT';
export type NatureConfidence = 'HIGH' | 'LOW';

export interface ProductNatureResult {
  nature: ProductNature;
  confidence: NatureConfidence;
  brandName?: string;
  reason: string;
}

export const KNOWN_FMCG_BRANDS = [
  'dove', 'britannia', 'tata', 'kissan', 'parle', 'amul', 'surf excel', 'lifebuoy',
  'colgate', 'dettol', 'maggi', 'nescafe', 'cadbury', 'kellogg', "kellogg's", 'fortune',
  'parachute', 'aashirvaad', 'sunfeast', 'haldiram', 'bikaji', 'everest', 'mdh', 'catch',
  'saffola', 'vim', 'harpic', 'lizol', 'nivea', 'himalaya', 'dabur', 'vaseline', "pond's",
  'ponds', 'lipton', 'taj mahal', 'red label', 'bru', 'horlicks', 'bournvita', 'lays',
  'kurkure', 'bingo', 'good day', 'marie gold', 'oreo', 'bourbon', 'dairy milk', 'kitkat',
  'head & shoulders', 'pantene', 'clinic plus', 'sunsilk', 'lux', 'pears', 'medimix',
  'cinthol', 'gillette', 'whisper', 'stayfree', 'pampers', 'huggies', 'wheel', 'tide',
  'rin', 'ariel', 'comfort', 'pepsi', 'coca cola', 'coke', 'thums up', 'sprite', 'fanta',
  'mirinda', 'maaza', 'frooti', 'slice', 'real', 'tropicana', 'paper boat', 'red bull',
  'sting', 'doritos', 'pringles', 'balaji', 'act ii', 'dark fantasy', 'hide & seek',
  'monaco', 'krackjack', '50-50', 'milk bikis', 'tiger', 'treat', 'jim jam', 'nutrichoice',
  'little hearts', 'parle-g', 'munch', 'perk', '5 star', 'snickers', 'milkybar', 'mentos',
  'center fresh', 'center fruit', 'happydent', 'orbit', 'alpenliebe', 'polo', 'pulse',
  'hajmola', 'eno', 'pudin hara', 'vicks', 'strepsils', 'moov', 'volini', 'iodex',
  'amrutanjan', 'zandu', 'boroline', 'fair & lovely', 'glow & lovely', 'mysore sandal',
  'santoor', 'godrej no.1', 'fiama', 'vivel', 'savlon', 'pril', 'exo', 'scotch-brite',
  'odonil', 'godrej aer', 'all out', 'good knight', 'hit', 'mortein', 'baygon', 'genteel',
  'ezee', 'ujala', 'vanish', 'domex', 'colin', 'closeup', 'sensodyne', 'oral-b', 'pepsodent',
  'meswak', 'vicco', 'garnier', 'loreal', "l'oreal", 'clean & clear', 'neutrogena',
  'nivea men', 'beardo', 'ustraa', 'old spice', 'axe', 'park avenue', 'wild stone', 'fogg',
  'engage', 'denver', 'set wet', 'brylcreem', 'complan', 'tang', 'rasna', 'rooh afza',
  'chupa chups', 'halls', 'betadine', 'band-aid', 'hansaplast', 'sofy', 'carefree',
  'sebamed', "johnson's", 'himalaya baby', 'doff', 'liril', 'hamam', 'margo', 'chandrika',
  'rexona', 'breeze', 'henko', 'mr. white', 'ghari', 'sanifresh',
];

export const SHOP_PRODUCT_KEYWORDS = [
  'loose', 'loose ', 'unbranded', 'shop-packed', 'shop packed', 'store-packed', 'store packed',
  'in-house', 'homemade', 'home made', 'homemade snacks', 'raw', 'packed by store',
  'self packed', 'local pack', 'loose grain', 'loose grains', 'loose pulses', 'loose rice',
  'loose dal', 'loose sugar', 'open rice', 'open dal', 'chakki fresh', 'chakki',
];

export const GENERIC_COMMODITIES = [
  'toor dal', 'moong dal', 'urad dal', 'chana dal', 'masoor dal', 'arhar dal',
  'basmati rice', 'sona masoori', 'ponni rice', 'raw rice', 'boiled rice', 'jeera rice', 'brown rice',
  'kabuli chana', 'kala chana', 'rajma', 'green gram', 'black gram', 'horse gram', 'lobia',
  'mustard seeds', 'cumin seeds', 'jeera', 'fennel seeds', 'saunf', 'fenugreek', 'methi seeds',
  'coriander seeds', 'dhania', 'black pepper', 'cloves', 'laung', 'cardamom', 'elaichi',
  'cinnamon', 'dalchini', 'bay leaf', 'tejpatta', 'nutmeg', 'star anise',
  'turmeric powder', 'chilli powder', 'coriander powder', 'garam masala',
  'poha', 'aval', 'flattened rice', 'sooji', 'rava', 'semolina', 'besan', 'gram flour',
  'wheat flour', 'atta', 'maida', 'rice flour', 'ragi flour',
  'sugar', 'crystal sugar', 'brown sugar', 'jaggery', 'gur', 'palm jaggery',
  'groundnut', 'peanuts', 'raw peanuts', 'roasted gram', 'fried gram', 'pottukadalai',
  'dry red chilli', 'red chilli', 'tamarind', 'imli',
  'homemade snacks', 'khakhra', 'murukku', 'chakli', 'banana chips',
  'mixture', 'kara boondi', 'ribbon pakoda', 'seedai', 'thattai', 'sev',
];

/**
 * Automatically classifies a product as 'BRANDED' or 'SHOP_PRODUCT'.
 * - Suggests classification based on brand dictionary, shop/loose keywords, generic commodities, and catalog items.
 * - Returns confidence: 'HIGH' for clear brands/explicit keywords, or 'LOW' for heuristic defaults.
 * - Always treated as a suggestion with user override capability.
 */
export function classifyProductNature(
  productName: string,
  catalogCandidates?: { name: string; barcode?: string | null }[]
): ProductNatureResult {
  if (!productName || !productName.trim()) {
    return { nature: 'SHOP_PRODUCT', confidence: 'LOW', reason: 'Empty product name' };
  }

  const cleanName = productName.toLowerCase().trim();
  const words = cleanName.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

  // 1. Explicit shop product / loose / homemade keywords
  for (const kw of SHOP_PRODUCT_KEYWORDS) {
    if (cleanName.includes(kw) || words.includes(kw)) {
      return {
        nature: 'SHOP_PRODUCT',
        confidence: 'HIGH',
        reason: `Matches shop/loose keyword "${kw}"`,
      };
    }
  }

  // 2. Exact or substring match against known FMCG brands
  for (const brand of KNOWN_FMCG_BRANDS) {
    // Check if brand is at start of name or matches as a distinct word/phrase
    const brandRegex = new RegExp(`(^|\\b)${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|$)`, 'i');
    if (brandRegex.test(cleanName)) {
      const capBrand = brand.charAt(0).toUpperCase() + brand.slice(1);
      return {
        nature: 'BRANDED',
        confidence: 'HIGH',
        brandName: capBrand,
        reason: `Identified FMCG brand "${capBrand}"`,
      };
    }
  }

  // 3. Check existing catalog candidates (if catalog items with manufacturer barcodes share brand or name)
  if (catalogCandidates && catalogCandidates.length > 0) {
    for (const cand of catalogCandidates) {
      if (cand.barcode && !cand.barcode.startsWith('20') && cand.barcode.length >= 8) {
        // Candidate has a manufacturer barcode
        const candNorm = cand.name.toLowerCase();
        // If shares the first word (likely brand)
        const candFirstWord = candNorm.split(/\s+/)[0];
        if (candFirstWord && candFirstWord.length >= 3 && words[0] === candFirstWord) {
          const capBrand = candFirstWord.charAt(0).toUpperCase() + candFirstWord.slice(1);
          return {
            nature: 'BRANDED',
            confidence: 'HIGH',
            brandName: capBrand,
            reason: `Matches brand "${capBrand}" from catalog with manufacturer barcode`,
          };
        }
      }
    }
  }

  // 4. Generic grocery commodities without an FMCG brand (pulses, grains, loose spices)
  for (const commodity of GENERIC_COMMODITIES) {
    if (cleanName.includes(commodity)) {
      return {
        nature: 'SHOP_PRODUCT',
        confidence: 'LOW',
        reason: `Generic commodity "${commodity}" (suggested shop product)`,
      };
    }
  }

  // 5. Package format heuristic: bulk units (kg, g with loose/grain terms) vs unit/retail pieces
  if (/\b(kg|litre|ltr|litres)\b/i.test(cleanName) && !/\b(soap|shampoo|cream|lotion|biscuit|perfume|wash|detergent)\b/i.test(cleanName)) {
    return {
      nature: 'SHOP_PRODUCT',
      confidence: 'LOW',
      reason: 'Bulk measure without detected FMCG brand',
    };
  }

  // 6. Default fallback: treat as branded packaged product with LOW confidence
  return {
    nature: 'BRANDED',
    confidence: 'LOW',
    reason: 'Packaged product format (suggested branded)',
  };
}

// ── 4. Product Normalization & Matching ──────────────────────────────────────

/**
 * Normalizes a product name for comparison:
 * Trims, lowercases, collapses whitespace, and standardizes package size spacing.
 */
export function normalizeProductName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    // Standardize "1 kg" -> "1kg", "500 gm" -> "500g", etc.
    .replace(/(\d+)\s+(kg|g|gm|gms|l|ltr|litre|litres|ml|pcs|pc|m|meter)\b/gi, '$1$2')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strips package size to get base product name: "Basmati Rice 1kg" -> "basmati rice"
 */
export function stripPackageSize(name: string): string {
  return normalizeProductName(name)
    .replace(/\b(\d+(?:\s*[xX*]\s*\d+(?:\.\d+)?)?)\s*(kg|g|gm|gms|l|ltr|litre|litres|ml|pcs|pc|pack|box|m|meter)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface MatchCandidate {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  unit: string;
  priceMinor: number;
  costMinor: number;
  currentStockMilli: number;
  taxRateBp: number;
  taxInclusive: boolean;
  hsn: string | null;
  packSize?: string | null;
  matchReason?: string;
}

export type ProductClassification =
  | 'NEW_PRODUCT'
  | 'RESTOCK'
  | 'AMBIGUOUS'
  | 'DUPLICATE_IN_FILE'
  | 'VALIDATION_ERROR';

export interface ProductMatchResult {
  classification: ProductClassification;
  matchedItem: MatchCandidate | null;
  candidates: MatchCandidate[];
}

/**
 * Classifies an incoming row against the existing store catalog:
 * - RESTOCK: exactly one confident match found.
 * - AMBIGUOUS: multiple close matches or variants found (requires user selection).
 * - NEW_PRODUCT: no match found.
 *
 * Adheres to:
 * 1. Compare reliable identifiers first (Barcode, SKU).
 * 2. Exact match on normalized brand/product name, package size, and UOM.
 * 3. Does not treat loose substring containment as proof that products are identical.
 * 4. Identifies different pack sizes as potential catalog variants, annotated with detailed match reasons.
 */
export function matchProductToCatalog(
  incomingName: string,
  incomingUnit: string,
  catalog: MatchCandidate[],
  options?: { barcode?: string | null; sku?: string | null }
): ProductMatchResult {
  if (!incomingName || !incomingName.trim()) {
    return { classification: 'NEW_PRODUCT', matchedItem: null, candidates: [] };
  }

  const inBarcode = options?.barcode?.trim();
  const inSku = options?.sku?.trim();

  // 1. Reliable Identifier: Barcode match (if provided in file/row)
  if (inBarcode) {
    const bcMatches = catalog.filter((item) => item.barcode && item.barcode.trim() === inBarcode);
    if (bcMatches.length === 1) {
      const cand = {
        ...bcMatches[0],
        packSize: extractPackSize(bcMatches[0].name)?.raw || bcMatches[0].unit,
        matchReason: `Exact barcode match (${inBarcode}) with catalog item "${bcMatches[0].name}"`,
      };
      return { classification: 'RESTOCK', matchedItem: cand, candidates: [cand] };
    }
    if (bcMatches.length > 1) {
      const cands = bcMatches.map((item) => ({
        ...item,
        packSize: extractPackSize(item.name)?.raw || item.unit,
        matchReason: `Barcode ${inBarcode} maps to multiple items in catalog`,
      }));
      return { classification: 'AMBIGUOUS', matchedItem: null, candidates: cands };
    }
  }

  // 2. Reliable Identifier: SKU match (if provided in file/row)
  if (inSku) {
    const skuMatches = catalog.filter((item) => item.sku && item.sku.trim().toLowerCase() === inSku.toLowerCase());
    if (skuMatches.length === 1) {
      const cand = {
        ...skuMatches[0],
        packSize: extractPackSize(skuMatches[0].name)?.raw || skuMatches[0].unit,
        matchReason: `Exact SKU match (${inSku}) with catalog item "${skuMatches[0].name}"`,
      };
      return { classification: 'RESTOCK', matchedItem: cand, candidates: [cand] };
    }
    if (skuMatches.length > 1) {
      const cands = skuMatches.map((item) => ({
        ...item,
        packSize: extractPackSize(item.name)?.raw || item.unit,
        matchReason: `SKU ${inSku} maps to multiple items in catalog`,
      }));
      return { classification: 'AMBIGUOUS', matchedItem: null, candidates: cands };
    }
  }

  const normIncoming = normalizeProductName(incomingName);
  const normUnit = (incomingUnit || 'pcs').toLowerCase().trim();
  const baseIncoming = stripPackageSize(incomingName);
  const inPack = extractPackSize(incomingName);

  // 3. Exact match on normalized full name AND unit
  const exactUnitMatches = catalog.filter(
    (item) => normalizeProductName(item.name) === normIncoming && item.unit.toLowerCase().trim() === normUnit
  );
  if (exactUnitMatches.length === 1) {
    const cand = {
      ...exactUnitMatches[0],
      packSize: extractPackSize(exactUnitMatches[0].name)?.raw || exactUnitMatches[0].unit,
      matchReason: 'Exact product name and UOM match',
    };
    return { classification: 'RESTOCK', matchedItem: cand, candidates: [cand] };
  }
  if (exactUnitMatches.length > 1) {
    const cands = exactUnitMatches.map((item) => ({
      ...item,
      packSize: extractPackSize(item.name)?.raw || item.unit,
      matchReason: `Multiple catalog items have identical name "${item.name}" (SKU: ${item.sku || 'None'})`,
    }));
    return { classification: 'AMBIGUOUS', matchedItem: null, candidates: cands };
  }

  // 4. Exact match on normalized full name (different unit)
  const exactNameMatches = catalog.filter(
    (item) => normalizeProductName(item.name) === normIncoming
  );
  if (exactNameMatches.length === 1) {
    const cand = {
      ...exactNameMatches[0],
      packSize: extractPackSize(exactNameMatches[0].name)?.raw || exactNameMatches[0].unit,
      matchReason: `Exact product name match with catalog item (UOM: ${exactNameMatches[0].unit} vs ${incomingUnit})`,
    };
    return { classification: 'RESTOCK', matchedItem: cand, candidates: [cand] };
  }
  if (exactNameMatches.length > 1) {
    const cands = exactNameMatches.map((item) => ({
      ...item,
      packSize: extractPackSize(item.name)?.raw || item.unit,
      matchReason: `Multiple catalog items match name "${item.name}"`,
    }));
    return { classification: 'AMBIGUOUS', matchedItem: null, candidates: cands };
  }

  // 5. Same base product line (same brand & item name, but different pack sizes/variants)
  // Requirement 5: Do not treat similar product names alone as proof that products are identical.
  // Requirement 7: Treat different pack sizes or materially different variants as separate products unless user explicitly chooses otherwise.
  if (baseIncoming.length >= 3) {
    const variantMatches = catalog.filter((item) => {
      const itemBase = stripPackageSize(item.name);
      return itemBase === baseIncoming;
    });

    if (variantMatches.length > 0) {
      const cands = variantMatches.map((item) => {
        const cPack = extractPackSize(item.name);
        const packDesc = cPack?.raw || item.unit;
        const inPackDesc = inPack?.raw || incomingUnit;
        return {
          ...item,
          packSize: packDesc,
          matchReason: `Same product line ('${item.name}'), different pack size (${packDesc} vs ${inPackDesc})`,
        };
      });
      return { classification: 'AMBIGUOUS', matchedItem: null, candidates: cands };
    }
  }

  return { classification: 'NEW_PRODUCT', matchedItem: null, candidates: [] };
}
