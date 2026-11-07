/**
 * Qalam AI's memory of what it asked (pure types). Every interview reads it before it asks (recall) and
 * writes to it after each round (remember), so no flow asks again what another was told. Four memories
 * make the harness: working (one interview, AskingState), shared (this one: hub/asked.jsonl, synced, and
 * this computer's .qalam/local/asked.jsonl), semantic (the index) and long-term (the pages people curate).
 */

/** Who answered: this computer's person, by a stable id, with their name where they gave one. */
export interface Who {
  id: string;
  name?: string;
}

/** How it was answered: their own words, Qalam AI's pick they agreed to, they don't know, or they left it. */
export type AskedHow = "own" | "pick" | "unknown" | "left";

/** Which part of Qalam asked. */
export type AskedFlow = "plan" | "card" | "brief" | "scan" | "steer" | "interview" | "dump" | "find" | "focus";

export const ASKED_FLOWS: readonly AskedFlow[] = ["plan", "card", "brief", "scan", "steer", "interview", "dump", "find", "focus"];

/** Where it was asked, as people read it. */
export const FLOW_WORDS: Record<AskedFlow, string> = {
  plan: "Working it out",
  card: "Before a draft",
  brief: "Before a brief",
  scan: "What to build first",
  steer: "While a scan read",
  interview: "Starting a board",
  dump: "A brain dump",
  find: "Help me find one",
  focus: "Finding the problem to focus on",
};

/** What it was about: the canvas's product (null: the whole project), and the card, goal, problem page or source where there's one. */
export interface AskedAbout {
  product: string | null;
  board?: string;
  card?: string;
  goal?: string;
  topic?: string;
  source?: string;
}

/** A question asked and how it was answered. */
export interface AskedEntry {
  v: 1;
  /** The conversation and the question (`askedId`): two computers write the same id for the same answer. */
  id: string;
  at: number;
  by: Who;
  flow: AskedFlow;
  /** The conversation it was asked in: the chat's turn, the board, the source. */
  key: string;
  about: AskedAbout;
  /** The question's id in its conversation, and its words. */
  qid: string;
  q: string;
  /** Code's own question, not Qalam AI's. */
  code?: true;
  how: AskedHow;
  /** Their words, the pick's label, or what they said not knowing (empty when they pressed I don't know, or left it). */
  a: string;
}

/** Taken off: Qalam AI won't bring it up when it asks. */
export interface AskedForget {
  v: 1;
  forget: string;
  at: number;
  by: Who;
}

/** Said to be still right. */
export interface AskedConfirm {
  v: 1;
  confirm: string;
  at: number;
  by: Who;
}

export type AskedLine = AskedEntry | AskedForget | AskedConfirm;

/** What the whole team's Qalam reads: their own answers and the picks they agreed to. What they didn't know or left stays on this computer. */
export const sharedHow = (how: AskedHow): boolean => how === "own" || how === "pick";

/** An answer as a round gives it, to remember. */
export interface RoundAnswer {
  qid: string;
  q: string;
  a: string;
  how: AskedHow;
  code?: true;
}
