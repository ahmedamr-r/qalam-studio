import { create } from "zustand";
import { isOstCard } from "@/doc/board";
import { studio } from "@/doc/store";
import { updateCardIn } from "@/discovery/ops";
import type { CardFacts, NextStep } from "@/discovery/next";
import { goalHref, topicHref } from "@/projects/model";
import { navigate } from "../nav";
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

/** Run one of a card's next steps. */
export async function runStep(card: string, step: NextStep, f: CardFacts): Promise<void> {
  if (step.blocked) return;
  switch (step.id) {
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
