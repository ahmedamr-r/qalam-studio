import { describe, expect, it } from "vitest";
import type { Decision } from "@/decisions/model";
import type { Doc } from "@/doc/schema";
import type { OstCard, OstEvidence } from "@/discovery/types";
import { noticeShape, pairKey, runChecks, type CheckBoard, type CheckInput } from "./checks";
import type { Topic } from "./topics";

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 28, 12).getTime();
const ago = (days: number) => NOW - days * DAY;

type CardIn = Partial<OstCard> & { id: string; kind: OstCard["kind"]; title: string; children?: CardIn[] };

function board(id: string, name: string, tree: CardIn, product: string | null = "grocery"): CheckBoard {
  const nodes: Record<string, unknown> = {};
  const add = (c: CardIn, parentId: string | null) => {
    const { id: cid, children = [], ...rest } = c;
    const ost: OstCard = { v: 1, stage: "exploring", createdBy: "user", evidence: [], ...rest } as OstCard;
    nodes[cid] = { id: cid, type: "frame", name: c.title, parentId, children: children.map((x) => x.id), x: 0, y: 0, w: 240, h: 80, meta: { ost } };
    for (const k of children) add(k, cid);
  };
  add(tree, null);
  return { id, name, product, createdAt: ago(60), doc: { roots: [tree.id], nodes } as unknown as Doc };
}

const quote = (id: string, at: number, stance?: "against"): OstEvidence => ({ id, kind: "quote", text: `Words of ${id}`, piece: `hub:quote:${id}`, addedBy: "ai", at, ...(stance ? { stance } : {}) });

const input = (over: Partial<CheckInput> = {}): CheckInput => ({ now: NOW, boards: [], decisions: [], topics: [], indexed: true, shows: new Map(), pieces: new Map(), linked: new Set(), ...over });

const topic = (over: Partial<Topic>): Topic => ({ id: "tp1", kind: "need", title: "Surprise fees put me off", products: ["grocery"], createdAt: ago(5), updatedAt: ago(2), lines: [], history: [], ...over });

describe("what needs a look", () => {
  it("brings up what Qalam AI found against a line, not what people wrote themselves", () => {
    const t = topic({
      lines: [
        {
          id: "l1",
          section: "believe",
          text: "Parents are happy with any substitute.",
          by: "person",
          cites: [],
          from: [],
          at: 0,
          disputes: [
            { id: "d1", text: "Yasmin sent a swap back.", by: "qalam", cites: ["hub:quote:y1"], from: ["Yasmin interview"], at: ago(1) },
            { id: "d2", text: "Our own doubt.", by: "person", cites: [], from: [], at: ago(1) },
          ],
        },
      ],
    });
    const n = runChecks(input({ topics: [t] }));
    expect(n).toEqual([
      { key: "disputed:tp1:l1:d1", kind: "disputed", title: "Something speaks against “Parents are happy with any substitute”", why: "Yasmin sent a swap back. (Yasmin interview)", at: ago(1), topic: "tp1", refs: ["hub:quote:y1"], products: ["grocery"] },
    ]);
  });

  it("finds a need customers keep raising that no board has, keyed by how strong it is", () => {
    const line = (id: string, cites: string[]) => ({ id, section: "know" as const, text: id, by: "qalam" as const, cites, from: [], at: ago(3) });
    const t = topic({ lines: [line("l1", ["hub:quote:a", "hub:quote:b"]), line("l2", ["hub:quote:c", "hub:quote:team"])] });
    const pieces = new Map([
      ["hub:quote:a", { type: "quote", sub: "pain", source: "s1", stage: null, at: ago(10) }],
      ["hub:quote:b", { type: "quote", sub: "pain", source: "s1", stage: null, at: ago(9) }],
      ["hub:quote:c", { type: "quote", sub: "desire", source: "s2", stage: null, at: ago(4) }],
      // The team's words don't count as customers raising it.
      ["hub:quote:team", { type: "quote", sub: "dump:idea", source: "s3", stage: null, at: ago(1) }],
    ]);
    const [n] = runChecks(input({ topics: [t], pieces }));
    expect(n).toMatchObject({ key: "pattern:tp1:2", kind: "pattern", why: "3 quotes from 2 sources on its topic page; no card on a board rests on them.", at: ago(3) });
    // On a board: nothing to say. Not indexed here: the check waits.
    expect(runChecks(input({ topics: [t], pieces, shows: new Map([["tp1", [{ ref: "hub:card:b1:n1", board: "b1", card: "n1", kind: "opportunity", shared: 1 }]]]) }))).toEqual([]);
    expect(runChecks(input({ topics: [t], pieces, indexed: false }))).toEqual([]);
  });

  it("counts the people who raise a need, not the sources: two people in one survey are two voices", () => {
    const line = { id: "l1", section: "know" as const, text: "l1", by: "qalam" as const, cites: ["hub:quote:a", "hub:quote:b", "hub:quote:c"], from: [], at: ago(3) };
    const t = topic({ lines: [line] });
    const pieces = new Map(["a", "b", "c"].map((id) => [`hub:quote:${id}`, { type: "quote", sub: "pain", source: "s1", stage: null, at: ago(5) }]));
    // One source, no one named: not yet a pattern.
    expect(runChecks(input({ topics: [t], pieces }))).toEqual([]);
    const voice = (key: string, name: string, segments: string[]) => ({ key, name, segments, source: "s1", at: ago(5) });
    const voices = new Map([
      ["hub:quote:a", voice("person:p1", "Sara", ["Parents"])],
      ["hub:quote:b", voice("person:p1", "Sara", ["Parents"])],
      ["hub:quote:c", voice("source:s1:s3", "S3", ["Offices"])],
    ]);
    const [n] = runChecks(input({ topics: [t], pieces, voices }));
    expect(n).toMatchObject({ key: "pattern:tp1:2", kind: "pattern", why: "3 quotes from 2 voices in 2 segments (1 source) on its topic page; no card on a board rests on them." });
  });

  it("finds the same need on two boards, unless the team linked them", () => {
    const a = board("b1", "Weekly reorders", { id: "o1", kind: "outcome", title: "More reorders", stage: "active", children: [{ id: "n1", kind: "opportunity", title: "Rebuilding my basket takes too long" }] });
    const b = board("b2", "Office pantry", { id: "o2", kind: "outcome", title: "Offices reorder", stage: "active", children: [{ id: "n8", kind: "opportunity", title: "Copying old orders by hand" }] }, "business");
    const shows = new Map([
      [
        "tp1",
        [
          { ref: "hub:card:b1:n1", board: "b1", card: "n1", kind: "opportunity", shared: 3 },
          { ref: "hub:card:b2:n8", board: "b2", card: "n8", kind: "opportunity", shared: 2 },
        ],
      ],
    ]);
    const t = topic({ title: "Rebuilding my usual basket takes too long", products: ["grocery", "business"] });
    // One shared quote isn't enough, and a segment's page spans many needs.
    const weak = new Map([["tp1", shows.get("tp1")!.map((x) => ({ ...x, shared: 1 }))]]);
    expect(runChecks(input({ boards: [a, b], topics: [t], shows: weak }))).toEqual([]);
    expect(runChecks(input({ boards: [a, b], topics: [{ ...t, kind: "segment" }], shows }))).toEqual([]);
    const [n] = runChecks(input({ boards: [a, b], topics: [t], shows }));
    expect(n).toMatchObject({ key: `same-need:${pairKey("hub:card:b1:n1", "hub:card:b2:n8")}`, kind: "same-need", board: "b1", card: "n1", other: { board: "b2", card: "n8" }, products: ["grocery", "business"] });
    expect(n.title).toBe("“Rebuilding my usual basket takes too long” shows up on two boards");
    expect(n.why).toBe("“Rebuilding my basket takes too long” on Weekly reorders and “Copying old orders by hand” on Office pantry rest on the same customers' words. If they're one need, link them.");
    expect(runChecks(input({ boards: [a, b], topics: [t], shows, linked: new Set([pairKey("hub:card:b2:n8", "hub:card:b1:n1")]) }))).toEqual([]);
    // Named alike on two boards, with no page between them.
    const c = board("b3", "Delivery", { id: "o3", kind: "outcome", title: "On time", stage: "active", children: [{ id: "n2", kind: "opportunity", title: "rebuilding my basket takes too long." }] });
    expect(runChecks(input({ boards: [a, c] })).map((x) => x.kind)).toEqual(["same-need"]);
  });

  it("asks to revisit a card parked or dropped when new evidence backs it since", () => {
    const parkedAt = ago(20);
    const b = board("b1", "Office pantry", { id: "o1", kind: "outcome", title: "Offices reorder", stage: "active", children: [{ id: "n7", kind: "opportunity", title: "Finance needs one monthly invoice", stage: "parked", evidence: [quote("k4", ago(30)), quote("m9", ago(2)), quote("x1", ago(1), "against")] }] });
    const d = (over: Partial<Decision>): Decision => ({ id: "d5", at: parkedAt, kind: "stage", board: "b1", boardName: "Office pantry", card: "n7", cardTitle: "Finance needs one monthly invoice", what: "Parked", by: "you", big: true, why: "Finance tooling is next quarter.", detail: { from: "exploring", to: "parked" }, ...over });
    const [n] = runChecks(input({ boards: [b], decisions: [d({})] }));
    expect(n).toMatchObject({ key: "revisit:d5:1", kind: "revisit", board: "b1", card: "n7", refs: ["hub:quote:m9"], at: ago(2) });
    expect(n.why).toBe("1 new piece of evidence, like “Words of m9”. The reason then: Finance tooling is next quarter.");
    expect(runChecks(input({ boards: [b], decisions: [d({ undone: true })] }))).toEqual([]);
    expect(runChecks(input({ boards: [b], decisions: [d({ detail: { from: "exploring", to: "solved" } })] }))).toEqual([]);
  });

  it("brings up a test running too long, a build on an untested risky assumption, and an outcome nobody updates", () => {
    const b = board("b1", "Weekly reorders", {
      id: "o1",
      kind: "outcome",
      title: "More customers reorder every week",
      stage: "active",
      stageAt: ago(40),
      metric: { name: "Reorders per customer", unit: "orders", direction: "increase", baseline: 1.3, current: 1.3, target: 1.5 },
      children: [
        {
          id: "s1",
          kind: "solution",
          title: "Order again shelf",
          stage: "building",
          stageAt: ago(3),
          assumptions: [
            { id: "a1", category: "desirability", text: "Parents want last week's basket", importance: 3, addedBy: "user" },
            { id: "a2", category: "usability", text: "They find the shelf", importance: 3, addedBy: "user" },
            { id: "a3", category: "viability", text: "It pays", importance: 2, addedBy: "user" },
          ],
          children: [{ id: "t1", kind: "test", title: "Prototype test with 5 parents", stage: "running", stageAt: ago(20), test: { assumptionIds: ["a2"] } }],
        },
        { id: "s2", kind: "solution", title: "Just an idea", stage: "idea", assumptions: [{ id: "a4", category: "desirability", text: "Risky", importance: 3, addedBy: "user" }] },
      ],
    });
    const kinds = runChecks(input({ boards: [b] })).map((n) => [n.kind, n.title]);
    // Newest first: the build started 3 days ago, the test went stale 6 days ago, the number 19.
    expect(kinds).toEqual([
      ["untested", "“Order again shelf” is being built without testing its riskiest assumption"],
      ["stale-test", "“Prototype test with 5 parents” has been running for 20 days"],
      ["metric", "“More customers reorder every week” hasn't moved from where it started"],
    ]);
    // A recent update of the number: nothing to say about it.
    const update: Decision = { id: "m1", at: ago(5), kind: "metric", board: "b1", boardName: "Weekly reorders", card: "o1", cardTitle: "", what: "", by: "you", big: false, detail: { field: "current", from: 1.3, to: 1.3 } };
    expect(runChecks(input({ boards: [b], decisions: [update] })).map((n) => n.kind)).toEqual(["untested", "stale-test"]);
  });

  it("says what Qalam AI found for a board in material added to the organization", () => {
    const b = board("b1", "Delivery experience", { id: "o1", kind: "outcome", title: "On time", stage: "active" });
    const placed = [{ board: "b1", sourceId: "s9", title: "Rania interview", count: 3, at: ago(1) }, { board: "gone", sourceId: "s9", title: "Rania interview", count: 1, at: ago(1) }];
    expect(runChecks(input({ boards: [b], placed }))).toEqual([
      { key: "placed:s9:b1:3", kind: "placed", title: "Qalam AI found where “Rania interview” fits on Delivery experience", why: "3 proposals wait on the board for you to accept or discard.", at: ago(1), board: "b1", products: ["grocery"] },
    ]);
  });

  it("finds a page whose pieces are all gone", () => {
    const t = topic({ lines: [{ id: "l1", section: "know", text: "x", by: "qalam", cites: ["hub:quote:gone"], from: ["Old interview"], at: ago(3) }] });
    expect(runChecks(input({ topics: [t] })).map((n) => n.key)).toEqual(["orphan:tp1:1"]);
  });

  it("takes a review's finding as the server keeps it", () => {
    const n = { key: "review:abc", kind: "review", title: "  Evening slots  ", why: "Tickets say lateness.", at: NOW, board: "b1", card: "n4", refs: ["hub:quote:tix-1"], products: ["grocery"] };
    expect(noticeShape(n)).toEqual({ ...n, title: "Evening slots" });
    expect(noticeShape({ ...n, kind: "nope" })).toBeNull();
    expect(noticeShape({ ...n, board: "../x" })).toMatchObject({ key: "review:abc" });
    expect(noticeShape({ ...n, board: "../x" })?.board).toBeUndefined();
  });
});

describe("a target on thin evidence", () => {
  it("says so, and says what would make it stronger, until three voices in two sources back it", () => {
    const tree = (evidence: OstEvidence[]) => board("b1", "Reorders", { id: "o1", kind: "outcome", title: "More reorders", stage: "active", children: [{ id: "n1", kind: "opportunity", title: "I wait at home for the courier", stage: "target", stageAt: ago(3), evidence }] });
    const one = runChecks(input({ boards: [tree([{ ...quote("a", ago(4)), sourceId: "s1", speaker: "Sara" }])] }));
    expect(one).toEqual([
      expect.objectContaining({ key: "thin-target:hub:card:b1:n1:thin:1", kind: "thin-target", title: "The target “I wait at home for the courier” rests on thin evidence", board: "b1", card: "n1" }),
    ]);
    expect(one[0].why).toBe("Thin: 1 voice (1 source) · newest 4 days ago. Hear it from more people (three or more, in two sources) before betting on it.");
    const team = runChecks(input({ boards: [tree([{ id: "d", kind: "dump", text: "We think so", addedBy: "user", at: ago(2) }])] }));
    expect(team[0].title).toBe("The target “I wait at home for the courier” rests on the team's belief alone");
    const strong = runChecks(input({ boards: [tree([{ ...quote("a", ago(4)), sourceId: "s1" }, { ...quote("b", ago(4)), sourceId: "s2" }, { ...quote("c", ago(4)), sourceId: "s3" }])] }));
    expect(strong).toEqual([]);
  });
});

describe("goals and the outcomes that serve them", () => {
  const g = (id: string, text: string, product: string | null, lead = false) => ({ goal: { id, text }, product, lead, owner: product ? "Grocery" : "Basket", at: ago(10) });
  const goals = [g("gOrders", "2M dirhams a month in orders", null, true), g("gReorders", "More families reorder every week", "grocery", true), g("gSecond", "New customers order a second time", "grocery")];

  it("says when a stated goal has no board working on it, and when its only outcome is paused", () => {
    const b1 = board("b1", "Reorders", { id: "o1", kind: "outcome", title: "More weekly reorders", stage: "active", serves: { goal: "gReorders", product: "grocery" } });
    const b2 = board("b2", "Second orders", { id: "o2", kind: "outcome", title: "Second orders", stage: "paused", serves: { goal: "gSecond", product: "grocery" } });
    const b3 = board("b3", "Orders", { id: "o3", kind: "outcome", title: "Grow orders", stage: "active", serves: { goal: "gOrders", product: null } }, null);
    const n = runChecks(input({ boards: [b1, b2, b3], goals }));
    expect(n.filter((x) => x.kind === "unworked-goal")).toEqual([
      { key: "unworked-goal:grocery:gSecond:paused", kind: "unworked-goal", title: "No board works on “New customers order a second time”, a goal of Grocery", why: "The only outcome serving it, “Second orders” on Second orders, is paused.", at: ago(10), products: ["grocery"] },
    ]);
    const none = runChecks(input({ boards: [], goals: [goals[0]] }));
    expect(none[0]).toMatchObject({ key: "unworked-goal:org:gOrders:none", title: "Nothing moves “2M dirhams a month in orders”, the goal that leads for Basket", products: [] });
  });

  it("says when a tree's outcome serves no stated goal, or one no longer stated; never a sub-outcome's", () => {
    const b = board("b1", "Reorders", { id: "o1", kind: "outcome", title: "More weekly reorders", stage: "active", children: [{ id: "o2", kind: "outcome", title: "Faster checkout", stage: "active" }] });
    const n = runChecks(input({ boards: [b], goals })).filter((x) => x.kind === "unanchored");
    expect(n).toEqual([
      expect.objectContaining({ key: "unanchored:hub:card:b1:o1", title: "“More weekly reorders” serves none of the goals you've stated", board: "b1", card: "o1" }),
    ]);
    expect(n[0].why).toBe("On Reorders. The goals it could serve: “2M dirhams a month in orders”, “More families reorder every week”, “New customers order a second time”. Say which on its card, or write down the goal it does serve.");
    const gone = board("b1", "Reorders", { id: "o1", kind: "outcome", title: "More weekly reorders", stage: "active", serves: { goal: "gOld", product: "grocery" } });
    expect(runChecks(input({ boards: [gone], goals })).filter((x) => x.kind === "unanchored")[0].title).toBe("“More weekly reorders” serves a goal that's no longer stated");
    // No goals stated: nothing to say about outcomes.
    expect(runChecks(input({ boards: [b], goals: [] }))).toEqual([]);
  });
});
