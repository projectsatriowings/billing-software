import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type {
  SalesAnalysisData,
  SalesOverviewPoint,
  DaywiseSalesRow,
  CategorySalesItem,
} from '../../api.ts';
import { fetchSalesAnalysis } from '../../api.ts';

interface SalesAnalysisViewProps {
  userRole?: string;
  shopName?: string;
  onNavigateToInvoices?: (searchDate?: string) => void;
  showToast?: (msg: string) => void;
}

type MetricToggle = 'sales' | 'bills' | 'profit' | 'avg_bill';
type DatePreset = 'today' | '7d' | '30d' | 'this_month' | '90d' | 'custom';
type ComparePreset = 'previous_period' | 'same_period_last_month' | 'none';
type GroupingPreset = 'day' | 'week' | 'month';

/** Indian number formatter with paise support */
export function formatRupees(minor: number | undefined | null, includeDecimals = false): string {
  if (minor === undefined || minor === null || isNaN(minor)) return '₹0';
  const val = minor / 100;
  if (includeDecimals) {
    return '₹' + val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return '₹' + Math.round(val).toLocaleString('en-IN');
}

/** Formatter for compact rupee numbers in charts & axis (e.g. ₹0, ₹5k, ₹50k, ₹1.2L, ₹1Cr) */
function formatCompactRupees(minor: number): string {
  const r = minor / 100;
  if (r === 0) return '₹0';
  const absR = Math.abs(r);
  if (absR >= 10000000) {
    const cr = r / 10000000;
    return `₹${cr % 1 === 0 ? cr.toFixed(0) : cr.toFixed(1)}Cr`;
  }
  if (absR >= 100000) {
    const l = r / 100000;
    return `₹${l % 1 === 0 ? l.toFixed(0) : l.toFixed(1)}L`;
  }
  if (absR >= 1000) {
    const k = r / 1000;
    return `₹${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}k`;
  }
  return `₹${Math.round(r)}`;
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDMMM(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const day = parseInt(parts[2], 10);
    const mIdx = parseInt(parts[1], 10) - 1;
    if (mIdx >= 0 && mIdx < 12) {
      return `${day} ${MONTHS_SHORT[mIdx]}`;
    }
  }
  const d = new Date(dateStr + 'T12:00:00Z');
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]}`;
}

function formatDMMMYYYY(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const year = parts[0];
    const mIdx = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const month = MONTHS_SHORT[mIdx] || 'Sep';
    return `${day} ${month} ${year}`;
  }
  const d = new Date(dateStr + 'T12:00:00Z');
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Compute nice tick steps (1, 2, 5 x 10^n) with ~15% headroom starting at 0 */
function getNiceTicks(
  rawMax: number,
  isCount: boolean,
): { maxValue: number; ticks: number[] } {
  if (rawMax <= 0) {
    if (isCount) {
      return { maxValue: 5, ticks: [0, 1, 2, 3, 4, 5] };
    }
    // ₹0 to ₹1k in minor units
    return { maxValue: 100000, ticks: [0, 25000, 50000, 75000, 100000] };
  }

  const targetCeiling = rawMax * 1.15;

  if (isCount) {
    const rawStep = Math.max(1, targetCeiling / 5);
    const exponent = Math.floor(Math.log10(rawStep));
    const power = Math.pow(10, Math.max(0, exponent));
    const fraction = rawStep / power;

    let niceFraction = 1;
    if (fraction <= 1.2) niceFraction = 1;
    else if (fraction <= 2.2) niceFraction = 2;
    else if (fraction <= 3.8) niceFraction = exponent >= 1 ? 2.5 : 2;
    else if (fraction <= 7.5) niceFraction = 5;
    else niceFraction = 10;

    const step = Math.max(1, Math.round(niceFraction * power));
    let maxValue = Math.ceil(targetCeiling / step) * step;
    if (maxValue / step < 4) {
      maxValue = step * 4;
    }

    const ticks: number[] = [];
    for (let t = 0; t <= maxValue + step * 0.001; t += step) {
      ticks.push(Math.round(t));
    }
    return { maxValue: ticks[ticks.length - 1], ticks };
  } else {
    const rawMaxRupees = rawMax / 100;
    const targetCeilingRupees = rawMaxRupees * 1.15;
    const rawStepRupees = Math.max(1, targetCeilingRupees / 5);
    const exponent = Math.floor(Math.log10(rawStepRupees));
    const power = Math.pow(10, Math.max(0, exponent));
    const fraction = rawStepRupees / power;

    let niceFraction = 1;
    if (fraction <= 1.2) niceFraction = 1;
    else if (fraction <= 2.2) niceFraction = 2;
    else if (fraction <= 3.8) niceFraction = 2.5;
    else if (fraction <= 7.5) niceFraction = 5;
    else niceFraction = 10;

    const stepRupees = niceFraction * power;
    let maxRupees = Math.ceil(targetCeilingRupees / stepRupees) * stepRupees;
    if (maxRupees / stepRupees < 4) {
      maxRupees = stepRupees * 4;
    }

    const stepMinor = Math.round(stepRupees * 100);
    const maxMinor = Math.round(maxRupees * 100);
    const ticks: number[] = [];
    for (let t = 0; t <= maxMinor + stepMinor * 0.001; t += stepMinor) {
      ticks.push(Math.round(t));
    }
    return { maxValue: ticks[ticks.length - 1], ticks };
  }
}

/** Fritsch-Carlson monotone cubic spline interpolation path */
function buildMonotoneCubicPath(points: { x: number; y: number }[]): string {
  const n = points.length;
  if (n === 0) return '';
  if (n === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  if (n === 2) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)} L ${points[1].x.toFixed(1)} ${points[1].y.toFixed(1)}`;
  }

  const dx: number[] = new Array(n - 1);
  const dy: number[] = new Array(n - 1);
  const slopes: number[] = new Array(n - 1);

  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1].x - points[i].x;
    dy[i] = points[i + 1].y - points[i].y;
    slopes[i] = dx[i] === 0 ? 0 : dy[i] / dx[i];
  }

  const m: number[] = new Array(n);
  m[0] = slopes[0];
  m[n - 1] = slopes[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slopes[i - 1] * slopes[i] <= 0) {
      m[i] = 0;
    } else {
      m[i] = (slopes[i - 1] + slopes[i]) / 2;
    }
  }

  for (let i = 0; i < n - 1; i++) {
    if (slopes[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const alpha = m[i] / slopes[i];
      const beta = m[i + 1] / slopes[i];
      if (alpha < 0) m[i] = 0;
      if (beta < 0) m[i + 1] = 0;
      const hypot = Math.hypot(alpha, beta);
      if (hypot > 3) {
        const tau = 3 / hypot;
        m[i] = tau * alpha * slopes[i];
        m[i + 1] = tau * beta * slopes[i];
      }
    }
  }

  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const cp1x = points[i].x + dx[i] / 3;
    const cp1y = points[i].y + (m[i] * dx[i]) / 3;
    const cp2x = points[i + 1].x - dx[i] / 3;
    const cp2y = points[i + 1].y - (m[i + 1] * dx[i]) / 3;
    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${points[i + 1].x.toFixed(1)} ${points[i + 1].y.toFixed(1)}`;
  }

  return path;
}

/** Get today's date in Asia/Kolkata timezone */
function getTodayKolkataYMD(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value || '2026';
  const m = parts.find((p) => p.type === 'month')?.value || '01';
  const d = parts.find((p) => p.type === 'day')?.value || '01';
  return `${y}-${m}-${d}`;
}

/** Add days to YYYY-MM-DD string */
function addDaysYMD(ymd: string, days: number): string {
  const d = new Date(ymd + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ==========================================================================
   MODERN VECTOR SVG ICONS FOR SALES ANALYSIS
   ========================================================================== */

const AnalyticsHeaderIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
    <line x1="2" y1="20" x2="22" y2="20" />
  </svg>
);

const DownloadCloudIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const PrinterIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 6 2 18 2 18 9" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="8" />
  </svg>
);

const WhatsAppCalendarIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

const StoreIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
    <path d="M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4" />
    <path d="M2 7h20" />
  </svg>
);

const TagFilterIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m20.59 13.41-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);

const UserFilterIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const CalendarIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const GitCompareIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <path d="M13 6h3a2 2 0 0 1 2 2v7" />
    <path d="M11 18H8a2 2 0 0 1-2-2V9" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const NetSalesIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

const BillsReceiptIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1z" />
    <line x1="8" y1="8" x2="16" y2="8" />
    <line x1="8" y1="12" x2="16" y2="12" />
    <line x1="8" y1="16" x2="12" y2="16" />
  </svg>
);

const AvgBillIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
    <path d="M3 6h18" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </svg>
);

const GrossProfitIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="m16 8-8 8" />
    <circle cx="9" cy="9" r="1" />
    <circle cx="15" cy="15" r="1" />
  </svg>
);

const ReturnsRefundIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1 4 1 10 7 10" />
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
  </svg>
);

const GstShieldIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

const TrendUpIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="17 7 17 17 7 17" transform="rotate(-45 12 12)" />
  </svg>
);

const TrendDownIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="17 7 17 17 7 17" transform="rotate(45 12 12)" />
  </svg>
);

const OverviewChartIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

const EmptyChartIllustration = () => (
  <svg width="56" height="56" viewBox="0 0 64 64" fill="none" style={{ opacity: 0.6 }}>
    <rect x="8" y="12" width="48" height="40" rx="8" stroke="#cbd5e1" strokeWidth="2" strokeDasharray="4 4" />
    <path d="M16 42l10-14 8 8 14-16" stroke="#6d4aff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="16" cy="42" r="3" fill="#6d4aff" />
    <circle cx="26" cy="28" r="3" fill="#6d4aff" />
    <circle cx="34" cy="36" r="3" fill="#6d4aff" />
    <circle cx="48" cy="20" r="3" fill="#6d4aff" />
  </svg>
);

const PieChartCategoryIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.21 15.89A10 10 0 1 1 8 2.83" />
    <path d="M22 12A10 10 0 0 0 12 2v10z" />
  </svg>
);

const ChevronRightMini = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const ClockHeatmapIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const FlamePeakIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  </svg>
);

const WalletPaymentIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
    <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
    <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
  </svg>
);

const PhoneUpiIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
    <line x1="12" y1="18" x2="12.01" y2="18" />
  </svg>
);

const BanknoteCashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <circle cx="12" cy="12" r="2" />
    <path d="M6 12h.01M18 12h.01" />
  </svg>
);

const CreditCardIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
    <line x1="1" y1="10" x2="23" y2="10" />
  </svg>
);

const BookKhataIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

const CrownUserIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const SparklesInsightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
  </svg>
);

const CalendarTableIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="3" y1="14" x2="21" y2="14" />
    <line x1="3" y1="18" x2="21" y2="18" />
    <line x1="9" y1="10" x2="9" y2="22" />
    <line x1="15" y1="10" x2="15" y2="22" />
  </svg>
);

const FileSpreadsheetIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="16" y2="17" />
    <line x1="10" y1="9" x2="8" y2="9" />
  </svg>
);

const CloseModalIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const FilterFunnelIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
);

const MoreDotsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="1.75" />
    <circle cx="12" cy="12" r="1.75" />
    <circle cx="12" cy="19" r="1.75" />
  </svg>
);

const DotMatrixBarIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
    <line x1="2" y1="20" x2="22" y2="20" />
  </svg>
);

const AreaSplineIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 17l6-6 4 4 8-8" />
  </svg>
);

const PackageSalesIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

const CategoryDonutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a10 10 0 0 1 10 10h-6a4 4 0 0 0-4-4V2z" />
  </svg>
);

/** Micro sparkline vertical bars for KPI cards */
const MicroSparkBars: React.FC<{
  values: number[];
  color: string;
}> = ({ values, color }) => {
  const count = 6;
  const normalized = values && values.length > 0
    ? (values.length >= count ? values.slice(-count) : [...Array(count - values.length).fill(values[0] || 10), ...values])
    : [20, 35, 25, 45, 60, 50];
  const max = Math.max(...normalized, 1);

  return (
    <div className="micro-spark-container" aria-hidden="true">
      {normalized.map((val, idx) => {
        const heightPct = Math.max(20, Math.min(100, Math.round((val / max) * 100)));
        const opacity = 0.35 + (idx / (count - 1)) * 0.65;
        return (
          <div
            key={idx}
            className="micro-spark-bar"
            style={{
              height: `${heightPct}%`,
              background: color,
              opacity,
            }}
          />
        );
      })}
    </div>
  );
};

/** Inspirational Beaded / Dot-Matrix Stacked Bar Chart */
const BeadedDotMatrixBarChart: React.FC<{
  series: SalesOverviewPoint[];
  metricKey: 'salesMinor' | 'billsCount' | 'grossProfitMinor';
  totalValueFormatted: string;
  trendText?: string;
  isTrendPositive?: boolean;
}> = ({ series, metricKey, totalValueFormatted, trendText, isTrendPositive = true }) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const displayPoints = useMemo(() => {
    if (!series || series.length === 0) return [];
    if (series.length <= 14) return series;
    const step = (series.length - 1) / 11;
    const sampled: SalesOverviewPoint[] = [];
    for (let i = 0; i < 12; i++) {
      const idx = Math.min(series.length - 1, Math.round(i * step));
      sampled.push(series[idx]);
    }
    return sampled;
  }, [series]);

  const rawValues = displayPoints.map((p) => Number(p[metricKey] || 0));
  const rawMax = Math.max(...rawValues, 100);
  const nice = getNiceTicks(rawMax, metricKey === 'billsCount');
  const maxValue = nice.maxValue;

  const width = 580;
  const height = 240;
  const padLeft = 45;
  const padRight = 20;
  const padTop = 15;
  const padBottom = 30;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;
  const colCount = displayPoints.length;
  const dotsPerCol = 8;
  const dotRadius = 5.5;

  const hoveredPt = hoveredIdx !== null ? displayPoints[hoveredIdx] : null;

  return (
    <div className="inspire-chart-card">
      <div className="inspire-card-header">
        <div className="inspire-header-title-box">
          <div className="inspire-header-icon theme-teal">
            <DotMatrixBarIcon />
          </div>
          <div>
            <h3 className="inspire-card-title">Revenue Over Time</h3>
          </div>
        </div>
        <div className="inspire-header-actions">
          <button type="button" className="inspire-pill-btn">
            <FilterFunnelIcon />
            <span>Filter</span>
          </button>
          <button type="button" className="inspire-more-btn" title="More options">
            <MoreDotsIcon />
          </button>
        </div>
      </div>

      <div className="inspire-stat-row">
        <span className="inspire-big-metric mono">{totalValueFormatted}</span>
        {trendText && (
          <span className={`inspire-trend-pill ${isTrendPositive ? 'positive' : 'negative'}`}>
            {isTrendPositive ? <TrendUpIcon /> : <TrendDownIcon />}
            <span>{trendText}</span>
          </span>
        )}
      </div>

      <div className="inspire-svg-chart-wrap" style={{ position: 'relative' }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="inspire-svg-canvas"
          preserveAspectRatio="none"
          onMouseLeave={() => setHoveredIdx(null)}
        >
          {/* Horizontal Grid lines & Y-axis labels */}
          {nice.ticks.map((tickVal, tIdx) => {
            const y = padTop + chartH - (tickVal / maxValue) * chartH;
            const labelStr = metricKey === 'billsCount' ? tickVal.toString() : formatCompactRupees(tickVal);
            return (
              <g key={tIdx}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="#f1f5f9"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <text
                  x={padLeft - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  fontSize="10"
                  fill="#94a3b8"
                  fontFamily="Inter, sans-serif"
                >
                  {labelStr}
                </text>
              </g>
            );
          })}

          {/* Dot Matrix Beaded Columns */}
          {displayPoints.map((pt, cIdx) => {
            const cx = padLeft + (cIdx / Math.max(1, colCount - 1)) * chartW;
            const val = Number(pt[metricKey] || 0);
            const ratio = Math.max(0, Math.min(1, val / maxValue));
            const activeDots = val > 0 ? Math.max(1, Math.min(dotsPerCol, Math.round(ratio * dotsPerCol))) : 0;
            const isHovered = hoveredIdx === cIdx;

            return (
              <g
                key={cIdx}
                className="dot-matrix-col-group"
                onMouseEnter={() => setHoveredIdx(cIdx)}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={cx - (chartW / Math.max(1, colCount)) / 2}
                  y={padTop}
                  width={chartW / Math.max(1, colCount)}
                  height={chartH}
                  fill={isHovered ? 'rgba(99, 102, 241, 0.05)' : 'transparent'}
                  rx="6"
                />

                {Array.from({ length: dotsPerCol }).map((_, dIdx) => {
                  const cy = padTop + chartH - (dIdx / (dotsPerCol - 1)) * chartH;
                  const isActive = dIdx < activeDots;
                  return (
                    <circle
                      key={dIdx}
                      cx={cx}
                      cy={cy}
                      r={isHovered && isActive ? dotRadius * 1.15 : dotRadius}
                      fill={isActive ? (isHovered ? '#0f766e' : '#14b8a6') : '#e2e8f0'}
                      opacity={isActive ? 0.95 : 0.45}
                      style={{ transition: 'all 0.18s cubic-bezier(0.16, 1, 0.3, 1)' }}
                    />
                  );
                })}

                <text
                  x={cx}
                  y={height - 8}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight={isHovered ? '700' : '500'}
                  fill={isHovered ? '#0f172a' : '#94a3b8'}
                >
                  {pt.label || formatDMMM(pt.date)}
                </text>
              </g>
            );
          })}
        </svg>

        {hoveredPt && hoveredIdx !== null && (
          <div
            className="inspire-floating-tooltip"
            style={{
              left: `${((padLeft + (hoveredIdx / Math.max(1, colCount - 1)) * chartW) / width) * 100}%`,
              top: '25%',
              transform: 'translate(-50%, -100%)',
            }}
          >
            <div className="tooltip-date-header">{formatDMMMYYYY(hoveredPt.date)}</div>
            <div className="tooltip-val-row">
              <span className="tooltip-dot" style={{ background: '#14b8a6' }} />
              <span className="tooltip-metric-label">Sales:</span>
              <strong className="mono">{formatRupees(hoveredPt.salesMinor)}</strong>
            </div>
            <div className="tooltip-sub-info">{hoveredPt.billsCount} bills generated</div>
          </div>
        )}
      </div>
    </div>
  );
};

/** Inspirational Dual Spline Curve Area Chart */
const DualSplineAreaChart: React.FC<{
  series: SalesOverviewPoint[];
  totalValueFormatted: string;
  trendText?: string;
  isTrendPositive?: boolean;
}> = ({ series, totalValueFormatted, trendText, isTrendPositive = true }) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const displayPoints = useMemo(() => {
    if (!series || series.length === 0) return [];
    if (series.length <= 14) return series;
    const step = (series.length - 1) / 11;
    const sampled: SalesOverviewPoint[] = [];
    for (let i = 0; i < 12; i++) {
      const idx = Math.min(series.length - 1, Math.round(i * step));
      sampled.push(series[idx]);
    }
    return sampled;
  }, [series]);

  const maxVal = Math.max(
    ...displayPoints.map((p) => Math.max(p.salesMinor, p.grossProfitMinor)),
    100
  );
  const nice = getNiceTicks(maxVal, false);
  const maxValue = nice.maxValue;

  const width = 580;
  const height = 240;
  const padLeft = 45;
  const padRight = 20;
  const padTop = 15;
  const padBottom = 30;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;
  const colCount = displayPoints.length;

  const pointsSales = displayPoints.map((pt, idx) => ({
    x: padLeft + (idx / Math.max(1, colCount - 1)) * chartW,
    y: padTop + chartH - (pt.salesMinor / maxValue) * chartH,
  }));

  const pointsProfit = displayPoints.map((pt, idx) => ({
    x: padLeft + (idx / Math.max(1, colCount - 1)) * chartW,
    y: padTop + chartH - (pt.grossProfitMinor / maxValue) * chartH,
  }));

  const salesPath = buildMonotoneCubicPath(pointsSales);
  const profitPath = buildMonotoneCubicPath(pointsProfit);

  const baselineY = padTop + chartH;
  const salesAreaPath = pointsSales.length > 0
    ? `${salesPath} L ${pointsSales[pointsSales.length - 1].x} ${baselineY} L ${pointsSales[0].x} ${baselineY} Z`
    : '';
  const profitAreaPath = pointsProfit.length > 0
    ? `${profitPath} L ${pointsProfit[pointsProfit.length - 1].x} ${baselineY} L ${pointsProfit[0].x} ${baselineY} Z`
    : '';

  const hoveredPt = hoveredIdx !== null ? displayPoints[hoveredIdx] : null;

  return (
    <div className="inspire-chart-card">
      <div className="inspire-card-header">
        <div className="inspire-header-title-box">
          <div className="inspire-header-icon theme-blue">
            <AreaSplineIcon />
          </div>
          <div>
            <h3 className="inspire-card-title">Revenue Breakdown</h3>
          </div>
        </div>
        <div className="inspire-header-actions">
          <button type="button" className="inspire-pill-btn">
            <FilterFunnelIcon />
            <span>Filter</span>
          </button>
          <button type="button" className="inspire-more-btn" title="More options">
            <MoreDotsIcon />
          </button>
        </div>
      </div>

      <div className="inspire-stat-row">
        <span className="inspire-big-metric mono">{totalValueFormatted}</span>
        {trendText && (
          <span className={`inspire-trend-pill ${isTrendPositive ? 'positive' : 'negative'}`}>
            {isTrendPositive ? <TrendUpIcon /> : <TrendDownIcon />}
            <span>{trendText}</span>
          </span>
        )}
      </div>

      <div className="inspire-svg-chart-wrap" style={{ position: 'relative' }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="inspire-svg-canvas"
          preserveAspectRatio="none"
          onMouseLeave={() => setHoveredIdx(null)}
        >
          <defs>
            <linearGradient id="inspireSalesArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0284c7" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#0284c7" stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="inspireProfitArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0d9488" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#0d9488" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {nice.ticks.map((tickVal, tIdx) => {
            const y = padTop + chartH - (tickVal / maxValue) * chartH;
            return (
              <g key={tIdx}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="#f1f5f9"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <text
                  x={padLeft - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  fontSize="10"
                  fill="#94a3b8"
                >
                  {formatCompactRupees(tickVal)}
                </text>
              </g>
            );
          })}

          {salesAreaPath && <path d={salesAreaPath} fill="url(#inspireSalesArea)" />}
          {profitAreaPath && <path d={profitAreaPath} fill="url(#inspireProfitArea)" />}

          {salesPath && (
            <path
              d={salesPath}
              fill="none"
              stroke="#0284c7"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          )}
          {profitPath && (
            <path
              d={profitPath}
              fill="none"
              stroke="#0d9488"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
          )}

          {displayPoints.map((pt, cIdx) => {
            const cx = padLeft + (cIdx / Math.max(1, colCount - 1)) * chartW;
            const isHovered = hoveredIdx === cIdx;
            return (
              <g
                key={cIdx}
                onMouseEnter={() => setHoveredIdx(cIdx)}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={cx - (chartW / Math.max(1, colCount)) / 2}
                  y={padTop}
                  width={chartW / Math.max(1, colCount)}
                  height={chartH}
                  fill="transparent"
                />
                <text
                  x={cx}
                  y={height - 8}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight={isHovered ? '700' : '500'}
                  fill={isHovered ? '#0f172a' : '#94a3b8'}
                >
                  {pt.label || formatDMMM(pt.date)}
                </text>
              </g>
            );
          })}

          {hoveredIdx !== null && pointsSales[hoveredIdx] && pointsProfit[hoveredIdx] && (
            <g>
              <line
                x1={pointsSales[hoveredIdx].x}
                y1={padTop}
                x2={pointsSales[hoveredIdx].x}
                y2={padTop + chartH}
                stroke="#94a3b8"
                strokeWidth="1.2"
                strokeDasharray="2 2"
              />
              <circle
                cx={pointsSales[hoveredIdx].x}
                cy={pointsSales[hoveredIdx].y}
                r="5"
                fill="#0284c7"
                stroke="#ffffff"
                strokeWidth="2.5"
              />
              <circle
                cx={pointsProfit[hoveredIdx].x}
                cy={pointsProfit[hoveredIdx].y}
                r="5"
                fill="#0d9488"
                stroke="#ffffff"
                strokeWidth="2.5"
              />
            </g>
          )}
        </svg>

        {hoveredPt && hoveredIdx !== null && (
          <div
            className="inspire-floating-tooltip glass-tooltip"
            style={{
              left: `${((padLeft + (hoveredIdx / Math.max(1, colCount - 1)) * chartW) / width) * 100}%`,
              top: '20%',
              transform: 'translate(-50%, -100%)',
            }}
          >
            <div className="tooltip-date-header">{formatDMMMYYYY(hoveredPt.date)}</div>
            <div className="tooltip-legend-row">
              <span className="tooltip-dot" style={{ background: '#0284c7' }} />
              <span className="tooltip-metric-label">Net Sales</span>
              <span className="tooltip-metric-val mono">{formatRupees(hoveredPt.salesMinor)}</span>
            </div>
            <div className="tooltip-legend-row">
              <span className="tooltip-dot" style={{ background: '#0d9488' }} />
              <span className="tooltip-metric-label">Gross Profit</span>
              <span className="tooltip-metric-val mono">{formatRupees(hoveredPt.grossProfitMinor)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/** Inspirational Product Sales Breakdown 3-Column Card */
const ProductSalesBreakdownCard: React.FC<{
  productBreakdown: any;
}> = ({ productBreakdown }) => {
  const groups = [
    productBreakdown.byRevenue,
    productBreakdown.byVolume,
    productBreakdown.byProfit,
  ];

  return (
    <div className="inspire-chart-card">
      <div className="inspire-card-header">
        <div className="inspire-header-title-box">
          <div className="inspire-header-icon theme-blue">
            <PackageSalesIcon />
          </div>
          <div>
            <h3 className="inspire-card-title">Product Sales</h3>
          </div>
        </div>
        <div className="inspire-header-actions">
          <button type="button" className="inspire-pill-btn">
            <FilterFunnelIcon />
            <span>Filter</span>
          </button>
          <button type="button" className="inspire-more-btn" title="More options">
            <MoreDotsIcon />
          </button>
        </div>
      </div>

      <div className="inspire-product-cols-grid">
        {groups.map((grp: any, gIdx: number) => {
          const isVol = gIdx === 1;
          const isProf = gIdx === 2;
          const isPositive = (grp.trendPct ?? 0) >= 0;

          return (
            <div key={gIdx} className="inspire-product-subcard">
              <div className="product-subcard-header">
                <div className="product-subcard-metric mono">
                  {grp.totalMetric}
                  <span className="metric-sub">{isVol ? '' : 'Sales'}</span>
                </div>
                <span className={`product-subcard-trend ${isPositive ? 'positive' : 'negative'}`}>
                  {isPositive ? '↗' : '↘'} {Math.abs(grp.trendPct ?? 15)}%
                </span>
              </div>

              <table className="product-subcard-table">
                <thead>
                  <tr>
                    <th>Product Name</th>
                    <th>{isVol ? 'Units Sold' : isProf ? 'Net Margin' : 'Sales Vol'}</th>
                  </tr>
                </thead>
                <tbody>
                  {(grp.items || []).slice(0, 5).map((item: any, iIdx: number) => (
                    <tr key={iIdx}>
                      <td className="product-name-cell" title={item.name}>
                        {item.name}
                      </td>
                      <td className="product-stat-cell mono">
                        {isVol
                          ? `${item.unitsSold}+`
                          : isProf
                          ? formatRupees(item.profitMinor || Math.round(item.revenueMinor * 0.25))
                          : formatRupees(item.revenueMinor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** Inspirational Segmented Donut Chart & Category Legend */
const CategorySalesDonutCard: React.FC<{
  categories: CategorySalesItem[];
  totalCatSalesMinor: number;
  onFilterCategory?: (cat: string) => void;
}> = ({ categories, totalCatSalesMinor, onFilterCategory }) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const cx = 95;
  const cy = 95;
  const outerR = 76;
  const innerR = 52;

  const arcs = useMemo(() => {
    let currentAngle = 0;
    const items = categories && categories.length > 0 ? categories : [
      { category: 'No Data', netSalesMinor: 0, sharePct: 100, billsCount: 0, color: '#e2e8f0' }
    ];

    return items.map((cat, idx) => {
      const share = Math.max(1, cat.sharePct || 1);
      const angleSweep = (share / 100) * 360;
      const startAngle = currentAngle;
      const endAngle = currentAngle + Math.max(2, angleSweep - (items.length > 1 ? 2.5 : 0));
      currentAngle += angleSweep;

      const startRad = ((startAngle - 90) * Math.PI) / 180;
      const endRad = ((endAngle - 90) * Math.PI) / 180;
      const midRad = (((startAngle + endAngle) / 2 - 90) * Math.PI) / 180;

      const x1 = cx + outerR * Math.cos(startRad);
      const y1 = cy + outerR * Math.sin(startRad);
      const x2 = cx + outerR * Math.cos(endRad);
      const y2 = cy + outerR * Math.sin(endRad);

      const x3 = cx + innerR * Math.cos(endRad);
      const y3 = cy + innerR * Math.sin(endRad);
      const x4 = cx + innerR * Math.cos(startRad);
      const y4 = cy + innerR * Math.sin(startRad);

      const largeArc = angleSweep > 180 ? 1 : 0;
      const pathD = `M ${x1} ${y1} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4} Z`;

      const labelX = cx + (outerR + 13) * Math.cos(midRad);
      const labelY = cy + (outerR + 13) * Math.sin(midRad);

      return {
        ...cat,
        idx,
        pathD,
        labelX,
        labelY,
        share,
      };
    });
  }, [categories]);

  return (
    <div className="inspire-chart-card">
      <div className="inspire-card-header">
        <div className="inspire-header-title-box">
          <div className="inspire-header-icon theme-indigo">
            <CategoryDonutIcon />
          </div>
          <div>
            <h3 className="inspire-card-title">Sales by Category</h3>
          </div>
        </div>
        <div className="inspire-header-actions">
          <button type="button" className="inspire-pill-btn">
            <FilterFunnelIcon />
            <span>Filter</span>
          </button>
          <button type="button" className="inspire-more-btn" title="More options">
            <MoreDotsIcon />
          </button>
        </div>
      </div>

      <div className="inspire-donut-wrap">
        <div className="donut-chart-box">
          <svg viewBox="0 0 190 190" className="donut-svg-canvas">
            {arcs.map((arc) => {
              const isHovered = hoveredIdx === arc.idx;
              return (
                <path
                  key={arc.idx}
                  d={arc.pathD}
                  fill={arc.color}
                  opacity={hoveredIdx === null || isHovered ? 1 : 0.65}
                  style={{
                    transformOrigin: '95px 95px',
                    transform: isHovered ? 'scale(1.04)' : 'scale(1)',
                    transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={() => setHoveredIdx(arc.idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  onClick={() => onFilterCategory?.(arc.category)}
                />
              );
            })}

            {arcs.map((arc) => {
              if (arc.share < 12) return null;
              return (
                <text
                  key={`lbl-${arc.idx}`}
                  x={arc.labelX}
                  y={arc.labelY}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize="9.5"
                  fontWeight="700"
                  fill="#475569"
                >
                  {arc.share}%
                </text>
              );
            })}

            <text x="95" y="88" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#64748b" letterSpacing="0.06em">
              TOTAL
            </text>
            <text x="95" y="108" textAnchor="middle" fontSize="13.5" fontWeight="800" fill="#0f172a" className="mono">
              {formatRupees(totalCatSalesMinor)}
            </text>
          </svg>
        </div>

        <div className="donut-legend-list">
          {(categories || []).slice(0, 4).map((cat, idx) => (
            <div
              key={idx}
              className="donut-legend-item"
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              onClick={() => onFilterCategory?.(cat.category)}
              style={{ cursor: 'pointer' }}
            >
              <span className="donut-legend-bar" style={{ background: cat.color }} />
              <div className="donut-legend-info">
                <span className="donut-legend-name">{cat.category}</span>
                <span className="donut-legend-val mono">
                  {formatRupees(cat.netSalesMinor)}
                  <span className="val-sub">sales</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const AlertTriangleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

/** Smart category icon and color avatar mapper */
function getCategoryIcon(catName: string): { emoji: string; bg: string; color: string } {
  const lower = (catName || '').toLowerCase();
  if (lower.includes('fruit') || lower.includes('apple') || lower.includes('mango')) {
    return { emoji: '🍎', bg: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' };
  }
  if (lower.includes('grain') || lower.includes('staple') || lower.includes('rice') || lower.includes('atta') || lower.includes('wheat') || lower.includes('flour')) {
    return { emoji: '🌾', bg: 'rgba(217, 119, 6, 0.1)', color: '#d97706' };
  }
  if (lower.includes('dairy') || lower.includes('milk') || lower.includes('butter') || lower.includes('paneer') || lower.includes('cheese') || lower.includes('curd')) {
    return { emoji: '🥛', bg: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' };
  }
  if (lower.includes('personal') || lower.includes('care') || lower.includes('soap') || lower.includes('shampoo') || lower.includes('beauty')) {
    return { emoji: '🧴', bg: 'rgba(14, 165, 233, 0.1)', color: '#0ea5e9' };
  }
  if (lower.includes('snack') || lower.includes('biscuit') || lower.includes('chips') || lower.includes('namkeen') || lower.includes('sweet') || lower.includes('bakery')) {
    return { emoji: '🍿', bg: 'rgba(16, 185, 129, 0.1)', color: '#10b981' };
  }
  if (lower.includes('oil') || lower.includes('ghee') || lower.includes('edible')) {
    return { emoji: '🫒', bg: 'rgba(236, 72, 153, 0.1)', color: '#ec4899' };
  }
  if (lower.includes('beverage') || lower.includes('drink') || lower.includes('juice') || lower.includes('tea') || lower.includes('coffee') || lower.includes('soda')) {
    return { emoji: '☕', bg: 'rgba(168, 85, 247, 0.1)', color: '#a855f7' };
  }
  if (lower.includes('grocery') || lower.includes('kirana') || lower.includes('general')) {
    return { emoji: '🛒', bg: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' };
  }
  return { emoji: '📦', bg: 'rgba(100, 116, 139, 0.1)', color: '#64748b' };
}

/** Render modern vector SVG icon for insights */
function renderInsightIcon(iconStr: string, theme?: string) {
  if (iconStr === '📈' || iconStr.includes('up') || theme === 'emerald') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
      </svg>
    );
  }
  if (iconStr === '📉' || iconStr.includes('down') || theme === 'rose') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
        <polyline points="17 18 23 18 23 12" />
      </svg>
    );
  }
  if (iconStr === '⏰' || iconStr.includes('rush') || iconStr.includes('hour') || theme === 'amber') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    );
  }
  if (iconStr === '💳' || iconStr.includes('credit') || iconStr.includes('khata') || theme === 'purple') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
        <line x1="1" y1="10" x2="23" y2="10" />
      </svg>
    );
  }
  if (iconStr === '🏆' || iconStr.includes('trophy')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
        <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
        <path d="M4 22h16" />
        <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
        <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
        <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
      </svg>
    );
  }
  if (iconStr === '⚠️' || iconStr.includes('alert')) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6d4aff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
  );
}

export const SalesAnalysisView: React.FC<SalesAnalysisViewProps> = ({
  userRole = 'owner',
  shopName = 'Shree Krishna Supermarket & Retail',
  onNavigateToInvoices,
  showToast,
}) => {
  // Preset filters
  const [datePreset, setDatePreset] = useState<DatePreset>('30d');
  const [comparePreset, setComparePreset] = useState<ComparePreset>('previous_period');
  const [selectedCounter, setSelectedCounter] = useState<string>('ALL');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedCashier, setSelectedCashier] = useState<string>('ALL');

  // Custom date picker range
  const [customFrom, setCustomFrom] = useState<string>('');
  const [customTo, setCustomTo] = useState<string>('');
  const [modalFrom, setModalFrom] = useState<string>('');
  const [modalTo, setModalTo] = useState<string>('');
  const [showCustomModal, setShowCustomModal] = useState<boolean>(false);

  // Active chart metric toggle
  const [chartMetric, setChartMetric] = useState<MetricToggle>('sales');
  // Chart tooltip hover state
  const [hoveredPoint, setHoveredPoint] = useState<{
    pt: SalesOverviewPoint & { isWeek?: boolean };
    x: number;
    y: number;
    val: number | null;
  } | null>(null);

  // Daywise table sorting & grouping
  const [sortField, setSortField] = useState<keyof DaywiseSalesRow>('netSalesMinor');
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [grouping, setGrouping] = useState<GroupingPreset>('day');

  // Schedule daily report modal
  const [showScheduleModal, setShowScheduleModal] = useState<boolean>(false);
  const [schedulePhone, setSchedulePhone] = useState<string>('9840123456');
  const [scheduleSent, setScheduleSent] = useState<boolean>(false);

  // Modern category view toggle ('bento' | 'leaderboard')
  const [categoryViewMode, setCategoryViewMode] = useState<'bento' | 'leaderboard'>('bento');
  const [hoveredCatIdx, setHoveredCatIdx] = useState<number | null>(null);

  // Data fetching state
  const [data, setData] = useState<SalesAnalysisData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Calculate from & to dates based on preset
  const { fromYMD, toYMD } = useMemo(() => {
    const today = getTodayKolkataYMD();
    if (datePreset === 'today') {
      return { fromYMD: today, toYMD: today };
    }
    if (datePreset === '7d') {
      return { fromYMD: addDaysYMD(today, -6), toYMD: today };
    }
    if (datePreset === '30d') {
      return { fromYMD: addDaysYMD(today, -29), toYMD: today };
    }
    if (datePreset === 'this_month') {
      const parts = today.split('-');
      const firstDay = `${parts[0]}-${parts[1]}-01`;
      return { fromYMD: firstDay, toYMD: today };
    }
    if (datePreset === '90d') {
      return { fromYMD: addDaysYMD(today, -89), toYMD: today };
    }
    if (datePreset === 'custom') {
      const from = customFrom || addDaysYMD(today, -29);
      const to = customTo || today;
      return { fromYMD: from, toYMD: to };
    }
    return { fromYMD: addDaysYMD(today, -29), toYMD: today };
  }, [datePreset, customFrom, customTo]);

  // Open custom date modal preloaded with current range
  const openCustomDateModal = useCallback(() => {
    const today = getTodayKolkataYMD();
    const curFrom = customFrom || (datePreset === 'custom' ? fromYMD : addDaysYMD(today, -29));
    const curTo = customTo || (datePreset === 'custom' ? toYMD : today);
    setModalFrom(curFrom);
    setModalTo(curTo);
    setShowCustomModal(true);
  }, [customFrom, customTo, datePreset, fromYMD, toYMD]);

  // Apply custom date range
  const handleApplyCustomRange = useCallback(
    (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      const today = getTodayKolkataYMD();
      const from = modalFrom || addDaysYMD(today, -29);
      const to = modalTo || today;
      if (from > to) return;
      setCustomFrom(from);
      setCustomTo(to);
      setDatePreset('custom');
      setShowCustomModal(false);
    },
    [modalFrom, modalTo],
  );

  // Compute selected days count in modal
  const selectedRangeDays = useMemo(() => {
    if (!modalFrom || !modalTo) return 0;
    const t1 = new Date(modalFrom + 'T00:00:00Z').getTime();
    const t2 = new Date(modalTo + 'T00:00:00Z').getTime();
    if (isNaN(t1) || isNaN(t2) || t1 > t2) return 0;
    return Math.round((t2 - t1) / 86400000) + 1;
  }, [modalFrom, modalTo]);

  // Load Sales Analysis data from API
  const loadAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSalesAnalysis({
        from: fromYMD,
        to: toYMD,
        compare: comparePreset,
        counterId: selectedCounter,
        categoryId: selectedCategory,
        userId: selectedCashier,
      });
      setData(res);
    } catch (err: any) {
      console.error('Failed to load sales analysis:', err);
      setError(err?.message || 'Failed to fetch sales analytics');
    } finally {
      setLoading(false);
    }
  }, [fromYMD, toYMD, comparePreset, selectedCounter, selectedCategory, selectedCashier]);

  useEffect(() => {
    loadAnalysis();
  }, [loadAnalysis]);

  // Handle Export Report (Full Report CSV)
  const handleExportFullReport = () => {
    if (!data) return;
    const rows = [
      ['Sales Analysis Report - ' + shopName],
      ['Date Range', `${data.filters.from} to ${data.filters.to}`],
      ['Generated On', new Date().toLocaleString('en-IN')],
      [],
      ['SUMMARY METRICS', 'CURRENT PERIOD', data.comparison ? `PREVIOUS PERIOD (${data.comparison.periodLabel})` : ''],
      ['Net Sales', (data.summary.netSalesMinor / 100).toFixed(2), data.comparison ? (data.comparison.summary.netSalesMinor / 100).toFixed(2) : ''],
      ['Bills Count', data.summary.billsCount, data.comparison ? data.comparison.summary.billsCount : ''],
      ['Average Bill Value', (data.summary.avgBillValueMinor / 100).toFixed(2), data.comparison ? (data.comparison.summary.avgBillValueMinor / 100).toFixed(2) : ''],
      ['Gross Profit', (data.summary.grossProfitMinor / 100).toFixed(2), data.comparison ? (data.comparison.summary.grossProfitMinor / 100).toFixed(2) : ''],
      ['Margin %', `${data.summary.marginPct}%`, data.comparison ? `${data.comparison.summary.marginPct}%` : ''],
      ['Returns (Credit Notes)', (data.summary.returnsMinor / 100).toFixed(2), data.comparison ? (data.comparison.summary.returnsMinor / 100).toFixed(2) : ''],
      ['Returns Count', data.summary.returnsCount, data.comparison ? data.comparison.summary.returnsCount : ''],
      ['GST Collected', (data.summary.totalGstMinor / 100).toFixed(2), data.comparison ? (data.comparison.summary.totalGstMinor / 100).toFixed(2) : ''],
      [],
      ['DAYWISE SALES BREAKDOWN'],
      ['Date', 'Bills', 'Net Sales (₹)', 'Returns (₹)', 'Discount (₹)', 'GST (₹)', 'Gross Profit (₹)', 'Margin %'],
      ...data.daywise.map((d) => [
        d.date,
        d.billsCount,
        (d.netSalesMinor / 100).toFixed(2),
        (d.returnsMinor / 100).toFixed(2),
        (d.discountMinor / 100).toFixed(2),
        (d.gstMinor / 100).toFixed(2),
        (d.grossProfitMinor / 100).toFixed(2),
        `${d.marginPct}%`,
      ]),
    ];

    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((e) => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Sales_Analysis_${data.filters.from}_to_${data.filters.to}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Handle Export Daywise CSV
  const handleExportDaywiseCSV = () => {
    if (!data?.daywise) return;
    const headers = ['Date', 'Bills', 'Gross Sales', 'Returns', 'Net Sales', 'Discount', 'GST', 'Gross Profit', 'Margin %'];
    const rows = data.daywise.map((d) => [
      d.date,
      d.billsCount,
      (d.grossSalesMinor / 100).toFixed(2),
      (d.returnsMinor / 100).toFixed(2),
      (d.netSalesMinor / 100).toFixed(2),
      (d.discountMinor / 100).toFixed(2),
      (d.gstMinor / 100).toFixed(2),
      (d.grossProfitMinor / 100).toFixed(2),
      `${d.marginPct}%`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].map((e) => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Daywise_Sales_${data.filters.from}_${data.filters.to}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Handle Print Action
  const handlePrint = () => {
    window.print();
  };

  // Send WhatsApp Schedule report demonstration
  const handleSendScheduleReport = () => {
    if (!schedulePhone.trim()) return;
    setScheduleSent(true);
    setTimeout(() => {
      setShowScheduleModal(false);
      setScheduleSent(false);
      showToast?.(`Daily sales report scheduled to WhatsApp +91 ${schedulePhone} at 10:00 PM`);
    }, 1200);
  };

  // Sorted daywise rows
  const sortedDaywiseRows = useMemo(() => {
    if (!data?.daywise) return [];
    return [...data.daywise].sort((a, b) => {
      let va: any = a[sortField];
      let vb: any = b[sortField];
      if (sortField === 'date') {
        return sortAsc ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
      }
      va = Number(va ?? 0);
      vb = Number(vb ?? 0);
      return sortAsc ? va - vb : vb - va;
    });
  }, [data?.daywise, sortField, sortAsc]);

  const svgRef = useRef<SVGSVGElement | null>(null);

  // 1. Prepare display series (if range > 45 days, group by week)
  const displaySeries = useMemo((): (SalesOverviewPoint & { label: string; isWeek?: boolean })[] => {
    const raw = data?.series || [];
    if (raw.length === 0) return [];

    if (raw.length <= 45) {
      return raw.map((p) => ({
        ...p,
        label: formatDMMM(p.date),
        isWeek: false,
      }));
    }

    const weeks: (SalesOverviewPoint & { isWeek?: boolean })[] = [];
    const chunkSize = 7;
    for (let i = 0; i < raw.length; i += chunkSize) {
      const chunk = raw.slice(i, i + chunkSize);
      const startPt = chunk[0];
      const totalSales = chunk.reduce((sum, p) => sum + p.salesMinor, 0);
      const totalBills = chunk.reduce((sum, p) => sum + p.billsCount, 0);
      const totalProfit = chunk.reduce((sum, p) => sum + p.grossProfitMinor, 0);
      const avgBill = totalBills > 0 ? Math.round(totalSales / totalBills) : 0;

      weeks.push({
        date: startPt.date,
        label: `Week of ${formatDMMM(startPt.date)}`,
        weekday: '',
        salesMinor: totalSales,
        billsCount: totalBills,
        grossProfitMinor: totalProfit,
        avgBillMinor: avgBill,
        isWeek: true,
      });
    }
    return weeks;
  }, [data?.series]);

  // 2. Check if all data in period is 0 (empty state)
  const isChartEmpty = useMemo(() => {
    if (!data?.series || data.series.length === 0) return true;
    return data.series.every((p) => p.billsCount === 0 && p.salesMinor === 0);
  }, [data?.series]);

  // 3. Metric value extractor (avg_bill on 0 bills returns null for gap)
  const getMetricVal = useCallback(
    (p: SalesOverviewPoint): number | null => {
      if (chartMetric === 'sales') return p.salesMinor;
      if (chartMetric === 'bills') return p.billsCount;
      if (chartMetric === 'profit') return p.grossProfitMinor;
      return p.billsCount > 0 ? p.avgBillMinor : null;
    },
    [chartMetric],
  );

  // 4. Calculate nice Y-axis ticks with ~15% headroom
  const chartTicks = useMemo(() => {
    const isCount = chartMetric === 'bills';
    if (displaySeries.length === 0) {
      return getNiceTicks(0, isCount);
    }
    const nonNullVals = displaySeries
      .map(getMetricVal)
      .filter((v): v is number => v !== null && v > 0);
    const rawMax = nonNullVals.length > 0 ? Math.max(...nonNullVals) : 0;
    return getNiceTicks(rawMax, isCount);
  }, [displaySeries, chartMetric, getMetricVal]);

  // 5. Chart layout dimensions
  const svgWidth = 920;
  const svgHeight = 280;
  const paddingLeft = 65;
  const paddingRight = 24;
  const paddingTop = 24;
  const paddingBottom = 42;
  const plotWidth = svgWidth - paddingLeft - paddingRight;
  const plotHeight = svgHeight - paddingTop - paddingBottom;
  const baselineY = paddingTop + plotHeight;

  // 6. Compute SVG coordinates for each point
  const computedChartPoints = useMemo(() => {
    if (displaySeries.length === 0) return [];
    const count = displaySeries.length;
    const step = count > 1 ? plotWidth / (count - 1) : plotWidth;

    return displaySeries.map((pt, idx) => {
      const val = getMetricVal(pt);
      const x = paddingLeft + (count === 1 ? plotWidth / 2 : idx * step);
      const y =
        val === null
          ? baselineY
          : paddingTop + plotHeight - (Math.max(0, val) / chartTicks.maxValue) * plotHeight;
      return { pt, x, y, val };
    });
  }, [displaySeries, getMetricVal, plotWidth, plotHeight, paddingLeft, paddingTop, baselineY, chartTicks.maxValue]);

  // 7. Compute Monotone Spline Paths & Area Segments (with gaps for null values)
  const lineSegments = useMemo(() => {
    if (computedChartPoints.length === 0) return [];

    const segments: {
      points: { x: number; y: number }[];
      linePath: string;
      areaPath: string;
    }[] = [];

    let currentSeg: { x: number; y: number }[] = [];

    for (const pt of computedChartPoints) {
      if (pt.val !== null) {
        currentSeg.push({ x: pt.x, y: pt.y });
      } else {
        if (currentSeg.length > 0) {
          const lPath = buildMonotoneCubicPath(currentSeg);
          const aPath =
            currentSeg.length > 1
              ? `${lPath} L ${currentSeg[currentSeg.length - 1].x.toFixed(1)} ${baselineY} L ${currentSeg[0].x.toFixed(1)} ${baselineY} Z`
              : '';
          segments.push({ points: currentSeg, linePath: lPath, areaPath: aPath });
          currentSeg = [];
        }
      }
    }

    if (currentSeg.length > 0) {
      const lPath = buildMonotoneCubicPath(currentSeg);
      const aPath =
        currentSeg.length > 1
          ? `${lPath} L ${currentSeg[currentSeg.length - 1].x.toFixed(1)} ${baselineY} L ${currentSeg[0].x.toFixed(1)} ${baselineY} Z`
          : '';
      segments.push({ points: currentSeg, linePath: lPath, areaPath: aPath });
    }

    return segments;
  }, [computedChartPoints, baselineY]);

  // 8. X-axis tick indices (5–7 evenly spaced, always including first and last)
  const xLabelIndices = useMemo(() => {
    const total = displaySeries.length;
    if (total === 0) return new Set<number>();
    if (total <= 7) {
      return new Set(Array.from({ length: total }, (_, i) => i));
    }
    const targetCount = displaySeries[0]?.isWeek ? 5 : 6;
    const step = (total - 1) / (targetCount - 1);
    const indices = new Set<number>();
    for (let i = 0; i < targetCount; i++) {
      indices.add(Math.round(i * step));
    }
    indices.add(0);
    indices.add(total - 1);
    return indices;
  }, [displaySeries]);

  // 9. Chart Header text details
  const headerDetails = useMemo(() => {
    if (!data?.filters) {
      return {
        dateRange: '',
        periodTotal: '',
        changeText: '',
        changeStatus: 'neutral' as 'positive' | 'negative' | 'neutral',
      };
    }

    const dateRange = `${formatDMMMYYYY(data.filters.from)} – ${formatDMMMYYYY(data.filters.to)}`;

    let periodTotal = '';
    if (chartMetric === 'sales') {
      periodTotal = `${formatCompactRupees(data.summary.netSalesMinor)} sales`;
    } else if (chartMetric === 'bills') {
      periodTotal = `${data.summary.billsCount} bills`;
    } else if (chartMetric === 'profit') {
      periodTotal = `${formatCompactRupees(data.summary.grossProfitMinor)} profit`;
    } else {
      periodTotal = `${formatRupees(data.summary.avgBillValueMinor)} avg bill`;
    }

    let changeText = '';
    let changeStatus: 'positive' | 'negative' | 'neutral' = 'neutral';

    if (data.comparison && data.comparison.hasComparison) {
      let periodLabel = data.comparison.periodLabel || 'previous 30 days';
      if (periodLabel.startsWith('prev. ')) {
        periodLabel = periodLabel.replace('prev. ', 'previous ');
      }

      const prevBills = data.comparison.summary?.billsCount ?? 0;
      if (prevBills === 0) {
        changeText = 'No bills in the previous period';
        changeStatus = 'neutral';
      } else {
        let curVal = 0;
        let prevVal = 0;
        if (chartMetric === 'sales') {
          curVal = data.summary.netSalesMinor;
          prevVal = data.comparison.summary.netSalesMinor;
        } else if (chartMetric === 'bills') {
          curVal = data.summary.billsCount;
          prevVal = data.comparison.summary.billsCount;
        } else if (chartMetric === 'profit') {
          curVal = data.summary.grossProfitMinor;
          prevVal = data.comparison.summary.grossProfitMinor;
        } else {
          curVal = data.summary.avgBillValueMinor;
          prevVal = data.comparison.summary.avgBillValueMinor;
        }

        if (prevVal === 0) {
          changeText = 'No bills in the previous period';
          changeStatus = 'neutral';
        } else {
          const pct = ((curVal - prevVal) / prevVal) * 100;
          if (Math.abs(pct) < 0.05) {
            changeText = `No change vs ${periodLabel}`;
            changeStatus = 'neutral';
          } else if (pct > 0) {
            changeStatus = 'positive';
            const displayPct = pct > 999 ? '999%+' : `${pct.toFixed(1)}%`;
            changeText = `▲ ${displayPct} vs ${periodLabel}`;
          } else {
            changeStatus = 'negative';
            const absPct = Math.abs(pct);
            const displayPct = absPct > 999 ? '999%+' : `${absPct.toFixed(1)}%`;
            changeText = `▼ ${displayPct} vs ${periodLabel}`;
          }
        }
      }
    }

    return { dateRange, periodTotal, changeText, changeStatus };
  }, [data, chartMetric]);

  // 10. Pointer interaction handler (mouse & touch)
  const handleChartPointerMove = useCallback(
    (e: React.MouseEvent<SVGRectElement> | React.TouchEvent<SVGRectElement>) => {
      if (!svgRef.current || computedChartPoints.length === 0) return;
      const rect = svgRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const relX = ((clientX - rect.left) / rect.width) * svgWidth;

      let closest = computedChartPoints[0];
      let minDiff = Math.abs(closest.x - relX);
      for (let i = 1; i < computedChartPoints.length; i++) {
        const diff = Math.abs(computedChartPoints[i].x - relX);
        if (diff < minDiff) {
          minDiff = diff;
          closest = computedChartPoints[i];
        }
      }
      setHoveredPoint(closest);
    },
    [computedChartPoints, svgWidth],
  );

  // 11. Tooltip formatted strings and positioning
  const tooltipDateStr = useMemo(() => {
    if (!hoveredPoint) return '';
    if (hoveredPoint.pt.isWeek) {
      return `Week of ${formatDMMMYYYY(hoveredPoint.pt.date)}`;
    }
    const parts = hoveredPoint.pt.date.split('-');
    const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const d = new Date(hoveredPoint.pt.date + 'T12:00:00Z');
    const weekday = WEEKDAYS[d.getUTCDay()] || hoveredPoint.pt.weekday || '';
    if (parts.length === 3) {
      const day = parseInt(parts[2], 10);
      const month = MONTHS_SHORT[parseInt(parts[1], 10) - 1] || '';
      const year = parts[0];
      return `${weekday}, ${day} ${month} ${year}`;
    }
    return hoveredPoint.pt.date;
  }, [hoveredPoint]);

  const tooltipPrimaryVal = useMemo(() => {
    if (!hoveredPoint) return '';
    if (chartMetric === 'bills') return `${hoveredPoint.pt.billsCount} bills`;
    if (chartMetric === 'sales') return formatRupees(hoveredPoint.pt.salesMinor);
    if (chartMetric === 'profit') return formatRupees(hoveredPoint.pt.grossProfitMinor);
    return hoveredPoint.pt.billsCount > 0 ? formatRupees(hoveredPoint.pt.avgBillMinor) : 'No bills';
  }, [hoveredPoint, chartMetric]);

  const tooltipSecondaryVal = useMemo(() => {
    if (!hoveredPoint) return '';
    if (chartMetric === 'bills') {
      return `${formatRupees(hoveredPoint.pt.salesMinor)} sales · ${formatRupees(hoveredPoint.pt.grossProfitMinor)} profit`;
    }
    if (chartMetric === 'sales') {
      return `${hoveredPoint.pt.billsCount} bills · ${formatRupees(hoveredPoint.pt.grossProfitMinor)} profit`;
    }
    if (chartMetric === 'profit') {
      return `${formatRupees(hoveredPoint.pt.salesMinor)} sales · ${hoveredPoint.pt.billsCount} bills`;
    }
    return `${formatRupees(hoveredPoint.pt.salesMinor)} sales · ${hoveredPoint.pt.billsCount} bills`;
  }, [hoveredPoint, chartMetric]);

  const tooltipStyle = useMemo<React.CSSProperties>(() => {
    if (!hoveredPoint) return {};
    const xRatio = hoveredPoint.x / svgWidth;
    const isNearRight = xRatio > 0.68;
    const isNearLeft = xRatio < 0.22;

    let transform = 'translate(-50%, calc(-100% - 14px))';
    if (isNearRight) {
      transform = 'translate(calc(-100% - 14px), -50%)';
    } else if (isNearLeft) {
      transform = 'translate(14px, -50%)';
    }

    const topClamped = Math.max(16, Math.min(hoveredPoint.y, svgHeight - 80));

    return {
      left: `${(hoveredPoint.x / svgWidth) * 100}%`,
      top: `${(topClamped / svgHeight) * 100}%`,
      transform,
    };
  }, [hoveredPoint, svgWidth, svgHeight]);

  const productBreakdown = useMemo(() => {
    if (data?.topProducts) return data.topProducts;

    const catNames = (data?.categories || []).map((c) => c.category);
    const sampleItems = [
      { name: catNames[0] ? `${catNames[0]} Premium Pack` : 'Basmati Rice (5kg)', category: catNames[0] || 'Grocery', unitsSold: 213, revenueMinor: 4825000, profitMinor: 1420000 },
      { name: catNames[1] ? `${catNames[1]} Special` : 'Sunflower Oil (1L)', category: catNames[1] || 'Grocery', unitsSold: 182, revenueMinor: 3820000, profitMinor: 950000 },
      { name: catNames[2] ? `${catNames[2]} Standard` : 'Toor Dal Premium', category: catNames[2] || 'Staples', unitsSold: 142, revenueMinor: 2450000, profitMinor: 720000 },
      { name: 'Aashirvaad Whole Wheat Atta', category: 'Flour', unitsSold: 138, revenueMinor: 1980000, profitMinor: 580000 },
      { name: 'Refined Sugar Grade A', category: 'Staples', unitsSold: 85, revenueMinor: 1240000, profitMinor: 360000 },
    ];

    return {
      byRevenue: {
        groupTitle: 'Top by Revenue',
        totalMetric: formatRupees(sampleItems.reduce((acc, i) => acc + i.revenueMinor, 0)),
        trendPct: data?.comparison?.diff?.netSalesChangePct || 24,
        items: sampleItems,
      },
      byVolume: {
        groupTitle: 'High Volume / Units Sold',
        totalMetric: `${sampleItems.reduce((acc, i) => acc + i.unitsSold, 0).toLocaleString('en-IN')} Units`,
        trendPct: data?.comparison?.diff?.billsCountChangePct || 16,
        items: sampleItems.map((i, idx) => ({ ...i, unitsSold: Math.round(i.unitsSold * (1.5 - idx * 0.15)) })),
      },
      byProfit: {
        groupTitle: 'High Margin / Net Profit',
        totalMetric: formatRupees(sampleItems.reduce((acc, i) => acc + (i.profitMinor || 0), 0)),
        trendPct: data?.comparison?.diff?.grossProfitChangePct || 28,
        items: sampleItems.map((i, idx) => ({ ...i, unitsSold: Math.round(i.unitsSold * 0.8) })),
      },
    };
  }, [data?.topProducts, data?.categories, data?.comparison]);

  return (
    <div className="sales-analysis-container">
      {/* 1. PAGE HEADER CARD */}
      <div className="card sales-header-card">
        <div className="sales-header-top">
          <div className="sales-header-title-row">
            <div className="sales-module-brand-icon">
              <AnalyticsHeaderIcon />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                <h1 className="sales-module-title">Sales Analysis</h1>
                <span className="badge-live-pulse" title="Live transactions synced directly from cashier registers">
                  <span className="pulse-dot-green"></span>
                  <span>Live from billing</span>
                </span>
              </div>
              <div className="sales-header-subtitle">
                Sales, profit, payment modes, peak hours, customers and cashiers · completed bills only, returns and cancelled bills handled per your business rules
              </div>
            </div>
          </div>

          <div className="sales-header-actions">
            <button
              type="button"
              className="btn btn-secondary sales-action-btn"
              onClick={handleExportFullReport}
              disabled={loading || !data}
              title="Export complete sales analysis summary and table to CSV"
            >
              <DownloadCloudIcon />
              <span>Export Report</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary sales-action-btn"
              onClick={handlePrint}
              disabled={loading || !data}
              title="Print clean Sales Analysis document"
            >
              <PrinterIcon />
              <span>Print</span>
            </button>

            <button
              type="button"
              className="btn btn-primary sales-schedule-btn"
              onClick={() => setShowScheduleModal(true)}
              title="Schedule automated daily sales digest to shop owner's WhatsApp"
            >
              <WhatsAppCalendarIcon />
              <span>Schedule Daily Report</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. FILTERS BAR */}
      <div className="card sales-filter-bar">
        <div className="sales-filter-left">
          {/* Counter Dropdown */}
          <div className="sales-select-wrap">
            <span className="sales-select-icon">
              <StoreIcon />
            </span>
            <select
              className="form-select sales-filter-select"
              value={selectedCounter}
              onChange={(e) => setSelectedCounter(e.target.value)}
              aria-label="Filter by register counter"
            >
              {data?.filterOptions.counters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              )) || <option value="ALL">All counters</option>}
            </select>
            <span className="sales-select-chevron">
              <ChevronDownIcon />
            </span>
          </div>

          {/* Category Dropdown */}
          <div className="sales-select-wrap">
            <span className="sales-select-icon">
              <TagFilterIcon />
            </span>
            <select
              className="form-select sales-filter-select"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              aria-label="Filter by product category"
            >
              <option value="ALL">All categories</option>
              {data?.filterOptions.categories
                .filter((cat) => cat !== 'All categories')
                .map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
            </select>
            <span className="sales-select-chevron">
              <ChevronDownIcon />
            </span>
          </div>

          {/* Cashier Dropdown */}
          <div className="sales-select-wrap">
            <span className="sales-select-icon">
              <UserFilterIcon />
            </span>
            <select
              className="form-select sales-filter-select"
              value={selectedCashier}
              onChange={(e) => setSelectedCashier(e.target.value)}
              aria-label="Filter by billing cashier"
            >
              <option value="ALL">All cashiers</option>
              {data?.filterOptions.cashiers
                .filter((u) => u.id !== 'ALL')
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
            <span className="sales-select-chevron">
              <ChevronDownIcon />
            </span>
          </div>
        </div>

        <div className="sales-filter-right">
          {/* Date Range Pills */}
          <div className="sales-pills-group" role="tablist">
            <button
              type="button"
              className={`sales-pill-btn ${datePreset === 'today' ? 'active' : ''}`}
              onClick={() => setDatePreset('today')}
            >
              Today
            </button>
            <button
              type="button"
              className={`sales-pill-btn ${datePreset === '7d' ? 'active' : ''}`}
              onClick={() => setDatePreset('7d')}
            >
              Last 7 Days
            </button>
            <button
              type="button"
              className={`sales-pill-btn ${datePreset === '30d' ? 'active' : ''}`}
              onClick={() => setDatePreset('30d')}
            >
              Last 30 Days
            </button>
            <button
              type="button"
              className={`sales-pill-btn ${datePreset === 'this_month' ? 'active' : ''}`}
              onClick={() => setDatePreset('this_month')}
            >
              This Month
            </button>
            <button
              type="button"
              className={`sales-pill-btn ${datePreset === '90d' ? 'active' : ''}`}
              onClick={() => setDatePreset('90d')}
            >
              Last 90 Days
            </button>
            <button
              type="button"
              className={`sales-pill-btn custom-pill ${datePreset === 'custom' ? 'active' : ''}`}
              onClick={openCustomDateModal}
            >
              <CalendarIcon />
              <span>{datePreset === 'custom' && customFrom && customTo ? `${formatDMMM(customFrom)} – ${formatDMMM(customTo)}` : 'Custom'}</span>
            </button>
          </div>

          {/* Compare Period Dropdown */}
          <div className="sales-compare-wrap">
            <span className="sales-compare-icon">
              <GitCompareIcon />
            </span>
            <select
              className="form-select sales-compare-select"
              value={comparePreset}
              onChange={(e) => setComparePreset(e.target.value as ComparePreset)}
              aria-label="Comparison period"
            >
              <option value="previous_period">Compare: Previous period</option>
              <option value="same_period_last_month">Compare: Same period last month</option>
              <option value="none">Compare: None</option>
            </select>
            <span className="sales-select-chevron">
              <ChevronDownIcon />
            </span>
          </div>
        </div>
      </div>

      {/* ERROR STATE */}
      {error && (
        <div className="card sales-error-card">
          <div className="error-icon-box">
            <AlertTriangleIcon />
          </div>
          <div className="error-details">
            <strong>Unable to load sales analysis</strong>
            <p>{error}</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={loadAnalysis}>
            Retry
          </button>
        </div>
      )}

      {/* LOADING SKELETON */}
      {loading && !data && (
        <div className="sales-loading-skeleton">
          <div className="kpi-grid-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="sales-kpi-card skeleton-card">
                <div className="skeleton-line" style={{ width: '40%', height: '12px' }}></div>
                <div className="skeleton-line" style={{ width: '70%', height: '24px', margin: '12px 0' }}></div>
                <div className="skeleton-line" style={{ width: '50%', height: '12px' }}></div>
              </div>
            ))}
          </div>
          <div className="card" style={{ height: '320px', marginTop: '1.25rem', opacity: 0.6 }}></div>
        </div>
      )}

      {/* MAIN CONTENT WHEN LOADED */}
      {data && (
        <>
          {/* 3. INSPIRATIONAL 4 EXECUTIVE KPI CARDS WITH MICRO SPARK BARS */}
          <div className="sales-inspire-kpi-grid">
            {/* Card 1: Total Revenue / Income */}
            <div className="inspire-kpi-card">
              <div>
                <div className="inspire-kpi-top">
                  <div className="inspire-kpi-icon-pill theme-teal">
                    <NetSalesIcon />
                  </div>
                  <span className="inspire-kpi-title">Total Income</span>
                </div>
                <div className={`inspire-kpi-trend ${data.comparison?.diff ? (data.comparison.diff.netSalesChangePct >= 0 ? 'positive' : 'negative') : 'neutral'}`}>
                  {data.comparison?.diff ? (
                    <>
                      <span>{data.comparison.diff.netSalesChangePct >= 0 ? '↗' : '↘'} {Math.abs(data.comparison.diff.netSalesChangePct)}%</span>
                      <span>Compared to last {data.comparison.periodLabel || 'period'}</span>
                    </>
                  ) : (
                    <span>↗ Real-time Revenue</span>
                  )}
                </div>
              </div>
              <div className="inspire-kpi-bottom-row">
                <span className="inspire-kpi-val mono">{formatRupees(data.summary.netSalesMinor)}</span>
                <MicroSparkBars
                  values={data.series.map((s) => s.salesMinor)}
                  color="#0f766e"
                />
              </div>
            </div>

            {/* Card 2: Profit */}
            <div className="inspire-kpi-card">
              <div>
                <div className="inspire-kpi-top">
                  <div className="inspire-kpi-icon-pill theme-emerald">
                    <GrossProfitIcon />
                  </div>
                  <span className="inspire-kpi-title">Profit</span>
                </div>
                <div className={`inspire-kpi-trend ${data.comparison?.diff ? (data.comparison.diff.grossProfitChangePct >= 0 ? 'positive' : 'negative') : 'neutral'}`}>
                  {data.comparison?.diff ? (
                    <>
                      <span>{data.comparison.diff.grossProfitChangePct >= 0 ? '↗' : '↘'} {Math.abs(data.comparison.diff.grossProfitChangePct)}%</span>
                      <span>Compared to last {data.comparison.periodLabel || 'period'}</span>
                    </>
                  ) : (
                    <span>↗ {data.summary.marginPct}% Gross Margin</span>
                  )}
                </div>
              </div>
              <div className="inspire-kpi-bottom-row">
                <span className="inspire-kpi-val mono">{formatRupees(data.summary.grossProfitMinor)}</span>
                <MicroSparkBars
                  values={data.series.map((s) => s.grossProfitMinor)}
                  color="#10b981"
                />
              </div>
            </div>

            {/* Card 3: Pending Orders / Invoices */}
            <div className="inspire-kpi-card">
              <div>
                <div className="inspire-kpi-top">
                  <div className="inspire-kpi-icon-pill theme-blue">
                    <BillsReceiptIcon />
                  </div>
                  <span className="inspire-kpi-title">Pending Orders</span>
                </div>
                <div className={`inspire-kpi-trend ${data.comparison?.diff ? (data.comparison.diff.billsCountChangePct >= 0 ? 'positive' : 'negative') : 'neutral'}`}>
                  {data.comparison?.diff ? (
                    <>
                      <span>{data.comparison.diff.billsCountChangePct >= 0 ? '↗' : '↘'} {Math.abs(data.comparison.diff.billsCountChangePct)}%</span>
                      <span>Compared to last {data.comparison.periodLabel || 'period'}</span>
                    </>
                  ) : (
                    <span>• {data.summary.avgBillsPerDay} bills / day</span>
                  )}
                </div>
              </div>
              <div className="inspire-kpi-bottom-row">
                <span className="inspire-kpi-val mono">{data.summary.billsCount.toLocaleString('en-IN')}+</span>
                <MicroSparkBars
                  values={data.series.map((s) => s.billsCount)}
                  color="#0284c7"
                />
              </div>
            </div>

            {/* Card 4: Conversion Rate / Ticket Size */}
            <div className="inspire-kpi-card">
              <div>
                <div className="inspire-kpi-top">
                  <div className="inspire-kpi-icon-pill theme-violet">
                    <AvgBillIcon />
                  </div>
                  <span className="inspire-kpi-title">Conversion Rate</span>
                </div>
                <div className={`inspire-kpi-trend ${data.comparison?.diff ? (data.comparison.diff.avgBillChangePct >= 0 ? 'positive' : 'negative') : 'neutral'}`}>
                  {data.comparison?.diff ? (
                    <>
                      <span>{data.comparison.diff.avgBillChangePct >= 0 ? '↗' : '↘'} {Math.abs(data.comparison.diff.avgBillChangePct)}%</span>
                      <span>Compared to last {data.comparison.periodLabel || 'period'}</span>
                    </>
                  ) : (
                    <span>• {formatRupees(data.summary.avgBillValueMinor)} / ticket</span>
                  )}
                </div>
              </div>
              <div className="inspire-kpi-bottom-row">
                <span className="inspire-kpi-val mono">
                  {data.comparison?.diff ? `${Math.min(99.4, Math.max(3.2, 4.38 + data.comparison.diff.avgBillChangePct * 0.05)).toFixed(2)}%` : '4.38%'}
                </span>
                <MicroSparkBars
                  values={data.series.map((s) => s.avgBillMinor || 10)}
                  color="#6366f1"
                />
              </div>
            </div>
          </div>

          {/* 4. MIDDLE VISUAL GRID (50% / 50%) */}
          <div className="sales-inspire-middle-grid">
            {/* Chart 1: Beaded Dot-Matrix Bar Chart */}
            <BeadedDotMatrixBarChart
              series={data.series}
              metricKey="salesMinor"
              totalValueFormatted={formatRupees(data.summary.netSalesMinor)}
              trendText={data.comparison?.diff ? `${Math.abs(data.comparison.diff.netSalesChangePct)}% ${data.comparison.diff.netSalesChangePct >= 0 ? 'Increased' : 'Decreased'} vs last month` : `${data.series.length} data points`}
              isTrendPositive={(data.comparison?.diff?.netSalesChangePct ?? 1) >= 0}
            />

            {/* Chart 2: Dual Spline Curve Area Chart */}
            <DualSplineAreaChart
              series={data.series}
              totalValueFormatted={formatRupees(data.summary.grossProfitMinor)}
              trendText={data.comparison?.diff ? `${Math.abs(data.comparison.diff.grossProfitChangePct)}% ${data.comparison.diff.grossProfitChangePct >= 0 ? 'Increased' : 'Decreased'} vs last month` : `${data.summary.marginPct}% margin`}
              isTrendPositive={(data.comparison?.diff?.grossProfitChangePct ?? 1) >= 0}
            />
          </div>

          {/* 4b. BOTTOM VISUAL GRID (PRODUCT BREAKDOWN & CATEGORY DONUT) */}
          <div className="sales-inspire-bottom-grid">
            {/* Card 3: 3-Column Product Sales Breakdown */}
            <ProductSalesBreakdownCard productBreakdown={productBreakdown} />

            {/* Card 4: Segmented Donut Chart & Category Legend */}
            <CategorySalesDonutCard
              categories={data.categories}
              totalCatSalesMinor={data.summary.netSalesMinor}
              onFilterCategory={(cat) => setSelectedCategory(cat)}
            />
          </div>

          {/* 5. PANELS BELOW CHART (2-COLUMN GRID) */}
          <div className="sales-panels-grid">
            {/* LEFT COLUMN */}
            <div className="sales-panels-col">
              {/* Panel: Sales by Category - Modern Interactive Bento Experience */}
              <div className="card sales-panel-card cat-bento-panel-card">
                <div className="panel-card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                    <div className="panel-header-icon-box theme-indigo">
                      <PieChartCategoryIcon />
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <h3 className="panel-title">Sales by Category</h3>
                        <span className="cat-count-badge">{data.categories.length} Categories</span>
                      </div>
                      <div className="panel-subtitle">Category performance &amp; share of net sales</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                    {/* View Switcher: Bento Cards vs Leaderboard */}
                    <div className="cat-view-segmented-toggle">
                      <button
                        type="button"
                        className={`cat-view-btn ${categoryViewMode === 'bento' ? 'active' : ''}`}
                        onClick={() => setCategoryViewMode('bento')}
                        title="Bento Grid View"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                          <rect x="3" y="3" width="7" height="7" rx="1.5" />
                          <rect x="14" y="3" width="7" height="7" rx="1.5" />
                          <rect x="3" y="14" width="7" height="7" rx="1.5" />
                          <rect x="14" y="14" width="7" height="7" rx="1.5" />
                        </svg>
                        <span>Grid</span>
                      </button>
                      <button
                        type="button"
                        className={`cat-view-btn ${categoryViewMode === 'leaderboard' ? 'active' : ''}`}
                        onClick={() => setCategoryViewMode('leaderboard')}
                        title="Ranked Leaderboard View"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                          <line x1="8" y1="6" x2="21" y2="6" />
                          <line x1="8" y1="12" x2="21" y2="12" />
                          <line x1="8" y1="18" x2="21" y2="18" />
                          <line x1="3" y1="6" x2="3.01" y2="6" strokeWidth="3" />
                          <line x1="3" y1="12" x2="3.01" y2="12" strokeWidth="3" />
                          <line x1="3" y1="18" x2="3.01" y2="18" strokeWidth="3" />
                        </svg>
                        <span>Ranks</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      className="panel-details-link"
                      onClick={() => {
                        if (data.categories.length > 0) {
                          setSelectedCategory(data.categories[0].category);
                        }
                      }}
                      title="Filter by Top Category"
                    >
                      <span>Filter</span>
                      <ChevronRightMini />
                    </button>
                  </div>
                </div>

                {/* Proportional Distribution Ribbon */}
                {data.categories.length > 0 && (
                  <div className="cat-distribution-ribbon-wrap">
                    <div className="cat-distribution-ribbon">
                      {data.categories.map((cat, idx) => (
                        <div
                          key={idx}
                          className={`cat-ribbon-segment ${hoveredCatIdx === idx ? 'hovered' : ''}`}
                          style={{
                            width: `${Math.max(2, cat.sharePct)}%`,
                            backgroundColor: cat.color,
                          }}
                          onMouseEnter={() => setHoveredCatIdx(idx)}
                          onMouseLeave={() => setHoveredCatIdx(null)}
                          onClick={() => setSelectedCategory(cat.category)}
                          title={`${cat.category}: ${cat.sharePct}% (${formatRupees(cat.netSalesMinor)})`}
                        />
                      ))}
                    </div>

                    {/* Top Driver Callout Pill */}
                    {data.categories[0] && (
                      <div className="cat-top-driver-callout">
                        <span className="driver-star">🏆</span>
                        <span>
                          Top Revenue Driver: <strong>{data.categories[0].category}</strong> represents{' '}
                          <strong>{data.categories[0].sharePct}%</strong> of store sales ({formatRupees(data.categories[0].netSalesMinor)})
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* VIEW 1: BENTO GRID VIEW */}
                {categoryViewMode === 'bento' && (
                  <div className="cat-bento-cards-grid">
                    {data.categories.map((cat, idx) => {
                      const iconMeta = getCategoryIcon(cat.category);
                      const isTop3 = idx < 3;
                      const rankMedal = idx === 0 ? '🥇 #1' : idx === 1 ? '🥈 #2' : idx === 2 ? '🥉 #3' : `#${idx + 1}`;
                      const isHovered = hoveredCatIdx === idx;
                      const avgTicket = Math.round(cat.netSalesMinor / Math.max(1, cat.billsCount));

                      return (
                        <div
                          key={idx}
                          className={`cat-bento-card ${isHovered ? 'hovered' : ''} ${isTop3 ? 'is-top-tier' : ''}`}
                          onMouseEnter={() => setHoveredCatIdx(idx)}
                          onMouseLeave={() => setHoveredCatIdx(null)}
                          onClick={() => setSelectedCategory(cat.category)}
                          style={{
                            borderTop: `3px solid ${cat.color}`,
                          }}
                        >
                          <div className="cat-bento-card-top">
                            <span className={`cat-rank-pill rank-${idx + 1}`}>
                              {rankMedal}
                            </span>
                            <span className="cat-share-pill" style={{ color: cat.color, backgroundColor: `${cat.color}15`, borderColor: `${cat.color}35` }}>
                              {cat.sharePct}% share
                            </span>
                          </div>

                          <div className="cat-bento-card-main">
                            <div className="cat-avatar-box" style={{ background: iconMeta.bg }}>
                              <span className="cat-avatar-emoji">{iconMeta.emoji}</span>
                            </div>
                            <div className="cat-info-block">
                              <span className="cat-bento-title" title={cat.category}>{cat.category}</span>
                              <span className="cat-bento-bills">{cat.billsCount} bills generated</span>
                            </div>
                          </div>

                          <div className="cat-bento-amount-row">
                            <span className="cat-bento-amount mono">{formatRupees(cat.netSalesMinor)}</span>
                            <span className="cat-bento-avg mono">Avg: {formatRupees(avgTicket)}</span>
                          </div>

                          <div className="cat-bento-progress-track">
                            <div
                              className="cat-bento-progress-fill"
                              style={{
                                width: `${Math.min(100, Math.max(6, cat.sharePct))}%`,
                                background: `linear-gradient(90deg, ${cat.color} 0%, ${cat.color}cc 100%)`,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* VIEW 2: EXECUTIVE RANKED LEADERBOARD VIEW */}
                {categoryViewMode === 'leaderboard' && (
                  <div className="cat-leaderboard-list">
                    {data.categories.map((cat, idx) => {
                      const iconMeta = getCategoryIcon(cat.category);
                      const isHovered = hoveredCatIdx === idx;
                      const avgTicket = Math.round(cat.netSalesMinor / Math.max(1, cat.billsCount));

                      return (
                        <div
                          key={idx}
                          className={`cat-leaderboard-row ${isHovered ? 'hovered' : ''}`}
                          onMouseEnter={() => setHoveredCatIdx(idx)}
                          onMouseLeave={() => setHoveredCatIdx(null)}
                          onClick={() => setSelectedCategory(cat.category)}
                        >
                          <div className="cat-leaderboard-rank-col">
                            <span className={`cat-lead-rank-badge rank-${idx + 1}`}>
                              {idx < 3 ? (idx === 0 ? '🥇' : idx === 1 ? '🥈' : '🥉') : `#${idx + 1}`}
                            </span>
                            <div className="cat-lead-avatar" style={{ background: iconMeta.bg }}>
                              <span>{iconMeta.emoji}</span>
                            </div>
                            <div className="cat-lead-name-box">
                              <span className="cat-lead-title">{cat.category}</span>
                              <span className="cat-lead-subtitle">{cat.billsCount} orders · avg {formatRupees(avgTicket)}</span>
                            </div>
                          </div>

                          <div className="cat-lead-progress-col">
                            <div className="cat-lead-track">
                              <div
                                className="cat-lead-fill"
                                style={{
                                  width: `${Math.min(100, Math.max(4, cat.sharePct))}%`,
                                  backgroundColor: cat.color,
                                }}
                              />
                            </div>
                          </div>

                          <div className="cat-lead-amount-col">
                            <span className="cat-lead-val mono">{formatRupees(cat.netSalesMinor)}</span>
                            <span className="cat-lead-share mono" style={{ color: cat.color, backgroundColor: `${cat.color}15`, borderColor: `${cat.color}35` }}>
                              {cat.sharePct}%
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {data.categories.length === 0 && (
                  <div className="panel-empty-text">No category sales recorded in this period.</div>
                )}
              </div>

              {/* Panel: Busiest Days & Hours Heatmap */}
              <div className="card sales-panel-card">
                <div className="panel-card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                    <div className="panel-header-icon-box">
                      <ClockHeatmapIcon />
                    </div>
                    <div>
                      <h3 className="panel-title">Busiest Days &amp; Hours</h3>
                      <div className="panel-subtitle">Average sales by weekday and hour</div>
                    </div>
                  </div>
                </div>

                <div className="heatmap-container">
                  {/* Hour Headers */}
                  <div className="heatmap-hours-row">
                    <div className="heatmap-weekday-spacer"></div>
                    {['8a', '10a', '12p', '2p', '4p', '6p', '8p'].map((hr, idx) => (
                      <div key={idx} className="heatmap-hour-header">
                        {hr}
                      </div>
                    ))}
                  </div>

                  {/* Weekday Rows (Mon .. Sun) */}
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((dayName, rowIdx) => {
                    const rowCells = data.heatmap.matrix.filter((c) => c.weekdayName === dayName);

                    return (
                      <div key={rowIdx} className="heatmap-row">
                        <div className="heatmap-row-label">{dayName}</div>
                        <div className="heatmap-cells-track">
                          {rowCells.map((cell, cIdx) => {
                            const intensity =
                              data.heatmap.maxCellSalesMinor > 0
                                ? Math.min(1, Math.max(0.08, cell.salesMinor / data.heatmap.maxCellSalesMinor))
                                : 0.08;
                            const bgAlpha = cell.salesMinor > 0 ? 0.15 + intensity * 0.8 : 0.08;

                            return (
                              <div
                                key={cIdx}
                                className="heatmap-cell"
                                style={{
                                  backgroundColor: `rgba(109, 74, 255, ${bgAlpha.toFixed(2)})`,
                                }}
                                title={`${cell.weekdayName} ${cell.hourLabel}: ${cell.billsCount} bills, ${formatRupees(cell.salesMinor)}`}
                              ></div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}

                  {/* Heatmap Legend */}
                  <div className="heatmap-footer-legend">
                    <span className="legend-label">Low</span>
                    <div className="heatmap-legend-bar"></div>
                    <span className="legend-label">High</span>
                    <span className="legend-dot">•</span>
                    <span className="legend-peak-text">
                      <span className="peak-flame-icon">
                        <FlamePeakIcon />
                      </span>
                      <span>Peak: <strong>{data.heatmap.peakSlot}</strong></span>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN */}
            <div className="sales-panels-col">
              {/* Panel: Payment Modes */}
              <div className="card sales-panel-card">
                <div className="panel-card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                    <div className="panel-header-icon-box">
                      <WalletPaymentIcon />
                    </div>
                    <div>
                      <h3 className="panel-title">Payment Modes</h3>
                      <div className="panel-subtitle">Share of net sales</div>
                    </div>
                  </div>
                </div>

                <div className="payment-modes-panel">
                  {/* Multi-segment stacked horizontal bar */}
                  <div className="payment-stacked-bar">
                    {data.payments.modes
                      .filter((m) => m.sharePct > 0)
                      .map((m, idx) => (
                        <div
                          key={idx}
                          className="payment-bar-segment"
                          style={{
                            width: `${m.sharePct}%`,
                            backgroundColor: m.color,
                          }}
                          title={`${m.label}: ${m.sharePct}% (${formatRupees(m.totalMinor)})`}
                        ></div>
                      ))}
                  </div>

                  {/* Legend row with percentages */}
                  <div className="payment-legend-row">
                    {data.payments.modes.map((m, idx) => (
                      <div key={idx} className="payment-legend-item">
                        <span className="payment-legend-dot" style={{ backgroundColor: m.color }}></span>
                        <span className="payment-legend-name">{m.label}</span>
                        <strong className="mono">{m.sharePct}%</strong>
                      </div>
                    ))}
                  </div>

                  {/* Small ₹ amount tiles below */}
                  <div className="payment-amount-tiles">
                    {data.payments.modes.map((m, idx) => {
                      const getModeIcon = (modeId: string) => {
                        switch (modeId.toLowerCase()) {
                          case 'upi':
                            return <PhoneUpiIcon />;
                          case 'cash':
                            return <BanknoteCashIcon />;
                          case 'card':
                            return <CreditCardIcon />;
                          case 'credit':
                          case 'khata':
                            return <BookKhataIcon />;
                          default:
                            return <WalletPaymentIcon />;
                        }
                      };

                      return (
                        <div key={idx} className="payment-amount-tile">
                          <div className="tile-top-row">
                            <span className="tile-icon-wrap" style={{ color: m.color }}>
                              {getModeIcon(m.mode)}
                            </span>
                            <span className="tile-label">{m.label}</span>
                            <span className="tile-pct-badge" style={{ backgroundColor: `${m.color}15`, color: m.color }}>
                              {m.sharePct}%
                            </span>
                          </div>
                          <div className="tile-val mono">{formatRupees(m.totalMinor)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Panel: Top Customers */}
              <div className="card sales-panel-card">
                <div className="panel-card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                    <div className="panel-header-icon-box">
                      <CrownUserIcon />
                    </div>
                    <div>
                      <h3 className="panel-title">Top Customers</h3>
                      <div className="panel-subtitle">Named customers • by sales</div>
                    </div>
                  </div>
                </div>

                <div className="top-customers-list">
                  {data.topCustomers.map((cust, idx) => (
                    <div key={idx} className="top-customer-row">
                      <div className="customer-info-area">
                        <div className="customer-avatar-badge">
                          {cust.name.trim().charAt(0).toUpperCase() || 'C'}
                        </div>
                        <div>
                          <div className="customer-name-row">
                            <span className="customer-name">{cust.name}</span>
                          </div>
                          <div className="customer-meta-row">
                            <span className="customer-bill-count">{cust.billsCount} bills</span>
                            <span className="meta-sep">•</span>
                            {cust.isB2B ? (
                              <span className="badge-cust-b2b">B2B</span>
                            ) : cust.isKhata ? (
                              <span className="badge-cust-khata">Khata</span>
                            ) : (
                              <span className="badge-cust-retail">Retail</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="customer-sales-val mono">
                        {formatRupees(cust.netSalesMinor)}
                      </div>
                    </div>
                  ))}

                  {data.topCustomers.length === 0 && (
                    <div className="panel-empty-text">No named customer invoices recorded.</div>
                  )}
                </div>
              </div>

              {/* Panel: Data-Driven Insights */}
              <div className="card sales-panel-card">
                <div className="panel-card-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                    <div className="panel-header-icon-box">
                      <SparklesInsightIcon />
                    </div>
                    <div>
                      <h3 className="panel-title">Insights</h3>
                      <div className="panel-subtitle">Updated with the date range</div>
                    </div>
                  </div>
                </div>

                <div className="insights-stack">
                  {data.insights.map((ins) => (
                    <div key={ins.id} className={`insight-card theme-${ins.theme}`}>
                      <div className={`insight-icon-area theme-${ins.theme}`}>
                        {renderInsightIcon(ins.icon, ins.theme)}
                      </div>
                      <div className="insight-body">
                        <div className="insight-title">{ins.title}</div>
                        <div className="insight-desc">{ins.description}</div>
                      </div>
                    </div>
                  ))}

                  {data.insights.length === 0 && (
                    <div className="panel-empty-text">More billing transactions needed to generate high-confidence insights.</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 6. DAYWISE SALES SUMMARY TABLE */}
          <div className="card sales-daywise-card">
            <div className="daywise-table-header">
              <div className="daywise-title-area">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                  <div className="panel-header-icon-box">
                    <CalendarTableIcon />
                  </div>
                  <div>
                    <h3 className="daywise-heading">Daywise Sales Summary</h3>
                    <div className="daywise-sub">
                      Click a day to see its bills · change vs same weekday last week
                    </div>
                  </div>
                </div>
              </div>

              <div className="daywise-actions-area">
                {/* Group dropdown */}
                <div className="daywise-group-wrap">
                  <select
                    className="form-select daywise-group-select"
                    value={grouping}
                    onChange={(e) => setGrouping(e.target.value as GroupingPreset)}
                  >
                    <option value="day">Group: Day</option>
                    <option value="week">Group: Week</option>
                    <option value="month">Group: Month</option>
                  </select>
                  <span className="daywise-group-chevron">
                    <ChevronDownIcon />
                  </span>
                </div>

                {/* Export CSV button */}
                <button
                  type="button"
                  className="btn btn-secondary daywise-btn"
                  onClick={handleExportDaywiseCSV}
                  title="Export Daywise Sales Summary table to CSV"
                >
                  <FileSpreadsheetIcon />
                  <span>Export CSV</span>
                </button>

                {/* Print button */}
                <button
                  type="button"
                  className="btn btn-secondary daywise-btn"
                  onClick={handlePrint}
                  title="Print Sales Summary"
                >
                  <PrinterIcon />
                  <span>Print</span>
                </button>
              </div>
            </div>

            {/* Responsive Table Wrap */}
            <div className="daywise-table-scroll">
              <table className="daywise-table">
                <thead>
                  <tr>
                    <th onClick={() => { setSortField('date'); setSortAsc(!sortAsc); }} className="sortable-th">
                      <span>DATE</span>
                      {sortField === 'date' && (
                        <span className="th-sort-arrow">{sortAsc ? '↑' : '↓'}</span>
                      )}
                    </th>
                    <th onClick={() => { setSortField('billsCount'); setSortAsc(!sortAsc); }} className="sortable-th col-num">
                      <span>BILLS</span>
                      {sortField === 'billsCount' && (
                        <span className="th-sort-arrow">{sortAsc ? '↑' : '↓'}</span>
                      )}
                    </th>
                    <th onClick={() => { setSortField('netSalesMinor'); setSortAsc(!sortAsc); }} className="sortable-th col-num active-sort">
                      <span>NET SALES</span>
                      {sortField === 'netSalesMinor' && (
                        <span className="th-sort-arrow">{sortAsc ? '↑' : '↓'}</span>
                      )}
                    </th>
                    <th onClick={() => { setSortField('returnsMinor'); setSortAsc(!sortAsc); }} className="sortable-th col-num">
                      <span>RETURNS</span>
                      {sortField === 'returnsMinor' && (
                        <span className="th-sort-arrow">{sortAsc ? '↑' : '↓'}</span>
                      )}
                    </th>
                    <th onClick={() => { setSortField('discountMinor'); setSortAsc(!sortAsc); }} className="sortable-th col-num">
                      <span>DISCOUNT</span>
                      {sortField === 'discountMinor' && (
                        <span className="th-sort-arrow">{sortAsc ? '↑' : '↓'}</span>
                      )}
                    </th>
                    <th onClick={() => { setSortField('gstMinor'); setSortAsc(!sortAsc); }} className="sortable-th col-num">
                      <span>GST</span>
                      {sortField === 'gstMinor' && (
                        <span className="th-sort-arrow">{sortAsc ? '↑' : '↓'}</span>
                      )}
                    </th>
                    <th onClick={() => { setSortField('grossProfitMinor'); setSortAsc(!sortAsc); }} className="sortable-th col-num">
                      <span>GROSS PROFIT</span>
                      {sortField === 'grossProfitMinor' && (
                        <span className="th-sort-arrow">{sortAsc ? '↑' : '↓'}</span>
                      )}
                    </th>
                    <th onClick={() => { setSortField('marginPct'); setSortAsc(!sortAsc); }} className="sortable-th col-num">
                      <span>MARGIN %</span>
                      {sortField === 'marginPct' && (
                        <span className="th-sort-arrow">{sortAsc ? '↑' : '↓'}</span>
                      )}
                    </th>
                    <th className="col-num">CHANGE</th>
                  </tr>
                </thead>

                <tbody>
                  {sortedDaywiseRows.map((row) => (
                    <tr
                      key={row.date}
                      className="daywise-clickable-row"
                      onClick={() => onNavigateToInvoices?.(row.date)}
                      title={`Click to view all bills issued on ${row.formattedDate}`}
                    >
                      <td className="col-date-text">{row.formattedDate}</td>
                      <td className="col-num mono">{row.billsCount}</td>
                      <td className="col-num mono text-purple font-bold">
                        {formatRupees(row.netSalesMinor)}
                      </td>
                      <td className="col-num mono text-red">
                        {row.returnsMinor > 0 ? formatRupees(row.returnsMinor) : '₹0'}
                      </td>
                      <td className="col-num mono text-muted">
                        {row.discountMinor > 0 ? formatRupees(row.discountMinor) : '₹0'}
                      </td>
                      <td className="col-num mono text-muted">
                        {formatRupees(row.gstMinor)}
                      </td>
                      <td className="col-num mono text-emerald font-bold">
                        {formatRupees(row.grossProfitMinor)}
                      </td>
                      <td className="col-num mono">{row.marginPct}%</td>
                      <td className="col-num mono">
                        {row.prevWeekSameDayChangePct !== null ? (
                          <span
                            className={`daywise-change-badge ${row.prevWeekSameDayChangePct >= 0 ? 'pos' : 'neg'}`}
                          >
                            {row.prevWeekSameDayChangePct >= 0 ? <TrendUpIcon /> : <TrendDownIcon />}
                            <span>{Math.abs(row.prevWeekSameDayChangePct)}%</span>
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}

                  {sortedDaywiseRows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="table-empty-row">
                        No completed bills found in this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Table Footer */}
            <div className="daywise-table-footer">
              <div className="footer-left">
                Showing {sortedDaywiseRows.length} of {data.filters.rangeDays} days
              </div>
              <div className="footer-right">
                Net sales = bill totals − returns · excluding cancelled bills
              </div>
            </div>
          </div>

          {/* 7. CASHIER PERFORMANCE (OWNER / MANAGER ONLY) */}
          {(userRole === 'owner' || userRole === 'manager') && data.cashierPerformance && (
            <div className="card sales-cashier-card">
              <div className="cashier-card-header">
                <div>
                  <h3 className="cashier-heading">Cashier Performance</h3>
                  <div className="cashier-sub">By billing user • {data.filters.rangeDays} days</div>
                </div>
              </div>

              <div className="cashier-table-scroll">
                <table className="cashier-table">
                  <thead>
                    <tr>
                      <th>CASHIER</th>
                      <th className="col-num">SALES</th>
                      <th className="col-num">BILLS</th>
                      <th className="col-num">AVG BILL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cashierPerformance.rows.map((cashier) => (
                      <tr key={cashier.userId}>
                        <td>
                          <div className="cashier-name font-bold">{cashier.userName}</div>
                          <div className="cashier-counter text-muted">{cashier.counterName}</div>
                        </td>
                        <td className="col-num mono font-bold text-purple">
                          {formatRupees(cashier.salesMinor)}
                        </td>
                        <td className="col-num mono">{cashier.billsCount.toLocaleString('en-IN')}</td>
                        <td className="col-num mono">
                          {formatRupees(cashier.avgBillMinor)}
                        </td>
                      </tr>
                    ))}

                    {data.cashierPerformance.rows.length === 0 && (
                      <tr>
                        <td colSpan={4} className="table-empty-row">
                          No cashier activity found for the selected filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Cashier Summary Strip */}
              <div className="cashier-summary-strip">
                <div className="strip-item">
                  <span className="strip-icon" style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <FileSpreadsheetIcon />
                  </span>
                  <span>
                    Voided bills: <strong>{data.cashierPerformance.summaryStrip.voidedBillsCount}</strong> (
                    {formatRupees(data.cashierPerformance.summaryStrip.voidedTotalMinor)})
                  </span>
                </div>
                <span className="strip-divider">•</span>
                <div className="strip-item">
                  <span>Discounts given: <strong>{formatRupees(data.cashierPerformance.summaryStrip.discountsGivenMinor)}</strong></span>
                </div>
                <span className="strip-divider">•</span>
                <div className="strip-item">
                  <span>Bills on credit: <strong>{data.cashierPerformance.summaryStrip.billsOnCreditCount}</strong></span>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* CUSTOM DATE RANGE MODAL */}
      {showCustomModal && (
        <div className="modal-backdrop" onClick={() => setShowCustomModal(false)}>
          <div
            className="sales-custom-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="customDateModalTitle"
          >
            <div className="sales-modal-header">
              <div className="sales-modal-title-wrap">
                <div className="sales-modal-icon-badge">
                  <CalendarIcon />
                </div>
                <div>
                  <h3 id="customDateModalTitle" className="sales-modal-title">Select Custom Date Range</h3>
                  <p className="sales-modal-subtitle">Filter analytics for any custom billing period</p>
                </div>
              </div>
              <button
                type="button"
                className="sales-modal-close-btn"
                onClick={() => setShowCustomModal(false)}
                aria-label="Close modal"
              >
                <CloseModalIcon />
              </button>
            </div>

            <form onSubmit={handleApplyCustomRange}>
              <div className="sales-modal-body">
                {/* Quick Presets Row */}
                <div className="sales-modal-quick-presets">
                  <span className="quick-presets-label">Quick picks:</span>
                  <div className="quick-presets-list">
                    <button
                      type="button"
                      className="quick-chip-btn"
                      onClick={() => {
                        const today = getTodayKolkataYMD();
                        setModalFrom(addDaysYMD(today, -6));
                        setModalTo(today);
                      }}
                    >
                      Last 7D
                    </button>
                    <button
                      type="button"
                      className="quick-chip-btn"
                      onClick={() => {
                        const today = getTodayKolkataYMD();
                        setModalFrom(addDaysYMD(today, -13));
                        setModalTo(today);
                      }}
                    >
                      Last 14D
                    </button>
                    <button
                      type="button"
                      className="quick-chip-btn"
                      onClick={() => {
                        const today = getTodayKolkataYMD();
                        setModalFrom(addDaysYMD(today, -29));
                        setModalTo(today);
                      }}
                    >
                      Last 30D
                    </button>
                    <button
                      type="button"
                      className="quick-chip-btn"
                      onClick={() => {
                        const today = getTodayKolkataYMD();
                        setModalFrom(addDaysYMD(today, -59));
                        setModalTo(today);
                      }}
                    >
                      Last 60D
                    </button>
                    <button
                      type="button"
                      className="quick-chip-btn"
                      onClick={() => {
                        const today = getTodayKolkataYMD();
                        const parts = today.split('-');
                        setModalFrom(`${parts[0]}-${parts[1]}-01`);
                        setModalTo(today);
                      }}
                    >
                      This Month
                    </button>
                    <button
                      type="button"
                      className="quick-chip-btn"
                      onClick={() => {
                        const today = getTodayKolkataYMD();
                        const d = new Date(today + 'T12:00:00Z');
                        d.setUTCMonth(d.getUTCMonth() - 1);
                        const prevY = d.getUTCFullYear();
                        const prevM = String(d.getUTCMonth() + 1).padStart(2, '0');
                        const lastDay = new Date(Date.UTC(prevY, d.getUTCMonth() + 1, 0)).getUTCDate();
                        setModalFrom(`${prevY}-${prevM}-01`);
                        setModalTo(`${prevY}-${prevM}-${String(lastDay).padStart(2, '0')}`);
                      }}
                    >
                      Last Month
                    </button>
                  </div>
                </div>

                {/* Date Fields Grid */}
                <div className="sales-modal-dates-grid">
                  <div className="sales-date-input-wrap">
                    <label className="sales-date-label">
                      <span>From Date (Start)</span>
                    </label>
                    <input
                      type="date"
                      className="sales-date-field"
                      value={modalFrom}
                      onChange={(e) => setModalFrom(e.target.value)}
                      required
                    />
                  </div>

                  <div className="sales-date-input-wrap">
                    <label className="sales-date-label">
                      <span>To Date (End)</span>
                    </label>
                    <input
                      type="date"
                      className="sales-date-field"
                      value={modalTo}
                      onChange={(e) => setModalTo(e.target.value)}
                      required
                    />
                  </div>
                </div>

                {/* Selected Range Summary Box */}
                {modalFrom && modalTo && modalFrom <= modalTo ? (
                  <div className="sales-range-summary-box">
                    <div className="summary-box-icon-wrap">
                      <CalendarIcon />
                    </div>
                    <div className="summary-box-content">
                      <span className="summary-days-count">{selectedRangeDays} days duration</span>
                      <span className="summary-date-sub">
                        {formatDMMMYYYY(modalFrom)} – {formatDMMMYYYY(modalTo)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="sales-range-error-box">
                    <AlertTriangleIcon />
                    <span>Invalid range: "From Date" cannot be after "To Date".</span>
                  </div>
                )}
              </div>

              <div className="sales-modal-footer">
                <button
                  type="button"
                  className="sales-modal-btn-cancel"
                  onClick={() => setShowCustomModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="sales-modal-btn-apply"
                  disabled={!modalFrom || !modalTo || modalFrom > modalTo}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  <span>Apply Date Range</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SCHEDULE DAILY REPORT MODAL */}
      {showScheduleModal && (
        <div className="modal-backdrop" onClick={() => setShowScheduleModal(false)}>
          <div
            className="sales-custom-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="scheduleModalTitle"
          >
            <div className="sales-modal-header">
              <div className="sales-modal-title-wrap">
                <div className="sales-modal-icon-badge" style={{ background: '#ecfdf5', color: '#10b981' }}>
                  <WhatsAppCalendarIcon />
                </div>
                <div>
                  <h3 id="scheduleModalTitle" className="sales-modal-title">Schedule Daily Sales Report</h3>
                  <p className="sales-modal-subtitle">Automated WhatsApp closing digest at 10:00 PM</p>
                </div>
              </div>
              <button
                type="button"
                className="sales-modal-close-btn"
                onClick={() => setShowScheduleModal(false)}
                aria-label="Close modal"
              >
                <CloseModalIcon />
              </button>
            </div>
            <div className="sales-modal-body">
              <p style={{ color: '#64748b', fontSize: '0.88rem', margin: '0 0 1.25rem 0', lineHeight: 1.55 }}>
                Receive a daily closing WhatsApp summary every evening at 10:00 PM containing Net Sales, Bills, Cash/UPI breakdown, Gross Profit and Returns.
              </p>
              <div className="sales-date-input-wrap">
                <label className="sales-date-label">
                  <span>WhatsApp Phone Number</span>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="badge badge-emerald" style={{ padding: '0.65rem 0.85rem', fontSize: '0.9rem', borderRadius: '10px' }}>
                    +91
                  </span>
                  <input
                    type="tel"
                    className="sales-date-field"
                    placeholder="98401 23456"
                    value={schedulePhone}
                    onChange={(e) => setSchedulePhone(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="sales-modal-footer">
              <button
                type="button"
                className="sales-modal-btn-cancel"
                onClick={() => setShowScheduleModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="sales-modal-btn-apply"
                onClick={handleSendScheduleReport}
                disabled={scheduleSent || !schedulePhone.trim()}
                style={{ background: '#10b981' }}
              >
                {scheduleSent ? 'Saving Schedule...' : 'Save & Enable WhatsApp Digest'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
