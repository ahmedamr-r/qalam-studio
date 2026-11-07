import { create } from "zustand";
import { isOstCard } from "@/doc/board";
import { studio } from "@/doc/store";
import { updateCardIn } from "@/discovery/ops";
import type { CardFacts, NextStep } from "@/discovery/next";
import type { GoalLever } from "@/goals/types";
import { goalHref, placeHref, topicHref } from "@/projects/model";
import { navigate } from "../nav";
import { findBackingFor } from "./backing";
import { askFor } from "./ask";
import { findProblemsFor, lookOutsideFor, reviewPartsFor, reviewProblemsFor } from "./goal-steps";
import { useDiscovery } from "./store";
import { openBrief } from "./briefs";

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

export const useNextSteps = create<{
  folded: boolean;
  /** The step drawn first beside the picked card, for ⌘↵. */
  first: { card: string; run: () => void } | null;
  /** What's known about the picked card, for ⌘K's steps to go as the box would. */
  facts: { card: string; facts: CardFacts } | null;
}>(() => ({ folded: readFolded(), first: null, facts: null }));

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
    // Every draft asks first, in the canvas's chat: as many rounds as it needs, or none (./ask.ts).
    case "break-down":
      if (f.goal) askFor(card, "break-down", { levers: o.levers ?? [], thin: !!step.asks });
      return;
    case "review-parts":
      if (f.goal) await reviewPartsFor(card, f.goal.id);
      return;
    case "draft-problems":
      if (f.goal) askFor(card, "draft-problems", { thin: !!step.asks });
      return;
    case "review-problems":
      if (f.goal) await reviewProblemsFor(card, f.goal.id);
      return;
    case "others":
      if (f.goal) await lookOutsideFor(card, f.goal.id);
      return;
    case "find-backing":
      return findBackingFor(card);
    // In the canvas's chat: every connected tool looked in at once, what's ticked brought in under it.
    case "look-tools":
      void import("../space/chat/store").then((m) => m.lookInToolsFor(card));
      return;
    case "connect":
      navigate(placeHref("connections"));
      return;
    // Asked in the box first (./NextSteps.tsx): a tool and its words, a file.
    case "watch":
    case "add-file":
      return;
    // Asked in the canvas's chat: it looks on the web, asks, then proposes problems under it.
    case "focus":
      if (f.goal) void import("../space/chat/store").then((m) => m.focusWith(card, f.goal!.id));
      return;
    // Asked in the canvas's chat too: the goals on the canvas, then the web, then the number.
    case "find-goal":
      void import("../space/chat/store").then((m) => m.goalWith(card, f.page?.topic));
      return;
    case "write-brief":
      void import("../space/chat/store").then((m) => m.briefFor(card));
      return;
    case "word-message":
      void import("../space/chat/store").then((m) => m.briefFor(card, "message"));
      return;
    case "run-steps":
      void import("../space/chat/store").then((m) => m.briefFor(card, "steps"));
      return;
    case "plan-modules":
      void import("../space/chat/store").then((m) => m.modulesFor(card));
      return;
    case "open-brief":
      if (f.brief) openBrief(f.brief);
      return;
    case "draft-solutions":
    case "draft-tests":
      return askFor(card, step.id, { thin: !!step.asks });
    case "design-this":
      useDiscovery.setState({ designFor: card });
      return;
    case "page":
      if (f.page) navigate(topicHref(f.page.topic));
      return;
    case "next-job":
      if (f.goal) navigate(goalHref(f.goal.id, undefined, "unknowns"));
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
