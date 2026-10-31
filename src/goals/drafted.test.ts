import { describe, expect, it } from "vitest";
import { PROBLEM_LIMITS, problemsMaterial, sanitizeProblems, type ProblemsInput } from "./drafted";

const input = (over: Partial<ProblemsInput> = {}): ProblemsInput => ({
  goal: { title: "More customers reorder every week", metric: "Weekly reorder rate: 12% → 18%" },
  above: [{ title: "Grow weekly orders", metric: null }],
  behind: ["Late-night orders arrive missing items"],
  pages: ["Substitutions break trust"],
  pieces: [
    { ref: "hub:quote:team1", text: "Most people stop after their second order", label: "Their answers", source: "ans", evidence: false },
    { ref: "hub:quote:c1", text: "Every week I have to build my basket again from scratch, it takes 20 minutes", label: "Interview with Sara", source: "s1", evidence: true },
    { ref: "hub:quote:o1", text: "I gave up on the app because reordering is a pain", label: "App Store reviews", source: "p1", evidence: false, online: true },
  ],
  ...over,
});
let n = 0;
const id = () => `d${++n}`;
const problem = (title: string, cites: string[], more: { description?: string; why?: string } = {}) => ({ title, description: more.description ?? "", why: more.why ?? "", cites });

describe("the material for a goal's problems", () => {
  it("sends the goal under the goals it feeds, what's there already, and the words, customers' first", () => {
    const m = problemsMaterial(input());
    expect(m.text).toContain("The goal: “More customers reorder every week” · its number: Weekly reorder rate: 12% → 18%");
    expect(m.text).toContain("It feeds: “Grow weekly orders” · no number yet");
    expect(m.text).toContain("- Late-night orders arrive missing items");
    expect(m.text).toContain("- Substitutions break trust");
    // Customers' words, then the team's, then people online's.
    expect([...m.pieces].map(([ref, p]) => `${ref} ${p.ref}`)).toEqual(["q1 hub:quote:c1", "q2 hub:quote:team1", "q3 hub:quote:o1"]);
    expect(m.text).toContain("- q3 · people online · App Store reviews · “I gave up on the app because reordering is a pain”");
    expect(m.known).toEqual(["Late-night orders arrive missing items", "Substitutions break trust"]);
    // The ids aren't words anyone said.
    expect(m.hay).not.toMatch(/q\d ·/);
  });

  it("says so when there are no words yet, and sends a page linked to the goal once", () => {
    const m = problemsMaterial(input({ pieces: [], pages: ["Late-night orders arrive missing items", "Substitutions break trust"] }));
    expect(m.text).toContain("(no words yet)");
    expect(m.known).toEqual(["Late-night orders arrive missing items", "Substitutions break trust"]);
  });
});

describe("what code keeps of a goal's drafted problems", () => {
  it("keeps a problem resting on words it was sent, titled as Qalam AI put it where what it cites holds it", () => {
    const m = problemsMaterial(input());
    const { drafts } = sanitizeProblems({ problems: [problem("Weekly shoppers rebuild their basket from scratch", ["q1", "q9"], { description: "It takes “20 minutes” every week.", why: "Less work to reorder means more reorders." })], note: "" }, m, { now: 1, id });
    expect(drafts).toEqual([{ id: expect.any(String), title: "Weekly shoppers rebuild their basket from scratch", by: "qalam", description: "It takes “20 minutes” every week.", why: "Less work to reorder means more reorders.", cites: ["hub:quote:c1"], at: 1 }]);
  });

  it("titles a problem by its first quote's words, customers' first, when its title says what they don't", () => {
    const m = problemsMaterial(input());
    const { drafts } = sanitizeProblems({ problems: [problem("Rebuilding a basket takes 45 minutes", ["q2", "q1"])], note: "" }, m, { now: 1, id });
    expect(drafts[0]).toMatchObject({ title: "Every week I have to build my basket again from scratch, it takes 20 minutes", by: "words", cites: ["hub:quote:team1", "hub:quote:c1"] });
  });

  it("keeps a problem without its description when the description says what wasn't sent", () => {
    const m = problemsMaterial(input());
    const dropped: string[] = [];
    const { drafts } = sanitizeProblems({ problems: [problem("Weekly shoppers rebuild their basket", ["q1"], { description: "Half of them, 50%, give up.", why: "Fewer give up." })], note: "" }, m, { now: 1, id }, (why) => dropped.push(why));
    expect(drafts[0]).toMatchObject({ description: "", why: "Fewer give up." });
    expect(dropped).toEqual(["its description's words or numbers aren't in what was sent: kept without it"]);
  });

  it("leaves out a problem resting on nothing sent, one behind the goal or on a page already, and one proposed twice", () => {
    const m = problemsMaterial(input());
    const dropped: string[] = [];
    const { drafts, note } = sanitizeProblems(
      {
        problems: [
          problem("Shoppers can't reorder", ["q7"]),
          problem("Late-night orders arrive missing items", ["q1"]),
          problem("Substitutions break trust", ["q1"]),
          problem("Weekly shoppers rebuild their basket", ["q1"]),
          problem("Weekly shoppers rebuild their basket", ["q2"]),
        ],
        note: "They all come from Sara’s interview (q1).",
      },
      m,
      { now: 1, id },
      (why) => dropped.push(why),
    );
    expect(drafts.map((d) => d.title)).toEqual(["Weekly shoppers rebuild their basket"]);
    expect(dropped.filter((w) => w === "it rests on no words it was sent")).toHaveLength(1);
    expect(dropped.filter((w) => w.startsWith("behind the goal"))).toHaveLength(3);
    expect(note).toBe("They all come from Sara’s interview. Qalam AI found only one problem it could stand behind.");
  });

  it("keeps at most so many", () => {
    const m = problemsMaterial(input());
    const many = ["Basket rebuilt weekly", "Search misses staples", "Checkout repeats questions", "Delivery slots run out", "Prices change between weeks"].map((t) => problem(t, ["q1"]));
    expect(sanitizeProblems({ problems: many }, m, { now: 1, id }).drafts).toHaveLength(PROBLEM_LIMITS.problems);
  });
});
