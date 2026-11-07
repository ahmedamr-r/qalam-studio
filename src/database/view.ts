import type { Drafts } from "./draft";
import { tablesThatMatter, tableKeyOf, type Layout } from "./layout";
import type { DatabaseKind, DatabaseLocal, MetricState, Reading } from "./local";
import { queryHash } from "./metrics-md";
import type { Dialect } from "./sql";
import type { Metric } from "./types";

/*
 * What the window sees of a project's database on this computer (pure): the connection as it may be
 * shown (never its string), and each of the team's numbers with where it stands here.
 */

export const dialectOf = (k: DatabaseKind): Dialect => (k === "mysql" ? "mysql" : "postgres");

/** Where a number stands on this computer: it reads, it needs a fresh sample, it was checked on another database, it's for another kind of database, or there's no database here. */
export function metricState(m: Metric, local: DatabaseLocal | null): MetricState {
  if (!local) return "unconnected";
  if (m.dialect !== dialectOf(local.kind)) return "dialect";
  const a = local.approved?.[m.id];
  if (!a || a.q !== queryHash(m)) return "check";
  return a.where === local.where ? "ready" : "elsewhere";
}

export interface MetricView {
  metric: Metric;
  state: MetricState;
  reading?: Reading;
}

export type ConnectionView = Omit<DatabaseLocal, "approved" | "readings">;

export function metricViews(metrics: readonly Metric[], local: DatabaseLocal | null): MetricView[] {
  return metrics.map((metric) => {
    const reading = local?.readings?.[metric.id];
    const state = metricState(metric, local);
    return { metric, state, ...(reading && state === "ready" ? { reading } : {}) };
  });
}

export function connectionView(local: DatabaseLocal | null): ConnectionView | null {
  if (!local) return null;
  const { approved: _a, readings: _r, ...shown } = local;
  return shown;
}

/** What was read of the layout, as the window shows it: how much, the tables that matter, and what was kept back. */
export interface LayoutSummary {
  at: number;
  tables: number;
  /** The tables Qalam AI reads in full, best first. */
  sent: string[];
  personal: number;
  sampled: number;
  hidden: string[];
}

export function layoutSummary(l: Layout): LayoutSummary {
  const { sent } = tablesThatMatter(l);
  const cols = l.tables.flatMap((t) => t.columns);
  return { at: l.at, tables: l.tables.length, sent: sent.map(tableKeyOf), personal: cols.filter((c) => c.personal).length, sampled: cols.filter((c) => c.values?.length).length, hidden: l.tables.filter((t) => t.hidden).map(tableKeyOf) };
}

/** What the window sees of a project's database on this computer. */
export interface DatabaseView {
  connection: ConnectionView | null;
  layout: LayoutSummary | null;
  /** Drafts waiting on this computer, what Qalam AI couldn't tell, and what code left out. */
  drafts: Drafts | null;
  metrics: MetricView[];
}

/** A kept number checked beside a fresh sample: the hash of the query that ran, which approving names. */
export interface Checked {
  q: string;
  sample?: { value: number | null; at: number };
  reads: string[];
  flags: string[];
  error?: string;
}

export type ReadResult = { value: number | null; at: number } | { error: string; state?: string };
