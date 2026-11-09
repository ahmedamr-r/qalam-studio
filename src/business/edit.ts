import { sameTopic } from "@/hub/topics";
import { HAND_TEXT } from "./business-md";
import { BUSINESS_LIMITS, isSection, linesIn, type Business, type BusinessFrom, type BusinessLine, type BusinessSection } from "./types";

/*
 * A change to how the business works (pure). A person adds, fixes, keeps or takes off a line; Qalam AI
 * notes one from someone's answer as they talk (`noteLines`). A line taken off is never noted again
 * until a person adds it back, and a person's line is never rewritten.
 */

export type BusinessEdit =
  | { op: "add"; section: BusinessSection; text: string }
  | { op: "fix"; id: string; text?: string; section?: BusinessSection }
  | { op: "remove"; id: string }
  /** A reading of Qalam AI's they agree with: theirs from now on. */
  | { op: "keep"; id: string };

const one = (s: string) => s.replace(/\s+/g, " ").trim();
const key = (s: string) => one(s).toLowerCase();
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);

/** An edit as a request sends it, checked (null: not one). */
export function businessEditOf(raw: unknown): BusinessEdit | null {
  const b = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const id = text(b.id, 40)?.trim() ?? "";
  if (b.op === "remove") return id ? { op: "remove", id } : null;
  if (b.op === "keep") return id ? { op: "keep", id } : null;
  const words = text(b.text, 2000);
  if (b.op === "fix") {
    const section = isSection(b.section) ? b.section : undefined;
    return id && (words?.trim() || section) ? { op: "fix", id, ...(words?.trim() ? { text: words } : {}), ...(section ? { section } : {}) } : null;
  }
  if (b.op === "add") return isSection(b.section) && words?.trim() ? { op: "add", section: b.section, text: words } : null;
  return null;
}

/** A line as short as a line runs, cut at a word. */
export function lineText(s: string, max: number = BUSINESS_LIMITS.text): string {
  const t = one(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.]+$/, "")}…`;
}

const sameWords = (a: string, b: string) => key(a) === key(b);

export function editBusiness(b: Business, e: BusinessEdit, o: { now: number; id: () => string }): Business {
  if (e.op === "remove") {
    const gone = b.lines.find((x) => x.id === e.id);
    if (!gone) return b;
    return { ...b, lines: b.lines.filter((x) => x.id !== e.id), gone: [...b.gone.filter((g) => g !== key(gone.text)), key(gone.text)].slice(-BUSINESS_LIMITS.gone) };
  }
  if (e.op === "keep") {
    const was = b.lines.find((x) => x.id === e.id);
    if (!was || was.by !== "qalam") return b;
    return { ...b, lines: b.lines.map((x) => (x.id === was.id ? { ...x, by: "you", at: o.now } : x)) };
  }
  if (e.op === "fix") {
    const was = b.lines.find((x) => x.id === e.id);
    if (!was) return b;
    const words = e.text !== undefined ? lineText(e.text, HAND_TEXT) : was.text;
    const section = e.section ?? was.section;
    if (!words) return b;
    // A fix that makes it another line's words in the same section would leave two: the fix is refused.
    if (b.lines.some((x) => x.id !== was.id && x.section === section && sameWords(x.text, words))) return b;
    const next: BusinessLine = { ...was, section, text: words, by: "you", at: o.now };
    return { ...b, lines: b.lines.map((x) => (x.id === was.id ? next : x)), gone: b.gone.filter((g) => g !== key(words)) };
  }
  const words = lineText(e.text, HAND_TEXT);
  if (!words) return b;
  if (b.lines.some((x) => x.section === e.section && sameWords(x.text, words))) return b;
  const added: BusinessLine = { id: o.id(), section: e.section, text: words, by: "you", at: o.now };
  return { ...b, lines: [...b.lines, added], gone: b.gone.filter((g) => g !== key(words)) };
}

/** A line Qalam AI would note: their words from an answer (`said`) or its reading of them (`qalam`), with the answers it came from. */
export interface BusinessNote {
  section: BusinessSection;
  text: string;
  by: "said" | "qalam";
  from: BusinessFrom[];
}

/**
 * What a conversation noted, put on the page: never a line taken off, never the same thing twice,
 * never over a person's line. Their own words take the place of Qalam AI's reading of the same thing.
 * A section that's full takes no more.
 */
export function noteLines(b: Business, notes: readonly BusinessNote[], o: { now: number; id: () => string }): { business: Business; added: BusinessLine[] } {
  let lines = [...b.lines];
  const added: BusinessLine[] = [];
  for (const n of notes) {
    const words = lineText(n.text);
    if (!words || b.gone.includes(key(words))) continue;
    const near = lines.find((x) => x.section === n.section && (sameWords(x.text, words) || sameTopic(x.text, words)));
    if (near) {
      // Their words for what Qalam AI only read from them: theirs now, in the same place.
      if (near.by === "qalam" && n.by === "said") {
        const next: BusinessLine = { ...near, text: words, by: "said", from: n.from.slice(0, BUSINESS_LIMITS.from), at: o.now };
        lines = lines.map((x) => (x.id === near.id ? next : x));
        added.push(next);
      }
      continue;
    }
    if (linesIn({ ...b, lines }, n.section).length >= BUSINESS_LIMITS.perSection) continue;
    const line: BusinessLine = { id: o.id(), section: n.section, text: words, by: n.by, from: n.from.slice(0, BUSINESS_LIMITS.from), at: o.now };
    lines.push(line);
    added.push(line);
  }
  return { business: added.length ? { ...b, lines } : b, added };
}
