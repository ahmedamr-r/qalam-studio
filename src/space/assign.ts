import type { Doc } from "@/doc/schema";
import { isOstCard } from "@/doc/board";
import { isProblemPage } from "./compose";

/*
 * Which board each card on the space's canvas is on (pure). A goal's card stays on its goal's
 * board wherever it hangs (the goals' tree is goals.md's, not a board's); a card at the top keeps
 * the board it was on; any other card is on the board of the card above it, so a card moved under
 * another tree's card moves to that tree's board, with its children. A card with no board yet gets
 * `new:<id>`: a top card's own id, or the goal's card it hangs under (its board starts there).
 */

export const NEW = "new:";
export const isNewBoard = (key: string) => key.startsWith(NEW);

export interface Known {
  /** The board each card was on when the canvas was last composed or saved. */
  boardOf: ReadonlyMap<string, string>;
  /** Goals' cards on a board: they stay on it. */
  anchors: ReadonlySet<string>;
  /** Goals with no board yet: what goes under one starts its board. */
  virtual: ReadonlySet<string>;
}

export function assignBoards(doc: Doc, k: Known): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (id: string, above: string | null) => {
    const n = doc.nodes[id];
    if (!isOstCard(n)) return;
    let key: string | undefined;
    if (isProblemPage(id)) key = undefined;
    else if (k.virtual.has(id)) key = `${NEW}${id}`;
    else if (k.anchors.has(id)) key = k.boardOf.get(id) ?? `${NEW}${id}`;
    else if (above) key = above;
    else key = k.boardOf.get(id) ?? `${NEW}${id}`;
    if (key) out.set(id, key);
    for (const c of n.children) walk(c, key ?? null);
  };
  for (const r of doc.roots) walk(r, null);
  return out;
}
