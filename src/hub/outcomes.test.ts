import { describe, expect, it } from "vitest";
import { outcomesSchema } from "@/ai/outcomes";
import { newGoal } from "@/org/context-md";
import { outcomesMaterial, raisedBy, sanitizeOutcomes } from "./outcomes";
import type { Voice } from "./people";
import type { Topic } from "./topics";

const at = Date.UTC(2026, 9, 1);
const topic = (id: string, title: string, lines: [string, Topic["lines"][number]["section"], string[]][], products = ["grocery"]): Topic => ({
  id,
  kind: "need",
  title,
  products,
  createdAt: at,
  updatedAt: at,
  lines: lines.map(([lid, section, cites], i) => ({ id: lid, section, text: ["Parents rebuild the same basket every week.", "They say it takes “40 minutes every Sunday”.", "We think a saved basket would do."][i] ?? lid, by: "qalam", cites, from: [], at })),
  history: [],
});
const voice = (key: string, segments: string[]): Voice => ({ key, segments, source: key, at });
const voices = new Map([
  ["hub:quote:a", voice("person:sara", ["Parents"])],
  ["hub:quote:b", voice("person:omar", ["Offices"])],
  ["hub:quote:c", voice("person:lina", ["Parents"])],
]);
const basket = topic("tBasket", "Rebuilding my basket takes forever", [["l1", "know", ["hub:quote:a", "hub:quote:b"]], ["l2", "know", ["hub:quote:c"]], ["l3", "believe", []]]);
const courier = topic("tCourier", "I never know when the courier comes", [["l9", "know", ["hub:quote:a"]]]);
const offices = topic("tOffice", "Invoices are a mess", [["l7", "know", ["hub:quote:b"]]], ["business"]);

const material = () =>
  outcomesMaterial({
    goal: { ...newGoal("2M dirhams a month in orders"), by: "end of Q2" },
    owner: "Grocery app",
    context: "The product (Grocery app):\nStrategy: Be the fastest.",
    topics: [courier, basket, offices],
    voices,
    outcomes: [{ title: "Faster deliveries", board: "Couriers", metric: "On-time deliveries · 80% now → 95%" }],
    product: "grocery",
  });

describe("which outcomes would move a goal", () => {
  it("counts who raises each need from its known lines", () => {
    expect(raisedBy(basket, voices)).toMatchObject({ voices: 3, segments: [["Parents", 2], ["Offices", 1]] });
  });

  it("sends the goal, the context, the outcomes already worked on, and the product's needs, the most raised first", () => {
    const m = material();
    expect(m.text).toContain("The goal (Grocery app's): 2M dirhams a month in orders (by end of Q2)");
    expect(m.text).toContain("- “Faster deliveries” · On-time deliveries · 80% now → 95% · on Couriers");
    expect(m.text).toContain("- t1 · “Rebuilding my basket takes forever” · raised by 3 voices in 2 segments (3 sources)\n  - l1 · We know: Parents rebuild the same basket every week.");
    expect(m.text).toContain("- t2 · “I never know when the courier comes” · raised by 1 voice in 1 segment (1 source)");
    expect(m.text).not.toContain("Invoices");
    expect([...m.needs]).toEqual([["t1", "tBasket"], ["t2", "tCourier"]]);
    expect(outcomesSchema({ ids: m.ids, needs: [...m.needs.keys()] }).properties.candidates).toBeTruthy();
  });

  it("keeps a candidate only on lines it cites, its words found there, and never one a board has", () => {
    const m = material();
    const r = sanitizeOutcomes(
      {
        candidates: [
          {
            title: "More families reorder every week",
            metric: { name: "Weekly reorders per customer", direction: "increase" },
            why: "Three people in two segments rebuild the same basket, one taking “40 minutes every Sunday”.",
            moves: "Reorders every week are most of the 2M dirhams in orders.",
            control: "yes",
            needs: ["t1", "t9"],
            cites: ["t1", "l1", "l2", "zz"],
          },
          // A number nowhere in what it cites.
          { title: "More families order twice a week", metric: { name: "Orders", direction: "increase" }, why: "Half of parents would, 50% say so.", moves: "More orders.", control: "yes", needs: ["t1"], cites: ["l1"] },
          // Only a page, no line.
          { title: "Fewer missed deliveries", metric: { name: "Missed deliveries", direction: "decrease" }, why: "Parents wait.", moves: "Fewer refunds.", control: "partly", needs: ["t2"], cites: ["t2"] },
          // A board works on it already.
          { title: "Faster deliveries", metric: { name: "On-time deliveries", direction: "increase" }, why: "Parents wait at home.", moves: "More orders.", control: "yes", needs: ["t2"], cites: ["l4"] },
        ],
        note: "",
      },
      m,
    );
    expect(r.candidates).toEqual([
      {
        title: "More families reorder every week",
        metric: { name: "Weekly reorders per customer", direction: "increase" },
        why: "Three people in two segments rebuild the same basket, one taking “40 minutes every Sunday”.",
        moves: "Reorders every week are most of the 2M dirhams in orders.",
        control: "yes",
        needs: ["tBasket"],
        refs: ["hub:topic:tBasket", "hub:topic:tBasket:l1", "hub:topic:tBasket:l2"],
      },
    ]);
    expect(r.note).toBeUndefined();
  });
});
