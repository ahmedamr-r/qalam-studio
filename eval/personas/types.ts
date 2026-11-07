/**
 * A person the stress tests play (eval/personas). Every company here is made up and placed in a real
 * market, so the web still answers and no invented number attaches to a real company. Code holds the
 * facts and releases one only when a question asks for it, so a helpful model can't hide a failure.
 */

export interface Fact {
  id: string;
  /** What it's about, as the matcher sees it: never its value. */
  topic: string;
  value: string;
  /** A decision can't be made well without it: counted for coverage. */
  mustLearn?: boolean;
}

/** Something they honestly don't know: asked about it, they say so. */
export interface Unknown {
  id: string;
  topic: string;
}

export interface Trap {
  id: string;
  /** The wrong turn this scenario invites. */
  plant: string;
  /** What's true, for the judges. */
  truth: string;
  /** A cheap first pass on the output; a judge confirms any hit. */
  caught: RegExp;
}

export interface Behavior {
  /** How often they press Enter on a choice without reading it. */
  enterRate: number;
  /** How often they leave an open question empty. */
  skipRate: number;
  maxWords: number;
  lang: "en" | "ar";
  /** How they talk, for the voice. */
  style: string;
  /** What they say when they don't know, in their own words. */
  dontKnow: string;
  /** From this round on they change their mind about a fact they've already given. */
  contradicts?: { fact: string; round: number; says: string };
}

/**
 * Which way a person reaches this in the app.
 * plan: the canvas chat works it out. scan: the first run reads the idea, then what to build first.
 * focus, docs, find: the window drives these, so they run in the real app.
 */
export type Path = "plan" | "scan" | "focus" | "docs" | "find";

export interface Persona {
  id: string;
  group: "A" | "B" | "C";
  title: string;
  path: Path;
  org: { name: string; about?: string; audience?: string; shape: "solo" | "team" };
  /** Their first message. */
  opener: string;
  /** For a path the window drives: how they'd put it to the plan route, for the two-way check. */
  planSaid?: string;
  /** Written into the organization first, with no model call. */
  seed?: "five-problems";
  /** Files they bring, in eval/personas/fixtures. */
  docs?: string[];
  facts: Fact[];
  unknowns: Unknown[];
  /** What the documents they bring answer and they don't know offhand (a2's funnel): asked anyway, it's asking what their own material says. */
  documented?: Unknown[];
  traps: Trap[];
  behavior: Behavior;
  /** One answer turned around, to see whether the proposal follows it. */
  flips: { fact: string; to: string }[];
  /** What they'd want next that may have no path: feature candidates. */
  wants: string[];
}
