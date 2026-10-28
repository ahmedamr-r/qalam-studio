import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Doc } from "@/doc/schema";
import type { OstCard } from "@/discovery/types";
import type { Project } from "@/projects/model";
import { OrgStore } from "./org/store";

// Qalam AI's answers, faked by what each call asks; what code keeps of them is real.
const calls = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock("@/ai/server", () => ({
  BACKEND: "api",
  aiConfigured: () => true,
  structured: async (opts: { system: string; content: { text: string }[] }) => {
    const text = opts.content[0].text;
    if (opts.system.includes("pick out what customers said")) {
      calls.list.push("extract");
      return { data: { quotes: [{ id: "q1", chunkId: "c1", text: "I can't plan bath time around a four-hour window.", speaker: "Sara", kind: "pain" }, { id: "q2", chunkId: "c1", text: "Words that aren't in the material.", speaker: null, kind: "pain" }], needs: [{ title: "Delivery windows are too wide", quoteIds: ["q1"] }] } };
    }
    if (opts.system.includes("keep an organization's topic pages")) {
      calls.list.push("topics");
      return { data: { dispute: [], revise: [], retire: [], newTopics: [{ id: "n1", kind: "need", title: "Delivery windows are too wide", why: "new" }], add: [{ topic: "n1", section: "know", text: "Parents can't plan their day around a “four-hour window”.", cites: ["q1"] }] } };
    }
    calls.list.push("place");
    // The delivery board's need, by its id in the call.
    const ref = /- (c\d+) · opportunity · I'm never sure when my order will arrive/.exec(text)?.[1];
    return { data: { mappings: [{ quoteId: "q1", cardId: ref, why: "Sara can't plan around the window" }], newOpportunities: [], contradictions: [] } };
  },
}));
process.env.QALAM_NO_MODELS = "1";
const { captureSource } = await import("./capture");
const { startInbox } = await import("./inbox");

const fts5 = (() => {
  try {
    new DatabaseSync(":memory:").exec("create virtual table t using fts5(x)");
    return true;
  } catch {
    return false;
  }
})();

let root: string;
let store: OrgStore;
const at = Date.now();
const card = (kind: OstCard["kind"], title: string, stage: OstCard["stage"]): OstCard => ({ v: 1, kind, title, stage, createdBy: "user", evidence: [] });
function tree(outcome: string, need: string): Doc {
  const node = (id: string, parentId: string | null, children: string[], ost: OstCard) => ({ id, type: "frame", name: ost.title, parentId, children, x: 0, y: 0, w: 240, h: 80, meta: { ost } });
  return { roots: ["o"], nodes: { o: node("o", null, ["n"], card("outcome", outcome, "active")), n: node("n", "o", [], card("opportunity", need, "exploring")) } } as unknown as Doc;
}

beforeEach(async () => {
  calls.list = [];
  root = await mkdtemp(path.join(tmpdir(), "qalam-capture-"));
  store = await OrgStore.create(path.join(root, "Basket"), { id: "basket", name: "Basket", createdAt: at });
  await store.putProduct({ id: "grocery", name: "Grocery", audience: "Parents", goals: [], context: "", segments: [] });
  for (const [id, name, outcome, need] of [
    ["delivery", "Delivery experience", "Deliveries arrive when promised", "I'm never sure when my order will arrive"],
    ["reorders", "Weekly reorders", "More weekly reorders", "Rebuilding my basket takes too long"],
  ]) {
    const p: Project = { id, type: "discovery", name, createdAt: at, updatedAt: at, product: "grocery" };
    await store.putProject(p);
    await store.putDoc(id, tree(outcome, need));
  }
});
afterEach(async () => {
  store.dispose();
  await rm(root, { recursive: true, force: true });
});

describe.skipIf(!fts5)("capture, in the core", () => {
  it("keeps the material, picks out what customers said, files it and proposes it for the board it fits", async () => {
    const steps: string[] = [];
    const r = await captureSource(store, { kind: "paste", title: "Sara interview", text: "Sara: I can't plan bath time around a four-hour window. Then I order anyway." }, { emit: (s) => steps.push(s) });
    expect(calls.list).toEqual(["extract", "topics", "place"]);
    expect(r).toMatchObject({ title: "Sara interview", quotes: 1, needs: 1, placed: [{ board: "delivery", name: "Delivery experience", count: 1 }] });
    expect(r.filed).toMatchObject({ created: 1, added: 1 });
    const s = (await store.getSource(r.sourceId))!;
    // The made-up quote is gone; the board's proposal waits on the source; its product is the board's.
    expect(s.quotes.map((q) => q.text)).toEqual(["I can't plan bath time around a four-hour window."]);
    expect(s.boards).toEqual([]);
    expect(s.product).toBe("grocery");
    expect((await store.listPlacements()).map((p) => [p.board, p.sourceId])).toEqual([["delivery", s.id]]);
    expect((await store.placementsFor("delivery"))[s.id]).toMatchObject([{ kind: "attach", cardId: "n", quote: { sourceId: s.id, quoteId: s.quotes[0].id } }]);
    expect(s.filed).toEqual([s.quotes[0].id]);
    expect((await store.listTopics()).map((t) => t.title)).toEqual(["Delivery windows are too wide"]);
    expect(steps).toEqual(["Keeping “Sara interview” in the organization", "Picking out what customers said", "Filing it into the topic pages", "Finding where it fits on 2 boards"]);
  });

  it("takes in what's dropped in the inbox, and sets aside what it can't read", async () => {
    startInbox(store);
    await mkdir(path.join(store.dir, "inbox"), { recursive: true });
    await writeFile(path.join(store.dir, "inbox", "Sara call.md"), "# Call\n\nSara: I can't plan bath time around a four-hour window.\n");
    await writeFile(path.join(store.dir, "inbox", "photo.heic"), "not text");
    await store.reload("inbox/Sara call.md");
    // Settles, then takes each file in turn.
    const left = async () => [...(await readdir(path.join(store.dir, "inbox"))), ...(await readdir(path.join(store.dir, "inbox", ".taking")).catch(() => []))].filter((f) => !f.startsWith("."));
    for (let i = 0; i < 60 && (await left()).some((f) => f.includes(".")); i++) await new Promise((r) => setTimeout(r, 200));
    expect((await left()).sort()).toEqual(["added", "not-read"]);
    expect(await readdir(path.join(store.dir, "inbox", "added"))).toEqual(["Sara call.md"]);
    expect((await readdir(path.join(store.dir, "inbox", "not-read"))).sort()).toEqual(["photo.heic", "photo.heic.why.txt"]);
    expect(await readFile(path.join(store.dir, "inbox", "not-read", "photo.heic.why.txt"), "utf8")).toContain("Qalam reads PDF, Word (.docx), Markdown");
    expect((await store.listSources()).map((s) => [s.title, s.kind, s.quotes.length])).toEqual([["Sara call", "markdown", 1]]);
  }, 20_000);

  it("takes each file once when two Qalams watch the same inbox", async () => {
    // The desktop app and a dev server on one folder, say: each has its own store.
    const other = await OrgStore.open(store.dir);
    startInbox(store);
    startInbox(other);
    await mkdir(path.join(store.dir, "inbox"), { recursive: true });
    await writeFile(path.join(store.dir, "inbox", "Sara call.md"), "Sara: I can't plan bath time around a four-hour window.\n");
    const waiting = async () => (await readdir(path.join(store.dir, "inbox"))).filter((f) => f.endsWith(".md")).length + (await readdir(path.join(store.dir, "inbox", ".taking")).catch(() => [])).length;
    for (let i = 0; i < 60 && (await waiting()); i++) await new Promise((r) => setTimeout(r, 200));
    other.dispose();
    expect(await waiting()).toBe(0);
    expect(calls.list.filter((c) => c === "extract")).toHaveLength(1);
    expect(await readdir(path.join(store.dir, "inbox", "added"))).toEqual(["Sara call.md"]);
    expect((await readdir(path.join(store.dir, "sources"))).filter((f) => f.endsWith(".md"))).toHaveLength(1);
  }, 20_000);
});
