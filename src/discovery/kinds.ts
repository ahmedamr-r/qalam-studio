import type { AssumptionCategory, OstCard, OstKind, OstStage } from "./types";

/** The rules of the tree: what each kind of card is, holds and goes through. Pure data. */

export const KINDS: readonly OstKind[] = ["outcome", "opportunity", "solution", "test"];

/**
 * How people see each kind. The tree is an Opportunity Solution Tree, and the code says so; the
 * team reads goals and problems: an outcome is a goal on the canvas (goals.md), an opportunity a
 * customer's problem (a need page).
 */
export const KIND_LABEL: Record<OstKind, string> = { outcome: "Goal", opportunity: "Problem", solution: "Solution", test: "Test" };

/** An outcome under another outcome, as the board names it. */
export const SUB_OUTCOME_LABEL = "Sub-goal";

/** How a kind is named in prose ("Add a problem"). */
export const KIND_NOUN: Record<OstKind, string> = { outcome: "a goal", opportunity: "a problem", solution: "a solution", test: "a test" };

/**
 * What a card of each kind can hold. An outcome splits into sub-outcomes (a business goal into the
 * product outcomes that move it) or gets opportunities; an opportunity splits into smaller ones or
 * gets solutions.
 */
export const CHILD_KINDS: Record<OstKind, readonly OstKind[]> = {
  outcome: ["outcome", "opportunity"],
  opportunity: ["opportunity", "solution"],
  solution: ["test"],
  test: [],
};

export const canHold = (parent: OstKind, child: OstKind) => CHILD_KINDS[parent].includes(child);

export const STAGES: Record<OstKind, readonly { value: OstStage; label: string }[]> = {
  outcome: [
    { value: "active", label: "Active" },
    { value: "achieved", label: "Achieved" },
    { value: "paused", label: "Paused" },
  ],
  opportunity: [
    { value: "exploring", label: "Exploring" },
    { value: "target", label: "Target" },
    { value: "parked", label: "Parked" },
    { value: "solved", label: "Solved" },
  ],
  solution: [
    { value: "idea", label: "Idea" },
    { value: "testing", label: "Testing" },
    { value: "building", label: "Building" },
    { value: "shipped", label: "Shipped" },
    { value: "dropped", label: "Dropped" },
  ],
  test: [
    { value: "planned", label: "Planned" },
    { value: "running", label: "Running" },
    { value: "passed", label: "Passed" },
    { value: "failed", label: "Failed" },
    { value: "inconclusive", label: "Inconclusive" },
  ],
};

export const DEFAULT_STAGE: Record<OstKind, OstStage> = { outcome: "active", opportunity: "exploring", solution: "idea", test: "planned" };

export const isStageOf = (kind: OstKind, stage: unknown): stage is OstStage => STAGES[kind].some((s) => s.value === stage);
export const stageLabel = (kind: OstKind, stage: OstStage) => STAGES[kind].find((s) => s.value === stage)?.label ?? stage;

/** Card widths on the board (heights follow the title). */
export const CARD_WIDTH: Record<OstKind, number> = { outcome: 320, opportunity: 248, solution: 232, test: 216 };

/**
 * The kind of a new child card: a solution gets tests, and an outcome opportunities unless it
 * only holds sub-outcomes so far. An opportunity gets what it already holds; with nothing yet,
 * the target gets solutions (that's what a target is for) and any other one splits into smaller
 * opportunities.
 */
export function defaultChildKind(parent: OstCard, childKinds: readonly OstKind[]): OstKind | null {
  if (parent.kind === "outcome") return childKinds.length && childKinds.every((k) => k === "outcome") ? "outcome" : "opportunity";
  if (parent.kind === "solution") return "test";
  if (parent.kind === "test") return null;
  if (childKinds.length) return childKinds.every((k) => k === "solution") ? "solution" : "opportunity";
  return parent.stage === "target" ? "solution" : "opportunity";
}

export const ASSUMPTION_LABEL: Record<AssumptionCategory, string> = {
  desirability: "Desirability",
  viability: "Viability",
  feasibility: "Feasibility",
  usability: "Usability",
  ethical: "Ethics",
};

export const ASSUMPTION_HINT: Record<AssumptionCategory, string> = {
  desirability: "Do they want it?",
  viability: "Should we build it (is it worth it for the business)?",
  feasibility: "Can we build it?",
  usability: "Can they use it?",
  ethical: "Could it do harm?",
};

export const ASSUMPTION_CATEGORIES = Object.keys(ASSUMPTION_LABEL) as AssumptionCategory[];
