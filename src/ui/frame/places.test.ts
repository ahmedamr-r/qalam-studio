import { describe, expect, it } from "vitest";
import { routeOf } from "../routes";
import { isPagePlace, legacyTab, placeOf, PLACES, RAIL_PLACES } from "./places";

describe("the organization's places", () => {
  it("says which place an address belongs to", () => {
    expect(placeOf(routeOf("/o/R02vmeVH"))).toBe("home");
    expect(placeOf(routeOf("/o/R02vmeVH/evidence"))).toBe("evidence");
    expect(placeOf(routeOf("/o/R02vmeVH/sources"))).toBe("evidence");
    expect(placeOf(routeOf("/o/R02vmeVH/t/Xk2_9aLm0q"))).toBe("problems");
    expect(placeOf(routeOf("/o/R02vmeVH/g/g-reorders"))).toBe("goals");
    expect(placeOf(routeOf("/o/R02vmeVH/d/abc123def0"))).toBe("goals");
    expect(placeOf(routeOf("/o/R02vmeVH/p/abc123def0"))).toBe("goals");
    expect(placeOf(routeOf("/o/R02vmeVH/setup"))).toBeNull();
    expect(placeOf(routeOf("/nope/x"))).toBeNull();
  });

  it("lists the places in the order of the job, gives every one but Home a page, and keeps the board's rail short", () => {
    expect(PLACES.map((p) => p.label)).toEqual(["Home", "Goals", "Problems", "Evidence", "Decisions", "Connections"]);
    expect(PLACES.filter((p) => isPagePlace(p.id)).map((p) => p.id)).toEqual(["goals", "problems", "evidence", "decisions", "connections"]);
    expect(isPagePlace("home")).toBe(false);
    expect(isPagePlace("setup")).toBe(false);
    expect(isPagePlace("boards")).toBe(false);
    expect(RAIL_PLACES).toEqual(["home", "goals", "problems", "connections"]);
  });

  it("moves the home's old tabs to their places, keeping the rest of the query", () => {
    expect(legacyTab("?tab=topics")).toEqual({ place: "problems", search: "" });
    expect(legacyTab("?product=grocery&tab=decisions")).toEqual({ place: "decisions", search: "?product=grocery" });
    expect(legacyTab("?tab=boards")).toEqual({ place: "goals", search: "" });
    expect(legacyTab("?tab=sources")).toEqual({ place: "evidence", search: "" });
    expect(legacyTab("?product=grocery")).toBeNull();
    expect(legacyTab("?tab=connections")).toBeNull();
    expect(legacyTab("?tab=nope")).toBeNull();
  });
});
