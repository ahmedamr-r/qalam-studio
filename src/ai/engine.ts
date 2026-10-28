/*
 * The engine Qalam AI runs on, read at every call, so a switch in Connections takes effect at once
 * with no restart: the user's own Claude Code ("cli"), or a Claude API key ("api"). The server sets
 * it from this computer's settings and the Keychain (server/engine.ts); until it has, the
 * environment decides, as it always did (AI_BACKEND=cli for Claude Code, else an API key if there
 * is one). Server-only: the key is here.
 */

export type EngineKind = "cli" | "api";

interface EngineState {
  kind: EngineKind;
  /** The API key in use (the Keychain's, else the environment's); null: none. */
  key: string | null;
  /** The `claude` to run. */
  bin: string;
}

/** Which engine: what was chosen on this computer, else the environment's (never Claude Code on Vercel). */
export function resolveEngine(chosen: EngineKind | undefined, env: { AI_BACKEND?: string; VERCEL?: string }): EngineKind {
  if (env.VERCEL) return "api";
  return chosen ?? (env.AI_BACKEND === "cli" ? "cli" : "api");
}

// One state per process, whichever copy of this module reads it (the dev server reloads routes).
const g = globalThis as { __qalamEngine?: EngineState };
const state = (): EngineState =>
  (g.__qalamEngine ??= { kind: resolveEngine(undefined, process.env), key: process.env.ANTHROPIC_API_KEY || null, bin: process.env.CLAUDE_CLI_PATH || "claude" });

export const backend = (): EngineKind => state().kind;
export const apiKey = (): string | null => state().key;
export const bin = (): string => state().bin;

/** The server's view of this computer (server/engine.ts). */
export function setEngineState(patch: Partial<EngineState>) {
  g.__qalamEngine = { ...state(), ...patch };
}
