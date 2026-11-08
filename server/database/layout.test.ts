import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseConnection, type Connection } from "@/database/connection";
import { aboutRows, layoutText, maskValue, personalOf, pgArray, statusLike, tablesThatMatter, type Layout } from "@/database/layout";
import { readPostgresLayout } from "./layout";
import { openPostgres } from "./postgres";
import type { Runner } from "./runner";
import { startSampleDb, type SampleDb } from "./testing/sample";

let db: SampleDb;
let layout: Layout;
const said: string[] = [];

beforeAll(async () => {
  db = await startSampleDb();
  await db.as("reader");
  const c = parseConnection(db.url("reader")) as Connection;
  const r = await openPostgres({ conn: c });
  // Every statement the reading sends, to check none reads a personal column.
  const recording: Runner = { ...r, read: (sql, o) => (said.push(sql), r.read(sql, o)) };
  try {
    layout = await readPostgresLayout(recording, { hidden: ["public.notes"], now: 1 });
  } finally {
    await r.close();
  }
}, 120_000);
afterAll(async () => {
  await db?.close();
});

const table = (name: string) => layout.tables.find((t) => t.name === name)!;
const col = (t: string, c: string) => table(t).columns.find((x) => x.name === c)!;

describe("reading how a database is laid out, as a user that may only read", () => {
  it("finds the tables, their columns and types, and the planner's row counts", () => {
    expect(layout.tables.map((t) => t.name).sort()).toEqual(["customers", "deliveries", "notes", "orders", "refunds", "schema_migrations", "sessions"]);
    expect(table("orders").rows).toBe(300);
    expect(table("orders").comment).toBe("One row per customer order");
    expect(col("orders", "total_cents")).toMatchObject({ type: "integer", numeric: true, nullable: false, comment: "What the customer paid, in cents" });
    expect(col("orders", "deleted_at").nullable).toBe(true);
  });

  it("finds the keys, which a SELECT-only user can't see in information_schema", () => {
    expect(col("orders", "id").primary).toBe(true);
    expect(col("orders", "customer_id").ref).toBe("public.customers.id");
    expect(col("refunds", "order_id").ref).toBe("public.orders.id");
  });

  it("gives an enum's labels, and samples only short status-like columns", () => {
    expect(col("orders", "status").labels).toEqual(["pending", "paid", "refunded", "cancelled"]);
    expect(col("orders", "channel").values?.sort()).toEqual(["app", "web"]);
    expect(col("orders", "currency").values).toEqual(["EGP"]);
    expect(col("customers", "plan").values?.sort()).toEqual(["free", "plus"]);
    expect(col("refunds", "reason").values?.sort()).toEqual(["damaged", "late"]);
    // A city isn't a status: never sampled.
    expect(col("customers", "city").values).toBeUndefined();
  });

  it("marks personal columns, and never sends a statement that reads one", () => {
    expect(col("customers", "email").personal).toBe("email");
    expect(col("customers", "phone").personal).toBe("phone");
    expect(col("customers", "full_name").personal).toBe("name");
    expect(col("sessions", "token").personal).toBe("secret");
    for (const sql of said.filter((x) => !/pg_catalog|pg_class|pg_stats|pg_constraint/.test(x))) expect(sql).not.toMatch(/email|phone|full_name|token/);
    expect(table("notes").hidden).toBe(true);
  });

  it("sends the tables that matter in full, and the rest by name", () => {
    const { sent, others } = tablesThatMatter(layout);
    expect(sent.map((t) => t.name)).toEqual(expect.arrayContaining(["orders", "refunds", "deliveries", "customers"]));
    expect(sent.map((t) => t.name)).not.toContain("schema_migrations");
    expect(sent.map((t) => t.name)).not.toContain("sessions");
    expect(others).toEqual(expect.arrayContaining(["public.schema_migrations", "public.sessions"]));
    const text = layoutText(layout, sent, others);
    expect(text).toContain("- public.orders, about 300 rows. Its comment: \"One row per customer order\"");
    expect(text).toContain("status order_status; one of: pending, paid, refunded, cancelled");
    expect(text).toContain("customer_id bigint; → public.customers.id");
    expect(text).toContain("email text; an email: Qalam never reads its values");
    expect(text).not.toMatch(/@example\.com|\+2010/);
  });
});

describe("the layout's own rules", () => {
  it("tells personal columns by name, a plain name only on a table of people", () => {
    expect(personalOf("name", "customers")).toBe("name");
    expect(personalOf("name", "products")).toBeNull();
    expect(personalOf("review_status", "orders")).toBeNull();
    expect(personalOf("review", "orders")).toBe("free-text");
    expect(personalOf("shipped_at", "orders")).toBeNull();
    expect(personalOf("ip_address", "events")).toBe("network");
    expect(personalOf("card_number", "payments")).toBe("card");
  });

  it("samples a status, never free text or a key", () => {
    expect(statusLike({ name: "payment_method", type: "character varying(20)" })).toBe(true);
    expect(statusLike({ name: "title", type: "text" })).toBe(false);
    expect(statusLike({ name: "status", type: "character varying(4000)" })).toBe(false);
    expect(statusLike({ name: "status", type: "text", primary: true })).toBe(false);
  });

  it("masks a value that looks personal or like an id", () => {
    expect(maskValue("paid")).toBe("paid");
    expect(maskValue("sara@example.com")).toBeNull();
    expect(maskValue("+20 100 123 4567")).toBeNull();
    expect(maskValue("3f2a1b4c-1111-2222-3333-444455556666")).toBeNull();
    expect(maskValue("x".repeat(41))).toBeNull();
  });

  it("reads a Postgres array, and says a row count as it's said", () => {
    expect(pgArray('{paid,refunded,"with space","a \\"quote\\""}')).toEqual(["paid", "refunded", "with space", 'a "quote"']);
    expect(aboutRows(300)).toBe("about 300 rows");
    expect(aboutRows(48_213)).toBe("about 48 thousand rows");
    expect(aboutRows(1_234_567)).toBe("about 1.2 million rows");
    expect(aboutRows(null)).toBe("rows not counted");
  });
});
