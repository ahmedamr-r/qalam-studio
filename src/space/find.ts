import type { PlanQuestion } from "@/ai/plan";

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
