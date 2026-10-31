import { afterEach, describe, expect, it } from "vitest";
import { setLab } from "@/lab";
import { backingLine, nextSteps, type CardFacts } from "./next";

const none = { quotes: 0, sources: 0, ours: 0, online: 0, against: 0, who: [], from: [] };
const facts = (over: Partial<CardFacts> = {}): CardFacts => ({ kind: "opportunity", evidence: none, page: null, under: { solutions: 0, tests: 0 }, pages: 0, search: false, material: false, tools: null, feeds: [], answered: false, ai: true, reviewing: false, busyElsewhere: false, ...over });
const goal = (over: Partial<NonNullable<CardFacts["goal"]>> = {}) => ({ id: "g1", number: null, behind: 0, job: null, pending: 0, drafted: 0, ...over });
const ids = (f: CardFacts) => nextSteps(f).map((s) => s.id);

describe("a card's next steps", () => {
  it("lead a problem with drafting its solutions, then its page", () => {
    expect(ids(facts())).toEqual(["draft-solutions", "add-file"]);
    expect(ids(facts({ page: { topic: "late-orders", strength: "thin", quotes: 2, sources: 1 } }))).toEqual(["draft-solutions", "add-file", "page", "questions"]);
  });

  it("lead a solution with its tests, then designing it", () => {
    expect(ids(facts({ kind: "solution" }))).toEqual(["draft-tests", "design-this"]);
    expect(nextSteps(facts({ kind: "solution", under: { solutions: 0, tests: 1 } }))[0].hint).toBe("More of what it assumes, and a test");
  });

  it("offer a test only the pass line Qalam AI suggested, while nobody has set one", () => {
    expect(ids(facts({ kind: "test", suggested: true }))).toEqual(["pass-line"]);
    expect(ids(facts({ kind: "test" }))).toEqual([]);
  });

  it("lead a goal with its problems while none is behind it, found among the pages, else drafted; else with breaking it down", () => {
    expect(ids(facts({ kind: "outcome", pages: 5, goal: goal() }))).toEqual(["find-problems", "draft-problems", "break-down", "others", "add-file"]);
    expect(ids(facts({ kind: "outcome", pages: 5, goal: goal({ behind: 2 }) }))).toEqual(["break-down", "find-problems", "draft-problems", "others", "add-file"]);
    expect(nextSteps(facts({ kind: "outcome", pages: 5, goal: goal({ behind: 2 }) }))[2].hint).toBe("More problems that would move it");
    // No problem pages to read: nothing to find, its problems drafted first.
    expect(ids(facts({ kind: "outcome", goal: goal() }))).toEqual(["draft-problems", "break-down", "others", "add-file"]);
  });

  it("offer a goal what was proposed for it before asking again, waiting reviews first", () => {
    const steps = nextSteps(facts({ kind: "outcome", pages: 5, goal: goal({ pending: 3 }) }));
    expect(steps.map((s) => s.id)).toEqual(["review-parts", "find-problems", "draft-problems", "others", "add-file"]);
    expect(steps[0]).toMatchObject({ label: "Review the 3 goals proposed under it" });
    expect(steps[0].ai).toBeUndefined();
    const drafted = nextSteps(facts({ kind: "outcome", goal: goal({ behind: 1, drafted: 2 }) }));
    expect(drafted.map((s) => s.id)).toEqual(["review-problems", "break-down", "others", "add-file"]);
    expect(drafted[0]).toMatchObject({ label: "Review the 2 problems drafted for it" });
    expect(drafted[0].ai).toBeUndefined();
  });

  it("end a goal's steps with its next job", () => {
    expect(nextSteps(facts({ kind: "outcome", goal: goal({ job: "Ask five families" }) })).at(-1)).toMatchObject({ id: "next-job", label: "Next: Ask five families" });
  });

  it("ground a problem: the organization's words first while nothing backs it, then a tool, then a file", () => {
    const can = { search: true, material: true, tools: ["Intercom"] };
    expect(ids(facts(can))).toEqual(["find-backing", "draft-solutions", "watch", "add-file"]);
    expect(nextSteps(facts(can))[2].label).toBe("Watch Intercom for it");
    // Backed already: drafting first, more of what backs it next.
    const backed = nextSteps(facts({ ...can, evidence: { ...none, quotes: 2, sources: 1 } }));
    expect(backed.map((s) => s.id)).toEqual(["draft-solutions", "find-backing", "watch", "add-file", "questions"]);
    expect(backed[1].label).toBe("Find more that backs it");
  });

  it("offer Connections when no tool that brings material in is connected, and nothing while that isn't known", () => {
    expect(ids(facts({ tools: [] }))).toEqual(["draft-solutions", "connect", "add-file"]);
    expect(ids(facts({ tools: null }))).toEqual(["draft-solutions", "add-file"]);
    expect(nextSteps(facts({ tools: ["Intercom", "Slack"] }))[1].label).toBe("Watch a tool for it");
  });

  it("search the organization only where its search answers and it has material", () => {
    expect(ids(facts({ search: false, material: true, tools: [] }))).not.toContain("find-backing");
    expect(ids(facts({ search: true, material: false, tools: [] }))).not.toContain("find-backing");
  });

  it("ground a goal with a tool and a file after its own steps, never with quotes", () => {
    expect(ids(facts({ kind: "outcome", search: true, material: true, tools: ["Slack"], goal: goal({ behind: 1 }) }))).toEqual(["break-down", "draft-problems", "others", "watch", "add-file"]);
  });

  it("ask first where nothing backs the card, and draft at once once it rests on something", () => {
    const thin = nextSteps(facts({ tools: [] }));
    expect(thin[0]).toMatchObject({ id: "draft-solutions", asks: true, hint: "Asks a few questions first" });
    expect(thin.map((s) => s.id)).not.toContain("questions");
    // Backed, or answered before: it drafts at once, and the questions stay in More.
    for (const f of [facts({ tools: [], evidence: { ...none, quotes: 1, sources: 1 } }), facts({ tools: [], answered: true })]) {
      const steps = nextSteps(f);
      expect(steps[0].asks).toBeUndefined();
      expect(steps.at(-1)).toMatchObject({ id: "questions", label: "Answer a few questions first" });
    }
    // A goal with nothing behind it asks before drafting its problems and before breaking it down.
    expect(nextSteps(facts({ kind: "outcome", goal: goal() })).slice(0, 2)).toMatchObject([
      { id: "draft-problems", asks: true, hint: "Asks a few questions first" },
      { id: "break-down", asks: true },
    ]);
    expect(nextSteps(facts({ kind: "outcome", goal: goal({ behind: 1 }) })).map((s) => s.asks)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("pick up questions left half-way, even on a card that rests on something", () => {
    expect(nextSteps(facts({ tools: [], evidence: { ...none, quotes: 2, sources: 1 }, asking: true }))[0]).toMatchObject({ id: "draft-solutions", asks: true, hint: "Picks up your answers where you left them" });
  });

  it("say why Qalam AI can't run a step now, and leave the rest to run", () => {
    expect(nextSteps(facts({ ai: false }))[0].blocked).toBe("Qalam AI isn't ready here");
    expect(nextSteps(facts({ reviewing: true }))[0].blocked).toBe("Accept or discard the proposals first");
    expect(nextSteps(facts({ busyElsewhere: true }))[0].blocked).toBe("Qalam AI is on another card");
    expect(nextSteps(facts({ kind: "solution", ai: false })).map((s) => s.blocked)).toEqual(["Qalam AI isn't ready here", undefined]);
  });
});

describe("a card's next steps in v0.1 (src/lab.ts)", () => {
  afterEach(() => setLab(true));

  it("offer only the loop: drafting solutions, what backs a card, its page, a goal's problems, a file", () => {
    setLab([]);
    const can = { search: true, material: true, tools: ["Intercom"] };
    // Nothing behind a problem: what the organization has first, then drafting at once; no tool, no questions.
    const thin = nextSteps(facts(can));
    expect(thin.map((s) => s.id)).toEqual(["find-backing", "draft-solutions", "add-file"]);
    expect(thin[1]).toMatchObject({ hint: "Ways to solve it, each with a test" });
    expect(thin[1].asks).toBeUndefined();
    expect(ids(facts({ tools: [], asking: true, evidence: { ...none, quotes: 2, sources: 1 }, page: { topic: "late-orders", strength: "thin", quotes: 2, sources: 1 } }))).toEqual(["draft-solutions", "add-file", "page"]);
    expect(ids(facts({ ...can, kind: "solution" }))).toEqual(["find-backing"]);
    expect(ids(facts({ ...can, kind: "outcome", pages: 5, goal: goal({ pending: 2, drafted: 1, job: "Ask five families" }) }))).toEqual(["find-problems", "add-file"]);
    expect(ids(facts({ kind: "outcome", goal: goal() }))).toEqual(["add-file"]);
  });

  it("bring a feature's steps back once it's on, and ask first only with the questions on", () => {
    setLab(["tests", "goals"]);
    expect(ids(facts({ kind: "solution" }))).toEqual(["draft-tests"]);
    const steps = nextSteps(facts({ kind: "outcome", pages: 5, goal: goal() }));
    expect(steps.map((s) => s.id)).toEqual(["find-problems", "draft-problems", "break-down", "others", "add-file"]);
    expect(steps.some((s) => s.asks)).toBe(false);
    setLab(["questions"]);
    expect(nextSteps(facts())[0]).toMatchObject({ id: "draft-solutions", asks: true });
  });
});

describe("what a card rests on, in a line", () => {
  it("counts customers' quotes and their sources, and what speaks against it", () => {
    expect(backingLine(facts({ evidence: { ...none, quotes: 4, sources: 2, against: 1 } }))).toBe("Rests on 4 quotes from 2 sources · 1 against");
    expect(backingLine(facts({ evidence: { ...none, quotes: 1, sources: 1 } }))).toBe("Rests on 1 quote from 1 source");
  });

  it("falls back to its page, the team's words, people online, then nothing", () => {
    expect(backingLine(facts({ page: { topic: "t", strength: "growing", quotes: 6, sources: 2 } }))).toBe("Its page rests on 6 quotes from 2 sources");
    expect(backingLine(facts({ evidence: { ...none, ours: 2 } }))).toBe("Only your words so far");
    expect(backingLine(facts({ evidence: { ...none, online: 3 } }))).toBe("Only people online: 3 posts");
    expect(backingLine(facts())).toBe("Nothing behind it yet");
    expect(backingLine(facts({ kind: "solution" }))).toBe("Rests on the problem above it");
  });

  it("says which tools watch for it", () => {
    expect(backingLine(facts({ evidence: { ...none, quotes: 4, sources: 2 }, feeds: ["Intercom"] }))).toBe("Rests on 4 quotes from 2 sources · watched in Intercom");
  });

  it("gives a goal its number and the problems behind it", () => {
    expect(backingLine(facts({ kind: "outcome", goal: goal({ number: "12% → 18%", behind: 4 }) }))).toBe("12% → 18% · 4 problems behind it");
    expect(backingLine(facts({ kind: "outcome", goal: goal() }))).toBe("No number yet · nothing behind it yet");
  });
});
