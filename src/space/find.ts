import type { PlanQuestion } from "@/ai/plan";
import { saysDontKnow } from "@/asking/dontknow";
import type { AnswerHow } from "@/asking/types";
import type { ToolAsk } from "@/connectors/suggest";
import { sharedWords } from "@/discovery/near";
import type { Market } from "@/market/types";
import { gateOf } from "@/memory/gate";
import { whereSaid } from "@/memory/known";
import { sanitizeAsked } from "@/ui/ai/plan";

/*
 * "Help me find one" in the canvas's chat (src/ui/space/chat/): code asks a few open questions
 * first, with no tokens, about what's being looked for (a goal or a problem); their answers are
 * read as a brain dump (src/ui/discovery/dump.ts), with Qalam AI's own rounds of questions after,
 * and placed as 1 to 3 cards of that kind. Their answers alone are the dump's text, so every piece
 * Qalam AI quotes is their words; the questions go beside it (the dump's `aim`). Pure.
 */

export type FindWhat = "goal" | "problem";

const open = (id: string, title: string, why: string, tool?: ToolAsk): PlanQuestion => ({ id, title, why, multi: false, options: [], recommended: [], allowOther: false, ...(tool ? { tool } : {}) });

/** The opening round: open questions, each skippable. */
export function findRound(what: FindWhat): PlanQuestion[] {
  return what === "goal"
    ? [
        open("for-whom", "What does the product do, and who is it for?", "A goal is a change for those people."),
        open("change", "What is the team trying to change in the next few months?", "A goal is a change the team could see happen.", { kind: "docs", lookFor: "strategy goals roadmap" }),
        open("number", "Is there a number you'd watch to know it's working? Where is it now?", "So the goal can carry its number, in your words.", { kind: "numbers" }),
      ]
    : [
        open("who", "Who are the customers, and what are they trying to get done?", "A problem is theirs: whose, and in the middle of what."),
        open("struggle", "What do they struggle with, complain about or ask for?", "In their words if you have them: what you've heard or seen.", { kind: "docs", lookFor: "customer research feedback" }),
        open("give-up", "Where do they give up, or go somewhere else?", "Where it costs them, and you.", { kind: "numbers", lookFor: "funnel" }),
      ];
}

/**
 * An answer to an opening question: their words, Qalam AI's pick they agreed to, or that they don't
 * know. `before`: where and when they said it in another conversation, so it wasn't asked now.
 */
export interface OpeningAnswer {
  text: string;
  how: AnswerHow;
  before?: string;
}
export type OpeningAnswers = Readonly<Record<string, string | OpeningAnswer | undefined>>;

/** An answer as given. Words alone are theirs, unless they say they don't know. */
export function openingAnswer(a: string | OpeningAnswer | undefined): OpeningAnswer {
  if (typeof a !== "string") return a ?? { text: "", how: "left" };
  const t = a.trim();
  return { text: t, how: !t ? "left" : saysDontKnow(t) ? "unknown" : "own" };
}

/**
 * An answer as a transcript writes it. Only their own words are theirs, what pieces may come from;
 * Qalam AI's pick and a don't-know are written as what they are, never as words of theirs.
 */
export function answerPart(a: OpeningAnswer): TextPart | null {
  const t = a.text.trim();
  if (a.how === "left" || (!t && a.how !== "unknown")) return null;
  if (a.how === "pick") return { words: `Qalam AI's pick, which you agreed to: ${t}`, theirs: false, plain: true };
  if (a.how === "unknown") return { words: t || "You don't know yet.", theirs: false, plain: true };
  return { words: t, theirs: true };
}

/**
 * The opening questions they answered lately in another conversation (src/memory/gate.ts), answered
 * with what they said, as it was given: not asked again.
 */
export function knewAnswers(questions: readonly PlanQuestion[], now: number): Record<string, OpeningAnswer> {
  const out: Record<string, OpeningAnswer> = {};
  for (const q of questions) {
    const k = gateOf(q, now);
    if (k) out[q.id] = { text: k.text, how: k.how, before: whereSaid(k.flow, k.at, now) };
  }
  return out;
}

/** Their answers as the dump's text (a paragraph apiece, skipped ones left out), and the questions beside it. */
export function findText(questions: readonly PlanQuestion[], answers: OpeningAnswers): { text: string; asked: string[]; said: { question: string; answer: string; before?: string }[] } {
  const said = questions.map((q) => {
    const a = openingAnswer(answers[q.id]);
    return { question: q.title, answer: answerPart(a)?.words ?? "", ...(a.before ? { before: a.before } : {}) };
  });
  return { text: said.map((s) => s.answer).filter(Boolean).join("\n\n"), asked: said.map((s) => s.question), said: said.filter((s) => s.answer) };
}

/** Each question asked with its answer, as a transcript writes them (left ones left out). */
export function answeredPairs(questions: readonly PlanQuestion[], answers: OpeningAnswers): { q: string; a: TextPart }[] {
  const one = (s: string) => s.replace(/\s+/g, " ").trim();
  return questions.flatMap((q) => {
    const a = answerPart(openingAnswer(answers[q.id]));
    return a ? [{ q: one(q.title), a }] : [];
  });
}

/**
 * Their answers as a source that reads on its own: what they asked for, then each question asked
 * and their answer (skipped ones left out). Only their own words are theirs (`theirs`), so the dump's
 * pieces come from those alone; the headings are the text's shape (`heads`).
 */
export function findTranscript(questions: readonly PlanQuestion[], answers: OpeningAnswers, o: { what: FindWhat; org?: string }): { text: string; parts: TextPart[] } {
  const one = (s: string) => s.replace(/\s+/g, " ").trim();
  const head = `Finding ${o.what === "goal" ? "a goal" : "a problem"}${o.org ? ` for ${one(o.org)}` : ""}: Qalam AI asked, and you answered.`;
  const pairs = answeredPairs(questions, answers);
  const parts: TextPart[] = [{ words: head, theirs: false }, ...pairs.flatMap((p) => [{ words: p.q, theirs: false }, p.a])];
  return { text: [head, ...pairs.map((p) => `${p.q}\n${p.a.words}`)].join("\n\n"), parts };
}

/** A part of a text, in order: their words, or Qalam AI's (a heading, a question). `plain`: neither (Qalam AI's pick, a don't-know). */
export interface TextPart {
  words: string;
  theirs: boolean;
  plain?: true;
}

/** Where each part is in `text`, found in order (one it doesn't have is left out): their parts, and the rest as headings. */
export function partSpans(text: string, parts: readonly TextPart[]): { theirs: [number, number][]; heads: [number, number][] } {
  const out = { theirs: [] as [number, number][], heads: [] as [number, number][] };
  let from = 0;
  for (const p of parts) {
    const words = p.words.replace(/\s+/g, " ").trim();
    const at = words ? text.indexOf(words, from) : -1;
    if (at < 0) continue;
    if (!p.plain) (p.theirs ? out.theirs : out.heads).push([at, at + words.length]);
    from = at + words.length;
  }
  return out;
}

/** Enough to go on: Qalam AI reads at least 40 characters of their words. */
export const FIND_MIN = 40;

// ---------------------------------------------------------------------------
// The opening round, from what's known about the company and its domain

export interface FindQuestionsSent {
  text: string;
  /** What an option may be drawn from: each fact and domain line, as written. */
  known: string[];
}

/** What the questions call reads: what they're looking for, the company, its competitors, and its domain. */
export function findQuestionsMaterial(o: { what: FindWhat; org: string; about: string; market: Market }): FindQuestionsSent {
  const one = (s: string) => s.replace(/\s+/g, " ").trim();
  const known = [o.about, ...o.market.company.map((l) => l.text), ...o.market.aims.map((l) => l.text), ...o.market.struggles.map((l) => l.text), ...o.market.competitors.flatMap((c) => [c.name, ...c.lines.map((l) => l.text)])].map(one).filter(Boolean);
  const text = [
    `They want help finding ${o.what === "goal" ? "a first goal: an outcome the team is trying to move" : "a first problem: a need, a pain or a wish of the people the product is for"}.`,
    "",
    `The company, “${o.org}”:`,
    ...(o.about.trim() ? [one(o.about)] : []),
    ...o.market.company.map((l) => `- ${one(l.text)}`),
    ...(o.market.competitors.length ? ["", `Its competitors: ${o.market.competitors.map((c) => c.name).join(", ")}`] : []),
    "",
    "What companies like it usually aim for and measure (read on the web):",
    ...(o.market.aims.length ? o.market.aims.map((l) => `- ${one(l.text)}`) : ["- (nothing found)"]),
    "",
    "What their customers usually struggle with (read on the web):",
    ...(o.market.struggles.length ? o.market.struggles.map((l) => `- ${one(l.text)}`) : ["- (nothing found)"]),
  ].join("\n");
  return { text, known };
}

/**
 * What code keeps of the opening round: every question it can ask now (src/asking/: no limit), each
 * choice drawn from what's known (it shares two telling words with a fact or a domain line, or all of
 * a short one's), with their own words always open; a question left with fewer than two choices is
 * asked open. The dump's rounds take it from there, as many as it needs.
 */
export function sanitizeFindQuestions(raw: unknown, m: FindQuestionsSent): PlanQuestion[] {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const drawn = (label: string, description: string) => {
    const words = `${label} ${description}`;
    return m.known.some((k) => sharedWords(words, k) >= 2) || (label.split(/\s+/).length <= 2 && m.known.some((k) => sharedWords(label, k) >= 1));
  };
  return sanitizeAsked(r.questions, { max: Infinity }).map((q) => {
    const options = q.options.filter((o) => drawn(o.label, o.description));
    return options.length >= 2 ? { ...q, options, recommended: q.recommended.filter((v) => options.some((o) => o.value === v)), allowOther: true } : { ...q, multi: false, options: [], recommended: [], allowOther: false };
  });
}
