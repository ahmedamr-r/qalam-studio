import { describe, expect, it } from "vitest";
import { bootRetryDelay, engineGivesWay, welcomeMode } from "./steps";

describe("the welcome", () => {
  it("reads which welcome it is from the address", () => {
    expect(welcomeMode("")).toBe("first");
    expect(welcomeMode("?new=1")).toBe("new");
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
