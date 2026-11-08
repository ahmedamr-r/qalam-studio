import type { Dialect } from "./sql";
import { emptyMetrics, METRIC_LIMITS, METRIC_UNITS, nameKey, type Metric, type MetricBy, type MetricUnit, type Metrics } from "./types";

/*
 * hub/metrics.md: the team's numbers, readable as a short page (pure). One section per metric: its
 * name as a heading, its plain words, what it assumes, and its query in a fenced block (never in
 * the record, whose escaping would rewrite "--"). Each section's record (who wrote it, when, a hash of
 * its words and query, its unit and dialect, the goal it was drafted for) sits in a comment: the words
 * and the query are a person's to edit, the records aren't. A section written with no record, or
 * whose words or query a person changed, is theirs. Anything under a heading this doesn't know is
 * kept as it is, below the numbers.
 */

const FILE = "metrics/1";
const RECORD = /^\s*<!--\s*qalam\s+(\{.*?\})\s*-->\s*$/;
const record = (o: Record<string, unknown>) => `<!-- qalam ${JSON.stringify(o).replace(/--/g, "-\\u002d").replace(/>/g, "\\u003e")} -->`;
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const json = (s: string): Record<string, unknown> => {
  try {
    return rec(JSON.parse(s));
  } catch {
    return {};
  }
};
const one = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => one(s).slice(0, n);

/** A short hash: of a metric's words and query (a person's edit makes it theirs), or of its query alone (what a computer approved to run). */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0)!, 0x01000193) >>> 0;
  return h.toString(36);
}

/** The query as it runs, line endings and trailing spaces aside (spaces inside a string are part of it). */
export const sqlKey = (sql: string) => sql.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").trim();

export const metricHash = (m: Pick<Metric, "name" | "means" | "sql" | "assumes" | "unit">) => hash([one(m.name), one(m.means), m.unit, m.assumes.map(one).join(" | "), sqlKey(m.sql)].join(" ¦ "));

/** What a computer approves to run with its own credentials: the query and the SQL it's written in. */
export const queryHash = (m: Pick<Metric, "sql" | "dialect">) => hash(`${m.dialect}\n${sqlKey(m.sql)}`);

let made = 0;
export const freshMetricId = () => `m${Date.now().toString(36)}${(made++).toString(36)}`;

const INTRO = "Each number Qalam reads from your database: what it means, what it takes for granted, and the exact query that reads it. Qalam runs only these, read-only, and only once someone on each computer has checked one beside a sample. Edit the words or a query; leave the records as they are.";

/** A fence longer than any run of backticks inside the query (MySQL quotes names with them). */
function fenceFor(sql: string): string {
  const longest = Math.max(0, ...[...sql.matchAll(/`+/g)].map((m) => m[0].length));
  return "`".repeat(Math.max(3, longest + 1));
}

function sectionMd(m: Metric): string[] {
  const fence = fenceFor(m.sql);
  const out = [`## ${one(m.name)}`, record({ id: m.id, by: m.by, at: m.at, h: metricHash(m), unit: m.unit, dialect: m.dialect, ...(m.goal ? { goal: m.goal } : {}) }), "", one(m.means), ""];
  if (m.assumes.length) out.push("Assumes:", ...m.assumes.map((a) => `- ${one(a)}`), "");
  out.push(`${fence}sql`, m.sql.trim(), fence, "");
  return out;
}

export function metricsToMarkdown(t: Metrics, o: { org: string }): string {
  const out = ["---", `qalam: "${FILE}"`, `gone: ${JSON.stringify(t.gone)}`, "---", "", `# The numbers at ${o.org}`, "", INTRO, ""];
  for (const m of t.metrics) out.push(...sectionMd(m));
  if (t.notes?.trim()) out.push(t.notes.trim(), "");
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

const isUnit = (v: unknown): v is MetricUnit => typeof v === "string" && (METRIC_UNITS as readonly string[]).includes(v);
const isDialect = (v: unknown): v is Dialect => v === "postgres" || v === "mysql";

/** One section's lines (after its heading) read as a metric, or null when it has no query (kept as notes instead). */
function metricOf(name: string, lines: string[]): Metric | null {
  let data: Record<string, unknown> = {};
  let had = false;
  const words: string[] = [];
  const assumes: string[] = [];
  let sql: string[] | null = null;
  let fence = "";
  let inAssumes = false;
  for (const line of lines) {
    if (fence) {
      if (line.trim().startsWith(fence) && /^`+$/.test(line.trim()) && line.trim().length >= fence.length) {
        fence = "";
        continue;
      }
      sql!.push(line);
      continue;
    }
    const r = RECORD.exec(line);
    if (r && !had) {
      data = json(r[1]);
      had = true;
      continue;
    }
    const open = /^\s*(`{3,})\s*sql\s*$/i.exec(line);
    if (open && sql === null) {
      fence = open[1];
      sql = [];
      inAssumes = false;
      continue;
    }
    if (/^\s*_?Assumes_?\s*:\s*$/i.test(line)) {
      inAssumes = true;
      continue;
    }
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (inAssumes && item) {
      if (item[1].trim()) assumes.push(clip(item[1], METRIC_LIMITS.assume));
      continue;
    }
    if (!line.trim()) {
      inAssumes = false;
      continue;
    }
    inAssumes = false;
    words.push(line.trim());
  }
  const query = (sql ?? []).join("\n").trim();
  if (!query || fence) return null;
  const m = {
    name: clip(name, METRIC_LIMITS.name),
    means: clip(words.join(" "), METRIC_LIMITS.means),
    sql: query,
    assumes: assumes.slice(0, METRIC_LIMITS.assumes),
    unit: isUnit(data.unit) ? data.unit : ("other" as const),
  };
  if (!m.name) return null;
  const by: MetricBy = !had || data.by === "you" || (typeof data.h === "string" && data.h !== metricHash(m)) ? "you" : "qalam";
  return {
    id: typeof data.id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(data.id) ? data.id : freshMetricId(),
    ...m,
    dialect: isDialect(data.dialect) ? data.dialect : "postgres",
    ...(typeof data.goal === "string" && data.goal ? { goal: data.goal.slice(0, 60) } : {}),
    by,
    at: typeof data.at === "number" && Number.isFinite(data.at) ? data.at : 0,
  };
}

export function metricsFromMarkdown(md: string): Metrics {
  const t = emptyMetrics();
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
        if (Array.isArray(list)) t.gone = [...new Set(list.filter((x): x is string => typeof x === "string").map(nameKey).filter(Boolean))].slice(-METRIC_LIMITS.gone);
      } catch {
        // A hand edit that broke the list: what's gone is forgotten, never a metric.
      }
    }
  }
  const notes: string[] = [];
  let current: { name: string; lines: string[] } | null = null;
  let top = true;
  let fence = "";
  const ids = new Set<string>();
  const close = () => {
    if (!current) return;
    const m = metricOf(current.name, current.lines);
    if (m && !ids.has(m.id) && !t.metrics.some((x) => nameKey(x.name) === nameKey(m.name)) && t.metrics.length < METRIC_LIMITS.metrics) {
      ids.add(m.id);
      t.metrics.push(m);
    } else if (!m) notes.push(`## ${current.name}`, ...current.lines);
    current = null;
  };
  for (const line of body.split("\n")) {
    // Inside a section's query, a "#" line is SQL (a MySQL comment), not a heading.
    if (current && fence) {
      if (/^\s*`{3,}\s*$/.test(line) && line.trim().length >= fence.length) fence = "";
      current.lines.push(line);
      continue;
    }
    const open = /^\s*(`{3,})\s*sql\s*$/i.exec(line);
    if (current && open) {
      fence = open[1];
      current.lines.push(line);
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h && h[1].length === 1 && top) continue; // the title, written again each time
    if (h && h[1].length === 2) {
      close();
      top = false;
      current = { name: one(h[2]), lines: [] };
      continue;
    }
    if (current) {
      current.lines.push(line);
      continue;
    }
    // The line under the title is written again each time; anything else a person put there stays.
    if (top && (!line.trim() || one(line) === INTRO)) continue;
    notes.push(line);
  }
  close();
  const kept = notes.join("\n").trim();
  return kept ? { ...t, notes: kept } : t;
}
