/**
 * Money in authored copy (pure): finding an amount in a text ("Add · AED 18.00", "+AED 6.00",
 * "8,20 €", "٢٨٫٠٠ د.إ") and the format it's written in, so the prototype writes new amounts the
 * way the design does — same currency mark and side, separators, decimals and digits. Amounts are
 * minor units (fils, cents).
 */

export interface MoneyFormat {
  /** Before the number ("AED ", "$"), and after it (" €", " د.إ"). */
  prefix: string;
  suffix: string;
  decimals: number;
  dec: string;
  group: string;
  digits: "latin" | "arabic";
}

export interface MoneyMatch {
  /** Minor units, signed. */
  amount: number;
  /** Written with an explicit + (a price difference: "+AED 6.00"). */
  plus: boolean;
  /** Written with a sign either way: a difference ("+AED 6.00", "−٦٫٢٥ ر.س"), not a price. */
  signed: boolean;
  /** The amount as written, sign and currency included, and where it starts in the text. */
  text: string;
  index: number;
  format: MoneyFormat;
}

const ARABIC = "٠١٢٣٤٥٦٧٨٩";
const toLatin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(ARABIC.indexOf(d)));

/** Currency marks: ISO codes, symbols, and the usual Arabic abbreviations. */
const CURRENCY = String.raw`(?:[A-Z]{3}|[$€£¥₹₺₦₩]|د\.إ|ر\.س|ر\.ق|د\.ك|د\.ب|ر\.ع|ج\.م|د\.أ|ل\.ل|دج|د\.م\.?|ريال|درهم|جنيه|دينار)`;
const NUMBER = String.raw`[0-9٠-٩](?:[0-9٠-٩]|[.,٬٫'  ](?=[0-9٠-٩]))*`;
const MONEY = new RegExp(String.raw`([+−-]?)(?:(${CURRENCY})(\s?)(${NUMBER})|(${NUMBER})(\s?)(${CURRENCY}))`, "u");

/** The first amount of money in a text, or null when it has none (a bare number isn't money). */
export function findMoney(text: string): MoneyMatch | null {
  const m = MONEY.exec(text);
  if (!m) return null;
  const [all, sign, preCur, preGap, preNum, postNum, postGap, postCur] = m;
  const raw = preNum ?? postNum;
  const digits: MoneyFormat["digits"] = /[٠-٩]/.test(raw) ? "arabic" : "latin";
  const latin = toLatin(raw);
  // The decimal separator is the last one with one or two digits after it; the rest group.
  const last = latin.match(/[.,٬٫'  ](\d{1,2})$/);
  const dec = last ? raw[raw.length - last[1].length - 1] : digits === "arabic" ? "٫" : ".";
  const decimals = last ? last[1].length : 0;
  const intPart = last ? latin.slice(0, latin.length - last[1].length - 1) : latin;
  const groupMatch = intPart.match(/[.,٬'  ]/);
  const group = groupMatch ? raw[intPart.indexOf(groupMatch[0])] : digits === "arabic" ? "٬" : ",";
  const units = Number(intPart.replace(/[^\d]/g, "") || "0");
  const frac = last ? Number(last[1].padEnd(2, "0").slice(0, 2)) : 0;
  const amount = (units * 100 + frac) * (sign === "-" || sign === "−" ? -1 : 1);
  return {
    amount,
    plus: sign === "+",
    signed: !!sign,
    text: all,
    index: m.index,
    format: {
      prefix: preCur ? `${preCur}${preGap}` : "",
      suffix: postCur ? `${postGap}${postCur}` : "",
      decimals,
      dec,
      group: group === dec ? (dec === "," ? "." : ",") : group,
      digits,
    },
  };
}

/** Write minor units the way `f` does ("AED 24.00"); `plus` writes a + before a positive amount. */
export function formatMoney(minor: number, f: MoneyFormat, plus = false): string {
  const neg = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const units = Math.floor(abs / 100);
  const frac = abs % 100;
  const int = String(units).replace(/\B(?=(\d{3})+(?!\d))/g, "\u0000").replace(/\u0000/g, f.group);
  let num = f.decimals ? `${int}${f.dec}${String(frac).padStart(2, "0").slice(0, f.decimals)}` : String(units + (frac >= 50 ? 1 : 0)).replace(/\B(?=(\d{3})+(?!\d))/g, f.group);
  if (f.digits === "arabic") num = num.replace(/\d/g, (d) => ARABIC[Number(d)]);
  return `${neg ? "-" : plus && minor > 0 ? "+" : ""}${f.prefix}${num}${f.suffix}`;
}

/** The same, as TypeScript for the compiled prototype: `(n: number) => string`. */
export function moneyCode(f: MoneyFormat): string {
  const digits = f.digits === "arabic" ? `.replace(/\\d/g, (x) => "${ARABIC}"[Number(x)])` : "";
  const grouped = (expr: string) => `${expr}.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ${JSON.stringify(f.group)})`;
  const body = f.decimals
    ? `${grouped("String(Math.floor(a / 100))")} + ${JSON.stringify(f.dec)} + String(a % 100).padStart(2, "0").slice(0, ${f.decimals})`
    : grouped("String(Math.round(a / 100))");
  return `(n: number) => { const a = Math.abs(Math.round(n)); return (n < 0 ? "-" : "") + ${JSON.stringify(f.prefix)} + (${body})${digits} + ${JSON.stringify(f.suffix)}; }`;
}

/** Does a text read as money in the same currency (for telling prices from other numbers)? */
export const sameCurrency = (a: MoneyFormat, b: MoneyFormat) => a.prefix.trim() === b.prefix.trim() && a.suffix.trim() === b.suffix.trim();
