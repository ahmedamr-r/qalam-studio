import { nanoid } from "nanoid";
import { bearingsCall } from "@/ai/goals";
import { claimsCall } from "@/ai/outside";
import { ideasCall, numberCall } from "@/ai/moves";
import { bearingMaterial, foldBearings, sanitizeBearings, type Bearing } from "@/goals/bearings";
import { activeGoals, ideasMaterial, movesTask, numberMaterial, problemAsTopic, sanitizeIdeas, sanitizeNumber, type GoalFit, type GoalIdea, type MovesFound, type SuggestedNumber } from "@/goals/moves";
import { claimsMaterial, outsideTask, sanitizeClaims, type Benchmark, type OutsidePage } from "@/goals/outside";
import { goalById } from "@/goals/tree";
import type { Goal } from "@/goals/types";
import type { OstMetric } from "@/discovery/types";
import { termsFold } from "@/terms/fold";
import { readLinks, realDeps, type MarketDeps } from "./market";
import type { OrgStore } from "./store";

/**
 * The goal a problem could move, in the core (src/goals/moves.ts). First the goals on the canvas: a
 * link already made costs nothing, else the bearing call reads the problem against them, by the same
 * rules as any link (and a link a person took off isn't made). With none that fits, the research step
 * looks for what companies like theirs measure, code reads the pages, and one call proposes goals.
 * Nothing is written here: the person's choice puts it on the canvas.
 */

const aboutLine = async (store: OrgStore) => {
  const about = await store.getAbout();
  return [about.context, about.audience].filter((x) => x.trim()).join(" ");
};

const trace = (store: OrgStore, kind: string, data: Record<string, unknown>) => store.putTrace({ id: nanoid(10), projectId: "goals", kind, at: Date.now(), ...data } as { id: string; projectId: string }).catch(() => {});

export interface MovesAsked {
  title: string;
  /** Its problem's page, when it has one. */
  topic?: string;
  /** Its card's words, when it has no page. */
  words: string[];
  /** The goals on the canvas. */
  goals: string[];
  /** The goals are ruled out already: go straight to the web. */
  look?: boolean;
  product?: string | null;
}

/** The goals on the canvas it would move. */
async function fitsOn(store: OrgStore, o: MovesAsked, targets: string[], tree: Awaited<ReturnType<OrgStore["getGoals"]>>, emit: (label: string) => void, signal: AbortSignal, deps: MarketDeps): Promise<GoalFit[]> {
  const page = o.topic ? await store.getTopic(o.topic).catch(() => null) : null;
  const { links, refused } = foldBearings(await store.listBearingLog());
  const named = (b: Pick<Bearing, "goal" | "bears" | "how">): GoalFit[] => {
    const g = goalById(tree, b.goal);
    return g ? [{ goal: g.id, title: g.title, bears: b.bears, how: b.how }] : [];
  };
  // Linked before: said at once, for nothing.
  const linked = page ? links.filter((b) => b.need === page.id && targets.includes(b.goal)) : [];
  if (linked.length) return linked.flatMap(named);
  emit(`Checking it against ${targets.length === 1 ? "your goal" : `your ${targets.length} goals`}`);
  const now = Date.now();
  const topic = page ?? problemAsTopic({ id: `card-${nanoid(6)}`, title: o.title, words: o.words, now });
  const backed = topic.lines.filter((l) => l.section === "know");
  const evidence = new Map([[topic.id, { quotes: backed.length, sources: new Set(backed.flatMap((l) => l.from)).size || 1, against: 0 }]]);
  const m = bearingMaterial({ tree, targets, problems: [topic], evidence, productName: () => undefined });
  const { data, model } = await deps.structured<unknown>(bearingsCall(m), signal);
  const dropped: { why: string; item: unknown }[] = [];
  const kept = sanitizeBearings(data, m, { now, refused }, (why, item) => dropped.push({ why, item }));
  await trace(store, "goal-fits", { ...(model ? { model } : {}), problem: topic.id, targets, answer: data, kept: kept.length, dropped });
  return kept.flatMap(named);
}

export async function goalsForProblem(store: OrgStore, o: MovesAsked, emit: (label: string) => void, signal: AbortSignal, deps: MarketDeps = realDeps): Promise<MovesFound> {
  const tree = await store.getGoals();
  const targets = activeGoals(tree.goals, o.goals);
  if (!o.look && targets.length) {
    const fits = await fitsOn(store, o, targets, tree, emit, signal, deps);
    if (signal.aborted) throw new DOMException("Stopped", "AbortError");
    if (fits.length) return { fits, ideas: [], looked: null };
  }
  const about = await aboutLine(store);
  const market = await store.getMarket();
  const product = o.product ? (await store.listProducts()).find((p) => p.id === o.product) : undefined;
  const org = store.info.name;
  emit(targets.length ? "None of your goals fits, so I'm looking on the web for what companies like yours measure" : "Looking on the web for what companies like yours measure");
  const info = await deps.research({ purpose: "moves", task: movesTask({ org, about, product: product?.name, facts: market.company, problem: o.title, words: o.words }), connectors: ["web"] }, emit, signal);
  if (signal.aborted) throw new DOMException("Stopped", "AbortError");
  let pages: OutsidePage[] = [];
  if (info) {
    emit("Reading the pages it found");
    pages = await readLinks(deps, info, signal);
  }
  if (signal.aborted) throw new DOMException("Stopped", "AbortError");
  emit("Qalam AI is working out which goals it could move");
  const goals = tree.goals.map((g) => g.title);
  const m = ideasMaterial({ org, about, market, problem: o.title, words: o.words, goals, notes: info?.notes ?? "", pages });
  const { data, model } = await deps.structured<unknown>(ideasCall(m), signal);
  const dropped: { why: string; item: unknown }[] = [];
  const ideas: GoalIdea[] = sanitizeIdeas(data, m, { problem: o.title, words: o.words, goals, aims: market.aims, now: Date.now(), id: () => nanoid(8), fold: termsFold(await store.getTerms()) }, (why, item) => dropped.push({ why, item }));
  await trace(store, "goal-ideas", { ...(model ? { model } : {}), problem: o.title, pages: [...m.pages.values()].map((p) => ({ ref: p.ref, url: p.url })), answer: data, kept: ideas.length, dropped });
  return { fits: [], ideas, looked: { ...(info ? {} : { noWeb: true as const }), ...(targets.length ? { goals: targets.length } : {}), pages: pages.map((p) => ({ title: p.title, url: p.url })) } };
}

export interface NumberAsked {
  goal: string;
  /** The goal in goals.md, when it's one already: what was looked up for it counts. */
  goalId?: string;
  metric: { name: string; unit?: string; direction: OstMetric["direction"] };
  now: number | null;
  problem: string;
  others: Benchmark[];
}

/** What others report for the number, read on their pages: a look only while there's too little to go on. */
async function reported(store: OrgStore, o: NumberAsked, emit: (label: string) => void, signal: AbortSignal, deps: MarketDeps): Promise<Benchmark[]> {
  const kept = o.goalId ? ((await store.getGoalWork(o.goalId)).outside?.claims ?? []) : [];
  const known = [...o.others, ...kept];
  if (known.length >= 2) return known;
  const about = await aboutLine(store);
  const stub: Goal = { id: "", title: o.goal, parent: null, product: null, metric: { ...o.metric, baseline: null, current: o.now, target: null }, status: "active", cites: [], by: "qalam", at: Date.now() };
  emit(`Looking on the web for what others report for ${o.metric.name}`);
  const task = outsideTask({ org: store.info.name, about, chain: [], goal: stub });
  const info = await deps.research({ purpose: "goals", task, connectors: ["web"] }, emit, signal);
  if (signal.aborted) throw new DOMException("Stopped", "AbortError");
  if (!info?.notes) return known;
  emit("Reading the pages it found");
  const pages = await readLinks(deps, info, signal);
  if (!pages.length || signal.aborted) return known;
  emit("Qalam AI is checking each number on its page");
  const m = claimsMaterial({ task, notes: info.notes, pages });
  const { data } = await deps.structured<unknown>(claimsCall(m), signal);
  return [...known, ...sanitizeClaims(data, m, { now: Date.now() })];
}

/** A number suggested for a goal they have none in mind for, resting on what others report where it can. */
export async function suggestGoalNumber(store: OrgStore, o: NumberAsked, emit: (label: string) => void, signal: AbortSignal, deps: MarketDeps = realDeps): Promise<{ suggestion: SuggestedNumber | null }> {
  // A look that fails leaves what Qalam AI knows of the industry; Stop stops.
  const others = await reported(store, o, emit, signal, deps).catch((e: unknown) => {
    if (signal.aborted) throw e;
    return o.others;
  });
  emit("Qalam AI is working out a number that's realistic");
  const m = numberMaterial({ org: store.info.name, about: await aboutLine(store), market: await store.getMarket(), goal: o.goal, metric: o.metric, now: o.now, problem: o.problem, others });
  const { data, model } = await deps.structured<unknown>(numberCall(m), signal);
  const dropped: { why: string; item: unknown }[] = [];
  const suggestion = sanitizeNumber(data, m, (why, item) => dropped.push({ why, item }));
  await trace(store, "goal-number", { ...(model ? { model } : {}), goal: o.goal, others: [...m.claims.keys()], answer: data, kept: suggestion ? 1 : 0, dropped });
  return { suggestion };
}
