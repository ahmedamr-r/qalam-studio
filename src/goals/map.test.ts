import { describe, expect, it } from "vitest";
import type { MapBoard } from "@/discovery/board-cards";
import { newCard } from "@/discovery/ops";
import type { OstKind } from "@/discovery/types";
import { boxesIntersect, worldBounds } from "@/doc/geometry";
import type { Notice } from "@/hub/checks";
import type { RankedNeed } from "@/hub/needs";
import type { Bearing } from "./bearings";
import { layoutMap, mapOf } from "./map";
import { ordered } from "./tree";
import type { Goal, GoalTree } from "./types";

const goal = (id: string, o: Partial<Goal> = {}): Goal => ({ id, title: `Goal ${id}`, parent: null, product: null, status: "active", cites: [], by: "person", at: 1, ...o });
const tree: GoalTree = ordered({
  north: "ns",
  goals: [
    goal("ns", { title: "2M dirhams a month in orders" }),
    goal("r", { title: "More customers reorder every week", parent: "ns", product: "grocery", on: { board: "b1", card: "o1" } }),
    goal("s", { title: "More first orders become second orders", parent: "r", product: "grocery", on: { board: "b1", card: "o2" } }),
    goal("o", { title: "Offices reorder on a schedule", product: "business" }),
  ],
});
const card = (id: string, parent: string | null, kind: OstKind, title: string) => ({ id, parent, card: newCard(kind, { title }) });
const b1: MapBoard = {
  id: "b1",
  name: "Reorders",
  product: "grocery",
  cards: [
    card("o1", null, "outcome", "Reorders (the board's old words)"),
    card("p1", "o1", "opportunity", "Rebuilding my basket takes too long"),
    card("x1", "p1", "solution", "Copy last week's basket"),
    card("t1", "x1", "test", "Fake-door button"),
    // A sub-goal's outcome card, on the same board, under the goal it feeds.
    card("o2", "o1", "outcome", "Second orders"),
    card("p2", "o2", "opportunity", "Delivery slots run out"),
  ],
};
const b2: MapBoard = { id: "b2", name: "Pantry ideas", product: "grocery", cards: [card("q1", null, "opportunity", "We run out of staples"), card("y1", "q1", "solution", "A pantry list")] };
const need = (topic: string, title: string, o: Partial<RankedNeed> = {}): RankedNeed => ({ topic, title, products: ["grocery"], quotes: 4, sources: 2, against: 0, online: 0, onlineSources: 0, segments: [], weeks: [], boards: [], newest: 1, ...o });
const needs = [need("fees", "Surprise fees put me off"), need("basket", "Rebuilding my basket", { boards: [{ board: "b1", card: "p1", kind: "opportunity", shared: 3 }] }), need("late", "Orders arrive late"), need("old", "Once said", { sources: 1 })];
const links: Bearing[] = [
  { need: "fees", goal: "r", bears: "direct", how: "", cites: [], by: "qalam", at: 1 } as Bearing,
  { need: "basket", goal: "r", bears: "direct", how: "", cites: [], by: "you", at: 1 } as Bearing,
];
const products = [
  { id: "grocery", name: "Grocery app" },
  { id: "business", name: "For business" },
];

const titles = (m: ReturnType<typeof mapOf>, id: string) => m.doc.nodes[id].children.map((c) => m.doc.nodes[c].meta.ost!.title);

describe("the space's map", () => {
  const m = mapOf({ tree, boards: [b1, b2], space: null, links, needs, products });

  it("nests every goal under the goal it feeds, the North Star first", () => {
    expect(m.doc.roots[0]).toBe("goal:ns");
    expect(m.doc.nodes["goal:r"].parentId).toBe("goal:ns");
    expect(m.doc.nodes["goal:s"].parentId).toBe("goal:r");
    expect(m.doc.nodes["goal:o"].parentId).toBeNull();
  });

  it("hangs a goal's board under it, in the goal's own words, and a sub-goal on that board shows once, as its goal", () => {
    expect(m.doc.nodes["goal:r"].meta.ost!.title).toBe("More customers reorder every week");
    expect(titles(m, "goal:r")).toEqual(["Rebuilding my basket takes too long", "Surprise fees put me off", "More first orders become second orders"]);
    expect(titles(m, "b1:p1")).toEqual(["Copy last week's basket"]);
    expect(titles(m, "b1:x1")).toEqual(["Fake-door button"]);
    expect(titles(m, "goal:s")).toEqual(["Delivery slots run out"]);
    expect(m.doc.nodes["b1:o2"]).toBeUndefined();
    expect(m.things.get("goal:s")).toEqual({ type: "goal", goal: "s", board: "b1", card: "o2" });
    expect(m.things.get("b1:p2")).toEqual({ type: "card", board: "b1", card: "p2", goal: "s" });
    expect(m.byCard.get("b1:o2")).toBe("goal:s");
  });

  it("shows the problems behind a goal that its board hasn't, faint, and the ones it has once", () => {
    expect(m.faint.has("topic:r:fees")).toBe(true);
    expect(m.tags.get("topic:r:fees")?.label).toBe("No board");
    expect(m.doc.nodes["topic:r:basket"]).toBeUndefined();
    expect(m.things.get("topic:r:fees")).toEqual({ type: "problem", topic: "fees", goal: "r" });
  });

  it("tags a goal with no board, and a product's goal with its product in the organization's space", () => {
    expect(m.tags.get("goal:o")?.label).toBe("No board yet");
    expect(m.tags.get("goal:r")?.label).toBe("Grocery app");
  });

  it("puts the boards no goal has next, named by their board, and what no goal covers last", () => {
    expect(m.doc.roots).toEqual(["goal:ns", "goal:o", "b2:q1", "topic:none:late"]);
    expect(m.tags.get("b2:q1")?.label).toBe("Pantry ideas");
    expect(m.things.get("b2:y1")).toEqual({ type: "card", board: "b2", card: "y1", goal: null });
    expect(m.tags.get("topic:none:late")?.label).toBe("No goal yet");
    // Raised once only, or already on a board: not here.
    expect(m.doc.nodes["topic:none:old"]).toBeUndefined();
  });

  it("gives each goal its own cards for its lane, not its sub-goals'", () => {
    expect(m.groups.find((g) => g.head === "goal:r")?.cards).toEqual(["goal:r", "b1:p1", "b1:x1", "b1:t1", "topic:r:fees"]);
    expect(m.groups.find((g) => g.head === "goal:s")?.cards).toEqual(["goal:s", "b1:p2"]);
  });

  it("marks what needs a look on its card, a goal or a page", () => {
    const notices = [{ board: "b1", card: "x1" }, { goal: "o" }, { topic: "fees" }, { board: "b1", card: "o2" }] as Notice[];
    const n = mapOf({ tree, boards: [b1, b2], space: null, links, needs, notices });
    expect([...n.noticed].sort()).toEqual(["b1:x1", "goal:o", "goal:s", "topic:r:fees"]);
  });

  it("shows only a product's goals in its space, those whose goal is elsewhere at the top", () => {
    const g = mapOf({ tree, boards: [b1, b2], space: "grocery", links, needs });
    expect(g.doc.roots).toEqual(["goal:r", "b2:q1", "topic:none:late"]);
    expect(g.doc.nodes["goal:ns"]).toBeUndefined();
    expect(g.doc.nodes["goal:o"]).toBeUndefined();
    expect(g.tags.get("goal:r")).toBeUndefined();
  });

  it("keeps ids apart across boards and folds on the map only", () => {
    const twin: MapBoard = { ...b2, id: "b3", name: "Copy", cards: b2.cards };
    const f = mapOf({ tree, boards: [b1, b2, twin], space: null, folds: new Map([["b1:p1", true]]) });
    expect(f.doc.nodes["b2:q1"]).toBeDefined();
    expect(f.doc.nodes["b3:q1"]).toBeDefined();
    expect(f.doc.nodes["b1:p1"].meta.ost!.collapsed).toBe(true);
    expect(b1.cards[1].card.collapsed).toBeUndefined();
    const { doc } = layoutMap(f);
    expect(doc.nodes["b1:x1"].visible).toBe(false);
    expect(doc.nodes["b1:p1"].visible).toBe(true);
  });
});

describe("laying the map out", () => {
  const m = mapOf({ tree, boards: [b1, b2], space: null, links, needs });

  it("puts the trees side by side, none over another, and the uncovered problems in a column on the right", () => {
    const { doc } = layoutMap(m);
    const trees = doc.roots.slice(0, 3).map((id) => {
      const ids = Object.keys(doc.nodes).filter((n) => {
        let p: string | null = n;
        while (doc.nodes[p!]?.parentId) p = doc.nodes[p!].parentId;
        return p === id;
      });
      return ids.map((n) => worldBounds(doc, n));
    });
    for (const a of trees[0]) for (const b of trees[1]) expect(boxesIntersect(a, b)).toBe(false);
    for (const a of trees[1]) for (const b of trees[2]) expect(boxesIntersect(a, b)).toBe(false);
    const column = worldBounds(doc, "topic:none:late");
    for (const t of trees) for (const b of t) expect(column.x).toBeGreaterThan(b.x + b.w);
  });

  it("keeps a column for a goal's lane at the left of its own cards", () => {
    const { doc, slots } = layoutMap(m, new Map([["goal:r", 2]]));
    const slot = slots.get("goal:r")!;
    expect(slot).toBeDefined();
    const problem = worldBounds(doc, "b1:p1");
    expect(slot.x + slot.w).toBeLessThan(problem.x);
    expect(slot.y).toBeGreaterThan(worldBounds(doc, "goal:r").y);
    // Nothing of the goal's lands in it.
    for (const id of Object.keys(doc.nodes)) expect(boxesIntersect(worldBounds(doc, id), slot)).toBe(false);
  });
});
