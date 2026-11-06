import { afterEach, describe, expect, it } from "vitest";
import { setLab } from "@/lab";
import { backingLine, nextSteps, type CardFacts } from "./next";

const none = { quotes: 0, sources: 0, ours: 0, online: 0, against: 0, who: [], from: [] };
const facts = (over: Partial<CardFacts> = {}): CardFacts => ({ kind: "opportunity", evidence: none, page: null, under: { solutions: 0, tests: 0 }, underGoal: true, pages: 0, search: false, material: false, tools: null, feeds: [], answered: false, ai: true, reviewing: false, busyElsewhere: false, ...over });
const goal = (over: Partial<NonNullable<CardFacts["goal"]>> = {}) => ({ id: "g1", number: null, behind: 0, job: null, pending: 0, drafted: 0, ...over });
// A brief is offered on every goal, problem and solution (its own tests, below): the rest keep their order around it.
const others = (f: CardFacts) => nextSteps(f).filter((s) => s.id !== "write-brief");
const ids = (f: CardFacts) => others(f).map((s) => s.id);

describe("a card's next steps", () => {
  it("lead a problem with drafting its solutions, then its page", () => {
    expect(ids(facts())).toEqual(["draft-solutions", "add-file"]);
    expect(ids(facts({ page: { topic: "late-orders", strength: "thin", quotes: 2, sources: 1 } }))).toEqual(["draft-solutions", "add-file", "page", "questions"]);
  });

  it("offer a problem with no goal above it the goal it could move, Qalam AI's to run", () => {
    const loose = { underGoal: false };
    expect(ids(facts(loose))).toEqual(["draft-solutions", "find-goal", "add-file"]);
    expect(others(facts(loose)).find((s) => s.id === "find-goal")).toMatchObject({ label: "Find the goal it could move", ai: true });
    expect(others(facts({ ...loose, ai: false })).find((s) => s.id === "find-goal")?.blocked).toBe("Qalam AI isn't ready here");
  });

  it("lead a solution with its tests, then designing it", () => {
    expect(ids(facts({ kind: "solution" }))).toEqual(["draft-tests", "design-this"]);
    expect(others(facts({ kind: "solution", under: { solutions: 0, tests: 1 } }))[0].hint).toBe("More of what it assumes, and a test");
  });

  it("offer a test only the pass line Qalam AI suggested, while nobody has set one", () => {
    expect(ids(facts({ kind: "test", suggested: true }))).toEqual(["pass-line"]);
    expect(ids(facts({ kind: "test" }))).toEqual([]);
  });

  it("lead a goal with finding the problem to focus on, then its problems while none is behind it, found among the pages, else drafted; else with breaking it down", () => {
    expect(ids(facts({ kind: "outcome", pages: 5, goal: goal() }))).toEqual(["focus", "find-problems", "draft-problems", "break-down", "others", "add-file"]);
    expect(ids(facts({ kind: "outcome", pages: 5, goal: goal({ behind: 2 }) }))).toEqual(["focus", "break-down", "find-problems", "draft-problems", "others", "add-file"]);
    expect(others(facts({ kind: "outcome", pages: 5, goal: goal({ behind: 2 }) }))[3].hint).toBe("More problems that would move it");
    // No problem pages to read: nothing to find, its problems drafted first.
    expect(ids(facts({ kind: "outcome", goal: goal() }))).toEqual(["focus", "draft-problems", "break-down", "others", "add-file"]);
  });

  it("find the problem to focus on with them in the chat, Qalam AI's to run", () => {
    expect(others(facts({ kind: "outcome", goal: goal() }))[0]).toMatchObject({ id: "focus", label: "Find the problem to focus on", hint: "Qalam AI asks you and looks on the web", ai: true });
    expect(others(facts({ kind: "outcome", goal: goal({ behind: 2 }) }))[0].id).toBe("focus");
    expect(others(facts({ kind: "outcome", goal: goal(), ai: false }))[0].blocked).toBe("Qalam AI isn't ready here");
  });

  it("offer a goal what was proposed for it before asking again, waiting reviews first", () => {
    const steps = others(facts({ kind: "outcome", pages: 5, goal: goal({ pending: 3 }) }));
    expect(steps.map((s) => s.id)).toEqual(["review-parts", "focus", "find-problems", "draft-problems", "others", "add-file"]);
    expect(steps[0]).toMatchObject({ label: "Review the 3 goals proposed under it" });
    expect(steps[0].ai).toBeUndefined();
    const drafted = others(facts({ kind: "outcome", goal: goal({ behind: 1, drafted: 2 }) }));
    expect(drafted.map((s) => s.id)).toEqual(["review-problems", "focus", "break-down", "others", "add-file"]);
    expect(drafted[0]).toMatchObject({ label: "Review the 2 problems drafted for it" });
    expect(drafted[0].ai).toBeUndefined();
  });

  it("end a goal's steps with its next job", () => {
    expect(others(facts({ kind: "outcome", goal: goal({ job: "Ask five families" }) })).at(-1)).toMatchObject({ id: "next-job", label: "Next: Ask five families" });
  });

  it("ground a problem: the organization's words first while nothing backs it, then a tool, then a file", () => {
    const can = { search: true, material: true, tools: ["Intercom"] };
    expect(ids(facts(can))).toEqual(["find-backing", "draft-solutions", "watch", "add-file"]);
    expect(others(facts(can))[2].label).toBe("Watch Intercom for it");
    // Backed already: drafting first, more of what backs it next.
    const backed = others(facts({ ...can, evidence: { ...none, quotes: 2, sources: 1 } }));
    expect(backed.map((s) => s.id)).toEqual(["draft-solutions", "find-backing", "watch", "add-file", "questions"]);
    expect(backed[1].label).toBe("Find more that backs it");
  });

  it("offer Connections when no tool that brings material in is connected, and nothing while that isn't known", () => {
    expect(ids(facts({ tools: [] }))).toEqual(["draft-solutions", "connect", "add-file"]);
    expect(ids(facts({ tools: null }))).toEqual(["draft-solutions", "add-file"]);
    expect(others(facts({ tools: ["Intercom", "Slack"] }))[1].label).toBe("Watch a tool for it");
  });

  it("search the organization only where its search answers and it has material", () => {
    expect(ids(facts({ search: false, material: true, tools: [] }))).not.toContain("find-backing");
    expect(ids(facts({ search: true, material: false, tools: [] }))).not.toContain("find-backing");
  });

  it("ground a goal with a tool and a file after its own steps, never with quotes", () => {
    expect(ids(facts({ kind: "outcome", search: true, material: true, tools: ["Slack"], goal: goal({ behind: 1 }) }))).toEqual(["focus", "break-down", "draft-problems", "others", "watch", "add-file"]);
  });

  it("ask first where nothing backs the card, and draft at once once it rests on something", () => {
    const thin = others(facts({ tools: [] }));
    expect(thin[0]).toMatchObject({ id: "draft-solutions", asks: true, hint: "Asks a few questions first" });
    expect(thin.map((s) => s.id)).not.toContain("questions");
    // Backed, or answered before: it drafts at once, and the questions stay in More.
    for (const f of [facts({ tools: [], evidence: { ...none, quotes: 1, sources: 1 } }), facts({ tools: [], answered: true })]) {
      const steps = others(f);
      expect(steps[0].asks).toBeUndefined();
      expect(steps.at(-1)).toMatchObject({ id: "questions", label: "Answer a few questions first" });
    }
    // A goal with nothing behind it asks before drafting its problems and before breaking it down.
    expect(others(facts({ kind: "outcome", goal: goal() })).slice(1, 3)).toMatchObject([
      { id: "draft-problems", asks: true, hint: "Asks a few questions first" },
      { id: "break-down", asks: true },
    ]);
    expect(others(facts({ kind: "outcome", goal: goal({ behind: 1 }) })).map((s) => s.asks)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("pick up questions left half-way, even on a card that rests on something", () => {
    expect(others(facts({ tools: [], evidence: { ...none, quotes: 2, sources: 1 }, asking: true }))[0]).toMatchObject({ id: "draft-solutions", asks: true, hint: "Picks up your answers where you left them" });
  });

  it("say why Qalam AI can't run a step now, and leave the rest to run", () => {
    expect(others(facts({ ai: false }))[0].blocked).toBe("Qalam AI isn't ready here");
    expect(others(facts({ reviewing: true }))[0].blocked).toBe("Accept or discard the proposals first");
    expect(others(facts({ busyElsewhere: true }))[0].blocked).toBe("Qalam AI is on another card");
    expect(others(facts({ kind: "solution", ai: false })).map((s) => s.blocked)).toEqual(["Qalam AI isn't ready here", undefined]);
  });
});

describe("a card's next steps in v0.1 (src/lab.ts)", () => {
  afterEach(() => setLab(true));

  it("offer only the loop: drafting solutions, what backs a card, its page, a goal's problems and the one to focus on, a file", () => {
    setLab([]);
    const can = { search: true, material: true, tools: ["Intercom"] };
    // Nothing behind a problem: what the organization has first, then a draft that asks first, since none of it needs evidence; no tool.
    const thin = others(facts(can));
    expect(thin.map((s) => s.id)).toEqual(["find-backing", "draft-solutions", "add-file"]);
    expect(thin[1]).toMatchObject({ hint: "Asks a few questions first", asks: true });
    expect(ids(facts({ tools: [], asking: true, evidence: { ...none, quotes: 2, sources: 1 }, page: { topic: "late-orders", strength: "thin", quotes: 2, sources: 1 } }))).toEqual(["draft-solutions", "add-file", "page"]);
    expect(ids(facts({ ...can, kind: "solution" }))).toEqual(["find-backing"]);
    expect(ids(facts({ ...can, kind: "outcome", pages: 5, goal: goal({ pending: 2, drafted: 1, job: "Ask five families" }) }))).toEqual(["focus", "find-problems", "add-file"]);
    expect(ids(facts({ kind: "outcome", goal: goal() }))).toEqual(["focus", "add-file"]);
  });

  it("bring a feature's steps back once it's on, and Break it down asks first only with the questions on", () => {
    setLab(["tests", "goals"]);
    expect(ids(facts({ kind: "solution" }))).toEqual(["draft-tests"]);
    const steps = others(facts({ kind: "outcome", pages: 5, goal: goal() }));
    expect(steps.map((s) => s.id)).toEqual(["focus", "find-problems", "draft-problems", "break-down", "others", "add-file"]);
    expect(steps.filter((s) => s.asks).map((s) => s.id)).toEqual(["draft-problems"]);
    setLab(["questions"]);
    expect(others(facts())[0]).toMatchObject({ id: "draft-solutions", asks: true });
  });
});

describe("what a solution offers next, by what it is", () => {
  const solution = (o: Partial<CardFacts> = {}) => nextSteps(facts({ kind: "solution", ...o }));

  it("offers wording for a message, steps for something done by hand, and a brief for what's built", () => {
    expect(solution({ solutionType: "message" })[0]).toMatchObject({ id: "word-message", label: "Word the message", ai: true });
    expect(solution({ solutionType: "service" })[0]).toMatchObject({ id: "run-steps", label: "Steps to run this week", ai: true });
    for (const t of ["change", "feature"] as const) expect(solution({ solutionType: t }).map((s) => s.id)).toContain("write-brief");
    expect(solution().map((s) => s.id)).toContain("write-brief");
    expect(solution({ solutionType: "message" }).map((s) => s.id)).not.toContain("write-brief");
  });

  it("opens what's written, in its own words", () => {
    expect(solution({ solutionType: "message", brief: "b1" })[0]).toMatchObject({ id: "open-brief", label: "Its message plan" });
    expect(solution({ solutionType: "service", brief: "b1" })[0]).toMatchObject({ id: "open-brief", label: "Its steps" });
    expect(solution({ brief: "b1" }).map((s) => s.label)).toContain("Its brief");
  });

  it("works out a New product's modules until it has some, and a brief either way", () => {
    expect(solution({ solutionType: "product" }).map((s) => s.id)).toEqual(expect.arrayContaining(["plan-modules", "write-brief"]));
    expect(solution({ solutionType: "product", under: { solutions: 2, tests: 0 } }).map((s) => s.id)).not.toContain("plan-modules");
  });
});

describe("what a card rests on, in a line", () => {
  it("counts customers' quotes and their sources, and what speaks against it", () => {
    expect(backingLine(facts({ evidence: { ...none, quotes: 4, sources: 2, against: 1 } }))).toBe("Rests on 4 quotes from 2 sources · 1 against");
    expect(backingLine(facts({ evidence: { ...none, ours: 3 } }))).toBe("Only your words so far");
    expect(backingLine(facts({ evidence: { ...none, ours: 3, online: 2, read: 2 } }))).toBe("Your words, with 2 posts online and 2 read elsewhere");
    expect(backingLine(facts({ evidence: { ...none, ours: 1, online: 1 } }))).toBe("Your words, with 1 post online");
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

describe("a card's brief", () => {
  const all = (f: CardFacts) => nextSteps(f).map((s) => s.id);

  it("is offered on a goal, a problem and a solution, never a test, and near the top", () => {
    expect(all(facts()).slice(0, 2)).toEqual(["draft-solutions", "write-brief"]);
    expect(all(facts({ kind: "solution" }))).toContain("write-brief");
    expect(all(facts({ kind: "outcome", goal: goal() })).slice(0, 2)).toEqual(["focus", "write-brief"]);
    expect(all(facts({ kind: "test", suggested: true }))).not.toContain("write-brief");
  });

  it("opens the one there is rather than writing another, with nothing blocking that", () => {
    const steps = nextSteps(facts({ brief: "b1", ai: false }));
    expect(steps.map((s) => s.id)).toContain("open-brief");
    expect(steps.map((s) => s.id)).not.toContain("write-brief");
    expect(steps.find((s) => s.id === "open-brief")?.blocked).toBeUndefined();
    expect(nextSteps(facts({ ai: false })).find((s) => s.id === "write-brief")?.blocked).toBe("Qalam AI isn't ready here");
  });
});
