import type { EngineKind } from "./engine-kinds";
import type { CallKind } from "./models";
import type { UsageEntry } from "./usage-shared";

/*
 * Reporting what each call used (server-only). The calls report here; the server keeps the entries
 * on this computer (server/usage.ts subscribes with onUsage). Nothing listening: nothing kept.
 */

let sink: ((e: UsageEntry) => void) | null = null;

export const onUsage = (fn: (e: UsageEntry) => void) => void (sink = fn);

export function reportUsage(e: UsageEntry | null) {
  if (!e) return;
  try {
    sink?.(e);
  } catch {
    // Keeping count must never break a call.
  }
}

interface ApiUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** An API call's usage (the API reports no cost), labelled with what the call was for. */
export function fromApiUsage(u: ApiUsage | null | undefined, model: string, kind?: CallKind, now = Date.now()): UsageEntry | null {
  if (!u) return null;
  return { at: now, engine: "api", model, ...(kind ? { kind } : {}), input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cost: null };
}

interface ChatUsage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  prompt_tokens_details?: { cached_tokens?: number | null } | null;
  /** OpenRouter's own figure, in dollars, when asked for. */
  cost?: number | null;
}

/** An OpenAI-style chat answer's usage: its tokens, what was read from cache, and a cost only where the engine said (OpenRouter), or none for a model on this computer. */
export function fromChatUsage(u: ChatUsage | null | undefined, engine: EngineKind, model: string, kind?: CallKind, now = Date.now()): UsageEntry | null {
  if (!u) return null;
  const local = engine === "ollama" || engine === "lmstudio";
  return { at: now, engine, model, ...(kind ? { kind } : {}), input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, cacheRead: u.prompt_tokens_details?.cached_tokens ?? 0, cacheWrite: 0, cost: local ? 0 : typeof u.cost === "number" ? u.cost : null };
}

/** What Codex's `turn.completed` line reports. */
export interface CodexUsage {
  input_tokens?: number | null;
  cached_input_tokens?: number | null;
  output_tokens?: number | null;
}

/** A Codex call's usage: its tokens and what was read from cache. The ChatGPT plan pays, so no cost. */
export function fromCodexUsage(u: CodexUsage | null | undefined, model: string, kind?: CallKind, now = Date.now()): UsageEntry | null {
  if (!u) return null;
  return { at: now, engine: "codex", model, ...(kind ? { kind } : {}), input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cached_input_tokens ?? 0, cacheWrite: 0, cost: null };
}

/** What Claude Code's result line reports: its usage, and its own estimate of the cost. */
export function fromCliResult(r: { usage?: unknown; total_cost_usd?: unknown; duration_ms?: unknown } | null | undefined, model: string, kind?: CallKind, now = Date.now()): UsageEntry | null {
  if (!r?.usage || typeof r.usage !== "object") return null;
  const u = r.usage as ApiUsage;
  return {
    ...fromApiUsage(u, model, kind, now)!,
    engine: "cli",
    cost: typeof r.total_cost_usd === "number" ? r.total_cost_usd : null,
    ...(typeof r.duration_ms === "number" ? { ms: r.duration_ms } : {}),
  };
}
