import { describe, expect, it } from "vitest";
import { insertAtCursor } from "./insert";

describe("putting what was said at the cursor", () => {
  it("adds it at the end, a space between", () => {
    expect(insertAtCursor("We sell groceries.", null, "Mostly to parents.")).toEqual({ value: "We sell groceries. Mostly to parents.", caret: 37 });
    expect(insertAtCursor("", null, "  Hello there. ")).toEqual({ value: "Hello there.", caret: 12 });
  });

  it("goes in mid-sentence in lower case, with spaces on both sides", () => {
    const v = "refactor the auth to helper";
    const at = { start: 21, end: 21 };
    expect(insertAtCursor(v, at, "Use the new")).toEqual({ value: "refactor the auth to use the new helper", caret: 32 });
    // "I" stays, and punctuation needs no space before it.
    expect(insertAtCursor("so", null, "I think")).toMatchObject({ value: "so I think" });
    expect(insertAtCursor("Done", null, ", mostly.")).toMatchObject({ value: "Done, mostly." });
  });

  it("replaces what's selected", () => {
    expect(insertAtCursor("We sell XXX online.", { start: 8, end: 11 }, "groceries").value).toBe("We sell groceries online.");
  });

  it("folds line breaks for a one-line box and keeps to its length", () => {
    expect(insertAtCursor("", null, "one\ntwo", { oneLine: true }).value).toBe("one two");
    expect(insertAtCursor("abc", null, "defghij", { max: 8 })).toEqual({ value: "abc defg", caret: 8 });
    expect(insertAtCursor("abcdefgh", null, "more", { max: 8 })).toEqual({ value: "abcdefgh", caret: 8 });
  });
});
