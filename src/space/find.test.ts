import { describe, expect, it } from "vitest";
import { findRound, findText } from "./find";

describe("Help me find one", () => {
  it("opens with code's own questions, open and skippable, about what's looked for", () => {
    for (const what of ["goal", "problem"] as const) {
      const qs = findRound(what);
      expect(qs.length).toBe(3);
      for (const q of qs) expect(q).toMatchObject({ options: [], multi: false });
    }
    expect(findRound("goal").map((q) => q.id)).toEqual(["for-whom", "change", "number"]);
    expect(findRound("problem").map((q) => q.id)).toEqual(["who", "struggle", "give-up"]);
  });

  it("reads only their answers as the dump, the questions beside it", () => {
    const qs = findRound("problem");
    const r = findText(qs, { who: "  Riders in New Cairo compounds ", struggle: "", "give-up": "At the gate, when the driver can't find them." });
    expect(r.text).toBe("Riders in New Cairo compounds\n\nAt the gate, when the driver can't find them.");
    expect(r.asked).toEqual(qs.map((q) => q.title));
    expect(r.said.map((s) => s.answer)).toEqual(["Riders in New Cairo compounds", "At the gate, when the driver can't find them."]);
    expect(r.text).not.toContain(qs[0].title);
  });
});
