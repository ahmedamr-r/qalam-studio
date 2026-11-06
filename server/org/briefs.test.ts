import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrgStore } from "./store";

vi.mock("@/ai/server", () => ({
  research: () => Promise.reject(new Error("No web in tests")),
  structured: () => Promise.reject(new Error("No model in tests")),
}));
process.env.QALAM_NO_MODELS = "1";
vi.mock("../lab", () => ({ labOn: async () => [] }));
const { askBrief, briefRequestOf, writeCardBrief } = await import("./briefs");
const { emptyAsking } = await import("@/asking/engine");
const { askingIn } = await import("@/asking/wire");

let dir: string;
let store: OrgStore;
const quote = (id: string, text: string, at: number) => ({ id, text, span: [at, at + text.length] as [number, number], kind: "pain" as const, addedBy: "ai" as const, at: 1 });
const words = (o: Record<string, unknown> = {}) => ({ title: "A card", description: "", assumptions: [], tests: [], evidence: [], topic: null, ...o });

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-brief-")), "Plans");
  store = await OrgStore.create(dir, { id: "org1", name: "Plans", createdAt: 1 });
  const a = "As a night nurse I never know when to eat on my shift.";
  const b = "Meal planning apps grew 12% last year.";
  await store.putSource({ v: 1, id: "s1", projectId: "", boards: [], product: null, kind: "post", title: "Reviews", origin: "https://x.example", text: a, addedAt: 1, read: [0], quotes: [quote("q1", a, 0)], needs: [] });
  await store.putSource({ v: 1, id: "s2", projectId: "", boards: [], product: null, kind: "url", basis: "read", title: "A report", origin: "https://r.example", text: b, addedAt: 1, read: [0], quotes: [quote("q2", b, 0)], needs: [] });
  await store.fileTopics({ create: [{ key: "n1", kind: "need", title: "Meals don't fit night shifts", products: [] }], add: [{ topic: "new:n1", section: "believe", text: "Plans assume daytime.", cites: ["hub:quote:q1", "hub:quote:q2"], from: [], products: [] }, { topic: "new:n1", section: "open", text: "Would they plan a week ahead?", cites: [], from: [], products: [] }], revise: [], retire: [], dispute: [] }, { from: "test" });
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

const topicId = async () => (await store.listTopics()).find((t) => t.kind === "need")!.id;
const answers = (features: unknown[]) => ({ structured: (async () => ({ data: { features } })) as never });
const asks = (fn: (text: string) => void, features: unknown[] = []) => ({
  structured: (async (call: { content: { text: string }[] }) => {
    fn(call.content[0].text);
    return { data: { features } };
  }) as never,
});

describe("a brief for a card", () => {
  it("for a problem: its page's words behind it, what's read elsewhere apart, a feature resting on people's words", async () => {
    const topic = await topicId();
    let heard = "";
    const meta = await writeCardBrief(store, { card: { ...words({ title: "Meals don't fit night shifts", topic }), id: "c1", kind: "opportunity" }, goal: null, problem: null, under: [], others: [], asked: {} }, undefined, asks((t) => (heard = t), [{ title: "Set your shifts", why: "Plans assume daytime.", acceptance: ["A nurse can enter a week"], data: [], connects: [], quotes: ["q1"] }]));
    expect(meta).toMatchObject({ card: "c1", kind: "opportunity", features: 1 });
    expect(heard).toContain("As a night nurse");
    const { body } = (await store.getBrief(meta.id))!;
    expect(body).toContain("## The problem");
    expect(body).toContain("Plans assume daytime.");
    expect(body).toContain("### 1. Set your shifts");
    expect(body).toContain("Still open:");
    // Read elsewhere: on its own, and nothing rests on it.
    const elsewhere = body.slice(body.indexOf("## Read elsewhere"));
    expect(elsewhere).toContain("Meal planning apps grew 12%");
    expect(body.slice(0, body.indexOf("## Read elsewhere"))).not.toContain("Meal planning apps grew 12%");
  });

  it("for a solution: what to build first, what has to be true, its test and what waits", async () => {
    const meta = await writeCardBrief(store, { card: { ...words({ title: "Shift-based plans", description: "Plans around the rota.", assumptions: ["Nurses will enter their rota."], tests: [{ what: "Try it with 5", how: "By hand.", suggested: "3 of 5" }], topic: null, evidence: [{ text: "As a night nurse I never know when to eat on my shift.", kind: "quote", sourceId: "s1" }] }), id: "c2", kind: "solution" }, goal: { title: "5 of 10 sign up", metric: "Signed up" }, problem: words({ title: "Meals don't fit", topic: await topicId() }), under: [], others: ["Another way"], asked: { platform: "A web app" } }, undefined, answers([]));
    const { body } = (await store.getBrief(meta.id))!;
    for (const part of ["## The goal", "5 of 10 sign up. Measured as: Signed up.", "## Build first", "Shift-based plans", "## What has to be true", "Nurses will enter their rota.", "## Test it first", "A suggested pass line, yours to change: 3 of 5", "- Another way", "It runs first: A web app."]) expect(body).toContain(part);
  });

  it("for a goal: the problems behind it, and no solution picked", async () => {
    const topic = await topicId();
    const meta = await writeCardBrief(store, { card: { ...words({ title: "Reach 100 nurses" }), id: "g1", kind: "outcome" }, goal: { title: "Reach 100 nurses", metric: "Nurses active" }, problem: null, under: [words({ title: "Meals don't fit", topic }), words({ title: "Another problem" })], others: [], asked: {} }, undefined, answers([]));
    const { body } = (await store.getBrief(meta.id))!;
    expect(body).toContain("# Brief: Reach 100 nurses");
    expect(body).toContain("Measured as: Nurses active.");
    expect(body).toContain("## The problems");
    expect(body).toContain("### Another problem");
    expect(body).not.toContain("## Build first");
  });

  it("takes a quote only as its source has it, and still asks for features with no words to rest them on", async () => {
    let asked = 0;
    const meta = await writeCardBrief(store, { card: { ...words({ title: "Bare", evidence: [{ text: "Words its source never had.", kind: "quote", sourceId: "s1" }] }), id: "c3", kind: "solution" }, goal: null, problem: null, under: [], others: [], asked: {} }, undefined, asks(() => asked++));
    const { body } = (await store.getBrief(meta.id))!;
    expect(body).not.toContain("Words its source never had");
    expect(asked).toBe(1);
    expect(body).toContain("Nothing backs this yet");
  });

  it("goes without features when the call fails, and stops when it's stopped", async () => {
    const meta = await writeCardBrief(store, { card: { ...words({ title: "Meals", topic: await topicId() }), id: "c4", kind: "opportunity" }, goal: null, problem: null, under: [], others: [], asked: {} }, undefined, { structured: (async () => { throw new Error("No engine"); }) as never });
    expect(meta.features).toBe(0);
    expect((await store.getBrief(meta.id))!.body).toContain("Plans assume daytime.");
    const stop = new AbortController();
    stop.abort();
    await expect(writeCardBrief(store, { card: { ...words({ title: "Meals", topic: await topicId() }), id: "c5", kind: "opportunity" }, goal: null, problem: null, under: [], others: [], asked: {} }, stop.signal, { structured: (async () => { throw new Error("Stopped"); }) as never })).rejects.toThrow("Stopped");
  });
});

describe("a brief's request", () => {
  it("names a card of a kind that has one, and is kept to what it should be", () => {
    expect(briefRequestOf(null)).toBeNull();
    expect(briefRequestOf({ card: { id: "c", title: "T", kind: "test" } })).toBeNull();
    expect(briefRequestOf({ card: { id: "", title: "T", kind: "solution" } })).toBeNull();
    const r = briefRequestOf({ card: { id: "c", title: " T ", kind: "solution", assumptions: ["A", 3, ""], evidence: [{ text: "E", kind: "quote", sourceId: "s" }, { text: "" }] }, goal: { title: "G" }, under: "nope", others: ["O"], asked: { platform: "Web", other: "x" } })!;
    expect(r.card).toMatchObject({ id: "c", title: "T", kind: "solution", assumptions: ["A"], evidence: [{ text: "E", kind: "quote", sourceId: "s" }] });
    expect(r.goal).toEqual({ title: "G", metric: null });
    expect(r.under).toEqual([]);
    expect(r.asked).toEqual({ platform: "Web" });
  });

  it("keeps what's read on the web apart from their words, with its page", async () => {
    const line = { text: "Sales-assisted products see much higher activation rates.", kind: "read", sourceTitle: "A vendor's blog", url: "https://v.example/post" };
    const req = briefRequestOf({ card: { ...words({ title: "A setup call", evidence: [{ text: "Under 25%", kind: "answer" }, line, { ...line, text: "A line with no page", url: "not a link" }] }), id: "c1", kind: "solution" }, goal: null, problem: null, under: [], others: [], asked: {} })!;
    const meta = await writeCardBrief(store, req, undefined, answers([]));
    const { body } = (await store.getBrief(meta.id))!;
    expect(body).toContain("“Under 25%” (Your words)");
    expect(body).not.toMatch(/Sales-assisted[^\n]*Your words/);
    expect(body.slice(body.indexOf("## Read elsewhere"))).toContain("Sales-assisted products");
    expect(body).toContain("https://v.example/post");
    expect(body).not.toContain("A line with no page");
  });
});

describe("asking before a brief is written", () => {
  const req = () => briefRequestOf({ card: { ...words({ title: "Night meal planner" }), id: "c1", kind: "solution" }, goal: null, problem: null, under: [], others: [], asked: { platform: "A web app", more: [{ question: "Who first?", answer: "Night nurses on the ward" }, { question: "", answer: "dropped" }] } })!;

  it("keeps what else they said, in their words, for the writer and in the file", async () => {
    expect(req().asked).toEqual({ platform: "A web app", more: [{ question: "Who first?", answer: "Night nurses on the ward" }] });
    let heard = "";
    const meta = await writeCardBrief(store, req(), undefined, asks((t) => (heard = t)));
    expect(heard).toContain("Who first? Night nurses on the ward");
    expect((await store.getBrief(meta.id))!.body).toContain("- Who first? Night nurses on the ward");
  });

  it("asks from what it would be written from, and keeps a turn to what it was sent", async () => {
    let heard = "";
    const structured = (async (call: { kind: string; content: { text: string }[] }) => {
      heard = call.content[0].text;
      expect(call.kind).toBe("ask-turn");
      return { data: { questions: [{ id: "q1", title: "What must the first version do?", why: "It decides what waits", multi: false, options: [], recommended: [], allowOther: true, after: [] }], lookups: [{ id: "x", kind: "online", query: "no" }], done: false, understood: [], terms: [] } };
    }) as never;
    const t = await askBrief(store, req(), askingIn(emptyAsking(), { said: "" }), () => {}, undefined, { structured });
    expect(heard).toContain("What's to be written: a brief (a PRD)");
    expect(heard).toContain("What this is a brief for: Night meal planner");
    expect(t.questions.map((q) => q.title)).toEqual(["What must the first version do?"]);
    expect(t.lookups).toEqual([]);
  });
});
