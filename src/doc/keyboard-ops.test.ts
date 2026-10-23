import { beforeEach, describe, expect, it } from "vitest";
import { studio, useStudio } from "./store";
import { emptyDoc, type Doc, type SceneNode, type TextNode } from "./schema";
import { makeFrame, makeShape, makeText } from "./factory";
import { childrenOf, frameStep, inverseOf, parentsOf, readingOrder, siblingStep } from "./select";
import { reorderList } from "./ops";
import { removeFill, removeStroke, resizeBy, swapFillStroke, toggleLocked, toggleVisible } from "./layer-ops";
import { alignText, stepText, stepWeight, toggleBold } from "./text-ops";
import { distributeNodes } from "./align";
import { makeLine } from "./vector-shapes";
import { copySelection, cutSelection, pasteClipboard, pasteToReplace } from "./clipboard";

/** A screen holding three rectangles side by side (a, b, c) and a top-level rectangle beside it. */
function scene() {
  const f = makeFrame({ name: "Screen", x: 0, y: 0, w: 400, h: 800 });
  const kids = ["a", "b", "c"].map((name, i) => makeShape("rect", { name, x: 10 + i * 50, y: 10, w: 20, h: 20, parentId: f.id }));
  f.children = kids.map((k) => k.id);
  const loose = makeShape("rect", { name: "loose", x: 500, y: 0 });
  const doc: Doc = emptyDoc();
  for (const n of [f, ...kids, loose] as SceneNode[]) doc.nodes[n.id] = n;
  doc.roots = [f.id, loose.id];
  useStudio.setState({ doc, past: [], future: [], txBase: null, selection: [] });
  const [a, b, c] = kids.map((k) => k.id);
  return { f: f.id, a, b, c, loose: loose.id };
}

const node = (id: string) => studio().doc.nodes[id];

describe("keyboard selection", () => {
  let ids: ReturnType<typeof scene>;
  beforeEach(() => (ids = scene()));

  it("selects parents (⇧↵) and children (↵)", () => {
    const { doc } = studio();
    expect(parentsOf(doc, [ids.a, ids.b])).toEqual([ids.f]);
    expect(parentsOf(doc, [ids.loose])).toEqual([ids.loose]);
    expect(childrenOf(doc, [ids.f])).toEqual([ids.a, ids.b, ids.c]);
  });

  it("steps through siblings in layer-panel order and wraps (⇥ / ⇧⇥)", () => {
    const { doc } = studio();
    // The panel lists the last child first, so "next" goes down the list: c → b → a → c.
    expect(siblingStep(doc, [ids.c], 1)).toEqual([ids.b]);
    expect(siblingStep(doc, [ids.a], 1)).toEqual([ids.c]);
    expect(siblingStep(doc, [ids.a], -1)).toEqual([ids.b]);
    expect(siblingStep(doc, [], 1)).toEqual([ids.loose]);
  });

  it("inverts the selection among its siblings (⇧⌘A)", () => {
    expect(inverseOf(studio().doc, [ids.b])).toEqual([ids.a, ids.c]);
  });

  it("orders screens by rows, then left to right (N / ⇧N)", () => {
    const doc = studio().doc;
    const extra = [makeFrame({ x: 450, y: 30, w: 390, h: 844 }), makeFrame({ x: 0, y: 1000, w: 390, h: 844 })];
    for (const f of extra) doc.nodes[f.id] = f;
    const order = readingOrder(doc, [extra[1].id, extra[0].id, ids.f]);
    expect(order).toEqual([ids.f, extra[0].id, extra[1].id]);
    doc.roots.push(...extra.map((f) => f.id));
    expect(frameStep(doc, [ids.b], 1)).toBe(extra[0].id);
    expect(frameStep(doc, [ids.f], -1)).toBe(extra[1].id);
  });
});

describe("layer order", () => {
  const set = (...ids: string[]) => new Set(ids);
  it("moves a selection one step without leapfrogging", () => {
    expect(reorderList(["a", "b", "c", "d"], set("a", "b"), "forward")).toEqual(["c", "a", "b", "d"]);
    expect(reorderList(["a", "b", "c", "d"], set("c", "d"), "forward")).toEqual(["a", "b", "c", "d"]);
    expect(reorderList(["a", "b", "c", "d"], set("b", "d"), "backward")).toEqual(["b", "a", "d", "c"]);
    expect(reorderList(["a", "b", "c", "d"], set("a", "c"), "front")).toEqual(["b", "d", "a", "c"]);
    expect(reorderList(["a", "b", "c", "d"], set("b", "d"), "back")).toEqual(["b", "d", "a", "c"]);
  });
});

describe("layer edits", () => {
  let ids: ReturnType<typeof scene>;
  beforeEach(() => (ids = scene()));

  it("hides, then shows (⇧⌘H); locks and lets go, then unlocks (⇧⌘L)", () => {
    expect(toggleVisible([ids.a, ids.b])).toBe(false);
    expect(node(ids.a).visible).toBe(false);
    expect(toggleVisible([ids.a, ids.b])).toBe(true);
    studio().select([ids.a]);
    expect(toggleLocked([ids.a])).toBe(true);
    expect(studio().selection).toEqual([]);
    expect(toggleLocked([ids.a])).toBe(false);
  });

  it("removes fills and strokes, and swaps them", () => {
    studio().mutate((d) => void (d.nodes[ids.a].stroke = { color: "#ff0000", width: 2 }));
    const fill = node(ids.a).fill!;
    expect(swapFillStroke([ids.a])).toBe(1);
    expect(node(ids.a).fill).toEqual({ color: "#ff0000" });
    expect(node(ids.a).stroke).toEqual({ ...fill, width: 2 });
    expect(removeStroke([ids.a])).toBe(1);
    expect(removeFill([ids.a, ids.b])).toBe(2);
    expect(node(ids.b).fill).toBeNull();
  });

  it("resizes with ⌘ arrows, never below 1px", () => {
    resizeBy([ids.a], 10, 0);
    expect(node(ids.a).w).toBe(30);
    resizeBy([ids.a], 0, -50);
    expect(node(ids.a).h).toBe(1);
  });

  it("keeps a line's zero axis, and the other axis as it was, when resizing with ⌘ arrows", () => {
    const line = makeLine({ x: 0, y: 0 }, { x: 100, y: 0 });
    studio().mutate((d) => {
      d.nodes[line.id] = line;
      d.roots.push(line.id);
    });
    resizeBy([line.id], 0, 10);
    expect([node(line.id).w, node(line.id).h]).toEqual([100, 0]);
    resizeBy([line.id], 10, 10);
    expect([node(line.id).w, node(line.id).h]).toEqual([110, 0]);
    studio().mutate((d) => void (d.nodes[ids.a].h = 20.5));
    resizeBy([ids.a], 10, 0);
    expect(node(ids.a).h).toBe(20.5);
  });

  it("distributes horizontal spacing between the outermost layers", () => {
    studio().mutate((d) => void (d.nodes[ids.b].x = 25));
    distributeNodes([ids.a, ids.b, ids.c], "h");
    // a spans 10–30, c spans 110–130: b (20 wide) lands in the middle with 30px gaps.
    expect(node(ids.b).x).toBe(60);
  });
});

describe("text shortcuts", () => {
  let t: string;
  beforeEach(() => {
    scene();
    const n = makeText({ text: { content: "Hello", fontSize: 16, lineHeight: 24, fontWeight: 400, typeToken: "type.body" } });
    studio().mutate((d) => {
      d.nodes[n.id] = n;
      d.roots.push(n.id);
    });
    t = n.id;
  });
  const text = () => (node(t) as TextNode).text;

  it("toggles bold and detaches the type style", () => {
    expect(toggleBold([t])).toBe(true);
    expect(text().fontWeight).toBe(700);
    expect(text().typeToken).toBeUndefined();
    toggleBold([t]);
    expect(text().fontWeight).toBe(400);
  });

  it("steps size (keeping the line-height ratio), weight, line height and letter spacing", () => {
    stepText([t], "size", 1);
    expect([text().fontSize, text().lineHeight]).toEqual([17, 26]);
    expect(stepWeight(400, 1)).toBe(500);
    expect(stepWeight(700, 1)).toBe(700);
    expect(stepWeight(500, -1)).toBe(400);
    stepText([t], "line-height", -1);
    expect(text().lineHeight).toBe(25);
    stepText([t], "letter-spacing", 1);
    expect(text().letterSpacing).toBeCloseTo(0.1);
  });

  it("maps physical alignment onto logical start/end by direction", () => {
    alignText([t], "right", () => "ltr");
    expect(text().align).toBe("end");
    alignText([t], "right", () => "rtl");
    expect(text().align).toBe("start");
    alignText([t], "center", () => "rtl");
    expect(text().align).toBe("center");
  });
});

describe("clipboard", () => {
  let ids: ReturnType<typeof scene>;
  beforeEach(() => (ids = scene()));

  it("cuts in one undo step", () => {
    studio().select([ids.a]);
    const before = studio().past.length;
    expect(cutSelection()).toBe(1);
    expect(node(ids.a)).toBeUndefined();
    expect(studio().past.length).toBe(before + 1);
    pasteClipboard();
    expect(studio().doc.nodes[ids.f].children).toHaveLength(3);
  });

  it("pastes over the selection: same parent, just above it, at its position (⇧⌘V)", () => {
    studio().select([ids.loose]);
    copySelection();
    studio().select([ids.b]);
    pasteClipboard({ over: true });
    const kids = studio().doc.nodes[ids.f].children;
    const pasted = node(kids[2]);
    expect(kids.indexOf(ids.b)).toBe(1);
    expect([pasted.name, pasted.x, pasted.y]).toEqual(["loose", node(ids.b).x, node(ids.b).y]);
  });

  it("replaces each selected layer with the clipboard, centred where it was (⇧⌘R)", () => {
    studio().select([ids.loose]);
    copySelection();
    studio().select([ids.a, ids.c]);
    expect(pasteToReplace()).toBe(2);
    const kids = studio().doc.nodes[ids.f].children.map((id) => node(id));
    expect(kids.map((n) => n.name)).toEqual(["loose", "b", "loose"]);
    // a was 20×20 at (10,10): the 100×100 copy is centred on it.
    expect([kids[0].x, kids[0].y]).toEqual([-30, -30]);
    expect(studio().selection).toHaveLength(2);
  });
});
