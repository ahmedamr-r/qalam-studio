import { backing } from "@/discovery/evidence";
import type { OstCard, OstEvidence } from "@/discovery/types";
import { tally, tallyText, type Tally, type Voice } from "./people";

/**
 * How strong what a card rests on is (pure): not how many quotes, but how many people said it, in
 * how many segments and sources, how recently, and how much speaks against it; the team's own
 * words (answers, brain dumps, notes) never count as customers'. A solution's finished tests count
 * too. Each level says why, in words, so a team can see what would make it stronger.
 */

export type StrengthLevel = "none" | "team" | "thin" | "some" | "strong";

export const STRENGTH_LABEL: Record<StrengthLevel, string> = { none: "Nothing yet", team: "The team's belief", thin: "Thin", some: "Some", strong: "Strong" };

export interface Strength {
  level: StrengthLevel;
  /** Why, in a line: "4 voices (3 named) in 2 segments (3 sources) · newest 2 weeks ago · 1 against". */
  why: string;
  /** What would make it stronger, when something would. */
  next?: string;
  /** The customers behind it. */
  tally: Tally;
  quotes: number;
  /** Voices speaking against it. */
  against: number;
  /** The team's own words behind it (answers, brain dumps, notes). */
  team: number;
  tests: { passed: number; failed: number; running: number };
}

/** Customers' words older than this read as stale. */
export const STALE_DAYS = 180;
const DAY = 86_400_000;

/** Words that are a customer's (not the team's). */
const customer = (e: OstEvidence) => e.kind === "quote";

/** The voice behind a piece of evidence: as the organization knows it, or its source and speaker. */
export function evidenceVoice(e: OstEvidence, voices?: ReadonlyMap<string, Voice>): Voice {
  const known = e.piece ? voices?.get(e.piece) : undefined;
  if (known) return known;
  const source = e.sourceId ?? `card-evidence:${e.id}`;
  const speaker = e.speaker?.replace(/\s+/g, " ").trim().toLowerCase();
  return { key: `source:${source}${speaker ? `:${speaker}` : ""}`, ...(e.speaker ? { name: e.speaker } : {}), segments: [], source, at: e.at };
}

const ageText = (ms: number) => {
  const d = Math.max(0, Math.floor(ms / DAY));
  if (d < 1) return "today";
  if (d < 14) return `${d} ${d === 1 ? "day" : "days"} ago`;
  if (d < 60) return `${Math.floor(d / 7)} weeks ago`;
  if (d < 730) return `${Math.floor(d / 30)} months ago`;
  return `${Math.floor(d / 365)} years ago`;
};

/** A card's strength. `tests` are a solution's tests (the cards under it). */
export function strengthOf(card: Pick<OstCard, "kind" | "evidence">, o: { now: number; voices?: ReadonlyMap<string, Voice>; tests?: Pick<OstCard, "stage">[] }): Strength {
  const forIt = backing(card);
  const quotes = forIt.filter(customer);
  const forVoices = quotes.map((e) => evidenceVoice(e, o.voices));
  const t = tally(forVoices);
  const againstVoices = new Set(card.evidence.filter((e) => e.stance === "against" && customer(e)).map((e) => evidenceVoice(e, o.voices).key));
  const team = forIt.filter((e) => !customer(e)).length;
  const tests = { passed: 0, failed: 0, running: 0 };
  for (const x of o.tests ?? []) if (x.stage === "passed" || x.stage === "failed" || x.stage === "running") tests[x.stage]++;
  const against = againstVoices.size;
  const age = t.newest ? o.now - t.newest : Infinity;
  const stale = age > STALE_DAYS * DAY;

  let level: StrengthLevel;
  if (!t.voices) level = tests.passed ? "some" : team ? "team" : "none";
  else if (against >= t.voices) level = "thin";
  else if (t.voices >= 3 && t.sources >= 2 && against * 2 < t.voices && !stale) level = "strong";
  else if (t.voices >= 2 || tests.passed) level = stale ? "thin" : "some";
  else level = "thin";
  if (tests.failed && level === "strong") level = "some";

  const parts = [
    t.voices ? tallyText(t) : team ? `only the team's words (${team})` : "",
    t.voices ? `newest ${ageText(age)}` : "",
    against ? `${against} against` : "",
    tests.passed ? `${tests.passed} ${tests.passed === 1 ? "test" : "tests"} passed` : "",
    tests.failed ? `${tests.failed} failed` : "",
  ].filter(Boolean);

  let next: string | undefined;
  if (level === "none" || level === "team") next = "Hear it from customers: attach what one said.";
  else if (against >= t.voices) next = "More speaks against it than for it: hear from more customers before acting on it.";
  else if (stale) next = `The newest is over ${Math.round(STALE_DAYS / 30)} months old: check it still holds.`;
  else if (t.voices < 3) next = "Hear it from more people (three or more, in two sources) before betting on it.";
  else if (t.sources < 2) next = "It all comes from one source: hear it somewhere else too.";
  else if (t.people < t.voices) next = "Say who said it on its sources, so the same person isn't counted twice.";

  return { level, why: parts.join(" · "), ...(next ? { next } : {}), tally: t, quotes: quotes.length, against, team, tests };
}
