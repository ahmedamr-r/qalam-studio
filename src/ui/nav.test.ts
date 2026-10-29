import { describe, expect, it } from "vitest";
import { inPlace } from "./nav";
import { routeOf } from "./routes";

describe("moving in place", () => {
  it("shows the frame's pages in place, in the organization that's open", () => {
    for (const path of ["/o/R02vmeVH", "/o/R02vmeVH/goals", "/o/R02vmeVH/connections", "/o/R02vmeVH/products", "/o/R02vmeVH/products/grocery/problems", "/o/R02vmeVH/g/g-1", "/o/R02vmeVH/t/Xk2_9aLm0q"])
      expect(inPlace(routeOf(path), "R02vmeVH")).toBe(true);
    expect(inPlace(routeOf("/o/R02vmeVH/goals"), "other1")).toBe(false);
  });

  it("loads boards, setup, the welcome and the rest in full", () => {
    for (const path of ["/o/R02vmeVH/d/abc123def0", "/o/R02vmeVH/p/abc123def0", "/o/R02vmeVH/setup", "/welcome", "/capture", "/", "/o/R02vmeVH/nope/x"])
      expect(inPlace(routeOf(path), "R02vmeVH")).toBe(false);
  });
});
