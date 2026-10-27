import { describe, expect, it } from "vitest";
import { findClaude, signedInFrom } from "./claude";

describe("findClaude", () => {
  it("prefers CLAUDE_CLI_PATH", () => {
    expect(findClaude({ CLAUDE_CLI_PATH: "/x/claude", PATH: "/usr/bin" }, () => true, "/Users/me")).toBe("/x/claude");
  });

  it("looks on PATH first, then where installers put it", () => {
    const has = new Set(["/Users/me/.local/bin/claude"]);
    expect(findClaude({ PATH: "/usr/bin:/bin" }, (p) => has.has(p), "/Users/me")).toBe("/Users/me/.local/bin/claude");
    has.add("/bin/claude");
    expect(findClaude({ PATH: "/usr/bin:/bin" }, (p) => has.has(p), "/Users/me")).toBe("/bin/claude");
  });

  it("finds nothing when it isn't installed", () => {
    expect(findClaude({ PATH: "/usr/bin" }, () => false, "/Users/me")).toBeNull();
  });
});

describe("signedInFrom", () => {
  it("reads loggedIn from the status JSON", () => {
    expect(signedInFrom('{"loggedIn": true, "authMethod": "claude.ai"}')).toBe(true);
    expect(signedInFrom('warning line\n{"loggedIn": false}')).toBe(false);
  });

  it("can't tell from anything else", () => {
    expect(signedInFrom("")).toBeNull();
    expect(signedInFrom('{"other": 1}')).toBeNull();
  });
});
