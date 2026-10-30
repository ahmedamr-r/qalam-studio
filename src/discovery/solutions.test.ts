import { describe, expect, it } from "vitest";
import { emptyDoc } from "@/doc/schema";
import { addCardIn, makeCardNode, newCard } from "./ops";
import { applyProposal, type Proposal } from "./proposals";
import { draftBacking, draftCards, sanitizeSolutions, solutionsMaterial, type SolutionsInput } from "./solutions";

const input = (over: Partial<SolutionsInput> = {}): SolutionsInput => ({
  problem: { title: "Planning the week's meals takes too long", topic: "T1" },
  lines: [
    { id: "L1", section: "know", text: "Parents spend Sunday evenings planning meals", cites: ["hub:quote:a"] },
    { id: "L2", section: "believe", text: "Busy parents would reuse last week's plan", cites: [] },
  ],
  pieces: [
    { ref: "hub:quote:a", text: "Every Sunday I spend an hour working out what we eat", label: "Interview with Sara", source: "s1", evidence: true },
    { ref: "hub:quote:b", text: "we just reorder the same 12 things", label: "Support ticket", source: "s2", evidence: true },
  ],
  goals: [{ id: "G1", title: "Families plan their week with it", metric: "Weekly planners: 40 → 200", how: "Less time planning means more weeks planned" }],
  claims: [],
  steps: [{ ref: "app__web/plan", flow: "Planning", title: "Weekly plan screen", events: ["plan_started"] }],
  cards: [{ title: "Meal kits", kind: "solution" }],
  ideas: [{ ref: "hub:quote:i", text: "a button to copy last week's plan", source: "d1", label: "My notes" }],
  ...over,
});

const answer = (solutions: unknown[], note = "Each saves the Sunday hour.") => ({ solutions, note });
const draft = (over: Record<string, unknown> = {}) => ({
  title: "Start the week from last week's order",
  description: "Prefill the plan from what they ordered, since they “reorder the same 12 things”.",
  cites: ["l1", "q2"],
  idea: "none",
  assumptions: [
    { category: "desirability", text: "Parents want last week's meals again", importance: "3" },
    { category: "feasibility", text: "We can read last week's order", importance: "2" },
  ],
  test: { assumption: "1", what: "Fake-door “Copy last week” button", how: "Show the button on the plan screen and count taps.", pass: "30% of planners tap it in a week" },
  ...over,
});

const keep = (raw: unknown, i = input()) => {
  let n = 0;
  const dropped: string[] = [];
  const out = sanitizeSolutions(raw, solutionsMaterial(i), { now: 1, id: () => `id${++n}` }, (why) => dropped.push(why));
  return { ...out, dropped };
};

describe("the material", () => {
  it("names every item by an id, customers' words first", () => {
    const m = solutionsMaterial(input({ pieces: [{ ref: "hub:quote:t", text: "the team thinks so", label: "Notes", source: null, evidence: false }, ...input().pieces] }));
    expect([...m.lines.keys()]).toEqual(["l1", "l2"]);
    expect([...m.pieces.values()].map((p) => p.ref)).toEqual(["hub:quote:a", "hub:quote:b", "hub:quote:t"]);
    expect(m.text).toContain("- q1 · customers · Interview with Sara");
    expect(m.text).toContain("- g1 · Families plan their week with it");
    expect(m.text).toContain("- m1 · Planning · Weekly plan screen · plan_started");
    expect(m.text).toContain("- i1 · “a button to copy last week's plan”");
    expect(m.text).toContain("- Solution: Meal kits");
  });
});

describe("what code keeps of the drafts", () => {
  it("keeps a draft resting on the problem's words, with its assumptions and a test", () => {
    const { drafts, note } = keep(answer([draft(), draft({ title: "A shared family plan", description: "Let both parents plan together.", cites: ["l1"] })]));
    expect(drafts).toHaveLength(2);
    const d = drafts[0];
    // The words it cites, then those behind the line it answers.
    expect(d.cites).toEqual({ lines: ["L1"], pieces: ["hub:quote:b", "hub:quote:a"], goals: [], claims: [], steps: [] });
    expect(d.assumptions.map((a) => [a.category, a.importance])).toEqual([
      ["desirability", 3],
      ["feasibility", 2],
    ]);
    expect(d.test?.assumption).toBe(d.assumptions[0].id);
    expect(note).toBe("Each saves the Sunday hour.");
  });

  it("never keeps a pass line's number as fact: the whole line is a suggestion", () => {
    const d = keep(answer([draft()])).drafts[0];
    expect(d.test?.suggested).toBe("30% of planners tap it in a week");
    const cards = draftCards(d);
    expect(cards.test?.test).toEqual({ assumptionIds: [d.assumptions[0].id], method: "Show the button on the plan screen and count taps.", suggested: { criterion: "30% of planners tap it in a week" } });
    expect(cards.test?.test?.criterion).toBeUndefined();
  });

  it("drops a draft resting on nothing the problem says, or on ids it wasn't sent", () => {
    const { drafts, dropped } = keep(answer([draft({ cites: ["g1", "m1"] }), draft({ cites: ["l9", "q7"] })]));
    expect(drafts).toEqual([]);
    expect(dropped).toEqual(["it rests on nothing the problem says", "it rests on nothing the problem says"]);
  });

  it("drops words and numbers that aren't in what was sent", () => {
    const { drafts } = keep(answer([draft({ description: "Parents say “I hate cooking” so prefill it." }), draft({ title: "Save 45 minutes a week" })]));
    expect(drafts).toEqual([]);
  });

  it("drops what's on the board already, and a second draft of the same thing", () => {
    const { drafts } = keep(answer([draft({ title: "Meal kits" }), draft(), draft({ title: "Start the week from last weeks order" })]));
    expect(drafts.map((d) => d.title)).toEqual(["Start the week from last week's order"]);
  });

  it("keeps their idea only in their words, and the card is theirs then", () => {
    const theirs = keep(answer([draft({ title: "Copy last week's plan", idea: "i1" })])).drafts[0];
    expect(theirs.idea).toEqual({ ref: "hub:quote:i", text: "a button to copy last week's plan", source: "d1" });
    expect(draftCards(theirs).solution.createdBy).toBe("user");
    const reworded = keep(answer([draft({ title: "Duplicate the previous menu", idea: "i1" })])).drafts[0];
    expect(reworded.idea).toBeNull();
    expect(draftCards(reworded).solution.createdBy).toBe("ai");
  });

  it("keeps only known kinds of assumption, and tests the riskiest when the one named was dropped", () => {
    const d = keep(answer([draft({ assumptions: [{ category: "magic", text: "It just works", importance: "3" }, { category: "viability", text: "It pays for itself", importance: "2" }], test: { ...draft().test, assumption: "1" } })])).drafts[0];
    expect(d.assumptions.map((a) => a.text)).toEqual(["It pays for itself"]);
    expect(d.test?.assumption).toBe(d.assumptions[0].id);
    expect(keep(answer([draft({ assumptions: [] })])).drafts).toEqual([]);
  });

  it("reads quoted wording nobody said in a test as wording it proposes, never as someone's words", () => {
    const d = keep(answer([draft({ test: { assumption: "1", what: "Fake-door “Subscribe” button", how: "Send “your plan is ready” to parents who “reorder the same 12 things”.", pass: "half tap it" } })])).drafts[0];
    expect(d.test).toMatchObject({ what: "Fake-door ‘Subscribe’ button", how: "Send ‘your plan is ready’ to parents who “reorder the same 12 things”." });
  });

  it("keeps a draft whose test can't be stood behind, without the test", () => {
    const d = keep(answer([draft({ test: { assumption: "1", what: "Ask parents", how: "", pass: "half say yes" } })])).drafts[0];
    expect(d.test).toBeNull();
    expect(draftCards(d).test).toBeNull();
  });

  it("drops a solution whose own words put quotes in someone's mouth", () => {
    expect(keep(answer([draft({ title: "A “Plan it for me” button" })])).drafts).toEqual([]);
    expect(keep(answer([draft({ title: "A ‘Plan it for me’ button" })])).drafts.map((d) => d.title)).toEqual(["A ‘Plan it for me’ button"]);
  });

  it("takes a test's numbers as a plan, how many people included", () => {
    const d = keep(answer([draft({ test: { assumption: "1", what: "Watch 5 parents plan a week", how: "Send 10 weekly shoppers a prepared plan and count who uses it.", pass: "6 of 10 use it" } })])).drafts[0];
    expect(d.test).toMatchObject({ what: "Watch 5 parents plan a week", how: "Send 10 weekly shoppers a prepared plan and count who uses it.", suggested: "6 of 10 use it" });
  });

  it("never counts an id's digits as a number someone said", () => {
    // q1, q2, l1, l2 were sent; 2 parents in 1 week weren't.
    expect(keep(answer([draft({ description: "Prefill it: 2 parents said so in 1 week." })])).drafts).toEqual([]);
  });

  it("says so when fewer than two drafts hold, and never adds one of its own", () => {
    expect(keep(answer([draft()])).note).toBe("Each saves the Sunday hour. Qalam AI found only one way it could stand behind.");
    expect(keep(answer([], "")).note).toBe("Qalam AI found no way it could stand behind.");
  });

  it("takes ids out of what it wrote", () => {
    const d = keep(answer([draft({ description: "Answers l1 for parents at the m1 step [q2]." })])).drafts[0];
    expect(d.description).toBe("Answers for parents at the Weekly plan screen step.");
  });
});

describe("a draft on a board", () => {
  it("lands as a solution under the problem with its test under it, the test resting on the solution", () => {
    const doc = emptyDoc();
    const problem = makeCardNode(newCard("opportunity", { title: "Planning the week's meals takes too long" }));
    addCardIn(doc, problem, null);
    const d = keep(answer([draft()])).drafts[0];
    const { solution, test } = draftCards(d);
    const sol: Proposal = { id: "sol:x", kind: "card", cardId: "S", parentId: problem.id, card: solution, backing: { quotes: [], words: [] }, why: "" };
    const t: Proposal = { id: "test:x", kind: "card", cardId: "T", parentId: "S", card: test!, backing: { quotes: [], words: [] }, why: "" };
    expect(applyProposal(doc, sol, () => null)).toBe(true);
    expect(applyProposal(doc, t, () => null)).toBe(true);
    expect(doc.nodes.T.parentId).toBe("S");
    // Only a need, or a solution or test under a card, may rest on nothing.
    expect(applyProposal(doc, { ...sol, cardId: "S2", parentId: null }, () => null)).toBe(false);
  });
});

describe("a draft's backing on a board", () => {
  it("attaches the quotes it cites and their idea, by where they live", () => {
    const d = keep(answer([draft({ title: "Copy last week's plan", idea: "i1" })])).drafts[0];
    const where: Record<string, { sourceId: string; quoteId: string }> = { "hub:quote:b": { sourceId: "s2", quoteId: "b" }, "hub:quote:i": { sourceId: "d1", quoteId: "i" } };
    where["hub:quote:a"] = { sourceId: "s1", quoteId: "a" };
    expect(draftBacking(d, (ref) => where[ref] ?? null, 1, () => "e")).toEqual({
      quotes: [
        { sourceId: "s2", quoteId: "b" },
        { sourceId: "s1", quoteId: "a" },
        { sourceId: "d1", quoteId: "i" },
      ],
      words: [],
    });
    // Their idea's words still go along when its source can't be found.
    expect(draftBacking(d, () => null, 1, () => "e").words).toEqual([{ id: "e", kind: "dump", text: "a button to copy last week's plan", sourceId: "d1", addedBy: "ai", at: 1 }]);
  });
});
