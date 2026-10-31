import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceRecord } from "@/discovery/sources";
import { OrgStore } from "./store";

// The model, as tests stand it in; no index here, so the words are the person's answers.
const structured = vi.fn();
vi.mock("@/ai/server", () => ({ structured: (...a: unknown[]) => structured(...a) }));
vi.mock("../index/registry", () => ({
  indexFor: () => {
    throw new Error("No index in tests");
  },
}));

const { decideProblem, draftProblems } = await import("./problems");

let dir: string;
let store: OrgStore;

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-problems-")), "Basket");
  store = await OrgStore.create(dir, { id: "org1", name: "Basket", createdAt: 1 });
  structured.mockReset();
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

/** The person's answers about the goal's card, as a source of their own words. */
const answers = (): SourceRecord => ({
  v: 1,
  id: "ans1",
  projectId: "",
  kind: "dump",
  title: "Your answers: More customers reorder every week",
  text: "What do you know about it?\nMost people stop after their second order",
  addedAt: 1,
  read: [],
  needs: [],
  quotes: [{ id: "ans1-know", text: "Most people stop after their second order", span: [27, 69], kind: "idea", role: "evidence", addedBy: "user", at: 1 }],
  answers: { v: 1, card: "g1", goal: "g1", topic: null, step: "draft-problems", buckets: [], found: [], at: 1 },
});

const page = (id: string, title: string) => ({ id, kind: "need" as const, title, products: [], createdAt: 1, updatedAt: 1, lines: [], history: [] });

describe("drafting a goal's problems in the core", () => {
  it("hears the goal, what's behind it and on the pages, and their answers; keeps the drafts on the goal until each is decided", async () => {
    const { goal } = await store.createGoal({ title: "More customers reorder every week" });
    await store.putSource(answers());
    await store.putTopic(page("late", "Late-night orders arrive missing items"));
    await store.putTopic(page("subs", "Substitutions break trust"));
    await store.addBearings([{ need: "late", goal: goal.id, bears: "direct", how: "Missing items stop the next order", cites: [], by: "qalam", at: 1 }]);
    structured.mockResolvedValue({
      data: {
        problems: [
          { title: "Shoppers stop after their second order", description: "", why: "Keeping them past it is the weekly habit.", cites: ["q1"] },
          { title: "Substitutions break trust", description: "", why: "", cites: ["q1"] },
        ],
        note: "",
      },
    });
    const r = await draftProblems(store, goal.id, { cards: ["Checkout fails with a gift card"], answers: "ans1" }, () => {});
    const sent = structured.mock.calls[0][0];
    expect(sent.kind).toBe("draft-problems");
    const text = sent.content[0].text as string;
    expect(text).toContain("The goal: “More customers reorder every week” · no number yet");
    // Behind it: the card under it and the page linked to it; the other page is Find its problems'.
    expect(text).toContain("Problems behind it already (don't propose these again):\n- Checkout fails with a gift card\n- Late-night orders arrive missing items");
    expect(text).toContain("Problem pages the organization has (Find its problems links these; don't propose them again):\n- Substitutions break trust");
    expect(text).toContain("- q1 · the team · Their answers · “Most people stop after their second order”");
    // A page's problem isn't drafted again; the kept one rests on their answer, its words found where they live.
    expect(r.drafts.map((d) => d.title)).toEqual(["Shoppers stop after their second order"]);
    expect(r.quotes).toEqual({ "hub:quote:ans1-know": { sourceId: "ans1", quoteId: "ans1-know" } });
    const work = (await store.getGoalWork(goal.id)).problems!;
    expect(work.drafts).toHaveLength(1);
    expect(work.quotes).toEqual(r.quotes);
    await decideProblem(store, goal.id, r.drafts[0].id, "accepted");
    expect((await store.getGoalWork(goal.id)).problems!.decided).toEqual({ [r.drafts[0].id]: "accepted" });
    await expect(decideProblem(store, goal.id, "nope", "discarded")).rejects.toThrow("No such draft");
  });

  it("refuses a goal that isn't there", async () => {
    await expect(draftProblems(store, "nope", { cards: [] }, () => {})).rejects.toThrow("No such goal");
    expect(structured).not.toHaveBeenCalled();
  });
});
