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

describe("what comes next in a plan", () => {
  it("asks code's own questions when the call fails, or goes on once it has asked", async () => {
    const failing = { structured: vi.fn(async () => { throw new Error("No engine"); }) };
    const first = await planNext(store, body(), () => {}, signal(), failing as never);
    expect(first.action).toBe("ask");
    const rounds: PlanRound[] = [{ questions: [{ id: "q", title: "Who?", why: "", multi: false, options: [], recommended: [], allowOther: true }], answers: { q: "Salons" } }];
    expect((await planNext(store, body({ rounds }), () => {}, signal(), failing as never)).action).toBe("ready");
  });

  it("with no web here, never asks to look again", async () => {
    const looks: PlanLook[] = [{ at: 1, query: "", lines: [], pages: [], noWeb: true, after: -1 }];
    const next = await planNext(store, body({ looks, rounds: [{ questions: [], answers: {} }] }), () => {}, signal(), deps({ action: "look", look: "SMS cost" }).d);
    expect(next.action).not.toBe("look");
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
