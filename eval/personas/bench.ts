import type { PlanQuestion } from "@/ai/plan";
import { applyTurn, currentRound, emptyAsking, lookupLanded, markRead, nextAfter, startLookup } from "@/asking/engine";
import type { AskingState, Lookup } from "@/asking/types";
import { askingIn } from "@/asking/wire";
import { research, structured } from "@/ai/server";
import { briefRound, type BriefAsked, type BriefShape } from "@/discovery/brief";
import { needLine } from "@/hub/needs";
import { startPlan } from "@/onboarding/start";
import { firstGoal, SUGGESTED_GOAL } from "@/scan/plan";
import type { ScanSession } from "@/scan/session";
import { steerAnswers } from "@/scan/steer";
import { type OutlineCard, type PlanCard, type PlanDraft } from "@/space/plan";
import { routeOf } from "@/space/route";
import { captureTogether } from "../../server/capture";
import { writeCardBrief, type BriefCardWords, type BriefRequest } from "../../server/org/briefs";
import { realDeps, type MarketDeps } from "../../server/org/market";
import { readAppReviews, readJson, readPage, readPosts } from "../../server/org/pages";
import { needsNow } from "../../server/org/needs";
import { lookForPlan, planNext, proposePlan, routeQuestion, type PlanBody } from "../../server/org/plan";
import { firstBuild, keepAnswers, keepAudience, planAudiences, planQuestions, writeBrief } from "../../server/org/scan-plan";
import { scanToEnd, steerQuestions, type ScanDeps } from "../../server/org/scan";
import type { OrgStore } from "../../server/org/store";
import type { Player } from "./player";
import { tapped, type Tap } from "./tap";
import type { Persona } from "./types";

/**
 * The flows whose logic lives in the core, run in process: the window only carries the conversation
 * here, so its sequence (`ahead` in src/ui/space/chat/store.ts, `answerPlan` and `pickAudience` for a
 * scan) is replayed step for step. A brief's request is built from the draft where the window builds
 * it from the canvas; the two-way check on A1 holds these to what the real app sends.
 */

export interface PlanRun {
  path: "plan";
  said: string;
  /** Where the chat sent their message before anything else. */
  route: { job: string; classified?: "ask" | "plan" };
  body: PlanBody;
  questions: PlanQuestion[][];
  draft: PlanDraft | null;
  brief: { id: string; markdown: string; shape: BriefShape; card: string } | null;
  firstRoundOnly?: boolean;
  /** What was sent at each step, for the two-way check with the real app. */
  bodies: { path: string; body: unknown }[];
  /** How the interview ended: as the app's engine says, or the bench's own guard (the app has none). */
  ended?: "done" | "nothing-new" | "stopped" | "guard";
}

/** The bench's own stop for the plan's interview, which has no limit on rounds in the app: a run past it is reported as `guard`. */
export const BENCH_TURNS = 15;

export interface ScanRun {
  path: "scan";
  said: string;
  /** Asked by the first run while it reads. */
  startAsked: { question: string; answer: string }[];
  session: ScanSession | null;
  questions: PlanQuestion[][];
  problems: { title: string; line: string; lines: { section: string; text: string }[] }[];
  audiences: { name: string; about: string }[];
  audience: string | null;
  goal: { title: string; metric: string } | null;
  build: { problem: string; drafts: { id: string; title: string; description: string; type?: string; assumptions: string[]; test: string | null }[]; pick: { draft: string; why: string } | null; note: string } | null;
  brief: { id: string; markdown: string } | null;
  firstRoundOnly?: boolean;
}

const emit = (t: Tap) => (label: string) => void t.steps.push(label);

/** What the chat does with a first message, with the small call only where the window makes it. */
async function routed(said: string, signal: AbortSignal, deps: MarketDeps) {
  const r = routeOf({ text: said, docs: [] });
  if (r?.job !== "ask") return { job: r?.job ?? "none" };
  const { route } = await routeQuestion(said, signal, deps);
  return { job: "ask", classified: route };
}

/**
 * The plan route, as `workOut` and `ahead` run it. Sent to Ask or the chips first, a person takes the
 * button that works it out as a plan; where that happened is recorded, since it's what they'd meet.
 */
export async function planFlow(store: OrgStore, p: Persona, player: Player, t: Tap, signal: AbortSignal, o: { firstRoundOnly?: boolean; outline?: OutlineCard[]; deps?: MarketDeps } = {}): Promise<PlanRun> {
  const deps = tapped(o.deps ?? realDeps, t);
  const said = (p.planSaid ?? p.opener).slice(0, 4000);
  const route = await routed(said, signal, deps);
  const body: PlanBody = { said, outline: o.outline ?? (await outlineOf(store)), rounds: [], looks: [] };
  const questions: PlanQuestion[][] = [];
  const say = emit(t);
  const bodies: { path: string; body: unknown }[] = [];
  const sent = (at: string, extra: object = {}) => void bodies.push({ path: at, body: JSON.parse(JSON.stringify({ ...body, ...extra })) });
  // The interview as the app's engine runs it (src/asking/): the opening look and every lookup a turn asks
  // for run here before the next turn (the app runs them while the person answers); no project search here.
  let s: AskingState = startLookup(emptyAsking(), { id: "l0", kind: "web", query: "", waits: 1 }, Date.now());
  const withAsking = (): PlanBody => ({ ...body, asking: askingIn(s, { said }) });
  const run = async (l: Lookup) => {
    if (l.kind !== "web") return void (s = lookupLanded(s, l.id, { lines: [] }));
    sent("plan/look", l.query ? { query: l.query } : {});
    const look = await lookForPlan(store, { ...withAsking(), ...(l.query ? { query: l.query } : {}) }, say, signal, deps).catch((e: unknown) => {
      if (signal.aborted) throw e;
      return null;
    });
    if (look) body.looks.push({ ...look, after: s.rounds.length - 1 });
    s = lookupLanded(s, l.id, look ? { look, lines: look.lines.map((x, i) => ({ ref: `${l.id}-${i + 1}`, text: x.text, from: x.url ?? "a page", whose: "a page online" })) } : { error: "It failed" });
  };
  let ended: PlanRun["ended"];
  let made = 0;
  for (let turns = 0; ; ) {
    for (const l of s.lookups.filter((x) => x.state === "running")) await run(l);
    const next = nextAfter(s);
    if (next === "end") {
      ended = s.end?.by;
      break;
    }
    if (next === "offer" && s.offer) {
      s = startLookup(s, { id: s.offer.id, kind: "web", query: s.offer.query, waits: s.turns }, Date.now());
      continue;
    }
    if (next === "ask") {
      const r = currentRound(s)!;
      questions.push(r.questions);
      if (o.firstRoundOnly) return { path: "plan", said, route, body: withAsking(), questions, draft: null, brief: null, firstRoundOnly: true, bodies };
      const answers = await player.fill(r.questions, { flow: "plan", round: s.rounds.length - 1 }, signal);
      s = { ...s, rounds: s.rounds.map((x, i) => (i === s.rounds.length - 1 ? { ...x, said: answers, form: { ...x.form, submitted: true } } : x)) };
      continue;
    }
    if (next === "wait") continue;
    if (turns++ >= BENCH_TURNS) {
      ended = "guard";
      break;
    }
    sent("plan/next", { asking: askingIn(s, { said }) });
    s = markRead(s);
    s = applyTurn(s, await planNext(store, withAsking(), say, signal, deps), { now: Date.now(), id: (p) => `${p}${++made}` });
  }
  if (o.firstRoundOnly) return { path: "plan", said, route, body: withAsking(), questions, draft: null, brief: null, firstRoundOnly: true, bodies, ended };
  sent("plan/propose");
  const draft = await proposePlan(store, withAsking(), say, signal, deps);
  const brief = await briefForDraft(store, draft, player, deps, signal, (req) => void bodies.push({ path: "briefs", body: req }));
  return { path: "plan", said, route, body: withAsking(), questions, draft, brief, bodies, ended };
}

/** What's on the canvas for a plan to read: the problem pages, drawn faint, as a canvas with nothing else composes them. */
async function outlineOf(store: OrgStore): Promise<OutlineCard[]> {
  const { needs } = await needsNow(store).catch(() => ({ needs: [] as Awaited<ReturnType<typeof needsNow>>["needs"] }));
  return needs.map((n) => ({ id: `topic:none:${n.topic}`, kind: "opportunity" as const, title: n.title, parent: null, topic: n.topic, faint: true }));
}

const shapeOf = (c: PlanCard): BriefShape => (c.type === "message" ? "message" : c.type === "service" ? "steps" : "build");

const wordsOf = (c: PlanCard): BriefCardWords => ({
  title: c.title,
  description: c.description,
  assumptions: [...c.assumptions].sort((a, b) => b.importance - a.importance).map((a) => a.text),
  tests: c.test ? [{ what: c.test.what, how: c.test.how, suggested: c.test.suggested }] : [],
  // As the window sends what the proposal put on the card: their answers and what was read online carry no source.
  evidence: [...c.answers.map((a) => ({ text: a.answer, kind: "answer" })), ...c.read.map((l) => ({ text: l.text, kind: "read", ...(l.title ? { sourceTitle: l.title } : {}), ...(l.url ? { url: l.url } : {}) }))],
  topic: null,
});

/** A brief for the card to start with, as a person asks for one after accepting the proposal. */
async function briefForDraft(store: OrgStore, d: PlanDraft, player: Player, deps: MarketDeps, signal: AbortSignal, sent: (req: BriefRequest) => void) {
  const start = d.cards.find((c) => c.ref === d.start) ?? d.cards.find((c) => c.kind === "solution");
  if (!start) return null;
  const shape = shapeOf(start);
  const answers = await player.fill(briefRound(shape), { flow: "brief", round: 0 }, signal);
  const asked: BriefAsked = { ...(answers.platform ? { platform: answers.platform } : {}), ...(answers.exists ? { exists: answers.exists } : {}), ...(answers.needs ? { needs: answers.needs } : {}) };
  const refOf = (c: PlanCard) => (c.under && "ref" in c.under ? c.under.ref : null);
  const above = (c: PlanCard) => d.cards.find((x) => x.ref === refOf(c)) ?? null;
  const chain: PlanCard[] = [];
  for (let at = above(start); at; at = above(at)) chain.push(at);
  const problem = chain.find((c) => c.kind === "opportunity") ?? null;
  const goal = chain.find((c) => c.kind === "outcome") ?? null;
  const req: BriefRequest = {
    card: { ...wordsOf(start), id: start.ref, kind: start.kind === "outcome" ? "outcome" : start.kind === "opportunity" ? "opportunity" : "solution" },
    goal: goal ? { title: goal.title, metric: goal.metric ? [goal.metric.name, goal.metric.target != null ? `target ${goal.metric.target}` : ""].filter(Boolean).join(", ") : null } : null,
    problem: problem ? wordsOf(problem) : null,
    under: [],
    others: d.cards.filter((c) => c.kind === "solution" && c.ref !== start.ref && refOf(c) === refOf(start)).map((c) => c.title),
    asked,
    ...(shape !== "build" ? { shape } : {}),
  };
  sent(req);
  const meta = await writeCardBrief(store, req, signal, { structured: deps.structured });
  const markdown = await store.getBrief(meta.id).then((x) => x?.body ?? "").catch(() => "");
  return { id: meta.id, markdown, shape, card: start.title };
}

function scanDeps(t: Tap): ScanDeps {
  const base: ScanDeps = { research, read: readPage, structured, json: readJson, reviews: readAppReviews, posts: readPosts, capture: captureTogether };
  const d = tapped(base, t);
  return {
    ...d,
    posts: async (link, signal) => {
      const page = await base.posts(link, signal);
      t.pages.push({ url: link.url, host: new URL(link.url).hostname.replace(/^www\./, ""), read: !!page, ...(page ? { chars: page.text.length } : {}) });
      return page;
    },
    reviews: async (app, signal) => {
      const r = await base.reviews(app, signal);
      t.pages.push({ url: app.url, host: "apps.apple.com", read: !!r });
      return r;
    },
  };
}

/** The first run's one box, then a scan's own road to what to build first. The chat asks the scan's own questions while it reads. */
export async function scanFlow(store: OrgStore, p: Persona, player: Player, t: Tap, signal: AbortSignal, o: { firstRoundOnly?: boolean } = {}): Promise<ScanRun> {
  const said = p.opener;
  const turn = startPlan(said, [])?.turns.find((x) => x.mode === "scan");
  const target = turn?.mode === "scan" ? turn.target : null;
  if (!target) throw new Error(`The first run turned this away: ${said}`);
  const base = { path: "scan" as const, said, audiences: [], audience: null, goal: null, build: null, brief: null, problems: [] };
  const steer = await steerQuestions({ target }, signal, tapped({ research, read: readPage, structured }, t));
  if (o.firstRoundOnly) return { ...base, startAsked: [], session: null, questions: [steer], firstRoundOnly: true };
  const allTold = steerAnswers(steer, await player.fill(steer, { flow: "steer", round: 0 }, signal));
  const deps = scanDeps(t);
  const session = await scanToEnd(store, { target, country: "us", told: allTold }, deps, signal);
  const sources = session.read.flatMap((r) => (r.sourceId ? [r.sourceId] : []));
  const { needs } = await needsNow(store).catch(() => ({ needs: [] as Awaited<ReturnType<typeof needsNow>>["needs"] }));
  const problems = await Promise.all(needs.map(async (n) => ({ title: n.title, line: needLine(n), lines: ((await store.getTopic(n.topic))?.lines ?? []).map((l) => ({ section: l.section, text: l.text })) })));
  const out: ScanRun = { ...base, startAsked: allTold, session, questions: [steer], problems };
  if (!sources.length) return out;
  const plan = { target, sources, told: allTold };
  const questions = await planQuestions(store, plan, signal);
  out.questions.push(questions);
  const answers = await player.fill(questions, { flow: "scan-plan", round: 0 }, signal);
  const said2 = [...allTold, ...questions.map((q) => ({ question: q.title, answer: (answers[q.id] ?? "").trim() })).filter((x) => x.answer)];
  const words = said2.map((x) => `${x.question} ${x.answer}`).join("\n");
  const answersSource = said2.length ? await keepAnswers(store, said2, `Your answers: ${said.slice(0, 60)}`).catch(() => null) : null;
  const audiences = await planAudiences(store, { ...plan, answers: words }, signal);
  out.audiences = audiences.map((a) => ({ name: a.name, about: a.about }));
  // Who they'll build for: the first offered, or in their own words when none was; both are what a person does in a hurry.
  const a = audiences[0] ?? null;
  const who = a?.name ?? said2.find((x) => /who/i.test(x.question))?.answer ?? "";
  if (!who) return out;
  out.audience = who;
  await keepAudience(store, { name: who, ...(a?.about ? { about: a.about } : {}), refs: a?.quotes.map((q) => q.ref) ?? [] }).catch(() => {});
  const goal = firstGoal(who, "sign-up", SUGGESTED_GOAL.reach, SUGGESTED_GOAL.of);
  out.goal = { title: goal.title, metric: goal.metric };
  const build = await firstBuild(store, { ...plan, audience: who, refs: a?.quotes.map((q) => q.ref) ?? [], answers: words, ...(answersSource ? { answersSource } : {}) }, signal);
  if (!build) return out;
  out.build = {
    problem: build.problem,
    drafts: build.drafts.map((d) => ({ id: d.id, title: d.title, description: d.description, ...(d.type ? { type: d.type } : {}), assumptions: d.assumptions.map((x) => x.text), test: d.test ? `${d.test.what}: ${d.test.how}` : null })),
    pick: build.pick ? { draft: build.pick.draft, why: build.pick.why } : null,
    note: build.note,
  };
  const chosen = build.drafts.find((d) => d.id === build.pick?.draft) ?? build.drafts[0];
  if (!chosen) return out;
  const bAnswers = await player.fill(briefRound("build"), { flow: "brief", round: 0 }, signal);
  const meta = await writeBrief(store, {
    ...plan,
    card: "bench-card",
    topic: build.topic,
    draft: chosen.id,
    audience: who,
    ...(a?.about ? { about: a.about } : {}),
    goal: { title: goal.title, metric: goal.metric },
    answers: words,
    why: build.pick?.draft === chosen.id ? build.pick.why : "",
    later: build.drafts.filter((d) => d.id !== chosen.id).map((d) => ({ draft: d.id, why: build.pick?.later.find((l) => l.draft === d.id)?.why ?? "" })),
    asked: { ...(bAnswers.platform ? { platform: bAnswers.platform } : {}), ...(bAnswers.exists ? { exists: bAnswers.exists } : {}), ...(bAnswers.needs ? { needs: bAnswers.needs } : {}) },
    known: session.known ?? [],
  }, signal);
  if (meta) out.brief = { id: meta.id, markdown: await store.getBrief(meta.id).then((x) => x?.body ?? "").catch(() => "") };
  return out;
}
