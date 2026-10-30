import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { accountFrom, findClaude, joinPaths, loginShellPath, signedInFrom } from "./claude";

describe("findClaude", () => {
  it("prefers CLAUDE_CLI_PATH", () => {
    expect(findClaude({ CLAUDE_CLI_PATH: "/x/claude", PATH: "/usr/bin" }, () => true, "/Users/me", "darwin")).toBe("/x/claude");
  });

  it("looks on PATH first, then where installers put it", () => {
    const has = new Set(["/Users/me/.local/bin/claude"]);
    expect(findClaude({ PATH: "/usr/bin:/bin" }, (p) => has.has(p), "/Users/me", "darwin")).toBe("/Users/me/.local/bin/claude");
    has.add("/bin/claude");
    expect(findClaude({ PATH: "/usr/bin:/bin" }, (p) => has.has(p), "/Users/me", "darwin")).toBe("/bin/claude");
  });

  it("finds the native installer's claude.exe or npm's claude.cmd on Windows", () => {
    const home = "C:\\Users\\me";
    expect(findClaude({ PATH: "C:\\Windows" }, (p) => p === "C:\\Users\\me\\.local\\bin\\claude.exe", home, "win32")).toBe("C:\\Users\\me\\.local\\bin\\claude.exe");
    expect(findClaude({ PATH: "C:\\Windows" }, (p) => p === "C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd", home, "win32")).toBe("C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd");
    expect(findClaude({ PATH: "C:\\Windows" }, () => false, home, "win32")).toBeNull();
  });

  it("finds nothing when it isn't installed", () => {
    expect(findClaude({ PATH: "/usr/bin" }, () => false, "/Users/me", "darwin")).toBeNull();
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

describe("accountFrom", () => {
  it("reads who pays from Claude Code 2.1's status, and nothing secret", () => {
    const out = JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: "ahmed@example.com", orgId: "o-1", orgName: "Ahmed's org", subscriptionType: "max", configDirectory: "/Users/me/.claude" });
    expect(accountFrom(out)).toEqual({ email: "ahmed@example.com", org: "Ahmed's org", plan: "max", method: "claude.ai" });
  });

  it("says when a key in the environment would be used instead of the sign-in", () => {
    expect(accountFrom('{"loggedIn": true, "authMethod": "claude.ai", "apiKeySource": "ANTHROPIC_API_KEY"}')).toEqual({ method: "claude.ai", apiKeySource: "ANTHROPIC_API_KEY" });
  });

  it("is nothing when the status says nothing", () => {
    expect(accountFrom('{"loggedIn": false}')).toBeUndefined();
    expect(accountFrom("not json")).toBeUndefined();
  });
});

// A login shell is the Mac's and Linux's; Windows gives an app its PATH.
describe.skipIf(process.platform === "win32")("the PATH a terminal would have", () => {
  it("asks the login shell, past whatever its startup files print", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "qalam-shell-"));
    try {
      const chatty = path.join(dir, "chatty");
      await writeFile(chatty, '#!/bin/sh\necho "Welcome back"\nPATH=/opt/tools/bin:$PATH\nexec /bin/sh -c "$2"\n');
      await chmod(chatty, 0o755);
      expect(await loginShellPath(chatty)).toMatch(/^\/opt\/tools\/bin:/);
      // A shell that never answers is given up on.
      const stuck = path.join(dir, "stuck");
      await writeFile(stuck, "#!/bin/sh\nsleep 5\n");
      await chmod(stuck, 0o755);
      expect(await loginShellPath(stuck, 200)).toBeNull();
      expect(await loginShellPath(path.join(dir, "missing"))).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("joins PATHs, each folder once, the first's first", () => {
    expect(joinPaths("/opt/homebrew/bin:/usr/bin", "/usr/bin:/bin", null, "")).toBe("/opt/homebrew/bin:/usr/bin:/bin");
  });
});
