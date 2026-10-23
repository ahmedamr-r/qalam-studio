import type { Doc, SceneNode } from "./schema";

/** 2D affine matrix: x' = a*x + c*y + e, y' = b*x + d*y + f */
export type Mat = [number, number, number, number, number, number];
export interface Pt {
  x: number;
  y: number;
}
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];

export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return IDENTITY;
  const id = 1 / det;
  return [
    m[3] * id,
    -m[1] * id,
    -m[2] * id,
    m[0] * id,
    (m[2] * m[5] - m[3] * m[4]) * id,
    (m[1] * m[4] - m[0] * m[5]) * id,
  ];
}

export function apply(m: Mat, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function translate(x: number, y: number): Mat {
  return [1, 0, 0, 1, x, y];
}

export function rotateDeg(deg: number): Mat {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}

/** Parent-space transform of a node: translate, then flip and rotate around its centre. */
export function localMatrix(n: Pick<SceneNode, "x" | "y" | "w" | "h" | "rotation" | "flipH" | "flipV">): Mat {
  if (!n.rotation && !n.flipH && !n.flipV) return translate(n.x, n.y);
  const cx = n.w / 2;
  const cy = n.h / 2;
  const flip: Mat = [n.flipH ? -1 : 1, 0, 0, n.flipV ? -1 : 1, 0, 0];
  return mul(translate(n.x + cx, n.y + cy), mul(rotateDeg(n.rotation), mul(flip, translate(-cx, -cy))));
}

/** A layer's placement (no scale) read back from a parent-space matrix. */
export interface Placement {
  x: number;
  y: number;
  rotation: number;
  flipH: boolean;
}

const tidyAngle = (deg: number) => {
  const r = Math.round(deg * 1e6) / 1e6;
  return Object.is(r, -0) || Math.abs(r) < 1e-6 ? 0 : r === -180 ? 180 : r;
};

/**
 * Solve localMatrix for x, y, rotation and the flip, given the matrix a w × h layer must have
 * (after reparenting or flipping). A mirror image is always written as flipH plus a rotation:
 * flipping vertically equals flipping horizontally and turning 180°, which is how Figma shows it.
 */
export function placementOf(m: Mat, w: number, h: number): Placement {
  const flipH = m[0] * m[3] - m[1] * m[2] < 0;
  // Undo the flip (x axis negated) to read the rotation from the first column.
  const rotation = tidyAngle((Math.atan2(flipH ? -m[1] : m[1], flipH ? -m[0] : m[0]) * 180) / Math.PI);
  const c = apply(m, { x: w / 2, y: h / 2 });
  // Matrix round trips leave noise like 9.999999999: keep what a person would have typed.
  const clean = (v: number) => Math.round(v * 1e6) / 1e6;
  return { x: clean(c.x - w / 2), y: clean(c.y - h / 2), rotation, flipH };
}

/** Write a placement onto a node (mutates; drops a stale flipV). */
export function place(n: SceneNode, p: Placement) {
  n.x = p.x;
  n.y = p.y;
  n.rotation = p.rotation;
  if (p.flipH) n.flipH = true;
  else delete n.flipH;
  delete n.flipV;
}

export function worldMatrix(doc: Doc, id: string): Mat {
  const n = doc.nodes[id];
  if (!n) return IDENTITY;
  const local = localMatrix(n);
  return n.parentId ? mul(worldMatrix(doc, n.parentId), local) : local;
}

export function parentWorldMatrix(doc: Doc, id: string): Mat {
  const p = doc.nodes[id]?.parentId;
  return p ? worldMatrix(doc, p) : IDENTITY;
}

export function worldCorners(doc: Doc, id: string): Pt[] {
  const n = doc.nodes[id];
  const m = worldMatrix(doc, id);
  return [
    apply(m, { x: 0, y: 0 }),
    apply(m, { x: n.w, y: 0 }),
    apply(m, { x: n.w, y: n.h }),
    apply(m, { x: 0, y: n.h }),
  ];
}

export function boundsOf(points: Pt[]): Box {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function worldBounds(doc: Doc, id: string): Box {
  return boundsOf(worldCorners(doc, id));
}

export function selectionBounds(doc: Doc, ids: string[]): Box | null {
  const pts = ids.filter((id) => doc.nodes[id]).flatMap((id) => worldCorners(doc, id));
  return pts.length ? boundsOf(pts) : null;
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function normalizeBox(a: Pt, b: Pt): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function ancestors(doc: Doc, id: string): string[] {
  const out: string[] = [];
  let p = doc.nodes[id]?.parentId ?? null;
  while (p) {
    out.push(p);
    p = doc.nodes[p]?.parentId ?? null;
  }
  return out;
}

export function isDescendant(doc: Doc, id: string, ancestorId: string): boolean {
  return ancestors(doc, id).includes(ancestorId);
}

export function descendants(doc: Doc, id: string): string[] {
  const out: string[] = [];
  const walk = (nid: string) => {
    for (const c of doc.nodes[nid]?.children ?? []) {
      out.push(c);
      walk(c);
    }
  };
  walk(id);
  return out;
}

export function siblingsOf(doc: Doc, id: string): string[] {
  const p = doc.nodes[id]?.parentId;
  return p ? doc.nodes[p].children : doc.roots;
}

/** Top-level frame that contains the node (or the node itself if it is one). */
export function topFrameOf(doc: Doc, id: string): string {
  const a = ancestors(doc, id);
  return a.length ? a[a.length - 1] : id;
}

/** First x to the right of `box` (same row) where a box of the same size doesn't overlap any root. */
export function freeSlotRight(doc: Doc, box: Box, gap = 80, ignore?: string): number {
  let x = box.x + box.w + gap;
  const others = doc.roots.filter((id) => id !== ignore && doc.nodes[id]).map((id) => worldBounds(doc, id));
  for (let guard = 0; guard < 200; guard++) {
    const hit = others.find((o) => boxesIntersect({ x, y: box.y, w: box.w, h: box.h }, o));
    if (!hit) return x;
    x = hit.x + hit.w + gap;
  }
  return x;
}
