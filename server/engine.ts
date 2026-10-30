import Anthropic from "@anthropic-ai/sdk";
import { streamViaCli } from "@/ai/cli";
import { apiKey, backend, keyOf, modelMix, resolveEngine, setEngineState, tavilyKey, tierModel, type EngineKind } from "@/ai/engine";
import { ENGINE_LABEL, isCompat, isKeyed, isLocal, KEYED_KINDS, type KeyedKind } from "@/ai/engine-kinds";
import { adapterFor, streamAdapter } from "@/ai/engines";
import { baseFor, listModels } from "@/ai/engines/compat";
import { codexModels } from "@/ai/engines/codex";
import { testTavily } from "@/ai/engines/search";
import { webVia } from "@/ai/abilities";
import { codexState, findCodex } from "./codex";
import { loopbackBase, PRESETS } from "@/ai/engines/presets";
import { DEFAULT_MIX, type ModelMix, type Tier } from "@/ai/models";
export type { EngineTest, EngineView } from "@/org/engine";
import { readStructured } from "@/ai/server";
import type { EngineOption, EngineTest, EngineView } from "@/org/engine";
import { claudeState, findClaude } from "./claude";
import { announceAll } from "./org/home";
import { NoSecretStore, secrets } from "./secrets";
import { readSettings, writeSettings, type Settings } from "./settings";

/*
 * This computer's engine for Qalam AI, as Connections shows and changes it: Claude Code or Codex on
 * this computer, a key kept in the Keychain (Claude's, OpenAI's, Gemini's or OpenRouter's; an
 * environment key still works, as before), or a model on this computer (Ollama, LM Studio). Loaded
 * once from the settings and the Keychain, before the first request is answered; a switch takes
 * effect at the next call and is announced to every open organization (their inboxes wake up).
 * Claude Code's and Codex's own credentials are never read: their sign-in is asked of
 * `claude auth status` and `codex login status`.
 */

/** Each keyed engine's Keychain item and environment variables. */
const KEYS: Record<KeyedKind, { item: string; env: string[] }> = {
  api: { item: "anthropic-api-key", env: ["ANTHROPIC_API_KEY"] },
  openai: PRESETS.openai.key!,
  gemini: PRESETS.gemini.key!,
  openrouter: PRESETS.openrouter.key!,
};

const envKey = (k: KeyedKind) => KEYS[k].env.map((v) => process.env[v]).find((v) => !!v) ?? null;

/** Tavily's key: web search for a model on this computer. */
const TAVILY = { item: "tavily-api-key", env: "TAVILY_API_KEY" };

interface Loaded {
  keyFrom: Partial<Record<KeyedKind | "tavily", "keychain" | "environment">>;
  tests: Partial<Record<EngineKind, EngineTest>>;
}

// One per process, whichever copy of this module asks (the dev server reloads routes).
const g = globalThis as { __qalamEngineLoad?: Promise<Loaded> };

/** The bases and models the settings keep for engines that aren't Claude. */
const fromSettings = (s: Settings, kind: EngineKind) => ({
  models: s.engines?.[kind]?.models,
  bases: Object.fromEntries(Object.entries(s.engines ?? {}).flatMap(([k, e]) => (e?.baseUrl ? [[k, e.baseUrl]] : []))) as Partial<Record<EngineKind, string>>,
});

/** Read this computer's choice and keys once (the first request waits for it). */
export function ensureEngine(): Promise<Loaded> {
  g.__qalamEngineLoad ??= (async () => {
    const settings = await readSettings();
    const stored = await Promise.all(KEYED_KINDS.map(async (k) => [k, await secrets().get(KEYS[k].item).catch(() => null)] as const));
    const keys: Partial<Record<EngineKind, string>> = {};
    const keyFrom: Loaded["keyFrom"] = {};
    for (const [k, v] of stored) {
      const key = v ?? envKey(k);
      if (!key) continue;
      keys[k] = key;
      keyFrom[k] = v ? "keychain" : "environment";
    }
    const tavily = await secrets().get(TAVILY.item).catch(() => null);
    const tavilyEnv = process.env[TAVILY.env]?.trim() || null;
    if (tavily || tavilyEnv) keyFrom.tavily = tavily ? "keychain" : "environment";
    const kind = resolveEngine(settings.engine, process.env);
    setEngineState({ kind, key: keys.api ?? null, keys, tavily: tavily ?? tavilyEnv, bin: process.env.CLAUDE_CLI_PATH || findClaude() || "claude", codex: findCodex() ?? undefined, mix: settings.models ?? DEFAULT_MIX, ...fromSettings(settings, kind) });
    // An inbox that looked before this was read may have waited for nothing.
    void announce();
    return { keyFrom, tests: {} };
  })();
  return g.__qalamEngineLoad;
}

/** Forget what was loaded (tests). */
export const resetEngine = () => void (g.__qalamEngineLoad = undefined);

const announce = () => announceAll({ kind: "engine" });

/** Run Qalam AI on this engine from the next call. */
export async function chooseEngine(kind: EngineKind) {
  await ensureEngine();
  const settings = await writeSettings({ engine: kind });
  setEngineState({ kind, ...fromSettings(settings, kind), ...(kind === "cli" ? { bin: process.env.CLAUDE_CLI_PATH || findClaude() || "claude" } : {}), ...(kind === "codex" ? { codex: findCodex() ?? undefined } : {}) });
  await announce();
}

/** Run every read on Sonnet and decisions on Opus ("balanced"), or Opus with Sonnet only for the reads that hold there ("best"), from the next call. */
export async function chooseModels(mix: ModelMix) {
  await ensureEngine();
  await writeSettings({ models: mix });
  setEngineState({ mix });
}

/** The models an engine that isn't Claude runs on, by tier (picked from its own list). */
export async function chooseTiers(kind: EngineKind, models: Partial<Record<Tier, string>>) {
  const loaded = await ensureEngine();
  const s = await readSettings();
  const clean = Object.fromEntries(Object.entries(models).filter(([t, m]) => (t === "decide" || t === "read" || t === "fetch") && typeof m === "string" && m.trim()).map(([t, m]) => [t, (m as string).trim().slice(0, 200)]));
  await writeSettings({ engines: { ...s.engines, [kind]: { ...s.engines?.[kind], models: clean } } });
  if (backend() === kind) setEngineState({ models: clean });
  // Its last test was of other models.
  delete loaded.tests[kind];
}

/** Where a model on this computer answers: a local address only, or the usual one again (null). */
export async function chooseBase(kind: EngineKind, raw: string | null): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isLocal(kind)) return { ok: false, message: "Only a model on this computer has an address to set." };
  const base = raw === null || !raw.trim() ? null : loopbackBase(raw);
  if (raw !== null && raw.trim() && !base) return { ok: false, message: "Give an address on this computer, like http://127.0.0.1:11434/v1." };
  const loaded = await ensureEngine();
  const s = await readSettings();
  const { baseUrl: _old, ...rest } = s.engines?.[kind] ?? {};
  const settings = await writeSettings({ engines: { ...s.engines, [kind]: { ...rest, ...(base ? { baseUrl: base } : {}) } } });
  setEngineState({ bases: fromSettings(settings, kind).bases });
  delete loaded.tests[kind];
  return { ok: true };
}

/** The models an engine offers, from its own list. */
export async function engineModels(kind: EngineKind): Promise<string[]> {
  await ensureEngine();
  if (kind === "codex") return codexModels(findCodex() ?? undefined);
  if (!isCompat(kind)) return [];
  return listModels(kind);
}

/** Test a key, keep it in the Keychain, and switch to it. A key that fails the test is never kept. */
export async function saveKey(raw: string, o: TestOpts & { kind?: KeyedKind } = {}): Promise<{ ok: true } | { ok: false; test: EngineTest; message: string }> {
  const loaded = await ensureEngine();
  const kind = o.kind ?? "api";
  const key = raw.trim();
  const test = await liveTest(kind, key, o);
  if (!test.ok) return { ok: false, test, message: test.detail ?? test.word };
  try {
    await secrets().set(KEYS[kind].item, key);
  } catch (e) {
    return { ok: false, test: { ...test, ok: false, word: "Not kept" }, message: e instanceof NoSecretStore ? e.message : `The Keychain didn't keep it: ${e instanceof Error ? e.message : String(e)}` };
  }
  loaded.keyFrom[kind] = "keychain";
  const settings = await writeSettings({ engine: kind });
  setEngineState({ kind, ...(kind === "api" ? { key } : { keys: { ...currentKeys(), [kind]: key } }), ...fromSettings(settings, kind) });
  loaded.tests[kind] = test;
  await announce();
  return { ok: true };
}

const currentKeys = () => Object.fromEntries(KEYED_KINDS.flatMap((k) => (k !== "api" && keyOf(k) ? [[k, keyOf(k)!]] : []))) as Partial<Record<EngineKind, string>>;

/** A Tavily key, for web search on a model on this computer: tested with one small search, then kept in the Keychain. */
export async function saveTavily(raw: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const loaded = await ensureEngine();
  const key = raw.trim();
  const tested = await testTavily(key);
  if (!tested.ok) return tested;
  try {
    await secrets().set(TAVILY.item, key);
  } catch (e) {
    return { ok: false, message: e instanceof NoSecretStore ? e.message : `The Keychain didn't keep it: ${e instanceof Error ? e.message : String(e)}` };
  }
  loaded.keyFrom.tavily = "keychain";
  setEngineState({ tavily: key });
  return { ok: true };
}

export async function forgetTavily() {
  const loaded = await ensureEngine();
  await secrets().remove(TAVILY.item);
  const env = process.env[TAVILY.env]?.trim() || null;
  if (env) loaded.keyFrom.tavily = "environment";
  else delete loaded.keyFrom.tavily;
  setEngineState({ tavily: env });
}

/** Take a key out of the Keychain (an environment key, if there is one, is used again). */
export async function forgetKey(kind: KeyedKind = "api") {
  const loaded = await ensureEngine();
  await secrets().remove(KEYS[kind].item);
  const env = envKey(kind);
  if (env) loaded.keyFrom[kind] = "environment";
  else delete loaded.keyFrom[kind];
  delete loaded.tests[kind];
  if (kind === "api") setEngineState({ key: env });
  else {
    const keys = currentKeys();
    if (env) keys[kind] = env;
    else delete keys[kind];
    setEngineState({ keys });
  }
  await announce();
}

const TEST_MS = 60_000;
const TEST_SCHEMA = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };

/**
 * A short real call to the engine: an API key is checked for free (does it open each tier's model?
 * Fetch runs only through Claude Code, so it isn't asked), another engine's key or server by
 * listing its models and then a one-word answer from the model picked, Claude Code is found and
 * asked whether it's signed in, then a one-word answer is asked of it. `key`: a key not saved yet
 * (it's tested before it's kept, by the list alone).
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
  if (isCompat(kind)) {
    const label = PRESETS[kind].label;
    if (PRESETS[kind].key && !(key ?? keyOf(kind))) return done(false, "No key", `Paste a ${label} key.`);
    try {
      const models = await listModels(kind, key);
      const chosen = (await readSettings()).engines?.[kind]?.models?.decide;
      if (!models.length) return done(false, "No models", isLocal(kind) ? `${label} has no model yet. Download one in ${label}, then test again.` : `${label} offers no models to this key.`);
      if (chosen && !models.includes(chosen)) return done(false, "Model gone", `${label} no longer has ${chosen}. Pick another.`);
      // The model picked answers a short structured call (a key not kept yet is only checked by the list).
      if (chosen && !key) {
        const out = await withTimeout(readStructured<{ ok?: boolean }>(streamAdapter(adapterFor(kind)!, { system: "You check that Qalam AI can reach its engine. Answer with ok set to true.", content: [{ type: "text", text: "Are you there?" }], schema: TEST_SCHEMA, effort: "low", maxTokens: 512 }, chosen)));
        if (out.data.ok !== true) return done(false, "Didn't answer", `${chosen} answered something else.`);
        return done(true, "Ready", undefined, out.model);
      }
      return done(true, "Ready", undefined, chosen ?? models[0]);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m === "timeout") return done(false, "Didn't answer", `${label} took longer than a minute.`);
      return done(false, /key/i.test(m) ? "Key rejected" : /answering|reach/i.test(m) ? "Offline" : "Didn't answer", m);
    }
  }
  if (kind === "api") {
    const k = key ?? apiKey();
    if (!k) return done(false, "No key", "Paste a Claude API key from the Claude Console.");
    const client = new Anthropic({ apiKey: k, maxRetries: 0, timeout: 20_000, ...(o.fetch ? { fetch: o.fetch } : {}) });
    const models = [...new Set([tierModel("decide"), tierModel("read")])];
    let asked = models[0];
    try {
      let id = asked;
      for (const m of models) {
        asked = m;
        const got = await client.models.retrieve(m);
        if (m === models[0]) id = got.id;
      }
      return done(true, "Ready", undefined, id);
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) return done(false, "Key rejected", "Anthropic didn't accept this key.");
      if (e instanceof Anthropic.PermissionDeniedError) return done(false, "No access", `This key can't use ${asked}.`);
      if (e instanceof Anthropic.NotFoundError) return done(false, "No access", `This key can't use ${asked}.`);
      if (e instanceof Anthropic.APIConnectionError) return done(false, "Offline", "Couldn't reach Anthropic from this computer.");
      return done(false, "Didn't answer", e instanceof Error ? e.message : String(e));
    }
  }
  if (kind === "codex") {
    const bin = findCodex();
    if (!bin) return done(false, "Not installed", "Install Codex or the ChatGPT app, then sign in with codex login.");
    const state = await codexState(bin);
    if (state.signedIn === false) return done(false, "Signed out", "Run codex login in a terminal, then test again.");
    setEngineState({ codex: bin });
    // Codex itself, with the model picked (or its own choice).
    try {
      const out = await withTimeout(readStructured<{ ok?: boolean }>(streamAdapter(adapterFor("codex")!, { system: "You check that Qalam AI can reach its engine. Answer with ok set to true.", content: [{ type: "text", text: "Are you there?" }], schema: TEST_SCHEMA, effort: "low", maxTokens: 512 }, (await readSettings()).engines?.codex?.models?.decide ?? "")));
      return out.data.ok === true ? done(true, "Ready", undefined, out.model) : done(false, "Didn't answer", "Codex answered something else.");
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m === "timeout") return done(false, "Didn't answer", "Codex took longer than a minute.");
      if (/isn't signed in/i.test(m)) return done(false, "Signed out", "Run codex login in a terminal, then test again.");
      return done(false, "Didn't answer", m);
    }
  }
  if (kind !== "cli") return done(false, "Not here yet", `${ENGINE_LABEL[kind]} isn't available in this version.`);
  const found = process.env.CLAUDE_CLI_PATH || findClaude();
  if (!found) return done(false, "Not installed", "Install Claude Code, then sign in with claude auth login.");
  const state = await claudeState(found);
  if (state.signedIn === false) return done(false, "Signed out", "Run claude auth login in a terminal, then test again.");
  setEngineState({ bin: found });
  // Claude Code itself, whichever engine is live now (the welcome tests it before switching).
  const res = streamViaCli({ system: "You check that Qalam AI can reach its engine. Answer with ok set to true.", content: [{ type: "text", text: "Are you there?" }], schema: TEST_SCHEMA, effort: "low", maxTokens: 512 }, tierModel("decide"));
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

/** A call that takes longer than the test allows fails as "timeout". */
async function withTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error("timeout")), TEST_MS)))]);
  } finally {
    clearTimeout(timer);
  }
}

/** Whether a model on this computer answers now (a quick look, so the card can say). */
async function answers(kind: "ollama" | "lmstudio"): Promise<boolean> {
  try {
    const res = await fetch(`${baseFor(kind)}/models`, { signal: AbortSignal.timeout(600) });
    return res.ok;
  } catch {
    return false;
  }
}

/** What Connections shows of the engine, and of every engine it could run on. */
export async function engineView(): Promise<EngineView> {
  const loaded = await ensureEngine();
  const kind = backend();
  const settings = await readSettings();
  const found = process.env.CLAUDE_CLI_PATH || findClaude();
  const claude = found ? await claudeState(found) : { found: false, signedIn: false };
  const k = isKeyed(kind) ? keyOf(kind) : null;
  const test = loaded.tests[kind] ?? null;
  const [ollama, lmstudio, codex] = await Promise.all([answers("ollama"), answers("lmstudio"), codexState(findCodex())]);
  const keyInfo = (kk: KeyedKind) => (keyOf(kk) ? { last4: keyOf(kk)!.slice(-4), from: loaded.keyFrom[kk] ?? ("environment" as const) } : null);
  const option = (o: EngineKind): EngineOption => {
    const picked = settings.engines?.[o]?.models;
    if (o === "cli") return { kind: o, label: ENGINE_LABEL[o], state: !claude.found ? "missing" : claude.signedIn === false ? "signed-out" : "ready" };
    if (o === "codex") return { kind: o, label: ENGINE_LABEL[o], state: !codex.found ? "missing" : codex.signedIn === false ? "signed-out" : "ready", ...(picked ? { models: picked } : {}) };
    if (isKeyed(o)) return { kind: o, label: ENGINE_LABEL[o], state: !keyOf(o) ? "no-key" : o !== "api" && !picked?.decide ? "pick-model" : "ready", key: keyInfo(o), ...(picked ? { models: picked } : {}) };
    if (o === "ollama" || o === "lmstudio") return { kind: o, label: ENGINE_LABEL[o], state: !(o === "ollama" ? ollama : lmstudio) ? "offline" : !picked?.decide ? "pick-model" : "ready", base: baseFor(o), ...(picked ? { models: picked } : {}) };
    return { kind: o, label: ENGINE_LABEL[o], state: "missing" };
  };
  const options = (["cli", "codex", "ollama", "lmstudio", "api", "openai", "gemini", "openrouter"] as EngineKind[]).map(option);
  const view: EngineView = {
    kind,
    label: ENGINE_LABEL[kind],
    model: tierModel("decide"),
    models: modelMix(),
    tiers: { decide: tierModel("decide"), read: tierModel("read"), fetch: tierModel("fetch") },
    claude,
    codex,
    web: { via: webVia(kind, !!tavilyKey()), tavily: tavilyKey() ? { last4: tavilyKey()!.slice(-4), from: loaded.keyFrom.tavily ?? "environment" } : null },
    key: isKeyed(kind) && k ? keyInfo(kind) : null,
    canStore: secrets().available,
    test,
    ready: false,
    word: "Ready",
    options,
    ...(isLocal(kind) ? { base: baseFor(kind as "ollama" | "lmstudio") } : {}),
  };
  if (kind === "cli") {
    if (!claude.found) return { ...view, word: "Not installed", detail: "Install Claude Code, then sign in with claude auth login." };
    if (claude.signedIn === false) return { ...view, word: "Signed out", detail: "Run claude auth login in a terminal, then test again." };
  } else if (kind === "codex") {
    if (!codex.found) return { ...view, word: "Not installed", detail: "Install Codex or the ChatGPT app, then sign in with codex login." };
    if (codex.signedIn === false) return { ...view, word: "Signed out", detail: "Run codex login in a terminal, then test again." };
  } else if (isKeyed(kind) && !k) return { ...view, word: "No key", detail: kind === "api" ? "Paste a Claude API key, or use Claude Code on this Mac." : `Paste a ${ENGINE_LABEL[kind].replace(/ (API )?key$/, "")} key.` };
  else if (isLocal(kind) && !(kind === "ollama" ? ollama : lmstudio)) return { ...view, word: "Offline", detail: `${ENGINE_LABEL[kind]} isn't answering at ${baseFor(kind as "ollama" | "lmstudio")}. Start it, then test again.` };
  else if (isCompat(kind) && !settings.engines?.[kind]?.models?.decide) return { ...view, word: "Pick a model", detail: "Pick the models Qalam AI runs on, below." };
  if (test && !test.ok) return { ...view, word: test.word, detail: test.detail };
  return { ...view, ready: true };
}
