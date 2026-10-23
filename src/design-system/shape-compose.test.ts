import { createRequire } from "node:module";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CanvasKit } from "canvaskit-wasm";
import { produce } from "immer";
import type { Doc, FrameNode, PathNode, SceneNode } from "@/doc/schema";
import { ensureYoga, layoutToNodes } from "@/engine/layout";
import { relayoutDoc, setAutoLayoutEnabled } from "@/doc/autolayout";
import { setPathOps } from "@/doc/path-ops";
import { setTextMeasurer } from "@/doc/measure";
import { applyRecipe, partBox, recipeArea, type ShapeRecipe } from "@/doc/shape-recipe";
import { makePathOps } from "@/engine/canvaskit";
import { buildInstance, type Inst, type LBox } from "./builders";
import { BUILTIN } from "./resolve";

/*
 * Composed shapes: primitives combined with booleans and pinned to edges, rebuilt for any size.
 * Checked on three kinds of product (a delivery coupon, a boarding pass, a loyalty seal) and on
 * plain geometry, with real Skia (CanvasKit's wasm runs in node).
 */

let ck: CanvasKit;
beforeAll(async () => {
  const dir = path.resolve(import.meta.dirname, "../../node_modules/canvaskit-wasm/bin");
  const init = createRequire(import.meta.url)(path.join(dir, "canvaskit.js")) as (o: { locateFile: (f: string) => string }) => Promise<CanvasKit>;
  ck = await init({ locateFile: (f) => path.join(dir, f) });
  setPathOps(makePathOps(ck));
  await ensureYoga();
});
afterAll(() => setPathOps(null));

/** Whether a vector layer paints the point (its own px). */
function paints(n: Pick<PathNode, "d" | "evenOdd" | "vw" | "vh" | "w" | "h">, x: number, y: number): boolean {
  const p = ck.Path.MakeFromSVGString(n.d)!;
  if (n.evenOdd) p.setFillType(ck.FillType.EvenOdd);
  const inside = p.contains((x * n.vw) / n.w, (y * n.vh) / n.h);
  p.delete();
  return inside;
}

/** A recipe drawn at a size, as a stand-in layer. */
function drawn(recipe: ShapeRecipe, w: number, h: number): PathNode {
  const n = { type: "path", w, h, d: "M0 0Z", vw: 1, vh: 1, recipe } as unknown as PathNode;
  applyRecipe(n);
  return n;
}

/** A ticket: a rounded body minus two circles centred on its side edges, at y = 70. */
const ticket = (dir: "ltr" | "rtl" = "ltr"): ShapeRecipe => ({
  ref: { w: 300, h: 160 },
  dir,
  parts: [
    { kind: "rect", op: "base", x: 0, y: 0, w: 300, h: 160, radius: 12, pinX: "stretch", pinY: "stretch" },
    { kind: "ellipse", op: "subtract", x: -10, y: 60, w: 20, h: 20, pinX: "start", pinY: "top" },
    { kind: "ellipse", op: "subtract", x: 290, y: 60, w: 20, h: 20, pinX: "end", pinY: "top" },
  ],
});

describe("pins", () => {
  const ref = { w: 300, h: 100 };
  const part = { x: 280, y: 10, w: 20, h: 20 };
  it("keep a part at its edge, centred, stretched or scaled when the size changes", () => {
    const at = (pinX: "start" | "end" | "center" | "stretch" | "scale") => partBox({ ...part, pinX, pinY: "top" }, ref, { w: 400, h: 100 });
    expect(at("start")).toMatchObject({ x: 280, w: 20 });
    expect(at("end")).toMatchObject({ x: 380, w: 20 });
    expect(at("center")).toMatchObject({ x: 330, w: 20 });
    expect(at("stretch")).toMatchObject({ x: 280, w: 120 });
    expect(at("scale").x).toBeCloseTo(373.33, 1);
  });

  it("don't move a part on an axis drawn without a reference size", () => {
    expect(partBox({ ...part, pinX: "end", pinY: "top" }, { h: 100 }, { w: 500, h: 100 })).toMatchObject({ x: 280 });
  });
});

describe("combining shapes", () => {
  it("cuts real notches: a circle centred on each edge, half outside, removed from the body", () => {
    const t = drawn(ticket(), 300, 160);
    expect(paints(t, 150, 120)).toBe(true); // the body
    expect(paints(t, 3, 70)).toBe(false); // inside the start notch
    expect(paints(t, 297, 70)).toBe(false); // inside the end notch
    expect(paints(t, 3, 30)).toBe(true); // the edge away from the notch
    expect(paints(t, 15, 70)).toBe(true); // just past the notch's radius
  });

  it("keeps the notches round and on their edges at any width", () => {
    for (const w of [240, 358, 520]) {
      const t = drawn(ticket(), w, 160);
      expect(paints(t, w - 3, 70)).toBe(false);
      expect(paints(t, w - 15, 70)).toBe(true);
      expect(paints(t, w / 2, 70)).toBe(true);
    }
  });

  it("mirrors for right-to-left", () => {
    const r: ShapeRecipe = { ref: { w: 200, h: 100 }, dir: "rtl", parts: [{ kind: "rect", op: "base", x: 0, y: 0, w: 50, h: 100, pinX: "start", pinY: "top" }] };
    const t = drawn(r, 200, 100);
    expect(paints(t, 190, 50)).toBe(true);
    expect(paints(t, 10, 50)).toBe(false);
  });

  it("makes a seal (a star with a circle added) and a ring (a circle with a circle removed)", () => {
    const seal = drawn({ ref: { w: 100, h: 100 }, dir: "ltr", parts: [
      { kind: "star", op: "base", x: 0, y: 0, w: 100, h: 100, count: 12, ratio: 0.8, pinX: "start", pinY: "top" },
      { kind: "ellipse", op: "union", x: 15, y: 15, w: 70, h: 70, pinX: "start", pinY: "top" },
    ] }, 100, 100);
    expect(paints(seal, 50, 2)).toBe(true); // a star point
    expect(paints(seal, 50, 50)).toBe(true);
    const ring = drawn({ ref: { w: 100, h: 100 }, dir: "ltr", parts: [
      { kind: "ellipse", op: "base", x: 0, y: 0, w: 100, h: 100, pinX: "start", pinY: "top" },
      { kind: "ellipse", op: "subtract", x: 20, y: 20, w: 60, h: 60, pinX: "start", pinY: "top" },
    ] }, 100, 100);
    expect(paints(ring, 50, 50)).toBe(false);
    expect(paints(ring, 50, 10)).toBe(true);
  });

  it("intersects and excludes", () => {
    const two = (op: "intersect" | "exclude") =>
      drawn({ ref: { w: 150, h: 100 }, dir: "ltr", parts: [
        { kind: "rect", op: "base", x: 0, y: 0, w: 100, h: 100, pinX: "start", pinY: "top" },
        { kind: "rect", op, x: 50, y: 0, w: 100, h: 100, pinX: "start", pinY: "top" },
      ] }, 150, 100);
    expect([paints(two("intersect"), 25, 50), paints(two("intersect"), 75, 50)]).toEqual([false, true]);
    expect([paints(two("exclude"), 25, 50), paints(two("exclude"), 75, 50), paints(two("exclude"), 125, 50)]).toEqual([true, false, true]);
  });

  it("rebuilds only when the size changes, and says when it couldn't apply the booleans", () => {
    const t = drawn(ticket(), 300, 160);
    const d = t.d;
    applyRecipe(t);
    expect(t.d).toBe(d);
    t.w = 340;
    applyRecipe(t);
    expect(t.d).not.toBe(d);
    expect(t.recipe!.built).toEqual({ w: 340, h: 160, exact: true });
    setPathOps(null);
    try {
      expect(recipeArea(ticket(), { w: 300, h: 160 }).exact).toBe(false);
    } finally {
      setPathOps(makePathOps(ck));
    }
  });
});

// ---------------------------------------------------------------------------
// In the catalog: Graphic

const ctx = { dir: "ltr" as const, lang: "en" as const, ts: BUILTIN };
/** An instance built and laid out inside a host of this width. */
const nodesOf = (inst: Inst, width: number, dir: "ltr" | "rtl" = "ltr"): SceneNode[] =>
  layoutToNodes({ kind: "frame", name: "Host", width, direction: "column", children: [buildInstance(inst, { ...ctx, dir })] }, { ...ctx, dir }, { x: 0, y: 0 });
const rules = (b: LBox): string[] => [...(b.flags ?? []).map((f) => f.rule), ...(b.children ?? []).flatMap(rules)];

/** A coupon: a Stack whose surface is a backdrop ticket, with its copy on top. */
const coupon = (title = "Up to 40% off select items"): Inst => ({
  component: "Stack",
  props: { direction: "vertical", gap: "200", padding: "400" },
  children: [
    {
      component: "Graphic",
      props: {
        label: "Coupon",
        fit: "backdrop",
        width: 300,
        height: 120,
        shapes: [
          { kind: "rect", x: 0, y: 0, w: 300, h: 120, radius: "lg", fill: "bg.surface", stroke: "border.default", strokeWidth: 1, pinX: "stretch", pinY: "stretch", shadow: "sm" },
          { kind: "ellipse", x: -11, y: 59, w: 22, h: 22, combine: "subtract", pinX: "start", pinY: "top" },
          { kind: "ellipse", x: 289, y: 59, w: 22, h: 22, combine: "subtract", pinX: "end", pinY: "top" },
          { kind: "path", d: "M24 70 H276", stroke: "border.default", strokeWidth: 2, dash: "dashed", pinX: "stretch", pinY: "top" },
        ],
      },
    },
    { component: "Text", props: { text: title, style: "headline" } },
    { component: "Text", props: { text: "No min. spend", style: "caption", tone: "secondary" } },
    { component: "Text", props: { text: "View items", style: "body-strong", align: "center" } },
  ],
});

describe("Graphic composes shapes", () => {
  it("draws combined shapes as one outline with the first shape's paint, shadow and all", () => {
    const ns = nodesOf(coupon(), 320);
    const g = ns.find((n) => n.meta.component === "Graphic")!;
    const [face, line] = ns.filter((n) => n.parentId === g.id) as PathNode[];
    expect(face.type).toBe("path");
    expect(face.recipe?.parts.map((p) => p.op)).toEqual(["base", "subtract", "subtract"]);
    expect(face.fill?.token).toBe("bg.surface");
    expect(face.stroke?.token).toBe("border.default");
    expect(face.effects?.length).toBeGreaterThan(0);
    expect(line.stroke?.dash).toEqual([6, 4]);
    // The notches are real cuts, on the edges.
    expect(face.h).toBeGreaterThan(85);
    expect(paints(face, 3, 70)).toBe(false);
    expect(paints(face, face.w - 3, 70)).toBe(false);
    expect(paints(face, face.w / 2, 40)).toBe(true);
  });

  it("makes a backdrop the container's surface: first, pinned to its edges, as big as it", () => {
    const ns = nodesOf(coupon(), 320);
    const stack = ns.find((n) => n.meta.component === "Stack") as FrameNode;
    const kids = ns.filter((n) => n.parentId === stack.id);
    const g = kids[0];
    expect(g.meta.component).toBe("Graphic");
    expect([g.absolute, g.fillParent]).toEqual([true, true]);
    expect([g.x, g.y, g.w, g.h]).toEqual([0, 0, stack.w, stack.h]);
    const face = ns.find((n) => n.parentId === g.id) as PathNode;
    expect([face.w, face.h]).toEqual([stack.w, stack.h]);
    // Its end notch sits on the Stack's end edge at whatever width it got.
    expect(paints(face, face.w - 3, 70)).toBe(false);
    expect(paints(face, face.w - 15, 70)).toBe(true);
  });

  it("follows its container when the container's size changes later (relayout)", () => {
    const ns = nodesOf(coupon(), 320);
    let doc: Doc = { nodes: Object.fromEntries(ns.map((n) => [n.id, n])), roots: [ns[0].id] };
    const stack = ns.find((n) => n.meta.component === "Stack")!;
    const g = ns.find((n) => n.meta.component === "Graphic")!;
    const face = ns.find((n) => n.parentId === g.id) as PathNode;
    const before = face.d;
    setAutoLayoutEnabled(true);
    try {
      // Longer copy wraps, so the coupon grows taller; the host gets wider too.
      const title = ns.find((n) => n.type === "text" && n.parentId === stack.id)!;
      const next = produce(doc, (d) => {
        (d.nodes[ns[0].id] as FrameNode).w = 400;
        const t = d.nodes[title.id];
        if (t.type === "text") t.text = { ...t.text, content: "Up to 40% off select items, this week only, on every order over AED 50" };
      });
      doc = relayoutDoc(doc, next);
    } finally {
      setAutoLayoutEnabled(false);
    }
    const s2 = doc.nodes[stack.id];
    const f2 = doc.nodes[face.id] as PathNode;
    expect([f2.w, f2.h]).toEqual([s2.w, s2.h]);
    expect(f2.w).toBeGreaterThan(face.w);
    expect(f2.d).not.toBe(before);
    expect(paints(f2, f2.w - 3, 70)).toBe(false);
  });

  it("works for a boarding pass (a notched stub on the end, pinned there) and a seal (star and circle)", () => {
    const pass: Inst = {
      component: "Graphic",
      props: { label: "Boarding pass", fit: "fill", width: 320, height: 120, shapes: [
        { kind: "rect", x: 0, y: 0, w: 320, h: 120, radius: "md", fill: "bg.brand-strong", pinX: "stretch" },
        { kind: "ellipse", x: 230, y: -10, w: 20, h: 20, combine: "subtract", pinX: "end" },
        { kind: "ellipse", x: 230, y: 110, w: 20, h: 20, combine: "subtract", pinX: "end" },
        { kind: "text", x: 252, y: 50, w: 60, text: "12B", style: "headline", fill: "text.on-brand-strong", pinX: "end" },
      ] },
    };
    const ns = nodesOf(pass, 400);
    const g = ns.find((n) => n.meta.component === "Graphic")!;
    const face = ns.find((n) => n.parentId === g.id && n.type === "path") as PathNode;
    const seat = ns.find((n) => n.type === "text" && n.parentId === g.id)!;
    expect(g.w).toBe(400);
    // The stub's notches moved with the end edge: 80px further than drawn.
    expect(paints(face, 320, 3)).toBe(false);
    expect(paints(face, 240, 3)).toBe(true);
    expect(seat.x).toBe(252 + 80);

    const seal: Inst = { component: "Graphic", props: { label: "Seal", width: 64, height: 64, shapes: [
      { kind: "star", x: 0, y: 0, w: 64, h: 64, count: 12, ratio: 0.82, fill: "bg.brand" },
      { kind: "ellipse", x: 10, y: 10, w: 44, h: 44, combine: "union" },
      { kind: "icon", x: 20, y: 20, w: 24, icon: "check", fill: "icon.on-brand" },
    ] } };
    const sn = nodesOf(seal, 200);
    const sg = sn.find((n) => n.meta.component === "Graphic")!;
    const star = sn.find((n) => n.parentId === sg.id && n.type === "path") as PathNode;
    expect(star.recipe?.parts.map((p) => p.kind)).toEqual(["star", "ellipse"]);
    expect(paints(star, 32, 1)).toBe(true);
  });

  it("leaves plain shapes as the layers they always were, and says when a shape can't combine", () => {
    const plain: Inst = { component: "Graphic", props: { label: "Card", width: 240, height: 150, shapes: [{ kind: "rect", x: 0, y: 0, w: 240, h: 150, fill: "bg.brand-strong", radius: "xl" }] } };
    const ns = nodesOf(plain, 300);
    const g = ns.find((n) => n.meta.component === "Graphic")!;
    expect(ns.find((n) => n.parentId === g.id)?.type).toBe("rect");
    const odd = buildInstance({ component: "Graphic", props: { label: "Odd", width: 100, height: 40, shapes: [{ kind: "text", x: 0, y: 0, w: 80, text: "Hi", combine: "union" }, { kind: "ellipse", x: 0, y: 0, w: 10, h: 10, fill: "bg.brand", combine: "subtract" }] } }, ctx);
    expect(rules(odd).filter((r) => r === "graphic-combine")).toHaveLength(2);
  });
});

describe("lining a backdrop up with its content", () => {
  // Copy that wraps (the engine measures with CanvasKit; ~0.55em per character here).
  beforeAll(() =>
    setTextMeasurer((t, w) => {
      const width = t.content.length * t.fontSize * 0.55;
      return { w: w === null ? width : Math.min(w, width), h: t.lineHeight * (w === null ? 1 : Math.max(1, Math.ceil(width / w))) };
    }),
  );
  afterAll(() => setTextMeasurer((t) => ({ w: t.content.length * t.fontSize * 0.55, h: t.lineHeight })));

  /** A coupon whose notches centre on its tear line (its 3rd part), wherever the copy pushes it. */
  const notched = (title: string): Inst => ({
    component: "Stack",
    props: { direction: "vertical", gap: "200", padding: "400" },
    children: [
      {
        component: "Graphic",
        props: { label: "Coupon", fit: "backdrop", width: 300, height: 140, shapes: [
          { kind: "rect", x: 0, y: 0, w: 300, h: 140, radius: "lg", fill: "bg.surface", stroke: "border.default", strokeWidth: 1, pinX: "stretch", pinY: "stretch" },
          { kind: "ellipse", x: -11, y: 0, w: 22, h: 22, combine: "subtract", centerOn: 3 },
          { kind: "ellipse", x: 289, y: 0, w: 22, h: 22, combine: "subtract", pinX: "end", centerOn: 3 },
        ] },
      },
      { component: "Text", props: { text: title, style: "headline" } },
      { component: "Text", props: { text: "No min. spend", style: "caption", tone: "secondary" } },
      { component: "Graphic", props: { label: "Tear line", fit: "fill", width: 268, height: 2, shapes: [{ kind: "path", d: "M0 1 H268", stroke: "border.default", strokeWidth: 1.5, dash: "dashed", pinX: "stretch" }] } },
      { component: "Text", props: { text: "View items", style: "body-strong", align: "center" } },
    ],
  });
  const lineCentre = (ns: SceneNode[]) => {
    const stack = ns.find((n) => n.meta.component === "Stack")!;
    const line = ns.filter((n) => n.parentId === stack.id && n.meta.component === "Graphic")[1];
    return line.y + line.h / 2;
  };
  const faceOf = (ns: SceneNode[]) => ns.find((n) => n.type === "path" && !!(n as PathNode).recipe?.parts.some((p) => p.centerOn)) as PathNode;

  it("centres the notches on the tear line, however many lines the title takes", () => {
    const ys: number[] = [];
    for (const title of ["40% off", "Up to 40% off select items from every restaurant near you this week"]) {
      const ns = nodesOf(notched(title), 320);
      const y = lineCentre(ns);
      ys.push(y);
      const face = faceOf(ns);
      expect(paints(face, 3, y)).toBe(false);
      expect(paints(face, face.w - 3, y)).toBe(false);
      expect(paints(face, 3, y - 14)).toBe(true);
      expect(paints(face, 3, y + 14)).toBe(true);
    }
    // The long title wrapped, so the line (and the notches) moved down.
    expect(ys[1]).toBeGreaterThan(ys[0] + 10);
  });

  it("keeps a thin rule as thin as drawn, so what lines up with it lines up with the line itself", () => {
    const ns = nodesOf(notched("40% off"), 320);
    const stack = ns.find((n) => n.meta.component === "Stack")!;
    const line = ns.filter((n) => n.parentId === stack.id && n.meta.component === "Graphic")[1];
    expect(line.h).toBe(2);
  });

  it("moves them with the tear line when an edit reflows the copy", () => {
    const ns = nodesOf(notched("40% off"), 320);
    let doc: Doc = { nodes: Object.fromEntries(ns.map((n) => [n.id, n])), roots: [ns[0].id] };
    const stack = ns.find((n) => n.meta.component === "Stack")!;
    const title = ns.find((n) => n.type === "text" && n.parentId === stack.id)!;
    setAutoLayoutEnabled(true);
    try {
      doc = relayoutDoc(doc, produce(doc, (d) => {
        const t = d.nodes[title.id];
        if (t.type === "text") t.text = { ...t.text, content: "Up to 40% off select items from every restaurant near you this week" };
      }));
    } finally {
      setAutoLayoutEnabled(false);
    }
    const after = Object.values(doc.nodes);
    const y = lineCentre(after);
    expect(y).toBeGreaterThan(lineCentre(ns) + 10);
    const face = faceOf(after);
    expect(paints(face, 3, y)).toBe(false);
    expect(paints(face, face.w - 3, y)).toBe(false);
  });
});
