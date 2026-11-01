import type { PlanQuestion } from "@/ai/plan";
import { sharedWords } from "@/discovery/near";
import type { Market } from "@/market/types";
import { sanitizeQuestions } from "@/ui/ai/plan";

/*
 * "Help me find one" in the canvas's chat (src/ui/space/chat/): code asks a few open questions
 * first, with no tokens, about what's being looked for (a goal or a problem); their answers are
 * read as a brain dump (src/ui/discovery/dump.ts), with Qalam AI's own rounds of questions after,
 * and placed as 1 to 3 cards of that kind. Their answers alone are the dump's text, so every piece
 * Qalam AI quotes is their words; the questions go beside it (the dump's `aim`). Pure.
 */

export type FindWhat = "goal" | "problem";

const open = (id: string, title: string, why: string): PlanQuestion => ({ id, title, why, multi: false, options: [], recommended: [], allowOther: false });

/** The opening round: open questions, each skippable. */
export function findRound(what: FindWhat): PlanQuestion[] {
  return what === "goal"
    ? [
        open("for-whom", "What does the product do, and who is it for?", "A goal is a change for those people."),
        open("change", "What is the team trying to change in the next few months?", "A goal is a change the team could see happen."),
        open("number", "Is there a number you'd watch to know it's working? Where is it now?", "So the goal can carry its number, in your words."),
      ]
    : [
        open("who", "Who are the customers, and what are they trying to get done?", "A problem is theirs: whose, and in the middle of what."),
        open("struggle", "What do they struggle with, complain about or ask for?", "In their words if you have them: what you've heard or seen."),
        open("give-up", "Where do they give up, or go somewhere else?", "Where it costs them, and you."),
      ];
}

/** Their answers as the dump's text (a paragraph apiece, skipped ones left out), and the questions beside it. */
export function findText(questions: readonly PlanQuestion[], answers: Readonly<Record<string, string>>): { text: string; asked: string[]; said: { question: string; answer: string }[] } {
  const said = questions.map((q) => ({ question: q.title, answer: (answers[q.id] ?? "").trim() }));
  return { text: said.map((s) => s.answer).filter(Boolean).join("\n\n"), asked: said.map((s) => s.question), said: said.filter((s) => s.answer) };
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
 * What code keeps of the opening round: 2 or 3 questions, each choice drawn from what's known (it
 * shares two telling words with a fact or a domain line, or all of a short one's), with their own
 * words always open; a question left with fewer than two choices is asked open.
 */
export function sanitizeFindQuestions(raw: unknown, m: FindQuestionsSent): PlanQuestion[] {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const drawn = (label: string, description: string) => {
    const words = `${label} ${description}`;
    return m.known.some((k) => sharedWords(words, k) >= 2) || (label.split(/\s+/).length <= 2 && m.known.some((k) => sharedWords(label, k) >= 1));
  };
  return sanitizeQuestions(r.questions)
    .map((q) => {
      const options = q.options.filter((o) => drawn(o.label, o.description));
      return options.length >= 2 ? { ...q, options, recommended: q.recommended.filter((v) => options.some((o) => o.value === v)), allowOther: true } : { ...q, multi: false, options: [], recommended: [], allowOther: false };
    })
    .slice(0, 3);
}
