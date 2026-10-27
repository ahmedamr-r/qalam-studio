import { normalizeForMatch } from "@/discovery/quotes";

/**
 * Words for search. Text is folded the way quotes are matched (case, width, accents, Arabic letter
 * forms, quote marks), so "café" finds "cafe" and أ finds ا. The index keeps folded text; a query
 * is folded the same way, and each of its words is quoted, so nothing typed is read as FTS syntax.
 */
export const fold = (text: string) => normalizeForMatch(text).norm;

const STOP = new Set(
  "a about after all also am an and any are as at be been but by can could did do does for from had has have how i if in into is it its just me more most my no not of on or our out so some than that the their them then there these they this those to too up us very was we were what when where which who whom why will with would you your".split(" "),
);

/** The words of `q` worth looking for, folded (common words left out). */
export function queryWords(q: string, max = 24): string[] {
  const words = fold(q).match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter((w) => !STOP.has(w) && (w.length > 1 || /\p{N}/u.test(w))))].slice(0, max);
}

/** An FTS5 query matching any of the words of `q`, or null when nothing is left to look for. */
export function ftsQuery(q: string, max = 24): string | null {
  const words = queryWords(q, max);
  return words.length ? words.map((w) => `"${w.replace(/"/g, '""')}"`).join(" OR ") : null;
}
