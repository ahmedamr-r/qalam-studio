/*
 * How the business works (business.md, pure): who it serves, what they get, how it earns, what it
 * costs to run, how customers find it, the numbers that matter and where it stands, as the team
 * tells it. Qalam AI notes a line from someone's answer as they talk (their words, or its reading of
 * them, marked as such); a person adds, fixes or takes off any line. It's what the business is,
 * never what customers said: calls hear it as context, never as evidence.
 */

/** The page's sections, in the order they're written. */
export const BUSINESS_SECTIONS = ["serves", "gets", "earns", "costs", "finds", "numbers", "stands"] as const;
export type BusinessSection = (typeof BUSINESS_SECTIONS)[number];

export const SECTION_LABEL: Record<BusinessSection, string> = {
  serves: "Who it serves",
  gets: "What they get",
  earns: "How it earns",
  costs: "What it costs to run",
  finds: "How customers find it",
  numbers: "The numbers that matter",
  stands: "Where it stands",
};

export const isSection = (x: unknown): x is BusinessSection => typeof x === "string" && (BUSINESS_SECTIONS as readonly string[]).includes(x);

/**
 * Who a line's words are: `said`, someone's own words from an answer; `qalam`, Qalam AI's reading of
 * their answers (not their words, until they keep it); `you`, written or changed by a person. A line
 * written with no record, or whose words a person changed, is theirs.
 */
export type BusinessBy = "said" | "qalam" | "you";

/** The answer a line was noted from: the conversation's flow and key, and the question it answered. */
export interface BusinessFrom {
  flow: string;
  key: string;
  q: string;
}

export interface BusinessLine {
  id: string;
  section: BusinessSection;
  text: string;
  by: BusinessBy;
  from?: BusinessFrom[];
  at: number;
}

export interface Business {
  lines: BusinessLine[];
  /** Lines taken off (lowercased words): Qalam AI never notes them again until a person adds one back. */
  gone: string[];
  /** What a person wrote in the file under a heading this doesn't know, kept as it is. */
  notes?: string;
}

export const BUSINESS_LIMITS = { perSection: 6, text: 240, gone: 200, from: 4 } as const;

export const emptyBusiness = (): Business => ({ lines: [], gone: [] });

/** The lines of one section, in the order they were written. */
export const linesIn = (b: Business, s: BusinessSection) => b.lines.filter((l) => l.section === s);

/** Whose words a line is, as people read it. */
export const isTheirs = (l: Pick<BusinessLine, "by">) => l.by !== "qalam";
