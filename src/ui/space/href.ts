import { spaceHref } from "@/projects/model";
import { itemSpace } from "../frame/spaces";
import { lastSpace } from "../frame/useSpace";

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
