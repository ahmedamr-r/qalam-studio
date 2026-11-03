import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { unfiled } from "@/hub/filing";
import { SAMPLE_NAME } from "@/sample/project";
import { listOrgs, storeFor } from "./home";
import { needsNow } from "./needs";
import { openSample } from "./sample";

// Words and links only: no model process in tests.
process.env.QALAM_NO_MODELS = "1";

const fts5 = (() => {
  try {
    new DatabaseSync(":memory:").exec("create virtual table t using fts5(x)");
    return true;
  } catch {
    return false;
  }
})();

let base: string;
const home = process.env.QALAM_HOME;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "qalam-sample-"));
  process.env.QALAM_HOME = path.join(base, "Qalam");
});
afterEach(async () => {
  process.env.QALAM_HOME = home;
  await rm(base, { recursive: true, force: true });
});

describe("the sample project", () => {
  it("is one project, finished, with nothing left to file and no product to choose", async () => {
    const made = await openSample();
    expect(made).toMatchObject({ name: SAMPLE_NAME, sample: true, shape: "solo" });
    const store = (await storeFor(made.id))!;
    expect(store.firstRun.done).toBeTruthy();
    expect(await store.listProducts()).toEqual([]);
    const sources = await store.listSources();
    expect(sources).toHaveLength(8);
    expect(unfiled(sources)).toEqual([]);
    expect(sources.every((s) => !s.product)).toBe(true);
  });

  it("has every board's goal under the North Star, and a goal no board has yet", async () => {
    const store = (await storeFor((await openSample()).id))!;
    const tree = await store.getGoals();
    expect(tree.goals.find((g) => g.id === tree.north)?.title).toContain("2M dirhams");
    const under = tree.goals.filter((g) => g.parent === tree.north);
    expect(under.map((g) => g.title).sort()).toEqual(["Deliveries arrive when promised", "More customers reorder every week", "More first-time customers order a second time", "Offices reorder on a schedule"]);
    expect(under.filter((g) => g.on).map((g) => g.on!.board).sort()).toEqual(["delivery", "pantry", "reorders"]);
  });

  it("hangs a brief under the card it's for", async () => {
    const store = (await storeFor((await openSample()).id))!;
    expect((await store.listBriefs()).map((b) => [b.card, b.kind])).toEqual([["s1", "solution"]]);
  });

  it("is the same one when it's opened again, as they left it", async () => {
    const first = await openSample();
    const store = (await storeFor(first.id))!;
    await store.removeTopic("basket-refunds");
    const again = await openSample();
    expect(again.id).toBe(first.id);
    expect((await listOrgs()).filter((o) => o.sample)).toHaveLength(1);
    expect((await store.listTopics()).map((t) => t.id)).not.toContain("basket-refunds");
  });

  it.runIf(fts5)("ranks its problems with what's behind each, and sees the ones on a board", async () => {
    const store = (await storeFor((await openSample()).id))!;
    const { indexed, needs } = await needsNow(store);
    expect(indexed).toBe(true);
    expect(needs).toHaveLength(10);
    expect(needs.slice(0, 2).map((n) => n.title).sort()).toEqual(["Rebuilding my usual basket takes too long", "Substitutions break my trust"]);
    expect(needs[0].sources).toBe(3);
    expect(needs.every((n) => n.quotes > 0)).toBe(true);
    expect(needs.find((n) => n.topic === "basket-substitutions")?.boards.map((b) => b.board)).toContain("reorders");
    expect(needs.find((n) => n.topic === "basket-refunds")?.boards).toEqual([]);
    expect(needs.find((n) => n.topic === "basket-usual-basket")?.against).toBeGreaterThan(0);
  });
});
