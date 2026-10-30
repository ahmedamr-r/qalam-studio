import { describe, expect, it } from "vitest";
import { orgShape, wordsFor } from "./words";
import { meShape, nameShape, personLine, positionLabel, POSITIONS } from "./you";

describe("who's on this computer", () => {
  it("takes a position from the list, and Other only with its words", () => {
    expect(meShape({ position: "pm" })).toEqual({ position: "pm" });
    expect(meShape({ position: "pm", title: "ignored" })).toEqual({ position: "pm" });
    expect(meShape({ position: "other", title: "  Senior PM,   Payments " })).toEqual({ position: "other", title: "Senior PM, Payments" });
    expect(meShape({ position: "other", title: " " })).toBeNull();
    expect(meShape({ position: "ceo" })).toBeNull();
    expect(meShape(null)).toBeNull();
  });

  it("keeps a name only when there's one", () => {
    expect(nameShape("  Ahmed  Amr ")).toBe("Ahmed Amr");
    expect(nameShape(" ")).toBeNull();
    expect(nameShape(3)).toBeNull();
  });

  it("says who's answering in plain words", () => {
    expect(personLine({ name: "Ahmed", position: "pm" })).toBe("Ahmed, a product manager");
    expect(personLine({ name: "Lina", position: "product-lead" })).toBe("Lina, the head of product");
    expect(personLine({ name: "Sara", position: "other", title: "Growth lead" })).toBe("Sara, Growth lead");
    expect(positionLabel({ position: "founder" })).toBe("Founder or CEO");
    expect(positionLabel({ position: "other", title: "Growth lead" })).toBe("Growth lead");
  });

  it("on your own: never in the team's list, but kept and said", () => {
    expect(POSITIONS.some((p) => p.value === "solo")).toBe(false);
    expect(meShape({ position: "solo" })).toEqual({ position: "solo" });
    expect(personLine({ name: "Sara", position: "solo" })).toBe("Sara, working on it alone");
    expect(positionLabel({ position: "solo" })).toBe("On my own");
  });
});

describe("an organization's words", () => {
  it("a solo project's are a person's own; a team's, or one from before shapes, a team's", () => {
    expect(wordsFor("solo")).toMatchObject({ org: "project", whole: "The whole project", onlyUs: "only you say so" });
    expect(wordsFor("team")).toMatchObject({ org: "organization", whole: "The whole organization", onlyUs: "only the team says so" });
    expect(wordsFor(undefined)).toEqual(wordsFor("team"));
    expect(orgShape("solo")).toBe("solo");
    expect(orgShape("company")).toBeNull();
  });
});
