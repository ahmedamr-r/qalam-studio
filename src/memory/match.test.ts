import { describe, expect, it } from "vitest";
import { matchQuestions, questionKey } from "./match";

describe("whether two questions ask the same thing", () => {
  it("finds the bench's repeats across flows", () => {
    expect(matchQuestions("What is net revenue retention today?", "What is net revenue retention today?")).toBe("exact");
    expect(matchQuestions("What is net revenue retention today?", "What's your net revenue retention now?")).toBe("exact");
    expect(matchQuestions("What does the 9% of ARR stand for?", "What does the 9% of ARR measure?")).toBe("near");
    expect(matchQuestions("What share of accounts use the payments add-on?", "What share of agencies have the payments add-on turned on?")).toBe("near");
    expect(matchQuestions("How long does a first-time parent take from basket to order today?", "How long do first-time parents take from basket to order now?")).toBe("exact");
  });

  it("keeps apart what only shares its frame: a current and a target, two numbers, two subjects", () => {
    expect(matchQuestions("What is the current number of weekly active ordering households?", "What is the target number of weekly active ordering households?")).toBe(null);
    expect(matchQuestions("Why did the 31% drop?", "Why did the 38% drop?")).toBe(null);
    // Near only shows what was said beside it, never drops it: these share their subject, and the earlier answer helps.
    expect(matchQuestions("What do agencies say about payments?", "Why don't agencies turn on payments?")).toBe("near");
    expect(matchQuestions("Who is it for first?", "Who pays for it?")).toBe(null);
    expect(matchQuestions("What have you tried?", "What would you try first?")).toBe(null);
  });

  it("keeps numbers whole, and reads Arabic written loosely", () => {
    expect([...questionKey("Is it 9% or 4.1% of ARR?")]).toEqual(["9%", "4.1%", "arr"]);
    expect(matchQuestions("ما أكثر أسباب فشل التسليم؟", "ما اكثر اسباب فشل التسليم عندكم الآن؟")).toBe("exact");
    expect(matchQuestions("كم شحنة في الشهر في الرياض؟", "كم شحنة في الشهر في جدة؟")).toBe(null);
  });

  it("reads the project's avoided words as its terms", () => {
    const fold = (s: string) => s.replace(/\bcart\b/gi, "basket");
    expect(matchQuestions("Why do parents abandon the cart?", "Why do parents abandon the basket?", fold)).toBe("exact");
  });
});
