import { isOstCard } from "@/doc/board";
import type { Doc } from "@/doc/schema";
import type { OstCard } from "./types";

/*
 * A board's cards without the rest of its document (pure): each card with the card above it, in
 * the tree's order (each card before its children, children as the board orders them). What the
 * space's map reads from every board at once (server/org/map.ts), so the window needn't open each.
 */

export interface BoardCard {
  id: string;
  /** The card above it (none: the top of a tree). */
  parent: string | null;
  card: OstCard;
}

/** A space map's view of one board. */
export interface MapBoard {
  id: string;
  name: string;
  product: string | null;
  cards: BoardCard[];
}

export function boardCardsOf(doc: Doc): BoardCard[] {
  const out: BoardCard[] = [];
  const walk = (id: string, parent: string | null) => {
    const n = doc.nodes[id];
    if (!isOstCard(n)) return;
    out.push({ id, parent, card: n.meta.ost! });
    for (const c of n.children) walk(c, id);
  };
  for (const id of doc.roots) walk(id, null);
  return out;
}
