import { create } from "zustand";
import { aiStatus } from "@/ai/client";
import { feedback } from "@/commands/feedback";
import { sourcesDb } from "@/discovery/db";
import type { SourceRecord } from "@/discovery/sources";
import { fileIntoTopics, unfiled, type FilingTotals } from "@/org/filing";

/**
 * Keeping the topic pages current: after a board reads sources, what customers said in them is
 * filed into the pages in the background; the home's Topics tab files what the pages haven't
 * seen yet, one run at a time, with its progress here.
 */

export interface FilingState {
  /** Calls done of the run's (null: no run). */
  step: { done: number; of: number } | null;
  /** What the last run did, or why it couldn't. */
  note: string | null;
  ctrl: AbortController | null;
}

export const useFiling = create<FilingState>(() => ({ step: null, note: null, ctrl: null }));

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Qalam AI started 2 pages and added 9 lines." */
export function filedNote(t: FilingTotals): string {
  const parts = [t.created && `started ${plural(t.created, "page")}`, t.added && `added ${plural(t.added, "line")}`, t.revised && `revised ${t.revised}`, t.disputed && `disputed ${t.disputed}`, t.retired && `took back ${t.retired}`].filter(Boolean) as string[];
  if (!parts.length) return "Qalam AI read them: the pages already say what they show.";
  return `Qalam AI ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0]}.`;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** File the sources' quotes the pages haven't seen (the home's Update pages). */
export async function updatePages(sources: SourceRecord[]): Promise<FilingTotals | null> {
  if (useFiling.getState().ctrl || !unfiled(sources).length) return null;
  if (!(await aiStatus()).ai) {
    useFiling.setState({ note: "Qalam AI isn't set up here, so it can't update the pages. You can still write in them yourself." });
    return null;
  }
  const ctrl = new AbortController();
  useFiling.setState({ ctrl, step: { done: 0, of: 1 }, note: null });
  try {
    const t = await fileIntoTopics(sources, { signal: ctrl.signal, onStep: (done, of) => useFiling.setState({ step: { done, of } }) });
    useFiling.setState({ note: ctrl.signal.aborted ? "Stopped. What Qalam AI filed so far is on the pages." : filedNote(t) });
    return t;
  } catch (e) {
    useFiling.setState({ note: (e as Error).name === "AbortError" ? "Stopped. What Qalam AI filed so far is on the pages." : `Qalam AI couldn't update the pages: ${message(e)}` });
    return null;
  } finally {
    useFiling.setState({ ctrl: null, step: null });
  }
}

export const stopFiling = () => useFiling.getState().ctrl?.abort();

/**
 * A board read some sources: file what customers said in them into the pages, in the background.
 * The sources are read again first, so quotes the pages have seen since aren't sent twice.
 */
export async function fileAfterReading(ids: string[], product: string | null) {
  if (!ids.length || useFiling.getState().ctrl) return;
  try {
    const sources = (await Promise.all(ids.map((id) => sourcesDb.get(id).catch(() => null)))).filter((s): s is SourceRecord => !!s);
    if (!unfiled(sources).length) return;
    const t = await fileIntoTopics(sources, { product });
    if (t.added || t.revised || t.disputed || t.retired) feedback(`Topic pages: ${filedNote(t)}`, { id: "topics.filed" });
  } catch {
    // Quietly: the home's Update pages files them later.
  }
}
