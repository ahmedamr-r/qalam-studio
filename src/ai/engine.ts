/*
 * The engine Qalam AI runs on, read at every call, so a switch in Connections takes effect at once
 * with no restart: the user's own Claude Code ("cli"), or a Claude API key ("api"). The server sets
 * it from this computer's settings and the Keychain (server/engine.ts); until it has, the
 * environment decides, as it always did (AI_BACKEND=cli for Claude Code, else an API key if there
 * is one). The mix of models, also from the settings, is read at every call the same way.
 * Server-only: the key is here.
 */

import { DEFAULT_MIX, modelFor, tierFor, type CallKind, type ModelMix, type Tier } from "./models";

export type EngineKind = "cli" | "api";

interface EngineState {
  kind: EngineKind;
  /** The API key in use (the Keychain's, else the environment's); null: none. */
  key: string | null;
  /** The `claude` to run. */
  bin: string;
  /** "balanced": Sonnet reads, Opus decides; "best": Opus, and Sonnet for the reads that hold there. */
  mix: ModelMix;
  /** Read models Claude Code couldn't use here (some plans lack an alias): reads go to decide instead. */
  readFailed: string[];
}

/** Which engine: what was chosen on this computer, else the environment's (never Claude Code on Vercel). */
export function resolveEngine(chosen: EngineKind | undefined, env: { AI_BACKEND?: string; VERCEL?: string }): EngineKind {
  if (env.VERCEL) return "api";
  return chosen ?? (env.AI_BACKEND === "cli" ? "cli" : "api");
}

// One state per process, whichever copy of this module reads it (the dev server reloads routes).
const g = globalThis as { __qalamEngine?: EngineState };
const state = (): EngineState =>
  (g.__qalamEngine ??= { kind: resolveEngine(undefined, process.env), key: process.env.ANTHROPIC_API_KEY || null, bin: process.env.CLAUDE_CLI_PATH || "claude", mix: DEFAULT_MIX, readFailed: [] });

export const backend = (): EngineKind => state().kind;
export const apiKey = (): string | null => state().key;
export const bin = (): string => state().bin;
export const modelMix = (): ModelMix => state().mix;

/** The model a tier runs on now, on this engine. */
export function tierModel(tier: Tier): string {
  const s = state();
  const o = { backend: s.kind, env: process.env };
  const model = modelFor(tier, o);
  return tier === "read" && s.kind === "cli" && s.readFailed.includes(model) ? modelFor("decide", o) : model;
}

/** The tier a kind of call runs on now, with this mix. */
export const tierNow = (kind: CallKind | undefined): Tier => tierFor(kind, state().mix);

/** The model a kind of call runs on now. */
export const modelOf = (kind: CallKind | undefined): string => tierModel(tierNow(kind));

/** Claude Code couldn't run a read call on `model`: read calls run on the decide model from now on. */
export function readModelFailed(model: string) {
  const s = state();
  if (!s.readFailed.includes(model)) s.readFailed = [...s.readFailed, model];
}

/** The server's view of this computer. */
export function setEngineState(patch: Partial<EngineState>) {
  g.__qalamEngine = { ...state(), ...patch };
}
