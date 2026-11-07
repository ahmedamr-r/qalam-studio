/*
 * Code's guard on a query before it ever runs against a team's database (pure). It's one layer of
 * several (a read-only user, a read-only transaction, the database's own EXPLAIN), never the only
 * one, so it's strict rather than clever: one statement that starts with SELECT or WITH, no comments
 * that run code (MySQL's /*! and /*+), no strings that escape in ways the two dialects disagree on,
 * no words that change anything or take a lock, and function calls only from a short list of
 * aggregates, dates, maths, strings and casts, so nothing like query_to_xml, dblink or pg_sleep can
 * run SQL of its own or wait. It hands back the query with its comments taken out, safe to wrap,
 * and the tables it names, for checking against what the database was read to hold.
 */

export type Dialect = "postgres" | "mysql";

export interface TableRef {
  schema?: string;
  name: string;
}

export type Guarded = { ok: true; sql: string; tables: TableRef[]; functions: string[] } | { ok: false; why: string };

/** Longest query taken: a metric's, not a report's. */
export const SQL_MAX = 6000;

type Tok =
  | { t: "word"; v: string; quoted: boolean; at: number }
  | { t: "str"; at: number }
  | { t: "num"; at: number }
  | { t: "op"; v: string; at: number };

/** Words that change data, its shape or the session, take a lock, or end a statement. Never part of a read. */
const DENIED = new Set([
  // Changing data, inside a WITH too (Postgres runs data-modifying CTEs), and writing what's read somewhere.
  "insert", "update", "delete", "merge", "upsert", "replace", "into", "outfile", "dumpfile", "returning",
  // Locks: FOR UPDATE, FOR SHARE, LOCK IN SHARE MODE, NOWAIT.
  "share", "lock", "nowait",
  // Statements of their own: never inside a read, refused in case a parser reads it otherwise.
  "create", "alter", "drop", "truncate", "grant", "revoke", "copy", "call", "do", "execute", "exec", "prepare", "deallocate",
  "vacuum", "analyze", "analyse", "cluster", "reindex", "refresh", "set", "reset", "listen", "notify", "unlisten", "handler",
  "begin", "commit", "rollback", "savepoint", "checkpoint", "declare", "kill", "shutdown", "discard",
]);

/** Words that may be followed by "(" without being a function call. */
const PAREN_WORDS = new Set([
  "in", "exists", "any", "all", "some", "values", "over", "filter", "within", "as", "using", "on", "and", "or", "not",
  "when", "then", "else", "from", "join", "lateral", "select", "with", "where", "having", "by", "case", "is", "between",
  "like", "ilike", "union", "intersect", "except", "distinct", "array", "row", "partition", "group", "order", "limit",
  "offset", "fetch", "tablesample", "recursive", "materialized", "interval", "rows", "range", "groups", "end",
  "sets", "rollup", "cube", "system", "bernoulli", "if",
]);

/** Types a cast may name, with a size in parentheses ("numeric(12, 2)"). */
const TYPES = new Set([
  "numeric", "decimal", "varchar", "char", "character", "nchar", "nvarchar", "bit", "float", "timestamp", "timestamptz",
  "time", "timetz", "datetime", "real", "double", "precision", "signed", "unsigned", "integer", "int", "bigint", "smallint",
  "text", "date", "boolean", "bool", "money", "json", "jsonb", "uuid",
]);

/** The functions a metric may call: aggregates, windows, dates, maths, strings, conditionals, casts. Nothing that reads files, calls out, sleeps, locks or runs SQL of its own. */
export const FUNCTIONS = new Set([
  // aggregates
  "count", "sum", "avg", "min", "max", "bool_and", "bool_or", "every", "string_agg", "array_agg", "group_concat",
  "percentile_cont", "percentile_disc", "mode", "stddev", "stddev_pop", "stddev_samp", "variance", "var_pop", "var_samp",
  "median", "approx_count_distinct", "json_agg", "jsonb_agg", "json_arrayagg",
  // windows
  "row_number", "rank", "dense_rank", "ntile", "lag", "lead", "first_value", "last_value", "nth_value", "cume_dist", "percent_rank",
  // conditionals and nulls
  "coalesce", "nullif", "greatest", "least", "if", "ifnull", "isnull",
  // maths
  "round", "floor", "ceil", "ceiling", "abs", "sign", "trunc", "truncate", "mod", "power", "pow", "sqrt", "exp", "ln", "log", "log10", "div",
  // casts
  "cast", "convert", "to_number", "to_char", "to_date", "to_timestamp",
  // dates
  "extract", "date_part", "date_trunc", "now", "current_date", "current_timestamp", "localtimestamp", "age", "make_interval",
  "make_date", "date", "year", "month", "day", "week", "quarter", "dayofweek", "dayofmonth", "dayofyear", "weekday", "hour",
  "minute", "date_format", "date_add", "date_sub", "datediff", "timestampdiff", "timestampadd", "adddate", "subdate", "curdate",
  "curtime", "utc_timestamp", "unix_timestamp", "from_unixtime", "str_to_date", "last_day", "makedate", "generate_series",
  "yearweek", "isodow", "timezone", "convert_tz",
  // strings
  "lower", "upper", "length", "char_length", "character_length", "substring", "substr", "left", "right", "trim", "ltrim",
  "rtrim", "btrim", "concat", "concat_ws", "position", "strpos", "split_part", "starts_with", "lpad", "rpad", "regexp_replace",
  "regexp_like", "locate", "instr", "md5", "replace", "grouping",
  // json and arrays, reading only
  "json_extract", "json_unquote", "json_extract_path_text", "jsonb_extract_path_text", "array_length", "cardinality", "unnest",
]);

const lower = (s: string) => s.toLowerCase();
const isWordStart = (ch: string) => /[A-Za-z_]/.test(ch) || ch.charCodeAt(0) > 127;
const isWordChar = (ch: string) => /[A-Za-z0-9_$]/.test(ch) || ch.charCodeAt(0) > 127;

/** The query as tokens, with its comments gone; or why it can't be read safely. */
function tokenize(sql: string, d: Dialect): { toks: Tok[]; text: string } | { why: string } {
  const toks: Tok[] = [];
  // The text again, comments as a space, so it can be wrapped without a comment swallowing the wrapper.
  let text = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1] ?? "";
    if (/\s/.test(ch)) {
      text += ch;
      i++;
      continue;
    }
    // Comments: "--" in Postgres; "-- " (a space after) or "#" in MySQL, where "--1" is two minuses.
    if (ch === "-" && next === "-" && (d === "postgres" || /\s/.test(sql[i + 2] ?? "\n"))) {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? n : end;
      text += " ";
      continue;
    }
    if (ch === "#" && d === "mysql") {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? n : end;
      text += " ";
      continue;
    }
    if (ch === "/" && next === "*") {
      // MySQL runs what's inside /*! … */, and /*+ … */ steers the planner.
      if (d === "mysql" && (sql[i + 2] === "!" || sql[i + 2] === "+")) return { why: "it has a comment MySQL would run as code" };
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        // Postgres nests block comments; MySQL doesn't, so a nested one there is refused rather than guessed.
        if (sql[j] === "/" && sql[j + 1] === "*") {
          if (d === "mysql") return { why: "it has a comment inside a comment" };
          depth++;
          j += 2;
        } else if (sql[j] === "*" && sql[j + 1] === "/") {
          depth--;
          j += 2;
        } else j++;
      }
      if (depth > 0) return { why: "a comment in it never ends" };
      i = j;
      text += " ";
      continue;
    }
    // Strings: '…' only, with '' for a quote inside, and no backslash at all. The two dialects (and
    // a server's settings) read a backslash differently, which is how a string hides its own end.
    // A prefix (E'…', U&'…', B'…', X'…', N'…') changes how a string escapes: refused.
    if (ch === "'") {
      let j = i + 1;
      for (;;) {
        if (j >= n) return { why: "a string in it never ends" };
        const c = sql[j];
        if (c === "\\") return { why: "it has a backslash inside a string" };
        if (c === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      toks.push({ t: "str", at: i });
      text += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    // MySQL reads "…" as a string, or as a name with ANSI_QUOTES: refused rather than guessed.
    if (ch === '"' && d === "mysql") return { why: "it has a double-quoted string (use single quotes)" };
    // Quoted names: "…" in Postgres, `…` in MySQL.
    if ((ch === '"' && d === "postgres") || (ch === "`" && d === "mysql")) {
      let j = i + 1;
      let name = "";
      for (;;) {
        if (j >= n) return { why: "a quoted name in it never ends" };
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) {
            name += ch;
            j += 2;
            continue;
          }
          break;
        }
        name += sql[j];
        j++;
      }
      if (!name) return { why: "it has an empty quoted name" };
      toks.push({ t: "word", v: name, quoted: true, at: i });
      text += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === "`") return { why: "it quotes a name the way MySQL does, not Postgres" };
    // Dollar-quoted strings and parameters: never part of a metric.
    if (ch === "$") return { why: "it has a $ (a parameter or a dollar-quoted string)" };
    if (ch === "?" && d === "mysql") return { why: "it has a ? (a parameter)" };
    // Variables (@x, @@version) and assignments.
    if (ch === "@") return { why: "it reads or sets a variable (@)" };
    if (ch === ":" && next === "=") return { why: "it assigns a variable (:=)" };
    if (ch === "\\") return { why: "it has a backslash outside a string" };
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(next))) {
      let j = i + 1;
      while (j < n && /[0-9.eE_]/.test(sql[j])) {
        if ((sql[j] === "e" || sql[j] === "E") && (sql[j + 1] === "+" || sql[j + 1] === "-")) j++;
        j++;
      }
      toks.push({ t: "num", at: i });
      text += sql.slice(i, j);
      i = j;
      continue;
    }
    if (isWordStart(ch)) {
      let j = i + 1;
      while (j < n && isWordChar(sql[j])) j++;
      const v = sql.slice(i, j);
      // A string prefix right before a quote: E'…', B'…', X'…', N'…', U&'…'.
      if (sql[j] === "'" || (sql[j] === "&" && sql[j + 1] === "'")) return { why: `it has a ${v}'…' string, which escapes differently` };
      if (d === "postgres" && v.includes("$")) return { why: "it has a $ (a parameter or a dollar-quoted string)" };
      toks.push({ t: "word", v, quoted: false, at: i });
      text += v;
      i = j;
      continue;
    }
    if (ch.charCodeAt(0) < 32) return { why: "it has a control character" };
    // Operators and punctuation, longest first.
    const two = sql.slice(i, i + 2);
    const three = sql.slice(i, i + 3);
    const op = ["->>", "#>>"].includes(three) ? three : ["::", "<=", ">=", "<>", "!=", "||", "->", "#>", "<<", ">>", "&&", "@>", "<@"].includes(two) ? two : ch;
    toks.push({ t: "op", v: op, at: i });
    text += op;
    i += op.length;
  }
  return { toks, text };
}

const word = (t: Tok | undefined): string | null => (t?.t === "word" && !t.quoted ? lower(t.v) : null);
const isOp = (t: Tok | undefined, v: string) => t?.t === "op" && t.v === v;

/** The tables a query reads (after FROM and JOIN, comma lists included), its own CTE names apart. */
function tablesOf(toks: Tok[]): { tables: TableRef[]; ctes: Set<string> } | { why: string } {
  const ctes = new Set<string>();
  // CTE names: WITH [RECURSIVE] name [(cols)] AS (…), name AS (…)
  for (let i = 0; i < toks.length; i++) {
    const w = word(toks[i]);
    if (w !== "with" && !(isOp(toks[i], ",") && ctes.size && depthAt(toks, i) === 0)) continue;
    let j = i + 1;
    if (word(toks[j]) === "recursive") j++;
    const name = toks[j];
    if (name?.t !== "word") continue;
    let k = j + 1;
    if (isOp(toks[k], "(")) k = closeOf(toks, k) + 1;
    if (word(toks[k]) === "as") {
      if (word(toks[k + 1]) === "not" || word(toks[k + 1]) === "materialized") k++;
      if (word(toks[k + 1]) === "materialized") k++;
      if (isOp(toks[k + 1], "(")) ctes.add(lower(name.v));
    }
  }
  const tables: TableRef[] = [];
  const read = (i: number): number => {
    // A table name, maybe schema-qualified, then an alias. "(" is a subquery or a function's rows; LATERAL too.
    let j = i;
    if (word(toks[j]) === "lateral" || word(toks[j]) === "only") j++;
    const a = toks[j];
    if (!a || a.t !== "word" || isOp(toks[j + 1], "(")) return j;
    if (isOp(toks[j + 1], ".")) {
      const b = toks[j + 2];
      if (b?.t !== "word") return j;
      if (isOp(toks[j + 3], ".")) return -1; // a third part: another database
      tables.push({ schema: a.quoted ? a.v : lower(a.v), name: b.quoted ? b.v : lower(b.v) });
      return j + 3;
    }
    if (!ctes.has(lower(a.v))) tables.push({ name: a.quoted ? a.v : lower(a.v) });
    return j + 1;
  };
  for (let i = 0; i < toks.length; i++) {
    const w = word(toks[i]);
    if (w !== "from" && w !== "join") continue;
    // "FROM" inside EXTRACT(… FROM …), SUBSTRING(… FROM …), TRIM(… FROM …) names no table.
    if (w === "from" && insideCall(toks, i)) continue;
    let j = read(i + 1);
    if (j < 0) return { why: "it reads a table in another database" };
    if (w !== "from") continue;
    // A comma list: FROM a x, b y
    for (;;) {
      while (j < toks.length && !isOp(toks[j], ",") && !isOp(toks[j], ")") && !STOP.has(word(toks[j]) ?? "")) j = isOp(toks[j], "(") ? closeOf(toks, j) + 1 : j + 1;
      if (!isOp(toks[j], ",")) break;
      j = read(j + 1);
      if (j < 0) return { why: "it reads a table in another database" };
    }
  }
  return { tables, ctes };
}

/** Words that end a FROM list. */
const STOP = new Set(["where", "group", "order", "limit", "having", "union", "intersect", "except", "join", "left", "right", "inner", "full", "cross", "natural", "on", "using", "window", "offset", "fetch", "qualify", "tablesample"]);

function closeOf(toks: Tok[], open: number): number {
  let depth = 0;
  for (let i = open; i < toks.length; i++) {
    if (isOp(toks[i], "(")) depth++;
    else if (isOp(toks[i], ")") && --depth === 0) return i;
  }
  return toks.length - 1;
}

function depthAt(toks: Tok[], at: number): number {
  let depth = 0;
  for (let i = 0; i < at; i++) {
    if (isOp(toks[i], "(")) depth++;
    else if (isOp(toks[i], ")")) depth--;
  }
  return depth;
}

/** Whether a token sits right inside a function call's parentheses (EXTRACT(YEAR FROM x)). */
function insideCall(toks: Tok[], at: number): boolean {
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    if (isOp(toks[i], ")")) depth++;
    else if (isOp(toks[i], "(")) {
      if (depth === 0) {
        const w = word(toks[i - 1]);
        return !!w && FUNCTIONS.has(w);
      }
      depth--;
    }
  }
  return false;
}

/** Check a query before it runs: one read, nothing else. */
export function guardSql(raw: string, d: Dialect): Guarded {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, why: "there's no query" };
  if (raw.length > SQL_MAX) return { ok: false, why: `it's longer than ${SQL_MAX} characters` };
  if (raw.includes("\u0000")) return { ok: false, why: "it has a NUL character" };
  const read = tokenize(raw, d);
  if ("why" in read) return { ok: false, why: read.why };
  let toks = read.toks;
  let text = read.text.trim();
  // One statement: a semicolon only at the very end.
  while (toks.length && isOp(toks[toks.length - 1], ";")) {
    toks = toks.slice(0, -1);
    text = text.replace(/;\s*$/, "").trim();
  }
  if (!toks.length) return { ok: false, why: "there's no query" };
  if (toks.some((t) => isOp(t, ";"))) return { ok: false, why: "it's more than one statement" };
  const first = word(toks[0]);
  if (first !== "select" && first !== "with") return { ok: false, why: "it doesn't start with SELECT or WITH" };
  let depth = 0;
  const functions = new Set<string>();
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (isOp(t, "(")) depth++;
    else if (isOp(t, ")")) {
      if (--depth < 0) return { ok: false, why: "its parentheses don't match" };
    }
    if (t.t !== "word" || t.quoted) continue;
    const w = lower(t.v);
    const call = isOp(toks[i + 1], "(");
    const afterCast = isOp(toks[i - 1], "::");
    // Names with their columns aren't calls: an alias (AS g(n)), or a CTE (WITH n(i) AS (…)).
    const before = word(toks[i - 1]);
    const shut = call ? closeOf(toks, i + 1) : -1;
    // A CTE's AS is followed by its body, "(" (or MATERIALIZED): a select item's "f(x) AS n" never is.
    const cte = call && (before === "with" || before === "recursive" || isOp(toks[i - 1], ",")) && word(toks[shut + 1]) === "as" && (isOp(toks[shut + 2], "(") || word(toks[shut + 2]) === "materialized" || word(toks[shut + 2]) === "not");
    const named = call && (before === "as" || cte);
    if (call && !afterCast && !named && !PAREN_WORDS.has(w) && !TYPES.has(w)) {
      // A qualified call (schema.fn(…)) could reach anything: never.
      if (isOp(toks[i - 1], ".")) return { ok: false, why: `it calls ${toks[i - 2]?.t === "word" ? (toks[i - 2] as { v: string }).v : "a"}.${t.v}(), a function in a schema` };
      if (!FUNCTIONS.has(w)) return { ok: false, why: `it calls ${t.v}(), which isn't one Qalam lets a metric use` };
      functions.add(w);
      continue;
    }
    if (DENIED.has(w) && !(call && FUNCTIONS.has(w))) return { ok: false, why: `it has ${t.v.toUpperCase()} in it, which isn't part of a read` };
  }
  if (depth !== 0) return { ok: false, why: "its parentheses don't match" };
  const tables = tablesOf(toks);
  if ("why" in tables) return { ok: false, why: tables.why };
  if (!tables.tables.length && !/\bfrom\b/i.test(text)) return { ok: false, why: "it reads no table" };
  return { ok: true, sql: text, tables: tables.tables, functions: [...functions] };
}

/** A checked query, wrapped so the database hands back at most `rows` rows, whatever it says inside. */
export function wrapped(sql: string, rows: number): string {
  return `SELECT * FROM (\n${sql}\n) AS qalam_q LIMIT ${Math.max(1, Math.floor(rows))}`;
}

/** A table's name as the layout writes it: "schema.name", or "name" where there's no schema (MySQL's own database). */
export const tableKey = (t: TableRef, defaultSchema: string) => `${t.schema ?? defaultSchema}.${t.name}`;
