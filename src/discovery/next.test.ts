import { describe, expect, it } from "vitest";
import { backingLine, nextSteps, type CardFacts } from "./next";

const none = { quotes: 0, sources: 0, ours: 0, online: 0, against: 0, who: [], from: [] };
const facts = (over: Partial<CardFacts> = {}): CardFacts => ({ kind: "opportunity", evidence: none, page: null, under: { solutions: 0, tests: 0 }, ai: true, reviewing: false, busyElsewhere: false, ...over });
const ids = (f: CardFacts) => nextSteps(f).map((s) => s.id);

describe("a card's next steps", () => {
  it("lead a problem with drafting its solutions, then its page", () => {
    expect(ids(facts())).toEqual(["draft-solutions"]);
    expect(ids(facts({ page: { topic: "late-orders", strength: "thin", quotes: 2, sources: 1 } }))).toEqual(["draft-solutions", "page"]);
  });

  it("lead a solution with its tests, then designing it", () => {
    expect(ids(facts({ kind: "solution" }))).toEqual(["draft-tests", "design-this"]);
    expect(nextSteps(facts({ kind: "solution", under: { solutions: 0, tests: 1 } }))[0].hint).toBe("More of what it assumes, and a test");
  });

  it("offer a test only the pass line Qalam AI suggested, while nobody has set one", () => {
    expect(ids(facts({ kind: "test", suggested: true }))).toEqual(["pass-line"]);
    expect(ids(facts({ kind: "test" }))).toEqual([]);
  });

  it("offer a goal its next job", () => {
    expect(nextSteps(facts({ kind: "outcome", goal: { id: "g1", number: null, behind: 0, job: "Ask five families" } }))[0]).toMatchObject({ id: "next-job", label: "Next: Ask five families" });
    expect(ids(facts({ kind: "outcome", goal: { id: "g1", number: null, behind: 0, job: null } }))).toEqual([]);
  });

  it("say why Qalam AI can't run a step now, and leave the rest to run", () => {
    expect(nextSteps(facts({ ai: false }))[0].blocked).toBe("Qalam AI isn't ready here");
    expect(nextSteps(facts({ reviewing: true }))[0].blocked).toBe("Accept or discard the proposals first");
    expect(nextSteps(facts({ busyElsewhere: true }))[0].blocked).toBe("Qalam AI is on another card");
    expect(nextSteps(facts({ kind: "solution", ai: false })).map((s) => s.blocked)).toEqual(["Qalam AI isn't ready here", undefined]);
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

  it("gives a goal its number and the problems behind it", () => {
    expect(backingLine(facts({ kind: "outcome", goal: { id: "g", number: "12% → 18%", behind: 4, job: null } }))).toBe("12% → 18% · 4 problems behind it");
    expect(backingLine(facts({ kind: "outcome", goal: { id: "g", number: null, behind: 0, job: null } }))).toBe("No number yet · nothing behind it yet");
  });
});
