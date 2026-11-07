import { describe, expect, it } from "vitest";
import { answersOf, applyTurn, askInstead, awaitsConfirm, closeRound, currentRound, emptyAsking, endNow, forDraft, foundOf, fromPlanRounds, lookupLanded, markRead, nextAfter, offPoint, settledOf, startLookup, takePicks } from "./engine";
import { askingIn } from "./wire";
import type { AskQuestion, AskTurn, AskingState } from "./types";

let n = 0;
const o = { now: 1, id: (p: string) => `${p}${++n}` };
const q = (id: string, title: string, x: Partial<AskQuestion> = {}): AskQuestion => ({ id, title, why: "", multi: false, options: [], recommended: [], allowOther: true, ...x });
const choice = (id: string, title: string, rec: string, x: Partial<AskQuestion> = {}) => q(id, title, { options: [{ value: "a", label: "Salons", description: "" }, { value: "b", label: "Gyms", description: "" }], recommended: [rec], ...x });
const turn = (t: Partial<AskTurn> = {}): AskTurn => ({ questions: [], lookups: [], done: false, understood: [], terms: [], choices: [], ...t });
const send = (s: AskingState, answers: Record<string, unknown> = {}) => closeRound(s, { ...currentRound(s)!.form, answers: answers as never });

describe("the interview's rounds", () => {
  it("asks every question it can now, holds one that waits on another of the same turn or on a running lookup", () => {
    const s = applyTurn(emptyAsking(), turn({ questions: [q("who", "Who pays?"), q("how", "How much would they pay?", { after: ["who"] }), q("cost", "What does SMS cost you?", { after: ["l1"] }), q("soon", "How soon?")], lookups: [{ id: "l1", kind: "web", query: "SMS cost" }] }), o);
    expect(currentRound(s)?.questions.map((x) => x.id)).toEqual(["who", "soon"]);
    expect(s.held.map((x) => x.id)).toEqual(["how", "cost"]);
    expect(s.lookups[0]).toMatchObject({ id: "l1", state: "running", waits: 1 });
    expect(nextAfter(s)).toBe("ask");
  });

  it("lets a lookup run while they answer, and the next turn waits only for it", () => {
    let s = applyTurn(emptyAsking(), turn({ questions: [q("who", "Who pays?")], lookups: [{ id: "l1", kind: "project", query: "late orders" }] }), o);
    s = send(s, { who: { kind: "text", text: "Salons" } });
    expect(nextAfter(s)).toBe("wait");
    s = lookupLanded(s, "l1", { lines: [{ ref: "l1-1", text: "My order came late", from: "Interview" }] });
    expect(nextAfter(s)).toBe("turn");
    expect(markRead(s).lookups[0].read).toBe(2);
  });

  it("has no limit on rounds, and ends when a turn leaves nothing open, brings nothing new, or they stop", () => {
    let s = emptyAsking();
    for (let i = 0; i < 9; i++) s = send(applyTurn(s, turn({ questions: [q(`q${i}`, `Question ${i}`)] }), o), { [`q${i}`]: { kind: "text", text: "Yes" } });
    expect(s.rounds).toHaveLength(9);
    expect(nextAfter(s)).toBe("turn");
    expect(applyTurn(s, turn({ done: true }), o).end?.by).toBe("done");
    expect(applyTurn(s, turn({ done: false }), o).end?.by).toBe("nothing-new");
    expect(applyTurn(s, turn({ done: true, questions: [q("more", "One more?")] }), o).end).toBeUndefined();
    const stopped = endNow(applyTurn(s, turn({ questions: [q("x", "Last?")], lookups: [{ id: "l9", kind: "web", query: "x" }] }), o), 5);
    expect(stopped.end?.by).toBe("stopped");
    expect(stopped.lookups.find((l) => l.id === "l9")?.state).toBe("stopped");
    expect(currentRound(stopped)).toBeNull();
  });

  it("doesn't end while a lookup that landed during the turn is unread, nor hold a question nothing can settle", () => {
    let s = applyTurn(emptyAsking(), turn({ lookups: [{ id: "l1", kind: "web", query: "x" }] }), o);
    s = lookupLanded(s, "l1", { lines: [] });
    expect(applyTurn(s, turn({ done: true }), o).end).toBeUndefined();
    const released = applyTurn(markRead(s), turn({ questions: [q("a", "A?", { after: ["b"] }), q("b", "B?", { after: ["a"] })] }), o);
    expect(currentRound(released)?.questions.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("puts a third lookup-only turn's web lookup to them, and asks instead when they say so", () => {
    let s = emptyAsking();
    for (const id of ["l1", "l2"]) s = lookupLanded(markRead(applyTurn(s, turn({ lookups: [{ id, kind: "web", query: id }] }), o)), id, { lines: [] });
    s = markRead(s);
    s = applyTurn(s, turn({ lookups: [{ id: "l3", kind: "web", query: "more" }] }), o);
    expect(s.offer).toEqual({ id: "l3", query: "more" });
    expect(s.lookups.some((l) => l.id === "l3")).toBe(false);
    expect(nextAfter(s)).toBe("offer");
    expect(startLookup(s, { id: "l3", kind: "web", query: "more", waits: s.turns }, 2).offer).toBeUndefined();
    expect(askInstead(s)).toMatchObject({ askFirst: true, quiet: 0 });
  });
});

describe("Qalam AI's picks", () => {
  it("fills only what they haven't answered that has a recommendation, marked as its pick", () => {
    const s = applyTurn(emptyAsking(), turn({ questions: [choice("who", "Who first?", "a"), choice("where", "Where?", "b"), q("why", "Why now?"), choice("which", "Which?", "a", { multi: true })] }), o);
    const form = takePicks(currentRound(s)!.questions, { ...currentRound(s)!.form, answers: { where: { kind: "single", value: "a" } } });
    const done = closeRound(s, form);
    expect(answersOf(done).map((a) => [a.id, a.text, a.how])).toEqual([
      ["who", "Salons", "pick"],
      ["where", "Salons", "own"],
      ["why", "", "left"],
      ["which", "Salons", "pick"],
    ]);
    const settled = settledOf({ ...done, end: { by: "done", at: 1 } });
    expect(settled.picks.map((a) => a.id)).toEqual(["who", "which"]);
    expect(settled.left).toEqual(["Why now?"]);
    expect(settled.unknown).toEqual([]);
    // "I don't know" is open too, apart from what was left, and Qalam AI's picks never fill it.
    const unsure = closeRound(s, { ...form, answers: { ...form.answers, why: { kind: "skipped", unknown: true } } });
    expect(answersOf(unsure).find((a) => a.id === "why")?.how).toBe("unknown");
    expect(settledOf({ ...unsure, end: { by: "done", at: 1 } }).unknown).toEqual(["Why now?"]);
    expect(settledOf({ ...unsure, end: { by: "done", at: 1 } }).left).toEqual([]);
  });

  it("keeps all of a long choice of several", () => {
    const six = q("tools", "Which tools?", { multi: true, options: ["SMS", "Email", "Push", "WhatsApp", "Calls", "Letters"].map((label, i) => ({ value: `t${i}`, label, description: "" })) });
    const s = send(applyTurn(emptyAsking(), turn({ questions: [six] }), o), { tools: { kind: "multi", values: ["t0", "t1", "t2", "t3", "t4", "t5"], custom: [] } });
    expect(answersOf(s)[0].text).toBe("SMS; Email; Push; WhatsApp; Calls; Letters");
  });
});

describe("the end, and after it", () => {
  it("waits for them on What we settled once something was asked, and a round asks what's off", () => {
    const asked = applyTurn(send(emptyAsking([q("who", "Who?")]), { who: { kind: "text", text: "Salons" } }), turn({ done: true }), o);
    expect(awaitsConfirm(asked)).toBe(true);
    expect(awaitsConfirm(applyTurn(emptyAsking(), turn({ done: true }), o))).toBe(false);
    const off = offPoint(asked);
    expect(off.end).toBeUndefined();
    expect(currentRound(off)?.questions[0]).toMatchObject({ title: "What's off?", by: "code" });
  });

  it("reads a plan's rounds from before as their own words, and its looks as lookups done", () => {
    const s = fromPlanRounds([{ questions: [q("who", "Who?"), q("why", "Why?")], answers: { who: "Salons", why: "" } }], [{ at: 1, query: "", lines: [], pages: [], after: -1 }]);
    expect(answersOf(s).map((a) => [a.text, a.how])).toEqual([
      ["Salons", "own"],
      ["", "left"],
    ]);
    expect(s.lookups[0]).toMatchObject({ kind: "web", state: "done" });
    expect(nextAfter(s)).toBe("turn");
  });
});

describe("looks in the background before a draft", () => {
  const bg = (s: AskingState, id: string, kind: "web" | "online") => startLookup(s, { id, kind, query: "the slots fill by noon", waits: "draft" }, 1);

  it("never hold a turn or a round, and only the draft waits on them", () => {
    const s = bg(emptyAsking(), "bg-web", "web");
    expect(nextAfter(s)).toBe("turn");
    expect(forDraft(s).map((l) => l.id)).toEqual(["bg-web"]);
    // A turn with nothing more to ask ends the interview, the look still running for the draft.
    const ended = applyTurn(s, turn({ done: true }), o);
    expect(ended.end?.by).toBe("done");
    expect(forDraft(lookupLanded(ended, "bg-web", { lines: [] }))).toEqual([]);
  });

  it("give the draft what people online said, as pieces it may rest on, and never reach the model's turns", () => {
    const online = lookupLanded(bg(emptyAsking(), "bg-online", "online"), "bg-online", { lines: [{ ref: "bg-online-1", text: "The slots fill by noon", from: "App Store", whose: "people online", piece: "hub:quote:x1" }] });
    expect(foundOf(online).map((l) => l.piece)).toEqual(["hub:quote:x1"]);
    expect(askingIn(online, { said: "" }).lookups).toEqual([]);
  });
});
