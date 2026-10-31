import { projectHref, spaceHref } from "@/projects/model";
import { useSpaceView } from "@/space/view";
import { itemSpace } from "../frame/spaces";
import { currentSpace, lastSpace } from "../frame/useSpace";

/**
 * Where a board's cards are worked on: its space's home (the space this tab was in when the board
 * is in it, else its product's), with the board's trees in view, or one card on it (`card`), and
 * anything else the address asked a board's page for (`query`).
 */
export function boardHomeHref(board: string, product: string | null, o: { card?: string; query?: string; org?: string } = {}): string {
  const space = itemSpace(product ? [product] : [], lastSpace(o.org));
  const q = new URLSearchParams(o.query ?? "");
  if (o.card) q.set("card", o.card);
  else if (!q.has("card")) q.set("board", board);
  return `${spaceHref(space, "home", o.org)}?${q}`;
}

/** A card's address: on this canvas when it's on it (picked in place), else its board's old address (the app finds its space). */
export function cardHref(board: string, card: string): string {
  if (useSpaceView.getState().boardOf.get(card) === board) return `${spaceHref(currentSpace())}?card=${encodeURIComponent(card)}`;
  return `${projectHref({ id: board, type: "discovery" })}?card=${encodeURIComponent(card)}`;
}

/** What a board's canvas is asked (`query`: drafts to review, a source to read): this canvas when the board's cards are on it, else the board's old address. */
export function boardHref(board: string, query: string): string {
  const here = [...useSpaceView.getState().boardOf.values()].includes(board);
  return `${here ? spaceHref(currentSpace()) : projectHref({ id: board, type: "discovery" })}?${query}`;
}
