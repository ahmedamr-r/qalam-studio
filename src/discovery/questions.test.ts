import { describe, expect, it } from "vitest";
import { decodeSource, encodeSource } from "../../server/org/codecs";
import { OTHER, answerWords, initialFlow, type FlowState } from "@/ui/ai/questionFlow";
import type { PlanQuestion } from "@/ai/plan";
import { toQuestion, type PlanBucket } from "@/ui/ai/plan";
import { OPEN_ID, answered, answersRecord, openQuestion, type CardAnswers } from "./questions";

const segment: PlanQuestion = {
  id: "who",
  title: "Which riders run into it most?",
  why: "It picks who the solutions are for",
  multi: false,
  options: [
    { value: "first-time", label: "First-time riders", description: "They don't know the pickup spots yet" },
    { value: "airport", label: "Riders picked up at airports", description: "Terminals confuse the pin" },
  ],
  recommended: ["airport"],
  allowOther: true,
};

const round = (qs: PlanQuestion[]): PlanBucket => ({ questions: qs, form: initialFlow(qs.map(toQuestion), false) });
const answer = (form: FlowState, id: string, a: FlowState["answers"][string]): FlowState => ({ ...form, answers: { ...form.answers, [id]: a }, submitted: true });

describe("the questions before a card's draft", () => {
  it("start with the person's own words where nothing backs the card: an open question they can skip", () => {
    expect(openQuestion("opportunity")).toMatchObject({ id: OPEN_ID, title: "What do you know about it?", options: [] });
    expect(openQuestion("outcome").why).toContain("What moves it");
  });

  it("take the person's words as theirs: what they typed, else the choices they picked, never Qalam AI's descriptions or its picks", () => {
    let open = round([openQuestion("opportunity")]);
    open = { ...open, form: answer(open.form, OPEN_ID, { kind: "text", text: "  The pin lands on the wrong terminal  " }) };
    let follow = round([segment]);
    follow = { ...follow, form: answer(follow.form, "who", { kind: "single", value: "airport" }) };
    expect(answered([open, follow])).toEqual([
      { questionId: OPEN_ID, question: "What do you know about it?", words: "The pin lands on the wrong terminal" },
      { questionId: "who", question: "Which riders run into it most?", words: "Riders picked up at airports" },
    ]);
    // Their own answer to a choice; nothing for a skipped one, nor for Qalam AI's pick they agreed to.
    const own = round([segment]);
    expect(answered([{ ...own, form: answer(own.form, "who", { kind: "single", value: OTHER, other: "Night riders" }) }])[0].words).toBe("Night riders");
    expect(answered([{ ...own, form: answer(own.form, "who", { kind: "skipped" }) }])).toEqual([]);
    expect(answered([{ ...own, form: answer(own.form, "who", { kind: "single", value: "airport", pick: true }) }])).toEqual([]);
    expect(answerWords({ id: "x", kind: "multi", title: "", groups: [{ id: "g", label: "", options: segment.options }] }, { kind: "multi", values: ["first-time"], custom: ["drivers' friends"] }).text).toBe("First-time riders; drivers' friends");
  });

  it("keep the answers as a source of the person's own words, one quote per answer where it sits in the text, kept through its file", () => {
    let open = round([openQuestion("opportunity")]);
    open = { ...open, form: answer(open.form, OPEN_ID, { kind: "text", text: "Riders call support from the airport" }) };
    let follow = round([segment]);
    follow = { ...follow, form: answer(follow.form, "who", { kind: "single", value: "airport" }) };
    const card: CardAnswers = { v: 1, card: "n1", goal: "g1", topic: null, step: "draft-solutions", buckets: [open, follow], found: ["hub:quote:a"], at: 5 };
    const s = answersRecord({ id: "ans1", board: "b1", title: "Your answers: Riders can't find the pickup", product: "rides", card, role: "evidence", now: 5, quoteId: (q) => `ans1-${q}` });
    expect(s.kind).toBe("dump");
    expect(s.quotes.map((q) => [q.id, q.text, s.text.slice(q.span[0], q.span[1]), q.role ?? null])).toEqual([
      ["ans1-know", "Riders call support from the airport", "Riders call support from the airport", "evidence"],
      ["ans1-who", "Riders picked up at airports", "Riders picked up at airports", null],
    ]);
    const { md, data } = encodeSource(s);
    expect(decodeSource(md, data)?.answers).toEqual(card);
  });
});
