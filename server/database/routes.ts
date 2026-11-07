import type { Context, Hono } from "hono";
import { editMetrics, MetricsEditError, type MetricsEdit } from "@/database/edit";
import { guardSql } from "@/database/sql";
import { METRIC_UNITS, type MetricUnit } from "@/database/types";
import type { DraftAnswer } from "@/database/draft";
import { aiConfigured } from "@/ai/server";
import { NoSecretStore } from "../secrets";
import type { OrgStore } from "../org/store";
import { connectDatabase, forgetDatabase } from "./connect";
import { draftMetrics } from "./draft";
import { databaseView, readLayout } from "./index";
import { approveMetric, checkMetric, leaveDraft, readMetrics, useDraft, type DraftEdit } from "./metrics";
import { DatabaseError } from "./runner";

/*
 * The project's database, under /api/org/:org/database (and its numbers' file, /metrics): what this
 * computer reads, connecting and forgetting it, and the team's numbers. Registered after the store
 * middleware, so each route has its project's store. The connection string only ever comes in.
 */

type Env = { Variables: { store: OrgStore } };

const tabOf = (h: Headers) => h.get("x-qalam-tab") ?? undefined;
const bad = (message: string) => Response.json({ error: "bad_request", message }, { status: 400 });

/** A refusal in words: a database's or a check's reason is the person's to read (400), anything else failed. */
export function databaseFailure(e: unknown): Response {
  if (e instanceof DatabaseError || e instanceof MetricsEditError || e instanceof NoSecretStore) return Response.json({ error: "database", message: e.message, ...(e instanceof DatabaseError && e.code ? { code: e.code } : {}) }, { status: 400 });
  return Response.json({ error: "failed", message: e instanceof Error ? e.message : String(e) }, { status: 500 });
}

/** A long piece of work as NDJSON: what it's doing as it goes ("activity"), then its result, or why it failed (as the window's callAI reads it). */
export function streamed(request: AbortSignal, run: (emit: (label: string) => void, signal: AbortSignal) => Promise<unknown>): Response {
  const enc = new TextEncoder();
  const stop = new AbortController();
  request.addEventListener("abort", () => stop.abort());
  let open = true;
  const body = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (o: unknown) => {
        if (open) ctrl.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
      };
      try {
        send({ type: "result", data: await run((label) => send({ type: "activity", label }), stop.signal) });
      } catch (e) {
        if (!stop.signal.aborted) send({ type: "error", error: e instanceof DatabaseError ? "database" : "failed", message: e instanceof Error ? e.message : String(e) });
      }
      if (open) ctrl.close();
      open = false;
    },
    cancel() {
      open = false;
      stop.abort();
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);

/** Their answers to what Qalam AI couldn't tell, as the window sends them. */
function answersOf(v: unknown): DraftAnswer[] {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 20).flatMap((a): DraftAnswer[] => {
    const o = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
    const how = o.how === "own" || o.how === "pick" || o.how === "unknown" ? o.how : null;
    const question = str(o.question, 300);
    const answer = str(o.answer, 600) ?? "";
    if (!how || !question || (how !== "unknown" && !answer.trim())) return [];
    return [{ id: str(o.id, 40) ?? "", question, answer, how }];
  });
}

/** A person's edit to a draft before they use it. */
function editOf(v: unknown): DraftEdit {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const unit = typeof o.unit === "string" && (METRIC_UNITS as readonly string[]).includes(o.unit) ? (o.unit as MetricUnit) : undefined;
  const assumes = Array.isArray(o.assumes) ? o.assumes.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 300)) : undefined;
  return { ...(str(o.name, 200) !== undefined ? { name: str(o.name, 200) } : {}), ...(str(o.means, 600) !== undefined ? { means: str(o.means, 600) } : {}), ...(str(o.sql, 8000) !== undefined ? { sql: str(o.sql, 8000) } : {}), ...(unit ? { unit } : {}), ...(assumes ? { assumes } : {}) };
}

/** A change to the numbers' file from the window: a fix to one's words or query, or one taken off. */
function metricsEditOf(b: unknown): MetricsEdit | null {
  const o = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
  const id = str(o.id, 60);
  if (!id) return null;
  if (o.kind === "remove") return { kind: "remove", id };
  if (o.kind !== "fix") return null;
  const assumes = Array.isArray(o.assumes) ? o.assumes.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 300)) : undefined;
  const unit = typeof o.unit === "string" && (METRIC_UNITS as readonly string[]).includes(o.unit) ? (o.unit as MetricUnit) : undefined;
  return { kind: "fix", id, ...(str(o.name, 200) !== undefined ? { name: str(o.name, 200) } : {}), ...(str(o.means, 600) !== undefined ? { means: str(o.means, 600) } : {}), ...(str(o.sql, 8000) !== undefined ? { sql: str(o.sql, 8000) } : {}), ...(assumes ? { assumes } : {}), ...(unit ? { unit } : {}) };
}

export function databaseRoutes(r: Hono<Env>) {
  const store = (c: Context<Env>) => c.get("store");
  r.get("/api/org/:org/database", async (c) => c.json(await databaseView(store(c))));
  r.post("/api/org/:org/database", async (c) => {
    const b = (await c.req.json().catch(() => null)) as { url?: unknown; ca?: unknown; anyway?: unknown } | null;
    if (typeof b?.url !== "string" || !b.url.trim()) return bad("Paste a connection string.");
    try {
      const done = await connectDatabase(store(c), { url: b.url.slice(0, 2000), ...(typeof b.ca === "string" ? { ca: b.ca } : {}), anyway: b.anyway === true }, { tab: tabOf(c.req.raw.headers) });
      return c.json(done.state === "writes" ? { state: "writes", writes: done.rights.writes, writesCount: done.rights.writesCount, user: done.rights.user, superuser: done.rights.superuser, sql: done.sql } : { state: "connected", view: await databaseView(store(c)) });
    } catch (e) {
      return databaseFailure(e);
    }
  });
  r.delete("/api/org/:org/database", async (c) => {
    await forgetDatabase(store(c), { tab: tabOf(c.req.raw.headers) });
    return c.json(await databaseView(store(c)));
  });
  // How it's laid out, read again with no tokens.
  r.post("/api/org/:org/database/layout", (c) => streamed(c.req.raw.signal, async (emit, signal) => ({ layout: await readLayout(store(c), { emit, signal }), view: await databaseView(store(c)) })));
  // Qalam AI drafts the numbers from the layout; code checks each on the database. Their answers to what it couldn't tell come with it.
  r.post("/api/org/:org/database/draft", async (c) => {
    if (!aiConfigured()) return c.json({ error: "not_configured", message: "Qalam AI isn't set up here, so it can't draft the numbers." }, 503);
    const b = (await c.req.json().catch(() => null)) as { answers?: unknown } | null;
    const answers = answersOf(b?.answers);
    return streamed(c.req.raw.signal, async (emit, signal) => {
      await draftMetrics(store(c), { answers, emit, signal });
      return databaseView(store(c));
    });
  });
  // A draft used (checked on the database again, kept, approved here) or left out.
  r.put("/api/org/:org/database/drafts/:id", async (c) => {
    const b = (await c.req.json().catch(() => null)) as { use?: unknown; leave?: unknown; edit?: unknown } | null;
    const id = c.req.param("id");
    try {
      if (b?.leave === true) await leaveDraft(store(c), id, { tab: tabOf(c.req.raw.headers) });
      else if (b?.use === true) await useDraft(store(c), id, editOf(b.edit), { tab: tabOf(c.req.raw.headers), signal: c.req.raw.signal });
      else return bad("Use it or leave it out");
      return c.json(await databaseView(store(c)));
    } catch (e) {
      return databaseFailure(e);
    }
  });
  // A kept number checked on this computer beside a fresh sample, then approved as it was checked.
  r.post("/api/org/:org/database/metrics/:id/check", async (c) => {
    try {
      return c.json(await checkMetric(store(c), c.req.param("id"), { signal: c.req.raw.signal }));
    } catch (e) {
      return databaseFailure(e);
    }
  });
  r.post("/api/org/:org/database/metrics/:id/approve", async (c) => {
    const b = (await c.req.json().catch(() => null)) as { q?: unknown; value?: unknown } | null;
    if (typeof b?.q !== "string") return bad("Say which query you checked");
    try {
      const value = typeof b.value === "number" && Number.isFinite(b.value) ? b.value : null;
      await approveMetric(store(c), c.req.param("id"), b.q, { value, at: Date.now() }, { tab: tabOf(c.req.raw.headers) });
      return c.json(await databaseView(store(c)));
    } catch (e) {
      return databaseFailure(e);
    }
  });
  // Numbers read by their fixed queries, only those approved here.
  r.post("/api/org/:org/database/read", async (c) => {
    const b = (await c.req.json().catch(() => null)) as { ids?: unknown; fresh?: unknown } | null;
    const ids = Array.isArray(b?.ids) ? b.ids.filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(x)) : [];
    if (!ids.length) return bad("Say which numbers to read");
    try {
      return c.json({ read: await readMetrics(store(c), ids, { fresh: b?.fresh === true, signal: c.req.raw.signal, tab: tabOf(c.req.raw.headers) }) });
    } catch (e) {
      return databaseFailure(e);
    }
  });
  // The team's numbers (hub/metrics.md): a person's fix, or one taken off.
  r.get("/api/org/:org/metrics", async (c) => c.json({ metrics: await store(c).getMetrics() }));
  r.put("/api/org/:org/metrics", async (c) => {
    const edit = metricsEditOf(await c.req.json().catch(() => null));
    if (!edit) return bad("Say which number, and what to change");
    try {
      await store(c).changeMetrics(
        (t) => {
          // A query they write is checked as any other before it's kept; it runs only once checked beside a sample here.
          const was = edit.kind === "fix" ? t.metrics.find((m) => m.id === edit.id) : undefined;
          if (edit.kind === "fix" && edit.sql !== undefined && was) {
            const g = guardSql(edit.sql, was.dialect);
            if (!g.ok) throw new MetricsEditError(`Qalam won't run that query: ${g.why}.`);
          }
          return editMetrics(t, edit, { now: Date.now(), id: () => "unused" });
        },
        { tab: tabOf(c.req.raw.headers) },
      );
      return c.json(await databaseView(store(c)));
    } catch (e) {
      return databaseFailure(e);
    }
  });
}
