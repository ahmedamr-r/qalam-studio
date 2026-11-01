import { nanoid } from "nanoid";
import { create } from "zustand";
import { aiStatus } from "@/ai/client";
import { studio } from "@/doc/store";
import { isOstCard } from "@/doc/board";
import { KIND_LABEL } from "@/discovery/kinds";
import { goalsNow } from "@/goals/client";
import { goalById } from "@/goals/tree";
import { askOrganization } from "@/org/ask";
import { captureIngested } from "@/org/capture";
import { orgFetch, orgJson } from "@/org/client";
import type { Ingested } from "@/discovery/ingest/core";
import { chatKey, chatOf, emptyChat, withJob, withTurn, type CanvasChat, type ChatDoc, type ChatJob, type ChatTurn, type FiledPage } from "@/space/chat";
import { cardForPage, pageOf } from "@/space/pages";
import { DUMP_WORDS, routeOf, titleFrom, wordsIn, type ChatMode } from "@/space/route";
import { FIND_MIN, findRound, findText, type FindWhat } from "@/space/find";
import { useSpaceView } from "@/space/view";
import { newId } from "@/doc/factory";
import { docPart, docRef, guessVoice, joinParts, type SentDoc } from "../../chat/attach";
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
async function dumpIt(at: string | null, said: string, docs: readonly SentDoc[]) {
  const source = newId();
  const id = jobAt(at, said, { kind: "dump", source }, docs.map(docRef));
  const text = joinParts([...(said ? [{ body: said }] : []), ...docs.map((d) => docPart({ via: d.via, title: d.title, text: d.ingested.text, blocks: d.ingested.blocks, voice: d.voice }))]).text;
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
  addTurn(FIND_SAID[what], { kind: "find", what });
}

/** The opening round answered: their answers read as a brain dump that's asked for a goal or a problem. */
export async function answerFind(id: string, answers: Readonly<Record<string, string>>) {
  const t = turnOf(id);
  if (t?.job.kind !== "find") return;
  const what = t.job.what;
  const { text, asked, said } = findText(findRound(what), answers);
  if (text.length < FIND_MIN) return change((c) => withJob(c, id, () => ({ kind: "find", what, error: "Say a little more in your answers, so there's something to go on." })));
  const source = newId();
  change((c) => withJob(c, id, () => ({ kind: "dump", source, find: { what, said } })));
  try {
    await startDump(text, { id: source, aim: { find: what, asked } });
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

function addCard(at: string | null, said: string, what: "goal" | "problem") {
  const kind = what === "goal" ? "outcome" : "opportunity";
  const under = placeFor(kind);
  const card = writeCard(kind, { title: titleFrom(said), under });
  jobAt(at, said, { kind: "add", what, card, under });
}

// ---------------------------------------------------------------------------
// Taking in what customers said

/**
 * What customers said, taken in as the organization's sources (server/capture.ts): each of their
 * docs, and what they pasted when it reads as who said what. Their own docs and long text that came
 * with it are kept as their thinking (read as what they believe).
 */
async function takeIn(at: string | null, said: string, docs: readonly SentDoc[]) {
  const id = jobAt(at, said, { kind: "take", state: "taking", sources: [], pages: [], quotes: 0 }, docs.map(docRef));
  const ctrl = begin(id);
  const parts: { ing: () => Promise<Ingested>; own: boolean }[] = [];
  const voice = said ? guessVoice({ text: said, title: "" }) : "own";
  if (said && (voice === "customers" || wordsIn(said) >= DUMP_WORDS)) parts.push({ ing: () => ingestPaste(said), own: voice !== "customers" });
  for (const d of docs) parts.push({ ing: async () => d.ingested, own: d.voice !== "customers" });
  const sources: string[] = [];
  const pages = new Map<string, FiledPage>();
  let quotes = 0;
  try {
    for (const p of parts) {
      const ing = await p.ing();
      sourceCame(ing.title);
      const r = await captureIngested(ing, { product: st().space, own: p.own, onActivity: step(id), signal: ctrl.signal });
      sources.push(r.sourceId);
      quotes += r.quotes;
      for (const f of r.filed?.pages ?? []) if (f.kind === "need") pages.set(f.id, { id: f.id, title: f.title });
      change((c) => withJob(c, id, (j) => (j.kind === "take" ? { ...j, sources: [...sources], pages: [...pages.values()], quotes } : j)));
    }
    change((c) => withJob(c, id, (j) => (j.kind === "take" ? { ...j, state: "done" } : j)));
  } catch (e) {
    const stopped = (e as Error).name === "AbortError";
    change((c) => withJob(c, id, (j) => (j.kind === "take" ? { ...j, state: "failed", error: stopped ? `You stopped it${sources.length ? `, after keeping ${sources.length}` : ""}.` : `It couldn't be taken in: ${message(e)}` } : j)));
  } finally {
    end(id);
  }
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
