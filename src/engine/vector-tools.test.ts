import { beforeEach, describe, expect, it } from "vitest";
import { studio, useStudio, type Tool } from "@/doc/store";
import { makeFrame } from "@/doc/factory";
import { apply, localMatrix } from "@/doc/geometry";
import { emptyDoc, type PathNode } from "@/doc/schema";
import { type PointerInfo, VectorTools } from "./vector-tools";

// Screen = world (zoom 1, camera at 0, 0).
const host = { toWorld: (p: { x: number; y: number }) => p, camera: () => ({ x: 0, y: 0, zoom: 1 }), viewport: () => ({ w: 1000, h: 800 }), render: () => {} };
const at = (x: number, y: number, mods: Partial<PointerInfo> = {}): PointerInfo => ({ screen: { x, y }, world: { x, y }, button: 0, shift: false, alt: false, mod: false, ...mods });
const key = (k: string, extra: Partial<KeyboardEvent> = {}) => ({ key: k, code: k === " " ? "Space" : k, shiftKey: false, altKey: false, repeat: false, ...extra }) as KeyboardEvent;

function drag(t: VectorTools, tool: Tool, from: [number, number], to: [number, number], mods: Partial<PointerInfo> = {}) {
  studio().setTool(tool);
  expect(t.pointerDown(at(...from, mods))).toBe(true);
  for (let k = 1; k <= 4; k++) t.pointerMove(at(from[0] + ((to[0] - from[0]) * k) / 4, from[1] + ((to[1] - from[1]) * k) / 4, mods));
  t.pointerUp(at(...to, mods));
  return studio().doc.nodes[studio().selection[0]] as PathNode;
}

describe("VectorTools: line, arrow, polygon, star", () => {
  let t: VectorTools;
  beforeEach(() => {
    useStudio.setState({ doc: emptyDoc(), past: [], future: [], txBase: null, selection: [], tool: "select" });
    t = new VectorTools(host);
  });

  it("draws a line between the drag's ends as one undo step, then returns to Move", () => {
    const n = drag(t, "line", [100, 100], [200, 200]);
    expect(n.shape).toEqual({ kind: "line" });
    expect(n.h).toBe(0);
    expect(n.rotation).toBe(45);
    const m = localMatrix(n);
    expect(apply(m, { x: 0, y: 0 }).x).toBeCloseTo(100);
    expect(apply(m, { x: n.w, y: 0 }).y).toBeCloseTo(200);
    expect(studio().past).toHaveLength(1);
    expect(studio().tool).toBe("select");
    studio().undo();
    expect(Object.keys(studio().doc.nodes)).toHaveLength(0);
  });

  it("constrains the angle with ⇧ and draws from the centre with ⌥", () => {
    const n = drag(t, "arrow", [100, 100], [300, 120], { shift: true });
    expect(n.rotation).toBe(0);
    expect(n.w).toBe(200);
    expect(n.ends?.end).toBe("arrow-lines");
    const c = drag(t, "line", [100, 300], [150, 300], { alt: true });
    expect(c.w).toBe(100);
    expect(c.x).toBe(50);
  });

  it("makes a 100 px line or a 100 × 100 shape on a click", () => {
    studio().setTool("line");
    t.pointerDown(at(10, 10));
    t.pointerUp(at(10, 10));
    expect((studio().doc.nodes[studio().selection[0]] as PathNode).w).toBe(100);
    studio().setTool("star");
    t.pointerDown(at(10, 50));
    t.pointerUp(at(10, 50));
    const s = studio().doc.nodes[studio().selection[0]] as PathNode;
    expect([s.x, s.y, s.w, s.h]).toEqual([10, 50, 100, 100]);
    expect(s.d.endsWith("Z")).toBe(true);
  });

  it("draws equal sides with ⇧ and regenerates the shape for its box", () => {
    const n = drag(t, "polygon", [0, 0], [120, 60], { shift: true });
    expect([n.w, n.h]).toEqual([120, 120]);
    expect([n.vw, n.vh]).toEqual([120, 120]);
    expect(n.vector!.paths[0].points[0]).toMatchObject({ x: 60, y: 0 });
  });

  it("cancels on Esc without a history entry, keeping the tool", () => {
    studio().setTool("polygon");
    t.pointerDown(at(0, 0));
    t.pointerMove(at(50, 50));
    expect(t.keyDown(key("Escape"))).toBe(true);
    expect(t.pointerUp(at(50, 50))).toBe(false);
    expect(Object.keys(studio().doc.nodes)).toHaveLength(0);
    expect(studio().past).toHaveLength(0);
    expect(studio().txBase).toBeNull();
    expect(studio().tool).toBe("polygon");
  });

  it("repositions the shape while Space is held", () => {
    studio().setTool("line");
    t.pointerDown(at(0, 0));
    t.pointerMove(at(100, 0));
    expect(t.keyDown(key(" "))).toBe(true);
    t.pointerMove(at(100, 50));
    t.keyUp(key(" "));
    t.pointerUp(at(100, 50));
    const n = studio().doc.nodes[studio().selection[0]] as PathNode;
    expect(apply(localMatrix(n), { x: 0, y: 0 })).toMatchObject({ x: 0, y: 50 });
    expect(n.w).toBe(100);
  });

  it("drawn inside auto layout, stays where it's drawn", () => {
    const f = makeFrame({ x: 0, y: 0, w: 400, h: 400, layout: { direction: "vertical", wrap: false, gap: 8, crossGap: 0, padding: { top: 0, end: 0, bottom: 0, start: 0 }, justify: "start", align: "start" } });
    studio().mutate((d) => {
      d.nodes[f.id] = f;
      d.roots.push(f.id);
    });
    const n = drag(t, "star", [50, 50], [150, 150]);
    expect(n.parentId).toBe(f.id);
    expect(n.absolute).toBe(true);
  });

  it("leaves other tools alone", () => {
    studio().setTool("rect");
    expect(t.pointerDown(at(0, 0))).toBe(false);
    studio().setTool("select");
    expect(t.pointerMove(at(5, 5))).toBe(false);
  });
});
