import { describe, expect, it } from "vitest";
import type { Goal } from "@/goals/types";
import { routeOf } from "../routes";
import { inSpace, itemSpace, movedTo, spaceSummary } from "./spaces";

const goal = (id: string, product: string | null, parent: string | null = null, status: Goal["status"] = "active") => ({ id, title: id, parent, product, status }) as Goal;

describe("spaces", () => {
  it("shows everything in the organization's space, and only a product's own in its space", () => {
    expect(inSpace(null, null)).toBe(true);
    expect(inSpace("grocery", null)).toBe(true);
    expect(inSpace(["rider"], null)).toBe(true);
    expect(inSpace("grocery", "grocery")).toBe(true);
    expect(inSpace(null, "grocery")).toBe(false);
    expect(inSpace(undefined, "grocery")).toBe(false);
    expect(inSpace(["rider", "grocery"], "grocery")).toBe(true);
    expect(inSpace([], "grocery")).toBe(false);
  });

  it("keeps a goal's or problem's page in the tab's space when it's in it, else its own product's", () => {
    // From the organization's space, everything stays there.
    expect(itemSpace(["grocery"], null)).toBeNull();
    // From a product's space, its own things stay; another product's go to theirs.
    expect(itemSpace(["grocery"], "grocery")).toBe("grocery");
    expect(itemSpace(["rider", "grocery"], "grocery")).toBe("grocery");
    expect(itemSpace(["rider"], "grocery")).toBe("rider");
    expect(itemSpace([], "grocery")).toBeNull();
    // A tab that hasn't been in a space: the thing's own product, when it has one.
    expect(itemSpace(["rider"], undefined)).toBe("rider");
    expect(itemSpace(["rider", "grocery"], undefined)).toBeNull();
    expect(itemSpace([], undefined)).toBeNull();
  });

  it("moves ?product= to the product's space, keeping the rest of the query", () => {
    expect(movedTo(routeOf("/o/R02vmeVH/goals"), "?product=grocery")).toEqual({ place: "goals", product: "grocery", search: "" });
    expect(movedTo(routeOf("/o/R02vmeVH/problems"), "?product=grocery&card=a1")).toEqual({ place: "problems", product: "grocery", search: "?card=a1" });
    expect(movedTo(routeOf("/o/R02vmeVH"), "?product=grocery")).toEqual({ place: "home", product: "grocery", search: "" });
    // The old whole-organization filter is the organization's space now.
    expect(movedTo(routeOf("/o/R02vmeVH/evidence"), "?product=org")).toEqual({ place: "evidence", product: null, search: "" });
    // Connections is the organization's.
    expect(movedTo(routeOf("/o/R02vmeVH/connections"), "?product=grocery")).toEqual({ place: "connections", product: null, search: "" });
    // Already in a product's space, the filter goes.
    expect(movedTo(routeOf("/o/R02vmeVH/products/grocery/goals"), "?product=rider")).toEqual({ place: "goals", product: "grocery", search: "" });
  });

  it("moves the home's old tabs and the places from before the job order, with their product", () => {
    expect(movedTo(routeOf("/o/R02vmeVH"), "?tab=topics&product=grocery")).toEqual({ place: "problems", product: "grocery", search: "" });
    expect(movedTo(routeOf("/o/R02vmeVH"), "?tab=decisions")).toEqual({ place: "decisions", product: null, search: "" });
    expect(movedTo(routeOf("/o/R02vmeVH/boards"), "?product=grocery")).toEqual({ place: "goals", product: "grocery", search: "" });
    expect(movedTo(routeOf("/o/R02vmeVH/sources"), "")).toEqual({ place: "evidence", product: null, search: "" });
    expect(movedTo(routeOf("/o/R02vmeVH/products/grocery/topics"), "")).toEqual({ place: "problems", product: "grocery", search: "" });
  });

  it("leaves addresses that are where they should be", () => {
    expect(movedTo(routeOf("/o/R02vmeVH"), "")).toBeNull();
    expect(movedTo(routeOf("/o/R02vmeVH/goals"), "?card=a1")).toBeNull();
    expect(movedTo(routeOf("/o/R02vmeVH/products/grocery"), "")).toBeNull();
    expect(movedTo(routeOf("/o/R02vmeVH/products"), "?product=grocery")).toBeNull();
    expect(movedTo(routeOf("/o/R02vmeVH/g/g-1"), "?product=grocery")).toBeNull();
  });

  it("sums up a space: its goals, problems and sources, and its top goal", () => {
    const goals = [goal("north", null), goal("reorder", "grocery", "north", "paused"), goal("slot", "grocery", "reorder"), goal("basket", "grocery", "north"), goal("drops", "rider", "north")];
    const topics = [
      { kind: "need", products: ["grocery"] },
      { kind: "need", products: ["grocery", "rider"] },
      { kind: "need", products: [] },
      { kind: "segment", products: ["grocery"] },
    ];
    const sources = [{ product: "grocery" }, { product: null }, {}];
    expect(spaceSummary(null, { goals, north: "north", topics, sources })).toEqual({ goals: 5, problems: 3, sources: 3, top: goals[0] });
    // The product's first active goal that doesn't feed another of its own.
    expect(spaceSummary("grocery", { goals, topics, sources })).toEqual({ goals: 3, problems: 2, sources: 1, top: goals[3] });
    expect(spaceSummary("rider", { goals, topics: null, sources })).toEqual({ goals: 1, problems: null, sources: 0, top: goals[4] });
    expect(spaceSummary("empty", { goals, topics, sources }).top).toBeUndefined();
  });
});
