import { describe, expect, it } from "vitest";
import { isEvidence } from "@/hub/topics";
import { basisCounts, basisOf, isPublic, basisSub, countsLine, evidenceBasis, heldBasis, mainBasis, movedLines, pieceBasis, reachesKnow } from "./basis";
import { solutionsMaterial, whose } from "./solutions";
import { quoteEvidence, type SourceQuote } from "./sources";
import { evidenceLabel, evidenceSummary, isAssumed } from "./evidence";
import { sanitizeExtract } from "./synthesis";
import { backingLine, thin, type CardFacts } from "./next";

const quote = { id: "q", text: "x", span: [0, 1], kind: "finding", addedBy: "ai", at: 1 } as SourceQuote;

describe("what a point rests on", () => {
  it("reads what came before there was one as it always meant", () => {
    expect(basisOf({ kind: "pdf" }, quote)).toBe("said");
    // Public words are read elsewhere, unless they say these are their own product's reviews.
    expect(basisOf({ kind: "post" }, { basis: "measured" })).toBe("read");
    expect(basisOf({ kind: "post", basis: "said" }, quote)).toBe("said");
    expect(isPublic({ kind: "post" })).toBe(true);
    expect(isPublic({ kind: "post", basis: "said" })).toBe(false);
    expect(isPublic({ kind: "pdf" })).toBe(false);
    expect(basisOf({ kind: "dump" }, quote)).toBe("own");
    expect(basisOf({ kind: "post" }, quote)).toBe("read");
    expect(pieceBasis({ sub: "pain" })).toBe("said");
    expect(pieceBasis({ sub: null })).toBe("said");
    expect(pieceBasis({ sub: "dump:goal" })).toBe("own");
    expect(pieceBasis({ sub: "online:need" })).toBe("read");
    expect(evidenceBasis({ kind: "quote" })).toBe("said");
    expect(evidenceBasis({ kind: "quote", online: true })).toBe("read");
    expect(evidenceBasis({ kind: "dump" })).toBe("own");
  });

  it("lets the person's word on a source win, except over what people online said", () => {
    expect(basisOf({ kind: "pdf", basis: "read" }, { basis: "measured" })).toBe("read");
    expect(basisOf({ kind: "pdf" }, { basis: "measured" })).toBe("measured");
    expect(basisOf({ kind: "post", basis: "measured" }, {})).toBe("read");
  });

  it("names itself in a piece's sub, what people said staying as it was", () => {
    expect(basisSub("said", "pain")).toBe("pain");
    for (const b of ["measured", "studied", "read", "own"] as const) expect(pieceBasis({ sub: basisSub(b, "finding") })).toBe(b);
  });

  it("reaches We know only for what people said, what's measured and what's studied", () => {
    expect((["said", "measured", "studied", "read", "own"] as const).filter(reachesKnow)).toEqual(["said", "measured", "studied"]);
    const of = (sub: string) => isEvidence({ type: "quote", sub });
    expect([of("pain"), of("measured:finding"), of("studied:finding"), of("read:finding"), of("own:finding"), of("dump:goal"), of("online:need")]).toEqual([true, true, true, false, false, false, false]);
  });

  it("holds a claim as far as code can", () => {
    expect(heldBasis("measured", "4 in 10 shoppers leave at payment")).toBe("measured");
    expect(heldBasis("measured", "٤ من ١٠ يتركون الدفع")).toBe("measured");
    expect(heldBasis("measured", "Most shoppers leave at payment")).toBe("own");
    expect(heldBasis("measured", "4 in 10 shoppers leave", "url")).toBe("read");
    expect(heldBasis("studied", "Shoppers missed the button", "url")).toBe("read");
    expect(heldBasis("read", "Anything", "interview")).toBe("said");
    expect(heldBasis("said", "I wait all day", "url")).toBe("said");
  });

  it("goes on a card with its words, only where it says more than the kind does", () => {
    const s = { id: "s", title: "Funnel" };
    expect(quoteEvidence({ ...s, kind: "text" }, { ...quote, basis: "measured" }, "ai").basis).toBe("measured");
    expect(quoteEvidence({ ...s, kind: "text" }, quote, "ai").basis).toBeUndefined();
    expect(quoteEvidence({ ...s, kind: "dump" }, quote, "ai").basis).toBeUndefined();
    expect(quoteEvidence({ ...s, kind: "post" }, quote, "ai")).toMatchObject({ online: true });
  });

  it("is never customers' in a draft unless they said it", () => {
    expect(whose({ evidence: true })).toBe("customers");
    expect(whose({ evidence: false })).toBe("the team");
    expect(whose({ evidence: false, online: true })).toBe("people online");
    expect(whose({ evidence: true, basis: "measured" })).toBe("measured");
    expect(whose({ evidence: true, basis: "studied" })).toBe("a study");
    expect(whose({ evidence: false, basis: "read" })).toBe("read elsewhere");
  });
});

describe("reading any document", () => {
  const text = "Checkout, Q3. Step: Payment · Users: 4,200 · Left: 41%. We think payment is confusing. Mona: I gave up when it asked again.";
  const chunks = [{ ref: "c1", sourceId: "a", start: 0, text, kind: "text" as const }];

  it("keeps each point's basis, what it is, and what code can hold", () => {
    const got = sanitizeExtract(
      {
        about: [{ chunkId: "c1", text: "A funnel report for checkout, Q3" }],
        quotes: [
          { id: "q1", chunkId: "c1", text: "Step: Payment · Users: 4,200 · Left: 41%.", kind: "finding", basis: "measured" },
          { id: "q2", chunkId: "c1", text: "We think payment is confusing.", kind: "finding", basis: "measured" },
          { id: "q3", chunkId: "c1", text: "I gave up when it asked again.", speaker: "Mona", kind: "pain", basis: "said" },
          { id: "q4", chunkId: "c1", text: "Checkout, Q3.", kind: "finding", basis: "nonsense" },
        ],
        needs: [{ title: "Four in ten leave at payment", quoteIds: ["q1"] }],
      },
      chunks,
    );
    expect(got.about).toEqual([{ sourceId: "a", text: "A funnel report for checkout, Q3" }]);
    expect(got.quotes.map((q) => q.quote.basis)).toEqual(["measured", "own", undefined, undefined]);
    expect(got.needs).toHaveLength(1);
  });

  it("keeps what a document is only where its numbers are in what was read, once per document", () => {
    const about = (t: string) => sanitizeExtract({ about: [{ chunkId: "c1", text: t }, { chunkId: "c1", text: "Second" }] }, chunks).about.map((a) => a.text);
    expect(about("A report on 41% leaving")).toEqual(["A report on 41% leaving"]);
    expect(about("A report on 77% leaving")).toEqual(["Second"]);
    // A full stop after a number isn't part of it.
    expect(about("A funnel report, 4,200.")).toEqual(["A funnel report, 4,200."]);
  });

  it("treats a fetched page's numbers as someone else's", () => {
    const got = sanitizeExtract({ quotes: [{ id: "q1", chunkId: "c1", text: "Step: Payment · Users: 4,200 · Left: 41%.", kind: "finding", basis: "measured" }] }, [{ ...chunks[0], kind: "url" as const }]);
    expect(got.quotes[0].quote.basis).toBe("read");
  });
});

describe("what a source holds", () => {
  const s = { kind: "text", quotes: [{ basis: "measured" as const }, { basis: "measured" as const }, {}, { basis: "own" as const }] };

  it("counts its points by what they rest on, and says so the most first", () => {
    expect(basisCounts(s)).toEqual({ measured: 2, said: 1, own: 1 });
    expect(mainBasis(basisCounts(s))).toBe("measured");
    expect(mainBasis({})).toBeNull();
    expect(countsLine(basisCounts(s))).toBe("2 measured points · 1 thing people said · 1 point of your own thinking");
    expect(basisCounts({ ...s, basis: "read" })).toEqual({ read: 4 });
  });
});

describe("a source's lines when what it rests on changes", () => {
  const line = (section: string, cites: string[], by = "qalam") => ({ section, cites, by });
  const mine = (r: string) => r.startsWith("m");

  it("moves what no longer stands to We believe, and what now does up, on this source's words", () => {
    const lines = [line("know", ["m1"]), line("know", ["m1", "other"]), line("believe", ["m2"]), line("believe", ["other2"])];
    // Now read elsewhere: only `other` still counts.
    expect(movedLines(lines, mine, (r) => r === "other")).toBe(true);
    expect(lines.map((l) => l.section)).toEqual(["believe", "know", "believe", "believe"]);
    // Measured after all: its own lines go back up.
    expect(movedLines(lines, mine, (r) => mine(r) || r === "other")).toBe(true);
    expect(lines.map((l) => l.section)).toEqual(["know", "know", "know", "believe"]);
  });

  it("never moves a person's line, what speaks against, or a question, and says when nothing moved", () => {
    const lines = [line("know", ["m1"], "person"), line("against", ["m1"]), line("open", ["m1"])];
    expect(movedLines(lines, mine, () => false)).toBe(false);
    expect(lines.map((l) => l.section)).toEqual(["know", "against", "open"]);
  });
});

describe("what a card rests on, with more than customers' words", () => {
  const at = 1;
  const e = (id: string, basis?: "measured" | "studied" | "read" | "own") => ({ id, kind: "quote" as const, text: id, sourceId: id, addedBy: "ai" as const, at, ...(basis ? { basis } : {}) });
  const card = (evidence: ReturnType<typeof e>[]) => ({ kind: "opportunity" as const, createdBy: "ai" as const, evidence });

  it("says what backs it", () => {
    expect(evidenceLabel(card([e("a"), e("b", "measured")]))).toBe("1 quote · 1 measured");
    expect(evidenceLabel(card([e("a", "studied"), e("b", "read")]))).toBe("1 studied · 1 read elsewhere");
    expect(evidenceLabel(card([e("a")]))).toBe("1 quote");
    expect(evidenceSummary(card([e("a"), e("b", "measured"), e("c", "own"), e("d", "read")]))).toMatchObject({ quotes: 2, sources: 2, mix: { said: 1, measured: 1 }, ours: 1, read: 1 });
  });

  it("leaves a card only read about Assumed, and a measured one not", () => {
    expect(isAssumed(card([e("a", "read")]))).toBe(true);
    expect(evidenceLabel(card([e("a", "read")]))).toBe("Assumed · 1 read elsewhere");
    expect(isAssumed(card([e("a", "measured")]))).toBe(false);
  });

  it("doesn't call a card nothing but customers' words back thin, nor say it's bare with a metric behind it", () => {
    const facts = (over: Partial<CardFacts["evidence"]>) => ({ kind: "opportunity", evidence: { quotes: 0, sources: 0, ours: 0, online: 0, against: 0, who: [], from: [], ...over }, page: null, goal: null, feeds: [] }) as unknown as CardFacts;
    expect(thin(facts({ quotes: 1, sources: 1, mix: { measured: 1 } }))).toBe(false);
    expect(backingLine(facts({ quotes: 2, sources: 2, mix: { measured: 1, said: 1 } }))).toBe("Rests on 1 quote · 1 measured from 2 sources");
    expect(backingLine(facts({ read: 1 }))).toBe("Only read elsewhere: 1");
  });
});

describe("a goal's number from a document", () => {
  const text = "Checkout, Q3. Step: Payment · Users: 4,200 · Left: 41%. We think payment is confusing.";
  const chunks = [{ ref: "c1", sourceId: "a", start: 0, text, kind: "text" as const }];
  const raw = (goalNumbers: unknown[], basis = "measured") => ({ quotes: [{ id: "q1", chunkId: "c1", text: "Step: Payment · Users: 4,200 · Left: 41%.", kind: "finding", basis }], goalNumbers });
  const got = (r: unknown) => sanitizeExtract(r, chunks, new Map(), 1, new Map([["g1", "goal-a"]])).goalNumbers;

  it("keeps it only for a goal it was sent, on a measured point that has that number", () => {
    expect(got(raw([{ goal: "g1", value: 4200, quoteId: "q1" }]))).toMatchObject([{ sourceId: "a", number: { goal: "goal-a", value: 4200 } }]);
    expect(got(raw([{ goal: "g1", value: 41, quoteId: "q1" }]))).toHaveLength(1);
    expect(got(raw([{ goal: "g1", value: 9999, quoteId: "q1" }]))).toEqual([]);
    expect(got(raw([{ goal: "g9", value: 4200, quoteId: "q1" }]))).toEqual([]);
    expect(got(raw([{ goal: "g1", value: 4200, quoteId: "q9" }]))).toEqual([]);
    expect(got(raw([{ goal: "g1", value: 4200, quoteId: "q1" }], "read"))).toEqual([]);
    expect(got(raw([{ goal: "g1", value: 4200, quoteId: "q1" }, { goal: "g1", value: 41, quoteId: "q1" }]))).toHaveLength(1);
  });
});

describe("a draft's material", () => {
  it("says whose each piece is, a metric never customers'", () => {
    const m = solutionsMaterial({
      problem: { title: "Leaving at payment", topic: null },
      lines: [],
      pieces: [
        { ref: "a", text: "Payment: 41% left", label: "Funnel", source: "s", evidence: true, basis: "measured" },
        { ref: "b", text: "I gave up", label: "Mona", source: "m", evidence: true, basis: "said" },
        { ref: "c", text: "62% abandon", label: "Northwind", source: "n", evidence: false, basis: "read" },
      ],
      goals: [],
      claims: [],
      steps: [],
      cards: [],
      ideas: [],
    } as never);
    expect(m.text).toContain("· measured · Funnel");
    expect(m.text).toContain("· customers · Mona");
    expect(m.text).toContain("· read elsewhere · Northwind");
  });
});
