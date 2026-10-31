import type { OstMetric } from "./types";

/**
 * How far an outcome's number has moved from where it started toward its target (0–1), whichever
 * way it should move; null until it has a start, a current number and a target that differ.
 */
export function metricProgress(m: OstMetric | undefined): number | null {
  if (!m || m.baseline === null || m.target === null || m.current === null || m.target === m.baseline) return null;
  return Math.max(0, Math.min(1, (m.current - m.baseline) / (m.target - m.baseline)));
}

/** Where an outcome's number goes, from where it started (else where it stands now) to its target: null without both ends. */
export function metricRange(m: OstMetric | undefined): { from: number; to: number } | null {
  const from = m?.baseline ?? m?.current ?? null;
  if (!m || from === null || m.target === null) return null;
  return { from, to: m.target };
}
