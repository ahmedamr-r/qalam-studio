import { describe, expect, it } from "vitest";
import { ADDRESS, CART, CART_COUPON, CART_EMPTY, PAY, SLOT, ref } from "./fixtures";
import { NOT_SAME, SAME_SCREEN, placeMaterial, proposalOf, sanitizePlace } from "./place";
import type { SeenAnswer, SeenMap, ShotNote } from "./types";

const shots = [
  { ref: ref(1), name: "01 cart.png" },
  { ref: ref(2), name: "02 coupon.png" },
  { ref: ref(3), name: "03 address.png" },
  { ref: ref(4), name: "04 slot.png" },
  { ref: ref(5), name: "05 pay.png" },
  { ref: ref(6), name: "06 empty.png" },
];
const texts = new Map([[ref(1), CART], [ref(2), CART_COUPON], [ref(3), ADDRESS], [ref(4), SLOT], [ref(5), PAY], [ref(6), CART_EMPTY]]);
const note = (name: string, can: string[] = [], more: Partial<ShotNote> = {}): ShotNote => ({ name, kind: "detail", can: can.map((label) => ({ label })), nav: [], ...more });
const notes: Record<string, ShotNote> = {
  [ref(1)]: note("Cart", ["Apply coupon", "Checkout"], { kind: "list", does: "Lists what's in the basket" }),
  [ref(2)]: note("Cart", ["Checkout"], { state: "With a coupon applied" }),
  [ref(3)]: note("Address", ["Change", "Continue to payment"], { kind: "form" }),
  [ref(4)]: note("Slot", ["Today", "Tomorrow", "Next"]),
  [ref(5)]: note("Pay", ["Pay 24.50"]),
  [ref(6)]: note("Empty cart", ["Start shopping"], { kind: "empty" }),
};
const code = [{ flow: "Checkout", ref: "acme__basket/slot", step: { key: "slot", title: "Pick a delivery slot", file: "app/slot.tsx", snippet: "x", events: [] } }];

const input = (answers: SeenAnswer[] = [], before: SeenMap | null = null) => ({ context: "Grocery app: people order groceries for delivery.", before, shots, notes, texts, goals: [{ id: "goal-reorder", title: "More customers reorder weekly" }], code, answers });

const answer = {
  same: [["s1", "s2"], ["s1", "s6"], ["s9"]],
  states: [{ id: "s2", shows: "With “Coupon SAVE10 applied”" }, { id: "s6", shows: "With 3 things in it" }],
  flows: [
    {
      id: "new",
      name: "Checkout",
      aim: "to pay for the basket",
      goal: "g1",
      steps: ["s1", "s3", "s4", "s5"],
      moves: [
        { from: "s1", to: "s3", via: "checkout", how: "tap" },
        { from: "s3", to: "s4", via: "Next", how: "tap" },
        { from: "s4", to: "s5", via: "Next", how: "tap" },
        { from: "s3", to: "s9", via: "Change", how: "tap" },
      ],
      entry: "The tab bar's “Cart”",
      notShown: ["What happens when a payment fails", "Paying the 31.00 left"],
    },
    { id: "new", name: "Coupons", aim: "", steps: ["s1", "s2"], moves: [] },
  ],
  code: [
    { screen: "s4", step: "c1" },
    { screen: "s5", step: "c1" },
  ],
  questions: [
    { shots: ["s6"], ask: "Is “Your basket is empty” what people see before adding anything?", why: "It has no items and offers “Start shopping”.", options: ["Yes", "No, after removing items"], words: [{ id: "s6", words: "Your basket is empty" }] },
    { shots: ["s5"], ask: "Does “Pay with cash” show here?", why: "Cash is common.", options: [] },
  ],
  ready: true,
};

describe("placing screenshots in flows", () => {
  it("sends the screens kept, the new screenshots in the order taken, what code noticed, goals, code steps and answers", () => {
    const m = placeMaterial(input([{ question: "q1", ask: "Which takes you on?", answer: "Next" }]));
    expect([...m.nodes.keys()]).toEqual(["s1", "s2", "s3", "s4", "s5", "s6"]);
    expect(m.text).toContain("- s1 · 01 cart.png · Cart · list · Lists what's in the basket");
    expect(m.text).toContain("  Shows: With a coupon applied");
    expect(m.text).toContain("- s1 and s2 look like one screen: their pictures differ in 1 of 64 bits");
    expect(m.text).toContain("- Navigation on most screens: “Home”, “Search”, “Cart”, “Account”");
    expect(m.text).toContain("- g1 · More customers reorder weekly");
    expect(m.text).toContain("- c1 · Checkout · Pick a delivery slot · app/slot.tsx");
    expect(m.text).toContain("- Which takes you on? → Next");
  });

  it("keeps what the screenshots back and asks about the rest", () => {
    const m = placeMaterial(input());
    const why: string[] = [];
    const kept = sanitizePlace(answer, m, { answers: [] }, (w) => why.push(w));
    // The coupon screenshot is the cart in another state; the empty cart differs too much, so code asks.
    expect(kept.groups.find((g) => g.includes(ref(1)))).toEqual([ref(1), ref(2)]);
    expect(kept.groups.find((g) => g.includes(ref(6)))).toEqual([ref(6)]);
    expect(kept.states).toEqual({ [ref(2)]: "With “Coupon SAVE10 applied”" });
    expect(kept.flows).toHaveLength(1);
    const flow = kept.flows[0];
    expect(flow).toMatchObject({ name: "Checkout", aim: "to pay for the basket", goal: "goal-reorder", steps: [ref(1), ref(3), ref(4), ref(5)], entry: "The tab bar's “Cart”", notShown: ["What happens when a payment fails"] });
    expect(flow.moves).toEqual([
      { from: ref(1), to: ref(3), via: "Checkout", how: "tap" },
      { from: ref(3), to: ref(4), how: "tap" },
      { from: ref(4), to: ref(5), via: "Next", how: "tap" },
    ]);
    expect(kept.code).toEqual({ [ref(4)]: "acme__basket/slot" });
    expect(kept.questions.map((q) => [q.id, q.by, q.ask])).toEqual([
      ["q1", "code", "Are “Cart” and “Empty cart” one screen, in two states?"],
      ["q2", "qalam", "Is “Your basket is empty” what people see before adding anything?"],
      ["q3", "code", "On “Address”, what takes you to “Slot”?"],
    ]);
    expect(kept.questions[0]).toMatchObject({ shots: [ref(1), ref(6)], options: [SAME_SCREEN, NOT_SAME], about: { same: [ref(1), ref(6)] } });
    expect(kept.questions[1].marks).toEqual([{ shot: ref(6), words: "Your basket is empty", box: expect.any(Array) }]);
    expect(kept.questions[2]).toMatchObject({ options: ["Change", "Continue to payment"], about: { move: { from: ref(3), to: ref(4) } } });
    expect(kept.ready).toBe(false);
    expect(why).toEqual([
      "grouped as one screen, but their pictures and words differ",
      "a group of fewer than two screens sent",
      "a state whose words aren't on the screen",
      "a move whose control isn't on the screen it leaves",
      "a move between screens not sent",
      "fewer than two screens sent",
      "the screen's words don't name the step",
      "a question whose words aren't on its screens",
    ]);
  });

  it("takes the person's answers: one screen when they say so, the control they name, nothing asked twice", () => {
    const answers: SeenAnswer[] = [
      { question: "q1", ask: "Are “Cart” and “Empty cart” one screen, in two states?", answer: SAME_SCREEN, about: { same: [ref(1), ref(6)] } },
      { question: "q3", ask: "On “Address”, what takes you to “Slot”?", answer: "Continue to payment", about: { move: { from: ref(3), to: ref(4) } } },
    ];
    const kept = sanitizePlace(answer, placeMaterial(input(answers)), { answers });
    expect(kept.groups.find((g) => g.includes(ref(1)))).toEqual([ref(1), ref(2), ref(6)]);
    expect(kept.flows[0].moves[1]).toEqual({ from: ref(3), to: ref(4), via: "Continue to payment", how: "tap" });
    expect(kept.questions.map((q) => q.by)).toEqual(["qalam"]);
    // After the last round nothing more is asked.
    const last = sanitizePlace(answer, placeMaterial(input(answers)), { answers, last: true });
    expect(last.questions).toEqual([]);
    expect(last.ready).toBe(true);
  });

  it("makes the map as it would be: kept screens keep their keys and gain states, a person's flow stays", () => {
    const before: SeenMap = {
      key: "grocery",
      product: "grocery",
      readAt: 1,
      screens: [
        { key: "cart", name: "Basket", shots: [ref(1)], states: {}, kind: "list", does: "Their words", can: [], nav: [], by: "you", at: 1 },
        { key: "home", name: "Home", shots: [ref(20)], states: {}, kind: "home", can: [], nav: [], by: "qalam", at: 1 },
      ],
      flows: [{ key: "browse", name: "Browse", aim: "to find things", steps: ["home", "cart"], moves: [{ from: "home", to: "cart", via: "Cart", how: "tap" }], notShown: [], by: "you", at: 1 }],
      gone: [],
    };
    const fresh = shots.filter((s) => s.ref !== ref(1));
    const i = { ...input([], before), shots: fresh, texts: new Map([...texts, [ref(20), undefined]]) };
    const m = placeMaterial(i);
    expect([...m.nodes.keys()]).toEqual(["e1", "e2", "s1", "s2", "s3", "s4", "s5"]);
    expect(m.text).toContain("- f1 · Browse · to find things: e2 → e1 (a person's: leave it as it is)");
    const kept = sanitizePlace(
      {
        same: [["e1", "s1"]],
        flows: [
          { id: "f1", name: "Browse again", steps: ["e2", "e1"], moves: [] },
          { id: "new", name: "Checkout", aim: "to pay", steps: ["e1", "s2", "s3", "s4"], moves: [{ from: "e1", to: "s2", via: "Checkout", how: "tap" }] },
        ],
        code: [{ screen: "s3", step: "c1" }],
        ready: true,
      },
      m,
      { answers: [], last: true },
    );
    const { map, steps } = proposalOf(before, kept, { key: "grocery", product: "grocery", notes, shots: fresh, now: 5 });
    expect(map.screens.map((s) => [s.key, s.name, s.shots.length])).toEqual([
      ["cart", "Basket", 2],
      ["home", "Home", 1],
      ["address", "Address", 1],
      ["slot", "Slot", 1],
      ["pay", "Pay", 1],
      ["empty-cart", "Empty cart", 1],
    ]);
    expect(map.screens[0]).toMatchObject({ does: "Their words", by: "you", states: { [ref(2)]: "With a coupon applied" } });
    expect(map.flows.map((f) => [f.key, f.name, f.steps])).toEqual([
      ["browse", "Browse", ["home", "cart"]],
      ["checkout", "Checkout", ["cart", "address", "slot", "pay"]],
    ]);
    expect(steps).toEqual({ slot: "acme__basket/slot" });
  });
});
