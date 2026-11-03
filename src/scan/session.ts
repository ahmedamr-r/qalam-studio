/*
 * A scan of what people complain about (pure; the core runs it, server/org/scan.ts), kept in
 * chats/scan/session.json so the window follows it and a reload picks it up. It starts from an idea
 * (find what people use today, then read what they say about it) or a product (read what's said about
 * it), and ends on problem pages, or on saying it found little.
 */

export type ScanTarget =
  /** What they want to build, in their words. */
  | { kind: "idea"; said: string }
  /** A product by name or App Store link; `mine`: they say it's theirs, so its reviews are its customers' words. */
  | { kind: "product"; name: string; app?: string; mine?: boolean };

export interface ScanRequest {
  target: ScanTarget;
  /** Which App Store to look in. */
  country: string;
}

export type ScanState = "reading" | "done" | "failed" | "stopped";

export interface ScanRead {
  title: string;
  origin: string;
  /** Reviews, a thread and a page are people speaking for themselves; an article is what's been published. */
  kind: "reviews" | "thread" | "page" | "article";
  sourceId?: string;
  quotes?: number;
  /** For reviews: how many the feed gave, and how many were kept to read. */
  reviews?: { read: number; kept: number };
}

/** What's known beside what people say: what another product offers or charges, or what a page published. */
export interface ScanKnown {
  kind: "product" | "published";
  /** The product it's about. */
  name?: string;
  text: string;
  title: string;
  url: string;
}

export interface ScanSession {
  v: 1;
  state: ScanState;
  at: number;
  target: ScanTarget;
  /** What it's doing, the newest last. */
  steps: string[];
  /** What people use today, found for an idea; each with the app found for it. */
  competitors: { name: string; app?: { id: string; name: string; url: string } }[];
  read: ScanRead[];
  /** Pages it didn't read, and why. */
  skipped: { reddit: number; before: number; articles: number; unreadable: number };
  /** The addresses it left, so what it tried can be said. */
  notRead?: { url: string; why: "reddit" | "before" | "article" | "unreadable" | "too many" }[];
  /** Quotes kept; Qalam AI's quotes code couldn't find; lines whose words didn't hold. */
  checked: { kept: number; notFound: number; unbacked: number };
  /** Read elsewhere, each with its page, to show beside the problems. */
  known?: ScanKnown[];
  /** The problem pages it went into. */
  problems: { id: string; title: string }[];
  /** Too little to go on: said so, never filled in. */
  thin: boolean;
  /** No web search here: only what code reads on its own. */
  noWeb?: true;
  error?: string;
}

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const isCountry = (v: unknown): v is string => typeof v === "string" && /^[a-z]{2}$/.test(v);

/** A request as it came in, or null when it says nothing to look at. */
export function scanRequest(raw: unknown): ScanRequest | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const t = r.target && typeof r.target === "object" ? (r.target as Record<string, unknown>) : {};
  const country = isCountry(r.country) ? r.country : "us";
  if (t.kind === "idea") {
    const said = clean(t.said, 2000);
    return said.length >= 3 ? { target: { kind: "idea", said }, country } : null;
  }
  if (t.kind === "product") {
    const name = clean(t.name, 200);
    const app = clean(t.app, 400);
    if (!name && !app) return null;
    return { target: { kind: "product", name, ...(app ? { app } : {}), ...(t.mine === true ? { mine: true } : {}) }, country };
  }
  return null;
}

/** The quotes of people speaking for themselves, which is what a scan's verdict goes by. */
export const peopleQuotes = (read: readonly Pick<ScanRead, "kind" | "quotes">[]) => read.reduce((n, r) => n + (r.kind === "article" ? 0 : (r.quotes ?? 0)), 0);

export const emptyScan = (target: ScanTarget, at: number): ScanSession => ({ v: 1, state: "reading", at, target, steps: ["Starting"], competitors: [], read: [], skipped: { reddit: 0, before: 0, articles: 0, unreadable: 0 }, checked: { kept: 0, notFound: 0, unbacked: 0 }, problems: [], thin: false });

/** At least this much, or the scan says it found little. */
export const SCAN_ENOUGH = { problems: 3, quotes: 10 } as const;

export const isThin = (problems: number, quotes: number) => problems < SCAN_ENOUGH.problems || quotes < SCAN_ENOUGH.quotes;

/** A session as read from its file; one still reading that nothing runs was stopped when the core did. */
export function scanOf(raw: unknown, running: boolean): ScanSession | null {
  const s = raw && typeof raw === "object" && (raw as ScanSession).v === 1 ? (raw as ScanSession) : null;
  if (!s) return null;
  return s.state === "reading" && !running ? { ...s, state: "failed", error: "It stopped before it finished: start it again." } : s;
}

const LIMITS = { searches: 3, searchWords: 6, searchChars: 80 } as const;

/** The searches Qalam AI wrote, as code will run them: a few words each, none twice. */
export function sanitizeSearches(raw: unknown, field: "searches" | "apps" = "searches"): string[] {
  const list = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[field] : null;
  const out: string[] = [];
  for (const x of Array.isArray(list) ? list : []) {
    const q = clean(x, LIMITS.searchChars).replace(/["“”]/g, "");
    if (!q || q.split(" ").length > LIMITS.searchWords || out.some((o) => o.toLowerCase() === q.toLowerCase())) continue;
    out.push(q);
    if (out.length >= LIMITS.searches) break;
  }
  return out;
}

/** The apps Qalam AI picked, only from those it was sent (a1, a2…), at most so many. */
export function sanitizeAppPicks<T>(raw: unknown, sent: readonly T[], max = 3): T[] {
  const list = raw && typeof raw === "object" ? (raw as { picks?: unknown }).picks : null;
  const out: T[] = [];
  for (const x of Array.isArray(list) ? list : []) {
    const m = typeof x === "string" ? /^a(\d{1,3})$/.exec(x.trim()) : null;
    const app = m ? sent[Number(m[1]) - 1] : undefined;
    if (app && !out.includes(app)) out.push(app);
    if (out.length >= max) break;
  }
  return out;
}
