import { nanoid } from "nanoid";
import { breakdownCall } from "@/ai/breakdown";
import { claimsCall } from "@/ai/outside";
import { research, structured } from "@/ai/server";
import { breakdownMaterial, sanitizeBreakdown } from "@/goals/breakdown";
import { claimsMaterial, outsideTask, sanitizeClaims, OUTSIDE_LIMITS, type OutsidePage } from "@/goals/outside";
import { chainOf, goalById } from "@/goals/tree";
import type { Goal, GoalLever } from "@/goals/types";
import { coreDeps } from "../capture";
import { readPage } from "./pages";
import { NotFoundError, type OrgStore } from "./store";

/**
 * A goal's look outside and its breakdown, in the core. What others aim for: the research step
 * searches the web (src/ai/research.ts, purpose "goals"), code reads the pages it links itself,
 * and one call picks out the numbers they report; code keeps a claim only where its page has its
 * words and its number (src/goals/outside.ts). Break it down: one call proposes the goals under
 * it from the team's own material, with what others report beside them (src/goals/breakdown.ts).
 * Both are kept in hub/goals/<goal>.json until accepted or looked up again.
 */

async function goalOf(store: OrgStore, id: string): Promise<{ goal: Goal; tree: Awaited<ReturnType<OrgStore["getGoals"]>> }> {
  const tree = await store.getGoals();
  const goal = goalById(tree, id);
  if (!goal) throw new NotFoundError("No such goal");
  return { goal, tree };
}

/** What others aim for: look it up on the web, read the pages, keep the numbers that hold. */
export async function lookOutside(store: OrgStore, goalId: string, emit: (label: string) => void, signal: AbortSignal): Promise<{ kept: number; read: number; error?: string }> {
  const { goal, tree } = await goalOf(store, goalId);
  const about = await store.getAbout();
  const product = goal.product ? (await store.listProducts()).find((p) => p.id === goal.product) : undefined;
  const task = outsideTask({ org: store.info.name, about: [about.context, about.audience].filter((x) => x.trim()).join(" "), product: product?.name, chain: chainOf(tree, goalId), goal });
  const info = await research({ purpose: "goals", task, connectors: ["web"] }, emit, signal);
  if (!info) return { kept: 0, read: 0, error: "Web search isn't on here." };
  if (!info.notes) return { kept: 0, read: 0, error: info.error ?? "The web had nothing on goals like this one." };
  emit("Reading the pages it found");
  const links = [...new Map(info.sources.filter((s) => /^https?:\/\//i.test(s.url)).map((s) => [s.url, s])).values()].slice(0, OUTSIDE_LIMITS.pages);
  const pages = (await Promise.all(links.map((l) => readPage(l, signal)))).filter((p): p is OutsidePage => !!p);
  if (!pages.length) return { kept: 0, read: 0, error: "None of the pages it found could be read." };
  emit("Qalam AI is checking each number on its page");
  const m = claimsMaterial({ task, notes: info.notes, pages });
  const { data, model } = await structured<unknown>(claimsCall(m));
  const now = Date.now();
  const dropped: { why: string; item: unknown }[] = [];
  const claims = sanitizeClaims(data, m, { now }, (why, item) => dropped.push({ why, item }));
  await store
    .putTrace({ id: nanoid(10), projectId: "goals", kind: "outside", at: now, ...(model ? { model } : {}), goal: goalId, pages: [...m.pages.values()].map((p) => ({ ref: p.ref, url: p.url })), answer: data, kept: claims.length, dropped } as { id: string; projectId: string })
    .catch(() => {});
  await store.changeGoalWork(goalId, (w) => ({ ...w, outside: { at: now, claims, notes: info.notes.slice(0, 4000), pages: [...m.pages.values()].map((p) => ({ title: p.title, url: p.url })) } }));
  return { kept: claims.length, read: pages.length };
}

/** Break it down: the goals under it Qalam AI would propose, from the team's own material, with what others report beside them. */
export async function breakDown(store: OrgStore, goalId: string, o: { levers: GoalLever[] }, emit: (label: string) => void): Promise<{ parts: number; none: string }> {
  const { goal, tree } = await goalOf(store, goalId);
  const deps = await coreDeps(store);
  const product = goal.product ? deps.products.find((p) => p.id === goal.product) : undefined;
  emit("Gathering what your material says about it");
  const pack = await deps.pack({ query: [goal.title, goal.metric?.name].filter(Boolean).join(" · "), product: goal.product ?? undefined, budget: 1800, types: ["page", "need", "quote", "context", "decision", "card"] });
  // What others report for it, and for the goals above it.
  const benchmarks = (await Promise.all(chainOf(tree, goalId).map((g) => store.getGoalWork(g.id)))).flatMap((w) => w.outside?.claims ?? []).slice(0, 12);
  const m = breakdownMaterial({ tree, goal, productName: product?.name, context: deps.productLine(goal.product ?? null).slice(0, 2500), pack: pack ? { block: pack.context.block, pieces: pack.pieces } : null, benchmarks, levers: o.levers });
  emit("Qalam AI is breaking it down");
  const { data, model } = await structured<unknown>(breakdownCall(m));
  const now = Date.now();
  const dropped: { why: string; item: unknown }[] = [];
  const r = sanitizeBreakdown(data, m, { now, id: () => nanoid(8) }, (why, item) => dropped.push({ why, item }));
  await store
    .putTrace({ id: nanoid(10), projectId: "goals", kind: "breakdown", at: now, ...(model ? { model } : {}), goal: goalId, pieces: [...m.pieces.keys()], benchmarks: [...m.benchmarks.keys()], answer: data, kept: r.parts.length, dropped } as { id: string; projectId: string })
    .catch(() => {});
  await store.changeGoalWork(goalId, (w) => ({ ...w, breakdown: { at: now, levers: o.levers, ...r, decided: {} } }));
  return { parts: r.parts.length, none: r.none };
}

/** Accept a proposed goal under it (it goes in goals.md, under the goal, on its lever), or discard it. */
export async function decidePart(store: OrgStore, goalId: string, partId: string, accept: boolean, opts: { tab?: string } = {}): Promise<{ goal: Goal | null }> {
  const { goal } = await goalOf(store, goalId);
  const work = await store.getGoalWork(goalId);
  const part = work.breakdown?.parts.find((p) => p.id === partId);
  if (!part) throw new NotFoundError("No such proposal");
  if (work.breakdown?.decided[partId]) return { goal: null };
  const made = accept ? (await store.createGoal({ title: part.title, parent: goalId, product: goal.product, lever: part.lever, feeds: part.why, ...(part.metric ? { metric: part.metric } : {}), cites: part.cites, by: "qalam" }, opts)).goal : null;
  await store.changeGoalWork(goalId, (w) => (w.breakdown ? { ...w, breakdown: { ...w.breakdown, decided: { ...w.breakdown.decided, [partId]: accept ? "accepted" : "discarded" } } } : w), opts);
  return { goal: made };
}
