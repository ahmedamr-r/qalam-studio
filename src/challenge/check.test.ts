import { describe, expect, it } from "vitest";
import { challengeCall } from "@/ai/challenge";
import { challengeMaterial, sanitizeChallenges } from "./check";
import { findChallenges } from "./find";
import { funnelsIn } from "./funnel";
import { GROCERY_FUNNEL } from "./sample";
import type { CheckItem, CheckRequest, Evidence } from "./types";

const goalCard = { id: "g", kind: "outcome" as const, title: "More first-time parents complete checkout", parent: null, goal: "goal1" };
const slotPage = { id: "topic:g:slot", kind: "opportunity" as const, title: "I can't get a delivery slot when I need one", parent: "g", topic: "slot" };
const P: CheckItem = { id: "plan:p", kind: "opportunity", title: "Paying for my first order feels clunky", parent: "g", assumed: true };
const applePay: CheckItem = { id: "sol:a", kind: "solution", title: "Apple Pay and Google Pay", parent: "plan:p" };
const errors: CheckItem = { id: "sol:b", kind: "solution", title: "Better error messages on card failures", parent: "plan:p" };
const known: Evidence = { kind: "known", whose: "a problem page", from: "I can't get a delivery slot when I need one", text: "44 percent of users leave the funnel at picking a delivery slot, its largest loss.", for: [], topic: "slot", line: "l1", cites: ["hub:quote:q-slot"] };
const against: Evidence = { kind: "against", whose: "against, on a problem page", from: "I can't get through checkout on my first order", text: "Omar says the payment screen would not have made him leave: “I wouldn't have left because of that.”", for: ["sol:a"], topic: "checkout", line: "l7" };

function material(items: CheckItem[] = [P, applePay, errors]) {
  const req: CheckRequest = { origin: "plan:t1", asked: "I think the checkout itself is the problem. What should we do?", product: null, outline: [goalCard, slotPage], items };
  const { findings, evidence } = findChallenges({ req, funnels: funnelsIn(GROCERY_FUNNEL, "a2-funnel", "src1"), pages: [{ topic: "slot", title: slotPage.title, sources: 3, quotes: 6, known: [known], for: [] }], goals: new Map(), decided: [], evidence: [against] });
  return challengeMaterial({ req, evidence, findings });
}

let n = 0;
const id = () => `c${++n}`;

describe("what the call is sent", () => {
  it("names the proposals, their evidence and code's findings by id, what code rests on first", () => {
    const m = material();
    expect(m.text).toContain("What they asked: “I think the checkout itself is the problem. What should we do?”");
    expect(m.text).toContain("- p1 · Problem · “Paying for my first order feels clunky” · under goal “More first-time parents complete checkout” · nothing measured or said backs it yet");
    expect(m.text).toContain("- p2 · Solution · “Apple Pay and Google Pay” · under p1");
    expect(m.text).toMatch(/- e1 · measured · a2-funnel · “step: Picked a delivery slot · users_entering: 10000 · users_leaving: 4400 · percent_lost: 44” · for p1, p2, p3/);
    expect(m.text).toContain("- k1 · the whole set · Nothing proposed works on Picked a delivery slot, where 4,400 of 10,000 leave in “a2-funnel”. · e1");
    expect(m.text).toContain("- k2 · p1, p2, p3 · In “a2-funnel”, 4,400 of 10,000 leave at Picked a delivery slot, against 454 at Payment page reached, the step these work on. · e1, e2");
    // The page's line against, gathered for Apple Pay, is there too.
    expect([...m.evidence.values()].some((e) => e.line === "l7")).toBe(true);
    expect(challengeCall(m).kind).toBe("challenge");
  });
});

describe("what code keeps of the answer", () => {
  it("keeps lines that rest on what was sent, and stands code's findings the call left in code's own words", () => {
    const m = material();
    const e = (line: string) => [...m.evidence].find(([, x]) => x.line === line)![0];
    const dropped: string[] = [];
    const out = sanitizeChallenges(
      {
        challenges: [
          { on: ["p2", "p3"], line: "Your export loses 4,400 of 10,000 at Picked a delivery slot and only 454 at Payment page reached, where p2 works.", settle: "Filter the export to first orders.", cites: ["k2"] },
          { on: ["p2"], line: "Omar said “I wouldn't have left because of that.” about the payment screen.", settle: "", cites: [e("l7")] },
          { on: ["p1"], line: "Customers say “Paying was never the issue”.", settle: "", cites: [e("l7")] },
          { on: ["p2"], line: "Apple Pay lifts conversion by 30%.", settle: "", cites: [] },
          { on: ["p9"], line: "Something else.", settle: "", cites: ["e99"] },
          { on: ["p2"], line: "Your funnel loses 60% at the slot.", settle: "", cites: ["e1"] },
        ],
      },
      m,
      { id },
      (why) => dropped.push(why),
    );
    expect(out.map((c) => [c.kind, c.by, c.on])).toEqual([
      ["funnel-gap", "code", []],
      ["funnel-step", "qalam", ["plan:p", "sol:a", "sol:b"]],
      ["backing", "code", ["plan:p", "sol:a", "sol:b"]],
      ["evidence", "qalam", ["sol:a"]],
    ]);
    // The call's own words, its id turned into the proposal's.
    expect(out[1].line).toBe("Your export loses 4,400 of 10,000 at Picked a delivery slot and only 454 at Payment page reached, where “Apple Pay and Google Pay” works.");
    expect(out[1].settle).toBe("Filter the export to first orders.");
    expect(out[1].cites.map((c) => c.kind)).toEqual(["measured", "measured"]);
    expect(out[1].cites[0]).toMatchObject({ sourceId: "src1", text: expect.stringContaining("Picked a delivery slot") });
    expect(out[3].cites[0]).toMatchObject({ kind: "against", topic: "checkout", line: "l7" });
    expect(dropped).toEqual(expect.arrayContaining(["it rests on nothing it was sent", "nothing of it holds once what isn't in what it cites is out"]));
    // A quote that isn't the evidence's words, a number that isn't there: out.
    expect(out.some((c) => /never the issue|30%|60%/.test(c.line))).toBe(false);
  });

  it("never raises again what they dropped from the same evidence, the call's words or code's", () => {
    const m = material();
    const first = sanitizeChallenges({ challenges: [] }, m, { id });
    const step = first.find((c) => c.kind === "funnel-step")!;
    const again = sanitizeChallenges({ challenges: [{ on: ["p2"], line: "Your export loses 4,400 of 10,000 at Picked a delivery slot.", settle: "", cites: ["k2"] }] }, m, { id, dropped: new Set([step.key]) });
    expect(again.map((c) => c.kind)).toEqual(["funnel-gap", "backing"]);
  });

  it("keeps at most 2 of the call's own on a proposal, past code's findings, and says nothing twice", () => {
    const m = material();
    const e = (f: (x: Evidence) => boolean) => [...m.evidence].find(([, x]) => f(x))![0];
    const many = [
      { on: ["p2"], line: "Omar said “I wouldn't have left because of that.” about the payment screen.", settle: "", cites: [e((x) => x.line === "l7")] },
      { on: ["p2"], line: "Your slot page says 44 percent leave at picking a delivery slot.", settle: "", cites: [e((x) => x.line === "l1")] },
      { on: ["p2"], line: "Only 454 leave at the payment page.", settle: "", cites: [e((x) => x.text.includes("Payment page"))] },
    ];
    const out = sanitizeChallenges({ challenges: [...many, many[0]] }, m, { id });
    expect(out.filter((c) => c.kind === "evidence").map((c) => c.line)).toEqual([many[0].line, many[1].line]);
    expect(out.filter((c) => c.kind !== "evidence")).toHaveLength(3);
  });
});
