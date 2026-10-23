import { kb } from "@/commands/registry";

/**
 * Keys the chat handles itself while it has focus. They are registered so the shortcuts panel lists
 * them and every keycap in the chat reads the registry, but as gestures: the canvas dispatcher never
 * runs them (Esc on the canvas still deselects). The chat runs app-wide commands (⌘K, ⌘S…) before
 * its own keys, so none of these may be bound to a global command (chatKeys.test.ts).
 */
export const CHAT_KEYS = { stop: kb("Esc"), minimize: kb("Esc"), newLine: kb("⇧↵"), send: kb("↵"), sendCode: kb("⌘↵") } as const;
