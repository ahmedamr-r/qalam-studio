import { describe, expect, it } from "vitest";
import { guideFor, snapBox } from "./snapping";

const b = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe("snapBox", () => {
  it("lines up edges and centres within the threshold, nearest first", () => {
    const r = snapBox(b(103, 300, 50, 50), [b(100, 0, 100, 100)], 6);
    expect(r.dx).toBe(-3);
    expect(r.dy).toBe(0);
    expect(r.guides).toEqual([{ axis: "x", at: 100, from: 0, to: 350 }]);
  });

  it("labels the distance to the layer it lined up with", () => {
    const r = snapBox(b(103, 300, 50, 50), [b(100, 0, 100, 100)], 6);
    expect(r.spacings).toEqual([{ axis: "y", at: 100, from: 100, to: 300 }]);
  });

  it("ignores what is out of reach", () => {
    const r = snapBox(b(160, 300, 50, 50), [b(100, 0, 100, 100)], 6);
    expect(r).toEqual({ dx: 0, dy: 0, guides: [], spacings: [] });
  });

  it("snaps only the edges that move (resize, draw)", () => {
    // A right edge at 197 snaps to the candidate's right edge at 200, not its left at 100.
    const r = snapBox(b(197, 500, 0, 0), [b(100, 0, 100, 100)], 6, { x: [0], y: [] });
    expect(r.dx).toBe(3);
    expect(r.dy).toBe(0);
  });

  it("centres a layer between two neighbours", () => {
    const r = snapBox(b(112, 0, 50, 50), [b(0, 0, 100, 50), b(180, 0, 100, 50)], 6, { spacing: true, y: [] });
    expect(r.dx).toBe(3);
    expect(r.spacings).toEqual([
      { axis: "x", at: 25, from: 100, to: 115 },
      { axis: "x", at: 25, from: 165, to: 180 },
    ]);
  });

  it("repeats a gap that already exists in the row", () => {
    const row = [b(0, 0, 50, 50), b(70, 0, 50, 50)];
    // The existing gap is 20; the layer at 142 is 22 from its neighbour: it moves 2 left.
    const r = snapBox(b(142, 0, 50, 50), row, 6, { spacing: true, y: [] });
    expect(r.dx).toBe(-2);
    expect(r.spacings).toContainEqual({ axis: "x", at: 25, from: 50, to: 70 });
    expect(r.spacings).toContainEqual({ axis: "x", at: 25, from: 120, to: 140 });
  });
});

describe("guideFor", () => {
  it("reaches every layer on the line and labels the nearest gap", () => {
    const g = guideFor("y", 0, b(300, 0, 40, 40), [b(0, 0, 100, 40), b(150, -20, 50, 40)]);
    expect(g.guide).toEqual({ axis: "y", at: 0, from: 0, to: 340 });
    expect(g.spacing).toEqual({ axis: "x", at: 0, from: 200, to: 300 });
  });
});
