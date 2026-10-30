import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { answerSecret, sealedFile, type Cipher } from "./secrets";
import { resetSecrets, secrets, useSealedSecrets } from "../server/secrets";

const dir = mkdtempSync(path.join(tmpdir(), "qalam-sealed-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// A stand-in for the system's encryption: reversible, and never the plain text.
const cipher: Cipher = { available: () => true, encrypt: (s) => Buffer.from([...s].reverse().join(""), "utf8"), decrypt: (b) => [...b.toString("utf8")].reverse().join("") };

describe("secrets on a computer with no Keychain", () => {
  it("keeps each value sealed in one file, and never in plain text", () => {
    const file = path.join(dir, "secrets.json");
    const store = sealedFile(file, cipher);
    expect(store.get("openai-api-key")).toBeNull();
    store.set("openai-api-key", "sk-test-1234");
    expect(readFileSync(file, "utf8")).not.toContain("sk-test-1234");
    expect(store.get("openai-api-key")).toBe("sk-test-1234");
    store.remove("openai-api-key");
    expect(store.get("openai-api-key")).toBeNull();
    expect(sealedFile(path.join(dir, "none.json"), { ...cipher, available: () => false }).set.bind(null, "x", "y")).toThrow("can't encrypt");
  });

  it("answers the core's questions over its parent port", async () => {
    const store = sealedFile(path.join(dir, "asked.json"), cipher);
    expect(answerSecret(store, { t: "secret", id: 1, op: "set", name: "k", value: "v" })).toEqual({ t: "secret", id: 1, value: null });
    expect(answerSecret(store, { t: "secret", id: 2, op: "get", name: "k" })).toEqual({ t: "secret", id: 2, value: "v" });

    // The core's side: its secrets go to main and back.
    resetSecrets();
    useSealedSecrets(async (op, name, value) => answerSecret(store, { t: "secret", id: 3, op, name, value }).value ?? null);
    expect(secrets().available).toBe(true);
    await secrets().set("tavily-api-key", "tvly-1");
    expect(await secrets().get("tavily-api-key")).toBe("tvly-1");
    await secrets().remove("tavily-api-key");
    expect(await secrets().get("tavily-api-key")).toBeNull();
    resetSecrets();
  });
});
