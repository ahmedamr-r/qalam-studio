import { describe, expect, it } from "vitest";
import { bootRetryDelay, changesThings, connectFor, firstRunLeft, setupStep, stepsFor, stepStates, welcomeMode } from "./steps";

describe("the welcome", () => {
  it("marks the steps before the one being done as done, and the rest as next", () => {
    expect(stepStates("engine")).toEqual({ engine: "now", name: "next", you: "next", voice: "next", goals: "next", yours: "next", connect: "next" });
    expect(stepStates("goals")).toEqual({ engine: "done", name: "done", you: "done", voice: "done", goals: "now", yours: "next", connect: "next" });
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
    expect(setupStep("?first=1&step=you")).toBe("you");
    expect(setupStep("?first=1&step=voice")).toBe("voice");
    expect(setupStep("?step=connect")).toBe("connect");
    expect(setupStep("?step=engine")).toBe("goals");
  });

  it("picks the first run up at the first step it left open, and offers nothing once it's finished", () => {
    const kept = { you: true, voice: true, goals: 3, settingUp: false, picked: true, finished: false };
    expect(firstRunLeft({ ...kept, you: false, goals: 0, picked: false })).toEqual({ step: "you", done: 2, of: 7 });
    expect(firstRunLeft({ ...kept, voice: false })?.step).toBe("voice");
    expect(firstRunLeft({ ...kept, goals: 0, picked: false })).toEqual({ step: "goals", done: 4, of: 7 });
    // A brain dump still waiting on them keeps it on the goals, whatever is in the tree already.
    expect(firstRunLeft({ ...kept, settingUp: true })?.step).toBe("goals");
    expect(firstRunLeft({ ...kept, picked: false })?.step).toBe("yours");
    expect(firstRunLeft(kept)).toEqual({ step: "connect", done: 6, of: 7 });
    expect(firstRunLeft({ ...kept, you: false, finished: true })).toBeNull();
  });

  it("on your own, never stops at which goals are yours, and counts one step fewer", () => {
    const kept = { you: true, voice: true, goals: 3, settingUp: false, picked: false, finished: false, shape: "solo" as const };
    expect(firstRunLeft(kept)).toEqual({ step: "connect", done: 5, of: 6 });
    expect(firstRunLeft({ ...kept, goals: 0 })).toEqual({ step: "goals", done: 4, of: 6 });
    expect(stepsFor("solo").map((s) => s.id)).toEqual(["engine", "name", "you", "voice", "goals", "connect"]);
    expect(stepsFor("team")).toHaveLength(7);
    expect(stepsFor(null)).toHaveLength(7);
  });

  it("suggests reading the goals' numbers first once a goal has one", () => {
    expect(connectFor(true).map((c) => c.id)).toEqual(["posthog", "intercom", "slack", "notion", "confluence", "github"]);
    expect(connectFor(false).map((c) => c.id)).toEqual(["intercom", "slack", "notion", "confluence", "posthog", "github"]);
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
