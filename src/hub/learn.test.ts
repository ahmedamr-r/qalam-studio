import { describe, expect, it } from "vitest";
import type { Doc } from "@/doc/schema";
import type { OstCard } from "@/discovery/types";
import { learnSchema } from "@/ai/learn";
import { runChecks, type CheckBoard } from "./checks";
import { learnItems, learnMaterial, planToMarkdown, sanitizePlan } from "./learn";
import type { Voice } from "./people";
import type { Topic } from "./topics";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 28);
type CardIn = Partial<OstCard> & { id: string; kind: OstCard["kind"]; title: string; children?: CardIn[] };
function board(id: string, tree: CardIn, product: string | null = "grocery", createdAt = NOW - 60 * DAY): CheckBoard {
  const nodes: Record<string, unknown> = {};
  const add = (c: CardIn, parentId: string | null) => {
    const { id: cid, children = [], ...rest } = c;
    nodes[cid] = { id: cid, type: "frame", name: c.title, parentId, children: children.map((x) => x.id), x: 0, y: 0, w: 240, h: 80, meta: { ost: { v: 1, stage: "exploring", createdBy: "user", evidence: [], ...rest } } };
    for (const k of children) add(k, cid);
  };
  add(tree, null);
  return { id, name: "Reorders", product, createdAt, doc: { roots: [tree.id], nodes } as unknown as Doc };
}

const b = board("b1", {
  id: "o1",
  kind: "outcome",
  title: "More reorders",
  stage: "active",
  children: [
    { id: "n1", kind: "opportunity", title: "I wait at home for the courier", stage: "target", evidence: [{ id: "e", kind: "quote", text: "I waited 2 hours", sourceId: "s1", addedBy: "ai", at: NOW - DAY }], children: [{ id: "s1", kind: "solution", title: "Live tracking", stage: "building", assumptions: [{ id: "a1", category: "desirability", text: "Parents will open the map", importance: 3, addedBy: "user" }] }] },
    { id: "n2", kind: "opportunity", title: "Substitutes are wrong", createdBy: "ai" },
  ],
});
const topic: Topic = { id: "tp", kind: "need", title: "Late deliveries", products: ["grocery"], createdAt: NOW, updatedAt: NOW, lines: [{ id: "l1", section: "open", text: "Do offices mind a late delivery as much?", by: "qalam", cites: [], from: [], at: NOW }], history: [] };
const voices = new Map<string, Voice>([["hub:quote:x", { key: "person:sara", segments: ["Parents"], source: "s1", at: NOW - DAY }]]);

describe("what the organization doesn't know yet", () => {
  it("gathers thin targets, risky untested assumptions, needs nothing backs, open questions and unheard segments", () => {
    const items = learnItems({ boards: [b], topics: [topic], voices, segments: ["Parents", "Offices"], now: NOW, product: "grocery" });
    expect(items.map((x) => [x.id, x.kind, x.text])).toEqual([
      ["i1", "thin-target", "The target “I wait at home for the courier” on Reorders rests on thin evidence: 1 voice (1 source) · newest 1 day ago"],
      ["i2", "risky", "“Live tracking” (building) fails without this, and nothing tests it: Parents will open the map"],
      ["i3", "assumed", "A need drafted with nothing behind it: “Substitutes are wrong” on Reorders"],
      ["i4", "open", "An open question about “Late deliveries”: Do offices mind a late delivery as much?"],
      ["i5", "unheard", "No one from “Offices” heard from yet"],
    ]);
    // Another product's boards and pages stay out.
    expect(learnItems({ boards: [b], topics: [topic], voices, segments: [], now: NOW, product: "business" })).toEqual([]);
  });

  it("keeps a plan's parts on the gaps they cite, and a who only as the material names them", () => {
    const items = learnItems({ boards: [b], topics: [topic], voices, segments: ["Parents", "Offices"], now: NOW, product: "grocery" });
    const m = learnMaterial({ items, context: "The product (Grocery):\nSegments: Parents; Offices", segments: ["Parents", "Offices"] });
    expect(m.text).toContain("Targets resting on thin evidence:\n- i1: The target");
    expect(learnSchema({ ids: m.ids }).properties.talkTo).toBeTruthy();
    const plan = sanitizePlan(
      {
        focus: "Whether waiting for the courier is common enough to target, before building live tracking.",
        talkTo: [
          { who: "Offices", why: "No one from them has been heard yet.", cites: ["i5"] },
          { who: "Retired gardeners", why: "Made up.", cites: ["i1"] },
          { who: "Parents", why: "Hear the wait from more than one parent.", cites: [] },
        ],
        questions: [
          { question: "Tell me about the last time you waited for a delivery.", learns: "How often the wait happens, and what it costs them.", cites: ["i1"] },
          { question: "How much would you pay, 20 dirhams?", learns: "Price.", cites: ["i1"] },
        ],
        tests: [{ what: "Parents will open the map", method: "A fake-door map link in the order screen for a week", passIf: "Passes if 1 in 5 tap it", cites: ["i2"] }],
      },
      m,
    )!;
    expect(plan.talkTo.map((x) => x.who)).toEqual(["Offices"]);
    expect(plan.questions.map((x) => x.question)).toEqual(["Tell me about the last time you waited for a delivery."]);
    // "1 in 5" isn't in what it cites: the test is dropped.
    expect(plan.tests).toEqual([]);
    const md = planToMarkdown(plan, { title: "What to learn next for Grocery", at: NOW, items: m.items });
    expect(md).toBe(
      "# What to learn next for Grocery\n\n2026-10-28 · drafted by Qalam AI from what the organization doesn't know yet\n\nWhether waiting for the courier is common enough to target, before building live tracking.\n\n## Who to talk to\n\n- **Offices**: No one from them has been heard yet.\n  - Closes: No one from “Offices” heard from yet\n\n## What to ask\n\n1. Tell me about the last time you waited for a delivery.\n   - Tells us: How often the wait happens, and what it costs them.\n",
    );
    expect(sanitizePlan({ focus: "", talkTo: [], questions: [], tests: [] }, m)).toBeNull();
  });
});

describe("hearing from customers", () => {
  it("says when a team working on a product hasn't heard from a customer in two weeks", () => {
    const base = { now: NOW, decisions: [], topics: [], indexed: true, shows: new Map(), pieces: new Map(), linked: new Set<string>(), productName: () => "Grocery" };
    const quiet = runChecks({ ...base, boards: [b], heard: [{ product: "grocery", at: NOW - 30 * DAY }] }).filter((n) => n.kind === "cadence");
    expect(quiet).toEqual([expect.objectContaining({ key: `cadence:grocery:${NOW - 30 * DAY}`, title: "No one has heard from a customer of Grocery in 4 weeks", products: ["grocery"] })]);
    // Something heard for the whole organization counts for every product.
    expect(runChecks({ ...base, boards: [b], heard: [{ product: null, at: NOW - 3 * DAY }] }).filter((n) => n.kind === "cadence")).toEqual([]);
    const never = runChecks({ ...base, boards: [b], heard: [] }).filter((n) => n.kind === "cadence");
    expect(never[0].title).toBe("No customer of Grocery has been heard yet");
    // A new board has two weeks before it's asked.
    expect(runChecks({ ...base, boards: [board("b2", { id: "o", kind: "outcome", title: "x", stage: "active" }, "grocery", NOW - 3 * DAY)], heard: [] }).filter((n) => n.kind === "cadence")).toEqual([]);
  });
});
