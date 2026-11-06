import { TERMS_LIMITS, emptyTerms, type Term, type TermBy, type Terms } from "./types";

/*
 * hub/terms.md: the project's words, readable as a glossary (pure). One line per term, its record
 * (who wrote it, when, a hash of its words) in a comment: the words are a person's to edit, the
 * records aren't. A line written with no record, or whose words a person changed, is theirs.
 * Anything under a heading this doesn't know is kept as it is, below the words.
 */

const FILE = "terms/1";
const RECORD = /\s*<!--\s*qalam\s+(\{.*?\})\s*-->\s*$/;
/** A record in a comment: JSON that can't close the comment early. */
const record = (o: Record<string, unknown>) => ` <!-- qalam ${JSON.stringify(o).replace(/--/g, "-\\u002d").replace(/>/g, "\\u003e")} -->`;
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const json = (s: string): Record<string, unknown> => {
  try {
    return rec(JSON.parse(s));
  } catch {
    return {};
  }
};
const one = (s: string) => s.replace(/\s+/g, " ").trim();
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? one(v).slice(0, max) : undefined);

/** A definition reads as a sentence: it ends with a stop, so the words to avoid can follow it. */
export const sentence = (s: string) => {
  const t = one(s).slice(0, TERMS_LIMITS.means);
  return t && !/[.!?…)"”']$/.test(t) ? `${t}.` : t;
};

/** The words to avoid, cleaned: no empties, no repeats, not the term itself. */
export function avoidList(words: readonly string[], term: string): string[] {
  const seen = new Set([one(term).toLowerCase()]);
  const out: string[] = [];
  for (const w of words) {
    const t = one(w).replace(/[.;]+$/, "").slice(0, TERMS_LIMITS.avoidWord);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= TERMS_LIMITS.avoid) break;
  }
  return out;
}

/** A short hash of a term's words: changed words (a person's edit) make the term theirs. */
export function termHash(t: Pick<Term, "term" | "means" | "avoid">): string {
  let h = 0x811c9dc5;
  for (const ch of one([t.term, t.means, t.avoid.join(", ")].join(" | "))) h = Math.imul(h ^ ch.codePointAt(0)!, 0x01000193) >>> 0;
  return h.toString(36);
}

let made = 0;
const freshId = () => `t${Date.now().toString(36)}${(made++).toString(36)}`;

const INTRO = "The project's own words: what each one means, and the words to avoid for it. Qalam AI uses them, and asks when a word is used two ways. Edit the words, not the records.";

function lineMd(t: Term): string {
  const avoid = t.avoid.length ? ` Avoid: ${t.avoid.join(", ")}.` : "";
  return `- **${one(t.term)}**: ${sentence(t.means)}${avoid}${record({ id: t.id, by: t.by, at: t.at, h: termHash(t) })}`;
}

export function termsToMarkdown(t: Terms, o: { org: string }): string {
  const out = [
    "---",
    `qalam: "${FILE}"`,
    `gone: ${JSON.stringify(t.gone)}`,
    "---",
    "",
    `# The words at ${o.org}`,
    "",
    INTRO,
    "",
    "## Words",
    "",
    ...t.terms.map(lineMd),
    "",
  ];
  if (t.notes?.trim()) out.push(t.notes.trim(), "");
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

// A term's line: "- **Basket**: The order before checkout. Avoid: cart." (the bold optional when written by hand).
const LINE = /^\s*[-*]\s+(?:\*\*(.+?)\*\*|__(.+?)__|([^:*_][^:]*?))\s*:\s*(.*)$/;
const AVOID = /\s*_?Avoid_?\s*:\s*(.*?)\.?\s*$/i;

function termOf(raw: string): Term | null {
  const r = RECORD.exec(raw);
  const data = r ? json(r[1]) : {};
  const m = LINE.exec(raw.replace(RECORD, ""));
  if (!m) return null;
  const term = one(m[1] ?? m[2] ?? m[3] ?? "").slice(0, TERMS_LIMITS.term);
  let rest = m[4] ?? "";
  const a = AVOID.exec(rest);
  const avoid = a ? avoidList(a[1].split(","), term) : [];
  if (a) rest = rest.slice(0, a.index);
  const means = sentence(rest);
  if (!term || !means) return null;
  const t = { term, means, avoid };
  const by: TermBy = !r || (typeof data.h === "string" && data.h !== termHash(t)) || data.by === "you" ? "you" : "qalam";
  return { id: str(data.id, 40) ?? freshId(), ...t, by, at: typeof data.at === "number" && Number.isFinite(data.at) ? data.at : 0 };
}

export function termsFromMarkdown(md: string): Terms {
  const t = emptyTerms();
  const front = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  const body = front ? md.slice(front[0].length) : md;
  if (front) {
    const version = /^qalam:\s*"?([^"\n]+)"?\s*$/m.exec(front[1])?.[1]?.trim();
    // A file of a version this doesn't know: nothing is read from it, and nothing is lost.
    if (version && version !== FILE) return { ...t, notes: body.trim() };
    const gone = /^gone:\s*(.*)$/m.exec(front[1])?.[1];
    if (gone) {
      try {
        const list = JSON.parse(gone);
        if (Array.isArray(list)) t.gone = [...new Set(list.filter((x): x is string => typeof x === "string").map((x) => one(x).toLowerCase()).filter(Boolean))].slice(-TERMS_LIMITS.gone);
      } catch {
        // A hand-edit that broke the list: what's gone is forgotten, never the words.
      }
    }
  }
  const notes: string[] = [];
  let section: "words" | "other" | "top" = "top";
  const ids = new Set<string>();
  for (const line of body.split("\n")) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      if (h[1].length === 1 && section === "top") continue; // the title, written again each time
      if (h[1].length === 2) {
        section = /^words$/i.test(one(h[2])) ? "words" : "other";
        if (section === "words") continue;
      }
      notes.push(line);
      continue;
    }
    // The line under the title is written again each time; anything else a person put there stays.
    if (section === "top" && (!line.trim() || one(line) === INTRO)) continue;
    if (section === "words") {
      if (!line.trim()) continue;
      const term = termOf(line);
      if (term && !ids.has(term.id) && !t.terms.some((x) => x.term.toLowerCase() === term.term.toLowerCase())) {
        ids.add(term.id);
        t.terms.push(term);
        continue;
      }
      if (term) continue; // the same term twice: the first stands
    }
    notes.push(line);
  }
  const kept = notes.join("\n").trim();
  return kept ? { ...t, notes: kept } : t;
}
