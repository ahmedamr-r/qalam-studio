import { describe, expect, it } from "vitest";
import { wrapTab } from "./focus-trap";

describe("workspace Tab trap", () => {
  it("wraps Tab on the last stop to the first", () => {
    expect(wrapTab(4, 3, false)).toBe(0);
  });

  it("wraps ⇧Tab on the first stop, or on the container, to the last", () => {
    expect(wrapTab(4, 0, true)).toBe(3);
    expect(wrapTab(4, -1, true)).toBe(3);
  });

  it("sends Tab from the container, or from a stop it does not list, to the first", () => {
    expect(wrapTab(4, -1, false)).toBe(0);
  });

  it("leaves moves between stops to the browser", () => {
    expect(wrapTab(4, 1, false)).toBeNull();
    expect(wrapTab(4, 2, true)).toBeNull();
    expect(wrapTab(1, 0, false)).toBe(0);
  });

  it("has nowhere to go without stops", () => {
    expect(wrapTab(0, -1, false)).toBeNull();
    expect(wrapTab(0, -1, true)).toBeNull();
  });
});
