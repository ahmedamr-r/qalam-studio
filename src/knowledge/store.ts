import { create } from "zustand";
import { nanoid } from "nanoid";
import { clearKnowledgeData, tracesDb } from "./db";
import type { DecisionTrace } from "./types";

/**
 * The open project's decision traces: what each AI request was given and what it relied on.
 * Loaded when a project opens; every write goes straight to IndexedDB.
 */

interface KnowledgeState {
  projectId: string | null;
  traces: DecisionTrace[];
  loaded: boolean;
}

export const useKnowledge = create<KnowledgeState>(() => ({ projectId: null, traces: [], loaded: false }));

const MAX_TRACES = 500;
const get = () => useKnowledge.getState();

/** Load a project's traces (called when the project opens). */
export function setKnowledgeScope(projectId: string | null) {
  useKnowledge.setState({ projectId, traces: [], loaded: !projectId });
  if (!projectId || typeof indexedDB === "undefined") return;
  tracesDb
    .list(projectId)
    .then((list) => {
      if (get().projectId !== projectId) return;
      useKnowledge.setState({ traces: list.sort((a, b) => a.at - b.at), loaded: true });
    })
    .catch(() => useKnowledge.setState({ loaded: true }));
}

const save = (t: DecisionTrace) => {
  if (typeof indexedDB === "undefined" || !t.projectId) return;
  tracesDb.put(t).catch(() => {});
};

export type NewTrace = Omit<DecisionTrace, "v" | "id" | "projectId" | "updatedAt"> & { id?: string };

/** Record a decision; returns its id. Old traces past the limit are dropped. */
export function recordDecision(t: NewTrace): string {
  const projectId = get().projectId ?? "";
  const trace: DecisionTrace = { ...t, v: 1, id: t.id ?? nanoid(10), projectId, updatedAt: Date.now() };
  const list = [...get().traces.filter((x) => x.id !== trace.id), trace].sort((a, b) => a.at - b.at);
  const drop = list.length > MAX_TRACES ? list.slice(0, list.length - MAX_TRACES) : [];
  useKnowledge.setState({ traces: list.slice(drop.length) });
  save(trace);
  for (const d of drop) if (projectId) tracesDb.remove(projectId, d.id).catch(() => {});
  return trace.id;
}

/** Change a recorded decision (a critique that went on, a Tune that was applied or undone). */
export function updateDecision(id: string, patch: Partial<DecisionTrace> | ((t: DecisionTrace) => Partial<DecisionTrace>)) {
  const cur = get().traces.find((t) => t.id === id);
  if (!cur) return;
  const next: DecisionTrace = { ...cur, ...(typeof patch === "function" ? patch(cur) : patch), updatedAt: Date.now() };
  useKnowledge.setState({ traces: get().traces.map((t) => (t.id === id ? next : t)) });
  save(next);
}

export const traceById = (id: string) => get().traces.find((t) => t.id === id) ?? null;

/** The latest decision recorded for a chat turn. */
export function traceByTurn(turnId: string): DecisionTrace | null {
  let hit: DecisionTrace | null = null;
  for (const t of get().traces) if (t.turnId === turnId && (!hit || t.at >= hit.at)) hit = t;
  return hit;
}

/** The latest decision that made or changed a screen. */
export function decisionByFrame(frameId: string): DecisionTrace | null {
  let hit: DecisionTrace | null = null;
  for (const t of get().traces) if (t.produced.frames?.includes(frameId) && (!hit || t.at >= hit.at)) hit = t;
  return hit;
}

export { clearKnowledgeData };
