import { create } from "zustand";
import { pendingLines, type SetupSession } from "@/org/setup";
import { placeKey } from "./places";

/*
 * The setup page's panels around its canvas (the layout is pure, the state a small store): Qalam AI's
 * chat docks left, and what a node opens (a source's reader, a place's lines, a goal) docks right,
 * up to two side by side, the oldest closing when a third opens. A panel docks only while the canvas
 * keeps room to be read; otherwise it's a drawer over the canvas (the newest one). Nothing here is
 * in the address: panels are views of what's kept, and Back steps the conversation, not them.
 */

/** What a right panel shows: a node on the canvas (its id there). */
export type DockItem = { kind: "source" | "place" | "goal"; id: string };

export const CHAT_W = 400;
/** The canvas never gets narrower than this while panels dock beside it. */
export const MIN_CANVAS = 360;
/** Between panels, and around them (the backdrop's padding). */
export const GAP = 8;
export const MAX_RIGHT = 2;
/** Wide enough that the chat starts open. */
export const CHAT_OPEN_AT = 1024;

export interface DockLayout {
  chat: "dock" | "drawer" | "closed";
  /** The right panels docked, in the order they were opened. */
  docked: string[];
  /** The one right panel drawn over the canvas when none fits beside it. */
  drawer: string | null;
}

/**
 * Where each panel goes at this width: the chat docks while the canvas keeps MIN_CANVAS, else it's a
 * drawer; the right panels fit newest first under the same rule; when none fits, the newest is a drawer.
 */
export function dockLayout(width: number, chatOpen: boolean, right: readonly { id: string; w: number }[]): DockLayout {
  let room = width - GAP * 2 - MIN_CANVAS;
  const chat = !chatOpen ? "closed" : room - CHAT_W - GAP >= 0 ? "dock" : "drawer";
  if (chat === "dock") room -= CHAT_W + GAP;
  const docked: string[] = [];
  for (const p of [...right].reverse()) {
    if (docked.length >= MAX_RIGHT || room - p.w - GAP < 0) break;
    docked.unshift(p.id);
    room -= p.w + GAP;
  }
  return { chat, docked, drawer: !docked.length && right.length ? right[right.length - 1].id : null };
}

/** The panels open now with a new one: one open already stays as it is, a third drops the oldest. */
export function withItem(right: readonly DockItem[], item: DockItem): DockItem[] {
  if (right.some((x) => x.id === item.id)) return [...right];
  return [...right, item].slice(-MAX_RIGHT);
}

/** What to look at next in a review: the first line still to settle, as the node it's on (a place's, or the goal's own). */
export function nextToReview(s: SetupSession | null | undefined): DockItem | null {
  const line = s?.proposal ? pendingLines(s)[0] : undefined;
  if (!line || !s) return null;
  return line.field === "goals" ? { kind: "goal", id: `line:${line.id}` } : { kind: "place", id: `place:${placeKey(line.to, s)}` };
}

interface DockState {
  /** null: not chosen yet (open on a wide page). */
  chat: boolean | null;
  right: DockItem[];
  /** A node to bring into view (`n` changes each time, so the same one can be asked twice). */
  focus: { id: string; n: number } | null;
}

export const useDock = create<DockState>(() => ({ chat: null, right: [], focus: null }));

export const openChat = (chat: boolean) => useDock.setState({ chat });
export const openRight = (item: DockItem) => useDock.setState((s) => ({ right: withItem(s.right, item) }));
export const closeRight = (id: string) => useDock.setState((s) => ({ right: s.right.filter((x) => x.id !== id) }));
export const focusNode = (id: string) => useDock.setState((s) => ({ focus: { id, n: (s.focus?.n ?? 0) + 1 } }));

/** Open what's next to review, and bring it into view. */
export function reviewNext(s: SetupSession | null | undefined) {
  const item = nextToReview(s);
  if (!item) return;
  openRight(item);
  focusNode(item.id);
}
