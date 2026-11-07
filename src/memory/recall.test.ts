import { describe, expect, it } from "vitest";
import { askedId } from "./fold";
import { pickAnswers, recallBlock, RECALL_LIMITS, type RecallSubject } from "./recall";
import type { AskedEntry } from "./types";

const DAY = 86_400_000;
const now = 100 * DAY;
const me = "u1";
const entry = (x: Partial<AskedEntry> & { qid: string }): AskedEntry => ({ v: 1, id: askedId(x.flow ?? "find", x.key ?? "t1", x.qid), at: now - DAY, by: { id: me }, flow: "find", key: "t1", about: { product: null }, q: `Question ${x.qid}?`, how: "own", a: "An answer", ...x });
const subject = (x: Partial<RecallSubject> = {}): RecallSubject => ({ flow: "focus", key: "t9", about: { product: null, goal: "g1" }, words: "Grow net revenue retention through payments", ...x });

describe("what recall picks", () => {
  it("leaves out the conversation the turn is in, another product's answers, and what was left", () => {
    const picked = pickAnswers(
      [
        entry({ qid: "same", flow: "focus", key: "t9", about: { product: null, goal: "g1" } }),
        entry({ qid: "other", about: { product: "p2", goal: "g1" } }),
        entry({ qid: "left", how: "left", about: { product: null, goal: "g1" } }),
        entry({ qid: "kept", about: { product: null, goal: "g1" } }),
      ],
      subject({ about: { product: "p1", goal: "g1" } }),
      { me, now },
    );
    expect(picked.map((p) => p.e.qid)).toEqual(["kept"]);
  });

  it("puts the same subject first, then what shares its words, then their own lately in this space", () => {
    const picked = pickAnswers(
      [
        entry({ qid: "recent", q: "Who is on the team?", a: "Four engineers" }),
        entry({ qid: "words", q: "What is net revenue retention today?", a: "About 104%", about: { product: null } }),
        entry({ qid: "subject", about: { product: null, goal: "g1" } }),
        entry({ qid: "old", q: "Who is on the team?", a: "Three", at: now - 30 * DAY }),
        entry({ qid: "theirs", q: "Who pays?", a: "Agencies", by: { id: "u2", name: "Omar" } }),
      ],
      subject(),
      { me, now },
    );
    expect(picked.map((p) => [p.e.qid, p.why])).toEqual([
      ["subject", "subject"],
      ["words", "words"],
      ["recent", "recent"],
    ]);
  });

  it("keeps to its room", () => {
    const many = Array.from({ length: 30 }, (_, i) => entry({ qid: `q${i}`, about: { product: null, goal: "g1" } }));
    expect(pickAnswers(many, subject(), { me, now })).toHaveLength(RECALL_LIMITS.said);
  });
});

describe("the block a turn reads", () => {
  it("says whose each answer is, a pick as agreement and a don't-know as that, with ids it can rest on", () => {
    const r = recallBlock({
      answers: [
        { e: entry({ qid: "nrr", q: "What is net revenue retention today?", a: "About 104%" }), why: "words" },
        { e: entry({ qid: "who", q: "Who is it for?", a: "Agencies", how: "pick", by: { id: "u2", name: "Omar" } }), why: "subject" },
        { e: entry({ qid: "fail", q: "What's the failure rate?", a: "", how: "unknown" }), why: "subject" },
        { e: entry({ qid: "anon", q: "How many seats?", a: "Ten", by: { id: "u3" } }), why: "words" },
      ],
      material: [{ text: "Picked a delivery slot · 44% lost", from: "funnel.csv", whose: "measured" }],
      pages: [{ text: "Parents can't find a slot that fits", from: "Delivery slots" }],
      decisions: [{ at: now, what: "Chose agencies first", why: "They pay" }],
      me,
      solo: false,
      now,
    });
    expect(r.block).toContain("- m1 · Help me find one, 1970-04-10 · What is net revenue retention today? → they said “About 104%”");
    expect(r.block).toContain("Omar agreed to your recommendation “Agencies” (agreement, not their words)");
    expect(r.block).toContain("they said they don't know");
    expect(r.block).toContain("a teammate said “Ten”");
    expect(r.block).toContain("measured · funnel.csv · “Picked a delivery slot · 44% lost”");
    expect(r.block).toContain("Delivery slots · “Parents can't find a slot that fits”");
    expect(r.block).toContain("Chose agencies first · why: They pay");
    expect(r.ids).toEqual(["m1", "m2", "m3", "m4", "m5", "m6", "m7"]);
    // A pick is never words to hold a settled point to.
    expect(r.hay).toContain("About 104%");
    expect(r.hay).not.toContain("Agencies");
    // On a solo project there are no teammates.
    const solo = recallBlock({ answers: [{ e: entry({ qid: "x", a: "Ten", by: { id: "u3", name: "Omar" } }), why: "words" }], material: [], pages: [], decisions: [], me, solo: true, now });
    expect(solo.block).toContain("they said “Ten”");
  });

  it("doesn't repeat what the turn holds already, and is nothing when nothing's known", () => {
    const r = recallBlock({
      answers: [{ e: entry({ qid: "nrr", a: "About 104% net revenue retention" }), why: "words" }, { e: entry({ qid: "yes", a: "Yes" }), why: "words" }],
      material: [{ text: "Picked a delivery slot · 44% lost", from: "funnel.csv" }],
      pages: [],
      decisions: [],
      me,
      solo: false,
      now,
      sent: "Their answers: About 104% net revenue retention. The funnel: Picked a delivery slot · 44% lost.",
    });
    expect(r.ids).toEqual(["m1"]);
    expect(r.block).toContain("“Yes”");
    expect(recallBlock({ answers: [], material: [], pages: [], decisions: [], me, solo: false, now })).toEqual({ block: "", hay: "", ids: [], items: [] });
  });
});
