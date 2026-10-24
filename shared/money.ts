// Money is always integer paise. Quantity is integer milli-units (1.5 kg = 1500).
// Never use floating point for stored amounts.

/** Divide n by d, rounding half away from zero, using integer-safe arithmetic. */
export function divRound(n: number, d: number): number {
  if (d === 0) throw new Error('divRound: division by zero');
  const neg = n < 0 !== d < 0;
  const a = Math.abs(n);
  const b = Math.abs(d);
  const q = Math.floor((2 * a + b) / (2 * b));
  return neg ? -q : q;
}

/** "₹1,234.50" style text from paise. */
export function fmtMoney(minor: number, opts: { symbol?: string; plain?: boolean } = {}): string {
  const sym = opts.plain ? '' : (opts.symbol ?? '₹');
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  // Indian digit grouping: 12,34,567
  let r = String(rupees);
  if (r.length > 3) {
    const last3 = r.slice(-3);
    let rest = r.slice(0, -3);
    rest = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    r = rest + ',' + last3;
  }
  return `${neg ? '-' : ''}${sym}${r}.${String(paise).padStart(2, '0')}`;
}

/** Parse user text such as "120", "120.5", "1,200.75" into paise. Returns null if invalid. */
export function parseMoney(text: string | number | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  if (typeof text === 'number') return Number.isFinite(text) ? Math.round(text * 100) : null;
  const t = text.replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '');
  if (t === '' || !/^-?\d*(\.\d{0,2})?$/.test(t) || t === '-' || t === '.') return null;
  const neg = t.startsWith('-');
  const [r, p = ''] = t.replace('-', '').split('.');
  const v = Number(r || '0') * 100 + Number((p + '00').slice(0, 2));
  return neg ? -v : v;
}

/** "1.5" -> 1500 milli-units. */
export function parseQty(text: string | number | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const t = String(text).trim();
  if (!/^\d*(\.\d{0,3})?$/.test(t) || t === '' || t === '.') return null;
  const [w, f = ''] = t.split('.');
  return Number(w || '0') * 1000 + Number((f + '000').slice(0, 3));
}

export function fmtQty(milli: number): string {
  const neg = milli < 0;
  const a = Math.abs(milli);
  const w = Math.floor(a / 1000);
  const f = a % 1000;
  const s = f === 0 ? String(w) : `${w}.${String(f).padStart(3, '0').replace(/0+$/, '')}`;
  return neg ? `-${s}` : s;
}

/** "18" -> 1800 basis points; accepts numbers like 2.5 -> 250. */
export function pctToBp(pct: number): number {
  return Math.round(pct * 100);
}
export function bpToPct(bp: number): string {
  const v = bp / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** Business date (YYYY-MM-DD) in the shop's time zone. */
export function businessDate(d: Date | string | number = new Date(), tz = 'Asia/Kolkata'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
}

/** Converts amount in minor paise to Indian words (e.g. "Five Hundred Rupees Only"). */
export function moneyInWords(minor: number): string {
  const abs = Math.abs(minor);
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;

  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function numToWords(n: number): string {
    if (n === 0) return '';
    if (n < 20) return a[n] + ' ';
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : '') + ' ';
    if (n < 1000) return a[Math.floor(n / 100)] + ' Hundred ' + (n % 100 ? 'and ' + numToWords(n % 100) : '');
    if (n < 100000) return numToWords(Math.floor(n / 1000)) + 'Thousand ' + (n % 1000 ? numToWords(n % 1000) : '');
    if (n < 10000000) return numToWords(Math.floor(n / 100000)) + 'Lakh ' + (n % 100000 ? numToWords(n % 100000) : '');
    return numToWords(Math.floor(n / 10000000)) + 'Crore ' + (n % 10000000 ? numToWords(n % 10000000) : '');
  }

  let words = rupees === 0 ? 'Zero Rupees' : numToWords(rupees).trim() + ' Rupees';
  if (paise > 0) {
    words += ' and ' + numToWords(paise).trim() + ' Paise';
  }
  return words + ' Only';
}

