import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface HsnItem {
  code: string;
  desc: string;
  type: 'HSN' | 'SAC';
}

const COMMON_ALIASES: Record<string, string[]> = {
  laptop: ['84713010', '847130', '8471'],
  computer: ['84713010', '847141', '8471'],
  pc: ['84713010', '847141'],
  tablet: ['84713010', '847130'],
  mobile: ['85171219', '85171200', '8517'],
  phone: ['85171219', '85171200', '8517'],
  smartphone: ['85171219', '85171200'],
  paracetamol: ['30049099', '3004', '3003'],
  medicine: ['30049099', '3004', '3003', '3006'],
  tablet_med: ['30049099', '3004'],
  syrup: ['30049099', '3004'],
  capsule: ['30049099', '3004'],
  ointment: ['30049099', '3004'],
  rice: ['100630', '100610', '1006'],
  basmati: ['10063010', '100630', '1006'],
  wheat: ['100119', '100199', '1001'],
  atta: ['11010000', '1101'],
  flour: ['11010000', '1101'],
  sugar: ['170114', '170199', '1701'],
  tea: ['090240', '090230', '0902'],
  coffee: ['090121', '090111', '0901'],
  milk: ['040120', '040110', '0401', '0402'],
  curd: ['04031000', '0403'],
  ghee: ['040590', '0405'],
  butter: ['040510', '0405'],
  paneer: ['040610', '0406'],
  cheese: ['040690', '0406'],
  oil: ['151590', '151219', '1515'],
  salt: ['250100', '2501'],
  soap: ['340111', '340120', '3401'],
  shampoo: ['330510', '3305'],
  detergent: ['340220', '3402'],
  toothpaste: ['330610', '3306'],
  pen: ['960810', '9608'],
  pencil: ['960910', '9609'],
  notebook: ['482010', '4820'],
  book: ['490199', '490110', '4901'],
  paper: ['480255', '4802'],
  shirt: ['620520', '610510', '6205', '6105'],
  tshirt: ['610910', '6109'],
  saree: ['540752', '520852', '5407'],
  pant: ['620342', '6203'],
  shoe: ['640399', '640411', '6403', '6404'],
  chappal: ['640220', '6402'],
  cement: ['252329', '252310', '2523'],
  steel: ['721420', '7214', '7216'],
  iron: ['721420', '7214'],
  paint: ['320890', '320910', '3208'],
  software: ['998313', '998314', '9983'],
  consulting: ['998311', '9983'],
  it: ['998313', '998311', '9983'],
  transport: ['996511', '9965'],
  courier: ['996811', '9968'],
  freight: ['996511', '9965'],
  hotel: ['996311', '9963'],
  restaurant: ['996331', '9963'],
  catering: ['996337', '9963'],
  rent: ['997212', '9972'],
  repair: ['998716', '9987'],
  service: ['9983', '9987', '9954'],
};

let hsnCache: HsnItem[] = [];
let hsnMap = new Map<string, HsnItem>();
let initialized = false;

function loadHsnData() {
  if (initialized && hsnCache.length > 0) return;

  try {
    const dataPath = path.resolve('server/src/data/hsn_data.json');
    if (fs.existsSync(dataPath)) {
      const raw = fs.readFileSync(dataPath, 'utf-8');
      hsnCache = JSON.parse(raw);
      hsnMap.clear();
      for (const item of hsnCache) {
        hsnMap.set(item.code, item);
      }
      initialized = true;
      console.log(`[HsnService] Loaded ${hsnCache.length} HSN/SAC records into memory.`);
    } else {
      console.warn(`[HsnService] hsn_data.json not found at ${dataPath}. HSN search running in fallback mode.`);
    }
  } catch (err) {
    console.error('[HsnService] Failed to load hsn_data.json:', err);
  }
}

/**
 * Clean product name to extract searchable keywords
 * e.g. "Basmati Rice 1kg" -> "basmati rice"
 * "Paracetamol 650mg strip" -> "paracetamol strip"
 */
function extractSearchKeywords(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[0-9]+(\.[0-9]+)?\s*(kg|g|gm|mg|l|ltr|ml|m|cm|mm|pcs|nos|pack|strip|bottle|box)?/gi, '')
    .replace(/[^a-z0-9\s]/gi, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1);
}

/**
 * Intelligent search across 22,000+ HSN & SAC codes
 */
export function searchHsnSac(query: string, limit = 20): HsnItem[] {
  loadHsnData();
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const isNumeric = /^[0-9]+$/.test(q);
  const results: { item: HsnItem; score: number }[] = [];
  const seen = new Set<string>();

  // If numeric, prioritize direct code matching
  if (isNumeric) {
    for (const item of hsnCache) {
      if (item.code === q) {
        results.push({ item, score: 200 });
        seen.add(item.code);
      } else if (item.code.startsWith(q)) {
        results.push({ item, score: 100 - (item.code.length - q.length) * 5 });
        seen.add(item.code);
      }
    }
  }

  // Check alias dictionary
  const aliasCodes = COMMON_ALIASES[q] || [];
  for (const ac of aliasCodes) {
    const item = hsnMap.get(ac);
    if (item && !seen.has(item.code)) {
      results.push({ item, score: 150 });
      seen.add(item.code);
    }
  }

  // Keyword search in descriptions
  const words = q.split(/\s+/).filter((w) => w.length > 1);
  if (!isNumeric && words.length > 0) {
    // Also check aliases for individual words in the query
    for (const w of words) {
      const matchedAliases = COMMON_ALIASES[w];
      if (matchedAliases) {
        for (const ac of matchedAliases) {
          const item = hsnMap.get(ac);
          if (item && !seen.has(item.code)) {
            results.push({ item, score: 130 });
            seen.add(item.code);
          }
        }
      }
    }

    for (const item of hsnCache) {
      if (seen.has(item.code)) continue;
      const descLower = item.desc.toLowerCase();

      if (descLower === q) {
        results.push({ item, score: 120 });
        seen.add(item.code);
      } else if (descLower.startsWith(q)) {
        results.push({ item, score: 90 });
        seen.add(item.code);
      } else {
        let matchCount = 0;
        for (const w of words) {
          if (descLower.includes(w)) {
            matchCount++;
          }
        }
        if (matchCount > 0) {
          const allMatch = matchCount === words.length;
          const score = (allMatch ? 50 : 20) + matchCount * 10;
          results.push({ item, score });
          seen.add(item.code);
        }
      }
    }
  }

  results.sort((a, b) => b.score - a.score || a.item.code.localeCompare(b.item.code, undefined, { numeric: true }));
  return results.slice(0, limit).map((r) => r.item);
}

/**
 * Suggest HSN code based on product title/category when user is typing in Add Product form
 */
export function suggestHsnForProduct(productName: string, category?: string): HsnItem[] {
  loadHsnData();
  const nameKeywords = extractSearchKeywords(productName || '');
  if (nameKeywords.length === 0) {
    if (!category) return [];
    return searchHsnSac(category, 5);
  }

  // 1. Search full product name phrase
  const phraseSearch = searchHsnSac(nameKeywords.join(' '), 6);
  if (phraseSearch.length >= 4) return phraseSearch;

  const combined = [...phraseSearch];
  const seen = new Set(phraseSearch.map((s) => s.code));

  // 2. Search individual product name keywords
  for (const kw of nameKeywords) {
    const hits = searchHsnSac(kw, 5);
    for (const h of hits) {
      if (!seen.has(h.code)) {
        seen.add(h.code);
        combined.push(h);
      }
    }
    if (combined.length >= 6) break;
  }

  // 3. Only if very few matches, supplement with category
  if (combined.length < 3 && category) {
    const catKeywords = extractSearchKeywords(category);
    for (const ckw of catKeywords) {
      const catHits = searchHsnSac(ckw, 3);
      for (const ch of catHits) {
        if (!seen.has(ch.code)) {
          seen.add(ch.code);
          combined.push(ch);
        }
      }
      if (combined.length >= 6) break;
    }
  }

  return combined.slice(0, 6);
}
