import { describe, expect, it } from "vitest";
import { routeOf } from "../routes";
import { isPagePlace, legacyTab, placeOf, PLACES, RAIL_PLACES } from "./places";

describe("the organization's places", () => {
  it("says which place an address belongs to", () => {
    expect(placeOf(routeOf("/o/R02vmeVH"))).toBe("home");
    expect(placeOf(routeOf("/o/R02vmeVH/sources"))).toBe("sources");
    expect(placeOf(routeOf("/o/R02vmeVH/t/Xk2_9aLm0q"))).toBe("topics");
    expect(placeOf(routeOf("/o/R02vmeVH/d/abc123def0"))).toBe("boards");
    expect(placeOf(routeOf("/o/R02vmeVH/p/abc123def0"))).toBe("boards");
    expect(placeOf(routeOf("/o/R02vmeVH/setup"))).toBeNull();
    expect(placeOf(routeOf("/nope/x"))).toBeNull();
  });

  it("gives every place but Home a page, and keeps the board's rail short", () => {
    expect(PLACES.filter((p) => isPagePlace(p.id)).map((p) => p.id)).toEqual(["boards", "topics", "sources", "decisions", "connections"]);
    expect(isPagePlace("home")).toBe(false);
    expect(isPagePlace("setup")).toBe(false);
    expect(RAIL_PLACES).not.toContain("sources");
  });

  it("moves the home's old tabs to their places, keeping the rest of the query", () => {
    expect(legacyTab("?tab=topics")).toEqual({ place: "topics", search: "" });
    expect(legacyTab("?product=grocery&tab=decisions")).toEqual({ place: "decisions", search: "?product=grocery" });
    expect(legacyTab("?tab=boards")).toEqual({ place: "boards", search: "" });
    expect(legacyTab("?product=grocery")).toBeNull();
    expect(legacyTab("?tab=connections")).toBeNull();
    expect(legacyTab("?tab=nope")).toBeNull();
  });
});
