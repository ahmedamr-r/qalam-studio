import { describe, expect, it } from "vitest";
import type { Doc } from "@/doc/schema";
import { compareSchema } from "@/ai/compare";
import { canCompare, compareMaterial, compareUnder, sanitizeCompare } from "./compare";
import type { OstCard, OstEvidence } from "./types";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 28);
type CardIn = Partial<OstCard> & { id: string; kind: OstCard["kind"]; title: string; children?: CardIn[] };

function doc(tree: CardIn): Doc {
  const nodes: Record<string, unknown> = {};
  const add = (c: CardIn, parentId: string | null) => {
    const { id, children = [], ...rest } = c;
    nodes[id] = { id, type: "frame", name: c.title, parentId, children: children.map((x) => x.id), x: 0, y: 0, w: 240, h: 80, meta: { ost: { v: 1, stage: "exploring", createdBy: "user", evidence: [], ...rest } } };
    for (const k of children) add(k, id);
  };
  add(tree, null);
  return { roots: [tree.id], nodes } as unknown as Doc;
}
const q = (id: string, text: string, sourceId: string, speaker: string, at = NOW - DAY): OstEvidence => ({ id, kind: "quote", text, piece: `hub:quote:${id}`, sourceId, speaker, addedBy: "ai", at });

const tree = doc({
  id: "o1",
  kind: "outcome",
  title: "More families reorder every week",
  stage: "active",
  metric: { name: "Weekly reorders", direction: "increase", baseline: 1.2, current: 1.26, target: 1.5 },
  children: [
    { id: "n1", kind: "opportunity", title: "I never know when the courier will come", stage: "target", rating: { often: 3, hurts: 2 }, evidence: [q("a", "I waited 2 hours at home", "s1", "Sara")], children: [{ id: "s1", kind: "solution", title: "Live tracking", stage: "testing", children: [{ id: "t1", kind: "test", title: "Fake door", stage: "passed" }] }] },
    { id: "n2", kind: "opportunity", title: "Rebuilding my basket takes forever", evidence: [q("b", "It takes me 40 minutes every Sunday", "s1", "Omar"), q("c", "same thirty things every week", "s2", "Lina"), q("d", "I rebuild it from memory", "s3", "Mona")] },
    { id: "x1", kind: "solution", title: "Not a need", stage: "idea" },
  ],
});

describe("comparing the needs under an outcome", () => {
  it("lists the needs directly under it, with what code counts about each", () => {
    expect(canCompare(tree, "o1")).toBe(true);
    expect(canCompare(tree, "n1")).toBe(false);
    const rows = compareUnder(tree, "o1", { now: NOW });
    expect(rows.map((r) => [r.id, r.strength.level, r.strength.tally.voices, r.solutions, r.tests])).toEqual([
      ["n1", "thin", 1, 1, { passed: 1, failed: 0, running: 0 }],
      ["n2", "strong", 3, 0, { passed: 0, failed: 0, running: 0 }],
    ]);
  });

  it("sends Qalam AI the needs with their strength, the team's call and their customers' words, under ids", () => {
    const rows = compareUnder(tree, "o1", { now: NOW });
    const o1 = (tree.nodes.o1 as unknown as { meta: { ost: OstCard } }).meta.ost;
    const m = compareMaterial({ parent: o1, outcome: o1, goal: "More families reorder every week", context: "Strategy: Be the fastest.", rows });
    expect(m.text).toContain("The outcome: “More families reorder every week” · Weekly reorders · 1.26 now → 1.5 · it serves the goal “More families reorder every week”");
    expect(m.text).toContain("- n1 · “I never know when the courier will come” · target · strength: thin (1 voice (1 source) · newest 1 day ago) · 1 solution, tests 1 passed and 0 failed · the team: how often it happens: often; how much it hurts: some");
    expect(m.text).toContain("  - q1 · Sara: “I waited 2 hours at home”");
    expect(m.text).toContain("- n2 · “Rebuilding my basket takes forever” · exploring · strength: strong (3 voices (3 sources) · newest 1 day ago) · 0 solutions · the team hasn't rated it");
    expect([...m.needs]).toEqual([["n1", "n1"], ["n2", "n2"]]);
    expect(compareSchema({ text: m.text, needs: [...m.needs.keys()], ids: [...m.cited.keys()] }).properties.pick).toMatchObject({ enum: ["n1", "n2", "none"] });
  });

  it("keeps Qalam AI's argument only when its quotes and numbers are in what it cites", () => {
    const rows = compareUnder(tree, "o1", { now: NOW });
    const o1 = (tree.nodes.o1 as unknown as { meta: { ost: OstCard } }).meta.ost;
    const m = compareMaterial({ parent: o1, outcome: o1, context: "", rows });
    const good = sanitizeCompare(
      {
        pick: "n2",
        why: "Three people in three sources raise it, and it costs a parent “40 minutes every Sunday”.",
        cites: ["n2", "q2", "nope"],
        others: [
          { need: "n1", note: "One voice so far; hear it from more parents.", cites: ["n1"] },
          { need: "n1", note: "A twice.", cites: [] },
          { need: "n2", note: "The pick itself.", cites: [] },
        ],
        ask: "",
      },
      m,
    );
    expect(good).toEqual({ pick: "n2", why: "Three people in three sources raise it, and it costs a parent “40 minutes every Sunday”.", others: [{ card: "n1", note: "One voice so far; hear it from more parents." }], cites: ["n2", "q2"] });
    // A number that isn't there, or a quote that isn't word for word: the argument is dropped.
    expect(sanitizeCompare({ pick: "n2", why: "It costs parents 90 minutes.", cites: ["q2"], others: [] }, m)).toBeNull();
    expect(sanitizeCompare({ pick: "n2", why: "They say “it takes an hour”.", cites: ["q2"], others: [] }, m)).toBeNull();
    expect(sanitizeCompare({ pick: "n2", why: "Clear.", cites: [], others: [] }, m)).toBeNull();
    expect(sanitizeCompare({ pick: "none", why: "Too close to call from one voice each.", cites: ["n1"], others: [] }, m)).toMatchObject({ pick: null });
  });
});
