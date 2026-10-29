import { describe, expect, it } from "vitest";
import { meShape, nameShape, personLine, positionLabel } from "./you";

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
});
