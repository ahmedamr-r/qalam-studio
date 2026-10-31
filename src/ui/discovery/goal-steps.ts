import { feedback } from "@/commands/feedback";
import { newId } from "@/doc/factory";
import { boundsOf, worldBounds } from "@/doc/geometry";
import { useGhosts } from "@/doc/ghosts";
import { studio } from "@/doc/store";
import { cardOf, newCard } from "@/discovery/ops";
import type { Proposal } from "@/discovery/proposals";
import type { Breakdown } from "@/goals/breakdown";
import type { DraftedProblems } from "@/goals/drafted";
import type { GoalLever } from "@/goals/types";
import { breakDown, draftProblems, findProblems, goalWork, lookOutside } from "@/org/goal-work";
import type { DraftWords } from "@/org/solutions";
import { begin, end, relabel, stopped, type Done } from "./busy";
import { onCanvasReady } from "./canvas";
import { REVIEW_TURN, reviewWaits, startReview, type ReviewOrigin } from "./review";
import { visitSources } from "./sources";
import { useDiscovery } from "./store";

/*
 * A goal's next steps on the canvas (server/org/goals.ts, server/org/outside.ts, server/org/problems.ts):
 * its problems found among the problem pages (they show faint under it) or drafted (reviewed as
 * problems under its card), the goals under it proposed and reviewed as ghosts under its card
 * (accepting puts one in goals.md), and what others aim for.
 */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** Break it down's proposals not decided yet, as goals drawn under the goal's card. */
export function partProposals(cardId: string, goal: string, b: Breakdown): Proposal[] {
  return b.parts
    .filter((p) => !b.decided[p.id])
    .map((p) => ({ id: `part:${p.id}`, kind: "goal" as const, cardId: newId(), parentId: cardId, goal, part: p, card: newCard("outcome", { title: p.title, createdBy: "ai", ...(p.metric ? { metric: p.metric } : {}) }), why: p.why }));
}

/** Drafted problems not decided yet, as problems under the goal's card resting on the words they cite. */
export function problemProposals(cardId: string, p: Pick<DraftedProblems, "drafts" | "quotes" | "decided">): Proposal[] {
  return p.drafts
    .filter((d) => !p.decided[d.id])
    .map((d) => ({
      id: `prob:${d.id}`,
      kind: "card" as const,
      cardId: newId(),
      parentId: cardId,
      card: newCard("opportunity", { title: d.title, ...(d.description ? { description: d.description } : {}), createdBy: "ai" }),
      backing: { quotes: d.cites.flatMap((ref) => (p.quotes[ref] ? [p.quotes[ref]] : [])), words: [] },
      why: d.why || d.description,
    }));
}

/** The breakdown's proposals under review, as ghosts under the goal's card, in view: false when there's nothing to show or another review is open. */
const reviewParts = (cardId: string, goal: string, b: Breakdown) => reviewUnder(cardId, { kind: "breakdown", goal, relation: b.relation }, partProposals(cardId, goal, b));

/** Drafted problems under review, their words' sources shown here until accepted. */
async function reviewProblems(cardId: string, goal: string, p: Pick<DraftedProblems, "drafts" | "quotes" | "decided">): Promise<boolean> {
  await visitSources([...new Set(Object.values(p.quotes).map((q) => q.sourceId))]);
  return reviewUnder(cardId, { kind: "problems", goal }, problemProposals(cardId, p));
}

/** Proposals under a goal's card under review, in view: false when there's nothing to show or another review is open. */
function reviewUnder(cardId: string, origin: ReviewOrigin, proposals: Proposal[]): boolean {
  if (!proposals.length || !startReview(origin, proposals)) return false;
  // The goal's card and what's drawn under it, framed clear of a panel lying over the canvas.
  const ids = [cardId, ...proposals.map((p) => p.cardId)];
  onCanvasReady((c) => {
    const ghost = useGhosts.getState().list.find((g) => g.turnId === REVIEW_TURN && ids.slice(1).some((id) => g.doc.nodes[id]));
    if (!ghost) return;
    const corners = ids.filter((id) => ghost.doc.nodes[id]).flatMap((id) => {
      const x = worldBounds(ghost.doc, id);
      return [{ x: x.x, y: x.y }, { x: x.x + x.w, y: x.y + x.h }];
    });
    c.glideTo(c.fitCamera(boundsOf(corners), { right: useDiscovery.getState().inset }, 1));
  });
  return true;
}

/** Run a goal's step as one thing Qalam AI does for its card, saying how it went. */
async function step(card: string, id: "find-problems" | "break-down" | "draft-problems" | "others", label: string, run: (ctrl: AbortController) => Promise<Done | null>, failed: string) {
  // What comes back as a review waits for the one that's open, before Qalam AI is asked.
  const waits = id === "break-down" || id === "draft-problems" ? reviewWaits() : null;
  if (waits) return void feedback(waits, { id: "discovery.goal" });
  const ctrl = begin(card, id, label);
  if (!ctrl) return void feedback("Qalam AI is still on another card", { id: "discovery.goal" });
  let done: Done | null = null;
  try {
    done = await run(ctrl);
  } catch (e) {
    if (stopped(e)) feedback("Stopped", { id: "discovery.goal" });
    else feedback(`${failed}: ${message(e)}`, { kind: "error", id: "discovery.goal" });
  } finally {
    end(ctrl, done ?? undefined);
  }
}

/** Find its problems: the problem pages that bear on the goal (and the goals under it) linked; the top ones show faint under it. */
export const findProblemsFor = (card: string, goal: string) =>
  step(
    card,
    "find-problems",
    "Qalam AI is reading the problems against the goal",
    async (ctrl) => {
      const r = await findProblems(goal, (label) => relabel(ctrl, label), ctrl.signal);
      return { card, text: r.kept ? `${plural(r.kept, "problem")} behind it now${r.added ? `, ${r.added} new` : ""}: the top ones show under it` : r.none || "No problem page bears on it yet." };
    },
    "Qalam AI couldn't find its problems",
  );

/** Break it down: the goals under it proposed with the levers picked (none: Qalam AI's choice) and the person's words when asked, reviewed as ghosts under its card. */
export const breakDownFor = (card: string, goal: string, levers: GoalLever[], said: DraftWords = {}) =>
  step(
    card,
    "break-down",
    "Gathering what your material says about it",
    async (ctrl) => {
      const r = await breakDown(goal, { levers, ...said }, (label) => relabel(ctrl, label), ctrl.signal);
      if (!r.parts) return { card, text: r.none || "Qalam AI found nothing it could stand behind to propose." };
      return reviewParts(card, goal, r.breakdown) ? null : { card, text: `${plural(r.parts, "goal")} proposed under it: review them once the review that's open is done.` };
    },
    "Qalam AI couldn't break it down",
  );

/** The goals proposed under it before and not decided yet, reviewed as ghosts under its card. */
export async function reviewPartsFor(card: string, goal: string) {
  const waits = reviewWaits();
  if (waits) return void feedback(waits, { id: "discovery.goal" });
  const b = (await goalWork(goal).catch(() => null))?.breakdown;
  if (!b || !reviewParts(card, goal, b)) feedback("Nothing proposed under it waits now", { id: "discovery.goal" });
}

/** Draft its problems: the customer problems behind it Qalam AI proposes (with the person's words, when they were asked), reviewed as problems under its card. */
export const draftProblemsFor = (card: string, goal: string, said: DraftWords = {}) =>
  step(
    card,
    "draft-problems",
    "Reading what bears on the goal",
    async (ctrl) => {
      // The problems under its card already aren't drafted again.
      const doc = studio().doc;
      const cards = (doc.nodes[card]?.children ?? []).flatMap((id) => {
        const c = cardOf(doc, id);
        return c?.kind === "opportunity" ? [c.title] : [];
      });
      const r = await draftProblems(goal, { cards, ...said }, (label) => relabel(ctrl, label), ctrl.signal);
      if (!r.drafts.length) return { card, text: r.note || "Qalam AI found no problem it could stand behind." };
      if (!(await reviewProblems(card, goal, { drafts: r.drafts, quotes: r.quotes, decided: {} }))) return { card, text: `${plural(r.drafts.length, "problem")} drafted for it: review them once the review that's open is done.` };
      if (r.note) feedback(r.note, { id: "discovery.goal" });
      return null;
    },
    "Qalam AI couldn't draft its problems",
  );

/** The problems drafted for it before and not decided yet, reviewed under its card. */
export async function reviewProblemsFor(card: string, goal: string) {
  const waits = reviewWaits();
  if (waits) return void feedback(waits, { id: "discovery.goal" });
  const p = (await goalWork(goal).catch(() => null))?.problems;
  if (!p || !(await reviewProblems(card, goal, p))) feedback("No drafted problem waits now", { id: "discovery.goal" });
}

/** What others aim for: looked up on the web, each number checked on its page; the first few said beside the goal. */
export const lookOutsideFor = (card: string, goal: string) =>
  step(
    card,
    "others",
    "Looking up what companies like yours aim for",
    async (ctrl) => {
      const r = await lookOutside(goal, (label) => relabel(ctrl, label), ctrl.signal);
      if (r.error) return { card, text: r.error };
      const claims = (await goalWork(goal).catch(() => null))?.outside?.claims ?? [];
      if (!r.kept || !claims.length) return { card, text: `Read ${plural(r.read, "page")}; no number on them held up.` };
      return {
        card,
        text: `${plural(r.kept, "number")} others report, each found on its page (kept on the goal's page):`,
        claims: claims.slice(0, 3).map((c) => ({ value: c.unit === "%" ? `${c.value}%` : `${c.value.toLocaleString("en-US")}${c.unit ? ` ${c.unit}` : ""}`, what: c.what, who: c.who, url: c.url })),
      };
    },
    "Couldn't look it up",
  );
