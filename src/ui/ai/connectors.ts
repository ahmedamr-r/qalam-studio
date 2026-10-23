import { useEffect, useState } from "react";
import { create } from "zustand";
import { aiStatus } from "@/ai/client";
import type { ConnectorInfo } from "@/ai/research-shared";

/**
 * Which connectors the designer has switched on in the composer (a per-browser preference).
 * Web search starts on: the research step skips the lookup when a request doesn't need one.
 */

const KEY = "qalam/ai-connectors/v1";
const DEFAULT = ["web"];

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export const useConnectorPrefs = create<{ enabled: string[] }>(() => ({ enabled: typeof window === "undefined" ? DEFAULT : load() }));

export function setConnector(id: string, on: boolean) {
  const cur = useConnectorPrefs.getState().enabled.filter((x) => x !== id);
  const enabled = on ? [...cur, id] : cur;
  useConnectorPrefs.setState({ enabled });
  try {
    localStorage.setItem(KEY, JSON.stringify(enabled));
  } catch {
    /* storage unavailable */
  }
}

let available: ConnectorInfo[] | null = null;

/** Connectors this deployment offers (from /api/status). */
export function useAvailableConnectors(): ConnectorInfo[] {
  const [list, setList] = useState<ConnectorInfo[]>(available ?? []);
  useEffect(() => {
    let live = true;
    void aiStatus().then((s) => {
      available = s.ai ? (s.connectors ?? []) : [];
      if (live) setList(available);
    });
    return () => {
      live = false;
    };
  }, []);
  return list;
}

/** The switched-on connectors that are available, for a request body (undefined when none). */
export async function activeConnectors(): Promise<string[] | undefined> {
  const s = await aiStatus();
  const ids = new Set((s.connectors ?? []).map((c) => c.id));
  const on = useConnectorPrefs.getState().enabled.filter((id) => ids.has(id));
  return on.length ? on : undefined;
}

/** Labels for connector ids, for a request bubble. */
export function connectorLabels(ids: string[] | undefined, list: ConnectorInfo[]): string[] {
  return (ids ?? []).map((id) => list.find((c) => c.id === id)?.label ?? (id === "web" ? "Web search" : id.replace(/^mcp:/, "")));
}
