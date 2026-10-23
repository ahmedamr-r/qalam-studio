import { describe, expect, it } from "vitest";
import { parsePath } from "@/design-system/svg-path";
import { apply, localMatrix } from "./geometry";
import { emptyDoc, type Doc, type VectorData } from "./schema";
import { makeFrame } from "./factory";
import { defaultInk, endTangent, HEADS, lineGeometry, makeLine, makeShapeVector, polygonVector, starVector, strokeEnds, strokeOverhang } from "./vector-shapes";
import { flatten, isEditableVector, vectorBounds } from "./vector";

const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

describe("polygon and star", () => {
  it("fills the box with a triangle, apex at top-centre and base on the bottom", () => {
    const v = polygonVector(3, 100, 100);
    expect(vectorBounds(v)).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    const pts = v.paths[0].points;
    expect(pts[0]).toMatchObject({ x: 50, y: 0 });
    expect(pts.slice(1).every((p) => Math.abs(p.y - 100) < 1e-9)).toBe(true);
    expect(v.paths[0].closed).toBe(true);
  });

  it("clamps the count to 3–60", () => {
    expect(polygonVector(1, 10, 10).paths[0].points).toHaveLength(3);
    expect(polygonVector(99, 10, 10).paths[0].points).toHaveLength(60);
  });

  it("makes a star with 2n points whose outer points touch the box", () => {
    const v = starVector(5, 0.382, 100, 100);
    const pts = v.paths[0].points;
    expect(pts).toHaveLength(10);
    const b = vectorBounds(v);
    near(b.x, 0);
    near(b.y, 0);
    near(b.w, 100);
    near(b.h, 100);
    // In a box with the star's own proportions (scale 100 on both axes), inner / outer = ratio.
    const c18 = Math.cos(Math.PI / 10),
      s54 = Math.sin((3 * Math.PI) / 10);
    const own = starVector(5, 0.382, 200 * c18, 100 * (1 + s54)).paths[0].points;
    const centre = { x: 100 * c18, y: 100 };
    const dist = (p: { x: number; y: number }) => Math.hypot(p.x - centre.x, p.y - centre.y);
    near(dist(own[0]), 100, 1e-6);
    near(dist(own[1]) / dist(own[0]), 0.382, 1e-6);
  });

  it("creates parametric nodes with a default fill and no stroke", () => {
    const n = makeShapeVector("star", { x: 10, y: 20, w: 100, h: 100 });
    expect(n.shape).toEqual({ kind: "star", count: 5, ratio: 0.382 });
    expect(n.fill?.token).toBe("bg.surface");
    expect(n.stroke).toBeNull();
    expect(isEditableVector(n)).toBe(true);
    expect([n.vw, n.vh]).toEqual([100, 100]);
  });
});

describe("lines", () => {
  it("maps its two ends back onto A and B", () => {
    const cases = [
      [{ x: 10, y: 20 }, { x: 110, y: 20 }],
      [{ x: 0, y: 0 }, { x: -30, y: 40 }],
      [{ x: 7.5, y: -3 }, { x: 60, y: 90 }],
    ];
    for (const [a, b] of cases) {
      const g = lineGeometry(a, b);
      expect(g.h).toBe(0);
      const m = localMatrix(g);
      const pa = apply(m, { x: 0, y: 0 }),
        pb = apply(m, { x: g.w, y: 0 });
      near(pa.x, a.x, 0.01);
      near(pa.y, a.y, 0.01);
      near(pb.x, b.x, 0.01);
      near(pb.y, b.y, 0.01);
    }
  });

  it("makes lines and arrows with Figma's defaults", () => {
    const line = makeLine({ x: 0, y: 0 }, { x: 100, y: 0 });
    expect(line).toMatchObject({ name: "Line", w: 100, h: 0, vw: 100, vh: 0, fill: null, join: "miter", ends: { start: "none", end: "none" }, shape: { kind: "line" } });
    expect(line.d).toBe("M0 0L100 0");
    expect(line.stroke?.token).toBe("icon.primary");
    const arrow = makeLine({ x: 0, y: 0 }, { x: 100, y: 0 }, true);
    expect(arrow.name).toBe("Arrow");
    expect(arrow.ends).toEqual({ start: "none", end: "arrow-lines" });
  });
});

describe("strokeEnds", () => {
  const line: VectorData = { paths: [{ points: [{ x: 0, y: 0, mirror: "none" }, { x: 100, y: 0, mirror: "none" }], closed: false }] };

  it("leaves matching plain caps to Skia", () => {
    expect(strokeEnds(line, 2, { start: "round", end: "round" })).toMatchObject({ cap: "round", body: null, fill: "", stroke: "" });
    expect(strokeEnds(line, 2, { start: "none", end: "none" }).cap).toBe("butt");
    expect(strokeEnds(line, 2, undefined).cap).toBe("round");
  });

  it("puts the line arrow's tip on the end, with symmetric wings", () => {
    const plan = strokeEnds(line, 2, { start: "none", end: "arrow-lines" });
    expect(plan.cap).toBe("butt");
    const segs = parsePath(plan.stroke).segs as { c: string; x: number; y: number }[];
    expect(segs[1]).toMatchObject({ x: 100, y: 0 });
    near(segs[0].x, segs[2].x, 0.01);
    near(segs[0].y, -segs[2].y, 0.01);
    expect(plan.body!.paths[0].points[1].x).toBe(100);
  });

  it("trims the body under filled heads", () => {
    const sw = 4;
    const plan = strokeEnds(line, sw, { start: "circle", end: "arrow-triangle" });
    const pts = flatten(plan.body!, 0.1)[0].pts;
    const r = HEADS.circle(sw);
    near(pts[0].x, Math.sqrt(r * r - (sw / 2) ** 2), 0.5);
    near(pts[pts.length - 1].x, 100 - 0.8 * HEADS.triangle(sw) * (Math.sqrt(3) / 2), 0.5);
    expect(plan.fill).toContain("A");
  });

  it("finds end tangents from the nearest distinct control point", () => {
    const curve = { points: [{ x: 0, y: 0, out: { x: 0, y: 10 }, mirror: "none" as const }, { x: 100, y: 0, mirror: "none" as const }], closed: false };
    const s = endTangent(curve, "start")!;
    near(s.dir.x, 0);
    near(s.dir.y, -1);
    const e = endTangent(curve, "end")!;
    expect(e.dir.x).toBeGreaterThan(0);
  });

  it("reports how far heads reach", () => {
    expect(strokeOverhang({ stroke: { color: "#000", width: 2 }, ends: { start: "none", end: "arrow-lines" }, join: "miter" })).toBeGreaterThanOrEqual(HEADS.wing(2));
    expect(strokeOverhang({ stroke: null, ends: undefined, join: undefined })).toBe(0);
  });
});

describe("defaultInk", () => {
  const doc = (fill: string | null) => {
    const f = makeFrame({ x: 0, y: 0, w: 100, h: 100, fill: fill ? { color: fill } : null });
    const g = makeFrame({ x: 0, y: 0, w: 50, h: 50, fill: null });
    g.parentId = f.id;
    f.children = [g.id];
    return { d: { ...emptyDoc(), nodes: { [f.id]: f, [g.id]: g }, roots: [f.id] } as Doc, f, g };
  };

  it("contrasts with the nearest opaque fill around the vector, through unfilled frames", () => {
    const light = doc("#FFFFFF");
    expect(defaultInk(light.d, light.g.id, true).token).toBe("icon.primary");
    const dark = doc("#101010");
    expect(defaultInk(dark.d, dark.g.id, false).token).toBe("icon.inverse");
  });

  it("falls back to the canvas at the top level, or under see-through fills", () => {
    expect(defaultInk(emptyDoc(), null, true).token).toBe("icon.inverse");
    expect(defaultInk(emptyDoc(), null, false).token).toBe("icon.primary");
    const glass = doc("#FFFFFF20");
    expect(defaultInk(glass.d, glass.g.id, true).token).toBe("icon.inverse");
  });

  it("strokes new lines with it", () => {
    const ink = defaultInk(emptyDoc(), null, true);
    expect(makeLine({ x: 0, y: 0 }, { x: 10, y: 0 }, false, undefined, ink).stroke).toMatchObject({ color: ink.color, token: "icon.inverse" });
  });
});
