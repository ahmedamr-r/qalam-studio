import type { Basis } from "@/discovery/basis";
import { isQuestion } from "@/discovery/speakers";
import { isAppLink } from "@/scan/input";

/*
 * What a message to the canvas's chat is for, worked out by code with no tokens
 * (src/ui/space/chat/): a question asks the organization; what customers said is taken in as
 * material (read for what it states, kept, filed into problem pages, placed where it fits), as is any
 * doc, unless they said it's their own thinking; the person's own long text or
 * doc set to their own thinking is a brain dump, read and placed on the canvas; a short statement could be a goal, a
 * problem or a question, so the chat asks which (its chips, a number putting the goal first); an
 * app's link, or the box set to it, reads what people complain about (src/scan/).
 * A mode a button set (Write a goal, Find a problem…) wins. The chat says how it took each message,
 * and they can switch.
 */

/** What a message can be taken as. */
export type ChatMode = "ask" | "dump" | "take" | "goal" | "problem" | "scan";

export type Routed = { job: ChatMode } | { job: "choose"; first: "goal" | "problem" };

/** At least this many words, or this many lines, and their own text is a brain dump. */
export const DUMP_WORDS = 40;
const DUMP_LINES = 3;

export const wordsIn = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const lines = (s: string) => s.split("\n").filter((l) => l.trim()).length;

/**
 * `docs`: what each doc rests on, where they set it (the box's chip; else the reader says); `pasted`:
 * whose words the typed text reads as (customers' when it's who said what). Null: nothing to send.
 */
export function routeOf(i: { text: string; docs: readonly { basis?: Basis }[]; pasted?: "customers" | "own"; mode?: ChatMode | null }): Routed | null {
  const text = i.text.trim();
  if (!text && !i.docs.length) return null;
  if (i.mode) return { job: i.mode };
  // An app's link alone: what its users complain about.
  if (!i.docs.length && isAppLink(text)) return { job: "scan" };
  // Any doc is read for what it states, with whatever of theirs came along; so is a paste of who said what.
  if (i.docs.some((d) => d.basis !== "own") || (text && i.pasted === "customers")) return { job: "take" };
  if (i.docs.length || wordsIn(text) >= DUMP_WORDS || lines(text) >= DUMP_LINES) return { job: "dump" };
  if (isQuestion(text)) return { job: "ask" };
  return { job: "choose", first: /\d/.test(text) ? "goal" : "problem" };
}

/** A card's title from what they wrote: their words, on one line, as long as a title runs. */
export const titleFrom = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 200);
