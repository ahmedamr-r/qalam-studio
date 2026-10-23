import { describe, expect, it } from "vitest";
import { appendAnswer, applyTurn, briefForRequest, emptyBrief, isCovered, MAX_ANSWERS, normalizeBrief, screenBriefFor } from "./brief";
import { makeFrame } from "./factory";
import type { BriefAnswer, Doc, SceneNode } from "./schema";

function docOf(nodes: SceneNode[]): Doc {
  const d: Doc = { nodes: {}, roots: [] };
  for (const n of nodes) {
    d.nodes[n.id] = n;
    if (!n.parentId) d.roots.push(n.id);
  }
  return d;
}

const ans = (i: number, at = i): BriefAnswer => ({ id: `a${i}`, topic: "goal", question: `Q${i}`, answer: `A${i}`, screenIds: [], at });
const turn = (screenId: string, goal = "", firstNotice = "") => ({ summary: "", screens: [{ screenId, goal, firstNotice, primaryAction: "" }] });

describe("knowledge hub brief", () => {
  it("keeps only the latest answers", () => {
    let b = emptyBrief();
    for (let i = 0; i < MAX_ANSWERS + 5; i++) b = appendAnswer(b, ans(i));
    expect(b.answers).toHaveLength(MAX_ANSWERS);
    expect(b.answers[0].id).toBe("a5");
  });

  it("never blanks a known field and ignores screens outside the session", () => {
    const f = makeFrame({ name: "Tracking" });
    const other = makeFrame({ name: "Checkout" });
    const doc = docOf([f, other]);
    let b = applyTurn(undefined, turn(f.id, "Know when food arrives"), [{ id: f.id, name: f.name }], doc, 1);
    b = applyTurn(b, { summary: "", screens: [{ screenId: f.id, goal: "", firstNotice: "ETA", primaryAction: "" }, { screenId: other.id, goal: "Pay", firstNotice: "", primaryAction: "" }] }, [{ id: f.id, name: f.name }], doc, 2);
    expect(b.screens[f.id]).toMatchObject({ goal: "Know when food arrives", firstNotice: "ETA" });
    expect(b.screens[other.id]).toBeUndefined();
    expect(isCovered(b.screens[f.id])).toBe(true);
  });

  it("records a verdict with the screen's key issues", () => {
    const f = makeFrame({ name: "Tracking" });
    const doc = docOf([f]);
    const b = applyTurn(undefined, { ...turn(f.id), verdict: { verdict: "partially", headline: "ETA is buried", issuesByScreen: { [f.id]: ["a", "b", "c", "d", "e", "f"] } } }, [{ id: f.id, name: f.name }], doc, 5);
    expect(b.screens[f.id].lastCritique).toMatchObject({ at: 5, verdict: "partially", headline: "ETA is buried" });
    expect(b.screens[f.id].lastCritique!.keyIssues).toHaveLength(5);
  });

  it("lets a duplicated screen inherit its original's entry by name", () => {
    const f = makeFrame({ name: "Tracking" });
    const copy = makeFrame({ name: "Tracking" });
    const doc = docOf([f, copy]);
    const b = applyTurn(undefined, turn(f.id, "Know when food arrives", "ETA"), [{ id: f.id, name: f.name }], doc, 1);
    const inherited = screenBriefFor(b, doc, copy.id);
    expect(inherited).toMatchObject({ goal: "Know when food arrives", inheritedFrom: "Tracking" });
    // The first turn on the copy starts from the inherited answers.
    const b2 = applyTurn(b, { summary: "", screens: [] }, [{ id: copy.id, name: copy.name }], doc, 2);
    expect(b2.screens[copy.id].goal).toBe("Know when food arrives");
  });

  it("leaves out answers from the current session and stays bounded", () => {
    const f = makeFrame({ name: "Tracking" });
    const doc = docOf([f]);
    let b = emptyBrief();
    for (let i = 0; i < 40; i++) b = appendAnswer(b, ans(i, i < 35 ? 100 : 200));
    const p = briefForRequest(b, doc, [f.id], 150);
    expect(p.answers).toHaveLength(30);
    expect(p.answers.every((a) => Number(a.answer.slice(1)) < 35)).toBe(true);
  });

  it("rejects garbage when loading", () => {
    expect(normalizeBrief(null)).toBeUndefined();
    expect(normalizeBrief("x")).toBeUndefined();
    const b = normalizeBrief({ summary: 3, answers: [{ answer: "" }, { answer: "Riders in a hurry", topic: "nope" }], screens: { s1: { goal: "Pay", lastCritique: { at: 1, verdict: "??" } }, s2: 7 } })!;
    expect(b.summary).toBe("");
    expect(b.answers).toEqual([expect.objectContaining({ answer: "Riders in a hurry", topic: "other" })]);
    expect(b.screens.s1).toMatchObject({ goal: "Pay", lastCritique: { verdict: "unknown", keyIssues: [] } });
    expect(b.screens.s2).toBeUndefined();
  });
});
