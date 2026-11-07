import { describe, expect, it } from "vitest";
import type { KnownAnswer } from "@/memory/known";
import { answersOf, applyTurn, awaitsConfirm, closeRound, currentRound, emptyAsking, nextAfter, settledOf } from "./engine";
import { askingBlock, askingIn, checkOf } from "./wire";
import type { AskQuestion, AskTurn } from "./types";

const DAY = 86_400_000;
const now = 100 * DAY;
let n = 0;
const o = { now, id: (p: string) => `${p}${++n}` };
const q = (id: string, title: string, x: Partial<AskQuestion> = {}): AskQuestion => ({ id, title, why: "", multi: false, options: [], recommended: [], allowOther: true, ...x });
const turn = (t: Partial<AskTurn> = {}): AskTurn => ({ questions: [], lookups: [], done: false, understood: [], terms: [], choices: [], ...t });
const said = (x: Partial<KnownAnswer> = {}): KnownAnswer => ({ id: "m1", text: "About 104%", how: "own", mine: true, at: now - DAY, flow: "find", match: "exact", ...x });
const nrr = (x: Partial<KnownAnswer> = {}) => q("nrr", "What is net revenue retention today?", { known: [said(x)] });
const firstQ = (x: Partial<KnownAnswer>) => q("first", "Which customers first?", { options: [{ value: "a", label: "Agencies", description: "" }, { value: "b", label: "Freelancers", description: "" }], recommended: ["a"], allowOther: false, known: [said(x)] });

describe("a question they answered lately, answered from what they said instead of asked", () => {
  it("isn't asked: it's a round of what they said before, and the rest is asked after it", () => {
    const s = applyTurn(emptyAsking(), turn({ questions: [nrr(), q("who", "Who pays first?")] }), o);
    expect(s.rounds.map((r) => r.from ?? "asked")).toEqual(["memory", "asked"]);
    expect(currentRound(s)?.questions.map((x) => x.id)).toEqual(["who"]);
    expect(answersOf(s)[0]).toMatchObject({ id: "nrr", text: "About 104%", typed: "About 104%", how: "own" });
  });

  it("keeps Qalam AI's pick its pick and a don't-know a don't-know; a teammate's, an old or a near answer is asked, with it shown", () => {
    const s = applyTurn(
      emptyAsking(),
      turn({ questions: [firstQ({ how: "pick", text: "Agencies" }), nrr({ how: "unknown", text: "" }), q("t", "Who pays?", { known: [said({ mine: false, name: "Omar" })] }), q("o", "How long have they paid?", { known: [said({ at: now - 30 * DAY })] }), q("near", "What churns?", { known: [said({ match: "near" })] })] }),
      o,
    );
    expect(answersOf({ rounds: [s.rounds[0]] }).map((a) => [a.id, a.how, a.typed])).toEqual([
      ["first", "pick", ""],
      ["nrr", "unknown", ""],
    ]);
    expect(currentRound(s)?.questions.map((x) => x.id)).toEqual(["t", "o", "near"]);
  });

  it("never stands in where the question can't take it as it was given", () => {
    // Qalam AI's pick, asked now as words: asked, so it never turns into their words.
    const asWords = applyTurn(emptyAsking(), turn({ questions: [q("first", "Which customers first?", { known: [said({ how: "pick", text: "Agencies" })] })] }), o);
    expect(asWords.rounds.map((r) => r.from ?? "asked")).toEqual(["asked"]);
    // Their words, where only the options can be picked.
    const noRoom = applyTurn(emptyAsking(), turn({ questions: [firstQ({ text: "Small agencies in Dubai" })] }), o);
    expect(noRoom.rounds.map((r) => r.from ?? "asked")).toEqual(["asked"]);
  });

  it("goes on to another turn when everything asked was known, and ends when the turn was done", () => {
    const all = applyTurn(emptyAsking(), turn({ questions: [nrr()] }), o);
    expect(all.end).toBeUndefined();
    expect(nextAfter(all)).toBe("turn");
    const done = applyTurn(emptyAsking(), turn({ done: true, questions: [nrr()] }), o);
    expect(done.end?.by).toBe("done");
    // Nothing is generated on what it knew without them seeing it.
    expect(awaitsConfirm(done)).toBe(true);
  });

  it("What we settled says what it knew, apart from the picks and what's open", () => {
    let s = applyTurn(emptyAsking(), turn({ questions: [firstQ({ how: "pick", text: "Agencies" }), q("who", "Who pays first?")] }), o);
    s = closeRound(s, { ...currentRound(s)!.form, answers: {} });
    s = applyTurn(s, turn({ done: true }), o);
    const st = settledOf(s);
    expect(st.knew.map((k) => [k.question, k.text, k.how, k.flow])).toEqual([["Which customers first?", "Agencies", "pick", "find"]]);
    expect(st.picks).toEqual([]);
    expect(st.left).toEqual(["Who pays first?"]);
  });

  it("is heard by the next turn as answered before, and counts as asked so it can't come back", () => {
    const s = applyTurn(emptyAsking(), turn({ questions: [nrr()] }), o);
    const a = askingIn(s, { said: "" });
    expect(a.rounds[0].by).toBe("memory");
    expect(askingBlock(a)).toContain("Round 1 (what they said before, in another conversation: not asked now)");
    expect(askingBlock(a)).toContain("“About 104%”");
    expect(checkOf(a, { who: "person", kinds: ["project", "web"], hay: "" }).asked).toEqual([{ id: "nrr", title: "What is net revenue retention today?" }]);
  });
});
