import { createRequire } from "node:module";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CanvasKit } from "canvaskit-wasm";
import { studio, useStudio } from "./store";
import { emptyDoc, type Doc, type FrameNode, type PathNode, type SceneNode } from "./schema";
import { makeFrame, makeIcon, makePath, makeShape, makeText } from "./factory";
import { worldBounds, type Pt } from "./geometry";
import { ungroupSelection } from "./group";
import { setPathOps, pathOps } from "./path-ops";
import { booleanSelection, canBoolean, canFlatten, canOutlineStroke, flattenSelection, outlineStrokeSelection } from "./booleans";
import { fillArea, rrectSegs } from "./shape-geometry";
import { isMaskLayer, maskOf } from "./mask";
import { canMask, toggleMask } from "./mask-ops";
import { isEditableVector, vectorOf, writeVector } from "./vector";
import { iconDrawing } from "@/design-system/icons";
import { makePathOps, segsOfPath } from "@/engine/canvaskit";
import { hitPath } from "@/engine/hit-test";

// Real Skia: CanvasKit's wasm runs in node, so these check the geometry the studio will produce.
let ck: CanvasKit;
beforeAll(async () => {
  const dir = path.resolve(import.meta.dirname, "../../node_modules/canvaskit-wasm/bin");
  const init = createRequire(import.meta.url)(path.join(dir, "canvaskit.js")) as (o: { locateFile: (f: string) => string }) => Promise<CanvasKit>;
  ck = await init({ locateFile: (f) => path.join(dir, f) });
  setPathOps(makePathOps(ck));
});

const doc = () => studio().doc;
const node = (id: string) => doc().nodes[id];
const ids = () => Object.keys(doc().nodes);

function load(nodes: SceneNode[], roots = nodes.filter((n) => !n.parentId).map((n) => n.id)) {
  const d: Doc = emptyDoc();
  for (const n of nodes) d.nodes[n.id] = n;
  d.roots = roots;
  useStudio.setState({ doc: d, past: [], future: [], txBase: null, selection: [] });
}

/** Whether the point (world) is inside the filled region of a vector layer (by Skia). */
function fills(id: string, p: Pt): boolean {
  const ops = pathOps()!;
  const a = fillArea(doc(), id, ops, [1, 0, 0, 1, 0, 0]);
  const b = worldBounds(doc(), id);
  const n = node(id);
  const segs = a!.segs.map((s) => (s.c === "Z" ? s : s.c === "C" ? { ...s, x1: s.x1 + n.x, y1: s.y1 + n.y, x2: s.x2 + n.x, y2: s.y2 + n.y, x: s.x + n.x, y: s.y + n.y } : { ...s, x: s.x + n.x, y: s.y + n.y }));
  const sk = ck.Path.MakeFromCmds(segs.flatMap((s) => (s.c === "M" ? [ck.MOVE_VERB, s.x, s.y] : s.c === "L" ? [ck.LINE_VERB, s.x, s.y] : s.c === "C" ? [ck.CUBIC_VERB, s.x1, s.y1, s.x2, s.y2, s.x, s.y] : [ck.CLOSE_VERB])))!;
  if (a!.evenOdd) sk.setFillType(ck.FillType.EvenOdd);
  const r = sk.contains(p.x, p.y);
  sk.delete();
  expect(b.w).toBeGreaterThan(0);
  return r;
}

const box = (id: string) => {
  const b = worldBounds(doc(), id);
  return [b.x, b.y, b.w, b.h].map((v) => Math.round(v * 100) / 100);
};

/** A red square (0,0 100×100) under a blue circle (50,50 100×100). */
function pair() {
  const rect = makeShape("rect", { name: "Square", x: 0, y: 0, w: 100, h: 100, fill: { color: "#FF0000" } });
  const ell = makeShape("ellipse", { name: "Circle", x: 50, y: 50, w: 100, h: 100, fill: { color: "#0000FF" } });
  load([rect, ell]);
  return { rect: rect.id, ell: ell.id };
}

describe("path ops (CanvasKit)", () => {
  it("turns Skia's conics into single cubics: a round cap is two curves, not dozens", () => {
    const p = ck.Path.MakeFromSVGString("M0 0L20 0")!.makeStroked({ width: 4, cap: ck.StrokeCap.Round })!;
    const segs = segsOfPath(ck, p);
    p.delete();
    expect(segs.filter((s) => s.c === "C")).toHaveLength(4);
    expect(segs.every((s) => s.c !== "C" || Math.abs(s.x) <= 22.001)).toBe(true);
  });

  it("keeps Skia's even-odd rule with the result (a ring is two contours)", () => {
    const ring = pathOps()!.combine({ segs: rrectSegs(0, 0, 20, 20, []) }, { segs: rrectSegs(5, 5, 15, 15, []) }, "subtract")!;
    expect(ring.evenOdd).toBe(true);
    expect(ring.segs.filter((s) => s.c === "M")).toHaveLength(2);
  });
});

describe("booleans", () => {
  let p: ReturnType<typeof pair>;
  beforeEach(() => (p = pair()));

  it("⌥⇧U unions into one editable vector with the top layer's paint, as one undo step", () => {
    const r = booleanSelection([p.rect, p.ell], "union");
    expect("id" in r).toBe(true);
    const id = (r as { id: string }).id;
    const n = node(id) as PathNode;
    expect(ids()).toEqual([id]);
    expect(n).toMatchObject({ type: "path", name: "Union", fill: { color: "#0000FF" }, rotation: 0 });
    expect(isEditableVector(n)).toBe(true);
    expect(box(id)).toEqual([0, 0, 150, 150]);
    expect(vectorOf(n).paths).toHaveLength(1);
    expect(fills(id, { x: 10, y: 10 })).toBe(true);
    expect(fills(id, { x: 140, y: 100 })).toBe(true);
    expect(fills(id, { x: 140, y: 10 })).toBe(false);
    expect(studio().selection).toEqual([id]);
    studio().undo();
    expect(ids().sort()).toEqual([p.rect, p.ell].sort());
  });

  it("⌥⇧S takes everything above from the bottom layer, which keeps its paint", () => {
    const id = (booleanSelection([p.ell, p.rect], "subtract") as { id: string }).id;
    expect(node(id)).toMatchObject({ name: "Subtract", fill: { color: "#FF0000" } });
    expect(box(id)).toEqual([0, 0, 100, 100]);
    expect(fills(id, { x: 20, y: 20 })).toBe(true);
    expect(fills(id, { x: 90, y: 90 })).toBe(false);
  });

  it("⌥⇧I keeps the overlap; ⌥⇧E keeps everything but", () => {
    const i = (booleanSelection([p.rect, p.ell], "intersect") as { id: string }).id;
    expect(box(i)).toEqual([50, 50, 50, 50]);
    expect(fills(i, { x: 90, y: 90 })).toBe(true);
    studio().undo();
    const x = (booleanSelection([p.rect, p.ell], "exclude") as { id: string }).id;
    expect(box(x)).toEqual([0, 0, 150, 150]);
    expect(fills(x, { x: 90, y: 90 })).toBe(false);
    expect(fills(x, { x: 10, y: 10 })).toBe(true);
    expect(fills(x, { x: 140, y: 100 })).toBe(true);
  });

  it("refuses without changing anything: one layer, no overlap, text", () => {
    expect(canBoolean([p.rect])).toBe("Select 2+ layers");
    const far = makeShape("rect", { x: 500, y: 500, w: 10, h: 10 });
    const t = makeText({ x: 0, y: 200, text: { content: "Hi" } });
    load([node(p.rect), far, t]);
    const before = doc();
    expect(booleanSelection([p.rect, far.id], "intersect")).toEqual({ error: "The layers don't overlap: nothing is left" });
    expect(canBoolean([p.rect, t.id])).toBe("Text can't be turned into a vector yet");
    expect(doc()).toBe(before);
  });

  it("bakes rotation and lands in the top layer's parent, in its slot", () => {
    const f = makeFrame({ name: "Screen", x: 1000, y: 2000, w: 400, h: 400 });
    const a = makeShape("rect", { x: 10, y: 10, w: 100, h: 100, parentId: f.id });
    const b = makeShape("rect", { x: 10, y: 10, w: 100, h: 100, rotation: 45, parentId: f.id });
    const c = makeShape("rect", { x: 300, y: 300, w: 10, h: 10, parentId: f.id });
    f.children = [a.id, b.id, c.id];
    load([f, a, b, c], [f.id]);
    const id = (booleanSelection([a.id, b.id], "union") as { id: string }).id;
    expect(node(f.id).children).toEqual([id, c.id]);
    const n = node(id);
    expect(n.rotation).toBe(0);
    const half = 50 * Math.SQRT2;
    // Local to the frame: the square's box, widened by its turned twin's corners.
    expect(n.x).toBeCloseTo(60 - half, 1);
    expect(n.w).toBeCloseTo(2 * half, 1);
  });

  it("works on the layers of one selected group, replacing the group", () => {
    const f = makeFrame({ name: "Group", x: 0, y: 0, w: 150, h: 150, fill: null, meta: { source: "user", group: true } });
    const a = makeShape("rect", { x: 0, y: 0, w: 100, h: 100, parentId: f.id });
    const b = makeShape("ellipse", { x: 50, y: 50, w: 100, h: 100, parentId: f.id });
    f.children = [a.id, b.id];
    load([f, a, b], [f.id]);
    expect(canBoolean([f.id])).toBe(true);
    const id = (booleanSelection([f.id], "union") as { id: string }).id;
    expect(doc().roots).toEqual([id]);
    expect(ids()).toEqual([id]);
  });
});

describe("flatten", () => {
  it("⌘E bakes a turned square into four anchors, no rotation", () => {
    const r = makeShape("rect", { name: "Box", x: 0, y: 0, w: 100, h: 100, rotation: 45, fill: { color: "#123456" } });
    load([r]);
    const id = (flattenSelection([r.id]) as { id: string }).id;
    const n = node(id) as PathNode;
    expect(n).toMatchObject({ name: "Box", rotation: 0, fill: { color: "#123456" } });
    const v = vectorOf(n);
    expect(v.paths).toHaveLength(1);
    expect(v.paths[0].points).toHaveLength(4);
    expect(n.w).toBeCloseTo(100 * Math.SQRT2, 1);
  });

  it("keeps open paths as they are (unfilled) next to the merged regions", () => {
    const line = makePath("", { name: "Line", x: 0, y: 200, w: 100, h: 0, vw: 100, vh: 0, fill: null, stroke: { color: "#000000", width: 2 } });
    writeVector(line, { paths: [{ closed: false, points: [{ x: 0, y: 0, mirror: "none" }, { x: 100, y: 0, mirror: "none" }] }] });
    const a = makeShape("rect", { x: 0, y: 0, w: 100, h: 100 });
    const b = makeShape("rect", { x: 50, y: 50, w: 100, h: 100 });
    load([a, b, line]);
    const id = (flattenSelection([a.id, b.id, line.id]) as { id: string }).id;
    const v = vectorOf(node(id) as PathNode);
    expect(v.paths.map((q) => q.closed)).toEqual([true, false]);
    // The two squares merged into one outline (8 corners).
    expect(v.paths[0].points).toHaveLength(8);
    expect(node(id)).toMatchObject({ name: "Vector", stroke: { width: 2 } });
    expect(box(id)).toEqual([0, 0, 150, 200]);
  });

  it("refuses text", () => {
    const t = makeText({ text: { content: "Hi" } });
    load([t]);
    expect(canFlatten([t.id])).toBe("Text can't be turned into a vector yet");
  });
});

describe("outline stroke", () => {
  it("⌥⌘O turns a stroked line into the filled region it painted", () => {
    const line = makePath("", { name: "Line", x: 10, y: 20, w: 100, h: 0, vw: 100, vh: 0, fill: null, stroke: { color: "#00AA00", token: "x", width: 4 }, ends: { start: "none", end: "none" }, join: "miter" });
    writeVector(line, { paths: [{ closed: false, points: [{ x: 0, y: 0, mirror: "none" }, { x: 100, y: 0, mirror: "none" }] }] });
    load([line]);
    const r = outlineStrokeSelection([line.id]) as { ids: string[] };
    expect(r.ids).toHaveLength(1);
    const n = node(r.ids[0]) as PathNode;
    expect(n).toMatchObject({ name: "Line", stroke: null, fill: { color: "#00AA00", token: "x" } });
    expect(box(n.id)).toEqual([10, 18, 100, 4]);
    expect(vectorOf(n).paths[0].closed).toBe(true);
  });

  it("keeps a filled shape's fill and groups it under its outline; a frame gets it as a layer", () => {
    const r = makeShape("rect", { name: "Card", x: 0, y: 0, w: 100, h: 50, opacity: 0.5, fill: { color: "#FFFFFF" }, stroke: { color: "#000000", width: 2 } });
    const f = makeFrame({ name: "Screen", x: 200, y: 0, w: 100, h: 100, stroke: { color: "#FF0000", width: 1 } });
    load([r, f]);
    const out = (outlineStrokeSelection([r.id, f.id]) as { ids: string[] }).ids;
    const g = node(out[0]) as FrameNode;
    expect(g).toMatchObject({ name: "Card", opacity: 0.5, meta: { group: true } });
    expect(g.children).toEqual([r.id, expect.any(String)]);
    expect(node(r.id)).toMatchObject({ stroke: null, opacity: 1 });
    expect(box(g.children[1])).toEqual([0, 0, 100, 50]);
    expect(fills(g.children[1], { x: 1, y: 25 })).toBe(true);
    expect(fills(g.children[1], { x: 50, y: 25 })).toBe(false);
    expect(node(f.id).stroke).toBeNull();
    expect(node(f.id).children).toEqual([out[1]]);
    expect(box(out[1])).toEqual([200, 0, 100, 100]);
    studio().undo();
    expect(node(r.id).stroke).not.toBeNull();
    expect(ids()).toHaveLength(2);
  });

  it("outlines an icon into a filled vector", () => {
    expect(iconDrawing("heart")).toBeTruthy();
    const i = makeIcon("heart", { x: 0, y: 0, w: 48, h: 48, fill: { color: "#111111" } });
    load([i]);
    expect(canOutlineStroke([i.id])).toBe(true);
    const id = (outlineStrokeSelection([i.id]) as { ids: string[] }).ids[0];
    expect(node(id)).toMatchObject({ type: "path", fill: { color: "#111111" }, stroke: null });
    const [, , w, h] = box(id);
    expect(w).toBeGreaterThan(40);
    expect(h).toBeGreaterThan(36);
  });
});

describe("masks", () => {
  let p: ReturnType<typeof pair>;
  beforeEach(() => (p = pair()));

  it("⌃⌘M puts the layers in a mask group as big as its bottom-most layer", () => {
    expect(canMask([p.rect])).toBe("Select the mask and the layers it masks");
    expect(toggleMask([p.ell, p.rect])).toBe("masked");
    const g = node(doc().roots[0]) as FrameNode;
    expect(g).toMatchObject({ name: "Mask group", meta: { group: true, mask: true } });
    expect(g.children).toEqual([p.rect, p.ell]);
    expect(maskOf(doc(), g)).toBe(p.rect);
    expect(isMaskLayer(doc(), p.rect)).toBe(true);
    expect(box(g.id)).toEqual([0, 0, 100, 100]);
    // What it shows is the overlap.
    const a = fillArea(doc(), g.id, pathOps()!, [1, 0, 0, 1, 0, 0])!;
    const xs = a.segs.flatMap((s) => (s.c === "Z" ? [] : [s.x]));
    expect(Math.max(...xs)).toBeCloseTo(100, 3);
    expect(studio().past).toHaveLength(1);
  });

  it("clicks reach masked layers only through the mask", () => {
    toggleMask([p.rect, p.ell]);
    const g = doc().roots[0];
    expect(hitPath(doc(), { x: 90, y: 90 })).toEqual([g, p.ell]);
    expect(hitPath(doc(), { x: 20, y: 20 })).toEqual([g, p.rect]);
    expect(hitPath(doc(), { x: 140, y: 100 })).toBeNull();
  });

  it("⌃⌘M again releases the mask (a plain group); ungroup releases everything", () => {
    toggleMask([p.rect, p.ell]);
    const g = doc().roots[0];
    expect(toggleMask([p.rect])).toBe("unmasked");
    expect(node(g).meta.mask).toBeUndefined();
    expect(box(g)).toEqual([0, 0, 150, 150]);
    expect(hitPath(doc(), { x: 140, y: 100 })).toEqual([g, p.ell]);
    studio().undo();
    expect(node(g).meta.mask).toBe(true);
    ungroupSelection([g]);
    expect(doc().roots).toEqual([p.rect, p.ell]);
  });
});
