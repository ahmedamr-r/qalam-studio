import { topicLineRef } from "@/hub/pieces";
import { checkWords, SECTION_HEADING, type Topic } from "@/hub/topics";
import { metricLine } from "./goals-md";
import { chainOf, childrenOf, goalById, rootsOf } from "./tree";
import type { Goal, GoalTree } from "./types";

/*
 * Which problems bear on which goal (pure): a problem is a need page (hub/topics), a goal a line of
 * goals.md. Qalam AI says which problems would move a goal's number and how, in one line; code
 * keeps a link only when the problem and the goal were sent, it cites the problem's own lines, and
 * its quoted words and numbers are in them (or in the goal's number). People link and unlink too,
 * and what they say stands: a link they took off never comes back from Qalam AI.
 */

/** How directly a problem bears on a goal: on the behaviour its number counts, or around it. */
export type Bears = "direct" | "some";

export interface Bearing {
  /** The need page. */
  need: string;
  goal: string;
  bears: Bears;
  /** How solving it moves the goal's number, in one line. */
  how: string;
  /** The page's lines it rests on (hub:topic:<page>:<line>). */
  cites: string[];
  by: "qalam" | "you";
  at: number;
}

/** A line of hub/bearings.jsonl: a link made or changed, or taken off. */
export type BearingLog = Partial<Bearing> & { need: string; goal: string; by: "qalam" | "you"; at: number; removed?: boolean };

export const pairOf = (need: string, goal: string) => `${need}|${goal}`;

/** The links as they are now, and the pairs a person took off (Qalam AI never links those again). */
export function foldBearings(log: BearingLog[]): { links: Bearing[]; refused: Set<string> } {
  const links = new Map<string, Bearing>();
  const refused = new Set<string>();
  for (const e of [...log].sort((a, b) => a.at - b.at)) {
    if (typeof e.need !== "string" || typeof e.goal !== "string") continue;
    const key = pairOf(e.need, e.goal);
    if (e.by === "you") {
      if (e.removed) {
        refused.add(key);
        links.delete(key);
      } else {
        refused.delete(key);
        links.set(key, { need: e.need, goal: e.goal, bears: e.bears === "some" ? "some" : "direct", how: e.how ?? "", cites: e.cites ?? [], by: "you", at: e.at });
      }
      continue;
    }
    if (refused.has(key) || links.get(key)?.by === "you") continue;
    if (e.removed) links.delete(key);
    else if (e.how) links.set(key, { need: e.need, goal: e.goal, bears: e.bears === "some" ? "some" : "direct", how: e.how, cites: e.cites ?? [], by: "qalam", at: e.at });
  }
  return { links: [...links.values()], refused };
}

// ---------------------------------------------------------------------------
// What a call is sent, and its answer as code keeps it

export const BEARING_LIMITS = { problems: 40, lines: 10, bearings: 12, how: 240 } as const;

export interface BearingSent {
  /** The material as the model reads it. */
  text: string;
  /** Goals as the call names them (g1…). */
  goals: Map<string, Goal>;
  /** The goals a problem may be linked to (g ids). */
  targets: string[];
  /** Problems as the call names them (t1…). */
  problems: Map<string, Topic>;
  /** Each problem's lines as the call names them (l1…): its page, the line's ref and words. */
  lines: Map<string, { topic: string; ref: string; text: string }>;
}

const one = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * The material: the goals (each under the goal it feeds, with its number), the ones a problem may
 * be linked to, and the problems with what their pages know and believe and how much backs them.
 * A page with more lines than fit sends the ones search ranks nearest the goals (`near`: a line's
 * place in that ranking, by its ref), in the page's order.
 */
export function bearingMaterial(o: { tree: GoalTree; targets: string[]; problems: Topic[]; evidence: Map<string, { quotes: number; sources: number; against: number }>; productName: (id: string) => string | undefined; near?: ReadonlyMap<string, number> }): BearingSent {
  const goals = new Map<string, Goal>();
  const gid = new Map<string, string>();
  const targets = new Set(o.targets);
  // The goals that matter: the targets, everything above them, everything under them.
  const keep = new Set<string>();
  for (const id of o.targets) {
    for (const g of chainOf(o.tree, id)) keep.add(g.id);
    const walk = (p: string) => childrenOf(o.tree, p).forEach((c) => (keep.add(c.id), walk(c.id)));
    walk(id);
  }
  const out: string[] = ["The goals (id · whose · goal · its number), each under the goal it feeds:"];
  const line = (g: Goal, depth: number) => {
    if (!keep.has(g.id)) return void childrenOf(o.tree, g.id).forEach((c) => line(c, depth));
    const id = `g${goals.size + 1}`;
    goals.set(id, g);
    gid.set(g.id, id);
    const who = g.product ? (o.productName(g.product) ?? "a product") : "the organization";
    out.push(`${"  ".repeat(depth)}- ${id} · ${who} · ${g.id === o.tree.north ? "North Star: " : ""}${one(g.title)}${g.metric ? ` · ${g.metric.name ? `${g.metric.name}: ` : ""}${metricLine(g.metric)}` : ""}`);
    childrenOf(o.tree, g.id).forEach((c) => line(c, depth + 1));
  };
  rootsOf(o.tree).forEach((g) => line(g, 0));
  const allowed = [...targets].map((t) => gid.get(t)).filter((x): x is string => !!x);
  out.push("", `Goals a problem may be linked to: ${allowed.join(", ") || "(none)"}`, "", "The problems (customer needs), each with what its page says (line id · part: words):");

  const problems = new Map<string, Topic>();
  const lines = new Map<string, { topic: string; ref: string; text: string }>();
  for (const t of o.problems.slice(0, BEARING_LIMITS.problems)) {
    const tid = `t${problems.size + 1}`;
    problems.set(tid, t);
    const e = o.evidence.get(t.id);
    const ev = e ? `${e.quotes} quotes · ${e.sources} sources${e.against ? ` · ${e.against} against` : ""}` : "no customer words yet";
    out.push(`<problem id="${tid}" title="${one(t.title).replace(/"/g, "'")}" evidence="${ev}">`);
    const all = [...t.lines.filter((l) => l.section === "know"), ...t.lines.filter((l) => l.section === "believe")];
    const place = (i: number) => o.near?.get(topicLineRef(t.id, all[i].id)) ?? Infinity;
    const chosen = new Set(
      all
        .map((_, i) => i)
        .sort((a, b) => place(a) - place(b) || a - b)
        .slice(0, BEARING_LIMITS.lines),
    );
    const kept = all.filter((_, i) => chosen.has(i));
    for (const l of kept) {
      const lid = `l${lines.size + 1}`;
      lines.set(lid, { topic: t.id, ref: topicLineRef(t.id, l.id), text: l.text });
      out.push(`- ${lid} · ${SECTION_HEADING[l.section]}: ${one(l.text)}`);
    }
    if (!kept.length) out.push("(nothing on its page yet)");
    out.push("</problem>");
  }
  return { text: out.join("\n"), goals, targets: allowed, problems, lines };
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * What code keeps of the answer: links it can stand behind, at most one per problem and goal.
 * `dropped` hears each link left out and why (for the call's trace).
 */
export function sanitizeBearings(raw: unknown, m: BearingSent, o: { now: number; refused: ReadonlySet<string> }, dropped?: (why: string, item: unknown) => void): Bearing[] {
  const out: Bearing[] = [];
  const targets = new Set(m.targets);
  const drop = (why: string, x: unknown) => void dropped?.(why, x);
  for (const x of Array.isArray(rec(raw).bearings) ? (rec(raw).bearings as unknown[]) : []) {
    if (out.length >= BEARING_LIMITS.bearings) {
      drop("over the limit", x);
      continue;
    }
    const b = rec(x);
    const t = typeof b.problem === "string" ? m.problems.get(b.problem.trim()) : undefined;
    const gref = typeof b.goal === "string" ? b.goal.trim() : "";
    const g = targets.has(gref) ? m.goals.get(gref) : undefined;
    if (!t || !g) {
      drop(!t ? "a problem not sent" : "a goal it may not be linked to", x);
      continue;
    }
    if (o.refused.has(pairOf(t.id, g.id)) || out.some((y) => y.need === t.id && y.goal === g.id)) {
      drop("taken off by a person, or there twice", x);
      continue;
    }
    const cited = [...new Set((Array.isArray(b.cites) ? b.cites : []).filter((c): c is string => typeof c === "string").map((c) => c.trim()))].flatMap((c) => {
      const l = m.lines.get(c);
      return l && l.topic === t.id ? [l] : [];
    });
    if (!cited.length) {
      drop("cites none of its problem's lines", x);
      continue;
    }
    // Its words and numbers are in the lines it cites, the problem's name, or the goal's own number.
    const chain = [...m.goals.values()].filter((x) => x.id === g.id || x.id === g.parent).map((x) => `${x.title}${x.metric ? ` ${x.metric.name} ${metricLine(x.metric)} ${x.metric.baseline ?? ""} ${x.metric.current ?? ""} ${x.metric.target ?? ""}` : ""}`);
    const how = checkWords(b.how, cited, [t.title, ...chain].join("\n"), BEARING_LIMITS.how);
    if (!how) {
      drop("words or numbers not in what it cites", x);
      continue;
    }
    out.push({ need: t.id, goal: g.id, bears: b.bears === "some" ? "some" : "direct", how, cites: cited.map((c) => c.ref), by: "qalam", at: o.now });
  }
  return out;
}

/** The problem pages a goal's call reads: its product's and the organization's (a goal of the whole organization reads them all). */
export function problemsInScope(topics: Topic[], goal: Pick<Goal, "product"> | undefined): Topic[] {
  return topics.filter((t) => t.kind === "need" && (!goal?.product || !t.products.length || t.products.includes(goal.product)));
}

/** A goal and every goal under it: what "the problems behind it" gathers from. */
export function goalAndUnder(t: GoalTree, id: string): string[] {
  const out = [id];
  const walk = (p: string) => childrenOf(t, p).forEach((c) => (out.includes(c.id) ? null : (out.push(c.id), walk(c.id))));
  if (goalById(t, id)) walk(id);
  return out;
}
