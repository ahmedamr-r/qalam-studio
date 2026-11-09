import type { AssumptionCategory, OstCard, OstKind, OstStage, SolutionType } from "./types";

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

/** A solution under a New product, as the board names it. */
export const MODULE_LABEL = "Module";

/** A test under a problem: it checks whether the problem is really there, as "Sub-goal" names a goal under a goal. */
export const CHECK_LABEL = "Check";

/** A check's stages say what it found about its problem. */
const CHECK_STAGE: Partial<Record<OstStage, string>> = { passed: "Confirmed", failed: "Ruled out" };

/** How people see each type of solution. */
export const SOLUTION_TYPE_LABEL: Record<SolutionType, string> = { change: "Change to the product", feature: "New feature", product: "New product", message: "Message or campaign", service: "Service or by hand" };

/** What each type means, as Qalam AI is told. */
export const SOLUTION_TYPE_HINT = "change: a change to what the product does today · feature: a new feature in a product · product: a new product of its own, made of modules · message: a message or campaign reaching people outside the product (SMS, push, email, social media) · service: a service, or something the team does by hand";

/** How a kind is named in prose ("Add a problem"). */
export const KIND_NOUN: Record<OstKind, string> = { outcome: "a goal", opportunity: "a problem", solution: "a solution", test: "a test" };

/**
 * What a card of each kind can hold. An outcome splits into sub-outcomes (a business goal into the
 * product outcomes that move it) or gets opportunities; an opportunity splits into smaller ones or
 * gets solutions.
 */
export const CHILD_KINDS: Record<OstKind, readonly OstKind[]> = {
  outcome: ["outcome", "opportunity"],
  // A test under a problem is a Check: the cheapest way to find out whether it's really behind the goal.
  opportunity: ["opportunity", "solution", "test"],
  solution: ["test"],
  test: [],
};

export const canHold = (parent: OstKind, child: OstKind) => CHILD_KINDS[parent].includes(child);

const HELD: Record<OstKind, string> = { outcome: "goals", opportunity: "problems", solution: "solutions", test: "tests" };

/** What a kind of card holds, in words ("Problem cards hold problems, solutions and checks"): a test under a problem is a check. */
export function holdsLine(kind: OstKind): string {
  const words = CHILD_KINDS[kind].map((k) => (kind === "opportunity" && k === "test" ? "checks" : HELD[k]));
  if (!words.length) return `${KIND_LABEL[kind]} cards hold no other cards`;
  return `${KIND_LABEL[kind]} cards hold ${words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words.at(-1)}` : words[0]}`;
}

/**
 * What this card can hold: what its kind holds, and a New product holds solutions too, its modules.
 * Kept apart from `canHold`, which reads only the kind, so a brain dump or a placement never makes a module.
 */
export const holdsCard = (parent: Pick<OstCard, "kind" | "solutionType">, child: OstKind) => canHold(parent.kind, child) || (parent.kind === "solution" && parent.solutionType === "product" && child === "solution");

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
export const stageLabel = (kind: OstKind, stage: OstStage, check?: boolean) => (check && kind === "test" ? CHECK_STAGE[stage] : undefined) ?? STAGES[kind].find((s) => s.value === stage)?.label ?? stage;

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
  // A New product gets modules until it has a test of its own.
  if (parent.kind === "solution") return parent.solutionType === "product" && !childKinds.includes("test") ? "solution" : "test";
  if (parent.kind === "test") return null;
  // A problem's checks don't say what it holds: what's added under it is a problem or a solution.
  const kids = childKinds.filter((k) => k !== "test");
  if (kids.length) return kids.every((k) => k === "solution") ? "solution" : "opportunity";
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
