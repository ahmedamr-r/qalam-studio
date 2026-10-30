import { normalizeForMatch } from "@/discovery/quotes";
import { checkWords } from "@/hub/topics";
import type { SeenLine, SeenText } from "./types";

/*
 * Whether words are on a screen (pure): found in what this Mac read off its screenshot, word for
 * word as matching forgives (case, curly quotes, spacing, Arabic spelt either way), as whole words,
 * so "Pay" isn't found in "Payment". What's kept is the screen's own words, never the model's.
 */

/** A screenshot's words as one text: its lines in reading order. */
export const textOf = (t: SeenText | undefined) => (t ? t.lines.map((l) => l.text).join("\n") : "");

const WORDY = /[\p{L}\p{N}]/u;

/** Where `words` are in `hay` as whole words: [start, end) of the original text, or null. */
function wholeIn(hay: string, words: string): [number, number] | null {
  const h = normalizeForMatch(hay);
  const needle = normalizeForMatch(words.trim().replace(/^["'“”‘’«»]+|["'“”‘’«»]+$/g, "")).norm;
  if (!needle) return null;
  for (let at = h.norm.indexOf(needle); at >= 0; at = h.norm.indexOf(needle, at + 1)) {
    const before = at > 0 ? h.norm[at - 1] : "";
    const after = h.norm[at + needle.length] ?? "";
    if ((before && WORDY.test(before) && WORDY.test(needle[0])) || (after && WORDY.test(after) && WORDY.test(needle[needle.length - 1]))) continue;
    const start = h.map[at];
    const last = h.map[at + needle.length - 1];
    return [start, last + String.fromCodePoint(hay.codePointAt(last)!).length];
  }
  return null;
}

/** The screen's own words for `words` when they're on it (one line, or running on to the next), else null. */
export function onScreen(words: unknown, t: SeenText | undefined, max = 120): string | null {
  if (typeof words !== "string" || !t || !words.trim() || words.length > max) return null;
  for (const l of t.lines) {
    const at = wholeIn(l.text, words);
    if (at) return l.text.slice(at[0], at[1]);
  }
  // A label wrapped over two lines.
  const joined = t.lines.map((l) => l.text).join(" ");
  const at = wholeIn(joined, words);
  return at ? joined.slice(at[0], at[1]) : null;
}

/** Where on the screenshot `words` are (0..1, from the top left): the part of the line they're in, or null. */
export function boxOf(words: string, t: SeenText | undefined): [number, number, number, number] | null {
  if (!t) return null;
  const hit = (l: SeenLine) => {
    const at = wholeIn(l.text, words);
    if (!at) return null;
    const [x, y, w, h] = l.box;
    const n = Math.max(1, l.text.length);
    // Lines are read left to right or right to left; the share of the line is close either way.
    const rtl = /[֐-ࣿ]/.test(l.text);
    const a = (rtl ? n - at[1] : at[0]) / n;
    const b = (rtl ? n - at[0] : at[1]) / n;
    return [x + w * a, y, Math.max(w * (b - a), 0.02), h] as [number, number, number, number];
  };
  for (const l of t.lines) {
    const box = hit(l);
    if (box) return box;
  }
  return null;
}

const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const PHONE = /(?:\+|\b00)\d[\d\s().-]{7,}\d|\b\d{3}[\s.-]\d{3}[\s.-]\d{4}\b/;

/** Whether a line carries someone's email address or phone number: notes keep neither. */
export const personal = (s: string) => EMAIL.test(s) || PHONE.test(s);

/**
 * A line of notes as code keeps it: its quoted words and numbers on the screens it's about (or in
 * the person's answers), no email address or phone number, within `max`. Else null.
 */
export function noteLine(raw: unknown, texts: (SeenText | undefined)[], also = "", max = 400): string | null {
  const line = checkWords(raw, texts.map((t) => ({ text: textOf(t) })), also, max);
  return line && !personal(line) ? line : null;
}
