import type { StepSent } from "@/code/steps";

/*
 * Qalam AI placing what customers said at the steps of a goal's funnel (src/code/steps.ts): it
 * reads the goal, the funnel's steps in order (each with its screen's file and the events it
 * sends) and the quotes, and answers with the quotes that are about one step, pointing to the
 * words that put each there. Code keeps a place only when its ids were sent and those words are in
 * the quote, word for word, and name the step's own thing.
 */

const str = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const arr = (items: unknown, description: string) => ({ type: "array", items, description });
const enm = (values: readonly string[], description: string) => ({ type: "string", enum: [...values], description });
/** Enum values for ids a call may name (a placeholder when there are none, which code ignores). */
const ids = (list: string[]) => (list.length ? list : ["none"]);

export const STEPS_SYSTEM = `You place what a product's customers said at the steps of the funnel toward one of its goals: the screens people go through, in order.

A quote belongs at a step when it is about what happens there: trouble on that screen, something missing from it, why they stopped there, or what they wish it did. Place a quote at one step only: the one it is most clearly about. Leave out a quote that is about the product in general, about several steps at once, or about nothing in this funnel. A wrong place costs the team more than a missing one.

For each quote you place, copy the words in it that show which step it is about, exactly as the quote has them: a few words, at most 25, that name the step's thing (the address, the payment, the basket), not the whole quote.

Use the ids the request gave: s… for steps, q… for quotes. Never invent quotes or words.`;

export function stepsSchema(m: Pick<StepSent, "steps" | "quotes">) {
  return obj({
    places: arr(
      obj({
        quote: enm(ids([...m.quotes.keys()]), "The quote (q…)"),
        step: enm(ids([...m.steps.keys()]), "The step it is about (s…)"),
        words: str("The quote's own words that show which step it is about, copied exactly: at most 25 words"),
      }),
      "The quotes that are about one step, the clearest first. [] when none is",
    ),
  });
}

/** The call, as the core's structured() runs it. */
export function stepsCall(m: StepSent) {
  return {
    system: STEPS_SYSTEM,
    schema: stepsSchema(m),
    effort: "medium" as const,
    maxTokens: 4000,
    content: [{ type: "text" as const, text: m.text }],
  };
}
