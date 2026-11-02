import { describe, expect, it } from "vitest";
import { isEvidence } from "@/hub/topics";
import { basisCounts, basisOf, basisSub, countsLine, evidenceBasis, heldBasis, mainBasis, movedLines, pieceBasis, reachesKnow } from "./basis";
import { whose } from "./solutions";
import { quoteEvidence, type SourceQuote } from "./sources";
import { sanitizeExtract } from "./synthesis";

const quote = { id: "q", text: "x", span: [0, 1], kind: "finding", addedBy: "ai", at: 1 } as SourceQuote;

describe("what a point rests on", () => {
  it("reads what came before there was one as it always meant", () => {
    expect(basisOf({ kind: "pdf" }, quote)).toBe("said");
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
