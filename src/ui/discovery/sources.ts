import { create } from "zustand";
import { studio } from "@/doc/store";
import { feedback } from "@/commands/feedback";
import { sourcesDb } from "@/discovery/db";
import type { SourceKind, SourceRecord } from "@/discovery/sources";

/*
 * A Discovery board's sources in the page: the list (kept in IndexedDB, see discovery/db.ts), what
 * is being read or quoted right now, and the source open in the Sources tab (Qalam AI's proposals
 * waiting for review are review.ts's).
 */

export interface SourceJob {
  /** reading: the file or page is being read · quoting: Qalam AI is picking out what customers said. */
  phase: "reading" | "quoting";
  /** Until it's stored: what it will be called. */
  title?: string;
  kind?: SourceKind;
}

export interface SourcesUI {
  projectId: string | null;
  loaded: boolean;
  list: SourceRecord[];
  /**
   * The organization's sources a call quoted that aren't on the board: here so their quotes show
   * and attach while proposals wait; one joins the board when a proposal quoting it is accepted.
   */
  visiting: SourceRecord[];
  /** By source id (or a placeholder id while a source is still being read). */
  jobs: Record<string, SourceJob>;
  /** What couldn't be added, and why (until dismissed). */
  failed: { id: string; title: string; error: string }[];
  /** The source open in the tab, and a quote to show in it. */
  open: { id: string; quoteId?: string } | null;
  /** The tab's "Add a source" form is open. */
  adding: boolean;
  /** Qalam AI is mapping quotes to the tree. */
  mapping: { started: number; tokens: number } | null;
  /** Something the last run has to say ("Read 3 of 5 parts…"), with what to do about it. */
  notice: { text: string; action?: "read" } | null;
  /** Something is being read, quoted or mapped (Stop stops all of it). */
  busy: boolean;
}

export const useSources = create<SourcesUI>(() => ({
  projectId: null,
  loaded: false,
  list: [],
  visiting: [],
  jobs: {},
  failed: [],
  open: null,
  adding: false,
  mapping: null,
  notice: null,
  busy: false,
}));

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __sources: typeof useSources }).__sources = useSources;
}

export const sourcesState = () => useSources.getState();
export const sourceOf = (id: string | undefined) => {
  if (!id) return undefined;
  const st = useSources.getState();
  return st.list.find((s) => s.id === id) ?? st.visiting.find((s) => s.id === id);
};
const onBoard = (id: string) => useSources.getState().list.some((s) => s.id === id);

/** The board's sources, from the organization's folder. */
export async function loadSources(projectId: string) {
  if (useSources.getState().projectId === projectId && useSources.getState().loaded) return;
  useSources.setState({ projectId, loaded: false, list: [], visiting: [] });
  const list = await sourcesDb.list(projectId).catch(() => [] as SourceRecord[]);
  if (useSources.getState().projectId !== projectId) return;
  useSources.setState({ list: list.sort((a, b) => a.addedAt - b.addedAt), loaded: true });
}

/** The board's sources changed elsewhere (another window, the folder on disk): read them again. */
export async function reloadSources(projectId: string) {
  const list = await sourcesDb.list(projectId).catch(() => null);
  if (!list || useSources.getState().projectId !== projectId) return;
  // A visiting source that joined the board is the board's now.
  useSources.setState((s) => ({ list: list.sort((a, b) => a.addedAt - b.addedAt), loaded: true, visiting: s.visiting.filter((v) => !list.some((x) => x.id === v.id)) }));
}

/** Load the organization's sources these quotes are from that aren't on the board (for the proposals that quote them). */
export async function visitSources(ids: (string | null | undefined)[]) {
  const st = useSources.getState();
  const want = [...new Set(ids.filter((id): id is string => !!id))].filter((id) => !onBoard(id) && !st.visiting.some((v) => v.id === id));
  if (!want.length) return;
  const got = (await Promise.all(want.map((id) => sourcesDb.get(id).catch(() => null)))).filter((s): s is SourceRecord => !!s?.id);
  if (got.length) useSources.setState((s) => ({ visiting: [...s.visiting.filter((v) => !got.some((g) => g.id === v.id)), ...got] }));
}

/** Put on the board the visiting sources among these: something from them is on the board now. */
export async function adoptSources(ids: string[]) {
  const board = useSources.getState().projectId;
  const join = [...new Set(ids)].filter((id) => !onBoard(id) && useSources.getState().visiting.some((v) => v.id === id));
  if (!board || !join.length) return;
  for (const id of join) await sourcesDb.link(id, board, true).catch(() => {});
  await reloadSources(board);
}

async function persist(s: SourceRecord) {
  await sourcesDb.put(s).catch(() => feedback("Couldn't save the source to your organization's folder", { kind: "error", id: "discovery.sources" }));
}

export async function addSourceRecord(s: SourceRecord) {
  useSources.setState((st) => ({ list: [...st.list.filter((x) => x.id !== s.id), s] }));
  await persist(s);
}

/** Change a source from its current version (runs in parallel don't overwrite each other). */
export async function updateSource(id: string, fn: (s: SourceRecord) => SourceRecord) {
  const cur = sourceOf(id);
  if (!cur) return;
  const next = fn(cur);
  useSources.setState((st) => ({ list: st.list.map((x) => (x.id === id ? next : x)), visiting: st.visiting.map((x) => (x.id === id ? next : x)) }));
  await persist(next);
}

/** Take a source off this board. It stays in the organization, for other boards (and this one again). */
export async function removeSource(id: string) {
  const board = useSources.getState().projectId;
  if (!sourceOf(id) || !board) return;
  useSources.setState((st) => ({
    list: st.list.filter((x) => x.id !== id),
    open: st.open?.id === id ? null : st.open,
  }));
  await sourcesDb.link(id, board, false).catch(() => {});
}

/** Put one of the organization's sources on this board. */
export async function addFromOrganization(id: string) {
  const board = useSources.getState().projectId;
  if (!board) return;
  await sourcesDb.link(id, board, true);
  await reloadSources(board);
}

export function setJob(id: string, job: SourceJob | null) {
  useSources.setState((st) => {
    const jobs = { ...st.jobs };
    if (job) jobs[id] = job;
    else delete jobs[id];
    return { jobs };
  });
}

/** Show a source in the Sources tab (and a quote in it). */
export function openSource(id: string, quoteId?: string) {
  useSources.setState({ open: { id, ...(quoteId ? { quoteId } : {}) } });
  studio().setLeftTab("sources");
}
