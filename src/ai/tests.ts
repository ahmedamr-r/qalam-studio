import { ASSUMPTION_CATEGORIES } from "@/discovery/kinds";
import type { TestsSent } from "@/discovery/tests";

/**
 * Qalam AI drafting a solution's tests (src/discovery/tests.ts): it reads the solution, the problem
 * it's under, the goal and the words they rest on, and proposes what has to be true for it to work
 * (its riskiest assumptions, none it has already) and one cheap test of the riskiest. Code keeps an
 * assumption only when its quoted words and numbers are in what was sent; a test's pass line is
 * kept as a suggestion the person sets for themselves.
 */

const str = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const arr = (items: unknown, description: string) => ({ type: "array", items, description });
const enm = (values: readonly string[], description: string) => ({ type: "string", enum: [...values], description });

export const TESTS_SYSTEM = `You help a product team test one of its solutions before they build it.

You get the solution (what it does), the problem it's for, the goal, the words they rest on (each with an id), what it assumes already and its tests already.

Propose 2 to 4 things that must be true for the solution to work, the riskiest first, none it assumes already, each in one sentence, with its category (desirability: they want it · usability: they can use it · feasibility: it can be built · viability: it works for the business · ethical: it should be done) and importance (3: it fails without it, 2: it matters, 1: it helps).

Then one way to find out, cheaply and this week, whether the riskiest holds: assumption (its number in your list, from "1"), what (a short title for the test, at most 10 words: Fake-door ‘Plan my week’ button on the home), how (one or two sentences: who to show what, or what to measure), and pass (what result would count as a pass). Prefer what can be learnt from people before anything is built.

Use “double quotes” only for words from what you were sent, word for word. Wording you propose yourself goes in single quotes: ‘Copy last week’. Use a number only when it is in what you were sent, except in the test, where how many people and what counts as a pass are your suggestion. Never invent customers, quotes or facts about them. Name what you mean by its words, never by its id.`;

export function testsSchema() {
  return obj({
    assumptions: arr(
      obj({
        category: enm(ASSUMPTION_CATEGORIES, "desirability · usability · feasibility · viability · ethical"),
        text: str("What must be true, in one sentence"),
        importance: enm(["3", "2", "1"], "3: it fails without it · 2: it matters · 1: it helps"),
      }),
      "2 to 4, the riskiest first, none it assumes already",
    ),
    test: obj({
      assumption: enm(["1", "2", "3", "4"], "The assumption it tests: its number in the list above"),
      what: str("A short title for the test, at most 10 words"),
      how: str("One or two sentences: who to show what, or what to measure"),
      pass: str("What result would count as a pass (a number here is your suggestion)"),
    }),
    note: str("One sentence for the person: what the riskiest assumption is, and why"),
  });
}

/** The call, as the core's structured() runs it. */
export function testsCall(m: TestsSent) {
  return {
    kind: "tests" as const,
    system: TESTS_SYSTEM,
    schema: testsSchema(),
    effort: "high" as const,
    maxTokens: 3000,
    content: [{ type: "text" as const, text: m.text }],
  };
}
