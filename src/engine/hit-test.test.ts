import { beforeEach, describe, expect, it } from "vitest";
import { makeFrame } from "@/doc/factory";
import { makeLine } from "@/doc/vector-shapes";
import { release, reserve, useReservations } from "@/doc/reservations";
import { emptyDoc, type Doc, type SceneNode } from "@/doc/schema";
import { makeCardNode, newCard } from "@/discovery/ops";
import { makeSticky } from "@/discovery/sticky";
import { deepestFrame, hitPath, pickTarget } from "./hit-test";

describe("hitPath", () => {
  beforeEach(() => useReservations.setState({ list: [] }));

  it("goes through layers AI is working on, to what's behind them", () => {
    const back = makeFrame({ name: "Back", x: 0, y: 0, w: 400, h: 400 });
    const screen = makeFrame({ name: "Screen", x: 50, y: 50, w: 200, h: 200 });
    const card = makeFrame({ name: "Card", x: 10, y: 10, w: 100, h: 100 });
    card.parentId = screen.id;
    screen.children.push(card.id);
    const doc: Doc = { ...emptyDoc(), nodes: { [back.id]: back, [screen.id]: screen, [card.id]: card }, roots: [back.id, screen.id] };
    const at = { x: 80, y: 80 };
    expect(hitPath(doc, at)).toEqual([screen.id, card.id]);
    const hold = reserve("Reviewing", [], [screen.id]);
    expect(hitPath(doc, at)).toEqual([back.id]);
    release(hold);
    expect(hitPath(doc, at)).toEqual([screen.id, card.id]);
  });

  it("hits a line by its geometry, within the tolerance it's given", () => {
    const screen = makeFrame({ name: "Screen", x: 0, y: 0, w: 400, h: 400, clip: true });
    const line = makeLine({ x: 50, y: 100 }, { x: 250, y: 100 });
    const diag = makeLine({ x: 50, y: 200 }, { x: 150, y: 300 });
    for (const n of [line, diag]) {
      n.parentId = screen.id;
      screen.children.push(n.id);
    }
    const doc: Doc = { ...emptyDoc(), nodes: { [screen.id]: screen, [line.id]: line, [diag.id]: diag }, roots: [screen.id] };
    expect(hitPath(doc, { x: 150, y: 103 }, undefined, { tol: 4 })).toEqual([screen.id, line.id]);
    expect(hitPath(doc, { x: 150, y: 103 })).toEqual([screen.id]);
    // The empty corner of the diagonal's box goes to the frame behind it.
    expect(hitPath(doc, { x: 140, y: 210 }, undefined, { tol: 4 })).toEqual([screen.id]);
    expect(hitPath(doc, { x: 100, y: 251 }, undefined, { tol: 4 })).toEqual([screen.id, diag.id]);
  });
});

describe("Discovery boards", () => {
  /** An outcome with an opportunity under it, and a solution under that (positions relative). */
  function tree() {
    const outcome = makeCardNode(newCard("outcome", { title: "Weekly reorders" }), { x: 0, y: 0 });
    const opp = makeCardNode(newCard("opportunity", { title: "I can't find what I bought last time" }), { x: 36, y: 136 });
    const sol = makeCardNode(newCard("solution", { title: "Order again shelf" }), { x: 8, y: 136 });
    opp.parentId = outcome.id;
    outcome.children.push(opp.id);
    sol.parentId = opp.id;
    opp.children.push(sol.id);
    const { frame: sticky, text } = makeSticky({ x: 600, y: 100 });
    const screen = makeFrame({ name: "Screen", x: 900, y: 0, w: 390, h: 844 });
    const nodes: Record<string, SceneNode> = {};
    for (const n of [outcome, opp, sol, sticky, text, screen]) nodes[n.id] = n;
    const doc: Doc = { ...emptyDoc(), nodes, roots: [outcome.id, sticky.id, screen.id] };
    return { doc, outcome: outcome.id, opp: opp.id, sol: sol.id, sticky: sticky.id, text: text.id, screen: screen.id };
  }

  it("picks the card under the pointer as itself, however deep in its tree", () => {
    const t = tree();
    expect(pickTarget(t.doc, [t.outcome], [], false)).toBe(t.outcome);
    expect(pickTarget(t.doc, [t.outcome, t.opp], [], false)).toBe(t.opp);
    expect(pickTarget(t.doc, [t.outcome, t.opp, t.sol], [], false)).toBe(t.sol);
    // Not the frame-context rule (a selected sibling's parent): still the card under the pointer.
    expect(pickTarget(t.doc, [t.outcome, t.opp], [t.sol], false)).toBe(t.opp);
    expect(hitPath(t.doc, { x: 60, y: 300 })).toEqual([t.outcome, t.opp, t.sol]);
  });

  it("selects a sticky note as one item until it's entered", () => {
    const t = tree();
    expect(pickTarget(t.doc, [t.sticky, t.text], [], false)).toBe(t.sticky);
    expect(pickTarget(t.doc, [t.sticky, t.text], [], true)).toBe(t.text);
  });

  it("never drops new layers into cards or stickies", () => {
    const t = tree();
    expect(deepestFrame(t.doc, [t.outcome, t.opp])).toBeNull();
    expect(deepestFrame(t.doc, [t.sticky, t.text])).toBeNull();
    expect(deepestFrame(t.doc, [t.screen])).toBe(t.screen);
  });
});
