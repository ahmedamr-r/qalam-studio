import type { SourceQuote } from "@/discovery/sources";
import type { ShapedGoal } from "@/goals/outline";
import type { SetupDoc, SetupSession } from "@/org/setup";

/*
 * The setup's canvas as data (pure): what was sent on the left, the problems and goals Qalam AI found
 * in it to the right, and a wire from each source to what it backs, carrying the ids of the quotes
 * behind it, so the reader can mark exactly those words. Worked out from what's kept (the setup's
 * session and its source's quotes, the know door's goals, the problems door's sources), like the
 * thread. A fragment belongs to the part of the dump its span starts in (`SetupDoc.span`).
 *
 * The layout is code's, never the model's: columns left to right (sources, problems, goals, a goal
 * left of the goal it feeds), each column ordered by the mean row of what it's wired from so the
 * wires stay short, sizes from the words.
 */

export type CanvasKind = "source" | "problem" | "goal";

/** A goal's state: found in the reading, proposed, accepted, left out, or written by them. */
export type GoalState = "seen" | "proposed" | "accepted" | "discarded" | "kept";

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
  /** The setup line to accept or leave out, or the know door's goal. */
  lineId?: string;
  goalRef?: string;
  /** A problem page (the problems door). */
  pageId?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  /** `backs`: the source's or problem's words back it; `under`: a goal feeds the goal it points to. */
  kind: "backs" | "under";
  /** The quotes behind the wire (empty where the reader finds them: the problems door's pages). */
  quotes: string[];
}

export interface Canvas {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  width: number;
  height: number;
}

/** What was sent at the problems door, part by part: its source and the problem pages it was filed into. */
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
  know?: readonly Pick<ShapedGoal, "ref" | "title" | "parent">[] | null;
  /** The problems door. */
  problems?: readonly ProblemPart[] | null;
}

export const EMPTY: Canvas = { nodes: [], edges: [], width: 0, height: 0 };

// Sizes, in canvas pixels.
export const NODE_W: Record<CanvasKind, number> = { source: 200, problem: 232, goal: 232 };
const COL_GAP = 72;
const ROW_GAP = 14;
const LINE = 18;
const CHARS = { source: 26, problem: 32, goal: 32 } as const;
/** Lines of a title the node shows (it's clamped there). */
export const MAX_LINES = 3;

/** A node's height from its title: a head line, up to three lines of words, and the goal's ✓/✕ row. */
export function nodeHeight(kind: CanvasKind, title: string, settle = false): number {
  const lines = Math.max(1, Math.min(MAX_LINES, Math.ceil(title.length / CHARS[kind])));
  return 30 + lines * LINE + (settle ? 30 : 0);
}

/** The part of the dump a fragment came from: the one its span starts in. */
export function partOf(docs: readonly SetupDoc[], q: Pick<SourceQuote, "span">): number {
  const at = q.span[0];
  const i = docs.findIndex((d) => d.span && at >= d.span[0] && at < d.span[1]);
  return i;
}

type Draft = Omit<CanvasNode, "x" | "y" | "w" | "h">;

export function canvasOf(input: CanvasInput): Canvas {
  const nodes: Draft[] = [];
  const edges = new Map<string, CanvasEdge>();
  const wire = (from: string, to: string, kind: CanvasEdge["kind"], quotes: string[]) => {
    const id = `${from}>${to}`;
    const had = edges.get(id);
    edges.set(id, { id, from, to, kind, quotes: [...new Set([...(had?.quotes ?? []), ...quotes])] });
  };

  const setup = input.setup;
  if (setup) {
    const s = setup.session;
    // What was sent, part by part; a session from before parts were kept is one part.
    const docs: SetupDoc[] = s.docs?.length ? s.docs : [{ from: "said", title: "What you wrote", span: [0, setup.text.length] }];
    const reading = !!input.busy && s.phase === "reading";
    const srcId = (i: number) => `src:${i}`;
    docs.forEach((doc, i) => nodes.push({ id: srcId(i), kind: "source", title: doc.title, doc, sourceId: setup.sourceId, quotes: [], ...(reading ? { reading } : {}) }));
    const sourceOf = new Map<string, string>();
    for (const q of setup.quotes) {
      const i = partOf(docs, q);
      if (i < 0) continue;
      sourceOf.set(q.id, srcId(i));
      nodes[i].quotes.push(q.id);
    }
    const byId = new Map(setup.quotes.map((q) => [q.id, q]));
    // Problems: the needs it found, each from its source.
    for (const q of setup.quotes.filter((x) => x.role === "need")) {
      const id = `need:${q.id}`;
      nodes.push({ id, kind: "problem", title: q.text, quotes: [q.id] });
      const from = sourceOf.get(q.id);
      if (from) wire(from, id, "backs", [q.id]);
    }
    const lines = s.proposal?.lines.filter((l) => l.field === "goals") ?? [];
    if (lines.length && (s.phase === "review" || s.phase === "done")) {
      // Goals as proposed: each wired from the problems and sources its pieces are in, and to the goal it feeds.
      const ids = new Set(lines.map((l) => l.id));
      for (const l of lines) {
        const id = `line:${l.id}`;
        const decided = s.decided?.[l.id];
        nodes.push({ id, kind: "goal", title: l.text, quotes: [...l.pieces], state: decided ?? "proposed", lineId: l.id });
        for (const p of l.pieces) {
          const q = byId.get(p);
          if (!q) continue;
          if (q.role === "need") wire(`need:${q.id}`, id, "backs", [q.id]);
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
        nodes.push({ id, kind: "goal", title: q.text, quotes: [q.id], state: "seen" });
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
      if (g.parent && refs.has(g.parent)) wire(id, `know:${g.parent}`, "under", []);
      else wire(src, id, "backs", []);
    }
  }

  if (input.problems?.length) {
    // The problems door: each part's source, wired to the problem pages it was filed into (the reader finds the quotes).
    input.problems.forEach((p, i) => {
      const src = `psrc:${i}`;
      nodes.push({ id: src, kind: "source", title: p.doc.title, doc: p.doc, sourceId: p.sourceId, quotes: [] });
      for (const page of p.pages) {
        const id = `page:${page.id}`;
        if (!nodes.some((n) => n.id === id)) nodes.push({ id, kind: "problem", title: page.title, quotes: [], pageId: page.id });
        wire(src, id, "backs", []);
      }
    });
  }

  return layout(nodes, [...edges.values()]);
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
  const colOf = (n: Draft) => (n.kind === "source" ? 0 : n.kind === "problem" ? 1 : 2 + depthOf(n.id));
  // Empty columns close up (no problems: goals sit next to the sources).
  const cols = [...new Set(drafts.map(colOf))].sort((a, b) => a - b);
  const byCol = cols.map((c) => drafts.filter((n) => colOf(n) === c));

  // Order: sources as sent; every other column by the mean row of what's wired into it.
  const row = new Map<string, number>();
  byCol.forEach((col, ci) => {
    if (ci > 0) {
      const key = (n: Draft) => {
        const from = (into.get(n.id) ?? []).map((f) => row.get(f)).filter((r): r is number => r !== undefined);
        return from.length ? from.reduce((a, b) => a + b, 0) / from.length : Number.MAX_SAFE_INTEGER;
      };
      col.sort((a, b) => key(a) - key(b));
    }
    col.forEach((n, i) => row.set(n.id, i));
  });

  const sized = byCol.map((col) => col.map((n) => ({ ...n, w: NODE_W[n.kind], h: nodeHeight(n.kind, n.title, n.state === "proposed" || n.state === "accepted" || n.state === "discarded") })));
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
