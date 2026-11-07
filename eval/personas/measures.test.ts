import { describe, expect, it } from "vitest";
import { reasks } from "./measures";
import type { Answered } from "./player";

const line = (flow: string, question: string, x: Partial<Answered> = {}): Answered => ({ flow, round: 0, question, options: [], facts: [], unknowns: [], how: "fact", answer: "", active: true, ...x });

describe("what was asked again", () => {
  it("counts a question that drew only facts already given, within its flow and across flows, by the facts' ids", () => {
    const ledger = [
      line("find", "What is net revenue retention today?", { facts: ["nrr"] }),
      line("find", "What share of accounts use payments?", { facts: ["share"] }),
      // The same fact in other words, in a later flow: a re-ask across flows.
      line("focus", "What's your NRR now?", { facts: ["nrr"] }),
      // Asked again in its own flow.
      line("focus", "Payments share?", { facts: ["share"] }),
      // A new fact beside an old one isn't a re-ask.
      line("focus", "NRR and churn?", { facts: ["nrr", "churn"] }),
    ];
    const r = reasks({}, { ledger });
    expect(r.crossFlow).toBe(2);
    expect(r.sameFlow).toBe(0);
    expect(r.examples.map((e) => [e.flow, e.first])).toEqual([
      ["focus", "find"],
      ["focus", "find"],
    ]);
    // Within one flow.
    expect(reasks({}, { ledger: [line("plan", "a", { facts: ["x"] }), line("plan", "b", { facts: ["x"] })] }).sameFlow).toBe(1);
  });

  it("counts a declared unknown asked again, questions about their documents apart, and the longest run of don't-knows", () => {
    const ledger = [
      line("plan", "What's the failure rate by segment?", { how: "dont-know", unknowns: ["segments"] }),
      line("plan", "Where do parents drop off?", { how: "dont-know", unknowns: ["funnel"] }),
      line("brief", "Which segment fails most?", { how: "dont-know", unknowns: ["segments"] }),
      line("brief", "How many leave at the slot?", { how: "dont-know", unknowns: ["funnel"] }),
      line("brief", "Who builds it?", { facts: ["capacity"] }),
      line("brief", "Anything else?", { how: "dont-know" }),
    ];
    const r = reasks({ documented: [{ id: "funnel", topic: "the checkout funnel" }] }, { ledger });
    expect(r.unknownAgain).toBe(1);
    expect(r.askedDocumented).toBe(2);
    expect(r.longestDontKnow).toBe(4);
  });
});
