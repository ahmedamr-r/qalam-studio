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

/** An API call's usage (the API reports no cost). */
export function fromApiUsage(u: ApiUsage | null | undefined, model: string, now = Date.now()): UsageEntry | null {
  if (!u) return null;
  return { at: now, engine: "api", model, input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cost: null };
}

/** What Claude Code's result line reports: its usage, and its own estimate of the cost. */
export function fromCliResult(r: { usage?: unknown; total_cost_usd?: unknown; duration_ms?: unknown } | null | undefined, model: string, now = Date.now()): UsageEntry | null {
  if (!r?.usage || typeof r.usage !== "object") return null;
  const u = r.usage as ApiUsage;
  return {
    ...fromApiUsage(u, model, now)!,
    engine: "cli",
    cost: typeof r.total_cost_usd === "number" ? r.total_cost_usd : null,
    ...(typeof r.duration_ms === "number" ? { ms: r.duration_ms } : {}),
  };
}
