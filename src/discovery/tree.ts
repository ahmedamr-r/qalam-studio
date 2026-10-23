import type { Doc } from "@/doc/schema";
import { isOstCard, treeRootOf } from "@/doc/board";
import type { Orientation } from "./layout";
import type { OstCard } from "./types";

/** Reading the tree (pure). */

/** The fold toggle's radius (card px). */
export const TOGGLE_R = 9;

/** Which way a card's tree grows: its root decides (top-down unless set). */
export function orientationOf(doc: Doc, id: string): Orientation {
  const root = treeRootOf(doc, id);
  return (root && doc.nodes[root]?.meta.ost?.orientation) || "tb";
}

/** Where a card's fold toggle sits, in the card's own px: on its child edge. */
export function foldToggle(n: { w: number; h: number }, o: Orientation): { x: number; y: number; r: number } {
  return o === "tb" ? { x: n.w / 2, y: n.h + 1, r: TOGGLE_R } : { x: n.w + 1, y: n.h / 2, r: TOGGLE_R };
}

/** Child cards (in order). */
export const childCards = (doc: Doc, id: string): string[] => (doc.nodes[id]?.children ?? []).filter((c) => isOstCard(doc.nodes[c]));

/** How many cards up to the tree's root (the root is 0). */
export function depthOf(doc: Doc, id: string): number {
  let d = 0;
  let p = doc.nodes[id]?.parentId;
  while (p && isOstCard(doc.nodes[p])) {
    d++;
    p = doc.nodes[p].parentId;
  }
  return d;
}

/** Every card of every tree on the board, with its data, depth-first. */
export function allCards(doc: Doc): { id: string; card: OstCard }[] {
  const out: { id: string; card: OstCard }[] = [];
  const walk = (id: string) => {
    const n = doc.nodes[id];
    if (!isOstCard(n)) return;
    out.push({ id, card: n.meta.ost });
    n.children.forEach(walk);
  };
  doc.roots.forEach(walk);
  return out;
}

/** The opportunities from the tree's top down to (not including) this card. */
export function opportunityPath(doc: Doc, id: string): string[] {
  const out: string[] = [];
  let p = doc.nodes[id]?.parentId;
  while (p && isOstCard(doc.nodes[p])) {
    const c = doc.nodes[p].meta.ost!;
    if (c.kind === "opportunity") out.unshift(p);
    p = doc.nodes[p].parentId;
  }
  return out;
}

/** The outcome at the top of a card's tree, if the tree has one. */
export function outcomeOf(doc: Doc, id: string): string | null {
  const root = treeRootOf(doc, id);
  return root && doc.nodes[root].meta.ost?.kind === "outcome" ? root : null;
}
