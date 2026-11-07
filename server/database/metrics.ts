import { queryFlags, sampleOf, type Draft } from "@/database/draft";
import { editMetrics } from "@/database/edit";
import { tableKeyOf, type Layout } from "@/database/layout";
import type { Reading } from "@/database/local";
import { freshMetricId, queryHash } from "@/database/metrics-md";
import { guardSql } from "@/database/sql";
import { METRIC_UNITS, nameKey, type Metric, type MetricUnit } from "@/database/types";
import { metricState, type Checked, type ReadResult } from "@/database/view";
import type { OrgStore } from "../org/store";
import { withDatabase, type Opener } from "./connect";
import { checkOnDatabase } from "./draft";
import { getDrafts, getLayout, putDrafts } from "./files";
import { readLayout } from "./index";
import { DatabaseError } from "./runner";

/*
 * The team's numbers on this computer. A draft used is checked on the database again (a fresh sample,
 * after any edit of theirs), kept in hub/metrics.md, and approved here: its query's hash and the
 * database it ran on. A teammate's number, or one changed since, is checked beside a fresh sample and
 * approved before it reads. Reading runs only approved queries, as they were approved, read-only, and
 * keeps what it read on this computer; a number read in the last five minutes is given again unless
 * they ask for it fresh. No model is called here.
 */

const REUSE_MS = 5 * 60_000;

export interface DraftEdit {
  name?: string;
  means?: string;
  sql?: string;
  unit?: MetricUnit;
  assumes?: string[];
}

const one = (s: string) => s.replace(/\s+/g, " ").trim();

/** A kept number as a draft, to check it on the database as a draft is checked. */
export const asDraft = (m: Metric, l: Layout): Draft => ({ id: m.id, name: m.name, means: m.means, unit: m.unit, sql: m.sql, dialect: m.dialect, assumes: m.assumes, ...(m.goal ? { goal: m.goal } : {}), reads: [], flags: flagsOf(l, m) });

function flagsOf(l: Layout, m: Pick<Metric, "sql" | "unit">): string[] {
  const g = guardSql(m.sql, l.dialect);
  if (!g.ok) return [];
  return queryFlags(g.sql, g.tables.flatMap((t) => l.tables.filter((x) => tableKeyOf(x).toLowerCase() === `${t.schema ?? l.home}.${t.name}`.toLowerCase())), m.unit);
}

async function layoutFor(store: OrgStore, o: { open?: Opener; signal?: AbortSignal }): Promise<Layout> {
  const had = await getLayout(store);
  if (had) return had;
  await readLayout(store, { signal: o.signal, open: o.open });
  const l = await getLayout(store);
  if (!l) throw new DatabaseError("Qalam couldn't read how the database is laid out.");
  return l;
}

/** Use a draft: checked on the database again, kept for the team, approved on this computer. */
export async function useDraft(store: OrgStore, id: string, edit: DraftEdit = {}, o: { open?: Opener; now?: number; tab?: string; signal?: AbortSignal } = {}): Promise<{ metric: Metric; reading: Reading }> {
  const drafts = await getDrafts(store);
  const d = drafts?.drafts.find((x) => x.id === id);
  if (!drafts || !d) throw new DatabaseError("That draft isn't there any more.");
  const layout = await layoutFor(store, o);
  const next: Draft = {
    ...d,
    ...(edit.name !== undefined ? { name: one(edit.name).slice(0, 80) } : {}),
    ...(edit.means !== undefined ? { means: one(edit.means).slice(0, 300) } : {}),
    ...(edit.sql !== undefined ? { sql: edit.sql.trim() } : {}),
    ...(edit.unit && METRIC_UNITS.includes(edit.unit) ? { unit: edit.unit } : {}),
    ...(edit.assumes ? { assumes: edit.assumes.map(one).filter(Boolean).slice(0, 4) } : {}),
  };
  const changed = next.name !== d.name || next.means !== d.means || next.sql !== d.sql || next.unit !== d.unit || next.assumes.join("\n") !== d.assumes.join("\n");
  const checked = await withDatabase(store, (r) => checkOnDatabase(r, layout, { ...next, flags: flagsOf(layout, next) }, o.signal), { open: o.open });
  if (checked.draft.error || !checked.draft.sample) throw new DatabaseError(checked.draft.error ?? "It gave no number.");
  const now = o.now ?? Date.now();
  let made: Metric | undefined;
  await store.changeMetrics((t) => {
    const after = editMetrics(t, { kind: "add", metric: { name: next.name, means: next.means, unit: next.unit, sql: checked.draft.sql, dialect: next.dialect, assumes: next.assumes, ...(next.goal ? { goal: next.goal } : {}), by: changed ? "you" : "qalam" } }, { now, id: freshMetricId });
    made = after.metrics[after.metrics.length - 1];
    return after;
  }, { tab: o.tab });
  const reading: Reading = { value: checked.draft.sample.value, at: checked.draft.sample.at };
  await approve(store, made!, reading, now, o.tab);
  await putDrafts(store, { ...drafts, drafts: drafts.drafts.filter((x) => x.id !== id) });
  return { metric: made!, reading };
}

/** Leave a draft out: it goes, and its name isn't drafted again until a person adds it back. */
export async function leaveDraft(store: OrgStore, id: string, o: { tab?: string } = {}): Promise<void> {
  const drafts = await getDrafts(store);
  const d = drafts?.drafts.find((x) => x.id === id);
  if (!drafts || !d) return;
  await store.changeMetrics((t) => (t.gone.includes(nameKey(d.name)) ? t : { ...t, gone: [...t.gone, nameKey(d.name)].slice(-200) }), { tab: o.tab });
  await putDrafts(store, { ...drafts, drafts: drafts.drafts.filter((x) => x.id !== id) });
}

async function approve(store: OrgStore, m: Metric, reading: Reading, now: number, tab?: string) {
  await store.changeDatabaseLocal((d) => (d ? { ...d, approved: { ...d.approved, [m.id]: { q: queryHash(m), where: d.where, at: now } }, readings: { ...d.readings, [m.id]: reading } } : d), { tab });
}

/** Check a kept number on this computer beside a fresh sample, before it may read here. */
export async function checkMetric(store: OrgStore, id: string, o: { open?: Opener; signal?: AbortSignal } = {}): Promise<Checked> {
  const m = (await store.getMetrics()).metrics.find((x) => x.id === id);
  if (!m) throw new DatabaseError("That number isn't there any more.");
  const local = store.databaseLocal;
  if (metricState(m, local) === "unconnected") throw new DatabaseError("Connect your database in Connections first.", "unconnected");
  if (metricState(m, local) === "dialect") throw new DatabaseError(`It's written for ${m.dialect === "mysql" ? "MySQL" : "Postgres"}, and the database here is another kind.`);
  const layout = await layoutFor(store, o);
  const c = await withDatabase(store, (r) => checkOnDatabase(r, layout, asDraft(m, layout), o.signal), { open: o.open });
  return { q: queryHash(m), ...(c.draft.sample ? { sample: c.draft.sample } : {}), reads: c.draft.reads, flags: c.draft.flags, ...(c.draft.error ? { error: c.draft.error } : {}) };
}

/** Approve a kept number on this computer, as it was checked: the query's hash must still be the one they saw. */
export async function approveMetric(store: OrgStore, id: string, q: string, reading: Reading | null, o: { now?: number; tab?: string } = {}): Promise<void> {
  const m = (await store.getMetrics()).metrics.find((x) => x.id === id);
  if (!m) throw new DatabaseError("That number isn't there any more.");
  if (queryHash(m) !== q) throw new DatabaseError("Its query changed since you checked it: check it again.");
  if (!store.databaseLocal) throw new DatabaseError("Connect your database in Connections first.", "unconnected");
  await approve(store, m, reading ?? { value: null, at: o.now ?? Date.now() }, o.now ?? Date.now(), o.tab);
}

/** Read numbers that are approved here, by their fixed queries, in one session. */
export async function readMetrics(store: OrgStore, ids: readonly string[], o: { fresh?: boolean; open?: Opener; now?: number; signal?: AbortSignal; tab?: string } = {}): Promise<Record<string, ReadResult>> {
  const file = await store.getMetrics();
  const local = store.databaseLocal;
  const now = o.now ?? Date.now();
  const out: Record<string, ReadResult> = {};
  const toRead: Metric[] = [];
  for (const id of [...new Set(ids)].slice(0, 20)) {
    const m = file.metrics.find((x) => x.id === id);
    if (!m) {
      out[id] = { error: "That number isn't there any more." };
      continue;
    }
    const state = metricState(m, local);
    if (state !== "ready") {
      out[id] = { error: state === "unconnected" ? "Connect your database in Connections first." : state === "elsewhere" ? "It was checked on another database: check it on this one first." : state === "dialect" ? "It's written for another kind of database." : "Check it beside a sample on this computer first.", state };
      continue;
    }
    const had = local?.readings?.[id];
    if (!o.fresh && had && now - had.at < REUSE_MS) out[id] = had;
    else toRead.push(m);
  }
  if (!toRead.length) return out;
  const read: Record<string, Reading> = {};
  await withDatabase(
    store,
    async (r) => {
      for (const m of toRead) {
        const g = guardSql(m.sql, r.dialect);
        if (!g.ok) {
          out[m.id] = { error: `Qalam won't run it: ${g.why}.` };
          continue;
        }
        try {
          const s = sampleOf(await r.read(g.sql, { rows: 2, signal: o.signal }));
          if ("why" in s) out[m.id] = { error: s.why };
          else out[m.id] = read[m.id] = { value: s.value, at: Date.now() };
        } catch (e) {
          if (!(e instanceof DatabaseError)) throw e;
          out[m.id] = { error: e.message };
        }
      }
    },
    { open: o.open },
  );
  if (Object.keys(read).length) await store.changeDatabaseLocal((d) => (d ? { ...d, readings: { ...d.readings, ...read } } : d), { tab: o.tab });
  return out;
}
