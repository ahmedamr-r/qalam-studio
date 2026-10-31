import type { SourceQuote } from "@/discovery/sources";
import type { ShapedGoal } from "@/goals/outline";
import { partOf } from "@/discovery/origin";
import { CARD_LOOK, FOOTER, SOURCE } from "@/discovery/look";
import { titleProps } from "@/discovery/metrics";
import type { GoalTree } from "@/goals/types";
import { lineGoalId, type SetupDoc, type SetupSession } from "@/org/setup";
import { isProblem, setupGroups } from "@/org/setup-groups";
import { placeKey, placeLine, type Place } from "./places";

export { isProblem, partOf };

/*
 * The setup's canvas as data (pure): what was sent on the left, the problems and goals Qalam AI found
 * in it to the right, and a wire from each source to what it backs, carrying the ids of the quotes
 * behind it, so the reader can mark exactly those words. Worked out from what's kept (the setup's
 * session and its source's quotes, the know door's goals, the problems door's sources), like the
 * thread. A fragment belongs to the part of the dump its span starts in (`SetupDoc.span`).
 *
 * Problems are the groups the reading made of what customers said and the needs it found
 * (src/org/setup-groups.ts), each carrying its quotes; what no group took sits in one stack.
 *
 * It's the setup's one page, so it always draws the organization as it is too: its places (the
 * About and each product, src/ui/onboarding/places.ts) at the right, each goal wired into its place
 * and each place from the sources its lines rest on; the goals already in goals.md; and the tools
 * connected, faint, under the sources.
 *
 * The layout is code's, never the model's: columns left to right (sources and tools, problems,
 * goals, a goal left of the goal it feeds, places), each column ordered by the mean row of what it's
 * wired from so the wires stay short, sizes from the words. Cards and sources take their anatomy from
 * src/discovery/look.ts, as a board's do: a source is a tile with its words under it, a card has
 * its kind's tag over its top edge, its title, and (a goal to settle) a footer.
 */

export type CanvasKind = "source" | "problem" | "goal" | "place" | "tool";

/** A goal's state: found in the reading, proposed, accepted, left out, written by them (not added yet), or in goals.md. */
export type GoalState = "seen" | "proposed" | "accepted" | "discarded" | "kept" | "in";

export interface CanvasNode {
  id: string;
  kind: CanvasKind;
  title: string;
  /** A source: what it was, and the source record its words are in. */
  doc?: SetupDoc;
  sourceId?: string;
  /** Still being read. */
  reading?: boolean;
  /** A source: the quotes found in it. A problem or goal: the quotes it rests on. */
  quotes: string[];
  /** A goal. */
  state?: GoalState;
  /** A number it read (a goal's or a baseline), not a goal itself. */
  number?: true;
  /** The setup line to accept or leave out, or the know door's goal. */
  lineId?: string;
  goalRef?: string;
  /** A problem page (the problems door). */
  pageId?: string;
  /** A problem the reading grouped quotes under: how many quotes, from how many sources. */
  count?: { quotes: number; sources: number };
  /** What customers said that no problem took yet, as one stack. */
  loose?: true;
  /** A goal: the organization's North Star. */
  north?: true;
  /** A goal in goals.md (its id). */
  goalId?: string;
  /** A place: its key (places.ts), whether it's a product not made yet, and its lines in a few words. */
  place?: { key: string; fresh: boolean; line: string; open: number };
  /** Only the organization's name so far: drawn faint. */
  ghost?: true;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  /** `backs`: the source's or problem's words back it; `under`: a goal feeds the goal it points to; `in`: a goal is the place's it points to. */
  kind: "backs" | "under" | "in";
  /** The quotes behind the wire (empty where the reader finds them: the problems door's pages). */
  quotes: string[];
}

export interface Canvas {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  width: number;
  height: number;
}

/** What was sent at the problems door, part by part: its source and the problem pages it was filed into (no source yet: still being taken in). */
export interface ProblemPart {
  doc: SetupDoc;
  sourceId: string;
  pages: { id: string; title: string }[];
}

export interface CanvasInput {
  /** The reading doors (goals to find, an idea): the setup's session and its source. */
  setup?: { session: SetupSession; sourceId: string; quotes: readonly SourceQuote[]; text: string } | null;
  /** Sent, not kept yet: its parts show at once, being read. */
  pending?: { docs: readonly SetupDoc[] } | null;
  /** Qalam AI is working on it. */
  busy?: boolean;
  /** The know door's goals, as they wrote them. */
  know?: readonly (Pick<ShapedGoal, "ref" | "title" | "parent"> & Partial<Pick<ShapedGoal, "product">>)[] | null;
  /** The problems door. */
  problems?: readonly ProblemPart[] | null;
  /** The organization as it is: its name (`ghost`: nothing else known yet), its places, the goals in goals.md, the tools connected. */
  org?: { name: string; ghost?: boolean } | null;
  places?: readonly Place[] | null;
  tree?: GoalTree | null;
  tools?: readonly { id: string; label: string }[] | null;
}

export const EMPTY: Canvas = { nodes: [], edges: [], width: 0, height: 0 };

// Sizes, in canvas pixels.
export const NODE_W: Record<CanvasKind, number> = { source: SOURCE.w, tool: SOURCE.w, problem: 212, goal: 212, place: 212 };
const COL_GAP = 56;
/** The places' column: after every goal's. */
const PLACE_COL = 1000;
/** Room above each card for its tag, half of it over the edge. */
const ROW_GAP = 24;
/** A card's kind on a board, for its title's type (titleProps). */
export const CARD_KIND = { problem: "opportunity", goal: "outcome", place: "outcome" } as const;
/** Characters a line of a card's title holds, about (problems at 13 px, goals and places at 15). */
const CHARS = { problem: 28, goal: 24, place: 24 } as const;
/** Lines of a title the node shows (it's clamped there). */
export const MAX_LINES = 3;
/** A footer's row: a goal's ✓ and ✕. */
export const SETTLE_ROW = 24;
/** A problem's line under its title: how many quotes, from how many sources. */
export const COUNT_ROW = 20;

/** How many lines a card's title takes, about, up to MAX_LINES. */
export function titleLines(kind: Exclude<CanvasKind, "source" | "tool">, title: string): number {
  return Math.max(1, Math.min(MAX_LINES, Math.ceil(title.length / CHARS[kind])));
}

/** A node's height: a source's tile and words; a card's tag room, its title's lines, a problem's count, and its footer (a goal to settle) or padding. */
export function nodeHeight(kind: CanvasKind, title: string, footer = false, count = false): number {
  if (kind === "source" || kind === "tool") return SOURCE.h;
  const lines = titleLines(kind, title) * titleProps({ kind: CARD_KIND[kind], title }).lineHeight;
  return CARD_LOOK.top + lines + (count ? COUNT_ROW : 0) + (footer ? FOOTER.ruleGap + 1 + FOOTER.pad * 2 + SETTLE_ROW : CARD_LOOK.pad);
}

/** Whether a node ends on a footer: a goal to accept or leave out, or one already settled. */
export const hasFooter = (n: Pick<CanvasNode, "state">) => n.state === "proposed" || n.state === "accepted" || n.state === "discarded" || n.state === "kept";

type Draft = Omit<CanvasNode, "x" | "y" | "w" | "h">;

export function canvasOf(input: CanvasInput): Canvas {
  const nodes: Draft[] = [];
  const edges = new Map<string, CanvasEdge>();
  const wire = (from: string, to: string, kind: CanvasEdge["kind"], quotes: string[]) => {
    const id = `${from}>${to}`;
    const had = edges.get(id);
    edges.set(id, { id, from, to, kind, quotes: [...new Set([...(had?.quotes ?? []), ...quotes])] });
  };

  // Which source each quote is in, and which goal node each goal in goals.md is (a line accepted made it).
  const sourceOf = new Map<string, string>();
  const goalNode = new Map<string, string>();
  const goalPlace = new Map<string, string>();
  const setup = input.setup;
  if (setup) {
    const s = setup.session;
    // What was sent, part by part; a session from before parts were kept is one part.
    const docs: SetupDoc[] = s.docs?.length ? s.docs : [{ from: "said", title: "What you wrote", span: [0, setup.text.length] }];
    const reading = !!input.busy && s.phase === "reading";
    const srcId = (i: number) => `src:${i}`;
    // Their own words are titled by how they begin.
    const titleOf = (doc: SetupDoc) => (doc.from === "said" && doc.span ? setup.text.slice(doc.span[0], doc.span[1]).replace(/\s+/g, " ").trim().slice(0, 140) || doc.title : doc.title);
    docs.forEach((doc, i) => nodes.push({ id: srcId(i), kind: "source", title: titleOf(doc), doc, sourceId: setup.sourceId, quotes: [], ...(reading ? { reading } : {}) }));
    for (const q of setup.quotes) {
      const i = partOf(docs, q);
      if (i < 0) continue;
      sourceOf.set(q.id, srcId(i));
      nodes[i].quotes.push(q.id);
    }
    const byId = new Map(setup.quotes.map((q) => [q.id, q]));
    // Problems: the needs it found and what customers said, grouped by the problem they raise, each wired from the sources its quotes are in.
    const { groups, loose } = setupGroups(s, setup.quotes);
    const problemOf = new Map<string, string>();
    const problem = (id: string, title: string, quotes: string[], extra: Partial<Draft> = {}) => {
      const from = [...new Set(quotes.flatMap((q) => sourceOf.get(q) ?? []))];
      nodes.push({ id, kind: "problem", title, quotes, count: { quotes: quotes.length, sources: from.length }, ...extra });
      for (const q of quotes) {
        problemOf.set(q, id);
        const src = sourceOf.get(q);
        if (src) wire(src, id, "backs", [q]);
      }
    };
    for (const g of groups) problem(`group:${g.id}`, g.title, g.quotes);
    if (loose.length) problem("loose", "Not placed yet", loose, { loose: true });
    const lines = s.proposal?.lines.filter((l) => l.field === "goals") ?? [];
    if (lines.length && (s.phase === "review" || s.phase === "done")) {
      // Goals as proposed: each wired from the problems and sources its pieces are in, and to the goal it feeds.
      const ids = new Set(lines.map((l) => l.id));
      for (const l of lines) {
        const id = `line:${l.id}`;
        const decided = s.decided?.[l.id];
        nodes.push({ id, kind: "goal", title: l.text, quotes: [...l.pieces], state: decided ?? "proposed", lineId: l.id });
        goalPlace.set(id, placeKey(l.to, s));
        // A line accepted is a goal in goals.md now: this node stands for it.
        if (decided === "accepted") goalNode.set(lineGoalId(l.text, l.to === "org" ? null : l.to.startsWith("new:") ? (s.made?.[l.to.slice(4)] ?? l.to) : l.to), id);
        for (const p of l.pieces) {
          const q = byId.get(p);
          if (!q) continue;
          if (isProblem(q) && problemOf.has(q.id)) wire(problemOf.get(q.id)!, id, "backs", [q.id]);
          else {
            const from = sourceOf.get(q.id);
            if (from) wire(from, id, "backs", [q.id]);
          }
        }
        if (l.parent && ids.has(l.parent)) wire(id, `line:${l.parent}`, "under", []);
      }
    } else {
      // Before a proposal: the goals and numbers it read, as found.
      for (const q of setup.quotes.filter((x) => x.role === "goal" || x.role === "metric")) {
        const id = `frag:${q.id}`;
        nodes.push({ id, kind: "goal", title: q.text, quotes: [q.id], state: "seen", ...(q.role === "metric" ? { number: true as const } : {}) });
        const from = sourceOf.get(q.id);
        if (from) wire(from, id, "backs", [q.id]);
      }
    }
  } else if (input.pending) {
    input.pending.docs.forEach((doc, i) => nodes.push({ id: `src:${i}`, kind: "source", title: doc.title, doc, quotes: [], reading: true }));
  }

  if (input.know?.length) {
    // Their goals, as they wrote them: one source, their words.
    const src = "src:know";
    nodes.push({ id: src, kind: "source", title: "Your goals", doc: { from: "said", title: "Your goals" }, quotes: [] });
    const refs = new Set(input.know.map((g) => g.ref));
    for (const g of input.know) {
      const id = `know:${g.ref}`;
      nodes.push({ id, kind: "goal", title: g.title, quotes: [], state: "kept", goalRef: g.ref });
      goalPlace.set(id, !g.product ? "org" : "id" in g.product ? placeKey(g.product.id, null) : `named:${g.product.name}`);
      if (g.parent && refs.has(g.parent)) wire(id, `know:${g.parent}`, "under", []);
      else wire(src, id, "backs", []);
    }
  }

  if (input.problems?.length) {
    // The problems door: each part's source, wired to the problem pages it was filed into (the reader finds the quotes).
    input.problems.forEach((p, i) => {
      const src = `psrc:${i}`;
      // Not taken in yet: it shows, being read.
      nodes.push({ id: src, kind: "source", title: p.doc.title, doc: p.doc, quotes: [], ...(p.sourceId ? { sourceId: p.sourceId } : { reading: true }) });
      for (const page of p.pages) {
        const id = `page:${page.id}`;
        if (!nodes.some((n) => n.id === id)) nodes.push({ id, kind: "problem", title: page.title, quotes: [], pageId: page.id });
        wire(src, id, "backs", []);
      }
    });
  }

  composeOrg(input, nodes, edges, wire, { sourceOf, goalNode, goalPlace });
  return layout(nodes, [...edges.values()]);
}

/**
 * The organization as it is, around the door's material: the goals in goals.md (those no node stands
 * for yet), the tools connected under the sources, and the places at the right, each goal wired into
 * its own (one feeding a goal of the same place reaches it through that goal), each place from the
 * sources its lines rest on.
 */
function composeOrg(input: CanvasInput, nodes: Draft[], edges: ReadonlyMap<string, CanvasEdge>, wire: (from: string, to: string, kind: CanvasEdge["kind"], quotes: string[]) => void, at: { sourceOf: Map<string, string>; goalNode: Map<string, string>; goalPlace: Map<string, string> }) {
  const session = input.setup?.session ?? null;
  const tree = input.tree;
  if (tree) {
    for (const g of tree.goals) if (!at.goalNode.has(g.id)) at.goalNode.set(g.id, `goal:${g.id}`);
    for (const g of tree.goals) {
      const id = at.goalNode.get(g.id)!;
      if (id !== `goal:${g.id}`) continue;
      nodes.push({ id, kind: "goal", title: g.title, quotes: [], state: "in", goalId: g.id, ...(tree.north === g.id ? { north: true as const } : {}) });
      at.goalPlace.set(id, placeKey(g.product, session));
      const parent = g.parent ? at.goalNode.get(g.parent) : undefined;
      if (parent) wire(id, parent, "under", []);
    }
  }
  for (const t of input.tools ?? []) nodes.push({ id: `tool:${t.id}`, kind: "tool", title: t.label, doc: { from: t.id, title: t.label }, quotes: [] });
  const places = input.places?.length ? input.places : input.org ? [{ key: "org", title: input.org.name, fresh: false, lines: [] }] : [];
  if (!places.length) return;
  const ids = new Set(places.map((p) => `place:${p.key}`));
  for (const p of places) {
    const id = `place:${p.key}`;
    const quotes = [...new Set(p.lines.flatMap((l) => (l.state === "discarded" ? [] : l.pieces)))];
    const open = p.lines.filter((l) => l.state === "proposed").length;
    nodes.push({ id, kind: "place", title: p.title, quotes, place: { key: p.key, fresh: p.fresh, line: placeLine(p), open }, ...(input.org?.ghost && !input.places?.length ? { ghost: true as const } : {}) });
    for (const q of quotes) {
      const from = at.sourceOf.get(q);
      if (from) wire(from, id, "backs", [q]);
    }
  }
  // Each goal into its place, unless it feeds a goal of the same place (it reaches the place through it).
  const parentOf = new Map([...edges.values()].filter((e) => e.kind === "under").map((e) => [e.from, e.to]));
  for (const n of nodes) {
    if (n.kind !== "goal" || n.number || n.state === "seen") continue;
    const key = at.goalPlace.get(n.id);
    if (!key || !ids.has(`place:${key}`)) continue;
    const parent = parentOf.get(n.id);
    if (parent && at.goalPlace.get(parent) === key) continue;
    wire(n.id, `place:${key}`, "in", []);
  }
}

/** Columns left to right, rows ordered to keep wires short, sizes from the words. */
function layout(drafts: Draft[], edges: CanvasEdge[]): Canvas {
  if (!drafts.length) return EMPTY;
  const into = new Map<string, string[]>();
  for (const e of edges) into.set(e.to, [...(into.get(e.to) ?? []), e.from]);
  // A goal's column: right of every goal that feeds it (its children), so wires run left to right.
  const goalDepth = new Map<string, number>();
  const depthOf = (id: string, seen = new Set<string>()): number => {
    if (goalDepth.has(id)) return goalDepth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const kids = edges.filter((e) => e.kind === "under" && e.to === id).map((e) => e.from);
    const d = kids.length ? 1 + Math.max(...kids.map((k) => depthOf(k, seen))) : 0;
    goalDepth.set(id, d);
    return d;
  };
  // Places last, whatever the goals' depth.
  const colOf = (n: Draft) => (n.kind === "source" || n.kind === "tool" ? 0 : n.kind === "problem" ? 1 : n.kind === "place" ? PLACE_COL : 2 + depthOf(n.id));
  // Empty columns close up (no problems: goals sit next to the sources).
  const cols = [...new Set(drafts.map(colOf))].sort((a, b) => a - b);
  const byCol = cols.map((c) => drafts.filter((n) => colOf(n) === c));

  // Order: sources as sent; every other column by the mean row of what's wired into it.
  const row = new Map<string, number>();
  byCol.forEach((col, ci) => {
    if (ci > 0) {
      const key = (n: Draft) => {
        // The About heads its column.
        if (n.id === "place:org") return -1;
        const from = (into.get(n.id) ?? []).map((f) => row.get(f)).filter((r): r is number => r !== undefined);
        return from.length ? from.reduce((a, b) => a + b, 0) / from.length : Number.MAX_SAFE_INTEGER;
      };
      col.sort((a, b) => key(a) - key(b));
    }
    col.forEach((n, i) => row.set(n.id, i));
  });

  const sized = byCol.map((col) => col.map((n) => ({ ...n, w: NODE_W[n.kind], h: nodeHeight(n.kind, n.title, hasFooter(n), !!n.count || !!n.place) })));
  const colH = sized.map((col) => col.reduce((a, n) => a + n.h, 0) + Math.max(0, col.length - 1) * ROW_GAP);
  const height = Math.max(...colH);
  const nodes: CanvasNode[] = [];
  let x = 0;
  sized.forEach((col, ci) => {
    let y = (height - colH[ci]) / 2;
    const w = Math.max(...col.map((n) => n.w));
    for (const n of col) {
      nodes.push({ ...n, x, y });
      y += n.h + ROW_GAP;
    }
    x += w + (ci < sized.length - 1 ? COL_GAP : 0);
  });
  return { nodes, edges: edges.filter((e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to)), width: x, height };
}

/** What a source backs: each problem or goal resting on words in it, with those quotes (the reader's chips). */
export function backsOf(canvas: Canvas, sourceId: string): { node: CanvasNode; quotes: string[] }[] {
  const src = canvas.nodes.find((n) => n.id === sourceId);
  if (!src) return [];
  const mine = new Set(src.quotes);
  const direct = new Set(canvas.edges.filter((e) => e.from === sourceId).map((e) => e.to));
  return canvas.nodes.flatMap((n) => {
    if (n.kind === "source") return [];
    const quotes = n.quotes.filter((q) => mine.has(q));
    return quotes.length || (direct.has(n.id) && !n.quotes.length) ? [{ node: n, quotes }] : [];
  });
}

/** The nodes and wires on a path through a node: what feeds it and what it feeds, all the way. */
export function pathOf(canvas: Canvas, id: string): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set([id]);
  const lit = new Set<string>();
  const walk = (at: string, dir: "up" | "down") => {
    for (const e of canvas.edges) {
      const next = dir === "down" && e.from === at ? e.to : dir === "up" && e.to === at ? e.from : null;
      if (!next || lit.has(e.id)) continue;
      lit.add(e.id);
      nodes.add(next);
      walk(next, dir);
    }
  };
  walk(id, "down");
  walk(id, "up");
  return { nodes, edges: lit };
}
