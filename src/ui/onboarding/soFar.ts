import type { ShapedGoal } from "@/goals/outline";
import { metricLine } from "@/goals/goals-md";
import { childrenOf, goalById } from "@/goals/tree";
import type { GoalTree } from "@/goals/types";
import type { Product } from "@/org/context-md";
import { goalLines, pendingLines, type SetupLine, type SetupSession } from "@/org/setup";
import { groupsOf, placeName } from "../setup/review";

/*
 * The "{org} so far" panel as data (pure): the goals as one tree, then the About and each product.
 * While Qalam AI proposes, its lines (each with what it rests on) are what's reviewed here; while
 * they write their own, the tree they'll add; otherwise the goals as they are.
 */

export type RowState = "proposed" | "accepted" | "discarded" | "kept";

export interface RestsOn {
  quotes: string[];
  answers: { question: string; answer: string }[];
}

export interface GoalRow {
  key: string;
  title: string;
  depth: number;
  north: boolean;
  /** Where it goes and its number, in a line. */
  detail: string;
  state: RowState;
  /** A proposed line (accept, discard). */
  lineId?: string;
  /** A goal they wrote (leave out). */
  ref?: string;
  /** A goal there now (pick it as theirs). */
  goalId?: string;
  rests?: RestsOn;
}

export interface LineRow {
  id: string;
  label: string;
  text: string;
  state: RowState;
  rests: RestsOn;
}

export interface SoFar {
  /** proposal: Qalam AI's lines · know: the goals they wrote · tree: the goals as they are. */
  from: "proposal" | "know" | "tree" | "none";
  goals: GoalRow[];
  groups: { key: string; title: string; fresh: boolean; lines: LineRow[] }[];
  /** Lines still to settle. */
  open: string[];
}

export interface SoFarInput {
  org: string;
  session: SetupSession | null;
  quotes: readonly { id: string; text: string }[];
  products: readonly Product[];
  know: { phase: string; goals: ShapedGoal[] } | null;
  tree: GoalTree;
  /** What the organization says about itself now. */
  about: { context: string; audience: string };
}

const rests = (l: SetupLine, quotes: SoFarInput["quotes"]): RestsOn => ({ quotes: l.pieces.flatMap((id) => quotes.find((q) => q.id === id)?.text ?? []), answers: l.answers });

const stateOf = (s: SetupSession, id: string): RowState => s.decided?.[id] ?? "proposed";

/** The goals there now, in tree order, each with how deep it sits. */
export function treeRows(t: GoalTree): { id: string; title: string; depth: number; line: string; north: boolean }[] {
  const out: { id: string; title: string; depth: number; line: string; north: boolean }[] = [];
  const seen = new Set<string>();
  const walk = (id: string, depth: number) => {
    const g = goalById(t, id);
    if (!g || seen.has(id)) return;
    seen.add(id);
    out.push({ id, title: g.title, depth, line: g.metric ? metricLine(g.metric) : "", north: id === t.north });
    childrenOf(t, id).forEach((c) => walk(c.id, depth + 1));
  };
  t.goals.filter((g) => !g.parent).forEach((g) => walk(g.id, 0));
  return out;
}

function knowRows(goals: ShapedGoal[], products: readonly Product[]): GoalRow[] {
  const depth = (g: ShapedGoal) => {
    let n = 0;
    for (let p = g.parent; p && n < 20; p = goals.find((x) => x.ref === p)?.parent ?? null) n++;
    return n;
  };
  const top = goals.find((g) => !g.parent);
  return goals.map((g) => {
    const north = g === top;
    const where = !g.product ? null : "id" in g.product ? (products.find((p) => p.id === (g.product as { id: string }).id)?.name ?? "A product") : `${g.product.name} · new`;
    const number = g.metric ? [g.metric.name !== g.title ? g.metric.name : null, metricLine(g.metric)].filter(Boolean).join(": ") : "No number yet";
    return { key: `know:${g.ref}`, title: g.title, depth: depth(g), north, detail: [north ? "North Star" : null, where, number].filter(Boolean).join(" · "), state: "kept", ref: g.ref };
  });
}

/** The About and the products as they are now: what each does and who it's for. */
function contextGroups(i: SoFarInput): SoFar["groups"] {
  const line = (id: string, label: string, t: string): LineRow[] => (t.trim() ? [{ id, label, text: t.trim(), state: "kept", rests: { quotes: [], answers: [] } }] : []);
  const about = { key: "org", title: `About ${i.org}`, fresh: false, lines: [...line("org:context", "What we do", i.about.context), ...line("org:audience", "Who we serve", i.about.audience)] };
  const products = i.products.map((p) => ({ key: p.id, title: p.name, fresh: false, lines: [...line(`${p.id}:context`, "Context", p.context), ...line(`${p.id}:audience`, "Who it's for", p.audience)] }));
  return [about, ...products].filter((g) => g.lines.length || g.key !== "org");
}

export function soFarOf(i: SoFarInput): SoFar {
  const s = i.session;
  if (s?.proposal && (s.phase === "review" || s.phase === "done")) {
    const goals = goalLines(s.proposal).map(({ line, depth }, n): GoalRow => {
      const north = n === 0 && !depth && line.to === "org";
      const number = line.metric ? [line.metric.name !== line.text ? line.metric.name : null, metricLine(line.metric)].filter(Boolean).join(": ") : "No number yet";
      return { key: line.id, title: line.text, depth, north, detail: [north ? "North Star" : null, line.to === "org" ? null : placeName(line.to, s, i.products), number].filter(Boolean).join(" · "), state: stateOf(s, line.id), lineId: line.id, rests: rests(line, i.quotes) };
    });
    const groups = groupsOf(s, i.org, i.products).map((g) => ({ key: g.key, title: g.title, fresh: g.fresh, lines: g.lines.map((l) => ({ id: l.id, label: g.labels[l.field], text: l.text, state: stateOf(s, l.id), rests: rests(l, i.quotes) })) }));
    return { from: "proposal", goals, groups, open: pendingLines(s).map((l) => l.id) };
  }
  const groups = contextGroups(i);
  if (i.know && (i.know.phase === "asking" || i.know.phase === "review") && i.know.goals.length) return { from: "know", goals: knowRows(i.know.goals, i.products), groups, open: [] };
  const rows = treeRows(i.tree);
  if (!rows.length && !groups.length) return { from: "none", goals: [], groups, open: [] };
  return { from: "tree", goals: rows.map((g) => ({ key: g.id, title: g.title, depth: g.depth, north: g.north, detail: [g.north ? "North Star" : null, g.line || null].filter(Boolean).join(" · "), state: "kept", goalId: g.id })), groups, open: [] };
}
