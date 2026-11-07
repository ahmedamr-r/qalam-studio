import type { Dialect } from "./sql";

/*
 * The team's business numbers from its own database (hub/metrics.md, pure): each one in plain words,
 * with the exact query that reads it. Qalam AI drafts them once from how the database is laid out;
 * a person checks each beside a sample before anything uses it, and from then on code only runs
 * these queries, read-only. The file holds definitions, never data.
 */

/** What kind of number it is: money, a count, a percent (0–100), a ratio (0–1), a length of time, or something else. */
export type MetricUnit = "money" | "count" | "percent" | "ratio" | "duration" | "other";

export const METRIC_UNITS: readonly MetricUnit[] = ["money", "count", "percent", "ratio", "duration", "other"];

/** A person's words, or Qalam AI's draft a person kept. A metric whose words or query a person changed is theirs. */
export type MetricBy = "you" | "qalam";

export interface Metric {
  id: string;
  /** "Revenue, last 30 days". */
  name: string;
  /** What it counts, in a sentence or two of plain words. */
  means: string;
  unit: MetricUnit;
  /** The exact query, one read that gives one number. */
  sql: string;
  /** The SQL it's written in (Supabase is Postgres). */
  dialect: Dialect;
  /** What it takes for granted about the data ("amounts are in cents"). */
  assumes: string[];
  /** The goal it was drafted for. */
  goal?: string;
  by: MetricBy;
  at: number;
}

export interface Metrics {
  metrics: Metric[];
  /** Names taken off, lowercased: Qalam AI never drafts them again until a person adds one back. */
  gone: string[];
  /** What a person wrote in the file under a heading this doesn't know, kept as it is. */
  notes?: string;
}

export const METRIC_LIMITS = { name: 80, means: 300, assumes: 4, assume: 200, gone: 200, metrics: 40 } as const;

export const emptyMetrics = (): Metrics => ({ metrics: [], gone: [] });

/** A metric's name as compared: case and spacing aside. */
export const nameKey = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
