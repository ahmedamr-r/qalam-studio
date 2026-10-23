import type { BriefAnswer, BriefTopic } from "@/doc/schema";
import type { FollowUp } from "@/design-system/interview/sanitize";
import { OTHER, resolvedAnswers, summarize, type Answers, type FlowState, type Question } from "@/ui/ai/questionFlow";

/**
 * The product interview a Discovery board starts from: six questions a product coach asks before
 * drawing anything (what it is, for whom, where it stands, what the business needs, how you'd
 * know, what you've heard), then up to three of Qalam AI's own. Every answer is the builder's
 * words; the draft quotes them back as evidence, and code checks the quotes are really theirs.
 */

export const CORE_QUESTIONS: Question[] = [
  {
    kind: "text",
    id: "product",
    title: "What's the product, in a sentence?",
    why: "Every opportunity is read against it.",
    placeholder: "A grocery app that delivers in 20 minutes",
    maxLength: 300,
  },
  {
    kind: "text",
    id: "audience",
    title: "Who is it for?",
    why: "Opportunities are written from these people's side.",
    placeholder: "Busy parents who order groceries every week on their phone",
    maxLength: 300,
  },
  {
    kind: "single",
    id: "stage",
    title: "Where is the product today?",
    why: "Early products look for big unmet needs; mature ones for friction in what already works.",
    options: [
      { value: "idea", label: "An idea, nothing built yet" },
      { value: "building", label: "Building the first version" },
      { value: "fit", label: "Launched, finding its fit" },
      { value: "growing", label: "Growing" },
      { value: "mature", label: "Mature, optimizing what works" },
    ],
    other: { label: "Something else", placeholder: "In your words" },
  },
  {
    kind: "single",
    id: "business",
    title: "What does the business need most in the next few months?",
    why: "Qalam AI turns it into an outcome: a change in what customers do that your team can move.",
    options: [
      { value: "acquire", label: "More new customers" },
      { value: "retain", label: "More repeat use" },
      { value: "monetize", label: "More revenue per customer" },
      { value: "cost", label: "A lower cost to serve" },
    ],
    other: { label: "Something else", placeholder: "In your words" },
  },
  {
    kind: "text",
    id: "metric",
    title: "Which customer behaviour would show you're getting there? Add today's number and your goal if you have them.",
    why: "The outcome card tracks it. Numbers only ever come from your answer.",
    placeholder: "Weekly reorders per customer: 1.2 now, 1.5 by March",
    maxLength: 300,
  },
  {
    kind: "text",
    id: "pains",
    title: "What do customers struggle with or ask for, and what ideas does the team already have?",
    why: "What you've heard becomes opportunities, in your words; ideas you name become solutions.",
    placeholder: "They can't find what they ordered last time, and they're never sure when it'll arrive. We've talked about an “order again” shelf.",
    maxLength: 1200,
    optional: true,
  },
];

/** A question and the builder's answer, as the model and the brief read it. */
export interface InterviewAnswer {
  id: string;
  question: string;
  answer: string;
}

/** The answers in the builder's words (a skipped one is empty). */
export function interviewAnswers(questions: Question[], answers: Answers): InterviewAnswer[] {
  const all = resolvedAnswers(questions, answers);
  return questions.map((q) => {
    const a = all[q.id];
    let text = "";
    if (a.kind === "text") text = a.text.trim();
    else if (a.kind === "single" && q.kind === "single") text = a.value === OTHER ? (a.other ?? "").trim() : (q.options.find((o) => o.value === a.value)?.label ?? "");
    else if (a.kind !== "skipped") text = summarize(q, a);
    return { id: q.id, question: q.title, answer: text === "—" ? "" : text };
  });
}

/** Qalam AI's follow-ups as questions: its likely answers to pick from, or the builder's own words. */
export function followUpQuestions(f: FollowUp[]): Question[] {
  return f.map((q) =>
    q.options.length >= 2
      ? {
          kind: "single" as const,
          id: q.id,
          title: q.question,
          why: q.why,
          source: "ai" as const,
          options: q.options.map((label, i) => ({ value: `o${i}`, label })),
          other: { label: "Something else", placeholder: "In your words" },
        }
      : { kind: "text" as const, id: q.id, title: q.question, why: q.why, source: "ai" as const, placeholder: "In your words", maxLength: 400 },
  );
}

/** Where each answer goes in the project's brief (the Library). */
const TOPIC: Record<string, BriefTopic> = { product: "other", audience: "audience", stage: "other", business: "goal", metric: "success-metric", pains: "problem" };

/** The answers as Knowledge hub entries (the follow-ups under "other"). */
export function briefFromAnswers(list: InterviewAnswer[], now: number): BriefAnswer[] {
  return list
    .filter((a) => a.answer.trim())
    .map((a) => ({ id: `interview:${a.id}`, topic: TOPIC[a.id] ?? "other", question: a.question.slice(0, 400), answer: a.answer.slice(0, 600), screenIds: [], at: now }));
}

/** Everything the builder said, joined: where the draft's numbers and quotes must come from. */
export const answerText = (list: InterviewAnswer[]) => list.map((a) => a.answer).join("\n");

export type { FlowState };
