import { isOstCard, treeBounds, visibleCards } from "@/doc/board";
import { worldBounds } from "@/doc/geometry";
import type { Doc } from "@/doc/schema";
import type { SetupDoc } from "@/org/setup";
import { SOURCE } from "./look";
import { markOf, partLine, partOf, sourceLine } from "./origin";
import { fromSource, quoteOf, type SourceRecord } from "./sources";

/*
 * A board's sources lane (pure): left of each tree, the sources its cards' evidence comes from,
 * each wired to the cards it backs, every wire carrying the quotes behind it. Worked out from the
 * cards as they are, so every board has one and nothing is kept for it. A brain dump the setup read
 * shows as its parts (their own words, each doc they brought), a quote in the part its span starts
 * in. The lane's rows follow the cards: each source sits level with the middle of what it backs,
 * then they're spaced so none overlap. Sizes are code's.
 *
 * Each source is drawn as ./look.ts says a source looks (`SOURCE`): a tile with its mark and a port,
 * its title and where it's from under it. A feed watching for the tree's cards (a connector's saved
 * search, src/feeds/feeds.ts) sits in the same column, its cords to them dashed (`FEED`). A brief
 * written for a card looks the same and hangs under that card (`LaneBrief`).
 */

/** An item's width: its words', the tile centred over them. */
export const LANE_W = SOURCE.w;
export const LANE_TILE = SOURCE.tile;
/** The tile, then up to two lines of its name and one of where it's from. */
export const LANE_ITEM_H = SOURCE.h;
/** From the lane's right edge to the tree's left. */
export const LANE_GAP = 72;
export const LANE_ROW_GAP = 16;

type LaneSource = Pick<SourceRecord, "id" | "title" | "kind" | "origin" | "quotes" | "pages" | "setup"> & Partial<Pick<SourceRecord, "image" | "screen">>;

export interface LaneItem {
  /** One per tree and source (or dump part). */
  key: string;
  root: string;
  sourceId: string;
  /** A setup dump's part (their words, a doc). */
  part?: SetupDoc;
  title: string;
  /** Its mark: a connector's id, "said", "page", "computer", or the source's kind. */
  mark: string;
  /** "Google Drive · Doc", "Interview", "Your words". */
  line: string;
  quotes: string[];
  cards: string[];
  /** A feed (a connector's saved search) watching for these cards, not a source: what's new for it, and whether it stopped. */
  feed?: { id: string; fresh?: number; off?: boolean };
  /** A brief written for this card, not a source: what came out of it, under it on the canvas. */
  brief?: { id: string; card: string };
  /** A screenshot of their product kept as one of its screens: drawn in its tile ("asset:<hash>"). */
  shot?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LaneEdge {
  id: string;
  /** A lane item, or for `helps` a solution's card. */
  from: string;
  /** A card. */
  to: string;
  quotes: string[];
  /** A feed's: it watches for the card, its words aren't on it (drawn dashed). A brief's: it was written from the card, down to its tile. A solution's up to another problem it helps (./helps.ts). */
  kind?: "feed" | "brief" | "helps";
}

/** A feed as the lane draws it (src/feeds/feeds.ts): its name, its tool's mark, and the cards on this board it's wired to. */
export interface LaneFeed {
  id: string;
  title: string;
  /** Its connector's id (its logo). */
  mark: string;
  /** "Intercom · 6 new", "Slack · watching". */
  line: string;
  cards: string[];
  fresh?: number;
  off?: boolean;
}

/** A brief as the lane draws it (src/discovery/brief.ts): where its tile goes is the layout's. */
export interface LaneBrief {
  id: string;
  card: string;
  title: string;
  line: string;
  x: number;
  y: number;
}

export interface Lane {
  items: LaneItem[];
  edges: LaneEdge[];
}

export const NO_LANE: Lane = { items: [], edges: [] };

/**
 * The cards one lane serves, and where it goes: a board's are its trees (each tree's cards, the
 * lane left of the tree); the space's map gives each goal its own cards, and the column its layout
 * kept for the lane (`x`), whose rows start no higher than `top`.
 */
export interface LaneGroup {
  head: string;
  cards: string[];
  x?: number;
  top?: number;
}

/** Their own words are titled by how they begin. */
function partTitle(source: LaneSource, part: SetupDoc): string {
  if (part.from !== "said" || !part.span) return part.title;
  return (source as { text?: string }).text?.slice(part.span[0], part.span[1]).replace(/\s+/g, " ").trim().slice(0, 120) || part.title;
}

export function laneOf(doc: Doc, sources: readonly (LaneSource & { text?: string })[], groups?: readonly LaneGroup[], feeds: readonly LaneFeed[] = [], briefs: readonly LaneBrief[] = []): Lane {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const items: LaneItem[] = [];
  const edges: LaneEdge[] = [];
  const lanes = groups ?? doc.roots.filter((id) => isOstCard(doc.nodes[id])).map((id): LaneGroup => ({ head: id, cards: visibleCards(doc, id) }));
  for (const { head: root, cards, x: column, top } of lanes) {
    // Each card's quotes, by the source (or dump part) they're from.
    const found = new Map<string, Omit<LaneItem, "x" | "y" | "w" | "h"> & { at: number[] }>();
    for (const id of cards) {
      if (!doc.nodes[id]?.visible) continue;
      const card = doc.nodes[id].meta.ost!;
      const box = worldBounds(doc, id);
      for (const e of card.evidence) {
        // Words from a source, or a screen Qalam AI saw something on: both wire their source in.
        if (!(fromSource(e) || e.kind === "screen") || !e.sourceId) continue;
        const source = byId.get(e.sourceId);
        if (!source) continue;
        const q = quoteOf(source, e);
        const span = q?.span ?? e.span;
        const parts = source.setup?.docs?.length ? source.setup.docs : null;
        const pi = parts && span ? partOf(parts, { span }) : -1;
        const part = parts && pi >= 0 ? parts[pi] : undefined;
        const key = `${root}:${source.id}${part ? `#${pi}` : ""}`;
        let it = found.get(key);
        if (!it) {
          // A screen of theirs shows its picture in its tile, named for the screen it is.
          const shot = source.screen && source.image?.asset ? `asset:${source.image.asset}` : undefined;
          it = { key, root, sourceId: source.id, ...(part ? { part } : {}), title: part ? partTitle(source, part) : source.title, mark: markOf(source, part), line: part ? partLine(part) : shot ? "Your screen" : sourceLine(source), ...(shot ? { shot } : {}), quotes: [], cards: [], at: [] };
          found.set(key, it);
        }
        if (q && !it.quotes.includes(q.id)) it.quotes.push(q.id);
        if (!it.cards.includes(id)) {
          it.cards.push(id);
          it.at.push(box.y + box.h / 2);
        }
        const edgeId = `${key}>${id}`;
        const edge = edges.find((x) => x.id === edgeId);
        if (edge) {
          if (q && !edge.quotes.includes(q.id)) edge.quotes.push(q.id);
        } else edges.push({ id: edgeId, from: key, to: id, quotes: q ? [q.id] : [] });
      }
    }
    // The feeds watching for this tree's cards: a tile each, a dashed cord to every card it's wired to.
    const here = new Set(cards);
    for (const f of feeds) {
      const mine = f.cards.filter((id) => here.has(id) && doc.nodes[id]?.visible !== false && doc.nodes[id]);
      if (!mine.length) continue;
      const key = `${root}:feed:${f.id}`;
      found.set(key, { key, root, sourceId: "", title: f.title, mark: f.mark, line: f.line, quotes: [], cards: mine, feed: { id: f.id, ...(f.fresh !== undefined ? { fresh: f.fresh } : {}), ...(f.off ? { off: true } : {}) }, at: mine.map((id) => { const b = worldBounds(doc, id); return b.y + b.h / 2; }) });
      for (const id of mine) edges.push({ id: `${key}>${id}`, from: key, to: id, quotes: [], kind: "feed" });
    }
    if (!found.size) continue;
    // Each tile level with what it backs, in that order, spaced so none overlap.
    const x = column ?? treeBounds(doc, root).x - LANE_GAP - LANE_W;
    const rows = [...found.values()].map((it) => ({ it, want: it.at.reduce((a, b) => a + b, 0) / it.at.length - LANE_TILE / 2 })).sort((a, b) => a.want - b.want);
    let next = top ?? -Infinity;
    for (const { it, want } of rows) {
      const y = Math.max(want, next);
      next = y + LANE_ITEM_H + LANE_ROW_GAP;
      const { at: _at, ...rest } = it;
      items.push({ ...rest, x, y, w: LANE_W, h: LANE_ITEM_H });
    }
  }
  // A brief's tile under its card, wired down from it: what came out of the card, where the lane's tiles are what went in.
  for (const b of briefs) {
    if (!doc.nodes[b.card]?.visible) continue;
    const key = `brief:${b.id}`;
    items.push({ key, root: b.card, sourceId: "", title: b.title, mark: "brief", line: b.line, quotes: [], cards: [b.card], brief: { id: b.id, card: b.card }, x: b.x, y: b.y, w: LANE_W, h: LANE_ITEM_H });
    edges.push({ id: `${key}>${b.card}`, from: key, to: b.card, quotes: [], kind: "brief" });
  }
  return { items, edges };
}

/** The "also helps" wires a hovered card lights: hovering lights only these, where picking a card lights all its wires. */
export function litByHelps(lane: Lane, id: string | null): Set<string> {
  return new Set(id ? lane.edges.filter((e) => e.kind === "helps" && (e.from === id || e.to === id)).map((e) => e.id) : []);
}

/** What a lane item or a card lights: the wires through it and what's at their other ends. */
export function litBy(lane: Lane, id: string | null): { items: Set<string>; cards: Set<string>; edges: Set<string> } | null {
  if (!id) return null;
  const edges = lane.edges.filter((e) => e.from === id || e.to === id);
  if (!edges.length) return null;
  return { items: new Set(edges.map((e) => e.from)), cards: new Set(edges.map((e) => e.to)), edges: new Set(edges.map((e) => e.id)) };
}
