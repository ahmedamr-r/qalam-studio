import { describe, expect, it } from "vitest";
import { canvasPageHref, goalHref, openOrgHref, orgHref, placeHref, projectHref, setupHref, spaceHref, spacesHref, topicHref, welcomeHref } from "@/projects/model";
import { routeOf } from "./routes";

describe("routeOf", () => {
  it("reads the root and an organization's home", () => {
    expect(routeOf("/")).toEqual({ kind: "root" });
    expect(routeOf("")).toEqual({ kind: "root" });
    expect(routeOf("/o/R02vmeVH")).toEqual({ kind: "org", org: "R02vmeVH" });
    expect(routeOf("/o/R02vmeVH/")).toEqual({ kind: "org", org: "R02vmeVH" });
  });

  it("reads each project type inside an organization", () => {
    expect(routeOf("/o/R02vmeVH/p/abc123def0")).toEqual({ kind: "project", org: "R02vmeVH", type: "screens", id: "abc123def0" });
    expect(routeOf("/o/R02vmeVH/d/abc123def0")).toEqual({ kind: "project", org: "R02vmeVH", type: "discovery", id: "abc123def0" });
    expect(routeOf("/o/R02vmeVH/s/abc123def0/")).toEqual({ kind: "project", org: "R02vmeVH", type: "system", id: "abc123def0" });
  });

  it("opens a goal's or a topic page's page in a canvas's panel", () => {
    expect(topicHref("Xk2_9aLm0q", "R02vmeVH")).toBe("/o/R02vmeVH?page=Xk2_9aLm0q");
    expect(goalHref("g-1", "R02vmeVH", "unknowns")).toBe("/o/R02vmeVH?goal=g-1&at=unknowns");
    expect(canvasPageHref({ goal: "g-1" }, "grocery", { org: "R02vmeVH" })).toBe("/o/R02vmeVH/products/grocery?goal=g-1");
  });

  it("still reads a topic page's own address (it moves to the canvas), only inside its organization", () => {
    expect(routeOf("/o/R02vmeVH/t/h1abc~2")).toEqual({ kind: "topic", org: "R02vmeVH", id: "h1abc~2" });
    expect(routeOf("/t/Xk2_9aLm0q")).toEqual({ kind: "missing" });
    expect(routeOf("/o/R02vmeVH/t/a%2Fb")).toEqual({ kind: "missing" });
  });

  it("reads an organization's setup page, only inside it", () => {
    expect(routeOf(setupHref("R02vmeVH"))).toEqual({ kind: "setup", org: "R02vmeVH" });
    expect(routeOf("/o/R02vmeVH/setup/")).toEqual({ kind: "setup", org: "R02vmeVH" });
    expect(routeOf("/setup")).toEqual({ kind: "missing" });
    expect(routeOf("/o/R02vmeVH/setup/x")).toEqual({ kind: "missing" });
  });

  it("reads the organization's places, and round-trips placeHref", () => {
    for (const place of ["decisions", "connections"] as const) {
      expect(routeOf(placeHref(place, "R02vmeVH"))).toEqual({ kind: "place", org: "R02vmeVH", place });
      expect(routeOf(`${placeHref(place, "R02vmeVH")}/`)).toEqual({ kind: "place", org: "R02vmeVH", place });
    }
    expect(placeHref("home", "R02vmeVH")).toBe("/o/R02vmeVH");
    expect(routeOf("/goals")).toEqual({ kind: "missing" });
    expect(routeOf("/o/R02vmeVH/goals/x")).toEqual({ kind: "missing" });
    expect(routeOf("/o/R02vmeVH/home")).toEqual({ kind: "missing" });
  });

  it("lands the places that had pages of their own on the space's canvas", () => {
    for (const place of ["goals", "problems", "evidence", "boards", "topics", "sources"]) {
      expect(routeOf(`/o/R02vmeVH/${place}`)).toEqual({ kind: "org", org: "R02vmeVH", moved: true });
      expect(routeOf(`/o/R02vmeVH/products/grocery/${place}`)).toEqual({ kind: "org", org: "R02vmeVH", product: "grocery", moved: true });
    }
  });

  it("reads a product's space and the picker, and round-trips spaceHref", () => {
    expect(routeOf(spacesHref("R02vmeVH"))).toEqual({ kind: "spaces", org: "R02vmeVH" });
    expect(openOrgHref("R02vmeVH")).toBe("/o/R02vmeVH/products");
    expect(routeOf(spaceHref("grocery", "home", "R02vmeVH"))).toEqual({ kind: "org", org: "R02vmeVH", product: "grocery" });
    for (const place of ["decisions"] as const) {
      expect(spaceHref("grocery", place, "R02vmeVH")).toBe(`/o/R02vmeVH/products/grocery/${place}`);
      expect(routeOf(spaceHref("grocery", place, "R02vmeVH"))).toEqual({ kind: "place", org: "R02vmeVH", place, product: "grocery" });
      // The organization's own space is where its places always were.
      expect(spaceHref(null, place, "R02vmeVH")).toBe(placeHref(place, "R02vmeVH"));
    }
    expect(spaceHref(null, "home", "R02vmeVH")).toBe("/o/R02vmeVH");
    // Connections is the organization's in every space.
    expect(spaceHref("grocery", "connections", "R02vmeVH")).toBe("/o/R02vmeVH/connections");
    expect(routeOf("/o/R02vmeVH/products/grocery/connections")).toEqual({ kind: "missing" });
    expect(routeOf("/o/R02vmeVH/products/grocery/goals/x")).toEqual({ kind: "missing" });
    expect(routeOf("/o/R02vmeVH/products/a%2Fb")).toEqual({ kind: "missing" });
    expect(routeOf("/products/grocery")).toEqual({ kind: "missing" });
    // A Screens board keeps /p/.
    expect(routeOf("/o/R02vmeVH/p/abc123def0")).toEqual({ kind: "project", org: "R02vmeVH", type: "screens", id: "abc123def0" });
  });

  it("still reads a goal's own address (it moves to the canvas)", () => {
    expect(routeOf("/o/R02vmeVH/g/g-reorders")).toEqual({ kind: "goal", org: "R02vmeVH", id: "g-reorders" });
  });

  it("reads the welcome, only outside an organization", () => {
    expect(routeOf(welcomeHref())).toEqual({ kind: "welcome" });
    expect(routeOf(welcomeHref("verify").split("?")[0])).toEqual({ kind: "welcome" });
    expect(routeOf("/o/R02vmeVH/welcome")).toEqual({ kind: "missing" });
  });

  it("reads quick capture, only outside an organization", () => {
    expect(routeOf("/capture")).toEqual({ kind: "capture" });
    expect(routeOf("/o/R02vmeVH/capture")).toEqual({ kind: "missing" });
  });

  it("reads addresses from before organizations", () => {
    expect(routeOf("/d/abc123def0")).toEqual({ kind: "project", org: null, type: "discovery", id: "abc123def0" });
  });

  it("round-trips the addresses projectHref and orgHref write", () => {
    for (const type of ["screens", "discovery", "system"] as const) {
      expect(routeOf(projectHref({ id: "rZhrfess74", type }, "R02vmeVH"))).toEqual({ kind: "project", org: "R02vmeVH", type, id: "rZhrfess74" });
      expect(routeOf(projectHref({ id: "rZhrfess74", type }, null))).toEqual({ kind: "project", org: null, type, id: "rZhrfess74" });
    }
    expect(routeOf(orgHref("R02vmeVH"))).toEqual({ kind: "org", org: "R02vmeVH" });
    expect(orgHref(null)).toBe("/");
  });

  it("refuses anything else", () => {
    expect(routeOf("/x/abc123def0")).toEqual({ kind: "missing" });
    expect(routeOf("/p/bad")).toEqual({ kind: "missing" });
    expect(routeOf("/p/abc123def0/extra")).toEqual({ kind: "missing" });
    expect(routeOf("/p/%E0%A4%A")).toEqual({ kind: "missing" });
    expect(routeOf("/o")).toEqual({ kind: "missing" });
    expect(routeOf("/o/a/d/abc123def0")).toEqual({ kind: "missing" });
    expect(routeOf("/o/R02vmeVH/x")).toEqual({ kind: "missing" });
  });
});
