import { describe, expect, it } from "vitest";
import { errorForModel, mysqlPlan, ownWords, postgresPlan } from "./plan";

describe("what a plan says a query reads", () => {
  it("reads Postgres's plan by alias, and bare names in a one-table plan", () => {
    const two = [{ Plan: { "Node Type": "Aggregate", "Total Cost": 12.5, Output: ["sum(o.total_cents)"], Plans: [{ "Node Type": "Hash Join", "Hash Cond": "(r.order_id = o.id)", Plans: [{ "Node Type": "Seq Scan", "Relation Name": "refunds", Schema: "public", Alias: "r", Output: ["r.id", "r.order_id", "r.amount_cents"] }, { "Node Type": "Seq Scan", "Relation Name": "orders", Schema: "public", Alias: "o", Filter: "(o.status = 'paid'::text)", Output: ["o.id", "o.total_cents", "o.status", "o.channel"] }] }] } }];
    const p = postgresPlan(two);
    expect(p.tables.sort()).toEqual(["public.orders", "public.refunds"]);
    // A scan's own output (every column of its table) isn't what the query reads.
    expect(p.columns.sort()).toEqual(["public.orders.id", "public.orders.status", "public.orders.total_cents", "public.refunds.order_id"]);
    expect(p.cost).toBe(12.5);
    const one = [{ Plan: { "Node Type": "Aggregate", Output: ["((sum(total_cents))::numeric / 100.0)"], Plans: [{ "Node Type": "Seq Scan", "Relation Name": "orders", Schema: "public", Alias: "orders", Filter: "((orders.deleted_at IS NULL) AND (orders.status = 'paid'::order_status))" }] } }];
    expect(postgresPlan(one).columns).toEqual(expect.arrayContaining(["public.orders.total_cents", "public.orders.deleted_at", "public.orders.status"]));
  });

  it("reads MySQL's second format by its tables' own names", () => {
    const v2 = { estimated_total_cost: 0.8, inputs: [{ inputs: [{ alias: "r", table_name: "refunds", schema_name: "shop", used_columns: ["order_id"] }, { alias: "o", table_name: "orders", schema_name: "shop", used_columns: ["id", "total", "status"] }] }] };
    expect(mysqlPlan(v2, "shop")).toEqual({ tables: ["shop.refunds", "shop.orders"], columns: ["shop.refunds.order_id", "shop.orders.id", "shop.orders.total", "shop.orders.status"], cost: 0.8 });
  });

  it("reads MySQL's first format through the query's own aliases", () => {
    const v1 = { query_block: { cost_info: { query_cost: "0.70" }, nested_loop: [{ table: { table_name: "r", used_columns: ["order_id"] } }, { table: { table_name: "o", used_columns: ["total"] } }, { table: { table_name: "<derived2>" } }] } };
    expect(mysqlPlan(v1, "shop", { r: { name: "refunds" }, o: { schema: "shop", name: "orders" } })).toEqual({ tables: ["shop.refunds", "shop.orders"], columns: ["shop.refunds.order_id", "shop.orders.total"], cost: 0.7 });
  });

  it("masks every quoted value in an error but the names the model already has", () => {
    const known = new Set(["orders", "status", ...ownWords("SELECT sum(email::int) FROM customers WHERE status = 'paid'")]);
    expect(errorForModel({ code: "22P02", message: 'invalid input syntax for type integer: "sara@example.com"' }, known)).toBe('22P02: invalid input syntax for type integer: "…"');
    expect(errorForModel({ code: "42703", message: 'column "statuss" does not exist' }, known)).toBe('42703: column "…" does not exist');
    expect(errorForModel({ code: "42703", message: 'column "status" does not exist' }, known)).toBe('42703: column "status" does not exist');
    expect(errorForModel({ message: "value 4111111111111111 out of range" }, known)).toBe("value … out of range");
  });
});
