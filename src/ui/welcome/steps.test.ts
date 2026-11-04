import { describe, expect, it } from "vitest";
import { bootRetryDelay, changesThings, connectFor, engineGivesWay, firstRunLeft, setupStep, stepsFor, stepStates, welcomeMode } from "./steps";

describe("the welcome", () => {
  it("marks the steps before the one being done as done, and the rest as next", () => {
    expect(stepStates("engine")).toEqual({ engine: "now", name: "next", you: "next", voice: "next", company: "next", competitors: "next", goals: "next", yours: "next", connect: "next" });
    expect(stepStates("goals")).toEqual({ engine: "done", name: "done", you: "done", voice: "done", company: "done", competitors: "done", goals: "now", yours: "next", connect: "next" });
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
    expect(firstRunLeft({ ...kept, you: false, goals: 0, picked: false })).toEqual({ step: "you", done: 2, of: 9 });
    expect(firstRunLeft({ ...kept, voice: false })?.step).toBe("voice");
    expect(firstRunLeft({ ...kept, goals: 0, picked: false })).toEqual({ step: "goals", done: 6, of: 9 });
    expect(firstRunLeft({ ...kept, company: false })).toEqual({ step: "company", done: 4, of: 9 });
    // A brain dump still waiting on them keeps it on the goals, whatever is in the tree already.
    expect(firstRunLeft({ ...kept, settingUp: true })?.step).toBe("goals");
    expect(firstRunLeft({ ...kept, picked: false })?.step).toBe("yours");
    expect(firstRunLeft(kept)).toEqual({ step: "connect", done: 8, of: 9 });
    expect(firstRunLeft({ ...kept, you: false, finished: true })).toBeNull();
  });

  it("on your own, never stops at which goals are yours, and counts one step fewer", () => {
    const kept = { you: true, voice: true, goals: 3, settingUp: false, picked: false, finished: false, shape: "solo" as const };
    expect(firstRunLeft(kept)).toEqual({ step: "connect", done: 7, of: 8 });
    expect(firstRunLeft({ ...kept, goals: 0 })).toEqual({ step: "goals", done: 6, of: 8 });
    expect(stepsFor("solo").map((s) => s.id)).toEqual(["engine", "name", "you", "voice", "company", "competitors", "goals", "connect"]);
    expect(stepsFor("team")).toHaveLength(9);
    expect(stepsFor(null)).toHaveLength(9);
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

describe("an engine that can't run", () => {
  const here = { found: true, signedIn: true };
  const view = (o: Partial<Parameters<typeof engineGivesWay>[0]>) => engineGivesWay({ kind: "cli", key: null, claude: here, codex: here, ...o });

  it("gives way when Claude Code or Codex isn't here or is signed out", () => {
    expect(view({ claude: { found: false, signedIn: null } })).toBe(true);
    expect(view({ claude: { found: true, signedIn: false } })).toBe(true);
    expect(view({ kind: "codex", codex: { found: false, signedIn: null } })).toBe(true);
    expect(view({ kind: "codex", codex: undefined })).toBe(false);
  });

  it("gives way when it takes a key and has none", () => {
    expect(view({ kind: "api" })).toBe(true);
    expect(view({ kind: "api", key: { last4: "abcd" } })).toBe(false);
  });

  it("stays when it's ready, when its sign-in can't be told, and when someone chose a model on this computer", () => {
    expect(view({})).toBe(false);
    expect(view({ claude: { found: true, signedIn: null } })).toBe(false);
    expect(view({ kind: "ollama", claude: { found: false, signedIn: null } })).toBe(false);
  });
});
