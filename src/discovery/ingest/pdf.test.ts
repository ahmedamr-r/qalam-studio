import { describe, expect, it } from "vitest";
import { shapeLines, type PdfLine } from "./pdf";

const line = (text: string, y: number, o: Partial<PdfLine> = {}): PdfLine => ({ text, size: 11, x: 72, y, w: 460, ...o });
const shown = (r: ReturnType<typeof shapeLines>) => r.blocks.map((b) => [b.kind, r.text.slice(b.span[0], b.span[1])]);

describe("a PDF page's shape", () => {
  it("finds headings by size, the largest first, and joins a paragraph's wrapped lines", () => {
    const r = shapeLines([
      line("Instant Pay, tracked", 760, { size: 24, w: 260 }),
      line("Why Bolto", 700, { size: 16, w: 90 }),
      line("I'm a designer in Egypt, paid as a contractor from abroad. I know", 676),
      line("the wait, and what it costs a family.", 662, { w: 230 }),
      line("What it promised", 620, { size: 16, w: 140 }),
      line("Payouts in 190+ countries.", 596, { w: 170 }),
    ]);
    expect(r.text).toBe("Instant Pay, tracked\n\nWhy Bolto\n\nI'm a designer in Egypt, paid as a contractor from abroad. I know the wait, and what it costs a family.\n\nWhat it promised\n\nPayouts in 190+ countries.");
    expect(shown(r)).toEqual([
      ["h1", "Instant Pay, tracked"],
      ["h2", "Why Bolto"],
      ["h2", "What it promised"],
    ]);
  });

  it("reads bullets and numbers as list items, a bullet's mark left out and its wrapped line kept with it", () => {
    const r = shapeLines([
      line("What it shows:", 700, { w: 90 }),
      line("• Where each payout is, from the moment it's sent to the moment it", 686, { x: 72 }),
      line("lands in the account", 672, { x: 80, w: 120 }),
      line("• When it lands", 658, { w: 90 }),
      line("1. How a returned one gets fixed", 644, { w: 200 }),
    ]);
    expect(shown(r)).toEqual([
      ["li", "Where each payout is, from the moment it's sent to the moment it lands in the account"],
      ["li", "When it lands"],
      ["li", "1. How a returned one gets fixed"],
    ]);
    expect(r.text.startsWith("What it shows:\n\nWhere each payout is")).toBe(true);
  });

  it("keeps short lines on lines of their own, starts a paragraph after a gap, and never merges up the page", () => {
    const r = shapeLines([
      line("A long first line that runs across the whole width of the column here", 700),
      line("Ahmed Amr", 640, { w: 70 }),
      line("Designer in Egypt", 626, { w: 120 }),
      line("A second column", 700, { x: 320, w: 120 }),
    ]);
    expect(r.text).toBe("A long first line that runs across the whole width of the column here\n\nAhmed Amr\nDesigner in Egypt\n\nA second column");
    expect(r.blocks).toEqual([]);
  });

  it("joins a word broken over two lines, and drops empty lines and stray control characters", () => {
    const r = shapeLines([line("Payouts settle in real time for every work-", 700), line("er who asks\u0007 for it.", 686, { w: 100 }), line("", 672), line("Done.", 640, { w: 40 })]);
    expect(r.text).toBe("Payouts settle in real time for every work-er who asks for it.\n\nDone.");
  });
});
