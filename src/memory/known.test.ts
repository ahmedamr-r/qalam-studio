import { describe, expect, it } from "vitest";
import { answerWords, knownAnswer, type Question } from "@/ui/ai/questionFlow";
import { askedId } from "./fold";
import { knownFor, knownLine } from "./known";
import type { RecallSubject } from "./recall";
import type { AskedEntry } from "./types";

const DAY = 86_400_000;
const now = 50 * DAY;
const entry = (x: Partial<AskedEntry> & { qid: string; q: string }): AskedEntry => ({ v: 1, id: askedId(x.flow ?? "find", x.key ?? "t1", x.qid), at: now - DAY, by: { id: "u1" }, flow: "find", key: "t1", about: { product: null }, how: "own", a: "About 104%", ...x });
const subject = (x: Partial<RecallSubject> = {}): RecallSubject => ({ flow: "focus", key: "t9", about: { product: null, goal: "g1" }, words: "", ...x });
const nrr = { id: "q1", title: "What is net revenue retention today?" };

describe("what was said before, under a question", () => {
  it("finds the same question asked in another conversation, exact before near, newest first", () => {
    const k = knownFor(
      [nrr, { id: "q2", title: "Who pays first?" }],
      [entry({ qid: "a", q: "What is your net revenue retention now?", a: "About 104%" }), entry({ qid: "b", q: "What net revenue retention do you see today, roughly?", a: "Near 104", at: now - 2 * DAY })],
      subject(),
      { me: "u1", solo: false },
    );
    expect(k.get("q1")?.map((x) => [x.text, x.match])).toEqual([
      ["About 104%", "exact"],
      ["Near 104", "near"],
    ]);
    expect(k.has("q2")).toBe(false);
  });

  it("keeps to the subject's scope: never this conversation, another product's, another card's, or a teammate's don't-know", () => {
    const same = (x: Partial<AskedEntry>) => entry({ qid: Math.random().toString(36).slice(2), q: nrr.title, ...x });
    const k = knownFor(
      [nrr],
      [
        same({ flow: "focus", key: "t9", a: "this conversation" }),
        same({ about: { product: "p2" }, a: "another product" }),
        same({ about: { product: null, card: "c7" }, a: "another card" }),
        same({ how: "unknown", a: "", by: { id: "u2", name: "Omar" } }),
        same({ how: "left", a: "" }),
        same({ about: { product: null, goal: "g1" }, a: "this goal" }),
        same({ about: { product: null }, a: "the whole project" }),
      ],
      subject({ about: { product: "p1", goal: "g1" } }),
      { me: "u1", solo: false },
    );
    expect(k.get("q1")?.map((x) => x.text).sort()).toEqual(["the whole project", "this goal"]);
  });

  it("says whose, where and when, in words", () => {
    const [mine] = knownFor([nrr], [entry({ qid: "a", q: nrr.title })], subject(), { me: "u1", solo: false }).get("q1")!;
    expect(knownLine(mine, now)).toEqual({ who: "You", said: "said “About 104%”", where: "Help me find one, yesterday" });
    const [omar] = knownFor([nrr], [entry({ qid: "a", q: nrr.title, how: "pick", a: "Agencies", by: { id: "u2", name: "Omar" } })], subject(), { me: "u1", solo: false }).get("q1")!;
    expect(knownLine(omar, now).who).toBe("Omar");
    expect(knownLine(omar, now).said).toBe("took Qalam AI's pick “Agencies”");
    // On a solo project there are no teammates.
    const [solo] = knownFor([nrr], [entry({ qid: "a", q: nrr.title, by: { id: "u2", name: "Omar" } })], subject(), { me: "u1", solo: true }).get("q1")!;
    expect(knownLine(solo, now).who).toBe("You");
  });

  it("puts what was said in the answer: the choice it names, else their words, and a pick stays a pick", () => {
    const own = (text: string) => ({ text, how: "own" as const });
    const pick = (text: string) => ({ text, how: "pick" as const });
    const single: Question = { kind: "single", id: "s", title: "Who first?", options: [{ value: "a", label: "Agencies" }, { value: "b", label: "Freelancers" }], other: { label: "Something else…" } };
    expect(knownAnswer(single, own("Agencies"))).toEqual({ kind: "single", value: "a" });
    expect(knownAnswer(single, own("Small agencies in Dubai"))).toMatchObject({ kind: "single", other: "Small agencies in Dubai" });
    expect(knownAnswer({ ...single, other: undefined }, own("Small agencies in Dubai"))).toBeNull();
    // Qalam AI's pick only as this question's own option, marked as its pick: never as their words.
    expect(knownAnswer(single, pick("Agencies"))).toEqual({ kind: "single", value: "a", pick: true });
    expect(knownAnswer(single, pick("Small agencies in Dubai"))).toBeNull();
    expect(knownAnswer({ kind: "text", id: "t", title: "What?" }, pick("Agencies"))).toBeNull();
    const multi: Question = { kind: "multi", id: "m", title: "Which?", groups: [{ id: "g", label: "", options: [{ value: "x", label: "Email" }], custom: { placeholder: "" } }] };
    expect(knownAnswer(multi, own("Email; Fax"))).toEqual({ kind: "multi", values: ["x"], custom: ["Fax"] });
    expect(knownAnswer(multi, pick("Email"))).toEqual({ kind: "multi", values: ["x"], custom: [], pick: true });
    expect(knownAnswer(multi, pick("Email; Fax"))).toBeNull();
    expect(knownAnswer({ kind: "text", id: "t", title: "What?" }, own("About 104%"))).toEqual({ kind: "text", text: "About 104%" });
    expect(knownAnswer({ kind: "text", id: "t", title: "What?" }, { text: "", how: "unknown" })).toBeNull();
    // As it's read back: the pick is Qalam AI's, their words are theirs.
    expect(answerWords(single, knownAnswer(single, pick("Agencies"))!).how).toBe("pick");
    expect(answerWords({ kind: "text", id: "t", title: "What?" }, knownAnswer({ kind: "text", id: "t", title: "What?" }, own("About 104%"))!)).toEqual({ text: "About 104%", typed: "About 104%", how: "own" });
  });
});
