import { create } from "zustand";
import type { ChatMode } from "@/space/route";
import { toggleChat } from "../../frame/store";

/*
 * What the canvas's chat box holds when something outside it fills it (a brain dump pasted on the
 * canvas, ⌘K's Brain dump, the empty canvas's buttons): its text, what it's for (a mode, shown on
 * the box, that the next message is taken as), and a key that changes so the box takes it. Small
 * on purpose: the canvas's commands and tools import it without the chat.
 */

export interface Compose {
  text: string;
  mode: ChatMode | null;
  key: number;
}

export const useCompose = create<Compose>(() => ({ text: "", mode: null, key: 0 }));

/** Open the chat with its box filled (and what the next message is for). */
export function composeIn(o: { text?: string; mode?: ChatMode | null } = {}) {
  toggleChat(true);
  useCompose.setState((c) => ({ text: o.text ?? "", mode: o.mode ?? null, key: c.key + 1 }));
}

/** The box's mode taken off (sent, or let go). */
export const clearMode = () => useCompose.setState({ mode: null });
