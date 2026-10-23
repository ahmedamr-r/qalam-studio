import { describe, expect, it } from "vitest";
import { measureBetween } from "./measure";

const values = (m: ReturnType<typeof measureBetween>) => m.lines.map((l) => `${l.axis}:${l.value}`).sort();

describe("measureBetween", () => {
  it("measures a layer inside its parent on all four sides, through its centre", () => {
    const m = measureBetween({ x: 20, y: 30, w: 100, h: 40 }, { x: 0, y: 0, w: 390, h: 844 });
    expect(values(m)).toEqual(["x:20", "x:270", "y:30", "y:774"]);
    const left = m.lines.find((l) => l.axis === "x" && l.from === 0)!;
    expect(left).toMatchObject({ at: 50, from: 0, to: 20 });
    expect(m.extensions).toEqual([]);
  });

  it("measures the other way round when the selection holds the target", () => {
    const m = measureBetween({ x: 0, y: 0, w: 100, h: 100 }, { x: 10, y: 20, w: 30, h: 30 });
    expect(values(m)).toEqual(["x:10", "x:60", "y:20", "y:50"]);
  });

  it("measures the gap between side-by-side layers through what they share", () => {
    const m = measureBetween({ x: 0, y: 0, w: 100, h: 100 }, { x: 212, y: 50, w: 100, h: 100 });
    expect(m.lines).toEqual([{ axis: "x", at: 75, from: 100, to: 212, value: 112 }]);
    expect(m.extensions).toEqual([]);
  });

  it("measures from the left too", () => {
    const m = measureBetween({ x: 300, y: 0, w: 50, h: 50 }, { x: 0, y: 0, w: 100, h: 50 });
    expect(m.lines).toEqual([{ axis: "x", at: 25, from: 100, to: 300, value: 200 }]);
  });

  it("draws diagonal gaps from the selection's centre, extending the target's edges", () => {
    const m = measureBetween({ x: 0, y: 0, w: 100, h: 100 }, { x: 150, y: 200, w: 50, h: 50 });
    expect(m.lines).toEqual([
      { axis: "x", at: 50, from: 100, to: 150, value: 50 },
      { axis: "y", at: 50, from: 100, to: 200, value: 100 },
    ]);
    expect(m.extensions).toEqual([
      [{ x: 150, y: 200 }, { x: 150, y: 50 }],
      [{ x: 150, y: 200 }, { x: 50, y: 200 }],
    ]);
  });

  it("compares matching edges of overlapping layers", () => {
    const m = measureBetween({ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 20, w: 100, h: 100 });
    expect(values(m)).toEqual(["x:50", "x:50", "y:20", "y:20"]);
  });

  it("has nothing to say about a layer measured against itself", () => {
    expect(measureBetween({ x: 5, y: 5, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }).lines).toEqual([]);
  });
});
