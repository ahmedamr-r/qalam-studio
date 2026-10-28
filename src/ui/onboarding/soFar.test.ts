import { describe, expect, it } from "vitest";
import type { ShapedGoal } from "@/goals/outline";
import type { Goal } from "@/goals/types";
import type { SetupLine, SetupSession } from "@/org/setup";
import { soFarOf, tally, type SoFarInput } from "./soFar";

const line = (id: string, over: Partial<SetupLine> = {}): SetupLine => ({ id, to: "org", field: "goals", text: id, pieces: [], answers: [], why: "", ...over });
const goal = (id: string, parent: string | null = null): Goal => ({ id, title: id, parent, product: null, status: "active" as Goal["status"], cites: [], by: "person", at: 0 });

const input = (over: Partial<SoFarInput> = {}): SoFarInput => ({
  org: "Basket",
  session: null,
  quotes: [],
  products: [],
  know: null,
  tree: { goals: [], north: null },
  about: { context: "", audience: "" },
  ...over,
});

describe("soFarOf", () => {
  it("shows Qalam AI's lines to review, each with what it rests on", () => {
    const session: SetupSession = {
      v: 1,
      phase: "review",
      understanding: "",
      challenges: [],
      buckets: [],
      proposal: {
        summary: "s",
        products: [],
        lines: [line("north", { pieces: ["q1"] }), line("churn", { parent: "north", answers: [{ question: "Churn now?", answer: "8%" }] }), line("what", { field: "context", text: "Groceries for parents" })],
      },
      decided: { north: "accepted" },
    };
    const v = soFarOf(input({ session, quotes: [{ id: "q1", text: "We want 2M a month" }] }));
    expect(v.from).toBe("proposal");
    expect(v.goals.map((g) => [g.title, g.depth, g.north, g.state])).toEqual([
      ["north", 0, true, "accepted"],
      ["churn", 1, false, "proposed"],
    ]);
    expect(v.goals[0].rests?.quotes).toEqual(["We want 2M a month"]);
    expect(v.goals[1].rests?.answers).toEqual([{ question: "Churn now?", answer: "8%" }]);
    expect(v.groups.map((g) => [g.title, g.lines.map((l) => l.label)])).toEqual([["About Basket", ["What we do"]]]);
    expect(v.open).toEqual(["churn", "what"]);
    expect(v.goals.map((g) => [g.metric, g.where, g.fresh])).toEqual([
      [null, null, false],
      [null, null, false],
    ]);
    expect(v.groups[0].lines[0].field).toBe("context");
    expect(tally(v)).toEqual({ accepted: 1, discarded: 0, open: 2 });
  });

  it("shows the goals they wrote while they review them", () => {
    const goals: ShapedGoal[] = [
      { ref: "o1", title: "2M a month", parent: null, product: null, metric: null, missing: ["number"] },
      { ref: "o2", title: "More reorders", parent: "o1", product: { name: "Basket Kids" }, metric: null, missing: [] },
    ];
    const v = soFarOf(input({ know: { phase: "review", goals } }));
    expect(v.from).toBe("know");
    expect(v.goals.map((g) => [g.title, g.depth, g.north, g.ref])).toEqual([
      ["2M a month", 0, true, "o1"],
      ["More reorders", 1, false, "o2"],
    ]);
    expect(v.goals[1].detail).toContain("Basket Kids · new");
    expect([v.goals[1].where, v.goals[1].fresh]).toEqual(["Basket Kids", true]);
  });

  it("otherwise shows the goals and the About as they are", () => {
    const v = soFarOf(input({ tree: { goals: [goal("n"), goal("a", "n"), goal("b", "a")], north: "n" }, about: { context: "Groceries", audience: "" }, products: [{ id: "p", name: "Kids", audience: "", context: "", segments: [] }] }));
    expect(v.from).toBe("tree");
    expect(v.goals.map((g) => [g.goalId, g.depth, g.north])).toEqual([
      ["n", 0, true],
      ["a", 1, false],
      ["b", 2, false],
    ]);
    expect(v.groups.map((g) => [g.title, g.lines.length])).toEqual([
      ["About Basket", 1],
      ["Kids", 0],
    ]);
  });

  it("is empty before anything exists", () => {
    expect(soFarOf(input())).toEqual({ from: "none", goals: [], groups: [], open: [] });
  });
});
