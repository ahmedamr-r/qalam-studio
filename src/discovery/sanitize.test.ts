import { describe, expect, it } from "vitest";
import { SAMPLE_ANSWERS, SAMPLE_DRAFT_RAW } from "@/ai/fixtures-discovery";
import { parsePartial } from "@/ai/partial-json";
import { draftSchema } from "@/ai/discovery";
import { LIMITS, partialDraft, sanitizeDraft, sanitizeFollowups } from "./sanitize";
import { draftToDoc } from "./draft-doc";
import { isAIIdea, isAssumed } from "./evidence";
import { CORE_QUESTIONS, briefFromAnswers, interviewAnswers } from "./interview";
import { isOstCard } from "@/doc/board";

describe("sanitizeDraft", () => {
  const draft = sanitizeDraft(SAMPLE_DRAFT_RAW, SAMPLE_ANSWERS, 1);
  const byTitle = (t: string) => draft.cards.find((c) => c.card.title === t)!;

  it("keeps the builder's numbers and drops the ones they never gave", () => {
    const m = draft.outcome!.metric!;
    expect(m.baseline).toBe(1.2);
    expect(m.target).toBe(1.5);
    // 1.31 was never said: "now" falls back to today's number.
    expect(m.current).toBe(1.2);
    expect(m.timeframe).toBe("by March");
  });

  it("keeps a quote only if the builder said it, in their own words", () => {
    const o1 = byTitle("I can't find what I ordered last time");
    expect(o1.card.evidence.map((e) => e.text)).toEqual(["can't find what they ordered last time"]);
    expect(isAssumed(o1.card)).toBe(false);
    // The planted quote isn't in any answer: the opportunity stays, Assumed.
    const o5 = byTitle("I forget to reorder until I've run out");
    expect(o5.card.evidence).toEqual([]);
    expect(isAssumed(o5.card)).toBe(true);
    expect(isAssumed(byTitle("Evening slots are full when I need them").card)).toBe(true);
  });

  it("nests opportunities and puts solutions under them", () => {
    expect(byTitle("Rebuilding my usual basket takes too long").parent).toBe("o1");
    expect(byTitle("I can't find what I ordered last time").parent).toBeNull();
    expect(byTitle("Order again shelf on the home screen").parent).toBe("o1");
    expect(byTitle("I can't find what I ordered last time").card.stage).toBe("target");
  });

  it("keeps the builder's ideas and only up to three of Qalam AI's, under the target", () => {
    const shelf = byTitle("Order again shelf on the home screen");
    expect(isAIIdea(shelf.card)).toBe(false);
    expect(shelf.card.evidence[0].text).toBe("an order again shelf on the home screen");
    expect(shelf.card.assumptions).toHaveLength(3);
    expect(isAIIdea(byTitle("Saved baskets to reorder in one tap").card)).toBe(true);
    // An AI idea under an opportunity that isn't the target is dropped.
    expect(draft.cards.some((c) => c.card.title.startsWith("Live courier tracking"))).toBe(false);
    expect(draft.cards.every((c) => c.card.createdBy === "ai")).toBe(true);
  });

  it("repairs parents, depth, duplicates and caps", () => {
    const raw = {
      outcome: { title: "X", metric: { name: "n", direction: "increase", baseline: null, current: null, target: null } },
      opportunities: [
        { id: "a", parent: "outcome", title: "Level one", evidence: [] },
        { id: "b", parent: "a", title: "Level two", evidence: [] },
        { id: "c", parent: "b", title: "Level three", evidence: [] },
        { id: "d", parent: "c", title: "Level four goes up a level", evidence: [] },
        { id: "e", parent: "nowhere", title: "Unknown parent goes to the outcome", evidence: [] },
        { id: "f", parent: "outcome", title: "level ONE", evidence: [] },
        ...Array.from({ length: 12 }, (_, i) => ({ id: `x${i}`, parent: "outcome", title: `Need ${i}`, evidence: [] })),
      ],
      solutions: [{ id: "s", opportunity: "outcome", title: "Not under an opportunity", answerId: null, quote: null, assumptions: [] }],
      recommendedTarget: "nope",
    };
    const d = sanitizeDraft(raw, SAMPLE_ANSWERS);
    const ref = (t: string) => d.cards.find((c) => c.card.title === t);
    expect(ref("Level four goes up a level")?.parent).toBe("b");
    expect(ref("Unknown parent goes to the outcome")?.parent).toBeNull();
    expect(ref("level ONE")).toBeUndefined();
    expect(d.cards.filter((c) => c.parent === null)).toHaveLength(LIMITS.topLevel);
    expect(d.cards.some((c) => c.card.kind === "solution")).toBe(false);
  });

  it("lays the draft out as one tree of cards", () => {
    const built = draftToDoc(draft, { x: 0, y: 0 })!;
    const cards = Object.values(built.doc.nodes).filter(isOstCard);
    expect(cards).toHaveLength(draft.cards.length + 1);
    expect(built.doc.roots).toEqual([built.rootId]);
    expect(cards.every((n) => n.w > 0 && n.h > 0)).toBe(true);
  });
});

describe("partialDraft", () => {
  it("only shows cards whose object has closed", () => {
    const json = JSON.stringify(SAMPLE_DRAFT_RAW);
    const cut = json.slice(0, json.indexOf('"o3"') + 40);
    const d = partialDraft(parsePartial(cut), SAMPLE_ANSWERS);
    expect(d.outcome?.title).toBe("More customers reorder every week");
    expect(d.cards.map((c) => c.ref)).toEqual(["o1", "o2"]);
  });
});

describe("follow-ups and answers", () => {
  it("keeps three short questions at most", () => {
    const raw = { followUps: Array.from({ length: 5 }, (_, i) => ({ id: `Q ${i}!`, question: `Which customers ${i}?`, why: "", options: ["a", "a", "b"] })) };
    const f = sanitizeFollowups(raw);
    expect(f).toHaveLength(3);
    expect(f[0]).toEqual({ id: "q0", question: "Which customers 0?", why: "", options: ["a", "b"] });
  });

  it("reads the interview answers into the brief", () => {
    const list = interviewAnswers(CORE_QUESTIONS, {
      product: { kind: "text", text: "A grocery app" },
      audience: { kind: "text", text: "Parents" },
      stage: { kind: "single", value: "fit" },
      business: { kind: "single", value: "__other", other: "Fewer refunds" },
      metric: { kind: "text", text: "Reorders 1.2 → 1.5" },
      pains: { kind: "skipped" },
    });
    expect(list.map((a) => a.answer)).toEqual(["A grocery app", "Parents", "Launched, finding its fit", "Fewer refunds", "Reorders 1.2 → 1.5", ""]);
    const brief = briefFromAnswers(list, 5);
    expect(brief.map((b) => b.topic)).toEqual(["other", "audience", "other", "goal", "success-metric"]);
  });

  it("asks the model to quote only the answers it was given", () => {
    const s = draftSchema(["product", "pains"]) as unknown as { properties: { opportunities: { items: { properties: { evidence: { items: { properties: { answerId: { enum: string[] } } } } } } } } };
    expect(s.properties.opportunities.items.properties.evidence.items.properties.answerId.enum).toEqual(["product", "pains"]);
  });
});
