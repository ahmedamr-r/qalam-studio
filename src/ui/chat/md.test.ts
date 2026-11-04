import { describe, expect, it } from "vitest";
import { mdBlocks, mdInline, quoteItem } from "./md";

describe("Markdown as blocks", () => {
  it("reads headings, paragraphs, lists, tasks, quotes, code and rules", () => {
    const md = ["# Title", "", "A line", "that wraps.", "", "## Next", "", "- one", "- two", "", "1. first", "2. second", "", "- [ ] to do", "- [x] done", "", "> said", "> on", "", "---", "", "```", "a = 1", "```"].join("\n");
    expect(mdBlocks(md)).toEqual([
      { t: "heading", level: 1, text: "Title" },
      { t: "p", text: "A line that wraps." },
      { t: "heading", level: 2, text: "Next" },
      { t: "list", ordered: false, items: [{ text: "one" }, { text: "two" }] },
      { t: "list", ordered: true, items: [{ text: "first" }, { text: "second" }] },
      { t: "list", ordered: false, items: [{ text: "to do", task: false }, { text: "done", task: true }] },
      { t: "quote", text: "said on" },
      { t: "rule" },
      { t: "code", text: "a = 1" },
    ]);
  });

  it("joins a wrapped item, runs a list over one blank line, and always gets to the end", () => {
    expect(mdBlocks("- one\n  on two\n\n- three")).toEqual([{ t: "list", ordered: false, items: [{ text: "one on two" }, { text: "three" }] }]);
    expect(mdBlocks("")).toEqual([]);
    expect(mdBlocks("> only\n\n```\nnever closed")).toEqual([{ t: "quote", text: "only" }, { t: "code", text: "never closed" }]);
    expect(mdBlocks("#notaheading")).toEqual([{ t: "p", text: "#notaheading" }]);
  });

  it("reads Arabic as any other words", () => {
    expect(mdBlocks("## المشكلة\n\n- العملاء لا يدفعون")).toEqual([{ t: "heading", level: 2, text: "المشكلة" }, { t: "list", ordered: false, items: [{ text: "العملاء لا يدفعون" }] }]);
  });
});

describe("Markdown's words", () => {
  it("reads strong, code, emphasis and links", () => {
    expect(mdInline("a **b** `c` *d* [e](https://x.example)")).toEqual([{ t: "text", v: "a " }, { t: "strong", v: "b" }, { t: "text", v: " " }, { t: "code", v: "c" }, { t: "text", v: " " }, { t: "em", v: "d" }, { t: "text", v: " " }, { t: "link", v: "e", href: "https://x.example" }]);
  });

  it("links only to a web address", () => {
    expect(mdInline("[x](javascript:alert(1))").some((p) => p.t === "link")).toBe(false);
    expect(mdInline("[x](data:text/html,y)").some((p) => p.t === "link")).toBe(false);
  });

  it("leaves a multiplication and a lone star alone", () => {
    expect(mdInline("2 * 3 * 4")).toEqual([{ t: "text", v: "2 * 3 * 4" }]);
    expect(mdInline("5*6*7")).toEqual([{ t: "text", v: "5*6*7" }]);
  });

  it("knows a quote with where it came from", () => {
    expect(quoteItem("“She ghosted me.” ([A forum](https://a.example))")).toEqual({ words: "She ghosted me.", from: "[A forum](https://a.example)" });
    expect(quoteItem("“She said “no” twice.” (A forum)")).toEqual({ words: "She said “no” twice.", from: "A forum" });
    expect(quoteItem("Just a line")).toBeNull();
  });
});
