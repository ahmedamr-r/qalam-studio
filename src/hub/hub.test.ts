import { describe, expect, it } from "vitest";
import type { Decision } from "@/decisions/model";
import type { Doc } from "@/doc/schema";
import type { SourceRecord } from "@/discovery/sources";
import type { OstCard } from "@/discovery/types";
import type { Project } from "@/projects/model";
import { dot, mmr, rrf, scoped } from "./fuse";
import { orgGraph } from "./graph";
import { pack, tokensOf } from "./pack";
import { boardPieces, cardRef, contextPieces, decisionPieces, goalPieces, meaningText, searchText, sourcePieces } from "./pieces";
import { ftsQuery, queryWords } from "./words";

const names = { product: (id: string) => ({ grocery: "Grocery" })[id] };
const at = new Date(2026, 9, 12).getTime();

const source: SourceRecord = {
  v: 1,
  id: "s1",
  projectId: "b1",
  boards: ["b1"],
  product: "grocery",
  kind: "interview",
  title: "Sara interview",
  text: "I rebuild my basket from scratch every week. The courier never says when.",
  addedAt: at,
  read: [0],
  quotes: [
    { id: "q1", text: "I rebuild my basket from scratch every week", span: [0, 43], speaker: "Sara", kind: "pain", addedBy: "ai", at },
    { id: "q2", text: "The courier never says when", span: [45, 72], kind: "pain", addedBy: "ai", at },
  ],
  needs: [{ id: "n1", title: "Reordering the usual basket is slow", quoteIds: ["q1"] }],
};

const card = (kind: OstCard["kind"], title: string, stage: OstCard["stage"], extra: Partial<OstCard> = {}): OstCard => ({ v: 1, kind, title, stage, createdBy: "user", evidence: [], ...extra });
const node = (id: string, parentId: string | null, ost: OstCard) => ({ id, type: "frame", name: ost.title, parentId, children: [], meta: { ost } });
const board: Project = { id: "b1", type: "discovery", name: "Reorders", createdAt: at, updatedAt: at, product: "grocery" };
const doc = {
  roots: ["o1"],
  nodes: {
    o1: node("o1", null, card("outcome", "More weekly reorders", "active", { metric: { name: "Reorders per customer", direction: "increase", baseline: 1.2, current: 1.3, target: 1.5 } })),
    n1: node("n1", "o1", card("opportunity", "Rebuilding the basket takes long", "target", {
      evidence: [
        { id: "e1", kind: "quote", text: "I rebuild my basket from scratch every week", sourceId: "s1", piece: "hub:quote:q1", addedBy: "ai", at },
        { id: "e2", kind: "answer", text: "most baskets repeat", answerId: "pains", addedBy: "ai", at },
        { id: "e3", kind: "note", text: "Some parents enjoy browsing", stance: "against", addedBy: "user", at },
      ],
    })),
    s1: node("s1", "n1", card("solution", "Saved baskets", "idea", { assumptions: [{ id: "a1", category: "desirability", text: "Parents save a basket before they need it", importance: 3, addedBy: "ai" }] })),
    t1: node("t1", "s1", card("test", "Fake-door button", "running", { test: { assumptionIds: ["a1"], method: "A button that leads to a waitlist", criterion: "1 in 10 tap it" } })),
  },
} as unknown as Doc;

describe("pieces of the organization's files", () => {
  it("makes each quote and need of a source a piece, with a line that says who and where", () => {
    const b = sourcePieces(source, names);
    expect(b.pieces.map((p) => [p.ref, p.type, p.sub])).toEqual([
      ["hub:quote:q1", "quote", "pain"],
      ["hub:quote:q2", "quote", "pain"],
      ["hub:need:s1:n1", "need", undefined],
    ]);
    expect(b.pieces[0].line).toBe("Pain Sara said in “Sara interview”, Oct 12, 2026 · Grocery");
    expect(b.pieces[1].line).toBe("Pain a customer said in “Sara interview”, Oct 12, 2026 · Grocery");
    const dump = sourcePieces({ ...source, kind: "dump", quotes: [{ ...source.quotes[0], role: "assumption" }, { ...source.quotes[1], role: "goal" }] }, names);
    expect(dump.pieces.filter((p) => p.type === "quote").map((p) => p.line.split(" in ")[0])).toEqual(["An assumption from the brain dump", "A goal from the brain dump"]);
    expect(b.edges).toContainEqual({ from: "hub:need:s1:n1", to: "hub:quote:q1", kind: "shows" });
    expect(b.edges).toContainEqual({ from: "hub:quote:q1", to: "hub:source:s1", kind: "in" });
  });

  it("makes cards, their own evidence and assumptions pieces, and links a card to a source's quote instead of copying it", () => {
    const b = boardPieces(board, doc, names);
    expect(b.pieces.map((p) => p.ref)).toEqual([cardRef("b1", "o1"), cardRef("b1", "n1"), "hub:evidence:b1:e2", "hub:evidence:b1:e3", cardRef("b1", "s1"), "hub:assumption:b1:a1", cardRef("b1", "t1")]);
    const byRef = new Map(b.pieces.map((p) => [p.ref, p]));
    expect(byRef.get(cardRef("b1", "o1"))?.text).toBe("More weekly reorders. Reorders per customer · 1.3 now → 1.5");
    expect(byRef.get(cardRef("b1", "n1"))?.line).toBe("Problem, target, under “More weekly reorders” · on the board “Reorders” · Grocery");
    expect(byRef.get(cardRef("b1", "t1"))?.text).toBe("Fake-door button. Method: A button that leads to a waitlist. Pass if: 1 in 10 tap it");
    expect(boardPieces(board, { roots: ["x"], nodes: { x: node("x", null, card("outcome", "Mine again", "active", { description: "Repeat use matters." })) } } as unknown as Doc, names).pieces[0].text).toBe("Mine again. Repeat use matters");
    expect(byRef.get("hub:evidence:b1:e3")?.line).toContain("A note, against “Rebuilding the basket takes long”");
    expect(byRef.get("hub:assumption:b1:a1")?.line).toContain("A desirability assumption behind “Saved baskets”, which it fails without");
    expect(b.edges).toEqual(
      expect.arrayContaining([
        { from: cardRef("b1", "n1"), to: cardRef("b1", "o1"), kind: "under" },
        { from: cardRef("b1", "n1"), to: "hub:quote:q1", kind: "backs", at },
        { from: cardRef("b1", "n1"), to: "hub:evidence:b1:e3", kind: "against", at },
        { from: "hub:assumption:b1:a1", to: cardRef("b1", "s1"), kind: "of" },
      ]),
    );
  });

  it("makes decisions pieces, about their card and the cards a batch touched; an undone one stays out", () => {
    const d = (id: string, over: Partial<Decision> = {}): Decision => ({ id, at, kind: "stage", board: "b1", boardName: "Reorders", card: "s1", cardTitle: "Saved baskets", what: "Dropped the solution “Saved baskets”", by: "you", big: true, why: "Nobody saved one", ...over });
    const b = decisionPieces([d("d1"), d("d2", { undone: true }), d("d3", { kind: "accept", card: null, what: "Accepted Qalam AI's proposals", detail: { cards: ["n1", "s1"] } })], () => "grocery", names);
    expect(b.pieces.map((p) => p.ref)).toEqual(["hub:decision:d1", "hub:decision:d3"]);
    expect(b.pieces[0]).toMatchObject({ text: "Dropped the solution “Saved baskets”. Why: Nobody saved one", product: "grocery" });
    expect(b.edges.map((e) => e.to)).toEqual([cardRef("b1", "s1"), cardRef("b1", "n1"), cardRef("b1", "s1")]);
  });

  it("makes each line of what a product is a piece, named by its words; its segments are one piece", () => {
    const b = contextPieces({ product: "grocery", name: "Grocery", at }, { audience: "Parents with young kids", context: "", segments: ["Busy parents", "New customers"] });
    expect(b.pieces.map((p) => [p.sub, p.line, p.text])).toEqual([
      ["audience", "Who Grocery is for", "Parents with young kids"],
      ["segments", "The kinds of customer Grocery tells apart", "Busy parents; New customers"],
    ]);
    expect(contextPieces({ product: "grocery", name: "Grocery", at }, { audience: "Parents with young kids", context: "", segments: [] }).pieces[0].ref).toBe(b.pieces[0].ref);
    // Meaning search reads what a piece is, the cards it's about and its words (not where it's from).
    expect(meaningText({ type: "quote", sub: "pain", line: "Pain Sara said in “Sara interview”", text: "It takes forever" }, ["Reordering is slow"])).toBe("A customer pain. About “Reordering is slow”. It takes forever");
  });

  it("makes each goal a piece, under the goal it feeds and linked to the card working on it", () => {
    const tree = {
      north: "ns",
      goals: [
        { id: "ns", title: "2M AED a month", parent: null, product: null, status: "active" as const, cites: [], by: "person" as const, at },
        { id: "r", title: "Weekly reorders", parent: "ns", product: "grocery", status: "active" as const, metric: { name: "Reorders", unit: "orders", direction: "increase" as const, baseline: 1.2, current: 1.3, target: 1.5 }, on: { board: "b1", card: "o1" }, cites: ["hub:quote:q1"], by: "person" as const, at },
      ],
    };
    const b = goalPieces(tree, names, "Basket");
    expect(b.pieces.map((p) => [p.ref, p.sub, p.line, p.text])).toEqual([
      ["hub:goal:ns", "goal", "The North Star of Basket (the organization)", "2M AED a month"],
      ["hub:goal:r", "goal", "A goal of Grocery · under “2M AED a month”", "Weekly reorders (Reorders: 1.3 → 1.5 orders)"],
    ]);
    expect(b.edges).toEqual([
      { from: "hub:goal:r", to: "hub:goal:ns", kind: "under" },
      { from: cardRef("b1", "o1"), to: "hub:goal:r", kind: "for" },
      { from: "hub:goal:r", to: "hub:quote:q1", kind: "backs" },
    ]);
    expect(searchText(b.pieces[1], ["More weekly reorders"])).toBe("A goal of Grocery · under “2M AED a month” · about “More weekly reorders”\nWeekly reorders (Reorders: 1.3 → 1.5 orders)");
  });
});

describe("words for search", () => {
  it("folds, drops common words and quotes the rest, so nothing typed is read as syntax", () => {
    // Accents are the tokenizer's to remove (remove_diacritics), on both sides.
    expect(queryWords("Why do parents REBUILD the café basket?")).toEqual(["parents", "rebuild", "café", "basket"]);
    expect(ftsQuery('late "deliveries" NEAR(x) OR -y')).toBe('"late" OR "deliveries" OR "near"');
    expect(ftsQuery("the and of")).toBeNull();
  });
});

describe("fusing and scoping results", () => {
  it("merges lists by rank, counting each list's weight", () => {
    const f = rrf([
      { name: "words", refs: ["a", "b", "c"] },
      { name: "meaning", refs: ["b", "d"], weight: 2 },
    ]);
    expect(f.map((x) => x.ref)).toEqual(["b", "d", "a", "c"]);
    expect(f[0].ranks).toEqual({ words: 2, meaning: 1 });
  });

  it("puts what's linked to the card first, and keeps another product's pieces only on a strong match", () => {
    const pieces: Record<string, { product: string | null }> = { a: { product: "grocery" }, b: { product: null }, c: { product: "pharmacy" }, d: { product: "pharmacy" }, e: { product: "grocery" } };
    const fused = rrf([{ name: "words", refs: ["c", "a", "b", "d", "e"] }]);
    const out = scoped(fused, (r) => pieces[r], { product: "grocery", linked: new Set(["e"]) });
    expect(out.map((x) => [x.ref, x.tier])).toEqual([
      ["e", "linked"],
      ["a", "product"],
      ["b", "org"],
      ["c", "other"],
    ]);
  });

  it("keeps a result varied: a near copy of a pick waits behind something different", () => {
    const items = [
      { id: "a", s: 1, v: new Float32Array([1, 0]) },
      { id: "a2", s: 0.95, v: new Float32Array([0.99, 0.141]) },
      { id: "b", s: 0.8, v: new Float32Array([0, 1]) },
    ];
    expect(mmr(items, (x) => x.s, (x, y) => dot(x.v, y.v), 2).map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("packing pieces into a budget", () => {
  const item = (i: number, words = 30) => ({ ref: `hub:quote:q${i}`, line: `Pain a customer said in “Interview ${i}”`, text: `word${i} `.repeat(words).trim() });

  it("sends everything whole when it fits, each under its id", () => {
    const p = pack([item(1), item(2)], { budget: 4000 });
    expect(p.items).toEqual([
      { k: "k1", ref: "hub:quote:q1", whole: true },
      { k: "k2", ref: "hub:quote:q2", whole: true },
    ]);
    expect(p.block.startsWith("[k1] Pain a customer said in “Interview 1”\nword1 word1")).toBe(true);
    expect(p.manifest.map((m) => [m.short, m.ref])).toEqual([
      ["k1", "hub:quote:q1"],
      ["k2", "hub:quote:q2"],
    ]);
    expect(p.tokens).toBeGreaterThanOrEqual(tokensOf(p.block));
    // A card its line already names isn't repeated as a topic.
    expect(pack([{ ref: "r", line: "A note, for “Late deliveries”", text: "x", topics: ["Late deliveries", "Evening slots"] }], { budget: 100 }).block).toBe("[k1] A note, for “Late deliveries” · about “Evening slots”\nx");
  });

  it("sends the best whole and the rest as one line each, until the budget is spent", () => {
    const list = Array.from({ length: 40 }, (_, i) => item(i + 1, 60));
    const p = pack(list, { budget: 1200, wholeTop: 2 });
    expect(p.items.slice(0, 3).map((x) => x.whole)).toEqual([true, true, false]);
    expect(p.tokens).toBeLessThanOrEqual(1200);
    expect(p.left).toBe(40 - p.items.length);
    expect(p.block.split("\n").at(-1)).toMatch(/^\[k\d+\] .*…$/);
  });
});

describe("the organization's graph", () => {
  it("shows a product's pieces with the whole organization's, and only links between pieces it shows", () => {
    const b = boardPieces(board, doc, names);
    const s = sourcePieces({ ...source, product: "pharmacy" }, names);
    const all = [...b.pieces, ...s.pieces, ...contextPieces({ product: null, name: "Basket", at }, { audience: "Families", context: "", segments: [] }).pieces];
    const g = orgGraph(all, [...b.edges, ...s.edges], { product: "grocery" });
    expect(g.nodes.some((n) => n.ref === "hub:quote:q1")).toBe(false);
    expect(g.nodes.find((n) => n.ref === cardRef("b1", "n1"))?.label).toBe("Rebuilding the basket takes long");
    expect(g.nodes.some((n) => n.type === "context" && n.product === null)).toBe(true);
    expect(g.edges.every((e) => g.nodes.some((n) => n.ref === e.from) && g.nodes.some((n) => n.ref === e.to))).toBe(true);
    expect(orgGraph(all, [...b.edges, ...s.edges]).edges).toContainEqual({ from: cardRef("b1", "n1"), to: "hub:quote:q1", kind: "backs" });
  });
});
