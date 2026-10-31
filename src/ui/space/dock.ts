import { create } from "zustand";

/*
 * Whether the space's sources dock is open beside its canvas, kept for the tab (./SpaceCanvas.tsx).
 * Small on purpose: a page that links to the canvas with its sources showing (Connections, after
 * an import) sets it without loading the canvas's code.
 */

const KEY = "qalam.space.sources";

export function dockKept(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function keepDock(on: boolean) {
  try {
    sessionStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // Only this tab's view.
  }
}

/** The dock as the canvas draws it (opened from elsewhere on the page too: adding what customers said). */
export const useDock = create<{ open: boolean }>(() => ({ open: typeof window === "undefined" ? false : dockKept() }));

export function showDock(on: boolean) {
  useDock.setState({ open: on });
  keepDock(on);
}
