/*
 * What a scan's findings look like shared (pure): a card (src/engine/share-card.ts) and a report of one
 * file with no network calls. Everything on them is what's kept, picked by code, and shown to the person
 * before it goes anywhere: short excerpts, word for word, saying where each came from and never who said it.
 */

export interface ShareQuote {
  text: string;
  from: string;
  url?: string;
}

export interface ShareProblem {
  id: string;
  title: string;
  /** What backs it, in a line. */
  line: string;
  quotes: { text: string; source: string; url?: string }[];
}

export const SHARE_LIMITS = { cardQuotes: 3, cardChars: 150, reportQuotes: 4, reportProblems: 12, title: 120 } as const;

const one = (s: string) => s.replace(/\s+/g, " ").trim();
const hostOf = (url: string | undefined) => {
  try {
    return url && /^https?:/i.test(url) ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
};

/** Where a quote came from, in a few words: a place, never a person. */
export function fromLabel(source: string, url?: string): string {
  const s = one(source);
  const app = /^App Store reviews?: (.+)$/i.exec(s);
  if (app) return `App Store review of ${app[1].split(/\s[-–—:]\s?/)[0]}`;
  if (/^Hacker News\b/i.test(s)) return "Hacker News";
  return hostOf(url) || s.slice(0, 40);
}

/**
 * Words short enough for a card, taken from the quote as they stand: its first sentences if they fit,
 * else as far as a word's end, saying it was cut. Null when too little of it would be left to mean anything.
 */
export function shortQuote(text: string, max: number = SHARE_LIMITS.cardChars): string | null {
  const t = one(text);
  if (t.length <= max) return t;
  let end = 0;
  for (const m of t.matchAll(/[.!?؟]["”’)]?(?=\s)/g)) {
    const at = (m.index ?? 0) + m[0].length;
    if (at > max) break;
    end = at;
  }
  if (end >= 40) return t.slice(0, end);
  const cut = t.slice(0, max).replace(/\s+\S*$/, "");
  return cut.length >= 40 ? `${cut}…` : null;
}

/** The quotes for a card: one from each place first, the shortest that stand on their own first. */
export function cardQuotes(quotes: readonly ShareProblem["quotes"][number][], max: number = SHARE_LIMITS.cardQuotes): ShareQuote[] {
  const short = quotes.flatMap((q) => {
    const text = shortQuote(q.text);
    return text ? [{ text, from: fromLabel(q.source, q.url), ...(q.url ? { url: q.url } : {}), whole: !text.endsWith("…") }] : [];
  });
  const sorted = [...short].sort((a, b) => Number(b.whole) - Number(a.whole));
  const picked: typeof short = [];
  for (const q of sorted) if (picked.length < max && !picked.some((p) => p.from === q.from)) picked.push(q);
  for (const q of sorted) if (picked.length < max && !picked.includes(q)) picked.push(q);
  return picked.map(({ whole: _whole, ...q }) => q);
}

/** How much was read, in the words the card ends on. */
export const readLine = (quotes: number, places: number) => `${quotes} ${quotes === 1 ? "quote" : "quotes"} from ${places} ${places === 1 ? "place" : "places"}`;

export interface ReportData {
  about: string;
  at: number;
  problems: readonly ShareProblem[];
  quotes: number;
  places: number;
  plan?: { audience?: string; goal?: string; build?: string; why?: string; wrong?: string; test?: string; pass?: string };
  known: readonly { kind: "product" | "published"; name?: string; text: string; title: string; url: string }[];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** A link only to a web address: anything else off the web stays plain words. */
const link = (label: string, url?: string) => (url && /^https?:\/\//i.test(url) ? `<a href="${esc(url)}" rel="noreferrer">${esc(label)}</a>` : esc(label));

const STYLE = `:root{color-scheme:light dark;--bg:#fff;--ink:#1a1a1a;--muted:#666;--line:#e4e4e4;--raised:#f7f7f7}
@media (prefers-color-scheme:dark){:root{--bg:#161616;--ink:#ededed;--muted:#a0a0a0;--line:#2e2e2e;--raised:#1f1f1f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,"IBM Plex Sans Arabic",sans-serif}
main{max-width:720px;margin:0 auto;padding:40px 16px 64px}h1{font-size:28px;line-height:1.25;margin:0 0 8px}h2{font-size:20px;margin:40px 0 12px}h3{font-size:17px;margin:0}
p{margin:0 0 8px}.muted{color:var(--muted);font-size:14px}a{color:inherit}.item{padding:16px 0;border-top:1px solid var(--line)}
blockquote{margin:10px 0 0;padding:0 0 0 12px;border-inline-start:2px solid var(--line)}blockquote p{margin:0}blockquote .muted{margin-top:2px}
.card{background:var(--raised);border-radius:10px;padding:16px;margin-top:12px}dt{color:var(--muted);font-size:14px;margin-top:10px}dd{margin:0}`;

/** The report: one file, nothing fetched, no scripts, light or dark as the reader's system is. */
export function reportHtml(d: ReportData): string {
  const quote = (q: ShareProblem["quotes"][number]) => `<blockquote dir="auto"><p>“${esc(one(q.text))}”</p><p class="muted">${link(fromLabel(q.source, q.url), q.url)}</p></blockquote>`;
  const problems = d.problems
    .slice(0, SHARE_LIMITS.reportProblems)
    .map((p) => `<section class="item"><h3 dir="auto">${esc(one(p.title))}</h3><p class="muted">${esc(p.line)}</p>${p.quotes.slice(0, SHARE_LIMITS.reportQuotes).map(quote).join("")}</section>`)
    .join("");
  const row = (label: string, value?: string) => (value?.trim() ? `<dt>${esc(label)}</dt><dd dir="auto">${esc(one(value))}</dd>` : "");
  const plan = d.plan ? [row("For", d.plan.audience), row("First goal", d.plan.goal), row("Build first", d.plan.build), row("Why this first", d.plan.why), row("What would prove it wrong", d.plan.wrong), row("Test it first", d.plan.test), row("A suggested pass line", d.plan.pass)].join("") : "";
  const knownRow = (k: ReportData["known"][number]) => `<p dir="auto">${esc([k.name, one(k.text)].filter(Boolean).join(": "))} <span class="muted">${link(k.title || hostOf(k.url), k.url)}</span></p>`;
  const products = d.known.filter((k) => k.kind === "product");
  const published = d.known.filter((k) => k.kind === "published");
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
    `<title>${esc(one(d.about).slice(0, SHARE_LIMITS.title))}</title>`,
    `<style>${STYLE}</style></head><body><main>`,
    `<h1 dir="auto">${esc(one(d.about))}</h1>`,
    `<p class="muted">${esc(readLine(d.quotes, d.places))}, read ${new Date(d.at).toISOString().slice(0, 10)}. This is what people say in public: a strong signal, not proof.</p>`,
    plan ? `<div class="card"><dl style="margin:0">${plan}</dl></div>` : "",
    `<h2>What people struggle with</h2>${problems}`,
    products.length || published.length ? `<h2>Read elsewhere</h2><p class="muted">Not these people's words, and nothing above rests on it.</p>${products.map(knownRow).join("")}${published.map(knownRow).join("")}` : "",
    `<p class="muted" style="margin-top:40px">Made with Qalam Studio.</p>`,
    "</main></body></html>",
  ]
    .filter(Boolean)
    .join("\n");
}
