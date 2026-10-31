import { describe, expect, it } from "vitest";
import type { SpaceThing } from "./compose";
import { cardForPage, pageOf, samePage } from "./pages";

describe("a page open in a canvas's panel", () => {
  it("reads the page an address opens, and the section it asks for", () => {
    expect(pageOf("?goal=g-1")).toEqual({ ref: { goal: "g-1" }, at: null });
    expect(pageOf("?page=Xk2_9aLm0q&at=funnel&card=c1")).toEqual({ ref: { page: "Xk2_9aLm0q" }, at: "funnel" });
    // A goal wins over a page; an id that isn't one opens nothing.
    expect(pageOf("?page=p1&goal=g1")?.ref).toEqual({ goal: "g1" });
    expect(pageOf("?goal=a%2Fb")).toBeNull();
    expect(pageOf("?card=c1")).toBeNull();
    expect(pageOf("")).toBeNull();
  });

  it("tells the same page however it was asked", () => {
    expect(samePage({ goal: "g1" }, { goal: "g1" })).toBe(true);
    expect(samePage({ goal: "g1" }, { page: "g1" })).toBe(false);
    expect(samePage(null, { page: "p1" })).toBe(false);
  });

  it("finds the card a page belongs to on the canvas: a goal's own, a problem's page drawn faint", () => {
    const things = new Map<string, SpaceThing>([
      ["c1", { type: "card", board: "b1", goal: "g1" }],
      ["out1", { type: "goal", goal: "g1", board: "b1" }],
      ["topic:g1:need-a", { type: "problem", topic: "need-a", goal: "g1" }],
    ]);
    expect(cardForPage({ goal: "g1" }, things)).toBe("out1");
    expect(cardForPage({ page: "need-a" }, things)).toBe("topic:g1:need-a");
    expect(cardForPage({ page: "need-b" }, things)).toBeUndefined();
  });
});
