import { BUSINESS_LIMITS, BUSINESS_SECTIONS, SECTION_LABEL, emptyBusiness, type Business, type BusinessBy, type BusinessFrom, type BusinessLine, type BusinessSection } from "./types";

/*
 * business.md: how the business works, readable as a page (pure). Its seven sections, each line with
 * its record (whose words, which answer it came from, when, a hash of its words) in a comment: the
 * words are a person's to edit, the records aren't. A line written with no record, or whose words a
 * person changed, is theirs. Anything under a heading this doesn't know is kept as it is, above the sections.
 */

const FILE = "business/1";
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

/** The longest a line a person wrote by hand is kept: theirs, so it's cut only where it's a page, not a line. */
export const HAND_TEXT = 1000;

/** A short hash of a line's words: changed words (a person's edit) make the line theirs. */
export function lineHash(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of one(text)) h = Math.imul(h ^ ch.codePointAt(0)!, 0x01000193) >>> 0;
  return h.toString(36);
}

let made = 0;
const freshId = () => `b${Date.now().toString(36)}${(made++).toString(36)}`;

const INTRO = "How the business works, as the team tells it. Qalam AI notes what someone says while working something out, and marks a reading of its own as its own. Edit the words, not the records.";

const fromOf = (v: unknown): BusinessFrom[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = v.flatMap((x) => {
    const r = rec(x);
    const flow = str(r.flow, 24);
    const key = str(r.key, 80);
    const q = str(r.q, 40);
    return flow && key && q ? [{ flow, key, q }] : [];
  });
  return out.length ? out.slice(0, BUSINESS_LIMITS.from) : undefined;
};

function lineMd(l: BusinessLine): string {
  return `- ${one(l.text)}${record({ id: l.id, by: l.by, ...(l.from?.length ? { from: l.from } : {}), at: l.at, h: lineHash(l.text) })}`;
}

export function businessToMarkdown(b: Business, o: { org: string }): string {
  const out = ["---", `qalam: "${FILE}"`, `gone: ${JSON.stringify(b.gone)}`, "---", "", `# How ${one(o.org) || "the business"} works`, "", INTRO, ""];
  // A person's own notes go above the sections: anything after a section's heading is that section's lines.
  if (b.notes?.trim()) out.push(b.notes.trim(), "");
  for (const s of BUSINESS_SECTIONS) {
    out.push(`## ${SECTION_LABEL[s]}`, "");
    const lines = b.lines.filter((l) => l.section === s);
    if (lines.length) out.push(...lines.map(lineMd), "");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

const SECTION_OF = new Map<string, BusinessSection>(BUSINESS_SECTIONS.map((s) => [SECTION_LABEL[s].toLowerCase(), s]));
const BULLET = /^\s*[-*+]\s+(.*)$/;

function lineOf(raw: string, section: BusinessSection): BusinessLine | null {
  const r = RECORD.exec(raw);
  const data = r ? json(r[1]) : {};
  const bare = raw.replace(RECORD, "");
  const text = one(BULLET.exec(bare)?.[1] ?? bare).slice(0, HAND_TEXT);
  if (!text) return null;
  const changed = typeof data.h === "string" && data.h !== lineHash(text);
  const was = data.by === "said" || data.by === "qalam" ? (data.by as BusinessBy) : "you";
  const by: BusinessBy = !r || changed ? "you" : was;
  const from = fromOf(data.from);
  return { id: str(data.id, 40) ?? freshId(), section, text, by, ...(from ? { from } : {}), at: typeof data.at === "number" && Number.isFinite(data.at) ? data.at : 0 };
}

export function businessFromMarkdown(md: string): Business {
  const b = emptyBusiness();
  const front = /^---\n([\s\S]*?)\n---\n?/.exec(md);
  const body = front ? md.slice(front[0].length) : md;
  if (front) {
    const version = /^qalam:\s*"?([^"\n]+)"?\s*$/m.exec(front[1])?.[1]?.trim();
    // A file of a version this doesn't know: nothing is read from it, and nothing is lost.
    if (version && version !== FILE) return { ...b, notes: body.trim() };
    const gone = /^gone:\s*(.*)$/m.exec(front[1])?.[1];
    if (gone) {
      try {
        const list = JSON.parse(gone);
        if (Array.isArray(list)) b.gone = [...new Set(list.filter((x): x is string => typeof x === "string").map((x) => one(x).toLowerCase()).filter(Boolean))].slice(-BUSINESS_LIMITS.gone);
      } catch {
        // A hand edit that broke the list: what's gone is forgotten, never the lines.
      }
    }
  }
  const notes: string[] = [];
  let section: BusinessSection | "other" | "top" = "top";
  const ids = new Set<string>();
  for (const line of body.split("\n")) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      if (h[1].length === 1 && section === "top") continue; // the title, written again each time
      if (h[1].length === 2) {
        const known = SECTION_OF.get(one(h[2]).toLowerCase());
        section = known ?? "other";
        if (known) continue;
      }
      notes.push(line);
      continue;
    }
    // The line under the title is written again each time; anything else a person put there stays.
    if (section === "top" && (!line.trim() || one(line) === INTRO)) continue;
    if (section !== "top" && section !== "other") {
      if (!line.trim()) continue;
      const l = lineOf(line, section);
      if (!l) continue;
      // The same words twice in a section: the first stands. An id written twice is the second line's own from now on.
      if (b.lines.some((x) => x.section === l.section && x.text.toLowerCase() === l.text.toLowerCase())) continue;
      const id = ids.has(l.id) ? freshId() : l.id;
      ids.add(id);
      b.lines.push({ ...l, id });
      continue;
    }
    notes.push(line);
  }
  const kept = notes.join("\n").trim();
  return kept ? { ...b, notes: kept } : b;
}
