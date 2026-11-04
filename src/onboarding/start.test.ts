import { describe, expect, it } from "vitest";
import { steerRound } from "@/scan/steer";
import { answerSaid, firstAnswerProblem, meFrom, moreLine, pathOfShape, saidOf, shapeOfPath, startQuestions, startTarget, WHO_TITLE } from "./start";

const q = (path: "company" | "idea", id: string) => startQuestions(path).find((x) => x.id === id)!;

describe("the first answer", () => {
  it("makes a company's product theirs, whether it's a name, a site or an App Store link", () => {
    expect(startTarget("company", "Basket")).toEqual({ kind: "product", name: "Basket", mine: true });
    expect(startTarget("company", "linear.app")).toEqual({ kind: "product", name: "Linear", mine: true });
    const app = startTarget("company", "https://apps.apple.com/us/app/x/id123456789");
    expect(app).toMatchObject({ kind: "product", mine: true });
  });

  it("takes a lower-case name on the company's path as a name, not an idea", () => {
    expect(startTarget("company", "grocery basket")).toEqual({ kind: "product", name: "grocery basket", mine: true });
  });

  it("asks again for a sentence on the company's path", () => {
    const said = "We are a grocery delivery company working in three cities right now";
    expect(startTarget("company", said)).toBeNull();
    expect(firstAnswerProblem("company", said)).toBe("Just its name or link is enough.");
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
    expect(firstAnswerProblem("idea", "")).toBeTruthy();
    expect(firstAnswerProblem("company", "")).toBe("Name the product, or paste its link.");
    expect(firstAnswerProblem("idea", "A meal planner")).toBeNull();
  });

  it("says back what they gave", () => {
    expect(saidOf({ kind: "idea", said: "A planner" })).toBe("A planner");
    expect(saidOf({ kind: "product", name: "Basket" })).toBe("Basket");
    expect(saidOf({ kind: "product", name: "", app: "https://x" })).toBe("https://x");
  });
});

describe("the questions after it", () => {
  it("are role and what to move for a company, who and what to find out for an idea", () => {
    expect(startQuestions("company").map((x) => x.id)).toEqual(["role", "move"]);
    expect(startQuestions("idea").map((x) => x.id)).toEqual(["who", "want"]);
  });

  it("ask who in the scan's own words, so the chat doesn't ask it again", () => {
    expect(steerRound({ kind: "idea", said: "x" }).some((x) => x.title === WHO_TITLE)).toBe(true);
    expect(q("idea", "who").title).toBe(WHO_TITLE);
  });

  it("send answers to the scan, but a role stays out of it", () => {
    expect(answerSaid(q("company", "move"), "Retention")).toEqual([{ question: "What are you trying to move?", answer: "Retention" }]);
    expect(answerSaid(q("company", "role"), "Product")).toEqual([]);
    expect(answerSaid(q("idea", "want"), "  ")).toEqual([]);
  });

  it("turn a role into a position, their own words included", () => {
    expect(meFrom(q("company", "role"), "Design")).toEqual({ position: "designer" });
    expect(meFrom(q("company", "role"), "Growth lead")).toEqual({ position: "other", title: "Growth lead" });
    expect(meFrom(q("company", "move"), "Revenue")).toBeNull();
    expect(meFrom(q("company", "role"), " ")).toBeNull();
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

describe("the card", () => {
  it("is the shape the organization keeps", () => {
    expect(shapeOfPath("company")).toBe("team");
    expect(shapeOfPath("idea")).toBe("solo");
    expect(pathOfShape("team")).toBe("company");
    expect(pathOfShape("solo")).toBe("idea");
    expect(pathOfShape(undefined)).toBe("idea");
  });
});
