import { nanoid } from "nanoid";
import { create } from "zustand";
import { AIError, aiStatus, callAI } from "@/ai/client";
import { addCardIn, makeCardNode, newCard } from "@/discovery/ops";
import { sourcesDb } from "@/discovery/db";
import { DUMP_MAX_CHARS, MAX_DUMP_ROUNDS, applyDumpFollowup, closeDumpRound, firstRound, fragmentRefs, roundAnswers, sanitizeDumpFollowup, sanitizeRead, withRoles } from "@/discovery/dump";
import { IngestError } from "@/discovery/ingest/core";
import { quoteEvidence, type SourceRecord } from "@/discovery/sources";
import { newId } from "@/doc/factory";
import { emptyDoc } from "@/doc/schema";
import { currentOrg, orgFetch } from "@/org/client";
import { changeGoal, createGoal, goalWords, goalsNow } from "@/goals/client";
import { textGoalId } from "@/goals/migrate";
import { sanitizeShaped, type OutlineGoal, type ShapedGoal } from "@/goals/outline";
import { goalById } from "@/goals/tree";
import { sameTopic } from "@/hub/topics";
import { saveAbout, saveProduct, useOrgContext } from "@/org/context";
import { emptyContext } from "@/org/context-md";
import { applyLines, boardGoals, decide, sanitizeSetup, setupSent, type OrgNow, type PlaceSays, type SetupLine, type SetupSession } from "@/org/setup";
import { projectHref } from "@/projects/model";
import { createProject } from "@/projects/session";
import { initialFlow, type FlowState } from "../ai/questionFlow";
import { ingestPaste, ingestUrl } from "../discovery/ingest";

/*
 * Setting the organization up from a brain dump about it, in this window: what they wrote (or the
 * company's website) is kept as a brain dump of the organization's, Qalam AI reads it, asks up to
 * three rounds of questions, then proposes the About and the products, line by line (each checked
 * by src/org/setup.ts). Accepting a line writes it to about.md, the product's file or goals.md. How
 * it's going lives on the source, so a reload picks it up; what they said goes on the topic pages
 * once every line is settled, and each goal they accepted can start a board. Or they write their
 * goals down themselves, and Qalam AI only reads each line's number (src/goals/outline.ts).
 */

export interface SetupUI {
  /** The setup's source (its session on it), once there is one. */
  source: SourceRecord | null;
  /** A call running, and how far it's got. */
  busy: { label: string; started: number; tokens: number } | null;
  /** Reading the page or the text failed before there was a source. */
  error: string | null;
  /** What they sent, while the page is fetched and before there's a source to keep it on. */
  pending: { text: string; url: string } | null;
}

export const useSetup = create<SetupUI>(() => ({ source: null, busy: null, error: null, pending: null }));

const PATH = "/api/setup";
let run: AbortController | null = null;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const source = () => useSetup.getState().source;

async function update(fn: (s: SourceRecord) => SourceRecord) {
  const s = source();
  if (!s) return;
  const next = fn(s);
  useSetup.setState({ source: next });
  await sourcesDb.put(next);
}

const setSession = (fn: (x: SetupSession) => SetupSession, quotes?: (s: SourceRecord) => SourceRecord["quotes"]) =>
  update((s) => (s.setup ? { ...s, setup: fn(s.setup), ...(quotes ? { quotes: quotes(s) } : {}) } : s));

/** The setup this page shows: the one named, else the latest not finished. Interrupted steps can be tried again. */
export async function openSetup(id: string | null) {
  const list = id ? [await sourcesDb.get(id).catch(() => null)] : await sourcesDb.all().catch(() => [] as SourceRecord[]);
  const found = list
    .filter((s): s is SourceRecord => !!s?.setup && (!!id || s.setup.phase !== "done"))
    .sort((a, b) => b.addedAt - a.addedAt)[0];
  useSetup.setState({ source: found ?? null, error: null });
  const p = found?.setup?.phase;
  if (found && (p === "reading" || p === "analyzing" || p === "placing") && !run) await setSession((d) => ({ ...d, phase: "failed", failed: { at: p, error: "Interrupted: the page was closed or reloaded." } }));
}

/** The organization as setup reads it: what it and each product say, with their goals' words (goals.md). */
function orgNow(): OrgNow {
  const { about, products } = useOrgContext.getState();
  return { about: { ...about, goals: goalWords(null) }, products: products.map((p) => ({ ...p, goals: goalWords(p.id) })) };
}

/** The organization as the calls name it: its name, its About, its products (p1…, in the order `setupSent` names them). */
function orgFields(name: string, now: OrgNow) {
  const fields = (c: PlaceSays) => ({ audience: c.audience.slice(0, 2000), goals: c.goals.slice(0, 30).map((g) => g.slice(0, 300)), context: c.context.slice(0, 4000), segments: c.segments.slice(0, 30).map((g) => g.slice(0, 200)) });
  return { name: name.slice(0, 80), about: fields(now.about), products: now.products.slice(0, 30).map((p, i) => ({ id: `p${i + 1}`, name: p.name.slice(0, 80), ...fields(p) })) };
}

/** The pieces and the pushback as a call names them (f1…). */
function readFields(s: SourceRecord) {
  const session = s.setup!;
  const pieces = fragmentRefs(s.quotes);
  const refOf = new Map(pieces.map((p) => [p.q.id, p.ref]));
  return {
    pieces,
    fields: {
      understanding: session.understanding.slice(0, 1200),
      fragments: pieces.map(({ ref, q }) => ({ id: ref, quote: q.text.slice(0, 1200), role: q.role ?? "context" })),
      challenges: session.challenges
        .filter((c) => refOf.has(c.quoteId))
        .slice(0, 12)
        .map((c) => ({ kind: c.kind, fragmentId: refOf.get(c.quoteId)!, text: c.text.slice(0, 400) })),
    },
  };
}

/** A call, with its progress on the page and Stop. */
async function call(label: string, body: unknown): Promise<{ raw: unknown; model?: string }> {
  run?.abort();
  const ctrl = new AbortController();
  run = ctrl;
  useSetup.setState({ busy: { label, started: Date.now(), tokens: 0 } });
  try {
    const { data, model } = await callAI<unknown>(PATH, body, (tokens) => useSetup.setState((u) => (u.busy ? { busy: { ...u.busy, tokens } } : {})), ctrl.signal);
    return { raw: data, model };
  } finally {
    if (run === ctrl) run = null;
    useSetup.setState({ busy: null });
  }
}

/** A call that didn't finish: the session says where, so Try again runs that step again. */
const failed = (at: "reading" | "analyzing" | "placing", e: unknown) => setSession((s) => ({ ...s, phase: "failed", failed: { at, error: (e as Error).name === "AbortError" ? "Stopped." : message(e) } }));

// ---------------------------------------------------------------------------
// Read

/** What they wrote and the page they pointed at, as one brain dump: kept as a source of the organization's, then read. */
export async function startSetup(input: { text: string; url: string }) {
  run?.abort();
  const ctrl = new AbortController();
  run = ctrl;
  // What they sent shows at once, with the reading under way (Stop works on the page fetch too).
  useSetup.setState({ error: null, pending: { text: input.text.trim(), url: input.url.trim() }, busy: { label: input.url.trim() ? "Reading the page" : "Reading what you wrote", started: Date.now(), tokens: 0 } });
  const fail = (error: string | null) => useSetup.setState({ error, pending: null, busy: null });
  let text = input.text.trim();
  let origin: string | undefined;
  try {
    if (!(await aiStatus()).ai) return fail("Qalam AI isn't set up here, so it can't read what you wrote. Fill in the organization by hand from its home.");
    if (input.url.trim()) {
      const page = await ingestUrl(input.url.trim(), ctrl.signal);
      origin = page.origin;
      text = [text, `From ${page.title}:\n${page.text.trim()}`].filter(Boolean).join("\n\n");
    } else text = (await ingestPaste(text)).text.trim();
  } catch (e) {
    return fail((e as Error).name === "AbortError" ? null : e instanceof IngestError ? e.message : `Qalam couldn't read that: ${message(e)}`);
  } finally {
    if (run === ctrl) run = null;
  }
  if (text.length < 40) return fail("There's too little there to set anything up from. Write a few sentences about the company.");
  const org = await currentOrg();
  const rec: SourceRecord = {
    v: 1,
    id: newId(),
    projectId: "",
    boards: [],
    product: null,
    kind: "dump",
    title: `About ${org.name}`,
    ...(origin ? { origin } : {}),
    text: text.slice(0, DUMP_MAX_CHARS),
    addedAt: Date.now(),
    read: [],
    quotes: [],
    needs: [],
    setup: { v: 1, phase: "reading", ...(input.text.trim() ? { said: input.text.trim().slice(0, DUMP_MAX_CHARS) } : {}), understanding: "", challenges: [], buckets: [] },
  };
  await sourcesDb.put(rec);
  useSetup.setState({ source: rec, pending: null, busy: null });
  await readSetup();
}

/** Have Qalam AI read it: what it took from it, its pieces, its pushback, the first round. */
export async function readSetup() {
  const s = source();
  if (!s?.setup) return;
  await setSession((d) => ({ ...d, phase: "reading", failed: undefined }));
  try {
    const org = await currentOrg();
    const { raw, model } = await call("Qalam AI is reading what you wrote", { stage: "read", ...orgFields(org.name, orgNow()), dump: s.text });
    const r = sanitizeRead(raw, s.text, []);
    if (!r.fragments.length) throw new AIError("parse", "Qalam AI found nothing in it to set up from. Try again, or write a little more.");
    await update((x) => ({
      ...x,
      quotes: r.fragments,
      setup: { ...x.setup!, phase: r.questions.length ? "asking" : "ready", failed: undefined, understanding: r.understanding, challenges: r.challenges, buckets: firstRound(r.questions), ...(model ? { model } : {}) },
    }));
  } catch (e) {
    return void (await failed("reading", e));
  }
  if (!source()?.setup?.buckets.length) await placeSetup();
}

// ---------------------------------------------------------------------------
// Rounds of questions

let saving: ReturnType<typeof setTimeout> | undefined;
/** The round's answers as they're given (kept, so a reload doesn't lose them). */
export function saveSetupRound(form: FlowState) {
  clearTimeout(saving);
  saving = setTimeout(() => void setSession((s) => ({ ...s, buckets: s.buckets.map((b, i) => (i === s.buckets.length - 1 ? { ...b, form } : b)) })), 500);
}

/** They answered the round: Qalam AI reads the answers. */
export async function answerSetupRound(form: FlowState) {
  clearTimeout(saving);
  await setSession((s) => closeDumpRound(s, form, "analyzing"));
  await readSetupAnswers();
}

/** They leave the rest to Qalam AI: it proposes with what it has. */
export async function skipSetupRest(form?: FlowState) {
  clearTimeout(saving);
  await setSession((s) => closeDumpRound(s, form ?? s.buckets[s.buckets.length - 1]?.form ?? initialFlow([]), "skipped"));
  await placeSetup();
}

/** Qalam AI reads the last round's answers: the next round, or ready (then it proposes). */
export async function readSetupAnswers() {
  const s = source();
  const session = s?.setup;
  if (!s || !session) return;
  await setSession((d) => ({ ...d, phase: "analyzing", failed: undefined }));
  const { pieces, fields } = readFields(s);
  const rounds = roundAnswers(session).map((answers, i) => ({ answers: answers.map((a) => ({ question: a.question.slice(0, 200), answer: a.answer })), ...(session.buckets[i]?.analysis ? { analysis: session.buckets[i].analysis!.slice(0, 1500) } : {}) }));
  try {
    const org = await currentOrg();
    const { raw } = await call("Qalam AI is reading your answers", { stage: "followup", ...orgFields(org.name, orgNow()), dump: s.text, ...fields, rounds, last: session.buckets.length >= MAX_DUMP_ROUNDS });
    const f = sanitizeDumpFollowup(raw, pieces, []);
    await setSession((d) => applyDumpFollowup(d, f), (x) => withRoles(x.quotes, f.roles));
  } catch (e) {
    return void (await failed("analyzing", e));
  }
  if (source()?.setup?.phase === "ready") await placeSetup();
}

// ---------------------------------------------------------------------------
// Proposals, line by line

/** Have Qalam AI propose the About and the products, checked line by line before they're shown. */
export async function placeSetup() {
  const s = source();
  const session = s?.setup;
  if (!s || !session) return;
  await setSession((d) => ({ ...d, phase: "placing", failed: undefined }));
  try {
    const org = await currentOrg();
    const now = orgNow();
    const sent = setupSent(org.name, s, session, now);
    const { fields } = readFields(s);
    const { raw, model } = await call("Qalam AI is setting up your organization", {
      stage: "place",
      ...orgFields(org.name, now),
      dump: s.text,
      ...fields,
      answers: sent.answers.map((a) => ({ id: a.ref, question: a.question.slice(0, 400), answer: a.answer.slice(0, 2000) })),
    });
    const proposal = sanitizeSetup(raw, sent);
    await setSession((d) => ({ ...d, phase: proposal.lines.length ? "review" : "done", proposal, decided: {}, ...(model ? { model } : {}) }));
  } catch (e) {
    await failed("placing", e);
  }
}

/** Every line is settled: what they said goes on the topic pages too, filed by the core (it carries on when this page is left for a board). */
function settled() {
  const s = source();
  if (s?.setup?.phase === "done") void orgFetch("/file", { method: "POST", json: { sources: [s.id] } }).catch(() => {});
}

/** The goal a setup line made: named by its words, so making it twice makes one. */
const lineGoalId = (text: string, product: string | null) => textGoalId(product ? `${product}:${text}` : text);

/** The product a line is for (null: the whole organization; undefined: a new one not made yet). */
const lineProduct = (l: SetupLine, made: Record<string, string> | undefined): string | null | undefined => (l.to === "org" ? null : l.to.startsWith("new:") ? made?.[l.to.slice(4)] : l.to);

/** The goal a goal line's parent line made, once it's there. */
function parentGoal(l: SetupLine, lines: SetupLine[], made: Record<string, string> | undefined): string | null {
  const parent = lines.find((x) => x.id === l.parent);
  const product = parent && lineProduct(parent, made);
  if (!parent || product === undefined) return null;
  const id = lineGoalId(parent.text, product);
  return goalById(goalsNow(), id) ? id : null;
}

/** How far down the proposal's tree a goal line sits (its parents are made first). */
function depthOf(l: SetupLine, lines: SetupLine[]): number {
  let n = 0;
  for (let at = l.parent; at && n < 20; at = lines.find((x) => x.id === at)?.parent) n++;
  return n;
}

/**
 * Accept lines: each is written to about.md or its product's file (a new product is made with its
 * first), and each goal goes in goals.md with its number, under the goal it feeds once that one is
 * there: the organization's first goal under none, its North Star.
 */
export async function acceptLines(lineIds: string[]) {
  const session = source()?.setup;
  if (!session?.proposal) return;
  const all = session.proposal.lines;
  const lines = all.filter((l) => lineIds.includes(l.id) && !session.decided?.[l.id]);
  if (!lines.length) return;
  const w = applyLines(orgNow(), session.proposal, lines, session.made, () => nanoid(10));
  if (w.about) await saveAbout(w.about);
  for (const p of w.products) await saveProduct(p);
  for (const g of [...w.goals].sort((a, b) => depthOf(a.line, all) - depthOf(b.line, all))) {
    const parent = parentGoal(g.line, all, w.made);
    await createGoal({
      id: lineGoalId(g.line.text, g.product),
      title: g.line.text,
      product: g.product,
      ...(parent ? { parent } : {}),
      ...(g.line.metric ? { metric: g.line.metric } : {}),
      cites: g.line.pieces.map((q) => `hub:quote:${q}`),
      by: "qalam",
      ...(g.product || g.line.parent ? {} : { north: "if-none" as const }),
    });
  }
  // A goal accepted before the goal it feeds goes under it now (unless someone has moved it since).
  const accepted = new Set([...Object.entries(session.decided ?? {}).flatMap(([id, d]) => (d === "accepted" ? [id] : [])), ...lines.map((l) => l.id)]);
  for (const l of all) {
    const product = lineProduct(l, w.made);
    if (l.field !== "goals" || !l.parent || !accepted.has(l.id) || !accepted.has(l.parent) || product === undefined) continue;
    const id = lineGoalId(l.text, product);
    const parent = parentGoal(l, all, w.made);
    if (parent && goalById(goalsNow(), id)?.parent === null) await changeGoal(id, { parent }).catch(() => {});
  }
  await setSession((d) => decide(d, lines.map((l) => l.id), "accepted", w.made));
  settled();
}

export async function discardLines(lineIds: string[]) {
  await setSession((d) => decide(d, lineIds, "discarded"));
  settled();
}

/** A board for a goal they accepted: the goal its outcome, resting on their words, for the goal's product. */
export async function startBoard(lineId: string) {
  const s = source();
  const session = s?.setup;
  const goal = session && boardGoals(session).find((g) => g.line.id === lineId);
  if (!s || !session || !goal) return;
  const made = session.boards?.[lineId];
  if (made) return window.location.assign(projectHref({ id: made, type: "discovery" }));
  const quotes = goal.line.pieces.flatMap((id) => s.quotes.find((q) => q.id === id) ?? []);
  // The goal the line made, as it is now (its words and number may have changed since).
  const g = goalById(goalsNow(), lineGoalId(goal.line.text, goal.product)) ?? goalsNow().goals.find((x) => x.product === goal.product && !x.on && sameTopic(x.title, goal.line.text));
  const doc = emptyDoc();
  const node = makeCardNode(newCard("outcome", { title: g?.title ?? goal.line.text, ...(g?.metric ? { metric: g.metric } : {}), evidence: quotes.map((q) => quoteEvidence(s, q, "user")) }));
  addCardIn(doc, node, null);
  const p = await createProject("discovery", (g?.title ?? goal.line.text).slice(0, 80), goal.product ? { product: goal.product } : {}, doc);
  // The board's outcome card is the goal on the canvas.
  if (g) await changeGoal(g.id, { on: { board: p.id, card: node.id } }).catch(() => {});
  await sourcesDb.link(s.id, p.id, true);
  await setSession((d) => ({ ...d, boards: { ...d.boards, [lineId]: p.id } }));
  window.location.assign(projectHref(p));
}

// ---------------------------------------------------------------------------
// Goals they write down themselves

/** Qalam AI reads each line of their goals (and what they answered about its number); code keeps what holds. */
export async function shapeGoals(goals: OutlineGoal[], answers: ReadonlyMap<string, string>): Promise<ShapedGoal[]> {
  const org = await currentOrg();
  const products = useOrgContext.getState().products.slice(0, 30).map((p, i) => ({ ref: `p${i + 1}`, id: p.id, name: p.name }));
  const { raw } = await call(answers.size ? "Qalam AI is reading your answers" : "Qalam AI is reading your goals", {
    stage: "shape",
    name: org.name.slice(0, 80),
    products: products.map((p) => ({ id: p.ref, name: p.name.slice(0, 80) })),
    goals: goals.map((g) => ({ id: g.ref, text: g.text, parent: g.parent })),
    answers: [...answers].map(([id, answer]) => ({ id, answer: answer.slice(0, 600) })),
  });
  return sanitizeShaped(raw, { goals, products, answers });
}

/** Add the goals they wrote, in their words: products they named are made first, each goal goes under the one it feeds, the first top one the North Star. */
export async function addShapedGoals(goals: ShapedGoal[]): Promise<string[]> {
  const made = new Map<string, string>();
  for (const g of goals) {
    if (!g.product || !("name" in g.product) || made.has(g.product.name.toLowerCase())) continue;
    const p = { id: nanoid(10), name: g.product.name, ...emptyContext() };
    await saveProduct(p);
    made.set(g.product.name.toLowerCase(), p.id);
  }
  const ids = new Map<string, string>();
  for (const g of goals) {
    const product = !g.product ? null : "id" in g.product ? g.product.id : (made.get(g.product.name.toLowerCase()) ?? null);
    const parent = g.parent ? ids.get(g.parent) : undefined;
    const goal = await createGoal({ title: g.title, product, ...(parent ? { parent } : {}), ...(g.metric ? { metric: g.metric } : {}), by: "person", ...(parent ? {} : { north: "if-none" as const }) });
    ids.set(g.ref, goal.id);
  }
  return [...ids.values()];
}

// ---------------------------------------------------------------------------
// Stop, Try again

export const stopSetup = () => run?.abort();

/** Run the step that didn't finish again. */
export function retrySetup() {
  const at = source()?.setup?.failed?.at;
  if (useSetup.getState().busy) return;
  if (at === "reading") void readSetup();
  else if (at === "analyzing") void readSetupAnswers();
  else if (at === "placing") void placeSetup();
}
