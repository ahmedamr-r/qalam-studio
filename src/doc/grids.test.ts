import { beforeEach, describe, expect, it } from "vitest";
import { makeFrame, makeShape } from "./factory";
import { studio, useStudio } from "./store";
import { emptyDoc, type FrameNode } from "./schema";
import { addLayoutGrid, bandSpans, defaultGrid, gridBands, gridLines, removeLayoutGrid, removeLayoutGrids, setLayoutGrid } from "./grids";

describe("layout grid geometry", () => {
  it("stretches columns across the frame inside the margins", () => {
    const g = { ...defaultGrid("columns"), count: 4, gutter: 16, margin: 16 };
    // 390 wide: (390 - 32 - 48) / 4 = 77.5 per column.
    expect(bandSpans(g, 390)).toEqual([
      [16, 77.5],
      [109.5, 77.5],
      [203, 77.5],
      [296.5, 77.5],
    ]);
    expect(gridBands(g, 390, 844)[0]).toEqual({ x: 16, y: 0, w: 77.5, h: 844 });
  });

  it("places fixed-width bands from a side or the centre", () => {
    const g = { ...defaultGrid("columns"), count: 3, size: 60, gutter: 10, align: "start" as const, margin: 20 };
    expect(bandSpans(g, 400)).toEqual([
      [20, 60],
      [90, 60],
      [160, 60],
    ]);
    expect(bandSpans({ ...g, align: "end" }, 400).at(-1)).toEqual([320, 60]);
    expect(bandSpans({ ...g, align: "center" }, 400)[0]).toEqual([100, 60]);
  });

  it("fits as many fixed bands as there is room for when the count is 0", () => {
    const g = { ...defaultGrid("rows"), count: 0, size: 40, gutter: 10, align: "start" as const, margin: 0 };
    expect(bandSpans(g, 200)).toHaveLength(4);
    expect(gridBands(g, 300, 200)[1]).toEqual({ x: 0, y: 50, w: 300, h: 40 });
  });

  it("draws nothing for impossible grids", () => {
    expect(bandSpans({ ...defaultGrid("columns"), count: 10, gutter: 50 }, 100)).toEqual([]);
    expect(bandSpans({ ...defaultGrid("columns"), align: "start", size: 0 }, 100)).toEqual([]);
  });

  it("lists the square grid's inner lines", () => {
    expect(gridLines(defaultGrid("grid"), 35, 20)).toEqual({ xs: [10, 20, 30], ys: [10] });
    expect(gridLines(defaultGrid("columns"), 35, 20)).toEqual({ xs: [], ys: [] });
  });
});

describe("layout grid edits", () => {
  beforeEach(() => {
    const frame = makeFrame({ name: "Screen", x: 0, y: 0, w: 390, h: 844 });
    const rect = makeShape("rect", { x: 10, y: 10, w: 10, h: 10 });
    const doc = emptyDoc();
    doc.nodes[frame.id] = frame;
    doc.nodes[rect.id] = rect;
    doc.roots = [frame.id, rect.id];
    useStudio.setState({ doc, selection: [] });
  });

  const ids = () => studio().doc.roots;
  const grids = () => (studio().doc.nodes[ids()[0]] as FrameNode).grids;

  it("adds, edits and removes grids on frames only", () => {
    expect(addLayoutGrid(ids(), "columns")).toBe(1);
    expect(grids()).toHaveLength(1);
    setLayoutGrid(ids()[0], 0, { count: 12 });
    expect(grids()![0].count).toBe(12);
    addLayoutGrid([ids()[0]], "grid");
    removeLayoutGrid(ids()[0], 0);
    expect(grids()!.map((g) => g.kind)).toEqual(["grid"]);
    expect(removeLayoutGrids(ids())).toBe(1);
    expect(grids()).toBeUndefined();
  });
});
