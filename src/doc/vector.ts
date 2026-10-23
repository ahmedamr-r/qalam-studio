import type { Mirror, PathNode, Vec2, VectorData, VectorPath, VectorPoint } from "./schema";
import { type Bounds, type Seg, parsePath, pathBounds, toD } from "@/design-system/svg-path";
import { apply, invert, localMatrix } from "./geometry";

/*
 * Editable vectors. A path node's `d` stays the canonical drawable; user-drawn or edited vectors
 * also keep `vector` (anchors with handles, open or closed subpaths) in the same vw × vh space, so
 * resizing a node only changes w/h. `writeVector` is the one writer of both, and `vectorOf` heals
 * itself when something rewrote `d` without knowing about `vector`.
 */

export type PointRef = { path: number; point: number };
export type HandleRef = PointRef & { side: "in" | "out" };
/** Segment `seg` joins points[seg] → points[(seg + 1) % n]. */
export type SegRef = { path: number; seg: number };
export type Cubic = [Vec2, Vec2, Vec2, Vec2];

const EPS = 1e-9;
const r2 = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};
const hasH = (h: Vec2 | undefined): h is Vec2 => !!h && (Math.abs(h.x) > EPS || Math.abs(h.y) > EPS);
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const len = (v: Vec2) => Math.hypot(v.x, v.y);

const clonePoint = (p: VectorPoint): VectorPoint => ({ ...p, ...(p.in ? { in: { ...p.in } } : {}), ...(p.out ? { out: { ...p.out } } : {}) });
export const cloneVector = (v: VectorData): VectorData => ({ paths: v.paths.map((p) => ({ ...p, points: p.points.map(clonePoint) })) });

/** Number of segments in a subpath (a closed one has the closing segment too). */
export const segCount = (p: VectorPath) => (p.points.length < 2 ? 0 : p.closed ? p.points.length : p.points.length - 1);

// ---------------------------------------------------------------------------
// Conversion

function segTo(a: VectorPoint, b: VectorPoint): Seg {
  if (!hasH(a.out) && !hasH(b.in)) return { c: "L", x: b.x, y: b.y };
  const o = a.out ?? { x: 0, y: 0 },
    i = b.in ?? { x: 0, y: 0 };
  return { c: "C", x1: a.x + o.x, y1: a.y + o.y, x2: b.x + i.x, y2: b.y + i.y, x: b.x, y: b.y };
}

function pathSegs(p: VectorPath): Seg[] {
  const pts = p.points;
  if (!pts.length) return [];
  const out: Seg[] = [{ c: "M", x: pts[0].x, y: pts[0].y }];
  for (let i = 1; i < pts.length; i++) out.push(segTo(pts[i - 1], pts[i]));
  if (p.closed && pts.length > 1) {
    // A straight closing segment is just Z; a curved one goes back explicitly first.
    const last = segTo(pts[pts.length - 1], pts[0]);
    if (last.c === "C") out.push(last);
    out.push({ c: "Z" });
  }
  return out;
}

/** Absolute moves, lines and cubics for the vector (the svg-path form). */
export function vectorToSegs(v: VectorData): Seg[] {
  return v.paths.flatMap(pathSegs);
}

export function vectorToD(v: VectorData): string {
  return toD(vectorToSegs(v));
}

/** Path data of what a vector fills: its closed subpaths only (Figma fills closed regions only). */
export function fillD(v: VectorData): string | null {
  const closed = v.paths.filter((p) => p.closed && p.filled !== false && p.points.length > 1);
  return closed.length ? toD(closed.flatMap(pathSegs)) : null;
}

/** How a vertex's two handles relate (Figma's handleMirroring). */
export function inferMirror(p: VectorPoint): Mirror {
  if (!hasH(p.in) || !hasH(p.out)) return "none";
  const a = len(p.in),
    b = len(p.out);
  const cos = -(p.in.x * p.out.x + p.in.y * p.out.y) / (a * b);
  if (cos < Math.cos((0.5 * Math.PI) / 180)) return "none";
  return Math.abs(a - b) <= 0.01 * Math.max(a, b) ? "angle-length" : "angle";
}

/** Anchors and handles from path data. For legacy (AI-built) paths; null when the data doesn't parse. */
export function vectorFromD(d: string): VectorData | null {
  const { segs, error } = parsePath(d);
  return error ? null : vectorFromSegs(segs);
}

/** Anchors and handles from absolute moves, lines and cubics (path data already parsed, e.g. path ops' output). */
export function vectorFromSegs(segs: Seg[]): VectorData {
  const paths: VectorPath[] = [];
  let cur: VectorPath | null = null;
  const start = () => {
    cur = { points: [], closed: false };
    paths.push(cur);
    return cur;
  };
  for (const s of segs) {
    if (s.c === "M") {
      start().points.push({ x: s.x, y: s.y, mirror: "none" });
      continue;
    }
    if (s.c === "Z") {
      const p = cur as VectorPath | null;
      if (!p || p.closed) continue;
      p.closed = true;
      const pts = p.points;
      // Drawn back to its start before closing: the closing segment is that last one.
      if (pts.length > 2) {
        const first = pts[0],
          last = pts[pts.length - 1];
        if (Math.abs(first.x - last.x) <= 0.01 && Math.abs(first.y - last.y) <= 0.01) {
          if (last.in) first.in = last.in;
          pts.pop();
        }
      }
      continue;
    }
    let p = cur as VectorPath | null;
    // A segment after Z starts a new subpath where the closed one began.
    if (!p || p.closed) {
      const from = p?.points[0] ?? { x: 0, y: 0 };
      p = start();
      p.points.push({ x: from.x, y: from.y, mirror: "none" });
    }
    const prev = p.points[p.points.length - 1];
    if (s.c === "L") p.points.push({ x: s.x, y: s.y, mirror: "none" });
    else {
      const o = { x: s.x1 - prev.x, y: s.y1 - prev.y };
      if (hasH(o)) prev.out = o;
      const i = { x: s.x2 - s.x, y: s.y2 - s.y };
      p.points.push({ x: s.x, y: s.y, mirror: "none", ...(hasH(i) ? { in: i } : {}) });
    }
  }
  for (const p of paths) for (const pt of p.points) pt.mirror = inferMirror(pt);
  return { paths };
}

const dOfVector = new WeakMap<VectorData, string>();
const fromDCache = new Map<string, VectorData>();
const EMPTY: VectorData = { paths: [] };

/** The node's `vector` when it is still the source of its `d` (rewriters may have changed `d` alone). */
export function freshVector(n: Pick<PathNode, "d" | "vector">): VectorData | null {
  const v = n.vector;
  if (!v) return null;
  let d = dOfVector.get(v);
  if (d === undefined) {
    d = vectorToD(v);
    dOfVector.set(v, d);
  }
  return d === n.d ? v : null;
}

/** The node is an editable vector: closed-only fill semantics, explicit ends and joins. */
export const isEditableVector = (n: Pick<PathNode, "d" | "vector">) => freshVector(n) !== null;

/** Self-healing read: the node's `vector`, or anchors derived from its `d`. */
export function vectorOf(n: Pick<PathNode, "d" | "vector">): VectorData {
  const v = freshVector(n);
  if (v) return v;
  let hit = fromDCache.get(n.d);
  if (!hit) {
    hit = vectorFromD(n.d) ?? EMPTY;
    if (fromDCache.size > 400) fromDCache.clear();
    fromDCache.set(n.d, hit);
  }
  return hit;
}

function roundVector(v: VectorData): VectorData {
  const h = (o: Vec2 | undefined) => (hasH(o) ? { x: r2(o.x), y: r2(o.y) } : undefined);
  return {
    paths: v.paths.map((p) => ({
      ...p,
      points: p.points.map((pt) => {
        const { in: i, out: o, ...rest } = pt;
        const ri = h(i),
          ro = h(o);
        return { ...rest, x: r2(pt.x), y: r2(pt.y), ...(ri ? { in: ri } : {}), ...(ro ? { out: ro } : {}) };
      }),
    })),
  };
}

/** The one writer: sets `vector` and `d` together (rounded to 0.01). Works on immer drafts. */
export function writeVector(n: Pick<PathNode, "d" | "vector">, v: VectorData) {
  const r = roundVector(v);
  const d = vectorToD(r);
  dOfVector.set(r, d);
  n.vector = r;
  n.d = d;
}

// ---------------------------------------------------------------------------
// Transforms

/** Vector space → node px. A zero axis (a horizontal line's vh) scales by 1 instead of collapsing. */
export function vectorScale(n: Pick<PathNode, "w" | "h" | "vw" | "vh">): { sx: number; sy: number } {
  return { sx: n.vw > 0 ? n.w / n.vw : 1, sy: n.vh > 0 ? n.h / n.vh : 1 };
}

function mapVector(v: VectorData, pt: (p: Vec2) => Vec2, h: (o: Vec2) => Vec2): VectorData {
  return {
    paths: v.paths.map((p) => ({
      ...p,
      points: p.points.map((q) => {
        const n: VectorPoint = { ...q, ...pt(q) };
        if (q.in) n.in = h(q.in);
        if (q.out) n.out = h(q.out);
        return n;
      }),
    })),
  };
}

export function scaleVector(v: VectorData, sx: number, sy: number): VectorData {
  if (sx === 1 && sy === 1) return v;
  return mapVector(
    v,
    (p) => ({ x: p.x * sx, y: p.y * sy }),
    (o) => ({ x: o.x * sx, y: o.y * sy }),
  );
}

export function translateVector(v: VectorData, dx: number, dy: number): VectorData {
  if (!dx && !dy) return v;
  return mapVector(v, (p) => ({ x: p.x + dx, y: p.y + dy }), (o) => ({ ...o }));
}

/** Mirror within a w × h box. */
export function flipVector(v: VectorData, axis: "h" | "v", w: number, h: number): VectorData {
  return axis === "h"
    ? mapVector(v, (p) => ({ x: w - p.x, y: p.y }), (o) => ({ x: -o.x, y: o.y }))
    : mapVector(v, (p) => ({ x: p.x, y: h - p.y }), (o) => ({ x: o.x, y: -o.y }));
}

/** Exact curve bounds (handles excluded, like Figma). */
export function vectorBounds(v: VectorData): Bounds {
  return pathBounds(vectorToSegs(v));
}

/**
 * Where the node's origin goes when its box becomes (bx, by, w2, h2) in its own px, so that
 * everything inside stays put in the parent although the rotation centre moved. The box turns
 * and mirrors about its centre, so the shift goes through the rotation and the flips.
 */
export function rebase(n: Pick<PathNode, "x" | "y" | "w" | "h" | "rotation" | "flipH" | "flipV">, bx: number, by: number, w2: number, h2: number): { x: number; y: number } {
  const cx = n.w / 2,
    cy = n.h / 2,
    cx2 = w2 / 2,
    cy2 = h2 / 2;
  const r = apply(turnOf(n), { x: bx + cx2 - cx, y: by + cy2 - cy });
  return { x: n.x + cx - cx2 + r.x, y: n.y + cy - cy2 + r.y };
}

/** The node's rotation and flips, about the origin (the linear part of its local matrix). */
const turnOf = (n: Pick<PathNode, "rotation" | "flipH" | "flipV">) => localMatrix({ x: 0, y: 0, w: 0, h: 0, rotation: n.rotation || 0, flipH: n.flipH, flipV: n.flipV });

/**
 * After an edit (on commit): bake the node's scale into the vector and fit the box to the curve,
 * keeping every anchor fixed in the parent. Afterwards vw = w, vh = h and the bounds start at 0, 0.
 * `v` is in the node's current vector space. A zero axis (a straight line) is allowed.
 */
export function normalizeVectorNode(n: PathNode, v: VectorData) {
  const { sx, sy } = vectorScale(n);
  const px = scaleVector(v, sx, sy);
  const b = vectorBounds(px);
  const o = rebase(n, b.x, b.y, b.w, b.h);
  // The origin lands on hundredths and the points take up the difference: points are stored to
  // hundredths too, so anchors that sat on whole pixels in the parent still do (no drift per edit).
  const x = r2(o.x),
    y = r2(o.y);
  const d = apply(invert(turnOf(n)), { x: o.x - x, y: o.y - y });
  writeVector(n, translateVector(px, d.x - b.x, d.y - b.y));
  n.x = x;
  n.y = y;
  n.w = n.vw = b.w;
  n.h = n.vh = b.h;
}

// ---------------------------------------------------------------------------
// Queries

export function segmentCubic(v: VectorData, ref: SegRef): Cubic {
  const pts = v.paths[ref.path].points;
  const a = pts[ref.seg],
    b = pts[(ref.seg + 1) % pts.length];
  return [{ x: a.x, y: a.y }, add(a, a.out ?? { x: 0, y: 0 }), add(b, b.in ?? { x: 0, y: 0 }), { x: b.x, y: b.y }];
}

export function cubicAt(c: Cubic, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u,
    b = 3 * u * u * t,
    d = 3 * u * t * t,
    e = t * t * t;
  return { x: a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x, y: a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y };
}

/** De Casteljau split at t. */
export function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const p01 = lerp(c[0], c[1], t),
    p12 = lerp(c[1], c[2], t),
    p23 = lerp(c[2], c[3], t);
  const p012 = lerp(p01, p12, t),
    p123 = lerp(p12, p23, t);
  const m = lerp(p012, p123, t);
  return [
    [c[0], p01, p012, m],
    [m, p123, p23, c[3]],
  ];
}

const isLine = (c: Cubic) => len(sub(c[1], c[0])) < EPS && len(sub(c[2], c[3])) < EPS;

function cubicSteps(c: Cubic, tol: number): number {
  if (isLine(c)) return 1;
  const poly = len(sub(c[1], c[0])) + len(sub(c[2], c[1])) + len(sub(c[3], c[2]));
  return Math.max(2, Math.min(96, Math.ceil(Math.sqrt(poly / Math.max(tol, 1e-3)) * 1.5)));
}

export interface Polyline {
  pts: Vec2[];
  closed: boolean;
  /** A closed subpath the vector fills (paint bucket can unfill one). */
  filled: boolean;
}

/** Polylines of every subpath (closed ones end back at their start). */
export function flatten(v: VectorData, tol = 0.25): Polyline[] {
  return v.paths
    .map((p, pi) => ({ p, pi }))
    .filter(({ p }) => p.points.length)
    .map(({ p, pi }) => {
      const pts: Vec2[] = [{ x: p.points[0].x, y: p.points[0].y }];
      const n = segCount(p);
      for (let s = 0; s < n; s++) {
        const c = segmentCubic(v, { path: pi, seg: s });
        const steps = cubicSteps(c, tol);
        for (let k = 1; k <= steps; k++) pts.push(steps === 1 ? c[3] : cubicAt(c, k / steps));
      }
      return { pts, closed: p.closed, filled: p.closed && p.filled !== false };
    });
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The closest point on the vector to `p`, within `maxDist`. */
export function nearestOnVector(v: VectorData, p: Vec2, maxDist = Infinity): { seg: SegRef; t: number; point: Vec2; dist: number } | null {
  let best: { seg: SegRef; t: number; point: Vec2; dist: number } | null = null;
  v.paths.forEach((path, pi) => {
    const n = segCount(path);
    for (let s = 0; s < n; s++) {
      const c = segmentCubic(v, { path: pi, seg: s });
      const N = isLine(c) ? 8 : 32;
      let bt = 0,
        bd = Infinity;
      for (let k = 0; k <= N; k++) {
        const d = len(sub(cubicAt(c, k / N), p));
        if (d < bd) {
          bd = d;
          bt = k / N;
        }
      }
      // Refine by bisection around the best sample.
      let lo = Math.max(0, bt - 1 / N),
        hi = Math.min(1, bt + 1 / N);
      for (let it = 0; it < 24; it++) {
        const m1 = lo + (hi - lo) / 3,
          m2 = hi - (hi - lo) / 3;
        if (len(sub(cubicAt(c, m1), p)) < len(sub(cubicAt(c, m2), p))) hi = m2;
        else lo = m1;
      }
      const t = (lo + hi) / 2;
      const pt = cubicAt(c, t);
      const d = len(sub(pt, p));
      if (d <= maxDist && (!best || d < best.dist)) best = { seg: { path: pi, seg: s }, t, point: pt, dist: d };
    }
  });
  return best;
}

/** Non-zero (or even-odd) winding of a point against closed polylines. */
function insidePolys(polys: Vec2[][], p: Vec2, evenOdd: boolean): boolean {
  let wind = 0,
    crossings = 0;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j],
        b = poly[i];
      if (a.y <= p.y) {
        if (b.y > p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) > 0) {
          wind++;
          crossings++;
        }
      } else if (b.y <= p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) < 0) {
        wind--;
        crossings++;
      }
    }
  }
  return evenOdd ? crossings % 2 === 1 : wind !== 0;
}

const flatCache = new Map<string, Polyline[]>();

/** The node's geometry flattened in node px (cached by data and size). */
export function flattenNode(n: PathNode): Polyline[] {
  const key = `${n.d}|${n.w}|${n.h}|${n.vw}|${n.vh}`;
  let hit = flatCache.get(key);
  if (!hit) {
    const { sx, sy } = vectorScale(n);
    hit = flatten(scaleVector(vectorOf(n), sx, sy), 0.25);
    if (flatCache.size > 300) flatCache.clear();
    flatCache.set(key, hit);
  }
  return hit;
}

/**
 * Whether a point in node px touches the vector: inside its filled region (closed subpaths for
 * editable vectors, every subpath for legacy SVG data) or within `max(reach, tol)` of its outline.
 * `reach` is how far the stroke reaches from the centre line (half its width, or its arrowheads).
 * A vector with no paint is still hittable on its skeleton within `tol`, like Figma.
 */
export function hitVector(n: PathNode, local: Vec2, tol: number, reach = n.stroke && n.stroke.width > 0 ? n.stroke.width / 2 : 0): boolean {
  const polys = flattenNode(n);
  if (n.fill) {
    const editable = isEditableVector(n);
    const regions = polys.filter((p) => !editable || p.filled).map((p) => p.pts);
    if (regions.length && insidePolys(regions, local, !!n.evenOdd)) return true;
  }
  const r = Math.max(reach, tol);
  if (r <= 0) return false;
  for (const { pts } of polys) {
    if (pts.length === 1 && len(sub(pts[0], local)) <= r) return true;
    for (let i = 1; i < pts.length; i++) if (distToSegment(local, pts[i - 1], pts[i]) <= r) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Edits: each returns a new VectorData; callers wrap them in mutate / a transaction.

/** Constrain `p` to 0/45/90° steps around `origin`, keeping its distance along that direction. */
export function snapAngle(origin: Vec2, p: Vec2, stepDeg = 45): Vec2 {
  const d = sub(p, origin);
  const l = len(d);
  if (!l) return { ...p };
  const step = (stepDeg * Math.PI) / 180;
  const a = Math.round(Math.atan2(d.y, d.x) / step) * step;
  const ux = Math.cos(a),
    uy = Math.sin(a);
  const k = d.x * ux + d.y * uy;
  return { x: origin.x + (Math.abs(ux) < 1e-12 ? 0 : ux * k), y: origin.y + (Math.abs(uy) < 1e-12 ? 0 : uy * k) };
}

export function startPath(v: VectorData, pts: VectorPoint[]): VectorData {
  return { paths: [...v.paths, { points: pts.map(clonePoint), closed: false }] };
}

export function appendPoint(v: VectorData, path: number, pt: VectorPoint): VectorData {
  const out = cloneVector(v);
  out.paths[path].points.push(clonePoint(pt));
  return out;
}

export function closePath(v: VectorData, path: number): VectorData {
  const out = cloneVector(v);
  out.paths[path].closed = true;
  return out;
}

/** Reverse a subpath's direction (handles swap sides). */
export function reversePath(p: VectorPath): VectorPath {
  return {
    ...p,
    points: [...p.points].reverse().map((q) => {
      const n: VectorPoint = { x: q.x, y: q.y, mirror: q.mirror, ...(q.radius !== undefined ? { radius: q.radius } : {}) };
      if (q.out) n.in = { ...q.out };
      if (q.in) n.out = { ...q.in };
      return n;
    }),
  };
}

/** Add an anchor on a segment at t without changing the curve. */
export function splitSegment(v: VectorData, ref: SegRef, t: number): { v: VectorData; point: PointRef } {
  const out = cloneVector(v);
  const path = out.paths[ref.path];
  const pts = path.points;
  const c = segmentCubic(out, ref);
  const ai = ref.seg,
    bi = (ref.seg + 1) % pts.length;
  const a = pts[ai],
    b = pts[bi];
  let mid: VectorPoint;
  if (isLine(c)) mid = { ...lerp(c[0], c[3], t), mirror: "none" };
  else {
    const [l, r] = splitCubic(c, t);
    const m = l[3];
    const i = sub(l[2], m),
      o = sub(r[1], m);
    a.out = sub(l[1], a);
    b.in = sub(r[2], b);
    if (!hasH(a.out)) delete a.out;
    if (!hasH(b.in)) delete b.in;
    mid = { x: m.x, y: m.y, mirror: "none", ...(hasH(i) ? { in: i } : {}), ...(hasH(o) ? { out: o } : {}) };
    mid.mirror = hasH(i) && hasH(o) ? (Math.abs(len(i) - len(o)) <= 0.01 * Math.max(len(i), len(o)) ? "angle-length" : "angle") : "none";
  }
  pts.splice(ai + 1, 0, mid);
  return { v: out, point: { path: ref.path, point: ai + 1 } };
}

/** Move anchors (their handles ride along). */
export function movePoints(v: VectorData, refs: PointRef[], dx: number, dy: number): VectorData {
  const out = cloneVector(v);
  for (const r of refs) {
    const p = out.paths[r.path]?.points[r.point];
    if (!p) continue;
    p.x += dx;
    p.y += dy;
  }
  return out;
}

/**
 * Set one handle (offset from its anchor). The anchor's mirroring updates the other handle:
 * angle-length mirrors exactly, angle keeps the other's length. `breakMirror` (⌥) frees the pair.
 */
export function setHandle(v: VectorData, ref: HandleRef, offset: Vec2, opts: { breakMirror?: boolean; snap45?: boolean } = {}): VectorData {
  const out = cloneVector(v);
  const p = out.paths[ref.path].points[ref.point];
  const o = opts.snap45 ? snapAngle({ x: 0, y: 0 }, offset) : { ...offset };
  p[ref.side] = o;
  const other = ref.side === "in" ? "out" : "in";
  if (opts.breakMirror) p.mirror = "none";
  else if (p.mirror === "angle-length") p[other] = { x: -o.x, y: -o.y };
  else if (p.mirror === "angle" && hasH(p[other])) {
    const l = len(p[other]!),
      lo = len(o);
    if (lo > EPS) p[other] = { x: (-o.x / lo) * l, y: (-o.y / lo) * l };
  }
  return out;
}

/** Corner ↔ smooth. A corner gets a tangent along next − prev and handles a third of each neighbour's distance. */
export function toggleSmooth(v: VectorData, ref: PointRef): VectorData {
  const out = cloneVector(v);
  const path = out.paths[ref.path];
  const pts = path.points;
  const p = pts[ref.point];
  if (hasH(p.in) || hasH(p.out)) {
    delete p.in;
    delete p.out;
    p.mirror = "none";
    return out;
  }
  const n = pts.length;
  const prev = ref.point > 0 ? pts[ref.point - 1] : path.closed ? pts[n - 1] : null;
  const next = ref.point < n - 1 ? pts[ref.point + 1] : path.closed ? pts[0] : null;
  const a = prev ?? p,
    b = next ?? p;
  const tan = sub(b, a);
  const tl = len(tan);
  if (tl < EPS) return out;
  const u = { x: tan.x / tl, y: tan.y / tl };
  const li = prev ? len(sub(p, prev)) / 3 : 0,
    lo = next ? len(sub(next, p)) / 3 : 0;
  if (li) p.in = { x: -u.x * li, y: -u.y * li };
  if (lo) p.out = { x: u.x * lo, y: u.y * lo };
  p.mirror = li && lo ? "angle" : "none";
  return out;
}

/**
 * Bend a segment so the point at `t` passes through `target` (Inkscape's curve drag weights).
 * `t` is clamped away from the ends, where the drag would need huge handles.
 */
export function bendSegment(v: VectorData, ref: SegRef, t: number, target: Vec2): VectorData {
  t = Math.max(0.05, Math.min(0.95, t));
  const out = cloneVector(v);
  const pts = out.paths[ref.path].points;
  const a = pts[ref.seg],
    b = pts[(ref.seg + 1) % pts.length];
  const c = segmentCubic(out, ref);
  const delta = sub(target, cubicAt(c, t));
  const w = t <= 1 / 6 ? 0 : t <= 0.5 ? Math.pow((6 * t - 1) / 2, 3) / 2 : t <= 5 / 6 ? (1 - Math.pow((6 * (1 - t) - 1) / 2, 3)) / 2 + 0.5 : 1;
  const k1 = (1 - w) / (3 * t * (1 - t) * (1 - t)),
    k2 = w / (3 * t * t * (1 - t));
  const p1 = add(c[1], { x: delta.x * k1, y: delta.y * k1 }),
    p2 = add(c[2], { x: delta.x * k2, y: delta.y * k2 });
  a.out = sub(p1, a);
  b.in = sub(p2, b);
  // Smooth anchors stay smooth: their other handle follows.
  for (const [pt, side] of [
    [a, "out"],
    [b, "in"],
  ] as const) {
    const other = side === "in" ? "out" : "in";
    const o = pt[side]!;
    if (pt.mirror === "angle-length") pt[other] = { x: -o.x, y: -o.y };
    else if (pt.mirror === "angle" && hasH(pt[other]) && len(o) > EPS) {
      const l = len(pt[other]!);
      pt[other] = { x: (-o.x / len(o)) * l, y: (-o.y / len(o)) * l };
    }
  }
  return out;
}

/**
 * Delete anchors and the segments touching them (Figma's plain delete, which breaks the shape):
 * an open path splits at an interior point, a closed path opens there, and subpaths left with
 * fewer than 2 points disappear. (Delete-and-heal lives with the curve fitting, vector-fit.ts.)
 */
export function deletePoints(v: VectorData, refs: PointRef[]): VectorData {
  const gone = new Set(refs.map((r) => `${r.path}:${r.point}`));
  const paths: VectorPath[] = [];
  v.paths.forEach((p, pi) => {
    const keep = (i: number) => !gone.has(`${pi}:${i}`);
    let pts = p.points.map((q, i) => ({ q, i }));
    if (pts.every(({ i }) => keep(i))) {
      paths.push({ ...p, points: p.points.map(clonePoint) });
      return;
    }
    if (p.closed) {
      // Open the ring after the first deleted point so the runs read in order.
      const cut = pts.findIndex(({ i }) => !keep(i));
      pts = [...pts.slice(cut + 1), ...pts.slice(0, cut + 1)];
    }
    let run: VectorPoint[] = [];
    const flush = () => {
      if (run.length > 1) {
        delete run[0].in;
        delete run[run.length - 1].out;
        paths.push({ points: run, closed: false });
      }
      run = [];
    };
    for (const { q, i } of pts) {
      if (keep(i)) run.push(clonePoint(q));
      else flush();
    }
    flush();
  });
  return { paths };
}

/** Through an affine map (control points map exactly): handles take only its linear part. */
export function transformVector(v: VectorData, m: [number, number, number, number, number, number]): VectorData {
  return mapVector(
    v,
    (p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }),
    (o) => ({ x: m[0] * o.x + m[2] * o.y, y: m[1] * o.x + m[3] * o.y }),
  );
}

/** Whether the anchor is the start or end of an open subpath (where the pen can continue). */
export function isEndpoint(v: VectorData, r: PointRef): "start" | "end" | null {
  const p = v.paths[r.path];
  if (!p || p.closed || p.points.length < 1) return null;
  if (r.point === p.points.length - 1) return "end";
  if (r.point === 0) return "start";
  return null;
}

/** Give a corner anchor smooth handles (no-op for one that already has some). */
function smoothen(v: VectorData, r: PointRef): VectorData {
  const p = v.paths[r.path]?.points[r.point];
  return p && !hasH(p.in) && !hasH(p.out) ? toggleSmooth(v, r) : v;
}

/**
 * Join two open endpoints (⌘J; ⇧⌘J makes the join smooth): the two ends of one subpath close it,
 * ends of different subpaths become one subpath. Coincident ends merge into one anchor.
 * Returns null when the pair can't be joined. `point` is where the join landed.
 */
export function joinEndpoints(v: VectorData, a: PointRef, b: PointRef, smooth = false): { v: VectorData; point: PointRef } | null {
  const ea = isEndpoint(v, a),
    eb = isEndpoint(v, b);
  if (!ea || !eb) return null;
  if (a.path === b.path) {
    if (a.point === b.point) return null;
    let out = closePath(v, a.path);
    const path = out.paths[a.path];
    const first = path.points[0],
      last = path.points[path.points.length - 1];
    if (path.points.length > 2 && Math.hypot(first.x - last.x, first.y - last.y) < 0.5) {
      if (last.in) first.in = last.in;
      path.points.pop();
      first.mirror = inferMirror(first);
    }
    if (smooth) {
      out = smoothen(out, { path: a.path, point: 0 });
      out = smoothen(out, { path: a.path, point: out.paths[a.path].points.length - 1 });
    }
    return { v: out, point: { path: a.path, point: 0 } };
  }
  // a's path runs into a, then b's path runs on from b.
  const pa = ea === "end" ? v.paths[a.path] : reversePath(v.paths[a.path]);
  const pb = eb === "start" ? v.paths[b.path] : reversePath(v.paths[b.path]);
  const left = pa.points.map(clonePoint),
    right = pb.points.map(clonePoint);
  const joinAt = left.length - 1;
  const l = left[left.length - 1],
    r = right[0];
  const fused = Math.hypot(l.x - r.x, l.y - r.y) < 0.5;
  if (fused) {
    if (r.out) l.out = r.out;
    else delete l.out;
    right.shift();
    l.mirror = inferMirror(l);
  }
  const merged: VectorPath = { points: [...left, ...right], closed: false };
  const paths = v.paths.filter((_, i) => i !== a.path && i !== b.path);
  const at = Math.min(a.path, b.path);
  paths.splice(at, 0, merged);
  let out: VectorData = { paths: paths.map((p) => (p === merged ? p : { ...p, points: p.points.map(clonePoint) })) };
  if (smooth) {
    out = smoothen(out, { path: at, point: joinAt });
    if (!fused) out = smoothen(out, { path: at, point: joinAt + 1 });
  }
  return { v: out, point: { path: at, point: joinAt } };
}

/**
 * Cut a subpath at an anchor (the cut tool): an open path splits in two that share the anchor's
 * position, a closed path opens there. An open path's end anchor has nothing to cut.
 */
export function cutAt(v: VectorData, r: PointRef): VectorData {
  const p = v.paths[r.path];
  if (!p) return v;
  const pts = p.points;
  const out = cloneVector(v);
  const at = pts[r.point];
  if (p.closed) {
    const ring = [...pts.slice(r.point), ...pts.slice(0, r.point)].map(clonePoint);
    const head = { ...clonePoint(at) };
    const tail = { ...clonePoint(at) };
    delete head.in;
    delete tail.out;
    head.mirror = tail.mirror = "none";
    ring[0] = head;
    ring.push(tail);
    out.paths[r.path] = { ...p, points: ring, closed: false };
    return out;
  }
  if (r.point === 0 || r.point === pts.length - 1) return v;
  const a = pts.slice(0, r.point + 1).map(clonePoint),
    b = pts.slice(r.point).map(clonePoint);
  delete a[a.length - 1].out;
  delete b[0].in;
  a[a.length - 1].mirror = b[0].mirror = "none";
  out.paths.splice(r.path, 1, { ...p, points: a, closed: false }, { ...p, points: b, closed: false });
  return out;
}

/**
 * Set anchors' handle mirroring (the Design panel's Mirroring control). Angle lines the incoming
 * handle up with the outgoing one; angle and length also matches its length. A corner switched to
 * a mirrored mode grows smooth handles first.
 */
export function setMirror(v: VectorData, refs: PointRef[], mode: Mirror): VectorData {
  let out = cloneVector(v);
  for (const r of refs) {
    if (!out.paths[r.path]?.points[r.point]) continue;
    if (mode !== "none") out = smoothen(out, r);
    const p = out.paths[r.path].points[r.point];
    p.mirror = mode;
    if (mode === "none" || !hasH(p.out) || !hasH(p.in)) continue;
    const lo = len(p.out),
      li = len(p.in);
    const l = mode === "angle-length" ? (lo + li) / 2 : li;
    // The outgoing handle keeps its direction; the incoming one turns to face it.
    const u = { x: p.out.x / lo, y: p.out.y / lo };
    p.in = { x: -u.x * l, y: -u.y * l };
    if (mode === "angle-length") p.out = { x: u.x * l, y: u.y * l };
  }
  return out;
}
