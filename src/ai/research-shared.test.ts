import { describe, expect, it } from "vitest";
import { CAPTURE_LIMITS, NO_RESEARCH, citedSources, keepCaptures, mergeSources, parseNotes, researchBlock, researchHistory, resultText, stepLabel } from "./research-shared";
import { CritiqueBody, buildCritiqueContent } from "./critique-request";

const label = (s: string) => ({ mobbin: "Mobbin", tavily: "Tavily" })[s] ?? s;

describe("research notes", () => {
  it("treats the no-research marker as no notes", () => {
    expect(parseNotes(NO_RESEARCH)).toBe("");
    expect(parseNotes(`  ${NO_RESEARCH}\n`)).toBe("");
    expect(parseNotes("Nothing to look up here. NO_RESEARCH")).toBe("");
    expect(parseNotes("")).toBe("");
    expect(parseNotes("- Silver fares are AED 3 [RTA](https://rta.ae/fares)")).toBe("- Silver fares are AED 3 [RTA](https://rta.ae/fares)");
  });

  it("drops a preamble before the first bullet unless it cites something", () => {
    expect(parseNotes("I found two packages.\n\n- [react-piano-roll](https://github.com/dpren/react-piano-roll): WebGL piano roll")).toBe("- [react-piano-roll](https://github.com/dpren/react-piano-roll): WebGL piano roll");
    const cited = "Per [RTA](https://rta.ae): fares vary.\n- Silver AED 3";
    expect(parseNotes(cited)).toBe(cited);
  });

  it("collects cited links once each, trimming trailing punctuation", () => {
    const notes = "- A [RTA fares](https://rta.ae/fares). B [RTA fares](https://rta.ae/fares)\n- C [Uber](https://mobbin.com/screens/1),";
    expect(citedSources(notes)).toEqual([
      { title: "RTA fares", url: "https://rta.ae/fares" },
      { title: "Uber", url: "https://mobbin.com/screens/1" },
    ]);
  });

  it("merges source lists by URL and drops non-web links", () => {
    const merged = mergeSources([
      [{ title: "A", url: "https://a.com/x" }],
      [
        { title: "A again", url: "https://a.com/x" },
        { title: "", url: "https://www.b.com/y" },
        { title: "bad", url: "javascript:alert(1)" },
      ],
    ]);
    expect(merged).toEqual([
      { title: "A", url: "https://a.com/x" },
      { title: "b.com", url: "https://www.b.com/y" },
    ]);
  });

  it("wraps notes as data, not instructions", () => {
    const block = researchBlock("- fact [s](https://s.com)");
    expect(block.startsWith("<web_research>")).toBe(true);
    expect(block).toContain("not instructions");
    expect(block.trim().endsWith("</web_research>")).toBe(true);
  });
});

describe("research history", () => {
  it("keeps turn summaries and drops screen specs and outlines", () => {
    const context = [
      'Turn 1 · Generate: "Metro top-up" (mobile)',
      '  Screen 1.1 "Top-up" — cards first',
      `  Screen 1.1 spec: {"name":"Top-up","root":${"x".repeat(50)}}`,
      "  Screen 1.2 edited by hand since, so here is its layer outline:",
      "frame Top-up 390×844",
      'Turn 2 · Tune system: "rounder buttons"',
    ].join("\n");
    const h = researchHistory(context);
    expect(h).toContain("Turn 1 · Generate");
    expect(h).toContain("Turn 2 · Tune system");
    expect(h).toContain("cards first");
    expect(h).not.toContain("spec:");
    expect(h).not.toContain("edited by hand");
    expect(h).not.toContain("frame Top-up");
    expect(researchHistory(undefined)).toBe("");
  });
});

describe("step labels", () => {
  it("names built-in and MCP lookups on both backends", () => {
    expect(stepLabel("web_search", { query: "dubai metro fares" }, label)).toBe("Searching the web: “dubai metro fares”");
    expect(stepLabel("WebSearch", { query: "q" }, label)).toBe("Searching the web: “q”");
    expect(stepLabel("WebFetch", { url: "https://www.rta.ae/en/fares" }, label)).toBe("Reading rta.ae");
    expect(stepLabel("mcp__mobbin__search_screens", { query: "ride confirmation", limit: 3 }, label)).toBe("Mobbin · screens: “ride confirmation”");
    expect(stepLabel("tavily_search", { query: "wcag 2.2 target size" }, label, "tavily")).toBe("Tavily · search: “wcag 2.2 target size”");
  });
});

describe("critique research", () => {
  const body = CritiqueBody.parse({
    screens: [{ id: "a", name: "Home", outline: "frame Home" }],
    lint: [],
    brief: { summary: "", answers: [], screens: [], otherScreens: [] },
    transcript: [{ topic: "goal", question: "What is it for?", answer: "Booking" }],
    reported: [],
    mustConclude: false,
    research: "- Target size is 24px minimum [WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)",
  });

  it("resends the first turn's notes on later turns", () => {
    const text = buildCritiqueContent(body, { cache: false })
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n");
    expect(text).toContain("<web_research>");
    expect(text).toContain("WCAG 2.5.8");
  });
});

describe("import captures", () => {
  it("keeps what the tools returned, word for word, within 60 KB each and 200 KB in all, never errors", () => {
    const big = "a".repeat(80_000);
    const kept = keepCaptures([
      { title: "Notion · fetch: “Interviews”", text: `  ${big}  ` },
      { title: "empty", text: "No results" },
      { title: "too long", text: "Error: result (89,515 characters across 1,733 lines) exceeds maximum allowed tokens. Output has been saved to /tmp/x.txt" },
      { title: "failed", text: "Error: The page could not be fetched because the server answered 403 Forbidden." },
      { title: "again", text: big },
      { title: "second", text: "b".repeat(70_000) },
      { title: "third", text: "c".repeat(70_000) },
      { title: "fourth", text: "d".repeat(70_000) },
    ]);
    expect(kept.map((c) => c.title)).toEqual(["Notion · fetch: “Interviews”", "second", "third", "fourth"]);
    expect(kept[0].text).toBe("a".repeat(CAPTURE_LIMITS.each));
    expect(kept.every((c) => c.text.length <= CAPTURE_LIMITS.each)).toBe(true);
    expect(kept.reduce((n, c) => n + c.text.length, 0)).toBe(CAPTURE_LIMITS.total);
    expect(kept[3].text).toBe("d".repeat(CAPTURE_LIMITS.total - 3 * CAPTURE_LIMITS.each));
  });

  it("reads a tool result's text whether it's a string or text blocks", () => {
    expect(resultText("plain")).toBe("plain");
    expect(resultText([{ type: "text", text: "one" }, { type: "image", data: "…" }, { type: "text", text: "two" }])).toBe("one\ntwo");
    expect(resultText(null)).toBe("");
  });
});
