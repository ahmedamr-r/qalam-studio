import { describe, expect, it } from "vitest";
import { emptyDoc, type BriefAnswer, type Doc } from "@/doc/schema";
import { makeFrame } from "@/doc/factory";
import { addCardIn, makeCardNode, newCard } from "./ops";
import { buildHandoff, designPrompt, handoffBrief, handoffLines, seedBrief, servesSummary } from "./handoff";
import type { OstCard, OstEvidence } from "./types";

const said = (text: string, kind: OstEvidence["kind"] = "answer"): OstEvidence => ({ id: text.slice(0, 6), kind, text, addedBy: "user", at: 1 });
const answer = (id: string, text: string): BriefAnswer => ({ id, topic: "other", question: id, answer: text, screenIds: [], at: 1 });

/** Outcome › broad need › specific need › solution, with the interview in the brief. */
function board() {
  const d: Doc = { ...emptyDoc(), brief: { summary: "", answers: [answer("interview:product", "Basket, a grocery app"), answer("interview:audience", "Busy parents"), answer("interview:stage", "Launched")], screens: {}, updatedAt: 1 } };
  const add = (card: OstCard, parent: string | null) => {
    const n = makeCardNode(card);
    addCardIn(d, n, parent);
    return n.id;
  };
  const outcome = add(newCard("outcome", { title: "More customers reorder every week", metric: { name: "Weekly reorders per customer", unit: "orders", direction: "increase", baseline: 1.2, current: 1.2, target: 1.5, timeframe: "by March" } }), null);
  const broad = add(newCard("opportunity", { title: "Reordering takes too long", evidence: [said("rebuilding the basket every week"), said("one more"), said("two more", "note")] }), outcome);
  const specific = add(newCard("opportunity", { title: "I can't find what I bought last time", evidence: [said("rebuilding the basket every week"), said("I scroll forever to find my usual milk")] }), broad);
  const solution = add(
    newCard("solution", {
      title: "Order again shelf",
      description: "Last orders on the home screen",
      evidence: [said("an order again button", "quote"), said("a", "note"), said("b"), said("c")],
      assumptions: [
        { id: "a1", category: "usability", text: "They notice the shelf", importance: 2, evidence: 2, addedBy: "ai" },
        { id: "a2", category: "desirability", text: "They reorder the same things", importance: 3, evidence: 1, addedBy: "ai" },
        { id: "a3", category: "feasibility", text: "Order history is available", importance: 3, evidence: 3, addedBy: "user" },
      ],
    }),
    specific,
  );
  return { d, outcome, broad, specific, solution };
}

const FROM = { projectId: "board1", projectName: "Reorders" };

describe("Design this", () => {
  it("only sends solutions", () => {
    const b = board();
    expect(buildHandoff(b.d, b.specific, FROM)).toBeNull();
    expect(buildHandoff(b.d, "missing", FROM)).toBeNull();
  });

  it("carries the solution's lineage, and asks for it in one line", () => {
    const b = board();
    const h = buildHandoff(b.d, b.solution, FROM, 5)!;
    expect(h.from).toEqual({ ...FROM, cardId: b.solution });
    expect(h.path).toEqual(["Reordering takes too long", "I can't find what I bought last time"]);
    expect(h.outcome).toEqual({ title: "More customers reorder every week", metric: "Weekly reorders per customer, 1.2 → 1.5 orders by March" });
    expect(h.solution).toEqual({ title: "Order again shelf", description: "Last orders on the home screen" });
    expect(h.prompt).toBe("Design “Order again shelf”, a solution to “I can't find what I bought last time”, to move “More customers reorder every week”.");
    expect(h.product).toEqual({ summary: "Basket, a grocery app", audience: "Busy parents", stage: "Launched" });
    expect(h.at).toBe(5);
  });

  it("names the nearest outcome under a goal, and the goals it's part of", () => {
    const b = board();
    const goal = makeCardNode(newCard("outcome", { title: "2M a month in orders" }));
    addCardIn(b.d, goal, null);
    b.d.roots = b.d.roots.filter((id) => id !== b.outcome);
    b.d.nodes[b.outcome].parentId = goal.id;
    b.d.nodes[goal.id].children.push(b.outcome);
    const h = buildHandoff(b.d, b.solution, FROM)!;
    expect(h.outcome.title).toBe("More customers reorder every week");
    expect(h.outcomes).toEqual(["2M a month in orders"]);
    expect(handoffLines(h)).toContain("Outcome it should move: “More customers reorder every week” (Weekly reorders per customer, 1.2 → 1.5 orders by March), part of “2M a month in orders”");
    expect(handoffBrief(h).find((a) => a.topic === "goal")?.answer).toContain("part of “2M a month in orders”");
    // A tree with one outcome carries no chain.
    const plain = board();
    expect(buildHandoff(plain.d, plain.solution, FROM)).not.toHaveProperty("outcomes");
  });

  it("brings what was said nearest the solution first, once each, at most six", () => {
    const b = board();
    const h = buildHandoff(b.d, b.solution, FROM)!;
    expect(h.evidence.map((e) => e.text)).toEqual(["an order again button", "a", "b", "c", "rebuilding the basket every week", "I scroll forever to find my usual milk"]);
    expect(h.evidence.slice(0, 2).map((e) => e.source)).toEqual(["a source", "a team note"]);
    expect(h.evidence.map((e) => e.about)).toEqual(["solution", "solution", "solution", "solution", "need", "need"]);
  });

  it("orders assumptions riskiest first: important and least known", () => {
    const b = board();
    const h = buildHandoff(b.d, b.solution, FROM)!;
    expect(h.assumptions.map((a) => a.text)).toEqual(["They reorder the same things", "They notice the shelf", "Order history is available"]);
  });

  it("seeds the Knowledge hub by topic, for the critic", () => {
    const b = board();
    const h = buildHandoff(b.d, b.solution, FROM)!;
    expect(h.brief.map((a) => a.topic)).toEqual(["goal", "audience", "problem", "primary-action", "constraints", "other"]);
    expect(handoffBrief(h)).toEqual(h.brief);
    // The need, in what was said about it (not the words naming the solution).
    expect(h.brief.find((a) => a.topic === "problem")!.answer).toBe("Reordering takes too long › I can't find what I bought last time — “rebuilding the basket every week” — “I scroll forever to find my usual milk”");
    expect(h.brief.find((a) => a.topic === "constraints")!.answer).toMatch(/^Desirability: They reorder the same things; /);
  });

  it("keeps a Screens project's own answers and summary, replacing only the same solution's", () => {
    const b = board();
    const h = buildHandoff(b.d, b.solution, FROM)!;
    const own = { summary: "A wallet", answers: [answer("mine", "Keep the brand calm")], screens: {}, updatedAt: 1 };
    const once = seedBrief(own, h, 10);
    expect(once.summary).toBe("A wallet");
    expect(once.answers[0].id).toBe("mine");
    expect(once.answers.slice(1).every((a) => a.id.startsWith(`ost:${b.solution}:`) && a.at === 10)).toBe(true);
    const twice = seedBrief(once, h, 20);
    expect(twice.answers).toHaveLength(once.answers.length);
    expect(seedBrief(undefined, h, 30).summary).toBe("Basket, a grocery app Working toward: More customers reorder every week.");
  });

  it("writes the chat's context from the lineage", () => {
    const b = board();
    const lines = handoffLines(buildHandoff(b.d, b.solution, FROM)!);
    expect(lines[0]).toBe("Solution to design: “Order again shelf”: Last orders on the home screen");
    expect(lines[1]).toBe("It addresses the customers' need “I can't find what I bought last time” (within: “Reordering takes too long”)");
    expect(lines.some((l) => l.startsWith("Riskiest assumptions"))).toBe(true);
    expect(lines.find((l) => l.startsWith("Said about the need"))).toBe("Said about the need, word for word: “rebuilding the basket every week” (the builder's interview); “I scroll forever to find my usual milk” (the builder's interview)");
    expect(lines.find((l) => l.startsWith("Said about this solution"))).toContain("“an order again button” (a source)");
    expect(designPrompt({ solution: { title: "Shelf" }, path: [], outcome: { title: "" } })).toBe("Design “Shelf”.");
  });
});

describe("screens made for solutions", () => {
  it("counts a Screens document's top-level frames by the solution they serve", () => {
    const d = emptyDoc();
    const frames = ["a", "b", "c", "d"].map((name) => makeFrame({ name, x: 0, y: 0, w: 390, h: 844 }));
    frames[0].meta.serves = { projectId: "board1", cardId: "s1" };
    frames[1].meta.serves = { projectId: "board1", cardId: "s1" };
    frames[2].meta.serves = { projectId: "board2", cardId: "s9" };
    const card = makeCardNode(newCard("solution", { title: "x" }));
    card.meta.serves = { projectId: "board1", cardId: "s1" };
    for (const n of [...frames, card]) {
      d.nodes[n.id] = n;
      d.roots.push(n.id);
    }
    expect(servesSummary(d)).toEqual([
      { projectId: "board1", cardId: "s1", frames: 2, first: frames[0].id },
      { projectId: "board2", cardId: "s9", frames: 1, first: frames[2].id },
    ]);
  });
});
