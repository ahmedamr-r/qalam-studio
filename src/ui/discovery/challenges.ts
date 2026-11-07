import { create } from "zustand";
import { checkRequest } from "@/challenge/request";
import type { Challenge, ChallengeRun } from "@/challenge/types";
import { studio } from "@/doc/store";
import { knownBacked } from "@/discovery/evidence";
import { cardOf } from "@/discovery/ops";
import type { EvidenceOf, Proposal } from "@/discovery/proposals";
import type { OstEvidence } from "@/discovery/types";
import { carryChecks, checkProposals, decideCheck, storedCheck } from "@/org/challenge";
import { useSpaceView } from "@/space/view";
import { visitSources } from "./sources";

/*
 * The check of what's under review, in the window (src/challenge/, server/org/challenge.ts): run just
 * before a review opens, so the person sees what their own evidence says against the proposals beside
 * them, and keeps, changes or drops each challenge. What they keep goes onto the cards they accept.
 */

export interface ChallengeUI {
  /** The review the check is for (its key), and the check. */
  key: string | null;
  run: ChallengeRun | null;
  checking: boolean;
  /** The canvas's list under the review's pill, open or folded: folded at first, since the chat shows it beside the review. */
  open: boolean;
}

export const useChallenges = create<ChallengeUI>(() => ({ key: null, run: null, checking: false, open: false }));

/** A review's origin, as far as its check is keyed. */
export type CheckedOrigin = { kind: string; turn?: string; sourceId?: string; topic?: string | null; goal?: string };

/** Which review a check is for: plan mode's, a brain dump's, or a card's draft (null: one that isn't checked). */
export function checkKey(origin: CheckedOrigin, proposals: readonly Proposal[]): string | null {
  if (origin.kind === "plan" && origin.turn) return `plan:${origin.turn}`;
  if (origin.kind === "dump" && origin.sourceId) return `dump:${origin.sourceId}`;
  if ((origin.kind === "problems" || origin.kind === "breakdown") && origin.goal) return `${origin.kind}:${origin.goal}`;
  if (origin.kind === "solutions") {
    const first = proposals.find((p): p is Extract<Proposal, { kind: "card" }> => p.kind === "card");
    return origin.topic ? `solutions:${origin.topic}` : first?.parentId ? `solutions:card:${first.parentId}` : null;
  }
  return null;
}

/** The check that's showing, for this review. */
export const challengesOf = (key: string | null) => {
  const s = useChallenges.getState();
  return key && s.key === key ? s.run : null;
};

/** The challenges a person still sees: all but the ones they dropped. */
export const shownChallenges = (run: ChallengeRun | null): Challenge[] => (run?.challenges ?? []).filter((c) => c.state !== "dropped");

/** Check proposals before their review opens; null when there's nothing to check, or the check failed (the review opens either way). */
export async function checkFor(key: string, asked: string, proposals: readonly Proposal[], evidenceOf: EvidenceOf, onLabel?: (label: string) => void, signal?: AbortSignal): Promise<ChallengeRun | null> {
  const doc = studio().doc;
  const view = useSpaceView.getState();
  const req = checkRequest({
    key,
    asked,
    product: view.space,
    doc,
    things: view.things,
    proposals,
    unbacked: (id) => {
      const c = cardOf(doc, id);
      return !!c && !knownBacked(c);
    },
    unbackedProposal: (p) => !knownBacked({ evidence: [...p.backing.quotes.flatMap((q) => evidenceOf(q, false) ?? []), ...p.backing.words] as OstEvidence[] }),
  });
  if (!req.items.length) return null;
  useChallenges.setState({ checking: true });
  try {
    const run = await checkProposals(req, onLabel, signal);
    // The words they rest on are in the organization's sources: shown here, so a kept one can go onto a card.
    await visitSources([...new Set(run.challenges.flatMap((c) => c.cites.flatMap((x) => (x.sourceId ? [x.sourceId] : []))))]).catch(() => {});
    useChallenges.setState({ key, run, open: false });
    return run;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    useChallenges.setState({ key, run: null });
    return null;
  } finally {
    useChallenges.setState({ checking: false });
  }
}

/** A review opened again (a reload, Review them): the check kept with it, when it read these proposals. */
export async function loadCheck(key: string, proposals: readonly Proposal[]) {
  if (useChallenges.getState().key === key) return;
  const run = await storedCheck(key).catch(() => null);
  if (!run || !proposals.some((p) => run.items.includes(p.id))) return;
  await visitSources([...new Set(run.challenges.flatMap((c) => c.cites.flatMap((x) => (x.sourceId ? [x.sourceId] : []))))]).catch(() => {});
  useChallenges.setState({ key, run, open: false });
}

/** Keep a challenge, change it into their words, drop it, or none again. */
export async function decide(id: string, state: "kept" | "changed" | "dropped" | null, words?: string) {
  const { key, run } = useChallenges.getState();
  if (!key || !run) return;
  // Shown at once; the core's answer stands.
  useChallenges.setState({ run: { ...run, challenges: run.challenges.map((c) => (c.id === id ? { ...c, state: state ?? undefined, ...(words ? { words } : {}) } : c)) } });
  const next = await decideCheck(key, id, state, words).catch(() => null);
  if (next && useChallenges.getState().key === key) useChallenges.setState({ run: next });
}

/** What a person kept or changed. */
export const keptChallenges = (run: ChallengeRun | null) => (run?.challenges ?? []).filter((c) => c.state === "kept" || c.state === "changed");

/** The words a kept challenge rests on, as what speaks against each accepted card: the source's own words, never the challenge's. */
export function keptAgainst(accepted: readonly Proposal[]): Proposal[] {
  const kept = keptChallenges(useChallenges.getState().run);
  const out: Proposal[] = [];
  const seen = new Set<string>();
  for (const p of accepted) {
    if (p.kind !== "card") continue;
    for (const c of kept) {
      if (!c.on.includes(p.id)) continue;
      for (const x of c.cites) {
        if (!x.sourceId || !x.quoteId || seen.has(`${p.cardId}:${x.quoteId}`)) continue;
        seen.add(`${p.cardId}:${x.quoteId}`);
        out.push({ id: `chal:${c.id}:${p.cardId}:${x.quoteId}`, kind: "against", cardId: p.cardId, quote: { sourceId: x.sourceId, quoteId: x.quoteId }, why: c.words ?? c.line });
      }
    }
  }
  return out;
}

/** The accepted proposals' kept challenges, onto the cards they became (Needs a look, the card's mark). */
export function carryKept(accepted: readonly Proposal[]) {
  const { key, run } = useChallenges.getState();
  if (!key || !keptChallenges(run).length) return;
  const cards = accepted.flatMap((p) => (p.kind === "card" && keptChallenges(run).some((c) => c.on.includes(p.id)) ? [{ item: p.id, card: p.cardId }] : []));
  if (cards.length) void carryChecks(key, useSpaceView.getState().space, cards).catch(() => {});
}
