import { describe, expect, it } from "vitest";
import { challenging, reasks, type CheckedRun } from "./measures";
import type { Answered } from "./player";

describe("what the check before a review found", () => {
  const a2 = { challenge: { on: /pay|card|checkout|wallet/i, names: /slot/i, cites: /funnel/i } };
  const slot = { kind: "measured" as const, whose: "measured", from: "a2-funnel", text: "step: Picked a delivery slot · users_leaving: 4400" };
  const run = (on: string[], line: string, cites = [slot]): CheckedRun => ({ id: "r", origin: "dump:s", at: 1, items: ["sol:a", "sol:b"], titles: { "sol:a": "Apple Pay and Google Pay", "sol:b": "Evening slots" }, challenges: [{ id: "c", key: "k", kind: "funnel-step", on, line, settle: "", cites, by: "code" }] });

  it("catches a2 when a payment proposal is challenged with the slot step, on the funnel's measured point", () => {
    const line = "In “a2-funnel”, 4,400 of 10,000 leave at Picked a delivery slot, against 454 at Payment page reached, the step this works on.";
    expect(challenging(a2, [run(["sol:a"], line)], []).caught).toBe(true);
    // Said about another proposal, or resting on what isn't the funnel: not caught.
    expect(challenging(a2, [run(["sol:b"], line)], []).caught).toBe(false);
    expect(challenging(a2, [run(["sol:a"], line, [{ ...slot, kind: "known" as never, from: "A page" }])], []).caught).toBe(false);
    expect(challenging({}, [run(["sol:a"], line)], []).caught).toBeNull();
  });

  it("says whether what was proposed in the end works on what the evidence shows", () => {
    const final = [{ id: "p", kind: "opportunity", title: "I can't get a delivery slot", parent: null }, { id: "s", kind: "solution", title: "Evening windows", parent: "p" }];
    expect(challenging(a2, [], final).changed).toBe(true);
    expect(challenging(a2, [], [{ id: "s", kind: "solution", title: "Apple Pay", parent: null }]).changed).toBe(false);
  });
});

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

describe("jargon asked of someone new", () => {
  it("finds product words whole, once each, in English and Arabic", async () => {
    const { jargonIn } = await import("./jargon");
    expect(jargonIn("What's your conversion rate at the basket, and is churn up? Conversion rate matters.")).toEqual(["conversion rate", "churn"]);
    expect(jargonIn("How do people find you?")).toEqual([]);
    expect(jargonIn("Segmented lists, a segment of buyers")).toEqual(["segment"]);
    expect(jargonIn("ما هو معدل التحويل عندكم؟")).toEqual(["معدل التحويل"]);
  });
});
