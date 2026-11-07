import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GROCERY_FUNNEL } from "@/challenge/sample";
import type { CheckRequest } from "@/challenge/types";
import type { SourceRecord } from "@/discovery/sources";
import type { Topic } from "@/hub/topics";
import { carryChallenges, challengeProposals, decideChallenge } from "./challenge";
import { OrgStore } from "./store";

// Words only: no model process in tests.
process.env.QALAM_NO_MODELS = "1";

let dir: string;
let store: OrgStore;

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-challenge-")), "Basket");
  store = await OrgStore.create(dir, { id: "org1", name: "Basket", createdAt: 1 });
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

/** a2's funnel export as Qalam keeps it, each row with a loss read as a measured point. */
async function seedFunnel() {
  const rows = GROCERY_FUNNEL.split("\n");
  const quotes = rows.slice(1, 4).map((text, i) => {
    const start = GROCERY_FUNNEL.indexOf(text);
    return { id: `q${i + 2}`, kind: "finding" as const, text, span: [start, start + text.length] as [number, number], basis: "measured" as const, addedBy: "ai" as const, at: 1 };
  });
  await store.putSource({ v: 1, id: "funnel", projectId: "", boards: [], product: null, kind: "text", title: "a2-funnel", origin: "a2-funnel.csv", text: GROCERY_FUNNEL, addedAt: 1, read: [0], quotes, needs: [] } as SourceRecord);
}

/** The checkout page as the a2 run filed it: what's known, and what speaks against the payment step. */
async function seedPage() {
  const line = (id: string, section: "know" | "against", text: string) => ({ id, section, text, by: "qalam" as const, cites: [`hub:quote:${id}`], from: [], at: 1 });
  const t: Topic = {
    id: "checkout",
    kind: "need",
    title: "I can't get through checkout on my first order",
    products: [],
    createdAt: 1,
    updatedAt: 1,
    lines: [line("k1", "know", "Sara gave up on her first order at the delivery slot step, before payment."), line("a1", "against", "Omar says the payment screen would not have made him leave: “I wouldn't have left because of that.”")],
    history: [],
  };
  await store.putTopic(t);
}

const req: CheckRequest = {
  origin: "dump:notes",
  asked: "I think the checkout itself is the problem. What should we do?",
  product: null,
  outline: [{ id: "g", kind: "outcome", title: "More first-time parents complete checkout", parent: null }],
  items: [
    { id: "plan:p", kind: "opportunity", title: "Paying for my first order feels clunky", parent: "g", assumed: true },
    { id: "sol:a", kind: "solution", title: "Apple Pay and Google Pay", parent: "plan:p" },
    { id: "sol:b", kind: "solution", title: "Better error messages on card failures", parent: "plan:p" },
  ],
};

describe("checking a round of proposals in the core", () => {
  it("breaks a2's payment plan with its own funnel and its checkout page, and keeps the run with its review", async () => {
    await seedFunnel();
    await seedPage();
    const sent: string[] = [];
    const structured = vi.fn(async (call: { kind: string; content: { text: string }[] }) => {
      sent.push(call.content[0].text);
      return { data: { challenges: [{ on: ["p2"], line: "Omar said “I wouldn't have left because of that.” about the payment screen.", settle: "Ask parents who left at payment.", cites: [sent[0].match(/- (e\d+) · against/)![1]] }] }, model: "test-model" };
    });
    const run = await challengeProposals(store, req, () => {}, new AbortController().signal, { structured: structured as never });
    expect(structured).toHaveBeenCalledOnce();
    // The page found by its words: the new problem shares "first order" with it.
    expect(sent[0]).toContain("against, on their problem page · I can't get through checkout on my first order");
    expect(run.challenges.map((c) => [c.kind, c.by])).toEqual([
      ["funnel-gap", "code"],
      ["funnel-step", "code"],
      ["evidence", "qalam"],
    ]);
    const step = run.challenges[1];
    expect(step.line).toBe("In “a2-funnel”, 4,400 of 10,000 leave at Picked a delivery slot, against 454 at Payment page reached, the step these work on.");
    // What it rests on is the source's own measured points, so a kept one can carry them onto the card.
    expect(step.cites[0]).toMatchObject({ kind: "measured", sourceId: "funnel", quoteId: "q2", piece: "hub:quote:q2" });
    expect((await store.getChallengeRun("dump:notes"))?.id).toBe(run.id);
    expect(await readdir(path.join(dir, "chats/challenge/traces"))).toHaveLength(1);
  });

  it("makes no call when nothing in the project bears on the proposals", async () => {
    const structured = vi.fn();
    const run = await challengeProposals(store, req, () => {}, new AbortController().signal, { structured: structured as never });
    expect(structured).not.toHaveBeenCalled();
    expect(run.challenges).toEqual([]);
    expect(run.note).toMatch(/nothing to check them against/);
  });

  it("stands what code found when the call fails", async () => {
    await seedFunnel();
    const run = await challengeProposals(store, req, () => {}, new AbortController().signal, { structured: (async () => { throw new Error("offline"); }) as never });
    expect(run.challenges.map((c) => c.kind)).toEqual(["funnel-gap", "funnel-step"]);
    expect(run.note).toMatch(/couldn't check them \(offline\)/);
  });

  it("never raises again what they dropped, for the team, until it's brought back", async () => {
    await seedFunnel();
    const none = { structured: (async () => ({ data: { challenges: [] } })) as never };
    const first = await challengeProposals(store, req, () => {}, new AbortController().signal, none);
    const step = first.challenges.find((c) => c.kind === "funnel-step")!;
    await decideChallenge(store, { origin: "dump:notes", id: step.id, state: "dropped" });
    expect(await readFile(path.join(dir, "hub/challenges.jsonl"), "utf8")).toContain(`"drop":"${step.key}"`);
    const again = await challengeProposals(store, req, () => {}, new AbortController().signal, none);
    expect(again.challenges.map((c) => c.kind)).toEqual(["funnel-gap"]);
    // Brought back on the run it was dropped on: raised again next time.
    await store.putChallengeRun(first);
    await decideChallenge(store, { origin: "dump:notes", id: step.id, state: "dropped" });
    await decideChallenge(store, { origin: "dump:notes", id: step.id, state: null });
    expect((await challengeProposals(store, req, () => {}, new AbortController().signal, none)).challenges.map((c) => c.kind)).toEqual(["funnel-gap", "funnel-step"]);
  });

  it("carries what they kept onto the cards they accepted, in their words when they changed it", async () => {
    await seedFunnel();
    const run = await challengeProposals(store, req, () => {}, new AbortController().signal, { structured: (async () => ({ data: { challenges: [] } })) as never });
    const step = run.challenges.find((c) => c.kind === "funnel-step")!;
    const gap = run.challenges.find((c) => c.kind === "funnel-gap")!;
    await decideChallenge(store, { origin: "dump:notes", id: step.id, state: "changed", words: "The export is all users, but the slot still loses ten times what payment does." });
    await decideChallenge(store, { origin: "dump:notes", id: gap.id, state: "kept" });
    // The gap is about the whole set: no card to carry it onto.
    expect(await carryChallenges(store, { origin: "dump:notes", product: null, cards: [{ item: "sol:a", card: "c-apple" }, { item: "plan:p", card: "c-pay" }] })).toBe(2);
    const { challenged } = await store.noticeState();
    expect(challenged.map((n) => [n.kind, n.card, n.title])).toEqual([
      ["challenge", "c-apple", "The export is all users, but the slot still loses ten times what payment does."],
      ["challenge", "c-pay", "The export is all users, but the slot still loses ten times what payment does."],
    ]);
    expect(challenged[0].why).toBe("From “a2-funnel”");
  });
});
