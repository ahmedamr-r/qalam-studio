import { newCard } from "@/discovery/ops";
import type { Proposal, QuoteRef } from "@/discovery/proposals";
import { quotePiece, type SourceQuote } from "@/discovery/sources";
import { allCards } from "@/discovery/tree";
import type { Doc } from "@/doc/schema";
import { newId } from "@/doc/factory";
import { sameTopic } from "@/hub/topics";
import type { SetupSession } from "./setup";
import { setupGroups, titleOf } from "./setup-groups";
import type { QuoteHome } from "./setup-split";

/*
 * A setup's problems put on a board that didn't start from it (pure): each problem the reading
 * grouped (src/org/setup-groups.ts), with its quotes where they live now, proposed as a problem
 * under the board's outcome, unless the board has it already (the same words, or every quote of
 * it on a card). Nothing is asked of Qalam AI again: the setup read it, and the board reviews it.
 */

export function setupProposals(doc: Doc, session: Pick<SetupSession, "problems">, quotes: readonly SourceQuote[], homeOf: (quoteId: string) => QuoteHome | null, makeId: () => string = newId): Proposal[] {
  const cards = allCards(doc);
  const outcome = doc.roots.find((id) => cards.some((c) => c.id === id && c.card.kind === "outcome"));
  if (!outcome) return [];
  const on = new Set(cards.flatMap((c) => c.card.evidence.flatMap((e) => (e.piece ? [e.piece] : []))));
  const titles = cards.map((c) => c.card.title);
  const byId = new Map(quotes.map((q) => [q.id, q]));
  const { groups, loose } = setupGroups(session, quotes);
  const all = [...groups.map((g) => ({ title: g.title, by: g.by, quotes: g.quotes })), ...loose.map((id) => ({ title: titleOf(byId.get(id)!.text), by: undefined, quotes: [id] }))];
  const out: Proposal[] = [];
  for (const g of all) {
    const refs: QuoteRef[] = g.quotes.flatMap((id) => {
      const home = homeOf(id);
      return home ? [{ sourceId: home.source.id, quoteId: home.quote.id }] : [];
    });
    if (!refs.length || titles.some((t) => sameTopic(t, g.title)) || g.quotes.every((id) => on.has(quotePiece(id)))) continue;
    titles.push(g.title);
    const n = refs.length;
    out.push({ id: makeId(), kind: "card", cardId: makeId(), parentId: outcome, card: newCard("opportunity", { title: g.title, createdBy: g.by === "qalam" ? "ai" : "user" }), backing: { quotes: refs, words: [] }, why: `From what you sent in the setup: ${n} ${n === 1 ? "quote" : "quotes"}.` });
  }
  return out;
}
