/*
 * What the database itself says about a query before it runs (pure): EXPLAIN's plan, read for the
 * tables and columns it reads and what it would cost. That's the database's own reading of the
 * query, so it's what decides which columns a metric reads, never the model's word. And a database's
 * error, made safe to show the model for a repair: an error can carry a row's value ('invalid input
 * syntax for type integer: "sara@x.com"'), so only names the model already has stay readable.
 */

export interface PlanRead {
  /** "schema.table" for each table the plan reads. */
  tables: string[];
  /** "schema.table.column" for each column it reads. */
  columns: string[];
  /** The planner's estimate for the whole query, in its own units. */
  cost: number;
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const unquote = (s: string) => (s.startsWith('"') ? s.slice(1, -1).replace(/""/g, '"') : s);

/** Expressions a Postgres plan node may hold, each read for "alias.column". */
const EXPR_KEYS = ["Output", "Filter", "Index Cond", "Recheck Cond", "Join Filter", "Hash Cond", "Merge Cond", "Sort Key", "Group Key", "Presorted Key", "One-Time Filter", "Cache Key", "Run Condition"];
const REF = /((?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*))\.((?:"(?:[^"]|"")+"|[A-Za-z_][\w$]*))/g;

/**
 * Postgres's EXPLAIN (FORMAT JSON, VERBOSE): its relations by alias, then every alias.column in its
 * expressions. A scan's own output can be every column of its table (a physical target list), so
 * it's left out; with one table in the plan, Postgres doesn't qualify names, and each bare name is
 * that table's (the caller keeps only real columns).
 */
export function postgresPlan(json: unknown): PlanRead {
  const top = rec(Array.isArray(json) ? json[0] : json);
  const root = rec(top.Plan);
  const aliases = new Map<string, string>();
  const exprs: string[] = [];
  const walk = (n: Record<string, unknown>) => {
    const rel = typeof n["Relation Name"] === "string" ? (n["Relation Name"] as string) : null;
    if (rel) {
      const table = `${typeof n.Schema === "string" ? n.Schema : "public"}.${rel}`;
      aliases.set(typeof n.Alias === "string" ? n.Alias : rel, table);
      aliases.set(rel, aliases.get(rel) ?? table);
    }
    for (const k of EXPR_KEYS) {
      if (rel && k === "Output") continue;
      const v = n[k];
      if (typeof v === "string") exprs.push(v);
      else if (Array.isArray(v)) exprs.push(...v.filter((x): x is string => typeof x === "string"));
    }
    for (const p of Array.isArray(n.Plans) ? n.Plans : []) walk(rec(p));
  };
  walk(root);
  const columns = new Set<string>();
  const tables = [...new Set(aliases.values())];
  for (const e of exprs) {
    for (const m of e.matchAll(REF)) {
      const table = aliases.get(unquote(m[1]));
      if (table) columns.add(`${table}.${unquote(m[2])}`);
    }
    if (tables.length === 1)
      for (const m of e.replace(/'(?:[^']|'')*'/g, "''").matchAll(/(?<![\w$."])("(?:[^"]|"")+"|[A-Za-z_][\w$]*)(?![\w$."(])/g)) columns.add(`${tables[0]}.${unquote(m[1])}`);
  }
  return { tables, columns: [...columns], cost: typeof root["Total Cost"] === "number" ? root["Total Cost"] : 0 };
}

/**
 * MySQL's EXPLAIN FORMAT=JSON. Its second format (MySQL 8.3 and later) names each table, its schema
 * and its alias, with the columns it reads and the plan's total cost. The first names a table only by
 * the alias the query gave it, so the query's own aliases (code's guard reads them) say which table.
 */
export function mysqlPlan(json: unknown, database: string, aliases: Readonly<Record<string, { schema?: string; name: string }>> = {}): PlanRead {
  const tables = new Set<string>();
  const columns = new Set<string>();
  const top = rec(json);
  let cost = typeof top.estimated_total_cost === "number" ? top.estimated_total_cost : 0;
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    const o = rec(v);
    if (!Object.keys(o).length) return;
    const qb = rec(o.query_block);
    const ci = rec(qb.cost_info);
    if (typeof ci.query_cost === "string" && !cost) cost = Number(ci.query_cost) || 0;
    if (typeof o.table_name === "string" && !o.table_name.startsWith("<")) {
      // A derived table (<derived2>) or a union's temporary isn't a table of theirs.
      const named = typeof o.schema_name === "string" ? { schema: o.schema_name, name: o.table_name } : aliases[o.table_name] ?? { name: o.table_name };
      const table = `${named.schema ?? database}.${named.name}`;
      tables.add(table);
      for (const c of Array.isArray(o.used_columns) ? o.used_columns : []) if (typeof c === "string") columns.add(`${table}.${c}`);
    }
    for (const x of Object.values(o)) if (x && typeof x === "object") walk(x);
  };
  walk(json);
  return { tables: [...tables], columns: [...columns], cost };
}

/**
 * A database's error as the model may hear it, to fix a draft: its code and message, with every
 * quoted part masked unless it's a name the model already has (the layout's, or a word of its own
 * query). Never the error's detail, hint or where: those quote rows.
 */
export function errorForModel(e: { code?: string; message: string }, known: ReadonlySet<string>): string {
  const masked = e.message
    .replace(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g, (all, dq: string | undefined, sq: string | undefined) => {
      const inner = (dq ?? sq ?? "").toLowerCase();
      return known.has(inner) ? all : dq !== undefined ? '"…"' : "'…'";
    })
    .replace(/\b\d{6,}\b/g, "…")
    .slice(0, 300);
  return e.code ? `${e.code}: ${masked}` : masked;
}

/** The words a query names itself (its identifiers and literals), which its own error may quote back. */
export function ownWords(sql: string): Set<string> {
  const out = new Set<string>();
  for (const m of sql.matchAll(/'((?:[^']|'')*)'|"((?:[^"]|"")*)"|`([^`]*)`|([A-Za-z_][\w$]*)/g)) out.add((m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").replace(/''/g, "'").toLowerCase());
  return out;
}
