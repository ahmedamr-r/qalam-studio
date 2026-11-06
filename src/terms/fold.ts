import type { Terms } from "./types";

/*
 * The project's words when comparing titles and reading what someone wrote (pure): a word the project
 * says to avoid stands for its term, so "Cart abandonment" and "Basket abandonment" read as the same
 * problem, and someone writing "cart" can be asked whether they mean the basket.
 */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const one = (s: string) => s.replace(/\s+/g, " ").trim();

/** Each avoided word with its term, longest first, so a phrase wins over a word inside it. */
function pairs(t: Terms): [string, string][] {
  const out = new Map<string, string>();
  for (const x of t.terms) for (const a of x.avoid) if (a.trim() && !out.has(a.toLowerCase())) out.set(one(a).toLowerCase(), x.term);
  return [...out].sort((a, b) => b[0].length - a[0].length);
}

/** A whole word or phrase, any case, with a plural's s. */
const wordsRe = (words: readonly string[]) => new RegExp(`(?<![\\p{L}\\p{N}])(${words.map((w) => escape(w).replace(/\\? /g, "\\s+")).join("|")})(e?s)?(?![\\p{L}\\p{N}])`, "giu");

/** A function that writes each avoided word as its term (whole words only), for comparing titles. With no words to avoid, it changes nothing. */
export function termsFold(t: Terms | null | undefined): (s: string) => string {
  const list = t ? pairs(t) : [];
  if (!list.length) return (s) => s;
  const to = new Map(list);
  const re = wordsRe(list.map(([w]) => w));
  return (s) => s.replace(re, (_, w: string, plural?: string) => `${to.get(one(w).toLowerCase()) ?? w}${plural ? "s" : ""}`);
}

/** The words to avoid in what someone wrote, each with the term the project uses for it (once per term). */
export function clashes(t: Terms | null | undefined, said: string): { word: string; term: string }[] {
  const list = t ? pairs(t) : [];
  if (!list.length || !said.trim()) return [];
  const to = new Map(list);
  const out = new Map<string, { word: string; term: string }>();
  for (const m of said.matchAll(wordsRe(list.map(([w]) => w)))) {
    const term = to.get(one(m[1]).toLowerCase());
    if (term && !out.has(term)) out.set(term, { word: one(m[0]), term });
  }
  return [...out.values()];
}
