import { create } from "zustand";
import { isOstCard } from "@/doc/board";
import { studio } from "@/doc/store";
import { updateCardIn } from "@/discovery/ops";
import type { CardFacts, NextStep } from "@/discovery/next";
import type { GoalLever } from "@/goals/types";
import { goalHref, placeHref, topicHref } from "@/projects/model";
import { navigate } from "../nav";
import { findBackingFor } from "./backing";
import { breakDownFor, draftProblemsFor, findProblemsFor, lookOutsideFor, reviewPartsFor, reviewProblemsFor } from "./goal-steps";
import { draftSolutionsFor } from "./solutions";
import { useDiscovery } from "./store";
import { draftTestsFor } from "./tests";

/*
 * A picked card's next steps run (src/discovery/next.ts says which fit): drafts through their own
 * flows, which keep what Qalam AI is doing in ./busy.ts, and the rest in place. Whether the box is
 * folded is this tab's.
 */

const FOLDED = "qalam.next.folded";

const readFolded = () => {
  try {
    return sessionStorage.getItem(FOLDED) === "1";
  } catch {
    return false;
  }
};

export const useNextSteps = create<{ folded: boolean; /** The step drawn first beside the picked card, for ⌘↵. */ first: { card: string; run: () => void } | null }>(() => ({ folded: readFolded(), first: null }));

export function foldNextSteps(folded: boolean) {
  useNextSteps.setState({ folded });
  try {
    sessionStorage.setItem(FOLDED, folded ? "1" : "0");
  } catch {
    // Only this tab's view.
  }
}

/** Run one of a card's next steps (Break it down with the levers picked: none, Qalam AI's choice). */
export async function runStep(card: string, step: NextStep, f: CardFacts, o: { levers?: GoalLever[] } = {}): Promise<void> {
  if (step.blocked) return;
  switch (step.id) {
    case "find-problems":
      if (f.goal) await findProblemsFor(card, f.goal.id);
      return;
    case "break-down":
      if (f.goal) await breakDownFor(card, f.goal.id, o.levers ?? []);
      return;
    case "review-parts":
      if (f.goal) await reviewPartsFor(card, f.goal.id);
      return;
    case "draft-problems":
      if (f.goal) await draftProblemsFor(card, f.goal.id);
      return;
    case "review-problems":
      if (f.goal) await reviewProblemsFor(card, f.goal.id);
      return;
    case "others":
      if (f.goal) await lookOutsideFor(card, f.goal.id);
      return;
    case "find-backing":
      return findBackingFor(card);
    case "connect":
      navigate(placeHref("connections"));
      return;
    // Asked in the box first (./NextSteps.tsx): a tool and its words, a file.
    case "watch":
    case "add-file":
      return;
    case "draft-solutions":
      return draftSolutionsFor(card);
    case "draft-tests":
      return draftTestsFor(card);
    case "design-this":
      useDiscovery.setState({ designFor: card });
      return;
    case "page":
      if (f.page) navigate(topicHref(f.page.topic));
      return;
    case "next-job":
      if (f.goal) navigate(`${goalHref(f.goal.id)}#unknowns`);
      return;
    case "pass-line":
      return usePassLine(card);
  }
}

/** The pass line Qalam AI suggested for a test, taken as the person's own (as the card panel's "Use it"). */
function usePassLine(card: string) {
  const n = studio().doc.nodes[card];
  const t = isOstCard(n) ? n.meta.ost.test : undefined;
  if (!t?.suggested) return;
  const criterion = t.suggested.criterion;
  studio().mutate((d) => updateCardIn(d, card, (c) => void (c.test = { ...(c.test ?? { assumptionIds: [] }), criterion, suggested: undefined })));
}
