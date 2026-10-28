import { describe, expect, it } from "vitest";
import { sourcesIn, verifyAnswer, type Found, claimStrip } from "./ask";

const tickets = "Omar's count of last week's tickets (412 in total):\n- Late or missed delivery: 131 tickets. Most are evening slots that slipped past 10pm.\nCustomers who wrote twice about lateness ordered 40% less the next month.";
const found = new Map<string, Found>([
  ["sources/2026-10-10-support-tickets.md", { text: tickets, label: "Support tickets, week of Oct 6", href: "/o/b/d/delivery?source=tickets" }],
  ["hub:quote:sara-7", { text: "I can't plan bath time around a four-hour window.", label: "Sara · Sara interview" }],
  ["decisions/2026-10.md", { text: "### Made “Evening slots” the target\n\n**Why:** 131 late-delivery tickets are mostly evening slots", label: "Decisions, 2026-10" }],
]);
const o = { question: "Why do parents stop ordering?", how: "agent" as const, at: 1, topic: (n: string) => (n === "hub/topics/late.md" ? "tp1" : null) };

describe("an answer, as code keeps it", () => {
  it("keeps claims whose quotes are where they say, in the source's own words", () => {
    const raw = {
      answer: "Late deliveries cost reorders: customers who wrote twice ordered 40% less, and Sara says “I can't plan bath time around a four-hour window”.",
      claims: [
        { text: "Late delivery is the biggest ticket category, at 131 tickets.", support: [{ source: "sources/2026-10-10-support-tickets.md", quote: "late or missed delivery: 131 tickets" }] },
        { text: "Wide windows break routines.", support: [{ source: "hub:quote:sara-7", quote: "I can’t plan bath time around a four-hour window" }, { source: "hub:quote:gone", quote: "anything" }] },
        { text: "Customers who wrote twice ordered 40% less.", support: [{ source: "sources/2026-10-10-support-tickets.md", quote: "ordered 40% less the next month" }] },
      ],
      unknowns: [{ question: "Is the 40% drop caused by lateness?", why: "No comparison group", topic: "hub/topics/late.md" }],
    };
    expect(sourcesIn(raw)).toEqual(["sources/2026-10-10-support-tickets.md", "hub:quote:sara-7", "hub:quote:gone"]);
    const a = verifyAnswer(raw, found, o);
    expect(a.answer).toBe(raw.answer);
    expect(a.claims.map((c) => c.backed)).toEqual([true, true, true]);
    // The source's own words, not the model's copy (its case, its apostrophe).
    expect(a.claims[0].support).toEqual([{ source: "sources/2026-10-10-support-tickets.md", words: "Late or missed delivery: 131 tickets", label: "Support tickets, week of Oct 6", href: "/o/b/d/delivery?source=tickets" }]);
    expect(a.claims[1].support).toEqual([{ source: "hub:quote:sara-7", words: "I can't plan bath time around a four-hour window", label: "Sara · Sara interview" }]);
    expect(a.unknowns).toEqual([{ question: "Is the 40% drop caused by lateness?", why: "No comparison group", topic: "tp1" }]);
    expect(a).toMatchObject({ question: "Why do parents stop ordering?", how: "agent", at: 1 });
  });

  it("marks what it can't back, and leaves out an answer that says more than what backs it", () => {
    const a = verifyAnswer(
      {
        answer: "Late deliveries cost half of all reorders, 50% of them.",
        claims: [
          { text: "Late delivery tops the tickets.", support: [{ source: "sources/2026-10-10-support-tickets.md", quote: "deliveries are always late" }] },
          { text: "Customers said “they never come on time”.", support: [{ source: "sources/2026-10-10-support-tickets.md", quote: "Late or missed delivery: 131 tickets" }] },
          { text: "Evening slots slip past 10pm.", support: [{ source: "sources/2026-10-10-support-tickets.md", quote: "Most are evening slots that slipped past 10pm" }] },
          { text: "No support at all.", support: [] },
        ],
        unknowns: [{ question: "Ok?", why: "", topic: "none" }, { question: "Do offices see lateness too?", why: "Only parents were asked", topic: "none" }],
      },
      found,
      o,
    );
    // A quote not in the source; a claim quoting words its support doesn't have; nothing named.
    expect(a.claims.map((c) => [c.text, c.backed])).toEqual([
      ["Late delivery tops the tickets.", false],
      ["Customers said “they never come on time”.", false],
      ["Evening slots slip past 10pm.", true],
      ["No support at all.", false],
    ]);
    expect(a.answer).toBeNull();
    expect(a.unknowns).toEqual([{ question: "Do offices see lateness too?", why: "Only parents were asked" }]);
    expect(verifyAnswer(null, found, o)).toMatchObject({ answer: null, claims: [], unknowns: [] });
    // A Markdown file's bold markers aren't part of the words people read.
    const d = verifyAnswer({ answer: "", claims: [{ text: "The target rests on tickets.", support: [{ source: "decisions/2026-10.md", quote: "**Why:** 131 late-delivery tickets are mostly evening slots" }] }], unknowns: [] }, found, o);
    expect(d.claims[0].support[0].words).toBe("Why: 131 late-delivery tickets are mostly evening slots");
  });
});

describe("an answer in numbers", () => {
  it("counts the backed claims, their quotes and the sources those come from, apart from the rest", () => {
    const sup = (label: string) => ({ source: `hub:quote:${label}`, words: "w", label });
    const n = claimStrip({
      claims: [
        { text: "a", backed: true, support: [sup("Sara · Sara interview"), sup("Sara · Sara interview"), sup("Mona · Mona interview")] },
        { text: "b", backed: true, support: [sup("Topic page: Late deliveries")] },
        { text: "c", backed: false, support: [sup("Noor · Noor call")] },
      ],
      unknowns: [{ question: "q", why: "" }],
    });
    expect(n).toEqual({ backed: 2, unbacked: 1, quotes: 4, sources: 3, unknowns: 1 });
  });
});
