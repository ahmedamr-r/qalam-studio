import { describe, expect, it } from "vitest";
import { MAX_SOURCE_TEXT } from "@/discovery/sources";
import { capText, captureText, captureTitle, cleanText } from "./text";
import { markdownToText } from "./markdown";

describe("cleanText", () => {
  it("unifies line endings and trims space, never touching the words", () => {
    expect(cleanText("﻿Hello,\r\nworld.  \r\n\r\n\r\n\r\nSecond\u0007 line\t")).toBe("Hello,\nworld.\n\nSecond line");
    expect(cleanText("tabs\tinside stay")).toBe("tabs\tinside stay");
  });

  it("cuts a very long text at a paragraph near the limit and says so", () => {
    const para = `${"a".repeat(999)}\n\n`;
    const long = para.repeat(Math.ceil(MAX_SOURCE_TEXT / para.length) + 2);
    const c = capText(long);
    expect(c.truncated).toBe(true);
    expect(c.text.length).toBeLessThanOrEqual(MAX_SOURCE_TEXT);
    expect(c.text.endsWith("a")).toBe(true);
    expect(capText("short")).toEqual({ text: "short" });
  });
});

describe("markdownToText", () => {
  it("drops the marks and keeps the words in order", () => {
    const md = [
      "---",
      "title: Interviews",
      "---",
      "# Interview 3",
      "",
      "> I **never** know when the _driver_ will turn up.",
      "",
      "- Asked about [live tracking](https://example.com/x \"Tracking\")",
      "- Uses `snake_case_names` and 2 * 3 = 6",
      "",
      "***",
      "",
      "```",
      "raw block",
      "```",
      "<br/>Said it ~~twice~~ once.",
    ].join("\n");
    expect(markdownToText(md)).toBe(
      ["Interview 3", "", "I never know when the driver will turn up.", "", "- Asked about live tracking", "- Uses snake_case_names and 2 * 3 = 6", "", "raw block", "", "Said it twice once."].join("\n"),
    );
  });
});

describe("captures from connected tools", () => {
  it("turns JSON into lines a person can read (and quote), leaving ids and links out", () => {
    const json = JSON.stringify({ id: "3f2a9c1e-7b44-4c55-9d61-2a6b1c0d9e8f", title: "Ticket 4512", comments: [{ author: "Mia", body: "I can't find my past orders anywhere." }], url: "https://linear.app/x/4512", priority: 2 });
    expect(captureText(json)).toBe("title: Ticket 4512\n\nauthor: Mia\n\nbody: I can't find my past orders anywhere.\n\npriority: 2");
    expect(captureText("Plain notes.\r\nSecond line")).toBe("Plain notes.\nSecond line");
    expect(captureText("{ not json")).toBe("{ not json");
  });

  it("names a capture by its own first line when it reads like a title", () => {
    expect(captureTitle("# September interviews\nP1 said…", "Notion · fetch: “abc”")).toBe("September interviews");
    expect(captureTitle("x".repeat(200), "Notion · fetch: “Interview notes”")).toBe("fetch: “Interview notes”");
    expect(captureTitle("Detailed Results:\n\nTitle: Which grocery delivery service do you use?\nURL: https://x", "Tavily · search")).toBe("Which grocery delivery service do you use?");
    expect(captureTitle("Detailed Results:\n\nnothing titled", "Tavily · search: “grocery”")).toBe("search: “grocery”");
  });
});
