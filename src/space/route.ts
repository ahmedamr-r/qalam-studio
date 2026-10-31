import { isQuestion } from "@/discovery/speakers";

/*
 * What a message to the canvas's chat is for, worked out by code with no tokens
 * (src/ui/space/chat/): a question asks the organization; what customers said is taken in as
 * material (kept, filed into problem pages, placed where it fits); the person's own long text or
 * doc is a brain dump, read and placed on the canvas; a short statement could be a goal, a
 * problem or a question, so the chat asks which (its chips, a number putting the goal first).
 * A mode a button set (Write a goal, Find a problem…) wins. The chat says how it took each message,
 * and they can switch.
 */

/** What a message can be taken as. */
export type ChatMode = "ask" | "dump" | "take" | "goal" | "problem";

export type Routed = { job: ChatMode } | { job: "choose"; first: "goal" | "problem" };

/** At least this many words, or this many lines, and their own text is a brain dump. */
export const DUMP_WORDS = 40;
const DUMP_LINES = 3;

export const wordsIn = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const lines = (s: string) => s.split("\n").filter((l) => l.trim()).length;

/**
 * `docs`: whose words each doc holds (the box's chip); `pasted`: whose words the typed text reads
 * as (customers' when it's who said what). Null: nothing to send.
 */
export function routeOf(i: { text: string; docs: readonly { voice?: "customers" | "own" }[]; pasted?: "customers" | "own"; mode?: ChatMode | null }): Routed | null {
  const text = i.text.trim();
  if (!text && !i.docs.length) return null;
  if (i.mode) return { job: i.mode };
  // Anything customers said is taken in as material, with whatever of theirs came along.
  if (i.docs.some((d) => d.voice === "customers") || (text && i.pasted === "customers")) return { job: "take" };
  if (i.docs.length || wordsIn(text) >= DUMP_WORDS || lines(text) >= DUMP_LINES) return { job: "dump" };
  if (isQuestion(text)) return { job: "ask" };
  return { job: "choose", first: /\d/.test(text) ? "goal" : "problem" };
}

/** A card's title from what they wrote: their words, on one line, as long as a title runs. */
export const titleFrom = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 200);
