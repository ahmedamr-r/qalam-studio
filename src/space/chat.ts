import type { AskAnswer } from "@/hub/ask";
import type { SetupDoc } from "@/org/setup";

/*
 * Qalam AI's chat on the left of a space's canvas (src/ui/space/chat/), as it's kept: one file per
 * canvas (chats/canvas/<key>.json, this computer's, out of Git), a turn per message sent, each
 * saying what was said and the job it became. The thread is worked out from the turns and what
 * the jobs point at (threadOf), never kept itself, so a reload shows it as it was. Pure.
 */

/** A canvas's key: its product's id, or `org` for the organization's own. */
export const chatKey = (space: string | null) => space ?? "org";
export const CHAT_KEY = /^[A-Za-z0-9_-]{1,64}$/;
/** The newest turns kept: an older one is dropped as a new one comes. */
export const MAX_TURNS = 100;

export type ChatDoc = Omit<SetupDoc, "span" | "cut">;

export type ChatJob = { kind: "ask"; state: "asking" | "answered" | "failed"; answer?: AskAnswer; secs?: number; error?: string };

export interface ChatTurn {
  id: string;
  at: number;
  /** Their words as sent. */
  said: string;
  docs?: ChatDoc[];
  job: ChatJob;
}

export interface CanvasChat {
  v: 1;
  turns: ChatTurn[];
}

export const emptyChat = (): CanvasChat => ({ v: 1, turns: [] });

/** A chat as read from its file: a turn still running when the page went is over (nothing carries it on). */
export function chatOf(raw: unknown): CanvasChat {
  const c = raw as Partial<CanvasChat> | null;
  if (!c || c.v !== 1 || !Array.isArray(c.turns)) return emptyChat();
  return {
    v: 1,
    turns: c.turns.filter((t) => t && typeof t.id === "string" && typeof t.said === "string" && t.job).map((t) => (t.job.kind === "ask" && t.job.state === "asking" ? { ...t, job: { ...t.job, state: "failed" as const, error: "It stopped when the page closed. Ask again." } } : t)),
  };
}

/** A turn added: the newest MAX_TURNS kept. */
export const withTurn = (c: CanvasChat, t: ChatTurn): CanvasChat => ({ ...c, turns: [...c.turns, t].slice(-MAX_TURNS) });

/** A turn changed in place (gone: nothing changes). */
export const withJob = (c: CanvasChat, id: string, fn: (j: ChatJob) => ChatJob): CanvasChat => ({ ...c, turns: c.turns.map((t) => (t.id === id ? { ...t, job: fn(t.job) } : t)) });

// ---------------------------------------------------------------------------
// The thread

export type PartData = Record<string, string | number | boolean | null>;
export type ChatPart = { type: "text"; text: string } | { type: "data"; name: string; data: PartData };
export interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  parts: ChatPart[];
}

const you = (t: ChatTurn): ChatMessage => ({
  id: `${t.id}:you`,
  role: "user",
  parts: [...(t.said.trim() ? [{ type: "text" as const, text: t.said }] : []), ...(t.docs?.length ? [{ type: "data" as const, name: "docs", data: { turn: t.id } }] : [])],
});

const reply = (t: ChatTurn, parts: ChatPart[]): ChatMessage => ({ id: `${t.id}:ai`, role: "assistant", parts });
const text = (s: string): ChatPart => ({ type: "text", text: s });
const part = (name: string, data: PartData): ChatPart => ({ type: "data", name, data });

/** The conversation, from the turns: each one's words, then what Qalam AI made of it. */
export function threadOf(c: CanvasChat): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const t of c.turns) {
    out.push(you(t));
    const j = t.job;
    if (j.kind === "ask") {
      if (j.state === "asking") out.push(reply(t, [part("working", { turn: t.id })]));
      else if (j.state === "failed") out.push(reply(t, [text(`I couldn't answer that: ${j.error ?? "something went wrong"}`)]));
      else out.push(reply(t, [part("answer", { turn: t.id })]));
    }
  }
  return out;
}

/** Whether something in the chat is still running (the composer offers Stop). */
export const running = (c: CanvasChat): ChatTurn | null => [...c.turns].reverse().find((t) => t.job.kind === "ask" && t.job.state === "asking") ?? null;
