import type { Dialect } from "@/database/sql";
import { METRIC_UNITS } from "@/database/types";

/**
 * Qalam AI reading how a team's database is laid out and drafting the business numbers it could
 * track from it, each with its exact query (src/database/draft.ts). It sees the layout only (names,
 * types, keys, rounded counts, a few status values), never a row and never a result. Code keeps a
 * draft only when its query passes code's guard over tables that were sent and the database plans it,
 * runs it once for a sample the person checks it beside, and the person decides. What it can't tell,
 * it asks instead of guessing.
 */

const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, properties, required: Object.keys(properties) });
const str = (description: string) => ({ type: "string", description });
const list = (items: unknown, description: string, maxItems: number) => ({ type: "array", items, description, maxItems });

const DIALECT_WORDS: Record<Dialect, string> = {
  postgres: "Postgres (date_trunc('month', now()), now() - interval '30 days', count(*) FILTER (WHERE …), ::numeric)",
  mysql: "MySQL 8 (DATE_FORMAT, NOW() - INTERVAL 30 DAY, SUM(CASE WHEN … THEN 1 ELSE 0 END), CAST(… AS DECIMAL(12, 2)))",
};

export function metricsSystem(d: Dialect): string {
  return `You read how a company's own database is laid out and write the few business numbers its product team would track from it: revenue, orders, refunds, average order value, margin, active or returning customers, and the like. Each number comes with its exact query, which the team checks beside a sample before anything uses it.

The queries:
- Each is one ${DIALECT_WORDS[d]} SELECT, or WITH … SELECT, that gives exactly one row with one number. Name every table with its schema.
- Read only the tables and columns in the layout. A column marked personal may be counted (count(DISTINCT …)) but never shown, grouped by or compared to a value.
- Use only plain functions: aggregates, coalesce, nullif, round, cast, date and time arithmetic, string functions. Nothing that sleeps, reads files, calls out, takes a lock or writes.
- Mind what the layout says: a money column in cents (its name or comment says so) is divided by 100 for money; a status column counts only the states that mean what the number says; a currency column means amounts in several currencies can't be added unless filtered or the number says per currency; a deleted_at or similar column means soft-deleted rows are left out unless the number says otherwise. Say each of these in what it takes for granted.
- A table whose rows row-level security hides from this user can't be read: leave it out.

The words:
- name: what a PM would call it, with its period ("Revenue, last 30 days", "Refund rate this month").
- means: one or two plain sentences on what it counts and what it leaves out. Every period, threshold or value in the query is in the words, and the words hold no number the query doesn't.
- assumes: what it takes for granted about the data, a line each ("Amounts are in cents", "A paid order has status 'paid'"), at most 4.
- unit: ${METRIC_UNITS.join(", ")}. A percent is 0 to 100 in the query's result; a ratio 0 to 1.
- goal: the id of the goal below it measures, when it does; else "".

What you can't tell:
- When a number needs something the layout doesn't settle (which table holds what the company pays couriers, whether amounts include tax, which status means paid), don't guess and don't write that number: ask it in cannot_tell, as a short question to the team, its choices the tables or columns it's choosing between (as schema.table or schema.table.column) where there are any.
- Their answers, when they're given, are the team's word: write the numbers they settle.

Prefer the numbers the goals below measure, in their words and units, then what any business like this one tracks. Never more than 8; fewer and right beats more. Never repeat a number already kept or taken off.`;
}

export function metricsSchema() {
  return obj({
    metrics: list(
      obj({
        name: str("What a PM would call it, with its period"),
        means: str("One or two plain sentences: what it counts, what it leaves out"),
        unit: { type: "string", enum: [...METRIC_UNITS], description: "What kind of number it is" },
        sql: str("The exact query: one SELECT (or WITH … SELECT) giving one row with one number"),
        assumes: list(str("One thing it takes for granted about the data"), "What it takes for granted", 4),
        goal: str("The id of the goal it measures, or ''"),
      }),
      "The numbers, best first",
      8,
    ),
    cannot_tell: list(
      obj({
        question: str("A short question to the team about what the layout doesn't settle"),
        choices: list(str("A table or column it's choosing between, as schema.table or schema.table.column"), "What it's choosing between, or none", 6),
        for: str("The number it would let you write, or ''"),
      }),
      "What you can't tell from the layout, as questions",
      4,
    ),
  });
}

export interface MetricsSent {
  dialect: Dialect;
  /** The layout, the goals, the company and their answers, as one text. */
  text: string;
}

export function metricsCall(m: MetricsSent) {
  return { kind: "metrics" as const, system: metricsSystem(m.dialect), schema: metricsSchema(), effort: "high" as const, maxTokens: 8000, content: [{ type: "text" as const, text: m.text }] };
}

/** The repair turn: the same rules, the drafts that failed when the database read them, and the database's errors with any value in them masked. */
export function repairCall(m: MetricsSent & { failed: string }) {
  return {
    kind: "metrics" as const,
    system: metricsSystem(m.dialect),
    schema: metricsSchema(),
    effort: "medium" as const,
    maxTokens: 6000,
    content: [{ type: "text" as const, text: `${m.text}\n\nThese drafts failed when the database read them. Fix each one's query where the error shows how, keeping its name, or leave it out. Write nothing new, and leave cannot_tell empty.\n\n${m.failed}` }],
  };
}
