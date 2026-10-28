import { modelFamily, type CallKind } from "./models";

/*
 * What Qalam AI used, call by call, kept per computer (server/usage.ts) and summed up for the Claude
 * card in Connections, by model and by job. Tokens are what the engine reported; cost only where it
 * reported one (Claude Code estimates it; the API doesn't say). Browser-safe: no secrets here.
 */

export interface UsageEntry {
  at: number;
  engine: "cli" | "api";
  model: string;
  /** What the call was for (src/ai/models.ts); none: a call without one (the design side). */
  kind?: CallKind;
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

export interface UsageTotals {
  calls: number;
  /** Tokens in (cache reads and writes included) and out. */
  input: number;
  output: number;
  /** Summed over the calls that reported one; null when none did. */
  cost: number | null;
}

export interface UsageSummary extends UsageTotals {
  /** Calls each day, oldest first; the last is today. */
  days: number[];
  /** By model family ("Opus", "Sonnet", "Haiku"), most calls first. */
  byModel: (UsageTotals & { model: string })[];
  /** By job and model family ("other": calls with no kind), most calls first. */
  byKind: (UsageTotals & { kind: CallKind | "other"; model: string })[];
}

const DAY = 86_400_000;

const add = (t: UsageTotals, e: UsageEntry) => {
  t.calls++;
  t.input += e.input + e.cacheRead + e.cacheWrite;
  t.output += e.output;
  if (e.cost !== null) t.cost = (t.cost ?? 0) + e.cost;
};

export function summarizeUsage(entries: UsageEntry[], now: number, days = 7): UsageSummary {
  const from = now - days * DAY;
  const out: UsageSummary = { calls: 0, input: 0, output: 0, cost: null, days: new Array<number>(days).fill(0), byModel: [], byKind: [] };
  const models = new Map<string, UsageSummary["byModel"][number]>();
  const kinds = new Map<string, UsageSummary["byKind"][number]>();
  for (const e of entries) {
    if (e.at <= from || e.at > now) continue;
    add(out, e);
    out.days[Math.min(days - 1, Math.floor((e.at - from) / DAY))]++;
    const model = modelFamily(e.model);
    const kind = e.kind ?? "other";
    if (!models.has(model)) models.set(model, { model, calls: 0, input: 0, output: 0, cost: null });
    if (!kinds.has(`${kind} ${model}`)) kinds.set(`${kind} ${model}`, { kind, model, calls: 0, input: 0, output: 0, cost: null });
    add(models.get(model)!, e);
    add(kinds.get(`${kind} ${model}`)!, e);
  }
  out.byModel = [...models.values()].sort((a, b) => b.calls - a.calls);
  out.byKind = [...kinds.values()].sort((a, b) => b.calls - a.calls);
  return out;
}

/** "12.4k", "1.2M": a token count, short. */
export function shortCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
