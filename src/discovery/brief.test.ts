import { describe, expect, it } from "vitest";
import { askedFromAnswers, askedOf, briefFile, briefFromFile, briefMarkdown, briefMaterial, briefRound, sanitizeBrief, type BriefData } from "./brief";

const words = [
  { text: "She paid the deposit, then ghosted me for 3 months.", source: "DV Info Net", url: "https://dvinfo.example/t/1" },
  { text: "I chase every final invoice by hand.", source: "App Store reviews: Studio", url: "https://apps.apple.com/app/id1" },
];
const problem = { title: "Couples don't pay the balance once the wedding is over", lines: ["Balances go unpaid after the wedding."] };
const build = { title: "Auto-charge the balance before the date", description: "A card saved at booking pays the balance on a set date.", assumptions: ["Photographers will ask for a card at booking.", "Couples read the terms."], test: { what: "Offer it to 8 photographers", how: "Set it up by hand for their next booking." } };
const sent = () => briefMaterial({ about: "What they want to build: A tool that helps wedding photographers get paid on time", audience: "Solo wedding photographers", goal: "5 of 10 solo wedding photographers sign up", asked: { platform: "A web app" }, problems: [problem], words, build, published: ["56% of small businesses have unpaid invoices."] });
const feature = (o: Record<string, unknown> = {}) => ({ title: "Save a card at booking", why: "“She paid the deposit, then ghosted me” is what it stops.", acceptance: ["A couple can save a card when they book"], data: ["Booking date"], connects: ["A payment provider"], quotes: ["q1"], ...o });

describe("what's written for each type of solution", () => {
  const data = (o: Partial<BriefData> = {}): BriefData => ({ at: 1, title: "Text after a visit", problems: [], quotes: [], later: [], features: [{ title: "After each job, by SMS", why: "", acceptance: ["‘How did we do? Search us on Google.’"], data: [], connects: ["Twilio"], quotes: [] }], asked: { platform: "SMS", exists: "A list of 40 customers" }, known: [], ...o });

  it("writes a message plan with what to send and how it goes out, and nothing for a coding agent", () => {
    const md = briefMarkdown(data({ shape: "message" }));
    expect(md).toContain("# Message plan: Text after a visit");
    expect(md).toContain("## What to send");
    expect(md).toContain("Say:\n\n> How did we do? Search us on Google.");
    expect(md).toContain("It goes out through: Twilio.");
    expect(md).toContain("- First on: SMS.");
    expect(md).toContain("- To whom, and with what: A list of 40 customers.");
    expect(md).toContain("Rests on nothing anyone has said yet");
    expect(md).not.toContain("coding agent");
  });

  it("writes steps to run, and a brief to build as it always has", () => {
    const steps = briefMarkdown(data({ shape: "steps" }));
    expect(steps).toContain("# Steps to run: Text after a visit");
    expect(steps).toContain("## The steps");
    expect(steps).toContain("- Run by: SMS.");
    expect(steps).not.toContain("coding agent");
    const build = briefMarkdown(data());
    expect(build).toContain("# Brief: Text after a visit");
    expect(build).toContain("## For the coding agent");
  });

  it("lists a New product's modules, with what it needs set apart", () => {
    const md = briefMarkdown(data({ modules: [{ title: "Ask for reviews", how: "SMS through Twilio" }, { title: "Login and billing", needed: true }] }));
    expect(md).toContain("## Modules");
    expect(md).toContain("- Ask for reviews: SMS through Twilio");
    expect(md.indexOf("Needed to run it")).toBeGreaterThan(md.indexOf("Ask for reviews"));
    expect(md.indexOf("- Login and billing")).toBeGreaterThan(md.indexOf("Needed to run it"));
  });

  it("asks what each lacks, and keeps what it is in the file", () => {
    expect(briefRound("message")[0].title).toBe("Which channel first?");
    expect(briefRound("steps")[0].title).toBe("Who runs it?");
    expect(briefRound().map((q) => q.id)).toEqual(["platform", "exists", "needs"]);
    const file = briefFile({ id: "b", card: "c", kind: "solution", title: "T", at: 1, features: 1, shape: "message" }, "Body");
    expect(briefFromFile(file, "hub/briefs/t.md")?.meta.shape).toBe("message");
    expect(briefFromFile(briefFile({ id: "b", card: "c", kind: "solution", title: "T", at: 1, features: 1 }, "Body"), "x")?.meta.shape).toBeUndefined();
  });
});

describe("what a brief keeps", () => {
  it("keeps a feature resting on a quote it was sent, with something to check it by", () => {
    const [f] = sanitizeBrief({ features: [feature()] }, sent());
    expect(f.title).toBe("Save a card at booking");
    expect(f.quotes).toEqual([words[0]]);
    expect(f.acceptance).toEqual(["A couple can save a card when they book"]);
  });

  it("keeps a feature resting on nothing, with no quotes to show, and drops one with nothing to check", () => {
    const why: string[] = [];
    const kept = sanitizeBrief({ features: [feature({ quotes: [] }), feature({ quotes: ["q99"] }), feature({ acceptance: [] })] }, sent(), (w) => why.push(w));
    expect(kept.map((f) => f.quotes)).toEqual([[], []]);
    expect(why).toEqual(["nothing to check it by"]);
  });

  it("holds why it's worth building to what was sent: what wasn't comes out, and the feature stays", () => {
    expect(sanitizeBrief({ features: [feature({ why: "It saves photographers 40% of what they lose." })] }, sent())[0].why).toBe("");
    expect(sanitizeBrief({ features: [feature({ why: "“Couples never pay on time” is what people say." })] }, sent())[0].why).toBe("");
    expect(sanitizeBrief({ features: [feature({ why: "A balance can go unpaid for 3 months." })] }, sent())[0].why).toBe("A balance can go unpaid for 3 months.");
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
    at: Date.UTC(2026, 10, 3),
    title: build.title,
    audience: "Solo wedding photographers",
    about: "They shoot alone and chase their own invoices",
    goal: { title: "5 of 10 solo wedding photographers sign up", metric: "Signed up, of 10 asked" },
    problems: [{ title: problem.title, lines: problem.lines, open: ["Would couples accept a card on file?"] }],
    quotes: words,
    build: { title: build.title, description: build.description, why: "It answers the ghosting directly.", wrong: build.assumptions[0], test: { ...build.test, suggested: "5 of 8 use it" } },
    later: [{ title: "Lock the gallery", why: "It needs the gallery first." }],
    features: sanitizeBrief({ features: [feature()] }, sent()),
    asked: { platform: "A web app", needs: "Payments" },
    known: [{ kind: "product", name: "HoneyBook", text: "HoneyBook costs $19 a month.", title: "Pricing", url: "https://honeybook.example/pricing" }, { kind: "published", text: "56% of small businesses have unpaid invoices.", title: "A report", url: "https://r.example" }],
    ...o,
  });

  it("has what's decided, what's suggested, and every quote linked to where it was said", () => {
    const md = briefMarkdown(data());
    for (const part of ["# Brief: Auto-charge the balance before the date", "strongest signal so far", "## Who it's for first", "5 of 10 solo wedding photographers sign up", "Why this first: It answers the ghosting directly.", "## What to build", "Suggested from the above", "- [ ] A couple can save a card when they book", "It keeps: Booking date.", "It connects to: A payment provider.", "## What has to be true", "Photographers will ask for a card at booking.", "A suggested pass line, yours to change: 5 of 8 use it", "- Lock the gallery: It needs the gallery first.", "Would couples accept a card on file?", "People like solo wedding photographers. Still open:", "It runs first: A web app.", "Accounts or payments in the first version: Payments."]) expect(md).toContain(part);
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
    const md = briefMarkdown(data({ features: [], later: [], known: [], asked: {}, problems: [{ title: "A problem", lines: [], open: [] }], build: { title: "A", description: "B" } }));
    for (const gone of ["## What to build", "## What waits", "## Read elsewhere", "It runs first", "## Who to talk to", "## Test it first"]) expect(md).not.toContain(gone);
    expect(md).toContain("Choose the stack yourself");
    expect(md).toContain("Don't copy them into the product");
  });

  it("writes for a goal, for a problem with solutions and no pick, and says when nothing backs it", () => {
    const goal = briefMarkdown(data({ title: "Reach 50 paying studios", build: undefined, features: [], later: [], problems: [{ title: "One", lines: ["It hurts."], open: [] }, { title: "Two", lines: [], open: ["Who?"] }], quotes: words }));
    expect(goal).toContain("# Brief: Reach 50 paying studios");
    expect(goal).toContain("## The problems");
    expect(goal).toContain("### One");
    expect(goal).toContain("Still open:");
    const options = briefMarkdown(data({ build: undefined, options: ["Lock the gallery", "Send a notice"] }));
    expect(options).toContain("## Solutions so far");
    expect(options).not.toContain("## Build first");
    const bare = briefMarkdown(data({ build: undefined, features: [], quotes: [] }));
    expect(bare).toContain("Nothing backs this yet");
  });

  it("never lets a title off the web break out of its link", () => {
    const md = briefMarkdown(data({ quotes: [{ text: "Words.", source: "Evil](https://evil.example) [x", url: "javascript:alert(1)" }] }));
    expect(md).not.toContain("](https://evil.example)");
    expect(md).not.toContain("javascript:");
  });
});

describe("a brief's file", () => {
  const meta = { id: "b1", card: "c1", kind: "solution" as const, title: 'A "quoted" title: with a colon', at: 5, features: 3 };

  it("reads back what it was written with, and whatever's under it now", () => {
    const text = briefFile(meta, "# Brief: x\n\nWords.\n");
    expect(briefFromFile(text, "hub/briefs/x.md")).toEqual({ meta: { ...meta, file: "hub/briefs/x.md" }, body: "# Brief: x\n\nWords.\n" });
    expect(briefFromFile(text.replace("Words.", "Edited by hand."), "x")?.body).toContain("Edited by hand.");
  });

  it("isn't taken in by a file that isn't one", () => {
    expect(briefFromFile("# Just notes\n", "x")).toBeNull();
    expect(briefFromFile('---\nqalam: "goals/1"\n---\n', "x")).toBeNull();
    expect(briefFromFile(briefFile(meta, "").replace('"solution"', '"test"'), "x")).toBeNull();
    expect(briefFromFile("", "x")).toBeNull();
  });
});

describe("what was asked before a brief is written", () => {
  it("keeps code's answers and what else they said, each clipped, nothing empty", () => {
    expect(askedOf({ platform: "  A web app ", needs: "", more: [{ question: "Who first?", answer: "Night nurses" }, { question: "Empty?", answer: "  " }, "nope"], other: 1 })).toEqual({ platform: "A web app", more: [{ question: "Who first?", answer: "Night nurses" }] });
    expect(askedOf(null)).toEqual({});
    expect(askedOf({ more: Array.from({ length: 30 }, (_, i) => ({ question: `Q${i}?`, answer: "A" })) }).more).toHaveLength(20);
  });

  it("keeps what the interview settled: code's own answers as before, the rest as said, Qalam AI's picks marked, nothing left", () => {
    const a = (id: string, question: string, text: string, how: "own" | "pick" | "left" | "unknown") => ({ id, round: 0, question, text, typed: how === "own" ? text : "", how });
    expect(
      askedFromAnswers([
        a("platform", "Where does it run?", "A web app", "own"),
        a("exists", "What exists already?", "", "left"),
        a("q1", "Who first?", "Night nurses", "own"),
        a("q2", "Paid or free?", "Free to start", "pick"),
        a("q3", "Which country?", "", "left"),
        a("q4", "How many nurses a shift?", "no idea", "unknown"),
        a("exists", "What exists already?", "I don't know yet", "unknown"),
      ]),
    ).toEqual({ platform: "A web app", more: [{ question: "Who first?", answer: "Night nurses" }, { question: "Paid or free?", answer: "Qalam AI's pick, which they agreed to: Free to start" }] });
    expect(askedFromAnswers([a("needs", "Accounts or payments?", "Payments", "pick")])).toEqual({ needs: "Payments" });
  });

  it("puts what else they said in what the features are worked out from, as their words", () => {
    const m = briefMaterial({ about: "What this is a brief for: X", asked: { more: [{ question: "Who first?", answer: "Night nurses on the ward" }] }, problems: [], words: [] });
    expect(m.text).toContain("Who first? Night nurses on the ward");
    expect(m.hay).toContain("Night nurses on the ward");
  });
});
