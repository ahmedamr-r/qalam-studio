import { describe, expect, it } from "vitest";
import type { Doc } from "@/doc/schema";
import type { OstCard, OstMetric } from "@/discovery/types";
import { goalDecisions } from "./decisions";
import { goalsFromMarkdown, goalsToMarkdown, metricLine } from "./goals-md";
import { migrateGoals, outcomeGoalId, textGoalId } from "./migrate";
import { applyCopy, copyOfGoal, goalSide, reconcile } from "./mirror";
import { goalsText } from "./text";
import { addGoal, chainOf, childrenOf, ordered, patchGoal, removeGoal, rootsOf, setNorth } from "./tree";
import type { Goal, GoalTree } from "./types";

const metric = (o: Partial<OstMetric> = {}): OstMetric => ({ name: "Reorders per customer", unit: "orders", direction: "increase", baseline: 1.2, current: 1.3, target: 1.5, ...o });
const goal = (id: string, o: Partial<Goal> = {}): Goal => ({ id, title: `Goal ${id}`, parent: null, product: null, status: "active", cites: [], by: "person", at: 1, ...o });
const tree = (goals: Goal[], north: string | null = null): GoalTree => ordered({ goals, north });
const names = { product: (id: string) => ({ grocery: "Grocery app", business: "Basket for Business" })[id] };

describe("goals.md", () => {
  const t = tree(
    [
      goal("ns", { title: "2M dirhams a month in orders by end of Q2" }),
      goal("reorder", { title: "More customers reorder every week", parent: "ns", product: "grocery", metric: metric(), on: { board: "reorders", card: "o1" }, by: "qalam", feeds: "Reorders are most of the orders" }),
      goal("second", { title: "More first-time customers order a second time", parent: "reorder", product: "grocery", status: "paused" }),
      goal("pantry", { title: "Offices reorder on a schedule", product: "business" }),
    ],
    "ns",
  );

  it("writes the tree as nested bullets under its two headings and reads it back", () => {
    const md = goalsToMarkdown(t, names);
    expect(md).toContain("## North Star\n\n- 2M dirhams a month in orders by end of Q2 <!-- qalam");
    expect(md).toContain("\n  - More customers reorder every week · *Grocery app · 1.3 → 1.5 orders* <!-- qalam");
    expect(md).toContain("\n    - More first-time customers order a second time · *Grocery app* <!-- qalam");
    expect(md).toContain("## Not under a goal yet\n\n- Offices reorder on a schedule · *Basket for Business* <!-- qalam");
    expect(goalsFromMarkdown(md)).toEqual(t);
  });

  it("reads a file edited by hand: new lines, moved lines, reworded lines, notes kept", () => {
    const md = goalsToMarkdown(t, names)
      // A person rewords Qalam AI's goal: it's theirs now.
      .replace("More customers reorder every week ·", "More customers reorder weekly ·")
      // Moves the pantry goal under the North Star, and adds one of their own with a tab.
      .replace(/\n## Not under a goal yet\n\n- Offices/, "\n  - Offices")
      .replace("# Goals\n", "# Goals\n\nOur goals for 2027.\n")
      .concat("\t\t- Fewer late deliveries\n      Delivery times got worse in October.\n\n## Questions\n\n- Do offices want Mondays?\n");
    const back = goalsFromMarkdown(md);
    const reorder = back.goals.find((g) => g.id === "reorder")!;
    expect(reorder).toMatchObject({ title: "More customers reorder weekly", by: "person", metric: metric(), on: { board: "reorders", card: "o1" } });
    expect(back.goals.find((g) => g.id === "pantry")!.parent).toBe("ns");
    const late = back.goals.find((g) => g.title === "Fewer late deliveries")!;
    expect(late).toMatchObject({ parent: "pantry", by: "person", status: "active", more: "Delivery times got worse in October." });
    expect(late.id).toMatch(/^p/);
    expect(back.notes).toBe("Our goals for 2027.\n\n## Questions\n\n- Do offices want Mondays?");
    // Writing it again keeps all of that.
    expect(goalsFromMarkdown(goalsToMarkdown(back, names))).toEqual(back);
  });

  it("takes the first top-level goal under North Star as the North Star", () => {
    const back = goalsFromMarkdown("# Goals\n\n## North Star\n\n- Grow revenue\n- Win schools\n");
    expect(back.north).toBe(back.goals[0].id);
    expect(rootsOf(back).map((g) => g.title)).toEqual(["Grow revenue", "Win schools"]);
    expect(goalsToMarkdown(back)).toContain("## Not under a goal yet\n\n- Win schools");
  });

  it("refuses another format's file without losing its words", () => {
    expect(goalsFromMarkdown('---\nqalam: "goals/9"\n---\n\n# Goals\n- x\n')).toMatchObject({ goals: [], north: null, notes: "# Goals\n- x" });
  });

  it("says a number in a line", () => {
    expect(metricLine(metric())).toBe("1.3 → 1.5 orders");
    expect(metricLine(metric({ current: null, timeframe: "June" }))).toBe("1.2 → 1.5 orders by June");
    expect(metricLine(metric({ target: null, current: 1400000, unit: "AED" }))).toBe("now 1,400,000 AED");
  });
});

describe("the tree", () => {
  const t = tree([goal("a"), goal("b", { parent: "a" }), goal("c", { parent: "b" }), goal("d")], "a");

  it("keeps each goal after its parent, the North Star's tree first", () => {
    expect(tree([goal("d"), goal("c", { parent: "b" }), goal("b", { parent: "a" }), goal("a")], "a").goals.map((g) => g.id)).toEqual(["a", "b", "c", "d"]);
    expect(chainOf(t, "c").map((g) => g.id)).toEqual(["c", "b", "a"]);
    expect(childrenOf(t, null).map((g) => g.id)).toEqual(["a", "d"]);
  });

  it("refuses to put a goal under itself, and lifts orphans and cycles to the top", () => {
    expect(patchGoal(t, "a", { parent: "c" })).toBe(t);
    expect(ordered({ goals: [goal("x", { parent: "y" }), goal("y", { parent: "x" }), goal("z", { parent: "gone" })], north: null }).goals.filter((g) => !g.parent).length).toBe(2);
  });

  it("moves a removed goal's children up to its parent", () => {
    expect(removeGoal(t, "b").goals.find((g) => g.id === "c")!.parent).toBe("a");
    expect(removeGoal(t, "a").north).toBeNull();
  });

  it("adds, changes and clears", () => {
    const t2 = patchGoal(addGoal(t, goal("e", { parent: "a" })), "e", { metric: metric(), lever: "retention" });
    expect(t2.goals.map((g) => g.id)).toEqual(["a", "b", "c", "e", "d"]);
    expect(patchGoal(t2, "e", { metric: null, lever: null }).goals.find((g) => g.id === "e")).not.toHaveProperty("metric");
    expect(setNorth(t2, "d").north).toBe("d");
    expect(setNorth(t2, "b")).toBe(t2);
  });
});

describe("moving goals into goals.md", () => {
  const outcome = (card: string, title: string, o: Partial<{ parent: string | null; metric: OstMetric; pieces: string[] }> = {}) => ({ card, title, stage: "active" as const, parent: o.parent ?? null, pieces: o.pieces ?? [], ...(o.metric ? { metric: o.metric } : {}) });
  const input = {
    about: ["2M dirhams a month in orders by end of Q2"],
    products: [
      { id: "grocery", goals: ["More customers reorder every week", "More first-time customers order a second time"] },
      { id: "business", goals: ["Offices reorder on a schedule"] },
    ],
    boards: [
      { board: "reorders", product: "grocery", createdAt: 20, outcomes: [outcome("o1", "More customers reorder every week", { metric: metric(), pieces: ["hub:quote:q1"] }), outcome("o4", "Planners rebuild their basket in one tap", { parent: "o1" })] },
      { board: "delivery", product: "grocery", createdAt: 10, outcomes: [outcome("o2", "Deliveries arrive when promised")] },
    ],
    at: 5,
  };

  it("makes the About's first goal the North Star, joins each outcome to its goal, and nests sub-outcomes", () => {
    const t = migrateGoals(input);
    expect(t.north).toBe(textGoalId("2M dirhams a month in orders by end of Q2"));
    const reorder = t.goals.find((g) => g.on?.card === "o1")!;
    expect(reorder).toMatchObject({ id: textGoalId("grocery:More customers reorder every week"), product: "grocery", metric: metric(), cites: ["hub:quote:q1"], parent: null });
    expect(t.goals.find((g) => g.on?.card === "o4")).toMatchObject({ id: outcomeGoalId("reorders", "o4"), parent: reorder.id, at: 20 });
    expect(t.goals.find((g) => g.on?.card === "o2")).toMatchObject({ id: outcomeGoalId("delivery", "o2"), product: "grocery", parent: null });
    // The product goals wait to be placed under the goal they feed.
    expect(t.goals.filter((g) => g.parent === null).length).toBe(5);
    expect(t.goals).toHaveLength(6);
  });

  it("gives the same file on every computer", () => {
    expect(goalsToMarkdown(migrateGoals(input))).toBe(goalsToMarkdown(migrateGoals({ ...input, boards: [...input.boards].reverse(), products: [...input.products].reverse() })));
  });
});

describe("goal decisions", () => {
  const ctx = { now: 100, newId: (() => { let n = 0; return () => `d${++n}`; })() };
  const before = tree([goal("ns", { title: "Revenue" }), goal("r", { title: "Reorders", metric: metric() }), goal("s", { title: "Second orders", parent: "r" }), goal("x", { title: "Old goal" })], "ns");

  it("records a new target, a number moved by hand, a status, a move and a goal taken off", () => {
    let after = patchGoal(before, "r", { metric: metric({ target: 1.6, current: 1.4 }), status: "paused", parent: "ns" });
    after = patchGoal(after, "s", { parent: null });
    after = removeGoal(after, "x");
    const found = goalDecisions(before, after, ctx);
    expect(found.map((d) => [d.kind, d.what, d.big])).toEqual([
      ["stage", "Paused “Reorders”", false],
      ["move", "Put “Reorders” under “Revenue”", false],
      ["metric", "Changed the target of “Reorders” from 1.5 orders to 1.6 orders", true],
      ["metric", "“Reorders” is at 1.4 orders now (was 1.3 orders)", false],
      ["move", "Took “Second orders” out from under “Reorders”", false],
      ["drop", "Took the goal “Old goal” off", true],
    ]);
    expect(found[0]).toMatchObject({ board: "goals", card: "r", goal: "r", boardName: "Goals" });
  });

  it("doesn't record a reading from an analytics tool, a new goal or new words", () => {
    let after = patchGoal(before, "r", { metric: metric({ current: 1.4, readAt: 50 }), title: "More reorders" });
    after = addGoal(after, goal("x"));
    expect(goalDecisions(before, after, ctx)).toEqual([]);
  });

  it("asks why when a goal moves from one goal to another, or the North Star changes", () => {
    const t = tree([...before.goals, goal("o", { title: "Offices" })], "ns");
    expect(goalDecisions(t, patchGoal(t, "s", { parent: "o" }), ctx)[0]).toMatchObject({ kind: "move", big: true });
    expect(goalDecisions(t, setNorth(t, "o"), ctx).at(-1)).toMatchObject({ what: "Made “Offices” the North Star, instead of “Revenue”", big: true });
  });
});

describe("a board's cards and their goals", () => {
  const card = (title: string, o: Partial<OstCard> = {}): OstCard => ({ v: 1, kind: "outcome", title, stage: "active", createdBy: "user", evidence: [], ...o });
  const doc = (cards: Record<string, { card: OstCard; parent?: string }>): Doc => ({ nodes: Object.fromEntries(Object.entries(cards).map(([id, x]) => [id, { id, parentId: x.parent ?? null, meta: { ost: x.card } }])), roots: [] }) as unknown as Doc;
  const goals = tree([goal("g1", { title: "Reorders", metric: metric(), on: { board: "b", card: "o1" } })]);
  const base = { board: "b", product: "grocery", now: 9 };

  it("brings a card up to its goal on opening, and a goal up to its card after an edit on the board", () => {
    const open = reconcile({ ...base, doc: doc({ o1: { card: card("Old words") } }), goals, synced: new Map() });
    expect(open.toCard.get("o1")).toEqual(copyOfGoal(goals.goals[0]));
    const edited = reconcile({ ...base, doc: doc({ o1: { card: card("Reorders weekly", { metric: metric({ target: 1.6 }) }) } }), goals, synced: open.synced });
    expect(edited.toGoal.get("g1")).toEqual({ title: "Reorders weekly", metric: metric({ target: 1.6 }), stage: "active" });
    expect(edited.toCard.size).toBe(0);
  });

  it("lets the goal win when both changed", () => {
    const synced = new Map([["o1", { title: "Before", stage: "active" as const }]]);
    expect(reconcile({ ...base, doc: doc({ o1: { card: card("Board's words") } }), goals, synced }).toCard.get("o1")?.title).toBe("Reorders");
  });

  it("gives a new outcome card its goal, under the goal of the outcome above it, and lets go of a deleted card's", () => {
    const r = reconcile({ ...base, doc: doc({ o1: { card: card("Reorders", { metric: metric() }) }, o2: { card: card("Second orders"), parent: "o1" }, o3: { card: card("  ") } }), goals, synced: new Map() });
    expect(r.create).toEqual([expect.objectContaining({ id: outcomeGoalId("b", "o2"), parent: "g1", product: "grocery", on: { board: "b", card: "o2" } })]);
    expect(reconcile({ ...base, doc: doc({}), goals, synced: new Map() }).unlink).toEqual(["g1"]);
  });

  it("copies a goal onto a card", () => {
    const c = card("x", { metric: metric(), stage: "active" });
    applyCopy(c, { title: "Y", metric: undefined, stage: "achieved" });
    expect(c).toMatchObject({ title: "Y", stage: "achieved" });
    expect(c).not.toHaveProperty("metric");
    // Only the fields given: what undo keeps from a goal's change elsewhere.
    applyCopy(c, { title: "Z" });
    expect(c).toMatchObject({ title: "Z", stage: "achieved" });
  });

  it("keeps through undo only what changed on the goal's side", () => {
    const agreed = { title: "Reorders", metric: metric(), stage: "active" as const };
    // The goal was reworded elsewhere; the board changed the target meanwhile.
    expect(goalSide(agreed, { ...agreed, title: "Reorders weekly" }, { ...agreed, metric: metric({ target: 1.7 }) })).toEqual({ title: "Reorders weekly" });
    expect(goalSide(undefined, { ...agreed, title: "New" }, agreed)).toEqual({ title: "New" });
  });
});

describe("goals in a prompt", () => {
  const t = tree(
    [goal("ns", { title: "2M dirhams a month" }), goal("r", { title: "Reorders", parent: "ns", product: "grocery", metric: metric() }), goal("s", { title: "Second orders", parent: "r", product: "grocery" }), goal("p", { title: "Offices on a schedule", product: "business" })],
    "ns",
  );

  it("tells a product's goals with the goals above them", () => {
    const text = goalsText(t, { product: "grocery", productName: names.product });
    expect(text).toBe("Goals (each under the goal it feeds):\n- North Star: 2M dirhams a month\n  - Reorders (Grocery app) · Reorders per customer: 1.3 → 1.5 orders\n    - Second orders (Grocery app)");
  });

  it("marks a board's own goal, and tells the whole tree when nothing narrows it", () => {
    expect(goalsText(t, { goals: ["s"] })).toContain("- Second orders (a product) · this board's goal");
    expect(goalsText(t)).toContain("a top-level goal other than the North Star doesn't feed one yet");
    expect(goalsText({ goals: [], north: null })).toBe("");
  });
});
