import type { Term, Terms } from "./types";

/*
 * The project's words as a call hears them (pure): each term with what it is and the words to avoid,
 * the ones the call's own material uses first when there are many.
 */

const one = (s: string) => s.replace(/\s+/g, " ").trim();

const line = (t: Term) => `- ${one(t.term)}: ${one(t.means)}${t.avoid.length ? ` Avoid: ${t.avoid.join(", ")}.` : ""}`;

const used = (t: Term, near: string) => {
  const hay = near.toLowerCase();
  return [t.term, ...t.avoid].some((w) => w.trim() && hay.includes(w.trim().toLowerCase()));
};

/** "" when the project has no words of its own yet. */
export function termsText(t: Terms | null | undefined, o: { max?: number; near?: string } = {}): string {
  if (!t?.terms.length) return "";
  const max = o.max ?? 1200;
  const order = o.near ? [...t.terms.filter((x) => used(x, o.near!)), ...t.terms.filter((x) => !used(x, o.near!))] : t.terms;
  const head = "The project's own words (use them as they're meant; someone writing a word to avoid probably means its term):";
  const lines: string[] = [];
  let size = head.length;
  for (const x of order) {
    const l = line(x);
    if (size + l.length + 1 > max) break;
    lines.push(l);
    size += l.length + 1;
  }
  return lines.length ? [head, ...lines].join("\n") : "";
}
