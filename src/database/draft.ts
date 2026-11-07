import { layoutText, tableKeyOf, type Layout, type LayoutTable } from "./layout";
import { guardSql, type Dialect } from "./sql";
import { METRIC_LIMITS, METRIC_UNITS, nameKey, type MetricUnit } from "./types";

/*
 * Qalam AI's drafts of a team's numbers, checked by code (pure). What it reads: the layout, the
 * company, the goals and their numbers' names, the project's words, the numbers kept or taken off,
 * and what the team told it. What code keeps: a draft whose query passes the guard, reads only tables
 * that were in the layout (none that row security hides), and whose words hold no number its query
 * doesn't; at most 8. Its goal stays only when it was sent. What it can't tell is kept as questions,
 * their choices only real tables and columns. Then the database plans and runs each (the core's
 * part), and code's warnings sit beside the sample the person checks.
 */

export interface DraftQuestion {
  id: string;
  question: string;
  /** Tables or columns it's choosing between, as schema.table or schema.table.column, each in the layout. */
  choices: string[];
  /** The number it would let Qalam AI write. */
  for?: string;
}

/** What the team said to one: their words, a choice they picked, or that they don't know. */
export interface DraftAnswer {
  id: string;
  question: string;
  answer: string;
  how: "own" | "pick" | "unknown";
}

export interface Draft {
  id: string;
  name: string;
  means: string;
  unit: MetricUnit;
  sql: string;
  dialect: Dialect;
  assumes: string[];
  goal?: string;
  /** The columns the database's plan reads ("schema.table.column"), by its own reading. */
  reads: string[];
  /** Code's warnings: on the query, and on its sample. */
  flags: string[];
  /** The number it gave when code ran it, read-only, just now. */
  sample?: { value: number | null; at: number };
  /** Why the database couldn't read it, in words. */
  error?: string;
}

export interface Drafts {
  at: number;
  /** The database they were drafted on. */
  where: string;
  drafts: Draft[];
  questions: DraftQuestion[];
  /** What code left out, with why. */
  dropped: { name: string; why: string }[];
  answers: DraftAnswer[];
}

export const MAX_DRAFTS = 8;
const MAX_QUESTIONS = 4;

export interface DraftInput {
  layout: Layout;
  sent: readonly LayoutTable[];
  others: readonly string[];
  /** The company, in a line or two (the About). */
  about: string;
  goals: readonly { id: string; title: string; metric?: string; unit?: string }[];
  /** The project's words, a line each. */
  terms: readonly string[];
  kept: readonly string[];
  gone: readonly string[];
  answers: readonly DraftAnswer[];
}

const one = (s: string) => s.replace(/\s+/g, " ").trim();

export function draftText(i: DraftInput): string {
  const out: string[] = [];
  if (i.about.trim()) out.push(`The company: ${one(i.about)}`, "");
  if (i.goals.length) out.push("The goals (id: the goal, and what it measures):", ...i.goals.map((g) => `- ${g.id}: ${one(g.title)}${g.metric ? ` (${one(g.metric)}${g.unit ? `, in ${one(g.unit)}` : ""})` : ""}`), "");
  if (i.terms.length) out.push("The project's own words:", ...i.terms.map((t) => `- ${one(t)}`), "");
  if (i.kept.length) out.push(`Numbers kept already (never write them again): ${i.kept.join("; ")}`, "");
  if (i.gone.length) out.push(`Numbers the team took off (never write them again): ${i.gone.join("; ")}`, "");
  if (i.answers.length)
    out.push(
      "What the team told you, in answer to what you couldn't tell:",
      ...i.answers.map((a) => `- ${one(a.question)} → ${a.how === "unknown" ? "they don't know (leave out what needs it)" : a.how === "pick" ? `they picked: ${one(a.answer)}` : `in their words: "${one(a.answer)}"`}`),
      "",
    );
  out.push("The layout:", layoutText(i.layout, i.sent, i.others));
  return out.join("\n");
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown, max: number) => (typeof v === "string" ? one(v).slice(0, max) : "");

/** The numbers written in words ("30 days", "$1,000", "2.5%"). */
export const numbersIn = (s: string): string[] => [...s.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => m[0].replace(/,(?=\d{3}\b)/g, ""));

/** Whether a number in the words is in the query: as it is, or a hundred times it (cents), or a hundredth. */
export function numberHeld(n: string, sql: string): boolean {
  const has = (x: string) => new RegExp(`(?<![\\d.])${x.replace(".", "\\.")}(?![\\d])`).test(sql);
  if (has(n)) return true;
  const v = Number(n);
  if (!Number.isFinite(v)) return false;
  const times = String(Math.round(v * 100));
  const part = String(v / 100);
  return has(times) || has(part);
}

export interface SanitizeCtx {
  layout: Layout;
  goalIds: ReadonlySet<string>;
  kept: readonly string[];
  gone: readonly string[];
  id: () => string;
}

/** A table a query names, as the layout keys it (its home schema when it names none). */
const resolve = (l: Layout, t: { schema?: string; name: string }) => l.tables.find((x) => tableKeyOf(x).toLowerCase() === `${t.schema ?? l.home}.${t.name}`.toLowerCase());

/** The drafts code keeps from what Qalam AI wrote, what it can't tell, and what was left out and why. */
export function sanitizeDrafts(raw: unknown, ctx: SanitizeCtx): { drafts: Draft[]; questions: DraftQuestion[]; dropped: { name: string; why: string }[] } {
  const r = rec(raw);
  const dropped: { name: string; why: string }[] = [];
  const taken = new Set([...ctx.kept, ...ctx.gone].map(nameKey));
  const drafts: Draft[] = [];
  for (const m of Array.isArray(r.metrics) ? r.metrics : []) {
    const x = rec(m);
    const name = text(x.name, METRIC_LIMITS.name);
    const means = text(x.means, METRIC_LIMITS.means);
    const drop = (why: string) => void dropped.push({ name: name || "A number with no name", why });
    if (!name || !means) {
      drop("it has no name or no words");
      continue;
    }
    if (taken.has(nameKey(name))) {
      drop("it's kept already, or was taken off");
      continue;
    }
    const unit = (METRIC_UNITS as readonly string[]).includes(x.unit as string) ? (x.unit as MetricUnit) : "other";
    const g = guardSql(typeof x.sql === "string" ? x.sql : "", ctx.layout.dialect);
    if (!g.ok) {
      drop(`Qalam won't run its query: ${g.why}`);
      continue;
    }
    const tables = g.tables.map((t) => ({ t, found: resolve(ctx.layout, t) }));
    const missing = tables.find((t) => !t.found);
    if (missing) {
      drop(`it reads ${missing.t.schema ? `${missing.t.schema}.` : ""}${missing.t.name}, which isn't in the layout Qalam read`);
      continue;
    }
    if (!tables.length) {
      drop("it reads no table");
      continue;
    }
    const hidden = tables.find((t) => t.found!.hidden);
    if (hidden) {
      drop(`it reads ${tableKeyOf(hidden.found!)}, whose rows row-level security hides from this user`);
      continue;
    }
    const loose = numbersIn(`${name} ${means}`).find((n) => !numberHeld(n, g.sql));
    if (loose) {
      drop(`its words say ${loose}, which its query doesn't`);
      continue;
    }
    if (drafts.length >= MAX_DRAFTS) {
      drop(`only the first ${MAX_DRAFTS} are kept`);
      continue;
    }
    taken.add(nameKey(name));
    const goal = typeof x.goal === "string" && ctx.goalIds.has(x.goal) ? x.goal : undefined;
    const assumes = (Array.isArray(x.assumes) ? x.assumes : []).map((a) => text(a, METRIC_LIMITS.assume)).filter(Boolean).slice(0, METRIC_LIMITS.assumes);
    drafts.push({ id: ctx.id(), name, means, unit, sql: g.sql, dialect: ctx.layout.dialect, assumes, ...(goal ? { goal } : {}), reads: [], flags: queryFlags(g.sql, tables.map((t) => t.found!), unit) });
  }
  const known = new Set(ctx.layout.tables.flatMap((t) => [tableKeyOf(t), ...t.columns.map((c) => `${tableKeyOf(t)}.${c.name}`)]).map((k) => k.toLowerCase()));
  const questions: DraftQuestion[] = [];
  for (const q of Array.isArray(r.cannot_tell) ? r.cannot_tell : []) {
    const x = rec(q);
    const question = text(x.question, 240);
    if (!question || questions.length >= MAX_QUESTIONS) continue;
    const choices = (Array.isArray(x.choices) ? x.choices : []).map((c) => text(c, 160)).filter((c) => known.has(c.toLowerCase()) || known.has(`${ctx.layout.home}.${c}`.toLowerCase()));
    const forName = text(x.for, METRIC_LIMITS.name);
    questions.push({ id: ctx.id(), question, choices: [...new Set(choices)].slice(0, 6), ...(forName ? { for: forName } : {}) });
  }
  return { drafts, questions, dropped };
}

/** Code's warnings on a query, from what the layout says of the tables it reads. */
export function queryFlags(sql: string, tables: readonly LayoutTable[], unit: MetricUnit): string[] {
  const flags: string[] = [];
  const mentions = (col: string) => new RegExp(`(^|[^\\w$])${col.replace(/[$]/g, "\\$")}([^\\w$]|$)`, "i").test(sql);
  for (const t of tables) {
    for (const c of t.columns) {
      if (unit === "money" && (/_cents$|^cents$/i.test(c.name) || /\bcents?\b/i.test(c.comment ?? "")) && mentions(c.name) && !/\/\s*100(\.0*)?\b|\*\s*0?\.01\b/.test(sql)) flags.push(`It adds up ${c.name} as money, and that column is in cents: divide by 100.`);
      if (/^(currency|currency_code|currency_iso)$/i.test(c.name) && unit === "money" && !mentions(c.name)) flags.push(`${tableKeyOf(t)} has a ${c.name} column, and this adds every currency together.`);
      if (/^(deleted_at|deleted|is_deleted|archived_at|removed_at)$/i.test(c.name) && !mentions(c.name)) flags.push(`${tableKeyOf(t)} has ${c.name}, and this counts deleted rows too.`);
    }
  }
  return [...new Set(flags)];
}

/** Code's warnings on the number a query gave. */
export function sampleFlags(value: number | null, unit: MetricUnit): string[] {
  if (value === null) return ["It came out empty: no row matched."];
  if (value === 0) return ["It came out as 0: check the states and dates it counts."];
  if (value < 0 && (unit === "money" || unit === "count")) return ["It came out negative."];
  if (unit === "percent" && (value > 100 || value < 0)) return ["As a percent it's outside 0 to 100."];
  if (unit === "percent" && value > 0 && value < 1) return ["As a percent it's under 1: it may be a ratio (0 to 1)."];
  if (unit === "ratio" && value > 1) return ["As a ratio it's over 1: it may be a percent."];
  return [];
}

/** What a query gave, as a number: one row, one numeric column, else why not. */
export function sampleOf(r: { columns: readonly { name: string; numeric: boolean }[]; rows: readonly unknown[][] }): { value: number | null } | { why: string } {
  if (r.columns.length !== 1) return { why: `It gives ${r.columns.length} columns; a number needs one.` };
  if (!r.rows.length) return { why: "It gives no row; a number needs one." };
  if (r.rows.length > 1) return { why: "It gives more than one row; a number needs one." };
  const v = r.rows[0][0];
  if (v === null || v === undefined) return { value: null };
  if (!r.columns[0].numeric) return { why: "What it gives isn't a number (cast it to one)." };
  const n = typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : Number(v);
  return Number.isFinite(n) ? { value: n } : { why: "What it gives isn't a number." };
}
