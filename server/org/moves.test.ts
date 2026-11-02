import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketDeps } from "./market";
import { OrgStore } from "./store";

// Nothing here reaches the web or a model: every look gets its stand-ins.
vi.mock("@/ai/server", () => ({
  research: () => Promise.reject(new Error("No web in tests")),
  structured: () => Promise.reject(new Error("No model in tests")),
}));
vi.mock("../index/registry", () => ({
  indexFor: () => {
    throw new Error("No index in tests");
  },
}));

const { goalsForProblem, suggestGoalNumber } = await import("./moves");

let dir: string;
let store: OrgStore;
let goal: string;
const signal = new AbortController().signal;

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-moves-")), "Qalam");
  store = await OrgStore.create(dir, { id: "org1", name: "Basket", createdAt: 1 });
  goal = (await store.createGoal({ title: "More orders every week", metric: { name: "Weekly orders", direction: "increase", baseline: null, current: 5780, target: 8000 } })).goal.id;
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

const page = { url: "https://example.com/grocery", title: "Grocery benchmarks", text: "Across grocery apps in 2025, 54% of people who open the app start a basket." };

const deps = (o: { bearings?: unknown[]; web?: boolean; number?: unknown } = {}) => {
  const research = vi.fn(async () => (o.web === false ? null : { notes: "- 54% start a basket [Grocery benchmarks](https://example.com/grocery)", sources: [{ title: page.title, url: page.url }], steps: [] }));
  const structured = vi.fn(async (call: { kind: string }) => ({
    data:
      call.kind === "bearings"
        ? { bearings: o.bearings ?? [], none: "" }
        : call.kind === "goal-ideas"
          ? { goals: [{ title: "More people who open the app start a basket", metric_name: "Basket starts per open", unit: "%", direction: "increase", why: "It's the step they don't take.", others: [{ what: "Opens that start a basket", value: 54, unit: "%", who: "Grocery apps, 2025", quote: "54% of people who open the app start a basket", page: "w1" }] }] }
          : call.kind === "claims"
            ? { claims: [{ what: "Opens that start a basket", value: 54, unit: "%", who: "Grocery apps, 2025", quote: "54% of people who open the app start a basket", page: "w1" }] }
            : (o.number ?? { target: 50, move: null, timeframe: "", why: "Grocery apps reach 54%.", others: ["b1"] }),
  }));
  const d = { research, read: vi.fn(async (l: { url: string }) => (l.url === page.url ? { ref: "", ...page } : null)), structured } as unknown as MarketDeps;
  return { d, research, structured };
};

const asked = (over = {}) => ({ title: "I open the app but never start a basket", words: ["41% of sessions start a basket"], goals: [goal], ...over });

describe("the goal a problem could move", () => {
  it("says the goal on the canvas it would move, and doesn't go to the web", async () => {
    const { d, research } = deps({ bearings: [{ problem: "t1", goal: "g1", bears: "direct", how: "Fewer lost sessions mean more weekly orders.", cites: ["l1"] }] });
    const r = await goalsForProblem(store, asked(), () => {}, signal, d);
    expect(r.fits).toEqual([{ goal, title: "More orders every week", bears: "direct", how: "Fewer lost sessions mean more weekly orders." }]);
    expect(r.ideas).toEqual([]);
    expect(research).not.toHaveBeenCalled();
  });

  it("goes to the web when none fits, and proposes goals with what others report checked on its page", async () => {
    const { d, research } = deps({ bearings: [] });
    const r = await goalsForProblem(store, asked(), () => {}, signal, d);
    expect(research).toHaveBeenCalledOnce();
    expect(r.fits).toEqual([]);
    expect(r.ideas[0]).toMatchObject({ title: "More people who open the app start a basket", metric: { name: "Basket starts per open" } });
    expect(r.ideas[0].others[0]).toMatchObject({ value: 54, url: page.url });
    expect(r.looked).toEqual({ goals: 1, pages: [{ title: page.title, url: page.url }] });
  });

  it("goes straight to the web with no goals on the canvas, or when they ruled them out", async () => {
    for (const over of [{ goals: [] }, { look: true }]) {
      const { d, structured } = deps();
      await goalsForProblem(store, asked(over), () => {}, signal, d);
      expect(structured.mock.calls.map(([c]) => c.kind)).toEqual(["goal-ideas"]);
    }
  });

  it("still proposes goals where the web can't be reached, saying so", async () => {
    const { d } = deps({ web: false });
    const r = await goalsForProblem(store, asked({ goals: [] }), () => {}, signal, d);
    expect(r.looked).toEqual({ noWeb: true, pages: [] });
    expect(r.ideas[0].others).toEqual([]);
  });

  it("writes nothing: the goal is the person's to take", async () => {
    const { d } = deps();
    const before = (await store.getGoals()).goals.length;
    await goalsForProblem(store, asked({ goals: [] }), () => {}, signal, d);
    expect((await store.getGoals()).goals).toHaveLength(before);
  });

  it("uses what a problem's page was linked to before, for nothing, and leaves out a link a person took off", async () => {
    const topic = { id: "start-basket", kind: "need" as const, title: "I never start a basket", products: [], createdAt: 1, updatedAt: 1, lines: [], history: [] };
    await store.putTopic(topic);
    await store.addBearings([{ need: topic.id, goal, bears: "some", how: "It feeds weekly orders.", cites: [], by: "qalam", at: 1 }]);
    const linked = deps();
    const r = await goalsForProblem(store, asked({ topic: topic.id }), () => {}, signal, linked.d);
    expect(r.fits[0]).toMatchObject({ goal, how: "It feeds weekly orders." });
    expect(linked.structured).not.toHaveBeenCalled();
    await store.addBearings([{ need: topic.id, goal, by: "you", removed: true, at: 2 }]);
    const refused = deps({ bearings: [{ problem: "t1", goal: "g1", bears: "direct", how: "It feeds weekly orders.", cites: ["l1"] }] });
    expect((await goalsForProblem(store, asked({ topic: topic.id }), () => {}, signal, refused.d)).fits).toEqual([]);
  });
});

describe("a number suggested for a goal", () => {
  const metric = { name: "Basket starts per open", unit: "%", direction: "increase" as const };
  const numberAsked = (over = {}) => ({ goal: "More people start a basket", metric, now: 41, problem: "Never start", others: [], ...over });

  it("looks up what others report, and rests on it", async () => {
    const { d, research } = deps();
    const { suggestion } = await suggestGoalNumber(store, numberAsked(), () => {}, signal, d);
    expect(research).toHaveBeenCalledOnce();
    expect(suggestion).toMatchObject({ target: 50 });
    expect(suggestion?.others[0].value).toBe(54);
  });

  it("doesn't look again when it has enough to go on", async () => {
    const b = { id: "b1", what: "x", value: 54, who: "y", quote: "54", url: page.url, title: "t", at: 1 };
    const { d, research } = deps();
    await suggestGoalNumber(store, numberAsked({ others: [b, { ...b, id: "b2", value: 60 }] }), () => {}, signal, d);
    expect(research).not.toHaveBeenCalled();
  });

  it("still suggests from what Qalam AI knows where the web can't be reached, resting on nothing", async () => {
    const { d } = deps({ web: false, number: { target: 48, move: null, timeframe: "", why: "From what I know of companies like yours.", others: [] } });
    const { suggestion } = await suggestGoalNumber(store, numberAsked(), () => {}, signal, d);
    expect(suggestion).toMatchObject({ target: 48, others: [] });
  });
});
