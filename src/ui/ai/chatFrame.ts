import { create } from "zustand";

/**
 * How much of the canvas's bottom edge the floating chat window (and the tool bar under it)
 * covers, in CSS px, so cards, the agent cursor and camera moves keep clear of it.
 */

/** The floating tool bar sits this far above the canvas's bottom edge (recipe `toolbar`: bottom-[16px]). */
export const TOOLBAR_GAP = 16;

/** The tool bar's height, read from the shell's `--toolbar-h` (44px unless the theme changes it). */
export function toolbarHeight(): number {
  if (typeof document === "undefined") return 44;
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--toolbar-h"));
  return Number.isFinite(v) && v > 0 ? v : 44;
}

/** What the tool bar alone covers: its height, its gap to the edge, and a little air above it. */
export const toolbarInset = () => toolbarHeight() + TOOLBAR_GAP + 8;

/** Where the chat window's bottom edge sits above the canvas's: just over the tool bar. */
export const chatWindowBottom = () => toolbarHeight() + TOOLBAR_GAP + 12;

export const useChatFrame = create<{ bottom: number }>(() => ({ bottom: toolbarInset() }));

export const chatBottomInset = () => useChatFrame.getState().bottom;
