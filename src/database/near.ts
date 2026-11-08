import { sharedWords } from "@/discovery/near";
import type { MetricView } from "./view";

/*
 * Which of the team's numbers bear on something (pure): a goal's metric, a question. By the words
 * they share, the one drafted for that goal first; ties keep the file's order. Only numbers that read
 * on this computer can be read at once; the rest show where they stand.
 */

export function nearestMetrics(metrics: readonly MetricView[], words: string, o: { goal?: string; min?: number } = {}): MetricView[] {
  return metrics
    .map((m, i) => ({ m, i, n: sharedWords(`${m.metric.name} ${m.metric.means}`, words) + (o.goal && m.metric.goal === o.goal ? 5 : 0) }))
    .filter((x) => x.n >= (o.min ?? 0))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.m);
}
