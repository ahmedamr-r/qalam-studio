import { quoteFinder } from "@/discovery/quotes";
import { checkWords, cleanLine } from "./topics";

/**
 * Asking the organization (pure): Qalam AI's answer to a question, as code keeps it. The answer
 * rests on claims, each shown somewhere: a piece of the organization's knowledge (by its ref) or a
 * file in its folder, with the exact words there. Code finds every quote word for word in what it
 * names and keeps the source's own words; a claim with no quote found, or whose own words or
 * numbers aren't in what backs it, shows as one Qalam AI couldn't back. The short answer may only
 * say what backed claims show: a quote or number in it that their support doesn't have drops it.
 */

export interface AskSupport {
  /** A piece's ref, or a file's path in the organization's folder. */
  source: string;
  /** The words found there: the source's own, not the model's copy of them. */
  words: string;
  /** What it is, for people ("Sara · Sara interview", "Topic page: …"). */
  label: string;
  /** Where it opens in Qalam. */
  href?: string;
}

export interface AskClaim {
  text: string;
  support: AskSupport[];
  backed: boolean;
}

export interface AskUnknown {
  question: string;
  why: string;
  /** The topic page it belongs on (its id), when Qalam AI named one there is. */
  topic?: string;
}

export interface AskAnswer {
  question: string;
  /** The short answer; null when it said what the backed claims don't show. */
  answer: string | null;
  claims: AskClaim[];
  unknowns: AskUnknown[];
  /** How it was found: Claude Code searching the folder, or one call with the organization's knowledge packed. */
  how: "agent" | "packed";
  at: number;
  model?: string;
}

/** What a support names, as found: its text, and how to show it. */
export interface Found {
  text: string;
  label: string;
  href?: string;
}

/** An answer runs longer than asked now and then: its length isn't what code checks, its quotes and numbers are. */
export const ASK_LIMITS = { claims: 12, support: 4, unknowns: 6, answer: 1600, claim: 400, question: 300, why: 200 } as const;

const items = (raw: unknown, key: string): Record<string, unknown>[] => {
  const v = (raw as Record<string, unknown> | null)?.[key];
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
};

/** The sources an answer names (to look them up before checking it). */
export function sourcesIn(raw: unknown): string[] {
  const out = new Set<string>();
  for (const c of items(raw, "claims").slice(0, ASK_LIMITS.claims)) for (const s of items(c, "support").slice(0, ASK_LIMITS.support)) if (typeof s.source === "string" && s.source.trim()) out.add(s.source.trim());
  return [...out];
}

/**
 * The answer as code keeps it. `found`: each source named, looked up (absent: not there);
 * `topics`: a topic page's id by what the answer called it (its file, or its id).
 */
export function verifyAnswer(raw: unknown, found: Map<string, Found>, o: { question: string; how: AskAnswer["how"]; at: number; model?: string; topic?: (name: string) => string | null }): AskAnswer {
  const claims: AskClaim[] = [];
  const backedTexts: { text: string }[] = [];
  for (const c of items(raw, "claims").slice(0, ASK_LIMITS.claims)) {
    const support: AskSupport[] = [];
    const texts: { text: string }[] = [];
    for (const s of items(c, "support").slice(0, ASK_LIMITS.support)) {
      const source = typeof s.source === "string" ? s.source.trim() : "";
      const f = found.get(source);
      const quote = typeof s.quote === "string" ? s.quote.trim() : "";
      if (!f || quote.length < 3) continue;
      const m = quoteFinder(f.text)(quote, Math.min(8, quote.length));
      if (!m || support.some((x) => x.source === source && x.words === m.words)) continue;
      // The source's own words, without a Markdown file's bold markers.
      support.push({ source, words: m.words.replace(/\*\*/g, ""), label: f.label, ...(f.href ? { href: f.href } : {}) });
      texts.push({ text: f.text });
    }
    const said = typeof c.text === "string" ? cleanLine(c.text) : "";
    if (!said) continue;
    // Its own quotes and numbers must be in what backs it.
    const text = support.length ? checkWords(said, texts, "", ASK_LIMITS.claim) : null;
    claims.push({ text: text ?? said.slice(0, ASK_LIMITS.claim), support, backed: !!text });
    if (text) backedTexts.push(...texts);
  }
  const answer = backedTexts.length ? checkWords(typeof (raw as { answer?: unknown } | null)?.answer === "string" ? (raw as { answer: string }).answer : "", backedTexts, "", ASK_LIMITS.answer) : null;
  const unknowns: AskUnknown[] = [];
  for (const u of items(raw, "unknowns").slice(0, ASK_LIMITS.unknowns)) {
    const question = typeof u.question === "string" ? cleanLine(u.question).slice(0, ASK_LIMITS.question) : "";
    if (question.length < 5 || unknowns.some((x) => x.question === question)) continue;
    const topic = typeof u.topic === "string" && u.topic !== "none" ? o.topic?.(u.topic.trim()) : null;
    unknowns.push({ question, why: typeof u.why === "string" ? cleanLine(u.why).slice(0, ASK_LIMITS.why) : "", ...(topic ? { topic } : {}) });
  }
  return { question: o.question, answer, claims, unknowns, how: o.how, at: o.at, ...(o.model ? { model: o.model } : {}) };
}
