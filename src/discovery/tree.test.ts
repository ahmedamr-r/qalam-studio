import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerDocPass, studio, useStudio } from "@/doc/store";
import { emptyDoc, type FrameNode, type TextProps } from "@/doc/schema";
import { setTextMeasurer } from "@/doc/measure";
import { makeFrame, makeText } from "@/doc/factory";
import { worldBounds } from "@/doc/geometry";
import { ostPass } from "./pass";
import { addCardIn, deleteKeepIn, dropProblem, makeCardNode, moveCardsIn, newCard, reorderCardIn, setTargetIn, updateCardIn } from "./ops";
import { neighbor } from "./navigate";
import { evidenceLabel, isAIIdea, isAssumed, tierOf } from "./evidence";
import { CARD_WIDTH, defaultChildKind } from "./kinds";
import { GAPS } from "./layout";
import { CARD, cardBox } from "./metrics";
import type { OstKind } from "./types";

let off: () => void;
beforeAll(() => {
  off = registerDocPass(ostPass);
  // Lines wrap at the width given: 7px per character.
  setTextMeasurer((t: TextProps, w: number | null) => {
    const width = t.content.length * 7;
    const lines = w ? Math.max(1, Math.ceil(width / w)) : 1;
    return { w: w ? Math.min(w, width) : width, h: lines * t.lineHeight };
  });
});
afterAll(() => off());
beforeEach(() => useStudio.setState({ doc: emptyDoc(), past: [], future: [], txBase: null, selection: [] }));

const doc = () => studio().doc;
const node = (id: string) => doc().nodes[id] as FrameNode;

/** A card on the board (root) or under `parent`. */
function add(kind: OstKind, parent: string | null = null, title: string = kind, at = { x: 100, y: 100 }) {
  const n = makeCardNode(newCard(kind, { title }), at);
  studio().mutate((d) => addCardIn(d, n, parent));
  return n.id;
}

describe("the layout pass", () => {
  it("hangs new cards a level below their parent, side by side", () => {
    const o = add("outcome");
    const a = add("opportunity", o);
    const b = add("opportunity", o);
    const root = node(o);
    expect(node(a).y).toBe(root.h + GAPS.tb.levelGap);
    expect(node(b).y).toBe(node(a).y);
    expect(node(b).x - (node(a).x + node(a).w)).toBe(GAPS.tb.siblingGap);
    // Centred under the outcome.
    expect(node(a).x + node(b).x + node(b).w).toBeCloseTo(root.w);
    expect(node(a).w).toBe(CARD_WIDTH.opportunity);
  });

  it("moves a tree with its root and lays nothing out again", () => {
    const o = add("outcome");
    const a = add("opportunity", o);
    const before = node(a);
    studio().mutate((d) => {
      d.nodes[o].x += 200;
    });
    expect(node(a)).toBe(before);
    expect(worldBounds(doc(), a).x).toBe(worldBounds(doc(), o).x + before.x);
  });

  it("grows a card with its title and shifts its neighbours", () => {
    const o = add("outcome");
    const a = add("opportunity", o, "Short");
    const b = add("opportunity", o, "Short");
    const h0 = node(a).h;
    studio().mutate((d) => updateCardIn(d, a, (c) => void (c.title = "A much longer description of what customers struggle with every single week")));
    expect(node(a).h).toBeGreaterThan(h0);
    expect(node(a).name).toBe(node(a).meta.ost!.title);
    expect(node(b).y).toBe(node(a).y);
  });

  it("hides a folded branch and shows it again", () => {
    const o = add("outcome");
    const a = add("opportunity", o);
    const s = add("solution", a);
    const t = add("test", s);
    studio().mutate((d) => updateCardIn(d, a, (c) => void (c.collapsed = true)));
    expect(node(s).visible).toBe(false);
    expect(node(t).visible).toBe(false);
    expect(node(a).visible).toBe(true);
    studio().mutate((d) => updateCardIn(d, a, (c) => void delete c.collapsed));
    expect(node(s).visible).toBe(true);
    expect(node(t).visible).toBe(true);
  });

  it("puts layers dropped into a card back on the board, and cards pasted into a frame become a branch", () => {
    const o = add("outcome");
    const sticky = makeText({ x: 20, y: 30, text: { content: "note" } });
    studio().mutate((d) => {
      d.nodes[sticky.id] = sticky;
      sticky.parentId = o;
      d.nodes[o].children.push(sticky.id);
    });
    expect(node(o).children).not.toContain(sticky.id);
    expect(doc().nodes[sticky.id].parentId).toBeNull();
    expect(doc().nodes[sticky.id].x).toBe(120);

    const frame = makeFrame({ x: 600, y: 0, w: 200, h: 200 });
    const stray = makeCardNode(newCard("opportunity", { title: "Stray" }), { x: 10, y: 10 });
    studio().mutate((d) => {
      d.nodes[frame.id] = frame;
      d.roots.push(frame.id);
      addCardIn(d, stray, frame.id);
    });
    expect(doc().nodes[stray.id].parentId).toBeNull();
    expect(doc().roots).toContain(stray.id);
  });

  it("is one undo step with the edit it follows", () => {
    const o = add("outcome");
    add("opportunity", o);
    const steps = studio().past.length;
    add("opportunity", o);
    expect(studio().past.length).toBe(steps + 1);
    studio().undo();
    expect(node(o).children).toHaveLength(1);
  });

  it("keeps a card's paints off whatever gets applied to it", () => {
    const o = add("outcome");
    studio().mutate((d) => {
      d.nodes[o].fill = { color: "#ff0000" };
      d.nodes[o].rotation = 30;
    });
    expect(node(o).fill).toBeNull();
    expect(node(o).rotation).toBe(0);
  });
});

describe("editing the tree", () => {
  it("only lets each kind hold what it can", () => {
    const o = add("outcome");
    const a = add("opportunity", o);
    const s = add("solution", a);
    const loose = add("solution", null, "Loose", { x: 900, y: 0 });
    expect(dropProblem(doc(), [loose], o)).toBe("Outcome cards hold opportunities");
    expect(dropProblem(doc(), [loose], a)).toBeNull();
    const need = add("opportunity", null, "Loose need", { x: 900, y: 400 });
    expect(dropProblem(doc(), [need], s)).toBe("Solution cards hold tests");
    expect(dropProblem(doc(), [o], a)).toBe("A card can't go inside itself");
    const other = add("outcome", null, "Other", { x: 0, y: 900 });
    expect(dropProblem(doc(), [other], a)).toBe("Opportunity cards hold opportunities and solutions");
    expect(dropProblem(doc(), [a], a)).toBe("A card can't go inside itself");
  });

  it("moves and reorders cards", () => {
    const o = add("outcome");
    const a = add("opportunity", o, "A");
    const b = add("opportunity", o, "B");
    const s = add("solution", a);
    studio().mutate((d) => void moveCardsIn(d, [s], b, 0));
    expect(node(b).children).toEqual([s]);
    studio().mutate((d) => void reorderCardIn(d, b, -1));
    expect(node(o).children).toEqual([b, a]);
  });

  it("deletes a card but keeps its children where they fit", () => {
    const o = add("outcome");
    const a = add("opportunity", o, "A");
    const a1 = add("opportunity", a, "A1");
    const s = add("solution", a, "S");
    studio().mutate((d) => deleteKeepIn(d, a));
    expect(doc().nodes[a]).toBeUndefined();
    // The sub-opportunity moves up under the outcome; a solution can't, so it stays on the board as a branch.
    expect(node(o).children).toEqual([a1]);
    expect(doc().nodes[s].parentId).toBeNull();
  });

  it("keeps one target per tree", () => {
    const o = add("outcome");
    const a = add("opportunity", o, "A");
    const b = add("opportunity", o, "B");
    studio().mutate((d) => void setTargetIn(d, a));
    let was: string | null = null;
    studio().mutate((d) => void (was = setTargetIn(d, b)));
    expect(was).toBe("A");
    expect(node(a).meta.ost!.stage).toBe("exploring");
    expect(node(b).meta.ost!.stage).toBe("target");
  });

  it("picks a new child's kind from what the parent is and holds", () => {
    expect(defaultChildKind(newCard("outcome"), [])).toBe("opportunity");
    expect(defaultChildKind(newCard("opportunity"), [])).toBe("opportunity");
    expect(defaultChildKind(newCard("opportunity", { stage: "target" }), [])).toBe("solution");
    expect(defaultChildKind(newCard("opportunity"), ["solution"])).toBe("solution");
    expect(defaultChildKind(newCard("solution"), [])).toBe("test");
    expect(defaultChildKind(newCard("test"), [])).toBeNull();
  });
});

describe("arrow keys", () => {
  it("walk up, down and across the levels", () => {
    const o = add("outcome");
    const a = add("opportunity", o, "A");
    const b = add("opportunity", o, "B");
    const c = add("opportunity", o, "C");
    const b1 = add("solution", b, "B1");
    const a1 = add("solution", a, "A1");
    expect(neighbor(doc(), b, "up")).toBe(o);
    expect(neighbor(doc(), o, "down")).toBe(b);
    expect(neighbor(doc(), b, "left")).toBe(a);
    expect(neighbor(doc(), b, "right")).toBe(c);
    expect(neighbor(doc(), c, "right")).toBeNull();
    // Across parents on the same level.
    expect(neighbor(doc(), b1, "left")).toBe(a1);
  });

  it("turn with a left-to-right tree", () => {
    const o = add("outcome");
    studio().mutate((d) => updateCardIn(d, o, (c) => void (c.orientation = "lr")));
    const a = add("opportunity", o, "A");
    const b = add("opportunity", o, "B");
    expect(neighbor(doc(), a, "left")).toBe(o);
    expect(neighbor(doc(), a, "down")).toBe(b);
    expect(node(b).y).toBeGreaterThan(node(a).y);
  });
});

describe("evidence", () => {
  const at = 1;
  it("marks AI-drafted opportunities with nothing behind them as Assumed", () => {
    const drafted = newCard("opportunity", { createdBy: "ai" });
    expect(isAssumed(drafted)).toBe(true);
    expect(evidenceLabel(drafted)).toBe("Assumed · needs evidence");
    const backed = newCard("opportunity", { createdBy: "ai", evidence: [{ id: "e", kind: "answer", text: "can't find past orders", answerId: "pains", addedBy: "ai", at }] });
    expect(isAssumed(backed)).toBe(false);
    expect(tierOf(backed)).toBe("answers");
    expect(evidenceLabel(backed)).toBe("From your answers");
    expect(isAssumed(newCard("opportunity"))).toBe(false);
    expect(evidenceLabel(newCard("opportunity"))).toBe("No evidence yet");
  });

  it("labels Qalam AI's own solution ideas", () => {
    expect(isAIIdea(newCard("solution", { createdBy: "ai" }))).toBe(true);
    expect(isAIIdea(newCard("solution", { createdBy: "ai", evidence: [{ id: "e", kind: "answer", text: "an order again shelf", addedBy: "ai", at }] }))).toBe(false);
  });
});


describe("card footers", () => {
  it("wrap chips that don't fit beside each other, inside the card, and the card grows to hold them", () => {
    const card = newCard("solution", {
      title: "Order again shelf",
      evidence: [{ id: "e", kind: "note", text: "Asked for it twice", addedBy: "user", at: 1 }],
      assumptions: [1, 2, 3].map((i) => ({ id: `a${i}`, category: "desirability" as const, text: "x", addedBy: "ai" as const })),
      designs: [{ projectId: "p", at: 1 }],
    });
    const box = cardBox(card);
    expect(box.chips.map((c) => c.text)).toEqual(["Your note", "3 assumptions", "1 design"]);
    for (const c of box.chips) expect(c.x + c.w).toBeLessThanOrEqual(box.w - CARD.pad * 2);
    expect(box.chips.map((c) => c.y)).toEqual([0, 0, CARD.chip + CARD.chipRowGap]);
    expect(box.h).toBe(box.footerY! + CARD.chip * 2 + CARD.chipRowGap + CARD.pad);
    // Two that fit share a row.
    const short = cardBox({ ...card, assumptions: [] });
    expect(short.chips.map((c) => c.y)).toEqual([0, 0]);
    expect(short.h).toBe(box.h - CARD.chip - CARD.chipRowGap);
  });
});
