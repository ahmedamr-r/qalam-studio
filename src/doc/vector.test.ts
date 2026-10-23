import { describe, expect, it } from "vitest";
import { parsePath, toD } from "@/design-system/svg-path";
import { makePath } from "./factory";
import { apply, localMatrix } from "./geometry";
import type { PathNode, VectorData, VectorPoint } from "./schema";
import {
  bendSegment,
  cubicAt,
  deletePoints,
  fillD,
  flatten,
  hitVector,
  inferMirror,
  isEditableVector,
  movePoints,
  nearestOnVector,
  normalizeVectorNode,
  reversePath,
  segmentCubic,
  setHandle,
  snapAngle,
  splitSegment,
  toggleSmooth,
  vectorFromD,
  vectorOf,
  vectorScale,
  vectorToD,
  writeVector,
} from "./vector";

const P = (x: number, y: number, extra: Partial<VectorPoint> = {}): VectorPoint => ({ x, y, mirror: "none", ...extra });
const near = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

/** A node whose vector is in sync with its d. */
function vecNode(v: VectorData, p: Partial<PathNode> = {}): PathNode {
  const n = makePath("M0 0", { fill: null, stroke: { color: "#000000", width: 2 }, ...p });
  writeVector(n, v);
  return n;
}

describe("vectorToD", () => {
  it("writes open straight paths as lines", () => {
    expect(vectorToD({ paths: [{ points: [P(0, 0), P(10, 0), P(10, 10)], closed: false }] })).toBe("M0 0L10 0L10 10");
  });

  it("writes curves when either handle of a segment is set", () => {
    expect(vectorToD({ paths: [{ points: [P(0, 0, { out: { x: 5, y: 0 } }), P(10, 10)], closed: false }] })).toBe("M0 0C5 0 10 10 10 10");
  });

  it("closes straight paths with Z only", () => {
    expect(vectorToD({ paths: [{ points: [P(0, 0), P(10, 0), P(10, 10)], closed: true }] })).toBe("M0 0L10 0L10 10Z");
  });

  it("closes curved paths with an explicit cubic back to the start", () => {
    const d = vectorToD({ paths: [{ points: [P(0, 0, { in: { x: -5, y: 0 } }), P(10, 0), P(10, 10)], closed: true }] });
    expect(d).toBe("M0 0L10 0L10 10C10 10 -5 0 0 0Z");
  });

  it("fills closed subpaths only", () => {
    const v: VectorData = {
      paths: [
        { points: [P(0, 0), P(10, 0)], closed: false },
        { points: [P(0, 0), P(10, 0), P(10, 10)], closed: true },
        { points: [P(20, 0), P(30, 0), P(30, 10)], closed: true, filled: false },
      ],
    };
    expect(fillD(v)).toBe("M0 0L10 0L10 10Z");
    expect(fillD({ paths: [v.paths[0]] })).toBeNull();
  });
});

describe("vectorFromD", () => {
  const corpus = [
    "M0 0L10 0L10 10",
    "M2 2C2 8 8 8 8 2",
    "M0 0h10v10h-10z",
    "M0 0Q5 10 10 0T20 0",
    "M0 0C0 5 5 10 10 10S20 5 20 0",
    "M4 12a8 8 0 1 0 16 0a8 8 0 1 0 -16 0z",
    "M0 0L10 0M20 20L30 30L20 30Z",
    "m1 1 4 0 0 4z m10 0 l2 2",
  ];

  it("round-trips through the normalised svg form", () => {
    for (const d of corpus) {
      const v = vectorFromD(d)!;
      expect(v, d).not.toBeNull();
      // Same drawing: identical, except a closing segment that ended on the start point is now implied.
      const flat = (s: string) => flatten(vectorFromD(s)!, 0.1).map((p) => p.pts.map((q) => [Math.round(q.x * 10), Math.round(q.y * 10)]));
      expect(flat(vectorToD(v)), d).toEqual(flat(toD(parsePath(d).segs)));
    }
  });

  it("merges a closing segment that returns to the start", () => {
    const v = vectorFromD("M0 0C0 5 5 10 10 10C15 10 0 -5 0 0Z")!;
    expect(v.paths[0].closed).toBe(true);
    expect(v.paths[0].points).toHaveLength(2);
    expect(v.paths[0].points[0].in).toEqual({ x: 0, y: -5 });
  });

  it("starts a new subpath after Z without a move", () => {
    const v = vectorFromD("M0 0L10 0L10 10ZL5 5")!;
    expect(v.paths).toHaveLength(2);
    expect(v.paths[1].points[0]).toMatchObject({ x: 0, y: 0 });
  });

  it("infers handle mirroring", () => {
    expect(inferMirror(P(0, 0, { in: { x: -5, y: 0 }, out: { x: 5, y: 0 } }))).toBe("angle-length");
    expect(inferMirror(P(0, 0, { in: { x: -2, y: 0 }, out: { x: 5, y: 0 } }))).toBe("angle");
    expect(inferMirror(P(0, 0, { in: { x: -5, y: 1 }, out: { x: 5, y: 0 } }))).toBe("none");
    expect(inferMirror(P(0, 0, { out: { x: 5, y: 0 } }))).toBe("none");
  });
});

describe("vectorOf", () => {
  it("reads the node's vector while it matches d, and heals when d was rewritten", () => {
    const n = vecNode({ paths: [{ points: [P(0, 0), P(10, 0)], closed: false }] });
    expect(isEditableVector(n)).toBe(true);
    expect(vectorOf(n)).toBe(n.vector);
    n.d = "M0 0L0 10";
    expect(isEditableVector(n)).toBe(false);
    expect(vectorOf(n).paths[0].points[1]).toMatchObject({ x: 0, y: 10 });
  });

  it("rounds to 0.01 when writing", () => {
    const n = vecNode({ paths: [{ points: [P(0.123, 0), P(10.456, 0.004)], closed: false }] });
    expect(n.d).toBe("M0.12 0L10.46 0");
    expect(n.vector!.paths[0].points[1]).toMatchObject({ x: 10.46, y: 0 });
  });
});

describe("normalizeVectorNode", () => {
  const anchorsInParent = (n: PathNode) => {
    const { sx, sy } = vectorScale(n);
    const m = localMatrix(n);
    return vectorOf(n).paths.flatMap((p) => p.points.map((q) => apply(m, { x: q.x * sx, y: q.y * sy })));
  };

  for (const rotation of [0, 30]) {
    it(`keeps every anchor fixed in the parent (rotation ${rotation}°, scaled node)`, () => {
      const n = vecNode({ paths: [{ points: [P(0, 0), P(50, 0), P(50, 50)], closed: false }] }, { x: 100, y: 40, w: 100, h: 50, vw: 50, vh: 50, rotation });
      const before = anchorsInParent(n);
      // Drag the last anchor outside the box (in vector space): expected parent position follows.
      const moved = movePoints(vectorOf(n), [{ path: 0, point: 2 }], 20, 30);
      const m = localMatrix(n);
      const want = [...before.slice(0, 2), apply(m, { x: 70 * 2, y: 80 })];
      normalizeVectorNode(n, moved);
      const after = anchorsInParent(n);
      after.forEach((p, i) => {
        near(p.x, want[i].x, 0.02);
        near(p.y, want[i].y, 0.02);
      });
      expect(n.vw).toBe(n.w);
      expect(n.vh).toBe(n.h);
      expect(n.w).toBeCloseTo(140);
      expect(n.h).toBeCloseTo(80);
      const xs = n.vector!.paths[0].points.map((q) => q.x),
        ys = n.vector!.paths[0].points.map((q) => q.y);
      expect(Math.min(...xs)).toBe(0);
      expect(Math.min(...ys)).toBe(0);
    });
  }

  for (const [flipH, flipV, rotation] of [[true, false, 0], [false, true, 0], [true, true, 30]] as const) {
    it(`keeps untouched anchors fixed on a flipped vector (flipH ${flipH}, flipV ${flipV}, ${rotation}°)`, () => {
      const n = vecNode({ paths: [{ points: [P(0, 0), P(100, 50)], closed: false }] }, { x: 200, y: 100, w: 100, h: 50, vw: 100, vh: 50, rotation, flipH, flipV });
      const first = anchorsInParent(n)[0];
      // The box grows: the second anchor moves out to (150, 80) in vector space.
      normalizeVectorNode(n, movePoints(vectorOf(n), [{ path: 0, point: 1 }], 50, 30));
      near(anchorsInParent(n)[0].x, first.x, 0.01);
      near(anchorsInParent(n)[0].y, first.y, 0.01);
      expect([n.w, n.h]).toEqual([150, 80]);
    });
  }

  it("keeps whole-pixel anchors on whole pixels however often a curve's box is refitted", () => {
    // Curve bounds (not anchors) set the box: the origin is fractional.
    const n = vecNode({ paths: [{ points: [P(0, 0, { out: { x: -40, y: -47 } }), P(100, 0, { in: { x: 30, y: -53 } })], closed: false }] }, { x: 134, y: 172, w: 100, h: 1, vw: 100, vh: 1 });
    normalizeVectorNode(n, vectorOf(n));
    expect(n.x % 1).not.toBe(0);
    for (let k = 0; k < 20; k++) {
      // A handle edit only: the anchors stay, the box refits.
      const v = vectorOf(n);
      v.paths[0].points[0].out = { x: -40 - k, y: -47 + k / 3 };
      normalizeVectorNode(n, v);
    }
    for (const p of anchorsInParent(n)) {
      expect(Math.abs(p.x - Math.round(p.x))).toBeLessThan(1e-9);
      expect(Math.abs(p.y - Math.round(p.y))).toBeLessThan(1e-9);
    }
    expect(anchorsInParent(n).map((p) => [Math.round(p.x), Math.round(p.y)])).toEqual([
      [134, 172],
      [234, 172],
    ]);
  });

  it("keeps a horizontal line's zero height", () => {
    const n = vecNode({ paths: [{ points: [P(0, 0), P(200, 0)], closed: false }] }, { w: 200, h: 0, vw: 200, vh: 0 });
    expect(vectorScale(n)).toEqual({ sx: 1, sy: 1 });
    normalizeVectorNode(n, vectorOf(n));
    expect([n.w, n.h, n.vw, n.vh]).toEqual([200, 0, 200, 0]);
  });
});

describe("edits", () => {
  const curve: VectorData = { paths: [{ points: [P(0, 0, { out: { x: 0, y: 40 } }), P(100, 0, { in: { x: 0, y: 40 } })], closed: false }] };

  it("splits a segment without changing the curve", () => {
    const { v, point } = splitSegment(curve, { path: 0, seg: 0 }, 0.3);
    expect(point).toEqual({ path: 0, point: 1 });
    expect(v.paths[0].points).toHaveLength(3);
    const orig = segmentCubic(curve, { path: 0, seg: 0 });
    for (let k = 0; k <= 32; k++) {
      const t = k / 32;
      const want = cubicAt(orig, t);
      const got = t <= 0.3 ? cubicAt(segmentCubic(v, { path: 0, seg: 0 }), t / 0.3) : cubicAt(segmentCubic(v, { path: 0, seg: 1 }), (t - 0.3) / 0.7);
      near(got.x, want.x);
      near(got.y, want.y);
    }
  });

  it("deletes an interior point of an open path into two subpaths", () => {
    const v: VectorData = { paths: [{ points: [P(0, 0), P(10, 0), P(20, 0), P(30, 0)], closed: false }] };
    const out = deletePoints(v, [{ path: 0, point: 2 }]);
    expect(out.paths.map((p) => p.points.map((q) => q.x))).toEqual([[0, 10]]);
    const out2 = deletePoints({ paths: [{ points: [P(0, 0), P(10, 0), P(20, 0), P(30, 0), P(40, 0)], closed: false }] }, [{ path: 0, point: 2 }]);
    expect(out2.paths.map((p) => p.points.map((q) => q.x))).toEqual([
      [0, 10],
      [30, 40],
    ]);
  });

  it("opens a closed path at a deleted point", () => {
    const v: VectorData = { paths: [{ points: [P(0, 0), P(10, 0), P(10, 10), P(0, 10)], closed: true }] };
    const out = deletePoints(v, [{ path: 0, point: 1 }]);
    expect(out.paths).toHaveLength(1);
    expect(out.paths[0].closed).toBe(false);
    expect(out.paths[0].points.map((q) => [q.x, q.y])).toEqual([
      [10, 10],
      [0, 10],
      [0, 0],
    ]);
  });

  it("bends a segment through the target", () => {
    const line: VectorData = { paths: [{ points: [P(0, 0), P(100, 0)], closed: false }] };
    for (const t of [0.1, 0.5, 0.9]) {
      const target = { x: 100 * t, y: 30 };
      const v = bendSegment(line, { path: 0, seg: 0 }, t, target);
      const at = cubicAt(segmentCubic(v, { path: 0, seg: 0 }), t);
      near(at.x, target.x, 1e-6);
      near(at.y, target.y, 1e-6);
    }
  });

  it("mirrors handles by the anchor's mode", () => {
    const v: VectorData = { paths: [{ points: [P(0, 0), P(50, 0, { in: { x: -10, y: 0 }, out: { x: 20, y: 0 }, mirror: "angle" }), P(100, 0)], closed: false }] };
    const ref = { path: 0, point: 1, side: "out" as const };
    const a = setHandle(v, ref, { x: 0, y: 5 }).paths[0].points[1];
    near(a.in!.x, 0);
    near(a.in!.y, -10);
    const full = setHandle({ paths: [{ ...v.paths[0], points: v.paths[0].points.map((q, i) => (i === 1 ? { ...q, mirror: "angle-length" as const } : q)) }] }, ref, { x: 3, y: 4 }).paths[0].points[1];
    expect(full.in).toEqual({ x: -3, y: -4 });
    const broken = setHandle(v, ref, { x: 3, y: 4 }, { breakMirror: true }).paths[0].points[1];
    expect(broken.mirror).toBe("none");
    expect(broken.in).toEqual({ x: -10, y: 0 });
    const snapped = setHandle(v, ref, { x: 10, y: 1 }, { snap45: true }).paths[0].points[1];
    near(snapped.out!.y, 0);
  });

  it("toggles corner and smooth", () => {
    const v: VectorData = { paths: [{ points: [P(0, 0), P(30, 30), P(60, 0)], closed: false }] };
    const s = toggleSmooth(v, { path: 0, point: 1 }).paths[0].points[1];
    expect(s.mirror).toBe("angle");
    near(s.out!.y, 0);
    near(s.out!.x, Math.hypot(30, 30) / 3);
    expect(toggleSmooth({ paths: [{ ...v.paths[0], points: [v.paths[0].points[0], s, v.paths[0].points[2]] }] }, { path: 0, point: 1 }).paths[0].points[1].out).toBeUndefined();
  });

  it("reverses a path and swaps handle sides", () => {
    const r = reversePath(curve.paths[0]);
    expect(r.points[0]).toMatchObject({ x: 100, out: { x: 0, y: 40 } });
    expect(vectorToD({ paths: [r] })).toBe("M100 0C100 40 0 40 0 0");
  });

  it("snaps angles to 45° steps", () => {
    const p = snapAngle({ x: 0, y: 0 }, { x: 100, y: 17 });
    near(p.y, 0);
    const d = snapAngle({ x: 0, y: 0 }, { x: 100, y: 90 });
    near(d.x, d.y);
  });

  it("finds the nearest point on a curve", () => {
    const hit = nearestOnVector(curve, { x: 50, y: 40 }, 20)!;
    expect(hit.seg).toEqual({ path: 0, seg: 0 });
    near(hit.t, 0.5, 1e-3);
    near(hit.point.y, 30, 1e-3);
    expect(nearestOnVector(curve, { x: 50, y: 100 }, 5)).toBeNull();
  });
});

describe("hitVector", () => {
  it("hits inside a filled closed path and misses an even-odd hole", () => {
    const square = (o: number, s: number) => ({ points: [P(o, o), P(o + s, o), P(o + s, o + s), P(o, o + s)], closed: true });
    const n = vecNode({ paths: [square(0, 100), square(25, 50)] }, { w: 100, h: 100, vw: 100, vh: 100, fill: { color: "#000000" }, stroke: null, evenOdd: true });
    expect(hitVector(n, { x: 10, y: 10 }, 0)).toBe(true);
    expect(hitVector(n, { x: 50, y: 50 }, 0)).toBe(false);
  });

  it("does not fill open vectors, but legacy open paths keep SVG fill", () => {
    const u = { paths: [{ points: [P(0, 0), P(0, 100), P(100, 100), P(100, 0)], closed: false }] };
    const n = vecNode(u, { w: 100, h: 100, vw: 100, vh: 100, fill: { color: "#000000" }, stroke: null });
    expect(hitVector(n, { x: 50, y: 50 }, 2)).toBe(false);
    expect(hitVector(n, { x: 1, y: 50 }, 2)).toBe(true);
    const legacy = makePath(vectorToD(u), { w: 100, h: 100, vw: 100, vh: 100 });
    expect(hitVector(legacy, { x: 50, y: 50 }, 0)).toBe(true);
  });

  it("hits a zero-height line within the tolerance only", () => {
    const n = vecNode({ paths: [{ points: [P(0, 0), P(200, 0)], closed: false }] }, { w: 200, h: 0, vw: 200, vh: 0, stroke: { color: "#000000", width: 1 } });
    expect(hitVector(n, { x: 100, y: 3 }, 4)).toBe(true);
    expect(hitVector(n, { x: 100, y: 6 }, 4)).toBe(false);
  });

  it("misses the empty corner of a diagonal line's box", () => {
    const n = vecNode({ paths: [{ points: [P(0, 0), P(100, 100)], closed: false }] }, { w: 100, h: 100, vw: 100, vh: 100 });
    expect(hitVector(n, { x: 90, y: 10 }, 4)).toBe(false);
    expect(hitVector(n, { x: 50, y: 52 }, 4)).toBe(true);
  });

  it("follows the node's scale (stroke reach stays in node px)", () => {
    const n = vecNode({ paths: [{ points: [P(0, 0), P(100, 0), P(100, 100)], closed: false }] }, { w: 300, h: 100, vw: 100, vh: 100 });
    expect(hitVector(n, { x: 299, y: 50 }, 2)).toBe(true);
    expect(hitVector(n, { x: 99, y: 50 }, 2)).toBe(false);
  });
});
