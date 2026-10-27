import { useEffect, useState } from "react";
import type { Decision } from "@/decisions/model";
import { orgFetch, orgJson } from "@/org/client";
import { onOrgChange } from "@/org/live";

/**
 * The decision log as pages show it: all of it (the home), or a card's (its History), kept
 * current with this window's own writes and with other windows' and the folder's.
 */

const listeners = new Set<() => void>();

/** This window wrote to the log (the server announces only other windows' changes). */
export function decisionsChanged() {
  for (const fn of listeners) fn();
}

export interface DecisionQuery {
  board?: string;
  card?: string;
  limit?: number;
}

/** Decisions, newest first (null while loading, or with no query). */
export function useDecisions(q: DecisionQuery | null): Decision[] | null {
  const key = q ? JSON.stringify(q) : "";
  const [state, setState] = useState<{ key: string; list: Decision[] } | null>(null);
  useEffect(() => {
    if (!key) return;
    const query = JSON.parse(key) as DecisionQuery;
    let alive = true;
    const params = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
    const load = () =>
      void orgJson<Decision[]>(`/decisions?${params}`).then(
        (list) => alive && setState({ key, list }),
        () => alive && setState({ key, list: [] }),
      );
    load();
    listeners.add(load);
    const off = onOrgChange((c) => {
      if (c.kind === "decision" && (!query.board || c.boards.includes(query.board))) load();
    });
    return () => {
      alive = false;
      listeners.delete(load);
      off();
    };
  }, [key]);
  return state?.key === key ? state.list : null;
}

/** Write, correct or clear a decision's why. */
export async function saveWhy(id: string, why: string) {
  await orgFetch(`/decisions/${id}`, { method: "PATCH", json: { why: why.trim() || null } });
  decisionsChanged();
}
