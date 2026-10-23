import { useEffect } from "react";
import { create } from "zustand";
import { studio, useStudio } from "@/doc/store";
import type { Doc } from "@/doc/schema";
import { isPart } from "@/proto/routes";

/**
 * Prototype mode: open over the studio, playing what was selected when it opened. `version` bumps
 * when the prototype changed underneath it, so it compiles again.
 */
export const usePrototypeMode = create<{ open: boolean; selection: string[]; version: number; propose: string | null }>(() => ({ open: false, selection: [], version: 0, propose: null }));

export const openPrototype = () => usePrototypeMode.setState((s) => ({ open: true, selection: s.open ? s.selection : [...studio().selection], version: s.version + 1 }));
export const closePrototype = () => usePrototypeMode.setState({ open: false });

/** A screen Present can start on: a top-level frame that isn't a group, a board card or one of a screen's parts. */
export const playableScreen = (doc: Doc, id: string): boolean => {
  const n = doc.nodes[id];
  return !!n && n.type === "frame" && !n.parentId && !n.meta.group && !n.meta.ost && !n.meta.note && !isPart(doc, id);
};

/** Play one screen: select it and open Prototype mode on it. */
export function playScreen(id: string) {
  studio().select([id]);
  openPrototype();
}

/** Play one screen with Qalam AI proposing what to build there (with what the brief left for it). */
export function proposeOn(id: string) {
  playScreen(id);
  usePrototypeMode.setState({ propose: id });
}

/** The address names the screen being played (?play=<id>), so the link opens it again. */
export function setPlayParam(id: string | null) {
  const params = new URLSearchParams(location.search);
  if ((params.get("play") ?? null) === id) return;
  if (id) params.set("play", id);
  else params.delete("play");
  history.replaceState(history.state, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`);
}

/** Opened from a link with ?play=<id>: once that screen is in the document, play it. */
export function usePlayParam() {
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("play");
    if (!id) return;
    const tryOpen = () => {
      if (!playableScreen(studio().doc, id)) return false;
      playScreen(id);
      return true;
    };
    if (tryOpen()) return;
    const stop = useStudio.subscribe(() => {
      if (tryOpen()) stop();
    });
    // A screen that never turns up (deleted since): the link just opens the project.
    const t = setTimeout(() => {
      stop();
      setPlayParam(null);
    }, 20000);
    return () => {
      stop();
      clearTimeout(t);
    };
  }, []);
}
