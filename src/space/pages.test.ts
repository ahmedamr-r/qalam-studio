import { describe, expect, it } from "vitest";
import type { SpaceThing } from "./compose";
import { cardForPage, pageOf, panelMove, samePage, SECTION } from "./pages";

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
    expect(cardForPage({ business: true }, things)).toBeUndefined();
  });

  it("opens how the business works, behind a goal's or a topic page's address", () => {
    expect(pageOf("?business=1&at=earns")).toEqual({ ref: { business: true }, at: "earns" });
    expect(pageOf("?business=0")).toBeNull();
    expect(pageOf("?goal=g1&business=1")?.ref).toEqual({ goal: "g1" });
    expect(samePage({ business: true }, { business: true })).toBe(true);
    expect(samePage({ business: true }, { page: "business" })).toBe(false);
  });
});

describe("which way the panel's content moves", () => {
  const list = { view: SECTION, depth: 0 };
  const page = (depth: number, id = "a") => ({ view: `page:${id}`, depth });
  it("goes in from a section to a page and back again", () => {
    expect(panelMove(list, page(1))).toBe("in");
    expect(panelMove(page(1), list)).toBe("back");
  });
  it("follows the steps between two pages", () => {
    expect(panelMove(page(1), page(2, "b"))).toBe("in");
    expect(panelMove(page(2, "b"), page(1))).toBe("back");
  });
  it("stays still as the panel opens, closes or nothing changes", () => {
    const closed = { view: null, depth: 0 };
    expect(panelMove(closed, page(1))).toBeNull();
    expect(panelMove(page(1), closed)).toBeNull();
    expect(panelMove(list, list)).toBeNull();
    expect(panelMove(page(1), page(1))).toBeNull();
  });
});
