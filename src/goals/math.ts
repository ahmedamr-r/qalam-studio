import type { OstMetric } from "@/discovery/types";

/*
 * Whether a goal's parts add up (pure): code, never Qalam AI, does the arithmetic. A goal whose
 * number is the product of its parts' (orders a month = active customers × orders each × order
 * value) or their sum (active customers = new + kept + won back) is checked wherever every number
 * is there: where things stand now, and at the targets. A rate in % multiplies as a fraction.
 */

export type Relation = "product" | "sum";

export interface PartsCheck {
  relation: Relation;
  /** Now: the parts' combined number against the goal's. */
  now: { combined: number; goal: number; holds: boolean } | null;
  /** The targets: whether the parts' reach the goal's. */
  target: { combined: number; goal: number; reaches: boolean } | null;
  /** What it found, in words. */
  line: string;
}

const TOLERANCE = 0.05;

const fmt = (n: number) => (Math.abs(n) >= 1000 || Number.isInteger(n) ? Math.round(n).toLocaleString("en-US") : Number(n.toPrecision(3)).toString());
const shown = (v: number, m: OstMetric) => (m.unit === "%" ? `${fmt(v)}%` : `${fmt(v)}${m.unit ? ` ${m.unit}` : ""}`);

export function checkParts(goal: OstMetric | null | undefined, parts: (OstMetric | null | undefined)[], relation: Relation): PartsCheck | null {
  if (!goal || parts.length < 2) return null;
  // A rate multiplies as a fraction; a sum adds numbers as they are.
  const scale = (m: OstMetric, v: number) => (relation === "product" && m.unit === "%" ? v / 100 : v);
  const back = (v: number) => (relation === "product" && goal.unit === "%" ? v * 100 : v);
  const combine = (xs: number[]) => (relation === "product" ? xs.reduce((a, b) => a * b, 1) : xs.reduce((a, b) => a + b, 0));
  const sign = relation === "product" ? " × " : " + ";
  const valued = (pick: (m: OstMetric) => number | null) => {
    const vs = parts.map((m) => (m ? pick(m) : null));
    return vs.every((v): v is number => v !== null) ? vs : null;
  };
  const nowOf = (m: OstMetric) => m.current ?? m.baseline;

  const nowParts = valued(nowOf);
  const goalNow = nowOf(goal);
  const now =
    nowParts && goalNow !== null
      ? (() => {
          const combined = back(combine(nowParts.map((v, i) => scale(parts[i]!, v))));
          return { combined, goal: goalNow, holds: Math.abs(combined - goalNow) <= TOLERANCE * Math.abs(goalNow || 1) };
        })()
      : null;
  const targetParts = valued((m) => m.target);
  const target =
    targetParts && goal.target !== null
      ? (() => {
          const combined = back(combine(targetParts.map((v, i) => scale(parts[i]!, v))));
          const up = goal.direction !== "decrease";
          return { combined, goal: goal.target!, reaches: up ? combined >= goal.target! * (1 - TOLERANCE) : combined <= goal.target! * (1 + TOLERANCE) };
        })()
      : null;

  const lines: string[] = [];
  if (now && nowParts) lines.push(`Now ${nowParts.map((v, i) => shown(v, parts[i]!)).join(sign)} = ${shown(now.combined, goal)}, ${now.holds ? "the goal's number" : `but the goal's number is ${shown(now.goal, goal)}`}.`);
  if (target && targetParts) lines.push(`At their targets ${targetParts.map((v, i) => shown(v, parts[i]!)).join(sign)} = ${shown(target.combined, goal)}, ${target.reaches ? `which reaches the goal's ${shown(target.goal, goal)}` : `short of the goal's ${shown(target.goal, goal)}`}.`);
  if (!lines.length) lines.push("Code checks the arithmetic once every part has its number.");
  return { relation, now, target, line: lines.join(" ") };
}
