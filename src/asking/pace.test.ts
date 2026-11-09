import { describe, expect, it } from "vitest";
import { askingFields } from "@/ai/asking";
import { applyTurn, closeRound, currentRound, emptyAsking } from "./engine";
import { sanitizeTurn, type TurnCheck } from "./sanitize";
import type { AskQuestion, AskTurn, AskingState } from "./types";
import { askingBlock, askingIn, checkOf } from "./wire";

/* The consultant's pacing on the interview (src/asking/): a few questions at a time, a reflect-back, examples, explained words, a reason on each lookup. */

let n = 0;
const o = { now: 1, id: (p: string) => `${p}${++n}` };
const q = (id: string, title: string, x: Partial<AskQuestion> = {}): AskQuestion => ({ id, title, why: "", multi: false, options: [], recommended: [], allowOther: true, ...x });
const choice = (id: string, title: string) => q(id, title, { options: [{ value: "a", label: "A fee", description: "" }, { value: "b", label: "A cut", description: "" }], recommended: ["a"] });
const turn = (t: Partial<AskTurn> = {}): AskTurn => ({ questions: [], lookups: [], done: false, understood: [], terms: [], choices: [], ...t });
const send = (s: AskingState, answers: Record<string, unknown> = {}) => closeRound(s, { ...currentRound(s)!.form, answers: answers as never });

describe("a round paced for someone new", () => {
  it("asks open questions first, a few at a time, and keeps the rest for a later round", () => {
    const qs = [choice("earn", "How does it earn on an order?"), q("what", "What happens there?"), q("when", "When did it start?"), q("who", "Who has it?"), q("tried", "What have you tried?")];
    const s = applyTurn(emptyAsking(), turn({ questions: qs }), { ...o, cap: 3, openFirst: true });
    expect(currentRound(s)?.questions.map((x) => x.id)).toEqual(["what", "when", "who"]);
    expect(s.held.map((x) => [x.id, x.later])).toEqual([
      ["tried", true],
      ["earn", true],
    ]);
    expect(s.end).toBeUndefined();
    // Without a cap, every question it can ask now.
    expect(currentRound(applyTurn(emptyAsking(), turn({ questions: qs }), o))?.questions).toHaveLength(5);
  });

  it("tells the next turn what was kept for later, to ask now or drop", () => {
    let s = applyTurn(emptyAsking(), turn({ questions: [q("a1", "What happens there?"), q("a2", "When did it start?"), q("a3", "Who has it?"), q("a4", "What have you tried?")] }), { ...o, cap: 2 });
    s = send(s, { a1: { kind: "text", text: "People leave" } });
    const block = askingBlock(askingIn(s, { said: "basket problem" }));
    expect(block).toContain("Kept for a later round");
    expect(block).toContain("- a3 · Who has it?");
    expect(block).not.toContain("(after )");
  });

  it("shows what's settled and what's still open before a round that follows answers, never before the first", () => {
    let s = applyTurn(emptyAsking(), turn({ questions: [q("what", "What happens there?")], open: ["Since when"] }), o);
    expect(currentRound(s)?.reflect).toBeUndefined();
    s = send(s, { what: { kind: "text", text: "People leave at the basket" } });
    s = applyTurn(s, turn({ questions: [q("when", "When did it start?")], understood: [{ text: "People leave at the basket" }], open: ["Since when, and what changed"] }), o);
    expect(currentRound(s)?.reflect).toEqual({ so: ["People leave at the basket"], open: ["Since when, and what changed"] });
    expect(s.open).toEqual(["Since when, and what changed"]);
    expect(askingBlock(askingIn(s, { said: "x" }))).toContain("What you said was still open last turn:");
  });

  it("explains a word once per conversation, and keeps a lookup's reason", () => {
    let s = applyTurn(emptyAsking(), turn({ questions: [q("c", "What's your conversion?", { explain: { term: "conversion", plain: "Out of everyone who opens it, how many order" } })], lookups: [{ id: "l1", kind: "web", query: "basket drop", why: "To see what usually makes people leave" }] }), o);
    expect(s.explained).toEqual(["conversion"]);
    expect(s.lookups[0].why).toBe("To see what usually makes people leave");
    expect(askingIn(s, { said: "x" }).explained).toEqual(["conversion"]);
    expect(checkOf(askingIn(s, { said: "x" }), { who: "person", hay: "", kinds: [] }).explained).toEqual(["conversion"]);
  });
});

describe("a consultant's turn as code keeps it", () => {
  const raw = (x: Record<string, unknown> = {}) => ({ id: "q1", title: "What's your conversion at the basket?", why: "So we know how big it is", multi: false, options: [], recommended: [], allowOther: false, from: "none", look_for: "", after: [], ...x });
  const check = (x: Partial<TurnCheck> = {}): TurnCheck => ({ who: "person", asked: [], lookups: [], said: "Lots of people leave the basket since the fee went to 25", hay: "The delivery fee went to 25.", kinds: ["project", "web"], teach: true, why: true, reflect: true, ...x });

  it("keeps an example of a useful answer only when it's short, isn't a choice and adds no figure", () => {
    const keep = (example: string, x: Record<string, unknown> = {}) => sanitizeTurn({ questions: [raw({ example, ...x })] }, check()).questions[0]?.example;
    expect(keep("About half of them leave")).toBe("About half of them leave");
    expect(keep("About 40 of every 100 leave")).toBeUndefined();
    expect(keep("Around 25 a day")).toBe("Around 25 a day");
    expect(keep("x".repeat(200))).toBeUndefined();
    expect(keep("A fee", { options: [{ value: "a", label: "A fee", description: "" }, { value: "b", label: "A cut", description: "" }] })).toBeUndefined();
    expect(sanitizeTurn({ questions: [raw({ example: "About half" })] }, check({ teach: false })).questions[0].example).toBeUndefined();
  });

  it("explains a word only when the question uses it, plainly, and not one explained already", () => {
    const keep = (explain: unknown, c: Partial<TurnCheck> = {}) => sanitizeTurn({ questions: [raw({ explain })] }, check(c)).questions[0]?.explain;
    expect(keep({ term: "conversion", plain: "Out of everyone who opens the basket, how many order" })).toEqual({ term: "conversion", plain: "Out of everyone who opens the basket, how many order" });
    expect(keep({ term: "retention", plain: "How many come back to order again" })).toBeUndefined();
    expect(keep({ term: "conversion", plain: "Out of everyone, how many order" }, { explained: ["conversion"] })).toBeUndefined();
    expect(keep({ term: "", plain: "" })).toBeUndefined();
  });

  it("drops a lookup with no reason, and keeps one that says why", () => {
    const t = sanitizeTurn({ questions: [], lookups: [{ id: "l1", kind: "web", query: "what makes people leave a basket", why: "" }, { id: "l2", kind: "project", query: "basket complaints", why: "To find what customers already told you about it" }] }, check());
    expect(t.lookups).toEqual([{ id: "l2", kind: "project", query: "basket complaints", why: "To find what customers already told you about it" }]);
    // Where no reason is asked for, a lookup without one stands.
    expect(sanitizeTurn({ lookups: [{ id: "l1", kind: "web", query: "basket drop" }] }, check({ why: false })).lookups).toHaveLength(1);
  });

  it("keeps what's still open, held to what was sent: a line with a figure it wasn't sent goes", () => {
    const t = sanitizeTurn({ questions: [], open: ["How many people reach the basket", "Whether the fee of 40 matters", "Whether the fee of 25 matters", "x"] }, check());
    expect(t.open).toEqual(["How many people reach the basket", "Whether the fee of 25 matters"]);
  });

  it("asks for the fields only where a flow wants them", () => {
    const f = askingFields("person", { kinds: ["web"], teach: true, why: true, reflect: true }) as { questions: { items: { properties: Record<string, unknown> } }; lookups: { items: { properties: Record<string, unknown> } }; open?: unknown };
    expect(Object.keys(f.questions.items.properties)).toEqual(expect.arrayContaining(["example", "explain", "after"]));
    expect(Object.keys(f.lookups.items.properties)).toContain("why");
    expect(f.open).toBeDefined();
    const plain = askingFields("team", { kinds: ["web"] }) as { questions: { items: { properties: Record<string, unknown> } }; open?: unknown };
    expect(Object.keys(plain.questions.items.properties)).not.toContain("example");
    expect(plain.open).toBeUndefined();
  });
});
