import { describe, expect, it } from "vitest";
import { sanitizeExtract } from "@/discovery/synthesis";
import { foundNumber, sanitizeFoundGoals, type KeptPoint } from "./found";

let n = 0;
const id = () => `f${++n}`;
const kept = new Map<string, KeptPoint>([
  ["q1", { id: "a", text: "Weekly orders reached 5,780 in September.", basis: "measured" }],
  ["q2", { id: "b", text: "Our plan is to focus on families rather than offices. We aim for 8,000 weekly orders.", basis: "own" }],
  ["q3", { id: "c", text: "I wish it remembered my card.", basis: undefined }],
  ["q4", { id: "d", text: "Rivals aim for one-hour delivery slots.", basis: "read" }],
]);
const metric = { name: "Weekly orders", current: 5780, target: 8000, direction: "increase" };

describe("goals a document points to", () => {
  it("keeps one resting on the team's own aim or a number it tracks", () => {
    const [g] = sanitizeFoundGoals([{ title: "More shoppers place an order every week", metric, quoteIds: ["q1", "q2"] }], kept, [], id);
    expect(g).toMatchObject({ title: "More shoppers place an order every week", cites: ["a", "b"], metric: { name: "Weekly orders", current: 5780, target: 8000 } });
  });

  it("never one resting only on a customer's wish or someone else's report", () => {
    expect(sanitizeFoundGoals([{ title: "Remember my card", metric: null, quoteIds: ["q3"] }], kept, [], id)).toEqual([]);
    expect(sanitizeFoundGoals([{ title: "Offer one-hour delivery slots", metric: null, quoteIds: ["q4"] }], kept, [], id)).toEqual([]);
    expect(sanitizeFoundGoals([{ title: "Anything", metric: null, quoteIds: ["q9"] }], kept, [], id)).toEqual([]);
  });

  it("takes no number that isn't in what it cites, on its words or on its metric", () => {
    expect(sanitizeFoundGoals([{ title: "Reach 20,000 weekly orders", metric: null, quoteIds: ["q1"] }], kept, [], id)).toEqual([]);
    const [g] = sanitizeFoundGoals([{ title: "More weekly orders", metric: { ...metric, current: 9999, target: 20000 }, quoteIds: ["q1"] }], kept, [], id);
    expect(g.metric).toMatchObject({ current: null, target: null });
  });

  it("leaves off a metric named in words the document doesn't use", () => {
    const [g] = sanitizeFoundGoals([{ title: "More weekly orders", metric: { name: "Customer lifetime value", current: 5780, target: null, direction: "increase" }, quoteIds: ["q1"] }], kept, [], id);
    expect(g.metric).toBeUndefined();
  });

  it("doesn't propose one they have, twice, or more than three", () => {
    const title = "More weekly orders";
    expect(sanitizeFoundGoals([{ title, metric: null, quoteIds: ["q1"] }], kept, ["More weekly orders"], id)).toEqual([]);
    expect(sanitizeFoundGoals([{ title, metric: null, quoteIds: ["q1"] }, { title, metric: null, quoteIds: ["q2"] }], kept, [], id)).toHaveLength(1);
    const many = ["families", "offices", "orders", "September", "plan"].map((w) => ({ title: `More ${w}`, metric: null, quoteIds: ["q2"] }));
    expect(sanitizeFoundGoals(many, kept, [], id).length).toBeLessThanOrEqual(3);
    expect(sanitizeFoundGoals("lots", kept, [], id)).toEqual([]);
  });

  it("says its number in words", () => {
    expect(foundNumber({ name: "Weekly orders", direction: "increase", baseline: null, current: 5780, target: 8000 })).toBe("Weekly orders: 5,780 → 8,000");
    expect(foundNumber({ name: "Weekly orders", direction: "increase", baseline: null, current: null, target: null })).toBe("Weekly orders");
    expect(foundNumber(undefined)).toBe("");
  });

  it("comes through the reader, under the source its point is in", () => {
    const text = "Weekly orders reached 5,780 in September.";
    const got = sanitizeExtract({ quotes: [{ id: "q1", chunkId: "c1", text, kind: "finding", basis: "measured" }], goals: [{ title: "More weekly orders", metric, quoteIds: ["q1"] }] }, [{ ref: "c1", sourceId: "s", start: 0, text, kind: "text" }]);
    expect(got.foundGoals).toMatchObject([{ sourceId: "s", goal: { title: "More weekly orders", metric: { current: 5780, target: null } } }]);
  });
});
