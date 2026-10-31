import { describe, expect, it } from "vitest";
import type { OstMetric } from "./types";
import { metricProgress, metricRange } from "./metric";

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

describe("where an outcome's number goes", () => {
  it("runs from its start, else where it stands, to its target", () => {
    expect(metricRange(m(18, 15, 10, "decrease"))).toEqual({ from: 18, to: 10 });
    expect(metricRange(m(null, 71, 85))).toEqual({ from: 71, to: 85 });
    expect(metricRange(m(null, null, 85))).toBeNull();
    expect(metricRange(m(18, null, null))).toBeNull();
  });
});
