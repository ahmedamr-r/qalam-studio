/**
 * Where the hub's nodes sit (pure). A force layout, made repeatable: every node starts from its
 * group's anchor plus an offset hashed from its ref, the random source is seeded, and the
 * simulation runs a fixed number of steps with no timer. Saved positions are kept as they are, so
 * reopening the hub shows the same picture and only new knowledge has to find a place.
 */
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { factHash } from "./refs";
import type { Group, KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from "./types";

export type Positions = Record<string, [number, number]>;

/** Each group's home: decisions in the middle (they connect everything), the rest around them. */
export const GROUP_HOME: Record<Exclude<Group, "anchor">, [number, number]> = {
  decision: [0, 0],
  you: [-330, -280],
  system: [-420, 200],
  learned: [120, 430],
  research: [460, -60],
};

/** Anchors settle near what they belong to: screens by the decisions and goals, tokens and components by the system. */
function homeOf(n: KnowledgeNode): [number, number] {
  if (n.group !== "anchor") return GROUP_HOME[n.group];
  if (n.kind === "screen") return [-170, -140];
  if (n.kind === "system") return GROUP_HOME.system;
  return [-560, 360];
}

/** Drawn radius (room for the kind's icon): grows with how often decisions relied on the fact. */
export function nodeRadius(n: KnowledgeNode): number {
  if (n.kind === "decision" || n.kind === "system") return 12;
  if (n.group === "anchor") return 8;
  return Math.min(16, 9 + 2.2 * Math.sqrt(n.usage.relied));
}

/** Small seeded generator (mulberry32). */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hashNum = (s: string) => parseInt(factHash(s), 36);

/** Edges that shape the layout: given links would pull every rule onto every decision. */
const shapes = (e: KnowledgeEdge, byRef: Map<string, KnowledgeNode>) => e.kind !== "given" || byRef.get(e.from)?.group === "research";

type SimNode = SimulationNodeDatum & { ref: string; r: number; home: [number, number] };

export interface LayoutOptions {
  seed?: string;
  /** Lay everything out again, ignoring saved positions ("Tidy layout"). */
  reset?: boolean;
  /** Steps for a fresh layout, and for placing new nodes among saved ones. */
  steps?: number;
  addSteps?: number;
}

export function layoutGraph(g: KnowledgeGraph, saved: Positions | null, opts: LayoutOptions = {}): Positions {
  const keep = opts.reset ? null : saved;
  const sorted = [...g.nodes].sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0));
  const fresh = sorted.filter((n) => !keep?.[n.ref]);
  if (!fresh.length && keep) return pick(keep, sorted);

  const neighbours = new Map<string, string[]>();
  for (const e of g.edges) {
    if (!shapes(e, g.byRef)) continue;
    (neighbours.get(e.from) ?? neighbours.set(e.from, []).get(e.from)!).push(e.to);
    (neighbours.get(e.to) ?? neighbours.set(e.to, []).get(e.to)!).push(e.from);
  }
  const at = new Map<string, [number, number]>();
  for (const n of sorted) if (keep?.[n.ref]) at.set(n.ref, keep[n.ref]);

  const sim: SimNode[] = sorted.map((n) => {
    const h = hashNum(n.ref);
    const home = homeOf(n);
    const s = keep?.[n.ref];
    if (s) return { ref: n.ref, r: nodeRadius(n), home, x: s[0], y: s[1], fx: s[0], fy: s[1] };
    // A new node starts beside the neighbours that already have a place, else near its group's home.
    const placed = (neighbours.get(n.ref) ?? []).map((r) => at.get(r)).filter((p): p is [number, number] => !!p);
    const angle = ((h % 3600) / 3600) * Math.PI * 2;
    const dist = placed.length ? 24 + (h % 24) : 30 + (h % 170);
    const cx = placed.length ? placed.reduce((s, p) => s + p[0], 0) / placed.length : home[0];
    const cy = placed.length ? placed.reduce((s, p) => s + p[1], 0) / placed.length : home[1];
    const p: [number, number] = [cx + Math.cos(angle) * dist, cy + Math.sin(angle) * dist];
    at.set(n.ref, p);
    return { ref: n.ref, r: nodeRadius(n), home, x: p[0], y: p[1] };
  });
  const index = new Map(sim.map((n) => [n.ref, n]));
  const links: (SimulationLinkDatum<SimNode> & { kind: KnowledgeEdge["kind"] })[] = g.edges
    .filter((e) => shapes(e, g.byRef) && index.has(e.from) && index.has(e.to))
    .map((e) => ({ source: index.get(e.from)!, target: index.get(e.to)!, kind: e.kind }));

  const simulation = forceSimulation<SimNode>(sim)
    .randomSource(seeded(hashNum(opts.seed ?? "qalam")))
    .force("charge", forceManyBody<SimNode>().strength(-60).distanceMax(360).theta(0.9))
    .force(
      "link",
      forceLink<SimNode, (typeof links)[number]>(links)
        .distance((l) => (l.kind === "part" ? 110 : l.kind === "context" ? 70 : 54))
        .strength((l) => (l.kind === "part" ? 0.04 : l.kind === "relied" || l.kind === "produced" ? 0.35 : 0.2)),
    )
    .force("x", forceX<SimNode>((n) => n.home[0]).strength(0.07))
    .force("y", forceY<SimNode>((n) => n.home[1]).strength(0.07))
    .force("collide", forceCollide<SimNode>((n) => n.r + 7).iterations(2))
    .stop();
  simulation.tick(keep ? (opts.addSteps ?? 120) : (opts.steps ?? 300));

  const out: Positions = {};
  for (const n of sim) out[n.ref] = [Math.round(n.x ?? 0), Math.round(n.y ?? 0)];
  return out;
}

/** Saved positions of the nodes still on the graph. */
function pick(saved: Positions, nodes: KnowledgeNode[]): Positions {
  const out: Positions = {};
  for (const n of nodes) if (saved[n.ref]) out[n.ref] = saved[n.ref];
  return out;
}

/** The world box around every placed node. */
export function boundsOf(pos: Positions, refs: Iterable<string>): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of refs) {
    const p = pos[r];
    if (!p) continue;
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
