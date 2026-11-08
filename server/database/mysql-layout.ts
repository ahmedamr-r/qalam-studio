import { personalOf, safeName, type Layout, type LayoutTable } from "@/database/layout";
import { sampleValues } from "./layout";
import type { Rows, Runner } from "./runner";

/*
 * How a MySQL database is laid out, from information_schema, with no tokens: the connected database's
 * tables and views, each column's type (an enum's labels from its COLUMN_TYPE), keys from
 * KEY_COLUMN_USAGE, the engine's row estimates, never a count. Status-like columns are sampled as on
 * Postgres (a capped scan, never a personal column).
 */

const TABLES = `SELECT t.TABLE_SCHEMA AS sch, t.TABLE_NAME AS name, t.TABLE_TYPE AS kind, t.TABLE_ROWS AS estimate, t.TABLE_COMMENT AS comment,
  c.COLUMN_NAME AS col, c.COLUMN_TYPE AS type, c.DATA_TYPE AS dtype, c.IS_NULLABLE AS nullable, c.COLUMN_COMMENT AS col_comment, c.COLUMN_KEY AS ckey, c.ORDINAL_POSITION AS pos
FROM information_schema.TABLES t
JOIN information_schema.COLUMNS c ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
WHERE t.TABLE_SCHEMA = DATABASE()
ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION`;

const KEYS = `SELECT k.TABLE_NAME AS name, k.COLUMN_NAME AS col, k.CONSTRAINT_NAME AS cname, k.REFERENCED_TABLE_SCHEMA AS ref_schema, k.REFERENCED_TABLE_NAME AS ref_name, k.REFERENCED_COLUMN_NAME AS ref_col
FROM information_schema.KEY_COLUMN_USAGE k
WHERE k.TABLE_SCHEMA = DATABASE()`;

const NUMBERS = new Set(["tinyint", "smallint", "mediumint", "int", "integer", "bigint", "decimal", "numeric", "float", "double", "real"]);

const asObjects = (r: Rows) => r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c.name, row[i]])) as Record<string, unknown>);
const s = (v: unknown) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

/** An enum's (or a set's) labels, from its COLUMN_TYPE: enum('a','b''s'). */
export function enumLabels(type: string): string[] {
  const m = /^(?:enum|set)\((.*)\)$/i.exec(type.trim());
  if (!m) return [];
  return [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'"));
}

export async function readMysqlLayout(r: Runner, o: { emit?: (label: string) => void; signal?: AbortSignal; version?: string; now?: number } = {}): Promise<Layout> {
  o.emit?.("Reading its tables and columns");
  const tables = new Map<string, LayoutTable>();
  for (const row of asObjects(await r.read(TABLES, { rows: 20_000, signal: o.signal }))) {
    const schema = s(row.sch);
    const name = s(row.name);
    if (!safeName(schema) || !safeName(name)) continue;
    const key = `${schema}.${name}`;
    let t = tables.get(key);
    if (!t) {
      const view = /VIEW/i.test(s(row.kind));
      const est = Number(row.estimate);
      t = { schema, name, ...(view ? { view: true } : {}), rows: !view && row.estimate !== null && Number.isFinite(est) && est >= 0 ? Math.round(est) : null, ...(s(row.comment) ? { comment: s(row.comment) } : {}), columns: [] };
      tables.set(key, t);
    }
    const col = s(row.col);
    if (!safeName(col)) continue;
    const type = s(row.type);
    const labels = enumLabels(type);
    const personal = personalOf(col, name);
    t.columns.push({ name: col, type, nullable: s(row.nullable) === "YES", ...(s(row.col_comment) ? { comment: s(row.col_comment) } : {}), ...(labels.length ? { labels } : {}), ...(personal ? { personal } : {}), ...(NUMBERS.has(s(row.dtype).toLowerCase()) ? { numeric: true } : {}), ...(s(row.ckey) === "PRI" ? { primary: true } : {}) });
  }
  o.emit?.("Reading its keys");
  for (const k of asObjects(await r.read(KEYS, { rows: 20_000, signal: o.signal }))) {
    const t = tables.get(`${r.home}.${s(k.name)}`);
    const c = t?.columns.find((x) => x.name === s(k.col));
    if (!c) continue;
    if (s(k.cname) === "PRIMARY") c.primary = true;
    else if (k.ref_name) c.ref = `${s(k.ref_schema) || r.home}.${s(k.ref_name)}.${s(k.ref_col) || "id"}`;
  }
  const layout: Layout = { dialect: "mysql", home: r.home, ...(o.version ? { version: o.version } : {}), at: o.now ?? Date.now(), tables: [...tables.values()] };
  await sampleValues(r, layout, o);
  return layout;
}
