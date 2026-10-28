/**
 * What an organization and its products are, as Markdown files people can read and edit:
 * about.md for the organization, products/<slug>.md for each product. A file is a few headed
 * sections; a section Qalam doesn't know is kept as it is, so nothing written by hand is lost.
 * Their goals live in goals.md, one tree for the organization (src/goals).
 */

export interface ContextFields {
  /** Who it's for: the customers it serves. */
  audience: string;
  /** Anything else worth knowing: the market, the business, constraints. */
  context: string;
  /** Kinds of customers worth telling apart. */
  segments: string[];
  /** Sections Qalam doesn't know, kept as written. */
  notes?: string;
}

export interface Product extends ContextFields {
  id: string;
  name: string;
}

export const emptyContext = (): ContextFields => ({ audience: "", context: "", segments: [] });

type Field = "audience" | "context" | "segments";
const LISTS: Field[] = ["segments"];

/** Section headings: a product's, and the organization's own (about.md). */
export const PRODUCT_HEADINGS: Record<Field, string> = { audience: "Who it's for", context: "Context", segments: "Segments" };
export const ABOUT_HEADINGS: Record<Field, string> = { audience: "Who we serve", context: "What we do", segments: "Segments" };

/** The section goals had before goals.md. */
const GOALS_SECTION = /(?:^|\n\n)## +goals[ \t]*\n([\s\S]*?)(?=\n\n## |$)/i;

/**
 * The goals a context file still holds from before goals.md (its "## Goals" section, kept as a
 * note since), and the context without them.
 */
export function legacyGoals<T extends ContextFields>(c: T): { goals: string[]; rest: T } {
  const m = c.notes ? GOALS_SECTION.exec(c.notes) : null;
  if (!m || !c.notes) return { goals: [], rest: c };
  const goals = m[1]
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
  const notes = (c.notes.slice(0, m.index) + c.notes.slice(m.index + m[0].length)).replace(/^\n+/, "").trim();
  const { notes: _n, ...fields } = c;
  return { goals, rest: { ...fields, ...(notes ? { notes } : {}) } as T };
}

/** Front matter values are JSON, which YAML reads too. */
export function frontMatter(fields: Record<string, unknown>): string {
  return `---\n${Object.entries(fields)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n")}\n---\n\n`;
}

export function readFrontMatter(md: string): { fields: Record<string, unknown>; body: string } {
  if (!md.startsWith("---\n")) return { fields: {}, body: md };
  const end = md.indexOf("\n---", 4);
  if (end < 0) return { fields: {}, body: md };
  const fields: Record<string, unknown> = {};
  for (const line of md.slice(4, end).split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const raw = line.slice(i + 1).trim();
    try {
      fields[line.slice(0, i).trim()] = JSON.parse(raw);
    } catch {
      fields[line.slice(0, i).trim()] = raw.replace(/^["']|["']$/g, "");
    }
  }
  return { fields, body: md.slice(md.indexOf("\n", end + 1) + 1) };
}

/** The file for a context: optional front matter, then one section per field that has something. */
export function contextToMarkdown(c: ContextFields, headings: Record<Field, string>, front?: Record<string, unknown>): string {
  // Notes are text from before the first heading, then sections Qalam doesn't know: the text goes
  // back on top and the sections at the end, so reading the file again finds them where they were.
  const notes = c.notes?.trim() ?? "";
  const cut = notes.startsWith("## ") ? 0 : notes.search(/\n\n## /) < 0 ? notes.length : notes.search(/\n\n## /);
  const parts: string[] = [];
  if (notes.slice(0, cut).trim()) parts.push(notes.slice(0, cut).trim());
  for (const f of ["audience", "context", "segments"] as Field[]) {
    const v = c[f];
    const body = Array.isArray(v) ? v.filter((x) => x.trim()).map((x) => `- ${x.trim()}`).join("\n") : v.trim();
    if (body) parts.push(`## ${headings[f]}\n\n${body}`);
  }
  if (notes.slice(cut).trim()) parts.push(notes.slice(cut).trim());
  return (front ? frontMatter(front) : "") + (parts.length ? `${parts.join("\n\n")}\n` : "");
}

/** A context file back to its fields (and its front matter). Headings match whatever their case. */
export function contextFromMarkdown(md: string, headings: Record<Field, string>): { front: Record<string, unknown>; fields: ContextFields } {
  const { fields: front, body } = readFrontMatter(md.replace(/\r\n/g, "\n"));
  const byHeading = new Map(Object.entries(headings).map(([f, h]) => [h.toLowerCase(), f as Field]));
  const out = emptyContext();
  const notes: string[] = [];
  // Split on level-2 headings; text before the first heading is kept as a note.
  const chunks = body.split(/^## +/m);
  if (chunks[0].trim()) notes.push(chunks[0].trim());
  for (const chunk of chunks.slice(1)) {
    const nl = chunk.indexOf("\n");
    const heading = (nl < 0 ? chunk : chunk.slice(0, nl)).trim();
    const text = nl < 0 ? "" : chunk.slice(nl + 1).trim();
    const field = byHeading.get(heading.toLowerCase());
    if (!field) {
      notes.push(`## ${heading}${text ? `\n\n${text}` : ""}`);
      continue;
    }
    if (LISTS.includes(field))
      out[field as "segments"] = text
        .split("\n")
        .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim())
        .filter(Boolean);
    else out[field as "audience" | "context"] = text;
  }
  if (notes.length) out.notes = notes.join("\n\n");
  return { front, fields: out };
}

/** A product's file: its id and name on top, then its sections. */
export const productToMarkdown = (p: Product) => {
  const { id, name, ...fields } = p;
  return contextToMarkdown(fields, PRODUCT_HEADINGS, { id, name });
};

export function productFromMarkdown(md: string): Product | null {
  const { front, fields } = contextFromMarkdown(md, PRODUCT_HEADINGS);
  if (typeof front.id !== "string" || !front.id) return null;
  return { id: front.id, name: typeof front.name === "string" && front.name ? front.name : "Untitled product", ...fields };
}

export const aboutToMarkdown = (c: ContextFields) => contextToMarkdown(c, ABOUT_HEADINGS);
export const aboutFromMarkdown = (md: string) => contextFromMarkdown(md, ABOUT_HEADINGS).fields;

/** A context as lines for Qalam AI ("" when there's nothing in it). */
export function contextText(c: ContextFields | null | undefined, label: string): string {
  if (!c) return "";
  const lines = [
    c.audience.trim() && `Who it's for: ${c.audience.trim()}`,
    c.context.trim() && `Context: ${c.context.trim()}`,
    c.segments.length && `Segments: ${c.segments.join("; ")}`,
  ].filter(Boolean);
  return lines.length ? `${label}\n${lines.join("\n")}` : "";
}
