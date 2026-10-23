import { create } from "zustand";
import { getCommand, onCommandRun } from "@/commands";

/*
 * Recently run actions for the palette's "Recent" group: commands run from the palette, menus and
 * the context menu (keyboard runs are habits, not things to find again), newest first, persisted.
 * Palette-only rows (Qalam AI actions, layers) are recorded by their own ids with recordRecent.
 */

const KEY = "qalam/recent-actions";
const MAX = 6;

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export const useRecent = create<{ ids: string[] }>(() => ({ ids: typeof window === "undefined" ? [] : load() }));

export function recordRecent(id: string) {
  const ids = [id, ...useRecent.getState().ids.filter((x) => x !== id)].slice(0, MAX);
  useRecent.setState({ ids });
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable: recents last for this session */
  }
}

if (typeof window !== "undefined") {
  onCommandRun((id, source) => {
    if (source === "keyboard" || source === "toolbar") return;
    const c = getCommand(id);
    if (!c || c.hidden || c.gesture || c.category === "essential") return;
    recordRecent(id);
  });
}
