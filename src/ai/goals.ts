import type { BearingSent } from "@/goals/bearings";

/**
 * Qalam AI linking problems to goals (src/goals/bearings.ts): it reads the goals (each under the
 * goal it feeds, with its number), the ones a problem may be linked to, and the problems with what
 * their pages say, and answers with the problems that would move those goals and how, each resting
 * on the problem's own lines by the ids the request gave them. Code keeps a link only when its ids
 * were sent and its words and numbers are in what it cites.
 */

// The answer's schema (every property required, objects closed, no numeric limits)

const str = (description: string) => ({ type: "string", description });
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const arr = (items: unknown, description: string) => ({ type: "array", items, description });
const enm = (values: readonly string[], description: string) => ({ type: "string", enum: [...values], description });
/** Enum values for ids a call may name (a placeholder when there are none, which code ignores). */
const ids = (list: string[]) => (list.length ? list : ["none"]);

export const BEARINGS_SYSTEM = `You link a product team's customer problems to the goals they would move. Each goal sits under the goal it feeds; the North Star is on top.

For each problem that would move one of the goals you may link to, say which goal, how directly, and how solving it would move that goal's number:
- direct: the problem is about the very behaviour the goal's number counts (a goal of weekly reorders, and customers who stop reordering because rebuilding the basket is slow).
- some: it affects that behaviour around the edges (fees that put some customers off ordering at all).
Link a problem to the most specific goal it moves: a goal under another rather than the one above it, when both fit.

Rest each link on the problem's own lines: cite their ids (l…). Write how it moves the number in one plain sentence of at most 30 words, in the team's terms. Quote only words from the lines you cite, in “”. Use a number only when it is in those lines or in the goal. Never invent customers, numbers or quotes.

Leave out a problem that wouldn't move any of these goals: a weak link costs the team more than a missing one. In "none", say in one sentence what kind of problem would move these goals that no page holds yet, or "" when there's nothing to say.

In what you write, call them problems and goals.`;

export function bearingsSchema(m: Pick<BearingSent, "problems" | "targets" | "lines">) {
  return obj({
    bearings: arr(
      obj({
        problem: enm(ids([...m.problems.keys()]), "The problem's id (t…)"),
        goal: enm(ids(m.targets), "The goal it moves: one of the goals a problem may be linked to (g…)"),
        bears: enm(["direct", "some"], "direct: about the behaviour the goal's number counts · some: around it"),
        how: str("One plain sentence, at most 30 words: how solving it moves the goal's number. Quote only the cited lines' words, in “”; numbers only from them or the goal"),
        cites: arr(enm(ids([...m.lines.keys()]), "A line of this problem's page (l…)"), "The problem's lines the link rests on: at least one"),
      }),
      "The problems that would move these goals, the strongest links first. [] when none would",
    ),
    none: str("One sentence: what kind of problem would move these goals that no page holds yet, or \"\""),
  });
}

/** The call, as the core's structured() and a route both run it. */
export function bearingsCall(m: BearingSent) {
  return {
    system: BEARINGS_SYSTEM,
    schema: bearingsSchema(m),
    effort: "medium" as const,
    maxTokens: 6000,
    content: [{ type: "text" as const, text: m.text }],
  };
}
