import { callAI } from "@/ai/client";
import type { LookedOnline } from "@/discovery/ingest/posts";
import { orgPath } from "./client";

/*
 * What people say online about a problem, from the window (server/org/posts.ts): its page's words,
 * or a card's and what the person said about it. What comes in is placed only under the card
 * (`place`; its board not made yet: nowhere), and the sources kept come back to be read.
 */

export interface OnlineAsk {
  /** The problem's page, when it has one. */
  topic?: string | null;
  title: string;
  words: string;
  product: string | null;
  place: { board: string | null; card: string };
}

export async function lookOnline(ask: OnlineAsk, onActivity?: (label: string) => void, signal?: AbortSignal): Promise<LookedOnline> {
  const path = ask.topic ? `/topics/${encodeURIComponent(ask.topic)}/online` : "/online";
  const body = ask.topic ? { place: ask.place } : { title: ask.title, words: ask.words, product: ask.product, place: ask.place };
  const { data } = await callAI<LookedOnline>(await orgPath(path), body, undefined, signal, (e) => e.type === "activity" && onActivity?.(e.label));
  return data;
}
