import { create } from "zustand";
import { studio, useStudio } from "@/doc/store";
import type { Doc } from "@/doc/schema";
import { isOstCard } from "@/doc/board";
import { useGhosts, type Ghost } from "@/doc/ghosts";
import { feedback } from "@/commands/feedback";
import { cardOf } from "@/discovery/ops";
import { hasQuote, quoteEvidence } from "@/discovery/sources";
import { dropProblem } from "@/discovery/ops";
import { applyProposal, proposalDoc, proposalKey, touchedRoots, withDependents, withNeeds, type EvidenceOf, type Proposal } from "@/discovery/proposals";
import type { DumpCounts } from "@/discovery/dump";
import { sourceOf, updateSource, useSources } from "./sources";

/*
 * Qalam AI's proposals for the board, under review: the board as it would be is drawn over the
 * real trees (one ghost per tree it changes, covering it), with what would change faded in Qalam
 * AI's colour. Each proposal is accepted (one undo step) or discarded on its own, or all at once;
 * one that waits on another goes with it. The ghost follows the board: edit a tree meanwhile and
 * it's rebuilt; a proposal that no longer fits drops out. One review at a time: from the sources,
 * or from a brain dump (whose proposals are kept on it, so a reload doesn't lose them).
 */

export const REVIEW_TURN = "discovery:review";

export type ReviewOrigin = { kind: "sources" } | { kind: "dump"; sourceId: string };

export interface ReviewUI {
  origin: ReviewOrigin | null;
  proposals: Proposal[];
}

export const useReview = create<ReviewUI>(() => ({ origin: null, proposals: [] }));

/** A quote (or a brain dump's piece) as evidence on a card (null once its source or the words are gone). */
export const evidenceOf: EvidenceOf = (q, against) => {
  const s = sourceOf(q.sourceId);
  const quote = s?.quotes.find((x) => x.id === q.quoteId);
  return s && quote ? quoteEvidence(s, quote, "ai", { against }) : null;
};

/** Still fits the board: what it changes is there (or waits on another proposal), and still would change. */
function fits(p: Proposal, all: Proposal[]): boolean {
  const doc = studio().doc;
  const pending = (id: string | null) => !!id && all.some((x) => x.kind === "card" && x.cardId === id);
  const here = (id: string | null) => !!id && !!doc.nodes[id];
  switch (p.kind) {
    case "attach":
    case "against": {
      const ev = evidenceOf(p.quote, false);
      const c = cardOf(doc, p.cardId);
      return !!c && !!ev && !hasQuote(c, ev.sourceId!, ev.span!);
    }
    case "card": {
      if (doc.nodes[p.cardId] || (p.parentId && !here(p.parentId) && !pending(p.parentId))) return false;
      const quotes = p.backing.quotes.filter((q) => !!evidenceOf(q, false)).length;
      return quotes + p.backing.words.length > 0 || (p.card.kind === "opportunity" && !p.backing.quotes.length);
    }
    case "assumption": {
      const c = cardOf(doc, p.cardId);
      const have = new Set((c?.assumptions ?? []).map((a) => a.text.trim().toLowerCase()));
      return c?.kind === "solution" && p.assumptions.some((a) => !have.has(a.text.trim().toLowerCase()));
    }
    case "metric": {
      const m = cardOf(doc, p.cardId);
      return m?.kind === "outcome" && Object.entries(p.metric).some(([k, v]) => m.metric?.[k as keyof typeof p.metric] !== v);
    }
    case "edit":
      return cardOf(doc, p.cardId)?.title === p.from;
    case "move": {
      const n = doc.nodes[p.cardId];
      if (!isOstCard(n) || (n.parentId ?? null) !== p.fromParent) return false;
      return p.parentId ? pending(p.parentId) || (here(p.parentId) && !dropProblem(doc, [p.cardId], p.parentId)) : n.meta.ost.kind === "outcome";
    }
    case "merge":
      return here(p.cardId) && here(p.dropId) && cardOf(doc, p.cardId)?.kind === cardOf(doc, p.dropId)?.kind;
    case "note":
      return !doc.nodes[p.cardId] && (!p.anchorId || here(p.anchorId) || pending(p.anchorId));
  }
}

/** The board as it would be, as ghosts: trees a move or merge joins are drawn together, then one ghost per tree. */
export function ghostsFor(doc: Doc, proposals: Proposal[], turnId: string, keyOf = (root: string) => `${turnId}:${root}`): Ghost[] {
  // Group the proposals by the trees they touch (joined when one touches two).
  const group = new Map<string, string>();
  const find = (x: string): string => (group.get(x) === x || !group.has(x) ? (group.set(x, x), x) : find(group.get(x)!));
  const touched = proposals.map((p) => touchedRoots(doc, p, proposals));
  for (const roots of touched) for (const r of roots.slice(1)) group.set(find(r), find(roots[0]));
  const byGroup = new Map<string, { roots: Set<string>; list: Proposal[] }>();
  proposals.forEach((p, i) => {
    const roots = touched[i];
    if (!roots.length) return;
    const g = find(roots[0]);
    const cur = byGroup.get(g) ?? { roots: new Set<string>(), list: [] };
    roots.forEach((r) => cur.roots.add(r));
    cur.list.push(p);
    byGroup.set(g, cur);
  });
  const ghosts: Ghost[] = [];
  for (const { roots, list } of byGroup.values()) {
    const g = proposalDoc(doc, [...roots], list, evidenceOf);
    if (!g) continue;
    for (const r of g.roots) ghosts.push({ key: keyOf(r), turnId, index: 0, doc: { ...g, roots: [r] }, ...(doc.nodes[r] ? { covers: r } : {}) });
    // A tree a merge or a move took apart still hides under its ghost.
    for (const r of roots) if (doc.nodes[r] && !g.roots.includes(r)) ghosts.push({ key: keyOf(r), turnId, index: 0, doc: { ...g, roots: [] }, covers: r });
  }
  return ghosts;
}

let unsubscribe: (() => void) | null = null;
let frame = 0;

/** Draw the proposals over the trees they change (or stop, when none are left). */
function show() {
  frame = 0;
  const { proposals: all } = useReview.getState();
  const proposals = all.filter((p) => fits(p, all));
  if (proposals.length !== all.length) {
    useReview.setState({ proposals });
    void keep(useReview.getState().origin);
  }
  const ghosts = ghostsFor(studio().doc, proposals, REVIEW_TURN);
  useGhosts.setState((s) => ({ list: [...s.list.filter((g) => g.turnId !== REVIEW_TURN), ...ghosts] }));
  if (!proposals.length) {
    unsubscribe?.();
    unsubscribe = null;
    useReview.setState({ origin: null });
    return;
  }
  if (unsubscribe) return;
  const redraw = () => (frame ||= requestAnimationFrame(show));
  const offDoc = useStudio.subscribe((s, prev) => s.doc !== prev.doc && redraw());
  // A source removed takes its proposals with it.
  const offSources = useSources.subscribe((s, prev) => s.list !== prev.list && redraw());
  unsubscribe = () => {
    offDoc();
    offSources();
  };
}

/** A brain dump keeps what's still waiting, so a reload brings the review back (the origin is passed: the review may have just closed). */
async function keep(origin: ReviewOrigin | null, done?: Partial<DumpCounts>) {
  const { proposals } = useReview.getState();
  if (origin?.kind !== "dump") return;
  await updateSource(origin.sourceId, (s) => {
    if (!s.dump) return s;
    const was = s.dump.placed?.counts ?? { added: 0, attached: 0, edited: 0, notes: 0 };
    const counts = { added: was.added + (done?.added ?? 0), attached: was.attached + (done?.attached ?? 0), edited: was.edited + (done?.edited ?? 0), notes: was.notes + (done?.notes ?? 0) };
    return { ...s, dump: { ...s.dump, proposals, phase: proposals.length ? "review" : "placed", placed: { at: Date.now(), counts } } };
  });
}

/** Open a review (false when another one is waiting: one at a time). */
export function startReview(origin: ReviewOrigin, proposals: Proposal[]): boolean {
  const cur = useReview.getState();
  const same = cur.origin && JSON.stringify(cur.origin) === JSON.stringify(origin);
  if (cur.proposals.length && !same) {
    feedback(cur.origin?.kind === "dump" ? "Accept or discard Qalam AI's proposals from your brain dump first" : "Accept or discard Qalam AI's proposals from your sources first", { id: "discovery.review" });
    return false;
  }
  useReview.setState({ origin, proposals });
  // The real cards are under the ghost: nothing of them stays selected.
  studio().select([]);
  show();
  void keep(origin);
  return true;
}

/** The proposals on one card of the ghost (its id: a card they change or add, a note they add). */
export const proposalsOn = (proposals: Proposal[], nodeId: string) => proposals.filter((p) => p.cardId === nodeId);

/** Carry out these proposals, and any they wait on (one undo step together). */
export function acceptProposals(ids: string[]) {
  const { proposals: all, origin } = useReview.getState();
  const chosen = new Set(withNeeds(ids, all));
  if (!chosen.size) return;
  const n = { added: 0, attached: 0, against: 0, edited: 0, notes: 0 };
  studio().mutate((d) => {
    for (const p of all) {
      if (!chosen.has(p.id) || !applyProposal(d, p, evidenceOf)) continue;
      if (p.kind === "card") n.added++;
      else if (p.kind === "attach") n.attached++;
      else if (p.kind === "against") n.against++;
      else if (p.kind === "note") n.notes++;
      else n.edited++;
    }
  });
  useReview.setState({ proposals: all.filter((p) => !chosen.has(p.id)) });
  show();
  void keep(origin, { added: n.added, attached: n.attached + n.against, edited: n.edited, notes: n.notes });
  const plural = (k: number, one: string, many: string) => (k ? `${k} ${k === 1 ? one : many}` : "");
  const said = [plural(n.added, "card added", "cards added"), plural(n.attached, "quote attached", "quotes attached"), n.against && `${n.against} against noted`, plural(n.edited, "change made", "changes made"), plural(n.notes, "note added", "notes added")].filter(Boolean);
  if (said.length) feedback(said.join(" · "), { kind: "success", id: "discovery.review" });
}

/** Leave these proposals, and any that wait on them. They aren't proposed again. */
export function discardProposals(ids: string[]) {
  const { proposals: all, origin } = useReview.getState();
  const dropped = new Set(withDependents(ids, all));
  const gone = all.filter((p) => dropped.has(p.id));
  useReview.setState({ proposals: all.filter((p) => !dropped.has(p.id)) });
  show();
  // Words discarded for a card aren't proposed for it again (kept on the quote).
  const bySource = new Map<string, { quoteId: string; cardId: string }[]>();
  for (const p of gone) if (p.kind === "attach" || p.kind === "against") bySource.set(p.quote.sourceId, [...(bySource.get(p.quote.sourceId) ?? []), { quoteId: p.quote.quoteId, cardId: p.cardId }]);
  for (const [sourceId, list] of bySource)
    void updateSource(sourceId, (s) => ({
      ...s,
      quotes: s.quotes.map((q) => {
        const cards = list.filter((x) => x.quoteId === q.id).map((x) => x.cardId);
        return cards.length ? { ...q, dismissed: [...new Set([...(q.dismissed ?? []), ...cards])] } : q;
      }),
    }));
  // The rest of a brain dump's are remembered on it.
  const keys = gone.filter((p) => p.kind !== "attach" && p.kind !== "against").map((p) => proposalKey(p, all));
  if (origin?.kind === "dump" && keys.length) void updateSource(origin.sourceId, (s) => (s.dump ? { ...s, dump: { ...s.dump, dismissed: [...new Set([...(s.dump.dismissed ?? []), ...keys])] } } : s)).then(() => keep(origin));
  else void keep(origin);
}

export const acceptAll = () => acceptProposals(useReview.getState().proposals.map((p) => p.id));
export const discardAll = () => discardProposals(useReview.getState().proposals.map((p) => p.id));

/** A covered tree's cards can't be picked while Qalam AI's version is over them. */
export function reviewing(): boolean {
  return useReview.getState().proposals.length > 0;
}
