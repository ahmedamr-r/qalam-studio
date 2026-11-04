import { create } from "zustand";

/*
 * Whether the canvas's walkthrough is showing (./Tour.tsx), and whether this computer has been
 * through it. Apart from the walkthrough itself, so ⌘K can ask for it without loading the canvas.
 */

const SEEN = "qalam.tour.canvas";

export const useTour = create<{ open: boolean }>(() => ({ open: false }));

export function tourSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN) !== null;
  } catch {
    // No storage, no way to remember it: better not to show it on every canvas.
    return true;
  }
}

export const startTour = () => useTour.setState({ open: true });

export function endTour() {
  useTour.setState({ open: false });
  try {
    window.localStorage.setItem(SEEN, String(Date.now()));
  } catch {
    // Not remembered: tourSeen says the same.
  }
}
