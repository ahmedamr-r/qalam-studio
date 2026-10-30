import { ASSUMPTION_CATEGORIES } from "@/discovery/kinds";
import type { SolutionsSent } from "@/discovery/solutions";

/**
 * Qalam AI drafting ways to solve a problem (src/discovery/solutions.ts): it reads what the
 * problem's page says and the words it rests on, the goals it bears on, what others report, what
 * the product does today, what's on the board under it and the person's own ideas, and proposes a
 * few solutions, each with its riskiest assumptions and one test of the riskiest. Code keeps a
 * draft only when it rests on the problem's own lines or words and its quoted words and numbers are
 * in what was sent; a test's pass line is kept as a suggestion the person sets for themselves.
 */

// The answer's schema (every property required, objects closed, no numeric limits)

const str = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const arr = (items: unknown, description: string) => ({ type: "array", items, description });
const enm = (values: readonly string[], description: string) => ({ type: "string", enum: [...values], description });

export const SOLUTIONS_SYSTEM = `You help a product team find ways to solve one of its customers' problems, and say what would have to be true for each to work.

You get the problem: what its page says (each line with an id), the words those lines rest on (customers' words, or the team's), the goals it bears on, what others report for those goals, what the product does today, what's on the board under it already, and the person's own ideas.

Propose 2 to 4 solutions, the most promising first, each a different way to solve the problem (not variations of one). For each:
- title: a short name for what the product would do, at most 10 words (Plan the week's meals from last week's order).
- description: one or two sentences: what it does and how it meets the problem, in the customers' terms.
- cites: the ids of the problem's lines and words it answers (l…, q…), and of the goals, reports and product steps it builds on (g…, c…, m…). Cite at least one line or one of their words.
- idea: when it builds on one of the person's own ideas, that idea's id (i…), and then keep its title in their words. "none" otherwise.
- assumptions: 2 to 4 things that must be true for it to work, the riskiest first, each in one sentence, with its category (desirability: they want it · usability: they can use it · feasibility: it can be built · viability: it works for the business · ethical: it should be done) and importance (3: it fails without it, 2: it matters, 1: it helps).
- test: one way to find out, cheaply and this week, whether the riskiest assumption holds: assumption (its number in your list, from "1"), what (a short title for the test, at most 10 words: Fake-door ‘Plan my week’ button on the home), how (one or two sentences: who to show what, or what to measure), and pass (what result would count as a pass).

Prefer what can be learnt from people before anything is built. Don't propose what's on the board already. What others report is context, never evidence about these customers.

Use “double quotes” only for words from what you were sent, word for word. Wording you propose yourself (a button's label, a message to send) goes in single quotes: ‘Copy last week’. Use a number only when it is in what you were sent, except in a test, where how many people and what counts as a pass are your suggestion. Never invent customers, quotes or facts about them.

In what you write, name what you mean by its words, never by its id: the ids are for cites, idea and assumption only. If nothing you could propose rests on what was sent, answer with no solutions and say why in the note.`;

export function solutionsSchema(m: Pick<SolutionsSent, "ideas">) {
  return obj({
    solutions: arr(
      obj({
        title: str("A short name for what the product would do, at most 10 words"),
        description: str("One or two sentences: what it does and how it meets the problem"),
        cites: arr(str("An id it rests on: l…, q…, g…, c…, m…"), "At least one line (l…) or one of their words (q…)"),
        idea: enm([...m.ideas.keys(), "none"], "The person's own idea it builds on (i…), or none"),
        assumptions: arr(
          obj({
            category: enm(ASSUMPTION_CATEGORIES, "desirability · usability · feasibility · viability · ethical"),
            text: str("What must be true, in one sentence"),
            importance: enm(["3", "2", "1"], "3: it fails without it · 2: it matters · 1: it helps"),
          }),
          "2 to 4, the riskiest first",
        ),
        test: obj({
          assumption: enm(["1", "2", "3", "4"], "The assumption it tests: its number in the list above"),
          what: str("A short title for the test, at most 10 words"),
          how: str("One or two sentences: who to show what, or what to measure"),
          pass: str("What result would count as a pass (a number here is your suggestion)"),
        }),
      }),
      "2 to 4 solutions, the most promising first. [] when nothing rests on what was sent",
    ),
    note: str("One sentence for the person: what the drafts have in common, or why there are none"),
  });
}

/** The call, as the core's structured() runs it. */
export function solutionsCall(m: SolutionsSent) {
  return {
    kind: "solutions" as const,
    system: SOLUTIONS_SYSTEM,
    schema: solutionsSchema(m),
    effort: "high" as const,
    maxTokens: 6000,
    content: [{ type: "text" as const, text: m.text }],
  };
}
