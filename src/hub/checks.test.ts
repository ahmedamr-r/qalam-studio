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

describe("work and numbers", () => {
  const work = { connector: "linear", ref: "ENG-12", url: "https://linear.app/b/issue/ENG-12" };
  const at = (stage: OstCard["stage"]) => board("b1", "Checkout", { id: "o1", kind: "outcome", title: "Fewer abandoned baskets", stage: "active", children: [{ id: "s1", kind: "solution", title: "Fee breakdown", stage, work: [work] }] });

  it("says when the tool a solution is built in disagrees with its stage", () => {
    const done = { "linear:ENG-12": { state: "done" as const, label: "Done", at: ago(1) } };
    const n = runChecks(input({ boards: [at("building")], work: done })).filter((x) => x.kind === "work-drift");
    expect(n.map((x) => [x.key, x.title])).toEqual([["work-drift:hub:card:b1:s1:linear:ENG-12:done", "Linear says “ENG-12” is Done, and “Fee breakdown” is still building"]]);
    expect(runChecks(input({ boards: [at("shipped")], work: done })).some((x) => x.kind === "work-drift")).toBe(false);
    const canceled = { "linear:ENG-12": { state: "canceled" as const, label: "Canceled", at: ago(1) } };
    expect(runChecks(input({ boards: [at("building")], work: canceled })).filter((x) => x.kind === "work-drift")).toHaveLength(1);
    expect(runChecks(input({ boards: [at("idea")], work: canceled })).some((x) => x.kind === "work-drift")).toBe(false);
  });

  it("takes a number read from an analytics tool as an update", () => {
    const outcome = (readAt?: number) => board("b1", "Reorders", { id: "o1", kind: "outcome", title: "More reorders", stage: "active", stageAt: ago(60), metric: { name: "Reorders", direction: "increase", baseline: 1, current: 1.2, target: 1.5, ...(readAt ? { source: { connector: "posthog", ref: "x" }, readAt } : {}) } });
    expect(runChecks(input({ boards: [outcome()] })).some((x) => x.kind === "metric")).toBe(true);
    expect(runChecks(input({ boards: [outcome(ago(2))] })).some((x) => x.kind === "metric")).toBe(false);
  });
});
