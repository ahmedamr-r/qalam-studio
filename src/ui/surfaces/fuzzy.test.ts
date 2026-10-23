import { describe, expect, it } from "vitest";
import { fuzzy, highlightRuns, scoreItem } from "./fuzzy";

const rank = (q: string, labels: string[]) =>
  labels
    .map((l) => ({ l, m: fuzzy(q, l) }))
    .filter((x) => x.m)
    .sort((a, b) => b.m!.score - a.m!.score)
    .map((x) => x.l);

describe("fuzzy", () => {
  it("matches in order and rejects out-of-order letters", () => {
    expect(fuzzy("fs", "Frame selection")).not.toBeNull();
    expect(fuzzy("sf", "Frame selection")).toBeNull();
    // Letters scattered inside words don't count.
    expect(fuzzy("fra", "Flip horizontal")).toBeNull();
    expect(fuzzy("zsel", "Zoom to selection")).not.toBeNull();
  });

  it("prefers word starts and prefixes", () => {
    expect(rank("fr", ["Bring to front", "Frame selection", "Flip horizontal"])[0]).toBe("Frame selection");
    expect(rank("fs", ["Flip horizontal", "Frame selection", "Fills"])[0]).toBe("Frame selection");
    expect(rank("pen", ["Open document JSON…", "Pen", "Pencil"])[0]).toBe("Pen");
  });

  it("needs every query word", () => {
    expect(fuzzy("zoom sel", "Zoom to selection")).not.toBeNull();
    expect(fuzzy("zoom pen", "Zoom to selection")).toBeNull();
  });

  it("returns the matched indices", () => {
    expect(fuzzy("rul", "Rulers")!.hits).toEqual([0, 1, 2]);
    expect(fuzzy("fs", "Frame selection")!.hits).toEqual([0, 6]);
  });
});

describe("scoreItem", () => {
  it("finds items by keyword, ranked below label hits", () => {
    const byKeyword = scoreItem("wireframe", { label: "Outlines", keywords: ["wireframe", "outline mode"] });
    const byLabel = scoreItem("outl", { label: "Outlines" });
    expect(byKeyword).not.toBeNull();
    expect(byLabel!.score).toBeGreaterThan(0);
  });

  it("matches the category as a last resort", () => {
    expect(scoreItem("tool", { label: "Pen", extra: "Tool" })).not.toBeNull();
    expect(scoreItem("xyz", { label: "Pen", extra: "Tool" })).toBeNull();
  });
});

describe("highlightRuns", () => {
  it("groups adjacent hits", () => {
    expect(highlightRuns("Rulers", [0, 1, 2])).toEqual([
      { text: "Rul", hit: true },
      { text: "ers", hit: false },
    ]);
  });
});
