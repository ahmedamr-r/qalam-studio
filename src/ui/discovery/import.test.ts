import { beforeEach, describe, expect, it } from "vitest";
import { studio, useStudio } from "@/doc/store";
import { emptyDoc } from "@/doc/schema";
import { addCardIn, makeCardNode, newCard } from "@/discovery/ops";
import type { SourceRecord } from "@/discovery/sources";
import { productLine, synthesizeInput } from "./import";

beforeEach(() => useStudio.setState({ doc: emptyDoc(), selection: [], past: [], future: [], txBase: null }));

const source = (id: string, kind: SourceRecord["kind"], words: string): SourceRecord => ({
  v: 1,
  id,
  projectId: "p",
  kind,
  title: id,
  text: words,
  addedAt: 1,
  read: [],
  quotes: [{ id: `${id}-q`, text: words, span: [0, words.length], kind: "need", addedBy: "ai", at: 1 }],
  needs: [],
});

function tree() {
  const goal = makeCardNode(newCard("outcome", { title: "2M a month in orders" }));
  const sub = makeCardNode(newCard("outcome", { title: "More customers reorder every week", metric: { name: "Weekly reorders", direction: "increase", baseline: null, current: null, target: null } }));
  const need = makeCardNode(newCard("opportunity", { title: "I forget to reorder" }));
  studio().mutate((d) => {
    addCardIn(d, goal, null);
    addCardIn(d, sub, goal.id);
    addCardIn(d, need, sub.id);
  });
}

describe("mapping sources to the tree", () => {
  it("never sends a brain dump's words as customers' quotes", () => {
    tree();
    const { body } = synthesizeInput(studio().doc, [source("notes", "paste", "I can never find my usual milk"), source("dump", "dump", "parents hate substitutions")]);
    expect(body.quotes.map((q) => q.text)).toEqual(["I can never find my usual milk"]);
  });

  it("maps what customers said in the organization's other sources after the board's own new quotes", () => {
    tree();
    const own = source("notes", "paste", "I can never find my usual milk");
    const other = source("layla", "interview", "Then I forgot the app existed");
    const { body, ctx } = synthesizeInput(studio().doc, [own], [{ s: other, q: other.quotes[0] }, { s: own, q: own.quotes[0] }]);
    expect(body.quotes.map((q) => [q.id, q.text, q.source])).toEqual([
      ["q1", "I can never find my usual milk", "notes"],
      ["q2", "Then I forgot the app existed", "layla"],
    ]);
    expect(ctx.quotes[1]).toMatchObject({ ref: "q2", sourceId: "layla", quoteId: "layla-q" });
  });

  it("knows a quote a card already rests on by its piece, even where its place in the source isn't kept", () => {
    tree();
    const other = source("layla", "interview", "Then I forgot the app existed");
    const need = studio().doc.roots.flatMap((r) => Object.values(studio().doc.nodes).filter((n) => n.meta.ost?.kind === "opportunity" && n.id !== r))[0];
    studio().mutate((d) => void d.nodes[need.id].meta.ost!.evidence.push({ id: "e1", kind: "quote", text: other.quotes[0].text, sourceId: "layla", piece: "hub:quote:layla-q", addedBy: "ai", at: 1 }));
    const { body, ctx } = synthesizeInput(studio().doc, [], [{ s: other, q: other.quotes[0] }]);
    // Already on a card: not sent as new, and a proposal to attach it again is known for what it is.
    expect(body.quotes).toEqual([]);
    expect(ctx.has(need.id, { ref: "q1", sourceId: "layla", quoteId: "layla-q", span: [0, 5] })).toBe(true);
  });

  it("tells Qalam AI every outcome, sub-outcomes under theirs", () => {
    tree();
    expect(productLine(studio().doc)).toBe("The outcomes the team wants to move (sub-outcomes under theirs):\n- 2M a month in orders\n  - More customers reorder every week (Weekly reorders)");
  });
});
