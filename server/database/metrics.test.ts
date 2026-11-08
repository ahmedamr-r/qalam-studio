import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { METRICS, OrgStore } from "../org/store";
import { resetSecrets } from "../secrets";
import { connectDatabase, forgetDatabase } from "./connect";
import { draftMetrics } from "./draft";
import { databaseView, readLayout } from "./index";
import { approveMetric, checkMetric, leaveDraft, readMetrics, useDraft } from "./metrics";
import { startSampleDb, type SampleDb } from "./testing/sample";

process.env.QALAM_SECRETS = "memory";

let db: SampleDb;
beforeAll(async () => {
  db = await startSampleDb();
  await db.as("reader");
}, 90_000);
afterAll(async () => {
  await db?.close();
});

const revenue = { name: "Revenue, last 30 days", means: "Money from paid orders in the last 30 days.", unit: "money", sql: "SELECT sum(total_cents) / 100.0 FROM public.orders WHERE status = 'paid' AND currency = 'EGP' AND deleted_at IS NULL AND created_at >= now() - interval '30 days'", assumes: ["Amounts are in cents."], goal: "" };
const refunds = { name: "Refunds, ever", means: "How many refunds there have been.", unit: "count", sql: "SELECT count(*) FROM public.refunds", assumes: [], goal: "" };
const structured = (async () => ({ data: { metrics: [revenue, refunds], cannot_tell: [] }, model: "stand-in" })) as never;

let dir: string;
let store: OrgStore;
beforeEach(async () => {
  resetSecrets();
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-metrics-db-")), "Basket Co");
  store = await OrgStore.create(dir, { id: "org1", name: "Basket Co", createdAt: 1 });
  await connectDatabase(store, { url: db.url("reader") });
  await readLayout(store);
  await draftMetrics(store, { structured });
}, 60_000);
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

const draftNamed = async (name: string) => (await databaseView(store)).drafts!.drafts.find((d) => d.name === name)!;

describe("the team's numbers on this computer", () => {
  it("keeps a used draft for the team, approved here with what it read, and the draft goes", async () => {
    const d = await draftNamed("Revenue, last 30 days");
    const { metric, reading } = await useDraft(store, d.id);
    expect(metric).toMatchObject({ name: "Revenue, last 30 days", by: "qalam", dialect: "postgres" });
    expect(reading.value).toBeGreaterThan(0);
    expect(await readFile(path.join(dir, METRICS), "utf8")).toContain("## Revenue, last 30 days");
    const v = await databaseView(store);
    expect(v.metrics).toEqual([expect.objectContaining({ state: "ready", reading })]);
    expect(v.drafts!.drafts.map((x) => x.name)).toEqual(["Refunds, ever"]);
  }, 60_000);

  it("makes an edited draft theirs, and won't keep an edit the guard refuses", async () => {
    const d = await draftNamed("Refunds, ever");
    await expect(useDraft(store, d.id, { sql: "SELECT count(*) FROM public.refunds; DELETE FROM public.refunds" })).rejects.toThrow(/more than one statement/);
    const { metric } = await useDraft(store, d.id, { name: "Refunds, all time", sql: "SELECT count(*) FROM public.refunds WHERE amount_cents > 0" });
    expect(metric).toMatchObject({ name: "Refunds, all time", by: "you" });
  }, 60_000);

  it("never drafts a left draft's name again", async () => {
    const d = await draftNamed("Refunds, ever");
    await leaveDraft(store, d.id);
    expect((await store.getMetrics()).gone).toEqual(["refunds, ever"]);
    await draftMetrics(store, { structured });
    expect((await databaseView(store)).drafts!.drafts.map((x) => x.name)).toEqual(["Revenue, last 30 days"]);
  }, 60_000);

  it("reads only what's approved here, as approved: a changed query is checked again first", async () => {
    const { metric } = await useDraft(store, (await draftNamed("Revenue, last 30 days")).id);
    const first = await readMetrics(store, [metric.id], { fresh: true });
    expect(first[metric.id]).toMatchObject({ value: expect.any(Number) });
    // A teammate changes the query in the file.
    const file = path.join(dir, METRICS);
    await writeFile(file, (await readFile(file, "utf8")).replace("status = 'paid'", "status IN ('paid', 'refunded')"));
    expect((await databaseView(store)).metrics[0].state).toBe("check");
    expect(await readMetrics(store, [metric.id], { fresh: true })).toEqual({ [metric.id]: { error: expect.stringMatching(/Check it beside a sample/), state: "check" } });
    const c = await checkMetric(store, metric.id);
    expect(c.sample?.value).toBeGreaterThan(0);
    await expect(approveMetric(store, metric.id, "stale-hash", null)).rejects.toThrow(/changed since you checked it/);
    await approveMetric(store, metric.id, c.q, c.sample ?? null);
    expect((await readMetrics(store, [metric.id], { fresh: true }))[metric.id]).toMatchObject({ value: expect.any(Number) });
  }, 60_000);

  it("gives a number read in the last five minutes again, unless asked fresh", async () => {
    const { metric, reading } = await useDraft(store, (await draftNamed("Refunds, ever")).id);
    expect((await readMetrics(store, [metric.id]))[metric.id]).toEqual(reading);
    expect((await readMetrics(store, [metric.id], { now: reading.at + 6 * 60_000 }))[metric.id]).toMatchObject({ value: 30 });
  }, 60_000);

  it("keeps what this computer checked through a disconnect, for the same database", async () => {
    const { metric } = await useDraft(store, (await draftNamed("Refunds, ever")).id);
    await forgetDatabase(store);
    expect((await databaseView(store)).metrics[0].state).toBe("unconnected");
    await connectDatabase(store, { url: db.url("reader") });
    expect((await databaseView(store)).metrics[0].state).toBe("ready");
    expect((await readMetrics(store, [metric.id], { fresh: true }))[metric.id]).toMatchObject({ value: 30 });
  }, 60_000);

  it("says a number checked on another database must be checked on this one", async () => {
    const { metric } = await useDraft(store, (await draftNamed("Refunds, ever")).id);
    await store.changeDatabaseLocal((d) => (d ? { ...d, where: "staging.example.com:5432/shop" } : d));
    expect((await databaseView(store)).metrics[0].state).toBe("elsewhere");
    expect((await readMetrics(store, [metric.id]))[metric.id]).toMatchObject({ state: "elsewhere" });
  }, 60_000);
});
