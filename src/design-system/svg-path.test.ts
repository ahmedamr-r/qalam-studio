import { describe, expect, it } from "vitest";
import { parsePath, pathBounds, PATH_LIMITS, toD, translatePath } from "./svg-path";

const close = (a: number, b: number, eps = 0.01) => Math.abs(a - b) <= eps;

describe("parsePath", () => {
  it("reads lines in every form, absolute and relative", () => {
    const { segs, error } = parsePath("M10 10 L20 10 h10 v10 H10 V30 l-5 -5 Z");
    expect(error).toBeUndefined();
    expect(toD(segs)).toBe("M10 10L20 10L30 10L30 20L10 20L10 30L5 25Z");
  });

  it("treats a move's extra pairs as lines and repeats commands", () => {
    expect(toD(parsePath("M0 0 10 0 10 10").segs)).toBe("M0 0L10 0L10 10");
    expect(toD(parsePath("m5 5 5 0 0 5").segs)).toBe("M5 5L10 5L10 10");
    expect(toD(parsePath("M0 0L1 1 2 2").segs)).toBe("M0 0L1 1L2 2");
  });

  it("accepts compact numbers and commas", () => {
    expect(toD(parsePath("M0,0L.5-.5L1e1,2").segs)).toBe("M0 0L0.5 -0.5L10 2");
  });

  it("turns quadratics and smooth curves into cubics", () => {
    const q = parsePath("M0 0Q10 10 20 0").segs;
    expect(q[1]).toMatchObject({ c: "C", x: 20, y: 0 });
    expect(close((q[1] as { x1: number }).x1, 20 / 3)).toBe(true);
    const s = parsePath("M0 0C0 10 10 10 10 0S20 -10 20 0").segs;
    // S reflects the previous cubic's second control point about the current point.
    expect(s[2]).toMatchObject({ c: "C", x1: 10, y1: -10 });
    const t = parsePath("M0 0Q5 10 10 0T20 0").segs;
    expect(t).toHaveLength(3);
    expect(t[2]).toMatchObject({ c: "C", x: 20, y: 0 });
  });

  it("draws arcs as cubics that end where the arc does", () => {
    const { segs, error } = parsePath("M0 10A10 10 0 0 1 20 10");
    expect(error).toBeUndefined();
    expect(segs.length).toBeGreaterThan(1);
    const last = segs[segs.length - 1] as { x: number; y: number };
    expect(last.x).toBe(20);
    expect(last.y).toBe(10);
    // A half circle over the top: it reaches y = 0.
    const b = pathBounds(segs);
    expect(close(b.y, 0, 0.1)).toBe(true);
    expect(close(b.w, 20, 0.1)).toBe(true);
  });

  it("reads arc flags written without separators", () => {
    const { error, segs } = parsePath("M0 0a5 5 0 1010 0");
    expect(error).toBeUndefined();
    expect(segs[segs.length - 1]).toMatchObject({ x: 10, y: 0 });
  });

  it("refuses what isn't a path", () => {
    expect(parsePath("").error).toBeTruthy();
    expect(parsePath("L10 10").error).toMatch(/starts with a move/);
    expect(parsePath("M0 0 X10").error).toMatch(/isn't a path command/);
    expect(parsePath("M0 0 L10").error).toMatch(/needs 2 numbers/);
    expect(parsePath("<svg><path d='M0 0'/></svg>").error).toBeTruthy();
    expect(parsePath("M0 0").error).toMatch(/draws nothing/);
    expect(parsePath(`M0 0L${PATH_LIMITS.coord + 1} 0`).error).toMatch(/out of range/);
    expect(parsePath("M0 0" + "L1 1".repeat(PATH_LIMITS.segments + 1)).error).toMatch(/segments/);
  });
});

describe("pathBounds", () => {
  it("measures curves by their extremes, not their control points", () => {
    const b = pathBounds(parsePath("M0 0C0 40 40 40 40 0").segs);
    expect(b.x).toBe(0);
    expect(b.w).toBe(40);
    // The control points reach 40; the curve only reaches 30.
    expect(close(b.h, 30)).toBe(true);
  });
});

describe("translatePath", () => {
  it("moves every point and keeps the shape", () => {
    const segs = parsePath("M10 10C10 20 20 20 20 10Z").segs;
    const moved = translatePath(segs, -10, -10);
    expect(toD(moved)).toBe("M0 0C0 10 10 10 10 0Z");
    const a = pathBounds(segs);
    const b = pathBounds(moved);
    expect([b.w, b.h]).toEqual([a.w, a.h]);
  });
});
