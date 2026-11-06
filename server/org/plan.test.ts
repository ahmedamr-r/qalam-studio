import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutlineCard, PlanLook, PlanRound } from "@/space/plan";
import type { MarketDeps } from "./market";
import { OrgStore } from "./store";

// Nothing here reaches the web or a model: every call gets its stand-ins.
vi.mock("@/ai/server", () => ({
  research: () => Promise.reject(new Error("No web in tests")),
  structured: () => Promise.reject(new Error("No model in tests")),
}));
vi.mock("../index/registry", () => ({
  indexFor: () => {
    throw new Error("No index in tests");
  },
}));

const { lookForPlan, planBodyOf, planNext, proposePlan, routeQuestion } = await import("./plan");

let dir: string;
let store: OrgStore;

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-plan-")), "Qalam");
  store = await OrgStore.create(dir, { id: "org1", name: "Reviewly", createdAt: 1 });
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

const outline: OutlineCard[] = [
  { id: "G", kind: "outcome", title: "5 of 10 owners pay", parent: null },
  { id: "P", kind: "opportunity", title: "Reviews are hard to get", parent: "G" },
];
const body = (o: { rounds?: PlanRound[]; looks?: PlanLook[] } = {}) => ({ said: "What should I build? What modules?", outline, rounds: o.rounds ?? [], looks: o.looks ?? [] });
const page = { url: "https://example.com/sms", title: "SMS for reviews", text: "Businesses text customers through Twilio after a visit." };
const signal = () => new AbortController().signal;

const deps = (answer: unknown, web = true) => {
  const research = vi.fn(async () => (web ? { notes: "- They text [SMS for reviews](https://example.com/sms)", sources: [{ title: page.title, url: page.url }], steps: [] } : null));
  const structured = vi.fn(async () => ({ data: answer, model: "test" }));
  return { d: { research, read: vi.fn(async () => ({ ref: "", ...page })), structured } as unknown as MarketDeps, research, structured };
};

describe("a look on the web for a plan", () => {
  it("keeps a line only where its quote is on its page, and keeps nothing on the organization", async () => {
    const { d, research } = deps({ lines: [{ text: "They text customers", quote: "Businesses text customers through Twilio", page: "w1" }, { text: "Made up", quote: "Not on the page at all", page: "w1" }] });
    const look = await lookForPlan(store, body(), () => {}, signal(), d);
    expect(look.lines.map((l) => l.text)).toEqual(["They text customers"]);
    expect(look.pages).toEqual([{ title: page.title, url: page.url }]);
    expect((research.mock.calls[0] as unknown as [{ purpose: string; task: string }])[0]).toMatchObject({ purpose: "plan" });
  });

  it("says there's no web here rather than failing, and asks no model", async () => {
    const { d, structured } = deps({ lines: [] }, false);
    const look = await lookForPlan(store, body(), () => {}, signal(), d);
    expect(look).toMatchObject({ noWeb: true, lines: [], pages: [] });
    expect(structured).not.toHaveBeenCalled();
  });

  it("stops when it's stopped", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(lookForPlan(store, body(), () => {}, ctrl.signal, deps({ lines: [] }).d)).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("a turn of the plan's interview", () => {
  const q = (id: string, title: string, after: string[] = []) => ({ id, title, why: "", multi: false, options: [], recommended: [], allowOther: false, from: "none", look_for: "", after });
  const asked = (rounds: { id: string; title: string; answer: string; how: "own" | "pick" | "left" }[][]) => ({ rounds: rounds.map((asked) => ({ asked })), lookups: [], held: [], understood: [], proposed: [], said: "What should I build?" });

  it("asks code's own questions when a first turn fails, and fails a later one for Try again", async () => {
    const failing = { structured: vi.fn(async () => { throw new Error("No engine"); }) };
    const first = await planNext(store, body(), () => {}, signal(), failing as never);
    expect(first.questions.map((x) => x.id)).toEqual(["who", "exists", "reach"]);
    expect(first.questions.every((x) => x.by === "code" && x.allowOther)).toBe(true);
    await expect(planNext(store, { ...body(), asking: asked([[{ id: "who", title: "Who pays first?", answer: "Salons", how: "own" }]]) }, () => {}, signal(), failing as never)).rejects.toThrow("No engine");
  });

  it("keeps every question it can ask now, what one waits on, and its lookups; never a question asked before; and keeps a trace", async () => {
    const answer = { questions: [q("q1", "Who pays first?"), q("q2", "Which channel reaches them?"), q("q3", "What does an SMS cost you?", ["l1"]), q("q4", "How soon do you need it?"), q("q5", "Who is it for?")], lookups: [{ id: "l1", kind: "web", query: "SMS cost for salons" }], done: false, understood: [{ text: "They want something salons pay for", from: ["said"] }], terms: [], choices: [] };
    const turn = await planNext(store, { ...body(), asking: asked([[{ id: "who", title: "Who pays first?", answer: "Salons", how: "own" }]]) }, () => {}, signal(), deps(answer).d);
    expect(turn.questions.map((x) => x.title)).toEqual(["Which channel reaches them?", "What does an SMS cost you?", "How soon do you need it?", "Who is it for?"]);
    expect(turn.questions.find((x) => x.title === "What does an SMS cost you?")?.after).toEqual(["l1"]);
    expect(turn.lookups).toEqual([{ id: "l1", kind: "web", query: "SMS cost for salons" }]);
    expect(turn.questions.every((x) => x.allowOther)).toBe(true);
    expect(await readdir(path.join(dir, "chats/plan/traces"))).toHaveLength(1);
  });

  it("has no limit on rounds: a ninth round's questions are kept like the first's", async () => {
    const many = Array.from({ length: 8 }, (_, i) => [{ id: `r${i}`, title: `Question number ${i + 1} about salons`, answer: "Yes", how: "own" as const }]);
    const turn = await planNext(store, { ...body(), asking: asked(many) }, () => {}, signal(), deps({ questions: [q("n", "How many salons have you spoken to?")], lookups: [], done: false, understood: [], terms: [], choices: [] }).d);
    expect(turn.questions.map((x) => x.title)).toEqual(["How many salons have you spoken to?"]);
  });
});

describe("what a plan proposes", () => {
  it("keeps cards with nothing to back them, saying so, and keeps the call's trace", async () => {
    const answer = { cards: [{ ref: "n1", kind: "solution", under: "c2", title: "Text customers after a visit", description: "", why: "", type: "message", how: "SMS", needed: "no", helps: [], cites: [], metric: { name: "", target: "" }, assumptions: [], test: { assumption: "", what: "", how: "", pass: "" } }], start: "n1", doubt: "Nobody has said they'd pay." };
    const draft = await proposePlan(store, body(), () => {}, signal(), deps(answer).d);
    expect(draft.cards.map((c) => [c.title, c.type, c.came, c.under])).toEqual([["Text customers after a visit", "message", "idea", { card: "P" }]]);
    expect(draft.start).toBe("n1");
    expect(draft.doubt).toBe("Nobody has said they'd pay.");
    expect(await readdir(path.join(dir, "chats/plan/traces"))).toHaveLength(1);
  });
});

describe("how a question is taken", () => {
  it("is what the call says, and a plain question if it can't tell", async () => {
    expect(await routeQuestion("What should I build?", signal(), deps({ route: "plan" }).d)).toEqual({ route: "plan" });
    expect(await routeQuestion("How many sources mention refunds?", signal(), deps({ route: "ask" }).d)).toEqual({ route: "ask" });
    const failing = { structured: vi.fn(async () => { throw new Error("No engine"); }) };
    expect(await routeQuestion("Anything?", signal(), failing as never)).toEqual({ route: "ask" });
  });
});

describe("a plan's request as it came in", () => {
  it("needs words, and keeps the outline to its shape", () => {
    expect(planBodyOf({ said: "  " })).toBeNull();
    expect(planBodyOf(null)).toBeNull();
    const b = planBodyOf({ said: "What now?", outline: [{ id: "a", kind: "solution", title: "T", parent: "p", type: "message" }, { id: "b", kind: "test", title: "No" }, { kind: "outcome" }] });
    expect(b?.outline).toEqual([{ id: "a", kind: "solution", title: "T", parent: "p", type: "message" }]);
    expect(b).toMatchObject({ rounds: [], looks: [] });
  });
});
