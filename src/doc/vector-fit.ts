import type { Vec2, VectorData, VectorPath, VectorPoint } from "./schema";
import { type Cubic, type PointRef, cubicAt, inferMirror, segmentCubic, splitCubic } from "./vector";

/*
 * Curve fitting for the pencil and for delete-and-heal: spacing decimation, Ramer–Douglas–Peucker,
 * corner splitting and Philip J. Schneider's least-squares cubic fit ("An Algorithm for
 * Automatically Fitting Digitized Curves", Graphics Gems, 1990; the shape of Paper.js's PathFitter).
 * Pure TS, in whatever units the caller's points are in.
 */

const EPS = 1e-12;
const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, y: a.y * k });
const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
const len = (a: Vec2) => Math.hypot(a.x, a.y);
const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (a: Vec2): Vec2 => {
  const l = len(a);
  return l > EPS ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};
const withLen = (a: Vec2, l: number) => scale(unit(a), l);

/** Drop samples closer than `minDist` to the last kept one (the final sample is always kept). */
export function decimate(pts: Vec2[], minDist: number): Vec2[] {
  if (pts.length < 3) return pts.slice();
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) if (dist(pts[i], out[out.length - 1]) >= minDist) out.push(pts[i]);
  const last = pts[pts.length - 1];
  if (dist(last, out[out.length - 1]) < minDist * 0.5 && out.length > 1) out[out.length - 1] = last;
  else out.push(last);
  return out;
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const d = sub(b, a);
  const l2 = dot(d, d);
  const t = l2 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / l2)) : 0;
  return dist(p, add(a, scale(d, t)));
}

/** Ramer–Douglas–Peucker: the fewest samples that stay within `eps` of the polyline. */
export function rdp(pts: Vec2[], eps: number): Vec2[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = -1,
      bd = eps;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(pts[i], pts[a], pts[b]);
      if (d > bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * Split a stroke where it turns by more than `angleDeg`, measured between the chords `window`
 * samples either side. The corner sample ends one run and starts the next.
 */
export function splitAtCorners(pts: Vec2[], angleDeg = 80, window = 3): Vec2[][] {
  if (pts.length < 2 * window + 1) return [pts];
  const limit = (angleDeg * Math.PI) / 180;
  const turn = pts.map((p, i) => {
    if (i < window || i >= pts.length - window) return 0;
    const a = sub(p, pts[i - window]),
      b = sub(pts[i + window], p);
    const la = len(a),
      lb = len(b);
    if (la < EPS || lb < EPS) return 0;
    return Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (la * lb))));
  });
  const corners: number[] = [];
  for (let i = window; i < pts.length - window; i++) {
    if (turn[i] <= limit) continue;
    // One corner per sharp turn: the sample that turns most among its neighbours.
    let j = i;
    while (j + 1 < pts.length - window && turn[j + 1] > limit) j++;
    let best = i;
    for (let k = i; k <= j; k++) if (turn[k] > turn[best]) best = k;
    corners.push(best);
    i = j;
  }
  if (!corners.length) return [pts];
  const runs: Vec2[][] = [];
  let from = 0;
  for (const c of corners) {
    runs.push(pts.slice(from, c + 1));
    from = c;
  }
  runs.push(pts.slice(from));
  return runs.filter((r) => r.length > 1);
}

// ---------------------------------------------------------------------------
// Schneider

function chordParams(pts: Vec2[], first: number, last: number): number[] {
  const u = [0];
  for (let i = first + 1; i <= last; i++) u.push(u[u.length - 1] + dist(pts[i], pts[i - 1]));
  const total = u[u.length - 1];
  return total > EPS ? u.map((x) => x / total) : u.map((_, i) => i / (u.length - 1));
}

/** Least-squares handle lengths along fixed end tangents (tan1 leaves the start, tan2 leaves the end backwards). */
function generateBezier(pts: Vec2[], first: number, last: number, u: number[], tan1: Vec2, tan2: Vec2): Cubic {
  const p1 = pts[first],
    p2 = pts[last];
  let c00 = 0,
    c01 = 0,
    c11 = 0,
    x0 = 0,
    x1 = 0;
  for (let i = 0; i <= last - first; i++) {
    const t = u[i],
      s = 1 - t,
      b = 3 * t * s;
    const b0 = s * s * s,
      b1 = b * s,
      b2 = b * t,
      b3 = t * t * t;
    const a1 = withLen(tan1, b1),
      a2 = withLen(tan2, b2);
    const tmp = sub(sub(pts[first + i], scale(p1, b0 + b1)), scale(p2, b2 + b3));
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    x0 += dot(a1, tmp);
    x1 += dot(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let alpha1: number, alpha2: number;
  if (Math.abs(det) > EPS) {
    alpha1 = (x0 * c11 - x1 * c01) / det;
    alpha2 = (c00 * x1 - c01 * x0) / det;
  } else {
    const c0 = c00 + c01,
      c1 = c01 + c11;
    alpha1 = alpha2 = Math.abs(c0) > EPS ? x0 / c0 : Math.abs(c1) > EPS ? x1 / c1 : 0;
  }
  const segLen = dist(p1, p2);
  const eps = EPS * segLen;
  let h1: Vec2 | null = null,
    h2: Vec2 | null = null;
  if (alpha1 < eps || alpha2 < eps) alpha1 = alpha2 = segLen / 3;
  else {
    // Handles that overshoot each other loop the curve: fall back to the Wu/Barsky heuristic.
    const line = sub(p2, p1);
    h1 = withLen(tan1, alpha1);
    h2 = withLen(tan2, alpha2);
    if (dot(h1, line) - dot(h2, line) > segLen * segLen) {
      alpha1 = alpha2 = segLen / 3;
      h1 = h2 = null;
    }
  }
  return [p1, add(p1, h1 ?? withLen(tan1, alpha1)), add(p2, h2 ?? withLen(tan2, alpha2)), p2];
}

/** One Newton–Raphson step for the parameter of `p` on the curve. */
function findRoot(c: Cubic, p: Vec2, u: number): number {
  const d1 = [0, 1, 2].map((i) => scale(sub(c[i + 1], c[i]), 3));
  const d2 = [0, 1].map((i) => scale(sub(d1[i + 1], d1[i]), 2));
  const s = 1 - u;
  const pt = cubicAt(c, u);
  const pt1 = add(add(scale(d1[0], s * s), scale(d1[1], 2 * s * u)), scale(d1[2], u * u));
  const pt2 = add(scale(d2[0], s), scale(d2[1], u));
  const diff = sub(pt, p);
  const df = dot(pt1, pt1) + dot(diff, pt2);
  return Math.abs(df) < EPS ? u : u - dot(diff, pt1) / df;
}

function reparameterize(pts: Vec2[], first: number, last: number, u: number[], c: Cubic): boolean {
  for (let i = first; i <= last; i++) u[i - first] = findRoot(c, pts[i], u[i - first]);
  for (let i = 1; i < u.length; i++) if (u[i] <= u[i - 1]) return false;
  return true;
}

function maxError(pts: Vec2[], first: number, last: number, c: Cubic, u: number[]): { error: number; index: number } {
  let index = Math.floor((last - first + 1) / 2),
    max = 0;
  for (let i = first + 1; i < last; i++) {
    const v = sub(cubicAt(c, u[i - first]), pts[i]);
    const d = dot(v, v);
    if (d >= max) {
      max = d;
      index = i;
    }
  }
  return { error: max, index };
}

function fitRange(pts: Vec2[], first: number, last: number, tan1: Vec2, tan2: Vec2, err2: number, out: Cubic[]) {
  if (last - first === 1) {
    const a = pts[first],
      b = pts[last],
      d = dist(a, b) / 3;
    out.push([a, add(a, withLen(tan1, d)), add(b, withLen(tan2, d)), b]);
    return;
  }
  const u = chordParams(pts, first, last);
  // Newton reparameterisation while it keeps improving the fit, then split at the worst sample.
  let limit = Infinity;
  let split = Math.floor((first + last) / 2);
  let ordered = true;
  for (let i = 0; i <= 8; i++) {
    const c = generateBezier(pts, first, last, u, tan1, tan2);
    const m = maxError(pts, first, last, c, u);
    if (m.error < err2 && ordered) {
      out.push(c);
      return;
    }
    split = m.index;
    if (m.error >= limit) break;
    ordered = reparameterize(pts, first, last, u, c);
    limit = m.error;
  }
  split = Math.max(first + 1, Math.min(last - 1, split));
  const centre = unit(sub(pts[split - 1], pts[split + 1]));
  fitRange(pts, first, split, tan1, centre, err2, out);
  fitRange(pts, split, last, scale(centre, -1), tan2, err2, out);
}

/** End tangents of a run: towards the neighbouring sample (Schneider's choice). */
function endTangents(pts: Vec2[]): [Vec2, Vec2] {
  const n = pts.length;
  return [unit(sub(pts[1], pts[0])), unit(sub(pts[n - 2], pts[n - 1]))];
}

/** Hand-drawn ends wobble: aim the end tangents a few samples in instead. */
function runTangents(pts: Vec2[]): [Vec2, Vec2] {
  const n = pts.length;
  const k = Math.min(n - 1, 2);
  return [unit(sub(pts[k], pts[0])), unit(sub(pts[n - 1 - k], pts[n - 1]))];
}

/** Cubics through `pts` within `error` (a distance). Tangents default to the run's own ends. */
export function fitCubics(pts: Vec2[], error: number, tan1?: Vec2, tan2?: Vec2): Cubic[] {
  // Repeated samples break the parameterisation.
  const clean = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > EPS);
  if (clean.length < 2) return [];
  const [t1, t2] = endTangents(clean);
  const out: Cubic[] = [];
  fitRange(clean, 0, clean.length - 1, tan1 ?? t1, tan2 ?? t2, error * error, out);
  return out;
}

/**
 * The one cubic from samples[0] to samples[n-1] leaving and arriving along the given tangents
 * (heal): least squares plus Newton reparameterisation, no splitting.
 */
export function fitOneCubic(samples: Vec2[], tan1: Vec2, tan2: Vec2): Cubic {
  const pts = samples.filter((p, i) => i === 0 || dist(p, samples[i - 1]) > EPS);
  const last = pts.length - 1;
  const u = chordParams(pts, 0, last);
  let best = generateBezier(pts, 0, last, u, tan1, tan2);
  let bestErr = maxError(pts, 0, last, best, u).error;
  for (let i = 0; i < 4; i++) {
    if (!reparameterize(pts, 0, last, u, best)) break;
    const c = generateBezier(pts, 0, last, u, tan1, tan2);
    const e = maxError(pts, 0, last, c, u).error;
    if (e > bestErr) break;
    best = c;
    bestErr = e;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Cubics → anchors

const handle = (a: Vec2, b: Vec2): Vec2 | undefined => {
  const h = sub(b, a);
  return len(h) > 1e-6 ? h : undefined;
};

/**
 * Anchors for runs of cubics joined end to end. Joins inside a run are smooth (`angle`); the
 * corners between runs and the two ends are `none`.
 */
export function cubicsToPath(runs: Cubic[][]): VectorPath {
  const points: VectorPoint[] = [];
  for (const run of runs) {
    run.forEach((c, i) => {
      if (!points.length) points.push({ x: c[0].x, y: c[0].y, mirror: "none" });
      const prev = points[points.length - 1];
      const out = handle(c[0], c[1]);
      if (out) prev.out = out;
      else delete prev.out;
      const inn = handle(c[3], c[2]);
      points.push({ x: c[3].x, y: c[3].y, mirror: "none", ...(inn ? { in: inn } : {}) });
      if (i > 0) prev.mirror = prev.in && prev.out ? "angle" : "none";
    });
  }
  return { points, closed: false };
}

/** Pencil anchors are capped so a long scribble doesn't bloat the document. */
export const PENCIL_MAX_ANCHORS = 400;

/**
 * Freehand samples → an open vector (in the samples' units). `zoom` scales the tolerances so a
 * stroke fits the same on screen at any zoom; `straight` (⇧) keeps only the two ends.
 * Null when the stroke is too short to be anything but a click.
 */
export function pencilToVector(samples: Vec2[], opts: { zoom: number; straight?: boolean }): VectorData | null {
  const z = opts.zoom || 1;
  if (samples.length < 2) return null;
  let length = 0;
  for (let i = 1; i < samples.length; i++) length += dist(samples[i], samples[i - 1]);
  const a = samples[0],
    b = samples[samples.length - 1];
  if (opts.straight) {
    if (dist(a, b) * z < 2) return null;
    return { paths: [{ points: [{ x: a.x, y: a.y, mirror: "none" }, { x: b.x, y: b.y, mirror: "none" }], closed: false }] };
  }
  if (length * z < 2) return null;
  // Over the anchor cap: refit looser, and sample sparser so jitter stops reading as corners.
  let k = 1;
  for (let tries = 0; tries < 16; tries++) {
    const pts = decimate(samples, (1.5 * k) / z);
    const runs = splitAtCorners(pts, 80, 3);
    const path = cubicsToPath(runs.map((r) => fitCubics(r, (1.5 * k) / z, ...runTangents(r))).filter((r) => r.length));
    if (path.points.length <= PENCIL_MAX_ANCHORS || tries === 15) return path.points.length > 1 ? { paths: [path] } : null;
    k *= 1.5;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Delete and heal

/** If `l` and `r` are one cubic split at its shared point, that cubic. */
function unsplit(l: Cubic, r: Cubic): Cubic | null {
  const li = len(sub(l[2], l[3])),
    ro = len(sub(r[1], r[0]));
  if (li < 1e-6 || ro < 1e-6) return null;
  const t = li / (li + ro);
  const c: Cubic = [l[0], add(l[0], scale(sub(l[1], l[0]), 1 / t)), add(r[3], scale(sub(r[2], r[3]), 1 / (1 - t))), r[3]];
  const [a, b] = splitCubic(c, t);
  const tol = 0.01 * Math.max(1, dist(c[0], c[3]));
  const same = (x: Cubic, y: Cubic) => x.every((p, i) => dist(p, y[i]) <= tol);
  return same(a, l) && same(b, r) ? c : null;
}

const isStraight = (c: Cubic) => dist(c[0], c[1]) < 1e-6 && dist(c[2], c[3]) < 1e-6;

/** One cubic standing in for consecutive cubics (the heal of the anchors between them). */
export function healCubics(cs: Cubic[]): Cubic {
  const a = cs[0][0],
    b = cs[cs.length - 1][3];
  if (cs.every(isStraight)) return [a, a, b, b];
  if (cs.length === 2) {
    const exact = unsplit(cs[0], cs[1]);
    if (exact) return exact;
  }
  const samples: Vec2[] = [a];
  const per = Math.max(4, Math.ceil(32 / cs.length));
  for (const c of cs) for (let k = 1; k <= per; k++) samples.push(cubicAt(c, k / per));
  // Tangents: the outer handles, or the chord to the next distinct control point.
  const first = cs[0],
    last = cs[cs.length - 1];
  const t1 = unit(sub(dist(first[1], a) > 1e-6 ? first[1] : dist(first[2], a) > 1e-6 ? first[2] : first[3], a));
  const t2 = unit(sub(dist(last[2], b) > 1e-6 ? last[2] : dist(last[1], b) > 1e-6 ? last[1] : last[0], b));
  return fitOneCubic(samples, t1, t2);
}

/**
 * Delete anchors and rejoin their neighbours with one curve that keeps the shape (Figma's ⇧⌫).
 * An open path's end anchors just go (with their segment); subpaths left with fewer than two
 * anchors disappear.
 */
export function deleteAndHeal(v: VectorData, refs: PointRef[]): VectorData {
  const gone = new Set(refs.map((r) => `${r.path}:${r.point}`));
  const paths: VectorPath[] = [];
  v.paths.forEach((p, pi) => {
    const n = p.points.length;
    const kept = p.points.map((_, i) => i).filter((i) => !gone.has(`${pi}:${i}`));
    if (kept.length === n) {
      paths.push(structuredClone(p));
      return;
    }
    if (kept.length < 2) return;
    const pts = kept.map((i) => structuredClone(p.points[i]));
    const pairs = p.closed ? kept.length : kept.length - 1;
    for (let k = 0; k < pairs; k++) {
      const ia = kept[k],
        ib = kept[(k + 1) % kept.length];
      const steps = (ib - ia + n) % n;
      if (steps <= 1) continue;
      const cs: Cubic[] = [];
      for (let s = 0; s < steps; s++) cs.push(segmentCubic(v, { path: pi, seg: (ia + s) % n }));
      const c = healCubics(cs);
      const A = pts[k],
        B = pts[(k + 1) % pts.length];
      const out = handle(c[0], c[1]),
        inn = handle(c[3], c[2]);
      if (out) A.out = out;
      else delete A.out;
      if (inn) B.in = inn;
      else delete B.in;
      A.mirror = inferMirror(A);
      B.mirror = inferMirror(B);
    }
    if (!p.closed) {
      delete pts[0].in;
      delete pts[pts.length - 1].out;
    }
    paths.push({ ...p, points: pts, closed: p.closed });
  });
  return { paths };
}

