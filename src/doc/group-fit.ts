import type { Doc, SceneNode, TextNode } from "./schema";
import { type Box, apply, boundsOf, localMatrix } from "./geometry";
import { hasAutoLayout } from "./autolayout";

/**
 * Groups (⌘G) are frames with `meta.group`: no fill, stroke, clip or layout, and a box that always
 * hugs their children. `fitGroups` keeps that true after every edit (store.mutate runs it), without
 * moving anything on the canvas: the group's box moves, its children move back by as much.
 * Resizing the group itself (handles, the panel) scales its children into the new box instead.
 * No store imports here: the store runs this on every edit.
 */

export const isGroup = (n: SceneNode | null | undefined): boolean => !!n && n.type === "frame" && !!n.meta.group && !n.layout;

const round2 = (v: number) => Math.round(v * 100) / 100;
const EPS = 0.005;

/** Every layer in paint order (back to front): the order a group keeps its children in. */
export function paintOrder(doc: Doc): Map<string, number> {
  const order = new Map<string, number>();
  const walk = (id: string) => {
    order.set(id, order.size);
    doc.nodes[id]?.children.forEach(walk);
  };
  doc.roots.forEach(walk);
  return order;
}

/** The union of a container's children in its own space (visible ones, unless all are hidden). */
export function childBox(nodes: Doc["nodes"], id: string): Box | null {
  const kids = (nodes[id]?.children ?? []).map((c) => nodes[c]).filter(Boolean);
  // A mask group (doc/mask.ts) is exactly as big as its mask, its first layer.
  const mask = nodes[id]?.meta.mask && kids[0]?.visible ? kids[0] : null;
  const shown = mask ? [mask] : kids.filter((k) => k.visible);
  const list = shown.length ? shown : kids;
  if (!list.length) return null;
  return boundsOf(
    list.flatMap((k) => {
      const m = localMatrix(k);
      return [apply(m, { x: 0, y: 0 }), apply(m, { x: k.w, y: 0 }), apply(m, { x: k.w, y: k.h }), apply(m, { x: 0, y: k.h })];
    }),
  );
}

/** Returns the node to change: a draft in a recipe, or a fresh copy when editing a doc by hand. */
export type Edit = (id: string) => SceneNode;

/**
 * Move a container's box onto `b` (in its own current space) and its children back by as much, so
 * nothing moves on the canvas. Rotation and flips are kept. Returns false when it already fits.
 */
export function setBox(nodes: Doc["nodes"], edit: Edit, id: string, b: Box): boolean {
  const g = nodes[id];
  if (Math.abs(b.x) < EPS && Math.abs(b.y) < EPS && Math.abs(b.w - g.w) < EPS && Math.abs(b.h - g.h) < EPS) return false;
  // Where the new box's corner sits in the parent, and the rotation/flip about the new centre.
  const o = apply(localMatrix(g), { x: b.x, y: b.y });
  const turn = apply(localMatrix({ x: 0, y: 0, w: 0, h: 0, rotation: g.rotation, flipH: g.flipH, flipV: g.flipV }), { x: -b.w / 2, y: -b.h / 2 });
  const ng = edit(id);
  ng.x = round2(o.x - b.w / 2 - turn.x);
  ng.y = round2(o.y - b.h / 2 - turn.y);
  ng.w = round2(b.w);
  ng.h = round2(b.h);
  for (const c of g.children) {
    const k = edit(c);
    k.x = round2(k.x - b.x);
    k.y = round2(k.y - b.y);
  }
  return true;
}

/** Scale a resized group's children into its new box (Figma's group resize), from `src`'s values. */
function scaleChildren(nodes: Doc["nodes"], edit: Edit, id: string, sx: number, sy: number, src: Doc["nodes"] = nodes) {
  for (const c of nodes[id].children) {
    const o = src[c];
    const k = edit(c);
    k.x = round2(o.x * sx);
    k.y = round2(o.y * sy);
    // Lines keep their zero axis.
    if (o.w) k.w = Math.max(0.01, round2(o.w * sx));
    if (o.h) k.h = Math.max(0.01, round2(o.h * sy));
    if (k.type === "text" && sx !== 1) (k as TextNode).text = { ...(k as TextNode).text, autoSize: "fixed" };
  }
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.02;

/**
 * During a drag (a transaction), scale from where it started rather than step by step, so rounding
 * never adds up: when the group's children are exactly its start state scaled to the last step.
 */
function dragStart(base: Doc | null | undefined, prev: Doc, id: string): SceneNode | null {
  const b = base?.nodes[id];
  const was = prev.nodes[id];
  if (!b || !was || b.w <= 0 || b.h <= 0 || b.children.length !== was.children.length) return null;
  const sx = was.w / b.w;
  const sy = was.h / b.h;
  const ok = was.children.every((c, i) => {
    const o = base!.nodes[c];
    const p = prev.nodes[c];
    return c === b.children[i] && o && p && near(p.x, o.x * sx) && near(p.y, o.y * sy) && near(p.w, o.w * sx) && near(p.h, o.h * sy);
  });
  return ok ? b : null;
}

function depthOf(doc: Doc, id: string): number {
  let depth = 0;
  for (let p = doc.nodes[id]?.parentId; p; p = doc.nodes[p]?.parentId ?? null) depth++;
  return depth;
}

/**
 * Keep every group that an edit touched (prev → next) hugging its children. Returns `next` itself
 * when nothing needed fixing. Empty groups are removed; a group given auto layout becomes a frame.
 * `base`: the document when the current transaction (a drag) began.
 */
export function fitGroups(prev: Doc, next: Doc, base?: Doc | null): Doc {
  if (prev === next || prev.nodes === next.nodes) return next;
  const groups = Object.values(next.nodes).filter((n) => n.type === "frame" && n.meta.group);
  if (!groups.length) return next;

  const nodes: Doc["nodes"] = { ...next.nodes };
  let roots = next.roots;
  const copied = new Set<string>();
  let changed = false;
  const edit: Edit = (id) => {
    changed = true;
    if (!copied.has(id)) {
      copied.add(id);
      nodes[id] = { ...nodes[id] } as SceneNode;
    }
    return nodes[id];
  };
  const doc = (): Doc => ({ ...next, nodes, roots });
  const touched = (id: string) => nodes[id] !== prev.nodes[id];

  const live = groups.filter((g) => {
    if (!hasAutoLayout(g)) return true;
    // Auto layout turns a group into a frame.
    const n = edit(g.id);
    n.meta = { ...n.meta };
    delete n.meta.group;
    return false;
  });
  const byDepth = live.map((g) => ({ id: g.id, depth: depthOf(next, g.id) }));

  // Resized groups scale their children (outer groups first, so nested groups scale in turn).
  for (const { id } of [...byDepth].sort((a, b) => a.depth - b.depth)) {
    const g = nodes[id];
    const was = prev.nodes[id];
    if (!was || was.type !== "frame" || g.children.length !== was.children.length) continue;
    if (Math.abs(g.w - was.w) < EPS && Math.abs(g.h - was.h) < EPS) continue;
    if (g.children.some((c, i) => c !== was.children[i] || nodes[c] !== prev.nodes[c])) continue;
    const start = dragStart(base, prev, id);
    if (start) scaleChildren(nodes, edit, id, g.w / start.w, g.h / start.h, base!.nodes);
    else scaleChildren(nodes, edit, id, was.w ? g.w / was.w : 1, was.h ? g.h / was.h : 1);
  }

  // Then every touched group hugs its children (inner groups first, so outer ones see the result).
  for (const { id } of [...byDepth].sort((a, b) => b.depth - a.depth)) {
    const g = nodes[id];
    if (!g) continue;
    if (!touched(id) && !g.children.some((c) => touched(c))) continue;
    if (!g.children.length) {
      // An empty group is gone, like in Figma.
      changed = true;
      if (g.parentId) {
        const p = edit(g.parentId);
        p.children = p.children.filter((c) => c !== id);
      } else roots = roots.filter((c) => c !== id);
      delete nodes[id];
      continue;
    }
    const b = childBox(nodes, id);
    if (b) setBox(nodes, edit, id, b);
  }
  return changed ? doc() : next;
}
