import { supabaseProjectUrl } from "@/connectors/catalog";
import type { DatabaseLocal } from "@/database/local";
import { postgresPlan } from "@/database/plan";
import { wrapped } from "@/database/sql";
import type { McpFullCall } from "../connectors/mcp";
import { signedIn, withSignedIn } from "../connectors/oauth";
import { readSettings } from "../settings";
import { HIDDEN, WHO, WRITES } from "./postgres";
import { DatabaseError, GRACE_MS, READ_MS, type ReadOpts, type Rights, type Rows, type Runner } from "./runner";

/*
 * A Supabase project, read through Supabase's own hosted MCP server: signed in once on this computer
 * (server/connectors/oauth.ts), each query sent to the project's own address with read_only=true, so
 * it runs as Supabase's read-only role (which counts every row: it bypasses row security). Its
 * execute_sql runs the same SQL the Postgres runner would, code's guard and the row cap first; there's
 * no transaction of Qalam's around it there, so its time limit is the client's (and Supabase's own
 * two minutes). Rows come back as JSON inside its untrusted-data tags: read as data by code, never
 * sent to the model.
 */

export const SUPABASE = "supabase";

/** One session on Supabase's server for as long as `fn` runs; tests pass their own (`useSupabaseSession`). */
export type SupabaseSession = <T>(url: string, fn: (full: McpFullCall) => Promise<T>) => Promise<T>;

const realSession: SupabaseSession = (url, fn) => withSignedIn(SUPABASE, url, (_call, _schemas, full) => fn(full));
const g = globalThis as { __qalamSupabaseSession?: SupabaseSession | null };
/** For tests: answer as Supabase's server does, with no sign-in. Null goes back to the real one. */
export const useSupabaseSession = (s: SupabaseSession | null) => void (g.__qalamSupabaseSession = s);
const session = (): SupabaseSession => g.__qalamSupabaseSession ?? realSession;

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The rows in execute_sql's answer: the JSON inside its untrusted-data tags (its result wrapped in {"result": …}). */
export function supabaseRows(text: string): Record<string, unknown>[] {
  let body = text;
  try {
    const j = rec(JSON.parse(text));
    if (j && typeof j.result === "string") body = j.result;
  } catch {
    // Not wrapped: the text is the result.
  }
  // Its tag's id (random each answer) is named first in the sentence before the data; the data sits
  // between the last opening tag with that id and its closing tag, so nothing in the rows can end it early.
  const id = /<untrusted-data-([\w-]+)>/.exec(body)?.[1];
  const end = id ? body.lastIndexOf(`</untrusted-data-${id}>`) : -1;
  const start = id && end >= 0 ? body.lastIndexOf(`<untrusted-data-${id}>`, end) : -1;
  const inner = start >= 0 ? body.slice(start + `<untrusted-data-${id}>`.length, end) : body;
  let rows: unknown;
  try {
    rows = JSON.parse(inner.trim());
  } catch {
    throw new DatabaseError("Supabase's answer wasn't rows Qalam could read.");
  }
  if (!Array.isArray(rows)) throw new DatabaseError("Supabase's answer wasn't rows Qalam could read.");
  return rows.filter((r): r is Record<string, unknown> => !!rec(r));
}

/** A failed call's words ({"error":{"name","message"}}), in Qalam's where it knows them; the database's own stay as `raw`. */
export function supabaseError(text: string, ms: number): DatabaseError {
  let m = text;
  try {
    const j = rec(JSON.parse(text));
    const e = rec(j?.error);
    m = typeof e?.message === "string" ? e.message : typeof j?.message === "string" ? j.message : text;
  } catch {
    // Its words as they came.
  }
  m = m.slice(0, 600);
  if (/statement timeout|canceling statement/i.test(m)) return new DatabaseError(`It took longer than ${Math.round(ms / 1000)} seconds, so the database stopped it.`, "57014", m);
  if (/read-only transaction/i.test(m)) return new DatabaseError("It tried to change something, and the read-only transaction stopped it.", "25006", m);
  if (/permission denied/i.test(m)) return new DatabaseError(`This project's read-only role isn't allowed to read that: ${m}`, "42501", m);
  if (/unauthori[sz]ed|forbidden|401|403/i.test(m)) return new DatabaseError("Supabase turned the request down: sign in again on Connections.", "unconnected", m);
  return new DatabaseError(m, undefined, m);
}

const NUMBER = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i;

/** Rows as objects, as the runner's rows: columns by the first row's keys, a column numeric when every value in it is one. */
export function asRows(objects: readonly Record<string, unknown>[]): Rows {
  const names = objects.length ? Object.keys(objects[0]) : [];
  const rows = objects.map((o) => names.map((n) => o[n] ?? null));
  return {
    columns: names.map((name, i) => ({ name, numeric: rows.some((r) => r[i] !== null) && rows.every((r) => r[i] === null || typeof r[i] === "number" || (typeof r[i] === "string" && NUMBER.test(r[i] as string))) })),
    rows,
  };
}

/** The projects an account's sign-in reaches, for picking one: each by its ref and name. */
export function projectsIn(text: string): { ref: string; name: string; region?: string }[] {
  let j: unknown;
  try {
    const outer = rec(JSON.parse(text));
    j = outer && typeof outer.result === "string" ? JSON.parse(outer.result) : JSON.parse(text);
  } catch {
    return [];
  }
  const out = new Map<string, { ref: string; name: string; region?: string }>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    const o = rec(v);
    if (!o) return;
    const ref = typeof o.ref === "string" ? o.ref : typeof o.id === "string" ? o.id : undefined;
    if (ref && /^[a-z]{20}$/.test(ref) && typeof o.name === "string") out.set(ref, { ref, name: o.name.slice(0, 120), ...(typeof o.region === "string" ? { region: o.region } : {}) });
    for (const x of Object.values(o)) if (x && typeof x === "object") walk(x);
  };
  walk(j);
  return [...out.values()];
}

/** The projects this computer's Supabase sign-in reaches (its account tools, on the address it signed in to). */
export async function supabaseProjects(): Promise<{ ref: string; name: string; region?: string }[]> {
  const via = (await readSettings()).connectors?.[SUPABASE];
  if (!g.__qalamSupabaseSession && (via?.via !== "oauth" || !(await signedIn(SUPABASE)))) throw new DatabaseError("Sign in with Supabase first.", "unconnected");
  const url = via?.via === "oauth" ? via.url : "";
  return session()(url, async (full) => {
    const r = await full({ tool: "list_projects", args: {} }, { timeoutMs: 30_000 }).catch((e: unknown) => Promise.reject(new DatabaseError(`Supabase didn't answer: ${message(e)}`)));
    if (r.error) throw supabaseError(r.text, 30_000);
    return projectsIn(r.text);
  });
}

/** A runner on one project: one session for as long as it's used, closed with it. */
export async function openSupabase(local: Pick<DatabaseLocal, "projectRef" | "where">): Promise<Runner> {
  const ref = local.projectRef;
  if (!ref) throw new DatabaseError("Pick the Supabase project on Connections first.", "unconnected");
  let full: McpFullCall | null = null;
  let finish: () => void = () => {};
  let ended: Promise<unknown> = Promise.resolve();
  await new Promise<void>((resolve, reject) => {
    ended = session()(supabaseProjectUrl(ref), (f) => {
      full = f;
      resolve();
      return new Promise<void>((r) => (finish = r));
    });
    ended.catch((e: unknown) => reject(e instanceof DatabaseError ? e : new DatabaseError(`Couldn't reach Supabase: ${message(e)}`, "unconnected")));
  });
  let closed = false;
  const exec = async (sql: string, ms: number, signal?: AbortSignal) => {
    if (closed || !full) throw new DatabaseError("The connection to Supabase was closed.");
    const r = await full({ tool: "execute_sql", args: { query: sql } }, { timeoutMs: ms + GRACE_MS, ...(signal ? { signal } : {}) }).catch((e: unknown) =>
      Promise.reject(/timed? ?out/i.test(message(e)) ? new DatabaseError(`It took longer than ${Math.round(ms / 1000)} seconds, so Qalam stopped it.`, "57014") : new DatabaseError(`Supabase didn't answer: ${message(e)}`)),
    );
    if (r.error) throw supabaseError(r.text, ms);
    return supabaseRows(r.text);
  };
  return {
    kind: "supabase",
    dialect: "postgres",
    where: local.where,
    home: "public",
    read: async (sql: string, o: ReadOpts = {}) => asRows(await exec(wrapped(sql, o.rows ?? 1000), o.timeoutMs ?? READ_MS, o.signal)),
    explain: async (sql: string, o: ReadOpts = {}) => {
      const rows = await exec(`EXPLAIN (FORMAT JSON, VERBOSE) ${sql}`, o.timeoutMs ?? READ_MS, o.signal);
      const plan = rows[0]?.["QUERY PLAN"];
      return postgresPlan(typeof plan === "string" ? JSON.parse(plan) : plan);
    },
    rights: async (): Promise<Rights> => {
      const who = (await exec(WHO, READ_MS))[0] ?? {};
      const writes = await exec(WRITES, READ_MS);
      const hidden = await exec(HIDDEN, READ_MS);
      return { user: String(who.u ?? ""), superuser: who.su === true, writes: writes.map((w) => String(w.t)), writesCount: Number(writes[0]?.n ?? 0), hidden: hidden.map((h) => String(h.t)), version: String(who.v ?? "").split(" on ")[0] };
    },
    close: async () => {
      closed = true;
      finish();
      await Promise.race([ended.catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
    },
  };
}
