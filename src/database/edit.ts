import { sqlKey } from "./metrics-md";
import { METRIC_LIMITS, METRIC_UNITS, nameKey, type Metric, type MetricUnit, type Metrics } from "./types";

/*
 * A change to the team's numbers (pure): a checked draft kept, a person's fix to its words or its
 * query (which makes it theirs), or one taken off (and never drafted again until a person adds it
 * back). The query a person writes is checked like any other before it runs; this only keeps it.
 */

export type MetricsEdit =
  | { kind: "add"; metric: Omit<Metric, "id" | "at"> }
  | { kind: "fix"; id: string; name?: string; means?: string; assumes?: string[]; sql?: string; unit?: MetricUnit }
  | { kind: "remove"; id: string };

const one = (s: string) => s.replace(/\s+/g, " ").trim();

export class MetricsEditError extends Error {}

export function editMetrics(t: Metrics, e: MetricsEdit, o: { now: number; id: () => string }): Metrics {
  if (e.kind === "add") {
    const name = one(e.metric.name).slice(0, METRIC_LIMITS.name);
    if (!name || !e.metric.sql.trim()) throw new MetricsEditError("A number needs a name and a query.");
    if (t.metrics.some((m) => nameKey(m.name) === nameKey(name))) throw new MetricsEditError(`There's a number called ${name} already.`);
    if (t.metrics.length >= METRIC_LIMITS.metrics) throw new MetricsEditError(`That's ${METRIC_LIMITS.metrics} numbers already: take one off first.`);
    const m: Metric = { ...e.metric, id: o.id(), name, means: one(e.metric.means).slice(0, METRIC_LIMITS.means), sql: sqlKey(e.metric.sql), assumes: e.metric.assumes.map(one).filter(Boolean).slice(0, METRIC_LIMITS.assumes), at: o.now };
    return { ...t, metrics: [...t.metrics, m], gone: t.gone.filter((g) => g !== nameKey(name)) };
  }
  const at = t.metrics.findIndex((m) => m.id === e.id);
  if (at < 0) throw new MetricsEditError("That number isn't there any more.");
  const was = t.metrics[at];
  if (e.kind === "remove") return { ...t, metrics: t.metrics.filter((m) => m.id !== e.id), gone: [...new Set([...t.gone, nameKey(was.name)])].slice(-METRIC_LIMITS.gone) };
  const name = e.name !== undefined ? one(e.name).slice(0, METRIC_LIMITS.name) : was.name;
  if (!name) throw new MetricsEditError("A number needs a name.");
  if (nameKey(name) !== nameKey(was.name) && t.metrics.some((m) => m.id !== was.id && nameKey(m.name) === nameKey(name))) throw new MetricsEditError(`There's a number called ${name} already.`);
  const sql = e.sql !== undefined ? sqlKey(e.sql) : was.sql;
  if (!sql) throw new MetricsEditError("A number needs a query.");
  const next: Metric = {
    ...was,
    name,
    means: e.means !== undefined ? one(e.means).slice(0, METRIC_LIMITS.means) : was.means,
    assumes: e.assumes !== undefined ? e.assumes.map(one).filter(Boolean).slice(0, METRIC_LIMITS.assumes) : was.assumes,
    sql,
    unit: e.unit && METRIC_UNITS.includes(e.unit) ? e.unit : was.unit,
  };
  const changed = next.name !== was.name || next.means !== was.means || next.sql !== was.sql || next.unit !== was.unit || next.assumes.join("\n") !== was.assumes.join("\n");
  return changed ? { ...t, metrics: t.metrics.map((m, i) => (i === at ? { ...next, by: "you", at: o.now } : m)) } : t;
}
