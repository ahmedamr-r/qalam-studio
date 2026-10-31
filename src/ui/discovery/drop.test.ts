import { beforeEach, describe, expect, it } from "vitest";
import { studio, useStudio } from "@/doc/store";
import { emptyDoc } from "@/doc/schema";
import { addCardIn, cardOf, makeCardNode, newCard } from "@/discovery/ops";
import type { SourceRecord } from "@/discovery/sources";
import { attachQuoteRefs, attachQuotes } from "./drop";
import { useSources } from "./sources";

const q = (id: string, text: string, at: number) => ({ id, text, span: [at, at + text.length] as [number, number], kind: "pain" as const, addedBy: "ai" as const, at: 0 });
const SOURCE: SourceRecord = { v: 1, id: "tickets", projectId: "", kind: "text", title: "tickets.csv", text: "", addedAt: 0, read: [], needs: [], quotes: [q("a", "Pins land mid-compound", 0), q("b", "Security won't let me in", 30), q("c", "Long pickups aren't paid", 60)] };

let problem = "";
beforeEach(() => {
  const doc = emptyDoc();
  const outcome = makeCardNode(newCard("outcome", { title: "Cut cancellations" }));
  addCardIn(doc, outcome, null);
  const p = makeCardNode(newCard("opportunity", { title: "Drivers can't reach riders in compounds" }));
  addCardIn(doc, p, outcome.id);
  problem = p.id;
  useStudio.setState({ doc, selection: [], past: [], future: [], txBase: null });
  useSources.setState({ list: [SOURCE], visiting: [] });
});

describe("a cord's quotes onto a card", () => {
  it("attaches the picked quotes in one step, and one undo takes them all back", () => {
    expect(attachQuotes(problem, "tickets", ["a", "b"])).toBe(2);
    expect(cardOf(studio().doc, problem)!.evidence.map((e) => e.piece)).toEqual(["hub:quote:a", "hub:quote:b"]);
    studio().undo();
    expect(cardOf(studio().doc, problem)!.evidence).toEqual([]);
  });

  it("leaves out what's on the card already, and attaches nothing to a card that can't take quotes", () => {
    attachQuotes(problem, "tickets", ["a"]);
    expect(attachQuotes(problem, "tickets", ["a", "c"])).toBe(1);
    const outcome = studio().doc.roots[0];
    expect(attachQuotes(outcome, "tickets", ["a"])).toBe(0);
  });
});

describe("quotes found in the organization onto a card", () => {
  const OTHER: SourceRecord = { ...SOURCE, id: "calls", title: "calls.txt", quotes: [q("z", "The driver called four times", 0)] };

  it("attaches the picked quotes from several sources in one step, each once, and one undo takes them back", () => {
    useSources.setState({ list: [SOURCE, OTHER], visiting: [] });
    const past = studio().past.length;
    expect(attachQuoteRefs(problem, [{ sourceId: "tickets", quoteId: "b" }, { sourceId: "calls", quoteId: "z" }, { sourceId: "calls", quoteId: "z" }, { sourceId: "gone", quoteId: "x" }])).toBe(2);
    expect(cardOf(studio().doc, problem)!.evidence.map((e) => e.piece)).toEqual(["hub:quote:b", "hub:quote:z"]);
    expect(studio().past.length).toBe(past + 1);
    studio().undo();
    expect(cardOf(studio().doc, problem)!.evidence).toEqual([]);
  });
});
