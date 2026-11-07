import type { MetricUnit } from "./types";

/*
 * A number from the database as it's shown and as it goes into an answer (pure): money with up to two
 * decimals, a count whole, a percent with its sign, a ratio to three places. Only how it's written
 * changes, never the number.
 */

const group = (v: number, max: number) => v.toLocaleString("en-US", { maximumFractionDigits: max });

export function formatValue(v: number | null, unit: MetricUnit): string {
  if (v === null) return "nothing";
  if (unit === "percent") return `${group(v, 2)}%`;
  if (unit === "ratio") return group(v, 3);
  if (unit === "count") return group(v, Number.isInteger(v) ? 0 : 2);
  return group(v, 2);
}

/** The schema left off a column where it's the home one: "orders.total_cents". */
export const shortColumn = (c: string, home: string) => (c.startsWith(`${home}.`) ? c.slice(home.length + 1) : c);
