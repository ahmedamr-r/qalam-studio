import { describe, expect, it } from "vitest";
import type { OstMetric } from "./types";
import { metricProgress } from "./metric";

const m = (baseline: number | null, current: number | null, target: number | null, direction: OstMetric["direction"] = "increase"): OstMetric => ({ name: "n", direction, baseline, current, target });

describe("how far an outcome has moved", () => {
  it("measures from the start toward the target, either way", () => {
    expect(metricProgress(m(38, 41, 50))).toBeCloseTo(0.25);
    expect(metricProgress(m(12, 10, 8, "decrease"))).toBeCloseTo(0.5);
  });

  it("stays within 0 and 1, and is nothing without the numbers", () => {
    expect(metricProgress(m(38, 30, 50))).toBe(0);
    expect(metricProgress(m(38, 60, 50))).toBe(1);
    expect(metricProgress(m(null, 41, 50))).toBeNull();
    expect(metricProgress(m(50, 50, 50))).toBeNull();
    expect(metricProgress(undefined)).toBeNull();
  });
});
