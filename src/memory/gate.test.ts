import { describe, expect, it } from "vitest";
import { asksWhereToFind, gateOf } from "./gate";
import type { KnownAnswer } from "./known";

const DAY = 86_400_000;
const now = 100 * DAY;
const k = (x: Partial<KnownAnswer> = {}): KnownAnswer => ({ id: "m1", text: "About 104%", how: "own", mine: true, at: now - DAY, flow: "find", match: "exact", ...x });
const q = (known: KnownAnswer[], title = "What is net revenue retention today?") => ({ title, known });

describe("a question asked again, answered from what they said before", () => {
  it("only by their own exact answer from the last two weeks", () => {
    expect(gateOf(q([k()]), now)?.id).toBe("m1");
    expect(gateOf(q([k({ how: "pick", text: "Agencies" })]), now)?.how).toBe("pick");
    expect(gateOf(q([k({ how: "unknown", text: "" })]), now)?.how).toBe("unknown");
    // A teammate's, a near match, an older one: shown with Use it, never in place of asking.
    expect(gateOf(q([k({ mine: false, name: "Omar" })]), now)).toBeNull();
    expect(gateOf(q([k({ match: "near" })]), now)).toBeNull();
    expect(gateOf(q([k({ at: now - 15 * DAY })]), now)).toBeNull();
    expect(gateOf(q([]), now)).toBeNull();
    expect(gateOf({ title: "What is net revenue retention today?" }, now)).toBeNull();
    // The first that stands, past the ones that don't.
    expect(gateOf(q([k({ id: "m0", mine: false }), k({ id: "m2" })]), now)?.id).toBe("m2");
  });

  it("never when the question asks who could tell them or where to find out", () => {
    for (const t of ["Who could tell you the NRR?", "Who would know the churn rate?", "Where could you find the funnel numbers?", "How could you find out what it is today?", "Which team knows the target?", "مين يعرف نسبة الاحتفاظ؟", "كيف نعرف الرقم؟"]) {
      expect(asksWhereToFind(t), t).toBe(true);
      expect(gateOf(q([k()], t), now), t).toBeNull();
    }
    for (const t of ["Who is it for?", "Who pays first?", "What is net revenue retention today?", "Where do first-time parents drop off?", "من هم العملاء؟"]) expect(asksWhereToFind(t), t).toBe(false);
  });
});
