import { describe, expect, it } from "vitest";
import { editMetrics, MetricsEditError } from "./edit";
import { metricHash, metricsFromMarkdown, metricsToMarkdown, queryHash } from "./metrics-md";
import { emptyMetrics, type Metric, type Metrics } from "./types";

const revenue: Metric = {
  id: "m1",
  name: "Revenue, last 30 days",
  means: "Money from paid orders in the last 30 days, before refunds.",
  unit: "money",
  sql: "SELECT sum(total_cents) / 100.0\nFROM orders\nWHERE status = 'paid' -- not refunded\n  AND created_at >= now() - interval '30 days'",
  dialect: "postgres",
  assumes: ["Amounts are stored in cents.", "A refund leaves the order's status as it was."],
  goal: "g1",
  by: "qalam",
  at: 1_730_000_000_000,
};
const orders: Metric = { id: "m2", name: "Orders this week", means: "Orders placed since Monday.", unit: "count", sql: "SELECT COUNT(*) FROM `orders` WHERE YEARWEEK(created_at, 1) = YEARWEEK(NOW(), 1) # this week\n  AND total > 0", dialect: "mysql", assumes: [], by: "you", at: 1 };
const both: Metrics = { metrics: [revenue, orders], gone: ["average basket"] };

describe("hub/metrics.md", () => {
  it("reads back what it wrote: words, assumptions, the query as it was, its record", () => {
    const md = metricsToMarkdown(both, { org: "Basket" });
    expect(md).toContain("# The numbers at Basket");
    expect(md).toContain("```sql\nSELECT sum(total_cents) / 100.0");
    expect(metricsFromMarkdown(md)).toEqual(both);
  });

  it("keeps a query's -- comment and > in its fence, never in the record", () => {
    const md = metricsToMarkdown(both, { org: "Basket" });
    expect(md).toContain("WHERE status = 'paid' -- not refunded");
    expect(md).toContain("created_at >= now()");
    const recordLine = md.split("\n").find((l) => l.includes('"id":"m1"'))!;
    expect(recordLine).not.toMatch(/sum\(|-->.*-->/);
  });

  it("reads a MySQL query's # comment as SQL, not a heading", () => {
    const back = metricsFromMarkdown(metricsToMarkdown(both, { org: "Basket" }));
    expect(back.metrics[1].sql).toContain("# this week\n  AND total > 0");
  });

  it("fences a query holding backticks with a longer fence", () => {
    const tricky: Metric = { ...orders, id: "m3", name: "Odd", sql: "SELECT COUNT(*) FROM ```weird``` WHERE 1 = 1" };
    const md = metricsToMarkdown({ metrics: [tricky], gone: [] }, { org: "Basket" });
    expect(md).toContain("````sql");
    expect(metricsFromMarkdown(md).metrics[0].sql).toBe(tricky.sql);
  });

  it("makes a metric the person's when they change its words or its query in the file", () => {
    const md = metricsToMarkdown({ metrics: [revenue], gone: [] }, { org: "Basket" });
    expect(metricsFromMarkdown(md.replace("before refunds.", "after refunds.")).metrics[0].by).toBe("you");
    expect(metricsFromMarkdown(md.replace("'paid'", "'settled'")).metrics[0].by).toBe("you");
    // Trailing spaces and line endings aren't a change.
    expect(metricsFromMarkdown(md.replace("100.0\n", "100.0   \r\n")).metrics[0].by).toBe("qalam");
  });

  it("reads a section written by hand, with no record, as theirs", () => {
    const md = ["# The numbers", "", "## Refunds this month", "", "Refunds made since the 1st.", "", "```sql", "SELECT count(*) FROM refunds WHERE created_at >= date_trunc('month', now())", "```", ""].join("\n");
    const t = metricsFromMarkdown(md);
    expect(t.metrics).toHaveLength(1);
    expect(t.metrics[0]).toMatchObject({ name: "Refunds this month", means: "Refunds made since the 1st.", by: "you", unit: "other", dialect: "postgres" });
  });

  it("keeps a heading with no query, and a file of another version, as notes", () => {
    expect(metricsFromMarkdown("## Ideas\n\nCount repeat customers too.\n").notes).toContain("Count repeat customers too.");
    const other = '---\nqalam: "metrics/9"\n---\n\n## Something\n```sql\nSELECT 1 FROM t\n```\n';
    const t = metricsFromMarkdown(other);
    expect(t.metrics).toEqual([]);
    expect(t.notes).toContain("SELECT 1 FROM t");
  });

  it("reads the same name twice as the first one", () => {
    const md = metricsToMarkdown({ metrics: [revenue, { ...revenue, id: "m9", sql: "SELECT 2 FROM t" }], gone: [] }, { org: "B" });
    expect(metricsFromMarkdown(md).metrics.map((m) => m.id)).toEqual(["m1"]);
  });

  it("hashes the query a computer approved apart from its words", () => {
    expect(queryHash(revenue)).toBe(queryHash({ ...revenue, sql: `${revenue.sql}   ` }));
    expect(queryHash(revenue)).not.toBe(queryHash({ ...revenue, sql: revenue.sql.replace("'paid'", "'paid '") }));
    expect(queryHash(revenue)).not.toBe(queryHash({ ...revenue, dialect: "mysql" }));
    expect(metricHash(revenue)).not.toBe(metricHash({ ...revenue, means: "Something else." }));
  });
});

describe("changing the numbers", () => {
  const o = { now: 5, id: () => "m7" };
  it("keeps a draft, which brings back a name taken off", () => {
    const t = editMetrics({ metrics: [], gone: ["refunds this month"] }, { kind: "add", metric: { name: "Refunds this month", means: "x", unit: "count", sql: "SELECT count(*) FROM refunds", dialect: "postgres", assumes: [], by: "qalam" } }, o);
    expect(t.metrics[0]).toMatchObject({ id: "m7", at: 5, by: "qalam" });
    expect(t.gone).toEqual([]);
  });

  it("refuses a second number of the same name", () => {
    expect(() => editMetrics(both, { kind: "add", metric: { ...orders, name: "orders  this week" } }, o)).toThrow(MetricsEditError);
  });

  it("makes a fixed number the person's, and leaves an unchanged one as it was", () => {
    const fixed = editMetrics(both, { kind: "fix", id: "m1", means: "Money from paid orders, after refunds." }, o);
    expect(fixed.metrics[0]).toMatchObject({ by: "you", at: 5, means: "Money from paid orders, after refunds." });
    expect(editMetrics(both, { kind: "fix", id: "m1", means: revenue.means }, o)).toBe(both);
  });

  it("remembers a name taken off", () => {
    const t = editMetrics(both, { kind: "remove", id: "m2" }, o);
    expect(t.metrics.map((m) => m.id)).toEqual(["m1"]);
    expect(t.gone).toEqual(["average basket", "orders this week"]);
    expect(() => editMetrics(emptyMetrics(), { kind: "remove", id: "m2" }, o)).toThrow(MetricsEditError);
  });
});
