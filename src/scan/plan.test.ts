import { describe, expect, it } from "vitest";
import type { SolutionDraft } from "@/discovery/solutions";
import { wholeSentences, nameRests, audiencesMaterial, firstGoal, firstPickMaterial, problemFor, riskiest, sameTarget, sanitizeAudiences, sanitizeFirstPick, scanRound } from "./plan";

const word = (ref: string, text: string) => ({ ref, text, source: "Reviews", origin: "https://x.example" });
const words = [word("a", "As a night nurse I never know when to eat on my shift."), word("b", "Night nurse here, the plan assumes I sleep at night, 3 times it was wrong."), word("c", "My kids hate the recipes it picks.")];
const problems = [{ id: "p1", title: "Meals don't fit night shifts", lines: ["Plans assume daytime."], cites: ["a", "b"] }, { id: "p2", title: "Recipes get rejected", lines: ["Kids reject them."], cites: ["c"] }];
const m = audiencesMaterial({ target: { kind: "idea", said: "A meal planner" }, answers: "Mostly parents I know", problems, words });
let n = 0;
const id = () => `x${++n}`;

describe("audiences", () => {
  it("keeps an audience resting on two quotes, named in their words", () => {
    const got = sanitizeAudiences({ audiences: [{ name: "Night nurses", about: "They say the plan assumes they sleep at night.", quotes: ["q1", "q2"] }] }, m, { id });
    expect(got).toHaveLength(1);
    expect(got[0].name).toBe("Night nurses");
    expect(got[0].quotes.map((q) => q.ref)).toEqual(["a", "b"]);
  });

  it("keeps none on one quote, on quotes it wasn't sent, or under a name nobody used", () => {
    const keep = (a: unknown) => sanitizeAudiences({ audiences: [a] }, m, { id });
    expect(keep({ name: "Night nurses", about: "", quotes: ["q1"] })).toEqual([]);
    expect(keep({ name: "Night nurses", about: "", quotes: ["q1", "q9"] })).toEqual([]);
    expect(keep({ name: "Busy paramedics", about: "", quotes: ["q1", "q2"] })).toEqual([]);
    expect(keep({ name: "", about: "", quotes: ["q1", "q2"] })).toEqual([]);
    expect(sanitizeAudiences(null, m, { id })).toEqual([]);
  });

  it("takes a name from their answers too, and leaves out a line whose numbers aren't there", () => {
    const got = sanitizeAudiences({ audiences: [{ name: "Parents", about: "Wrong 9 times.", quotes: ["q1", "q3"] }] }, m, { id });
    expect(got[0].name).toBe("Parents");
    expect(got[0].about).toBe("");
  });

  it("keeps whole sentences, never one cut off", () => {
    expect(wholeSentences("One. Two.", 100)).toBe("One. Two.");
    expect(wholeSentences("This is the first sentence. This is the second and it runs on for ages.", 40)).toBe("This is the first sentence.");
    expect(wholeSentences("One long sentence with no end in sight at all", 20)).toBe("");
    expect(wholeSentences(7, 20)).toBe("");
  });

  it("holds a name to most of its telling words, their endings free", () => {
    const said = "I work nights and cook once a week for my family";
    expect(nameRests("New night shift workers", "I work the night shift")).toBe(true);
    expect(nameRests("Batch cookers", "I want to batch cook")).toBe(true);
    expect(nameRests("Families who cook", said)).toBe(true);
    expect(nameRests("Busy paramedics", said)).toBe(false);
    expect(nameRests("Retired pilots at night", said)).toBe(false);
    expect(nameRests("People", said)).toBe(false);
    expect(nameRests("عائلات الرياض", "نحن عائلات في الرياض")).toBe(true);
  });

  it("keeps at most three, each name once", () => {
    const a = (name: string) => ({ name, about: "", quotes: ["q1", "q2"] });
    expect(sanitizeAudiences({ audiences: [a("Night nurses"), a("night nurses"), a("Nurses"), a("Night"), a("Nurse")] }, m, { id }).map((x) => x.name)).toEqual(["Night nurses", "Nurses", "Night"]);
  });
});

describe("a first goal", () => {
  it("is about learning, worded by code, in the audience's language", () => {
    expect(firstGoal("night nurses", "sign-up", 5, 10)).toEqual({ title: "5 of 10 night nurses sign up", metric: "Signed up, of 10 asked", target: 5 });
    expect(firstGoal("night nurses", "pay", 3, 20).title).toBe("3 of 20 night nurses pay for it");
    expect(firstGoal("People just starting night shift", "sign-up", 5, 10).title).toBe("5 of 10 people just starting night shift sign up");
    expect(firstGoal("NHS nurses", "sign-up", 5, 10).title).toBe("5 of 10 NHS nurses sign up");
    expect(firstGoal("عائلات الرياض", "sign-up", 5, 10).title).toBe("5 من 10 من عائلات الرياض يسجلون");
  });
});

describe("what comes first", () => {
  it("starts from the problem most of the audience's quotes bear on, the best backed on a tie", () => {
    expect(problemFor(problems, [{ ref: "c" }])?.id).toBe("p2");
    expect(problemFor(problems, [{ ref: "a" }, { ref: "c" }])?.id).toBe("p1");
    expect(problemFor(problems, [])?.id).toBe("p1");
    expect(problemFor([], [])).toBeNull();
  });

  const draft = (id: string, title: string): SolutionDraft => ({ id, title, description: "Plans around the shift.", cites: { lines: [], pieces: [], goals: [], claims: [], steps: [] }, idea: null, assumptions: [{ id: `${id}a`, category: "desirability", text: "Nurses will set their shifts.", importance: 2 }, { id: `${id}b`, category: "desirability", text: "They'd pay.", importance: 3 }], test: { assumption: `${id}a`, what: "Ask ten nurses", how: "Talk.", suggested: null }, at: 1 });
  const sent = firstPickMaterial({ target: { kind: "idea", said: "A meal planner" }, audience: "Night nurses", answers: "", problem: problems[0], words: words.map((w) => w.text), drafts: [draft("one", "Shift-aware plans"), draft("two", "Batch cooking")] });

  it("keeps a pick it was sent, with a reason it can check", () => {
    const p = sanitizeFirstPick({ pick: "d2", why: "They say “the plan assumes I sleep at night”.", later: [{ id: "d1", why: "It can wait." }] }, sent);
    expect(p).toEqual({ draft: "two", why: "They say “the plan assumes I sleep at night”.", later: [{ draft: "one", why: "It can wait." }] });
  });

  it("drops a reason with words nobody said or a number nobody gave, and falls back to the first draft", () => {
    expect(sanitizeFirstPick({ pick: "d1", why: "They say “this is the best thing ever made”." }, sent)?.why).toBe("");
    expect(sanitizeFirstPick({ pick: "d1", why: "It would help 80% of them." }, sent)?.why).toBe("");
    expect(sanitizeFirstPick({ pick: "d9", why: "Because." }, sent)).toEqual({ draft: "one", why: "", later: [{ draft: "two", why: "" }] });
    expect(sanitizeFirstPick({}, { ...sent, drafts: new Map() })).toBeNull();
  });

  it("names the assumption its test is about, else the one that matters most", () => {
    expect(riskiest(draft("one", "x"))?.id).toBe("onea");
    expect(riskiest({ ...draft("one", "x"), test: null })?.id).toBe("oneb");
    expect(riskiest({ assumptions: [], test: null })).toBeNull();
  });

  it("asks open questions when Qalam AI's can't be had", () => {
    expect(scanRound().every((q) => q.options.length === 0)).toBe(true);
  });

  it("knows two scans of the same thing", () => {
    expect(sameTarget({ kind: "product", name: "Notion" }, { kind: "product", name: "notion" })).toBe(true);
    expect(sameTarget({ kind: "product", name: "Notion" }, { kind: "product", name: "Duolingo" })).toBe(false);
    expect(sameTarget({ kind: "idea", said: "A planner" }, { kind: "product", name: "A planner" })).toBe(false);
  });
});
