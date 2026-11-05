import { feedback } from "@/commands/feedback";
import { isOstCard } from "@/doc/board";
import { newId } from "@/doc/factory";
import { studio } from "@/doc/store";
import { cardOf } from "@/discovery/ops";
import { testProposals } from "@/discovery/tests";
import { nearestProblem } from "@/discovery/tree";
import type { OstCard } from "@/discovery/types";
import { metricLine } from "@/goals/goals-md";
import { draftTests } from "@/org/tests";
import { begin, end, relabel, stopped } from "./busy";
import { reviewWaits, startReview } from "./review";
import { sentEvidence } from "./solutions";

/*
 * Drafting a solution card's tests on a board (src/discovery/tests.ts): the solution asks, with the
 * problem it's under and the goal above it, and what Qalam AI drafted comes back as proposals to
 * review: its riskiest assumptions onto the card, and a test of the riskiest under it.
 */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const words = (c: OstCard) => ({ title: c.title, evidence: sentEvidence(c.evidence).map(({ sourceId: _s, ...e }) => e) });

/** Qalam AI drafts a solution's riskiest assumptions and a test of the riskiest; they come back as proposals on it. */
export async function draftTestsFor(cardId: string): Promise<void> {
  const doc = studio().doc;
  const node = doc.nodes[cardId];
  const card = cardOf(doc, cardId);
  if (!isOstCard(node) || card?.kind !== "solution") return;
  const waits = reviewWaits();
  if (waits) return void feedback(waits, { id: "discovery.tests" });
  // The problem it's under, and the nearest goal above it (on the space's canvas the top is the North Star).
  const problem = cardOf(doc, nearestProblem(doc, cardId));
  let at = node.parentId;
  while (at && isOstCard(doc.nodes[at]) && cardOf(doc, at)?.kind !== "outcome") at = doc.nodes[at].parentId;
  const goal = at ? cardOf(doc, at) : null;
  const tests = node.children.flatMap((id) => (cardOf(doc, id)?.kind === "test" ? [cardOf(doc, id)!.title] : []));
  const ctrl = begin(cardId, "draft-tests", "Reading what the solution rests on");
  if (!ctrl) return void feedback("Qalam AI is still on another card", { id: "discovery.tests" });
  try {
    const d = await draftTests(
      {
        solution: { ...words(card), description: card.description ?? "", assumptions: (card.assumptions ?? []).map((a) => a.text), tests },
        problem: problem?.kind === "opportunity" ? words(problem) : null,
        goal: goal?.kind === "outcome" ? { title: goal.title, metric: goal.metric ? metricLine(goal.metric) : null } : null,
      },
      (label) => relabel(ctrl, label),
      ctrl.signal,
    );
    const proposals = testProposals(d, cardId, newId);
    if (!proposals.length) return void feedback(d.note || "Qalam AI found nothing new it could stand behind.", { id: "discovery.tests" });
    if (startReview({ kind: "tests" }, proposals) && d.note) feedback(d.note, { id: "discovery.tests" });
  } catch (e) {
    if (stopped(e)) feedback("Stopped: no tests drafted", { id: "discovery.tests" });
    else feedback(`Qalam AI couldn't draft its tests: ${message(e)}`, { kind: "error", id: "discovery.tests" });
  } finally {
    end(ctrl);
  }
}
