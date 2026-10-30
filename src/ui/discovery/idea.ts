/*
 * An idea handed from the first run to its new board (the idea door): kept for this tab only, never
 * in the address, and taken once. The board reads it as a brain dump: its questions first, then the
 * idea as a solution under the problems it would solve.
 */

const KEY = "qalam/idea";

export function handIdea(text: string) {
  try {
    sessionStorage.setItem(KEY, text);
  } catch {
    /* storage unavailable: the board opens without it */
  }
}

/** The idea, once (null: none was handed over). */
export function takeIdea(): string | null {
  try {
    const text = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return text;
  } catch {
    return null;
  }
}

/** A board's name from the idea: its first sentence, shortened at a word. */
export function ideaBoardName(text: string): string {
  const first = text.trim().split(/(?<=[.!?])\s|\n/)[0].replace(/\s+/g, " ").trim();
  if (first.length <= 60) return first || "An idea";
  const cut = first.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 30 ? cut.lastIndexOf(" ") : 60)}…`;
}
