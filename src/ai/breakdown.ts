import type { BreakdownSent } from "@/goals/breakdown";
import { GOAL_LEVERS } from "@/goals/types";

/**
 * Qalam AI breaking a goal down (src/goals/breakdown.ts): from the goal and the goals above it,
 * what the team's own material says (k ids) and what others report (o ids), the goals that would
 * move it, each on a lever, with how it feeds the goal and what it rests on. Code keeps a part
 * only when its words and numbers are in what it cites, and does the arithmetic itself.
 */

// The answer's schema (every property required, objects closed, no numeric limits)

const str = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const arr = (items: unknown, description: string) => ({ type: "array", items, description });
const enm = (values: readonly string[], description: string) => ({ type: "string", enum: [...values], description });
const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: "null" }] });
const ids = (list: string[]) => (list.length ? list : ["none"]);

export const BREAKDOWN_SYSTEM = `You help a product team break one of its goals into the goals under it: the parts its number is made of, the way growth teams do (orders a month come from active customers × orders each × order value; active customers are new + kept + won back), each a change in what customers do that a team can work on.

Propose 2 to 5 goals under it, the ones that would move it most, on different levers (acquisition: new customers · activation: first value · retention: coming back · reactivation: won back · monetization: spend · referral · efficiency: cost). When they asked to look at certain levers, start there. Never propose a goal that's under it already.

For each: a title of at most 12 words, a change in what customers do ("More first-time families book a second lesson"); its lever; why, in one plain sentence, how it feeds the goal; its number (metric) only where their own material gives one, else null; and the ids of their material it rests on (k…). Rest each on their material, the goals above it, or both; quote only words from what you cite, in “”, and use a number only when it's in what you cite or in the goals above. What others report (o…) never becomes their number or goes in why: list the ids that bear on a part in benchmarks, and the team sees them beside it.

Then relation: "product" when the goal's number is the product of the parts' numbers, "sum" when it's their sum, "none" otherwise. In "none", when there's nothing worth proposing, say in one sentence what would help, else "".

In what you write, call them goals and problems, and never write an id: the ids are for the fields.`;

export function breakdownSchema(m: Pick<BreakdownSent, "pieces" | "benchmarks">) {
  const n = (description: string) => ({ anyOf: [{ type: "number", description }, { type: "null" }] });
  return obj({
    parts: arr(
      obj({
        title: str("The goal under it: a change in what customers do, at most 12 words"),
        lever: enm(GOAL_LEVERS, "The lever it's on"),
        why: str("One plain sentence: how it feeds the goal. Their words in “” only from what it cites; numbers only from it or the goals above"),
        metric: nullable(
          obj({
            name: str("What it measures, in their words"),
            unit: str('Its unit, or ""'),
            direction: enm(["increase", "decrease"], "Whether it should go up or down"),
            baseline: n("Where it started, from their material"),
            current: n("Where it stands now, from their material"),
            target: n("Where it should get to, from their material"),
            timeframe: str('By when, as they said it, or ""'),
          }),
        ),
        cites: arr(enm(ids([...m.pieces.keys()]), "Their material it rests on (k…)"), "[] when it rests only on the goals above"),
        benchmarks: arr(enm(ids([...m.benchmarks.keys()]), "What others report that bears on it (o…)"), "[] when none"),
      }),
      "The goals under it, the one that would move it most first",
    ),
    relation: enm(["product", "sum", "none"], "How the parts' numbers make the goal's"),
    none: str('When nothing is worth proposing: what would help, in one sentence; else ""'),
  });
}

/** The call, as the core's structured() runs it. */
export function breakdownCall(m: BreakdownSent) {
  return { system: BREAKDOWN_SYSTEM, schema: breakdownSchema(m), effort: "medium" as const, maxTokens: 6000, content: [{ type: "text" as const, text: m.text }] };
}
