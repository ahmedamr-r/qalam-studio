import { dot, mmr, rrf, scoped, TIER_WEIGHT, type RankedList, type Tier } from "@/hub/fuse";
import { pack, tokensOf, type Packed } from "@/hub/pack";
import { searchText } from "@/hub/pieces";
import { ftsQuery } from "@/hub/words";
import { topicsOf, type OrgIndex, type PieceRow } from "./indexer";

/**
 * Finding what the organization knows about something: words (BM25), meaning (vectors) and links
 * (what's near the card in hand) each give a ranked list; rank fusion merges them, the scope
 * puts what's linked and same-product first. `packFor` turns the result into a budget for a model
 * call. Each step is measured on the eval set (pnpm eval:retrieval).
 */

export interface SearchOpts {
  query: string;
  /** The card in hand (its ref): what's linked to it comes first. */
  anchor?: string;
  /** The product in hand (null: the whole organization; absent: no product in hand). */
  product?: string | null;
  limit?: number;
  /**
   * Which steps run: words, meaning and links by default. The reranker (jina-reranker-v1-tiny) and
   * keeping results varied made the eval set's results worse, so they run only when asked.
   */
  use?: Partial<Record<"words" | "meaning" | "links" | "rerank" | "varied", boolean>>;
}

export interface Hit extends PieceRow {
  score: number;
  tier: Tier;
  /** Its rank in each list that found it. */
  ranks: Record<string, number>;
}

/** Two pieces this near in meaning say the same thing: the second waits behind something different. */
const NEAR_COPY = 0.85;

/** How strongly a link ties two pieces, by kind. */
const LINK_WEIGHT: Record<string, number> = { backs: 1, against: 1, of: 0.9, about: 0.8, shows: 0.8, under: 0.6, in: 0.2 };
const isEntity = (ref: string) => ref.startsWith("hub:source:") || ref.startsWith("hub:board:");

/** Pieces near a card by its links, nearest first; `direct` are one link away. */
export function nearby(index: OrgIndex, anchor: string, depth = 2): { refs: string[]; direct: Set<string> } {
  const best = new Map<string, number>([[anchor, 1]]);
  const direct = new Set<string>();
  let frontier = [anchor];
  for (let d = 1; d <= depth; d++) {
    const next: string[] = [];
    for (const ref of frontier)
      for (const l of index.links(ref)) {
        // A source or board ties together everything in it: it's not a way between two pieces.
        if (isEntity(l.ref)) continue;
        const s = best.get(ref)! * (LINK_WEIGHT[l.kind] ?? 0.3) * (d === 1 ? 1 : 0.5);
        if (d === 1) direct.add(l.ref);
        if (s > (best.get(l.ref) ?? 0)) {
          if (!best.has(l.ref)) next.push(l.ref);
          best.set(l.ref, s);
        }
      }
    frontier = next;
  }
  return { refs: [...best].sort((a, b) => b[1] - a[1]).map(([r]) => r), direct };
}

export async function search(index: OrgIndex, o: SearchOpts): Promise<{ hits: Hit[]; used: string[] }> {
  const use = { words: true, meaning: true, links: true, rerank: false, varied: false, ...o.use };
  const limit = o.limit ?? 20;
  const lists: RankedList[] = [];
  const used: string[] = [];
  const q = o.query.trim();
  const fts = use.words && q ? ftsQuery(q) : null;
  if (fts) {
    lists.push({ name: "words", refs: index.words(fts) });
    used.push("words");
  }
  if (use.meaning && q && index.models && index.status().vectors > 0) {
    try {
      const [v] = await index.models.embed([q], "query");
      lists.push({ name: "meaning", refs: index.nearest(v, 50, index.models.minSimilarity).map((x) => x.ref) });
      used.push("meaning");
    } catch {
      // The models can't run now: words and links answer.
    }
  }
  let direct = new Set<string>();
  if (use.links && o.anchor) {
    const n = nearby(index, o.anchor);
    direct = n.direct;
    lists.push({ name: "links", refs: n.refs });
    used.push("links");
  }
  const fused = rrf(lists);
  const rows = index.piecesByRef(fused.map((f) => f.ref));
  let ranked: Hit[] = scoped(fused, (r) => rows.get(r), { product: o.product, linked: direct }).map((f) => ({ ...rows.get(f.ref)!, score: f.score, tier: f.tier, ranks: f.ranks }));

  if (use.rerank && q && index.models && ranked.length > 1) {
    const top = ranked.slice(0, 40);
    try {
      const scores = await index.models.rank(
        q,
        top.map((h) => searchText(h, topicsOf(h))),
      );
      const reranked = top.map((h, i) => ({ ...h, score: scores[i] * TIER_WEIGHT[h.tier] })).sort((a, b) => b.score - a.score);
      ranked = [...reranked, ...ranked.slice(40)];
      used.push("rerank");
    } catch {
      // No reranker now: the fused order stands.
    }
  }

  if (use.varied && ranked.length > limit) {
    // Near copies only (five people saying the same thing in nearly the same words). Off by
    // default: pieces about the same card share their topics in meaning search, so they look
    // nearer than they are; telling copies apart needs vectors of the words alone.
    const pool = ranked.slice(0, Math.max(limit * 3, 30));
    const vecs = index.vectorsOf(pool.map((h) => h.ref));
    if (vecs.size) {
      const like = (a: Hit, b: Hit) => {
        const va = vecs.get(a.ref);
        const vb = vecs.get(b.ref);
        const s = va && vb ? dot(va, vb) : 0;
        return s >= NEAR_COPY ? s : 0;
      };
      ranked = [...mmr(pool, (h) => h.score, like, limit), ...ranked.slice(pool.length)];
    }
  }
  return { hits: ranked.slice(0, limit), used };
}

/**
 * The best hits, then what's one link from the strongest of them (a need's quotes, a quote's card,
 * a card's evidence) that search didn't rank: a call gets the pieces around what it's about. Kept
 * behind the top ten, so it widens a pack without reordering the best of a search (measured on the
 * eval set: more of what answers fits a pack; ranked in, they pushed better hits down).
 */
export function withNeighbours<T extends PieceRow>(index: OrgIndex, hits: T[], seeds = 5, after = 10): PieceRow[] {
  const have = new Set(hits.map((h) => h.ref));
  const near = new Map<string, number>();
  hits.slice(0, seeds).forEach((h, i) => {
    for (const l of index.links(h.ref)) {
      if (have.has(l.ref) || isEntity(l.ref) || l.kind === "under") continue;
      const v = (LINK_WEIGHT[l.kind] ?? 0.3) / (i + 1);
      if (v > (near.get(l.ref) ?? 0)) near.set(l.ref, v);
    }
  });
  const rows = index.piecesByRef([...near].sort((a, b) => b[1] - a[1]).map(([r]) => r));
  return [...hits.slice(0, after), ...rows.values(), ...hits.slice(after)];
}

export interface PackOpts extends SearchOpts {
  budget: number;
  wholeTop?: number;
  /** Only pieces of these types. */
  types?: string[];
  /** Pieces the call already carries (the board's own cards, the quotes it sends): left out. */
  exclude?: string[];
}

/** The organization's knowledge for one model call, within `budget` tokens (everything, when it all fits). */
export async function packFor(index: OrgIndex, o: PackOpts): Promise<Packed & { used: string[]; rows: PieceRow[] }> {
  const types = o.types?.length ? new Set(o.types) : null;
  const out = new Set(o.exclude ?? []);
  const keep = (p: PieceRow) => (!types || types.has(p.type)) && !out.has(p.ref);
  const { hits, used } = await search(index, { ...o, limit: o.limit ?? 120 });
  let list: PieceRow[] = withNeighbours(index, hits).filter(keep);
  const all = (index.db.prepare("select * from pieces order by at desc").all() as unknown as PieceRow[]).filter(keep);
  const whole = all.reduce((s, p) => s + tokensOf(searchText(p, topicsOf(p))) + 8, 0);
  if (whole <= o.budget) {
    // It all fits: what was found first, then the rest, newest first.
    const seen = new Set(list.map((h) => h.ref));
    list = [...list, ...all.filter((p) => !seen.has(p.ref))];
  }
  const packed = pack(
    list.map((p) => ({ ref: p.ref, text: p.text, line: p.line, topics: topicsOf(p) })),
    { budget: o.budget, wholeTop: o.wholeTop },
  );
  const byRef = new Map(list.map((p) => [p.ref, p]));
  return { ...packed, used, rows: packed.items.map((i) => byRef.get(i.ref)!) };
}
