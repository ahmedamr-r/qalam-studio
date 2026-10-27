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

  it("tells Qalam AI every outcome, sub-outcomes under theirs", () => {
    tree();
    expect(productLine(studio().doc)).toBe("The outcomes the team wants to move (sub-outcomes under theirs):\n- 2M a month in orders\n  - More customers reorder every week (Weekly reorders)");
  });
});
