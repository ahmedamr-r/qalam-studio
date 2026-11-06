import { describe, expect, it } from "vitest";
import { boxTarget, moreLine, nameAfterRead, SCAN_MAX, START_PICTURES, startPlan, startProblem, startTarget, stripPreamble, targetAfterRead, whoseOf, type BoxDoc } from "./start";

describe("what the words say to look at", () => {
  it("makes a company's product theirs, whether it's a name, a site or an App Store link", () => {
    expect(startTarget("company", "Basket")).toEqual({ kind: "product", name: "Basket", mine: true });
    expect(startTarget("company", "linear.app")).toEqual({ kind: "product", name: "Linear", mine: true });
    const app = startTarget("company", "https://apps.apple.com/us/app/x/id123456789");
    expect(app).toMatchObject({ kind: "product", mine: true });
  });

  it("takes a lower-case name on the company's path as a name, not an idea", () => {
    expect(startTarget("company", "grocery basket")).toEqual({ kind: "product", name: "grocery basket", mine: true });
  });

  it("takes a sentence on the company's path as them saying what it does, and finds its name in it when they gave one", () => {
    const said = "We are a grocery delivery company working in three cities right now";
    expect(startTarget("company", said)).toEqual({ kind: "idea", said });
    const named = "Basket, our grocery app for parents";
    const t = startTarget("company", named)!;
    expect(t).toEqual({ kind: "idea", said: named });
    expect(targetAfterRead("company", t, { named: true, product: "Basket", name: "Basket" })).toEqual({ kind: "product", name: "Basket", mine: true });
    // On their own idea, a name found doesn't make it a product of theirs.
    expect(targetAfterRead("idea", { kind: "idea", said: named }, { named: true, product: "Basket", name: "Basket" })).toEqual({ kind: "idea", said: named });
  });

  it("names the project from what they explained, never from the sentence itself", () => {
    const idea = { kind: "idea" as const, said: "Something to help freelancers chase invoices clients pay late" };
    expect(nameAfterRead(idea, { named: true, product: "", name: "Freelancer invoice chasing" })).toBe("Freelancer invoice chasing");
    expect(nameAfterRead(idea, { named: true, product: "", name: "" })).toBe("My project");
    expect(nameAfterRead(idea, { named: false, product: "", name: "" })).toBe("My project");
    expect(nameAfterRead({ kind: "product", name: "Basket", mine: true }, { named: true, product: "Basket", name: "Grocery app" })).toBe("Basket");
    expect(nameAfterRead({ kind: "idea", said: "a meal planner" }, { named: true, product: "", name: "" })).toBe("Meal planner");
  });

  it("keeps an idea an idea, even when it reads like a name", () => {
    expect(startTarget("idea", "Meal Planner")).toEqual({ kind: "idea", said: "Meal Planner" });
    expect(startTarget("idea", "A meal planner for nurses")).toEqual({ kind: "idea", said: "A meal planner for nurses" });
  });

  it("reads a link on the idea's path as a product, not theirs", () => {
    expect(startTarget("idea", "linear.app")).toEqual({ kind: "product", name: "Linear" });
  });

  it("wants something to read", () => {
    expect(startTarget("idea", " a ")).toBeNull();
  });
});

describe("what's found isn't all there is", () => {
  it("says more can come in later, problems and goals both", () => {
    for (const path of ["company", "idea"] as const) expect(moreLine(path)).toMatch(/any time from the canvas, to find more problems and goals\.$/);
  });

  it("offers analytics only to a company, since an idea has none yet", () => {
    expect(moreLine("company")).toContain("analytics");
    expect(moreLine("idea")).not.toContain("analytics");
  });
});

describe("the one box", () => {
  it("takes the opening that says whose it is off what's read", () => {
    expect(stripPreamble("Our app is Basket")).toEqual({ rest: "Basket", cue: "company" });
    expect(stripPreamble("My idea is a meal planner for nurses")).toEqual({ rest: "a meal planner for nurses", cue: "idea" });
    expect(stripPreamble("I'm building a meal planner")).toEqual({ rest: "a meal planner", cue: "idea" });
    expect(stripPreamble("فكرتي هي تطبيق للوجبات")).toEqual({ rest: "تطبيق للوجبات", cue: "idea" });
    expect(stripPreamble("A meal planner")).toEqual({ rest: "A meal planner", cue: null });
    expect(stripPreamble("Our app is ")).toEqual({ rest: "Our app is", cue: null });
  });

  it("reads a product's name after the opening, and a description of theirs as one to look into", () => {
    expect(boxTarget("Our app is Basket, it delivers groceries").target).toEqual({ kind: "product", name: "Basket", mine: true });
    expect(boxTarget("We make linear.app").target).toMatchObject({ kind: "product", name: "Linear", mine: true });
    expect(boxTarget("Our product is a grocery delivery app for families in Riyadh").target).toEqual({ kind: "idea", said: "a grocery delivery app for families in Riyadh" });
    expect(boxTarget("Basket").target).toEqual({ kind: "product", name: "Basket" });
  });

  it("says whose it is from their words, and when it can't", () => {
    const t = (s: string) => boxTarget(s);
    const whose = (s: string, docs: BoxDoc[] = []) => whoseOf(s, docs, t(s).target, t(s).cue);
    expect(whose("Our app is Basket")).toEqual({ shape: "team", mine: true, sure: true });
    expect(whose("Basket")).toEqual({ shape: "solo", mine: false, sure: false, ask: "product" });
    expect(whose("I'm building a meal planner for night-shift workers")).toEqual({ shape: "solo", mine: false, sure: true });
    expect(whose("A meal planner for night-shift workers")).toEqual({ shape: "solo", mine: false, sure: true });
    expect(whose("We see churn after the first order in our grocery app")).toMatchObject({ shape: "team", sure: true });
    expect(whose("Weekly meal plans for nurses")).toMatchObject({ shape: "solo", sure: true });
    expect(whose("تطبيقنا اسمه سلة")).toMatchObject({ shape: "team", sure: true });
    expect(whose("My idea is something we'd sell to our customers")).toEqual({ shape: "team", mine: false, sure: false, ask: "shape" });
    expect(whose("", [{ title: "Support tickets", group: "voice" }])).toMatchObject({ shape: "team", sure: true });
    expect(whose("", [{ title: "notes.pdf" }])).toEqual({ shape: "solo", mine: false, sure: false, ask: "shape" });
  });

  it("turns words alone into a scan, customers' words into a take, and long thinking into a dump", () => {
    expect(startPlan("Our app is Basket", [])).toEqual({ turns: [{ mode: "scan", said: "Our app is Basket", target: { kind: "product", name: "Basket", mine: true } }], name: "Basket", whose: { shape: "team", mine: true, sure: true } });
    expect(startPlan("A meal planner for nurses", [])?.turns).toEqual([{ mode: "scan", said: "A meal planner for nurses", target: { kind: "idea", said: "A meal planner for nurses" } }]);
    expect(startPlan("Sara: it's late\nOmar: always", [], "customers")?.turns).toEqual([{ mode: "take", said: "Sara: it's late\nOmar: always" }]);
    expect(startPlan("x".repeat(SCAN_MAX + 1), [])?.turns[0].mode).toBe("dump");
    expect(startPlan("", [])).toBeNull();
  });

  it("takes docs in, with a scan beside them only when the words name what to look at", () => {
    const pdf: BoxDoc = { title: "Interviews with nurses.pdf" };
    expect(startPlan("Here are my notes from last week", [pdf])?.turns).toEqual([{ mode: "take", said: "Here are my notes from last week" }]);
    expect(startPlan("Our app is Basket", [pdf])?.turns.map((x) => x.mode)).toEqual(["take", "scan"]);
    expect(startPlan("My idea is a meal planner for nurses", [pdf])?.turns.map((x) => x.mode)).toEqual(["take", "scan"]);
    expect(startPlan("", [{ title: "Plan.md", basis: "own" }])?.turns).toEqual([{ mode: "dump", said: "" }]);
  });

  it("names the project from what it looks at, else the first doc, else plainly", () => {
    expect(startPlan("a meal planner for nurses", [])?.name).toBe("Meal planner for nurses");
    expect(startPlan("", [{ title: "IMG_2041.png", image: true }, { title: "Nurse_interviews_2026.pdf" }])?.name).toBe("Nurse interviews 2026");
    expect(startPlan("", [{ title: "IMG_2041.png", image: true }])?.name).toBe("New project");
  });

  it("says what stops a message", () => {
    expect(startProblem("", [], "ok")).toMatch(/Say what/);
    expect(startProblem("", Array.from({ length: START_PICTURES + 1 }, (_, i) => ({ title: `${i}.png`, image: true as const })), "ok")).toMatch(/Up to/);
    expect(startProblem("Basket", [{ title: "a.pdf" }], "none")).toMatch(/needs to be set up/);
    expect(startProblem("Basket", [], "none")).toBeNull();
  });
});
