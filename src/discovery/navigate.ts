import type { Doc } from "@/doc/schema";
import { isOstCard, treeRootOf, visibleCards } from "@/doc/board";
import { type Box, worldBounds } from "@/doc/geometry";
import { depthOf, orientationOf } from "./tree";

/**
 * Arrow keys on a selected card walk the tree (pure). Toward the root goes to the parent, away
 * from it to the middle child; across goes to the nearest card on the same level, even under
 * another parent. Top-down, ↑ is the parent; left-to-right, ← is.
 */

export type Dir = "up" | "down" | "left" | "right";

export function neighbor(doc: Doc, id: string, dir: Dir): string | null {
  const n = doc.nodes[id];
  if (!isOstCard(n)) return null;
  const o = orientationOf(doc, id);
  if (dir === (o === "tb" ? "up" : "left")) return n.parentId && isOstCard(doc.nodes[n.parentId]) ? n.parentId : null;
  if (dir === (o === "tb" ? "down" : "right")) {
    if (n.meta.ost.collapsed) return null;
    const kids = n.children.filter((c) => isOstCard(doc.nodes[c]) && doc.nodes[c].visible);
    return kids.length ? kids[Math.floor((kids.length - 1) / 2)] : null;
  }
  const root = treeRootOf(doc, id);
  if (!root) return null;
  const depth = depthOf(doc, id);
  const along = (b: Box) => (o === "tb" ? b.x + b.w / 2 : b.y + b.h / 2);
  const sign = dir === "right" || dir === "down" ? 1 : -1;
  const here = along(worldBounds(doc, id));
  let best: string | null = null;
  let bestD = Infinity;
  for (const c of visibleCards(doc, root)) {
    if (c === id || depthOf(doc, c) !== depth) continue;
    const d = (along(worldBounds(doc, c)) - here) * sign;
    if (d > 0 && d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}
