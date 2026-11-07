/*
 * The database this computer reads for a project (pure types): kept in .qalam/local, never shared, so
 * each teammate connects their own. The connection string itself is only ever in the Keychain; what's
 * kept here is what to show and what to tell databases apart by, what the user may do, which numbers
 * this computer checked beside a sample (and on which database), and what it last read.
 */

export type DatabaseKind = "postgres" | "mysql" | "supabase";

export const KIND_LABEL: Record<DatabaseKind, string> = { postgres: "Postgres", mysql: "MySQL", supabase: "Supabase" };

/** A number this computer checked beside a fresh sample: the query's hash then, and the database it ran on. */
export interface Approval {
  q: string;
  where: string;
  at: number;
}

export interface Reading {
  value: number | null;
  at: number;
}

export interface DatabaseLocal {
  kind: DatabaseKind;
  /** "reader@db.example.com:5432/shop", or Supabase's project name. */
  label: string;
  /** The database it points at ("db.example.com:5432/shop", a Supabase project's ref). */
  where: string;
  user: string;
  /** Its user can change something (a few tables by name); it was let in only after a warning. */
  canWrite: boolean;
  writes?: string[];
  letIn?: boolean;
  /** Tables whose rows row-level security hides from its user. */
  hidden?: string[];
  version?: string;
  /** Supabase: the project, by its ref. */
  projectRef?: string;
  at: number;
  /** When its layout was last read. */
  readAt?: number;
  approved?: Record<string, Approval>;
  readings?: Record<string, Reading>;
}

/** Where a number stands on this computer. */
export type MetricState =
  /** Checked here, on this database, as it's written now: it reads. */
  | "ready"
  /** Not checked here, or written differently since: a fresh sample first. */
  | "check"
  /** Checked here on another database (staging?). */
  | "elsewhere"
  /** Written for another kind of database than the one connected. */
  | "dialect"
  /** No database connected here. */
  | "unconnected";
