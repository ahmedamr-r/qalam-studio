import { create } from "zustand";
import { toggleSidebar } from "@/ui/frame/store";
import { commandState, commandsFor, kb, registerCommands, runCommand, type Command } from "./registry";
import "./theme";
import "@/ui/voice/commands";

/*
 * The keys of the pages outside the canvas (home, places, topic pages, setup). Studio has the whole
 * Figma catalogue; a page has only these, so they're "global": they run from a field too, since a
 * page has no canvas to focus. Imported by the frame (src/ui/frame/FrameServices.tsx), never by Studio.
 */

/** ⌘K on a page: search the places, boards and topic pages, or ask Qalam AI. */
export const usePagePalette = create<{ open: boolean }>(() => ({ open: false }));

export const PAGE_COMMANDS: Command[] = [
  {
    id: "page.palette",
    label: "Search and go to…",
    category: "essential",
    keys: [kb("⌘K")],
    context: "global",
    run: () => usePagePalette.setState((s) => ({ open: !s.open })),
    keywords: ["find", "jump", "go to", "ask"],
  },
  {
    id: "frame.sidebar",
    label: "Fold the sidebar",
    category: "view",
    keys: [kb("⌘\\")],
    context: "global",
    run: toggleSidebar,
    keywords: ["sidebar", "rail", "collapse", "expand"],
  },
];

registerCommands(PAGE_COMMANDS);

/**
 * A keydown on a page: the first enabled page command bound to it runs, and the browser's own use
 * of the key is kept from it. Other keys (⌘R, ⌘F, typing) stay the browser's.
 */
export function dispatchPageKey(e: KeyboardEvent): boolean {
  const hits = commandsFor(e, "field");
  const cmd = hits.find((c) => commandState(c) === true);
  if (!cmd) return false;
  e.preventDefault();
  if (e.repeat && !cmd.repeat) return true;
  return runCommand(cmd.id, "keyboard", e);
}
