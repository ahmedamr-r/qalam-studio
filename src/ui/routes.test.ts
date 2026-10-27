import { describe, expect, it } from "vitest";
import { projectHref } from "@/projects/model";
import { routeOf } from "./routes";

describe("routeOf", () => {
  it("reads the home page", () => {
    expect(routeOf("/")).toEqual({ kind: "home" });
    expect(routeOf("")).toEqual({ kind: "home" });
  });

  it("reads each project type", () => {
    expect(routeOf("/p/abc123def0")).toEqual({ kind: "project", type: "screens", id: "abc123def0" });
    expect(routeOf("/d/abc123def0")).toEqual({ kind: "project", type: "discovery", id: "abc123def0" });
    expect(routeOf("/s/abc123def0")).toEqual({ kind: "project", type: "system", id: "abc123def0" });
    expect(routeOf("/d/abc123def0/")).toEqual({ kind: "project", type: "discovery", id: "abc123def0" });
  });

  it("round-trips the addresses projectHref writes", () => {
    for (const type of ["screens", "discovery", "system"] as const) {
      expect(routeOf(projectHref({ id: "rZhrfess74", type }))).toEqual({ kind: "project", type, id: "rZhrfess74" });
    }
  });

  it("refuses anything else", () => {
    expect(routeOf("/x/abc123def0")).toEqual({ kind: "missing" });
    expect(routeOf("/p/bad")).toEqual({ kind: "missing" });
    expect(routeOf("/p/abc123def0/extra")).toEqual({ kind: "missing" });
    expect(routeOf("/p/%E0%A4%A")).toEqual({ kind: "missing" });
  });
});
