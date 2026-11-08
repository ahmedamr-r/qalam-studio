import { parseConnection, readerSql, type Connection } from "@/database/connection";
import type { DatabaseLocal } from "@/database/local";
import { NoSecretStore, secrets } from "../secrets";
import type { OrgStore } from "../org/store";
import { openPostgres } from "./postgres";
import { DatabaseError, type Rights, type Runner } from "./runner";

/*
 * A project's database on this computer: connecting (the user checked first, the string kept in the
 * Keychain only once it's taken), forgetting, and a session to read with, in which the user is
 * checked again, since what it may do can change after it was connected.
 */

/** The Keychain item that holds a project's connection string (and its CA certificate). */
export const secretName = (store: OrgStore) => `database:${store.info.id}`;

interface Kept {
  url: string;
  ca?: string;
}

/** How to open a runner for a connection; tests and Supabase pass their own. */
export type Opener = (c: Connection, ca?: string) => Promise<Runner>;

export const openStraight: Opener = async (c, ca) => {
  if (c.kind === "postgres") return openPostgres({ conn: c, ...(ca ? { ca } : {}) });
  const { openMysql } = await import("./mysql");
  return openMysql({ conn: c, ...(ca ? { ca } : {}) });
};

export type ConnectResult =
  /** Kept: this computer reads it from now on. */
  | { state: "connected"; local: DatabaseLocal }
  /** Its user can change the database: nothing kept until they say to use it anyway. */
  | { state: "writes"; rights: Rights; sql: string };

const CA_MAX = 64_000;

export async function connectDatabase(store: OrgStore, input: { url: string; ca?: string; anyway?: boolean }, o: { open?: Opener; now?: number; tab?: string } = {}): Promise<ConnectResult> {
  const c = parseConnection(input.url);
  if ("why" in c) throw new DatabaseError(c.why);
  const ca = input.ca?.trim() || undefined;
  if (ca && (ca.length > CA_MAX || !/-----BEGIN CERTIFICATE-----/.test(ca))) throw new DatabaseError("That doesn't look like a CA certificate (it starts with -----BEGIN CERTIFICATE-----).");
  if (!secrets().available) throw new NoSecretStore();
  const runner = await (o.open ?? openStraight)(c, ca);
  let rights: Rights;
  try {
    rights = await runner.rights();
  } finally {
    await runner.close();
  }
  if (rights.writesCount > 0 && !input.anyway) return { state: "writes", rights, sql: readerSql(c.kind, c.database) };
  const kept: Kept = { url: input.url.trim(), ...(ca ? { ca } : {}) };
  await secrets().set(secretName(store), JSON.stringify(kept));
  const now = o.now ?? Date.now();
  const local = await store.changeDatabaseLocal(
    (was) => ({
      kind: c.kind,
      label: c.label,
      where: c.where,
      user: rights.user,
      canWrite: rights.writesCount > 0,
      ...(rights.writes.length ? { writes: rights.writes } : {}),
      ...(rights.writesCount > 0 ? { letIn: true } : {}),
      ...(rights.hidden.length ? { hidden: rights.hidden } : {}),
      version: rights.version,
      at: now,
      ...(was?.readings && was.where === c.where ? { readings: was.readings } : {}),
    }),
    { tab: o.tab },
  );
  return { state: "connected", local: local! };
}

/**
 * Connect a Supabase project, through this computer's Supabase sign-in: no string kept, its tokens are
 * the sign-in's. Its queries run as Supabase's read-only role, which is checked as any user is.
 */
export async function connectSupabase(store: OrgStore, input: { ref: string; name?: string; anyway?: boolean }, o: { now?: number; tab?: string } = {}): Promise<ConnectResult> {
  const ref = input.ref.trim();
  if (!/^[a-z]{20}$/.test(ref)) throw new DatabaseError("That isn't a Supabase project's ref (20 letters, in its dashboard's address).");
  const name = input.name?.replace(/\s+/g, " ").trim().slice(0, 120);
  const where = `supabase:${ref}`;
  const { openSupabase } = await import("./supabase");
  const runner = await openSupabase({ projectRef: ref, where });
  let rights: Rights;
  try {
    rights = await runner.rights();
  } finally {
    await runner.close();
  }
  if (rights.writesCount > 0 && !input.anyway) return { state: "writes", rights, sql: readerSql("supabase") };
  const now = o.now ?? Date.now();
  const local = await store.changeDatabaseLocal(
    (was) => ({
      kind: "supabase",
      label: name ? `Supabase · ${name}` : `Supabase · ${ref}`,
      where,
      projectRef: ref,
      user: rights.user,
      canWrite: rights.writesCount > 0,
      ...(rights.writes.length ? { writes: rights.writes } : {}),
      ...(rights.writesCount > 0 ? { letIn: true } : {}),
      ...(rights.hidden.length ? { hidden: rights.hidden } : {}),
      version: rights.version,
      at: now,
      ...(was?.readings && was.where === where ? { readings: was.readings } : {}),
    }),
    { tab: o.tab },
  );
  // A string kept for a database connected before goes: this project's database is Supabase's now.
  await secrets().remove(secretName(store)).catch(() => {});
  return { state: "connected", local: local! };
}

/** Forget the project's database on this computer: its string goes from the Keychain, what it checked stays with the database it was checked on. */
export async function forgetDatabase(store: OrgStore, o: { tab?: string } = {}): Promise<void> {
  await secrets().remove(secretName(store)).catch(() => {});
  await store.changeDatabaseLocal(() => null, o);
}

async function kept(store: OrgStore): Promise<Kept | null> {
  const raw = await secrets().get(secretName(store)).catch(() => null);
  if (!raw) return null;
  try {
    const k = JSON.parse(raw) as Partial<Kept>;
    return typeof k.url === "string" ? { url: k.url, ...(typeof k.ca === "string" ? { ca: k.ca } : {}) } : null;
  } catch {
    return null;
  }
}

/**
 * A session on the project's database: the user checked again first (a user that can write now,
 * when it couldn't at connect, isn't used until they connect again and decide), then `fn`, then closed.
 */
export async function withDatabase<T>(store: OrgStore, fn: (r: Runner, local: DatabaseLocal) => Promise<T>, o: { open?: Opener } = {}): Promise<T> {
  const local = store.databaseLocal;
  if (!local) throw new DatabaseError("Connect your database in Connections first.", "unconnected");
  if (local.kind === "supabase") {
    const { openSupabase } = await import("./supabase");
    const runner = await openSupabase(local);
    // Supabase's sign-in is this computer's; a session checks the role as any other.
    return session(store, runner, local, fn);
  }
  const k = await kept(store);
  if (!k) throw new DatabaseError("Its connection string isn't in the Keychain any more: connect it again in Connections.", "unconnected");
  const c = parseConnection(k.url);
  if ("why" in c) throw new DatabaseError(c.why, "unconnected");
  const runner = await (o.open ?? openStraight)(c, k.ca);
  return session(store, runner, local, fn);
}

async function session<T>(store: OrgStore, runner: Runner, local: DatabaseLocal, fn: (r: Runner, local: DatabaseLocal) => Promise<T>): Promise<T> {
  try {
    const rights = await runner.rights();
    if (rights.writesCount > 0 && !local.letIn) throw new DatabaseError(`${rights.user} can change the database now (${rights.writes.slice(0, 3).join(", ")}), which it couldn't when it was connected. Connect it again in Connections to decide.`, "writes");
    // Row security can change too: what it hides now is what the card says.
    if ((rights.hidden.join() !== (local.hidden ?? []).join()) || rights.writesCount > 0 !== local.canWrite)
      await store.changeDatabaseLocal((d) => (d ? { ...d, canWrite: rights.writesCount > 0, ...(rights.hidden.length ? { hidden: rights.hidden } : { hidden: undefined }) } : d));
    return await fn(runner, local);
  } finally {
    await runner.close();
  }
}
