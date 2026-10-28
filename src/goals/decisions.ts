import { metricOf, num, q, stageLine } from "@/decisions/diff";
import type { Decision } from "@/decisions/model";
import { goalById } from "./tree";
import type { Goal, GoalTree } from "./types";

/*
 * The decisions in a change to the goal tree (pure), found by comparing it before and after, as a
 * board's are: a goal's target, a number that moved by hand (a reading from an analytics tool is a
 * reading, not a decision), its status, the goal it feeds, a new North Star, a goal taken off.
 * Adding a goal or rewording one isn't a decision. Each is recorded under the board "goals", the
 * goal as its card, so the log, its file and its readers stay as they are.
 */

export const GOALS_BOARD = "goals";

export interface GoalDecisionContext {
  now: number;
  by?: Decision["by"];
  newId: () => string;
}

export function goalDecisions(before: GoalTree, after: GoalTree, ctx: GoalDecisionContext): Decision[] {
  const out: Decision[] = [];
  const make = (g: Goal, d: Pick<Decision, "kind" | "what" | "big"> & { detail?: Record<string, unknown> }): Decision => ({
    id: ctx.newId(),
    at: ctx.now,
    board: GOALS_BOARD,
    boardName: "Goals",
    product: g.product,
    card: g.id,
    cardTitle: g.title,
    cardKind: "outcome",
    goal: g.id,
    by: ctx.by ?? "you",
    ...d,
    ...(g.metric ? { knew: { evidence: "", pieces: [], against: 0, metric: g.metric } } : {}),
  });
  const title = (t: GoalTree, id: string | null) => goalById(t, id)?.title ?? "";

  for (const b of before.goals) {
    const a = goalById(after, b.id);
    if (!a) {
      out.push(make(b, { kind: "drop", what: `Took the goal ${q(b.title)} off`, detail: { parent: b.parent, ...(b.parent ? { parentTitle: title(before, b.parent) } : {}) }, big: true }));
      continue;
    }
    if (a.status !== b.status) out.push(make(a, { kind: "stage", what: stageLine("outcome", a.title, b.status, a.status), detail: { from: b.status, to: a.status }, big: false }));
    if (a.parent !== b.parent) {
      // Placing a goal that fed nothing yet is setting the tree up; moving it from one goal to another is a decision.
      const to = a.parent ? title(after, a.parent) : "";
      out.push(
        make(a, {
          kind: "move",
          what: a.parent ? `Put ${q(a.title)} under ${q(to)}` : `Took ${q(a.title)} out from under ${q(title(before, b.parent))}`,
          detail: { from: b.parent, fromTitle: b.parent ? title(before, b.parent) : null, to: a.parent, toTitle: a.parent ? to : null },
          big: !!b.parent && !!a.parent,
        }),
      );
    }
    const bm = b.metric;
    const am = a.metric;
    if (bm && am) {
      if (bm.target !== am.target) out.push(make(a, { kind: "metric", what: `Changed the target of ${q(a.title)} from ${num(bm.target, am.unit)} to ${num(am.target, am.unit)}`, detail: { field: "target", from: bm.target, to: am.target, metric: metricOf(am) }, big: true }));
      if (bm.current !== am.current && am.readAt === bm.readAt)
        out.push(make(a, { kind: "metric", what: `${q(a.title)} is at ${num(am.current, am.unit)} now (was ${num(bm.current, am.unit)})`, detail: { field: "current", from: bm.current, to: am.current, metric: metricOf(am) }, big: false }));
    }
  }
  if (after.north && after.north !== before.north) {
    const g = goalById(after, after.north)!;
    out.push(make(g, { kind: "target", what: before.north ? `Made ${q(g.title)} the North Star, instead of ${q(title(before, before.north))}` : `Made ${q(g.title)} the North Star`, detail: { north: true, from: before.north, to: after.north }, big: !!before.north }));
  }
  return out;
}
