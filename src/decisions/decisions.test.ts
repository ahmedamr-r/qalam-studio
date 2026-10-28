import { describe, expect, it } from "vitest";
import { produce } from "immer";
import type { Doc } from "@/doc/schema";
import type { OstCard } from "@/discovery/types";
import { decisionsFromDiff, reverses, type DiffContext } from "./diff";
import { appendEntries, decisionsFromMarkdown, decisionToMarkdown, replaceEntry } from "./format";
import type { Decision } from "./model";

let seq = 0;
const ctx = (over: Partial<DiffContext> = {}): DiffContext => ({ board: "b1", boardName: "Reorders", product: "pGrocery", now: Date.UTC(2026, 9, 27, 12), newId: () => `d${++seq}`, ...over });

const card = (kind: OstCard["kind"], title: string, stage: OstCard["stage"], extra: Partial<OstCard> = {}): OstCard => ({ v: 1, kind, title, stage, createdBy: "user", evidence: [], ...extra });
const quote = (id: string, text: string) => ({ id, kind: "quote" as const, text, sourceId: "s1", sourceTitle: "Sara interview", span: [0, text.length] as [number, number], piece: `hub:quote:q-${id}`, addedBy: "ai" as const, at: 1 });

function board(): Doc {
  const node = (id: string, parentId: string | null, ost: OstCard) => ({ id, type: "frame", name: ost.title, parentId, children: [] as string[], meta: { ost } });
  const nodes: Record<string, unknown> = {
    o1: node("o1", null, card("outcome", "More weekly reorders", "active", { metric: { name: "Reorders per customer", unit: "orders", direction: "increase", baseline: 1.2, current: 1.3, target: 1.5 } })),
    n1: node("n1", "o1", card("opportunity", "Can't find past orders", "target", { evidence: [quote("e1", "I can never find what I ordered")] })),
    n2: node("n2", "o1", card("opportunity", "Rebuilding the basket takes long", "exploring", { evidence: [quote("e2", "It takes me twenty minutes")] })),
    s1: node("s1", "n1", card("solution", "Order again shelf", "idea")),
    s2: node("s2", "n1", card("solution", "Saved baskets", "idea", { evidence: [quote("e3", "I save my list in notes")] })),
    t1: node("t1", "s1", card("test", "Fake-door shelf", "planned")),
    n3: node("n3", "o1", card("opportunity", "Evening slots are full", "exploring")),
  };
  return { roots: ["o1"], nodes } as unknown as Doc;
}

const ost = (d: Doc, id: string) => (d.nodes[id] as unknown as { meta: { ost: OstCard } }).meta.ost;
const edit = (fn: (d: Doc) => void) => produce(board(), fn);

describe("decisions from a change to a board", () => {
  it("records a new target as one decision, with the target it replaced", () => {
    const next = edit((d) => {
      ost(d, "n1").stage = "exploring";
      ost(d, "n2").stage = "target";
    });
    const [d, ...rest] = decisionsFromDiff(board(), next, ctx());
    expect(rest).toEqual([]);
    expect(d).toMatchObject({ kind: "target", card: "n2", what: "Made “Rebuilding the basket takes long” the target, instead of “Can't find past orders”", big: true, by: "you", product: "pGrocery" });
    expect(d.knew).toMatchObject({ evidence: "1 quote", pieces: [{ text: "It takes me twenty minutes", from: "Sara interview", ref: "hub:quote:q-e2" }], against: 0 });
  });

  it("asks why when a solution is dropped or an opportunity with evidence is parked, not for progress", () => {
    const next = edit((d) => {
      ost(d, "s2").stage = "dropped";
      ost(d, "n2").stage = "parked";
      ost(d, "n3").stage = "parked";
      ost(d, "s1").stage = "testing";
      ost(d, "t1").stage = "failed";
    });
    const list = decisionsFromDiff(board(), next, ctx());
    expect(list.map((d) => [d.what, d.big])).toEqual([
      ["Parked “Rebuilding the basket takes long”", true],
      ["Started testing “Order again shelf”", false],
      ["Dropped the solution “Saved baskets”", true],
      ["The test “Fake-door shelf” failed", false],
      ["Parked “Evening slots are full”", false],
    ]);
  });

  it("records deleting a branch once, at its top, with what it rested on", () => {
    const next = edit((d) => {
      for (const id of ["n1", "s1", "s2", "t1"]) delete d.nodes[id];
    });
    const list = decisionsFromDiff(board(), next, ctx());
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "drop", card: "n1", what: "Deleted “Can't find past orders” and 3 cards under it", big: true, detail: { parent: "o1", under: 3 } });
    expect(list[0].knew).toMatchObject({ evidence: "1 quote", children: 2, tests: [{ title: "Fake-door shelf", stage: "Planned" }] });
  });

  it("tells a merge from a deletion: the evidence or children went to another card", () => {
    const next = edit((d) => {
      ost(d, "n1").evidence.push(ost(d, "n2").evidence[0]);
      delete d.nodes.n2;
    });
    expect(decisionsFromDiff(board(), next, ctx())).toMatchObject([{ kind: "merge", card: "n2", what: "Merged “Rebuilding the basket takes long” into “Can't find past orders”", detail: { into: "n1" }, big: false }]);
  });

  it("records a move, and no move for children that follow a merged card", () => {
    const moved = edit((d) => void ((d.nodes.s1 as unknown as { parentId: string }).parentId = "n3"));
    expect(decisionsFromDiff(board(), moved, ctx())).toMatchObject([{ kind: "move", card: "s1", what: "Moved “Order again shelf” under “Evening slots are full”", detail: { from: "n1", to: "n3" } }]);
    const merged = edit((d) => {
      for (const id of ["s1", "s2"]) (d.nodes[id] as unknown as { parentId: string }).parentId = "n2";
      delete d.nodes.n1;
    });
    expect(decisionsFromDiff(board(), merged, ctx()).map((d) => d.kind)).toEqual(["merge"]);
  });

  it("records an outcome's new target (big) and where it is now (not big)", () => {
    const next = edit((d) => {
      ost(d, "o1").metric!.target = 1.8;
      ost(d, "o1").metric!.current = 1.4;
    });
    expect(decisionsFromDiff(board(), next, ctx()).map((d) => [d.what, d.big])).toEqual([
      ["Changed the target of “More weekly reorders” from 1.5 orders to 1.8 orders", true],
      ["“More weekly reorders” is at 1.4 orders now (was 1.3 orders)", false],
    ]);
  });

  it("records no decision when the number is read from an analytics tool, and still records a target change", () => {
    const read = edit((d) => {
      const m = ost(d, "o1").metric!;
      m.current = 1.42;
      m.source = { connector: "posthog", ref: "7mlKKF3J", label: "Weekly reorders" };
      m.readAt = Date.UTC(2026, 9, 28);
    });
    expect(decisionsFromDiff(board(), read, ctx())).toEqual([]);
    const both = produce(read, (d) => {
      ost(d, "o1").metric!.target = 1.6;
    });
    expect(decisionsFromDiff(read, both, ctx()).map((d) => d.what)).toEqual(["Changed the target of “More weekly reorders” from 1.5 orders to 1.6 orders"]);
  });

  it("finds nothing in adding or rewording cards", () => {
    const next = edit((d) => {
      ost(d, "n3").title = "Evening delivery slots are full";
      d.nodes.n4 = { id: "n4", type: "frame", name: "New", parentId: "o1", children: [], meta: { ost: card("opportunity", "New", "exploring") } } as never;
    });
    expect(decisionsFromDiff(board(), next, ctx())).toEqual([]);
  });

  it("knows an undo: the same card back where it was", () => {
    const next = edit((d) => void (ost(d, "s2").stage = "dropped"));
    const [dropped] = decisionsFromDiff(board(), next, ctx());
    const [back] = decisionsFromDiff(next, board(), ctx());
    expect(reverses(back, dropped)).toBe(true);
    expect(reverses(dropped, dropped)).toBe(false);
  });
});

describe("the decision log's Markdown", () => {
  const d: Decision = {
    id: "d1",
    at: new Date(2026, 9, 27, 15).getTime(),
    kind: "stage",
    board: "b1",
    boardName: "Reorders",
    product: null,
    card: "s2",
    cardTitle: "Saved baskets",
    cardKind: "solution",
    what: "Dropped the solution “Saved baskets”",
    detail: { from: "idea", to: "dropped" },
    by: "you",
    big: true,
    knew: { evidence: "1 quote · 1 against", pieces: [{ text: "I save my list in notes", from: "Sara interview", ref: "hub:quote:q1" }], against: 1, tests: [{ title: "Fake door", stage: "Failed" }] },
  };

  it("reads as an entry and parses back exactly", () => {
    const md = decisionToMarkdown({ ...d, why: "Folded into the order-again shelf." });
    expect(md.split("\n").slice(0, 2)).toEqual(["## 2026-10-27 · Dropped the solution “Saved baskets” · Reorders", expect.stringMatching(/^<!-- qalam:decision \{.*\} -->$/)]);
    expect(md).toContain("**Why:** Folded into the order-again shelf.");
    expect(md).toContain("**What we knew then:** 1 quote · 1 against · 1 test (Failed)\n- “I save my list in notes” · Sara interview");
    expect(decisionsFromMarkdown(md)).toEqual([{ ...d, why: "Folded into the order-again shelf." }]);
    expect(decisionsFromMarkdown(decisionToMarkdown(d))).toEqual([d]);
  });

  it("reads a why written in the file by hand", () => {
    const md = decisionToMarkdown(d).replace("**Why:** —", "**Why:** Nobody saved a basket in the test.");
    expect(decisionsFromMarkdown(md)[0].why).toBe("Nobody saved a basket in the test.");
  });

  it("appends to a month file and rewrites one entry, leaving the rest", () => {
    const second = { ...d, id: "d2", what: "Made “X” the target", kind: "target" as const };
    let md = appendEntries(null, "2026-10", [d]);
    expect(md.startsWith("# Decisions · October 2026\n")).toBe(true);
    md = appendEntries(md, "2026-10", [second]);
    expect(decisionsFromMarkdown(md).map((x) => x.id)).toEqual(["d1", "d2"]);
    const edited = replaceEntry(md, { ...d, why: "Changed our mind", undone: true })!;
    expect(decisionsFromMarkdown(edited)).toEqual([{ ...d, why: "Changed our mind", undone: true }, second]);
    expect(edited).toContain("## 2026-10-27 · Dropped the solution “Saved baskets” (undone) · Reorders");
    expect(edited.split(decisionToMarkdown(second).trim()).length).toBe(2);
    expect(replaceEntry(md, { ...d, id: "nope" })).toBeNull();
  });

  it("reads an entry Git kept twice once, keeping a why from either copy", () => {
    const md = appendEntries(appendEntries(null, "2026-10", [{ ...d, why: "Ours" }]), "2026-10", [{ ...d, undone: true }]);
    expect(decisionsFromMarkdown(md)).toEqual([{ ...d, undone: true, why: "Ours" }]);
  });

  it("keeps a quote's \"-->\" from ending the comment, and skips entries it can't trust", () => {
    const tricky = { ...d, knew: { ...d.knew!, pieces: [{ text: "a --> b", from: "Sara" }] } };
    const md = decisionToMarkdown(tricky);
    expect(md.split("\n")[1].match(/-->/g)).toHaveLength(1);
    expect(decisionsFromMarkdown(md)[0].knew?.pieces[0].text).toBe("a --> b");
    const broken = md.replace(/"id":"d1"/, '"id":"../../x"') + decisionToMarkdown({ ...d, id: "d2" }).replace(/"kind":"stage"/, '"kind":"nonsense"');
    expect(decisionsFromMarkdown(broken)).toEqual([]);
  });
});
