import pg from "pg";
import type { Connection } from "@/database/connection";
import { postgresPlan } from "@/database/plan";
import { wrapped } from "@/database/sql";
import { DatabaseError, GRACE_MS, READ_MS, type ReadOpts, type Rights, type Rows, type Runner } from "./runner";

/*
 * A Postgres database, read straight from the core (pg, no native module). One connection per use,
 * closed after. Every read is its own read-only transaction: the statement and lock timeouts are set
 * inside it (SET LOCAL, which a transaction pooler keeps, where startup options don't), row security
 * is off so a read that would quietly lose rows to a policy fails instead, the query is wrapped to a
 * row cap and sent by the extended protocol (one statement, whatever the text says), and it always
 * ends in ROLLBACK. Past its time the client asks the database to cancel it from a second connection,
 * closes the socket, and says so.
 */

/** Types pg reads as numbers: int8, int2, int4, oid, float4, float8, numeric. (money comes as text.) */
const NUMERIC = new Set([20, 21, 23, 26, 700, 701, 1700]);
const isIp = (h: string) => /^[\d.]+$/.test(h) || h.includes(":");

export interface PostgresTarget {
  conn: Connection;
  /** The server's CA certificate, when it isn't one this computer already trusts (Supabase's, RDS's). */
  ca?: string;
}

export function pgConfig(t: PostgresTarget): pg.ClientConfig {
  const c = t.conn;
  return {
    host: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
    database: c.database,
    ssl: c.tls ? { rejectUnauthorized: true, ...(isIp(c.host) ? {} : { servername: c.host }), ...(t.ca ? { ca: t.ca } : {}) } : false,
    connectionTimeoutMillis: 10_000,
    application_name: "Qalam Studio (read-only)",
  };
}

const CERT = /CERT|certificate|self[- ]signed|UNABLE_TO_VERIFY|ALTNAME/i;

/** A failure to connect, in words. */
export function connectError(e: unknown, c: Connection): DatabaseError {
  const err = e as { code?: string; message?: string };
  const m = err.message ?? String(e);
  const code = err.code;
  if (code === "ECONNREFUSED") return new DatabaseError(`Nothing answered at ${c.host}:${c.port}. Is the database running, and is that its port?`, code, m);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return new DatabaseError(`This computer can't find a host called ${c.host}.`, code, m);
  if (code === "ENETUNREACH" || code === "EHOSTUNREACH")
    return new DatabaseError(`This computer can't reach ${c.host}. ${c.host.endsWith(".supabase.co") ? "Supabase's direct address is IPv6 only: use the session pooler's string instead (Connect → Session pooler)." : "Is it on a network this computer isn't on?"}`, code, m);
  if (code === "ETIMEDOUT" || /timeout/i.test(m)) return new DatabaseError(`${c.host} took too long to answer. Is this computer allowed to reach it (an allow-list, a VPN)?`, code, m);
  if (code === "28P01" || code === "28000") return new DatabaseError("The database didn't take that user and password.", code, m);
  if (code === "3D000") return new DatabaseError(`There's no database called ${c.database} there.`, code, m);
  if (/does not support SSL/i.test(m)) return new DatabaseError("That database doesn't take TLS. Qalam reaches one on another computer only over TLS.", code, m);
  if (CERT.test(code ?? "") || CERT.test(m)) return new DatabaseError("Qalam couldn't check the server's certificate. Add its CA certificate (on Supabase: Database Settings → SSL Configuration → Download certificate).", code, m);
  return new DatabaseError(`Couldn't connect: ${m}`, code, m);
}

/** A failure inside a read, in words; the database's own message stays as `raw`. */
export function readError(e: unknown, ms: number): DatabaseError {
  if (e instanceof DatabaseError) return e;
  const err = e as { code?: string; message?: string };
  const m = err.message ?? String(e);
  const code = err.code;
  if (code === "25006") return new DatabaseError("It tried to change something, and the read-only transaction stopped it.", code, m);
  if (code === "57014") return new DatabaseError(`It took longer than ${Math.round(ms / 1000)} seconds, so the database stopped it.`, code, m);
  if (code === "55P03") return new DatabaseError("A table it reads was locked (perhaps a migration), and it doesn't wait more than 2 seconds. Try again in a moment.", code, m);
  const rls = /row-level security policy for table "([^"]+)"/.exec(m);
  if (rls) return new DatabaseError(`Row-level security hides rows of ${rls[1]} from this user, so a number there would come out short. Give the user BYPASSRLS, or connect as one that sees every row.`, code, m);
  if (code === "42501") return new DatabaseError(`This user isn't allowed to read that: ${m}`, code, m);
  return new DatabaseError(m, code, m);
}

export const WRITES = `SELECT n.nspname || '.' || c.relname AS t, count(*) OVER () AS n
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
  AND (has_table_privilege(c.oid, 'INSERT') OR has_table_privilege(c.oid, 'UPDATE') OR has_table_privilege(c.oid, 'DELETE') OR has_table_privilege(c.oid, 'TRUNCATE'))
ORDER BY 1 LIMIT 6`;

export const HIDDEN = `SELECT n.nspname || '.' || c.relname AS t
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p') AND c.relrowsecurity
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND has_table_privilege(c.oid, 'SELECT')
  AND NOT coalesce((SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), false)
  AND (c.relforcerowsecurity OR NOT pg_has_role(c.relowner, 'USAGE'))
ORDER BY 1 LIMIT 50`;

export const WHO = `SELECT current_user::text AS u, coalesce((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) AS su, version() AS v`;

export async function openPostgres(t: PostgresTarget): Promise<Runner> {
  const config = pgConfig(t);
  const client = new pg.Client(config);
  // A socket that drops between reads mustn't take the core down; the next read says so.
  client.on("error", () => {});
  await client.connect().catch((e: unknown) => Promise.reject(connectError(e, t.conn)));
  let dead = false;
  let queue: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run);
    queue = next.catch(() => {});
    return next;
  };

  /** Drop this connection, and ask the database to cancel what it was running from a second one (a socket closing alone doesn't stop a query). */
  const stop = () => {
    if (dead) return;
    dead = true;
    const pid = (client as unknown as { processID?: number }).processID;
    (client as unknown as { connection?: { stream?: { destroy(): void } } }).connection?.stream?.destroy();
    if (!pid) return;
    const other = new pg.Client(config);
    other.on("error", () => {});
    void other
      .connect()
      .then(() => other.query("SELECT pg_cancel_backend($1)", [pid]))
      .catch(() => {})
      .finally(() => other.end().catch(() => {}));
  };

  const inReadOnly = <T>(ms: number, signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> =>
    inTurn(async () => {
      if (dead) throw new DatabaseError("The connection to the database was closed.");
      if (signal?.aborted) throw new DatabaseError("Stopped.");
      await client.query("BEGIN READ ONLY");
      try {
        await client.query(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(ms))}`);
        await client.query("SET LOCAL lock_timeout = 2000");
        await client.query("SET LOCAL row_security = off");
        const work = fn();
        work.catch(() => {});
        let timer: ReturnType<typeof setTimeout> | undefined;
        let onAbort: (() => void) | undefined;
        const late = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new DatabaseError(`It took longer than ${Math.round(ms / 1000)} seconds, so Qalam stopped it.`, "57014"));
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
        throw readError(e, ms);
      } finally {
        if (!dead) await client.query("ROLLBACK").catch(() => {});
      }
    });

  return {
    kind: "postgres",
    dialect: "postgres",
    where: t.conn.where,
    home: "public",
    read: (sql: string, o: ReadOpts = {}): Promise<Rows> => {
      const ms = o.timeoutMs ?? READ_MS;
      return inReadOnly(ms, o.signal, async () => {
        const r = await client.query({ text: wrapped(sql, o.rows ?? 1000), rowMode: "array", queryMode: "extended" } as pg.QueryArrayConfig);
        return { columns: r.fields.map((f) => ({ name: f.name, numeric: NUMERIC.has(f.dataTypeID) })), rows: r.rows };
      });
    },
    explain: (sql: string, o: ReadOpts = {}) => {
      const ms = o.timeoutMs ?? READ_MS;
      return inReadOnly(ms, o.signal, async () => {
        const r = await client.query({ text: `EXPLAIN (FORMAT JSON, VERBOSE) ${sql}`, queryMode: "extended" } as pg.QueryConfig);
        const plan = (r.rows[0] as Record<string, unknown> | undefined)?.["QUERY PLAN"];
        return postgresPlan(typeof plan === "string" ? JSON.parse(plan) : plan);
      });
    },
    rights: (): Promise<Rights> =>
      inReadOnly(READ_MS, undefined, async () => {
        const who = (await client.query(WHO)).rows[0] as { u: string; su: boolean; v: string };
        const writes = (await client.query(WRITES)).rows as { t: string; n: string }[];
        const hidden = (await client.query(HIDDEN)).rows as { t: string }[];
        return { user: who.u, superuser: !!who.su, writes: writes.map((w) => w.t), writesCount: Number(writes[0]?.n ?? 0), hidden: hidden.map((h) => h.t), version: String(who.v).split(" on ")[0] };
      }),
    close: async () => {
      dead = true;
      await Promise.race([client.end().catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
    },
  };
}
