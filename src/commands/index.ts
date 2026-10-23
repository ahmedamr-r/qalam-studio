/**
 * Commands: import from "@/commands" (not ./registry) so the Figma catalogue is registered before
 * anything reads it. UI: `useCommand(id)` for labels/keycaps/state, `runCommand(id, source)` to run.
 */
import "./catalog";
import "./theme";
import "./vector-ops";
import { allCommands, runCommand } from "./registry";
import { lastFeedback } from "./feedback";
import { useSurfaces } from "./surfaces";
import { commandCanvas } from "./canvas";

export * from "./registry";
export { ESSENTIAL } from "./catalog";
export { feedback, onFeedback, type Feedback, type FeedbackKind } from "./feedback";
export { useSurfaces, openPalette, toggleShortcuts, openContextMenu, closeSurfaces } from "./surfaces";

if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __qalamCommands: unknown }).__qalamCommands = { all: allCommands, run: runCommand, lastFeedback, surfaces: useSurfaces, canvas: commandCanvas };
}
