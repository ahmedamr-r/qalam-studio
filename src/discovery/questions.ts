import type { PlanQuestion } from "@/ai/plan";
import { withoutIds } from "@/goals/said";
import { sanitizeQuestions, toQuestion, type PlanBucket } from "@/ui/ai/plan";
import { OTHER, initialFlow, resolvedAnswers, type Answer, type Question } from "@/ui/ai/questionFlow";
import { DUMP_ROLES, type DumpRole } from "./dump";
import type { SourceQuote, SourceRecord } from "./sources";
import type { OstKind } from "./types";

/*
 * Questions first (pure): when nothing backs a card, its draft starts by asking. The person goes
 * first, in their own words (code's open question); what they wrote is searched; then Qalam AI asks
 * a few follow-ups with choices. The answers are kept as a source of the person's own words, one
 * quote per answer (what they typed, else the choices they picked, never Qalam AI's descriptions),
 * which the card rests on and the draft cites (src/ui/discovery/ask.ts).
 */

/** The draft the questions are asked for. */
export type AskFor = "draft-solutions" | "break-down" | "draft-problems";

/** Qalam AI's follow-ups, at most. */
export const FOLLOW_UPS = 3;

export const OPEN_ID = "know";

/** Code's first question: what the person knows about the card, in their own words (or said aloud), skippable. */
export function openQuestion(kind: OstKind): PlanQuestion {
  const why = kind === "outcome" ? "What moves it, who it's for, what you've seen: Qalam AI searches it and asks from it" : "Who has it, when, what they do instead: Qalam AI searches it and asks from it";
  return { id: OPEN_ID, title: "What do you know about it?", why, multi: false, options: [], recommended: [], allowOther: false, tool: { kind: "docs" } };
}

/** The first round: code's open question, not answered yet. */
export function openRound(kind: OstKind): PlanBucket {
  const q = openQuestion(kind);
  return { questions: [q], form: initialFlow([toQuestion(q)], false) };
}

/** A round of Qalam AI's follow-ups, not answered yet. */
export const followRound = (questions: PlanQuestion[]): PlanBucket => ({ questions, form: initialFlow(questions.map(toQuestion), false) });

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
/** The call's ids out of its words: people never see them. */
const clean = (s: string) => withoutIds(s, () => undefined, "qk");

/** Qalam AI's follow-ups, checked: at most a few, none repeating the open question, its ids out of the words; and what it read the open answer as. */
export function sanitizeCardQuestions(raw: unknown): { questions: PlanQuestion[]; role: DumpRole | null } {
  const r = rec(raw);
  const questions = sanitizeQuestions(r.questions)
    .filter((q) => q.id !== OPEN_ID)
    .map((q) => ({ ...q, title: clean(q.title), why: clean(q.why), options: q.options.map((o) => ({ ...o, label: clean(o.label), description: clean(o.description) })) }))
    .filter((q) => q.title && q.options.every((o) => o.label))
    .slice(0, FOLLOW_UPS);
  return { questions, role: DUMP_ROLES.find((x) => x === r.role) ?? null };
}

/** The person's own answer to one question: what they typed, else the choices they picked (never Qalam AI's descriptions of them). */
export function theirWords(q: Question, a: Answer | undefined): string {
  if (!a || a.kind === "skipped") return "";
  if (a.kind === "text" && q.kind === "text") return a.text.trim();
  if (a.kind === "single" && q.kind === "single") return a.value === OTHER ? (a.other?.trim() ?? "") : (q.options.find((o) => o.value === a.value)?.label ?? "");
  if (a.kind === "multi" && q.kind === "multi") return [...q.groups.flatMap((g) => g.options.filter((o) => a.values.includes(o.value)).map((o) => o.label)), ...a.custom.map((c) => c.trim()).filter(Boolean)].join("; ");
  return "";
}

/** Every answer given so far, round by round: the question and the person's words (skipped ones left out). */
export function answered(rounds: PlanBucket[]): { questionId: string; question: string; words: string }[] {
  return rounds.flatMap((b) => {
    const qs = b.questions.map(toQuestion);
    const answers = resolvedAnswers(qs, b.form.answers);
    return qs.flatMap((q) => {
      const words = b.form.answers[q.id] ? theirWords(q, answers[q.id]) : "";
      return words ? [{ questionId: q.id, question: q.title, words: words.slice(0, 1200) }] : [];
    });
  });
}

/** What the answers source keeps of the questions asked about a card (`SourceRecord.answers`). */
export interface CardAnswers {
  v: 1;
  /** The card it's about (a goal with no board yet: the goal's own card). */
  card: string;
  /** The goal it's about, or the goal the card is under. */
  goal: string | null;
  /** The problem's page, when it has one. */
  topic: string | null;
  /** The draft it was asked for. */
  step: AskFor;
  /** The rounds: code's open question, then Qalam AI's follow-ups. */
  buckets: PlanBucket[];
  /** What was found on their words: the organization's quotes and people online's (pieces' refs). */
  found: string[];
  /** The draft ran with them. */
  done?: boolean;
  at: number;
}

/**
 * The answers as a source of the person's own words: the questions and answers as its text, one
 * quote per answer (its words, where they sit in the text), the open answer with the role Qalam
 * AI read it as (an idea reaches Draft solutions as theirs).
 */
export function answersRecord(o: { id: string; board: string; title: string; product: string | null; card: CardAnswers; role: DumpRole | null; now: number; quoteId: (questionId: string) => string }): SourceRecord {
  const parts: string[] = [];
  const quotes: SourceQuote[] = [];
  let at = 0;
  for (const a of answered(o.card.buckets)) {
    const head = `${a.question}\n`;
    const start = at + head.length;
    parts.push(`${head}${a.words}`);
    quotes.push({ id: o.quoteId(a.questionId), text: a.words, span: [start, start + a.words.length], kind: "idea", ...(a.questionId === OPEN_ID && o.role ? { role: o.role } : {}), addedBy: "user", at: o.now });
    at = start + a.words.length + 2;
  }
  return { v: 1, id: o.id, projectId: o.board, kind: "dump", title: o.title, ...(o.product ? { product: o.product } : {}), text: parts.join("\n\n"), addedAt: o.now, read: [], quotes, needs: [], answers: o.card };
}
