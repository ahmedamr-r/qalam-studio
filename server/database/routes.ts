import type { Context, Hono } from "hono";
import { editMetrics, MetricsEditError, type MetricsEdit } from "@/database/edit";
import { guardSql } from "@/database/sql";
import { METRIC_UNITS, type MetricUnit } from "@/database/types";
import { NoSecretStore } from "../secrets";
import type { OrgStore } from "../org/store";
import { connectDatabase, forgetDatabase } from "./connect";
import { databaseView } from "./index";
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

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);

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
