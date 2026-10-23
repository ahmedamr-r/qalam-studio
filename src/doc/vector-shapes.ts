import type { TokenSet } from "@/design-system/resolve";
import { activeTokens } from "@/design-system/registry";
import { makePath } from "./factory";
import type { Doc, Paint, PathNode, StrokeEnd, Vec2, VectorData, VectorPath, VectorShape } from "./schema";
import { type Cubic, cubicAt, segCount, segmentCubic, splitCubic, writeVector } from "./vector";

/*
 * Vector presets and parametric shapes (line, arrow, polygon, star), and the geometry of stroke
 * ends (caps and arrowheads). Pure TS: the renderer, hit test and export all build on it.
 */

const pt = (x: number, y: number) => ({ x, y, mirror: "none" as const });

/**
 * A new user vector with Figma's defaults: stroked with the icon colour (or `ink`, see `defaultInk`),
 * no fill, butt ends, miter joins.
 */
export function makeVector(p: Partial<PathNode> = {}, ts: TokenSet = activeTokens(), ink?: Paint): PathNode {
  const width = ts.dimension("border-width.default") ?? 1;
  const n = makePath("", {
    name: "Vector",
    w: 0,
    h: 0,
    vw: 0,
    vh: 0,
    fill: null,
    stroke: { ...(ink ?? { color: ts.color("icon.primary") ?? "#000000", token: "icon.primary" }), width },
    ends: { start: "none", end: "none" },
    join: "miter",
    ...p,
  }, ts);
  writeVector(n, p.vector ?? { paths: [] });
  return n;
}

/** Perceived lightness (0–1) and alpha of a #RRGGBB(AA) paint colour; null for anything else. */
function lightness(hex: string): { l: number; a: number } | null {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex);
  if (!m) return null;
  const c = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  return { l: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
}

/**
 * The ink a new stroke-only vector (pen, pencil, line, arrow) gets: Figma's dark icon colour, or the
 * inverse one where that would vanish. What it is drawn on decides: the nearest mostly-opaque fill
 * among the frames around it, else the canvas itself (`canvasDark`: the studio's dark theme).
 */
export function defaultInk(doc: Doc, parentId: string | null, canvasDark: boolean, ts: TokenSet = activeTokens()): Paint {
  let dark = canvasDark;
  for (let id = parentId; id; id = doc.nodes[id]?.parentId ?? null) {
    const n = doc.nodes[id];
    const fill = n && n.visible && n.type === "frame" ? lightness(n.fill?.color ?? "") : null;
    if (fill && fill.a >= 0.5) {
      dark = fill.l < 0.5;
      break;
    }
  }
  if (!dark) return { color: ts.color("icon.primary") ?? "#000000", token: "icon.primary" };
  const inverse = ts.color("icon.inverse");
  return inverse ? { color: inverse, token: "icon.inverse" } : { color: "#FFFFFF" };
}

// ---------------------------------------------------------------------------
// Line / arrow (Figma's LINE: w = length, h = 0, rotation = angle)

/** A line from A to B in parent space: length along x, rotated about its centre. */
export function lineGeometry(a: Vec2, b: Vec2): Pick<PathNode, "x" | "y" | "w" | "h" | "vw" | "vh" | "rotation"> & { vector: VectorData } {
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  const deg = L ? (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI : 0;
  const rotation = Object.is(deg, -0) ? 0 : Math.round(deg * 100) / 100;
  return {
    x: (a.x + b.x) / 2 - L / 2,
    y: (a.y + b.y) / 2,
    w: L,
    h: 0,
    vw: L,
    vh: 0,
    rotation,
    vector: { paths: [{ points: [pt(0, 0), pt(L, 0)], closed: false }] },
  };
}

export function makeLine(a: Vec2, b: Vec2, arrow = false, ts: TokenSet = activeTokens(), ink?: Paint): PathNode {
  const g = lineGeometry(a, b);
  return makeVector({ ...g, name: arrow ? "Arrow" : "Line", shape: { kind: "line" }, ends: { start: "none", end: arrow ? "arrow-lines" : "none" } }, ts, ink);
}

/** Write a line's geometry onto an existing node (keeps its paints and ends). */
export function setLine(n: PathNode, a: Vec2, b: Vec2) {
  const { vector, ...g } = lineGeometry(a, b);
  Object.assign(n, g);
  writeVector(n, vector);
}

// ---------------------------------------------------------------------------
// Polygon / star

export const POLYGON_DEFAULT = 3;
export const STAR_DEFAULT = { count: 5, ratio: 0.382 };
export const clampCount = (c: number) => Math.max(3, Math.min(60, Math.round(c)));

/** Unit points fitted to fill a w × h box (apex at top-centre, like Figma). */
function fitToBox(points: Vec2[], w: number, h: number): VectorData {
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const x0 = Math.min(...xs),
    y0 = Math.min(...ys);
  const bw = Math.max(...xs) - x0 || 1,
    bh = Math.max(...ys) - y0 || 1;
  return { paths: [{ points: points.map((p) => pt(((p.x - x0) / bw) * w, ((p.y - y0) / bh) * h)), closed: true }] };
}

export function polygonVector(count: number, w: number, h: number): VectorData {
  const n = clampCount(count);
  const pts = Array.from({ length: n }, (_, k) => {
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / n;
    return { x: Math.cos(a), y: Math.sin(a) };
  });
  return fitToBox(pts, w, h);
}

/** `ratio`: inner radius over outer radius (0–1). */
export function starVector(count: number, ratio: number, w: number, h: number): VectorData {
  const n = clampCount(count);
  const r = Math.max(0, Math.min(1, ratio));
  const pts = Array.from({ length: n * 2 }, (_, k) => {
    const a = -Math.PI / 2 + (k * Math.PI) / n;
    const rad = k % 2 ? r : 1;
    return { x: Math.cos(a) * rad, y: Math.sin(a) * rad };
  });
  return fitToBox(pts, w, h);
}

/** The vector of a parametric shape in a w × h box. */
export function shapeVector(shape: VectorShape, w: number, h: number): VectorData {
  if (shape.kind === "polygon") return polygonVector(shape.count, w, h);
  if (shape.kind === "star") return starVector(shape.count, shape.ratio, w, h);
  return { paths: [{ points: [pt(0, 0), pt(w, 0)], closed: false }] };
}

export function makeShapeVector(kind: "polygon" | "star", box: { x: number; y: number; w: number; h: number }, ts: TokenSet = activeTokens()): PathNode {
  const shape: VectorShape = kind === "polygon" ? { kind, count: POLYGON_DEFAULT } : { kind, ...STAR_DEFAULT };
  const n = makeVector(
    {
      ...box,
      vw: box.w,
      vh: box.h,
      name: kind === "polygon" ? "Polygon" : "Star",
      shape,
      fill: { color: ts.color("bg.surface") ?? "#FFFFFF", token: "bg.surface" },
      stroke: null,
    },
    ts,
  );
  writeVector(n, shapeVector(shape, box.w, box.h));
  return n;
}

/** Regenerate a parametric shape for its current vector box (w and h when it is resized). */
export function setShapeBox(n: PathNode, box: { x: number; y: number; w: number; h: number }) {
  Object.assign(n, box);
  n.vw = box.w;
  n.vh = box.h;
  if (n.shape) writeVector(n, shapeVector(n.shape, box.w, box.h));
}

// ---------------------------------------------------------------------------
// Stroke ends

/** Arrowhead proportions, eyeballed against Figma (sw = stroke width). One table to tune. */
export const HEADS = {
  wingAngle: 35,
  wing: (sw: number) => 3 * sw + 4,
  triangle: (sw: number) => 3 * sw + 6,
  circle: (sw: number) => 1.5 * sw + 2,
  diamond: (sw: number) => 1.5 * sw + 2.5,
};

const SKIA_CAPS = new Set<StrokeEnd>(["none", "round", "square"]);

export interface StrokePlan {
  /** Cap for the body: the ends are plain caps when both are the same plain cap. */
  cap: "butt" | "round" | "square";
  /** The stroke's centre line (trimmed under filled heads); null = draw the node's own path. */
  body: VectorData | null;
  /** Heads filled with the stroke colour (path data, node px). */
  fill: string;
  /** Heads stroked like the body (line arrows). */
  stroke: string;
}

const f = (v: number) => String(Math.round(v * 100) / 100);
const norm = (v: Vec2): Vec2 => {
  const l = Math.hypot(v.x, v.y);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l } : { x: 1, y: 0 };
};
const polyD = (pts: Vec2[], close = true) => pts.map((p, i) => `${i ? "L" : "M"}${f(p.x)} ${f(p.y)}`).join("") + (close ? "Z" : "");
const circleD = (c: Vec2, r: number) => `M${f(c.x - r)} ${f(c.y)}A${f(r)} ${f(r)} 0 1 0 ${f(c.x + r)} ${f(c.y)}A${f(r)} ${f(r)} 0 1 0 ${f(c.x - r)} ${f(c.y)}Z`;

/** The end's position and outward direction (from the nearest distinct control point). */
export function endTangent(p: VectorPath, which: "start" | "end"): { at: Vec2; dir: Vec2 } | null {
  const pts = p.points;
  if (pts.length < 2) return null;
  const c: Cubic = which === "end" ? segmentCubic({ paths: [p] }, { path: 0, seg: pts.length - 2 }) : segmentCubic({ paths: [p] }, { path: 0, seg: 0 });
  const [e, n1, n2, far] = which === "end" ? [c[3], c[2], c[1], c[0]] : [c[0], c[1], c[2], c[3]];
  const from = [n1, n2, far].find((q) => Math.hypot(q.x - e.x, q.y - e.y) > 1e-6);
  if (!from) return null;
  return { at: e, dir: norm({ x: e.x - from.x, y: e.y - from.y }) };
}

/** Body trim under a filled head: far enough that a butt end never pokes out of it. */
function headTrim(end: StrokeEnd, sw: number): number {
  switch (end) {
    case "arrow-triangle":
      return 0.8 * HEADS.triangle(sw) * (Math.sqrt(3) / 2);
    case "triangle-reversed":
      return 0.5 * HEADS.triangle(sw) * (Math.sqrt(3) / 2);
    case "circle": {
      const r = HEADS.circle(sw);
      return Math.sqrt(Math.max(0, r * r - (sw / 2) ** 2));
    }
    case "diamond":
      return Math.max(0, HEADS.diamond(sw) - sw / 2);
    default:
      return 0;
  }
}

/** Geometry of one end: filled and stroked parts. */
function headGeometry(end: StrokeEnd, at: Vec2, u: Vec2, sw: number): { fill?: string; stroke?: string } {
  const nrm = { x: -u.y, y: u.x };
  const P = (a: number, b: number) => ({ x: at.x + u.x * a + nrm.x * b, y: at.y + u.y * a + nrm.y * b });
  switch (end) {
    case "round":
      return { fill: circleD(at, sw / 2) };
    case "square":
      return { fill: polyD([P(-sw / 2, -sw / 2), P(sw / 2, -sw / 2), P(sw / 2, sw / 2), P(-sw / 2, sw / 2)]) };
    case "arrow-lines": {
      const a = (HEADS.wingAngle * Math.PI) / 180,
        l = HEADS.wing(sw);
      return { stroke: polyD([P(-Math.cos(a) * l, Math.sin(a) * l), P(0, 0), P(-Math.cos(a) * l, -Math.sin(a) * l)], false) };
    }
    case "arrow-triangle": {
      const s = HEADS.triangle(sw),
        h = (s * Math.sqrt(3)) / 2;
      return { fill: polyD([P(0, 0), P(-h, s / 2), P(-h, -s / 2)]) };
    }
    case "triangle-reversed": {
      const s = HEADS.triangle(sw),
        h = (s * Math.sqrt(3)) / 2;
      return { fill: polyD([P(0, s / 2), P(-h, 0), P(0, -s / 2)]) };
    }
    case "circle":
      return { fill: circleD(at, HEADS.circle(sw)) };
    case "diamond": {
      const d = HEADS.diamond(sw);
      return { fill: polyD([P(d, 0), P(0, d), P(-d, 0), P(0, -d)]) };
    }
    default:
      return {};
  }
}

/** The t (from the end) where the arc length along the cubic from that end reaches `dist`; null if it's longer. */
function trimT(c: Cubic, dist: number, fromEnd: boolean): number | null {
  const N = 32;
  let acc = 0;
  let prev = cubicAt(c, fromEnd ? 1 : 0);
  for (let k = 1; k <= N; k++) {
    const t = fromEnd ? 1 - k / N : k / N;
    const q = cubicAt(c, t);
    const step = Math.hypot(q.x - prev.x, q.y - prev.y);
    if (acc + step >= dist) {
      const frac = step ? (dist - acc) / step : 0;
      const tPrev = fromEnd ? 1 - (k - 1) / N : (k - 1) / N;
      return tPrev + (t - tPrev) * frac;
    }
    acc += step;
    prev = q;
  }
  return null;
}

/** Shorten an open path's end by `dist` along the curve (drops the end segment if it's shorter). */
function trimPath(p: VectorPath, which: "start" | "end", dist: number): VectorPath {
  if (dist <= 0 || p.points.length < 2) return p;
  const pts = p.points.map((q) => ({ ...q }));
  const segIx = which === "end" ? pts.length - 2 : 0;
  const c = segmentCubic({ paths: [{ points: pts, closed: false }] }, { path: 0, seg: segIx });
  const t = trimT(c, dist, which === "end");
  if (t === null) return { points: pts.length > 2 ? (which === "end" ? pts.slice(0, -1) : pts.slice(1)) : pts.slice(0, 1), closed: false };
  const [l, r] = splitCubic(c, t);
  const keep = which === "end" ? l : r;
  const a = which === "end" ? pts[segIx] : null;
  if (which === "end") {
    const b = pts[segIx + 1];
    a!.out = { x: keep[1].x - keep[0].x, y: keep[1].y - keep[0].y };
    b.x = keep[3].x;
    b.y = keep[3].y;
    b.in = { x: keep[2].x - keep[3].x, y: keep[2].y - keep[3].y };
  } else {
    const s = pts[0],
      b = pts[1];
    s.x = keep[0].x;
    s.y = keep[0].y;
    s.out = { x: keep[1].x - keep[0].x, y: keep[1].y - keep[0].y };
    b.in = { x: keep[2].x - keep[3].x, y: keep[2].y - keep[3].y };
  }
  return { points: pts, closed: false };
}

/**
 * How to draw a stroke's ends. `v` is in node px. Plain matching caps go to Skia; anything else is
 * drawn as geometry on butt ends, with the body trimmed under filled heads.
 */
export function strokeEnds(v: VectorData, sw: number, ends: PathNode["ends"]): StrokePlan {
  if (!ends) return { cap: "round", body: null, fill: "", stroke: "" };
  if (ends.start === ends.end && SKIA_CAPS.has(ends.start)) return { cap: ends.start === "none" ? "butt" : (ends.start as "round" | "square"), body: null, fill: "", stroke: "" };
  let fill = "",
    stroke = "";
  const paths = v.paths.map((p) => {
    if (p.closed || p.points.length < 2 || segCount(p) < 1) return p;
    let body = p;
    for (const which of ["start", "end"] as const) {
      const end = ends[which];
      const tan = endTangent(p, which);
      if (!tan || end === "none") continue;
      const g = headGeometry(end, tan.at, tan.dir, sw);
      fill += g.fill ?? "";
      stroke += g.stroke ?? "";
      body = trimPath(body, which, headTrim(end, sw));
    }
    return body;
  });
  return { cap: "butt", body: { paths }, fill, stroke };
}

/** How far the stroke (and its heads) can reach outside the curve's box, for export padding. */
export function strokeOverhang(n: Pick<PathNode, "stroke" | "ends" | "join">): number {
  const sw = n.stroke && n.stroke.width > 0 ? n.stroke.width : 0;
  if (!sw) return 0;
  // Miter joins reach up to the miter limit (4) times half the width.
  let reach = n.join === "miter" ? sw * 2 : sw / 2;
  for (const e of n.ends ? [n.ends.start, n.ends.end] : []) {
    if (e === "square") reach = Math.max(reach, (sw / 2) * Math.SQRT2);
    else if (e === "arrow-lines") reach = Math.max(reach, HEADS.wing(sw) + sw);
    else if (e === "arrow-triangle" || e === "triangle-reversed") reach = Math.max(reach, HEADS.triangle(sw));
    else if (e === "circle") reach = Math.max(reach, HEADS.circle(sw));
    else if (e === "diamond") reach = Math.max(reach, HEADS.diamond(sw));
  }
  return reach;
}
