import type { OstMetric } from "@/discovery/types";
import { valuesIn } from "@/hub/topics";

/*
 * A goal in someone's own words (pure): a title, a measure's name, a unit or a date holds when
 * every word that says what is one they wrote (one or many of it), and a goal's number holds only
 * where what they wrote has it. How setup checks the goals Qalam AI reads from what they said.
 */

/** Words that say how, not what: a title or a name may carry them without their having written them. */
const SMALL = new Set(["a", "an", "the", "of", "to", "in", "on", "at", "by", "for", "per", "and", "or", "our", "their", "its", "is", "are", "be", "with", "from", "each", "every", "more", "less", "fewer"]);
const fold = (w: string) => w.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
const wordsOf = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(fold);
/** A word as they may have written it: one or many, or another form of the same verb ("booking", "book", "booked"). An ending comes off only where three letters are left ("AED" isn't "a"). */
const forms = (w: string) => [
  w,
  `${w}s`,
  `${w}es`,
  `${w}ly`,
  w.replace(/y$/, "ies"),
  ...[w.replace(/s$/, ""), w.replace(/es$/, ""), w.replace(/ies$/, "y"), w.replace(/ly$/, ""), w.replace(/ing$/, ""), w.replace(/ing$/, "e"), w.replace(/ed$/, ""), w.replace(/d$/, "")].filter((s) => s !== w && s.length >= 3),
];

/** Every word that says what (one or many of it) is one they wrote. */
export function wordsHold(words: string, said: string): boolean {
  const theirs = new Set(wordsOf(said));
  const own = wordsOf(words).filter((w) => !SMALL.has(w) && !/^\d/.test(w));
  return own.length > 0 && own.every((w) => forms(w).some((f) => theirs.has(f)));
}

/**
 * A call's ids out of what it wrote, as the brain dump does (`readable`): people never see them. A
 * list of ids in brackets goes; an id the call named becomes what it stands for, an id it didn't
 * goes too. Lower-case ids only ("Q2" stays).
 */
export function withoutIds(text: unknown, name: (ref: string) => string | undefined, kinds = "gtlxspob"): string {
  if (typeof text !== "string") return "";
  const id = `[${kinds}]\\d{1,3}`;
  return text
    .replace(new RegExp(`\\s*[([]\\s*${id}(?:\\s*[,/;]\\s*${id})*\\s*[)\\]]`, "g"), "")
    .replace(new RegExp(`\\b${id}\\b`, "g"), (ref) => name(ref) ?? "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?'’])/g, "$1")
    .trim();
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A goal's number as Qalam AI read it, kept only where `said` has it: none when nothing of it holds. */
export function metricFrom(raw: unknown, said: string): OstMetric | null {
  const m = rec(raw);
  if (!Object.keys(m).length) return null;
  const values = new Set(valuesIn(said));
  const theirs = (x: unknown) => {
    const n = num(x);
    return n !== null && values.has(n) ? n : null;
  };
  const name = clip(m.name, 80);
  const unit = clip(m.unit, 24);
  const timeframe = clip(m.timeframe, 40);
  // A unit that's a sign ("%", "$") holds when they wrote the sign.
  const unitHolds = /[\p{L}\p{N}]/u.test(unit) ? wordsHold(unit, said) : said.includes(unit);
  const out: OstMetric = {
    name: name && wordsHold(name, said) ? name : "",
    ...(unit && unitHolds ? { unit } : {}),
    direction: m.direction === "decrease" ? "decrease" : "increase",
    baseline: theirs(m.baseline),
    current: theirs(m.current),
    target: theirs(m.target),
    ...(timeframe && wordsHold(timeframe, said) ? { timeframe } : {}),
  };
  return out.name || out.baseline !== null || out.current !== null || out.target !== null ? out : null;
}
