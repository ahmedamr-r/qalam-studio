import type { BriefTopic } from "@/doc/schema";
import type { FollowUp } from "@/design-system/interview/sanitize";
import type { FlowState } from "@/ui/ai/questionFlow";

/*
 * Discovery: an Opportunity Solution Tree (Teresa Torres). One outcome the team can move, the
 * customer opportunities under it (needs, pains and desires, nested as finely as they split),
 * solutions to opportunities, and tests of a solution's riskiest assumptions.
 *
 * On the canvas each card is a frame whose children are its child cards, so the document's tree
 * is the opportunity tree itself: delete, copy, paste, undo and the Layers panel work as they do
 * for any frame. The card's own data lives in `meta.ost` and the renderer paints it from there.
 */

export type OstKind = "outcome" | "opportunity" | "solution" | "test";

export type OutcomeStage = "active" | "achieved" | "paused";
/** One opportunity per tree is the target the team is working on. */
export type OpportunityStage = "exploring" | "target" | "parked" | "solved";
export type SolutionStage = "idea" | "testing" | "building" | "shipped" | "dropped";
export type TestStage = "planned" | "running" | "passed" | "failed" | "inconclusive";
export type OstStage = OutcomeStage | OpportunityStage | SolutionStage | TestStage;

export type AssumptionCategory = "desirability" | "viability" | "feasibility" | "usability" | "ethical";

/**
 * Why a card is believed. Only code adds evidence that came from a model's answer, and only once
 * it found the words in what they quote, so a card's evidence is never the model's own say-so.
 */
export interface OstEvidence {
  id: string;
  /**
   * answer: the builder's own words answering Qalam AI (the interview, or its questions about a
   * brain dump) · note: written by hand · quote: from a source (documents, pages) · dump: the
   * builder's own words in a brain dump (theirs, not their customers').
   */
  kind: "answer" | "note" | "quote" | "dump";
  /** The words themselves: what the source says, never the model's rewording of it. */
  text: string;
  /** The question the words answer (an interview's, or `dump:<sourceId>:<question>` for a brain dump's). */
  answerId?: string;
  /** The source the words are in (a document, page or connected tool's item: the Sources tab). */
  sourceId?: string;
  /**
   * The piece of the organization's knowledge these words are: "hub:quote:<quoteId>" for a
   * source's quote (or a brain dump's piece). It finds the words even after the source's text
   * changed; `text` keeps them as they were attached.
   */
  piece?: string;
  /** Its title when the words were attached, for where the source isn't at hand. */
  sourceTitle?: string;
  /** Where the words sit in the source's text (characters), to highlight them there. */
  span?: [number, number];
  page?: number;
  /** Who said it, as the source names them. */
  speaker?: string;
  /** Interviews: when the words were said ([start, end) seconds). */
  time?: [number, number];
  /** The words speak against the card (they don't back it). */
  stance?: "against";
  addedBy: "user" | "ai";
  at: number;
}

export interface OstAssumption {
  id: string;
  category: AssumptionCategory;
  text: string;
  /** How much the solution depends on it (3 = it fails without it). */
  importance?: 1 | 2 | 3;
  /** How much we already know (3 = strong evidence). */
  evidence?: 1 | 2 | 3;
  addedBy: "user" | "ai";
  /** When it was added (stamped by the decision recorder). */
  at?: number;
}

export interface OstMetric {
  name: string;
  unit?: string;
  direction: "increase" | "decrease";
  baseline: number | null;
  current: number | null;
  target: number | null;
  /** By when, in the builder's words ("by March"). */
  timeframe?: string;
}

export interface OstTest {
  assumptionIds: string[];
  /** How it's tested ("5-user prototype test", "fake-door banner"). */
  method?: string;
  /** What counts as a pass ("4 of 5 find the shelf unprompted"). */
  criterion?: string;
  /** What happened, in the team's words. */
  result?: string;
}

export interface OstCard {
  v: 1;
  kind: OstKind;
  title: string;
  description?: string;
  stage: OstStage;
  /** When it got its stage (stamped by the decision recorder): how long a test has run, an idea waited. */
  stageAt?: number;
  /** Drafted by Qalam AI (an opportunity with no evidence then shows as Assumed) or written by hand. */
  createdBy: "user" | "ai";
  evidence: OstEvidence[];
  /** Solutions: what has to be true for it to work. */
  assumptions?: OstAssumption[];
  /** Solutions: Screens projects it was sent to with Design this. */
  designs?: { projectId: string; at: number }[];
  test?: OstTest;
  /** The outcome: the number it moves. */
  metric?: OstMetric;
  /** Its child cards are hidden (the branch is folded). */
  collapsed?: boolean;
  /** The tree's root: top-down (the default) or left-to-right. */
  orientation?: "tb" | "lr";
}

export type StickyColor = "yellow" | "green" | "blue" | "pink" | "violet" | "gray";

/**
 * A free note on the board: a sticky (an auto-layout frame with a text inside), or a source note
 * (a source dragged from the Sources tab: its title and what it is, linking back to it).
 */
export type NoteMeta = { kind: "sticky"; color: StickyColor } | { kind: "source"; sourceId: string };

/** A screen designed for a Discovery solution (set on the screen's root frame). */
export interface ServesMeta {
  projectId: string;
  cardId: string;
}

// ---------------------------------------------------------------------------
// Project records

export interface DiscoveryCounts {
  /** Every outcome, sub-outcomes too (records saved before outcomes nested have none). */
  outcomes?: number;
  opportunities: number;
  solutions: number;
  tests: number;
  assumed: number;
}

/** A Discovery project's interview and progress, on its project record (resumable from the home). */
export interface DiscoveryState {
  v: 1;
  /** start: nothing yet · interview: answering · drafting: Qalam AI is writing the tree · ready: the board. */
  stage: "start" | "interview" | "drafting" | "ready";
  interview?: {
    flow: FlowState;
    followUps?: { questions: FollowUp[]; flow: FlowState };
    /** Answered with the recorded sample (no AI). */
    sample?: boolean;
  };
  /** Counted when the document saves, so the home needn't open it. */
  counts?: DiscoveryCounts;
}

/**
 * "Design this": a solution handed to a Screens project, with how it came to be. Written once
 * into the Screens project's record and cleared there when it's taken up.
 */
export interface DesignHandoff {
  v: 1;
  from: { projectId: string; projectName: string; cardId: string };
  /** The request Qalam AI plans from (short; the lineage below goes along as context). */
  prompt: string;
  /** The nearest outcome above the solution. */
  outcome: { title: string; metric?: string };
  /** The outcomes it's part of, from the tree's root down (a sub-outcome's goals). */
  outcomes?: string[];
  /** The opportunities from the outcome down to the solution's own. */
  path: string[];
  solution: { title: string; description?: string };
  /** The riskiest first. */
  assumptions: { category: AssumptionCategory; text: string }[];
  /** What the builder and their customers said, with where it came from: about the need, or naming the solution. */
  evidence: { text: string; source: string; about?: "need" | "solution" }[];
  product: { summary?: string; audience?: string; stage?: string };
  /** What seeds the Screens project's Knowledge hub. */
  brief: { topic: BriefTopic; question: string; answer: string }[];
  at: number;
}

/** A Screens project working on a Discovery solution (the banner over its chat links back). */
export interface Serving {
  projectId: string;
  projectName: string;
  cardId: string;
  cardTitle: string;
  since: number;
}

/** Screens a Screens project made for a solution, counted on its record for the Discovery board. */
export interface ServesLink {
  projectId: string;
  cardId: string;
  frames: number;
  /** The first of them, for the card's link (/p/<id>?focus=<frameId>). */
  first?: string;
}
