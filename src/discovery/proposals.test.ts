import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { emptyDoc } from "@/doc/schema";
import type { BreakdownPart } from "@/goals/breakdown";
import { addCardIn, makeCardNode, newCard } from "./ops";
import { applyProposal, carryOut, proposalKey, touchedRoots, type Proposal } from "./proposals";

const part: BreakdownPart = { id: "p1", title: "First rides to 40%", lever: "activation", why: "More first rides become second ones", metric: null, cites: [], benchmarks: [] };

function canvas() {
  const d = emptyDoc();
  const goal = makeCardNode(newCard("outcome", { title: "Ride share to 18%" }));
  goal.id = "g";
  addCardIn(d, goal, null);
  return d;
}

const proposal: Proposal = { id: "part:p1", kind: "goal", cardId: "new", parentId: "g", goal: "goal-1", part, card: newCard("outcome", { title: part.title, createdBy: "ai" }), why: part.why };
const none = () => null;

describe("a goal proposed under a goal", () => {
  it("is drawn under the goal's card on the ghost, and never put on the document", () => {
    const doc = canvas();
    expect(produce(doc, (d) => void applyProposal(d, proposal, none)).nodes.new).toBeUndefined();
    const ghost = produce(doc, (d) => carryOut(d, [proposal], none));
    expect(ghost.nodes.new?.parentId).toBe("g");
    expect(ghost.nodes.new?.meta.ost?.kind).toBe("outcome");
  });

  it("only under a goal's card", () => {
    const doc = produce(canvas(), (d) => {
      const n = makeCardNode(newCard("opportunity", { title: "A problem" }));
      n.id = "n";
      addCardIn(d, n, "g");
    });
    const under = { ...proposal, parentId: "n" };
    expect(produce(doc, (d) => carryOut(d, [under], none)).nodes.new).toBeUndefined();
  });

  it("is about the goal's tree, and remembered by its part", () => {
    expect(touchedRoots(canvas(), proposal, [proposal])).toEqual(["g"]);
    expect(proposalKey(proposal)).toBe("goal:goal-1:p1");
  });
});
