import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { backend, keyOf, tierModel } from "@/ai/engine";
import { setChatFetch } from "@/ai/engines/compat";
import { resetSecrets, secrets } from "./secrets";
import { chooseBase, chooseEngine, chooseTiers, engineView, forgetKey, liveTest, resetEngine, saveKey } from "./engine";

let dir: string;
const env = { ...process.env };

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "qalam-engine-"));
});
afterAll(async () => {
  process.env = env;
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  // Never the real `claude` on this computer.
  process.env.CLAUDE_CLI_PATH = await fakeClaude("claude-in", true);
  process.env.QALAM_HOME = path.join(dir, `home-${Math.random().toString(36).slice(2)}`);
  process.env.QALAM_SECRETS = "memory";
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  setChatFetch(undefined);
  delete process.env.AI_BACKEND;
  resetSecrets();
  resetEngine();
});

/** A stand-in `claude`: `auth status` says `signedIn`; a call answers ok, as stream-json. */
async function fakeClaude(name: string, signedIn: boolean) {
  const file = path.join(dir, name);
  const status = JSON.stringify({ loggedIn: signedIn, authMethod: "claude.ai", email: "a@example.com", subscriptionType: "max" });
  const init = JSON.stringify({ type: "system", subtype: "init", model: "claude-opus-5-5" });
  const result = JSON.stringify({ type: "result", subtype: "success", structured_output: { ok: true }, usage: { input_tokens: 9, output_tokens: 3 }, total_cost_usd: 0.002 });
  await writeFile(file, `#!/bin/sh\nif [ "$1" = "auth" ]; then echo '${status}'; exit 0; fi\ncat > /dev/null\necho '${init}'\necho '${result}'\n`);
  await chmod(file, 0o755);
  return file;
}

const api = (status: number, body: unknown): typeof fetch => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("the engine behind Qalam AI", () => {
  it("switches between two calls, with no restart, and remembers the choice on this computer", async () => {
    await chooseEngine("cli");
    expect(backend()).toBe("cli");
    await chooseEngine("api");
    expect(backend()).toBe("api");
    expect(JSON.parse(await readFile(path.join(process.env.QALAM_HOME!, ".qalam", "settings.json"), "utf8"))).toEqual({ engine: "api" });
    resetEngine();
    expect((await engineView()).kind).toBe("api");
  });

  // Its stand-in is a script with a shebang, which Windows can't start.
  it.skipIf(process.platform === "win32")("tests Claude Code: signed out says so; signed in makes a short real call", async () => {
    process.env.CLAUDE_CLI_PATH = await fakeClaude("claude-out", false);
    expect(await liveTest("cli")).toMatchObject({ ok: false, word: "Signed out" });
    process.env.CLAUDE_CLI_PATH = await fakeClaude("claude-in", true);
    expect(await liveTest("cli")).toMatchObject({ ok: true, word: "Ready", model: "claude-opus-5-5" });
  });

  it("keeps a key only when Anthropic accepts it, and shows only its last four", async () => {
    const bad = await saveKey("sk-ant-test-0000000000000000000000", { fetch: api(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }) });
    expect(bad).toMatchObject({ ok: false, test: { word: "Key rejected" } });
    expect(await secrets().get("anthropic-api-key")).toBeNull();

    const good = await saveKey("sk-ant-test-1111111111111111111abcd", { fetch: api(200, { id: "claude-opus-5-5", type: "model", display_name: "Claude Opus 5.5", created_at: "2026-01-01T00:00:00Z" }) });
    expect(good).toEqual({ ok: true });
    expect(backend()).toBe("api");
    const view = await engineView();
    expect(view.key).toEqual({ last4: "abcd", from: "keychain" });
    expect(JSON.stringify(view)).not.toContain("1111111111");
  });

  it("keeps another engine's key under its own name, once its list of models answers, and says to pick one", async () => {
    setChatFetch(async (_url, init) => (new Headers(init?.headers).get("authorization")?.endsWith("good-key-0000000000000wxyz") ? Response.json({ data: [{ id: "gpt-b" }, { id: "gpt-a" }] }) : Response.json({ error: { message: "Incorrect API key" } }, { status: 401 })));
    expect(await saveKey("bad-key-00000000000000000000", { kind: "openai" })).toMatchObject({ ok: false, test: { word: "Key rejected" } });
    expect(await secrets().get("openai-api-key")).toBeNull();

    expect(await saveKey("good-key-0000000000000wxyz", { kind: "openai" })).toEqual({ ok: true });
    expect(backend()).toBe("openai");
    expect(await secrets().get("anthropic-api-key")).toBeNull();
    let view = await engineView();
    expect(view).toMatchObject({ kind: "openai", key: { last4: "wxyz", from: "keychain" }, ready: false, word: "Pick a model" });
    expect(view.options?.find((o) => o.kind === "openai")).toMatchObject({ state: "pick-model" });

    await chooseTiers("openai", { decide: "gpt-a", read: "gpt-b", bogus: "x" } as never);
    expect(tierModel("decide")).toBe("gpt-a");
    expect(tierModel("read")).toBe("gpt-b");
    view = await engineView();
    expect(view).toMatchObject({ ready: true, tiers: { decide: "gpt-a", read: "gpt-b" } });
    expect(JSON.parse(await readFile(path.join(process.env.QALAM_HOME!, ".qalam", "settings.json"), "utf8")).engines).toEqual({ openai: { models: { decide: "gpt-a", read: "gpt-b" } } });

    // Read again from the settings and the Keychain after a restart; forgetting the key falls back to the environment's.
    resetEngine();
    expect((await engineView()).tiers.decide).toBe("gpt-a");
    process.env.OPENAI_API_KEY = "env-key-000000000000000000";
    await forgetKey("openai");
    expect(keyOf("openai")).toBe("env-key-000000000000000000");
    expect((await engineView()).key).toEqual({ last4: "0000", from: "environment" });
  });

  it("takes a model on this computer only at a local address, and says when it isn't running", async () => {
    await chooseEngine("ollama");
    expect(await chooseBase("ollama", "http://192.168.1.4:11434/v1")).toMatchObject({ ok: false });
    expect(await chooseBase("openai", "http://127.0.0.1:9/v1")).toMatchObject({ ok: false });
    expect(await chooseBase("ollama", "http://127.0.0.1:9/v1/")).toEqual({ ok: true });
    await chooseTiers("ollama", { decide: "qwen3" });
    const view = await engineView();
    expect(view).toMatchObject({ kind: "ollama", base: "http://127.0.0.1:9/v1", ready: false, word: "Offline" });
    expect(view.options?.find((o) => o.kind === "ollama")).toMatchObject({ state: "offline", base: "http://127.0.0.1:9/v1" });
    setChatFetch(async (url) => (String(url).endsWith("/models") ? Response.json({ data: [{ id: "qwen3" }] }) : Response.json({ model: "qwen3:8b", choices: [{ message: { content: '{"ok":false}' } }] })));
    expect(await liveTest("ollama")).toMatchObject({ ok: false, word: "Didn't answer" });
    setChatFetch(async (url) => (String(url).endsWith("/models") ? Response.json({ data: [{ id: "qwen3" }] }) : Response.json({ model: "qwen3:8b", choices: [{ message: { content: '{"ok":true}' } }] })));
    expect(await liveTest("ollama")).toMatchObject({ ok: true, model: "qwen3:8b" });
    expect(await chooseBase("ollama", null)).toEqual({ ok: true });
    expect((await engineView()).base).toBe("http://127.0.0.1:11434/v1");
  });
});
