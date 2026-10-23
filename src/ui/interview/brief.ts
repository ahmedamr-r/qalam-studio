import type { BriefAnswer, FollowUp } from "@/design-system/interview/sanitize";
import type { Platform } from "@/design-system/platform";
import { OTHER, resolvedAnswers, summarize, type Answers, type FlowState, type Question } from "../ai/questionFlow";

/**
 * The brand brief: questions a brand designer asks before drawing anything. Narrative first (what
 * it is, how it should feel, what it should never be), then the practical facts. Every answer is
 * the designer's own words; Qalam AI reads them, and quotes them back as evidence.
 */

export const BRIEF_QUESTIONS: Question[] = [
  { kind: "text", id: "name", title: "What's it called?", why: "The name goes on the preview screens.", placeholder: "Lumen", maxLength: 40 },
  {
    kind: "text",
    id: "product",
    title: "What are you making, and who is it for?",
    why: "The kind of product sets the starting point: finance for businesses reads differently from finance for people.",
    placeholder: "A savings app for young professionals in the Gulf, many on their first salary",
    maxLength: 400,
  },
  {
    kind: "text",
    id: "feel",
    title: "How should people feel when they use it?",
    why: "Playful or serious, a friend or an authority: this drives corners, colour and type.",
    placeholder: "Calm and in control, like a friend who's good with money",
    maxLength: 400,
  },
  {
    kind: "text",
    id: "place",
    title: "If the brand were a place, what would it be?",
    why: "A metaphor says what adjectives can't.",
    placeholder: "A bright, quiet café on a weekday morning",
    maxLength: 300,
    optional: true,
  },
  {
    kind: "text",
    id: "references",
    title: "Which brands do you admire, and which should it never look like?",
    why: "What to aim for, and what to steer clear of.",
    placeholder: "We like Monzo and Linear. Never like a crypto exchange: no neon",
    maxLength: 400,
    optional: true,
  },
  {
    kind: "text",
    id: "color",
    title: "Do you already have a brand colour?",
    why: "Give a hex code and it's kept exactly. Leave it empty and Qalam AI suggests some.",
    placeholder: "#0090FF, or leave empty",
    maxLength: 40,
    optional: true,
  },
  {
    kind: "multi",
    id: "where",
    title: "Where will people use it, and in which languages?",
    why: "Phones need bigger touch targets; Arabic adds a right-to-left preview.",
    groups: [
      {
        id: "platform",
        label: "Mainly on",
        max: 1,
        options: [
          { value: "mobile", label: "A phone app" },
          { value: "web", label: "A website or web app" },
          { value: "dashboard", label: "A data or admin tool" },
        ],
      },
      {
        id: "languages",
        label: "Languages",
        options: [
          { value: "en", label: "English" },
          { value: "ar", label: "Arabic (right to left)" },
        ],
      },
    ],
    min: 1,
    default: { values: ["mobile", "en"], custom: [] },
  },
];

/** The answers as the model reads them: question, then the designer's words. */
export function briefAnswers(questions: Question[], answers: Answers): BriefAnswer[] {
  const all = resolvedAnswers(questions, answers);
  return questions.map((q) => {
    const a = all[q.id];
    const text = a.kind === "text" ? a.text.trim() : a.kind === "skipped" ? "" : summarize(q, a);
    return { id: q.id, question: q.title, answer: text === "—" ? "" : text };
  });
}

/** What the designer picked for platform and languages (it overrides the model's reading). */
export function practicalFacts(answers: Answers): { platform?: Platform; arabic?: boolean } {
  const a = answers.where;
  if (!a || a.kind !== "multi") return {};
  const platform = (["mobile", "web", "dashboard"] as const).find((p) => a.values.includes(p));
  return { ...(platform ? { platform } : {}), arabic: a.values.includes("ar") };
}

/** Qalam AI's follow-ups as questions: its likely answers to pick from, or the designer's own words. */
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
      : { kind: "text" as const, id: q.id, title: q.question, why: q.why, source: "ai" as const, placeholder: "In your words", maxLength: 300 },
  );
}

/** Follow-up answers in the designer's words. */
export function followUpAnswers(questions: Question[], flow: FlowState): BriefAnswer[] {
  const all = resolvedAnswers(questions, flow.answers);
  return questions.map((q) => {
    const a = all[q.id];
    let text = "";
    if (a.kind === "text") text = a.text.trim();
    else if (a.kind === "single" && q.kind === "single") text = a.value === OTHER ? (a.other ?? "").trim() : (q.options.find((o) => o.value === a.value)?.label ?? "");
    return { id: q.id, question: q.title, answer: text };
  });
}
