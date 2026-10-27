import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Decision } from "@/decisions/model";
import type { Doc } from "@/doc/schema";
import type { SourceRecord } from "@/discovery/sources";
import type { OstCard, OstEvidence } from "@/discovery/types";
import { cardRef } from "@/hub/pieces";
import type { Project } from "@/projects/model";
import { unit, type Models } from "../models/client";
import { OrgStore } from "../org/store";
import { INDEX_VERSION } from "./db";
import { OrgIndex } from "./indexer";
import { packFor, search, showsUp } from "./search";

const fts5 = (() => {
  try {
    new DatabaseSync(":memory:").exec("create virtual table t using fts5(x)");
    return true;
  } catch {
    return false;
  }
})();

/** Meaning by shared words, enough to test the plumbing (the real model is measured in eval/retrieval). */
function fakeModels(fail = false): Models & { calls: number } {
  const vec = (t: string) => {
    const v = new Float32Array(64);
    for (const w of t.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
      let h = 0;
      for (const ch of w.slice(0, 5)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
      v[h % 64] += 1;
    }
    return unit(v);
  };
  const m = {
    embedder: "fake",
    minSimilarity: 0,
    calls: 0,
    async embed(texts: string[]) {
      m.calls++;
      if (fail) throw new Error("no models here");
      return texts.map(vec);
    },
    async rank(_q: string, docs: string[]) {
      return docs.map(() => 0.5);
    },
    state: () => ({ status: "ready" as const }),
  };
  return m;
}

let dir: string;
let store: OrgStore;
let ix: OrgIndex;
const at = new Date(2026, 9, 12).getTime();

const board: Project = { id: "b1abcdefgh", type: "discovery", name: "Reorders", createdAt: at, updatedAt: at, product: "grocery" };
const ev = (id: string, piece: string, text: string, extra: Partial<OstEvidence> = {}): OstEvidence => ({ id, kind: "quote", text, sourceId: "src1", piece, addedBy: "ai", at, ...extra });
const card = (kind: OstCard["kind"], title: string, stage: OstCard["stage"], evidence: OstEvidence[] = []): OstCard => ({ v: 1, kind, title, stage, createdBy: "user", evidence });
function boardDoc(evidence: OstEvidence[], title = "Late deliveries ruin the evening"): Doc {
  const node = (id: string, parentId: string | null, children: string[], ost: OstCard) => ({ id, type: "frame", name: ost.title, parentId, children, x: 0, y: 0, w: 240, h: 80, meta: { ost } });
  return {
    roots: ["o1"],
    nodes: {
      o1: node("o1", null, ["n1"], card("outcome", "More weekly reorders", "active")),
      n1: node("n1", "o1", ["s1"], card("opportunity", title, "exploring", evidence)),
      s1: node("s1", "n1", [], card("solution", "Live courier tracking", "idea")),
    },
  } as unknown as Doc;
}
const text = "The courier never says when he will come. I rebuild my basket from scratch every week.";
const source = (product: string | null = "grocery"): SourceRecord => ({
  v: 1,
  id: "src1",
  projectId: board.id,
  boards: [board.id],
  product,
  kind: "interview",
  title: "Sara interview",
  text,
  addedAt: at,
  read: [0],
  quotes: [
    { id: "q1", text: "The courier never says when he will come", span: [0, 41], speaker: "Sara", kind: "pain", addedBy: "ai", at },
    { id: "q2", text: "I rebuild my basket from scratch every week", span: [43, 86], speaker: "Sara", kind: "pain", addedBy: "ai", at },
  ],
  needs: [],
});

beforeEach(async () => {
  dir = path.join(await mkdtemp(path.join(tmpdir(), "qalam-index-")), "Basket");
  store = await OrgStore.create(dir, { id: "org1", name: "Basket", createdAt: at });
  await store.putProduct({ id: "grocery", name: "Grocery", audience: "Parents with young kids", goals: ["Weekly reorders"], context: "", segments: [] });
  await store.putSource(source());
  await store.putProject(board);
  await store.putDoc(board.id, boardDoc([ev("e1", "hub:quote:q1", "The courier never says when he will come")]));
});
afterEach(async () => {
  ix?.close();
  store.dispose();
  await rm(path.dirname(dir), { recursive: true, force: true });
});

describe.skipIf(!fts5)("the organization's search index", () => {
  it("indexes the folder's pieces and links, and finds a quote by the card it backs", async () => {
    ix = OrgIndex.open(store, null);
    await ix.sync();
    expect(ix.status()).toMatchObject({ pieces: 7, vectors: 0 });
    expect(ix.words('"basket"')).toEqual(["hub:quote:q2"]);
    // q1 never says "late", but it backs “Late deliveries ruin the evening”: its topic. The
    // solution's line says what it's under.
    expect(ix.words('"late"')).toEqual([cardRef(board.id, "n1"), "hub:quote:q1", cardRef(board.id, "s1")]);
    expect(ix.links("hub:quote:q1")).toEqual(expect.arrayContaining([{ ref: "hub:source:src1", kind: "in", out: true }, { ref: cardRef(board.id, "n1"), kind: "backs", out: false }]));
  });

  it("follows the folder: an edit rewrites only what changed, and a link taken away is kept as ended", async () => {
    ix = OrgIndex.open(store, null);
    await ix.sync();
    const idOf = (ref: string) => (ix.db.prepare("select id from pieces where ref = ?").get(ref) as { id: number }).id;
    const quote = idOf("hub:quote:q2");
    await store.putDoc(board.id, boardDoc([], "Deliveries come late"));
    await ix.settled();
    expect(idOf("hub:quote:q2")).toBe(quote);
    expect(ix.words('"late"')).toEqual([cardRef(board.id, "n1"), cardRef(board.id, "s1")]);
    const ended = ix.db.prepare("select expired_at from edges where src = ? and dst = 'hub:quote:q1'").get(cardRef(board.id, "n1")) as { expired_at: number };
    expect(ended.expired_at).toBeGreaterThan(0);
    await store.removeSource("src1");
    await ix.settled();
    expect(ix.piecesByRef(["hub:quote:q1", "hub:quote:q2"]).size).toBe(0);
  });

  it("indexes decisions and what the organization and its products are", async () => {
    const d: Decision = { id: "d1", at, kind: "stage", board: board.id, boardName: "Reorders", card: "s1", cardTitle: "Live courier tracking", what: "Dropped the solution “Live courier tracking”", by: "you", big: true, why: "Drivers can't share their location" };
    await store.appendDecisions([d]);
    ix = OrgIndex.open(store, null);
    await ix.sync();
    expect(ix.words('"drivers"')).toEqual(["hub:decision:d1"]);
    expect(ix.links("hub:decision:d1")).toEqual([{ ref: cardRef(board.id, "s1"), kind: "about", out: true }]);
    expect(ix.words('"parents"')).toHaveLength(1);
  });

  it("makes vectors in the background and searches by meaning with them; without models, words and links answer", async () => {
    const m = fakeModels();
    ix = OrgIndex.open(store, m);
    await ix.sync();
    await ix.embedded();
    expect(ix.status().vectors).toBe(ix.status().pieces);
    const r = await search(ix, { query: "couriers arriving", product: "grocery" });
    expect(r.used).toEqual(["words", "meaning"]);
    expect(r.hits.slice(0, 2).map((h) => h.ref).sort()).toEqual([cardRef(board.id, "s1"), "hub:quote:q1"]);
    expect(r.hits.find((h) => h.ref === "hub:quote:q1")?.ranks.meaning).toBeGreaterThan(0);
    ix.close();
    ix = OrgIndex.open(store, fakeModels(true), path.join(dir, ".qalam", "other.sqlite"));
    await ix.sync();
    await ix.embedded();
    expect((await search(ix, { query: "courier" })).used).toEqual(["words"]);
  });

  it("puts what's linked to the card in hand first, and another product's pieces only on a strong match", async () => {
    ix = OrgIndex.open(store, null);
    await ix.sync();
    const linked = await search(ix, { query: "basket courier", anchor: cardRef(board.id, "n1"), product: "grocery" });
    expect(linked.used).toEqual(["words", "links"]);
    // The quote behind the card and the solution under it, both a link away.
    expect(linked.hits.slice(0, 2).map((h) => [h.ref, h.tier])).toEqual([
      [cardRef(board.id, "s1"), "linked"],
      ["hub:quote:q1", "linked"],
    ]);
    await store.putSource({ ...source("pharmacy"), id: "src2", quotes: [{ ...source().quotes[1], id: "q9" }] });
    await ix.settled();
    const other = await search(ix, { query: "basket", product: "grocery" });
    expect(other.hits.map((h) => [h.ref, h.tier])).toEqual([
      ["hub:quote:q2", "product"],
      ["hub:quote:q9", "other"],
    ]);
  });

  it("packs everything whole when the organization fits the budget", async () => {
    ix = OrgIndex.open(store, null);
    await ix.sync();
    const p = await packFor(ix, { query: "courier", budget: 4000 });
    expect(p.items).toHaveLength(ix.status().pieces);
    expect(p.items.slice(0, 2).map((i) => i.ref)).toEqual([cardRef(board.id, "s1"), "hub:quote:q1"]);
    expect(p.items.every((i) => i.whole)).toBe(true);
    expect(p.block).toContain("[k2] Pain Sara said in “Sara interview”, Oct 12, 2026 · Grocery · about “Late deliveries ruin the evening”\nThe courier never says when he will come");
  });

  it("packs only the types asked for, leaving out what the call already carries", async () => {
    ix = OrgIndex.open(store, null);
    await ix.sync();
    const quotes = await packFor(ix, { query: "courier", budget: 4000, types: ["quote"], exclude: ["hub:quote:q2"] });
    expect(quotes.items.map((i) => i.ref)).toEqual(["hub:quote:q1"]);
    expect(quotes.rows[0]).toMatchObject({ type: "quote", source: "src1", speaker: "Sara" });
    const rest = await packFor(ix, { query: "courier", budget: 4000, exclude: [cardRef(board.id, "s1"), cardRef(board.id, "n1")] });
    expect(rest.items.some((i) => i.ref === cardRef(board.id, "s1") || i.ref === cardRef(board.id, "n1"))).toBe(false);
  });

  it("starts over when the index was made by another version", async () => {
    ix = OrgIndex.open(store, null);
    await ix.sync();
    ix.db.exec(`pragma user_version = ${INDEX_VERSION + 1}`);
    ix.close();
    await new Promise((r) => setTimeout(r, 10));
    ix = OrgIndex.open(store, null);
    expect(ix.status().pieces).toBe(0);
    await ix.sync();
    expect(ix.status().pieces).toBe(7);
  });

  it("indexes topic pages line by line, linked to what they cite, and packs them first", async () => {
    const r = await store.fileTopics(
      {
        create: [{ key: "n1", kind: "need", title: "I never know when the courier will come", products: ["grocery"] }],
        add: [
          { topic: "new:n1", section: "know", text: "Customers can't plan their evening around the courier.", cites: ["hub:quote:q1"], from: ["Sara interview"], products: ["grocery"] },
          { topic: "new:n1", section: "open", text: "Would a narrower window be enough?", cites: ["hub:quote:q1"], from: ["Sara interview"], products: ["grocery"] },
        ],
        revise: [],
        retire: [],
        dispute: [],
      },
      { from: "“Sara interview”" },
    );
    const id = r.created[0];
    ix = OrgIndex.open(store, null);
    await ix.sync();
    const page = (await store.getTopic(id))!;
    const know = `hub:topic:${id}:${page.lines[0].id}`;
    expect(ix.piecesByRef([know]).get(know)).toMatchObject({ type: "page", sub: "know", title: "I never know when the courier will come", product: "grocery" });
    expect(ix.links(know)).toEqual(expect.arrayContaining([{ ref: "hub:quote:q1", kind: "cites", out: true }, { ref: `hub:topic:${id}`, kind: "in", out: true }]));
    expect(ix.words('"evening"')).toContain(know);
    // The card that rests on the same quote is where the page shows up.
    expect(showsUp(ix, page.title, ["hub:quote:q1"])).toMatchObject([{ board: board.id, card: "n1", title: "Late deliveries ruin the evening", shared: 1 }]);
    const p = await packFor(ix, { query: "courier evening", budget: 2000 });
    expect(p.rows[0].type).toBe("page");
    // A page edited away goes from the index too.
    await store.removeTopic(id);
    await ix.settled();
    expect(ix.piecesByRef([know]).size).toBe(0);
  });
});
