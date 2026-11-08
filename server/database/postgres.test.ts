import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseConnection, type Connection } from "@/database/connection";
import { openPostgres } from "./postgres";
import type { Runner } from "./runner";
import { startSampleDb, type SampleDb } from "./testing/sample";

let db: SampleDb;
beforeAll(async () => {
  db = await startSampleDb();
}, 90_000);
afterAll(async () => {
  await db?.close();
});

const conn = (url: string) => {
  const c = parseConnection(url);
  if ("why" in c) throw new Error(c.why);
  return c as Connection;
};
async function as<T>(role: string, fn: (r: Runner) => Promise<T>): Promise<T> {
  await db.as(role);
  const r = await openPostgres({ conn: conn(db.url(role)) });
  try {
    return await fn(r);
  } finally {
    await r.close();
  }
}

describe("a Postgres database, read from the core", () => {
  it("says a superuser, a writer and a member of a writing role can change it, and a reader can't", async () => {
    const su = await as("postgres", (r) => r.rights());
    expect(su).toMatchObject({ user: "postgres", superuser: true });
    expect(su.writesCount).toBeGreaterThan(5);
    const writer = await as("writer", (r) => r.rights());
    expect(writer).toMatchObject({ user: "writer", superuser: false, writes: ["public.orders"], writesCount: 1 });
    const member = await as("member", (r) => r.rights());
    expect(member.writes).toEqual(["public.refunds"]);
    const reader = await as("reader", (r) => r.rights());
    expect(reader).toMatchObject({ user: "reader", superuser: false, writes: [], writesCount: 0 });
  }, 30_000);

  it("names the tables whose rows row-level security hides from the user", async () => {
    expect((await as("reader", (r) => r.rights())).hidden).toEqual(["public.notes"]);
    // A superuser sees every row.
    expect((await as("postgres", (r) => r.rights())).hidden).toEqual([]);
  }, 30_000);

  it("reads a number, typed as a number, and caps the rows that come back", async () => {
    const r = await as("reader", (x) => x.read("SELECT sum(total_cents) AS total FROM orders WHERE status = 'paid'"));
    expect(r.columns).toEqual([{ name: "total", numeric: true }]);
    expect(Number(r.rows[0][0])).toBeGreaterThan(0);
    expect((await as("reader", (x) => x.read("SELECT id FROM orders ORDER BY id", { rows: 5 }))).rows).toHaveLength(5);
    const text = await as("reader", (x) => x.read("SELECT status::text FROM orders LIMIT 1"));
    expect(text.columns[0].numeric).toBe(false);
  }, 30_000);

  it("stops a write in its read-only transaction, even for a user that may write", async () => {
    // Below code's guard: the transaction is a layer of its own.
    await expect(as("postgres", (r) => r.read("SELECT nextval('order_ids') AS n"))).rejects.toMatchObject({ code: "25006", message: expect.stringMatching(/read-only transaction stopped it/) });
  }, 30_000);

  it("runs one statement, whatever the text says", async () => {
    await expect(as("postgres", (r) => r.read("SELECT 1) q; SELECT (1"))).rejects.toMatchObject({ code: "42601" });
  }, 30_000);

  it("fails a read that row-level security would cut short, rather than count fewer rows", async () => {
    await expect(as("reader", (r) => r.read("SELECT count(*) FROM notes"))).rejects.toMatchObject({ message: expect.stringMatching(/Row-level security hides rows of notes/) });
  }, 30_000);

  it("gives the tables and columns a query's plan reads, by the database's own reading", async () => {
    const plan = await as("reader", (r) => r.explain("SELECT sum(o.total_cents) FROM orders o JOIN refunds r ON r.order_id = o.id WHERE o.status = 'paid'"));
    expect(plan.tables.sort()).toEqual(["public.orders", "public.refunds"]);
    expect(plan.columns).toEqual(expect.arrayContaining(["public.orders.total_cents", "public.orders.status", "public.refunds.order_id", "public.orders.id"]));
    expect(plan.cost).toBeGreaterThan(0);
  }, 30_000);

  it("says in words why it can't connect", async () => {
    await expect(openPostgres({ conn: conn(`postgres://reader@127.0.0.1:1/postgres`) })).rejects.toThrow(/Nothing answered at 127.0.0.1:1/);
  }, 30_000);
  it("stops a read that runs past its time, and the connection with it", async () => {
    const started = Date.now();
    await expect(as("reader", (r) => r.read("SELECT count(*) FROM generate_series(1, 30000000)", { timeoutMs: 200 }))).rejects.toMatchObject({ code: "57014" });
    // PGlite's own timeout never fires and it can't be cancelled, so the client's deadline is what's
    // tested here (last: PGlite is busy until the read ends). The server's is tested on real ones.
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 60_000);

});
