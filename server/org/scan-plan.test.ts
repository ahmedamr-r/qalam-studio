import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrgStore } from "./store";
import type { ScanPlanDeps } from "./scan-plan";

vi.mock("@/ai/server", () => ({
  research: () => Promise.reject(new Error("No web in tests")),
  structured: () => Promise.reject(new Error("No model in tests")),
}));
process.env.QALAM_NO_MODELS = "1";
const { firstBuild, keepAnswers, keepAudience, planAudiences, planMaterial, planQuestions } = await import("./scan-plan");

let dir: string;
let store: OrgStore;
const target = { kind: "idea" as const, said: "A meal planner for night nurses" };

const quote = (id: string, text: string, at: number) => ({ id, text, span: [at, at + text.length] as [number, number], kind: "pain" as const, addedBy: "ai" as const, at: 1 });

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-plan-")), "Plans");
  store = await OrgStore.create(dir, { id: "org1", name: "Plans", createdAt: 1 });
  const a = "As a night nurse I never know when to eat on my shift.";
  const b = "Night nurse here, the plan assumes I sleep at night.";
  const c = "My kids hate the recipes it picks.";
  await store.putSource({ v: 1, id: "s1", projectId: "", boards: [], product: null, kind: "post", title: "Reviews", origin: "https://x.example", text: `${a} ${b} ${c}`, addedAt: 1, read: [0], quotes: [quote("q1", a, 0), quote("q2", b, a.length + 1), quote("q3", c, a.length + b.length + 2)], needs: [] });
  await store.fileTopics(
    {
      create: [
        { key: "n1", kind: "need", title: "Meals don't fit night shifts", products: [] },
        { key: "n2", kind: "need", title: "Recipes get rejected", products: [] },
      ],
      add: [
        { topic: "new:n1", section: "believe", text: "Plans assume daytime.", cites: ["hub:quote:q1", "hub:quote:q2"], from: [], products: [] },
        { topic: "new:n2", section: "believe", text: "Kids reject them.", cites: ["hub:quote:q3"], from: [], products: [] },
      ],
      revise: [],
      retire: [],
      dispute: [],
    },
    { from: "test" },
  );
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

const draft = (id: string) => ({ id, title: `Draft ${id}`, description: "Plans around the shift.", cites: { lines: [], pieces: [], goals: [], claims: [], steps: [] }, idea: null, assumptions: [], test: null, at: 1 });

function deps(o: { answer?: unknown } = {}): ScanPlanDeps {
  return {
    structured: vi.fn(async () => ({ data: o.answer ?? {} })) as ScanPlanDeps["structured"],
    draft: vi.fn(async (_s, req) => ({ topic: req.topic, drafts: [draft("one"), draft("two")], note: "", quotes: {} })),
  };
}

describe("from a scan's problems to what comes first", () => {
  it("gathers the scan's cited quotes and the pages they're on", async () => {
    const m = await planMaterial(store, ["s1"]);
    expect(m.problems.map((p) => p.title).sort()).toEqual(["Meals don't fit night shifts", "Recipes get rejected"]);
    expect(m.words.map((w) => w.ref).sort()).toEqual(["hub:quote:q1", "hub:quote:q2", "hub:quote:q3"]);
    expect(m.words[0]).toMatchObject({ source: "Reviews", origin: "https://x.example" });
    expect((await planMaterial(store, ["gone"])).words).toEqual([]);
  });

  it("rests who it's for on people's words alone, and says what's published beside them", async () => {
    const text = "The market for meal planning apps grew 12% last year.";
    await store.putSource({ v: 1, id: "a1", projectId: "", boards: [], product: null, kind: "url", basis: "read", title: "A report", origin: "https://r.example", text, addedAt: 1, read: [0], quotes: [quote("r1", text, 0)], needs: [] });
    await store.fileTopics({ create: [{ key: "n3", kind: "need", title: "Only a report says so", products: [] }], add: [{ topic: "new:n3", section: "believe", text: "It grew.", cites: ["hub:quote:r1"], from: [], products: [] }], revise: [], retire: [], dispute: [] }, { from: "test" });
    const m = await planMaterial(store, ["s1", "a1"]);
    expect(m.words.map((w) => w.ref)).not.toContain("hub:quote:r1");
    expect(m.problems.map((p) => p.title)).not.toContain("Only a report says so");
    expect(m.published).toEqual([`${text} (A report)`]);
  });

  it("asks code's own questions when Qalam AI's can't be had", async () => {
    const d = deps();
    vi.mocked(d.structured).mockRejectedValueOnce(new Error("Limit"));
    const q = await planQuestions(store, { target, sources: ["s1"] }, undefined, d);
    expect(q.length).toBe(3);
    expect(q.every((x) => x.options.length === 0)).toBe(true);
  });

  it("keeps their answers as their own words, and nothing with nothing answered", async () => {
    expect(await keepAnswers(store, [{ question: "Who?", answer: "  " }], "Your answers")).toBeNull();
    const id = (await keepAnswers(store, [{ question: "Who?", answer: "Night nurses I know" }, { question: "Seen it?", answer: "" }], "Your answers"))!;
    const s = (await store.getSource(id))!;
    expect(s.kind).toBe("dump");
    expect(s.answers).toBeTruthy();
    expect(s.quotes.map((q) => q.text)).toEqual(["Night nurses I know"]);
    expect(s.text.slice(s.quotes[0].span[0], s.quotes[0].span[1])).toBe("Night nurses I know");
  });

  it("keeps only audiences its quotes show, and asks no model with too little to read", async () => {
    const d = deps({ answer: { audiences: [{ name: "Night nurses", about: "They can't plan meals.", quotes: ["q1", "q2"] }, { name: "Paramedics", about: "", quotes: ["q1", "q2"] }] } });
    const got = await planAudiences(store, { target, sources: ["s1"], answers: "" }, undefined, d);
    expect(got.map((a) => a.name)).toEqual(["Night nurses"]);
    const none = deps();
    expect(await planAudiences(store, { target, sources: ["gone"], answers: "" }, undefined, none)).toEqual([]);
    expect(none.structured).not.toHaveBeenCalled();
  });

  it("keeps the audience they pick as a segment page, citing what shows them", async () => {
    await keepAudience(store, { name: "Night nurses", about: "They can't plan meals.", refs: ["hub:quote:q1"] });
    await keepAudience(store, { name: "Parents I know", refs: [] });
    const pages = (await store.listTopics()).filter((t) => t.kind === "segment");
    expect(pages.map((t) => t.title).sort()).toEqual(["Night nurses", "Parents I know"]);
    expect(pages.find((t) => t.title === "Night nurses")?.lines[0]).toMatchObject({ section: "believe", cites: ["hub:quote:q1"] });
  });

  it("drafts for the problem the audience's quotes bear on, and picks one", async () => {
    const d = deps({ answer: { pick: "d2", why: "They say “I never know when to eat”.", later: [{ id: "d1", why: "It can wait." }] } });
    const b = (await firstBuild(store, { target, sources: ["s1"], audience: "Parents", refs: ["hub:quote:q3"], answers: "" }, undefined, d))!;
    expect(b.problem).toBe("Recipes get rejected");
    expect(vi.mocked(d.draft).mock.calls[0][1]).toEqual({ topic: b.topic });
    expect(b.pick?.draft).toBe("two");
    expect(b.pick?.why).toBe("");
  });

  it("goes without a pick when nothing was drafted, and with no problem says so", async () => {
    const d = deps();
    vi.mocked(d.draft).mockResolvedValueOnce({ topic: "x", drafts: [], note: "Nothing it could stand behind.", quotes: {} });
    const b = await firstBuild(store, { target, sources: ["s1"], audience: "Parents", refs: [], answers: "" }, undefined, d);
    expect(b).toMatchObject({ drafts: [], pick: null, note: "Nothing it could stand behind." });
    expect(d.structured).not.toHaveBeenCalled();
    expect(await firstBuild(store, { target, sources: ["gone"], audience: "Parents", refs: [], answers: "" }, undefined, deps())).toBeNull();
  });
});
