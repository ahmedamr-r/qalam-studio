import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Ingested } from "@/discovery/ingest/core";
import { feedDue, feedShape, type Feed } from "@/org/feeds";
import { pullFeed, type PullDeps } from "./feeds";
import { OrgStore } from "./org/store";

let dir: string;
let store: OrgStore;
beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-feeds-")), "Basket");
  store = await OrgStore.create(dir, { id: "org1", name: "Basket", createdAt: 1 });
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

const DAY = 86_400_000;
const item = (title: string, text: string): Ingested => ({ kind: "connector", title, text });

describe("a feed", () => {
  it("is checked as a window sends it", () => {
    expect(feedShape({ id: "f1", label: "  Tickets  ", kind: "tool", connectors: ["mcp:intercom", "web"], request: "This week's tickets tagged delivery", every: "week", product: "grocery" }, "f1")).toEqual({ id: "f1", label: "Tickets", kind: "tool", connectors: ["mcp:intercom"], request: "This week's tickets tagged delivery", every: "week", product: "grocery" });
    expect(feedShape({ id: "f2", label: "Reviews", kind: "url", url: "https://example.com/reviews.csv", every: "day", product: null, paused: true }, "f2")).toMatchObject({ kind: "url", paused: true });
    expect(feedShape({ id: "f2", label: "Reviews", kind: "url", url: "file:///etc/passwd", every: "day", product: null }, "f2")).toBeNull();
    expect(feedShape({ id: "f3", label: "x", kind: "tool", connectors: ["web"], request: "anything", every: "day", product: null }, "f3")).toBeNull();
  });

  it("is due when it never ran, its time came, or its last pull left more; never while paused", () => {
    const f: Feed = { id: "f", label: "x", kind: "url", url: "https://x.y", every: "day", product: null };
    expect(feedDue(f, 10 * DAY)).toBe(true);
    expect(feedDue({ ...f, last: 10 * DAY - 3_600_000 }, 10 * DAY)).toBe(false);
    expect(feedDue({ ...f, last: 9 * DAY }, 10 * DAY)).toBe(true);
    expect(feedDue({ ...f, last: 10 * DAY, more: true }, 10 * DAY)).toBe(true);
    expect(feedDue({ ...f, paused: true }, 10 * DAY)).toBe(false);
  });

  it("captures only what it hasn't seen, a few at a time, for its product, and remembers it in the folder", async () => {
    await store.changeFeeds(() => [{ id: "f1", label: "Tickets", kind: "tool", connectors: ["mcp:intercom"], request: "tickets tagged delivery", every: "day", product: "grocery" }]);
    const captured: { title: string; product: string | null }[] = [];
    let batch = [item("T1", "The courier never came."), item("T1 again", "The courier never came."), ...["T2", "T3", "T4", "T5", "T6"].map((t) => item(t, `Ticket ${t}: late again.`))];
    const deps: PullDeps = {
      fetchPage: async () => item("page", "x"),
      fromTools: async () => batch,
      capture: async (_s, ing, product) => void captured.push({ title: ing.title, product }),
    };
    expect(await pullFeed(store, "f1", deps)).toEqual({ added: 5 });
    expect(captured.map((c) => c.title)).toEqual(["T1", "T2", "T3", "T4", "T5"]);
    expect(captured.every((c) => c.product === "grocery")).toBe(true);
    let [f] = await store.listFeeds();
    expect(f).toMatchObject({ added: 5, more: true });
    expect(f.seen).toHaveLength(5);
    // The next pull takes what's left, and nothing it has seen.
    expect(await pullFeed(store, "f1", deps)).toEqual({ added: 1 });
    expect(captured.at(-1)?.title).toBe("T6");
    [f] = await store.listFeeds();
    expect(f.more).toBeUndefined();
    batch = [item("T1", "The courier never came.")];
    expect(await pullFeed(store, "f1", deps)).toEqual({ added: 0 });
    // The file is the folder's: readable, shared through Git.
    expect(JSON.parse(await readFile(path.join(dir, "hub", "feeds.json"), "utf8")).feeds[0]).toMatchObject({ id: "f1", added: 6 });
  });

  it("keeps what went wrong, to show it", async () => {
    await store.changeFeeds(() => [{ id: "f1", label: "Page", kind: "url", url: "https://example.com", every: "day", product: null }]);
    const deps: PullDeps = { fetchPage: async () => Promise.reject(new Error("Couldn't read that page.")), fromTools: async () => [], capture: async () => undefined };
    expect(await pullFeed(store, "f1", deps)).toEqual({ added: 0, error: "Couldn't read that page." });
    expect((await store.listFeeds())[0]).toMatchObject({ error: "Couldn't read that page." });
  });
});
