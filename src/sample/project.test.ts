import { describe, expect, it } from "vitest";
import { findQuote } from "@/discovery/quotes";
import { SOURCES } from "./basket";
import { samplePages, sampleBrief, sampleBriefData, SAMPLE_BEARINGS, SAMPLE_GOALS } from "./project";

const quote = new Map<string, { text: string; kind: string; source: string }>(SOURCES.flatMap((s) => s.quotes.map((q) => [`hub:quote:${q.id}`, { text: q.text, kind: s.kind, source: s.text }] as const)));

describe("the sample's words", () => {
  const lines = samplePages().flatMap((p) => p.lines.map((l) => ({ ...l, page: p.title })));

  it("cites only quotes that are there", () => {
    for (const l of lines) for (const c of l.cites) expect(quote.has(c), `${l.page}: ${c}`).toBe(true);
    for (const g of SAMPLE_GOALS) for (const c of g.cites) expect(quote.has(c), `${g.title}: ${c}`).toBe(true);
    for (const b of SAMPLE_BEARINGS) for (const c of b.cites ?? []) expect(quote.has(c), `${b.need}: ${c}`).toBe(true);
  });

  it("keeps a line's quoted words and numbers in what it cites", () => {
    for (const l of lines) {
      const cited = l.cites.map((c) => quote.get(c)!.source).join("\n");
      for (const m of l.text.matchAll(/“([^”]+)”/g)) expect(findQuote(cited, m[1]), `${l.page}: ${m[1]}`).toBeTruthy();
      for (const n of l.text.match(/\d+/g) ?? []) expect(cited, `${l.page}: ${n}`).toContain(n);
    }
  });

  it("rests what's known and what's against on what people said, never on the founder's own notes", () => {
    const facts = lines.filter((l) => l.section === "know" || l.section === "against");
    expect(facts.length).toBeGreaterThan(10);
    for (const l of facts) {
      expect(l.cites.length, l.text).toBeGreaterThan(0);
      for (const c of l.cites) expect(quote.get(c)!.kind, `${l.page}: ${l.text}`).not.toBe("dump");
    }
  });

  it("has an open question only as a question, with nothing to cite", () => {
    for (const l of lines.filter((x) => x.section === "open")) {
      expect(l.text.endsWith("?")).toBe(true);
      expect(l.cites).toEqual([]);
    }
  });

  it("writes a brief whose quotes are word for word, says it's the strongest signal and not proof, and ends for the coding agent", () => {
    const d = sampleBriefData();
    const every = [...d.quotes, ...d.features.flatMap((f) => f.quotes)];
    for (const q of every) expect(SOURCES.find((s) => s.title === q.source)!.text).toContain(q.text);
    const { meta, body } = sampleBrief();
    expect(meta.features).toBe(2);
    expect(body).toContain("not proof");
    expect(body).toContain("## For the coding agent");
    expect(body).toContain("- [ ] ");
  });
});
