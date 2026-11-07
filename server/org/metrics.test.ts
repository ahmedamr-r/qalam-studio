import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { editMetrics } from "@/database/edit";
import { metricPieces } from "@/hub/pieces";
import { METRICS, OrgStore, type OrgEvent } from "./store";

let dir: string;
let store: OrgStore;

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-metrics-")), "Basket Co");
  store = await OrgStore.create(dir, { id: "org1", name: "Basket Co", createdAt: 1 });
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

let n = 0;
const o = () => ({ now: 5, id: () => `m${++n}` });
const revenue = { name: "Revenue, last 30 days", means: "Money from paid orders in the last 30 days.", unit: "money" as const, sql: "SELECT sum(total) FROM orders WHERE status = 'paid' -- paid only", dialect: "postgres" as const, assumes: ["Totals are in dollars."], goal: "g1", by: "qalam" as const };

describe("the team's numbers in the organization's folder", () => {
  it("writes a metric to hub/metrics.md, announces it, and reads it back", async () => {
    const heard: OrgEvent[] = [];
    store.events.on("event", (e: OrgEvent) => heard.push(e));
    await store.changeMetrics((t) => editMetrics(t, { kind: "add", metric: revenue }, o()), { tab: "tab1" });
    const md = await readFile(path.join(dir, METRICS), "utf8");
    expect(md).toContain("## Revenue, last 30 days");
    expect(md).toContain("SELECT sum(total) FROM orders WHERE status = 'paid' -- paid only");
    expect((await store.getMetrics()).metrics).toEqual([expect.objectContaining({ name: "Revenue, last 30 days", by: "qalam", goal: "g1" })]);
    expect(heard).toContainEqual({ kind: "metrics", tab: "tab1" });
  });

  it("keeps a person's edit made in the file, and makes it theirs", async () => {
    await store.changeMetrics((t) => editMetrics(t, { kind: "add", metric: revenue }, o()));
    const file = path.join(dir, METRICS);
    await writeFile(file, (await readFile(file, "utf8")).replace("status = 'paid'", "status IN ('paid', 'shipped')"));
    await store.changeMetrics((t) => editMetrics(t, { kind: "add", metric: { ...revenue, name: "Orders", sql: "SELECT count(*) FROM orders", goal: undefined } }, o()));
    const t = await store.getMetrics();
    expect(t.metrics.map((m) => [m.name, m.by])).toEqual([
      ["Revenue, last 30 days", "you"],
      ["Orders", "qalam"],
    ]);
    expect(t.metrics[0].sql).toContain("IN ('paid', 'shipped')");
  });

  it("is heard by search as how the team counts it, linked to its goal, never its value", async () => {
    const t = await store.changeMetrics((x) => editMetrics(x, { kind: "add", metric: revenue }, o()));
    const built = metricPieces(t, "Basket Co");
    expect(built.pieces[0]).toMatchObject({ type: "context", sub: "metric", title: "Revenue, last 30 days" });
    expect(built.pieces[0].text).toBe("Revenue, last 30 days: Money from paid orders in the last 30 days. It takes for granted: Totals are in dollars.");
    expect(built.pieces[0].text).not.toMatch(/SELECT/);
    expect(built.edges).toEqual([{ from: built.pieces[0].ref, to: "hub:goal:g1", kind: "for" }]);
  });
});
