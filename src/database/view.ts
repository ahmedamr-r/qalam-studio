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
