/*
 * Putting what was said where the cursor is (pure): a space on either side where the words would
 * run together, a lower-case start in the middle of a sentence, line breaks folded for a one-line
 * box, and no more than the box takes.
 */

export interface Inserted {
  value: string;
  /** Where the cursor goes: just after what was said. */
  caret: number;
}

const PUNCT = /^[.,;:!?)\]}”’]/;

export function insertAtCursor(value: string, sel: { start: number; end: number } | null, said: string, o: { oneLine?: boolean; max?: number } = {}): Inserted {
  const start = Math.max(0, Math.min(sel?.start ?? value.length, value.length));
  const end = Math.max(start, Math.min(sel?.end ?? start, value.length));
  const before = value.slice(0, start);
  const after = value.slice(end);
  let text = said.trim();
  if (o.oneLine) text = text.replace(/\s*\n\s*/g, " ");
  if (!text) return { value, caret: start };
  // Mid-sentence, Apple's capital at the start of what was said reads wrong ("the auth to Use…").
  if (/[a-z0-9,;:(]$/.test(before.trimEnd()) && /^[A-Z][a-z]/.test(text) && !/^I\b/.test(text)) text = text[0].toLowerCase() + text.slice(1);
  const lead = before && !/\s$/.test(before) && !PUNCT.test(text) ? " " : "";
  const tail = after && !/^\s/.test(after) && !PUNCT.test(after) ? " " : "";
  if (o.max !== undefined) {
    const room = o.max - before.length - after.length - lead.length - tail.length;
    if (room <= 0) return { value, caret: start };
    text = text.slice(0, room);
  }
  return { value: before + lead + text + tail + after, caret: before.length + lead.length + text.length };
}

/** The selection of a text box, or null when it has none to give. */
export function selectionOf(el: HTMLInputElement | HTMLTextAreaElement | null): { start: number; end: number } | null {
  if (!el || el.selectionStart === null) return null;
  return { start: el.selectionStart, end: el.selectionEnd ?? el.selectionStart };
}
