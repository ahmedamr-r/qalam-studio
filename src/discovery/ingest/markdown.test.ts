import { describe, expect, it } from "vitest";
import { markdownShape, markdownToText } from "./markdown";

const shown = (r: ReturnType<typeof markdownShape>) => r.blocks.map((b) => [b.kind, r.text.slice(...b.span)]);

describe("Markdown read with its shape", () => {
  it("keeps headings by level and list items as blocks, a bullet's mark left out and a number kept", () => {
    const r = markdownShape("# Instant Pay, tracked\n\nA concept for **payout** tracking.\n\n## What it promised\n\n- Payouts in 190 countries\n* By bank, card or crypto\n1. Fixed the same day\n\n#### Deeper\n");
    expect(r.text).toBe("Instant Pay, tracked\n\nA concept for payout tracking.\n\nWhat it promised\n\nPayouts in 190 countries\n\nBy bank, card or crypto\n\n1. Fixed the same day\n\nDeeper");
    expect(shown(r)).toEqual([
      ["h1", "Instant Pay, tracked"],
      ["h2", "What it promised"],
      ["li", "Payouts in 190 countries"],
      ["li", "By bank, card or crypto"],
      ["li", "1. Fixed the same day"],
      ["h3", "Deeper"],
    ]);
  });

  it("reads a Google Doc's export: its escapes, links to their words, a list item's indented next line kept with it", () => {
    const r = markdownShape("# Why Bolto\n\nI'm paid as a contractor from abroad\\. See [the deck](https://docs.google.com/x)\\!\n\n* Where each payout is,\n  from sent to landed\n\n---\n\n> What Bolto said: “It’s a trust problem.”\n");
    expect(r.text).toBe("Why Bolto\n\nI'm paid as a contractor from abroad. See the deck!\n\nWhere each payout is, from sent to landed\n\nWhat Bolto said: “It’s a trust problem.”");
    expect(shown(r)).toEqual([
      ["h1", "Why Bolto"],
      ["li", "Where each payout is, from sent to landed"],
    ]);
  });

  it("keeps a paragraph's lines as written, front matter and code fences' marks out, what's inside a fence kept", () => {
    const r = markdownShape("---\ntitle: Notes\n---\nSara: I rebuild my basket\nevery Sunday.\n\n```\n# not a heading\n```\n");
    expect(r.text).toBe("Sara: I rebuild my basket\nevery Sunday.\n\n# not a heading");
    expect(r.blocks).toEqual([]);
  });

  it("reads the same words as the plain reading does", () => {
    const md = "# Interview\n\n**Sara:** I rebuild my basket every *Sunday*.\n";
    expect(markdownShape(md).text).toBe(markdownToText(md));
  });
});
