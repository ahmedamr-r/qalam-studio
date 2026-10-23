import type { PathNode } from "./schema";
import { type Seg, parsePath, pathBounds, toD } from "@/design-system/svg-path";
import { ovalSegs, rrectSegs } from "./primitive-segs";
import { type Area, type BoolOp, pathOps } from "./path-ops";

/*
 * Composed shapes: primitives (rectangles, ellipses, polygons, stars, paths) combined in order
 * with union, subtract, intersect or exclude into one outline, the way a designer builds a ticket
 * (a rounded rectangle minus two circles on its edges), a speech bubble (a rectangle plus a
 * triangle), a seal (a star plus a circle) or a ring (a circle minus a circle).
 *
 * Each part is drawn at a reference size and pinned like a Figma constraint, so the outline is
 * rebuilt for any size: a notch pinned to the end edge stays on it, a body pinned to both edges
 * stretches, and circles stay circles. The layer keeps its recipe, and layout rebuilds its path
 * whenever its size changes (applyRecipe). The area maths is Skia's, through path-ops.ts.
 */

export type ShapeKind = "rect" | "ellipse" | "polygon" | "star" | "path";
export type PinX = "start" | "end" | "center" | "stretch" | "scale";
export type PinY = "top" | "bottom" | "center" | "stretch" | "scale";
/** How a part joins the parts before it ("base" starts the outline). */
export type ShapeOp = "base" | BoolOp;

export interface ShapePart {
  kind: ShapeKind;
  op: ShapeOp;
  /** Box at the reference size, x from the start edge. A path's box is its own bounds. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rectangle corners, px. */
  radius?: number;
  /** Polygon sides, or star points. */
  count?: number;
  /** Star: inner radius over outer (0–1). */
  ratio?: number;
  /** Degrees clockwise, about the box's centre (polygons and stars). */
  rotation?: number;
  /** Path data at the reference size, in the graphic's coordinates. */
  d?: string;
  pinX: PinX;
  pinY: PinY;
  /**
   * A backdrop's part that lines up with one of its container's parts (1 = the first after the
   * backdrop): centred vertically on it wherever layout puts it, e.g. ticket notches on the tear line.
   */
  centerOn?: number;
}

/** Where a backdrop's container parts sit: the vertical centre of part `i` (1-based) in the layer's px. */
export type Anchors = (i: number) => number | undefined;

export interface ShapeRecipe {
  /** The size the parts were drawn at; an axis left out is whatever size the layer has (its parts don't move on it). */
  ref: { w?: number; h?: number };
  dir: "ltr" | "rtl";
  parts: ShapePart[];
  /** The size (and anchor positions) the layer's path was last built for, and whether the booleans were applied (Skia was ready). */
  built?: { w: number; h: number; exact: boolean; anchors?: number[] };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One axis of a pin: where a span drawn at [p, p + s] in `ref` goes in `size`. */
function pinAxis(pin: PinX | PinY, p: number, s: number, ref: number, size: number): [number, number] {
  switch (pin) {
    case "end":
    case "bottom":
      return [size - (ref - p), s];
    case "center":
      return [p + (size - ref) / 2, s];
    case "stretch":
      return [p, Math.max(0, s + (size - ref))];
    case "scale": {
      const k = ref > 0 ? size / ref : 1;
      return [p * k, s * k];
    }
    default:
      return [p, s];
  }
}

/** A part's box at `size` (logical: x from the start edge). */
export function partBox(part: Pick<ShapePart, "x" | "y" | "w" | "h" | "pinX" | "pinY">, ref: ShapeRecipe["ref"], size: { w: number; h: number }): Box {
  const [x, w] = pinAxis(part.pinX, part.x, part.w, ref.w ?? size.w, size.w);
  const [y, h] = pinAxis(part.pinY, part.y, part.h, ref.h ?? size.h, size.h);
  return { x, y, w, h };
}

/** Points of a regular polygon (count sides) or star (count points), apex up, fitted to the box, then rotated. */
function starPoints(count: number, ratio: number | null, box: Box, rotation = 0): { x: number; y: number }[] {
  const n = Math.max(3, Math.min(24, Math.round(count)));
  const steps = ratio === null ? n : n * 2;
  const unit = Array.from({ length: steps }, (_, k) => {
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / steps;
    const r = ratio !== null && k % 2 ? Math.max(0.05, Math.min(1, ratio)) : 1;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });
  const xs = unit.map((p) => p.x),
    ys = unit.map((p) => p.y);
  const x0 = Math.min(...xs),
    y0 = Math.min(...ys);
  const bw = Math.max(...xs) - x0 || 1,
    bh = Math.max(...ys) - y0 || 1;
  const pts = unit.map((p) => ({ x: box.x + ((p.x - x0) / bw) * box.w, y: box.y + ((p.y - y0) / bh) * box.h }));
  if (!rotation) return pts;
  const t = (rotation * Math.PI) / 180,
    cx = box.x + box.w / 2,
    cy = box.y + box.h / 2;
  return pts.map((p) => ({ x: cx + (p.x - cx) * Math.cos(t) - (p.y - cy) * Math.sin(t), y: cy + (p.x - cx) * Math.sin(t) + (p.y - cy) * Math.cos(t) }));
}

const closed = (pts: { x: number; y: number }[]): Seg[] => [...pts.map((p, i): Seg => ({ c: i ? "L" : "M", x: p.x, y: p.y })), { c: "Z" }];

/** Map segments drawn in box `a` onto box `b`. */
function remap(segs: Seg[], a: Box, b: Box): Seg[] {
  const kx = a.w > 0 ? b.w / a.w : 1,
    ky = a.h > 0 ? b.h / a.h : 1;
  const X = (x: number) => b.x + (x - a.x) * kx,
    Y = (y: number) => b.y + (y - a.y) * ky;
  return segs.map((s) => (s.c === "Z" ? s : s.c === "C" ? { c: "C", x1: X(s.x1), y1: Y(s.y1), x2: X(s.x2), y2: Y(s.y2), x: X(s.x), y: Y(s.y) } : { c: s.c, x: X(s.x), y: Y(s.y) }));
}

/** Mirror for right-to-left: x from the start edge becomes x from the left. */
const mirror = (segs: Seg[], w: number): Seg[] => remap(segs, { x: 0, y: 0, w: 1, h: 1 }, { x: w, y: 0, w: -1, h: 1 });

/** A part's outline at `size`, in the layer's px (left to right). */
export function partSegs(part: ShapePart, recipe: Pick<ShapeRecipe, "ref" | "dir">, size: { w: number; h: number }, anchors?: Anchors): Seg[] {
  const cy = part.centerOn ? anchors?.(part.centerOn) : undefined;
  // Lined up with a container part: its height stays, its centre goes where that part's centre is.
  if (cy !== undefined && part.kind !== "path") part = { ...part, y: cy - part.h / 2, pinY: "top" };
  let segs: Seg[] = [];
  if (part.kind === "path") {
    const parsed = part.d ? parsePath(part.d) : null;
    if (!parsed || parsed.error || !parsed.segs.length) return [];
    const b = pathBounds(parsed.segs);
    const from = { x: b.x, y: b.y, w: b.w, h: b.h };
    segs = remap(parsed.segs, from, partBox({ ...from, pinX: part.pinX, pinY: part.pinY }, recipe.ref, size));
  } else {
    const box = partBox(part, recipe.ref, size);
    if (box.w <= 0 || box.h <= 0) return [];
    if (part.kind === "ellipse") segs = ovalSegs(box.x, box.y, box.x + box.w, box.y + box.h);
    else if (part.kind === "polygon") segs = closed(starPoints(part.count ?? 3, null, box, part.rotation));
    else if (part.kind === "star") segs = closed(starPoints(part.count ?? 5, part.ratio ?? 0.5, box, part.rotation));
    else {
      const r = Math.max(0, part.radius ?? 0);
      segs = rrectSegs(box.x, box.y, box.x + box.w, box.y + box.h, [r, r, r, r, r, r, r, r]);
    }
  }
  return recipe.dir === "rtl" ? mirror(segs, size.w) : segs;
}

/**
 * The recipe's outline at `size`: its parts combined in order. Without Skia (before the engine
 * loads, or in a test without it) only the parts that add area are drawn, unioned by the fill
 * rule, and the result says it isn't exact so it's rebuilt once Skia is there.
 */
export function recipeArea(recipe: ShapeRecipe, size: { w: number; h: number }, anchors?: Anchors): { area: Area; exact: boolean } {
  const ops = pathOps();
  let acc: Area | null = null;
  let exact = true;
  for (const part of recipe.parts) {
    const segs = partSegs(part, recipe, size, anchors);
    if (!segs.length) continue;
    const area: Area = { segs };
    if (!acc || part.op === "base") {
      acc = acc && ops ? (ops.combine(acc, area, "union") ?? acc) : acc ? { segs: [...acc.segs, ...segs] } : area;
      continue;
    }
    if (!ops) {
      exact = false;
      if (part.op === "union") acc = { segs: [...acc.segs, ...segs] };
      continue;
    }
    acc = ops.combine(acc, area, part.op) ?? acc;
  }
  return { area: acc ?? { segs: [] }, exact };
}

/**
 * Rebuild a composed layer's path for its current size (mutates; layout calls it after sizing).
 * Skips the work when the size is the one it was built for and the booleans were applied.
 */
export function applyRecipe(n: PathNode, anchors?: Anchors): void {
  const r = n.recipe;
  if (!r) return;
  const w = Math.max(1, n.w),
    h = Math.max(1, n.h);
  const at = [...new Set(r.parts.flatMap((p) => (p.centerOn ? [p.centerOn] : [])))].map((i) => Math.round((anchors?.(i) ?? NaN) * 10) / 10);
  const same = !at.length || JSON.stringify(at) === JSON.stringify(r.built?.anchors ?? []);
  if (r.built && r.built.w === w && r.built.h === h && same && (r.built.exact || !pathOps())) return;
  const { area, exact } = recipeArea(r, { w, h }, anchors);
  n.d = area.segs.length ? toD(area.segs) : "M0 0Z";
  n.vw = w;
  n.vh = h;
  if (area.evenOdd) n.evenOdd = true;
  else delete n.evenOdd;
  delete n.vector;
  n.recipe = { ...r, built: { w, h, exact, ...(at.length ? { anchors: at } : {}) } };
}

/**
 * The anchors of a composed layer inside a backdrop: its container's other parts, by their
 * vertical centres in the layer's px. `parentOf` walks the tree as it stands (a doc or a draft).
 */
export function anchorsOf(
  n: { id: string; parentId: string | null; y: number },
  get: (id: string) => { id: string; parentId: string | null; y: number; h: number; children?: string[]; fillParent?: boolean; visible?: boolean } | undefined,
): Anchors | undefined {
  const graphic = n.parentId ? get(n.parentId) : undefined;
  const container = graphic?.fillParent && graphic.parentId ? get(graphic.parentId) : undefined;
  if (!graphic || !container?.children) return undefined;
  const parts = container.children.filter((id) => id !== graphic.id).map(get).filter((c) => c && c.visible !== false);
  return (i) => {
    const c = parts[i - 1];
    return c ? c.y + c.h / 2 - graphic.y - n.y : undefined;
  };
}
