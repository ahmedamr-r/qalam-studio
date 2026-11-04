import { describe, expect, it } from "vitest";
import { emptyScan, isThin, sanitizeAppPicks, sanitizeSearches, scanOf, scanRequest } from "./session";

describe("a scan's request", () => {
  it("takes an idea or a product, in the App Store it names", () => {
    expect(scanRequest({ target: { kind: "idea", said: "  A meal\nplanner " } })).toEqual({ target: { kind: "idea", said: "A meal planner" }, country: "us" });
    expect(scanRequest({ target: { kind: "product", name: "Mealime", mine: true }, country: "sa" })).toEqual({ target: { kind: "product", name: "Mealime", mine: true }, country: "sa" });
    expect(scanRequest({ target: { kind: "product", name: "", app: "https://apps.apple.com/us/app/x/id1" }, country: "USA" })?.country).toBe("us");
  });

  it("says no to what names nothing", () => {
    for (const bad of [null, {}, { target: { kind: "idea", said: " " } }, { target: { kind: "product", name: "" } }, { target: { kind: "other" } }]) expect(scanRequest(bad)).toBeNull();
  });
});

describe("what a scan keeps", () => {
  it("takes a few short searches, none twice and none quoted", () => {
    expect(sanitizeSearches({ searches: ["gave up on it", "Gave Up On It", '"meal plan"', "far too many words in this one search here", 3, "a", "b", "c"] })).toEqual(["gave up on it", "meal plan", "a"]);
    expect(sanitizeSearches(null)).toEqual([]);
  });

  it("takes only apps it sent, each once, at most three", () => {
    const sent = ["x", "y", "z", "w"];
    expect(sanitizeAppPicks({ picks: ["a2", "a2", "a9", "b1", 3, "a1", "a3", "a4"] }, sent)).toEqual(["y", "x", "z"]);
    expect(sanitizeAppPicks({ picks: [] }, sent)).toEqual([]);
    expect(sanitizeAppPicks(null, sent)).toEqual([]);
  });

  it("says little when there are few problems or few quotes", () => {
    expect(isThin(2, 50)).toBe(true);
    expect(isThin(3, 9)).toBe(true);
    expect(isThin(3, 10)).toBe(false);
  });

  it("reads a session from its file; one nothing runs says it stopped", () => {
    const s = emptyScan({ kind: "idea", said: "x" }, 1);
    expect(scanOf(s, true)).toEqual(s);
    expect(scanOf(s, false)).toMatchObject({ state: "failed" });
    expect(scanOf({ ...s, state: "done" }, false)?.state).toBe("done");
    expect(scanOf({ v: 9 }, false)).toBeNull();
  });
});
