import { describe, expect, it } from "vitest";
import {
  DiscoveryBody,
  EXTRACT_MAX_CHARS,
  FOLLOWUPS_SCHEMA,
  draftContent,
  draftSchema,
  dumpFollowupContent,
  dumpFollowupSchema,
  dumpOutline,
  dumpPlaceContent,
  dumpPlaceSchema,
  dumpReadContent,
  dumpReadSchema,
  extractContent,
  extractSchema,
  knowledgeBlock,
  KNOWLEDGE_NOTE,
  placeIds,
  quotableIds,
  synthesizeContent,
  synthesizeIds,
  synthesizeSchema,
  withKnowledge,
  withPieceReliance,
} from "./discovery";
import { SAMPLE_ANSWERS, SAMPLE_DUMP_TEXT } from "./fixtures-discovery";

/** Structured outputs need every property required and no open objects. */
function openRequired(node: unknown, path = "#"): string[] {
  if (!node || typeof node !== "object") return [];
  const o = node as Record<string, unknown>;
  const out: string[] = [];
  if (o.type === "object") {
    const keys = Object.keys(o.properties as object).sort();
    if (JSON.stringify(keys) !== JSON.stringify([...(o.required as string[])].sort()) || o.additionalProperties !== false) out.push(path);
  }
  for (const [k, v] of Object.entries(o)) {
    if (Array.isArray(v)) v.forEach((x, i) => out.push(...openRequired(x, `${path}.${k}[${i}]`)));
    else out.push(...openRequired(v, `${path}.${k}`));
  }
  return out;
}

type Props = Record<string, { items?: { properties: Record<string, { enum?: string[]; anyOf?: { enum?: string[] }[] }> } }>;

describe("Discovery requests", () => {
  it("schemas require every property", () => {
    expect(openRequired(FOLLOWUPS_SCHEMA)).toEqual([]);
    expect(openRequired(draftSchema(["product", "metric"]))).toEqual([]);
  });

  it("streams the draft in the order the board builds it", () => {
    expect(Object.keys(draftSchema(["product"]).properties)).toEqual(["summary", "outcome", "opportunities", "recommendedTarget", "solutions"]);
  });

  it("lets quotes cite only the answers that were asked", () => {
    const p = draftSchema(["product", "pains", "follow-1"]).properties as unknown as Props;
    const evidence = p.opportunities.items!.properties.evidence as unknown as { items: { properties: { answerId: { enum: string[] } } } };
    expect(evidence.items.properties.answerId.enum).toEqual(["product", "pains", "follow-1"]);
    expect(p.solutions.items!.properties.answerId.anyOf![0].enum).toEqual(["product", "pains", "follow-1"]);
  });

  it("accepts the interview, with at most three follow-ups", () => {
    const answers = SAMPLE_ANSWERS.map(({ id, question, answer }) => ({ id, question, answer }));
    expect(DiscoveryBody.safeParse({ stage: "followups", answers }).success).toBe(true);
    expect(DiscoveryBody.safeParse({ stage: "draft", answers, followUps: [] }).success).toBe(true);
    expect(DiscoveryBody.safeParse({ stage: "draft", answers: [] }).success).toBe(false);
    const four = Array.from({ length: 4 }, (_, i) => ({ id: `f${i}`, question: "Q", answer: "A" }));
    expect(DiscoveryBody.safeParse({ stage: "draft", answers, followUps: four }).success).toBe(false);
    expect(DiscoveryBody.safeParse({ stage: "draft", answers: [{ id: "x", question: "Q", answer: "a".repeat(2001) }] }).success).toBe(false);
    expect(DiscoveryBody.safeParse({ stage: "grow", answers }).success).toBe(false);
  });

  it("gives the model the answers as material, follow-ups after, all quotable", () => {
    const body = { stage: "draft" as const, answers: [{ id: "product", question: "What's the product?", answer: "  A grocery app  " }, { id: "pains", question: "What do customers struggle with?", answer: "" }], followUps: [{ id: "who", question: "Which customers?", answer: "Parents" }] };
    const text = draftContent(body);
    expect(text).toContain("- product: What's the product?\n  A grocery app");
    expect(text).toContain("(skipped)");
    expect(text.indexOf("Their answers to your follow-ups:")).toBeGreaterThan(text.indexOf("- pains"));
    expect(quotableIds(body)).toEqual(["product", "pains", "who"]);
  });
});

describe("Sources requests", () => {
  const chunk = (id: string, text = "P3: I never know when the driver will turn up.") => ({ id, source: "Interviews.pdf", kind: "PDF", text });
  const tree = [
    { id: "c1", parent: null, kind: "outcome" as const, title: "More weekly reorders", quotes: 0 },
    { id: "c2", parent: "c1", kind: "opportunity" as const, title: "I can't tell when my order arrives", quotes: 2 },
    { id: "c3", parent: "c2", kind: "solution" as const, title: "Live tracking", quotes: 0 },
    { id: "c4", parent: "c3", kind: "test" as const, title: "Fake door", quotes: 0 },
  ];
  const quotes = [{ id: "q1", text: "I never know when the driver will turn up", source: "Interviews.pdf", speaker: "P3", kind: "pain" }];

  it("schemas require every property and stream quotes before needs, mappings before new cards", () => {
    expect(openRequired(extractSchema(["c1"]))).toEqual([]);
    expect(openRequired(synthesizeSchema(["c2"], ["c1"], ["q1"]))).toEqual([]);
    expect(Object.keys(extractSchema(["c1"]).properties)).toEqual(["quotes", "needs"]);
    expect(Object.keys(synthesizeSchema(["c2"], ["c1"], ["q1"]).properties)).toEqual(["mappings", "newOpportunities", "contradictions"]);
  });

  it("lets quotes name only the parts sent, and proposals only the cards and quotes sent", () => {
    const e = extractSchema(["c1", "c2"]).properties as unknown as Props;
    expect(e.quotes.items!.properties.chunkId.enum).toEqual(["c1", "c2"]);
    const ids = synthesizeIds({ stage: "synthesize", product: "", tree, quotes, needs: [] });
    expect(ids).toEqual({ cards: ["c2", "c3"], parents: ["c1", "c2"], quotes: ["q1"] });
    const p = synthesizeSchema(ids.cards, ids.parents, ids.quotes).properties as unknown as Props;
    expect(p.mappings.items!.properties.cardId.enum).toEqual(["c2", "c3"]);
    expect(p.newOpportunities.items!.properties.parent.enum).toEqual(["c1", "c2"]);
    expect(p.contradictions.items!.properties.quoteId.enum).toEqual(["q1"]);
  });

  it("accepts a few parts per extract call, within the size of one call", () => {
    expect(DiscoveryBody.safeParse({ stage: "extract", product: "A grocery app", chunks: [chunk("c1"), chunk("c2")] }).success).toBe(true);
    expect(DiscoveryBody.safeParse({ stage: "extract", product: "", chunks: [] }).success).toBe(false);
    const full = "x".repeat(20_000);
    expect(DiscoveryBody.safeParse({ stage: "extract", product: "", chunks: [chunk("c1", full), chunk("c2", full)] }).success).toBe(true);
    expect(DiscoveryBody.safeParse({ stage: "extract", product: "", chunks: [chunk("c1", full), chunk("c2", full), chunk("c3", "x".repeat(EXTRACT_MAX_CHARS - 40_000 + 1))] }).success).toBe(false);
    expect(DiscoveryBody.safeParse({ stage: "extract", product: "", chunks: [chunk("c1", "x".repeat(26_001))] }).success).toBe(false);
  });

  it("accepts the tree with quotes to map, and an import from named tools", () => {
    expect(DiscoveryBody.safeParse({ stage: "synthesize", product: "", tree, quotes, needs: [{ title: "Arrival times", quoteIds: ["q1"] }] }).success).toBe(true);
    expect(DiscoveryBody.safeParse({ stage: "synthesize", product: "", tree, quotes: [], needs: [] }).success).toBe(false);
    expect(DiscoveryBody.safeParse({ stage: "import", request: "The September interviews", connectors: ["mcp:notion"] }).success).toBe(true);
    expect(DiscoveryBody.safeParse({ stage: "import", request: "The September interviews", connectors: [] }).success).toBe(false);
    expect(DiscoveryBody.safeParse({ stage: "import", request: "  ", connectors: ["mcp:notion"] }).success).toBe(false);
  });

  it("gives the model the material as marked parts, and the tree as an outline", () => {
    const text = extractContent({ stage: "extract", product: "A grocery app", chunks: [chunk("c1"), { ...chunk("c2"), source: 'Notes "v2"' }] });
    expect(text).toContain('<part id="c1" source="Interviews.pdf (PDF)">\nP3: I never know');
    expect(text).toContain("source=\"Notes 'v2' (PDF)\"");
    // An interview's part says who is who.
    const interview = { ...chunk("c1"), kind: "Interview", speakers: 'S1 (Lina "L") is the interviewer; S2 is a participant' };
    expect(DiscoveryBody.safeParse({ stage: "extract", product: "", chunks: [interview] }).success).toBe(true);
    expect(extractContent({ stage: "extract", product: "", chunks: [interview] })).toContain(`(Interview)" speakers="S1 (Lina 'L') is the interviewer; S2 is a participant">`);
    expect(DiscoveryBody.safeParse({ stage: "extract", product: "", chunks: [{ ...interview, speakers: "x".repeat(401) }] }).success).toBe(false);
    const outline = synthesizeContent({ stage: "synthesize", product: "", tree, quotes, needs: [{ title: "Arrival times", quoteIds: ["q1"] }] });
    expect(outline).toContain("- c1 · outcome · More weekly reorders\n  - c2 · opportunity · I can't tell when my order arrives (2 quotes)\n    - c3 · solution · Live tracking");
    expect(outline).toContain("- q1 · pain · Interviews.pdf · P3: “I never know when the driver will turn up”");
    expect(outline).toContain("- Arrival times (q1)");
  });
});

describe("brain dump requests", () => {
  const card = (id: string, parent: string | null, kind: "outcome" | "opportunity" | "solution" | "test", title: string, more: Record<string, unknown> = {}) => ({ id, parent, kind, title, quotes: 0, description: "", metric: null, assumptions: [], words: 0, against: 0, ...more });
  const tree = [
    card("c1", null, "outcome", "More customers reorder every week", { metric: "Weekly reorders · 1.2 now → 1.5" }),
    card("c2", "c1", "opportunity", "I can't find what I ordered", { quotes: 2, words: 1, against: 1, description: "Finding past orders is slow." }),
    card("c3", "c2", "solution", "Order again shelf", { assumptions: ["They notice it", "They reorder the same things"] }),
    card("c4", "c3", "test", "5-user test"),
  ];
  const base = { product: "Basket, a grocery app", dump: SAMPLE_DUMP_TEXT, tree };
  const fragments = [
    { id: "f1", quote: "They want us at 2M dirhams a month", role: "goal" as const },
    { id: "f2", quote: "Parents hate substitutions", role: "need" as const },
  ];
  const read = { understanding: "Orders, reorders.", fragments, challenges: [{ kind: "conflict" as const, fragmentId: "f2", cardId: "c2", text: "It conflicts." }] };

  it("schemas require every property", () => {
    expect(openRequired(dumpReadSchema(["c1"]))).toEqual([]);
    expect(openRequired(dumpReadSchema([]))).toEqual([]);
    expect(openRequired(dumpFollowupSchema(["c1"], ["f1"]))).toEqual([]);
    expect(openRequired(dumpPlaceSchema({ cards: ["c1"], holders: ["c1"], solutions: [], outcomes: ["c1"], fragments: ["f1"], answers: [] }))).toEqual([]);
  });

  it("streams the reading first and the new cards before the changes", () => {
    expect(Object.keys(dumpReadSchema(["c1"]).properties)).toEqual(["understanding", "fragments", "challenges", "questions"]);
    expect(Object.keys(dumpPlaceSchema({ cards: [], holders: [], solutions: [], outcomes: [], fragments: [], answers: [] }).properties)).toEqual(["summary", "cards", "evidence", "assumptions", "metrics", "edits", "moves", "merges", "notes"]);
  });

  it("lets answers name only the cards, pieces and answers that were sent", () => {
    const body = { stage: "dump-place" as const, ...base, ...read, answers: [{ id: "a1", question: "Which goal?", answer: "Reorders" }] };
    const ids = placeIds(body);
    expect(ids).toEqual({ cards: ["c1", "c2", "c3", "c4"], holders: ["c1", "c2", "c3"], solutions: ["c3"], outcomes: ["c1"], fragments: ["f1", "f2"], answers: ["a1"], quotes: [] });
    const p = dumpPlaceSchema(ids).properties as unknown as Props;
    expect(p.cards.items!.properties.parentCard.anyOf![0].enum).toEqual(["c1", "c2", "c3"]);
    expect(p.metrics.items!.properties.cardId.enum).toEqual(["c1"]);
    expect(p.assumptions.items!.properties.cardId.enum).toEqual(["c3"]);
    const r = dumpReadSchema(["c1", "c2"]).properties as unknown as Props;
    expect(r.challenges.items!.properties.cardId.anyOf![0].enum).toEqual(["c1", "c2"]);
    const f = dumpFollowupSchema(["c1"], ["f1", "f2"]).properties as unknown as Props;
    expect(f.roles.items!.properties.fragmentId.enum).toEqual(["f1", "f2"]);
  });

  it("accepts a brain dump up to its size, a board up to 400 cards, three rounds", () => {
    expect(DiscoveryBody.safeParse({ stage: "dump-read", ...base }).success).toBe(true);
    expect(DiscoveryBody.safeParse({ stage: "dump-read", ...base, tree: [] }).success).toBe(true);
    expect(DiscoveryBody.safeParse({ stage: "dump-read", ...base, dump: "   too short   " }).success).toBe(false);
    expect(DiscoveryBody.safeParse({ stage: "dump-read", ...base, dump: "a ".repeat(10_001) }).success).toBe(false);
    expect(DiscoveryBody.safeParse({ stage: "dump-read", ...base, tree: Array.from({ length: 401 }, (_, i) => card(`c${i}`, null, "outcome", "x")) }).success).toBe(false);
    const round = { answers: [{ question: "Which goal?", answer: "Reorders" }] };
    expect(DiscoveryBody.safeParse({ stage: "dump-followup", ...base, ...read, rounds: [round], last: false }).success).toBe(true);
    expect(DiscoveryBody.safeParse({ stage: "dump-followup", ...base, ...read, rounds: [round, round, round, round], last: true }).success).toBe(false);
  });

  it("gives the model the board with what each card says and rests on, then the dump as material", () => {
    expect(dumpOutline(tree)).toEqual([
      "- c1 · outcome · More customers reorder every week [Weekly reorders · 1.2 now → 1.5]",
      "  - c2 · opportunity · I can't find what I ordered — Finding past orders is slow. (2 customer quotes · 1 of the builder's own · 1 against)",
      "    - c3 · solution · Order again shelf {assumes: They notice it; They reorder the same things}",
      "      - c4 · test · 5-user test",
    ]);
    const text = dumpReadContent({ stage: "dump-read", ...base });
    expect(text).toContain(`<brain_dump>\n${SAMPLE_DUMP_TEXT}\n</brain_dump>`);
    expect(dumpReadContent({ stage: "dump-read", ...base, tree: [] })).toContain("The board is empty.");
    const follow = dumpFollowupContent({ stage: "dump-followup", ...base, ...read, rounds: [{ answers: [{ question: "Which goal?", answer: "" }] }], last: true });
    expect(follow).toContain("- f2 · need: “Parents hate substitutions”");
    expect(follow).toContain("- conflict · f2 · c2: It conflicts.");
    expect(follow).toContain("(skipped)");
    expect(follow).toContain("That was the last round");
    expect(dumpPlaceContent({ stage: "dump-place", ...base, ...read, answers: [{ id: "a1", question: "Which goal?", answer: "Reorders" }] })).toContain("- a1: Which goal?\n  Reorders");
  });
});
describe("calls that carry what the organization knows", () => {
  const context = { block: "[k1] Pain Sara said in “Sara interview”\nThey swap it without asking\n[k2] A decision the team made: Dropped saved baskets", ids: ["k1", "k2"], quotes: ["k1"] };

  it("accepts the packed pieces with the calls that use them, its quote ids among its ids", () => {
    const draft = { stage: "draft", answers: SAMPLE_ANSWERS.slice(0, 2), context };
    expect(DiscoveryBody.safeParse(draft).success).toBe(true);
    expect(DiscoveryBody.safeParse({ ...draft, context: { ...context, quotes: ["k9"] } }).success).toBe(false);
    expect(DiscoveryBody.safeParse({ ...draft, context: { ...context, ids: ["k1", "x2"] } }).success).toBe(false);
  });

  it("gives the model the pieces as material from elsewhere, and asks which shaped its answer, by the ids sent", () => {
    expect(knowledgeBlock(undefined)).toEqual([]);
    expect(knowledgeBlock(context).join("\n")).toContain("<organization>\n[k1] Pain Sara said");
    expect(draftContent({ stage: "draft", answers: SAMPLE_ANSWERS.slice(0, 1), context })).toContain("</organization>\n\nDraft the tree.");
    expect(withKnowledge("SYSTEM", undefined)).toBe("SYSTEM");
    expect(withKnowledge("SYSTEM", context, "EXTRA")).toBe(`SYSTEM\n\n${KNOWLEDGE_NOTE}\nEXTRA`);
    const schema = withPieceReliance(extractSchema(["c1"]), context) as unknown as { properties: Record<string, { items: { properties: { id: { enum: string[] } } } }>; required: string[] };
    expect(schema.required.at(-1)).toBe("reliedOn");
    expect(schema.properties.reliedOn.items.properties.id.enum).toEqual(["k1", "k2"]);
    expect(withPieceReliance(extractSchema(["c1"]), undefined)).toEqual(extractSchema(["c1"]));
    expect(openRequired(schema)).toEqual([]);
  });

  it("lets a draft's needs and a brain dump's cards rest on the organization's customer quotes, only those sent", () => {
    const draft = draftSchema(["pains"], ["k1"]) as unknown as { properties: { opportunities: { items: { properties: Record<string, { items: { enum: string[] } }> } } } };
    expect(draft.properties.opportunities.items.properties.pieces.items.enum).toEqual(["k1"]);
    expect(Object.keys((draftSchema(["pains"]) as unknown as typeof draft).properties.opportunities.items.properties)).not.toContain("pieces");
    const ids = { cards: ["c1"], holders: ["c1"], solutions: [], outcomes: ["c1"], fragments: ["f1"], answers: [], quotes: ["k1"] };
    const place = dumpPlaceSchema(ids) as unknown as { properties: Record<string, { items: { properties: Record<string, { enum?: string[]; items?: { enum: string[] } }> } }> };
    expect(place.properties.cards.items.properties.pieceIds.items?.enum).toEqual(["k1"]);
    expect(place.properties.quotes.items.properties.pieceId.enum).toEqual(["k1"]);
    expect(Object.keys((dumpPlaceSchema({ ...ids, quotes: [] }) as unknown as typeof place).properties)).not.toContain("quotes");
    expect(openRequired(place)).toEqual([]);
  });
});
