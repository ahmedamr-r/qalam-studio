import { describe, expect, it } from "vitest";
import { bootRetryDelay, changesThings, stepStates, welcomeMode } from "./steps";

describe("the welcome", () => {
  it("marks the steps before the one being done as done, and the rest as next", () => {
    expect(stepStates("engine")).toEqual({ engine: "now", name: "next", about: "next", found: "next" });
    expect(stepStates("about")).toEqual({ engine: "done", name: "done", about: "now", found: "next" });
  });

  it("reads its mode from the address, and checking again never changes anything", () => {
    expect(welcomeMode("")).toBe("first");
    expect(welcomeMode("?new=1")).toBe("new");
    expect(welcomeMode("?verify=1&new=1")).toBe("verify");
    expect(changesThings("verify")).toBe(false);
    expect(changesThings("first")).toBe(true);
  });

  it("waits about 15 s in all for the core to start, then gives up", () => {
    let total = 0;
    let n = 0;
    for (let d = bootRetryDelay(n); d !== null; d = bootRetryDelay(++n)) total += d;
    expect(total).toBeGreaterThan(12_000);
    expect(total).toBeLessThan(17_000);
    expect(bootRetryDelay(n)).toBeNull();
  });
});
