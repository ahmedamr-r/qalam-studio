import { questionItem } from "./plan";
import type { FindQuestionsSent } from "@/space/find";

/**
 * Qalam AI's opening questions for "Help me find one" (src/space/find.ts), once the first run knows
 * the company and its domain: 2 or 3 questions whose choices come from what companies like it
 * usually aim for and face, so the person picks from their domain or answers in their own words.
 * Code keeps a choice only where it's drawn from what was read.
 */

const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });

export const FIND_QUESTIONS_SYSTEM = `You ask a product team 2 or 3 short questions that help them name their first goal or problem, before Qalam reads their answers and proposes it in their words. You know their company and what's publicly known about its domain: what companies like it usually aim for and what their customers usually struggle with.

Ask about their own situation, from what's known about their domain:
- for a goal: which outcome they're trying to move now (choices from what companies like theirs aim for), for whom, and the number they'd watch;
- for a problem: whose problem it is, which struggle they hear about most (choices from what customers in their domain struggle with), and where it costs them.

Each question: under 70 characters, with 2–4 choices drawn from the material (their words, as a team would say them), or none for a question they answer in their own words. Every choice leaves room for their own answer. Never ask what the material already says. Never invent facts, numbers or customers: a choice is something the material says companies like theirs face, not something it says about them.`;

export function findQuestionsSchema() {
  return obj({ questions: { type: "array", items: questionItem("team", "which customers it applies to"), description: "2 or 3 questions, the one that decides the most first" } });
}

export function findQuestionsCall(m: FindQuestionsSent) {
  return { kind: "find-questions" as const, system: FIND_QUESTIONS_SYSTEM, schema: findQuestionsSchema(), effort: "low" as const, maxTokens: 3000, content: [{ type: "text" as const, text: m.text }] };
}
