import { describe, expect, it } from "vitest";
import { emptyDoc, type Doc } from "@/doc/schema";
import { evidenceLabel, isAssumed } from "./evidence";
import { canHold, defaultChildKind, holdsCard } from "./kinds";
import { footerChips } from "./metrics";
import { addCardIn, cardOf, deleteKeepIn, dropProblem, kindsFor, makeCardNode, moveCardsIn, newCard, setKindIn, setSolutionTypeIn, setStartIn } from "./ops";
import { applyProposal, type Proposal } from "./proposals";
import { isModule, kindLabel, nearestProblem } from "./tree";
import type { OstCard } from "./types";

function canvas() {
  const doc: Doc = emptyDoc();
  const add = (card: OstCard, parent: string | null) => {
    const n = makeCardNode(card);
    addCardIn(doc, n, parent);
    return n.id;
  };
  const goal = add(newCard("outcome", { title: "5 of 10 pay" }), null);
  const problem = add(newCard("opportunity", { title: "Reviews are hard to get" }), goal);
  const product = add(newCard("solution", { title: "Review toolkit", solutionType: "product" }), problem);
  const module = add(newCard("solution", { title: "Ask for reviews" }), product);
  const test = add(newCard("test", { title: "Ask by hand" }), module);
  const plain = add(newCard("solution", { title: "Text after a visit", solutionType: "message" }), problem);
  return { doc, add, goal, problem, product, module, test, plain };
}

describe("what a solution can hold", () => {
  it("lets only a New product hold solutions, and keeps the kind's own rule apart", () => {
    expect(holdsCard({ kind: "solution", solutionType: "product" }, "solution")).toBe(true);
    expect(holdsCard({ kind: "solution", solutionType: "message" }, "solution")).toBe(false);
    expect(holdsCard({ kind: "solution" }, "solution")).toBe(false);
    expect(holdsCard({ kind: "solution", solutionType: "product" }, "test")).toBe(true);
    // A brain dump's or a placement's check reads only the kind, so it never makes a module.
    expect(canHold("solution", "solution")).toBe(false);
  });

  it("adds modules under a New product until it has a test of its own, and tests under anything else", () => {
    const product = newCard("solution", { solutionType: "product" });
    expect(defaultChildKind(product, [])).toBe("solution");
    expect(defaultChildKind(product, ["solution"])).toBe("solution");
    expect(defaultChildKind(product, ["test"])).toBe("test");
    expect(defaultChildKind(newCard("solution", { solutionType: "feature" }), [])).toBe("test");
    expect(defaultChildKind(newCard("solution"), [])).toBe("test");
  });

  it("takes a solution dragged onto a New product, and refuses it on any other", () => {
    const { doc, product, plain } = canvas();
    expect(dropProblem(doc, [plain], product)).toBeNull();
    const other = canvas();
    expect(dropProblem(other.doc, [other.module], other.plain)).toMatch(/hold/);
    expect(moveCardsIn(doc, [plain], product)).toBe(true);
    expect(doc.nodes[plain].parentId).toBe(product);
  });

  it("offers a card's kinds as what's above can hold it and it can hold what's under it", () => {
    const { doc, module, product } = canvas();
    // A module holding a test stays a solution.
    expect(kindsFor(doc, module)).toEqual(["solution"]);
    // A product could be the problem its modules solve, never a test.
    expect(kindsFor(doc, product)).toEqual(["opportunity", "solution"]);
  });
});

describe("reading a module", () => {
  it("names it a Module, and finds the problem through its product", () => {
    const { doc, module, product, test, problem, plain, goal } = canvas();
    expect(isModule(doc, module)).toBe(true);
    expect(isModule(doc, product)).toBe(false);
    expect(isModule(doc, plain)).toBe(false);
    expect(kindLabel(doc, module)).toBe("Module");
    expect(kindLabel(doc, product)).toBe("Solution");
    expect(nearestProblem(doc, test)).toBe(problem);
    expect(nearestProblem(doc, module)).toBe(problem);
    expect(nearestProblem(doc, goal)).toBeNull();
  });
});

describe("changing what a solution is", () => {
  it("moves a product's modules up beside it once it's something else, as its problem's solutions", () => {
    const { doc, product, module, problem } = canvas();
    cardOf(doc, module)!.needed = true;
    setSolutionTypeIn(doc, product, "feature");
    expect(cardOf(doc, product)!.solutionType).toBe("feature");
    expect(doc.nodes[module].parentId).toBe(problem);
    expect(doc.nodes[problem].children.indexOf(module)).toBe(doc.nodes[problem].children.indexOf(product) + 1);
    expect(cardOf(doc, module)!.needed).toBeUndefined();
  });

  it("clears the type when it's taken off, and keeps a product's modules while it stays one", () => {
    const { doc, product, plain, module } = canvas();
    setSolutionTypeIn(doc, plain, null);
    expect(cardOf(doc, plain)!.solutionType).toBeUndefined();
    setSolutionTypeIn(doc, product, "product");
    expect(doc.nodes[module].parentId).toBe(product);
  });

  it("takes a solution's own fields off when it stops being a solution", () => {
    const { doc, plain } = canvas();
    Object.assign(cardOf(doc, plain)!, { how: "SMS", start: true, needed: true });
    setKindIn(doc, plain, "opportunity");
    const c = cardOf(doc, plain)!;
    expect([c.kind, c.solutionType, c.how, c.start, c.needed]).toEqual(["opportunity", undefined, undefined, undefined, undefined]);
  });

  it("keeps a deleted product's modules, under its problem", () => {
    const { doc, product, module, problem } = canvas();
    deleteKeepIn(doc, product);
    expect(doc.nodes[module].parentId).toBe(problem);
  });

  it("has one Start here on a canvas", () => {
    const { doc, plain, module } = canvas();
    setStartIn(doc, plain, true);
    setStartIn(doc, module, true);
    expect(cardOf(doc, plain)!.start).toBeUndefined();
    expect(cardOf(doc, module)!.start).toBe(true);
    setStartIn(doc, module, false);
    expect(cardOf(doc, module)!.start).toBeUndefined();
  });
});

describe("a proposal for a module", () => {
  const card = (cardId: string, parentId: string | null, c: OstCard): Proposal => ({ id: `p:${cardId}`, kind: "card", cardId, parentId, card: c, backing: { quotes: [], words: [] }, why: "" });

  it("lands under a New product proposed just before it, and never under any other solution", () => {
    const { doc, problem, plain } = canvas();
    expect(applyProposal(doc, card("TOOL", problem, newCard("solution", { title: "Toolkit", solutionType: "product" })), () => null)).toBe(true);
    expect(applyProposal(doc, card("MOD", "TOOL", newCard("solution", { title: "Watch reviews" })), () => null)).toBe(true);
    expect(doc.nodes.MOD.parentId).toBe("TOOL");
    expect(applyProposal(doc, card("NO", plain, newCard("solution", { title: "Nope" })), () => null)).toBe(false);
  });

  it("lets a goal with nothing behind it land once it says where it came from", () => {
    const { doc } = canvas();
    expect(applyProposal(doc, card("G1", null, newCard("outcome", { title: "A goal", createdBy: "ai" })), () => null)).toBe(false);
    expect(applyProposal(doc, card("G2", null, newCard("outcome", { title: "A goal", createdBy: "ai", came: "idea" })), () => null)).toBe(true);
  });
});

describe("what a card says about itself", () => {
  it("shows where to start, what it is and how it's done, cutting a long how at a word", () => {
    const chips = footerChips(newCard("solution", { title: "Text", solutionType: "message", how: "SMS, through a tool like Twilio or MessageBird", start: true, createdBy: "ai", came: "read" }));
    expect(chips.map((c) => c.text)).toEqual(["Start here", "Message or campaign", "Assumed · read online", "How: SMS, through a tool like…"]);
  });

  it("says a module the product needs is needed, and claims nothing else about it", () => {
    const c = newCard("solution", { title: "Login", createdBy: "ai", needed: true });
    expect(evidenceLabel(c)).toBe("Needed to run it");
    expect(footerChips(c)).toEqual([{ text: "Needed to run it", tone: "subtle" }]);
  });

  it("reads Assumed with where it came from until something that can reach We know backs it", () => {
    const quote = { id: "e", kind: "quote" as const, text: "I want it", addedBy: "ai" as const, at: 1 };
    const read = { id: "r", kind: "read" as const, text: "Others do it", url: "https://x.example", addedBy: "ai" as const, at: 1 };
    expect(evidenceLabel(newCard("outcome", { came: "idea" }))).toBe("Assumed · Qalam AI's idea");
    expect(evidenceLabel(newCard("solution", { came: "answers" }))).toBe("Assumed · your answers");
    expect(isAssumed(newCard("solution", { came: "read", evidence: [read] }))).toBe(true);
    expect(evidenceLabel(newCard("solution", { came: "read", evidence: [read] }))).toBe("Assumed · read online");
    expect(isAssumed(newCard("solution", { came: "idea", evidence: [quote] }))).toBe(false);
  });
});
