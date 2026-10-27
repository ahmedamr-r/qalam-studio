import { describe, expect, it } from "vitest";
import { orgHref, projectHref, topicHref } from "@/projects/model";
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
