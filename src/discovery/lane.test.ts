import { describe, expect, it } from "vitest";
import { emptyDoc } from "@/doc/schema";
import { LANE_GAP, LANE_ITEM_H, LANE_TILE, LANE_W, laneOf, litBy } from "./lane";
import { sourceTile } from "./look";
import { addCardIn, makeCardNode, newCard } from "./ops";
import { quoteEvidence, type SourceQuote, type SourceRecord } from "./sources";

// A dump the setup read (their words, then a Drive doc) and a Notion page.
const DUMP = "A planner for parents.\n\nFrom Google Drive: Pitch\n\nLists take an hour every Sunday. Kids want two dinners.";
const at = (text: string, words: string) => [text.indexOf(words), text.indexOf(words) + words.length] as [number, number];
const quote = (text: string, id: string, words: string): SourceQuote => ({ id, text: words, span: at(text, words), kind: "need", addedBy: "ai", at: 0 }) as SourceQuote;
const dump = {
  id: "dump1",
  title: "About Weekly meals",
  kind: "dump" as const,
  text: DUMP,
  quotes: [quote(DUMP, "q1", "A planner for parents"), quote(DUMP, "q2", "Lists take an hour every Sunday"), quote(DUMP, "q3", "Kids want two dinners")],
  setup: {
    v: 1 as const,
    phase: "done" as const,
    understanding: "",
    challenges: [],
    buckets: [],
    docs: [
      { from: "said", title: "Your words", span: at(DUMP, "A planner for parents.") },
      { from: "drive", title: "Pitch", type: "doc", span: [DUMP.indexOf("Lists"), DUMP.length] as [number, number] },
    ],
  },
} as unknown as SourceRecord & { text: string };
const NOTE = "Sara: I buy things twice.";
const notion = { id: "n1", title: "Sara call", kind: "connector" as const, origin: "https://www.notion.so/Sara-call-1", quotes: [quote(NOTE, "s1", "I buy things twice")] } as unknown as SourceRecord;

function board() {
  const doc = emptyDoc();
  const card = (kind: "outcome" | "opportunity", parent: string | null, y: number, evidence: ReturnType<typeof quoteEvidence>[]) => {
    const n = makeCardNode(newCard(kind, { title: kind, evidence }), { x: 0, y });
    n.h = 80;
    addCardIn(doc, n, parent);
    return n.id;
  };
  const goal = card("outcome", null, 0, [quoteEvidence(dump, dump.quotes[0], "user")]);
  const lists = card("opportunity", goal, 200, [quoteEvidence(dump, dump.quotes[1], "user"), quoteEvidence(notion, notion.quotes[0], "user")]);
  const kids = card("opportunity", goal, 400, [quoteEvidence(dump, dump.quotes[2], "user")]);
  return { doc, goal, lists, kids };
}

describe("a board's sources lane", () => {
  it("shows each source its cards rest on, a setup dump as its parts, wired to the cards with the quotes behind each wire", () => {
    const { doc, goal, lists, kids } = board();
    const lane = laneOf(doc, [dump, notion]);
    // In the order of what they back: the Pitch backs two problems, so it sits between them, below Sara's call.
    expect(lane.items.map((i) => [i.title, i.mark, i.line, i.cards.length])).toEqual([
      ["A planner for parents.", "said", "Your words", 1],
      ["Sara call", "notion", "Notion", 1],
      ["Pitch", "drive", "Google Drive · Doc", 2],
    ]);
    const pitch = lane.items.find((i) => i.title === "Pitch")!;
    expect(pitch.quotes).toEqual(["q2", "q3"]);
    expect(lane.edges.filter((e) => e.from === pitch.key).map((e) => [e.to, e.quotes])).toEqual([
      [lists, ["q2"]],
      [kids, ["q3"]],
    ]);
    expect(lane.edges.find((e) => e.to === goal)?.quotes).toEqual(["q1"]);
  });

  it("sits left of its tree, each source level with what it backs, none overlapping", () => {
    const { doc } = board();
    const lane = laneOf(doc, [dump, notion]);
    for (const i of lane.items) expect(i.x).toBe(0 - LANE_GAP - LANE_W);
    const ys = lane.items.map((i) => i.y);
    for (let k = 1; k < ys.length; k++) expect(ys[k]).toBeGreaterThanOrEqual(ys[k - 1] + LANE_ITEM_H);
    // Their words back the goal at the top: they're first, the tile level with it, its port on the right.
    expect(lane.items[0].y).toBe(40 - LANE_TILE / 2);
    expect(sourceTile(lane.items[0]).port).toEqual({ x: 0 - LANE_GAP - (LANE_W - LANE_TILE) / 2, y: 40 });
  });

  it("lights a source's wires and the cards at their ends, or a card's sources", () => {
    const { doc, lists } = board();
    const lane = laneOf(doc, [dump, notion]);
    const notionItem = lane.items.find((i) => i.mark === "notion")!;
    expect([...litBy(lane, notionItem.key)!.cards]).toEqual([lists]);
    expect(litBy(lane, lists)!.items.size).toBe(2);
    expect(litBy(lane, "nothing")).toBeNull();
  });

  it("has nothing for a board whose cards rest on no source", () => {
    const doc = emptyDoc();
    addCardIn(doc, makeCardNode(newCard("outcome", { title: "Goal" })), null);
    expect(laneOf(doc, [dump])).toEqual({ items: [], edges: [] });
  });
});
