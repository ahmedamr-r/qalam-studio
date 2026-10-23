import { studio } from "@/doc/store";
import { cardOf } from "@/discovery/ops";
import { discovery, useDiscovery } from "./store";

/**
 * Typing a card's title over it (TitleEditor.tsx). The edit is one undo step: a new card's
 * transaction is opened by whoever made it (so the card and its first title are one step, and
 * Esc on it takes the card back); an existing card's opens here.
 */
export function startTitleEdit(id: string, fresh: boolean) {
  const s = studio();
  const cur = discovery().editing;
  if (cur && cur.id !== id) finishTitleEdit("commit");
  if (!fresh) s.beginTx();
  useDiscovery.setState({ editing: { id, fresh } });
}

/** Done typing: keep it, or (Esc) take it back; a new card left empty goes away. */
export function finishTitleEdit(how: "commit" | "cancel") {
  const e = discovery().editing;
  if (!e) return;
  useDiscovery.setState({ editing: null });
  const doc = studio().doc;
  const card = cardOf(doc, e.id);
  if (how === "cancel" || (e.fresh && card && !card.title.trim() && !doc.nodes[e.id]?.children.length)) {
    studio().cancelTx();
    // An existing card stays selected; a new one that never was is gone.
    if (!studio().doc.nodes[e.id]) studio().select(studio().selection.filter((id) => studio().doc.nodes[id]));
    return;
  }
  studio().commitTx();
}

/** A card was deleted while being typed over (undo, another tab's edit): stop editing it. */
export function dropStaleEdit() {
  const e = discovery().editing;
  if (e && !studio().doc.nodes[e.id]) {
    useDiscovery.setState({ editing: null });
    studio().commitTx();
  }
}

