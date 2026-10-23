import { describe, expect, it } from "vitest";
import { treeKey, type TreeRow } from "./LayersPanel";

// Frame (open) > Card (closed) + Title; Footer (a leaf at the top level).
const rows: TreeRow[] = [
  { id: "frame", level: 1, expanded: true },
  { id: "card", level: 2, expanded: false },
  { id: "title", level: 2 },
  { id: "footer", level: 1 },
];

describe("treeKey", () => {
  it("moves up and down, and stops at the ends", () => {
    expect(treeKey(rows, 0, "ArrowDown")).toEqual({ focus: 1 });
    expect(treeKey(rows, 2, "ArrowUp")).toEqual({ focus: 1 });
    expect(treeKey(rows, 0, "ArrowUp")).toBeNull();
    expect(treeKey(rows, 3, "ArrowDown")).toBeNull();
  });

  it("jumps with Home and End", () => {
    expect(treeKey(rows, 2, "Home")).toEqual({ focus: 0 });
    expect(treeKey(rows, 1, "End")).toEqual({ focus: 3 });
    expect(treeKey(rows, 0, "Home")).toBeNull();
  });

  it("opens a closed row, then steps into its first child", () => {
    expect(treeKey(rows, 1, "ArrowRight")).toEqual({ expand: "card", open: true });
    expect(treeKey(rows, 0, "ArrowRight")).toEqual({ focus: 1 });
    expect(treeKey(rows, 2, "ArrowRight")).toBeNull();
  });

  it("closes an open row, else steps out to the parent", () => {
    expect(treeKey(rows, 0, "ArrowLeft")).toEqual({ expand: "frame", open: false });
    expect(treeKey(rows, 2, "ArrowLeft")).toEqual({ focus: 0 });
    expect(treeKey(rows, 1, "ArrowLeft")).toEqual({ focus: 0 });
    expect(treeKey(rows, 3, "ArrowLeft")).toBeNull();
  });

  it("ignores other keys and recovers a lost focus", () => {
    expect(treeKey(rows, 1, "a")).toBeNull();
    expect(treeKey(rows, -1, "ArrowDown")).toEqual({ focus: 0 });
    expect(treeKey([], -1, "ArrowDown")).toBeNull();
  });
});
