import { fmtMoney, fmtQty, bpToPct, moneyInWords } from './money.ts';
import type { Lang, PrintTemplate } from './types.ts';

export interface PrintableLine {
  name: string;
  hsn?: string | null;
  unit?: string | null;
  qtyMilli: number;
  priceMinor: number;
  mrpMinor?: number | null;
  discountMinor: number;
  taxRateBp: number;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  totalMinor: number;
  serialNo?: string | null;
  batchNo?: string | null;
}
export interface PrintableBill {
  number: string;
  kind: 'sale' | 'credit_note';
  status?: string;
  dateText: string; // already formatted, e.g. 16 Oct 2026, 11:45
  shop: { name: string; address?: string | null; phone?: string | null; gstin?: string | null; stateName?: string | null; upiId?: string | null; logoUrl?: string | null };
  customer?: { name?: string | null; phone?: string | null; gstin?: string | null } | null;
  lines: PrintableLine[];
  totals: {
    subtotalMinor: number; discountMinor: number; taxableMinor: number; cgstMinor: number; sgstMinor: number; igstMinor: number;
    roundOffMinor: number; totalMinor: number; paidMinor: number; balanceMinor: number;
  };
  payments: { method: string; amountMinor: number }[];
  tender?: { cashReceivedMinor: number; changeReturnedMinor: number } | null;
  customFields: { label: string; value: string }[];
  note?: string | null;
  linkedNumber?: string | null;
  intra: boolean;
}

export const LABELS: Record<Lang, Record<string, string>> = {
  en: { invoice: 'Invoice', credit_note: 'Credit Note', billNo: 'Bill No', date: 'Date', customer: 'Customer', item: 'Item', qty: 'Qty', rate: 'Rate', disc: 'Disc', taxable: 'Taxable', gst: 'GST', amount: 'Amount', subtotal: 'Subtotal', discount: 'Discount', cgst: 'CGST', sgst: 'SGST', igst: 'IGST', roundOff: 'Round off', total: 'TOTAL', paid: 'Paid', balance: 'Balance due', thanks: 'Thank you! Visit again.', duplicate: 'DUPLICATE COPY', gstin: 'GSTIN', hsn: 'HSN', scanPay: 'Scan to pay', viewBill: 'View bill online', original: 'Original', copy2: 'Duplicate', copy3: 'Triplicate', cancelled: 'CANCELLED', against: 'Against bill', cash: 'Cash', upi: 'UPI', card: 'Card', bank: 'Bank', credit: 'On credit', payment: 'Payment', taxSummary: 'Tax summary', phone: 'Ph', cashReceived: 'Cash Tendered', changeReturn: 'Change Return' },
  ta: { invoice: 'பில்', credit_note: 'கிரெடிட் நோட்', billNo: 'பில் எண்', date: 'தேதி', customer: 'வாடிக்கையாளர்', item: 'பொருள்', qty: 'எண்', rate: 'விலை', disc: 'தள்ளுபடி', taxable: 'வரிக்குட்பட்ட தொகை', gst: 'ஜிஎஸ்டி', amount: 'தொகை', subtotal: 'துணை மொத்தம்', discount: 'தள்ளுபடி', cgst: 'சிஜிஎஸ்டி', sgst: 'எஸ்ஜிஎஸ்டி', igst: 'ஐஜிஎஸ்டி', roundOff: 'முழுமைப்படுத்தல்', total: 'மொத்தம்', paid: 'செலுத்தியது', balance: 'நிலுவை', thanks: 'நன்றி! மீண்டும் வருக.', duplicate: 'நகல்', gstin: 'ஜிஎஸ்டிஎன்', hsn: 'எச்எஸ்என்', scanPay: 'செலுத்த ஸ்கேன் செய்யவும்', viewBill: 'பில்லை ஆன்லைனில் பார்க்க', original: 'அசல்', copy2: 'நகல்', copy3: 'மூன்றாம் நகல்', cancelled: 'ரத்து செய்யப்பட்டது', against: 'பில் எண்', cash: 'ரொக்கம்', upi: 'யுபிஐ', card: 'கார்டு', bank: 'வங்கி', credit: 'கடன்', payment: 'கட்டணம்', taxSummary: 'வரி சுருக்கம்', phone: 'தொ.பே', cashReceived: 'ரொக்கம் பெறப்பட்டது', changeReturn: 'மீதி தொகை' },
  hi: { invoice: 'बिल', credit_note: 'क्रेडिट नोट', billNo: 'बिल नं.', date: 'दिनांक', customer: 'ग्राहक', item: 'सामान', qty: 'मात्रा', rate: 'दर', disc: 'छूट', taxable: 'कर योग्य', gst: 'जीएसटी', amount: 'राशि', subtotal: 'उप-योग', discount: 'छूट', cgst: 'सीजीएसटी', sgst: 'एसजीएसटी', igst: 'आईजीएसटी', roundOff: 'पूर्णांकन', total: 'कुल', paid: 'भुगतान', balance: 'बकाया', thanks: 'धन्यवाद! फिर पधारें।', duplicate: 'डुप्लिकेट कॉपी', gstin: 'जीएसटीआईएन', hsn: 'एचएसएन', scanPay: 'भुगतान के लिए स्कैन करें', viewBill: 'बिल ऑनलाइन देखें', original: 'मूल', copy2: 'डुप्लिकेट', copy3: 'ट्रिप्लिकेट', cancelled: 'रद्द', against: 'बिल नं.', cash: 'नकद', upi: 'यूपीआई', card: 'कार्ड', bank: 'बैंक', credit: 'उधार', payment: 'भुगतान', taxSummary: 'कर सारांश', phone: 'फ़ोन', cashReceived: 'नकद प्राप्त', changeReturn: 'वापसी शेष' },
};

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export interface RenderOpts {
  duplicate?: boolean;
  qrSvg?: string; // pre-rendered QR (upi or link) as inline SVG
  qrCaption?: string;
  autoPrint?: boolean;
}

const money = (m: number) => fmtMoney(m, { plain: true });

function taxBreakup(bill: PrintableBill) {
  const by = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>();
  for (const l of bill.lines) {
    const e = by.get(l.taxRateBp) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    e.taxable += l.taxableMinor; e.cgst += l.cgstMinor; e.sgst += l.sgstMinor; e.igst += l.igstMinor;
    by.set(l.taxRateBp, e);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]);
}

/** Shorten and condense product names into clean retail short-form */
export function shortProductName(name: string, maxLen = 70): string {
  if (!name) return '';
  let s = name
    // Compact spacing around units: 100 g -> 100g, 1 L -> 1L, 5 kg -> 5kg
    .replace(/(\d+)\s*(gram(?:s)?|gms?|gm|g)\b/gi, '$1g')
    .replace(/(\d+)\s*(kilo(?:gram(?:s)?)?|kgs?|kg)\b/gi, '$1kg')
    .replace(/(\d+)\s*(milli(?:litre|liter)(?:s)?|mls?|ml)\b/gi, '$1ml')
    .replace(/(\d+)\s*(litre(?:s)?|liter(?:s)?|ltrs?|lt|l)\b/gi, '$1L')
    .replace(/(\d+)\s*(piece(?:s)?|pcs?|pc)\b/gi, '$1pcs')
    // Standard retail abbreviations
    .replace(/\bRefined\b/gi, 'Ref')
    .replace(/\bSunflower\b/gi, 'Sun')
    .replace(/\bMustard\b/gi, 'Mst')
    .replace(/\bCoconut\b/gi, 'Coc')
    .replace(/\bGroundnut\b/gi, 'Gndnut')
    .replace(/\bVegetable\b/gi, 'Veg')
    .replace(/\bChocolate\b/gi, 'Choc')
    .replace(/\bBiscuits?\b/gi, 'Bisc')
    .replace(/\bPowder\b/gi, 'Pwdr')
    .replace(/\bPremium\b/gi, 'Prem')
    .replace(/\bStandard\b/gi, 'Std')
    .replace(/\bOriginal\b/gi, 'Orig')
    .replace(/\bPacket(?:s)?\b/gi, 'Pkt')
    .replace(/\bBottle(?:s)?\b/gi, 'Btl')
    .replace(/\bShampoo\b/gi, 'Shamp')
    .replace(/\bDetergent\b/gi, 'Det')
    .replace(/\bConditioner\b/gi, 'Cond')
    .replace(/\bToothpaste\b/gi, 'T.Paste')
    .replace(/\bToothbrush\b/gi, 'T.Brush')
    .replace(/\s+/g, ' ')
    .trim();

  if (s.length > maxLen) {
    s = s.slice(0, maxLen).trim();
  }
  return s;
}

/** Split product name intelligently into 2 lines so it never stays as a single line */
export function splitProductIntoTwoLines(name: string, maxPerLine = 18): { line1: string; line2: string } {
  const clean = shortProductName(name, 60);
  const words = clean.split(' ').filter(Boolean);
  if (words.length <= 1) {
    if (words[0] && words[0].length > maxPerLine) {
      return { line1: words[0].slice(0, maxPerLine), line2: words[0].slice(maxPerLine) };
    }
    return { line1: words[0] || '', line2: '' };
  }

  let line1 = '';
  let line2 = '';
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!line1) {
      line1 = word;
    } else if ((line1 + ' ' + word).length <= maxPerLine && line2 === '') {
      line1 += ' ' + word;
    } else {
      line2 += (line2 ? ' ' : '') + word;
    }
  }

  // If line2 is empty but line1 has multiple words, split evenly into 2 lines
  if (!line2 && words.length > 1) {
    const mid = Math.ceil(words.length / 2);
    line1 = words.slice(0, mid).join(' ');
    line2 = words.slice(mid).join(' ');
  }

  return { line1, line2 };
}

function thermalCopy(bill: PrintableBill, tpl: PrintTemplate, L: Record<string, string>, copyLabel: string, opts: RenderOpts): string {
  const isCn = bill.kind === 'credit_note';
  const title = isCn ? (L.credit_note || 'CREDIT NOTE') : (L.invoice || 'TAX INVOICE');
  const isCancelled = bill.status === 'cancelled';
  const t = bill.totals;

  // Extract special custom fields if present
  const loyaltyField = bill.customFields.find((f) => f.label.toLowerCase().includes('loyalty'));
  const counterField = bill.customFields.find((f) => f.label.toLowerCase().includes('counter'));
  const otherCustom = bill.customFields.filter((f) => f !== loyaltyField && f !== counterField && f.value);

  // Totals calculations
  const itemCount = bill.lines.length;
  const totalQty = bill.lines.reduce((acc, l) => acc + (l.qtyMilli / 1000), 0);

  // Calculate total savings including MRP savings
  let mrpSavingsMinor = 0;
  for (const l of bill.lines) {
    const lineMrp = (l.mrpMinor && l.mrpMinor > 0) ? l.mrpMinor : Math.max(l.priceMinor, Math.ceil((l.priceMinor * 1.15) / 100) * 100);
    if (lineMrp > l.priceMinor) {
      mrpSavingsMinor += Math.round(((lineMrp - l.priceMinor) * l.qtyMilli) / 1000);
    }
  }
  const totalSavingsMinor = t.discountMinor + mrpSavingsMinor;

  // Items table rows: NAME row + 4 columns (QTY, MRP, STORE PRICE, TOTAL PRICE)
  const itemRows = bill.lines
    .map((l, idx) => {
      const metaParts: string[] = [];
      if (tpl.showDiscount && l.discountMinor > 0) metaParts.push(`Disc: -₹${money(l.discountMinor)}`);
      if (l.serialNo) metaParts.push(`SN: ${esc(l.serialNo)}`);
      if (l.batchNo) metaParts.push(`B: ${esc(l.batchNo)}`);

      const lineMrp = (l.mrpMinor && l.mrpMinor > 0) ? l.mrpMinor : Math.max(l.priceMinor, Math.ceil((l.priceMinor * 1.15) / 100) * 100);
      const qtyStr = `${fmtQty(l.qtyMilli)}${tpl.showUnit && l.unit ? ' ' + esc(l.unit) : ''}`;
      const mrpStr = `₹${money(lineMrp)}`;
      const storePriceStr = `₹${money(l.priceMinor)}`;
      const totalPriceStr = `₹${money(l.totalMinor)}`;

      return `
        <tr class="th-item-title-tr">
          <td colspan="4" class="col-item-title">
            <span class="th-idx">${idx + 1}.</span> <b>${esc(l.name)}</b>
            ${metaParts.length ? `<span class="name-meta">(${metaParts.join(' · ')})</span>` : ''}
          </td>
        </tr>
        <tr class="th-item-cols-tr">
          <td class="col-qty">${qtyStr}</td>
          <td class="col-mrp">${mrpStr}</td>
          <td class="col-store">${storePriceStr}</td>
          <td class="col-total">${totalPriceStr}</td>
        </tr>
      `;
    })
    .join('');

  // Tax Breakdown rows (Saravana Stores style GST Slab Table)
  const br = taxBreakup(bill);
  const totalGstMinor = t.cgstMinor + t.sgstMinor + t.igstMinor;
  const gstBreakdownHtml = tpl.showTaxBreakup && br.length > 0 ? `
    <div class="th-gst-box">
      <div class="rw th-gst-header">
        <span>GST %</span>
        <span>GST Value</span>
      </div>
      ${br.map(([bp, e]) => `
        <div class="rw th-gst-row">
          <span>${bpToPct(bp)}%</span>
          <span>₹${money(e.cgst + e.sgst + e.igst)}</span>
        </div>
      `).join('')}
      <div class="rw th-gst-total">
        <span>Inclusive all GST</span>
        <b>₹${money(totalGstMinor)}</b>
      </div>
    </div>
  ` : '';

  // Payment Breakdown
  const paymentRows = bill.payments
    .filter((p) => p.amountMinor > 0)
    .map((p) => {
      const label = L[p.method] ?? p.method.toUpperCase();
      return `<div class="rw sm"><span>${esc(label)}</span><b>₹${money(p.amountMinor)}</b></div>`;
    })
    .join('');

  return `<section class="copy th-bill">
  ${isCancelled ? `<div class="stamp">${L.cancelled}</div>` : ''}

  <!-- SARAVANA STORE STYLE BRANDING HEADER -->
  <div class="th-brand">
    <div class="th-brand-row">
      <div class="th-logo-box">
        ${bill.shop.logoUrl ? `<img src="${esc(bill.shop.logoUrl)}" class="th-logo-img" alt="Logo" />` : `
          <svg class="th-logo-svg" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="2" width="48" height="48" rx="4" stroke="#000" stroke-width="2.2" fill="#fff"/>
            <path d="M26 8C21.5 13.5 15 18 15 25C15 30.5 19.5 35 26 35C20.5 31.5 19.5 26 23 21C24.5 18.5 26 13.5 26 8Z" fill="#000"/>
            <path d="M26 12C28.8 16.5 33.5 19.5 33.5 25C33.5 29.5 30.5 32.5 26 35C30 31.5 30.5 26 28.5 21.8C27.5 19 26 15.5 26 12Z" fill="#000"/>
            <path d="M26 17C24.8 20.2 23.5 23 24 26C24.5 28 26 29 26 30.5C26 29 27 27.5 26.8 25.5C26.5 23 26.2 20 26 17Z" fill="#fff"/>
            <rect x="5.5" y="37" width="41" height="9.5" rx="2" fill="#000"/>
            <text x="26" y="44" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif" font-size="6" font-weight="900" fill="#fff" text-anchor="middle" letter-spacing="0.4">SUPER STORE</text>
          </svg>
        `}
      </div>
      <div class="th-brand-details">
        <div class="shop-name">${esc(bill.shop.name)}</div>
        <div class="shop-tagline">${esc(tpl.header || 'Super Store of Shopping World')}</div>
        <div class="shop-branch">${esc(bill.shop.name)} ${counterField ? `(${esc(counterField.value)})` : ''}</div>
      </div>
    </div>
    ${bill.shop.address ? `<div class="c shop-addr">${esc(bill.shop.address)}</div>` : ''}
    <div class="c shop-contact">
      ${bill.shop.phone ? `<span>${L.phone}: ${esc(bill.shop.phone)}</span>` : ''}
      ${bill.shop.phone && bill.shop.gstin ? `<span class="dot-sep">•</span>` : ''}
      ${bill.shop.gstin ? `<span>${L.gstin}: <b>${esc(bill.shop.gstin)}</b></span>` : ''}
    </div>
  </div>

  <div class="th-divider"></div>

  <!-- TITLE BADGE -->
  <div class="th-title-wrap">
    <span class="th-title-badge">${title.toUpperCase()}</span>
    ${copyLabel ? `<span class="th-copy-label">(${esc(copyLabel)})</span>` : ''}
  </div>

  <!-- BILL METADATA (SARAVANA STORES COMPACT 2-COLUMN ARRANGEMENT) -->
  <div class="th-meta-grid">
    <div class="rw">
      <span>${L.billNo}: <b>#${esc(bill.number)}</b></span>
      <span>${esc(bill.dateText)}</span>
    </div>
    <div class="rw sm">
      <span>${counterField ? `POS: <b>${esc(counterField.value)}</b>` : 'POS Billing'}</span>
      <span>${bill.linkedNumber ? `${L.against}: #${esc(bill.linkedNumber)}` : 'Cashier Counter'}</span>
    </div>
    ${otherCustom.map((c) => `<div class="rw sm"><span>${esc(c.label)}:</span><span>${esc(c.value)}</span></div>`).join('')}
  </div>

  <!-- CUSTOMER CARD (IF PRESENT) -->
  ${(bill.customer?.name || bill.customer?.phone) ? `
    <div class="th-cust-card">
      <div class="rw">
        <span>${L.customer}: <b>${esc(bill.customer.name || 'Walk-in')}</b></span>
        ${bill.customer.phone ? `<span>Ph: <b>${esc(bill.customer.phone)}</b></span>` : ''}
      </div>
      ${bill.customer.gstin ? `<div class="rw sm"><span>${L.gstin}:</span><span>${esc(bill.customer.gstin)}</span></div>` : ''}
      ${loyaltyField ? `<div class="rw sm th-loyalty-row"><span>${esc(loyaltyField.label)}:</span><span><b>${esc(loyaltyField.value)}</b></span></div>` : ''}
    </div>
  ` : ''}

  <div class="th-divider"></div>

  <!-- ITEMS TABLE: 4 COLUMNS: QTY, MRP, STORE PRICE, TOTAL PRICE -->
  <table class="th-bill-table">
    <thead>
      <tr class="th-head-name-row">
        <th colspan="4" class="col-head-name">NAME / ITEM</th>
      </tr>
      <tr class="th-head-cols-row">
        <th class="col-qty">QTY</th>
        <th class="col-mrp">MRP</th>
        <th class="col-store">STORE PRICE</th>
        <th class="col-total">TOTAL PRICE</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <!-- ITEM COUNT & QTY SUMMARY -->
  <div class="th-divider-sub"></div>
  <div class="rw th-item-summary">
    <span>Total Quantity: <b>${totalQty % 1 === 0 ? totalQty.toFixed(2) : totalQty.toFixed(3)}</b></span>
    <span>Total Items: <b>${itemCount}</b></span>
  </div>
  <div class="th-divider"></div>

  <!-- FINANCIAL TOTALS & TAX -->
  <div class="th-totals-box">
    ${t.discountMinor > 0 ? `
      <div class="rw"><span>${L.subtotal}</span><span>₹${money(t.subtotalMinor)}</span></div>
      <div class="rw th-savings-line"><span>${L.discount}</span><span>-₹${money(t.discountMinor)}</span></div>
    ` : ''}
    ${gstBreakdownHtml}
    ${t.roundOffMinor !== 0 ? `
      <div class="rw sm"><span>${L.roundOff}</span><span>${t.roundOffMinor > 0 ? '+' : '-'}₹${money(Math.abs(t.roundOffMinor))}</span></div>
    ` : ''}

    <!-- NET VALUE (SARAVANA STORES STYLE) -->
    <div class="th-net-value-wrap">
      <span class="th-eoe">E.&O.E.</span>
      <div class="th-net-value">
        <span class="th-net-label">Net Value</span>
        <span class="th-net-amount">₹${money(t.totalMinor)}</span>
      </div>
    </div>

    ${totalSavingsMinor > 0 ? `
      <div class="th-savings-callout">
        🎉 YOU SAVED ₹${money(totalSavingsMinor)} ON THIS BILL!
      </div>
    ` : ''}
  </div>

  <!-- PAYMENTS & TENDER CASH SECTION -->
  <div class="th-payment-section">
    <div class="rw th-tender-head">
      <span>TenderType</span>
      <span>Amount</span>
    </div>
    ${paymentRows}
    ${bill.tender && bill.tender.cashReceivedMinor > 0 ? `
      <div class="th-tender-details">
        <div class="rw"><span>${L.cashReceived}:</span><b>₹${money(bill.tender.cashReceivedMinor)}</b></div>
        <div class="rw b th-change-row"><span>${L.changeReturn}:</span><span>₹${money(bill.tender.changeReturnedMinor)}</span></div>
      </div>
    ` : ''}
    ${t.balanceMinor > 0 ? `
      <div class="th-due-banner">
        <div class="rw b">
          <span>⚠️ ${L.balance.toUpperCase()}:</span>
          <span>₹${money(t.balanceMinor)}</span>
        </div>
      </div>
    ` : `
      <div class="th-settled-badge">✓ PAYMENT SETTLED IN FULL</div>
    `}
  </div>

  <!-- QR CODE -->
  ${opts.qrSvg ? `
    <div class="th-qr-wrap">
      <div class="qr">${opts.qrSvg}</div>
      <div class="th-qr-caption">${esc(opts.qrCaption || 'Scan UPI to pay')}</div>
    </div>
  ` : ''}

  <div class="th-divider-double"></div>

  <!-- FOOTER -->
  <div class="th-footer">
    <div class="c xs foot-important">Important : Kindly keep a photo/photo copy of the Bill for future Use</div>
    <div class="c b foot-thanks">${esc(tpl.footer || L.thanks)}</div>
    ${bill.shop.phone ? `<div class="c xs foot-phone">Toll Free / Helpdesk: ${esc(bill.shop.phone)}</div>` : ''}
    <div class="c xs foot-system">*** Computer Generated GST Invoice ***</div>
    ${opts.duplicate ? `<div class="c b dup">${L.duplicate}</div>` : ''}
  </div>
</section>`;
}

function a4Copy(bill: PrintableBill, tpl: PrintTemplate, L: Record<string, string>, copyLabel: string, opts: RenderOpts): string {
  const title = bill.kind === 'credit_note' ? L.credit_note : L.invoice;
  const t = bill.totals;
  const showTaxCols = tpl.showTaxBreakup;
  const head = `<tr><th>#</th><th class="l">Item Description</th><th>Qty</th><th>MRP</th><th>Price</th>${tpl.showDiscount ? '<th>Disc</th>' : ''}<th>Taxable</th>${showTaxCols ? '<th>GST</th>' : ''}<th>Total</th></tr>`;
  const body = bill.lines
    .map(
      (l, i) => {
        const lineMrp = (l.mrpMinor && l.mrpMinor > 0) ? l.mrpMinor : Math.max(l.priceMinor, Math.ceil((l.priceMinor * 1.15) / 100) * 100);
        return `<tr><td>${i + 1}</td><td class="l">${esc(shortProductName(l.name, 45))}${l.serialNo ? `<div class="xs">SN ${esc(l.serialNo)}</div>` : ''}${l.batchNo ? `<div class="xs">Batch ${esc(l.batchNo)}</div>` : ''}</td><td>${fmtQty(l.qtyMilli)}${tpl.showUnit && l.unit ? ' ' + esc(l.unit) : ''}</td><td>₹${money(lineMrp)}</td><td>₹${money(l.priceMinor)}</td>${tpl.showDiscount ? `<td>${l.discountMinor ? '₹' + money(l.discountMinor) : ''}</td>` : ''}<td>₹${money(l.taxableMinor)}</td>${showTaxCols ? `<td>${bpToPct(l.taxRateBp)}%</td>` : ''}<td><b>₹${money(l.totalMinor)}</b></td></tr>`;
      }
    )
    .join('');
  const br = taxBreakup(bill);
  const brRows = br
    .map(([bp, e]) => `<tr><td>${bpToPct(bp)}%</td><td>₹${money(e.taxable)}</td>${bill.intra ? `<td>₹${money(e.cgst)}</td><td>₹${money(e.sgst)}</td>` : `<td>₹${money(e.igst)}</td>`}</tr>`)
    .join('');
  const custom = bill.customFields.filter((f) => f.value).map((f) => `<div><span class="mu">${esc(f.label)}:</span> ${esc(f.value)}</div>`).join('');
  const pays = bill.payments.filter((p) => p.amountMinor > 0).map((p) => `<div class="rw"><span>${esc(L[p.method] ?? p.method)}</span><span>₹${money(p.amountMinor)}</span></div>`).join('');
  return `<section class="copy a4">
  ${bill.status === 'cancelled' ? `<div class="stamp">${L.cancelled}</div>` : ''}
  <div class="top">
    <div class="top-brand">
      <div class="th-logo-box" style="width:52px;height:52px;margin-right:14px;border:1.5px solid #000;border-radius:4px;display:flex;align-items:center;justify-content:center;">
        ${bill.shop.logoUrl ? `<img src="${esc(bill.shop.logoUrl)}" class="th-logo-img" alt="Logo" style="width:100%;height:100%;object-fit:contain;" />` : `
          <svg class="th-logo-svg" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;">
            <rect x="2" y="2" width="48" height="48" rx="4" stroke="#000" stroke-width="2.2" fill="#fff"/>
            <path d="M26 8C21.5 13.5 15 18 15 25C15 30.5 19.5 35 26 35C20.5 31.5 19.5 26 23 21C24.5 18.5 26 13.5 26 8Z" fill="#000"/>
            <path d="M26 12C28.8 16.5 33.5 19.5 33.5 25C33.5 29.5 30.5 32.5 26 35C30 31.5 30.5 26 28.5 21.8C27.5 19 26 15.5 26 12Z" fill="#000"/>
            <path d="M26 17C24.8 20.2 23.5 23 24 26C24.5 28 26 29 26 30.5C26 29 27 27.5 26.8 25.5C26.5 23 26.2 20 26 17Z" fill="#fff"/>
            <rect x="5.5" y="37" width="41" height="9.5" rx="2" fill="#000"/>
            <text x="26" y="44" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif" font-size="6" font-weight="900" fill="#fff" text-anchor="middle" letter-spacing="0.4">SUPER STORE</text>
          </svg>
        `}
      </div>
      <div>
        <div class="shop">${esc(bill.shop.name)}</div>
        <div class="sm">${esc(bill.shop.address ?? '')}</div>
        <div class="sm">${bill.shop.phone ? `${L.phone}: ${esc(bill.shop.phone)}` : ''}${bill.shop.gstin ? ` · ${L.gstin}: ${esc(bill.shop.gstin)}` : ''}${bill.shop.stateName ? ` · ${esc(bill.shop.stateName)}` : ''}</div>
        ${tpl.header ? `<div class="sm">${esc(tpl.header)}</div>` : ''}
      </div>
    </div>
    <div class="meta"><div class="ttl">${title}</div><div class="sm">${esc(copyLabel)}</div>
    <div><span class="mu">${L.billNo}:</span> <b>${esc(bill.number)}</b></div><div><span class="mu">${L.date}:</span> ${esc(bill.dateText)}</div>
    ${bill.linkedNumber ? `<div><span class="mu">${L.against}:</span> ${esc(bill.linkedNumber)}</div>` : ''}${custom}</div>
  </div>
  <div class="party"><div class="mu">${L.customer}</div><div><b>${esc(bill.customer?.name || '—')}</b></div>
  <div class="sm">${bill.customer?.phone ? `${L.phone}: ${esc(bill.customer.phone)}` : ''}${bill.customer?.gstin ? ` · ${L.gstin}: ${esc(bill.customer.gstin)}` : ''}</div></div>
  <table class="items"><thead>${head}</thead><tbody>${body}</tbody></table>
  <div class="bottom">
    <div class="left">
      ${tpl.showTaxBreakup && br.length ? `<table class="tx"><thead><tr><th>${L.gst}</th><th>${L.taxable}</th>${bill.intra ? `<th>${L.cgst}</th><th>${L.sgst}</th>` : `<th>${L.igst}</th>`}</tr></thead><tbody>${brRows}</tbody></table>` : ''}
      ${opts.qrSvg ? `<div class="qr">${opts.qrSvg}<div class="sm">${esc(opts.qrCaption ?? '')}</div></div>` : ''}
    </div>
    <div class="right">
      <div class="rw"><span>${L.subtotal}</span><span>₹${money(t.subtotalMinor)}</span></div>
      ${t.discountMinor > 0 ? `<div class="rw"><span>${L.discount}</span><span>-₹${money(t.discountMinor)}</span></div>` : ''}
      <div class="rw"><span>${L.taxable}</span><span>₹${money(t.taxableMinor)}</span></div>
      ${bill.intra ? `<div class="rw"><span>${L.cgst}</span><span>₹${money(t.cgstMinor)}</span></div><div class="rw"><span>${L.sgst}</span><span>₹${money(t.sgstMinor)}</span></div>` : `<div class="rw"><span>${L.igst}</span><span>₹${money(t.igstMinor)}</span></div>`}
      ${t.roundOffMinor !== 0 ? `<div class="rw"><span>${L.roundOff}</span><span>${t.roundOffMinor > 0 ? '+' : '-'}${money(Math.abs(t.roundOffMinor))}</span></div>` : ''}
      <div class="rw tot"><span>${L.total}</span><span>₹${money(t.totalMinor)}</span></div>
      ${pays}
      ${bill.tender && bill.tender.cashReceivedMinor > 0 ? `
        <div class="rw"><span>${L.cashReceived}:</span><span>₹${money(bill.tender.cashReceivedMinor)}</span></div>
        <div class="rw b"><span>${L.changeReturn}:</span><span>₹${money(bill.tender.changeReturnedMinor)}</span></div>
      ` : ''}
      ${t.balanceMinor > 0 ? `<div class="rw b"><span>${L.balance}</span><span>₹${money(t.balanceMinor)}</span></div>` : ''}
    </div>
  </div>
  ${tpl.terms ? `<div class="terms">${esc(tpl.terms)}</div>` : ''}
  <div class="foot">${esc(tpl.footer || L.thanks)}</div>
  ${opts.duplicate ? `<div class="c b dup">${L.duplicate}</div>` : ''}
</section>`;
}

const CSS = (paper: PrintTemplate['paper']) => {
  const thermal = paper === 'thermal58' || paper === 'thermal80';
  const w = paper === 'thermal58' ? '58mm' : '80mm';
  const page = thermal ? `@page{size:${w} auto;margin:0}` : paper === 'a5' ? '@page{size:A5;margin:8mm}' : '@page{size:A4;margin:12mm}';
  const base = `*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#000;background:#fff}`;

  if (thermal) {
    const fs = paper === 'thermal58' ? 10 : 11;
    return `${page}${base}
@media screen {
  body { background:#cbd5e1; padding:24px 12px; display:flex; flex-direction:column; align-items:center; min-height:100vh }
  .copy { width:${w === '58mm' ? '58mm' : '80mm'}!important; background:#ffffff; box-shadow:0 10px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.1); padding:16px 14px!important; border-radius:6px; margin:0 auto 24px auto!important; border:1px solid #94a3b8 }
}
@media print {
  body { background:#fff; padding:0 }
  .copy { width:${w === '58mm' ? '54mm' : '76mm'}!important; box-shadow:none!important; border-radius:0!important; padding:2mm 0!important; margin:0 auto!important; border:none!important }
}
.copy{margin:0 auto;font-size:${fs}px;line-height:1.35;page-break-after:always;position:relative;font-variant-numeric:tabular-nums}.copy:last-child{page-break-after:auto}
.c{text-align:center}.sm{font-size:${fs - 1}px}.xs{font-size:${fs - 2}px;color:#333}.b{font-weight:700}
.rw{display:flex;justify-content:space-between;gap:6px;align-items:baseline}.rw>span:last-child,.rw>b:last-child{text-align:right;white-space:nowrap}

/* Thermal Bill Components */
.th-brand{text-align:center;margin-bottom:4px}
.th-brand-row{display:flex;align-items:center;justify-content:flex-start;gap:8px;margin-bottom:3px}
.th-logo-box{width:46px;height:46px;flex-shrink:0;display:flex;align-items:center;justify-content:center}
.th-logo-svg{width:100%;height:100%;display:block}
.th-logo-img{width:100%;height:100%;object-fit:contain}
.th-brand-details{flex:1;text-align:left;min-width:0}
.shop-name{font-size:${fs + 2.5}px;font-weight:900;letter-spacing:0.3px;text-transform:uppercase;color:#000;line-height:1.15;margin-bottom:1px}
.shop-tagline{font-size:${fs - 2}px;font-weight:700;color:#333;letter-spacing:0.2px;text-transform:capitalize}
.shop-branch{font-size:${fs - 2.2}px;font-weight:700;color:#444;text-transform:uppercase}
.shop-addr{font-size:${fs - 1.2}px;color:#222;line-height:1.2;margin-top:2px}
.shop-contact{font-size:${fs - 1.2}px;color:#333;margin-top:1px}
.dot-sep{margin:0 4px;color:#666}

.th-divider{border-top:1px dashed #000;margin:5px 0}
.th-divider-sub{border-top:1px dashed #666;margin:3px 0}
.th-divider-double{border-top:2px dashed #000;margin:6px 0}

.th-title-wrap{text-align:center;margin:3px 0}
.th-title-badge{display:inline-block;border:1.5px solid #000;padding:1px 10px;font-size:${fs - 0.5}px;font-weight:800;letter-spacing:1px;border-radius:2px}
.th-copy-label{font-size:${fs - 1.5}px;margin-left:4px;color:#555}

.th-meta-grid{font-size:${fs - 0.5}px;line-height:1.35;margin:3px 0}
.th-cust-card{background:#f8fafc;border:1px dashed #64748b;border-radius:4px;padding:4px 6px;margin:4px 0;font-size:${fs - 0.5}px}
.th-loyalty-row{color:#000;margin-top:2px}

/* Product Table: NAME, QTY, MRP, STORE PRICE, TOTAL PRICE */
.th-bill-table{width:100%;border-collapse:collapse;margin:4px 0;table-layout:fixed;font-variant-numeric:tabular-nums}
.th-head-name-row th{text-align:left;font-size:${fs - 1.2}px;font-weight:800;color:#334155;border-bottom:1px dotted #94a3b8;padding:2px 0;letter-spacing:0.4px}
.th-head-cols-row th{border-bottom:1.5px dashed #000;padding:3px 0;font-size:${fs - 1}px;font-weight:800;letter-spacing:0.3px;color:#000}
.th-bill-table th.col-qty{text-align:left;width:20%}
.th-bill-table th.col-mrp{text-align:right;width:25%}
.th-bill-table th.col-store{text-align:right;width:27%}
.th-bill-table th.col-total{text-align:right;width:28%}

.th-item-title-tr td{padding:5px 0 1px 0;font-size:${fs + 0.1}px;font-weight:700;color:#000;line-height:1.25;word-break:break-word}
.th-idx{font-weight:800;margin-right:2px;color:#000}
.name-meta{font-size:${fs - 2.2}px;color:#555;font-weight:normal;margin-left:4px}

.th-item-cols-tr td{padding:0 0 5px 0;border-bottom:1px dashed #cbd5e1;font-size:${fs}px}
.th-bill-table tbody tr.th-item-cols-tr:last-child td{border-bottom:none}

.th-bill-table td.col-qty{text-align:left;color:#1e293b;font-weight:600}
.th-bill-table td.col-mrp{text-align:right;color:#64748b}
.th-bill-table td.col-store{text-align:right;color:#0f172a;font-weight:700}
.th-bill-table td.col-total{text-align:right;font-weight:800;color:#000}

.th-item-summary{font-size:${fs - 0.8}px;color:#111;margin:3px 0}

/* GST Breakdown */
.th-gst-box{margin:4px 0;border-top:1px dashed #888;border-bottom:1px dashed #888;padding:3px 0;font-size:${fs - 1}px}
.th-gst-header{font-weight:800;margin-bottom:2px}
.th-gst-row{font-size:${fs - 1.2}px;color:#222}
.th-gst-total{font-weight:800;border-top:1px dashed #ccc;padding-top:2px;margin-top:2px}

/* Totals */
.th-totals-box{margin-top:4px;font-size:${fs}px}
.th-savings-line{color:#15803d;font-weight:600}
.th-net-value-wrap{display:flex;justify-content:space-between;align-items:center;border-top:2px dashed #000;border-bottom:2px solid #000;padding:4px 0;margin:5px 0}
.th-eoe{font-size:${fs - 1.5}px;font-weight:800;letter-spacing:0.5px}
.th-net-value{display:flex;align-items:baseline;gap:6px}
.th-net-label{font-size:${fs + 1.5}px;font-weight:800;letter-spacing:0.5px}
.th-net-amount{font-size:${fs + 4}px;font-weight:900;letter-spacing:0.5px}
.th-savings-callout{text-align:center;font-size:${fs - 1}px;font-weight:800;color:#15803d;border:1px dashed #16a34a;background:#f0fdf4;padding:3px 6px;border-radius:4px;margin:4px 0}

/* Tender & Payment */
.th-payment-section{margin-top:4px;font-size:${fs}px}
.th-tender-head{font-weight:800;font-size:${fs - 1}px;border-bottom:1px dashed #aaa;padding-bottom:1px;margin-bottom:2px}
.th-tender-details{background:#f8fafc;border:1px solid #cbd5e1;border-radius:4px;padding:3px 6px;margin:4px 0;font-size:${fs - 0.5}px}
.th-change-row{color:#047857;border-top:1px dashed #a7f3d0;padding-top:2px;margin-top:2px;font-size:${fs + 0.5}px}
.th-due-banner{background:#fef2f2;border:1.5px solid #dc2626;border-radius:4px;padding:3px 6px;margin:4px 0;color:#b91c1c;font-size:${fs + 0.5}px}
.th-settled-badge{text-align:center;font-size:${fs - 1.5}px;font-weight:700;color:#166534;margin:4px 0 14px 0;letter-spacing:0.5px}

.th-qr-wrap{text-align:center;margin:6px 0}
.th-qr-wrap .qr svg{width:30mm;height:30mm}
.th-qr-caption{font-size:${fs - 1.5}px;font-weight:700;color:#111;margin-top:2px}

.th-footer{margin-top:4px}
.foot-important{font-size:${fs - 2.2}px;color:#333;margin-bottom:2px}
.foot-thanks{font-size:${fs}px;margin-bottom:2px}
.foot-phone{font-size:${fs - 2}px;color:#444;margin-bottom:2px}
.foot-system{font-size:${fs - 2.5}px;color:#666}

.dup{margin-top:4px;border:1px solid #000;padding:2px}
.stamp{position:absolute;top:25%;left:10%;transform:rotate(-20deg);font-size:24px;font-weight:900;color:#dc2626;opacity:.4;border:3px solid #dc2626;padding:4px 12px}`;
  }

  return `${page}${base}
@media screen {
  body { background:#f1f5f9; padding:24px 12px; display:flex; flex-direction:column; align-items:center; min-height:100vh }
  .copy.a4 { width:100%!important; max-width:210mm!important; min-height:297mm; background:#ffffff; box-shadow:0 8px 30px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06); padding:16mm 18mm!important; border-radius:4px; margin:0 auto 24px auto!important }
}
@media print {
  body { background:#fff; padding:0 }
  .copy.a4 { width:100%!important; max-width:none!important; min-height:auto!important; box-shadow:none!important; border-radius:0!important; padding:0!important; margin:0!important }
}
.copy{font-size:12px;line-height:1.4;page-break-after:always;position:relative}.copy:last-child{page-break-after:auto}
.top{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:10px}
.top-brand{display:flex;align-items:center;text-align:left}
.shop{font-size:20px;font-weight:700}.sm{font-size:11px;color:#333}.xs{font-size:10px;color:#555}.mu{color:#666}.b{font-weight:700}
.meta{text-align:right}.ttl{font-size:20px;font-weight:700;letter-spacing:.5px;text-transform:uppercase}.party{margin:8px 0 12px;padding:8px 10px;background:#f4f4f4;border-radius:4px}
table{border-collapse:collapse;width:100%}table.items th{background:#111;color:#fff;font-weight:600;padding:6px 6px;font-size:11px;text-align:right}table.items td{padding:6px;border-bottom:1px solid #ddd;text-align:right;vertical-align:top}.l{text-align:left!important}
.bottom{display:flex;justify-content:space-between;gap:24px;margin-top:14px;align-items:flex-start}.left{flex:1}.right{width:260px}.rw{display:flex;justify-content:space-between;padding:2px 0}
.tot{font-weight:700;font-size:16px;border-top:2px solid #111;border-bottom:2px solid #111;margin:6px 0;padding:5px 0}table.tx{font-size:11px;margin-bottom:10px;width:auto}table.tx th,table.tx td{border:1px solid #ccc;padding:3px 8px;text-align:right}table.tx th{background:#f0f0f0}
.qr svg{width:110px;height:110px}.terms{margin-top:16px;font-size:10.5px;color:#444;border-top:1px solid #ddd;padding-top:6px}.foot{margin-top:10px;text-align:center;color:#333}.dup{text-align:center;margin-top:8px;border:1px solid #111;padding:2px}
.stamp{position:absolute;top:40%;left:25%;transform:rotate(-20deg);font-size:64px;font-weight:800;color:#c0392b;opacity:.25;border:6px solid #c0392b;padding:6px 24px}`;
};

/** Full HTML document for one bill (all requested copies). Used for printing, the public bill page and PDF-by-browser. */
export function renderBillDoc(bill: PrintableBill, tpl: PrintTemplate, opts: RenderOpts = {}): string {
  const L = LABELS[tpl.language] ?? LABELS.en;
  const thermal = tpl.paper === 'thermal58' || tpl.paper === 'thermal80';
  const labels = ['', L.copy2, L.copy3];
  const copies = Array.from({ length: tpl.copies }, (_, i) => (i === 0 ? (tpl.copies > 1 ? L.original : '') : labels[i]));
  const sections = copies.map((c) => (thermal ? thermalCopy(bill, tpl, L, c, opts) : a4Copy(bill, tpl, L, c, opts))).join('\n');
  return `<!doctype html><html lang="${tpl.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(bill.number)}</title><style>${CSS(tpl.paper)}</style></head><body>${sections}${opts.autoPrint ? '<script>window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print()},250)})</script>' : ''}</body></html>`;
}

export interface PrintableReceiptAllocation {
  invoiceNumber: string;
  invoiceDate?: string;
  amountMinor: number;
}

export interface PrintablePaymentReceipt {
  receiptNumber: string;
  dateText: string;
  shop: { name: string; address?: string | null; phone?: string | null; gstin?: string | null; upiId?: string | null };
  customer: { name: string; phone?: string | null; gstin?: string | null };
  amountMinor: number;
  mode: string;
  reference?: string | null;
  note?: string | null;
  receivedBy?: string | null;
  allocations: PrintableReceiptAllocation[];
  advanceMinor?: number;
  balanceMinor: number;
  customerAdvanceMinor?: number;
  status: 'posted' | 'reversed';
  reversalReason?: string | null;
}

function thermalPaymentReceipt(rcpt: PrintablePaymentReceipt, tpl: PrintTemplate, _opts: RenderOpts): string {
  const isReversed = rcpt.status === 'reversed';
  const allocRows = rcpt.allocations.map(a => `<div class="rw"><span>${esc(a.invoiceNumber)}${a.invoiceDate ? ` (${esc(a.invoiceDate)})` : ''}</span><span>₹${money(a.amountMinor)}</span></div>`).join('');
  const advRow = rcpt.advanceMinor && rcpt.advanceMinor > 0 ? `<div class="rw" style="color:#0284c7"><span>Advance on Account</span><span>₹${money(rcpt.advanceMinor)}</span></div>` : '';
  const refRow = rcpt.reference ? `<div class="rw"><span>Ref / UTR</span><span>${esc(rcpt.reference)}</span></div>` : '';
  const noteRow = rcpt.note ? `<div class="rw sm"><span>Note</span><span>${esc(rcpt.note)}</span></div>` : '';
  const byRow = rcpt.receivedBy ? `<div class="rw sm"><span>Received by</span><span>${esc(rcpt.receivedBy)}</span></div>` : '';
  const revRow = isReversed && rcpt.reversalReason ? `<div class="rw sm" style="color:#ef4444"><span>Reversal Reason</span><span>${esc(rcpt.reversalReason)}</span></div>` : '';

  return `<section class="copy">
  ${isReversed ? `<div class="stamp">REVERSED</div>` : ''}
  <div class="shop">${esc(rcpt.shop.name)}</div>
  <div class="c sm">${esc(rcpt.shop.address ?? '')}</div>
  <div class="c sm">${rcpt.shop.phone ? `Ph: ${esc(rcpt.shop.phone)}` : ''}${rcpt.shop.gstin ? ` · GSTIN: ${esc(rcpt.shop.gstin)}` : ''}</div>
  <hr/>
  <div class="c b">${isReversed ? 'PAYMENT RECEIPT (REVERSED)' : 'PAYMENT RECEIPT'}</div>
  <div class="rw"><span>Receipt No</span><b>${esc(rcpt.receiptNumber)}</b></div>
  <div class="rw"><span>Date</span><span>${esc(rcpt.dateText)}</span></div>
  <div class="rw"><span>Customer</span><b>${esc(rcpt.customer.name)}</b></div>
  ${rcpt.customer.phone ? `<div class="rw"><span>Phone</span><span>${esc(rcpt.customer.phone)}</span></div>` : ''}
  ${byRow}
  <hr/>
  <div class="rw"><span>Payment Mode</span><b>${esc(rcpt.mode.toUpperCase())}</b></div>
  ${refRow}
  ${noteRow}
  <div class="rw tot"><span>AMOUNT RECEIVED</span><span>₹${money(rcpt.amountMinor)}</span></div>
  <hr/>
  <div class="b sm" style="margin-bottom:4px">Settled Invoices:</div>
  ${allocRows || '<div class="c sm" style="color:#64748b">No invoices settled (Advance)</div>'}
  ${advRow}
  <hr/>
  <div class="rw b"><span>Remaining Balance</span><span>₹${money(rcpt.balanceMinor)}</span></div>
  ${rcpt.customerAdvanceMinor && rcpt.customerAdvanceMinor > 0 ? `<div class="rw sm" style="color:#0284c7"><span>Advance Available</span><span>₹${money(rcpt.customerAdvanceMinor)}</span></div>` : ''}
  ${revRow}
  <hr/>
  <div class="c sm">Thank you for your payment!</div>
</section>`;
}

function a4PaymentReceipt(rcpt: PrintablePaymentReceipt, _tpl: PrintTemplate, opts: RenderOpts): string {
  const isReversed = rcpt.status === 'reversed';
  const allocRows = rcpt.allocations.map((a, i) => `<tr><td>${i + 1}</td><td class="l"><b>${esc(a.invoiceNumber)}</b></td><td>${esc(a.invoiceDate ?? '—')}</td><td>₹${money(a.amountMinor)}</td></tr>`).join('');
  const advRow = rcpt.advanceMinor && rcpt.advanceMinor > 0 ? `<tr style="background:#f0f9ff;font-weight:600"><td colspan="3" class="l" style="color:#0369a1">Advance on Account (held for future bills)</td><td style="color:#0369a1">₹${money(rcpt.advanceMinor)}</td></tr>` : '';
  const words = moneyInWords(rcpt.amountMinor);

  return `<section class="copy a4">
  ${isReversed ? `<div class="stamp">REVERSED</div>` : ''}
  <div class="top">
    <div>
      <div class="shop">${esc(rcpt.shop.name)}</div>
      <div class="sm">${esc(rcpt.shop.address ?? '')}</div>
      <div class="sm">${rcpt.shop.phone ? `Ph: ${esc(rcpt.shop.phone)}` : ''}${rcpt.shop.gstin ? ` · GSTIN: ${esc(rcpt.shop.gstin)}` : ''}</div>
    </div>
    <div class="meta">
      <div class="ttl" style="color:${isReversed ? '#ef4444' : '#16a34a'}">${isReversed ? 'PAYMENT RECEIPT (REVERSED)' : 'PAYMENT RECEIPT'}</div>
      <div><span class="mu">Receipt No:</span> <b>${esc(rcpt.receiptNumber)}</b></div>
      <div><span class="mu">Date:</span> ${esc(rcpt.dateText)}</div>
      ${rcpt.receivedBy ? `<div><span class="mu">Received by:</span> ${esc(rcpt.receivedBy)}</div>` : ''}
      ${isReversed && rcpt.reversalReason ? `<div style="color:#ef4444;font-weight:600;margin-top:4px">Reason: ${esc(rcpt.reversalReason)}</div>` : ''}
    </div>
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:12px 0 16px 0">
    <div class="party" style="margin:0">
      <div class="mu">Received From (Customer):</div>
      <div style="font-size:15px"><b>${esc(rcpt.customer.name)}</b></div>
      <div class="sm">${rcpt.customer.phone ? `Phone: ${esc(rcpt.customer.phone)}` : ''}${rcpt.customer.gstin ? ` · GSTIN: ${esc(rcpt.customer.gstin)}` : ''}</div>
    </div>
    <div class="party" style="margin:0;background:#f8fafc;border:1px solid #e2e8f0">
      <div class="mu">Payment Method & Reference:</div>
      <div style="font-size:15px"><b>${esc(rcpt.mode.toUpperCase())}</b>${rcpt.reference ? ` · Ref: <span class="mono">${esc(rcpt.reference)}</span>` : ''}</div>
      ${rcpt.note ? `<div class="sm" style="color:#475569">Note: ${esc(rcpt.note)}</div>` : ''}
    </div>
  </div>

  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:12px 16px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
    <div>
      <div style="font-size:11px;color:#166534;font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Amount Received</div>
      <div style="font-size:13px;color:#15803d;margin-top:2px;font-style:italic">${esc(words)}</div>
    </div>
    <div style="font-size:24px;font-weight:800;color:#166534">₹${money(rcpt.amountMinor)}</div>
  </div>

  <div style="font-weight:700;font-size:13px;margin-bottom:6px">Settled Invoices & Account Allocation:</div>
  <table class="items">
    <thead>
      <tr>
        <th style="width:40px">#</th>
        <th class="l">Invoice Number</th>
        <th>Invoice Date</th>
        <th>Amount Settled</th>
      </tr>
    </thead>
    <tbody>
      ${allocRows || '<tr><td colspan="4" class="c" style="padding:14px;color:#64748b">No specific invoices settled. Amount credited to customer advance balance.</td></tr>'}
      ${advRow}
    </tbody>
  </table>

  <div class="bottom" style="margin-top:16px">
    <div class="left">
      ${opts.qrSvg && rcpt.balanceMinor > 0 ? `<div class="qr">${opts.qrSvg}<div class="sm">${esc(opts.qrCaption || 'Scan UPI to pay balance')}</div></div>` : ''}
    </div>
    <div class="right" style="width:280px">
      <div class="rw" style="font-size:13px"><span>Total Received:</span><b>₹${money(rcpt.amountMinor)}</b></div>
      <div class="rw tot" style="color:#0f172a"><span>Remaining Balance:</span><span>₹${money(rcpt.balanceMinor)}</span></div>
      ${rcpt.customerAdvanceMinor && rcpt.customerAdvanceMinor > 0 ? `<div class="rw" style="color:#0284c7;font-weight:600"><span>Advance Available:</span><span>₹${money(rcpt.customerAdvanceMinor)}</span></div>` : ''}
    </div>
  </div>

  <div class="foot" style="margin-top:30px;border-top:1px dashed #cbd5e1;padding-top:10px">
    Thank you for your payment! This is an official computer-generated receipt.
  </div>
</section>`;
}

export function renderPaymentReceiptDoc(rcpt: PrintablePaymentReceipt, tpl: PrintTemplate, opts: RenderOpts = {}): string {
  const thermal = tpl.paper === 'thermal58' || tpl.paper === 'thermal80';
  const html = thermal ? thermalPaymentReceipt(rcpt, tpl, opts) : a4PaymentReceipt(rcpt, tpl, opts);
  return `<!doctype html><html lang="${tpl.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Receipt ${esc(rcpt.receiptNumber)}</title><style>${CSS(tpl.paper)}</style></head><body>${html}${opts.autoPrint ? '<script>window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print()},250)})</script>' : ''}</body></html>`;
}

export interface PrintableLedgerRow {
  dateText: string;
  kind: 'invoice' | 'payment';
  refNumber: string;
  description: string;
  debitMinor: number;
  creditMinor: number;
  runningBalanceMinor: number;
  status?: string;
}

export interface PrintableCustomerStatement {
  shop: { name: string; address?: string | null; phone?: string | null; gstin?: string | null };
  customer: { name: string; phone?: string | null; gstin?: string | null; address?: string | null };
  dateRangeText: string;
  openingBalanceMinor: number;
  rows: PrintableLedgerRow[];
  closingBalanceMinor: number;
  advanceMinor: number;
  totalBilledMinor: number;
  totalCollectedMinor: number;
}

export function renderCustomerStatementDoc(stmt: PrintableCustomerStatement): string {
  const tableRows = stmt.rows.map((r, i) => {
    const isReversed = r.status === 'reversed';
    const style = isReversed ? 'text-decoration:line-through;color:#94a3b8' : '';
    return `<tr style="${style}">
      <td>${i + 1}</td>
      <td>${esc(r.dateText)}</td>
      <td class="l"><b>${esc(r.refNumber)}</b>${isReversed ? ' <span style="color:#ef4444;font-size:10px;font-weight:700">(REVERSED)</span>' : ''}</td>
      <td class="l">${esc(r.description)}</td>
      <td>${r.debitMinor > 0 ? '₹' + money(r.debitMinor) : '—'}</td>
      <td>${r.creditMinor > 0 ? '₹' + money(r.creditMinor) : '—'}</td>
      <td><b>₹${money(r.runningBalanceMinor)}</b></td>
    </tr>`;
  }).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Statement - ${esc(stmt.customer.name)}</title><style>${CSS('a4')}</style></head><body>
  <section class="copy a4">
    <div class="top">
      <div>
        <div class="shop">${esc(stmt.shop.name)}</div>
        <div class="sm">${esc(stmt.shop.address ?? '')}</div>
        <div class="sm">${stmt.shop.phone ? `Ph: ${esc(stmt.shop.phone)}` : ''}${stmt.shop.gstin ? ` · GSTIN: ${esc(stmt.shop.gstin)}` : ''}</div>
      </div>
      <div class="meta">
        <div class="ttl">CUSTOMER STATEMENT</div>
        <div><span class="mu">Period:</span> <b>${esc(stmt.dateRangeText)}</b></div>
        <div><span class="mu">Generated:</span> ${new Date().toLocaleDateString('en-IN', { dateStyle: 'medium' })}</div>
      </div>
    </div>

    <div class="party" style="margin:8px 0 16px 0">
      <div class="mu">Statement For:</div>
      <div style="font-size:16px"><b>${esc(stmt.customer.name)}</b></div>
      <div class="sm">${stmt.customer.phone ? `Phone: ${esc(stmt.customer.phone)}` : ''}${stmt.customer.gstin ? ` · GSTIN: ${esc(stmt.customer.gstin)}` : ''}${stmt.customer.address ? ` · ${esc(stmt.customer.address)}` : ''}</div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px">
      <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:8px 12px;border-radius:6px">
        <div class="sm mu">Opening Balance</div>
        <div style="font-size:15px;font-weight:700">₹${money(stmt.openingBalanceMinor)}</div>
      </div>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:8px 12px;border-radius:6px">
        <div class="sm mu">Total Billed</div>
        <div style="font-size:15px;font-weight:700;color:#0f172a">₹${money(stmt.totalBilledMinor)}</div>
      </div>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:8px 12px;border-radius:6px">
        <div class="sm mu">Total Collected</div>
        <div style="font-size:15px;font-weight:700;color:#16a34a">₹${money(stmt.totalCollectedMinor)}</div>
      </div>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;padding:8px 12px;border-radius:6px">
        <div class="sm mu" style="color:#166534">Current Net Dues</div>
        <div style="font-size:16px;font-weight:800;color:#166534">₹${money(stmt.closingBalanceMinor)}</div>
        ${stmt.advanceMinor > 0 ? `<div class="xs" style="color:#0284c7">Advance: ₹${money(stmt.advanceMinor)}</div>` : ''}
      </div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th style="width:30px">#</th>
          <th>Date</th>
          <th class="l">Ref / Bill No</th>
          <th class="l">Description</th>
          <th>Billed (Dr)</th>
          <th>Received (Cr)</th>
          <th>Balance</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows || '<tr><td colspan="7" class="c" style="padding:16px;color:#64748b">No transactions found for this period.</td></tr>'}
      </tbody>
    </table>

    <div class="foot" style="margin-top:24px">
      Thank you for your business! Please review this statement and contact us for any clarification.
    </div>
  </section>
  </body></html>`;
}

export interface PrintableCreditNoteLine {
  name: string;
  hsn?: string | null;
  unit?: string | null;
  returnQtyMilli: number;
  priceMinor: number;
  taxRateBp: number;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  totalMinor: number;
  reason: string;
  restock: boolean;
  batchNo?: string | null;
}

export interface PrintableCreditNote {
  creditNoteNumber: string;
  creditNoteDateText: string;
  originalInvoiceNumber: string;
  originalInvoiceDateText: string;
  status: string; // 'posted' | 'voided'
  voidReason?: string | null;
  voidedAtText?: string | null;
  shop: {
    name: string;
    address?: string | null;
    phone?: string | null;
    gstin?: string | null;
    upiId?: string | null;
  };
  customer?: {
    name?: string | null;
    phone?: string | null;
    gstin?: string | null;
    address?: string | null;
  } | null;
  lines: PrintableCreditNoteLine[];
  taxableTotalMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  roundOffMinor: number;
  totalCreditMinor: number;
  isIntraState: boolean;
  settlement: {
    duesCleared: { invoiceNumber: string; amountMinor: number }[];
    refund?: { amountMinor: number; mode: string; reference?: string | null } | null;
    advanceMinor: number;
  };
  issuedBy?: string | null;
  note?: string | null;
}

function thermalCreditNote(cn: PrintableCreditNote, tpl: PrintTemplate, _opts: RenderOpts = {}): string {
  const isVoided = cn.status === 'voided';
  const widthClass = tpl.paper === 'thermal58' ? 't58' : 't80';

  const lineItems = cn.lines.map((l) => `
    <div style="margin-bottom:4px">
      <div style="display:flex;justify-content:space-between">
        <b>${esc(l.name)}</b>
        <b>₹${money(l.totalMinor)}</b>
      </div>
      <div class="sm mu">
        ${fmtQty(l.returnQtyMilli)} ${esc(l.unit || 'units')} @ ₹${money(l.priceMinor)}
        · Tax: ₹${money(l.cgstMinor + l.sgstMinor + l.igstMinor)}
      </div>
      <div class="xs" style="color:#475569">
        Reason: ${esc(l.reason)} · Restock: <b>${l.restock ? 'YES' : 'NO'}</b>
      </div>
    </div>
  `).join('');

  const settlementItems: string[] = [];
  for (const d of cn.settlement.duesCleared) {
    settlementItems.push(`<div class="rw xs"><span>Adjusted to Bill #${esc(d.invoiceNumber)}:</span><span>₹${money(d.amountMinor)}</span></div>`);
  }
  if (cn.settlement.refund && cn.settlement.refund.amountMinor > 0) {
    settlementItems.push(`<div class="rw xs" style="color:#0f172a"><span>Refund (${esc(cn.settlement.refund.mode.toUpperCase())}):</span><b>₹${money(cn.settlement.refund.amountMinor)}</b></div>`);
  }
  if (cn.settlement.advanceMinor > 0) {
    settlementItems.push(`<div class="rw xs" style="color:#0284c7"><span>Kept as Customer Advance:</span><b>₹${money(cn.settlement.advanceMinor)}</b></div>`);
  }

  return `<section class="copy ${widthClass}">
    <div class="shop c">${esc(cn.shop.name)}</div>
    <div class="sm c mu">${esc(cn.shop.address ?? '')}</div>
    <div class="sm c mu">${cn.shop.phone ? `Ph: ${esc(cn.shop.phone)}` : ''}${cn.shop.gstin ? ` · GSTIN: ${esc(cn.shop.gstin)}` : ''}</div>
    <div class="c" style="margin:6px 0;font-size:14px;font-weight:800;letter-spacing:1px;border-top:1px dashed #000;border-bottom:1px dashed #000;padding:4px 0">
      CREDIT NOTE
    </div>
    ${isVoided ? `<div class="c" style="background:#000;color:#fff;padding:2px 4px;font-weight:800;font-size:12px;margin-bottom:6px">*** VOIDED ***</div>` : ''}
    
    <div class="rw"><span>Credit Note No:</span><b>${esc(cn.creditNoteNumber)}</b></div>
    <div class="rw"><span>Date:</span><span>${esc(cn.creditNoteDateText)}</span></div>
    <div class="rw" style="border-bottom:1px dashed #ccc;padding-bottom:4px;margin-bottom:4px">
      <span>Against Bill:</span><b>${esc(cn.originalInvoiceNumber)} (${esc(cn.originalInvoiceDateText)})</b>
    </div>
    ${cn.customer?.name ? `<div class="rw"><span>Customer:</span><span>${esc(cn.customer.name)}</span></div>` : ''}
    ${cn.customer?.phone ? `<div class="rw"><span>Phone:</span><span>${esc(cn.customer.phone)}</span></div>` : ''}

    <div style="border-top:1px dashed #000;margin:6px 0 4px 0"></div>
    ${lineItems}
    <div style="border-top:1px dashed #000;margin:4px 0"></div>

    <div class="rw"><span>Taxable Reversal:</span><span>₹${money(cn.taxableTotalMinor)}</span></div>
    ${cn.isIntraState ? `
      <div class="rw"><span>CGST Reversal:</span><span>₹${money(cn.cgstMinor)}</span></div>
      <div class="rw"><span>SGST Reversal:</span><span>₹${money(cn.sgstMinor)}</span></div>
    ` : `
      <div class="rw"><span>IGST Reversal:</span><span>₹${money(cn.igstMinor)}</span></div>
    `}
    ${cn.roundOffMinor !== 0 ? `<div class="rw"><span>Round off:</span><span>${cn.roundOffMinor > 0 ? '+' : ''}₹${money(cn.roundOffMinor)}</span></div>` : ''}
    <div class="rw tot" style="font-size:15px;margin-top:4px"><span>TOTAL CREDIT:</span><span>₹${money(cn.totalCreditMinor)}</span></div>

    <div style="border-top:1px dashed #000;margin:6px 0 4px 0"></div>
    <div class="xs" style="font-weight:700;margin-bottom:2px">SETTLEMENT:</div>
    ${settlementItems.join('') || '<div class="xs mu">No monetary adjustment.</div>'}

    <div class="foot" style="margin-top:10px;text-align:center">
      Issued against tax invoice per GST law.<br>
      ${cn.issuedBy ? `Issued by: ${esc(cn.issuedBy)}<br>` : ''}
      Thank you!
    </div>
  </section>`;
}

function a4CreditNote(cn: PrintableCreditNote, _tpl: PrintTemplate, _opts: RenderOpts = {}): string {
  const isVoided = cn.status === 'voided';

  const rows = cn.lines.map((l, i) => `
    <tr>
      <td class="c">${i + 1}</td>
      <td class="l">
        <b>${esc(l.name)}</b>
        <div class="xs" style="color:#64748b">Reason: <b>${esc(l.reason)}</b> · Restock: <span style="font-weight:700;color:${l.restock ? '#16a34a' : '#dc2626'}">${l.restock ? 'YES' : 'NO'}</span></div>
      </td>
      <td class="c">${esc(l.hsn ?? '—')}</td>
      <td class="c">${fmtQty(l.returnQtyMilli)} ${esc(l.unit || '')}</td>
      <td class="r">₹${money(l.priceMinor)}</td>
      <td class="r">₹${money(l.taxableMinor)}</td>
      <td class="r">
        ${cn.isIntraState ? `₹${money(l.cgstMinor + l.sgstMinor)}<div class="xs mu">${bpToPct(l.taxRateBp)}%</div>` : `₹${money(l.igstMinor)}<div class="xs mu">${bpToPct(l.taxRateBp)}%</div>`}
      </td>
      <td class="r"><b>₹${money(l.totalMinor)}</b></td>
    </tr>
  `).join('');

  const settlementLines: string[] = [];
  for (const d of cn.settlement.duesCleared) {
    settlementLines.push(`<div>• Adjusted against Bill <b>#${esc(d.invoiceNumber)}</b>: <b>₹${money(d.amountMinor)}</b></div>`);
  }
  if (cn.settlement.refund && cn.settlement.refund.amountMinor > 0) {
    settlementLines.push(`<div>• Refund recorded via <b>${esc(cn.settlement.refund.mode.toUpperCase())}</b>: <b>₹${money(cn.settlement.refund.amountMinor)}</b>${cn.settlement.refund.reference ? ` (Ref: ${esc(cn.settlement.refund.reference)})` : ''}</div>`);
  }
  if (cn.settlement.advanceMinor > 0) {
    settlementLines.push(`<div>• Credited to Customer Advance Balance: <b>₹${money(cn.settlement.advanceMinor)}</b></div>`);
  }

  return `<section class="copy a4">
    ${isVoided ? `
      <div style="background:#fee2e2;border:2px solid #ef4444;color:#b91c1c;padding:8px 12px;border-radius:6px;margin-bottom:12px;font-weight:700;text-align:center">
        *** VOIDED CREDIT NOTE *** — ${esc(cn.voidReason || 'Credit Note was voided')} (Voided: ${esc(cn.voidedAtText || '')})
      </div>
    ` : ''}

    <div class="top">
      <div>
        <div class="shop">${esc(cn.shop.name)}</div>
        <div class="sm">${esc(cn.shop.address ?? '')}</div>
        <div class="sm">${cn.shop.phone ? `Ph: ${esc(cn.shop.phone)}` : ''}${cn.shop.gstin ? ` · GSTIN: ${esc(cn.shop.gstin)}` : ''}</div>
      </div>
      <div class="meta">
        <div class="ttl" style="color:#0f172a">CREDIT NOTE</div>
        <div><span class="mu">Credit Note No:</span> <b>${esc(cn.creditNoteNumber)}</b></div>
        <div><span class="mu">Date:</span> ${esc(cn.creditNoteDateText)}</div>
        <div style="margin-top:4px;padding-top:4px;border-top:1px dashed #cbd5e1">
          <span class="mu">Against Original Bill:</span> <b>${esc(cn.originalInvoiceNumber)}</b>
        </div>
        <div><span class="mu">Original Bill Date:</span> ${esc(cn.originalInvoiceDateText)}</div>
      </div>
    </div>

    <div class="party" style="margin:12px 0">
      <div class="mu">Issued To Customer:</div>
      <div style="font-size:15px"><b>${esc(cn.customer?.name || 'Walk-in Customer')}</b></div>
      <div class="sm">${cn.customer?.phone ? `Phone: ${esc(cn.customer.phone)}` : ''}${cn.customer?.gstin ? ` · GSTIN: ${esc(cn.customer.gstin)}` : ''}${cn.customer?.address ? ` · ${esc(cn.customer.address)}` : ''}</div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th style="width:30px">#</th>
          <th class="l">Item / Return Particulars</th>
          <th>HSN</th>
          <th>Returned Qty</th>
          <th>Unit Price</th>
          <th>Taxable (Dr)</th>
          <th>GST Reversal</th>
          <th>Credit Total</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    <div class="bottom" style="margin-top:16px">
      <div class="left" style="width:55%">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:10px 14px;border-radius:6px;margin-bottom:8px">
          <div class="sm mu"><b>Amount in Words:</b></div>
          <div style="font-size:13px;font-weight:700;color:#1e293b;margin-top:2px">
            ${moneyInWords(cn.totalCreditMinor)}
          </div>
        </div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:10px 14px;border-radius:6px">
          <div class="sm mu"><b>Settlement Breakdown:</b></div>
          <div style="font-size:12px;margin-top:4px;line-height:1.6">
            ${settlementLines.join('') || '<div>No monetary settlement required.</div>'}
          </div>
        </div>
      </div>
      <div class="right" style="width:40%">
        <div class="rw"><span>Taxable Reversal:</span><b>₹${money(cn.taxableTotalMinor)}</b></div>
        ${cn.isIntraState ? `
          <div class="rw"><span>CGST Reversal:</span><span>₹${money(cn.cgstMinor)}</span></div>
          <div class="rw"><span>SGST Reversal:</span><span>₹${money(cn.sgstMinor)}</span></div>
        ` : `
          <div class="rw"><span>IGST Reversal:</span><span>₹${money(cn.igstMinor)}</span></div>
        `}
        ${cn.roundOffMinor !== 0 ? `<div class="rw"><span>Round Off:</span><span>${cn.roundOffMinor > 0 ? '+' : ''}₹${money(cn.roundOffMinor)}</span></div>` : ''}
        <div class="rw tot" style="font-size:17px;color:#0f172a;border-top:2px solid #0f172a;padding-top:6px;margin-top:6px">
          <span>TOTAL CREDIT:</span><span>₹${money(cn.totalCreditMinor)}</span>
        </div>
      </div>
    </div>

    <div class="foot" style="margin-top:28px">
      This is a computer-generated Credit Note linked to the original tax invoice per Section 34 of the CGST Act.<br>
      ${cn.issuedBy ? `Issued by: ${esc(cn.issuedBy)}` : ''}
    </div>
  </section>`;
}

export function renderCreditNoteDoc(cn: PrintableCreditNote, tpl: PrintTemplate, opts: RenderOpts = {}): string {
  const thermal = tpl.paper === 'thermal58' || tpl.paper === 'thermal80';
  const html = thermal ? thermalCreditNote(cn, tpl, opts) : a4CreditNote(cn, tpl, opts);
  return `<!doctype html><html lang="${tpl.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Credit Note ${esc(cn.creditNoteNumber)}</title><style>${CSS(tpl.paper)}</style></head><body>${html}${opts.autoPrint ? '<script>window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print()},250)})</script>' : ''}</body></html>`;
}

export interface PrintablePurchaseLine {
  name: string;
  hsn?: string | null;
  unit?: string | null;
  billedQtyMilli: number;
  receivedQtyMilli: number;
  costMinor: number;
  discountMinor: number;
  taxRateBp: number;
  taxableMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  totalMinor: number;
  batchNo?: string | null;
  expiry?: string | null;
}

export interface PrintablePurchase {
  purchaseNumber: string;
  status: string;
  purchaseDate: string;
  supplierInvoiceNumber: string;
  supplierInvoiceDate: string;
  shop: { name: string; address?: string | null; phone?: string | null; gstin?: string | null; stateName?: string | null };
  supplier: { name: string; phone?: string | null; gstin?: string | null; address?: string | null };
  lines: PrintablePurchaseLine[];
  taxableTotalMinor: number;
  cgstMinor: number;
  sgstMinor: number;
  igstMinor: number;
  itcMinor: number;
  otherChargesLabel?: string | null;
  otherChargesMinor?: number;
  otherChargesGstMinor?: number;
  roundOffMinor: number;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  recordedBy?: string | null;
  voidReason?: string | null;
  voidedBy?: string | null;
  voidedAt?: string | null;
  isIntraState: boolean;
}

function thermalPurchase(p: PrintablePurchase, tpl: PrintTemplate, opts: RenderOpts): string {
  const isVoided = p.status === 'voided';
  return `<section class="paper ${tpl.paper} receipt" style="position:relative">
    ${isVoided ? '<div style="position:absolute;top:30%;left:5%;right:5%;text-align:center;color:rgba(220,38,38,0.25);font-size:32px;font-weight:900;transform:rotate(-30deg);border:3px solid rgba(220,38,38,0.25);padding:10px 0;pointer-events:none">*** VOIDED ***</div>' : ''}
    <div class="c bold" style="font-size:15px;letter-spacing:0.5px">PURCHASE</div>
    <div class="c mu sm">Internal Stock Inward Voucher</div>
    <div class="div"></div>
    <div class="c bold">${esc(p.shop.name)}</div>
    <div class="c sm mu">${esc(p.shop.address || '')}</div>
    ${p.shop.gstin ? `<div class="c sm mono">GSTIN: ${esc(p.shop.gstin)}</div>` : ''}
    <div class="div"></div>
    <div class="rw"><span>Purchase No:</span><span class="mono bold">${esc(p.purchaseNumber)}</span></div>
    <div class="rw"><span>Date:</span><span>${esc(p.purchaseDate)}</span></div>
    <div class="rw"><span>Supplier:</span><span class="bold">${esc(p.supplier.name)}</span></div>
    <div class="rw"><span>Supplier Inv #:</span><span class="mono bold">${esc(p.supplierInvoiceNumber)}</span></div>
    <div class="rw"><span>Supplier Inv Date:</span><span>${esc(p.supplierInvoiceDate)}</span></div>
    <div class="div"></div>
    <table class="grid">
      <thead><tr><th>Item</th><th class="r">Rcvd</th><th class="r">Rate</th><th class="r">Total</th></tr></thead>
      <tbody>
        ${p.lines.map((l) => `<tr>
          <td>
            <b>${esc(l.name)}</b>
            ${l.batchNo ? `<br><span class="mu sm">B: ${esc(l.batchNo)}${l.expiry ? ` Exp: ${esc(l.expiry)}` : ''}</span>` : ''}
            ${l.billedQtyMilli !== l.receivedQtyMilli ? `<br><span class="mu sm" style="color:#d97706">Billed: ${fmtQty(l.billedQtyMilli)}</span>` : ''}
          </td>
          <td class="r">${fmtQty(l.receivedQtyMilli)}</td>
          <td class="r">₹${money(l.costMinor)}</td>
          <td class="r">₹${money(l.totalMinor)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div class="div"></div>
    <div class="rw"><span>Taxable:</span><span>₹${money(p.taxableTotalMinor)}</span></div>
    <div class="rw"><span>Input Tax Credit (ITC):</span><span>₹${money(p.itcMinor)}</span></div>
    ${p.roundOffMinor !== 0 ? `<div class="rw"><span>Round Off:</span><span>${p.roundOffMinor > 0 ? '+' : ''}₹${money(p.roundOffMinor)}</span></div>` : ''}
    <div class="rw tot" style="font-size:15px"><span>PURCHASE TOTAL:</span><span>₹${money(p.totalMinor)}</span></div>
    <div class="div"></div>
    <div class="rw"><span>Paid Now (${esc(p.paymentMethod || 'None')}):</span><span>₹${money(p.paidMinor)}</span></div>
    <div class="rw bold" style="font-size:13px"><span>Balance Payable:</span><span>₹${money(p.balanceMinor)}</span></div>
    <div class="div"></div>
    <div class="c sm mu">${p.recordedBy ? `Recorded by: ${esc(p.recordedBy)}` : ''}</div>
  </section>`;
}

function a4Purchase(p: PrintablePurchase, tpl: PrintTemplate, opts: RenderOpts): string {
  const isVoided = p.status === 'voided';
  return `<section class="paper a4" style="position:relative;padding:32px 36px">
    ${isVoided ? '<div style="position:absolute;top:40%;left:15%;right:15%;text-align:center;color:rgba(220,38,38,0.22);font-size:72px;font-weight:900;letter-spacing:10px;transform:rotate(-30deg);border:6px solid rgba(220,38,38,0.22);padding:24px 0;pointer-events:none">*** VOIDED ***</div>' : ''}
    <div class="a4-hdr">
      <div>
        <div style="font-size:24px;font-weight:800;color:#0f172a;letter-spacing:0.5px">PURCHASE</div>
        <div style="font-size:12px;color:#64748b;margin-top:2px">Goods Stock Inward &amp; Payable Document</div>
        <div style="font-size:13px;color:#334155;margin-top:8px">
          <div><b>Purchase Number:</b> <span class="mono">${esc(p.purchaseNumber)}</span></div>
          <div><b>Recording Date:</b> ${esc(p.purchaseDate)}</div>
          <div><b>Status:</b> <span style="font-weight:700;text-transform:uppercase;color:${isVoided ? '#dc2626' : '#16a34a'}">${esc(p.status)}</span></div>
          ${isVoided && p.voidReason ? `<div style="color:#dc2626;font-size:12px"><b>Void Reason:</b> ${esc(p.voidReason)}</div>` : ''}
        </div>
      </div>
      <div style="text-align:right">
        <div class="shop-name" style="font-size:20px">${esc(p.shop.name)}</div>
        <div class="mu sm">${esc(p.shop.address || '')}</div>
        ${p.shop.phone ? `<div class="mu sm">Phone: ${esc(p.shop.phone)}</div>` : ''}
        ${p.shop.gstin ? `<div class="sm mono"><b>GSTIN:</b> ${esc(p.shop.gstin)}</div>` : ''}
      </div>
    </div>

    <div style="display:flex;justify-content:space-between;margin:20px 0 16px;padding:12px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:13px">
      <div>
        <div class="mu sm" style="text-transform:uppercase;font-weight:700;color:#64748b">Supplier Information</div>
        <div style="font-size:15px;font-weight:700;margin-top:4px;color:#0f172a">${esc(p.supplier.name)}</div>
        ${p.supplier.phone ? `<div class="mu sm">Phone: ${esc(p.supplier.phone)}</div>` : ''}
        ${p.supplier.gstin ? `<div class="sm mono">GSTIN: ${esc(p.supplier.gstin)}</div>` : '<div class="sm mu" style="color:#ea580c">Unregistered Supplier (No GSTIN)</div>'}
      </div>
      <div style="text-align:right">
        <div class="mu sm" style="text-transform:uppercase;font-weight:700;color:#64748b">Supplier Bill Reference</div>
        <div style="font-size:15px;font-weight:800;color:#0f172a;margin-top:4px">Invoice #: <span class="mono">${esc(p.supplierInvoiceNumber)}</span></div>
        <div style="font-size:13px;color:#334155;margin-top:2px">Invoice Date: ${esc(p.supplierInvoiceDate)}</div>
      </div>
    </div>

    <table class="grid" style="margin-top:10px">
      <thead>
        <tr>
          <th style="width:5%">#</th>
          <th>Item &amp; Description</th>
          <th class="r">Billed Qty</th>
          <th class="r">Rcvd Qty</th>
          <th class="r">Purchase Rate</th>
          <th class="r">Taxable Val</th>
          <th class="r">GST</th>
          <th class="r">Total</th>
        </tr>
      </thead>
      <tbody>
        ${p.lines.map((l, i) => `<tr>
          <td>${i + 1}</td>
          <td>
            <b>${esc(l.name)}</b>
            ${l.hsn ? `<span class="mu sm mono"> (HSN: ${esc(l.hsn)})</span>` : ''}
            ${l.batchNo ? `<br><span class="mu sm mono" style="color:#0284c7">Batch: ${esc(l.batchNo)}${l.expiry ? ` • Exp: ${esc(l.expiry)}` : ''}</span>` : ''}
          </td>
          <td class="r mono">${fmtQty(l.billedQtyMilli)}</td>
          <td class="r mono" style="font-weight:700">${fmtQty(l.receivedQtyMilli)}</td>
          <td class="r mono">₹${money(l.costMinor)}</td>
          <td class="r mono">₹${money(l.taxableMinor)}</td>
          <td class="r mono sm">
            ${l.taxRateBp > 0 ? `${bpToPct(l.taxRateBp)}<br>₹${money(l.cgstMinor + l.sgstMinor + l.igstMinor)}` : '0%'}
          </td>
          <td class="r mono" style="font-weight:700">₹${money(l.totalMinor)}</td>
        </tr>`).join('')}
      </tbody>
    </table>

    <div style="display:flex;justify-content:space-between;margin-top:20px;align-items:flex-start">
      <div style="width:55%">
        <div style="background:#f8fafc;border:1px solid #e2e8f0;padding:12px 14px;border-radius:6px;font-size:13px">
          <div><b>Amount in words:</b></div>
          <div style="font-style:italic;color:#334155;margin-top:4px">${moneyInWords(p.totalMinor)}</div>
          <div style="border-top:1px dashed #cbd5e1;margin-top:10px;padding-top:10px">
            <b>Payment Block:</b>
            <div style="margin-top:4px;color:#334155">
              Paid Now: <b>₹${money(p.paidMinor)}</b> ${p.paymentMethod ? `via ${esc(p.paymentMethod).toUpperCase()}` : ''} ${p.paymentReference ? `(Ref: ${esc(p.paymentReference)})` : ''}<br>
              Balance Payable: <b style="color:#d97706">₹${money(p.balanceMinor)}</b>
            </div>
          </div>
        </div>
      </div>
      <div class="right" style="width:40%">
        <div class="rw"><span>Taxable Total:</span><b>₹${money(p.taxableTotalMinor)}</b></div>
        ${p.isIntraState ? `
          <div class="rw"><span>CGST (Input Credit):</span><span>₹${money(p.cgstMinor)}</span></div>
          <div class="rw"><span>SGST (Input Credit):</span><span>₹${money(p.sgstMinor)}</span></div>
        ` : `
          <div class="rw"><span>IGST (Input Credit):</span><span>₹${money(p.igstMinor)}</span></div>
        `}
        <div class="rw" style="color:#0284c7;font-weight:700"><span>Total Input Tax Credit (ITC):</span><span>₹${money(p.itcMinor)}</span></div>
        ${(p.otherChargesMinor || 0) > 0 ? `<div class="rw"><span>${esc(p.otherChargesLabel || 'Other Charges')}:</span><span>₹${money(p.otherChargesMinor || 0)}</span></div>` : ''}
        ${p.roundOffMinor !== 0 ? `<div class="rw"><span>Round Off:</span><span>${p.roundOffMinor > 0 ? '+' : ''}₹${money(p.roundOffMinor)}</span></div>` : ''}
        <div class="rw tot" style="font-size:18px;color:#0f172a;border-top:2px solid #0f172a;padding-top:6px;margin-top:6px">
          <span>PURCHASE TOTAL:</span><span>₹${money(p.totalMinor)}</span>
        </div>
      </div>
    </div>

    <div class="foot" style="margin-top:28px">
      Internal stock inward voucher generated by system. Linked to Supplier Invoice #${esc(p.supplierInvoiceNumber)} dated ${esc(p.supplierInvoiceDate)}.<br>
      ${p.recordedBy ? `Recorded by: ${esc(p.recordedBy)}` : ''}
    </div>
  </section>`;
}

export function renderPurchaseDoc(p: PrintablePurchase, tpl: PrintTemplate, opts: RenderOpts = {}): string {
  const thermal = tpl.paper === 'thermal58' || tpl.paper === 'thermal80';
  const html = thermal ? thermalPurchase(p, tpl, opts) : a4Purchase(p, tpl, opts);
  return `<!doctype html><html lang="${tpl.language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Purchase ${esc(p.purchaseNumber)}</title><style>${CSS(tpl.paper)}</style></head><body>${html}${opts.autoPrint ? '<script>window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print()},250)})</script>' : ''}</body></html>`;
}



