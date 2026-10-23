import { beforeEach, describe, expect, it } from "vitest";
import { studio, useStudio } from "@/doc/store";
import { makeFrame } from "@/doc/factory";
import { apply, localMatrix } from "@/doc/geometry";
import { emptyDoc, type PathNode } from "@/doc/schema";
import { relayoutDoc } from "@/doc/autolayout";
import { type PointerInfo, VectorTools } from "./vector-tools";
import { useVectorEdit } from "./vector-state";

// Screen = world (zoom 1, camera at 0, 0).
const cam = { x: 0, y: 0, zoom: 1 };
const host = { toWorld: (p: { x: number; y: number }) => p, camera: () => cam, viewport: () => ({ w: 1000, h: 800 }), render: () => {} };
const at = (x: number, y: number, mods: Partial<PointerInfo> = {}): PointerInfo => ({ screen: { x, y }, world: { x, y }, button: 0, shift: false, alt: false, mod: false, ...mods });
const key = (k: string, extra: Partial<KeyboardEvent> = {}) =>
  ({ key: k, code: k === " " ? "Space" : k.length === 1 ? `Key${k.toUpperCase()}` : k, shiftKey: false, altKey: false, metaKey: false, ctrlKey: false, repeat: false, target: null, ...extra }) as unknown as KeyboardEvent;

function click(t: VectorTools, x: number, y: number, mods: Partial<PointerInfo> = {}) {
  t.pointerMove(at(x, y, mods));
  t.pointerDown(at(x, y, mods));
  t.pointerUp(at(x, y, mods));
}
function dragFrom(t: VectorTools, from: [number, number], to: [number, number], mods: Partial<PointerInfo> = {}) {
  t.pointerDown(at(...from, mods));
  for (let k = 1; k <= 4; k++) {
    t.pointerMove(at(from[0] + ((to[0] - from[0]) * k) / 4, from[1] + ((to[1] - from[1]) * k) / 4, mods));
  }
  t.pointerUp(at(...to, mods));
}
const paths = () => Object.values(studio().doc.nodes).filter((n): n is PathNode => n.type === "path");
/** Anchors in the parent's space. */
const anchors = (n: PathNode, path = 0) => n.vector!.paths[path].points.map((p) => apply(localMatrix(n), p));

describe("pen", () => {
  let t: VectorTools;
  beforeEach(() => {
    useVectorEdit.getState().exit();
    useStudio.setState({ doc: emptyDoc(), past: [], future: [], txBase: null, selection: [], tool: "pen", camera: cam, editingTextId: null });
    t?.dispose();
    t = new VectorTools(host);
  });

  it("clicks corners, enters the doc on the second anchor, one undo step per anchor; Enter finishes", () => {
    click(t, 100, 100);
    expect(paths()).toHaveLength(0);
    expect(studio().past).toHaveLength(0);
    click(t, 200, 100);
    expect(paths()).toHaveLength(1);
    expect(useVectorEdit.getState().nodeId).toBe(paths()[0].id);
    click(t, 200, 200);
    expect(studio().past).toHaveLength(2);
    expect(t.keyDown(key("Enter"))).toBe(true);
    const n = paths()[0];
    expect(n.vector!.paths[0].closed).toBe(false);
    expect(anchors(n)).toEqual([
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
    ]);
    // The studio's default canvas is dark: a new path takes the light ink so it shows.
    expect(n.stroke?.token).toBe("icon.inverse");
    expect(n.fill).toBeNull();
    expect(studio().tool).toBe("select");
    expect(studio().selection).toEqual([n.id]);
    expect(useVectorEdit.getState().nodeId).toBeNull();
    expect(studio().txBase).toBeNull();
  });

  it("Esc after one click leaves nothing behind", () => {
    click(t, 100, 100);
    expect(t.keyDown(key("Escape"))).toBe(true);
    expect(paths()).toHaveLength(0);
    expect(studio().past).toHaveLength(0);
    expect(studio().tool).toBe("select");
  });

  it("click-drag makes a smooth anchor with mirrored handles; ⌥ breaks the symmetry", () => {
    click(t, 0, 0);
    dragFrom(t, [100, 0], [140, 30]);
    let p = paths()[0].vector!.paths[0].points[1];
    expect(p.out).toEqual({ x: 40, y: 30 });
    expect(p.in).toEqual({ x: -40, y: -30 });
    expect(p.mirror).toBe("angle-length");
    // ⌥ partway through: the incoming handle stays where it was.
    t.pointerDown(at(300, 0));
    t.pointerMove(at(320, 0));
    t.pointerMove(at(320, 20, { alt: true }));
    t.pointerUp(at(320, 20, { alt: true }));
    p = paths()[0].vector!.paths[0].points[2];
    expect(p.in).toEqual({ x: -20, y: 0 });
    expect(p.out).toEqual({ x: 20, y: 20 });
    expect(p.mirror).toBe("none");
  });

  it("clicking the first anchor closes the path and keeps the pen in edit mode", () => {
    click(t, 0, 0);
    click(t, 100, 0);
    click(t, 100, 100);
    t.pointerMove(at(2, 1));
    const o = t.overlay()!;
    expect(o.closeRing).toBeDefined();
    click(t, 2, 1);
    const n = paths()[0];
    expect(n.vector!.paths[0].closed).toBe(true);
    expect(n.vector!.paths[0].points).toHaveLength(3);
    expect(useVectorEdit.getState()).toMatchObject({ nodeId: n.id, drawing: false });
    expect(studio().tool).toBe("pen");
    expect(studio().past).toHaveLength(3);
  });

  it("Backspace takes anchors back; the second one returns the first to the session", () => {
    click(t, 0, 0);
    click(t, 100, 0);
    click(t, 100, 100);
    expect(t.keyDown(key("Backspace"))).toBe(true);
    expect(paths()[0].vector!.paths[0].points).toHaveLength(2);
    t.keyDown(key("Backspace"));
    expect(paths()).toHaveLength(0);
    // The first anchor is still waiting: the next click makes a fresh two-anchor path from it.
    click(t, 0, 50);
    expect(anchors(paths()[0])).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 50 },
    ]);
  });

  it("⌘Z mid-path keeps drawing from the anchor that is now last", () => {
    click(t, 0, 0);
    click(t, 100, 0);
    click(t, 100, 100);
    studio().undo();
    click(t, 0, 100);
    expect(anchors(paths()[0])).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ]);
  });

  it("⇧ snaps the new segment to 45° steps", () => {
    click(t, 0, 0);
    click(t, 100, 17, { shift: true });
    expect(anchors(paths()[0])[1]).toEqual({ x: 100, y: 0 });
  });

  it("Esc ends the path then leaves edit mode (two stages)", () => {
    click(t, 0, 0);
    click(t, 100, 0);
    t.keyDown(key("Escape"));
    const id = paths()[0].id;
    expect(useVectorEdit.getState()).toMatchObject({ nodeId: id, tool: "move", drawing: false });
    expect(studio().tool).toBe("select");
    t.keyDown(key("Escape"));
    expect(useVectorEdit.getState().nodeId).toBeNull();
    expect(studio().selection).toEqual([id]);
  });

  it("continues an open path from its start (reversed) or end", () => {
    click(t, 0, 0);
    click(t, 100, 0);
    t.keyDown(key("Enter"));
    studio().setTool("pen");
    t.pointerMove(at(0, 0));
    click(t, 0, 0);
    expect(useVectorEdit.getState().drawing).toBe(true);
    click(t, 0, 100);
    t.keyDown(key("Enter"));
    expect(paths()).toHaveLength(1);
    expect(anchors(paths()[0])).toEqual([
      { x: 100, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 100 },
    ]);
  });

  it("draws into an auto-layout frame as an absolute layer that stays where it was drawn", () => {
    const f = makeFrame({ x: 0, y: 0, w: 400, h: 400, layout: { direction: "vertical", wrap: false, gap: 8, crossGap: 0, padding: { top: 10, end: 10, bottom: 10, start: 10 }, justify: "start", align: "start" } });
    studio().mutate((d) => {
      d.nodes[f.id] = f;
      d.roots.push(f.id);
    });
    click(t, 50, 60);
    click(t, 150, 160);
    t.keyDown(key("Enter"));
    const n = paths()[0];
    expect(n.parentId).toBe(f.id);
    expect(n.absolute).toBe(true);
    const doc = relayoutDoc(studio().doc, studio().doc);
    expect(anchors(doc.nodes[n.id] as PathNode)).toEqual([
      { x: 50, y: 60 },
      { x: 150, y: 160 },
    ]);
  });
});

describe("pencil", () => {
  let t: VectorTools;
  beforeEach(() => {
    useVectorEdit.getState().exit();
    useStudio.setState({ doc: emptyDoc(), past: [], future: [], txBase: null, selection: [], tool: "pencil", camera: cam, editingTextId: null });
    t?.dispose();
    t = new VectorTools(host);
  });

  it("fits a stroke into one smooth vector (one undo step), keeps the tool, and Esc selects it", () => {
    t.pointerDown(at(0, 100));
    for (let i = 1; i <= 120; i++) t.pointerMove(at(i * 3, 100 + 40 * Math.sin(i / 10)));
    expect(t.overlay()?.pencil?.pts.length).toBeGreaterThan(100);
    expect(paths()).toHaveLength(0);
    t.pointerUp(at(360, 100 + 40 * Math.sin(12)));
    const n = paths()[0];
    expect(n.vector!.paths[0].points.length).toBeLessThan(12);
    expect(n.stroke?.width).toBe(2);
    expect(n.ends).toEqual({ start: "round", end: "round" });
    expect(studio().past).toHaveLength(1);
    expect(studio().tool).toBe("pencil");
    expect(studio().selection).toEqual([]);
    expect(t.keyDown(key("Escape"))).toBe(true);
    expect(studio().selection).toEqual([n.id]);
    expect(studio().tool).toBe("select");
  });

  it("⇧ draws a straight line; a click draws nothing", () => {
    t.pointerDown(at(0, 0));
    t.pointerUp(at(0, 0));
    expect(paths()).toHaveLength(0);
    t.pointerDown(at(0, 0, { shift: true }));
    for (let i = 1; i <= 20; i++) t.pointerMove(at(i * 10, (i % 3) * 5, { shift: true }));
    t.pointerUp(at(200, 0, { shift: true }));
    expect(anchors(paths()[0])).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ]);
  });
});
