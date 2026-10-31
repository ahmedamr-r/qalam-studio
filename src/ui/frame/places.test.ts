import { describe, expect, it } from "vitest";
import { GONE_PLACES, isPagePlace, legacyTab, PLACES, RAIL_PLACES } from "./places";

describe("the organization's places", () => {
  it("lists the canvas, Decisions and Connections, gives the two a page, and keeps the board's rail short", () => {
    expect(PLACES.map((p) => p.label)).toEqual(["Canvas", "Decisions", "Connections"]);
    expect(PLACES.filter((p) => isPagePlace(p.id)).map((p) => p.id)).toEqual(["decisions", "connections"]);
    expect(isPagePlace("home")).toBe(false);
    expect(isPagePlace("goals")).toBe(false);
    expect(isPagePlace("setup")).toBe(false);
    expect(GONE_PLACES.has("evidence")).toBe(true);
    expect(RAIL_PLACES).toEqual(["home", "connections"]);
  });

  it("moves the home's old tabs to Decisions or the canvas, keeping the rest of the query", () => {
    expect(legacyTab("?tab=topics")).toEqual({ place: "home", search: "" });
    expect(legacyTab("?product=grocery&tab=decisions")).toEqual({ place: "decisions", search: "?product=grocery" });
    expect(legacyTab("?tab=boards")).toEqual({ place: "home", search: "" });
    expect(legacyTab("?tab=sources&add=1")).toEqual({ place: "home", search: "?add=1" });
    expect(legacyTab("?product=grocery")).toBeNull();
    expect(legacyTab("?tab=connections")).toBeNull();
    expect(legacyTab("?tab=nope")).toBeNull();
  });
});
