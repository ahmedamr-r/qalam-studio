import { describe, expect, it } from "vitest";
import { produce } from "immer";
import type { Doc } from "@/doc/schema";
import { emptyDoc } from "@/doc/schema";
import { addCardIn, makeCardNode, newCard } from "@/discovery/ops";
import type { OstKind } from "@/discovery/types";
import type { Bearing } from "@/goals/bearings";
import { ordered } from "@/goals/tree";
import type { Goal, GoalTree } from "@/goals/types";
import type { Notice } from "@/hub/checks";
import type { RankedNeed } from "@/hub/needs";
import { keepOtherBoards } from "./arrange";
import { assignBoards, type Known } from "./assign";
import { composeSpace, type SpaceBoard, type SpaceDoc } from "./compose";
import { layoutSpace } from "./layout";
import { boardsInSpace } from "./members";
import { splitSpace } from "./split";

const goal = (id: string, o: Partial<Goal> = {}): Goal => ({ id, title: `Goal ${id}`, parent: null, product: null, status: "active", cites: [], by: "person", at: 1, ...o });
const tree: GoalTree = ordered({
  north: "ns",
  goals: [
    goal("ns", { title: "2M dirhams a month in orders" }),
    goal("r", { title: "More customers reorder every week", parent: "ns", product: "grocery", on: { board: "b1", card: "o1" } }),
    goal("s", { title: "More first orders become second orders", parent: "r", product: "grocery", on: { board: "b1", card: "o2" } }),
    goal("o", { title: "Offices reorder on a schedule", product: "business" }),
    goal("w", { title: "Win back lapsed customers", parent: "r", product: "grocery", on: { board: "b3", card: "o3" } }),
  ],
});

type Row = [id: string, parent: string | null, kind: OstKind, title: string];
function boardDoc(rows: Row[], extra: (d: Doc) => void = () => {}): Doc {
  const d = emptyDoc();
  for (const [id, parent, kind, title] of rows) {
    const n = makeCardNode(newCard(kind, { title }));
    n.id = id;
    addCardIn(d, n, parent);
  }
  extra(d);
  return d;
}
const b1: SpaceBoard = {
  id: "b1",
  name: "Reorders",
  product: "grocery",
  doc: boardDoc([
    ["o1", null, "outcome", "Reorders (the board's old words)"],
    ["p1", "o1", "opportunity", "Rebuilding my basket takes too long"],
    ["x1", "p1", "solution", "Copy last week's basket"],
    ["t1", "x1", "test", "Fake-door button"],
    ["o2", "o1", "outcome", "Second orders"],
    ["p2", "o2", "opportunity", "Delivery slots run out"],
  ]),
};
const b2: SpaceBoard = { id: "b2", name: "Pantry ideas", product: "grocery", doc: boardDoc([["q1", null, "opportunity", "We run out of staples"], ["y1", "q1", "solution", "A pantry list"]]) };
const b3: SpaceBoard = { id: "b3", name: "Win-back", product: "grocery", doc: boardDoc([["o3", null, "outcome", "Win back"], ["p3", "o3", "opportunity", "I forgot the app existed"]]) };
const need = (topic: string, title: string, o: Partial<RankedNeed> = {}): RankedNeed => ({ topic, title, products: ["grocery"], quotes: 4, sources: 2, against: 0, online: 0, onlineSources: 0, segments: [], weeks: [], boards: [], newest: 1, ...o });
const needs = [need("fees", "Surprise fees put me off"), need("basket", "Rebuilding my basket", { boards: [{ board: "b1", card: "p1", kind: "opportunity", shared: 3 }] }), need("late", "Orders arrive late")];
const links = [{ need: "fees", goal: "r", bears: "direct", how: "", cites: [], by: "qalam", at: 1 } as Bearing];
const products = [
  { id: "grocery", name: "Grocery app" },
  { id: "business", name: "For business" },
];

const kids = (s: { doc: Doc }, id: string) => s.doc.nodes[id].children;
const known = (s: SpaceDoc): Known => ({ boardOf: s.boardOf, anchors: new Set([...s.things].flatMap(([id, t]) => (t.type === "goal" && t.board ? [id] : []))), virtual: new Set([...s.virtual].filter((id) => !id.startsWith("topic:"))) });

/** A space opened, edited with `edit`, and split back into its boards. */
function edit(boards: SpaceBoard[], fn: (d: Doc) => void, space: string | null = null) {
  const s = composeSpace({ tree, boards, space, links, needs, products });
  const k = known(s);
  const now = produce(s.doc, fn);
  const before = assignBoards(s.doc, k);
  const after = assignBoards(now, k);
  const stored = new Map(boards.map((b) => [b.id, b.doc!]));
  return { s, now, ...splitSpace({ base: s.doc, now, before, after, stored, anchors: k.anchors, virtual: k.virtual }) };
}
const titlesOn = (d: Doc, id: string | null) => (id ? d.nodes[id].children : d.roots).map((c) => d.nodes[c].meta.ost?.title);

describe("a space's canvas", () => {
  const s = composeSpace({ tree, boards: [b1, b2, b3], space: null, links, needs, products, notices: [{ key: "k", board: "b1", card: "p1" } as Notice] });

  it("keeps the boards' own ids, each goal under the goal it feeds, in goals.md's words", () => {
    expect(s.doc.roots[0]).toBe("ns");
    expect(s.doc.nodes.o1.parentId).toBe("ns");
    expect(s.doc.nodes.o1.meta.ost!.title).toBe("More customers reorder every week");
    expect(kids(s, "o1")).toEqual(["p1", "topic:r:fees", "o2", "o3"]);
    expect(s.doc.nodes.o2.parentId).toBe("o1");
    expect(s.doc.nodes.o3.parentId).toBe("o1");
    expect(kids(s, "x1")).toEqual(["t1"]);
  });

  it("knows each card's board, and what's on none", () => {
    expect(s.boardOf.get("p2")).toBe("b1");
    expect(s.boardOf.get("o3")).toBe("b3");
    expect(s.virtual).toEqual(new Set(["ns", "o", "topic:r:fees", "topic:none:late"]));
    expect(s.tags.get("ns")?.label).toBe("No board yet");
    expect(s.tags.get("o1")?.label).toBe("Grocery app");
    expect(s.faint.has("topic:r:fees")).toBe(true);
    expect(s.noticed.has("p1")).toBe(true);
  });

  it("puts the boards no goal has on their own, and what no goal covers in a column", () => {
    expect(s.doc.roots).toEqual(["ns", "o", "q1", "topic:none:late"]);
    const laid = layoutSpace(s.doc, { column: (id) => id.startsWith("topic:none:") });
    expect(laid.doc.nodes["topic:none:late"].x).toBeGreaterThan(laid.doc.nodes.q1.x);
  });

  it("shows a product's goals and boards, with a goal's board from elsewhere in part", () => {
    const g = composeSpace({ tree, boards: [b1, b2, b3], space: "business", links, needs, products });
    expect(g.doc.roots).toEqual(["o"]);
    expect(boardsInSpace([{ id: "b1", type: "discovery", product: "grocery" }, { id: "b9", type: "discovery", product: null }, { id: "z", type: "screens", product: "business" }], [goal("x", { product: "business", on: { board: "b9", card: "c" } })], "business")).toEqual(["b9"]);
  });

  it("gives a copy's cards ids of their own, once", () => {
    const copy: SpaceBoard = { ...b2, id: "b4", name: "Pantry (copy)" };
    const c = composeSpace({ tree, boards: [b1, b2, copy], space: null }, (() => {
      let n = 0;
      return () => `n${++n}`;
    })());
    expect(c.fixes.get("b4")?.ids).toEqual(new Map([["q1", "n1"], ["y1", "n2"]]));
    expect(c.boardOf.get("n1")).toBe("b4");
    expect(c.boardOf.get("q1")).toBe("b2");
  });
});

describe("saving the canvas to its boards", () => {
  it("writes nothing when nothing changed", () => {
    const r = edit([b1, b2, b3], () => {});
    expect(r.writes.size).toBe(0);
    expect(r.create).toEqual([]);
  });

  it("writes nothing for where cards sit or what's folded away from view", () => {
    const r = edit([b1, b2, b3], (d) => {
      d.nodes.p1.x += 400;
      d.nodes.x1.visible = false;
    });
    expect(r.writes.size).toBe(0);
  });

  it("writes one board for a card's new words, and only that card", () => {
    const r = edit([b1, b2, b3], (d) => {
      d.nodes.x1.meta.ost!.title = "Reorder in one tap";
    });
    expect([...r.writes.keys()]).toEqual(["b1"]);
    const w = r.writes.get("b1")!;
    expect(w.nodes.x1.meta.ost!.title).toBe("Reorder in one tap");
    // The goal's card keeps its place and its board's words: only goals.md says otherwise.
    expect(w.nodes.o1.meta.ost!.title).toBe("Reorders (the board's old words)");
    expect(w.nodes.o2.parentId).toBe("o1");
    expect(w.roots).toEqual(["o1"]);
  });

  it("moves a card to another tree's board, with what hangs under it, both boards in one save", () => {
    const r = edit([b1, b2, b3], (d) => {
      d.nodes.p1.children = d.nodes.p1.children.filter((c) => c !== "x1");
      d.nodes.p3.children.push("x1");
      d.nodes.x1.parentId = "p3";
    });
    expect([...r.writes.keys()].sort()).toEqual(["b1", "b3"]);
    expect(r.writes.get("b1")!.nodes.x1).toBeUndefined();
    expect(r.writes.get("b1")!.nodes.t1).toBeUndefined();
    expect(r.writes.get("b1")!.nodes.p1.children).toEqual([]);
    expect(titlesOn(r.writes.get("b3")!, "p3")).toEqual(["Copy last week's basket"]);
    expect(titlesOn(r.writes.get("b3")!, "x1")).toEqual(["Fake-door button"]);
  });

  it("starts a goal's board when something goes under a goal with none, its card the goal's", () => {
    const r = edit([b1, b2, b3], (d) => {
      const n = makeCardNode(newCard("opportunity", { title: "Invoices go to the wrong person" }));
      n.id = "new1";
      addCardIn(d, n, "o");
    });
    expect(r.writes.size).toBe(0);
    expect(r.create).toHaveLength(1);
    expect(r.create[0]).toMatchObject({ key: "new:o", goal: "o" });
    expect(r.create[0].doc.roots).toEqual(["o"]);
    expect(r.create[0].doc.nodes.o.meta.ost!.title).toBe("Offices reorder on a schedule");
    expect(titlesOn(r.create[0].doc, "o")).toEqual(["Invoices go to the wrong person"]);
  });

  it("starts a board for a new card at the top, and none for a goal's words alone", () => {
    const r = edit([b1, b2, b3], (d) => {
      const n = makeCardNode(newCard("opportunity", { title: "Riders can't find the driver" }));
      n.id = "new2";
      addCardIn(d, n, null);
      d.nodes.o.meta.ost!.title = "Offices reorder by themselves";
    });
    expect(r.create.map((c) => [c.key, c.goal, c.doc.roots])).toEqual([["new:new2", null, ["new2"]]]);
  });

  it("puts a card dragged to the top back at the top of its own board", () => {
    const r = edit([b1, b2, b3], (d) => {
      d.nodes.p1.children = [];
      d.nodes.x1.parentId = null;
      d.roots.push("x1");
    });
    expect([...r.writes.keys()]).toEqual(["b1"]);
    expect(r.writes.get("b1")!.roots).toEqual(["o1", "x1"]);
    expect(r.writes.get("b1")!.nodes.x1.children).toEqual(["t1"]);
  });

  it("deletes a card from its board, keeping what the canvas doesn't show under it", () => {
    const withNote: SpaceBoard = {
      ...b2,
      doc: boardDoc([["q1", null, "opportunity", "We run out of staples"], ["y1", "q1", "solution", "A pantry list"], ["y2", "y1", "test", "Not on this space"]], (d) => {
        d.nodes.y2.meta.ost!.kind = "test";
      }),
    };
    // The test under it isn't on the canvas: another space's view of the board, say.
    const s = composeSpace({ tree, boards: [b1, withNote, b3], space: null });
    const base = produce(s.doc, (d) => {
      delete d.nodes.y2;
      d.nodes.y1.children = [];
    });
    const k = known(s);
    const now = produce(base, (d) => {
      delete d.nodes.y1;
      d.nodes.q1.children = [];
    });
    const r = splitSpace({ base, now, before: assignBoards(base, k), after: assignBoards(now, k), stored: new Map([["b2", withNote.doc!]]), anchors: k.anchors, virtual: k.virtual });
    expect(r.writes.get("b2")!.nodes.y1).toBeUndefined();
    expect(r.writes.get("b2")!.nodes.q1.children).toEqual(["y2"]);
  });

  it("orders cards among their neighbours as the canvas does", () => {
    const r = edit([b1, b2, b3], (d) => {
      const n = makeCardNode(newCard("solution", { title: "Second idea" }));
      n.id = "x2";
      addCardIn(d, n, "p1", 0);
    });
    expect(titlesOn(r.writes.get("b1")!, "p1")).toEqual(["Second idea", "Copy last week's basket"]);
  });

  it("writes both boards back when a move is undone", () => {
    const s = composeSpace({ tree, boards: [b1, b2, b3], space: null });
    const k = known(s);
    const moved = produce(s.doc, (d) => {
      d.nodes.p1.children = [];
      d.nodes.p3.children.push("x1");
      d.nodes.x1.parentId = "p3";
    });
    const first = splitSpace({ base: s.doc, now: moved, before: assignBoards(s.doc, k), after: assignBoards(moved, k), stored: new Map([b1, b2, b3].map((b) => [b.id, b.doc!])), anchors: k.anchors, virtual: k.virtual });
    const stored = new Map([b1, b2, b3].map((b) => [b.id, first.writes.get(b.id) ?? b.doc!]));
    const after = assignBoards(moved, k);
    const k2 = { ...k, boardOf: after };
    const back = splitSpace({ base: moved, now: s.doc, before: after, after: assignBoards(s.doc, k2), stored, anchors: k.anchors, virtual: k.virtual });
    expect([...back.writes.keys()].sort()).toEqual(["b1", "b3"]);
    expect(titlesOn(back.writes.get("b1")!, "p1")).toEqual(["Copy last week's basket"]);
    expect(back.writes.get("b3")!.nodes.x1).toBeUndefined();
  });
});

describe("deleting on the canvas", () => {
  it("keeps the goals under a deleted goal's card that have boards of their own", () => {
    const s = composeSpace({ tree, boards: [b1, b2, b3], space: null });
    // The goal r's card goes, with everything under it.
    const next = produce(s.doc, (d) => {
      const drop = (id: string) => {
        d.nodes[id].children.forEach(drop);
        delete d.nodes[id];
      };
      drop("o1");
      d.nodes.ns.children = [];
    });
    const kept = keepOtherBoards(s.doc, next, (id) => s.boardOf.get(id));
    expect(kept.nodes.ns.children).toEqual(["o3"]);
    expect(kept.nodes.o3.children).toEqual(["p3"]);
    // Its own board's cards go with it (o2 is on b1 too).
    expect(kept.nodes.o2).toBeUndefined();
    expect(kept.nodes.p1).toBeUndefined();
  });

  it("changes nothing when a card of the same board goes", () => {
    const s = composeSpace({ tree, boards: [b1, b2, b3], space: null });
    const next = produce(s.doc, (d) => {
      delete d.nodes.t1;
      d.nodes.x1.children = [];
    });
    expect(keepOtherBoards(s.doc, next, (id) => s.boardOf.get(id))).toBe(next);
  });
});

describe("the canvas's order", () => {
  it("keeps a goal's own cards before the goals under it, as it was composed", async () => {
    const { goalsLast } = await import("./layout");
    const s = composeSpace({ tree, boards: [b1, b2, b3], space: null, links, needs, products });
    const added = produce(s.doc, (d) => {
      const n = makeCardNode(newCard("opportunity", { title: "New" }));
      n.id = "n1";
      addCardIn(d, n, "o1");
    });
    expect(added.nodes.o1.children).toEqual(["p1", "topic:r:fees", "o2", "o3", "n1"]);
    const goals = new Set([...s.things].flatMap(([id, t]) => (t.type === "goal" ? [id] : [])));
    expect(goalsLast(added, (id) => goals.has(id)).nodes.o1.children).toEqual(["p1", "n1", "topic:r:fees", "o2", "o3"]);
    expect(goalsLast(s.doc, (id) => goals.has(id))).toBe(s.doc);
  });
});

describe("composed as the map was", () => {
  const m = composeSpace({ tree, boards: [b1, b2], space: null, links, needs, products });

  it("names a no-goal board's tree by its board, and says no goal covers what's in the column", () => {
    expect(m.tags.get("q1")?.label).toBe("Pantry ideas");
    expect(m.things.get("y1")).toEqual({ type: "card", board: "b2", goal: null });
    expect(m.tags.get("topic:none:late")?.label).toBe("No goal yet");
  });

  it("gives each goal its own cards for its lane, not its sub-goals'", () => {
    expect(m.groups.find((g) => g.head === "o1")?.cards).toEqual(["o1", "p1", "x1", "t1", "topic:r:fees"]);
    expect(m.groups.find((g) => g.head === "o2")?.cards).toEqual(["o2", "p2"]);
  });

  it("marks what needs a look on its card, a goal or a page", () => {
    const notices = [{ board: "b1", card: "x1" }, { goal: "o" }, { topic: "fees" }, { board: "b1", card: "o2" }] as Notice[];
    const n = composeSpace({ tree, boards: [b1, b2], space: null, links, needs, notices });
    expect([...n.noticed].sort()).toEqual(["o", "o2", "topic:r:fees", "x1"]);
  });

  it("shows only a product's goals in its space, those whose goal is elsewhere at the top", () => {
    const g = composeSpace({ tree, boards: [b1, b2], space: "grocery", links, needs });
    expect(g.doc.roots).toEqual(["o1", "q1", "topic:none:late"]);
    expect(g.doc.nodes.ns).toBeUndefined();
    expect(g.tags.get("o1")).toBeUndefined();
  });

  it("lays the trees side by side, none over another, the column on the right, and a goal's lane at the left of its own cards", async () => {
    const { boxesIntersect, worldBounds } = await import("@/doc/geometry");
    const { doc, slots } = layoutSpace(m.doc, { column: (id) => id.startsWith("topic:none:"), isGoal: (id) => m.things.get(id)?.type === "goal", lanes: new Map([["o1", 2]]) });
    const treeOf = (root: string) =>
      Object.keys(doc.nodes)
        .filter((n) => {
          let p: string | null = n;
          while (doc.nodes[p!]?.parentId) p = doc.nodes[p!].parentId;
          return p === root;
        })
        .map((n) => worldBounds(doc, n));
    const [a, b, c] = ["ns", "o", "q1"].map(treeOf);
    for (const x of a) for (const y of b) expect(boxesIntersect(x, y)).toBe(false);
    for (const x of b) for (const y of c) expect(boxesIntersect(x, y)).toBe(false);
    const column = worldBounds(doc, "topic:none:late");
    for (const t of [a, b, c]) for (const x of t) expect(column.x).toBeGreaterThan(x.x + x.w);
    const slot = slots.get("o1")!;
    expect(slot.x + slot.w).toBeLessThan(worldBounds(doc, "p1").x);
    for (const id of Object.keys(doc.nodes)) expect(boxesIntersect(worldBounds(doc, id), slot)).toBe(false);
  });
});
