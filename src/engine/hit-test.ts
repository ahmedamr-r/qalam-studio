import type { Doc, SceneNode } from "@/doc/schema";
import { type Pt, apply, invert, localMatrix } from "@/doc/geometry";
import { busyIds } from "@/doc/reservations";
import { hiddenParts } from "./route-layer";
import { hitVector } from "@/doc/vector";
import { strokeOverhang } from "@/doc/vector-shapes";
import { maskOf } from "@/doc/mask";
import { isNote, isOstCard, isSealed } from "@/doc/board";

/** `l` (in the node's own px) is on its shape: its box, ellipse or vector geometry. */
function within(n: SceneNode, l: Pt, tol: number): boolean {
  // Strokes and arrowheads reach outside a vector's box.
  const pad = n.type === "path" ? Math.max(tol, strokeOverhang(n)) : 0;
  if (l.x < -pad || l.y < -pad || l.x > n.w + pad || l.y > n.h + pad) return false;
  if (n.type === "path") return hitVector(n, l, tol);
  if (n.type === "ellipse") {
    const dx = (l.x - n.w / 2) / (n.w / 2);
    const dy = (l.y - n.h / 2) / (n.h / 2);
    return dx * dx + dy * dy <= 1;
  }
  return true;
}

/** `p` (in the parent's space) is on what the layer draws, locked or not; a group by its layers. */
function covers(doc: Doc, id: string, p: Pt, tol: number): boolean {
  const n = doc.nodes[id];
  if (!n?.visible) return false;
  const l = apply(invert(localMatrix(n)), p);
  if (n.type === "frame" && n.meta.group) return n.children.some((c) => covers(doc, c, l, tol));
  return within(n, l, tol);
}

/**
 * Path from root to the deepest visible, unlocked node under `world`, honouring frame clipping.
 * Layers AI is working on can't be hit (clicks go to what's behind), nor anything inside them.
 * Vectors are hit by their geometry: their filled region, or within `tol` (world units; the
 * controller passes a few screen px) of their outline. Other callers keep the default of 0.
 */
export function hitPath(doc: Doc, world: Pt, exclude?: Set<string>, opts?: { tol?: number }): string[] | null {
  const busy = busyIds();
  // A route's parts are off the canvas while Prototype parts are hidden.
  const hidden = hiddenParts(doc);
  const tol = opts?.tol ?? 0;
  const test = (id: string, p: Pt): string[] | null => {
    const n = doc.nodes[id];
    if (!n || !n.visible || n.locked || exclude?.has(id) || busy.has(id) || hidden.has(id)) return null;
    const l = apply(invert(localMatrix(n)), p);
    const inside = within(n, l, tol);
    // A mask group's layers are hit only where its mask lets them show.
    const mask = maskOf(doc, n);
    if (n.type === "frame" && (!n.clip || inside) && (!mask || covers(doc, mask, l, tol))) {
      for (let i = n.children.length - 1; i >= 0; i--) {
        const r = test(n.children[i], l);
        if (r) return [id, ...r];
      }
    }
    // Groups have no surface of their own: only their layers are hit.
    return inside && !n.meta.group ? [id] : null;
  };
  for (let i = doc.roots.length - 1; i >= 0; i--) {
    const r = test(doc.roots[i], world);
    if (r) return r;
  }
  return null;
}

/**
 * Figma-like selection target:
 * - deep (⌘/Ctrl) → the leaf
 * - if the current selection's parent is on the path, pick within that context
 * - otherwise direct children of top-level frames are selectable; a bare frame selects itself
 */
export function pickTarget(doc: Doc, path: string[] | null, selection: string[], deep: boolean): string | null {
  if (!path?.length) return null;
  // Discovery: a tree card is picked as itself, however deep in its tree (its children are cards too).
  for (let i = path.length - 1; i >= 0; i--) if (isOstCard(doc.nodes[path[i]])) return path[i];
  if (deep) return path[path.length - 1];
  for (const sid of selection) {
    const parent = doc.nodes[sid]?.parentId;
    if (!parent) continue;
    const i = path.indexOf(parent);
    if (i >= 0 && i + 1 < path.length) return path[i + 1];
  }
  const root = doc.nodes[path[0]];
  // A group is one layer until it is entered (double-click, ⌘), even on the canvas itself; so is a sticky note.
  if (root?.type === "frame" && !root.meta.group && !isNote(root) && path.length > 1) return path[1];
  return path[0];
}

/** Deepest frame on the path that could receive new children. */
export function deepestFrame(doc: Doc, path: string[] | null): string | null {
  if (!path) return null;
  // Groups only gather layers: new and dropped layers go to the frame around them. Tree cards and
  // sticky notes take none either, so what lands on them goes to whatever holds them.
  for (let i = path.length - 1; i >= 0; i--) {
    const n = doc.nodes[path[i]];
    if (n?.type === "frame" && !n.meta.group && !isSealed(n)) return path[i];
  }
  return null;
}
