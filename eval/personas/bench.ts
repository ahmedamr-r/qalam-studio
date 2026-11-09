import type { PlanQuestion } from "@/ai/plan";
import { answersOf, applyTurn, askInstead, currentRound, emptyAsking, lookupLanded, markRead, nextAfter, startLookup, takePicks } from "@/asking/engine";
import type { AskAnswer, AskingState, AskQuestion, AskRound, Lookup } from "@/asking/types";
import { askingIn } from "@/asking/wire";
import { research, structured } from "@/ai/server";
import { askedFromAnswers, briefRound, type BriefAsked, type BriefShape } from "@/discovery/brief";
import { toQuestion } from "@/ui/ai/plan";
import { answerWords, OTHER, type Answer, type FlowState } from "@/ui/ai/questionFlow";
import { needLine } from "@/hub/needs";
import { startPlan } from "@/onboarding/start";
import { firstGoal, SUGGESTED_GOAL } from "@/scan/plan";
import type { ScanSession } from "@/scan/session";
import { steerAnswers } from "@/scan/steer";
import { type OutlineCard, type PlanCard, type PlanDraft } from "@/space/plan";
import { routeOf } from "@/space/route";
import { captureTogether } from "../../server/capture";
import { askBrief, writeCardBrief, type BriefCardWords, type BriefRequest } from "../../server/org/briefs";
import { realDeps, type MarketDeps } from "../../server/org/market";
import { readAppReviews, readJson, readPage, readPosts } from "../../server/org/pages";
import { needsNow } from "../../server/org/needs";
import { lookForPlan, planNext, proposePlan, routeQuestion, type PlanBody } from "../../server/org/plan";
import { askScanPlan, firstBuild, keepAnswers, keepAudience, planAudiences, writeBrief } from "../../server/org/scan-plan";
import { scanToEnd, steerQuestions, type ScanDeps } from "../../server/org/scan";
import type { OrgStore } from "../../server/org/store";
import { rememberRound } from "../../server/org/memory";
import { questionKey } from "@/memory/fold";
import type { AskedAbout, AskedFlow } from "@/memory/types";
import { saysDontKnow } from "@/asking/dontknow";
import type { CheckItem, CheckRequest } from "@/challenge/types";
import { challengeProposals } from "../../server/org/challenge";
import type { CheckedRun } from "./measures";
import type { Player } from "./player";
import { tapped, type Tap } from "./tap";
import type { Persona } from "./types";
import { emptyBusiness, type Business, type BusinessLine } from "@/business/types";
import { capFor } from "@/consult/pace";
import type { PlaybookId } from "@/consult/playbooks.gen";
import { levelOf, nextPlaybook, type Layer, type Level, type Situation } from "@/consult/situation";
import type { ConsultTurn } from "../../server/org/consult";

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
  ended?: Ended;
  /** The brief's own interview, before it was written. */
  briefAsk?: BriefInterview;
  /** The checks of what was proposed (src/challenge/), and what was proposed before it was proposed again by them. */
  checks?: CheckedRun[];
  before?: PlanDraft;
  /** Worked out with the consultant. */
  consult?: ConsultDetail;
}

type Ended = "done" | "nothing-new" | "stopped" | "guard";

/**
 * A consultant's conversation as it went (src/consult/): who it read them as, the playbook, each round
 * with the level it was paced for and what it showed before it, every lookup with its reason and how
 * many rounds had been answered when it started, and what it noted on the business page.
 */
export interface ConsultDetail {
  situation: Situation | null;
  playbook: string | null;
  rounds: { questions: AskQuestion[]; level: Level; reflect?: { so: string[]; open: string[] } }[];
  lookups: { kind: string; query: string; why?: string; afterAnswered: number }[];
  noted: BusinessLine[];
  business: Business;
}

/** A brief's interview as it went: each round's questions, how it ended, and every answer as calls read it. */
export interface BriefInterview {
  questions: PlanQuestion[][];
  ended?: Ended;
  answers: AskAnswer[];
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
  /** How the interview before what to build first ended. */
  ended?: Ended;
  /** What was kept as a source of their own words. */
  kept?: { question: string; answer: string }[];
  briefAsk?: BriefInterview;
}

/** A person's words for a question, as the box takes them: a choice by its label, anything else as words of their own. */
function formAnswer(raw: AskQuestion, text: string): Answer {
  const q = toQuestion(raw);
  if (q.kind === "text") return { kind: "text", text };
  // A person on the bench has no screenshots to give: they say it in words.
  if (q.kind === "shots") return { kind: "shots", shots: [], text };
  if (q.kind === "single") {
    const o = q.options.find((x) => x.label === text);
    return o ? { kind: "single", value: o.value } : { kind: "single", value: OTHER, other: text };
  }
  const o = q.groups.flatMap((g) => g.options).find((x) => x.label === text);
  return o ? { kind: "multi", values: [o.value], custom: [] } : { kind: "multi", values: [], custom: [text] };
}

/**
 * A round as the box leaves it: their words for what they answered; then, where they press "Use Qalam AI's
 * picks", Qalam AI's recommendation for each question they left that has one (src/asking/engine.ts,
 * `takePicks`), recorded as its pick. Then it's sent.
 */
async function answerRound(player: Player, r: AskRound, at: { flow: string; round: number }, signal: AbortSignal): Promise<FlowState> {
  const said = await player.fill(r.questions, at, signal);
  const answers = { ...r.form.answers };
  for (const q of r.questions) if (said[q.id]?.trim()) answers[q.id] = formAnswer(q, said[q.id]);
  let form: FlowState = { ...r.form, answers };
  if (player.pressesPicks(at)) {
    const picked = takePicks(r.questions, form);
    for (const q of r.questions) if (picked.answers[q.id] !== form.answers[q.id]) player.tookPick(q.title, at, answerWords(toQuestion(q), picked.answers[q.id]).text);
    form = picked;
  }
  return { ...form, submitted: true };
}

/** The round just closed, in the project's memory, as the window remembers it (src/ui/asking/run.ts). */
async function rememberIn(store: OrgStore, flow: AskedFlow, key: string, about: AskedAbout, s: AskingState) {
  const r = s.rounds.at(-1);
  // What they said before isn't said again (src/memory/gate.ts).
  if (!r || r.from === "memory") return;
  const answers = answersOf({ rounds: [r] }).map((a) => ({ qid: a.id, q: a.question, a: a.text, how: a.how }));
  await rememberRound(store, { flow, key, about, answers }).catch(() => {});
}

/** A round answered: the last one, sent with what the box left. */
const withForm = (s: AskingState, form: FlowState): AskingState => ({ ...s, rounds: s.rounds.map((x, i) => (i === s.rounds.length - 1 ? { ...x, form } : x)) });

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "a page";
  }
};

/**
 * A brief's interview, as the app runs it before writing (`briefHost` in src/ui/space/chat/store.ts):
 * code's own questions first, then Qalam AI's turns on what it would be written from, under the bench's
 * guard. A web lookup runs before the next turn (the app runs it while they answer), and they say Look it
 * up when one is put to them; a project lookup lands empty, as the plan's do here.
 */
async function briefInterview(store: OrgStore, req: Omit<BriefRequest, "asked">, player: Player, deps: MarketDeps, t: Tap, signal: AbortSignal, sent?: (at: string, body: unknown) => void): Promise<BriefInterview & { asked: BriefAsked }> {
  const say = emit(t);
  const questions: PlanQuestion[][] = [];
  let s: AskingState = emptyAsking(briefRound(req.shape ?? "build"));
  let made = 0;
  let ended: Ended | undefined;
  for (let turns = 0; ; ) {
    for (const l of s.lookups.filter((x) => x.state === "running")) {
      if (l.kind !== "web") {
        s = lookupLanded(s, l.id, { lines: [] });
        continue;
      }
      const look = await lookForPlan(store, { said: `What's needed to build or run: ${req.card.title}`.slice(0, 4000), outline: [], rounds: [], looks: [], ...(l.query ? { query: l.query } : {}) }, say, signal, deps).catch((e: unknown) => {
        if (signal.aborted) throw e;
        return null;
      });
      s = lookupLanded(s, l.id, look ? { look, lines: look.lines.map((x, i) => ({ ref: `${l.id}-${i + 1}`, text: x.text, from: x.url ? hostOf(x.url) : "a page", whose: "a page online", ...(x.url ? { url: x.url } : {}), ...(x.quote ? { quote: x.quote } : {}) })) } : { error: "It failed" });
    }
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
      s = withForm(s, await answerRound(player, r, { flow: "brief", round: s.rounds.length - 1 }, signal));
      await rememberIn(store, "brief", `brief-${req.card.id}`, { product: null, card: req.card.id }, s);
      continue;
    }
    if (next === "wait") continue;
    if (turns++ >= BENCH_TURNS) {
      ended = "guard";
      break;
    }
    s = markRead(s);
    const asking = askingIn(s, { said: "" });
    const body = { ...req, asked: askedFromAnswers(answersOf(s)) };
    sent?.("briefs/ask", { ...body, asking });
    s = applyTurn(s, await askBrief(store, body, asking, say, signal, { structured: deps.structured }), { now: Date.now(), id: (p) => `${p}${++made}` });
  }
  const answers = answersOf(s);
  return { questions, ...(ended ? { ended } : {}), answers, asked: askedFromAnswers(answers) };
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
      s = withForm(s, await answerRound(player, r, { flow: "plan", round: s.rounds.length - 1 }, signal));
      await rememberIn(store, "plan", "plan", { product: null }, s);
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
  const first = await proposePlan(store, withAsking(), say, signal, deps);
  // Checked before the review opens (src/challenge/), as the window does: the person keeps what their own
  // evidence says, and it's proposed again by that, once, as the real-app driver does.
  const checks: CheckedRun[] = [];
  const check = async (d: PlanDraft, origin: string) => {
    const items = itemsOfDraft(d);
    if (!items.length) return null;
    const req: CheckRequest = { origin, asked: said, product: null, outline: body.outline.map((c) => ({ id: c.id, kind: c.kind, title: c.title, parent: c.parent, ...(c.topic ? { topic: c.topic } : {}) })), items };
    bodies.push({ path: "challenge", body: req });
    const run = await challengeProposals(store, req, say, signal, deps);
    checks.push({ ...run, titles: Object.fromEntries(items.map((i) => [i.id, i.title])) });
    return run;
  };
  let draft = first;
  const checked = await check(first, "plan:bench");
  if (checked?.challenges.length) {
    const kept = checked.challenges.map((c) => ({ line: c.line, from: c.cites.map((x) => x.text).slice(0, 4) }));
    const found = [...new Set(checked.challenges.flatMap((c) => c.cites.flatMap((x) => (x.piece ? [x.piece] : []))))];
    sent("plan/propose", { kept, found });
    draft = await proposePlan(store, { ...withAsking(), kept, ...(found.length ? { found } : {}) }, say, signal, deps);
    await check(draft, "plan:bench-again");
  }
  const made2 = await briefForDraft(store, draft, player, deps, t, signal, (at, body) => void bodies.push({ path: at, body }));
  return { path: "plan", said, route, body: withAsking(), questions, draft, ...(draft !== first ? { before: first } : {}), checks, brief: made2?.brief ?? null, ...(made2 ? { briefAsk: made2.asked } : {}), bodies, ended };
}

/**
 * The consultant's road, as `consultOn` and the plan's host run it in the window: no look before an
 * answer, each turn through the core with who's asking and the playbook in use, rounds paced to the level
 * the read found (the person never presses Explain more here), what it notes kept, then the proposal and
 * its check. No brief: what it proposes is a diagnosis to check first.
 */
export async function consultFlow(store: OrgStore, p: Persona, player: Player, t: Tap, signal: AbortSignal, o: { firstRoundOnly?: boolean; outline?: OutlineCard[]; deps?: MarketDeps } = {}): Promise<PlanRun> {
  const deps = tapped(o.deps ?? realDeps, t);
  const said = p.opener.slice(0, 4000);
  const body: PlanBody = { said, outline: o.outline ?? (await outlineOf(store)), rounds: [], looks: [], mode: "consult" };
  const questions: PlanQuestion[][] = [];
  const say = emit(t);
  const bodies: { path: string; body: unknown }[] = [];
  const detail: ConsultDetail = { situation: null, playbook: null, rounds: [], lookups: [], noted: [], business: emptyBusiness() };
  let s: AskingState = emptyAsking();
  let since = 1;
  const level = () => levelOf({ read: detail.situation?.level ?? null });
  const consultIn = () => ({ level: level(), ...(detail.situation ? { situation: detail.situation } : {}), ...(detail.playbook ? { playbook: detail.playbook as PlaybookId } : {}) });
  const withAsking = (): PlanBody => ({ ...body, consult: consultIn(), asking: askingIn(s, { said, memory: { flow: "consult", key: "consult", about: { product: null } } }) });
  const answered = () => s.rounds.filter((r) => r.form.submitted).length;
  const run = async (l: Lookup) => {
    if (l.kind !== "web") return void (s = lookupLanded(s, l.id, { lines: [] }));
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
      detail.lookups.push({ kind: "web", query: s.offer.query, ...(s.offer.why ? { why: s.offer.why } : {}), afterAnswered: answered() });
      s = startLookup(s, { id: s.offer.id, kind: "web", query: s.offer.query, waits: s.turns }, Date.now());
      continue;
    }
    if (next === "ask") {
      const r = currentRound(s)!;
      questions.push(r.questions);
      detail.rounds.push({ questions: r.questions, level: level(), ...(r.reflect ? { reflect: r.reflect } : {}) });
      if (o.firstRoundOnly) break;
      s = withForm(s, await answerRound(player, r, { flow: "consult", round: s.rounds.length - 1 }, signal));
      await rememberIn(store, "consult", "consult", { product: null }, s);
      continue;
    }
    if (next === "wait") continue;
    if (turns++ >= BENCH_TURNS) {
      ended = "guard";
      break;
    }
    const sent = withAsking();
    bodies.push({ path: "plan/next", body: JSON.parse(JSON.stringify(sent)) });
    s = markRead(s);
    const turn = (await planNext(store, sent, say, signal, deps)) as ConsultTurn;
    // What the window's host keeps of a turn (`keepConsult`): who's asking, the playbook (a switch holds a while), what it noted.
    if (turn.situation) detail.situation = turn.situation;
    const now = (detail.playbook ?? detail.situation?.layer ?? null) as Layer | null;
    if (now) {
      const next2 = turn.picked ? nextPlaybook(now, turn.picked, { turn: s.turns + 1, since }) : { playbook: now, since };
      detail.playbook = next2.playbook;
      since = next2.since;
    }
    if (turn.noted?.length) detail.noted.push(...turn.noted);
    for (const l of turn.lookups) if (l.kind !== "tools") detail.lookups.push({ kind: l.kind, query: l.query, ...(l.why ? { why: l.why } : {}), afterAnswered: answered() });
    const cap = capFor(level());
    s = applyTurn(s, turn, { now: Date.now(), id: (x) => `${x}${++made}`, ...(cap ? { cap } : {}), openFirst: level() === "new" });
  }
  detail.business = await store.getBusiness();
  if (o.firstRoundOnly) return { path: "plan", said, route: { job: "consult" }, body: withAsking(), questions, draft: null, brief: null, firstRoundOnly: true, bodies, ...(ended ? { ended } : {}), consult: detail };
  bodies.push({ path: "plan/propose", body: withAsking() });
  const draft = await proposePlan(store, withAsking(), say, signal, deps);
  const checks: CheckedRun[] = [];
  const items = itemsOfDraft(draft);
  if (items.length) {
    const req: CheckRequest = { origin: "consult:bench", asked: said, product: null, outline: body.outline.map((c) => ({ id: c.id, kind: c.kind, title: c.title, parent: c.parent, ...(c.topic ? { topic: c.topic } : {}) })), items };
    const checked = await challengeProposals(store, req, say, signal, deps).catch(() => null);
    if (checked) checks.push({ ...checked, titles: Object.fromEntries(items.map((i) => [i.id, i.title])) });
  }
  detail.business = await store.getBusiness();
  return { path: "plan", said, route: { job: "consult" }, body: withAsking(), questions, draft, checks, brief: null, bodies, ...(ended ? { ended } : {}), consult: detail };
}

/** A plan's cards as the window sends them to be checked: by their proposals' ids, each under a card on the canvas or another card of the draft. */
export function itemsOfDraft(d: PlanDraft): CheckItem[] {
  const idOf = (c: PlanCard) => `${c.kind === "solution" ? "sol" : "plan"}:${c.ref}`;
  const byRef = new Map(d.cards.map((c) => [c.ref, c]));
  return d.cards.map((c) => {
    const under = c.under ? ("ref" in c.under ? byRef.get(c.under.ref) : null) : null;
    return {
      id: idOf(c),
      kind: c.kind,
      title: c.title,
      ...(c.description ? { description: c.description } : {}),
      ...(c.how ? { how: c.how } : {}),
      ...(c.assumptions.length ? { assumptions: c.assumptions.map((a) => a.text) } : {}),
      parent: under ? idOf(under) : c.under && "card" in c.under ? c.under.card : null,
      ...(c.kind !== "outcome" && c.came ? { assumed: true as const } : {}),
    };
  });
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
async function briefForDraft(store: OrgStore, d: PlanDraft, player: Player, deps: MarketDeps, t: Tap, signal: AbortSignal, sent: (at: string, body: unknown) => void) {
  const start = d.cards.find((c) => c.ref === d.start) ?? d.cards.find((c) => c.kind === "solution");
  if (!start) return null;
  const shape = shapeOf(start);
  const refOf = (c: PlanCard) => (c.under && "ref" in c.under ? c.under.ref : null);
  const above = (c: PlanCard) => d.cards.find((x) => x.ref === refOf(c)) ?? null;
  const chain: PlanCard[] = [];
  for (let at = above(start); at; at = above(at)) chain.push(at);
  const problem = chain.find((c) => c.kind === "opportunity") ?? null;
  const goal = chain.find((c) => c.kind === "outcome") ?? null;
  const base: Omit<BriefRequest, "asked"> = {
    card: { ...wordsOf(start), id: start.ref, kind: start.kind === "outcome" ? "outcome" : start.kind === "opportunity" ? "opportunity" : "solution" },
    goal: goal ? { title: goal.title, metric: goal.metric ? [goal.metric.name, goal.metric.target != null ? `target ${goal.metric.target}` : ""].filter(Boolean).join(", ") : null } : null,
    problem: problem ? wordsOf(problem) : null,
    under: [],
    others: d.cards.filter((c) => c.kind === "solution" && c.ref !== start.ref && refOf(c) === refOf(start)).map((c) => c.title),
    ...(shape !== "build" ? { shape } : {}),
  };
  const { asked: said, ...asked } = await briefInterview(store, base, player, deps, t, signal, sent);
  const req: BriefRequest = { ...base, asked: said };
  sent("briefs", req);
  const meta = await writeCardBrief(store, req, signal, { structured: deps.structured });
  const markdown = await store.getBrief(meta.id).then((x) => x?.body ?? "").catch(() => "");
  return { brief: { id: meta.id, markdown, shape, card: start.title }, asked };
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
  // What they told it while it read, remembered as the core remembers it (server/org/scan.ts, steerScan).
  await rememberRound(store, { flow: "steer", key: "steer", about: { product: null }, answers: allTold.map((x) => ({ qid: questionKey(x.question), q: x.question, a: x.answer, how: saysDontKnow(x.answer) ? ("unknown" as const) : ("own" as const) })) }).catch(() => {});
  const deps = scanDeps(t);
  const session = await scanToEnd(store, { target, country: "us", told: allTold }, deps, signal);
  const sources = session.read.flatMap((r) => (r.sourceId ? [r.sourceId] : []));
  const { needs } = await needsNow(store).catch(() => ({ needs: [] as Awaited<ReturnType<typeof needsNow>>["needs"] }));
  const problems = await Promise.all(needs.map(async (n) => ({ title: n.title, line: needLine(n), lines: ((await store.getTopic(n.topic))?.lines ?? []).map((l) => ({ section: l.section, text: l.text })) })));
  const out: ScanRun = { ...base, startAsked: allTold, session, questions: [steer], problems };
  if (!sources.length) return out;
  const plan = { target, sources, told: allTold };
  // The interview before what to build first, as the app runs it (src/asking/), under the bench's own guard; lookups land empty here.
  let s: AskingState = emptyAsking();
  let made = 0;
  for (let turns = 0; ; ) {
    for (const l of s.lookups.filter((x) => x.state === "running")) s = lookupLanded(s, l.id, { lines: [] });
    const next = nextAfter(s);
    if (next === "end") {
      out.ended = s.end?.by;
      break;
    }
    if (next === "offer") {
      s = askInstead(s);
      continue;
    }
    if (next === "ask") {
      const r = currentRound(s)!;
      out.questions.push(r.questions);
      s = withForm(s, await answerRound(player, r, { flow: "scan-plan", round: s.rounds.length - 1 }, signal));
      await rememberIn(store, "scan", "scan-plan", { product: null }, s);
      continue;
    }
    if (next === "wait") continue;
    if (turns++ >= BENCH_TURNS) {
      out.ended = "guard";
      break;
    }
    s = markRead(s);
    s = applyTurn(s, await askScanPlan(store, { ...plan, asking: askingIn(s, { said: "" }) }, () => {}, signal), { now: Date.now(), id: (p) => `${p}${++made}` });
  }
  const said2 = [...allTold, ...answersOf(s).filter((a) => a.how === "own" && a.text).map((a) => ({ question: a.question, answer: a.text }))];
  out.kept = said2;
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
  // The brief's interview, on the pick as it lands on the canvas: under its problem's page and the first goal.
  const none = { description: "", assumptions: [], tests: [], evidence: [] };
  const { asked: bAsked, ...bAsk } = await briefInterview(
    store,
    {
      card: { id: "bench-card", kind: "solution", title: chosen.title, description: chosen.description, assumptions: chosen.assumptions.map((x) => x.text), tests: chosen.test ? [{ what: chosen.test.what, how: chosen.test.how, suggested: chosen.test.suggested ?? null }] : [], evidence: [], topic: build.topic },
      goal: { title: goal.title, metric: goal.metric },
      problem: { ...none, title: build.problem, topic: build.topic },
      under: [],
      others: build.drafts.filter((d) => d.id !== chosen.id).map((d) => d.title),
    },
    player,
    tapped(realDeps, t),
    t,
    signal,
  );
  out.briefAsk = bAsk;
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
    asked: bAsked,
    known: session.known ?? [],
  }, signal);
  if (meta) out.brief = { id: meta.id, markdown: await store.getBrief(meta.id).then((x) => x?.body ?? "").catch(() => "") };
  return out;
}
