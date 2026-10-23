import { beforeEach, describe, expect, it } from "vitest";
import { studio, useStudio } from "@/doc/store";
import { apply, localMatrix } from "@/doc/geometry";
import { emptyDoc, type PathNode } from "@/doc/schema";
import { cubicAt, segmentCubic, vectorToD } from "@/doc/vector";
import { makeVector } from "@/doc/vector-shapes";
import { type PointerInfo, VectorTools } from "./vector-tools";
import { useVectorEdit } from "./vector-state";

const cam = { x: 0, y: 0, zoom: 1 };
const host = { toWorld: (p: { x: number; y: number }) => p, camera: () => cam, viewport: () => ({ w: 1000, h: 800 }), render: () => {} };
const at = (x: number, y: number, mods: Partial<PointerInfo> = {}): PointerInfo => ({ screen: { x, y }, world: { x, y }, button: 0, shift: false, alt: false, mod: false, ...mods });
const key = (k: string, extra: Partial<KeyboardEvent> = {}) =>
  ({ key: k, code: k.length === 1 ? `Key${k.toUpperCase()}` : k, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, repeat: false, target: null, ...extra }) as unknown as KeyboardEvent;

function drag(t: VectorTools, from: [number, number], to: [number, number], mods: Partial<PointerInfo> = {}) {
  t.pointerDown(at(...from, mods));
  for (let k = 1; k <= 4; k++) t.pointerMove(at(from[0] + ((to[0] - from[0]) * k) / 4, from[1] + ((to[1] - from[1]) * k) / 4, mods));
  t.pointerUp(at(...to, mods));
}
const node = () => Object.values(studio().doc.nodes).find((n): n is PathNode => n.type === "path")!;
const anchors = (n: PathNode, path = 0) => n.vector!.paths[path].points.map((p) => apply(localMatrix(n), p));

/** An open zig-zag 0,0 → 100,0 → 100,100 → 200,100. */
function seed() {
  const n = makeVector({ x: 0, y: 0 });
  n.vector = undefined;
  const v = {
    paths: [
      {
        points: [
          { x: 0, y: 0, mirror: "none" as const },
          { x: 100, y: 0, mirror: "none" as const },
          { x: 100, y: 100, mirror: "none" as const },
          { x: 200, y: 100, mirror: "none" as const },
        ],
        closed: false,
      },
    ],
  };
  Object.assign(n, { w: 200, h: 100, vw: 200, vh: 100 });
  n.vector = v;
  n.d = vectorToD(v);
  studio().mutate((d) => {
    d.nodes[n.id] = n;
    d.roots.push(n.id);
  });
  useStudio.setState({ past: [], selection: [n.id] });
  return n.id;
}

describe("vector edit mode", () => {
  let t: VectorTools;
  let id: string;
  beforeEach(() => {
    useVectorEdit.getState().exit();
    useStudio.setState({ doc: emptyDoc(), past: [], future: [], txBase: null, selection: [], tool: "select", camera: cam, editingTextId: null });
    t?.dispose();
    t = new VectorTools(host);
    id = seed();
  });

  it("enters on double-click on the outline and leaves on Enter, keeping the layer selected", () => {
    expect(t.doubleClick(at(50, 2))).toBe(true);
    expect(useVectorEdit.getState().nodeId).toBe(id);
    expect(t.hidesSelection()).toBe(true);
    expect(t.overlay()!.anchors).toHaveLength(4);
    expect(t.keyDown(key("Enter"))).toBe(true);
    expect(useVectorEdit.getState().nodeId).toBeNull();
    expect(studio().selection).toEqual([id]);
  });

  it("drags an anchor (one undo step) and refits the box", () => {
    useVectorEdit.getState().enter(id);
    drag(t, [200, 100], [240, 150]);
    expect(anchors(node())[3]).toEqual({ x: 240, y: 150 });
    expect([node().w, node().h]).toEqual([240, 150]);
    expect(studio().past).toHaveLength(1);
    expect(useVectorEdit.getState().points).toEqual([{ path: 0, point: 3 }]);
  });

  it("⇧-drags selected anchors together; a ⇧-click (no drag) deselects one", () => {
    useVectorEdit.getState().enter(id);
    t.pointerDown(at(200, 100));
    t.pointerUp(at(200, 100));
    t.pointerDown(at(100, 100, { shift: true }));
    t.pointerUp(at(100, 100, { shift: true }));
    expect(useVectorEdit.getState().points).toEqual([
      { path: 0, point: 3 },
      { path: 0, point: 2 },
    ]);
    drag(t, [200, 100], [230, 103], { shift: true });
    expect(useVectorEdit.getState().points).toHaveLength(2);
    // ⇧ locks the axis: both move 30 right.
    expect(anchors(node()).slice(2)).toEqual([
      { x: 130, y: 100 },
      { x: 230, y: 100 },
    ]);
    t.pointerDown(at(230, 100, { shift: true }));
    t.pointerUp(at(230, 100, { shift: true }));
    expect(useVectorEdit.getState().points).toEqual([{ path: 0, point: 2 }]);
  });

  it("marquee-selects points, nudges them, deletes (break) and deletes-and-heals", () => {
    useVectorEdit.getState().enter(id);
    drag(t, [90, -10], [110, 10]);
    expect(useVectorEdit.getState().points).toEqual([{ path: 0, point: 1 }]);
    t.keyDown(key("ArrowRight", { shiftKey: true }));
    expect(anchors(node())[1]).toEqual({ x: 110, y: 0 });
    expect(studio().past).toHaveLength(1);
    t.keyDown(key("Backspace"));
    expect(node().vector!.paths.map((p) => p.points.length)).toEqual([2]);
    studio().undo();
    useVectorEdit.getState().select([{ path: 0, point: 1 }]);
    t.keyDown(key("Backspace", { shiftKey: true }));
    expect(node().vector!.paths[0].points).toHaveLength(3);
    expect(anchors(node())[0]).toEqual({ x: 0, y: 0 });
  });

  it("drags a handle; the anchor's mirroring moves the other one", () => {
    useVectorEdit.getState().enter(id);
    studio().mutate((d) => {
      const n = d.nodes[id] as PathNode;
      n.vector!.paths[0].points[1] = { x: 100, y: 0, mirror: "angle-length", in: { x: -30, y: 0 }, out: { x: 30, y: 0 } };
      n.d = vectorToD(n.vector!);
    });
    useVectorEdit.getState().select([{ path: 0, point: 1 }]);
    drag(t, [130, 0], [130, 30]);
    const p = node().vector!.paths[0].points[1];
    expect(p.out).toEqual({ x: 30, y: 30 });
    expect(p.in).toEqual({ x: -30, y: -30 });
  });

  it("⌘-drags a segment to bend it through the pointer", () => {
    useVectorEdit.getState().enter(id);
    drag(t, [50, 0], [50, -40], { mod: true });
    const n = node();
    const c = segmentCubic(n.vector!, { path: 0, seg: 0 });
    const mid = apply(localMatrix(n), cubicAt(c, 0.5));
    expect(mid.x).toBeCloseTo(50, 0);
    expect(mid.y).toBeCloseTo(-40, 0);
    expect(studio().past).toHaveLength(1);
  });

  it("the pen in edit mode adds a point on a segment; ⌥-click removes one and heals", () => {
    useVectorEdit.getState().enter(id);
    studio().setTool("pen");
    expect(useVectorEdit.getState()).toMatchObject({ nodeId: id, tool: "pen" });
    t.pointerMove(at(50, 1));
    t.pointerDown(at(50, 1));
    t.pointerUp(at(50, 1));
    expect(node().vector!.paths[0].points).toHaveLength(5);
    t.pointerMove(at(50, 0, { alt: true }));
    t.pointerDown(at(50, 0, { alt: true }));
    t.pointerUp(at(50, 0, { alt: true }));
    expect(node().vector!.paths[0].points).toHaveLength(4);
  });

  it("⌘J joins two selected ends; Esc leaves edit mode; a click on empty canvas clears points first", () => {
    useVectorEdit.getState().enter(id);
    t.keyDown(key("a", { metaKey: true }));
    expect(useVectorEdit.getState().points).toHaveLength(4);
    useVectorEdit.getState().select([
      { path: 0, point: 0 },
      { path: 0, point: 3 },
    ]);
    t.keyDown(key("j", { metaKey: true }));
    expect(node().vector!.paths[0].closed).toBe(true);
    t.pointerDown(at(500, 500));
    t.pointerUp(at(500, 500));
    expect(useVectorEdit.getState()).toMatchObject({ nodeId: id, points: [] });
    t.pointerDown(at(500, 500));
    t.pointerUp(at(500, 500));
    expect(useVectorEdit.getState().nodeId).toBeNull();
    expect(studio().selection).toEqual([id]);
  });

  it("the paint bucket fills the clicked closed region only", () => {
    useVectorEdit.getState().enter(id);
    useVectorEdit.getState().select([
      { path: 0, point: 0 },
      { path: 0, point: 3 },
    ]);
    t.keyDown(key("j", { metaKey: true }));
    t.keyDown(key("b", { shiftKey: true }));
    expect(useVectorEdit.getState().tool).toBe("paint");
    t.pointerDown(at(80, 20));
    t.pointerUp(at(80, 20));
    expect(node().fill?.token).toBe("bg.surface");
  });
});
