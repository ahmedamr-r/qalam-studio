import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceRecord } from "@/discovery/sources";
import { newGoal } from "@/org/context-md";
import { OrgStore } from "./store";

// Qalam AI's answer, faked from what the call was sent; what code keeps of it is real.
const sent = vi.hoisted(() => ({ text: "" }));
vi.mock("@/ai/server", () => ({
  BACKEND: "api",
  aiConfigured: () => true,
  structured: async (opts: { content: { text: string }[] }) => {
    sent.text = opts.content[0].text;
    const need = /- (t\d+) · “Rebuilding my basket takes forever”/.exec(sent.text)?.[1];
    const line = /- (l\d+) · We know: Parents rebuild/.exec(sent.text)?.[1];
    return {
      data: {
        candidates: [
          { title: "More families reorder every week", metric: { name: "Weekly reorders per customer", direction: "increase" }, why: "Parents rebuild the same basket, “every Sunday”.", moves: "Reorders make most of the 2M dirhams.", control: "yes", needs: [need], cites: [need, line] },
          { title: "More families order daily", metric: { name: "Daily orders", direction: "increase" }, why: "Made up, 90% of them.", moves: "More orders.", control: "yes", needs: [need], cites: [line] },
        ],
        note: "",
      },
    };
  },
}));
const { proposeOutcomes } = await import("./outcomes");

let dir: string;
let store: OrgStore;
const at = Date.UTC(2026, 9, 1);

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-outcomes-")), "Basket");
  store = await OrgStore.create(dir, { id: "org1", name: "Basket", createdAt: at });
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

describe("which outcomes would move a goal, in an organization's folder", () => {
  it("sends the goal and the needs, keeps what holds, and brings each need's quotes for a board", async () => {
    const goal = newGoal("2M dirhams a month in orders");
    await store.putAbout({ audience: "Families in Dubai", goals: [goal], context: "", segments: [], strategy: "Be the fastest." });
    const text = "I rebuild the same basket every Sunday, it takes forever.";
    const src: SourceRecord = { v: 1, id: "s1", projectId: "b1", kind: "interview", title: "Sara interview", text, addedAt: at, read: [0], quotes: [{ id: "q1", text, span: [0, text.length], kind: "pain", speaker: "Sara", addedBy: "ai", at }], needs: [] };
    await store.putSource(src);
    await store.fileTopics(
      { create: [{ key: "n1", kind: "need", title: "Rebuilding my basket takes forever", products: [] }], add: [{ topic: "new:n1", section: "know", text: "Parents rebuild the same basket every Sunday.", cites: ["hub:quote:q1"], from: ["Sara interview"], products: [] }], revise: [], retire: [], dispute: [] },
      { from: "test" },
    );
    const topic = (await store.listTopics())[0];
    const r = await proposeOutcomes(store, { product: null, goal: goal.id });
    expect(sent.text).toContain("The goal (Basket's): 2M dirhams a month in orders");
    expect(sent.text).toContain("Strategy: Be the fastest.");
    expect(sent.text).toContain("“Rebuilding my basket takes forever” · raised by 1 voice (1 source)");
    expect(r.candidates.map((c) => c.title)).toEqual(["More families reorder every week"]);
    expect(r.candidates[0].needs).toEqual([topic.id]);
    expect(r.needs[topic.id]).toEqual({ title: "Rebuilding my basket takes forever", quotes: [{ piece: "hub:quote:q1", text, sourceId: "s1", sourceTitle: "Sara interview", span: [0, text.length], speaker: "Sara" }] });
    await expect(proposeOutcomes(store, { product: null, goal: "gNope" })).rejects.toThrow("No such goal");
  });
});
