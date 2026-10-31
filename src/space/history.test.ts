import { describe, expect, it } from "vitest";
import { produce } from "immer";
import type { Doc } from "@/doc/schema";
import { emptyDoc } from "@/doc/schema";
import { addCardIn, makeCardNode, newCard, updateCardIn } from "@/discovery/ops";
import type { OstKind } from "@/discovery/types";
import type { SpaceThing } from "./compose";
import { addedGoals, sameCards, withGoals } from "./history";

type Row = [id: string, parent: string | null, kind: OstKind, title: string];
function canvas(rows: Row[]): Doc {
  const d = emptyDoc();
  for (const [id, parent, kind, title] of rows) {
    const n = makeCardNode(newCard(kind, { title }));
    n.id = id;
    addCardIn(d, n, parent);
  }
  return d;
}

const ROWS: Row[] = [
  ["o1", null, "outcome", "More customers reorder every week"],
  ["n1", "o1", "opportunity", "Rebuilding my usual basket takes too long"],
  ["s1", "n1", "solution", "Order again shelf"],
];
const things = (goals: string[]) => new Map<string, SpaceThing>(goals.map((g) => [g, { type: "goal", goal: g }]));

describe("a goal accepted under a goal, for the steps back", () => {
  const before = canvas(ROWS);
  // The canvas composed again: a goal with no board yet under o1, after its problem.
  const now = canvas([...ROWS, ["g-new", "o1", "outcome", "First rides to 40%"]]);

  it("is all that came in: the new goal cards, parents first", () => {
    expect(sameCards(before, now)).toBe(false);
    expect(addedGoals(before, now, { virtual: new Set(["g-new"]), things: things(["o1", "g-new"]) })).toEqual(["g-new"]);
  });

  it("isn't, when a card came in that isn't a goal with no board, or a card went or moved", () => {
    expect(addedGoals(before, now, { virtual: new Set(), things: things(["o1", "g-new"]) })).toBeNull();
    const moved = produce(now, (d) => {
      d.nodes.o1.children = d.nodes.o1.children.filter((c) => c !== "n1");
      d.roots.push("n1");
      d.nodes.n1.parentId = null;
    });
    expect(addedGoals(before, moved, { virtual: new Set(["g-new"]), things: things(["o1", "g-new"]) })).toBeNull();
    const gone = produce(now, (d) => {
      d.nodes.n1.children = [];
      delete d.nodes.s1;
    });
    expect(addedGoals(before, gone, { virtual: new Set(["g-new"]), things: things(["o1", "g-new"]) })).toBeNull();
  });

  it("goes into a step back where it hangs now, after the sibling it follows, with the cards' words as they are now", () => {
    // A step back from before a reword: the goal goes in, and the reword reaches it (content from elsewhere).
    const step = produce(before, (d) => updateCardIn(d, "s1", (c) => void (c.title = "An older title")));
    const renamed = produce(now, (d) => updateCardIn(d, "s1", (c) => void (c.title = "Order again shelf on the home screen")));
    const back = withGoals(step, renamed, ["g-new"]);
    expect(back.nodes.o1.children).toEqual(["n1", "g-new"]);
    expect(back.nodes["g-new"].parentId).toBe("o1");
    expect(back.nodes.s1.meta.ost?.title).toBe("Order again shelf on the home screen");
    // The step itself is left as it was.
    expect(step.nodes["g-new"]).toBeUndefined();
  });

  it("keeps a step back's own words where nothing changed them elsewhere, so an edit made here still undoes", () => {
    const step = produce(before, (d) => updateCardIn(d, "s1", (c) => void (c.title = "The title before the edit")));
    // Edited here and saved: the canvas as last saved has it, and so do the boards it's composed from.
    const saved = produce(before, (d) => updateCardIn(d, "s1", (c) => void (c.title = "Edited here")));
    const composed = produce(now, (d) => updateCardIn(d, "s1", (c) => void (c.title = "Edited here")));
    expect(withGoals(step, composed, ["g-new"], saved).nodes.s1.meta.ost?.title).toBe("The title before the edit");
    // Changed elsewhere since: that reaches the step.
    const elsewhere = produce(now, (d) => updateCardIn(d, "s1", (c) => void (c.title = "Renamed in another window")));
    expect(withGoals(step, elsewhere, ["g-new"], saved).nodes.s1.meta.ost?.title).toBe("Renamed in another window");
  });

  it("leaves a step back alone when the goal's parent isn't in it", () => {
    const empty = emptyDoc();
    expect(withGoals(empty, now, ["g-new"]).nodes["g-new"]).toBeUndefined();
  });
});
