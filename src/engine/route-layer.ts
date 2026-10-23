import type { Doc } from "@/doc/schema";
import { studio } from "@/doc/store";
import { partIndex } from "@/proto/routes";

/*
 * Routes and the canvas: with View ▸ Prototype parts off, a route's parts (its sheets, dialogs,
 * bars) leave the canvas — they aren't drawn, labelled or hit — and the containers and wires go
 * with them. The document is untouched: hiding them is a view, not an edit, so it isn't in undo.
 */

const EMPTY = new Set<string>();
const cache = new WeakMap<Doc, Set<string>>();

/** The frames hidden from the canvas right now: routes' parts while Prototype parts are off, and takes tucked away behind the chosen one. */
export function hiddenParts(doc: Doc = studio().doc): Set<string> {
  const parts = !studio().view.routeParts;
  const tucked = doc.proto?.takes?.some((g) => g.collapsed);
  if (!parts && !tucked) return EMPTY;
  const memo = parts ? cache : tuckedCache;
  let ids = memo.get(doc);
  if (!ids) {
    ids = new Set([...(parts ? partIndex(doc).keys() : []), ...(doc.proto?.takes ?? []).flatMap((g) => (g.collapsed ? g.frames.filter((f) => f !== g.chosen) : []))]);
    memo.set(doc, ids);
  }
  return ids;
}
const tuckedCache = new WeakMap<Doc, Set<string>>();
