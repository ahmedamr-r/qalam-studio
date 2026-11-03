import { backingWords, pieceBasis, type BasisCounts } from "@/discovery/basis";
import { isEvidence, isOnline, type Topic } from "./topics";

/*
 * What to work on next (pure): the organization's needs, ranked by what backs them. A need page's
 * strength is the evidence its "We know" lines cite (what people said, what's measured or studied,
 * finished tests; never the team's own brain dump): how many sources it comes from, then how many
 * points, then how new. What people said online (public posts, reviews) and what's read elsewhere
 * count after that, and on their own leave a need Assumed. Each need also carries who raises it (segment pages citing the same evidence), how
 * that evidence arrived week by week, what speaks against it, and the boards that have it.
 */

/** What the index knows of a piece a page cites (a piece not in it is gone). */
export interface PieceFacts {
  type: string;
  sub: string | null;
  source: string | null;
  stage: string | null;
  at: number;
}

/** A card on a board that rests on a page's pieces (`shared`: how many), or is named like it (0). */
export interface ShownOn {
  ref: string;
  board: string;
  card: string;
  kind: string;
  shared: number;
}

export interface NeedEvidence {
  /** Evidence its "We know" lines cite. */
  quotes: Set<string>;
  /** Where those came from (a source, or the piece itself when it has none). */
  sources: Set<string>;
  /** Evidence its "Against" lines, or what's disputed on it, cite. */
  against: Set<string>;
  /** The newest of those lines and pieces. */
  newest: number;
  /** When each quote was picked out (once each). */
  ats: number[];
  /** People online's words its "We know" or "We believe" lines cite, and the posts they're in. */
  online: Set<string>;
  onlineSources: Set<string>;
  /** What's read elsewhere its "We know" or "We believe" lines cite. */
  read: Set<string>;
  /** What backs it (`quotes`), by what each rests on. */
  mix: BasisCounts;
}

export function needEvidence(t: Pick<Topic, "lines">, pieces: Map<string, PieceFacts>): NeedEvidence {
  const quotes = new Set<string>();
  const sources = new Set<string>();
  const against = new Set<string>();
  const online = new Set<string>();
  const onlineSources = new Set<string>();
  const read = new Set<string>();
  const mix: BasisCounts = {};
  const ats: number[] = [];
  let newest = 0;
  const evidence = (ref: string) => {
    const p = pieces.get(ref);
    return p && isEvidence(p) ? p : null;
  };
  for (const l of t.lines) {
    for (const d of l.disputes ?? []) for (const ref of d.cites) if (evidence(ref)) against.add(ref);
    if (l.section === "against") for (const ref of l.cites) if (evidence(ref)) against.add(ref);
    // A line resting on people online alone is something "We believe".
    if (l.section === "know" || l.section === "believe")
      for (const ref of l.cites) {
        const p = pieces.get(ref);
        if (p?.type === "quote" && pieceBasis(p) === "read" && !isOnline(p)) read.add(ref);
        if (!p || !isOnline(p)) continue;
        online.add(ref);
        onlineSources.add(p.source ?? ref);
      }
    if (l.section !== "know") continue;
    for (const ref of l.cites) {
      const p = evidence(ref);
      if (!p) continue;
      if (!quotes.has(ref)) {
        ats.push(p.at);
        // A test's result counts as what's studied; a card's own quote as what people said.
        const b = p.type === "card" ? "studied" : p.type === "quote" ? pieceBasis(p) : "said";
        mix[b] = (mix[b] ?? 0) + 1;
      }
      quotes.add(ref);
      sources.add(p.source ?? ref);
      newest = Math.max(newest, l.at, p.at);
    }
  }
  return { quotes, sources, against, newest, ats, online, onlineSources, read, mix };
}

export interface RankedNeed {
  topic: string;
  title: string;
  /** The products it's about (none: the whole organization). */
  products: string[];
  quotes: number;
  sources: number;
  /** `quotes`, by what each rests on (none: all what people said). */
  mix?: BasisCounts;
  /** What's read elsewhere behind it. */
  read?: number;
  against: number;
  /** People online's words behind it (public posts, reviews), and how many posts. */
  online: number;
  onlineSources: number;
  /** The kinds of customer whose pages cite the same evidence. */
  segments: { id: string; title: string }[];
  /** Quotes picked out each week, oldest first; the last is the week to `now`. */
  weeks: number[];
  /** The boards that have it: the card on each that rests on most of its pieces. */
  boards: { board: string; card: string; kind: string; shared: number }[];
  newest: number;
}

export interface NeedInput {
  now: number;
  topics: Topic[];
  pieces: Map<string, PieceFacts>;
  /** The cards on boards that rest on each page's pieces, by page. */
  shows: Map<string, ShownOn[]>;
}

export const NEED_WEEKS = 8;
const WEEK = 7 * 86_400_000;

/** How many of these times fall in each of the last `weeks` weeks, oldest first (a future time counts as this week). */
export function weeklyCounts(ats: number[], now: number, weeks = NEED_WEEKS): number[] {
  const out = new Array<number>(weeks).fill(0);
  for (const at of ats) {
    const i = weeks - 1 - Math.floor(Math.max(0, now - at) / WEEK);
    if (i >= 0) out[i]++;
  }
  return out;
}

/** One need page, summed up. */
export function needSummary(t: Topic, x: NeedInput): RankedNeed {
  const e = needEvidence(t, x.pieces);
  const segments = x.topics.filter((s) => s.kind === "segment" && s.lines.some((l) => l.cites.some((c) => e.quotes.has(c)))).map((s) => ({ id: s.id, title: s.title }));
  const best = new Map<string, ShownOn>();
  for (const s of x.shows.get(t.id) ?? []) if ((best.get(s.board)?.shared ?? -1) < s.shared) best.set(s.board, s);
  return {
    topic: t.id,
    title: t.title,
    products: t.products,
    quotes: e.quotes.size,
    sources: e.sources.size,
    mix: e.mix,
    ...(e.read.size ? { read: e.read.size } : {}),
    against: e.against.size,
    online: e.online.size,
    onlineSources: e.onlineSources.size,
    segments,
    weeks: weeklyCounts(e.ats, x.now),
    boards: [...best.values()].map(({ board, card, kind, shared }) => ({ board, card, kind, shared })),
    newest: e.newest || t.updatedAt,
  };
}

/** Every need page, the best-backed first: by its customers' sources, then quotes, then people online's posts and quotes, then newest. */
export function rankNeeds(x: NeedInput): RankedNeed[] {
  return x.topics
    .filter((t) => t.kind === "need")
    .map((t) => needSummary(t, x))
    .sort((a, b) => b.sources - a.sources || b.quotes - a.quotes || b.onlineSources - a.onlineSources || b.online - a.online || (b.read ?? 0) - (a.read ?? 0) || b.newest - a.newest || a.title.localeCompare(b.title));
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** What backs a need, in a line: "2 quotes · 1 measured · 3 sources", what only people online say, or that nothing outside the team does yet. */
export const needLine = (n: Pick<RankedNeed, "quotes" | "sources" | "mix"> & Partial<Pick<RankedNeed, "online" | "onlineSources">>) =>
  n.quotes ? `${backingWords(n.mix ?? { said: n.quotes })} · ${plural(n.sources, "source")}` : n.online ? `${plural(n.online, "quote")} from people online · ${plural(n.onlineSources ?? 1, "source")}` : "Nothing outside the team yet";

/** Only what people said behind it: "customers keep raising it" says what's so. */
export const onlyPeopleSaid = (mix: BasisCounts | undefined) => !mix || Object.keys(mix).every((b) => b === "said");

export type Strength = "strong" | "growing" | "thin" | "assumed";

/** How strong a need's backing is, in a word: by how many sources its evidence comes from. */
export const strengthOf = (n: Pick<RankedNeed, "sources" | "quotes">): Strength => (!n.quotes ? "assumed" : n.sources >= 3 ? "strong" : n.sources === 2 ? "growing" : "thin");

/** How full a need's meter is: four sources or more fill it. */
export const strengthFill = (n: Pick<RankedNeed, "sources">) => Math.min(1, n.sources / 4);
