import { describe, expect, it } from "vitest";
import type { Vec2, VectorData } from "./schema";
import { type Cubic, cubicAt, cutAt, joinEndpoints, segmentCubic, setMirror, splitSegment, vectorToD } from "./vector";
import { PENCIL_MAX_ANCHORS, decimate, deleteAndHeal, fitCubics, healCubics, pencilToVector, rdp, splitAtCorners } from "./vector-fit";

const sample = (c: Cubic, n: number): Vec2[] => Array.from({ length: n + 1 }, (_, i) => cubicAt(c, i / n));
const close = (a: Vec2, b: Vec2, tol: number) => Math.hypot(a.x - b.x, a.y - b.y) <= tol;
/** Largest distance from samples to the fitted cubics (dense sampling of the fit). */
function fitError(pts: Vec2[], cs: Cubic[]): number {
  const dense = cs.flatMap((c) => sample(c, 2000));
  return Math.max(...pts.map((p) => Math.min(...dense.map((q) => Math.hypot(p.x - q.x, p.y - q.y)))));
}

describe("vector-fit: decimation and corners", () => {
  it("rdp collapses collinear samples to their ends", () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({ x: i * 5, y: i * 2 }));
    expect(rdp(pts, 0.5)).toEqual([pts[0], pts[19]]);
  });

  it("decimate keeps the ends and drops close samples", () => {
    const pts = Array.from({ length: 101 }, (_, i) => ({ x: i * 0.1, y: 0 }));
    const out = decimate(pts, 1);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[100]);
    expect(out.length).toBeLessThanOrEqual(12);
  });

  it("splits an L stroke at its corner", () => {
    const pts = [...Array.from({ length: 30 }, (_, i) => ({ x: i * 2, y: 0 })), ...Array.from({ length: 30 }, (_, i) => ({ x: 58, y: (i + 1) * 2 }))];
    const runs = splitAtCorners(pts, 80, 3);
    expect(runs).toHaveLength(2);
    expect(runs[0][runs[0].length - 1]).toEqual(runs[1][0]);
    expect(runs[0][runs[0].length - 1]).toEqual({ x: 58, y: 0 });
  });
});

describe("vector-fit: Schneider", () => {
  it("fits samples of one cubic with one segment within the error", () => {
    const c: Cubic = [
      { x: 0, y: 0 },
      { x: 30, y: -60 },
      { x: 90, y: 80 },
      { x: 120, y: 10 },
    ];
    const pts = sample(c, 60);
    const fit = fitCubics(pts, 0.5);
    expect(fit).toHaveLength(1);
    expect(fitError(pts, fit)).toBeLessThan(0.55);
  });

  it("fits a circle in a few smooth segments", () => {
    const pts = Array.from({ length: 200 }, (_, i) => {
      const a = (i / 199) * Math.PI * 2 * 0.98;
      return { x: 100 + 80 * Math.cos(a), y: 100 + 80 * Math.sin(a) };
    });
    const fit = fitCubics(pts, 1);
    expect(fit.length).toBeLessThanOrEqual(8);
    expect(fitError(pts, fit)).toBeLessThan(1.1);
    const v = pencilToVector(pts, { zoom: 1 })!;
    const inner = v.paths[0].points.slice(1, -1);
    expect(inner.every((p) => p.mirror !== "none")).toBe(true);
  });

  it("an L stroke gives a sharp corner (mirror none) between two straight-ish runs", () => {
    const pts = [...Array.from({ length: 40 }, (_, i) => ({ x: i * 2, y: 0 })), ...Array.from({ length: 40 }, (_, i) => ({ x: 78, y: (i + 1) * 2 }))];
    const v = pencilToVector(pts, { zoom: 1 })!;
    const corner = v.paths[0].points.find((p) => close(p, { x: 78, y: 0 }, 0.5));
    expect(corner).toBeDefined();
    expect(corner!.mirror).toBe("none");
    expect(v.paths[0].points.length).toBeLessThanOrEqual(4);
  });

  it("caps a long scribble's anchors and makes valid path data", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    const pts: Vec2[] = [{ x: 0, y: 0 }];
    for (let i = 1; i < 5000; i++) pts.push({ x: pts[i - 1].x + 3 + rnd() * 2, y: pts[i - 1].y + rnd() * 30 });
    const v = pencilToVector(pts, { zoom: 1 })!;
    expect(v.paths[0].points.length).toBeLessThanOrEqual(PENCIL_MAX_ANCHORS);
    expect(vectorToD(v)).toMatch(/^M-?[\d.]+ -?[\d.]+([CL][-\d. ]+)+$/);
  });

  it("treats a tiny stroke as a click, and ⇧ as a straight line", () => {
    expect(pencilToVector([{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }], { zoom: 1 })).toBeNull();
    const v = pencilToVector(
      Array.from({ length: 20 }, (_, i) => ({ x: i * 5, y: Math.sin(i) * 9 })),
      { zoom: 1, straight: true },
    )!;
    expect(v.paths[0].points).toHaveLength(2);
    expect(v.paths[0].points.every((p) => !p.in && !p.out)).toBe(true);
  });
});

const curve: VectorData = {
  paths: [
    {
      points: [
        { x: 0, y: 0, mirror: "none", out: { x: 20, y: -60 } },
        { x: 120, y: 0, mirror: "none", in: { x: -10, y: -70 } },
      ],
      closed: false,
    },
  ],
};

describe("vector-fit: delete and heal", () => {
  it("healing a split point recovers the original cubic", () => {
    const { v } = splitSegment(curve, { path: 0, seg: 0 }, 0.35);
    expect(v.paths[0].points).toHaveLength(3);
    const healed = deleteAndHeal(v, [{ path: 0, point: 1 }]);
    expect(healed.paths[0].points).toHaveLength(2);
    const a = segmentCubic(curve, { path: 0, seg: 0 }),
      b = segmentCubic(healed, { path: 0, seg: 0 });
    for (let i = 0; i < 4; i++) expect(close(a[i], b[i], 0.05)).toBe(true);
  });

  it("two straight segments heal into a straight one", () => {
    const v: VectorData = { paths: [{ points: [{ x: 0, y: 0, mirror: "none" }, { x: 50, y: 40, mirror: "none" }, { x: 100, y: 0, mirror: "none" }], closed: false }] };
    const healed = deleteAndHeal(v, [{ path: 0, point: 1 }]);
    expect(vectorToD(healed)).toBe("M0 0L100 0");
  });

  it("keeps a curved run's shape close when healing over a real corner", () => {
    const c: Cubic[] = [
      [{ x: 0, y: 0 }, { x: 20, y: -40 }, { x: 60, y: -40 }, { x: 80, y: 0 }],
      [{ x: 80, y: 0 }, { x: 100, y: 40 }, { x: 140, y: 40 }, { x: 160, y: 0 }],
    ];
    const h = healCubics(c);
    expect(h[0]).toEqual(c[0][0]);
    expect(h[3]).toEqual(c[1][3]);
  });

  it("drops an open path's end anchor and closes the ring over a closed path's anchor", () => {
    const open = deleteAndHeal(curve, [{ path: 0, point: 1 }]);
    expect(open.paths).toHaveLength(0);
    const tri: VectorData = { paths: [{ points: [{ x: 0, y: 0, mirror: "none" }, { x: 100, y: 0, mirror: "none" }, { x: 100, y: 100, mirror: "none" }, { x: 0, y: 100, mirror: "none" }], closed: true }] };
    const healed = deleteAndHeal(tri, [{ path: 0, point: 2 }]);
    expect(healed.paths[0].closed).toBe(true);
    expect(healed.paths[0].points).toHaveLength(3);
  });
});

describe("vector ops: join, cut, mirror", () => {
  const two: VectorData = {
    paths: [
      { points: [{ x: 0, y: 0, mirror: "none" }, { x: 50, y: 0, mirror: "none" }], closed: false },
      { points: [{ x: 100, y: 0, mirror: "none" }, { x: 150, y: 50, mirror: "none" }], closed: false },
    ],
  };

  it("joins two subpaths end to start (reversing as needed)", () => {
    const j = joinEndpoints(two, { path: 0, point: 1 }, { path: 1, point: 0 })!;
    expect(j.v.paths).toHaveLength(1);
    expect(vectorToD(j.v)).toBe("M0 0L50 0L100 0L150 50");
    const r = joinEndpoints(two, { path: 0, point: 0 }, { path: 1, point: 1 })!;
    expect(vectorToD(r.v)).toBe("M50 0L0 0L150 50L100 0");
  });

  it("joins a path's own ends by closing it, merging coincident ends", () => {
    const loop: VectorData = { paths: [{ points: [{ x: 0, y: 0, mirror: "none" }, { x: 50, y: 0, mirror: "none" }, { x: 50, y: 50, mirror: "none" }, { x: 0, y: 0, mirror: "none" }], closed: false }] };
    const j = joinEndpoints(loop, { path: 0, point: 0 }, { path: 0, point: 3 })!;
    expect(j.v.paths[0].closed).toBe(true);
    expect(j.v.paths[0].points).toHaveLength(3);
    expect(joinEndpoints(two, { path: 0, point: 0 }, { path: 0, point: 0 })).toBeNull();
  });

  it("cuts an open path in two and opens a closed one", () => {
    const line: VectorData = { paths: [{ points: [{ x: 0, y: 0, mirror: "none" }, { x: 50, y: 0, mirror: "none" }, { x: 100, y: 0, mirror: "none" }], closed: false }] };
    const cut = cutAt(line, { path: 0, point: 1 });
    expect(cut.paths.map((p) => p.points.length)).toEqual([2, 2]);
    const sq: VectorData = { paths: [{ points: [{ x: 0, y: 0, mirror: "none" }, { x: 10, y: 0, mirror: "none" }, { x: 10, y: 10, mirror: "none" }], closed: true }] };
    const opened = cutAt(sq, { path: 0, point: 1 });
    expect(opened.paths[0].closed).toBe(false);
    expect(vectorToD(opened)).toBe("M10 0L10 10L0 0L10 0");
  });

  it("setMirror lines handles up (angle) and evens them (angle and length)", () => {
    const v: VectorData = { paths: [{ points: [{ x: 0, y: 0, mirror: "none" }, { x: 50, y: 0, mirror: "none", in: { x: -10, y: 5 }, out: { x: 20, y: 0 } }, { x: 100, y: 0, mirror: "none" }], closed: false }] };
    const a = setMirror(v, [{ path: 0, point: 1 }], "angle").paths[0].points[1];
    expect(a.mirror).toBe("angle");
    expect(a.in!.y).toBeCloseTo(0);
    expect(Math.hypot(a.in!.x, a.in!.y)).toBeCloseTo(Math.hypot(10, 5));
    const b = setMirror(v, [{ path: 0, point: 1 }], "angle-length").paths[0].points[1];
    expect(b.in!.x).toBeCloseTo(-b.out!.x);
    const corner = setMirror(v, [{ path: 0, point: 0 }], "angle-length").paths[0].points[0];
    expect(corner.mirror).toBe("angle-length");
  });
});
