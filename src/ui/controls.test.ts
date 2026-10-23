import { describe, expect, it } from "vitest";
import { rovingIndex } from "./controls";

describe("rovingIndex (segmented arrow keys)", () => {
  it("moves forward and back with wrap-around", () => {
    expect(rovingIndex(3, 0, "ArrowRight")).toBe(1);
    expect(rovingIndex(3, 2, "ArrowRight")).toBe(0);
    expect(rovingIndex(3, 0, "ArrowLeft")).toBe(2);
    expect(rovingIndex(3, 1, "ArrowUp")).toBe(0);
    expect(rovingIndex(3, 1, "ArrowDown")).toBe(2);
  });

  it("jumps with Home and End", () => {
    expect(rovingIndex(4, 2, "Home")).toBe(0);
    expect(rovingIndex(4, 1, "End")).toBe(3);
  });

  it("starts at the first option when nothing is picked (mixed value)", () => {
    expect(rovingIndex(3, -1, "ArrowRight")).toBe(0);
    expect(rovingIndex(3, -1, "ArrowLeft")).toBe(0);
  });

  it("ignores other keys and empty groups", () => {
    expect(rovingIndex(3, 1, "Enter")).toBeNull();
    expect(rovingIndex(0, 0, "ArrowRight")).toBeNull();
  });
});
