import { dayOf } from "@/decisions/model";
import { factHash } from "@/knowledge/refs";
import { frontMatter, readFrontMatter } from "@/org/context-md";
import { SECTIONS, SECTION_HEADING, TOPIC_KINDS, type Author, type Topic, type TopicDispute, type TopicKind, type TopicLine, type TopicSection } from "./topics";

/**
 * A topic page as a Markdown file people can read and edit (hub/topics/<slug>.md): its kind and
 * products on top, its title as the heading, then We know · We believe · Against · Open questions
 * as lists, and its history. A line Qalam AI wrote shows where its pieces are from in brackets and
 * keeps its record (id, the pieces it cites) in a comment after it, which Markdown doesn't show.
 * A line without one is a person's. Editing a line Qalam AI wrote makes it the person's: Qalam AI
 * never rewrites it. Something said against a line sits under it ("Disputed: …"). Anything else
 * written in the file is kept where it was.
 */

export const TOPIC_FILE = "topic/1";
const HISTORY = "History";

/** A line's record, as JSON in a comment (its ">" escaped, so the comment can't end early). */
const record = (o: Record<string, unknown>) => ` <!-- qalam ${JSON.stringify(o).replace(/>/g, "\\u003e")} -->`;
const RECORD = /\s*<!--\s*qalam\s+(\{[\s\S]*?\})\s*-->\s*$/;
const BULLET = /^(?:[-*+]|\d+[.)])\s+(.*)$/;
const INDENTED = /^(?:\s{2,}|\t)/;
const DISPUTED = /^disputed\s*:\s*/i;
const DATED = /^(\d{4})-(\d{2})-(\d{2})\s*[·:—-]\s*(.*)$/;

const fromText = (from: string[]) => (from.length ? ` *(${from.join(" · ")})*` : "");

interface Parsed {
  text: string;
  meta: { id?: string; by?: Author; cites?: string[]; from?: string[]; at?: number; h?: string } | null;
}

function parseItem(raw: string): Parsed {
  const m = RECORD.exec(raw);
  if (!m) return { text: raw.trim(), meta: null };
  let meta: Parsed["meta"] = null;
  try {
    meta = JSON.parse(m[1]);
  } catch {
    return { text: raw.trim(), meta: null };
  }
  let text = raw.slice(0, m.index).trim();
  const from = Array.isArray(meta?.from) ? meta.from.filter((x): x is string => typeof x === "string") : [];
  const trailer = fromText(from).trim();
  if (trailer && text.endsWith(trailer)) text = text.slice(0, -trailer.length).trim();
  return { text, meta: meta && { ...meta, from } };
}

/** Who a line is by: as recorded, unless its words changed since (a person edited them). */
const authorOf = (p: Parsed): Author => (p.meta?.by === "qalam" && (!p.meta.h || p.meta.h === factHash(p.text)) ? "qalam" : "person");

function itemOut(x: { text: string; by: Author; id: string; cites: string[]; from: string[]; at: number }, keep: boolean): string {
  // A person's line without pieces is just their words.
  if (x.by === "person" && !x.cites.length && !keep) return x.text;
  return `${x.text}${fromText(x.from)}${record({ id: x.id, by: x.by, cites: x.cites, from: x.from, at: x.at, ...(x.by === "qalam" ? { h: factHash(x.text) } : {}) })}`;
}

/** The file for a topic. */
export function topicToMarkdown(t: Topic): string {
  const parts: string[] = [`# ${t.title.replace(/\s+/g, " ").trim() || "Untitled topic"}`];
  if (t.intro?.trim()) parts.push(t.intro.trim());
  for (const s of SECTIONS) {
    const lines = t.lines.filter((l) => l.section === s);
    const intro = t.intros?.[s]?.trim();
    if (!lines.length && !intro) continue;
    const body: string[] = [];
    if (intro) body.push(intro, "");
    for (const l of lines) {
      body.push(`- ${itemOut(l, false)}`);
      for (const d of l.disputes ?? []) body.push(`  - Disputed: ${itemOut(d, true)}`);
      if (l.more?.trim()) body.push(l.more.replace(/\s+$/, ""));
    }
    parts.push(`## ${SECTION_HEADING[s]}\n\n${body.join("\n").trim()}`);
  }
  if (t.history.length) parts.push(`## ${HISTORY}\n\n${t.history.map((h) => `- ${h.at > 0 ? `${dayOf(h.at)} · ` : ""}${h.text}`).join("\n")}`);
  if (t.notes?.trim()) parts.push(t.notes.trim());
  const front = { qalam: TOPIC_FILE, id: t.id, kind: t.kind, products: t.products, createdAt: t.createdAt, updatedAt: t.updatedAt, ...t.extra };
  return `${frontMatter(front)}${parts.join("\n\n")}\n`;
}

const KNOWN_FRONT = new Set(["qalam", "id", "kind", "products", "createdAt", "updatedAt", "title"]);

/**
 * A topic file back to its page. `fallbackId` names a page written by hand without Qalam's front
 * matter (its file's name, say); without either it isn't a page.
 */
export function topicFromMarkdown(md: string, fallbackId?: string): Topic | null {
  const { fields, body } = readFrontMatter(md.replace(/\r\n/g, "\n"));
  const id = typeof fields.id === "string" && fields.id ? fields.id : fallbackId;
  if (!id || (fields.qalam !== undefined && fields.qalam !== TOPIC_FILE)) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const extra = Object.fromEntries(Object.entries(fields).filter(([k]) => !KNOWN_FRONT.has(k)));
  const t: Topic = {
    id,
    kind: (TOPIC_KINDS as readonly string[]).includes(fields.kind as string) ? (fields.kind as TopicKind) : "need",
    title: typeof fields.title === "string" ? fields.title : "Untitled topic",
    products: Array.isArray(fields.products) ? fields.products.filter((p): p is string => typeof p === "string") : [],
    createdAt: num(fields.createdAt),
    updatedAt: num(fields.updatedAt),
    lines: [],
    history: [],
    ...(Object.keys(extra).length ? { extra } : {}),
  };
  const heading = new Map<string, TopicSection | "history">([...SECTIONS.map((s): [string, TopicSection] => [SECTION_HEADING[s].toLowerCase(), s]), [HISTORY.toLowerCase(), "history"]]);
  const lines = body.split("\n");
  let i = 0;
  // The title (the first heading), and what's under it before the first section.
  const head: string[] = [];
  for (; i < lines.length && !/^## /.test(lines[i]); i++) head.push(lines[i]);
  const h1 = head.findIndex((l) => /^# +/.test(l));
  if (h1 >= 0) t.title = head.splice(h1, 1)[0].replace(/^# +/, "").trim() || t.title;
  if (head.join("\n").trim()) t.intro = head.join("\n").trim();
  const notes: string[] = [];
  const seen = new Map<string, number>();
  const personId = (text: string) => {
    const base = `p${factHash(text)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}~${n}`;
  };
  while (i < lines.length) {
    const name = lines[i].replace(/^## +/, "").trim();
    const end = lines.findIndex((l, j) => j > i && /^## /.test(l));
    const chunk = lines.slice(i + 1, end < 0 ? lines.length : end);
    i = end < 0 ? lines.length : end;
    const section = heading.get(name.toLowerCase());
    if (!section) {
      notes.push([`## ${name}`, ...chunk].join("\n").trim());
      continue;
    }
    if (section === "history") {
      for (const l of chunk) {
        const b = BULLET.exec(l);
        if (!b) continue;
        const d = DATED.exec(b[1].trim());
        t.history.push(d ? { at: new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), 12).getTime(), text: d[4].trim() } : { at: 0, text: b[1].trim() });
      }
      continue;
    }
    const intro: string[] = [];
    let cur: TopicLine | null = null;
    let more: string[] = [];
    const close = () => {
      if (cur && more.join("\n").trim()) cur.more = more.join("\n").replace(/\s+$/, "");
      more = [];
    };
    for (const l of chunk) {
      const top = INDENTED.test(l) ? null : BULLET.exec(l);
      if (top) {
        close();
        const p = parseItem(top[1]);
        if (!p.text) {
          cur = null;
          continue;
        }
        const by = authorOf(p);
        cur = { id: p.meta?.id ?? personId(p.text), section, text: p.text, by, cites: p.meta?.cites ?? [], from: p.meta?.from ?? [], at: num(p.meta?.at) };
        t.lines.push(cur);
        continue;
      }
      const sub = cur && INDENTED.test(l) ? BULLET.exec(l.trim()) : null;
      if (cur && sub && DISPUTED.test(sub[1])) {
        const p = parseItem(sub[1].replace(DISPUTED, ""));
        if (p.text) {
          const d: TopicDispute = { id: p.meta?.id ?? `d${factHash(p.text)}`, text: p.text, by: authorOf(p), cites: p.meta?.cites ?? [], from: p.meta?.from ?? [], at: num(p.meta?.at) };
          cur.disputes = [...(cur.disputes ?? []), d];
        }
        continue;
      }
      if (cur) more.push(l);
      else intro.push(l);
    }
    close();
    if (intro.join("\n").trim()) t.intros = { ...t.intros, [section]: intro.join("\n").trim() };
  }
  if (notes.length) t.notes = notes.join("\n\n");
  return t;
}
