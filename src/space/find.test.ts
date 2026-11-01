import { describe, expect, it } from "vitest";
import { findQuestionsMaterial, findRound, findText, sanitizeFindQuestions } from "./find";

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

describe("Help me find one, from what's known about the domain", () => {
  const market = {
    company: [{ id: "f1", text: "Collects used cooking oil from households and restaurants in Egypt.", by: "qalam" as const, at: 1 }],
    competitors: [{ id: "c1", name: "Delta Oil", lines: [], by: "qalam" as const, at: 1 }],
    aims: [{ id: "a1", text: "Collectors track litres collected per household each month.", by: "qalam" as const, at: 1 }],
    struggles: [{ id: "s1", text: "Households find pickups hard to schedule.", by: "qalam" as const, at: 1 }],
    gone: [],
  };
  const m = findQuestionsMaterial({ what: "goal", org: "Tagaddod", about: "Collects used cooking oil.", market });

  it("tells the call the company, its competitors and its domain", () => {
    expect(m.text).toContain("a first goal: an outcome the team is trying to move");
    expect(m.text).toContain("- Collectors track litres collected per household each month.");
    expect(m.text).toContain("Its competitors: Delta Oil");
  });

  it("keeps a choice only where it's drawn from what's known, always with their own words open; asks open when too few hold", () => {
    const qs = sanitizeFindQuestions(
      {
        questions: [
          { id: "outcome", title: "Which outcome matters most now?", why: "", multi: false, allowOther: false, recommended: ["litres"], options: [{ value: "litres", label: "More litres per household", description: "Litres collected per household each month" }, { value: "pickups", label: "Easier pickups", description: "Households schedule pickups without trouble" }, { value: "revenue", label: "Grow revenue 30%", description: "Bigger margins" }] },
          { id: "who", title: "Whose is it?", why: "", multi: false, allowOther: false, recommended: [], options: [{ value: "x", label: "Hospitals", description: "Large hospitals" }, { value: "y", label: "Airlines", description: "Fuel buyers" }] },
        ],
      },
      m,
    );
    expect(qs.map((q) => [q.id, q.options.map((o) => o.value), q.allowOther])).toEqual([
      ["outcome", ["litres", "pickups"], true],
      ["who", [], false],
    ]);
    expect(qs[0].recommended).toEqual(["litres"]);
  });
});
