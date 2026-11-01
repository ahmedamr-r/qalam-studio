import type { DumpSession } from "@/discovery/dump";
import type { AskAnswer } from "@/hub/ask";
import type { SetupDoc } from "@/org/setup";
import type { FindWhat } from "./find";
import type { PlanQuestion } from "@/ai/plan";

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

/** A problem page material went into. */
export interface FiledPage {
  id: string;
  title: string;
}

export type ChatJob =
  /** A question for the organization, and its checked answer. */
  | { kind: "ask"; state: "asking" | "answered" | "failed"; answer?: AskAnswer; secs?: number; error?: string }
  /** A short statement: is it a goal or a problem (or a question)? The chips say. */
  | { kind: "choose"; first: "goal" | "problem" }
  /**
   * Their words as a goal's or a problem's card: Qalam AI's wording first (`suggesting`, then
   * `suggested`, for them to use, edit or leave for their own words; none when it found none to
   * suggest), then the card written (`card`).
   */
  | { kind: "add"; what: "goal" | "problem"; card: string; under: string | null; state?: "suggesting" | "suggested"; suggestion?: string; why?: string }
  /** What customers said, taken in as sources: filed into problem pages, placed where it fits. */
  | { kind: "take"; state: "taking" | "done" | "failed"; sources: string[]; pages: FiledPage[]; quotes: number; error?: string }
  /**
   * Their own thinking as a brain dump: its source's session is how it's going (`error`: it never
   * started; `find`: it answers "Help me find one", with what they said to code's questions;
   * `file`: a file added for a card, read against it, `left` once they left it out).
   */
  | { kind: "dump"; source: string; error?: string; find?: { what: FindWhat; said: { question: string; answer: string }[] }; file?: { card: string; title: string; left?: true } }
  /** "Help me find one": code's opening questions, being answered (the box asks them). */
  | { kind: "find"; what: FindWhat; error?: string; /** Qalam AI's opening questions, from what's known about the company and its domain (none: code's own). */ questions?: PlanQuestion[]; /** Those being worked out. */ loading?: true };

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

/** A turn still running when the page went is over (nothing carries it on). */
function stopped(j: ChatJob): ChatJob {
  if (j.kind === "ask" && j.state === "asking") return { ...j, state: "failed", error: "It stopped when the page closed. Ask again." };
  // Capture goes on in the core: what was taken in shows up on the canvas and in its panel.
  if (j.kind === "take" && j.state === "taking") return { ...j, state: "failed", error: "The page closed while it was being taken in. What was kept is in the sources." };
  // A wording still being worked out when the page went: their own words, to add as they are.
  if (j.kind === "add" && j.state === "suggesting") return { ...j, state: "suggested" };
  // Questions still being worked out when the page went: code's own are asked instead.
  if (j.kind === "find" && j.loading) {
    const { loading: _gone, ...rest } = j;
    return rest;
  }
  return j;
}

const KINDS = new Set(["ask", "choose", "add", "take", "dump", "find"]);

/** A chat as read from its file (what it doesn't know is left out). */
export function chatOf(raw: unknown): CanvasChat {
  const c = raw as Partial<CanvasChat> | null;
  if (!c || c.v !== 1 || !Array.isArray(c.turns)) return emptyChat();
  return {
    v: 1,
    turns: c.turns.filter((t) => t && typeof t.id === "string" && typeof t.said === "string" && KINDS.has(t.job?.kind)).map((t) => ({ ...t, job: stopped(t.job) })),
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

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** A dump's session by its source's id (null: not loaded, or gone). */
export type DumpOf = (source: string) => DumpSession | null;

/** A brain dump in the thread: what Qalam AI took from it, each round answered, then where it stands. */
function dumpReply(t: ChatTurn, s: DumpSession | null): ChatPart[] {
  const id = { turn: t.id };
  if (!s || s.phase === "reading") return [part("dumping", id)];
  const out: ChatPart[] = [];
  if (s.understanding || s.challenges.length) out.push(part("took", id));
  const last = s.buckets.length - 1;
  s.buckets.forEach((b, i) => {
    if (i < last || s.phase !== "asking") out.push(part("answered", { turn: t.id, round: i }));
  });
  switch (s.phase) {
    case "asking":
      return [...out, text(last > 0 ? "A few more questions, then I'll place it." : "A few questions before I place it on the canvas: answer what you can."), part("skip", id)];
    case "analyzing":
    case "placing":
      return [...out, part("dumping", id)];
    case "ready":
      // A file that doesn't bear on its card: what would help instead.
      if (s.off) return [...out, part("off", id)];
      return [...out, text(s.skipped ? "I'll place it with what you've answered." : "I have what I need."), part("place", id)];
    case "review":
      return [...out, part("proposed", id)];
    case "placed":
      return [...out, part("placed", id)];
    case "failed":
      return [...out, text(s.failed?.error === "Stopped." ? "You stopped me before I finished." : `I couldn't finish: ${s.failed?.error ?? "something went wrong"}`), part("retry", id)];
  }
}

/** What Qalam AI says to a turn, from its job. */
function replyTo(t: ChatTurn, dumpOf: DumpOf): ChatPart[] {
  const j = t.job;
  const id = { turn: t.id };
  switch (j.kind) {
    case "ask":
      if (j.state === "asking") return [part("working", id)];
      if (j.state === "failed") return [text(`I couldn't answer that: ${j.error ?? "something went wrong"}`), part("switch", id)];
      return [part("answer", id), part("switch", id)];
    case "choose":
      return [text("Is it a goal or a problem? I'll suggest how to word it for the canvas."), part("choose", id)];
    case "add":
      if (j.state === "suggesting") return [part("working", id)];
      if (j.state === "suggested") return [part("statement", id)];
      return [part("added", id)];
    case "take":
      if (j.state === "taking") return [part("working", id)];
      if (j.state === "failed") return [text(j.error ?? "It couldn't be taken in.")];
      return [
        text(
          j.pages.length
            ? `I kept ${plural(j.sources.length, "source")}. ${j.quotes ? `${plural(j.quotes, "quote")} from customers went` : "What it says went"} into ${j.pages.length === 1 ? "this problem's page" : "these problems' pages"}:`
            : j.quotes
              ? `I kept ${plural(j.sources.length, "source")} and found ${plural(j.quotes, "quote")} from customers, but no problem's page took them in yet.`
              : `I kept ${plural(j.sources.length, "source")}, but found nothing customers said in ${j.sources.length === 1 ? "it" : "them"}.`,
        ),
        ...(j.pages.length ? [part("pages", id)] : []),
      ];
    case "dump":
      if (j.file?.left) return [text(`You left “${j.file.title}” out.`)];
      return [...(j.find ? [part("opening", id)] : []), ...(j.error ? [text(j.error)] : dumpReply(t, dumpOf(j.source)))];
    case "find":
      return [text(`A few questions first, then I'll suggest ${j.what === "goal" ? "a goal" : "a problem"} from what you say. Skip any you can't answer.`), ...(j.error ? [text(j.error)] : []), part("cancel", id)];
  }
}

/** The conversation, from the turns: each one's words, then what Qalam AI made of it. */
export function threadOf(c: CanvasChat, dumpOf: DumpOf = () => null): ChatMessage[] {
  return c.turns.flatMap((t) => [you(t), reply(t, replyTo(t, dumpOf))]);
}

/** Whose questions the box asks now: the newest "Help me find one" or brain dump waiting on its answers. */
export function asking(c: CanvasChat, dumpOf: DumpOf): ({ turn: ChatTurn } & ({ source: string } | { find: FindWhat })) | null {
  for (const t of [...c.turns].reverse()) {
    if (t.job.kind === "find") return { turn: t, find: t.job.what };
    if (t.job.kind !== "dump" || t.job.error) continue;
    if (dumpOf(t.job.source)?.phase === "asking") return { turn: t, source: t.job.source };
  }
  return null;
}

const busy = (j: ChatJob) => (j.kind === "ask" && j.state === "asking") || (j.kind === "take" && j.state === "taking");

/** What in the chat is still running (the composer offers Stop). */
export const running = (c: CanvasChat): ChatTurn | null => [...c.turns].reverse().find((t) => busy(t.job)) ?? null;
