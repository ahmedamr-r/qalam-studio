import { nanoid } from "nanoid";
import { create } from "zustand";
import { aiStatus } from "@/ai/client";
import { studio } from "@/doc/store";
import { isOstCard } from "@/doc/board";
import { KIND_LABEL } from "@/discovery/kinds";
import { changeGoal, goalsNow } from "@/goals/client";
import { goalById } from "@/goals/tree";
import { askOrganization } from "@/org/ask";
import { captureIngested, decideFoundGoal, setSourceBasis } from "@/org/capture";
import { orgFetch, orgJson } from "@/org/client";
import type { Ingested } from "@/discovery/ingest/core";
import { chatKey, chatOf, emptyChat, withJob, withTurn, type CanvasChat, type ChatDoc, type ChatJob, type ChatTurn, type FiledPage, type FocusGoal, type TakenDoc } from "@/space/chat";
import { cardForPage, pageOf } from "@/space/pages";
import { DUMP_WORDS, routeOf, titleFrom, wordsIn, type ChatMode } from "@/space/route";
import { FIND_MIN, findRound, findText, findTranscript, type FindWhat } from "@/space/find";
import type { PlanQuestion } from "@/ai/plan";
import { focusRound, focusTranscript } from "@/goals/focus";
import { lookForGoal } from "@/org/goal-work";
import { knowsMarket } from "@/market/types";
import { loadMarket, useMarket } from "@/org/market";
import { useSpaceView } from "@/space/view";
import { newId } from "@/doc/factory";
import { docPart, docRef, guessVoice, joinParts, type SentDoc } from "../../chat/attach";
import type { Basis } from "@/discovery/basis";
import { DUMP_MAX_CHARS } from "@/discovery/dump";
import { ingestFile, ingestPaste } from "../../discovery/ingest";
import { startDump, stopDump, useDump } from "../../discovery/dump";
import { addSources } from "../../discovery/import";
import { sourceOf, useSources } from "../../discovery/sources";
import { sourceCame } from "../flights";
import { placeFor, writeCard } from "../new";
import { useCompose } from "./compose";
import { toggleChat } from "../../frame/store";

/*
 * Qalam AI's chat beside a space's canvas, in the window: the canvas's turns (src/space/chat.ts),
 * loaded as the canvas opens and saved a moment after each change, and what's running now (its
 * steps and its Stop), which is never kept. What's sent goes where src/space/route.ts says: asked,
 * taken in, written on the canvas, read as a brain dump, or first a choice between them; a turn
 * can be taken another way after (its words stay, its job changes).
 */

interface Live {
  steps: string[];
  started: number;
}

interface ChatState {
  /** The canvas the turns are for (null until one opens). */
  key: string | null;
  space: string | null;
  chat: CanvasChat;
  loaded: boolean;
  live: Record<string, Live>;
  /** "Help me find one" asked for a canvas whose chat isn't loaded yet: started as it loads. */
  pending: { key: string; what: FindWhat } | null;
}

export const useCanvasChat = create<ChatState>(() => ({ key: null, space: null, chat: emptyChat(), loaded: false, live: {}, pending: null }));

const st = () => useCanvasChat.getState();
const ctrls = new Map<string, AbortController>();
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

let saving: ReturnType<typeof setTimeout> | null = null;
function save() {
  const { key, chat } = st();
  if (!key) return;
  if (saving) clearTimeout(saving);
  saving = setTimeout(() => {
    saving = null;
    void orgFetch(`/canvas-chat/${key}`, { method: "PUT", json: chat }).catch(() => {});
  }, 400);
}

function change(fn: (c: CanvasChat) => CanvasChat) {
  useCanvasChat.setState((s) => ({ chat: fn(s.chat) }));
  save();
}

/** The chat of the canvas now open (another canvas's goes, and what it was running stops). */
export async function openChat(space: string | null) {
  const key = chatKey(space);
  if (st().key === key) return;
  for (const c of ctrls.values()) c.abort();
  ctrls.clear();
  useCanvasChat.setState({ key, space, chat: emptyChat(), loaded: false, live: {} });
  // What's known about the company and its domain words Help me find one's questions.
  void loadMarket();
  const chat = await orgJson<unknown>(`/canvas-chat/${key}`).then(chatOf, () => emptyChat());
  if (st().key !== key) return;
  useCanvasChat.setState({ chat, loaded: true });
  const pending = st().pending;
  if (pending?.key === key) {
    useCanvasChat.setState({ pending: null });
    findWith(pending.what, space);
  }
}

/** A new chat: the turns go (what they made stays where it is). */
export function clearChat() {
  for (const c of ctrls.values()) c.abort();
  ctrls.clear();
  useCanvasChat.setState({ live: {} });
  change(() => emptyChat());
}

export function turnOf(id: string): ChatTurn | undefined {
  return st().chat.turns.find((t) => t.id === id);
}

function addTurn(said: string, job: ChatJob, docs?: ChatDoc[]): string {
  const id = nanoid(10);
  change((c) => withTurn(c, { id, at: Date.now(), said, ...(docs?.length ? { docs } : {}), job }));
  return id;
}

/** A turn's job set: a new turn, or (`at`) one taken another way. */
function jobAt(at: string | null, said: string, job: ChatJob, docs?: ChatDoc[]): string {
  if (!at) return addTurn(said, job, docs);
  change((c) => withJob(c, at, () => job));
  return at;
}

function begin(id: string): AbortController {
  const ctrl = new AbortController();
  ctrls.set(id, ctrl);
  useCanvasChat.setState((s) => ({ live: { ...s.live, [id]: { steps: [], started: Date.now() } } }));
  return ctrl;
}

const step = (id: string) => (label: string) => useCanvasChat.setState((s) => (s.live[id] ? { live: { ...s.live, [id]: { ...s.live[id], steps: [...s.live[id].steps, label].slice(-4) } } } : s));

function end(id: string) {
  ctrls.delete(id);
  useCanvasChat.setState((s) => {
    const { [id]: _gone, ...live } = s.live;
    return { live };
  });
}

// ---------------------------------------------------------------------------
// Sending

/** What the box sent, where it goes (the box's mode first): false keeps the text in the box. */
export function send(text: string, docs: readonly SentDoc[]): boolean {
  const said = text.trim();
  const mode = useCompose.getState().mode;
  const routed = routeOf({ text: said, docs, pasted: said ? guessVoice({ text: said, title: "" }) : undefined, mode });
  if (!routed) return false;
  // Sent: the box's text and mode are spent (the box drawn again after a round of questions starts empty).
  useCompose.setState({ text: "", mode: null });
  if (routed.job === "choose") {
    addTurn(said, { kind: "choose", first: routed.first });
    return true;
  }
  void runAs(null, said, routed.job, docs);
  return true;
}

/** A turn's words taken one way: as a new turn, or (`at`) a turn taken another way than it was. */
export async function runAs(at: string | null, said: string, mode: ChatMode, docs: readonly SentDoc[] = []): Promise<void> {
  if (at) stopTurn(at);
  if (mode === "ask") return ask(said, at);
  if (mode === "goal" || mode === "problem") return void addCard(at, said, mode);
  if (mode === "take") return takeIn(at, said, docs);
  if (mode === "dump") return dumpIt(at, said, docs);
}

/** Words sent to the chat from elsewhere (the first run's idea), taken as `mode`. */
export function sendToChat(text: string, mode: ChatMode) {
  void runAs(null, text.trim(), mode);
}

/** A turn taken another way, from the thread (its chips): the same words. */
export function retake(id: string, mode: ChatMode) {
  const t = turnOf(id);
  if (t) void runAs(id, t.said, mode);
}

// ---------------------------------------------------------------------------
// A brain dump

/** Their own thinking, read as a brain dump (src/ui/discovery/dump.ts): their words and their own docs as one text. */
async function dumpIt(at: string | null, said: string, docs: readonly SentDoc[], asOwn = false) {
  const source = newId();
  const whole = joinParts([...(said ? [{ body: said }] : []), ...docs.map((d) => docPart({ via: d.via, title: d.title, text: d.ingested.text, blocks: d.ingested.blocks }))]).text;
  // A doc that read as their thinking can be longer than a dump takes: its start, and the reply says so.
  const cut = asOwn && whole.length > DUMP_MAX_CHARS;
  const text = cut ? whole.slice(0, DUMP_MAX_CHARS) : whole;
  const id = jobAt(at, said, { kind: "dump", source, ...(asOwn ? { asOwn: { title: docs[0]?.ingested.title ?? docs[0]?.title ?? "It", ...(cut ? { cut: true as const } : {}) } } : {}) }, docs.map(docRef));
  try {
    await startDump(text, { id: source });
    sourceCame(sourceOf(source)?.title ?? "Your thinking");
  } catch (e) {
    change((c) => withJob(c, id, (j) => (j.kind === "dump" ? { ...j, error: message(e) } : j)));
  }
}

// ---------------------------------------------------------------------------
// Help me find one

const FIND_SAID: Record<FindWhat, string> = { goal: "Help me find a goal", problem: "Help me find a problem" };

/** "Help me find one" on `space`'s canvas: code's opening questions in the box (one at a time: an open one is kept). */
export function findWith(what: FindWhat, space: string | null) {
  toggleChat(true);
  const key = chatKey(space);
  if (st().key !== key || !st().loaded) return useCanvasChat.setState({ pending: { key, what } });
  const open = st().chat.turns.find((t) => t.job.kind === "find");
  if (open?.job.kind === "find" && open.job.what === what) return;
  if (open) dropTurn(open.id);
  // With the company and its domain known, Qalam AI asks from them; else code's own questions.
  const known = knowsMarket(useMarket.getState().market);
  const id = addTurn(FIND_SAID[what], { kind: "find", what, ...(known ? { loading: true as const } : {}) });
  if (known) void askFrom(id, what);
}

/** Qalam AI's opening questions, from what's known (code's own stand in when it has none). */
async function askFrom(id: string, what: FindWhat) {
  const questions = await orgJson<{ questions: PlanQuestion[] }>("/find/questions", { method: "POST", json: { what } }).then((r) => r.questions, () => []);
  change((c) => withJob(c, id, (j) => (j.kind === "find" ? { kind: "find", what: j.what, ...(questions.length ? { questions } : {}) } : j)));
}

/** The opening questions a find turn asks: Qalam AI's from the domain (and, for a goal, what the web says gets in its way), else code's. */
export const findQuestionsOf = (j: { what: FindWhat; questions?: PlanQuestion[]; goal?: FocusGoal }) => (j.questions?.length ? j.questions : j.goal ? focusRound() : findRound(j.what));

// ---------------------------------------------------------------------------
// The problem to focus on for a goal (its next steps' "Find the problem to focus on")

/** A conversation for the goal still going in the chat: its questions, or its dump not placed yet. */
function focusing(goal: string): ChatTurn | undefined {
  const sources = useSources.getState().list;
  return [...st().chat.turns].reverse().find((t) => {
    if (t.job.kind === "find") return t.job.goal?.id === goal;
    if (t.job.kind !== "dump" || t.job.find?.goal?.id !== goal || t.job.error) return false;
    const phase = sources.find((x) => x.id === (t.job as { source: string }).source)?.dump?.phase;
    return !!phase && phase !== "placed" && phase !== "failed";
  });
}

/**
 * Find the problem to focus on for a goal: Qalam AI looks on the web for what usually gets in the
 * way of goals like it (server/org/focus.ts), asks from what it read, reads their answers as a brain
 * dump aimed under the goal's card, looks again where their answers call for it, and proposes 1 to
 * 3 problems under it. One conversation per goal at a time: an open one is carried on.
 */
export function focusWith(card: string, goal: string) {
  toggleChat(true);
  if (!st().loaded || focusing(goal)) return;
  const title = goalById(goalsNow(), goal)?.title ?? cardTitle(card);
  const g: FocusGoal = { card, id: goal, title };
  const id = addTurn(`Find the problem to focus on for “${title}”`, { kind: "find", what: "problem", goal: g, loading: true });
  void openFocus(id, g);
}

/** The opening look and the questions from it (none held, or no web here: code's own questions). */
async function openFocus(id: string, g: FocusGoal) {
  const ctrl = begin(id);
  try {
    const r = await lookForGoal(g.id, { open: true }, step(id), ctrl.signal);
    change((c) => withJob(c, id, (j) => (j.kind === "find" ? { kind: "find", what: j.what, goal: j.goal, look: r.look, ...(r.questions.length ? { questions: r.questions } : {}) } : j)));
  } catch (e) {
    // Stopped, or it failed: code's own questions, and it says why (a turn let go is gone already).
    const stopped = (e as Error).name === "AbortError" || ctrl.signal.aborted;
    change((c) => withJob(c, id, (j) => (j.kind === "find" ? { kind: "find", what: j.what, goal: j.goal, error: stopped ? "You stopped the look, so I'll go by what you tell me." : `I couldn't look it up (${message(e)}), so I'll go by what you tell me.` } : j)));
  } finally {
    end(id);
  }
}

/** The opening round answered: their answers read as a brain dump that's asked for a goal or a problem. */
export async function answerFind(id: string, answers: Readonly<Record<string, string>>) {
  const t = turnOf(id);
  if (t?.job.kind !== "find") return;
  const what = t.job.what;
  const questions = findQuestionsOf(t.job);
  const { text: words, asked, said } = findText(questions, answers);
  if (words.length < FIND_MIN) return change((c) => withJob(c, id, (j) => (j.kind === "find" ? { ...j, error: "Say a little more in your answers, so there's something to go on." } : j)));
  const source = newId();
  const { goal, look } = t.job;
  change((c) => withJob(c, id, () => ({ kind: "dump", source, find: { what, said, ...(goal ? { goal } : {}) } })));
  try {
    // The source reads on its own: each question asked and their answer (for a goal, what the web said first), pieces from the answers alone.
    const org = useMarket.getState().org || undefined;
    const record = goal ? focusTranscript(questions, answers, { goal: goal.title, org, look }) : findTranscript(questions, answers, { what, org });
    // A goal whose card went meanwhile: the problems go where problems go.
    const under = goal && studio().doc.nodes[goal.card] ? goal : null;
    await startDump(record.text, {
      id: source,
      aim: { find: what, asked, ...(under ? { goal: { card: under.card, id: under.id } } : {}) },
      title: goal ? `Your answers: the problem to focus on for “${goal.title.slice(0, 80)}”` : `Your answers: finding ${what === "goal" ? "a goal" : "a problem"}`,
      parts: record.parts,
      ...(look ? { looks: [{ ...look, after: -1 }] } : {}),
    });
    sourceCame(sourceOf(source)?.title ?? "Your answers");
  } catch (e) {
    change((c) => withJob(c, id, (j) => (j.kind === "dump" ? { ...j, error: message(e) } : j)));
  }
}

// ---------------------------------------------------------------------------
// A file for a card ("Add a file for it", the card's next steps)

const cardTitle = (id: string) => {
  const n = studio().doc.nodes[id];
  return isOstCard(n) ? n.meta.ost.title.trim() : "";
};

/**
 * Files added for a card. What customers said in their own words (an interview, who said what) is
 * read as their quotes and mapped under the card, as before; any other file is read in the chat
 * against the card, as a brain dump of the file's words: what Qalam AI took from it and its
 * questions, then what bears on the card proposed under it. Or, when nothing in it does, the kind
 * of file that would help.
 */
export async function fileFor(card: string, files: readonly File[]) {
  if (!files.length || !studio().doc.nodes[card]) return;
  toggleChat(true);
  const read: { file: File; ing?: Ingested; error?: string }[] = await Promise.all(files.map((file) => ingestFile(file).then((ing) => ({ file, ing }), (e: unknown) => ({ file, error: message(e) }))));
  const customers = read.filter((x) => x.ing && guessVoice({ kind: x.ing.kind, text: x.ing.text, title: x.ing.title }) === "customers");
  if (customers.length) {
    void addSources(customers.map((x) => ({ kind: "read" as const, ingested: x.ing! })), { under: card });
    for (const x of customers) sourceCame(x.ing!.title);
  }
  const title = cardTitle(card);
  for (const x of read) {
    if (customers.includes(x)) continue;
    const name = x.ing?.title || x.file.name;
    const said = title ? `A file for “${title}”` : "A file for this card";
    const docs: ChatDoc[] = [{ from: "computer", title: name, at: new Date(x.file.lastModified).toISOString(), ...(x.ing?.pages?.length ? { pages: x.ing.pages.length } : {}), voice: "own" }];
    const source = newId();
    const id = addTurn(said, { kind: "dump", source, file: { card, title: name } }, docs);
    try {
      if (!x.ing) throw new Error(x.error ?? "It couldn't be read.");
      await startDump(x.ing.text, { id: source, file: { title: name, card } });
      sourceCame(name);
    } catch (e) {
      change((c) => withJob(c, id, (j) => (j.kind === "dump" ? { ...j, error: message(e) } : j)));
    }
  }
}

/** A file read for a card, left out: its source goes (nothing rests on it yet). */
export async function leaveFile(id: string) {
  const j = turnOf(id)?.job;
  if (j?.kind !== "dump" || !j.file) return;
  stopTurn(id);
  change((c) => withJob(c, id, (x) => (x.kind === "dump" && x.file ? { ...x, file: { ...x.file, left: true } } : x)));
  await orgFetch(`/sources/${encodeURIComponent(j.source)}`, { method: "DELETE" }).then(
    () => useSources.setState((st) => ({ list: st.list.filter((x) => x.id !== j.source) })),
    () => {},
  );
}

/** Another file in place of one that doesn't bear on its card. */
export async function anotherFile(id: string, files: readonly File[]) {
  const j = turnOf(id)?.job;
  if (j?.kind !== "dump" || !j.file || !files.length) return;
  const card = j.file.card;
  await leaveFile(id);
  await fileFor(card, files);
}

/** A turn taken out of the chat (what it made stays where it is). */
export function dropTurn(id: string) {
  stopTurn(id);
  change((c) => ({ ...c, turns: c.turns.filter((t) => t.id !== id) }));
}

// ---------------------------------------------------------------------------
// Writing it on the canvas

/** Their words as a goal or a problem: Qalam AI's wording first, for them to use, edit or leave (no engine: their words, at once). */
async function addCard(at: string | null, said: string, what: "goal" | "problem") {
  const kind = what === "goal" ? "outcome" : "opportunity";
  const under = placeFor(kind);
  if (!(await aiStatus()).ai) return void jobAt(at, said, { kind: "add", what, card: writeCard(kind, { title: titleFrom(said), under }), under });
  const id = jobAt(at, said, { kind: "add", what, card: "", under, state: "suggesting" });
  const n = under ? studio().doc.nodes[under] : undefined;
  const above = isOstCard(n) ? n.meta.ost.title : null;
  const r = await orgJson<{ statement: { statement: string; why: string } | null }>("/statement", { method: "POST", json: { what, said, above } }).catch(() => ({ statement: null }));
  change((c) => withJob(c, id, (j) => (j.kind === "add" && j.state === "suggesting" ? { ...j, state: "suggested", ...(r.statement ? { suggestion: r.statement.statement, why: r.statement.why } : {}) } : j)));
}

/**
 * The card written in the words they chose (Qalam AI's, edited or not, or their own), under where
 * it was to go; their own words stay on it as a note when the title isn't them.
 */
export function placeStatement(id: string, title: string) {
  const t = turnOf(id);
  if (t?.job.kind !== "add" || t.job.state !== "suggested") return;
  const j = t.job;
  const kind = j.what === "goal" ? "outcome" : "opportunity";
  const words = title.replace(/\s+/g, " ").trim() || titleFrom(t.said);
  const under = j.under && studio().doc.nodes[j.under] ? j.under : placeFor(kind);
  const theirs = titleFrom(t.said);
  const card = writeCard(kind, { title: words, under, ...(words !== theirs ? { evidence: [{ id: newId(), kind: "note", text: t.said.slice(0, 1200), addedBy: "user", at: Date.now() }] } : {}) });
  change((c) => withJob(c, id, () => ({ kind: "add", what: j.what, card, under })));
}

// ---------------------------------------------------------------------------
// Taking in what customers said

/**
 * Material taken in as the organization's sources (server/capture.ts): each doc, read for what it
 * states, and what they pasted when it reads as who said what. A doc they said is their own, and long
 * text that came with it, are kept as their thinking (read as what they believe). A doc nobody said
 * anything about that holds only their thinking goes on to a brain dump: its pushback and rounds.
 */
async function takeIn(at: string | null, said: string, docs: readonly SentDoc[]) {
  const id = jobAt(at, said, { kind: "take", state: "taking", sources: [], pages: [], quotes: 0 }, docs.map(docRef));
  const ctrl = begin(id);
  const parts: { ing: () => Promise<Ingested>; own: boolean; basis?: Basis; doc?: SentDoc }[] = [];
  const voice = said ? guessVoice({ text: said, title: "" }) : "own";
  if (said && (voice === "customers" || wordsIn(said) >= DUMP_WORDS)) parts.push({ ing: () => ingestPaste(said), own: voice !== "customers" });
  for (const d of docs) parts.push({ ing: async () => d.ingested, own: d.basis === "own", ...(d.basis ? { basis: d.basis } : {}), doc: d });
  const sources: string[] = [];
  const taken: TakenDoc[] = [];
  const held: SentDoc[] = [];
  const pages = new Map<string, FiledPage>();
  let quotes = 0;
  try {
    for (const p of parts) {
      const ing = await p.ing();
      sourceCame(ing.title);
      const r = await captureIngested(ing, { product: st().space, own: p.own, ...(p.basis ? { basis: p.basis } : {}), holdOwn: !!p.doc && !p.basis, proposeGoals: !!p.doc, onActivity: step(id), signal: ctrl.signal });
      if (r.heldOwn) {
        held.push(p.doc!);
        continue;
      }
      sources.push(r.sourceId);
      quotes += r.quotes;
      taken.push({ source: r.sourceId, title: r.title, ...(r.about ? { about: r.about } : {}), points: r.points ?? {}, ...(p.basis ? { basis: p.basis } : {}), ...numbersOf(r), ...(r.foundGoals?.length ? { found: r.foundGoals } : {}) });
      for (const f of r.filed?.pages ?? []) if (f.kind === "need") pages.set(f.id, { id: f.id, title: f.title });
      change((c) => withJob(c, id, (j) => (j.kind === "take" ? { ...j, sources: [...sources], pages: [...pages.values()], quotes, docs: [...taken] } : j)));
    }
    change((c) => withJob(c, id, (j) => (j.kind === "take" ? { ...j, state: "done" } : j)));
  } catch (e) {
    const stopped = (e as Error).name === "AbortError";
    change((c) => withJob(c, id, (j) => (j.kind === "take" ? { ...j, state: "failed", error: stopped ? `You stopped it${sources.length ? `, after keeping ${sources.length}` : ""}.` : `It couldn't be taken in: ${message(e)}` } : j)));
  } finally {
    end(id);
  }
  // What reads as their own thinking gets a brain dump's conversation: in this turn when it's all there was.
  for (const [i, d] of held.entries()) void dumpIt(i === 0 && !taken.length ? id : null, i === 0 && !taken.length ? said : `“${d.title}”`, [d], true);
}

/** The numbers a document measured for goals, by the goals' words (a goal since gone is left out). */
function numbersOf(r: { goalNumbers?: { goal: string; value: number }[] }): { numbers?: NonNullable<TakenDoc["numbers"]> } {
  const numbers = (r.goalNumbers ?? []).flatMap((n) => {
    const g = goalById(goalsNow(), n.goal);
    return g ? [{ goal: n.goal, title: g.title, value: n.value }] : [];
  });
  return numbers.length ? { numbers } : {};
}

/** A number a document measured, taken as its goal's: as a read from a tool is, so it isn't a decision. */
export async function takeGoalNumber(turn: string, doc: TakenDoc, n: NonNullable<TakenDoc["numbers"]>[number]) {
  const g = goalById(goalsNow(), n.goal);
  if (!g?.metric) return;
  await changeGoal(n.goal, { metric: { ...g.metric, current: n.value, source: { connector: "document", ref: doc.source, label: doc.title }, readAt: Date.now() } });
  change((c) => withJob(c, turn, (j) => (j.kind === "take" && j.docs ? { ...j, docs: j.docs.map((d) => (d.source === doc.source ? { ...d, numbers: d.numbers?.map((x) => (x.goal === n.goal ? { ...x, used: true as const } : x)) } : d)) } : j)));
}

/** A goal a document pointed to, accepted (it goes on the canvas, its problems under it) or left out. */
export async function decideDocGoal(turn: string, source: string, found: string, accept: boolean) {
  const r = await decideFoundGoal(source, found, accept);
  change((c) => withJob(c, turn, (j) => (j.kind === "take" && j.docs ? { ...j, docs: j.docs.map((d) => (d.source === source ? { ...d, found: d.found?.map((g) => (g.id === found ? { ...g, state: accept ? ("accepted" as const) : ("left" as const), ...(r.goal ? { goal: r.goal } : {}) } : g)) } : d)) } : j)));
}

/** What a document they took in rests on, as they say: its points go by that, and the page lines citing them move. */
export async function changeDocBasis(turn: string, source: string, basis: Basis) {
  await setSourceBasis(source, basis);
  change((c) =>
    withJob(c, turn, (j) => {
      if (j.kind !== "take" || !j.docs) return j;
      return { ...j, docs: j.docs.map((d) => { if (d.source !== source) return d; const n = Object.values(d.points).reduce((a, b) => a + (b ?? 0), 0); return { ...d, basis, points: n ? { [basis]: n } : {} }; }) };
    }),
  );
}

/** A doc that read as their own thinking, taken in as what they say it is instead: the brain dump stops, its source goes. */
export async function takeAsBasis(id: string, basis: Basis) {
  const t = turnOf(id);
  if (t?.job.kind !== "dump" || !t.job.asOwn) return;
  const { source, asOwn } = t.job;
  const text = sourceOf(source)?.text;
  if (!text) return;
  stopTurn(id);
  await orgFetch(`/sources/${encodeURIComponent(source)}`, { method: "DELETE" }).then(
    () => useSources.setState((st) => ({ list: st.list.filter((x) => x.id !== source) })),
    () => {},
  );
  const doc = { key: source, from: "computer", via: "this computer", title: asOwn.title, state: "ready", basis, ingested: { kind: "text", title: asOwn.title, text } } as SentDoc;
  await takeIn(id, t.said, [doc]);
}

/** What they're looking at on the canvas, for Qalam AI to hear: the card picked, else the page open, in its own words. */
export function aboutNow(): string | null {
  const s = studio();
  const doc = s.doc;
  const card = (id: string | undefined) => {
    const c = id && isOstCard(doc.nodes[id]) ? doc.nodes[id].meta.ost : undefined;
    return c?.title.trim() ? `${KIND_LABEL[c.kind]}: ${c.title.trim()}` : null;
  };
  if (s.selection.length === 1) {
    const picked = card(s.selection[0]);
    if (picked) return picked;
  }
  const open = pageOf(window.location.search);
  if (!open) return null;
  const shown = card(cardForPage(open.ref, useSpaceView.getState().things));
  if (shown) return `${shown} (its page is open)`;
  const g = "goal" in open.ref ? goalById(goalsNow(), open.ref.goal) : undefined;
  return g ? `Goal: ${g.title} (its page is open)` : null;
}

// ---------------------------------------------------------------------------
// Ask

/** A question for the organization, answered in the thread (the answer is kept with it); `at`: a turn asked instead. */
export async function ask(question: string, at: string | null = null): Promise<void> {
  const q = question.replace(/\s+/g, " ").trim();
  if (q.length < 3) return;
  const id = jobAt(at, q, { kind: "ask", state: "asking" });
  if (!(await aiStatus()).ai) return change((c) => withJob(c, id, () => ({ kind: "ask", state: "failed", error: "Qalam AI isn't set up here. Connections says how." })));
  const ctrl = begin(id);
  const started = Date.now();
  try {
    const answer = await askOrganization(q, { product: st().space, about: aboutNow(), signal: ctrl.signal, onActivity: step(id) });
    change((c) => withJob(c, id, () => ({ kind: "ask", state: "answered", answer, secs: Math.round((Date.now() - started) / 1000) })));
  } catch (e) {
    const stopped = (e as Error).name === "AbortError";
    change((c) => withJob(c, id, () => ({ kind: "ask", state: "failed", error: stopped ? "You stopped it." : message(e) })));
  } finally {
    end(id);
  }
}

/** Stop what a turn is running (a brain dump's call too). */
export function stopTurn(id: string) {
  ctrls.get(id)?.abort();
  const j = turnOf(id)?.job;
  if (j?.kind === "dump" && useDump.getState().busy?.sourceId === j.source) stopDump(j.source);
}
