import type { Doc, FrameNode, NodeMeta, SceneNode } from "./schema";
import type { NoteMeta, OstCard } from "@/discovery/types";
import { type Box, boundsOf, boxesIntersect, worldBounds, worldCorners } from "./geometry";

/*
 * Discovery boards in the document (pure). A tree card is a frame painted from `meta.ost` whose
 * children are its child cards; a sticky is a frame with a text inside. Both are "sealed": they
 * take no layers dropped or drawn onto them, and are picked as one thing. A tree's root sits at
 * the top level and its cards hang below it, positioned relative to their parent card, so the
 * root's own box is not the tree's extent: code that needs what a root covers uses these helpers.
 */

export type CardNode = FrameNode & { meta: NodeMeta & { ost: OstCard } };
export type NoteNode = FrameNode & { meta: NodeMeta & { note: NoteMeta } };

export const isOstCard = (n: SceneNode | undefined): n is CardNode => !!n && n.type === "frame" && !!n.meta.ost;
export const isNote = (n: SceneNode | undefined): n is NoteNode => !!n && n.type === "frame" && !!n.meta.note;
/** Takes no layers of its own: a tree card or a sticky. */
export const isSealed = (n: SceneNode | undefined): boolean => isOstCard(n) || isNote(n);

/** The top card of the tree a card is in (itself for a root). */
export function treeRootOf(doc: Doc, id: string): string | null {
  let n = doc.nodes[id];
  if (!isOstCard(n)) return null;
  while (n.parentId && isOstCard(doc.nodes[n.parentId])) n = doc.nodes[n.parentId] as CardNode;
  return n.id;
}

/** A card and every card below it that is showing (folded branches are hidden), top-down. */
export function visibleCards(doc: Doc, id: string): string[] {
  const out: string[] = [];
  const walk = (cid: string) => {
    const n = doc.nodes[cid];
    if (!isOstCard(n) || !n.visible) return;
    out.push(cid);
    n.children.forEach(walk);
  };
  walk(id);
  return out;
}

const boundsCache = new WeakMap<Doc["nodes"], Map<string, Box>>();

/** The world box a tree covers: every card showing in it. Cached per document. */
export function treeBounds(doc: Doc, rootId: string): Box {
  let byRoot = boundsCache.get(doc.nodes);
  if (!byRoot) boundsCache.set(doc.nodes, (byRoot = new Map()));
  const hit = byRoot.get(rootId);
  if (hit) return hit;
  const ids = visibleCards(doc, rootId);
  const b = ids.length ? boundsOf(ids.flatMap((id) => worldCorners(doc, id))) : worldBounds(doc, rootId);
  byRoot.set(rootId, b);
  return b;
}

/** What a top-level layer covers on the canvas: a tree's cards, or the layer's own box. */
export const rootBounds = (doc: Doc, id: string): Box => (isOstCard(doc.nodes[id]) ? treeBounds(doc, id) : worldBounds(doc, id));

/**
 * A plain marquee: top-level layers touching the box, except that a tree gives its cards one by
 * one (any card the box touches), since a whole tree is rarely what a box around a branch means.
 */
export function marqueeHits(doc: Doc, box: Box, busy: Set<string>): string[] {
  const out: string[] = [];
  for (const id of doc.roots) {
    const n = doc.nodes[id];
    if (!n?.visible || n.locked || busy.has(id)) continue;
    if (isOstCard(n)) {
      for (const c of visibleCards(doc, id)) if (!doc.nodes[c].locked && !busy.has(c) && boxesIntersect(worldBounds(doc, c), box)) out.push(c);
    } else if (boxesIntersect(worldBounds(doc, id), box)) out.push(id);
  }
  return out;
}

/** Layers whose boxes together are everything on the canvas (zoom to fit): roots, and every card showing in a tree. */
export function fitTargets(doc: Doc): string[] {
  return doc.roots.flatMap((id) => (isOstCard(doc.nodes[id]) ? visibleCards(doc, id) : doc.nodes[id] ? [id] : []));
}
