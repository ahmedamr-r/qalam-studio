import { create } from "zustand";
import { feedback } from "@/commands/feedback";
import { isOstCard } from "@/doc/board";
import { newId } from "@/doc/factory";
import { studio } from "@/doc/store";
import { cardOf } from "@/discovery/ops";
import { testProposals } from "@/discovery/tests";
import type { OstCard } from "@/discovery/types";
import { metricLine } from "@/goals/goals-md";
import { draftTests } from "@/org/tests";
import { startReview } from "./review";

/*
 * Drafting a solution card's tests on a board (src/discovery/tests.ts): the solution asks, with the
 * problem it's under and the goal above it, and what Qalam AI drafted comes back as proposals to
 * review: its riskiest assumptions onto the card, and a test of the riskiest under it.
 */

export const useTesting = create<{ card: string | null; label: string | null }>(() => ({ card: null, label: null }));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const words = (c: OstCard) => ({ title: c.title, evidence: c.evidence.filter((e) => e.stance !== "against").map((e) => ({ text: e.text, kind: e.kind, ...(e.piece ? { piece: e.piece } : {}), ...(e.sourceTitle ? { sourceTitle: e.sourceTitle } : {}) })) });

/** Qalam AI drafts a solution's riskiest assumptions and a test of the riskiest; they come back as proposals on it. */
export async function draftTestsFor(cardId: string): Promise<void> {
  if (useTesting.getState().card) return;
  const doc = studio().doc;
  const node = doc.nodes[cardId];
  const card = cardOf(doc, cardId);
  if (!isOstCard(node) || card?.kind !== "solution") return;
  // The problem it's under, and the goal at the top of its tree.
  const problem = node.parentId ? cardOf(doc, node.parentId) : null;
  let top = node;
  while (top.parentId && isOstCard(doc.nodes[top.parentId])) top = doc.nodes[top.parentId] as typeof node;
  const goal = cardOf(doc, top.id);
  const tests = node.children.flatMap((id) => (cardOf(doc, id)?.kind === "test" ? [cardOf(doc, id)!.title] : []));
  useTesting.setState({ card: cardId, label: "Reading what the solution rests on" });
  try {
    const d = await draftTests(
      {
        solution: { ...words(card), description: card.description ?? "", assumptions: (card.assumptions ?? []).map((a) => a.text), tests },
        problem: problem?.kind === "opportunity" ? words(problem) : null,
        goal: goal?.kind === "outcome" ? { title: goal.title, metric: goal.metric ? metricLine(goal.metric) : null } : null,
      },
      (label) => useTesting.setState({ label }),
    );
    const proposals = testProposals(d, cardId, newId);
    if (!proposals.length || !startReview({ kind: "tests" }, proposals)) return void feedback(d.note || "Qalam AI found nothing new it could stand behind.", { id: "discovery.tests" });
    if (d.note) feedback(d.note, { id: "discovery.tests" });
  } catch (e) {
    feedback(`Qalam AI couldn't draft its tests: ${message(e)}`, { kind: "error", id: "discovery.tests" });
  } finally {
    useTesting.setState({ card: null, label: null });
  }
}
