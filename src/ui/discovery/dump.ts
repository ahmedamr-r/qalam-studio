import { contextFor } from "@/org/context";
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
import { feedback } from "@/commands/feedback";
import {
  DUMP_MAX_CHARS,
  MAX_DUMP_ROUNDS,
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
  type DumpSession,
  type PlaceCard,
} from "@/discovery/dump";
import { hasQuote, type SourceRecord } from "@/discovery/sources";
import { cardOf } from "@/discovery/ops";
import { KIND_LABEL } from "@/discovery/kinds";
import { arrangeNew, type Proposal } from "@/discovery/proposals";
import { partialPlace, sanitizePlace, type PlaceContext } from "@/discovery/place";
import { initialFlow, type FlowState } from "../ai/questionFlow";
import { openTurn, patchTurn } from "../ai/chats";
import { appendThought, endAgent, narrate, startAgent, updateAgent } from "../ai/agents";
import { getController } from "../CanvasView";
import { currentProject } from "@/projects/session";
import { offline, runDump } from "./ai";
import { placeFor, placeSample, routeTurns, treeFor } from "./draft";
import { REVIEW_TURN, evidenceOf, ghostsFor, startReview, useReview } from "./review";
import { ingestPaste } from "./ingest";
import { addSourceRecord, sourceOf, updateSource, useSources } from "./sources";
import { useDiscovery } from "./store";

/*
 * A brain dump on the board: the builder pastes their thinking, Qalam AI reads it (what it took
 * from it, its pieces, its pushback, a round of questions), reads each round of answers (up to
 * three), then places it as proposals to accept or discard. The dump is a source (its words stay
 * the builder's), and how it's going lives on it, so a reload picks up where it was. Each dump is a
 * turn in the board's chat; the card on the canvas is where the conversation happens.
 */

export interface DumpUI {
  /** The card: a new dump being written (sourceId null), or a dump's session. */
  open: { sourceId: string | null; draft: string } | null;
  minimised: boolean;
  /** A call running for a dump, and how far it's got. */
  busy: { sourceId: string; label: string; started: number; tokens: number } | null;
}

export const useDump = create<DumpUI>(() => ({ open: null, minimised: false, busy: null }));

const runs = new Map<string, AbortController>();

/** What the board's product (or the organization) is, then the board's own notes. */
const product = () => [contextFor(currentProject()?.product), studio().doc.brief?.summary ?? ""].filter(Boolean).join("\n").slice(0, 2000);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A dump's session (null when the source isn't a dump). */
export const sessionOf = (s: SourceRecord | undefined): DumpSession | null => (s?.kind === "dump" && s.dump ? s.dump : null);

async function setSession(sourceId: string, fn: (s: DumpSession) => DumpSession, quotes?: (s: SourceRecord) => SourceRecord["quotes"]) {
  await updateSource(sourceId, (s) => (s.dump ? { ...s, dump: fn(s.dump), ...(quotes ? { quotes: quotes(s) } : {}) } : s));
}

/** Open the card: to write a new dump (with pasted text), or on a dump's session. */
export function openBrainDump(opts: { text?: string; sourceId?: string } = {}) {
  const busy = useDump.getState().busy;
  if (!opts.sourceId && busy) {
    feedback("Qalam AI is still on your last brain dump", { id: "discovery.dump" });
    return useDump.setState({ open: { sourceId: busy.sourceId, draft: "" }, minimised: false });
  }
  useDump.setState({ open: { sourceId: opts.sourceId ?? null, draft: (opts.text ?? "").slice(0, DUMP_MAX_CHARS) }, minimised: false });
  if (useDiscovery.getState().sheet === "start") useDiscovery.setState({ sheet: "closed" });
}

export const closeBrainDump = () => useDump.setState({ open: null, minimised: false });
export const setDraft = (draft: string) => useDump.setState((s) => (s.open && !s.open.sourceId ? { open: { ...s.open, draft } } : {}));

// ---------------------------------------------------------------------------
// Calls

/** The board as a dump's calls see it, now. */
const board = () => outlineOf(studio().doc);

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

/** A new dump: kept as a source, then read. */
export async function startDump(text: string, opts: { sample?: boolean } = {}) {
  const projectId = currentProject()?.id;
  const body = (opts.sample ? SAMPLE_DUMP_TEXT : text).trim();
  if (!projectId || body.length < 40) return;
  if (body.length > DUMP_MAX_CHARS) return feedback(`That's more than one brain dump takes (${DUMP_MAX_CHARS.toLocaleString()} characters): add the rest as a source`, { kind: "error", id: "discovery.dump" });
  if (!opts.sample && (await offline())) return feedback("Qalam AI isn't set up here, so it can't read your text. Try the sample to see how it works.", { id: "discovery.dump" });
  // The sample is about Basket: its tree goes on the board first if it isn't there.
  if (opts.sample && !studio().doc.roots.some((id) => studio().doc.nodes[id]?.meta.ost?.title === "More customers reorder every week")) placeSample();
  const read = await ingestPaste(body, opts.sample ? "Basket founder, after the investor call" : undefined);
  const s = studio();
  const rec: SourceRecord = {
    v: 1,
    id: newId(),
    projectId,
    kind: "dump",
    title: read.title,
    text: read.text,
    addedAt: Date.now(),
    read: [],
    quotes: [],
    needs: [],
    dump: { v: 1, phase: "reading", understanding: "", challenges: [], buckets: [], anchor: treeFor(s.doc, s.selection), ...(opts.sample ? { sample: true } : {}) },
  };
  const turn = openTurn("discovery", { text: `Brain dump · ${read.title}` });
  rec.dump!.turn = turn;
  await addSourceRecord(rec);
  patchTurn(turn.chatId, turn.turnId, { outcome: { kind: "discovery", action: "dump", sourceId: rec.id } });
  useDump.setState({ open: { sourceId: rec.id, draft: "" }, minimised: false });
  await readDump(rec.id);
}

/** Have Qalam AI read a dump: what it took from it, its pieces, its pushback, the first round. */
export async function readDump(sourceId: string) {
  const s = sourceOf(sourceId);
  if (!s?.dump) return;
  await setSession(sourceId, (d) => ({ ...d, phase: "reading", failed: undefined }));
  const { tree, cards } = board();
  try {
    const { raw, sample, model } = await call(sourceId, "Qalam AI is reading your brain dump", { stage: "dump-read", product: product(), dump: s.text, tree }, () => sampleRaw(SAMPLE_DUMP_READ_RAW, cards), 3500);
    const r = sanitizeRead(raw, s.text, cards);
    if (!r.fragments.length) throw new AIError("parse", "Qalam AI found nothing in it to place on the board. Try again, or write a little more.");
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

/** The builder answered the round: Qalam AI reads the answers. */
export async function answerRound(sourceId: string, form: FlowState) {
  clearTimeout(saving);
  await setSession(sourceId, (s) => closeDumpRound(s, form, "analyzing"));
  fileAnswers(sourceId);
  await readAnswers(sourceId);
}

/** The builder leaves the rest to Qalam AI: it places what it has. */
export async function skipRest(sourceId: string, form?: FlowState) {
  clearTimeout(saving);
  await setSession(sourceId, (s) => closeDumpRound(s, form ?? s.buckets[s.buckets.length - 1]?.form ?? initialFlow([]), "skipped"));
  fileAnswers(sourceId);
  await placeDump(sourceId);
}

/** Qalam AI reads the last round's answers: the next round, or ready (then it places). */
export async function readAnswers(sourceId: string) {
  const s = sourceOf(sourceId);
  const session = sessionOf(s);
  if (!s || !session) return;
  await setSession(sourceId, (d) => ({ ...d, phase: "analyzing", failed: undefined }));
  const { tree, cards } = board();
  const { pieces, fields } = readFields(s, cards);
  const rounds = roundAnswers(session).map((answers, i) => ({ answers: answers.map((a) => ({ question: a.question.slice(0, 200), answer: a.answer })), ...(session.buckets[i]?.analysis ? { analysis: session.buckets[i].analysis!.slice(0, 1500) } : {}) }));
  const body = { stage: "dump-followup", product: product(), dump: s.text, tree, ...fields, rounds, last: session.buckets.length >= MAX_DUMP_ROUNDS };
  const recorded = () => sampleRaw(SAMPLE_DUMP_FOLLOWUP_RAW[Math.min(session.buckets.length, SAMPLE_DUMP_FOLLOWUP_RAW.length) - 1], cards);
  try {
    const { raw, sample, model } = await call(sourceId, "Qalam AI is reading your answers", body, recorded, 2500);
    const f = sanitizeDumpFollowup(raw, pieces, cards);
    await setSession(sourceId, (d) => applyDumpFollowup(d, f), (x) => withRoles(x.quotes, f.roles));
    turnDone(sourceId, { model, sample });
    // The builder just answered: once Qalam AI has what it needs, it goes on to place.
    if (sessionOf(sourceOf(sourceId))?.phase === "ready") await placeDump(sourceId);
  } catch (e) {
    await failed(sourceId, "analyzing", e);
  }
}

// ---------------------------------------------------------------------------
// Place (proposals on the board, to accept or discard)

/**
 * Have Qalam AI place the dump: what it proposes takes shape over the board as it's written (a
 * ghost, under the Strategist's cursor), then waits there for the builder to accept or discard,
 * checked by code (place.ts) first. Stop keeps the proposals that were complete.
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
  };
  const body = { stage: "dump-place", product: product(), dump: s.text, tree, ...fields, answers: answers.map(({ ref, question, answer }) => ({ id: ref, question: question.slice(0, 400), answer })) };
  const origin = placeFor(studio().doc, null);
  const ids = new Map<string, string>();
  const turn = session.turn ?? { chatId: "", turnId: `dump:${sourceId}` };
  const preview = `${turn.turnId}:place`;
  const anchor = session.anchor && studio().doc.nodes[session.anchor] ? treeBounds(studio().doc, session.anchor) : null;
  if (session.turn) startAgent({ turnId: turn.turnId, chatId: turn.chatId, kind: "strategist", task: "Placing your brain dump", activity: "Reading", target: anchor });
  useDump.setState({ minimised: true });

  let buffer = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shown = 0;
  const proposalsNow = (raw: unknown, partial: boolean) => arrangeNew(studio().doc, partial ? partialPlace(raw, ctx, ids) : sanitizePlace(raw, ctx, ids), evidenceOf, origin);
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
      await setSession(sourceId, (d) => ({ ...d, phase: "placed", placed: { at: Date.now(), counts: d.placed?.counts ?? { added: 0, attached: 0, edited: 0, notes: 0 } } }));
      feedback("Qalam AI found nothing to change on the board", { id: "discovery.dump" });
      return;
    }
    if (!startReview({ kind: "dump", sourceId }, list)) return void (await setSession(sourceId, (d) => ({ ...d, phase: "ready" })));
    const c = getController();
    const ghostIds = useGhosts.getState().list.filter((g) => g.turnId === REVIEW_TURN).flatMap((g) => g.doc.roots);
    if (c && ghostIds.length) requestAnimationFrame(() => c.glideToFit(ghostIds));
  };
  try {
    const { raw, sample, model } = await call(sourceId, "Qalam AI is placing your brain dump", body, () => sampleRaw(SAMPLE_DUMP_PLACE_RAW, cards), 9000, onDelta);
    clearTimeout(timer);
    clearGhosts(preview);
    await review(proposalsNow(raw, false));
    turnDone(sourceId, { model, sample });
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

/** Run the step that didn't finish again. */
export function retryDump(sourceId: string) {
  const s = sessionOf(sourceOf(sourceId));
  if (!s || useDump.getState().busy?.sourceId === sourceId) return;
  useDump.setState({ open: { sourceId, draft: "" }, minimised: false });
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
 * After a reload: a step that was running didn't finish (Try again runs it), and the latest dump
 * that waits on the builder comes back as a bubble beside its tree.
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
  const waiting = [...list].reverse().find((s) => ["asking", "ready", "failed", "review"].includes(sessionOf(sourceOf(s.id))?.phase ?? ""));
  if (waiting && !useDump.getState().open) useDump.setState({ open: { sourceId: waiting.id, draft: "" }, minimised: true });
}
