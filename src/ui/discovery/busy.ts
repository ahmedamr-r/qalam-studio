import { create } from "zustand";
import type { StepId } from "@/discovery/next";

/*
 * What Qalam AI is doing for a card on the canvas, however it was started (the card's next steps,
 * ⌘K, an address asking for a draft): one thing at a time, with what it's on now and Stop. The
 * card's next steps show it; the rest of the canvas only sees that something's running.
 */

export interface Busy {
  card: string;
  step: StepId;
  label: string;
  started: number;
  ctrl: AbortController;
}

/** What a step came to, when it isn't drawn on the canvas (links made, numbers others report). */
export interface Done {
  card: string;
  text: string;
  /** What others report, as found on their pages. */
  claims?: { value: string; what: string; who: string; url: string }[];
}

export const useBusy = create<{ busy: Busy | null; done: Done | null }>(() => ({ busy: null, done: null }));

/** Start a step for a card: null when Qalam AI is already on something. */
export function begin(card: string, step: StepId, label: string): AbortController | null {
  if (useBusy.getState().busy) return null;
  const ctrl = new AbortController();
  useBusy.setState({ busy: { card, step, label, started: Date.now(), ctrl }, done: null });
  return ctrl;
}

/** What it's doing now. */
export function relabel(ctrl: AbortController, label: string) {
  useBusy.setState((s) => (s.busy?.ctrl === ctrl ? { busy: { ...s.busy, label } } : {}));
}

/** It's over, with what it came to when that's for the card's next steps to say. */
export function end(ctrl: AbortController, done?: Done) {
  useBusy.setState((s) => (s.busy?.ctrl === ctrl ? { busy: null, ...(done ? { done } : {}) } : {}));
}

export const stopBusy = () => useBusy.getState().busy?.ctrl.abort();

/** A call ended by Stop. */
export const stopped = (e: unknown) => (e as { name?: string } | null)?.name === "AbortError";
