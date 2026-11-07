import type { PlanQuestion } from "@/ai/plan";
import type { FocusLook } from "@/goals/focus";
import type { AnswerHow, FlowState } from "@/ui/ai/questionFlow";

/*
 * Asking before generating (pure types): Qalam's form of the `grilling` interview. What's still open
 * is asked in rounds: each round every question whose answer doesn't wait on another open question or
 * on a lookup still running. Facts are Qalam AI's to find (the project, the web), decisions are the
 * person's. There's no limit on rounds: it ends when nothing that would change what's proposed is
 * left, a turn brings nothing new, or the person stops it. Every flow that generates keeps one of these.
 */

/** Who answers: the asking rules are worded for them. */
export type AskWho = "person" | "team" | "builder" | "designer";

/**
 * Where a fact is looked up by Qalam AI itself: the project's own material (no tokens), or the web.
 * `online`: what people say online, kept as sources (lab "online"); only code starts one, in the
 * background before a draft, never a turn. `tools`: their connected tools, searched side by side
 * (src/connectors/everywhere.ts, lab "everywhere"); it needs their picks, so a turn's is always put to
 * them first, and it lands with what they brought in.
 */
export type LookupKind = "project" | "web" | "online" | "tools";

/** A question as the engine keeps it. `after`: the questions or lookups whose answers it waits on. `by: "code"`: code's own. */
export interface AskQuestion extends PlanQuestion {
  after?: string[];
  by?: "code";
}

/**
 * A round: its questions, their answers as the questionnaire left them (`form`), and what Qalam AI took
 * from them. Shaped like a PlanBucket, so a bucket kept before loads as a round. `said`: answers kept
 * only as words (a plan's rounds from before), by question id.
 */
export interface AskRound {
  questions: AskQuestion[];
  form: FlowState;
  analysis?: string;
  said?: Record<string, string>;
  /** Code's own round, checked once against the project's memory (src/memory/known.ts). */
  known?: true;
  /** Not asked: answered from what they said before (src/memory/gate.ts), each question keeping the answer it took as `known`. */
  from?: "memory";
}

/** Something a lookup found, under the id turns and drafts cite it by. */
export interface FoundLine {
  ref: string;
  text: string;
  /** Where it's from: a source's title, or a page's address. */
  from: string;
  /** Whose words: customers', people online's, the team's, a page's. */
  whose?: string;
  url?: string;
  /** A page's own words that bear the line out. */
  quote?: string;
  /** The piece it is (hub:quote:…), for a project lookup or a quote from people online. */
  piece?: string;
}

export interface Lookup {
  id: string;
  kind: LookupKind;
  query: string;
  /** The turn that asked for it: the next turn waits for it. "draft": only the generation waits (a look in the background). */
  waits: number | "draft";
  state: "running" | "done" | "failed" | "stopped";
  lines?: FoundLine[];
  /** A web look as it's kept and shown in the thread. */
  look?: FocusLook;
  error?: string;
  /** The turn that read what it found. */
  read?: number;
  at: number;
}

/** A point Qalam AI takes as settled, in its words, with the answers or lookups it rests on. */
export interface SettledPoint {
  text: string;
  from?: string[];
}

/** A term a conversation settled, offered for the project's words. */
export interface TermProposal {
  id: string;
  term: string;
  means: string;
  avoid: string[];
  state?: "kept" | "left";
}

/** A choice made in conversation that's hard to undo, surprising later and a real trade-off, offered as a decision. */
export interface ChoiceProposal {
  id: string;
  choice: string;
  why: string;
  instead: string;
  state?: "kept" | "left";
}

export interface AskingState {
  v: 1;
  rounds: AskRound[];
  /** Turns Qalam AI has taken: a turn's lookups are waited on by the next. */
  turns: number;
  /** Questions the last turn asked that wait on something still open: never shown as they were. */
  held: AskQuestion[];
  lookups: Lookup[];
  /** What the last turn took as settled. */
  understood: SettledPoint[];
  terms: TermProposal[];
  choices: ChoiceProposal[];
  /** How it ended: nothing left (`done`), a turn that brought nothing new, or they said to stop asking. */
  end?: { by: "done" | "nothing-new" | "stopped"; at: number };
  /** Turns in a row that only looked things up: after two, a web lookup is put to them first. */
  quiet?: number;
  /** A lookup waiting for their go-ahead: a web lookup after quiet turns, or any look in their tools. */
  offer?: { id: string; query: string; kind?: "web" | "tools" };
  /** They said to ask rather than look: the next turn asks or ends. */
  askFirst?: true;
  /** They saw what was settled and said go. */
  confirmed?: number;
  /** How many rounds are in the project's memory already (src/memory/): the next ones are written as they close. */
  memo?: number;
}

/** One turn of Qalam AI's, as code kept it. */
export interface AskTurn {
  questions: AskQuestion[];
  lookups: { id: string; kind: LookupKind; query: string }[];
  done: boolean;
  understood: SettledPoint[];
  terms: { term: string; means: string; avoid: string[] }[];
  choices: { choice: string; why: string; instead: string }[];
}

/** An answer as calls read it: their words, Qalam AI's pick they agreed to, or left. */
export interface AskAnswer {
  id: string;
  round: number;
  question: string;
  text: string;
  /** What they typed themselves: the only words a card may quote as theirs. */
  typed: string;
  how: AnswerHow;
}

export type { AnswerHow };
