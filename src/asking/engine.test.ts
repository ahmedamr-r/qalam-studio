import { describe, expect, it } from "vitest";
import { answersOf, applyTurn, askInstead, awaitsConfirm, closeRound, currentRound, emptyAsking, endNow, forDraft, foundOf, fromPlanRounds, loaded, lookupLanded, markRead, nextAfter, offPoint, scanSaid, settledOf, startLookup, takePicks } from "./engine";
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

describe("a look in their tools", () => {
  it("is put to them, never run by a turn, and what waits on it waits with it", () => {
    const s = applyTurn(emptyAsking(), turn({ questions: [q("first", "Who first?"), q("why", "Why do they leave?", { after: ["t1"] })], lookups: [{ id: "t1", kind: "tools", query: "checkout drop-off" }, { id: "p1", kind: "project", query: "checkout" }] }), o);
    expect(s.offer).toEqual({ id: "t1", query: "checkout drop-off", kind: "tools" });
    expect(s.lookups.map((l) => l.id)).toEqual(["p1"]);
    // Asked now: what doesn't wait on it; held: what does. The round goes first, then the look is put to them.
    expect(currentRound(s)?.questions.map((x) => x.id)).toEqual(["first"]);
    expect(s.held.map((x) => x.id)).toEqual(["why"]);
    expect(nextAfter(send(s))).toBe("offer");
  });

  it("keeps a question that waits only on it held, rather than asking it before the look", () => {
    const s = applyTurn(emptyAsking(), turn({ questions: [q("why", "Why do they leave?", { after: ["t1"] })], lookups: [{ id: "t1", kind: "tools", query: "checkout drop-off" }] }), o);
    expect(currentRound(s)).toBeNull();
    expect(s.held.map((x) => x.id)).toEqual(["why"]);
    expect(s.end).toBeUndefined();
    expect(nextAfter(s)).toBe("offer");
  });

  it("starts as a look in their tools when they say yes, and the next turn waits for what they bring in", () => {
    let s = applyTurn(emptyAsking(), turn({ lookups: [{ id: "t1", kind: "tools", query: "checkout drop-off" }] }), o);
    s = startLookup(s, { id: "t1", kind: s.offer!.kind ?? "web", query: s.offer!.query, waits: s.turns }, 2);
    expect(s.offer).toBeUndefined();
    expect(s.lookups).toEqual([expect.objectContaining({ id: "t1", kind: "tools", state: "running" })]);
    expect(nextAfter(s)).toBe("wait");
    const landed = lookupLanded(s, "t1", { lines: [{ ref: "t1-1", text: "38% leave at the address step", from: "Checkout research", piece: "hub:quote:q1" }] });
    expect(foundOf(landed).map((l) => l.piece)).toEqual(["hub:quote:q1"]);
    // What they brought in reaches the next turn like any lookup's lines.
    expect(askingIn(markRead(landed), { said: "" }).lookups[0]).toMatchObject({ kind: "tools", state: "done", lines: [{ ref: "t1-1", text: "38% leave at the address step" }] });
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

describe("reading what people say online, offered once beside the rounds", () => {
  const scanTurn = (x: Partial<AskTurn> = {}) => turn({ questions: [q("q2", "When did it start?")], lookups: [{ id: "l1", kind: "scan", query: "Sallety", why: "What people complain about may show a cause you can't see." }], ...x });

  it("is offered, never run by a turn, and the round is asked beside it", () => {
    const s = applyTurn(emptyAsking(), scanTurn(), o);
    expect(s.scan).toEqual({ id: "l1", query: "Sallety", why: "What people complain about may show a cause you can't see." });
    expect(s.lookups).toEqual([]);
    expect(nextAfter(s)).toBe("ask");
    expect(currentRound(s)?.questions.map((x) => x.id)).toEqual(["q2"]);
  });

  it("is offered once a conversation, whatever they said", () => {
    const s = applyTurn(emptyAsking(), scanTurn(), o);
    const again = applyTurn(send(s, { q2: { kind: "text", text: "Last month" } }), scanTurn({ questions: [q("q3", "What changed?")], lookups: [{ id: "l9", kind: "scan", query: "Sallety reviews" }] }), o);
    expect(again.scan?.id).toBe("l1");
    expect(scanSaid(scanSaid(again, false, 2), true, 3).lookups).toEqual([]);
    expect(askingIn(scanSaid(again, false, 2), { said: "x" }).scan).toEqual({ query: "Sallety", said: "no" });
  });

  it("yes reads on while nothing waits, and what it found lands in the next turn before the end", () => {
    const s0 = scanSaid(applyTurn(emptyAsking(), scanTurn(), o), true, 2);
    expect(s0.lookups).toMatchObject([{ id: "l1", kind: "scan", waits: "later", state: "running" }]);
    // Answered while it reads: the next turn doesn't wait for it, and the conversation can end around it.
    const s1 = send(s0, { q2: { kind: "text", text: "Last month" } });
    expect(nextAfter(s1)).toBe("turn");
    // Stop asking and a reload leave it reading: it's its own job in the chat.
    expect(endNow(s1, 3).lookups[0].state).toBe("running");
    expect(loaded(s1).lookups[0].state).toBe("running");
    const landed = lookupLanded(s1, "l1", { lines: [{ ref: "l1-1", text: "The delivery fee shows only at the basket", from: "a problem page", whose: "people online" }] });
    // A turn with nothing new doesn't end while what it found is unread.
    const after = applyTurn(landed, turn({ done: true }), o);
    expect(after.end).toBeUndefined();
    const read = markRead(after);
    expect(read.lookups[0].read).toBe(after.turns + 1);
    expect(askingIn(read, { said: "x" }).lookups[0]).toMatchObject({ kind: "scan", state: "done" });
    expect(applyTurn(read, turn({ done: true }), o).end?.by).toBe("done");
  });
});
