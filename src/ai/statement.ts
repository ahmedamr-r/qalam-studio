import type { StatementSent } from "@/space/statement";

/**
 * Qalam AI wording a goal or a problem from what someone wrote (src/space/statement.ts): one
 * statement, the way a product team would put it on the canvas. Code keeps it only when its numbers
 * and names are theirs or the company's; else their words stand.
 */

const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const str = (description: string) => ({ type: "string", description });

export const STATEMENT_SYSTEM = `You word one goal or one problem for a product team's canvas, from what someone on the team wrote. Keep their meaning; make it a proper statement, not a label or a task.

- A goal: the change the team wants to see, for whom, in one short sentence ("More households hand over their used oil every month"). Keep a number or a date only as they wrote it; never add one.
- A problem: a need, a pain or a wish of the people the product is for, in their voice, in one short sentence ("I never know when the collector will come"). Not a solution, not the team's task.

At most 120 characters. Use what's known about the company only to name things the way it does, never to add facts they didn't say. If their words are already a proper statement, return them as they are.`;

export function statementSchema() {
  return obj({ statement: str("The goal or the problem, one short sentence"), why: str("One short line to them: what you changed and why, or '' when nothing") });
}

export function statementCall(m: StatementSent) {
  return { kind: "statement" as const, system: STATEMENT_SYSTEM, schema: statementSchema(), effort: "low" as const, maxTokens: 600, content: [{ type: "text" as const, text: m.text }] };
}
