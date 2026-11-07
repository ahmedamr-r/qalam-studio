import { describe, expect, it } from "vitest";
import { askingFields, askingRules, askTurnCall } from "@/ai/asking";
import { editTerms } from "@/terms/edit";
import { emptyTerms } from "@/terms/types";
import { emptyAsking, applyTurn } from "./engine";
import { sanitizeTurn, type TurnCheck } from "./sanitize";
import { askingBlock, askingIn, checkOf, unknownStreak } from "./wire";

const q = (id: string, title: string, x: Record<string, unknown> = {}) => ({ id, title, why: "", multi: false, options: [], recommended: [], allowOther: false, from: "none", look_for: "", after: [], ...x });
const terms = editTerms(emptyTerms(), { op: "add", term: "Basket", means: "The order before checkout", avoid: ["cart"] }, { now: 1, id: () => "t1" });
const check = (x: Partial<TurnCheck> = {}): TurnCheck => ({ who: "team", asked: [{ id: "who", title: "Who pays first?" }], lookups: [{ id: "l0", kind: "web", query: "what people do about late orders" }], said: "Riders say a run means a full night shift. We lose 30 orders a week.", hay: "Late orders cost us 30 orders a week.", terms, kinds: ["project", "web"], ...x });

describe("a look in their tools, as a turn asks for it", () => {
  it("keeps one at a time, only where the flow can offer it", () => {
    const raw = { questions: [], lookups: [{ id: "t1", kind: "tools", query: "checkout drop-off" }, { id: "t2", kind: "tools", query: "payment errors" }], done: false, understood: [] };
    expect(sanitizeTurn(raw, check({ kinds: ["project", "web", "tools"] })).lookups).toEqual([{ id: "t1", kind: "tools", query: "checkout drop-off" }]);
    expect(sanitizeTurn(raw, check()).lookups).toEqual([]);
  });

  it("is named in the rules and the fields only where the flow can offer it", () => {
    expect(askingRules("team", { kinds: ["project", "web", "tools"] })).toContain("tools (their connected tools");
    expect(askingRules("team", { kinds: ["project", "web"] })).not.toContain("connected tools");
    const kinds = (askingFields("team", { kinds: ["project", "web", "tools"] }).lookups as { items: { properties: { kind: { enum: string[] } } } }).items.properties.kind.enum;
    expect(kinds).toEqual(["project", "web", "tools"]);
  });
});

describe("a turn as code keeps it", () => {
  it("keeps every question it can ask, never one asked before, and gives a colliding id one of its own", () => {
    const topics = ["riders", "salons", "pricing", "weekends", "refunds", "drivers", "kitchens", "coupons", "airports"];
    const qs = topics.map((t, i) => q(`q${i}`, `What matters most about ${t}?`));
    const t = sanitizeTurn({ questions: [...qs, q("x", "Who pays first?"), q("who", "Where do riders wait?")] }, check());
    expect(t.questions).toHaveLength(10);
    expect(t.questions.some((x) => x.title === "Who pays first?")).toBe(false);
    expect(t.questions.find((x) => x.title === "Where do riders wait?")?.id).not.toBe("who");
  });

  it("asks a held question again under its own id, reworded or not, and still drops a real repeat", () => {
    const held = [{ id: "slot", title: "Which delivery slot do they pick most?" }];
    const t = sanitizeTurn({ questions: [q("q9", "Which delivery slot do they pick most?"), q("x", "Who pays first?")] }, check({ held }));
    expect(t.questions.map((x) => [x.id, x.title])).toEqual([["slot", "Which delivery slot do they pick most?"]]);
    // Reworded under its id, it's still the held question, asked once.
    const again = sanitizeTurn({ questions: [q("slot", "What slot do most of them pick?"), q("q2", "What slot do most of them pick?")] }, check({ held }));
    expect(again.questions.map((x) => x.id)).toEqual(["slot"]);
    // Through the wire: what's held reaches the check as held, not as asked.
    const s = applyTurn(emptyAsking(), { questions: [{ ...q("a", "How many riders?"), options: [], recommended: [] }, { ...q("b", "Which city first?"), options: [], recommended: [], after: ["a"] }], lookups: [], done: false, understood: [], terms: [], choices: [] } as never, { now: 1, id: (p) => p });
    expect(s.held.map((h) => h.id)).toEqual(["b"]);
    const c = checkOf(askingIn(s, { said: "" }), { who: "team", hay: "", kinds: [] });
    expect(c.held?.map((h) => h.id)).toEqual(["b"]);
    expect(c.asked.some((a) => a.id === "b")).toBe(false);
  });

  it("after several don't-knows in a row, asks no more facts: only what they can decide", () => {
    const answered = (how: "own" | "unknown" | "left", i: number) => ({ id: `a${i}`, title: `Question ${i}?`, answer: how === "own" ? "Yes" : "", how });
    const wire = (hows: ("own" | "unknown" | "left")[]) => ({ ...askingIn(emptyAsking(), { said: "" }), rounds: [{ asked: hows.map(answered) }] });
    expect(unknownStreak(wire(["own", "unknown", "left", "unknown", "unknown"]))).toBe(3);
    expect(unknownStreak(wire(["unknown", "unknown", "own"]))).toBe(0);
    const streak = wire(["unknown", "unknown", "unknown"]);
    expect(askingBlock(streak)).toContain("Ask no more facts");
    expect(askingBlock(wire(["unknown", "own"]))).not.toContain("Ask no more facts");
    const fact = q("f", "What's the failure rate?", { from: "numbers", look_for: "failure rate" });
    const decide = q("d", "Which city goes first?");
    const t = sanitizeTurn({ questions: [fact, decide] }, checkOf(streak, { who: "team", hay: "", kinds: [] }));
    expect(t.questions.map((x) => x.id)).toEqual(["d"]);
    expect(sanitizeTurn({ questions: [fact, decide] }, checkOf(wire(["unknown"]), { who: "team", hay: "", kinds: [] })).questions.map((x) => x.id)).toEqual(["f", "d"]);
  });

  it("keeps what a question waits on only where it's a question or a lookup, and breaks a loop", () => {
    const t = sanitizeTurn({ questions: [q("a", "How many riders?", { after: ["b", "nope"] }), q("b", "Which city first?", { after: ["a"] }), q("c", "What does SMS cost?", { after: ["l1", "l0"] })], lookups: [{ id: "l1", kind: "web", query: "SMS cost" }] }, check());
    expect(t.questions.find((x) => x.id === "c")?.after).toEqual(["l1", "l0"]);
    const loop = t.questions.filter((x) => x.id === "a" || x.id === "b");
    expect(loop.some((x) => !x.after)).toBe(true);
  });

  it("runs only this flow's lookups, one web lookup a turn, never the same one twice", () => {
    const t = sanitizeTurn({ lookups: [{ id: "l1", kind: "web", query: "SMS cost" }, { id: "l2", kind: "web", query: "push cost" }, { id: "l3", kind: "project", query: "late orders" }, { id: "l4", kind: "web", query: "What people do about late orders" }, { id: "l5", kind: "drive", query: "x" }] }, check());
    expect(t.lookups.map((l) => [l.kind, l.query])).toEqual([
      ["web", "SMS cost"],
      ["project", "late orders"],
    ]);
    expect(sanitizeTurn({ lookups: [{ id: "l1", kind: "web", query: "x" }] }, check({ kinds: [] })).lookups).toEqual([]);
  });

  it("holds what it takes as settled to what it was sent", () => {
    const t = sanitizeTurn({ understood: [{ text: "They lose 30 orders a week", from: ["said", "zz"] }, { text: "They lose 90 orders a week", from: [] }] }, check());
    expect(t.understood[0]).toEqual({ text: "They lose 30 orders a week", from: ["said"] });
    expect(t.understood[1]?.text ?? "").not.toContain("90");
  });

  it("proposes a term only in their words, defined in a sentence or two, never one the project has or how it's built", () => {
    const t = sanitizeTurn(
      {
        terms: [
          { term: "Run", means: "A full night shift of deliveries.", avoid: ["shift"] },
          { term: "Sprint", means: "A short burst.", avoid: [] },
          { term: "cart", means: "The order before checkout.", avoid: [] },
          { term: "Full night shift", means: "A row in the shifts table.", avoid: [] },
        ],
      },
      check(),
    );
    expect(t.terms).toEqual([{ term: "Run", means: "A full night shift of deliveries.", avoid: ["shift"] }]);
  });

  it("offers a decision only behind the switch, with all three tests and its reason in their words", () => {
    const c = { choice: "Night riders first", why: "Riders say a run means a full night shift", instead: "Day riders", hard_to_undo: true, surprising: true, trade_off: true };
    expect(sanitizeTurn({ choices: [c] }, check()).choices).toEqual([]);
    expect(sanitizeTurn({ choices: [c] }, check({ decisions: true })).choices).toHaveLength(1);
    expect(sanitizeTurn({ choices: [{ ...c, surprising: false }] }, check({ decisions: true })).choices).toEqual([]);
  });
});

describe("what a route is sent, and the rules every turn carries", () => {
  it("sends every round, Qalam AI's picks said to be agreement, and the words they used that the project avoids", () => {
    let s = applyTurn(emptyAsking(), { questions: [{ ...q("who", "Who first?"), options: [{ value: "a", label: "Salons", description: "" }, { value: "b", label: "Gyms", description: "" }], recommended: ["a"] }], lookups: [], done: false, understood: [], terms: [], choices: [] }, { now: 1, id: (p) => `${p}1` });
    s = { ...s, rounds: s.rounds.map((r) => ({ ...r, form: { ...r.form, submitted: true, answers: { who: { kind: "single", value: "a", pick: true } } } })) };
    const a = askingIn(s, { said: "People leave things in their cart", terms });
    expect(a.rounds[0].asked[0]).toMatchObject({ id: "who", answer: "Salons", how: "pick" });
    expect(a.clashes).toEqual([{ word: "cart", term: "Basket" }]);
    const block = askingBlock(a);
    expect(block).toContain("agreement, not their words");
    expect(block).toContain("“cart”: the project says “Basket”");
  });

  it("states no limit on rounds or questions, and asks for terms and decisions only when they're on", () => {
    expect(askingRules("team")).toContain("There is no limit on rounds");
    expect(JSON.stringify(askingFields("team", { kinds: ["web"] }))).not.toMatch(/maxItems|minItems|at most \d|1 to 3|2 or 3/);
    expect(askingFields("team")).not.toHaveProperty("lookups");
    expect(askingFields("team", { terms: true })).toHaveProperty("terms");
    expect(askingFields("team")).not.toHaveProperty("choices");
    expect(askingRules("team", { choices: true })).toContain("hard to undo");
    const call = askTurnCall({ flow: "plan", who: "team", material: "x", kinds: ["web"] });
    expect(call.kind).toBe("ask-turn");
    expect(call.system).toHaveLength(2);
  });
});
