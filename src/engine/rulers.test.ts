import { describe, expect, it } from "vitest";
import { minorDivisions, rulerStep, rulerTicks } from "./rulers";

describe("rulerStep", () => {
  it("picks 1, 2 or 5 × 10ⁿ so labels sit at least ~56 px apart", () => {
    expect(rulerStep(1)).toBe(100);
    expect(rulerStep(0.5)).toBe(200);
    expect(rulerStep(0.18)).toBe(500);
    expect(rulerStep(2)).toBe(50);
    expect(rulerStep(4)).toBe(20);
    expect(rulerStep(10)).toBe(10);
  });

  it("never goes below one pixel", () => {
    expect(rulerStep(64)).toBe(1);
  });

  it("splits steps into minor ticks that stay 4 px apart", () => {
    expect(minorDivisions(100, 1)).toBe(10);
    expect(minorDivisions(200, 0.5)).toBe(4);
    expect(minorDivisions(500, 0.18)).toBe(5);
    expect(minorDivisions(1, 64)).toBe(10);
  });
});

describe("rulerTicks", () => {
  it("places labelled ticks at world multiples of the step, numbered from the origin", () => {
    const t = rulerTicks(-50, 400, 1);
    expect(t.major.map((m) => m.at)).toEqual([50, 150, 250, 350]);
    expect(t.major.map((m) => m.value)).toEqual([0, 100, 200, 300]);
  });

  it("counts from a frame's corner when given an origin", () => {
    const t = rulerTicks(470, 300, 1, 470);
    expect(t.major[0]).toEqual({ at: 0, value: 0 });
    expect(t.major[1]).toEqual({ at: 100, value: 100 });
  });

  it("scales positions with the zoom", () => {
    const t = rulerTicks(0, 200, 2);
    expect(t.major.slice(0, 3)).toEqual([
      { at: 0, value: 0 },
      { at: 100, value: 50 },
      { at: 200, value: 100 },
    ]);
    // Steps of 50 at 2× are split in five: a tick every 20 screen px.
    expect(t.minor.slice(0, 3)).toEqual([20, 40, 60]);
  });
});
