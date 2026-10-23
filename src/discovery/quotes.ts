/*
 * Finding a quote word for word in a text (pure). Qalam AI quotes the builder's answers and their
 * sources (documents, pages, connected tools) as evidence; code only keeps a quote it finds in
 * what's quoted, and stores the source's own words, never the model's version of them. Matching
 * forgives what typing and models change without changing the words: letter case, curly quotes
 * and dashes, spacing, and Unicode forms (NFKC). A quote may leave words out with "…": each part
 * must then be in the text, in order, close together.
 */

const QUOTES = /[‘’‚‛′`´]/g;
const DQUOTES = /[“”„‟″«»]/g;
const DASHES = /[‐‑‒–—―−]/g;

/** `text` normalized for matching, and for each character of it the index of the original character it came from. */
export function normalizeForMatch(text: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let space = false;
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const width = ch.length;
    const n = ch.normalize("NFKC").replace(QUOTES, "'").replace(DQUOTES, '"').replace(DASHES, "-").replace(/…/g, "...").toLowerCase();
    if (/^\s+$/.test(n)) {
      // Runs of whitespace (and line breaks) count as one space.
      if (!space && norm.length) {
        norm += " ";
        map.push(i);
      }
      space = true;
    } else {
      space = false;
      // One map entry per UTF-16 unit of what was added (an emoji is two).
      norm += n;
      for (let k = 0; k < n.length; k++) map.push(i);
    }
    i += width;
  }
  // No trailing space.
  if (norm.endsWith(" ")) {
    norm = norm.slice(0, -1);
    map.pop();
  }
  return { norm, map };
}

/** A quote as models wrap it: quotation marks, an ellipsis at either end, stray punctuation. */
function trimQuote(q: string): string {
  return q
    .trim()
    .replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, "")
    .replace(/^(\.\.\.|…)\s*|\s*(\.\.\.|…)$/g, "")
    .trim();
}

/** Shortest quote worth keeping (shorter ones match by accident). */
export const MIN_QUOTE = 8;
/** Shortest part of a quote that leaves words out ("…"): shorter parts match by accident. */
export const MIN_PART = 5;
/** The most a quote may leave out between two of its parts, in characters of the text. */
export const MAX_GAP = 600;

/** Where a quote leaves words out: "…", "...", or either in brackets. */
const ELISION = /\s*(?:[[(]\s*(?:…|\.{3,})\s*[\])]|…|\.{3,})\s*/;

/** A quote found in a text. */
export interface QuoteMatch {
  /** [start, end) of the whole quote in the original text. */
  span: [number, number];
  /** The runs of words found, in order: one, or one per part of a quote that leaves words out. */
  parts: [number, number][];
  /** The text's own words for it (the parts joined by " … "): store these, not the quote. */
  words: string;
}

type Hay = { text: string; norm: string; map: number[] };

/** [start, end) in the original text of the normalized range [a, b). */
function original(hay: Hay, a: number, b: number): [number, number] {
  const last = hay.map[b - 1];
  // The end: past the whole last original character (a code point can be two units long).
  return [hay.map[a], last + String.fromCodePoint(hay.text.codePointAt(last)!).length];
}

function matchIn(hay: Hay, quote: string, min: number): QuoteMatch | null {
  const found = (parts: [number, number][]): QuoteMatch => {
    const spans = parts.map(([a, b]) => original(hay, a, b));
    return { span: [spans[0][0], spans[spans.length - 1][1]], parts: spans, words: spans.map(([a, b]) => hay.text.slice(a, b)).join(" … ") };
  };
  // As written first (its quotation marks, or an ellipsis, may be the source's own), then without the wrapping.
  for (const q of [quote.trim(), trimQuote(quote)]) {
    const needle = normalizeForMatch(q).norm;
    if (needle.length < min) continue;
    const at = hay.norm.indexOf(needle);
    if (at >= 0) return found([[at, at + needle.length]]);
  }
  // Words left out: each part in order, each close after the one before it.
  const segs = trimQuote(quote)
    .split(ELISION)
    .map((s) => normalizeForMatch(s).norm)
    .filter(Boolean);
  if (segs.length < 2 || segs.some((s) => s.length < MIN_PART)) return null;
  let budget = 2000;
  const from = (k: number, start: number, limit: number): [number, number][] | null => {
    for (let at = hay.norm.indexOf(segs[k], start); at >= 0 && at <= limit && budget-- > 0; at = hay.norm.indexOf(segs[k], at + 1)) {
      const end = at + segs[k].length;
      if (k === segs.length - 1) return [[at, end]];
      const rest = from(k + 1, end, end + MAX_GAP);
      if (rest) return [[at, end], ...rest];
    }
    return null;
  };
  const parts = from(0, 0, hay.norm.length);
  return parts ? found(parts) : null;
}

/** A finder for many quotes in one text (normalized once). `min` lowers the shortest match, for names. */
export function quoteFinder(text: string): (quote: string, min?: number) => QuoteMatch | null {
  const hay = { text, ...normalizeForMatch(text) };
  return (quote, min = MIN_QUOTE) => matchIn(hay, quote, min);
}

/**
 * Where `quote` appears in `text`, word for word, or null. A quote that leaves words out ("…") is
 * found part by part, in order, with at most MAX_GAP characters left out between two parts.
 */
export const findQuote = (text: string, quote: string): QuoteMatch | null => quoteFinder(text)(quote);

/**
 * Where `quote` appears in `text`, as [start, end) of the original text, or null. The words found
 * are `text.slice(start, end)` (or `verbatim`'s, for a quote that leaves words out): store those,
 * not the quote.
 */
export function findVerbatim(text: string, quote: string): [number, number] | null {
  return findQuote(text, quote)?.span ?? null;
}

/** The source's own words for a quote, or null when they aren't in it. */
export function verbatim(text: string, quote: string): string | null {
  return findQuote(text, quote)?.words ?? null;
}

/**
 * Numbers someone wrote, as values: "1.2", "1,200", "20%", "3.5k", "1.5m" (k and m multiply).
 * Used to check that a metric's numbers came from the builder's own answer.
 */
export function numbersIn(text: string): number[] {
  const out: number[] = [];
  const re = /(\d+(?:[.,]\d+)*)\s*(k|m|bn|%)?(?![a-z])/gi;
  for (const m of text.matchAll(re)) {
    const raw = m[1];
    // "1,200" is a thousands separator; "1,5" (one decimal place) reads as a decimal comma.
    const value = /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw) ? Number(raw.replace(/,/g, "")) : Number(raw.replace(",", "."));
    if (!Number.isFinite(value)) continue;
    const unit = m[2]?.toLowerCase();
    out.push(unit === "k" ? value * 1000 : unit === "m" ? value * 1_000_000 : unit === "bn" ? value * 1_000_000_000 : value);
  }
  return out;
}

/** Whether `value` is one of the numbers in `text` (within rounding). */
export function mentions(text: string, value: number): boolean {
  return numbersIn(text).some((v) => Math.abs(v - value) <= Math.max(1e-9, Math.abs(value) * 1e-6));
}
