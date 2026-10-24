import { describe, expect, it } from "vitest";
import { DiscoveryBody, EXTRACT_MAX_CHARS, FOLLOWUPS_SCHEMA, draftContent, draftSchema, extractContent, extractSchema, quotableIds, synthesizeContent, synthesizeIds, synthesizeSchema } from "./discovery";
import { SAMPLE_ANSWERS } from "./fixtures-discovery";

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
