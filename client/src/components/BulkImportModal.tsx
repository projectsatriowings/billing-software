/**
 * Advanced Bulk Product Import Wizard
 *
 * Designed for Supermarket & Retail Supplier Invoice / Catalog Imports.
 *
 * Key Capabilities:
 * A. Simplified 8-column supplier format (Product Name, UOM, Selling Price, Cost Price, HSN, GST, Inclusive, Opening Stock)
 * B. Automatic readable SKU generation with collision avoidance & manual editing
 * C. Automatic category suggestion using database categories and keyword matching
 * D. Restock vs New Product classification with duplicate & ambiguous match detection
 * E. Safe stock handling: adds incoming stock to existing stock on restocks; initializes stock on new products
 * F. Price change alerts on restocks with optional price updates
 * G. Barcode integration: internal EAN-13 generation for new products, preserved barcodes on restocks
 * H. Rich interactive preview table with live status filtering, inline errors, and stock calculations
 * I. Atomic transactional import with idempotency protection against double submission
 */

import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import {
  api,
  bulkImportItems,
  fetchItemByBarcode,
  type BulkImportRow,
  type BulkImportResult,
  type Category,
  type Item,
} from '../api';
import {
  generateShortSku,
  generateUniqueShortSku,
  generateUniqueSku,
  suggestCategory,
  matchProductToCatalog,
  type MatchCandidate,
  renderBarcodeSvg,
  generateUniqueInternalBarcode,
  isValidEan13,
  extractPackSize,
  normalizeProductName,
  classifyProductNature,
  type ProductNature,
  type NatureConfidence,
} from '../../../shared/bulkImport.ts';
import { ScanManufacturerBarcodeModal } from './ScanManufacturerBarcodeModal.tsx';
import { type BarcodeTargetItem } from '../../../shared/barcodeScannerUtils.ts';

const PackageBoxIcon = ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

const FileSpreadsheetIcon = ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <path d="M8 13h8" />
    <path d="M8 17h8" />
    <path d="M14 9v12" />
  </svg>
);

const UploadCloudIcon = ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
    <path d="M12 12v9" />
    <path d="m16 16-4-4-4 4" />
  </svg>
);

const ClipboardPasteIcon = ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    <path d="M8 12h8" />
    <path d="M8 16h6" />
  </svg>
);

const Edit3Icon = ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);

const DownloadIcon = ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const SparklesIcon = ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    <path d="M5 3v4" />
    <path d="M19 17v4" />
    <path d="M3 5h4" />
    <path d="M17 19h4" />
  </svg>
);

const RefreshCwIcon = ({ size = 12, color = '#4f46e5', spinning = false }: { size?: number; color?: string; spinning?: boolean }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={spinning ? 'bulk-spin' : undefined}
    style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
  >
    <path d="M21 2v6h-6" />
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M3 22v-6h6" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
  </svg>
);

const AlertTriangleIcon = ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const AlertCircleIcon = ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const CheckCircleIcon = ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const CheckIcon = ({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const CopyIcon = ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const BarcodeIcon = ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <path d="M3 5v14" />
    <path d="M8 5v14" />
    <path d="M12 5v14" />
    <path d="M17 5v14" />
    <path d="M21 5v14" />
  </svg>
);

const CameraIcon = ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
    <circle cx="12" cy="13" r="3" />
  </svg>
);

const TagIcon = ({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <path d="m20.59 13.41-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);

const StoreIcon = ({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
    <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
    <path d="M2 7h20" />
  </svg>
);

const Trash2Icon = ({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

const PlusIcon = ({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const ArrowRightIcon = ({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

const ArrowLeftIcon = ({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

const ChevronRightIcon = ({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const CloseXIcon = ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const LinkIcon = ({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const RotateCcwIcon = ({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

const FileTextIcon = ({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

const LayersIcon = ({ size = 14, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}>
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);

// ── GST rate options ──────────────────────────────────────────────────────────
export const GST_RATE_OPTIONS = [
  { bp: 0,    label: '0%',    value: '0' },
  { bp: 250,  label: '2.5%',  value: '2.5' },
  { bp: 500,  label: '5%',    value: '5' },
  { bp: 1200, label: '12%',   value: '12' },
  { bp: 1800, label: '18%',   value: '18' },
  { bp: 2800, label: '28%',   value: '28' },
];

export const VALID_GST_BPS = new Set([0, 250, 500, 1200, 1800, 2800]);

// ── Standard Units of measurement ─────────────────────────────────────────────
export const UOM_OPTIONS = [
  { code: 'pcs',  label: 'Pieces (pcs)' },
  { code: 'kg',   label: 'Kilogram (kg)' },
  { code: 'g',    label: 'Gram (g)' },
  { code: 'l',    label: 'Litre (l)' },
  { code: 'ml',   label: 'Millilitre (ml)' },
  { code: 'box',  label: 'Box (box)' },
  { code: 'pack', label: 'Pack (pack)' },
  { code: 'm',    label: 'Metre (m)' },
];

// ── Simplified Supplier Excel / CSV Template Columns ───────────────────────────
export const TEMPLATE_COLUMNS = [
  'Product Name',
  'UOM',
  'Selling Price',
  'Cost Price',
  'HSN',
  'GST Rate',
  'Price Inclusive of GST',
  'Opening Stock',
];

export const SAMPLE_SUPPLIER_ROWS = [
  ['Toor Dal 1kg', 'kg', '145.50', '120', '0713', '5%', 'Yes', '50'],
  ['Basmati Rice 1kg', 'kg', '89', '65', '1006', '5%', 'Yes', '100'],
  ['Amul Butter 100g', 'pcs', '55', '48', '0401', '12%', 'Yes', '40'],
  ['Surf Excel 1kg', 'pcs', '200', '165', '3402', '18%', 'Yes', '25'],
  ['Moong Dal 1kg', 'kg', '110', '95', '0713', '5%', 'Yes', '30'],
];

// ── Types ─────────────────────────────────────────────────────────────────────
export type WizardStep = 'choose' | 'review' | 'confirm' | 'results';
export type RowFilter = 'all' | 'new' | 'restock' | 'ambiguous' | 'duplicate' | 'error';
export type RowStatus = 'NEW_PRODUCT' | 'RESTOCK' | 'AMBIGUOUS' | 'DUPLICATE' | 'ERROR';

export interface RowErrorItem {
  field?: 'name' | 'sellingPrice' | 'costPrice' | 'gstRate' | 'unit' | 'sku' | 'openingStock' | 'category' | 'barcode';
  message: string;
  isDuplicate?: boolean;
}

export interface GridRow {
  _id: number;
  rowNum: number;
  name: string;
  sku: string;
  isSkuManuallyEdited: boolean;
  barcode: string;
  barcodeType: 'INTERNAL' | 'MANUFACTURER' | null;
  isBarcodeAutoGenerated: boolean;
  barcodeError?: string;
  scannedInSession?: boolean;
  additionalBarcodes?: { barcode: string; barcodeType: 'INTERNAL' | 'MANUFACTURER' }[];
  productNature: ProductNature;
  natureConfidence: NatureConfidence;
  isNatureManuallyEdited?: boolean;
  category: string;
  categoryId: string;
  isCategoryManuallyEdited: boolean;
  unit: string;
  sellingPrice: string;
  costPrice: string;
  hsn: string;
  gstRate: string; // e.g. "5%", "12%"
  taxInclusive: boolean;
  openingStock: string;

  // Matching & restock state
  status: RowStatus;
  matchedItem: MatchCandidate | null;
  candidates: MatchCandidate[];
  resolution?: 'LINK' | 'NEW' | null;
  updatePrices: boolean; // whether to update pricing on restock

  // Validation details
  errors: RowErrorItem[];
}

interface Props {
  categories: Category[];
  existingItems?: Item[];
  shopName?: string;
  onClose: () => void;
  onImportDone: () => void;
}

// ── Helper functions ──────────────────────────────────────────────────────────

const SCIENTIFIC_NOTATION_RE = /^[0-9]+(\.[0-9]+)?[eE]\+[0-9]+$/;

export function parseGstToBp(raw: string): number | null {
  if (!raw || !raw.trim()) return 500; // default 5%
  const clean = raw.replace('%', '').trim();
  const num = parseFloat(clean);
  if (!Number.isFinite(num)) return null;
  if (num > 0 && num < 1) {
    const bp = Math.round(num * 10000);
    return VALID_GST_BPS.has(bp) ? bp : null;
  }
  const bp = Math.round(num * 100);
  return VALID_GST_BPS.has(bp) ? bp : null;
}

export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if ((ch === ',' || ch === '\t') && !inQuotes) {
      result.push(field); field = '';
    } else {
      field += ch;
    }
  }
  result.push(field);
  return result.map((f) => f.trim());
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]): void {
  const escape = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((r) => r.map(escape).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function downloadExcelTemplate(): void {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_COLUMNS, ...SAMPLE_SUPPLIER_ROWS]);
  XLSX.utils.book_append_sheet(wb, ws, 'Supplier Products');
  XLSX.writeFile(wb, 'supplier_product_import_template.xlsx');
}

// ── Main Component ────────────────────────────────────────────────────────────

export function BulkImportModal({ categories, existingItems = [], shopName, onClose, onImportDone }: Props) {
  const [step, setStep] = useState<WizardStep>('choose');
  const [importSource, setImportSource] = useState<string>('Uploaded File');
  const [activeTab, setActiveTab] = useState<'upload' | 'paste' | 'manual'>('upload');
  const [fileName, setFileName] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [parseError, setParseError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Generate unique batch ID for idempotency protection against double submission
  const importBatchId = useRef(`imp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`);

  // Global preference: update prices on restock
  const [globalUpdatePrices, setGlobalUpdatePrices] = useState(true);

  // Rows and filter
  const [rawRows, setRawRows] = useState<Omit<GridRow, 'status' | 'errors'>[]>([]);
  const [filter, setFilter] = useState<RowFilter>('all');
  const [barcodeValidationActive, setBarcodeValidationActive] = useState(false);
  const nextId = useRef(1);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [apiError, setApiError] = useState('');
  const [importResult, setImportResult] = useState<BulkImportResult | null>(null);

  // Prevent background page from scrolling while Bulk Import Modal is open
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // Barcode Workflow State
  const [barcodeWorkflow, setBarcodeWorkflow] = useState<'generate' | 'scan'>('generate');

  // Pre-index existing items for matching
  const catalogCandidates: MatchCandidate[] = useMemo(() => {
    return existingItems.map((it) => ({
      id: it.id,
      name: it.name,
      sku: it.sku || null,
      barcode: it.barcode || null,
      category: it.category || null,
      unit: it.unit || 'pcs',
      priceMinor: it.priceMinor,
      costMinor: it.costMinor ?? 0,
      currentStockMilli: it.currentStockMilli ?? 0,
      taxRateBp: it.taxRateBp ?? 500,
      taxInclusive: it.taxInclusive ?? true,
      hsn: it.hsn || null,
      packSize: extractPackSize(it.name)?.raw || it.unit,
    }));
  }, [existingItems]);

  const existingSkusSet = useMemo(() => {
    const s = new Set<string>();
    for (const it of existingItems) {
      if (it.sku && it.sku.trim()) s.add(it.sku.trim().toLowerCase());
    }
    return s;
  }, [existingItems]);

  const existingBarcodesSet = useMemo(() => {
    const s = new Set<string>();
    for (const it of existingItems) {
      if (it.barcode && it.barcode.trim()) s.add(it.barcode.trim());
    }
    return s;
  }, [existingItems]);

  // Dynamic store categories loaded from database
  const [categoryList, setCategoryList] = useState<Category[]>(categories || []);
  const [isRefreshingCats, setIsRefreshingCats] = useState(false);

  // Load fresh categories from database on mount and whenever refreshed
  const loadCategoriesFromDb = useCallback(async (autoSuggestMissing = false) => {
    try {
      setIsRefreshingCats(true);
      const res = await api<{ categories: Category[] }>('/api/categories');
      if (res?.categories) {
        setCategoryList(res.categories);
        if (autoSuggestMissing) {
          const freshActiveCats = res.categories.filter((c) => c.active !== false);
          setRawRows((prev) =>
            prev.map((r) => {
              // 1. If restock, retain matched item's category
              if (r.matchedItem) {
                const matchCatName = r.matchedItem.category || r.category;
                const foundInActive = freshActiveCats.find(
                  (c) => c.name.toLowerCase() === matchCatName.toLowerCase()
                );
                return {
                  ...r,
                  categoryId: foundInActive ? foundInActive.id : r.categoryId,
                  category: matchCatName,
                };
              }

              // 2. If user manually selected a category, preserve it if still active
              if (r.isCategoryManuallyEdited && (r.categoryId || r.category)) {
                const stillActive = freshActiveCats.find(
                  (c) => (r.categoryId && c.id === r.categoryId) || (r.category && c.name.toLowerCase() === r.category.toLowerCase())
                );
                if (stillActive) {
                  return { ...r, categoryId: stillActive.id, category: stillActive.name };
                }
              }

              // 3. Otherwise auto-suggest using latest active categories
              if (!r.isCategoryManuallyEdited || (!r.categoryId && !r.category)) {
                if (r.name) {
                  const sug = suggestCategory(r.name, freshActiveCats);
                  if (sug) {
                    return { ...r, categoryId: sug.id, category: sug.name };
                  }
                }
              }

              return r;
            })
          );
        }
      }
    } catch (err) {
      console.error('Failed to load categories:', err);
    } finally {
      setIsRefreshingCats(false);
    }
  }, []);

  useEffect(() => {
    loadCategoriesFromDb(true);
  }, [loadCategoriesFromDb]);

  // Active store categories
  const activeCategories = useMemo(() => {
    return categoryList.filter((c) => c.active !== false);
  }, [categoryList]);

  // ── Compute Classification & Validation for all rows ────────────────────────
  const validatedRows: GridRow[] = useMemo(() => {
    const seenNames = new Map<string, number>(); // normalized name+unit -> rowNum
    const seenSkus = new Map<string, number>();  // lower(sku) -> rowNum
    const seenBarcodes = new Map<string, number>(); // barcode -> rowNum

    return rawRows.map((r) => {
      const errors: RowErrorItem[] = [];
      let isDuplicateInFile = false;

      // 1. Validate Product Name
      if (!r.name.trim()) {
        errors.push({ field: 'name', message: 'Product name is required' });
      } else if (r.name.length > 120) {
        errors.push({ field: 'name', message: 'Product name exceeds 120 characters' });
      }

      // Check intra-file duplicate name & unit
      const normKey = `${r.name.trim().toLowerCase()}__${r.unit.trim().toLowerCase()}`;
      if (r.name.trim()) {
        if (seenNames.has(normKey)) {
          const first = seenNames.get(normKey);
          errors.push({
            field: 'name',
            isDuplicate: true,
            message: `Duplicate row: repeats product in row ${first}`,
          });
          isDuplicateInFile = true;
        } else {
          seenNames.set(normKey, r.rowNum);
        }
      }

      // 2. Validate Selling Price
      const priceTrim = r.sellingPrice.trim();
      const priceVal = parseFloat(priceTrim);
      if (!priceTrim) {
        errors.push({ field: 'sellingPrice', message: 'Selling price is required' });
      } else if (!Number.isFinite(priceVal) || priceVal < 0) {
        errors.push({ field: 'sellingPrice', message: 'Selling price must be a non-negative number' });
      }

      // 3. Validate Cost Price
      const costTrim = r.costPrice.trim();
      if (costTrim) {
        const costVal = parseFloat(costTrim);
        if (!Number.isFinite(costVal) || costVal < 0) {
          errors.push({ field: 'costPrice', message: 'Cost price must be a non-negative number' });
        }
      }

      // 4. Validate Opening / Incoming Stock
      const stockTrim = r.openingStock.trim();
      if (stockTrim) {
        const stockVal = parseFloat(stockTrim);
        if (!Number.isFinite(stockVal) || stockVal < 0) {
          errors.push({ field: 'openingStock', message: 'Incoming stock must be a non-negative number' });
        }
      }

      // 5. Validate GST Rate
      const gstTrim = r.gstRate.trim();
      const gstBp = parseGstToBp(gstTrim);
      if (gstTrim && gstBp === null) {
        errors.push({
          field: 'gstRate',
          message: `GST rate "${gstTrim}" is not supported. Use one of: 0%, 2.5%, 5%, 12%, 18%, 28%`,
        });
      }

      // 6. Validate SKU
      const skuTrim = r.sku.trim();
      if (!skuTrim) {
        errors.push({ field: 'sku', message: 'SKU code is required' });
      } else {
        const skuLower = skuTrim.toLowerCase();
        if (SCIENTIFIC_NOTATION_RE.test(skuTrim)) {
          errors.push({ field: 'sku', message: 'SKU looks like scientific notation' });
        } else if (seenSkus.has(skuLower)) {
          const first = seenSkus.get(skuLower);
          errors.push({ field: 'sku', isDuplicate: true, message: `SKU "${skuTrim}" repeats row ${first}` });
          isDuplicateInFile = true;
        } else if (!r.matchedItem && existingSkusSet.has(skuLower)) {
          // If it's a new product, check collision against existing database SKU
          errors.push({ field: 'sku', isDuplicate: true, message: `SKU "${skuTrim}" already exists for another product` });
          isDuplicateInFile = true;
        } else {
          seenSkus.set(skuLower, r.rowNum);
        }
      }

      // 7. Validate Category
      const catTrim = (r.category || '').trim();
      const catIdTrim = (r.categoryId || '').trim();

      if (!r.matchedItem) {
        if (!catIdTrim && !catTrim) {
          errors.push({ field: 'category', message: 'Category is required for new products. Please select an active category.' });
        } else {
          const matchedActive = activeCategories.find(
            (c) => (catIdTrim && c.id === catIdTrim) || (catTrim && c.name.toLowerCase() === catTrim.toLowerCase())
          );
          if (!matchedActive) {
            errors.push({ field: 'category', message: 'Category is inactive or invalid. Please select an active category.' });
          }
        }
      }

      // 8. Validate Barcode
      const barcodeTrim = (r.barcode || '').trim();
      if (!r.matchedItem) {
        if (!barcodeTrim) {
          if (barcodeValidationActive) {
            errors.push({ field: 'barcode', message: 'Barcode is required for new products. Click "Generate Barcodes" or enter one.' });
          }
        } else if (SCIENTIFIC_NOTATION_RE.test(barcodeTrim)) {
          errors.push({ field: 'barcode', message: 'Barcode looks like scientific notation' });
        } else if (seenBarcodes.has(barcodeTrim)) {
          const first = seenBarcodes.get(barcodeTrim);
          errors.push({ field: 'barcode', isDuplicate: true, message: `Barcode "${barcodeTrim}" repeats row ${first}` });
          isDuplicateInFile = true;
        } else if (existingBarcodesSet.has(barcodeTrim)) {
          errors.push({ field: 'barcode', isDuplicate: true, message: `Barcode "${barcodeTrim}" already exists in catalog` });
          isDuplicateInFile = true;
        } else {
          seenBarcodes.set(barcodeTrim, r.rowNum);
        }
      } else if (barcodeTrim) {
        seenBarcodes.set(barcodeTrim, r.rowNum);
      }

      // Determine Row Classification
      let status: RowStatus = 'NEW_PRODUCT';
      if (errors.some((e) => !e.isDuplicate)) {
        status = 'ERROR';
      } else if (isDuplicateInFile) {
        status = 'DUPLICATE';
      } else if (r.resolution === 'LINK' && r.matchedItem) {
        status = 'RESTOCK';
      } else if (r.resolution === 'NEW') {
        status = 'NEW_PRODUCT';
      } else if (r.matchedItem) {
        status = 'RESTOCK';
      } else if (r.candidates && r.candidates.length > 1) {
        status = 'AMBIGUOUS';
      } else {
        status = 'NEW_PRODUCT';
      }

      return {
        ...r,
        status,
        errors,
      };
    });
  }, [rawRows, existingSkusSet, existingBarcodesSet, activeCategories, barcodeValidationActive]);

  // Counts
  const newRows = useMemo(() => validatedRows.filter((r) => r.status === 'NEW_PRODUCT'), [validatedRows]);
  const restockRows = useMemo(() => validatedRows.filter((r) => r.status === 'RESTOCK'), [validatedRows]);
  const ambiguousRows = useMemo(() => validatedRows.filter((r) => r.status === 'AMBIGUOUS'), [validatedRows]);
  const duplicateRows = useMemo(() => validatedRows.filter((r) => r.status === 'DUPLICATE'), [validatedRows]);
  const errorRows = useMemo(() => validatedRows.filter((r) => r.status === 'ERROR'), [validatedRows]);

  // Barcode eligibility & generation counts
  const eligibleForBarcodeCount = useMemo(() => {
    return validatedRows.filter((r) => {
      if (r.matchedItem || r.status === 'RESTOCK') return false;
      if (r.status === 'AMBIGUOUS' || r.status === 'DUPLICATE') return false;
      if (r.barcode && r.barcode.trim()) return false;
      return true;
    }).length;
  }, [validatedRows]);

  const generatedBarcodesCount = useMemo(() => {
    return rawRows.filter((r) => r.isBarcodeAutoGenerated && r.barcode && r.barcode.trim()).length;
  }, [rawRows]);

  // Eligible to import = new products + restocks (without blocking errors)
  const eligibleRows = useMemo(() => validatedRows.filter((r) => r.status === 'NEW_PRODUCT' || r.status === 'RESTOCK'), [validatedRows]);

  // Filtered rows for the table view
  const visibleRows = useMemo(() => {
    if (filter === 'new') return newRows;
    if (filter === 'restock') return restockRows;
    if (filter === 'ambiguous') return ambiguousRows;
    if (filter === 'duplicate') return duplicateRows;
    if (filter === 'error') return errorRows;
    return validatedRows;
  }, [filter, validatedRows, newRows, restockRows, ambiguousRows, duplicateRows, errorRows]);

  // ── Ingesting Supplier Table Data (CSV or Excel) ───────────────────────────

  const ingestSupplierData = (lines: string[][], sourceLabel: string) => {
    if (!lines || lines.length === 0) {
      setParseError('No rows found in the data.');
      return;
    }

    const firstLine = lines[0].map((h) => String(h || '').trim().toLowerCase());
    const HEADER_KEYWORDS = ['name', 'product', 'item', 'price', 'selling', 'uom', 'unit', 'cost', 'hsn', 'gst', 'stock'];
    const hasHeader = HEADER_KEYWORDS.some((kw) => firstLine.some((h) => h.includes(kw)));

    const dataLines = hasHeader ? lines.slice(1) : lines;
    const headers = hasHeader ? firstLine : null;

    const findCol = (patterns: string[]): number => {
      if (!headers) return -1;
      for (let i = 0; i < headers.length; i++) {
        if (patterns.some((p) => headers[i].includes(p))) return i;
      }
      return -1;
    };

    const iName     = findCol(['product name', 'item name', 'product', 'name', 'item', 'description']);
    const iUnit     = findCol(['uom', 'unit', 'measurement']);
    const iPrice    = findCol(['selling price', 'sale price', 'price', 'mrp', 'rate']);
    const iCost     = findCol(['cost price', 'cost', 'purchase price', 'buying price']);
    const iHsn      = findCol(['hsn', 'sac', 'hsn code']);
    const iGst      = findCol(['gst rate', 'gst', 'tax rate', 'tax']);
    const iInclusive= findCol(['price inclusive of gst', 'price inclusive', 'inclusive', 'incl']);
    const iStock    = findCol(['opening stock', 'current stock', 'stock', 'qty', 'quantity']);
    const iBarcode  = findCol(['barcode', 'ean', 'upc', 'gtin', 'bar code']);

    const getVal = (parts: string[], idx: number, fallbackIdx: number): string => {
      const targetIdx = idx >= 0 ? idx : fallbackIdx;
      if (targetIdx < 0 || targetIdx >= parts.length) return '';
      return String(parts[targetIdx] ?? '').replace(/^["']|["']$/g, '').trim();
    };

    const parsed: Omit<GridRow, 'status' | 'errors'>[] = [];
    let startRow = 2;
    const seenImportSkus = new Set<string>();

    for (let li = 0; li < dataLines.length; li++) {
      const parts = dataLines[li];
      if (!parts || parts.every((p) => !String(p || '').trim())) continue;

      const name     = getVal(parts, iName, 0);
      const unitRaw  = getVal(parts, iUnit, 1);
      const price    = getVal(parts, iPrice, 2);
      const cost     = getVal(parts, iCost, 3);
      const hsn      = getVal(parts, iHsn, 4);
      const gst      = getVal(parts, iGst, 5);
      const incl     = getVal(parts, iInclusive, 6);
      const stock    = getVal(parts, iStock, 7);
      const barcodeRaw = getVal(parts, iBarcode, -1);

      const unitMatch = UOM_OPTIONS.find(
        (u) => u.code.toLowerCase() === unitRaw.toLowerCase() || u.label.toLowerCase().includes(unitRaw.toLowerCase())
      );
      const unit = unitMatch ? unitMatch.code : (unitRaw || 'pcs');
      const taxInclusive = !incl || ['yes', 'y', 'true', '1'].includes(incl.toLowerCase());

      // Classify against existing catalog
      const matchResult = matchProductToCatalog(name, unit, catalogCandidates, { barcode: barcodeRaw });

      let finalSku = '';
      let matchedItem: MatchCandidate | null = null;
      let category = '';
      let categoryId = '';
      let resolution: 'LINK' | 'NEW' | null = null;

      let barcode = '';
      let barcodeType: 'INTERNAL' | 'MANUFACTURER' | null = null;
      const isBarcodeAutoGenerated = false;

      if (matchResult.classification === 'RESTOCK' && matchResult.matchedItem) {
        matchedItem = matchResult.matchedItem;
        resolution = 'LINK';
        finalSku = matchedItem.sku || generateUniqueSku(name, existingSkusSet, seenImportSkus);
        category = matchedItem.category || '';
        const foundActive = activeCategories.find((c) => c.name.toLowerCase() === category.toLowerCase());
        categoryId = foundActive ? foundActive.id : '';
        barcode = matchedItem.barcode || barcodeRaw || '';
        barcodeType = barcode ? 'MANUFACTURER' : null;
      } else {
        // New Product or Ambiguous: automatically generate unique SKU
        finalSku = generateUniqueSku(name, existingSkusSet, seenImportSkus);
        // Automatically suggest category
        const suggested = suggestCategory(name, activeCategories);
        if (suggested) {
          category = suggested.name;
          categoryId = suggested.id;
        }
        if (barcodeRaw) {
          barcode = barcodeRaw;
          barcodeType = 'MANUFACTURER';
        }
      }

      const natureInfo = classifyProductNature(name, catalogCandidates);

      parsed.push({
        _id: nextId.current++,
        rowNum: startRow++,
        name,
        sku: finalSku,
        isSkuManuallyEdited: false,
        barcode,
        barcodeType,
        isBarcodeAutoGenerated,
        additionalBarcodes: [],
        productNature: natureInfo.nature,
        natureConfidence: natureInfo.confidence,
        isNatureManuallyEdited: false,
        category,
        categoryId,
        isCategoryManuallyEdited: false,
        unit,
        sellingPrice: price,
        costPrice: cost,
        hsn: hsn || (matchedItem?.hsn || ''),
        gstRate: gst || (matchedItem ? `${matchedItem.taxRateBp / 100}%` : '5%'),
        taxInclusive,
        openingStock: stock || '0',
        matchedItem,
        candidates: matchResult.candidates,
        resolution,
        updatePrices: globalUpdatePrices,
      });
    }

    if (parsed.length === 0) {
      setParseError('No valid product rows found in the data.');
      return;
    }

    setRawRows(parsed);
    setBarcodeValidationActive(false);
    setImportSource(sourceLabel);
    setParseError('');
    setFilter('all');
    setStep('review');
  };

  const processFile = useCallback((file: File) => {
    const isExcel = file.name.match(/\.(xlsx|xls)$/i);
    const isCsv = file.name.match(/\.(csv|tsv|txt)$/i);

    if (!isExcel && !isCsv) {
      setParseError('Please upload a CSV (.csv, .tsv, .txt) or Excel (.xlsx, .xls) file.');
      return;
    }

    setFileName(file.name);
    setParseError('');

    if (isExcel) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const buffer = e.target?.result as ArrayBuffer;
          const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', raw: false });
          const firstSheet = wb.SheetNames[0];
          const ws = wb.Sheets[firstSheet];
          const lines = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '', raw: false });
          ingestSupplierData(lines, 'Uploaded Excel');
        } catch (err: any) {
          setParseError(`Failed to parse Excel file: ${err.message || 'Corrupted file'}`);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string;
          const rawLines = text.split(/\r?\n/).filter((l) => l.trim());
          const lines = rawLines.map(parseCsvLine);
          ingestSupplierData(lines, 'Uploaded CSV');
        } catch (err: any) {
          setParseError(`Failed to parse CSV file: ${err.message || 'Invalid format'}`);
        }
      };
      reader.readAsText(file, 'utf-8');
    }
  }, [catalogCandidates, existingSkusSet, activeCategories, globalUpdatePrices]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const handleParsePaste = () => {
    if (!pasteText.trim()) {
      setParseError('Please paste your product data first.');
      return;
    }
    const rawLines = pasteText.split(/\r?\n/).filter((l) => l.trim());
    const lines = rawLines.map(parseCsvLine);
    ingestSupplierData(lines, 'Pasted spreadsheet data');
  };

  const handleStartManual = () => {
    const starterNames = ['Basmati Rice 1kg', 'Toor Dal 1kg', 'Sugar 1kg'];
    const blanks: Omit<GridRow, 'status' | 'errors'>[] = starterNames.map((name, i) => {
      const matchResult = matchProductToCatalog(name, 'kg', catalogCandidates);
      const sku = matchResult.matchedItem?.sku || generateUniqueSku(name, existingSkusSet, new Set());
      const cat = suggestCategory(name, activeCategories);
      const natureInfo = classifyProductNature(name, catalogCandidates);

      return {
        _id: nextId.current++,
        rowNum: i + 2,
        name,
        sku,
        isSkuManuallyEdited: false,
        barcode: '',
        barcodeType: null,
        isBarcodeAutoGenerated: false,
        additionalBarcodes: [],
        productNature: natureInfo.nature,
        natureConfidence: natureInfo.confidence,
        isNatureManuallyEdited: false,
        category: cat ? cat.name : '',
        categoryId: cat ? cat.id : '',
        isCategoryManuallyEdited: false,
        unit: 'kg',
        sellingPrice: '100',
        costPrice: '80',
        hsn: '1006',
        gstRate: '5%',
        taxInclusive: true,
        openingStock: '20',
        matchedItem: matchResult.matchedItem,
        candidates: matchResult.candidates,
        updatePrices: true,
      };
    });

    setRawRows(blanks);
    setBarcodeValidationActive(false);
    setImportSource('Manual entry');
    setFilter('all');
    setStep('review');
  };

  // ── Row edits & interactions ───────────────────────────────────────────────

  const updateRowField = (id: number, field: keyof Omit<GridRow, 'status' | 'errors'>, val: any) => {
    setRawRows((prev) =>
      prev.map((r) => {
        if (r._id !== id) return r;
        const updated = { ...r, [field]: val };
        if (field === 'sku') {
          updated.isSkuManuallyEdited = true;
        }
        if (field === 'barcode') {
          const strVal = String(val || '').trim();
          updated.barcode = strVal;
          updated.isBarcodeAutoGenerated = false;
          updated.barcodeType = strVal.startsWith('20') && strVal.length === 13 ? 'INTERNAL' : (strVal ? 'MANUFACTURER' : null);
          updated.barcodeError = undefined;
        }
        // If product name changed, re-evaluate match, SKU, category, and product nature
        if (field === 'name' && val !== r.name) {
          updated.resolution = null;
          if (!r.isNatureManuallyEdited) {
            const natureInfo = classifyProductNature(val, catalogCandidates);
            updated.productNature = natureInfo.nature;
            updated.natureConfidence = natureInfo.confidence;
          }
          const matchResult = matchProductToCatalog(val, r.unit, catalogCandidates);
          updated.matchedItem = matchResult.matchedItem;
          updated.candidates = matchResult.candidates;
          if (matchResult.matchedItem) {
            updated.sku = matchResult.matchedItem.sku || r.sku;
            if (matchResult.matchedItem.barcode && !r.isBarcodeAutoGenerated) {
              updated.barcode = matchResult.matchedItem.barcode;
              updated.barcodeType = 'MANUFACTURER';
            }
            if (matchResult.matchedItem.category) {
              updated.category = matchResult.matchedItem.category;
              const fCat = activeCategories.find((c) => c.name.toLowerCase() === updated.category.toLowerCase());
              if (fCat) updated.categoryId = fCat.id;
            }
          } else {
            if (!r.isSkuManuallyEdited) {
              updated.sku = generateUniqueShortSku(val, existingSkusSet, new Set());
            }
            if (!r.isCategoryManuallyEdited || !r.categoryId) {
              const cat = suggestCategory(val, activeCategories);
              if (cat) {
                updated.categoryId = cat.id;
                updated.category = cat.name;
              }
            }
          }
        }
        return updated;
      })
    );
  };

  const updateRowCategory = (id: number, catIdOrName: string) => {
    setRawRows((prev) =>
      prev.map((r) => {
        if (r._id !== id) return r;
        const trimmed = (catIdOrName || '').trim();
        const found = activeCategories.find(
          (c) => c.id === trimmed || c.name.toLowerCase() === trimmed.toLowerCase()
        );
        return {
          ...r,
          categoryId: found ? found.id : '',
          category: found ? found.name : '',
          isCategoryManuallyEdited: Boolean(found),
        };
      })
    );
  };

  const linkToCandidate = (rowId: number, candidate: MatchCandidate) => {
    setRawRows((prev) =>
      prev.map((r) => {
        if (r._id !== rowId) return r;
        const candidateCatName = candidate.category || r.category;
        const candidateCat = activeCategories.find(
          (c) => c.name.toLowerCase() === candidateCatName.toLowerCase()
        );
        return {
          ...r,
          resolution: 'LINK' as const,
          matchedItem: candidate,
          sku: candidate.sku || r.sku,
          barcode: candidate.barcode || r.barcode || '',
          barcodeType: candidate.barcode ? 'MANUFACTURER' : r.barcodeType,
          isBarcodeAutoGenerated: false,
          category: candidateCatName,
          categoryId: candidateCat ? candidateCat.id : r.categoryId,
          unit: candidate.unit || r.unit,
        };
      })
    );
  };

  const createAsNewProduct = (rowId: number) => {
    setRawRows((prev) => {
      const seenBarcodes = new Set<string>();
      const seenSkus = new Set<string>();
      for (const r of prev) {
        if (r._id !== rowId) {
          if (r.barcode?.trim()) seenBarcodes.add(r.barcode.trim());
          if (r.sku?.trim()) seenSkus.add(r.sku.trim().toLowerCase());
        }
      }

      return prev.map((r) => {
        if (r._id !== rowId) return r;
        const cat = !r.isCategoryManuallyEdited && r.name ? suggestCategory(r.name, activeCategories) : null;
        let newSku = r.sku;
        if (!r.isSkuManuallyEdited || !newSku) {
          newSku = generateUniqueShortSku(r.name, existingSkusSet, seenSkus);
        }

        let newBarcode = r.barcode;
        let isAuto = r.isBarcodeAutoGenerated;
        let bType = r.barcodeType;
        if ((!newBarcode || !newBarcode.trim() || (r.matchedItem && r.barcodeType !== 'MANUFACTURER')) && r.barcodeType !== 'MANUFACTURER') {
          try {
            newBarcode = generateUniqueInternalBarcode(existingBarcodesSet, seenBarcodes);
            isAuto = true;
            bType = 'INTERNAL';
          } catch {
            // keep existing
          }
        }

        return {
          ...r,
          resolution: 'NEW' as const,
          matchedItem: null,
          sku: newSku,
          barcode: newBarcode,
          barcodeType: bType || (isAuto ? 'INTERNAL' : null),
          isBarcodeAutoGenerated: isAuto,
          categoryId: cat ? cat.id : r.categoryId,
          category: cat ? cat.name : r.category,
        };
      });
    });
  };

  const resetAmbiguityResolution = (rowId: number) => {
    setRawRows((prev) =>
      prev.map((r) => {
        if (r._id !== rowId) return r;
        return {
          ...r,
          resolution: null,
          matchedItem: null,
        };
      })
    );
  };

  const removeRow = (id: number) => {
    setRawRows((prev) => prev.filter((r) => r._id !== id));
  };

  const addEmptyRow = () => {
    const maxRowNum = rawRows.reduce((max, r) => Math.max(max, r.rowNum), 1);
    setRawRows((prev) => [
      ...prev,
      {
        _id: nextId.current++,
        rowNum: maxRowNum + 1,
        name: '',
        sku: '',
        isSkuManuallyEdited: false,
        barcode: '',
        barcodeType: null,
        isBarcodeAutoGenerated: false,
        additionalBarcodes: [],
        productNature: 'BRANDED' as const,
        natureConfidence: 'LOW' as const,
        isNatureManuallyEdited: false,
        category: '',
        categoryId: '',
        isCategoryManuallyEdited: false,
        unit: 'pcs',
        sellingPrice: '',
        costPrice: '',
        hsn: '',
        gstRate: '5%',
        taxInclusive: true,
        openingStock: '0',
        matchedItem: null,
        candidates: [],
        updatePrices: globalUpdatePrices,
      },
    ]);
  };

  const toggleRowProductNature = (rowId: number) => {
    setRawRows((prev) =>
      prev.map((r) => {
        if (r._id !== rowId) return r;
        const newNature: ProductNature = r.productNature === 'BRANDED' ? 'SHOP_PRODUCT' : 'BRANDED';
        return {
          ...r,
          productNature: newNature,
          natureConfidence: 'HIGH' as const,
          isNatureManuallyEdited: true,
        };
      })
    );
  };

  // ── Barcode Generation & Scanning Handlers ────────────────────────────────

  // ── Manufacturer Barcode Scanning (Scan Manufacturer Barcodes Dialog) ─────
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [scanModalInitialId, setScanModalInitialId] = useState<number | null>(null);

  // Targets formatted for ScanManufacturerBarcodeModal
  const barcodeTargets: BarcodeTargetItem[] = useMemo(() => {
    return rawRows.map((r) => ({
      id: r._id,
      rowNum: r.rowNum,
      name: r.name,
      sku: r.sku,
      barcode: r.barcode,
      barcodeType: r.barcodeType,
      category: r.category,
      priceFormatted: (() => {
        const p = r.sellingPrice !== undefined && r.sellingPrice !== null && String(r.sellingPrice).trim() !== '' ? parseFloat(String(r.sellingPrice).replace(/[^0-9.-]/g, '')) : NaN;
        return !isNaN(p) && p >= 0 ? `₹${p.toFixed(2)}` : null;
      })(),
      priceMinor: (() => {
        const p = r.sellingPrice !== undefined && r.sellingPrice !== null && String(r.sellingPrice).trim() !== '' ? parseFloat(String(r.sellingPrice).replace(/[^0-9.-]/g, '')) : NaN;
        return !isNaN(p) && p >= 0 ? Math.round(p * 100) : null;
      })(),
      unit: r.unit,
      scannedInSession: r.scannedInSession,
    }));
  }, [rawRows]);

  // Taken barcodes in store catalog (existingItems)
  const takenCatalogBarcodes = useMemo(() => {
    const map = new Map<string, { name: string; id?: string }>();
    for (const it of existingItems) {
      if (it.barcode && it.barcode.trim()) {
        map.set(it.barcode.trim(), { name: it.name, id: it.id });
      }
    }
    return map;
  }, [existingItems]);

  // Handler for barcode assignment from ScanManufacturerBarcodeModal
  const handleAssignFromScanModal = useCallback(
    (id: number | string, newBarcode: string | null, barcodeType?: 'MANUFACTURER' | 'INTERNAL' | null) => {
      setRawRows((prev) =>
        prev.map((r) => {
          if (r._id !== id) return r;
          const additional = [...(r.additionalBarcodes || [])];
          if (newBarcode && r.barcode && r.barcode !== newBarcode && r.barcodeType === 'INTERNAL') {
            if (!additional.some((ab) => ab.barcode === r.barcode)) {
              additional.push({ barcode: r.barcode, barcodeType: 'INTERNAL' });
            }
          }
          return {
            ...r,
            barcode: newBarcode || '',
            barcodeType: newBarcode ? (barcodeType || 'MANUFACTURER') : null,
            isBarcodeAutoGenerated: false,
            barcodeError: undefined,
            scannedInSession: Boolean(newBarcode),
            additionalBarcodes: additional,
          };
        })
      );
    },
    []
  );

  const handleGenerateBarcodes = useCallback(() => {
    const seenImportBarcodes = new Set<string>();
    // Pre-populate with existing rows that already have barcodes
    for (const r of rawRows) {
      if (r.barcode && r.barcode.trim()) {
        seenImportBarcodes.add(r.barcode.trim());
      }
      if (r.additionalBarcodes) {
        for (const ab of r.additionalBarcodes) {
          if (ab.barcode && ab.barcode.trim()) seenImportBarcodes.add(ab.barcode.trim());
        }
      }
    }

    setRawRows((prev) => {
      let counter = 1;
      return prev.map((r) => {
        // Skip restock products, rows that already have a valid barcode, or manufacturer barcodes
        const isMfr = r.barcodeType === 'MANUFACTURER' || r.scannedInSession || Boolean(r.matchedItem && !r.isBarcodeAutoGenerated);
        if (isMfr || r.matchedItem || (r.barcode && r.barcode.trim())) {
          return r;
        }
        // Exclude unresolved duplicate or ambiguous catalog matches until resolved
        if (r.candidates && r.candidates.length > 1 && !r.resolution) {
          return r;
        }
        try {
          const newCode = generateUniqueInternalBarcode(existingBarcodesSet, seenImportBarcodes, counter++);
          seenImportBarcodes.add(newCode);
          return {
            ...r,
            barcode: newCode,
            barcodeType: 'INTERNAL' as const,
            isBarcodeAutoGenerated: true,
            barcodeError: undefined,
          };
        } catch (err: any) {
          return {
            ...r,
            barcodeError: err?.message || 'Barcode generation failed',
          };
        }
      });
    });
  }, [rawRows, existingBarcodesSet]);

  const handleUndoGeneratedBarcodes = useCallback(() => {
    setBarcodeValidationActive(false);
    setRawRows((prev) =>
      prev.map((r) => {
        if (!r.isBarcodeAutoGenerated) return r;
        return {
          ...r,
          barcode: '',
          barcodeType: null,
          isBarcodeAutoGenerated: false,
          barcodeError: undefined,
        };
      })
    );
  }, []);

  const handleRegenerateSingleBarcode = useCallback((rowId: number) => {
    const row = rawRows.find((r) => r._id === rowId);
    if (!row) return;

    // Never overwrite a manufacturer barcode with an internal barcode
    const isMfr = row.barcodeType === 'MANUFACTURER' || row.scannedInSession || Boolean(row.matchedItem && !row.isBarcodeAutoGenerated);
    if (isMfr) return;

    const seenImportBarcodes = new Set<string>();
    for (const r of rawRows) {
      if (r._id !== rowId && r.barcode && r.barcode.trim()) {
        seenImportBarcodes.add(r.barcode.trim());
      }
    }

    try {
      const newCode = generateUniqueInternalBarcode(existingBarcodesSet, seenImportBarcodes);
      setRawRows((prev) =>
        prev.map((r) => {
          if (r._id !== rowId) return r;
          return {
            ...r,
            barcode: newCode,
            barcodeType: 'INTERNAL' as const,
            isBarcodeAutoGenerated: true,
            barcodeError: undefined,
          };
        })
      );
    } catch (err: any) {
      setRawRows((prev) =>
        prev.map((r) => {
          if (r._id !== rowId) return r;
          return {
            ...r,
            barcodeError: err?.message || 'Regeneration failed',
          };
        })
      );
    }
  }, [rawRows, existingBarcodesSet]);

  const removeAllErrors = () => {
    const errIds = new Set(errorRows.map((r) => r._id));
    setRawRows((prev) => prev.filter((r) => !errIds.has(r._id)));
  };

  const removeAllDuplicates = () => {
    const dupIds = new Set(duplicateRows.map((r) => r._id));
    setRawRows((prev) => prev.filter((r) => !dupIds.has(r._id)));
  };

  // ── Execute Import Submission ──────────────────────────────────────────────

  const handleExecuteImport = async () => {
    if (eligibleRows.length === 0) return;
    const pendingBarcodes = eligibleRows.filter((r) => !r.matchedItem && (!r.barcode || !r.barcode.trim()));
    if (pendingBarcodes.length > 0) {
      setBarcodeValidationActive(true);
      setApiError(`${pendingBarcodes.length} new product(s) have pending barcodes. Please return to Review to generate or scan barcodes.`);
      return;
    }
    setIsSubmitting(true);
    setApiError('');

    try {
      const payloadRows: BulkImportRow[] = eligibleRows.map((r) => {
        const isRestock = r.status === 'RESTOCK' && Boolean(r.matchedItem);
        const price = Math.round(parseFloat(r.sellingPrice) * 100);
        const cost = r.costPrice.trim() ? Math.round(parseFloat(r.costPrice) * 100) : 0;
        const stock = r.openingStock.trim() ? Math.round(parseFloat(r.openingStock) * 1000) : 0;
        const taxRateBp = parseGstToBp(r.gstRate) ?? 500;
        const finalBarcode = r.barcode && r.barcode.trim() ? r.barcode.trim() : null;
        const finalBarcodeType = r.barcodeType || (r.isBarcodeAutoGenerated ? 'INTERNAL' : (finalBarcode ? 'MANUFACTURER' : null));

        let finalCatId = r.categoryId ? r.categoryId.trim() : null;
        let finalCatName = r.category ? r.category.trim() : null;

        if (finalCatId) {
          const matched = activeCategories.find((c) => c.id === finalCatId);
          if (matched) {
            finalCatName = matched.name;
          }
        } else if (finalCatName) {
          const matched = activeCategories.find((c) => c.name.toLowerCase() === finalCatName!.toLowerCase());
          if (matched) {
            finalCatId = matched.id;
            finalCatName = matched.name;
          }
        }

        return {
          name: r.name.trim(),
          sku: r.sku.trim() || null,
          barcode: finalBarcode,
          barcodeType: finalBarcodeType,
          additionalBarcodes: r.additionalBarcodes || [],
          productNature: r.productNature || null,
          hsn: r.hsn.trim() || null,
          unit: r.unit.trim() || 'pcs',
          categoryId: finalCatId,
          category: finalCatName,
          priceMinor: price,
          costMinor: cost,
          taxRateBp,
          taxInclusive: r.taxInclusive,
          openingQtyMilli: stock,
          isRestock,
          matchedItemId: isRestock && r.matchedItem ? r.matchedItem.id : null,
          updatePrices: r.updatePrices,
        };
      });

      const res = await bulkImportItems(payloadRows, importBatchId.current);
      setImportResult(res);
      setStep('results');
    } catch (err: any) {
      setApiError(err.message || 'Import failed. Please review error details.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Download Reports ────────────────────────────────────────────────────────

  const handleDownloadFailedRows = () => {
    const invalidList = [...errorRows, ...duplicateRows, ...ambiguousRows];
    const rows = invalidList.map((r) => [
      r.rowNum,
      r.name,
      r.unit,
      r.sellingPrice,
      r.costPrice,
      r.hsn,
      r.gstRate,
      r.taxInclusive ? 'Yes' : 'No',
      r.openingStock,
      r.status,
      r.errors.map((e) => e.message).join(' | '),
    ]);
    downloadCsv('supplier_import_failed_rows.csv', ['Row #', ...TEMPLATE_COLUMNS, 'Status', 'Reasons'], rows);
  };

  const handleDownloadImportReport = () => {
    if (!importResult) return;
    const reportRows = importResult.results.map((r) => [
      r.rowIndex,
      r.name || '',
      r.status,
      r.itemId || '',
      r.reason || 'Successfully processed',
    ]);
    downloadCsv('bulk_import_summary_report.csv', ['Row #', 'Product Name', 'Status', 'Item ID', 'Details'], reportRows);
  };

  // ── Total inward stock calculation ──────────────────────────────────────────
  const totalInwardStock = useMemo(() => {
    return eligibleRows.reduce((sum, r) => sum + (parseFloat(r.openingStock) || 0), 0);
  }, [eligibleRows]);

  // ── RENDER ──────────────────────────────────────────────────────────────────

  return (
    <>
      <div
        className="modal-overlay"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1300,
          backgroundColor: isScanModalOpen ? 'transparent' : 'rgba(15, 23, 42, 0.65)',
          backdropFilter: isScanModalOpen ? 'none' : 'blur(3px)',
          padding: 'clamp(0.25rem, 0.75vw, 0.5rem)',
          display: isScanModalOpen ? 'none' : 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: isScanModalOpen ? 'none' : 'auto',
        }}
      >
        <div
          className="modal-content"
          style={{
            width: '98vw',
            maxWidth: step === 'choose' ? '1060px' : '98vw',
            height: step === 'choose' ? 'auto' : '96vh',
            maxHeight: '92vh',
            display: isScanModalOpen ? 'none' : 'flex',
            flexDirection: 'column',
            boxShadow: '0 25px 60px -12px rgba(49, 46, 129, 0.35)',
          overflow: 'hidden',
          borderRadius: '16px',
          margin: '0 auto',
          background: '#ffffff',
        }}
      >
        {/* ── HEADER ── */}
        <div
          className="modal-header"
          style={{
            flexShrink: 0,
            padding: '1rem 1.5rem',
            background: '#ffffff',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #6d4aff 0%, #4f46e5 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(109, 74, 255, 0.25)',
                color: '#ffffff',
                flexShrink: 0,
              }}
            >
              <PackageBoxIcon size={22} color="#ffffff" />
            </div>
            <div>
              <h3
                className="card-title"
                style={{
                  margin: 0,
                  fontSize: '1.2rem',
                  fontWeight: 800,
                  color: 'var(--text-main)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.55rem',
                  letterSpacing: '-0.02em',
                }}
              >
                Bulk Product Import
                <span
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    background: 'var(--bg-main)',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    border: '1px solid var(--border)',
                  }}
                >
                  {shopName || 'Supermarket & Retail'}
                </span>
              </h3>
              {/* Modern Step Progression Pills */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  marginTop: '0.35rem',
                  fontSize: '0.8rem',
                }}
              >
                {[
                  { key: 'choose', num: 1, label: 'Choose Data' },
                  { key: 'review', num: 2, label: 'Review & Fix' },
                  { key: 'confirm', num: 3, label: 'Confirm' },
                  { key: 'results', num: 4, label: 'Results' },
                ].map((s, idx, arr) => {
                  const stepOrder = ['choose', 'review', 'confirm', 'results'];
                  const currIdx = stepOrder.indexOf(step);
                  const isCurrent = step === s.key;
                  const isPast = currIdx > idx;

                  return (
                    <React.Fragment key={s.key}>
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          padding: isCurrent ? '0.2rem 0.65rem' : '0.15rem 0.5rem',
                          borderRadius: '12px',
                          background: isCurrent ? 'var(--primary-light)' : (isPast ? '#f0fdf4' : 'transparent'),
                          color: isCurrent ? 'var(--primary)' : (isPast ? '#15803d' : 'var(--text-muted)'),
                          fontWeight: isCurrent ? 700 : (isPast ? 600 : 500),
                          border: isCurrent ? '1px solid var(--primary-light)' : (isPast ? '1px solid #dcfce7' : '1px solid transparent'),
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <span
                          style={{
                            width: 17,
                            height: 17,
                            borderRadius: '50%',
                            background: isCurrent ? 'var(--primary)' : (isPast ? '#16a34a' : '#cbd5e1'),
                            color: '#ffffff',
                            fontSize: '0.65rem',
                            fontWeight: 800,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          {isPast ? <CheckIcon size={10} color="#ffffff" /> : s.num}
                        </span>
                        <span>{s.label}</span>
                      </div>
                      {idx < arr.length - 1 && (
                        <ChevronRightIcon size={12} color="#cbd5e1" />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          </div>
          <button
            id="bulk-import-close-btn"
            style={{
              background: '#f8fafc',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s ease',
            }}
            onClick={onClose}
            disabled={isSubmitting}
            title="Close"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#fee2e2';
              e.currentTarget.style.color = '#ef4444';
              e.currentTarget.style.borderColor = '#fca5a5';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#f8fafc';
              e.currentTarget.style.color = 'var(--text-muted)';
              e.currentTarget.style.borderColor = 'var(--border)';
            }}
          >
            <CloseXIcon size={16} />
          </button>
        </div>

        {/* ── BODY ── */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: step === 'review' ? 'hidden' : 'auto',
            display: 'flex',
            flexDirection: 'column',
            padding: step === 'review' ? '0.75rem 1.25rem' : '1.5rem',
            background: '#ffffff',
          }}
        >
          {/* Inject micro styles for animations and focus */}
          <style>{`
            @keyframes bulkSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            .bulk-spin { animation: bulkSpin 0.9s linear infinite; }
            .bulk-table-input:focus {
              border-color: #6366f1 !important;
              box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.18) !important;
              outline: none !important;
            }
          `}</style>

          {/* ══════════════════════════════════════════════════════════════════════
              STEP 1: CHOOSE DATA (8-COLUMN SUPPLIER FORMAT)
             ══════════════════════════════════════════════════════════════════════ */}
          {step === 'choose' && (
            <div className="bulk-bento-container">
              {/* Method Navigation Segmented Pills */}
              <div className="bulk-method-nav">
                <button
                  id="bulk-tab-upload"
                  onClick={() => { setActiveTab('upload'); setParseError(''); }}
                  className={`bulk-method-pill ${activeTab === 'upload' ? 'active' : ''}`}
                >
                  <UploadCloudIcon size={16} color={activeTab === 'upload' ? 'var(--primary)' : 'var(--text-muted)'} />
                  <span>Upload File (Excel / CSV)</span>
                  {activeTab === 'upload' && <span className="bulk-method-dot"></span>}
                </button>
                <button
                  id="bulk-tab-paste"
                  onClick={() => { setActiveTab('paste'); setParseError(''); }}
                  className={`bulk-method-pill ${activeTab === 'paste' ? 'active' : ''}`}
                >
                  <ClipboardPasteIcon size={16} color={activeTab === 'paste' ? 'var(--primary)' : 'var(--text-muted)'} />
                  <span>Paste Spreadsheet Data</span>
                  {activeTab === 'paste' && <span className="bulk-method-dot"></span>}
                </button>
                <button
                  id="bulk-tab-manual"
                  onClick={() => { setActiveTab('manual'); setParseError(''); }}
                  className={`bulk-method-pill ${activeTab === 'manual' ? 'active' : ''}`}
                >
                  <Edit3Icon size={16} color={activeTab === 'manual' ? 'var(--primary)' : 'var(--text-muted)'} />
                  <span>Enter Data Manually</span>
                  {activeTab === 'manual' && <span className="bulk-method-dot"></span>}
                </button>
              </div>

              {/* TAB A: UPLOAD FILE BENTO GRID */}
              {activeTab === 'upload' && (
                <div className="bulk-bento-grid">
                  {/* LEFT BENTO TILE: Interactive Hero Dropzone */}
                  <div
                    id="bulk-drop-zone"
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`bulk-bento-hero-dropzone ${isDragging ? 'dragging' : ''}`}
                  >
                    <div className="bulk-drop-icon-squircle">
                      <UploadCloudIcon size={26} color="#4f46e5" />
                    </div>

                    <div className="bulk-bento-hero-title">
                      {fileName ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', color: '#16a34a' }}>
                          <CheckCircleIcon size={18} color="#16a34a" />
                          <span>File Ready: {fileName}</span>
                        </span>
                      ) : (
                        <span>Drop supplier CSV or Excel file here</span>
                      )}
                    </div>

                    <div className="bulk-bento-hero-subtitle">
                      {fileName
                        ? 'Click browse to select a different file or continue to review.'
                        : 'Drag & drop your catalog spreadsheet or click browse to upload from your device'}
                    </div>

                    <button
                      type="button"
                      className="bulk-bento-browse-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        fileInputRef.current?.click();
                      }}
                    >
                      <UploadCloudIcon size={14} color="#ffffff" />
                      <span>{fileName ? 'Choose Another File' : 'Browse Computer'}</span>
                    </button>

                    <div className="bulk-format-tags">
                      <span className="bulk-format-tag">.XLSX</span>
                      <span className="bulk-format-tag">.XLS</span>
                      <span className="bulk-format-tag">.CSV</span>
                      <span className="bulk-format-tag">.TSV</span>
                      <span className="bulk-format-tag">.TXT</span>
                    </div>

                    <input
                      ref={fileInputRef}
                      id="bulk-file-input"
                      type="file"
                      accept=".csv,.xlsx,.xls,.tsv,.txt"
                      style={{ display: 'none' }}
                      onChange={handleFileChange}
                    />
                  </div>

                  {/* RIGHT BENTO COLUMN: Templates + Format Specs */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                    {/* BENTO CARD 1: Official Templates */}
                    <div className="bulk-bento-card">
                      <div className="bulk-bento-header-row">
                        <div className="bulk-bento-header-left">
                          <div className="bulk-bento-badge-icon indigo">
                            <FileSpreadsheetIcon size={15} />
                          </div>
                          <span className="bulk-bento-card-title">Official Import Templates</span>
                        </div>
                        <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '0.1rem 0.45rem', borderRadius: '4px', background: '#dcfce7', color: '#15803d' }}>
                          Recommended
                        </span>
                      </div>
                      <div className="bulk-bento-card-desc">
                        Pre-formatted files with sample supermarket items for instant catalog upload.
                      </div>

                      <div className="bulk-template-grid">
                        <div
                          className="bulk-template-tile"
                          id="bulk-download-excel-template"
                          onClick={downloadExcelTemplate}
                          title="Download Excel (.xlsx) Template with sample items"
                        >
                          <div className="bulk-template-icon-squircle excel">
                            <FileSpreadsheetIcon size={16} color="#16a34a" />
                          </div>
                          <div className="bulk-template-info">
                            <span className="bulk-template-name">Excel Template</span>
                            <span className="bulk-template-sub">.xlsx format</span>
                          </div>
                          <div className="bulk-template-download-btn">
                            <DownloadIcon size={13} />
                          </div>
                        </div>

                        <div
                          className="bulk-template-tile"
                          id="bulk-download-csv-template"
                          onClick={() => downloadCsv('supplier_product_template.csv', TEMPLATE_COLUMNS, SAMPLE_SUPPLIER_ROWS)}
                          title="Download CSV Template with sample items"
                        >
                          <div className="bulk-template-icon-squircle csv">
                            <FileSpreadsheetIcon size={16} color="#2563eb" />
                          </div>
                          <div className="bulk-template-info">
                            <span className="bulk-template-name">CSV Template</span>
                            <span className="bulk-template-sub">.csv format</span>
                          </div>
                          <div className="bulk-template-download-btn">
                            <DownloadIcon size={13} />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* BENTO CARD 2: Simplified 8-Column Format Specs */}
                    <div className="bulk-bento-card">
                      <div className="bulk-bento-header-row">
                        <div className="bulk-bento-header-left">
                          <div className="bulk-bento-badge-icon purple">
                            <SparklesIcon size={15} color="var(--primary)" />
                          </div>
                          <span className="bulk-bento-card-title">Simplified 8-Column Format</span>
                        </div>
                        <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '0.1rem 0.45rem', borderRadius: '4px', background: '#f5f3ff', color: 'var(--primary)', border: '1px solid #ede9fe' }}>
                          Smart Auto-Fill
                        </span>
                      </div>
                      <div className="bulk-bento-card-desc">
                        SKU, Barcode & Category are auto-generated. Only 8 columns needed:
                      </div>

                      <div className="bulk-columns-spec-grid">
                        {TEMPLATE_COLUMNS.map((c, i) => (
                          <div
                            key={c}
                            className={`bulk-column-pill ${i === 0 || i === 2 ? 'required' : ''}`}
                            title={i === 0 || i === 2 ? `${c} is mandatory` : `${c} optional/auto-filled`}
                          >
                            <span>{c}</span>
                            {i === 0 || i === 2 && <span className="bulk-col-req-badge">Req</span>}
                          </div>
                        ))}
                      </div>

                      <div className="bulk-bento-ai-footer">
                        <SparklesIcon size={14} color="#6d4aff" />
                        <span>Detects existing items and restocks shelf quantity without duplicate products.</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB B: PASTE SPREADSHEET DATA BENTO GRID */}
              {activeTab === 'paste' && (
                <div className="bulk-bento-grid">
                  <div className="bulk-bento-card" style={{ gap: '0.75rem' }}>
                    <div className="bulk-bento-header-row">
                      <div className="bulk-bento-header-left">
                        <div className="bulk-bento-badge-icon purple">
                          <ClipboardPasteIcon size={15} color="var(--primary)" />
                        </div>
                        <span className="bulk-bento-card-title">Paste Tabular Data</span>
                      </div>
                      <button
                        onClick={() => setPasteText(SAMPLE_SUPPLIER_ROWS.map((r) => r.join('\t')).join('\n'))}
                        className="btn btn-secondary"
                        style={{ fontSize: '0.76rem', padding: '0.25rem 0.65rem' }}
                      >
                        Insert Sample Data
                      </button>
                    </div>

                    <textarea
                      id="bulk-paste-area"
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      placeholder={'Product Name\tUOM\tSelling Price\tCost Price\tHSN\tGST Rate\tPrice Inclusive of GST\tOpening Stock\nToor Dal 1kg\tkg\t145.50\t120\t0713\t5%\tYes\t50\nBasmati Rice 1kg\tkg\t89\t65\t1006\t5%\tYes\t100'}
                      style={{
                        width: '100%', minHeight: '190px', padding: '0.75rem',
                        borderRadius: '8px', border: '1px solid var(--border)',
                        background: '#f8fafc', color: 'var(--text-main)',
                        fontSize: '0.82rem', fontFamily: 'monospace',
                        resize: 'none', boxSizing: 'border-box',
                      }}
                    />

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <button
                        id="bulk-parse-paste-btn"
                        onClick={handleParsePaste}
                        className="btn btn-primary"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', padding: '0.5rem 1.25rem', fontSize: '0.85rem' }}
                      >
                        <span>Parse &amp; Review Data</span>
                        <ArrowRightIcon size={14} />
                      </button>
                      {pasteText && (
                        <button
                          type="button"
                          onClick={() => setPasteText('')}
                          className="btn btn-secondary"
                          style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem' }}
                        >
                          Clear Text
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="bulk-bento-card" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <div className="bulk-bento-header-row">
                        <div className="bulk-bento-header-left">
                          <div className="bulk-bento-badge-icon indigo">
                            <SparklesIcon size={15} />
                          </div>
                          <span className="bulk-bento-card-title">Expected Column Order</span>
                        </div>
                      </div>
                      <div className="bulk-bento-card-desc">
                        Copy all 8 columns from Excel or Google Sheets and paste them on the left:
                      </div>

                      <div className="bulk-columns-spec-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                        {TEMPLATE_COLUMNS.map((c, i) => (
                          <div
                            key={c}
                            className={`bulk-column-pill ${i === 0 || i === 2 ? 'required' : ''}`}
                          >
                            <span>{i + 1}. {c}</span>
                            {i === 0 || i === 2 && <span className="bulk-col-req-badge">Req</span>}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="bulk-bento-ai-footer">
                      <SparklesIcon size={14} color="#6d4aff" />
                      <span>Tab-separated rows from clipboard are automatically parsed into individual product fields.</span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB C: MANUAL ENTRY BENTO GRID */}
              {activeTab === 'manual' && (
                <div className="bulk-bento-grid">
                  <div className="bulk-bento-card" style={{ gap: '0.85rem' }}>
                    <div className="bulk-bento-header-row">
                      <div className="bulk-bento-header-left">
                        <div className="bulk-bento-badge-icon purple">
                          <Edit3Icon size={15} color="var(--primary)" />
                        </div>
                        <span className="bulk-bento-card-title">Interactive Smart Grid</span>
                      </div>
                      <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '0.1rem 0.45rem', borderRadius: '4px', background: '#dcfce7', color: '#15803d' }}>
                        Live AI Validation
                      </span>
                    </div>

                    <div style={{ fontSize: '0.86rem', color: 'var(--text-main)', fontWeight: 600 }}>
                      Type products directly with automatic barcode and category suggestions
                    </div>

                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      The Smart Grid allows you to enter products like a spreadsheet with real-time SKU generation, conflict resolution, EAN-13 barcode generation, and duplicate checking.
                    </div>

                    <button
                      id="bulk-start-manual-btn"
                      onClick={handleStartManual}
                      className="btn btn-primary"
                      style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: '0.45rem', padding: '0.55rem 1.25rem', marginTop: 'auto' }}
                    >
                      <span>Open Interactive Smart Grid</span>
                      <ArrowRightIcon size={14} />
                    </button>
                  </div>

                  <div className="bulk-bento-card" style={{ justifyContent: 'space-between' }}>
                    <div>
                      <div className="bulk-bento-header-row">
                        <div className="bulk-bento-header-left">
                          <div className="bulk-bento-badge-icon indigo">
                            <SparklesIcon size={15} />
                          </div>
                          <span className="bulk-bento-card-title">Automated Features</span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.25rem' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.45rem', fontSize: '0.78rem' }}>
                          <CheckCircleIcon size={15} color="#16a34a" />
                          <span style={{ color: 'var(--text-main)' }}><strong>Unique Short SKUs:</strong> Auto-generated based on item name.</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.45rem', fontSize: '0.78rem' }}>
                          <CheckCircleIcon size={15} color="#16a34a" />
                          <span style={{ color: 'var(--text-main)' }}><strong>Internal Barcodes:</strong> Standard EAN-13 check-digit barcodes.</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.45rem', fontSize: '0.78rem' }}>
                          <CheckCircleIcon size={15} color="#16a34a" />
                          <span style={{ color: 'var(--text-main)' }}><strong>Category Suggestions:</strong> Matches against existing shop departments.</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.45rem', fontSize: '0.78rem' }}>
                          <CheckCircleIcon size={15} color="#16a34a" />
                          <span style={{ color: 'var(--text-main)' }}><strong>Restock Match:</strong> Detects existing items and updates quantity safely.</span>
                        </div>
                      </div>
                    </div>

                    <div className="bulk-bento-ai-footer">
                      <SparklesIcon size={14} color="#6d4aff" />
                      <span>Ready to add up to 500 items in a single transaction.</span>
                    </div>
                  </div>
                </div>
              )}

              {parseError && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.65rem 0.85rem',
                    borderRadius: '8px',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#b91c1c',
                    fontSize: '0.82rem',
                    fontWeight: 500,
                  }}
                >
                  <AlertTriangleIcon size={16} color="#dc2626" />
                  <span>{parseError}</span>
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════
              STEP 2: REVIEW & FIX — MAIN INTERACTIVE PREVIEW
             ══════════════════════════════════════════════════════════════════════ */}
          {step === 'review' && (
            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '0.55rem',
                overflow: 'hidden',
              }}
            >
              {/* TOP SUMMARY FILTER BAR */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.65rem', flexShrink: 0, padding: '0.2rem 0' }}>
                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    id="bulk-filter-all"
                    onClick={() => setFilter('all')}
                    style={{
                      padding: '0.35rem 0.75rem', borderRadius: '20px',
                      border: filter === 'all' ? '1.5px solid var(--primary)' : '1px solid var(--border)',
                      background: filter === 'all' ? 'var(--primary-light)' : '#ffffff',
                      color: filter === 'all' ? 'var(--primary)' : 'var(--text-main)',
                      fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                      transition: 'all 0.15s ease',
                      boxShadow: filter === 'all' ? '0 1px 4px rgba(109,74,255,0.15)' : 'none',
                    }}
                  >
                    <LayersIcon size={13} color={filter === 'all' ? 'var(--primary)' : '#64748b'} />
                    <span>All Rows</span>
                    <span style={{
                      padding: '1px 6px', borderRadius: '10px',
                      background: filter === 'all' ? 'var(--primary)' : '#f1f5f9',
                      color: filter === 'all' ? '#ffffff' : '#475569',
                      fontSize: '0.72rem', fontWeight: 700,
                    }}>
                      {validatedRows.length}
                    </span>
                  </button>
                  <button
                    id="bulk-filter-new"
                    onClick={() => setFilter('new')}
                    style={{
                      padding: '0.35rem 0.75rem', borderRadius: '20px',
                      border: filter === 'new' ? '1.5px solid #6366f1' : '1px solid #e0e7ff',
                      background: filter === 'new' ? '#eef2ff' : '#f8faff',
                      color: '#4338ca',
                      fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                      transition: 'all 0.15s ease',
                      boxShadow: filter === 'new' ? '0 1px 4px rgba(99,102,241,0.2)' : 'none',
                    }}
                  >
                    <SparklesIcon size={13} color="#4338ca" />
                    <span>New Products</span>
                    <span style={{
                      padding: '1px 6px', borderRadius: '10px',
                      background: filter === 'new' ? '#4338ca' : '#e0e7ff',
                      color: filter === 'new' ? '#ffffff' : '#4338ca',
                      fontSize: '0.72rem', fontWeight: 700,
                    }}>
                      {newRows.length}
                    </span>
                  </button>
                  <button
                    id="bulk-filter-restock"
                    onClick={() => setFilter('restock')}
                    style={{
                      padding: '0.35rem 0.75rem', borderRadius: '20px',
                      border: filter === 'restock' ? '1.5px solid #16a34a' : '1px solid #bbf7d0',
                      background: filter === 'restock' ? '#dcfce7' : '#f0fdf4',
                      color: '#15803d',
                      fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                      transition: 'all 0.15s ease',
                      boxShadow: filter === 'restock' ? '0 1px 4px rgba(22,163,74,0.2)' : 'none',
                    }}
                  >
                    <RefreshCwIcon size={12} color="#15803d" />
                    <span>Restocks</span>
                    <span style={{
                      padding: '1px 6px', borderRadius: '10px',
                      background: filter === 'restock' ? '#15803d' : '#dcfce7',
                      color: filter === 'restock' ? '#ffffff' : '#15803d',
                      fontSize: '0.72rem', fontWeight: 700,
                    }}>
                      {restockRows.length}
                    </span>
                  </button>
                  {ambiguousRows.length > 0 && (
                    <button
                      id="bulk-filter-ambiguous"
                      onClick={() => setFilter('ambiguous')}
                      style={{
                        padding: '0.35rem 0.75rem', borderRadius: '20px',
                        border: filter === 'ambiguous' ? '1.5px solid #d97706' : '1px solid #fde68a',
                        background: filter === 'ambiguous' ? '#fef3c7' : '#fffbeb',
                        color: '#b45309',
                        fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <AlertTriangleIcon size={13} color="#b45309" />
                      <span>Needs Review</span>
                      <span style={{
                        padding: '1px 6px', borderRadius: '10px',
                        background: filter === 'ambiguous' ? '#b45309' : '#fde68a',
                        color: filter === 'ambiguous' ? '#ffffff' : '#b45309',
                        fontSize: '0.72rem', fontWeight: 700,
                      }}>
                        {ambiguousRows.length}
                      </span>
                    </button>
                  )}
                  {duplicateRows.length > 0 && (
                    <button
                      id="bulk-filter-duplicate"
                      onClick={() => setFilter('duplicate')}
                      style={{
                        padding: '0.35rem 0.75rem', borderRadius: '20px',
                        border: filter === 'duplicate' ? '1.5px solid #ea580c' : '1px solid #fed7aa',
                        background: filter === 'duplicate' ? '#ffedd5' : '#fff7ed',
                        color: '#c2410c',
                        fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <CopyIcon size={13} color="#c2410c" />
                      <span>Duplicate Rows</span>
                      <span style={{
                        padding: '1px 6px', borderRadius: '10px',
                        background: filter === 'duplicate' ? '#c2410c' : '#fed7aa',
                        color: filter === 'duplicate' ? '#ffffff' : '#c2410c',
                        fontSize: '0.72rem', fontWeight: 700,
                      }}>
                        {duplicateRows.length}
                      </span>
                    </button>
                  )}
                  {errorRows.length > 0 && (
                    <button
                      id="bulk-filter-error"
                      onClick={() => setFilter('error')}
                      style={{
                        padding: '0.35rem 0.75rem', borderRadius: '20px',
                        border: filter === 'error' ? '1.5px solid #dc2626' : '1px solid #fecaca',
                        background: filter === 'error' ? '#fee2e2' : '#fef2f2',
                        color: '#b91c1c',
                        fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <AlertCircleIcon size={13} color="#b91c1c" />
                      <span>Errors</span>
                      <span style={{
                        padding: '1px 6px', borderRadius: '10px',
                        background: filter === 'error' ? '#b91c1c' : '#fecaca',
                        color: filter === 'error' ? '#ffffff' : '#b91c1c',
                        fontSize: '0.72rem', fontWeight: 700,
                      }}>
                        {errorRows.length}
                      </span>
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                  <button
                    id="bulk-refresh-cats-btn"
                    type="button"
                    onClick={() => loadCategoriesFromDb(true)}
                    disabled={isRefreshingCats}
                    className="btn btn-secondary"
                    style={{
                      fontSize: '0.78rem',
                      padding: '0.35rem 0.75rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      borderRadius: '8px',
                    }}
                    title="Reload latest categories from the database and re-apply suggestions"
                  >
                    <RefreshCwIcon size={13} color="#475569" spinning={isRefreshingCats} />
                    <span>{isRefreshingCats ? 'Loading...' : 'Refresh Categories'}</span>
                  </button>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.45rem', cursor: 'pointer', fontWeight: 600, color: 'var(--text-main)' }}>
                    <input
                      type="checkbox"
                      checked={globalUpdatePrices}
                      onChange={(e) => {
                        setGlobalUpdatePrices(e.target.checked);
                        setRawRows((prev) => prev.map((r) => ({ ...r, updatePrices: e.target.checked })));
                      }}
                      style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
                    />
                    Update prices on restock
                  </label>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    <FileSpreadsheetIcon size={13} color="#64748b" />
                    <span>Source: <strong>{importSource}</strong></span>
                  </span>
                </div>
              </div>

              {/* AMBIGUOUS MATCH NOTIFICATION BANNER */}
              {ambiguousRows.length > 0 && (
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '0.55rem 0.9rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, gap: '0.75rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <AlertTriangleIcon size={18} color="#b45309" />
                    <div>
                      <span style={{ fontWeight: 700, color: '#b45309', fontSize: '0.84rem' }}>
                        {ambiguousRows.length} product{ambiguousRows.length !== 1 ? 's have' : ' has'} multiple possible catalog matches
                      </span>
                      <div style={{ fontSize: '0.76rem', color: '#92400e', marginTop: '1px' }}>
                        Please select whether to link to an existing variant or create as a new product in the table below.
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setFilter('ambiguous')}
                    className="btn btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.65rem', borderColor: '#f59e0b', color: '#b45309', flexShrink: 0 }}
                  >
                    View Ambiguous Rows ({ambiguousRows.length})
                  </button>
                </div>
              )}

              {/* ── BARCODE WORKFLOW SELECTOR & BULK CONTROLS ── */}
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '0.5rem 0.9rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.75rem',
                  flexWrap: 'wrap',
                  flexShrink: 0,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <button
                    id="bulk-generate-barcodes-btn"
                    data-testid="bulk-workflow-generate-btn"
                    type="button"
                    onClick={handleGenerateBarcodes}
                    style={{
                      padding: '0.45rem 1.05rem',
                      borderRadius: '20px',
                      border: 'none',
                      background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                      color: '#ffffff',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      boxShadow: '0 2px 8px rgba(99, 102, 241, 0.35)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <BarcodeIcon size={14} color="#ffffff" />
                    <span>Generate Internal Barcodes</span>
                  </button>

                  <button
                    id="bulk-scan-manufacturer-barcodes-btn"
                    data-testid="bulk-workflow-scan-btn"
                    type="button"
                    onClick={() => {
                      setScanModalInitialId(null);
                      setIsScanModalOpen(true);
                    }}
                    style={{
                      padding: '0.45rem 1.05rem',
                      borderRadius: '20px',
                      border: '1.5px solid #0d9488',
                      background: '#f0fdfa',
                      color: '#0f766e',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      boxShadow: '0 1px 4px rgba(13, 148, 136, 0.12)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <CameraIcon size={14} color="#0f766e" />
                    <span>Scan Manufacturer Barcodes</span>
                  </button>

                  {generatedBarcodesCount > 0 && (
                    <button
                      id="bulk-undo-barcodes-btn"
                      type="button"
                      onClick={handleUndoGeneratedBarcodes}
                      style={{
                        padding: '0.4rem 0.9rem',
                        borderRadius: '20px',
                        border: '1.5px solid #c7d2fe',
                        background: '#ffffff',
                        color: '#4338ca',
                        fontWeight: 700,
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                      }}
                    >
                      <RotateCcwIcon size={13} color="#4338ca" />
                      <span>Undo {generatedBarcodesCount} generated</span>
                    </button>
                  )}

                  <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                    {generatedBarcodesCount > 0
                      ? `${generatedBarcodesCount} internal barcode${generatedBarcodesCount !== 1 ? 's' : ''} generated.`
                      : 'Generate internal EAN-13 codes or scan manufacturer barcodes.'}
                  </div>
                </div>
              </div>

              {/* EDITABLE PRODUCT TABLE */}
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflow: 'auto',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  background: '#ffffff',
                }}
              >
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                  <thead style={{ position: 'sticky', top: 0, zIndex: 5, background: '#f8f7ff' }}>
                    <tr>
                      <th style={thStyle}>ROW</th>
                      <th style={thStyle}>STATUS</th>
                      <th style={{ ...thStyle, minWidth: 200 }}>PRODUCT / ITEM NAME *</th>
                      <th style={{ ...thStyle, width: 105, minWidth: 95 }}>SKU / CODE</th>
                      <th style={{ ...thStyle, width: 145, minWidth: 140 }}>BARCODE / EAN</th>
                      <th style={{ ...thStyle, minWidth: 140 }}>CATEGORY *</th>
                      <th style={{ ...thStyle, minWidth: 110 }}>UOM</th>
                      <th style={{ ...thStyle, minWidth: 95 }}>SELLING ₹ *</th>
                      <th style={{ ...thStyle, minWidth: 85 }}>COST ₹</th>
                      <th style={{ ...thStyle, minWidth: 75 }}>HSN</th>
                      <th style={{ ...thStyle, minWidth: 75 }}>GST</th>
                      <th style={{ ...thStyle, minWidth: 45, textAlign: 'center' }}>INCL.</th>
                      <th style={{ ...thStyle, minWidth: 80 }}>INCOMING</th>
                      <th style={{ ...thStyle, minWidth: 80 }}>CURRENT</th>
                      <th style={{ ...thStyle, minWidth: 80 }}>FINAL STOCK</th>
                      <th style={{ ...thStyle, width: 35 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.length === 0 ? (
                      <tr>
                        <td colSpan={16} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                          No rows match the selected &quot;{filter}&quot; filter.
                        </td>
                      </tr>
                    ) : (
                      visibleRows.map((row) => {
                        const incomingStock = parseFloat(row.openingStock) || 0;
                        const existingStock = row.matchedItem ? row.matchedItem.currentStockMilli / 1000 : 0;
                        const finalStock = existingStock + incomingStock;

                        const hasNameErr = row.errors.some((e) => e.field === 'name');
                        const hasPriceErr = row.errors.some((e) => e.field === 'sellingPrice');
                        const isSkuDup = row.errors.some((e) => e.field === 'sku' && e.isDuplicate);
                        const hasSkuErr = row.errors.some((e) => e.field === 'sku');
                        const hasBarcodeErr = row.errors.some((e) => e.field === 'barcode');
                        const isBarcodeDup = row.errors.some((e) => e.field === 'barcode' && e.isDuplicate);
                        const hasCatErr = row.errors.some((e) => e.field === 'category');

                        const barcodeTrim = (row.barcode || '').trim();
                        const hasBarcode = Boolean(barcodeTrim);
                        const isMbc = hasBarcode && (
                          row.barcodeType === 'MANUFACTURER' ||
                          row.scannedInSession ||
                          Boolean(row.matchedItem && !row.isBarcodeAutoGenerated) ||
                          (!row.isBarcodeAutoGenerated && !(barcodeTrim.startsWith('20') && barcodeTrim.length === 13) && row.barcodeType !== 'INTERNAL')
                        );
                        const isIbc = hasBarcode && !isMbc;

                        return (
                          <React.Fragment key={row._id}>
                            <tr
                              style={{
                                borderBottom: row.errors.length > 0 || row.matchedItem || (row.candidates && row.candidates.length > 1) ? 'none' : '1px solid var(--border)',
                                background: '#ffffff',
                              }}
                            >
                              {/* ROW # */}
                              <td style={{ padding: '0.45rem 0.6rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                                {row.rowNum}
                              </td>

                              {/* STATUS BADGE */}
                              <td style={{ padding: '0.45rem 0.5rem' }}>
                                {row.status === 'NEW_PRODUCT' && (
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '0.2rem 0.55rem', borderRadius: '12px', background: '#eef2ff', border: '1px solid #c7d2fe', color: '#4338ca', fontWeight: 700, fontSize: '0.72rem' }}>
                                    <SparklesIcon size={11} color="#4338ca" />
                                    <span>New Product</span>
                                  </span>
                                )}
                                {row.status === 'RESTOCK' && (
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '0.2rem 0.55rem', borderRadius: '12px', background: '#dcfce7', border: '1px solid #bbf7d0', color: '#15803d', fontWeight: 700, fontSize: '0.72rem' }}>
                                    <RefreshCwIcon size={11} color="#15803d" />
                                    <span>Restock</span>
                                  </span>
                                )}
                                {row.status === 'AMBIGUOUS' && (
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '0.2rem 0.55rem', borderRadius: '12px', background: '#fef3c7', border: '1px solid #fde68a', color: '#b45309', fontWeight: 700, fontSize: '0.72rem' }}>
                                    <AlertTriangleIcon size={11} color="#b45309" />
                                    <span>Needs Review</span>
                                  </span>
                                )}
                                {row.status === 'DUPLICATE' && (
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '0.2rem 0.55rem', borderRadius: '12px', background: '#ffedd5', border: '1px solid #fed7aa', color: '#c2410c', fontWeight: 700, fontSize: '0.72rem' }}>
                                    <CopyIcon size={11} color="#c2410c" />
                                    <span>Duplicate</span>
                                  </span>
                                )}
                                {row.status === 'ERROR' && (
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '0.2rem 0.55rem', borderRadius: '12px', background: '#fee2e2', border: '1px solid #fecaca', color: '#b91c1c', fontWeight: 700, fontSize: '0.72rem' }}>
                                    <AlertCircleIcon size={11} color="#b91c1c" />
                                    <span>Error</span>
                                  </span>
                                )}
                              </td>

                              {/* PRODUCT NAME */}
                              <td style={{ padding: '0.45rem 0.35rem' }}>
                                <input
                                  type="text"
                                  value={row.name}
                                  placeholder="Product name"
                                  onChange={(e) => updateRowField(row._id, 'name', e.target.value)}
                                  style={{
                                    ...cellInputStyle,
                                    borderColor: hasNameErr ? '#ef4444' : undefined,
                                    background: hasNameErr ? '#fff1f2' : '#ffffff',
                                  }}
                                />
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '3px' }}>
                                  <button
                                    type="button"
                                    onClick={() => toggleRowProductNature(row._id)}
                                    title={`Classification: ${row.productNature === 'BRANDED' ? 'Branded Product' : 'Shop Product'} (click to change)`}
                                    style={{
                                      cursor: 'pointer',
                                      borderRadius: '8px',
                                      padding: '1px 6px',
                                      fontSize: '0.67rem',
                                      fontWeight: 700,
                                      background: row.productNature === 'BRANDED' ? '#eff6ff' : '#f8fafc',
                                      color: row.productNature === 'BRANDED' ? '#1d4ed8' : '#475569',
                                      border: row.productNature === 'BRANDED'
                                        ? (row.natureConfidence === 'LOW' ? '1px dashed #93c5fd' : '1px solid #bfdbfe')
                                        : (row.natureConfidence === 'LOW' ? '1px dashed #cbd5e1' : '1px solid #cbd5e1'),
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                      transition: 'all 0.15s ease',
                                    }}
                                  >
                                    {row.productNature === 'BRANDED' ? (
                                      <>
                                        <TagIcon size={11} color="#1d4ed8" />
                                        <span>Branded</span>
                                      </>
                                    ) : (
                                      <>
                                        <StoreIcon size={11} color="#475569" />
                                        <span>Shop</span>
                                      </>
                                    )}
                                    {row.natureConfidence === 'LOW' && (
                                      <span style={{ fontSize: '0.62rem', opacity: 0.75 }}>?</span>
                                    )}
                                  </button>
                                </div>
                              </td>

                              {/* GENERATED / EDITABLE COMPACT SKU */}
                              <td style={{ padding: '0.45rem 0.35rem' }}>
                                <input
                                  type="text"
                                  value={row.sku}
                                  placeholder="Auto SKU"
                                  onChange={(e) => updateRowField(row._id, 'sku', e.target.value.toUpperCase().replace(/\s+/g, '-'))}
                                  style={{
                                    ...cellInputStyle,
                                    width: '100px',
                                    padding: '0.3rem 0.4rem',
                                    fontSize: '0.74rem',
                                    fontWeight: 700,
                                    fontFamily: 'monospace',
                                    letterSpacing: '0.03em',
                                    textTransform: 'uppercase',
                                    borderColor: isSkuDup ? '#f59e0b' : (hasSkuErr ? '#ef4444' : undefined),
                                    background: isSkuDup ? '#fffbeb' : (hasSkuErr ? '#fff1f2' : '#ffffff'),
                                  }}
                                  title={row.matchedItem ? 'Preserving existing product SKU' : 'Auto-generated compact SKU (editable)'}
                                />
                              </td>

                              {/* BARCODE / EAN */}
                              <td style={{ padding: '0.45rem 0.35rem', minWidth: 145, maxWidth: 175 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    {(() => {
                                      if (!hasBarcode) {
                                        return (
                                          <span
                                            style={{
                                              fontSize: '0.65rem',
                                              fontWeight: 700,
                                              padding: '1px 5px',
                                              borderRadius: '4px',
                                              background: '#fef3c7',
                                              color: '#92400e',
                                              border: '1px solid #fde68a',
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '3px',
                                            }}
                                            title="Pending: Will be auto-generated or scanned"
                                          >
                                            <BarcodeIcon size={10} color="#b45309" />
                                            <span>Pending EAN</span>
                                          </span>
                                        );
                                      }
                                      if (isMbc) {
                                        return (
                                          <span
                                            style={{
                                              fontSize: '0.65rem',
                                              fontWeight: 800,
                                              padding: '1px 5px',
                                              borderRadius: '4px',
                                              background: '#ccfbf1',
                                              color: '#0f766e',
                                              border: '1px solid #99f6e4',
                                              display: 'inline-flex',
                                              alignItems: 'center',
                                              gap: '3px',
                                            }}
                                            title="Manufacturer Barcode (MBC)"
                                          >
                                            <CameraIcon size={10} color="#0f766e" />
                                            <span>MBC</span>
                                          </span>
                                        );
                                      }
                                      return (
                                        <span
                                          style={{
                                            fontSize: '0.65rem',
                                            fontWeight: 800,
                                            padding: '1px 5px',
                                            borderRadius: '4px',
                                            background: '#f3e8ff',
                                            color: '#7e22ce',
                                            border: '1px solid #e9d5ff',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '3px',
                                          }}
                                          title="Internal Barcode (IBC)"
                                        >
                                          <BarcodeIcon size={10} color="#7e22ce" />
                                          <span>IBC</span>
                                        </span>
                                      );
                                    })()}

                                    {row.scannedInSession && (
                                      <span
                                        id={`bulk-row-scanned-badge-${row._id}`}
                                        style={{
                                          fontSize: '0.65rem',
                                          fontWeight: 800,
                                          padding: '1px 5px',
                                          borderRadius: '4px',
                                          background: '#dcfce7',
                                          color: '#15803d',
                                          border: '1px solid #86efac',
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: '2px',
                                        }}
                                        title="Manufacturer barcode scanned in this session"
                                      >
                                        <CheckIcon size={10} color="#15803d" />
                                        <span>Scanned</span>
                                      </span>
                                    )}
                                  </div>

                                  <input
                                    type="text"
                                    value={row.barcode || ''}
                                    placeholder="Enter or scan barcode"
                                    onChange={(e) => updateRowField(row._id, 'barcode', e.target.value)}
                                    style={{
                                      ...cellInputStyle,
                                      width: '100%',
                                      padding: '0.22rem 0.4rem',
                                      fontSize: '0.74rem',
                                      fontFamily: 'monospace',
                                      fontWeight: 600,
                                      borderColor: isBarcodeDup ? '#f59e0b' : (hasBarcodeErr ? '#ef4444' : (isIbc ? '#c7d2fe' : undefined)),
                                      background: isBarcodeDup ? '#fffbeb' : (hasBarcodeErr ? '#fff1f2' : (isIbc ? '#f5f3ff' : '#ffffff')),
                                    }}
                                    title={
                                      hasBarcode
                                        ? (isIbc ? 'Internal Barcode (IBC)' : 'Manufacturer Barcode (MBC)')
                                        : 'No barcode assigned yet'
                                    }
                                  />
                                  {hasBarcode && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '1px' }}>
                                      <div
                                        dangerouslySetInnerHTML={{ __html: renderBarcodeSvg(row.barcode) }}
                                        style={{ flexShrink: 0, overflow: 'hidden', height: '26px' }}
                                        title={`Scannable barcode: ${row.barcode}`}
                                      />
                                      {isIbc && (
                                        <button
                                          type="button"
                                          onClick={() => handleRegenerateSingleBarcode(row._id)}
                                          title="Regenerate internal barcode (IBC)"
                                          aria-label="Regenerate internal barcode"
                                          style={{
                                            background: '#eef2ff',
                                            border: '1px solid #c7d2fe',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            padding: '2px 5px',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            transition: 'all 0.15s ease',
                                          }}
                                        >
                                          <RefreshCwIcon size={12} color="#4f46e5" />
                                        </button>
                                      )}
                                    </div>
                                  )}
                                  {row.barcodeError && (
                                    <div style={{ fontSize: '0.68rem', color: '#dc2626', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '3px' }}>
                                      <AlertCircleIcon size={11} color="#dc2626" />
                                      <span>{row.barcodeError}</span>
                                      <button
                                        type="button"
                                        onClick={() => handleRegenerateSingleBarcode(row._id)}
                                        style={{ textDecoration: 'underline', border: 'none', background: 'none', color: '#dc2626', cursor: 'pointer', padding: 0, fontWeight: 700 }}
                                      >
                                        Retry
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </td>

                              {/* SUGGESTED / EDITABLE CATEGORY */}
                              <td style={{ padding: '0.45rem 0.35rem' }}>
                                <select
                                  id={`bulk-row-category-${row._id}`}
                                  value={
                                    row.categoryId ||
                                    activeCategories.find((c) => c.name.toLowerCase() === (row.category || '').trim().toLowerCase())?.id ||
                                    ''
                                  }
                                  onChange={(e) => updateRowCategory(row._id, e.target.value)}
                                  style={{
                                    ...cellInputStyle,
                                    borderColor: hasCatErr ? '#f59e0b' : undefined,
                                    background: hasCatErr ? '#fffbeb' : '#ffffff',
                                    color: !row.categoryId && !row.category ? '#b45309' : undefined,
                                    fontWeight: row.categoryId || row.category ? 600 : 400,
                                  }}
                                >
                                  <option value="">— Needs Category —</option>
                                  {activeCategories.map((c) => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                  ))}
                                </select>
                              </td>

                              {/* UOM */}
                              <td style={{ padding: '0.45rem 0.35rem' }}>
                                <select
                                  value={row.unit}
                                  onChange={(e) => updateRowField(row._id, 'unit', e.target.value)}
                                  style={cellInputStyle}
                                >
                                  {UOM_OPTIONS.map((u) => (
                                    <option key={u.code} value={u.code}>{u.label}</option>
                                  ))}
                                </select>
                              </td>

                              {/* SELLING PRICE */}
                              <td style={{ padding: '0.45rem 0.35rem' }}>
                                <input
                                  type="text"
                                  value={row.sellingPrice}
                                  placeholder={hasPriceErr ? 'Required' : 'Price'}
                                  onChange={(e) => updateRowField(row._id, 'sellingPrice', e.target.value)}
                                  style={{
                                    ...cellInputStyle,
                                    borderColor: hasPriceErr ? '#ef4444' : undefined,
                                    background: hasPriceErr ? '#fff1f2' : '#ffffff',
                                  }}
                                />
                              </td>

                              {/* COST PRICE */}
                              <td style={{ padding: '0.45rem 0.35rem' }}>
                                <input
                                  type="text"
                                  value={row.costPrice}
                                  placeholder="0"
                                  onChange={(e) => updateRowField(row._id, 'costPrice', e.target.value)}
                                  style={cellInputStyle}
                                />
                              </td>

                              {/* HSN */}
                              <td style={{ padding: '0.45rem 0.35rem' }}>
                                <input
                                  type="text"
                                  value={row.hsn}
                                  placeholder="HSN"
                                  onChange={(e) => updateRowField(row._id, 'hsn', e.target.value)}
                                  style={cellInputStyle}
                                />
                              </td>

                              {/* GST RATE */}
                              <td style={{ padding: '0.45rem 0.35rem' }}>
                                <select
                                  value={parseGstToBp(row.gstRate) !== null ? String(parseGstToBp(row.gstRate)) : '__custom__'}
                                  onChange={(e) => {
                                    if (e.target.value !== '__custom__') {
                                      const opt = GST_RATE_OPTIONS.find((g) => String(g.bp) === e.target.value);
                                      updateRowField(row._id, 'gstRate', opt ? opt.label : e.target.value);
                                    }
                                  }}
                                  style={cellInputStyle}
                                >
                                  {GST_RATE_OPTIONS.map((g) => (
                                    <option key={g.bp} value={String(g.bp)}>{g.label}</option>
                                  ))}
                                </select>
                              </td>

                              {/* INCL */}
                              <td style={{ padding: '0.45rem 0.35rem', textAlign: 'center' }}>
                                <input
                                  type="checkbox"
                                  checked={row.taxInclusive}
                                  onChange={(e) => updateRowField(row._id, 'taxInclusive', e.target.checked)}
                                  style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
                                />
                              </td>

                              {/* INCOMING STOCK */}
                              <td style={{ padding: '0.45rem 0.35rem' }}>
                                <input
                                  type="text"
                                  value={row.openingStock}
                                  placeholder="0"
                                  onChange={(e) => updateRowField(row._id, 'openingStock', e.target.value)}
                                  style={{ ...cellInputStyle, fontWeight: 600 }}
                                />
                              </td>

                              {/* CURRENT STOCK */}
                              <td style={{ padding: '0.45rem 0.5rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                                {row.matchedItem ? `${existingStock} ${row.unit}` : '0 (New)'}
                              </td>

                              {/* FINAL STOCK */}
                              <td style={{ padding: '0.45rem 0.5rem', fontWeight: 700, color: '#16a34a', fontSize: '0.82rem' }}>
                                {finalStock} {row.unit}
                              </td>

                              {/* ACTIONS */}
                              <td style={{ padding: '0.45rem 0.35rem', textAlign: 'center' }}>
                                <button
                                  onClick={() => removeRow(row._id)}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    color: '#94a3b8',
                                    cursor: 'pointer',
                                    padding: '4px',
                                    borderRadius: '4px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'color 0.15s ease',
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                                  onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
                                  title="Remove row"
                                >
                                  <Trash2Icon size={14} />
                                </button>
                              </td>
                            </tr>

                            {/* INLINE NOTICE / ERROR / AMBIGUITY ROW */}
                            {(row.errors.length > 0 || row.matchedItem || (row.candidates && row.candidates.length > 1) || row.resolution) && (
                              <tr style={{ borderBottom: '1px solid var(--border)', background: '#ffffff' }}>
                                <td colSpan={16} style={{ padding: '0.2rem 0.6rem 0.55rem 2.8rem', fontSize: '0.78rem' }}>
                                  {/* Restock details for single-match products */}
                                  {row.matchedItem && (!row.candidates || row.candidates.length <= 1) && (
                                    <div style={{ color: '#047857', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                        <RefreshCwIcon size={13} color="#047857" />
                                        <span><strong>Restocking existing item:</strong> &quot;{row.matchedItem.name}&quot; (ID: {row.matchedItem.id}, SKU: {row.matchedItem.sku})</span>
                                      </span>
                                      <span>• Existing Stock: {existingStock} + Incoming: {incomingStock} = <strong>Final: {finalStock}</strong></span>
                                      {row.matchedItem.priceMinor !== Math.round(parseFloat(row.sellingPrice) * 100) && (
                                        <span style={{ color: '#b45309' }}>
                                          (Current price ₹{(row.matchedItem.priceMinor / 100).toFixed(2)} → New: ₹{row.sellingPrice})
                                        </span>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => createAsNewProduct(row._id)}
                                        style={{ background: 'none', border: '1px solid #cbd5e1', borderRadius: '4px', padding: '1px 6px', fontSize: '0.72rem', cursor: 'pointer', color: '#475569' }}
                                      >
                                        Do not link (create new product)
                                      </button>
                                    </div>
                                  )}

                                  {/* Ambiguous match choices / Candidate Comparison Table */}
                                  {row.candidates && row.candidates.length > 1 && !row.resolution && (
                                    <div
                                      style={{
                                        background: '#fffdf5',
                                        border: '1.5px solid #fde68a',
                                        borderRadius: '8px',
                                        padding: '0.75rem 1rem',
                                        margin: '0.35rem 0',
                                        boxShadow: '0 2px 6px rgba(217, 119, 6, 0.08)',
                                      }}
                                    >
                                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                          <AlertTriangleIcon size={18} color="#b45309" />
                                          <div>
                                            <strong style={{ color: '#b45309', fontSize: '0.85rem' }}>
                                              Ambiguous Catalog Matches Found for &quot;{row.name}&quot;
                                            </strong>
                                            <div style={{ fontSize: '0.75rem', color: '#92400e' }}>
                                              Multiple possible database items matched this row. Review candidate details below and decide whether to restock an existing item or create a brand-new product.
                                            </div>
                                          </div>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => createAsNewProduct(row._id)}
                                          style={{
                                            background: '#ffffff',
                                            border: '1.5px solid #6366f1',
                                            borderRadius: '6px',
                                            color: '#4338ca',
                                            padding: '0.35rem 0.85rem',
                                            fontSize: '0.78rem',
                                            fontWeight: 700,
                                            cursor: 'pointer',
                                            boxShadow: '0 1px 3px rgba(99, 102, 241, 0.15)',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '0.35rem',
                                          }}
                                        >
                                          <SparklesIcon size={13} color="#4338ca" />
                                          <span>Create as New Product (New SKU &amp; Barcode)</span>
                                        </button>
                                      </div>

                                      {/* Candidate Table */}
                                      <div style={{ overflowX: 'auto', borderRadius: '6px', border: '1px solid #fef3c7', background: '#ffffff' }}>
                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem', textAlign: 'left' }}>
                                          <thead>
                                            <tr style={{ background: '#fef3c7', color: '#92400e', borderBottom: '1px solid #fde68a' }}>
                                              <th style={{ padding: '0.4rem 0.6rem' }}>CANDIDATE PRODUCT</th>
                                              <th style={{ padding: '0.4rem 0.6rem' }}>SKU</th>
                                              <th style={{ padding: '0.4rem 0.6rem' }}>BARCODE / EAN</th>
                                              <th style={{ padding: '0.4rem 0.6rem' }}>CATEGORY</th>
                                              <th style={{ padding: '0.4rem 0.6rem' }}>UOM</th>
                                              <th style={{ padding: '0.4rem 0.6rem' }}>PACK SIZE</th>
                                              <th style={{ padding: '0.4rem 0.6rem' }}>CURRENT STOCK</th>
                                              <th style={{ padding: '0.4rem 0.6rem' }}>WHY IT MATCHED</th>
                                              <th style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>ACTION</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {row.candidates.map((cand) => (
                                              <tr key={cand.id} style={{ borderBottom: '1px solid #fef3c7' }}>
                                                <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600, color: '#1e293b' }}>
                                                  {cand.name}
                                                </td>
                                                <td style={{ padding: '0.4rem 0.6rem', fontFamily: 'monospace', color: '#475569' }}>
                                                  {cand.sku || '—'}
                                                </td>
                                                <td style={{ padding: '0.4rem 0.6rem', fontFamily: 'monospace', color: '#475569' }}>
                                                  {cand.barcode || '—'}
                                                </td>
                                                <td style={{ padding: '0.4rem 0.6rem', color: '#475569' }}>
                                                  {cand.category || '—'}
                                                </td>
                                                <td style={{ padding: '0.4rem 0.6rem', color: '#475569' }}>
                                                  {cand.unit || '—'}
                                                </td>
                                                <td style={{ padding: '0.4rem 0.6rem', color: '#475569' }}>
                                                  {cand.packSize || extractPackSize(cand.name)?.raw || '—'}
                                                </td>
                                                <td style={{ padding: '0.4rem 0.6rem', fontWeight: 600, color: '#1e293b' }}>
                                                  {cand.currentStockMilli / 1000} {cand.unit}
                                                </td>
                                                <td style={{ padding: '0.4rem 0.6rem', color: '#b45309', fontStyle: 'italic' }}>
                                                  {cand.matchReason || 'Close catalog name/variant match'}
                                                </td>
                                                <td style={{ padding: '0.4rem 0.6rem', textAlign: 'right' }}>
                                                  <button
                                                    type="button"
                                                    onClick={() => linkToCandidate(row._id, cand)}
                                                    style={{
                                                      background: '#16a34a',
                                                      color: '#ffffff',
                                                      border: 'none',
                                                      borderRadius: '5px',
                                                      padding: '0.25rem 0.65rem',
                                                      fontSize: '0.73rem',
                                                      fontWeight: 600,
                                                      cursor: 'pointer',
                                                      display: 'inline-flex',
                                                      alignItems: 'center',
                                                      gap: '0.35rem',
                                                    }}
                                                  >
                                                    <LinkIcon size={12} color="#ffffff" />
                                                    <span>Link to this Product</span>
                                                  </button>
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  )}

                                  {/* Resolution indicator if resolved */}
                                  {row.resolution && (
                                    <div
                                      style={{
                                        background: row.resolution === 'LINK' ? '#f0fdf4' : '#f8f7ff',
                                        border: row.resolution === 'LINK' ? '1px solid #bbf7d0' : '1px solid #e0e7ff',
                                        borderRadius: '6px',
                                        padding: '0.45rem 0.75rem',
                                        margin: '0.25rem 0',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        fontSize: '0.78rem',
                                      }}
                                    >
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        {row.resolution === 'LINK' && row.matchedItem ? (
                                          <>
                                            <CheckCircleIcon size={14} color="#166534" />
                                            <span style={{ color: '#166534', fontWeight: 600 }}>
                                              <strong>Resolved:</strong> Linked to existing variant &quot;{row.matchedItem.name}&quot; (SKU: {row.matchedItem.sku}, ID: {row.matchedItem.id}). Stock will be added to this item.
                                            </span>
                                          </>
                                        ) : (
                                          <>
                                            <SparklesIcon size={14} color="#4338ca" />
                                            <span style={{ color: '#4338ca', fontWeight: 600 }}>
                                              <strong>Resolved:</strong> Creating as new distinct catalog product (SKU: {row.sku}).
                                            </span>
                                          </>
                                        )}
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => resetAmbiguityResolution(row._id)}
                                        style={{
                                          background: 'none',
                                          border: '1px solid #cbd5e1',
                                          borderRadius: '4px',
                                          padding: '2px 8px',
                                          fontSize: '0.72rem',
                                          cursor: 'pointer',
                                          color: '#475569',
                                        }}
                                      >
                                        Change / Re-choose
                                      </button>
                                    </div>
                                  )}

                                  {/* Error messages callout */}
                                  {row.errors.length > 0 && (
                                    <div
                                      style={{
                                        marginTop: '4px',
                                        padding: '0.35rem 0.65rem',
                                        borderRadius: '6px',
                                        background: '#fff1f2',
                                        border: '1px solid #fecaca',
                                        borderLeft: '3px solid #ef4444',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '2px',
                                      }}
                                    >
                                      {row.errors.map((err, idx) => (
                                        <div
                                          key={idx}
                                          style={{
                                            color: err.isDuplicate ? '#b45309' : '#b91c1c',
                                            fontWeight: 600,
                                            fontSize: '0.75rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '5px',
                                          }}
                                        >
                                          <AlertCircleIcon size={12} color={err.isDuplicate ? '#d97706' : '#dc2626'} />
                                          <span>{err.message}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* TABLE ACTION BUTTONS */}
              <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  id="bulk-add-row-btn"
                  onClick={addEmptyRow}
                  style={{
                    padding: '0.4rem 0.85rem', borderRadius: '8px', border: '1px solid var(--border)',
                    background: '#ffffff', color: 'var(--text-main)', fontSize: '0.82rem',
                    fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <PlusIcon size={14} color="var(--text-main)" />
                  <span>Add Row</span>
                </button>

                {errorRows.length > 0 && (
                  <button
                    id="bulk-remove-errors-btn"
                    onClick={removeAllErrors}
                    style={{
                      padding: '0.4rem 0.85rem', borderRadius: '8px', border: '1px solid #fecaca',
                      background: '#fff1f2', color: '#dc2626', fontSize: '0.82rem',
                      fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                    }}
                  >
                    <Trash2Icon size={13} color="#dc2626" />
                    <span>Remove {errorRows.length} error row(s)</span>
                  </button>
                )}

                {duplicateRows.length > 0 && (
                  <button
                    id="bulk-remove-duplicates-btn"
                    onClick={removeAllDuplicates}
                    style={{
                      padding: '0.4rem 0.85rem', borderRadius: '8px', border: '1px solid #fde68a',
                      background: '#fffbeb', color: '#d97706', fontSize: '0.82rem',
                      fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                    }}
                  >
                    <CopyIcon size={13} color="#d97706" />
                    <span>Remove {duplicateRows.length} duplicate row(s)</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════
              STEP 3: CONFIRM PREVIEW
             ══════════════════════════════════════════════════════════════════════ */}
          {step === 'confirm' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '820px', margin: '0 auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '10px',
                    background: 'rgba(99, 102, 241, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <LayersIcon size={18} color="#6366f1" />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '1.15rem', color: 'var(--text-main)' }}>
                    Confirm Import &amp; Restock Execution
                  </div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    Review summary numbers before applying changes to your inventory
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
                <div style={{ ...statCardStyle, background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.4rem' }}>
                    <LayersIcon size={16} color="#6366f1" />
                  </div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--primary)' }}>{rawRows.length}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Total Input Rows</div>
                </div>
                <div style={{ ...statCardStyle, background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#e0e7ff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.4rem' }}>
                    <SparklesIcon size={16} color="#4338ca" />
                  </div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#4338ca' }}>{newRows.length}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>New Products to Create</div>
                </div>
                <div style={{ ...statCardStyle, background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.4rem' }}>
                    <RefreshCwIcon size={16} color="#16a34a" />
                  </div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#16a34a' }}>{restockRows.length}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Existing Restocks</div>
                </div>
                <div style={{ ...statCardStyle, background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: '#e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.4rem' }}>
                    <PackageBoxIcon size={16} color="#0284c7" />
                  </div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#0284c7' }}>{totalInwardStock}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Total Inward Units</div>
                </div>
              </div>

              {/* Explanatory notes */}
              <div style={{ background: '#f8f7ff', border: '1px solid var(--border)', borderRadius: '12px', padding: '1.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontWeight: 700, fontSize: '0.9rem', marginBottom: '0.65rem', color: 'var(--text-main)' }}>
                  <CheckCircleIcon size={16} color="#4f46e5" />
                  <span>Execution Details &amp; Safeguards</span>
                </div>
                <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.8 }}>
                  <li>
                    <strong style={{ color: '#16a34a' }}>{restockRows.length} existing products</strong> will have incoming quantities added to current available inventory without duplicating products or modifying their existing barcodes.
                  </li>
                  <li>
                    <strong style={{ color: '#4338ca' }}>{newRows.length} new products</strong> will be registered with auto-generated unique SKUs and internal EAN barcodes.
                  </li>
                  {globalUpdatePrices && (
                    <li>
                      Catalog prices and HSN codes for restocked items will be updated to the latest supplier invoice rates.
                    </li>
                  )}
                  {(errorRows.length > 0 || duplicateRows.length > 0 || ambiguousRows.length > 0) && (
                    <li>
                      <strong style={{ color: '#dc2626' }}>{errorRows.length + duplicateRows.length + ambiguousRows.length} unconfirmed rows</strong> will be safely skipped.
                    </li>
                  )}
                  <li>
                    Idempotency protected with batch key <code style={{ background: '#ffffff', padding: '0.15rem 0.4rem', borderRadius: '4px', border: '1px solid var(--border)', fontSize: '0.8rem' }}>{importBatchId.current}</code>.
                  </li>
                </ul>
              </div>

              {rawRows.some((r) => !r.matchedItem && (!r.barcode || !r.barcode.trim())) && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.65rem',
                    padding: '0.85rem 1rem',
                    borderRadius: '10px',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#b91c1c',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                  }}
                >
                  <AlertTriangleIcon size={18} color="#dc2626" />
                  <span>
                    {rawRows.filter((r) => !r.matchedItem && (!r.barcode || !r.barcode.trim())).length} new product(s) are pending barcodes. Please return to Review and click &quot;Generate Internal Barcodes&quot; or scan barcodes.
                  </span>
                </div>
              )}

              {apiError && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.65rem',
                    padding: '0.85rem 1rem',
                    borderRadius: '10px',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#b91c1c',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                  }}
                >
                  <AlertCircleIcon size={18} color="#dc2626" />
                  <span>{apiError}</span>
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════
              STEP 4: RESULTS
             ══════════════════════════════════════════════════════════════════════ */}
          {step === 'results' && importResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
                <div style={{ ...statCardStyle, background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.45rem' }}>
                    <LayersIcon size={18} color="var(--primary)" />
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--primary)' }}>{importResult.totalRows}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Total Rows</div>
                </div>
                <div style={{ ...statCardStyle, background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#e0e7ff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.45rem' }}>
                    <SparklesIcon size={18} color="#4338ca" />
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#4338ca' }}>{importResult.created}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>New Products Created</div>
                </div>
                <div style={{ ...statCardStyle, background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.45rem' }}>
                    <RefreshCwIcon size={18} color="#16a34a" />
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#16a34a' }}>{importResult.restocked}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Products Restocked</div>
                </div>
                <div style={{ ...statCardStyle, background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.45rem' }}>
                    <BarcodeIcon size={18} color="#0284c7" />
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0284c7' }}>{importResult.barcodesSaved ?? 0}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Barcodes Saved</div>
                </div>
                <div style={{ ...statCardStyle, background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: importResult.skipped > 0 ? '#fee2e2' : '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.45rem' }}>
                    <AlertTriangleIcon size={18} color={importResult.skipped > 0 ? '#dc2626' : '#9ca3af'} />
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 800, color: importResult.skipped > 0 ? '#dc2626' : 'var(--text-muted)' }}>{importResult.skipped}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Skipped / Unchanged</div>
                </div>
              </div>

              {importResult.created + importResult.restocked > 0 && (
                <div
                  style={{
                    padding: '1rem 1.25rem',
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%)',
                    border: '1px solid #a7f3d0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.85rem',
                    boxShadow: '0 2px 8px rgba(16, 185, 129, 0.08)',
                  }}
                >
                  <div
                    style={{
                      width: '38px',
                      height: '38px',
                      borderRadius: '10px',
                      background: '#d1fae5',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <CheckCircleIcon size={22} color="#059669" />
                  </div>
                  <div>
                    <div style={{ fontSize: '0.94rem', color: '#065f46', fontWeight: 700 }}>
                      Import Batch Completed Successfully
                    </div>
                    <div style={{ fontSize: '0.84rem', color: '#047857', marginTop: '0.2rem' }}>
                      Successfully imported {importResult.created} new product{importResult.created !== 1 ? 's' : ''}, restocked {importResult.restocked} existing product{importResult.restocked !== 1 ? 's' : ''}, and saved {importResult.barcodesSaved ?? 0} barcode mapping{importResult.barcodesSaved !== 1 ? 's' : ''}!
                    </div>
                  </div>
                </div>
              )}

              {/* Results table */}
              <div style={{ overflowX: 'auto', borderRadius: '10px', border: '1px solid var(--border)', background: '#ffffff', maxHeight: '35vh' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead style={{ position: 'sticky', top: 0, background: '#f8f7ff' }}>
                    <tr>
                      <th style={thStyle}>Row #</th>
                      <th style={thStyle}>Product Name</th>
                      <th style={thStyle}>Action</th>
                      <th style={thStyle}>Result Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importResult.results.map((r) => (
                      <tr key={r.rowIndex} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>Row {r.rowIndex}</td>
                        <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600, color: 'var(--text-main)' }}>{r.name || '(unnamed)'}</td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>
                          {r.status === 'created' && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, background: '#eef2ff', color: '#4338ca' }}>
                              <SparklesIcon size={12} color="#4338ca" />
                              <span>Created (New)</span>
                            </span>
                          )}
                          {r.status === 'restocked' && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, background: '#dcfce7', color: '#15803d' }}>
                              <RefreshCwIcon size={12} color="#15803d" />
                              <span>Restocked</span>
                            </span>
                          )}
                          {r.status === 'skipped' && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 700, background: '#fee2e2', color: '#b91c1c' }}>
                              <AlertCircleIcon size={12} color="#b91c1c" />
                              <span>Skipped</span>
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '0.5rem 0.75rem', color: r.status === 'skipped' ? '#dc2626' : 'var(--text-muted)' }}>
                          {r.status === 'skipped' ? r.reason : `Item ID: ${r.itemId}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {importResult.skipped > 0 && (
                  <button
                    id="bulk-download-failed-btn"
                    onClick={handleDownloadFailedRows}
                    style={{
                      padding: '0.55rem 1.1rem',
                      borderRadius: '8px',
                      border: '1px solid #fca5a5',
                      background: '#fff1f2',
                      color: '#b91c1c',
                      fontSize: '0.84rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.45rem',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <DownloadIcon size={14} color="#b91c1c" />
                    <span>Download Failed Rows (CSV)</span>
                  </button>
                )}
                <button
                  id="bulk-download-report-btn"
                  onClick={handleDownloadImportReport}
                  style={{
                    padding: '0.55rem 1.1rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    background: '#ffffff',
                    color: 'var(--text-main)',
                    fontSize: '0.84rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <FileSpreadsheetIcon size={14} color="#4f46e5" />
                  <span>Download Complete Summary Report (CSV)</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── FOOTER ── */}
        <div
          style={{
            borderTop: '1px solid var(--border)',
            padding: '0.9rem 1.5rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexShrink: 0,
            gap: '0.75rem',
            background: 'var(--bg-main)',
          }}
        >
          {step === 'choose' && (
            <>
              <button onClick={onClose} className="btn btn-secondary">
                Cancel
              </button>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Max 500 products per import batch
              </div>
            </>
          )}

          {step === 'review' && (
            <>
              <button
                id="bulk-start-over-btn"
                onClick={() => { setStep('choose'); setRawRows([]); setBarcodeValidationActive(false); }}
                className="btn btn-secondary"
                style={{ padding: '0.55rem 1rem', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}
              >
                <ArrowLeftIcon size={14} />
                <span>Start Over</span>
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  {errorRows.length + duplicateRows.length + ambiguousRows.length > 0 ? (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        padding: '0.35rem 0.8rem',
                        borderRadius: '20px',
                        background: '#fffbeb',
                        border: '1px solid #fde68a',
                        color: '#b45309',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                      }}
                    >
                      <AlertTriangleIcon size={14} color="#d97706" />
                      <span>
                        <strong>{errorRows.length + duplicateRows.length + ambiguousRows.length} row(s)</strong> will be skipped unless resolved
                      </span>
                    </span>
                  ) : (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        padding: '0.35rem 0.8rem',
                        borderRadius: '20px',
                        background: '#ecfdf5',
                        border: '1px solid #a7f3d0',
                        color: '#047857',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                      }}
                    >
                      <CheckCircleIcon size={14} color="#10b981" />
                      <span>All <strong>{eligibleRows.length}</strong> rows ready to import</span>
                    </span>
                  )}
                </span>

                <button
                  id="bulk-review-import-btn"
                  onClick={() => {
                    const hasPendingBarcodes = validatedRows.some(
                      (r) => !r.matchedItem && r.status !== 'RESTOCK' && (!r.barcode || !r.barcode.trim())
                    );
                    if (hasPendingBarcodes) {
                      setBarcodeValidationActive(true);
                      return;
                    }
                    setStep('confirm');
                  }}
                  disabled={eligibleRows.length === 0}
                  style={{
                    background: eligibleRows.length > 0 ? 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' : '#cbd5e1',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '0.65rem 1.4rem',
                    fontWeight: 700,
                    fontSize: '0.9rem',
                    cursor: eligibleRows.length > 0 ? 'pointer' : 'not-allowed',
                    boxShadow: eligibleRows.length > 0 ? '0 4px 14px rgba(99, 102, 241, 0.35)' : 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span>Review &amp; Import ({eligibleRows.length})</span>
                  <ArrowRightIcon size={15} color="#ffffff" />
                </button>
              </div>
            </>
          )}

          {step === 'confirm' && (
            <>
              <button
                onClick={() => setStep('review')}
                className="btn btn-secondary"
                disabled={isSubmitting}
                style={{ padding: '0.55rem 1rem', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600 }}
              >
                <ArrowLeftIcon size={14} />
                <span>Back to Review</span>
              </button>

              <button
                id="bulk-confirm-import-btn"
                onClick={handleExecuteImport}
                disabled={isSubmitting || eligibleRows.length === 0}
                style={{
                  background: isSubmitting || eligibleRows.length === 0 ? '#cbd5e1' : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  minWidth: 200,
                  padding: '0.65rem 1.4rem',
                  fontSize: '0.9rem',
                  fontWeight: 700,
                  cursor: isSubmitting || eligibleRows.length === 0 ? 'not-allowed' : 'pointer',
                  boxShadow: !isSubmitting && eligibleRows.length > 0 ? '0 4px 14px rgba(16, 185, 129, 0.35)' : 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  transition: 'all 0.15s ease',
                }}
              >
                {isSubmitting ? (
                  <>
                    <RefreshCwIcon size={15} color="#ffffff" spinning={true} />
                    <span>Importing &amp; Restocking...</span>
                  </>
                ) : (
                  <>
                    <CheckCircleIcon size={16} color="#ffffff" />
                    <span>Confirm &amp; Import ({eligibleRows.length})</span>
                    <ArrowRightIcon size={14} color="#ffffff" />
                  </>
                )}
              </button>
            </>
          )}

          {step === 'results' && (
            <>
              <button
                onClick={() => { setStep('choose'); setRawRows([]); setImportResult(null); setBarcodeValidationActive(false); }}
                className="btn btn-secondary"
                style={{ padding: '0.55rem 1rem', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '0.45rem', fontWeight: 600 }}
              >
                <RotateCcwIcon size={14} />
                <span>Import More Products</span>
              </button>

              <button
                id="bulk-import-done-btn"
                onClick={() => { onImportDone(); onClose(); }}
                style={{
                  background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.65rem 1.4rem',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(99, 102, 241, 0.35)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.45rem',
                  transition: 'all 0.15s ease',
                }}
              >
                <CheckIcon size={15} color="#ffffff" />
                <span>Done — Go to Products</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>

      {isScanModalOpen && (
        <ScanManufacturerBarcodeModal
          targets={barcodeTargets}
          takenCatalogBarcodes={takenCatalogBarcodes}
          initialSelectedId={scanModalInitialId}
          shopName={shopName}
          onAssign={handleAssignFromScanModal}
          onClose={() => {
            setIsScanModalOpen(false);
            setScanModalInitialId(null);
          }}
        />
      )}
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: '0.65rem 0.5rem',
  fontWeight: 700,
  fontSize: '0.74rem',
  color: 'var(--text-main)',
  textAlign: 'left',
  borderBottom: '1px solid var(--border)',
};

const cellInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.35rem 0.45rem',
  borderRadius: '6px',
  border: '1px solid var(--border)',
  background: '#ffffff',
  color: 'var(--text-main)',
  fontSize: '0.8rem',
  boxSizing: 'border-box',
  outline: 'none',
  fontFamily: 'inherit',
};

const statCardStyle: React.CSSProperties = {
  padding: '1rem',
  borderRadius: '12px',
  background: 'var(--bg-main)',
  border: '1px solid var(--border)',
  textAlign: 'center',
};
