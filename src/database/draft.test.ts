import { describe, expect, it } from "vitest";
import { draftText, numberHeld, queryFlags, sampleFlags, sampleOf, sanitizeDrafts } from "./draft";
import type { Layout } from "./layout";

const layout: Layout = {
  dialect: "postgres",
  home: "public",
  at: 1,
  tables: [
    {
      schema: "public",
      name: "orders",
      rows: 300,
      comment: "One row per customer order",
      columns: [
        { name: "id", type: "bigint", nullable: false, primary: true, numeric: true },
        { name: "status", type: "order_status", nullable: false, labels: ["pending", "paid", "refunded"] },
        { name: "total_cents", type: "integer", nullable: false, numeric: true, comment: "In cents" },
        { name: "currency", type: "text", nullable: false, values: ["EGP"] },
        { name: "created_at", type: "timestamp with time zone", nullable: false },
        { name: "deleted_at", type: "timestamp with time zone", nullable: true },
      ],
    },
    { schema: "public", name: "deliveries", rows: 300, columns: [{ name: "courier_cost_cents", type: "integer", nullable: true, numeric: true }] },
    { schema: "public", name: "notes", rows: 2, hidden: true, columns: [{ name: "id", type: "integer", nullable: false }] },
  ],
};
let n = 0;
const ctx = { layout, goalIds: new Set(["g1"]), kept: ["Orders this week"], gone: ["Average basket"], id: () => `d${++n}` };
const metric = (o: Record<string, unknown>) => ({ name: "Revenue, last 30 days", means: "Money from paid orders in the last 30 days.", unit: "money", sql: "SELECT sum(total_cents) / 100.0 FROM public.orders WHERE status = 'paid' AND currency = 'EGP' AND deleted_at IS NULL AND created_at >= now() - interval '30 days'", assumes: ["Amounts are in cents."], goal: "g1", ...o });

describe("Qalam AI's drafts of the numbers, checked by code", () => {
  it("keeps a draft whose query passes, over tables in the layout, with its goal", () => {
    const r = sanitizeDrafts({ metrics: [metric({})], cannot_tell: [] }, ctx);
    expect(r.dropped).toEqual([]);
    expect(r.drafts[0]).toMatchObject({ name: "Revenue, last 30 days", unit: "money", goal: "g1", dialect: "postgres", flags: [], reads: [] });
  });

  it("drops a query the guard refuses, a table not read, a table row security hides, and words with a number the query doesn't have", () => {
    const r = sanitizeDrafts(
      {
        metrics: [
          metric({ name: "Wipe", sql: "DELETE FROM orders" }),
          metric({ name: "Payments", means: "All payments.", sql: "SELECT sum(amount) FROM public.payments" }),
          metric({ name: "Notes", means: "Notes kept.", sql: "SELECT count(*) FROM notes" }),
          metric({ name: "Revenue, last 7 days", means: "Money in the last 7 days.", sql: "SELECT sum(total_cents) / 100.0 FROM orders WHERE created_at >= now() - interval '30 days'" }),
          metric({ name: "Orders this week", means: "Orders.", sql: "SELECT count(*) FROM orders" }),
          metric({ name: "Average basket", means: "Average.", sql: "SELECT avg(total_cents) FROM orders" }),
        ],
      },
      ctx,
    );
    expect(r.drafts).toEqual([]);
    expect(r.dropped.map((d) => [d.name, d.why])).toEqual([
      ["Wipe", expect.stringMatching(/doesn't start with SELECT/)],
      ["Payments", expect.stringMatching(/public\.payments, which isn't in the layout/)],
      ["Notes", expect.stringMatching(/row-level security/)],
      ["Revenue, last 7 days", "its words say 7, which its query doesn't"],
      ["Orders this week", expect.stringMatching(/kept already/)],
      ["Average basket", expect.stringMatching(/taken off/)],
    ]);
  });

  it("takes a goal only when it was sent, and keeps at most 8", () => {
    const many = Array.from({ length: 10 }, (_, i) => metric({ name: `Orders ${String.fromCharCode(65 + i)}`, means: "Orders.", sql: "SELECT count(*) FROM orders WHERE deleted_at IS NULL", unit: "count", goal: i === 0 ? "nope" : "g1" }));
    const r = sanitizeDrafts({ metrics: many }, ctx);
    expect(r.drafts).toHaveLength(8);
    expect(r.drafts[0].goal).toBeUndefined();
    expect(r.dropped.filter((d) => /first 8/.test(d.why))).toHaveLength(2);
  });

  it("keeps what it can't tell, with only real tables and columns as choices", () => {
    const r = sanitizeDrafts({ metrics: [], cannot_tell: [{ question: "Which table holds what you pay couriers?", choices: ["public.deliveries.courier_cost_cents", "public.payouts.amount", "deliveries"], for: "Contribution margin" }] }, ctx);
    expect(r.questions).toEqual([{ id: expect.any(String), question: "Which table holds what you pay couriers?", choices: ["public.deliveries.courier_cost_cents", "deliveries"], for: "Contribution margin" }]);
  });

  it("warns of cents added as money, currencies added together, and deleted rows counted", () => {
    const flags = queryFlags("SELECT sum(total_cents) FROM orders WHERE status = 'paid'", layout.tables.slice(0, 1), "money");
    expect(flags).toEqual([
      "It adds up total_cents as money, and that column is in cents: divide by 100.",
      "public.orders has a currency column, and this adds every currency together.",
      "public.orders has deleted_at, and this counts deleted rows too.",
    ]);
    expect(queryFlags("SELECT count(*) FROM orders WHERE deleted_at IS NULL", layout.tables.slice(0, 1), "count")).toEqual([]);
  });

  it("reads a sample as one number, and warns of one that looks wrong", () => {
    expect(sampleOf({ columns: [{ name: "sum", numeric: true }], rows: [["4821.50"]] })).toEqual({ value: 4821.5 });
    expect(sampleOf({ columns: [{ name: "sum", numeric: true }], rows: [[null]] })).toEqual({ value: null });
    expect(sampleOf({ columns: [{ name: "a", numeric: true }, { name: "b", numeric: true }], rows: [[1, 2]] })).toEqual({ why: expect.stringMatching(/2 columns/) });
    expect(sampleOf({ columns: [{ name: "s", numeric: true }], rows: [[1], [2]] })).toEqual({ why: expect.stringMatching(/more than one row/) });
    expect(sampleOf({ columns: [{ name: "s", numeric: false }], rows: [["paid"]] })).toEqual({ why: expect.stringMatching(/isn't a number/) });
    expect(sampleFlags(0, "count")).toEqual([expect.stringMatching(/came out as 0/)]);
    expect(sampleFlags(0.12, "percent")).toEqual([expect.stringMatching(/may be a ratio/)]);
    expect(sampleFlags(12, "ratio")).toEqual([expect.stringMatching(/may be a percent/)]);
    expect(sampleFlags(4821.5, "money")).toEqual([]);
  });

  it("holds a number in the words when the query has it, or a hundred times it in cents", () => {
    expect(numberHeld("30", "now() - interval '30 days'")).toBe(true);
    expect(numberHeld("50", "total_cents > 5000")).toBe(true);
    expect(numberHeld("3", "LIMIT 30")).toBe(false);
  });

  it("tells Qalam AI the company, the goals, what's kept, and what the team said", () => {
    const t = draftText({ layout, sent: layout.tables, others: [], about: "Groceries delivered in Cairo.", goals: [{ id: "g1", title: "More revenue per order", metric: "Revenue per order", unit: "EGP" }], terms: ["Basket: an order before checkout"], kept: ["Orders this week"], gone: [], answers: [{ id: "q1", question: "Which status means paid?", answer: "paid", how: "pick" }, { id: "q2", question: "Do totals include tax?", answer: "", how: "unknown" }] });
    expect(t).toContain("- g1: More revenue per order (Revenue per order, in EGP)");
    expect(t).toContain("Numbers kept already (never write them again): Orders this week");
    expect(t).toContain("- Which status means paid? → they picked: paid");
    expect(t).toContain("- Do totals include tax? → they don't know (leave out what needs it)");
    expect(t).toContain("status order_status; one of: pending, paid, refunded");
  });
});
