import { factHash } from "@/knowledge/refs";

/**
 * What an organization and its products are, as Markdown files people can read and edit:
 * about.md for the organization, products/<slug>.md for each product. A file is a few headed
 * sections; a section Qalam doesn't know is kept as it is, so nothing written by hand is lost.
 */

/**
 * A goal the organization or a product moves, as the team states it. The first one leads. Boards'
 * outcomes name the goal they serve by its id, which is its words' hash until they change: the
 * file then keeps the id in a comment after the line, which Markdown doesn't show.
 */
export interface OrgGoal {
  id: string;
  text: string;
  /** How they'll know it moved, in their words ("weekly reorders per customer"). */
  measure?: string;
  /** By when, in their words. */
  by?: string;
  /** Who answers for it. */
  owner?: string;
  /** Indented lines under it that Qalam doesn't know, kept as written. */
  more?: string;
}

export interface ContextFields {
  /** Who it's for: the customers it serves. */
  audience: string;
  /** What the team is trying to move, the one that leads first (one per line in the file). */
  goals: OrgGoal[];
  /** Anything else worth knowing: the market, the business. */
  context: string;
  /** Kinds of customers worth telling apart. */
  segments: string[];
  /** How it means to win: the bets it's making. */
  strategy?: string;
  /** What customers use instead: competitors, workarounds, doing nothing. */
  alternatives?: string[];
  /** What it won't do, or can't: rules, limits, what's off the table. */
  constraints?: string[];
  /** Sections Qalam doesn't know, kept as written. */
  notes?: string;
}

export interface Product extends ContextFields {
  id: string;
  name: string;
}

export const emptyContext = (): ContextFields => ({ audience: "", goals: [], context: "", segments: [] });

/** A goal's id from its words (what a goal written by hand gets until it's renamed in Qalam). */
export const goalId = (text: string) => `g${factHash(text)}`;

/** A goal from its words, its id from them. */
export const newGoal = (text: string): OrgGoal => ({ id: goalId(text), text: text.replace(/\s+/g, " ").trim() });

export type Field = "audience" | "goals" | "strategy" | "context" | "segments" | "alternatives" | "constraints";
type ListField = "segments" | "alternatives" | "constraints";
type TextField = "audience" | "context" | "strategy";
const LISTS: ListField[] = ["segments", "alternatives", "constraints"];
/** The order sections are written in. */
const ORDER: Field[] = ["audience", "goals", "strategy", "context", "segments", "alternatives", "constraints"];

/** Section headings: a product's, and the organization's own (about.md). */
export const PRODUCT_HEADINGS: Record<Field, string> = {
  audience: "Who it's for",
  goals: "Goals",
  strategy: "Strategy",
  context: "Context",
  segments: "Segments",
  alternatives: "What customers use instead",
  constraints: "Constraints",
};
export const ABOUT_HEADINGS: Record<Field, string> = { ...PRODUCT_HEADINGS, audience: "Who we serve", context: "What we do" };

/** A goal's details, as the lines under it name them. */
const GOAL_DETAIL: [keyof Pick<OrgGoal, "measure" | "by" | "owner">, string][] = [
  ["measure", "Measured by"],
  ["by", "By"],
  ["owner", "Owner"],
];
const DETAIL = /^\s+(?:[-*+]\s+)?(measured by|measure|by|owner)\s*:\s*(.*)$/i;
const BULLET = /^\s*(?:[-*+]|\d+[.)])\s+/;
const RECORD = /\s*<!--\s*qalam\s+(\{[\s\S]*?\})\s*-->\s*$/;
const record = (o: Record<string, unknown>) => ` <!-- qalam ${JSON.stringify(o).replace(/>/g, "\\u003e")} -->`;

/** The goals as their section's lines: each a bullet, its details under it. */
function goalsToMarkdown(goals: OrgGoal[]): string {
  const out: string[] = [];
  for (const g of goals) {
    const text = g.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    // The id goes in the file only once it's no longer the words' own.
    out.push(`- ${text}${g.id && g.id !== goalId(text) ? record({ id: g.id }) : ""}`);
    for (const [k, label] of GOAL_DETAIL) if (g[k]?.trim()) out.push(`  - ${label}: ${g[k]!.replace(/\s+/g, " ").trim()}`);
    if (g.more?.trim()) out.push(g.more.replace(/\s+$/, ""));
  }
  return out.join("\n");
}

/** A goals section back to its goals. Lines under a goal it doesn't know are kept on it. */
function goalsFromMarkdown(text: string): OrgGoal[] {
  const out: OrgGoal[] = [];
  const seen = new Map<string, number>();
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    const cur = out[out.length - 1];
    if (/^\s/.test(raw) && cur) {
      const d = DETAIL.exec(raw);
      if (d) {
        const k = d[1].toLowerCase();
        cur[k === "owner" ? "owner" : k === "by" ? "by" : "measure"] = d[2].trim();
      } else cur.more = cur.more ? `${cur.more}\n${raw.replace(/\s+$/, "")}` : raw.replace(/\s+$/, "");
      continue;
    }
    let line = raw.replace(BULLET, "").trim();
    let id = "";
    const m = RECORD.exec(line);
    if (m) {
      try {
        const o = JSON.parse(m[1]) as { id?: unknown };
        if (typeof o.id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(o.id)) id = o.id;
      } catch {
        // a broken record: the goal keeps its words' id
      }
      line = line.slice(0, m.index).trim();
    }
    if (!line) continue;
    id ||= goalId(line);
    // The same words twice: the second is still a goal of its own.
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    out.push({ id: n === 1 ? id : `${id}-${n}`, text: line });
  }
  return out;
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

/** A list's lines as bullets, or a text field as written ("" when empty). */
function listOrText(c: ContextFields, f: Exclude<Field, "goals">): string {
  const v = c[f];
  if (Array.isArray(v)) return v.filter((x) => x.trim()).map((x) => `- ${x.trim()}`).join("\n");
  return (v ?? "").trim();
}

/** The file for a context: optional front matter, then one section per field that has something. */
export function contextToMarkdown(c: ContextFields, headings: Record<Field, string>, front?: Record<string, unknown>): string {
  // Notes are text from before the first heading, then sections Qalam doesn't know: the text goes
  // back on top and the sections at the end, so reading the file again finds them where they were.
  const notes = c.notes?.trim() ?? "";
  const cut = notes.startsWith("## ") ? 0 : notes.search(/\n\n## /) < 0 ? notes.length : notes.search(/\n\n## /);
  const parts: string[] = [];
  if (notes.slice(0, cut).trim()) parts.push(notes.slice(0, cut).trim());
  for (const f of ORDER) {
    const body = f === "goals" ? goalsToMarkdown(c.goals) : listOrText(c, f);
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
    if (field === "goals") out.goals = goalsFromMarkdown(text);
    else if ((LISTS as Field[]).includes(field))
      out[field as ListField] = text
        .split("\n")
        .map((l) => l.replace(BULLET, "").trim())
        .filter(Boolean);
    else out[field as TextField] = text;
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

/** A goal as one line: its words, then how it's measured, by when and whose it is. */
export function goalText(g: OrgGoal): string {
  const details = [g.measure?.trim() && `measured by ${g.measure.trim()}`, g.by?.trim() && `by ${g.by.trim()}`, g.owner?.trim() && `owner: ${g.owner.trim()}`].filter(Boolean);
  return `${g.text.trim()}${details.length ? ` (${details.join("; ")})` : ""}`;
}

/** A context as lines for Qalam AI ("" when there's nothing in it). */
export function contextText(c: ContextFields | null | undefined, label: string): string {
  if (!c) return "";
  const lines = [
    c.audience.trim() && `Who it's for: ${c.audience.trim()}`,
    c.goals.length && `Goals${c.goals.length > 1 ? " (the first leads)" : ""}: ${c.goals.map(goalText).join("; ")}`,
    c.strategy?.trim() && `Strategy: ${c.strategy.trim()}`,
    c.context.trim() && `Context: ${c.context.trim()}`,
    c.segments.length && `Segments: ${c.segments.join("; ")}`,
    c.alternatives?.length && `What customers use instead: ${c.alternatives.join("; ")}`,
    c.constraints?.length && `Constraints: ${c.constraints.join("; ")}`,
  ].filter(Boolean);
  return lines.length ? `${label}\n${lines.join("\n")}` : "";
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
const strs = (v: unknown, max: number) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]).slice(0, 60).map((x) => x.slice(0, max)) : null);

/**
 * A context as a window sends it, checked and made whole: goals as Qalam keeps them (a window from
 * before goals had details sends their words), the new fields only when they're there. Null: not one.
 */
export function contextShape(raw: unknown): ContextFields | null {
  const x = raw as Record<string, unknown> | null;
  if (!x || typeof x !== "object" || typeof x.audience !== "string" || typeof x.context !== "string" || !Array.isArray(x.goals)) return null;
  const segments = strs(x.segments, 200);
  if (!segments) return null;
  const goals: OrgGoal[] = [];
  for (const g of x.goals.slice(0, 60)) {
    if (typeof g === "string") {
      if (g.trim()) goals.push(newGoal(g.slice(0, 300)));
      continue;
    }
    const o = g as Record<string, unknown> | null;
    if (!o || typeof o.text !== "string" || !o.text.trim()) return null;
    const text = o.text.replace(/\s+/g, " ").trim().slice(0, 300);
    const goal: OrgGoal = { id: typeof o.id === "string" && ID.test(o.id) ? o.id : goalId(text), text };
    for (const k of ["measure", "by", "owner"] as const) {
      const v = str(o[k], 200)?.trim();
      if (v) goal[k] = v;
    }
    if (typeof o.more === "string" && o.more.trim()) goal.more = o.more.slice(0, 2000);
    goals.push(goal);
  }
  const out: ContextFields = { audience: x.audience.slice(0, 4000), goals, context: x.context.slice(0, 8000), segments };
  if (typeof x.strategy === "string") out.strategy = x.strategy.slice(0, 4000);
  for (const k of ["alternatives", "constraints"] as const) {
    if (x[k] === undefined) continue;
    const list = strs(x[k], 300);
    if (!list) return null;
    out[k] = list;
  }
  if (typeof x.notes === "string") out.notes = x.notes.slice(0, 20000);
  return out;
}

/** Nothing said about it yet. */
export const contextEmpty = (c: ContextFields) => !c.audience.trim() && !c.goals.length && !c.context.trim() && !c.segments.length && !c.strategy?.trim() && !c.alternatives?.length && !c.constraints?.length;
