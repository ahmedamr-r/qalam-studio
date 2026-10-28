import type { Hit, ToolCall } from "./recipes";

/*
 * An outcome's number from a saved insight in PostHog (pure). Through Claude Code's PostHog server:
 * its one tool, `exec`, runs `call --json insights-list` to pick an insight and `call --json
 * insight-query` to run it. Code reads the number from what PostHog returns (an insight's total,
 * else its latest point; a funnel's conversion; one SQL value), never from the model.
 */

const CONTEXT = "Reading a saved insight's number so a product team's outcome card shows where it stands.";

/** PostHog's tool calls: its `exec`, with the arguments it requires. */
// PostHog's tool asks the model for its own name and a reason, so only the command must be as planned.
export const posthogSearch = (query: string): ToolCall => ({ tool: "exec", args: { command: `call --json insights-list ${JSON.stringify({ search: query, limit: 20, saved: true })}`, context: CONTEXT, llm_model: "unknown" }, match: ["command"] });
export const posthogRead = (ref: string): ToolCall => ({ tool: "exec", args: { command: `call --json insight-query ${JSON.stringify({ insightId: ref })}`, context: CONTEXT, llm_model: "unknown" }, match: ["command"] });

/** The first JSON value in a tool's answer (PostHog adds a second, its conversation id). */
export function firstJson(text: string): unknown {
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Saved insights as picks. */
export function insightHits(text: string): Hit[] {
  const j = firstJson(text) as { results?: Record<string, unknown>[] } | null;
  return (j?.results ?? []).flatMap((r) => {
    const id = str(r.short_id) ?? (num(r.id) !== undefined ? String(r.id) : undefined);
    if (!id) return [];
    const title = str(r.name) ?? str(r.derived_name) ?? "Untitled insight";
    return [{ id, title, ...(str(r._posthogUrl) ? { url: str(r._posthogUrl) } : {}), ...(str(r.description) ? { snippet: str(r.description)!.slice(0, 160) } : {}) }];
  });
}

export interface InsightNumbers {
  name?: string;
  url?: string;
  /** One number per series ("Readers who unlocked · /pricing"); empty when there's no one number to read. */
  series: { label: string; value: number }[];
  /** A funnel's steps, each with how many reached it (its first breakdown's, when it has several). */
  steps?: { label: string; count: number }[];
}

/** The numbers in an insight's results. */
export function insightNumbers(text: string): InsightNumbers {
  const j = firstJson(text) as { query?: { kind?: string }; insight?: { name?: string; url?: string }; results?: unknown; _posthogUrl?: string } | null;
  const out: InsightNumbers = { ...(str(j?.insight?.name) ? { name: str(j?.insight?.name) } : {}), ...(str(j?._posthogUrl) ?? str(j?.insight?.url) ? { url: str(j?._posthogUrl) ?? str(j?.insight?.url) } : {}), series: [] };
  const results = j?.results;
  if (!Array.isArray(results)) return out;
  const kind = j?.query?.kind;
  if (kind === "FunnelsQuery") {
    // Steps, or one list of steps per breakdown: the conversion from the first step to the last.
    const lists = (Array.isArray(results[0]) ? results : [results]) as Record<string, unknown>[][];
    const counted = (lists[0] ?? []).flatMap((s) => (num(s?.count) !== undefined ? [{ label: str(s.custom_name) ?? str(s.name) ?? "A step", count: num(s.count)! }] : []));
    if (counted.length >= 2) out.steps = counted;
    for (const steps of lists) {
      const first = num(steps[0]?.count);
      const last = num(steps[steps.length - 1]?.count);
      if (first && last !== undefined) {
        const breakdown = steps[0]?.breakdown_value;
        out.series.push({ label: `Conversion${Array.isArray(breakdown) && breakdown.length ? ` · ${breakdown.join(", ")}` : ""}`, value: Math.round((1000 * last) / first) / 10 });
      }
    }
    return out;
  }
  if (kind === "HogQLQuery") {
    const row = results[0];
    const v = Array.isArray(row) ? num(row[0]) : undefined;
    if (v !== undefined) out.series.push({ label: "Value", value: v });
    return out;
  }
  for (const r of results as Record<string, unknown>[]) {
    if (!r || typeof r !== "object") continue;
    const data = Array.isArray(r.data) ? (r.data as unknown[]).filter((x): x is number => num(x) !== undefined) : [];
    // A total (a number shown on its own) when there is one, else the latest point.
    const value = num(r.aggregated_value) ?? (data.length ? data[data.length - 1] : undefined);
    if (value === undefined) continue;
    const action = (r.action ?? {}) as { custom_name?: unknown; name?: unknown };
    const name = str(action.custom_name) ?? str(action.name) ?? str(r.label) ?? "Series";
    const breakdown = Array.isArray(r.breakdown_value) ? (r.breakdown_value as unknown[]).map(String).join(", ") : str(r.breakdown_value);
    out.series.push({ label: breakdown ? `${name} · ${breakdown}` : name, value });
  }
  return out;
}
