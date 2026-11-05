import { describe, expect, it } from "vitest";
import { emptyDoc, type Doc } from "@/doc/schema";
import { activeHelps, goalsReached, helpChoices, helpEdges, helpedCards, helpsTarget, sameHelp, withHelp, withoutHelp } from "./helps";
import { litByHelps } from "./lane";
import { addCardIn, deleteKeepIn, makeCardNode, newCard } from "./ops";
import { applyProposal, dependsOn, proposalKey, touchedRoots, type Proposal } from "./proposals";
import type { OstCard } from "./types";

function canvas() {
  const doc: Doc = emptyDoc();
  const add = (card: OstCard, parent: string | null) => {
    const n = makeCardNode(card);
    addCardIn(doc, n, parent);
    return n.id;
  };
  const goalA = add(newCard("outcome", { title: "5 of 10 pay" }), null);
  const goalB = add(newCard("outcome", { title: "Keep owners" }), null);
  const main = add(newCard("opportunity", { title: "Reviews are hard to get" }), goalA);
  const other = add(newCard("opportunity", { title: "Reviews disappear overnight" }), goalB);
  const faint = add(newCard("opportunity", { title: "Support gives no real help" }), goalB);
  const solution = add(newCard("solution", { title: "Watch reviews" }), main);
  return { doc, add, goalA, goalB, main, other, faint, solution };
}

const ost = (doc: Doc, id: string) => doc.nodes[id].meta.ost!;
const pageCard = (faint: string) => (topic: string) => (topic === "T1" ? faint : undefined);

describe("which card a link is to", () => {
  it("is its card; a page's faint card; else a problem of the same name", () => {
    const { doc, other, faint } = canvas();
    expect(helpsTarget({ card: other, title: "whatever it was called" }, doc)).toBe(other);
    expect(helpsTarget({ topic: "T1", title: "Support gives no real help" }, doc, pageCard(faint))).toBe(faint);
    expect(helpsTarget({ topic: "gone", title: "Support gives no real help" }, doc)).toBe(faint);
    expect(helpsTarget({ card: "gone", title: "Nothing like this anywhere" }, doc)).toBeNull();
  });

  it("finds a page's problem under its new card once the faint one is gone", () => {
    const { doc, faint, goalA, add } = canvas();
    const to = { topic: "T1", title: "Support gives no real help" };
    expect(helpsTarget(to, doc, pageCard(faint))).toBe(faint);
    deleteKeepIn(doc, faint);
    const real = add(newCard("opportunity", { title: "Support gives no real help" }), goalA);
    expect(helpsTarget(to, doc, () => undefined)).toBe(real);
  });

  it("isn't a card that's no longer a problem", () => {
    const { doc, solution } = canvas();
    expect(helpsTarget({ card: solution, title: "Nothing" }, doc)).toBeNull();
  });
});

describe("the links on a solution", () => {
  const to = { card: "c1", title: "A problem" };

  it("adds once, and tells two links to one problem apart by card, page or name", () => {
    const one = withHelp({}, to, "ai", 1)!;
    expect(one).toEqual([{ to, by: "ai", at: 1 }]);
    expect(withHelp({ helps: one }, to, "user", 2)).toBeNull();
    expect(sameHelp(to, { card: "c2", title: "A problem" })).toBe(false);
    expect(sameHelp({ topic: "t", title: "x" }, { topic: "t", title: "y" })).toBe(true);
    expect(sameHelp({ card: "c", title: "A problem here" }, { topic: "t", title: "A problem here" })).toBe(true);
  });

  it("remembers one taken off: Qalam AI doesn't put it back, and a person can", () => {
    const off = withoutHelp({ helps: withHelp({}, to, "ai", 1)! }, to, 2);
    expect(off[0].off).toBe(true);
    expect(activeHelps({ helps: off })).toEqual([]);
    expect(withHelp({ helps: off }, to, "ai", 3)).toBeNull();
    expect(withHelp({ helps: off }, to, "user", 3)).toEqual([{ to, by: "user", at: 3 }]);
  });
});

describe("what a solution reaches", () => {
  it("counts the goal above it and the goal above each problem it helps, across goals", () => {
    const { doc, solution, other, goalA, goalB } = canvas();
    expect(goalsReached(doc, solution)).toEqual([goalA]);
    ost(doc, solution).helps = [{ to: { card: other, title: "x" }, by: "ai", at: 1 }];
    expect(goalsReached(doc, solution)).toEqual([goalA, goalB]);
  });

  it("leaves out the problem it hangs under, one taken off, one that's gone, and counts each once", () => {
    const { doc, solution, main, other } = canvas();
    ost(doc, solution).helps = [
      { to: { card: main, title: "Reviews are hard to get" }, by: "ai", at: 1 },
      { to: { card: other, title: "Reviews disappear overnight" }, by: "ai", at: 1 },
      { to: { topic: "x", title: "Reviews disappear overnight" }, by: "ai", at: 1 },
      { to: { card: "gone", title: "Nothing like this anywhere" }, by: "ai", at: 1 },
    ];
    expect(helpedCards(doc, solution)).toEqual([other]);
    ost(doc, solution).helps = ost(doc, solution).helps!.map((h) => ({ ...h, off: true as const }));
    expect(helpedCards(doc, solution)).toEqual([]);
  });

  it("offers every other problem as a choice, a page's by its topic, and not one it helps already", () => {
    const { doc, solution, other, faint } = canvas();
    const topicOf = (c: string) => (c === faint ? "T1" : undefined);
    expect(helpChoices(doc, solution, topicOf)).toEqual([
      { card: other, to: { card: other, title: "Reviews disappear overnight" } },
      { card: faint, to: { topic: "T1", title: "Support gives no real help" } },
    ]);
    ost(doc, solution).helps = [{ to: { card: other, title: "x" }, by: "ai", at: 1 }];
    expect(helpChoices(doc, solution, topicOf).map((c) => c.card)).toEqual([faint]);
  });
});

describe("the wires", () => {
  it("runs one from each solution to each problem, and none from a folded card", () => {
    const { doc, solution, other } = canvas();
    ost(doc, solution).helps = [{ to: { card: other, title: "x" }, by: "ai", at: 1 }];
    const edges = helpEdges(doc);
    expect(edges).toEqual([{ id: `helps:${solution}>${other}`, from: solution, to: other, quotes: [], kind: "helps" }]);
    doc.nodes[solution].visible = false;
    expect(helpEdges(doc)).toEqual([]);
  });

  it("lights only its own wires when a card is hovered, from either end", () => {
    const { doc, solution, other, faint } = canvas();
    ost(doc, solution).helps = [{ to: { card: other, title: "x" }, by: "ai", at: 1 }, { to: { card: faint, title: "y" }, by: "ai", at: 1 }];
    const lane = { items: [], edges: [...helpEdges(doc), { id: "src>x", from: "src", to: solution, quotes: [] }] };
    expect([...litByHelps(lane, solution)]).toEqual([`helps:${solution}>${other}`, `helps:${solution}>${faint}`]);
    expect([...litByHelps(lane, other)]).toEqual([`helps:${solution}>${other}`]);
    expect([...litByHelps(lane, null)]).toEqual([]);
  });
});

describe("a link as a proposal", () => {
  const link = (cardId: string, to: Extract<Proposal, { kind: "helps" }>["to"]): Proposal => ({ id: "h1", kind: "helps", cardId, to, why: "" });

  it("adds the link when it's accepted, and never one a person took off", () => {
    const { doc, solution, other } = canvas();
    const to = { card: other, title: "Reviews disappear overnight" };
    expect(applyProposal(doc, link(solution, to), () => null)).toBe(true);
    expect(activeHelps(ost(doc, solution)).map((h) => h.to)).toEqual([to]);
    expect(applyProposal(doc, link(solution, to), () => null)).toBe(false);
    ost(doc, solution).helps = withoutHelp(ost(doc, solution), to, 2);
    expect(applyProposal(doc, link(solution, to), () => null)).toBe(false);
  });

  it("only goes on a solution, and waits on a new card at either end", () => {
    const { doc, main, other } = canvas();
    expect(applyProposal(doc, link(main, { card: other, title: "x" }), () => null)).toBe(false);
    const card = (cardId: string, parentId: string): Proposal => ({ id: `p:${cardId}`, kind: "card", cardId, parentId, card: newCard("solution", { title: cardId }), backing: { quotes: [], words: [] }, why: "" });
    const all = [card("NEW", main), card("NEWP", main), link("NEW", { card: "NEWP", title: "x" })];
    expect(dependsOn(all[2], all).map((p) => p.id)).toEqual(["p:NEW", "p:NEWP"]);
  });

  it("is told apart by its solution and problem, new ones by their names, and touches both trees", () => {
    const { doc, solution, other, goalA, goalB } = canvas();
    const p = link(solution, { card: other, title: "Reviews disappear overnight" });
    expect(proposalKey(p)).toBe(`helps:${solution}:reviews disappear overnight`);
    expect(touchedRoots(doc, p, [p]).sort()).toEqual([goalA, goalB].sort());
  });
});
