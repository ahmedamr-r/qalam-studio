/**
 * Feedback for actions that change nothing visible ("Copied as PNG", "Rulers on", "Saved
 * automatically"). The toast/HUD UI subscribes with `onFeedback`; anything may call `feedback`.
 */

export type FeedbackKind = "info" | "success" | "error";

export interface Feedback {
  message: string;
  kind: FeedbackKind;
  /** Messages with the same id replace each other instead of stacking (e.g. "Opacity 40%" → "45%"). */
  id: string;
}

const listeners = new Set<(f: Feedback) => void>();
let last: Feedback | null = null;

export function feedback(message: string, opts?: { kind?: FeedbackKind; id?: string }): void {
  const f: Feedback = { message, kind: opts?.kind ?? "info", id: opts?.id ?? message };
  last = f;
  listeners.forEach((fn) => fn(f));
}

export function onFeedback(fn: (f: Feedback) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** The most recent message (tests and dev tools). */
export const lastFeedback = () => last;
