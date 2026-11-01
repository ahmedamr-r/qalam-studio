import { valuesIn } from "@/hub/topics";

/*
 * Their words as a proper goal or problem (pure): Qalam AI suggests a statement from what they
 * wrote, knowing the company and its domain; code keeps it only when every number in it is one they
 * wrote and every name in it is theirs or the company's known ones, and at most so long. Anything
 * else falls back to their own words. They accept, edit or keep their words; theirs stay on the
 * card as where it came from.
 */

export type StatementWhat = "goal" | "problem";

export const STATEMENT_MAX = 140;

export interface StatementSent {
  text: string;
  said: string;
  /** Where a name in the statement may come from: their words, then what's known about the company. */
  names: string;
}

const one = (s: string) => s.replace(/\s+/g, " ").trim();

/** What the statement call reads: their words, what they want it to be, the card above it, and the company. */
export function statementMaterial(o: { what: StatementWhat; said: string; org: string; about: string; market: string; above?: string | null }): StatementSent {
  const said = one(o.said).slice(0, 1200);
  const text = [
    `They want this on the canvas as ${o.what === "goal" ? "a goal: an outcome the team is trying to move" : "a problem: a need, a pain or a wish of the people the product is for"}.`,
    ...(o.above ? [`It goes under: “${one(o.above)}”`] : []),
    "",
    `Their words: “${said}”`,
    "",
    `The company, “${o.org}”: ${one(o.about) || "(not described yet)"}`,
    ...(o.market.trim() ? ["", o.market.trim()] : []),
  ].join("\n");
  return { text, said, names: [o.org, o.about, o.market, o.above ?? ""].join(" ") };
}

/** Capitalized words after a sentence's first: names, which must be theirs or the company's known ones. */
const namesIn = (s: string) =>
  one(s)
    .split(/(?<=[.!?:])\s+/)
    .flatMap((sentence) => sentence.split(/\s+/).slice(1))
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((w) => /^\p{Lu}/u.test(w) && w.length > 1);

/** The statement code keeps (null: their own words stand). */
export function sanitizeStatement(raw: unknown, m: StatementSent): { statement: string; why: string } | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const statement = typeof r.statement === "string" ? one(r.statement).replace(/^["“”']+|["“”']+$/g, "") : "";
  if (!statement || statement.length > STATEMENT_MAX) return null;
  if (statement.toLowerCase() === m.said.toLowerCase()) return null;
  // Every number theirs.
  const theirs = valuesIn(m.said);
  if (valuesIn(statement).some((v) => !theirs.includes(v))) return null;
  // Every name theirs, or the company's known ones.
  const known = `${m.said} ${m.names}`.toLowerCase();
  if (namesIn(statement).some((w) => !known.includes(w.toLowerCase()))) return null;
  const why = typeof r.why === "string" ? one(r.why).slice(0, 200) : "";
  return { statement, why };
}
