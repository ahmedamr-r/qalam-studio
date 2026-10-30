import { describe, expect, it } from "vitest";
import type { OstMetric } from "@/discovery/types";
import type { RankedNeed } from "@/hub/needs";
import type { Topic } from "@/hub/topics";
import { runChecks } from "@/hub/checks";
import { bearingMaterial, foldBearings, problemsInScope, sanitizeBearings, type BearingLog } from "./bearings";
import { goalsOfNeed, rankForGoal } from "./problems";
import { ordered } from "./tree";
import type { Goal, GoalTree } from "./types";

const metric = (o: Partial<OstMetric> = {}): OstMetric => ({ name: "Reorders per customer", unit: "orders", direction: "increase", baseline: 1.2, current: 1.3, target: 1.5, ...o });
const goal = (id: string, o: Partial<Goal> = {}): Goal => ({ id, title: `Goal ${id}`, parent: null, product: null, status: "active", cites: [], by: "person", at: 1, ...o });
const tree: GoalTree = ordered({
  north: "ns",
  goals: [
    goal("ns", { title: "2M dirhams a month in orders" }),
    goal("r", { title: "More customers reorder every week", parent: "ns", product: "grocery", metric: metric(), on: { board: "b1", card: "o1" } }),
    goal("s", { title: "More first orders become second orders", parent: "r", product: "grocery" }),
    goal("o", { title: "Offices reorder on a schedule", product: "business" }),
  ],
});
const line = (id: string, text: string, section: "know" | "believe" = "know") => ({ id, section, text, cites: [], by: "qalam" as const, from: [], at: 1 });
const page = (id: string, title: string, lines: ReturnType<typeof line>[], products = ["grocery"]): Topic => ({ id, kind: "need", title, products, createdAt: 1, updatedAt: 1, lines, history: [] });
const basket = page("p1", "Rebuilding my usual basket takes too long", [line("a", "Sara rebuilds her weekly shop by hand: “Every Sunday night I sit down and rebuild my basket from scratch.”"), line("b", "Omar says it takes him twenty minutes every Friday.")]);
const fees = page("p2", "Surprise delivery fees put me off ordering again", [line("c", "Two customers stopped ordering after a fee they didn't expect.")]);
const pantry = page("p3", "We run out of pantry staples", [line("d", "Karim counts the pantry by hand each Monday.")], ["business"]);

describe("which problems bear on which goals", () => {
  it("folds the log: the latest line per pair, and a person's word over Qalam AI's", () => {
    const log: BearingLog[] = [
      { need: "p1", goal: "r", bears: "direct", how: "One", cites: [], by: "qalam", at: 1 },
      { need: "p1", goal: "r", bears: "direct", how: "Two", cites: [], by: "qalam", at: 2 },
      { need: "p2", goal: "r", bears: "some", how: "Fees", cites: [], by: "qalam", at: 1 },
      { need: "p2", goal: "r", by: "you", removed: true, at: 3 },
      { need: "p2", goal: "r", bears: "some", how: "Fees again", cites: [], by: "qalam", at: 4 },
      { need: "p3", goal: "o", bears: "direct", how: "", cites: [], by: "you", at: 1 },
      { need: "p3", goal: "o", by: "qalam", removed: true, at: 2 },
    ];
    const { links, refused } = foldBearings(log);
    expect(links.map((l) => [l.need, l.goal, l.how, l.by])).toEqual([
      ["p1", "r", "Two", "qalam"],
      ["p3", "o", "", "you"],
    ]);
    expect([...refused]).toEqual(["p2|r"]);
  });

  it("sends the goals under ids with their numbers, and the problems with their lines", () => {
    const m = bearingMaterial({ tree, targets: ["r", "s"], problems: [basket, fees], evidence: new Map([["p1", { quotes: 15, sources: 6, against: 3 }]]), productName: (id) => ({ grocery: "Grocery app" })[id] });
    expect(m.text).toContain("- g1 · the organization · North Star: 2M dirhams a month in orders");
    expect(m.text).toContain("  - g2 · Grocery app · More customers reorder every week · Reorders per customer: 1.3 → 1.5 orders");
    expect(m.text).toContain("Goals a problem may be linked to: g2, g3");
    expect(m.text).toContain('<problem id="t1" title="Rebuilding my usual basket takes too long" evidence="15 quotes · 6 sources · 3 against">');
    expect(m.text).not.toContain("Offices");
    expect([...m.lines.keys()]).toEqual(["l1", "l2", "l3"]);
  });

  it("keeps a link only when its ids were sent, it rests on its own problem's lines, and its words are in them", () => {
    const m = bearingMaterial({ tree, targets: ["r", "s"], problems: [basket, fees], evidence: new Map(), productName: () => undefined });
    const raw = {
      bearings: [
        { problem: "t1", goal: "g2", bears: "direct", how: "Planners who rebuild “from scratch” every week skip reordering when it takes twenty minutes.", cites: ["l1", "l2"] },
        { problem: "t1", goal: "g2", bears: "some", how: "A second link to the same goal.", cites: ["l1"] },
        // The North Star isn't a goal it may be linked to.
        { problem: "t2", goal: "g1", bears: "some", how: "Fees cut orders.", cites: ["l3"] },
        // A number its lines don't have.
        { problem: "t2", goal: "g2", bears: "some", how: "Fees cost 40% of reorders.", cites: ["l3"] },
        // Words in quotation marks its lines don't say.
        { problem: "t2", goal: "g3", bears: "some", how: "Customers say “fees are a scam”.", cites: ["l3"] },
        // Another problem's line.
        { problem: "t2", goal: "g3", bears: "some", how: "Fees keep first orders from becoming second ones.", cites: ["l1"] },
        { problem: "t9", goal: "g2", bears: "direct", how: "Unsent.", cites: ["l1"] },
      ],
      none: "",
    };
    const kept = sanitizeBearings(raw, m, { now: 5, refused: new Set() });
    expect(kept).toEqual([{ need: "p1", goal: "r", bears: "direct", how: "Planners who rebuild “from scratch” every week skip reordering when it takes twenty minutes.", cites: ["hub:topic:p1:a", "hub:topic:p1:b"], by: "qalam", at: 5 }]);
    // The goal's own number may be named.
    expect(sanitizeBearings({ bearings: [{ problem: "t2", goal: "g2", bears: "some", how: "Fees hold reorders below 1.5 orders.", cites: ["l3"] }] }, m, { now: 5, refused: new Set() })).toHaveLength(1);
    // A pair a person took off isn't linked again.
    expect(sanitizeBearings(raw, m, { now: 5, refused: new Set(["p1|r"]) })).toEqual([]);
    expect(sanitizeBearings(null, m, { now: 5, refused: new Set() })).toEqual([]);
  });

  it("sends a long page's lines nearest the goal, in the page's order", () => {
    const long = page("p9", "Substitutions break my trust", Array.from({ length: 12 }, (_, i) => line(`x${i}`, `Line ${i}`)));
    const m = bearingMaterial({ tree, targets: ["r"], problems: [long], evidence: new Map(), productName: () => undefined, near: new Map([["hub:topic:p9:x11", 0], ["hub:topic:p9:x8", 1]]) });
    const sent = [...m.lines.values()].map((l) => l.text);
    expect(sent).toHaveLength(10);
    expect(sent).toContain("Line 11");
    expect(sent.indexOf("Line 8")).toBeLessThan(sent.indexOf("Line 11"));
    expect(sent).not.toContain("Line 9");
  });

  it("reads a product's problems and the whole organization's for a product's goal; all of them for the organization's", () => {
    const orgWide = page("p4", "Delivery is late", [], []);
    expect(problemsInScope([basket, pantry, orgWide], tree.goals[1]).map((t) => t.id)).toEqual(["p1", "p4"]);
    expect(problemsInScope([basket, pantry, orgWide], tree.goals[0]).map((t) => t.id)).toEqual(["p1", "p3", "p4"]);
  });
});

describe("the problems behind a goal", () => {
  const need = (topic: string, title: string, sources: number, quotes: number, boards: RankedNeed["boards"] = []): RankedNeed => ({ topic, title, products: ["grocery"], quotes, sources, against: 0, online: 0, onlineSources: 0, segments: [], weeks: [], boards, newest: 1 });
  const needs = [need("p1", "Rebuilding", 6, 15, [{ board: "b1", card: "n1", kind: "opportunity", shared: 3 }]), need("p2", "Fees", 2, 4), need("p5", "Substitutions", 6, 13)];
  const links = [
    { need: "p2", goal: "r", bears: "some" as const, how: "Fees", cites: [], by: "qalam" as const, at: 1 },
    { need: "p1", goal: "r", bears: "direct" as const, how: "Rebuilding", cites: [], by: "qalam" as const, at: 1 },
    { need: "p5", goal: "s", bears: "direct" as const, how: "Swaps", cites: [], by: "qalam" as const, at: 1 },
    { need: "p1", goal: "s", bears: "some" as const, how: "Also", cites: [], by: "qalam" as const, at: 1 },
  ];

  it("puts the ones bearing directly first, then by evidence, with a sub-goal's problems through it", () => {
    const ranked = rankForGoal("r", { tree, links, needs });
    expect(ranked.map((p) => [p.topic, p.bears, p.via, p.onBoard])).toEqual([
      ["p1", "direct", null, true],
      ["p5", "direct", "s", false],
      ["p2", "some", null, false],
    ]);
    expect(rankForGoal("s", { tree, links, needs }).map((p) => p.topic)).toEqual(["p5", "p1"]);
    expect(goalsOfNeed("p1", links).map((l) => l.goal)).toEqual(["r", "s"]);
  });
});

describe("a goal's number in Needs a look", () => {
  const day = 86_400_000;
  it("asks about a goal nobody has updated in weeks, on its page or its board, and leaves its card to it", () => {
    const now = 100 * day;
    const t: GoalTree = { north: null, goals: [goal("g", { title: "Reorders", metric: metric(), at: 10 * day, on: { board: "b1", card: "o1" } }), goal("h", { title: "Second orders", metric: metric(), at: 95 * day })] };
    const doc = { nodes: { o1: { id: "o1", parentId: null, meta: { ost: { kind: "outcome", title: "Reorders", stage: "active", evidence: [], metric: metric() } } } }, roots: ["o1"] };
    const found = runChecks({ now, boards: [{ id: "b1", name: "Weekly reorders", product: "grocery", createdAt: 10 * day, doc: doc as never }], decisions: [], topics: [], indexed: true, shows: new Map(), pieces: new Map(), linked: new Set(), goals: t }).filter((n) => n.kind === "metric");
    expect(found).toEqual([expect.objectContaining({ title: "“Reorders” hasn't been updated in 12 weeks", goal: "g", board: "b1", card: "o1" })]);
  });
});
