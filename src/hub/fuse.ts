/**
 * Putting search results together (pure). Word, meaning and link searches each rank pieces their
 * own way; reciprocal rank fusion merges the lists by rank alone (k = 60), so their scores never
 * need to be comparable. Then where a piece sits counts: linked to the card in hand first, the
 * same product next, the whole organization after, another product's only on a strong match.
 * Last, maximal marginal relevance keeps the result varied (not five quotes of one person).
 */

export interface RankedList {
  name: string;
  /** Best first. */
  refs: string[];
  weight?: number;
}

export interface Fused {
  ref: string;
  score: number;
  /** Its rank in each list that has it (1-based). */
  ranks: Record<string, number>;
}

export const RRF_K = 60;

export function rrf(lists: RankedList[], k = RRF_K): Fused[] {
  const out = new Map<string, Fused>();
  for (const l of lists)
    l.refs.forEach((ref, i) => {
      const f = out.get(ref) ?? { ref, score: 0, ranks: {} };
      if (f.ranks[l.name]) return;
      f.score += (l.weight ?? 1) / (k + i + 1);
      f.ranks[l.name] = i + 1;
      out.set(ref, f);
    });
  return [...out.values()].sort((a, b) => b.score - a.score);
}

export type Tier = "linked" | "product" | "org" | "other";

export interface Scope {
  /** The product in hand (null: the whole organization; absent: no product in hand). */
  product?: string | null;
  /** Pieces linked to the card in hand. */
  linked?: ReadonlySet<string>;
}

export function tierOf(p: { ref: string; product: string | null }, s: Scope): Tier {
  if (s.linked?.has(p.ref)) return "linked";
  if (s.product === undefined || p.product === s.product) return "product";
  return p.product === null ? "org" : "other";
}

export const TIER_WEIGHT: Record<Tier, number> = { linked: 1.6, product: 1, org: 0.85, other: 0.45 };

/** Another product's pieces are kept only when a list ranked them this high. */
export const STRONG_RANK = 3;

/** Scores with the scope applied; another product's weak matches are left out. */
export function scoped<T extends Fused>(list: T[], piece: (ref: string) => { product: string | null } | undefined, s: Scope): (T & { tier: Tier })[] {
  const out: (T & { tier: Tier })[] = [];
  for (const f of list) {
    const p = piece(f.ref);
    if (!p) continue;
    const tier = tierOf({ ref: f.ref, product: p.product }, s);
    if (tier === "other" && !Object.values(f.ranks).some((r) => r <= STRONG_RANK)) continue;
    out.push({ ...f, score: f.score * TIER_WEIGHT[tier], tier });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Pick `n` that are relevant and unlike each other: each next pick is the best of
 * lambda·relevance − (1 − lambda)·its likeness to what's picked (relevance scaled to 0…1).
 */
export function mmr<T>(items: T[], score: (t: T) => number, like: (a: T, b: T) => number, n: number, lambda = 0.75): T[] {
  const top = Math.max(...items.map(score), 1e-9);
  const left = [...items];
  const picked: T[] = [];
  while (picked.length < n && left.length) {
    let best = 0;
    let bestValue = -Infinity;
    left.forEach((c, i) => {
      const sim = picked.length ? Math.max(...picked.map((p) => like(c, p))) : 0;
      const value = lambda * (score(c) / top) - (1 - lambda) * sim;
      if (value > bestValue) (bestValue = value), (best = i);
    });
    picked.push(left.splice(best, 1)[0]);
  }
  return picked;
}

/** Cosine of two unit vectors. */
export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
