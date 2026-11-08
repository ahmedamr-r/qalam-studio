import type { DatabaseKind } from "@/database/local";
import type { PlanRead } from "@/database/plan";
import type { Dialect } from "@/database/sql";

export type { DatabaseKind } from "@/database/local";

/*
 * One way to run a read against a team's database, whatever kind it is (Postgres or MySQL straight
 * from the core, Supabase through its MCP server). Every read is code's: the catalog's own queries,
 * or a metric's query once code's guard has passed it. A runner never writes: its user is checked,
 * each read sits in a read-only transaction where the database allows one, and what comes back is
 * capped in rows and time.
 */

export interface Column {
  name: string;
  /** The database typed it as a number (an int, numeric, float, decimal). */
  numeric: boolean;
}

export interface Rows {
  columns: Column[];
  rows: unknown[][];
}

export interface ReadOpts {
  /** The database stops it after this long (15 s by default). */
  timeoutMs?: number;
  /** At most this many rows come back (the query is wrapped to say so). */
  rows?: number;
  signal?: AbortSignal;
}

/** What the connected user may do. */
export interface Rights {
  user: string;
  superuser: boolean;
  /** Tables it could change (a few by name) and how many. */
  writes: string[];
  writesCount: number;
  /** Tables whose rows row-level security hides from it: a number there would come out short, so a read there fails instead. */
  hidden: string[];
  version: string;
}

export interface Runner {
  kind: DatabaseKind;
  dialect: Dialect;
  /** What it points at, to tell one database from another. */
  where: string;
  /** The schema a table without one is in (Postgres's public, MySQL's database). */
  home: string;
  read(sql: string, o?: ReadOpts): Promise<Rows>;
  /** The database's own reading of a query: the tables and columns its plan reads, and its cost. Runs nothing. */
  explain(sql: string, o?: ReadOpts): Promise<PlanRead>;
  rights(): Promise<Rights>;
  close(): Promise<void>;
}

/** A database's refusal or failure, in words, with its code (SQLSTATE or MySQL's) when it gave one. */
export class DatabaseError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    /** The database's own message, before Qalam's words: for a repair, masked first. */
    readonly raw?: string,
  ) {
    super(message);
  }
}

export const READ_MS = 15_000;
/** The client gives up this long after the database should have. */
export const GRACE_MS = 3_000;
