import { checkWords, sameTopic } from "@/hub/topics";
import type { OstMetric } from "@/discovery/types";
import { metricFrom } from "./said";

/*
 * Goals a document points to (pure). The reader may propose them as it reads, each resting on the
 * document's own points; nothing goes in goals.md until the person accepts it. A goal is a choice, so
 * code keeps one only where the team's own words state an aim or measure the thing: what a customer
 * wishes for is a problem, and what a report says of others is theirs. Its words and numbers must be
 * in what it cites, a number on it only as that says it, and it isn't one they have already.
 */

export const FOUND_LIMITS = { perSource: 3, title: 120 } as const;

export interface FoundGoal {
  id: string;
  title: string;
  metric?: OstMetric;
  /** The points it rests on (ids in the source's quotes). */
  cites: string[];
  /** What the person decided, and the goal an acceptance made. */
  state?: "accepted" | "left";
  goal?: string;
}

/** A point the call kept, under the id it gave it. */
export interface KeptPoint {
  id: string;
  text: string;
  basis?: string;
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function sanitizeFoundGoals(raw: unknown, kept: ReadonlyMap<string, KeptPoint>, known: readonly string[], newId: () => string, fold?: (s: string) => string): FoundGoal[] {
  const out: FoundGoal[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (out.length >= FOUND_LIMITS.perSource) break;
    const g = rec(item);
    const points = (Array.isArray(g.quoteIds) ? g.quoteIds : []).flatMap((r) => kept.get(String(r)) ?? []);
    // The team's own aim, or a number it tracks: a customer's wish or someone else's report isn't a goal of theirs.
    if (!points.some((p) => p.basis === "own" || p.basis === "measured")) continue;
    const said = points.map((p) => p.text).join("\n");
    const title = checkWords(typeof g.title === "string" ? g.title.replace(/\s+/g, " ").trim() : "", points, "", FOUND_LIMITS.title);
    if (!title || [...known, ...out.map((x) => x.title)].some((t) => sameTopic(t, title, fold))) continue;
    const metric = metricFrom(g.metric, said);
    out.push({ id: newId(), title, ...(metric?.name ? { metric } : {}), cites: [...new Set(points.map((p) => p.id))] });
  }
  return out;
}

/** A found goal's number in words: "Weekly orders: 5,780 → 8,000". */
export function foundNumber(m: OstMetric | undefined): string {
  if (!m) return "";
  const n = (x: number | null) => (x === null ? null : x.toLocaleString("en-US"));
  const now = n(m.current);
  const target = n(m.target);
  return `${m.name}${now || target ? `: ${now ?? "?"}${target ? ` → ${target}` : ""}` : ""}`;
}
