import { contextFor } from "@/org/context";
import { partSpans, type TextPart } from "@/space/find";
import { useMarket } from "@/org/market";
import { marketText } from "@/market/text";
import { create } from "zustand";
import { studio } from "@/doc/store";
import { newId } from "@/doc/factory";
import { emptyBrief } from "@/doc/brief";
import { worldBounds } from "@/doc/geometry";
import { treeBounds } from "@/doc/board";
import { clearGhosts, useGhosts } from "@/doc/ghosts";
import { AIError, type AIDelta } from "@/ai/client";
import { parsePartial } from "@/ai/partial-json";
import { SAMPLE_DUMP_FOLLOWUP_RAW, SAMPLE_DUMP_PLACE_RAW, SAMPLE_DUMP_READ_RAW, SAMPLE_DUMP_TEXT } from "@/ai/fixtures-discovery";
import {
  DUMP_MAX_CHARS,
  MAX_DUMP_ROUNDS,
  MAX_LOOKS,
  applyDumpFollowup,
  briefFromDump,
  closeDumpRound,
  firstRound,
  fragmentRefs,
  outlineOf,
  roundAnswers,
  sampleRaw,
  sanitizeDumpFollowup,
  sanitizeRead,
  withRoles,
  withLook,
  withRound,
  type DumpFile,
  type DumpSession,
  type PlaceCard,
} from "@/discovery/dump";
import { hasQuote, quotePiece, type SourceRecord } from "@/discovery/sources";
import { orgContext } from "@/org/pack";
import { cardOf } from "@/discovery/ops";
import { KIND_LABEL } from "@/discovery/kinds";
import { arrangeNew, underCard, type Proposal } from "@/discovery/proposals";
import { partialPlace, sanitizePlace, type PlaceContext } from "@/discovery/place";
import { initialFlow, type FlowState } from "../ai/questionFlow";
import { openTurn, patchTurn } from "../ai/chats";
import { appendThought, endAgent, narrate, startAgent, updateAgent } from "../ai/agents";
import { getController } from "../CanvasView";
import { canvasProduct } from "@/space/view";
import { toggleChat } from "../frame/store";
import { composeIn } from "../space/chat/compose";
import { offline, runDump } from "./ai";
import { placeFor, placeSample, routeTurns, treeFor } from "./draft";
import { REVIEW_TURN, evidenceOf, ghostsFor, startReview, useReview } from "./review";
import { ingestPaste } from "./ingest";
import { addSourceRecord, sourceOf, updateSource, useSources } from "./sources";
import { fileAfterReading } from "../topics/filing";
import { boardCardRefs, hubQuotes, packProduct, recordCall } from "./knowledge";
import { useDiscovery } from "./store";
import { boardGoalIds } from "./goals";
import { lookForGoal } from "@/org/goal-work";

/*
 * A brain dump on the canvas: the builder writes their thinking in Qalam AI's chat beside it
 * (../space/chat/), Qalam AI reads it (what it took from it, its pieces, its pushback, a round of
 * questions), reads each round of answers (up to three), then places it as proposals to accept or
 * discard: cards under the cards already there, or new ones, quotes attached, edits. The dump is a
 * source (its words stay the builder's), and how it's going lives on it, so a reload picks up where
 * it was; the chat's thread is worked out from it.
 */

export interface DumpUI {
  /** A call running for a dump, and how far it's got. */
  busy: { sourceId: string; label: string; started: number; tokens: number } | null;
}

export const useDump = create<DumpUI>(() => ({ busy: null }));

const runs = new Map<string, AbortController>();

/** What the board's product (or the organization) is, then the board's own notes. */
const product = () => [contextFor(canvasProduct() ?? undefined, boardGoalIds()), studio().doc.brief?.summary ?? ""].filter(Boolean).join("\n").slice(0, 2000);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A dump's session (null when the source isn't a dump). */
export const sessionOf = (s: SourceRecord | undefined): DumpSession | null => (s?.kind === "dump" && s.dump ? s.dump : null);

async function setSession(sourceId: string, fn: (s: DumpSession) => DumpSession, quotes?: (s: SourceRecord) => SourceRecord["quotes"]) {
  await updateSource(sourceId, (s) => (s.dump ? { ...s, dump: fn(s.dump), ...(quotes ? { quotes: quotes(s) } : {}) } : s));
}

/** A brain dump in the chat: its box filled with pasted text, or (a dump's source) the chat open on its thread. */
export function openBrainDump(opts: { text?: string; sourceId?: string } = {}) {
  if (useDiscovery.getState().sheet === "start") useDiscovery.setState({ sheet: "closed" });
  if (opts.sourceId) return toggleChat(true);
  composeIn({ text: (opts.text ?? "").slice(0, DUMP_MAX_CHARS), mode: "dump" });
}

// ---------------------------------------------------------------------------
// Calls

/** The board as a dump's calls see it, now. */
const board = () => outlineOf(studio().doc);

/** What a dump that answers "Help me find one", or reads a file for a card (named as the call names it), tells each of its calls. */
function aimOf(s: DumpSession | undefined, cards: PlaceCard[]) {
  const card = s?.file && cards.find((c) => c.id === s.file!.card);
  // The problem to focus on for a goal: its card, by the id the call gives it.
  const goal = s?.aim?.goal && cards.find((c) => c.id === s.aim!.goal!.card);
  // Finding a goal or a problem, or reading a file for one: what's known about the market words the questions.
  const m = useMarket.getState();
  const market = (s?.aim || s?.file) && m.org ? marketText(m.market, { org: m.org, domain: true }) : "";
  return {
    ...(s?.aim ? { aim: { find: s.aim.find, asked: s.aim.asked, ...(goal ? { under: goal.ref } : {}) } } : {}),
    ...(s?.file && card ? { file: { title: s.file.title.slice(0, 300), card: card.ref, ...(s.file.cut ? { cut: true } : {}) } } : {}),
    ...(market ? { market } : {}),
  };
}

/** What a call for a dump is doing, in words. */
const reading = (s: DumpSession) => (s.file ? `Qalam AI is reading “${s.file.title}”` : s.aim ? "Qalam AI is reading your answers" : "Qalam AI is reading your brain dump");

/** A call for a dump, with its progress on the card and its turn, and Stop. */
async function call(sourceId: string, label: string, body: unknown, recorded: () => unknown, ms: number, onDelta?: (d: AIDelta) => void): Promise<{ raw: unknown; sample: boolean; model?: string }> {
  const s = sourceOf(sourceId);
  const session = sessionOf(s);
  const ctrl = new AbortController();
  runs.get(sourceId)?.abort();
  runs.set(sourceId, ctrl);
  useDump.setState({ busy: { sourceId, label, started: Date.now(), tokens: 0 } });
  const turn = session?.turn;
  if (turn) patchTurn(turn.chatId, turn.turnId, { status: "running", started: Date.now(), tokens: 0, error: undefined, activity: label });
  try {
    return await runDump(body, session?.sample ? recorded() : null, {
      sample: session?.sample,
      signal: ctrl.signal,
      ms,
      onDelta,
      onProgress: (tokens) => useDump.setState((u) => (u.busy?.sourceId === sourceId ? { busy: { ...u.busy, tokens } } : {})),
    });
  } finally {
    if (runs.get(sourceId) === ctrl) runs.delete(sourceId);
    useDump.setState((u) => (u.busy?.sourceId === sourceId ? { busy: null } : {}));
  }
}

/** A call that didn't finish: the session says where, so Try again runs that step again. */
async function failed(sourceId: string, at: "reading" | "analyzing" | "placing", e: unknown) {
  const stopped = (e as Error).name === "AbortError";
  const error = stopped ? "Stopped." : message(e);
  await setSession(sourceId, (s) => ({ ...s, phase: "failed", failed: { at, error } }));
  const turn = sessionOf(sourceOf(sourceId))?.turn;
  if (turn) patchTurn(turn.chatId, turn.turnId, stopped ? { status: "stopped", activity: undefined } : { status: "error", error, activity: undefined });
}

/** The turn's state once a step is done (the dump waits on the builder, or it's placed). */
function turnDone(sourceId: string, extra: { model?: string; sample?: boolean } = {}) {
  const turn = sessionOf(sourceOf(sourceId))?.turn;
  if (turn) patchTurn(turn.chatId, turn.turnId, { status: "done", activity: undefined, ...extra, outcome: { kind: "discovery", action: "dump", sourceId } });
}

/** The pieces and the pushback as a call names them (f1…, the board's cards c1…). */
function readFields(s: SourceRecord, cards: PlaceCard[]) {
  const session = s.dump!;
  const pieces = fragmentRefs(s.quotes);
  const pieceRef = new Map(pieces.map((p) => [p.q.id, p.ref]));
  const cardRef = new Map(cards.map((c) => [c.id, c.ref]));
  return {
    pieces,
    fields: {
      understanding: session.understanding.slice(0, 1200),
      fragments: pieces.map(({ ref, q }) => ({ id: ref, quote: q.text.slice(0, 1200), role: q.role ?? "context" })),
      challenges: session.challenges
        .filter((c) => pieceRef.has(c.quoteId))
        .slice(0, 12)
        .map((c) => ({ kind: c.kind, fragmentId: pieceRef.get(c.quoteId)!, cardId: (c.cardId && cardRef.get(c.cardId)) || null, text: c.text.slice(0, 400) })),
    },
  };
}

// ---------------------------------------------------------------------------
// Read

/**
 * A new dump: kept as a source (the organization's, for the canvas's product, under `id` when the
 * chat named it), read, and placed at once when Qalam AI has nothing to ask. Throws, in words, when
 * it can't start.
 */
export async function startDump(text: string, opts: { sample?: boolean; id?: string; aim?: DumpSession["aim"]; file?: DumpFile; title?: string; parts?: TextPart[]; looks?: DumpSession["looks"] } = {}): Promise<string> {
  let body = (opts.sample ? SAMPLE_DUMP_TEXT : text).trim();
  if (body.length < 40) throw new Error(opts.file ? "There's too little in the file to read." : "Write a few sentences more, so there's something to read.");
  // A file is read from its start when it's longer than a dump takes (the reading says so).
  const cut = !!opts.file && body.length > DUMP_MAX_CHARS;
  if (cut) body = body.slice(0, DUMP_MAX_CHARS);
  if (body.length > DUMP_MAX_CHARS) throw new Error(`That's more than one brain dump takes (${DUMP_MAX_CHARS.toLocaleString()} characters): add the rest as a source.`);
  if (!opts.sample && (await offline())) throw new Error("Qalam AI isn't set up here, so it can't read your text. Connections says how.");
  // The sample is about Basket: its tree goes on the board first if it isn't there.
  if (opts.sample && !studio().doc.roots.some((id) => studio().doc.nodes[id]?.meta.ost?.title === "More customers reorder every week")) placeSample();
  const read = await ingestPaste(body, opts.sample ? "Basket founder, after the investor call" : (opts.title ?? opts.file?.title));
  // Their parts of the text (the rest Qalam AI's questions, as headings), found where the text has them.
  const spans = opts.parts ? partSpans(read.text, opts.parts) : null;
  const within = spans?.theirs;
  const heads = (spans?.heads ?? []).map((span) => ({ kind: "h3" as const, span }));
  const s = studio();
  const rec: SourceRecord = {
    v: 1,
    id: opts.id ?? newId(),
    // The organization's: its cards land on the boards the canvas makes or keeps for them as it saves.
    projectId: "",
    product: canvasProduct(),
    kind: "dump",
    title: read.title,
    text: read.text,
    ...(heads.length ? { blocks: heads } : {}),
    addedAt: Date.now(),
    read: [],
    quotes: [],
    needs: [],
    dump: {
      v: 1,
      ...(within ? { within } : {}),
      phase: "reading",
      understanding: "",
      challenges: [],
      buckets: [],
      anchor: treeFor(s.doc, opts.file ? [opts.file.card] : opts.aim?.goal ? [opts.aim.goal.card] : s.selection),
      ...(opts.sample ? { sample: true } : {}),
      ...(opts.aim ? { aim: opts.aim } : {}),
      ...(opts.file ? { file: { ...opts.file, ...(cut ? { cut: true as const } : {}) } } : {}),
      ...(opts.looks?.length ? { looks: opts.looks } : {}),
    },
  };
  const turn = openTurn("discovery", { text: `Brain dump · ${read.title}` });
  rec.dump!.turn = turn;
  await addSourceRecord(rec);
  patchTurn(turn.chatId, turn.turnId, { outcome: { kind: "discovery", action: "dump", sourceId: rec.id } });
  void readDump(rec.id).then(() => {
    // Nothing to ask: Qalam AI places it straight away (a file that doesn't bear on its card waits on them).
    const d = sessionOf(sourceOf(rec.id));
    if (d?.phase === "ready" && !d.off) return placeDump(rec.id);
  });
  return rec.id;
}

/** Have Qalam AI read a dump: what it took from it, its pieces, its pushback, the first round. */
export async function readDump(sourceId: string) {
  const s = sourceOf(sourceId);
  if (!s?.dump) return;
  await setSession(sourceId, (d) => ({ ...d, phase: "reading", failed: undefined }));
  const { tree, cards } = board();
  try {
    const { raw, sample, model } = await call(sourceId, reading(s.dump), { stage: "dump-read", product: product(), dump: s.text, tree, ...aimOf(s.dump, cards) }, () => sampleRaw(SAMPLE_DUMP_READ_RAW, cards), 3500);
    const r = sanitizeRead(raw, s.text, cards, Date.now(), s.dump.within, !!s.dump.file);
    // The wrong file: what it is, and the kind that would help (they add another, or have it read anyway).
    if (s.dump.file && (!r.bears || !r.fragments.length)) {
      await updateSource(sourceId, (x) => ({ ...x, quotes: r.fragments, dump: { ...x.dump!, phase: "ready", failed: undefined, understanding: r.understanding, challenges: [], buckets: [], off: { wanted: r.wanted }, ...(model ? { model } : {}) } }));
      return turnDone(sourceId, { model, sample });
    }
    if (!r.fragments.length) throw new AIError("parse", "Qalam AI found nothing in it to place on the canvas. Try again, or write a little more.");
    await updateSource(sourceId, (x) => ({
      ...x,
      quotes: r.fragments,
      dump: { ...x.dump!, phase: r.questions.length ? "asking" : "ready", failed: undefined, understanding: r.understanding, challenges: r.challenges, buckets: firstRound(r.questions), ...(model ? { model } : {}) },
    }));
    turnDone(sourceId, { model, sample });
  } catch (e) {
    await failed(sourceId, "reading", e);
  }
}

// ---------------------------------------------------------------------------
// Rounds of questions

let saving: ReturnType<typeof setTimeout> | undefined;
/** The round's answers as they're given (kept, so a reload doesn't lose them). */
export function saveRound(sourceId: string, form: FlowState) {
  clearTimeout(saving);
  saving = setTimeout(() => void setSession(sourceId, (s) => ({ ...s, buckets: s.buckets.map((b, i) => (i === s.buckets.length - 1 ? { ...b, form } : b)) })), 500);
}

/** The answers in the board's Library (Product context), so later work reads them too. */
function fileAnswers(sourceId: string) {
  const s = sessionOf(sourceOf(sourceId));
  if (!s) return;
  const now = Date.now();
  const prefix = `dump:${sourceId}:`;
  studio().mutate(
    (d) => {
      const b = d.brief ?? emptyBrief();
      d.brief = { ...b, summary: b.summary || s.understanding, answers: [...b.answers.filter((a) => !a.id.startsWith(prefix)), ...briefFromDump(sourceId, s, now)].slice(-40), updatedAt: now };
    },
    { history: false },
  );
}

/** The round just answered goes onto the source's text, so it reads on its own: what Qalam AI asked, and their answers. */
async function keepRound(sourceId: string) {
  await updateSource(sourceId, (x) => {
    const d = x.dump;
    if (!d?.buckets.length) return x;
    const n = d.buckets.length;
    // Numbered as the chat numbers them ("Your answers · round 1").
    const r = withRound(x.text, x.blocks ?? [], roundAnswers(d)[n - 1] ?? [], n);
    return r.text === x.text ? x : { ...x, text: r.text, blocks: r.blocks };
  });
}

/** The builder answered the round: Qalam AI reads the answers. */
export async function answerRound(sourceId: string, form: FlowState) {
  clearTimeout(saving);
  await setSession(sourceId, (s) => closeDumpRound(s, form, "analyzing"));
  await keepRound(sourceId);
  fileAnswers(sourceId);
  await readAnswers(sourceId);
}

/** The builder leaves the rest to Qalam AI: it places what it has. */
export async function skipRest(sourceId: string, form?: FlowState) {
  clearTimeout(saving);
  await setSession(sourceId, (s) => closeDumpRound(s, form ?? s.buckets[s.buckets.length - 1]?.form ?? initialFlow([]), "skipped"));
  await keepRound(sourceId);
  fileAnswers(sourceId);
  await placeDump(sourceId);
}

/**
 * Whether Qalam AI may look on the web before its next round: only while finding a goal's problem,
 * where the web answers here, at most MAX_LOOKS times after the opening look, and not straight
 * after one.
 */
const mayLook = (s: DumpSession, justLooked: boolean) => !justLooked && !!s.aim?.goal && !s.looks?.some((l) => l.noWeb) && (s.looks ?? []).filter((l) => l.after >= 0).length < MAX_LOOKS;

/** Qalam AI reads the last round's answers: the next round, or ready (then it places); first a look on the web, when it asks for one. */
export async function readAnswers(sourceId: string, o: { looked?: boolean } = {}) {
  const s = sourceOf(sourceId);
  const session = sessionOf(s);
  if (!s || !session) return;
  await setSession(sourceId, (d) => ({ ...d, phase: "analyzing", failed: undefined }));
  const { tree, cards } = board();
  const { pieces, fields } = readFields(s, cards);
  const rounds = roundAnswers(session).map((answers, i) => ({ answers: answers.map((a) => ({ question: a.question.slice(0, 200), answer: a.answer })), ...(session.buckets[i]?.analysis ? { analysis: session.buckets[i].analysis!.slice(0, 1500) } : {}) }));
  const look = mayLook(session, !!o.looked);
  const body = { stage: "dump-followup", product: product(), dump: s.text, tree, ...aimOf(session, cards), ...fields, rounds, last: session.buckets.length >= MAX_DUMP_ROUNDS, ...(look ? { look } : {}) };
  const recorded = () => sampleRaw(SAMPLE_DUMP_FOLLOWUP_RAW[Math.min(session.buckets.length, SAMPLE_DUMP_FOLLOWUP_RAW.length) - 1], cards);
  try {
    const { raw, sample, model } = await call(sourceId, o.looked ? "Qalam AI is reading what it found, with your answers" : "Qalam AI is reading your answers", body, recorded, 2500);
    const f = sanitizeDumpFollowup(raw, pieces, cards);
    // It wants to look something up first: what it took from the answers is kept, then it reads again with what the look found.
    if (look && f.look && session.buckets.length < MAX_DUMP_ROUNDS) {
      await setSession(sourceId, (d) => ({ ...applyDumpFollowup(d, { ...f, ready: true, questions: [] }), phase: "analyzing" }), (x) => withRoles(x.quotes, f.roles));
      await lookOnWeb(sourceId, f.look);
      return await readAnswers(sourceId, { looked: true });
    }
    await setSession(sourceId, (d) => applyDumpFollowup(d, f), (x) => withRoles(x.quotes, f.roles));
    turnDone(sourceId, { model, sample });
    // The builder just answered: once Qalam AI has what it needs, it goes on to place.
    if (sessionOf(sourceOf(sourceId))?.phase === "ready") await placeDump(sourceId);
  } catch (e) {
    await failed(sourceId, "analyzing", e);
  }
}

/**
 * A look on the web while finding a goal's problem (server/org/focus.ts): what Qalam AI asked to
 * look up, with what they said in the round just answered. It goes on the session after that round
 * and onto the source's text. A look that fails is let go (Qalam AI asks without it); Stop stops.
 */
async function lookOnWeb(sourceId: string, query: string) {
  const session = sessionOf(sourceOf(sourceId));
  const goal = session?.aim?.goal;
  if (!session || !goal) return;
  const ctrl = new AbortController();
  runs.get(sourceId)?.abort();
  runs.set(sourceId, ctrl);
  useDump.setState({ busy: { sourceId, label: `Qalam AI is looking on the web for “${query}”`, started: Date.now(), tokens: 0 } });
  const said = (roundAnswers(session).at(-1) ?? []).filter((a) => a.answer && a.answer !== "No preference").map((a) => `${a.question} ${a.said ?? a.answer}`).join("\n");
  try {
    const r = await lookForGoal(goal.id, { query, said }, (label) => useDump.setState((u) => (u.busy?.sourceId === sourceId ? { busy: { ...u.busy, label } } : {})), ctrl.signal);
    const after = session.buckets.length - 1;
    await updateSource(sourceId, (x) => {
      if (!x.dump) return x;
      const t = withLook(x.text, x.blocks ?? [], r.look);
      return { ...x, text: t.text, blocks: t.blocks, dump: { ...x.dump, looks: [...(x.dump.looks ?? []), { ...r.look, after }] } };
    });
  } catch (e) {
    if ((e as Error).name === "AbortError" || ctrl.signal.aborted) throw e;
  } finally {
    if (runs.get(sourceId) === ctrl) runs.delete(sourceId);
    useDump.setState((u) => (u.busy?.sourceId === sourceId ? { busy: null } : {}));
  }
}

// ---------------------------------------------------------------------------
// Place (proposals on the board, to accept or discard)

/** Tokens of the organization's knowledge a placement carries. */
const PLACE_BUDGET = 3000;

/**
 * Have Qalam AI place the dump: what it proposes takes shape over the board as it's written (a
 * ghost, under the Strategist's cursor), then waits there for the builder to accept or discard,
 * checked by code (place.ts) first. Stop keeps the proposals that were complete. The call carries
 * what the organization already knows about what the dump says (beyond this board), so Qalam AI can
 * rest cards on what customers said in other sources.
 */
export async function placeDump(sourceId: string) {
  const s = sourceOf(sourceId);
  const session = sessionOf(s);
  if (!s || !session) return;
  await setSession(sourceId, (d) => ({ ...d, phase: "placing", failed: undefined }));
  const { tree, cards } = board();
  const { pieces, fields } = readFields(s, cards);
  const answers = roundAnswers(session)
    .flat()
    .map((a, i) => ({ ref: `a${i + 1}`, answerId: `dump:${sourceId}:${a.questionId}`, question: a.question, answer: a.answer, words: a.words }));
  const ctx: PlaceContext = {
    cards,
    pieces,
    sourceId,
    answers: answers.map(({ ref, answerId, words }) => ({ ref, answerId, words })),
    said: [s.text, ...answers.map((a) => a.words)].join("\n"),
    settled: new Set(session.dismissed ?? []),
    has: (cardId, span) => {
      const c = cardOf(studio().doc, cardId);
      return !!c && hasQuote(c, sourceId, span);
    },
    anchor: session.anchor,
    looseProblems: session.aim?.find === "problem" && !session.aim.goal,
  };
  // What the organization knows about what the dump says, beyond the board's cards and the dump itself.
  const org = session.sample ? null : await orgContext({ query: s.text.slice(0, 4000), product: packProduct(), budget: PLACE_BUDGET, exclude: [...boardCardRefs(studio().doc), ...s.quotes.map((q) => quotePiece(q.id))] });
  const hub = await hubQuotes(org);
  ctx.hub = new Map([...hub].map(([k, h]) => [k, { quote: h.quote, span: h.span }]));
  ctx.hasQuote = (cardId, q, span) => {
    const c = cardOf(studio().doc, cardId);
    return !!c && hasQuote(c, q.sourceId, span, quotePiece(q.quoteId));
  };
  const body = { stage: "dump-place", product: product(), dump: s.text, tree, ...aimOf(session, cards), ...fields, answers: answers.map(({ ref, question, answer }) => ({ id: ref, question: question.slice(0, 400), answer })), ...(org ? { context: org.context } : {}) };
  const origin = placeFor(studio().doc, null);
  const ids = new Map<string, string>();
  const turn = session.turn ?? { chatId: "", turnId: `dump:${sourceId}` };
  const preview = `${turn.turnId}:place`;
  const anchor = session.anchor && studio().doc.nodes[session.anchor] ? treeBounds(studio().doc, session.anchor) : null;
  if (session.turn) startAgent({ turnId: turn.turnId, chatId: turn.chatId, kind: "strategist", task: "Placing your brain dump", activity: "Reading", target: anchor });

  let buffer = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shown = 0;
  // Stickies have nowhere to be kept on the space's canvas: what a note would say stays in the chat's reading.
  // Asked to find a goal or a problem, only cards of that kind are kept (under cards already there, or on their own).
  const want = session.aim ? (session.aim.find === "goal" ? "outcome" : "opportunity") : null;
  const keeps = (p: Proposal) => (want ? p.kind === "card" && p.card.kind === want && (p.parentId === null || !!studio().doc.nodes[p.parentId]) : p.kind !== "note");
  // A file read for a card, or a goal's problem: only what lands under it.
  const under = session.file?.card ?? session.aim?.goal?.card;
  const scoped = (list: Proposal[]) => (under ? underCard(studio().doc, under, list) : list);
  const proposalsNow = (raw: unknown, partial: boolean) => arrangeNew(studio().doc, scoped((partial ? partialPlace(raw, ctx, ids) : sanitizePlace(raw, ctx, ids)).filter(keeps)), evidenceOf, origin);
  const show = () => {
    timer = undefined;
    const list = proposalsNow(parsePartial(buffer), true);
    const ghosts = ghostsFor(studio().doc, list, preview);
    useGhosts.setState((g) => ({ list: [...g.list.filter((x) => x.turnId !== preview), ...ghosts] }));
    const added = list.filter((p): p is Extract<Proposal, { kind: "card" }> => p.kind === "card");
    if (added.length === shown || !session.turn) return;
    shown = added.length;
    // The cursor goes to the newest card; its bubble says what it is.
    const newest = added[added.length - 1];
    const g = ghosts.find((x) => x.doc.nodes[newest.cardId]);
    if (g) updateAgent(turn.turnId, { target: worldBounds(g.doc, newest.cardId), phase: "building", activity: "Placing" });
    narrate(turn.turnId, `${KIND_LABEL[newest.card.kind]}: ${newest.card.title}`);
  };
  const onDelta = (d: AIDelta) => {
    if (d.kind === "reset") return void (buffer = "");
    if (d.kind !== "json") return session.turn && appendThought(turn.turnId, d.text);
    buffer += d.text;
    timer ??= setTimeout(show, 150);
  };
  const review = async (list: Proposal[]) => {
    if (!list.length) {
      // The chat says so: nothing to change on the canvas.
      await setSession(sourceId, (d) => ({ ...d, phase: "placed", placed: { at: Date.now(), counts: d.placed?.counts ?? { added: 0, attached: 0, edited: 0, notes: 0 } } }));
      return;
    }
    if (!startReview({ kind: "dump", sourceId }, list)) return void (await setSession(sourceId, (d) => ({ ...d, phase: "ready" })));
    const c = getController();
    const ghostIds = useGhosts.getState().list.filter((g) => g.turnId === REVIEW_TURN).flatMap((g) => g.doc.roots);
    if (c && ghostIds.length) requestAnimationFrame(() => c.glideToFit(ghostIds));
  };
  try {
    const { raw, sample, model } = await call(sourceId, session.file ? `Qalam AI is placing what bears on it from “${session.file.title}”` : session.aim?.goal ? "Qalam AI is finding the problem to focus on in what you said" : session.aim ? `Qalam AI is finding ${session.aim.find === "goal" ? "a goal" : "a problem"} in what you said` : "Qalam AI is placing your brain dump", body, () => sampleRaw(SAMPLE_DUMP_PLACE_RAW, cards), 9000, onDelta);
    clearTimeout(timer);
    clearGhosts(preview);
    const list = proposalsNow(raw, false);
    recordCall({ title: `Placed the brain dump “${s.title}”`, summary: (raw as { summary?: unknown } | null)?.summary as string | undefined, org, raw, model, sample, status: "proposed", produced: { refs: list.map((p) => p.cardId) } });
    await review(list);
    turnDone(sourceId, { model, sample });
    // The dump's pieces are what the team believes: on the topic pages too (in the background).
    if (!sample) void fileAfterReading([sourceId], canvasProduct());
  } catch (e) {
    clearTimeout(timer);
    clearGhosts(preview);
    const kept = (e as Error).name === "AbortError" ? proposalsNow(parsePartial(buffer), true) : [];
    // Stopped: what was complete waits for review.
    if (kept.length) {
      await review(kept);
      const t = session.turn;
      if (t) patchTurn(t.chatId, t.turnId, { status: "stopped", activity: undefined });
    } else await failed(sourceId, "placing", e);
  } finally {
    if (session.turn) endAgent(turn.turnId);
  }
}

// ---------------------------------------------------------------------------
// Stop, Try again, a reload

export function stopDump(sourceId: string) {
  runs.get(sourceId)?.abort();
}

/** A file read as not bearing on its card, read for it anyway: placed with what was found in it. */
export async function readAnyway(sourceId: string) {
  if (!sessionOf(sourceOf(sourceId))?.off) return;
  await setSession(sourceId, (d) => ({ ...d, off: undefined }));
  await placeDump(sourceId);
}

/** Run the step that didn't finish again. */
export function retryDump(sourceId: string) {
  const s = sessionOf(sourceOf(sourceId));
  if (!s || useDump.getState().busy?.sourceId === sourceId) return;
  const at = s.failed?.at;
  if (at === "reading") void readDump(sourceId);
  else if (at === "analyzing") void readAnswers(sourceId);
  else if (at === "placing") void placeDump(sourceId);
}

const dumpOfTurn = (turnId: string) => useSources.getState().list.find((s) => s.dump?.turn?.turnId === turnId)?.id;

let routed = false;
/** Stop and Try again on dump turns in the chat (at boot, so a reloaded chat's turns work too). */
export function ensureDumpHandlers() {
  if (routed) return;
  routed = true;
  routeTurns({
    owns: (turnId) => !!dumpOfTurn(turnId),
    stop: (turnId) => {
      const id = dumpOfTurn(turnId);
      if (id) stopDump(id);
    },
    retry: (turnId) => {
      const id = dumpOfTurn(turnId);
      if (id) retryDump(id);
    },
  });
}

/**
 * After a reload: a step that was running didn't finish (Try again runs it), and the proposals a
 * dump was waiting on come back on the canvas. The chat's thread shows the rest.
 */
export async function resumeDumps() {
  const list = useSources.getState().list.filter((s) => s.kind === "dump" && s.dump);
  for (const s of list) {
    const p = s.dump!.phase;
    if ((p === "reading" || p === "analyzing" || p === "placing") && !runs.has(s.id)) await setSession(s.id, (d) => ({ ...d, phase: "failed", failed: { at: p, error: "Interrupted: the page was closed or reloaded." } }));
  }
  // Proposals that were waiting on the board come back (what no longer fits drops out).
  const reviewed = [...list].reverse().find((s) => s.dump!.phase === "review" && s.dump!.proposals?.length);
  if (reviewed && !useReview.getState().proposals.length) startReview({ kind: "dump", sourceId: reviewed.id }, reviewed.dump!.proposals!);
}
