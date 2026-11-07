import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forgetAsked, listMemory, RememberBody, rememberRound } from "./memory";
import { OrgStore } from "./store";

let dir: string;
let store: OrgStore;
const sara = { id: "u1", name: "Sara" };
const omar = { id: "u2", name: "Omar" };

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-memory-")), "Qalam");
  store = await OrgStore.create(dir, { id: "org1", name: "Basket", createdAt: 1 });
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

const round = RememberBody.parse({
  flow: "find",
  key: "turn-1",
  about: { product: null, goal: "g1" },
  answers: [
    { qid: "nrr", q: "What is net revenue retention today?", a: "About 104%", how: "own" },
    { qid: "fail", q: "What's the failure rate?", a: "", how: "unknown" },
  ],
});

describe("Qalam AI's memory of what it asked", () => {
  it("keeps their own answers for the team and what they didn't know on this computer, and writes a round once", async () => {
    const events: string[] = [];
    store.events.on("event", (e: { kind: string }) => events.push(e.kind));
    expect(await rememberRound(store, round, { who: sara, now: 5 })).toBe(2);
    expect(await rememberRound(store, round, { who: sara, now: 6 })).toBe(0);
    const shared = await readFile(path.join(dir, "hub/asked.jsonl"), "utf8");
    const local = await readFile(path.join(dir, ".qalam/local/asked.jsonl"), "utf8");
    expect(shared).toContain("About 104%");
    expect(shared).not.toContain("failure rate");
    expect(local).toContain("failure rate");
    expect(events).toContain("asked");
    // The team's file merges line by line in Git.
    expect(await readFile(path.join(dir, ".gitattributes"), "utf8")).toContain("hub/*.jsonl merge=union");
  });

  it("lists what's remembered, newest first, saying whose: theirs, or a teammate's by name", async () => {
    await rememberRound(store, round, { who: sara, now: 5 });
    await rememberRound(store, { ...round, key: "turn-2", answers: [{ qid: "who", q: "Who is it for?", a: "Agencies", how: "own" }] }, { who: omar, now: 9 });
    const { entries } = await listMemory(store, { who: sara });
    // Newest first: within a round, the last asked first.
    expect(entries.map((e) => [e.q, e.mine, e.name ?? null, e.shared])).toEqual([
      ["Who is it for?", false, "Omar", true],
      ["What's the failure rate?", true, null, false],
      ["What is net revenue retention today?", true, null, true],
    ]);
  });

  it("forgets a line where it lives, and it's gone from what's listed", async () => {
    await rememberRound(store, round, { who: sara, now: 5 });
    const { entries } = await listMemory(store, { who: sara });
    const unknown = entries.find((e) => e.how === "unknown")!;
    expect(await forgetAsked(store, unknown.id, { who: sara, now: 7 })).toBe(true);
    expect(await readFile(path.join(dir, ".qalam/local/asked.jsonl"), "utf8")).toContain(`"forget":"${unknown.id}"`);
    expect((await listMemory(store, { who: sara })).entries.map((e) => e.how)).toEqual(["own"]);
    expect(await forgetAsked(store, "nope", { who: sara })).toBe(false);
  });

  it("turns away a round that isn't one", () => {
    expect(RememberBody.safeParse({ flow: "nope", key: "k", about: { product: null }, answers: [] }).success).toBe(false);
    expect(RememberBody.safeParse({ ...round, answers: [{ qid: "", q: "x", a: "", how: "own" }] }).success).toBe(false);
  });
});
