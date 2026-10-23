import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { studio, useStudio } from "./store";
import { ensureYoga, setAutoLayoutEnabled } from "./autolayout";
import { addAutoLayout, flowIndexAt, moveNodes, removeAutoLayout, setSizing, stepInFlow } from "./autolayout-ops";
import { setTextMeasurer } from "./measure";
import { wrappingMeasurer } from "./autolayout.fixtures";
import { makeFrame, makeShape, makeText } from "./factory";
import { insertNodes } from "./ops";
import { worldBounds } from "./geometry";
import { emptyDoc, type AutoLayout, type FrameNode, type ShapeNode } from "./schema";

const doc = () => studio().doc;
const node = (id: string) => doc().nodes[id];
const frameLayout = (id: string) => (node(id) as FrameNode).layout!;
const layout = (p: Partial<AutoLayout> = {}): AutoLayout => ({ direction: "vertical", wrap: false, gap: 0, crossGap: 0, padding: { top: 0, end: 0, bottom: 0, start: 0 }, justify: "start", align: "start", ...p });

function screen(p: Partial<FrameNode> = {}) {
  const f = makeFrame({ name: "Screen", x: 0, y: 0, w: 390, h: 600, ...p });
  insertNodes([f], null);
  return f.id;
}
function rect(parent: string, p: Partial<ShapeNode>) {
  const r = makeShape("rect", { w: 50, h: 20, ...p });
  insertNodes([r], parent);
  return r.id;
}

beforeAll(async () => {
  await ensureYoga();
  setTextMeasurer(wrappingMeasurer);
  setAutoLayoutEnabled(true);
});
beforeEach(() => useStudio.setState({ doc: emptyDoc(), past: [], future: [], txBase: null, selection: [] }));

describe("Shift+A", () => {
  it("reads direction, gap, padding and order off a frame's children", () => {
    const s = screen();
    const inner = makeFrame({ name: "Row", x: 10, y: 10, w: 250, h: 80, fill: null });
    insertNodes([inner], s);
    const c = rect(inner.id, { x: 160, y: 30 });
    const a = rect(inner.id, { x: 20, y: 30 });
    const b = rect(inner.id, { x: 90, y: 30 });
    addAutoLayout([inner.id]);
    const L = frameLayout(inner.id);
    expect([L.direction, L.gap, L.padding.start, L.padding.top, L.align]).toEqual(["horizontal", 20, 20, 30, "start"]);
    expect(node(inner.id).children).toEqual([a, b, c]);
    // Nested frames hug their content; the layers stay where they were.
    expect([node(inner.id).sizeH, node(inner.id).sizeV]).toEqual(["hug", "hug"]);
    expect([node(a).x, node(b).x, node(c).x]).toEqual([20, 90, 160]);
    expect([frameLayout(inner.id).padding.end, node(inner.id).w]).toEqual([40, 250]);
  });

  it("keeps a top-level screen's size", () => {
    const s = screen();
    rect(s, { x: 16, y: 16 });
    addAutoLayout([s]);
    expect([node(s).w, node(s).h, node(s).sizeH]).toEqual([390, 600, undefined]);
  });

  it("wraps loose layers in a hugging auto-layout frame, in one undo step", () => {
    const s = screen();
    const a = rect(s, { x: 20, y: 100 });
    const b = rect(s, { x: 20, y: 132, w: 80 });
    const past = studio().past.length;
    addAutoLayout([b, a]);
    const f = studio().selection[0];
    expect(studio().past.length).toBe(past + 1);
    expect(node(f).children).toEqual([a, b]);
    expect(frameLayout(f).gap).toBe(12);
    expect(worldBounds(doc(), a)).toMatchObject({ x: 20, y: 100 });
    expect([node(f).w, node(f).h]).toEqual([80, 52]);
  });

  it("removes auto layout without moving anything", () => {
    const s = screen({ layout: layout({ gap: 10, padding: { top: 8, end: 8, bottom: 8, start: 8 } }) });
    const a = rect(s, { sizeH: "fill" });
    const before = worldBounds(doc(), a);
    removeAutoLayout([s]);
    expect((node(s) as FrameNode).layout).toBeUndefined();
    expect(node(a).sizeH).toBe("fixed");
    expect(worldBounds(doc(), a)).toEqual(before);
  });
});

describe("sizing rules", () => {
  it("a filling child makes a hugging parent fixed", () => {
    const s = screen();
    const inner = makeFrame({ name: "Stack", fill: null, layout: layout(), sizeH: "hug", sizeV: "hug" });
    insertNodes([inner], s);
    const a = rect(inner.id, {});
    setSizing([a], "h", "fill");
    expect(node(inner.id).sizeH).toBe("fixed");
    expect(node(a).sizeH).toBe("fill");
    setSizing([inner.id], "h", "hug");
    expect(node(a).sizeH).toBe("fixed");
  });

  it("text hugging width becomes auto width", () => {
    const s = screen({ layout: layout() });
    const t = makeText({ text: { content: "Label", autoSize: "height" }, w: 200 });
    insertNodes([t], s);
    setSizing([t.id], "h", "hug");
    const n = node(t.id);
    expect(n.type === "text" && n.text.autoSize).toBe("width");
    expect(n.w).toBeLessThan(200);
  });
});

describe("moving layers", () => {
  it("drops a layer out of the flow where it was dragged to", () => {
    const s = screen({ layout: layout({ gap: 10 }) });
    const free = makeFrame({ name: "Free", x: 500, y: 0, w: 300, h: 300, fill: null });
    insertNodes([free], null);
    const a = rect(s, {});
    rect(s, {});
    const w0 = worldBounds(doc(), a);
    moveNodes([a], free.id, undefined, { x: 520, y: 40 });
    expect(node(a).parentId).toBe(free.id);
    expect(worldBounds(doc(), a)).toMatchObject({ x: w0.x + 520, y: w0.y + 40 });
    expect(node(s).children.length).toBe(1);
  });

  it("inserts into a flow at the index under the pointer (RTL rows run right to left)", () => {
    const s = screen({ dir: "rtl", layout: layout({ direction: "horizontal", gap: 10 }) });
    const a = rect(s, {});
    const b = rect(s, {});
    // a sits at the right edge; the pointer right of it means "before a".
    const slot = flowIndexAt(doc(), s, { x: 385, y: 10 })!;
    expect(slot.index).toBe(0);
    expect(flowIndexAt(doc(), s, { x: 10, y: 10 })!.index).toBe(2);
    moveNodes([b], s, 0);
    expect(node(s).children).toEqual([b, a]);
    expect(node(b).x).toBe(390 - 50);
  });

  it("arrow keys step through the flow along its axis only", () => {
    const s = screen({ layout: layout({ gap: 10 }) });
    const a = rect(s, {});
    const b = rect(s, {});
    expect(stepInFlow([a], "down")).toBe(true);
    expect(node(s).children).toEqual([b, a]);
    stepInFlow([a], "left");
    expect(node(s).children).toEqual([b, a]);
  });
});
