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

  it("says people online's words are theirs, never the customers'", () => {
    const m = solutionsMaterial(input({ pieces: [...input().pieces, { ref: "hub:quote:p", text: "the app forgets my list", label: "Reddit thread", source: "s9", evidence: false, online: true }] }));
    expect(m.text).toContain("· people online · Reddit thread · “the app forgets my list”");
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

  it("keeps a draft resting on nothing the problem says, and says where it came from", () => {
    const { drafts } = keep(answer([draft({ cites: ["g1", "m1"] }), draft({ title: "A shared family plan", cites: ["l9", "q7"] })]));
    expect(drafts.map((d) => d.title)).toEqual(["Start the week from last week's order", "A shared family plan"]);
    // An id it wasn't sent is no citation.
    expect(drafts[1].cites).toEqual({ lines: [], pieces: [], goals: [], claims: [], steps: [] });
    expect(drafts.map((d) => d.came)).toEqual(["idea", "idea"]);
    expect(draftCards(drafts[0]).solution.came).toBe("idea");
  });

  it("says nothing of where it came from when customers' words back it, and says so when only others' or their own do", () => {
    expect(keep(answer([draft()])).drafts[0].came).toBeUndefined();
    const i = input({ pieces: [{ ref: "hub:quote:o", text: "the app forgets my list", label: "Reddit", source: "s9", evidence: false, online: true }, { ref: "hub:quote:t", text: "we think they want it", label: "Their answers", source: "a", evidence: false }], claims: [{ id: "C1", who: "Acme", what: "Reorders", quote: "reorders rose" }] });
    expect(keep(answer([draft({ cites: ["q1"] })]), i).drafts[0].came).toBe("read");
    expect(keep(answer([draft({ cites: ["q2"] })]), i).drafts[0].came).toBe("answers");
    expect(keep(answer([draft({ cites: ["c1"] })]), i).drafts[0].came).toBe("read");
    expect(keep(answer([draft({ cites: [] })]), i).drafts[0].came).toBe("idea");
  });

  it("takes out words and numbers that aren't in what was sent, and the card stays", () => {
    const { drafts } = keep(answer([draft({ description: "Parents say “I hate cooking” so prefill it. It saves the Sunday hour." }), draft({ title: "Save 45 minutes a week" })]));
    expect(drafts.map((d) => d.title)).toEqual(["Start the week from last week's order", "Save minutes a week"]);
    expect(drafts[0].description).toBe("It saves the Sunday hour.");
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
    // A draft with no assumption stays, and a test needs one to test.
    const bare = keep(answer([draft({ assumptions: [] })])).drafts[0];
    expect(bare.assumptions).toEqual([]);
    expect(bare.test).toBeNull();
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

  it("takes quotes out of someone's mouth, and a title with nothing left says nothing", () => {
    expect(keep(answer([draft({ title: "A “Plan it for me” button" })])).drafts).toEqual([]);
    expect(keep(answer([draft({ title: "A one-tap “Plan it for me” button for parents" })])).drafts.map((d) => d.title)).toEqual(["A one-tap button for parents"]);
    expect(keep(answer([draft({ title: "A ‘Plan it for me’ button" })])).drafts.map((d) => d.title)).toEqual(["A ‘Plan it for me’ button"]);
  });

  it("takes a test's numbers as a plan, how many people included", () => {
    const d = keep(answer([draft({ test: { assumption: "1", what: "Watch 5 parents plan a week", how: "Send 10 weekly shoppers a prepared plan and count who uses it.", pass: "6 of 10 use it" } })])).drafts[0];
    expect(d.test).toMatchObject({ what: "Watch 5 parents plan a week", how: "Send 10 weekly shoppers a prepared plan and count who uses it.", suggested: "6 of 10 use it" });
  });

  it("never counts an id's digits as a number someone said", () => {
    // q1, q2, l1, l2 were sent; 2 parents in 1 week weren't.
    expect(keep(answer([draft({ description: "Prefill it: 2 parents said so in 1 week." })])).drafts[0].description).toBe("");
  });

  it("says so when fewer than two drafts come back, and never adds one of its own", () => {
    expect(keep(answer([draft()])).note).toBe("Each saves the Sunday hour. Qalam AI has only one way to propose.");
    expect(keep(answer([], "")).note).toBe("Qalam AI has no new way to propose.");
  });

  it("says what a solution is and how it's done, and a type it doesn't know is no type", () => {
    const d = keep(answer([draft({ type: "message", how: "SMS, through a tool like Twilio" })])).drafts[0];
    expect([d.type, d.how]).toEqual(["message", "SMS, through a tool like Twilio"]);
    expect(draftCards(d).solution).toMatchObject({ solutionType: "message", how: "SMS, through a tool like Twilio" });
    const bare = keep(answer([draft({ type: "magic", how: "" })])).drafts[0];
    expect([bare.type, bare.how]).toEqual([undefined, undefined]);
    expect(draftCards(bare).solution.solutionType).toBeUndefined();
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
