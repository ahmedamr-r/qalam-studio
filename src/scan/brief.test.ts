import { describe, expect, it } from "vitest";
import type { SolutionDraft } from "@/discovery/solutions";
import { briefMarkdown, briefMaterial, briefRound, sanitizeBrief, type BriefData } from "./brief";

const target = { kind: "idea" as const, said: "A tool that helps wedding photographers get paid on time" };
const problem = { id: "t1", title: "Couples don't pay the balance once the wedding is over", lines: ["Balances go unpaid after the wedding."], cites: ["hub:quote:a"] };
const words = [
  { ref: "hub:quote:a", text: "She paid the deposit, then ghosted me for 3 months.", source: "DV Info Net", origin: "https://dvinfo.example/t/1" },
  { ref: "hub:quote:b", text: "I chase every final invoice by hand.", source: "App Store reviews: Studio", origin: "https://apps.apple.com/app/id1" },
];
const draft: SolutionDraft = {
  id: "d1",
  title: "Auto-charge the balance before the date",
  description: "A card saved at booking pays the balance on a set date.",
  cites: { lines: [], pieces: [], goals: [], claims: [], steps: [] },
  idea: null,
  assumptions: [
    { id: "a1", category: "desirability", text: "Photographers will ask for a card at booking.", importance: 3 },
    { id: "a2", category: "usability", text: "Couples read the terms.", importance: 1 },
  ],
  test: { assumption: "a1", what: "Offer it to 8 photographers", how: "Set it up by hand for their next booking.", suggested: "5 of 8 use it" },
  at: 1,
};
const sent = () => briefMaterial({ target, audience: "Solo wedding photographers", goal: "5 of 10 solo wedding photographers sign up", answers: "", asked: { platform: "A web app" }, problem, words, draft, published: ["56% of small businesses have unpaid invoices."] });
const feature = (o: Record<string, unknown> = {}) => ({ title: "Save a card at booking", why: "“She paid the deposit, then ghosted me” is what it stops.", acceptance: ["A couple can save a card when they book"], data: ["Booking date"], connects: ["A payment provider"], quotes: ["q1"], ...o });

describe("what a brief keeps", () => {
  it("keeps a feature resting on a quote it was sent, with something to check it by", () => {
    const [f] = sanitizeBrief({ features: [feature()] }, sent());
    expect(f.title).toBe("Save a card at booking");
    expect(f.quotes).toEqual([{ text: words[0].text, source: "DV Info Net", url: "https://dvinfo.example/t/1" }]);
    expect(f.acceptance).toEqual(["A couple can save a card when they book"]);
  });

  it("drops a feature resting on nothing, on an id it wasn't sent, or with nothing to check", () => {
    const why: string[] = [];
    const kept = sanitizeBrief({ features: [feature({ quotes: [] }), feature({ quotes: ["q99"] }), feature({ acceptance: [] })] }, sent(), (w) => why.push(w));
    expect(kept).toEqual([]);
    expect(why).toEqual(["it rests on nothing anyone said", "it rests on nothing anyone said", "nothing to check it by"]);
  });

  it("holds why it's worth building to what was sent, numbers and quoted words alike", () => {
    expect(sanitizeBrief({ features: [feature({ why: "It saves photographers 40% of what they lose." })] }, sent())).toEqual([]);
    expect(sanitizeBrief({ features: [feature({ why: "“Couples never pay on time” is what people say." })] }, sent())).toEqual([]);
    expect(sanitizeBrief({ features: [feature({ why: "A balance can go unpaid for 3 months." })] }, sent())).toHaveLength(1);
  });

  it("takes a feature's own numbers as a plan, and words nobody said as wording it proposes", () => {
    const [f] = sanitizeBrief({ features: [feature({ acceptance: ["The balance is charged 14 days before the date", "The email says “Your balance is due”"] })] }, sent());
    expect(f.acceptance).toEqual(["The balance is charged 14 days before the date", "The email says ‘Your balance is due’"]);
  });

  it("keeps at most four, and takes ids out of what it wrote", () => {
    const many = sanitizeBrief({ features: Array.from({ length: 6 }, (_, i) => feature({ title: `Feature ${"abcdef"[i]} (q1)` })) }, sent());
    expect(many).toHaveLength(4);
    expect(many[0].title).not.toContain("q1");
  });

  it("asks only what it lacks, and every question can be left", () => {
    expect(briefRound().map((q) => q.id)).toEqual(["platform", "exists", "needs"]);
  });
});

describe("the brief as a file", () => {
  const data = (o: Partial<BriefData> = {}): BriefData => ({
    target,
    at: Date.UTC(2026, 10, 3),
    audience: "Solo wedding photographers",
    about: "They shoot alone and chase their own invoices",
    goal: { title: "5 of 10 solo wedding photographers sign up", metric: "Signed up, of 10 asked" },
    problem: { title: problem.title, lines: problem.lines, open: ["Would couples accept a card on file?"] },
    quotes: words.map((w) => ({ text: w.text, source: w.source, url: w.origin })),
    draft,
    why: "It answers the ghosting directly.",
    later: [{ title: "Lock the gallery", why: "It needs the gallery first." }],
    features: sanitizeBrief({ features: [feature()] }, sent()),
    asked: { platform: "A web app", needs: "Payments" },
    known: [{ kind: "product", name: "HoneyBook", text: "HoneyBook costs $19 a month.", title: "Pricing", url: "https://honeybook.example/pricing" }, { kind: "published", text: "56% of small businesses have unpaid invoices.", title: "A report", url: "https://r.example" }],
    ...o,
  });

  it("has what's decided, what's suggested, and every quote linked to where it was said", () => {
    const md = briefMarkdown(data());
    for (const part of ["# Build brief: Auto-charge the balance before the date", "strongest signal so far", "## Who it's for first", "5 of 10 solo wedding photographers sign up", "Why this first: It answers the ghosting directly.", "Suggested from the above", "- [ ] A couple can save a card when they book", "It keeps: Booking date.", "It connects to: A payment provider.", "## What would prove it wrong", "Photographers will ask for a card at booking.", "A suggested pass line, yours to change: 5 of 8 use it", "- Lock the gallery: It needs the gallery first.", "Would couples accept a card on file?", "People like solo wedding photographers. Still open:", "It runs first: A web app.", "Accounts or payments in the first version: Payments."]) expect(md).toContain(part);
    expect(md).toContain("“She paid the deposit, then ghosted me for 3 months.” ([DV Info Net](https://dvinfo.example/t/1))");
  });

  it("says what's read elsewhere apart, and that nothing rests on it", () => {
    const md = briefMarkdown(data());
    const at = md.indexOf("## Read elsewhere");
    expect(at).toBeGreaterThan(md.indexOf("## Build first"));
    expect(md.slice(at)).toContain("Not what these people said, and nothing above rests on it.");
    expect(md.slice(at)).toContain("HoneyBook: HoneyBook costs $19 a month. ([Pricing](https://honeybook.example/pricing))");
  });

  it("leaves out what it hasn't got, and tells the agent to choose its own stack", () => {
    const md = briefMarkdown(data({ features: [], later: [], known: [], asked: {}, problem: { title: "A problem", lines: [], open: [] }, draft: { ...draft, test: null } }));
    for (const gone of ["### What to build", "## What waits", "## Read elsewhere", "It runs first", "## Who to talk to", "## Test it first"]) expect(md).not.toContain(gone);
    expect(md).toContain("Choose the stack yourself");
    expect(md).toContain("Don't copy them into the product");
  });

  it("never lets a title off the web break out of its link", () => {
    const md = briefMarkdown(data({ quotes: [{ text: "Words.", source: "Evil](https://evil.example) [x", url: "javascript:alert(1)" }] }));
    expect(md).not.toContain("](https://evil.example)");
    expect(md).not.toContain("javascript:");
  });
});
