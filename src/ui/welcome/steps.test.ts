import { describe, expect, it } from "vitest";
import { bootRetryDelay, changesThings, connectFor, setupStep, stepStates, welcomeMode } from "./steps";

describe("the welcome", () => {
  it("marks the steps before the one being done as done, and the rest as next", () => {
    expect(stepStates("engine")).toEqual({ engine: "now", name: "next", goals: "next", yours: "next", connect: "next" });
    expect(stepStates("goals")).toEqual({ engine: "done", name: "done", goals: "now", yours: "next", connect: "next" });
  });

  it("reads its mode from the address, and checking again never changes anything", () => {
    expect(welcomeMode("")).toBe("first");
    expect(welcomeMode("?new=1")).toBe("new");
    expect(welcomeMode("?verify=1&new=1")).toBe("verify");
    expect(changesThings("verify")).toBe(false);
    expect(changesThings("first")).toBe(true);
  });

  it("starts the setup page on the goals, and takes the step the address names", () => {
    expect(setupStep("?first=1")).toBe("goals");
    expect(setupStep("?first=1&step=yours")).toBe("yours");
    expect(setupStep("?step=connect")).toBe("connect");
    expect(setupStep("?step=engine")).toBe("goals");
  });

  it("suggests reading the goals' numbers first once a goal has one", () => {
    expect(connectFor(true).map((c) => c.id)).toEqual(["posthog", "intercom", "slack", "notion", "github"]);
    expect(connectFor(false).map((c) => c.id)).toEqual(["intercom", "slack", "notion", "posthog", "github"]);
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
