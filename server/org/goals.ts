import { nanoid } from "nanoid";
import { bearingsCall } from "@/ai/goals";
import { aiConfigured, structured } from "@/ai/server";
import { bearingMaterial, foldBearings, goalAndUnder, problemsInScope, sanitizeBearings, type BearingLog } from "@/goals/bearings";
import { gapsOf } from "@/goals/gaps";
import { foldJobs, jobsOf } from "@/goals/jobs";
import { funnelOf } from "@/code/map";
import { rankForGoal } from "@/goals/problems";
import { chainOf, childrenOf, goalById } from "@/goals/tree";
import type { Goal } from "@/goals/types";
import { rankNeeds } from "@/hub/needs";
import { indexFor } from "../index/registry";
import { search } from "../index/search";
import { knowledgeInputs } from "./needs";
import { stepView } from "./steps";
import type { OrgEvent, OrgStore } from "./store";

/**
 * A goal's page and the problems behind it, in the core. Problems are linked to goals by one call
 * (src/ai/goals.ts, checked by src/goals/bearings.ts): on asking ("Find problems", for a goal and
 * the goals under it), and on its own whenever Qalam AI files new material into need pages (for
 * those pages, against every active goal). People link and unlink by hand; what they say stands.
 */

const one = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, 300) : "");

/** A goal's page: the goal, the goals above and under it, the boards working on it, the problems behind it and what was decided about it. */
export async function goalPage(store: OrgStore, id: string) {
  const tree = await store.getGoals();
  const goal = goalById(tree, id);
  if (!goal) return null;
  const k = await knowledgeInputs(store);
  const needs = rankNeeds({ now: Date.now(), topics: k.topics, pieces: k.pieces, shows: k.shows });
  const { links } = foldBearings(await store.listBearingLog());
  const scope = goalAndUnder(tree, id);
  const backing = new Map(needs.map((n) => [n.topic, n]));
  const boards = scope.flatMap((gid) => {
    const g = goalById(tree, gid);
    const p = g?.on ? store.getProject(g.on.board)?.record : undefined;
    return g?.on && p ? [{ goal: gid, board: p.id, name: p.name, card: g.on.card }] : [];
  });
  const problems = rankForGoal(id, { tree, links, needs });
  const funnel = funnelOf(goal, await store.listMaps());
  return {
    goal,
    north: tree.north,
    /** The goals above it, the nearest first. */
    chain: chainOf(tree, id).slice(1),
    children: childrenOf(tree, id),
    boards,
    problems,
    /** What isn't known yet about it (code's, no tokens), and the jobs planned to find out. */
    gaps: gapsOf(goal, problems, new Map(k.topics.map((t) => [t.id, t]))),
    jobs: jobsOf(foldJobs(await store.listJobLog()), id),
    /** What others report for it, and the goals proposed under it (hub/goals/<goal>.json). */
    work: await store.getGoalWork(id),
    /** The flow in the product's code whose events measure it (hub/maps). */
    funnel,
    /** What's pinned at its funnel's steps: problems, quotes, pictures (hub/steps.jsonl). */
    steps: funnel ? await stepView(store, funnel.map.key, funnel.flow) : null,
    /** Need pages in its scope with no link to it yet, the best-backed first: what "Link a problem" picks from. */
    unlinked: problemsInScope(k.topics, goal)
      .filter((t) => !links.some((l) => l.need === t.id && scope.includes(l.goal)))
      .map((t) => ({ id: t.id, title: t.title, sources: backing.get(t.id)?.sources ?? 0, quotes: backing.get(t.id)?.quotes ?? 0 }))
      .sort((a, b) => b.sources - a.sources || b.quotes - a.quotes)
      .slice(0, 60),
    decisions: store.listDecisions({ goal: id, limit: 50 }),
    indexed: k.indexed,
  };
}

export interface Linked {
  /** Links made or changed. */
  added: number;
  /** Links Qalam AI stands behind now (new or kept). */
  kept: number;
  /** Its earlier links it took back. */
  removed: number;
  /** What kind of problem would move the goals that no page holds yet. */
  none: string;
}

/**
 * One call linking problem pages to goals: `targets` are the goals a problem may be linked to,
 * `pages` the need pages to read (all in their scope when not given, the best-backed 40 first).
 * `replace`: Qalam AI's earlier links between these that it doesn't make again are taken off.
 */
export async function linkProblems(store: OrgStore, o: { targets: string[]; pages?: string[]; replace: boolean; emit?: (label: string) => void }): Promise<Linked> {
  const tree = await store.getGoals();
  const targets = o.targets.filter((id) => goalById(tree, id));
  const none: Linked = { added: 0, kept: 0, removed: 0, none: "" };
  if (!targets.length) return none;
  const k = await knowledgeInputs(store);
  const ranked = rankNeeds({ now: Date.now(), topics: k.topics, pieces: k.pieces, shows: k.shows });
  const order = new Map(ranked.map((n, i) => [n.topic, i]));
  const inScope = new Set(targets.flatMap((id) => problemsInScope(k.topics, goalById(tree, id)).map((t) => t.id)));
  const pages = k.topics.filter((t) => inScope.has(t.id) && (!o.pages || o.pages.includes(t.id))).sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
  if (!pages.length) return none;
  const { links, refused } = foldBearings(await store.listBearingLog());
  const products = await store.listProducts();
  const near = await nearGoals(store, targets.map((id) => goalById(tree, id)!));
  const m = bearingMaterial({ tree, targets, problems: pages, evidence: new Map(ranked.map((n) => [n.topic, n])), productName: (id) => products.find((p) => p.id === id)?.name, near });
  o.emit?.(`Qalam AI is reading ${m.problems.size === 1 ? "a problem" : `${m.problems.size} problems`} against ${targets.length === 1 ? "the goal" : `${targets.length} goals`}`);
  const { data, model } = await structured<unknown>(bearingsCall(m));
  const now = Date.now();
  const dropped: { why: string; item: unknown }[] = [];
  const found = sanitizeBearings(data, m, { now, refused }, (why, item) => dropped.push({ why, item }));
  // The call's trace: what it was sent (by id), what it answered, what code kept and left out, and why.
  await store
    .putTrace({ id: nanoid(10), projectId: "goals", kind: "bearings", at: now, ...(model ? { model } : {}), targets, problems: [...m.problems].map(([ref, t]) => ({ ref, id: t.id, title: t.title })), answer: data, kept: found.length, dropped } as { id: string; projectId: string })
    .catch(() => {});
  const sent = new Set([...m.problems.values()].map((t) => t.id));
  const entries: BearingLog[] = [];
  for (const b of found) {
    const was = links.find((l) => l.need === b.need && l.goal === b.goal);
    if (was?.by === "you" || (was && was.how === b.how && was.bears === b.bears)) continue;
    entries.push(b);
  }
  let removed = 0;
  if (o.replace)
    for (const l of links)
      if (l.by === "qalam" && targets.includes(l.goal) && sent.has(l.need) && !found.some((b) => b.need === l.need && b.goal === l.goal)) {
        entries.push({ need: l.need, goal: l.goal, by: "qalam", removed: true, at: now });
        removed++;
      }
  await store.addBearings(entries);
  const answer = data && typeof data === "object" ? (data as { none?: unknown }).none : "";
  return { added: entries.length - removed, kept: found.length, removed, none: one(answer) };
}

/**
 * Where each topic page line ranks in a search for the goals' words (by its ref, nearest first):
 * how a page with many lines picks the ones to send. No index here: no ranking, pages send their first lines.
 */
async function nearGoals(store: OrgStore, goals: Goal[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const ix = indexFor(store);
    await ix.settled();
    const query = goals.map((g) => [g.title, g.metric?.name].filter(Boolean).join(" · ")).join("; ").slice(0, 600);
    const { hits } = await search(ix, { query, limit: 400, use: { links: false } });
    hits.forEach((h, i) => h.type === "page" && out.set(h.ref, i));
  } catch {
    // No index on this computer (Node without full-text search).
  }
  return out;
}

/** "Find problems" on a goal's page: the goal and the goals under it, every need page in their scope. */
export function findProblems(store: OrgStore, id: string, emit?: (label: string) => void): Promise<Linked> {
  return store.getGoals().then((tree) => linkProblems(store, { targets: goalAndUnder(tree, id), replace: true, emit }));
}

/** A person links a problem to a goal, or takes the link off (Qalam AI never makes it again). */
export async function linkByHand(store: OrgStore, x: { need: string; goal: string; on: boolean; how?: string; bears?: "direct" | "some" }, opts: { tab?: string } = {}) {
  const entry: BearingLog = x.on ? { need: x.need, goal: x.goal, bears: x.bears ?? "direct", how: one(x.how), cites: [], by: "you", at: Date.now() } : { need: x.need, goal: x.goal, by: "you", removed: true, at: Date.now() };
  await store.addBearings([entry], opts);
}

const AFTER_FILING = 20_000;
/** Each watched store's way to link the pages just filed now, without waiting. */
const watching = new WeakMap<OrgStore, (pages: string[]) => Promise<Linked | null>>();

/**
 * Once Qalam AI has filed new material into need pages and things have settled, one call reads
 * those pages against every active goal. Nothing runs without goals or without Qalam AI set up,
 * and people's own edits to a page never start it.
 */
export function startBearings(store: OrgStore) {
  if (watching.has(store)) return;
  const changed = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<unknown> = Promise.resolve();
  // The latest run's pages and result: a job asking after the pages it filed gets that run's.
  let last: { pages: Set<string>; result: Promise<Linked | null> } | null = null;
  const run = (): Promise<Linked | null> => {
    clearTimeout(timer);
    const pages = [...changed];
    changed.clear();
    const next = running.then(async () => {
      if (!pages.length || !aiConfigured()) return null;
      const tree = await store.getGoals();
      const targets = tree.goals.filter((g) => g.status === "active").map((g) => g.id);
      return targets.length ? linkProblems(store, { targets, pages, replace: false }) : null;
    });
    running = next.catch(() => null);
    const result = next.catch(() => null);
    if (pages.length) last = { pages: new Set(pages), result };
    return result;
  };
  watching.set(store, (pages) => (pages.some((p) => changed.has(p)) ? run() : last && pages.some((p) => last!.pages.has(p)) ? last.result : Promise.resolve(null)));
  store.events.on("event", (e: OrgEvent) => {
    if (e.kind !== "topic" || !e.filed || e.removed) return;
    changed.add(e.id);
    clearTimeout(timer);
    timer = setTimeout(() => void run(), AFTER_FILING);
  });
  store.events.on("dispose", () => clearTimeout(timer));
}

/**
 * Link the pages a job's material was just filed into now, rather than once things settle (or wait
 * for the run that took them already). Null when none of them was filed.
 */
export const flushBearings = (store: OrgStore, pages: string[]): Promise<Linked | null> => watching.get(store)?.(pages) ?? Promise.resolve(null);
