import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * The search index's database: `.qalam/index.sqlite` in the organization's folder. It is derived
 * from the folder's files and can be deleted at any time; a different schema version rebuilds it.
 * Words are searched with SQLite's FTS5 (BM25), meaning with vectors kept beside each piece, and
 * links with an edges table that keeps when each link held (valid_at…invalid_at) and when the
 * index learned and dropped it (created_at…expired_at).
 */

export const INDEX_VERSION = 1;

export class IndexUnavailable extends Error {}

const SCHEMA = `
create table pieces (
  id integer primary key,
  ref text not null unique,
  key text not null,
  type text not null,
  sub text,
  text text not null,
  line text not null,
  topics text not null default '',
  title text,
  product text,
  board text,
  card text,
  source text,
  speaker text,
  stage text,
  at integer not null,
  hash text not null
);
create index pieces_key on pieces(key);
create virtual table words using fts5(text, line, topics, tokenize = 'porter unicode61 remove_diacritics 2');
create table vectors (
  id integer primary key references pieces(id) on delete cascade,
  model text not null,
  hash text not null,
  vec blob not null
);
create table edges (
  id integer primary key,
  key text not null,
  src text not null,
  dst text not null,
  kind text not null,
  valid_at integer,
  invalid_at integer,
  created_at integer not null,
  expired_at integer
);
create index edges_key on edges(key);
create index edges_src on edges(src) where expired_at is null;
create index edges_dst on edges(dst) where expired_at is null;
create table entities (
  ref text primary key,
  key text not null,
  kind text not null,
  name text not null
);
create table built (
  key text primary key,
  hash text not null,
  at integer not null
);
`;

const hasFts5 = (db: DatabaseSync) => {
  try {
    db.exec("create virtual table temp.probe using fts5(x); drop table temp.probe;");
    return true;
  } catch {
    return false;
  }
};

/** Open (or make) an index at `file`; ":memory:" for one that isn't kept. */
export function openIndexDb(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  let db = new DatabaseSync(file);
  if (!hasFts5(db)) {
    db.close();
    throw new IndexUnavailable(`Search needs Node 24 or later (this is ${process.version}, whose SQLite has no full-text search).`);
  }
  const version = (db.prepare("pragma user_version").get() as { user_version: number }).user_version;
  if (version !== INDEX_VERSION) {
    if (version !== 0 && file !== ":memory:") {
      // Another version's index: start over (it is only ever derived from the files).
      db.close();
      for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true });
      db = new DatabaseSync(file);
    }
    db.exec("pragma journal_mode = wal;");
    db.exec(SCHEMA);
    db.exec(`pragma user_version = ${INDEX_VERSION};`);
  }
  db.exec("pragma journal_mode = wal; pragma synchronous = normal; pragma foreign_keys = on;");
  return db;
}

/** Run `fn` in one transaction. */
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("begin");
  try {
    const out = fn();
    db.exec("commit");
    return out;
  } catch (e) {
    db.exec("rollback");
    throw e;
  }
}
