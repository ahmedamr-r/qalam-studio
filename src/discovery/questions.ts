import type { PlanQuestion } from "@/ai/plan";
import { toQuestion, type PlanBucket } from "@/ui/ai/plan";
import { answerWords, resolvedAnswers } from "@/ui/ai/questionFlow";
import type { DumpRole } from "./dump";
import type { SourceQuote, SourceRecord } from "./sources";
import type { OstKind } from "./types";

/*
 * Questions first (pure): every draft of a card asks before it drafts, in the canvas's chat
 * (src/asking/, src/ui/space/chat/store.ts askBeforeDraft), for as many rounds as it needs, or none.
 * When nothing backs the card, the person goes first, in their own words (code's open question), and
 * what they wrote is searched. The answers are kept as a source of the person's own words, one quote
 * per answer (what they typed, else the choices they picked, never Qalam AI's descriptions or its
 * picks), which the card rests on and the draft cites.
 */

/** The draft the questions are asked for. */
export type AskFor = "draft-solutions" | "break-down" | "draft-problems" | "draft-tests";

export const OPEN_ID = "know";

/** Code's first question: what the person knows about the card, in their own words (or said aloud), skippable. */
export function openQuestion(kind: OstKind): PlanQuestion {
  const why = kind === "outcome" ? "What moves it, who it's for, what you've seen: Qalam AI searches it and asks from it" : "Who has it, when, what they do instead: Qalam AI searches it and asks from it";
  return { id: OPEN_ID, title: "What do you know about it?", why, multi: false, options: [], recommended: [], allowOther: false, tool: { kind: "docs" } };
}

/** Every answer given so far, round by round: the question and the person's words (skipped ones, and Qalam AI's picks they agreed to, left out: never their words). */
export function answered(rounds: PlanBucket[]): { questionId: string; question: string; words: string }[] {
  return rounds.flatMap((b) => {
    const qs = b.questions.map(toQuestion);
    const answers = resolvedAnswers(qs, b.form.answers);
    return qs.flatMap((q) => {
      const w = b.form.answers[q.id] ? answerWords(q, answers[q.id]) : null;
      return w && w.how === "own" && w.text ? [{ questionId: q.id, question: q.title, words: w.text.slice(0, 1200) }] : [];
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
