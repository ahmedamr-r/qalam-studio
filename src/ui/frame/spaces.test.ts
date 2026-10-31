import { describe, expect, it } from "vitest";
import { routeOf } from "../routes";
import { inSpace, itemSpace, movedTo, pageMovedTo } from "./spaces";

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
    expect(movedTo(routeOf("/o/R02vmeVH/decisions"), "?product=grocery")).toEqual({ place: "decisions", product: "grocery", search: "" });
    expect(movedTo(routeOf("/o/R02vmeVH"), "?product=grocery&card=a1")).toEqual({ place: "home", product: "grocery", search: "?card=a1" });
    // The old whole-organization filter is the organization's space now.
    expect(movedTo(routeOf("/o/R02vmeVH/decisions"), "?product=org")).toEqual({ place: "decisions", product: null, search: "" });
    // Connections is the organization's.
    expect(movedTo(routeOf("/o/R02vmeVH/connections"), "?product=grocery")).toEqual({ place: "connections", product: null, search: "" });
    // Already in a product's space, the filter goes.
    expect(movedTo(routeOf("/o/R02vmeVH/products/grocery/decisions"), "?product=rider")).toEqual({ place: "decisions", product: "grocery", search: "" });
  });

  it("lands the home's old tabs and the places that had pages of their own on the space's canvas, with their product", () => {
    expect(movedTo(routeOf("/o/R02vmeVH"), "?tab=topics&product=grocery")).toEqual({ place: "home", product: "grocery", search: "" });
    expect(movedTo(routeOf("/o/R02vmeVH"), "?tab=decisions")).toEqual({ place: "decisions", product: null, search: "" });
    expect(movedTo(routeOf("/o/R02vmeVH/goals"), "")).toEqual({ place: "home", product: null, search: "" });
    expect(movedTo(routeOf("/o/R02vmeVH/boards"), "?product=grocery")).toEqual({ place: "home", product: "grocery", search: "" });
    // Evidence's ?add=1 opens adding on the canvas.
    expect(movedTo(routeOf("/o/R02vmeVH/evidence"), "?add=1")).toEqual({ place: "home", product: null, search: "?add=1" });
    expect(movedTo(routeOf("/o/R02vmeVH/products/grocery/problems"), "")).toEqual({ place: "home", product: "grocery", search: "" });
  });

  it("moves a goal's or a topic page's own address to its page on a canvas, keeping an old section anchor", () => {
    expect(pageMovedTo(routeOf("/o/R02vmeVH/g/g-1"), "", null)).toBe("/o/R02vmeVH?goal=g-1");
    expect(pageMovedTo(routeOf("/o/R02vmeVH/g/g-1"), "#funnel", "grocery")).toBe("/o/R02vmeVH/products/grocery?goal=g-1&at=funnel");
    expect(pageMovedTo(routeOf("/o/R02vmeVH/t/Xk2_9aLm0q"), "#nope", null)).toBe("/o/R02vmeVH?page=Xk2_9aLm0q");
    expect(pageMovedTo(routeOf("/o/R02vmeVH/goals"), "", null)).toBeNull();
  });
});
