import { create } from "zustand";
import type { KnownAnswer } from "@/memory/known";
import type { AskedAbout, AskedFlow, RoundAnswer } from "@/memory/types";
import { orgJson } from "./client";
import { onOrgChange } from "./live";

/*
 * Qalam AI's memory of what it asked, in the window (server/org/memory.ts keeps it): each round's answers
 * remembered as it closes, and what's remembered, listed in the Company panel with Forget, followed as
 * it changes (a round here, a teammate's lines arriving through Git).
 */

/** A remembered answer as the core lists it. */
export interface MemoryLine {
  id: string;
  at: number;
  flow: AskedFlow;
  q: string;
  a: string;
  how: "own" | "pick" | "unknown" | "left";
  mine: boolean;
  name?: string;
  shared: boolean;
  about: AskedAbout;
}

interface MemoryState {
  entries: MemoryLine[];
  loaded: boolean;
  error: string | null;
}

export const useMemory = create<MemoryState>(() => ({ entries: [], loaded: false, error: null }));

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
let following: (() => void) | null = null;

export async function loadMemory(): Promise<void> {
  following ??= onOrgChange((c) => {
    if (c.kind === "asked") void loadMemory();
  });
  try {
    const r = await orgJson<{ entries: MemoryLine[] }>("/memory");
    useMemory.setState({ entries: r.entries, loaded: true, error: null });
  } catch (e) {
    useMemory.setState({ loaded: true, error: message(e) });
  }
}

/** A line taken off: Qalam AI won't bring it up when it asks. */
export async function forgetMemory(id: string): Promise<void> {
  useMemory.setState((s) => ({ entries: s.entries.filter((e) => e.id !== id), error: null }));
  try {
    await orgJson(`/memory/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (e) {
    useMemory.setState({ error: message(e) });
    void loadMemory();
  }
}

/** What's already known, for a turn the window checks itself (the board interview, a brain dump): none when the core can't say. */
export async function recallKnown(o: { flow: AskedFlow; key: string; about: AskedAbout; words: string; broad?: boolean; sent?: string }): Promise<{ block: string; hay: string; ids: string[] } | null> {
  try {
    const r = await orgJson<{ block: string; hay: string; ids: string[] }>("/memory/recall", { method: "POST", json: { ...o, words: o.words.slice(0, 4000) } });
    return r.block ? r : null;
  } catch {
    return null;
  }
}

/** Questions with what was said before to each (src/memory/known.ts); as they were when the core can't say. */
export async function withKnownAnswers<Q extends { id: string; title: string }>(m: { flow: AskedFlow; key: string; about: AskedAbout } | null | undefined, questions: Q[]): Promise<(Q & { known?: KnownAnswer[] })[]> {
  if (!m || !questions.length) return questions;
  try {
    const r = await orgJson<{ known: Record<string, KnownAnswer[]> }>("/memory/known", { method: "POST", json: { ...m, questions: questions.map((q) => ({ id: q.id, title: q.title.slice(0, 400) })) } });
    return questions.map((q) => (r.known[q.id]?.length ? { ...q, known: r.known[q.id] } : q));
  } catch {
    return questions;
  }
}

/** A round's answers remembered. False when it didn't reach the core: the next round sends it again. */
export async function rememberRound(o: { flow: AskedFlow; key: string; about: AskedAbout; answers: RoundAnswer[] }): Promise<boolean> {
  if (!o.answers.length) return true;
  try {
    await orgJson("/memory/asked", { method: "POST", json: o });
    return true;
  } catch {
    return false;
  }
}
