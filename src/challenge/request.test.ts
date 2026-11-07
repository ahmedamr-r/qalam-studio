import { describe, expect, it } from "vitest";
import type { Doc } from "@/doc/schema";
import { newCard } from "@/discovery/ops";
import type { Proposal } from "@/discovery/proposals";
import type { OstCard } from "@/discovery/types";
import type { SpaceThing } from "@/space/compose";
import { checkRequest } from "./request";

function doc(cards: Record<string, { parent: string | null; card: OstCard }>): Doc {
  const nodes: Record<string, unknown> = {};
  for (const [id, { parent, card }] of Object.entries(cards))
    nodes[id] = { id, type: "frame", name: card.title, parentId: parent, children: Object.entries(cards).filter(([, x]) => x.parent === id).map(([k]) => k), x: 0, y: 0, w: 240, h: 80, visible: true, meta: { ost: card } };
  return { roots: Object.keys(cards).filter((k) => !cards[k].parent), nodes } as unknown as Doc;
}

const d = doc({
  g: { parent: null, card: newCard("outcome", { title: "More first-time parents complete checkout" }) },
  slot: { parent: "g", card: newCard("opportunity", { title: "I can't get a delivery slot when I need one" }) },
  thin: { parent: "g", card: newCard("opportunity", { title: "Checkout looks dated", evidence: [{ id: "e1", kind: "dump", text: "It looks dated", addedBy: "user", at: 1 }] }) },
});
const things = new Map<string, SpaceThing>([
  ["g", { type: "goal", goal: "goal1", board: "b1" }],
  ["slot", { type: "problem", topic: "slot-page", goal: "goal1" }],
]);

describe("what the window sends to have proposals checked", () => {
  it("reads the canvas as plan mode does, with its goals and what nothing measured or said backs", () => {
    const req = checkRequest({ key: "plan:t1", asked: "What should we do?", product: null, doc: d, things, proposals: [], unbacked: (id) => id === "thin", unbackedProposal: () => false });
    expect(req.outline).toEqual([
      { id: "g", kind: "outcome", title: "More first-time parents complete checkout", parent: null, goal: "goal1" },
      // A page only so far: no card's backing to judge.
      { id: "slot", kind: "opportunity", title: "I can't get a delivery slot when I need one", parent: "g", topic: "slot-page" },
      { id: "thin", kind: "opportunity", title: "Checkout looks dated", parent: "g", assumed: true },
    ]);
  });

  it("sends the goals, problems and solutions proposed, each under a card or another proposal; tests and quotes stay out", () => {
    const problem: Proposal = { id: "plan:n1", kind: "card", cardId: "new1", parentId: "g", card: newCard("opportunity", { title: "Paying for my first order feels clunky" }), backing: { quotes: [{ sourceId: "notes", quoteId: "q1" }], words: [] }, why: "" };
    const solution: Proposal = { id: "sol:n2", kind: "card", cardId: "new2", parentId: "new1", card: newCard("solution", { title: "Apple Pay and Google Pay", how: "A wallet button", assumptions: [{ id: "a1", category: "usability", text: "Card entry is the hassle", addedBy: "ai" }] }), backing: { quotes: [], words: [] }, why: "" };
    const test: Proposal = { id: "test:n2", kind: "card", cardId: "new3", parentId: "new2", card: newCard("test", { title: "A fake door" }), backing: { quotes: [], words: [] }, why: "" };
    const attach: Proposal = { id: "a:1", kind: "attach", cardId: "slot", quote: { sourceId: "s", quoteId: "q" }, why: "" };
    const promoted: Proposal = { id: "page:slot-page", kind: "card", cardId: "new4", parentId: "g", card: newCard("opportunity", { title: "I can't get a delivery slot when I need one" }), backing: { quotes: [], words: [] }, why: "", replaces: "slot" };
    const req = checkRequest({ key: "plan:t1", asked: "", product: "grocery", doc: d, things, proposals: [problem, solution, test, attach, promoted], unbacked: () => false, unbackedProposal: (p) => p.id === "plan:n1" });
    expect(req.product).toBe("grocery");
    expect(req.items).toEqual([
      { id: "plan:n1", kind: "opportunity", title: "Paying for my first order feels clunky", parent: "g", assumed: true },
      { id: "sol:n2", kind: "solution", title: "Apple Pay and Google Pay", how: "A wallet button", assumptions: ["Card entry is the hassle"], parent: "plan:n1" },
      { id: "page:slot-page", kind: "opportunity", title: "I can't get a delivery slot when I need one", parent: "g", topic: "slot-page" },
    ]);
  });
});
