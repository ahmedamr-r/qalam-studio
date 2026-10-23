import type { Doc, SceneNode, TextNode } from "./schema";
import { studio } from "./store";
import { fitText, topLevelOf } from "./ops";
import { pinResized } from "./autolayout-ops";

/** Layer edits behind keyboard shortcuts (⇧⌘H, ⇧⌘L, ⌥/, ⇧/, ⌘ arrows). Each is one undo step. */

/** ⇧⌘H: hide the selection, or show it when every selected layer is already hidden. */
export function toggleVisible(ids: string[]): boolean | null {
  const doc = studio().doc;
  const live = ids.filter((id) => doc.nodes[id]);
  if (!live.length) return null;
  const show = live.every((id) => !doc.nodes[id].visible);
  studio().mutate((d) => {
    for (const id of live) d.nodes[id].visible = show;
  });
  return show;
}

/** ⇧⌘L: lock the selection (and let go of it, like Figma), or unlock it when all are locked. */
export function toggleLocked(ids: string[]): boolean | null {
  const doc = studio().doc;
  const live = ids.filter((id) => doc.nodes[id]);
  if (!live.length) return null;
  const lock = !live.every((id) => doc.nodes[id].locked);
  studio().mutate((d) => {
    for (const id of live) d.nodes[id].locked = lock;
  });
  if (lock) studio().select([]);
  return lock;
}

/** Text and icons draw with their fill (it is their colour), so they keep it. */
export const canRemoveFill = (n: SceneNode) => n.type !== "text" && n.type !== "icon" && !!n.fill;

/** ⌥/: remove fills. Returns how many layers changed. */
export function removeFill(ids: string[]): number {
  const doc = studio().doc;
  const targets = ids.filter((id) => doc.nodes[id] && canRemoveFill(doc.nodes[id]));
  if (targets.length) studio().mutate((d) => targets.forEach((id) => void (d.nodes[id].fill = null)));
  return targets.length;
}

/** ⇧/: remove strokes. Returns how many layers changed. */
export function removeStroke(ids: string[]): number {
  const doc = studio().doc;
  const targets = ids.filter((id) => doc.nodes[id]?.stroke);
  if (targets.length) studio().mutate((d) => targets.forEach((id) => void (d.nodes[id].stroke = null)));
  return targets.length;
}

/**
 * Resize one node in place by dw/dh (never below 1px), keeping text and auto layout consistent.
 * Only the axes asked for change, and a line's zero axis stays zero (like the resize handles).
 */
export function resizeNode(d: Doc, n: SceneNode, dw: number, dh: number) {
  if (dw && !(n.type === "path" && n.vw === 0)) n.w = Math.max(1, Math.round(n.w + dw));
  if (dh && !(n.type === "path" && n.vh === 0)) n.h = Math.max(1, Math.round(n.h + dh));
  if (n.type === "text") {
    const t = n as TextNode;
    if (dh) t.text.autoSize = "fixed";
    else if (t.text.autoSize === "width") t.text.autoSize = "height";
    if (t.text.autoSize === "height") fitText(t);
  }
  pinResized(d, n, [...(dw ? (["h"] as const) : []), ...(dh ? (["v"] as const) : [])]);
}

/** ⌘→ wider, ⌘← narrower, ⌘↓ taller, ⌘↑ shorter (⇧: by 10). */
export function resizeBy(ids: string[], dw: number, dh: number) {
  const doc = studio().doc;
  const tops = topLevelOf(doc, ids).filter((id) => !doc.nodes[id].locked);
  if (!tops.length) return;
  studio().mutate((d) => {
    for (const id of tops) resizeNode(d, d.nodes[id], dw, dh);
  });
}

/** ⇧X: fills become strokes and strokes fills (text and icons keep their colour). */
export function swapFillStroke(ids: string[]): number {
  const doc = studio().doc;
  const targets = ids.filter((id) => {
    const n = doc.nodes[id];
    return n && n.type !== "text" && n.type !== "icon" && (n.fill || n.stroke);
  });
  if (!targets.length) return 0;
  studio().mutate((d) => {
    for (const id of targets) {
      const n = d.nodes[id];
      const fill = n.fill;
      const stroke = n.stroke;
      n.fill = stroke ? { color: stroke.color, ...(stroke.token ? { token: stroke.token } : {}), ...(stroke.gradient ? { gradient: stroke.gradient } : {}) } : null;
      n.stroke = fill ? { ...fill, width: stroke?.width ?? 1, ...(stroke?.widthToken ? { widthToken: stroke.widthToken } : {}) } : null;
    }
  });
  return targets.length;
}

const isInstance = (n: SceneNode) => n.meta.specPath !== undefined || !!n.meta.inst;

/** The component instance a layer belongs to: itself, or the nearest instance around it. */
export function instanceRootOf(doc: Doc, id: string): string | null {
  for (let n: SceneNode | undefined = doc.nodes[id]; n; n = n.parentId ? doc.nodes[n.parentId] : undefined) if (isInstance(n)) return n.id;
  return doc.nodes[id]?.meta.component ? id : null;
}

/**
 * ⌥⌘B: detach instances. Their layers stay as they are but stop following their component
 * (design-system refreshes rebuild only instances). Nested instances stay instances, like Figma.
 * Returns how many were detached.
 */
export function detachInstances(ids: string[]): number {
  const doc = studio().doc;
  const roots = [...new Set(ids.map((id) => instanceRootOf(doc, id)).filter((id): id is string => !!id && !doc.nodes[id].locked))];
  if (!roots.length) return 0;
  studio().mutate((d) => {
    for (const id of roots) {
      const m = d.nodes[id].meta;
      delete m.specPath;
      delete m.inst;
      delete m.instFingerprint;
      delete m.component;
    }
  });
  return roots.length;
}
