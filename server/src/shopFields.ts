import { BUSINESS_TYPES, type BusinessType, type Lang } from '../../shared/types.ts';
import { STATES } from '../../shared/states.ts';
import { validateGstin } from '../../shared/tax.ts';
import { bad, V } from './http.ts';

export interface ShopFields {
  name: string;
  businessType: BusinessType;
  gstin: string | null;
  stateCode: string;
  address: string | null;
  phone: string | null;
  upiId: string | null;
  invoicePrefix: string;
  language: Lang;
  locations: string[];
  whatsappEnabled: boolean;
  whatsappDefaultLang: Lang;
  whatsappIncludeLink: boolean;
  loyaltyEnabled: boolean;
  loyaltyPointsPer100: number;
  loyaltyPointValueMinor: number;
  loyaltyMinPointsRedeem: number;
}

export const SHOP_DEFAULTS: ShopFields = {
  name: '', businessType: 'retail', gstin: null, stateCode: '33', address: null, phone: null, upiId: null, invoicePrefix: 'INV', language: 'en', locations: ['MAIN'],
  whatsappEnabled: true, whatsappDefaultLang: 'en', whatsappIncludeLink: false,
  loyaltyEnabled: true, loyaltyPointsPer100: 10, loyaltyPointValueMinor: 10, loyaltyMinPointsRedeem: 10,
};

const has = (o: any, k: string) => o != null && Object.prototype.hasOwnProperty.call(o, k);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function parseEmail(v: unknown, field = 'Email'): string {
  const s = V.str(v, field, { required: true, max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(s)) throw bad(`${field} does not look right. Example: name@shop.com`, 'VALIDATION', { field });
  return s;
}

export function parsePhone(v: unknown, field = 'Phone'): string | null {
  const raw = V.optStr(v, field, 30);
  if (!raw) return null;
  const digits = raw.replace(/[\s\-()]/g, '');
  if (!/^\+?\d{10,13}$/.test(digits)) throw bad(`${field} must be a 10-digit mobile number`, 'VALIDATION', { field });
  return digits;
}

/**
 * Validate shop profile fields. For an update pass the current values as `cur`: only keys present in `body` change.
 * Used by both registration and the settings screen so the rules can never drift apart.
 */
export function parseShopFields(body: any, cur: ShopFields = SHOP_DEFAULTS): ShopFields {
  const out: ShopFields = { ...cur, locations: [...cur.locations] };

  if (has(body, 'name') || !cur.name) out.name = V.str(body?.name, 'Shop name', { required: true, max: 120 });
  if (has(body, 'businessType')) out.businessType = V.oneOf(body.businessType, 'Business type', BUSINESS_TYPES);
  if (has(body, 'language')) out.language = V.oneOf(body.language, 'Language', ['en', 'ta', 'hi'] as const);
  if (has(body, 'address')) out.address = V.optStr(body.address, 'Address', 300);
  if (has(body, 'phone')) out.phone = parsePhone(body.phone, 'Shop phone');

  if (has(body, 'upiId')) {
    const u = V.optStr(body.upiId, 'UPI ID', 100);
    if (u && !/^[\w.\-]{2,100}@[a-zA-Z]{2,64}$/.test(u)) throw bad('UPI ID must look like shopname@bank', 'VALIDATION', { field: 'UPI ID' });
    out.upiId = u;
  }

  if (has(body, 'invoicePrefix')) {
    const p = V.str(body.invoicePrefix, 'Invoice prefix', { max: 6 }).toUpperCase();
    if (!/^[A-Z0-9]{1,6}$/.test(p)) throw bad('Invoice prefix can use 1 to 6 letters or digits, for example INV or SHOP', 'VALIDATION', { field: 'Invoice prefix' });
    out.invoicePrefix = p;
  }

  if (has(body, 'gstin')) {
    const g = V.optStr(body.gstin, 'GSTIN', 20);
    if (g) {
      const gs = g.toUpperCase().replace(/\s/g, '');
      const r = validateGstin(gs);
      if (!r.ok) throw bad(`GSTIN is not valid: ${r.reason ?? 'please check it'}`, 'VALIDATION', { field: 'GSTIN' });
      out.gstin = gs;
    } else out.gstin = null;
  }

  if (has(body, 'stateCode')) {
    const c = V.str(body.stateCode, 'State', { required: true, max: 2 });
    if (!STATES.some((s) => s.code === c)) throw bad('Please choose a valid state', 'VALIDATION', { field: 'State' });
    out.stateCode = c;
  } else if (has(body, 'gstin') && out.gstin && STATES.some((s) => s.code === out.gstin!.slice(0, 2))) {
    out.stateCode = out.gstin.slice(0, 2); // GSTIN's first two digits are the state
  }
  if (out.gstin && out.gstin.slice(0, 2) !== out.stateCode) {
    throw bad(`GSTIN starts with state code ${out.gstin.slice(0, 2)} but the shop state is ${out.stateCode}. Please make them match`, 'VALIDATION', { field: 'GSTIN' });
  }

  if (has(body, 'locations')) {
    const list = V.arr(body.locations, 'Locations', { min: 1, max: 20 }).map((x) => V.str(x, 'Location', { required: true, max: 40 }));
    const seen = new Set<string>();
    for (const l of list) {
      if (seen.has(l.toLowerCase())) throw bad(`Location "${l}" is listed twice`, 'VALIDATION', { field: 'Locations' });
      seen.add(l.toLowerCase());
    }
    out.locations = list;
  }

  if (has(body, 'whatsappEnabled')) out.whatsappEnabled = V.bool(body.whatsappEnabled, true);
  if (has(body, 'whatsappDefaultLang')) out.whatsappDefaultLang = V.oneOf(body.whatsappDefaultLang, 'WhatsApp default language', ['en', 'ta', 'hi'] as const);
  if (has(body, 'whatsappIncludeLink')) out.whatsappIncludeLink = V.bool(body.whatsappIncludeLink, false);

  if (has(body, 'loyaltyEnabled')) out.loyaltyEnabled = V.bool(body.loyaltyEnabled, true);
  if (has(body, 'loyaltyPointsPer100')) out.loyaltyPointsPer100 = V.int(body.loyaltyPointsPer100 ?? 10, 'Loyalty points per ₹100', { min: 0, max: 1000 });
  if (has(body, 'loyaltyPointValueMinor')) out.loyaltyPointValueMinor = V.int(body.loyaltyPointValueMinor ?? 10, 'Point cash value (paise)', { min: 1, max: 10000 });
  if (has(body, 'loyaltyMinPointsRedeem')) out.loyaltyMinPointsRedeem = V.int(body.loyaltyMinPointsRedeem ?? 10, 'Minimum points to redeem', { min: 0, max: 10000 });

  return out;
}

/** Row -> public shop profile. */
export function shopView(t: any) {
  return {
    id: t.id, name: t.name, businessType: t.businessType, gstin: t.gstin, stateCode: t.stateCode, address: t.address, phone: t.phone,
    upiId: t.upiId, invoicePrefix: t.invoicePrefix, plan: t.plan, timezone: t.timezone, language: t.language, locations: t.locations,
    whatsappEnabled: Boolean(t.whatsappEnabled ?? t.whatsapp_enabled ?? true),
    whatsappDefaultLang: (t.whatsappDefaultLang ?? t.whatsapp_default_lang ?? 'en') as Lang,
    whatsappIncludeLink: Boolean(t.whatsappIncludeLink ?? t.whatsapp_include_link ?? false),
    loyaltyEnabled: Boolean(t.loyaltyEnabled ?? t.loyalty_enabled ?? true),
    loyaltyPointsPer100: Number(t.loyaltyPointsPer100 ?? t.loyalty_points_per_100 ?? 10),
    loyaltyPointValueMinor: Number(t.loyaltyPointValueMinor ?? t.loyalty_point_value_minor ?? 10),
    loyaltyMinPointsRedeem: Number(t.loyaltyMinPointsRedeem ?? t.loyalty_min_points_redeem ?? 10),
    createdAt: t.createdAt ?? t.created_at,
  };
}

export function shopFromRow(t: any): ShopFields {
  return {
    name: t.name, businessType: t.businessType, gstin: t.gstin, stateCode: t.stateCode, address: t.address, phone: t.phone,
    upiId: t.upiId, invoicePrefix: t.invoicePrefix, language: t.language, locations: t.locations,
    whatsappEnabled: Boolean(t.whatsappEnabled ?? t.whatsapp_enabled ?? true),
    whatsappDefaultLang: (t.whatsappDefaultLang ?? t.whatsapp_default_lang ?? 'en') as Lang,
    whatsappIncludeLink: Boolean(t.whatsappIncludeLink ?? t.whatsapp_include_link ?? false),
    loyaltyEnabled: Boolean(t.loyaltyEnabled ?? t.loyalty_enabled ?? true),
    loyaltyPointsPer100: Number(t.loyaltyPointsPer100 ?? t.loyalty_points_per_100 ?? 10),
    loyaltyPointValueMinor: Number(t.loyaltyPointValueMinor ?? t.loyalty_point_value_minor ?? 10),
    loyaltyMinPointsRedeem: Number(t.loyaltyMinPointsRedeem ?? t.loyalty_min_points_redeem ?? 10),
  };
}
