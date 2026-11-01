/*
 * What the first run hands the canvas's chat as it finishes (a full page load away): kept for this
 * tab only, never in the address, and taken once. "Help me find one" needs nothing but the address
 * (`?find=goal|problem`); their own words, taken as a goal or a problem, come this way (`?take=`).
 */

const KEY = "qalam/first-run/words";

export function handWords(text: string) {
  try {
    sessionStorage.setItem(KEY, text);
  } catch {
    /* storage unavailable: the chat opens empty */
  }
}

/** Their words, once (null: none were handed over). */
export function takeWords(): string | null {
  try {
    const text = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return text;
  } catch {
    return null;
  }
}
