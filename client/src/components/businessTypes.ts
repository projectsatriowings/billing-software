export interface BusinessTypeMeta {
  id: string;
  title: string;
  icon: string;
  badgeColor: string;
  shortDesc: string;
  details: string;
  defaultUnits: string[];
  features: string[];
}

export const BUSINESS_TYPES_META: BusinessTypeMeta[] = [
  {
    id: 'grocery',
    title: 'Grocery & Supermarket',
    icon: '🛒',
    badgeColor: '#6d4aff',
    shortDesc: 'Manage products, stock, barcode, and daily sales.',
    details: 'Barcode scanning, loose-goods and weight-based pricing (kg/g/ml), expiry tracking.',
    defaultUnits: ['Pieces', 'Weight (kg/g)', 'Volume (Litre)'],
    features: ['Barcode scanning', 'Weight pricing (kg/g)', 'Fast thermal slips'],
  },
  {
    id: 'pharmacy',
    title: 'Pharmacy',
    icon: '➕',
    badgeColor: '#3b82f6',
    shortDesc: 'Track medicines, batches, expiry and prescriptions.',
    details: 'Drug licence numbers, batch tracking, expiry date alerts, and doctor prescription logs.',
    defaultUnits: ['Strips', 'Bottles', 'Tablets', 'Boxes'],
    features: ['Drug licence on bill', 'Batch & expiry alerts', 'Doctor / Rx tracking'],
  },
  {
    id: 'clothing',
    title: 'Clothing & Textiles',
    icon: '👗',
    badgeColor: '#ec4899',
    shortDesc: 'Handle sizes, colours, styles, and variants.',
    details: 'Size, colour, and style variants, barcode tags, easy return and exchange handling.',
    defaultUnits: ['Pieces', 'Sets', 'Metres'],
    features: ['Size & colour matrix', 'Custom barcode tags', 'Returns & exchanges'],
  },
  {
    id: 'restaurant',
    title: 'Restaurant & Cafe',
    icon: '🍴',
    badgeColor: '#f97316',
    shortDesc: 'Manage menu, orders, tables and kitchen.',
    details: 'Table numbers, dine-in and takeaway billing, kitchen order tickets (KOT), no stock hassles.',
    defaultUnits: ['Plates', 'Portions', 'Cups', 'Items'],
    features: ['Table & token billing', 'Dine-in / takeaway', 'Kitchen tickets (KOT)'],
  },
  {
    id: 'electronics',
    title: 'Electronics',
    icon: '💻',
    badgeColor: '#0d9488',
    shortDesc: 'Track serial numbers, warranty and models.',
    details: 'Serial number and IMEI tracking, brand models, warranty period printed on bills.',
    defaultUnits: ['Units', 'Pieces', 'Sets'],
    features: ['Serial & IMEI tracking', 'Printed warranty dates', 'Brand & model specs'],
  },
  {
    id: 'hardware',
    title: 'Hardware',
    icon: '🔧',
    badgeColor: '#8b5cf6',
    shortDesc: 'Manage units, measurements and bulk quantities.',
    details: 'Fractional quantity billing, dimension/gauge specs, bulk contractor pricing.',
    defaultUnits: ['Pieces', 'Kgs', 'Metres', 'Bundles'],
    features: ['Fractional quantities', 'Gauges & dimensions', 'Contractor tiered rates'],
  },
  {
    id: 'wholesale',
    title: 'Wholesale',
    icon: '📦',
    badgeColor: '#f59e0b',
    shortDesc: 'Handle bulk orders, suppliers and pricing.',
    details: 'Full A4 GST tax invoices, customer credit limits, PO numbers, vehicle numbers and route lists.',
    defaultUnits: ['Boxes', 'Bags', 'Cases', 'Kg'],
    features: ['A4 B2B GST tax bills', 'Customer credit limits', 'Vehicle & e-way transport'],
  },
  {
    id: 'service',
    title: 'Services',
    icon: '🎧',
    badgeColor: '#3b82f6',
    shortDesc: 'Manage appointments, services and bookings.',
    details: 'A4 invoices with SAC codes, job/project reference, payment due dates, and zero inventory.',
    defaultUnits: ['Hours', 'Projects', 'Months', 'Sessions'],
    features: ['SAC code compliance', 'Milestone invoicing', 'Zero inventory needed'],
  },
  {
    id: 'other',
    title: 'Other Business',
    icon: '🏢',
    badgeColor: '#9333ea',
    shortDesc: 'Customise for your unique business needs.',
    details: 'Fully adaptable configuration with custom fields and customized receipt layout.',
    defaultUnits: ['Units', 'Pieces'],
    features: ['Custom unit definitions', 'Tailored bill templates', 'Dynamic fields'],
  },
];

export const getMetaForType = (typeId?: string): BusinessTypeMeta => {
  return BUSINESS_TYPES_META.find((b) => b.id === typeId) || BUSINESS_TYPES_META[0];
};
