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
const { briefRequestOf, writeCardBrief } = await import("./briefs");

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

  it("for a solution: what to build first, what would prove it wrong, its test and what waits", async () => {
    const meta = await writeCardBrief(store, { card: { ...words({ title: "Shift-based plans", description: "Plans around the rota.", assumptions: ["Nurses will enter their rota."], tests: [{ what: "Try it with 5", how: "By hand.", suggested: "3 of 5" }], topic: null, evidence: [{ text: "As a night nurse I never know when to eat on my shift.", kind: "quote", sourceId: "s1" }] }), id: "c2", kind: "solution" }, goal: { title: "5 of 10 sign up", metric: "Signed up" }, problem: words({ title: "Meals don't fit", topic: await topicId() }), under: [], others: ["Another way"], asked: { platform: "A web app" } }, undefined, answers([]));
    const { body } = (await store.getBrief(meta.id))!;
    for (const part of ["## The goal", "5 of 10 sign up. Measured as: Signed up.", "## Build first", "Shift-based plans", "## What would prove it wrong", "Nurses will enter their rota.", "## Test it first", "A suggested pass line, yours to change: 3 of 5", "- Another way", "It runs first: A web app."]) expect(body).toContain(part);
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

  it("takes a quote only as its source has it, and asks no model with no words to rest a feature on", async () => {
    let asked = 0;
    const meta = await writeCardBrief(store, { card: { ...words({ title: "Bare", evidence: [{ text: "Words its source never had.", kind: "quote", sourceId: "s1" }] }), id: "c3", kind: "solution" }, goal: null, problem: null, under: [], others: [], asked: {} }, undefined, asks(() => asked++));
    const { body } = (await store.getBrief(meta.id))!;
    expect(body).not.toContain("Words its source never had");
    expect(asked).toBe(0);
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
});
