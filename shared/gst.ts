import { divRound } from './money.ts';
import type { ExpenseCategory, GstTreatment, ItcEligibility, ItcMatchingStatus, ItcReviewStatus } from './types.ts';

export const STANDARD_EXPENSE_CATEGORIES: { id: ExpenseCategory; label: string; defaultGstTreatment: GstTreatment; defaultItcEligibility: ItcEligibility }[] = [
  { id: 'rent', label: 'Store / Office Rent', defaultGstTreatment: 'regular', defaultItcEligibility: 'eligible' },
  { id: 'electricity', label: 'Electricity & Utilities', defaultGstTreatment: 'exempt', defaultItcEligibility: 'ineligible' },
  { id: 'internet', label: 'Internet & Telephone', defaultGstTreatment: 'regular', defaultItcEligibility: 'eligible' },
  { id: 'transport', label: 'Freight & Transportation', defaultGstTreatment: 'regular', defaultItcEligibility: 'eligible' },
  { id: 'advertising', label: 'Marketing & Advertising', defaultGstTreatment: 'regular', defaultItcEligibility: 'eligible' },
  { id: 'packaging', label: 'Packaging Materials', defaultGstTreatment: 'regular', defaultItcEligibility: 'eligible' },
  { id: 'maintenance', label: 'Repairs & Maintenance', defaultGstTreatment: 'regular', defaultItcEligibility: 'eligible' },
  { id: 'office_supplies', label: 'Office Supplies & Stationery', defaultGstTreatment: 'regular', defaultItcEligibility: 'eligible' },
  { id: 'professional_fees', label: 'Accounting & Legal Fees', defaultGstTreatment: 'regular', defaultItcEligibility: 'eligible' },
  { id: 'salary', label: 'Staff Salary & Wages', defaultGstTreatment: 'non_gst', defaultItcEligibility: 'ineligible' },
  { id: 'tea_snacks', label: 'Refreshments & Pantry', defaultGstTreatment: 'regular', defaultItcEligibility: 'blocked_17_5' }, // Blocked under Sec 17(5)
  { id: 'other', label: 'Other Operating Expenses', defaultGstTreatment: 'exempt', defaultItcEligibility: 'ineligible' },
];

export interface CalcExpenseInput {
  amountMinor: number; // paise
  taxInclusive: boolean;
  taxRateBp: number; // 1800 = 18%
  intraState: boolean;
  gstTreatment: GstTreatment;
  itcEligibility: ItcEligibility;
}

export interface CalcExpenseResult {
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  totalGstMinor: number;
  totalMinor: number;
  itcMinor: number; // Initial recommended ITC credit based on eligibility
}

/**
 * Calculates tax breakdown and initial ITC eligibility for an expense.
 * Fully deterministic, integer-only paise calculations matching the billing tax engine.
 */
export function calcExpense(input: CalcExpenseInput): CalcExpenseResult {
  const { amountMinor, taxInclusive, taxRateBp, intraState, gstTreatment, itcEligibility } = input;

  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new Error('Expense amount must be zero or a positive whole number of paise');
  }

  // Exempt, Non-GST, Nil-rated, or zero tax treatments have 0 tax
  const hasTax = !['exempt', 'nil_rated', 'non_gst'].includes(gstTreatment) && taxRateBp > 0;

  let taxableMinor = 0;
  let totalGstMinor = 0;
  let totalMinor = 0;

  if (!hasTax) {
    taxableMinor = amountMinor;
    totalGstMinor = 0;
    totalMinor = amountMinor;
  } else if (taxInclusive) {
    taxableMinor = divRound(amountMinor * 10000, 10000 + taxRateBp);
    totalGstMinor = amountMinor - taxableMinor;
    totalMinor = amountMinor;
  } else {
    taxableMinor = amountMinor;
    totalGstMinor = divRound(taxableMinor * taxRateBp, 10000);
    totalMinor = taxableMinor + totalGstMinor;
  }

  let cgstMinor = 0;
  let sgstMinor = 0;
  let igstMinor = 0;

  if (totalGstMinor > 0) {
    if (intraState) {
      cgstMinor = Math.floor(totalGstMinor / 2);
      sgstMinor = totalGstMinor - cgstMinor;
    } else {
      igstMinor = totalGstMinor;
    }
  }

  // ITC is 0 if ineligible or blocked under Sec 17(5) or treatment does not permit ITC
  let itcMinor = 0;
  if (itcEligibility === 'eligible' && hasTax) {
    itcMinor = totalGstMinor;
  }

  return {
    taxableMinor,
    cgstMinor,
    sgstMinor,
    igstMinor,
    totalGstMinor,
    totalMinor,
    itcMinor,
  };
}

/**
 * Normalizes an invoice number for fuzzy comparison (e.g. "INV/2026/001" vs "INV-2026-001" vs "inv 2026 001")
 */
export function normalizeInvoiceNumber(inv: string): string {
  return (inv || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}

export interface BookRecordForMatch {
  docType: 'purchase' | 'expense';
  docId: string;
  docNumber: string;
  supplierGstin?: string | null;
  supplierInvoiceNumber: string;
  supplierInvoiceDate: string;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  totalGstMinor: number;
}

export interface Gstr2bRecordForMatch {
  id: string;
  supplierGstin: string;
  invoiceNumber: string;
  invoiceDate: string;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  totalGstMinor: number;
}

export interface MatchResult {
  status: ItcMatchingStatus;
  bookRecord?: BookRecordForMatch;
  gstr2bRecord?: Gstr2bRecordForMatch;
  taxableDiffMinor: number;
  gstDiffMinor: number;
}

/**
 * Compares a single book record against a GSTR-2B record.
 * Uses 1 Rupee (100 paise) tolerance for rounding differences.
 */
export function compareBookAnd2B(book: BookRecordForMatch, g2b: Gstr2bRecordForMatch): MatchResult {
  const normBookGstin = (book.supplierGstin || '').trim().toUpperCase();
  const norm2bGstin = (g2b.supplierGstin || '').trim().toUpperCase();

  const normBookInv = normalizeInvoiceNumber(book.supplierInvoiceNumber);
  const norm2bInv = normalizeInvoiceNumber(g2b.invoiceNumber);

  if (normBookGstin !== norm2bGstin || normBookInv !== norm2bInv) {
    return {
      status: 'missing_from_2b',
      bookRecord: book,
      taxableDiffMinor: book.taxableMinor,
      gstDiffMinor: book.totalGstMinor,
    };
  }

  const taxableDiff = Math.abs(book.taxableMinor - g2b.taxableMinor);
  const gstDiff = Math.abs(book.totalGstMinor - g2b.totalGstMinor);

  // Allow up to 100 paise (Rs 1) tolerance for rounding
  const taxableMatches = taxableDiff <= 100;
  const gstMatches = gstDiff <= 100;

  if (taxableMatches && gstMatches) {
    return {
      status: 'matched',
      bookRecord: book,
      gstr2bRecord: g2b,
      taxableDiffMinor: 0,
      gstDiffMinor: 0,
    };
  }

  if (!taxableMatches) {
    return {
      status: 'taxable_mismatch',
      bookRecord: book,
      gstr2bRecord: g2b,
      taxableDiffMinor: book.taxableMinor - g2b.taxableMinor,
      gstDiffMinor: book.totalGstMinor - g2b.totalGstMinor,
    };
  }

  return {
    status: 'gst_mismatch',
    bookRecord: book,
    gstr2bRecord: g2b,
    taxableDiffMinor: book.taxableMinor - g2b.taxableMinor,
    gstDiffMinor: book.totalGstMinor - g2b.totalGstMinor,
  };
}

/**
 * Validates GSTR-2B import JSON structure
 */
export function validateGstr2bJson(data: any): { ok: boolean; error?: string; records: any[] } {
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'File content must be a valid JSON object', records: [] };
  }

  const records: any[] = [];

  // Official GSTN GSTR-2B JSON structure has `data.docdata.b2b` array
  const docdata = data.data?.docdata || data.docdata || data;
  const b2bList = docdata.b2b || [];

  if (!Array.isArray(b2bList)) {
    // If flat array format was supplied
    if (Array.isArray(data)) {
      return { ok: true, records: data };
    }
    return { ok: false, error: 'Could not find standard B2B invoice section in GSTR-2B JSON', records: [] };
  }

  for (const supplier of b2bList) {
    const supplierGstin = String(supplier.ctin || supplier.supplierGstin || '').trim();
    const supplierName = supplier.trdnm || supplier.lgnm || supplier.cname || supplier.tradeName || supplier.legalName || null;
    const invList = supplier.inv || [];
    if (Array.isArray(invList)) {
      for (const inv of invList) {
        const invNo = String(inv.inum || inv.invoiceNumber || '').trim();
        const invDate = String(inv.dt || inv.invoiceDate || '').trim();
        const invType = String(inv.inv_typ || inv.type || 'R').trim();

        let taxableMinor = 0;
        let cgstMinor = 0;
        let sgstMinor = 0;
        let igstMinor = 0;
        let cessMinor = 0;

        // Items inside invoice
        const items = inv.items || [];
        if (Array.isArray(items)) {
          for (const it of items) {
            taxableMinor += Math.round(Number(it.txval || 0) * 100);
            cgstMinor += Math.round(Number(it.camt || 0) * 100);
            sgstMinor += Math.round(Number(it.samt || 0) * 100);
            igstMinor += Math.round(Number(it.iamt || 0) * 100);
            cessMinor += Math.round(Number(it.csamt || 0) * 100);
          }
        } else {
          taxableMinor = Math.round(Number(inv.val || 0) * 100);
          cgstMinor = Math.round(Number(inv.cgst || 0) * 100);
          sgstMinor = Math.round(Number(inv.sgst || 0) * 100);
          igstMinor = Math.round(Number(inv.igst || 0) * 100);
        }

        records.push({
          supplierGstin,
          supplierName,
          invoiceNumber: invNo,
          invoiceType: invType,
          invoiceDate: invDate,
          taxableMinor,
          cgstMinor,
          sgstMinor,
          igstMinor,
          cessMinor,
          totalGstMinor: cgstMinor + sgstMinor + igstMinor + cessMinor,
          itcAvailability: inv.itcavil || 'Y',
          reason: inv.rsn || null,
        });
      }
    }
  }

  return { ok: true, records };
}

/**
 * Validates and parses GSTR-2B CSV format
 */
export function validateGstr2bCsv(csvText: string): { ok: boolean; error?: string; records: any[] } {
  if (!csvText || !csvText.trim()) {
    return { ok: false, error: 'CSV file is empty', records: [] };
  }

  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return { ok: false, error: 'CSV file must contain a header row and at least one data row', records: [] };
  }

  const header = lines[0].split(',').map((h) => h.replace(/^["']|["']$/g, '').trim().toLowerCase());

  // Find column indexes
  const gstinIdx = header.findIndex((h) => h.includes('gstin') || h.includes('ctin'));
  const invNoIdx = header.findIndex((h) => h.includes('invoice number') || h.includes('inv no') || h.includes('inum') || h === 'invoice_number');
  const invDateIdx = header.findIndex((h) => h.includes('invoice date') || h.includes('inv dt') || h.includes('date') || h === 'invoice_date');
  const taxableIdx = header.findIndex((h) => h.includes('taxable') || h.includes('txval'));
  const cgstIdx = header.findIndex((h) => h.includes('cgst') || h.includes('camt') || h.includes('central tax'));
  const sgstIdx = header.findIndex((h) => h.includes('sgst') || h.includes('samt') || h.includes('state') || h.includes('ut tax'));
  const igstIdx = header.findIndex((h) => h.includes('igst') || h.includes('iamt') || h.includes('integrated tax'));
  const nameIdx = header.findIndex((h) => h.includes('trade') || h.includes('legal name') || h.includes('supplier name') || h.includes('cname') || h.includes('name'));

  if (gstinIdx === -1 || invNoIdx === -1 || taxableIdx === -1) {
    return {
      ok: false,
      error: 'CSV headers must include at least: Supplier GSTIN, Invoice Number, and Taxable Value',
      records: [],
    };
  }

  const records: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(',').map((c) => c.replace(/^["']|["']$/g, '').trim());
    if (row.length <= Math.max(gstinIdx, invNoIdx, taxableIdx)) continue;

    const supplierGstin = row[gstinIdx] || '';
    const invoiceNumber = row[invNoIdx] || '';
    if (!supplierGstin || !invoiceNumber) continue;

    const taxableVal = parseFloat(row[taxableIdx] || '0') || 0;
    const cgstVal = cgstIdx !== -1 ? parseFloat(row[cgstIdx] || '0') || 0 : 0;
    const sgstVal = sgstIdx !== -1 ? parseFloat(row[sgstIdx] || '0') || 0 : 0;
    const igstVal = igstIdx !== -1 ? parseFloat(row[igstIdx] || '0') || 0 : 0;
    const supplierName = nameIdx !== -1 ? row[nameIdx] || null : null;
    const invoiceDate = invDateIdx !== -1 ? row[invDateIdx] || '' : '';

    const taxableMinor = Math.round(taxableVal * 100);
    const cgstMinor = Math.round(cgstVal * 100);
    const sgstMinor = Math.round(sgstVal * 100);
    const igstMinor = Math.round(igstVal * 100);

    records.push({
      supplierGstin,
      supplierName,
      invoiceNumber,
      invoiceType: 'regular',
      invoiceDate,
      taxableMinor,
      cgstMinor,
      sgstMinor,
      igstMinor,
      cessMinor: 0,
      totalGstMinor: cgstMinor + sgstMinor + igstMinor,
      itcAvailability: 'Y',
      reason: null,
    });
  }

  if (records.length === 0) {
    return { ok: false, error: 'No valid invoice rows found in CSV', records: [] };
  }

  return { ok: true, records };
}
