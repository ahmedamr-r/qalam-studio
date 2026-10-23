import type { Doc, IconNode, PathNode, SceneNode } from "./schema";
import { type Seg, parsePath } from "@/design-system/svg-path";
import { iconDrawing } from "@/design-system/icons";
import { type Mat, localMatrix, mul } from "./geometry";
import { scaleVector, vectorOf, vectorScale, vectorToSegs } from "./vector";
import { strokeEnds } from "./vector-shapes";
import type { Area, PathOps, StrokeStyle } from "./path-ops";
import { ovalSegs, rrectSegs } from "./primitive-segs";

export { ovalSegs, rrectSegs };

/*
 * Layers as geometry, the way the renderer draws them: the region a layer fills, the region its
 * stroke paints, in its own px or through any matrix. Booleans, flatten, outline stroke and masks
 * build on it. The area work itself (union, stroking) is PathOps' (see path-ops.ts).
 */

export function transformSegs(segs: Seg[], m: Mat): Seg[] {
  const x = (px: number, py: number) => m[0] * px + m[2] * py + m[4];
  const y = (px: number, py: number) => m[1] * px + m[3] * py + m[5];
  return segs.map((s) =>
    s.c === "Z"
      ? s
      : s.c === "C"
        ? { c: "C", x1: x(s.x1, s.y1), y1: y(s.x1, s.y1), x2: x(s.x2, s.y2), y2: y(s.x2, s.y2), x: x(s.x, s.y), y: y(s.x, s.y) }
        : { c: s.c, x: x(s.x, s.y), y: y(s.x, s.y) },
  );
}


/** The renderer's rounded rect for a box layer, shrunk by `inset` (strokes are drawn inside). */
export function boxSegs(n: SceneNode, inset = 0): Seg[] {
  const r = n.radius;
  const c = (v: number) => Math.max(0, v - inset);
  const radii = r ? [r.tl.rx, r.tl.ry, r.tr.rx, r.tr.ry, r.br.rx, r.br.ry, r.bl.rx, r.bl.ry].map(c) : [0, 0, 0, 0, 0, 0, 0, 0];
  return rrectSegs(inset, inset, n.w - inset, n.h - inset, radii);
}

/** A path layer's subpaths in node px (its vector scaled to the box). */
export function pathSegs(n: PathNode): Seg[] {
  const { sx, sy } = vectorScale(n);
  return vectorToSegs(scaleVector(vectorOf(n), sx, sy));
}

const parsed = (d: string | undefined): Seg[] => (d ? parsePath(d).segs : []);

/** Fold areas into one with union (a single non-even-odd area is kept as it is). */
export function unionAll(ops: PathOps, areas: Area[]): Area | null {
  const list = areas.filter((a) => a.segs.length);
  if (!list.length) return { segs: [] };
  if (list.length === 1 && !list[0].evenOdd) return list[0];
  let acc: Area = { segs: [] };
  for (const a of list) {
    const r = ops.combine(acc, a, "union");
    if (!r) return null;
    acc = r;
  }
  return acc;
}

/** An icon's ink (its stroked lines and filled parts) in node px. */
export function iconArea(n: IconNode, ops: PathOps): Area | null {
  const d = iconDrawing(n.icon);
  if (!d || d === "pending") return null;
  const parts: Area[] = [];
  const lines = parsed(d.stroke);
  if (lines.length) {
    const s = ops.stroke(lines, { width: n.strokeWidth, cap: "round", join: "round" });
    if (!s) return null;
    parts.push(s);
  }
  const fill = parsed(d.fill);
  if (fill.length) parts.push({ segs: fill, evenOdd: d.evenOdd });
  const ink = unionAll(ops, parts);
  if (!ink) return null;
  // Drawn on a 24 grid scaled to the box (mirrored for RTL).
  const m: Mat = n.mirrored ? [-n.w / 24, 0, 0, n.h / 24, n.w, 0] : [n.w / 24, 0, 0, n.h / 24, 0, 0];
  return { ...ink, segs: transformSegs(ink.segs, m) };
}

/** Why a layer has no geometry (null = it has). */
export function geometryProblem(doc: Doc, id: string): string | null {
  const n = doc.nodes[id];
  if (!n) return "Select a layer first";
  if (n.type === "text") return "Text can't be turned into a vector yet";
  if (n.type === "icon" && iconDrawing(n.icon) === "pending") return "The icon is still loading";
  if (n.type === "frame") for (const c of n.children) {
    const p = geometryProblem(doc, c);
    if (p) return p;
  }
  return null;
}

/**
 * The region a layer (and, for frames and groups, its layers) fills, through `m` (target space ←
 * the layer's own px). Hidden layers add nothing; a mask group adds what its mask lets through.
 * Null when the geometry can't be made (text, a failed op).
 */
export function fillArea(doc: Doc, id: string, ops: PathOps, m: Mat): Area | null {
  const n = doc.nodes[id];
  if (!n || !n.visible) return { segs: [] };
  switch (n.type) {
    case "text":
      return null;
    case "rect":
    case "image":
      return { segs: transformSegs(boxSegs(n), m) };
    case "ellipse":
      return { segs: transformSegs(ovalSegs(0, 0, n.w, n.h), m) };
    case "path":
      return { segs: transformSegs(pathSegs(n), m), evenOdd: n.evenOdd };
    case "icon": {
      const a = iconArea(n, ops);
      return a && { ...a, segs: transformSegs(a.segs, m) };
    }
    case "frame": {
      const kids: Area[] = [];
      for (const c of n.children) {
        const a = fillArea(doc, c, ops, mul(m, localMatrix(doc.nodes[c])));
        if (!a) return null;
        kids.push(a);
      }
      if (n.meta.mask && kids.length > 1 && doc.nodes[n.children[0]]?.visible) {
        const [mask, ...rest] = kids;
        const content = unionAll(ops, rest);
        return content && ops.combine(mask, content, "intersect");
      }
      // A frame's own surface counts when it paints one; a group has none.
      if (!n.meta.group && (n.fill || n.stroke)) kids.unshift({ segs: transformSegs(boxSegs(n), m) });
      return unionAll(ops, kids);
    }
  }
}

/**
 * The region a layer's stroke paints, in its own px (null when it has none or the op fails).
 * Boxes stroke inside their edge; vectors along their curve with their caps, joins and arrowheads;
 * icons are all stroke (their lines, plus any filled parts).
 */
export function strokeArea(n: SceneNode, ops: PathOps): Area | null {
  if (n.type === "icon") return iconArea(n, ops);
  const sw = n.stroke && n.stroke.width > 0 ? n.stroke.width : 0;
  if (!sw || n.type === "text") return null;
  const miter: StrokeStyle = { width: sw, cap: "butt", join: "miter" };
  if (n.type === "ellipse") {
    return ops.stroke(ovalSegs(sw / 2, sw / 2, n.w - sw / 2, n.h - sw / 2), miter);
  }
  if (n.type !== "path") return ops.stroke(boxSegs(n, sw / 2), miter);
  // As the renderer draws it (drawVector): the body with Skia caps, line arrows stroked, other heads filled.
  const { sx, sy } = vectorScale(n);
  const v = scaleVector(vectorOf(n), sx, sy);
  const plan = strokeEnds(v, sw, n.ends);
  const style: StrokeStyle = { width: sw, cap: plan.cap, join: n.join ?? "round" };
  const parts: Area[] = [];
  for (const segs of [vectorToSegs(plan.body ?? v), parsed(plan.stroke)]) {
    if (!segs.length) continue;
    const s = ops.stroke(segs, style);
    if (!s) return null;
    parts.push(s);
  }
  const heads = parsed(plan.fill);
  if (heads.length) parts.push({ segs: heads });
  return unionAll(ops, parts);
}
