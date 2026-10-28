import { useEffect } from "react";
import { create } from "zustand";
import { worstDot, type HealthRow } from "@/health/doctor";
import { healthDb } from "@/org/engine";
import { onOrgChange } from "@/org/live";
import { useCurrentOrg } from "./store";

/*
 * This Mac's health, shared by the sidebar's dot on Connections, the home's one-line notice and
 * the Connections page: asked once a page, and again when the engine changes or after a fix.
 */

const useHealthState = create<{ rows: HealthRow[] | null; loading: boolean }>(() => ({ rows: null, loading: false }));

let org: string | null = null;
let started = false;

export async function refreshHealth() {
  useHealthState.setState({ loading: true });
  try {
    useHealthState.setState({ rows: (await healthDb.now(org)).rows });
  } catch {
    // The core isn't answering: say nothing rather than something wrong.
  } finally {
    useHealthState.setState({ loading: false });
  }
}

export async function fixHealth(id: string) {
  useHealthState.setState({ loading: true });
  try {
    useHealthState.setState({ rows: (await healthDb.fix(id, org)).rows });
  } finally {
    useHealthState.setState({ loading: false });
  }
}

/** The rows (null until asked), and whether it's asking. */
export function useHealth() {
  const current = useCurrentOrg();
  useEffect(() => {
    if (!current || (started && org === current.id)) return;
    org = current.id;
    void refreshHealth();
    if (started) return;
    started = true;
    onOrgChange((c) => (c.kind === "engine" || c.kind === "inbox") && void refreshHealth());
  }, [current]);
  return useHealthState();
}

/** The sidebar's dot: the worst row's, or none when all is good. */
export const useHealthDot = () => {
  const { rows } = useHealth();
  return rows ? worstDot(rows) : null;
};
