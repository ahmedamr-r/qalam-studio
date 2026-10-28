import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { resetSecrets, secrets, securityLine } from "./secrets";

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

  // The real Keychain only when asked (QALAM_KEYCHAIN_TEST=1 on a Mac): it adds and removes one item.
  it.skipIf(process.platform !== "darwin" || !process.env.QALAM_KEYCHAIN_TEST)("round-trips through the macOS Keychain", async () => {
    const name = `qalam-test-${randomBytes(4).toString("hex")}`;
    const s = secrets();
    try {
      await s.set(name, "a value with spaces \" and quotes");
      expect(await s.get(name)).toBe("a value with spaces \" and quotes");
    } finally {
      await s.remove(name);
    }
    expect(await s.get(name)).toBeNull();
  });
});
