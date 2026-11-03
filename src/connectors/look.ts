import type { Hit } from "./recipes";

/*
 * What code keeps of Qalam AI looking inside a tool (pure): its searches, cut to size, and its picks,
 * only as results it was sent, with a reason only where its numbers are in the result's own words.
 */

export type LookedHit = Hit & { why?: string };

const MAX_SEARCHES = 3;
const MAX_PICKS = 6;

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const one = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");

/** The searches to run: its own, each once, else what the person wrote. */
export function sanitizeSearches(raw: unknown, about: string): string[] {
  const list = rec(raw).searches;
  const seen = new Set<string>();
  const kept = (Array.isArray(list) ? list : [])
    .map((s) => one(s).slice(0, 80))
    .filter((s) => {
      const key = s.toLowerCase();
      if (s.length < 2 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_SEARCHES);
  return kept.length ? kept : [one(about).slice(0, 80)];
}

/** The picks, by the ids sent (h1 is the first result), each once. */
export function sanitizePicks(raw: unknown, sent: readonly Hit[]): LookedHit[] {
  const list = rec(raw).picks;
  const seen = new Set<number>();
  return (Array.isArray(list) ? list : []).flatMap((p): LookedHit[] => {
    const i = Number(/^h(\d+)$/.exec(one(rec(p).id))?.[1]) - 1;
    const hit = sent[i];
    if (!hit || seen.has(i) || seen.size >= MAX_PICKS) return [];
    seen.add(i);
    const why = one(rec(p).why).slice(0, 120);
    const known = `${hit.title} ${hit.snippet ?? ""}`;
    const holds = (why.match(/\d+(?:[.,]\d+)*/g) ?? []).every((n) => known.includes(n));
    return [{ ...hit, ...(why && holds ? { why } : {}) }];
  });
}
