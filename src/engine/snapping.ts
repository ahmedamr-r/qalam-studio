import type { Box } from "@/doc/geometry";

/*
 * Smart guides: snap a moving box (or a dragged edge) to the edges and centres of the layers
 * around it, and to equal spacing between them, like Figma. Pure, in world units; the controller
 * picks the candidates and the threshold (a few screen px divided by the zoom).
 */

/** A snap line in world space: `axis` "x" is a vertical line at x = `at`, from y `from` to `to`. */
export interface SnapGuide {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
}

/** A distance shown while snapping: along `axis`, from `from` to `to`, drawn at `at` on the other axis. */
export interface Spacing {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
}

/** Which edges of the box move: 0 = left/top, 0.5 = centre, 1 = right/bottom. */
export type EdgeFraction = 0 | 0.5 | 1;

export interface SnapOptions {
  x?: EdgeFraction[];
  y?: EdgeFraction[];
  /** Also snap to equal gaps between neighbours (moving only). */
  spacing?: boolean;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
  spacings: Spacing[];
}

const ALL: EdgeFraction[] = [0, 0.5, 1];
const EPS = 1e-3;

interface Axis {
  pos: (b: Box) => number;
  size: (b: Box) => number;
  /** The same accessors for the other axis. */
  cpos: (b: Box) => number;
  csize: (b: Box) => number;
}
const AX: Record<"x" | "y", Axis> = {
  x: { pos: (b) => b.x, size: (b) => b.w, cpos: (b) => b.y, csize: (b) => b.h },
  y: { pos: (b) => b.y, size: (b) => b.h, cpos: (b) => b.x, csize: (b) => b.w },
};
const end = (a: Axis, b: Box) => a.pos(b) + a.size(b);
const cend = (a: Axis, b: Box) => a.cpos(b) + a.csize(b);
const overlapCross = (a: Axis, p: Box, q: Box) => a.cpos(p) < cend(a, q) - EPS && a.cpos(q) < cend(a, p) - EPS;
/** Middle of what two boxes share on the cross axis (or the first box's centre). */
const crossMid = (a: Axis, p: Box, q: Box) => {
  const lo = Math.max(a.cpos(p), a.cpos(q)), hi = Math.min(cend(a, p), cend(a, q));
  return hi > lo ? (lo + hi) / 2 : a.cpos(p) + a.csize(p) / 2;
};

interface Pick {
  delta: number;
  /** Edge alignment: the line the box snapped to. */
  at?: number;
  spacings?: Spacing[];
}

function bestEdge(a: Axis, box: Box, cands: Box[], edges: EdgeFraction[], th: number): Pick | null {
  let best: Pick | null = null;
  for (const c of cands) {
    for (const cv of [a.pos(c), a.pos(c) + a.size(c) / 2, end(a, c)]) {
      for (const e of edges) {
        const delta = cv - (a.pos(box) + e * a.size(box));
        if (Math.abs(delta) <= th && (!best || Math.abs(delta) < Math.abs(best.delta) - EPS)) best = { delta, at: cv };
      }
    }
  }
  return best;
}

/** Equal spacing on one axis: centre between two neighbours, or repeat a gap that already exists. */
function bestGap(axis: "x" | "y", box: Box, cands: Box[], th: number): Pick | null {
  const a = AX[axis];
  const row = cands.filter((c) => overlapCross(a, c, box) && (end(a, c) <= a.pos(box) + th || a.pos(c) >= end(a, box) - th)).sort((p, q) => a.pos(p) - a.pos(q));
  if (!row.length) return null;
  const before = row.filter((c) => end(a, c) <= a.pos(box) + th).sort((p, q) => end(a, q) - end(a, p))[0];
  const after = row.filter((c) => a.pos(c) >= end(a, box) - th).sort((p, q) => a.pos(p) - a.pos(q))[0];
  const seg = (p: Box, q: Box, from: number, to: number): Spacing => ({ axis, at: crossMid(a, p, q), from, to });
  const picks: Pick[] = [];
  if (before && after) {
    const gb = a.pos(box) - end(a, before), ga = a.pos(after) - end(a, box);
    const delta = (ga - gb) / 2;
    const g = gb + delta;
    if (g > EPS) {
      const moved = { ...box, [axis]: a.pos(box) + delta };
      picks.push({ delta, spacings: [seg(moved, before, end(a, before), a.pos(moved)), seg(moved, after, end(a, moved), a.pos(after))] });
    }
  }
  // Gaps already on the canvas between neighbours in the same row.
  const gaps: { g: number; s: Spacing }[] = [];
  for (let i = 0; i + 1 < row.length; i++) {
    const p = row[i], q = row[i + 1];
    const g = a.pos(q) - end(a, p);
    if (g > EPS && overlapCross(a, p, q)) gaps.push({ g, s: seg(p, q, end(a, p), a.pos(q)) });
  }
  for (const { g, s } of gaps) {
    if (before) {
      const delta = g - (a.pos(box) - end(a, before));
      const moved = { ...box, [axis]: a.pos(box) + delta };
      picks.push({ delta, spacings: [s, seg(moved, before, end(a, before), a.pos(moved))] });
    }
    if (after) {
      const delta = a.pos(after) - end(a, box) - g;
      const moved = { ...box, [axis]: a.pos(box) + delta };
      picks.push({ delta, spacings: [s, seg(moved, after, end(a, moved), a.pos(after))] });
    }
  }
  let best: Pick | null = null;
  for (const p of picks) if (Math.abs(p.delta) <= th && (!best || Math.abs(p.delta) < Math.abs(best.delta) - EPS)) best = p;
  return best;
}

/**
 * The guide through `at` on `axis`, long enough to reach the box and every candidate with an edge
 * or centre on it, plus the distance to the nearest of those that the box doesn't touch.
 */
export function guideFor(axis: "x" | "y", at: number, box: Box, cands: Box[]): { guide: SnapGuide; spacing: Spacing | null } {
  const a = AX[axis];
  const on = cands.filter((c) => [a.pos(c), a.pos(c) + a.size(c) / 2, end(a, c)].some((v) => Math.abs(v - at) < EPS));
  let from = a.cpos(box), to = cend(a, box);
  for (const c of on) {
    from = Math.min(from, a.cpos(c));
    to = Math.max(to, cend(a, c));
  }
  // The nearest aligned layer that sits apart from the box on the guide's own direction.
  let spacing: Spacing | null = null;
  const other: "x" | "y" = axis === "x" ? "y" : "x";
  for (const c of on) {
    const gapAfter = a.cpos(c) - cend(a, box);
    const gapBefore = a.cpos(box) - cend(a, c);
    const s: Spacing | null =
      gapAfter > EPS ? { axis: other, at, from: cend(a, box), to: a.cpos(c) } : gapBefore > EPS ? { axis: other, at, from: cend(a, c), to: a.cpos(box) } : null;
    if (s && (!spacing || s.to - s.from < spacing.to - spacing.from)) spacing = s;
  }
  return { guide: { axis, at, from, to }, spacing };
}

/**
 * Snap `box` against `cands` within `th`: the delta to apply, the guides to draw and the distances
 * to label. Each axis snaps on its own; the nearest edge or equal-gap match wins.
 */
export function snapBox(box: Box, cands: Box[], th: number, opts: SnapOptions = {}): SnapResult {
  const out: SnapResult = { dx: 0, dy: 0, guides: [], spacings: [] };
  const picked: Partial<Record<"x" | "y", Pick>> = {};
  for (const axis of ["x", "y"] as const) {
    const edges = opts[axis] ?? ALL;
    if (!edges.length) continue;
    let best = bestEdge(AX[axis], box, cands, edges, th);
    if (opts.spacing) {
      const gap = bestGap(axis, box, cands, th);
      if (gap && (!best || Math.abs(gap.delta) < Math.abs(best.delta) - EPS)) best = gap;
    }
    if (best) picked[axis] = best;
  }
  out.dx = picked.x?.delta ?? 0;
  out.dy = picked.y?.delta ?? 0;
  const moved = { ...box, x: box.x + out.dx, y: box.y + out.dy };
  for (const axis of ["x", "y"] as const) {
    const p = picked[axis];
    if (!p) continue;
    if (p.at !== undefined) {
      const g = guideFor(axis, p.at, moved, cands);
      out.guides.push(g.guide);
      if (g.spacing) out.spacings.push(g.spacing);
    }
    if (p.spacings) out.spacings.push(...p.spacings);
  }
  return out;
}
