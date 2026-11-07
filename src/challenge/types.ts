/*
 * Challenging proposals with the project's own evidence (pure types). After a flow proposes cards and
 * before the review opens, a separate step tries to break each proposal: code finds what it can in
 * their numbers and records (a funnel's biggest drop against the step a proposal works on, a better
 * backed problem left with nothing, a card decided against before), one call words each challenge in
 * a line citing only what it was sent, and code holds those lines to the usual checks. It sees what
 * they asked and the proposals, never the conversation, so what the person believes doesn't steer it.
 * The person keeps, changes or drops each challenge.
 */

export type CheckKind = "outcome" | "opportunity" | "solution";

/** A card on the canvas as the check is told about it: where it hangs, its problem page, its goal, and whether nothing that reaches "We know" backs it. */
export interface CheckCard {
  id: string;
  kind: CheckKind;
  title: string;
  parent: string | null;
  topic?: string;
  /** An outcome card's goal (goals.md). */
  goal?: string;
  assumed?: true;
}

/** A proposal as the check reads it, under a card on the canvas or another proposal (`parent`). */
export interface CheckItem {
  /** The window's id for it: the proposal's. */
  id: string;
  kind: CheckKind;
  title: string;
  description?: string;
  how?: string;
  assumptions?: string[];
  parent: string | null;
  /** A problem's page it is (a page becoming a card). */
  topic?: string;
  /** A goal proposed under a goal (Break it down): the goal it goes under. */
  goal?: string;
  assumed?: true;
}

/** What the window sends: which review it's for, what they asked, the canvas, the proposals. */
export interface CheckRequest {
  /** The review's key: plan:<turn>, dump:<source>, solutions:<topic or card>, problems:<goal>, breakdown:<goal>. */
  origin: string;
  /** What they asked, or the step drafted, in a line. */
  asked: string;
  product: string | null;
  outline: CheckCard[];
  items: CheckItem[];
}

/** Which of their records a line of evidence is. */
export type EvidenceKind = "measured" | "known" | "against" | "found" | "decided" | "built";

/** A line of their own evidence, as the check sends it, with where it lives so a kept challenge rests on it. */
export interface Evidence {
  kind: EvidenceKind;
  /** Whose words, as people read them: measured, people said, a study, the team's, decided, built. */
  whose: string;
  /** Where it is: a source's or a page's title, a code file, a decision's date. */
  from: string;
  text: string;
  /** The proposals it was gathered for (their ids). */
  for: string[];
  /** The piece it is (hub:quote:…), when it's a source's words. */
  piece?: string;
  sourceId?: string;
  quoteId?: string;
  span?: [number, number];
  /** A problem page's line: the page and the line. */
  topic?: string;
  line?: string;
  /** What a page's line cites. */
  cites?: string[];
  decision?: string;
  /** A code map's step (<map>/<step>). */
  step?: string;
}

/** What code found in their numbers and records: firm, so it's shown whatever the call says. */
export type FindingKind = "funnel-step" | "funnel-gap" | "funnel-cap" | "backing" | "decided";

export interface Finding {
  kind: FindingKind;
  /** The proposals it's on (their ids); none: the round as a whole. */
  on: string[];
  /** The evidence it rests on (indexes into the gathered list). */
  rests: number[];
  /** Code's own words for it: its numbers the evidence's or code's arithmetic. */
  line: string;
  /** Numbers code worked out, which a line citing it may say. */
  facts: string[];
  /** How much it matters, for the order: more first. */
  weight: number;
}

export type ChallengeKind = FindingKind | "evidence";

/** What a challenge rests on, as the person sees it and a kept one is carried onto a card. */
export interface ChallengeCite {
  kind: EvidenceKind;
  whose: string;
  from: string;
  text: string;
  piece?: string;
  sourceId?: string;
  quoteId?: string;
  span?: [number, number];
  topic?: string;
  line?: string;
  cites?: string[];
  decision?: string;
  step?: string;
}

/** A challenge as code kept it. */
export interface Challenge {
  id: string;
  /** What it's about and what it rests on: one dropped isn't raised again from the same evidence. */
  key: string;
  kind: ChallengeKind;
  /** The proposals it's on (the window's ids); none: the whole set. */
  on: string[];
  line: string;
  /** What would settle it, in a line ("" when the call said nothing). */
  settle: string;
  cites: ChallengeCite[];
  /** Worded by Qalam AI, or code's own words for a finding it didn't word. */
  by: "qalam" | "code";
  /** The person's say: kept as it is, changed into their words, or dropped. */
  state?: "kept" | "changed" | "dropped";
  /** Their words, once they changed it. */
  words?: string;
}

/** One check of one round of proposals, as it's kept with the review. */
export interface ChallengeRun {
  id: string;
  origin: string;
  at: number;
  /** The proposals it read (their ids), so a review opened again knows the run is its own. */
  items: string[];
  challenges: Challenge[];
  /** Why no call was made, or it failed: code's findings stand alone. */
  note?: string;
  model?: string;
}

/** A line of hub/challenges.jsonl: a challenge the person dropped, or brought back, for the team. */
export type ChallengeLog = { v: 1; drop: string; on: string; line: string; at: number; by?: string } | { v: 1; restore: string; at: number; by?: string };
