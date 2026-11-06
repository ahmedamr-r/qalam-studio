import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyAsking } from "@/asking/engine";
import { askingIn } from "@/asking/wire";
import { OrgStore } from "./store";

// Nothing here reaches a model: the turn's answer is a stand-in.
vi.mock("@/ai/server", () => ({ structured: () => Promise.reject(new Error("No model in tests")) }));
vi.mock("../lab", () => ({ labOn: async () => [] }));
vi.mock("../index/registry", () => ({
  indexFor: () => {
    throw new Error("No index in tests");
  },
}));

const { AskCardBody, askCard, cardMaterial } = await import("./ask-card");

let dir: string;
let store: OrgStore;

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-ask-card-")), "Qalam");
  store = await OrgStore.create(dir, { id: "org1", name: "Basket", createdAt: 1 });
});
afterEach(async () => {
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

const body = (o: { found?: { id: string; text: string; source: string; whose: string }[] } = {}) =>
  AskCardBody.parse({
    card: { kind: "opportunity", title: "Parents miss the delivery window", description: "", above: ["Goal: Weekly orders up 20%"] },
    step: "draft-solutions",
    found: o.found ?? [],
    asking: askingIn(emptyAsking(), { said: "" }),
  });
const stub = (answer: unknown) => ({ structured: vi.fn(async () => ({ data: answer, model: "test" })) }) as never;
const signal = () => new AbortController().signal;
const q = (id: string, title: string, after: string[] = []) => ({ id, title, why: "It changes which way is drafted", multi: false, options: [{ value: "a", label: "Yes", description: "" }, { value: "b", label: "No", description: "" }], recommended: ["a"], allowOther: true, after });

describe("a turn of the questions before a card's draft", () => {
  it("asks what it can now, says what waits on what, and keeps only lookups this flow runs", async () => {
    const answer = {
      questions: [q("q1", "Do parents pick the window themselves?"), q("q2", "Which window do they miss most?", ["q1"])],
      lookups: [
        { id: "x1", kind: "project", query: "missed delivery window" },
        { id: "x2", kind: "online", query: "what parents say" },
      ],
      done: false,
      understood: [],
      terms: [],
      role: "idea",
    };
    const t = await askCard(store, body(), () => {}, signal(), stub(answer));
    expect(t.questions.map((x) => [x.id, x.after ?? []])).toEqual([
      ["q1", []],
      ["q2", ["q1"]],
    ]);
    // People online is code's own look in the background, never a turn's.
    expect(t.lookups.map((l) => l.kind)).toEqual(["project"]);
    expect(t.role).toBe("idea");
    expect(t.done).toBe(false);
  });

  it("may say nothing's open, and the draft runs at once", async () => {
    const t = await askCard(store, body(), () => {}, signal(), stub({ questions: [], lookups: [], done: true, understood: [], terms: [], role: "none" }));
    expect(t).toMatchObject({ questions: [], lookups: [], done: true, role: null });
  });

  it("reads what was found by whose words it holds, with the ids it can cite", () => {
    const m = cardMaterial("", body({ found: [{ id: "l0-1", text: "We missed the 6pm slot twice", source: "Interview 3", whose: "people said" }, { id: "bg-online-1", text: "The slots fill by noon", source: "App Store", whose: "people online" }] }));
    expect(m).toContain("- l0-1 · people said · Interview 3 · “We missed the 6pm slot twice”");
    expect(m).toContain("- bg-online-1 · people online · App Store");
    expect(m).toContain("What comes next: Draft solutions for it");
  });
});
