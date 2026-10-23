import type { Doc, FrameNode, SceneNode } from "./schema";

/*
 * Masks (⌃⌘M), Figma's way: a mask group is a group (`meta.group`) with `meta.mask`. Its first,
 * bottom-most layer is the mask: it isn't drawn, its alpha clips the layers above it (renderer),
 * clicks outside it fall through (hit test), and the group is exactly as big as it (group-fit).
 * Ungrouping releases everything unmasked; ⌃⌘M on a mask group turns it back into a plain group
 * (mask-ops.ts). No store imports here: the renderer and the hit test read it.
 */

export const isMaskGroup = (n: SceneNode | null | undefined): n is FrameNode => !!n && n.type === "frame" && !!n.meta.mask && n.children.length > 0;

/** The layer doing the masking, when the mask is on (a hidden mask masks nothing). */
export function maskOf(doc: Doc, n: SceneNode | null | undefined): string | null {
  if (!isMaskGroup(n)) return null;
  const m = doc.nodes[n.children[0]];
  return m?.visible ? m.id : null;
}

/** The layer is the mask of its group (the Layers panel marks it). */
export function isMaskLayer(doc: Doc, id: string): boolean {
  const p = doc.nodes[id]?.parentId;
  const parent = p ? doc.nodes[p] : null;
  return isMaskGroup(parent) && parent.children[0] === id;
}
