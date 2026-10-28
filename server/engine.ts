import Anthropic from "@anthropic-ai/sdk";
import { streamViaCli } from "@/ai/cli";
import { apiKey, backend, resolveEngine, setEngineState, type EngineKind } from "@/ai/engine";
export type { EngineTest, EngineView } from "@/org/engine";
import { MODEL, readStructured } from "@/ai/server";
import type { EngineTest, EngineView } from "@/org/engine";
import { claudeState, findClaude } from "./claude";
import { announceAll } from "./org/home";
import { NoSecretStore, secrets } from "./secrets";
import { readSettings, writeSettings } from "./settings";

/*
 * This computer's engine for Qalam AI, as Connections shows and changes it: Claude Code on this Mac,
 * or a Claude API key kept in the Keychain (an environment key still works, as before). Loaded once
 * from the settings and the Keychain, before the first request is answered; a switch takes effect
 * at the next call and is announced to every open organization (their inboxes wake up).
 * Claude Code's own credentials are never read: its sign-in is asked of `claude auth status`.
 */

const KEY = "anthropic-api-key";

interface Loaded {
  keyFrom: "keychain" | "environment" | null;
  tests: Partial<Record<EngineKind, EngineTest>>;
}

// One per process, whichever copy of this module asks (the dev server reloads routes).
const g = globalThis as { __qalamEngineLoad?: Promise<Loaded> };

/** Read this computer's choice and key once (the first request waits for it). */
export function ensureEngine(): Promise<Loaded> {
  g.__qalamEngineLoad ??= (async () => {
    const [settings, stored] = await Promise.all([readSettings(), secrets().get(KEY).catch(() => null)]);
    const key = stored ?? (process.env.ANTHROPIC_API_KEY || null);
    setEngineState({ kind: resolveEngine(settings.engine, process.env), key, bin: process.env.CLAUDE_CLI_PATH || findClaude() || "claude" });
    // An inbox that looked before this was read may have waited for nothing.
    void announce();
    return { keyFrom: stored ? "keychain" : key ? "environment" : null, tests: {} };
  })();
  return g.__qalamEngineLoad;
}

/** Forget what was loaded (tests). */
export const resetEngine = () => void (g.__qalamEngineLoad = undefined);

const announce = () => announceAll({ kind: "engine" });

/** Run Qalam AI on this engine from the next call. */
export async function chooseEngine(kind: EngineKind) {
  await ensureEngine();
  await writeSettings({ engine: kind });
  setEngineState({ kind, ...(kind === "cli" ? { bin: process.env.CLAUDE_CLI_PATH || findClaude() || "claude" } : {}) });
  await announce();
}

/** Test a key, keep it in the Keychain, and switch to it. A key that fails the test is never kept. */
export async function saveKey(raw: string, o: TestOpts = {}): Promise<{ ok: true } | { ok: false; test: EngineTest; message: string }> {
  const loaded = await ensureEngine();
  const key = raw.trim();
  const test = await liveTest("api", key, o);
  if (!test.ok) return { ok: false, test, message: test.detail ?? test.word };
  try {
    await secrets().set(KEY, key);
  } catch (e) {
    return { ok: false, test: { ...test, ok: false, word: "Not kept" }, message: e instanceof NoSecretStore ? e.message : `The Keychain didn't keep it: ${e instanceof Error ? e.message : String(e)}` };
  }
  loaded.keyFrom = "keychain";
  await writeSettings({ engine: "api" });
  setEngineState({ kind: "api", key });
  loaded.tests.api = test;
  await announce();
  return { ok: true };
}

/** Take the key out of the Keychain (an environment key, if there is one, is used again). */
export async function forgetKey() {
  const loaded = await ensureEngine();
  await secrets().remove(KEY);
  const env = process.env.ANTHROPIC_API_KEY || null;
  loaded.keyFrom = env ? "environment" : null;
  delete loaded.tests.api;
  setEngineState({ key: env });
  await announce();
}

const TEST_MS = 60_000;
const TEST_SCHEMA = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };

/**
 * A short real call to the engine: an API key is first checked for free (does it open the model?),
 * Claude Code is found and asked whether it's signed in, then a one-word answer is asked of it.
 * `key`: a key not saved yet (it's tested before it's kept).
 */
/** `fetch`: the API's, replaced in tests. */
export interface TestOpts {
  fetch?: typeof fetch;
}

export async function liveTest(kind: EngineKind = backend(), key?: string, o: TestOpts = {}): Promise<EngineTest> {
  const loaded = await ensureEngine();
  const t0 = Date.now();
  const done = (ok: boolean, word: string, detail?: string, model?: string): EngineTest => {
    const t: EngineTest = { ok, word, ...(detail ? { detail } : {}), ...(model ? { model } : {}), ms: Date.now() - t0, at: Date.now() };
    if (!key) loaded.tests[kind] = t;
    return t;
  };
  if (kind === "api") {
    const k = key ?? apiKey();
    if (!k) return done(false, "No key", "Paste a Claude API key from the Claude Console.");
    try {
      const m = await new Anthropic({ apiKey: k, maxRetries: 0, timeout: 20_000, ...(o.fetch ? { fetch: o.fetch } : {}) }).models.retrieve(MODEL);
      return done(true, "Ready", undefined, m.id);
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) return done(false, "Key rejected", "Anthropic didn't accept this key.");
      if (e instanceof Anthropic.PermissionDeniedError) return done(false, "No access", `This key can't use ${MODEL}.`);
      if (e instanceof Anthropic.NotFoundError) return done(false, "No access", `This key can't use ${MODEL}.`);
      if (e instanceof Anthropic.APIConnectionError) return done(false, "Offline", "Couldn't reach Anthropic from this computer.");
      return done(false, "Didn't answer", e instanceof Error ? e.message : String(e));
    }
  }
  const found = process.env.CLAUDE_CLI_PATH || findClaude();
  if (!found) return done(false, "Not installed", "Install Claude Code, then sign in with claude auth login.");
  const state = await claudeState(found);
  if (state.signedIn === false) return done(false, "Signed out", "Run claude auth login in a terminal, then test again.");
  setEngineState({ bin: found });
  // Claude Code itself, whichever engine is live now (the welcome tests it before switching).
  const res = streamViaCli({ system: "You check that Qalam AI can reach its engine. Answer with ok set to true.", content: [{ type: "text", text: "Are you there?" }], schema: TEST_SCHEMA, effort: "low", maxTokens: 512 }, MODEL);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const out = await Promise.race([
      readStructured<{ ok?: boolean }>(res),
      new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("timeout")), TEST_MS))),
    ]);
    return out.data.ok === true ? done(true, "Ready", undefined, out.model) : done(false, "Didn't answer", "Claude Code answered something else.");
  } catch (e) {
    void res.body?.cancel().catch(() => {});
    const m = e instanceof Error ? e.message : String(e);
    if (m === "timeout") return done(false, "Didn't answer", "Claude Code took longer than a minute.");
    if (/isn't signed in|sign in|auth/i.test(m)) return done(false, "Signed out", "Run claude auth login in a terminal, then test again.");
    return done(false, "Didn't answer", m);
  } finally {
    clearTimeout(timer);
  }
}

/** What Connections shows of the engine. */
export async function engineView(): Promise<EngineView> {
  const loaded = await ensureEngine();
  const kind = backend();
  const found = process.env.CLAUDE_CLI_PATH || findClaude();
  const claude = found ? await claudeState(found) : { found: false, signedIn: false };
  const k = apiKey();
  const test = loaded.tests[kind] ?? null;
  const view: EngineView = {
    kind,
    model: MODEL,
    claude,
    key: k ? { last4: k.slice(-4), from: loaded.keyFrom ?? "environment" } : null,
    canStore: secrets().available,
    test,
    ready: false,
    word: "Ready",
  };
  if (kind === "cli") {
    if (!claude.found) return { ...view, word: "Not installed", detail: "Install Claude Code, then sign in with claude auth login." };
    if (claude.signedIn === false) return { ...view, word: "Signed out", detail: "Run claude auth login in a terminal, then test again." };
  } else if (!k) return { ...view, word: "No key", detail: "Paste a Claude API key, or use Claude Code on this Mac." };
  if (test && !test.ok) return { ...view, word: test.word, detail: test.detail };
  return { ...view, ready: true };
}
