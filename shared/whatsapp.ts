import { fmtMoney } from './money.ts';
import type { Lang } from './types.ts';

/** Normalise an Indian mobile number to digits with country code (e.g. 919876543210). Null if it cannot be a phone number. */
export function normalizePhone(input: string | null | undefined, defaultCc = '91'): string | null {
  if (!input) return null;
  let d = String(input).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10) d = defaultCc + d;
  else if (d.length === 11 && d.startsWith('0')) d = defaultCc + d.slice(1);
  if (d.length < 11 || d.length > 15) return null;
  return d;
}

/** wa.me click-to-chat link. The cashier presses Send in WhatsApp; no API account needed. */
export function whatsappLink(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export interface BillMessageInput {
  shopName: string;
  number: string;
  totalMinor: number;
  balanceMinor: number;
  url: string;
  lang?: Lang;
  kind?: 'sale' | 'credit_note';
}

export function billMessage(i: BillMessageInput): string {
  const total = fmtMoney(i.totalMinor);
  const due = i.balanceMinor > 0 ? fmtMoney(i.balanceMinor) : '';
  switch (i.lang) {
    case 'ta':
      return `${i.shopName} இல் வாங்கியதற்கு நன்றி! பில் ${i.number}, தொகை ${total}.${due ? ` நிலுவை ${due}.` : ''}\nபில்லைப் பார்க்க / பதிவிறக்க: ${i.url}`;
    case 'hi':
      return `${i.shopName} से खरीदारी के लिए धन्यवाद! बिल ${i.number}, राशि ${total}.${due ? ` बकाया ${due}.` : ''}\nबिल देखें / डाउनलोड करें: ${i.url}`;
    default:
      return `Thank you for shopping at ${i.shopName}! ${i.kind === 'credit_note' ? 'Credit note' : 'Bill'} ${i.number} for ${total}.${due ? ` Balance due: ${due}.` : ''}\nView / download: ${i.url}`;
  }
}

export interface ReceiptMessageInput {
  shopName: string;
  receiptNo: string;
  amountMinor: number;
  mode: string;
  settledInvoices: string[];
  balanceMinor: number;
  advanceMinor?: number;
  url?: string | null;
  lang?: Lang;
}

export function formatInvoicesList(invoices: string[], lang: Lang = 'en'): string {
  if (!invoices || invoices.length === 0) {
    if (lang === 'ta') return 'முன்பணம் (Advance)';
    if (lang === 'hi') return 'अग्रिम (Advance)';
    return 'Advance on account';
  }
  if (invoices.length <= 3) {
    return invoices.join(', ');
  }
  const top3 = invoices.slice(0, 3).join(', ');
  const more = invoices.length - 3;
  if (lang === 'ta') return `${top3} (+${more} பில்கள்)`;
  if (lang === 'hi') return `${top3} (+${more} अन्य बिल)`;
  return `${top3} (+${more} more bills)`;
}

export function receiptMessage(i: ReceiptMessageInput): string {
  const amount = fmtMoney(i.amountMinor);
  const balance = fmtMoney(i.balanceMinor);
  const advance = i.advanceMinor && i.advanceMinor > 0 ? fmtMoney(i.advanceMinor) : '';
  const invList = formatInvoicesList(i.settledInvoices, i.lang ?? 'en');
  const link = i.url ? i.url : '';
  const modeStr = i.mode.toUpperCase();

  switch (i.lang) {
    case 'ta':
      return `பணம் பெறப்பட்டது — நன்றி! ரசீது ${i.receiptNo}. பெறப்பட்ட தொகை: ${amount} (${modeStr}). தீர்க்கப்பட்ட பில்கள்: ${invList}. மீதி நிலுவை: ${balance}.${advance ? ` முன்பணம்: ${advance}.` : ''}${link ? `\nரசீது: ${link}` : ''} — ${i.shopName}`;
    case 'hi':
      return `भुगतान प्राप्त हुआ — धन्यवाद! रसीद ${i.receiptNo}। प्राप्त राशि: ${amount} माध्यम ${modeStr}। चुकता बिल: ${invList}। शेष बकाया: ${balance}।${advance ? ` जमा अग्रिम: ${advance}।` : ''}${link ? `\nरसीद: ${link}` : ''} — ${i.shopName}`;
    default:
      return `Payment received — thank you! Receipt ${i.receiptNo}. Amount received: ${amount} via ${modeStr}. Settled: ${invList}. Balance remaining: ${balance}.${advance ? ` Advance held: ${advance}.` : ''}${link ? `\nReceipt: ${link}` : ''} — ${i.shopName}`;
  }
}

export interface ReceiptCorrectionInput {
  shopName: string;
  receiptNo: string;
  amountMinor: number;
  lang?: Lang;
}

export function receiptCorrectionMessage(i: ReceiptCorrectionInput): string {
  const amount = fmtMoney(i.amountMinor);
  switch (i.lang) {
    case 'ta':
      return `ரசீது ${i.receiptNo} (தொகை ${amount}) ${i.shopName} ஆல் ரத்து செய்யப்பட்டுள்ளது; தயவுசெய்து அந்த ரசீதை புறக்கணிக்கவும்.`;
    case 'hi':
      return `रसीद ${i.receiptNo} (राशि ${amount}) ${i.shopName} द्वारा रद्द कर दी गई है; कृपया उस रसीद को अनदेखा करें।`;
    default:
      return `Payment receipt ${i.receiptNo} for ${amount} has been cancelled by ${i.shopName}; please ignore that receipt.`;
  }
}

export interface CreditNoteMessageInput {
  shopName: string;
  creditNoteNumber?: string;
  creditNoteNo?: string;
  creditNoteDate?: string;
  invoiceNumber?: string;
  originalBillNo?: string;
  invoiceDate?: string;
  totalCreditMinor: number;
  settlementLine?: string;
  duesClearedMinor?: number;
  balanceRemainingMinor?: number;
  advanceAmountMinor?: number;
  refundAmountMinor?: number;
  refundMode?: string;
  url?: string;
  publicLink?: string;
  customerName?: string;
  lang?: Lang;
}

export function creditNoteMessage(i: CreditNoteMessageInput): string {
  const total = fmtMoney(i.totalCreditMinor);
  const duesCleared = fmtMoney(i.duesClearedMinor ?? 0);
  const balRem = fmtMoney(i.balanceRemainingMinor ?? 0);
  const adv = fmtMoney(i.advanceAmountMinor ?? 0);
  const ref = fmtMoney(i.refundAmountMinor ?? 0);
  const mode = (i.refundMode || 'Cash').toUpperCase();
  const lang = i.lang ?? 'en';

  let settlementLine = i.settlementLine || '';
  if (!settlementLine) {
    if (i.totalCreditMinor === 0) {
      if (lang === 'ta') settlementLine = 'பொருட்கள் திரும்புதல் பதிவு செய்யப்பட்டது.';
      else if (lang === 'hi') settlementLine = 'सामान वापसी दर्ज की गई।';
      else settlementLine = 'Goods return recorded.';
    } else if ((i.advanceAmountMinor ?? 0) > 0) {
      if (lang === 'ta') {
        settlementLine = `${(i.duesClearedMinor ?? 0) > 0 ? `${duesCleared} நிலுவையில் சரிக்கட்டப்பட்டது. ` : ''}${adv} உங்கள் அடுத்த கொள்முதலுக்கான முன்பணமாக வைக்கப்பட்டுள்ளது.`;
      } else if (lang === 'hi') {
        settlementLine = `${(i.duesClearedMinor ?? 0) > 0 ? `${duesCleared} बकाया में समायोजित। ` : ''}${adv} अगली खरीदारी के लिए हमारे पास अग्रिम जमा है।`;
      } else {
        settlementLine = `${(i.duesClearedMinor ?? 0) > 0 ? `${duesCleared} adjusted against dues. ` : ''}${adv} is kept as advance with us for your next purchase.`;
      }
    } else if ((i.refundAmountMinor ?? 0) > 0) {
      if (lang === 'ta') {
        settlementLine = `${(i.duesClearedMinor ?? 0) > 0 ? `${duesCleared} நிலுவையில் சரிக்கட்டப்பட்டது. ` : ''}${ref} ${mode} மூலம் திருப்பி அளிக்கப்பட்டது.`;
      } else if (lang === 'hi') {
        settlementLine = `${(i.duesClearedMinor ?? 0) > 0 ? `${duesCleared} बकाया में समायोजित। ` : ''}${ref} ${mode} द्वारा वापस कर दी गई है।`;
      } else {
        settlementLine = `${(i.duesClearedMinor ?? 0) > 0 ? `${duesCleared} adjusted against dues. ` : ''}${ref} has been refunded by ${mode}.`;
      }
    } else if ((i.duesClearedMinor ?? 0) > 0) {
      if ((i.balanceRemainingMinor ?? 0) > 0) {
        if (lang === 'ta') {
          settlementLine = `இந்தத் தொகை உங்கள் நிலுவையில் சரிக்கட்டப்பட்டது. மீதி நிலுவை: ${balRem}.`;
        } else if (lang === 'hi') {
          settlementLine = `यह राशि आपके बकाया में समायोजित कर दी गई है। शेष बकाया: ${balRem}।`;
        } else {
          settlementLine = `This amount has been adjusted against your pending dues. Balance remaining: ${balRem}.`;
        }
      } else {
        if (lang === 'ta') {
          settlementLine = 'உங்கள் நிலுவைத் தொகை முழுவதும் தீர்க்கப்பட்டது.';
        } else if (lang === 'hi') {
          settlementLine = 'आपका बकाया अब पूरी तरह चुकता हो गया है।';
        } else {
          settlementLine = 'Your pending dues are now fully cleared.';
        }
      }
    }
  }

  const link = i.url || i.publicLink || '';
  const cnNum = i.creditNoteNumber || i.creditNoteNo || '';
  const invNum = i.invoiceNumber || i.originalBillNo || '';
  const cnDate = i.creditNoteDate || new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const invDate = i.invoiceDate || '';

  const dateLineTa = `கிரெடிட் நோட்: ${cnNum}${cnDate ? `  •  தேதி: ${cnDate}` : ''}\nபில் எண்: ${invNum}${invDate ? `  •  தேதி: ${invDate}` : ''}`;
  const dateLineHi = `क्रेडिट नोट: ${cnNum}${cnDate ? `  •  दिनांक: ${cnDate}` : ''}\nमूल बिल: ${invNum}${invDate ? `  •  दिनांक: ${invDate}` : ''}`;
  const dateLineEn = `Credit Note: ${cnNum}${cnDate ? `  •  Date: ${cnDate}` : ''}\nAgainst Bill: ${invNum}${invDate ? `  •  Dated: ${invDate}` : ''}`;

  switch (lang) {
    case 'ta':
      return `வணக்கம்! ${i.shopName} இல் உங்கள் பொருள் திருப்பலுக்கு கிரெடிட் நோட் வழங்கப்பட்டுள்ளது.\n\n${dateLineTa}\nமொத்த கிரெடிட்: ${total}\n${settlementLine}${link ? `\n\nகிரெடிட் நோட்டைப் பார்க்க: ${link}` : ''}\n\nநன்றி!`;
    case 'hi':
      return `नमस्ते! ${i.shopName} पर आपकी वापसी के लिए हमने क्रेडिट नोट जारी किया है।\n\n${dateLineHi}\nकुल क्रेडिट: ${total}\n${settlementLine}${link ? `\n\nक्रेडिट नोट देखें: ${link}` : ''}\n\nधन्यवाद!`;
    default:
      return `Namaste! We have issued a credit note for your return at ${i.shopName}.\n\n${dateLineEn}\nTotal credit: ${total}\n${settlementLine}${link ? `\n\nView your credit note: ${link}` : ''}\n\nThank you!`;
  }
}


