import { describe, expect, it } from "vitest";
import type { Doc } from "@/doc/schema";
import { decisionToMarkdown, entriesOf } from "@/decisions/format";
import { sanitizeDecision, type Decision } from "@/decisions/model";
import { boardSummary } from "@/discovery/summary";
import type { OstCard } from "@/discovery/types";
import { commentsFromLog } from "./comments";

const AT = Date.UTC(2026, 9, 20, 12);

describe("comments", () => {
  it("fold the log's lines: written, resolved, opened again; broken lines skipped", () => {
    const card = "hub:card:b1:n1";
    const list = commentsFromLog([
      { comment: { id: "c1", card, text: "Did Omar say this, or Sara?", who: "Lina", at: 1 } },
      { comment: { id: "c2", card, text: "Ask the clinics too.", at: 2 } },
      { resolve: "c1", at: 3, who: "Sara" },
      { comment: { id: "c3", card: "not a card", text: "x", at: 4 } },
      "garbage",
      { resolve: "c2", at: 5 },
      { resolve: "c2", at: 6, open: true },
    ]);
    expect(list).toEqual([
      { id: "c1", card, text: "Did Omar say this, or Sara?", who: "Lina", at: 1, resolved: { at: 3, who: "Sara" } },
      { id: "c2", card, text: "Ask the clinics too.", at: 2 },
    ]);
  });
});

describe("who decided", () => {
  const d: Decision = { id: "d1", at: AT, kind: "target", board: "b1", boardName: "Reorders", card: "n1", cardTitle: "Late couriers", what: "Made “Late couriers” the target", by: "you", big: true, who: "Sara" };
  it("is kept with the decision and said in its entry", () => {
    expect(sanitizeDecision({ ...d, who: "  Sara  " })?.who).toBe("Sara");
    const md = decisionToMarkdown(d);
    expect(md).toContain("*By Sara.*");
    expect(entriesOf(md)[0].decision.who).toBe("Sara");
    expect(decisionToMarkdown({ ...d, by: "qalam" })).toContain("*Proposed by Qalam AI, accepted by Sara.*");
    expect(decisionToMarkdown({ ...d, who: undefined, by: "qalam" })).toContain("*Proposed by Qalam AI, accepted by you.*");
  });
});

describe("where a board stands", () => {
  it("says each outcome's goal and number, the target with what backs it, its solutions and tests, the other needs, and the latest decisions", () => {
    type CardIn = Partial<OstCard> & { id: string; kind: OstCard["kind"]; title: string; children?: CardIn[] };
    const nodes: Record<string, unknown> = {};
    const add = (c: CardIn, parentId: string | null) => {
      const { id, children = [], ...rest } = c;
      nodes[id] = { id, type: "frame", name: c.title, parentId, children: children.map((x) => x.id), x: 0, y: 0, w: 1, h: 1, meta: { ost: { v: 1, stage: "exploring", createdBy: "user", evidence: [], ...rest } } };
      for (const k of children) add(k, id);
    };
    add(
      {
        id: "o1",
        kind: "outcome",
        title: "More families reorder every week",
        stage: "active",
        owner: "Sara",
        metric: { name: "Weekly reorders", direction: "increase", baseline: 1.2, current: 1.26, target: 1.5, readings: [{ at: AT - 30 * 86_400_000, value: 1.19 }, { at: AT + 10 * 86_400_000, value: 1.26 }] },
        children: [
          {
            id: "n1",
            kind: "opportunity",
            title: "I never know when the courier comes",
            stage: "target",
            evidence: [{ id: "e1", kind: "quote", text: "I waited 2 hours", sourceId: "s1", speaker: "Sara", addedBy: "ai", at: AT }],
            children: [{ id: "s1", kind: "solution", title: "Live tracking", stage: "shipped", stageAt: AT, owner: "Omar", children: [{ id: "t1", kind: "test", title: "Fake door", stage: "passed", test: { assumptionIds: [], criterion: "1 in 5 tap it", result: "1 in 3 did" } }] }],
          },
          { id: "n2", kind: "opportunity", title: "Substitutes are wrong", createdBy: "ai" },
        ],
      },
      null,
    );
    const doc = { roots: ["o1"], nodes } as unknown as Doc;
    const md = boardSummary(doc, { name: "Reorders", now: AT + 11 * 86_400_000, goalOf: () => "2M dirhams a month", decisions: [{ id: "d", at: AT, kind: "target", board: "b1", boardName: "Reorders", card: "n1", cardTitle: "", what: "Made “I never know when the courier comes” the target", by: "you", big: true, who: "Sara", why: "Most of our tickets" }] });
    expect(md).toBe(
      [
        "# Reorders: where it stands",
        "",
        "2026-10-31",
        "",
        "## Outcome: “More families reorder every week”",
        "",
        "Serves the goal “2M dirhams a month” · Weekly reorders · 1.26 now → 1.5 · owner Sara",
        "",
        "### Target: “I never know when the courier comes”",
        "",
        "What backs it: Thin: 1 voice (1 source) · newest 11 days ago.",
        "- Solution “Live tracking”: shipped, owner Omar; since it shipped, Weekly reorders went 1.19 → 1.26 (the right way)",
        "  - Test “Fake door”: passed, passes if 1 in 5 tap it. Result: 1 in 3 did",
        "",
        "Other needs under it:",
        "- “Substitutes are wrong” (exploring): Nothing yet",
        "",
        "## Latest decisions",
        "",
        "- 2026-10-20 · Made “I never know when the courier comes” the target (Sara). Why: Most of our tickets",
        "",
      ].join("\n"),
    );
  });
});
