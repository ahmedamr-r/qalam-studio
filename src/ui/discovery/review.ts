import { studio, useStudio } from "@/doc/store";
import { isOstCard, treeRootOf } from "@/doc/board";
import { useGhosts, type Ghost } from "@/doc/ghosts";
import { feedback } from "@/commands/feedback";
import { cardOf } from "@/discovery/ops";
import { hasQuote, quoteEvidence } from "@/discovery/sources";
import { applyProposal, proposalDoc, proposalTarget, type EvidenceOf, type Proposal } from "@/discovery/synthesis";
import { sourceOf, updateSource, useSources } from "./sources";

/*
 * Qalam AI's proposals for the tree, under review: the tree as it would be is drawn over the real
 * one (a ghost that covers it), with what would change faded in Qalam AI's colour. Each proposal is
 * accepted (one undo step) or discarded on its own, or all at once. The ghost follows the board:
 * edit the tree meanwhile and it's rebuilt; a proposal that no longer fits drops out.
 */

export const REVIEW_TURN = "discovery:review";

/** A quote as evidence on a card (null once its source or the quote is gone). */
export const evidenceOf: EvidenceOf = (q, against) => {
  const s = sourceOf(q.sourceId);
  const quote = s?.quotes.find((x) => x.id === q.quoteId);
  return s && quote ? quoteEvidence(s, quote, "ai", { against }) : null;
};

/** Still fits the board: its card is there and doesn't have the words yet. */
function fits(p: Proposal): boolean {
  const doc = studio().doc;
  const target = cardOf(doc, proposalTarget(p));
  if (!target) return false;
  if (p.kind === "opportunity") return !doc.nodes[p.cardId] && p.quotes.some((q) => !!evidenceOf(q, false));
  const ev = evidenceOf(p.quote, false);
  return !!ev && !hasQuote(target, ev.sourceId!, ev.span!);
}

let unsubscribe: (() => void) | null = null;
let frame = 0;

/** Draw the proposals over the trees they change (or stop, when none are left). */
function show() {
  frame = 0;
  const all = useSources.getState().proposals;
  const proposals = all.filter(fits);
  if (proposals.length !== all.length) useSources.setState({ proposals });
  const doc = studio().doc;
  const byRoot = new Map<string, Proposal[]>();
  for (const p of proposals) {
    const root = treeRootOf(doc, proposalTarget(p));
    if (root && doc.roots.includes(root)) byRoot.set(root, [...(byRoot.get(root) ?? []), p]);
  }
  const ghosts: Ghost[] = [];
  for (const [root, list] of byRoot) {
    const g = proposalDoc(doc, root, list, evidenceOf);
    if (g) ghosts.push({ key: `${REVIEW_TURN}:${root}`, turnId: REVIEW_TURN, index: 0, doc: g, covers: root });
  }
  useGhosts.setState((s) => ({ list: [...s.list.filter((g) => g.turnId !== REVIEW_TURN), ...ghosts] }));
  if (!proposals.length) {
    unsubscribe?.();
    unsubscribe = null;
  } else
    unsubscribe ??= useStudio.subscribe((s, prev) => {
      if (s.doc !== prev.doc && !frame) frame = requestAnimationFrame(show);
    });
}

export function startReview(proposals: Proposal[]) {
  useSources.setState({ proposals });
  // The real cards are under the ghost: nothing of them stays selected.
  studio().select([]);
  show();
}

/** The proposals on one card of the ghost (its id: a card they change, or the card one adds). */
export const proposalsOn = (proposals: Proposal[], nodeId: string) => proposals.filter((p) => p.cardId === nodeId);

/** Carry out these proposals (one undo step together). */
export function acceptProposals(ids: string[]) {
  const all = useSources.getState().proposals;
  const chosen = all.filter((p) => ids.includes(p.id));
  if (!chosen.length) return;
  let quotes = 0;
  let against = 0;
  let added = 0;
  studio().mutate((d) => {
    for (const p of chosen) {
      if (!applyProposal(d, p, evidenceOf)) continue;
      if (p.kind === "opportunity") added++;
      else if (p.kind === "against") against++;
      else quotes++;
    }
  });
  useSources.setState({ proposals: all.filter((p) => !ids.includes(p.id)) });
  show();
  const said = [quotes && `${quotes} ${quotes === 1 ? "quote" : "quotes"} attached`, added && `${added} ${added === 1 ? "opportunity" : "opportunities"} added`, against && `${against} against noted`].filter(Boolean);
  if (said.length) feedback(said.join(" · "), { kind: "success", id: "discovery.review" });
}

export function discardProposals(ids: string[]) {
  const gone = useSources.getState().proposals.filter((p) => ids.includes(p.id));
  useSources.setState((s) => ({ proposals: s.proposals.filter((p) => !ids.includes(p.id)) }));
  show();
  // A quote discarded for a card isn't proposed for it again.
  const bySource = new Map<string, { quoteId: string; cardId: string }[]>();
  for (const p of gone) if (p.kind !== "opportunity") bySource.set(p.quote.sourceId, [...(bySource.get(p.quote.sourceId) ?? []), { quoteId: p.quote.quoteId, cardId: p.cardId }]);
  for (const [sourceId, list] of bySource)
    void updateSource(sourceId, (s) => ({
      ...s,
      quotes: s.quotes.map((q) => {
        const cards = list.filter((x) => x.quoteId === q.id).map((x) => x.cardId);
        return cards.length ? { ...q, dismissed: [...new Set([...(q.dismissed ?? []), ...cards])] } : q;
      }),
    }));
}

export const acceptAll = () => acceptProposals(useSources.getState().proposals.map((p) => p.id));
export const discardAll = () => discardProposals(useSources.getState().proposals.map((p) => p.id));

/** A covered tree's cards can't be picked while Qalam AI's version is over them. */
export function reviewing(): boolean {
  return useSources.getState().proposals.length > 0;
}

/** Ids in the ghost the review's bars sit on: each card a proposal changes or adds, with its proposals. */
export function reviewTargets(): { id: string; ghost: Ghost; proposals: Proposal[] }[] {
  const proposals = useSources.getState().proposals;
  const out: { id: string; ghost: Ghost; proposals: Proposal[] }[] = [];
  for (const g of useGhosts.getState().list) {
    if (g.turnId !== REVIEW_TURN) continue;
    const ids = new Set(proposals.map((p) => p.cardId));
    for (const id of ids) if (isOstCard(g.doc.nodes[id])) out.push({ id, ghost: g, proposals: proposalsOn(proposals, id) });
  }
  return out;
}
