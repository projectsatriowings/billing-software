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

const BUSINESSES: BusinessSeed[] = [
  // 1. RETAIL / SUPERMARKET
  {
    tenantId: 't_demo_supermarket',
    name: 'Shree Krishna Supermarket & Retail',
    businessType: 'retail',
    gstin: '33AAAAA0000A1Z9',
    stateCode: '33',
    address: '124 Gandhi Road, T. Nagar, Chennai, Tamil Nadu - 600017',
    phone: '+91 98401 23456',
    upiId: 'shreekrishna@okaxis',
    invoicePrefix: 'SKM',
    ownerName: 'Sangeetha Priya',
    ownerEmail: 'demo@billing.local',
    parties: [
      { id: 'p_cust_1', name: 'Ramesh Kumar', phone: '9840123456', email: 'ramesh.k@example.com', type: 'customer', address: '12 4th Cross St, Chennai', credit: 500000, loyaltyPoints: 145 },
      { id: 'p_cust_2', name: 'Priya Sundaram', phone: '9840987654', email: 'priya.s@example.com', type: 'customer', address: '45 Anna Nagar, Chennai', credit: 300000, loyaltyPoints: 210 },
      { id: 'p_ret_s1', name: 'Hindustan Fast Moving Consumer Goods Ltd', phone: '044-24567890', type: 'supplier', address: 'Industrial Estate, Guindy, Chennai', credit: 0 },
    ],
    items: [
      { id: 'i_rice_5k', name: 'India Gate Basmati Rice 5kg', sku: 'RICE-BAS-5K', barcode: '890103038101', hsn: '1006', unit: 'bag', category: 'Grocery', price: 42000, cost: 36000, taxBp: 500, stock: 45 },
      { id: 'i_atta_5k', name: 'Aashirvaad Superior MP Sharbati Atta 5kg', sku: 'ATTA-AAS-5K', barcode: '890172518123', hsn: '1101', unit: 'bag', category: 'Flour & Grains', price: 27500, cost: 23500, taxBp: 500, stock: 60 },
      { id: 'i_oil_1l', name: 'Fortune Sunlite Refined Sunflower Oil 1L', sku: 'OIL-SUN-1L', barcode: '890600728101', hsn: '1512', unit: 'pouch', category: 'Edible Oils', price: 14500, cost: 12500, taxBp: 500, stock: 80 },
      { id: 'i_salt_1k', name: 'Tata Salt Vacuum Evaporated 1kg', sku: 'SALT-TAT-1K', barcode: '890400440012', hsn: '2501', unit: 'pkt', category: 'Grocery', price: 2800, cost: 2200, taxBp: 0, stock: 120 },
      { id: 'i_toor_1k', name: 'Organic Toor Dal 1kg', sku: 'DAL-TUR-1K', barcode: '890400440050', hsn: '0713', unit: 'kg', category: 'Pulses', price: 16500, cost: 14000, taxBp: 0, stock: 50 },
      { id: 'i_sugar_1k', name: 'Madhur Pure & Hygienic Sugar 1kg', sku: 'SUG-MAD-1K', barcode: '890601441005', hsn: '1701', unit: 'kg', category: 'Grocery', price: 4800, cost: 4200, taxBp: 500, stock: 95 },
      { id: 'i_biscuit_parle', name: 'Parle-G Gold Glucose Biscuits 250g', sku: 'BIS-PAR-250', barcode: '890171910101', hsn: '1905', unit: 'pkt', category: 'Snacks & Bakery', price: 3000, cost: 2400, taxBp: 1800, stock: 150 },
      { id: 'i_soap_dettol', name: 'Dettol Original Germ Protection Bathing Soap 125g', sku: 'SOP-DET-125', barcode: '890139611202', hsn: '3401', unit: 'pcs', category: 'Personal Care', price: 6800, cost: 5400, taxBp: 1800, stock: 90 },
      { id: 'i_paste_colg', name: 'Colgate Strong Teeth Dental Cream 200g', sku: 'DEN-COL-200', barcode: '890131401010', hsn: '3306', unit: 'pcs', category: 'Personal Care', price: 11500, cost: 9200, taxBp: 1800, stock: 75 },
      { id: 'i_tea_red', name: 'Red Label Natural Care Tea 500g', sku: 'BEV-RED-500', barcode: '890103038902', hsn: '0902', unit: 'box', category: 'Beverages', price: 29000, cost: 24500, taxBp: 500, stock: 40 },
    ],
    sampleInvoice: {
      number: 'SKM-1001',
      customerName: 'Ramesh Kumar',
      customerPhone: '9840123456',
      partyId: 'p_ret_c1',
      lines: [
        { itemId: 'i_rice_5k', name: 'India Gate Basmati Rice 5kg', qtyMilli: 2000, priceMinor: 42000, taxRateBp: 500, hsn: '1006', unit: 'bag' },
        { itemId: 'i_oil_1l', name: 'Fortune Sunlite Refined Sunflower Oil 1L', qtyMilli: 3000, priceMinor: 14500, taxRateBp: 500, hsn: '1512', unit: 'pouch' },
        { itemId: 'i_biscuit_parle', name: 'Parle-G Gold Glucose Biscuits 250g', qtyMilli: 4000, priceMinor: 3000, taxRateBp: 1800, hsn: '1905', unit: 'pkt' },
      ],
    },
  },

  // 2. PHARMACY & HEALTHCARE
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

  // 3. RESTAURANT & CAFE
  {
    tenantId: 't_demo_restaurant',
    name: 'Annapoorna Pure Veg Restaurant & Cafe',
    businessType: 'restaurant',
    gstin: '33ANAPN5678B1Z6',
    stateCode: '33',
    address: '42 Usman Road, T. Nagar, Chennai - 600017',
    phone: '+91 98403 45678',
    upiId: 'annapoorna@okaxis',
    invoicePrefix: 'REST',
    ownerName: 'Chef Venkatesh Swaminathan',
    ownerEmail: 'restaurant@billing.local',
    parties: [
      { id: 'p_res_c1', name: 'Table 4 (Dine-in Family)', phone: '9840556677', type: 'customer', address: 'Dine-In AC Section' },
      { id: 'p_res_c2', name: 'Swiggy / Zomato Express Counter', phone: '9840998877', type: 'customer', address: 'Online Delivery' },
      { id: 'p_res_s1', name: 'Metro Fresh Dairy & Vegetables Supply', phone: '044-28905544', type: 'supplier', address: 'Koyambedu, Chennai' },
    ],
    items: [
      { id: 'i_ghee_dosa', name: 'Special Ghee Roast Masala Dosa', sku: 'RES-DOSA-01', hsn: '9963', unit: 'plate', category: 'South Indian Tiffin', price: 9500, cost: 4200, taxBp: 500, stock: 200 },
      { id: 'i_filter_coffee', name: 'Authentic Kumbakonam Degree Filter Coffee', sku: 'RES-COF-01', hsn: '9963', unit: 'cup', category: 'Hot Beverages', price: 4000, cost: 1500, taxBp: 500, stock: 500 },
      { id: 'i_idli_vada', name: 'Steamed Button Idli (2 pcs) with Medu Vada', sku: 'RES-IDLI-01', hsn: '9963', unit: 'plate', category: 'South Indian Tiffin', price: 6500, cost: 2500, taxBp: 500, stock: 250 },
      { id: 'i_paneer_butter', name: 'Paneer Butter Masala (Rich Cashew Gravy)', sku: 'RES-CURR-01', hsn: '9963', unit: 'portion', category: 'North Indian Gravies', price: 18500, cost: 9500, taxBp: 500, stock: 100 },
      { id: 'i_butter_naan', name: 'Tandoori Butter Naan (2 pcs)', sku: 'RES-ROTI-01', hsn: '9963', unit: 'portion', category: 'Breads & Tandoor', price: 7500, cost: 2800, taxBp: 500, stock: 300 },
      { id: 'i_veg_biryani', name: 'Hyderabadi Veg Dum Biryani with Raita', sku: 'RES-BIRY-01', hsn: '9963', unit: 'handi', category: 'Rice & Biryani', price: 19500, cost: 9800, taxBp: 500, stock: 120 },
      { id: 'i_gobi_manch', name: 'Crispy Gobi Manchurian (Dry)', sku: 'RES-STAR-01', hsn: '9963', unit: 'plate', category: 'Starters', price: 14500, cost: 6500, taxBp: 500, stock: 80 },
      { id: 'i_lime_soda', name: 'Fresh Mint Lime Soda (Sweet & Salt)', sku: 'RES-BEV-01', hsn: '9963', unit: 'glass', category: 'Cold Beverages', price: 5500, cost: 1800, taxBp: 500, stock: 150 },
      { id: 'i_gulab_jamun', name: 'Warm Gulab Jamun with Vanilla Ice Cream', sku: 'RES-DES-01', hsn: '9963', unit: 'bowl', category: 'Desserts', price: 8500, cost: 3200, taxBp: 500, stock: 90 },
    ],
    sampleInvoice: {
      number: 'REST-1001',
      customerName: 'Table 4 (Dine-in AC)',
      customerPhone: '9840556677',
      partyId: 'p_res_c1',
      custom: { table: 'Table 4', orderType: 'Dine-in' },
      lines: [
        { itemId: 'i_ghee_dosa', name: 'Special Ghee Roast Masala Dosa', qtyMilli: 2000, priceMinor: 9500, taxRateBp: 500, unit: 'plate' },
        { itemId: 'i_filter_coffee', name: 'Authentic Kumbakonam Degree Filter Coffee', qtyMilli: 2000, priceMinor: 4000, taxRateBp: 500, unit: 'cup' },
        { itemId: 'i_gulab_jamun', name: 'Warm Gulab Jamun with Vanilla Ice Cream', qtyMilli: 1000, priceMinor: 8500, taxRateBp: 500, unit: 'bowl' },
      ],
    },
  },

  // 4. WHOLESALE & DISTRIBUTION
  {
    tenantId: 't_demo_wholesale',
    name: 'Balaji Traders & Wholesale Distributors',
    businessType: 'wholesale',
    gstin: '33BLJTR9876C1ZE',
    stateCode: '33',
    address: 'Plot 15, Wholesale Market Complex, Koyambedu, Chennai - 600092',
    phone: '+91 98404 56789',
    upiId: 'balajitraders@okaxis',
    invoicePrefix: 'WHL',
    ownerName: 'Balaji Sundararajan',
    ownerEmail: 'wholesale@billing.local',
    parties: [
      { id: 'p_wh_c1', name: 'Sri Murugan Departmental Stores', phone: '9789012345', email: 'murugan.dept@stores.in', gstin: '33AABCS1234A1Z7', type: 'customer', address: 'Madurai Road, Trichy', credit: 2500000 },
      { id: 'p_wh_c2', name: 'City Retail Supermarkets Pvt Ltd', phone: '9841023456', email: 'purchase@cityretail.in', gstin: '33AABCC5678B1Z8', type: 'customer', address: '100 Feet Road, Coimbatore', credit: 5000000 },
      { id: 'p_wh_s1', name: 'Adani Wilmar Edible Oils Refinery Ltd', phone: '044-28551234', type: 'supplier', address: 'Port Trust Area, Chennai', credit: 0 },
    ],
    items: [
      { id: 'i_wh_rice_25k', name: 'Royal Heritage Basmati Rice 25kg (B2B Sack)', sku: 'WHL-RICE-25K', hsn: '1006', unit: 'bag', category: 'Bulk Grains', price: 215000, cost: 185000, taxBp: 500, stock: 350 },
      { id: 'i_wh_oil_15l', name: 'Fortune Sunlite Refined Oil 15L Commercial Tin', sku: 'WHL-OIL-15L', hsn: '1512', unit: 'tin', category: 'Bulk Oils', price: 189000, cost: 168000, taxBp: 500, stock: 240 },
      { id: 'i_wh_sugar_50k', name: 'Madhur Grade-M Refined White Sugar 50kg Sack', sku: 'WHL-SUG-50K', hsn: '1701', unit: 'sack', category: 'Bulk Commodities', price: 218000, cost: 195000, taxBp: 500, stock: 180 },
      { id: 'i_wh_atta_50k', name: 'Chakki Fresh Sharbati Atta 50kg Mill Pack', sku: 'WHL-ATTA-50K', hsn: '1101', unit: 'bag', category: 'Bulk Grains', price: 195000, cost: 172000, taxBp: 500, stock: 200 },
      { id: 'i_wh_salt_25k', name: 'Tata Pure Crystal Industrial Salt 25kg Master Carton', sku: 'WHL-SALT-25K', hsn: '2501', unit: 'ctn', category: 'Bulk Commodities', price: 62500, cost: 48000, taxBp: 0, stock: 500 },
      { id: 'i_wh_bisc_ctn', name: 'Parle-G Gold Biscuits (Master Carton 60 pkts)', sku: 'WHL-BIS-60', hsn: '1905', unit: 'ctn', category: 'FMCG Packaged Goods', price: 155000, cost: 132000, taxBp: 1800, stock: 160 },
    ],
    sampleInvoice: {
      number: 'WHL-1001',
      customerName: 'Sri Murugan Departmental Stores',
      customerPhone: '9789012345',
      partyId: 'p_wh_c1',
      custom: { poNumber: 'PO-2026-OCT-8812', vehicleNo: 'TN-04-AB-9844', deliveryRoute: 'Trichy Highway Route A' },
      lines: [
        { itemId: 'i_wh_rice_25k', name: 'Royal Heritage Basmati Rice 25kg (B2B Sack)', qtyMilli: 10000, priceMinor: 215000, taxRateBp: 500, hsn: '1006', unit: 'bag' },
        { itemId: 'i_wh_oil_15l', name: 'Fortune Sunlite Refined Oil 15L Commercial Tin', qtyMilli: 12000, priceMinor: 189000, taxRateBp: 500, hsn: '1512', unit: 'tin' },
        { itemId: 'i_wh_bisc_ctn', name: 'Parle-G Gold Biscuits (Master Carton 60 pkts)', qtyMilli: 15000, priceMinor: 155000, taxRateBp: 1800, hsn: '1905', unit: 'ctn' },
      ],
    },
  },

  // 5. PROFESSIONAL SERVICES & CONSULTANCY
  {
    tenantId: 't_demo_service',
    name: 'Vertex IT Solutions & Technical Services',
    businessType: 'service',
    gstin: '33VRTEX4321D1ZP',
    stateCode: '33',
    address: 'Technology Park, OMR IT Corridor, Sholinganallur, Chennai - 600119',
    phone: '+91 98405 67890',
    upiId: 'vertextech@okaxis',
    invoicePrefix: 'SRV',
    ownerName: 'Karthik Narayanan',
    ownerEmail: 'service@billing.local',
    parties: [
      { id: 'p_srv_c1', name: 'Cognizant Cloud Innovation Labs', phone: '9840112233', email: 'accounts@cognizant-labs.com', gstin: '33AABCT9988C1Z1', type: 'customer', address: 'DLF Cybercity, Chennai', credit: 10000000 },
      { id: 'p_srv_c2', name: 'Zepto Dark Stores Hub Operations', phone: '9840223344', email: 'billing@zepto-ops.in', gstin: '33AABCZ4455D1Z5', type: 'customer', address: 'Guindy Industrial Area, Chennai', credit: 5000000 },
      { id: 'p_srv_s1', name: 'Amazon Web Services India Pvt Ltd', phone: '080-45678901', type: 'supplier', address: 'World Trade Center, Bangalore' },
    ],
    items: [
      { id: 'i_srv_web', name: 'Custom Web & Cloud Application Development', sku: 'SRV-DEV-01', hsn: '998314', unit: 'hrs', category: 'Software Development', price: 250000, cost: 120000, taxBp: 1800, stock: 1000 },
      { id: 'i_srv_amc', name: 'Annual IT Network & Server Maintenance (AMC Monthly)', sku: 'SRV-AMC-01', hsn: '998717', unit: 'month', category: 'Maintenance Services', price: 2800000, cost: 1400000, taxBp: 1800, stock: 100 },
      { id: 'i_srv_cloud', name: 'Postgres & Cloud Database Optimization Contract', sku: 'SRV-DBA-01', hsn: '998315', unit: 'contract', category: 'Database Consulting', price: 4500000, cost: 2000000, taxBp: 1800, stock: 50 },
      { id: 'i_srv_gst', name: 'E-Invoicing API Integration & Compliance Setup', sku: 'SRV-API-01', hsn: '998313', unit: 'project', category: 'Fintech Integration', price: 3500000, cost: 1500000, taxBp: 1800, stock: 80 },
      { id: 'i_srv_audit', name: 'Cybersecurity Vulnerability Audit & Testing', sku: 'SRV-SEC-01', hsn: '998316', unit: 'audit', category: 'Security Services', price: 5000000, cost: 2200000, taxBp: 1800, stock: 30 },
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

  // 6. CLOTHING & TEXTILES (Style Haven Clothing)
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
      { id: 'i_cl_tshirt', name: 'Classic Crew Neck T-Shirt (M)', sku: 'CLO-TSH-CR-M', hsn: '6109', unit: 'pcs', category: 'Casuals', price: 69900, cost: 32000, taxBp: 500, stock: 80, custom: { size: 'M', color: 'Black', brand: 'StyleHaven' } },
      { id: 'i_cl_denim', name: 'Slim Fit Stretch Denim Jeans (32)', sku: 'CLO-JNS-SL-32', hsn: '6203', unit: 'pcs', category: 'Menswear', price: 219900, cost: 110000, taxBp: 1200, stock: 35, custom: { size: '32', color: 'Dark Indigo', brand: 'StyleHaven' } },
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

async function seed() {
  console.log('Connecting to Neon PostgreSQL database...');
  const db = await connectDb();
  await migrate(db);

  const passwordHash = hashPassword('Password123!');
  const todayStr = new Date().toISOString().slice(0, 10);

  for (const b of BUSINESSES) {
    console.log(`\n======================================================`);
    console.log(`Checking / Seeding Business: [${b.businessType.toUpperCase()}] ${b.name}`);

    await db.tx(async (q) => {
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
        [b.tenantId, b.name, b.businessType, b.gstin, b.stateCode, b.address, b.phone, b.upiId, b.invoicePrefix, j(['MAIN', 'GODOWN'])],
      );

      // 2. Owner User
      const existingUser = await q.one<{ id: string }>('SELECT id FROM users WHERE lower(email) = ?', [b.ownerEmail.toLowerCase()]);
      let userId: string;
      if (existingUser) {
        userId = existingUser.id;
        await q.exec('UPDATE users SET tenant_id = ?, name = ?, password_hash = ? WHERE id = ?', [b.tenantId, b.ownerName, passwordHash, userId]);
      } else {
        userId = `u_${b.tenantId.replace('t_', '')}_owner`;
        await q.exec(
          `INSERT INTO users (id, tenant_id, name, email, password_hash, role, active)
           VALUES (?, ?, ?, ?, ?, 'owner', true)`,
          [userId, b.tenantId, b.ownerName, b.ownerEmail, passwordHash],
        );
      }

      // 3. Parties
      for (const p of b.parties) {
        await q.exec(
          `INSERT INTO parties (id, tenant_id, type, name, phone, email, gstin, state_code, address, credit_limit_minor, loyalty_points)
           VALUES (?, ?, ?, ?, ?, ?, ?, '33', ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             phone = EXCLUDED.phone,
             loyalty_points = EXCLUDED.loyalty_points`,
          [p.id, b.tenantId, p.type, p.name, p.phone || null, p.email || null, p.gstin || null, p.address || null, p.credit || 0, p.loyaltyPoints || 0],
        );
      }

      // 4. Items & Inventory
      for (const item of b.items) {
        await q.exec(
          `INSERT INTO items (id, tenant_id, name, sku, barcode, hsn, unit, category, price_minor, cost_minor, tax_rate_bp, tax_inclusive, track_stock, custom, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true, true, ?::jsonb, true)
           ON CONFLICT (id) DO UPDATE SET 
              price_minor = EXCLUDED.price_minor,
              cost_minor = EXCLUDED.cost_minor,
              custom = EXCLUDED.custom,
              category = EXCLUDED.category`,
          [item.id, b.tenantId, item.name, item.sku || null, item.barcode || null, item.hsn || null, item.unit, item.category, item.price, item.cost, item.taxBp, j(item.custom || {})],
        );

        // Opening stock
        const hasStock = await q.one('SELECT 1 FROM stock_moves WHERE tenant_id = ? AND item_id = ?', [b.tenantId, item.id]);
        if (!hasStock) {
          await q.exec(
            `INSERT INTO stock_moves (id, tenant_id, item_id, location, qty_milli, kind, unit_cost_minor, batch_no, expiry, reason, user_id)
             VALUES (?, ?, ?, 'MAIN', ?, 'opening', ?, ?, ?, 'Initial Demo Stock', ?)`,
            [newId('sm'), b.tenantId, item.id, item.stock * 1000, item.cost, item.custom?.batch || null, item.custom?.expiry || null, userId],
          );
        }
      }

      // 5. Sample Invoice
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
            id, tenant_id, client_id, number, kind, status, bdate, party_id,
            customer_name, customer_phone, place_state, intra,
            subtotal_minor, taxable_minor, cgst_minor, sgst_minor, round_off_minor, total_minor,
            paid_minor, balance_minor, rule_version, calc, custom, share_token, created_by
          ) VALUES (?, ?, ?, ?, 'sale', 'posted', ?, ?, ?, ?, '33', true, ?, ?, ?, ?, ?, ?, ?, 0, '1.0', ?::jsonb, ?::jsonb, ?, ?)`,
          [
            invId,
            b.tenantId,
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
              id, tenant_id, invoice_id, pos, item_id, name, hsn, unit, batch_no,
              qty_milli, price_minor, discount_minor, tax_rate_bp, inclusive,
              taxable_minor, cgst_minor, sgst_minor, total_minor
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, true, ?, ?, ?, ?)`,
            [
              newId('inl'),
              b.tenantId,
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
          `INSERT INTO payments (id, tenant_id, kind, method, amount_minor, invoice_id, party_id, reference, bdate, created_by)
           VALUES (?, ?, 'receipt', 'upi', ?, ?, ?, 'UPI/2026/DEMO-PAY', ?, ?)`,
          [newId('pay'), b.tenantId, calculated.totalMinor, invId, b.sampleInvoice.partyId || null, todayStr, userId],
        );
      }
    });

    console.log(`✅ Business [${b.businessType.toUpperCase()}] Seeded Successfully:`);
    console.log(`   Store:    ${b.name}`);
    console.log(`   Owner:    ${b.ownerName} (${b.ownerEmail})`);
    console.log(`   Password: Password123!`);
    console.log(`   Items:    ${b.items.length} products`);
  }

  console.log('\n🎉 ALL 5 BUSINESSES ARE FULLY SEEDED AND READY!');
  await db.close();
}

seed().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
