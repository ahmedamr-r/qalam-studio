import { describe, expect, it } from "vitest";
import { MAX_GAP, findQuote, findVerbatim, foldChar, mentions, normalizeForMatch, numbersIn, quoteFinder, verbatim } from "./quotes";
import foldCases from "./__fixtures__/fold-cases.json";

describe("findVerbatim", () => {
  const text = "People say they can’t find what they ordered last time.\n\nWe’ve talked about an “order again” shelf — maybe.";

  it("finds a quote whatever its quotes, dashes, case and spacing", () => {
    expect(verbatim(text, "they can't find what they ordered")).toBe("they can’t find what they ordered");
    expect(verbatim(text, '"Order Again" shelf - maybe')).toBe("“order again” shelf — maybe");
    expect(verbatim(text, "last time.  We've talked")).toBe("last time.\n\nWe’ve talked");
  });

  it("drops the marks models wrap quotes in", () => {
    expect(verbatim(text, "“…they can't find what they ordered…”")).toBe("they can’t find what they ordered");
    // The comma or full stop written inside the closing mark isn't the source's.
    expect(verbatim(text, "what they ordered last,")).toBe("what they ordered last");
    expect(verbatim(text, "“order again” shelf.")).toBe("“order again” shelf");
    expect(findVerbatim(text, "what they ordered first,")).toBeNull();
  });

  it("finds nothing that isn't there, and nothing too short to mean anything", () => {
    expect(findVerbatim(text, "they can't find their past orders")).toBeNull();
    expect(findVerbatim(text, "they")).toBeNull();
  });

  it("maps back to the original text across Arabic and wide characters", () => {
    const ar = "العملاء يقولون إن التوصيل بطيء جداً 🚚 في المساء";
    expect(verbatim(ar, "التوصيل بطيء جداً 🚚")).toBe("التوصيل بطيء جداً 🚚");
    const r = findVerbatim(ar, "بطيء جداً 🚚 في المساء")!;
    expect(ar.slice(r[0], r[1])).toBe("بطيء جداً 🚚 في المساء");
  });

  describe("a quote that leaves words out (…)", () => {
    const notes = "P3: Honestly I never know when the driver will turn up. Sometimes it's an hour late, sometimes early, and I'm in a meeting. So I just stopped ordering for lunch.";

    it("finds each part, in order, and keeps the source's words for each", () => {
      const m = findQuote(notes, "I never know when the driver will turn up … So I just stopped ordering for lunch")!;
      expect(m.parts).toHaveLength(2);
      expect(m.parts.map(([a, b]) => notes.slice(a, b))).toEqual(["I never know when the driver will turn up", "So I just stopped ordering for lunch"]);
      expect(m.words).toBe("I never know when the driver will turn up … So I just stopped ordering for lunch");
      expect(m.span).toEqual([m.parts[0][0], m.parts[1][1]]);
      expect(verbatim(notes, "“I never know when the driver will turn up...so I just stopped ordering for lunch”")).toBe(m.words);
      expect(verbatim(notes, "I never know when the driver [...] stopped ordering for lunch")).toBe("I never know when the driver … stopped ordering for lunch");
    });

    it("refuses parts out of order, parts that aren't there, and parts too short to mean anything", () => {
      expect(findQuote(notes, "So I just stopped ordering for lunch … I never know when the driver will turn up")).toBeNull();
      expect(findQuote(notes, "I never know when the driver will turn up … so I switched to another app")).toBeNull();
      expect(findQuote(notes, "I never know when the driver will turn up … and")).toBeNull();
    });

    it("keeps an ellipsis the source wrote itself", () => {
      const said = "It's fine… I guess. The app just feels slow on my phone.";
      expect(findQuote(said, "It's fine... I guess")?.parts).toHaveLength(1);
    });

    it("refuses parts too far apart, and tries a later first part when an earlier one is too far", () => {
      const far = `I want it faster. ${"Filler that has nothing to do with it. ".repeat(30)}Delivery fees are too high for me.`;
      expect(findQuote(far, "I want it faster … Delivery fees are too high")).toBeNull();
      const twice = `I want it faster. ${"Filler that has nothing to do with it. ".repeat(30)}I want it faster, really. Delivery fees are too high for me.`;
      const m = findQuote(twice, "I want it faster … Delivery fees are too high")!;
      expect(m.parts[0][0]).toBeGreaterThan(MAX_GAP);
      expect(twice.slice(m.parts[1][0], m.parts[1][1])).toBe("Delivery fees are too high");
    });

    it("picks the later of two near matches for a middle part when the earlier one leaves too big a gap", () => {
      const text = `alpha bravo charlie. delta echo. ${"x".repeat(300)} delta echo again. ${"y".repeat(300)} foxtrot golf hotel.`;
      const m = findQuote(text, "alpha bravo charlie … delta echo … foxtrot golf hotel")!;
      expect(m.parts).toHaveLength(3);
      expect(text.slice(m.parts[1][0], m.parts[1][0] + 16)).toBe("delta echo again");
    });

    it("finds many quotes in one text with one finder", () => {
      const find = quoteFinder(notes);
      expect(find("sometimes early, and I'm in a meeting")?.words).toBe("sometimes early, and I'm in a meeting");
      expect(find("P3", 2)?.words).toBe("P3");
      expect(find("P3")).toBeNull();
    });
  });

  it("normalizes runs of space to one, with a map back to the original", () => {
    const { norm, map } = normalizeForMatch("A  b\n c");
    expect(norm).toBe("a b c");
    expect(map).toEqual([0, 1, 3, 4, 6]);
  });
});

describe("Arabic spelled either way", () => {
  it.each(foldCases.cases)("$why", ({ in: input, out }) => {
    expect(normalizeForMatch(input).norm).toBe(out);
  });

  it("maps every folded character back to where it came from", () => {
    const text = "مُشْكِلَةٌ ‏٣٠ دقيقة";
    const { norm, map } = normalizeForMatch(text);
    expect(map).toHaveLength(norm.length);
    expect([...map].sort((a, b) => a - b)).toEqual(map);
    expect(map.every((i) => i >= 0 && i < text.length)).toBe(true);
  });

  it("finds a quote the model re-spelled, and keeps the source's own spelling", () => {
    const said = "S2: والله التوصيل بيتأخر ساعة كاملة، ومفيش حد بيرد على الشكوى.";
    expect(verbatim(said, "التوصيل بيتاخر ساعه كامله، ومفيش حد بيرد علي الشكوي")).toBe("التوصيل بيتأخر ساعة كاملة، ومفيش حد بيرد على الشكوى");
    expect(verbatim(said, "التوصيل بيتأخر ساعة كاملة؛ ومفيش حد")).toBeNull();
  });

  it("finds a plain quote in voweled text, and keeps the vowels on its last letter", () => {
    const quran = "قالَ إِنَّ الخِدْمَةَ بَطِيئَةٌ جِدًّا";
    const r = findVerbatim(quran, "ان الخدمة بطيئة جدا")!;
    expect(quran.slice(r[0], r[1])).toBe("إِنَّ الخِدْمَةَ بَطِيئَةٌ جِدًّا");
  });

  it("matches Arabic-Indic numbers to the digits a model writes", () => {
    expect(verbatim("بستنى ٤٥ دقيقة كل مرة", "بستنى 45 دقيقة")).toBe("بستنى ٤٥ دقيقة");
  });

  it("folds one code point at a time", () => {
    expect(foldChar(0x064e)).toBe("");
    expect(foldChar(0x0623)).toBe("ا");
    expect(foldChar(0x0663)).toBe("3");
    expect(foldChar("a".codePointAt(0)!)).toBe("a");
  });
});

describe("numbersIn", () => {
  it("reads decimals, thousands, percentages and k/m", () => {
    expect(numbersIn("Weekly reorders: 1.2 now, 1.5 by March")).toEqual([1.2, 1.5]);
    expect(numbersIn("1,200 users and 20% churn, 3.5k orders, 2m GMV")).toEqual([1200, 20, 3500, 2_000_000]);
    expect(mentions("from 1,2 to 1,5", 1.5)).toBe(true);
    expect(mentions("from 1.2 to 1.5", 2)).toBe(false);
  });
});
