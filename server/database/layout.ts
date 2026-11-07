import { ident, lit, maskValue, personalOf, pgArray, safeName, statusLike, SYSTEM_SCHEMAS, tableKeyOf, type Layout, type LayoutColumn, type LayoutTable } from "@/database/layout";
import type { Rows, Runner } from "./runner";

/*
 * Reading how a database is laid out, with no tokens: a handful of the catalog's own queries, run
 * read-only like any other read. Keys come from pg_constraint (a user who may only SELECT can't see
 * them in information_schema), row counts from the planner's estimates, never count(*). Common values
 * are read only for the few columns already picked as status-like: from pg_stats where the database
 * has them, else from a capped scan with a short timeout. No row is read whole, and no personal column
 * is ever sampled.
 */

/** Columns sampled for their values, at most; and how long one scan may take. */
const MAX_SAMPLED = 24;
const SCAN_MS = 3000;
const SCAN_ROWS = 20_000;

const skipSchemas = (extra: readonly string[] = []) => [...SYSTEM_SCHEMAS, ...extra].map(lit).join(", ");

const TABLES = `SELECT n.nspname AS schema, c.relname AS name, c.relkind::text AS kind, c.reltuples::float8 AS estimate,
  obj_description(c.oid, 'pg_class') AS comment, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type,
  a.attnotnull AS notnull, col_description(c.oid, a.attnum) AS col_comment, t.typcategory::text AS category,
  CASE WHEN t.typtype = 'e' THEN (SELECT string_agg(e.enumlabel, chr(31) ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = t.oid) END AS labels
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
JOIN pg_type t ON t.oid = a.atttypid
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND NOT c.relispartition
  AND n.nspname NOT IN (${skipSchemas()}) AND n.nspname NOT LIKE 'pg\\_%'
  AND has_column_privilege(c.oid, a.attnum, 'SELECT')
ORDER BY 1, 2, a.attnum`;

const KEYS = `SELECT con.contype::text AS type, n.nspname AS schema, c.relname AS name,
  (SELECT string_agg(a.attname, chr(31) ORDER BY k.i) FROM unnest(con.conkey) WITH ORDINALITY AS k(num, i) JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.num) AS cols,
  fn.nspname AS ref_schema, fc.relname AS ref_name,
  (SELECT string_agg(a.attname, chr(31) ORDER BY k.i) FROM unnest(con.confkey) WITH ORDINALITY AS k(num, i) JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.num) AS ref_cols
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_class fc ON fc.oid = con.confrelid
LEFT JOIN pg_namespace fn ON fn.oid = fc.relnamespace
WHERE con.contype IN ('p', 'f') AND n.nspname NOT IN (${skipSchemas()}) AND n.nspname NOT LIKE 'pg\\_%'`;

const asObjects = (r: Rows) => r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c.name, row[i]])) as Record<string, unknown>);
const s = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const split = (v: unknown) => (typeof v === "string" && v ? v.split("\u001f") : []);

/** Postgres's layout (Supabase's too, through the same SQL), with what's sampled. `hidden`: tables row security hides from the user. */
export async function readPostgresLayout(r: Runner, o: { hidden?: readonly string[]; version?: string; emit?: (label: string) => void; signal?: AbortSignal; now?: number } = {}): Promise<Layout> {
  o.emit?.("Reading its tables and columns");
  const tables = new Map<string, LayoutTable>();
  for (const row of asObjects(await r.read(TABLES, { rows: 20_000, signal: o.signal }))) {
    const schema = s(row.schema);
    const name = s(row.name);
    if (!safeName(schema) || !safeName(name)) continue;
    const key = `${schema}.${name}`;
    let t = tables.get(key);
    if (!t) {
      const est = Number(row.estimate);
      const view = s(row.kind) === "v" || s(row.kind) === "m";
      t = { schema, name, ...(view ? { view: true } : {}), rows: !view && Number.isFinite(est) && est >= 0 ? Math.round(est) : null, ...(s(row.comment) ? { comment: s(row.comment) } : {}), ...(o.hidden?.includes(key) ? { hidden: true } : {}), columns: [] };
      tables.set(key, t);
    }
    const col = s(row.col);
    if (!safeName(col)) continue;
    const personal = personalOf(col, name);
    const labels = split(row.labels);
    t.columns.push({ name: col, type: s(row.type), nullable: !row.notnull, ...(s(row.col_comment) ? { comment: s(row.col_comment) } : {}), ...(labels.length ? { labels } : {}), ...(personal ? { personal } : {}), ...(s(row.category) === "N" ? { numeric: true } : {}) });
  }
  o.emit?.("Reading its keys");
  for (const k of asObjects(await r.read(KEYS, { rows: 20_000, signal: o.signal }))) {
    const t = tables.get(`${s(k.schema)}.${s(k.name)}`);
    if (!t) continue;
    const cols = split(k.cols);
    if (s(k.type) === "p") for (const c of t.columns) if (cols.includes(c.name)) c.primary = true;
    if (s(k.type) === "f" && cols.length === 1) {
      const refCols = split(k.ref_cols);
      const c = t.columns.find((x) => x.name === cols[0]);
      if (c && k.ref_name) c.ref = `${s(k.ref_schema)}.${s(k.ref_name)}.${refCols[0] ?? "id"}`;
    }
  }
  const layout: Layout = { dialect: "postgres", home: r.home, ...(o.version ? { version: o.version } : {}), at: o.now ?? Date.now(), tables: [...tables.values()] };
  await sampleValues(r, layout, o);
  return layout;
}

/** The columns worth sampling, best tables first: short status-like ones, never personal, never an enum (its labels say it). */
function toSample(l: Layout): { t: LayoutTable; c: LayoutColumn }[] {
  const out: { t: LayoutTable; c: LayoutColumn }[] = [];
  for (const t of l.tables) {
    if (t.hidden) continue;
    for (const c of t.columns) if (!c.labels && statusLike(c)) out.push({ t, c });
  }
  return out.slice(0, MAX_SAMPLED);
}

async function sampleValues(r: Runner, l: Layout, o: { emit?: (label: string) => void; signal?: AbortSignal }) {
  const wanted = toSample(l);
  if (!wanted.length) return;
  o.emit?.(`Looking at the values of ${wanted.length === 1 ? "a column" : `${wanted.length} columns`} like status and type`);
  const keys = wanted.map(({ t, c }) => `(${lit(t.schema)}, ${lit(t.name)}, ${lit(c.name)})`).join(", ");
  const stats = new Map<string, { distinct: number; vals: string[] }>();
  if (l.dialect === "postgres") {
    const rows = await r.read(`SELECT schemaname AS schema, tablename AS name, attname AS col, n_distinct::float8 AS distinct, most_common_vals::text AS vals FROM pg_stats WHERE (schemaname, tablename, attname) IN (${keys})`, { rows: 1000, signal: o.signal }).catch(() => null);
    for (const row of rows ? asObjects(rows) : []) stats.set(`${s(row.schema)}.${s(row.name)}.${s(row.col)}`, { distinct: Number(row.distinct), vals: typeof row.vals === "string" ? pgArray(row.vals) : [] });
  }
  for (const { t, c } of wanted) {
    if (o.signal?.aborted) return;
    const st = stats.get(`${tableKeyOf(t)}.${c.name}`);
    // n_distinct: a count, or minus a share of the rows; more than 20 kinds isn't a status.
    const distinct = st ? (st.distinct < 0 ? -st.distinct * (t.rows ?? 0) : st.distinct) : NaN;
    let values: string[] | null = null;
    if (st && st.vals.length && distinct <= 20) values = st.vals;
    else if (!st || !st.vals.length) values = await scan(r, l, t, c, o.signal);
    if (!values || values.length > 20) continue;
    const kept = values.map(maskValue).filter((v): v is string => v !== null);
    if (kept.length) c.values = kept.slice(0, 20);
  }
}

/** A column's most common values from a capped scan (at most 20,000 rows, 3 seconds); null when it has too many to be a status, or the scan didn't finish. */
async function scan(r: Runner, l: Layout, t: LayoutTable, c: LayoutColumn, signal?: AbortSignal): Promise<string[] | null> {
  const col = ident(c.name, l.dialect);
  const from = `${ident(t.schema, l.dialect)}.${ident(t.name, l.dialect)}`;
  const cast = l.dialect === "mysql" ? `CAST(${col} AS CHAR)` : `${col}::text`;
  const sql = `SELECT v FROM (SELECT ${cast} AS v FROM ${from} LIMIT ${SCAN_ROWS}) s WHERE v IS NOT NULL GROUP BY v ORDER BY count(*) DESC LIMIT 21`;
  const rows = await r.read(sql, { rows: 21, timeoutMs: SCAN_MS, signal }).catch(() => null);
  if (!rows) return null;
  const vals = rows.rows.map((x) => s(x[0]));
  return vals.length > 20 ? null : vals;
}
