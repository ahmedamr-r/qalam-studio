import { create } from "zustand";
import { projectsDb } from "@/projects/db";
import { migrateInterview, type InterviewState } from "@/projects/interview";
import type { Project } from "@/projects/model";

/**
 * The open interview: the project and its interview state. Every change saves back to the project
 * (half a second after it settles, and at once when the tab is hidden), so the home can show where
 * the interview stopped and resume it later.
 */

export interface Busy {
  label: string;
  started: number;
  tokens: number;
  abort: AbortController;
}

interface InterviewStore {
  project: Project | null;
  state: InterviewState;
  busy: Busy | null;
  error: string | null;
}

export const useInterview = create<InterviewStore>(() => ({ project: null, state: { v: 1, stage: "brief" }, busy: null, error: null }));

export const interview = () => useInterview.getState();

/** Change the interview state (saved shortly after). */
export function update(fn: (s: InterviewState) => InterviewState) {
  const { state } = interview();
  const next = fn(state);
  if (next !== state) useInterview.setState({ state: next, error: null });
}

/** Rename the project (the brand name, once the brief has one). */
export function renameTo(name: string) {
  const p = interview().project;
  const n = name.trim().slice(0, 80);
  if (p && n && n !== p.name) useInterview.setState({ project: { ...p, name: n } });
}

/** Run a call with a cancel handle, a progress label and errors shown in place. */
export async function busy<T>(label: string, fn: (signal: AbortSignal, onProgress: (tokens: number) => void) => Promise<T>): Promise<T | null> {
  interview().busy?.abort.abort();
  const abort = new AbortController();
  useInterview.setState({ busy: { label, started: Date.now(), tokens: 0, abort }, error: null });
  try {
    return await fn(abort.signal, (tokens) => {
      const b = interview().busy;
      if (b?.abort === abort) useInterview.setState({ busy: { ...b, tokens } });
    });
  } catch (e) {
    if (!abort.signal.aborted) useInterview.setState({ error: e instanceof Error ? e.message : String(e) });
    return null;
  } finally {
    if (interview().busy?.abort === abort) useInterview.setState({ busy: null });
  }
}

export function cancelBusy() {
  interview().busy?.abort.abort();
  useInterview.setState({ busy: null });
}

// ---------------------------------------------------------------------------
// Saving

let timer: ReturnType<typeof setTimeout> | undefined;
let pending = false;

async function save() {
  clearTimeout(timer);
  if (!pending) return;
  pending = false;
  const { project, state } = interview();
  if (!project) return;
  const next: Project = { ...project, interview: state, updatedAt: Date.now() };
  useInterview.setState({ project: next });
  await projectsDb.put(next).catch(() => {});
}

/** Save now (before leaving the page). */
export const flushInterview = () => save();

/** Change the project record itself (its system, thumbnail…) and save it with the interview, now. */
export async function saveProject(patch: Partial<Project>) {
  const p = interview().project;
  if (!p) return;
  useInterview.setState({ project: { ...p, ...patch } });
  pending = true;
  await save();
}

let started = false;

/** Open a project's interview and keep it saved. */
export function openInterview(p: Project) {
  useInterview.setState({ project: { ...p, openedAt: Date.now() }, state: migrateInterview(p.interview), busy: null, error: null });
  pending = true;
  void save();
  if (started) return;
  started = true;
  useInterview.subscribe((s, prev) => {
    if (s.state === prev.state && s.project?.name === prev.project?.name) return;
    pending = true;
    clearTimeout(timer);
    timer = setTimeout(() => void save(), 500);
  });
  const onHide = () => {
    if (document.visibilityState === "hidden") void save();
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onHide);
}
