import { describe, expect, it } from "vitest";
import { OTHER, REVIEW, addCustom, answerOf, initialFlow, optionAt, position, reduceFlow, setGroup, summarize, validate, type Answers, type FlowAction, type FlowState, type Question } from "./questionFlow";

/** Q2 only when Q1 isn't "a"; Q3 optional. */
function questions(answers: Answers): Question[] {
  const q1: Question = { id: "q1", kind: "single", title: "One", recommended: "b", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], other: { label: "Other…" } };
  const v = answerOf(q1, answers);
  const qs: Question[] = [q1];
  if (v.kind === "single" && v.value !== "a")
    qs.push({
      id: "q2",
      kind: "multi",
      title: "Two",
      dependsOn: ["q1"],
      min: 1,
      default: { values: v.value === "b" ? ["x"] : ["x", "y"] },
      groups: [
        { id: "g1", label: "G1", options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }] },
        { id: "g2", label: "G2", options: [{ value: "z", label: "Z" }], max: 2, custom: { placeholder: "" } },
      ],
    });
  qs.push({ id: "q3", kind: "single", title: "Three", optional: true, options: [{ value: "p", label: "P" }, { value: "q", label: "Q" }] });
  return qs;
}

function run(actions: FlowAction[], s?: FlowState) {
  let state = s ?? initialFlow(questions({}));
  let last: ReturnType<typeof reduceFlow> = { state };
  for (const a of actions) {
    last = reduceFlow(state, a, questions(state.answers));
    state = last.state;
  }
  return last;
}

describe("questionnaire flow", () => {
  it("starts on the first question with the recommendation picked", () => {
    const s = initialFlow(questions({}));
    expect(s.current).toBe("q1");
    expect(answerOf(questions({})[0], s.answers)).toEqual({ kind: "single", value: "b" });
    expect(position(s, questions({}))).toEqual({ index: 1, total: 4 });
  });

  it("moves on, keeping what was shown as the answer", () => {
    const r = run([{ type: "next" }]);
    expect(r.state.current).toBe("q2");
    expect(r.state.answers.q1).toEqual({ kind: "single", value: "b" });
    expect(run([{ type: "next" }, { type: "back" }]).state.current).toBe("q1");
  });

  it("skips a question that isn't asked any more", () => {
    const r = run([{ type: "answer", id: "q1", answer: { kind: "single", value: "a" } }, { type: "next" }]);
    expect(r.state.current).toBe("q3");
    expect(position(r.state, questions(r.state.answers))).toEqual({ index: 2, total: 3 });
  });

  it("blocks Next until the step is answered", () => {
    const r = run([{ type: "next" }, { type: "answer", id: "q2", answer: { kind: "multi", values: [], custom: [] } }, { type: "next" }]);
    expect(r.error).toBe("Pick at least one.");
    expect(r.state.current).toBe("q2");
    const other = run([{ type: "answer", id: "q1", answer: { kind: "single", value: OTHER, other: " " } }, { type: "next" }]);
    expect(other.error).toBe("Type your answer.");
  });

  it("lets only optional questions be skipped", () => {
    expect(run([{ type: "skip" }]).state.current).toBe("q1");
    const r = run([{ type: "next" }, { type: "next" }, { type: "skip" }]);
    expect(r.state.current).toBe(REVIEW);
    expect(r.state.answers.q3).toEqual({ kind: "skipped" });
    expect(summarize(questions({})[2], r.state.answers.q3)).toBe("Skipped");
  });

  it("clears answers that depended on a changed one", () => {
    let r = run([{ type: "next" }, { type: "answer", id: "q2", answer: { kind: "multi", values: ["y"], custom: [] } }, { type: "next" }]);
    expect(r.state.answers.q2).toBeDefined();
    r = run([{ type: "back" }, { type: "back" }, { type: "answer", id: "q1", answer: { kind: "single", value: OTHER, other: "c" } }], r.state);
    expect(r.state.answers.q2).toBeUndefined();
    expect(answerOf(questions(r.state.answers)[1], r.state.answers)).toEqual({ kind: "multi", values: ["x", "y"], custom: [] });
    // Choosing the answer that was already shown changes nothing.
    const same = run([{ type: "next" }, { type: "answer", id: "q2", answer: { kind: "multi", values: ["y"], custom: [] } }, { type: "back" }, { type: "answer", id: "q1", answer: { kind: "single", value: "b" } }]);
    expect(same.state.answers.q2).toEqual({ kind: "multi", values: ["y"], custom: [] });
  });

  it("returns to the review after an edit, visiting a question that just appeared first", () => {
    let r = run([{ type: "answer", id: "q1", answer: { kind: "single", value: "a" } }, { type: "next" }, { type: "next" }]);
    expect(r.state.current).toBe(REVIEW);
    r = run([{ type: "edit", id: "q1" }, { type: "answer", id: "q1", answer: { kind: "single", value: "b" } }, { type: "next" }], r.state);
    expect(r.state.current).toBe("q2");
    r = run([{ type: "next" }], r.state);
    expect(r.state.current).toBe(REVIEW);
    r = run([{ type: "edit", id: "q3" }, { type: "next" }], r.state);
    expect(r.state.current).toBe(REVIEW);
  });

  it("submits every answer, defaults filled in", () => {
    const r = run([{ type: "next" }, { type: "next" }, { type: "next" }, { type: "submit" }]);
    expect(r.done).toBe(true);
    expect(r.state.submitted).toBe(true);
    expect(r.state.answers).toEqual({ q1: { kind: "single", value: "b" }, q2: { kind: "multi", values: ["x"], custom: [] }, q3: { kind: "single", value: "" } });
    expect(run([{ type: "next" }], r.state).state).toBe(r.state);
    expect(run([{ type: "reopen" }], r.state).state).toMatchObject({ submitted: false, current: REVIEW });
  });

  it("sends the designer to the first unanswered question on submit", () => {
    const r = run([{ type: "next" }, { type: "answer", id: "q2", answer: { kind: "multi", values: [], custom: [] } }, { type: "submit" }]);
    expect(r.done).toBeUndefined();
    expect(r.state.current).toBe("q2");
  });

  it("counts custom names against the group's limit", () => {
    const q2 = questions({})[1];
    if (q2.kind !== "multi") throw new Error();
    let a = { kind: "multi" as const, values: ["z"], custom: [] as string[] };
    a = addCustom(addCustom(addCustom(a, " Balance  card "), "balance card"), "Hero");
    expect(a.custom).toEqual(["Balance card", "Hero"]);
    expect(validate(q2, a)).toBe("Up to 2 in “G2”.");
    expect(setGroup({ kind: "multi", values: [], custom: ["Hero"] }, q2.groups[1], true).values).toEqual(["z"]);
    expect(setGroup(a, q2.groups[0], true).values).toEqual(["z", "x", "y"]);
    expect(setGroup(a, q2.groups[1], false)).toEqual({ kind: "multi", values: [], custom: [] });
    expect(summarize(q2, { kind: "multi", values: ["x", "y", "z"], custom: ["A", "B"] })).toBe("X, Y, Z, A +1 more");
  });

  it("maps number keys to options, then Other", () => {
    const q1 = questions({})[0];
    expect([1, 2, 3, 4].map((n) => optionAt(q1, n))).toEqual(["a", "b", OTHER, null]);
    expect(optionAt(questions({})[1], 1)).toBeNull();
  });
});
