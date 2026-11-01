import { describe, expect, it } from "vitest";
import { partSpans } from "@/space/find";
import type { Market } from "@/market/types";
import { focusMaterial, focusQuestionsMaterial, focusRound, focusTask, focusTranscript, lookHead, sanitizeLook, type FocusLook } from "./focus";
import type { Goal } from "./types";

const goal = { id: "g1", title: "More product managers adopt Qalam", status: "active", metric: { name: "PMs who have adopted Qalam", current: 40, target: 200, unit: "PMs" } } as unknown as Goal;
const north = { id: "g0", title: "Qalam is how product teams decide what to build", status: "active" } as unknown as Goal;
const page = {
  ref: "",
  url: "https://www.example.com/why-pms-drop-tools",
  title: "Why PMs drop new tools",
  text: "Most product managers abandon a new tool within two weeks when it does not fit their existing workflow. In our survey, 62% said setup took too long. Teams also distrust AI summaries they can't trace back to a source.",
};
const market: Market = { company: [{ id: "c1", text: "Qalam helps product teams find problems worth solving.", by: "qalam", at: 1 }], competitors: [{ id: "k1", name: "Productboard", lines: [], by: "qalam", at: 1 }], aims: [], struggles: [{ id: "s1", text: "Product managers struggle to keep customer feedback in one place.", by: "qalam", at: 1 }], gone: [] };

describe("looking on the web for what gets in a goal's way", () => {
  it("asks what usually keeps goals like it from moving, or what their answers called for", () => {
    const opening = focusTask({ org: "Qalam", about: "A tool for product teams.", chain: [goal, north], goal, facts: market.company });
    expect(opening).toContain("A goal of the company's: “More product managers adopt Qalam” (PMs who have adopted Qalam: 40 → 200 PMs).");
    expect(opening).toContain("It feeds: “Qalam is how product teams decide what to build”.");
    expect(opening).toContain("- Qalam helps product teams find problems worth solving.");
    expect(opening).toContain("What usually keeps companies like it from reaching a goal like this one");
    const asked = focusTask({ org: "Qalam", about: "", chain: [goal], goal, query: "  why PMs abandon   discovery tools ", said: "Setup takes them too long." });
    expect(asked).toContain("Look up: why PMs abandon discovery tools.");
    expect(asked).toContain("What the team told us about it: Setup takes them too long.");
  });

  it("keeps a line only where its quote is on its page word for word and its numbers are in the quote, once", () => {
    const m = focusMaterial({ org: "Qalam", goal, notes: "- PMs drop tools [Why PMs drop new tools](https://www.example.com/why-pms-drop-tools)", pages: [page] });
    expect(m.text).toContain('<page id="w1" title="Why PMs drop new tools"');
    let n = 0;
    const dropped: string[] = [];
    const lines = sanitizeLook(
      {
        lines: [
          { text: "Product managers abandon a new tool within two weeks when it doesn't fit their workflow.", quote: "abandon a new tool within two weeks when it does not fit their existing workflow", page: "w1" },
          { text: "62% of product managers said setup took too long.", quote: "62% said setup took too long", page: "w1" },
          { text: "80% said setup took too long.", quote: "said setup took too long", page: "w1" },
          { text: "Teams distrust AI summaries.", quote: "Teams love AI summaries", page: "w1" },
          { text: "62% of product managers said setup took too long.", quote: "62% said setup took too long", page: "w1" },
          { text: "On a page never read.", quote: "anything", page: "w9" },
        ],
      },
      m,
      { now: 5, id: () => `f${++n}` },
      (why) => dropped.push(why),
    );
    expect(lines.map((l) => [l.text, l.url, l.by])).toEqual([
      ["Product managers abandon a new tool within two weeks when it doesn't fit their workflow.", page.url, "qalam"],
      ["62% of product managers said setup took too long.", page.url, "qalam"],
    ]);
    expect(lines[1].quote).toBe("62% said setup took too long");
    expect(dropped).toEqual(["its quote isn't on its page, or a number isn't in it", "its quote isn't on its page, or a number isn't in it", "there twice", "its quote isn't on its page, or a number isn't in it"]);
  });

  it("leaves out what an earlier look found, and tells the call so", () => {
    const known = [{ id: "f0", text: "Most PMs drop a tool that doesn't fit.", quote: "62% said setup took too long", by: "qalam" as const, at: 1 }];
    const m = focusMaterial({ org: "Qalam", goal, query: "setup time", known, notes: "", pages: [page] });
    expect(m.text).toContain("Found on earlier looks (leave these out: only what's new, or what bears on what was looked up):\n- Most PMs drop a tool that doesn't fit.");
    const dropped: string[] = [];
    const lines = sanitizeLook({ lines: [{ text: "62% said setup took too long.", quote: "62% said setup took too long", page: "w1" }, { text: "Teams distrust AI summaries they can't trace.", quote: "Teams also distrust AI summaries they can't trace back to a source", page: "w1" }] }, m, { now: 1, id: () => "f1", known }, (why) => dropped.push(why));
    expect(lines.map((l) => l.text)).toEqual(["Teams distrust AI summaries they can't trace."]);
    expect(dropped).toEqual(["an earlier look found it"]);
  });
});

describe("the opening questions for a goal's problem", () => {
  it("asks code's own open questions when nothing held", () => {
    const qs = focusRound();
    expect(qs.map((q) => q.title)).toEqual(["Who has to do something different for it to move?", "What gets in their way today, as far as you know?", "What have you tried for it so far, and what happened?"]);
    expect(qs.every((q) => !q.options.length)).toBe(true);
  });

  it("draws the choices from the goal, the company, what the look found and the domain", () => {
    const lines = [{ id: "f1", text: "Product managers abandon a new tool within two weeks when it doesn't fit their workflow.", url: page.url, by: "qalam" as const, at: 1 }];
    const m = focusQuestionsMaterial({ org: "Qalam", about: "A tool for product teams.", goal, chain: [goal, north], market, lines });
    expect(m.text).toContain("They want to find the problem to focus on to move their goal “More product managers adopt Qalam”");
    expect(m.text).toContain("What usually gets in the way of goals like it (read on the web just now, others' words):\n- Product managers abandon a new tool");
    expect(m.text).toContain("Its competitors: Productboard");
    expect(m.known).toEqual(expect.arrayContaining(["More product managers adopt Qalam", lines[0].text, market.struggles[0].text, "Productboard"]));
  });
});

describe("a goal's conversation as its source reads", () => {
  it("says what was looked up first, then each question and their answer; only the answers are theirs", () => {
    const look: FocusLook = { at: 1, query: "", lines: [{ id: "f1", text: "Product managers abandon a new tool within two weeks.", url: page.url, by: "qalam", at: 1 }], pages: [] };
    const qs = focusRound();
    const r = focusTranscript(qs, { who: "Product managers at startups", way: "Setting it up takes them a whole afternoon", tried: "" }, { goal: "More product managers adopt Qalam", org: "Qalam", look });
    expect(r.text).toBe(
      [
        "Finding the problem to focus on for “More product managers adopt Qalam” at Qalam: Qalam AI asked, and you answered.",
        "What Qalam AI read on the web before asking (others' words, not yours or your customers'):\n- Product managers abandon a new tool within two weeks. (example.com)",
        "Who has to do something different for it to move?\nProduct managers at startups",
        "What gets in their way today, as far as you know?\nSetting it up takes them a whole afternoon",
      ].join("\n\n"),
    );
    const spans = partSpans(r.text, r.parts);
    expect(spans.theirs.map((s) => r.text.slice(...s))).toEqual(["Product managers at startups", "Setting it up takes them a whole afternoon"]);
    // The web's line is neither theirs nor a heading.
    expect(spans.heads.map((s) => r.text.slice(...s))).not.toContain("- Product managers abandon a new tool within two weeks. (example.com)");
    expect(lookHead({ query: "why PMs drop tools" })).toBe("Qalam AI looked on the web for “why PMs drop tools” (others' words, not yours or your customers'):");
  });

  it("leaves the web out when the look found nothing", () => {
    const r = focusTranscript(focusRound(), { who: "Product managers" }, { goal: "More PMs adopt it", look: { at: 1, query: "", lines: [], pages: [] } });
    expect(r.text).not.toContain("on the web");
  });
});
