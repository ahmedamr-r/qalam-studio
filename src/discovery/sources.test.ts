import { describe, expect, it } from "vitest";
import { CHUNK, chunkText, hasQuote, packCalls, pageAt, quoteEvidence, unread, type ChunkRef, type SourceQuote } from "./sources";

const para = (i: number, n = 400) => `Paragraph ${i}. ${"word ".repeat(n / 5)}`.trim();

describe("chunkText", () => {
  it("keeps a short text whole", () => {
    expect(chunkText("A short note from an interview.")).toEqual([{ index: 0, start: 0, end: 31 }]);
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("covers the whole text in order, each chunk within the size, without overlap", () => {
    const text = Array.from({ length: 200 }, (_, i) => para(i)).join("\n\n");
    const chunks = chunkText(text, 5000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].start).toBe(0);
    expect(chunks[chunks.length - 1].end).toBe(text.length);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].end - chunks[i].start).toBeLessThanOrEqual(5000);
      if (i) expect(chunks[i].start).toBe(chunks[i - 1].end);
      expect(chunks[i].index).toBe(i);
    }
    expect(chunks.map((c) => text.slice(c.start, c.end)).join("")).toBe(text);
  });

  it("breaks at paragraphs, else lines, else sentences, else words", () => {
    const paragraphs = Array.from({ length: 40 }, (_, i) => para(i)).join("\n\n");
    for (const c of chunkText(paragraphs, 3000).slice(0, -1)) expect(paragraphs.slice(c.end - 2, c.end)).toBe("\n\n");
    const sentences = Array.from({ length: 200 }, (_, i) => `Sentence number ${i} says something.`).join(" ");
    for (const c of chunkText(sentences, 1000).slice(0, -1)) expect(sentences[c.end - 1]).toBe(".");
    const words = "lorem ".repeat(1000);
    for (const c of chunkText(words, 700).slice(0, -1)) expect(words[c.end - 1]).toBe(" ");
  });

  it("cuts a text with no breaks at the size, never between the halves of an emoji", () => {
    const solid = "x".repeat(999) + "🙂".repeat(10);
    const chunks = chunkText(solid, 1000);
    expect(chunks[0].end).toBe(999);
    expect(chunks.map((c) => solid.slice(c.start, c.end)).join("")).toBe(solid);
  });

  it("chunks about 20k characters by default", () => {
    const text = Array.from({ length: 300 }, (_, i) => para(i, 300)).join("\n\n");
    const chunks = chunkText(text);
    for (const c of chunks) expect(c.end - c.start).toBeLessThanOrEqual(CHUNK);
    expect(chunks[0].end - chunks[0].start).toBeGreaterThan(CHUNK * 0.6);
  });
});

describe("packCalls", () => {
  const ref = (sourceId: string, index: number, len: number): ChunkRef => ({ sourceId, index, start: 0, end: len });

  it("puts small chunks together and big ones alone, in order", () => {
    const calls = packCalls([ref("a", 0, 3000), ref("b", 0, 5000), ref("c", 0, 20000), ref("d", 0, 2000), ref("e", 0, 6000)], 24000);
    expect(calls.map((c) => c.map((x) => x.sourceId).join(""))).toEqual(["ab", "cd", "e"]);
  });

  it("makes no more than the calls allowed (the rest waits)", () => {
    const many = Array.from({ length: 10 }, (_, i) => ref(`s${i}`, 0, 20000));
    expect(packCalls(many, 24000, 3)).toHaveLength(3);
    expect(packCalls(many, 24000, 3).flat().map((c) => c.sourceId)).toEqual(["s0", "s1", "s2"]);
  });
});

describe("unread", () => {
  it("leaves out the chunks Qalam AI already read", () => {
    const text = Array.from({ length: 30 }, (_, i) => para(i, 2000)).join("\n\n");
    const all = chunkText(text);
    const left = unread({ id: "s", text, read: [0] });
    expect(left.map((c) => c.index)).toEqual(all.slice(1).map((c) => c.index));
    expect(left.every((c) => c.sourceId === "s")).toBe(true);
  });
});

describe("pageAt", () => {
  it("finds the page a character is on", () => {
    const pages = [0, 100, 250, 900];
    expect(pageAt(pages, 0)).toBe(1);
    expect(pageAt(pages, 99)).toBe(1);
    expect(pageAt(pages, 100)).toBe(2);
    expect(pageAt(pages, 600)).toBe(3);
    expect(pageAt(pages, 5000)).toBe(4);
    expect(pageAt(undefined, 5)).toBeUndefined();
  });
});

describe("quote evidence", () => {
  const q: SourceQuote = { id: "q1", text: "I never know when it'll arrive", span: [10, 40], page: 2, speaker: "P3", kind: "pain", addedBy: "ai", at: 1 };

  it("carries the words, where they are and who said them", () => {
    const e = quoteEvidence({ id: "src", title: "Interviews.pdf" }, q, "user", { now: 5 });
    expect(e).toMatchObject({ kind: "quote", text: q.text, sourceId: "src", sourceTitle: "Interviews.pdf", span: [10, 40], page: 2, speaker: "P3", addedBy: "user", at: 5 });
    expect(e.stance).toBeUndefined();
    expect(quoteEvidence({ id: "src", title: "x" }, q, "ai", { against: true }).stance).toBe("against");
  });

  it("knows when a card already has the same words of the same source", () => {
    const card = { evidence: [quoteEvidence({ id: "src", title: "x" }, q, "ai")] };
    expect(hasQuote(card, "src", [10, 40])).toBe(true);
    expect(hasQuote(card, "src", [10, 41])).toBe(false);
    expect(hasQuote(card, "other", [10, 40])).toBe(false);
  });
});
