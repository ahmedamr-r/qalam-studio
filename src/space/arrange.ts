import { produce } from "immer";
import type { Doc, FrameNode } from "@/doc/schema";
import { isOstCard } from "@/doc/board";

/*
 * A card on another board never goes with a card it hangs under on the space's canvas (pure, a
 * document pass in the same undo step as the edit). Deleting a goal's card, or a problem's, keeps
 * what hangs under it from other boards (a sub-goal's card with its tree), where the deleted card
 * was: only the deleted card's own board loses cards.
 */

export function keepOtherBoards(prev: Doc, next: Doc, boardOf: (id: string) => string | undefined): Doc {
  if (prev.nodes === next.nodes) return next;
  const gone = (id: string) => isOstCard(prev.nodes[id]) && !next.nodes[id];
  // The cards deleted themselves: their card above is still there (or they were at the top).
  const tops = Object.keys(prev.nodes).filter((id) => gone(id) && !(prev.nodes[id].parentId && gone(prev.nodes[id].parentId!)));
  const back: { id: string; under: string | null; at: number }[] = [];
  for (const t of tops) {
    const board = boardOf(t);
    const under = prev.nodes[t].parentId && next.nodes[prev.nodes[t].parentId!] ? prev.nodes[t].parentId! : null;
    const list = under ? prev.nodes[under].children : prev.roots;
    let at = list.indexOf(t);
    const walk = (id: string) => {
      for (const c of prev.nodes[id].children) {
        if (!gone(c)) continue;
        const b = boardOf(c);
        if (b && b !== board) back.push({ id: c, under, at: at++ });
        else walk(c);
      }
    };
    walk(t);
  }
  if (!back.length) return next;
  return produce(next, (d) => {
    const copy = (id: string, parent: string | null) => {
      const n = prev.nodes[id] as FrameNode;
      const kids = n.children.filter((c) => gone(c) || !!d.nodes[c]);
      d.nodes[id] = { ...n, parentId: parent, children: kids.filter(gone) };
      for (const c of kids) if (gone(c)) copy(c, id);
    };
    for (const b of back) {
      copy(b.id, b.under);
      const list = b.under ? d.nodes[b.under].children : d.roots;
      list.splice(Math.min(b.at, list.length), 0, b.id);
    }
  });
}
