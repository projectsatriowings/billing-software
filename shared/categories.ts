import type { Category } from './types.ts';

export interface CategoryImportRow {
  name: string;
  parentCategory?: string | null;
  description?: string | null;
  status?: string | null;
}

export interface CategoryImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{
    row: number;
    name?: string;
    error: string;
  }>;
}

/** RFC-4180 compliant CSV parser (handles commas in quotes, escaped quotes, multi-line values, CRLF/LF) */
export function parseCsv(text: string): string[][] {
  if (!text) return [];
  const clean = text.replace(/^\uFEFF/, ''); // strip UTF-8 BOM if present
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let insideQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const nextChar = clean[i + 1];

    if (insideQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentCell += '"';
          i++; // skip escaped quote
        } else {
          insideQuotes = false;
        }
      } else {
        currentCell += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentCell.trim());
        currentCell = '';
      } else if (char === '\r') {
        if (nextChar === '\n') i++;
        currentRow.push(currentCell.trim());
        currentCell = '';
        if (currentRow.some((c) => c !== '')) rows.push(currentRow);
        currentRow = [];
      } else if (char === '\n') {
        currentRow.push(currentCell.trim());
        currentCell = '';
        if (currentRow.some((c) => c !== '')) rows.push(currentRow);
        currentRow = [];
      } else {
        currentCell += char;
      }
    }
  }

  if (currentCell || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((c) => c !== '')) rows.push(currentRow);
  }

  return rows;
}

/** Serialize 2D array of strings into RFC-4180 formatted CSV */
export function serializeCsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const str = cell ?? '';
          if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
            return `"${str.replace(/"/g, '""')}"`;
          }
          return str;
        })
        .join(','),
    )
    .join('\r\n');
}

/** Standard downloadable sample CSV template for Category import */
export const CATEGORY_SAMPLE_TEMPLATE_CSV = `Category Name,Parent Category,Description,Status
Grocery & Staples,,Everyday kitchen essentials and staples,Active
Rice & Grains,Grocery & Staples,Basmati rice sonamasuri and whole grains,Active
Pulses & Dal,Grocery & Staples,Toor moong urad and chana dal,Active
Cooking Oils,Grocery & Staples,Refined sunflower mustard and groundnut oil,Active
Beverages,,Cold drinks fruit juices tea and coffee,Active
Soft Drinks,Beverages,Carbonated soda and soft drinks,Active
Juices,Beverages,Natural and packaged fruit juices,Active
Tea & Coffee,Beverages,Premium tea leaves instant and filter coffee,Active
Personal Care,,Soaps shampoos and personal hygiene,Active
Hair Care,Personal Care,Shampoos conditioners and hair oils,Active
`;

export interface CategoryValidationError {
  row: number;
  name?: string;
  error: string;
}

export interface ValidatedCategoryItem {
  rowNumber: number;
  name: string;
  parentCategory: string | null;
  description: string | null;
  active: boolean;
  isSubcategory: boolean;
}

/** Parse and map arbitrary CSV text into CategoryImportRow array */
export function parseCategoryCsv(csvText: string): { rows: CategoryImportRow[]; error?: string } {
  const table = parseCsv(csvText);
  if (table.length === 0) return { rows: [], error: 'The uploaded file is empty.' };

  const header = table[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const nameIdx = header.findIndex((h) => h === 'categoryname' || h === 'name' || h === 'category');
  if (nameIdx === -1) {
    return { rows: [], error: 'Required header "Category Name" is missing from the CSV file.' };
  }

  const parentIdx = header.findIndex((h) => h === 'parentcategory' || h === 'parent' || h === 'parentcategoryname');
  const descIdx = header.findIndex((h) => h === 'description' || h === 'desc');
  const statusIdx = header.findIndex((h) => h === 'status' || h === 'active');

  const rows: CategoryImportRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const rawRow = table[i];
    if (rawRow.length === 0 || rawRow.every((c) => !c.trim())) continue; // skip blank line

    const name = rawRow[nameIdx]?.trim() || '';
    const parentCategory = parentIdx !== -1 ? rawRow[parentIdx]?.trim() || null : null;
    const description = descIdx !== -1 ? rawRow[descIdx]?.trim() || null : null;
    const status = statusIdx !== -1 ? rawRow[statusIdx]?.trim() || 'Active' : 'Active';

    rows.push({
      name,
      parentCategory: parentCategory && parentCategory !== '-' ? parentCategory : null,
      description,
      status,
    });
  }

  return { rows };
}

/** Validate category rows and resolve parent-child hierarchy */
export function validateAndPlanCategoryImport(
  rawRows: CategoryImportRow[],
  existingCategories: Array<{ id: string; name: string; parentId?: string | null; active: boolean }>,
): {
  valid: boolean;
  total: number;
  mainCategories: ValidatedCategoryItem[];
  subcategories: ValidatedCategoryItem[];
  errors: CategoryValidationError[];
  existingNames: Set<string>;
} {
  const errors: CategoryValidationError[] = [];
  const mainCategories: ValidatedCategoryItem[] = [];
  const subcategories: ValidatedCategoryItem[] = [];

  const existingMap = new Map<string, { id: string; name: string; parentId?: string | null }>();
  const existingNames = new Set<string>();
  for (const c of existingCategories) {
    const lower = c.name.trim().toLowerCase();
    existingMap.set(lower, c);
    existingNames.add(lower);
  }

  const fileCategories = new Set<string>();
  const seenInFile = new Map<string, number>();

  // Pass 1: Syntax & basic row-level validation
  for (let idx = 0; idx < rawRows.length; idx++) {
    const rowNum = idx + 2; // Row 1 is header
    const r = rawRows[idx];
    const name = (r.name || '').trim();

    if (!name) {
      errors.push({ row: rowNum, error: 'Category Name is required and cannot be blank.' });
      continue;
    }

    if (name.length > 60) {
      errors.push({ row: rowNum, name, error: `Category Name exceeds maximum length of 60 characters (got ${name.length}).` });
      continue;
    }

    const lower = name.toLowerCase();
    if (seenInFile.has(lower)) {
      errors.push({
        row: rowNum,
        name,
        error: `Duplicate Category Name "${name}" in file (already defined at row ${seenInFile.get(lower)}).`,
      });
      continue;
    }
    seenInFile.set(lower, rowNum);
    fileCategories.add(lower);

    if (r.description && r.description.length > 200) {
      errors.push({ row: rowNum, name, error: `Description exceeds maximum length of 200 characters (got ${r.description.length}).` });
    }

    const parent = (r.parentCategory || '').trim() || null;
    if (parent && parent.toLowerCase() === lower) {
      errors.push({ row: rowNum, name, error: `A category cannot be its own parent ("${name}").` });
    }
  }

  // Pass 2: Hierarchy resolution & cycle/depth checking
  for (let idx = 0; idx < rawRows.length; idx++) {
    const rowNum = idx + 2;
    const r = rawRows[idx];
    const name = (r.name || '').trim();
    if (!name || name.length > 60) continue;
    const lower = name.toLowerCase();

    // Skip if already flagged with an error in Pass 1
    if (errors.some((e) => e.row === rowNum && e.error.includes('Duplicate'))) continue;

    const parent = (r.parentCategory || '').trim() || null;
    const desc = (r.description || '').trim() || null;
    const rawStatus = (r.status || 'Active').toLowerCase();
    const active = rawStatus !== 'inactive' && rawStatus !== 'false' && rawStatus !== '0';

    if (!parent) {
      mainCategories.push({
        rowNumber: rowNum,
        name,
        parentCategory: null,
        description: desc,
        active,
        isSubcategory: false,
      });
    } else {
      const parentLower = parent.toLowerCase();

      // Parent must either exist in DB or be declared in this file
      const parentInDb = existingMap.get(parentLower);
      const parentInFile = fileCategories.has(parentLower);

      if (!parentInDb && !parentInFile) {
        errors.push({
          row: rowNum,
          name,
          error: `Parent Category "${parent}" not found in your store or within this file.`,
        });
        continue;
      }

      // Check max depth: If parent is already a subcategory in DB or file
      if (parentInDb && parentInDb.parentId) {
        errors.push({
          row: rowNum,
          name,
          error: `Cannot nest deeper than 2 levels. Parent "${parent}" is already a subcategory.`,
        });
        continue;
      }

      // Check if parent in file also has a parent in file (depth > 2)
      const parentRowInFile = rawRows.find((x) => (x.name || '').trim().toLowerCase() === parentLower);
      if (parentRowInFile && parentRowInFile.parentCategory && parentRowInFile.parentCategory.trim()) {
        errors.push({
          row: rowNum,
          name,
          error: `Cannot nest deeper than 2 levels. Parent "${parent}" is also configured as a subcategory.`,
        });
        continue;
      }

      subcategories.push({
        rowNumber: rowNum,
        name,
        parentCategory: parent,
        description: desc,
        active,
        isSubcategory: true,
      });
    }
  }

  return {
    valid: errors.length === 0,
    total: rawRows.length,
    mainCategories,
    subcategories,
    errors,
    existingNames,
  };
}
