import { DEFAULT_CONFIG, mergeConfig, type BusinessType, type Config } from './types.ts';

/**
 * Business-type packs are NOT code branches: each is just a saved configuration
 * (custom fields, print template, rules, feature switches) applied on top of the shared core.
 */
export interface Pack {
  id: BusinessType;
  name: Record<'en' | 'ta' | 'hi', string>;
  blurb: string;
  config: Config;
}

const mk = (over: Partial<Config>) => mergeConfig(DEFAULT_CONFIG, over);

export const PACKS: Pack[] = [
  {
    id: 'retail',
    name: { en: 'Retail / Kirana', ta: 'சில்லறை / மளிகை', hi: 'रिटेल / किराना' },
    blurb: 'Barcode counter billing, thermal receipts, quick UPI/cash.',
    config: mk({ template: { ...DEFAULT_CONFIG.template, paper: 'thermal80', qr: 'upi' }, rules: { ...DEFAULT_CONFIG.rules, maxDiscountPctCashier: 10 } }),
  },
  {
    id: 'wholesale',
    name: { en: 'Wholesale / Distributor', ta: 'மொத்த விற்பனை', hi: 'थोक / डिस्ट्रीब्यूटर' },
    blurb: 'A4 invoices with HSN, credit limits, vehicle and PO references, multi-location stock.',
    config: mk({
      fields: [
        { id: 'f_po_number', entity: 'invoice', label: 'PO number', type: 'text', showOnPrint: true },
        { id: 'f_vehicle_no', entity: 'invoice', label: 'Vehicle number', type: 'text', showOnPrint: true },
        { id: 'f_route', entity: 'customer', label: 'Delivery route', type: 'text' },
      ],
      template: { ...DEFAULT_CONFIG.template, paper: 'a4', showHsn: true, qr: 'link', terms: 'Goods once sold will not be taken back. Interest at 18% p.a. on overdue amounts.' },
      rules: { ...DEFAULT_CONFIG.rules, maxDiscountPctCashier: 5, creditLimitEnforced: true },
      features: { batch: false, serial: false, multiLocation: true },
    }),
  },
  {
    id: 'pharmacy',
    name: { en: 'Pharmacy', ta: 'மருந்தகம்', hi: 'फार्मेसी' },
    blurb: 'Batch and expiry tracking (earliest-expiry first), doctor name, drug licence on bill.',
    config: mk({
      fields: [
        { id: 'f_doctor', entity: 'invoice', label: 'Doctor name', type: 'text', showOnPrint: true },
        { id: 'f_schedule', entity: 'item', label: 'Drug schedule', type: 'select', options: ['None', 'H', 'H1', 'X'] },
        { id: 'f_manufacturer', entity: 'item', label: 'Manufacturer', type: 'text' },
        { id: 'f_rack', entity: 'item', label: 'Rack / shelf', type: 'text' },
      ],
      template: { ...DEFAULT_CONFIG.template, paper: 'thermal80', showHsn: true, header: 'Drug Licence No: ________', qr: 'upi' },
      rules: { ...DEFAULT_CONFIG.rules, maxDiscountPctCashier: 10 },
      features: { batch: true, serial: false, multiLocation: false },
    }),
  },
  {
    id: 'restaurant',
    name: { en: 'Restaurant / Cafe', ta: 'உணவகம்', hi: 'रेस्टोरेंट / कैफे' },
    blurb: 'Table number and order type on the bill; stock tracking off by default.',
    config: mk({
      fields: [
        { id: 'f_table', entity: 'invoice', label: 'Table', type: 'text', showOnPrint: true },
        { id: 'f_order_type', entity: 'invoice', label: 'Order type', type: 'select', options: ['Dine-in', 'Takeaway', 'Delivery'], showOnPrint: true },
      ],
      template: { ...DEFAULT_CONFIG.template, paper: 'thermal80', showHsn: false, showUnit: false, qr: 'upi', footer: 'Thank you! Do visit again.' },
      rules: { ...DEFAULT_CONFIG.rules, allowNegativeStock: true, maxDiscountPctCashier: 5 },
    }),
  },
  {
    id: 'service',
    name: { en: 'Service business', ta: 'சேவை வணிகம்', hi: 'सर्विस बिज़नेस' },
    blurb: 'A4 invoices with SAC code, job reference and due date; no stock.',
    config: mk({
      fields: [
        { id: 'f_job_ref', entity: 'invoice', label: 'Job / project ref', type: 'text', showOnPrint: true },
        { id: 'f_due_date', entity: 'invoice', label: 'Payment due date', type: 'date', showOnPrint: true },
      ],
      template: { ...DEFAULT_CONFIG.template, paper: 'a4', showHsn: true, showUnit: false, qr: 'upi', terms: 'Payment due as stated. Late payments may attract charges.' },
      rules: { ...DEFAULT_CONFIG.rules, allowNegativeStock: true, maxDiscountPctCashier: 0 },
    }),
  },
  {
    id: 'grocery',
    name: { en: 'Grocery Shop', ta: 'மளிகை கடை', hi: 'किराना दुकान' },
    blurb: 'Barcode scanning, loose-goods and weight-based pricing, unit conversions (kg/g/ml).',
    config: mk({ template: { ...DEFAULT_CONFIG.template, paper: 'thermal80', qr: 'upi' } }),
  },
  {
    id: 'supermarket',
    name: { en: 'Supermarket', ta: 'சூப்பர் மார்க்கெட்', hi: 'सुपरमार्केट' },
    blurb: 'Fast POS, barcode counter checkout, multi-counter shifts, category filtering.',
    config: mk({ template: { ...DEFAULT_CONFIG.template, paper: 'thermal80', qr: 'upi' } }),
  },
  {
    id: 'clothing',
    name: { en: 'Clothing & Textiles', ta: 'துணிக்கடை', hi: 'कपड़े और वस्त्र' },
    blurb: 'Size, colour, style variants with barcode tagging and return policies.',
    config: mk({
      fields: [
        { id: 'f_size', entity: 'item', label: 'Size', type: 'select', options: ['S', 'M', 'L', 'XL', 'XXL', 'Free Size'] },
        { id: 'f_color', entity: 'item', label: 'Colour', type: 'text' },
        { id: 'f_style', entity: 'item', label: 'Style / Fit', type: 'text' },
      ],
      template: { ...DEFAULT_CONFIG.template, paper: 'thermal80', qr: 'upi', terms: 'Exchange within 7 days with original tags and bill.' },
    }),
  },
  {
    id: 'electronics',
    name: { en: 'Electronics & Mobiles', ta: 'எலக்ட்ரானிக்ஸ்', hi: 'इलेक्ट्रॉनिक्स' },
    blurb: 'Serial / IMEI number tracking, brand models, warranty periods on invoice.',
    config: mk({
      fields: [
        { id: 'f_serial_imei', entity: 'invoice', label: 'Serial / IMEI number', type: 'text', showOnPrint: true },
        { id: 'f_warranty_months', entity: 'item', label: 'Warranty (Months)', type: 'number' },
      ],
      template: { ...DEFAULT_CONFIG.template, paper: 'a4', showHsn: true, qr: 'upi', terms: 'Manufacturer warranty terms apply. Keep bill for service claims.' },
      features: { batch: false, serial: true, multiLocation: false },
    }),
  },
  {
    id: 'hardware',
    name: { en: 'Hardware & Tools', ta: 'ஹார்டுவேர் கடை', hi: 'हार्डवेयर और टूल्स' },
    blurb: 'Fractional quantity billing, dimension variants, paint tinting & bulk discounts.',
    config: mk({
      fields: [
        { id: 'f_dimension', entity: 'item', label: 'Dimensions / Gauge', type: 'text' },
      ],
      template: { ...DEFAULT_CONFIG.template, paper: 'thermal80', showHsn: true, qr: 'upi' },
    }),
  },
  {
    id: 'other',
    name: { en: 'Custom / Other Business', ta: 'மற்ற வணிகம்', hi: 'अन्य व्यापार' },
    blurb: 'Adaptable configuration for any specialty trade, shop, or agency.',
    config: mk({}),
  },
  {
    id: 'general',
    name: { en: 'General business', ta: 'பொது வணிகம்', hi: 'सामान्य व्यवसाय' },
    blurb: 'Neutral starting point; adjust everything in the Configuration Studio.',
    config: mk({}),
  },
];

export const packById = (id: string): Pack => PACKS.find((p) => p.id === id) ?? PACKS[PACKS.length - 1];
