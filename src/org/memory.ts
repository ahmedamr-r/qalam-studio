import { create } from "zustand";
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
