import { toggleChat } from "../frame/store";
import { hereHref } from "../frame/useSpace";
import { navigate } from "../nav";

/*
 * A question for the organization from anywhere (⌘K on any page): handed to Qalam AI's chat beside
 * the canvas at once when it's showing, else kept for this tab until the canvas of the space it's
 * in opens and its chat takes it.
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
    /* no storage: the canvas opens without it */
  }
  // Folded, the chat opens to take it.
  toggleChat(true);
  navigate(hereHref("home"));
}

/** The question waiting for the chat, once (null when there's none). */
export function takeAskNext(): string | null {
  try {
    const q = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    return q;
  } catch {
    return null;
  }
}
