import { describe, expect, it } from "vitest";
import { indicatorBox } from "./motion";

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRectReadOnly;

describe("indicatorBox", () => {
  it("measures the item relative to the container, rounded to whole px", () => {
    expect(indicatorBox(rect(100, 50, 200, 28), rect(132.4, 52, 60.6, 24))).toEqual({ x: 32, y: 2, w: 61, h: 24 });
  });

  it("adds the container's scroll and removes its border", () => {
    expect(indicatorBox(rect(0, 0, 300, 400), rect(10, 120, 280, 36), { left: 0, top: 200 }, { left: 1, top: 1 })).toEqual({ x: 9, y: 319, w: 280, h: 36 });
  });
});
