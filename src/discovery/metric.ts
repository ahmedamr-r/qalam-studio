import type { OstMetric } from "./types";

/**
 * How far an outcome's number has moved from where it started toward its target (0–1), whichever
 * way it should move; null until it has a start, a current number and a target that differ.
 */
export function metricProgress(m: OstMetric | undefined): number | null {
  if (!m || m.baseline === null || m.target === null || m.current === null || m.target === m.baseline) return null;
  return Math.max(0, Math.min(1, (m.current - m.baseline) / (m.target - m.baseline)));
}
