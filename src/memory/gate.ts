import type { KnownAnswer } from "./known";

/*
 * A question asked again, answered from what they said before instead of asked (pure). Only by the
 * person's own answer to the same question (an exact match) from the last two weeks: their words, a pick
 * of Qalam AI's they agreed to, or that they didn't know. A teammate's answer, an older one of theirs or a
 * near match shows under the question with Use it instead (src/ui/ai/KnownStrip.tsx). A question about
 * who could tell them, or where to find out, is always asked: not knowing the thing is why it's asked.
 */

export const GATE_DAYS = 14;
const DAY = 86_400_000;

const FIND_OUT = [
  /\bwho\b[^?.]{0,40}\b(?:tell|knows?|answers?|confirm|ask)\b/i,
  /\b(?:where|how)\b[^?.]{0,40}\b(?:find|look(?: it)? up|check)\b/i,
  /\bwhich (?:team|person|people|tool|report|dashboard)\b[^?.]{0,40}\b(?:knows?|tells?|ha(?:s|ve))\b/i,
  /(?:مين|من) (?:يعرف|يقدر|ممكن)|(?:وين|اين|فين) (?:ن|ت|ا)?(?:لاقي|القى)|كيف (?:ن|ت|ا)عرف/u,
];

/** A question asking who could tell them, or where or how to find out. */
export const asksWhereToFind = (title: string) => FIND_OUT.some((re) => re.test(title));

/** What a question asked again is answered with, if anything: their own exact answer, given lately. */
export function gateOf(q: { title: string; known?: readonly KnownAnswer[]; tool?: { kind: string } }, now: number): KnownAnswer | null {
  // Asking to see a screen: a screen changes, so it's always asked (what's kept shows under it instead).
  if (!q.known?.length || asksWhereToFind(q.title) || q.tool?.kind === "screens") return null;
  return q.known.find((k) => k.match === "exact" && k.mine && k.at <= now && now - k.at <= GATE_DAYS * DAY) ?? null;
}
