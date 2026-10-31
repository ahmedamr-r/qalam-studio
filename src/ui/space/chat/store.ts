import { nanoid } from "nanoid";
import { create } from "zustand";
import { aiStatus } from "@/ai/client";
import { studio } from "@/doc/store";
import { isOstCard } from "@/doc/board";
import { KIND_LABEL } from "@/discovery/kinds";
import { goalsNow } from "@/goals/client";
import { goalById } from "@/goals/tree";
import { askOrganization } from "@/org/ask";
import { orgFetch, orgJson } from "@/org/client";
import { chatKey, chatOf, emptyChat, withJob, withTurn, type CanvasChat, type ChatJob, type ChatTurn } from "@/space/chat";
import { cardForPage, pageOf } from "@/space/pages";
import { useSpaceView } from "@/space/view";

/*
 * Qalam AI's chat beside a space's canvas, in the window: the canvas's turns (src/space/chat.ts),
 * loaded as the canvas opens and saved a moment after each change, and what's running now (an
 * ask's steps and its Stop), which is never kept.
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
}

export const useCanvasChat = create<ChatState>(() => ({ key: null, space: null, chat: emptyChat(), loaded: false, live: {} }));

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
  if (st().key === key) useCanvasChat.setState({ chat, loaded: true });
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

function addTurn(said: string, job: ChatJob, docs?: ChatTurn["docs"]): string {
  const id = nanoid(10);
  change((c) => withTurn(c, { id, at: Date.now(), said, ...(docs?.length ? { docs } : {}), job }));
  return id;
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

/** A question for the organization, answered in the thread (the answer is kept with it). */
export async function ask(question: string): Promise<void> {
  const q = question.replace(/\s+/g, " ").trim();
  if (q.length < 3) return;
  const id = addTurn(q, { kind: "ask", state: "asking" });
  if (!(await aiStatus()).ai) return change((c) => withJob(c, id, () => ({ kind: "ask", state: "failed", error: "Qalam AI isn't set up here. Connections says how." })));
  const ctrl = new AbortController();
  ctrls.set(id, ctrl);
  const started = Date.now();
  useCanvasChat.setState((s) => ({ live: { ...s.live, [id]: { steps: [], started } } }));
  try {
    const answer = await askOrganization(q, {
      product: st().space,
      about: aboutNow(),
      signal: ctrl.signal,
      onActivity: (label) => useCanvasChat.setState((s) => (s.live[id] ? { live: { ...s.live, [id]: { ...s.live[id], steps: [...s.live[id].steps, label].slice(-4) } } } : s)),
    });
    change((c) => withJob(c, id, () => ({ kind: "ask", state: "answered", answer, secs: Math.round((Date.now() - started) / 1000) })));
  } catch (e) {
    const stopped = (e as Error).name === "AbortError";
    change((c) => withJob(c, id, () => ({ kind: "ask", state: "failed", error: stopped ? "You stopped it." : message(e) })));
  } finally {
    ctrls.delete(id);
    useCanvasChat.setState((s) => {
      const { [id]: _gone, ...live } = s.live;
      return { live };
    });
  }
}

/** Stop what a turn is running. */
export function stopTurn(id: string) {
  ctrls.get(id)?.abort();
}
