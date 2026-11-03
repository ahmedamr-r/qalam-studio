import { mkdtemp, readFile, rm } from "node:fs/promises";
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
const { firstBuild, keepAnswers, keepAudience, planAudiences, planMaterial, planQuestions, writeBrief } = await import("./scan-plan");

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

  it("doesn't ask again what they answered while it read, and tells Qalam AI not to", async () => {
    const who = "Who do you picture using this first?";
    const none = await planQuestions(store, { target, sources: ["s1"], told: [{ question: who, answer: "Night nurses" }] }, undefined, { structured: async () => { throw new Error("no"); }, draft: async () => { throw new Error("no"); } });
    expect(none.map((q) => q.title)).not.toContain(who);
    expect(none.length).toBeGreaterThan(0);
    let heard = "";
    await planQuestions(store, { target, sources: ["s1"], told: [{ question: who, answer: "Night nurses" }] }, undefined, {
      structured: (async (call: { content: { text: string }[] }) => {
        heard = call.content[0].text;
        return { data: { questions: [] } };
      }) as never,
      draft: async () => { throw new Error("no"); },
    });
    expect(heard).toContain("never ask it again");
    expect(heard).toContain("Night nurses");
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

  describe("the brief", () => {
    const put = async () => {
      const topic = (await store.listTopics()).find((t) => t.title === "Meals don't fit night shifts")!;
      await store.changeSolutions(topic.id, () => ({ qalam: "solutions/1", topic: topic.id, at: 1, note: "", decided: {}, drafts: [{ ...draft("d1"), assumptions: [{ id: "a1", category: "usability", text: "Nurses will set their shifts.", importance: 3 }] }, draft("d2")] }));
      return topic.id;
    };
    const base = (topic: string) => ({ target, sources: ["s1"], topic, draft: "d1", audience: "Night nurses", goal: { title: "5 of 10 night nurses sign up", metric: "Signed up, of 10 asked" }, answers: "", why: "It answers the night shift directly.", later: [{ draft: "d2", why: "It can wait." }], asked: { platform: "A web app" }, known: [] });

    it("writes a file from what's kept, each feature resting on quotes, and reads the draft itself", async () => {
      const topic = await put();
      let heard = "";
      const r = await writeBrief(store, base(topic), undefined, {
        structured: (async (call: { content: { text: string }[] }) => {
          heard = call.content[0].text;
          return { data: { features: [{ title: "Set your shifts", why: "Plans assume daytime.", acceptance: ["A nurse can enter a week of shifts"], data: ["Shifts"], connects: [], quotes: ["q1"] }, { title: "Made up", why: "Plans assume daytime.", acceptance: ["It works"], data: [], connects: [], quotes: [] }] } };
        }) as never,
        draft: async () => {
          throw new Error("no");
        },
      });
      expect(heard).toContain("It runs first: A web app");
      expect(heard).toContain("As a night nurse I never know when to eat on my shift.");
      expect(r?.features.map((f) => f.title)).toEqual(["Set your shifts"]);
      expect(r?.file).toMatch(/^hub\/briefs\/draft-d1.*\.md$/);
      expect(r?.markdown).toContain("# Build brief: Draft d1");
      expect(r?.markdown).toContain("- Draft d2: It can wait.");
      expect(r?.markdown).toContain("“As a night nurse I never know when to eat on my shift.” ([Reviews](https://x.example))");
      expect(await readFile(path.join(dir, r!.file), "utf8")).toBe(r!.markdown);
    });

    it("still writes what's decided when the call fails, and writes nothing about a draft that's gone", async () => {
      const topic = await put();
      const fails = { structured: (async () => { throw new Error("No engine"); }) as never, draft: async () => { throw new Error("no"); } };
      const r = await writeBrief(store, base(topic), undefined, fails);
      expect(r?.features).toEqual([]);
      expect(r?.markdown).toContain("## Who it's for first");
      expect(r?.markdown).not.toContain("### What to build");
      expect(await writeBrief(store, { ...base(topic), draft: "gone" }, undefined, fails)).toBeNull();
    });

    it("gives each brief a file of its own", async () => {
      const topic = await put();
      const fails = { structured: (async () => { throw new Error("No engine"); }) as never, draft: async () => { throw new Error("no"); } };
      const a = await writeBrief(store, base(topic), undefined, fails);
      const b = await writeBrief(store, base(topic), undefined, fails);
      expect(a?.file).not.toBe(b?.file);
    });
  });
});
