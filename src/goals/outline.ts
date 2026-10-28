import type { OstMetric } from "@/discovery/types";
import { nameHolds } from "@/org/setup";
import { metricFrom, wordsHold } from "./said";

/*
 * Goals as a person writes them down (pure): one per line, the North Star first, each indented
 * under the goal it feeds. Qalam AI reads each line into a goal Qalam can track (its title, the
 * product it's for, its number); code keeps a title only in the line's words, a number only where
 * the line or their answer has it, and a new product only under a name they used. Where a goal
 * sits in the tree is the outline's, never the model's.
 */

export interface OutlineGoal {
  /** How the call names it (o1…). */
  ref: string;
  text: string;
  /** The line it's indented under (its ref). */
  parent: string | null;
}

export const OUTLINE_LIMITS = { goals: 30, line: 200, title: 120, name: 80 } as const;

const BULLET = /^(?:[-*+•]|\d+[.)])\s+/;

/**
 * The goals in an outline. Indentation (two spaces or a tab a level, or a bullet's) puts a line
 * under the nearest line above it that's less indented. Lines all at one level read as the North
 * Star (the first) and the goals that feed it.
 */
export function readOutline(text: string): OutlineGoal[] {
  const rows: { text: string; indent: number }[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const indent = (raw.match(/^[ \t]*/)?.[0] ?? "").replace(/\t/g, "  ").length;
    const words = raw.trim().replace(BULLET, "").replace(/\s+/g, " ").trim();
    if (words) rows.push({ text: words.slice(0, OUTLINE_LIMITS.line), indent });
    if (rows.length >= OUTLINE_LIMITS.goals) break;
  }
  const flat = rows.length > 1 && rows.every((r) => r.indent === rows[0].indent);
  const out: OutlineGoal[] = [];
  const open: { indent: number; ref: string }[] = [];
  rows.forEach((r, i) => {
    const ref = `o${i + 1}`;
    if (flat) return void out.push({ ref, text: r.text, parent: i ? "o1" : null });
    while (open.length && open[open.length - 1].indent >= r.indent) open.pop();
    out.push({ ref, text: r.text, parent: open[open.length - 1]?.ref ?? null });
    open.push({ indent: r.indent, ref });
  });
  return out;
}

/** What a person could still say about a goal's number. */
export type Missing = "number" | "today" | "target" | "when";

export interface ShapedGoal {
  ref: string;
  title: string;
  parent: string | null;
  /** A product the organization has (its id), one they named (made when they add it), or the whole organization (null). */
  product: { id: string } | { name: string } | null;
  metric: OstMetric | null;
  missing: Missing[];
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const fold = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** What's still unsaid about a goal's number. */
export function missingOf(m: OstMetric | null): Missing[] {
  if (!m?.name) return ["number"];
  return [...(m.baseline === null && m.current === null ? (["today"] as const) : []), ...(m.target === null ? (["target"] as const) : []), ...(!m.timeframe ? (["when"] as const) : [])];
}

/**
 * The goals as code keeps them: each outline line once, in its place, titled in its own words
 * (else as written), its number only where the line or the answer about it says so.
 */
export function sanitizeShaped(raw: unknown, o: { goals: OutlineGoal[]; products: { ref: string; id: string; name: string }[]; answers: ReadonlyMap<string, string> }): ShapedGoal[] {
  const items = new Map<string, Record<string, unknown>>();
  for (const x of Array.isArray(rec(raw).goals) ? (rec(raw).goals as unknown[]) : []) {
    const v = rec(x);
    if (typeof v.id === "string" && !items.has(v.id)) items.set(v.id, v);
  }
  return o.goals.map((g): ShapedGoal => {
    const v = items.get(g.ref) ?? {};
    const said = [g.text, o.answers.get(g.ref) ?? ""].join("\n");
    const title = clip(v.title, OUTLINE_LIMITS.title);
    const product = (() => {
      const p = typeof v.product === "string" ? v.product.trim() : "";
      const there = o.products.find((x) => x.ref === p);
      if (there) return { id: there.id };
      const name = clip(v.productName, OUTLINE_LIMITS.name);
      if (p !== "new" || !name) return null;
      // A product they have already, named rather than pointed at.
      const named = o.products.find((x) => fold(x.name) === fold(name));
      return named ? { id: named.id } : nameHolds(name, said) ? { name } : null;
    })();
    const kept = title && wordsHold(title, g.text) ? title : g.text.slice(0, OUTLINE_LIMITS.title);
    const read = metricFrom(v.metric, said);
    // Numbers they gave, with no measure named in their words: the goal's own words name it.
    const metric = read && !read.name ? { ...read, name: kept } : read;
    return { ref: g.ref, title: kept, parent: g.parent, product, metric, missing: missingOf(metric) };
  });
}

/** The goals without one (its children move up to the goal it fed). */
export function withoutGoal(list: ShapedGoal[], ref: string): ShapedGoal[] {
  const gone = list.find((g) => g.ref === ref);
  return list.filter((g) => g.ref !== ref).map((g) => (g.parent === ref ? { ...g, parent: gone?.parent ?? null } : g));
}
