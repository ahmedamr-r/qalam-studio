import type { OstMetric, OutcomeStage } from "@/discovery/types";

/*
 * The organization's goals (goals.md): one tree with the North Star on top, each goal under the
 * goal it feeds. A goal is the whole company's or one product's; a vertical is just a goal in the
 * middle. A board works on a goal: its outcome card is the goal on the canvas, and `on` says which.
 * The file is the only place a goal lives. A board keeps a copy of its goal's words and number to
 * paint them, and brings that copy up to date while it's open.
 */

/** What a goal mostly moves: the growth loop's levers, for breaking a goal into the goals under it. */
export type GoalLever = "acquisition" | "activation" | "retention" | "reactivation" | "monetization" | "referral" | "efficiency";

export const GOAL_LEVERS: readonly GoalLever[] = ["acquisition", "activation", "retention", "reactivation", "monetization", "referral", "efficiency"];

export const LEVER_LABEL: Record<GoalLever, string> = {
  acquisition: "New customers",
  activation: "First value",
  retention: "Coming back",
  reactivation: "Winning back",
  monetization: "Revenue per customer",
  referral: "Referrals",
  efficiency: "Cost to serve",
};

/** Where a goal stands: the stages of the outcome card working on it. */
export type GoalStatus = OutcomeStage;

export const GOAL_STATUSES: readonly GoalStatus[] = ["active", "achieved", "paused"];

export interface Goal {
  id: string;
  /** The change it's after, in words ("More customers reorder every week"). */
  title: string;
  /** The goal it feeds. None: the North Star, or a goal not placed under it yet. */
  parent: string | null;
  /** The product it's for. None: the whole organization. */
  product: string | null;
  /** The number that shows it moving. */
  metric?: OstMetric;
  status: GoalStatus;
  lever?: GoalLever;
  /** How it feeds the goal above it, in one line. */
  feeds?: string;
  /** The board, and the outcome card on it, working on this goal. */
  on?: { board: string; card: string };
  /** The pieces it rests on: their words, an answer, a page. */
  cites: string[];
  /** A person's, or Qalam AI's once accepted. Editing Qalam AI's words by hand makes it the person's. */
  by: "person" | "qalam";
  at: number;
  /** Lines written under it in the file that aren't goals, kept as written. */
  more?: string;
}

/** The goals as goals.md holds them, in its order: the North Star's tree first, then the other goals'. */
export interface GoalTree {
  goals: Goal[];
  /** The North Star: the first goal under "North Star". None yet. */
  north: string | null;
  /** What the file says that isn't goals (an intro, sections of its own), kept as written. */
  notes?: string;
}

export const emptyGoals = (): GoalTree => ({ goals: [], north: null });

/** A goal's tree with its version, as the server hands it out (a save names the version it changed). */
export interface GoalsAt extends GoalTree {
  version: string;
  /** The file, relative to the organization's folder. */
  file: string;
}

/** A change to one goal. `on: null` takes it off its board; `metric: null` clears its number. */
export type GoalPatch = Partial<Omit<Goal, "id" | "on" | "metric" | "parent" | "product" | "lever" | "feeds">> & {
  on?: Goal["on"] | null;
  metric?: OstMetric | null;
  parent?: string | null;
  product?: string | null;
  lever?: GoalLever | null;
  feeds?: string | null;
};
