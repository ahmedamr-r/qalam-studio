import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OrgStore } from "../org/store";
import { resetSecrets } from "../secrets";
import { connectDatabase } from "./connect";
import { draftMetrics } from "./draft";
import { getDrafts } from "./files";
import { readLayout } from "./index";
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

let dir: string;
let store: OrgStore;
beforeEach(async () => {
  resetSecrets();
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-draft-")), "Basket Co");
  store = await OrgStore.create(dir, { id: "org1", name: "Basket Co", createdAt: 1 });
  await connectDatabase(store, { url: db.url("reader") });
  await readLayout(store);
}, 60_000);
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

const revenue = { name: "Revenue, last 30 days", means: "Money from paid orders in the last 30 days, before refunds.", unit: "money", sql: "SELECT sum(total_cents) / 100.0 FROM public.orders WHERE status = 'paid' AND currency = 'EGP' AND deleted_at IS NULL AND created_at >= now() - interval '30 days'", assumes: ["Amounts are in cents."], goal: "" };
const typo = { name: "Refunds", means: "Money refunded, ever.", unit: "money", sql: "SELECT sum(amount_cent) / 100.0 FROM public.refunds", assumes: [], goal: "" };
const leak = { name: "Odd sum", means: "A sum that can't work.", unit: "count", sql: "SELECT sum(email::int) FROM public.customers", assumes: [], goal: "" };

/** A stand-in for the model: what each call was sent, and its answers in turn. */
function model(...answers: unknown[]) {
  const sent: string[] = [];
  const structured = (async (opts: { content: { text: string }[] }) => {
    sent.push(opts.content.map((c) => c.text).join("\n"));
    return { data: answers.shift() ?? { metrics: [], cannot_tell: [] }, model: "stand-in" };
  }) as never;
  return { sent, structured };
}

describe("drafting the team's numbers from its database", () => {
  it("checks each draft on the database, samples it read-only, and keeps it on this computer", async () => {
    const m = model({ metrics: [revenue], cannot_tell: [{ question: "Which table holds what you pay couriers?", choices: ["public.deliveries.courier_cost_cents"], for: "Contribution margin" }] });
    const d = await draftMetrics(store, { structured: m.structured });
    expect(d.drafts).toHaveLength(1);
    expect(d.drafts[0]).toMatchObject({ name: "Revenue, last 30 days", flags: [], error: undefined });
    expect(d.drafts[0].sample?.value).toBeGreaterThan(0);
    expect(d.drafts[0].reads).toEqual(expect.arrayContaining(["public.orders.total_cents", "public.orders.status", "public.orders.created_at"]));
    expect(d.questions).toEqual([expect.objectContaining({ question: "Which table holds what you pay couriers?", choices: ["public.deliveries.courier_cost_cents"] })]);
    expect((await getDrafts(store))?.drafts.map((x) => x.name)).toEqual(["Revenue, last 30 days"]);
    // What it sent: the layout, never a row.
    expect(m.sent[0]).toContain("- public.orders, about 300 rows");
    expect(m.sent[0]).not.toMatch(/@example\.com|\+2010|Customer 1\b/);
  }, 60_000);

  it("gives a query the database turned down one repair, hearing its error with every value masked", async () => {
    const fixed = { ...typo, sql: "SELECT sum(amount_cents) / 100.0 FROM public.refunds" };
    const m = model({ metrics: [revenue, typo, leak], cannot_tell: [] }, { metrics: [fixed, leak], cannot_tell: [] });
    const d = await draftMetrics(store, { structured: m.structured });
    expect(m.sent).toHaveLength(2);
    const repair = m.sent[1];
    expect(repair).toContain("These drafts failed");
    // The model's own word stays readable; a row's value never reaches it.
    expect(repair).toMatch(/amount_cent/);
    expect(repair).not.toMatch(/@example\.com/);
    expect(d.drafts.map((x) => [x.name, x.error ? "failed" : "ok"])).toEqual([
      ["Revenue, last 30 days", "ok"],
      ["Refunds", "ok"],
      ["Odd sum", "failed"],
    ]);
    expect(d.drafts[1].sample?.value).toBeGreaterThan(0);
    // What the person reads: the database's words, which may quote a value; they're theirs to read, not the model's.
    expect(d.drafts[2].error).toMatch(/invalid input syntax/);
  }, 60_000);

  it("keeps its trace without a sample", async () => {
    const m = model({ metrics: [revenue], cannot_tell: [] });
    const d = await draftMetrics(store, { structured: m.structured });
    const files = await readdir(path.join(dir, "chats/database/traces"));
    const t = await readFile(path.join(dir, "chats/database/traces", files[0]), "utf8");
    expect(t).toContain("Revenue, last 30 days");
    expect(t).not.toContain(String(d.drafts[0].sample?.value));
  }, 60_000);

  it("says what to do first when there's no layout or no database", async () => {
    const other = await OrgStore.create(path.join(path.dirname(dir), "Other"), { id: "org2", name: "Other", createdAt: 1 });
    try {
      await expect(draftMetrics(other, { structured: model().structured })).rejects.toMatchObject({ code: "unconnected" });
    } finally {
      other.dispose();
    }
  });
});
