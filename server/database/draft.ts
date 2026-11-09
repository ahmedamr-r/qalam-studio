import { nanoid } from "nanoid";
import { metricsCall, repairCall } from "@/ai/metrics";
import { structured as realStructured } from "@/ai/server";
import { draftText, queryFlags, sampleFlags, sampleOf, sanitizeDrafts, type Draft, type DraftAnswer, type Drafts } from "@/database/draft";
import { tableKeyOf, tablesThatMatter, type Layout } from "@/database/layout";
import { errorForModel, ownWords } from "@/database/plan";
import { guardSql } from "@/database/sql";
import type { OrgStore } from "../org/store";
import { withDatabase, type Opener } from "./connect";
import { getDrafts, getLayout, putDrafts } from "./files";
import { DatabaseError, type Runner } from "./runner";
import { businessFor } from "../org/company";

/*
 * Drafting a team's numbers from its database's layout, in the core. One call reads the layout, the
 * company, the goals, the project's words, what's kept or taken off and what the team told it, and
 * writes up to 8 numbers with their queries and what it can't tell. Code keeps what its checks pass
 * (src/database/draft.ts); then, on the database, each kept query is planned (EXPLAIN: which columns
 * it reads, by the database's own reading, and whether it would cost past a cap) and run once,
 * read-only, for its sample. One that fails gets one repair turn, which hears the database's error
 * with every quoted value masked, never a row. Results never go to the model. The drafts wait on this
 * computer (.qalam/database/drafts.json) until the person uses or leaves each.
 */

/** A plan estimated past this is refused before it runs (the planner's own units). */
export const COST_CAP = 5e7;

type Structured = typeof realStructured;
export interface DraftDeps {
  structured?: Structured;
  open?: Opener;
  now?: number;
}

const trace = (store: OrgStore, data: Record<string, unknown>) => store.putTrace({ id: nanoid(10), projectId: "database", kind: "metrics", at: Date.now(), ...data } as { id: string; projectId: string }).catch(() => {});

/** The names the layout holds, which a database's error may quote back to the model. */
const layoutNames = (l: Layout) => new Set(l.tables.flatMap((t) => [t.schema, t.name, tableKeyOf(t), ...t.columns.map((c) => c.name)]).map((x) => x.toLowerCase()));

/** Personal columns a check found a query reading: said beside it. */
function personalFlags(l: Layout, reads: readonly string[]): string[] {
  const personal = l.tables.flatMap((t) => t.columns.filter((c) => c.personal).map((c) => `${tableKeyOf(t)}.${c.name}`.toLowerCase()));
  const hit = reads.filter((r) => personal.includes(r.toLowerCase()));
  return hit.length ? [`It reads ${hit.join(", ")}, which ${hit.length === 1 ? "holds" : "hold"} personal details: only a count of ${hit.length === 1 ? "it" : "them"} is safe to show.`] : [];
}

/** Plan and run a draft once on the database: which columns it reads, its sample, code's warnings; or why it failed (in words, and masked for the model). */
export async function checkOnDatabase(r: Runner, l: Layout, d: Draft, signal?: AbortSignal): Promise<{ draft: Draft; failed?: string }> {
  const g = guardSql(d.sql, l.dialect);
  if (!g.ok) return { draft: { ...d, error: `Qalam won't run it: ${g.why}.` } };
  try {
    const plan = await r.explain(g.sql, { signal });
    const views = g.tables.some((t) => l.tables.find((x) => x.name.toLowerCase() === t.name.toLowerCase())?.view);
    const known = new Set(l.tables.map((t) => tableKeyOf(t).toLowerCase()));
    const outside = views ? undefined : plan.tables.find((t) => !known.has(t.toLowerCase()));
    if (outside) return { draft: { ...d, error: `It reads ${outside}, which isn't in the layout Qalam read.` } };
    if (plan.cost > COST_CAP) return { draft: { ...d, error: "The database estimates it would read far too much. Narrow it (a date range, an indexed column)." } };
    const sample = sampleOf(await r.read(g.sql, { rows: 2, signal }));
    // Only real columns of the layout's tables: a bare name in a one-table plan may be a keyword or a type.
    const columnsKnown = new Set(l.tables.flatMap((t) => t.columns.map((c) => `${tableKeyOf(t)}.${c.name}`.toLowerCase())));
    const reads = plan.columns.filter((c) => columnsKnown.has(c.toLowerCase()));
    const flags = [...new Set([...d.flags, ...personalFlags(l, reads)])];
    if ("why" in sample) return { draft: { ...d, reads, flags, error: sample.why }, failed: sample.why };
    return { draft: { ...d, reads, sample: { value: sample.value, at: Date.now() }, flags: [...new Set([...flags, ...sampleFlags(sample.value, d.unit)])], error: undefined } };
  } catch (e) {
    if (!(e instanceof DatabaseError)) throw e;
    const masked = errorForModel({ code: e.code, message: e.raw ?? e.message }, new Set([...layoutNames(l), ...ownWords(g.sql)]));
    return { draft: { ...d, error: e.message }, failed: masked };
  }
}

/** Draft the numbers again: the call, code's checks, the database's, one repair; kept on this computer. */
export async function draftMetrics(store: OrgStore, o: { answers?: DraftAnswer[]; emit?: (label: string) => void; signal?: AbortSignal } & DraftDeps = {}): Promise<Drafts> {
  const structured = o.structured ?? realStructured;
  const local = store.databaseLocal;
  if (!local) throw new DatabaseError("Connect your database in Connections first.", "unconnected");
  const layout = await getLayout(store);
  if (!layout) throw new DatabaseError("Read how it's laid out first.", "no-layout");
  const before = await getDrafts(store);
  const answers = mergeAnswers(before?.answers ?? [], o.answers ?? []);
  const file = await store.getMetrics();
  const goals = (await store.getGoals()).goals.filter((g) => g.status === "active").map((g) => ({ id: g.id, title: g.title, ...(g.metric?.name ? { metric: g.metric.name } : {}), ...(g.metric?.unit ? { unit: g.metric.unit } : {}) }));
  const about = await store.getAbout();
  const terms = (await store.getTerms()).terms.map((t) => `${t.term}: ${t.means}`);
  // A table they name in an answer is read in full next time.
  const named = answers.flatMap((a) => layout.tables.filter((t) => a.answer.toLowerCase().includes(t.name.toLowerCase())).map(tableKeyOf));
  const { sent, others } = tablesThatMatter(layout, { named });
  const leftBefore = before?.drafts ?? [];
  const business = await businessFor(store, { for: "call", max: 600 });
  const sentText = draftText({ layout, sent, others, about: [[about.context, about.audience].filter((x) => x?.trim()).join(" "), business].filter(Boolean).join("\n"), goals, terms, kept: file.metrics.map((m) => m.name), gone: file.gone, answers });
  o.emit?.("Reading how your database is laid out");
  const { data, model } = await structured<unknown>(metricsCall({ dialect: layout.dialect, text: sentText }), o.signal);
  const ctx = { layout, goalIds: new Set(goals.map((g) => g.id)), kept: file.metrics.map((m) => m.name), gone: file.gone, id: () => `d${nanoid(8)}` };
  const first = sanitizeDrafts(data, ctx);
  o.emit?.(first.drafts.length ? `Checking ${first.drafts.length === 1 ? "its number" : `its ${first.drafts.length} numbers`} on your database` : "Nothing it wrote held up");
  let drafts: Draft[] = [];
  const failed: { draft: Draft; why: string }[] = [];
  await withDatabase(
    store,
    async (r) => {
      for (const d of first.drafts) {
        const c = await checkOnDatabase(r, layout, d, o.signal);
        if (c.failed) failed.push({ draft: c.draft, why: c.failed });
        else drafts.push(c.draft);
      }
    },
    { open: o.open },
  );
  let repaired: Draft[] = [];
  if (failed.length && !o.signal?.aborted) {
    o.emit?.(`Fixing ${failed.length === 1 ? "a query" : `${failed.length} queries`} the database turned down`);
    const said = failed.map((f) => `- ${f.draft.name}\n  Its query: ${f.draft.sql}\n  The database said: ${f.why}`).join("\n");
    const again = await structured<unknown>(repairCall({ dialect: layout.dialect, text: sentText, failed: said }), o.signal).catch(() => null);
    const names = new Set(failed.map((f) => f.draft.name.toLowerCase()));
    const fixed = again ? sanitizeDrafts({ metrics: (Array.isArray((again.data as { metrics?: unknown }).metrics) ? ((again.data as { metrics: unknown[] }).metrics) : []).filter((m) => names.has(String((m as { name?: unknown }).name ?? "").toLowerCase())) }, { ...ctx, kept: [...ctx.kept, ...drafts.map((d) => d.name)] }) : null;
    if (fixed?.drafts.length)
      await withDatabase(
        store,
        async (r) => {
          for (const d of fixed.drafts) repaired.push((await checkOnDatabase(r, layout, d, o.signal)).draft);
        },
        { open: o.open },
      );
    const fixedNames = new Set(repaired.map((d) => d.name.toLowerCase()));
    // What still failed shows with why, for the person to fix or leave.
    repaired = [...repaired, ...failed.filter((f) => !fixedNames.has(f.draft.name.toLowerCase())).map((f) => f.draft)];
  }
  drafts = [...drafts, ...repaired];
  // Drafting again gives a fresh list (it heard what's kept, and their answers): the undecided ones before
  // it go, so two drafts of one number never sit side by side. Only when nothing new held up do they stay.
  const kept = drafts.length ? [] : leftBefore.filter((d) => !ctx.kept.some((k) => k.toLowerCase() === d.name.toLowerCase()));
  const out: Drafts = { at: o.now ?? Date.now(), where: local.where, drafts: [...kept, ...drafts], questions: first.questions, dropped: first.dropped, answers };
  await putDrafts(store, out);
  await trace(store, { model, sent: sentText, raw: data, kept: drafts.map((d) => ({ name: d.name, sql: d.sql, error: d.error ?? null })), dropped: first.dropped, questions: first.questions });
  return out;
}

/** Their answers so far, the newest for each question. */
function mergeAnswers(had: readonly DraftAnswer[], add: readonly DraftAnswer[]): DraftAnswer[] {
  const by = new Map<string, DraftAnswer>();
  for (const a of [...had, ...add]) by.set(a.question.toLowerCase(), a);
  return [...by.values()].slice(-20);
}

/** A draft's query flags again (after a person edits it), from the layout. */
export function flagsFor(l: Layout, d: Pick<Draft, "sql" | "unit">): string[] {
  const g = guardSql(d.sql, l.dialect);
  if (!g.ok) return [];
  const tables = g.tables.flatMap((t) => l.tables.filter((x) => tableKeyOf(x).toLowerCase() === `${t.schema ?? l.home}.${t.name}`.toLowerCase()));
  return queryFlags(g.sql, tables, d.unit);
}
