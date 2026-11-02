import { pieceBasis } from "@/discovery/basis";
import { studio } from "@/doc/store";
import { cardOf } from "@/discovery/ops";
import { cardRef } from "@/hub/pieces";
import { orgContext } from "@/org/pack";
import { boardOfCard, productOfCard } from "@/space/view";
import { say } from "./busy";
import { hubQuotes } from "./knowledge";
import { sourceOf } from "./sources";
import { useDiscovery, type FoundQuote } from "./store";

/*
 * What the organization already has that could back a card (its next steps' "Find what backs it"):
 * its search for the card's words (and the person's, when they said some), anchored on the card,
 * what it rests on already left out. No tokens: it's the organization's own search. The person
 * picks what fits (./QuotePicker.tsx); nothing is attached on its own.
 */

/** Find what backs it: what the organization has, picked in the right panel; else said beside the card. */
export async function findBackingFor(card: string) {
  const quotes = await backingFor(card).catch(() => []);
  if (!quotes.length) return say({ card, text: "Nothing in your organization backs it yet: add a file for it, or watch a tool for it." });
  useDiscovery.setState({ quotePick: { card, quotes } });
}

/** Quotes near a card's words, nearest first, with whose they are. */
export async function backingFor(cardId: string, words = ""): Promise<FoundQuote[]> {
  const doc = studio().doc;
  const card = cardOf(doc, cardId);
  if (!card) return [];
  const parentId = doc.nodes[cardId]?.parentId;
  const above = parentId ? (cardOf(doc, parentId)?.title ?? "") : "";
  const board = boardOfCard(cardId);
  const own = card.evidence.flatMap((e) => (e.piece ? [e.piece] : []));
  const org = await orgContext({ query: [card.title, card.description, above, words].filter(Boolean).join(" · "), ...(board ? { anchor: cardRef(board, cardId) } : {}), product: productOfCard(cardId), budget: 2400, wholeTop: 0, types: ["quote"], exclude: own });
  const found = await hubQuotes(org);
  return (org?.pieces ?? []).flatMap((p) => {
    const h = found.get(p.k);
    const s = h ? sourceOf(h.quote.sourceId) : undefined;
    const q = s?.quotes.find((x) => x.id === h?.quote.quoteId);
    if (!h || !s || !q) return [];
    const basis = pieceBasis(p);
    const whose = (p.sub ?? "").startsWith("online:") ? "online" : basis === "own" ? "yours" : basis === "said" ? "customers" : basis;
    return [{ sourceId: s.id, quoteId: q.id, text: q.text, speaker: q.speaker ?? null, from: s.title, whose }];
  });
}
