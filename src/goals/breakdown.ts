import type { OstMetric } from "@/discovery/types";
import { checkWords, sameTopic } from "@/hub/topics";
import type { PackedPiece } from "@/org/pack";
import { metricLine } from "./goals-md";
import type { Relation } from "./math";
import type { Benchmark, Outside } from "./outside";
import { metricFrom } from "./said";
import { chainOf, childrenOf } from "./tree";
import { GOAL_LEVERS, LEVER_LABEL, type Goal, type GoalLever, type GoalTree } from "./types";

/*
 * Break a goal down (pure): Qalam AI proposes the goals under it, each on a lever (new customers,
 * first value, coming back, won back, spend, referrals, cost), how it feeds the goal, and what it
 * rests on in the team's own material. Code keeps a part only when what it cites was sent and its
 * words and numbers are in it (or in the goals above); a number only from their words. What others
 * report shows beside a part, as theirs, never as its number. Whether the parts' numbers make the
 * goal's is code's arithmetic (./math.ts).
 */

export interface BreakdownPart {
  id: string;
  title: string;
  lever: GoalLever;
  /** How it feeds the goal, in one line. */
  why: string;
  metric: OstMetric | null;
  /** Their pieces it rests on (refs). */
  cites: string[];
  /** What others report that bears on it. */
  benchmarks: Benchmark[];
}

export interface Breakdown {
  at: number;
  /** The levers they asked to look at (their answer; none: left to Qalam AI). */
  levers: GoalLever[];
  parts: BreakdownPart[];
  /** How the parts' numbers make the goal's, when they do. */
  relation: Relation | null;
  /** What would help, when nothing could be proposed. */
  none: string;
  decided: Record<string, "accepted" | "discarded">;
}

/** A goal's work in progress (hub/goals/<goal>.json): what others report for it, and the goals proposed under it. */
export interface GoalWork {
  outside?: Outside;
  breakdown?: Breakdown;
}

export const BREAKDOWN_LIMITS = { parts: 5, title: 100, why: 240 } as const;

export interface BreakdownSent {
  text: string;
  /** Their pieces, as the call names them (k1…). */
  pieces: Map<string, PackedPiece>;
  /** What others report, as the call names them (o1…). */
  benchmarks: Map<string, Benchmark>;
  /** The goals above it and the goal itself, in words and numbers: what a part may also rest on. */
  chain: string;
  children: Goal[];
}

const one = (s: string) => s.replace(/\s+/g, " ").trim();
const numberOf = (g: Goal) => (g.metric ? ` · ${[g.metric.name, metricLine(g.metric)].filter(Boolean).join(": ")}` : " · no number yet");

/**
 * The material: the goal under the goals it feeds, the goals under it already, what the
 * organization and the product say, the levers they asked about, their material (a pack anchored
 * on the goal, k1…) and what others report (o1…).
 */
export function breakdownMaterial(o: { tree: GoalTree; goal: Goal; productName?: string; context: string; pack: { block: string; pieces: PackedPiece[] } | null; benchmarks: Benchmark[]; levers: GoalLever[] }): BreakdownSent {
  const chain = chainOf(o.tree, o.goal.id).reverse();
  const children = childrenOf(o.tree, o.goal.id);
  const benchmarks = new Map(o.benchmarks.map((b, i) => [`o${i + 1}`, b]));
  const lines = [
    "The goal, under the goals it feeds:",
    ...chain.map((g, depth) => `${"  ".repeat(depth)}- ${g.id === o.tree.north ? "North Star: " : ""}${one(g.title)}${numberOf(g)}${g.id === o.goal.id ? `   ← this goal${o.productName ? ` (${o.productName})` : ""}` : ""}`),
    "",
    children.length ? "Goals under it already (don't propose these again):" : "No goals under it yet.",
    ...children.map((c) => `- ${one(c.title)}${numberOf(c)}`),
    "",
    "What the organization and the product say:",
    o.context.trim() || "(nothing yet)",
    "",
    o.levers.length ? `What they asked to look at: ${o.levers.map((l) => LEVER_LABEL[l]).join(", ")}` : "They left which levers to you.",
    `The levers (id · what): ${GOAL_LEVERS.map((l) => `${l} · ${LEVER_LABEL[l]}`).join("; ")}`,
    "",
    o.pack ? "Their own material, by id:" : "Their own material: (none found)",
    ...(o.pack ? [o.pack.block] : []),
    "",
    benchmarks.size ? "What others report, checked on each page (id · who · what: number · their words):" : "What others report: (nothing looked up yet)",
    ...[...benchmarks].map(([id, b]) => `- ${id} · ${one(b.who)} · ${one(b.what)}: ${b.value}${b.unit === "%" ? "%" : b.unit ? ` ${b.unit}` : ""} · “${one(b.quote)}”`),
  ];
  return {
    text: lines.join("\n"),
    pieces: new Map((o.pack?.pieces ?? []).map((p) => [p.k, p])),
    benchmarks,
    chain: chain.map((g) => `${g.title}${numberOf(g)}${g.metric ? ` ${g.metric.baseline ?? ""} ${g.metric.current ?? ""} ${g.metric.target ?? ""}` : ""}`).join("\n"),
    children,
  };
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const strs = (v: unknown): string[] => [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string").map((x) => x.trim()))];

/**
 * What code keeps: parts it can stand behind, none twice and none a goal under it already, each
 * resting on what it cites (its words and numbers in it or in the goals above), its number only
 * from their words. `dropped` hears each part left out and why.
 */
export function sanitizeBreakdown(raw: unknown, m: BreakdownSent, o: { now: number; id: () => string }, dropped?: (why: string, item: unknown) => void): Pick<Breakdown, "parts" | "relation" | "none"> {
  const parts: BreakdownPart[] = [];
  const drop = (why: string, x: unknown) => void dropped?.(why, x);
  for (const x of Array.isArray(rec(raw).parts) ? (rec(raw).parts as unknown[]) : []) {
    if (parts.length >= BREAKDOWN_LIMITS.parts) {
      drop("over the limit", x);
      continue;
    }
    const p = rec(x);
    const lever = GOAL_LEVERS.find((l) => l === p.lever);
    if (!lever) {
      drop("not a lever", x);
      continue;
    }
    const cited = strs(p.cites).flatMap((k) => m.pieces.get(k) ?? []);
    const title = checkWords(p.title, cited, m.chain, BREAKDOWN_LIMITS.title);
    // Its reason rests on their words and the goals' numbers: what others report shows beside it, never in it.
    const why = checkWords(p.why, cited, m.chain, BREAKDOWN_LIMITS.why);
    if (!title || !why) {
      drop("its words or numbers aren't in what it cites", x);
      continue;
    }
    if (m.children.some((c) => sameTopic(c.title, title)) || parts.some((y) => sameTopic(y.title, title))) {
      drop("a goal under it already, or there twice", x);
      continue;
    }
    const read = metricFrom(p.metric, cited.map((c) => c.text).join("\n"));
    const metric = read && !read.name ? { ...read, name: title } : read;
    parts.push({ id: o.id(), title, lever, why, metric, cites: cited.map((c) => c.ref), benchmarks: strs(p.benchmarks).flatMap((id) => m.benchmarks.get(id) ?? []) });
  }
  const r = rec(raw);
  const relation = r.relation === "product" || r.relation === "sum" ? r.relation : null;
  return { parts, relation, none: typeof r.none === "string" ? one(r.none).slice(0, 300) : "" };
}
