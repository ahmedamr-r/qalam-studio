import { describe, expect, it } from "vitest";
import type { SourceQuote } from "@/discovery/sources";
import type { OstCard } from "@/discovery/types";
import { boardFromSetup, needFor, titleOf } from "./setup-board";
import type { SetupLine } from "./setup";

const TEXT = "A planner that builds the week's meals from what the family already buys. Parents rebuild the shopping list every Sunday. Picky kids mean two dinners. 1,000 families by March.";
const q = (id: string, words: string, role: SourceQuote["role"]): SourceQuote => {
  const at = TEXT.indexOf(words);
  return { id, text: words, span: [at, at + words.length], kind: "need", role, addedBy: "ai", at: 0 } as SourceQuote;
};
const QUOTES = [
  q("idea", "A planner that builds the week's meals from what the family already buys", "idea"),
  q("list", "Parents rebuild the shopping list every Sunday", "need"),
  q("kids", "Picky kids mean two dinners", "need"),
  q("goal", "1,000 families by March", "goal"),
];
const source = { id: "dump1", title: "About Weekly meals", kind: "dump" as const, quotes: QUOTES };
const line = (id: string, pieces: string[]): SetupLine => ({ id, to: "org", field: "goals", text: id, pieces, answers: [], why: "" });
const cardsOf = (doc: ReturnType<typeof boardFromSetup>["doc"]) =>
  Object.values(doc.nodes).flatMap((n) => {
    const c = (n.meta as { ost?: OstCard } | undefined)?.ost;
    return c ? [{ id: n.id, parent: n.parentId, kind: c.kind, title: c.title, pieces: c.evidence.map((e) => e.piece), by: c.createdBy }] : [];
  });

describe("a board started from the setup", () => {
  it("puts the goal on top, the problems it rests on under it, and the idea under the problem it answers", () => {
    const goal = { line: line("g1", ["goal", "list"]), title: "1,000 families plan with us by March" };
    const b = boardFromSetup({ source, session: { proposal: { summary: "", products: [], lines: [goal.line] } }, goal, now: 1 });
    const cards = cardsOf(b.doc);
    const outcome = cards.find((c) => c.kind === "outcome")!;
    expect(outcome).toMatchObject({ title: "1,000 families plan with us by March", parent: null, pieces: ["hub:quote:goal", "hub:quote:list"] });
    // Its own problem, and the one no goal took.
    expect(cards.filter((c) => c.kind === "opportunity").map((c) => [c.title, c.parent, c.pieces])).toEqual([
      ["Parents rebuild the shopping list every Sunday", outcome.id, ["hub:quote:list"]],
      ["Picky kids mean two dinners", outcome.id, ["hub:quote:kids"]],
    ]);
    const idea = cards.find((c) => c.kind === "solution")!;
    expect(cards.find((c) => c.id === idea.parent)?.title).toBe("Parents rebuild the shopping list every Sunday");
    expect(idea.pieces).toEqual(["hub:quote:idea"]);
    // Their words: theirs.
    expect(new Set(cards.map((c) => c.by))).toEqual(new Set(["user"]));
    expect(b.doc.roots).toEqual([outcome.id]);
  });

  it("leaves another goal's problems to its own board", () => {
    const g1 = line("g1", ["goal"]);
    const g2 = line("g2", ["kids"]);
    const b = boardFromSetup({ source, session: { proposal: { summary: "", products: [], lines: [g1, g2] } }, goal: { line: g1, title: "g1" } });
    expect(cardsOf(b.doc).filter((c) => c.kind === "opportunity").map((c) => c.title)).toEqual(["Parents rebuild the shopping list every Sunday"]);
  });

  it("with no goal, starts from the problems; with no problems, the idea waits on a sticky", () => {
    const top = boardFromSetup({ source, session: { proposal: undefined }, goal: null });
    expect(top.outcome).toBeNull();
    expect(top.doc.roots).toEqual(top.problems);
    // Side by side, never on top of each other.
    const xs = top.problems.map((id) => top.doc.nodes[id].x);
    expect(new Set(xs).size).toBe(xs.length);
    expect(xs[1] - xs[0]).toBeGreaterThan(500);
    const bare = boardFromSetup({ source: { ...source, quotes: QUOTES.filter((x) => x.role !== "need") }, session: { proposal: undefined }, goal: null });
    expect(cardsOf(bare.doc)).toEqual([]);
    const sticky = bare.doc.nodes[bare.ideas[0]];
    const text = bare.doc.nodes[(sticky as { children: string[] }).children[0]] as { text: { content: string } };
    expect(text.text.content).toBe("Your idea: A planner that builds the week's meals from what the family already buys");
  });

  it("takes what customers said as problems, and at the idea door what they wrote as the idea when nothing was read as one", () => {
    const SAID = "A planner for parents.";
    const text = `${SAID}\n\nFrom this computer: notes.md\n\nSara: Every Sunday I rebuild the list.`;
    const at = (w: string) => [text.indexOf(w), text.indexOf(w) + w.length] as [number, number];
    const quotes = [
      { id: "ctx", text: "A planner for parents", span: at("A planner for parents"), kind: "need", role: "context", addedBy: "ai", at: 0 },
      { id: "sara", text: "Every Sunday I rebuild the list.", span: at("Every Sunday I rebuild the list."), kind: "need", role: "evidence", addedBy: "ai", at: 0 },
    ] as SourceQuote[];
    const session = { proposal: undefined, idea: true as const, said: SAID, docs: [{ from: "said", title: "Your words", span: at(SAID) }, { from: "computer", title: "notes.md", span: [text.indexOf("Sara"), text.length] as [number, number] }] };
    const b = boardFromSetup({ source: { ...source, text, quotes }, session, goal: null });
    const cards = cardsOf(b.doc);
    expect(cards.map((c) => [c.kind, c.title, c.pieces])).toEqual([
      ["opportunity", "Every Sunday I rebuild the list.", ["hub:quote:sara"]],
      ["solution", "A planner for parents.", ["hub:quote:ctx"]],
    ]);
    // Not the idea door: what they wrote isn't taken as an idea.
    expect(cardsOf(boardFromSetup({ source: { ...source, text, quotes }, session: { ...session, idea: undefined }, goal: null }).doc).map((c) => c.kind)).toEqual(["opportunity"]);
  });

  it("finds the need an idea shares the most words with, and titles long words by their first sentence", () => {
    expect(needFor({ text: "Kids who are picky get one dinner" }, [{ text: "Lists take an hour" }, { text: "Picky kids mean two dinners" }])).toBe(1);
    expect(needFor({ text: "Something else" }, [{ text: "Lists" }, { text: "Kids" }])).toBe(0);
    expect(titleOf("Short words.")).toBe("Short words.");
    expect(titleOf(`${"a ".repeat(30)}end. ${"b ".repeat(100)}`)).toBe(`${"a ".repeat(30).trim()} end.`);
    expect(titleOf("word ".repeat(80)).endsWith("…")).toBe(true);
  });
});
