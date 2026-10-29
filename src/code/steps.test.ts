import { describe, expect, it } from "vitest";
import type { Goal } from "@/goals/types";
import type { MapFlow } from "./map";
import { foldPins, isStepRef, namesStep, pinShape, pinsOf, sanitizeSteps, stepMaterial, type StepPinLog } from "./steps";

const flow: MapFlow = {
  name: "Reordering",
  goal: "g1",
  steps: [
    { key: "opens-past-orders", title: "Opens past orders", file: "app/orders/page.tsx", snippet: "x", events: ["orders_viewed"] },
    { key: "address", title: "Confirms the delivery address", file: "ios/AddressView.swift", snippet: "y", events: ["address_confirmed"] },
    { key: "pays", title: "Pays", file: "android/PaymentScreen.kt", snippet: "z", events: ["checkout_paid"] },
  ],
};
const goal: Goal = { id: "g1", title: "More customers reorder weekly", parent: null, product: "grocery", status: "active", cites: [], by: "person", at: 1 };

describe("what's pinned at a step", () => {
  const at = (t: number, p: Partial<StepPinLog>): StepPinLog => ({ step: "acme__basket/address", what: "need", id: "tp1", by: "you", at: t, ...p });

  it("folds the log: a person's pin stands, one they took off never comes back from Qalam AI, a step holds one picture", () => {
    const { pins, refused } = foldPins([
      at(1, {}),
      at(2, { what: "quote", id: "hub:quote:q1", by: "qalam", words: "the address form" }),
      at(3, { what: "quote", id: "hub:quote:q1", removed: true }),
      at(4, { what: "quote", id: "hub:quote:q1", by: "qalam", words: "the address form" }),
      at(5, { what: "picture", id: "asset:aaaaaaaaaaaaaaaaaaaaaaaa" }),
      at(6, { what: "picture", id: "asset:bbbbbbbbbbbbbbbbbbbbbbbb" }),
      at(7, { step: "acme__basket/pays", id: "tp2", by: "qalam" }),
      at(8, { step: "acme__basket/pays", id: "tp2", by: "qalam", removed: true }),
      { ...at(9, {}), id: "../etc" },
    ]);
    expect(pins.map((p) => [p.step, p.what, p.id, p.by])).toEqual([
      ["acme__basket/address", "need", "tp1", "you"],
      ["acme__basket/address", "picture", "asset:bbbbbbbbbbbbbbbbbbbbbbbb", "you"],
    ]);
    expect([...refused]).toEqual(["quote|acme__basket/address|hub:quote:q1"]);
    expect(pinsOf(pins, "acme__basket", flow).get("acme__basket/address")).toHaveLength(2);
  });

  it("takes only steps, ids and pictures in their own shapes", () => {
    expect(isStepRef("acme__basket/address")).toBe(true);
    expect(isStepRef("../x/address")).toBe(false);
    expect(isStepRef(".qalam/address")).toBe(false);
    expect(isStepRef("acme__basket/Address")).toBe(false);
    expect(pinShape({ step: "acme__basket/address", what: "toString", id: "x", by: "you", at: 1 })).toBeNull();
    expect(pinShape({ step: "acme__basket/address", what: "picture", id: "asset:../../x", by: "you", at: 1 })).toBeNull();
    expect(pinShape({ step: "acme__basket/address", what: "quote", id: "hub:quote:q1", by: "you", at: 1 })).toEqual({ step: "acme__basket/address", what: "quote", id: "hub:quote:q1", by: "you", at: 1 });
  });
});

describe("whether a quote's words name a step", () => {
  it("matches the step's title, its screen's file and its events, across word forms", () => {
    expect(namesStep("I can never change my address", flow.steps[1])).toBe(true);
    expect(namesStep("the payment kept failing", flow.steps[2])).toBe(true);
    expect(namesStep("so many addresses saved", flow.steps[1])).toBe(true);
    expect(namesStep("checkout froze", flow.steps[2])).toBe(true);
    expect(namesStep("my past orders were gone", flow.steps[0])).toBe(true);
    expect(namesStep("I love the app", flow.steps[0])).toBe(false);
    expect(namesStep("the screen was slow to open", flow.steps[1])).toBe(false);
  });
});

describe("Qalam AI placing quotes at steps, as code keeps it", () => {
  const m = stepMaterial({
    goal,
    map: "acme__basket",
    flow,
    quotes: [
      { ref: "hub:quote:q1", text: "Every week I have to type my address again, it never remembers it.", who: "Dana, Support call" },
      { ref: "hub:quote:q2", text: "The card payment failed twice and I gave up.", who: "Sam" },
      { ref: "hub:quote:q3", text: "Honestly the whole thing feels slow.", who: "Lee" },
    ],
  });

  it("sends the goal, the steps in order and the quotes by id", () => {
    expect(m.text).toContain("- s2 · Confirms the delivery address · ios/AddressView.swift · address_confirmed");
    expect(m.text).toContain('<quote id="q1" who="Dana, Support call">Every week I have to type my address again');
    expect([...m.steps.values()].map((s) => s.ref)).toEqual(["acme__basket/opens-past-orders", "acme__basket/address", "acme__basket/pays"]);
  });

  it("keeps a place only when its words are in the quote and name the step, one step per quote", () => {
    const dropped: string[] = [];
    const kept = sanitizeSteps(
      {
        places: [
          { quote: "q1", step: "s2", words: "type my address again" },
          { quote: "q1", step: "s3", words: "type my address again" },
          { quote: "q2", step: "s3", words: "The card payment failed" },
          { quote: "q3", step: "s1", words: "the whole thing feels slow" },
          { quote: "q2", step: "s9", words: "payment failed" },
          { quote: "q9", step: "s1", words: "anything" },
          { quote: "q2", step: "s2", words: "the address was wrong" },
        ],
      },
      m,
      { now: 5, refused: new Set() },
      (why) => dropped.push(why),
    );
    expect(kept).toEqual([
      { step: "acme__basket/address", what: "quote", id: "hub:quote:q1", words: "type my address again", by: "qalam", at: 5 },
      { step: "acme__basket/pays", what: "quote", id: "hub:quote:q2", words: "The card payment failed", by: "qalam", at: 5 },
    ]);
    expect(dropped).toEqual(["taken off by a person, or placed twice", "its words don't name the step", "a step not sent", "a quote not sent", "taken off by a person, or placed twice"]);
    expect(sanitizeSteps({ places: [{ quote: "q1", step: "s2", words: "type my address again" }] }, m, { now: 5, refused: new Set(["quote|acme__basket/address|hub:quote:q1"]) })).toEqual([]);
  });
});
