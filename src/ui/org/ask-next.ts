import { hereHref } from "../frame/useSpace";

/*
 * A question for Ask the org from anywhere (⌘K on any page): handed to the home's Ask bar at once
 * when the home is showing, else kept for this tab until the home of the space it's in opens and
 * takes it.
 */

const KEY = "qalam/ask-next";
export const ASK_EVENT = "qalam:ask";

export function askNext(question: string) {
  if (document.querySelector("[data-ask-bar]")) {
    window.dispatchEvent(new CustomEvent<string>(ASK_EVENT, { detail: question }));
    return;
  }
  try {
    window.sessionStorage.setItem(KEY, question);
  } catch {
    /* no storage: the home opens without it */
  }
  window.location.assign(hereHref("home"));
}

/** The question waiting for the Ask bar, once (null when there's none). */
export function takeAskNext(): string | null {
  try {
    const q = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    return q;
  } catch {
    return null;
  }
}
