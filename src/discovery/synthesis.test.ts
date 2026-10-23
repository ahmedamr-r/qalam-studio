import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { emptyDoc, type Doc } from "@/doc/schema";
import { isOstCard } from "@/doc/board";
import { addCardIn, makeCardNode, newCard } from "./ops";
import { layoutDocTrees } from "./pass";
import { isAssumed } from "./evidence";
import { quoteEvidence, type SourceQuote } from "./sources";
import { applyProposal, proposalDoc, sanitizeExtract, sanitizeSynthesis, type CallChunk, type EvidenceOf, type Proposal, type SynthCard, type SynthContext, type SynthQuote } from "./synthesis";

// ---------------------------------------------------------------------------
// Extract

const A = "Interview with P3, ops lead.\nQ: How do you reorder?\nP3: I never know when the driver will turn up. Sometimes it's an hour late, so I just stopped ordering for lunch.\n";
// The second chunk of source B starts 1000 characters into its text.
const B = "Survey answer 14: The prices change every week and I can't keep track of what I paid last time. I'd love a price history.";

const chunks: CallChunk[] = [
  { ref: "c1", sourceId: "a", start: 0, text: A, pages: [0, 50] },
  { ref: "c2", sourceId: "b", start: 1000, text: B },
];

describe("sanitizeExtract", () => {
  const raw = {
    quotes: [
      { id: "q1", chunkId: "c1", text: "I never know when the driver will turn up.", speaker: "P3", kind: "pain" },
      // Named the wrong part: the words are in c2.
      { id: "q2", chunkId: "c1", text: "I can't keep track of what I paid last time", speaker: null, kind: "pain" },
      // Not in the material at all.
      { id: "q3", chunkId: "c2", text: "Delivery is always late and the app crashes", speaker: null, kind: "pain" },
      // Words left out, in the second source's chunk.
      { id: "q4", chunkId: "c2", text: "The prices change every week … I'd love a price history", speaker: "Respondent 14", kind: "desire" },
      // Overlaps q1.
      { id: "q5", chunkId: "c1", text: "will turn up. Sometimes it's an hour late", speaker: null, kind: "pain" },
      { id: "q6", chunkId: "c1", text: "so I just stopped ordering for lunch", speaker: "p3", kind: "nonsense" },
      { id: "q7", chunkId: "c9", text: "I never know when the driver will turn up.", speaker: null, kind: "pain" },
      { id: "q8", chunkId: "c1", text: "x".repeat(700), speaker: null, kind: "pain" },
    ],
    needs: [
      { title: "I can't tell when my order will arrive", quoteIds: ["q1", "q3"] },
      { title: "Something nobody said", quoteIds: ["q3"] },
      { title: "I can't tell when my order will arrive!", quoteIds: ["q6"] },
      { title: "I want to keep track of what I pay", quoteIds: ["q4", "q6"] },
    ],
  };
  const got = sanitizeExtract(raw, chunks, new Map(), 7);
  const words = got.quotes.map((q) => q.quote.text);

  it("keeps only quotes found word for word in the part they name, with the source's words", () => {
    expect(words).toEqual(["I never know when the driver will turn up.", "The prices change every week … I'd love a price history", "so I just stopped ordering for lunch"]);
  });

  it("places each quote in its whole source, parts too, with its page", () => {
    const [q1, q4] = got.quotes;
    expect(A.slice(q1.quote.span[0], q1.quote.span[1])).toBe("I never know when the driver will turn up.");
    expect(q1.quote.page).toBe(2);
    expect(q4.sourceId).toBe("b");
    expect(q4.quote.span[0]).toBe(1000 + B.indexOf("The prices"));
    expect(q4.quote.parts!.map(([a, b]) => B.slice(a - 1000, b - 1000))).toEqual(["The prices change every week", "I'd love a price history"]);
  });

  it("keeps a speaker only as the source names them, and a sensible kind", () => {
    const [q1, q4, q6] = got.quotes.map((q) => q.quote);
    expect(q1.speaker).toBe("P3");
    expect(q4.speaker).toBeUndefined();
    expect(q6.speaker).toBe("P3");
    expect(q1.kind).toBe("pain");
    expect(q6.kind).toBe("need");
    expect(got.quotes.every((q) => q.quote.addedBy === "ai" && q.quote.at === 7)).toBe(true);
  });

  it("keeps needs only with kept quotes, once each, filed under their quotes' sources", () => {
    const ids = new Map(got.quotes.map((q, i) => [q.quote.id, ["q1", "q4", "q6"][i]]));
    expect(got.needs.map((n) => [n.sourceId, n.need.title, n.need.quoteIds.map((id) => ids.get(id))])).toEqual([
      ["a", "I can't tell when my order will arrive", ["q1"]],
      ["b", "I want to keep track of what I pay", ["q4"]],
      ["a", "I want to keep track of what I pay", ["q6"]],
    ]);
  });

  it("doesn't keep a quote twice where the source already has one", () => {
    const at = A.indexOf("I never know");
    const again = sanitizeExtract(raw, chunks, new Map([["a", [[at, at + 10] as [number, number]]]]));
    expect(again.quotes.map((q) => q.quote.text)).not.toContain("I never know when the driver will turn up.");
  });

  it("survives output that isn't what was asked for", () => {
    expect(sanitizeExtract(null, chunks)).toEqual({ quotes: [], needs: [] });
    expect(sanitizeExtract({ quotes: "lots", needs: [{ quoteIds: "q1" }] }, chunks)).toEqual({ quotes: [], needs: [] });
  });
});

// ---------------------------------------------------------------------------
// Synthesize

const card = (ref: string, kind: SynthCard["kind"], title: string, parentRef: string | null, depth = 0, childTitles: string[] = []): SynthCard => ({ ref, id: `id-${ref}`, kind, title, parentRef, depth, childTitles });
const cards: SynthCard[] = [
  card("c1", "outcome", "More customers reorder every week", null, 0, ["I can't tell when my order arrives", "Prices confuse me"]),
  card("c2", "opportunity", "I can't tell when my order arrives", "c1", 1, ["Live tracking"]),
  card("c3", "solution", "Live tracking", "c2", 0, ["Fake-door test"]),
  card("c4", "opportunity", "Prices confuse me", "c1", 1, ["Deeper"]),
  card("c5", "opportunity", "Deeper", "c4", 2, ["Deepest"]),
  card("c6", "opportunity", "Deepest", "c5", 3),
  card("c7", "test", "Fake-door test", "c3"),
];
const quotes: SynthQuote[] = ["q1", "q2", "q3"].map((ref, i) => ({ ref, sourceId: "s", quoteId: `quote-${ref}`, span: [i * 100, i * 100 + 50] }));
const ctx = (has: SynthContext["has"] = () => false): SynthContext => ({ cards, quotes, outcomeRef: "c1", has });

describe("sanitizeSynthesis", () => {
  it("maps quotes only to opportunities and solutions on the tree, once each", () => {
    const out = sanitizeSynthesis(
      {
        mappings: [
          { quoteId: "q1", cardId: "c2", why: "  timing  " },
          { quoteId: "q1", cardId: "c2", why: "again" },
          { quoteId: "q2", cardId: "c3", why: "asks for it" },
          { quoteId: "q2", cardId: "c1", why: "outcome" },
          { quoteId: "q2", cardId: "c7", why: "a test" },
          { quoteId: "q9", cardId: "c2", why: "no such quote" },
          { quoteId: "q3", cardId: "c99", why: "no such card" },
        ],
      },
      ctx(),
    );
    expect(out.map((p) => (p.kind === "opportunity" ? p.title : [p.kind, p.cardId, p.quote.quoteId, p.why]))).toEqual([
      ["attach", "id-c2", "quote-q1", "timing"],
      ["attach", "id-c3", "quote-q2", "asks for it"],
    ]);
  });

  it("leaves out words the card already has or the builder discarded for it, and caps how many quotes a card gets", () => {
    expect(sanitizeSynthesis({ mappings: [{ quoteId: "q1", cardId: "c2", why: "" }] }, ctx((id, q) => id === "id-c2" && q.ref === "q1"))).toEqual([]);
    const dismissed = { ...ctx(), quotes: quotes.map((q) => (q.ref === "q1" ? { ...q, dismissed: ["id-c2"] } : q)) };
    expect(sanitizeSynthesis({ mappings: [{ quoteId: "q1", cardId: "c2", why: "" }, { quoteId: "q1", cardId: "c3", why: "" }], contradictions: [{ quoteId: "q1", cardId: "c2", why: "" }] }, dismissed).map((p) => p.cardId)).toEqual(["id-c3"]);
    const many: SynthQuote[] = Array.from({ length: 9 }, (_, i) => ({ ref: `q${i}`, sourceId: "s", quoteId: `x${i}`, span: [i, i + 1] }));
    const out = sanitizeSynthesis({ mappings: many.map((q) => ({ quoteId: q.ref, cardId: "c2", why: "" })) }, { ...ctx(), quotes: many });
    expect(out).toHaveLength(6);
  });

  it("adds an opportunity only on quotes, under the outcome or an opportunity, without repeating a card", () => {
    const out = sanitizeSynthesis(
      {
        newOpportunities: [
          { id: "n1", parent: "c1", title: "I don't trust the substitutions", description: "Swaps arrive unannounced.", quoteIds: ["q2", "q2", "q9"], why: "new" },
          { id: "n2", parent: "c1", title: "Nobody said this", description: "", quoteIds: ["q9"], why: "" },
          { id: "n3", parent: "c1", title: "I can't tell when my order arrives!", description: "", quoteIds: ["q1"], why: "" },
          { id: "n4", parent: "c3", title: "Under a solution", description: "", quoteIds: ["q1"], why: "" },
          { id: "n5", parent: "c6", title: "Too deep for the tree", description: "", quoteIds: ["q3"], why: "" },
          { id: "n6", parent: "zz", title: "Somewhere unknown", description: "", quoteIds: ["q3"], why: "" },
          { id: "n7", parent: "c1", title: "I don't trust the substitutions.", description: "", quoteIds: ["q3"], why: "" },
        ],
      },
      ctx(),
    );
    const made = out.filter((p): p is Extract<Proposal, { kind: "opportunity" }> => p.kind === "opportunity");
    expect(made.map((p) => [p.title, p.parentId, p.quotes.map((q) => q.quoteId)])).toEqual([
      ["I don't trust the substitutions", "id-c1", ["quote-q2"]],
      ["Under a solution", "id-c1", ["quote-q1"]],
      ["Too deep for the tree", "id-c5", ["quote-q3"]],
      ["Somewhere unknown", "id-c1", ["quote-q3"]],
    ]);
    expect(made[0].description).toBe("Swaps arrive unannounced.");
    expect(new Set(made.map((p) => p.cardId)).size).toBe(4);
  });

  it("notes words against a card, but not the same words it proposes as backing", () => {
    const out = sanitizeSynthesis(
      {
        mappings: [{ quoteId: "q1", cardId: "c2", why: "backs it" }],
        contradictions: [
          { quoteId: "q1", cardId: "c2", why: "both ways" },
          { quoteId: "q3", cardId: "c4", why: "they read prices fine" },
          { quoteId: "q3", cardId: "c1", why: "outcome" },
        ],
      },
      ctx(),
    );
    expect(out.map((p) => (p.kind === "opportunity" ? "" : `${p.kind}:${p.cardId}:${p.quote.quoteId}`))).toEqual(["attach:id-c2:quote-q1", "against:id-c4:quote-q3"]);
  });

  it("returns nothing for output that isn't what was asked for", () => {
    expect(sanitizeSynthesis(undefined, ctx())).toEqual([]);
    expect(sanitizeSynthesis({ mappings: {}, newOpportunities: "x" }, ctx())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Proposals on the board

function board() {
  const outcome = makeCardNode(newCard("outcome", { title: "More weekly reorders" }), { x: 0, y: 0 });
  const opp = makeCardNode(newCard("opportunity", { title: "I can't tell when my order arrives", createdBy: "ai" }));
  const sol = makeCardNode(newCard("solution", { title: "Live tracking" }));
  const doc = produce(emptyDoc(), (d) => {
    addCardIn(d, outcome, null);
    addCardIn(d, opp, outcome.id);
    addCardIn(d, sol, opp.id);
  });
  return { doc: layoutDocTrees(doc), outcome: outcome.id, opp: opp.id, sol: sol.id };
}

const sq: SourceQuote = { id: "q1", text: "I never know when the driver will turn up", span: [5, 46], kind: "pain", addedBy: "ai", at: 1 };
const evidenceOf: EvidenceOf = (q, against) => (q.quoteId === "q1" ? quoteEvidence({ id: q.sourceId, title: "Interviews.pdf" }, sq, "ai", { against, now: 1 }) : null);

describe("proposals", () => {
  it("draw the tree as it would be: changed and new cards fresh, the rest exactly as they are", () => {
    const b = board();
    const proposals: Proposal[] = [
      { id: "p1", kind: "attach", cardId: b.opp, quote: { sourceId: "s", quoteId: "q1" }, why: "" },
      { id: "p2", kind: "opportunity", cardId: "new-card", parentId: b.outcome, title: "Prices confuse me", quotes: [{ sourceId: "s", quoteId: "q1" }], why: "" },
    ];
    const g = proposalDoc(b.doc, b.outcome, proposals, evidenceOf)!;
    expect(g.roots).toEqual([b.outcome]);
    // Untouched cards keep their data object: drawn as they are.
    expect(g.nodes[b.sol].meta.ost).toBe(b.doc.nodes[b.sol].meta.ost);
    expect(g.nodes[b.outcome].meta.ost).toBe(b.doc.nodes[b.outcome].meta.ost);
    // The card a quote would back changes (and stops being Assumed).
    expect(g.nodes[b.opp].meta.ost).not.toBe(b.doc.nodes[b.opp].meta.ost);
    expect(isAssumed(b.doc.nodes[b.opp].meta.ost!)).toBe(true);
    expect(isAssumed(g.nodes[b.opp].meta.ost!)).toBe(false);
    // The new card is there, under the outcome, with its id, backed, laid out beside its sibling.
    const added = g.nodes["new-card"];
    expect(isOstCard(added) && added.meta.ost.title).toBe("Prices confuse me");
    expect(added.parentId).toBe(b.outcome);
    expect(added.meta.ost!.evidence).toHaveLength(1);
    expect(added.x).not.toBe(g.nodes[b.opp].x);
    // The board itself is untouched.
    expect(b.doc.nodes[b.opp].meta.ost!.evidence).toHaveLength(0);
    expect(b.doc.nodes["new-card"]).toBeUndefined();
  });

  it("apply only where they still fit", () => {
    const b = board();
    const attach: Proposal = { id: "p1", kind: "attach", cardId: b.opp, quote: { sourceId: "s", quoteId: "q1" }, why: "" };
    let first = false;
    let second = true;
    let gone = true;
    let under = true;
    const after: Doc = produce(b.doc, (d) => {
      first = applyProposal(d, attach, evidenceOf);
      second = applyProposal(d, attach, evidenceOf);
      gone = applyProposal(d, { ...attach, quote: { sourceId: "s", quoteId: "deleted" } }, evidenceOf);
      under = applyProposal(d, { id: "p3", kind: "opportunity", cardId: "x", parentId: b.sol, title: "Under a solution", quotes: [attach.quote], why: "" }, evidenceOf);
    });
    expect([first, second, gone, under]).toEqual([true, false, false, false]);
    expect(after.nodes[b.opp].meta.ost!.evidence).toHaveLength(1);
    const against = produce(b.doc, (d) => void applyProposal(d, { ...attach, kind: "against" }, evidenceOf));
    expect(against.nodes[b.opp].meta.ost!.evidence[0].stance).toBe("against");
    // Words against an Assumed card don't make it solid.
    expect(isAssumed(against.nodes[b.opp].meta.ost!)).toBe(true);
  });
});
