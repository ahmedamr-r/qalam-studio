import { describe, expect, it } from "vitest";
import { orgHref, placeHref, projectHref, setupHref, topicHref, welcomeHref } from "@/projects/model";
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

  it("reads a topic page, only inside its organization", () => {
    expect(routeOf(topicHref("Xk2_9aLm0q", "R02vmeVH"))).toEqual({ kind: "topic", org: "R02vmeVH", id: "Xk2_9aLm0q" });
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
    for (const place of ["goals", "problems", "evidence", "decisions", "connections"] as const) {
      expect(routeOf(placeHref(place, "R02vmeVH"))).toEqual({ kind: "place", org: "R02vmeVH", place });
      expect(routeOf(`${placeHref(place, "R02vmeVH")}/`)).toEqual({ kind: "place", org: "R02vmeVH", place });
    }
    expect(placeHref("home", "R02vmeVH")).toBe("/o/R02vmeVH");
    expect(routeOf("/goals")).toEqual({ kind: "missing" });
    expect(routeOf("/o/R02vmeVH/goals/x")).toEqual({ kind: "missing" });
    expect(routeOf("/o/R02vmeVH/home")).toEqual({ kind: "missing" });
  });

  it("sends the places from before the job order where they went", () => {
    expect(routeOf("/o/R02vmeVH/boards")).toEqual({ kind: "place", org: "R02vmeVH", place: "goals", moved: true });
    expect(routeOf("/o/R02vmeVH/topics")).toEqual({ kind: "place", org: "R02vmeVH", place: "problems", moved: true });
    expect(routeOf("/o/R02vmeVH/sources")).toEqual({ kind: "place", org: "R02vmeVH", place: "evidence", moved: true });
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
