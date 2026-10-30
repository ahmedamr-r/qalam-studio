import { describe, expect, it } from "vitest";
import { sanitizeTests, testProposals, testsMaterial } from "./tests";

const material = () =>
  testsMaterial({
    solution: { title: "Plan the week from last week's order", description: "Starts the week's plan from what the family bought last week.", assumptions: ["Families reorder most of the same items"], tests: [] },
    problem: { title: "Lists take an hour every Sunday" },
    goal: { title: "1,000 families planning weekly by March", metric: "families: 0 → 1,000" },
    pieces: [
      { ref: "hub:quote:a", text: "Every Sunday I rebuild the same shopping list and it takes me an hour.", label: "survey.csv", evidence: true },
      { ref: "hub:quote:b", text: "Half of what they buy repeats week to week.", label: "Your notes", evidence: false },
    ],
  });
let n = 0;
const id = () => `a${++n}`;

describe("drafting a solution's tests", () => {
  it("sends the solution, its problem, its goal and the words they rest on, customers' first, and what it assumes already", () => {
    const m = material();
    expect(m.text).toContain("The solution: “Plan the week from last week's order”");
    expect(m.text).toContain("- q1 · customers · survey.csv · “Every Sunday I rebuild");
    expect(m.text).toContain("What it assumes already (don't propose these again):\n- Families reorder most of the same items");
    // Ids aren't words anyone said.
    expect(m.hay).not.toMatch(/q1 ·/);
  });

  it("keeps new assumptions whose words hold, and a test of the one it names", () => {
    n = 0;
    const d = sanitizeTests(
      {
        assumptions: [
          { category: "desirability", text: "Parents want the week planned for them.", importance: "3" },
          { category: "viability", text: "Families reorder most of the same items", importance: "2" },
          { category: "feasibility", text: "We can read 40% of receipts.", importance: "2" },
          { category: "usability", text: "Parents can edit a plan in under a minute.", importance: "1" },
        ],
        test: { assumption: "1", what: "Fake-door “Plan my week” button", how: "Show 20 parents the button on the home and count taps.", pass: "8 of 20 tap it" },
        note: "Whether parents want it planned is the riskiest.",
      },
      material(),
      { id },
    );
    // Already assumed, and a number nobody said: left out.
    expect(d.assumptions.map((a) => [a.category, a.importance])).toEqual([
      ["desirability", 3],
      ["usability", 1],
    ]);
    // A test is a plan: its own numbers stand, and quoted words nobody said become proposed wording.
    expect(d.test).toEqual({ assumption: d.assumptions[0].id, what: "Fake-door ‘Plan my week’ button", how: "Show 20 parents the button on the home and count taps.", suggested: "8 of 20 tap it" });
    expect(d.note).toBe("Whether parents want it planned is the riskiest.");
  });

  it("tests the riskiest when the one it names wasn't kept, and says so when nothing was", () => {
    const d = sanitizeTests({ assumptions: [{ category: "desirability", text: "Parents want it.", importance: "2" }], test: { assumption: "4", what: "Talk to parents", how: "Ask five parents how they plan.", pass: "Three say yes" } }, material(), { id });
    expect(d.test?.assumption).toBe(d.assumptions[0].id);
    const none = sanitizeTests({ assumptions: [], test: { assumption: "1", what: "x", how: "y", pass: "z" } }, material(), { id });
    expect(none).toMatchObject({ assumptions: [], test: null, note: "Qalam AI found nothing new it could stand behind." });
  });

  it("becomes the assumptions onto the solution and a test card under it, one draft", () => {
    const d = sanitizeTests({ assumptions: [{ category: "desirability", text: "Parents want it.", importance: "3" }], test: { assumption: "1", what: "Talk to parents", how: "Ask five parents how they plan.", pass: "Three say yes" } }, material(), { id });
    const ps = testProposals(d, "sol1", () => "new", "k");
    expect(ps.map((p) => [p.id, p.kind, p.cardId])).toEqual([
      ["assume:k", "assumption", "sol1"],
      ["test:k", "card", "new"],
    ]);
    const test = ps[1].kind === "card" ? ps[1] : null;
    expect(test?.parentId).toBe("sol1");
    expect(test?.card).toMatchObject({ kind: "test", title: "Talk to parents", createdBy: "ai", test: { assumptionIds: [d.assumptions[0].id], method: "Ask five parents how they plan.", suggested: { criterion: "Three say yes" } } });
    expect(testProposals({ assumptions: [], test: null, note: "" }, "sol1", () => "x")).toEqual([]);
  });
});
