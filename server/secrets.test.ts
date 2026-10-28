import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { inParts, resetSecrets, secrets, securityLine, split, type Items } from "./secrets";

afterEach(() => {
  delete process.env.QALAM_SECRETS;
  resetSecrets();
});

describe("secrets kept for Qalam", () => {
  it("keeps, finds and forgets a value (in memory, for tests)", async () => {
    process.env.QALAM_SECRETS = "memory";
    resetSecrets();
    const s = secrets();
    expect(await s.get("k")).toBeNull();
    await s.set("k", "sk-ant-value");
    expect(await s.get("k")).toBe("sk-ant-value");
    await s.remove("k");
    expect(await s.get("k")).toBeNull();
  });

  it("writes the Keychain's line with every argument quoted, and the value only as hex", () => {
    const hex = Buffer.from('se"cret \\ value', "utf8").toString("hex");
    const line = securityLine(["add-generic-password", "-U", "-s", "Qalam Studio", "-a", "anthropic-api-key", "-X", hex]);
    expect(line).toBe(`"add-generic-password" "-U" "-s" "Qalam Studio" "-a" "anthropic-api-key" "-X" "${hex}"\n`);
    expect(line).not.toContain("cret");
    expect(securityLine(['a"b\\c'])).toBe('"a\\"b\\\\c"\n');
  });

  it("keeps a long value in parts, each short enough for one line of `security -i`", async () => {
    const kept = new Map<string, string>();
    // The tool reads 4096 characters a line: hex doubles the value, and the command takes some.
    const items: Items = {
      find: async (n) => kept.get(n) ?? null,
      add: async (n, v) => {
        if (Buffer.byteLength(v) * 2 + 120 > 4096) throw new Error("line too long");
        kept.set(n, v);
      },
      delete: async (n) => void kept.delete(n),
    };
    const s = inParts(items);
    const long = JSON.stringify({ access_token: "a".repeat(2500), refresh_token: "r".repeat(1800), note: "é😀" });
    await s.set("connector:notion:oauth", long);
    expect(await s.get("connector:notion:oauth")).toBe(long);
    expect(kept.size).toBe(4);
    // A new long value replaces every old part; a short one keeps one item.
    await s.set("connector:notion:oauth", long.replace(/a/g, "b"));
    expect(await s.get("connector:notion:oauth")).toBe(long.replace(/a/g, "b"));
    expect(kept.size).toBe(4);
    await s.set("connector:notion:oauth", "short");
    expect([...kept.keys()]).toEqual(["connector:notion:oauth"]);
    await s.set("connector:notion:oauth", long);
    await s.remove("connector:notion:oauth");
    expect(kept.size).toBe(0);
    expect(await s.get("connector:notion:oauth")).toBeNull();
  });

  it("splits by bytes without cutting a character", () => {
    const parts = split("ab😀cd", 5);
    expect(parts).toEqual(["ab", "😀c", "d"]);
    expect(parts.join("")).toBe("ab😀cd");
  });

  // The real Keychain only when asked (QALAM_KEYCHAIN_TEST=1 on a Mac): it adds and removes one item.
  it.skipIf(process.platform !== "darwin" || !process.env.QALAM_KEYCHAIN_TEST)("round-trips through the macOS Keychain", async () => {
    const name = `qalam-test-${randomBytes(4).toString("hex")}`;
    const s = secrets();
    try {
      await s.set(name, "a value with spaces \" and quotes");
      expect(await s.get(name)).toBe("a value with spaces \" and quotes");
      const long = `{"access_token":"${randomBytes(2400).toString("base64url")}"}`;
      await s.set(name, long);
      expect(await s.get(name)).toBe(long);
    } finally {
      await s.remove(name);
    }
    expect(await s.get(name)).toBeNull();
  });
});
