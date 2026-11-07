import { describe, expect, it } from "vitest";
import { tableText } from "@/discovery/ingest/rows";
import { capOf, decidedTitles, findChallenges, type FindInput, type PageBacking } from "./find";
import { funnelsIn } from "./funnel";
import { GROCERY_FUNNEL } from "./sample";
import type { CheckItem, CheckRequest, Evidence } from "./types";

const goalCard = { id: "g", kind: "outcome" as const, title: "More first-time parents complete checkout", parent: null, goal: "goal1" };
const slotPage = { id: "topic:g:slot", kind: "opportunity" as const, title: "I can't get a delivery slot when I need one", parent: "g", topic: "slot" };
const P: CheckItem = { id: "plan:p", kind: "opportunity", title: "Paying for my first order feels clunky", parent: "g", assumed: true };
const applePay: CheckItem = { id: "sol:a", kind: "solution", title: "Apple Pay and Google Pay", parent: "plan:p", assumptions: ["Parents who leave at payment find entering card details a hassle."] };
const errors: CheckItem = { id: "sol:b", kind: "solution", title: "Better error messages on card failures", parent: "plan:p" };

const known: Evidence = { kind: "known", whose: "a problem page", from: "I can't get a delivery slot when I need one", text: "44 percent of users leave the funnel at picking a delivery slot, its largest loss.", for: [], topic: "slot", line: "l1", cites: ["hub:quote:q-slot"] };
const slot: PageBacking = { topic: "slot", title: "I can't get a delivery slot when I need one", sources: 3, quotes: 6, known: [known], for: [] };
// The page the payment problem's own words found: it's that problem's, never the one it's compared with.
const checkout: PageBacking = { topic: "checkout", title: "I can't get through checkout on my first order", sources: 5, quotes: 9, known: [{ ...known, from: "I can't get through checkout on my first order", topic: "checkout", line: "c1" }], for: ["plan:p", "sol:a", "sol:b"] };

function input(items: CheckItem[], o: Partial<FindInput> = {}): FindInput {
  const req: CheckRequest = { origin: "plan:t1", asked: "What problems should we go after?", product: null, outline: [goalCard, slotPage], items };
  const [funnel] = funnelsIn(GROCERY_FUNNEL, "a2-funnel", "src1");
  funnel.steps[1] = { ...funnel.steps[1], quote: { sourceId: "src1", quoteId: "q-slot" } } as typeof funnel.steps[number];
  return { req, funnels: [funnel], pages: [checkout, slot], goals: new Map([["goal1", { title: goalCard.title, unit: "%", current: null, target: null, direction: "increase" }]]), decided: [], evidence: [], ...o };
}

describe("code's findings on a2's plan", () => {
  it("puts the payment ideas against the slot step, says nothing works on the slot, and that a better backed problem gets nothing", () => {
    const { findings, evidence } = findChallenges(input([P, applePay, errors]));
    expect(findings.map((f) => f.kind)).toEqual(["funnel-gap", "funnel-step", "backing"]);
    const [gap, step, backing] = findings;
    expect(gap.on).toEqual([]);
    expect(gap.line).toBe("Nothing proposed works on Picked a delivery slot, where 4,400 of 10,000 leave in “a2-funnel”.");
    expect(step.on).toEqual(["plan:p", "sol:a", "sol:b"]);
    expect(step.line).toBe("In “a2-funnel”, 4,400 of 10,000 leave at Picked a delivery slot, against 454 at Payment page reached, the step these work on.");
    // What it rests on is the sheet's own rows, the slot's as the quote the source's reading picked out.
    expect(step.rests.map((i) => evidence[i].text)).toEqual([expect.stringContaining("Picked a delivery slot"), expect.stringContaining("Payment page reached")]);
    expect(evidence[step.rests[0]]).toMatchObject({ kind: "measured", sourceId: "src1", quoteId: "q-slot", piece: "hub:quote:q-slot" });
    expect(backing.on).toEqual(["plan:p", "sol:a", "sol:b"]);
    expect(backing.line).toBe("Nothing customers said or that was measured backs “Paying for my first order feels clunky” yet, while “I can't get a delivery slot when I need one” has 3 sources behind it and no solution proposed for it.");
    expect(evidence[backing.rests[0]]).toMatchObject({ kind: "known", topic: "slot", line: "l1", for: ["plan:p", "sol:a", "sol:b"] });
  });

  it("counts a problem proposed about a page, with a solution under it, as something proposed for that page", () => {
    const slotProblem: CheckItem = { id: "plan:s", kind: "opportunity", title: "I can't get a delivery slot that works for my family", parent: "g" };
    const evenings: CheckItem = { id: "sol:e", kind: "solution", title: "Evening delivery windows", parent: "plan:s" };
    const pages = [checkout, { ...slot, for: ["plan:s", "sol:e"] }];
    expect(findChallenges(input([P, applePay, slotProblem, evenings], { pages })).findings.find((f) => f.kind === "backing")).toBeUndefined();
    // With no solution under it, it's still the better backed problem with none.
    expect(findChallenges(input([P, applePay, slotProblem], { pages: [checkout, { ...slot, for: ["plan:s"] }] })).findings.find((f) => f.kind === "backing")?.line).toContain("no solution proposed for it");
  });

  it("leaves a proposal that works on the slot too alone, and with one there, nothing is missing", () => {
    const onePage: CheckItem = { id: "sol:c", kind: "solution", title: "One-page checkout", description: "Address, delivery slot and payment on one page.", parent: "plan:p" };
    const { findings } = findChallenges(input([P, applePay, onePage]));
    expect(findings.find((f) => f.kind === "funnel-gap")).toBeUndefined();
    expect(findings.find((f) => f.kind === "funnel-step")?.on).toEqual(["plan:p", "sol:a"]);
  });

  it("says nothing when the slot has a solution on the canvas already", () => {
    const req = input([P, applePay]);
    req.req.outline.push({ id: "s9", kind: "solution", title: "Evening windows", parent: "topic:g:slot" });
    expect(findChallenges(req).findings.find((f) => f.kind === "funnel-gap")).toBeUndefined();
  });

  it("says nothing of a funnel no proposal names", () => {
    const tidy: CheckItem = { id: "sol:d", kind: "solution", title: "A loyalty programme", parent: null };
    expect(findChallenges(input([tidy])).findings).toEqual([]);
  });

  it("works out how far a step could move the goal, only when the funnel is the goal's own number", () => {
    const own = input([P, applePay], { goals: new Map([["goal1", { title: goalCard.title, unit: "%", current: 46, target: 60, direction: "increase" }]]) });
    const cap = findChallenges(own).findings.find((f) => f.kind === "funnel-cap");
    expect(cap?.line).toBe("Even if all 454 who leave at Payment page reached went on, completion would rise by about 4.5 points; the goal needs 14 (from 46% to 60%).");
    // a2's real goal says 38%, and the export completes 46%: not the same number, so nothing.
    const theirs = input([P, applePay], { goals: new Map([["goal1", { title: goalCard.title, unit: "%", current: 38, target: 50, direction: "increase" }]]) });
    expect(findChallenges(theirs).findings.find((f) => f.kind === "funnel-cap")).toBeUndefined();
    const [f] = funnelsIn(GROCERY_FUNNEL, "a2-funnel");
    expect(capOf(f, 3, { title: "", unit: "%", current: 46, target: 48, direction: "increase" })).toBeNull();
  });

  it("finds a card with the same words dropped before, and a proposal like it left out", () => {
    const drop = { id: "d1", at: Date.UTC(2026, 9, 3), kind: "drop" as const, title: "Apple Pay and Google Pay", what: "Dropped the solution “Apple Pay and Google Pay”", why: "Our payment provider can't do it this year." };
    const { findings, evidence } = findChallenges(input([applePay], { funnels: [], decided: [drop] }));
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe("On 2026-10-03, “Apple Pay and Google Pay” was dropped, with the reason “Our payment provider can't do it this year”.");
    expect(evidence[findings[0].rests[0]]).toMatchObject({ kind: "decided", decision: "d1" });
    expect(decidedTitles({ kind: "discard", cardTitle: "", detail: { proposals: [{ kind: "card", line: "Add “Apple Pay and Google Pay”" }, { kind: "attach", line: "Attach a quote to “X”" }] } })).toEqual(["Apple Pay and Google Pay"]);
  });
});

describe("other kinds of product", () => {
  it("a signup: reminders to verify while most are lost making a workspace", () => {
    const signup = tableText([["Funnel step", "Users"], ["Signed up", "5,000"], ["Verified email", "4,100"], ["Created workspace", "2,300"], ["Invited a teammate", "900"]])!;
    const [funnel] = funnelsIn(signup, "Signup funnel", "s2");
    const goal = { id: "g", kind: "outcome" as const, title: "More teams active in week one", parent: null };
    const remind: CheckItem = { id: "sol:r", kind: "solution", title: "Remind people by email to verify", parent: "g" };
    const { findings } = findChallenges({ req: { origin: "x", asked: "", product: null, outline: [goal], items: [remind] }, funnels: [funnel], pages: [], goals: new Map(), decided: [], evidence: [] });
    expect(findings.map((f) => f.line)).toEqual([
      "Nothing proposed works on Created workspace, where 1,800 of 5,000 leave in “Signup funnel”.",
      "In “Signup funnel”, 1,800 of 5,000 leave at Created workspace, against 900 at Verified email, the step this works on.",
    ]);
    // Worked out from the counts: what a line citing it may say.
    expect(findings[1].facts).toEqual(["1,800", "900", "5,000"]);
  });

  it("a lending application in percentages: an ID upload change isn't far enough behind to say anything", () => {
    const lending = tableText([["Stage", "Conversion rate"], ["Application started", "100%"], ["ID uploaded", "65%"], ["Income verified", "92%"], ["Loan signed", "40%"]])!;
    const [funnel] = funnelsIn(lending, "Applications");
    const goal = { id: "g", kind: "outcome" as const, title: "More approved loans signed", parent: null };
    const upload: CheckItem = { id: "sol:u", kind: "solution", title: "Faster ID upload with the camera", parent: "g" };
    const income: CheckItem = { id: "sol:i", kind: "solution", title: "Check income from bank data", parent: "g" };
    const { findings } = findChallenges({ req: { origin: "x", asked: "", product: null, outline: [goal], items: [upload, income] }, funnels: [funnel], pages: [], goals: new Map(), decided: [], evidence: [] });
    const step = findings.filter((f) => f.kind === "funnel-step");
    expect(step.map((f) => [f.on, f.line])).toEqual([[["sol:i"], "In “Applications”, 60% leave at Loan signed, against 8% at Income verified, the step this works on."]]);
  });
});
