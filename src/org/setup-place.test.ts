import { describe, expect, it } from "vitest";
import { addCardIn, makeCardNode, newCard } from "@/discovery/ops";
import { quoteEvidence, type SourceQuote, type SourceRecord } from "@/discovery/sources";
import { emptyDoc } from "@/doc/schema";
import { setupProposals } from "./setup-place";

const q = (id: string, text: string, role: SourceQuote["role"] = "evidence"): SourceQuote => ({ id, text, span: [0, text.length], kind: "pain", role, addedBy: "ai", at: 0 });
const QUOTES = [q("gate", "The driver went to gate 1, I was at gate 13"), q("air", "Airport pickups are chaos"), q("fare", "The price at the end was 40 pounds more"), q("cash", "The driver never has change for 200")];
const tickets = { v: 1, id: "tickets", projectId: "", kind: "text", title: "tickets.csv", text: "", addedAt: 0, read: [], quotes: QUOTES, needs: [] } as SourceRecord;
const homeOf = (id: string) => {
  const quote = QUOTES.find((x) => x.id === id);
  return quote ? { source: tickets, quote } : null;
};
const session = { problems: [
  { id: "p1", title: "Riders and drivers miss each other at pickup", quotes: ["gate", "air"] },
  { id: "p2", title: "The final fare jumps above the estimate", quotes: ["fare"] },
] };
let n = 0;
const id = () => `x${++n}`;

function board() {
  const doc = emptyDoc();
  const outcome = makeCardNode(newCard("outcome", { title: "Cut cancellations" }));
  addCardIn(doc, outcome, null);
  return { doc, outcome: outcome.id };
}

describe("a setup's problems on a board", () => {
  it("proposes each problem under the outcome, resting on its quotes where they live now, and what no group took on its own", () => {
    n = 0;
    const { doc, outcome } = board();
    const ps = setupProposals(doc, session, QUOTES, homeOf, id);
    expect(ps.map((p) => (p.kind === "card" ? [p.card.title, p.parentId, p.backing.quotes.map((r) => `${r.sourceId}:${r.quoteId}`), p.card.createdBy] : null))).toEqual([
      ["Riders and drivers miss each other at pickup", outcome, ["tickets:gate", "tickets:air"], "user"],
      ["The final fare jumps above the estimate", outcome, ["tickets:fare"], "user"],
      ["The driver never has change for 200", outcome, ["tickets:cash"], "user"],
    ]);
  });

  it("leaves out what the board has already: the same problem, or every quote on a card", () => {
    const { doc, outcome } = board();
    addCardIn(doc, makeCardNode(newCard("opportunity", { title: "The final fare jumps above the estimate!" })), outcome);
    addCardIn(doc, makeCardNode(newCard("opportunity", { title: "Cash", evidence: [quoteEvidence(tickets, QUOTES[3], "user")] })), outcome);
    expect(setupProposals(doc, session, QUOTES, homeOf).map((p) => (p.kind === "card" ? p.card.title : ""))).toEqual(["Riders and drivers miss each other at pickup"]);
  });

  it("proposes nothing on a board with no outcome", () => {
    expect(setupProposals(emptyDoc(), session, QUOTES, homeOf)).toEqual([]);
  });
});
