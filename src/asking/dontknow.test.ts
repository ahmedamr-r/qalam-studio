import { describe, expect, it } from "vitest";
import { saysDontKnow } from "./dontknow";

describe("an answer that says they don't know", () => {
  it("hears every way the bench's people say it, in English and Arabic", () => {
    for (const said of [
      "no idea",
      "honestly I'm not sure, I'd have to dig that up",
      "don't have that, and I doubt it matters",
      "ما أدري",
      "I don't know yet, I've only been here two weeks",
      "don't have that",
      "not sure",
      "don't know",
      "no idea, that's why I'm here",
      "don't know and it doesn't matter, mine is different",
      "I wouldn't know about that",
      "no idea, not my area",
    ])
      expect(saysDontKnow(said), said).toBe(true);
  });

  it("hears it in the other ways people put it", () => {
    for (const said of [
      "I have no idea",
      "We don't track that",
      "We haven't measured it",
      "We haven't asked",
      "Not really sure",
      "dunno",
      "Hmm, no clue",
      "We don't know yet",
      "مش عارف",
      "معرفش والله",
      "ما بعرف",
      "لا أعرف",
      "ما عندي فكرة",
      "ليس لدينا بيانات",
      "مدري",
    ])
      expect(saysDontKnow(said), said).toBe(true);
  });

  it("leaves an answer as their words when it says something: a figure, a guess, or what there is", () => {
    for (const said of [
      "Nothing on this yet.",
      "None",
      "None of these",
      "Maybe 9% of ARR",
      "Actually I said 6% but it might be closer to 9%, I'd have to check.",
      "Not yet",
      "No offer",
      "I don't know exactly, maybe around half",
      "Not sure, probably the delivery slot",
      "I think it's the slot, but I don't know",
      "يمكن النص تقريبا",
      "Parents of under-5s, mostly first-order customers from paid social.",
      "",
      "We don't know yet because nobody has looked at the support tickets from the last two quarters and the export tool has been broken since the spring, so nobody can tell",
    ])
      expect(saysDontKnow(said), said).toBe(false);
  });
});
