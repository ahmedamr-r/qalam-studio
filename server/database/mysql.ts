import mysql from "mysql2/promise";
import type { Connection } from "@/database/connection";
import { mysqlPlan } from "@/database/plan";
import { guardSql, wrapped } from "@/database/sql";
import { DatabaseError, GRACE_MS, READ_MS, type ReadOpts, type Rights, type Rows, type Runner } from "./runner";

/*
 * A MySQL (or MariaDB) database, read straight from the core (mysql2). One connection per use, one
 * statement per query (multipleStatements stays off), and every read inside a read-only transaction
 * on a read-only session (a DDL statement commits on its own, so the session's read-only matters too).
 * The server stops a SELECT past its time (MAX_EXECUTION_TIME; MariaDB's max_statement_time); past
 * that and a grace, the client kills the query from a second connection and drops its own.
 */

/** Field types mysql2 reports that are numbers: DECIMAL, TINY, SHORT, LONG, FLOAT, DOUBLE, LONGLONG, INT24, YEAR, NEWDECIMAL. */
const NUMERIC = new Set([0, 1, 2, 3, 4, 5, 8, 9, 13, 246]);

export interface MysqlTarget {
  conn: Connection;
  ca?: string;
}

function config(t: MysqlTarget): mysql.ConnectionOptions {
  const c = t.conn;
  return {
    host: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
    database: c.database,
    ...(c.tls ? { ssl: { rejectUnauthorized: true, ...(t.ca ? { ca: t.ca } : {}) } } : {}),
    connectTimeout: 10_000,
    multipleStatements: false,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
  };
}

const CERT = /CERT|certificate|self[- ]signed|UNABLE_TO_VERIFY|ALTNAME/i;

export function mysqlConnectError(e: unknown, c: Connection): DatabaseError {
  const err = e as { code?: string; message?: string };
  const m = err.message ?? String(e);
  const code = err.code;
  if (code === "ECONNREFUSED") return new DatabaseError(`Nothing answered at ${c.host}:${c.port}. Is the database running, and is that its port?`, code, m);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new DatabaseError(`This computer can't find a host called ${c.host}.`, code, m);
  if (code === "ETIMEDOUT") return new DatabaseError(`${c.host} took too long to answer. Is this computer allowed to reach it (an allow-list, a VPN)?`, code, m);
  if (code === "ER_ACCESS_DENIED_ERROR") return new DatabaseError("The database didn't take that user and password.", code, m);
  if (code === "ER_BAD_DB_ERROR") return new DatabaseError(`There's no database called ${c.database} there.`, code, m);
  if (/does not support (secure|SSL)|HANDSHAKE_NO_SSL_SUPPORT/i.test(`${code} ${m}`)) return new DatabaseError("That database doesn't take TLS. Qalam reaches one on another computer only over TLS.", code, m);
  if (CERT.test(code ?? "") || CERT.test(m)) return new DatabaseError("Qalam couldn't check the server's certificate. Add its CA certificate.", code, m);
  return new DatabaseError(`Couldn't connect: ${m}`, code, m);
}

export function mysqlReadError(e: unknown, ms: number): DatabaseError {
  if (e instanceof DatabaseError) return e;
  const err = e as { code?: string; message?: string; errno?: number };
  const m = err.message ?? String(e);
  const code = err.code;
  if (code === "ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION" || err.errno === 1792) return new DatabaseError("It tried to change something, and the read-only transaction stopped it.", code, m);
  if (code === "ER_QUERY_TIMEOUT" || err.errno === 3024 || err.errno === 1969 || code === "PROTOCOL_SEQUENCE_TIMEOUT") return new DatabaseError(`It took longer than ${Math.round(ms / 1000)} seconds, so the database stopped it.`, code, m);
  if (code === "ER_LOCK_WAIT_TIMEOUT") return new DatabaseError("A table it reads was locked, and it doesn't wait long. Try again in a moment.", code, m);
  if (code === "ER_TABLEACCESS_DENIED_ERROR" || code === "ER_COLUMNACCESS_DENIED_ERROR") return new DatabaseError(`This user isn't allowed to read that: ${m}`, code, m);
  return new DatabaseError(m, code, m);
}

/** Privileges that change data or the database (temporary tables and reading process lists aside). */
const WRITE = /\b(ALL PRIVILEGES|INSERT|UPDATE|DELETE|CREATE(?! TEMPORARY)|DROP|ALTER|INDEX|TRIGGER|EVENT|SUPER|FILE|EXECUTE|REFERENCES|CREATE ROUTINE|ALTER ROUTINE|CREATE VIEW|LOCK TABLES|RELOAD|SHUTDOWN|GRANT OPTION)\b/i;

/** What SHOW GRANTS says the user may change: each grant line that holds a writing privilege, by what it's on. */
export function grantWrites(lines: readonly string[]): { writes: string[]; superuser: boolean } {
  const writes: string[] = [];
  let superuser = false;
  for (const line of lines) {
    const m = /^GRANT\s+(.+?)\s+ON\s+(\S+)\s+TO\b/i.exec(line.trim());
    if (!m) continue;
    const privs = m[1];
    const on = m[2].replace(/`/g, "");
    if (/\b(ALL PRIVILEGES|SUPER)\b/i.test(privs) && on === "*.*") superuser = true;
    if (WRITE.test(privs.replace(/\bCREATE TEMPORARY TABLES\b/gi, ""))) writes.push(on);
  }
  return { writes: [...new Set(writes)], superuser };
}

/** Roles granted to the user, from SHOW GRANTS (`role`@`host` TO …). */
const rolesIn = (lines: readonly string[]) => lines.flatMap((l) => (/^GRANT\s+(`[^`]+`@`[^`]+`(?:\s*,\s*`[^`]+`@`[^`]+`)*)\s+TO\b/i.exec(l.trim())?.[1] ?? "").split(/\s*,\s*/).filter(Boolean));

export async function openMysql(t: MysqlTarget): Promise<Runner> {
  const cfg = config(t);
  const conn = await mysql.createConnection(cfg).catch((e: unknown) => Promise.reject(mysqlConnectError(e, t.conn)));
  conn.on("error", () => {});
  const version = String(((await conn.query("SELECT VERSION() AS v"))[0] as { v: string }[])[0]?.v ?? "");
  const maria = /mariadb/i.test(version);
  await conn.query("SET SESSION TRANSACTION READ ONLY");
  // EXPLAIN's second JSON format names each table (MySQL 8.3 and later); the first names aliases only.
  await conn.query("SET SESSION explain_json_format_version = 2").catch(() => {});
  let dead = false;
  let queue: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run);
    queue = next.catch(() => {});
    return next;
  };
  const stop = () => {
    if (dead) return;
    dead = true;
    const id = conn.threadId;
    conn.destroy();
    void mysql
      .createConnection(cfg)
      .then(async (other) => {
        other.on("error", () => {});
        await other.query(`KILL QUERY ${Number(id)}`).catch(() => {});
        await other.end().catch(() => {});
      })
      .catch(() => {});
  };
  const inReadOnly = <T>(ms: number, signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> =>
    inTurn(async () => {
      if (dead) throw new DatabaseError("The connection to the database was closed.");
      if (signal?.aborted) throw new DatabaseError("Stopped.");
      await conn.query(maria ? `SET SESSION max_statement_time = ${Math.max(1, ms) / 1000}` : `SET SESSION MAX_EXECUTION_TIME = ${Math.max(1, Math.floor(ms))}`);
      await conn.query("START TRANSACTION READ ONLY");
      try {
        const work = fn();
        work.catch(() => {});
        let timer: ReturnType<typeof setTimeout> | undefined;
        let onAbort: (() => void) | undefined;
        const late = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new DatabaseError(`It took longer than ${Math.round(ms / 1000)} seconds, so Qalam stopped it.`, "ER_QUERY_TIMEOUT"));
            stop();
          }, ms + GRACE_MS);
          onAbort = () => {
            reject(new DatabaseError("Stopped."));
            stop();
          };
          signal?.addEventListener("abort", onAbort, { once: true });
        });
        try {
          return await Promise.race([work, late]);
        } finally {
          clearTimeout(timer);
          if (onAbort) signal?.removeEventListener("abort", onAbort);
        }
      } catch (e) {
        throw mysqlReadError(e, ms);
      } finally {
        if (!dead) await conn.query("ROLLBACK").catch(() => {});
      }
    });

  return {
    kind: "mysql",
    dialect: "mysql",
    where: t.conn.where,
    home: t.conn.database,
    read: (sql: string, o: ReadOpts = {}): Promise<Rows> => {
      const ms = o.timeoutMs ?? READ_MS;
      return inReadOnly(ms, o.signal, async () => {
        const [rows, fields] = await conn.query({ sql: wrapped(sql, o.rows ?? 1000), rowsAsArray: true });
        return { columns: (fields ?? []).map((f) => ({ name: f.name, numeric: NUMERIC.has(f.columnType ?? f.type ?? -1) })), rows: rows as unknown[][] };
      });
    },
    explain: (sql: string, o: ReadOpts = {}) =>
      inReadOnly(o.timeoutMs ?? READ_MS, o.signal, async () => {
        const [rows] = await conn.query({ sql: `EXPLAIN FORMAT=JSON ${sql}`, rowsAsArray: true });
        const text = (rows as unknown[][])[0]?.[0];
        const g = guardSql(sql, "mysql");
        const aliases = Object.fromEntries((g.ok ? g.tables : []).flatMap((x) => (x.alias ? [[x.alias, x]] : [])));
        return mysqlPlan(typeof text === "string" ? JSON.parse(text) : text, t.conn.database, aliases);
      }),
    rights: (): Promise<Rights> =>
      inTurn(async () => {
        const user = String(((await conn.query("SELECT CURRENT_USER() AS u"))[0] as { u: string }[])[0]?.u ?? "");
        const grants = ((await conn.query({ sql: "SHOW GRANTS", rowsAsArray: true }))[0] as unknown[][]).map((r) => String(r[0]));
        const roles = rolesIn(grants);
        const all = roles.length ? [...grants, ...((await conn.query({ sql: `SHOW GRANTS FOR CURRENT_USER() USING ${roles.join(", ")}`, rowsAsArray: true }).catch(() => [[]]))[0] as unknown[][]).map((r) => String(r[0]))] : grants;
        const g = grantWrites(all);
        return { user: user.replace(/@.*$/, ""), superuser: g.superuser, writes: g.writes.slice(0, 6), writesCount: g.writes.length, hidden: [], version: version.split("-")[0] ? `${maria ? "MariaDB" : "MySQL"} ${version.split("-")[0]}` : version };
      }),
    close: async () => {
      dead = true;
      await Promise.race([conn.end().catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
    },
  };
}
