import { describe, expect, it } from "vitest";
import { ROLE_RULES, isQuestion, proposeRoles } from "./speakers";
import type { SpeakerStats } from "./transcript";

describe("isQuestion", () => {
  it.each([
    ["en", "Can you tell me how you shop?"],
    ["en, no mark", "Walk me through the last time you ordered"],
    ["en, wh-word", "Why does that matter to you"],
    ["en, how much", "And how much do you spend a week"],
    ["en, one word", "Why"],
    ["MSA", "هل تستخدم التطبيق كل يوم"],
    ["MSA, ما + pronoun", "ما هي أكبر مشكلة تواجهك"],
    ["Egyptian, closing word", "طب وإنت بتطلب إزاي"],
    ["Egyptian, mark", "آخر مرة حصل كده كانت إمتى؟"],
    ["Gulf", "شلون تطلب أغراضك"],
    ["Gulf, closing word", "تطلب من وين"],
    ["Levantine", "قديش بتصرفي بالأسبوع"],
    ["Levantine, و stuck on", "وليش بزعجك هالشي"],
  ])("asks: %s", (_, text) => expect(isQuestion(text)).toBe(true));

  it.each([
    ["en statement", "I order on Thursday night from my phone."],
    ["en, wh-word mid-sentence", "I never know when the driver will turn up."],
    ["en, wh-word opening a clause", "Substitutions. When something is out of stock they swap it."],
    ["en, 'why' answering", "Why, because then I can plan."],
    ["من means from", "بطلب من الموبايل كل أسبوع"],
    ["ما means not", "ما بياكلوا غير نوع واحد"],
    ["ايه means yes in the Levant", "إيه، بطلب كل يوم"],
  ])("doesn't ask: %s", (_, text) => expect(isQuestion(text)).toBe(false));
});

const stats = (s: Partial<SpeakerStats>): SpeakerStats => ({ talkSec: 0, talkShare: 0, turns: 0, questions: 0, questionShare: 0, meanTurnSec: 0, firstAt: 0, words: 0, ...s });

describe("proposeRoles", () => {
  it("is clear about someone who asks most questions and talks least", () => {
    const p = proposeRoles([
      { id: "a", label: "S1", stats: stats({ questions: 6, questionShare: 1, talkShare: 0.22, firstAt: 1 }) },
      { id: "b", label: "S2", stats: stats({ questions: 0, talkShare: 0.78, firstAt: 6 }) },
    ]);
    expect(p).toEqual({ interviewer: "a", confidence: "clear", reasons: ["asks 100% of the questions", "talks 22% of the time", "speaks first"] });
  });

  it("proposes but isn't sure when the asker also talks most, or asks too few", () => {
    const talky = proposeRoles([
      { id: "a", label: "S1", stats: stats({ questions: 5, questionShare: 0.8, talkShare: 0.6 }) },
      { id: "b", label: "S2", stats: stats({ questions: 1, questionShare: 0.2, talkShare: 0.4, firstAt: 2 }) },
    ]);
    expect(talky).toMatchObject({ interviewer: "a", confidence: "unsure" });
    const few = proposeRoles([
      { id: "a", label: "S1", stats: stats({ questions: ROLE_RULES.minQuestions - 1, questionShare: 1, talkShare: 0.2 }) },
      { id: "b", label: "S2", stats: stats({ talkShare: 0.8, firstAt: 2 }) },
    ]);
    expect(few.confidence).toBe("unsure");
  });

  it("falls back to whoever speaks first when no one asks anything code can tell", () => {
    const p = proposeRoles([
      { id: "a", label: "S1", stats: stats({ talkShare: 0.5, firstAt: 4 }) },
      { id: "b", label: "S2", stats: stats({ talkShare: 0.5, firstAt: 1 }) },
    ]);
    expect(p).toEqual({ interviewer: "b", confidence: "unsure", reasons: ["no one asks a question code can tell", "speaks first"] });
  });

  it("proposes no one with one speaker", () => {
    expect(proposeRoles([{ id: "a", label: "S1", stats: stats({}) }])).toEqual({ confidence: "unsure", reasons: ["only one person speaks"] });
  });
});
