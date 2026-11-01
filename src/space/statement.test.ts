import { describe, expect, it } from "vitest";
import { sanitizeStatement, statementMaterial } from "./statement";

describe("their words as a proper goal or problem", () => {
  const m = statementMaterial({ what: "goal", said: "I want to increase the number of used cooking oil collected from customers by 20%", org: "Tagaddod", about: "Collects used cooking oil from households and restaurants in Egypt.", market: "Tagaddod's competitors: Delta Oil.", above: null });

  it("tells the call what it's to be, their words and the company", () => {
    expect(m.text).toContain("as a goal: an outcome the team is trying to move");
    expect(m.text).toContain("Their words: “I want to increase the number of used cooking oil collected from customers by 20%”");
    expect(m.text).toContain("Tagaddod's competitors: Delta Oil.");
  });

  it("keeps a statement whose numbers are theirs and whose names are theirs or the company's", () => {
    expect(sanitizeStatement({ statement: "Households and restaurants hand over 20% more used oil to Tagaddod", why: "A change you could see move." }, m)).toEqual({ statement: "Households and restaurants hand over 20% more used oil to Tagaddod", why: "A change you could see move." });
    // A number they never wrote, a name nobody gave, one too long, or their own words back: theirs stand.
    expect(sanitizeStatement({ statement: "Collect 30% more used oil", why: "" }, m)).toBeNull();
    expect(sanitizeStatement({ statement: "Households in Alexandria hand over more used oil", why: "" }, m)).toBeNull();
    expect(sanitizeStatement({ statement: "x".repeat(141), why: "" }, m)).toBeNull();
    expect(sanitizeStatement({ statement: m.said, why: "" }, m)).toBeNull();
  });
});
