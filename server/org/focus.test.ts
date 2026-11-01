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

const { lookForGoal } = await import("./focus");

let dir: string;
let store: OrgStore;
let goal: string;

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-focus-")), "Qalam");
  store = await OrgStore.create(dir, { id: "org1", name: "Qalam", createdAt: 1 });
  goal = (await store.createGoal({ title: "More product managers adopt Qalam", metric: { name: "PMs who have adopted Qalam", direction: "increase", baseline: null, current: 40, target: 200 } })).goal.id;
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

const page = { url: "https://example.com/why-pms-drop-tools", title: "Why PMs drop new tools", text: "Most product managers abandon a new tool within two weeks when it does not fit their existing workflow. In our survey, 62% said setup took too long." };

const deps = (o: { web?: boolean; questions?: unknown } = {}) => {
  const research = vi.fn(async (_req: { task: string }, emit: (l: string) => void) => {
    emit("Searched the web: why product managers drop tools");
    return o.web === false ? null : { notes: "- PMs drop tools [Why PMs drop new tools](https://example.com/why-pms-drop-tools)", sources: [{ title: "Why PMs drop new tools", url: page.url }], steps: [] };
  });
  const structured = vi.fn(async (call: { kind: string }) => ({
    data:
      call.kind === "market"
        ? {
            lines: [
              { text: "Product managers abandon a new tool within two weeks when it doesn't fit their workflow.", quote: "abandon a new tool within two weeks when it does not fit their existing workflow", page: "w1" },
              { text: "90% said setup took too long.", quote: "said setup took too long", page: "w1" },
            ],
          }
        : (o.questions ?? { questions: [] }),
  }));
  const d = { research, read: vi.fn(async (l: { url: string }) => (l.url === page.url ? { ref: "", ...page } : null)), structured } as unknown as MarketDeps;
  return { d, research, structured };
};

describe("looking on the web for what gets in a goal's way", () => {
  it("keeps what the pages bear out, keeps the look on the goal, and works out the first questions from it", async () => {
    const { d, research } = deps({
      questions: {
        questions: [
          {
            id: "way",
            title: "Which of these do you see most?",
            why: "So we start where it hurts.",
            multi: false,
            options: [
              { value: "fit", label: "A new tool doesn't fit their workflow", description: "They abandon it within two weeks." },
              { value: "moon", label: "Moon phases", description: "Nothing anyone read." },
              { value: "setup", label: "Setup takes too long", description: "Product managers give up." },
            ],
            recommended: [],
            allowOther: true,
          },
        ],
      },
    });
    const steps: string[] = [];
    const r = await lookForGoal(store, goal, { open: true }, (l) => steps.push(l), new AbortController().signal, d);
    expect(r.look.lines.map((l) => l.text)).toEqual(["Product managers abandon a new tool within two weeks when it doesn't fit their workflow."]);
    expect(r.look).toMatchObject({ query: "", pages: [{ url: page.url }] });
    expect(research.mock.calls[0][0]).toMatchObject({ purpose: "problems", connectors: ["web"] });
    expect(research.mock.calls[0][0].task).toContain("A goal of the company's: “More product managers adopt Qalam”");
    expect(steps).toEqual(["Looking on the web for what usually gets in the way of goals like it", "Searched the web: why product managers drop tools", "Reading the pages it found", "Qalam AI is checking each point on its page", "Qalam AI is working out what to ask you"]);
    // A choice nobody read is left out.
    expect(r.questions[0].options.map((o) => o.value)).toEqual(["fit", "setup"]);
    expect((await store.getGoalWork(goal)).focus?.looks.map((l) => l.lines.length)).toEqual([1]);
  });

  it("looks up what their answers called for, without questions, and says when there's no web here", async () => {
    const { d, research, structured } = deps();
    const r = await lookForGoal(store, goal, { query: "why PMs abandon discovery tools", said: "Setup takes them an afternoon." }, () => {}, new AbortController().signal, d);
    expect(r.look.query).toBe("why PMs abandon discovery tools");
    expect(r.questions).toEqual([]);
    expect(research.mock.calls[0][0].task).toContain("Look up: why PMs abandon discovery tools.");
    expect(structured).toHaveBeenCalledTimes(1);
    const off = await lookForGoal(store, goal, { open: true }, () => {}, new AbortController().signal, deps({ web: false }).d);
    expect(off.look).toMatchObject({ noWeb: true, lines: [] });
    expect((await store.getGoalWork(goal)).focus?.looks).toHaveLength(1);
  });

  it("tells a later look what the latest ones found, and reads pages they didn't read first", async () => {
    await lookForGoal(store, goal, { open: true }, () => {}, new AbortController().signal, deps().d);
    const { d, structured } = deps();
    const other = { title: "Informal buyers", url: "https://example.org/informal-buyers" };
    (d.research as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ notes: "- two pages", sources: [{ title: page.title, url: page.url }, other], steps: [] });
    await lookForGoal(store, goal, { query: "why PMs abandon tools" }, () => {}, new AbortController().signal, d);
    expect((d.read as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].url)).toEqual([other.url, page.url]);
    const sent = (structured.mock.calls[0][0] as unknown as { content: { text: string }[] }).content[0].text;
    expect(sent).toContain("Found on earlier looks (leave these out");
    expect(sent).toContain("- Product managers abandon a new tool within two weeks when it doesn't fit their workflow.");
  });

  it("refuses a goal that isn't there", async () => {
    await expect(lookForGoal(store, "nope", {}, () => {}, new AbortController().signal, deps().d)).rejects.toThrow("No such goal");
  });
});
