/*
 * What Qalam AI used, call by call, kept per computer (server/usage.ts) and summed up for the Claude
 * card in Connections. Tokens are what the engine reported; cost only where it reported one
 * (Claude Code estimates it; the API doesn't say). Browser-safe: no secrets here.
 */

export interface UsageEntry {
  at: number;
  engine: "cli" | "api";
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** In dollars, as the engine reported it; null when it didn't. */
  cost: number | null;
  ms?: number;
  /** The organization the call was for, when known. */
  org?: string;
}

export interface UsageSummary {
  calls: number;
  /** Tokens in (cache reads and writes included) and out. */
  input: number;
  output: number;
  /** Summed over the calls that reported one; null when none did. */
  cost: number | null;
  /** Calls each day, oldest first; the last is today. */
  days: number[];
}

const DAY = 86_400_000;

export function summarizeUsage(entries: UsageEntry[], now: number, days = 7): UsageSummary {
  const from = now - days * DAY;
  const out: UsageSummary = { calls: 0, input: 0, output: 0, cost: null, days: new Array<number>(days).fill(0) };
  for (const e of entries) {
    if (e.at <= from || e.at > now) continue;
    out.calls++;
    out.input += e.input + e.cacheRead + e.cacheWrite;
    out.output += e.output;
    if (e.cost !== null) out.cost = (out.cost ?? 0) + e.cost;
    out.days[Math.min(days - 1, Math.floor((e.at - from) / DAY))]++;
  }
  return out;
}

/** "12.4k", "1.2M": a token count, short. */
export function shortCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
