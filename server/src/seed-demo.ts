import './env.ts';
import { connectDb, migrate } from './db/index.ts';
import { hashPassword, newId } from './security.ts';
import { calcBill } from '../../shared/tax.ts';
import { j } from './db/index.ts';

interface BusinessSeed {
  tenantId: string;
  name: string;
  businessType: 'retail' | 'pharmacy' | 'restaurant' | 'wholesale' | 'service' | 'clothing';
  gstin: string;
  stateCode: string;
  address: string;
  phone: string;
  upiId: string;
  invoicePrefix: string;
  ownerName: string;
  ownerEmail: string;
  parties: {
    id: string;
    name: string;
    type: 'customer' | 'supplier';
    phone?: string;
    email?: string;
    gstin?: string;
    address?: string;
    credit?: number;
    loyaltyPoints?: number;
  }[];
  items: {
    id: string;
    name: string;
    sku?: string;
    barcode?: string;
    hsn?: string;
    unit: string;
    category: string;
    price: number; // in paise
    cost: number;  // in paise
    taxBp: number;
    stock: number;
    custom?: Record<string, any>;
    imageUrl?: string;
  }[];
  sampleInvoice: {
    number: string;
    customerName: string;
    customerPhone: string;
    partyId?: string;
    lines: {
      itemId: string;
      name: string;
      qtyMilli: number;
      priceMinor: number;
      taxRateBp: number;
      hsn?: string;
      unit?: string;
      batchNo?: string;
    }[];
    custom?: Record<string, any>;
  };
}

const OTHER_BUSINESSES: BusinessSeed[] = [
  // 1. PHARMACY & HEALTHCARE
  {
    tenantId: 't_demo_pharmacy',
    name: 'Apollo Care Pharmacy & Medicals',
    businessType: 'pharmacy',
    gstin: '33APLCR1234F1Z9',
    stateCode: '33',
    address: '88 Medico Junction, Cathedral Road, Chennai - 600086',
    phone: '+91 98402 34567',
    upiId: 'apollocare@okaxis',
    invoicePrefix: 'RX',
    ownerName: 'Dr. K. S. Arunkumar',
    ownerEmail: 'pharmacy@billing.local',
    parties: [
      { id: 'p_ph_c1', name: 'Priya Sundaram (Patient)', phone: '9840987654', email: 'priya.s@example.com', type: 'customer', address: '45 Anna Nagar, Chennai', credit: 200000 },
      { id: 'p_ph_c2', name: 'Meenakshi Clinic OPD', phone: '9444123456', email: 'clinic@meenakshi.in', gstin: '33AAACM1234A1Z9', type: 'customer', address: 'Mount Road, Chennai', credit: 500000 },
      { id: 'p_ph_s1', name: 'Cipla Healthcare & Distribution C&F', phone: '044-23456789', type: 'supplier', address: 'Ambattur Industrial Estate, Chennai', credit: 0 },
    ],
    items: [
      { id: 'i_dolo_650', name: 'Dolo 650mg Paracetamol Tablets (15 Tabs)', sku: 'MED-DOLO-650', barcode: '890111710101', hsn: '3004', unit: 'strip', category: 'Analgesics & Antipyretic', price: 3400, cost: 2400, taxBp: 1200, stock: 120, custom: { batch: 'BAT-26-D1', expiry: '11/2027', schedule: 'None', rack: 'A-01' } },
      { id: 'i_aug_625', name: 'Augmentin 625 Duo Amoxicillin Tablets (10 Tabs)', sku: 'MED-AUG-625', barcode: '890111710202', hsn: '3004', unit: 'strip', category: 'Antibiotics', price: 19800, cost: 15500, taxBp: 1200, stock: 65, custom: { batch: 'BAT-26-AG', expiry: '08/2027', schedule: 'Schedule H1', rack: 'B-12' } },
      { id: 'i_azi_500', name: 'Azithral 500mg Azithromycin (5 Tabs)', sku: 'MED-AZI-500', barcode: '890111710303', hsn: '3004', unit: 'strip', category: 'Antibiotics', price: 12500, cost: 9800, taxBp: 1200, stock: 45, custom: { batch: 'BAT-26-AZ', expiry: '05/2028', schedule: 'Schedule H', rack: 'B-04' } },
      { id: 'i_pan_40', name: 'Pan 40mg Pantoprazole Gastro-Resistant (15 Tabs)', sku: 'MED-PAN-40', barcode: '890111710404', hsn: '3004', unit: 'strip', category: 'Gastrointestinal', price: 16500, cost: 12800, taxBp: 1200, stock: 80, custom: { batch: 'BAT-26-P4', expiry: '09/2027', schedule: 'Schedule H', rack: 'A-08' } },
      { id: 'i_cet_10', name: 'Cetzine 10mg Cetirizine (10 Tabs)', sku: 'MED-CET-10', barcode: '890111710505', hsn: '3004', unit: 'strip', category: 'Antiallergic', price: 4200, cost: 2800, taxBp: 1200, stock: 110, custom: { batch: 'BAT-26-CT', expiry: '03/2028', schedule: 'None', rack: 'A-05' } },
      { id: 'i_bena_100', name: 'Benadryl Cough Formula Syrup 100ml', sku: 'SYR-BEN-100', barcode: '890111710606', hsn: '3004', unit: 'bottle', category: 'Cough & Cold', price: 13800, cost: 10500, taxBp: 1200, stock: 50, custom: { batch: 'BAT-26-BN', expiry: '12/2027', schedule: 'None', rack: 'S-03' } },
      { id: 'i_vol_50', name: 'Volini Pain Relief Gel 50g Tube', sku: 'OIN-VOL-50', barcode: '890111710707', hsn: '3004', unit: 'tube', category: 'Pain Relief', price: 16000, cost: 12500, taxBp: 1200, stock: 40, custom: { batch: 'BAT-26-VL', expiry: '01/2028', schedule: 'None', rack: 'OTC-1' } },
      { id: 'i_lim_500', name: 'Limcee Vitamin C 500mg Chewable (15 Tabs)', sku: 'SUP-LIM-500', barcode: '890111710808', hsn: '2106', unit: 'strip', category: 'Vitamins & Supplements', price: 2600, cost: 1800, taxBp: 1800, stock: 150, custom: { batch: 'BAT-26-LM', expiry: '04/2028', schedule: 'None', rack: 'OTC-2' } },
    ],
    sampleInvoice: {
      number: 'RX-1001',
      customerName: 'Priya Sundaram (Dr. Ramesh MBBS)',
      customerPhone: '9840987654',
      partyId: 'p_ph_c1',
      custom: { doctor: 'Dr. M. Ramesh MBBS, MD', dlNo: 'DL-TN-2024-55829' },
      lines: [
        { itemId: 'i_dolo_650', name: 'Dolo 650mg Paracetamol Tablets', qtyMilli: 2000, priceMinor: 3400, taxRateBp: 1200, hsn: '3004', unit: 'strip', batchNo: 'BAT-26-D1' },
        { itemId: 'i_aug_625', name: 'Augmentin 625 Duo Amoxicillin Tablets [Schedule H1]', qtyMilli: 1000, priceMinor: 19800, taxRateBp: 1200, hsn: '3004', unit: 'strip', batchNo: 'BAT-26-AG' },
        { itemId: 'i_lim_500', name: 'Limcee Vitamin C 500mg Chewable', qtyMilli: 2000, priceMinor: 2600, taxRateBp: 1800, hsn: '2106', unit: 'strip', batchNo: 'BAT-26-LM' },
      ],
    },
  },

  // 2. RESTAURANT & CAFE
  {
    tenantId: 't_demo_restaurant',
    name: 'Anjappar Chettinad Restaurant',
    businessType: 'restaurant',
    gstin: '33AAACA9876B1Z5',
    stateCode: '33',
    address: '77 G. N. Chetty Road, T. Nagar, Chennai - 600017',
    phone: '+91 98403 45678',
    upiId: 'anjappar@okaxis',
    invoicePrefix: 'KOT',
    ownerName: 'Chettiar S. Muthukumar',
    ownerEmail: 'restaurant@billing.local',
    parties: [
      { id: 'p_res_c1', name: 'Corporate Catering - Zoho Corp', phone: '9840112233', email: 'catering@zoho.com', type: 'customer', address: 'Estancia IT Park, Guduvanchery', credit: 1000000 },
      { id: 'p_res_s1', name: 'Metro Cash & Carry Wholesale', phone: '044-24561122', type: 'supplier', address: 'Koyambedu Wholesale Market, Chennai', credit: 0 },
    ],
    items: [
      { id: 'i_res_biryani', name: 'Chettinad Special Chicken Biryani', sku: 'FD-BIRY-CHK', hsn: '2106', unit: 'portion', category: 'Main Course', price: 29000, cost: 14000, taxBp: 500, stock: 100, custom: { course: 'Main Course', spiceLevel: 'Medium Spicy', kitchenStation: 'Biryani Station' } },
      { id: 'i_res_mutton', name: 'Mutton Chukka Varuval (Boneless)', sku: 'FD-MTN-CHK', hsn: '2106', unit: 'plate', category: 'Starters', price: 38000, cost: 20000, taxBp: 500, stock: 60, custom: { course: 'Starters', spiceLevel: 'Hot Chettinad', kitchenStation: 'Hot Wok Kitchen' } },
      { id: 'i_res_parotta', name: 'Malabar Flaky Parotta (2 Pcs)', sku: 'FD-PAR-02', hsn: '1905', unit: 'set', category: 'Breads & Tiffin', price: 6000, cost: 2200, taxBp: 500, stock: 250, custom: { course: 'Breads & Roti', spiceLevel: 'Mild', kitchenStation: 'Tawa Counter' } },
      { id: 'i_res_meals', name: 'South Indian Non-Veg Thali Meals', sku: 'FD-THL-NV', hsn: '2106', unit: 'thali', category: 'Combos & Meals', price: 24000, cost: 11000, taxBp: 500, stock: 150, custom: { course: 'Combos & Meals', spiceLevel: 'Medium Spicy', kitchenStation: 'Service Buffet' } },
      { id: 'i_res_payasam', name: 'Elaneer Payasam (Tender Coconut)', sku: 'FD-DES-ELN', hsn: '2106', unit: 'bowl', category: 'Desserts', price: 12000, cost: 5000, taxBp: 500, stock: 80, custom: { course: 'Desserts', spiceLevel: 'Sweet', kitchenStation: 'Dessert Pantry' } },
    ],
    sampleInvoice: {
      number: 'KOT-1001',
      customerName: 'Zoho IT Team Dine-in (Table 04)',
      customerPhone: '9840112233',
      partyId: 'p_res_c1',
      custom: { tableNo: 'T-04', steward: 'Murugan K.' },
      lines: [
        { itemId: 'i_res_biryani', name: 'Chettinad Special Chicken Biryani', qtyMilli: 3000, priceMinor: 29000, taxRateBp: 500, hsn: '2106', unit: 'portion' },
        { itemId: 'i_res_mutton', name: 'Mutton Chukka Varuval (Boneless)', qtyMilli: 2000, priceMinor: 38000, taxRateBp: 500, hsn: '2106', unit: 'plate' },
        { itemId: 'i_res_parotta', name: 'Malabar Flaky Parotta (2 Pcs)', qtyMilli: 4000, priceMinor: 6000, taxRateBp: 500, hsn: '1905', unit: 'set' },
      ],
    },
  },

  // 3. WHOLESALE & DISTRIBUTION
  {
    tenantId: 't_demo_wholesale',
    name: 'Balaji Wholesale & B2B Traders',
    businessType: 'wholesale',
    gstin: '33BLJTR5566C1ZQ',
    stateCode: '33',
    address: '42 Govindappa Naicken St, Sowcarpet, Chennai - 600001',
    phone: '+91 98404 56789',
    upiId: 'balajitraders@okaxis',
    invoicePrefix: 'B2B',
    ownerName: 'R. Balaji Chettiar',
    ownerEmail: 'wholesale@billing.local',
    parties: [
      { id: 'p_wh_c1', name: 'Sri Venkateswara Provision Stores', phone: '9841022334', email: 'venkateswara.stores@gmail.com', gstin: '33SVPST1234D1Z8', type: 'customer', address: 'Tambaram Main Road, Chennai', credit: 1500000 },
      { id: 'p_wh_s1', name: 'Adani Wilmar Agro Commodities Refinery', phone: '044-25678901', type: 'supplier', address: 'Ennore Port Industrial Corridor, Chennai' },
    ],
    items: [
      { id: 'i_wh_oil_box', name: 'Fortune Sunflower Oil 1L Pouch (Carton Box 12 Units)', sku: 'B2B-OIL-BOX12', barcode: '890600728999', hsn: '1512', unit: 'box', category: 'Bulk Edible Oils', price: 168000, cost: 152000, taxBp: 500, stock: 500 },
      { id: 'i_wh_sugar_bag', name: 'Madhur Refined Pure Sugar (50kg Jute Bag)', sku: 'B2B-SUG-BAG50', barcode: '890601441500', hsn: '1701', unit: 'bag', category: 'Bulk Sugar & Grains', price: 235000, cost: 218000, taxBp: 500, stock: 350 },
      { id: 'i_wh_rice_ton', name: 'Ponni Boiled Rice Grade-A (25kg Bag Pack)', sku: 'B2B-RICE-25KG', barcode: '890103038250', hsn: '1006', unit: 'bag', category: 'Bulk Sugar & Grains', price: 135000, cost: 122000, taxBp: 500, stock: 600 },
    ],
    sampleInvoice: {
      number: 'B2B-1001',
      customerName: 'Sri Venkateswara Provision Stores',
      customerPhone: '9841022334',
      partyId: 'p_wh_c1',
      custom: { poNumber: 'PO-SVP-2026-882', vehicleNo: 'TN 09 BX 4421', ewayBill: '2214-9981-0021' },
      lines: [
        { itemId: 'i_wh_oil_box', name: 'Fortune Sunflower Oil 1L Pouch (Carton 12 Units)', qtyMilli: 10000, priceMinor: 168000, taxRateBp: 500, hsn: '1512', unit: 'box' },
        { itemId: 'i_wh_sugar_bag', name: 'Madhur Refined Pure Sugar (50kg Bag)', qtyMilli: 5000, priceMinor: 235000, taxRateBp: 500, hsn: '1701', unit: 'bag' },
      ],
    },
  },

  // 4. IT SERVICES & CONSULTING
  {
    tenantId: 't_demo_service',
    name: 'Vortex Cloud & IT Solutions',
    businessType: 'service',
    gstin: '33VRTEX9900D1Z2',
    stateCode: '33',
    address: 'Module 6, Ascendas IT Park, Taramani, Chennai - 600113',
    phone: '+91 98405 67890',
    upiId: 'vortextech@okaxis',
    invoicePrefix: 'SRV',
    ownerName: 'V. Ramanathan',
    ownerEmail: 'service@billing.local',
    parties: [
      { id: 'p_srv_c1', name: 'Cognizant Cloud Innovation Labs', phone: '9840112233', email: 'procurement@cognizant.com', gstin: '33CTSIN9900A1Z1', type: 'customer', address: 'Siruseri IT Corridor, Chennai', credit: 25000000 },
      { id: 'p_srv_s1', name: 'Amazon Web Services India Pvt Ltd', phone: '080-45678901', type: 'supplier', address: 'Embassy Golf Links, Bengaluru' },
    ],
    items: [
      { id: 'i_srv_web', name: 'Custom Web & Cloud Application Development', sku: 'SRV-DEV-01', hsn: '998314', unit: 'hrs', category: 'Software Development', price: 250000, cost: 120000, taxBp: 1800, stock: 1000 },
      { id: 'i_srv_amc', name: 'Annual IT Network & Server Maintenance (AMC Monthly)', sku: 'SRV-AMC-01', hsn: '998717', unit: 'month', category: 'Maintenance Services', price: 2800000, cost: 1400000, taxBp: 1800, stock: 100 },
      { id: 'i_srv_cloud', name: 'Postgres & Cloud Database Optimization Contract', sku: 'SRV-DBA-01', hsn: '998315', unit: 'contract', category: 'Database Consulting', price: 4500000, cost: 2000000, taxBp: 1800, stock: 50 },
    ],
    sampleInvoice: {
      number: 'SRV-1001',
      customerName: 'Cognizant Cloud Innovation Labs',
      customerPhone: '9840112233',
      partyId: 'p_srv_c1',
      custom: { jobRef: 'PRJ-NEON-CLOUD-2026', dueDate: '30-Oct-2026' },
      lines: [
        { itemId: 'i_srv_web', name: 'Custom Web & Cloud Application Development (20 hrs)', qtyMilli: 20000, priceMinor: 250000, taxRateBp: 1800, hsn: '998314', unit: 'hrs' },
        { itemId: 'i_srv_cloud', name: 'Postgres & Cloud Database Optimization Contract', qtyMilli: 1000, priceMinor: 4500000, taxRateBp: 1800, hsn: '998315', unit: 'contract' },
      ],
    },
  },

  // 5. CLOTHING & TEXTILES
  {
    tenantId: 't_demo_clothing',
    name: 'Style Haven Clothing & Apparel',
    businessType: 'clothing',
    gstin: '33STYLH7788E1ZP',
    stateCode: '33',
    address: '55 Pondy Bazaar, T. Nagar, Chennai - 600017',
    phone: '+91 98406 78901',
    upiId: 'stylehaven@okaxis',
    invoicePrefix: 'SHC',
    ownerName: 'Ananya Ramanathan',
    ownerEmail: 'clothing@billing.local',
    parties: [
      { id: 'p_cl_c1', name: 'Deepa Krishnan', phone: '9840889900', email: 'deepa.k@example.com', type: 'customer', address: 'Velachery, Chennai', credit: 200000 },
      { id: 'p_cl_s1', name: 'Raymond Luxury Fabrics & Weaving Mills', phone: '044-24901122', type: 'supplier', address: 'Tirupur Apparel Park, Tamil Nadu' },
    ],
    items: [
      { id: 'i_cl_shirt', name: 'Pure Cotton Formal Shirt - Sky Blue (40)', sku: 'CLO-SHIRT-BL-40', hsn: '6205', unit: 'pcs', category: 'Menswear', price: 149900, cost: 75000, taxBp: 500, stock: 50, custom: { size: '40', color: 'Sky Blue', brand: 'StyleHaven' } },
      { id: 'i_cl_kurti', name: 'Embroidered Anarkali Cotton Kurti (L)', sku: 'CLO-KURT-EM-L', hsn: '6204', unit: 'pcs', category: 'Womenswear', price: 189900, cost: 95000, taxBp: 500, stock: 40, custom: { size: 'L', color: 'Maroon', brand: 'StyleHaven' } },
    ],
    sampleInvoice: {
      number: 'SHC-1001',
      customerName: 'Deepa Krishnan',
      customerPhone: '9840889900',
      partyId: 'p_cl_c1',
      lines: [
        { itemId: 'i_cl_shirt', name: 'Pure Cotton Formal Shirt - Sky Blue (40)', qtyMilli: 1000, priceMinor: 149900, taxRateBp: 500, hsn: '6205', unit: 'pcs' },
        { itemId: 'i_cl_kurti', name: 'Embroidered Anarkali Cotton Kurti (L)', qtyMilli: 1000, priceMinor: 189900, taxRateBp: 500, hsn: '6204', unit: 'pcs' },
      ],
    },
  },
];

async function seedSupermarket(db: any, passwordHash: string, todayStr: string) {
  const tenantId = 't_demo_supermarket';
  console.log(`\n======================================================`);
  console.log(`Seeding Primary Business [RETAIL / MULTI-BRANCH]: Shree Krishna Supermarket & Retail`);

  await db.tx(async (q: any) => {
    // 1. Tenant
    await q.exec(
      `INSERT INTO tenants (id, name, business_type, gstin, state_code, address, phone, upi_id, invoice_prefix, language, locations)
       VALUES (?, 'Shree Krishna Supermarket & Retail', 'retail', '33AAAAA0000A1Z9', '33',
               '124 Gandhi Road, T. Nagar, Chennai, Tamil Nadu - 600017', '+91 98401 23456',
               'shreekrishna@okaxis', 'SKS', 'en', ?::jsonb)
       ON CONFLICT (id) DO UPDATE SET 
          name = EXCLUDED.name,
          invoice_prefix = EXCLUDED.invoice_prefix`,
      [tenantId, j(['MAIN', 'SKS_POR', 'SKS_TNAGAR'])],
    );

    // 2. Branches
    const branches = [
      { id: 'br_main_store', code: 'MAIN', name: 'SKS Main Central Branch', address: '124 Gandhi Road, T. Nagar, Chennai - 600017', counters: ['MAIN-C01'] },
      { id: 'br_porur_store', code: 'SKS_POR', name: 'Shree Krishna–PORUR', address: '52 Mount Poonamallee Rd, Porur, Chennai - 600116', counters: ['POR-C01'] },
      { id: 'br_tnagar_store', code: 'SKS_TNAGAR', name: 'Shree Krishna TNagar', address: '18 Usman Road, T. Nagar, Chennai - 600017', counters: ['TNR-C01'] },
    ];

    for (const br of branches) {
      await q.exec(
        `INSERT INTO branches (id, tenant_id, code, name, address, active, counters)
         VALUES (?, ?, ?, ?, ?, true, ?::jsonb)
         ON CONFLICT (tenant_id, code) DO UPDATE SET
            name = EXCLUDED.name,
            address = EXCLUDED.address,
            active = true,
            counters = EXCLUDED.counters`,
        [br.id, tenantId, br.code, br.name, br.address, j(br.counters)],
      );
    }

    // 3. Counters
    const counters = [
      { id: 'cnt_main_1', branchId: 'br_main_store', name: 'Counter 1', code: 'MAIN-C01', username: 'sks_main_c1' },
      { id: 'cnt_por_1', branchId: 'br_porur_store', name: 'Counter 1', code: 'POR-C01', username: 'sks_por_c1' },
      { id: 'cnt_tnr_1', branchId: 'br_tnagar_store', name: 'Counter 1', code: 'TNR-C01', username: 'sks_tnr_c1' },
    ];
    for (const c of counters) {
      await q.exec(
        `INSERT INTO counters (id, tenant_id, branch_id, name, code, login_username, status)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
         ON CONFLICT (tenant_id, code) DO UPDATE SET
            branch_id = EXCLUDED.branch_id,
            name = EXCLUDED.name,
            status = 'ACTIVE'`,
        [c.id, tenantId, c.branchId, c.name, c.code, c.username],
      );
    }

    // 4. Users
    const users = [
      { id: 'u_demo_owner', name: 'Sangeetha Priya (Super Admin)', username: 'sangeetha', email: 'demo@billing.local', role: 'owner', branchId: null },
      { id: 'u_demo_manager', name: 'Kavitha Raman (Store Manager)', username: 'kavitha.r', email: 'manager@billing.local', role: 'manager', branchId: 'br_main_store' },
      { id: 'u_main_cashier', name: 'Lakshmi', username: 'lakshmi', email: 'lakshmi@billing.local', role: 'cashier', branchId: 'br_main_store', counterId: 'cnt_main_1' },
      { id: 'u_porur_manager', name: 'Sri', username: 'srishakram', email: 'srishakram086@gmail.com', role: 'manager', branchId: 'br_porur_store' },
      { id: 'u_porur_cashier', name: 'Anand (Cashier)', username: 'anand', email: 'anand@billing.local', role: 'cashier', branchId: 'br_porur_store', counterId: 'cnt_por_1' },
      { id: 'u_tnagar_manager', name: 'Rajesh (Store Manager)', username: 'rajesh', email: 'tnagar.mgr@billing.local', role: 'manager', branchId: 'br_tnagar_store' },
    ];

    for (const u of users) {
      const uPasswordHash = u.id === 'u_porur_manager' ? hashPassword('Sri1234!') : passwordHash;
      await q.exec(
        `INSERT INTO users (id, tenant_id, name, username, email, password_hash, role, branch_id, active, counter_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, true, ?)
         ON CONFLICT (lower(email)) DO UPDATE SET
            name = EXCLUDED.name,
            username = EXCLUDED.username,
            role = EXCLUDED.role,
            branch_id = EXCLUDED.branch_id,
            password_hash = COALESCE(users.password_hash, EXCLUDED.password_hash),
            counter_id = EXCLUDED.counter_id,
            active = true`,
        [u.id, tenantId, u.name, u.username, u.email, uPasswordHash, u.role, u.branchId, u.counterId || null],
      );
    }

    // Link branch managers
    await q.exec('UPDATE branches SET manager_id = ? WHERE id = ?', ['u_demo_manager', 'br_main_store']);
    await q.exec('UPDATE branches SET manager_id = ? WHERE id = ?', ['u_porur_manager', 'br_porur_store']);
    await q.exec('UPDATE branches SET manager_id = ? WHERE id = ?', ['u_tnagar_manager', 'br_tnagar_store']);

    // 5. Number Series per branch
    const seriesList = [
      { branchId: 'br_main_store', series: 'SKS', nextNo: 11 },
      { branchId: 'br_main_store', series: 'SHF', nextNo: 2 },
      { branchId: 'br_main_store', series: 'TRF', nextNo: 2 },
      { branchId: 'br_porur_store', series: 'POR', nextNo: 2 },
      { branchId: 'br_porur_store', series: 'SHF', nextNo: 2 },
      { branchId: 'br_tnagar_store', series: 'TNR', nextNo: 1 },
      { branchId: 'br_tnagar_store', series: 'SHF', nextNo: 1 },
    ];
    for (const ns of seriesList) {
      await q.exec(
        `INSERT INTO number_series (tenant_id, branch_id, series, next_no)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (tenant_id, branch_id, series) DO UPDATE SET next_no = EXCLUDED.next_no`,
        [tenantId, ns.branchId, ns.series, ns.nextNo],
      );
    }

    // 6. MAIN BRANCH SEEDING
    console.log('   -> Seeding Main Branch: full catalog (10 items), categories, stock, bills...');
    const mainCategories = [
      'Grocery',
      'Flour & Grains',
      'Edible Oils',
      'Pulses',
      'Snacks & Bakery',
      'Personal Care',
      'Beverages',
      'Dairy & Eggs',
    ];
    for (const cat of mainCategories) {
      await q.exec(
        `INSERT INTO categories (id, tenant_id, branch_id, name, active)
         VALUES (?, ?, 'br_main_store', ?, true)
         ON CONFLICT (tenant_id, branch_id, lower(name)) DO NOTHING`,
        [newId('cat'), tenantId, cat],
      );
    }

    const mainItems = [
      { id: 'i_rice_5k_main', name: 'India Gate Basmati Rice 5kg', sku: 'RICE-BAS-5K', barcode: '890103038101', hsn: '1006', unit: 'bag', category: 'Grocery', price: 42000, cost: 36000, taxBp: 500, stock: 45 },
      { id: 'i_atta_5k_main', name: 'Aashirvaad Superior MP Sharbati Atta 5kg', sku: 'ATTA-AAS-5K', barcode: '890172518123', hsn: '1101', unit: 'bag', category: 'Flour & Grains', price: 27500, cost: 23500, taxBp: 500, stock: 60 },
      { id: 'i_oil_1l_main', name: 'Fortune Sunlite Refined Sunflower Oil 1L', sku: 'OIL-SUN-1L', barcode: '890600728101', hsn: '1512', unit: 'pouch', category: 'Edible Oils', price: 14500, cost: 12500, taxBp: 500, stock: 80 },
      { id: 'i_salt_1k_main', name: 'Tata Salt Vacuum Evaporated 1kg', sku: 'SALT-TAT-1K', barcode: '890400440012', hsn: '2501', unit: 'pkt', category: 'Grocery', price: 2800, cost: 2200, taxBp: 0, stock: 120 },
      { id: 'i_toor_1k_main', name: 'Organic Toor Dal 1kg', sku: 'DAL-TUR-1K', barcode: '890400440050', hsn: '0713', unit: 'kg', category: 'Pulses', price: 16500, cost: 14000, taxBp: 0, stock: 50 },
      { id: 'i_sugar_1k_main', name: 'Madhur Pure & Hygienic Sugar 1kg', sku: 'SUG-MAD-1K', barcode: '890601441005', hsn: '1701', unit: 'kg', category: 'Grocery', price: 4800, cost: 4200, taxBp: 500, stock: 95 },
      { id: 'i_biscuit_parle_main', name: 'Parle-G Gold Glucose Biscuits 250g', sku: 'BIS-PAR-250', barcode: '890171910101', hsn: '1905', unit: 'pkt', category: 'Snacks & Bakery', price: 3000, cost: 2400, taxBp: 1800, stock: 150 },
      { id: 'i_soap_dettol_main', name: 'Dettol Original Germ Protection Bathing Soap 125g', sku: 'SOP-DET-125', barcode: '890139611202', hsn: '3401', unit: 'pcs', category: 'Personal Care', price: 6800, cost: 5400, taxBp: 1800, stock: 90 },
      { id: 'i_paste_colg_main', name: 'Colgate Strong Teeth Dental Cream 200g', sku: 'DEN-COL-200', barcode: '890131401010', hsn: '3306', unit: 'pcs', category: 'Personal Care', price: 11500, cost: 9200, taxBp: 1800, stock: 75 },
      { id: 'i_tea_red_main', name: 'Red Label Natural Care Tea 500g', sku: 'BEV-RED-500', barcode: '890103038902', hsn: '0902', unit: 'box', category: 'Beverages', price: 29000, cost: 24500, taxBp: 500, stock: 40 },
      { id: 'i_milk_amul_main', name: 'Amul Taaza Homogenised Toned Milk 1L', sku: 'MLK-AMU-1L', barcode: '890126201005', hsn: '0401', unit: 'pouch', category: 'Dairy & Eggs', price: 5400, cost: 4600, taxBp: 0, stock: 60 },
    ];

    for (const item of mainItems) {
      await q.exec(
        `INSERT INTO items (id, tenant_id, branch_id, name, sku, barcode, hsn, unit, category, price_minor, cost_minor, tax_rate_bp, tax_inclusive, track_stock, custom, active)
         VALUES (?, ?, 'br_main_store', ?, ?, ?, ?, ?, ?, ?, ?, ?, true, true, '{}'::jsonb, true)
         ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            branch_id = 'br_main_store',
            price_minor = EXCLUDED.price_minor,
            cost_minor = EXCLUDED.cost_minor,
            category = EXCLUDED.category`,
        [item.id, tenantId, item.name, item.sku, item.barcode, item.hsn, item.unit, item.category, item.price, item.cost, item.taxBp],
      );

      await q.exec(
        `INSERT INTO product_barcodes (id, tenant_id, branch_id, product_id, barcode, barcode_type)
         VALUES (?, ?, 'br_main_store', ?, ?, 'MANUFACTURER')
         ON CONFLICT (tenant_id, branch_id, barcode) DO NOTHING`,
        [newId('bc'), tenantId, item.id, item.barcode],
      );

      const hasStock = await q.one('SELECT 1 FROM stock_moves WHERE tenant_id = ? AND branch_id = ? AND item_id = ?', [tenantId, 'br_main_store', item.id]);
      if (!hasStock) {
        await q.exec(
          `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, location, qty_milli, kind, unit_cost_minor, reason, user_id)
           VALUES (?, ?, 'br_main_store', ?, 'MAIN', ?, 'opening', ?, 'Initial Demo Stock', 'u_demo_owner')`,
          [newId('sm'), tenantId, item.id, item.stock * 1000, item.cost],
        );
      }
    }

    // Main Branch Parties
    const mainParties = [
      { id: 'p_cust_main_1', name: 'Ramesh Kumar', phone: '9840123456', email: 'ramesh.k@example.com', type: 'customer', address: '12 4th Cross St, Chennai', credit: 500000, loyaltyPoints: 145 },
      { id: 'p_cust_main_2', name: 'Priya Sundaram', phone: '9840987654', email: 'priya.s@example.com', type: 'customer', address: '45 Anna Nagar, Chennai', credit: 300000, loyaltyPoints: 210 },
      { id: 'p_supp_main_1', name: 'Hindustan Fast Moving Consumer Goods Ltd', phone: '044-24567890', gstin: '33AAACH1234F1Z5', type: 'supplier', address: 'Industrial Estate, Guindy, Chennai', credit: 0 },
    ];
    for (const p of mainParties) {
      await q.exec(
        `INSERT INTO parties (id, tenant_id, branch_id, type, name, phone, email, gstin, state_code, address, credit_limit_minor, loyalty_points)
         VALUES (?, ?, 'br_main_store', ?, ?, ?, ?, ?, '33', ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
            branch_id = 'br_main_store',
            name = EXCLUDED.name,
            phone = EXCLUDED.phone`,
        [p.id, tenantId, p.type, p.name, p.phone || null, p.email || null, p.gstin || null, p.address || null, p.credit || 0, p.loyaltyPoints || 0],
      );
    }

    // Main Branch Open Shift
    await q.exec(
      `INSERT INTO shifts (id, tenant_id, branch_id, user_id, location, counter, shift_number, opening_cash_minor, status, opened_at)
       VALUES ('shf_main_open', ?, 'br_main_store', 'u_main_cashier', 'MAIN', 'MAIN-C01', 'SHF-1001', 200000, 'open', now())
       ON CONFLICT (id) DO NOTHING`,
      [tenantId],
    );

    // Main Branch Bill
    const mainInvId = 'inv_main_demo_1';
    const hasMainInv = await q.one('SELECT 1 FROM invoices WHERE tenant_id = ? AND id = ?', [tenantId, mainInvId]);
    if (!hasMainInv) {
      const demoLines = [
        { itemId: 'i_rice_5k_main', name: 'India Gate Basmati Rice 5kg', qtyMilli: 2000, priceMinor: 42000, taxRateBp: 500, hsn: '1006', unit: 'bag' },
        { itemId: 'i_oil_1l_main', name: 'Fortune Sunlite Refined Sunflower Oil 1L', qtyMilli: 1000, priceMinor: 14500, taxRateBp: 500, hsn: '1512', unit: 'pouch' },
        { itemId: 'i_biscuit_parle_main', name: 'Parle-G Gold Glucose Biscuits 250g', qtyMilli: 2000, priceMinor: 3000, taxRateBp: 1800, hsn: '1905', unit: 'pkt' },
      ];
      const calculated = calcBill(
        demoLines.map((l) => ({
          name: l.name,
          qtyMilli: l.qtyMilli,
          priceMinor: l.priceMinor,
          discountMinor: 0,
          taxRateBp: l.taxRateBp,
          inclusive: true,
        })),
        { intraState: true, roundTotal: 'rupee' },
      );

      await q.exec(
        `INSERT INTO invoices (
          id, tenant_id, branch_id, client_id, number, kind, status, bdate, party_id,
          customer_name, customer_phone, place_state, intra,
          subtotal_minor, taxable_minor, cgst_minor, sgst_minor, round_off_minor, total_minor,
          paid_minor, balance_minor, rule_version, calc, share_token, created_by, location, counter, shift_id
        ) VALUES (?, ?, 'br_main_store', ?, 'SKS-1001', 'sale', 'posted', ?, 'p_cust_main_1',
                 'Ramesh Kumar', '9840123456', '33', true,
                 ?, ?, ?, ?, ?, ?,
                 ?, 0, '1.0', ?::jsonb, ?, 'u_main_cashier', 'MAIN', 'MAIN-C01', 'shf_main_open')`,
        [
          mainInvId, tenantId, newId('cid'), todayStr,
          calculated.subtotalMinor, calculated.taxableMinor, calculated.cgstMinor, calculated.sgstMinor, calculated.roundOffMinor, calculated.totalMinor,
          calculated.totalMinor, j(calculated), newId('tok'),
        ],
      );

      for (let i = 0; i < calculated.lines.length; i++) {
        const l = calculated.lines[i];
        const orig = demoLines[i];
        await q.exec(
          `INSERT INTO invoice_lines (
            id, tenant_id, branch_id, invoice_id, pos, item_id, name, hsn, unit,
            qty_milli, price_minor, discount_minor, tax_rate_bp, inclusive,
            taxable_minor, cgst_minor, sgst_minor, total_minor
          ) VALUES (?, ?, 'br_main_store', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, true, ?, ?, ?, ?)`,
          [
            newId('inl'), tenantId, mainInvId, i + 1, orig.itemId, orig.name, orig.hsn, orig.unit,
            orig.qtyMilli, orig.priceMinor, orig.taxRateBp, l.taxableMinor, l.cgstMinor, l.sgstMinor, l.totalMinor,
          ],
        );

        // Deduct sold stock
        await q.exec(
          `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, location, qty_milli, kind, ref_type, ref_id, reason, user_id)
           VALUES (?, ?, 'br_main_store', ?, 'MAIN', ?, 'sale', 'invoice', ?, 'POS Sale', 'u_main_cashier')`,
          [newId('sm'), tenantId, orig.itemId, -orig.qtyMilli, mainInvId],
        );
      }

      await q.exec(
        `INSERT INTO payments (id, tenant_id, branch_id, kind, method, amount_minor, invoice_id, party_id, reference, bdate, created_by, location, counter, shift_id)
         VALUES (?, ?, 'br_main_store', 'receipt', 'cash', ?, ?, 'p_cust_main_1', 'CASH/DEMO-MAIN', ?, 'u_main_cashier', 'MAIN', 'MAIN-C01', 'shf_main_open')`,
        [newId('pay'), tenantId, calculated.totalMinor, mainInvId, todayStr],
      );
    }

    // 7. PORUR BRANCH SEEDING:
    // Starts with 0 products and 0 categories (clean empty catalog as required).
    // Store Manager / Cashier Sri assigned to Shree Krishna-PORUR.
    console.log('   -> Verified PORUR Branch: clean empty catalog (0 products, 0 categories), Sri assigned as Manager.');

    // 8. TNAGAR BRANCH SEEDING: ZERO / EMPTY
    console.log('   -> Verified TNagar Branch: completely empty (0 items, 0 categories, 0 stock, 0 bills).');

    // 9. STOCK TRANSFER: 1 Transfer Main -> PORUR (5 bags Atta)
    console.log('   -> Seeding Stock Transfer: Main -> PORUR (5 bags Atta)...');
    const trfId = 'trf_demo_1';
    const hasTrf = await q.one('SELECT 1 FROM stock_transfers WHERE tenant_id = ? AND id = ?', [tenantId, trfId]);
    if (!hasTrf) {
      await q.exec(
        `INSERT INTO stock_transfers (
          id, tenant_id, transfer_number, from_branch, to_branch, status, transfer_date,
          requested_by, approved_by, approved_at, dispatched_by, dispatched_at, received_by, received_at, notes, metadata
        ) VALUES (
          ?, ?, 'TRF-1001', 'br_main_store', 'br_porur_store', 'completed', ?,
          'u_porur_manager', 'u_demo_manager', now(), 'u_main_cashier', now(), 'u_porur_manager', now(),
          'Routine replenishment transfer', '{}'::jsonb
        )`,
        [trfId, tenantId, todayStr],
      );

      const trfLineId = 'trfl_demo_1';
      await q.exec(
        `INSERT INTO stock_transfer_lines (
          id, tenant_id, transfer_id, item_id, qty_milli, received_qty_milli, discrepancy_milli, unit
        ) VALUES (?, ?, ?, 'i_atta_5k_main', 5000, 5000, 0, 'bag')`,
        [trfLineId, tenantId, trfId],
      );

      // Outward move at Main
      await q.exec(
        `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, location, qty_milli, kind, ref_type, ref_id, ref_line_id, reason, user_id)
         VALUES (?, ?, 'br_main_store', 'i_atta_5k_main', 'MAIN', -5000, 'transfer', 'stock_transfer', ?, ?, 'Stock transfer dispatched to PORUR', 'u_main_cashier')`,
        [newId('sm'), tenantId, trfId, trfLineId],
      );

      // Inward move at PORUR
      await q.exec(
        `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, location, qty_milli, kind, ref_type, ref_id, ref_line_id, reason, user_id)
         VALUES (?, ?, 'br_porur_store', 'i_atta_5k_por', 'SKS_POR', 5000, 'transfer', 'stock_transfer', ?, ?, 'Stock transfer received from Main', 'u_porur_manager')`,
        [newId('sm'), tenantId, trfId, trfLineId],
      );
    }
  });

  console.log(`✅ Shree Krishna Supermarket & Retail fully seeded with branch-wise isolation!`);
}

async function seedOtherBusiness(db: any, b: BusinessSeed, passwordHash: string, todayStr: string) {
  console.log(`\n======================================================`);
  console.log(`Checking / Seeding Business: [${b.businessType.toUpperCase()}] ${b.name}`);

  const defaultBranchId = `br_${b.tenantId}_main`;

  await db.tx(async (q: any) => {
    // 1. Tenant
    await q.exec(
      `INSERT INTO tenants (id, name, business_type, gstin, state_code, address, phone, upi_id, invoice_prefix, language, locations)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'en', ?::jsonb)
       ON CONFLICT (id) DO UPDATE SET 
          name = EXCLUDED.name,
          business_type = EXCLUDED.business_type,
          gstin = EXCLUDED.gstin,
          address = EXCLUDED.address,
          phone = EXCLUDED.phone,
          upi_id = EXCLUDED.upi_id,
          invoice_prefix = EXCLUDED.invoice_prefix`,
      [b.tenantId, b.name, b.businessType, b.gstin, b.stateCode, b.address, b.phone, b.upiId, b.invoicePrefix, j(['MAIN'])],
    );

    // 2. Default Branch
    await q.exec(
      `INSERT INTO branches (id, tenant_id, code, name, address, active, counters)
       VALUES (?, ?, 'MAIN', ?, ?, true, '["COUNTER-1"]'::jsonb)
       ON CONFLICT (tenant_id, code) DO NOTHING`,
      [defaultBranchId, b.tenantId, `${b.name} (Main Store)`, b.address],
    );

    // 3. Owner User
    const existingUser = (await q.one('SELECT id FROM users WHERE lower(email) = ?', [b.ownerEmail.toLowerCase()])) as { id: string } | null;
    let userId: string;
    if (existingUser) {
      userId = existingUser.id;
      await q.exec('UPDATE users SET tenant_id = ?, name = ?, password_hash = ? WHERE id = ?', [b.tenantId, b.ownerName, passwordHash, userId]);
    } else {
      userId = `u_${b.tenantId.replace('t_', '')}_owner`;
      await q.exec(
        `INSERT INTO users (id, tenant_id, name, email, password_hash, role, branch_id, active)
         VALUES (?, ?, ?, ?, ?, 'owner', ?, true)`,
        [userId, b.tenantId, b.ownerName, b.ownerEmail, passwordHash, defaultBranchId],
      );
    }

    // Number series
    await q.exec(
      `INSERT INTO number_series (tenant_id, branch_id, series, next_no)
       VALUES (?, ?, ?, 2)
       ON CONFLICT (tenant_id, branch_id, series) DO UPDATE SET next_no = EXCLUDED.next_no`,
      [b.tenantId, defaultBranchId, b.invoicePrefix],
    );

    // 4. Parties
    for (const p of b.parties) {
      await q.exec(
        `INSERT INTO parties (id, tenant_id, branch_id, type, name, phone, email, gstin, state_code, address, credit_limit_minor, loyalty_points)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, '33', ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           branch_id = EXCLUDED.branch_id,
           phone = EXCLUDED.phone,
           loyalty_points = EXCLUDED.loyalty_points`,
        [p.id, b.tenantId, defaultBranchId, p.type, p.name, p.phone || null, p.email || null, p.gstin || null, p.address || null, p.credit || 0, p.loyaltyPoints || 0],
      );
    }

    // 5. Items & Barcodes
    for (const item of b.items) {
      await q.exec(
        `INSERT INTO categories (id, tenant_id, branch_id, name, active)
         VALUES (?, ?, ?, ?, true)
         ON CONFLICT (tenant_id, branch_id, lower(name)) DO NOTHING`,
        [newId('cat'), b.tenantId, defaultBranchId, item.category],
      );

      await q.exec(
        `INSERT INTO items (id, tenant_id, branch_id, name, sku, barcode, hsn, unit, category, price_minor, cost_minor, tax_rate_bp, tax_inclusive, track_stock, custom, active, image_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, true, ?::jsonb, true, ?)
         ON CONFLICT (id) DO UPDATE SET 
            branch_id = EXCLUDED.branch_id,
            price_minor = EXCLUDED.price_minor,
            cost_minor = EXCLUDED.cost_minor,
            custom = EXCLUDED.custom,
            category = EXCLUDED.category,
            image_url = COALESCE(items.image_url, EXCLUDED.image_url)`,
        [item.id, b.tenantId, defaultBranchId, item.name, item.sku || null, item.barcode || null, item.hsn || null, item.unit, item.category, item.price, item.cost, item.taxBp, j(item.custom || {}), item.imageUrl || null],
      );

      if (item.barcode) {
        await q.exec(
          `INSERT INTO product_barcodes (id, tenant_id, branch_id, product_id, barcode, barcode_type)
           VALUES (?, ?, ?, ?, ?, 'MANUFACTURER')
           ON CONFLICT (tenant_id, branch_id, barcode) DO NOTHING`,
          [newId('bc'), b.tenantId, defaultBranchId, item.id, item.barcode],
        );
      }

      // Opening stock
      const hasStock = await q.one('SELECT 1 FROM stock_moves WHERE tenant_id = ? AND branch_id = ? AND item_id = ?', [b.tenantId, defaultBranchId, item.id]);
      if (!hasStock) {
        await q.exec(
          `INSERT INTO stock_moves (id, tenant_id, branch_id, item_id, location, qty_milli, kind, unit_cost_minor, batch_no, expiry, reason, user_id)
           VALUES (?, ?, ?, ?, 'MAIN', ?, 'opening', ?, ?, ?, 'Initial Demo Stock', ?)`,
          [newId('sm'), b.tenantId, defaultBranchId, item.id, item.stock * 1000, item.cost, item.custom?.batch || null, item.custom?.expiry || null, userId],
        );
      }
    }

    // 6. Sample Invoice
    const existingInv = await q.one('SELECT 1 FROM invoices WHERE tenant_id = ? AND number = ?', [b.tenantId, b.sampleInvoice.number]);
    if (!existingInv) {
      const invId = newId('inv');
      const shareToken = newId('tok');
      const demoLines = b.sampleInvoice.lines;
      const calculated = calcBill(
        demoLines.map((l) => ({
          name: l.name,
          qtyMilli: l.qtyMilli,
          priceMinor: l.priceMinor,
          discountMinor: 0,
          taxRateBp: l.taxRateBp,
          inclusive: true,
        })),
        { intraState: true, roundTotal: 'rupee' },
      );

      await q.exec(
        `INSERT INTO invoices (
          id, tenant_id, branch_id, client_id, number, kind, status, bdate, party_id,
          customer_name, customer_phone, place_state, intra,
          subtotal_minor, taxable_minor, cgst_minor, sgst_minor, round_off_minor, total_minor,
          paid_minor, balance_minor, rule_version, calc, custom, share_token, created_by, location, counter
        ) VALUES (?, ?, ?, ?, ?, 'sale', 'posted', ?, ?, ?, ?, '33', true, ?, ?, ?, ?, ?, ?, ?, 0, '1.0', ?::jsonb, ?::jsonb, ?, ?, 'MAIN', 'COUNTER-1')`,
        [
          invId,
          b.tenantId,
          defaultBranchId,
          newId('cid'),
          b.sampleInvoice.number,
          todayStr,
          b.sampleInvoice.partyId || null,
          b.sampleInvoice.customerName,
          b.sampleInvoice.customerPhone,
          calculated.subtotalMinor,
          calculated.taxableMinor,
          calculated.cgstMinor,
          calculated.sgstMinor,
          calculated.roundOffMinor,
          calculated.totalMinor,
          calculated.totalMinor,
          j(calculated),
          j(b.sampleInvoice.custom || {}),
          shareToken,
          userId,
        ],
      );

      for (let i = 0; i < calculated.lines.length; i++) {
        const l = calculated.lines[i];
        const orig = demoLines[i];
        await q.exec(
          `INSERT INTO invoice_lines (
            id, tenant_id, branch_id, invoice_id, pos, item_id, name, hsn, unit, batch_no,
            qty_milli, price_minor, discount_minor, tax_rate_bp, inclusive,
            taxable_minor, cgst_minor, sgst_minor, total_minor
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, true, ?, ?, ?, ?)`,
          [
            newId('inl'),
            b.tenantId,
            defaultBranchId,
            invId,
            i + 1,
            orig.itemId,
            orig.name,
            orig.hsn || null,
            orig.unit || null,
            orig.batchNo || null,
            orig.qtyMilli,
            orig.priceMinor,
            orig.taxRateBp,
            l.taxableMinor,
            l.cgstMinor,
            l.sgstMinor,
            l.totalMinor,
          ],
        );
      }

      await q.exec(
        `INSERT INTO payments (id, tenant_id, branch_id, kind, method, amount_minor, invoice_id, party_id, reference, bdate, created_by, location, counter)
         VALUES (?, ?, ?, 'receipt', 'upi', ?, ?, ?, 'UPI/2026/DEMO-PAY', ?, ?, 'MAIN', 'COUNTER-1')`,
        [newId('pay'), b.tenantId, defaultBranchId, calculated.totalMinor, invId, b.sampleInvoice.partyId || null, todayStr, userId],
      );
    }
  });

  console.log(`✅ Business [${b.businessType.toUpperCase()}] Seeded Successfully:`);
  console.log(`   Store:    ${b.name}`);
  console.log(`   Owner:    ${b.ownerName} (${b.ownerEmail})`);
}

async function seed() {
  console.log('Connecting to Neon PostgreSQL database...');
  const db = await connectDb();
  await migrate(db);

  const passwordHash = hashPassword('Password123!');
  const todayStr = new Date().toISOString().slice(0, 10);

  // 1. Seed Multi-Branch Primary Business (Supermarket)
  await seedSupermarket(db, passwordHash, todayStr);

  // 2. Seed other standalone business types
  for (const b of OTHER_BUSINESSES) {
    await seedOtherBusiness(db, b, passwordHash, todayStr);
  }

  console.log('\n🎉 ALL BUSINESSES ARE FULLY SEEDED WITH BRANCH-SPECIFIC ISOLATION!');
  await db.close();
}

seed().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
