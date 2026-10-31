import { describe, expect, it } from "vitest";
import { segmentsOf, shapeSegments } from "./segments";

const TEXT = "Intro. Parents rebuild the list. From Drive: Pitch. Half repeats weekly.";
const q = (id: string, words: string) => {
  const at = TEXT.indexOf(words);
  return { id, span: [at, at + words.length] as [number, number] };
};
const cut = (segs: ReturnType<typeof segmentsOf>) => segs.map((s) => [TEXT.slice(s.start, s.end), s.quote ?? null]);

describe("a source's text cut at its quotes", () => {
  it("marks each quote in place, the rest as it is", () => {
    expect(cut(segmentsOf(TEXT, [q("a", "Parents rebuild the list"), q("b", "Half repeats")]))).toEqual([
      ["Intro. ", null],
      ["Parents rebuild the list", "a"],
      [". From Drive: Pitch. ", null],
      ["Half repeats", "b"],
      [" weekly.", null],
    ]);
  });

  it("reads one part of the text, in the text's own positions, and marks a quote only inside it", () => {
    const part: [number, number] = [TEXT.indexOf("Half"), TEXT.length];
    const segs = segmentsOf(TEXT, [q("a", "Parents rebuild the list"), q("b", "Half repeats"), { id: "c", span: [TEXT.indexOf("Pitch"), TEXT.indexOf("repeats")] }], { range: part });
    expect(segs[0].start).toBe(part[0]);
    // Where two quotes overlap, the one that starts first (then the first given) marks it.
    expect(cut(segs)).toEqual([
      ["Half ", "b"],
      ["repeats", "b"],
      [" weekly.", null],
    ]);
    expect(segmentsOf(TEXT, [], { range: [10, 10] })).toEqual([]);
  });

  it("marks a quote's parts and starts pages where a PDF's do", () => {
    const parts = { id: "p", span: [0, 20] as [number, number], parts: [[0, 6], [7, 14]] as [number, number][] };
    const segs = segmentsOf(TEXT, [parts], { pages: [0, 7] });
    expect(segs.map((s) => [s.start, s.end, s.quote ?? null, s.page ?? null]).slice(0, 2)).toEqual([
      [0, 6, "p", 1],
      [6, 7, null, null],
    ]);
    expect(segs[2]).toMatchObject({ start: 7, quote: "p", page: 2 });
  });
});

describe("a source's text drawn in its shape", () => {
  const text = "What it promised\n\nPayouts in 190 countries, the same day.\n\nWhere each payout is\n\nWhen it lands";
  const at = (words: string): [number, number] => [text.indexOf(words), text.indexOf(words) + words.length];
  const blocks = [
    { span: at("What it promised"), kind: "h1" as const },
    { span: at("Where each payout is"), kind: "li" as const },
    { span: at("When it lands"), kind: "li" as const },
  ];

  it("groups the text into its heading, paragraphs and list items, the blank lines between them not drawn", () => {
    const segs = segmentsOf(text, [], { blocks });
    const shaped = shapeSegments(text, segs, blocks);
    expect(shaped.map((b) => [b.kind, b.segments.map((s) => text.slice(s.start, s.end)).join("")])).toEqual([
      ["h1", "What it promised"],
      ["p", "Payouts in 190 countries, the same day."],
      ["li", "Where each payout is"],
      ["li", "When it lands"],
    ]);
  });

  it("keeps a quote marked across the blocks it reaches into, each piece in its own block", () => {
    const quote = { id: "q1", span: [at("Payouts")[0], at("Where each")[1]] as [number, number] };
    const shaped = shapeSegments(text, segmentsOf(text, [quote], { blocks }), blocks);
    expect(shaped.map((b) => b.segments.filter((s) => s.quote === "q1").map((s) => text.slice(s.start, s.end)))).toEqual([[], ["Payouts in 190 countries, the same day."], ["Where each"], []]);
  });
});
