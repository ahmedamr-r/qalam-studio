import { describe, expect, it } from "vitest";
import { resolveEngine } from "./engine";

describe("which engine Qalam AI runs on", () => {
  it("takes what was chosen on this computer over the environment", () => {
    expect(resolveEngine("api", { AI_BACKEND: "cli" })).toBe("api");
    expect(resolveEngine("cli", {})).toBe("cli");
  });

  it("goes by the environment otherwise, as it always did", () => {
    expect(resolveEngine(undefined, { AI_BACKEND: "cli" })).toBe("cli");
    expect(resolveEngine(undefined, {})).toBe("api");
    expect(resolveEngine(undefined, { AI_BACKEND: "api" })).toBe("api");
  });

  it("never runs Claude Code on Vercel", () => {
    expect(resolveEngine("cli", { VERCEL: "1", AI_BACKEND: "cli" })).toBe("api");
  });
});
